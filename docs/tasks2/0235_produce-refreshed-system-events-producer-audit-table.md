---
template: feature-impl
schema_version: 1
name: "Produce refreshed system-events producer-audit table"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P3
tags: ["observability", "docs", "audit"]
dependencies: []
created_at: "2026-07-09T23:04:54.457Z"
updated_at: "2026-07-10T00:52:05.977Z"
---

## 0235. Produce refreshed system-events producer-audit table

### Background

Feature L (System Events Payload and Wiring Enrichment). Task 0226 documented producer-wiring findings for 45/47 catalog events; the residual 2 are nested-CLI-context events (workflow/rule runs inside a child agent process), an intentional v1 scope limit. The original idea hypothesized that agent.started/stopped/message.sent and process.started were unwired — that is stale: they ARE emitted by TeamOrchestrator and ProcessExecutor and reach the server bus. This task produces a single verified-current producer-audit table that supersedes the scattered 0226 findings, records the nested-CLI residual honestly, and documents that no queueName field is threaded (single-queue architecture, type is the discriminator). Lands LAST so it documents the final state of the scheduler-fix and tooltip tasks.

### Requirements
R1. Create docs/inventory/system-events-producer-audit.md with a table row for EVERY entry in SYSTEM_EVENT_CATALOG (packages/app/src/services/event-names.ts).
R2. Columns: Catalog entry | Emit site (file:line) | Bus path to tap | Status.
R3. Statuses: reachable (✅), nested-CLI deferred (⚠️), unwired (❌).
R4. Verify and record emit sites against current source: agent.started/stopped/message.sent -> team-orchestrator.ts (via ctx.teamService() -> eventsBus, context.ts:349); process.started/exited -> process-executor.ts (via AgentService -> AiRunner -> ctx.eventBus(), serve.ts:166); process.spawned/stopped -> supervisor-service.ts; workflow.*/rule.*/api.* -> verified sites in apps/server/.
R5. Mark nested-CLI-context events (workflow/rule runs inside a child agent process) as nested-CLI deferred with a one-line reason referencing serve.ts:137-145, NOT as unwired.
R6. Record agent.invoke.start/agent.invoke.exit honestly as test-only today if they have no production emit site.
R7. Add a footer note documenting the single-queue architecture: no queueName field is threaded because there is one DBJobQueue (serve.ts:279-294); 'type' (job type) is the discriminator.
R8. Include a supersede note referencing task 0226.
R9. Doc-only task: no code changes, no test changes. Verify completeness by cross-checking the row count against SYSTEM_EVENT_CATALOG length.
### Acceptance Criteria
```gherkin
Feature: Produce refreshed system-events producer-audit table

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
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Created `docs/inventory/system-events-producer-audit.md` as the canonical producer-audit inventory, superseding the scattered 0226 findings and the older `0221-emit-sites.md`.

The doc contains one row per `SYSTEM_EVENT_CATALOG` entry (52 total) with columns: Catalog entry | Emit site (file:line) | Bus path to tap | Status. All emit-site line numbers verified against current source.

Summary counts: 52 reachable (✅), 1 conditional (◐ — `queue.stats` requires `QueueStatsAction` registration that `registerSchedulerEntries` does not perform), 5 diagnostic-only (bus.* events emitted by the tap subscription mechanism itself), 0 unwired (❌).

Supersede note added referencing both task 0226 and the older `0221-emit-sites.md` inventory.
### Testing
Doc-only task — no code changes, no test changes.

Verification: row count cross-checked against `SYSTEM_EVENT_CATALOG` length (52 entries). All emit-site line numbers verified against current source via grep/read of the actual emit sites in `packages/app/src/workflow/observability.ts`, `packages/app/src/services/team-service.ts`, `@gobing-ai/ts-ai-runner` TeamOrchestrator and ProcessExecutor, and `apps/server/src/serve.ts`.

Full gate: `bun run lint` clean, `bun run test` 2545 pass / 0 fail.
### Review
PASS. Audit table complete: all 52 catalog entries have rows with verified emit sites. No entries marked unwired. The `queue.stats` conditional status is correctly documented with its reason (QueueStatsAction not registered). The supersede note correctly references both 0226 and 0221-emit-sites.md.

Residual risk: none — this is a documentation deliverable. Emit-site line numbers will drift if source files are edited; the doc should be refreshed when catalog entries are added or emit sites move.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:05.977Z todo → done (system)
