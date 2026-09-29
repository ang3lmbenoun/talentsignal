import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeAuditRow {
  client_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
}

export interface FakeOpportunityRow {
  confidence_score: number;
  source: string;
}

export interface FakeClientRow {
  id: string;
  name: string;
}

/**
 * In-memory stand-in for sales_pipeline_audit + opportunities — the only two
 * tables analytics.ts ever reads. Deliberately has no candidates/clients
 * backing at all: none of the three KPIs touch either table, which is
 * exactly the property the PII trust test proves against a real registry.
 *
 * The three query "implementations" below mirror analytics.ts's SQL exactly
 * (event-based placements-per-month, first-audit-row-to-closed
 * time-to-hire, seed-excluded demand score) so a test asserting a specific
 * number is testing the KPI DEFINITION, not an artifact of how the fake
 * happens to be built.
 */
export function createFakeAnalyticsPool() {
  const auditRows: FakeAuditRow[] = [];
  const opportunities: FakeOpportunityRow[] = [];
  const clients: FakeClientRow[] = [];

  function seedClient(overrides: FakeClientRow): FakeClientRow {
    clients.push(overrides);
    return overrides;
  }

  function seedAuditRow(overrides: {
    clientId: string;
    fromStage: string | null;
    toStage: string;
    changedAt: string;
  }): FakeAuditRow {
    const row: FakeAuditRow = {
      client_id: overrides.clientId,
      from_stage: overrides.fromStage,
      to_stage: overrides.toStage,
      changed_at: overrides.changedAt,
    };
    auditRows.push(row);
    return row;
  }

  function seedOpportunity(overrides: Partial<FakeOpportunityRow> = {}): FakeOpportunityRow {
    const row: FakeOpportunityRow = {
      confidence_score: 0.5,
      source: "mock-job-board",
      ...overrides,
    };
    opportunities.push(row);
    return row;
  }

  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM sales_pipeline_audit") && sql.includes("GROUP BY month") && !sql.includes("first_events")) {
      const counts = new Map<string, number>();
      for (const row of auditRows) {
        if (row.to_stage !== "closed") continue;
        const month = row.changed_at.slice(0, 7);
        counts.set(month, (counts.get(month) ?? 0) + 1);
      }
      const rows = [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([month, count]) => ({ month, count }));
      return { rows };
    }

    if (sql.includes("WITH first_events") && !sql.includes("GROUP BY month")) {
      const firstByClient = new Map<string, string>();
      for (const row of auditRows) {
        const existing = firstByClient.get(row.client_id);
        if (!existing || row.changed_at < existing) firstByClient.set(row.client_id, row.changed_at);
      }
      const days = auditRows
        .filter((row) => row.to_stage === "closed" && firstByClient.has(row.client_id))
        .map((row) => {
          const firstAt = new Date(firstByClient.get(row.client_id)!).getTime();
          const closedAt = new Date(row.changed_at).getTime();
          return (closedAt - firstAt) / 86_400_000;
        });
      const sampleSize = days.length;
      const averageDays = sampleSize === 0 ? null : days.reduce((a, b) => a + b, 0) / sampleSize;
      return { rows: [{ average_days: averageDays, sample_size: sampleSize }] };
    }

    if (sql.includes("FROM opportunities WHERE source")) {
      const included = opportunities.filter((o) => o.source !== "seed-job-board");
      const sampleSize = included.length;
      const average =
        sampleSize === 0 ? null : included.reduce((a, o) => a + o.confidence_score, 0) / sampleSize;
      return { rows: [{ average, sample_size: sampleSize }] };
    }

    if (sql.includes("WITH first_events") && sql.includes("GROUP BY month")) {
      const firstByClient = new Map<string, string>();
      for (const row of auditRows) {
        const existing = firstByClient.get(row.client_id);
        if (!existing || row.changed_at < existing) firstByClient.set(row.client_id, row.changed_at);
      }
      const byMonth = new Map<string, number[]>();
      for (const row of auditRows) {
        if (row.to_stage !== "closed" || !firstByClient.has(row.client_id)) continue;
        const firstAt = new Date(firstByClient.get(row.client_id)!).getTime();
        const closedAt = new Date(row.changed_at).getTime();
        const month = row.changed_at.slice(0, 7);
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month)?.push((closedAt - firstAt) / 86_400_000);
      }
      const rows = [...byMonth.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([month, days]) => ({
          month,
          average_days: days.reduce((a, b) => a + b, 0) / days.length,
          sample_size: days.length,
        }));
      return { rows };
    }

    if (sql.includes("JOIN clients c ON c.id = spa.client_id")) {
      const counts = new Map<string, number>();
      for (const row of auditRows) {
        if (row.to_stage !== "closed") continue;
        counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1);
      }
      const clientsById = new Map(clients.map((c) => [c.id, c.name]));
      const rows = [...counts.entries()]
        .filter(([clientId]) => clientsById.has(clientId))
        .map(([clientId, count]) => ({ client_id: clientId, client_name: clientsById.get(clientId)!, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      return { rows };
    }

    throw new Error(`fakeAnalyticsPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    auditRows,
    opportunities,
    clients,
    seedAuditRow,
    seedOpportunity,
    seedClient,
  };
}
