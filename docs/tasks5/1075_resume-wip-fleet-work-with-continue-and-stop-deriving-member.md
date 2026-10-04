---
schema_version: 1
name: Resume wip fleet work with --continue and stop deriving member ids from executors
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:37.131Z
updated_at: "2026-10-04T20:33:17.112Z"
feature_id: G71

dependencies: ["1073"]
---

## 1075. Resume wip fleet work with --continue and stop deriving member ids from executors

### Background

Implements G71 R5 and R6 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 5 and 6; decision D5; ADR-126 amendment A4).

Verified state (2026-10-04):

- H1: GTD candidates are `status: 'todo'` only (`strategy-runtime.ts:428`); a wip task is invisible, and the prompt never carries `--continue` although `/sp:dev-run` supports it (`plugins/sp/commands/dev-run.md:22`).
- H2: `spur agent run --spec-id` is refused without the orchestrator's `beforeDispatch` (`packages/app/src/services/agent-service.ts:1039-1040`), so the operator cannot resume a fleet task.
- H5: pinning `executor` without `id` renames the instance (`packages/config/src/index.ts:459`, `memberLocalId`), e.g. `spur-new-pi-k3`.

### Requirements

- [ ] R1. GTD candidates are `todo ∪ wip` carrying `fleet:auto`; a wip task, or one whose prior run is not done, is dispatched with `--continue`.
- [ ] R2. Delete the `beforeDispatch` guard branch at `agent-service.ts:1039`; operator resume is `spur message send --to <member> "/sp:dev-run <wbs> --continue"`.
- [ ] R3. `memberLocalId` falls back to `<role>-<n>`; a pinned executor never changes the id.
- [ ] R4. A config whose addressing relied on an executor-derived id fails at load with a fix-it error naming the new id and `id:` as the pin; the release note records the break.

### Acceptance Criteria

- [ ] AC1 — Interrupted fleet work resumes
- [ ] AC2 — Member identity does not follow the executor

Task-local verification:

- A wip `fleet:auto` task is selected and its prompt ends with `--continue`.
- `spur agent run --spec-id <member>` is no longer refused for lack of `beforeDispatch`.
- A member with `executor: pi` and no `id` resolves to `coder-1`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History
