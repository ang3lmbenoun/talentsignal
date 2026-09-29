# 051 — Analytics: a fourth KPI tile, and what "Active pipeline value" means

**Date:** 2026-09-29
**Story:** S-25 (Analytics screen redesign, no formal story file yet)
**Requirement:** none cited — overrides guidance from decision 020 (S-12, REQ-009)
**Decided by:** Megan, on Megan's explicit instruction — PROPOSED, pending Ali's approval

## The question

`AnalyticsDashboard.tsx` already carries Ali's own recorded instruction, verbatim, in a
code comment: *"no fourth KPI... (Ali: 'make the top three numbers correct before adding
a fourth')"* — and decision 020, which defines those three KPIs, is itself still only
PROPOSED, never confirmed by Ali. The S-25 redesign spec explicitly asks for a 4th tile
("Active pipeline value"). Building it means directly overriding a standing, on-record
instruction, not filling in an open blank — exactly the kind of thing CLAUDE.md rule 4
says to stop and log rather than build past silently.

I stopped and asked. Megan's answer: add the 4th tile anyway, because this instruction is
newer and more specific than the Aug 1 note, and asked that this be logged as explicitly
superseding decision 020's "no fourth KPI yet" guidance rather than silently contradicting
it.

## What we chose, and why

Added a 4th KPI tile, "Active pipeline value," to the top row in `AnalyticsDashboard.tsx`.

**What it actually shows:** the count of currently-`draft` (not yet released)
`opportunity_packages` rows — real data, fetched from the same `GET /api/opportunity-packages`
endpoint the Packages screen uses. **Not a dollar figure.** The approved mockup's own
version of this tile shows `—` with the caption "value is unavailable in the supplied
dataset," and decision 048 already established, for the Opportunities screen, that no
`bill_rate`/`pay_rate` field exists anywhere in this app to compute a real dollar spread
from. Labeling a fabricated dollar amount "Active pipeline value" would be exactly the
invented-number failure mode every other screen in this redesign has deliberately avoided.
A count of in-flight packages is the closest honest, real proxy for "how much active work
is in the pipeline right now" — captioned explicitly as a package count, not a currency
figure, with `n=<total packages loaded>` as the denominator context the task asked for.

## What this rests on

That Megan's instruction to add this tile now is the right call to make on Ali's behalf,
ahead of his own sign-off on either decision 020's three KPIs or this fourth one. That's an
assumption this session made under direct instruction, not something Ali has confirmed.

## What would make this wrong

If Ali's "correct before a fourth" instruction was meant to hold regardless of how much
later or how specific a new request is, this tile should be removed (or hidden behind a
flag) until he signs off on the first three. If Ali wants "Active pipeline value" to mean
an actual dollar figure, that requires `bill_rate`/`pay_rate` fields that don't exist yet —
a schema change, not a tweak to this tile's query.
