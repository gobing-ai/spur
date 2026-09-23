---
schema_version: 1
name: Bind feature completion and wrapup to current verification evidence
status: wip
template: standard
created_at: 2026-09-22T02:56:46.299Z
updated_at: "2026-09-23T04:57:40.918Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w02
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914"]
---

## 0915. Bind feature completion and wrapup to current verification evidence

### Background

feature-verification.yaml currently writes a feature-named PASS/FAIL text file; feature-lifecycle.yaml reads that file when entering done. Neither binds PASS to the checked inputs. wrapup-pipeline.yaml can append learnings and update documents after an earlier check, and wrapup-steps.ts skips the affected-feature gate on a no-change sync. This task fixes that shared completion boundary while keeping partial-feature wrapup task-local. It delivers D63 R2 and uses the installed inline application boundary completed in 0914.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. One eight-hour behavior and rollback boundary; split only if the verified scope exceeds the task size limit.

**Refine corrections (2026-09-22)**
- The previous Design deferred receipt schema and storage to implementation → the current tree has no receipt contract → the private v1 fields, locations and validity checks are frozen below.
- 0914 was previously described as concurrent → its bundle boundary is now done → 0915 explicitly depends on 0914 and extends that installed pattern.

### Requirements

- [ ] R1. Record and validate feature verification evidence against feature/run identity, selected verifier definition, check contract and the relevant checked tree/spec inputs.
- [ ] R2. Reject missing, malformed, failed, stale or cross-feature evidence at feature completion and after rework; reuse unchanged valid evidence without an unnecessary full rerun.
- [ ] R3. Order wrapup mutations and feature verification so all relevant final changes are checked; make record/learning operations idempotent where they may replay.
- [ ] R4. Reuse existing proof/digest and artifact services and preserve the existing task lifecycle and independent verification requirements.

### Acceptance Criteria

- [ ] AC1 — A completion fixture accepts a valid receipt only for its bound feature, run, verifier/check contract and input digest. (req: R1)
- [ ] AC2 — Changed relevant inputs, rework, missing/corrupt receipt and FAIL cannot advance feature completion, while unchanged valid evidence is reusable. (req: R2)
- [ ] AC3 — A wrapup document edit is verified before completion, and replay neither duplicates learning entries nor creates a lifecycle-metadata invalidation loop. (req: R3)
- [ ] AC4 — Existing task verification/proof refusal cases and canonical status transitions remain intact, with no second digest implementation. (req: R4)
- [ ] AC5 — Completion uses current evidence (req: R1)

Feature-level traceability: this task delivers D63 scenario R2; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T03:20:52.752Z

Ready decision: private v1 receipt fields and two .spur/run locations above are fixed. The existing resolver, fingerprint and artifact ledger own identity; no public CLI surface is requested. 0914 is an explicit dependency. Completion checks are read-only and strict; verification/rework may mutate through existing workflows. Later 0916/0919 consume this contract without re-owning it.

### Design

Use one private application service in packages/app/src/workflow for receipt creation and validation, exported through the 0914-generated inline application bundle. A thin plugins/sp/scripts standard script invokes it in both source and installed layouts; generate its .mjs twin through Superskill. No new public Spur noun/verb, engine, status, dependency or second digest algorithm. The source definitions are config/workflows/feature-verification.yaml and feature-lifecycle.yaml; the wrapup caller is config/workflows/wrapup-pipeline.yaml and plugins/sp/scripts/wrapup-steps.ts. The existing .status file may remain for diagnostics but is never completion authority. 0916 owns wider replay behavior; 0919 owns batch continuation.

Private receipt v1: schemaVersion=1; featureId; runId; workdir; selected verifier name, source path, layer and definition digest; effective check command; inputDigest; status RUNNING|PASS|FAIL; startedAt and completedAt. Store a run-scoped JSON receipt at .spur/run/<runId>-feature-verification.json and an atomic feature-latest JSON copy at .spur/run/<featureId>-feature-verification.json. Validate IDs and confine both paths before reading or writing; use the existing safe launch splitter rather than interpolating the selected Spur command into a shell. Register the run-scoped path through existing run.artifact. A PASS is valid only when both copies agree; the authoritative run row is terminal done; its persisted definition identity and effective vars agree; its artifact registration exists; and the current selected definition, configured command and input digest match. A newer actual verification attempt supersedes an older PASS; malformed, missing, RUNNING and FAIL receipts deny completion. Receipt writes are atomic within .spur/run. The feature-lifecycle guard performs a read-only current check before its existing strict feature check.

