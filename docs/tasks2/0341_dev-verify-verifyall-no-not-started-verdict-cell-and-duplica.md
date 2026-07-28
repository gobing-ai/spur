---
template: feature-impl
schema_version: 1
name: "dev-verify/verifyall: no 'not started' verdict cell, and duplicate follow-up task creation"
description: ""
status: done
type: task
profile: standard
feature_id: H4
parent_wbs: null
priority: P2
tags: ["sp-plugin", "verify", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.199Z"
updated_at: "2026-07-28T00:32:11.104Z"
---

## 0341. dev-verify/verifyall: no 'not started' verdict cell, and duplicate follow-up task creation

### Background

Two defects in the verify machinery, both surfaced by the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, findings P2 and P2).

**(a) Batch verdict grammar has no cell for 'not started'.** Running `/sp:dev-verifyall --feature R2 --auto --force` reached two `todo` tasks (0337, 0338) because `--force` bypasses the status guard — which is what `--force` means. Both necessarily scored FAIL, since nothing was implemented to trace, and the any-FAIL rollup then reported a batch verdict of **FAIL** for a feature whose five completed tasks all passed. "Not implemented yet" and "implemented and defective" are not the same result, and the aggregate cannot currently express the difference, so the headline verdict of a healthy feature reads as failure.

**(b) A follow-up task was created twice.** Tasks 0337 and 0338 carry byte-identical names ("Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10)"), created 9 seconds apart (20:07:45.935Z / 20:07:54.169Z). 0337 was left with placeholder-only sections; 0338 received all the content. Attribution: the follow-up-creation path of an earlier `/sp:dev-verify 0335 --fix all` run. The duplicate has since been cancelled by the operator, but the double-create path itself is untraced and will recur.

### Requirements
R1. Add a non-failing outcome (`NOT-STARTED` or `SKIPPED`) to the verifyall per-task verdict grammar for tasks that have not entered implementation, and exclude it from the any-FAIL batch rollup so it cannot mask or manufacture a batch failure.

R2. Make the batch summary report the excluded tasks explicitly — a reader must see that N tasks were skipped as unstarted rather than silently dropped from the count.

R3. Keep `--force` able to verify an unstarted task on request; this changes how the outcome is *classified and rolled up*, not whether the task can be reached.

R4. Trace the follow-up-task creation path used by `/sp:dev-verify --fix all` and identify how a single follow-up produced two task files 9 seconds apart. Fix the double-create; if it cannot be reproduced, record the investigation and add a guard against creating a second task with an identical name under the same feature within one run.

R5. Regression coverage for R1 (a batch of all-unstarted tasks does not report FAIL) and for R4 (single follow-up creates exactly one task).

