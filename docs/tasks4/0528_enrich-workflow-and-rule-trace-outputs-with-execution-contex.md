---
template: feature-impl
schema_version: 1
name: "Enrich workflow and rule trace outputs with execution context and next actions"
description: ""
status: todo
type: task
profile: standard
feature_id: J5
parent_wbs: null
priority: P1
tags: ["observability", "workflow", "rule", "cli"]
dependencies: ["0526"]
ac_numbering: task-local
created_at: "2026-08-12T13:24:51.438Z"
updated_at: "2026-08-12T13:28:04.594Z"
---

## 0528. Enrich workflow and rule trace outputs with execution context and next actions

### Background

Implements: R7 — Workflow trace exposes persisted execution context and failure action; R8 — Rule trace exposes source, evaluator context, and failure action; R10 — Malformed or unknown event data fails safe. The DAOs already return action timestamps/results and rule source/evaluator data, but the public trace projections and formatters discard most of it. Enrich the existing commands in place; do not add verbs or flags. Runs after the envelope foundation so project-context vocabulary is shared.

Rubric: E1 D1 L2 C1 R1 = 6 → decompose (independent CLI/DTO review across workflow and rule stores).

### Requirements
- [ ] R1. Extend workflow trace projections additively with project context, run duration, full transition endpoints, action id/node/status/timestamps, safe allow-listed result/invocation metadata, outcome/error/cost, artifacts, and an exact existing follow or recovery next action; use the same fields in list/detail/follow human output and preserve existing JSON keys.
- [ ] R2. Enrich rule trace with project, source kind/value, timing, dry-run/fix policy, applied fixes, and per-evaluation severity/evaluator/timestamps/findings/fixes/error; provide a safe existing command or source reference only when reconstructable and preserve existing JSON keys.
- [ ] R3. Degrade missing/malformed stored metadata to explicit unavailable values with no raw output or fabricated action; add service/formatter/command/JSON-compatibility tests for running, success, failure, artifacts, unavailable cost, rule failure, and malformed metadata; update the exact CLI/DTO design surface.
### Acceptance Criteria
```gherkin
Feature: Actionable persisted trace output

Scenario: R1 — Workflow trace exposes persisted execution context and failure action
  Given a persisted workflow run with phases, transitions, actions, results, and optional artifacts
  When workflow trace renders human or JSON output
  Then project, timing, transition, action, safe invocation, outcome, error, cost, and deterministic next-action context are available without removing existing JSON fields

Scenario: R2 — Rule trace exposes source, evaluator context, and failure action
  Given a persisted rule run and evaluation rows
  When rule trace renders human or JSON output
  Then project, source, timing, policy, severity, evaluator, findings, fixes, error, and safe next-action context are available

Scenario: R3 — Malformed or unknown event data fails safe
  Given missing or malformed persisted optional metadata
  When either trace command renders
  Then the command succeeds with explicit unavailable values and no fabricated action
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: widen existing `WorkflowTraceEntry`/`TimelineEvent` projections and rule trace result projection from columns the DAOs already select. Parse `result_json` through a small allow-listed projector; never print arbitrary stdout/stderr. Human formatters use the same normalized fields returned in JSON and append `Next:` only when an existing command/path is exact.

Rejected: reading System Events to reconstruct traces (workflow/rule stores are the durable authorities); a new generic trace framework (only two concrete commands, three similar lines beat an abstraction); new detail flags (the requested context is the useful default).

Invariants: existing JSON keys retain name/type/meaning; additions are optional; no raw output or secrets; workflow status, not final-state naming, determines terminality; exact command suggestions only; malformed stored JSON degrades to unavailable rather than failing trace.
### Plan
1. Extend workflow DAO/service projections and safe result parsing.
2. Enrich workflow list/detail/follow formatters and deterministic next-action selection.
3. Extend rule trace service projection from existing run/eval columns.
4. Enrich rule list/detail formatters and safe next-action selection.
5. Add service/formatter/command and JSON-compatibility tests.
6. Update workflow/rule trace design docs and run targeted gates.
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
