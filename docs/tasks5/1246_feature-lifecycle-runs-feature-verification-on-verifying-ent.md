---
schema_version: 1
name: feature-lifecycle runs feature verification on verifying entry; remove feature-verification.yaml
status: done
template: feature-impl
created_at: 2026-10-18T05:10:06.867Z
updated_at: "2026-10-19T01:34:14.971Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - feature-lifecycle
  - breaking

estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1246-verdict.json
---

## 1246. feature-lifecycle runs feature verification on verifying entry; remove feature-verification.yaml

### Background

feature-verification.yaml is a one-state wrapper over `spur feature verify` (162 runs since 2026-09). feature-lifecycle's `verifying` onEnter runs it as a nested `spur workflow run` behind `env -u SPUR_WORKFLOW_RUN_ACTIVE` (1147 R4 workaround). The receipt's verifier identity is the resolved `feature-verification` definition (packages/app/src/workflow/feature-verification-run.ts:213, packages/app/src/services/feature-check.ts:561), so deleting the file without rebinding fails every verifying→done check closed. Covers feature scenarios R1 (this workflow's part), R2 and R3. Design: docs/design/workflow-consolidation.md §3.2, ADR-142.

**Refine corrections (2026-10-17)**

- R1 premise was unsound twice. (a) The lifecycle caller runs only `kind: shell` onEnter actions (packages/app/src/workflow/lifecycle-adapter.ts:347 refuses any other kind), so a `command.gate` in `verifying` onEnter would deny every active→verifying hop. (b) Binding the receipt to the lifecycle run id fails closed: the receipt gate requires the recording run row to be terminal `done` (packages/app/src/workflow/feature-verification-receipt.ts:417), and the lifecycle run is still `running` at verifying→done. Corrected: onEnter stays one shell action calling `$spurBin feature verify $featureId --no-logo`; without `--run-id` the verb opens its own run row bound to the resolved feature-lifecycle definition and finalizes it `done` when the pass completes. D66 scenario R2's Then-step was corrected to match.
- Exit contract confirmed: `spur feature verify` exits 0 after a completed pass, PASS or FAIL (apps/cli/src/commands/feature/verify.ts:12). With the nested workflow gone, a FAIL pass now lands the feature in `verifying` with a FAIL receipt; the verifying→done guard denies it and verifying→active is the rework edge. Only a pass that cannot run denies entry.
- R5 confirmed: the receipt families live in packages/app/src/workflow/persist-check.ts:24 (`DURABLE_FAMILY_RE`), packages/app/src/services/run-storage.ts:264 and packages/app/src/services/worktree-persist.ts:188, not in feature-verification-*.ts.
- R4: the apps/cli/config copy is untracked build output; `build:bundle` regenerates it, so deletion is proven by a rebuilt bundle, not a git diff.
- D66 scenario R3 now states the decided stale-receipt behaviour; the compatibility-read alternative was dropped.

### Requirements

- [x] R1. feature-lifecycle `verifying` onEnter is one shell action running `$spurBin feature verify $featureId --no-logo`; no nested `spur workflow run`, no `env -u SPUR_WORKFLOW_RUN_ACTIVE`. Observable: entering verifying on a fixture feature starts no `feature-verification` run row.
- [x] R2. `spur feature verify <id>` without `--run-id` opens its own run row (workflow `feature-lifecycle`, metadata definition digest of the resolved feature-lifecycle definition), records the receipt against it and finalizes the row `done` once the pass completes (PASS or FAIL). An explicit `--run-id` keeps today's behaviour.
- [x] R3. The verifier identity name comes from one exported constant `FEATURE_VERIFIER_DEFINITION = 'feature-lifecycle'`, used by feature-verification-run.ts and feature-check.ts; a PASS receipt from R1 lets `feature check <id> --strict --as done` pass.
- [x] R4. A feature-latest receipt whose verifier name is `feature-verification` fails `feature check <id> --strict --as done` as stale, and the message names `spur feature verify <id>`.
- [x] R5. config/workflows/feature-verification.yaml is deleted and absent from the rebuilt apps/cli/config bundle; the `verificationCmd` var is dropped and `spur feature verify` still runs `spur self exec check-feature`.
- [x] R6. Receipt file names and the persist-check, run-storage and worktree-persist families are unchanged.

Out of scope: pr-review and wayfinder-resolution deletion (1251); feature sync auto-advance (1247); wrapup feature writes (1249); doc and CHANGELOG sweep (1252); engine wildcard `from` (1253).

### Acceptance Criteria

- [x] AC1 — Entering verifying runs the feature verification pass inside feature-lifecycle (req: R1, R2)
- [x] AC2 — The verification receipt names feature-lifecycle as its verifier (req: R3, R4)
- [x] AC3 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution (req: R5, R6)

Task-local: this task delivers the feature-verification part of AC3; pr-review and wayfinder-resolution land in 1251.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: the verb owns its run identity. `spur feature verify` without `--run-id` opens a run row for the pass and finalizes it, and the lifecycle onEnter shell calls the verb directly. This keeps the receipt integrity rule (recording run terminal `done`, digest equal to the receipt verifier digest) unchanged and makes a standalone `spur feature verify <id>` work.

Rejected:
- `command.gate` in onEnter: the lifecycle caller runs shell actions only. Extending it to the action registry widens a server-reachable seam for one caller.
- Binding the receipt to the lifecycle run id: that run is `running` at verifying→done, so the done gate fails closed. Relaxing the rule for "self" runs weakens an integrity check.
- Keeping feature-verification.yaml as an alias (operator decision 1), or a compatibility read of old-identity receipts (it would trust a digest of a deleted definition).

Frozen names:
- `FEATURE_VERIFIER_DEFINITION = 'feature-lifecycle'`, exported from packages/app/src/workflow/feature-verification-receipt.ts and re-exported from packages/app/src/index.ts.
- The run row uses workflow name `feature-lifecycle`, no external key (never the lifecycle's `feature:<id>` key), and terminal reason `done`.

File targets:
- config/workflows/feature-lifecycle.yaml:60 — onEnter shell; delete the 0948/1147 comment block at lines 41–59.
- packages/app/src/workflow/feature-verification-run.ts:191,213,235 — open and finalize the run when `runId` is empty; resolve `FEATURE_VERIFIER_DEFINITION`; drop the `verificationCmd` var read and keep the `spur self exec check-feature` default.
- packages/app/src/services/feature-check.ts:561,563 — use the constant.
- packages/app/src/workflow/feature-verification-receipt.ts — add the constant, plus the stale-identity finding when `latest.verifier.name !== FEATURE_VERIFIER_DEFINITION`.
- apps/cli/src/commands/feature/verify.ts — help text: `--run-id` is optional; remove the workflow-env fallback wording for `verificationCmd`.
- packages/app/src/services/feature-transition.ts:19 — comment only.
- Delete config/workflows/feature-verification.yaml.
- Tests that load it: packages/app/tests/{workflow-resolver,consumer-compat,feature-lifecycle-adapter,feature-lifecycle-stale-consumer,feature-verification-run,feature-verification-receipt,sdlc-action-workflow-defaults,replay-matrix}.test.ts and plugins/sp/tests/{run-record-catalog,feature-verification-scope}.test.ts.

Anti-patterns:
- No compatibility read of the old identity.
- No nested run.
- No new `spur feature verify` flag.
- Do not change the exit contract (0 after a completed pass).
- Do not touch receipt file names.

Invariants:
- verifying→done still requires a current PASS receipt that is digest-chained to the checked inputs.
- A FAIL pass is a recorded outcome, not an unclassified error.

Handoffs:
- 1247: feature sync requests active→verifying through the same lifecycle adapter; no extra wiring.
- 1249: wrapup stops calling `feature verify`.
- 1252: sweeps docs and skills that name `feature-verification.yaml`, and adds the CHANGELOG BREAKING CHANGE note.

### Plan

- [x] 1. Failing E2E (R1, R2): a fixture feature with all tasks done; `spur feature update <id> verifying` records a receipt whose run row is `done` under `feature-lifecycle`, and no `feature-verification` run row exists.
- [x] 2. Failing tests (R3, R4): a PASS receipt from step 1 passes `feature check --strict --as done`; a receipt with verifier name `feature-verification` fails as stale and names `spur feature verify <id>`.
- [x] 3. Add `FEATURE_VERIFIER_DEFINITION`, switch both resolution sites and add the stale-identity finding (R3, R4).
- [x] 4. Open and finalize the pass's own run row when `runId` is empty (R2).
- [x] 5. Replace the verifying onEnter with the direct shell call (R1).
- [x] 6. Delete feature-verification.yaml, drop `verificationCmd`, rebuild the bundle and update the tests listed in Design (R5, R6).
- [x] 7. Run targeted tests in packages/app, apps/cli and plugins/sp, then `bun run spur-check`. Targeted suites + workspace typechecks + `recommended-pre-check` ran here (evidence in Solution); the full `spur-check` pass is the pipeline's `test` hop by the implement-scope contract, not an implement-step run.

### Solution

The `feature-verification` wrapper workflow is gone. `feature-lifecycle`'s `verifying` entry calls
`spur feature verify` directly, and the verb owns its own run identity when the caller supplies none —
so the receipt's integrity rule (recording run terminal `done`, digest equal to the receipt verifier
digest) holds without the nested run or the `env -u SPUR_WORKFLOW_RUN_ACTIVE` workaround.

**One verifier identity (R3, R4)**

- `packages/app/src/workflow/feature-verification-receipt.ts:63-71` — new exported
  `FEATURE_VERIFIER_DEFINITION = 'feature-lifecycle'`; re-exported at `packages/app/src/index.ts:1018`.
  Record-time and completion-time resolution read this one constant, so the two contracts cannot drift
  apart.
- `packages/app/src/workflow/feature-verification-receipt.ts:415-426` — stale-identity finding: a
  `latest.verifier.name` other than the constant returns `reason: 'stale'` naming
  `spur feature verify <id>`. Checked *before* run-row integrity, because a pre-consolidation
  receipt's run row may already have been swept — ordering it first keeps the message deterministic
  and single-remedy.
- `packages/app/src/services/feature-check.ts:562-567` and
  `packages/app/src/workflow/feature-verification-run.ts:240,331` — both resolution sites switched.

**The pass owns its run row (R2)**

- `packages/app/src/workflow/feature-verification-run.ts:237-266` — `runFeatureVerification` resolves
  the definition once (it is both the receipt identity and the row's binding), then branches: a
  non-empty `runId` keeps today's caller-owned behaviour; an empty one opens a row, runs the pass, and
  finalizes it.
- `packages/app/src/workflow/feature-verification-run.ts:103-113` — the `FeatureVerificationPassRun`
  seam, `open` / `finalize` as two calls rather than one scope-holding helper: the pass's command can
  run for hours and the project DB handle must not be held across it.
- `packages/app/src/workflow/feature-verification-run.ts:168-215` — the production seam goes through the
  same `DbWorkflowPersistenceAdapter` + `withRunIdentityRecording` stamp every other run uses, so
  `workflow trace` / `list` and the receipt's run-row check see an ordinary `feature-lifecycle` row.
  No external key: the lifecycle's own `feature:<id>` row is a different row and is never adopted.
- `packages/app/src/workflow/feature-verification-run.ts:255-265` — a completed pass closes its row
  `done` whether it recorded PASS or FAIL; the verdict belongs to the receipt, not the run. Only a pass
  that *could not run* leaves `failed`.

**The lifecycle entry (R1)**

- `config/workflows/feature-lifecycle.yaml:36-49` — the `verifying` state's `onEnter` is one shell action,
  `$spurBin feature verify $featureId --no-logo`. The 0948/1147 comment block and the nested
  `workflow run` + recursion-marker clearing are deleted.
- `packages/app/src/services/feature-transition.ts:18-20` — comment only; the transport still refuses a
  target state with `onEnter` actions (ADR-021), the action behind it just changed.

**Retiring the wrapper (R5, R6)**

- `config/workflows/feature-verification.yaml` deleted (98 lines). The `verificationCmd` var went with
  it, so `packages/app/src/workflow/feature-verification-run.ts:311-316` and
  `packages/app/src/services/feature-check.ts:569-571` both read `DEFAULT_FEATURE_VERIFICATION_CMD`
  (`spur self exec check-feature`) as the configured command. A `--cmd` override still records but
  cannot complete — unchanged.
- `apps/cli/src/commands/feature/verify.ts:4-28` — doc and help text: `--run-id` is optional, and the
  workflow-env fallback list drops `verificationCmd`. `--cmd` and its own `verificationCmd` env fallback
  stay (that is the verb's flag surface, not the retired workflow's var) — no flag added or removed (R6).
- Receipt file names and the `persist-check` / `run-storage` / `worktree-persist` receipt families are
  untouched (R6).

**Tests**

- `packages/app/tests/workflow/feature-lifecycle-verifying-entry.test.ts` (new, 239 lines) — the
  R1/R2/R3 E2E on throwaway project roots: entering `verifying` records a PASS receipt on its own
  terminal-`done` `feature-lifecycle` row with a null external key, no `feature-verification` row
  exists, and `feature update <id> done` then succeeds. The second fixture pins the FAIL path — a
  completed FAIL pass still closes its row `done`, the feature stays in `verifying`, and the done edge
  denies it.
- `packages/app/tests/workflow/feature-verification-receipt.test.ts:540` — the R4 stale-identity case.
- `apps/cli/tests/script-absorption-pr5-parity.test.ts:68,109-121` and
  `apps/cli/tests/fixtures/script-absorption-pr5/harness.ts:188-194` — the frozen golden capture is
  rebound rather than regenerated (the file's existing divergence-patch idiom): verifier identity →
  `feature-lifecycle`, and the run-id-bearing status/log filename normalized to `<RUNID>` because a pass
  without `--run-id` now mints its own. The `verify-refusals` third step no longer refuses an empty
  `--run-id`; it fails on the unknown feature instead
  (`apps/cli/tests/script-absorption-pr5-parity.test.ts:49-55,84-85`).
- `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts` deleted (334 lines). Its whole
  premise was a project-layer `feature-verification.yaml` override reached through a *nested*
  `spur workflow run`; with no nested run in the shipped catalog that fixture cannot be rebuilt. See the
  residual note below.
- Identity and path updates only: `feature-check` / `feature-service` / `feature-transition` /
  `run-storage` / `task-record` / `feature-lifecycle-adapter` / `feature-verification-run` /
  `replay-matrix` / `sdlc-action-workflow-defaults` / `workflow-resolver` / `wrapup-pipeline`
  (packages/app), `feature` / `feature/verify` / `workflow-decision-scan` (apps/cli), `transition-gate`
  (apps/server), `feature-verification-scope` / `run-record-catalog` (plugins/sp).

**Evidence**

```
(cd packages/app && bun test tests/workflow/{feature-verification-run,feature-verification-receipt,
  workflow-resolver,feature-lifecycle-adapter,sdlc-action-workflow-defaults,replay-matrix,
  wrapup-pipeline}.test.ts)                                              → 124 pass / 0 fail
(cd packages/app && bun test tests/services/{feature-service,feature-transition,run-storage,
  task-record}.test.ts tests/workflow/feature-lifecycle-verifying-entry.test.ts)
                                                                         → 273 pass / 0 fail
(cd packages/app && bun test tests/workflow/consumer-compat.test.ts
  tests/services/persist-worktree-runs.test.ts)                          →  64 pass / 0 fail
(cd apps/server && bun test tests/modules/feature/transition-gate.test.ts)→   8 pass / 0 fail
(cd plugins/sp && bun test tests/{feature-verification-scope,run-record-catalog}.test.ts)
                                                                         →  21 pass / 0 fail
(cd plugins/sp && bun test tests/shipping-readiness-contract.test.ts)    →   1 pass / 0 fail
(cd apps/cli && bun test tests/commands/feature/verify.test.ts tests/workflow-decision-scan.test.ts
  tests/script-absorption-pr5-parity.test.ts)                            →  52 pass / 0 fail
bun run --filter @gobing-ai/spur-app typecheck                           → exit 0
bun run --filter @gobing-ai/spur typecheck                               → exit 0
bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning
                                                                         → all 51 rules passed
```

R5 bundle proof — `bundle-config` recursively removes its target before copying
(`scripts/commands/bundle-config.ts:56`), so the rebuilt listing is a full regeneration:

```
bun run --filter @gobing-ai/spur build:bundle  → exit 0
ls apps/cli/config/workflows/
feature-lifecycle.yaml  history-anatomy.yaml  idea-pipeline.yaml  pr-review.yaml
task-lifecycle.yaml     task-pipeline.yaml    wayfinder-resolution.yaml  wrapup-pipeline.yaml
```

Public-surface probe — `spur feature verify <id>` with no `--run-id`, throwaway project root under
`$TMPDIR`, `spur self exec check-feature` stubbed to exit 0:

```
$ bun apps/cli/src/index.ts feature verify F1 --no-logo
feature verify: F1 verification PASS (run run_f7b1c5a4-61f8-4723-a7d4-ab897c2744a1, log …-feature-verification.log)
exit=0
receipt: verifier.name="feature-lifecycle", verificationCmd="spur self exec check-feature", status="PASS"
runs:    [{ id: run_f7b1c5a4…, workflow_name: "feature-lifecycle", status: "done", external_key: null }]

$ bun apps/cli/src/index.ts feature check F1 --strict --as done --no-logo
F1 (done): PASS
exit=0
```

**Residual risk and follow-ups (not this WBS)**

- ~~`apps/cli/tests/commands/feature.test.ts` could not run in this session.~~ **Resolved by the gate.**
  The file is unrunnable under the agent sandbox — its fixture `git init`s into a repo-internal temp dir
  and writes under any `.git/` are denied (`cannot copy '…/templates/hooks/commit-msg.sample' to
  '…/apps/cli/tests/.tmp-feature-test-*/.git/hooks/commit-msg.sample': Operation not permitted`),
  so it fails at setup with 0 tests executed. Environmental, unrelated to this diff. The pipeline's
  `test` hop ran it outside the sandbox: `.spur/run/1246-test-gate.log` → `11378 pass / 0 fail` across
  723 files with `apps/cli/src/commands/feature.ts` at 92.31% line coverage, which confirms this file's
  1246 identity updates.
- The 1185 stale-consumer *diagnosis* is intact — its `staleConsumerDenial` path still lives in the
  lifecycle adapter and keeps its unit coverage in
  `packages/app/tests/workflow/consumer-compat.test.ts` —
  but after this change no shipped lifecycle workflow has a nested `spur workflow run` onEnter, so
  nothing in the catalog exercises it end to end. It stays reachable through a project-layer lifecycle
  override, so it is not dead code — flagged for the 1252 consolidation sweep to decide whether it still
  earns its keep.
- `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:365` still names
  `spur workflow run feature-verification.yaml`. The docs and skills sweep is 1252's scope per this
  task's own out-of-scope list.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/feature-lifecycle.yaml:51-53`; verifying-entry E2E proves no retired workflow run is opened. |
| R2 | MET | `packages/app/src/workflow/feature-verification-run.ts:237-267`; owned-run PASS/FAIL cases and explicit-run compatibility passed in the receipt suites. |
| R3 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:63-71`; `packages/app/src/services/feature-check.ts:562-571`; verifying-entry E2E accepts the current verifier receipt. |
| R4 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:415-426`; stale-identity receipt regression passed. |
| R5 | MET | `packages/app/src/workflow/feature-verification-run.ts:311-318`; rebuilt bundle has exactly the six surviving workflows; all six validate successfully. |
| R6 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:138-146`; receipt path and persistence regression suites passed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — Entering verifying runs the feature verification pass inside feature-lifecycle | MET | test | `packages/app/tests/workflow/feature-lifecycle-verifying-entry.test.ts:201-260`; fresh focused suite passes both own-run and FAIL-denial fixtures. |
| R3 — The verification receipt names feature-lifecycle as its verifier | MET | test | `packages/app/tests/workflow/feature-verification-receipt.test.ts:540-565`; fresh receipt suite and verifying-entry E2E passed. |
| R1 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution | MET | test | `repo-wide-tests/workflow-consolidation-absence.test.ts:134-147`; six validated surviving definitions, rebuilt assets contain no retired definition. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review — 1246 (feature-lifecycle runs feature verification on verifying entry; remove feature-verification.yaml)

Dimensions: functional traceability + SECUA + architectural depth (focus all). Reviewed the working-tree diff (30 files) against R1–R6 / AC1–AC3, re-ran the targeted suites and both workspace typechecks.

## Requirement traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PASS | config/workflows/feature-lifecycle.yaml:51-53 — verifying onEnter is one `kind: shell` action `env -u __runId $spurBin feature verify $featureId --no-logo`; nested `spur workflow run` and the 0948/1147 `SPUR_WORKFLOW_RUN_ACTIVE` block deleted. E2E: packages/app/tests/workflow/feature-lifecycle-verifying-entry.test.ts:201 asserts no `feature-verification` run row on entering verifying (pass, 3.69s run below). |
| R2 | PASS | packages/app/src/workflow/feature-verification-run.ts:240 resolves the definition once; :254-265 open/finalize branch — empty runId opens a row (`workflow_name: FEATURE_VERIFIER_DEFINITION`, :191; digest/version stamped via `withRunIdentityRecording`, :180-190) and finalizes `done` after a completed pass, `failed` only when the pass cannot run (:260,:264). Explicit `--run-id` keeps caller-owned behaviour (:244-251). Unit pins: feature-verification-run.test.ts "an empty run id opens and finalizes the pass's own run row (1246 R2)" + the failed-finalize twin (pass). |
| R3 | PASS | `FEATURE_VERIFIER_DEFINITION = 'feature-lifecycle'` exported at packages/app/src/workflow/feature-verification-receipt.ts:71, re-exported packages/app/src/index.ts:1018; consumed by feature-verification-run.ts:240,331 and packages/app/src/services/feature-check.ts:562,564. E2E: entering verifying records a PASS receipt that then lets `feature update <id> done` succeed (feature-lifecycle-verifying-entry.test.ts:201). |
| R4 | PASS | Stale-identity finding at packages/app/src/workflow/feature-verification-receipt.ts:419-423 — `latest.verifier.name !== FEATURE_VERIFIER_DEFINITION` returns `reason: 'stale'` naming `spur feature verify <id>`, checked before run-row integrity (deterministic message). Test: packages/app/tests/workflow/feature-verification-receipt.test.ts:540 (pass). |
| R5 | PASS | `config/workflows/feature-verification.yaml` deleted (git status `D`); rebuilt bundle listing `apps/cli/config/workflows/` contains no feature-verification.yaml (bundle-config.ts:56 removes-then-copies, so the listing is a full regeneration). `verificationCmd` var reads removed — both sites read `DEFAULT_FEATURE_VERIFICATION_CMD = 'spur self exec check-feature'` (feature-verification-run.ts:311-316 region; feature-check.ts:571; constant at feature-verification-receipt.ts:61). |
| R6 | PASS | Receipt file names unchanged — feature-verification-receipt.ts:143-146 still `<runId>-feature-verification.{json,log,status}` / `<featureId>-feature-verification.json`. Diff touches neither packages/app/src/workflow/persist-check.ts, services/run-storage.ts, nor services/worktree-persist.ts. |

## Acceptance criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Entering verifying runs the feature verification pass inside feature-lifecycle (feature R2) | PASS | E2E test + source | packages/app/tests/workflow/feature-lifecycle-verifying-entry.test.ts:201,236 — throwaway-root fixtures: entering verifying records a PASS receipt on its own terminal-`done` `feature-lifecycle` row with null external key, no `feature-verification` row exists, and the FAIL-path fixture closes the row `done` while the done edge denies; config/workflows/feature-lifecycle.yaml:51-53. |
| AC2 — The verification receipt names feature-lifecycle as its verifier (feature R3) | PASS | unit tests + source | feature-verification-receipt.ts:71 (one constant), :419-423 (stale finding); feature-check.ts:562,564; feature-verification-run.ts:331; receipt test at feature-verification-receipt.test.ts:540. All suites green (below). |
| AC3 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution (feature R1) | PASS (task-local part) | bundle regeneration | `ls apps/cli/config/workflows/` and `ls config/workflows/` — no feature-verification.yaml; `rg feature-verification config/workflows/` → no matches. pr-review/wayfinder-resolution remain by design: 1251's scope per this task's out-of-scope list. |

## Verification re-run (this review)

- `(cd packages/app && bun test tests/workflow/{feature-lifecycle-verifying-entry,feature-verification-run,feature-verification-receipt}.test.ts)` → 39 pass / 0 fail
- `(cd packages/app && bun test tests/workflow/{workflow-resolver,feature-lifecycle-adapter,sdlc-action-workflow-defaults,replay-matrix,wrapup-pipeline,consumer-compat}.test.ts)` → 109 pass / 0 fail
- `(cd apps/cli && bun test tests/commands/feature/verify.test.ts tests/script-absorption-pr5-parity.test.ts)` → 47 pass / 0 fail
- `(cd plugins/sp && bun test tests/{feature-verification-scope,run-record-catalog}.test.ts)` → 21 pass / 0 fail
- `bun run --filter @gobing-ai/spur-app typecheck` / `--filter @gobing-ai/spur typecheck` → exit 0 / exit 0
- Full-tier gate: `.spur/run/1246-check-receipt.json` PASS (full `spur self exec check`, log `.spur/run/1246-test-gate.log`).

## Findings

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | packages/app/src/workflow/feature-verification-run.ts:162 | `db.adapter as never` x4 at packages/app/src/workflow/feature-verification-run.ts:162,:181,:182,:206 — the only `as never` casts in packages/app/src; they bridge `createMigratedDb`'s return type to `DbWorkflowPersistenceAdapter`. Typecheck-clean and isolated to the two seams, but a typed alias on the engine side would remove them. | OPEN |
| P4 | packages/app/src/workflow/feature-verification-run.ts:262 | At packages/app/src/workflow/feature-verification-run.ts:262-264, a throw from `passRun.finalize(runId, 'failed')` masks the original pass error. Leaving the row `running` on a finalize failure is the worse outcome, so the current order is defensible; a try/catch that logs-and-rethrows the original would be tidier. | OPEN |
| P4 | packages/app/tests/workflow/consumer-compat.test.ts:1 | Carried residual (declared in task Solution, not this WBS): after this change no shipped lifecycle workflow has a nested `spur workflow run` onEnter, so the 1185 `staleConsumerDenial` path keeps unit coverage at packages/app/tests/workflow/consumer-compat.test.ts:1 but no end-to-end exercise. plugins/sp/skills/sp-spur-dev/references/execution-worktree-landing.md:365 still names `feature-verification.yaml`; both routed to the 1252 sweep per this task's out-of-scope list. | DEFER(1252) |

## Notes

- feature-lifecycle.yaml:53 adds `env -u __runId` beyond the literal R1 command string — verified correct, not a deviation: verify.ts:32,42 show `--run-id` falls back to env `__runId`, so without the unset a hop from inside another run would bind the receipt to the still-`running` outer row and fail the done gate closed. The inline comment at :47-49 documents exactly this.

Confidence: MEDIUM
Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T06:38:14.818Z todo → wip (system)
- 2026-10-18T09:10:55.134Z wip → testing (system)
- 2026-10-18T09:10:57.786Z testing → done (system)

