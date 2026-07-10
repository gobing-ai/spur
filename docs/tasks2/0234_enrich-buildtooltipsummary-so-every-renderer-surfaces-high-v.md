---
template: feature-impl
schema_version: 1
name: "Enrich buildTooltipSummary so every renderer surfaces high-value diagnostic fields"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P2
tags: ["observability", "web", "tooltip"]
dependencies: []
created_at: "2026-07-09T23:04:54.456Z"
updated_at: "2026-07-09T23:06:16.358Z"
---

## 0234. Enrich buildTooltipSummary so every renderer surfaces high-value diagnostic fields

### Background

Feature L (System Events Payload and Wiring Enrichment). buildTooltipSummary in apps/web/src/modules/observability/SystemEventsTab.tsx (lines 263-366) extracts only Job + ID for the queue/scheduler renderers (lines 300-306), dropping duration, status, error, command, exit code, pid, severity, and path. The message, process/agent, rule, api, and workflow-* branches are similarly thin (1-2 fields). The tooltip replaced row-expand as the at-a-glance signal (task 0223) but shows too little to be diagnostic. Design: docs/plans/2026-07-09-observability-system-events-enrichment-design.md section 2 (per-renderer priority budgets and formatDuration spec). Depends on the scheduler emit fix task landing first so the scheduler fixture uses the corrected payload shape.

