import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeOpportunityRow {
  id: string;
  company: string;
  confidence_score: string;
  reasons: string[];
}

export interface FakeJobOpeningRow {
  id: string;
  title: string;
  requirements: string[];
}

export interface FakeCandidateRow {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
}

export interface FakeOpportunityPackageRow {
  id: string;
  opportunity_id: string;
  job_opening_id: string;
  candidate_ids: string[];
  content: unknown;
  ai_generated: boolean;
  status: "draft" | "released";
  released_by: string | null;
  released_at: string | null;
  draft_email_body: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeReleaseAuditRow {
  id: string;
  package_id: string;
  opportunity_id: string;
  released_by: string;
  released_at: string;
}

/**
 * In-memory stand-in for opportunities + job_openings + candidates (all
 * read-only lookups here, seeded directly) plus opportunity_packages +
 * opportunity_package_release_audit (mutated by the route under test).
 *
 * Like fakeSalesPipelinePool, this needs pool.connect() semantics for the
 * release route's transaction (BEGIN / conditional UPDATE / SELECT / INSERT /
 * COMMIT). Deliberately does NOT implement UPDATE/DELETE against
 * opportunity_package_release_audit — that append-only guarantee is a real DB
 * trigger this fake cannot and should not simulate; it's proven separately by
 * opportunityPackage.appendOnly.integration.test.ts against real Postgres.
 */
export function createFakeOpportunityPackagePool() {
  const opportunities: FakeOpportunityRow[] = [];
  const jobOpenings: FakeJobOpeningRow[] = [];
  const candidates: FakeCandidateRow[] = [];
  const packages: FakeOpportunityPackageRow[] = [];
  const releaseAudit: FakeReleaseAuditRow[] = [];
  let nextOpportunityId = 1;
  let nextJobId = 1;
  let nextCandidateId = 1;
  let nextPackageId = 1;
  let nextAuditId = 1;

  function seedOpportunity(
    overrides: Partial<FakeOpportunityRow> = {},
  ): FakeOpportunityRow {
    const row: FakeOpportunityRow = {
      id: `opportunity-${nextOpportunityId++}`,
      company: "Acme Corp",
      confidence_score: "0.750",
      reasons: ["open 10 days"],
      ...overrides,
    };
    opportunities.push(row);
    return row;
  }

  function seedJobOpening(
    overrides: Partial<FakeJobOpeningRow> & { requirements: string[] },
  ): FakeJobOpeningRow {
    const row: FakeJobOpeningRow = {
      id: `job-${nextJobId++}`,
      title: "Untitled role",
      ...overrides,
    };
    jobOpenings.push(row);
    return row;
  }

  function seedCandidate(
    overrides: Partial<FakeCandidateRow> & { skills: string[] },
  ): FakeCandidateRow {
    const row: FakeCandidateRow = {
      id: `candidate-${nextCandidateId++}`,
      name: "Unnamed Candidate",
      experience: null,
      ...overrides,
    };
    candidates.push(row);
    return row;
  }

  // Plain pool.query() calls — draft creation's reads/write and the list route.
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM opportunities WHERE id")) {
      const [id] = params as [string];
      const row = opportunities.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("SELECT id, title, requirements FROM job_openings WHERE id")) {
      const [id] = params as [string];
      const row = jobOpenings.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith("SELECT id, name, skills, experience FROM candidates")) {
      return { rows: [...candidates] };
    }

    if (sql.includes("INSERT INTO opportunity_packages")) {
      const [opportunityId, jobOpeningId, candidateIds, contentJson, draftEmailBody] = params as [
        string,
        string,
        string[],
        string,
        string | undefined,
      ];
      const now = new Date().toISOString();
      const row: FakeOpportunityPackageRow = {
        id: `package-${nextPackageId++}`,
        opportunity_id: opportunityId,
        job_opening_id: jobOpeningId,
        candidate_ids: candidateIds,
        content: JSON.parse(contentJson),
        ai_generated: true,
        status: "draft",
        released_by: null,
        released_at: null,
        draft_email_body: draftEmailBody ?? null,
        created_at: now,
        updated_at: now,
      };
      packages.push(row);
      return { rows: [row] };
    }

    if (sql.startsWith("SELECT * FROM opportunity_packages ORDER BY")) {
      return { rows: [...packages].reverse() };
    }

    if (sql.includes("UPDATE opportunity_packages") && sql.includes("draft_email_body")) {
      const [draftEmailBody, packageId] = params as [string, string];
      const row = packages.find((r) => r.id === packageId && r.status === "draft");
      if (!row) return { rows: [] };
      row.draft_email_body = draftEmailBody;
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }

    if (sql.startsWith("SELECT * FROM opportunity_packages WHERE id")) {
      const [id] = params as [string];
      const row = packages.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    throw new Error(`fakeOpportunityPackagePool: unexpected pool.query — ${sql}`);
  });

  // The transaction client handed back by pool.connect() for the release route.
  async function clientQuery(sql: string, params: unknown[] = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }

    if (sql.includes("UPDATE opportunity_packages")) {
      const [releasedBy, packageId] = params as [string, string];
      const row = packages.find((r) => r.id === packageId && r.status === "draft");
      if (!row) return { rows: [] };
      row.status = "released";
      row.released_by = releasedBy;
      row.released_at = new Date().toISOString();
      row.updated_at = row.released_at;
      return { rows: [row] };
    }

    if (sql.startsWith("SELECT * FROM opportunity_packages WHERE id")) {
      const [id] = params as [string];
      const row = packages.find((r) => r.id === id);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("INSERT INTO opportunity_package_release_audit")) {
      const [packageId, opportunityId, releasedBy, releasedAt] = params as [
        string,
        string,
        string,
        string,
      ];
      releaseAudit.push({
        id: `audit-${nextAuditId++}`,
        package_id: packageId,
        opportunity_id: opportunityId,
        released_by: releasedBy,
        released_at: releasedAt,
      });
      return { rows: [] };
    }

    throw new Error(`fakeOpportunityPackagePool: unexpected client.query — ${sql}`);
  }

  const connect = vi.fn(async () => ({
    query: vi.fn(clientQuery),
    release: vi.fn(),
  }));

  return {
    pool: { query, connect } as unknown as Pool,
    opportunities,
    jobOpenings,
    candidates,
    packages,
    releaseAudit,
    seedOpportunity,
    seedJobOpening,
    seedCandidate,
  };
}
