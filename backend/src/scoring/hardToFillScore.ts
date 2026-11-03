import type { MarketSignal } from "../adapters/marketSignalProvider";
import { HARD_TO_FILL_CONFIG, CAPACITY_SIGNAL_CONFIG } from "./hardToFillConfig";
import type { FamilyScarcityLookup } from "./familyScarcity";
import { resolveCapacitySignal, sourceLabel, type CapacitySignalLookup } from "./capacitySignal";

// S-23: which evidence produced roleScarcity's value. "n/a" is stamped on
// daysOpen/repostedRole, which have no basis concept of their own -- kept as
// a required field (not optional) so every persisted factor has the same
// shape, rather than some rows silently omitting it. S-24: capacitySignal
// reuses the same three-state shape (06_decisions/047).
export type HardToFillBasis = "measured" | "curated" | "none" | "n/a";

export interface HardToFillFactor {
  factor: "roleScarcity" | "daysOpen" | "repostedRole" | "capacitySignal";
  weight: number;
  value: number;
  contribution: number;
  basis: HardToFillBasis;
  // Only present on a roleScarcity factor whose basis is "measured" -- the
  // actual family/median numbers behind the value, so a stored score is
  // self-explaining without recomputing anything (no hidden inputs, per
  // HF-1's trust scenario).
  familyKey?: string;
  familyMedianDaysOpen?: number;
  globalMedianDaysOpen?: number;
  // S-24: only present on a capacitySignal factor with a real match
  // (measured or curated) -- present even when recencyExcluded is true, so
  // a real match that got zeroed by the recency gate stays visible rather
  // than indistinguishable from "no match ever existed" (06_decisions/047).
  capacitySource?: string;
  matchedEmployerName?: string;
  eventDate?: string | null;
  recencyExcluded?: boolean;
}

export interface HardToFillResult {
  score: number;
  reasons: string[];
  factors: HardToFillFactor[];
  version: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type RawFactor = HardToFillFactor;

// Lowercases and collapses every run of non-alphanumeric characters (including
// punctuation like ".", "-", "/") down to a single space, so "Sr. Data-Analyst"
// and "Data/Analyst" both normalize to the same token stream as "Data Analyst".
// Padded with a leading/trailing space so a keyword search can require word
// boundaries via simple substring matching against " keyword " rather than a
// regex per keyword.
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

// Word-boundary substring match — fixes the punctuation-sensitivity gap
// decision 026 flagged ("Sr. Data-Analyst" now matches "data analyst") while
// keeping the original phrase-based matching semantics: multi-word keywords
// still require the whole phrase, in order, as a run of tokens.
function matchesAnyKeyword(title: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(title);
  return keywords.some((keyword) => normalized.includes(` ${normalizeForMatch(keyword).trim()} `));
}

export function matchesScarceRole(title: string): boolean {
  return matchesAnyKeyword(title, HARD_TO_FILL_CONFIG.roleKeywords);
}

// S-23: classifies a free-text title into a role family for measured
// roleScarcity (see familyScarcity.ts, Step 3). Falls back to
// "general-other" when nothing matches — this is the expected outcome for a
// real, large slice of the dataset (e.g. leadership/management titles, see
// 06_decisions/046's "known gaps" section), not an error case.
//
// Precedence rule: a multi-word (specific) keyword match always wins over a
// single-word (broad) keyword match, regardless of family order — checked in
// two passes below. Only when nothing specific matches anywhere does a broad
// token (roleFamilies' single-word entries, e.g. ml-ai's "ai", security's
// "security") get to decide, in roleFamilies' declaration order. This
// matters concretely: ml-ai's bare "ai" token would otherwise preempt
// data-analytics' "data engineer" on a title like "AI Data Engineer" simply
// because ml-ai is declared first — the two-pass split fixes that instead of
// leaving it to accidental object order. Pinned by
// classifyFamily.test.ts's precedence cases.
export function classifyFamily(title: string): string {
  const entries = Object.entries(HARD_TO_FILL_CONFIG.roleFamilies);
  const isSpecific = (keyword: string) => keyword.trim().includes(" ");

  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter(isSpecific))) return familyKey;
  }
  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter((k) => !isSpecific(k)))) return familyKey;
  }
  return "general-other";
}

