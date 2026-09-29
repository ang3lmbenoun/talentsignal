import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  type ClientOpportunity,
  clientWhyItMattersExpanded,
  computeClientAggregates,
} from "./lib/clientAggregation";
import { effectiveFamily, extractDaysOpen } from "./lib/basisDerivation";

// Visually matches OpportunitiesList.tsx's card (same CSS classes:
// .opportunity-card, .opportunity-monogram, .opportunity-age-badge, etc.)
// without importing or editing that file, per the redesign's constraint not
// to touch OpportunitiesList.tsx. A smaller, company-scoped subset of its
// fields -- no confidence ring, spread badge, or raw-payload expander,
// since those are Opportunities-screen-specific features, not part of
// "same card layout" for a company drill-in.
const MONOGRAM_PALETTE = ["#5a4be0", "#0d9488", "#c02c86", "#c67c12", "#1f8a54", "#2f6fed"];

function monogramFor(name: string): { initials: string; color: string } {
  const initials = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return { initials, color: MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length] };
}

function RequisitionCard({ opportunity }: { opportunity: ClientOpportunity }) {
  const daysOpen = extractDaysOpen(opportunity);
  const ageColor = daysOpen === undefined ? undefined : daysOpen < 30 ? "green" : daysOpen < 54 ? "amber" : "red";
  const stale = daysOpen !== undefined && daysOpen > 365;
  const family = effectiveFamily(opportunity);
  const basisFactor = opportunity.hardToFillFactors?.find((f) => f.factor === "roleScarcity");
  const basis = basisFactor?.basis && basisFactor.basis !== "n/a" ? basisFactor.basis : "none";
  const monogram = monogramFor(opportunity.title);

  return (
    <li className="opportunity-card">
      <div className={`opportunity-card-rail${ageColor ? ` opportunity-card-rail--${ageColor}` : ""}`} />
      <div className="opportunity-card-body">
        <div className="opportunity-card-header">
          <span className="opportunity-monogram" style={{ background: monogram.color }}>
            {monogram.initials}
          </span>
          <div className="opportunity-card-heading">
            <div className="opportunity-card-title-row">
              <h3>{opportunity.title}</h3>
            </div>
          </div>
        </div>

        <div className="opportunity-card-badges">
          {daysOpen !== undefined && (
            <span className={`opportunity-age-badge opportunity-age-badge--${ageColor}`}>{daysOpen}d</span>
          )}
          <span
            className={`opportunity-basis-dot opportunity-basis-dot--${basis}`}
            title={`score basis: ${basis}`}
          >
            {basis}
          </span>
        </div>

        {stale && <div className="opportunity-stale-callout">verify · likely stale ({daysOpen}d open)</div>}

        <div className="opportunity-card-pills">
          {opportunity.reasons.map((reason) => (
            <span className="opportunity-pill" key={reason}>
              {reason}
            </span>
          ))}
          <span className="opportunity-pill">{family}</span>
        </div>
      </div>
    </li>
  );
}

const ALL_ROLE_FAMILIES = "all-role-families";
const ALL_SIGNAL_TYPES = "all-signal-types";
const SIGNAL_TYPE_OPTIONS: { value: string; label: string; test: (o: ClientOpportunity) => boolean }[] = [
  { value: "long-open", label: "long-open", test: (o) => { const d = extractDaysOpen(o); return d !== undefined && d >= 54; } },
  { value: "reposted", label: "reposted role", test: (o) => o.reasons.some((r) => r.includes("reposted")) },
  { value: "no-salary", label: "no salary", test: (o) => o.reasons.some((r) => r.includes("no salary range")) },
];

export function ClientDetail({
  company,
  opportunities,
  onBack,
}: {
  company: string;
  opportunities: ClientOpportunity[];
  onBack: () => void;
}) {
  const [familyFilter, setFamilyFilter] = useState(ALL_ROLE_FAMILIES);
  const [signalFilter, setSignalFilter] = useState(ALL_SIGNAL_TYPES);

  const allAggregates = useMemo(() => computeClientAggregates(opportunities), [opportunities]);
  const clientRows = useMemo(() => opportunities.filter((o) => o.company === company), [opportunities, company]);
  const aggregate = allAggregates.find((c) => c.company === company);

  const families = useMemo(
    () => [...new Set(clientRows.map((o) => effectiveFamily(o)))].sort(),
    [clientRows],
  );

  const filteredRows = useMemo(() => {
    return clientRows.filter((o) => {
      if (familyFilter !== ALL_ROLE_FAMILIES && effectiveFamily(o) !== familyFilter) return false;
      if (signalFilter !== ALL_SIGNAL_TYPES) {
        const signal = SIGNAL_TYPE_OPTIONS.find((s) => s.value === signalFilter);
        if (signal && !signal.test(o)) return false;
      }
      return true;
    });
  }, [clientRows, familyFilter, signalFilter]);

  if (!aggregate) {
    return (
      <div className="client-detail">
        <button type="button" className="client-back-link" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back to Clients
        </button>
        <p>No requisitions loaded for this company.</p>
      </div>
    );
  }

  const monogram = monogramFor(company);
  const verdictClass =
    aggregate.verdict === "healthy" ? "live" : aggregate.verdict === "fixture" ? "fixture" : "flag";

  return (
    <div className="client-detail">
      <button type="button" className="client-back-link" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> Back to Clients
      </button>

      <div className="client-detail-header">
        <span className="opportunity-monogram client-detail-monogram" style={{ background: monogram.color }}>
          {monogram.initials}
        </span>
        <div>
          <h2>{company}</h2>
          <span className={`source-badge source-badge--${verdictClass}`}>{aggregate.verdict}</span>
        </div>
      </div>

      <p className="client-detail-why">{clientWhyItMattersExpanded(aggregate, allAggregates)}</p>

      <div className="client-detail-kpi-row">
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Total open reqs</div>
          <div className="opportunity-kpi-value">{aggregate.openReqs}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Hard to fill</div>
          <div className="opportunity-kpi-value opportunity-kpi-value--accent">{aggregate.hardToFillCount}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Median days_open</div>
          <div className="opportunity-kpi-value">{aggregate.medianDaysOpen ?? "—"}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Reposted</div>
          <div className="opportunity-kpi-value">{aggregate.repostedCount}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">No-salary</div>
          <div className="opportunity-kpi-value">{aggregate.noSalaryCount}</div>
        </div>
      </div>

      <div className="filterbar">
        <select className="select" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
          <option value={ALL_ROLE_FAMILIES}>All role families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select className="select" value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}>
          <option value={ALL_SIGNAL_TYPES}>All signal types</option>
          {SIGNAL_TYPE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="client-detail-count">
        Showing {filteredRows.length} of {clientRows.length} requisitions for {company}
      </p>

      <ul className="opportunities-grid">
        {filteredRows.map((o) => (
          <RequisitionCard key={o.id} opportunity={o} />
        ))}
      </ul>
    </div>
  );
}
