import { useEffect, useMemo, useState } from "react";
import { Building2, Users, Briefcase, Flame, Clock, Radar, Target, AlertTriangle, ArrowRight, Radio, type LucideIcon } from "lucide-react";
import { getStoredToken, getStoredRole, getStoredEmail } from "./auth";
import { useOpportunitiesSummary } from "./hooks/useOpportunitiesSummary";
import {
  type BasisOpportunity,
  computeSourceHealth,
  computeSignalInstanceCounts,
} from "./lib/basisDerivation";
import { summarizeStoredBasis, BASIS_AS_STORED_TOOLTIP } from "./lib/storedBasis";
import { ShowTheMath } from "./components/ShowTheMath";
import { InfoPopover } from "./components/InfoPopover";

interface Opportunity extends BasisOpportunity {
  company: string;
  confidenceScore: number;
  hardToFillScore?: number;
  diffComputedAt: string | null;
}

// Each simple tile is its own independent fetch/state machine, same
// convention as every other screen in this app (see AnalyticsDashboard.tsx's
// comment on why) -- a slow or failed client count must never block the
// candidate tile from rendering, and vice versa.
type CountState =
  | { status: "loading" }
  | { status: "ok"; count: number; demoCount?: number }
  | { status: "unauthenticated" }
  | { status: "error" };

function useListCount(path: string, listKey: string, enabled: boolean): CountState {
  const [state, setState] = useState<CountState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`${path} fetch failed: ${res.status}`);
        return res.json();
      })
      .then((body: Record<string, unknown[]>) => {
        if (cancelled) return;
        const items = (body[listKey] ?? []) as { name?: unknown }[];
        // Candidates loaded from the fixture file carry a "Fixture Candidate"
        // name prefix; counting them lets the tile say how many are demo data
        // instead of implying every profile is real.
        const demoCount = items.filter(
          (item) => typeof item?.name === "string" && /^Fixture Candidate/i.test(item.name),
        ).length;
        setState({ status: "ok", count: items.length, demoCount });
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
  }, [path, listKey, enabled]);

  return state;
}

// The opportunities fetch backs several pieces of this screen (KPI tiles,
// basis distribution, story panel, donut, top opportunities) -- one shared
// array-based state instead of useListCount, so it's fetched once and every
// consumer derives from the same rows.
type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

function useOpportunities(enabled: boolean): OpportunitiesState {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  return state;
}

function tileValue(state: CountState): string {
  return state.status === "ok" ? String(state.count) : state.status === "loading" ? "…" : "—";
}

function loadingValue(status: "loading" | "unauthenticated" | "error"): string {
  return status === "loading" ? "…" : "—";
}

// S-25: KPI tiles, each with a real number and a one-sentence plain-English
// "why" this number matters, per the approved mockup. The placeholder
// sparkline and per-tile "trend pending" line were replaced by a single
// page-level note (number-cleanup pass).

function KpiTile({
  icon: Icon,
  value,
  label,
  why,
  caption,
  error,
  basisPill,
  children,
  howCounted,
  emptyState,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  why: string;
  // Plain-language "How is this counted?" text (static; no new numbers).
  howCounted?: string;
  // Replaces the big number when there is nothing to count yet.
  emptyState?: React.ReactNode;
  // The real "n=..." disclosure line under the value -- what this count is
  // actually grounded in, same spirit as basisPill below but shown on
  // every tile, not just the ones with partial coverage.
  caption?: string;
  error?: boolean;
  // S-29: real n= disclosure for a KPI that isn't grounded in every
  // loaded opportunity (e.g. fit scoring only covers reqs with a real
  // requirements match) -- same "never hide what's unverified" pill
  // convention opportunity-basis-dot already established.
  basisPill?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="kpi-tile" role="group" aria-label={label}>
      <div className="kpi-tile-top">
        <span className="kpi-tile-label">{label}</span>
        <span className="kpi-tile-icon">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      {emptyState ?? <span className="kpi-tile-value mono">{value}</span>}
      {error && <span className="stat-tile-error">Could not load</span>}
      {children}
      {basisPill && <span className="kpi-tile-basis-pill">{basisPill}</span>}
      {caption && <p className="kpi-tile-caption">{caption}</p>}
      <p className="kpi-tile-why">Why it matters: {why}</p>
      {howCounted && <InfoPopover>{howCounted}</InfoPopover>}
    </div>
  );
}

