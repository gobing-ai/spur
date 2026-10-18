---
schema_version: 1
name: feature-lifecycle runs feature verification on verifying entry; remove feature-verification.yaml
status: todo
template: feature-impl
created_at: 2026-10-18T05:10:06.867Z
updated_at: "2026-10-18T05:53:33.594Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - feature-lifecycle
  - breaking

estimate_hours: 8
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

- [ ] R1. feature-lifecycle `verifying` onEnter is one shell action running `$spurBin feature verify $featureId --no-logo`; no nested `spur workflow run`, no `env -u SPUR_WORKFLOW_RUN_ACTIVE`. Observable: entering verifying on a fixture feature starts no `feature-verification` run row.
- [ ] R2. `spur feature verify <id>` without `--run-id` opens its own run row (workflow `feature-lifecycle`, metadata definition digest of the resolved feature-lifecycle definition), records the receipt against it and finalizes the row `done` once the pass completes (PASS or FAIL). An explicit `--run-id` keeps today's behaviour.
- [ ] R3. The verifier identity name comes from one exported constant `FEATURE_VERIFIER_DEFINITION = 'feature-lifecycle'`, used by feature-verification-run.ts and feature-check.ts; a PASS receipt from R1 lets `feature check <id> --strict --as done` pass.
- [ ] R4. A feature-latest receipt whose verifier name is `feature-verification` fails `feature check <id> --strict --as done` as stale, and the message names `spur feature verify <id>`.
- [ ] R5. config/workflows/feature-verification.yaml is deleted and absent from the rebuilt apps/cli/config bundle; the `verificationCmd` var is dropped and `spur feature verify` still runs `spur self exec check-feature`.
- [ ] R6. Receipt file names and the persist-check, run-storage and worktree-persist families are unchanged.

Out of scope: pr-review and wayfinder-resolution deletion (1251); feature sync auto-advance (1247); wrapup feature writes (1249); doc and CHANGELOG sweep (1252); engine wildcard `from` (1253).

### Acceptance Criteria

- [ ] AC1 — Entering verifying runs the feature verification pass inside feature-lifecycle (req: R1, R2)
- [ ] AC2 — The verification receipt names feature-lifecycle as its verifier (req: R3, R4)
- [ ] AC3 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution (req: R5, R6)

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

- [ ] 1. Failing E2E (R1, R2): a fixture feature with all tasks done; `spur feature update <id> verifying` records a receipt whose run row is `done` under `feature-lifecycle`, and no `feature-verification` run row exists.
- [ ] 2. Failing tests (R3, R4): a PASS receipt from step 1 passes `feature check --strict --as done`; a receipt with verifier name `feature-verification` fails as stale and names `spur feature verify <id>`.
- [ ] 3. Add `FEATURE_VERIFIER_DEFINITION`, switch both resolution sites and add the stale-identity finding (R3, R4).
- [ ] 4. Open and finalize the pass's own run row when `runId` is empty (R2).
- [ ] 5. Replace the verifying onEnter with the direct shell call (R1).
- [ ] 6. Delete feature-verification.yaml, drop `verificationCmd`, rebuild the bundle and update the tests listed in Design (R5, R6).
- [ ] 7. Run targeted tests in packages/app, apps/cli and plugins/sp, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

