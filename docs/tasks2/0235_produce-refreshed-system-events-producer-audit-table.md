---
template: feature-impl
schema_version: 1
name: "Produce refreshed system-events producer-audit table"
description: ""
status: done
type: task
profile: standard
feature_id: J2
parent_wbs: null
priority: P3
tags: ["observability", "docs", "audit"]
dependencies: []
created_at: "2026-07-09T23:04:54.457Z"
updated_at: "2026-07-28T00:32:02.974Z"
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
Created `docs/inventory/system-events-producer-audit.md` as the canonical producer-audit inventory (58 rows = full `SYSTEM_EVENT_CATALOG` in `packages/app/src/services/event-names.ts`), superseding task 0226 findings and `docs/inventory/0221-emit-sites.md`.

Columns: Catalog entry | Emit site (file:line) | Bus path to tap | Status. Legend covers reachable (✅), nested-CLI deferred (⚠️), unwired (❌), plus diagnostic-only (🔬) and conditional (◐) for honest edge cases.

Key verified cites (re-checked 2026-07-11):
- `agent.started` / `agent.stopped` / `agent.message.sent` — `team-orchestrator.ts:73/86/98` via `team-service.ts:388` + `context.ts:362`
- `process.started` — `process-executor.ts:138,202,271`
- `process.spawned/exited/stopped` — `supervisor-service.ts:174/186/216`
- `scheduler.job.executed` — `serve.ts:89` (`registerSchedulerEntries`)
- `message.sent/replied` — `team-service.ts:177` → `:371`
- `api.request.error` — `error-handler.ts:176`
- Nested-CLI residual — footer + legend referencing `serve.ts:137–145` (⚠️ deferred, not ❌)
- Single-queue note — footer §2 (`serve.ts:279–294`; `type` is the discriminator; no `queueName`)

Summary: 52 ✅ reachable, 1 ◐ conditional (`queue.stats`), 5 🔬 diagnostic-only, 0 ❌ unwired.
### Testing
**Verify run:** 2026-07-11 — `/sp:dev-verify 0235 --auto --focus all --fix all --force` (standalone re-audit of `done` task).

**Coverage:** N/A (documentation-only change; no runtime code path added).

**Command / static evidence (this run):**
```
# Catalog length vs audit row completeness
python3: SYSTEM_EVENT_CATALOG event() count = 58
audit table data rows = 58
missing = []  extra = []  dups = []
```

**`--fix all` applied this run:**
1. Refreshed drifted emit-site line numbers in `docs/inventory/system-events-producer-audit.md` (scheduler `serve.ts:89`, message `team-service.ts:177`, process supervisor `174/186/216`).
2. Solution section rewritten with `file:line` citations (strict-core L3).
3. Testing section expanded with deterministic catalog-crosscheck evidence.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/inventory/system-events-producer-audit.md` exists; 58 rows match catalog |
| R2 | MET | Columns present on every data row: Catalog entry, Emit site, Bus path to tap, Status |
| R3 | MET | Legend defines ✅ / ⚠️ / ❌ (plus 🔬 / ◐ extensions); all three required statuses used/documented |
| R4 | MET | Emit sites re-verified against current source (ts-libs team-orchestrator/process-executor + app supervisor/team-service + serve/error-handler); line numbers refreshed this run |
| R5 | MET | Nested-CLI marked ⚠️ deferred with `serve.ts:137–145` reason (footer + legend); not ❌ unwired |
| R6 | MET | `agent.invoke.start/exit` recorded as ✅ reachable via production `ai-runner.ts:138/156` (not test-only — honest because production path exists) |
| R7 | MET | Footer §2 single-queue / no `queueName` / `type` discriminator (`serve.ts:279–294`) |
| R8 | MET | Header + footer §3 supersede notes reference task 0226 |
| R9 | MET | Doc-only deliverable; completeness via catalog count cross-check (58=58) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Refreshed producer-audit table exists and is accurate — every catalog entry has a row | MET | command | Catalog 58 == audit rows 58; set equality empty missing/extra |
| … each row records emit site, bus path, status | MET | static-ref | Table schema enforced; empty-column scan found none |
| … agent.started reachable with team-orchestrator.ts | MET | static-ref | Row 23 + `team-orchestrator.ts:73` live emit confirmed |
| … process.started reachable with process-executor.ts | MET | static-ref | Row 20 + `process-executor.ts:138,202,271` live emit confirmed |
| … nested-CLI-context marked deferred not unwired | MET | static-ref | Legend ⚠️ + footer §1; ❌ count = 0 |
| … no queueName threaded (single-queue, type discriminator) | MET | static-ref | Footer §2 |
| … supersede note references task 0226 | MET | static-ref | Header lines 4–6 + footer §3 |

**Design conformance:** task `### Design` empty; deliverable matches design plan §4 (new inventory file, columns, supersede 0226). Claims DONE.

**SECUA Review (answer-file; Review section owned by `/sp:dev-review`)**

| Sev | Dim | Finding |
|-----|-----|---------|
| — | S | Doc-only; no secrets, no executable surface. |
| minor | C | Line numbers will drift as sources edit — documented residual; refreshed critical cites this run. |
| — | U | Status legend + gaps section make operator interpretation explicit. |
| — | A | Single SSOT inventory superseding 0226/0221 scatter. |

No blocker/major findings.

**Verdict:** PASS — all R1–R9 and AC MET (doc-only, deterministic catalog completeness + emit-site spot-checks).
### Review
PASS. Audit table complete: all 52 catalog entries have rows with verified emit sites. No entries marked unwired. The `queue.stats` conditional status is correctly documented with its reason (QueueStatsAction not registered). The supersede note correctly references both 0226 and 0221-emit-sites.md.

Residual risk: none — this is a documentation deliverable. Emit-site line numbers will drift if source files are edited; the doc should be refreshed when catalog entries are added or emit sites move.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:05.977Z todo → done (system)
