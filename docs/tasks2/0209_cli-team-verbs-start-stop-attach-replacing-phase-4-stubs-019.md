---
template: feature-impl
schema_version: 1
name: "CLI team verbs: start, stop, attach replacing Phase-4 stubs (0195 wave C)"
description: ""
status: todo
type: task
profile: standard
feature_id: G2
parent_wbs: "0195"
priority: P2
tags: ["approach-c", "cli", "collaboration", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.857Z"
updated_at: "2026-07-04T04:18:16.255Z"
---

## 0209. CLI team verbs: start, stop, attach replacing Phase-4 stubs (0195 wave C)

### Background

Wave C of parent 0195 (team process supervision) — read the parent's Background and Design first. Depends on wave B (server endpoints). Replaces the Phase-4 stubs in `apps/cli/src/commands/team.ts`: `spur team start [--agent <id>]` (autostart set or one agent), `spur team stop` (graceful terminate, registry reflects stopped), `spur team attach <agent-id>` (consume the SSE stream to the terminal via Bun fetch streaming, forward terminal stdin lines to the POST endpoint, Ctrl-C detaches WITHOUT killing the child). Attach requires `spur serve` running — clear error when it is not. `--json` where output is structured.

### Requirements
- [ ] R1 — `start`/`stop` verbs over the supervisor/server surface; stub code removed; helpText updated. (Parent R6)
- [ ] R2 — `attach`: SSE consume + stdin forward + Ctrl-C detach (child unaffected); clear no-server error. (Parent R6)
- [ ] R3 — Unit tests for framing/flow with the transport mocked; stop-gracefully asserted. (Parent R8)
- [ ] R4 — Full gate green; manual e2e (echo-loop spec: start → attach → stdin → output → detach → stop) recorded in parent Testing. (Parent R9)
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: Team stop terminates processes gracefully
    Given supervised processes are running
    When spur team stop runs
    Then the processes terminate gracefully and the registry reports them stopped
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0195's Design owns the full approach — this slice implements **CLI**: replace the Phase-4 stubs in `apps/cli/src/commands/team.ts` with `spur team start [--agent <id>]` (autostart set or one agent), `spur team stop` (graceful terminate, registry reflects stopped), `spur team attach <agent-id>` (consume the SSE stream to the terminal via Bun fetch streaming; forward terminal stdin lines to the POST endpoint; Ctrl-C detaches WITHOUT killing the child). Attach requires `spur serve` — clear error when absent. `--json` where structured. `spur team assign|status` semantics unchanged. Depends on: 0208 (endpoints). The parent's manual e2e (echo-loop spec: start → attach → stdin → output → detach → stop) is executed here and recorded in parent 0195's Testing.
### Plan
- [ ] `start`/`stop` verbs over supervisor/server surface; stubs removed; helpText updated (R1).
- [ ] `attach`: SSE consume + stdin forward + Ctrl-C detach; clear no-server error (R2).
- [ ] Unit tests with transport mocked; graceful-stop asserted (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; manual e2e recorded in parent 0195 Testing (R4).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
