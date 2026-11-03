# Onboarding

The next builder starts in minutes. This is the one page to read first.

## What TalentSignal is

A full-stack cloud web application, not an analysis project, for staffing-agency sales teams:
it surfaces hidden hiring demand from public job-market signals, ranks candidates against open
roles, and drafts outreach packages. External providers stay mocked behind adapter seams.

## Where the code lives

**https://github.com/ang3lmbenoun/talentsignal** — `main` branch.

## Where the demo lives

The project runs **locally only**; there is no hosted demo. See the README's "Run it locally"
section. Data is synthetic seed data only, loaded with `npm run seed:demo`, never real client data.

## Where the decisions live

`06_decisions/` — one numbered file per business-logic judgment call (scoring weights,
thresholds, segment definitions, security/deploy tradeoffs), each stating what it rests on and
what would make it wrong. 37 decisions on file as of S-20 (numbering has small intentional gaps
— a few reserved numbers were superseded or never needed once a gate passed clean).
`06_decisions/README.md` is the template and the open-items index — check it for anything still
awaiting the approver's answer before building on top of it.

## Where the story specs live

`00_scope/stories/` — per-story Gherkin acceptance criteria: `S-01.md` through `S-19.md`, plus
`HF-1.md`. No `S-20.md`, `HF-2`, or `HF-3` story file exists — those releases were built
directly from check-in notes and ticket comments, captured instead in the relevant
`06_decisions/` entries. `00_scope/scope.md` is the overall captured spec — read that first for
*what* the platform does.

## Where the presentations live

`05_presentations/` — per-story build summaries and demo evidence (screenshots, load-test
results), written for the weekly class demo.

## The project docs

The spec was captured from a private project-management workspace (an index, requirements, an
architecture and agent map, a trust primer, a build guide and a traceability matrix). Those
documents and their links are not part of this repo; `00_scope/` holds the captured result.

## Non-negotiables

From `CLAUDE.md` — these override anything else in this repo, including a plausible-looking
shortcut:

- **Heuristic first.** Ship a transparent, explainable heuristic behind a service boundary. Do
  not reach for ML. A trained model must be able to replace it without touching callers.
- **Adapter seams stay mocked.** External providers (job boards, CRM) are mocked behind adapter
  seams — no real outbound integration exists yet.
- **REQ-020, enforced in code, not by convention:** the AI drafts and suggests; a human reviews
  and releases anything that would leave the platform or write to a client CRM.
- **No secrets in the repo. Ever.** Environment variables only.
- **Timeouts and correlation ids.** Every outbound HTTP/DB/queue call gets an explicit timeout.
  All logs are structured JSON with a correlation id.

## Who to ask

Business-logic decisions and phase approvals belong to the project's approver; the build owner
is the repository owner. Open a decision-log entry (`06_decisions/`) for anything that is a
business choice.
