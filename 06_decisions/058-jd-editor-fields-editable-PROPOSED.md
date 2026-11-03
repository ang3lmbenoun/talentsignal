# 058 — JD editor: which opportunity fields are user-editable vs. ATS-derived

**Date:** 2026-10-06
**Story:** S-30b (recommendation UI + inline JD editor, no formal story file yet)
**Requirement:** none cited — new editable fields, task-specified scope
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

The recommendation engine's `loosen_years`/`loosen_skills` suggestions are only
actionable if a real person can actually act on them — edit the opportunity's required
skills or years. Until this story, `opportunities` had no such columns at all (decision
056: `requiredSkills` was always derived from the title via `requirementsForTitle()`,
`requiredYears` had no source whatsoever). The task named exactly two fields as editable
("only allow editing required_skills and required_years — nothing else"); this decision
records the schema/behavior choices that instruction didn't spell out.

## What's editable, and what stays ATS-derived

**Editable (migration 022, `PATCH /api/opportunities/:id`):**
- `required_skills` (`TEXT[]`, nullable) — same "array of strings, no jsonb needed" call
  decision 055 already made for `candidates.skills`.
- `required_years` (`INTEGER`, nullable, ≥0 or `null`).

**Read-only, ATS-only, never writable through this or any endpoint:** `title`, `company`,
`source`, `external_signal_id`, `confidence_score`, `reasons`, every hard-to-fill field,
`family_key`, `days_open`, and everything else already on the row. The PATCH handler
validates the request body against exactly these two keys and rejects (400) a request
that supplies neither — it has no code path that could write any other column even if a
caller tried, since the `SET` clause is built only from `requiredSkills`/`requiredYears`
presence checks, never from the raw request body.

## NULL vs. `[]`: two different real states, not the same "unset"

A never-edited opportunity has `required_skills IS NULL` — the fit engine
(`fits.ts`'s `toFitOpportunityInput`) falls back to the title-derived
`requirementsForTitle()` guess, exactly as it did before this story. Once a human
explicitly saves `requiredSkills: []`, that is trusted as a real, deliberate "this role
has no required skills" and does **not** fall back to the derived guess — `??` only
treats `null`/`undefined` as "never edited," never an empty array. The same applies to
`required_years`: `null` means genuinely unknown (decision 056's weight-renormalization
path), a real `0` is a real answer.

## A saved edit is authoritative, not merged

Once `required_skills`/`required_years` are set, they fully replace the derived guess for
that opportunity — not merged, not blended. This matches how a human would expect "I
edited the JD" to behave: the edit is the new truth, not an additional input alongside
the old heuristic.

## What this rests on

That `required_skills`/`required_years` are the only two fields worth making editable for
this story's purpose (making recommendations actionable), and that a saved edit should
fully override rather than merge with the derived default. Both are this session's best
judgment under the task's own scope, not Ali's confirmed answer.

## What would make this wrong

If Ali wants other JD-adjacent fields editable too (e.g. a free-text description, or the
role family itself), that's new columns and a wider PATCH body, not a tweak to this one.
If Ali wants an edited opportunity to still show the ATS-derived guess alongside the human
edit (for comparison), that's a response-shape change, not a scoring change — the fit
engine itself only ever needs one authoritative value per field.
