---
schema_version: 1
name: W2 spur task verdict lints the answer and folds residual findings
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.418Z
updated_at: "2026-10-01T00:40:04.013Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1002"]
estimate_hours: 5
---

## 1003. W2 spur task verdict lints the answer and folds residual findings

### Background

Wave W2 (consent C2). verify-answer-lint (549 LOC) and residual-scan (641 LOC) are verdict-domain rules living in the plugin.

Implements: R6 — Refactor lands in independently revertible waves; R7 — Duplicated and overengineered scripts are deleted; R8 — sp skills, commands and workflows track every CLI move

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "`task verdict` folds residual findings before writing" → the residual scan+fold runs in `record` AFTER `task record` flips boxes (task 0967, `task-pipeline.yaml` ~800–836); folding at verdict time would scan pre-record state and reintroduce the 0967 defect → resolution: C2 is exercised for the answer lint only; residual fold stays in `record`.
- "delete residual-scan" → it has four modes (scan, fold, settle, report) doing git/spur IO and file-issue side effects; only its pure logic is domain → resolution: pure functions move to `packages/app` and ship through a generated lib bundle; the script slims to IO glue ≤250 LOC (keeps its `.mjs` twin, regenerated).
- "consumers: dev-verify(all), code-verification" → lint consumers are the pipeline action (`task-pipeline.yaml:711–723`), `code-verification/SKILL.md:341`, `verdict-schema.md:111,122`, `gate-checklists.md:105`, `ac-style-guide.md:128,144`, `done-housekeeping.md:131`, `execution-batch.md:295`, and tests `verify-answer-lint`, `dispatch-handoff-contract`, `inline-pipeline-driver:249–251` → resolution: all updated here.

### Requirements

- [x] R1. Port the answer lint to `packages/app/src/services/verify-answer-lint.ts` as a pure function over (answer text, task content), preserving every rule and finding cap of `plugins/sp/scripts/verify-answer-lint.ts` (row shape, evidence-row identity, declared-id sources incl. bold-trajectory, bare-ordinal AC resolution).
- [x] R2. `spur task verdict <wbs>` runs the lint before `deriveVerdict`; on findings it writes no verdict, exits 1, and reports findings (`lintFindings` in `--json`, capped list on stderr otherwise). No new flag.
- [x] R3. Remove the lint action from `task-pipeline.yaml` (verify onExit, ~711–723); the following `task verdict` action is the gate. Delete `plugins/sp/scripts/verify-answer-lint.ts`, its manifest row and baseline entry.
- [x] R4. Port `plugins/sp/tests/verify-answer-lint.test.ts` behavior cases to `packages/app/tests/services/verify-answer-lint.test.ts` plus one `apps/cli/tests` case for the verdict exit path; rewire `dispatch-handoff-contract.test.ts` to call only `task verdict`; drop the lint branch in `inline-pipeline-driver.test.ts`.
- [x] R5. Move residual-scan's pure functions (`makeItemId`, `normalizeAnchor`, `locationOf`, `parseReviewFindings`, `parseDiffMarkers`, `findUncheckedBoxes`, `classify`, `scanResiduals` core, `blockingAnchors`, `foldVerdict`, `renderReport`) to `packages/app/src/services/residual-scan.ts`; generate `plugins/sp/lib/residual-scan.generated.mjs` (+`.d.mts`) via `scripts/commands/bundle-plugin-lib.ts`; `plugins/sp/scripts/residual-scan.ts` imports the bundle and keeps only argv, git/spur spawning, file IO and the four modes, ≤250 LOC; CLI usage and outputs unchanged.
- [x] R6. Update the lint prose consumers listed in Background to name `spur task verdict` as the lint owner; residual-scan consumers (`dev-verify.md`, `dev-verifyall.md`, `code-verification/SKILL.md:264–280`, pipeline record/settle/report) keep working unchanged.
- [x] R7. `config/script-placement-baseline.json` drops both entries; `spur rule run --rule sp-script-placement` passes.

### Acceptance Criteria

