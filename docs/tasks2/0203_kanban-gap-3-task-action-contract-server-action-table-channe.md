---
template: feature-impl
schema_version: 1
name: "Kanban gap 3: task.action contract, server action table, channel modal (0191 wave B)"
description: ""
status: todo
type: task
profile: standard
feature_id: F7
parent_wbs: "0191"
priority: P1
tags: ["approach-c", "contracts", "server", "web", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.852Z"
updated_at: "2026-07-04T04:17:31.734Z"
---

## 0203. Kanban gap 3: task.action contract, server action table, channel modal (0191 wave B)

### Background

Wave B of parent 0191 (Task Kanban parity closure) — read the parent's Background and Design first; gap 3 detail in `docs/analysis/task-kanban-gap-analysis-v2.md` §3. Spans the full seam: extend the `task.action` oRPC input (`packages/contracts/src/task.ts`) with `channel` (literal agent-name union — no domain-type imports into contracts) and `skipDeps`; implement all six action kinds in `apps/server/src/modules/task/handlers.ts` via an action→invocation table (PREFERRED channel: enqueue a `task-action` job on the 0190 queue → worker executes via `AgentService.executeRun` with the translated slash command; documented direct-spawn fallback if 0190 hasn't merged); channel-selection modal in the web detail panel. Unknown action → typed error, never 404. Bun-gate the execution path (CF has no process execution).

### Requirements
- [ ] R1 — Contract: `task.action` input gains `channel` + `skipDeps`; router still binds via `implement(contract)`; contract round-trip test. (Parent R3)
- [ ] R2 — Server: action table for refine/plan/run/verify/decompose/evaluate; queue-enqueue channel (or documented fallback + scoped follow-up); typed unknown-action error; handler tests per kind with the execution seam mocked. (Parent R4)
- [ ] R3 — Web: channel modal (channel + skip-dependencies) before POST; result/error surfaced; component test. (Parent R5)
- [ ] R4 — Record the final action→command table in the parent's Design section. (Parent Design)
- [ ] R5 — Full gate green incl. `test-cf`; manual: every action button reaches the server without 404. (Parent R7)
### Acceptance Criteria
```gherkin
Feature: Task Kanban web parity

  Scenario: Workflow actions prompt for a channel and reach the server
    Given a task detail panel is open
    When the user triggers a workflow action other than run
    Then a modal collects the agent channel and skip-dependencies choice
    And the server executes the action instead of returning 404
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0191's Design owns the full approach — this slice implements **Gap 3** end-to-end: `task.action` contract input gains `channel` (literal union `claude|codex|gemini|pi|opencode|antigravity|openclaw` — transport DTO, no domain imports) + `skipDeps` in `packages/contracts/src/task.ts` (router binds via `implement(contract)` — drift is a compile error); `apps/server/src/modules/task/handlers.ts` implements all six kinds via an action→invocation table — PREFERRED execution channel is enqueueing a `task-action` job on 0190's queue (worker runs `AgentService.executeRun` with the translated slash command; slash translation exists in agent-service), with a documented direct-spawn fallback + scoped follow-up if 0190 hasn't merged; unknown action → typed error, never 404; execution path Bun-gated (CF no process execution). Web: channel modal (channel + skipDeps) before POST, result/error surfaced. Record the final action→command table in parent 0191's Design. Depends on: soft on 0200/0201 (queue channel). Independent of 0202.
### Plan
- [ ] Contract: extend `task.action` input; compile-bind + round-trip test (R1).
- [ ] Server: action table for all six kinds via queue-enqueue (or documented fallback); typed unknown-action error; per-kind handler tests with execution seam mocked (R2).
- [ ] Web: channel modal + POST wiring + result/error surface; component test (R3).
- [ ] Record action→command table in parent 0191 Design (R4).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; manual: no action button 404s (R5).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F7

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
