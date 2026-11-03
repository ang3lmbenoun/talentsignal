// Plain-language text for the opportunity cards. PRESENTATION ONLY: every
// sentence below is assembled from facts the card already has (days open, the
// reasons the backend wrote, the stored role-scarcity basis, the factor
// contributions). Nothing here scores, ranks, filters or adds a threshold.

export type EvidenceBasis = "measured" | "curated" | "none";

export interface VerdictInput {
  // Parsed from the backend reason text ("open 24 days"); undefined when no
  // reason names it (never guessed).
  daysOpen: number | undefined;
  reasons: string[];
  hardToFill: boolean;
  basis: EvidenceBasis;
  // True when a "capacity:" reason (public employer hiring record) is present.
  capacityEvidence: boolean;
}

// "a", "a and b", "a, b and c"
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One plain sentence, e.g.
 *   "Open 191 days with no salary posted, so this is worth a closer look."
 *
 * Wording note: the phrase "hard to fill" (with spaces) is only ever used
 * when the posting really is flagged hard-to-fill, so an un-flagged card never
 * implies that flag.
 */
export function buildVerdict(input: VerdictInput): string {
  const { daysOpen, reasons, hardToFill, basis, capacityEvidence } = input;
  const facts: string[] = [];
  if (reasons.some((r) => r.includes("no salary range"))) facts.push("no salary posted");
  if (reasons.some((r) => r.includes("reposted"))) facts.push("a previous repost");
  if (basis === "measured") facts.push("a role type that usually stays open longer than most");
  else if (basis === "curated") facts.push("a role type our team has marked as scarce");
  if (capacityEvidence) facts.push("a matching public employer hiring record");

  const flaggedSuffix = hardToFill ? " It is also flagged as a role that may be hard to fill." : "";

  if (facts.length === 0 && !hardToFill) {
    return daysOpen !== undefined
      ? `Open ${daysOpen.toLocaleString()} days, with no repost, missing salary range or role-type clue in the loaded data.`
      : "No repost, missing salary range or role-type clue was found for this posting in the loaded data.";
  }

  const head = daysOpen !== undefined ? `Open ${daysOpen.toLocaleString()} days` : "This posting";
  const body =
    facts.length === 0 ? "" : daysOpen !== undefined ? ` with ${joinWithAnd(facts)}` : ` has ${joinWithAnd(facts)}`;
  return `${head}${body}, so this is worth a closer look.${flaggedSuffix}`;
}

// ---- factor wording -------------------------------------------------------

export interface FactorLike {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
  basis?: string;
}

interface FactorInfo {
  label: string;
  meaning: string;
  // Used by "What would change this": the thing that, if different, would
  // lower this factor's contribution.
  change: string;
}

const FACTOR_INFO: Record<string, FactorInfo> = {
  baseScore: {
    label: "Active posting",
    meaning: "A confirmed, open posting is already evidence that a company is spending money to hire.",
    change: "",
  },
  daysOpen: {
    label: "Time open",
    meaning: "The longer a posting stays open, the stronger the sign that it is hard to fill.",
    change: "the posting being filled or closed",
  },
  repostedRole: {
    label: "Reposted",
    meaning: "A role that is posted again can mean the first attempt did not work out.",
    change: "the role not being reposted",
  },
  missingSalaryRange: {
    label: "No salary range",
    meaning: "With no salary range listed, it is harder to line candidates up for the role.",
    change: "a salary range being added",
  },
  roleScarcity: {
    label: "Role type",
    meaning: "Some role types are harder to hire for. This reflects how scarce this role type looks.",
    change: "a different role type, or more live postings to compare against",
  },
  capacitySignal: {
    label: "Employer hiring record",
    meaning: "A public record of this employer's hiring activity matched the company.",
    change: "the hiring record being checked and found out of date",
  },
};

function humanize(factor: string): string {
  const spaced = factor.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function factorLabel(factor: string): string {
  return FACTOR_INFO[factor]?.label ?? humanize(factor);
}

export function factorMeaning(factor: string): string {
  return FACTOR_INFO[factor]?.meaning ?? "One of the inputs to this score.";
}

/**
 * How much a factor moved the score, in words. Ranking among the factors, not
 * a numeric cut-off (a new threshold would be a business decision):
 * "Largest signal", "Second signal", "Smaller signal", or "Not present".
 */
export function contributionWords(factor: FactorLike, all: FactorLike[]): string {
  if (!(factor.contribution > 0)) return "Not present in this posting";
  const ranked = all.filter((f) => f.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const rank = ranked.findIndex((f) => f.factor === factor.factor);
  if (rank === 0) return "Largest signal";
  if (rank === 1) return "Second signal";
  return "Smaller signal";
}

/**
 * "What would change this": built from the factors that are currently adding
 * to the score. Presentation text only, it does not recompute anything.
 */
export function buildWhatWouldChange(factors: FactorLike[]): string {
  const changes: string[] = [];
  for (const f of factors) {
    if (!(f.contribution > 0)) continue;
    const change = FACTOR_INFO[f.factor]?.change;
    if (change && !changes.includes(change)) changes.push(change);
  }
  if (changes.length === 0) {
    return "No single clue stands out. New posting data would update this.";
  }
  return `This would change with ${joinWithAnd(changes)}.`;
}
