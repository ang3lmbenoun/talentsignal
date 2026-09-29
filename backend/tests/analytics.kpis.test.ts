import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeAnalyticsPool } from "./helpers/fakeAnalyticsPool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

describe("GET /api/analytics", () => {
  it("computes the three KPIs correctly from seeded pipeline/audit/opportunity data", async () => {
    const { pool, seedAuditRow, seedOpportunity } = createFakeAnalyticsPool();

    // Client A: entered Jan 5, closed Jan 20 -> 15 days, 1 placement in January.
    seedAuditRow({ clientId: "client-a", fromStage: null, toStage: "prospecting", changedAt: "2026-01-05T00:00:00Z" });
    seedAuditRow({ clientId: "client-a", fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-20T00:00:00Z" });

    // Client B: entered Feb 1, closed Feb 10 (9 days, 1 placement in Feb),
    // reopened to negotiation, closed again Mar 1 (28 days from original
    // entry, 1 placement in March) — the reopen-then-reclose double-count
    // 06_decisions/020 accepts as an honest event-log artifact.
    seedAuditRow({ clientId: "client-b", fromStage: null, toStage: "prospecting", changedAt: "2026-02-01T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "prospecting", toStage: "closed", changedAt: "2026-02-10T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "closed", toStage: "negotiation", changedAt: "2026-02-15T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "negotiation", toStage: "closed", changedAt: "2026-03-01T00:00:00Z" });

    seedOpportunity({ confidence_score: 0.9, source: "mock-job-board" });
    seedOpportunity({ confidence_score: 0.7, source: "mock-job-board" });
    // Excluded from demand score, same as hiddenDemand.ts's includeSeedData default.
    seedOpportunity({ confidence_score: 0.1, source: "seed-job-board" });

    const app = createApp(pool, noopProvider);
    const res = await request(app).get("/api/analytics").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.placementsPerMonth).toEqual([
      { month: "2026-01", count: 1 },
      { month: "2026-02", count: 1 },
      { month: "2026-03", count: 1 },
    ]);

    // (15 + 9 + 28) / 3 = 17.333... -> rounded to 1 decimal.
    expect(res.body.timeToHire.sampleSize).toBe(3);
    expect(res.body.timeToHire.averageDays).toBeCloseTo(17.3, 5);

    // (0.9 + 0.7) / 2 = 0.8 — the 0.9 duplicate-shape seed above and the
    // 0.1 seed-job-board row are both excluded.
    expect(res.body.demandScore.sampleSize).toBe(2);
    expect(res.body.demandScore.average).toBeCloseTo(0.8, 5);
  });

  it("computes per-month time-to-hire and top clients by real placements (S-25)", async () => {
    const { pool, seedAuditRow, seedClient } = createFakeAnalyticsPool();
    seedClient({ id: "client-a", name: "Acme Corp" });
    seedClient({ id: "client-b", name: "Beta Inc" });

    seedAuditRow({ clientId: "client-a", fromStage: null, toStage: "prospecting", changedAt: "2026-01-05T00:00:00Z" });
    seedAuditRow({ clientId: "client-a", fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-20T00:00:00Z" });

    seedAuditRow({ clientId: "client-b", fromStage: null, toStage: "prospecting", changedAt: "2026-01-01T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "prospecting", toStage: "closed", changedAt: "2026-01-11T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "closed", toStage: "negotiation", changedAt: "2026-02-01T00:00:00Z" });
    seedAuditRow({ clientId: "client-b", fromStage: "negotiation", toStage: "closed", changedAt: "2026-02-15T00:00:00Z" });

    const app = createApp(pool, noopProvider);
    const res = await request(app).get("/api/analytics").set("Authorization", salesAuthHeader());

    expect(res.status).toBe(200);
    // Jan: client-a 15 days + client-b 10 days, averaged -> 12.5.
    expect(res.body.timeToHirePerMonth).toEqual([
      { month: "2026-01", averageDays: 12.5, sampleSize: 2 },
      { month: "2026-02", averageDays: 45, sampleSize: 1 },
    ]);
    // client-b closed twice, client-a once — ranked by real placement count.
    expect(res.body.topClientsByPlacements).toEqual([
      { clientId: "client-b", clientName: "Beta Inc", count: 2 },
      { clientId: "client-a", clientName: "Acme Corp", count: 1 },
    ]);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool } = createFakeAnalyticsPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app).get("/api/analytics");

    expect(res.status).toBe(401);
  });
});
