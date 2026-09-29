import { describe, expect, it } from "vitest";
import { type ClientOpportunity, clientWhyItMatters, computeClientAggregates } from "./clientAggregation";

function makeRow(overrides: Partial<ClientOpportunity>): ClientOpportunity {
  return {
    id: overrides.id ?? "1",
    title: "Software Engineer",
    company: "Acme",
    source: "greenhouse",
    reasons: [],
    hardToFill: false,
    ...overrides,
  };
}

describe("computeClientAggregates", () => {
  it("groups opportunities by company and computes real aggregates", () => {
    const rows: ClientOpportunity[] = [
      makeRow({ id: "1", company: "GitLab", source: "greenhouse", reasons: ["open 30 days"], hardToFill: true }),
      makeRow({ id: "2", company: "GitLab", source: "greenhouse", reasons: ["open 50 days", "reposted role"] }),
      makeRow({ id: "3", company: "Gopuff", source: "lever", reasons: ["open 1146 days"] }),
    ];
    const aggregates = computeClientAggregates(rows);
    expect(aggregates).toHaveLength(2);

    const gitlab = aggregates.find((c) => c.company === "GitLab")!;
    expect(gitlab.openReqs).toBe(2);
    expect(gitlab.medianDaysOpen).toBe(40);
    expect(gitlab.hardToFillCount).toBe(1);
    expect(gitlab.repostedCount).toBe(1);
    expect(gitlab.verdict).toBe("healthy");

    const gopuff = aggregates.find((c) => c.company === "Gopuff")!;
    expect(gopuff.openReqs).toBe(1);
    expect(gopuff.verdict).toBe("flagged — excluded");
  });

  it("marks the seed job board as fixture", () => {
    const rows: ClientOpportunity[] = [
      makeRow({ id: "1", company: "Seed Co", source: "seed-job-board", reasons: [] }),
    ];
    const aggregates = computeClientAggregates(rows);
    expect(aggregates[0].verdict).toBe("fixture");
  });

  it("returns undefined medianDaysOpen when no row has a parseable days-open reason", () => {
    const rows: ClientOpportunity[] = [makeRow({ id: "1", company: "Acme", reasons: ["no salary range"] })];
    const aggregates = computeClientAggregates(rows);
    expect(aggregates[0].medianDaysOpen).toBeUndefined();
  });
});

describe("clientWhyItMatters", () => {
  it("names the flagged-excluded reason for a flagged source", () => {
    const rows: ClientOpportunity[] = [makeRow({ id: "1", company: "Gopuff", source: "lever", reasons: ["open 1146 days"] })];
    const aggregates = computeClientAggregates(rows);
    const sentence = clientWhyItMatters(aggregates[0], aggregates);
    expect(sentence).toContain("flagged and excluded");
  });

  it("calls out the top healthy source by open req count", () => {
    const rows: ClientOpportunity[] = [
      makeRow({ id: "1", company: "GitLab", source: "greenhouse", reasons: ["open 30 days"] }),
      makeRow({ id: "2", company: "GitLab", source: "greenhouse", reasons: ["open 30 days"] }),
    ];
    const aggregates = computeClientAggregates(rows);
    const sentence = clientWhyItMatters(aggregates[0], aggregates);
    expect(sentence).toContain("hottest live signal source");
  });
});
