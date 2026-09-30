---
schema_version: 1
name: W3 fold quality-gate into command.gate and slim inline-run-setup through the lib bundle
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.420Z
updated_at: "2026-09-30T13:20:34.182Z"
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
| R1 | MET | `packages/app/src/services/quality-gate.ts:549` runQualityGate; `packages/app/src/services/quality-gate.ts:10` MAX_GATE_ATTEMPTS retry loop; quality-gate app tests in the 145 pass / 0 fail run |
| R2 | MET | `scripts/commands/bundle-plugin-lib.ts:17` quality-gate bundle; `plugins/sp/scripts/quality-gate.ts:8` imports the generated bundle; `plugins/sp/scripts/quality-gate.ts:24` QUALITY_GATE_USAGE; `wc -l` -> 64 |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:846` runInlineRunTrace; `packages/app/src/services/inline-run-setup.ts:813` inlineRunRecordLogPath; `scripts/commands/bundle-plugin-lib.ts:576` INLINE_RUN_EXPORTS; `plugins/sp/scripts/inline-run-setup.ts:45` resolveAppEntry stays in the script; `wc -l` -> 250 |
| R4 | MET | `bun test` (plugins/sp) over quality-gate, inline-run-setup, inline-run-trace, inline-run-close-reason, inline-run-installed, inline-pipeline-driver, execution-batch-contract, task-pipeline-resilience and three more -> 248 pass / 0 fail across 11 files |
| R5 | MET | `rg -n 'quality-gate\|inline-run-setup' config/script-placement-baseline.json` -> no hits; `spur rule run --rule sp-script-placement` -> All 1 rule passed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Refactor lands in independently revertible waves | MET | test | packages/app quality-gate, inline-run-setup and inline-run-driver tests (145 pass / 0 fail); plugins/sp contract tests (248 pass / 0 fail) |
| Scenario: R8 — sp skills, commands and workflows track every CLI move | MET | command | `bun run plugin-smoke` -> plugin-install-smoke PASS; placement rule passes with no baseline rows for either script |
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

