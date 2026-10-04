---
schema_version: 1
name: Resume wip fleet work with --continue and stop deriving member ids from executors
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:37.131Z
updated_at: "2026-10-04T20:57:41.489Z"
feature_id: G71

dependencies: ["1073"]
priority: P1
estimate_hours: 4
---

## 1075. Resume wip fleet work with --continue and stop deriving member ids from executors

### Background

Implements G71 R5 and R6 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 5 and 6; decision D5; ADR-126 amendment A4).

Verified state (2026-10-04):

- H1: GTD candidates are `status: 'todo'` only (`strategy-runtime.ts:428`); a wip task is invisible, and the prompt never carries `--continue` although `/sp:dev-run` supports it (`plugins/sp/commands/dev-run.md:22`).
- H2: `spur agent run --spec-id` is refused without the orchestrator's `beforeDispatch` (`packages/app/src/services/agent-service.ts:1039-1040`), so the operator cannot resume a fleet task.
- H5: pinning `executor` without `id` renames the instance (`packages/config/src/index.ts:459`, `memberLocalId`), e.g. `spur-new-pi-k3`.

**Refine corrections (2026-10-04)**

- R3 says the id "falls back to `<role>-<n>`". The current `memberLocalId` order is `id` → executor (dedup suffix `-<pos>`) → `<role>-<n>` (`packages/config/src/index.ts:459`) → the new order is `id` → `<role>-<n>` when `role` is set → executor-derived only for members with no role. Role-only and no-role members are byte-identical to today.
- R4 says to fail at load "when addressing relied on the executor-derived id", but config load cannot see addressing → the check becomes deterministic. A member whose id changes under the new order **and** whose old id has recorded occupancy fails `FleetService.resolve` with a fix-it error. Occupancy means a `fleet.member-session` ledger row (`readMemberSessions`) or a `coordination_runs` row (`getLatestBySpecId`). New projects get role ids silently.
- "The release note records the break": `CHANGELOG.md` is generated from conventional commits → the commit carries a `BREAKING CHANGE:` footer.

### Requirements

- [ ] R1. GTD candidates are `todo ∪ wip` carrying `fleet:auto`; a wip task, or one whose prior run is not done, is dispatched with `--continue`.
- [ ] R2. Delete the `beforeDispatch` guard branch at `agent-service.ts:1039`; operator resume is `spur message send --to <member> "/sp:dev-run <wbs> --continue"`.
- [ ] R3. `memberLocalId` order becomes `id` → `<role>-<n>` (role set) → executor-derived (no role); a pinned executor never changes a role member's id.
- [ ] R4. A member whose id changes under the new order and whose old id has recorded occupancy (`fleet.member-session` ledger rows or `coordination_runs.spec_id`) fails `FleetService.resolve` with a fix-it error naming both ids and `id:` as the pin; the commit carries a `BREAKING CHANGE:` footer (CHANGELOG is generated from commits).

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

#### Q&A entry — 2026-10-04T20:57:05.239Z

- **Q: What does "prior run is not done" mean?** A: A keyed attempt `fleet:task:<wbs>:<n>` exists (from 1073) and the task is still `todo` or `wip`. Both the wip status and that condition append `--continue`.
- **Q: Couldn't a wip task be re-dispatched while it is still running?** A: No. 1073's `dispatch-in-flight` hold covers any attempt whose receipt is not terminal.
- **Q: Does the guard deletion lose the 1074 relaxation?** A: The branch is removed entirely; the fleet spec lookup and `assertLaunchGroundTruth` stay.
- **Q: Which error text does the R4 check produce?** A: `agent.fleet member #<i> (role <r>, executor <e>): its id changes from "<old>" to "<new>" (ADR-126 A4) and "<old>" has recorded runs. Add \`id: <old>\` to keep the old address, or \`id: <new>\` to adopt the new one.`

### Design

**Candidates** (`packages/app/src/services/strategy-runtime.ts`)
- `:428` lists `todo` and `wip` (two `tasks.list` calls or one status-array call, whichever `TaskService.list` supports), then filters by `FLEET_AUTO_TAG`.
- `gtdStrategy.select` (`:151`) accepts `status ∈ {todo, wip}`; `not-ready` is reserved for other statuses.

**Prompt.** The 1073 `tick` body becomes `/sp:dev-run <wbs> --auto` + ` --continue` when `status === 'wip'` or the wbs has a prior keyed attempt. `/sp:dev-run` supports `--continue` (`plugins/sp/commands/dev-run.md:22`).

**Guard** (`agent-service.ts:1024-1042`). Delete the `beforeDispatch === undefined` refusal and its message "Fleet dispatch requires the owning orchestrator loop". Keep the spec lookup and `assertLaunchGroundTruth`.

**Identity** (`packages/config/src/index.ts:459` `memberLocalId`). Within the allocator loop:
- `current.id` wins
- else, if `current.role !== undefined`, use `<role>-<n>` over role members in declaration order
- else use the executor-derived id with the existing `-<pos>` dedup

The allocator must still never collide with an explicit id. Update the doc comment (0543 R3, 0685 R4 notes).

**Legacy check** (`packages/app/src/services/fleet-service.ts` `resolve`). For each member with `role` and `executor` and no `id`:
- compute `legacy` = the pre-change id (executor-derived over the same roster)
- if `legacy !== new` and `readMemberSessions(db, [legacy])` or `CoordinationRunDao.getLatestBySpecId(legacy)` is non-empty, throw the Q&A error

Docs: `docs/design/fleet-config-declaration.md` §2 (member id rule).

**Tests to update:**
- `packages/config/tests/*memberLocalId*` (find with `rg -l memberLocalId packages/config/tests`)
- `packages/app/tests/services/{strategy-runtime,fleet-service}.test.ts`
- the guard test from 1074

### Plan

1. Write the failure list first as tests:
   - a wip `fleet:auto` task is skipped as `not-ready`
   - the prompt lacks `--continue`
   - a spec-id run is refused
   - `executor: pi` + `role: coder` resolves to `pi`
   - a legacy id with runs is silently renamed
2. Change `memberLocalId` and update the config tests.
3. Add the legacy-occupancy check in `FleetService.resolve` and its test.
4. Change the candidate list and `gtdStrategy` status gate; append `--continue` in `tick`.
5. Delete the guard branch.
6. Update §2 of `docs/design/fleet-config-declaration.md`.
7. Gates:
   - focused config/app tests
   - `bun run spur-check`
   - commit with a `BREAKING CHANGE:` footer

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

- 2026-10-04T20:57:41.489Z backlog → todo (system)

