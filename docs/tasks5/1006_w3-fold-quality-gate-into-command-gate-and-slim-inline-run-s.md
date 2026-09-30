---
schema_version: 1
name: W3 fold quality-gate into command.gate and slim inline-run-setup through the lib bundle
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.420Z
updated_at: "2026-09-30T02:44:07.579Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1004"]
estimate_hours: 6
---

## 1006. W3 fold quality-gate into command.gate and slim inline-run-setup through the lib bundle

### Background

Wave W3. quality-gate (710 LOC) and inline-run-setup (813 LOC) carry app-domain logic in the plugin, far over the ADR-130 glue budget.

Implements: R6 — Refactor lands in independently revertible waves; R8 — sp skills, commands and workflows track every CLI move

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "fold retry/bounded findings into `command.gate`, then delete quality-gate" → `command.gate` (`packages/app/src/workflow/actions/command-gate.ts:20–40,137–187`) already has retry `{maxAttempts, delayMs, on[]}`, but quality-gate also owns 4 modes (run/recheck/light/status), ADR-124 `check-receipt/v1` receipts with digest reuse, coverage-shortfall scanning and light-scope planning (consumers: `task-pipeline.yaml:438–442,520–525`, `spur-check/SKILL.md:26–77`, `gate-checklists.md:92`) → resolution: no engine change and no delete; logic moves to `packages/app` behind a generated lib bundle, the script becomes ≤250 LOC glue with the same modes, env and exit codes. R7 (delete) is not claimed by this task.
- "move identity/trace logic into the bundle" → `packages/app/src/services/inline-run-setup.ts` (662 LOC) already owns create/attach/decide/persist, exported via `INLINE_RUN_EXPORTS` (`scripts/commands/bundle-plugin-lib.ts:~118–140`); the script still holds trace mode, outcome writing, run-log append and close/action status guards (`inline-run-setup.ts:227–632`) → resolution: move exactly those into the app service and add them to `INLINE_RUN_EXPORTS`; `resolveAppEntry`/`readInstalledInventory` bootstrap and argv stay in the script.

### Requirements

- [x] R1. Move quality-gate's exported logic (constants `MAX_GATE_ATTEMPTS`…`RECEIPT_SCHEMA_VERSION`, `isTransientLock`, `extractFindings`, `tailLines`, `retryMessage`, coverage parse/scan, receipt build/read/status, `lightScope`, `planLightChecks`, `runLightGate`, `runShellCommand`, `runQualityGate`, and private helpers they need) to `packages/app/src/services/quality-gate.ts`; port `plugins/sp/tests/quality-gate.test.ts` behavioral cases to `packages/app/tests/`.
- [x] R2. `bundle-plugin-lib.ts` generates `plugins/sp/lib/quality-gate.generated.{mjs,d.mts}`; `plugins/sp/scripts/quality-gate.ts` keeps `main` + `QUALITY_GATE_USAGE`, imports only the bundle / `node:*` / `../lib/env`, is ≤250 LOC, and preserves modes, env vars, stdout/stderr and exit codes; `.mjs` twin regenerated.
- [x] R3. Move inline-run-setup's trace mode, outcome writer, run-record log path/append and close/action status guards into `packages/app/src/services/inline-run-setup.ts`, exported via `INLINE_RUN_EXPORTS`; the script keeps argv parsing, `resolveAppEntry`, `readInstalledInventory` and mode dispatch, ≤250 LOC, same flags/output/exit codes; `inline-run.generated.*` and the `.mjs` twin regenerated.
- [x] R4. Existing contract tests stay green unchanged in intent: `task-pipeline-resilience` (gate shell resolution), `inline-run-installed` (facade↔twin parity, updated for new exports), `inline-run-trace`, `inline-run-close-reason`, `inline-run-setup`, `inline-pipeline-driver`, `execution-batch-contract`.
- [x] R5. Remove both scripts from `config/script-placement-baseline.json`; `spur rule run --rule sp-script-placement` passes; `task-pipeline.yaml` and `spur-check`/`spur-dev` docs need no invocation change (verified by `rg`).

