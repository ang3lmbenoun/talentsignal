import type { FitOpportunityInput, FitResult } from "./fitScore";

/**
 * S-30a recommendation engine. PROPOSED thresholds — see 06_decisions/057;
 * Ali must approve before these are marked non-PROPOSED. Pure function,
 * same heuristic-first discipline as computeFitScore() (decision 056): no
 * I/O, no randomness, same inputs always produce the same recommendation.
 */

export type RecommendationKind = "loosen_years" | "loosen_skills" | "add_candidates" | "no_action";

export interface Recommendation {
  kind: RecommendationKind;
  message: string;
  // null for no_action (nothing to suggest editing) -- never an empty
  // object standing in for "no edit," which would be ambiguous with "edit
  // to nothing."
  suggestedEdits: Record<string, unknown> | null;
}

// A fit result plus the one piece of raw candidate data this engine needs
// that FitResult's normalized [0,1] yearsMatch factor can't reconstruct on
// its own (the factor's *value* says how close a candidate is to
// requiredYears, but not whether they're above or below it). Route-level
// callers already have both pieces from the same candidates query
// fitScore.ts's own caller (fits.ts) already runs.
export interface TopFitCandidate {
  candidateId: string;
  yearsExperience: number | null;
  result: FitResult;
}

const STRONG_MATCH_THRESHOLD = 0.85;
// A candidate pool is "thin" below this many real (basis: 'measured')
// candidates considered for this opportunity -- not the total candidates
// table, just how many actually produced a real, non-insufficient-data
// score for THIS opportunity's required skills.
const THIN_POOL_THRESHOLD = 3;
// "Match well" floor for add_candidates: the existing thin pool's best
// candidate is already a real, decent fit (skills genuinely overlap) -- the
// problem is there simply aren't enough of them, not that the JD is wrong.
const MATCHES_WELL_THRESHOLD = 0.5;
// A top candidate's years are "significantly below required" once the gap
// exceeds this fraction of the requirement itself (matches fitScore.ts's
// own linear-cap denominator, so "significant" here means the same scale
// that already zeroes out yearsMatch's contribution).
const YEARS_GAP_SIGNIFICANT_RATIO = 0.4;
// "Most but not all" required skills matched, for loosen_skills -- below
// this, there's arguably no real skill foundation to build outreach on at
// all (closer to "wrong role entirely" than "JD slightly too strict"), so
// this engine doesn't suggest loosening the JD for a near-zero overlap.
const PARTIAL_SKILL_OVERLAP_FLOOR = 0.3;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function skillOverlapValue(result: FitResult): number | null {
  const factor = result.factors.find((f) => f.factor === "skillOverlap");
  return factor ? factor.value : null;
}

function missingSkillsAcrossPool(topFits: TopFitCandidate[]): string[] {
  const missing = new Set<string>();
  for (const { result } of topFits) {
    const factor = result.factors.find((f) => f.factor === "skillOverlap");
    for (const skill of factor?.missingSkills ?? []) missing.add(skill);
  }
  return [...missing].sort();
}

/**
 * Real gap worth naming up front: requiredYears has no source anywhere in
 * the real schema (decision 056), so every call through the real
 * /api/opportunities/:id/recommendation route passes requiredYears: null --
 * loosen_years can only ever fire when a caller genuinely has a real
 * requiredYears (this function's own unit tests supply one directly). This
 * is the same honest degradation fitScore.ts already accepted, not a bug.
 */
export function computeRecommendation(
  opportunity: FitOpportunityInput,
  topFits: TopFitCandidate[],
): Recommendation {
  const measured = topFits.filter((f) => f.result.basis === "measured");
  const best = measured[0];

  if (best && best.result.score >= STRONG_MATCH_THRESHOLD) {
    return {
      kind: "no_action",
      message: `Top candidate already scores ${Math.round(best.result.score * 100)}% fit — no JD or pool changes suggested.`,
      suggestedEdits: null,
    };
  }

  // loosen_years: only evaluable when both the opportunity's requirement
  // and at least one top candidate's real years are known.
  if (opportunity.requiredYears !== null && opportunity.requiredYears > 0) {
    const topYears = measured
      .slice(0, 5)
      .map((f) => f.yearsExperience)
      .filter((y): y is number => y !== null);
    const avgTopYears = average(topYears);
    if (avgTopYears !== null) {
      const gap = opportunity.requiredYears - avgTopYears;
      if (gap > opportunity.requiredYears * YEARS_GAP_SIGNIFICANT_RATIO) {
        const suggestedTo = Math.max(0, Math.round(avgTopYears));
        return {
          kind: "loosen_years",
          message: `Top candidates average ${Math.round(avgTopYears)} years against a ${opportunity.requiredYears}-year requirement — consider lowering the required years to match who's actually available.`,
          suggestedEdits: { required_years_from: opportunity.requiredYears, required_years_to: suggestedTo },
        };
      }
    }
  }

  // add_candidates: the pool of real (measured) candidates is thin, but
  // whoever IS in it already matches reasonably well -- more outreach to
  // find similar candidates is the fix, not loosening the JD.
  if (measured.length < THIN_POOL_THRESHOLD && (best?.result.score ?? 0) >= MATCHES_WELL_THRESHOLD) {
    return {
      kind: "add_candidates",
      message: `Only ${measured.length} candidate${measured.length === 1 ? "" : "s"} with a real fit score for this role — the best match is already decent, so sourcing more candidates like them is likely to help more than editing the JD.`,
      suggestedEdits: {
        role_family_hint: opportunity.roleFamily,
        skill_hint: opportunity.requiredSkills ?? [],
      },
    };
  }

  // loosen_skills: the default read when there's a real, partial skill
  // foundation to build on (not a strong match, not a years problem, not
  // simply too few candidates).
  const topOverlap = best ? skillOverlapValue(best.result) : null;
  if (
    topOverlap !== null &&
    topOverlap >= PARTIAL_SKILL_OVERLAP_FLOOR &&
    topOverlap < 1 &&
    measured.length > 0
  ) {
    const missingSkills = missingSkillsAcrossPool(measured.slice(0, 5));
    return {
      kind: "loosen_skills",
      message: `Top candidates match most but not all required skills — ${missingSkills.length > 0 ? `${missingSkills.join(", ")} ${missingSkills.length === 1 ? "is" : "are"} the most commonly missing` : "some required skills are missing across the pool"}. Consider dropping the least-critical ones from the JD.`,
      suggestedEdits: { missing_skills: missingSkills },
    };
  }

  // Fallback: no real candidates at all, or the best real match has
  // essentially no skill overlap -- honest default is "go find candidates,"
  // the same recommendation a completely empty pool gets.
  return {
    kind: "add_candidates",
    message:
      measured.length === 0
        ? "No candidates with a real fit score for this role yet — source candidates before considering any JD changes."
        : "Existing candidates show little real overlap with this role — sourcing candidates closer to the required skills is likely to help more than editing the JD.",
    suggestedEdits: {
      role_family_hint: opportunity.roleFamily,
      skill_hint: opportunity.requiredSkills ?? [],
    },
  };
}
