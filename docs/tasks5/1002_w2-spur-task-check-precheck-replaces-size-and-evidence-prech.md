---
schema_version: 1
name: W2 spur task check --precheck replaces size and evidence precheck scripts
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.417Z
updated_at: "2026-10-01T06:58:40.078Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1000", "1001"]
estimate_hours: 6
---

## 1002. W2 spur task check --precheck replaces size and evidence precheck scripts

### Background

Wave W2 (consent C1, 2026-09-28). task-size-precheck duplicates packages/app/src/services/task-size-precheck.ts; task-evidence-precheck is task-domain logic in the plugin and opens `bun:sqlite` directly.

Implements: R6 — Refactor lands in independently revertible waves; R7 — Duplicated and overengineered scripts are deleted; R8 — sp skills, commands and workflows track every CLI move

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "task-diffstat re-implements git diff --numstat" → it also classifies SENSITIVE paths feeding lane safety (ADR-125, task 0943) → resolution: task-diffstat is legitimate glue; KEPT and out of scope here.
- "precheck returns the exit contract in the JSON envelope; pipeline calls the flag once" → the guard at `task-pipeline.yaml:898–899` already runs `$spurBin task check $wbs` after reading two status files written by onEnter actions (lines 213–222) → resolution: delete both onEnter actions; the guard becomes one `task check $wbs --precheck` call; no status files are written.
- "size precheck limits are pipeline vars" → `maxImplementReqs`/`maxImplementPlanItems` (lines 167–171) are forwarded as script flags; adding `--max-*` flags would be unconsented CLI surface → resolution: drop the two vars; `--precheck` uses `DEFAULT_TASK_SIZE_LIMITS` (10/16).
- "only the pipeline consumes the status files" → also `scripts/commands/eval-pipeline.ts:412`, `packages/app/tests/workflow/guard-parity.test.ts:100–103` + `fixtures/guard-parity-baseline.json`, `plugins/sp/tests/{task-pipeline-resilience,inline-pipeline-driver}.test.ts`, `gate-checklists.md:81–82`, and `surface-drift-inventory` (~532–562, moved by 1001) → resolution: all updated in this task; dependency on 1001 added.
- "raise the plugin CLI floor" (ADR-130 consequence, plan §3) → no floor mechanism exists; releases are lockstep → resolution: rely on lockstep release + fail-closed guard + `plugin-smoke`.

### Requirements

- [x] R1. `spur task check <wbs> --precheck` runs the normal check plus the size precheck (`evaluateTaskSize` with `DEFAULT_TASK_SIZE_LIMITS`) and the evidence-channel precheck; any size or evidence failure is an error finding and the command exits 1. `--precheck` requires `<wbs>` and is rejected with `--corpus`.
- [x] R2. Port the evidence-channel rule to `packages/app/src/services/task-evidence-precheck.ts`: exact `evidence-channel:` declaration parsing, single allowlisted channel `history_tool_call.args_raw[pi]`, unknown declaration / missing DB / missing table / zero count all fail closed, no declaration passes without opening the DB.
- [x] R3. The DB count goes through a new `packages/domain` read function (domain stays the sole ts-db consumer); no `bun:sqlite` import outside `packages/domain`.
- [x] R4. `task-pipeline.yaml` precheck: remove the size and evidence onEnter actions and the `maxImplementReqs`/`maxImplementPlanItems` vars; the precheck→implement guard is `$spurBin task check $wbs --precheck`; precheck→failed stays the fallback.
- [x] R5. Delete `plugins/sp/scripts/task-size-precheck.ts`, `task-evidence-precheck.ts`, their tests and `config/plugin-scripts.json` rows; port the behavioral test cases (size limits, evidence allowlist, fail-closed cases, WBS path-safety) to `packages/app/tests/services/` and `apps/cli/tests/`.
- [x] R6. Update every status-file consumer: `eval-pipeline.ts` GATE_FILES, guard-parity test + baseline fixture, `task-pipeline-resilience.test.ts`, `inline-pipeline-driver.test.ts`, `scripts/commands/surface-drift-inventory.ts`, `lifecycle-drift.test.ts:262` comment, `gate-checklists.md:81–82`, `plugins/sp/README.md`, and the `sp:spur-cli` task reference (documents `--precheck`).
- [x] R7. Remove both scripts' entries from `config/script-placement-baseline.json`; `spur rule run --rule sp-script-placement` passes.

### Acceptance Criteria

- [x] AC1 — Refactor lands in independently revertible waves (req: R1, R4)
- [x] AC2 — Duplicated and overengineered scripts are deleted (req: R2, R3, R5, R7)
- [x] AC3 — sp skills, commands and workflows track every CLI move (req: R6)

Task-local observability: AC1 by an `apps/cli/tests` case: a task with 11 R-items → `task check <wbs> --precheck --json` exit 1 with a size finding, same task without `--precheck` exit 0; AC2 by `rg -n "bun:sqlite" plugins/sp/scripts` returning nothing and the two scripts absent; AC3 by `rg 'task-(size|evidence)-precheck|precheck-(size|evidence)\.status' plugins/sp config scripts packages apps/cli/src apps/cli/tests` returning only the new app service/test names.