### Acceptance Criteria

- [x] AC1 — Refactor lands in independently revertible waves (req: R1, R2, R3, R4)
- [x] AC2 — sp skills, commands and workflows track every CLI move (req: R5)

Task-local observability: AC1 by ported app tests, retained script tests, bare-`node` twin runs, and `wc -l` ≤250 on both scripts; AC2 by the placement rule green with no baseline rows for either script and unchanged pipeline/skill invocations passing `plugin-smoke`.

### Q&A

- **Q: Fold quality-gate into `command.gate` options?** A: No. Receipts, digest reuse, light mode and coverage scanning are task-pipeline policy, not engine semantics; putting them in the engine widens the workflow YAML contract for one caller. Relocation to `packages/app` meets the placement goal. Closed.
- **Q: Separate bundle for quality-gate or add to `INLINE_RUN_EXPORTS`?** A: Separate `quality-gate.generated.mjs`, so the gate twin loads only gate logic (same rule as 1005). Closed.
- **Q: Does any public `spur` surface change?** A: No. Closed.

#### Q&A entry — 2026-09-29T07:03:48.744Z

- **Q: The title says "fold quality-gate into command.gate" — do that?** A: No. The title is stale (no rename verb). quality-gate logic moves to `packages/app` + `quality-gate.generated.*`; `command.gate` is untouched. Requirements/Design win over the title. Closed.

### Design

**What.** Surface-neutral relocation of two over-budget scripts into `packages/app`, delivered by generated lib bundles.

**Frozen names.** `packages/app/src/services/quality-gate.ts` (function/const names unchanged from the script); bundle `plugins/sp/lib/quality-gate.generated.{mjs,d.mts}`. New `INLINE_RUN_EXPORTS` rows from `packages/app/src/services/inline-run-setup.ts`: `runInlineRunTrace`, `writeInlineRunOutcome`, `appendInlineRunLogLine`, `inlineRunRecordLogPath`, `isInlineRunCloseStatus`, `isInlineRunActionStatus`. Script names, modes, flags and env unchanged.

**Why.** ADR-130 glue budget. The engine already has generic retry; quality-gate's policy stays out of the engine.

**Where.** Above modules; `scripts/commands/bundle-plugin-lib.ts`; `plugins/sp/scripts/{quality-gate,inline-run-setup}.{ts,mjs}`; `plugins/sp/lib/*.generated.*`; tests in R1/R4; baseline.

**Anti-patterns.** No `command.gate` schema change. No CLI flag/verb. No `@gobing-ai/*` runtime import in the plugin (`sp-plugin-standalone`). No hand edits to generated files. No change to `task-pipeline.yaml` gate shells.

**Handoff.** 1007 batches per-state `inline-run-setup` trace calls; keep `runInlineRunTrace` callable per action so 1007 can loop it.

### Plan

