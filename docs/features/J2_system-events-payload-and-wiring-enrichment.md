---
schema_version: 1
id: "J2"
name: "System Events Payload and Wiring Enrichment"
status: verifying
priority: P2
tags: []
created_at: "2026-07-09T22:47:56.455Z"
updated_at: "2026-07-28T00:31:32.943Z"
---

# L: System Events Payload and Wiring Enrichment

## Goal
Enrich the System Events observability tab to be genuinely diagnostic: (1) extend `buildTooltipSummary` so every renderer branch surfaces the high-value fields already present in payloads but currently dropped (duration, status, error, cron, command, exit code, pid, severity, path), capped at 4 pairs and prioritized per renderer; (2) fix the `scheduler.job.executed` emit in `serve.ts` to populate the `SchedulerJobExecutedDetail` contract (`name` not `kind`, add `error` capture, drop the undeclared `cron` field); (3) produce a refreshed producer-audit table as documentation, superseding task-0226 findings with the verified-current emit-site map. Declined: `ServerEventMap` type-erasure tightening (ADR-scoped), `QueueEvents` `queueName` threading (single-queue architecture makes it constant noise), nested-CLI event bridging (deferred v1 scope).
## Scope
**In scope:**

1. Enrich `buildTooltipSummary` (`apps/web/src/modules/observability/SystemEventsTab.tsx`) so every renderer branch extracts the high-value diagnostic fields already in payloads but currently dropped, using the existing `pickString` helper plus a new `formatDuration`/`pickNumber` pair. Cap stays at 4 pairs (`.slice(0,4)`). Per-renderer priority budgets:
   - `queue`: Job (type), ID, Status/Duration, Error.
   - `scheduler`: Job (name), Duration, Error (cron dropped from payload — see scheduler fix below).
   - `process`/`agent`: Agent/Command, Exit/Duration, Op, PID.
   - `message`: Route, OK, Subject.
   - `rule`: Rule, Severity, Findings.
   - `api`: HTTP (method+status), Path, Error.
   - `workflow-*`: Workflow, Run, Phase/Transition/Action.
2. Fix `scheduler.job.executed` emit in `apps/server/src/serve.ts` (`registerSchedulerEntries`) to populate the `SchedulerJobExecutedDetail` contract: emit `name` (not `kind`), capture `error` in a `catch` block (currently swallowed by `try/finally`), and drop the undeclared `cron` field from the payload.
3. Produce a refreshed producer-audit table as a documentation artifact (`docs/inventory/system-events-producer-audit.md`) with columns: Catalog entry | Emit site (file:line) | Bus path to tap | Status. Statuses: ✅ reachable, ⚠️ nested-CLI (deferred), ❌ unwired. Supersedes task-0226 findings.

**Out of scope:**

- `ServerEventMap` type-erasure tightening (`context.ts:68` `Record<string,…>` + `as unknown as never` cast pattern) — ADR-scoped refactor tracked separately.
- `QueueEvents` `queueName` field addition to `ts-infra` — single-queue architecture means `type` is the real discriminator; a literal queue name would be constant noise.
- Nested-CLI event bridging (workflow/rule runs inside a child agent process) — task-0226 deferred v1 scope, requires IPC or server-native execution.
- New backend endpoints, DTOs, transport changes, or cross-repo (`ts-libs`) contract changes.
## Acceptance Criteria
```gherkin
Feature: System Events Payload and Wiring Enrichment

  # ── Tooltip enrichment (SystemEventsTab.tsx:buildTooltipSummary) ─────────────

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

  # ── Scheduler emit contract fix (serve.ts:registerSchedulerEntries) ──────────

  Scenario: Scheduler job executed event populates the contract name field
    Given a scheduler entry registered with kind "system-events-prune"
    When the scheduled job executes successfully
    Then the "scheduler.job.executed" event payload contains key "name" with value "system-events-prune"
    And the payload does NOT contain key "kind"
    And the payload contains key "durationMs" as a number

  Scenario: Scheduler job executed event captures error on failure
    Given a scheduler entry whose job throws an Error "timeout"
    When the scheduled job executes
    Then the "scheduler.job.executed" event payload contains key "error" with value containing "timeout"
    And the original error continues to propagate after the event is emitted

  Scenario: Scheduler job executed event no longer carries undeclared cron field
    Given a scheduler entry registered with a cron schedule
    When the scheduled job executes
    Then the "scheduler.job.executed" event payload does NOT contain key "cron"

  # ── Producer-audit documentation artifact ─────────────────────────────────────

  Scenario: Refreshed producer-audit table exists and is accurate
    Given the catalog of system events in packages/app/src/services/event-names.ts
    When the audit table at docs/inventory/system-events-producer-audit.md is consulted
    Then every catalog entry has a row
    And each row records an emit site (file:line), a bus path to the tap, and a status
    And the row for agent.started shows status "reachable" with emit site team-orchestrator.ts
    And the row for process.started shows status "reachable" with emit site process-executor.ts
    And nested-CLI-context entries are marked "deferred" not "unwired"
    And the table records that no queueName field is threaded (single-queue architecture, type is the discriminator)
    And a supersede note references task 0226
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0233 | Fix scheduler.job.executed emit to match SchedulerJobExecutedDetail contract | done |
| 0234 | Enrich buildTooltipSummary so every renderer surfaces high-value diagnostic fields | done |
| 0235 | Produce refreshed system-events producer-audit table | done |
| 0236 | Wire observabilityBus in server context to enable verb-form workflow events | done |
| 0237 | Wire TeamOrchestrator events bus so agent lifecycle events reach system event tap | done |
| 0238 | Document CLI event-tap gap and queue config gating in producer audit | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-09T23:06:50.530Z backlog → active (system)
- 2026-07-25T19:33:15.814Z active → verifying (system)
- 2026-07-28T00:31:32.943Z moved L → J2 (system)
