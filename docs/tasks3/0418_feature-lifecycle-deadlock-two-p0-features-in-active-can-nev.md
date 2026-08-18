---
template: issue
schema_version: 1
name: "Feature lifecycle deadlock: two P0 features in active can never transition out"
description: ""
status: done
type: issue
profile: standard
feature_id: F4
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-03T00:40:11.223Z"
updated_at: "2026-08-18T04:42:48.443Z"
---

## 0418. Feature lifecycle deadlock: two P0 features in active can never transition out

### Background
Two P0 features in `active` deadlock the feature lifecycle permanently: neither can transition
forward, and neither can transition backward. There is no CLI path out.

**Live instance (2026-08-02):** F2 (`Task management CLI`, P0) and F4 (`Lifecycle and events`, P0)
are both `active`. Both are finished work — every linked task in each is `done` — but both are stuck.

**Reproduction (observed, not hypothetical):**

```
$ spur feature update F2 verifying
GuardDeniedError: Lifecycle transition denied for feature F2:
  Guard "shell" denied transition from "active" to "verifying" —
  F2 (active): FAIL
    [ERR] L3 : One-active-goal violated: P0 feature "F4" is already active

$ spur feature update F4 verifying      # the mirror image
  [ERR] L3.one-active-goal: One-active-goal violated: P0 feature "F2" is already active

$ spur feature update F4 backlog        # no way back either
GuardDeniedError: No transition from "active" to "backlog"
```

**Why it is closed with no exit:**

1. `packages/app/src/services/feature-check.ts:332` — the one-active-goal rule fires on any *other*
   P0 feature whose status is `active` **or** `verifying`, at severity `error`. Advancing to
   `verifying` therefore does not relieve the conflict for the other feature.
2. `.spur/workflows/feature-lifecycle.yaml:37` — the path is forward-only
   (`backlog → active → verifying → done`). There is no `active → backlog` edge, so a feature cannot
   be de-escalated out of the conflicting state.
3. The guard at the `active→verifying` placement invokes `spur feature check`
   (`.spur/workflows/feature-lifecycle.yaml:7-8`), so the error is blocking, not advisory.

Each feature's only forward edge is guarded by a check that fails because of the other; the backward
edge does not exist. The state is unreachable-from and unescapable.

**How the corpus reaches this state without anyone doing anything wrong:** feature activation happens
as a side effect of task completion. F4 went `backlog → active` on 2026-07-25 (system). F2 went
`backlog → active` on 2026-08-03 (system) when task 0416 completed. No operator ever chose to have two
P0 goals active; the lifecycle put the corpus into a state its own rules forbid and cannot leave.

**Current workarounds are all bad:** demoting a feature's `priority` off P0, or hand-editing `status`
in feature frontmatter. Both defeat the WIP limit rather than satisfying it, and the second violates
the CLI-gated corpus-write contract.

Found during the `/sp:dev-verify 0416 --fix all` shippable gate.
### Requirements
- R1. **A corpus with two active P0 features must be recoverable through the CLI.** From the live
  F2/F4 state, an operator can reach a legal single-active-goal state using `spur feature` verbs
  alone — no frontmatter hand-edits, no priority demotion used as a workaround.

- R2. **Root-cause the closed cycle, do not just widen the escape hatch.** The defect is the
  combination of a blocking cross-feature rule with a forward-only FSM. Decide explicitly which side
  gives: a de-escalation edge out of `active`, a rule that does not block the transition that would
  *relieve* it, or an override verb. Record the rationale.

- R3. **The lifecycle must not create states its own rules forbid.** Auto-activation on task
  completion currently produces a two-P0-active corpus with no warning. Either the activation path
  respects the one-active-goal limit, or the limit stops being a blocking error — the two must be
  consistent.

- R4. **Regression coverage.** Tests prove the deadlock cannot recur: a fixture with two P0 active
  features can be driven back to a legal state through the CLI, and the transition that relieves the
  conflict is not itself blocked by it.
