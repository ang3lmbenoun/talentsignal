import { useEffect, useMemo, useState } from "react";
import { Building2, Users, Briefcase, Flame, Play, Clock, Radar, type LucideIcon } from "lucide-react";
import { getStoredToken, getStoredRole, getStoredEmail } from "./auth";
import { useOpportunitiesSummary } from "./hooks/useOpportunitiesSummary";
import {
  type BasisOpportunity,
  summarizeBasis,
  computeSourceHealth,
  computeSignalInstanceCounts,
} from "./lib/basisDerivation";

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
  | { status: "ok"; count: number }
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
        if (!cancelled) setState({ status: "ok", count: (body[listKey] ?? []).length });
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

// S-25: 4 equal-weight KPI tiles, each with a real number, a placeholder
// sparkline (explicitly not data-bound -- no time-series history exists
// yet), and a one-sentence plain-English "why" this number matters, per
// the approved mockup (talentsignal-redesign.html, Screen 1 -- Overview).
function KpiTile({
  icon: Icon,
  accentVar,
  value,
  label,
  why,
  error,
}: {
  icon: LucideIcon;
  accentVar: "--accent" | "--accent-2";
  value: string;
  label: string;
  why: string;
  error?: boolean;
}) {
  return (
    <div className="kpi-tile" role="group" aria-label={label}>
      <div className="kpi-tile-icon" style={{ background: `var(${accentVar})` }}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <span className="kpi-tile-value mono">{value}</span>
      <span className="kpi-tile-label">{label}</span>
      {error && <span className="stat-tile-error">Could not load</span>}
      <svg className="kpi-tile-sparkline" viewBox="0 0 100 24" role="img" aria-label="Trend placeholder, no history yet">
        <path d="M0 18 L15 12 L30 15 L45 8 L60 12 L75 6 L100 10" fill="none" stroke="var(--border)" strokeWidth="2" />
      </svg>
      <p className="kpi-tile-caption">needs 4+ weeks of ingestion for a trend</p>
      <p className="kpi-tile-why">{why}</p>
    </div>
  );
}

const BASIS_TIERS = [
  { key: "measured" as const, label: "Measured", colorVar: "--success" },
  { key: "curated" as const, label: "Curated", colorVar: "--accent" },
  { key: "none" as const, label: "No basis", colorVar: "--border" },
];

