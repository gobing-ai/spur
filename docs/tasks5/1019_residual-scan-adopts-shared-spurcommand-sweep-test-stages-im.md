---
schema_version: 1
name: residual-scan adopts shared spurCommand; sweep test stages imports robustly
status: done
template: feature-impl
created_at: 2026-09-30T13:49:00.756Z
updated_at: "2026-10-01T06:59:02.651Z"
feature_id: A9

ac_altitude: task-local
---

## 1019. residual-scan adopts shared spurCommand; sweep test stages imports robustly

### Background

Found while re-verifying A9 tasks 1000–1007 (session review triage, 2026-09-30). Task 1007 R9 moved `spurCommand` into `plugins/sp/lib/spur-bin.ts:17` so every surviving plugin script imports one copy. Two scripts still split `spurBin` inline: `plugins/sp/scripts/residual-scan.ts:37-41` and `plugins/sp/scripts/workflow-step-profile.ts:68-70` (the latter already imports `defaultSpurBin` from the same lib).

`wrapup-drift-probe.ts` was switched to `spurCommand` during triage and is excluded here. The same switch was tried on `residual-scan.ts` and reverted: `plugins/sp/tests/task-pipeline-resilience.test.ts:361-369` stages the script into a temp tree by copying a hand-written file list (`residual-scan.ts`, `lib/env.ts`, `lib/residual-scan.generated.mjs`), so a new relative import fails the 0983 sweep test at `:392` with exit 1. The record `fold` command runs `bun <dir>/residual-scan.ts` in `source-repo` mode (`config/workflows/task-pipeline.yaml:760`), so the staged tree must hold the `.ts` and everything it imports.

`plugins/sp/scripts/inline-run-setup.ts:49` also splits on whitespace, but to find the main-module token, not to build a command; it is at the 250-line budget and is left alone. `residual-scan.ts` is at 246 lines.

### Requirements

- [x] R1. `plugins/sp/scripts/residual-scan.ts` and `plugins/sp/scripts/workflow-step-profile.ts` build the spur command through `spurCommand` from `plugins/sp/lib/spur-bin.ts`; neither keeps an inline whitespace split of `spurBin`. Behaviour is unchanged (`--spur-bin` flag > `env.spurBin` > `spur` for residual-scan).
- [x] R2. The 0983 sweep test stages `plugins/sp/lib/` as a whole directory instead of a per-file list, so a new relative lib import in `residual-scan.ts` does not break it.
- [x] R3. The `.mjs` twins of both scripts are regenerated and `bun run plugin-smoke` passes.

Out of scope: `inline-run-setup.ts:49` (different purpose, at budget); `feature-verification-steps-mode.test.ts` staging; any change to `spurCommand` itself or to `task-pipeline.yaml`; budget exemptions.

### Acceptance Criteria

- [x] AC1 — Sweep test passes with residual-scan importing spur-bin (req: R1, R2)
  Layer: `plugins/sp/tests/task-pipeline-resilience.test.ts` (0983 test, from `:349`), which runs the real record `fold` shell command against the staged tree. Command: `(cd plugins/sp && bun test tests/task-pipeline-resilience.test.ts)` exits 0 while `residual-scan.ts` imports `../lib/spur-bin`.
- [x] AC2 — No inline spurBin split remains in the two scripts (req: R1)
  Command: `rg -n "split\(/\\s\+/\)" plugins/sp/scripts --glob '*.ts'` prints only `plugins/sp/scripts/inline-run-setup.ts:49`.
- [x] AC3 — Existing behaviour of both scripts holds (req: R1)
  Layer: `(cd plugins/sp && bun test tests/workflow-step-profile.test.ts tests/residual-scan.test.ts)` exits 0 with no test edits.
- [x] AC4 — Twins, smoke and placement pass (req: R3)
  Commands: `bun run plugin-smoke` exits 0; `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` exits 0; `wc -l plugins/sp/scripts/residual-scan.ts` is at most 250.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T13:55:19.604Z

- **Stage the `.mjs` twin or copy the lib directory?** Copy `plugins/sp/lib/` with `cpSync(..., { recursive: true })` (closed). The fold command picks `residual-scan.ts` + `bun` in `source-repo` mode, which is the mode the test stages; switching the test to `installed` mode would stop covering the in-repo path.
- **Is `workflow-step-profile.ts` in scope?** Yes (closed). It is the only other inline `spurBin` command split, already imports from `../lib/spur-bin`, and its test runs the script in place, so no staging changes are needed.
- **`spurCommand(undefined)` vs the current default?** Equivalent (closed): both fall back to `spur`. Pass `spurBinFlag ?? env.spurBin`.

### Design

**What / where.**

- `plugins/sp/tests/task-pipeline-resilience.test.ts:361-369`: keep the `residual-scan.ts` copy; replace the two lib `copyFileSync` calls with `cpSync(join(import.meta.dir, '..', 'lib'), join(dir, 'plugins', 'sp', 'lib'), { recursive: true })` and update the comment above it. Import `cpSync` from `node:fs`.
- `plugins/sp/scripts/residual-scan.ts:36-42`: `const { cmd, prefix } = spurCommand(spurBinFlag ?? env.spurBin); return run(cmd, [...prefix, ...args], cwd);` with `import { spurCommand } from '../lib/spur-bin';`.
- `plugins/sp/scripts/workflow-step-profile.ts:68-70`: `const { cmd, prefix } = spurCommand(spurBin); const cmdArgs = [...prefix, ...args];`, extending the existing `../lib/spur-bin` import.
- Twins: `superskill script convert sp residual-scan.ts` and `superskill script convert sp workflow-step-profile.ts`.

