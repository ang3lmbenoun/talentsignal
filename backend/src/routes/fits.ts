import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { requirementsForTitle } from "../matching/roleSkillsConfig";
import { classifyFamily } from "../scoring/hardToFillScore";
import { computeFitScore, type FitOpportunityInput, type FitCandidateInput, type FitResult } from "../matching/fitScore";

// Exported for reuse by recommendations.ts's route (S-30a) -- same real
// opportunity/candidate row shapes, no second copy.
export interface OpportunityRow {
  id: string;
  title: string;
  family_key: string | null;
}

export interface CandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  role_family: string | null;
  availability: string | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// S-28: a real opportunity has no required_skills/required_years column
// (opportunities and job_openings have no FK between them, decision 015) --
// requiredSkills is sourced honestly via roleSkillsConfig.ts's
// requirementsForTitle() bridge (decision 027, already Ali-reviewed for
// exactly this "opportunity has only a title" gap), the same real mapping
// HF-3 candidate targeting already uses. requiredYears has no real source
// anywhere in this schema today, so it's always null here -- fitScore.ts
// renormalizes its weight away rather than faking a number. See
// 06_decisions/056.
export function toFitOpportunityInput(row: OpportunityRow): FitOpportunityInput {
  const { requirements } = requirementsForTitle(row.title);
  return {
    requiredSkills: requirements,
    requiredYears: null,
    roleFamily: row.family_key ?? classifyFamily(row.title),
  };
}

export function toFitCandidateInput(row: CandidateRow): FitCandidateInput {
  return {
    skills: row.skills,
    yearsExperience: row.experience,
    roleFamily: row.role_family,
    availability: row.availability,
  };
}

function bucketFor(result: FitResult): "ge85" | "b70_84" | "b60_69" | "lt60" | "insufficient_data" {
  if (result.basis === "insufficient_data") return "insufficient_data";
  const pct = result.score * 100;
  if (pct >= 85) return "ge85";
  if (pct >= 70) return "b70_84";
  if (pct >= 60) return "b60_69";
  return "lt60";
}

export function fitsRouter(pool: Pool): Router {
  const router = Router();

  // Read-only ranking endpoint, same trust boundary as client-matchmaking
  // (REQ-002/020): computes and returns a ranking, writes nothing, contacts
  // nothing outbound. No score is ever persisted (no cache table) -- every
  // call recomputes fresh from the real opportunities/candidates rows.
  router.get("/opportunities/:id/fits", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    const opportunityId = req.params.id;
    const limit = parseLimit(req.query.limit);

    try {
      const oppResult = await pool.query(
        "SELECT id, title, family_key FROM opportunities WHERE id = $1",
        [opportunityId],
      );
      if (oppResult.rows.length === 0) {
        res.status(404).json({ error: "opportunity not found" });
        return;
      }
      const opportunityRow = oppResult.rows[0] as OpportunityRow;
      const fitOpportunity = toFitOpportunityInput(opportunityRow);

      const candidatesResult = await pool.query(
        "SELECT id, name, skills, experience, role_family, availability FROM candidates",
      );
      const candidateRows = candidatesResult.rows as CandidateRow[];

      const ranked = candidateRows
        .map((row) => {
          const result = computeFitScore(fitOpportunity, toFitCandidateInput(row));
          return { candidateId: row.id, name: row.name, ...result };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
        })
        .slice(0, limit);

      logger.info(
        { correlationId: req.correlationId, opportunityId, limit, count: ranked.length },
        "opportunity fits computed",
      );
      res.status(200).json({
        opportunityId,
        requiredSkillsBasis: (fitOpportunity.requiredSkills ?? []).length > 0 ? "measured" : "insufficient_data",
        candidates: ranked,
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "opportunity fits computation failed");
      res.status(500).json({ error: "fit computation failed" });
    }
  });

  // Aggregate summary across the whole loaded set. Per-opportunity numbers
  // (avg score, bucket distribution) use each opportunity's BEST candidate
  // fit -- "does this req have at least one strong-fit candidate" -- not
  // every individual opportunity/candidate pairing. See 06_decisions/056.
  router.get("/fits/summary", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    try {
      const [opportunitiesResult, candidatesResult] = await Promise.all([
        pool.query("SELECT id, title, family_key FROM opportunities"),
        pool.query("SELECT id, name, skills, experience, role_family, availability FROM candidates"),
      ]);
      const opportunityRows = opportunitiesResult.rows as OpportunityRow[];
      const candidateRows = candidatesResult.rows as CandidateRow[];
      const candidateInputs = candidateRows.map(toFitCandidateInput);

      const buckets = { ge85: 0, b70_84: 0, b60_69: 0, lt60: 0, insufficient_data: 0 };
      let scoreSum = 0;
      let measuredCount = 0;

      for (const oppRow of opportunityRows) {
        const fitOpportunity = toFitOpportunityInput(oppRow);
        let best: FitResult | undefined;
        if (candidateInputs.length > 0 && (fitOpportunity.requiredSkills ?? []).length > 0) {
          for (const candidateInput of candidateInputs) {
            const result = computeFitScore(fitOpportunity, candidateInput);
            if (!best || result.score > best.score) best = result;
          }
        }
        const effective: FitResult = best ?? { score: 0, factors: [], basis: "insufficient_data" };
        buckets[bucketFor(effective)]++;
        if (effective.basis === "measured") {
          scoreSum += effective.score;
          measuredCount++;
        }
      }

      logger.info(
        { correlationId: req.correlationId, totalOpportunities: opportunityRows.length, totalCandidates: candidateRows.length },
        "fit summary computed",
      );
      res.status(200).json({
        totalOpportunities: opportunityRows.length,
        totalCandidates: candidateRows.length,
        avgFitScore: measuredCount > 0 ? Math.round((scoreSum / measuredCount) * 1000) / 1000 : null,
        measuredCount,
        distribution: buckets,
      });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "fit summary computation failed");
      res.status(500).json({ error: "fit summary failed" });
    }
  });

  return router;
}
