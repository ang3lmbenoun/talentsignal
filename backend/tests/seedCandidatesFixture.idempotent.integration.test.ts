import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";
import { seedCandidatesFixture } from "../src/db/seedCandidatesFixture";

/**
 * S-27 acceptance: 40 fixture candidates, every one carrying
 * source_label = 'fixture', distributed 3-6 per role family, identical on
 * a second run. Same describeIfDb real-Postgres gate as
 * seedDemo.idempotent.integration.test.ts (06_decisions/055) — proving
 * real ON CONFLICT / skip-existing behavior needs a real database, not a
 * fake pool's approximation of it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("seedCandidatesFixture idempotency (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_seed_candidates_fixture_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(scopedPool);
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it(
    "inserts exactly 40 fixture candidates, every one source_label='fixture', 3-6 per role family, and is a no-op on a second run",
    async () => {
      const first = await seedCandidatesFixture(scopedPool);
      expect(first.inserted).toBe(40);

      const { rows } = await scopedPool.query(
        "SELECT role_family, source_label, skills, experience, availability FROM candidates WHERE name LIKE 'Fixture Candidate%'",
      );
      expect(rows).toHaveLength(40);

      // Every row is explicitly 'fixture', never 'live'.
      expect(rows.every((r) => r.source_label === "fixture")).toBe(true);
      // Every row has a real role_family and a structured (non-empty) skills array.
      expect(rows.every((r) => typeof r.role_family === "string" && r.role_family.length > 0)).toBe(true);
      expect(rows.every((r) => Array.isArray(r.skills) && r.skills.length > 0)).toBe(true);
      // Years of experience within the requested [2, 20] range.
      expect(rows.every((r) => r.experience >= 2 && r.experience <= 20)).toBe(true);
      // Availability is one of the four real enum values only.
      const validAvailability = new Set(["immediate", "2_weeks", "1_month", "passive"]);
      expect(rows.every((r) => validAvailability.has(r.availability))).toBe(true);

      const perFamily = new Map<string, number>();
      for (const row of rows) {
        perFamily.set(row.role_family, (perFamily.get(row.role_family) ?? 0) + 1);
      }
      expect(perFamily.size).toBe(9);
      for (const count of perFamily.values()) {
        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(6);
      }

      // Second run: every fixture row already exists — zero new inserts.
      const second = await seedCandidatesFixture(scopedPool);
      expect(second.inserted).toBe(0);
      expect(second.alreadyPresent).toBe(40);

      const { rows: rowsAfterSecondRun } = await scopedPool.query(
        "SELECT count(*)::int AS n FROM candidates WHERE name LIKE 'Fixture Candidate%'",
      );
      expect(rowsAfterSecondRun[0].n).toBe(40);
    },
    30_000,
  );
});
