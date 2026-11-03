import { vi } from "vitest";
import type { Pool } from "pg";

export interface FakeUserRow {
  id: string;
  email: string;
  password_hash: string;
  // Migration 023 added users.display_name (nullable); new rows start NULL.
  display_name: string | null;
  role: string;
}

/**
 * A hand-rolled in-memory stand-in for the users table, just faithful enough
 * to exercise the two behaviors that matter in these unit tests: the
 * lower(email) uniqueness check (throwing the same shape of error Postgres
 * would — a plain Error with .code === "23505") and the SELECT login relies
 * on. It does not prove the real database enforces this under concurrency —
 * that's what the DATABASE_URL-gated integration test is for.
 */
export function createFakeUsersPool() {
  const rows: FakeUserRow[] = [];
  let nextId = 1;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO users")) {
      const [email, passwordHash, role] = params as [string, string, string];
      if (rows.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
        const err = new Error(
          "duplicate key value violates unique constraint",
        ) as Error & { code: string };
        err.code = "23505";
        throw err;
      }
      const row: FakeUserRow = { id: String(nextId++), email, password_hash: passwordHash, display_name: null, role };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes("SELECT id, email, password_hash, display_name, role FROM users")) {
      const [email] = params as [string];
      const match = rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
      return { rows: match ? [match] : [] };
    }

    throw new Error(`fakeUsersPool: unexpected query — ${sql}`);
  });

  return {
    pool: { query } as unknown as Pool,
    rows,
  };
}
