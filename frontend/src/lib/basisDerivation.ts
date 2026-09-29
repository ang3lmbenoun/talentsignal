// Shared with SignalsScreen.tsx and OverviewScreen.tsx (06_decisions/049).
//
// Production's opportunities table is 100% still hard-to-fill-026-v1 --
// S-23's rescore/backfill (which stamps family_key and roleScarcity's
// basis) was never run against it. Rather than show a dashboard that's
// honestly-but-uselessly all-zero, this ports the exact same pure,
// already-Ali-approved classification/scarcity logic backend/src/scoring/
// hardToFillScore.ts and familyScarcity.ts already use (decision 046), and
// runs it client-side against the real title/source/daysOpen fields the API
// already returns -- a real derivation from real data, not an invented
// number. It prefers a row's own real familyKey/basis whenever one is
// already present (e.g. once production is eventually rescored).

export interface ScoreFactor {
  factor: string;
  basis?: string;
}

export interface BasisOpportunity {
  id: string;
  title: string;
  source: string;
  reasons: string[];
  hardToFillReasons?: string[];
  hardToFillFactors?: ScoreFactor[];
  familyKey?: string | null;
  daysOpen?: number;
}

export const ROLE_FAMILIES: Record<string, string[]> = {
  "engineering-swe": ["software engineer", "backend engineer", "frontend engineer", "full stack", "fullstack"],
  "ml-ai": ["ai engineer", "ai architect", "machine learning", "ml engineer", "artificial intelligence", "ai"],
  "data-analytics": ["data analyst", "data scientist", "data engineer", "data science"],
  security: ["security", "cybersecurity"],
  "cloud-infra": ["cloud architect", "cloud engineer", "infrastructure", "site reliability", "devops"],
  "support-cs": ["support engineer", "customer success", "help desk", "desktop support", "solutions architect"],
  "sales-bizdev": ["account executive", "business development", "sales"],
  "retail-ops": ["store associate", "key holder", "store manager", "operations associate", "forklift", "warehouse"],
};

export const ROLE_KEYWORDS = [
  "data analyst",
  "data scientist",
  "ai architect",
  "ai engineer",
  "ml engineer",
  "machine learning engineer",
  "data engineer",
  "cybersecurity",
  "security engineer",
  "cloud architect",
];

export const FAMILY_OBSERVATION_THRESHOLD = 10;
export const MEASURED_ELIGIBLE_SOURCES = ["greenhouse"];

function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function matchesAnyKeyword(title: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(title);
  return keywords.some((keyword) => normalized.includes(` ${normalizeForMatch(keyword).trim()} `));
}

export function matchesScarceRole(title: string): boolean {
  return matchesAnyKeyword(title, ROLE_KEYWORDS);
}

export function classifyFamily(title: string): string {
  const entries = Object.entries(ROLE_FAMILIES);
  const isSpecific = (keyword: string) => keyword.trim().includes(" ");
  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter(isSpecific))) return familyKey;
  }
  for (const [familyKey, keywords] of entries) {
    if (matchesAnyKeyword(title, keywords.filter((k) => !isSpecific(k)))) return familyKey;
  }
  return "general-other";
}

export function effectiveFamily(o: BasisOpportunity): string {
  return o.familyKey ?? classifyFamily(o.title);
}

// Duplicated from OpportunitiesList.tsx (decision 048) rather than shared --
// that file is off-limits to edit for this pass. Opportunity has no
// structured day-count field -- this pulls the real number out of the
// backend-built reason text ("open 24 days"), and returns undefined (never
// a guess) when no reason names it.
export function extractDaysOpen(opportunity: BasisOpportunity): number | undefined {
  const candidates = [...opportunity.reasons, ...(opportunity.hardToFillReasons ?? [])];
  for (const reason of candidates) {
    const match = /open (\d+) days?/i.exec(reason);
    if (match) return Number(match[1]);
  }
  return undefined;
}

// roleScarcity is the only factor that ever carries a basis (S-23) -- real
// field when present. Every live row is currently pre-S-23 (v1), so this
// always falls through to undefined today -- callers combine it with the
// derived basis below rather than relying on it alone.
export function storedRoleScarcityBasis(opportunity: BasisOpportunity): string | undefined {
  const factor = opportunity.hardToFillFactors?.find((f) => f.factor === "roleScarcity");
  return factor?.basis && factor.basis !== "n/a" ? factor.basis : undefined;
}

