---
schema_version: 1
name: W2 spur task check --precheck replaces size and evidence precheck scripts
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.417Z
updated_at: "2026-09-29T15:24:01.222Z"
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
| R1 | MET | apps/cli/src/commands/task.ts --precheck (requires wbs, --corpus rejected exit 2); task-check.ts runs evaluateTaskSize(DEFAULT_TASK_SIZE_LIMITS) + evidence precheck; failures are error findings, exit 1; 3 CLI tests pass (194 CLI task tests green) |
| R2 | MET | packages/app/src/services/task-evidence-precheck.ts exact port: allowlist {history_tool_call.args_raw[pi]}, unknown declaration/missing DB/zero count fail closed, no-declaration passes without DB; reviewer verified regex/ordering/query line-by-line vs deleted script; live probes: task check 1002 --precheck exit 1 (fail-closed), task check 1001 --precheck exit 0 |
| R3 | MET | packages/domain/src/analytics/forensic-query.ts countToolCallArgsRaw (parameterized SQL, forensic-query.ts:1145) + index export + 31 domain tests; rg bun:sqlite outside packages/domain -> plugins/sp/scripts only daily-summary (plan-kept, out of scope) |
| R4 | MET | config/workflows/task-pipeline.yaml: both onEnter precheck scripts + maxImplementReqs/maxImplementPlanItems removed; guard $spurBin task check $wbs --precheck; precheck->failed fallback kept; guard-parity test + baseline fixture updated; build:bundle regenerated, generated copy in sync |
| R5 | MET | plugins/sp/scripts/task-size-precheck.ts + task-evidence-precheck.ts + both tests deleted; manifest rows removed; behavioral cases ported: packages/app/tests/services/task-evidence-precheck.test.ts + domain forensic-query test + 3 CLI tests (965 app workflow tests pass) |
| R6 | MET | eval-pipeline.ts GATE_FILES, guard-parity + fixture, task-pipeline-resilience.test.ts, inline-pipeline-driver.test.ts, surface-drift-inventory.ts + test, lifecycle-drift.test.ts guard assertion, gate-checklists.md both copies, plugins/sp/README.md, spur-cli tasks.md --precheck doc — all updated; 1320 plugins/sp tests pass |
| R7 | MET | config/script-placement-baseline.json: both entries removed; spur rule run --rule sp-script-placement exit 0 (reviewer re-ran) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | bun run spur-check exit 0 (9474/0, log .spur/run/1002-test-gate.log) bound to digest sha256 in .spur/run/1002-proof-digest.txt; yaml+CLI+service single-commit layout revertible |
| AC-1 | MET | command | spur-check exit 0 with --precheck guard live in task-pipeline.yaml |
| AC2 | MET | command | test ! -e plugins/sp/scripts/task-size-precheck.ts + task-evidence-precheck.ts; rg -n "bun:sqlite" plugins/sp/scripts -> only daily-summary (A9 plan marks Keep, out of 1002 scope; both target scripts gone, zero bun:sqlite from them); rg -l "bun:sqlite" packages/app packages/config apps/cli/src -> empty |
| AC-2 | MET | command | scripts absent; sp-script-placement rule exit 0; manifest + baseline rows purged |
| AC3 | MET | command | rg 'task-(size |
| AC-3 | MET | command | consumer sweep clean (execution-workflow.md stale maxImplementReqs note -> P3 carried to 1007) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T12:23:21.522Z todo → wip (system)
- 2026-09-29T15:23:59.810Z wip → testing (system)
- 2026-09-29T15:24:01.222Z testing → done (system)

