import { describe, expect, it } from "vitest";
import {
  type BasisOpportunity,
  classifyFamily,
  computeMeasuredEligibleFamilies,
  effectiveBasis,
  summarizeBasis,
} from "./basisDerivation";

function makeGreenhouseFamily(family: string, title: string, count: number): BasisOpportunity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${family}-${i}`,
    title,
    source: "greenhouse",
    reasons: [],
    daysOpen: 30 + i,
  }));
}

describe("classifyFamily", () => {
  it("matches a curated-keyword title to its family", () => {
    expect(classifyFamily("Senior Data Scientist")).toBe("data-analytics");
  });

  it("falls back to general-other for an unrecognized title", () => {
    expect(classifyFamily("Regional Manager")).toBe("general-other");
  });
});

describe("effectiveBasis", () => {
  it("is measured for a Greenhouse row in a family that clears the observation threshold", () => {
    const opportunities = makeGreenhouseFamily("data-analytics", "Data Analyst", 10);
    const eligible = computeMeasuredEligibleFamilies(opportunities);
    expect(eligible.has("data-analytics")).toBe(true);
    expect(effectiveBasis(opportunities[0], eligible)).toBe("measured");
  });

  it("is curated for a Greenhouse row below the observation threshold whose title matches the keyword list", () => {
    const opportunities = makeGreenhouseFamily("data-analytics", "Data Analyst", 5);
    const eligible = computeMeasuredEligibleFamilies(opportunities);
    expect(eligible.has("data-analytics")).toBe(false);
    expect(effectiveBasis(opportunities[0], eligible)).toBe("curated");
  });

  it("is curated for a Lever row whose title matches the keyword list (Lever is never measured-eligible)", () => {
    const o: BasisOpportunity = { id: "1", title: "Security Engineer", source: "lever", reasons: [] };
    const eligible = computeMeasuredEligibleFamilies([o]);
    expect(effectiveBasis(o, eligible)).toBe("curated");
  });

  it("is none for a row that matches no family observation threshold and no curated keyword", () => {
    const o: BasisOpportunity = { id: "1", title: "Office Manager", source: "lever", reasons: [] };
    const eligible = computeMeasuredEligibleFamilies([o]);
    expect(effectiveBasis(o, eligible)).toBe("none");
  });

  it("prefers a row's own stored basis over the derived one", () => {
    const o: BasisOpportunity = {
      id: "1",
      title: "Office Manager",
      source: "lever",
      reasons: [],
      hardToFillFactors: [{ factor: "roleScarcity", basis: "measured" }],
    };
    const eligible = computeMeasuredEligibleFamilies([o]);
    expect(effectiveBasis(o, eligible)).toBe("measured");
  });
});

describe("summarizeBasis", () => {
  it("partitions the full set into measured/curated/none summing to total", () => {
    const opportunities = [
      ...makeGreenhouseFamily("data-analytics", "Data Analyst", 10),
      { id: "curated-1", title: "Cloud Architect", source: "lever", reasons: [] },
      { id: "none-1", title: "Office Manager", source: "lever", reasons: [] },
    ];
    const summary = summarizeBasis(opportunities);
    expect(summary.total).toBe(12);
    expect(summary.measured).toBe(10);
    expect(summary.curated).toBe(1);
    expect(summary.none).toBe(1);
    expect(summary.measured + summary.curated + summary.none).toBe(summary.total);
  });
});