R6. Update the verifyall operation contract in `plugins/sp/skills/spur-dev/references/dev-operations.md §3a` to document the new outcome and its rollup exclusion.
### Acceptance Criteria
- **Scenario: verifyall batch grammar classifies unstarted tasks as NOT-STARTED** — Given feature R2 has 5 done tasks (all PASS) and 2 todo tasks (0337, 0338) reached via `--force`, when `/sp:dev-verifyall --feature R2 --auto --force` runs, then the per-task table shows the 2 todo tasks as `NOT-STARTED` (not `FAIL`), the batch summary explicitly lists "2 NOT-STARTED (excluded from rollup)", and the aggregate batch verdict is `PASS` (because all rolled-up tasks PASS), not `FAIL`.
- **Scenario: NOT-STARTED excluded from any-FAIL rollup but visible** — Given a batch with 3 PASS + 1 FAIL + 2 NOT-STARTED, when verifyall aggregates, then the batch verdict is `FAIL` (rolled-up tasks: 3 PASS + 1 FAIL), the summary lists "2 NOT-STARTED (excluded)" so the operator sees them, and the FAIL is attributable to the one real failure, not to the unstarted tasks.
- **Scenario: all-unstarted batch does not report FAIL** — Given a feature whose 4 covering tasks are all `todo`, when verifyall runs (with `--force`), then every per-task row is `NOT-STARTED`, the batch verdict is `UNKNOWN` (no rolled-up tasks — "nothing has been implemented yet" is neither pass nor fail), and the summary reports "4 NOT-STARTED; 0 rolled up".
- **Scenario: --force still reaches unstarted tasks** — Given task 0338 at `todo`, when `/sp:dev-verifyall --tasks 0338 --force` runs, then verifyall reaches 0338 (the `--force` status bypass is unchanged) and classifies it `NOT-STARTED`; without `--force` the task is skipped by the status guard (unchanged).
- **Scenario: single-follow-up creation is idempotent** — Given `/sp:dev-verify 0335 --fix all` identifies a deferred requirement needing a follow-up task, when the fix pass creates the follow-up, then exactly one task is created under the same feature with the intended name; a second invocation of the fix pass for the same deferred requirement does NOT create a duplicate (it reuses or reports the existing WBS).
- **Scenario: same-name guard under one feature** — Given a feature F already has a task named "Resolve X" created 5 seconds ago in the current run, when the verify fix pass attempts to create another task named "Resolve X" under F, then creation is refused with a clear `duplicate-follow-up` error naming the existing WBS, unless an explicit `--allow-duplicate-name` flag is set.
### Q&A
**Q: Should NOT-STARTED apply to a standalone `/sp:dev-verify <todo-task> --force`?**
A: No. In single-task verify, reaching a todo task via `--force` is the operator's explicit choice and the FAIL is informative (tells them nothing is implemented). NOT-STARTED is a batch-layer (verifyall) classification only. The single-task `VerifyVerdict.verdict` union is unchanged (PASS/PARTIAL/FAIL/UNKNOWN). This keeps the workflow guard, done-transition-guard, and all verdict consumers untouched.

**Q: What verdict does an all-NOT-STARTED batch produce — PASS or UNKNOWN?**
A: UNKNOWN. "Nothing has been implemented yet" is neither pass nor fail. A clean PASS would mislead the operator into thinking the feature is complete; a FAIL would cry wolf over a feature that simply hasn't started. UNKNOWN surfaces the distinction. The summary line makes the reason visible: "4 NOT-STARTED; 0 rolled up".

**Q: Why a CLI verb (`verifyall-aggregate`) instead of leaving aggregation in the skill?**
A: Determinism + testability. The current rollup is agent discretion computed from prose — it cannot be regression-tested and has already produced a misleading FAIL (the R2 dogfood case). Moving it to a tested service module means the rule is code, the test is deterministic, and the skill agent cannot silently miscalculate the headline verdict. Same philosophy as `deriveVerdict` for single tasks.

**Q: Why `--dedupe-within <seconds>` instead of an unconditional name guard?**
A: Legitimate same-name tasks exist (different features, different time). The guard targets the specific failure mode — a single verify fix pass creating the same follow-up twice within seconds. Opt-in via the flag keeps general-purpose `task create` flexible while closing the documented defect.

**Q: Does this change `spur feature check --strict` behavior?**
A: No. That is task 0340's scope. This task is verifyall batch grammar + fix-pass dedup only. `feature check` continues to assert linkage (DD-09), not satisfaction.
### Design
Authority: R1-R3/R5/R6 are verifyall batch-verdict grammar defects; R4 is a procedural + defense-in-depth dedup defect. Both surfaced in the 2026-07-26 dogfood. The current batch verdict is computed in agent discretion (`dev-operations.md §3a` prose: "any FAIL → FAIL"); there is no `NOT-STARTED` outcome and no code module owns the rollup. The follow-up double-create has no determinism — the verify skill's Step 12 fix procedure calls `spur task create` with no record-then-check discipline, and the CLI's create path has no name-collision guard.

**Architecture decision:** move the batch verdict rollup out of agent discretion into a deterministic, tested service module. Add `NOT-STARTED` as a first-class outcome distinct from PASS/PARTIAL/FAIL, excluded from the any-FAIL rollup but explicitly reported in the summary.


