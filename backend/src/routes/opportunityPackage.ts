import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { composePackage, type ComposedPackageContent } from "../packages/composePackage";
import { composeEmailDraft } from "../packages/composeEmailDraft";
import type { OpportunityRow } from "./hiddenDemand";

interface JobOpeningRow {
  id: string;
  title: string;
  requirements: string[];
}

interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
}

interface OpportunityPackageRow {
  id: string;
  opportunity_id: string;
  job_opening_id: string;
  candidate_ids: string[];
  content: ComposedPackageContent;
  ai_generated: boolean;
  status: "draft" | "released";
  released_by: string | null;
  released_at: string | null;
  draft_email_body: string | null;
  created_at: string;
  updated_at: string;
}

function toPackageResponse(row: OpportunityPackageRow) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    jobOpeningId: row.job_opening_id,
    candidateIds: row.candidate_ids,
    content: row.content,
    aiGenerated: row.ai_generated,
    status: row.status,
    releasedBy: row.released_by,
    releasedAt: row.released_at,
    draftEmailBody: row.draft_email_body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function opportunityPackageRouter(pool: Pool): Router {
  const router = Router();

  // Composes a draft — never sends it anywhere. There is no notifier, no
  // adapter, no outbound call anywhere in this handler (unlike S-08's
  // pipeline update, which fires an internal-only notification hook): S-09
  // deliberately builds no delivery path at all. See
  // opportunityPackage.noOutbound.trust.test.ts.
  router.post("/opportunity-package/draft", requireAuth, async (req, res) => {
    const opportunityId = req.body?.opportunityId;
    const jobOpeningId = req.body?.jobOpeningId;

    if (!isValidId(opportunityId)) {
      res.status(400).json({ error: "opportunityId is required" });
      return;
    }
    if (!isValidId(jobOpeningId)) {
      res.status(400).json({ error: "jobOpeningId is required" });
      return;
    }

    try {
      const opportunityResult = await pool.query("SELECT * FROM opportunities WHERE id = $1", [
        opportunityId,
      ]);
      if (opportunityResult.rows.length === 0) {
        res.status(404).json({ error: "opportunity not found" });
        return;
      }
      const opportunityRow = opportunityResult.rows[0] as OpportunityRow;

      const jobResult = await pool.query(
        "SELECT id, title, requirements FROM job_openings WHERE id = $1",
        [jobOpeningId],
      );
      if (jobResult.rows.length === 0) {
        res.status(404).json({ error: "job opening not found" });
        return;
      }
      const jobRow = jobResult.rows[0] as JobOpeningRow;

      // id/name/skills/experience only — contact_info is never read here,
      // same discipline clientMatchmaking.ts's toRankedCandidate already
      // follows: this is a ranking/composition read path, not a contact
      // lookup.
      const candidatesResult = await pool.query(
        "SELECT id, name, skills, experience FROM candidates",
      );
      const candidateRows = candidatesResult.rows as CandidateRow[];

      const { candidateIds, content } = composePackage(
        {
          company: opportunityRow.company,
          confidenceScore: Number(opportunityRow.confidence_score),
          reasons: opportunityRow.reasons,
        },
        { title: jobRow.title, requirements: jobRow.requirements },
        candidateRows,
      );
      const draftEmailBody = composeEmailDraft(content);

      const { rows } = await pool.query(
        `INSERT INTO opportunity_packages
           (opportunity_id, job_opening_id, candidate_ids, content, ai_generated, status, draft_email_body)
         VALUES ($1, $2, $3, $4, true, 'draft', $5)
         RETURNING *`,
        [opportunityId, jobOpeningId, candidateIds, JSON.stringify(content), draftEmailBody],
      );

      logger.info(
        { correlationId: req.correlationId, packageId: rows[0].id, opportunityId, jobOpeningId },
        "opportunity package drafted",
      );
      res.status(201).json({ package: toPackageResponse(rows[0] as OpportunityPackageRow) });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity package draft failed");
      res.status(500).json({ error: "draft failed" });
    }
  });

  // The human-release gate (REQ-020). Terminal: a conditional UPDATE guarded
  // by `WHERE status = 'draft'` is what makes "released once" atomic under
  // concurrency without needing an advisory lock like S-08's pipeline update
  // — that lock solved a first-insert race (no row yet to lock); here the
  // row already exists, so the WHERE clause itself is the race guard: only
  // one concurrent request's UPDATE can ever match it.
  router.post("/opportunity-package/:id/release", requireAuth, async (req, res) => {
    const packageId = req.params.id;
    const releasedBy = req.user!.id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: updatedRows } = await client.query(
        `UPDATE opportunity_packages
         SET status = 'released', released_by = $1, released_at = now(), updated_at = now()
         WHERE id = $2 AND status = 'draft'
         RETURNING *`,
        [releasedBy, packageId],
      );

      if (updatedRows.length === 0) {
        const { rows: existingRows } = await client.query(
          "SELECT * FROM opportunity_packages WHERE id = $1",
          [packageId],
        );
        await client.query("ROLLBACK");

        if (existingRows.length === 0) {
          res.status(404).json({ error: "opportunity package not found" });
          return;
        }
        // Already released — rejected, and the response reflects the
        // ORIGINAL actor/timestamp, never anything from this request.
        res.status(409).json({
          error: "opportunity package already released",
          package: toPackageResponse(existingRows[0] as OpportunityPackageRow),
        });
        return;
      }

      const released = updatedRows[0] as OpportunityPackageRow;
      await client.query(
        `INSERT INTO opportunity_package_release_audit
           (package_id, opportunity_id, released_by, released_at)
         VALUES ($1, $2, $3, $4)`,
        [released.id, released.opportunity_id, released.released_by, released.released_at],
      );
      await client.query("COMMIT");

      logger.info(
        { correlationId: req.correlationId, packageId, releasedBy },
        "opportunity package released",
      );
      res.status(200).json({ package: toPackageResponse(released) });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection may already be unusable — the outer error is what matters.
      }
      logger.error({ correlationId: req.correlationId, err }, "opportunity package release failed");
      res.status(500).json({ error: "release failed" });
    } finally {
      client.release();
    }
  });

  // S-25: saves a human's edits to the pre-filled email draft. Gated to
  // status = 'draft' the same way release itself is gated -- once a package
  // is released, its draft_email_body is part of the record of what was
  // reviewed at release time and shouldn't keep silently changing after
  // the fact. "Restore AI draft" is a pure client-side recompute from
  // `content` (composeEmailDraft is deterministic), not a server call, so
  // there's no corresponding restore endpoint.
  router.patch("/opportunity-package/:id/email", requireAuth, async (req, res) => {
    const packageId = req.params.id;
    const draftEmailBody = req.body?.draftEmailBody;

    if (typeof draftEmailBody !== "string") {
      res.status(400).json({ error: "draftEmailBody must be a string" });
      return;
    }

    try {
      const { rows: updatedRows } = await pool.query(
        `UPDATE opportunity_packages
         SET draft_email_body = $1, updated_at = now()
         WHERE id = $2 AND status = 'draft'
         RETURNING *`,
        [draftEmailBody, packageId],
      );

      if (updatedRows.length > 0) {
        res.status(200).json({ package: toPackageResponse(updatedRows[0] as OpportunityPackageRow) });
        return;
      }

      const { rows: existingRows } = await pool.query(
        "SELECT * FROM opportunity_packages WHERE id = $1",
        [packageId],
      );
      if (existingRows.length === 0) {
        res.status(404).json({ error: "opportunity package not found" });
        return;
      }
      res.status(409).json({
        error: "opportunity package already released — its email draft is no longer editable",
        package: toPackageResponse(existingRows[0] as OpportunityPackageRow),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity package email save failed");
      res.status(500).json({ error: "email save failed" });
    }
  });

  router.get("/opportunity-packages", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM opportunity_packages ORDER BY created_at DESC",
      );
      res.status(200).json({
        packages: (rows as OpportunityPackageRow[]).map(toPackageResponse),
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list opportunity packages failed");
      res.status(500).json({ error: "failed to list opportunity packages" });
    }
  });

  return router;
}