### Acceptance Criteria
```gherkin
Feature: Feature lifecycle deadlock recovery

  Scenario: A two-P0-active corpus is recoverable via the CLI
    Given two P0 features are both in status active
    When an operator uses spur feature verbs to restore a single active goal
    Then the transition succeeds without editing frontmatter by hand
    And neither feature's priority has to be demoted to work around the rule

  Scenario: The relieving transition is not blocked by the rule it relieves
    Given two P0 features are both in status active
    When one is transitioned along the path that would leave a single active goal
    Then the one-active-goal rule does not deny that transition

  Scenario: Auto-activation cannot silently create a forbidden state
    Given a P0 feature is already active
    When completing a task auto-activates a second P0 feature
    Then the conflict is surfaced at the moment it is created
    And the corpus is not left in a state with no legal exit

  Scenario: Regression coverage for the deadlock
    Given a fixture with two P0 features in active
    When the lifecycle test suite runs
    Then a test proves the corpus can be driven back to a legal state
    And removing the fix makes that test fail
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Root cause:** the one-active-goal rule (a) counts both `active` and `verifying` as goal
statuses and (b) evaluates the checked feature's *current file* status — which at guard time is
still the `from` status — so it cannot tell an operator *exiting* the goal set
(`active → verifying → done`) from *entering* it (`backlog → active`). The exit is blocked by the
same rule the exit would relieve. Auto-activation (task completion → `syncFeature` hops into
`active`) then manufactures the 2-active state with no check and no surfacing.

**Chosen fix — Option B (direction-aware rule), plus R3's activation-side guard. Options A/C
rejected as unnecessary.**

1. **Narrow the WIP count to `active` only.** A P0 feature in `verifying` is terminal-bound
   (verification toward done, DD-13), not an active goal; it no longer counts as a blocking goal.
   The B09 intent — at most one P0 goal actively worked — is preserved: entering `active` is
   denied while another P0 is active.
2. **Thread the transition target into the guard.** `spur feature check` gains `--as <status>`;
   the FSM guards pass it (`--as verifying`, `--as done`). The rule evaluates the checked
   feature's *post-transition* status, so the transition that relieves the conflict
   (`active → verifying`) is never denied by the rule it relieves.
3. **R3 activation guard.** The auto-activation path (`FeatureService.syncFeature`) refuses a P0
   hop into `active` while another P0 is active, and surfaces the conflict in the sync result.
   The lifecycle stops manufacturing the forbidden state silently.
4. **A (de-escalation edge) / C (override verb) not needed.** With (1)+(2) the forward path fully
   escapes a 2-active corpus (`F2 → verifying → done`, then F4 is the sole goal) — no new FSM
   edge and no force flag. The static `spur feature check` still errors on a 2-active corpus;
   manual `backlog → active` stays operator-controlled (guard `always`).

**Recovery of the live F2/F4 pair:** `spur feature update F2 verifying` → `spur feature update F2
done`; F4 remains the single active goal. Both checks drop the `L3.one-active-goal` error.
### Plan
- [ ] Decide the R2 fix shape (Option A / B / C above) and record the rationale in `### Design`.
- [ ] Implement the chosen fix in `packages/app/src/services/feature-check.ts` and/or
      `.spur/workflows/feature-lifecycle.yaml`.
- [ ] Add the R3 activation-side guard so task completion cannot silently create a second active P0.
- [ ] Recover the live F2/F4 pair through the CLI once a legal path exists; confirm
      `spur feature check F2` and `spur feature check F4` both drop the `L3.one-active-goal` error.
- [ ] R4 regression tests: two-P0-active fixture is recoverable; the relieving transition is not
      denied by the rule it relieves. Mutation-check both.
- [ ] `bun run lint`, `bun run test`, `bun run build`.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Change map (0418):**

- `packages/app/src/services/feature-check.ts:304` — one-active-goal rule is now **direction-aware** (Option B) and counts `active` only:
  - `check()` accepts `asStatus` (`packages/app/src/services/feature-check.ts:165`, `:198`); `checkOneActiveGoal` evaluates the checked feature's *post-transition* status, so a transition that exits the active set (`active → verifying`, `verifying → done`) is never denied by the rule it relieves.
  - `verifying` no longer counts as a blocking goal status (terminal-bound, DD-13); entering `active` while another P0 is active is still an error.
  - Extracted the shared corpus scan `findOtherP0InStatus` (`packages/app/src/services/feature-check.ts:716`, exported) so the L3 rule and the R3 activation guard enforce one WIP-limit definition.
