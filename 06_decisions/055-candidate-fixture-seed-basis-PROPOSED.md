# 055 — Candidate fixture seed: role-family taxonomy, skills column, and availability enum

**Date:** 2026-09-30
**Story:** S-27 (candidate fixture seed, no formal story file yet)
**Requirement:** none cited — new fixture data generation, backend + seed only
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

The task asked for 40 fixture candidates with structured skills, years of experience, an
availability enum, and a role-family match, distributed "across your role families"
(naming 7: retail-ops, engineering-swe, ml-ai, security, sales-bizdev, general-other,
support-cs) with 3-6 candidates per family, plus a migration for "any missing columns...
(skills jsonb, role_family text, source_label text)." Three things needed a real decision
rather than a literal read of that spec, per CLAUDE.md rule 4.

## What we chose, and why

**Skills column: no change, not jsonb.** `candidates.skills` already exists as
`TEXT[] NOT NULL DEFAULT '{}'` (migration 004) — already a real, structured array of
strings, exactly the shape the task's own example (`["Python", "dbt", "PostgreSQL",
"Airflow"]`) describes. Converting it to `jsonb` would be a disruptive type change with no
functional benefit (an array is already what's needed) that would also touch
`backend/src/routes/candidates.ts` and every consumer of it — directly contradicting the
task's own "backend + seed script only, no UI changes" scope and its narrower migration
need (role_family, source_label — the two columns that genuinely don't exist yet).

**Role families: the full real 9, not the abbreviated 7 named in the request.** The
task's list of 7 omits `data-analytics` and `cloud-infra`, two families that are part of
the actual, already-shipped taxonomy (`HARD_TO_FILL_CONFIG.roleFamilies`,
`backend/src/scoring/hardToFillConfig.ts`, used by `classifyFamily()` and every screen's
role-family filter/donut since the S-25 redesign). The task's own instruction is "Role
family match (matches at least one **existing** role_family)" — existing means that real,
shipped 8-family-plus-`general-other` set, not a subset. Dropping 2 real families without
a stated reason would have been the silent-assumption failure mode this rule exists to
catch, so all 9 (8 named families + the `general-other` fallback) got real fixture
candidates: `engineering-swe` 5, `ml-ai` 5, `data-analytics` 5, `security` 4,
`cloud-infra` 4, `support-cs` 4, `sales-bizdev` 5, `retail-ops` 4, `general-other` 4 — sums
to 40, every family within the requested 3-6 range.

**Availability: kept as free-text `TEXT`, not a DB-enforced enum.** The column already
exists as unconstrained `TEXT` (migration 004). Adding a `CHECK` constraint to enforce
exactly `immediate` / `2_weeks` / `1_month` / `passive` would risk rejecting any existing
row with a different free-text value already in the table (the app's real "Add candidate"
form has always accepted arbitrary text here) — a real, avoidable migration-safety risk
for a constraint the task didn't explicitly ask for. Instead, the fixture seed script
itself only ever emits those 4 exact values, which is what actually matters for this
story's purpose (realistic, demo-ready fixture data) without touching every existing row's
contract.

**Two new real columns, both reversible:** `role_family TEXT` (nullable — existing real
candidates have no known family and should read as honestly unclassified, not a guess) and
`source_label TEXT NOT NULL DEFAULT 'live'` (every already-existing and future
human-added candidate is real data by default; only this seed script's 40 rows ever pass
`'fixture'` explicitly). Migration 021 adds both; reversing it is two `DROP COLUMN`
statements, documented inline in the migration file itself.

**Separate script, not an extension of `seedDemo.ts`.** `seedDemo.ts`'s own 6-candidate
roster is already covered by `seedDemo.idempotent.integration.test.ts` and used as a fixed
baseline by `hiddenDemandJourney.e2e.test.ts`. Growing that same list by 40 rows would
change what an already-reviewed contract asserts. `seedCandidatesFixture.ts` owns its own
name prefix (`Fixture Candidate — <family> NN`), its own idempotency check (same
`name LIKE` pattern convention `seedDemo.ts` already uses), and its own npm script
(`npm run seed:candidates`), so it can run independently of the existing demo seed.

## What this rests on

That the real, currently-shipped 9-value role-family taxonomy is still what Ali wants
candidates matched against (rather than, say, a simpler candidate-specific category set),
and that 40 candidates split roughly evenly is a reasonable demo size. Both are this
session's best judgment, not Ali's confirmed answer.

## What would make this wrong

If Ali wants availability DB-enforced (not just seed-script-disciplined), a `CHECK`
constraint is a follow-up migration, not a change to this one — and it would need an audit
of existing free-text values first. If Ali wants the 7-family list taken literally
(dropping `data-analytics`/`cloud-infra` fixture candidates), that's a smaller follow-up
seed adjustment, not a schema change. If skills ever need semi-structured metadata beyond
a flat list (e.g., per-skill proficiency), `TEXT[]` stops being sufficient and the jsonb
conversion this decision declined becomes the right call.
