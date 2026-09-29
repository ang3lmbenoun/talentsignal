import type { ComposedPackageContent } from "./composePackage";

/**
 * Deterministic email-draft template, same "pure function over real
 * content, no LLM" discipline composePackage.ts already follows -- the same
 * opportunity + job + candidate pool always produces the same draft text.
 * Every sentence is built from real ComposedPackageContent fields; nothing
 * here is invented copy.
 */
export function composeEmailDraft(content: ComposedPackageContent): string {
  const { company, jobTitle, opportunityReasons, candidates } = content;
  const topCandidate = candidates[0];

  const reasonSentence =
    opportunityReasons.length > 0
      ? `This requisition shows: ${opportunityReasons.join(", ")}.`
      : "No specific signal reasons were recorded for this requisition.";

  const candidateParagraph =
    candidates.length === 0
      ? "No candidates have been matched to this role yet -- add candidate profiles before drafting outreach."
      : topCandidate.matchedSkills.length > 0
        ? `${topCandidate.name}'s listed experience includes ${topCandidate.matchedSkills.join(", ")}. Please review the profile and confirm whether the fit is relevant before any outreach.`
        : `${topCandidate.name} is included for review, though no verified skill overlap was found for this role -- please confirm fit manually before any outreach.`;

  return [
    `Subject: Candidate introduction — ${jobTitle}`,
    "",
    `Hello ${company} team,`,
    "",
    `I'm reaching out about your ${jobTitle} role. ${reasonSentence}`,
    "",
    candidateParagraph,
    "",
    "Best,",
    "TalentSignal Recruiting",
  ].join("\n");
}
