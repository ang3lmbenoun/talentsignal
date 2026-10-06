import { Router } from "express";
import type { Pool } from "pg";
import { logger } from "../logger";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import type { MarketSignal, MarketSignalProvider } from "../adapters/marketSignalProvider";
import { scoreSignal, type ScoreFactor } from "../scoring/confidenceScore";
// HF-2: a SECOND, independent scorer surfaced alongside confidence. Importing
// it here (not folding it into scoreSignal) keeps "one place per score" — see
// 06_decisions/026. HARD_TO_FILL_CONFIG.hardToFillThreshold is the badge cutoff.
import { hardToFillScore, type HardToFillFactor } from "../scoring/hardToFillScore";
import { HARD_TO_FILL_CONFIG } from "../scoring/hardToFillConfig";
import { computeFamilyScarcity, type FamilyScarcityLookup } from "../scoring/familyScarcity";
import { computeCapacitySignalLookup, type CapacitySignalLookup } from "../scoring/capacitySignal";

// The mock does no real I/O, but the timeout is real regardless: it bounds
// how long a hung or slow provider (mock or, later, a real HTTP call) can
// block this request, per CLAUDE.md rule 8.
const PROVIDER_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`provider timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export interface OpportunityRow {
  id: string;
  source: string;
  external_signal_id: string;
  company: string;
  title: string;
  confidence_score: string;
  reasons: string[];
  weights_version: string;
  factor_breakdown: ScoreFactor[];
  // HF-2: the hard-to-fill columns migration 013 added, mirroring the
  // confidence quartet above. Independent score, independent version.
  hard_to_fill_score: string;
  hard_to_fill_reasons: string[];
  hard_to_fill_factors: HardToFillFactor[];
  hard_to_fill_version: string;
  // S-22 (migration 016): measured from raw_requisitions history, not
  // seeded -- 06_decisions/043 (repost), 044 (churn), 045 (this schema).
  repost_count: number;
  days_open: number;
  description_churn: number;
  diff_computed_at: string | null;
  // S-23 (migration 018): title -> role-family classification, computed by
  // classifyFamily() at scoring time. Nullable -- rows scored before S-23
  // wired classifyFamily() into the ingestion path (and any row not yet
  // backfilled) have no value. Was already a real column, just never
  // reached toOpportunityResponse()'s return shape before S-24.
  family_key: string | null;
  // S-30b (migration 022): a human edit via PATCH /api/opportunities/:id,
  // or NULL if never edited. Surfaced here (first time this route has
  // exposed either) so the frontend JD editor can pre-fill with the real
  // current value instead of guessing from the title.
  required_skills: string[] | null;
  required_years: number | null;
  created_at: string;
  updated_at: string;
}

// pg returns NUMERIC columns as strings (to avoid silent precision loss), so
// confidence_score needs an explicit conversion back to a number here.
// factor_breakdown is JSONB, which pg parses automatically — no JSON.parse
// needed, unlike confidence_score.
//
// Exported so the new opportunities.ts route (S-07) shapes rows the same
// way this route always has — one function producing the response shape,
// not two that could drift.
export function toOpportunityResponse(row: OpportunityRow) {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    confidenceScore: Number(row.confidence_score),
    reasons: row.reasons,
    weightsVersion: row.weights_version,
    factors: row.factor_breakdown,
    // HF-2: hardToFill is the derived badge boolean — true only when the score
    // clears the PROPOSED threshold (026). The score/reasons/factors ride
    // along so the UI can show the "why" and never render a bare badge
    // (HF-2 trust scenario). pg returns NUMERIC as a string, so Number() here
    // exactly like confidence_score above.
    hardToFill: Number(row.hard_to_fill_score) >= HARD_TO_FILL_CONFIG.hardToFillThreshold,
    hardToFillScore: Number(row.hard_to_fill_score),
    hardToFillReasons: row.hard_to_fill_reasons,
    hardToFillFactors: row.hard_to_fill_factors,
    hardToFillVersion: row.hard_to_fill_version,
    // S-22: repostCount/descriptionChurn are the measured facts; isRepost
    // above (already read from the confidence/hard-to-fill factor
    // breakdowns) is just repostCount > 0 -- diffComputedAt null means this
    // row predates S-22 or hasn't been diffed yet (see migration 016).
    repostCount: row.repost_count,
    daysOpen: row.days_open,
    descriptionChurn: row.description_churn,
    diffComputedAt: row.diff_computed_at,
    // S-24 (Fix 3): surfaces the real S-23 family classification -- the
    // column has existed since migration 018, this is just the first route
    // to expose it.
    familyKey: row.family_key,
    // S-30b: null until a human edits via the JD editor -- the frontend
    // falls back to the same title-derived guess the backend's fit engine
    // uses (decision 058), never a separate guess of its own.
    requiredSkills: row.required_skills,
    requiredYears: row.required_years,
    source: row.source,
    externalSignalId: row.external_signal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Ranked by confidence descending; external_signal_id (unique, stable) is the
// tiebreak, not created_at — a batch insert can give many rows the exact same
// now(), which would make equal-score ordering nondeterministic and flake the
// idempotency test.
function byRankThenId(
  a: ReturnType<typeof toOpportunityResponse>,
  b: ReturnType<typeof toOpportunityResponse>,
): number {
  if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
  return a.externalSignalId < b.externalSignalId ? -1 : a.externalSignalId > b.externalSignalId ? 1 : 0;
}

// reasons is TEXT[] in Postgres, but unnest() can't walk a scalar array
// (source, external_signal_id, ...) and a nested array (reasons) in lockstep
// as one row per index — unnest flattens a 2-D array into individual
// elements, not sub-arrays per row. So each row's reasons are joined into one
// string with a delimiter before the query, and split back into a real array
// inside SQL (string_to_array). U+001F (Unit Separator) is the ASCII control
// character reserved for exactly this — joining sub-elements of one field —
// so it can't collide with anything scoreSignal() actually writes into a
// reason ("reposted role", "no salary range", ...).
const REASONS_DELIMITER = "\u001F";

// 06_decisions/042: a live run of 1,036 real signals hit Postgres's 5s
// statement_timeout on the single unnest() INSERT below -- a scale the 9-row
// seed and small test fixtures never exercised. Chunking bounds each
// statement's size instead of raising the timeout (which would hide the same
// ceiling from every other query on this pool, not just this one). Tunable:
// lower this if a single chunk is ever observed to approach 5s on its own
// (see decision doc for the reasoning). Lowered 200 -> 100: a chunk of 200
// still hit the timeout on a live run against Render, whose observed
// statement latency varies enough that 200 wasn't a safe margin (see
// decision doc's addendum).
export const UPSERT_CHUNK_SIZE = 100;

/**
 * Scores (confidence + hard-to-fill) and upserts ONE CHUNK in ONE statement
 * via unnest(), not one `pool.query` per signal. That distinction is the
 * latency story here: Postgres also caps a query at 65535 bind parameters,
 * and a dynamically built multi-VALUES statement (11 columns * 10,000 rows =
 * 110,000 params) sits over that ceiling at the scale this story targets.
 * unnest() takes one array parameter per column -- 11 array params (plus one
 * scalar delimiter) total, regardless of chunk size -- and stays a single
 * atomic statement, so one chunk either fully upserts or fully fails, never
 * half-applies. `upsertBatch` below splits the full signal list into chunks
 * of UPSERT_CHUNK_SIZE so each individual statement stays well under the 5s
 * statement_timeout (06_decisions/042) -- the whole batch no longer commits
 * as one transaction, but that tradeoff is what makes 1,000+ real signals
 * ingestible at all.
 *
 * factor_breakdown needs no delimiter trick the way reasons does: each row's
 * breakdown is ONE jsonb value (an array of 4 factor objects), not several
 * sub-elements that unnest() would otherwise flatten across rows — so a
 * plain jsonb[] array, one parsed JSON document per row, is unambiguous.
 */
async function upsertChunk(
  pool: Pool,
  signals: MarketSignal[],
  familyScarcity: FamilyScarcityLookup | undefined,
  capacitySignalLookup: CapacitySignalLookup | undefined,
): Promise<ReturnType<typeof toOpportunityResponse>[]> {
  if (signals.length === 0) return [];

  const sources: string[] = [];
  const externalIds: string[] = [];
  const companies: string[] = [];
  const titles: string[] = [];
  const scores: number[] = [];
  const reasonsJoined: string[] = [];
  const weightsVersions: string[] = [];
  const breakdownsJson: string[] = [];
  // HF-2: parallel arrays for the second score. Same U+001F delimiter trick as
  // reasons (TEXT[] can't ride through unnest un-joined — see REASONS_DELIMITER
  // above). factors go in as one jsonb value per row, like factor_breakdown.
  const htfScores: number[] = [];
  const htfReasonsJoined: string[] = [];
  const htfBreakdownsJson: string[] = [];
  const htfVersions: string[] = [];
  // S-22: carried straight through from MarketSignal (computed by
  // computeDiffs.ts inside each provider) to persistence -- no scoring
  // change here, scoreSignal()/hardToFillScore() already consumed
  // daysOpen/isRepost before this story, just with worse inputs.
  // MarketSignal.repostCount/descriptionChurn are optional (so every
  // existing mock/seed/test literal keeps compiling); undefined -> 0.
  const repostCounts: number[] = [];
  const daysOpens: number[] = [];
  const descriptionChurns: number[] = [];

  for (const signal of signals) {
    const { score, reasons, factors, weightsVersion } = scoreSignal(signal);
    // Second, independent scorer over the SAME signal — computed alongside,
    // never inside, scoreSignal(). scoreSignal stays untouched (026).
    // S-24 fix: familyScarcity (S-23) was defined but never actually
    // threaded into the live analyze path before this story -- roleScarcity
    // could never reach "measured" through real ingestion, only through
    // direct unit tests. Wiring it in alongside the new capacitySignalLookup
    // fixes that gap; see upsertBatch() below for where both are computed.
    const htf = hardToFillScore(signal, familyScarcity, capacitySignalLookup);
    sources.push(signal.source);
    externalIds.push(signal.externalId);
    companies.push(signal.company);
    titles.push(signal.title);
    scores.push(score);
    reasonsJoined.push(reasons.join(REASONS_DELIMITER));
    weightsVersions.push(weightsVersion);
    breakdownsJson.push(JSON.stringify(factors));
    htfScores.push(htf.score);
    htfReasonsJoined.push(htf.reasons.join(REASONS_DELIMITER));
    htfBreakdownsJson.push(JSON.stringify(htf.factors));
    htfVersions.push(htf.version);
    repostCounts.push(signal.repostCount ?? 0);
    daysOpens.push(signal.daysOpen);
    descriptionChurns.push(signal.descriptionChurn ?? 0);
  }

  const { rows } = await pool.query(
    `INSERT INTO opportunities
       (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
        hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version,
        repost_count, days_open, description_churn, diff_computed_at)
     SELECT
       src.source,
       src.external_signal_id,
       src.company,
       src.title,
       src.confidence_score,
       string_to_array(src.reasons_joined, $13),
       src.weights_version,
       src.factor_breakdown,
       src.hard_to_fill_score,
       string_to_array(src.htf_reasons_joined, $13),
       src.hard_to_fill_factors,
       src.hard_to_fill_version,
       src.repost_count,
       src.days_open,
       src.description_churn,
       now()
     FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::jsonb[],
                 $8::numeric[], $9::text[], $10::jsonb[], $11::text[], $12::text[],
                 $14::int[], $15::int[], $16::int[])
       AS src(source, external_signal_id, company, confidence_score, reasons_joined, weights_version, factor_breakdown,
              hard_to_fill_score, htf_reasons_joined, hard_to_fill_factors, hard_to_fill_version, title,
              repost_count, days_open, description_churn)
     ON CONFLICT (source, external_signal_id)
     DO UPDATE SET confidence_score = EXCLUDED.confidence_score,
                   title = EXCLUDED.title,
                   reasons = EXCLUDED.reasons,
                   weights_version = EXCLUDED.weights_version,
                   factor_breakdown = EXCLUDED.factor_breakdown,
                   hard_to_fill_score = EXCLUDED.hard_to_fill_score,
                   hard_to_fill_reasons = EXCLUDED.hard_to_fill_reasons,
                   hard_to_fill_factors = EXCLUDED.hard_to_fill_factors,
                   hard_to_fill_version = EXCLUDED.hard_to_fill_version,
                   repost_count = EXCLUDED.repost_count,
                   days_open = EXCLUDED.days_open,
                   description_churn = EXCLUDED.description_churn,
                   diff_computed_at = EXCLUDED.diff_computed_at,
                   updated_at = now()
     RETURNING *`,
    [
      sources,
      externalIds,
      companies,
      scores,
      reasonsJoined,
      weightsVersions,
      breakdownsJson,
      htfScores,
      htfReasonsJoined,
      htfBreakdownsJson,
      htfVersions,
      titles,
      REASONS_DELIMITER,
      repostCounts,
      daysOpens,
      descriptionChurns,
    ],
  );

  return (rows as OpportunityRow[]).map(toOpportunityResponse);
}

/**
 * Splits `signals` into chunks of UPSERT_CHUNK_SIZE and calls upsertChunk()
 * on each, sequentially (not Promise.all) so a large batch never opens many
 * concurrent connections against the pool at once -- a single ingestion run
 * has no latency budget that requires parallelism here, and the pool is
 * shared with request-serving traffic.
 *
 * Chunk-level failure isolation mirrors 06_decisions/040's board-level
 * isolation: one chunk's error is logged and classified, and the remaining
 * chunks still run -- a run that upserts 800 of 1,000 signals is strictly
 * better than one that upserts zero because row 850 had a bad value.
 */
// Exported for S-19's seedDemo.ts: reuses the real scorer + upsert path to
// generate a hard-to-fill opportunity for the demo seed, instead of
// hand-rolling a second, guessable score. See 06_decisions/029.
export async function upsertBatch(
  pool: Pool,
  signals: MarketSignal[],
): Promise<ReturnType<typeof toOpportunityResponse>[]> {
  if (signals.length === 0) return [];

  // Computed ONCE per batch (a "scoring run"), reused across every chunk --
  // exactly the shape 06_decisions/046/047 both describe, wired into the
  // real path for the first time here (S-24 fix, see the comment on
  // hardToFillScore's call site above).
  const [familyScarcity, capacitySignalLookup] = await Promise.all([
    computeFamilyScarcity(pool),
    computeCapacitySignalLookup(pool),
  ]);

  const results: ReturnType<typeof toOpportunityResponse>[] = [];

  for (let i = 0; i < signals.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = signals.slice(i, i + UPSERT_CHUNK_SIZE);
    try {
      const chunkRows = await upsertChunk(pool, chunk, familyScarcity, capacitySignalLookup);
      results.push(...chunkRows);
    } catch (err) {
      logger.error(
        { chunkStart: i, chunkSize: chunk.length, err },
        "upsertBatch chunk failed -- continuing with remaining chunks",
      );
    }
  }

  return results.sort(byRankThenId);
}

export function hiddenDemandRouter(
  pool: Pool,
  provider: MarketSignalProvider,
  options?: { providerTimeoutMs?: number },
): Router {
  const providerTimeoutMs = options?.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  const router = Router();

  // S-04: "As a sales rep..." — 06_decisions/022's permission matrix.
  router.post("/hidden-demand/analyze", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    let signals;
    try {
      signals = await withTimeout(
        provider.fetchSignals({ timeoutMs: providerTimeoutMs, runId: req.correlationId }),
        providerTimeoutMs,
      );
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand provider call failed");
      const isTimeout = err instanceof Error && err.message.includes("timed out");
      res
        .status(isTimeout ? 504 : 502)
        .json({ error: isTimeout ? "provider timed out" : "provider unavailable" });
      return;
    }

    try {
      const opportunities = await upsertBatch(pool, signals);

      logger.info(
        { correlationId: req.correlationId, count: opportunities.length },
        "hidden-demand analyze completed",
      );
      res.status(201).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "hidden-demand analyze failed");
      res.status(500).json({ error: "analyze failed" });
    }
  });

  router.get("/hidden-demand/opportunities", requireAuth, requireRole(["admin", "sales"]), async (req, res) => {
    try {
      // Seed rows (source = 'seed-job-board', see SeedJobBoardProvider) are
      // synthetic test data used to demo ranking and measure AC-4-2 latency —
      // hidden from the board by default so they never look like real
      // opportunities. ?includeSeedData=true opts back in for local/demo use.
      const includeSeedData = req.query.includeSeedData === "true";
      const { rows } = await pool.query(
        includeSeedData
          ? "SELECT * FROM opportunities"
          : "SELECT * FROM opportunities WHERE source != 'seed-job-board'",
      );
      const opportunities = rows.map((row) => toOpportunityResponse(row as OpportunityRow)).sort(byRankThenId);
      res.status(200).json({ opportunities });
    } catch (err) {
      logger.error({ correlationId: req.correlationId, err }, "list opportunities failed");
      res.status(500).json({ error: "failed to list opportunities" });
    }
  });

  return router;
}
