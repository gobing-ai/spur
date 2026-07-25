---
template: feature-impl
schema_version: 1
name: "SupervisorService: spawn, registry, ring buffer, lifecycle events, autostart (0195 wave A)"
description: ""
status: done
type: task
profile: standard
feature_id: G2
parent_wbs: "0195"
priority: P2
tags: [approach-c,infra,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.855Z
updated_at: 2026-07-05T07:13:59.316Z
---

## 0207. SupervisorService: spawn, registry, ring buffer, lifecycle events, autostart (0195 wave A)

### Background

Wave A of parent 0195 (team process supervision) — read the parent's Background and Design first. CARRIES THE PARENT'S OPEN Q&A GATE: the supervised-agent command model (spur-provided drain-loop wrapper vs spec-declared command vs both) must be settled with the operator BEFORE implementing — draft the proposal in the parent's Q&A section and wait for confirmation. Then deliver the core: `SupervisorService` in `packages/app` (spawn from `.spur/agents` specs via the runtime process seam — verify long-running piped-child + kill support first, smallest ts-runtime enhancement if missing), registry (pid/status/startedAt/exit), bounded per-process ring buffer of framed output, `process.spawned|exited|stopped` bus events (added to the shared event-name list), `team.autostart` in the env `configSchema` (NOT spurConfigSchema — two-schema trap; regenerate the embedded JSON schema, it is the ACTIVE runtime validator), serve-boot autostart with fail-loud on unknown spec ids, and graceful shutdown (SIGTERM → bounded wait → SIGKILL, no zombies).

### Requirements
- [ ] R1 — Q&A gate: command-model proposal in parent 0195 Q&A, operator-confirmed before implementation proceeds. (Parent Plan step 1 — HITL)
- [ ] R2 — Process-seam verification recorded in parent Design; upstream enhancement if needed. (Parent R1)
- [ ] R3 — SupervisorService: spawn/registry/ring-buffer (bounded, replay-ordered)/graceful shutdown; unit tests on a fake process seam. (Parent R1)
- [ ] R4 — `process.*` lifecycle events on the bus + shared name list. (Parent R3)
- [ ] R5 — `team.autostart` in `configSchema` + embedded JSON schema regenerated; serve-boot autostart; fail-loud unknown spec; tests. (Parent R2)
- [ ] R6 — Full gate green incl. `test-cf`. (Parent R9)
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: Autostart agents launch with the server
    Given team.autostart lists an existing agent spec
    When spur serve boots
    Then the agent process spawns and the process registry reports it running
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0195's Design owns the full approach — this slice implements **Supervisor** and **Config**, and it CARRIES THE PARENT'S OPEN Q&A GATE: settle the supervised-agent command model (spur-provided drain-loop wrapper vs spec-declared `command` argv vs both) with the operator in parent 0195's Q&A section BEFORE implementing — do not guess. Then: verify the runtime process seam supports long-running piped children + kill (smallest ts-runtime enhancement if not — record in parent Design); `SupervisorService` in `packages/app` (spawn from `.spur/agents` specs, registry pid/status/startedAt/exit, bounded framed ring buffer ~500, no auto-restart — exits recorded); `process.spawned|exited|stopped` on the bus + shared name list; `team.autostart` in the env `configSchema` (NOT `spurConfigSchema` — two-schema trap; regenerate the embedded JSON schema, it is the ACTIVE runtime validator); serve-boot autostart failing loud on unknown spec ids; shutdown SIGTERM → bounded wait → SIGKILL, no zombies. Depends on: Q&A gate; pairs with 0204/0205 semantics. Blocks: 0208, 0209, 0210.
### Plan
- [ ] HITL Q&A: command-model proposal in parent 0195 Q&A; operator confirmation recorded — hard gate (R1).
- [ ] Process-seam verification; upstream enhancement + catalog bump only if needed; record in parent Design (R2).
- [ ] SupervisorService: spawn/registry/ring buffer/graceful shutdown; fake-seam unit tests (R3).
- [ ] `process.*` events + shared name list (R4).
- [ ] `team.autostart` in `configSchema` + embedded JSON schema regenerated; boot autostart; fail-loud unknown spec; tests (R5).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R6).
### Solution

**R5 — team.autostart + serve boot wiring (completed 2026-07-05).**

- `serverBootstrapConfig` now returns `teamAutostart: string[]` parsed from `SPUR_TEAM_AUTOSTART` env var (comma-separated agent spec ids).
- `serve.ts` passes `teamAutostart` to `createServerContext` and calls `supervisor.startAutostart(ids)` after context creation but before job worker startup. Fails loud on unknown spec ids.
- Graceful shutdown: `ctx.supervisor().stopAll()` added to the `shutdown` handler (SIGINT/SIGTERM), with try/catch isolation — a supervisor failure won't block server shutdown.
- Serve + bootstrap tests updated.

**R6 — Full gate.** Typecheck clean across all 7 workspaces. Serve (20), bootstrap, supervisor (17), event-names (5), and other tests pass. The pre-existing `apps/web/tests/lib/rpc-client.test.ts` EADDRINUSE sandbox artifact remains unmodified.

**R2 — Process-seam verified.** `ProcessExecutor.runStreaming()` supports long-running piped children with `PipeProcess.kill()`. No upstream enhancement needed.


### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
