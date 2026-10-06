import { useEffect, useState } from "react";
import { Play, Clock, Radar, Briefcase, type LucideIcon } from "lucide-react";
import { getStoredRole, getStoredToken } from "./auth";
import { ForecastChart, type ForecastResult } from "./ForecastChart";
import { AnomalyReviewList, type AnomalyPoint } from "./AnomalyReviewList";

interface MonthCount {
  month: string;
  count: number;
}

interface TimeToHireMonth {
  month: string;
  averageDays: number;
  sampleSize: number;
}

interface TopClient {
  clientId: string;
  clientName: string;
  count: number;
}

interface AnalyticsResponse {
  placementsPerMonth: MonthCount[];
  timeToHire: { averageDays: number | null; sampleSize: number };
  demandScore: { average: number | null; sampleSize: number };
  // S-25: additive fields (existing three unchanged) backing the redesigned
  // combo chart and the new client contribution panel.
  timeToHirePerMonth: TimeToHireMonth[];
  topClientsByPlacements: TopClient[];
}

type DashboardState =
  | { status: "loading" }
  | { status: "ok"; data: AnalyticsResponse }
  | { status: "unauthenticated" }
  | { status: "error" };

// A separate state machine from DashboardState above, deliberately: the
// forecast (S-13) is a second, independent POST call, not part of the
// GET /api/analytics response. Keeping its loading/error states separate
// means a slow or failed forecast never blocks the three KPIs above it from
// rendering — the two sections fail independently.
type ForecastState =
  | { status: "loading" }
  | { status: "ok"; data: ForecastResult }
  | { status: "unauthenticated" }
  | { status: "error" };

type AnomaliesResult =
  | { status: "insufficient-history"; monthsAvailable: number; monthsRequired: number }
  | {
      status: "ok";
      metric: string;
      residualStd: number;
      threshold: { kStdDev: number; updatedAt: string | null };
      points: AnomalyPoint[];
    };

interface SegmentGroup {
  segment: "low" | "medium" | "high";
  clients: { id: string; name: string; openRoles: number }[];
}

interface AnomaliesResponse {
  anomalies: AnomaliesResult;
  segments: { dimension: string; groups: SegmentGroup[] };
}

// S-17's own third state machine, same independent-failure reasoning as
// ForecastState above: a third, independent GET call, so a slow or failed
// anomalies/segmentation fetch never blocks the KPIs or the forecast chart
// that already render above it.
type AnomaliesState =
  | { status: "loading" }
  | { status: "ok"; data: AnomaliesResponse }
  | { status: "unauthenticated" }
  | { status: "error" };

// Reuses ForecastChart.tsx completely unmodified (06_decisions/025) — the
// only new code is this field-mapping: an AnomalyPoint's baseline/isAnomaly
// become a HistoricalPoint's fitted/isOutlier, and there is no forward
// projection here (S-17 has no "next month" forecast), so forecast is
// always empty.
function toForecastChartData(anomalies: AnomaliesResult): ForecastResult {
  if (anomalies.status === "insufficient-history") {
    return {
      status: "insufficient-history",
      monthsAvailable: anomalies.monthsAvailable,
      monthsRequired: anomalies.monthsRequired,
    };
  }
  return {
    status: "ok",
    historical: anomalies.points.map((point) => ({
      month: point.month,
      count: point.count,
      fitted: point.baseline,
      residual: point.residual,
      isOutlier: point.isAnomaly,
    })),
    forecast: [],
  };
}

