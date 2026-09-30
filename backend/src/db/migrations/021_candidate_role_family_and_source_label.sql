-- S-27: structured fixture-candidate seeding needs two new real columns on
-- candidates so a fixture row can be distinguished from a real, human-added
-- one, and so a candidate can be matched to the same role-family taxonomy
-- opportunities already use (HARD_TO_FILL_CONFIG.roleFamilies,
-- backend/src/scoring/hardToFillConfig.ts, 06_decisions/046).
--
-- role_family: nullable, no default -- most existing rows (real,
-- human-added via POST /api/candidates) have no known family and should
-- stay honestly NULL rather than default to a guessed value.
--
-- source_label: NOT NULL DEFAULT 'live' -- every candidate that already
-- exists (or gets added later via the real "Add candidate" form) is real,
-- human-supplied data, so 'live' is the correct default, not a placeholder.
-- Only the new fixture-seed script (seedCandidatesFixture.ts) ever inserts
-- 'fixture' explicitly.
--
-- Reversible: two nullable/defaulted column additions, no backfill, nothing
-- else depends on them yet. Undoing this migration is exactly:
--   ALTER TABLE candidates DROP COLUMN role_family;
--   ALTER TABLE candidates DROP COLUMN source_label;
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS role_family TEXT,
  ADD COLUMN IF NOT EXISTS source_label TEXT NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS candidates_source_label_idx ON candidates (source_label);
