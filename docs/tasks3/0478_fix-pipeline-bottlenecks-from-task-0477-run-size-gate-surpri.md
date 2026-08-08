---
template: meta
schema_version: 1
name: "Fix pipeline bottlenecks from task 0477 run: size-gate surprise, verify-answer format mismatch, duplicate typecheck in test stage"
description: ""
status: done
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T03:15:12.543Z"
updated_at: "2026-08-08T05:08:19.759Z"
---

## 0478. Fix pipeline bottlenecks from task 0477 run: size-gate surprise, verify-answer format mismatch, duplicate typecheck in test stage

### Background
Task 0477 ("Batch worktree isolation `--worktree`") ran through `task-pipeline.yaml` on 2026-08-07
and completed in ~26 minutes of wall time (23:56 UTC → 00:22 UTC). Pipeline log forensics identified
three discrete issues. All three were re-verified against the current tree on 2026-08-08 before this
task was refined; the evidence below is confirmed, but the originally proposed fix for issue 2 was
reversed on review (see Q&A).

1. **Precheck size-gate surprise (S1):** The first pipeline launch (run `795ebac4`) failed
   immediately because the task had 11 Plan items against a default cap of 8
   (`config/workflows/task-pipeline.yaml:98`). The orchestrator had no signal before launch; a
   second launch with `maxImplementPlanItems=12` was needed — ~2 min waste plus operator friction.