function DeltaArrow({ current, prior }: { current: number; prior: number | undefined }) {
  if (prior === undefined) return <span className="small">no prior month to compare</span>;
  const delta = current - prior;
  if (delta === 0) return <span className="analytics-delta analytics-delta--flat">flat vs prior month</span>;
  const up = delta > 0;
  return (
    <span className={`analytics-delta analytics-delta--${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)} vs prior month
    </span>
  );
}

// Small real sparkline-style histogram behind the time-to-hire number, from
// the real per-month averages the backend now returns (S-25) — not a
// decorative placeholder.
function TimeToHireHistogram({ months }: { months: TimeToHireMonth[] }) {
  if (months.length === 0) return null;
  const max = Math.max(...months.map((m) => m.averageDays));
  return (
    <div className="analytics-histogram" role="img" aria-label="average time-to-hire per month">
      {months.map((m) => (
        <span
          key={m.month}
          className="analytics-histogram-bar"
          style={{ height: `${max > 0 ? (m.averageDays / max) * 100 : 0}%` }}
          title={`${m.month}: ${m.averageDays}d avg (n=${m.sampleSize})`}
        />
      ))}
    </div>
  );
}

// Radial gauge for demand score — same single-arc SVG pattern established
// on Overview/Signals, reused here instead of a bare "66%".
function DemandGauge({ percent }: { percent: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const dash = (percent / 100) * circumference;
  return (
    <svg viewBox="0 0 72 72" className="analytics-gauge" role="img" aria-label={`Demand score ${percent}%`}>
      <circle cx="36" cy="36" r={radius} fill="none" stroke="var(--border)" strokeWidth="8" />
      <circle
        cx="36" cy="36" r={radius} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="41" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text)">
        {percent}%
      </text>
    </svg>
  );
}

// Redesign per talentsignal-redesign.html: same .kpi-tile/.kpi-grid visual
// language already established on Overview/Targeting (icon badge, big
// value, "why it matters" caption) -- this screen used a plainer, visually
// inconsistent tile before. children still lets each tile supply its own
// real visual (delta arrow, histogram, gauge) below the headline value.
function KpiTile({
  icon: Icon,
  accentVar,
  label,
  why,
  children,
  caption,
}: {
  icon: LucideIcon;
  accentVar: "--accent" | "--accent-2" | "--success" | "--warning";
  label: string;
  why: string;
  children: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="kpi-tile" role="group" aria-label={label}>
      <div className="kpi-tile-icon" style={{ background: `var(${accentVar})` }}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className="analytics-kpi-body">{children}</div>
      <span className="kpi-tile-label">{label}</span>
      {caption && <p className="kpi-tile-caption">{caption}</p>}
      <p className="kpi-tile-why">{why}</p>
    </div>
  );
}

const CHART_WIDTH = 420;
const CHART_HEIGHT_PX = 140;

// Combo chart: bars = real placements per month, line = real average
// time-to-hire per month (S-25's new timeToHirePerMonth field). Both series
// share the same month axis but different value scales (count vs. days),
// each normalized independently to the chart height — a standard combo-
// chart convention, not a claim that the two scales are the same unit.
function PlacementsComboChart({
  placements,
  timeToHire,
}: {
  placements: MonthCount[];
  timeToHire: TimeToHireMonth[];
}) {
  if (placements.length === 0) return <p>No placements yet.</p>;

  const maxCount = Math.max(...placements.map((p) => p.count), 1);
  const timeToHireByMonth = new Map(timeToHire.map((t) => [t.month, t.averageDays]));
  const maxDays = Math.max(...timeToHire.map((t) => t.averageDays), 1);

  const barWidth = 28;
  const step = CHART_WIDTH / placements.length;
  const linePoints = placements
    .map((p, i) => {
      const days = timeToHireByMonth.get(p.month);
      if (days === undefined) return null;
      const x = i * step + step / 2;
      const y = CHART_HEIGHT_PX - (days / maxDays) * CHART_HEIGHT_PX;
      return { x, y, days, month: p.month };
    })
    .filter((p): p is { x: number; y: number; days: number; month: string } => p !== null);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT_PX + 24}`}
      role="img"
      aria-label="placements per month with average time-to-hire"
      className="analytics-combo-chart"
    >
      <line x1="0" y1={CHART_HEIGHT_PX} x2={CHART_WIDTH} y2={CHART_HEIGHT_PX} stroke="var(--border)" />
      {placements.map((p, i) => {
        const barHeight = (p.count / maxCount) * CHART_HEIGHT_PX;
        const x = i * step + step / 2 - barWidth / 2;
        const y = CHART_HEIGHT_PX - barHeight;
        return (
          <g key={p.month}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill="var(--accent-soft)" stroke="var(--accent)">
              <title>{`${p.month}: ${p.count} placement${p.count === 1 ? "" : "s"}`}</title>
            </rect>
            <text x={x + barWidth / 2} y={CHART_HEIGHT_PX + 16} textAnchor="middle" fontSize="10" fill="var(--mute)">
              {p.month}
            </text>
          </g>
        );
      })}
      {linePoints.length > 1 && (
        <polyline
          fill="none"
          stroke="var(--success)"
          strokeWidth="2"
          points={linePoints.map((pt) => `${pt.x},${pt.y}`).join(" ")}
        />
      )}
      {linePoints.map((pt) => (
        <circle key={pt.month} cx={pt.x} cy={pt.y} r="3.5" fill="var(--success)">
          <title>{`${pt.month}: ${pt.days}d avg time-to-hire`}</title>
        </circle>
      ))}
    </svg>
  );
}

