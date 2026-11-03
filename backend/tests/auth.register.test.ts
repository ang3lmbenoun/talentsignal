import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeUsersPool } from "./helpers/fakeUsersPool";
import { noopProvider } from "./helpers/noopProvider";

describe("POST /api/auth/register", () => {
  it("happy path: creates a user and never echoes the password hash", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "New.User@Example.com", password: "correct-horse-battery" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: "new.user@example.com",
      displayName: null,
      role: "sales",
    });
    expect(res.body.password_hash).toBeUndefined();
  });

  it("privilege escalation: ignores a role supplied in the request body", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "wannabe-admin@example.com", password: "correct-horse-battery", role: "admin" });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe("sales");
  });

  it("failure: rejects an invalid email", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "correct-horse-battery" });

    expect(res.status).toBe(400);
  });

  it("failure: rejects a password shorter than the minimum", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "short@example.com", password: "short1" });

    expect(res.status).toBe(400);
  });

  it("failure: rejects a password longer than bcrypt's 72-byte limit", async () => {
    const { pool } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "toolong@example.com", password: "x".repeat(73) });

    expect(res.status).toBe(400);
  });

  it("idempotency: a duplicate email is rejected with 409, not a second row", async () => {
    const { pool, rows } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);
    const body = { email: "dupe@example.com", password: "correct-horse-battery" };

    const first = await request(app).post("/api/auth/register").send(body);
    const second = await request(app).post("/api/auth/register").send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(rows).toHaveLength(1);
  });

  it("idempotency: a duplicate email with different casing is still rejected", async () => {
    const { pool, rows } = createFakeUsersPool();
    const app = createApp(pool, noopProvider);

    const first = await request(app)
      .post("/api/auth/register")
      .send({ email: "Casing@Example.com", password: "correct-horse-battery" });
    const second = await request(app)
      .post("/api/auth/register")
      .send({ email: "casing@example.com", password: "another-password-1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(rows).toHaveLength(1);
  });
});
