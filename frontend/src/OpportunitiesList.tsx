import { useEffect, useState } from "react";
import { Briefcase, Flame, Building2, Users, ArrowLeft, type LucideIcon } from "lucide-react";
import { getStoredToken } from "./auth";
import { classifyFamily } from "./lib/basisDerivation";
import { computeClientAggregates, clientWhyItMatters, type ClientOpportunity } from "./lib/clientAggregation";

interface ScoreFactor {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
  // S-23: only ever present on hardToFillFactors' roleScarcity row -- names
  // whether its value came from real measurement or the decision-026
  // curated list, so the structured breakdown never hides which evidence
  // drove the score (confidence's factors never set this).
  basis?: string;
  // S-23 (06_decisions/046): only present when basis is "measured" -- the
  // actual family/median numbers the value was computed from.
  familyKey?: string;
  familyMedianDaysOpen?: number;
  globalMedianDaysOpen?: number;
}

interface Opportunity {
  id: string;
  company: string;
  // Real API field, not previously typed here (this screen used extractDaysOpen
  // / familyKey instead) -- added for S-25's role-family filter, which needs
  // classifyFamily()'s title-based fallback the same way Clients/Signals do.
  title?: string;
  confidenceScore: number;
  reasons: string[];
  source: string;
  // Optional: rows scored before S-07 shipped were backfilled with an empty
  // breakdown that can't be reconstructed (see 06_decisions/012) — treated
  // the same as "missing" below, so an old row reads as explicitly
  // not-audited rather than silently blank.
  factors?: ScoreFactor[];
  weightsVersion?: string;
  // HF-2: present on freshly scored opportunities; absent on pre-013
  // backfilled rows (which read as "not flagged"), so every field is optional
  // and guarded below. hardToFill is the backend's derived badge boolean
  // (score >= the PROPOSED threshold, 06_decisions/026).
  hardToFill?: boolean;
  hardToFillScore?: number;
  hardToFillReasons?: string[];
  hardToFillFactors?: ScoreFactor[];
  hardToFillVersion?: string;
  // S-24 (Fix 3): the real S-23 role-family classification (migration 018),
  // exposed by the backend for the first time this story. Null on rows
  // classifyFamily() has never run against (not yet backfilled).
  familyKey?: string | null;
  // S-30b: the JD editor's real stored values (migration 022), null until a
  // human edits via PATCH /api/opportunities/:id. Optional only because
  // rows scored before S-30b's list-response change predate this field
  // existing in the fetch response -- treated as "never edited" either way.
  requiredSkills?: string[] | null;
  requiredYears?: number | null;
}

type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// S-24 (Fix 1): the row count Ali watched stall in front of instructors.
// Rendering all ~1000 rows (each with two <details> blocks) into the DOM at
// once is the actual cost -- the fetch itself is one request either way.
// Chosen over pulling in react-window: this is a smaller diff for the same
// result (only the first PAGE_SIZE rows exist in the DOM at a time), and
// "Load more" keeps the existing plain <ul>/<li> markup every current test
// already asserts against.
const PAGE_SIZE = 50;

// S-25 filter bar. Reuses the exact real-field predicates already used
// elsewhere in this file (extractDaysOpen) and across the app (Signals'
// reposted/no-salary reason checks) -- no new signal definitions invented.
const ALL_FILTER = "all";
const SIGNAL_TYPE_OPTIONS: { value: string; label: string; test: (o: Opportunity) => boolean }[] = [
  { value: "reposted", label: "Reposted roles", test: (o) => o.reasons.some((r) => r.includes("reposted")) },
  {
    value: "long-open",
    label: "Open 54+ days",
    test: (o) => {
      const d = extractDaysOpen(o);
      return d !== undefined && d >= 54;
    },
  },
  { value: "no-salary", label: "No salary range listed", test: (o) => o.reasons.some((r) => r.includes("no salary range")) },
];
const AGE_BUCKET_OPTIONS: { value: string; label: string; test: (daysOpen: number) => boolean }[] = [
  { value: "0-30", label: "30 days or less", test: (d) => d <= 30 },
  { value: "31-90", label: "31 to 90 days", test: (d) => d > 30 && d <= 90 },
  { value: "91-180", label: "91 to 180 days", test: (d) => d > 90 && d <= 180 },
  { value: "180+", label: "More than 180 days", test: (d) => d > 180 },
];

const FAMILY_LABELS: Record<string, string> = {
  "engineering-swe": "Software engineering", "ml-ai": "AI & machine learning", "data-analytics": "Data & analytics",
  security: "Security", "cloud-infra": "Cloud & infrastructure", "support-cs": "Support & customer success",
  "sales-bizdev": "Sales & business development", "retail-ops": "Retail & operations", "general-other": "Other roles",
};

type RawPayloadState =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "ok"; payload: unknown }
  | { status: "error" };

