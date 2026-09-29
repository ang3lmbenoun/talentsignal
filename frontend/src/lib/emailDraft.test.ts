import { describe, expect, it } from "vitest";
import { composeEmailDraft } from "./emailDraft";

describe("composeEmailDraft (frontend port)", () => {
  it("matches the backend's deterministic output for the same content", () => {
    const draft = composeEmailDraft({
      company: "GitLab",
      jobTitle: "Analytics role",
      opportunityReasons: ["reposted role"],
      candidates: [{ name: "Jordan Lee", matchedSkills: ["SQL"] }],
    });
    expect(draft).toContain("Subject: Candidate introduction — Analytics role");
    expect(draft).toContain("Hello GitLab team,");
    expect(draft).toContain("This requisition shows: reposted role.");
    expect(draft).toContain("Jordan Lee's listed experience includes SQL.");
    expect(draft).toContain("TalentSignal Recruiting");
  });

  it("is honest about no candidates", () => {
    const draft = composeEmailDraft({ company: "Acme", jobTitle: "Role", opportunityReasons: [], candidates: [] });
    expect(draft).toContain("No candidates have been matched to this role yet");
  });
});
