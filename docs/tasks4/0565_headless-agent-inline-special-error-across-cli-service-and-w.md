---
template: feature-impl
schema_version: 1
name: "Headless --agent inline special error across CLI, service, and workflow action"
description: ""
status: todo
type: task
profile: standard
feature_id: G5
parent_wbs: null
priority: P2
tags: ["agent", "cli-surface", "adr-047"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-15T16:12:04.361Z"
updated_at: "2026-08-15T16:18:09.754Z"
---

## 0565. Headless --agent inline special error across CLI, service, and workflow action

### Background
Explicit `--agent inline` is silently ≡ omit → `agent.default` on headless surfaces (agent-service resolution ~:1131-1136, workflow agent-run ~:129-133), so an inline request can execute in another session with zero signal — the debugging trap feature G5 removes. Design: docs/design/agent-inline-host-session.md. Error contract (operator decision 2026-08-15): hard error, no fallback, split by class — `inline` on a headless surface gets a stable greppable message at exit 2; invalid names keep the existing 0536 R3 flag-boundary rejection.
### Requirements
- [ ] **R1.** CLI boundary: `spur agent run --agent inline` exits 2 with the stable, greppable special-error message (a tested constant naming `inline` and the surface's inability to host a session); no agent process spawns and no `agent.default` fallback occurs. `--agent` help text lists `inline`. Measurable: a CLI test asserts exit code + message + zero spawn.
- [ ] **R2.** Defense in depth: `packages/app/src/services/agent-service.ts` resolution and `packages/app/src/workflow/actions/agent-run.ts` no longer normalize `inline` to `agent.default` — the same special error surfaces from both layers. Workflow YAMLs needing a headless default use `omit`/`agent.default` explicitly. Measurable: service-level and workflow-action tests assert the error.
- [ ] **R3.** `omit`, `--agent auto`, and named role/executor selectors keep current behavior (0508 native-subagent eligibility is omit-only and untouched). Measurable: regression tests over the three selector classes stay green. Same commit carries the ADR-047 amendment, `docs/04_DESIGN.md` §7.8 update, and the `docs/design/` index row (T3).
### Acceptance Criteria
Covers feature G5 scenarios:

- **R1 — Headless CLI surfaces reject --agent inline with a stable special error**
- **R3 — omit, auto, and named selectors are unchanged**

```gherkin
Scenario: R1 — Headless CLI surfaces reject --agent inline with a stable special error
  Given `spur agent run` is a headless surface that cannot host a session
  When it is invoked with `--agent inline`
  Then the run exits non-zero with a stable, greppable error message naming `inline`
  And no agent process is spawned and no fallback to `agent.default` occurs

Scenario: R3 — omit, auto, and named selectors are unchanged
  Given the existing resolution paths for omitted `--agent`, `--agent auto`, and named roles
  When this feature lands
  Then their behavior, including 0508 native-subagent eligibility for omit, is unchanged
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Per docs/design/agent-inline-host-session.md § Components 1-3,6: (1) `apps/cli/src/commands/agent.ts` inline branch in validateAgentSelector/runAgentRun — special error constant, exit 2, no spawn; help lists inline. (2) agent-service resolution: remove inline→resolveAgentAuto; resolution fails with the same error; ADR-047 comment updated. (3) workflow agent-run action: remove inline→agentConfig.default normalization; surface the error. (6) tests at CLI/service/workflow-action layers plus omit/auto/named regression. T3: ADR-047 amendment + docs/04 §7.8 + satellite index row in the same commit.
### Plan
- [ ] Locate the current inline≡omit normalization in agent-service resolution and agent-run action; define the shared special-error constant (R1, R2)
- [ ] CLI boundary branch + help text; CLI test: exit 2, message, zero spawn (R1)
- [ ] Service resolution + workflow action de-normalization with layer tests (R2)
- [ ] Regression tests: omit/auto/named unchanged (R3)
- [ ] ADR-047 amendment + docs/04_DESIGN.md §7.8 + docs/design index row (T3, same commit)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