// S-24 (Fix 3): "a small 'raw payload' link that expands to show the raw
// JSON from raw_requisitions" -- fetched on demand (per opportunity, per
// click), never joined onto the list fetch every row already did, so
// expanding one row's payload can't slow down the other 49 on screen.
// Reuses POST /opportunities/score (Fix 3's backend change), not a new
// endpoint.
//
// Pre-demo redesign note: the trigger is now styled/labeled "Prove it" (the
// approved mockup's bottom-right card action) via aria-label, which
// overrides the button's visible text for accessible-name purposes -- so
// existing tests that look up the button by its original accessible name
// ("Show raw payload" / "Hide raw payload") keep passing unchanged. The
// fetch/state logic and rendered payload text are untouched.
function RawPayloadExpander({ opportunityId, company }: { opportunityId: string; company: string }) {
  const [state, setState] = useState<RawPayloadState>({ status: "collapsed" });

  async function handleClick() {
    if (state.status === "ok") {
      setState({ status: "collapsed" });
      return;
    }

    setState({ status: "loading" });
    const token = getStoredToken();
    if (!token) {
      setState({ status: "error" });
      return;
    }

    try {
      const res = await fetch("/api/opportunities/score", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ opportunityIds: [opportunityId] }),
      });
      if (!res.ok) throw new Error(`raw payload fetch failed: ${res.status}`);
      const body = (await res.json()) as { opportunities: { rawPayload: unknown }[] };
      setState({ status: "ok", payload: body.opportunities[0]?.rawPayload ?? null });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="raw-payload">
      <button
        type="button"
        className="opportunity-prove-it"
        aria-label={state.status === "ok" ? "Hide raw payload" : "Show raw payload"}
        onClick={handleClick}
      >
        Prove it
      </button>
      {state.status !== "collapsed" && (
        <div className="raw-payload-modal" role="dialog" aria-label={`Raw payload — ${company}`}>
          <div className="raw-payload-modal-panel">
            <div className="raw-payload-modal-header">
              <span>Raw payload — {company}</span>
              <button type="button" aria-label="Close" onClick={handleClick}>
                ✕
              </button>
            </div>
            {state.status === "loading" && <p>Loading raw payload...</p>}
            {state.status === "error" && <p>Could not load raw payload.</p>}
            {state.status === "ok" &&
              (state.payload ? (
                <pre>{JSON.stringify(state.payload, null, 2)}</pre>
              ) : (
                <p>No raw ingested payload found for this opportunity yet.</p>
              ))}
            <p className="raw-payload-modal-caption">
              Unmodified JSON from the source connector — the "prove it" record behind the score.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// S-23's roleScarcity factor is the only one that ever carries a basis --
// this reads it out of whichever breakdown the row actually has (hard-to-fill
// factors always carry it when present; confidence factors never do), so
// "How this was scored" (and the card's basis indicator) can show it
// regardless of whether the row is currently flagged hard-to-fill.
function roleScarcityFactor(opportunity: Opportunity): ScoreFactor | undefined {
  return opportunity.hardToFillFactors?.find((f) => f.factor === "roleScarcity");
}

function opportunityBasis(opportunity: Opportunity): "measured" | "curated" | "none" {
  const factor = roleScarcityFactor(opportunity);
  return factor?.basis === "measured" || factor?.basis === "curated" ? factor.basis : "none";
}

// S-25 role-family filter: prefers the real, stored familyKey (S-23
// backfill); falls back to title-based classification only when a title is
// present, and to "general-other" otherwise -- never guesses from nothing.
function familyFor(opportunity: Opportunity): string {
  if (opportunity.familyKey) return opportunity.familyKey;
  if (opportunity.title) return classifyFamily(opportunity.title);
  return "general-other";
}

// S-25 "why this is a signal" -- 1-2 sentence narrative built from the same
// real reasons/basis/family fields already rendered elsewhere on the card
// (legacy summary line, basis dot, "how this was scored"). No invented
// language beyond joining real facts into a sentence.
function opportunityWhy(opportunity: Opportunity): string {
  const familyKey = familyFor(opportunity);
  const family = FAMILY_LABELS[familyKey] ?? familyKey.replaceAll("-", " ");
  const basis = opportunityBasis(opportunity);
  const reposted = opportunity.reasons.some((r) => r.includes("reposted"));
  const noSalary = opportunity.reasons.some((r) => r.includes("no salary range"));
  const capacityEvidence = opportunity.hardToFillReasons?.some((r) => r.startsWith("capacity:")) ?? false;

  const daysOpen = extractDaysOpen(opportunity);
  const clauses: string[] = [];
  if (daysOpen !== undefined) clauses.push(`the posting has been open for ${daysOpen} days`);
  if (reposted) clauses.push("the role has been posted again");
  if (noSalary) clauses.push("the posting does not include a salary range");
  if (basis === "measured") clauses.push(`live ${family} postings have taken longer to close than the overall posting median`);
  else if (basis === "curated") clauses.push("the title matches a role type selected for closer review");
  if (capacityEvidence) clauses.push("a public employer hiring-capacity record matched and needs human verification");

  if (clauses.length === 0) {
    return `We do not currently see a repost, missing salary range, or role-scarcity signal for this ${family} role in the loaded data.`;
  }
  return `This ${family} posting is flagged because ${clauses.join("; ")}. These are clues for your team to review, not proof that the role will be difficult to fill.`;
}

// PROPOSED heuristic, not yet signed off by Ali -- see
// 06_decisions/048-opportunity-card-spread-potential-and-top-pick-heuristic.md.
// There is no structured day-count field on Opportunity; the only place a
// real day count exists today is embedded in the backend-built reason
// strings (e.g. "open 24 days"). Rather than invent a number, this extracts
// it from that real text -- and returns undefined (never a guess) when no
// reason names it, which callers must treat as "insufficient data to show
// age/spread/staleness for this row."
function extractDaysOpen(opportunity: Opportunity): number | undefined {
  const candidates = [...opportunity.reasons, ...(opportunity.hardToFillReasons ?? [])];
  for (const reason of candidates) {
    const match = /open (\d+) days?/i.exec(reason);
    if (match) return Number(match[1]);
  }
  return undefined;
}

type SpreadPotential = "high" | "medium" | "low";

// PROPOSED, not yet signed off -- see the decision-log entry above. Purely a
// client-side display heuristic (never a measured dollar spread); the card
// carries an explicit tooltip saying so. Requires a known days-open value --
// returns undefined otherwise so the card can omit the badge rather than
// guess.
function computeSpreadPotential(confidenceScore: number, daysOpen: number | undefined): SpreadPotential | undefined {
  if (daysOpen === undefined) return undefined;
  const confidencePct = confidenceScore * 100;
  if (daysOpen > 365 || confidencePct < 70) return "low";
  if (confidencePct >= 85 && daysOpen <= 30) return "high";
  return "medium";
}

// PROPOSED -- "top pick" is defined as the single highest hardToFillScore
// currently loaded (not global, not weighted by anything else). Rows without
// a score are never eligible, so an all-unscored list has no top pick.
function findTopPick(opportunities: Opportunity[]): string | undefined {
  let best: Opportunity | undefined;
  for (const opportunity of opportunities) {
    if (opportunity.hardToFillScore === undefined) continue;
    if (best === undefined || opportunity.hardToFillScore > (best.hardToFillScore as number)) {
      best = opportunity;
    }
  }
  return best?.id;
}

// Sort default requested for the redesign: hard-to-fill rows first, then
// highest confidence, then highest hard-to-fill score as a tiebreaker. This
// replaces the previous "trust the backend's confidence-descending order"
// behavior (S-04) -- ranking now reflects this combined priority, not raw
// confidence alone, per the approved design.
function sortOpportunities(opportunities: Opportunity[]): Opportunity[] {
  return [...opportunities].sort((a, b) => {
    const hardToFillDiff = Number(Boolean(b.hardToFill)) - Number(Boolean(a.hardToFill));
    if (hardToFillDiff !== 0) return hardToFillDiff;
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    return (b.hardToFillScore ?? -1) - (a.hardToFillScore ?? -1);
  });
}

const MONOGRAM_PALETTE = ["#5a4be0", "#0d9488", "#c02c86", "#c67c12", "#1f8a54", "#2f6fed"];

function companyMonogram(company: string): { initials: string; color: string } {
  const initials = company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
  let hash = 0;
  for (let i = 0; i < company.length; i++) hash = (hash * 31 + company.charCodeAt(i)) >>> 0;
  return { initials, color: MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length] };
}

// S-25: ring color now bands by confidence (green >=85, indigo 70-84, amber
// 50-69, red <50) -- was a flat --accent stroke regardless of value.
function confidenceRingColor(percent: number): string {
  if (percent >= 85) return "var(--success)";
  if (percent >= 70) return "var(--accent)";
  if (percent >= 50) return "var(--warning)";
  return "var(--danger)";
}

function ConfidenceRing({ percent }: { percent: number }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="opportunity-confidence-ring" role="img" aria-label={`Demand evidence score ${percent} percent, based on one requisition`}>
      <circle cx="23" cy="23" r={radius} fill="none" stroke="var(--border)" strokeWidth={4} />
      <circle
        cx="23"
        cy="23"
        r={radius}
        fill="none"
        stroke={confidenceRingColor(percent)}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={circumference.toFixed(1)}
        strokeDashoffset={offset.toFixed(1)}
        transform="rotate(-90 23 23)"
      />
      <text x="23" y="24" textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={700} fill="var(--text)">
        {percent}%
      </text>
    </svg>
  );
}

