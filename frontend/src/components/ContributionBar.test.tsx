import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ContributionBar } from "./ContributionBar";

const FACTORS = [
  { factor: "baseScore", weight: 0.2, value: 1, contribution: 0.2 },
  { factor: "daysOpen", weight: 0.32, value: 0.8, contribution: 0.256 },
  { factor: "repostedRole", weight: 0.32, value: 0, contribution: 0 },
  { factor: "missingSalaryRange", weight: 0.16, value: 1, contribution: 0.16 },
];

describe("ContributionBar", () => {
  it("renders a labelled group with one focusable segment per contributing factor", () => {
    render(<ContributionBar title="Demand evidence" factors={FACTORS} />);

    const group = screen.getByRole("group", { name: "Demand evidence: what moved the score" });
    const segments = within(group).getAllByRole("button");
    // The reposted factor contributed nothing, so it has no segment...
    expect(segments).toHaveLength(3);
    // ...but it still appears in the legend, in words.
    expect(within(group).getByText(/Reposted · not present in this posting/)).toBeInTheDocument();
    // Every segment is reachable by keyboard (a real button, not tabindex -1).
    for (const segment of segments) expect(segment).not.toHaveAttribute("tabindex", "-1");
  });

  it("sizes each segment by its contribution against the maximum possible signal", () => {
    render(<ContributionBar title="Demand evidence" factors={FACTORS} />);
    // max signal = 0.2 + 0.32 + 0.32 + 0.16 = 1.0, so widths equal the contributions.
    const daysOpen = screen.getByRole("button", { name: /^Time open/ });
    expect(daysOpen.style.width).toBe("25.6%");
    const base = screen.getByRole("button", { name: /^Active posting/ });
    expect(base.style.width).toBe("20%");
  });

  it("gives every segment an aria-label with the words and the share of the score", () => {
    render(<ContributionBar title="Demand evidence" factors={FACTORS} />);
    expect(screen.getByRole("button", { name: "Time open: Largest signal, about 42% of this score" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active posting: Second signal, about 32% of this score" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No salary range: Smaller signal, about 26% of this score" })).toBeInTheDocument();
  });

  it("shows what a factor means on focus and hover, and clears on blur", () => {
    render(<ContributionBar title="Demand evidence" factors={FACTORS} />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveTextContent("Hover, focus or click a coloured segment");

    const daysOpen = screen.getByRole("button", { name: /^Time open/ });
    fireEvent.focus(daysOpen);
    expect(panel).toHaveTextContent("Time open — Largest signal");
    expect(panel).toHaveTextContent("The longer a posting stays open");
    fireEvent.blur(daysOpen);
    expect(panel).toHaveTextContent("Hover, focus or click a coloured segment");

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^No salary range/ }));
    expect(panel).toHaveTextContent("No salary range — Smaller signal");
  });

  it("pins the panel on click, toggles it off, and Escape closes it", () => {
    render(<ContributionBar title="Demand evidence" factors={FACTORS} />);
    const panel = screen.getByRole("status");
    const base = screen.getByRole("button", { name: /^Active posting/ });

    fireEvent.click(base);
    expect(base).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveTextContent("Active posting — Second signal");

    fireEvent.click(base);
    expect(base).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(base);
    fireEvent.keyDown(base, { key: "Escape" });
    expect(base).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveTextContent("Hover, focus or click a coloured segment");
  });

  it("renders nothing when there are no factors", () => {
    const { container } = render(<ContributionBar title="Demand evidence" factors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
