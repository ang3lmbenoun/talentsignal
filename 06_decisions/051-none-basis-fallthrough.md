# 051 — Show the stored role-scarcity basis everywhere (the 180 vs 155 finding)

**Date:** 2026-11-03
**Story:** none yet — number cleanup from `07_analyses/number-audit-2026-11-03.md` (branch `ui/number-cleanup`)
**Requirement:** none cited — a display-consistency fix, documented per CLAUDE.md rule 4 because it changes which value a trust number shows
**Decided by:** Megan — **PROPOSED, pending Ali's approval**

> **Numbering note:** `051-analytics-fourth-kpi-and-active-pipeline-value.md` already uses 051. This file was
> requested under the name `051-none-basis-fallthrough.md`, so both exist. Renumber one of them (052 is free)
> when this is reviewed.

## The question

The same "measured basis" count showed two different numbers on screens that sit next to each other:

| Where | Measured | Curated | None |
|---|---|---|---|
| Overview basis bar, Signals basis panel, Clients detail sentence | **180** | 10 | 934 |
| Opportunities card basis dot and filter (and the backend summary) | **155** | 10 | 959 |

Both were labelled "measured". Basis is the main trust claim of the hard-to-fill score (decision 046), so
two answers for one question is the kind of silent inconsistency CLAUDE.md rule 4 exists to stop.

## What the data says (demo database, 1,124 postings)

- The Opportunities screen reads the basis **stored** on each row: `hard_to_fill_factors` → the
  `roleScarcity` factor's `basis`. Overview, Signals and Clients **re-derived** it in the browser with
  `basisDerivation.ts` (`effectiveBasis` / `summarizeBasis`), which prefers the stored value and falls back to a
  rule only when none is stored.
- The entire gap is **25 Greenhouse rows** that have **no stored basis key at all**. They are the
  `hard-to-fill-026-v1` rows scored before S-23 (28 rows in total: 25 Greenhouse, 3 Lever). The stored view
  reads them as "none" (the fall-through). The derivation re-classifies the 25 Greenhouse ones as
  "measured" (family eligible), giving 155 + 25 = 180 measured and 959 − 25 = 934 none.
- Decision 049 justified the derivation on the premise that "every row is still v1 with no `basis` key".
  That is **no longer true**: 1,096 of 1,124 rows are now `hard-to-fill-026-v3` and carry a stored basis.
  Only the 28 old rows still fall through.

## Options considered

1. **Show the derived value everywhere** (make Opportunities match the others). Rejected: it would put a
   number on the cards that the stored score and its "How this was scored" breakdown do not contain, so a card
   could say "measured" while its own factor list says nothing about a basis.
2. **Show the stored value everywhere** (make Overview, Signals and Clients match Opportunities). Display-only:
   no scoring, derivation or threshold changes.
3. **Rescore the 28 old rows** so stored and derived agree, then decide whether the browser-side fallback is
   still needed. A data/backend task.

## What we chose, and why

**Option 2 now, with option 3 recommended as the follow-up.**

- Overview, Signals and Clients now read the stored basis through `frontend/src/lib/storedBasis.ts`
  (`summarizeStoredBasis`), which only calls `basisDerivation`'s existing `storedRoleScarcityBasis()` and treats
  anything that is not a stored "measured" or "curated" as "none". `basisDerivation.ts` itself, its rules and
  every scoring module are unchanged.
- A short **"Basis as stored"** tooltip on the Overview and Signals basis panels says what the number is:
  the value saved the last time each posting was scored, the same value shown on every Opportunities card.
- Source health (live / flagged — excluded), role families and every other derived figure are untouched; only
  the basis counts moved.

Recommendation for Ali: approve rescoring the 28 `hard-to-fill-026-v1` rows (S-23's backfill) so that the
stored basis is complete. After that the two views agree by construction, and the question of retiring the
browser-side fallback (and updating decision 049) can be decided on its own.

## What would make this wrong

- If Ali wants the **derived** basis to be the product's definition (for example because rescoring is not
  planned), the stored view will under-report measured basis by the un-rescored rows, and the Opportunities
  cards, not the other screens, would be the ones to change.
- The stored value is only as fresh as the last scoring run. If the family-scarcity inputs change and nobody
  rescores, the stored basis goes stale while a derivation would not. The tooltip makes the staleness
  visible, but it does not remove it.
- This only moves **which** number is displayed. Whether 155 or 180 is the "right" count is a scoring
  question and is not decided here.