**Why.** One copy of the split (1007 R9); the test change makes the staging robust to the next lib import.

**Frozen names.** No new API, flag or file. `spurCommand` signature unchanged.

**Do not.** Hand-edit `.mjs` twins; add a budget exemption or baseline row; touch `inline-run-setup.ts`; change the fold/settle/report shell in `task-pipeline.yaml`; weaken the `:392` assertion.

**Dependencies / concurrency.** None declared. Both scripts are net line reductions (residual-scan stays under 250).

### Plan

- [x] 1. Switch the 0983 test staging to the recursive lib copy; run `(cd plugins/sp && bun test tests/task-pipeline-resilience.test.ts)` — still green (R2).
- [x] 2. Switch `residual-scan.ts` to `spurCommand`; rerun the resilience test and `tests/residual-scan.test.ts` (R1).
- [x] 3. Switch `workflow-step-profile.ts` to `spurCommand`; run `tests/workflow-step-profile.test.ts` (R1).
- [x] 4. Regenerate both twins with `superskill script convert sp <script>.ts` (R3).
- [x] 5. Verify: the AC2 `rg`, `bun run plugin-smoke`, the `sp-script-placement` rule, `bun run spur-check`.

### Solution

Change map (commit baf51b8ed, 5 files, +25/−22):

- `plugins/sp/scripts/residual-scan.ts:19` imports `spurCommand` from `../lib/spur-bin`; `plugins/sp/scripts/residual-scan.ts:38` builds the command as `spurCommand(spurBinFlag ?? env.spurBin)` instead of the inline `spurBin.split(/\s+/)` + first-token `cmd` / remainder `prefix` construction. Behavior unchanged: `--spur-bin` flag > `env.spurBin` > `spur` (R1).
- `plugins/sp/scripts/workflow-step-profile.ts:17` extends the existing `../lib/spur-bin` import to `{ defaultSpurBin, spurCommand }`; `plugins/sp/scripts/workflow-step-profile.ts:68` builds `spurCommand(spurBin)` in `runSpurJson` instead of the inline whitespace split (R1).
- `plugins/sp/tests/task-pipeline-resilience.test.ts:366` — the 0983 sweep test stages `plugins/sp/lib/` as a whole directory via `cpSync(..., { recursive: true })` (imported from `node:fs`), replacing the per-file `copyFileSync` list, so a new relative lib import in `residual-scan.ts` cannot break the staged fold run (R2).
- `plugins/sp/scripts/residual-scan.mjs` and `plugins/sp/scripts/workflow-step-profile.mjs` regenerated via `superskill script convert sp <script>.ts`; both twins now inline `spurCommand` and remain self-contained node-builtin-only (R3).

Why: one copy of the command split, completing 1007 R9; the whole-lib staging makes the sweep test robust to future lib imports. No changes to `spurCommand` itself, `task-pipeline.yaml`, or `inline-run-setup.ts` (out of scope per task).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/residual-scan.ts:19`; `plugins/sp/scripts/residual-scan.ts:38`; `plugins/sp/scripts/workflow-step-profile.ts:17`; `plugins/sp/scripts/workflow-step-profile.ts:68`; `plugins/sp/lib/spur-bin.ts:17` — reviewed implementation of R1. `plugins/sp/scripts/residual-scan.ts` and `plugins/sp/scripts/workflow-step-profile.ts` build the spur command through `spurCommand` from `plugins/sp/lib/spur-bin.ts`; neither keeps an inline whitespace split of `spurBin`. Behaviour is unchanged (`--spur-bin` flag > `env.spurBin` > `spur` for residual-scan).. Fresh evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
| R2 | MET | `plugins/sp/tests/task-pipeline-resilience.test.ts:356` — reviewed implementation of R2. The 0983 sweep test stages `plugins/sp/lib/` as a whole directory instead of a per-file list, so a new relative lib import in `residual-scan.ts` does not break it.. Fresh evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
| R3 | MET | — reviewed implementation of R3. The `.mjs` twins of both scripts are regenerated and `bun run plugin-smoke` passes.. Fresh evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | — source/contract review of AC1. Fresh executable evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
| AC2 | MET | test | `plugins/sp/scripts/inline-run-setup.ts:49` — source/contract review of AC2. Fresh executable evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
| AC3 | MET | test | — source/contract review of AC3. Fresh executable evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
| AC4 | MET | test | — source/contract review of AC4. Fresh executable evidence: plugin workspace tests: 341 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/plugin-tests.json; output .spur/run/A9-reverify/plugin-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-verification 2026-09-30: requirement and AC traceability, correctness, security, efficiency, usability, maintainability, architecture, Design and scope checked against current task-owned code and executable tests.

No new implementation defect found.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | SECUA and architecture | task-owned implementation | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-30T13:55:21.557Z backlog → todo (system)
- 2026-09-30T22:43:34.552Z todo → wip (system)
- 2026-09-30T23:06:29.730Z wip → testing (system)
- 2026-09-30T23:16:47.665Z testing → done (system)