- [x] AC1 — Refactor lands in independently revertible waves (req: R2, R3, R5)
- [x] AC2 — Duplicated and overengineered scripts are deleted (req: R1, R4, R7)
- [x] AC3 — sp skills, commands and workflows track every CLI move (req: R6)

Task-local observability: AC1 by an `apps/cli/tests` case (malformed answer → `task verdict --json` exit 1, `lintFindings` non-empty, no verdict file) and the existing residual-scan tests passing against the slimmed script and `.mjs` twin; AC2 by `test ! -e plugins/sp/scripts/verify-answer-lint.ts` and `wc -l plugins/sp/scripts/residual-scan.ts` ≤250; AC3 by `rg 'verify-answer-lint\.ts' plugins/sp config` returning nothing.

### Q&A

- **Q: Fold residuals inside `task verdict` as consented (C2)?** A: No — ordering defect (see corrections, task 0967). Consent is not an obligation; the operator is told C2's fold half is unexercised. Closed.
- **Q: New bundle vs widening inline-run?** A: New `residual-scan` bundle. The inline-run surface is run-identity scoped (task 0972); mixing residual logic into it couples unrelated consumers. Pattern: `idea-handoff` bundle. Closed.
- **Q: Does verdict-time lint break dev-verify host flows?** A: No. The host flow already ran lint → verdict (`code-verification/SKILL.md:341`); it now runs verdict only, with the same outcome. Closed.

#### Q&A entry — 2026-09-29T07:03:47.171Z

- **Q: The title says "folds residual findings" — is that in scope?** A: No. The title is stale (no rename verb). Scope is C2 lint-only; the residual fold stays in `record` (task 0967 ordering). Requirements/Design win over the title. Closed.

### Design

**What.** Answer lint becomes part of `spur task verdict`; residual-scan keeps its script entry but its logic moves to `packages/app`.

**Frozen names.**
- `packages/app/src/services/verify-answer-lint.ts`: `lintVerifyAnswer(answerText: string, taskContent: string): AnswerLintFinding[]`; `interface AnswerLintFinding { line: number; rule: string; message: string }`; `ANSWER_LINT_MAX_FINDINGS = 10`. Exported from `@gobing-ai/spur-app`.
- Verdict envelope field: `lintFindings: AnswerLintFinding[]` (present only on lint failure).
- `packages/app/src/services/residual-scan.ts`: exact names listed in R5; types `ResidualItem`, `ResidualCategory`, `Deferral` move with them.
- Bundle: `plugins/sp/lib/residual-scan.generated.mjs` / `.d.mts`, a new row set in `bundle-plugin-lib.ts` modelled on idea-handoff; `package.json` `build:plugin-lib` regenerates it.

**Why.** ADR-130: verdict-domain rules live behind the verb that owns the verdict; the plugin keeps IO glue only.

**Where.** `apps/cli/src/commands/task.ts` (verdict action ~1246), `packages/app/src/services/{verify-answer-lint,residual-scan}.ts`, `packages/app/src/index.ts`, `scripts/commands/bundle-plugin-lib.ts`, `plugins/sp/scripts/residual-scan.{ts,mjs}`, `config/workflows/task-pipeline.yaml`, docs/tests in R4/R6.

**Anti-patterns.** No residual fold in verdict. No new `task verdict` flag. No behavior change in residual-scan modes. Bundle must stay standalone (`sp-plugin-standalone` rule). Do not hand-edit `.generated.mjs`.

**Handoff.** 1007 counts the removed lint action toward the task-pipeline budget.

### Plan

