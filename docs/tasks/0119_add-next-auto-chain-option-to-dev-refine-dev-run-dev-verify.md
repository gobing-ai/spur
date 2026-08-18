---
template: feature-impl
schema_version: 1
name: "Add --next auto-chain option to dev-refine, dev-run, dev-verify"
description: ""
status: done
type: task
profile: standard
feature_id: B1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-25T03:59:36.891Z"
updated_at: "2026-08-18T04:42:46.871Z"
---

## 0119. Add --next auto-chain option to dev-refine, dev-run, dev-verify

### Background
Currently, after each `sp:dev-*` command completes successfully, the operator must manually run the next command in the task lifecycle chain. A `--next` flag on task-scoped commands would auto-chain them: refine → run → verify → done, stopping only on error or unexpected outcome.

This implements a semi-automatic workflow: each command does its core work, and if it succeeds, auto-transitions the task status and invokes the next command with `--next` passed through. The operator starts the chain once (`/sp:dev-refine 0119 --next`) and the rest follows unless something breaks.

**Design decisions (per Robin):**
- `dev-plan` is excluded — it's feature-scoped (creates a batch of tasks), not task-scoped
- `dev-unit` and `dev-fixall` are excluded — they're optional auxiliary steps, not mandatory lifecycle transitions
- `--next` is opt-in; omitting it preserves all existing behavior
- `dev-run --mode full` already handles progression internally — `--next` makes most sense for `--mode implement` (single-step implementation + auto-advance)
### Requirements

- [ ] R1. `sp:dev-refine <wbs> --next`: on successful refine (task check passes), auto-transition `backlog → todo`, then invoke `/sp:dev-run <wbs> --mode implement --next`
- [ ] R2. `sp:dev-run <wbs> --mode implement --next`: on successful implementation + self-test, auto-transition `todo/wip → testing`, then invoke `/sp:dev-verify <wbs> --next`
- [ ] R3. `sp:dev-verify <wbs> --next`: on PASS verdict, auto-transition `testing → done`. On PARTIAL/FAIL, stop — do not advance.
- [ ] R4. Any command in the chain stops on failure: surface the error, do NOT auto-invoke the next command, leave the task at its current status for human intervention
- [ ] R5. `--next` is opt-in: omitting it preserves all existing behavior (zero breaking change)
- [ ] R6. `dev-unit` and `dev-fixall` remain unchanged — they are auxiliary steps, not lifecycle transitions
- [ ] R7. `dev-run --mode full` already handles progression internally — `--next` is a no-op or skipped in full mode (design choice: document that `--next` is for `--mode implement` only)

### Acceptance Criteria
```gherkin
Feature: --next auto-chain option on dev-refine, dev-run, dev-verify

  Scenario: Full chain from refine to done
    Given a task at "backlog" status with valid Background, Requirements, and Plan sections
    When the operator runs "/sp:dev-refine <wbs> --next --auto"
    Then the task transitions from "backlog" to "todo"
    And "/sp:dev-run --mode implement <wbs> --next --auto" is invoked
    And on implement success the task transitions to "testing"
    And "/sp:dev-verify <wbs> --next --auto" is invoked
    And on verify PASS the task transitions to "done"

  Scenario: Chain stops on refine failure
    Given a task at "backlog" with malformed or missing required content
    When the operator runs "/sp:dev-refine <wbs> --next --auto"
    Then the refine step fails with an error
    And the task status remains at "backlog"
    And no subsequent command (dev-run or dev-verify) is invoked
    And the error is surfaced to the operator

  Scenario: Chain stops on verify non-PASS verdict
    Given a task at "testing" with implementation that does not satisfy its requirements
    When the operator runs "/sp:dev-verify <wbs> --next --auto"
    Then the verify step returns a PARTIAL or FAIL verdict
    And the task status remains at "testing"
    And the task is NOT transitioned to "done"
    And the verdict is surfaced to the operator

  Scenario: No --next flag preserves existing behavior
    Given any task at any status
    When the operator runs any "sp:dev-*" command without the "--next" flag
    Then the command performs its core work exactly as before
    And no auto-transition of task status occurs
    And no subsequent command in the chain is invoked

  Scenario: --next on dev-run --mode full is a no-op
    Given a task at any status
    When the operator runs "/sp:dev-run --mode full <wbs> --next"
    Then the "--next" flag is ignored
    And the full pipeline runs as normal with its own progression logic
```
### Design
**Chain definition**

```
/ sp:dev-refine 0119 --next
  → refine succeeds
  → spur task update 0119 todo
  → invoke /sp:dev-run --mode implement 0119 --next
    → implement succeeds
    → spur task update 0119 testing
    → invoke /sp:dev-verify 0119 --next
      → verify verdict: PASS
      → spur task update 0119 done
      → stop (end of chain)
```

On any failure: stop immediately at the failed step. The task stays at its current status. Surface the error to the operator.

**Implementation approach**