### Q&A

- **Q: Keep per-task size overrides (`--vars maxImplementReqs`)?** A: No. Overrides need `--max-*` flags, which are unconsented public surface (C1 covers `--precheck` only). Defaults 10/16 apply; an oversized task is split, which is the check's purpose. Closed.
- **Q: Keep writing `.status` files for eval-pipeline and tests?** A: No. The guard reads the exit code directly; eval-pipeline drops `precheck-size.status` from GATE_FILES (its readers treat a missing file as "not reached"). Closed.
- **Q: Severity of size/evidence findings under `--precheck`?** A: `error` (they gated before). Without `--precheck` the existing `task update` size warning (`task-service.ts:1264`) is unchanged. Closed.
- **Q: Plugin CLI floor?** A: No floor mechanism exists in the repo; plugin and CLI release in lockstep (`chore(release)` bumps every package). An older CLI rejects `--precheck` as an unknown option, the guard fails, and the run routes to `failed` — fail-closed, never a silent pass. `plugin-smoke` proves the pair. Closed.

### Design

**What.** One CLI flag replaces two plugin scripts and two status files.

**Frozen names.**
- CLI: `spur task check <wbs> --precheck` (C1). Option description: "Also run the implement-readiness prechecks (size, evidence channel); failures are errors."
- `packages/app/src/services/task-evidence-precheck.ts`: `parseEvidenceChannels(content: string): string[]`, `evaluateTaskEvidence(content: string, deps: { countArgsRaw(source: string): number | null }): TaskEvidenceReport` with `interface TaskEvidenceReport { ok: boolean; reasons: string[] }` (`null` = DB/table missing → fail closed). Constant `ALLOWED_EVIDENCE_CHANNELS = ['history_tool_call.args_raw[pi]']`.
- `packages/domain`: `countToolCallArgsRaw(db, source: string): number` beside the existing `history_tool_call` readers in `packages/domain/src/analytics/`.
- `TaskCheckService` (`packages/app/src/services/task-check.ts`) gains option `precheck?: boolean`; findings use rule ids `precheck-size` and `precheck-evidence`.
- Guard: `$spurBin task check $wbs --precheck`.

**Why.** ADR-130: task-domain logic lives behind `spur task`; the guard already called `task check`, so the prechecks fold into that call and the pipeline loses two actions.

**Where.** `apps/cli/src/commands/task.ts` (check option), `packages/app/src/services/{task-check,task-evidence-precheck}.ts`, `packages/domain/src/analytics/`, `config/workflows/task-pipeline.yaml`, consumers in R6.

**Anti-patterns.** No `--max-reqs`/`--max-plan-items` flags. No status-file writes from the CLI. Do not open SQLite from `packages/app`. Do not touch task-diffstat. Do not change `task check` output when `--precheck` is absent.

**Handoff.** 1007 counts the removed actions toward the task-pipeline budget.

### Plan

