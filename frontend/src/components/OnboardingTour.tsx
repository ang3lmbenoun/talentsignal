import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import "./OnboardingTour.css";

// ---- Step content -----------------------------------------------------
// Copy rule: every claim below was checked against the screen and backend
// source it describes. Where a feature is sample data or a placeholder, the
// copy says so instead of implying more than the app does today.
//
// Guided mode: most steps also name a `view` (the app's own navigation key,
// the same strings the sidebar uses) and a `targets` list. The tour navigates
// to the view, waits for the target to appear, and spotlights it. If the target
// never appears (a role that cannot see the screen, data that has not loaded,
// an empty list) the step falls back to the centered card, so the tour always
// works and never throws.

interface TourStep {
  id: string;
  title: string;
  what: string;
  why: string;
  preview: ReactNode;
  // Navigation key passed to the app's own setView (e.g. "overview").
  view?: string;
  // Ordered ALTERNATIVES. Each alternative is a list of data-tour names that
  // are spotlighted together (their bounding boxes are unioned). The first
  // alternative whose elements all exist wins.
  targets?: string[][];
  // Called on every locate tick (must be idempotent): lets a step make the
  // real screen show its target, e.g. open the card grid.
  assist?: () => void;
  // Undoes whatever assist() changed, when the step is left or the tour closes.
  restore?: () => void;
}

// The previews are small, static, decorative sketches built from the theme's
// own CSS variables. They are only shown on centered cards (welcome, the final
// step, and any step whose target could not be found).
function Preview({ children }: { children: ReactNode }) {
  return (
    <div className="tour-preview" aria-hidden="true">
      <span className="tour-preview-tag">Illustration</span>
      {children}
    </div>
  );
}

function tourEl(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
}

