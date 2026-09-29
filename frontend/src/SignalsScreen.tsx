import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";
import {
  type BasisOpportunity,
  effectiveFamily,
  extractDaysOpen,
  computeMeasuredEligibleFamilies,
  effectiveBasis as sharedEffectiveBasis,
  computeSourceHealth,
} from "./lib/basisDerivation";

interface Opportunity extends BasisOpportunity {
  company: string;
}

// Bug fix (S-26 signals hotfix): production's opportunities table is 100%
// still hard-to-fill-026-v1 -- S-23's rescore/backfill (which stamps
// family_key and roleScarcity's basis) was never run against it (verified
// directly against the live API: every one of the 1049 rows has
// familyKey: null and no basis key at all). Rather than show a dashboard
// that's honestly-but-uselessly all-zero, this ports the exact same pure,
// already-Ali-approved classification/scarcity logic backend/src/scoring/
// hardToFillScore.ts and familyScarcity.ts already use (decision 046), and
// runs it client-side against the real title/source/daysOpen fields the
// API already returns. This logic now lives in frontend/src/lib/
// basisDerivation.ts (06_decisions/049) so OverviewScreen.tsx can reuse it.

type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: Opportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

interface SignalDef {
  name: string;
  field: string;
  // S-25: a fixed, generic one-sentence explanation of what this signal
  // *type* means -- same status as the existing `field` description below
  // (definitional text about the category, not a derived number). Matches
  // the approved mockup's own per-type captions.
  why: string;
  test: (o: Opportunity, daysOpen: number | undefined) => boolean;
  // Only the original four (real fields already on every row) feed the hero
  // total -- measured/curated are derived (see effectiveBasis) and must not
  // change the hero number this hotfix was told not to touch.
  countsTowardHero: boolean;
  color: string;
}

// Mirrors the approved mockup's six signal cards -- each reads a real field,
// no fabricated categories.
const SIGNALS: SignalDef[] = [
  {
    name: "Reposted roles",
    field: 'reasons include "reposted role"',
    why: "Repeated posting can signal difficulty or renewed demand.",
    countsTowardHero: true,
    color: "#7c70ed",
    test: (o) => o.reasons.some((r) => r.includes("reposted")),
  },
  {
    name: "Long-open (≥54d)",
    field: "days_open ≥ 54",
    why: "Long-running requisitions may need a different sourcing strategy.",
    countsTowardHero: true,
    color: "#19a985",
    test: (_o, d) => d !== undefined && d >= 54,
  },
  {
    name: "Very stale (≥365d)",
    field: "days_open ≥ 365",
    why: "Stale records need review before teams spend effort on them.",
    countsTowardHero: true,
    color: "#e6a53b",
    test: (_o, d) => d !== undefined && d >= 365,
  },
  {
    name: "No salary range",
    field: 'reasons include "no salary range"',
    why: "Missing pay context makes candidate alignment harder.",
    countsTowardHero: true,
    color: "#dc6370",
    test: (o) => o.reasons.some((r) => r.includes("no salary range")),
  },
  {
    name: "Measured role-scarcity",
    field: "basis = measured",
    why: "Observed scarcity supports stronger evidence.",
    countsTowardHero: false,
    color: "#43a9b7",
    test: () => false,
  },
  {
    name: "Curated role-scarcity",
    field: "basis = curated",
    why: "Curated evidence is useful but distinct from direct measurement.",
    countsTowardHero: false,
    color: "#9a83db",
    test: () => false,
  },
];

const FAMILY_PALETTE = ["#655be1", "#16a18d", "#d46a9a", "#d08b22", "#667085", "#8869db"];

const SOURCE_HEALTH_WHY: Record<string, string> = {
  healthy: "A healthy feed is usable measured context.",
  fixture: "Fixture rows demonstrate the interface, not live demand.",
  "flagged — excluded": "Flagged and excluded from the median because it's skewed by requisitions open far longer than typical.",
};

const RADIUS = 45;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const INNER_RADIUS = 32;
const INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_RADIUS;

