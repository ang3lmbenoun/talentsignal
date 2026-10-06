import { createPool } from "../db/pool";
import type { Pool } from "pg";

/**
 * S-25 (Basecamp todos/10215916782) — read-only analysis: does the
 * hard-to-fill score, computed with ONLY the evidence that was actually
 * available the first time a requisition was observed, track real
 * time-to-close? This file never touches the live scoring path
 * (hardToFillScore.ts / HARD_TO_FILL_CONFIG are not imported or modified)
 * and never writes to any table — see main()'s single read-only query set.
 *
 * NOTE ON NAMING: this analysis is independently labeled "S-25" in
 * Basecamp. It is unrelated to this codebase's other "S-25" (the
 * Overview/Opportunities/.../Analytics visual redesign) — the label
 * collision is coincidental, not a dependency between the two.
 *
 * Run: `npm run analyze:s25` (DATABASE_URL must be set).
 */

// ---------------------------------------------------------------------------
// Config — every number the analysis depends on lives here, named and
// documented, same discipline as HARD_TO_FILL_CONFIG itself.
// ---------------------------------------------------------------------------

// "a configurable grace period, default 2 days" — overridable for a
// re-run without a code change, same escape hatch DB_POOL_MAX uses.
export const GRACE_PERIOD_DAYS = process.env.S25_GRACE_PERIOD_DAYS
  ? Number(process.env.S25_GRACE_PERIOD_DAYS)
  : 2;

// Bucket split point, per the spec.
export const HIGH_LOW_CUTOFF = 0.5;

// "declare the sample too thin to conclude" below this per bucket. Set at
// 20 per the spec's own default; documented here rather than inlined so a
// future re-run can see exactly what was chosen and why: 20 is a
// conventional small-sample floor for a median comparison to mean anything
// at all, not a statistically derived power calculation -- this analysis
// does not claim more rigor than that.
export const MIN_BUCKET_SAMPLE_SIZE = 20;

// Decision 026's ORIGINAL (v1) three-factor weights: roleScarcity 0.60,
// daysOpen 0.20, repostedRole 0.20 (HARD_TO_FILL_CONFIG has since moved to
// v3's 0.48/0.16/0.16/0.20 four-factor weights post-S-24 -- this analysis
// deliberately validates the ORIGINAL decision-026 formula, not the
// current one, per the task spec). This analysis uses only the
// roleScarcity + repostedRole subset (daysOpen and capacitySignal are both
// excluded -- see computeFirstObservationScore's own comment), so the two
// remaining weights are renormalized to sum to 1 over just that subset:
// 0.60 / (0.60 + 0.20) = 0.75, 0.20 / (0.60 + 0.20) = 0.25.
export const NORMALIZED_WEIGHTS = {
  roleScarcity: 0.6 / 0.8,
  repostedRole: 0.2 / 0.8,
};

export type RoleScarcityBasis = "measured" | "curated" | "none" | "n/a";

// ---------------------------------------------------------------------------
// Pure, unit-tested logic
// ---------------------------------------------------------------------------

/**
 * The first-observation hardness score: roleScarcity + repostedRole ONLY.
 *
 * daysOpen is EXCLUDED ON PURPOSE. It is a duration signal that only grows
 * the longer a requisition stays open — the exact thing days-to-close
 * measures on the outcome side. Including it in the score under test would
 * make the test incapable of failing (a req open 60 days would score
 * "harder" partly because it has already taken 60 days, which is circular
 * against a "does hardness predict days-to-close" question).
 *
 * capacitySignal is EXCLUDED too: it was added in S-24, after decision 026,
 * and was never part of the formula this analysis is validating.
 *
 * roleScarcity.value is read as already computed and stored (measured's
 * continuous [0,1] ratio, curated's 1, or none's 0) — this function does
 * not re-derive roleScarcity itself, only combines it with the repost
 * signal under the renormalized weights.
 */
export function computeFirstObservationScore(
  roleScarcity: { basis: RoleScarcityBasis; value: number },
  repostVisibleAtFirstObservation: boolean,
): { score: number; roleScarcityContribution: number; repostContribution: number } {
  const roleScarcityValue = roleScarcity.basis === "none" ? 0 : roleScarcity.value;
  const roleScarcityContribution = NORMALIZED_WEIGHTS.roleScarcity * roleScarcityValue;
  const repostContribution = NORMALIZED_WEIGHTS.repostedRole * (repostVisibleAtFirstObservation ? 1 : 0);
  return {
    score: roleScarcityContribution + repostContribution,
    roleScarcityContribution,
    repostContribution,
  };
}

/**
 * A requisition is "closed" once it has been absent from its source's feed
 * for longer than the grace period, measured against the LATEST ingestion
 * run actually recorded for that source — not "now". A req still present
 * in the latest run is still open and must be excluded from the closed-set
 * analysis entirely (there is no days-to-close to measure yet).
 */
export function isClosed(lastSeenAt: Date, latestIngestionAt: Date, gracePeriodDays: number): boolean {
  const gapMs = latestIngestionAt.getTime() - lastSeenAt.getTime();
  return gapMs > gracePeriodDays * 86_400_000;
}

