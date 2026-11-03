-- S-30b: the JD editor needs somewhere real to persist a human edit to an
-- opportunity's required skills/years. Until now, decision 056's fit engine
-- only ever DERIVED requiredSkills from the title via
-- roleSkillsConfig.ts's requirementsForTitle() bridge, and requiredYears
-- had no source at all -- both were computed on the fly, never stored.
--
-- required_skills: TEXT[], nullable, no default -- same "structured array,
-- no jsonb needed" call decision 055 already made for candidates.skills.
-- NULL means "never edited" and the fit engine (fits.ts's
-- toFitOpportunityInput) falls back to the derived requirementsForTitle()
-- list, exactly as before this migration. An empty array ('{}') is a real,
-- deliberate "no skills required" edit and is trusted as such -- NULL and
-- empty are different states, not the same "nothing here."
--
-- required_years: INTEGER, nullable, no default -- NULL means "never set,"
-- honestly excluded from yearsMatch scoring (decision 056's renormalization
-- path), not defaulted to 0 or any other guessed number.
--
-- Reversible: two nullable column additions, no backfill, nothing else
-- depends on them yet. Undoing this migration is exactly:
--   ALTER TABLE opportunities DROP COLUMN required_skills;
--   ALTER TABLE opportunities DROP COLUMN required_years;
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS required_skills TEXT[],
  ADD COLUMN IF NOT EXISTS required_years INTEGER;
