# 054 — Opportunities screen defaults to a company-grouped landing view

**Date:** 2026-09-30
**Story:** S-26 (Opportunities screen redesign, no formal story file yet)
**Requirement:** none cited — fixes a named, recurring Ali complaint
**Decided by:** Megan — PROPOSED, pending Ali's approval

## The question

Ali's repeated feedback on the Opportunities screen has been "GitLab GitLab GitLab" —
a company with many open requisitions used to render as that many near-identical cards,
each headed with the same company name, before a user could apply any filter to collapse
them. The flat card grid is real, useful, and already filterable (S-25), but it was the
*first and only* thing a user saw on landing, which is what produced the complaint.

## What we chose, and why

The default `/opportunities` view is now a company-grouped landing: one summary row per
distinct `opportunities.company`, not one card per opportunity. Each row shows real,
aggregated numbers — open req count, median `days_open`, hard-to-fill count, a
per-signal-type chip breakdown (reposted / long-open / no-salary, reusing the exact
`SIGNAL_TYPE_OPTIONS` predicates the existing filter bar already defines, not a new
signal taxonomy), and the same source-health badge (`live` / `flagged — excluded` /
`fixture`) Clients and Signals already use.

This reuses `frontend/src/lib/clientAggregation.ts`'s `computeClientAggregates()` and
`clientWhyItMatters()` verbatim — the exact same per-company aggregation already built
for the Clients screen (06_decisions from the S-25 Clients redesign) — rather than a
second implementation. Same real numbers either screen would show for the same company.

Clicking a row navigates into the existing flat card grid, pre-filtered to that company
via the grid's own `companyFilter` state (the same dropdown filter S-25 already built) —
not a new filtering mechanism. The grid's full filter bar (role family, signal type,
basis, age) stays available for further narrowing once inside. A "View all opportunities
(flat grid)" escape hatch on the landing view, and a "Back to companies" link inside the
grid, keep both views reachable in either direction — the flat grid is preserved exactly
as S-25 built it, just no longer the first thing rendered.

## What this rests on

That "one row per company, click through to detail" is the right fix for the complaint,
rather than (for example) collapsing repeated cards in place, or grouping by role family
instead of company. Ali's own wording ("GitLab GitLab GitLab") names company repetition
specifically, so company-grouping is the most direct reading — but it's our best guess at
the right information architecture, not his confirmed answer.

## What would make this wrong

If Ali wants the grouping collapsed inline on the same page (accordion-style) instead of
navigating to a separate filtered grid view, or wants a different default grouping
dimension (e.g. role family, or hard-to-fill status), the fix is confined to
`CompanyGroupedLanding`/`CompanyRow` in `OpportunitiesList.tsx` and this doc — the
underlying aggregation and the flat grid itself don't change.
