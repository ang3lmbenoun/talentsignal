import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { toOpportunityResponse, type OpportunityRow } from "./hiddenDemand";

function isValidIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && id.trim().length > 0)
  );
}

function isValidSkillsArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((s) => typeof s === "string");
}

interface RawPayloadRow {
  source: string;
  external_id: string;
  raw_response: unknown;
}

// S-24 (Fix 3): raw_requisitions has no FK from opportunities -- the only
// shared identity is (source, external_id) vs opportunities' (source,
// external_signal_id), see migration 015/017. Joined only for the bounded,
// caller-supplied id list this route already scopes to (never on the full
// GET /hidden-demand/opportunities list), so exposing the raw ingested
// payload here can't reintroduce the full-table-scan cost Fix 1 removed.
// DISTINCT ON picks the latest fetched_at per opportunity, same "latest
// wins" convention computeDiffs.ts already uses for longitudinal history.
function rawPayloadKey(source: string, externalId: string): string {
  return `${source}::${externalId}`;
}

async function fetchRawPayloads(
  pool: Pool,
  rows: OpportunityRow[],
): Promise<Map<string, unknown>> {
  if (rows.length === 0) return new Map();

  // unnest() given two equal-length arrays in a FROM clause zips them into
  // paired rows (index 1 with index 1, etc.) -- exactly the (source,
  // external_id) pairs this route's own requested opportunities have,
  // joined against raw_requisitions on that pair.
  const { rows: rawRows } = await pool.query<RawPayloadRow>(
    `SELECT DISTINCT ON (rr.source, rr.external_id) rr.source, rr.external_id, rr.raw_response
     FROM raw_requisitions rr
     JOIN unnest($1::text[], $2::text[]) AS pairs(source, external_id)
       ON rr.source = pairs.source AND rr.external_id = pairs.external_id
     ORDER BY rr.source, rr.external_id, rr.fetched_at DESC`,
    [rows.map((r) => r.source), rows.map((r) => r.external_signal_id)],
  );

  const byKey = new Map<string, unknown>();
  for (const raw of rawRows) byKey.set(rawPayloadKey(raw.source, raw.external_id), raw.raw_response);
  return byKey;
}

/**
 * S-07 (REQ-003): the read-through audit endpoint the story's slice names.
 * Deliberately does ZERO scoring — scoreSignal() is never called here, and
 * nothing is written. It only looks up rows that S-04's analyze pipeline
 * already scored and persisted, and shapes them through the exact same
 * toOpportunityResponse() that route uses, so there is still exactly one
 * place in the codebase that ever computes a confidence score, and this
 * route can never drift from it.
 *
 * Because it's a plain read with no write in between, calling it twice with
 * the same ids is trivially idempotent — even updated_at, which legitimately
 * changes across two /hidden-demand/analyze calls, cannot change here.
 *
 * Any requested id that doesn't exist is simply omitted from the response,
 * matching GET /hidden-demand/opportunities's existing "return what exists"
 * style rather than adding per-id 404 bookkeeping.
 */
export function opportunitiesRouter(pool: Pool): Router {
  const router = Router();

  // Feeds the same sales-facing queue as S-04 — 06_decisions/022.
  router.post("/opportunities/score", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    const opportunityIds = req.body?.opportunityIds;
    if (!isValidIdList(opportunityIds)) {
      res.status(400).json({ error: "opportunityIds must be a non-empty array of strings" });
      return;
    }

    try {
      const { rows } = await pool.query("SELECT * FROM opportunities WHERE id = ANY($1)", [
        opportunityIds,
      ]);
      const opportunityRows = rows as OpportunityRow[];
      // S-24 (Fix 3): rawPayload only ever computed here, for this bounded,
      // caller-supplied id list -- never joined onto the full opportunities
      // list, which would reintroduce the per-render full-table cost Fix 1
      // removed. null when no raw_requisitions row exists yet for this
      // (source, external_id) pair (e.g. a seeded/backfilled opportunity
      // that predates S-21's real ingestion).
      const rawPayloads = await fetchRawPayloads(pool, opportunityRows);
      const opportunities = opportunityRows.map((row) => ({
        ...toOpportunityResponse(row),
        rawPayload: rawPayloads.get(rawPayloadKey(row.source, row.external_signal_id)) ?? null,
      }));

      logger.info(
        { correlationId: req.correlationId, requested: opportunityIds.length, found: opportunities.length },
        "opportunities score lookup completed",
      );
      res.status(200).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunities score lookup failed");
      res.status(500).json({ error: "score lookup failed" });
    }
  });

  // S-30b (decision 058): the JD editor's save action. Additive and
  // deliberately narrow -- ONLY required_skills/required_years are
  // editable here, everything else on an opportunity (title, company,
  // source, confidence, reasons, hard-to-fill fields...) stays exclusively
  // ATS-derived, never user-writable through this or any endpoint. At
  // least one of the two fields must be present; either can be sent alone.
  // Sending required_skills: [] is accepted as a real, deliberate "no
  // skills required" edit (see fits.ts's toFitOpportunityInput, which
  // treats stored-but-empty differently from never-edited/NULL).
  router.patch("/opportunities/:id", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    const opportunityId = req.params.id;
    const hasSkills = Object.prototype.hasOwnProperty.call(req.body ?? {}, "requiredSkills");
    const hasYears = Object.prototype.hasOwnProperty.call(req.body ?? {}, "requiredYears");

    if (!hasSkills && !hasYears) {
      res.status(400).json({ error: "at least one of requiredSkills or requiredYears is required" });
      return;
    }
    if (hasSkills && !isValidSkillsArray(req.body.requiredSkills)) {
      res.status(400).json({ error: "requiredSkills must be an array of strings" });
      return;
    }
    const requiredYearsRaw = req.body?.requiredYears;
    const hasValidYears =
      !hasYears || requiredYearsRaw === null || (Number.isInteger(requiredYearsRaw) && requiredYearsRaw >= 0);
    if (!hasValidYears) {
      res.status(400).json({ error: "requiredYears must be a non-negative integer or null" });
      return;
    }

    try {
      // Only the columns the caller actually sent are updated -- a caller
      // that sends just requiredYears doesn't accidentally null out an
      // existing requiredSkills edit, and vice versa.
      const setClauses: string[] = [];
      const values: unknown[] = [];
      if (hasSkills) {
        values.push(req.body.requiredSkills);
        setClauses.push(`required_skills = $${values.length}`);
      }
      if (hasYears) {
        values.push(requiredYearsRaw);
        setClauses.push(`required_years = $${values.length}`);
      }
      values.push(opportunityId);

      const { rows } = await pool.query(
        `UPDATE opportunities SET ${setClauses.join(", ")}, updated_at = now()
         WHERE id = $${values.length}
         RETURNING id, required_skills, required_years`,
        values,
      );

      if (rows.length === 0) {
        res.status(404).json({ error: "opportunity not found" });
        return;
      }

      logger.info(
        { correlationId: req.correlationId, opportunityId, editedSkills: hasSkills, editedYears: hasYears },
        "opportunity JD fields edited",
      );
      res.status(200).json({
        opportunity: {
          id: rows[0].id,
          requiredSkills: rows[0].required_skills,
          requiredYears: rows[0].required_years,
        },
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity JD edit failed");
      res.status(500).json({ error: "JD edit failed" });
    }
  });

  return router;
}
