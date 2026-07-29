---
schema_version: 1
id: "J4"
name: "Board observability and Teams supervisor surfaces"
status: backlog
priority: P2
tags: []
created_at: "2026-07-29T00:09:34.646Z"
updated_at: "2026-07-29T00:12:18.602Z"
---

# J4: Board observability and Teams supervisor surfaces

## Goal
Turn the Board's observability surfaces from a raw event firehose into views an operator reads to
answer a question: what is my system doing, what are my jobs doing, what is this task's pipeline
doing, and what are my teams doing.

Four moves: promote Observability to the Board's first module; enrich the System Events tabview so
each row carries the identity and outcome fields the J3 envelopes now supply; replace the Jobs
tabview's accidental client-side slice with a purpose-built queue/scheduler view; add a Tasks
tabview backed by the run store that shows pipeline digest, phase progress, and the action log that
`Tasks` module detail has never had; and add a Supervisor tabview as the Teams module's first and
default tab, built on the `team.*` events J3 introduces.

This feature depends on J3 for its data. It ships no ingestion, retention, schema, or emitter work.
## Scope
**In scope:**

1. **Module ordering.** Add an optional explicit ordering key to the `WebModule` contract
   (`apps/web/src/modules/types.ts`) and honour it in discovery, which today sorts alphabetically by
   directory id (`discover.ts:73`) and therefore lands Features first. Observability becomes the
   first module and the default landing route; modules without the key keep their current relative
   order.

2. **System Events tabview enrichment.** Move filtering from client-side sifting to the J3
   server-side query params (`prefix`, `names`, `runId`, `actor`, cursor). Surface the correlation
   and outcome fields the J3 envelopes now carry — run, action, node, sequence, duration, outcome,
   and explicit `unavailable` usage — in the row and its detail, replacing the current hover-only
   4-pair tooltip with a persistent detail affordance. Keep the existing prefix/tier/window/search
   controls and the SSE liveness strip.

3. **Jobs tabview redesign.** Rebuild as a purpose-built queue/scheduler view over a server-side
   filtered query rather than `JobsTab.tsx:114`'s client-side slice of the newest 50 events. Job
   identity, state, attempt/retry, duration, and failure reason become first-class columns; the
   existing four stat cards stay.

4. **Tasks tabview (new).** A run-store-backed tabview under Observability showing, per pipeline run:
   the task WBS it is linked to, workflow name, status, ordered phase progress, transitions, and the
   per-action log with node, kind, status, and duration. Backed by the J3 `GET /api/runs` surface.
   A secondary lane shows `task.*` / `feature.*` corpus events for work that never went through a run.

5. **Teams Supervisor tabview (new).** A first-position, default-active tab in the Teams module
   (`apps/web/src/modules/teams/tabs.ts`) giving a per-team, per-member operational view built on the
   `team.*` family J3 introduces plus the existing `agent.*` / `process.*` / `message.*` events and
   the live `GET /api/team/teams` roster: member state, uptime, last activity, and the team-level
   controls that exist today.

**Out of scope:**

- Every J3 concern: catalog entries, tiering, retention, correlation columns, the CLI→Board emitter
  bridge, `team.*` emission, and the `/api/events/history` + `/api/runs` server surfaces. J4 consumes
  them; it does not build them.
- New team mutation controls beyond what the Teams module already exposes (start/stop/up/down).
  Supervisor is an observation surface plus existing controls.
- Retiring or restructuring the existing Teams tabs (Terminal, Process, Message, Activity) — the
  Activity tab's overlap with Supervisor is noted for a follow-up, not resolved here.
