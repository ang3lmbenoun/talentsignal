import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../src/app";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

interface FakeOpportunityRow {
  id: string;
  title: string;
  family_key: string | null;
}

interface FakeCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  role_family: string | null;
  availability: string | null;
}

function createFakePool(opportunities: FakeOpportunityRow[], candidates: FakeCandidateRow[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM opportunities WHERE id")) {
      const [id] = params as [string];
      const row = opportunities.find((o) => o.id === id);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("FROM candidates")) {
      return { rows: candidates };
    }
    throw new Error(`createFakePool: unexpected query — ${sql}`);
  });
  return { query } as unknown as Pool;
}

describe("GET /api/opportunities/:id/recommendation", () => {
  it("returns a structured recommendation for a real opportunity", async () => {
    const pool = createFakePool(
      [{ id: "opp-1", title: "Data Analyst", family_key: "data-analytics" }],
      [
        { id: "cand-1", name: "Full Overlap", skills: ["sql", "python", "data visualization", "statistics", "excel"], experience: 4, role_family: "data-analytics", availability: "immediate" },
      ],
    );
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/opportunities/opp-1/recommendation")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.opportunityId).toBe("opp-1");
    expect(["no_action", "loosen_years", "loosen_skills", "add_candidates"]).toContain(res.body.kind);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const pool = createFakePool([], []);
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/opportunities/does-not-exist/recommendation")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const pool = createFakePool([], []);
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/opportunities/opp-1/recommendation");

    expect(res.status).toBe(401);
  });
});