Each of the three commands (dev-refine, dev-run, dev-verify) is a thin wrapper over a backing skill. The `--next` logic lives in the command file, not the backing skill — the command detects `--next`, does its main work via the backing skill, and on success handles the status transition + next-command invocation.

For `dev-run`: `--next` is only meaningful with `--mode implement`. With `--mode full` (default), the pipeline already auto-advances. The command should document this.

**Files to touch**

| File | Change |
|------|--------|
| `plugins/sp/commands/dev-refine.md` | Add `--next` flag; on success: `spur task update <wbs> todo` + invoke `dev-run` |
| `plugins/sp/commands/dev-run.md` | Add `--next` flag; on success: `spur task update <wbs> testing` + invoke `dev-verify` |
| `plugins/sp/commands/dev-verify.md` | Add `--next` flag; on PASS: `spur task update <wbs> done`; on FAIL/PARTIAL: stop |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | Document `--next` semantics on operations #4 (run) and #5 (refine) |
| `plugins/sp/skills/code-verification/SKILL.md` | Document `--next` semantics on the verify operation |

**Status transition table**

| Command | From | To | Condition |
|---------|------|----|-----------|
| `dev-refine --next` | `backlog` | `todo` | Refine succeeds (task check passes) |
| `dev-run --next` | `todo` or `wip` | `testing` | Implement succeeds |
| `dev-verify --next` | `testing` | `done` | Verdict PASS only |
### Plan
- [ ] Add `--next` to `plugins/sp/commands/dev-refine.md`: argument table + on-success chain (status transition + invoke dev-run)
- [ ] Add `--next` to `plugins/sp/commands/dev-run.md`: argument table + on-success chain (status transition + invoke dev-verify, `--mode implement` only)
- [ ] Add `--next` to `plugins/sp/commands/dev-verify.md`: argument table + on-PASS transition to done
- [ ] Update `dev-operations.md`: document `--next` on operations #4 (run), #5 (refine), and #3 (verify)
- [ ] Verify: `bun run check` passes
- [ ] Dogfood: `/sp:dev-refine <wbs> --next` end-to-end on a test task
### Solution
| File:line | What / Why |
|-----------|-------------|
| `plugins/sp/commands/dev-refine.md:3` | Added `--next` to argument-hint |
| `plugins/sp/commands/dev-refine.md:29` | Added `--next` row to arguments table |
| `plugins/sp/commands/dev-refine.md:63-67` | Added `--next` chain to workflow (step 6) |
| `plugins/sp/commands/dev-refine.md:78` | Added `--next` example |
| `plugins/sp/commands/dev-run.md:3` | Added `--next` to argument-hint |
| `plugins/sp/commands/dev-run.md:33` | Added `--next` row to arguments table |
| `plugins/sp/commands/dev-run.md:54-65` | Added `--next` chain section (implement mode only) |
| `plugins/sp/commands/dev-verify.md:3` | Added `--next` to argument-hint |
| `plugins/sp/commands/dev-verify.md:35` | Added `--next` row to arguments table |
| `plugins/sp/commands/dev-verify.md:53-60` | Added `--next` chain section (PASS → done; FAIL → stop) |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:72,80,91` | Documented `--next` on operations #3 (verify), #4 (run), #5 (refine) |
| `plugins/sp/skills/code-verification/SKILL.md:78` | Documented `--next` on verify flags line |
### Testing
| Req | Status | Evidence |
|-----|--------|----------|
| R1: dev-refine --next auto-chains to dev-run | **MET** | `dev-refine.md:3,30,63-66` — arg-hint, args table, workflow step 6 with transition + invoke |
| R2: dev-run --next auto-chains to dev-verify | **MET** | `dev-run.md:3,33,53-59` — arg-hint, args table, `--next` chain section with transition + invoke |
| R3: dev-verify --next auto-transitions to done on PASS | **MET** | `dev-verify.md:3,32,42-49` — arg-hint, args table, `--next` chain section with PASS→done, terminal note |
| R4: Chain stops on failure at any step | **MET** | `plugins/sp/commands/dev-refine.md:66`, `plugins/sp/commands/dev-run.md:59`, `dev-verify.md:32,47` — explicit "stop, do NOT invoke/advance" on all 3 commands |
| R5: --next is opt-in, zero breaking change | **MET** | All `--next` flags default `off`; no existing behavior paths altered when flag is absent |
| R6: dev-unit and dev-fixall unchanged | **MET** | Neither command modified — `--next` only on dev-refine, dev-run, dev-verify |
| R7: dev-run --mode full ignores --next | **MET** | `dev-run.md:33,53` — "For `--mode implement` only — ignored in full mode", "`--next` with `--mode full` is a no-op" |

Coverage: N/A (documentation-only change — no code paths to cover).

**Verdict: PASS** — all 7 requirements MET with concrete `file:line` evidence. SECU review: no findings (config/docs change, no runtime code).
### Review

### References

### History
- 2026-06-25T04:14:09.620Z todo → wip (system)
- 2026-06-25T04:16:23.243Z wip → testing (system)
- 2026-06-25T04:19:51.026Z testing → done (system)