// S-25 hero: two concentric arcs instead of a bare number. Outer arc =
// signal-instance density (totalInstances / (4 * n) -- 4 is the real count
// of hero-eligible signal types, so this reads as "how many of the 4
// possible signals the average opportunity carries"). Inner arc = coverage
// (opportunities with >=1 hero signal / n). Both are real ratios of real
// counts, normalized the way the mockup's own caption describes ("arcs are
// normalized to their respective totals").
function SignalGauge({ densityPct, coveragePct, totalInstances, n }: { densityPct: number; coveragePct: number; totalInstances: number; n: number }) {
  const outerDash = (densityPct / 100) * CIRCUMFERENCE;
  const innerDash = (coveragePct / 100) * INNER_CIRCUMFERENCE;
  return (
    <div className="signals-gauge">
      <svg viewBox="0 0 120 120" className="signals-gauge-svg" role="img" aria-label={`${totalInstances} signal instances across ${n} loaded opportunities`}>
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="11" />
          <circle
            cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--accent)" strokeWidth="11" strokeLinecap="round"
            strokeDasharray={`${outerDash} ${CIRCUMFERENCE - outerDash}`}
          />
          <circle cx="60" cy="60" r={INNER_RADIUS} fill="none" stroke="var(--border)" strokeWidth="7" />
          <circle
            cx="60" cy="60" r={INNER_RADIUS} fill="none" stroke="var(--success)" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${innerDash} ${INNER_CIRCUMFERENCE - innerDash}`}
          />
        </g>
      </svg>
      <div className="signals-gauge-center">
        <strong>{totalInstances}</strong>
        signals · n={n} opps
      </div>
    </div>
  );
}

export function SignalsScreen() {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    // Same endpoint the Opportunities screen already fetches -- no new
    // backend route. All aggregation below happens client-side.
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

  if (state.status === "loading") return <p>Loading signals...</p>;
  if (state.status === "unauthenticated") return <p>Your session has expired. Please log in again.</p>;
  if (state.status === "error") return <p>Could not load signals.</p>;
  if (state.opportunities.length === 0) return <p>No opportunities yet.</p>;

  const opportunities = state.opportunities;
  const n = opportunities.length;
  const daysOpenByOpp = new Map(opportunities.map((o) => [o.id, extractDaysOpen(o)]));

  // Bug 1/2 fix: real per-family Greenhouse median, computed the same way
  // familyScarcity.ts does on the backend (Greenhouse-only, general-other
  // excluded, real daysOpen field) -- from the real data this API already
  // returns, not a stored (currently-unpopulated) column. Extracted into
  // frontend/src/lib/basisDerivation.ts (06_decisions/049) so Overview can
  // reuse the identical derivation.
  const measuredEligibleFamilies = computeMeasuredEligibleFamilies(opportunities);

  const effectiveBasis = (o: Opportunity) => sharedEffectiveBasis(o, measuredEligibleFamilies);

  const heroSignalCount = (sig: SignalDef) =>
    opportunities.filter((o) => sig.test(o, daysOpenByOpp.get(o.id))).length;
  const measuredCount = opportunities.filter((o) => effectiveBasis(o) === "measured").length;
  const curatedCount = opportunities.filter((o) => effectiveBasis(o) === "curated").length;
  const signalCounts = SIGNALS.map((sig) => ({
    ...sig,
    count:
      sig.name === "Measured role-scarcity" ? measuredCount : sig.name === "Curated role-scarcity" ? curatedCount : heroSignalCount(sig),
  }));
  // Hero total intentionally unchanged: sum of only the four signals that
  // were already real fields before this hotfix (per the "do NOT touch the
  // hero KPI" constraint) -- measured/curated are now real too, but adding
  // them would move the hero number, so they're shown in their own tiles
  // without feeding this sum.
  const totalInstances = signalCounts.filter((s) => s.countsTowardHero).reduce((sum, s) => sum + s.count, 0);

  const families = new Map<string, number>();
  for (const o of opportunities) {
    const key = effectiveFamily(o);
    families.set(key, (families.get(key) ?? 0) + 1);
  }
  const familyEntries = [...families.entries()].sort((a, b) => b[1] - a[1]);

  // Verdict: "healthy" for a source that's on decision 046's real, documented
  // measured-eligible allowlist (today just Greenhouse) or that otherwise has
  // at least one measured row; the seed fixture reads "fixture"; everything
  // else (e.g. Lever, per decision 046's Lever-exclusion finding) reads
  // "flagged — excluded". Not hardcoded to a company name -- the allowlist
  // itself is the same one hardToFillConfig.ts declares.
  const sourceHealth = computeSourceHealth(opportunities);

  const distinctCompanies = new Set(opportunities.map((o) => o.company)).size;

  // S-25 gauge inputs: real ratios, see SignalGauge's own comment for the
  // derivation. HERO_SIGNAL_DEFS is the same 4-signal set that already
  // feeds totalInstances above.
  const heroSignalDefs = SIGNALS.filter((s) => s.countsTowardHero);
  const oppsWithAnyHeroSignal = opportunities.filter((o) =>
    heroSignalDefs.some((sig) => sig.test(o, daysOpenByOpp.get(o.id))),
  ).length;
  const coveragePct = n > 0 ? Math.round((oppsWithAnyHeroSignal / n) * 100) : 0;
  const densityPct = n > 0 ? Math.round((totalInstances / (heroSignalDefs.length * n)) * 100) : 0;

  // S-25 role-family "why this matters" -- real, computed: names the
  // dominant family, and (if one source clearly drives it) names that
  // source too, the same way the mockup's own static example reads, but
  // derived from whatever is actually loaded rather than hardcoded.
  const dominantFamily = familyEntries[0];
  let familyWhy = "";
  if (dominantFamily) {
    const [famName, famCount] = dominantFamily;
    const famRows = opportunities.filter((o) => effectiveFamily(o) === famName);
    const sourceCounts = new Map<string, number>();
    for (const o of famRows) sourceCounts.set(o.source, (sourceCounts.get(o.source) ?? 0) + 1);
    const topSource = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    familyWhy =
      topSource && topSource[1] / famRows.length >= 0.6
        ? `${famName} dominates because ${topSource[0]}'s feed is ${famName}-heavy.`
        : `${famName} is the most common role family in the loaded set, at ${Math.round((famCount / n) * 100)}%.`;
    if (families.has("general-other")) {
      familyWhy += " general-other includes leadership and unclassified titles by design.";
    }
  }
  const familyTotal = familyEntries.reduce((sum, [, count]) => sum + count, 0);
  let familyCumulative = 0;

  return (
    <section aria-label="signals">
      <h2>Signals</h2>

      {/* S-25: hero is now a two-arc radial gauge (outer = signal-instance
          density, inner = opportunity coverage) instead of a bare number --
          see SignalGauge's own comment for the real derivation. */}
      <div className="signals-hero signals-hero--gauge">
        <SignalGauge densityPct={densityPct} coveragePct={coveragePct} totalInstances={totalInstances} n={n} />
        <div className="signals-hero-copy">
          <div className="signals-hero-eyebrow">Signal density</div>
          <h3 className="signals-hero-headline">Several reasons can reinforce one opportunity.</h3>
          <p className="signals-hero-explainer">
            Outer arc: {densityPct}% signal-instance density (instances ÷ 4 possible per opportunity). Inner arc:
            {" "}{coveragePct}% of opportunities carry at least one signal. Arcs are normalized to their own totals.
          </p>
          <div className="opportunity-why">
            <b>Why this matters</b>
            Multiple independent cues help explain why a requisition may be difficult to fill; they are evidence to
            review, not a promise.
          </div>
        </div>
        <div
          className="signals-hero-movement"
          title="No week-over-week history in the data yet. Requires new field: weekly_delta."
        >
          <div className="signals-hero-label">Net movement this week</div>
          <div>
            pending — requires new field: <code>weekly_delta</code>
          </div>
        </div>
      </div>

      <h3>Signal mix · one combined view</h3>
      {/* S-25: stacked horizontal bar replaces the old bare 6-tile grid as
          the primary visual -- every segment is a real count / n, widths
          sum to the real per-opportunity signal-instance total (counts can
          exceed n since one row may carry several signals). */}
      <div
        className="signals-stack"
        role="img"
        aria-label={`Signal mix: ${signalCounts.map((s) => `${s.name} ${s.count}`).join(", ")}`}
      >
        {signalCounts.map((sig) => {
          const stackTotal = signalCounts.reduce((sum, s) => sum + s.count, 0);
          const pct = stackTotal > 0 ? (sig.count / stackTotal) * 100 : 0;
          return pct > 0 ? (
            <span
              key={sig.name}
              className="signals-stack-seg"
              style={{ width: `${pct}%`, background: sig.color }}
              title={`${sig.name}: n=${sig.count}`}
            />
          ) : null;
        })}
      </div>

      <div className="signals-grid">
        {signalCounts.map((sig) => (
          <div className="signal-card" key={sig.name}>
            <span className="signal-card-swatch" style={{ background: sig.color }} />
            <div className="signal-card-name">{sig.name}</div>
            <div className="signal-card-count">
              {sig.count} <small>n=</small>
            </div>
            <div className="signal-card-why">Why: {sig.why}</div>
            <div className="signal-card-history">needs 4+ weeks of ingestion for a trend</div>
          </div>
        ))}
      </div>

      <div className="signals-columns">
        <div className="signals-panel">
          <h3>Role-family distribution</h3>
          <p className="signals-panel-caption">Share of loaded opportunities by role_family · n={n}</p>
          <div className="donut-wrap">
            <svg viewBox="0 0 100 100" className="donut-svg-sm" role="img" aria-label="Role-family distribution donut">
              <g transform="rotate(-90 50 50)">
                {familyEntries.map(([family, count], i) => {
                  const donutRadius = 34;
                  const donutCircumference = 2 * Math.PI * donutRadius;
                  const dash = familyTotal > 0 ? (count / familyTotal) * donutCircumference : 0;
                  const offset = -familyCumulative;
                  familyCumulative += dash;
                  return (
                    <circle
                      key={family}
                      cx="50"
                      cy="50"
                      r={donutRadius}
                      fill="none"
                      stroke={FAMILY_PALETTE[i % FAMILY_PALETTE.length]}
                      strokeWidth="13"
                      strokeDasharray={`${dash} ${donutCircumference - dash}`}
                      strokeDashoffset={offset}
                    />
                  );
                })}
              </g>
              <text x="50" y="53" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)">
                n={n}
              </text>
            </svg>
            <ul className="signals-family-legend">
              {familyEntries.map(([family, count], i) => (
                <li key={family}>
                  <span
                    className="signals-family-swatch"
                    style={{ background: FAMILY_PALETTE[i % FAMILY_PALETTE.length] }}
                  />
                  <span>{family}</span>
                  <span className="signals-family-pct">{Math.round((count / n) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
          {familyWhy && (
            <div className="opportunity-why">
              <b>Why this matters</b>
              {familyWhy}
            </div>
          )}
        </div>

        <div className="signals-panel">
          <h3>Source health</h3>
          <p className="signals-panel-caption">Median days_open per source · live n={n}</p>
          {sourceHealth.map((s) => (
            <div className="signal-source-row" key={s.source}>
              <div>
                <div className="signal-source-name">{s.source}</div>
                <div className="signal-source-detail">
                  {s.count} opp{s.count === 1 ? "" : "s"} · median {s.medianDaysOpen}d
                </div>
                <div className="signal-source-why">Why: {SOURCE_HEALTH_WHY[s.verdict]}</div>
              </div>
              <span
                className={`signal-source-verdict signal-source-verdict--${
                  s.verdict === "healthy" ? "healthy" : s.verdict === "fixture" ? "fixture" : "excluded"
                }`}
              >
                {s.verdict}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* S-25: honesty banner restyled with a more visible indigo left
          border per the mockup's .banner treatment (was a plain <h3>/<p>
          block, same text). */}
      <div className="signals-banner">
        <h3>Read these numbers with the dataset in mind</h3>
        <p>
          Current dataset: {n} opportunities from {distinctCompanies} compan{distinctCompanies === 1 ? "y" : "ies"}.
          Percentage metrics are directionally useful but limited by company-universe size — they will scale
          meaningfully past 10+ companies. This view aggregates whatever is currently loaded, so every
          percentage is only as coarse or precise as the loaded set. Counts overlap: one opportunity may carry
          several signals.
        </p>
      </div>
    </section>
  );
}
