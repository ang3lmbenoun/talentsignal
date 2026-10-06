import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HardToFillTargeting } from "./HardToFillTargeting";

const TARGET = {
  opportunityId: "opp-htf",
  company: "Insight Analytics",
  title: "Senior Data Analyst",
  roleType: "data analyst",
  requirements: ["sql", "python", "data visualization", "statistics", "excel"],
  hardToFillScore: 1,
  hardToFillReasons: ["in-demand role type", "open 30 days", "reposted role"],
  students: [
    {
      id: "c1",
      name: "Strong Match",
      experience: 3,
      availability: "immediate",
      fitScore: 0.62,
      matchedSkills: ["sql", "python"],
      reasons: ["matched sql, python (2 of 5 requirements)", "3 years experience"],
    },
    {
      id: "c2",
      name: "No Match",
      experience: 10,
      availability: null,
      fitScore: 0,
      matchedSkills: [],
      reasons: ["no matching skills", "10 years experience"],
    },
  ],
};

describe("HardToFillTargeting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows an expired-session message when no token is stored", async () => {
    render(<HardToFillTargeting />);
    await waitFor(() => expect(screen.getByText(/session has expired/i)).toBeInTheDocument());
  });

  it("pairs a hard-to-fill role with its matched students and reasons (trust scenario)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ suggestion: true, targets: [TARGET] }),
      }),
    );

    render(<HardToFillTargeting />);

    await waitFor(() => expect(screen.getByText("Senior Data Analyst")).toBeInTheDocument());
    const card = screen.getByText("Senior Data Analyst").closest("article");
    expect(card).toHaveTextContent("Insight Analytics");
    expect(card).toHaveTextContent("100% hard to fill");
    expect(card).toHaveTextContent("in-demand role type");
    expect(card).toHaveTextContent("Needs:");
    // Students appear with their fit and the real matched skills — never bare.
    expect(card).toHaveTextContent("Strong Match");
    expect(card).toHaveTextContent("62% fit");
    expect(card).toHaveTextContent("sql");
    expect(card).toHaveTextContent("python");
    // The zero-overlap candidate is honestly labeled, not hidden or faked.
    expect(card).toHaveTextContent("No Match");
    expect(card).toHaveTextContent("no matching skills");
  });

  it("shows the advisory note and has NO submit control (HF-3 trust: human releases)", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ suggestion: true, targets: [TARGET] }),
      }),
    );

    render(<HardToFillTargeting />);

    await waitFor(() => expect(screen.getByText("Senior Data Analyst")).toBeInTheDocument());
    expect(screen.getByText(/a human decides who to submit/i)).toBeInTheDocument();
    // There is deliberately no button that could submit a student.
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an empty state when there are no hard-to-fill roles", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ suggestion: true, targets: [] }),
      }),
    );

    render(<HardToFillTargeting />);

    await waitFor(() => expect(screen.getByText(/no hard-to-fill roles to target/i)).toBeInTheDocument());
  });

  it("shows an error message when the request fails", async () => {
    localStorage.setItem("ts_token", "fake-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    render(<HardToFillTargeting />);

    await waitFor(() => expect(screen.getByText(/Could not load targeting/i)).toBeInTheDocument());
  });
});