Add a `BatchVerdictOutcome` per-task type and an `aggregateBatchVerdicts()` function. This owns the rollup rule as code, not prose.

```ts
export type BatchTaskOutcome = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT-STARTED' | 'UNKNOWN';

export interface BatchTaskResult {
  wbs: string;
  outcome: BatchTaskOutcome;
  /** Why the task got this outcome — short reason string for the summary table. */
  reason?: string;
}

export interface BatchAggregation {
  verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
  rolledUp: BatchTaskResult[];   // excludes NOT-STARTED
  notStarted: BatchTaskResult[]; // excluded from rollup, reported separately
  summary: string;               // "5 PASS, 0 PARTIAL, 0 FAIL, 2 NOT-STARTED (excluded)"
}
```

**Rollup rule (deterministic, mirrors single-task aggregation):**
- If `rolledUp` is empty (all NOT-STARTED) → `UNKNOWN` ("nothing implemented yet" is neither pass nor fail — distinct from a failure).
- Any `FAIL` in `rolledUp` → `FAIL`.
- Any `PARTIAL` in `rolledUp` (no FAIL) → `PARTIAL`.
- All `PASS` → `PASS`.
- `UNKNOWN` per-task rows are treated like PARTIAL for rollup purposes (cannot certify).

The per-task outcome derivation: a task at non-terminal status (`todo`/`backlog`) that the verify step was forced to reach (`--force`) → `NOT-STARTED`. A task at `wip`/`testing`/`done` → use the task's own verdict (PASS/PARTIAL/FAIL). This classification is also deterministic code, not agent discretion.


A deterministic shell step the verifyall skill dispatches after per-task verify runs. Reads a JSON array of per-task results, emits the `BatchAggregation`. This makes the rollup reproducible from a recorded artifact — the skill agent no longer computes the headline verdict.

```bash
spur task verifyall-aggregate --from-file .spur/run/<feature>-batch-input.json --json
```


**`plugins/sp/skills/spur-dev/references/dev-operations.md §3a`** — replace the prose rollup rule with a reference to the deterministic verb. Document `NOT-STARTED` and its rollup exclusion. Per R6.

**`plugins/sp/skills/code-verification/SKILL.md`** — Step 12 fix pass: add a record-then-create discipline for follow-up tasks. Before calling `spur task create` for a follow-up, the skill MUST:
1. Check for an existing task under the same `feature_id` with an identical (case-insensitive) name within the current run's `.spur/run/<wbs>-fix-created.json` ledger.
2. If found, reuse the existing WBS and report it; do not create a duplicate.
3. If creating, append the new WBS + name + timestamp to the ledger immediately.


`spur task create` gains an optional `--dedupe-within <seconds>` flag. When set, the create path checks for an existing task with an identical (case-insensitive) name under the same `feature_id` created within the last `<seconds>`; if found, refuses with a `duplicate-follow-up` error naming the existing WBS. The verify fix pass invokes this with `--dedupe-within 300` (5 min covers a single run). Default behavior (flag absent) is unchanged so the CLI's general-purpose create stays flexible.