// Demand-evidence band cut-offs (06_decisions/050). Named here so the "Show
// the math" text below reads the same numbers the counts use; the values are
// unchanged.
const TIER_STRONG_MIN = 0.7;
const TIER_GOOD_MIN = 0.5;
const TIER_REVIEW_MIN = 0.25;

const BASIS_TIERS = [
  { key: "measured" as const, label: "Measured", colorVar: "--success" },
  { key: "curated" as const, label: "Curated", colorVar: "--accent" },
  { key: "none" as const, label: "No basis", colorVar: "--border" },
];

// 06_decisions/051 (PROPOSED): these counts are the basis AS STORED on each
// loaded posting -- the same value the Opportunities cards show -- not
// re-derived in the browser (that disagreed: 180 vs 155 "measured" on the
// demo data). The three segments partition the loaded posting count.
function BasisBar({ summary }: { summary: ReturnType<typeof summarizeStoredBasis> }) {
  if (summary.total === 0) return null;
  const descriptions: Record<(typeof BASIS_TIERS)[number]["key"], string> = {
    measured: "Eligible live posting history can be compared with similar roles.",
    curated: "The title matches a reviewed role type; this is guidance, not measured scarcity.",
    none: "No role-difficulty evidence is available yet.",
  };
  return (
    <div className="overview-basis-list" aria-label={`Role-difficulty evidence across ${summary.total} loaded postings`}>
      {BASIS_TIERS.map((tier) => {
        const count = summary[tier.key];
        return (
          <div className="overview-basis-row" key={tier.key}>
            <div className="overview-basis-heading"><b>{tier.key === "measured" ? "Measured from live data" : tier.key === "curated" ? "Reviewed role guidance" : "No role-difficulty evidence"}</b><strong>{count.toLocaleString()} <small>postings · {Math.round((count / summary.total) * 100)}%</small></strong></div>
            <div className="overview-basis-track" role="img" aria-label={`${count} of ${summary.total} postings, ${Math.round((count / summary.total) * 100)} percent`}><i style={{ width: `${(count / summary.total) * 100}%`, background: `var(${tier.colorVar})` }} /></div>
            <span>{descriptions[tier.key]}</span>
          </div>
        );
      })}
    </div>
  );
}

