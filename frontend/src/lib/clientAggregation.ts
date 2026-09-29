// S-25 Clients redesign. "Client" here means an opportunity source-company
// (opportunities.company, e.g. "GitLab", "Gopuff") -- a distinct concept
// from the real CRM `clients` table (backend/src/routes/clients.ts, name +
// contact_info, managed via its own create form). There is no foreign key
// between them. This screen replaces the CRM view with this aggregation
// per the approved redesign; the CRM table/route are untouched and still
// reachable via the API.
//
// Same client-side-aggregation pattern as Overview/Signals: fetches the
// same GET /api/hidden-demand/opportunities?includeSeedData=true array
// every other screen already fetches, no new backend endpoint. Every
// number below is derived from that real, loaded set -- nothing invented.

import {
  type BasisOpportunity,
  type BasisSummary,
  computeMeasuredEligibleFamilies,
  effectiveBasis,
  extractDaysOpen,
  MEASURED_ELIGIBLE_SOURCES,
  median,
  summarizeBasis,
} from "./basisDerivation";

export interface ClientOpportunity extends BasisOpportunity {
  company: string;
  hardToFill?: boolean;
}

export type SourceVerdict = "healthy" | "fixture" | "flagged — excluded";

// Mirrors SignalsScreen's own source-health verdict (via
// computeSourceHealth in basisDerivation.ts) -- "healthy" for a source on
// decision 046's measured-eligible allowlist or with at least one measured
// row, "fixture" for the seed board, "flagged — excluded" otherwise (e.g.
// Lever, per decision 046's zombie-requisition finding).
function sourceVerdict(source: string, hasMeasuredRow: boolean): SourceVerdict {
  if (source === "seed-job-board") return "fixture";
  if (MEASURED_ELIGIBLE_SOURCES.includes(source) || hasMeasuredRow) return "healthy";
  return "flagged — excluded";
}

export interface ClientAggregate {
  company: string;
  source: string;
  openReqs: number;
  medianDaysOpen: number | undefined;
  hardToFillCount: number;
  repostedCount: number;
  noSalaryCount: number;
  basis: BasisSummary;
  verdict: SourceVerdict;
}

// One row per distinct opportunities.company. A company is assumed to post
// through a single source in today's data (verified true for the two real
// sources currently loaded); if a company ever spans sources, the first
// source encountered wins and the rest are folded into the same row rather
// than splitting one company into two cards.
export function computeClientAggregates(opportunities: ClientOpportunity[]): ClientAggregate[] {
  const measuredEligibleFamilies = computeMeasuredEligibleFamilies(opportunities);
  const byCompany = new Map<string, ClientOpportunity[]>();
  for (const o of opportunities) {
    if (!byCompany.has(o.company)) byCompany.set(o.company, []);
    byCompany.get(o.company)?.push(o);
  }

  const aggregates: ClientAggregate[] = [];
  for (const [company, rows] of byCompany.entries()) {
    const source = rows[0].source;
    const daysOpenValues = rows.map((o) => extractDaysOpen(o)).filter((d): d is number => d !== undefined);
    const basis = summarizeBasis(rows);
    const hasMeasuredRow = rows.some((o) => effectiveBasis(o, measuredEligibleFamilies) === "measured");
    aggregates.push({
      company,
      source,
      openReqs: rows.length,
      medianDaysOpen: daysOpenValues.length > 0 ? median(daysOpenValues) : undefined,
      hardToFillCount: rows.filter((o) => o.hardToFill === true).length,
      repostedCount: rows.filter((o) => o.reasons.some((r) => r.includes("reposted"))).length,
      noSalaryCount: rows.filter((o) => o.reasons.some((r) => r.includes("no salary range"))).length,
      basis,
      verdict: sourceVerdict(source, hasMeasuredRow),
    });
  }
  return aggregates;
}

// Deterministic, real-aggregate-only "why this client matters" sentence --
// no per-company invented flourish. The qualifier clause only varies by
// real, computed facts (verdict, and rank among healthy sources by open
// req count).
export function clientWhyItMatters(client: ClientAggregate, allClients: ClientAggregate[]): string {
  const healthy = allClients.filter((c) => c.verdict === "healthy");
  const isTopHealthy =
    client.verdict === "healthy" && healthy.length > 0 && healthy.every((c) => c.openReqs <= client.openReqs);

  const medianPart = client.medianDaysOpen === undefined ? "no measurable median" : `median ${client.medianDaysOpen}d`;
  const base = `${client.company} has ${client.openReqs} open req${client.openReqs === 1 ? "" : "s"}, ${medianPart}, ${client.repostedCount} reposted role${client.repostedCount === 1 ? "" : "s"}`;

  if (client.verdict === "flagged — excluded") {
    return `${base} — flagged and excluded from median-based scoring because its data skews the view.`;
  }
  if (client.verdict === "fixture") {
    return `${base} — fixture data used to demonstrate the workflow, not a live signal.`;
  }
  if (isTopHealthy) {
    return `${base} — this is the hottest live signal source in your data.`;
  }
  return `${base} — a steady live signal source in your data.`;
}

export function clientWhyItMattersExpanded(client: ClientAggregate, allClients: ClientAggregate[]): string {
  const first = clientWhyItMatters(client, allClients);
  const second =
    client.hardToFillCount > 0
      ? `${client.hardToFillCount} of these are flagged hard-to-fill, and ${client.basis.measured} have measured-basis scarcity evidence.`
      : `None of these are currently flagged hard-to-fill; ${client.basis.measured} have measured-basis scarcity evidence.`;
  return `${first} ${second}`;
}
