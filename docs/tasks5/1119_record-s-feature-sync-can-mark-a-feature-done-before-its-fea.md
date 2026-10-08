---
schema_version: 1
name: record's feature sync can mark a feature done before its feature-verification receipt exists
status: done
template: feature-impl
created_at: 2026-10-07T20:52:30.428Z
updated_at: "2026-10-08T17:22:52.615Z"

feature_id: F3
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1119-verdict.json
---

## 1119. record's feature sync can mark a feature done before its feature-verification receipt exists

### Background

Found 2026-10-07 while closing G71 and G31 (knowledge-kit batch).

The `record` state's post-record shell runs `spur feature sync <id>` and is documented as a **best-effort follow-up, not a completion gate**. That sync derives and applies hops, and for a feature whose tasks are all done and whose scenarios are all verified it applies `verifying → done` — moving the feature to `done` **before** `feature-verification.yaml` has recorded its receipt.

Observed twice, identically:
- `{"applied":true,"appliedHops":["verifying","done"]}`
- immediately after, `feature check <id> --strict --as done` → `pass: false`, `L4.feature-receipt-missing: no feature-latest receipt at …`

The receipt then has to be produced out of band for the status to become truthful. A status that a stricter gate rejects in between is a corpus state that cannot be read as authoritative.

Related (same session, separate task): the receipt is digest-bound, so it also goes `stale` whenever the tree changes afterwards — see the worktree persist-out task.

**Refine corrections (2026-10-07)**

- **Root cause.** `FeatureService.deriveFeatureStatus` gates the advance to `done` with `checkL4Gate` (`packages/app/src/services/feature-service.ts:482`), which calls `FeatureCheckService.check` **without** `asStatus`. The receipt check runs only when `asStatus === 'done' && runDir` (`packages/app/src/services/feature-check.ts:277`), and the comment there assumes every completion path passes the hint. `syncFeature` (`:584`) then applies the hops (`:518-526`) through FSM-only transitions. So sync is a completion path that skips the receipt.
- **All sync callers share this one derivation:** the pipeline `record` step, the precheck reactivation (`config/workflows/task-pipeline.yaml:245`, which targets `active` and is unaffected), the batch deferred sync, and `syncAll` (`feature-service.ts:757`). Fixing the derivation covers all of them.
- **R2 decided (see Q&A):** sync stays best-effort and is not made strict. It never claims `done` without a valid receipt; it stops at `verifying` and reports the receipt findings. The pipeline ordering does not change.
- **Gap found during refine.** Nothing advances the feature after `feature-verification.yaml` writes its receipt; that workflow has no advance step. Completion therefore comes from the next `spur feature sync` or `spur feature advance`. For the next sync to re-evaluate, a receipt-only stop must not be persisted as a repeated BLOCKED (1004 suppression, `:683-700`): that fingerprint does not include the receipt file.
- **Existing tests encode the bug.** `packages/app/tests/services/feature-service.test.ts` expects `['done']` (`:904`) and `['active','verifying','done']` (`:1031`) with no receipt. They need a receipt fixture.

### Requirements

- [x] R1. When `deriveFeatureStatus` would propose hops ending in `done`, it also evaluates the feature with `asStatus: 'done'` (same `runDir`, plus an optional `receiptRunPort`). If any `L4.feature-receipt-*` error is present, the proposal stops at `verifying`: hops run only up to `verifying`, `to` is `verifying`, and the receipt findings are returned in `gateFindings`.
- [x] R2. Sync's role is unchanged and recorded: best-effort, never strict, never claiming `done` without a valid receipt. A receipt-only stop is not persisted as a repeated BLOCKED state, so the next `spur feature sync` after the receipt lands completes the feature without `--force`.
- [x] R3. `FeatureSyncOptions` gains an optional `receiptRunPort`; the CLI `feature sync` passes `makeReceiptRunPort(context)`, as `feature check` and `feature advance` already do.
- [x] R4. `spur feature sync <id> --json` output for a receipt-only stop names the `L4.feature-receipt-*` finding code and message, so a caller sees why `done` was withheld.
- [x] R5. Regression tests: all tasks done, L4 AC gate passing, no receipt → the feature ends at `verifying` with `L4.feature-receipt-missing` reported; with a valid receipt → the feature reaches `done`. Existing sync tests that expect `done` get a receipt fixture rather than a weakened assertion.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Sync without a receipt stops at verifying and reports the receipt finding (req: R1, R2, R4)
  Given a git-fixture project whose feature is active, all linked tasks are done and the L4 AC gate passes, and no feature-latest receipt exists
  When `spur feature sync <id> --json` runs
  Then the applied hops end at `verifying`, the feature status on disk is `verifying`, and the JSON names `L4.feature-receipt-missing`

