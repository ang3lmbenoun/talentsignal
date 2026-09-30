# 056 — Fit-scoring engine: weights, factor definitions, and a real schema gap

**Date:** 2026-09-30
**Story:** S-28 (fit-scoring engine, no formal story file yet)
**Requirement:** none cited — new backend capability, task-specified weights
**Decided by:** Megan — PROPOSED, pending Ali's approval per the task's own instruction

## The question

The task specified four weighted factors (skillOverlap 0.50, yearsMatch 0.20, roleFamily
0.20, availabilityMatch 0.10) for a new `computeFitScore(opportunity, candidate)` and
explicitly said Ali must approve the weights before they're marked non-PROPOSED — this
decision exists to record them, plus one real implementation gap the task's spec didn't
anticipate.

## Factor definitions, as specified

- **skillOverlap (0.50):** `matched / total required` — the fraction of the opportunity's
  required skills present in the candidate's skills, case-insensitive, exact-string
  matching (same normalization convention as `scoreCandidate()`, `matchScore.ts`,
  decision 011 — not fuzzy/semantic matching, a known limitation shared with that engine).
- **yearsMatch (0.20):** linear, capped at [0, 1]: `max(0, 1 - |candidateYears -
  requiredYears| / requiredYears)`. An exact match scores 1.0; the score falls to 0 once
  the gap equals or exceeds the required years themselves (10 required vs. 0 or 20+ actual
  both score 0), never negative.
- **roleFamily (0.20):** 1.0 if `candidate.roleFamily === opportunity.roleFamily`
  (exact match on the real family-key strings `HARD_TO_FILL_CONFIG.roleFamilies` already
  declares), else 0.
- **availabilityMatch (0.10):** `immediate` 1.0, `2_weeks` 0.7, `1_month` 0.4, `passive`
  0.1, anything else (missing, unrecognized) 0 — never a guessed default.

## The real gap: opportunities have no `required_skills` or `required_years` column

Neither exists anywhere in the real schema. Only `job_openings` (CRM-created postings) has
a real `requirements: string[]`, and decision 015 deliberately refused to add a foreign key
between `opportunities` (ATS-scraped market signals) and `job_openings` — they're produced
by two different, unlinked processes.

**requiredSkills:** `GET /api/opportunities/:id/fits` and `/api/fits/summary` source this
via `roleSkillsConfig.ts`'s `requirementsForTitle()` — the exact bridge decision 027
already built and Ali already reviewed for this identical problem ("a market-signal
opportunity stores only a title, not required skills... this map is the transparent,
swappable bridge instead"). Real reuse, not a new invented mapping. An opportunity whose
title matches no known scarce-role keyword gets `requiredSkills: []`, which correctly
triggers `basis: 'insufficient_data'` per the task's own rule — honest, not a bug.

**requiredYears:** has no equivalent bridge anywhere in this codebase — no numeric
"seniority" signal exists on `opportunities` *or* `job_openings`. Every route-level call
passes `requiredYears: null`. `computeFitScore` treats `null` as "genuinely unknown": the
`yearsMatch` factor is omitted entirely and the remaining three factors' weights are
renormalized to sum to 1.0 (divided by `1 - 0.20`), rather than either fabricating a years
requirement or silently docking every real opportunity's score by a fixed 20% for a
dimension nothing in this app can currently supply. The pure function itself still accepts
a real `requiredYears` number when a caller has one (proven by the "exact years match" /
"off years match" unit tests), so this degrades gracefully rather than making the whole
factor unusable.

## `/api/fits/summary`'s "avg fit score" and bucket distribution

Computed **per opportunity, using its single best-matching candidate's score** — "does
this req have at least one strong-fit candidate" — not averaged across every
opportunity×candidate pairing. This is the definition the very next task (Overview's "Reqs
with strong candidates ≥85%" / "Reqs needing attention <70%" KPI tiles) needs to be
meaningful; averaging every pairing would dilute it by every candidate a req was never a
realistic match for.

## What this rests on

That reusing `requirementsForTitle()` for opportunity skills, and renormalizing weights
when years are unknown, are the right calls rather than either building a new opportunity
requirements source from scratch or forcing `requiredYears` to a hardcoded placeholder. Both
are this session's best judgment under the task's own PROPOSED-pending-approval framing,
not Ali's confirmed answer — same standing as the weights themselves.

## What would make this wrong

If Ali wants `requiredYears` sourced from somewhere real (e.g., a new `job_openings`
seniority field, joined in by company/title heuristically), that's a new bridge to build,
not a tweak to this one. If Ali wants missing-years opportunities scored with `yearsMatch`
forced to a neutral 0.5 instead of renormalized away, that's a one-line change to
`fitScore.ts`'s `activeWeights` branch. If Ali wants `/api/fits/summary` averaged over
every pairing instead of per-opportunity best-fit, that's a smaller change confined to
`fits.ts`'s summary route.