// Real per-family Greenhouse median eligibility, computed the same way
// familyScarcity.ts does on the backend (Greenhouse-only, general-other
// excluded, real daysOpen field) -- from the real data this API already
// returns, not a stored (currently-unpopulated) column.
export function computeMeasuredEligibleFamilies(opportunities: BasisOpportunity[]): Set<string> {
  const greenhouseDaysByFamily = new Map<string, number[]>();
  for (const o of opportunities) {
    if (o.source !== "greenhouse" || o.daysOpen === undefined) continue;
    const family = effectiveFamily(o);
    if (family === "general-other") continue;
    if (!greenhouseDaysByFamily.has(family)) greenhouseDaysByFamily.set(family, []);
    greenhouseDaysByFamily.get(family)?.push(o.daysOpen);
  }
  return new Set(
    [...greenhouseDaysByFamily.entries()]
      .filter(([, days]) => days.length >= FAMILY_OBSERVATION_THRESHOLD)
      .map(([family]) => family),
  );
}

// Prefers a row's own real, stored basis (once production is eventually
// rescored under S-23) before falling back to the same derivation
// hardToFillScore.ts's resolveRoleScarcity uses.
export function effectiveBasis(
  o: BasisOpportunity,
  measuredEligibleFamilies: Set<string>,
): "measured" | "curated" | "none" {
  const stored = storedRoleScarcityBasis(o);
  if (stored === "measured" || stored === "curated") return stored;
  const family = effectiveFamily(o);
  if (MEASURED_ELIGIBLE_SOURCES.includes(o.source) && measuredEligibleFamilies.has(family)) return "measured";
  return matchesScarceRole(o.title) ? "curated" : "none";
}

export interface BasisSummary {
  measured: number;
  curated: number;
  none: number;
  total: number;
}

// Convenience wrapper for callers (Overview) that only need the aggregate
// counts, not the intermediate per-row classification other panels
// (Signals' role-family distribution, source health) also need.
export function summarizeBasis(opportunities: BasisOpportunity[]): BasisSummary {
  const measuredEligibleFamilies = computeMeasuredEligibleFamilies(opportunities);
  let measured = 0;
  let curated = 0;
  let none = 0;
  for (const o of opportunities) {
    const basis = effectiveBasis(o, measuredEligibleFamilies);
    if (basis === "measured") measured += 1;
    else if (basis === "curated") curated += 1;
    else none += 1;
  }
  return { measured, curated, none, total: opportunities.length };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export interface SourceHealth {
  source: string;
  count: number;
  medianDaysOpen: number;
  verdict: "healthy" | "fixture" | "flagged — excluded";
}

// Verdict: "healthy" for a source that's on decision 046's real, documented
// measured-eligible allowlist (today just Greenhouse) or that otherwise has
// at least one measured row; the seed fixture reads "fixture"; everything
// else (e.g. Lever, per decision 046's Lever-exclusion finding) reads
// "flagged — excluded". Not hardcoded to a company name -- the allowlist
// itself is the same one hardToFillConfig.ts declares.
export function computeSourceHealth(opportunities: BasisOpportunity[]): SourceHealth[] {
  const measuredEligibleFamilies = computeMeasuredEligibleFamilies(opportunities);
  const bySource = new Map<string, number[]>();
  const measuredSources = new Set<string>();
  for (const o of opportunities) {
    const daysOpen = extractDaysOpen(o);
    if (daysOpen !== undefined) {
      if (!bySource.has(o.source)) bySource.set(o.source, []);
      bySource.get(o.source)?.push(daysOpen);
    }
    if (effectiveBasis(o, measuredEligibleFamilies) === "measured") measuredSources.add(o.source);
  }
  return [...bySource.entries()].map(([source, days]) => ({
    source,
    count: days.length,
    medianDaysOpen: median(days),
    verdict:
      source === "seed-job-board"
        ? "fixture"
        : MEASURED_ELIGIBLE_SOURCES.includes(source) || measuredSources.has(source)
          ? "healthy"
          : "flagged — excluded",
  }));
}

export interface SignalInstanceCounts {
  reposted: number;
  longOpen: number;
  veryStale: number;
  noSalaryRange: number;
  total: number;
}

// The same four real-field predicates SignalsScreen's hero total already
// sums (reposted, long-open >= 54d, very-stale >= 365d, no salary range) --
// shared here so Overview's "Total signals" tile and story panel can never
// drift from Signals' own hero number.
export function computeSignalInstanceCounts(opportunities: BasisOpportunity[]): SignalInstanceCounts {
  let reposted = 0;
  let longOpen = 0;
  let veryStale = 0;
  let noSalaryRange = 0;
  for (const o of opportunities) {
    if (o.reasons.some((r) => r.includes("reposted"))) reposted += 1;
    if (o.reasons.some((r) => r.includes("no salary range"))) noSalaryRange += 1;
    const daysOpen = extractDaysOpen(o);
    if (daysOpen !== undefined && daysOpen >= 54) longOpen += 1;
    if (daysOpen !== undefined && daysOpen >= 365) veryStale += 1;
  }
  return { reposted, longOpen, veryStale, noSalaryRange, total: reposted + longOpen + veryStale + noSalaryRange };
}
