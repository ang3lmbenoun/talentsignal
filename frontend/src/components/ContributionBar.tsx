import { useId, useState, type KeyboardEvent } from "react";
import { contributionWords, factorLabel, factorMeaning, type FactorLike } from "../lib/opportunityVerdict";
import "./ContributionBar.css";

// One stacked horizontal bar per score. The track is the maximum possible
// signal (the sum of the factor weights); each segment is as wide as that
// factor's contribution, so the filled length is the score itself.
//
// Segments are real <button>s so they are keyboard focusable. Hovering or
// focusing one shows a small panel (what the factor means, how much it moved
// the score, in words); clicking pins the panel open; Escape unpins it.
// The raw weights / values stay in the card's "Show the math" panel.

// Distinct theme colours. The words in the legend carry the meaning, so the
// colours are never the only cue.
const SEGMENT_COLORS = ["var(--accent)", "var(--accent-2)", "var(--warning)", "var(--success)", "var(--danger)"];

interface ContributionBarProps {
  // e.g. "Demand evidence" -- becomes part of every aria-label.
  title: string;
  factors: FactorLike[];
  // Optional marker the guided tour uses to find this bar (no styling/behaviour).
  dataTour?: string;
}

export function ContributionBar({ title, factors, dataTour }: ContributionBarProps) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const panelId = useId();

  const maxSignal = factors.reduce((sum, f) => sum + f.weight, 0);
  const totalContribution = factors.reduce((sum, f) => sum + Math.max(f.contribution, 0), 0);
  const shownKey = hovered ?? pinned;
  const shown = shownKey ? factors.find((f) => f.factor === shownKey) : undefined;

  if (factors.length === 0 || maxSignal <= 0) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setPinned(null);
      setHovered(null);
    }
  }

  return (
    // The keydown handler only listens for Escape bubbling up from a focused
    // segment; the group itself is not interactive.
    <div className="cbar" role="group" aria-label={`${title}: what moved the score`} onKeyDown={handleKeyDown} data-tour={dataTour}>
      <p className="cbar-title">{title}: what moved it</p>
      <div className="cbar-track">
        {factors.map((f, index) => {
          if (!(f.contribution > 0)) return null;
          const words = contributionWords(f, factors);
          const share = totalContribution > 0 ? Math.round((f.contribution / totalContribution) * 100) : 0;
          const isOpen = shownKey === f.factor;
          return (
            <button
              key={f.factor}
              type="button"
              className={isOpen ? "cbar-seg cbar-seg--active" : "cbar-seg"}
              style={{ width: `${(f.contribution / maxSignal) * 100}%`, background: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }}
              aria-label={`${factorLabel(f.factor)}: ${words}, about ${share}% of this score`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setPinned((current) => (current === f.factor ? null : f.factor))}
              onMouseEnter={() => setHovered(f.factor)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(f.factor)}
              onBlur={() => setHovered(null)}
            />
          );
        })}
      </div>

      <ul className="cbar-legend">
        {factors.map((f, index) => (
          <li key={f.factor}>
            <span
              className="cbar-swatch"
              aria-hidden="true"
              style={{ background: f.contribution > 0 ? SEGMENT_COLORS[index % SEGMENT_COLORS.length] : "var(--border)" }}
            />
            {factorLabel(f.factor)} · {contributionWords(f, factors).toLowerCase()}
          </li>
        ))}
      </ul>

      <div id={panelId} className="cbar-panel" role="status" aria-live="polite">
        {shown ? (
          <>
            <b>{factorLabel(shown.factor)}</b> — {contributionWords(shown, factors)}
            {totalContribution > 0 && shown.contribution > 0
              ? `, about ${Math.round((shown.contribution / totalContribution) * 100)}% of this score`
              : ""}
            . {factorMeaning(shown.factor)}
          </>
        ) : (
          <span className="cbar-hint">Hover, focus or click a coloured segment to see what it means.</span>
        )}
      </div>
    </div>
  );
}
