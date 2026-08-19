---
schema_version: 1
id: "J9"
name: "Event 5W1H payload and catalog remediation"
status: done
priority: P2
tags: []
created_at: "2026-08-19T05:34:32.237Z"
updated_at: "2026-08-19T19:46:06.540Z"
---

# J9: Event 5W1H payload and catalog remediation

## Goal
Make System Events diagnostic at a glance by giving every supported event a useful identity, event-specific summary, and truthful outcome across live, historical, table, and tooltip views.
## Scope
- In scope:
  - Title each event tooltip with the event name plus the best stable correlator, falling back to the persisted event-row ID, and move copy/pin guidance to a muted footer.
  - Replace generic source-family presentation with exhaustive event-specific server presenters that drive persisted events, SSE, history reads, the table, and tooltips consistently.
  - Give every cataloged event a meaningful OUTCOME when its payload supports one, with explicit unsupported handling instead of invented values.
  - Render task and feature transitions as `[task] {task-id} : {from-state} -> {to-state}` and `[feature] {feature-id} : {from-state} -> {to-state}`.
  - Carry the `--section <name>` mutation locus into `task.updated` and `feature.updated`, and include it in summaries as `[task] {section-name}` and `[feature] {section-name}`.
  - Carry a real upstream queue name into consumer lifecycle events and summarize them as `[queue] {queue-name}`.
  - Start every `workflow.*` summary with `[workflow]` and include human workflow and step identity plus meaningful result state where available.
  - Re-project derived presentation for stored canonical events on history reads without rewriting ledger rows, so existing task and feature transitions expose their stored `from`/`to` facts.
  - Preserve the canonical v2 envelope, per-event catalog declarations, authored descriptions, redaction/bounds, and a two-sided catalog-to-design coverage gate.
- Out of scope:
  - A new System Event envelope schema or transport contract.
  - UI-owned event semantics or duplicated client-side presenter switches.
  - Database rewrites or backfills of historical event rows.
  - Fabricating section names or queue names for historical rows that never stored those facts.
  - New CLI nouns, unrelated Board tabs, or refactors outside the System Events presentation and required producer contracts.
## Acceptance Criteria
```gherkin
Feature: Event 5W1H payload and catalog remediation

  @core
  Scenario: R1 — Tooltip title identifies the event and guidance is secondary
    Given a System Event tooltip opens for a persisted or live row
    When the tooltip header is rendered
    Then its title contains the event name and the best stable correlator
    And the persisted event-row ID is used when no more useful entity, run, execution, action, or job identifier exists
    And copy and pin guidance appears in a muted footer rather than as the title

  @core
  Scenario: R2 — Task transitions expose the status change already present in the event
    Given a `task.transitioned` event with task ID, `from`, and `to`
    When canonical presentation is built
    Then Summary is `[task] {task-id} : {from-state} -> {to-state}`
    And Outcome communicates the resulting task state
    And no separate task-status-update event is invented

  @core
  Scenario: R3 — Task section updates name what changed
    Given `spur task update <wbs> --section <name> --from-file <path>` succeeds
    When `task.updated` is emitted
    Then the planning payload carries the section name from the mutation descriptor
    And Summary includes `[task] {section-name}`
    And the bounded payload carries the after-value or a safe diff when supported

  @core
  Scenario: R4 — Feature section updates name what changed
    Given `spur feature update <id> --section <name> --from-file <path>` succeeds
    When `feature.updated` is emitted
    Then the planning payload carries the section name from the mutation descriptor
    And Summary includes `[feature] {section-name}`
    And the bounded payload carries the after-value or a safe diff when supported

  @core
  Scenario: R5 — Feature transitions expose their state change
    Given a `feature.transitioned` event with feature ID, `from`, and `to`
    When canonical presentation is built
    Then Summary is `[feature] {feature-id} : {from-state} -> {to-state}`
    And Outcome communicates the resulting feature state

  @core
  Scenario: R6 — Queue consumer lifecycle rows identify the queue and result
    Given a configured queue consumer emits `queue.consumer.started` or `queue.consumer.stopped`
    When its canonical presentation is built
    Then the upstream event payload carries the real queue name
    And Summary includes `[queue] {queue-name}`
    And Outcome reports `running` for a successful start or the truthful drained/timeout result for a stop

  @core
  Scenario: R7 — Every workflow event uses readable workflow semantics
    Given any cataloged `workflow.*` event
    When canonical presentation is built
    Then Summary begins with `[workflow]`
    And it includes `workflowName` plus `nodeLabel` or `kind` where the payload supports step identity
    And raw run, node, and action UUIDs are not the primary summary text
    And Outcome is derived from the event's actual result, status, error, or transition semantics when meaningful

  @core
  Scenario: R8 — Outcome coverage is exhaustive and truthful
    Given the complete System Event catalog
    When event-specific presenters are validated
    Then every event name has an explicit outcome derivation or an explicit unsupported classification
    And a derived Outcome uses only facts present in the bounded producer payload
    And events without a meaningful outcome do not receive a fabricated value

  @core
  Scenario: R9 — Live and historical rows share the current presentation semantics
    Given a raw event, a newly persisted canonical v2 event, or an existing canonical v2 history row
    When it is streamed or read through the System Events API
    Then the same exhaustive server presenter determines Summary, Outcome, fields, and description
    And existing rows are re-projected from their bounded stored data without rewriting the ledger
    And the canonical v2 envelope shape, redaction, and payload bounds remain unchanged

  @core
  Scenario: R10 — Catalog semantics cannot drift silently
    Given `SYSTEM_EVENT_CATALOG` and `docs/design/event-tracking.md`
    When the two-sided semantic coverage gate runs
    Then each event declares event-specific metadata fields, an authored description, summary behavior, and outcome support
    And every design-matrix event resolves to a live catalog name and every catalog name has a design-matrix row
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0601 | Implement exhaustive System Event presenters and history reprojection | done |
| 0602 | Add queue identity to ts-infra consumer lifecycle events | done |
<!-- END AUTO-GENERATED -->

## Notes
J9 is implemented (0601 presenters + history reprojection; 0602 ts-infra `queueName` @ 0.4.39).
It did not allocate a duplicate System Events feature.

**Shipped contract**
- `task.transitioned` / `feature.transitioned` summaries are `[task|feature] {id} : {from} -> {to}`; Outcome is `to`. No second status event.
- Successful `--section` writes emit `PlanningSectionMutationData` (`mutation.kind=section`, `name`); summaries are `[task|feature] {section}`. `after`/`diff` stay optional and are not populated until a redaction/diff policy exists. Legacy rows without mutation data fall back to `[task|feature] {id}`.
- Queue consumer start/stop carry the configured `queueName` from `@gobing-ai/ts-infra@0.4.39`; Spur composes `server-jobs`. Summaries are `[queue] {name} : consumer started|stopped`.
- Every `workflow.*` summary begins with `[workflow]` and prefers `workflowName` + `nodeLabel`/`kind`.
- History reads re-project derived `presentation` only; stored v2 `data`/`context` are not rewritten.

SSOT: `docs/design/event-tracking.md` §11. Envelope/reprojection: ADR-056/067, `docs/04_DESIGN.md` §7.9, `docs/design/actionable-observability-context.md`.
## History
- 2026-08-19T19:30:02.583Z backlog → active (system)
- 2026-08-19T19:45:03.977Z active → verifying (system)
- 2026-08-19T19:46:06.540Z verifying → done (system)
