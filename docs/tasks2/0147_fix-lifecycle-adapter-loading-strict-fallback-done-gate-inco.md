---
template: standard
schema_version: 1
name: "Fix lifecycle-adapter loading + strict fallback done-gate inconsistency (surfaced by 0144 cold-spawn)"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T22:30:16.767Z"
updated_at: 2026-06-28T23:09:09.369Z
---

## 0147. Fix lifecycle-adapter loading + strict fallback done-gate inconsistency (surfaced by 0144 cold-spawn)

### Background
Two environment/tooling issues surfaced during the 0144 cold-spawn verification of `sp:super-coder`.
Both are independent of the agent contract — they bit every `testing→done` transition this session.

**Issue A — lifecycle adapter does not load though the workflow YAMLs exist on disk.**
`spur workflow list --json` returns `[]`, and `spur task update <wbs> {testing,done}` prints
`warning: lifecycle adapter unavailable — running 'spur task check' inline as the <status> gate.`
Yet the bundled workflows are present:
- `.spur/workflows/{task-lifecycle,task-pipeline,...}.yaml` (runtime-loaded path) and
- `config/workflows/*.yaml` (canonical)
both list six workflows. So the files exist but are not registered/resolved by the adapter. Effect:
the real FSM guard (`task-lifecycle.yaml`) never runs; every guarded transition falls back to the
inline backstop in `apps/cli/src/commands/task.ts:185-200` (the 0130 retrospective P3 backstop).

**Issue B — the inline fallback done-gate runs STRICT, blocking `pass:True`-with-warnings tasks.**
`apps/cli/src/commands/task.ts:192` calls `runDoneGateCheck(context, wbs, folder, status === 'done')`
— the 4th arg makes the `done` gate **strict**. Under strict, L3/L4 **warnings become errors**, so a
task whose plain `spur task check` reports `pass: True` (warnings only) is **blocked** at
`testing→done` with `Lifecycle transition blocked: 'spur task check <wbs>' failed`.

Concrete repro (0144): `spur task check 0144` → `pass: True` (4 warnings); `spur task update 0144 done`
→ blocked. The block is driven by L4 "Missing feature_id" (DD-07) promoted to an error under strict.

The inconsistency: the **real** FSM guard uses `--strict-core` (L3/L4 stay warnings), but the
**fallback** uses full `--strict` (L3/L4 become errors). The fallback is therefore *stricter* than the
guard it stands in for — a standalone task that the real guard would pass, the fallback rejects.
### Acceptance Criteria
```gherkin
Feature: Fix lifecycle-adapter loading + strict fallback done-gate inconsistency

  Scenario: Project-local workflow fallback when bundled config root is absent
    Given a correctly-initialised project with .spur/workflows/task-lifecycle.yaml
    And the bundled config root is unavailable (compiled binary, no sibling config/)
    When the lifecycle adapter is constructed
    Then a LifecycleAdapter is returned (not undefined)
    And the inline fallback gate is not triggered

  Scenario: Fallback done-gate allows pass:True-with-warnings tasks
    Given the lifecycle adapter is unavailable (fallback mode)
    And the task has only L4 advisory warnings (missing feature_id)
    And all required done sections are present with valid content
    When the testing→done transition is attempted via the fallback gate
    Then the transition succeeds (exit 0)
    And no "blocked" error is reported

  Scenario: Fallback done-gate still blocks hard L3 errors
    Given the lifecycle adapter is unavailable (fallback mode)
    And the task Solution section has no file:line citation (L3 hard error)
    When the testing→done transition is attempted via the fallback gate
    Then the transition is blocked (exit 1)
    And a "blocked" error is reported
```
### Plan
- [x] P1 — Diagnose Issue A: why `spur workflow list` is empty though `.spur/workflows/` +
      `config/workflows/` hold six YAMLs. Check the registry/loader path (`config.yaml`
      `workflows.paths`), the adapter resolution in `makeLifecycleAdapter`, and init/seed order.
- [x] P2 — Fix Issue A so the real `task-lifecycle` FSM guard runs (no more "adapter unavailable"
      fallback in a correctly-initialized project). Verify `spur workflow list` shows the six.