- Tool Using tabview changes.
- Cross-process steering controls from the Board — task 0365 R12 keeps that design-only.
## Acceptance Criteria
```gherkin
Feature: Board observability and Teams supervisor surfaces

  # ── Module ordering ────────────────────────────────────────────────────────

  @core
  Scenario: R1 — Observability is the Board's first module and default landing route
    Given the board module registry is built from discovery
    When the enabled module list is read
    Then Observability is first
    And the default landing route resolves to Observability

  @core
  Scenario: R2 — Explicit ordering is declarative and partial
    Given some modules declare an explicit order and others do not
    When discovery orders them
    Then modules with an explicit order appear in that order
    And modules without one keep their existing relative order after them
    And the registry's duplicate id and route validation still applies

  # ── System Events tabview ──────────────────────────────────────────────────

  @core
  Scenario: R3 — Filtering is applied server-side, not over a fixed client window
    Given the ledger holds far more events than one page
    When the operator filters System Events by prefix
    Then the rows shown come from a server-side filtered query
    And matching events older than the newest unfiltered page are still reachable

  @core
  Scenario: R4 — A correlated event row surfaces its identity and outcome
    Given a workflow or agent event carrying run, action, node, sequence, duration, and outcome
    When its row is rendered
    Then the run and action identity are visible on the row
    And the duration and outcome are visible without hovering

  @core
  Scenario: R5 — Absent usage is shown as unavailable, never as zero
    Given an event whose usage is explicitly unavailable
    When its detail is rendered
    Then the usage is presented as unavailable
    And no fabricated zero value is shown

  @core
  Scenario: R6 — Event detail is inspectable without hover
    Given an event row with a correlated payload
    When the operator opens its detail
    Then the full redacted envelope is readable
    And the detail stays open until dismissed

  @core
  Scenario: R7 — The live tail and the liveness strip keep working under the new query path
    Given the System Events tabview is mounted with a filter active
    When new matching events arrive over the stream
    Then they appear at the top of the list
    And the connection status and rolling event rate continue to update

  @edge
  Scenario: R8 — A malformed row or frame never breaks the tabview
    Given the server returns a row or pushes a frame that fails schema validation
    When the tabview processes it
    Then the offending item is dropped
    And the remaining rows continue to render

  # ── Jobs tabview ───────────────────────────────────────────────────────────

  @core
  Scenario: R9 — Job events come from a server-side filtered query
    Given the ledger holds job events older than the newest hundred events overall
    When the Jobs tabview loads
    Then it requests only queue and scheduler events
    And it shows job events that a client-side slice of the newest events would have missed

  @core
  Scenario: R10 — A job row surfaces identity, state, timing, and failure reason
    Given a queue job that was enqueued, retried, and finally failed
    When its rows are rendered
    Then the job id and job type are shown
    And the state, attempt count, and duration are shown
    And the failure reason is shown on the failing row

  @core
  Scenario: R11 — Queue counters remain visible alongside the event view
    Given the job stats endpoint reports pending, processing, completed, and failed counts
    When the Jobs tabview renders
    Then all four counters are shown
    And they are distinguishable from the event list

  @edge
  Scenario: R12 — An empty job history renders an explicit empty state
    Given no queue or scheduler events match
    When the Jobs tabview renders
    Then it shows an explicit empty state
    And it does not show a perpetual loading indicator

  # ── Tasks tabview ──────────────────────────────────────────────────────────

  @core
  Scenario: R13 — Pipeline runs are listed with their task and status
    Given the run store holds pipeline runs linked to task WBS numbers
    When the Tasks tabview loads
    Then each run shows its linked WBS, workflow name, status, and start time
    And runs with no task link are still listed

  @core
  Scenario: R14 — A run expands into phase progress
    Given a selected run with recorded phases
    When its digest is opened
    Then the phases are shown in execution order with their status
    And the currently active phase is distinguishable from completed and failed ones

  @core
  Scenario: R15 — A run's action log is readable
    Given a run whose actions include an agent dispatch and a shell step
    When the action log is opened
    Then each action shows its node, kind, status, and duration
    And a failed action shows its reason

  @core
  Scenario: R16 — Corpus-only task activity is not lost
    Given a task status change made through the CLI with no associated run
    When the Tasks tabview renders
    Then that corpus event is visible in the secondary lane
    And it is distinguishable from run-backed activity

  @edge
  Scenario: R17 — A run whose detail is unavailable degrades gracefully
    Given a listed run whose detail request fails or returns not-found
    When the operator opens it
    Then an inline error is shown for that run
    And the rest of the list stays usable

  # ── Teams Supervisor tabview ───────────────────────────────────────────────

  @core
  Scenario: R18 — Supervisor is the Teams module's first and default-active tab
    Given the Teams module is opened with no prior tab selection
    When it renders
    Then Supervisor is the first tab and it is active
    And the existing Terminal, Process, Message, and Activity tabs remain reachable

  @core
  Scenario: R19 — Each team shows its members and their live state
    Given a team with running and stopped members
    When Supervisor renders
    Then each member shows its id, agent type, and current state
    And running members are visually distinguishable from stopped ones

  @core
  Scenario: R20 — Member rows surface uptime and last activity
    Given a running member with recent lifecycle and message events
    When its row is rendered
    Then its uptime since start is shown
    And the time and kind of its most recent activity are shown

  @core
  Scenario: R21 — Team lifecycle events drive the view
    Given a team is brought up and a member later stops
    When those events are emitted
    Then Supervisor reflects the new team and member state without a manual page reload

  @core
  Scenario: R22 — Existing team controls are available from Supervisor
    Given a team and its members
    When the operator uses the controls on the Supervisor tab
    Then start, stop, up, and down behave as they do on the existing Teams surfaces
    And the view refreshes after the mutation completes

  @edge
  Scenario: R23 — A team with no members renders an explicit empty state
    Given a configured team whose roster is empty
    When Supervisor renders it
    Then the team is listed with an explicit empty-roster state
    And it is not omitted from the view

  @edge
  Scenario: R24 — Supervisor degrades when the roster feed fails
    Given the team roster request fails
    When Supervisor renders
    Then an error is surfaced
    And any event-derived activity already loaded remains visible
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0374 | Add explicit module ordering to the board registry and promote Observability to first module | todo |
| 0375 | Rebuild the System Events tabview on server-side queries and surface the enriched envelope fields | todo |
| 0376 | Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query | todo |
| 0377 | Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log | todo |
| 0378 | Add the Supervisor tabview as the Teams module's first and default-active tab | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