- `config/workflows/feature-lifecycle.yaml:52` + `config/workflows/feature-lifecycle.yaml` + `apps/cli/config/workflows/feature-lifecycle.yaml` (kept byte-identical) — FSM guards pass the edge target: `active→verifying` runs `feature check <id> --as verifying`; `verifying→done` runs `feature check <id> --strict --as done`.
- `apps/cli/src/commands/feature.ts:344` — `spur feature check` gains `--as <status>`; `spur feature advance` passes the hop target through `assertFeatureCheckPass`; `spur feature sync` tags blocked activations `[GOAL-CONFLICT]`.
- `packages/app/src/services/feature-service.ts:523` — R3 activation guard: `syncFeature` refuses a P0 hop into `active` while another P0 is active and returns `goalConflict: { featureId, status }` (surfaced in the sync result / CLI output); the lifecycle no longer manufactures a forbidden two-active corpus silently.
- `docs/04_DESIGN.md` — `spur feature check` row (added `--as`, goal set now `active`-only) and `feature-lifecycle.yaml` row (guards pass the target).

**Options A/C rejected:** with the direction-aware rule + `--as` guards the forward path fully escapes a two-active corpus (`F2 → verifying → done`), so a de-escalation edge (A) and an override verb (C) were unnecessary; rationale recorded in `### Design`.

