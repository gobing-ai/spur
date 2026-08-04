---
schema_version: 1
id: "J3"
name: "Observability data plane: event ingestion, retention, correlation, and run/team read APIs"
status: verifying
priority: P2
tags: []
created_at: "2026-07-29T00:09:27.959Z"
updated_at: "2026-08-02T18:29:32.199Z"
---

# J3: Observability data plane: event ingestion, retention, correlation, and run/team read APIs

## Goal
Make the observability data plane actually carry signal, so every Board surface built on top of it
has something worth rendering.

Today the `system_events` ledger is 89.8% self-observation noise (`queue.job.enqueued` +
`queue.job.completed` + `scheduler.job.executed` = 8,958 of 10,000 rows, one triple per minute from
the prune job), holds **zero** `workflow.*`, `agent.*`, `rule.*` or `api.*` rows despite 390 recorded
workflow runs and 501 action runs in the same database, exposes no correlation columns, and supports
only exact-`name` + `since` + `limit` queries — so every Board filter is client-side sifting over a
fixed 100-row window that is statistically all heartbeat.

This feature fixes ingestion, retention, correlation, and read APIs. It ships no Board UI; J4 owns
that. Success is measured on the data plane alone: a workflow run driven from the CLI is visible and
correlatable through the API within seconds, task/feature/process/team signal survives a week of
queue chatter, and a focused query costs one indexed round trip instead of a 100-row client filter.
## Scope
**In scope:**

1. **Event tiering and retention.** Demote the self-observation heartbeat triple
   (`queue.job.enqueued`, `queue.job.completed`, `scheduler.job.executed`) emitted by the internal
   prune job to the `diagnostic` tier, and replace `SystemEventDao.prune(cap)`'s single flat 10,000-row
   cap with per-prefix retention quotas so a high-volume producer can never evict low-volume signal.
   Quotas are configuration, not constants.

2. **Correlation columns.** Extend `system_events` with indexed `run_id`, `entity_kind`, `entity_id`,
   and `sequence` columns via a new `_spur_cli_` migration; populate them in the tap and the CLI
   emitter from the 0365 envelope fields. Existing rows migrate with NULLs and must keep rendering.

3. **Catalog the 0365 observability contract.** Register the envelope events task 0365 built but never
   cataloged — including `workflow.agent` (the unified `AgentExecutionEvent` lifecycle: `started`,
   `output`, `heartbeat`, `dropped`, `finished`) and `workflow.steering` (`SteeringAck`) — with
   renderers, tiers, and payload policies. Extend `normalizeSystemEventPayload` so it preserves the
   0365 envelope's correlation and metadata fields instead of shallow-copying and blanking a fixed
   key list.

4. **Close the CLI→Board gap for workflow and agent events.** Extend the proven task-0249 pattern
   (`SystemEventEmitter` → `SystemEventDao`, already used for `task.*`/`feature.*`) to the cataloged
   `workflow.*` and `agent.*` families, so runs driven from `spur workflow run` / `sp:dev-*` are
   visible on the Board. Redaction and payload bounds from 0365 apply before any write.

5. **`team.*` event family.** Author and emit the missing team lifecycle events — team up/down,
   member assignment, and member state changes — that `ActivityTab.tsx:72` already filters for and
   that have never fired. Payload carries `teamId`, `memberId`, `agentType`, and outcome.

6. **Server-side query surface.** Add `prefix`, `names`, `runId`, `actor`, and cursor pagination to
   `GET /api/events/history` and to `SystemEventDao.query`, backed by the new indexes.

7. **Run store read API.** Add a `GET /api/runs` surface over `runs` / `phase_runs` / `action_runs` /
   `transition_runs` / `task_run_links`, including per-run detail and a WBS→runs lookup, so a task's
   pipeline progress and action log are readable without touching the event ledger.

**Out of scope:**

- All Board UI — module ordering, tab redesign, new tabviews (feature J4).
- Server-side ingestion of `.spur/runs/workflow/*.jsonl` trace files (evaluated and declined in
  favour of the direct-DAO write path; the JSONL trace remains the CLI-side replay artifact).
- Cross-process steering control channel — remains design-only per task 0365 R12 and
  `docs/design/workflow-steering-control-channel.md`.
