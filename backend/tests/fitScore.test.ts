import { describe, expect, it } from "vitest";
import { computeFitScore, type FitCandidateInput, type FitOpportunityInput } from "../src/matching/fitScore";

function opp(overrides: Partial<FitOpportunityInput> = {}): FitOpportunityInput {
  return {
    requiredSkills: ["SQL", "Python", "dbt"],
    requiredYears: 5,
    roleFamily: "data-analytics",
    ...overrides,
  };
}

function candidate(overrides: Partial<FitCandidateInput> = {}): FitCandidateInput {
  return {
    skills: ["SQL", "Python", "dbt"],
    yearsExperience: 5,
    roleFamily: "data-analytics",
    availability: "immediate",
    ...overrides,
  };
}

describe("computeFitScore", () => {
  it("perfect match: full skill overlap, exact years, matching family, immediate availability -> score 1", () => {
    const result = computeFitScore(opp(), candidate());
    expect(result.basis).toBe("measured");
    expect(result.score).toBe(1);
    const skillFactor = result.factors.find((f) => f.factor === "skillOverlap")!;
    expect(skillFactor.value).toBe(1);
    expect((skillFactor.matchedSkills ?? []).sort()).toEqual(["Python", "SQL", "dbt"].sort());
    expect(skillFactor.missingSkills ?? []).toEqual([]);
  });

  it("zero overlap: no shared skills scores 0 on that factor, real missing-skills list, never a guess", () => {
    const result = computeFitScore(opp(), candidate({ skills: ["Welding", "Forklift"] }));
    const skillFactor = result.factors.find((f) => f.factor === "skillOverlap")!;
    expect(skillFactor.value).toBe(0);
    expect(skillFactor.matchedSkills ?? []).toEqual([]);
    expect((skillFactor.missingSkills ?? []).sort()).toEqual(["Python", "SQL", "dbt"].sort());
    // Still "measured" -- zero overlap is a real, computed result, not missing data.
    expect(result.basis).toBe("measured");
  });

  it("missing skills data: opportunity has no required_skills -> insufficient_data, score 0, never faked", () => {
    const result = computeFitScore(opp({ requiredSkills: [] }), candidate());
    expect(result.basis).toBe("insufficient_data");
    expect(result.score).toBe(0);
    expect(result.factors).toEqual([]);
  });

  it("missing skills data: candidate has no skills -> insufficient_data, score 0, never faked", () => {
    const result = computeFitScore(opp(), candidate({ skills: null }));
    expect(result.basis).toBe("insufficient_data");
    expect(result.score).toBe(0);
  });

  it("missing skills data: opportunity requiredSkills is undefined -> insufficient_data", () => {
    const result = computeFitScore(opp({ requiredSkills: undefined }), candidate());
    expect(result.basis).toBe("insufficient_data");
  });

  it("exact years match scores 1.0 on the yearsMatch factor", () => {
    const result = computeFitScore(opp({ requiredYears: 8 }), candidate({ yearsExperience: 8 }));
    const yearsFactor = result.factors.find((f) => f.factor === "yearsMatch")!;
    expect(yearsFactor.value).toBe(1);
  });

  it("off years match degrades linearly and caps at 0 for a candidate with zero years against a high requirement", () => {
    // 10 required, 5 actual -> diff 5, 1 - 5/10 = 0.5
    const partial = computeFitScore(opp({ requiredYears: 10 }), candidate({ yearsExperience: 5 }));
    const partialYears = partial.factors.find((f) => f.factor === "yearsMatch")!;
    expect(partialYears.value).toBe(0.5);

    // 10 required, 0 actual -> diff 10, 1 - 10/10 = 0, capped at 0
    const zero = computeFitScore(opp({ requiredYears: 10 }), candidate({ yearsExperience: 0 }));
    const zeroYears = zero.factors.find((f) => f.factor === "yearsMatch")!;
    expect(zeroYears.value).toBe(0);

    // 10 required, 25 actual (way over) -> diff 15 > requiredYears, still capped at 0, never negative
    const over = computeFitScore(opp({ requiredYears: 10 }), candidate({ yearsExperience: 25 }));
    const overYears = over.factors.find((f) => f.factor === "yearsMatch")!;
    expect(overYears.value).toBe(0);
  });

  it("omits yearsMatch and renormalizes remaining weights to sum to 1.0 when requiredYears is unknown", () => {
    const result = computeFitScore(opp({ requiredYears: null }), candidate());
    expect(result.factors.some((f) => f.factor === "yearsMatch")).toBe(false);
    const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 5);
    // Full skill overlap + matching family + immediate availability, no years factor -> still scores 1.
    expect(result.score).toBe(1);
  });

  it.each([
    ["immediate", 1.0],
    ["2_weeks", 0.7],
    ["1_month", 0.4],
    ["passive", 0.1],
  ])("availability %s scores %s on the availabilityMatch factor", (availability, expected) => {
    const result = computeFitScore(opp(), candidate({ availability }));
    const availFactor = result.factors.find((f) => f.factor === "availabilityMatch")!;
    expect(availFactor.value).toBe(expected);
  });

  it("an unrecognized or missing availability value scores 0, never a guessed default", () => {
    const result = computeFitScore(opp(), candidate({ availability: null }));
    const availFactor = result.factors.find((f) => f.factor === "availabilityMatch")!;
    expect(availFactor.value).toBe(0);
  });

  it("roleFamily mismatch scores 0 on that factor", () => {
    const result = computeFitScore(opp({ roleFamily: "engineering-swe" }), candidate({ roleFamily: "retail-ops" }));
    const familyFactor = result.factors.find((f) => f.factor === "roleFamily")!;
    expect(familyFactor.value).toBe(0);
  });

  it("is deterministic: the same inputs always produce the same result", () => {
    const a = computeFitScore(opp(), candidate());
    const b = computeFitScore(opp(), candidate());
    expect(a).toEqual(b);
  });
});
