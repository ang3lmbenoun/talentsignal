import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";
import {
  type BasisOpportunity,
  effectiveFamily,
  extractDaysOpen,
  computeSourceHealth,
} from "./lib/basisDerivation";
import { summarizeStoredBasis, BASIS_AS_STORED_TOOLTIP } from "./lib/storedBasis";
import { ShowTheMath } from "./components/ShowTheMath";

interface Opportunity extends BasisOpportunity {
  company: string;
  // null/absent until the repost-detection diff has run for this row.
  diffComputedAt?: string | null;
}

// Share of a role type's postings one source must supply before the "Why this
// matters" sentence names that source. Unchanged value (was an inline 0.6).
const DOMINANT_SOURCE_SHARE = 0.6;

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
    why: "Stale records need review before teams spend effort on them. These are also counted in “Open 54 days or more”.",
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
];

const FAMILY_LABELS: Record<string, string> = {
  "engineering-swe": "Software engineering", "ml-ai": "AI & machine learning",
  "data-analytics": "Data & analytics", security: "Security", "cloud-infra": "Cloud & infrastructure",
  "support-cs": "Support & customer success", "sales-bizdev": "Sales & business development",
  "retail-ops": "Retail & operations", "general-other": "Other roles",
};

const NEXT_STEPS: Record<string, string> = {
  "Reposted roles": "Check whether the client still needs this role and what changed since the earlier posting.",
  "Long-open (≥54d)": "Review the role requirements and sourcing approach with the client.",
  "Very stale (≥365d)": "Confirm the requisition is still active before spending sourcing time.",
  "No salary range": "Ask the client for compensation context before presenting candidates.",
};

const FAMILY_PALETTE = ["#655be1", "#16a18d", "#d46a9a", "#d08b22", "#667085", "#8869db"];

const SOURCE_HEALTH_WHY: Record<string, string> = {
  healthy: "Dates from this source can be used when comparing how long similar roles stay open.",
  fixture: "Demo records show how the screen works; they are not live hiring demand.",
  "flagged — excluded": "Dates from this source are left out of scarcity comparisons until their meaning is verified.",
};

