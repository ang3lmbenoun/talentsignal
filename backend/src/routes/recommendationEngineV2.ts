import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { computeFitScore } from "../matching/fitScore";
import { computeRecommendation, type TopFitCandidate } from "../matching/recommendations";
import { toFitOpportunityInput, toFitCandidateInput, type OpportunityRow, type CandidateRow } from "./fits";

// S-30a: named recommendationEngineV2.ts, not an extension of the existing
// recommendationEngine.ts (S-06's real candidate/job-opening ranking
// endpoint, already covered by its own trust/ownership test suite) -- this
// is a different engine over a different pairing (opportunity/candidate fit
// via fitScore.ts, decision 056), not a second implementation of the same
// thing. A shared filename would also collide with the existing router's
// export name.
export function recommendationEngineV2Router(pool: Pool): Router {
  const router = Router();

  // Read-only suggestion endpoint, same trust boundary as /fits (REQ-002/020):
  // computes and returns a recommendation, writes nothing, contacts nothing
  // outbound, never persists a score.
  router.get(
    "/opportunities/:id/recommendation",
    requireAuth,
    requireRole(["admin", "sales"]),
    async (req, res) => {
      const opportunityId = req.params.id;

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

        const topFits: TopFitCandidate[] = candidateRows
          .map((row) => ({
            candidateId: row.id,
            yearsExperience: row.experience,
            result: computeFitScore(fitOpportunity, toFitCandidateInput(row)),
          }))
          .sort((a, b) => {
            if (b.result.score !== a.result.score) return b.result.score - a.result.score;
            return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
          });

        const recommendation = computeRecommendation(fitOpportunity, topFits);

        logger.info(
          { correlationId: req.correlationId, opportunityId, kind: recommendation.kind },
          "opportunity recommendation computed",
        );
        res.status(200).json({ opportunityId, ...recommendation });
      } catch (err) {
        logger.error({ correlationId: req.correlationId, err }, "opportunity recommendation failed");
        res.status(500).json({ error: "recommendation failed" });
      }
    },
  );

  return router;
}