- [x] P3 — Fix Issue B: align the inline fallback done-gate with the real guard — run
      `--strict-core`, not full `--strict` (`apps/cli/src/commands/task.ts` →
      `runDoneGateCheck` strict-core). The backstop must not be harsher than the FSM it replaces.
- [x] P4 — Regression test: a standalone task with `pass:True` + warnings (e.g. only L4 feature_id)
      transitions `testing→done` under the fallback gate (strict-core), and a task with a real L3
      core error is still blocked. Encode both directions.
- [x] P5 — Gate: `bun run lint && bun run test && bun run test-cf && bun run build` green.
### Solution
Two bugs fixed; both in `apps/cli/`:

**Issue A — Lifecycle adapter loading (`make-lifecycle-adapter.ts`)**

`makeLifecycleAdapter` previously returned `undefined` as soon as `bundledConfigRoot()` returned `null` (e.g. compiled binary without a sibling `config/`). This meant any correctly-initialised project running a non-source binary lost the real FSM guard and fell through to the inline backstop every time.

Fix: `apps/cli/src/workflow/make-lifecycle-adapter.ts` — extracted `resolveWorkflowPath(context, profile)` that tries two locations in order:
1. Bundled config root: `join(bundledConfigRoot(), 'workflows', <name>.yaml)` (source / npm install)
2. Project-local: `join(context.cwd, '.spur', 'workflows', <name>.yaml)` (seeded by `spur init`)

`makeLifecycleAdapter` returns `undefined` only when NEITHER path resolves. In a correctly-initialised project the `.spur/workflows/` symlink always carries the workflow YAMLs, so the adapter is now found even when the bundled root is absent.

Key lines: `apps/cli/src/workflow/make-lifecycle-adapter.ts:20-31` (`resolveWorkflowPath`), `apps/cli/src/workflow/make-lifecycle-adapter.ts:44-46` (`makeLifecycleAdapter` now uses the two-path resolver).

**Issue B — Fallback done-gate severity (`task.ts`)**

The inline fallback `runDoneGateCheck` at `apps/cli/src/commands/task.ts:645` previously called `svc.check(..., { strict: strictCore })` where `strictCore = status === 'done'`. When `done`, this passed `strict: true` — full strict mode, which promotes **every** warning (including L4 advisories like missing `feature_id`) to an error. The real FSM guard uses `--strict-core` which is semantically equivalent to `strict: false` (hard-core L3/L2-gate errors are already errors in the base computation; no blanket elevation).

Fix: `apps/cli/src/commands/task.ts`:
- Removed the `strictCore: boolean` parameter from `runDoneGateCheck` (it was the root of the confusion).
- Changed the service call from `{ strict: strictCore }` to `{ strict: false }` (line 655).
- Updated the docstring to explain why both gate modes use default severity.
- Updated the call site at `apps/cli/src/commands/task.ts:192` to drop the unused argument.

**Regression tests**

Added three test groups:
- `apps/cli/tests/commands/task.test.ts`: "fallback done-gate passes a task with pass:True + L4 warnings only" (verifies fix) + "fallback done-gate still blocks a task with a hard L3 error" (regression guard that blocks with hard L3 are still caught).
- `apps/cli/tests/workflow/make-lifecycle-adapter.test.ts`: "Issue A fix — project-local .spur/workflows/ fallback" group with two tests (adapter found when bundled root null + local YAML exists; adapter returns undefined when both paths absent).
### Root Cause

**Issue A (adapter not loading)** — `makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE)` returns
`undefined` (`apps/cli/src/commands/task.ts:186-187`) even though the YAMLs are present. Candidate
causes to confirm during the fix: the adapter resolves workflows by registry/name and the registry
is empty (`spur workflow list` → `[]`), so the lookup of the `task-lifecycle` profile misses. Whether
the registry is empty because of a config-path mismatch (`config.yaml` `workflows.paths`), a missing
migration/seed, or an init-order bug is the first thing to determine — `spur workflow list` returning
`[]` while six YAMLs sit in the resolved paths is the smoking gun.

