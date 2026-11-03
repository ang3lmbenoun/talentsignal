import { describe, expect, it } from "vitest";
import {
  computeFirstObservationScore,
  isClosed,
  closedAtDate,
  daysToClose,
  wasRepostVisibleAtFirstObservation,
  percentile,
  median,
  NORMALIZED_WEIGHTS,
  HIGH_LOW_CUTOFF,
} from "../src/analysis/s25HardnessValidation";

describe("computeFirstObservationScore (S-25)", () => {
  it("excludes daysOpen entirely -- the function has no daysOpen parameter at all", () => {
    // Structural guarantee: the function signature accepts only roleScarcity
    // and a repost boolean. There is no way to pass a days-open value in,
    // which is the point -- this is not a runtime check, it's by construction.
    expect(computeFirstObservationScore.length).toBe(2);
  });

  it("weights roleScarcity and repostedRole at the decision-026 subset normalization (0.75 / 0.25)", () => {
    expect(NORMALIZED_WEIGHTS.roleScarcity).toBeCloseTo(0.75, 5);
    expect(NORMALIZED_WEIGHTS.repostedRole).toBeCloseTo(0.25, 5);
    expect(NORMALIZED_WEIGHTS.roleScarcity + NORMALIZED_WEIGHTS.repostedRole).toBeCloseTo(1, 5);
  });

  it("a full curated roleScarcity match with no repost scores exactly 0.75", () => {
    const { score } = computeFirstObservationScore({ basis: "curated", value: 1 }, false);
    expect(score).toBeCloseTo(0.75, 5);
  });

  it("no roleScarcity evidence but a visible repost scores exactly 0.25", () => {
    const { score } = computeFirstObservationScore({ basis: "none", value: 0 }, true);
    expect(score).toBeCloseTo(0.25, 5);
  });

  it("both present scores 1.0", () => {
    const { score } = computeFirstObservationScore({ basis: "curated", value: 1 }, true);
    expect(score).toBeCloseTo(1, 5);
  });

  it("basis 'none' is scored as 0 even if a stray nonzero value were passed -- not interpolated", () => {
    const { score } = computeFirstObservationScore({ basis: "none", value: 0.7 }, false);
    expect(score).toBe(0);
  });

  it("measured basis uses the continuous value directly", () => {
    const { score } = computeFirstObservationScore({ basis: "measured", value: 0.4 }, false);
    expect(score).toBeCloseTo(0.4 * 0.75, 5);
  });

  it("HIGH_LOW_CUTOFF is the documented 0.50 split point", () => {
    expect(HIGH_LOW_CUTOFF).toBe(0.5);
  });
});

describe("isClosed (S-25 closed-set detection)", () => {
  const latest = new Date("2026-09-29T00:00:00Z");

  it("a req last seen exactly at the grace-period boundary is NOT yet closed", () => {
    const lastSeen = new Date(latest.getTime() - 2 * 86_400_000);
    expect(isClosed(lastSeen, latest, 2)).toBe(false);
  });

  it("a req last seen one millisecond past the grace period IS closed", () => {
    const lastSeen = new Date(latest.getTime() - 2 * 86_400_000 - 1);
    expect(isClosed(lastSeen, latest, 2)).toBe(true);
  });

  it("a req still appearing in the latest ingestion is open", () => {
    expect(isClosed(latest, latest, 2)).toBe(false);
  });

  it("a req absent for well over the grace period is closed", () => {
    const lastSeen = new Date(latest.getTime() - 30 * 86_400_000);
    expect(isClosed(lastSeen, latest, 2)).toBe(true);
  });

  it("respects a different configured grace period", () => {
    const lastSeen = new Date(latest.getTime() - 5 * 86_400_000);
    expect(isClosed(lastSeen, latest, 2)).toBe(true);
    expect(isClosed(lastSeen, latest, 10)).toBe(false);
  });
});

describe("closedAtDate / daysToClose (S-25)", () => {
  it("closedAtDate adds the grace period to the last sighting", () => {
    const lastSeen = new Date("2026-09-01T00:00:00Z");
    const closedAt = closedAtDate(lastSeen, 2);
    expect(closedAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("daysToClose measures from first observation to the closed date, never negative", () => {
    const firstObserved = new Date("2026-08-01T00:00:00Z");
    const closedAt = new Date("2026-08-31T00:00:00Z");
    expect(daysToClose(firstObserved, closedAt)).toBe(30);
  });

  it("daysToClose floors at 0 even if closedAt somehow precedes firstObserved", () => {
    const firstObserved = new Date("2026-08-31T00:00:00Z");
    const closedAt = new Date("2026-08-01T00:00:00Z");
    expect(daysToClose(firstObserved, closedAt)).toBe(0);
  });
});

describe("wasRepostVisibleAtFirstObservation (S-25, mirrors decision 043's first-sighting check)", () => {
  const firstObservedAt = new Date("2026-09-10T00:00:00Z");

  it("no requisition_id on the first sighting -- never a repost (Lever's real-world case)", () => {
    expect(wasRepostVisibleAtFirstObservation(null, "run-a", firstObservedAt, [])).toBe(false);
  });

  it("a prior sighting of the same requisition_id under a different run, before first observation -- IS visible", () => {
    const otherSightings = [
      { requisitionId: "req-123", fetchedAt: new Date("2026-09-05T00:00:00Z"), runId: "run-b" },
    ];
    expect(wasRepostVisibleAtFirstObservation("req-123", "run-a", firstObservedAt, otherSightings)).toBe(true);
  });

  it("a same-run sighting (board-mate iteration order) does NOT count -- false-positive guard from decision 043", () => {
    const otherSightings = [
      { requisitionId: "req-123", fetchedAt: new Date("2026-09-09T23:59:59Z"), runId: "run-a" },
    ];
    expect(wasRepostVisibleAtFirstObservation("req-123", "run-a", firstObservedAt, otherSightings)).toBe(false);
  });

  it("a sighting of the same requisition_id AFTER first observation does not count -- that's future information", () => {
    const otherSightings = [
      { requisitionId: "req-123", fetchedAt: new Date("2026-09-15T00:00:00Z"), runId: "run-b" },
    ];
    expect(wasRepostVisibleAtFirstObservation("req-123", "run-a", firstObservedAt, otherSightings)).toBe(false);
  });

  it("a different requisition_id entirely does not count", () => {
    const otherSightings = [
      { requisitionId: "req-999", fetchedAt: new Date("2026-09-05T00:00:00Z"), runId: "run-b" },
    ];
    expect(wasRepostVisibleAtFirstObservation("req-123", "run-a", firstObservedAt, otherSightings)).toBe(false);
  });
});

describe("percentile / median (S-25)", () => {
  it("median of an odd-length array is the middle value", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });

  it("median of an even-length array interpolates the two middle values", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("p25/p75 bracket the median on a larger sorted array", () => {
    const values = Array.from({ length: 21 }, (_, i) => i + 1); // 1..21
    expect(percentile(values, 25)).toBe(6);
    expect(percentile(values, 75)).toBe(16);
  });

  it("an empty array returns NaN rather than throwing", () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});
