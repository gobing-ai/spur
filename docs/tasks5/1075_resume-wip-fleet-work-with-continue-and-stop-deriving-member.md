---
schema_version: 1
name: Resume wip fleet work with --continue and stop deriving member ids from executors
status: done
template: feature-impl
created_at: 2026-10-04T20:30:37.131Z
updated_at: "2026-10-06T17:06:36.710Z"
feature_id: G71

dependencies: ["1073"]
priority: P1
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1075-verdict.json
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

- [x] R1. GTD candidates are `todo ∪ wip` carrying `fleet:auto`; a wip task, or one whose prior run is not done, is dispatched with `--continue`.
- [x] R2. Delete the `beforeDispatch` guard branch at `agent-service.ts:1039`; operator resume is `spur message send --to <member> "/sp:dev-run <wbs> --continue"`.
- [x] R3. `memberLocalId` order becomes `id` → `<role>-<n>` (role set) → executor-derived (no role); a pinned executor never changes a role member's id.
- [x] R4. A member whose id changes under the new order and whose old id has recorded occupancy (`fleet.member-session` ledger rows or `coordination_runs.spec_id`) fails `FleetService.resolve` with a fix-it error naming both ids and `id:` as the pin; the commit carries a `BREAKING CHANGE:` footer (CHANGELOG is generated from commits).

### Acceptance Criteria

- [x] AC1 — Interrupted fleet work resumes
- [x] AC2 — Member identity does not follow the executor

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

Interrupted fleet work resumes, and a member's id no longer follows its executor (R1–R4).

**Resume (R1).** GTD candidates are `todo` ∪ `wip` — the two reads are merged and deduped by wbs, so a
repeated candidate can never be dispatched twice in one tick. `gtdStrategy.select` accepts both statuses
and `not-ready` is reserved for everything else, including the runtime's own readiness gate. The tick's
dispatch body gains `--continue` when the task is `wip` or when it already carries a keyed
`fleet:task:<wbs>:<n>` attempt whose receipt is not in flight — the Q&A's "prior run is not done"
condition, taken from the attempt rows 1073 introduced. A wip task cannot be re-dispatched while its
attempt is still running: 1073's `dispatch-in-flight` hold covers any attempt without a terminal receipt.

**Operator resume (R2).** The `beforeDispatch` refusal is deleted outright. It made every fleet member
unaddressable: a drained run physically cannot carry the orchestrator's `beforeDispatch`, and neither can
`spur agent run --spec-id <member>`, so the guard blocked exactly the resume path it was never meant to
cover. The fleet spec lookup and both `assertLaunchGroundTruth` calls stay — those are the launch safety,
not the dispatch-authorization rule. Resume is now
`spur message send --to <member> "/sp:dev-run <wbs> --continue"`.

**Identity (R3).** `memberLocalId` derives `id` → `<role>-<n>` (role set) → executor-derived (no role), so
pinning an executor on a role member no longer renames it. Every derived id now passes the same
collision guard, which the role branch previously lacked: a role-derived id can no longer collide with an
explicit id already allocated. Role-only and role-less members are byte-identical to before, so only the
`role` + `executor` + no-`id` shape changes — and that shape is precisely the one whose address used to
move when an executor was swapped.

**The rename fails closed (R4).** The member id IS the address occupancy is recorded against, so
`FleetService.resolve` refuses to rename a member that already has occupancy under its old id.
`legacyMemberLocalId` freezes the pre-1075 derivation for exactly this comparison; the check runs only for
a member with `role`, `executor` and no `id` whose id actually changes, and only when
`readMemberSessions` or `CoordinationRunDao.getLatestBySpecId` reports occupancy for the old instance id.
The error names both ids, the member's index/role/executor, and the two `id:` pins that resolve it. A
project with no recorded occupancy adopts the new ids silently. The commit carries a `BREAKING CHANGE:`
footer, which is what generates the release note (CHANGELOG is derived from conventional commits).

