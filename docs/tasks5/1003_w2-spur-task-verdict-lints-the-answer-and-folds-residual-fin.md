---
schema_version: 1
name: W2 spur task verdict lints the answer and folds residual findings
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.418Z
updated_at: "2026-09-29T20:05:47.485Z"
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
| R1 | MET | Pure port: `lintVerifyAnswer(answerText, taskContent)` at packages/app/src/services/verify-answer-lint.ts:42 with `ANSWER_LINT_MAX_FINDINGS = 10` (:27) and cap enforced at :49; exported from barrel packages/app/src/index.ts:727-728; command: `bun test tests/services/verify-answer-lint.test.ts tests/services/residual-scan.test.ts` (in packages/app) → 60 pass / 0 fail (47 lint tests incl. ported behavior classes at :247-542) |
| R2 | MET | Lint runs before `deriveVerdict` in the verdict action at apps/cli/src/commands/task.ts:1284-1312 — on findings: `--json` emits `{wbs, lintFindings}`, non-JSON prints the capped stderr list (per-finding lines, `+` when length ≥ ANSWER_LINT_MAX_FINDINGS), `setExitCode(1)`, return before any verdict write; no new flag; command: `bun test apps/cli/tests/commands/task.test.ts` → 195 pass / 0 fail incl. `verdict lints the answer before deriving (1003 R2)` (:2457-2474: exit 1, lintFindings non-empty, no verdict artifact) |
| R3 | MET | `rg 'verify-answer-lint\.ts' plugins/sp config` → empty (0 matches); `test ! -e plugins/sp/scripts/verify-answer-lint.ts` → absent; no manifest row (config/plugin-scripts.json grep: only residual-scan.ts at :84-86) and no baseline entry (config/script-placement-baseline.json grep: only residual-scan.ts migration row at :21-23); task-pipeline.yaml has 0 `verify-answer-lint` hits — verify stage now gates via `task verdict` at config/workflows/task-pipeline.yaml:691-695 |
| R4 | MET | packages/app/tests/services/verify-answer-lint.test.ts = 47 tests (ported behavior classes block :247-542), packages/app/tests/services/residual-scan.test.ts = 13 tests → 60 pass / 0 fail; CLI verdict exit-path cases at apps/cli/tests/commands/task.test.ts:2457-2474 (malformed) and :2478 (absent file); plugins/sp/tests/dispatch-handoff-contract.test.ts rewired to call only `task verdict` (:130-141) with lintFindings assertions (:155, :161, :168); lint branch dropped in plugins/sp/tests/inline-pipeline-driver.test.ts:243-244; old plugin test plugins/sp/tests/verify-answer-lint.test.ts deleted (git status: D) |
| R5 | MET | All 11 named pure functions in packages/app/src/services/residual-scan.ts (makeItemId:75, normalizeAnchor:82, locationOf:87, parseReviewFindings:100, parseDiffMarkers:160, findUncheckedBoxes:171, classify:185, scanResiduals:218, blockingAnchors:266, foldVerdict:287, renderReport:318) with types ResidualItem/ResidualCategory/Deferral; bundle rows in scripts/commands/bundle-plugin-lib.ts:147-159; generated twins exist and are in sync — plugins/sp/lib/residual-scan.generated.mjs exports exactly the 11 functions + ALLOW_PRAGMA, .generated.d.mts declares the matching surface; glue plugins/sp/scripts/residual-scan.ts imports the bundle (:14-15) and is 246 LOC ≤ 250; four modes/usage intact; residual-scan tests pass (13/13) |
| R6 | MET | All lint prose spots now name `spur task verdict` as owner: plugins/sp/skills/code-verification/references/verdict-schema.md:122, plugins/sp/skills/spur-dev/references/ac-style-guide.md:128 and :144, plugins/sp/skills/spur-dev/references/done-housekeeping.md:131, plugins/sp/skills/spur-dev/references/execution-batch.md:295, plus plugins/sp/skills/code-verification/SKILL.md:341 (`spur task verdict --from-answer` lints then derives); residual consumers unchanged and intact: plugins/sp/commands/dev-verify.md (3 refs), dev-verifyall.md (2 refs), pipeline record/settle/report shell glue at config/workflows/task-pipeline.yaml:778, 804, 851 |
| R7 | MET | config/script-placement-baseline.json drops both verify-answer-lint entries (grep: only residual-scan.ts migration row :21-23); command: `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` → "All 1 rule passed — no violations found." |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `bun test apps/cli/tests/commands/task.test.ts` → 195 pass / 0 fail incl. the lint-reject path (:2457-2474: exit 1 + lintFindings + no verdict artifact); R2+R3+R5 land as one consistent working-tree unit with no staging and no commits (git status clean of staged entries); residual tests pass against the slimmed script + `.mjs` twin (13/13) |
| AC2 | MET | command | `test ! -e plugins/sp/scripts/verify-answer-lint.ts` → absent; `wc -l plugins/sp/scripts/residual-scan.ts` → 246 ≤ 250; duplicated 549-LOC plugin lint deleted (git status D for script + old test); `rg 'verify-answer-lint\.ts' plugins/sp config` → empty |
| AC3 | MET | command | `rg 'verify-answer-lint\.ts' plugins/sp config` → empty (0 hits across all skills/config); 5/5 prose spots grep-verified naming `spur task verdict` (verdict-schema.md:122, ac-style-guide.md:128+144, done-housekeeping.md:131, execution-batch.md:295); `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` → no violations |
| AC-1 | MET | command | Same evidence as AC1: CLI lint-reject test passes (195/0), residual tests pass (13/13), tree consistency verified via git status (no staging, no commits) |
| AC-2 | MET | command | Same evidence as AC2: script absent, `wc -l` → 246 ≤ 250, AC3 rg sweep empty |
| AC-3 | MET | command | Same evidence as AC3: 5/5 prose spots name `spur task verdict`, rg sweep empty, placement rule passes |
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

