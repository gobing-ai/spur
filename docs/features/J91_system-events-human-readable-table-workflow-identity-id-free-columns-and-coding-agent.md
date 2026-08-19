---
schema_version: 1
id: "J91"
name: "System Events human-readable table: workflow identity, id-free columns, and coding-agent"
status: backlog
priority: P2
tags: []
created_at: "2026-08-19T20:12:13.473Z"
updated_at: "2026-08-19T20:56:15.857Z"
---

# J91: System Events human-readable table: workflow identity, id-free columns, and coding-agent

## Goal
Make every Observability > System Events table cell human-readable so an operator can see which workflow and step fired, which human correlators apply, and which coding agent executed the request, without decoding opaque event ids.
## Scope
**In scope:**

- `workflow.*` SUMMARY follows `[workflow] {workflow file/name} · {human step/state description and result}` so operators see which workflow and which step fired without decoding ids.
- Event ids stay out of every table column; CORRELATION and ACTION show human correlators (run, step, action name, entity) only.
- A dedicated Agent/Executor column when the payload already carries or can carry the coding-agent identity.
- Spur-only projection from existing envelope facts (`producer` / `actor` / `agent`, `routing.executor`, `data.agent`, `metadata.agent`) when those facts are already present or stampable at a Spur fan-in.
- A ts-libs producer-contract upgrade only if the coding-agent identity cannot be emitted without one.
- Canonical v2 envelope preserved; presentation may be re-projected on read.
- Tooltip and expanded payload remain the home for raw ids.
- Board System Events table, presenters, and required producer contracts only.

**Out of scope:**

- Reopening or rewriting done J9.
- A new event envelope schema or transport contract unless agent identity truly cannot be projected from existing payloads.
- New CLI nouns, verbs, or flags.
- Client-only UUID stripping that leaves presenter semantics unchanged.
- Database rewrites or backfills of historical rows that never stored workflow name, step label, or agent identity.
- Inventing missing historical facts.
- Unrelated Board tabs or refactors outside System Events presentation and required producer contracts.
## Acceptance Criteria
```gherkin
Feature: System Events human-readable table: workflow identity, id-free columns, and coding-agent

  @core
  Scenario: R1 — Workflow summaries name the definition and human step without opaque ids
    Given any cataloged `workflow.*` event
    When canonical presentation is built
    Then Summary follows `[workflow] {workflowName} · {human step or state description and result}` when those facts exist
    And `workflowName` is the definition file or name (for example `idea-pipeline`), never a run id
    And a missing name or step is omitted, including its separator, rather than replaced with `runId`, `eventId`, `actionId`, or a UUID-shaped `node`
    And action `kind` is not used as a substitute for the step description in Summary

  @core
  Scenario: R2 — Correlation and Action columns show human correlators, not opaque ids
    Given live or historical System Events table rows
    When the table cells are rendered
    Then no column displays `eventId`, ledger row id, `runId`, `executionId`, `actionId`, a UUID-shaped `node`, or a `live-` prefixed token
    And CORRELATION shows human correlators already in bounded data: workflow or run name, step label, action name (`kind`), and entity
    And a numeric sequence correlator may remain
    And entity values such as a task WBS or feature id remain visible
    And ACTION shows the action name, entity, or a short human verb
    And a remediation command that embeds a UUID, such as `spur workflow trace <runId>`, is not the Action column value

  @core
  Scenario: R3 — Tooltip and expanded payload remain the home for raw ids
    Given a System Event whose bounded payload includes machine correlators
    When the operator opens the tooltip or expanded detail
    Then raw ids (`eventId`, ledger row id, `runId`, `actionId`, UUID-shaped `node`) remain available there
    And remediation commands that embed those ids remain available there
    And the table cells stay human-readable

  @core
  Scenario: R4 — Agent column shows coding-agent identity from existing payload facts
    Given a System Event whose bounded payload already carries or can carry a coding-agent or executor identity
    When the System Events table is rendered
    Then a dedicated Agent column shows one bounded string projected by the server
    And the identity is taken in order from `data.routing.executor`, then `data.agent`, then `data.metadata.agent`, then row `actor` when that actor is an executor or agent id
    And `context.producer.package` is never used as the Agent value
    And the cell is empty when the event has no executor, including pure engine rows such as `workflow.node.enter` and `workflow.transition`

  @core
  Scenario: R5 — Agent identity is stamped and retained on the Spur-only path
    Given an agent-executed event that already carries or can carry coding-agent identity at an existing Spur fan-in
    When the envelope is persisted or streamed
    Then the relevant presenters retain `metadata.agent`, `metadata.role`, and `routing.executor` so the metadata allow-list does not drop them
    And identity is stamped at that Spur fan-in rather than inferred later by the Board
    And `SystemEventEnvelopeV2.context` still contains only project, producer, and correlation
    And a ts-libs producer-contract upgrade is used only when that Spur path cannot emit the identity

  @core
  Scenario: R6 — Live and historical rows share the current human projection without a ledger rewrite
    Given a newly persisted canonical v2 event or an existing canonical v2 history row
    When it is streamed or read through the System Events API
    Then the same server presenter determines Summary, Correlation, Action, Agent, and Outcome
    And presentation is re-projected from bounded stored data without rewriting the ledger
    And the canonical v2 envelope shape, redaction, and payload bounds remain unchanged
    And missing historical workflow name, step label, or agent identity is omitted, never invented

  @core
  Scenario: R7 — The Board renders server-projected cells and does not interpret raw payloads
    Given the Observability > System Events table
    When events are displayed from SSE or history
    Then the Board maps server-projected presentation into the table columns
    And it does not recover workflow names, step labels, or agent identity by interpreting raw payload keys
    And it does not hide ids by client-only UUID stripping that leaves presenter semantics unchanged

  @edge
  Scenario: R8 — Compact System Events layout stays human-readable
    Given the operator opens the System Events tab on a viewport at or below 639px
    When events are rendered
    Then stacked Summary, Correlation, Action, and Agent values omit opaque event ids
    And raw ids remain in the tooltip and expanded detail
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0605 | Project human-readable System Events table cells including coding-agent identity | todo |
<!-- END AUTO-GENERATED -->