// Local-part heuristic only, never a security- or identity-bearing
// decision -- purely a friendlier greeting. Falls back to a generic
// greeting for anything that doesn't cleanly read as a name (role-style
// addresses, all-numeric local parts, no stored email at all).
function firstNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._+-]+/).find((part) => part.length > 0);
  if (!first || !/^[a-zA-Z]+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface Tier {
  label: string;
  count: number;
  colorVar: string;
  // Plain-English reading of this tier, per 06_decisions/050 -- these
  // callouts describe the existing confidenceScore cutoffs below, they do
  // not change them.
  callout: string;
}

// S-25 "Story of this week": a 3-sentence narrative built entirely from
// real client-side aggregations (source health, reposted/long-open counts,
// the donut's own tier split) -- no invented numbers or company names. If
// there isn't enough source diversity loaded yet to say anything real, it
// renders nothing rather than a fabricated story.
function StoryOfTheWeek({
  opportunities,
  sourceHealth,
  tiers,
}: {
  opportunities: Opportunity[];
  sourceHealth: ReturnType<typeof computeSourceHealth>;
  tiers: Tier[];
}) {
  const healthy = sourceHealth.find((s) => s.verdict === "healthy");
  // Every figure in the first sentence is computed from THIS source's own
  // postings. (It used to count the whole loaded set but name one source, so
  // Lever's rows were reported as Greenhouse's.)
  const healthyRows = healthy ? opportunities.filter((o) => o.source === healthy.source) : [];
  const healthySignals = computeSignalInstanceCounts(healthyRows);
  // Reposts are detected by comparing polls; if that comparison has never run
  // for these rows, say so instead of printing a misleading 0.
  const repostsKnown = healthyRows.some((o) => o.diffComputedAt !== null);
  const flagged = sourceHealth.find((s) => s.verdict === "flagged — excluded");
  const tiersTotal = tiers.reduce((sum, t) => sum + t.count, 0);
  const dominant = tiersTotal > 0 ? [...tiers].sort((a, b) => b.count - a.count)[0] : null;

  if (!healthy && !flagged && !dominant) return null;

  return (
    <div className="overview-card overview-story">
      <div className="overview-story-eyebrow">In the loaded data</div>
      <p className="overview-story-body">
        {healthy && (
          <>
            {healthy.source} has {healthySignals.longOpen} long-open posting{healthySignals.longOpen === 1 ? "" : "s"} among
            its {healthyRows.length.toLocaleString()} loaded postings;{" "}
            {repostsKnown
              ? `${healthySignals.reposted} ${healthySignals.reposted === 1 ? "is" : "are"} reposted`
              : "reposts: not enough history yet"}
            .{" "}
          </>
        )}
        {flagged && (
          <>
            {flagged.source}'s median is {flagged.medianDaysOpen} days and is flagged — excluded from measured
            scarcity because it skews the view.{" "}
          </>
        )}
        {dominant && (
          <>
            Most opportunities sit in the {dominant.label} band right now ({dominant.count} of {tiersTotal}), so
            focus review time on the measured-basis subset.
          </>
        )}
      </p>
      <div className="overview-story-badges">
        {healthy && <span className="source-badge source-badge--live">source live · {healthy.source}</span>}
        {flagged && (
          <span className="source-badge source-badge--flag">source flag · flagged — excluded · {flagged.source}</span>
        )}
      </div>
    </div>
  );
}

// S-25 "Top 3 opportunities": same ranking rule as 06_decisions/048's
// top-pick heuristic (highest hardToFillScore in the currently-loaded
// list, undefined-score rows ineligible), extended from top-1 to top-3.
// The "why" per card reuses the opportunity's own real reason strings --
// never invented prose.
function TopOpportunities({ top3 }: { top3: Opportunity[] }) {
  if (top3.length === 0) return null;
  return (
    <div className="overview-card overview-top-opps">
      <h3>Roles to review first</h3>
      <p className="overview-card-subhead">Ranked by the role-difficulty indicator. Check the clues and confirm the posting is active before approaching a client.</p>
      <div className="top-opp-grid">
        {top3.map((o) => {
          const rawReasons = (o.hardToFillReasons?.length ? o.hardToFillReasons : o.reasons).slice(0, 2);
          const why = rawReasons.map((reason) => {
            const measured = reason.match(/role scarcity: measured \(family '([^']+)', median (\d+)d vs global (\d+)d\)/i);
            if (measured) return `Similar eligible live roles stay open for a median of ${measured[2]} days, compared with ${measured[3]} days across eligible roles.`;
            if (reason.startsWith("role scarcity: curated")) return "The title matches a reviewed role type; this is guidance, not a measured scarcity rate.";
            const open = reason.match(/^open (\d+) days?$/i);
            if (open) return `This posting has been open for ${open[1]} days; confirm that it is still active.`;
            if (reason === "reposted role") return "This role appears to have been reposted; check whether the client still needs it.";
            return reason.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
          }).join(" ");
          return (
            <div className="top-opp-card" key={o.id}>
              <div className="top-opp-card-head">
                <span className="top-opp-card-title">{o.title}</span>
                <span className="top-opp-score-badge mono" title="Role-difficulty indicator for review, not a probability of hiring">Difficulty signal {Math.round(o.hardToFillScore! * 100)} of 100</span>
              </div>
              <div className="top-opp-card-company">{o.company}</div>
              {why && <p className="top-opp-card-why">{why}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// S-29: fit-scoring summary (S-28's GET /api/fits/summary). A fourth,
// independent fetch/state machine, same "never block the rest of the
// screen" reasoning every other Overview fetch already follows -- a slow
// or failed fit summary must not stop the opportunity KPIs above it from
// rendering.
interface FitDistribution {
  ge85: number;
  b70_84: number;
  b60_69: number;
  lt60: number;
  insufficient_data: number;
}

interface FitsSummary {
  totalOpportunities: number;
  totalCandidates: number;
  avgFitScore: number | null;
  measuredCount: number;
  distribution: FitDistribution;
}

type FitsSummaryState =
  | { status: "loading" }
  | { status: "ok"; summary: FitsSummary }
  | { status: "unauthenticated" }
  | { status: "error" };

function useFitsSummary(enabled: boolean): FitsSummaryState {
  const [state, setState] = useState<FitsSummaryState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/fits/summary", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`fits summary fetch failed: ${res.status}`);
        return res.json() as Promise<FitsSummary>;
      })
      .then((summary) => {
        if (!cancelled) setState({ status: "ok", summary });
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
  }, [enabled]);

  return state;
}

const FIT_BUCKET_MEANINGS: { key: keyof FitDistribution; label: string; colorVar: string; meaning: string }[] = [
  { key: "ge85", label: "≥85%", colorVar: "--success", meaning: "Strong overlap — review before outreach" },
  { key: "b70_84", label: "70–84%", colorVar: "--accent", meaning: "Needs review" },
  { key: "b60_69", label: "60–69%", colorVar: "--warning", meaning: "Review criteria or search for candidates" },
  { key: "lt60", label: "<60%", colorVar: "--danger", meaning: "Weak overlap" },
  { key: "insufficient_data", label: "insufficient data", colorVar: "--border", meaning: "Candidate data insufficient" },
];

// S-29 "Fit distribution" panel: one real bucket count per opportunity
// (its single best-matching candidate's fit score, per 06_decisions/056),
// as a stacked bar plus a labeled row per bucket with a one-sentence plain-
// English reading. Real basis pill: how many of the total opportunities
// this distribution actually covers (insufficient_data is a real, counted
// outcome, not hidden).
function FitDistributionPanel({ summary }: { summary: FitsSummary }) {
  const total = summary.totalOpportunities;
  if (total === 0) return null;

  return (
    <div className="overview-card overview-card-fit-distribution">
      <h3>Best candidate skill match, by role</h3>
      <p className="overview-card-subhead">
        For each loaded posting, this shows the strongest available candidate match. {summary.measuredCount} roles have measured fit; {total - summary.measuredCount} do not have enough candidate data. Fit reflects skill overlap, not a probability of hiring.
      </p>
      <div className="stat-tile-stacked-track" role="img" aria-label="Fit score distribution across all loaded opportunities">
        {FIT_BUCKET_MEANINGS.map((bucket) => {
          const count = summary.distribution[bucket.key];
          if (count === 0) return null;
          return (
            <div
              key={bucket.key}
              className="stat-tile-stacked-seg"
              style={{ width: `${(count / total) * 100}%`, background: `var(${bucket.colorVar})` }}
            />
          );
        })}
      </div>
      <ul className="fit-distribution-legend">
        {FIT_BUCKET_MEANINGS.map((bucket) => (
          <li key={bucket.key}>
            <span className="stat-tile-stacked-legend-swatch" style={{ background: `var(${bucket.colorVar})` }} />
            <span className="fit-distribution-bucket-label">{bucket.label}</span>
            <span className="fit-distribution-bucket-count mono">{summary.distribution[bucket.key]}</span>
            <span className="fit-distribution-bucket-meaning">{bucket.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Overview: the default landing screen after login. Opportunities/
// hard-to-fill/distribution/latest-ingestion are all gated to admin/sales
// because GET /api/hidden-demand/opportunities itself is admin/sales-only
// on the backend (same as the real Opportunities screen's RoleGate) -- a
// recruiter would otherwise get a 403 on data they were never meant to see.
function StartHereGuide({
  canSeeOpportunities,
  onNavigate,
}: {
  canSeeOpportunities: boolean;
  onNavigate: (view: string) => void;
}) {
  const steps = canSeeOpportunities
    ? [
        { label: "Spot demand", detail: "See the job signals behind the alert.", view: "signals", action: "Explore signals", icon: Radio },
        { label: "Prioritize roles", detail: "Review roles that may be hardest to fill.", view: "targeting", action: "Review targeting", icon: Flame },
        { label: "Check candidate fit", detail: "Compare fit evidence and gaps.", view: "match", action: "Review matches", icon: Target },
        { label: "Decide what to share", detail: "Prepare a draft for human review.", view: "packages", action: "Open packages", icon: Briefcase },
      ]
    : [
        { label: "Review open roles", detail: "See the jobs your team is working on.", view: "jobs", action: "Open jobs", icon: Briefcase },
        { label: "Review candidates", detail: "Check candidate profiles and evidence.", view: "candidates", action: "Open candidates", icon: Users },
        { label: "Check recommendations", detail: "See suggested next steps and rationale.", view: "recommendations", action: "View recommendations", icon: Target },
        { label: "Prepare a draft", detail: "Review package details before anything is shared.", view: "packages", action: "Open packages", icon: ArrowRight },
      ];

  return (
    <section className="overview-start" aria-labelledby="overview-start-title">
      <div className="overview-start-copy">
        <span className="overview-start-eyebrow">TalentSignal · staffing demand intelligence</span>
        <h2 id="overview-start-title">Find hard-to-fill hiring demand. Decide what to do next.</h2>
        <p>
          TalentSignal brings job-market signals and candidate-fit evidence together so your team can spot
          difficult roles, prioritize its review, and prepare a response. Every recommendation is for your
          team to review; nothing is sent automatically.
        </p>
      </div>
      <div className="overview-start-steps" aria-label="Suggested workflow">
        {steps.map(({ label, detail, view, action, icon: Icon }) => (
          <article className="overview-start-step" key={view}>
            <div className="overview-start-step-top">
              <span className="overview-start-step-marker" aria-hidden="true" />
              <Icon size={17} aria-hidden="true" />
            </div>
            <h3>{label}</h3>
            <p>{detail}</p>
            <button type="button" className="overview-start-link" onClick={() => onNavigate(view)}>
              {action}<ArrowRight size={14} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      <p className="overview-start-footnote">Scores and recommendations include their evidence and data coverage so you can judge how much to rely on them.</p>
    </section>
  );
}

export function OverviewScreen({ onNavigate }: { onNavigate: (view: string) => void }) {
  const role = getStoredRole();
  const canSeeOpportunities = role === "admin" || role === "sales";
  const email = getStoredEmail();
  const firstName = firstNameFromEmail(email);

  const clients = useListCount("/api/clients", "clients", true);
  const candidates = useListCount("/api/candidates", "candidates", true);
  const opportunitiesState = useOpportunities(canSeeOpportunities);
  // S-24 (Fix 1): tile counts come from the cheap pre-aggregated endpoint
  // instead of the full opportunities array below, so they're no longer
  // recomputed by filtering hundreds/thousands of rows on every render (the
  // "Opportunities screen ... computes tile counts every render" complaint).
  // Total/hardToFill/requisitionsIngested are still correct from this
  // endpoint -- only the basis breakdown was wrong (06_decisions/049), and
  // that's now derived client-side below instead.
  const summaryState = useOpportunitiesSummary(canSeeOpportunities);
  const fitsSummaryState = useFitsSummary(canSeeOpportunities);

  const opportunities = opportunitiesState.status === "ok" ? opportunitiesState.opportunities : [];
  const opportunitiesCount: CountState =
    summaryState.status === "ok"
      ? { status: "ok", count: summaryState.summary.total }
      : summaryState.status === "loading" || summaryState.status === "unauthenticated"
        ? summaryState
        : { status: "error" };
  const hardToFillCount: CountState =
    summaryState.status === "ok"
      ? { status: "ok", count: summaryState.summary.hardToFill }
      : summaryState.status === "loading" || summaryState.status === "unauthenticated"
        ? summaryState
        : { status: "error" };
  // Only /summary exposes this (no route reads raw_requisitions today), so
  // it's gated the same as the other opportunity-derived tiles -- a
  // recruiter sees Clients/Candidates but not this one.
  const requisitionsIngestedCount: CountState =
    summaryState.status === "ok"
      ? { status: "ok", count: summaryState.summary.totalRequisitionsIngested }
      : summaryState.status === "loading" || summaryState.status === "unauthenticated"
        ? summaryState
        : { status: "error" };

  // The donut/basis/story/top-opps panels below all need the full
  // per-opportunity array (confidence tier, per-source days-open, reasons,
  // hard-to-fill score -- none of that lives in the /summary aggregate),
  // but there's no reason to re-run these passes on a render this array
  // didn't change for (e.g. the theme toggle) -- memoized on the array
  // reference.
  const tiers: Tier[] = useMemo(
    () => [
      {
        label: "Strong",
        count: opportunities.filter((o) => o.confidenceScore >= TIER_STRONG_MIN).length,
        colorVar: "--success",
        callout: "act now",
      },
      {
        label: "Good",
        count: opportunities.filter((o) => o.confidenceScore >= TIER_GOOD_MIN && o.confidenceScore < TIER_STRONG_MIN).length,
        colorVar: "--accent",
        callout: "strong signal",
      },
      {
        label: "Review",
        count: opportunities.filter((o) => o.confidenceScore >= TIER_REVIEW_MIN && o.confidenceScore < TIER_GOOD_MIN).length,
        colorVar: "--warning",
        callout: "verify before acting",
      },
      {
        label: "Poor",
        count: opportunities.filter((o) => o.confidenceScore < TIER_REVIEW_MIN).length,
        colorVar: "--danger",
        callout: "likely noise",
      },
    ],
    [opportunities],
  );
  const tiersTotal = tiers.reduce((sum, t) => sum + t.count, 0);

  const basisSummary = useMemo(() => summarizeStoredBasis(opportunities), [opportunities]);
  const signalCounts = useMemo(() => computeSignalInstanceCounts(opportunities), [opportunities]);
  const sourceHealth = useMemo(() => computeSourceHealth(opportunities), [opportunities]);
  const top3 = useMemo(
    () =>
      [...opportunities]
        .filter((o): o is Opportunity & { hardToFillScore: number } => o.hardToFillScore !== undefined)
        .sort((a, b) => b.hardToFillScore - a.hardToFillScore)
        .slice(0, 3),
    [opportunities],
  );

  const sources = useMemo(() => [...new Set(opportunities.map((o) => o.source))].sort(), [opportunities]);
  const latestDiff = useMemo(
    () =>
      opportunities
        .map((o) => o.diffComputedAt)
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1),
    [opportunities],
  );

  return (
    <section aria-label="overview">
      <div className="overview-header">
        <div>
          <h2 className="overview-greeting">{firstName ? `Good morning, ${firstName}` : "Welcome back"}</h2>
          {/* GREENHOUSE_BOARDS/LEVER_COMPANIES are backend-only env vars with
              no endpoint exposing them to the frontend, and this pass adds
              no new backend route -- using the non-config-exposing fallback
              the ticket offered for exactly this case. */}
          <p className="overview-subtitle">A clear view of hiring demand, role difficulty, and candidate fit.</p>
        </div>
      </div>

      <StartHereGuide canSeeOpportunities={canSeeOpportunities} onNavigate={onNavigate} />

      {/* S-25: KPI tiles per the approved mockup. Number-cleanup pass (07_analyses/
          number-audit-2026-11-03.md): per-tile "trend pending" lines and the
          placeholder sparklines were replaced by ONE note below; definitions
          moved into "Show the math". Labels say what each count is. */}
      {canSeeOpportunities && (
        <>
          <div className="kpi-grid">
            <KpiTile
              icon={Flame}
              value={hardToFillCount.status === "ok" ? String(hardToFillCount.count) : tileValue(hardToFillCount)}
              label="Hard-to-fill"
              howCounted="Counts loaded postings whose difficulty signal reaches the app's hard-to-fill cut-off. Open a posting card to see exactly how it was scored."
              why="where your agency's revenue is hiding"
              error={hardToFillCount.status === "error" || opportunitiesCount.status === "error"}
            />
            <KpiTile
              icon={Radar}
              value={opportunitiesState.status === "ok" ? String(signalCounts.total) : loadingValue(opportunitiesState.status)}
              label="Clues found"
              howCounted="Adds up four kinds of clue across all loaded postings: reposted, open a long time, open a very long time, and no salary listed. One posting can have several clues, so this can be higher than the number of postings."
              why="reposted, long-open, very long-open and no-salary clues; one posting can have several, so this can be higher than the number of postings"
              error={opportunitiesState.status === "error"}
            />
            <KpiTile
              icon={Building2}
              value={tileValue(clients)}
              label="Client records (CRM)"
              howCounted="Counts the clients your team has added to the CRM. It does not count the company names that appear in job postings; those are on the Clients screen."
              emptyState={
                clients.status === "ok" && clients.count === 0 ? (
                  <div className="kpi-empty">
                    <strong>No client records yet</strong>
                    <p>Clients your team adds to the CRM will be counted here.</p>
                  </div>
                ) : undefined
              }
              why="client records your team has added; separate from the companies named in job postings"
              error={clients.status === "error"}
            />
            <KpiTile
              icon={Users}
              value={tileValue(candidates)}
              label="Candidates"
              howCounted="Counts every profile in the candidate pool, including any demo (fixture) profiles. Demo profiles are labelled under the number when there are any."
              why="profiles in your candidate pool"
              caption={
                candidates.status === "ok" && candidates.demoCount
                  ? `${candidates.demoCount} demo (fixture) profile${candidates.demoCount === 1 ? "" : "s"}`
                  : undefined
              }
              error={candidates.status === "error"}
            />

            {/* S-29: fit-scoring KPI tiles (S-28's /api/fits/summary). */}
            {fitsSummaryState.status === "ok" && (
              <KpiTile
                icon={Target}
                value={
                  fitsSummaryState.summary.avgFitScore === null
                    ? "—"
                    : `${Math.round(fitsSummaryState.summary.avgFitScore * 100)}%`
                }
                label="Average best-candidate match"
                howCounted="For each posting with measured candidate data, the app takes its single best candidate's skill-overlap score, then averages those scores. It measures skill overlap, not the chance of a hire."
                why={`across ${fitsSummaryState.summary.measuredCount} reqs · ${fitsSummaryState.summary.totalCandidates} candidates`}
              />
            )}
            {fitsSummaryState.status !== "ok" && (
              <KpiTile
                icon={Target}
                value={loadingValue(fitsSummaryState.status)}
                label="Average best-candidate match"
                howCounted="For each posting with measured candidate data, the app takes its single best candidate's skill-overlap score, then averages those scores. It measures skill overlap, not the chance of a hire."
                why="across reqs with measured fit data"
                error={fitsSummaryState.status === "error"}
              />
            )}

            {fitsSummaryState.status === "ok" && (
              <KpiTile
                icon={Target}
                value={String(fitsSummaryState.summary.distribution.ge85)}
                label="Reqs with strong candidates (≥85%)"
                howCounted="Counts postings whose best candidate shares 85% or more of the skills the role needs. Postings without enough candidate data are not counted."
                why="potentially strong fit; review evidence first"
              />
            )}
            {fitsSummaryState.status !== "ok" && (
              <KpiTile
                icon={Target}
                value={loadingValue(fitsSummaryState.status)}
                label="Reqs with strong candidates (≥85%)"
                howCounted="Counts postings whose best candidate shares 85% or more of the skills the role needs. Postings without enough candidate data are not counted."
                why="potentially strong fit; review evidence first"
                error={fitsSummaryState.status === "error"}
              />
            )}

            {fitsSummaryState.status === "ok" && (
              <KpiTile
                icon={AlertTriangle}
                value={String(
                  fitsSummaryState.summary.distribution.b60_69 + fitsSummaryState.summary.distribution.lt60,
                )}
                label="Reqs with best match below 70%"
                howCounted="Counts postings whose best candidate shares less than 70% of the skills the role needs. Postings without enough candidate data are not counted here."
                why="review fit gaps and the available evidence"
              />
            )}
            {fitsSummaryState.status !== "ok" && (
              <KpiTile
                icon={AlertTriangle}
                value={loadingValue(fitsSummaryState.status)}
                label="Reqs with best match below 70%"
                howCounted="Counts postings whose best candidate shares less than 70% of the skills the role needs. Postings without enough candidate data are not counted here."
                why="review fit gaps and the available evidence"
                error={fitsSummaryState.status === "error"}
              />
            )}
          </div>

          <p className="trend-note">Trend lines are not shown yet: they need 4+ weeks of ingestion history.</p>

          <ShowTheMath>
            <p><b>Counts behind the tiles</b>:{" "}
              {hardToFillCount.status === "ok" && opportunitiesCount.status === "ok" ? `${hardToFillCount.count} of ${opportunitiesCount.count} postings are flagged hard-to-fill; ` : ""}
              {opportunitiesState.status === "ok" ? `${signalCounts.total} clues across ${opportunities.length} postings; ` : ""}
              {clients.status === "ok" ? `${clients.count} client records (CRM); ` : ""}
              {candidates.status === "ok" ? `${candidates.count} candidates` : ""}
              {fitsSummaryState.status === "ok" ? `. The three candidate-match tiles are based on ${fitsSummaryState.summary.measuredCount} of ${fitsSummaryState.summary.totalOpportunities} reqs that have measured fit data.` : "."}
            </p>
            <p><b>Hard-to-fill</b>: postings whose difficulty signal reaches the app's hard-to-fill cut-off (set in hardToFillConfig.ts). Each posting's "How this was scored" lists the factors.</p>
            <p><b>Clues found</b>: the sum of four overlapping clue counts (reposted, long-open, very long-open, no salary range). A posting can have several, and very long-open postings are also counted as long-open.</p>
            <p><b>Client records (CRM)</b>: rows in the CRM clients table. The companies named in job postings are counted separately on the Clients screen.</p>
            <p><b>Average best-candidate match</b>: for each posting with measured fit, take its single best candidate's skill-overlap score, then average those scores (decision 056, weights PROPOSED).</p>
          </ShowTheMath>
        </>
      )}

      {canSeeOpportunities && fitsSummaryState.status === "ok" && (
        <FitDistributionPanel summary={fitsSummaryState.summary} />
      )}

      {canSeeOpportunities && fitsSummaryState.status === "ok" && (
        <p className="overview-fit-caveat" role="note">
          Candidate fit is skill overlap, not a hiring probability. Demo profiles may be included; review the candidate records before using these matches as sourcing evidence.
        </p>
      )}

      {canSeeOpportunities && (
        <>
          <div className="stat-grid stat-grid-secondary">
            <div className="stat-tile stat-tile-secondary" role="group" aria-label="Postings ingested">
              <div className="stat-tile-icon" style={{ background: "var(--mute)" }}>
                <Briefcase size={15} aria-hidden="true" />
              </div>
              <span className="stat-tile-value">{tileValue(opportunitiesCount)}</span>
              <span className="stat-tile-label">Postings ingested</span>
              {opportunitiesCount.status === "ok" && <span className="stat-tile-real-badge">distinct</span>}
              {opportunitiesCount.status === "error" && <span className="stat-tile-error">Could not load</span>}
            </div>
          </div>
          {requisitionsIngestedCount.status === "ok" && (
            <ShowTheMath>
              <p><b>Snapshots stored: {requisitionsIngestedCount.count.toLocaleString()}</b>. Every poll of a source stores one row per posting it returned, so this is larger than the number of distinct postings above.</p>
            </ShowTheMath>
          )}
        </>
      )}

      {canSeeOpportunities && (
        <StoryOfTheWeek opportunities={opportunities} sourceHealth={sourceHealth} tiers={tiers} />
      )}

      {canSeeOpportunities && (
        <div className="overview-bottom">
          <div className="overview-card overview-card-ingestion">
            <h3>Latest Ingestion</h3>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load ingestion activity.</p>}
            {opportunitiesState.status === "ok" && (
              <>
                <p className="overview-card-subhead">
                  <Clock size={14} aria-hidden="true" />
                  Last run: {latestDiff ? formatRelativeTime(latestDiff) : "never"}
                </p>
                <p>
                  <strong>{opportunities.length}</strong> posting{opportunities.length === 1 ? "" : "s"}{" "}
                  loaded from {sources.length > 0 ? sources.join(", ") : "no sources yet"}
                </p>
              </>
            )}
          </div>

          <div className="overview-card overview-card-distribution">
            <h3>How strong the hiring-demand evidence looks</h3>
            <p className="overview-card-subhead">These bands group loaded postings by demand-evidence score. They describe posting signals, not candidate fit or the chance of a hire.</p>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load distribution.</p>}
            {opportunitiesState.status === "ok" && (
              <div className="overview-tier-list" aria-label={`Demand evidence bands across ${tiersTotal} loaded postings`}>
                {tiers.map((tier) => {
                  const share = tiersTotal > 0 ? Math.round((tier.count / tiersTotal) * 100) : 0;
                  return <div className="overview-tier-row" key={tier.label}>
                    <div className="overview-tier-heading"><b>{tier.label}</b><strong>{tier.count.toLocaleString()} <small>postings · {share}%</small></strong></div>
                    <div className="overview-tier-track" role="img" aria-label={`${tier.count} of ${tiersTotal} postings, ${share} percent`}><i style={{ width: `${share}%`, background: `var(${tier.colorVar})` }} /></div>
                    <span>{tier.callout === "act now" ? "Strongest demand clues; review the underlying requisition." : tier.callout === "strong signal" ? "Several demand clues are present; check the role details." : tier.callout === "verify before acting" ? "Confirm the posting and evidence before prioritizing." : "Few demand clues; use other information before deciding."}</span>
                  </div>;
                })}
              </div>
            )}
            {opportunitiesState.status === "ok" && (
              <ShowTheMath>
                <p>Bands group each posting's demand-evidence score: Strong is {Math.round(TIER_STRONG_MIN * 100)}% or more, Good is {Math.round(TIER_GOOD_MIN * 100)}% to under {Math.round(TIER_STRONG_MIN * 100)}%, Review is {Math.round(TIER_REVIEW_MIN * 100)}% to under {Math.round(TIER_GOOD_MIN * 100)}%, Poor is under {Math.round(TIER_REVIEW_MIN * 100)}% (decision 050).</p>
              </ShowTheMath>
            )}
          </div>

          <div className="overview-card overview-card-basis">
            <h3>
              Evidence behind role-difficulty estimates{" "}
              <span className="small" title={BASIS_AS_STORED_TOOLTIP} tabIndex={0} aria-label={BASIS_AS_STORED_TOOLTIP}>
                Basis as stored ⓘ
              </span>
            </h3>
            <p className="overview-card-subhead">How much support the app has for saying a role may be hard to fill, across {basisSummary.total.toLocaleString()} loaded postings.</p>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load basis distribution.</p>}
            {opportunitiesState.status === "ok" && <BasisBar summary={basisSummary} />}
          </div>
        </div>
      )}

      {canSeeOpportunities && opportunitiesState.status === "ok" && <TopOpportunities top3={top3} />}
    </section>
  );
}
