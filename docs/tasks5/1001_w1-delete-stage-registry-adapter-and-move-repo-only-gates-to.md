---
schema_version: 1
name: W1 delete stage-registry-adapter and move repo-only gates to scripts/commands
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.417Z
updated_at: "2026-10-01T00:39:43.747Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1000"]
estimate_hours: 4
---

## 1001. W1 delete stage-registry-adapter and move repo-only gates to scripts/commands

### Background

Wave W1. stage-registry-adapter.ts (1533 LOC) has no runtime consumer — only its own tests, README row and a doc comment. Five repo-only gates ship inside the plugin although only the monorepo runs them (the sixth, script-contract-check, moves in 1000).

Implements: R6 — Refactor lands in independently revertible waves; R7 — Duplicated and overengineered scripts are deleted; R8 — sp skills, commands and workflows track every CLI move

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "remove .mjs twins" → none of the six scripts has a twin; all are `repoOnly` rows in `config/plugin-scripts.json` → resolution: remove the manifest rows only.
- "adapter has only 4 test consumers" → `plugins/sp/tests/roles.test.ts:17` also imports `REGISTERED_STAGES`/`STAGE_FLOOR_TIER` (describe "R8: stage-registry-adapter floors", lines 294–310) → resolution: delete that describe block and the import; the rest of roles.test stays.
- "add spur-dev dispatch rows" → repo gates are invoked as `bun scripts/commands/<x>.ts` from `package.json` (e.g. `dependency-drift-check`), not via `scripts/spur-dev.ts` → resolution: follow the package.json pattern; no dispatcher rows.
- "moved gates are self-contained" → `surface-drift-inventory.ts:42` imports `../tests/helpers/cli-surface` and anchors `REPO_ROOT` three levels up; `validate-flag-contracts.ts:737–738` anchors `MODULE_ROOT` three levels up → resolution: repoint both anchors (two levels from `scripts/commands`) and import the helper from `../../plugins/sp/tests/helpers/cli-surface`.

### Requirements

- [x] R1. Delete `plugins/sp/scripts/stage-registry-adapter.ts`, its `config/plugin-scripts.json` row, its `plugins/sp/README.md` row, and the tests `stage-registry-adapter.test.ts`, `stage-registry-parity.test.ts`, `routing-checkpoint.test.ts`, `routing-table-parity.test.ts`; remove the adapter import and the "R8: stage-registry-adapter floors" block from `roles.test.ts`; reword the comment at `packages/app/src/workflow/checkpoint-contract.ts:14` so it names no deleted file.
- [x] R2. Move `surface-drift-inventory`, `validate-flag-contracts`, `validate-commands`, `inline-pipeline-parity-check` and `transition-shim-check` (each `.ts`) into `scripts/commands/` with `git mv`, preserving exports and behavior.
- [x] R3. Move each moved gate's dedicated test (`surface-drift-inventory`, `inline-pipeline-parity-check`, `transition-shim-check`, `flag-contract-parity`, `inline-execution-contract`, `command-contract`) to `scripts/commands/<name>.test.ts` and fix their import paths; tests keep passing unchanged in assertions.
- [x] R4. Repoint `package.json` script entries (`transition-shim-check`, `inline-pipeline-parity-check`, `validate-commands`) to `scripts/commands/`; the `spur-check-feature`, `spur-check:full` and `spur-check-new:full` chains keep the same members and order.
- [x] R5. Remove the five gates' rows from `config/plugin-scripts.json`, run `bun run --filter @gobing-ai/spur build:bundle` so `apps/cli/plugins/sp/scripts/` no longer carries them, and update `scripts/commands/bundle-plugins.test.ts:90` to a path that still exists.
- [x] R6. Update every prose reference to a moved or deleted path: `plugins/sp/README.md` (rows at ~272/402/405/514/517), `plugins/sp/skills/spur-dev/references/cross-cutting.md:25`, `flag-glossary.md:46`, `inline-pipeline-driver.md`, `gate-checklists.md`, `config/workflow-candidates.json:87`, and `feature-verification-scope.test.ts:26,28`.
- [x] R7. Delete the six moved/deleted paths' entries from `config/script-placement-baseline.json` (seeded by 1000); `spur rule run --rule sp-script-placement` passes.

### Acceptance Criteria