// S-23: resolves roleScarcity's value + basis for one signal. Measured
// requires BOTH the signal's own source to be on the allowlist (today, just
// "greenhouse" -- see 06_decisions/046's Lever exclusion) AND its family to
// have cleared familyObservationThreshold real Greenhouse observations.
// Anything else falls back to the original decision-026 curated-keyword
// check, unchanged from before this story.
function resolveRoleScarcity(
  signal: MarketSignal,
  familyScarcity: FamilyScarcityLookup | undefined,
): { value: number; basis: HardToFillBasis; familyKey?: string; familyMedianDaysOpen?: number; globalMedianDaysOpen?: number } {
  const familyKey = classifyFamily(signal.title);
  const family = familyScarcity?.byFamily[familyKey];
  const measuredEligible =
    familyScarcity !== undefined &&
    HARD_TO_FILL_CONFIG.measuredEligibleSources.includes(signal.source) &&
    family !== undefined &&
    family.count >= HARD_TO_FILL_CONFIG.familyObservationThreshold;

  if (measuredEligible) {
    const { globalMedianDaysOpen } = familyScarcity;
    const saturationPoint = HARD_TO_FILL_CONFIG.measuredScarcitySaturationMultiple * globalMedianDaysOpen;
    const value = saturationPoint > 0 ? Math.min(1, family.medianDaysOpen / saturationPoint) : 0;
    return { value, basis: "measured", familyKey, familyMedianDaysOpen: family.medianDaysOpen, globalMedianDaysOpen };
  }

  const isScarceRole = matchesScarceRole(signal.title);
  return { value: isScarceRole ? 1 : 0, basis: isScarceRole ? "curated" : "none" };
}

// The one place the arithmetic happens, in full float precision — no
// rounding yet. Same "round only at the boundary" convention
// confidenceScore.ts established.
function buildRawFactors(
  signal: MarketSignal,
  familyScarcity: FamilyScarcityLookup | undefined,
  capacitySignalLookup: CapacitySignalLookup | undefined,
): RawFactor[] {
  const { weights, daysOpenSaturationThreshold } = HARD_TO_FILL_CONFIG;
  const daysOpenRatio = Math.min(signal.daysOpen, daysOpenSaturationThreshold) / daysOpenSaturationThreshold;
  const roleScarcity = resolveRoleScarcity(signal, familyScarcity);
  const capacitySignal = resolveCapacitySignal(signal.company, capacitySignalLookup);

  return [
    {
      factor: "roleScarcity",
      weight: weights.roleScarcity,
      value: roleScarcity.value,
      contribution: weights.roleScarcity * roleScarcity.value,
      basis: roleScarcity.basis,
      familyKey: roleScarcity.familyKey,
      familyMedianDaysOpen: roleScarcity.familyMedianDaysOpen,
      globalMedianDaysOpen: roleScarcity.globalMedianDaysOpen,
    },
    {
      factor: "daysOpen",
      weight: weights.daysOpen,
      value: daysOpenRatio,
      contribution: weights.daysOpen * daysOpenRatio,
      basis: "n/a",
    },
    {
      factor: "repostedRole",
      weight: weights.repostedRole,
      value: signal.isRepost ? 1 : 0,
      contribution: signal.isRepost ? weights.repostedRole : 0,
      basis: "n/a",
    },
    {
      factor: "capacitySignal",
      weight: weights.capacitySignal,
      value: capacitySignal.value,
      contribution: weights.capacitySignal * capacitySignal.value,
      basis: capacitySignal.basis,
      capacitySource: capacitySignal.capacitySource,
      matchedEmployerName: capacitySignal.matchedEmployerName,
      eventDate: capacitySignal.eventDate,
      recencyExcluded: capacitySignal.recencyExcluded,
    },
  ];
}

// One row per configured factor, always in this fixed order, always
// present — even at value/contribution 0 — since a visible zero is more
// auditable than an omitted row, and it changes nothing about the score.
function toDisplayFactors(raw: RawFactor[]): HardToFillFactor[] {
  return raw.map((f) => ({
    factor: f.factor,
    weight: round3(f.weight),
    value: round3(f.value),
    contribution: round3(f.contribution),
    basis: f.basis,
    ...(f.familyKey !== undefined ? { familyKey: f.familyKey } : {}),
    ...(f.familyMedianDaysOpen !== undefined ? { familyMedianDaysOpen: f.familyMedianDaysOpen } : {}),
    ...(f.globalMedianDaysOpen !== undefined ? { globalMedianDaysOpen: f.globalMedianDaysOpen } : {}),
    ...(f.capacitySource !== undefined ? { capacitySource: f.capacitySource } : {}),
    ...(f.matchedEmployerName !== undefined ? { matchedEmployerName: f.matchedEmployerName } : {}),
    ...(f.eventDate !== undefined ? { eventDate: f.eventDate } : {}),
    ...(f.recencyExcluded !== undefined ? { recencyExcluded: f.recencyExcluded } : {}),
  }));
}

