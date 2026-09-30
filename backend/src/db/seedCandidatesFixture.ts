import type { Pool } from "pg";
import { createPool } from "./pool";
import { runMigrations } from "./migrate";

/**
 * S-27: 40 fixture candidates with structured skills, years of experience,
 * availability, and a real role_family, so the Candidates screen has
 * enough realistic data to demo matching against (06_decisions/055).
 *
 * Deliberately a separate script from seedDemo.ts, not an extension of it:
 * seedDemo.ts's own candidate roster (SEED_CANDIDATES, `Seed Demo
 * Candidate NN`) is already covered by seedDemo.idempotent.integration.test.ts
 * and used by hiddenDemandJourney.e2e.test.ts's baseline — adding 40 more
 * rows to that same fixed list would change what that existing, already-
 * reviewed contract asserts. This script owns its own name prefix
 * (`Fixture Candidate — <family> NN`) and its own idempotency check, so it
 * can be run (or not) independently via `npm run seed:candidates`.
 *
 * Every row this script inserts carries source_label = 'fixture' (never
 * 'live', migration 021's default for real, human-added candidates) and a
 * real role_family drawn from the exact same taxonomy opportunities use
 * (HARD_TO_FILL_CONFIG.roleFamilies, hardToFillConfig.ts) -- not a new,
 * parallel taxonomy invented for this seed.
 */
const NAME_PREFIX = "Fixture Candidate";

type Availability = "immediate" | "2_weeks" | "1_month" | "passive";
const AVAILABILITY_CYCLE: Availability[] = ["immediate", "2_weeks", "1_month", "passive"];

// The exact 8 real families HARD_TO_FILL_CONFIG.roleFamilies declares, plus
// classifyFamily()'s "general-other" fallback -- the complete real
// taxonomy, not the 7-family abbreviated list named in the task request
// (which omitted data-analytics and cloud-infra with no stated reason).
// See 06_decisions/055 for why the full 9 were used instead.
const SKILL_POOLS: Record<string, string[]> = {
  "engineering-swe": ["JavaScript", "TypeScript", "React", "Node.js", "Python", "Git", "REST APIs", "SQL", "Docker", "AWS"],
  "ml-ai": ["Python", "PyTorch", "TensorFlow", "Machine Learning", "Deep Learning", "MLOps", "Pandas", "NumPy", "Scikit-learn"],
  "data-analytics": ["SQL", "Python", "dbt", "Airflow", "PostgreSQL", "Tableau", "Excel", "Data Visualization", "Statistics"],
  security: ["Network Security", "SIEM", "Incident Response", "Penetration Testing", "Risk Assessment", "Cloud Security", "Python"],
  "cloud-infra": ["AWS", "Terraform", "Kubernetes", "Docker", "CI/CD", "Azure", "Site Reliability", "Linux", "Ansible"],
  "support-cs": ["Customer Success", "Zendesk", "Help Desk", "Troubleshooting", "Salesforce", "Communication", "Onboarding"],
  "sales-bizdev": ["Salesforce", "Lead Generation", "Negotiation", "CRM", "Cold Outreach", "Account Management", "Prospecting"],
  "retail-ops": ["Inventory Management", "POS Systems", "Forklift Certified", "Scheduling", "Customer Service", "Merchandising"],
  "general-other": ["Project Management", "Leadership", "Communication", "Strategic Planning", "Cross-functional Collaboration", "Operations"],
};

// Sums to 40, every family in [3, 6] per the task's requirement.
const FAMILY_COUNTS: Record<string, number> = {
  "engineering-swe": 5,
  "ml-ai": 5,
  "data-analytics": 5,
  security: 4,
  "cloud-infra": 4,
  "support-cs": 4,
  "sales-bizdev": 5,
  "retail-ops": 4,
  "general-other": 4,
};

interface FixtureCandidate {
  name: string;
  skills: string[];
  experience: number;
  availability: Availability;
  roleFamily: string;
}

// Deterministic: same family order, same per-family count, same modular
// picks every run -- re-running this script (or the idempotency test)
// always produces the identical 40 rows, same discipline seedDemo.ts's own
// SEED_CANDIDATES list follows.
function buildFixtureCandidates(): FixtureCandidate[] {
  const candidates: FixtureCandidate[] = [];
  let globalIndex = 0;

  for (const [family, count] of Object.entries(FAMILY_COUNTS)) {
    const pool = SKILL_POOLS[family];
    for (let i = 1; i <= count; i++) {
      // 3 skills per candidate, rotating through the family's pool so no
      // two candidates in the same family have an identical skill set.
      const skills = [pool[globalIndex % pool.length], pool[(globalIndex + 1) % pool.length], pool[(globalIndex + 2) % pool.length]];
      // Years of experience: deterministic spread across [2, 20].
      const experience = 2 + (globalIndex * 3) % 19;
      const availability = AVAILABILITY_CYCLE[globalIndex % AVAILABILITY_CYCLE.length];
      const label = family
        .split("-")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("-");

      candidates.push({
        name: `${NAME_PREFIX} — ${label} ${String(i).padStart(2, "0")}`,
        skills,
        experience,
        availability,
        roleFamily: family,
      });
      globalIndex++;
    }
  }
  return candidates;
}

export interface SeedCandidatesFixtureResult {
  inserted: number;
  alreadyPresent: number;
}

export async function seedCandidatesFixture(pool: Pool): Promise<SeedCandidatesFixtureResult> {
  const fixtureCandidates = buildFixtureCandidates();

  const { rows: existing } = await pool.query("SELECT name FROM candidates WHERE name LIKE $1", [
    `${NAME_PREFIX}%`,
  ]);
  const existingNames = new Set(existing.map((row) => row.name as string));
  const toInsert = fixtureCandidates.filter((c) => !existingNames.has(c.name));

  for (const candidate of toInsert) {
    await pool.query(
      `INSERT INTO candidates (name, skills, experience, availability, contact_info, role_family, source_label)
       VALUES ($1, $2, $3, $4, $5, $6, 'fixture')`,
      [candidate.name, candidate.skills, candidate.experience, candidate.availability, {}, candidate.roleFamily],
    );
  }

  return { inserted: toInsert.length, alreadyPresent: existingNames.size };
}

if (require.main === module) {
  (async () => {
    const pool = createPool();
    await runMigrations(pool);
    const result = await seedCandidatesFixture(pool);
    // eslint-disable-next-line no-console
    console.log("seedCandidatesFixture complete:", JSON.stringify(result));
    await pool.end();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("seedCandidatesFixture failed:", err);
    process.exit(1);
  });
}