1. Port lint + tests into `packages/app`; export from the app barrel.
2. Wire lint into `task verdict`; CLI exit-path test.
3. Remove pipeline lint action; delete script/test/manifest row/baseline entry; rewire dispatch-handoff + inline-driver tests; update prose consumers.
4. Move residual-scan pure functions to `packages/app` (tests follow); add bundle rows; slim the script; `bun run build:scripts` regenerates twin + bundle.
5. `bun run spur-check`, `bun run plugin-smoke`, `spur rule run --rule sp-script-placement`, AC3 `rg`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1256` |
| `apps/cli/src/commands/task.ts:1274` |
| `apps/cli/src/commands/task.ts:1309` |
| `apps/cli/src/commands/task.ts:1313` |
| `apps/cli/tests/commands/task.test.ts:2457` |
| `apps/cli/tests/commands/task.test.ts:3867` |
| `apps/cli/tests/commands/task.test.ts:3895` |
| `apps/cli/tests/commands/task.test.ts:3900` |
| `apps/cli/tests/commands/task.test.ts:3913` |
| `apps/cli/tests/commands/task.test.ts:3931` |
| `apps/cli/tests/commands/task.test.ts:3936` |
| `packages/app/src/index.ts:238` |
| `packages/app/src/index.ts:727` |
| `packages/app/src/services/feature-check.ts:1461` |
| `packages/app/src/services/feature-check.ts:1487` |
| `packages/app/src/services/feature-check.ts:1490` |
| `packages/app/src/services/feature-check.ts:1494` |
| `packages/app/src/services/feature-check.ts:1496` |
| `packages/app/src/services/feature-check.ts:46` |
| `plugins/sp/scripts/residual-scan.ts:0` |
| `plugins/sp/scripts/residual-scan.ts:103` |
| `plugins/sp/scripts/residual-scan.ts:119` |
| `plugins/sp/scripts/residual-scan.ts:12` |
| `plugins/sp/scripts/residual-scan.ts:121` |
| `plugins/sp/scripts/residual-scan.ts:124` |
| `plugins/sp/scripts/residual-scan.ts:127` |
| `plugins/sp/scripts/residual-scan.ts:13` |
| `plugins/sp/scripts/residual-scan.ts:130` |
| `plugins/sp/scripts/residual-scan.ts:133` |
| `plugins/sp/scripts/residual-scan.ts:136` |
| `plugins/sp/scripts/residual-scan.ts:144` |
| `plugins/sp/scripts/residual-scan.ts:146` |
| `plugins/sp/scripts/residual-scan.ts:150` |
| `plugins/sp/scripts/residual-scan.ts:153` |
| `plugins/sp/scripts/residual-scan.ts:155` |
| `plugins/sp/scripts/residual-scan.ts:157` |
| `plugins/sp/scripts/residual-scan.ts:161` |
| `plugins/sp/scripts/residual-scan.ts:165` |
| `plugins/sp/scripts/residual-scan.ts:169` |
| `plugins/sp/scripts/residual-scan.ts:173` |
| `plugins/sp/scripts/residual-scan.ts:177` |
| `plugins/sp/scripts/residual-scan.ts:18` |
| `plugins/sp/scripts/residual-scan.ts:181` |
| `plugins/sp/scripts/residual-scan.ts:187` |
| `plugins/sp/scripts/residual-scan.ts:191` |
| `plugins/sp/scripts/residual-scan.ts:20` |
| `plugins/sp/scripts/residual-scan.ts:203` |
| `plugins/sp/scripts/residual-scan.ts:207` |
| `plugins/sp/scripts/residual-scan.ts:214` |
| `plugins/sp/scripts/residual-scan.ts:216` |
| `plugins/sp/scripts/residual-scan.ts:218` |
| `plugins/sp/scripts/residual-scan.ts:223` |
| `plugins/sp/scripts/residual-scan.ts:229` |
| `plugins/sp/scripts/residual-scan.ts:23` |
| `plugins/sp/scripts/residual-scan.ts:235` |
| `plugins/sp/scripts/residual-scan.ts:237` |
| `plugins/sp/scripts/residual-scan.ts:243` |
| `plugins/sp/scripts/residual-scan.ts:246` |
| `plugins/sp/scripts/residual-scan.ts:36` |
| `plugins/sp/scripts/residual-scan.ts:43` |
| `plugins/sp/scripts/residual-scan.ts:48` |
| `plugins/sp/scripts/residual-scan.ts:49` |
| `plugins/sp/scripts/residual-scan.ts:5` |
| `plugins/sp/scripts/residual-scan.ts:57` |
| `plugins/sp/scripts/residual-scan.ts:63` |
| `plugins/sp/scripts/residual-scan.ts:65` |
| `plugins/sp/scripts/residual-scan.ts:68` |
| `plugins/sp/scripts/residual-scan.ts:76` |
| `plugins/sp/scripts/residual-scan.ts:78` |
| `plugins/sp/scripts/residual-scan.ts:81` |
| `plugins/sp/scripts/residual-scan.ts:89` |
| `plugins/sp/scripts/residual-scan.ts:94` |
| `plugins/sp/scripts/residual-scan.ts:98` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:103` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:12` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:122` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:130` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:135` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:137` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:141` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:150` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:153` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:155` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:158` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:160` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:165` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:167` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:174` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:21` |
| `plugins/sp/tests/dispatch-handoff-contract.test.ts:8` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:243` |
| `plugins/sp/tests/skill-structure.test.ts:874` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:0` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:351` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:363` |
| `scripts/commands/bundle-plugin-lib.test.ts:28` |
| `scripts/commands/bundle-plugin-lib.test.ts:4` |
| `scripts/commands/bundle-plugin-lib.ts:23` |
| `scripts/commands/bundle-plugin-lib.ts:28` |
| `scripts/commands/bundle-plugin-lib.ts:346` |
| `scripts/commands/bundle-plugin-lib.ts:72` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/verify-answer-lint.ts:42` lintVerifyAnswer; `packages/app/src/services/verify-answer-lint.ts:27` ANSWER_LINT_MAX_FINDINGS = 10; `packages/app/src/index.ts:744` barrel export |
| R2 | MET | `apps/cli/src/commands/task.ts:1284` lint runs first and returns on findings; `apps/cli/src/commands/task.ts:1303` deriveVerdict after; `apps/cli/tests/commands/task.test.ts:2490` malformed answer exits 1 with lintFindings |
| R3 | MET | `config/workflows/task-pipeline.yaml:679` task verdict is the verify gate; `rg -c verify-answer-lint config/workflows/task-pipeline.yaml config/plugin-scripts.json config/script-placement-baseline.json` -> no hits; plugin lint script absent |
| R4 | MET | `bun test tests/services/verify-answer-lint.test.ts tests/services/residual-scan.test.ts` (packages/app) -> 60 pass / 0 fail; `bun test tests/dispatch-handoff-contract.test.ts tests/inline-pipeline-driver.test.ts tests/residual-scan.test.ts` (plugins/sp) -> 35 pass / 0 fail |
| R5 | MET | `packages/app/src/services/residual-scan.ts:75` makeItemId through `packages/app/src/services/residual-scan.ts:318` renderReport; `plugins/sp/scripts/residual-scan.ts:18` imports the generated bundle; `wc -l plugins/sp/scripts/residual-scan.ts` -> 244 (re-verify 2026-09-30; 1019 trimmed it); `scripts/commands/bundle-plugin-lib.ts:286` bundle row |
| R6 | MET | `plugins/sp/skills/spur-dev/references/ac-style-guide.md:128`, `plugins/sp/skills/spur-dev/references/done-housekeeping.md:131` and `plugins/sp/skills/spur-dev/references/execution-batch.md:295` name the spur task verdict answer lint |
| R7 | MET | `spur rule run --rule sp-script-placement` -> All 1 rule passed, exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Refactor lands in independently revertible waves | MET | test | `apps/cli/tests/commands/task.test.ts:2490` lint-reject path; 196 pass / 0 fail; residual tests 35 pass against the slimmed script |
| Scenario: R7 — Duplicated and overengineered scripts are deleted | MET | command | `ls plugins/sp/scripts/verify-answer-lint.ts` -> No such file; `wc -l plugins/sp/scripts/residual-scan.ts` -> 244 (re-verify 2026-09-30; 1019 trimmed it) |
| Scenario: R8 — sp skills, commands and workflows track every CLI move | MET | command | `rg -n 'verify-answer-lint\.ts' plugins/sp config` -> empty |
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

- 2026-09-29T15:25:50.977Z todo → wip (system)
- 2026-09-29T20:05:33.290Z wip → testing (system)
- 2026-09-29T20:05:47.485Z testing → done (system)