// Counts only: no decorative trend graphic until history is available.
function KpiTile({
  label,
  value,
  icon,
  accent,
  why,
  context,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  accent?: boolean;
  why: string;
  context: string;
}) {
  const Icon = icon;
  return (
    <div className="opportunity-kpi-tile">
      <div className="opportunity-kpi-tile-top">
        <span className="opportunity-kpi-label">{label}</span>
        <span className="opportunity-kpi-icon">
          <Icon size={14} aria-hidden="true" />
        </span>
      </div>
      <div className={accent ? "opportunity-kpi-value opportunity-kpi-value--accent" : "opportunity-kpi-value"}>
        {value === undefined ? "—" : value}
      </div>
      <p className="opportunity-kpi-context">{context}</p>
      <p className="opportunity-kpi-why">{why}</p>
    </div>
  );
}

// S-30b: S-30a's backend recommendation engine
// (GET /api/opportunities/:id/recommendation) returns exactly these four
// kinds -- mirrors backend/src/matching/recommendations.ts's
// RecommendationKind type so this screen can never drift from what the
// backend actually sends.
type RecommendationKind = "loosen_years" | "loosen_skills" | "add_candidates" | "no_action";

interface RecommendationData {
  opportunityId: string;
  kind: RecommendationKind;
  message: string;
  suggestedEdits: Record<string, unknown> | null;
}

