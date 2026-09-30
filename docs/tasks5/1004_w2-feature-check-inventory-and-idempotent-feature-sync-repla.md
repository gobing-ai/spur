---
schema_version: 1
name: W2 feature check --inventory and idempotent feature sync replace feature scripts
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.419Z
updated_at: "2026-09-29T21:28:36.185Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

dependencies: ["1003"]
estimate_hours: 6
---

## 1004. W2 feature check --inventory and idempotent feature sync replace feature scripts

### Background

Wave W2 (consents C3, C4). idea-coverage-check, feature-sync-bounded and record-feature-sync are feature-domain logic in the plugin.

Implements: R6 — Refactor lands in independently revertible waves; R7 — Duplicated and overengineered scripts are deleted; R8 — sp skills, commands and workflows track every CLI move

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**
- "`feature sync` writes verification steps; delete feature-verification-steps" → that script writes ADR-119 feature-verification receipts for `config/workflows/feature-verification.yaml` ("no public CLI verb", D63 task 0915) and already runs on the inline-run bundle; it is not a sync concern → resolution: KEPT (baseline exemption); C4 narrowed to the no-op behavior.
- "`feature sync` no-op when linked task states are unchanged" → feature-sync-bounded suppresses only a repeated BLOCKED outcome, keyed by a fingerprint over feature file content, linked-task statuses and verdict-artifact mtimes, persisted at `.spur/run/feature-sync-blocked-<id>.json` → resolution: move exactly that policy into `FeatureService.syncFeature` (`packages/app/src/services/feature-service.ts:535`); `--force` bypasses.
- "idea-coverage-check reads an AC file" → it reads `.spur/run/<run>-idea-ac-content.md`, but the same AC (with `# covers:` lines) is already written into the feature before the `idea-ac-check` command.gate (`idea-pipeline.yaml:~240–252`) → resolution: `feature check <id> --inventory <report>` reads AC from the feature; the gate gains the flag and the coverage action + status file disappear.
- "consumers" → also `wrapup-steps.ts:490–498` (+`.mjs`), `execution-batch.md:343,364,1159`, `wrapup-pipeline.yaml:348`, `task-pipeline.yaml:743,787–799`, `lifecycle-drift.test.ts:171,198–205`, `task-pipeline-resilience.test.ts:498–544`, `idea-pipeline-definition.test.ts:636`, `surface-drift-inventory` (566–605, 786–790), `package.json:61` build:scripts, `README.md:513`, `ac-style-guide.md:225`, `idea-evaluation.md:36,86`, `no-syscall-emulation-in-boundary-mock.yaml:14` comment.

### Requirements

- [x] R1. `spur feature check <id> --inventory <report>` parses the report's `## Requirement inventory` (`- I<n> — ` items, `[deferred: …]` exempt, `[unclear: …]` not exempt) and the feature's AC `# covers: I<n>, …` lines; each uncovered non-deferred item is an error finding (rule id `inventory-coverage`); a missing/empty inventory section is an error. Logic ported from `plugins/sp/scripts/idea-coverage-check.ts` into `packages/app/src/services/feature-check.ts` (or a sibling module it imports).
- [x] R2. `idea-pipeline.yaml`: the `idea-ac-check` command.gate args gain `--inventory .spur/run/${vars.__runId}-idea-eval-report.md`; delete the idea-coverage-check action; every reader of `idea-coverage.status` (route derivation ~285, feature-check prompt ~302–309, ~322, guards ~708/721) reads only `idea-ac-check.status`.
- [x] R3. `FeatureService.syncFeature` persists a BLOCKED outcome with its input fingerprint to `.spur/run/feature-sync-blocked-<id>.json` and, when a later call sees the same fingerprint, returns the prior result with `suppressed: true` without re-deriving hops; a changed fingerprint or `--force` runs normally and a non-BLOCKED outcome clears the state. Fingerprint inputs and order-insensitivity match `feature-sync-bounded.ts:70–110`.
- [x] R4. `task-pipeline.yaml` record: replace the record-feature-sync action with an inline shell that resolves `feature_id` via `$spurBin task show $wbs --json`, calls `$spurBin feature sync "$FID" --json`, appends the orphan note when unlinked, keeps the `deferFeatureSync` branch, and exits 0.
- [x] R5. `wrapup-steps.ts` and `execution-batch.md` call `spur feature sync <id> --json` directly; `wrapup-pipeline.yaml:348` text updated.
- [x] R6. Delete `idea-coverage-check.ts`, `feature-sync-bounded.{ts,mjs}`, `record-feature-sync.{ts,mjs}`, their tests, manifest rows, `build:scripts` converts and baseline entries; port behavioral cases to `packages/app/tests/services/` and `apps/cli/tests/`.
- [x] R7. Update remaining prose/test/comment consumers listed in Background and the `sp:spur-cli` feature reference (`--inventory`, suppression semantics); `rg 'idea-coverage-check|feature-sync-bounded|record-feature-sync' plugins/sp config packages apps/cli/src scripts package.json` returns nothing.