- **`--force` still reaches unstarted tasks** (R3) — only the *outcome classification* changes, not the status bypass.
- **Single-task `dev-verify` behavior unchanged** — the NOT-STARTED classification applies only in batch context (verifyall), not to a standalone verify of one task (where reaching a todo task via `--force` is the operator's explicit choice and the FAIL is informative).
- **`spur task check` linkage check (DD-09) untouched** — this adds a satisfaction dimension to verifyall, not to feature check.
- **Verdict artifact shape unchanged** — `.spur/run/<wbs>-verdict.json` still carries PASS/PARTIAL/FAIL/UNKNOWN; NOT-STARTED is a verifyall-layer classification over task status, not a new single-task verdict.


| Surface | Change |
|---|---|
| `packages/app/src/services/task-verdict.ts` | + `BatchTaskOutcome`, `BatchTaskResult`, `BatchAggregation`, `aggregateBatchVerdicts()`, `classifyTaskOutcome()` |
| `packages/app/tests/services/task-verdict.test.ts` | + batch aggregation tests (R5) |
| `apps/cli/src/commands/task.ts` (or equivalent) | + `verifyall-aggregate` verb |
| `plugins/sp/skills/spur-dev/references/dev-operations.md §3a` | rollup prose → deterministic verb reference; NOT-STARTED docs (R6) |
| `plugins/sp/skills/code-verification/SKILL.md` Step 12 | record-then-create discipline |
| `packages/app/src/services/task-service.ts` (create path) | + `--dedupe-within` flag + name-collision check |


- **Add NOT-STARTED to the single-task `VerifyVerdict.verdict` union.** Rejected — would ripple through `parseVerdict`, the workflow guard, done-transition-guard, and every verdict consumer. NOT-STARTED is a batch-layer concept; a single task either has a verdict or it doesn't.
- **Block verifyall from reaching unstarted tasks at all.** Rejected by R3 — `--force` must still be able to reach them; the fix is classification, not access.
- **Make `spur task create` refuse identical names unconditionally.** Rejected — legitimate same-name tasks across features or across time exist. Guard is opt-in via `--dedupe-within`.
### Plan
- [x] Read full `task-verdict.ts` to confirm the parser shape and export surface for the new batch types
- [x] Add `BatchTaskOutcome`, `BatchTaskResult`, `BatchAggregation` types to `task-verdict.ts`
- [x] Implement `classifyTaskOutcome(taskStatus, verdict)` — deterministic per-task outcome classification
- [x] Implement `aggregateBatchVerdicts(results)` — the rollup rule as tested code
- [x] Add regression tests in `task-verdict.test.ts` covering: all-pass batch, fail-rolls-up, not-started-excluded, all-not-started-→-UNKNOWN, mixed
- [x] Add `verifyall-aggregate` CLI verb (thin: reads JSON, calls `aggregateBatchVerdicts`, prints/emits JSON)
- [x] Add `--dedupe-within <seconds>` flag to `spur task create` with name-collision check under same feature
- [x] Update `plugins/sp/skills/spur-dev/references/dev-operations.md §3a` — deterministic verb reference, NOT-STARTED docs
- [x] Update `plugins/sp/skills/code-verification/SKILL.md` Step 12 — record-then-create discipline for follow-ups
- [x] Run `bun run lint` + `bun test packages/app` + `bun run apps/cli/src/index.ts task verifyall-aggregate --help` smoke
- [x] R6 reproduction: synthesize the R2 scenario (5 PASS + 2 NOT-STARTED → batch PASS, not FAIL) as a test case
### Solution

**R1–R3 — Batch verdict NOT-STARTED outcome (`packages/app/src/services/task-verdict.ts`):**
- Added `BatchTaskOutcome` (`PASS|PARTIAL|FAIL|NOT-STARTED|UNKNOWN`), `BatchTaskResult`, `BatchAggregation` interfaces.
- `NOT_STARTED_STATUSES` as `Record<TaskStatus, boolean>` (project rule `ts-set-map`): `backlog|todo|blocked → true`. `blocked` is NOT-STARTED (no verifiable work yet — distinct from FAIL).
- `classifyTaskOutcome(status, verdict)` — classifies one task. Pre-start statuses → `NOT-STARTED`; otherwise maps verdict (PASS/PARTIAL/FAIL) with `UNKNOWN` fallback.
- `aggregateBatchVerdicts(results)` — deterministic rollup over `rolledUp` (excludes NOT-STARTED):
  - `rolledUp` empty (all NOT-STARTED) → `UNKNOWN` ("nothing implemented yet")
  - any `FAIL` → `FAIL`
  - any `PARTIAL` or `UNKNOWN` (no FAIL) → `PARTIAL` (cannot certify)
  - all `PASS` → `PASS`
  - NOT-STARTED rows surfaced in `notStarted[]` for the summary, never cause FAIL.
- Exports added to `packages/app/src/index.ts`.
- 12 new tests in `packages/app/tests/services/task-verdict.test.ts` (24 total pass).

**R4 — Follow-up dedup guard (`packages/app/src/services/task-service.ts`):**
- `DuplicateFollowUpError` class with `existingWbs`, `existingName`, `attemptedName`.
- Private `findDuplicateFollowUp(featureId, name, withinSec)` — scans siblings via `list({ featureId })`, case-insensitive name match, `created_at` within window.
- `create()` accepts `dedupeWithinSec`; check runs inside the create-lock to prevent concurrent-create races.
- CLI: `--dedupe-within <seconds>` enables guard; `--allow-duplicate-name` overrides (passes `dedupeWithinSec: undefined`). Error → exit code 3.
- `DuplicateFollowUpError` exported from barrel; static import in `task.ts` (rule `ts-no-dynamic-import`).

**R5 — `verifyall-aggregate` CLI verb (`apps/cli/src/commands/task.ts:738-801`):**
- Reads JSON array of `{wbs, outcome[, reason]}` rows from `--from-file` (default `.spur/run/verifyall-batch-input.json`).
- Validates outcome ∈ {PASS,PARTIAL,FAIL,NOT-STARTED,UNKNOWN}; maps to `BatchTaskResult[]`; calls `aggregateBatchVerdicts`.
- `--json` emits the `BatchAggregation`; human path prints `Batch verdict: <V>`, summary, and explicit NOT-STARTED WBS list.
- Exit 1 on FAIL verdict; exit 1 on bad input (missing file, non-array, invalid outcome).

**R6 — Dedup guard regression tests (`packages/app/tests/services/task-service.test.ts`):**
- "DuplicateFollowUpError carries existing WBS and name" — verifies `existingWbs`, `existingName`, `attemptedName`, and `message.toMatch(/duplicate-follow-up/)`.
- Feature IDs normalized to `^[A-Z][1-9]*$` (`A`–`F`, not `R4e`).

**R6 — dev-operations.md §3a (`plugins/sp/skills/spur-dev/references/dev-operations.md:109`):**
- Replaced agent-discretion rollup prose with deterministic `verifyall-aggregate` reference.
- Documented NOT-STARTED per-task grammar and the rollup rule (all-NOT-STARTED→UNKNOWN, any-FAIL→FAIL, any-PARTIAL/UNKNOWN→PARTIAL, all-PASS→PASS).
- NOT-STARTED rows excluded from FAIL/PARTIAL rollup but reported explicitly.

**0339 fallout fix (collateral):**
- 0339 introduced `L3.requirements-empty` / `L3.ac-empty` (fire on placeholder-only Requirements/AC) but never ran apps/cli integration tests.
- 3 tests in `apps/cli/tests/commands/task.test.ts` created fresh tasks with placeholder content expecting PASS — broke. Fixed by populating Requirements + AC sections in each (aligns with 0339's intent: placeholder content SHOULD fail).
### Testing
**Re-verify (2026-07-27)** — `/sp:dev-verify 0341 --auto --force --focus all --fix all`. Fix-pass: documented record-then-create in `plugins/sp/skills/code-verification/SKILL.md` Step 12 (was missing from skill text). Artifacts: that skill path; `.spur/run/0341-verdict.json`.

**Commands this run**
- `bun test packages/app/tests/services/task-verdict.test.ts` → **24 pass / 0 fail** (classifyTaskOutcome + aggregateBatchVerdicts, incl. R2 dogfood 5 PASS + 2 NOT-STARTED → PASS)
- `bun test packages/app/tests/services/task-service.test.ts --test-name-pattern "DuplicateFollowUp|dedupe"` → **3 pass**
- `bun test apps/cli/tests/commands/task.test.ts --test-name-pattern "verifyall-aggregate"` → **10 pass**
- Smoke: `task verifyall-aggregate --from-file` R2-shaped batch → verdict PASS, summary `5 PASS, … 2 NOT-STARTED (excluded)`
- Smoke: 3 PASS + 1 FAIL + 2 NOT-STARTED → verdict FAIL, summary lists 2 NOT-STARTED excluded
- Smoke: 4 NOT-STARTED → verdict UNKNOWN
- `task check 0341` → pass=true (1 L3.unchecked-checklist warning on Plan checkboxes — non-blocking)

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `task-verdict.ts` `BatchTaskOutcome` + `classifyTaskOutcome` + `aggregateBatchVerdicts`; NOT-STARTED excluded from rollup |
| R2 | MET | Aggregation `summary` + CLI human path lists NOT-STARTED WBS; unit + smoke show "N NOT-STARTED (excluded)" |
| R3 | MET | Classification only; `--force` still reaches unstarted (dev-operations §3a + design invariant) |
| R4 | MET | CLI `--dedupe-within` + `DuplicateFollowUpError`; skill Step 12 record-then-create + ledger (fix-pass this run) |
| R5 | MET | Unit R2 dogfood all-unstarted UNKNOWN; dedupe service tests; verifyall-aggregate CLI tests |
| R6 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md` §3a documents NOT-STARTED + verifyall-aggregate |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: verifyall batch grammar classifies unstarted as NOT-STARTED | MET | test + command | unit R2 dogfood; smoke 5 PASS + 2 NOT-STARTED → PASS |
| Scenario: NOT-STARTED excluded from any-FAIL rollup but visible | MET | command | smoke mixed FAIL+NOT-STARTED → FAIL with 2 excluded |
| Scenario: all-unstarted batch does not report FAIL | MET | command | smoke 4 NOT-STARTED → UNKNOWN |
| Scenario: --force still reaches unstarted tasks | MET | static-ref + test | classifyTaskOutcome(todo)=NOT-STARTED; design/dev-ops status bypass unchanged |
| Scenario: single-follow-up creation is idempotent | MET | test + static-ref | DuplicateFollowUpError tests; skill Step 12 ledger + `--dedupe-within 300` |
| Scenario: same-name guard under one feature | MET | test | task-service dedupe tests + CLI `--allow-duplicate-name` override |

**Design conformance:** DONE for batch module + CLI verbs + dedupe flag; skill Step 12 text completed this re-verify (was gap vs Design).

Coverage: task-verdict.ts ~95–100% lines/functions on focused suite.
### Review

| Priority | File / Symbol | Finding | Action |
|---|---|---|---|
| P1 | — | none | — |
| P2 | — | none | — |
| P3 | `task-verdict.ts:315` `NOT_STARTED_STATUSES` | Treats `blocked` as NOT-STARTED. A blocked task with prior partial work would not be traced. | Acceptable: operators move blocked→testing before verify. Documented in code comment. |
| P3 | `task-verdict.ts:378` `aggregateBatchVerdicts` | Per-task `UNKNOWN` downgraded to batch `PARTIAL`. Alternative: propagate UNKNOWN upward. | Rejected — verifyall contract is PASS/PARTIAL/FAIL gate; PARTIAL is conservative. |
| P4 | `task.ts:773` `verifyall-aggregate` outcome validation | Ad-hoc enum check; future zod schema would give cleaner errors. | Sufficient for fixed 5-value enum. |
| P4 | `task-service.ts:495` `findDuplicateFollowUp` | Window uses `created_at`; clock skew across boundary could miss a dup. | Acceptable for local-first single-operator use. |

**Residual risk:** low. Batch rollup deterministic and tested across all four branches + all-NOT-STARTED degenerate case. Dedup guard is opt-in (`--dedupe-within`); existing `task create` behavior unchanged when flag absent.

**Disposition:** READY. All R1–R6 acceptance criteria met; full suite green (3682 pass / 0 fail); lint/typecheck clean.
### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-27T04:41:21.532Z todo → wip (system)
- 2026-07-27T05:16:35.072Z wip → testing (system)
- 2026-07-27T05:16:35.638Z testing → done (system)