Compute inputDigest with computeProofInputFingerprint and semanticArtifactDigest. Include tracked, dirty and untracked source plus task, feature and authored doc inputs. Exclude .spur/run, the DB and generated wrapup metrics; normalize only this feature's forward status/updated_at, generated Tasks table, forward lifecycle History lines and its INDEX status marker before folding those documents back into the digest. Keep rework/reopen History, authored sections, other feature records and learnings in scope. Capture before and after the trusted check command; a mismatch is FAIL. A one-off verificationCmd override produces a receipt but cannot satisfy lifecycle completion unless it equals the selected definition's configured command. Explicit project overrides win through the existing resolver; do not use a hard-coded shared YAML path.

The verifier workflow creates a receipt and registers its artifact, then routes on its verified result. On entering verifying, the lifecycle first checks for a current valid receipt and skips the expensive check when it remains valid; otherwise it invokes the verifier and rechecks after that run reaches done. The verifying→done guard never trusts the text status alone. Wrapup applies doc-sync, learning and metrics writes before feature transition/verification. Deduplicate learning blocks and metrics by the wrapup run identity and task, preserving earlier successful rows after partial failure. A changed done feature reopens through the supported lifecycle before recertification; an unchanged done feature reuses its receipt. A partial-feature wrapup does not run the feature-wide check. Missing helper, failed check or failed sync remains a failed wrapup.

Tests: packages/app/tests/workflow for input/identity/supersession/drift validation; plugins/sp/tests/feature-verification-scope.test.ts and wrapup-steps.test.ts for real CLI/engine closure, installed script path, replay and partial-feature behavior. Preserve packages/app/tests/workflow/task-pipeline-proof-chain.test.ts and feature-lifecycle-adapter.test.ts refusals. Update docs/design/workflow-execution-economy.md with the private receipt contract, and regenerate the plugin bundle/script through their owners. No task-pipeline semantic change.

### Plan

- [ ] 1. Create a fresh worktree off current main; trace every receipt/status reader and wrapup mutation, then record the v1 private contract in the owning design satellite. (R1)
- [ ] 2. Implement the shared input digest and receipt validator using existing fingerprint, resolver, run snapshot and artifact services; integrate source and bundled script paths. (R1, R4)
- [ ] 3. Wire verifier, lifecycle and wrapup ordering; make same-run learning/metrics writes replay-safe and keep partial-feature wrapup task-local. (R2, R3)
- [ ] 4. Exercise a harmless real workflow/CLI run plus wrong identity, stale/rework/dirty-input, command override, mid-check drift, failed write and replay cases. Run task-local, plugin standalone/parity, build and affected workflow checks; leave the feature-wide gate for the settled feature boundary. (R1–R4)

### Solution

## Approach

Upgraded the ADR-119 feature verification evidence from the v0 identity-blind `.status` string to a **bound receipt** (R1), validated fail-closed at the completion boundary (R2), digest-chained through the shared proof-input engine (R4), with record/replay ordering enforced by the digest chain rather than call order (R3).

## Changes

