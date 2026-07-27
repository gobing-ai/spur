---
schema_version: 1
id: "F81"
name: "Board Features detail action group: lifecycle ops, async runner, observability"
status: done
priority: P1
tags: []
created_at: "2026-07-27T17:48:29.352Z"
updated_at: "2026-07-27T22:05:43.891Z"
---

# F81: Board Features detail action group: lifecycle ops, async runner, observability

## Goal
A Board-shippable design for the Spur Board **Features** module detail-panel dynamic action group: complete per-feature lifecycle operation catalog mapped onto UI, async-by-default action handling with a unified runner, confirmation for destructive/expensive ops, and observable status/feedback for the end user.
## Scope
- In:
  - Features detail page dynamic button group (IA, labels, status-gated visibility, style/usability)
  - Catalog of operations applicable to a single feature (CLI/oRPC/FeatureService inventory as the Board's contract)
  - Unified async-by-default action dispatch from the button group
  - Confirmation policy for destructive or long-running ops
  - Observability of action lifecycle (queued → running → success/fail) and user feedback
- Out: see **## Out of scope** on the map (in Notes)
## Acceptance Criteria
```gherkin
Feature: Board Features detail action group: lifecycle ops, async runner, observability

  Scenario: Inventory covers all surfaces
    Given CLI, oRPC, FeatureService, and Board action maps
    When research ticket 0349 is resolved
    Then Solution lists each operator-facing op with status/slow/CLI/oRPC/service/Board coverage

  Scenario: Gaps are explicit
    Given half-wired paths exist
    When the inventory is recorded
    Then R3 lists those gaps with path:line evidence for ticket 0351

  Scenario: FeatureDetail dispatch paths documented
    Given FeatureDetail action handlers
    When 0350 is resolved
    Then Solution documents dispatch, loading, and modal paths with anchors

  Scenario: Job-queue pattern documented
    Given TaskService fulfillAction and queue events
    When 0350 is resolved
    Then Solution documents the job-queue pattern Board Features can reuse

  Scenario: Teams confirm patterns documented
    Given Teams Terminal confirm modals
    When 0350 is resolved
    Then Solution documents soft/hard confirm patterns

  Scenario: SSE surfaces documented
    Given FeaturesShell SSE and planning events
    When 0350 is resolved
    Then Solution documents feature.* SSE surfaces and gaps for queue.*

  Scenario: Inventory scope respected
    Given 0350 is inventory-only
    When the ticket closes
    Then decisions for runner/confirm/observability are deferred to 0352-0354

  Scenario: Per-status matrix produced
    Given 0349 inventory
    When 0351 is resolved
    Then Solution holds primary/overflow/never per status for retained ops

  Scenario: Required ops placed
    Given the membership matrix
    When 0351 is resolved
    Then required lifecycle ops are placed with one-line reasons

  Scenario: Newly discovered ops covered
    Given 0349-discovered ops not in the original R2 list
    When 0351 is resolved
    Then a default placement rule covers them

  Scenario: Scope respected — no UI, no async/confirm detail
    Given 0351 is a decision ticket
    When it closes
    Then no UI is shipped and async/confirm detail stays deferred

  Scenario: Runner model decided
    Given 0350 inventory
    When 0352 is resolved
    Then Option A (job-queue extension) is named with rationale

  Scenario: Request/response contract defined
    Given the runner model
    When 0352 is resolved
    Then FeatureActionResponse and done-semantics are specified

  Scenario: Synchronous exceptions bounded
    Given async-by-default
    When 0352 is resolved
    Then exactly one sync exception (check) is named

  Scenario: Reuse boundary stated
    Given TaskService fulfillAction
    When 0352 is resolved
    Then FeatureService mirrors without extending TaskService

  Scenario: Decision only — no implementation
    Given 0352 is a decision ticket
    When it closes
    Then no production code is shipped by this ticket

  Scenario: Confirm level per op decided
    Given 0351 membership
    When 0353 is resolved
    Then none/soft/hard is assigned per retained op

  Scenario: Destructive-op copy specified
    Given hard-confirm ops
    When 0353 is resolved
    Then risk copy, typed gates, and button labels are specified

  Scenario: Async interaction pinned
    Given 0352 runner
    When 0353 is resolved
    Then confirm-before-enqueue is the only legal order

  Scenario: Decision only — depends on 0351 and 0352
    Given 0353 is a decision ticket
    When it closes
    Then no UI is shipped

  Scenario: Observable lifecycle states defined
    Given the async runner model
    When 0354 is resolved
    Then six lifecycle states map to storage and UI surfaces

  Scenario: User-facing feedback surfaces chosen
    Given Board chrome
    When 0354 is resolved
    Then the minimum-viable feedback set is named

  Scenario: Correlation id propagation defined
    Given runId/job id
    When 0354 is resolved
    Then click→UI correlation is specified

  Scenario: Failure surfacing defined
    Given recoverable and terminal failures
    When 0354 is resolved
    Then surfacing rules are specified

  Scenario: Decision only — depends on 0352
    Given 0354 is a decision ticket
    When it closes
    Then no production code is shipped by this ticket

  Scenario: Prototype artifact produced
    Given membership and confirm decisions
    When 0355 is resolved
    Then Solution holds a prototype covering primary/overflow/confirm/in-flight/empty/done/cancelled

  Scenario: Usability concerns addressed
    Given narrow detail panel constraints
    When 0355 is resolved
    Then grouping, priority, truncation, and keyboard reachability are addressed

  Scenario: Prototype only — not production
    Given 0355 is a prototype ticket
    When it closes
    Then no production UI is shipped

  Scenario: Dependency assumptions stated
    Given 0351-0354 inputs
    When 0355 is resolved
    Then dependency assumptions are explicit
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0349 | Inventory feature lifecycle operations across CLI, oRPC, FeatureService, and Board action map | done |
| 0350 | Inventory Board action-runner patterns (FeatureDetail, TaskDetail jobs, Teams confirm, SSE) | done |
| 0351 | Decide which operations belong on the Features detail action group per status | done |
| 0352 | Decide the unified async action-runner model for Features detail actions | done |
| 0353 | Decide the confirmation matrix for Features detail actions | done |
| 0354 | Decide the observability contract for Features detail action lifecycle | done |
| 0355 | Prototype Features detail action-group IA and visual hierarchy | done |
<!-- END AUTO-GENERATED -->

## Notes
**Destination (map)**

A Board-shippable design for the Spur Board **Features** module detail-panel dynamic action group: complete per-feature lifecycle operation catalog mapped onto UI, async-by-default action handling with a unified runner, confirmation for destructive/expensive ops, and observable status/feedback for the end user.

Pinned 2026-07-27: destination kind = **Board shippable design** (CLI/API only as contract inventory, not a full CLI redesign).

**Domain context (grounded scan)**

- **UI SSOT today:** `apps/web/src/modules/features/feature-actions.ts` — `FEATURE_STATUS_ACTIONS` / labels / FSM vs agent vs create vs link.
- **Detail panel:** `apps/web/src/modules/features/FeatureDetail.tsx` — `handleAction` + per-action loaders (`actionLoading`); cancel has a modal; sync/brainstorm/plan use channel/direction modal; other FSM transitions fire immediately and block the clicked button until the request returns.
- **oRPC already exposes:** list, show, create, transition, refresh, check, body, action (brainstorm/plan), children, tasks, link, **sync** (`pull`|`push`).
- **CLI feature verbs:** create, show, update, advance, list, move, refresh, check, **sync**.
- **Service:** `FeatureService` — transition, refresh, deriveFeatureStatus, syncFeature, syncAllFeatures, move, …
- **Parallel Board pattern:** Task detail uses a similar action group; task side already has **async job enqueue** (`TaskService.fulfillAction` / queue events). Feature path does not yet share that runner.
- **Confirm pattern elsewhere:** Teams Terminal stop/down confirm modals.

**Skills every session should consult**

- `sp:spur-cli` features reference (verb truth)
- `sp:spur-dev` decision-brief format for HITL
- Board Features module + `packages/contracts/src/feature.ts` + `FeatureService`
- When designing async: task board job/queue path as the existing precedent

**Standing preferences (operator)**

- Default action behavior: **asynchronous** for time-consuming ops; UI must not block
- Important ops need a **confirmation step**
- Sync/scan-style force re-derive of feature status from tasks is in scope as an example of missing lifecycle UX
- Enhance button **style and usability** in the same effort

**Decisions so far**

- Destination kind: Board-shippable design for Features detail action group (not full cross-surface product redesign; not design-doc-only).

- [0349 Inventory feature lifecycle operations across CLI, oRPC, FeatureService, and Board action map](../tasks3/0349_inventory-feature-lifecycle-operations-across-cli-orpc-featu.md) — Full ops matrix + Board gaps: action endpoint stub, push-sync throws (UI defaults push), check API/client with no button, advance/move CLI-only, refresh API-only.

**Not yet specified**

- Whether `advance`, `move`, `refresh` (index), `check`, and body-edit stay off the action group, overflow-only, or primary.
- Default sync direction (`pull` vs `push`) and whether both remain user-visible every time.
- Shared abstraction with Task detail action group now vs Features-only first, extract later.
- Exact visual language (icon+label vs label-only; overflow menu vs wrap; destructive styling).
- Correlation of agent-backed actions (brainstorm/plan) to Board feedback when jobs complete after the user navigated away.
- Accessibility requirements for the action group (keyboard, focus trap on confirm, live regions).
- Whether confirmation is modal-only or also supports "don't ask again this session".

**Out of scope**

- Full CLI verb redesign or new feature lifecycle statuses
- Multi-select / bulk ops across many features on the tree
- Task Kanban action-group redesign as a required deliverable (shared runner may be noted as follow-on)
- Replacing SSE/system-event infrastructure wholesale
- Server-side scheduler product work beyond reusing existing job queue patterns
## History

- 2026-07-27T18:09:00.613Z moved S → F81 (system)
- 2026-07-27T22:01:07.734Z backlog → active (system)
- 2026-07-27T22:01:07.954Z active → verifying (system)
- 2026-07-27T22:05:43.891Z verifying → done (system)
