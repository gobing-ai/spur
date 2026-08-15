---
template: feature-impl
schema_version: 1
name: "Render role routing and token consumption on the Board"
description: ""
status: done
type: task
profile: standard
feature_id: J7
parent_wbs: null
priority: P2
tags: []
dependencies: ["0546", "0547"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:41.426Z"
updated_at: "2026-08-15T16:19:53.219Z"
---

## 0552. Render role routing and token consumption on the Board

### Background
Feature J6 (batch 2) ships the routing data: the decision on every run (task 0545), a queryable
role-to-executor aggregate (0546), and token totals joined over `run_id` (0547). J6's scope
deliberately excludes rendering it, because feature J4 owns Board surfaces.

Data reachable only by query is, in practice, data nobody looks at. A `scribe` role quietly served by
a `capable-3` executor stays invisible for exactly as long as nobody runs the query — which defeats
the point of recording it.

This task renders it. The hard part is not the chart; it is **not lying with a number**. The
underlying data carries three distinctions that are easy to flatten in a UI and expensive to flatten:
unmeasured is not zero, estimated is not exact, and no-data-yet is not no-activity.
### Requirements
- [x] **R1.** A Board surface shows the role-to-executor routing aggregate: per pair, the run count
      and the escalation count, with role-resolved runs distinguished from explicitly pinned ones.
      Consume task 0546's query; add no query of this task's own. Measurable: a known dataset renders
      the same counts the query returns, with pinned and resolved shown separately.
- [x] **R2.** Token totals render alongside: input, cache-read, cache-write, and output per role,
      from task 0547. No dollar figure appears anywhere — excluded permanently by operator ruling
      2026-08-13, not deferred. Measurable: the rendered surface contains no currency value, asserted
      by test.
- [x] **R3.** Unmeasured renders as unmeasured, never as zero. A role whose runs found no matching
      history rows is visually distinct from a role that genuinely consumed nothing. Measurable: a
      dataset containing both states renders them differently.
- [x] **R4.** An estimated total (time-window join) is marked estimated and never shown as exact
      (`run_id` join). Measurable: a mixed dataset renders both with the distinction visible.
- [x] **R5.** An empty dataset states that nothing has been recorded rather than rendering zeroes a
      reader could mistake for measurements. Measurable: with no attribution recorded, the surface
      shows an explicit empty state.
### Acceptance Criteria
Covers feature J7 scenarios:

- **R1 — Routing is visible on the Board**
- **R2 — Token totals render beside the routing they belong to**
- **R3 — Unmeasured and estimated states render as themselves**
- **R4 — An empty dataset reads as empty, not as zero activity**

```gherkin
Scenario: R1 — Routing is visible on the Board
  Given persisted routing attribution
  When the Board surface is opened
  Then it shows per role and executor the run count and the escalation count
  And it distinguishes role-resolved runs from explicitly pinned ones

Scenario: R2 — Token totals render beside the routing they belong to
  Given token totals attributed by role
  When the surface is read
  Then it shows input, cache-read, cache-write, and output totals per role
  And it shows no dollar figure anywhere

Scenario: R3 — Unmeasured and estimated states render as themselves
  Given a role with no matched history rows and a role whose totals came from the time-window join
  When both are displayed
  Then the first reads as unmeasured rather than as zero
  And the second is marked estimated rather than shown as exact

Scenario: R4 — An empty dataset reads as empty, not as zero activity
  Given no routing attribution has been recorded yet
  When the surface is opened
  Then it states that no data has been recorded
  And it does not render zeroes that could be mistaken for measured values
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does this task query anything?** No. It renders what tasks 0546 and 0547 expose, through the
  existing typed oRPC client.
- **How do the honest states render?** `unmeasured` and `no-data-yet` as themselves, `estimated`
  marked distinctly from `exact`. Three of four scenarios are about not lying with a number.
- **Any dollar figures?** None, permanently.
- **New Board module?** No — extends feature J4's existing surfaces.

**Deferred with owner.**

- **A dedicated routing module** — owner: operator, only if the data outgrows an existing surface.
- **Interaction (filtering, drill-down)** — owner: operator; display first.
### Design
**Render, do not re-derive (R1).** Tasks 0546 and 0547 expose the aggregate and the token totals. This
surface consumes them through the existing typed client. A second query here would be a second place
the numbers can be wrong.

**Three honest states are the actual requirement (R3/R4/R5).** A dashboard that renders unmeasured,
estimated, and no-data-yet all as `0` is worse than no dashboard, because it converts a known gap into
an apparent measurement. The distinctions come from upstream and must survive rendering:

| Upstream state | Source | Must not render as |
| --- | --- | --- |
| unmeasured — no matched history rows | task 0547 R3 | `0` |
| estimated — time-window join | task 0547 R4 | an exact figure |
| no data yet | empty result | zero activity |

**No prices (R2).** Not a deferral — a permanent boundary (feature J6 § *Tokens, not prices*). If a
reviewer finds a currency symbol on this surface, it has failed its own contract.

**Extend, do not add a module.** Feature J4 (done) established Board observability surfaces and M3
owns Teams UX. This is a surface within that established structure, not a peer to Teams and
Observability. If the data seems to demand its own module, that is a question for the operator, not a
decision to take here.

**Follow the design system.** Root `DESIGN.md` is the UI SSOT when present — read it before laying
anything out, and keep tokens, typography, and responsive behaviour consistent with it.

**Not in scope:** producing the data (J6), any new observability table or transport, and any change
to routing behavior.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Routing aggregate consumed | `{ role, executor, source, runs, escalations }` | task 0546 |
| Token totals consumed | `{ inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens }` per role | task 0547 |
| States that must survive rendering | `unmeasured` · `estimated` · `exact` · `no-data-yet` | tasks 0547 R3/R4 |
| Web app | `apps/web/` (Astro + typed oRPC client) | — |
| Existing Board surfaces to extend | feature J4 (Board observability + Teams supervisor) | — |
| UI SSOT | root `DESIGN.md` when present | CLAUDE.md § Design system |

**No new query, no new module, no currency field.**

#### Anti-patterns — what not to implement

- Do **not** add a query. Tasks 0546 and 0547 expose the data; a second query here is a second place
  the numbers can be wrong.
- Do **not** render `unmeasured`, `estimated`, or `no-data-yet` as `0`. A dashboard that flattens all
  three into zero is worse than no dashboard — it converts a known gap into an apparent measurement.
- Do **not** show any dollar figure. Permanently excluded (feature J6 § *Tokens, not prices*).
- Do **not** add a peer Board module. This extends J4's established surfaces; if the data seems to
  demand its own module, that is an operator question.
- Do **not** lay out before reading root `DESIGN.md` when it exists.

#### Cross-task contract

**Assumes from 0546:** the `(role, executor)` aggregate with run and escalation counts and the
selection-source split. **Assumes from 0547:** per-role token totals carrying their `unmeasured` /
`estimated` / `exact` state. Both are consumed as-is.

**Leaves for dependents:** none — terminal task of feature J7.
### Plan
- [x] Read root `DESIGN.md` and the existing J4 surfaces, then render task 0546's role-to-executor aggregate with run and escalation counts (R1)
- [x] Show role-resolved and pinned runs separately (R1)
- [x] Render per-role token totals from task 0547 with no currency value anywhere (R2)
- [x] Render unmeasured distinctly from observed zero (R3)
- [x] Mark estimated totals as estimated, distinct from exact (R4)
- [x] Render an explicit empty state when nothing has been recorded (R5)
- [x] Add tests including a dataset mixing measured, unmeasured, estimated, and empty (R1-R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Rendered the J6 routing aggregate and per-role token totals on the Board by extending feature
J4's observability surface — no new query, no new module, no currency field.

Change map:

- **`apps/server/src/modules/observability/index.ts:212-236`** — new `GET /api/observability/routing-summary`
  handler (task 0552). Forwards `since`/`until` as-is to the two J6 domain surfaces and returns
  `{ routing, tokens }` in one round trip: `SystemEventDao.routingSummary` (0546) for the
  (role, executor, source) pair aggregate, `roleTokenSummary` (0547) for per-role token totals.
  The route holds no window logic and adds no query of its own — the domain surfaces apply their
  own bounded defaults. ADR-005 §4 type seam (`apps/server/src/modules/observability/index.ts:203-209`,
  `setRoleTokenSummaryForTesting` / `resetRoleTokenSummaryForTesting`) so the route is testable
  without a scratch DB; errors surface as `{ error }` 500s like the sibling handlers.
- **`apps/web/src/modules/observability/RoutingTab.tsx:227`** — new Routing tab. Consumes the
  endpoint through the existing fetch client, narrows the envelope once
  (`parseRoutingSummaryResponse`, `apps/web/src/modules/observability/RoutingTab.tsx:121`), and renders:
  - **R1** — pair table (role / executor / source / runs / escalations) exactly as the query
    returns it; selection sources stay distinct: `explicit` → *pinned*, `role` → *resolved*,
    `default` → *default*, `null` role (pure pin) renders as `—`.
  - **R2** — per-role token totals (input, cache read, cache write, output) beside the routing;
    plain `Intl.NumberFormat` counts, no currency symbol anywhere (asserted by test).
  - **R3** — a role with no measured bucket renders **unmeasured** with matched-of-total
    coverage and no token figures (`apps/web/src/modules/observability/RoutingTab.tsx:207-216`) — never zero-as-fact; a measured-zero
    role renders 0.
  - **R4** — exact and estimated buckets render as separate labelled rows (`apps/web/src/modules/observability/RoutingTab.tsx:176-181`),
    never summed.
  - **R5** — an empty result states that no attribution has been recorded (`apps/web/src/modules/observability/RoutingTab.tsx:279-281`),
    with no zeroes that could be mistaken for measurements.
- **`apps/web/src/modules/observability/tabs.ts:36`** — registers `{ id: 'routing', label: 'Routing' }`
  in `OBSERVABILITY_TABS` (data-driven append, no shell change).
- **`docs/04_DESIGN.md:1862`** §7.9 — "Board render — routing and token consumption (task 0552)"
  paragraph beside the 0546/0547 read-path docs (T3, same commit).

Tests: `apps/web/tests/modules/observability/routing-tab.test.tsx` (11 tests: R1 counts + source
split, R2 no-currency, R3 unmeasured vs observed zero, R4 exact/estimated separate, R5 empty
state, endpoint URL, parser narrowing); `apps/server/tests/modules/observability/index.test.ts`
(+4 tests: envelope shape, since/until forwarding + defaults, empty dataset, 500 on domain
failure). Not in scope per the task: no new query, no routing-behavior change, no pricing.
### Testing
**Pipeline verify results**

- Verdict: PASS (re-audit 2026-08-15, `--force --focus all`; fresh evidence this run)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/server/src/modules/observability/index.ts:212-227` — `handleRoutingSummary` consumes `SystemEventDao.routingSummary` (0546) + `roleTokenSummary` (0547), forwards `since`/`until`, adds no query. `apps/web/src/modules/observability/RoutingTab.tsx:288-332` renders per-pair runs/escalations; `sourceLabel` (`apps/web/src/modules/observability/RoutingTab.tsx:153`) keeps explicit→pinned / role→resolved / default→default / null→—. Test: apps/web/tests/modules/observability/routing-tab.test.tsx "R1: renders per-pair run and escalation counts, pinned separated from resolved" — passed this run (11/11 web, 16/16 server). |
| R2 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:176-193` `TokenBucketRow` renders input / cache read / cache write / output via `formatTokenCount` (`apps/web/src/modules/observability/RoutingTab.tsx:171`, plain `Intl.NumberFormat`). Wire DTOs carry no currency field. Asserted both sides: server envelope regex `/costUsd|cost_usd|price|\$|usd/i`, web surface `/\$|usd|price|cost/i` — both suites green this run. |
| R3 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:207-216` — `role.unmeasured` branch renders Badge "unmeasured" + "not a measured zero" with no token figures; measured-zero role renders `0`. Test "R3: unmeasured renders as unmeasured, distinct from an observed zero" — passed this run. |
| R4 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:218-219` renders exact and estimated as separate labelled `TokenBucketRow`s (estimated → warning badge, `apps/web/src/modules/observability/RoutingTab.tsx:179`); never summed. Test "R4: exact and estimated buckets render separately, never summed" asserts `1,000` + `300` visible, folded `1,300` absent — passed this run. |
| R5 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:279-283` — both-empty envelope renders "No routing attribution has been recorded in the covered window — nothing to show yet." with no zeroes. Test "R5: an empty dataset states that nothing has been recorded, not zero activity" asserts `[data-routing-empty]` present, `[data-routing-table]` absent — passed this run. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Routing is visible on the Board | MET | test | apps/web/tests/modules/observability/routing-tab.test.tsx R1 test — per-pair runs/escalations, pinned vs resolved vs default badges, null-role row. 11 pass / 0 fail this run. |
| Scenario: R2 — Token totals render beside the routing they belong to | MET | test | apps/web/tests/modules/observability/routing-tab.test.tsx R2 test — 4 token labels + values, surface matches no `/\$|usd|price|cost/i`. Passed this run. |
| Scenario: R3 — Unmeasured and estimated states render as themselves | MET | test | apps/web/tests/modules/observability/routing-tab.test.tsx R3 + R4 tests — unmeasured card carries no figures; exact/estimated separate, never folded. Passed this run. |
| Scenario: R4 — An empty dataset reads as empty, not as zero activity | MET | test | apps/web/tests/modules/observability/routing-tab.test.tsx R5 test — `[data-routing-empty]` shown, no routing table, no zero rows. Passed this run. |

**SECUA Review (focus: all)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No open findings. Both P4 advisories from the prior review were repaired in the 2026-08-15 re-audit fix pass: dead `onTokenSpec` option removed from `mountWithRoutingStubs` (apps/server/tests/modules/observability/index.test.ts); R1 substring count assertions replaced with exact per-row per-cell equality (apps/web/tests/modules/observability/routing-tab.test.tsx). Both suites re-run green after the repair (11/11 web, 16/16 server). |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
- Re-run evidence (this turn): `bun test apps/server/tests/modules/observability/index.test.ts` → 16 pass / 0 fail; `bun test apps/web/tests/modules/observability/routing-tab.test.tsx` → 11 pass / 0 fail; `spur task check 0552 --strict-core` → pass.
- Verdict artifact: `.spur/run/0552-verdict.json` (gitignored; written by the 2026-08-15 re-audit, fix pass flipped 5 R checkboxes in Requirements).
### Review
**Verdict: PASS — no blocking findings.** All five requirements and the acceptance criteria trace to
code with passing tests. Reviewed against the 0552-scoped diff only (server handler + server tests,
`RoutingTab.tsx` + web tests, `tabs.ts` registration, `docs/04_DESIGN.md` §7.9); concurrent 0539/0540
in-flight edits were not assessed.

**Requirement traceability**

- **R1** — `GET /api/observability/routing-summary` (`apps/server/src/modules/observability/index.ts:212-236`)
  forwards `since`/`until` to the 0546 domain surface (`dao.routingSummary`) and adds no query and no
  window logic of its own. `RoutingTab` renders per-pair runs/escalations with selection sources kept
  distinct (`sourceLabel`: `explicit`→*pinned*, `role`→*resolved*, `default`→*default*, `null`→`—`).
  Web test "R1: renders per-pair run and escalation counts, pinned separated from resolved" asserts the
  4/2/3/1 counts, the pinned/resolved/default badges, and the null-role row separately.
- **R2** — Per-role input / cache-read / cache-write / output totals render via `TokenBucketRow`
  (`RoutingTab.tsx:176-199`). The wire DTOs (`TokenTotals`, `RoleAttribution`) carry no currency
  field; `formatTokenCount` is a plain `Intl.NumberFormat` grouping. Both the server envelope test
  (`/costUsd|cost_usd|price|\$|usd/i`) and the web surface test (`/\$|usd|price|cost/i`) assert
  absence — matching the permanent exclusion, not a deferral.
- **R3** — `RoleTokenCard` (`RoutingTab.tsx:211-226`) renders `unmeasured` as a labelled state
  ("unmeasured — no token data recorded… not a measured zero") with no token figures, while a
  measured-zero role renders `0`. Test exercises both states in one dataset (ghost vs empty-role).
- **R4** — exact and estimated buckets render as separate labelled rows (success vs warning badge),
  never summed. Test asserts both buckets visible and no folded figure (`1,300` absent).
- **R5** — a both-empty envelope renders the explicit "No routing attribution has been recorded…"
  state with no zeroes; test asserts no `[data-routing-table]` and no `0 runs|0 escalations`.
- **Cross-task contract** — consumes 0546/0547 as-is through the existing fetch client; no new
  module (tab appended to `OBSERVABILITY_TABS` per its data-driven append contract); no currency
  field in any wire shape; `docs/04_DESIGN.md` §7.9 updated in the same change set (T3).

**Findings**

| Priority | Finding | File:Line | Disposition |
| --- | --- | --- | --- |
| P4 | `mountWithRoutingStubs` declares `opts.onTokenSpec` but never wires it; token-spec capture happens inside the `setRoleTokenSummaryForTesting` stub closure instead | `apps/server/tests/modules/observability/index.test.ts:344` | Accepted — dead option in a test helper; remove or wire on next touch |
| P4 | R1 table count assertions are substring-based (`toContain('4')`…) and could cross-match other digits | `apps/web/tests/modules/observability/routing-tab.test.tsx` | Accepted — row-count (`rows.length === 4`) and `rows[3]` assertions are the real guard; tighten if the fixture dataset grows |

**Residual risk**

- The surface trusts the `unmeasured` boolean from 0547 rather than re-deriving from bucket presence.
  Today 0547 guarantees `unmeasured = exact === null && estimated === null`
  (`packages/domain/src/analytics/role-tokens.ts:166`), so a `unmeasured:false`-with-null-buckets
  state cannot occur. If that fold ever changes, the card would render an empty bucket area — add a
  defensive branch if 0547's invariant relaxes.
- The route composes with `Promise.all`: a failure in either domain surface 500s the whole envelope
  rather than returning partial data. Honest choice, matches the sibling handlers, and the cause is
  surfaced in the `{ error }` body.

**Disposition: APPROVE.**
### References
- **Data sources to consume (add no query):** task 0546 (role-to-executor aggregate), task 0547
  (token totals per role, with unmeasured and estimated states)
- **State distinctions to preserve:** task 0547 R3 (unmeasured ≠ zero; never-fabricate invariant at
  `packages/domain/src/analytics/run-cost.ts:240`), task 0547 R4 (estimated ≠ exact)
- **Pricing boundary (R2):** feature J6 § *Tokens, not prices* — permanent exclusion, operator ruling
  2026-08-13
- **Surfaces to extend, not duplicate:** feature J4 (Board observability and Teams supervisor
  surfaces, done); feature M3 (Teams board UX, verifying)
- **UI SSOT:** root `DESIGN.md` when present (CLAUDE.md § *Design system*); web app under `apps/web/`
  with the typed oRPC client
- **Upstream dependency:** feature J6 tasks 0546 and 0547 must be done first
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-15T15:35:54.077Z todo → wip (system)
- 2026-08-15T15:46:44.731Z wip → testing (system)
- 2026-08-15T15:46:54.786Z testing → done (system)