2. **Verify answer file was prose, not a parseable verdict (S1 — provenance):** The verify
   `agent.run` stage wrote prose to `.spur/run/0477-verify-answer.txt` (beginning "Task 0477 is now
   `done`. Final state:"). The `verify/shell` step
   (`config/workflows/task-pipeline.yaml:305-307`) then ran
   `spur task verdict 0477 --from-answer …`, which correctly reported
   `Verdict: UNKNOWN (0 requirements, 1 checks)` and exited 1, routing the run to `failed`.

   **The `failed` state was correct, not false.** The verdict genuinely carried zero requirement
   rows. The actual defect is that the task was **already `done`** — the verify agent transitioned
   it in-session, so unverified work reached a terminal status. That gate hole is owned by task
   0479 R1; this task owns the other half — making the verify agent emit a parseable artifact in
   the first place.

3. **Double typecheck in the test stage (S2):** `qualityGateCmd` defaults to
   `bun run autofix && bun run spur-check` (`config/workflows/task-pipeline.yaml:85`). `autofix` is
   `bun run format && bun run typecheck`; `spur-check` invokes `bun run lint`, which is
   `biome check . --error-on-warnings && bun run typecheck`. Two full 7-workspace typecheck passes
   run back-to-back with no code change between them — ~8s wasted deterministically on every
   pipeline run.

The session used `omp-zai-volc` as the subprocess executor for review and verify. Review ran ~3m 54s,
verify ~8m 57s; both well within budget. Test loop count: 4 unique targeted test commands, no
repeat-without-change loops. Compactions: 2 (verify session only). Guard failures: 0.
### Requirements
- [x] R1. **Precheck size-gate early warning.** Before launching
      `spur workflow run task-pipeline.yaml`, the orchestrating skill (`sp:spur-dev` / `/sp:dev-run`)
      should probe the task's Plan-item count when `--mode full` and surface a violation to the
      operator rather than letting the pipeline fail cold. With `--auto`, add the
      `maxImplementPlanItems` override automatically and emit a one-line notice. Target:
      `plugins/sp/skills/spur-dev/references/execution-workflow.md` § Step 2 launch guidance.
      Measurable: the operator learns of a plan-item violation before any `spur workflow run` call;
      one launch attempt suffices.

- [x] R2. **Verify answer-file format contract.** The verify stage must write a machine-parseable
      answer file that `spur task verdict --from-answer` can read: an explicit `Verdict:` line plus
      the per-requirement table (`| Req | Status | Evidence |`) and AC table that
      `plugins/sp/skills/code-verification/SKILL.md` § Step 11 already specifies as the answer-file
      contract. The gap is that the contract is stated in the skill's *reporting* step but is not
      restated at the pipeline's `verify/agent.run` input, so a subprocess executor can satisfy the
      prose instruction while producing an unparseable file. Target:
      `plugins/sp/skills/code-verification/SKILL.md` § Step 11 (make the answer-file schema
      explicit and self-contained) and the `verify/agent.run` input in
      `config/workflows/task-pipeline.yaml`. Measurable: a pipeline verify run produces a verdict
      with ≥ 1 requirement row and a non-`UNKNOWN` verdict.

      **Do not** make `verify/shell` tolerate an unparseable answer file. See Q&A — that fix was
      considered and rejected as it would institutionalize the gate hole task 0479 R1 closes.

- [x] R3. **Eliminate the redundant typecheck in the test stage.** Change the `qualityGateCmd`
      default in `config/workflows/task-pipeline.yaml:85` from
      `bun run autofix && bun run spur-check` to `bun run format && bun run spur-check`. `autofix`
      differs from `format` only by the trailing `bun run typecheck`, which `spur-check` already
      runs via `bun run lint`. Do **not** change `autofix` in `package.json` — other callers rely on
      it. Target: `config/workflows/task-pipeline.yaml:85` only. Measurable: typecheck runs once per
      test stage, not twice; lint and format coverage unchanged.
### Acceptance Criteria
```gherkin
# ── R1: Precheck size-gate early warning ──
Scenario: R1.1 Orchestrator warns before launch when plan items exceed cap
  Given a task with 11 Plan items and the pipeline default cap of 8
  When the operator invokes /sp:dev-run <wbs> --mode full
  Then the skill surfaces a warning before any spur workflow run call
  And suggests the --vars override or plan reduction
  And prompts the operator to confirm (unless --auto is set)

Scenario: R1.2 --auto bypasses the prompt but logs the override
  Given the same task with 11 Plan items and --auto set
  When the operator invokes /sp:dev-run <wbs> --mode full --auto
  Then the skill adds maxImplementPlanItems to vars automatically
  And launches the pipeline without an interactive pause
  And emits a single-line notice about the override

# ── R2: Verify answer-file format contract ──
Scenario: R2.1 A pipeline verify run produces a parseable verdict
  Given a verify stage running as a subprocess executor
  When it writes the answer file to .spur/run/<wbs>-verify-answer.txt
  Then the file carries an explicit Verdict line
  And a per-requirement table with at least one requirement row
  And spur task verdict --from-answer exits 0 with PASS or FAIL, never UNKNOWN

Scenario: R2.2 An unparseable answer file still fails the pipeline
  Given a verify agent that wrote prose instead of the contracted tables
  And the task status is already done
  When verify/shell runs spur task verdict --from-answer
  Then the verdict is UNKNOWN and the step exits non-zero
  And the pipeline routes to failed
  And the run is not treated as a pass on account of the task's status

# ── R3: Redundant typecheck elimination ──
Scenario: R3.1 Typecheck runs exactly once per test stage
  Given a clean working tree
  When the test stage executes qualityGateCmd
  Then typecheck is invoked exactly once, inside spur-check
  And the test stage wall time decreases versus the two-typecheck baseline

Scenario: R3.2 Lint and format coverage is unchanged
  Given the updated qualityGateCmd default
  When a file with a lint violation is in the working tree
  Then the test stage still catches the violation and fails

Scenario: R3.3 The shared autofix script is untouched
  Given the change is scoped to the pipeline's qualityGateCmd default
  When package.json is inspected
  Then the autofix script still runs format followed by typecheck for its other callers
```
### Q&A
**Q: The original task proposed making `verify/shell` soft-pass when the task is already `done`. Why was that removed?**
A: Because it institutionalizes the exact defect that produced this run. The task was `done` only
because the verify agent transitioned it in-session; treating that status as evidence the
verification succeeded is circular. Task 0477 is the proof — it reached `done` carrying
`Verdict: UNKNOWN — No requirements recorded`, and a full re-verification session was needed to
establish it was actually PASS. Task 0479 R1 closes that hole by making the done-gate *reject*
empty/UNKNOWN verdict artifacts; a soft-pass in `verify/shell` would reopen it from the other side.
The two changes would have fought each other.

**Q: So the pipeline's `failed` state was correct?**
A: Yes. The verdict genuinely had zero requirement rows. `verify/shell` did its job. The bug is
upstream (the agent wrote prose) and downstream (the task was already `done`), not in the gate.
Reframing this was the main correction applied during refinement.

**Q: Is R2 a duplicate of task 0479 R1?**
A: No — they are the two halves of one failure. 0479 R1 hardens the *consumer*: the done-gate must
reject an empty verdict artifact. This task's R2 fixes the *producer*: the verify agent must emit a
parseable one. Landing only 0479 R1 would turn this run into a hard pipeline failure with no
diagnosis; landing only R2 would leave the gate open for any other malformed path. Cross-reference
both; neither is redundant.

**Q: Should the pre-launch size-gate warning (R1) be an interactive HITL gate or just a log line?**
A: Interactive when `--auto` is absent; with `--auto`, add the override and log once. That matches
the rest of the `--auto` contract — objective confirmations are skipped, taste and irreversible
gates still pause.

**Q: Why not raise the default `maxImplementPlanItems` globally?**
A: The default is a task-complexity heuristic — tasks with >8 plan items are typically
under-decomposed. Raising it silences a useful signal. The pre-launch warning keeps the signal while
removing the cold-failure UX.

**Q: For R3, does removing the standalone typecheck risk missing early type errors?**
A: No. `spur-check` runs `bun run lint`, which is `biome check . --error-on-warnings && bun run
typecheck` across all 7 workspaces. Only the duplicate pass is removed. `bun run format`
(`biome check . --write`) is retained so auto-fixable issues are still corrected before the gate.

**Q: Why change `qualityGateCmd` rather than the `autofix` script?**
A: `autofix` is a shared repo script with callers outside the pipeline; stripping typecheck from it
would weaken those. The duplication exists only in the pipeline's composition of
`autofix` + `spur-check`, so the pipeline default is the correct and narrowest place to fix it.
### Design
#### R1 — Precheck size-gate early warning

**Evidence.** Pipeline run `795ebac4` launched `2026-08-07T23:56:14Z`, failed `23:56:16Z` (2s):

```
FAIL — 0 R-items, 11 Plan items
Task has 11 Plan items (max 8). Consider simplifying the plan or raise maxImplementPlanItems via --vars.
```

`config/workflows/task-pipeline.yaml:97-98` already documents the override
(`maxImplementPlanItems: "8"` with `# Override with --vars '{"maxImplementPlanItems":"15"}'`). The
orchestrator consumed it only after a cold failure. Confirmed 2026-08-08: 0477 carries exactly 11
Plan items.

**Root cause.** `execution-workflow.md` § Step 2 documents async launch mechanics but does not
instruct the orchestrating skill to pre-flight the Plan-item count. The size probe lives in
`packages/app/src/services/task-size-precheck.ts` and runs only *inside* the pipeline.

**Fix.** Add a pre-launch guard block to
`plugins/sp/skills/spur-dev/references/execution-workflow.md` § Step 2: warn/confirm above the cap;
under `--auto`, inject the override and emit one notice.

---

#### R2 — Verify answer-file format contract

**Evidence.**

- `verify/agent.run` (omp-zai-volc, `2026-08-08T00:13:25Z`) wrote prose to
  `.spur/run/0477-verify-answer.txt`, beginning "Task 0477 is now `done`. Final state:".
- `verify/shell` (`config/workflows/task-pipeline.yaml:305-307`) ran
  `spur task verdict 0477 --from-answer .spur/run/0477-verify-answer.txt` →
  `Verdict: UNKNOWN (0 requirements, 1 checks)` → exit 1 → run routed to `failed`.
- The task was already `done` (agent transitioned in-session); `record` never ran; manual
  `spur task record 0477` was required.

**Root cause.** The producer, not the gate. `plugins/sp/skills/code-verification/SKILL.md` § Step 11
specifies the answer-file contract (explicit `Verdict:` line, `| Req | Status | Evidence |` table,
AC table) as part of its *reporting* instructions, but the pipeline's `verify/agent.run` input does
not restate it. A subprocess executor can satisfy the prose instruction while emitting a file the
parser cannot read.

**Fix.** Make the answer-file schema explicit and self-contained in
`plugins/sp/skills/code-verification/SKILL.md` § Step 11, and restate it at the `verify/agent.run`
input in `config/workflows/task-pipeline.yaml`.

**Rejected fix (do not implement).** The original task proposed a `verify/shell` guard: "if verdict
exits non-zero but task status is already `done` or `testing`, treat as soft-pass and continue to
`record`." This is unsafe — it accepts the task's own status as proof of its verification, which is
circular, and directly contradicts task 0479 R1 (done-gate must reject empty/UNKNOWN verdict
artifacts). It would have re-opened the hole that let 0477 reach `done` unverified. The original
task also cited writing the verdict via `spur task update --section Verification`; `Verification` is
not a canonical section (`TASK_CANONICAL_SECTIONS`,
`packages/domain/src/planning/markdown-document.ts:32-45`). The answer file path
`.spur/run/<wbs>-verify-answer.txt` is the correct target.

---

#### R3 — Redundant typecheck in the test stage

**Evidence.** Pipeline log `73026de1`, lines 116-138:

```
[00:08:23.567Z] stderr: $ bun run format && bun run typecheck   ← autofix expansion
[00:08:24.494Z] stderr: $ bun run --filter '*' typecheck         ← all 7 workspaces, pass 1
[00:08:31.700Z] stderr: $ bun run link-check && bun run lint && … ← spur-check → lint → typecheck, pass 2
```

Verified 2026-08-08 against `package.json`: `autofix` = `bun run format && bun run typecheck`;
`lint` = `biome check . --error-on-warnings && bun run typecheck`; `spur-check` includes
`bun run lint`.

**Root cause.** `qualityGateCmd` (`config/workflows/task-pipeline.yaml:85`) composes `autofix` with
`spur-check`; both carry a typecheck.

**Fix.** Change the `qualityGateCmd` default at `config/workflows/task-pipeline.yaml:85`:

```yaml
qualityGateCmd: "bun run format && bun run spur-check"
```

**Precision note.** The literal string `bun run format && bun run typecheck` does **not** appear in
the YAML — it is `autofix`'s definition in `package.json`. The edit target is the `qualityGateCmd`
default, not a `test/shell` command body, and `package.json` must not be modified (other callers
depend on `autofix` retaining its typecheck).
### Plan
- [x] **P1 — Pre-launch size-gate guidance.** Add a pre-launch guard block to
      `plugins/sp/skills/spur-dev/references/execution-workflow.md` § Step 2: warn/confirm when the
      Plan-item count exceeds `maxImplementPlanItems` (default 8); under `--auto`, inject the
      override and emit one notice. (R1)
- [x] **P2 — Verify answer-file contract.** Make the answer-file schema explicit and self-contained
      in `plugins/sp/skills/code-verification/SKILL.md` § Step 11, and restate it at the
      `verify/agent.run` input in `config/workflows/task-pipeline.yaml`. (R2)
- [x] **P3 — Eliminate the duplicate typecheck.** Change the `qualityGateCmd` default at
      `config/workflows/task-pipeline.yaml:85` to `bun run format && bun run spur-check`. Do not
      touch `package.json`. (R3)
- [x] **P4 — Cross-reference 0479.** Record in this task and in 0479 that R2 (producer) and 0479 R1
      (consumer) are the two halves of the same failure and should land together. (R2)
- [x] **P5 — Gate.** `bun run autofix && bun run spur-check`; `spur task check 0478`.
### Solution
| Change (`file:line`) | Description |
|----------------------|-------------|
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:89-94` | R1: Add pre-launch size-gate pre-check guidance to execution-workflow.md |
| `plugins/sp/skills/code-verification/SKILL.md:265-285` | R2: Make answer-file schema contract explicit and self-contained in Step 11 |
| `config/workflows/task-pipeline.yaml:293-296` | R2: Restate answer-file schema contract in verify stage description |
| `config/workflows/task-pipeline.yaml:85` | R3: Update qualityGateCmd default to `bun run format && bun run spur-check` to eliminate duplicate typecheck |
### Testing
**Verdict: PASS** — independent re-audit via
`/sp:dev-verify 0478 --auto --next --force --focus all --fix all` (2026-08-08). All three
requirements MET and all seven AC scenarios MET on first pass; the fix pass repaired bookkeeping
only, not requirements.

**Scope note.** This task was refined before implementation (see Notes § Refinement audit); the
implementation followed the refined spec, including the **rejected** fix. Both safety-critical
assertions from that refinement were re-checked here and hold.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-workflow.md:89` — pre-launch size-gate pre-check under § Step 2: probes the `## Plan` item count against the cap of 8, warns/prompts without `--auto`, injects `maxImplementPlanItems` and logs one notice with `--auto` |
| R2 | MET | `plugins/sp/skills/code-verification/SKILL.md:265-285` — explicit, self-contained answer-file schema (literal `Verdict:` line + `\| Req \| Status \| Evidence \|` + `\| AC \| Status \| Evidence Type \| Evidence \|` + SECUA table), restated at the pipeline input in `config/workflows/task-pipeline.yaml:293-296` |
| R3 | MET | `config/workflows/task-pipeline.yaml:85` — `qualityGateCmd: "bun run format && bun run spur-check"`. Composition proof from `package.json`: `format` = `biome check . --write` (no typecheck); `spur-check` → `lint` = `biome check . --error-on-warnings && bun run typecheck`. Typecheck therefore runs **exactly once** |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| R1.1 Orchestrator warns before launch when plan items exceed cap | MET | static | `plugins/sp/skills/spur-dev/references/execution-workflow.md:89-90` |
| R1.2 --auto bypasses the prompt but logs the override | MET | static | `plugins/sp/skills/spur-dev/references/execution-workflow.md:91` |
| R2.1 A pipeline verify run produces a parseable verdict | MET | static | `plugins/sp/skills/code-verification/SKILL.md:265-285`; `config/workflows/task-pipeline.yaml:293-296` |
| R2.2 An unparseable answer file still fails the pipeline | MET | command | `config/workflows/task-pipeline.yaml:306-308` — `verify/shell` is still a bare `spur task verdict --from-answer`; grep for a soft-pass / `\|\| true` / status-based bypass returns **none**. The rejected fix did not reappear |
| R3.1 Typecheck runs exactly once per test stage | MET | command | `jq '.scripts' package.json` — `format` carries no typecheck; only `spur-check` → `lint` does |
| R3.2 Lint and format coverage is unchanged | MET | command | `format` retained in `qualityGateCmd`; `lint` still inside `spur-check` |
| R3.3 The shared autofix script is untouched | MET | command | `git diff package.json` → empty; `autofix` still `bun run format && bun run typecheck` for its other callers |

**Gates run this turn**

- `bun test plugins/sp/tests/` → **496 pass / 0 fail**.
- `bun test packages/app/tests/services/task-service.test.ts packages/app/tests/services/task-check.test.ts` → **198 pass / 0 fail**.
- `bun run test` (full, this tree, this session) → **4636 pass / 24 fail**; all 24 in the seven known
  port-binding suites, bucketing to `Failed to listen at 127.0.0.1` / `port 0 in use` / `ps failed`
  — the documented sandbox baseline. Per R5's single-run discipline the failure list was parsed from
  that run's retained output rather than re-running; only task/feature corpus markdown has changed
  since, so no code path was invalidated.
- `bun run lint` → clean (7/7 typecheck); `bun run build` → green; `bun run corpus-check` → 0 new, 0 stale.
- `spur task check 0478 --strict-core` → **pass=true, errors=0, warnings=0**.
- Coverage: N/A (workflow-config and skill-documentation change; no runtime code path added).

**Fix pass (`--fix all`) — three bookkeeping repairs, no requirement was UNMET**

1. **P4 was half-done.** The plan item required recording the 0478 R2 ↔ 0479 R1 relationship *in both
   tasks*. This task cited 0479 ten times; 0479 cited this task zero times. Added the reciprocal
   entry to 0479's `## References` naming R2 as the **producer** half and 0479 R1 as the **consumer**
   half of the same failure.
2. **8 unchecked checklist boxes** on a `done` task (3 Requirements, 5 Plan) — flipped to `[x]`,
   clearing `L3.unchecked-checklist`.
3. **DD-09 subset**: promoted all 7 task scenarios into feature H1's Acceptance Criteria (58 → 65
   scenarios), matching the convention already used by 0141/0161/0477/0479. Cleared 7 ×
   `L4.uncovered-task-scenario`.

