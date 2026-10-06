# S-25 — Hardness score validation against observed time-to-fill

**Date:** 2026-10-06
**Basecamp:** todos/10215916782
**Script:** `backend/src/analysis/s25HardnessValidation.ts` (`npm run analyze:s25`)
**Status:** Insufficient data — no conclusion drawn, no weight change proposed.

> **Naming note:** this analysis is independently labeled "S-25" in Basecamp. It is
> unrelated to this codebase's other, much larger "S-25" (the Overview/Opportunities/
> Analytics visual redesign) — the label collision is coincidental.

## Executive summary

The real closed-requisition sample in this dataset is **too thin to conclude anything**:
only 6 requisitions landed in the HIGH-hardness bucket against a minimum of 20, so no
honest claim can be made about whether the first-observation score tracks real
time-to-close. The 135 LOW-bucket requisitions and the 6 HIGH-bucket ones both closed at
a median of 9 days — identical — but that comparison carries no weight given the HIGH
sample size.

## Methodology

**Exclusion statement (non-negotiable per the spec):** `daysOpen` was excluded from the
scoring side entirely — the first-observation score is a function of only `roleScarcity`
and `repostedRole`. `capacitySignal` was also excluded (added in S-24, after decision
026, never part of the formula under test). This means the score under test **can**
fail to predict days-to-close — nothing about its construction manufactures a
correlation with the outcome variable.

**Normalization:** decision 026's original three-factor weights were `roleScarcity:
0.60`, `daysOpen: 0.20`, `repostedRole: 0.20`. Restricted to the `roleScarcity +
repostedRole` subset, the two remaining weights are renormalized to sum to 1:
`roleScarcity: 0.60 / 0.80 = 0.75`, `repostedRole: 0.20 / 0.80 = 0.25`.

- `roleScarcity`'s value is read as already stored on each opportunity (measured's
  continuous [0,1] ratio, curated's 1, or none's 0) — not re-derived.
- `repostedRole` is **recomputed from scratch** against `raw_requisitions` history,
  restricted to only what was observable at the requisition's own first sighting
  (mirrors decision 043's `hasPriorRequisitionIdSighting` check exactly — the
  absence-based half of repost detection structurally cannot fire on a first sighting,
  since it requires a prior row for the same item to already exist). A repost that only
  became visible later in the requisition's history is correctly excluded.

**Closed definition:** a requisition is closed once it has gone unseen in its source's
feed for longer than a grace period (default 2 days, configurable via
`S25_GRACE_PERIOD_DAYS`), measured against the **latest ingestion run actually recorded
for that source** — not "now". A requisition still present in the latest run is open
and excluded from the closed-set analysis entirely. `closed_at = last_seen_at + grace
period`; `days_to_close = closed_at - first_observed_at`.

**Minimum sample size:** 20 per bucket, chosen as a conventional small-sample floor for
a median comparison to mean anything — not a derived statistical power calculation. This
analysis does not claim more rigor than that one number deserves.

## Results

| Bucket | n | Median days-to-close | p25 | p75 | Avg roleScarcity value | % with repost visible at first obs. |
|---|---|---|---|---|---|---|
| HIGH (score ≥ 0.50) | **6** | 9 | 9 | 9 | 1.00 | 0% |
| LOW (score < 0.50) | 135 | 9 | 2 | 9 | 0.157 | 0% |

Total closed requisitions analyzed: **141** (109 Greenhouse, 32 Lever). Total still open
(excluded): 983.

**Minimum sample size not met.** HIGH needed 14 more closed requisitions to reach the
20-per-bucket floor.

## Observation window

Earliest `first_observed_at` across the analyzed (closed) set: **2026-09-03T00:01:27Z**
Latest `closed_at` across the analyzed set: **2026-09-11T17:07:12Z**

This window is real but narrow and worth flagging on its own: every one of the 141
closed requisitions was last seen between 2026-09-03 and 2026-09-09, even though
ingestion continued recording fresh sightings of the *other* 983 requisitions all the
way through 2026-09-29. In this seeded dataset, "closing" is clustered entirely in the
first week of the ingestion window rather than spread across it — consistent with how
this demo data was generated, not necessarily how a live client feed would behave. That
clustering is itself part of why the HIGH bucket stayed thin: whatever subset of
requisitions happens to close in this dataset closes early, before much separation
between hard-to-fill and easy-to-fill postings would have had time to show up.

## Interpretation: **insufficient data**

Per the spec's own honesty rule, a bucket below the 20-sample floor blocks a conclusion
regardless of what the numbers show. I'm not calling this a "null result" (which would
imply there *was* a fair test and the score failed it) or "real signal" (which the
numbers don't support anyway) — it's genuinely **insufficient data**, and the HIGH
bucket's n=6 is the reason, not a judgment call.

For transparency, since the spec also asks what to name as a suspect factor when medians
don't separate: the two buckets' medians are identical (9d each), and `repostedRole`
contributed nothing to the score of a single requisition in either bucket — not because
the signal doesn't exist in this data (it does: `requisition_id` reuse across different
`external_id`s is present elsewhere in the Greenhouse feed), but because none of the 141
closed requisitions happened to carry a first-observation-visible repost. With a sample
this small, I'm not willing to name `roleScarcity`'s curated weight as miscalibrated —
that would be reading a pattern into 6 data points. The honest statement is that this
sample cannot currently distinguish "the score doesn't track outcomes" from "the score
tracks outcomes but this particular 6-item sample is too small to show it."

## Weight change: **not proposed**

No weight change is proposed from this result, and `06_decisions/059` was **not**
created — there is no statistically defensible basis to suggest new numbers from a
6-item bucket. This should be re-run once the closed-set sample grows past 20 in both
buckets, ideally from ingestion history that spans requisitions closing throughout the
full window rather than only in its first week.

## What would make this wrong

If the "closed" definition is too strict for this data (e.g. the grace period should be
longer, or shorter, given how sparsely some sources were polled), a different
`S25_GRACE_PERIOD_DAYS` value could reclassify some of the 983 "still open" items as
closed and meaningfully change both bucket sizes — worth a sensitivity re-run before
trusting this result's "insufficient data" verdict as final. If real (non-seeded)
ingestion history accumulates with requisitions closing across the full observation
window rather than only in the first week, re-running this script against that history
is the natural next step.