- [x] AC1 — Refactor lands in independently revertible waves (req: R2, R3, R4, R5)
- [x] AC2 — Duplicated and overengineered scripts are deleted (req: R1, R7)
- [x] AC3 — sp skills, commands and workflows track every CLI move (req: R6)

Task-local observability: AC1 by `bun run spur-check` + `bun run spur-check-feature` green with the gates at their new paths and `git revert` of the single task commit restoring the old layout; AC2 by `test ! -e plugins/sp/scripts/stage-registry-adapter.ts` and `rg -l stage-registry-adapter plugins packages apps/cli/src config` returning nothing; AC3 by `rg 'plugins/sp/scripts/(surface-drift-inventory|validate-flag-contracts|validate-commands|inline-pipeline-parity-check|transition-shim-check|stage-registry-adapter)' --glob '!docs/**' --glob '!apps/cli/plugins/**'` returning nothing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T06:37:11.821Z

- **Q: Keep any adapter assertion by moving it to a live module?** A: No. Every adapter assertion tests the adapter itself (TABLE_A/TABLE_B mirror of `routing-table.md`, stage floors). `routing-table.md` remains the agent-facing SSOT; its mirror dies with the adapter. Closed.
- **Q: Leave the contract tests (command-contract, flag-contract-parity, inline-execution-contract) in `plugins/sp/tests` importing across trees?** A: No — move them next to the module they exercise (`scripts/commands`), so `plugins/sp/tests` never imports from `scripts/`. `command-flag-parity` and `skill-structure` do not import the gates and stay. Closed.
- **Q: Register gates in `scripts/spur-dev.ts`?** A: No; package.json pattern (see corrections). Closed.
- **Q: Historical docs (`docs/tasks*`, `docs/plans`, reports) mention old paths — rewrite?** A: No. Only live references (plugin, config, package.json, tests, AGENTS/README) change. Closed.

### Design

**What.** Pure relocation + dead-code deletion. No behavior, flag or output change in any moved gate.

**Frozen names.** Destinations: `scripts/commands/{surface-drift-inventory,validate-flag-contracts,validate-commands,inline-pipeline-parity-check,transition-shim-check}.ts` and their `.test.ts` siblings (test basenames: `surface-drift-inventory`, `inline-pipeline-parity-check`, `transition-shim-check`, `flag-contract-parity`, `inline-execution-contract`, `command-contract`). `package.json` script names unchanged. Path anchors: `REPO_ROOT = resolve(import.meta.dir, '..', '..')` in surface-drift-inventory; `MODULE_ROOT = join(SCRIPT_DIR, '..', '..')` in validate-flag-contracts. `validate-commands` keeps `validate(root = process.cwd())`.

**Why.** ADR-130: repo-only gates belong to the self-dev surface; the plugin ships only what installed projects run. The adapter is a 1.5k-LOC mirror of `routing-table.md` with no runtime reader.

**Where.** Files listed in R1–R7; generated `apps/cli/plugins/sp/**` changes only via `build:bundle`.

**Anti-patterns.** No shim left at the old plugin path. No new exports, no refactor of gate internals, no dispatcher rows. Do not hand-edit `apps/cli/plugins/`. Do not touch `batch-preflight.ts` (TABLE A there is live).

**Handoff.** 1002 deletes `task-size-precheck.ts`; `surface-drift-inventory.ts` (~lines 532–562) names that path — the later C1 task edits it at its new `scripts/commands/` location and is sequenced after this one.

### Plan

