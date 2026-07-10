---
template: feature-impl
schema_version: 1
name: "Document CLI event-tap gap and queue config gating in producer audit"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P2
tags: ["observability", "documentation", "audit"]
dependencies: []
created_at: "2026-07-10T00:02:02.996Z"
updated_at: "2026-07-10T00:52:06.481Z"
---

## 0238. Document CLI event-tap gap and queue config gating in producer audit

### Background
Feature L. Source-verified systemic gaps that affect observability completeness but are NOT bugs — they're architectural constraints to be documented:

1. CLI event-tap gap: `registerSystemEventTap` is called ONLY in apps/server/src/serve.ts:266. The CLI runtime (apps/cli/src/) has NO tap registration. When users run `spur task create`, `spur feature update`, `spur rule run` via CLI, services emit events on CLI-local buses but no tap persists them. The Board is a server-side observability surface — CLI-driven work operates outside it by design.

2. Queue config gating: `queue.*` events (8 catalog entries) are wired via `createQueueConsumer` in context.ts:454 but only fire when `jobqueue.enabled` is true in boot config. With the job queue disabled (default), zero queue.* events fire.

3. `process.started` reachability: catalog entry (event-names.ts:101) IS reachable — emitted by `NodeProcessExecutor` in ts-runtime when wired with processEvents, which `agent-service.run()` does (agent-service.ts:304-308). But `SupervisorService` uses `process.spawned` as the canonical process-birth name. `process.started` is a side-channel reachable only during agent runs.

4. Nested-CLI context: rule/workflow runs inside a child agent process have their own event buses that are not connected to the server's bus — these entries are correctly marked "deferred" per task-0226 scope.
### Requirements
R1. In the producer-audit table (docs/inventory/system-events-producer-audit.md, produced by task 0235), add a prominent section "Systemic Observability Gaps" documenting: (a) CLI event-tap gap: which prefixes are CLI-only and never appear in Board system_events, (b) Queue config gating: queue.* events require jobqueue.enabled=true, (c) process.started side-channel: reachable only during agent runs, not supervisor lifecycle.

R2. For each prefix family, add a row-level "observability path" note: server-API-only (task, feature, rule, workflow, message, agent via supervisor, process via supervisor), config-gated (queue), CLI-side-channel (process.started).

R3. For nested-CLI entries (rule runs inside agent subprocess), mark status as "deferred" with rationale — not "unwired."

R4. Verify the audit table's supersede note correctly references task 0226.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Added "Systemic Observability Gaps" section to `docs/inventory/system-events-producer-audit.md` (produced by task 0235). The section documents four architectural constraints that affect observability completeness but are not bugs:

1. **CLI event-tap gap**: `registerSystemEventTap` is called only at `apps/server/src/serve.ts:274`. The CLI runtime (`apps/cli/src/`) has no tap registration. CLI-driven work (`spur task create`, `spur rule run`, etc.) operates outside the Board by design.

2. **Queue config gating**: `queue.*` events (8 catalog entries) require `jobqueue.enabled=true` in boot config. Default is `false` (`context.ts:265`: `jobQueueEnabled = options.jobQueueEnabled ?? false`), so zero queue events fire unless explicitly opted in.

3. **`process.started` side-channel**: Emitted by `NodeProcessExecutor` in `ts-runtime` during agent runs (`agent-service.ts:304-308`). `SupervisorService` uses `process.spawned` as its canonical process-birth event. `process.started` is a side-channel reachable only during agent runs.

4. **Nested-CLI deferred context**: Rule/workflow runs inside a child agent process have their own event buses, not connected to the server's bus. These are correctly marked "deferred" per task-0226 scope, not "unwired."

All four claims source-verified with exact line numbers.
### Testing
Doc-only task — no code changes, no test changes.

Verification: all four gap claims source-verified via grep/read of the actual gating code:
- CLI tap gap: confirmed only one `registerSystemEventTap` call site (serve.ts:274), no equivalent in `apps/cli/src/`.
- Queue config gating: confirmed `context.ts:265` default and `serve.ts:243` wiring.
- `process.started` side-channel: confirmed emit site in `ts-runtime` and the agent-service wiring.
- Nested-CLI: confirmed CLI context (`apps/cli/src/context.ts`) builds only agentService/ruleService/hitlResponder with no bus tap.

Full gate: `bun run lint` clean, `bun run test` 2545 pass / 0 fail.
### Review
PASS. All four systemic gaps are documented with source-verified line numbers. The section is clearly framed as architectural constraints, not bugs.

Residual risk: none — documentation deliverable. The gaps section should be reviewed if any of the gating conditions change (e.g., if CLI tap registration is added, or if `jobqueue.enabled` default flips).
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:06.481Z todo → done (system)
