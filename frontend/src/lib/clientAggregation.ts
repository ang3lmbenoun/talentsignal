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
} from "./basisDerivation";
import { summarizeStoredBasis } from "./storedBasis";

export interface ClientOpportunity extends BasisOpportunity {
  company: string;
  hardToFill?: boolean;
  // null/absent until the repost-detection diff has run for this row.
  diffComputedAt?: string | null;
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
    // Basis as stored on the rows (06_decisions/051), same value the
    // Opportunities cards show -- not re-derived here.
    const basis = summarizeStoredBasis(rows);
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
// The posting count and median age are NOT repeated in this sentence: every
// place that shows it already shows them as their own labelled figures (the
// "Open requisitions" / "Typical age" pills and the detail KPIs).
export function clientWhyItMatters(client: ClientAggregate, allClients: ClientAggregate[]): string {
  const sourceName = client.source === "greenhouse" ? "Greenhouse" : client.source === "lever" ? "Lever" : client.source;
  const agePart = client.medianDaysOpen === undefined ? " The source does not provide a usable posting age." : "";

  if (client.verdict === "flagged — excluded") {
    return `${client.company}: this source's dates look unusually old and are excluded from measured role-scarcity comparisons.${agePart} Verify that each posting is still active; the age-based demand score may also be affected.`;
  }
  if (client.verdict === "fixture") {
    return `${client.company}: these are demo records for illustrating the workflow, not live hiring demand.${agePart}`;
  }
  return `${client.company}: ${sourceName} is a live source eligible for measured role-scarcity comparisons.${agePart} Reposted roles: ${client.repostedCount}; currently flagged hard to fill: ${client.hardToFillCount}.`;
}

// Display wording for the source status badge, shared by the Clients and
// Opportunities screens so both say the same thing ("live", as on the
// Opportunities source pills) instead of "healthy". The underlying verdict
// value is unchanged.
export function verdictLabel(verdict: SourceVerdict): string {
  return verdict === "healthy" ? "live" : verdict;
}

export function clientWhyItMattersExpanded(client: ClientAggregate, allClients: ClientAggregate[]): string {
  const first = clientWhyItMatters(client, allClients);
  const second =
    client.hardToFillCount > 0
      ? `${client.hardToFillCount} of these are flagged hard-to-fill, and ${client.basis.measured} have measured-basis scarcity evidence.`
      : `None of these are currently flagged hard-to-fill; ${client.basis.measured} have measured-basis scarcity evidence.`;
  return `${first} ${second}`;
}
