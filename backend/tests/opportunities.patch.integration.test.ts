import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

/**
 * S-30b (decision 058): PATCH /api/opportunities/:id is additive and
 * narrow -- only required_skills/required_years are ever writable. Real
 * Postgres, same describeIfDb pattern as every other *.integration.test.ts
 * in this suite, since this exercises a real UPDATE ... RETURNING against
 * the real opportunities table.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("PATCH /api/opportunities/:id (integration, requires DATABASE_URL)", () => {
  const schemaName = `test_opportunities_patch_${randomUUID().replace(/-/g, "_")}`;
  const adminPool = new Pool({ connectionString: DATABASE_URL });
  let scopedPool: Pool;
  let opportunityId: string;

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schemaName}` });
    await runMigrations(scopedPool);

    const { rows } = await scopedPool.query(
      `INSERT INTO opportunities
         (source, external_signal_id, company, title, confidence_score, reasons, weights_version, factor_breakdown,
          hard_to_fill_score, hard_to_fill_reasons, hard_to_fill_factors, hard_to_fill_version)
       VALUES ('mock-job-board', 'ext-patch-1', 'Acme Corp', 'Data Analyst', 0.8, ARRAY['open 5 days'], 'v1', '[]'::jsonb,
               0, ARRAY[]::text[], '[]'::jsonb, 'v1')
       RETURNING id`,
    );
    opportunityId = rows[0].id;
  });

  afterAll(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("saves requiredSkills and requiredYears, and only the sent field(s) change", async () => {
    const app = createApp(scopedPool, noopProvider);

    const skillsRes = await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({ requiredSkills: ["SQL", "Python"] });
    expect(skillsRes.status).toBe(200);
    expect(skillsRes.body.opportunity.requiredSkills).toEqual(["SQL", "Python"]);
    expect(skillsRes.body.opportunity.requiredYears).toBeNull();

    const yearsRes = await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({ requiredYears: 8 });
    expect(yearsRes.status).toBe(200);
    expect(yearsRes.body.opportunity.requiredYears).toBe(8);
    // requiredSkills from the first PATCH is untouched by a years-only PATCH.
    expect(yearsRes.body.opportunity.requiredSkills).toEqual(["SQL", "Python"]);
  });

  it("accepts an empty requiredSkills array as a real, deliberate edit", async () => {
    const app = createApp(scopedPool, noopProvider);

    const res = await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({ requiredSkills: [] });
    expect(res.status).toBe(200);
    expect(res.body.opportunity.requiredSkills).toEqual([]);
  });

  it("returns 400 when neither field is sent", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative requiredYears", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({ requiredYears: -1 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app)
      .patch("/api/opportunities/00000000-0000-0000-0000-000000000000")
      .set("Authorization", salesAuthHeader())
      .send({ requiredYears: 5 });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const app = createApp(scopedPool, noopProvider);
    const res = await request(app).patch(`/api/opportunities/${opportunityId}`).send({ requiredYears: 5 });
    expect(res.status).toBe(401);
  });

  it("a saved edit is authoritative for the fit/recommendation engines (no fallback to the title-derived guess)", async () => {
    const app = createApp(scopedPool, noopProvider);

    await request(app)
      .patch(`/api/opportunities/${opportunityId}`)
      .set("Authorization", salesAuthHeader())
      .send({ requiredSkills: ["Custom Skill"], requiredYears: 3 });

    const res = await request(app)
      .get(`/api/opportunities/${opportunityId}/fits`)
      .set("Authorization", salesAuthHeader());
    expect(res.status).toBe(200);
    // requirementsForTitle("Data Analyst") would normally derive
    // ["sql","python","data visualization","statistics","excel"] -- the
    // saved edit must win instead.
    expect(res.body.requiredSkillsBasis).toBe("measured");
  });
});