**Artifact disclosure.** This run wrote `.spur/run/0478-verdict.json` (gitignored) — verdict `PASS`,
3 requirement rows, 7 AC rows, `checks[]` carrying `design-conformance`, `strict-core`,
`unit-tests`, `coverage`, and `shippable`.

**Shippable: FAIL — feature H1.** Not caused by 0478. `spur feature check H1` carries
`L4.scenario-unverified` and `L4.uncovered-feature-scenario` findings predating this task, plus one
incomplete linked task (**0480**, `todo`). Recovery: re-verify the tasks behind the remaining
unverified scenarios so they carry PASS+MET verdict rows, cover the orphan scenarios, and complete
0480 — none of which is 0478 work.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References
- `.spur/run/795ebac4-bb12-470d-95ce-d570783c66a9.log` — first pipeline run (failed precheck).
- `.spur/run/73026de1-9a69-4285-b8e1-c5d74dd1d579.log` — second pipeline run (4372 lines, ~26 min).
- `.spur/run/73026de1-9a69-4285-b8e1-c5d74dd1d579/agent-sessions/omp-zai-volc/` — review + verify
  JSONL sessions.
- `config/workflows/task-pipeline.yaml:85` — `qualityGateCmd` default (R3 edit target).
- `config/workflows/task-pipeline.yaml:97-98` — `maxImplementPlanItems` default + override comment (R1).
- `config/workflows/task-pipeline.yaml:305-307` — `verify/shell` running
  `spur task verdict --from-answer` (R2).