### Acceptance Criteria

- [x] AC1 — Refactor lands in independently revertible waves (req: R1, R2, R3, R4, R5)
- [x] AC2 — Duplicated and overengineered scripts are deleted (req: R6)
- [x] AC3 — sp skills, commands and workflows track every CLI move (req: R7)

Task-local observability: AC1 by CLI tests — a report with I3 uncovered → `feature check <id> --inventory <r> --json` exit 1 with one `inventory-coverage` finding; two consecutive `feature sync <id> --json` on an unchanged BLOCKED feature → second has `suppressed: true`; `--force` → not suppressed — plus updated pipeline-definition tests; AC2/AC3 by the R7 `rg` returning nothing and the three scripts absent.

### Q&A

- **Q: Fold feature-verification-steps into `feature sync` (plan C4)?** A: No — different boundary (ADR-119 receipts, owned by `feature-verification.yaml`). Kept and exempted. Closed.
- **Q: Where does suppression state live?** A: Same path as today (`.spur/run/feature-sync-blocked-<id>.json`) so a mid-upgrade run keeps its state; the CLI already owns `.spur/`. Closed.
- **Q: Does suppression change `feature sync` for interactive users?** A: Only a repeated BLOCKED call with identical inputs is replayed, flagged `suppressed: true`; `--force` restores the old behavior. This is the consented C4 observable change. Closed.
- **Q: Keep `idea-coverage.status` for back-compat?** A: No reader remains after R2; removed. Closed.
- **Q: `--force` already means "apply reopen proposals without confirmation" — is using it to bypass suppression a new surface?** A: It widens an existing flag within the consented C4 change: a forced sync must never replay a stale BLOCKED result. The help text gains one clause ("…; also bypasses repeated-BLOCKED suppression"). No new flag. Closed; reported to operator.

### Design

**What.** Coverage becomes a `feature check` flag; BLOCKED-retry suppression becomes `feature sync` behavior; the record step calls the CLI directly.

**Frozen names.**
- CLI: `spur feature check <id> --inventory <report>` (C3). `spur feature sync` unchanged flags; JSON result gains `suppressed?: true` (C4).
- App: `checkInventoryCoverage(reportText: string, acText: string): FeatureCheckFinding[]` in `packages/app/src/services/feature-inventory.ts`, called by feature-check when `inventory` option set. `computeSyncFingerprint(input)`, `BlockedSyncState` in `packages/app/src/services/feature-sync-suppression.ts`, used by `FeatureService.syncFeature`; `FeatureSyncOptions` gains `force?: boolean` if not present.
- Finding rule id: `inventory-coverage`.

**Why.** ADR-130: feature-domain logic lives behind `spur feature`; the plugin wrapper existed only because the CLI lacked the policy.

**Where.** `apps/cli/src/commands/feature.ts`, `packages/app/src/services/{feature-check,feature-service,feature-inventory,feature-sync-suppression}.ts`, `config/workflows/{idea,task,wrapup}-pipeline.yaml`, `plugins/sp/scripts/wrapup-steps.{ts,mjs}`, consumers in R7.

**Anti-patterns.** No new `feature` verb. Do not touch feature-verification-steps. Do not make suppression apply to non-BLOCKED outcomes. Record step stays best-effort (exit 0).

**Handoff.** 1007 counts the removed idea-pipeline coverage action and the simplified guards.

### Plan

