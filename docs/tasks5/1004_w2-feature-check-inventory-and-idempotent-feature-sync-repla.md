---
schema_version: 1
name: W2 feature check --inventory and idempotent feature sync replace feature scripts
status: todo
template: feature-impl
created_at: 2026-09-29T06:25:03.419Z
updated_at: "2026-09-29T06:49:18.511Z"
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

- [ ] R1. `spur feature check <id> --inventory <report>` parses the report's `## Requirement inventory` (`- I<n> — ` items, `[deferred: …]` exempt, `[unclear: …]` not exempt) and the feature's AC `# covers: I<n>, …` lines; each uncovered non-deferred item is an error finding (rule id `inventory-coverage`); a missing/empty inventory section is an error. Logic ported from `plugins/sp/scripts/idea-coverage-check.ts` into `packages/app/src/services/feature-check.ts` (or a sibling module it imports).
- [ ] R2. `idea-pipeline.yaml`: the `idea-ac-check` command.gate args gain `--inventory .spur/run/${vars.__runId}-idea-eval-report.md`; delete the idea-coverage-check action; every reader of `idea-coverage.status` (route derivation ~285, feature-check prompt ~302–309, ~322, guards ~708/721) reads only `idea-ac-check.status`.
- [ ] R3. `FeatureService.syncFeature` persists a BLOCKED outcome with its input fingerprint to `.spur/run/feature-sync-blocked-<id>.json` and, when a later call sees the same fingerprint, returns the prior result with `suppressed: true` without re-deriving hops; a changed fingerprint or `--force` runs normally and a non-BLOCKED outcome clears the state. Fingerprint inputs and order-insensitivity match `feature-sync-bounded.ts:70–110`.
- [ ] R4. `task-pipeline.yaml` record: replace the record-feature-sync action with an inline shell that resolves `feature_id` via `$spurBin task show $wbs --json`, calls `$spurBin feature sync "$FID" --json`, appends the orphan note when unlinked, keeps the `deferFeatureSync` branch, and exits 0.
- [ ] R5. `wrapup-steps.ts` and `execution-batch.md` call `spur feature sync <id> --json` directly; `wrapup-pipeline.yaml:348` text updated.
- [ ] R6. Delete `idea-coverage-check.ts`, `feature-sync-bounded.{ts,mjs}`, `record-feature-sync.{ts,mjs}`, their tests, manifest rows, `build:scripts` converts and baseline entries; port behavioral cases to `packages/app/tests/services/` and `apps/cli/tests/`.
- [ ] R7. Update remaining prose/test/comment consumers listed in Background and the `sp:spur-cli` feature reference (`--inventory`, suppression semantics); `rg 'idea-coverage-check|feature-sync-bounded|record-feature-sync' plugins/sp config packages apps/cli/src scripts package.json` returns nothing.

### Acceptance Criteria

- [ ] AC1 — Refactor lands in independently revertible waves (req: R1, R2, R3, R4, R5)
- [ ] AC2 — Duplicated and overengineered scripts are deleted (req: R6)
- [ ] AC3 — sp skills, commands and workflows track every CLI move (req: R7)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