export function SignalsScreen({ onNavigate }: { onNavigate?: (view: string) => void }) {
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

  // Basis counts show the value STORED on each posting (06_decisions/051,
  // PROPOSED) -- the same value the Opportunities cards show -- not a
  // browser-side re-derivation.
  const storedBasisSummary = summarizeStoredBasis(opportunities);

  // Repost detection compares polls; until that comparison has run for any
  // row, a 0 below would mean "unknown", not "none".
  const repostsKnown = opportunities.some((o) => o.diffComputedAt != null);

  const heroSignalCount = (sig: SignalDef) =>
    opportunities.filter((o) => sig.test(o, daysOpenByOpp.get(o.id))).length;
  const measuredCount = storedBasisSummary.measured;
  const curatedCount = storedBasisSummary.curated;
  const noBasisCount = storedBasisSummary.none;
  const signalCounts = SIGNALS.map((sig) => ({ ...sig, count: heroSignalCount(sig) }));
  const totalInstances = signalCounts.reduce((sum, s) => sum + s.count, 0);

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

  const companyNames = [...new Set(opportunities.map((o) => o.company))];
  const distinctCompanies = companyNames.length;
  const companyList =
    companyNames.length <= 4
      ? companyNames.join(", ")
      : `${companyNames.slice(0, 4).join(", ")} and ${companyNames.length - 4} more`;

  const heroSignalDefs = SIGNALS;
  const oppsWithAnyHeroSignal = opportunities.filter((o) =>
    heroSignalDefs.some((sig) => sig.test(o, daysOpenByOpp.get(o.id))),
  ).length;
  const coveragePct = n > 0 ? Math.round((oppsWithAnyHeroSignal / n) * 100) : 0;

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
      topSource && topSource[1] / famRows.length >= DOMINANT_SOURCE_SHARE
        ? `${FAMILY_LABELS[famName] ?? famName} appears most often because ${topSource[0]}'s feed contains many roles of this type.`
        : `${FAMILY_LABELS[famName] ?? famName} is the most common type in the loaded set (${Math.round((famCount / n) * 100)}%).`;
    if (families.has("general-other")) {
          familyWhy += " Other roles includes job titles that do not fit the named role types.";
    }
  }
  return (
    <section aria-label="signals">
      <h2>Signals</h2>
      <p className="screen-description">Signals are practical clues in job postings that can help your team decide which roles deserve a closer look. One role can show more than one clue, so counts overlap.</p>

      <div className="signals-overview">
        <div className="signals-overview-card">
          <span className="signals-overview-label">Roles with at least one hiring clue</span>
          <strong>{oppsWithAnyHeroSignal.toLocaleString()} <small>of {n.toLocaleString()} loaded postings</small></strong>
          <div className="signals-overview-track"><i style={{ width: `${coveragePct}%` }} /></div>
          <p>These roles show at least one pattern below. This is a review queue, not a prediction that a role will be filled.{coveragePct >= 95 ? " Almost every loaded posting has at least one clue, so this figure does not tell postings apart." : ""}</p>
        </div>
        <div className="signals-overview-card signals-overview-card--accent">
          <span className="signals-overview-label">Clues found</span>
          <strong>{totalInstances.toLocaleString()} <small>across {n.toLocaleString()} postings</small></strong>
          <p>A posting can have several clues, and each is counted separately, so this can be higher than the number of postings. No week-to-week trend is shown because there is not enough history yet.</p>
          <button type="button" className="btn" onClick={() => onNavigate?.("opportunities")}>Review opportunities →</button>
        </div>
      </div>
      {sourceHealth.some((source) => source.verdict === "flagged — excluded") && (
        <div className="opportunity-source-caution" role="note">
          <b>Some posting dates are not verified</b>
          Long-open and stale counts below include all loaded sources. Lever’s unusually old dates are excluded from measured role-scarcity comparisons, but still appear in these age-pattern counts. Treat them as prompts to verify active status.
        </div>
      )}

      <div className="signals-section-heading">
        <div><h3>What the signals are telling you</h3><p>Each bar shows how many of the {n.toLocaleString()} postings currently loaded match that clue. A posting can appear in more than one bar.</p></div>
      </div>
      {/* S-25: stacked horizontal bar replaces the old bare 6-tile grid as
          the primary visual -- every segment is a real count / n, widths
          sum to the real per-opportunity signal-instance total (counts can
          exceed n since one row may carry several signals). */}
      <div className="signals-grid signals-grid--plain">
        {signalCounts.map((sig) => (
          <div className="signal-card" key={sig.name}>
            <span className="signal-card-swatch" style={{ background: sig.color }} />
            <div className="signal-card-name">{sig.name === "Long-open (≥54d)" ? "Open 54 days or more" : sig.name === "Very stale (≥365d)" ? "Open at least one year" : sig.name}</div>
            {sig.name === "Reposted roles" && !repostsKnown ? (
              <div className="signal-card-count"><small>Not enough history yet</small></div>
            ) : (
              <div className="signal-card-count">{sig.count.toLocaleString()} <small>of {n.toLocaleString()} postings · {Math.round((sig.count / n) * 100)}%</small></div>
            )}
            <div className="signals-bar-track"><i style={{ width: `${Math.min(100, (sig.count / n) * 100)}%`, background: sig.color }} /></div>
            <div className="signal-card-why">{sig.why}</div>
            <div className="signal-card-next"><b>Useful next step</b>{NEXT_STEPS[sig.name]}</div>
          </div>
        ))}
      </div>

      <div className="signals-basis-panel">
        <div className="signals-section-heading">
          <div>
            <h3>
              How much to trust the role-scarcity evidence{" "}
              <span className="small" title={BASIS_AS_STORED_TOOLTIP} tabIndex={0} aria-label={BASIS_AS_STORED_TOOLTIP}>Basis as stored ⓘ</span>
            </h3>
            <p>These labels describe the evidence behind role scarcity; they are not additional hiring signals.</p>
          </div>
        </div>
        <div className="signals-basis-grid">
          <div><b>Measured evidence</b><strong>{measuredCount.toLocaleString()}</strong><span>Postings with eligible live data to compare role-family posting duration.</span></div>
          <div><b>Reviewed role guidance</b><strong>{curatedCount.toLocaleString()}</strong><span>Titles on a reviewed role list; this is guidance, not a measured scarcity rate.</span></div>
          <div><b>No role-difficulty evidence</b><strong>{noBasisCount.toLocaleString()}</strong><span>No evidence to estimate role scarcity yet. Other hiring clues may still be present.</span></div>
        </div>
      </div>

      <ShowTheMath>
        <p><b>Clues found</b> adds up four overlapping counts. “Open at least one year” postings are also counted in “Open 54 days or more”, so the total is not a count of postings.</p>
        <p><b>Cut-offs</b>: “Open 54 days or more” and “Open at least one year” use the app's current settings in this screen's clue definitions (54 and 365 days).</p>
        <p><b>Basis counts</b> are the role-scarcity basis stored on each posting at its last scoring run, the same value shown on every Opportunities card.</p>
        <p><b>Role types</b> name a source in “Why this matters” only when that source supplies at least {Math.round(DOMINANT_SOURCE_SHARE * 100)}% of that type.</p>
      </ShowTheMath>

      <div className="signals-columns">
        <div className="signals-panel">
          <h3>Which kinds of roles are in the feed?</h3>
          <p className="signals-panel-caption">Each bar is a role type’s share of the {n.toLocaleString()} loaded postings. A longer bar means more postings of that type.</p>
          <div className="signals-family-bars" role="list" aria-label="Loaded postings by role type">
            {familyEntries.map(([family, count], i) => (
              <div className="signals-family-bar-row" role="listitem" key={family}>
                <div className="signals-family-bar-label"><span>{FAMILY_LABELS[family] ?? family}</span><b>{count.toLocaleString()} <small>postings · {Math.round((count / n) * 100)}%</small></b></div>
                <div className="signals-family-bar-track" role="img" aria-label={`${FAMILY_LABELS[family] ?? family}: ${count} of ${n} postings, ${Math.round((count / n) * 100)} percent`}><i style={{ width: `${(count / n) * 100}%`, background: FAMILY_PALETTE[i % FAMILY_PALETTE.length] }} /></div>
              </div>
            ))}
          </div>
          {familyWhy && (
            <div className="opportunity-why">
              <b>Why this matters</b>
              {familyWhy}
            </div>
          )}
        </div>

        <div className="signals-panel" data-tour="signals-source-panel">
          <h3>Source health</h3>
          <p className="signals-panel-caption">How many postings come from each source, and whether its dates can support role-difficulty comparisons.</p>
          {sourceHealth.map((s) => (
            <div className="signal-source-row" key={s.source}>
              <div>
            <div className="signal-source-name">{s.source === "greenhouse" ? "Greenhouse" : s.source === "lever" ? "Lever" : s.source}</div>
                <div className="signal-source-detail">
                  {s.count.toLocaleString()} postings · median listed age {s.medianDaysOpen.toLocaleString()} days
                </div>
                <div className="signal-source-why">Why: {SOURCE_HEALTH_WHY[s.verdict]}</div>
              </div>
              <span
                className={`signal-source-verdict signal-source-verdict--${
                  s.verdict === "healthy" ? "healthy" : s.verdict === "fixture" ? "fixture" : "excluded"
                }`}
              >
                {s.verdict === "healthy" ? "Usable for measured evidence" : s.verdict === "fixture" ? "Demo sample" : "Flagged — excluded from scarcity evidence"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* S-25: honesty banner restyled with a more visible indigo left
          border per the mockup's .banner treatment (was a plain <h3>/<p>
          block, same text). */}
      <div className="signals-banner">
        <h3>What this view includes</h3>
        <p>
          This view covers {n.toLocaleString()} job postings across {distinctCompanies.toLocaleString()} {distinctCompanies === 1 ? "company" : "companies"} in postings ({companyList}) in the current load. Signal counts may overlap because one posting can have several clues. The listed actions are prompts for human review, not automated decisions. Trends need at least four weeks of ingestion history.
        </p>
      </div>
    </section>
  );
}
