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
  test: (o: Opportunity, daysOpen: number | undefined) => boolean;
  // Only the original four (real fields already on every row) feed the hero
  // total -- measured/curated are derived (see effectiveBasis) and must not
  // change the hero number this hotfix was told not to touch.
  countsTowardHero: boolean;
}

// Mirrors the approved mockup's six signal cards -- each reads a real field,
// no fabricated categories.
const SIGNALS: SignalDef[] = [
  { name: "Reposted roles", field: 'reasons include "reposted role"', countsTowardHero: true, test: (o) => o.reasons.some((r) => r.includes("reposted")) },
  { name: "Long-open (≥54d)", field: "days_open ≥ 54", countsTowardHero: true, test: (_o, d) => d !== undefined && d >= 54 },
  { name: "Very stale (≥365d)", field: "days_open ≥ 365", countsTowardHero: true, test: (_o, d) => d !== undefined && d >= 365 },
  { name: "No salary range", field: 'reasons include "no salary range"', countsTowardHero: true, test: (o) => o.reasons.some((r) => r.includes("no salary range")) },
  { name: "Measured role-scarcity", field: "basis = measured", countsTowardHero: false, test: () => false },
  { name: "Curated role-scarcity", field: "basis = curated", countsTowardHero: false, test: () => false },
];

const FAMILY_PALETTE = ["var(--accent)", "var(--accent-2)", "#c02c86", "#c67c12", "#556072"];

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

  return (
    <section aria-label="signals">
      <h2>Signals</h2>

      <div className="signals-hero">
        <div>
          <div className="signals-hero-label">Total signals detected</div>
          <div className="signals-hero-value">{totalInstances}</div>
          <div className="signals-hero-sub">signal instances across {n} loaded opportunities</div>
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

      <h3>Signal breakdown</h3>
      <div className="signals-grid">
        {signalCounts.map((sig) => (
          <div className="signal-card" key={sig.name}>
            <div className="signal-card-name">{sig.name}</div>
            <div className="signal-card-field">{sig.field}</div>
            <div className="signal-card-count">{sig.count}</div>
            <div className="signal-card-pct">{n > 0 ? Math.round((sig.count / n) * 100) : 0}% of opps</div>
            <div className="signal-card-history">needs 4+ weeks of ingestion for a trend</div>
          </div>
        ))}
      </div>

      <div className="signals-columns">
        <div className="signals-panel">
          <h3>Role-family distribution</h3>
          <p className="signals-panel-caption">Share of loaded opportunities by role_family · n={n}</p>
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

      <div className="signals-honest-limits">
        <h3>Read these numbers with the dataset in mind</h3>
        <p>
          Current dataset: {n} opportunities from {distinctCompanies} compan{distinctCompanies === 1 ? "y" : "ies"}.
          Percentage metrics are directionally useful but limited by company-universe size — they will scale
          meaningfully past 10+ companies. This view aggregates whatever is currently loaded, so every
          percentage is only as coarse or precise as the loaded set.
        </p>
      </div>
    </section>
  );
}