// The Opportunities screen opens on a company-grouped list; the card (verdict
// and contribution bar) only exists in the flat grid. The tour opens the grid
// by clicking the screen's own "View all opportunities" button, then clicks
// "Back to companies" when the step ends, so the user's view is left as found.
let openedGrid = false;
function openOpportunityGrid() {
  if (tourEl("opportunity-verdict")) return;
  const viewAll = tourEl("opportunities-view-all");
  if (viewAll && !openedGrid) {
    openedGrid = true;
    viewAll.click();
  }
}
function closeOpportunityGrid() {
  if (!openedGrid) return;
  openedGrid = false;
  tourEl("opportunities-back")?.click();
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
    what: "Key counts for the postings loaded in this workspace. Each tile has a “How is this counted?” note.",
    why: "Start here to decide where to look first. Trend lines show “pending” until there is enough history.",
    view: "overview",
    targets: [["overview-kpis"]],
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
    what: "Practical clues in job postings, such as long-open roles and missing salary ranges. This panel shows each source and whether its dates can be trusted.",
    why: "Sources whose dates look unreliable are flagged and left out of comparisons.",
    view: "signals",
    targets: [["signals-source-panel"]],
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
    title: "Opportunities",
    what: "Each posting opens with a plain-language verdict and a bar showing which clues moved its score.",
    why: "Open “Show the math” on a card for the exact weights. It flags roles to review; it does not predict outcomes.",
    view: "opportunities",
    targets: [["opportunity-verdict", "opportunity-bar"], ["opportunity-verdict"]],
    assist: openOpportunityGrid,
    restore: closeOpportunityGrid,
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
    id: "targeting",
    title: "Hard-to-fill targeting",
    what: "Roles flagged as possibly hard to fill, with candidate skill overlap shown for each. Filter by company to focus.",
    why: "It helps you decide whether to adjust the job criteria or source more candidates. Nothing is submitted automatically.",
    view: "targeting",
    targets: [["targeting-company-grouping"]],
    preview: (
      <Preview>
        <div className="tour-rows">
          <div className="tour-row"><span className="tour-avatar" /><i /><span className="tour-chip">Role</span></div>
          <div className="tour-row"><span className="tour-avatar" /><i /><span className="tour-chip">Role</span></div>
        </div>
      </Preview>
    ),
  },
  {
    id: "candidates",
    title: "Candidates",
    what: "Candidate profiles with skills and experience. Each one shows the skills it shares with its best-matching job opening, a rule-based overlap, not an AI judgement.",
    why: "It gives you matching evidence to review. Profiles here are sample data, and resume upload is a preview: files are not parsed yet.",
    view: "candidates",
    targets: [["candidates-fit"]],
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
    view: "packages",
    // The email editor only exists once a package has been drafted; until then
    // the draft form is spotlighted instead.
    targets: [["packages-draft-editor"], ["packages-draft-form"]],
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
    title: "You're ready to get started?",
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

const SPOT_PADDING = 8;
const CARD_WIDTH = 380;
const VIEWPORT_MARGIN = 16;
const CARD_GAP = 14;
const LOCATE_INTERVAL_MS = 100;

type Rect = { top: number; left: number; width: number; height: number };
type Mode = "locating" | "anchored" | "centered";

export type TourCloseReason = "finish" | "skip";

interface OnboardingTourProps {
  // Called when the tour ends. "finish" = Get started; "skip" = Skip tour or
  // Escape. The parent decides what to do (mark seen, restore the view).
  onClose: (reason?: TourCloseReason) => void;
  // The app's own navigation function (App's setView). Without it the tour
  // behaves as the original centered modal.
  onNavigate?: (view: string) => void;
  // How long to wait for a step's target before falling back to the centered
  // card. Short in tests.
  locateTimeoutMs?: number;
}

// An element counts as present when it is in the document and not inside a
// [hidden] ancestor (the app keeps every screen mounted but hides the inactive
// ones with the `hidden` attribute).
function findTargets(alternatives: string[][]): HTMLElement[] | null {
  for (const names of alternatives) {
    const elements = names.map(tourEl);
    if (elements.every((el): el is HTMLElement => el !== null && !el.closest("[hidden]"))) return elements;
  }
  return null;
}

function unionRect(elements: HTMLElement[]): Rect {
  const rects = elements.map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  return {
    top: top - SPOT_PADDING,
    left: left - SPOT_PADDING,
    width: right - left + SPOT_PADDING * 2,
    height: bottom - top + SPOT_PADDING * 2,
  };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function OnboardingTour({ onClose, onNavigate, locateTimeoutMs = 3000 }: OnboardingTourProps) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("centered");
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement[] | null>(null);
  // Latest callbacks without re-running the locate effect when the parent
  // re-renders with a new function identity.
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
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
  // on <body>.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose("skip");
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

  // Locate the step's target: navigate to its screen, then poll briefly for the
  // element (screens render asynchronously). Found -> spotlight it; not found
  // within the timeout -> centered fallback. Cleanup cancels the poll and
  // undoes anything the step's assist() changed.
  useEffect(() => {
    setRect(null);
    targetRef.current = null;
    if (step.view) navigateRef.current?.(step.view);
    if (!step.targets) {
      setMode("centered");
      return;
    }
    setMode("locating");

    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();

    function tick() {
      if (cancelled) return;
      try {
        step.assist?.();
        const found = findTargets(step.targets ?? []);
        if (found) {
          targetRef.current = found;
          found[0].scrollIntoView?.({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
          setRect(unionRect(found));
          setMode("anchored");
          return;
        }
      } catch {
        // A missing or odd element must never crash the tour: fall through to
        // the centered card.
        setMode("centered");
        return;
      }
      if (Date.now() - startedAt >= locateTimeoutMs) {
        setMode("centered");
        return;
      }
      timer = window.setTimeout(tick, LOCATE_INTERVAL_MS);
    }
    tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      step.restore?.();
    };
  }, [index, step, locateTimeoutMs]);

  // Keep the spotlight on its target when the page scrolls or resizes.
  useEffect(() => {
    if (mode !== "anchored") return;
    let frame = 0;
    function recompute() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const elements = targetRef.current;
        if (elements && elements.every((el) => el.isConnected)) setRect(unionRect(elements));
      });
    }
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [mode, index]);

  // Place the tooltip card next to the spotlight: below it if it fits, else
  // above, else pinned inside the viewport; always clamped horizontally.
  useLayoutEffect(() => {
    if (mode !== "anchored" || !rect) {
      setCardPos(null);
      return;
    }
    const card = dialogRef.current;
    const cardWidth = card?.offsetWidth || CARD_WIDTH;
    const cardHeight = card?.offsetHeight || 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.top + rect.height + CARD_GAP;
    if (top + cardHeight > vh - VIEWPORT_MARGIN) {
      const above = rect.top - cardHeight - CARD_GAP;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, vh - cardHeight - VIEWPORT_MARGIN);
    }
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - cardWidth - VIEWPORT_MARGIN));
    setCardPos({ top, left });
  }, [mode, rect, index]);

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

  const anchored = mode === "anchored" && rect !== null;
  const titleId = `tour-title-${step.id}`;
  const cardStyle: CSSProperties | undefined =
    anchored && cardPos ? { position: "fixed", top: cardPos.top, left: cardPos.left, width: `min(calc(100vw - ${VIEWPORT_MARGIN * 2}px), ${CARD_WIDTH}px)` } : undefined;

  return (
    <div className={anchored ? "tour-overlay tour-overlay--anchored" : "tour-overlay"}>
      {anchored && rect && (
        <div
          className="tour-spotlight"
          data-testid="tour-spotlight"
          aria-hidden="true"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        >
          {/* key remounts the ring on every step so its two pulses replay */}
          <span className="tour-pulse" key={step.id} />
        </div>
      )}
      <div
        ref={dialogRef}
        className={anchored ? "tour-card-shell tour-card-shell--anchored" : "tour-card-shell"}
        style={cardStyle}
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
          {!anchored && step.preview}
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
            <button type="button" className="tour-skip" onClick={() => onClose("skip")}>
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
              <button type="button" className="tour-btn tour-btn--primary" onClick={() => onClose("finish")}>
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
