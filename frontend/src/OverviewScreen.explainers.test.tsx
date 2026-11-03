import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OverviewScreen } from "./OverviewScreen";

// Every endpoint except the two list counts fails; the KPI tiles still render
// (each tile has its own independent fetch/state machine).
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/clients") return { ok: true, status: 200, json: async () => ({ clients: [] }) };
      if (url === "/api/candidates") return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    }),
  );
}

describe("Overview KPI tile explainers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('puts a "How is this counted?" popover on each tile and opens it on click', async () => {
    localStorage.setItem("ts_token", "fake-token");
    localStorage.setItem("ts_role", "admin");
    stubFetch();
    render(<OverviewScreen onNavigate={() => undefined} />);

    const triggers = await screen.findAllByRole("button", { name: /How is this counted\?/ });
    expect(triggers.length).toBeGreaterThanOrEqual(7);

    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(triggers[0]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent("hard-to-fill cut-off");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
  });

  it('replaces "0" client records with an empty state', async () => {
    localStorage.setItem("ts_token", "fake-token");
    localStorage.setItem("ts_role", "admin");
    stubFetch();
    render(<OverviewScreen onNavigate={() => undefined} />);

    expect(await screen.findByText("No client records yet")).toBeInTheDocument();
  });
});
