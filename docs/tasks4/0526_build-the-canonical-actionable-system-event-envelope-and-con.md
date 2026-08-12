---
template: feature-impl
schema_version: 1
name: "Build the canonical actionable System Event envelope and context projection"
description: ""
status: todo
type: task
profile: standard
feature_id: J5
parent_wbs: null
priority: P1
tags: ["observability", "system-events", "backend"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T13:24:51.362Z"
updated_at: "2026-08-12T13:28:03.156Z"
---

## 0526. Build the canonical actionable System Event envelope and context projection

### Background

Implements: R1 — Every new System Event carries one versioned actionable envelope; R2 — Events identify the current project and their owning package; R3 — Correlation and remediation are derived without leaking unsafe payloads; R4 — Legacy persisted rows remain understandable without a data migration; R9 — Upstream rule events carry the correlation Spur cannot infer; R10 — Malformed or unknown event data fails safe. The current tap stores unrelated raw payload shapes and `metadata-only` does not actually omit large nested fields such as rule finding details. Build one envelope at the existing catalog/tap/emitter seam; keep ts-libs event maps domain-local and enrich bridged upstream events inside Spur. This foundation must land before Board and trace consumers.

Rubric: E2 D2 L2 C2 R2 = 10 → decompose (force: cross-repo contract risk was eliminated by keeping enrichment in Spur).

### Requirements
- [ ] R1. Define a versioned payload envelope with redacted event data, project context, producer context, normalized correlation, and presentation metadata; use one builder for the server tap and CLI emitter.
- [ ] R2. Extend catalog metadata with concrete producer package/subsystem, severity, description, metadata field policy, and deterministic remediation kind for every registered event, with bounded generic fallback.
- [ ] R3. Make metadata-only a real allow-list/bounded projection, redact configured and pattern secrets before bounds, and exclude message bodies, prompts, raw commands/env, complete rule findings, and unbounded output.
- [ ] R4. Inject current project name/root at composition roots; normalize run/action/execution/entity/job/sequence correlators; project legacy raw rows into the current envelope without rewriting the database; stream new events in the same shape.
- [ ] R5. Enrich the Spur rule-event bridge with its known run id, timestamp, severity, and evaluator identity while dropping complete finding objects from Board payloads.
- [ ] R6. Preserve failure isolation for malformed/unknown data and add representative unit/integration coverage across planning, queue, workflow, rule, agent, process, legacy, redaction, and size-bound paths; update the owning design/docs surfaces.
### Acceptance Criteria
```gherkin
Feature: Canonical actionable System Event envelope

Scenario: R1 — Every new System Event carries one versioned actionable envelope
  Given a cataloged server or CLI event
  When it is persisted or streamed
  Then one envelope builder supplies data, context, and presentation metadata

Scenario: R2 — Events identify the current project and their owning package
  Given representative Spur and upstream event families
  When their envelopes are built
  Then project name and root and the concrete owning package and subsystem are present

Scenario: R3 — Correlation and remediation are derived without leaking unsafe payloads
  Given a payload containing correlators, metadata, secrets, and large bodies
  When it is normalized
  Then correlation and safe remediation are retained while unsafe or unbounded bodies are omitted

Scenario: R4 — Legacy persisted rows remain understandable without a data migration
  Given a legacy raw payload row
  When history reads it
  Then the response projects the current envelope without rewriting storage

Scenario: R5 — Upstream rule events carry the correlation Spur cannot infer
  Given a rule run bridged by RuleService
  When lifecycle events reach the canonical bus
  Then run id, time, severity, and evaluator context are present without complete finding bodies

Scenario: R6 — Malformed or unknown event data fails safe
  Given malformed or unknown payload data
  When projection runs
  Then a bounded generic envelope is returned and the product operation remains unaffected
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: extend `SYSTEM_EVENT_CATALOG` and add a pure `buildSystemEventEnvelope(entry, payload, projectContext)` used by `registerSystemEventTap`, `SystemEventEmitter`, SSE projection, and legacy API projection. Envelope v2 keeps `{ schemaVersion, data, context, presentation }`; context owns `{ project, producer, correlation }`, while presentation owns `{ severity, summary, description, fields, action? }`. Catalog entries declare producer package and bounded field policy; app-level presenters interpolate only allow-listed scalar metadata.

Rejected: changing `EventBus<TEvents>` to inject Spur context (would couple every ts-libs consumer to Spur); editing every emit site (duplicated policy and cross-repo release chain); adding system_events columns or rewriting history (no query need for the new display metadata).

Invariants: redaction precedes bounds and persistence; envelope construction cannot fail the product operation; legacy rows are adapted on read; existing indexed correlation columns remain authoritative for queries; remediation uses existing commands/filters only; observability remains read-only per ADR-035.
### Plan
1. Add envelope/catalog types and the pure bounded builder with focused tests.
2. Route server tap and CLI emitter persistence through the builder.
3. Route SSE and history legacy projection through the same shape.
4. Add project context at server/CLI composition roots.
5. Enrich the rule bridge with known run/evaluator correlation and omit full findings.
6. Add cross-family integration/redaction/bounds tests.
7. Update ADR/design/architecture surfaces through doc-evolve and run targeted gates.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