/** The date a req is classified closed: the last sighting plus the grace period. */
export function closedAtDate(lastSeenAt: Date, gracePeriodDays: number): Date {
  return new Date(lastSeenAt.getTime() + gracePeriodDays * 86_400_000);
}

export function daysToClose(firstObservedAt: Date, closedAt: Date): number {
  return Math.max(0, Math.round((closedAt.getTime() - firstObservedAt.getTime()) / 86_400_000));
}

/**
 * Was a repost already visible at the moment of first observation? Mirrors
 * computeDiffs.ts's hasPriorRequisitionIdSighting (decision 043) exactly,
 * but over data already loaded into memory rather than a second DB
 * round-trip — this analysis only ever reads raw_requisitions once (see
 * loadRawHistory below). Absence-based repost detection (the OTHER half of
 * decision 043) structurally cannot fire at first sighting — it requires a
 * PRIOR row for this same external_id to have already existed — so it is
 * correctly never checked here.
 */
export function wasRepostVisibleAtFirstObservation(
  firstRequisitionId: string | null,
  firstRunId: string | null,
  firstObservedAt: Date,
  otherSightings: { requisitionId: string | null; fetchedAt: Date; runId: string | null }[],
): boolean {
  if (firstRequisitionId === null) return false;
  return otherSightings.some(
    (s) =>
      s.requisitionId === firstRequisitionId &&
      s.fetchedAt.getTime() < firstObservedAt.getTime() &&
      s.runId !== firstRunId,
  );
}