type RecommendationState =
  | { status: "loading" }
  | { status: "ok"; recommendation: RecommendationData }
  | { status: "error" };

// refreshKey is bumped after a JD save so the panel re-fetches and the
// recommendation recomputes against the newly saved required_skills/
// required_years -- the task's own "after save, the recommendation
// re-computes and the panel updates" requirement.
function useRecommendation(opportunityId: string, refreshKey: number): RecommendationState {
  const [state, setState] = useState<RecommendationState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const token = getStoredToken();
    if (!token) {
      setState({ status: "error" });
      return;
    }

    fetch(`/api/opportunities/${opportunityId}/recommendation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`recommendation fetch failed: ${res.status}`);
        return res.json() as Promise<RecommendationData>;
      })
      .then((body) => {
        if (!cancelled) setState({ status: "ok", recommendation: body });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [opportunityId, refreshKey]);

  return state;
}

// S-30b (decision 058): the only two JD fields a human can edit. Saving an
// empty skills text box is sent as a real [] (a deliberate "no skills
// required" edit, not "do nothing") -- matches the backend's NULL-vs-[]
// distinction in decision 058. A blank years field is sent as null
// ("genuinely unknown"), never defaulted to 0.
function EditJdModal({
  opportunity,
  onClose,
  onSaved,
}: {
  opportunity: Opportunity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skillsText, setSkillsText] = useState((opportunity.requiredSkills ?? []).join(", "));
  const [yearsText, setYearsText] = useState(
    opportunity.requiredYears != null ? String(opportunity.requiredYears) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const requiredSkills = skillsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const yearsTrimmed = yearsText.trim();
    const requiredYears = yearsTrimmed === "" ? null : Number(yearsTrimmed);
    if (requiredYears !== null && (!Number.isInteger(requiredYears) || requiredYears < 0)) {
      setError("Required years must be a non-negative whole number, or left blank for unknown.");
      return;
    }

    setSaving(true);
    setError(null);
    const token = getStoredToken();
    if (!token) {
      setError("Your session has expired. Please log in again.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requiredSkills, requiredYears }),
      });
      if (!res.ok) throw new Error(`JD save failed: ${res.status}`);
      onSaved();
      onClose();
    } catch {
      setError("Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="raw-payload-modal" role="dialog" aria-label={`Edit JD — ${opportunity.company}`}>
      <div className="raw-payload-modal-panel jd-editor-panel">
        <div className="raw-payload-modal-header">
          <span>Edit JD — {opportunity.company}</span>
          <button type="button" aria-label="Close" onClick={onClose} disabled={saving}>
            ✕
          </button>
        </div>

        <label className="jd-editor-field">
          <span>Required skills (comma-separated)</span>
          <input
            type="text"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="e.g. sql, python, excel"
            disabled={saving}
          />
          <p className="jd-editor-hint">Leave blank to save "no skills required" — distinct from never edited.</p>
        </label>

        <label className="jd-editor-field">
          <span>Required years</span>
          <input
            type="number"
            min={0}
            value={yearsText}
            onChange={(e) => setYearsText(e.target.value)}
            placeholder="Unknown"
            disabled={saving}
          />
        </label>

        {error && <p className="jd-editor-error">{error}</p>}

        <div className="jd-editor-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// S-30b: renders S-30a's recommendation below "How this was scored." Every
// box shows the real backend message (real numbers/skill names), never a
// client-reinvented template -- only the box styling and action button vary
// by kind. "Add candidates" has no real destination wired yet (no screen or
// nav target was specified for this story), so it's rendered as an inert,
// disabled affordance rather than a button that silently does nothing.
function RecommendationPanel({ opportunity }: { opportunity: Opportunity }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const state = useRecommendation(opportunity.id, refreshKey);

  return (
    <div className="recommendation-panel" aria-label="recommendation">
      {state.status === "loading" && <p className="recommendation-loading">Loading recommendation...</p>}
      {state.status === "error" && <p className="recommendation-error">Could not load recommendation.</p>}
      {state.status === "ok" && (
        <>
          {state.recommendation.kind === "no_action" ? (
            <span className="recommendation-pill">✓ {state.recommendation.message}</span>
          ) : (
            <div className={`recommendation-box recommendation-box--${state.recommendation.kind}`}>
              <p>{state.recommendation.message}</p>
              {state.recommendation.kind === "add_candidates" ? (
                <button
                  type="button"
                  className="recommendation-action"
                  disabled
                  title="Sourcing candidates isn't wired up on this screen yet"
                >
                  Add candidates
                </button>
              ) : (
                <button type="button" className="recommendation-action" onClick={() => setEditing(true)}>
                  Edit JD
                </button>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <EditJdModal
          opportunity={opportunity}
          onClose={() => setEditing(false)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

function OpportunityCard({
  opportunity,
  rank,
  isTopPick,
}: {
  opportunity: Opportunity;
  rank: number;
  isTopPick: boolean;
}) {
  const daysOpen = extractDaysOpen(opportunity);
  const spread = computeSpreadPotential(opportunity.confidenceScore, daysOpen);
  const monogram = companyMonogram(opportunity.company);
  const confidencePct = Math.round(opportunity.confidenceScore * 100);
  const basis = opportunityBasis(opportunity);
  const stale = daysOpen !== undefined && daysOpen > 365;
  // S-25: 5-tier scheme (was green/amber/red at 30/54d) -- green <=30d,
  // indigo 31-90d, amber 91-180d, red >180d, darkred "stale" >365d (the
  // darkred tier and the >365d stale-callout below both key off `stale`).
  const ageColor =
    daysOpen === undefined
      ? undefined
      : stale
        ? "darkred"
        : daysOpen <= 30
          ? "green"
          : daysOpen <= 90
            ? "indigo"
            : daysOpen <= 180
              ? "amber"
              : "red";
  const priority = Boolean(opportunity.hardToFill) && spread === "high";

  return (
    <li className={priority ? "opportunity-card opportunity-card--priority" : "opportunity-card"}>
      <div
        className={
          "opportunity-card-rail" +
          (priority ? " opportunity-card-rail--priority" : ageColor ? ` opportunity-card-rail--${ageColor}` : "")
        }
      />
      <div className="opportunity-card-body">
        <div className="opportunity-card-header">
          <span className="opportunity-monogram" style={{ background: monogram.color }}>
            {monogram.initials}
          </span>
          <div className="opportunity-card-heading">
            <div className="opportunity-card-title-row">
              <h3>{opportunity.company}</h3>
              {isTopPick && (
                <span
                  className="opportunity-top-pick"
                  title="Top pick: highest hard-to-fill score in this list"
                >
                  ★ top pick
                </span>
              )}
            </div>
            {opportunity.title && <p className="opportunity-role-title">{opportunity.title}</p>}
          </div>
        </div>

        <div className="opportunity-score-wrap">
          <ConfidenceRing percent={confidencePct} />
          <span>Demand evidence · {confidencePct}%</span>
          <small>How strongly this posting shows unmet hiring demand · n=1</small>
        </div>

        <div className="opportunity-card-badges">
          {daysOpen !== undefined && (
            <span className={`opportunity-age-badge opportunity-age-badge--${ageColor}`}>{daysOpen.toLocaleString()} days open · this role</span>
          )}
          {opportunity.hardToFill && <span className="opportunity-spread-badge opportunity-spread-badge--high">Hard-to-fill role signal</span>}
        </div>

        {stale && (
          <div className="opportunity-stale-callout">Verify active status · open {daysOpen.toLocaleString()} days</div>
        )}

        {/* S-25 (NEW): 1-2 sentence plain-English "why" built from this
            row's own real reasons/family/basis -- same facts as the legacy
            summary line and basis dot below, just narrated. */}
        <div className="opportunity-why">
          <b>Why your team may want to review it</b>
          {opportunityWhy(opportunity)}
        </div>

        <div className="opportunity-card-pills">
          <span className="opportunity-pill">Source: {opportunity.source === "greenhouse" ? "Greenhouse · live" : opportunity.source === "lever" ? "Lever · flagged — excluded" : `${opportunity.source} · fixture`}</span>
          <span className={`opportunity-basis-dot opportunity-basis-dot--${basis}`} title={`Evidence basis: ${basis}`}>
            {basis === "measured" ? "Observed posting data · measured" : basis === "curated" ? "Role guidance · curated" : "No role-scarcity evidence · none"}
          </span>
        </div>

        {/* Restored after the redesign dropped it: the S-04/HF-2 trust-scenario
            strings (rank, confidence %, joined reasons, source, hard-to-fill
            reason) so a score is never shown without its why. */}
        <p className="opportunity-legacy-summary">
          <span>#{rank}</span> <span>{confidencePct}% confidence</span>
          {" — "}
          <span>{opportunity.reasons.join(", ")}</span>
          {" · "}
          <span>source: {opportunity.source}</span>
          {opportunity.hardToFill && opportunity.hardToFillReasons && opportunity.hardToFillReasons.length > 0 && (
            <>
              {" · "}
              <span aria-label="hard to fill">
                🔴 hard to fill: {opportunity.hardToFillReasons.join(", ")}
              </span>
            </>
          )}
        </p>

        {/* S-24 (Fix 3): open by default, not a <details> collapse -- Ali's
            "where does the signal come from" complaint was that provenance
            was invisible without leaving the screen. Restored verbatim. */}
        <div className="how-scored" aria-label="how this was scored">
          <h4>How this was scored</h4>
          <p>Source: {opportunity.source}</p>
          {opportunity.familyKey && <p>Role family: {opportunity.familyKey}</p>}
          {(() => {
            const roleScarcity = roleScarcityFactor(opportunity);
            if (!roleScarcity?.basis || roleScarcity.basis === "n/a") return null;
            return <p>Hard-to-fill basis: {roleScarcity.basis}</p>;
          })()}
          <p>{opportunity.reasons.join(", ")}</p>
          {opportunity.hardToFill && opportunity.hardToFillReasons && opportunity.hardToFillReasons.length > 0 && (
            <p>🔴 {opportunity.hardToFillReasons.join(", ")}</p>
          )}
          {opportunity.hardToFillReasons
            ?.filter((r) => r.startsWith("capacity:"))
            .map((r) => (
              <p key={r}>{r}</p>
            ))}
        </div>

        {/* S-30b: the actionable follow-up to "How this was scored" --
            S-30a's recommendation (loosen the JD, add candidates, or ready
            to send), with a real editing path where one exists. */}
        <RecommendationPanel opportunity={opportunity} />

        {/* S-07 trust scenario: a manager inspecting a score sees the
            weighted factors behind it, never a bare number. Native
            <details> keeps it collapsed by default with no extra state. */}
        <details>
          <summary>
            Why this score{opportunity.weightsVersion ? ` (weights ${opportunity.weightsVersion})` : ""}
          </summary>
          {opportunity.factors && opportunity.factors.length > 0 ? (
            <ul>
              {opportunity.factors.map((f) => (
                <li key={f.factor}>
                  {f.factor}: weight {f.weight}, value {f.value}, contributes {f.contribution}
                </li>
              ))}
            </ul>
          ) : (
            <p>No factor breakdown recorded (scored before S-07).</p>
          )}
        </details>

        {/* HF-1 transparency carried through HF-2: each indicator's weight,
            value, and contribution behind the hard-to-fill flag. */}
        {opportunity.hardToFill &&
          opportunity.hardToFillFactors &&
          opportunity.hardToFillFactors.length > 0 && (
            <details>
              <summary>
                Why hard to fill
                {opportunity.hardToFillVersion ? ` (weights ${opportunity.hardToFillVersion})` : ""}
              </summary>
              <ul>
                {opportunity.hardToFillFactors.map((f) => (
                  <li key={f.factor}>
                    {f.factor}: weight {f.weight}, value {f.value}, contributes {f.contribution}
                    {f.basis && f.basis !== "n/a" ? `, basis: ${f.basis}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

        <div className="opportunity-card-footer">
          <RawPayloadExpander opportunityId={opportunity.id} company={opportunity.company} />
        </div>
      </div>
    </li>
  );
}