Scenario: AC2 — Sync with a valid receipt completes the feature (req: R1, R3, R5)
  Given the same project after a valid feature-latest receipt for the current tree is written under `.spur/memory/evidence/`
  When `spur feature sync <id> --json` runs again without `--force`
  Then the feature reaches `done` and the result is not a suppressed BLOCKED replay
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:27:04.690Z

- **R2 direction: sync stays best-effort and stops at `verifying`; it does not become strict.** A strict sync would fail the pipeline `record` step for every last task of a feature, because the feature-verification pass necessarily runs after the last task. Moving that pass before `record` would invert the D63 ordering. Stopping at `verifying` makes the status truthful (`verifying` means "awaiting the feature pass") with no ordering change.
- **Second probe instead of switching the existing gate to `asStatus: 'done'`.** `asStatus` also changes one-active-goal direction and severity escalation (`feature-check.ts:226-266`). Reusing it for the whole gate could change today's stop-before-verifying outcomes. A second check, consulted only for `L4.feature-receipt-*` codes and only when the proposal would reach `done`, limits the change to the receipt.
- **Receipt-only stops are not persisted as BLOCKED.** The 1004 fingerprint does not cover the receipt file, so a persisted block would replay after the receipt exists. Ordinary L4 AC-gate blocks keep their current persistence.
- **No auto-advance step in `feature-verification.yaml`.** Completion after the receipt stays with the next sync or `feature advance`, which is the existing D63 contract. Adding an advance step is out of scope.

### Design

**Surfaces.** `packages/app/src/services/feature-service.ts`, `apps/cli/src/commands/feature.ts`.

