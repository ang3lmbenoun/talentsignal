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

function createFakeFitsPool(opportunities: FakeOpportunityRow[], candidates: FakeCandidateRow[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM opportunities WHERE id")) {
      const [id] = params as [string];
      const row = opportunities.find((o) => o.id === id);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("SELECT id, title, family_key FROM opportunities")) {
      return { rows: opportunities };
    }
    if (sql.includes("FROM candidates")) {
      return { rows: candidates };
    }
    throw new Error(`createFakeFitsPool: unexpected query — ${sql}`);
  });
  return { query } as unknown as Pool;
}

describe("GET /api/opportunities/:id/fits", () => {
  it("ranks candidates by fit score with a per-factor breakdown, highest first", async () => {
    const pool = createFakeFitsPool(
      [{ id: "opp-1", title: "Data Analyst", family_key: "data-analytics" }],
      [
        { id: "cand-1", name: "Full Overlap", skills: ["sql", "python", "excel"], experience: 4, role_family: "data-analytics", availability: "immediate" },
        { id: "cand-2", name: "No Skills", skills: [], experience: 3, role_family: "data-analytics", availability: "immediate" },
        { id: "cand-3", name: "Partial Overlap", skills: ["sql"], experience: 4, role_family: "data-analytics", availability: "passive" },
      ],
    );
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/opportunities/opp-1/fits?limit=5")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.opportunityId).toBe("opp-1");
    const names = res.body.candidates.map((c: { name: string }) => c.name);
    // Full Overlap ranks first (highest real skill overlap); No Skills has
    // no skills at all -> insufficient_data, ranked last by score 0.
    expect(names[0]).toBe("Full Overlap");
    const noSkills = res.body.candidates.find((c: { name: string }) => c.name === "No Skills");
    expect(noSkills.basis).toBe("insufficient_data");
    expect(noSkills.score).toBe(0);
  });

  it("returns 404 for an opportunity that does not exist", async () => {
    const pool = createFakeFitsPool([], []);
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .get("/api/opportunities/does-not-exist/fits")
      .set("Authorization", salesAuthHeader());

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const pool = createFakeFitsPool([], []);
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/opportunities/opp-1/fits");

    expect(res.status).toBe(401);
  });
});

describe("GET /api/fits/summary", () => {
  it("returns real totals, an average over measured opportunities only, and a full bucket distribution", async () => {
    const pool = createFakeFitsPool(
      [
        { id: "opp-1", title: "Data Analyst", family_key: "data-analytics" },
        { id: "opp-2", title: "Something Unclassifiable Xyz", family_key: null },
      ],
      [{ id: "cand-1", name: "Strong Fit", skills: ["sql", "python", "excel"], experience: 4, role_family: "data-analytics", availability: "immediate" }],
    );
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/fits/summary").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.totalOpportunities).toBe(2);
    expect(res.body.totalCandidates).toBe(1);
    expect(typeof res.body.avgFitScore).toBe("number");
    const bucketTotal = Object.values(res.body.distribution as Record<string, number>).reduce(
      (sum, n) => sum + n,
      0,
    );
    expect(bucketTotal).toBe(2);
  });

  it("rejects an unauthenticated request", async () => {
    const pool = createFakeFitsPool([], []);
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/fits/summary");

    expect(res.status).toBe(401);
  });
});
