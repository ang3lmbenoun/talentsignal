import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { OpportunitiesList } from "./OpportunitiesList";

// Explainers pass: the card now leads with a plain verdict and a contribution
// bar. The raw numbers must still be in the DOM under "Show the math".

const OPPORTUNITY = {
  id: "opp-1",
  company: "Acme Corp",
  title: "Backend Engineer",
  confidenceScore: 0.72,
  reasons: ["open 191 days", "no salary range"],
  source: "greenhouse",
  weightsVersion: "confidence-007-v1",
  factors: [
    { factor: "baseScore", weight: 0.2, value: 1, contribution: 0.2 },
    { factor: "daysOpen", weight: 0.32, value: 1, contribution: 0.32 },
    { factor: "missingSalaryRange", weight: 0.16, value: 1, contribution: 0.16 },
  ],
};

async function renderCard(opportunity: Record<string, unknown>) {
  localStorage.setItem("ts_token", "fake-token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ opportunities: [opportunity] }) }),
  );
  render(<OpportunitiesList />);
  fireEvent.click(await screen.findByRole("button", { name: "View all opportunities (flat grid)" }));
  const heading = await screen.findByRole("heading", { name: String(opportunity.company) });
  return heading.closest("li") as HTMLElement;
}

describe("opportunity card explainers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("leads with one plain-language verdict built from the card's own facts", async () => {
    const card = await renderCard(OPPORTUNITY);
    expect(within(card).getByText("Open 191 days with no salary posted, so this is worth a closer look.")).toBeInTheDocument();
  });

  it("replaces the factor bullet list with a contribution bar, and says what would change", async () => {
    const card = await renderCard(OPPORTUNITY);
    const bar = within(card).getByRole("group", { name: "Demand evidence: what moved the score" });
    expect(within(bar).getAllByRole("button")).toHaveLength(3);
    expect(within(card).getByText(/This would change with the posting being filled or closed and a salary range being added\./)).toBeInTheDocument();
  });

  it("keeps the raw weights, values and weights version in the DOM under Show the math", async () => {
    const card = await renderCard(OPPORTUNITY);
    const math = within(card).getByText("Show the math").closest("details") as HTMLElement;
    expect(math).toHaveTextContent("Why this score (weights confidence-007-v1)");
    expect(math).toHaveTextContent("daysOpen: weight 0.32, value 1, contributes 0.32");
    // Collapsed by default.
    expect(math).not.toHaveAttribute("open");
  });

  it("opens a one-line definition when the evidence chip is clicked", async () => {
    const card = await renderCard(OPPORTUNITY);
    expect(within(card).queryByText(/^None: there is no role-scarcity evidence/)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /No role-scarcity evidence · none/ }));
    expect(within(card).getByText(/^None: there is no role-scarcity evidence/)).toBeInTheDocument();
  });

  it("never says hard to fill for an un-flagged posting", async () => {
    const card = await renderCard(OPPORTUNITY);
    expect(card).not.toHaveTextContent("hard to fill");
  });

  it("says in plain words that a flagged source's score is a signal, not proof", async () => {
    const card = await renderCard({ ...OPPORTUNITY, source: "lever" });
    expect(within(card).getByRole("note", { name: "" })).toHaveTextContent(
      "This source is flagged: its posting dates look unusually old",
    );
    expect(card).toHaveTextContent("Treat this score as a signal to check, not proof.");
  });

  it("adds a second bar for the hard-to-fill score only when the posting is flagged", async () => {
    const card = await renderCard({
      ...OPPORTUNITY,
      company: "Insight Analytics",
      hardToFill: true,
      hardToFillScore: 1,
      hardToFillReasons: ["in-demand role type"],
      hardToFillVersion: "hard-to-fill-026-v1",
      hardToFillFactors: [
        { factor: "roleScarcity", weight: 0.6, value: 1, contribution: 0.6, basis: "measured" },
        { factor: "daysOpen", weight: 0.4, value: 0.5, contribution: 0.2 },
      ],
    });
    expect(within(card).getByRole("group", { name: "Hard-to-fill signal: what moved the score" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Why hard to fill (weights hard-to-fill-026-v1)");
    expect(card).toHaveTextContent("roleScarcity: weight 0.6, value 1, contributes 0.6, basis: measured");
  });
});