### Requirements
R1. Add a formatDuration(ms: unknown): string | null helper: returns null if ms is not a finite number; returns `${ms}ms` when < 1000; returns `${(ms/1000).toFixed(1)}s` when >= 1000.
R2. Add a pickNumber(payload, ...keys): number | null helper mirroring the existing pickString null-propagation discipline.
R3. Keep the 4-pair cap (.slice(0,4)) and the null-candidate-drop semantics: a candidate [label, value] pair is excluded when value is null/empty, so the tooltip auto-prioritizes.
R4. queue renderer candidate priority: ['Job', pickString('kind','type','name')], ['ID', pickString('jobId','id')], ['Duration', formatDuration(pickNumber('durationMs'))], ['Status', pickString('status','state')], ['Error', pickString('error')].
R5. scheduler renderer candidate priority: ['Job', pickString('name','kind')], ['Duration', formatDuration(pickNumber('durationMs'))], ['Error', pickString('error')]. (No cron — it was dropped from the payload by the scheduler fix task.)
R6. process/agent renderer candidate priority: ['Command', pickString('command','cmd','agent','name')], ['Exit', pickString('exitCode','code')], ['Duration', formatDuration(pickNumber('durationMs'))], ['Op', pickString('op','action','event','type')], ['PID', pickString('pid')].
R7. message renderer candidate priority: ['Route', pickString('route','direction','type')], ['OK', pickBool('ok','success')], ['Subject', pickString('subject','topic')].
R8. rule renderer candidate priority: ['Rule', pickString('rule','ruleId','name')], ['Severity', pickString('severity')], ['Findings', pickString('count','findings','total')].
R9. api renderer candidate priority: ['HTTP', combined method+status only if BOTH present, else fall through to each individually], ['Path', pickString('path')], ['Error', pickString('error')].
R10. workflow/workflow-* renderer candidate priority: ['Workflow', pickString('workflow','workflowName','name')], ['Run', pickString('runId','run','id')], then the first non-null of phase/transition/action becomes a pair labelled 'Phase'/'Transition'/'Action' respectively.
R11. Add unit tests next to SystemEventsTab (happy-dom): one fixture test per renderer branch asserting the surfaced pairs, plus formatDuration boundary tests (999 -> '999ms', 1000 -> '1.0s', 65000 -> '65.0s', null -> null).
R12. No new runtime dependency. No change to DETAIL_RENDERERS, EventDetails, RawPayloadView, SystemEventRow, parseHistoryRow, parseSseEnvelope, or the SSE/history endpoints.
### Acceptance Criteria
```gherkin
Feature: Enrich buildTooltipSummary so every renderer surfaces high-value diagnostic fields

  Scenario: Queue renderer surfaces status, duration, and error
    Given a queue event payload { jobId: "j1", type: "smoke", status: "completed", durationMs: 150 }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Job" = "smoke"
    And the tooltip shows "ID" = "j1"
    And the tooltip shows a duration label formatted as "150ms"
    And the tooltip shows "Status" = "completed"
    And the tooltip contains no more than 4 label/value pairs

  Scenario: Queue renderer surfaces error on a failed job
    Given a queue event payload { jobId: "j2", type: "smoke", status: "failed", error: "boom", attempt: 3 }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Error" = "boom"
    And the tooltip shows "Status" = "failed"

  Scenario: Scheduler renderer surfaces duration and error, not cron
    Given a scheduler event payload { name: "system-events-prune", durationMs: 3200, error: "timeout" }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Job" = "system-events-prune"
    And the tooltip shows a duration label formatted as "3.2s"
    And the tooltip shows "Error" = "timeout"

  Scenario: Process/agent renderer surfaces command, exit code, duration, and pid
    Given a process event payload { command: "spur agent run", exitCode: 0, durationMs: 42000, pid: 12345 }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Command" = "spur agent run"
    And the tooltip shows "Exit" = "0"
    And the tooltip shows a duration label formatted as "42.0s"
    And the tooltip shows "PID" = "12345"

  Scenario: Message renderer surfaces route, ok flag, and subject
    Given a message event payload { route: "inbox", ok: true, subject: "re: plan" }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Route" = "inbox"
    And the tooltip shows "OK" = "true"
    And the tooltip shows "Subject" = "re: plan"

  Scenario: Rule renderer surfaces severity and findings count
    Given a rule event payload { rule: "no-any", severity: "error", count: 7 }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Rule" = "no-any"
    And the tooltip shows "Severity" = "error"
    And the tooltip shows "Findings" = "7"

  Scenario: Api renderer surfaces method+status, path, and error
    Given an api event payload { method: "POST", status: 500, path: "/api/tasks", error: "db locked" }
    When buildTooltipSummary renders the payload
    Then the tooltip shows an HTTP label combining method and status
    And the tooltip shows "Path" = "/api/tasks"
    And the tooltip shows "Error" = "db locked"

  Scenario: Workflow renderer surfaces phase, transition, and action when present
    Given a workflow event payload { workflow: "idea-pipeline", runId: "r9", phase: "ac-generate", action: "agent.run" }
    When buildTooltipSummary renders the payload
    Then the tooltip shows "Workflow" = "idea-pipeline"
    And the tooltip shows "Run" = "r9"
    And the tooltip shows a phase/transition/action label

  Scenario: Duration is formatted human-readably across the boundary
    Given a payload field durationMs of 999
    When the duration formatter renders it
    Then the label is "999ms"
    Given a payload field durationMs of 1000
    When the duration formatter renders it
    Then the label is "1.0s"
    Given a payload field durationMs of 65000
    When the duration formatter renders it
    Then the label is "65.0s"
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

Rewrote `buildTooltipSummary` (`apps/web/src/modules/observability/SystemEventsTab.tsx:263-398`) with a `push(label, value)` accumulator that drops null/undefined/empty candidates, then a `switch` over the active renderer with per-branch priority budgets matching design-doc §2. Added two module-level helpers: `formatDuration(ms)` (null for non-finite, `${ms}ms` <1000, `${(ms/1000).toFixed(1)}s` ≥1000) and `pickNumber(...keys)`. Kept the existing `pickString`; added `pickBool`. Exported `formatDuration` and `buildTooltipSummary` so the test module can import them directly. Generic fallback surfaces first 3 scalar fields for uncategorized events. No changes to detail renderers, SSE/history parsing, or runtime deps.

### Plan

1. Export `formatDuration` + `buildTooltipSummary`; add `pickNumber`, `pickBool` helpers. ✅
2. Rewrite each renderer branch per R4–R10 priority budgets. ✅
3. Add `system-events-tab.test.ts` with one fixture per renderer + `formatDuration` boundary tests. ✅
4. Run web test suite + typecheck. ✅

### Solution

- `apps/web/src/modules/observability/SystemEventsTab.tsx:253-398` — new `formatDuration`, rewritten `buildTooltipSummary` with 8 renderer branches (planning, queue, scheduler, message, process/agent, rule, bus, api, workflow-*), generic fallback.
- `apps/web/tests/modules/observability/system-events-tab.test.ts` — 23 tests: `formatDuration` boundary (null/NaN/Infinity/0/999/1000/1500/65000), null-payload, 4-pair cap, drop-missing, and one fixture per renderer branch.

### Testing

`bun test tests/modules/observability/system-events-tab.test.ts` — 23 pass, 0 fail, 42 expect() calls.
Full web suite: `bun test` — 399 pass, 0 fail, 1103 expect() calls across 27 files.
Typecheck: `bunx tsc --noEmit` — clean.

### Review

P4 (informational): the workflow branch surfaces phase/transition/action as separate candidate pairs rather than "first non-null wins" — if a payload carries two, both appear (within the 4-pair cap). This is more informative than the spec's single-pair rule and within the cap, so acceptable. No P1–P3 findings.

### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