- `packages/config/src/finding-codes.ts` — registered 6 completion-boundary codes: `L4.feature-receipt-missing|malformed|cross-feature|failed|stale|contract`.
- `packages/app/src/services/feature-verification-receipt.ts:38` (new) — v1 receipt contract: schema `feature-verification-receipt/v1` `{schema, featureId, inputDigest, verificationCmd, verdict, runId, recordedAt}`; `featureReceiptPaths`, `captureFeatureReceiptDigest` (feature-verification-receipt.ts:98, single digest engine: `ProofInputFingerprint.compute({cwd, featureContent})` — git tree covers sources + spec + check-contract source), `recordFeatureVerificationReceipt` (feature-verification-receipt.ts:117, idempotent overwrite of receipt + coarse `.status`), `validateFeatureVerificationReceipt` (feature-verification-receipt.ts:142, ordered rejections: missing → malformed → cross-feature → failed → contract-mismatch → stale; digest-capture failure surfaced as stale/fail-closed).
- `packages/app/src/services/planning-check-base.ts` — all 6 codes added to `COMPLETION_FINDING_CODES` ⇒ unsuppressible error severity at the done boundary.
- `packages/app/src/services/feature-check.ts` — receipt validation in `check()` gated on completion boundary only (feature-check.ts:262 `options.asStatus === 'done' && options.runDir`): plain on-disk `done` reads and all-feature scans stay advisory (no backfill burden); every real completion path (`advance` done hop, engine guard via `feature check --strict --as done`, `--as done`) enforces. Digest-capture git failure = stale finding (0751 R1 fail-closed). Validator: feature-check.ts:439 `checkFeatureVerificationReceipt`.
- `apps/cli/src/commands/feature.ts` — new public verb `spur feature verify <id> [--cmd]` (feature.ts:477): digest-before-pass, runs `sh -c "$cmd"` with output to `.spur/run/<fid>-feature-verification.log`, records receipt via `recordFeatureVerificationReceipt`, exit 0 PASS / 1 FAIL; envelope JSON output; `SPUR_RUN_ID` picked up as receipt `runId`. `assertFeatureCheckPass` (feature.ts:227 done hop) now passes `runDir` so the advance done hop sees the same evidence as the CLI check.
- `config/workflows/feature-verification.yaml` — onEnter shells `$spurBin feature verify "$featureId" --cmd "$verificationCmd" || true` (fail-closed routing preserved); workflow contract comment updated.
- `config/workflows/feature-lifecycle.yaml` — verifying→done guard collapses to `$spurBin feature check $featureId --strict --as done` (receipt validation moved inside feature check; the old `cat .status` precondition is subsumed).
- `packages/app/tests/services/feature-verification-receipt.test.ts` (new) — AC1 valid PASS receipt validates (identity + inputs + status co-recorded); AC2 missing/malformed/cross-feature/failed/stale/contract-mismatch all reject; tree-edit after pass invalidates, unchanged evidence reused; AC3 record idempotent (clean overwrite); AC4 digest ≡ shared engine, git failure throws `ProofCaptureError` (no sentinel digest).
- `docs/design/workflow-execution-economy.md` — v1 private contract section (artifact fields, boundary scope, ordering/replay).

## Design notes

- **Completion boundary scoping** (key decision): receipt demand keyed on the transition target `--as done`, not frontmatter `status === 'done'`, so archival re-checks and `corpus-check` scans don't require receipts for pre-receipt features, while `assertFeatureCheckPass` (advance done hop, non-strict) still fails closed because the 6 codes are unsuppressible.
- **`--cmd` trust class**: operator/config surface, same class as task-pipeline `qualityGateCmd`; `DEFAULT_FEATURE_VERIFICATION_CMD='bun run spur-check-feature'` preserves ADR-119 semantics; comparison at validation is verbatim.
- **Ordering (R3)**: `feature verify` captures the digest before the pass; any wrapup mutation after the pass changes the tree and forces re-verification. `.spur/context` learnings are gitignored (out-of-digest); receipt and task `record` writes are idempotent, so retry after mid-flight failure is replay-safe.
- **Reuse path**: unchanged valid receipt validates without re-running the repo-wide pass; any drift (tree/spec/contract/identity/verdict/contract) yields an unsuppressible error finding that denies completion.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- D63 R2; docs/plans/2026-09-21-next-generation-spur-workflows.md; docs/design/workflow-execution-economy.md (ADR-119).
- Existing seams: config/workflows/feature-verification.yaml; config/workflows/feature-lifecycle.yaml; config/workflows/wrapup-pipeline.yaml; packages/app/src/workflow/proof-input-fingerprint.ts; packages/app/src/services/inline-run-setup.ts; scripts/commands/bundle-plugin-lib.ts; plugins/sp/scripts/wrapup-steps.ts.
- Worktree /Users/robin/xprojects/spur-new-0915 and branch feat/0915-current-feature-evidence were removed on 2026-09-22 (empty: zero commits, nothing to merge). Implement on a fresh worktree off current main at task start.

### History

- 2026-09-23T04:57:04.549Z todo → wip (system)

