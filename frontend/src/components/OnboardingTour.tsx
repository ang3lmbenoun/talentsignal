import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import "./OnboardingTour.css";

// ---- Step content -----------------------------------------------------
// Copy rule: every claim below was checked against the screen and backend
// source it describes (see the report that shipped with this change). Where a
// feature is sample data or a placeholder, the copy says so instead of
// implying more than the app does today.

interface TourStep {
  id: string;
  title: string;
  what: string;
  why: string;
  preview: ReactNode;
}

// The previews are small, static, decorative sketches built from the theme's
// own CSS variables -- not screenshots, and not live data. They are aria-hidden
// and labelled "Illustration" so nobody reads the shapes as real numbers.
function Preview({ children }: { children: ReactNode }) {
  return (
    <div className="tour-preview" aria-hidden="true">
      <span className="tour-preview-tag">Illustration</span>
      {children}
    </div>
  );
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to TalentSignal",
    what: "It brings job-posting signals and candidate-fit evidence together so your team can spot roles that may be hard to fill.",
    why: "The app suggests; you decide. Nothing leaves the platform until a person reviews and releases it.",
    preview: (
      <Preview>
        <div className="tour-flow">
          <span className="tour-chip">Suggested</span>
          <span className="tour-flow-arrow">→</span>
          <span className="tour-chip">You review</span>
          <span className="tour-flow-arrow">→</span>
          <span className="tour-chip tour-chip--accent">You release</span>
        </div>
      </Preview>
    ),
  },
  {
    id: "overview",
    title: "Overview",
    what: "A summary of the postings loaded in this workspace: key counts, the top roles flagged for review, and where the data comes from.",
    why: "Start here to decide where to look first. Trend lines show “pending” until there is enough history.",
    preview: (
      <Preview>
        <div className="tour-tiles">
          <div className="tour-tile"><i /><b /></div>
          <div className="tour-tile"><i /><b /></div>
          <div className="tour-tile"><i /><b /></div>
        </div>
      </Preview>
    ),
  },
  {
    id: "signals",
    title: "Signals",
    what: "Practical clues in job postings, such as long-open roles, reposts and missing salary ranges, counted across the loaded postings.",
    why: "They point to roles worth a closer look. Sources whose dates look unreliable are flagged and left out of comparisons.",
    preview: (
      <Preview>
        <div className="tour-bars">
          <div className="tour-bar"><span style={{ width: "78%" }} /></div>
          <div className="tour-bar"><span style={{ width: "52%" }} /></div>
          <div className="tour-bar"><span style={{ width: "34%" }} /></div>
        </div>
      </Preview>
    ),
  },
  {
    id: "opportunities",
    title: "Opportunities & hard-to-fill",
    what: "Each posting gets a demand-evidence score from simple rules (posting age, reposts, role type), plus a hard-to-fill flag when it matches.",
    why: "Every card shows how it was scored, so you can judge the evidence. It flags roles to review; it does not predict outcomes.",
    preview: (
      <Preview>
        <div className="tour-card">
          <span className="tour-ring" />
          <div className="tour-card-lines">
            <b />
            <i />
          </div>
          <span className="tour-chip tour-chip--accent">Hard-to-fill</span>
        </div>
      </Preview>
    ),
  },
  {
    id: "candidates",
    title: "Candidates",
    what: "Candidate profiles with skills and experience. Fit is a rule-based skill-overlap score against a job, not an AI judgement.",
    why: "It gives you matching evidence to review. Profiles here are sample data, and resume upload is a preview: files are not parsed yet.",
    preview: (
      <Preview>
        <div className="tour-rows">
          <div className="tour-row"><span className="tour-avatar" /><i /><span className="tour-chip">Fit</span></div>
          <div className="tour-row"><span className="tour-avatar" /><i /><span className="tour-chip">Fit</span></div>
        </div>
      </Preview>
    ),
  },
  {
    id: "packages",
    title: "Packages (drafts)",
    what: "Drafts a client-facing package: the best-matching candidates plus an email you can edit. Both are built from templates, not written by AI.",
    why: "Release records your decision. In this demo nothing is actually sent to anyone.",
    preview: (
      <Preview>
        <div className="tour-draft">
          <span className="tour-chip">Draft</span>
          <div className="tour-draft-lines"><i /><i /><i /></div>
          <span className="tour-button-sketch">Release</span>
        </div>
      </Preview>
    ),
  },
  {
    id: "ready",
    title: "You're ready to get started",
    what: "Use the sidebar to move between sections. What you see depends on your role.",
    why: "You can replay this tour any time from “Take the tour” at the top of the page.",
    preview: (
      <Preview>
        <ul className="tour-checks">
          <li><span /><i /></li>
          <li><span /><i /></li>
          <li><span /><i /></li>
        </ul>
      </Preview>
    ),
  },
];

export const TOUR_STEP_COUNT = STEPS.length;

// Everything a keyboard user can Tab to inside the dialog. Used by the focus
// trap below to find the first and last stop.
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface OnboardingTourProps {
  // Called when the tour ends for any reason ("Get started", Skip, Escape).
  // The parent decides what to do (mark seen, unmount); this component only
  // reports that the user is done.
  onClose: () => void;
}

export function OnboardingTour({ onClose }: OnboardingTourProps) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  function next() {
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function back() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  // Keyboard navigation. A document-level listener (not onKeyDown on the card)
  // so it still works if the user clicks the dimmed backdrop and focus lands
  // on <body>. The effect re-subscribes when onClose changes; next/back use
  // functional setState so they never go stale.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        next();
      } else if (event.key === "ArrowLeft") {
        back();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus management: move focus into the dialog when it opens and hand it
  // back to whatever had it (e.g. the "Take the tour" button) when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Focus trap: Tab / Shift+Tab wrap around inside the dialog instead of
  // escaping to the page behind the overlay.
  function handleTrapKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const titleId = `tour-title-${step.id}`;

  return (
    <div className="tour-overlay">
      <div
        ref={dialogRef}
        className="tour-card-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleTrapKeyDown}
      >
        <p className="tour-step-count">
          Step {index + 1} of {STEPS.length}
        </p>

        {/* key={step.id} remounts the body so the fade-in replays per step */}
        <div className="tour-body" key={step.id}>
          {step.preview}
          <h2 id={titleId}>{step.title}</h2>
          <p className="tour-line">
            <b>What this is</b>
            {step.what}
          </p>
          <p className="tour-line">
            <b>Why it's here</b>
            {step.why}
          </p>
        </div>

        <ol className="tour-dots" aria-label="Tour progress">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={i === index ? "tour-dot tour-dot--on" : "tour-dot"}
              aria-current={i === index ? "step" : undefined}
              aria-label={`Step ${i + 1}${i === index ? ", current" : ""}`}
            />
          ))}
        </ol>

        <div className="tour-actions">
          {!isLast ? (
            <button type="button" className="tour-skip" onClick={onClose}>
              Skip tour
            </button>
          ) : (
            <span />
          )}
          <div className="tour-nav">
            {!isFirst && (
              <button type="button" className="tour-btn" onClick={back}>
                Back
              </button>
            )}
            {isLast ? (
              <button type="button" className="tour-btn tour-btn--primary" onClick={onClose}>
                Get started
              </button>
            ) : (
              <button type="button" className="tour-btn tour-btn--primary" onClick={next}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