1. Domain read fn + test (in-memory SQLite); app evidence service + tests ported from `task-evidence-precheck.test.ts`.
2. `TaskCheckService` `precheck` option; CLI flag + argument validation; CLI tests (size fail, evidence fail, pass, `--corpus` rejection).
3. Rewire `task-pipeline.yaml` (remove 2 actions + 2 vars, new guard); update guard-parity baseline and pipeline tests.
4. Delete the two scripts, tests, manifest rows, baseline entries; update eval-pipeline, surface-drift-inventory, gate-checklists, README, spur-cli task reference; `build:bundle`.
5. `bun run spur-check`, `bun run plugin-smoke`, `spur rule run --rule sp-script-placement`, AC3 `rg` sweep.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1392` |
| `apps/cli/src/commands/task.ts:1418` |
| `apps/cli/src/commands/task.ts:1531` |
| `apps/cli/src/commands/task.ts:46` |
| `apps/cli/tests/commands/task.test.ts:967` |
| `packages/app/src/services/planning-check-base.ts:90` |
| `packages/app/src/services/task-check.ts:31` |
| `packages/app/src/services/task-check.ts:33` |
| `packages/app/src/services/task-check.ts:523` |
| `packages/app/src/services/task-check.ts:604` |
| `packages/app/src/services/task-size-precheck.ts:100` |
| `packages/app/src/services/task-size-precheck.ts:105` |
| `packages/app/src/services/task-size-precheck.ts:38` |
| `packages/app/tests/workflow/guard-parity.test.ts:99` |
| `packages/config/src/finding-codes.ts:173` |
| `packages/config/src/finding-codes.ts:80` |
| `packages/domain/src/analytics/forensic-query.ts:1139` |
| `packages/domain/src/analytics/index.ts:56` |
| `packages/domain/tests/analytics/forensic-query.test.ts:13` |
| `packages/domain/tests/analytics/forensic-query.test.ts:911` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:0` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:146` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:149` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:154` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:157` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:262` |
| `plugins/sp/scripts/verify-answer-lint.ts:37` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:0` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:241` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:0` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:136` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:169` |
| `scripts/commands/eval-pipeline.ts:410` |
| `scripts/commands/surface-drift-inventory.test.ts:375` |
| `scripts/commands/surface-drift-inventory.test.ts:379` |
| `scripts/commands/surface-drift-inventory.test.ts:383` |
| `scripts/commands/surface-drift-inventory.test.ts:385` |
| `scripts/commands/surface-drift-inventory.test.ts:392` |
| `scripts/commands/surface-drift-inventory.test.ts:741` |
| `scripts/commands/surface-drift-inventory.test.ts:758` |
| `scripts/commands/surface-drift-inventory.ts:531` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/task.ts:1417`; `apps/cli/src/commands/task.ts:1444`; `packages/app/src/services/task-check.ts:608` — reviewed implementation of R1. `spur task check <wbs> --precheck` runs the normal check plus the size precheck (`evaluateTaskSize` with `DEFAULT_TASK_SIZE_LIMITS`) and the evidence-channel precheck; any size or evidence failure is an error finding and the command exits 1. `--precheck` requires `<wbs>` and is rejected with `--corpus`.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R2 | MET | `packages/app/src/services/task-evidence-precheck.ts:25`; `packages/app/src/services/task-evidence-precheck.ts:41` — reviewed implementation of R2. Port the evidence-channel rule to `packages/app/src/services/task-evidence-precheck.ts`: exact `evidence-channel:` declaration parsing, single allowlisted channel `history_tool_call.args_raw[pi]`, unknown declaration / missing DB / missing table / zero count all fail closed, no declaration passes without opening the DB.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R3 | MET | `packages/domain/src/analytics/forensic-query.ts:1145`; `apps/cli/src/commands/serve.ts:110` — reviewed implementation of R3. The DB count goes through a new `packages/domain` read function (domain stays the sole ts-db consumer); no `bun:sqlite` import outside `packages/domain`.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R4 | MET | `config/workflows/task-pipeline.yaml:847` — reviewed implementation of R4. `task-pipeline.yaml` precheck: remove the size and evidence onEnter actions and the `maxImplementReqs`/`maxImplementPlanItems` vars; the precheck→implement guard is `$spurBin task check $wbs --precheck`; precheck→failed stays the fallback.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R5 | MET | `apps/cli/tests/commands/task.test.ts:1000` — reviewed implementation of R5. Delete `plugins/sp/scripts/task-size-precheck.ts`, `task-evidence-precheck.ts`, their tests and `config/plugin-scripts.json` rows; port the behavioral test cases (size limits, evidence allowlist, fail-closed cases, WBS path-safety) to `packages/app/tests/services/` and `apps/cli/tests/`.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R6 | MET | `plugins/sp/skills/spur-dev/references/gate-checklists.md:76`; `plugins/sp/skills/spur-cli/references/tasks.md:54` — reviewed implementation of R6. Update every status-file consumer: `eval-pipeline.ts` GATE_FILES, guard-parity test + baseline fixture, `task-pipeline-resilience.test.ts`, `inline-pipeline-driver.test.ts`, `scripts/commands/surface-drift-inventory.ts`, `lifecycle-drift.test.ts:262` comment, `gate-checklists.md:81–82`, `plugins/sp/README.md`, and the `sp:spur-cli` task referen. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| R7 | MET | — reviewed implementation of R7. Remove both scripts' entries from `config/script-placement-baseline.json`; `spur rule run --rule sp-script-placement` passes.. Fresh evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Refactor lands in independently revertible waves | MET | test | `apps/cli/tests/commands/task.test.ts:1000` — source/contract review of Scenario: R6 — Refactor lands in independently revertible waves. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| Scenario: R7 — Duplicated and overengineered scripts are deleted | MET | test | — source/contract review of Scenario: R7 — Duplicated and overengineered scripts are deleted. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
| Scenario: R8 — sp skills, commands and workflows track every CLI move | MET | test | — source/contract review of Scenario: R8 — sp skills, commands and workflows track every CLI move. Fresh executable evidence: app workspace tests: 430 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/app-tests.json; output .spur/run/A9-reverify/app-tests.log. cli workspace tests: 198 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/cli-tests.json; output .spur/run/A9-reverify/cli-tests.log. domain workspace tests: 31 pass, 0 fail, exit 0; exact command .spur/run/A9-reverify/domain-tests.json; output .spur/run/A9-reverify/domain-tests.log. Full bun run spur-check exited 0: 9554 pass, 0 fail (.spur/run/A9-reverify/spur-check.log). Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-verification 2026-09-30: requirement and AC traceability, correctness, security, efficiency, usability, maintainability, architecture, Design and scope checked against current task-owned code and executable tests.

Source CLI golden path task check 1002 --precheck --json exited 0 (.spur/run/A9-reverify/1002-golden-precheck.json).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | SECUA and architecture | task-owned implementation | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T12:23:21.522Z todo → wip (system)
- 2026-09-29T15:23:59.810Z wip → testing (system)
- 2026-09-29T15:24:01.222Z testing → done (system)

