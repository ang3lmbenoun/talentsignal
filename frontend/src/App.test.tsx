import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { storeRole, storeToken } from "./auth";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows the backend as reachable when /api/health resolves ok (happy path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", db: "ok" }),
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Workspace ready/i)).toBeInTheDocument(),
    );
  });

  it("shows an unreachable message when the fetch fails (failure path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Some workspace data may be unavailable/i)).toBeInTheDocument(),
    );
  });

  // These two close a real gap: until now, nothing in this suite ever
  // rendered <App/> WITH a stored token, so RoleGate's wiring here
  // (06_decisions/022) was never exercised end-to-end — only in isolation
  // via RoleGate.test.tsx. Fetch is stubbed to reject uniformly; each
  // screen's own synchronous initial-render text (before that rejection
  // settles) is what's being checked — RoleGate hiding a screen means that
  // text never appears at all, not just that it later shows an error.
  it("shows a recruiter's allowed screens and hides admin/sales-only ones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    storeToken("fake-token");
    storeRole("recruiter");

    render(<App />);

    // CandidatesScreen: admin/sales/recruiter — allowed.
    expect(screen.getByText(/Loading candidates/i)).toBeInTheDocument();
    // SalesPipelineBoard: admin/sales only — a recruiter should never see
    // this screen mount at all.
    expect(screen.queryByText(/Loading pipeline/i)).not.toBeInTheDocument();
  });

  it("shows a sales user's allowed screens and hides admin/recruiter-only ones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    storeToken("fake-token");
    storeRole("sales");

    render(<App />);

    // SalesPipelineBoard: admin/sales — allowed.
    expect(screen.getByText(/Loading pipeline/i)).toBeInTheDocument();
    // RecommendationScreen: admin/recruiter only — a sales user should
    // never see this screen mount at all.
    expect(screen.queryByLabelText("recommendation engine")).not.toBeInTheDocument();
  });
});