1. `feature-inventory.ts` + tests (ported from idea-coverage-check tests); `--inventory` option + CLI test.
2. Rewire idea-pipeline gate/guards; update idea-pipeline-definition tests.
3. `feature-sync-suppression.ts` + `syncFeature` integration + tests (ported from feature-sync-bounded tests); CLI suppression test.
4. Replace record-feature-sync action; update wrapup-steps (+ regenerate twin), execution-batch, wrapup-pipeline text, resilience + lifecycle-drift tests.
5. Delete scripts/tests/manifest rows/build:scripts converts/baseline entries; update prose consumers and spur-cli feature reference.
6. `bun run spur-check`, `bun run plugin-smoke`, `spur rule run --rule sp-script-placement`, R7 `rg`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/feature.ts:407` |
| `apps/cli/src/commands/feature.ts:423` |
| `apps/cli/src/commands/feature.ts:461` |
| `apps/cli/src/commands/feature.ts:529` |
| `apps/cli/src/commands/feature.ts:554` |
| `apps/cli/src/commands/shared-options.ts:119` |
| `packages/app/src/services/feature-check.ts:209` |
| `packages/app/src/services/feature-check.ts:304` |
| `packages/app/src/services/feature-check.ts:34` |
| `packages/app/src/services/feature-service.ts:25` |
| `packages/app/src/services/feature-service.ts:551` |
| `packages/app/src/services/feature-service.ts:560` |
| `packages/app/src/services/feature-service.ts:59` |
| `packages/app/src/services/feature-service.ts:635` |
| `packages/app/src/services/feature-service.ts:74` |
| `packages/app/src/services/feature-service.ts:9` |
| `packages/app/src/services/planning-check-base.ts:95` |
| `packages/app/src/services/task-size-precheck.ts:103` |
| `packages/app/src/services/task-size-precheck.ts:99` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:325` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:641` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:644` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:661` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:666` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:669` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:674` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:676` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:113` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:120` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:144` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:15` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:152` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:187` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:190` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:198` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:202` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:218` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:223` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:228` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:230` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:285` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:306` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:331` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:75` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:80` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:84` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:88` |
| `packages/app/tests/workflow/idea-pipeline-routing.test.ts:9` |
| `packages/config/src/finding-codes.ts:181` |
| `packages/config/src/finding-codes.ts:83` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:0` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:170` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:197` |
| `plugins/sp/scripts/history-anatomy-cache.ts:0` |
| `plugins/sp/scripts/history-anatomy-cache.ts:26` |
| `plugins/sp/scripts/history-anatomy-cache.ts:945` |
| `plugins/sp/scripts/workflow-step-profile.ts:22` |
| `plugins/sp/scripts/workflow-step-profile.ts:320` |
| `plugins/sp/scripts/wrapup-steps.ts:0` |
| `plugins/sp/scripts/wrapup-steps.ts:33` |
| `plugins/sp/scripts/wrapup-steps.ts:487` |
| `plugins/sp/scripts/wrapup-steps.ts:492` |
| `plugins/sp/tests/run-record-catalog.test.ts:132` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:451` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:456` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:459` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:483` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:487` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:497` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:506` |
| `plugins/sp/tests/workflow-step-profile.test.ts:597` |
| `scripts/commands/surface-drift-inventory.test.ts:28` |
| `scripts/commands/surface-drift-inventory.test.ts:369` |
| `scripts/commands/surface-drift-inventory.test.ts:4` |
| `scripts/commands/surface-drift-inventory.test.ts:707` |
| `scripts/commands/surface-drift-inventory.ts:30` |
| `scripts/commands/surface-drift-inventory.ts:518` |
| `scripts/commands/surface-drift-inventory.ts:692` |
| `scripts/commands/surface-drift-inventory.ts:696` |
| `scripts/commands/surface-drift-inventory.ts:873` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/feature-inventory.ts:40 `checkInventoryCoverage(report, ac)` (parseInventory:28-46 — `[deferred:` exempt, `[unclear:` still owing; missing/empty section → error finding :54-62); wired in packages/app/src/services/feature-check.ts:305-308; CLI flag apps/cli/src/commands/feature.ts:405-407 with fail-closed unreadable-report read :427-433; rule id registered packages/config/src/finding-codes.ts:184 (`inventory-coverage`, allowlist :85). Tests: packages/app/tests/services/feature-inventory.test.ts 6 pass (incl. unclear-not-exempt :57, missing section fails closed :64, empty section :70). |
| R2 | MET | config/workflows/idea-pipeline.yaml:250 gate args carry `--inventory .spur/run/${vars.__runId}-idea-eval-report.md`; idea-coverage-check action deleted (comment :259 "coverage folds into idea-ac-check via --inventory"); `grep idea-coverage config/workflows/idea-pipeline.yaml` → no matches (exit 1); route derivation :286, feature-check prompt :293 and guards :681-698 read only `idea-ac-check.status`; idea-pipeline-definition + idea-pipeline-routing tests pass (226 across 4 files incl. feature-service/feature-check suites). |
| R3 | MET | packages/app/src/services/feature-sync-suppression.ts:29 `computeSyncFingerprint` (sha256[:32], sorted vectors :36-39), `BlockedSyncState` :47, path `.spur/run/feature-sync-blocked-<id>.json` :60; FeatureService.syncFeature packages/app/src/services/feature-service.ts:560-572 — force/dryRun/forceConfirm bypass replay :560-562, replay returns `suppressed: true` :563-565, non-BLOCKED clears state :666-678, fingerprint inputs :695-701. Tests: feature-sync-suppression.test.ts:173-196 (persist→replay suppressed:true, --force re-derives) and CLI apps/cli/tests/commands/feature-inventory-sync.test.ts:131 pass. |
| R4 | MET | config/workflows/task-pipeline.yaml:765 record step is an inline shell: FID resolved via `$spurBin task show $wbs --json` + jq, `$spurBin feature sync "$FID" --json`, orphan note appended when FID empty, `deferFeatureSync` branch kept :757-763, `exit 0`. Tests: plugins/sp task-pipeline-resilience + run-record-catalog 41 pass. |
| R5 | MET | plugins/sp/scripts/wrapup-steps.ts:492 calls `spur(env, ['feature', 'sync', feature, '--json'], ...)` directly (suppression note :488); regenerated twin wrapup-steps.mjs updated (mirror lines :320/:373/:377 region); plugins/sp/skills/spur-dev/references/execution-batch.md:340 "invoke `spur feature sync <feature-id> --json` directly"; config/workflows/wrapup-pipeline.yaml:348 text updated ("repeated-BLOCKED…"). workflow-step-profile tests 39 pass. |
| R6 | MET | Deletions: ls idea-coverage-check.ts, feature-sync-bounded.{ts,mjs}, record-feature-sync.{ts,mjs} → all ENOENT; git status shows D for the 5 scripts + 2 test files. Rows purged: grep across config/plugin-scripts.json, package.json (build:scripts), config/script-placement-baseline.json, packages/app/tests/workflow/fixtures/guard-parity-baseline.json → no matches (exit 1). Ports: packages/app/tests/services/feature-inventory.test.ts (6) + feature-sync-suppression.test.ts (14), apps/cli/tests/commands/feature-inventory-sync.test.ts (2) — all pass. |
| R7 | MET | `rg 'idea-coverage-check |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | bun test packages/app (feature-inventory 6 + feature-sync-suppression 14 = 20 pass; feature-service/feature-check/idea-pipeline-definition/idea-pipeline-routing 226 pass); bun test apps/cli feature-inventory-sync.test.ts 2 pass — uncovered item → inventory-coverage finding with failing exit (test :97), two identical syncs → second `suppressed: true`, --force re-derives (test :131); feature.test.ts 47 pass. |
| AC2 | MET | command | R7 rg sweep over plugins/sp config packages apps/cli/src scripts package.json → exit 1 (zero matches); ls of the three scripts (+.mjs twins) → all absent; manifest/build:scripts/baseline grep → exit 1. |
| AC3 | MET | command | bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo → "All 1 rule passed — no violations found"; spur-cli features.md rows :187-192/:224-229 verified; rg sweep exit 1. |
| AC-1 | MET | command | Same command evidence as AC1: wave-scoped suites all green (packages/app 246 pass across the two runs, apps/cli 49 pass, plugins/sp 80 pass incl. workflow-step-profile 39, packages/domain lifecycle-drift 25, scripts surface-drift-inventory 78). |
| AC-2 | MET | command | Same command evidence as AC2: three scripts and their tests deleted (git D, ls ENOENT), manifest/build:scripts/baseline rows purged (grep exit 1). |
| AC-3 | MET | command | Same command evidence as AC3: sp-script-placement rule PASS + R7 rg sweep exit 1 + spur-cli/docs/help prose updated. |
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

- 2026-09-29T21:28:20.549Z todo → testing (system)
- 2026-09-29T21:28:36.185Z testing → done (system)

