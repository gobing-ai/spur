---
template: feature-impl
schema_version: 1
name: spur message watch verb (0193 wave B)
description: ""
status: todo
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,cli,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.854Z
updated_at: 2026-07-04T04:17:46.664Z
---

## 0205. spur message watch verb (0193 wave B)

### Background

Wave B of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Delivers `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`: a blocking follower that POLLS the store via TeamService (serverless is the contract — no server required), surfaces each new message as it arrives, emits one JSON object per line under `--json` (machine-consumable by agent wrappers), and exits cleanly on SIGINT. Semantics: watch SURFACES, it never consumes — read-marking stays with `--drain`/explicit reads, which makes watch safe beside drain loops. SSE-follow when serve is up is optional — implement only if trivial, else scoped follow-up. Independent of wave A (poll path reads the store directly), so it can start in parallel.

### Requirements
- [ ] R1 — `watch` verb with poll baseline, `--interval` (sane default), `--json` JSON-lines output, SIGINT-clean exit; registered in helpText. (Parent R4)
- [ ] R2 — Watch never marks messages read; asserted by test. (Parent R4)
- [ ] R3 — Injected-interval tests — no real sleeps; new-message surfacing within one tick. (Parent R7)
- [ ] R4 — Full gate green. (Parent R8)
### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: A watching agent observes new messages without restart
    Given an agent session is running spur message watch
    When another agent sends it a message
    Then the watcher surfaces the new message within the follow interval
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Watch verb**: `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`. Poll baseline via TeamService (serverless is the contract — no server required); one JSON object per line under `--json` (agent-wrapper consumable); SIGINT-clean exit. Semantic invariant: watch SURFACES and never consumes — no read-marking (that stays with `--drain`/explicit reads), which makes watch safe beside drain loops; assert it in a test. SSE-follow is optional — only if trivial, else scoped follow-up. Depends on: nothing hard (reads the store directly; can run parallel to 0204). Downstream: 0207+ supervised loops.
### Plan
- [ ] `watch` verb: poll loop with injected interval, `--json` JSON-lines, SIGINT-clean; helpText entry (R1).
- [ ] No-consume semantics asserted by test (R2).
- [ ] Injected-interval tests — surfacing within one tick, no real sleeps (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R4).
- [ ] Manual two-terminal check: watch + send; evidence in Testing.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
