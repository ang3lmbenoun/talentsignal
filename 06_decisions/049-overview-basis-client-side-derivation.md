# 049 — Overview's basis distribution moves to client-side derivation (S-25 redesign)

**Date:** 2026-09-29
**Story:** S-25 (Overview screen redesign, no formal story file yet — see `talentsignal-redesign.html`, Screen 1)
**Requirement:** none cited — bug fix uncovered while implementing the S-25 redesign task
**Decided by:** Megan — fix, not a new business-logic decision (documented here per CLAUDE.md rule 4 since it changes which data source a displayed metric trusts)

## The question

Overview's "Basis distribution" card always rendered `Measured 0 / Curated 0 /
No basis 1040`, while the Signals screen (S-26) correctly shows `Measured 131
/ Curated 10` for the same underlying opportunities. Same data, two different
numbers on two screens — that's exactly the kind of silent inconsistency the
redesign task called out as a bug to fix, not a case of Overview computing
something wrong on its own terms.

Root cause: `backend/src/routes/opportunitySummary.ts`'s `measured_basis` /
`curated_basis` aggregate queries filter on the `hard_to_fill_factors` JSONB
column's `basis` key, which only gets populated for rows scored under
`hard-to-fill-026-v2` (the S-23 rescore, per decision 046). Production's
`opportunities` table was never rescored/backfilled — every row is still
`v1` with no `basis` key at all — so both `EXISTS` clauses in that query
match zero rows, and `noBasis` (computed as `total - measured - curated`)
comes back as the full total. Overview's `useOpportunitiesSummary` hook
faithfully displays that DB aggregate; it isn't buggy in itself, it's just
trusting a column that was never backfilled.

## What we chose, and why

`SignalsScreen.tsx` already worked around this correctly: it derives basis
client-side from real `title`/`source`/`daysOpen` fields the API does
return, using the exact same classification/scarcity logic
`backend/src/scoring/hardToFillScore.ts` and `familyScarcity.ts` use
(decision 046) — it prefers a row's real stored `basis` when present, and
falls back to the derivation only when it isn't (i.e., always, today).

That derivation logic (role family classification, the ROLE_KEYWORDS
curated list, the Greenhouse-only ≥10-observation eligibility threshold,
`extractDaysOpen`) was extracted out of `SignalsScreen.tsx` into a new
shared module, `frontend/src/lib/basisDerivation.ts`. `OverviewScreen.tsx`
now calls `summarizeBasis(opportunities)` from that module over the same
`GET /api/hidden-demand/opportunities?includeSeedData=true` array it
already fetches for its donut and other panels — no new network request —
instead of reading `measuredBasis`/`curatedBasis`/`noBasis` off
`/api/opportunities/summary`. `SignalsScreen.tsx` was updated to import the
same shared functions instead of its own local copies; this edit is
behavior-preserving (same formulas, same thresholds, same output) — it was
not given new UI or logic.

`/api/opportunities/summary`'s other fields (`total`, `hardToFill`,
`totalClients`, `totalCandidates`, `totalRequisitionsIngested`) are correct
today and untouched — this fix only stops Overview from reading the three
basis fields off that endpoint.

## What this rests on

The same assumptions decision 046 already accepted for Signals: this is a
proxy computed from whatever rows are currently loaded (bounded by
`includeSeedData=true`, not necessarily the full production table if
pagination is ever added), and it inherits every one of decision 046's
known limits (Lever's `days_open` excluded from medians due to its
data-quality anomaly, `ml-ai`/`security` sitting near the observation
threshold, `retail-ops` can never be "measured" since it's all-Lever).

## What would make this wrong

If production is ever actually rescored/backfilled under S-23, the DB
aggregate in `opportunitySummary.ts` becomes correct on its own, and this
client-side derivation becomes redundant (though still accurate — same
math, same inputs). At that point the right follow-up is to delete the
client-side path in both screens and go back to trusting
`/api/opportunities/summary` directly, not to maintain both indefinitely.
