import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { createFakeOpportunityPackagePool } from "./helpers/fakeOpportunityPackagePool";
import { noopProvider } from "./helpers/noopProvider";
import { salesAuthHeader } from "./helpers/authHeader";

async function draftPackage(app: ReturnType<typeof createApp>, opportunityId: string, jobId: string) {
  return request(app)
    .post("/api/opportunity-package/draft")
    .set("Authorization", salesAuthHeader())
    .send({ opportunityId, jobOpeningId: jobId });
}

describe("POST /api/opportunity-package/draft — email draft", () => {
  it("pre-fills draftEmailBody from the deterministic template at draft time", async () => {
    const { pool, seedOpportunity, seedJobOpening, seedCandidate } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity({ company: "GitLab", reasons: ["reposted role"] });
    const job = seedJobOpening({ title: "Analytics role", requirements: ["sql"] });
    seedCandidate({ name: "Jordan Lee", skills: ["sql"], experience: 3 });
    const app = createApp(pool, noopProvider);

    const res = await draftPackage(app, opportunity.id, job.id);

    expect(res.status).toBe(201);
    expect(typeof res.body.package.draftEmailBody).toBe("string");
    expect(res.body.package.draftEmailBody).toContain("Subject: Candidate introduction — Analytics role");
    expect(res.body.package.draftEmailBody).toContain("Jordan Lee");
  });
});

describe("PATCH /api/opportunity-package/:id/email", () => {
  it("saves a human edit to the draft, and GET reflects it (save/load round trip)", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);
    const packageId = draftRes.body.package.id;

    const editedBody = "Subject: Edited by a human\n\nHello team,\n\nCustom outreach text.\n\nBest,\nA Recruiter";
    const patchRes = await request(app)
      .patch(`/api/opportunity-package/${packageId}/email`)
      .set("Authorization", salesAuthHeader())
      .send({ draftEmailBody: editedBody });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.package.draftEmailBody).toBe(editedBody);

    const listRes = await request(app)
      .get("/api/opportunity-packages")
      .set("Authorization", salesAuthHeader());
    expect(listRes.body.packages[0].draftEmailBody).toBe(editedBody);
  });

  it("returns 400 when draftEmailBody is missing or not a string", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);

    const res = await request(app)
      .patch(`/api/opportunity-package/${draftRes.body.package.id}/email`)
      .set("Authorization", salesAuthHeader())
      .send({ draftEmailBody: 12345 });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a package that does not exist", async () => {
    const { pool } = createFakeOpportunityPackagePool();
    const app = createApp(pool, noopProvider);

    const res = await request(app)
      .patch("/api/opportunity-package/does-not-exist/email")
      .set("Authorization", salesAuthHeader())
      .send({ draftEmailBody: "text" });

    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);

    const res = await request(app)
      .patch(`/api/opportunity-package/${draftRes.body.package.id}/email`)
      .send({ draftEmailBody: "text" });

    expect(res.status).toBe(401);
  });

  it("rejects an edit to an already-released package's email draft, and does not change it", async () => {
    const { pool, seedOpportunity, seedJobOpening } = createFakeOpportunityPackagePool();
    const opportunity = seedOpportunity();
    const job = seedJobOpening({ requirements: [] });
    const app = createApp(pool, noopProvider);
    const draftRes = await draftPackage(app, opportunity.id, job.id);
    const packageId = draftRes.body.package.id;
    const originalBody = draftRes.body.package.draftEmailBody;

    await request(app)
      .post(`/api/opportunity-package/${packageId}/release`)
      .set("Authorization", salesAuthHeader());

    const res = await request(app)
      .patch(`/api/opportunity-package/${packageId}/email`)
      .set("Authorization", salesAuthHeader())
      .send({ draftEmailBody: "trying to edit after release" });

    expect(res.status).toBe(409);
    expect(res.body.package.draftEmailBody).toBe(originalBody);
  });
});
