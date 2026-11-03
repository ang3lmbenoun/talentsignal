import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { App } from "../App";
import { OnboardingTour } from "./OnboardingTour";

// ---- A fake "app": one screen per view, hidden unless active, like App ------
// Each screen carries the data-tour element the real screen carries, so these
// tests exercise the tour's own navigate -> wait -> spotlight logic.

const SCREEN_TARGETS: Record<string, string[]> = {
  overview: ["overview-kpis"],
  signals: ["signals-source-panel"],
  opportunities: ["opportunity-verdict", "opportunity-bar"],
  targeting: ["targeting-company-grouping"],
  candidates: ["candidates-fit"],
  packages: ["packages-draft-form"], // no editor yet: the form is the fallback target
};

function Harness({ omit = [], onClose = () => undefined }: { omit?: string[]; onClose?: (r?: string) => void }) {
  const [view, setView] = useState("overview");
  return (
    <>
      <output data-testid="current-view">{view}</output>
      {Object.entries(SCREEN_TARGETS).map(([name, targets]) => (
        <div key={name} hidden={view !== name}>
          {targets.filter((t) => !omit.includes(t)).map((t) => (
            <div key={t} data-tour={t}>{t}</div>
          ))}
        </div>
      ))}
      <OnboardingTour onNavigate={setView} onClose={onClose} locateTimeoutMs={60} />
    </>
  );
}

const EXPECTED_VIEW_BY_TITLE: [string, string][] = [
  ["Overview", "overview"],
  ["Signals", "signals"],
  ["Opportunities", "opportunities"],
  ["Hard-to-fill targeting", "targeting"],
  ["Candidates", "candidates"],
  ["Packages (drafts)", "packages"],
];

describe("guided tour: navigate, wait, spotlight", () => {
  it("shows the welcome step centered, with no spotlight", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
    expect(screen.queryByTestId("tour-spotlight")).not.toBeInTheDocument();
  });

  it("each screen step navigates to its screen and spotlights the target", async () => {
    render(<Harness />);
    for (const [title, view] of EXPECTED_VIEW_BY_TITLE) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      // The tour asked the app to navigate...
      await waitFor(() => expect(screen.getByTestId("current-view")).toHaveTextContent(view));
      // ...and, once the target exists, drew the spotlight and anchored the card.
      expect(await screen.findByTestId("tour-spotlight")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toHaveClass("tour-card-shell--anchored");
    }
  });

  it("keeps Back / Next / Skip, progress dots and the aria dialog in guided mode", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByTestId("tour-spotlight");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Overview");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tour progress" }).children).toHaveLength(8);
  });

  it("the final step is a centered card with a Get started button", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("heading", { name: "You're ready to get started?" })).toBeInTheDocument();
    expect(screen.queryByTestId("tour-spotlight")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveClass("tour-card-shell--anchored");

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onClose).toHaveBeenCalledWith("finish");
  });

  it("falls back to the centered card, without crashing, when the target is missing", async () => {
    render(<Harness omit={["overview-kpis"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Still on the Overview step, still navigated there, still usable...
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-view")).toHaveTextContent("overview"));
    // ...but no spotlight: after the (short) timeout it is the plain centered card.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByTestId("tour-spotlight")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveClass("tour-card-shell--anchored");
    // The illustration is back, standing in for the missing screen element.
    expect(screen.getByText("Illustration")).toBeInTheDocument();

    // And the tour keeps working.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Signals" })).toBeInTheDocument();
  });

  it("does not spotlight a target that is on a hidden screen", async () => {
    // Targets exist but the tour is not allowed to navigate (no onNavigate),
    // so the screen stays hidden -> treated as missing -> centered fallback.
    render(
      <>
        <div hidden>
          <div data-tour="overview-kpis">hidden kpis</div>
        </div>
        <OnboardingTour onClose={() => undefined} locateTimeoutMs={60} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByTestId("tour-spotlight")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("opens the opportunity card grid for its step and puts the screen back afterwards", async () => {
    const clicks: string[] = [];
    function OpportunitiesFake() {
      const [grid, setGrid] = useState(false);
      return (
        <div>
          {!grid ? (
            <button data-tour="opportunities-view-all" onClick={() => { clicks.push("view-all"); setGrid(true); }}>
              View all
            </button>
          ) : (
            <>
              <button data-tour="opportunities-back" onClick={() => { clicks.push("back"); setGrid(false); }}>Back</button>
              <p data-tour="opportunity-verdict">verdict</p>
              <div data-tour="opportunity-bar">bar</div>
            </>
          )}
        </div>
      );
    }
    render(
      <>
        <OpportunitiesFake />
        <OnboardingTour onClose={() => undefined} onNavigate={() => undefined} locateTimeoutMs={500} />
      </>,
    );

    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Opportunities" })).toBeInTheDocument();
    // The tour clicked the screen's own "view all" button, found the card, spotlighted it.
    expect(await screen.findByTestId("tour-spotlight")).toBeInTheDocument();
    expect(clicks).toEqual(["view-all"]);

    // Leaving the step restores the grouped view.
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    await waitFor(() => expect(clicks).toEqual(["view-all", "back"]));
  });
});

// ---- In the real App ---------------------------------------------------------

function fakeToken(sub: string): string {
  const payload = btoa(JSON.stringify({ sub })).replace(/=+$/, "");
  return `header.${payload}.signature`;
}

describe("guided tour in the real app", () => {
  beforeEach(() => {
    localStorage.setItem("ts_token", fakeToken("user-1"));
    localStorage.setItem("ts_role", "admin");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("Skip sets the seen flag and returns to the screen the user started on", async () => {
    render(<App onboarding />);
    await screen.findByRole("dialog", { name: "Welcome to TalentSignal" });

    // Move the tour onto another screen, then skip.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Signals" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("ts_tour_seen:user-1")).toBe("1");
    // Started on Overview, so that is where we land (the Overview region is visible).
    expect(screen.getByRole("region", { name: "overview" })).toBeInTheDocument();
  });

  it("Get started closes the tour, sets the flag and lands on Overview", async () => {
    render(<App onboarding />);
    await screen.findByRole("dialog", { name: "Welcome to TalentSignal" });

    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The tour has been walking through screens: the last one visited was Packages.
    expect(screen.queryByRole("region", { name: "overview" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("ts_tour_seen:user-1")).toBe("1");
    expect(screen.getByRole("region", { name: "overview" })).toBeInTheDocument();
  });
});