1. `FeatureSyncOptions` (`:56`) adds `receiptRunPort?: FeatureReceiptRunPort` (the type the CLI's `makeReceiptRunPort` already returns, `apps/cli/src/commands/feature.ts:593`).
2. `deriveFeatureStatus(featureId, options?: { receiptRunPort?: FeatureReceiptRunPort })`. `syncFeature` (`:603`) forwards `options`.
3. In the all-terminal branch, after `checkL4Gate()` passes and before the hops to `done` are built:
   ```ts
   const receipt = await checkSvc.check(feature.filePath, featureId, {
       ...sameOptionsAsCheckL4Gate, asStatus: 'done', receiptRunPort: options?.receiptRunPort,
   });
   const receiptErrors = receipt.findings.filter(
       (f) => f.severity === 'error' && f.code?.startsWith('L4.feature-receipt-'),
   );
   if (receiptErrors.length > 0) {
       // 1119: never claim done without the feature-verification receipt; stop at verifying.
       const hops = from === 'backlog' || from === 'blocked' ? ['active', 'verifying'] : from === 'active' ? ['verifying'] : [];
       return { featureId, from, to: 'verifying', reason: 'feature-verification receipt missing or invalid; stopped at verifying',
                receiptPending: true, gateFindings: receiptErrors, ...(hops.length > 0 ? { hops } : {}) };
   }
   ```
   Factor the shared `check` options out of `checkL4Gate` into a local so both probes use identical dirs.
4. `FeatureSyncProposal` gains `receiptPending?: boolean`. It does **not** set `gateBlocked`, so `recordBlockedSyncState` (`:683`) does not persist it. A receipt-pending proposal already at `verifying` has `from === to` and is not classified blocked.
5. CLI `feature sync` (`apps/cli/src/commands/feature.ts:559`) passes `receiptRunPort: await makeReceiptRunPort(context)`. The human output prints the receipt finding when `receiptPending`; `--json` already serializes `proposal.gateFindings`.

**Invariants.**
- Non-done targets (`active`, `blocked`, the precheck reactivation) are untouched.
- An L4 AC-gate failure still stops before `verifying`, exactly as today.
- `feature advance` and `feature check --strict --as done` are unchanged.
- Sync never exits non-zero for a receipt-pending stop, so the record step stays best-effort.

### Plan

1. Add AC1/AC2 to `apps/cli/tests/commands/feature.test.ts` using its git fixture (`:19-34`). Build the receipt with the helpers in `packages/app/tests/workflow/feature-verification-receipt.test.ts` / `persist-worktree-runs.test.ts`. Confirm AC1 fails today (feature reaches `done`).
2. Implement Design steps 1–5.
3. Update `packages/app/tests/services/feature-service.test.ts` cases at `:904` and `:1031`: add a valid receipt fixture so they still reach `done`, and add one unit case for the receipt-pending proposal (`to: 'verifying'`, `receiptPending: true`, no persisted BLOCKED file).
4. Focused: `(cd packages/app && bun test tests/services/feature-service.test.ts)` and `(cd apps/cli && bun test tests/commands/feature.test.ts)`.
5. `bun run spur-check`; then `bun link` in `apps/cli` and `bun run --filter @gobing-ai/spur build:bundle`.

### Solution

Completion no longer outruns the feature-verification receipt: `deriveFeatureStatus` runs a second, receipt-only probe at the completion boundary and stops the proposal at `verifying`, reporting the `L4.feature-receipt-*` findings instead of building hops to `done`.

Change map:

- packages/app/src/services/feature-service.ts:55 — `FeatureSyncProposal.receiptPending?: boolean`. Deliberately not `gateBlocked`: the 1004 fingerprint cannot see the receipt file, so a receipt-only stop must not persist as a repeated BLOCKED state (R2). A receipt-pending proposal already at `verifying` has `from === to` and stays a no-op.
- packages/app/src/services/feature-service.ts:65 — `FeatureSyncOptions.receiptRunPort?: FeatureReceiptRunPort` (R3), the same port shape the CLI's `makeReceiptRunPort` returns.
- packages/app/src/services/feature-service.ts:441 — `deriveFeatureStatus(featureId, options?)`; packages/app/src/services/feature-service.ts:649 forwards the options from `runSyncFeature`.
- packages/app/src/services/feature-service.ts:490 — shared `check` options factored out of `checkL4Gate` so the L4 AC gate and the receipt probe see identical dirs (multi-folder scan unchanged).
- packages/app/src/services/feature-service.ts:530 — after the L4 AC gate passes, a second probe with `asStatus: 'done'` + the port; only `L4.feature-receipt-*` errors are consulted (R1). Any hit returns `to: 'verifying'`, `receiptPending: true`, findings in `gateFindings`, hops `backlog|blocked → ['active','verifying']`, `active → ['verifying']`, `verifying → []`. Today's stop-before-verifying outcomes keep their shape because the probe runs only after the ordinary gate passed.
- apps/cli/src/commands/feature.ts:533 (sync `--all`) and apps/cli/src/commands/feature.ts:561 (sync `<id>`) pass `receiptRunPort: await makeReceiptRunPort(context)`, matching `feature check` / `feature advance` (R3).
- apps/cli/src/commands/feature.ts:583 — human output prints each receipt finding when `receiptPending`; `--json` already serializes `proposal.gateFindings` with code + message (R4). A receipt-pending stop never exits non-zero, so the pipeline `record` step stays best-effort.

Tests:

- packages/app/tests/services/feature-service.test.ts:70 — `recordPassReceipt` fixture (real receipt helpers over the suite's tmp root); the three existing `done`-expecting sync tests now carry a receipt rather than a weakened assertion (R5); the new 1119 case proves the receipt-pending stop (`to: 'verifying'`, `receiptPending: true`, `L4.feature-receipt-missing`, no persisted BLOCKED file) and the no-`--force` completion once the receipt lands (R2).
- apps/cli/tests/commands/feature.test.ts:804 — AC1: file-wins `verifying` fixture + done task, `sync --json` stays at `verifying` and names `L4.feature-receipt-missing`. apps/cli/tests/commands/feature.test.ts:861 — AC2: valid receipt + backed run row/artifact in the project DB, `sync --dry-run --json` releases `done` (`hops: ['done']`, no `receiptPending`, no `suppressed` replay). The applied verifying/done hops run lifecycle shell guards that cannot pass under `bun test` (`resolveSpurBin` resolves the test file), so the CLI asserts the derivation contract and the applied-path completion is covered by the service suite.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | second completion-boundary probe with asStatus done plus the receipt port `packages/app/src/services/feature-service.ts:535`, filtered to L4.feature-receipt errors, returns to verifying with gateFindings `packages/app/src/services/feature-service.ts:558`; proven by `packages/app/tests/services/feature-service.test.ts:1023` (58 pass / 0 fail this run from repo root and from packages/app) |
| R2 | MET | receiptPending is a separate flag, not gateBlocked `packages/app/src/services/feature-service.ts:55`; no persisted BLOCKED file asserted `packages/app/tests/services/feature-service.test.ts:1058` and the next sync completes without force in the same test |
| R3 | MET | FeatureSyncOptions.receiptRunPort `packages/app/src/services/feature-service.ts:65` forwarded at `packages/app/src/services/feature-service.ts:649`; CLI sync --all and sync id pass the project port `apps/cli/src/commands/feature.ts:540` and `apps/cli/src/commands/feature.ts:567` |
| R4 | MET | receiptPending proposal carries code and message in gateFindings (asserted `packages/app/tests/services/feature-service.test.ts:1053`); human output prints them `apps/cli/src/commands/feature.ts:582`; CLI JSON assertion `apps/cli/tests/commands/feature.test.ts:851` not executable in this sandbox (.git/config write denied) |
| R5 | MET | real-receipt fixture `packages/app/tests/services/feature-service.test.ts:49` now folds learnings like production `plugins/sp/scripts/feature-verification-steps.ts:203-207`; done-expecting sync tests carry receipts; fixture defect fixed this run (4 fail from repo root before, 0 after) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Sync without a receipt stops at verifying and reports the receipt finding (req: R1, R2, R4) | MET | test | service-level sync stays at verifying, names L4.feature-receipt-missing and persists no BLOCKED file `packages/app/tests/services/feature-service.test.ts:1023` green this run; CLI wiring re-read `apps/cli/src/commands/feature.ts:567`; CLI test `apps/cli/tests/commands/feature.test.ts:761` blocked by the sandbox here |
| AC2 — Sync with a valid receipt completes the feature (req: R1, R3, R5) | MET | test | same service test lands a valid receipt and the next sync reaches done without force `packages/app/tests/services/feature-service.test.ts:1023` green this run; CLI test `apps/cli/tests/commands/feature.test.ts:859` (fixture fixed the same way) blocked by the sandbox here |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `packages/app/src/services/feature-service.ts:56` — `FeatureSyncOptions`; `:436` `deriveFeatureStatus`; `:482` `checkL4Gate`; `:518-526` done hops; `:584` `syncFeature`; `:683` `recordBlockedSyncState`.
- `packages/app/src/services/feature-check.ts:277` — receipt check bound to `asStatus: 'done'`.
- `packages/config/src/finding-codes.ts:172-179` — `L4.feature-receipt-*` codes.
- `apps/cli/src/commands/feature.ts:465`, `:559`, `:593`, `:680` — check/sync/advance and `makeReceiptRunPort`.
- `packages/app/src/workflow/feature-verification-receipt.ts` — receipt validation (fail-closed).
- Feature F3 (feature management CLI); related: D63 feature-verification receipts.

### History

- 2026-10-07T21:27:14.815Z backlog → todo (system)
- 2026-10-08T06:12:33.690Z todo → wip (system)
- 2026-10-08T07:06:29.203Z wip → done (system)