// 06_decisions/049: basis is now derived client-side (same derivation
// SignalsScreen.tsx uses, from frontend/src/lib/basisDerivation.ts) instead
// of trusting /api/opportunities/summary's measuredBasis/curatedBasis/
// noBasis fields, which always read 0/0/total because production's
// opportunities table was never rescored under S-23. Every number is
// basisSummary.total's own partition, so the three segments always add up
// to the loaded opportunity count.
function BasisBar({ summary }: { summary: ReturnType<typeof summarizeBasis> }) {
  if (summary.total === 0) return null;
  return (
    <div className="stat-tile-stacked">
      <div
        className="stat-tile-stacked-track"
        role="img"
        aria-label={`Scoring basis: ${summary.measured} measured, ${summary.curated} curated, ${summary.none} no basis, out of ${summary.total} total`}
      >
        {BASIS_TIERS.map((tier) => {
          const count = summary[tier.key];
          if (count === 0) return null;
          return (
            <div
              key={tier.key}
              className="stat-tile-stacked-seg"
              style={{ width: `${(count / summary.total) * 100}%`, background: `var(${tier.colorVar})` }}
            />
          );
        })}
      </div>
      <div className="stat-tile-stacked-legend">
        {BASIS_TIERS.map((tier) => (
          <span className="stat-tile-stacked-legend-item" key={tier.key}>
            <span
              className="stat-tile-stacked-legend-swatch"
              style={{ background: `var(${tier.colorVar})` }}
            />
            {tier.label} {summary[tier.key]}
          </span>
        ))}
      </div>
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

const RADIUS = 60;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Pure SVG donut -- no chart library. Stacks one <circle> per segment, each
// using stroke-dasharray/-dashoffset to draw only its own arc of the ring;
// the enclosing <g> is rotated -90deg so segments start at 12 o'clock.
function DonutChart({ tiers }: { tiers: Tier[] }) {
  const total = tiers.reduce((sum, tier) => sum + tier.count, 0);
  let cumulative = 0;

  return (
    <svg viewBox="0 0 160 160" className="donut-svg" role="img" aria-label="Opportunity distribution by confidence tier">
      <g transform="rotate(-90 80 80)">
        {total === 0 ? (
          <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
        ) : (
          tiers
            .filter((tier) => tier.count > 0)
            .map((tier) => {
              const dash = (tier.count / total) * CIRCUMFERENCE;
              const offset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={tier.label}
                  cx="80"
                  cy="80"
                  r={RADIUS}
                  fill="none"
                  stroke={`var(${tier.colorVar})`}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={offset}
                />
              );
            })
        )}
      </g>
      <text x="80" y="76" textAnchor="middle" className="donut-total-value">
        {total}
      </text>
      <text x="80" y="94" textAnchor="middle" className="donut-total-label">
        total
      </text>
    </svg>
  );
}

// S-25 "Story of this week": a 3-sentence narrative built entirely from
// real client-side aggregations (source health, reposted/long-open counts,
// the donut's own tier split) -- no invented numbers or company names. If
// there isn't enough source diversity loaded yet to say anything real, it
// renders nothing rather than a fabricated story.
function StoryOfTheWeek({
  sourceHealth,
  signalCounts,
  tiers,
}: {
  sourceHealth: ReturnType<typeof computeSourceHealth>;
  signalCounts: ReturnType<typeof computeSignalInstanceCounts>;
  tiers: Tier[];
}) {
  const healthy = sourceHealth.find((s) => s.verdict === "healthy");
  const flagged = sourceHealth.find((s) => s.verdict === "flagged — excluded");
  const tiersTotal = tiers.reduce((sum, t) => sum + t.count, 0);
  const dominant = tiersTotal > 0 ? [...tiers].sort((a, b) => b.count - a.count)[0] : null;

  if (!healthy && !flagged && !dominant) return null;

  return (
    <div className="overview-card overview-story">
      <div className="overview-story-eyebrow">This week · story</div>
      <p className="overview-story-body">
        {healthy && (
          <>
            {healthy.source} shows {signalCounts.longOpen} long-open and {signalCounts.reposted} reposted
            opportunit{signalCounts.reposted === 1 ? "y" : "ies"} in the currently loaded set.{" "}
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
      <h3>Top opportunities · ranked by hard-to-fill signal</h3>
      <div className="top-opp-grid">
        {top3.map((o) => {
          const why = (o.hardToFillReasons?.length ? o.hardToFillReasons : o.reasons).slice(0, 2).join("; ");
          return (
            <div className="top-opp-card" key={o.id}>
              <div className="top-opp-card-head">
                <span className="top-opp-card-title">{o.title}</span>
                <span className="top-opp-score-badge mono">{o.hardToFillScore!.toFixed(2)}</span>
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

// Overview: the default landing screen after login. Opportunities/
// hard-to-fill/distribution/latest-ingestion are all gated to admin/sales
// because GET /api/hidden-demand/opportunities itself is admin/sales-only
// on the backend (same as the real Opportunities screen's RoleGate) -- a
// recruiter would otherwise get a 403 on data they were never meant to see.
export function OverviewScreen() {
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
        count: opportunities.filter((o) => o.confidenceScore >= 0.7).length,
        colorVar: "--success",
        callout: "act now",
      },
      {
        label: "Good",
        count: opportunities.filter((o) => o.confidenceScore >= 0.5 && o.confidenceScore < 0.7).length,
        colorVar: "--accent",
        callout: "strong signal",
      },
      {
        label: "Review",
        count: opportunities.filter((o) => o.confidenceScore >= 0.25 && o.confidenceScore < 0.5).length,
        colorVar: "--warning",
        callout: "verify before acting",
      },
      {
        label: "Poor",
        count: opportunities.filter((o) => o.confidenceScore < 0.25).length,
        colorVar: "--danger",
        callout: "likely noise",
      },
    ],
    [opportunities],
  );
  const tiersTotal = tiers.reduce((sum, t) => sum + t.count, 0);

  const basisSummary = useMemo(() => summarizeBasis(opportunities), [opportunities]);
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
          <p className="overview-subtitle">Your talent signal intelligence</p>
        </div>
        <button type="button" disabled title="Coming soon" className="overview-run-ingestion">
          <Play size={15} aria-hidden="true" />
          Run Ingestion
        </button>
      </div>

      {/* S-25: 4 equal-weight KPI tiles per the approved mockup -- replaces
          the prior single dominant hero tile plus the Clients/Candidates
          entries from the old secondary row (Requisitions Ingested stays
          below as its own small tile; it isn't one of the mockup's 4). */}
      {canSeeOpportunities && (
        <div className="kpi-grid">
          <KpiTile
            icon={Flame}
            accentVar="--accent-2"
            value={
              hardToFillCount.status === "ok" && opportunitiesCount.status === "ok"
                ? `${hardToFillCount.count}/${opportunitiesCount.count}`
                : tileValue(hardToFillCount)
            }
            label="Hard-to-fill"
            why="where your agency's revenue is hiding"
            error={hardToFillCount.status === "error" || opportunitiesCount.status === "error"}
          />
          <KpiTile
            icon={Radar}
            accentVar="--accent"
            value={opportunitiesState.status === "ok" ? String(signalCounts.total) : loadingValue(opportunitiesState.status)}
            label="Total signals"
            why="reposts, long-open, stale, no-salary, scarcity"
            error={opportunitiesState.status === "error"}
          />
          <KpiTile
            icon={Building2}
            accentVar="--accent"
            value={tileValue(clients)}
            label="Active clients"
            why="companies feeding requisitions"
            error={clients.status === "error"}
          />
          <KpiTile
            icon={Users}
            accentVar="--accent-2"
            value={tileValue(candidates)}
            label="Candidates"
            why="available to match"
            error={candidates.status === "error"}
          />
        </div>
      )}

      {canSeeOpportunities && (
        <div className="stat-grid stat-grid-secondary">
          <div className="stat-tile stat-tile-secondary" role="group" aria-label="Requisitions Ingested">
            <div className="stat-tile-icon" style={{ background: "var(--mute)" }}>
              <Briefcase size={15} aria-hidden="true" />
            </div>
            <span className="stat-tile-value">{tileValue(requisitionsIngestedCount)}</span>
            <span className="stat-tile-label">Requisitions Ingested</span>
            {requisitionsIngestedCount.status === "ok" && <span className="stat-tile-real-badge">raw</span>}
            {requisitionsIngestedCount.status === "error" && <span className="stat-tile-error">Could not load</span>}
          </div>
        </div>
      )}

      {canSeeOpportunities && (
        <StoryOfTheWeek sourceHealth={sourceHealth} signalCounts={signalCounts} tiers={tiers} />
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
                  <strong>{opportunities.length}</strong> opportunit{opportunities.length === 1 ? "y" : "ies"}{" "}
                  ingested from {sources.length > 0 ? sources.join(", ") : "no sources yet"}
                </p>
              </>
            )}
          </div>

          <div className="overview-card overview-card-distribution">
            <h3>Opportunity Distribution</h3>
            {opportunitiesState.status === "loading" && <p>Loading...</p>}
            {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
            {opportunitiesState.status === "error" && <p>Could not load distribution.</p>}
            {opportunitiesState.status === "ok" && (
              <div className="donut-layout">
                <DonutChart tiers={tiers} />
                <ul className="donut-legend" aria-label="confidence tier legend">
                  {tiers.map((tier) => (
                    <li key={tier.label}>
                      <span className="donut-legend-swatch" style={{ background: `var(${tier.colorVar})` }} />
                      <span className="donut-legend-label">{tier.label}</span>
                      <span className="donut-legend-count">
                        {tier.count} ({tiersTotal > 0 ? Math.round((tier.count / tiersTotal) * 100) : 0}%)
                      </span>
                      <span className="donut-legend-callout">· {tier.callout}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="overview-card overview-card-basis">
            <h3>Basis distribution</h3>
            <p className="overview-card-subhead">n={basisSummary.total} opportunities</p>
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