**Live recovery (2026-08-02):** F2 `active → verifying → done` and F4 `active → verifying` through the CLI. The corpus now has exactly one active P0 goal (F1) and `spur feature check F1|F2|F4` all drop `L3.one-active-goal` (evidence in `### Testing`). Note: the corpus also contained F1 (P0 `active` since creation, predating the rule — grandfathered). F4's `verifying → done` strict gate remains blocked by pre-existing content debt (orphan AC scenarios + missing Scope delineation) — follow-up, not part of this fix.
### Testing
All evidence below was re-run and every `file:line` anchor re-read on **2026-08-02** (verify
re-audit, `--force --fix all`). Anchors corrected against the current tree where the prior pass
had drifted.

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/feature-check.ts:304-337` — direction-aware `checkOneActiveGoal`; `:319` `effectiveStatus = asStatus ?? status`; `:325` exits the rule when the post-transition status is not `active`; `:327` scans `['active']` only. `apps/cli/src/commands/feature.ts:308-311` `--as <status>` option, `:344` `asStatus: options.as`, `:174-178` `advance` threads `'verifying'`/`'done'`, `:462`+`:478` `assertFeatureCheckPass` param. `config/workflows/feature-lifecycle.yaml:52` (`--as verifying`) / `:60` (`--strict --as done`). Live corpus this run: `feature list --priority P0` → F1 `active`, F2 `done`, F4 `verifying`; `feature check F1\|F2\|F4 --json` → `pass=true` each, zero `One-active-goal` findings. |
| R2 | MET | Task `### Design` — root cause stated (rule counted `active`+`verifying` **and** evaluated the pre-transition status, against a forward-only FSM), Option B chosen, Options A (de-escalation edge) / C (override verb) rejected with rationale; restated in `### Solution`. |
| R3 | MET | `packages/app/src/services/feature-service.ts:515-537` — `syncFeature` refuses a `hop === 'active'` while another P0 is active and returns `goalConflict`; `:547-553` `findOneActiveGoalConflict` reuses the same `findOtherP0InStatus` scan as the L3 rule; `:55` result type. `apps/cli/src/commands/feature.ts:398-399,418-419` `[GOAL-CONFLICT]` tag. Consistency arm: `packages/app/src/services/feature-check.ts:321-325` — `verifying` no longer counts as a blocking goal. Tests: `packages/app/tests/services/feature-service.test.ts:767-816` (refused → stays `backlog` → applies once the slot frees), `:818-843` (control). |
| R4 | MET | `packages/app/tests/services/feature-check.test.ts` — 4 direction-aware tests (`verifying` not a goal; `--as verifying` not denied; `--as active` denied; `--as done` not denied). `packages/app/tests/services/feature-service.test.ts` — R3 refused-then-applied + control. `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts` — two-P0-active fixture driven through the real FSM shell guards. Targeted run this turn: **135 pass / 0 fail, 665 expect() calls, 3 files**. Mutation re-verified this turn (below). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: A two-P0-active corpus is recoverable via the CLI | MET | test + command | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts` R4 fixture drives F2 `active→verifying→done` through the real guard chain (7 pass / 0 fail this run). Live: `docs/features/F2_task-management-cli.md` History `active → verifying` / `verifying → done`, `docs/features/F4_lifecycle-and-events.md` History `active → verifying` — all CLI-written; no priority demotion (both still `P0`), no hand-edited frontmatter. |
| Scenario: The relieving transition is not blocked by the rule it relieves | MET | test | `packages/app/tests/services/feature-check.test.ts` — `--as verifying` is not denied while another P0 is active; complemented by `--as active` **denied** (entry still guarded) and `--as done` not denied. Implementation anchor `packages/app/src/services/feature-check.ts:319,325`. |
| Scenario: Auto-activation cannot silently create a forbidden state | MET | test | `packages/app/tests/services/feature-service.test.ts:767-816` — the blocked sync asserts `applied === false`, `appliedHops === []`, `goalConflict.featureId` = the blocking goal, `proposal.reason` contains `one-active-goal`, and the contender is still `backlog`; the same sync then applies (`['active','verifying','done']`) once the goal slot frees — proving the corpus is never left without a legal exit. |
| Scenario: Regression coverage for the deadlock | MET | command | Mutation check re-run this turn: strip `--as verifying` from `config/workflows/feature-lifecycle.yaml:52` → `bun test packages/app/tests/workflow/feature-lifecycle-adapter.test.ts` = **6 pass / 1 fail** (`R4 (0418): a two-P0-active corpus is recoverable through the CLI guard chain`); restore (md5 back to `ec7c42983d47a8a7e4492c25d9152611`, identical across `config/`, `apps/cli/config/`, `.spur/workflows` symlink) → **7 pass / 0 fail**. |

**Design conformance** — 4/4 claims DONE: (1) WIP count narrowed to `active` (`packages/app/src/services/feature-check.ts:321-327`); (2) `--as` threaded through CLI + FSM guards (`apps/cli/src/commands/feature.ts:308-311,344,174-178`; `config/workflows/feature-lifecycle.yaml:52,60`); (3) R3 activation guard (`packages/app/src/services/feature-service.ts:515-537`); (4) Options A/C recorded as unnecessary. No NOT-DONE and no undocumented CHANGED claims.

**Gates (run 2026-08-02, this turn)**

| Gate | Result |
|------|--------|
| `bun run lint` | exit 0 — biome + all 5 workspace typechecks clean |
| `bun test` (3 changed test files) | 135 pass / 0 fail |
| `bun run test` (full monorepo) | **4380 pass / 24 fail**, 246 files, exit 1 — see sandbox note below |
| `bun run build` | exit 0 |
| `spur task check 0418 --strict-core` | **pass=false** — `L3.review-priority-table` (error): `### Review` has no populated P1–P4 findings table. Blocks done-gate layer 3; verify mode is forbidden from writing `### Review` (code-verification Step 10), so remediation is `/sp:dev-review 0418`. |
| `spur feature check F4 --strict` | pass=false — pre-existing content debt (4 uncovered feature scenarios, scope delineation, dogfood artifact) + `verifying-incomplete-tasks: 0418`. Shippable gate below. |

**Sandbox note (full-suite failures).** The 24 failures are all environment denials, not regressions:
`Bun.serve` port binds refused (`Failed to listen at 127.0.0.1` / `::1`, `EADDRINUSE` on `port: 0`)
and `mkdtemp` `EPERM` under `$HOME`. Affected files — `apps/server/tests/*`, `apps/web/tests/lib/rpc-client.test.ts`,
`packages/app/tests/services/project-start.test.ts`, project-registry / health-module suites — have
**zero overlap** with the 0418 change surface (`feature-check.ts`, `feature-service.ts`,
`apps/cli/src/commands/feature.ts`, `config/workflows/feature-lifecycle.yaml` + their 3 test files).
The previously recorded `4404 pass / 0 fail` is not reproducible under this sandbox; the honest
figure is recorded above.

