-- S-25 Packages redesign: an editable email draft, pre-filled from a
-- deterministic template at draft-composition time (composeEmailDraft.ts,
-- same "pure function over real content, no LLM" discipline
-- composePackage.ts already follows) and editable in place before release.
--
-- Nullable, no default: every future INSERT (opportunityPackage.ts's draft
-- route) supplies it explicitly via composeEmailDraft(), same "no silent
-- fallback" discipline migration 005 used for weights_version/
-- factor_breakdown. Existing pre-migration rows (if any) simply have NULL
-- here — the frontend already treats "no draft yet" as an empty editable
-- textarea, so this reads as honestly-empty rather than a fabricated value.
--
-- Reversible: a single nullable column addition with no backfill, no new
-- constraint, and nothing else depends on it yet, so undoing this migration
-- is exactly:
--   ALTER TABLE opportunity_packages DROP COLUMN draft_email_body;
ALTER TABLE opportunity_packages
  ADD COLUMN IF NOT EXISTS draft_email_body TEXT;

-- PII registry (06_decisions/009/013/015, same reasoning migration 007 used
-- for this table's `content` column): the template names the top candidate
-- by name, so this column carries the same identity PII `content` does and
-- needs the same erasure_strategy -- otherwise S-15's erasure loop would
-- scrub a candidate's name from `content` but silently leave it sitting in
-- this column, a real gap, not a hypothetical one.
INSERT INTO pii_fields (table_name, column_name, category, erasure_strategy, redact_from_display) VALUES
  ('opportunity_packages', 'draft_email_body', 'identity', 'reset_to_empty', false)
ON CONFLICT DO NOTHING;