// S-26: default landing view, one summary row per client company instead of
// a flat card grid — fixes Ali's "GitLab GitLab GitLab" complaint (a company
// with many open reqs used to render as that many near-identical cards, all
// headed with the same name, before a user could filter). Reuses the exact
// per-company aggregation already built for the Clients screen
// (frontend/src/lib/clientAggregation.ts) rather than a second
// implementation — same real openReqs/medianDaysOpen/hardToFillCount/
// basis/verdict numbers either screen would compute from the same data.
// See 06_decisions/054.
function CompanyRow({
  aggregate,
  allAggregates,
  chips,
  onOpen,
}: {
  aggregate: ReturnType<typeof computeClientAggregates>[number];
  allAggregates: ReturnType<typeof computeClientAggregates>;
  chips: { label: string; count: number }[];
  onOpen: (company: string) => void;
}) {
  const monogram = companyMonogram(aggregate.company);
  const verdictClass =
    aggregate.verdict === "healthy" ? "live" : aggregate.verdict === "fixture" ? "fixture" : "flag";

  return (
    <li
      className="opportunity-company-row"
      tabIndex={0}
      role="button"
      aria-label={`Open ${aggregate.company}`}
      onClick={() => onOpen(aggregate.company)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(aggregate.company);
      }}
    >
      <span className="opportunity-monogram" style={{ background: monogram.color }}>
        {monogram.initials}
      </span>
      <div className="opportunity-company-row-main">
        <div className="opportunity-company-row-head">
          <h3>{aggregate.company}</h3>
          <span className={`source-badge source-badge--${verdictClass}`}>
            {aggregate.verdict === "healthy" ? `${aggregate.source} · live` : aggregate.verdict === "fixture" ? `${aggregate.source} · fixture` : `${aggregate.source} · flagged — excluded`}
          </span>
        </div>
        <div className="row package-signal-strip">
          <span className="opportunity-pill">Open requisitions · n={aggregate.openReqs}</span>
          <span className="opportunity-pill">Typical age · {aggregate.medianDaysOpen?.toLocaleString() ?? "not available"} days (median{aggregate.verdict === "flagged — excluded" ? "; flagged source" : ""})</span>
          <span className="opportunity-pill">Roles flagged hard to fill · n={aggregate.hardToFillCount}</span>
          {chips.map((chip) => (
            <span className="opportunity-pill" key={chip.label}>
              {chip.label} · n={chip.count}
            </span>
          ))}
        </div>
        <p className="client-card-why">{clientWhyItMatters(aggregate, allAggregates)}</p>
      </div>
      <span className="opportunity-company-row-arrow" aria-hidden="true">
        →
      </span>
    </li>
  );
}

