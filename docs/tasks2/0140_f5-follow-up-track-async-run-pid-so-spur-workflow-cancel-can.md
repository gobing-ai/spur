---
template: issue
schema_version: 1
name: "F5 follow-up — track async-run pid so `spur workflow cancel` can kill the in-flight subprocess"
description: ""
status: todo
type: issue
profile: standard
feature_id: null
parent_wbs: "0130"
priority: P3
tags: ["bug"]
dependencies: []
created_at: "2026-06-27T16:04:19.603Z"
updated_at: 2026-06-27T16:04:19.604Z
---

## 0140. F5 follow-up — track async-run pid so `spur workflow cancel` can kill the in-flight subprocess

### Background

Child of 0130 (dogfood findings). Follow-up to 0138 (F5).

0138 shipped `spur workflow cancel <run-id>` as a discoverable single-run finalize verb, but DEFERRED the subprocess-kill half (R2): there is no runId→pid mapping. The async path does `Bun.spawn({...}).unref()` and discards the returned pid (`apps/cli/src/commands/workflow.ts:129-133`); the `runs` table has no pid column (`drizzle/0000_spur_cli_foundation.sql:11`). So `cancel` today marks the run record `failed` but cannot reach the live subprocess — an operator cancelling a long `agent.run` still has to kill the process by hand.

Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md. Prior task: docs/tasks2/0138_f5-spur-workflow-cancel-run-id-verb.md.

Files in scope: a migration adding a `pid` column to `runs` (packages/domain/src/migrations.ts + drizzle/), the async-spawn path in apps/cli/src/commands/workflow.ts (record the pid), and WorkflowService.cancel (packages/app/src/services/workflow-service.ts) — `process.kill(pid)` with alive-check + stale-pid tolerance before finalizing.

### Root Cause

### Solution

### Testing

### Review

### References

### History
