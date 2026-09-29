# 050 — Overview donut tier thresholds and plain-English callouts (S-25 redesign)

**Date:** 2026-09-29
**Story:** S-25 (Overview screen redesign, no formal story file yet — see `talentsignal-redesign.html`, Screen 1)
**Requirement:** none cited — new load-bearing UI copy introduced by this task
**Decided by:** Megan — PROPOSED, pending Ali's sign-off

## The question

Overview's opportunity distribution donut has shipped a 4-bucket split
(Strong/Good/Review/Poor) since before this task, computed in the `tiers`
`useMemo` in `OverviewScreen.tsx`. But no decision doc ever named the
cutoffs or defended them — they were an implementation detail of a chart.
The S-25 redesign mockup adds plain-English callouts next to each slice
("act now" / "strong signal" / "verify before acting" / "likely noise"),
which makes those cutoffs load-bearing sales-facing copy for the first
time — a sales rep will now read "act now" as an instruction, not just see
a colored wedge. Per CLAUDE.md rule 4 (scoring thresholds and segment
definitions are business decisions, not silent assumptions), that needs to
be named and logged explicitly before shipping, even though the underlying
numbers aren't changing.

## What we chose, and why

Keep the existing, already-shipped `confidenceScore` cutoffs exactly as
coded — no threshold changes, only new labels:

| Tier   | Range                          | Callout               |
|--------|---------------------------------|------------------------|
| Strong | `confidenceScore >= 0.70`       | "act now"              |
| Good   | `0.50 <= confidenceScore < 0.70` | "strong signal"        |
| Review | `0.25 <= confidenceScore < 0.50` | "verify before acting" |
| Poor   | `confidenceScore < 0.25`        | "likely noise"         |

This is deliberately a split on `confidenceScore` alone, not
`hardToFillScore`. `confidenceScore` answers "is this posting real evidence
of unmet hiring demand at all" — the right axis for a general
opportunity-quality triage view a sales rep scans top-to-bottom on their
landing page. `hardToFillScore` answers a narrower question ("is this
specific role type hard to source") and already gets its own dedicated
tile and basis breakdown elsewhere on this same screen — folding it into
this donut too would answer two different questions with one split, which
decision 026 already rejected for `scoreSignal()`'s own factor design.

The cutoffs themselves echo decision 026's own precedent: quartile-style
bands over a `[0,1]` score, with `0.50` as the "generic signal vs. real
signal" midpoint (the same value decision 026 used for
`hardToFillThreshold`). They're not new math — they're the same
`confidenceScore` bands (decision 007) the donut has used all along, now
given an explicit name and a plain-English reading instead of staying an
unlabeled implementation detail.

## What this rests on

That a sales rep's mental model of "strong lead vs. noise" maps cleanly
onto confidence quartiles. That's our best guess under the redesign's time
box, not Ali's answer.

## What would make this wrong

If Ali wants the donut to reflect hard-to-fill-worthiness instead of (or
blended with) confidence, wants different cutoffs, wants a different
number of bands, or wants the callout copy itself changed. If any of that
changes, the fix is confined to the `tiers` `useMemo` in
`OverviewScreen.tsx` plus this doc — nothing else in the codebase reads
these tier boundaries or callout strings.