| Change | Anchor |
| --- | --- |
| `memberLocalId` order: id → role → executor, every derived id collision-checked | `packages/config/src/index.ts:471` |
| The pre-1075 derivation frozen for the migration comparison | `packages/config/src/index.ts:523` |
| `resolve` refuses to rename a member with recorded occupancy, naming both ids and both pins | `packages/app/src/services/fleet-service.ts:448` |
| Candidates are todo ∪ wip, deduped by wbs | `packages/app/src/services/strategy-runtime.ts:604` |
| gtd accepts todo and wip; `not-ready` reserved for other statuses | `packages/app/src/services/strategy-runtime.ts:211` |
| `--continue` when the task is wip or has a prior keyed attempt | `packages/app/src/services/strategy-runtime.ts:453` |
| Dispatch body carries `--continue` | `packages/app/src/services/strategy-runtime.ts:468` |
| `beforeDispatch` refusal deleted (spec lookup and ground-truth stay) | `packages/app/src/services/agent-service.ts:1049` |
| Member id rule documented, including the boundary and the fix-it error | `docs/design/fleet-config-declaration.md:60` |

Tests: `packages/config/tests/member-local-id.test.ts` (role precedence, executor swap keeps the id,
role-less derivation unchanged, explicit id wins, collision guard, frozen legacy derivation);
`packages/app/tests/services/fleet-service.test.ts` (rename refused with occupancy, silent adoption
without it, explicit id untouched); `packages/app/tests/services/strategy-runtime.test.ts` (wip is
dispatchable, `--continue` for wip and for a failed prior attempt, plain dispatch without it);
`packages/app/tests/services/agent-service.test.ts` (a spec-id run is admitted, the orchestrator's guard
still runs); and the `#sp:dev-run` prompt contract in `apps/cli/tests/commands/agent-loop-wake.test.ts`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/strategy-runtime.ts:242` admits todo and wip fleet:auto candidates; the resume hint adds `--continue` at `packages/app/src/services/strategy-runtime.ts:489` and is appended to the directive at `packages/app/src/services/strategy-runtime.ts:504`. Tests (fresh): `packages/app/tests/services/strategy-runtime.test.ts:392`, `packages/app/tests/services/strategy-runtime.test.ts:943`, `packages/app/tests/services/strategy-runtime.test.ts:959`. |
| R2 | MET | The beforeDispatch refusal branch is gone from `packages/app/src/services/agent-service.ts:1072-1077`; test (fresh) `packages/app/tests/services/agent-service.test.ts:4505` runs an addressed fleet member with exit code 0 and no managed dispatch guard. |
| R3 | MET | memberLocalId order id, then role, then executor at `packages/config/src/index.ts:471`; frozen legacy derivation at `packages/config/src/index.ts:523`. Tests (fresh): `packages/config/tests/member-local-id.test.ts:190`, `packages/config/tests/member-local-id.test.ts:198`, `packages/config/tests/member-local-id.test.ts:204`, `packages/config/tests/member-local-id.test.ts:209`, `packages/config/tests/member-local-id.test.ts:214`. Breaking change footer on commit 1b3254c07. |
| R4 | MET | `packages/app/src/services/fleet-service.ts:441-466` refuses a member whose old id has recorded occupancy, naming both ids and the explicit id pin. Tests (fresh): `packages/app/tests/services/fleet-service.test.ts:957`, `packages/app/tests/services/fleet-service.test.ts:975`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Interrupted fleet work resumes | MET | test | `packages/app/tests/services/strategy-runtime.test.ts:943` (wip dispatched with --continue) and `packages/app/tests/services/strategy-runtime.test.ts:959` (failed prior attempt retried with --continue) — fresh, 426 pass. E2E this run: kill-redispatch row records attempt-2 directive `/sp:dev-run 0002 --auto --continue` (receipt `docs/reports/fleet-e2e-receipt.json:62`) (`.spur/run/G71-verifyall-e2e-final-2.log`). |
| AC2 — Member identity does not follow the executor | MET | test | `packages/config/tests/member-local-id.test.ts:190` (role id independent of the pinned executor) and `packages/app/tests/services/fleet-service.test.ts:957` (old-id occupancy fails with the fix-it error) — fresh this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of the 1075 diff (7 files: the member-id order and its frozen legacy twin, the occupancy check in
`resolve`, the candidate set, the `--continue` hint, the deleted guard branch, and the design satellite).
Dimensions: functional traceability (R1–R4), SECUA, architecture depth.

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P2 (major) | `memberLocalId`'s role branch had no collision guard, so making role outrank executor would have let a role-derived id (`coder-1`) collide with an explicit id of the same spelling declared earlier in the roster — two members sharing one address, i.e. one inbox. Latent before (role ids only raced other role ids) and reachable once role moved ahead of executor. Recognized while making the reorder and fixed before verify. | Fixed inside the reviewed diff: every derived id now runs the same `used`-set collision guard, role branch included, with the regression test "a role-derived id never collides with an explicit id already in the roster". |
| P3 (minor) | The snapshot reads the corpus twice (`tasks.list({status:'todo'})` + `wip`) because `TaskListFilters.status` accepts one value. At corpus scale that doubles per-tick file reads over a ~1k-file task folder. | Accepted: correctness-neutral, and the alternative (widening the domain filter to an array) is a bigger change than 1075's budget. Recorded as the upgrade path. Added a defensive dedupe by wbs so a repeated candidate can never be dispatched twice in one tick. |
| P3 (minor) | `legacyMemberLocalId` duplicates the pre-1075 allocator (~40 lines) and exists only for the migration comparison. | Accepted deliberately: a frozen reference must not drift, so it is a copy with a comment forbidding reuse as a live allocator rather than a parameterised "old mode" of the live one. |
| P3 (minor) | The occupancy check costs two reads per affected member on every `resolve()` (session ledger + latest coordination run). | Accepted: it fires only for members declaring `role` + `executor` with no `id`, and `resolve` is not a hot path. |
| P4 (advisory) | The `--continue` affordance is a string contract with `/sp:dev-run`; renaming that flag would silently drop resume. | Mitigated: the tick test asserts the exact body `/sp:dev-run <wbs> --auto --continue`, so a rename fails the suite rather than silently degrading. |
| P4 (advisory) | Deleting the `beforeDispatch` branch removes a defence-in-depth check for a spec-id run launched outside a loop. | Intended (R2): the branch blocked exactly the operator-resume path, and it could not distinguish "unauthorized dispatch" from "drained work". The spec lookup and both `assertLaunchGroundTruth` calls remain as the launch safety. |

No open P1; the single P2 was repaired inside the reviewed diff.

## Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 candidates are todo ∪ wip with `fleet:auto`; a wip task or one whose prior run is not done is dispatched with `--continue` | MET | candidate set `packages/app/src/services/strategy-runtime.ts:604`; status gate `:211`; resume hint `:453`; body `:468`; tests "a wip task is dispatched with --continue", "a todo task whose prior keyed attempt failed is retried with --continue", "a wip fleet:auto candidate is dispatchable", and the unchanged "a fresh todo task … WITHOUT --continue" path asserted by the existing tick test |
| R2 the `beforeDispatch` guard branch is deleted; operator resume is an inbox message | MET | `packages/app/src/services/agent-service.ts:1049`; test "fleet spec execution validates the actual launch context and no longer requires a managed dispatch guard" asserts a bare spec-id run is admitted while an orchestrator-supplied guard still runs |
| R3 `memberLocalId` order is id → `<role>-<n>` → executor-derived; a pinned executor never renames a role member | MET | `packages/config/src/index.ts:471`; tests "a role member keeps its role-derived id no matter which executor is pinned", "a member with no role still derives from its executor, unchanged", "an explicit id still wins", "a role-derived id never collides with an explicit id" |
| R4 a member whose id changes under the new order and whose old id has recorded occupancy fails `resolve` with a fix-it error; the commit carries a BREAKING CHANGE footer | MET | `packages/app/src/services/fleet-service.ts:448` with the frozen legacy derivation at `packages/config/src/index.ts:523`; tests "a member whose OLD executor-derived id already has runs is refused, naming both ids and both pins", "a project with no occupancy adopts the new role id silently", "an explicit id is never touched by the migration check"; the commit footer is part of this task's commit |

## Architecture depth

The identity change is one reordering plus one frozen reference, not a new identity system: the live
allocator stays the single place an id is born, and the legacy copy exists only so the refusal can name
what the member used to be called. The resume hint is likewise derived, not stored — it reads the attempt
rows 1073 already writes, so no new state is introduced. Deleting the guard *removes* a branch rather than
adding a flag, which is the shape this redesign has taken throughout: fewer paths, one owner per decision.

## Residual risk

- A wip task is dispatched whenever it is ready and no attempt is in flight; the correctness of "not in
  flight" rests on 1073's receipt semantics rather than on a second lock.
- The migration refusal only covers the instance-id derivation. A deployment that renames the project
  slug changes every member's address and is out of this check's scope.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:41.489Z backlog → todo (system)
- 2026-10-05T04:25:55.608Z todo → wip (system)
- 2026-10-05T04:31:33.751Z wip → testing (system)
- 2026-10-05T04:31:35.010Z testing → done (system)