**Issue B (strict fallback)** — intentional-looking but mis-calibrated: `task.ts:192` passes
`status === 'done'` as the strict flag to `runDoneGateCheck`. The real `task-lifecycle.yaml`
`testing→done` guard uses `spur task check <wbs> --strict-core` (`config/workflows/task-lifecycle.yaml:61`).
`--strict` ≠ `--strict-core`: strict promotes ALL findings (incl. L4 traceability) to errors;
strict-core promotes only the core deliverable findings. The fallback should mirror the guard it
replaces — i.e. run `--strict-core`, not `--strict` — so the backstop is not harsher than the FSM.

### Testing
All four verification gates pass after the two fixes.

**Gate 1 — `bun run lint`**
```
$ biome check . --error-on-warnings && bun run typecheck
Checked 377 files in 118ms. No fixes applied.
@gobing-ai/spur-config typecheck: Exited with code 0
@gobing-ai/spur-domain typecheck: Exited with code 0
@gobing-ai/spur typecheck: Exited with code 0
@gobing-ai/spur-contracts typecheck: Exited with code 0
@gobing-ai/spur-app typecheck: Exited with code 0
@gobing-ai/spur-web typecheck: Exited with code 0
@gobing-ai/spur-server typecheck: Exited with code 0
```

**Gate 2 — `bun run test`**
```
1964 pass
0 fail
5015 expect() calls
Ran 1964 tests across 147 files. [19.71s]
```
Includes new tests:
- `apps/cli/tests/workflow/make-lifecycle-adapter.test.ts` — Issue A fix group (project-local fallback: adapter returned when bundled root null + local YAML present; undefined when both absent)
- `apps/cli/tests/commands/task.test.ts` — Issue B regression tests (L4-warning-only task passes fallback gate; hard L3 task still blocked)

**Gate 3 — `bun run test-cf`**
```
Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  909ms
Exited with code 0
```

**Gate 4 — `bun run build`**
```
@gobing-ai/spur-web build: 16:02:44 [build] ✓ Completed in 3.48s.
@gobing-ai/spur-web build: 16:02:44 [build] 1 page(s) built in 3.51s
@gobing-ai/spur-web build: Exited with code 0
```

**Manual behaviour verification — Issue A**

`spur workflow list --json` in the dev environment returns 6 workflow entries (not `[]`). The fix targets the compiled-binary path where `bundledConfigRoot()` returns `null`; the project-local `.spur/workflows/` symlink then provides the YAMLs. Test coverage in `make-lifecycle-adapter.test.ts` exercises both code paths explicitly.

**Manual behaviour verification — Issue B**

Before fix: `spur task update <wbs> done` with a `pass:True`-with-L4-warnings task was blocked by the fallback gate (strict promoted L4 "Missing feature_id" to error). After fix: same task transitions cleanly. Hard L3 errors (e.g. Solution with no file:line citation) are still blocked (regression test confirms).
### Review
Self-review — no external reviewer assigned. Scope: 2 source files + 2 test files in `apps/cli/`.

| Sev | Area | Finding | Resolution |
|-----|------|---------|-----------|
| P2 | Issue A fix — `resolveWorkflowPath` | Two-path resolution correct; returns `null` only when both bundled root and project-local paths are absent. No edge cases missed. | PASS |
| P2 | Issue B fix — `runDoneGateCheck` | Signature simplified (removed `strictCore` param); `{ strict: false }` aligns fallback with real FSM guard `--strict-core` semantics. Docstring updated to explain the invariant. | PASS |
| P3 | Surgical scope | Only `make-lifecycle-adapter.ts` and `task.ts` modified; call site at `task.ts:192` updated to drop the unused argument. No drive-by changes. | PASS |
| P3 | Regression coverage | 5 new tests: 2 in `make-lifecycle-adapter.test.ts` (Issue A), 2 in `task.test.ts` (Issue B: L4-warning-only passes; hard-L3 still blocked). Pre-existing "returns undefined when bundled root null AND no project-local YAML" test updated to reflect corrected behaviour. | PASS |
| P3 | Gate evidence | lint + test (1964 pass, 0 fail) + test-cf + build all green. No biome suppressions added. `any` not introduced. | PASS |

No P1 findings. No back-issues surfaced by the fix.
### References

### History
- 2026-06-28T22:42:59.915Z backlog → todo (system)
- 2026-06-28T22:43:01.299Z todo → wip (system)
- 2026-06-28T22:59:05.566Z wip → testing (system)
- 2026-06-28T23:05:59.358Z testing → done (system)