1. quality-gate: move logic + tests to app; bundle row; slim script; `bun run build:scripts`.
2. inline-run-setup: move trace/outcome/log/status helpers to the app service; add `INLINE_RUN_EXPORTS` rows; slim script; regenerate bundle + twin; update `inline-run-installed` parity.
3. Remove baseline rows; `spur rule run --rule sp-script-placement`.
4. `bun run spur-check`, `bun run plugin-smoke`, `bun run inline-pipeline-parity-check` (path per 1001).

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:345` |
| `packages/app/src/index.ts:350` |
| `packages/app/src/index.ts:360` |
| `packages/app/src/services/inline-run-setup.ts:31` |
| `packages/app/src/services/inline-run-setup.ts:63` |
| `packages/app/src/services/inline-run-setup.ts:65` |
| `packages/app/src/services/inline-run-setup.ts:678` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:292` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:295` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:305` |
| `plugins/sp/scripts/inline-run-setup.ts:10` |
| `plugins/sp/scripts/inline-run-setup.ts:108` |
| `plugins/sp/scripts/inline-run-setup.ts:118` |
| `plugins/sp/scripts/inline-run-setup.ts:124` |
| `plugins/sp/scripts/inline-run-setup.ts:128` |
| `plugins/sp/scripts/inline-run-setup.ts:14` |
| `plugins/sp/scripts/inline-run-setup.ts:150` |
| `plugins/sp/scripts/inline-run-setup.ts:153` |
| `plugins/sp/scripts/inline-run-setup.ts:157` |
| `plugins/sp/scripts/inline-run-setup.ts:162` |
| `plugins/sp/scripts/inline-run-setup.ts:182` |
| `plugins/sp/scripts/inline-run-setup.ts:186` |
| `plugins/sp/scripts/inline-run-setup.ts:195` |
| `plugins/sp/scripts/inline-run-setup.ts:198` |
| `plugins/sp/scripts/inline-run-setup.ts:2` |
| `plugins/sp/scripts/inline-run-setup.ts:20` |
| `plugins/sp/scripts/inline-run-setup.ts:202` |
| `plugins/sp/scripts/inline-run-setup.ts:209` |
| `plugins/sp/scripts/inline-run-setup.ts:215` |
| `plugins/sp/scripts/inline-run-setup.ts:217` |
| `plugins/sp/scripts/inline-run-setup.ts:220` |
| `plugins/sp/scripts/inline-run-setup.ts:226` |
| `plugins/sp/scripts/inline-run-setup.ts:228` |
| `plugins/sp/scripts/inline-run-setup.ts:234` |
| `plugins/sp/scripts/inline-run-setup.ts:237` |
| `plugins/sp/scripts/inline-run-setup.ts:240` |
| `plugins/sp/scripts/inline-run-setup.ts:243` |
| `plugins/sp/scripts/inline-run-setup.ts:33` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:39` |
| `plugins/sp/scripts/inline-run-setup.ts:44` |
| `plugins/sp/scripts/inline-run-setup.ts:49` |
| `plugins/sp/scripts/inline-run-setup.ts:54` |
| `plugins/sp/scripts/inline-run-setup.ts:57` |
| `plugins/sp/scripts/inline-run-setup.ts:7` |
| `plugins/sp/scripts/inline-run-setup.ts:91` |
| `plugins/sp/scripts/inline-run-setup.ts:95` |
| `plugins/sp/scripts/quality-gate.ts:10` |
| `plugins/sp/scripts/quality-gate.ts:16` |
| `plugins/sp/scripts/quality-gate.ts:19` |
| `plugins/sp/scripts/quality-gate.ts:22` |
| `plugins/sp/scripts/quality-gate.ts:6` |
| `plugins/sp/tests/inline-run-close-reason.test.ts:29` |
| `plugins/sp/tests/inline-run-setup.test.ts:133` |
| `plugins/sp/tests/inline-run-setup.test.ts:146` |
| `plugins/sp/tests/inline-run-setup.test.ts:165` |
| `plugins/sp/tests/quality-gate-receipt.test.ts:17` |
| `plugins/sp/tests/quality-gate-receipt.test.ts:9` |
| `plugins/sp/tests/quality-gate.test.ts:1` |
| `plugins/sp/tests/quality-gate.test.ts:16` |
| `plugins/sp/tests/quality-gate.test.ts:21` |
| `plugins/sp/tests/quality-gate.test.ts:22` |
| `scripts/commands/bundle-plugin-lib.test.ts:123` |
| `scripts/commands/bundle-plugin-lib.test.ts:4` |
| `scripts/commands/bundle-plugin-lib.ts:17` |
| `scripts/commands/bundle-plugin-lib.ts:375` |
| `scripts/commands/bundle-plugin-lib.ts:583` |
| `scripts/commands/bundle-plugin-lib.ts:585` |
| `scripts/commands/bundle-plugin-lib.ts:591` |
| `scripts/commands/bundle-plugin-lib.ts:704` |
| `scripts/commands/script-contract-check.test.ts:586` |
| `scripts/commands/script-contract-check.test.ts:588` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Gate core moved to packages/app/src/services/quality-gate.ts (676 LOC, new): planLightChecks:372, runLightGate:434, runQualityGate:549 plus constants/helpers; behavioral suite ported to packages/app/tests/services/quality-gate.test.ts (375 LOC), green in fresh targeted run (129 pass / 0 fail across 9 suites at HEAD 1f607febe) |
| R2 | MET | wc -l plugins/sp/scripts/quality-gate.ts = 64 (budget 250); plugins/sp/lib/quality-gate.generated.mjs standalone: grep @gobing-ai = 0 matches, zero static import/require specifiers; bare-node twin fresh run: node plugins/sp/scripts/quality-gate.mjs (no args) usage exit 2; task-pipeline-resilience suite green (gate shell resolution unchanged) |
| R3 | MET | Frozen 6 exports moved app-side in packages/app/src/services/inline-run-setup.ts: writeInlineRunOutcome:707, isInlineRunCloseStatus:778, isInlineRunActionStatus:786, inlineRunRecordLogPath:813, appendInlineRunLogLine:826, runInlineRunTrace:846; script wc -l = 250 (budget 250); bare-node twin fresh runs: usage exit 2, --fingerprint with missing --task-file exit 1; inline-run-trace / inline-run-close-reason / inline-run-setup / packages/app inline-run-driver suites green |
| R4 | MET | Fresh bun test of the 7 named contract suites (task-pipeline-resilience, inline-run-installed, inline-run-trace, inline-run-close-reason, inline-run-setup, inline-pipeline-driver, dogfood-testing/execution-batch-contract) plus app suites quality-gate.test.ts and inline-run-driver.test.ts: 129 pass, 0 fail, 27.2s |
| R5 | MET | config/script-placement-baseline.json diff deletes both budget rows (grep quality-gate and inline-run-setup exit 1 = no rows); fresh `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` = All 1 rule passed, exit 0; git diff --name-only filtered for task-pipeline/config-workflows/docs/skills/AGENTS = zero invocation edits; config/workflows/task-pipeline.yaml:426,509 still shell `bun plugins/sp/scripts/quality-gate.ts` run and recheck and the file is untouched (git status empty) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | git status --porcelain + git diff --stat at HEAD 1f607febe: two file-disjoint waves (quality-gate: plugins/sp/scripts/quality-gate.ts+mjs, lib/quality-gate.generated.*, packages/app/src/services/quality-gate.ts + its test; inline-run: plugins/sp/scripts/inline-run-setup.ts+mjs, lib/inline-run.generated.*, app inline-run service + driver test); only shared file scripts/commands/bundle-plugin-lib.ts with separable hunks (review F7); both scripts wc -l 64 and 250 (budget 250) |
| AC2 | MET | command | Fresh sp-script-placement rule run exit 0 (All 1 rule passed) + git diff --name-only invocation filter exit 1 (zero edits to config/workflows/task-pipeline.yaml, spur-check/spur-dev SKILL.md files, docs, AGENTS) |
| AC-1 | MET | command | Same command evidence as AC1: file-disjoint waves in git diff --stat, both scripts wc -l within 250, 7 contract + 2 app suites green (129 pass / 0 fail) |
| AC-2 | MET | command | Same command evidence as AC2: placement rule exit 0, zero invocation-file edits in working-tree diff, config/workflows/task-pipeline.yaml and packages/app/src/workflow/actions/command-gate.ts untouched per git status (command-gate.ts tracked) |
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

- 2026-09-30T02:44:05.677Z todo → testing (system)
- 2026-09-30T02:44:07.579Z testing → done (system)

