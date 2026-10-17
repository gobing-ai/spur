---
schema_version: 1
name: Typed engine builtins for gate, commit-guard and corpus transition
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T18:02:39.337Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - gate
estimate_hours: 4

dependencies: ["1231", "1224", "1222", "1223"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1234-verdict.json
---

## 1234. Typed engine builtins for gate, commit-guard and corpus transition

### Background

Feature D65 F4. task-pipeline has 54 inline shell actions; deterministic steps (gate, commit-guard, status transition) should be typed engine builtins, and project commands go through A92's `spur self exec`.

**Refine corrections (2026-10-17)**
- Title/R1 "typed engine builtins gate, commit-guard, corpus.transition" → `command.gate` already exists (packages/app/src/workflow/actions/command-gate.ts: executable + args, no shell, retry, resultFile, softFail; used task-pipeline.yaml:344, :923) → run `spur task gate`, `spur workflow commit-guard`, `spur task update <wbs> <status>` and `spur self exec` through command.gate; no new builtin kinds unless command.gate falls short. Title kept (CLI cannot rename); scope is the command.gate port.
- R2 "reuse a PASS receipt keyed by git tree hash" → receipt reuse already exists (quality-gate.ts:337 readReceiptStatus; PASS + tier full + inputDigest match) and the alternate-index tree capture exists (~:820–851) → re-key inputDigest to the gate-computed gitTree alone; drop the caller-supplied proofDigest input (:397, :407).
- Estimate 6h → 4h (no new action kinds).
- quality-gate.ts is modified in the A92 worktree → start from the A92-merged file.

### Requirements

- [x] R1. Deterministic steps in migrated workflows run as `command.gate` actions invoking existing verbs (`spur task gate`, `spur workflow commit-guard`, `spur task update <wbs> <status>`, `spur self exec <action>`), not shell actions.
- [x] R2. The gate selects run/recheck/light by visit and receipt, invokes project commands via `spur self exec <action>`, and reuses a PASS receipt whose inputDigest equals the gitTree it computes itself (quality-gate.ts alternate-index capture); no caller-supplied proofDigest.
- [x] R3. Step outcomes are typed (pass/fail/blocked via exit code + resultFile receipt path) and visible in action_runs traces.

### Acceptance Criteria

- [x] AC1 — R4 — Deterministic steps run as typed engine builtins (req: R1, R3)
- [x] AC2 — R11 — A passing gate receipt is reused while the tree hash is unchanged (req: R2)
- [x] AC3 — R16 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:24.481Z

- New action kinds: none; command.gate suffices (closed, refine 2026-10-17). Reopen only with a concrete gap command.gate cannot express.
- Digest key: gitTree only; task/feature hashes drop with the proof chain (closed; ADR-140).

### Design

Reuse command.gate (exec without shell, typed outcome, retry, resultFile) for every deterministic step; one implementation stays behind the CLI verb. Receipt reuse: keep readReceiptStatus (quality-gate.ts:337) and swap the digest input to `{gitTree}` from the existing `git read-tree HEAD` / `git add -A` (excluding docs/tasks*, docs/features*) / `git write-tree` capture — corpus edits do not invalidate a code PASS. Depends on A92 (1222 resolver, 1223 self exec, 1224 gate routing). Rejected: new `gate`/`corpus.transition` kinds (duplicate command.gate), shell actions with stricter guards (the shell layer is the overhead being removed).

### Plan

- [x] Failure modes: dirty tree between receipt and reuse, receipt from another wbs, unbound action, transition refused by graph, command.gate timeout
- [x] Re-key receipt inputDigest to gitTree; remove proofDigest input
- [x] Express gate / commit-guard / status transition as command.gate in the fixture workflow
- [x] Exercise via the fixture workflow

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task/gate.ts:11` |
| `apps/cli/src/commands/task/gate.ts:16` |
| `apps/cli/src/commands/task/gate.ts:23` |
| `apps/cli/src/commands/task/gate.ts:32` |
| `apps/cli/tests/commands/task/gate.test.ts:53` |
| `apps/cli/tests/commands/task/gate.test.ts:57` |
| `docs/design/workflow-execution-foundation.md:119` |
| `docs/help/cmd_task.md:584` |
| `docs/help2/task.md:259` |
| `packages/app/src/services/quality-gate.ts:1006` |
| `packages/app/src/services/quality-gate.ts:1008` |
| `packages/app/src/services/quality-gate.ts:101` |
| `packages/app/src/services/quality-gate.ts:1016` |
| `packages/app/src/services/quality-gate.ts:1022` |
| `packages/app/src/services/quality-gate.ts:1037` |
| `packages/app/src/services/quality-gate.ts:1054` |
| `packages/app/src/services/quality-gate.ts:1088` |
| `packages/app/src/services/quality-gate.ts:109` |
| `packages/app/src/services/quality-gate.ts:1100` |
| `packages/app/src/services/quality-gate.ts:123` |
| `packages/app/src/services/quality-gate.ts:28` |
| `packages/app/src/services/quality-gate.ts:342` |
| `packages/app/src/services/quality-gate.ts:348` |
| `packages/app/src/services/quality-gate.ts:354` |
| `packages/app/src/services/quality-gate.ts:376` |
| `packages/app/src/services/quality-gate.ts:378` |
| `packages/app/src/services/quality-gate.ts:386` |
| `packages/app/src/services/quality-gate.ts:387` |
| `packages/app/src/services/quality-gate.ts:391` |
| `packages/app/src/services/quality-gate.ts:394` |
| `packages/app/src/services/quality-gate.ts:396` |
| `packages/app/src/services/quality-gate.ts:398` |
| `packages/app/src/services/quality-gate.ts:402` |
| `packages/app/src/services/quality-gate.ts:405` |
| `packages/app/src/services/quality-gate.ts:411` |
| `packages/app/src/services/quality-gate.ts:415` |
| `packages/app/src/services/quality-gate.ts:43` |
| `packages/app/src/services/quality-gate.ts:58` |
| `packages/app/src/services/quality-gate.ts:61` |
| `packages/app/src/services/quality-gate.ts:658` |
| `packages/app/src/services/quality-gate.ts:674` |
| `packages/app/src/services/quality-gate.ts:701` |
| `packages/app/src/services/quality-gate.ts:726` |
| `packages/app/src/services/quality-gate.ts:788` |
| `packages/app/src/services/quality-gate.ts:802` |
| `packages/app/src/services/quality-gate.ts:816` |
| `packages/app/src/services/quality-gate.ts:826` |
| `packages/app/src/services/quality-gate.ts:85` |
| `packages/app/src/services/quality-gate.ts:880` |
| `packages/app/src/services/quality-gate.ts:89` |
| `packages/app/src/services/quality-gate.ts:890` |
| `packages/app/src/services/quality-gate.ts:895` |
| `packages/app/src/services/quality-gate.ts:904` |
| `packages/app/src/services/quality-gate.ts:913` |
| `packages/app/src/services/quality-gate.ts:921` |
| `packages/app/src/services/quality-gate.ts:924` |
| `packages/app/src/services/quality-gate.ts:931` |
| `packages/app/src/services/quality-gate.ts:934` |
| `packages/app/src/services/quality-gate.ts:936` |
| `packages/app/src/services/quality-gate.ts:940` |
| `packages/app/src/services/quality-gate.ts:95` |
| `packages/app/src/workflow/actions/command-gate.ts:15` |
| `packages/app/src/workflow/actions/command-gate.ts:216` |
| `packages/app/src/workflow/actions/command-gate.ts:218` |
| `packages/app/src/workflow/actions/command-gate.ts:225` |
| `packages/app/src/workflow/actions/command-gate.ts:232` |
| `packages/app/src/workflow/actions/command-gate.ts:65` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1005` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:101` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1013` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1017` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1021` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1024` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:1026` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:13` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:150` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:156` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:158` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:168` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:178` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:188` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:199` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:373` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:384` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:42` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:438` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:440` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:452` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:474` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:477` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:490` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:494` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:500` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:504` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:522` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:531` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:540` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:555` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:561` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:567` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:578` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:583` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:601` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:629` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:652` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:657` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:661` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:682` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:689` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:708` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:732` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:766` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:797` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:802` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:807` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:812` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:824` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:83` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:843` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:853` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:891` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:9` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:915` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:929` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:937` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:943` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:952` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:956` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:966` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:970` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:974` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:980` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:982` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:992` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:995` |
| `packages/app/tests/services/quality-gate-receipt.test.ts:999` |
| `packages/app/tests/services/quality-gate.test.ts:124` |
| `packages/app/tests/services/quality-gate.test.ts:126` |
| `packages/app/tests/services/quality-gate.test.ts:15` |
| `packages/app/tests/services/quality-gate.test.ts:22` |
| `packages/app/tests/services/quality-gate.test.ts:362` |
| `packages/app/tests/services/quality-gate.test.ts:366` |
| `packages/app/tests/services/quality-gate.test.ts:377` |
| `packages/app/tests/services/quality-gate.test.ts:398` |
| `packages/app/tests/services/quality-gate.test.ts:40` |
| `packages/app/tests/services/quality-gate.test.ts:411` |
| `packages/app/tests/services/quality-gate.test.ts:415` |
| `packages/app/tests/services/quality-gate.test.ts:419` |
| `packages/app/tests/services/quality-gate.test.ts:421` |
| `packages/app/tests/services/quality-gate.test.ts:423` |
| `packages/app/tests/services/quality-gate.test.ts:432` |
| `packages/app/tests/services/quality-gate.test.ts:440` |
| `packages/app/tests/services/quality-gate.test.ts:467` |
| `packages/app/tests/services/quality-gate.test.ts:475` |
| `packages/app/tests/services/quality-gate.test.ts:48` |
| `packages/app/tests/services/quality-gate.test.ts:481` |
| `packages/app/tests/services/quality-gate.test.ts:494` |
| `packages/app/tests/services/quality-gate.test.ts:497` |
| `packages/app/tests/services/quality-gate.test.ts:499` |
| `packages/app/tests/services/quality-gate.test.ts:501` |
| `packages/app/tests/services/quality-gate.test.ts:507` |
| `packages/app/tests/services/quality-gate.test.ts:513` |
| `packages/app/tests/services/quality-gate.test.ts:516` |
| `packages/app/tests/services/quality-gate.test.ts:529` |
| `packages/app/tests/services/quality-gate.test.ts:538` |
| `packages/app/tests/services/quality-gate.test.ts:543` |
| `packages/app/tests/services/quality-gate.test.ts:549` |
| `packages/app/tests/services/quality-gate.test.ts:552` |
| `packages/app/tests/services/quality-gate.test.ts:555` |
| `packages/app/tests/services/quality-gate.test.ts:562` |
| `packages/app/tests/services/quality-gate.test.ts:565` |
| `packages/app/tests/services/quality-gate.test.ts:575` |
| `packages/app/tests/services/quality-gate.test.ts:58` |
| `packages/app/tests/services/quality-gate.test.ts:586` |
| `packages/app/tests/services/quality-gate.test.ts:599` |
| `packages/app/tests/services/quality-gate.test.ts:606` |
| `packages/app/tests/services/quality-gate.test.ts:7` |
| `packages/app/tests/services/quality-gate.test.ts:70` |
| `packages/app/tests/services/quality-gate.test.ts:75` |
| `packages/app/tests/services/quality-gate.test.ts:87` |
| `packages/app/tests/services/quality-gate.test.ts:9` |
| `packages/app/tests/workflow/actions/command-gate.test.ts:367` |
| `packages/app/tests/workflow/actions/command-gate.test.ts:371` |
| `plugins/sp/skills/spur-check/SKILL.md:108` |
| `plugins/sp/skills/spur-check/SKILL.md:61` |
| `plugins/sp/skills/spur-check/SKILL.md:79` |
| `plugins/sp/skills/spur-cli/references/tasks.md:63` |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md:468` |
| `packages/app/tests/fixtures/1234/gate-builtins-fixture.yaml:1` |
| `packages/app/tests/services/quality-gate-tree-receipt.test.ts:1` |
| `packages/app/tests/workflow/gate-builtins-fixture.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The tracked fixture `packages/app/tests/fixtures/1234/gate-builtins-fixture.yaml` expresses the deterministic steps — `spur task gate`, `spur workflow commit-guard`, `spur task update`, and a project action through `spur self exec` — as `command.gate` actions with no shell action, and `packages/app/tests/workflow/gate-builtins-fixture.test.ts:1` asserts the shape plus every route. Shipped workflows still run the gate and commit-guard hops from shell steps; migrating `config/workflows/task-pipeline.yaml` is task 1239, which is why this task's R1 is proven on the fixture |
| R2 | MET | The receipt identity is the tree the gate computes itself: `captureGateGitTree` (`packages/app/src/services/quality-gate.ts:802`) does `git read-tree HEAD`, `git add -A` excluding `docs/tasks*`/`docs/features*`, `git write-tree` on a throwaway index, and fails closed outside a repo. `readReceiptStatus` (`:348`) reuses only PASS + full + same tree + same WBS, and `resolveReceiptReuse` (`:394`) names the refusal reason. `QualityGateEnv` no longer carries `proofDigest` and `spur task gate --proof-digest` is rejected as an unknown option (`apps/cli/tests/commands/task/gate.test.ts:59`). Demonstrated on this repo: the gate receipt carries `inputDigest 7d30590ce3f91bf061b5a351c690c8edce071d8e` and `spur task gate 1234 status` answers `check.reused — full-tier receipt reused for git tree 7d30590…` |
| R3 | MET | `commandGateOutcome()` (`packages/app/src/workflow/actions/command-gate.ts:22`) maps exit 0 → PASS, 1 → FAIL, anything else (usage error, signal, timeout) → BLOCKED, writes the token to `resultFile` and returns `{status, exitCode, attempts, stdout, stderr, resultFile}` in `data`, persisted in `action_runs.result_json`; `packages/app/tests/workflow/gate-builtins-fixture.test.ts` asserts the PASS, BLOCKED and FAIL routes with their action rows |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R4 — Deterministic steps run as typed engine builtins (req: R1, R3) | MET | command | `packages/app/tests/workflow/gate-builtins-fixture.test.ts` drives the fixture through the real engine: all-green → PASS in every `resultFile` and action row; unbound project action (exit 2) → BLOCKED and soft-routed; corpus transition refused by the lifecycle graph (exit 1) → FAIL. Ran with the other touched suites inside the app workspace → 57 pass, 0 fail |
| AC2 — R11 — A passing gate receipt is reused while the tree hash is unchanged (req: R2) | MET | command | `spur task gate 1234 status` after the PASS gate answered `{"reuse":true,"reason":"ok"}` at tree `7d30590ce3f91bf061b5a351c690c8edce071d8e`; `packages/app/tests/services/quality-gate-tree-receipt.test.ts` covers the unchanged-tree reuse, the corpus-only edit that keeps it reusable, the code edit that invalidates it, the foreign-WBS receipt and the capture-failure refusal. `spur task gate 1234 run` → `quality gate PASS` (log `.spur/run/1234-test-gate.log`) |
| AC3 — R16 — Foundation tasks depend on the A92 action map | MET | command | `spur task show 1234 --json` reports `.frontmatter.dependencies = [1231, 1224, 1222, 1223]` (the A92 resolver 1222, `spur self exec` 1223, gate routing 1224), and `spur task show 1222 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T18:02:37.587Z todo → wip (system)
- 2026-10-17T18:02:38.207Z wip → testing (system)
- 2026-10-17T18:02:39.333Z testing → done (system)

