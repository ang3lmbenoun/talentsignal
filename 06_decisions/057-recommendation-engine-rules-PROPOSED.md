# 057 — Recommendation engine: kinds, thresholds, and rationale

**Date:** 2026-09-30
**Story:** S-30a (recommendation engine, no formal story file yet)
**Requirement:** none cited — new backend capability, task-specified kinds
**Decided by:** Megan — PROPOSED, pending Ali's approval per the task's own instruction

## The question

The task named four recommendation kinds (`loosen_years`, `loosen_skills`,
`add_candidates`, `strong_match`/`no_action`) and described each in plain English, but
specified only one numeric threshold explicitly (strong match ≥85%, reusing
`fitScore.ts`'s own bucket boundary). Every other threshold, and the precedence order
when more than one condition could plausibly apply to the same opportunity, needed a
real decision — logged here per CLAUDE.md rule 4, same PROPOSED-pending-Ali framing the
task itself asked for.

## Thresholds chosen

- **`no_action`** (task's "`strong_match`"): top real candidate's fit score ≥ 0.85 —
  identical to `fitScore.ts`'s existing `ge85` bucket boundary (decision 056), not a new
  number. Returns `suggestedEdits: null`; `kind: 'no_action'` was chosen over literally
  returning `null` from the function so the return type stays one consistent shape rather
  than a union of `Recommendation | null` — see "what would make this wrong" below.
- **`loosen_years`**: only evaluable when the opportunity has a real, known
  `requiredYears` (per decision 056, this is `null` for every opportunity the real route
  computes today — see "the same honest gap" section below). "Significantly below
  required" means the average of the top 5 real candidates' actual years falls short of
  `requiredYears` by more than 40% of `requiredYears` itself (`YEARS_GAP_SIGNIFICANT_RATIO
  = 0.4`) — the same linear scale `fitScore.ts`'s own `yearsMatch` factor already uses, so
  "significant" here means "enough to have meaningfully dragged that factor down," not an
  arbitrary second number.
- **`add_candidates`**: the pool of real (`basis: 'measured'`) candidates for this
  specific opportunity is smaller than 3 (`THIN_POOL_THRESHOLD = 3`), **and** the best one
  already scores ≥ 0.5 (`MATCHES_WELL_THRESHOLD`) — i.e., what little pool exists is
  promising, so sourcing more like it is the fix, not editing the JD. Also the honest
  fallback when there are zero real candidates at all, or when the best real candidate's
  skill overlap is below the `loosen_skills` floor (next item) — "nothing to loosen
  toward," source instead.
- **`loosen_skills`**: the default read once `no_action`, `loosen_years`, and
  `add_candidates` are all ruled out — the top candidate's real skill-overlap factor value
  is between 0.3 (`PARTIAL_SKILL_OVERLAP_FLOOR`) and 1.0 exclusive: a real, partial
  foundation exists, worth naming which skills are missing (unioned across the top 5 real
  candidates, reusing `fitScore.ts`'s own per-candidate `missingSkills`, not recomputed) so
  the least-critical ones can be dropped from the JD. Below 0.3, this engine treats it as
  "not really a skills-gap situation" and falls through to `add_candidates` instead —
  suggesting a JD edit when there's essentially no real skill match would be a worse
  recommendation than "go find different candidates."

**Precedence order** (each check only reached if every earlier one didn't match):
`no_action` → `loosen_years` → `add_candidates` (thin pool) → `loosen_skills` →
`add_candidates` (honest fallback). Checking `loosen_years` before the thin-pool
`add_candidates` check matters concretely: a 2-candidate pool with a real, known
`requiredYears` gap should surface the years problem, not just "go find more candidates"
— the thin pool is real, but the years mismatch is the more specific, more actionable
diagnosis when both are true.

## The same honest gap decision 056 already named

`requiredYears` has no real source anywhere in this schema (neither `opportunities` nor
`job_openings` has a numeric seniority field). Every call through the real
`GET /api/opportunities/:id/recommendation` route passes `requiredYears: null` (inherited
from `toFitOpportunityInput()`, decision 056) — so `loosen_years` can only ever fire
against **real** opportunities once a real source for required years exists. The function
itself is fully implemented and tested (its own unit tests supply a real `requiredYears`
directly), so this isn't a missing feature, just an honest consequence of the same schema
gap decision 056 already documented. Not re-solving it a second time here.

## What this rests on

That these four thresholds (0.85 strong-match, 0.4 years-gap ratio, pool-size-3 thin
threshold, 0.5 matches-well floor, 0.3 partial-overlap floor) are reasonable first cuts,
and that the precedence order above reflects which diagnosis is most actionable when
several could apply. All five numbers are this session's best judgment under the task's
own PROPOSED-pending-approval framing, not Ali's confirmed answer.

## What would make this wrong

If Ali wants `strong_match`'s "nothing to suggest" case to literally return `null` instead
of a `no_action` object, that's a one-line change to the function's return type and every
caller. If Ali wants different numeric thresholds, each lives as its own named constant in
`recommendations.ts` — no other logic needs to change. If Ali wants a different precedence
(e.g. `loosen_skills` checked before the thin-pool `add_candidates` case), that's a
reordering of the same five `if` blocks, not a redesign.