- Nested-CLI child-of-child event bridging (a child agent spawning its own agent) — remains the
  deferred scope limit recorded in `docs/inventory/system-events-producer-audit.md`.
- Changes to `@gobing-ai/ts-*` packages; this feature consumes the released 0.4.14 catalog as-is.
## Acceptance Criteria
```gherkin
Feature: Observability data plane

  # ── Tiering and retention ──────────────────────────────────────────────────

  @core
  Scenario: R1 — The self-observation heartbeat leaves the default tier
    Given the internal prune job runs on its schedule
    When it emits queue.job.enqueued, queue.job.completed, and scheduler.job.executed
    Then those three catalog entries carry tier "diagnostic"
    And they are neither persisted nor streamed while the diagnostic toggle is off
    And they are persisted and streamed when the diagnostic toggle is on

  @core
  Scenario: R2 — Per-prefix retention protects low-volume signal from high-volume noise
    Given the ledger holds rows for a high-volume prefix and a low-volume prefix
    And the high-volume prefix has exceeded its configured quota
    When retention is applied
    Then the oldest rows of the high-volume prefix are deleted down to its quota
    And no row of the low-volume prefix is deleted while it is under its own quota

  @core
  Scenario: R3 — Retention quotas are configuration, not compiled constants
    Given a project sets a per-prefix retention quota in its configuration
    When the server boots and applies retention
    Then the configured quota is used for that prefix
    And a prefix with no configured quota falls back to a documented default

  @edge
  Scenario: R4 — Retention degrades safely on an unmigrated ledger
    Given the system_events table is absent or predates the correlation migration
    When retention runs
    Then no error is thrown to the caller
    And the failure is logged

  # ── Correlation columns ────────────────────────────────────────────────────

  @core
  Scenario: R5 — Correlated events persist their identity in queryable columns
    Given a workflow event carrying runId, actionId, and sequence in its 0365 envelope
    When the event is persisted
    Then the row's run_id column holds the envelope's runId
    And the row's sequence column holds the envelope's sequence
    And the payload retains the full envelope

  @core
  Scenario: R6 — Planning events persist their entity identity
    Given a task.transitioned event for WBS 0365
    When the event is persisted
    Then the row's entity_kind is "task" and entity_id is "0365"

  @edge
  Scenario: R7 — Pre-migration rows remain readable
    Given rows written before the correlation migration have NULL correlation columns
    When the history endpoint returns them
    Then each row is returned with null correlation fields and its original payload
    And no row is dropped or rejected

  # ── Cataloging the 0365 contract ───────────────────────────────────────────

  @core
  Scenario: R8 — The unified agent lifecycle is a cataloged, observable event
    Given an agent execution emits started, output, heartbeat, dropped, and finished events
    When those events reach the tap
    Then a catalog entry exists for the agent lifecycle event with a renderer and a payload policy
    And each persisted row preserves kind, executionId, runId, and sequence

  @core
  Scenario: R9 — Steering acknowledgements are observable
    Given a steering command is acknowledged or rejected on an active run
    When the acknowledgement is emitted
    Then a cataloged steering event is persisted carrying the operation, the target, and the outcome

  @core
  Scenario: R10 — Envelope enrichment survives payload normalization
    Given a 0365 envelope carrying schemaVersion, eventId, sequence, runId, actionId, node, kind, and metadata
    When the payload is normalized for persistence
    Then every one of those fields is present in the normalized payload
    And no field is silently dropped by the normalizer

  @core
  Scenario: R11 — Secrets never reach the ledger
    Given an event payload contains a configured secret value
    When the event is normalized and persisted
    Then the persisted payload contains no occurrence of that secret
    And truncation of the payload cannot reveal the removed material

  # ── CLI to Board bridge ────────────────────────────────────────────────────

  @core
  Scenario: R12 — A CLI-driven workflow run becomes visible on the data plane
    Given the server is running and a workflow is executed from the CLI in a separate process
    When the run starts, transitions, executes an action, and finalizes
    Then the corresponding workflow events are readable from the history endpoint
    And each carries the run id that correlates it to the runs table

  @core
  Scenario: R13 — Agent lifecycle from a CLI run is correlated, not double-counted
    Given a CLI workflow run dispatches an agent.run action
    When the agent lifecycle events are persisted
    Then they carry the same run id as their parent workflow run
    And a nested execution produces exactly one lifecycle series, not two

  @edge
  Scenario: R14 — A ledger write failure never breaks the CLI run
    Given the system_events write will fail
    When a CLI workflow run emits an observability event
    Then the workflow run continues and completes normally
    And the persistence error is logged, not thrown

  # ── team.* event family ────────────────────────────────────────────────────

  @core
  Scenario: R15 — Team lifecycle transitions emit cataloged events
    Given a team is brought up and later brought down
    When each operation completes
    Then a cataloged team lifecycle event is persisted for each
    And the payload carries the team id and the resulting member set size

  @core
  Scenario: R16 — Member state changes are attributable to a team and an agent type
    Given a team member starts, stops, or is assigned work
    When the corresponding event is persisted
    Then the payload carries teamId, memberId, and agentType
    And the row's actor resolves to the member identity

  @edge
  Scenario: R17 — A team event for an unknown member still persists
    Given a member id that is absent from the current roster
    When a team event referencing it is emitted
    Then the event is persisted with the ids it has
    And the unresolved fields are null rather than the event being dropped

  # ── Server-side query surface ──────────────────────────────────────────────

  @core
  Scenario: R18 — History can be filtered by prefix server-side
    Given the ledger holds events across several prefixes
    When the history endpoint is queried for a single prefix
    Then only events of that prefix are returned
    And the result set is not limited to what a client-side filter over the newest rows would find

  @core
  Scenario: R19 — History can be filtered by run and by actor
    Given the ledger holds events for several runs and actors
    When the history endpoint is queried by run id, and separately by actor
    Then each query returns only the matching events, newest first

  @core
  Scenario: R20 — History pagination is stable under concurrent writes
    Given the operator pages through history with a cursor
    When new events are written between two page requests
    Then no already-returned event is repeated on the next page
    And no event older than the cursor is skipped

  @edge
  Scenario: R21 — An unknown prefix or malformed cursor is rejected cleanly
    Given a query naming a prefix that is not in the catalog, or a malformed cursor
    When the history endpoint handles it
    Then it responds with a client error and a reason
    And it does not return an unfiltered result set

  # ── Run store read API ─────────────────────────────────────────────────────

  @core
  Scenario: R22 — Runs are listable with their status and workflow
    Given the run store holds workflow runs
    When the runs endpoint is queried
    Then each entry carries its run id, workflow name, status, start time, and completion time

  @core
  Scenario: R23 — A run's phases, transitions, and actions are readable as one detail view
    Given a run with recorded phases, transitions, and actions
    When that run's detail is requested
    Then the response carries the ordered phases with status, the transitions, and the actions
    And each action carries its node, kind, status, duration, and success flag

  @core
  Scenario: R24 — A task's runs are reachable by WBS
    Given task_run_links associates a WBS with one or more runs
    When the runs for that WBS are requested
    Then every linked run is returned with its link kind
    And a WBS with no links returns an empty list rather than an error

  @edge
  Scenario: R25 — Run detail for an unknown run id is a clean not-found
    Given a run id that does not exist
    When its detail is requested
    Then the response is a not-found with a reason
    And no partial or fabricated run object is returned
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0367 | Catalog the 0365 observability envelope contract and preserve it through payload normalization | done |
| 0368 | Demote the self-observation heartbeat to diagnostic tier and replace the flat ledger cap with per-prefix retention quotas | done |
| 0369 | Add indexed correlation columns to system_events and populate them from the event envelope | done |
| 0370 | Bridge CLI-process workflow and agent events into the ledger via the task-0249 direct-DAO pattern | done |
| 0371 | Author and emit the team.* event family for team and member lifecycle | done |
| 0372 | Add server-side filtering and cursor pagination to the event history query surface | done |
| 0373 | Expose the workflow run store as a read API for run digest, phase progress, and action log | done |
| 0414 | Stream agent subprocess output during pipeline runs via the unused onOutput hook | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-29T03:47:01.587Z backlog → active (system)
- 2026-08-02T18:29:32.199Z active → verifying (system)
