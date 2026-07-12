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
updated_at: "2026-07-12T04:37:24.764Z"
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
Documented systemic observability gaps in the producer-audit inventory (task 0235 deliverable).

- `docs/inventory/system-events-producer-audit.md:153–198` — **Systemic Observability Gaps** section (Gaps 1–4).
- Gap 1 CLI event-tap: `registerSystemEventTap` only at `apps/server/src/serve.ts:274`; no CLI registration under `apps/cli/src/`.
- Gap 2 queue gating: `jobQueueEnabled` default false at `context.ts:265`; throws at `context.ts:450–451` / `468–469`; wired via `createQueueConsumer` at `context.ts:472–474` when `bootConfig.jobqueue.enabled` (`serve.ts:243`, `287`).
- Gap 3 `process.started` side-channel: `agent-service.ts:312` `processEvents` wiring; supervisor uses `process.spawned` instead.
- Gap 4 nested-CLI: child process-local bus; marked ⚠️ deferred (not ❌ unwired) in legend + Gap 4 + footer §1 (`serve.ts:137–145`).
- Prefix-family observability path table under Gap 1 (R2).
- Supersede note header + footer §3 references task 0226 (R4).
### Testing
**Verify run:** 2026-07-11 — `/sp:dev-verify 0238 --auto --focus all --fix all --force` (standalone re-audit of `done` task).

**Coverage:** N/A (documentation-only change; no runtime code path added).

**Command / static evidence (this run):**
```
# Section presence + required claims
Systemic Observability Gaps: present (Gaps 1–4)
CLI event-tap / jobqueue.enabled / process.started side-channel / nested-CLI deferred: present
Prefix-family observability path table: present
Supersede task 0226: present (header + footer §3)

# Source re-verification
serve.ts:274 registerSystemEventTap  — OK
apps/cli/src: no registerSystemEventTap — OK
context.ts:265 jobQueueEnabled default false — OK
context.ts:450–451 / 468–469 NotConfiguredError when disabled — OK
context.ts:472–474 createQueueConsumer — OK
agent-service.ts:312 processEvents bridge — OK
SYSTEM_EVENT_CATALOG queue.* count = 7 — OK
```

**`--fix all` applied this run:**
1. Refreshed drifted line numbers in Gaps 2–3 (`context.ts` job-queue accessors, `agent-service.ts:312`).
2. Corrected section intro "Three" → "Four" architectural constraints (Gaps 1–4).
3. Testing expanded with deterministic verification evidence; Solution given `file:line` cites.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Gaps section documents (a) CLI tap gap, (b) queue config gating, (c) process.started side-channel (+ Gap 4 nested-CLI) |
| R2 | MET | Prefix-family path table under Gap 1: server-API / config-gated / agent-run side-channel classifications |
| R3 | MET | Nested-CLI marked ⚠️ deferred in legend, Gap 4, footer §1 — not ❌ unwired |
| R4 | MET | Header supersedes + footer §3 reference task 0226 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| (section empty / placeholder only) | N/A | n/a | No checklist/Gherkin AC; verified via R1–R4 |

**Design conformance:** task `### Design` empty; matches Background architectural-constraint framing. DONE.

**SECUA Review (answer-file; Review section owned by `/sp:dev-review`)**

| Sev | Dim | Finding |
|-----|-----|---------|
| — | S | Doc-only; no executable surface. |
| minor | C | Line numbers will drift as sources edit — refreshed this run. |
| — | U | Gap section framed as non-bugs with activation paths for operators. |
| — | A | Single inventory SSOT continues from 0235. |

No blocker/major findings.

**Verdict:** PASS — R1–R4 MET (doc-only, source-verified).
### Review
PASS. All four systemic gaps are documented with source-verified line numbers. The section is clearly framed as architectural constraints, not bugs.

Residual risk: none — documentation deliverable. The gaps section should be reviewed if any of the gating conditions change (e.g., if CLI tap registration is added, or if `jobqueue.enabled` default flips).
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:06.481Z todo → done (system)
