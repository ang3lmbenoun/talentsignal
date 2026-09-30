import { describe, expect, it } from "vitest";
import { computeFitScore, type FitOpportunityInput } from "../src/matching/fitScore";
import { computeRecommendation, type TopFitCandidate } from "../src/matching/recommendations";

function opp(overrides: Partial<FitOpportunityInput> = {}): FitOpportunityInput {
  return {
    requiredSkills: ["SQL", "Python", "dbt", "Airflow"],
    requiredYears: null,
    roleFamily: "data-analytics",
    ...overrides,
  };
}

function topFit(
  opportunity: FitOpportunityInput,
  overrides: { candidateId: string; skills: string[]; yearsExperience: number | null; roleFamily?: string | null; availability?: string | null },
): TopFitCandidate {
  const result = computeFitScore(opportunity, {
    skills: overrides.skills,
    yearsExperience: overrides.yearsExperience,
    roleFamily: overrides.roleFamily ?? opportunity.roleFamily,
    availability: overrides.availability ?? "immediate",
  });
  return { candidateId: overrides.candidateId, yearsExperience: overrides.yearsExperience, result };
}

describe("computeRecommendation", () => {
  it("strong_match / no_action: top fit >= 85% suggests nothing to edit", () => {
    const opportunity = opp();
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL", "Python", "dbt", "Airflow"], yearsExperience: 5 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("no_action");
    expect(rec.suggestedEdits).toBeNull();
    expect(rec.message).toContain("no JD or pool changes");
  });

  it("loosen_years: top candidates' real years are significantly below a known requirement", () => {
    const opportunity = opp({ requiredYears: 15 });
    // 2 years avg vs 15 required -- gap (13) far exceeds 40% of 15 (6).
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL", "Python"], yearsExperience: 2 }),
      topFit(opportunity, { candidateId: "c-2", skills: ["SQL"], yearsExperience: 2 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("loosen_years");
    expect(rec.suggestedEdits).toEqual({ required_years_from: 15, required_years_to: 2 });
    expect(rec.message).toContain("15-year requirement");
  });

  it("does not recommend loosen_years when requiredYears is unknown (the real, common case)", () => {
    const opportunity = opp({ requiredYears: null });
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL"], yearsExperience: 1 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).not.toBe("loosen_years");
  });

  it("loosen_skills: top candidates match most but not all required skills (pool not thin)", () => {
    const opportunity = opp();
    // 3+ real candidates (pool not thin), each a partial (not full, not
    // near-zero) overlap -- the loosen_skills condition, not add_candidates.
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL", "Python", "dbt"], yearsExperience: 5 }),
      topFit(opportunity, { candidateId: "c-2", skills: ["SQL", "Python"], yearsExperience: 4 }),
      topFit(opportunity, { candidateId: "c-3", skills: ["SQL", "dbt"], yearsExperience: 6 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("loosen_skills");
    // Union of what's missing across the whole considered pool, not just
    // the top candidate's own gap -- c-1 is missing Airflow, c-2 is missing
    // dbt+Airflow, c-3 is missing Python+Airflow.
    expect(rec.suggestedEdits).toEqual({ missing_skills: ["Airflow", "Python", "dbt"] });
  });

  it("add_candidates: top candidates match well but the real pool is thin", () => {
    const opportunity = opp();
    // Only 1 real (measured) candidate, but it's a solid 0.75+ overlap.
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL", "Python", "dbt"], yearsExperience: 5 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("add_candidates");
    expect(rec.suggestedEdits).toEqual({ role_family_hint: "data-analytics", skill_hint: opportunity.requiredSkills });
  });

  it("add_candidates: falls back honestly when there are no real (measured) candidates at all", () => {
    const opportunity = opp();
    const candidates: TopFitCandidate[] = [
      topFit(opportunity, { candidateId: "c-1", skills: [], yearsExperience: null }), // insufficient_data
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("add_candidates");
    expect(rec.message).toContain("No candidates with a real fit score");
  });

  it("add_candidates: falls back when the best real match has essentially no skill overlap", () => {
    const opportunity = opp();
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["Welding", "Forklift"], yearsExperience: 5 }),
      topFit(opportunity, { candidateId: "c-2", skills: ["Retail"], yearsExperience: 3 }),
      topFit(opportunity, { candidateId: "c-3", skills: ["Merchandising"], yearsExperience: 2 }),
    ];
    const rec = computeRecommendation(opportunity, candidates);
    expect(rec.kind).toBe("add_candidates");
    expect(rec.message).toContain("little real overlap");
  });

  it("is deterministic: the same inputs always produce the same recommendation", () => {
    const opportunity = opp();
    const candidates = [
      topFit(opportunity, { candidateId: "c-1", skills: ["SQL", "Python", "dbt"], yearsExperience: 5 }),
      topFit(opportunity, { candidateId: "c-2", skills: ["SQL", "Python"], yearsExperience: 4 }),
    ];
    const a = computeRecommendation(opportunity, candidates);
    const b = computeRecommendation(opportunity, candidates);
    expect(a).toEqual(b);
  });
});
