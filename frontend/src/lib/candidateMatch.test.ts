import { describe, expect, it } from "vitest";
import { bestMatchForCandidate, scoreCandidateAgainstJob } from "./candidateMatch";

describe("scoreCandidateAgainstJob", () => {
  it("matches the backend's worked example: full skill overlap, saturated experience", () => {
    const result = scoreCandidateAgainstJob(
      { skills: ["SQL", "Python"], experience: 10 },
      { id: "job-1", title: "Data Analyst", requirements: ["SQL", "Python"] },
    );
    // cosine = 2 / sqrt(2*2) = 1; fitScore = 1*0.7 + 1*0.3*1 = 1
    expect(result.fitScore).toBe(1);
    expect(result.matchedSkills.sort()).toEqual(["Python", "SQL"]);
  });

  it("returns a zero fit score with no invented overlap when skills don't intersect", () => {
    const result = scoreCandidateAgainstJob(
      { skills: ["Welding"], experience: 5 },
      { id: "job-1", title: "Data Analyst", requirements: ["SQL"] },
    );
    expect(result.fitScore).toBe(0);
    expect(result.matchedSkills).toEqual([]);
  });

  it("returns zero when the candidate has no listed skills, never a guess", () => {
    const result = scoreCandidateAgainstJob(
      { skills: [], experience: 5 },
      { id: "job-1", title: "Data Analyst", requirements: ["SQL"] },
    );
    expect(result.fitScore).toBe(0);
  });
});

describe("bestMatchForCandidate", () => {
  it("picks the job with the highest fit score", () => {
    const candidate = { skills: ["SQL", "Python"], experience: 3 };
    const jobs = [
      { id: "job-a", title: "Warehouse Lead", requirements: ["forklift"] },
      { id: "job-b", title: "Data Analyst", requirements: ["SQL", "Python"] },
    ];
    const best = bestMatchForCandidate(candidate, jobs);
    expect(best?.job.id).toBe("job-b");
    expect(best?.result.fitScore).toBeGreaterThan(0);
  });

  it("returns undefined when there are no job openings loaded", () => {
    expect(bestMatchForCandidate({ skills: ["SQL"], experience: 1 }, [])).toBeUndefined();
  });

  it("still returns a real zero-overlap match rather than nothing, when a job exists but shares no skills", () => {
    const best = bestMatchForCandidate(
      { skills: ["Welding"], experience: 1 },
      [{ id: "job-1", title: "Data Analyst", requirements: ["SQL"] }],
    );
    expect(best).toBeDefined();
    expect(best?.result.fitScore).toBe(0);
  });
});
