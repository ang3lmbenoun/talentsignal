// Exact port of backend/src/packages/composeEmailDraft.ts, so "Restore AI
// draft" can recompute the deterministic template locally (no server round
// trip) from the package's own real `content`. Keep in sync with the
// backend copy if either changes.

export interface EmailDraftCandidate {
  name: string;
  matchedSkills: string[];
}

export interface EmailDraftContent {
  company: string;
  jobTitle: string;
  opportunityReasons: string[];
  candidates: EmailDraftCandidate[];
}

export function composeEmailDraft(content: EmailDraftContent): string {
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
