/**
 * S-28 fit-scoring engine. PROPOSED weights — see 06_decisions/056; Ali must
 * approve before these are marked non-PROPOSED. Pure function, same
 * heuristic-first discipline as scoreCandidate() (matchScore.ts, decision
 * 011): no I/O, no randomness, same opportunity + candidate always produces
 * the same result.
 *
 * A real schema gap this function has to live with: `opportunities` (the
 * ATS-scraped market-signal rows) has no `required_skills` or
 * `required_years` column — only `job_openings` (CRM-created postings) has
 * a real `requirements: string[]`, and decision 015 deliberately refused to
 * invent a foreign key between the two. Callers (the /api/opportunities/:id/fits
 * route) are responsible for sourcing `requiredSkills` honestly — see that
 * route's own comment for how it reuses roleSkillsConfig.ts's
 * requirementsForTitle() bridge (decision 027) rather than fabricating a
 * number. This function itself only ever trusts what it's given.
 */

export interface FitOpportunityInput {
  // Empty/undefined/null => insufficient_data (never a guessed overlap).
  requiredSkills: string[] | null | undefined;
  // null => genuinely unknown (no real "required years" field exists
  // anywhere in this app's schema today) -- yearsMatch is excluded and the
  // other three factors' weights are renormalized to sum to 1.0, rather
  // than fabricating a number or silently docking 20% of every score for a
  // dimension nothing can ever supply. See 06_decisions/056.
  requiredYears: number | null;
  roleFamily: string | null;
}

export interface FitCandidateInput {
  // Empty/undefined/null => insufficient_data (never a guessed overlap).
  skills: string[] | null | undefined;
  yearsExperience: number | null;
  roleFamily: string | null;
  availability: string | null;
}

export type FitFactorName = "skillOverlap" | "yearsMatch" | "roleFamily" | "availabilityMatch";

export interface FitFactor {
  factor: FitFactorName;
  weight: number;
  value: number;
  contribution: number;
  // Only present on skillOverlap -- the real skills that drove the value,
  // same "no hidden inputs" discipline HardToFillFactor already follows.
  matchedSkills?: string[];
  missingSkills?: string[];
}

export type FitBasis = "measured" | "insufficient_data";

export interface FitResult {
  score: number;
  factors: FitFactor[];
  basis: FitBasis;
}

const WEIGHTS = {
  skillOverlap: 0.5,
  yearsMatch: 0.2,
  roleFamily: 0.2,
  availabilityMatch: 0.1,
};

// Ali-specified bands (task request, pending confirmation in decision 056).
const AVAILABILITY_SCORES: Record<string, number> = {
  immediate: 1.0,
  "2_weeks": 0.7,
  "1_month": 0.4,
  passive: 0.1,
};

function normalize(term: string): string {
  return term.trim().toLowerCase();
}

function hasRealSkills(skills: string[] | null | undefined): skills is string[] {
  return Array.isArray(skills) && skills.length > 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function computeSkillOverlap(
  requiredSkills: string[],
  candidateSkills: string[],
): { value: number; matchedSkills: string[]; missingSkills: string[] } {
  const candidateSet = new Set(candidateSkills.map(normalize));
  const originalCasing = new Map<string, string>();
  for (const skill of requiredSkills) {
    const key = normalize(skill);
    if (!originalCasing.has(key)) originalCasing.set(key, skill);
  }

  const matchedKeys = [...new Set(requiredSkills.map(normalize))].filter((key) => candidateSet.has(key));
  const allRequiredKeys = [...new Set(requiredSkills.map(normalize))];
  const missingKeys = allRequiredKeys.filter((key) => !candidateSet.has(key));

  return {
    value: matchedKeys.length / allRequiredKeys.length,
    matchedSkills: matchedKeys.map((key) => originalCasing.get(key) ?? key),
    missingSkills: missingKeys.map((key) => originalCasing.get(key) ?? key),
  };
}

// Linear, capped at [0, 1]: an exact match scores 1.0, and the score falls
// off linearly as candidate years diverge from required years in either
// direction, capped at 0 once the gap equals or exceeds requiredYears
// itself (e.g. 10 years required, 0 or 20+ years actual, both score 0).
function computeYearsMatch(requiredYears: number, candidateYears: number): number {
  if (requiredYears <= 0) return 1;
  const diff = Math.abs(candidateYears - requiredYears);
  return Math.max(0, Math.min(1, 1 - diff / requiredYears));
}

export function computeFitScore(opportunity: FitOpportunityInput, candidate: FitCandidateInput): FitResult {
  if (!hasRealSkills(opportunity.requiredSkills) || !hasRealSkills(candidate.skills)) {
    return { score: 0, factors: [], basis: "insufficient_data" };
  }

  const skillOverlap = computeSkillOverlap(opportunity.requiredSkills, candidate.skills);
  const yearsKnown = opportunity.requiredYears !== null && candidate.yearsExperience !== null;
  const roleFamilyValue =
    opportunity.roleFamily !== null && candidate.roleFamily !== null && opportunity.roleFamily === candidate.roleFamily
      ? 1
      : 0;
  const availabilityValue = candidate.availability ? AVAILABILITY_SCORES[candidate.availability] ?? 0 : 0;

  // Renormalize weights to sum to 1.0 when yearsMatch can't be computed,
  // rather than fabricating a years value or silently docking the score.
  const activeWeights = yearsKnown
    ? WEIGHTS
    : {
        skillOverlap: WEIGHTS.skillOverlap / (1 - WEIGHTS.yearsMatch),
        yearsMatch: 0,
        roleFamily: WEIGHTS.roleFamily / (1 - WEIGHTS.yearsMatch),
        availabilityMatch: WEIGHTS.availabilityMatch / (1 - WEIGHTS.yearsMatch),
      };

  const factors: FitFactor[] = [
    {
      factor: "skillOverlap",
      weight: round3(activeWeights.skillOverlap),
      value: round3(skillOverlap.value),
      contribution: round3(activeWeights.skillOverlap * skillOverlap.value),
      matchedSkills: skillOverlap.matchedSkills,
      missingSkills: skillOverlap.missingSkills,
    },
    {
      factor: "roleFamily",
      weight: round3(activeWeights.roleFamily),
      value: roleFamilyValue,
      contribution: round3(activeWeights.roleFamily * roleFamilyValue),
    },
    {
      factor: "availabilityMatch",
      weight: round3(activeWeights.availabilityMatch),
      value: round3(availabilityValue),
      contribution: round3(activeWeights.availabilityMatch * availabilityValue),
    },
  ];

  if (yearsKnown) {
    const yearsValue = computeYearsMatch(opportunity.requiredYears as number, candidate.yearsExperience as number);
    factors.splice(1, 0, {
      factor: "yearsMatch",
      weight: round3(activeWeights.yearsMatch),
      value: round3(yearsValue),
      contribution: round3(activeWeights.yearsMatch * yearsValue),
    });
  }

  const score = round3(factors.reduce((sum, f) => sum + f.contribution, 0));
  return { score, factors, basis: "measured" };
}