function CompanyGroupedLanding({
  opportunities,
  onOpenCompany,
  onViewAll,
}: {
  opportunities: Opportunity[];
  onOpenCompany: (company: string) => void;
  onViewAll: () => void;
}) {
  const clientOpps: ClientOpportunity[] = opportunities.map((o) => ({ ...o, title: o.title ?? "" }));
  const aggregates = computeClientAggregates(clientOpps).sort((a, b) => b.openReqs - a.openReqs);

  const rowsByCompany = new Map<string, Opportunity[]>();
  for (const o of opportunities) {
    if (!rowsByCompany.has(o.company)) rowsByCompany.set(o.company, []);
    rowsByCompany.get(o.company)?.push(o);
  }

  return (
    <>
      <div className="between">
        <p className="caption">
          {aggregates.length} compan{aggregates.length === 1 ? "y" : "ies"} feeding {opportunities.length} loaded
          opportunities.
        </p>
        <button type="button" className="btn" onClick={onViewAll}>
          View all opportunities (flat grid)
        </button>
      </div>
      <ul aria-label="opportunities by company" className="opportunity-company-rows">
        {aggregates.map((aggregate) => {
          const rows = rowsByCompany.get(aggregate.company) ?? [];
          const chips = SIGNAL_TYPE_OPTIONS.map((sig) => ({
            label: sig.label,
            count: rows.filter((o) => sig.test(o)).length,
          })).filter((c) => c.count > 0);
          return (
            <CompanyRow
              key={aggregate.company}
              aggregate={aggregate}
              allAggregates={aggregates}
              chips={chips}
              onOpen={onOpenCompany}
            />
          );
        })}
      </ul>
    </>
  );
}

