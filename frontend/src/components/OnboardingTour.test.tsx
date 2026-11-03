import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { OnboardingTour, TOUR_STEP_COUNT } from "./OnboardingTour";
import { getTourUserId, hasSeenTour } from "../lib/onboardingTour";

// A structurally valid (unsigned) JWT whose payload is {"sub":"user-1"}. The
// tour only DECODES the payload for the per-user flag; it never verifies it.
function fakeToken(sub: string): string {
  const payload = btoa(JSON.stringify({ sub })).replace(/=+$/, "");
  return `header.${payload}.signature`;
}

const SEEN_KEY = "ts_tour_seen:user-1";

function signIn(sub = "user-1") {
  localStorage.setItem("ts_token", fakeToken(sub));
  localStorage.setItem("ts_role", "admin");
}

describe("OnboardingTour component", () => {
  it("renders step 1 as a labelled, modal dialog", () => {
    render(<OnboardingTour onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("Welcome to TalentSignal");
    expect(screen.getByText(`Step 1 of ${TOUR_STEP_COUNT}`)).toBeInTheDocument();
    // The human-release rule is part of the welcome step.
    expect(screen.getByText(/nothing leaves the platform until a person reviews and releases it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("Next advances and Back returns", () => {
    render(<OnboardingTour onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText(`Step 2 of ${TOUR_STEP_COUNT}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
  });

  it("walks all 7 steps, ending on a Get started button with no Skip", () => {
    render(<OnboardingTour onClose={() => undefined} />);
    for (let i = 1; i < TOUR_STEP_COUNT; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(TOUR_STEP_COUNT).toBe(7);
    expect(screen.getByRole("heading", { name: "You're ready to get started" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get started" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip tour" })).not.toBeInTheDocument();
  });

  it("supports ArrowRight / ArrowLeft / Escape", () => {
    const onClose = vi.fn();
    render(<OnboardingTour onClose={onClose} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByRole("heading", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus: Tab from the last control wraps to the first, Shift+Tab the other way", () => {
    render(<OnboardingTour onClose={() => undefined} />);
    const skip = screen.getByRole("button", { name: "Skip tour" });
    const next = screen.getByRole("button", { name: "Next" });
    const dialog = screen.getByRole("dialog");

    next.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(skip).toHaveFocus();

    skip.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
  });
});

describe("first-run tour in the authenticated app", () => {
  beforeEach(() => {
    // Every screen's fetch rejects uniformly, same stub App.test.tsx uses.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("decodes the user id from the token and tolerates garbage", () => {
    expect(getTourUserId(fakeToken("user-1"))).toBe("user-1");
    expect(getTourUserId("not-a-jwt")).toBeNull();
    expect(getTourUserId(null)).toBeNull();
  });

  it("does not show unless the app opts in (existing tests render <App /> bare)", () => {
    signIn();
    render(<App />);
    expect(screen.queryByRole("dialog", { name: /welcome to talentsignal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take the tour/i })).not.toBeInTheDocument();
  });

  it("never shows on the login screen", () => {
    render(<App onboarding />);
    expect(screen.queryByRole("dialog", { name: /welcome to talentsignal/i })).not.toBeInTheDocument();
  });

  it("shows once after sign-in, and Skip tour sets the seen flag and closes it", async () => {
    signIn();
    render(<App onboarding />);

    expect(await screen.findByRole("dialog", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
    expect(hasSeenTour("user-1")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(screen.queryByRole("dialog", { name: "Welcome to TalentSignal" })).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("the final Get started button closes the tour and sets the flag", async () => {
    signIn();
    render(<App onboarding />);
    await screen.findByRole("dialog", { name: "Welcome to TalentSignal" });

    for (let i = 1; i < TOUR_STEP_COUNT; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(screen.queryByRole("dialog", { name: /ready to get started/i })).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("does not show when this user has already seen it", async () => {
    signIn();
    localStorage.setItem(SEEN_KEY, "1");
    render(<App onboarding />);

    // Wait for the shell to mount (the header link proves the effect ran).
    await screen.findByRole("button", { name: /take the tour/i });
    expect(screen.queryByRole("dialog", { name: "Welcome to TalentSignal" })).not.toBeInTheDocument();
  });

  it("is per user: a different user still sees it", async () => {
    signIn("user-2");
    localStorage.setItem(SEEN_KEY, "1"); // user-1's flag, not user-2's
    render(<App onboarding />);
    expect(await screen.findByRole("dialog", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
  });

  it("'Take the tour' reopens it from step 1 and leaves the seen flag alone", async () => {
    signIn();
    localStorage.setItem(SEEN_KEY, "1");
    render(<App onboarding />);

    fireEvent.click(await screen.findByRole("button", { name: /take the tour/i }));
    expect(await screen.findByRole("dialog", { name: "Welcome to TalentSignal" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Welcome to TalentSignal" })).not.toBeInTheDocument());
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("still works when localStorage throws for the tour's own key", async () => {
    signIn();
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    // Only the tour's key throws; auth reads/writes keep working.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith("ts_tour_seen:")) throw new Error("storage blocked");
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith("ts_tour_seen:")) throw new Error("storage blocked");
      return realSet.call(this, key, value);
    });

    render(<App onboarding />);
    expect(await screen.findByRole("dialog", { name: "Welcome to TalentSignal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog", { name: "Welcome to TalentSignal" })).not.toBeInTheDocument();
  });
});
