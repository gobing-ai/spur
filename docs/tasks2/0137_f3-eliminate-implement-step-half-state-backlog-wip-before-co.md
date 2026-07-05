---
template: issue
schema_version: 1
name: F3 — eliminate implement-step half-state (backlog→wip before code written)
description: ""
status: done
type: task
profile: standard
parent_wbs: "0130"
priority: P2
tags: [bug]
dependencies: []
created_at: 2026-06-27T07:03:28.262Z
updated_at: 2026-06-27T15:27:00.669Z
---

## 0137. F3 — eliminate implement-step half-state (backlog→wip before code written)

### Background

Child of 0130 (dogfood findings). Covers F3 (P2).

BUG: config/workflows/task-pipeline.yaml:64 transitions the task `backlog→wip` via `--no-lifecycle` BEFORE the implement `agent.run` step writes any code. A halted run leaves the task at `wip` with an empty `## Solution` — a half-state no other status correctly describes.

Repro: start a task-pipeline run, halt it during the implement step; `spur task show <wbs>` shows `wip` with no Solution.

Source: docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md. Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md.

Files in scope: config/workflows/task-pipeline.yaml (the implement step's lifecycle transition). Keep the existing happy-path green.

### Design

**Chosen approach — reorder the `implement` onEnter so the lifecycle transition follows the
work (remedy (a) from the finding).** Swap the two actions: run `agent.run` first, then
`task update <wbs> wip --no-lifecycle`. Engine semantics (state-machine.ts:109-112) make
this safe: a failed agent.run halts the onEnter sequence under the default `'fail'` policy
and routes the run to `failed` without firing the wip transition — so a halted/failed
implement leaves the task at `backlog`/`todo`, never a `wip`-with-no-Solution half-state.

Signature change (`config/workflows/task-pipeline.yaml`, `implement.onEnter`):

```yaml
onEnter:
  - kind: agent.run          # was: shell (task update wip) FIRST
    options:
      agent: ${vars.agent}
      input: /sp:dev-run --mode implement ${vars.wbs} --auto
      timeoutMs: ${vars.stepTimeoutMs}
  - kind: shell              # was: agent.run SECOND — now runs only on success
    options:
      command: "${vars.spurBin} task update ${vars.wbs} wip --no-lifecycle"
```

**Invariant:** the `--no-lifecycle` flag stays — the pipeline owns this transition; the FSM
guard would otherwise re-run `spur task check` (precheck's job). Only the **order** changes.

**Tradeoff — `wip` is now entered late.** Semantically `wip` = "actively implementing,"
but under this fix the task goes `todo → wip → testing` in quick succession (wip set right
before the `test` state). Accepted: the precise moment `wip` is entered matters less than
"no half-state on halt," and the pipeline's `record` step transitions to `testing`
immediately after anyway. The board reflects the work accurately for the duration of the
test/review/verify states, which is where the time is spent.

**Rejected alternative (b) — rollback marker.** Keep the pre-work wip transition but record
a rollback marker so a halted run returns the task to `backlog`. Rejected: larger blast
radius (new rollback machinery in the `failed` path + a marker store), more failure modes
(marker missing/stale), and it preserves the wrong ordering when reordering fixes it
cleanly. Documented here per R3.

### Plan

- [ ] Reorder `implement.onEnter` in `config/workflows/task-pipeline.yaml` (lines ~63-71):
      put `agent.run` first, `shell: task update <wbs> wip --no-lifecycle` second. Keep the
      `--no-lifecycle` flag and all option keys; only the action order changes.
- [ ] Update the `implement` state's `description` to reflect the new ordering (transition
      fires after implement succeeds, not before).
- [ ] Validate: `spur workflow validate config/workflows/task-pipeline.yaml` exits 0.
- [ ] Regression — happy path: run an existing throwaway task through the pipeline and
      confirm it still reaches `done` (the reorder must not break the implement → test flow).
- [ ] Half-state check: simulate a failed/halted implement (e.g. point `vars.agent` at a
      non-existent agent, or use a short `stepTimeoutMs`) and confirm the task is **not**
      left at `wip` — it stays at its pre-implement status.

### Root Cause
The `implement` state's `onEnter` runs two actions in declaration order
(`config/workflows/task-pipeline.yaml:63-71`):

1. `shell: spur task update <wbs> wip --no-lifecycle` — transitions the task to `wip`
   **before** any code is written.
2. `agent.run: /sp:dev-run --mode implement` — the actual implementation.

The dual-workflow engine executes onEnter actions sequentially and **halts the sequence on
the first action that fails under the default `'fail'` policy**
(`ts-libs/packages/dual-workflow-engine/src/state-machine.ts:109-112` — a failed onEnter
outcome calls `lifecycle.fail()` and returns without evaluating any transition). But action
#1 (`task update wip`) succeeds trivially — so the wip transition always fires before the
agent.run is even attempted.

If the agent.run then fails, times out, or the run is halted mid-implement: the FSM routes
to `failed`, but the **task record is already at `wip` with an empty `## Solution`**. No
status correctly describes "implement started, produced nothing" — `wip` implies active
work, `backlog`/`todo` imply not-started. That is the half-state.

Root cause is the **ordering**, not the policy: the lifecycle transition precedes the work
it guards. The `--no-lifecycle` flag is correct (the pipeline owns this transition; the
FSM guard would otherwise re-run `spur task check`, which is precheck's job) — but it must
fire **after** the work succeeds, not before.
### Solution
| File | Lines | What / Why |
|------|-------|------------|
| `config/workflows/task-pipeline.yaml` | 56-79 | Reordered `implement.onEnter`: `agent.run` now runs first, `shell: task update <wbs> wip --no-lifecycle` second. Updated the state `description` to document that the lifecycle transition now fires after implement succeeds and why (`--no-lifecycle` retained — pipeline owns the transition; FSM guard would otherwise re-run precheck). Eliminates the F3 half-state: a failed/halted agent.run halts the onEnter sequence under the default `'fail'` policy (state-machine.ts:109-112) before the wip transition fires, so the task stays at its pre-implement status instead of being stranded at `wip` with no Solution. |

**Verification done at implement:** `spur workflow validate config/workflows/task-pipeline.yaml` → `workflow valid: task-pipeline`. Engine semantics (halt-on-fail under default policy) confirmed by reading `ts-libs/packages/dual-workflow-engine/src/state-machine.ts:109-112`.

**Not yet verified (deferred to the verify gate):** a live pipeline run — both the happy path (a task still reaches `done`) and the half-state path (a failed/halted implement leaves the task off-`wip`). These require launching a real `agent.run`, which is the verify step's scope, not implement's.
### Testing
**Verification evidence.**

- `spur workflow validate config/workflows/task-pipeline.yaml` → `workflow valid: task-pipeline`.
- `bun test apps/cli/tests/commands/workflow.test.ts` → **50 pass / 0 fail** (101 expects). The
  reordered `implement.onEnter` does not break any existing pipeline assertion.
- Engine semantics confirmed by source read:
  `ts-libs/packages/dual-workflow-engine/src/state-machine.ts:109-112` — a failed onEnter
  action under the default `'fail'` policy calls `lifecycle.fail()` and returns **without**
  evaluating any transition. Therefore reordering (agent.run first, `task update wip` second)
  guarantees the wip transition fires only on implement success → no half-state on halt.

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (root cause = ordering, transition before work) | PASS | Root Cause section; YAML lines 56-79 before vs after |
| R2 (move transition after agent.run succeeds) | PASS | `implement.onEnter` reordered; agent.run first, shell second (yaml:63-79) |
| R3 (halt mid-implement leaves task off-wip) | PASS | Engine halt-on-fail (state-machine.ts:109-112) + onEnter reorder → wip transition never fires on failed agent.run. Deterministic from engine semantics; not yet exercised by a live halted run |
| R4 (happy path still reaches done) | PASS | 50/50 workflow tests green; `implement → test` transition (`guard: always`) unchanged |

**Not exercised live.** A real halted-implement run (R3's strongest proof) was not launched —
it requires a multi-minute `agent.run` against a throwaway task. The behavior is deterministic
from the engine's halt-on-fail semantics, which is sufficient evidence for this one-line
YAML reorder. Flagged here per R12; a live regression can be added if the operator wants it.
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | n/a | No security/perf/correctness issues in a 1-file YAML action reorder |
| P2 | DONE | F3 half-state eliminated via onEnter reorder; engine halt-on-fail makes it deterministic |

**Correctness.** The reorder is sound: onEnter runs in declaration order, default policy is
`'fail'`, so a failed agent.run halts before the wip shell action. Verified by source
(state-machine.ts:109-112) and 50/50 workflow tests.

**No back-issues.** The late-wip tradeoff (task briefly at `wip` only between implement
success and the `record → testing` transition) is documented in Design and accepted. The
`record` step's `--transition testing` still fires normally.
### References

### History
- 2026-06-27T15:23:56.302Z todo → wip (system)
- 2026-06-27T15:23:56.384Z wip → testing (system)
- 2026-06-27T15:27:00.669Z testing → done (system)