/** Linear-interpolated percentile over an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

export function median(sortedAsc: number[]): number {
  return percentile(sortedAsc, 50);
}

// ---------------------------------------------------------------------------
// DB-reading orchestration
// ---------------------------------------------------------------------------

interface RawHistoryRow {
  source: string;
  external_id: string;
  fetched_at: string;
  run_id: string | null;
  raw_response: unknown;
}

interface OpportunityRow {
  source: string;
  external_signal_id: string;
  hard_to_fill_factors: { factor: string; basis: RoleScarcityBasis; value: number }[];
}

async function loadRawHistory(pool: Pool): Promise<RawHistoryRow[]> {
  const { rows } = await pool.query<RawHistoryRow>(
    "SELECT source, external_id, fetched_at, run_id, raw_response FROM raw_requisitions ORDER BY source, external_id, fetched_at ASC",
  );
  return rows;
}

async function loadRoleScarcityByKey(pool: Pool): Promise<Map<string, { basis: RoleScarcityBasis; value: number }>> {
  const { rows } = await pool.query<OpportunityRow>(
    "SELECT source, external_signal_id, hard_to_fill_factors FROM opportunities WHERE source IN ('greenhouse', 'lever')",
  );
  const byKey = new Map<string, { basis: RoleScarcityBasis; value: number }>();
  for (const row of rows) {
    const factor = (row.hard_to_fill_factors ?? []).find((f) => f.factor === "roleScarcity");
    if (factor) {
      byKey.set(`${row.source}::${row.external_signal_id}`, { basis: factor.basis, value: factor.value });
    }
  }
  return byKey;
}

function requisitionIdOf(rawResponse: unknown): string | null {
  const parsed = rawResponse as { requisition_id?: string } | null;
  return parsed?.requisition_id ?? null;
}

interface ItemHistory {
  source: string;
  externalId: string;
  firstObservedAt: Date;
  firstRunId: string | null;
  firstRequisitionId: string | null;
  lastSeenAt: Date;
}

function groupHistoryByItem(rows: RawHistoryRow[]): ItemHistory[] {
  const byItem = new Map<string, RawHistoryRow[]>();
  for (const row of rows) {
    const key = `${row.source}::${row.external_id}`;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)?.push(row);
  }

  const items: ItemHistory[] = [];
  for (const [, itemRows] of byItem) {
    // Rows were already selected ORDER BY fetched_at ASC.
    const first = itemRows[0];
    const last = itemRows[itemRows.length - 1];
    items.push({
      source: first.source,
      externalId: first.external_id,
      firstObservedAt: new Date(first.fetched_at),
      firstRunId: first.run_id,
      firstRequisitionId: requisitionIdOf(first.raw_response),
      lastSeenAt: new Date(last.fetched_at),
    });
  }
  return items;
}

interface BucketStats {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  avgRoleScarcityValue: number | null;
  repostVisiblePct: number | null;
}

function summarizeBucket(daysToCloseValues: number[], roleScarcityValues: number[], repostFlags: boolean[]): BucketStats {
  const sorted = [...daysToCloseValues].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: sorted.length > 0 ? median(sorted) : null,
    p25: sorted.length > 0 ? percentile(sorted, 25) : null,
    p75: sorted.length > 0 ? percentile(sorted, 75) : null,
    avgRoleScarcityValue:
      roleScarcityValues.length > 0 ? roleScarcityValues.reduce((a, b) => a + b, 0) / roleScarcityValues.length : null,
    repostVisiblePct:
      repostFlags.length > 0 ? (repostFlags.filter(Boolean).length / repostFlags.length) * 100 : null,
  };
}

export interface S25Result {
  gracePeriodDays: number;
  high: BucketStats;
  low: BucketStats;
  observationWindow: { earliestFirstObserved: string; latestClosedAt: string } | null;
  totalClosed: number;
  totalStillOpen: number;
  conclusionPossible: boolean;
  shortfall: { high: number; low: number };
}

export async function runAnalysis(pool: Pool): Promise<S25Result> {
  const [rawHistory, roleScarcityByKey] = await Promise.all([loadRawHistory(pool), loadRoleScarcityByKey(pool)]);
  const items = groupHistoryByItem(rawHistory);

  // "the LATEST ingestion run for that source" -- the most recent
  // fetched_at seen across ALL items of that source, not a global "now".
  const latestIngestionBySource = new Map<string, Date>();
  for (const row of rawHistory) {
    const current = latestIngestionBySource.get(row.source);
    const fetchedAt = new Date(row.fetched_at);
    if (!current || fetchedAt > current) latestIngestionBySource.set(row.source, fetchedAt);
  }

  // Build, per source, the list of (requisitionId, fetchedAt, runId) tuples
  // every OTHER item carries -- the input wasRepostVisibleAtFirstObservation
  // needs, built once here from the single already-loaded history rather
  // than a query per item.
  const sightingsBySourceExcludingItem = (source: string, externalId: string) =>
    rawHistory
      .filter((r) => r.source === source && r.external_id !== externalId)
      .map((r) => ({ requisitionId: requisitionIdOf(r.raw_response), fetchedAt: new Date(r.fetched_at), runId: r.run_id }));

  const highDays: number[] = [];
  const lowDays: number[] = [];
  const highRoleScarcity: number[] = [];
  const lowRoleScarcity: number[] = [];
  const highRepostFlags: boolean[] = [];
  const lowRepostFlags: boolean[] = [];
  let earliestFirstObserved: Date | null = null;
  let latestClosedAt: Date | null = null;
  let totalClosed = 0;
  let totalStillOpen = 0;

  for (const item of items) {
    const latestIngestion = latestIngestionBySource.get(item.source);
    if (!latestIngestion) continue;

    if (!isClosed(item.lastSeenAt, latestIngestion, GRACE_PERIOD_DAYS)) {
      totalStillOpen += 1;
      continue;
    }

    const roleScarcity = roleScarcityByKey.get(`${item.source}::${item.externalId}`);
    if (!roleScarcity) continue; // no stored score for this req -- cannot be analyzed.

    const repostVisible = wasRepostVisibleAtFirstObservation(
      item.firstRequisitionId,
      item.firstRunId,
      item.firstObservedAt,
      sightingsBySourceExcludingItem(item.source, item.externalId),
    );

    const { score } = computeFirstObservationScore(roleScarcity, repostVisible);
    const closedAt = closedAtDate(item.lastSeenAt, GRACE_PERIOD_DAYS);
    const days = daysToClose(item.firstObservedAt, closedAt);

    totalClosed += 1;
    if (!earliestFirstObserved || item.firstObservedAt < earliestFirstObserved) earliestFirstObserved = item.firstObservedAt;
    if (!latestClosedAt || closedAt > latestClosedAt) latestClosedAt = closedAt;

    const roleScarcityValue = roleScarcity.basis === "none" ? 0 : roleScarcity.value;
    if (score >= HIGH_LOW_CUTOFF) {
      highDays.push(days);
      highRoleScarcity.push(roleScarcityValue);
      highRepostFlags.push(repostVisible);
    } else {
      lowDays.push(days);
      lowRoleScarcity.push(roleScarcityValue);
      lowRepostFlags.push(repostVisible);
    }
  }

  const high = summarizeBucket(highDays, highRoleScarcity, highRepostFlags);
  const low = summarizeBucket(lowDays, lowRoleScarcity, lowRepostFlags);

  return {
    gracePeriodDays: GRACE_PERIOD_DAYS,
    high,
    low,
    observationWindow:
      earliestFirstObserved && latestClosedAt
        ? { earliestFirstObserved: earliestFirstObserved.toISOString(), latestClosedAt: latestClosedAt.toISOString() }
        : null,
    totalClosed,
    totalStillOpen,
    conclusionPossible: high.n >= MIN_BUCKET_SAMPLE_SIZE && low.n >= MIN_BUCKET_SAMPLE_SIZE,
    shortfall: {
      high: Math.max(0, MIN_BUCKET_SAMPLE_SIZE - high.n),
      low: Math.max(0, MIN_BUCKET_SAMPLE_SIZE - low.n),
    },
  };
}

function fmt(n: number | null): string {
  return n === null ? "n/a" : String(Math.round(n * 100) / 100);
}

async function main(): Promise<void> {
  const pool = createPool();
  try {
    const result = await runAnalysis(pool);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ...result,
          high: { ...result.high, median: fmt(result.high.median), p25: fmt(result.high.p25), p75: fmt(result.high.p75) },
          low: { ...result.low, median: fmt(result.low.median), p25: fmt(result.low.p25), p75: fmt(result.low.p75) },
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("s25HardnessValidation failed:", err);
    process.exit(1);
  });
}
