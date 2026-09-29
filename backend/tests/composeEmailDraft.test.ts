import { describe, expect, it } from "vitest";
import { composeEmailDraft } from "../src/packages/composeEmailDraft";
import type { ComposedPackageContent } from "../src/packages/composePackage";

function content(overrides: Partial<ComposedPackageContent> = {}): ComposedPackageContent {
  return {
    company: "GitLab",
    confidenceScore: 0.8,
    jobTitle: "Analytics role",
    opportunityReasons: ["reposted role", "open 60 days"],
    candidates: [],
    ...overrides,
  };
}

describe("composeEmailDraft", () => {
  it("is deterministic: the same content always produces the same draft", () => {
    const c = content();
    expect(composeEmailDraft(c)).toBe(composeEmailDraft(c));
  });

  it("names the real company and job title in the subject and greeting", () => {
    const draft = composeEmailDraft(content({ company: "Acme Corp", jobTitle: "Backend Engineer" }));
    expect(draft).toContain("Subject: Candidate introduction — Backend Engineer");
    expect(draft).toContain("Hello Acme Corp team,");
  });

  it("includes the real opportunity reasons, not invented ones", () => {
    const draft = composeEmailDraft(content({ opportunityReasons: ["no salary range"] }));
    expect(draft).toContain("This requisition shows: no salary range.");
  });

  it("names the top candidate and their real matched skills when one exists", () => {
    const draft = composeEmailDraft(
      content({
        candidates: [
          { id: "c-1", name: "Jordan Lee", fitScore: 0.6, matchedSkills: ["SQL", "Python"], reasons: [] },
        ],
      }),
    );
    expect(draft).toContain("Jordan Lee's listed experience includes SQL, Python.");
  });

  it("is honest about zero skill overlap instead of implying a match", () => {
    const draft = composeEmailDraft(
      content({
        candidates: [{ id: "c-1", name: "Jordan Lee", fitScore: 0, matchedSkills: [], reasons: [] }],
      }),
    );
    expect(draft).toContain("no verified skill overlap was found for this role");
  });

  it("is honest when there are no candidates at all", () => {
    const draft = composeEmailDraft(content({ candidates: [] }));
    expect(draft).toContain("No candidates have been matched to this role yet");
  });
});
