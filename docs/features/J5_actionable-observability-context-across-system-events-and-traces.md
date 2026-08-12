---
schema_version: 1
id: "J5"
name: "Actionable observability context across System Events and traces"
status: active
priority: P2
tags: []
created_at: "2026-08-12T13:20:43.346Z"
updated_at: "2026-08-12T13:25:01.024Z"
---

# J5: Actionable observability context across System Events and traces

## Goal
Make every board-visible system event and persisted trace self-explanatory and actionable by carrying consistent project, producer, correlation, outcome, and remediation context from the emitting runtime through the Board and CLI.
## Scope
**In:**

- A versioned System Event payload envelope built at the existing Spur tap/emitter seam, with the original redacted event data plus current-project, upstream-producer, correlation, severity, summary, and optional remediation metadata.
- Catalog-owned producer attribution for Spur and the concrete `@gobing-ai/ts-*` package that owns each upstream event family.
- Additive upstream event-contract changes only where Spur cannot infer required correlation at the sink (notably rule-run identity and per-evaluation metadata).
- Metadata-only payload enforcement, recursive bounds, configured-secret redaction, and legacy-row projection without a database rewrite.
- A System Events table that prioritizes severity, summary, producer/project context, correlation, outcome, and actionability, with responsive behavior and accessible event-specific tooltips.
- Richer `spur workflow trace` and analogous `spur rule trace` human output, plus additive machine fields, using already-persisted timestamps, results, source, and correlation data.
- Representative end-to-end coverage for Spur-native events and upstream ts-infra, ts-runtime, ts-ai-runner, ts-rule-engine, and ts-dual-workflow-engine events.

**Out:**

- A new EventBus implementation or a generic context envelope imposed on ts-libs consumers outside Spur.
- New CLI nouns, verbs, or flags; existing trace commands are enriched in place.
- New observability transport, database tables/columns, or historical payload rewrite.
- Persisting message bodies, prompts, raw commands, environment variables, complete rule findings, or unbounded stdout/stderr.
- Cross-process bridging for events emitted only inside nested child-agent CLI processes; that remains a separate IPC concern.
- OpenTelemetry exporter changes or distributed tracing beyond the local Spur project.
## Acceptance Criteria
```gherkin
Feature: Actionable observability context across System Events and traces

@core
Scenario: R1 — Every new System Event carries one versioned actionable envelope
  Given a cataloged event is emitted through the server tap or CLI planning emitter
  When the event is persisted or streamed
  Then its payload contains one versioned envelope with redacted event data, project context, producer context, correlation, and presentation metadata
  And the same envelope builder is used by both write paths

@core
Scenario: R2 — Events identify the current project and their owning package
  Given representative Spur-native and upstream ts-libs events
  When their envelopes are inspected
  Then each envelope identifies the current project name and root
  And each envelope identifies the owning producer package and subsystem
  And upstream events distinguish ts-infra, ts-runtime, ts-ai-runner, ts-rule-engine, and ts-dual-workflow-engine

@core
Scenario: R3 — Correlation and remediation are derived without leaking unsafe payloads
  Given task, feature, queue, workflow, rule, agent, process, and API event payloads
  When the envelope is built
  Then available run, action, execution, entity, job, and sequence correlators are normalized into the context block
  And deterministic remediation metadata is provided when a safe existing Spur command or Board filter can act on the event
  And metadata-only events omit business payloads and complete finding/output bodies
  And secrets are redacted before recursive size bounds are applied

@core
Scenario: R4 — Legacy persisted rows remain understandable without a data migration
  Given a pre-envelope system_events row containing a legacy raw payload
  When the history API reads the row
  Then the response projects it into the current envelope using catalog and request-project context
  And no existing row must be rewritten

@core
Scenario: R5 — The System Events table prioritizes diagnostic decisions
  Given the operator opens the System Events tab on a desktop viewport
  When events are rendered
  Then the table exposes time, severity, event, summary, project or producer, correlation, outcome, and action columns
  And low-value catalog implementation columns are moved to the detail view
  And long values truncate without overlapping adjacent columns

@core
Scenario: R6 — Each event tooltip explains what happened and what to do next
  Given an event from any registered renderer family
  When the operator hovers, focuses, or pins its event name
  Then the tooltip shows the catalog description, event-specific high-value fields, project and producer context, and available remediation
  And raw redacted JSON remains available in the expanded detail view
  And the tooltip remains keyboard accessible and selectable for copy

@core
Scenario: R7 — Workflow trace exposes persisted execution context and failure action
  Given a persisted workflow run with phases, transitions, action rows, results, and an optional run log
  When `spur workflow trace <run-id>` is rendered
  Then the output includes project, run timing and duration, phase transitions with both endpoints, action node and identity, timestamps, safe invocation metadata, outcome, error, and cost availability
  And running or failed runs include the exact existing follow, log, or recovery artifact command/path that the operator can use next
  And JSON output preserves existing fields while adding the same context as optional fields

@core
Scenario: R8 — Rule trace exposes source, evaluator context, and failure action
  Given a persisted rule run and its evaluation rows
  When `spur rule trace <run-id>` is rendered
  Then the output includes project, source, timing, dry-run and fix policy, per-rule severity and evaluator, findings, fixes, duration, and error
  And the output identifies a safe existing command or source reference for the operator's next action when available
  And JSON output preserves existing fields while adding normalized context where needed

@core
Scenario: R9 — Upstream rule events carry the correlation Spur cannot infer
  Given a ts-rule-engine run emits run and evaluation lifecycle events
  When Spur bridges those events onto the canonical System Event bus
  Then every event carries the rule run id and timestamp
  And evaluation events carry severity and evaluator identity
  And no complete finding objects are required on the board event payload

@edge
Scenario: R10 — Malformed or unknown event data fails safe
  Given an unknown event name, malformed legacy payload, or missing optional correlator
  When the backend or Board projects the event
  Then the event remains renderable through a bounded generic fallback
  And missing values are explicit rather than fabricated
  And the underlying product operation is not failed by observability projection errors
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0526 | Build the canonical actionable System Event envelope and context projection | todo |
| 0527 | Make the System Events table and tooltips actionable from the canonical envelope | todo |
| 0528 | Enrich workflow and rule trace outputs with execution context and next actions | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-12T13:25:01.024Z backlog → active (system)
