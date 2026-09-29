import { useEffect, useMemo, useState } from "react";
import { getStoredToken } from "./auth";
import {
  type ClientAggregate,
  type ClientOpportunity,
  clientWhyItMatters,
  computeClientAggregates,
} from "./lib/clientAggregation";
import { median } from "./lib/basisDerivation";
import { ClientDetail } from "./ClientDetail";

// S-25 Clients redesign: this screen now shows opportunity source-companies
// (GitLab, Gopuff, ...) as "client" cards, not the real CRM `clients` table
// (backend/src/routes/clients.ts) that used to render here. See
// frontend/src/lib/clientAggregation.ts's header comment for why, and
// 06_decisions/046/049 for the source-health/basis honesty rules this
// screen surfaces rather than hides.
//
// Same fetch every other screen (Overview, Signals, Opportunities) already
// makes -- no new backend endpoint, one array, every consumer derives
// client-side from the same real rows.
type OpportunitiesState =
  | { status: "loading" }
  | { status: "ok"; opportunities: ClientOpportunity[] }
  | { status: "unauthenticated" }
  | { status: "error" };

function useOpportunities(): OpportunitiesState {
  const [state, setState] = useState<OpportunitiesState>({ status: "loading" });

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
        return res.json() as Promise<{ opportunities: ClientOpportunity[] }>;
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

  return state;
}

function monogramFor(name: string): { initials: string; color: string } {
  const palette = ["#5a4be0", "#0d9488", "#c02c86", "#c67c12", "#1f8a54", "#2f6fed"];
  const initials = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return { initials, color: palette[hash % palette.length] };
}

function ClientCard({
  client,
  allClients,
  onOpen,
}: {
  client: ClientAggregate;
  allClients: ClientAggregate[];
  onOpen: (company: string) => void;
}) {
  const monogram = monogramFor(client.company);
  const verdictClass =
    client.verdict === "healthy" ? "live" : client.verdict === "fixture" ? "fixture" : "flag";

  return (
    <article
      className="card client-card"
      tabIndex={0}
      role="button"
      aria-label={`Open ${client.company}`}
      onClick={() => onOpen(client.company)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(client.company);
      }}
    >
      <div className="client-card-header">
        <span className="opportunity-monogram" style={{ background: monogram.color }}>
          {monogram.initials}
        </span>
        <div>
          <h4>{client.company}</h4>
          <span className={`source-badge source-badge--${verdictClass}`}>{client.verdict}</span>
        </div>
      </div>
      <div className="client-card-pills">
        <span className="opportunity-pill">Open reqs · {client.openReqs}</span>
        <span className="opportunity-pill">Median · {client.medianDaysOpen ?? "—"}d</span>
        <span className="opportunity-pill">Hard-to-fill · {client.hardToFillCount}</span>
      </div>
      <p className="client-card-why">{clientWhyItMatters(client, allClients)}</p>
      {client.verdict === "flagged — excluded" && (
        <p
          className="client-card-flag-note"
          title="Per 06_decisions/046: this source's median days_open is excluded from measured role-scarcity scoring because zombie (long-abandoned) requisitions skew it far above every other source."
        >
          flagged — excluded from median-based scoring
        </p>
      )}
    </article>
  );
}

const SORT_OPEN_REQS_DESC = "open-reqs-desc";
const SORT_MEDIAN_DESC = "median-desc";

export function ClientsScreen() {
  const opportunitiesState = useOpportunities();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [showFixtures, setShowFixtures] = useState(false);
  const [sortBy, setSortBy] = useState(SORT_OPEN_REQS_DESC);

  const opportunities = opportunitiesState.status === "ok" ? opportunitiesState.opportunities : [];
  const allAggregates = useMemo(() => computeClientAggregates(opportunities), [opportunities]);

  const visibleAggregates = useMemo(() => {
    const filtered = showFixtures ? allAggregates : allAggregates.filter((c) => c.verdict !== "fixture");
    return [...filtered].sort((a, b) =>
      sortBy === SORT_MEDIAN_DESC
        ? (b.medianDaysOpen ?? -1) - (a.medianDaysOpen ?? -1)
        : b.openReqs - a.openReqs,
    );
  }, [allAggregates, showFixtures, sortBy]);

  // Mini-KPI strip. "Active clients" is every client this screen can ever
  // show, since a card only exists because at least one real opportunity
  // named that company -- there is no separate "known companies with zero
  // open reqs" list in this data model, so the two numbers are honestly
  // identical today rather than a fabricated distinct metric.
  const totalClients = allAggregates.length;
  const activeClients = allAggregates.filter((c) => c.openReqs > 0).length;
  const liveMedianValues = allAggregates
    .filter((c) => c.verdict === "healthy" && c.medianDaysOpen !== undefined)
    .map((c) => c.medianDaysOpen!);
  const liveMedian = liveMedianValues.length > 0 ? median(liveMedianValues) : undefined;

  if (selectedCompany) {
    return (
      <ClientDetail
        company={selectedCompany}
        opportunities={opportunities}
        onBack={() => setSelectedCompany(null)}
      />
    );
  }

  return (
    <section aria-label="clients">
      <h2>Clients</h2>

      {opportunitiesState.status === "loading" && <p>Loading clients...</p>}
      {opportunitiesState.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {opportunitiesState.status === "error" && <p>Could not load clients.</p>}

      {opportunitiesState.status === "ok" && (
        <>
          <div className="client-kpi-strip">
            <div className="opportunity-kpi-tile">
              <div className="opportunity-kpi-label">Total clients</div>
              <div className="opportunity-kpi-value">{totalClients}</div>
            </div>
            <div className="opportunity-kpi-tile">
              <div className="opportunity-kpi-label">Active clients (open reqs)</div>
              <div className="opportunity-kpi-value">{activeClients}</div>
            </div>
            <div className="opportunity-kpi-tile">
              <div className="opportunity-kpi-label">Median days_open (live sources)</div>
              <div className="opportunity-kpi-value opportunity-kpi-value--accent">{liveMedian ?? "—"}</div>
            </div>
          </div>

          <div className="filterbar">
            <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value={SORT_OPEN_REQS_DESC}>Sort · open reqs ↓</option>
              <option value={SORT_MEDIAN_DESC}>Sort · median days_open ↓</option>
            </select>
            <label className="client-fixture-toggle">
              <input
                type="checkbox"
                checked={showFixtures}
                onChange={(e) => setShowFixtures(e.target.checked)}
              />
              Show fixture sources
            </label>
          </div>

          {visibleAggregates.length === 0 && <p>No clients in the currently loaded data.</p>}

          <div className="clientgrid">
            {visibleAggregates.map((client) => (
              <ClientCard
                key={client.company}
                client={client}
                allClients={allAggregates}
                onOpen={setSelectedCompany}
              />
            ))}
          </div>

          <p className="caption client-count-caption">
            Showing {visibleAggregates.length} client{visibleAggregates.length === 1 ? "" : "s"} from{" "}
            {opportunities.length} currently loaded opportunities. Counts reflect this loaded set, not a
            separately tracked "closed requisition" status.
          </p>
        </>
      )}
    </section>
  );
}
