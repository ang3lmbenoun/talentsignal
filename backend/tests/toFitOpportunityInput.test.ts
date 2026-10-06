import { describe, expect, it } from "vitest";
import { toFitOpportunityInput, type OpportunityRow } from "../src/routes/fits";

function row(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: "opp-1",
    title: "Data Analyst",
    family_key: null,
    required_skills: null,
    required_years: null,
    ...overrides,
  };
}

describe("toFitOpportunityInput (S-30b: saved edit vs. title-derived fallback)", () => {
  it("falls back to the title-derived skills/family when never edited (required_skills/required_years NULL)", () => {
    const input = toFitOpportunityInput(row());
    expect(input.requiredSkills).toEqual(["sql", "python", "data visualization", "statistics", "excel"]);
    expect(input.requiredYears).toBeNull();
    expect(input.roleFamily).toBe("data-analytics");
  });

  it("a saved required_skills edit is authoritative, not merged with or overridden by the title derivation", () => {
    const input = toFitOpportunityInput(row({ required_skills: ["Custom Skill A", "Custom Skill B"] }));
    expect(input.requiredSkills).toEqual(["Custom Skill A", "Custom Skill B"]);
  });

  it("a saved empty required_skills array ([]) is trusted as a real edit, not treated as unset", () => {
    const input = toFitOpportunityInput(row({ required_skills: [] }));
    expect(input.requiredSkills).toEqual([]);
  });

  it("a saved required_years edit is used directly (no derivation exists to fall back to)", () => {
    const input = toFitOpportunityInput(row({ required_years: 8 }));
    expect(input.requiredYears).toBe(8);
  });

  it("family_key still wins over title classification when present, unaffected by the JD editor", () => {
    const input = toFitOpportunityInput(row({ family_key: "engineering-swe" }));
    expect(input.roleFamily).toBe("engineering-swe");
  });
});
