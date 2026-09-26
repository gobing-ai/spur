---
schema_version: 1
name: "Deepen AgentService: inject shims via AgentServiceContext and extract executor-tier policy"
status: cancelled
template: standard
created_at: 2026-09-26T04:37:18.421Z
updated_at: "2026-09-26T04:39:45.064Z"

---

## 0963. Deepen AgentService: inject shims via AgentServiceContext and extract executor-tier policy

### Background

**Superseded by 0965** (2026-09-25). Created from review candidate C3, then rescoped before any work: the module-level warn-once sets in `packages/app/src/services/agent-service.ts:2873-2912` (`warnedBareBinary`, `warnedAgentDefaultExecutor`, reset via `_resetAgentServiceShimsForTest`) back `@transition-shim` warnings that carry explicit removal conditions (`config/transition-shims.json`: `agent-bare-binary-name`, `agent-default-executor`). Injecting that state through `AgentServiceContext` would build plumbing for code scheduled for deletion; the test-reset export disappears with the shims. The remaining, durable part of C3 (executor-tier policy extraction) is task 0965.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T04:38:48.673Z backlog → cancelled (system)