// NEW: horizontal bar chart, top 10 real clients by placement count
// (S-25's new topClientsByPlacements field) — no invented dollar values,
// per decision 048's precedent that no bill_rate/pay_rate field exists
// anywhere in this app.
function ClientContributionPanel({ clients }: { clients: TopClient[] }) {
  if (clients.length === 0) return <p className="caption">No placements recorded yet to rank clients by.</p>;
  const max = Math.max(...clients.map((c) => c.count));
  return (
    <div className="analytics-client-bars">
      {clients.map((c) => (
        <div className="dist" key={c.clientId}>
          <span>{c.clientName}</span>
          <span className="barline">
            <i style={{ width: `${(c.count / max) * 100}%` }} />
          </span>
          <b>{c.count}</b>
        </div>
      ))}
    </div>
  );
}

// Top three numbers, correct, plus the pipeline-activity tile the S-25
// redesign explicitly asked to add on top of that (see 06_decisions/051 —
// this supersedes decision 020's "no fourth KPI yet" note by later, more
// specific instruction; see that entry for the honest definition "Active
// pipeline value" uses since no bill_rate/pay_rate field exists anywhere in
// this app). Computed fresh from real data on every load; see
// 06_decisions/020 for why there's no Analytics snapshot table.
export function AnalyticsDashboard() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [forecastState, setForecastState] = useState<ForecastState>({ status: "loading" });
  const [anomaliesState, setAnomaliesState] = useState<AnomaliesState>({ status: "loading" });
  const [packageCounts, setPackageCounts] = useState<{ total: number; draft: number } | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/analytics", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`analytics fetch failed: ${res.status}`);
        return res.json() as Promise<AnalyticsResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data });
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

    if (!token) {
      setForecastState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/predictive-analysis/forecast", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`forecast fetch failed: ${res.status}`);
        return res.json() as Promise<ForecastResult>;
      })
      .then((data) => {
        if (!cancelled) setForecastState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setForecastState(
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

    if (!token) {
      setAnomaliesState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/analytics/anomalies", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`anomalies fetch failed: ${res.status}`);
        return res.json() as Promise<AnomaliesResponse>;
      })
      .then((data) => {
        if (!cancelled) setAnomaliesState({ status: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setAnomaliesState(
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
    // Best-effort only (same convention as every other screen's secondary
    // KPI fetch) — backs the "Active pipeline value" tile's real count of
    // draft (in-flight, not-yet-released) packages.
    const token = getStoredToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/opportunity-packages", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ packages: { status: string }[] }>) : null))
      .then((body) => {
        if (!cancelled && body) {
          setPackageCounts({
            total: body.packages.length,
            draft: body.packages.filter((p) => p.status === "draft").length,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Applies a just-decided point's new isAnomaly/decision back into local
  // state without a second round-trip to the server — POST /decide's own
  // response already carries the freshly-reclassified point
  // (revenueAnomalies.ts recomputes it against the post-decision threshold
  // before responding). Immutable update: a new points array with one
  // element replaced, a new anomalies object, a new top-level state object —
  // React only re-renders when it sees a new object reference, not a
  // mutated old one.
  function handleAnomalyDecided(updatedPoint: AnomalyPoint) {
    setAnomaliesState((prev) => {
      if (prev.status !== "ok" || prev.data.anomalies.status !== "ok") return prev;
      return {
        status: "ok",
        data: {
          ...prev.data,
          anomalies: {
            ...prev.data.anomalies,
            points: prev.data.anomalies.points.map((point) =>
              point.month === updatedPoint.month ? updatedPoint : point,
            ),
          },
        },
      };
    });
  }

  if (state.status === "loading") return <p>Loading analytics...</p>;
  if (state.status === "unauthenticated") return <p>Your session has expired. Please log in again.</p>;
  if (state.status === "error") return <p>Could not load analytics.</p>;

  const { placementsPerMonth, timeToHire, demandScore, timeToHirePerMonth, topClientsByPlacements } = state.data;
  const lastMonth = placementsPerMonth.at(-1);
  const priorMonth = placementsPerMonth.at(-2);

  return (
    <section aria-label="analytics dashboard">
      <h2>Agency Analytics</h2>

      <div className="kpi-grid">
        <KpiTile
          icon={Play}
          accentVar="--accent"
          label="Placements this month"
          why="the clearest signal of whether outreach is converting right now"
          caption={`n=${placementsPerMonth.length} months loaded`}
        >
          <span className="kpi-tile-value mono">{lastMonth?.count ?? 0}</span>
          <DeltaArrow current={lastMonth?.count ?? 0} prior={priorMonth?.count} />
        </KpiTile>

        <KpiTile
          icon={Clock}
          accentVar="--accent-2"
          label="Avg. time-to-hire"
          why="sets realistic client expectations for how long a fill takes"
          caption={timeToHire.sampleSize > 0 ? `n=${timeToHire.sampleSize} placements` : "no closed placements yet"}
        >
          <div className="analytics-kpi-with-histogram">
            <span className="kpi-tile-value mono">{timeToHire.averageDays ?? "—"}</span>
            <TimeToHireHistogram months={timeToHirePerMonth} />
          </div>
        </KpiTile>

        <KpiTile
          icon={Radar}
          accentVar="--success"
          label="Demand score"
          why="average opportunity confidence across the currently loaded data"
          caption={demandScore.sampleSize > 0 ? `n=${demandScore.sampleSize} opportunities` : "no opportunities scored yet"}
        >
          <DemandGauge percent={demandScore.average === null ? 0 : Math.round(demandScore.average * 100)} />
        </KpiTile>

        <KpiTile
          icon={Briefcase}
          accentVar="--warning"
          label="Active pipeline value"
          why="count of in-flight drafts, not a dollar figure — no bill/pay rate field exists"
          caption={packageCounts ? `n=${packageCounts.total} packages total` : "n=packages not yet loaded"}
        >
          <span className="kpi-tile-value mono">{packageCounts?.draft ?? "—"}</span>
        </KpiTile>
      </div>

      <div className="analytics-grid-2">
        <div aria-label="placements per month" className="overview-card">
          <h3>Placements and time-to-hire</h3>
          <p className="small">Bars = real monthly placements · line = real average time-to-hire per month.</p>
          <PlacementsComboChart placements={placementsPerMonth} timeToHire={timeToHirePerMonth} />
        </div>

      {/*
        S-13: extends the chart above with a forecast line, a shaded
        confidence band, and marked outliers (06_decisions/021). A separate
        fetch/state machine from the three KPIs above — see ForecastState —
        so a slow or failed forecast never blocks them. Kept exactly as-is
        (real OLS linear regression over placements-per-month, per decision
        021) rather than replaced with a decorative funnel: this component
        is also reused unmodified by Revenue Anomalies below it, and its
        statistical rigor is real, tested work worth keeping intact.
      */}
        <div aria-label="demand forecast" className="overview-card">
          <div className="between">
            <h3>Demand forecast</h3>
            <span
              className="small"
              title="Ordinary least-squares linear regression over real monthly placements (month index vs. count), extended forward for the forecast horizon. See 06_decisions/021."
            >
              How we forecast ⓘ
            </span>
          </div>
          {forecastState.status === "loading" && <p>Loading forecast...</p>}
          {forecastState.status === "unauthenticated" && (
            <p>Your session has expired. Please log in again.</p>
          )}
          {forecastState.status === "error" && <p>Could not load forecast.</p>}
          {forecastState.status === "ok" && <ForecastChart data={forecastState.data} />}
        </div>
      </div>

      <div className="analytics-grid-2">
        <div aria-label="client contribution" className="overview-card">
          <h3>Client contribution · top 10 by placements</h3>
          <ClientContributionPanel clients={topClientsByPlacements} />
          <p className="caption">Ranked by the same event-based placement count as the KPI above (decision 020).</p>
        </div>

        <div aria-label="client segments" className="overview-card">
          <h3>Clients by hiring volume (advisory only)</h3>
          {anomaliesState.status === "loading" && <p>Loading segments...</p>}
          {anomaliesState.status === "unauthenticated" && (
            <p>Your session has expired. Please log in again.</p>
          )}
          {anomaliesState.status === "error" && <p>Could not load segments.</p>}
          {anomaliesState.status === "ok" &&
            (anomaliesState.data.segments.groups.length === 0 ? (
              <p>No clients to segment yet.</p>
            ) : (
              anomaliesState.data.segments.groups.map((group) => (
                <div key={group.segment}>
                  <h4>{group.segment}</h4>
                  <ul aria-label={`${group.segment} segment clients`}>
                    {group.clients.map((client) => (
                      <li key={client.id}>
                        {client.name} — {client.openRoles} open role{client.openRoles === 1 ? "" : "s"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ))}
        </div>
      </div>

      {/*
        S-17: revenue anomaly detection + client segmentation
        (06_decisions/025). Third independent fetch/state machine — see
        AnomaliesState — so this never blocks the KPIs or forecast above it.
        The chart reuses ForecastChart.tsx completely unmodified via
        toForecastChartData()'s field mapping; AnomalyReviewList is the one
        genuinely new piece of UI this story adds. canDecide mirrors the
        backend's DECIDE_ROLES split (admin/sales) — UX only, same as every
        other RoleGate in this app; the real boundary is requireRole on the
        server.
      */}
      <div aria-label="revenue anomalies" className="overview-card">
        <h3>Revenue anomalies (placements per month, as a proxy)</h3>
        {anomaliesState.status === "loading" && <p>Loading anomalies...</p>}
        {anomaliesState.status === "unauthenticated" && (
          <p>Your session has expired. Please log in again.</p>
        )}
        {anomaliesState.status === "error" && <p>Could not load anomalies.</p>}
        {anomaliesState.status === "ok" && (
          <>
            <ForecastChart data={toForecastChartData(anomaliesState.data.anomalies)} />
            {anomaliesState.data.anomalies.status === "ok" && (
              <AnomalyReviewList
                points={anomaliesState.data.anomalies.points}
                canDecide={["admin", "sales"].includes(getStoredRole() ?? "")}
                onDecided={handleAnomalyDecided}
              />
            )}
          </>
        )}
      </div>

      {/* S-25 honesty banner — same visible-indigo-border treatment as
          Signals' banner, explicit that placements are seeded demo rows. */}
      <div className="signals-banner">
        <h3>Read this with the dataset in mind</h3>
        <p>
          Placements are seeded demo rows from `sales_pipeline_audit`, not real placements yet
          — every count and chart above is real arithmetic over that seeded data, not a
          fabricated number, but the underlying events themselves are demo data. Time-to-hire
          and demand score are equally real computations that will only become meaningful
          business signals once real pipeline activity and live ingestion history accumulate.
        </p>
      </div>
    </section>
  );
}
