# S-25 — Hardness score validation against observed time-to-fill

**Basecamp:** todos/10215916782  
**Analysis:** `backend/src/analysis/s25HardnessValidation.ts` (`npm run analyze:s25`)  
**Last run:** 2026-10-13  
**Status:** Insufficient data to conclude; no weight change proposed.

## Result

The corrected first-observation comparison does not yet have enough high-score
requisitions to answer whether the score predicts longer time-to-close. The high bucket
has **4** requisitions, below the declared minimum of **20**. This is an insufficient
sample, not evidence that the score works or fails.

| First-observation score bucket | Requisitions | Median days until classified closed | p25–p75 | First-title role prior | Repost visible at first observation |
|---|---:|---:|---:|---:|---:|
| High (score ≥ 0.50) | 4 | 9 | 9–9 | 1.00 average | 0% |
| Low (score < 0.50) | 137 | 9 | 2–9 | 0.00 average | 0% |

The two medians are equal, but with only four high-bucket requisitions, the comparison
cannot support a null finding. The high bucket is **16** short of the minimum. The low
bucket meets the floor.

There were **141** requisitions classified closed and **983** still present in the
latest source feeds. The observation window ran from **2026-09-03 00:01:27 UTC** (earliest
first observation in the analyzed set) to **2026-09-11 17:07:12 UTC** (latest classified
close).

## Method

- Each requisition is scored from its **first raw title** and only a repost signal that
  was already observable at that first sighting.
- `daysOpen` is excluded from the score. The role signal is reconstructed from the
  original decision-026 curated keyword prior; the current stored measured factor is not
  used because measured scarcity is derived from `days_open` and can contain later
  outcome information.
- Decision 026's 0.60 role-scarcity and 0.20 repost weights are renormalized across the
  included factors to 0.75 and 0.25. `daysOpen` and the later S-24 capacity factor are
  excluded.
- A requisition is classified as closed when it has been absent from its source feed for
  more than the configured **2-day** grace period. The reported duration is last sighting
  plus that grace period, minus first observation.
- The minimum is **20 requisitions per bucket**. This is a declared small-sample floor,
  not a formal statistical power calculation.

## Limits and next step

Feed disappearance is a proxy for closure, not a confirmed placement or verified fill
date. In this dataset, all analyzed requisitions had last been seen during the first week
of the observation window, while other requisitions remained in the feeds later. The
result therefore describes this ingestion history and should not be presented as a
validated measure of real-world time-to-fill.

Rerun `npm run analyze:s25` as additional requisitions accumulate and close. Report a
conclusion only when both buckets meet the declared sample floor. If the medians still do
not separate then, report that plainly and inspect the factors without tuning them to this
small sample. No scoring weights were changed and no new weight version was created.

## Methodology correction and audit note

An earlier run dated **2026-10-06** reported 6 high and 135 low requisitions. That script
excluded `daysOpen` directly but took `roleScarcity` from the current opportunities row.
Because measured `roleScarcity` depends on observed `days_open` medians, the score could
contain later outcome information. The earlier bucket counts and comparison are
superseded and must not be cited as the S-25 result. This version reconstructs the
decision-026 curated signal from the first raw title and has been rerun against the
available project database.

**Naming note:** this S-25 refers to the Basecamp hardness-score story, not the separate
S-25 UI redesign work elsewhere in the repository.