**Coverage (changed sources, full run)** — `feature-check.ts` 100% funcs / **96.97%** lines (prior
entry said 96.79% — transposed); `feature-service.ts` 93.83% funcs / 99.04% lines;
`apps/cli/src/commands/feature.ts` 93.94% funcs / 93.62% lines; `lifecycle-adapter.ts` +
`make-lifecycle-adapter.ts` 100%/100%. All above the 90% per-file gate.

**Open findings (P1–P4)** carried to `### Review` for the review step; none are blockers on R1–R4:
P2 missing Review priority table (done-gate layer 3); P3 `--as <status>` accepts any string with no
FeatureStatus-vocabulary validation (`apps/cli/src/commands/feature.ts:308-311`) so a typo silently skips the goal rule
(`packages/app/src/services/feature-check.ts:325`); P3 the `[GOAL-CONFLICT]` display branch (`apps/cli/src/commands/feature.ts:398-399,418-419`) has
no asserting test — line coverage credits it only via the non-conflict ternary path; P4 goal-set
literal `['active']` duplicated at `packages/app/src/services/feature-check.ts:327` and `packages/app/src/services/feature-service.ts:551`.

**Fix-pass writes (gitignored, disclosure).** `.spur/run/0418-verdict.json` written this run
(new file; PASS aggregate with the 4 requirement + 4 AC rows above). No other `.spur/**` mutation.

**Final state (2026-08-03, post-review chain).** Task transitioned `testing → done` after
`### Review` gained the P1–P4 table. Shippable gate on F4 re-run: `spur feature check F4
--strict` **pass=true**; all `feature_id: F4` tasks done (0418, 0419); the 4 legacy-scenario
coverage gaps were closed by task 0419 (traceability backfill), the dogfood finding by
`docs/dogfood/2026-08-03-F4-sp-dev-verify-0418-dogfood.md`, and Scope delineation by an
In/Out rewrite. F4 transitioned `verifying → done` through the CLI. Shippable: **PASS**.
Verdict artifact updated in place: `.spur/run/0418-verdict.json` (`shippable-readiness: pass`).
### Review
**Priority findings**

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 | Usability | `apps/cli/src/commands/feature.ts:308-311` | `--as <status>` accepts any string with no FeatureStatus-vocabulary validation. A typo'd value falls through `packages/app/src/services/feature-check.ts:325` (`effectiveStatus !== 'active'` → early return) and silently skips the one-active-goal rule instead of erroring. | Accepted for 0418: read-only check hint, no state write, and the only automated caller (the FSM guard) passes a fixed `verifying`/`done`. Validate against the status vocabulary when `--as` gains a second consumer. |
| P3 | Correctness | `apps/cli/src/commands/feature.ts:398-399,418-419` | The `[GOAL-CONFLICT]` display branch has no asserting test. Line coverage credits both lines only because the ternary executes on the non-conflict path, so a regression that dropped the tag would stay green. | Accepted: the behaviour the AC names (refusal + `goalConflict` surfaced + corpus left with a legal exit) is asserted at the service layer in `packages/app/tests/services/feature-service.test.ts:767-816`. The gap is presentation-only. |
| P4 | Architecture | `packages/app/src/services/feature-check.ts:327`, `packages/app/src/services/feature-service.ts:551` | Goal-set literal `['active']` is duplicated at both call sites, so a future change to the WIP-limit status set must touch two places. | Advisory. The corpus scan itself is already single-sourced via `findOtherP0InStatus` (`packages/app/src/services/feature-check.ts:716`); extract an `ACTIVE_GOAL_STATUSES` const when the set next changes. |
| P4 | Maintainability | `README.md`, `docs/spur_logo.svg` | Logo reference `png` → `svg` plus the new asset map to no 0418 requirement, AC, Design or Plan item — unrelated work riding in the same working tree. | Advisory: 3 lines of a 676-line diff (~0.4%), far below the 50% scope-creep escalation threshold. Split at commit time if a clean history is wanted. |

No P1 or P2 findings.

