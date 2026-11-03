// Display-only helpers for the "basis" shown on Overview, Signals and Clients
// (06_decisions/051-none-basis-fallthrough.md, PROPOSED).
//
// These screens used to RE-DERIVE each posting's role-scarcity basis in the
// browser (basisDerivation.ts: summarizeBasis / effectiveBasis), while the
// Opportunities cards show the basis STORED on the row by the last scoring
// run. The two disagreed (180 vs 155 "measured" on the demo data). They now
// all show the stored value.
//
// Nothing here classifies, scores or changes a rule: it only READS the
// roleScarcity factor's saved `basis` through basisDerivation's existing
// storedRoleScarcityBasis(), exactly as OpportunitiesList's opportunityBasis()
// does. Anything other than a stored "measured"/"curated" reads as "none".

import { storedRoleScarcityBasis, type BasisOpportunity, type BasisSummary } from "./basisDerivation";

export type StoredBasis = "measured" | "curated" | "none";

export function storedBasisOf(opportunity: BasisOpportunity): StoredBasis {
  const stored = storedRoleScarcityBasis(opportunity);
  return stored === "measured" || stored === "curated" ? stored : "none";
}

export function summarizeStoredBasis(opportunities: BasisOpportunity[]): BasisSummary {
  let measured = 0;
  let curated = 0;
  let none = 0;
  for (const opportunity of opportunities) {
    const basis = storedBasisOf(opportunity);
    if (basis === "measured") measured += 1;
    else if (basis === "curated") curated += 1;
    else none += 1;
  }
  return { measured, curated, none, total: opportunities.length };
}

export const BASIS_AS_STORED_TOOLTIP =
  "Basis as stored: the value saved on each posting the last time it was scored. It is the same value shown on every Opportunities card.";