1. `rg -n stage-registry-adapter plugins packages apps/cli/src config scripts` — confirm consumer list matches R1; delete adapter, 4 tests, roles.test block, manifest + README rows; reword checkpoint-contract comment.
2. `git mv` the five gates and six tests into `scripts/commands/`; fix relative imports and the two root anchors.
3. Repoint `package.json` entries; remove manifest rows; update `bundle-plugins.test.ts:90`; run `build:bundle`.
4. Update prose refs listed in R6; delete baseline entries (R7).
5. Focused tests: `bun test scripts/commands/{surface-drift-inventory,inline-pipeline-parity-check,transition-shim-check,flag-contract-parity,inline-execution-contract,command-contract}.test.ts` and `(cd plugins/sp && bun test tests/roles.test.ts)`.
6. Gates: `bun run spur-check`, `bun run spur-check-feature`, `bun run plugin-smoke`, `spur rule run --rule sp-script-placement`, AC3 `rg` sweep.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/checkpoint-contract.ts:0` |
| `packages/app/src/workflow/checkpoint-contract.ts:14` |
| `plugins/sp/tests/roles.test.ts:0` |
| `plugins/sp/tests/roles.test.ts:16` |
| `plugins/sp/tests/roles.test.ts:292` |
| `plugins/sp/tests/task-size-precheck.test.ts:94` |
| `scripts/commands/bundle-plugins.test.ts:90` |
| `scripts/commands/command-contract.test.ts:14` |
| `scripts/commands/command-contract.test.ts:16` |
| `scripts/commands/flag-contract-parity.test.ts:18` |
| `scripts/commands/flag-contract-parity.test.ts:33` |
| `scripts/commands/inline-execution-contract.test.ts:139` |
| `scripts/commands/inline-execution-contract.test.ts:4` |
| `scripts/commands/inline-execution-contract.test.ts:6` |
| `scripts/commands/inline-pipeline-parity-check.test.ts:5` |
| `scripts/commands/inline-pipeline-parity-check.ts:24` |
| `scripts/commands/surface-drift-inventory.test.ts:48` |
| `scripts/commands/surface-drift-inventory.ts:26` |
| `scripts/commands/surface-drift-inventory.ts:42` |
| `scripts/commands/surface-drift-inventory.ts:44` |
| `scripts/commands/surface-drift-inventory.ts:743` |
| `scripts/commands/surface-drift-inventory.ts:875` |
| `scripts/commands/transition-shim-check.test.ts:6` |
| `scripts/commands/transition-shim-check.ts:118` |
| `scripts/commands/transition-shim-check.ts:31` |
| `scripts/commands/validate-commands.ts:612` |
| `scripts/commands/validate-flag-contracts.ts:738` |
| `scripts/commands/validate-flag-contracts.ts:811` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `test ! -e plugins/sp/scripts/stage-registry-adapter.ts` and the four adapter tests absent; `rg -l stage-registry-adapter plugins packages apps/cli/src config scripts` -> empty; `packages/app/src/workflow/checkpoint-contract.ts:14` names no deleted file |
| R2 | MET | five gates present under scripts/commands; `scripts/commands/surface-drift-inventory.ts:34` REPO_ROOT two levels up; `scripts/commands/validate-flag-contracts.ts:738` MODULE_ROOT; `bun run validate-commands`, `bun run transition-shim-check`, `bun run inline-pipeline-parity-check` -> exit 0 |
| R3 | MET | `bun test scripts/commands/{surface-drift-inventory,inline-pipeline-parity-check,transition-shim-check,flag-contract-parity,inline-execution-contract,command-contract,bundle-plugins}.test.ts` -> 220 pass / 0 fail across 7 files |
| R4 | MET | `package.json:93` transition-shim-check, `package.json:95` inline-pipeline-parity-check, `package.json:97` validate-commands all run scripts/commands paths; `package.json:84` spur-check-feature chain keeps the same members |
| R5 | MET | `rg -c` of the five gate names in config/plugin-scripts.json -> 0; apps/cli/plugins/sp/scripts carries none of them; bundle-plugins test passes in the 220-test run |
| R6 | MET | `rg -l 'plugins/sp/scripts/(surface-drift-inventory |
| R7 | MET | `rg -c` of moved/deleted names in config/script-placement-baseline.json -> 0; `spur rule run --rule sp-script-placement` -> All 1 rule passed, exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Refactor lands in independently revertible waves | MET | command | single commit f701d3559 (28 files) carries the wave; 220 pass / 0 fail on the moved gate tests; three gate scripts exit 0 at their new paths |
| Scenario: R7 — Duplicated and overengineered scripts are deleted | MET | command | `test ! -e plugins/sp/scripts/stage-registry-adapter.ts` exit 0; `rg -l stage-registry-adapter plugins packages apps/cli/src config scripts` -> empty |
| Scenario: R8 — sp skills, commands and workflows track every CLI move | MET | command | old-path `rg -l` sweep outside docs and the generated bundle -> only CHANGELOG.md |
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

- 2026-09-29T10:52:16.135Z todo → wip (system)
- 2026-09-29T12:22:00.201Z wip → testing (system)
- 2026-09-29T12:22:33.654Z testing → done (system)