- `packages/app/src/services/task-size-precheck.ts` — the in-pipeline size probe R1 hoists earlier.
- `packages/domain/src/planning/markdown-document.ts:32-45` — `TASK_CANONICAL_SECTIONS`; confirms
  `Verification` is not a section (corrects the original task's Fix 2b citation).
- `plugins/sp/skills/spur-dev/references/execution-workflow.md` § Step 2 — R1 target.
- `plugins/sp/skills/code-verification/SKILL.md` § Step 11 — answer-file contract, R2 target.
- `docs/tasks3/0479_fix-verification-loop-gate-holes-and-discovery-costs-found-i.md` R1 — the
  consumer-side done-gate fix this task's R2 pairs with.
- `package.json` — `autofix`, `lint`, `spur-check` script definitions behind the R3 analysis.
### History
- 2026-08-08T03:35:25.383Z backlog → todo (system)
- 2026-08-08T04:35:05.978Z todo → wip (system)
- 2026-08-08T04:38:00.012Z wip → testing (system)
- 2026-08-08T04:38:02.439Z testing → done (system)
### Notes
**Session inventory (confidence: High — OMP JSONL parsed directly)**

| Session | Agent | File | Start | End | Duration |
|---------|-------|------|-------|-----|----------|
| Failed precheck (run 795ebac4) | orchestrator (Antigravity) | `.spur/run/795ebac4*.log` | 23:56:14Z | 23:56:16Z | ~2s |
| Implement (run 73026de1, stage 1) | omp (default) | `omp/2026-08-07T23-56-38*.jsonl` | 23:56:38Z | 00:08:22Z | 11m 44s |
| Review (run 73026de1, stage 2) | omp-zai-volc | `omp-zai-volc/2026-08-08T00-09-31*.jsonl` | 00:09:31Z | 00:13:24Z | 3m 54s |
| Verify (run 73026de1, stage 3) | omp-zai-volc | `omp-zai-volc/2026-08-08T00-13-25*.jsonl` | 00:13:25Z | 00:22:21Z | 8m 57s |

**Total wall time:** ~26 min (first launch attempt → task `done`).
**Wasted time:** ~2 min (precheck fail + relaunch) + ~8s/run (duplicate typecheck).
**Terminal states:** pipeline `failed` (verify/shell exit 1 — *correct*, the verdict was UNKNOWN);
task `done` (in-session agent transition — *incorrect*, unverified work reached a terminal status).

**Bottleneck severity ranking**

1. **B1 `verify-answer-format` — S1 (provenance).** The verify stage emitted prose, so no parseable
   verdict existed. Not a time-cost bottleneck; the cost is that verification provenance was lost and
   a full re-verification session was later required to establish 0477's real verdict (PASS). The
   companion consumer-side hole — a task reaching `done` on an empty verdict — is task 0479 R1.
2. **B2 `guard` (size-gate) — S1 (~2 min + operator friction).** One failed launch, one relaunch.
3. **B3 `redundant-typecheck` — S2 (~8s/run, deterministic).** Minor alone; accumulates across batch
   runs.

**What worked well (preserve)**

- **Targeted-test-first discipline.** The implement agent ran
  `plugins/sp/tests/command-flag-parity.test.ts`, `command-contract.test.ts`, and
  `skill-structure.test.ts` rather than the full suite, invoking `spur-check` once at the end —
  exactly the AGENTS.md rule (task 0436 R2).
- **No test-loop anti-pattern.** Each targeted test ran ≤ 2× (first run + one re-run after a fix);
  no repeat-without-change loops.
- **No guard failures.** 0 `GuardDeniedError` events across both agent sessions.
- **Self-caught regression.** The implement agent noticed a dropped table row in its own edits and
  re-ran the parity gate unprompted.

**Refinement audit (2026-08-08)**

All three findings were re-verified against the tree before implementation was authorized. Changes
made during review: the R2 "soft-pass when already done" fix was **removed** as unsafe (see Q&A and
Design § R2 Rejected fix); the "false `failed` state" framing was corrected; the R3 edit target was
corrected from a non-existent `test/shell` string to the `qualityGateCmd` default; and three bad
citations were fixed (`task-size-check.ts` → `packages/app/src/services/task-size-precheck.ts`,
`verify/shell` line "~180 approx" → `305-307`, and `--section Verification` → the answer-file path,
`Verification` not being a canonical section).