// Reason strings are derived from the same factors array, not recomputed
// independently. S-23 (criterion 3): the roleScarcity reason always names
// its basis when it has one -- "measured" or "curated" -- so a reader never
// has to guess which evidence produced the score. When basis is "none" (no
// curated match, or a signal ineligible for measured with no curated match
// either -- including every Lever-sourced signal that isn't independently a
// curated match), roleScarcity stays silent, same convention this factor and
// repostedRole already used for a zero contribution before this story.
function factorsToReasons(signal: MarketSignal, factors: HardToFillFactor[]): string[] {
  const reasons: string[] = [];

  const roleScarcity = factors.find((f) => f.factor === "roleScarcity");
  if (roleScarcity?.basis === "measured") {
    reasons.push(
      `role scarcity: measured (family '${roleScarcity.familyKey}', median ${roleScarcity.familyMedianDaysOpen}d vs global ${roleScarcity.globalMedianDaysOpen}d)`,
    );
  } else if (roleScarcity?.basis === "curated") {
    reasons.push("role scarcity: curated (matched decision-026 keyword)");
  }

  reasons.push(`open ${signal.daysOpen} day${signal.daysOpen === 1 ? "" : "s"}`);

  const repostedRole = factors.find((f) => f.factor === "repostedRole");
  if (repostedRole && repostedRole.contribution > 0) reasons.push("reposted role");

  // S-24 acceptance criterion 1: names the real source explicitly. A real
  // match outside the recency window still gets a line -- naming the real
  // date and why it doesn't count -- rather than staying silent the way
  // "none" does, so a recency-zeroed match is never confused with "no
  // capacity evidence was ever found" (06_decisions/047).
  const capacitySignal = factors.find((f) => f.factor === "capacitySignal");
  if (capacitySignal && (capacitySignal.basis === "measured" || capacitySignal.basis === "curated")) {
    const label = sourceLabel(capacitySignal.capacitySource ?? "");
    const confidenceWord = capacitySignal.basis === "measured" ? "high-confidence" : "low-confidence";
    const base = `capacity: ${label} matched (${capacitySignal.matchedEmployerName}), ${confidenceWord}`;
    reasons.push(
      capacitySignal.recencyExcluded
        ? `${base} — excluded, ${capacitySignal.eventDate ? `dated ${capacitySignal.eventDate}` : "date unknown"} is older than the ${CAPACITY_SIGNAL_CONFIG.recencyMonths}-month recency window`
        : `${base}${capacitySignal.eventDate ? `, dated ${capacitySignal.eventDate}` : ""}`,
    );
  }

  return reasons;
}

/**
 * Transparent weighted sum over HARD_TO_FILL_CONFIG — a separate,
 * explainable fill-difficulty score. Answers a different question than
 * confidenceScore.ts ("how hard is this role to fill" vs. "is this posting
 * real evidence of hiring demand"), so it stays its own function rather
 * than a fourth factor on scoreSignal() — the "one place per score"
 * discipline from S-07. No factor here is invented; every weight traces
 * back to the PROPOSED config, pending Ali.
 *
 * S-23: `familyScarcity` is optional and, when passed, is a lookup table
 * computed ONCE per scoring run (computeFamilyScarcity in familyScarcity.ts)
 * and reused across every signal in that run -- this function stays
 * synchronous and DB-free, same as before. Omitting it (every existing
 * caller and unit test that predates this story) reproduces the exact
 * pre-S-23 curated-only behavior: roleScarcity can never be "measured"
 * without a family_scarcity lookup to measure against.
 *
 * S-24: `capacitySignalLookup` is the same shape of optional, once-per-run
 * lookup (computeCapacitySignalLookup in capacitySignal.ts). Omitting it
 * makes capacitySignal always resolve to basis "none", value 0 -- every
 * existing caller/test that predates this story keeps compiling and keeps
 * its exact prior score (capacitySignal's weight contributes 0, same as if
 * the factor didn't exist).
 */
export function hardToFillScore(
  signal: MarketSignal,
  familyScarcity?: FamilyScarcityLookup,
  capacitySignalLookup?: CapacitySignalLookup,
): HardToFillResult {
  const raw = buildRawFactors(signal, familyScarcity, capacitySignalLookup);
  const score = round3(raw.reduce((sum, f) => sum + f.contribution, 0));
  const factors = toDisplayFactors(raw);
  const reasons = factorsToReasons(signal, factors);

  return { score, reasons, factors, version: HARD_TO_FILL_CONFIG.version };
}