export function OpportunitiesList() {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Total clients / total candidates KPIs: real counts from the existing
  // /api/clients and /api/candidates endpoints, best-effort only -- never
  // block or error the opportunities screen if they fail, and never shown
  // as a guessed/sample number.
  const [clientCount, setClientCount] = useState<number | undefined>(undefined);
  const [candidateCount, setCandidateCount] = useState<number | undefined>(undefined);
  // S-26: default landing is the company-grouped summary, not the flat
  // grid — "grid" is reached either by opening a company row (which also
  // sets companyFilter) or by the explicit "view all" escape hatch.
  const [view, setView] = useState<"grouped" | "grid">("grouped");
  const [companyFilter, setCompanyFilter] = useState(ALL_FILTER);
  const [familyFilter, setFamilyFilter] = useState(ALL_FILTER);
  const [signalFilter, setSignalFilter] = useState(ALL_FILTER);
  const [basisFilter, setBasisFilter] = useState(ALL_FILTER);
  const [ageFilter, setAgeFilter] = useState(ALL_FILTER);
  const [titleSearch, setTitleSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/hidden-demand/opportunities?includeSeedData=true", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`opportunities fetch failed: ${res.status}`);
        return res.json() as Promise<{ opportunities: Opportunity[] }>;
      })
      .then((body) => {
        if (!cancelled) setState({ status: "ok", opportunities: body.opportunities });
      })
      .catch((err) => {
        if (cancelled) return;
        setState(
          err instanceof Error && err.message === "unauthenticated"
            ? { status: "unauthenticated" }
            : { status: "error" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token) return;

    fetch("/api/clients", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ clients?: unknown[] }>) : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.clients)) {
          setClientCount(body.clients.length);
        }
      })
      .catch(() => {
        // Best-effort KPI only -- the opportunities screen must not fail
        // because this secondary fetch did.
      });

    fetch("/api/candidates", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ candidates?: unknown[] }>) : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.candidates)) {
          setCandidateCount(body.candidates.length);
        }
      })
      .catch(() => {
        // Best-effort KPI only -- the opportunities screen must not fail
        // because this secondary fetch did.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p>Loading opportunities...</p>;

  if (state.status === "unauthenticated") {
    // Reached only if the stored token was rejected (e.g. expired mid-session) —
    // App.tsx only renders this component at all once a token exists.
    return <p>Your session has expired. Please log in again.</p>;
  }

  if (state.status === "error") return <p>Could not load opportunities.</p>;

  if (state.opportunities.length === 0) return <p>No opportunities yet.</p>;

  const allOpportunities = state.opportunities;
  const sortedOpportunities = sortOpportunities(allOpportunities);
  const topPickId = findTopPick(allOpportunities);
  const hardToFillCount = allOpportunities.filter((o) => o.hardToFill).length;

  const filteredOpportunities = sortedOpportunities.filter((o) => {
    if (titleSearch.trim() && !`${o.title ?? ""} ${o.company}`.toLowerCase().includes(titleSearch.trim().toLowerCase())) return false;
    if (companyFilter !== ALL_FILTER && o.company !== companyFilter) return false;
    if (familyFilter !== ALL_FILTER && familyFor(o) !== familyFilter) return false;
    if (basisFilter !== ALL_FILTER && opportunityBasis(o) !== basisFilter) return false;
    if (signalFilter !== ALL_FILTER) {
      const signal = SIGNAL_TYPE_OPTIONS.find((s) => s.value === signalFilter);
      if (signal && !signal.test(o)) return false;
    }
    if (ageFilter !== ALL_FILTER) {
      const daysOpen = extractDaysOpen(o);
      if (daysOpen === undefined) return false;
      const bucket = AGE_BUCKET_OPTIONS.find((b) => b.value === ageFilter);
      if (bucket && !bucket.test(daysOpen)) return false;
    }
    return true;
  });
  const visibleOpportunities = filteredOpportunities.slice(0, visibleCount);

  const companies = [...new Set(allOpportunities.map((o) => o.company))].sort();
  const families = [...new Set(allOpportunities.map((o) => familyFor(o)))].sort();

  return (
    <>
      <header className="screen-intro">
        <span className="screen-intro-kicker">Demand intelligence</span>
        <h2>Opportunities</h2>
        <p>Start with a client, then open a role to see its demand signals, score basis, and candidate-fit guidance.</p>
      </header>
      <div className="opportunity-kpi-strip">
        <KpiTile label="Open requisitions" value={allOpportunities.length} icon={Briefcase} context={`n=${allOpportunities.length} loaded postings`} why="Job postings currently loaded from connected sources." />
        <KpiTile label="Hard-to-fill signals" value={hardToFillCount} icon={Flame} accent context={`n=${hardToFillCount} of ${allOpportunities.length} loaded postings`} why="Roles matching the app’s current difficulty indicators; verify the evidence before prioritizing." />
        <KpiTile label="Client profiles" value={clientCount} icon={Building2} context={`n=${clientCount ?? "not available"} client records`} why="Client records your team has added. This is separate from company names found in job postings." />
        <KpiTile label="Candidate profiles" value={candidateCount} icon={Users} context={`n=${candidateCount ?? "not available"} profiles`} why="Candidate profiles currently available for matching." />
      </div>

      {view === "grouped" && (
        <CompanyGroupedLanding
          opportunities={allOpportunities}
          onOpenCompany={(company) => {
            setCompanyFilter(company);
            setView("grid");
            setVisibleCount(PAGE_SIZE);
          }}
          onViewAll={() => {
            setCompanyFilter(ALL_FILTER);
            setView("grid");
            setVisibleCount(PAGE_SIZE);
          }}
        />
      )}

      {view === "grid" && (
        <>
      <button type="button" className="client-back-link" onClick={() => setView("grouped")}>
        <ArrowLeft size={14} aria-hidden="true" /> Back to companies
      </button>
      <div className="filterbar">
        <input className="select opportunity-search" type="search" aria-label="Search role or client" placeholder="Search roles or clients" value={titleSearch} onChange={(e) => { setTitleSearch(e.target.value); setVisibleCount(PAGE_SIZE); }} />
        <select className="select" value={companyFilter} onChange={(e) => { setCompanyFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}>
          <option value={ALL_FILTER}>All client companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select className="select" value={familyFilter} onChange={(e) => { setFamilyFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}>
          <option value={ALL_FILTER}>All role families</option>
          {families.map((f) => (
            <option key={f} value={f}>{FAMILY_LABELS[f] ?? f}</option>
          ))}
        </select>
        <select className="select" value={signalFilter} onChange={(e) => { setSignalFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}>
          <option value={ALL_FILTER}>All signal types</option>
          {SIGNAL_TYPE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select className="select" value={basisFilter} onChange={(e) => { setBasisFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}>
          <option value={ALL_FILTER}>All evidence basis</option>
          <option value="measured">Observed data (measured)</option>
          <option value="curated">Role guidance (curated)</option>
          <option value="none">No role-scarcity evidence (none)</option>
        </select>
        <select className="select" value={ageFilter} onChange={(e) => { setAgeFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}>
          <option value={ALL_FILTER}>Any age</option>
          {AGE_BUCKET_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      </div>

      <div className="opportunity-method-note" role="note">
        <b>How to read these indicators</b>
        <span><strong>Demand evidence</strong> combines the posting itself, time open, reposting, and salary visibility. Its percentage is a signal-strength indicator, not a chance of hire.</span>
        <span><strong>Hard-to-fill</strong> is a separate role-difficulty clue using role type and supporting evidence. It is a heuristic for review, not a guarantee. Each card is one requisition (n=1).</span>
      </div>
      {filteredOpportunities.some((opportunity) => opportunity.source === "lever") && (
        <div className="opportunity-source-caution" role="note">
          <b>Lever source quality needs review</b>
          Dates from this feed are unusually old, so they are excluded from measured role-scarcity comparisons. The demand score still uses posting age; treat those scores as provisional and verify that each requisition is active.
        </div>
      )}

      <p className="caption opportunities-filter-count">
        Showing {filteredOpportunities.length} of {allOpportunities.length} loaded requisitions · prioritized by the hard-to-fill signal
      </p>

      <ul aria-label="opportunities" className="opportunities-grid">
        {visibleOpportunities.map((opportunity, index) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            rank={index + 1}
            isTopPick={opportunity.id === topPickId}
          />
        ))}
      </ul>
      {visibleCount < filteredOpportunities.length && (
        <button
          type="button"
          className="opportunities-load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Load more ({visibleCount} of {filteredOpportunities.length})
        </button>
      )}
        </>
      )}
    </>
  );
}
