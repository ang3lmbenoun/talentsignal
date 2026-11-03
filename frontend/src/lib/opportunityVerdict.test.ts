import { describe, expect, it } from "vitest";
import {
  buildVerdict,
  buildWhatWouldChange,
  contributionWords,
  factorLabel,
  type FactorLike,
  type VerdictInput,
} from "./opportunityVerdict";

const BASE: VerdictInput = {
  daysOpen: undefined,
  reasons: [],
  hardToFill: false,
  basis: "none",
  capacityEvidence: false,
};

describe("buildVerdict", () => {
  it("writes the example sentence from days open and a missing salary", () => {
    expect(buildVerdict({ ...BASE, daysOpen: 191, reasons: ["open 191 days", "no salary range"] })).toBe(
      "Open 191 days with no salary posted, so this is worth a closer look.",
    );
  });

  it("joins several facts in plain words", () => {
    const text = buildVerdict({
      ...BASE,
      daysOpen: 24,
      reasons: ["reposted role", "open 24 days", "no salary range"],
      basis: "measured",
    });
    expect(text).toBe(
      "Open 24 days with no salary posted, a previous repost and a role type that usually stays open longer than most, so this is worth a closer look.",
    );
  });

  it("describes the curated and capacity evidence without jargon", () => {
    expect(buildVerdict({ ...BASE, daysOpen: 10, basis: "curated", capacityEvidence: true })).toBe(
      "Open 10 days with a role type our team has marked as scarce and a matching public employer hiring record, so this is worth a closer look.",
    );
  });

  it("does not guess when the days open are unknown", () => {
    expect(buildVerdict({ ...BASE, reasons: ["no salary range"] })).toBe(
      "This posting has no salary posted, so this is worth a closer look.",
    );
  });

  it("says plainly when there is no clue at all", () => {
    expect(buildVerdict({ ...BASE, daysOpen: 3 })).toBe(
      "Open 3 days, with no repost, missing salary range or role-type clue in the loaded data.",
    );
    expect(buildVerdict(BASE)).toContain("No repost, missing salary range or role-type clue was found");
  });

  it('only uses "hard to fill" when the posting is really flagged', () => {
    const unflagged = buildVerdict({ ...BASE, daysOpen: 191, reasons: ["no salary range"], basis: "measured" });
    expect(unflagged).not.toContain("hard to fill");

    const flagged = buildVerdict({ ...BASE, daysOpen: 191, reasons: ["no salary range"], hardToFill: true });
    expect(flagged).toContain("flagged as a role that may be hard to fill");
  });
});

const FACTORS: FactorLike[] = [
  { factor: "baseScore", weight: 0.2, value: 1, contribution: 0.2 },
  { factor: "daysOpen", weight: 0.32, value: 0.8, contribution: 0.256 },
  { factor: "repostedRole", weight: 0.32, value: 0, contribution: 0 },
  { factor: "missingSalaryRange", weight: 0.16, value: 1, contribution: 0.16 },
];

describe("contributionWords", () => {
  it("ranks factors by contribution in words, with no numeric cut-off", () => {
    expect(contributionWords(FACTORS[1], FACTORS)).toBe("Largest signal");
    expect(contributionWords(FACTORS[0], FACTORS)).toBe("Second signal");
    expect(contributionWords(FACTORS[3], FACTORS)).toBe("Smaller signal");
    expect(contributionWords(FACTORS[2], FACTORS)).toBe("Not present in this posting");
  });
});

describe("factorLabel", () => {
  it("uses plain names and humanizes unknown factors", () => {
    expect(factorLabel("missingSalaryRange")).toBe("No salary range");
    expect(factorLabel("someNewFactor")).toBe("Some new factor");
  });
});

describe("buildWhatWouldChange", () => {
  it("is built from the factors that are currently adding to the score", () => {
    expect(buildWhatWouldChange(FACTORS)).toBe(
      "This would change with the posting being filled or closed and a salary range being added.",
    );
  });

  it("does not repeat a change that two scores share", () => {
    const both = [...FACTORS, { factor: "daysOpen", weight: 0.16, value: 1, contribution: 0.16 }];
    const text = buildWhatWouldChange(both);
    expect(text.match(/filled or closed/g)).toHaveLength(1);
  });

  it("falls back to a neutral line when nothing stands out", () => {
    expect(buildWhatWouldChange([{ factor: "baseScore", weight: 0.2, value: 1, contribution: 0.2 }])).toBe(
      "No single clue stands out. New posting data would update this.",
    );
  });
});