**Functional traceability (sp:functional-review)**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/feature-check.ts:304-337` — direction-aware `checkOneActiveGoal`; `:319` `effectiveStatus = asStatus ?? status`; `:325` early-exit when the post-transition status is not `active`; `:327` scans `['active']` only. `apps/cli/src/commands/feature.ts:308-311` (`--as <status>`), `:344` (`asStatus: options.as`), `:174-178` (`advance` threads `'verifying'`/`'done'`), `:462`+`:478` (`assertFeatureCheckPass`). `config/workflows/feature-lifecycle.yaml:52,60`. Live: `feature check F1\|F2\|F4 --json` all `pass=true`, zero `One-active-goal` findings. |
| R2 | MET | `### Design` records the root cause (rule counted `active`+`verifying` **and** evaluated the pre-transition status, against a forward-only FSM), selects Option B, and rejects Options A/C with rationale. |
| R3 | MET | `packages/app/src/services/feature-service.ts:515-537` (`syncFeature` refuses a P0 hop into `active`, returns `goalConflict`), `:547-553` (`findOneActiveGoalConflict` reuses the L3 scan), `:55` (result type); `apps/cli/src/commands/feature.ts:398-399,418-419`; tests `packages/app/tests/services/feature-service.test.ts:767-816` + `:818-843`. |
| R4 | MET | 4 direction-aware tests in `packages/app/tests/services/feature-check.test.ts`, 2 R3 tests in `packages/app/tests/services/feature-service.test.ts`, deadlock fixture in `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts`. Mutation re-verified 2026-08-02: stripping `--as verifying` from `config/workflows/feature-lifecycle.yaml:52` yields 6 pass / 1 fail; restoring yields 7 pass / 0 fail. |

Functional verdict: **PASS** — 4/4 requirements MET, 4/4 AC scenarios covered by executable evidence.

**SECUA (sp:code-verification)**

- **Security** — no findings. No new input surface reaches a write path: `--as` is a read-only evaluation hint, and `findOtherP0InStatus` reads only inside `featuresDir` with regex-constrained ids.
- **Efficiency** — no regression. The R3 guard reuses the same single corpus scan as the L3 rule rather than adding a second walk.
- **Correctness** — the direction-aware rule is the correct root-cause fix: it distinguishes *entering* the goal set from *exiting* it, which is precisely what the deadlock required. Entry (`--as active`) remains denied, so the B09 WIP limit is preserved rather than widened. One P3 above.
- **Usability** — `[GOAL-CONFLICT]` gives the operator a named, actionable tag instead of a silent `SKIPPED`. One P3 above.
- **Architecture** — see below.

SECUA verdict: **PASS** — no blocker or major findings.

**Architecture (sp:code-improvement)**

- **Positive** — extracting `findOtherP0InStatus` (`packages/app/src/services/feature-check.ts:716`) is a genuine deepening: the L3 check rule and the R3 activation guard now enforce one WIP-limit definition against one corpus scan, instead of two drifting implementations. This is what makes R3 consistent with R1 rather than a second, parallel rule.
- **Positive** — threading the transition target through `--as` rather than adding an FSM escape edge (Option A) or an override verb (Option C) keeps the lifecycle graph unchanged. The fix removes a contradiction instead of adding a bypass, which is the smaller long-term surface.
- **Advisory** — the duplicated `['active']` literal (P4 above) is the one seam left shallow.

Architecture verdict: **PASS** — advisory only.

**Residual risk**

- The npm-global `spur` on this machine is stale and lacks `--as`. FSM guards are immune (`spurBin` resolves from the running process, `apps/cli/src/workflow/resolve-spur-bin.ts:30-41`), but a manual `spur feature check --as` needs `bun link` + `build:bundle` first. Operator-facing, not a code defect.
- F4's four legacy acceptance scenarios remain uncovered by task AC — pre-existing traceability debt from the wave-0/1/2 template era, surfaced (not caused) by 0418 being the first modern task under F4. Tracked separately; out of scope here.

**Disposition: PASS — no blocking findings.**
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-03T01:55:28.198Z todo → wip (system)
- 2026-08-03T01:57:29.333Z wip → testing (system)
- 2026-08-03T02:59:45.826Z testing → done (system)
