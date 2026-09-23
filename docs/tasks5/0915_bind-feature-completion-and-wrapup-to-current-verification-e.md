---
schema_version: 1
name: Bind feature completion and wrapup to current verification evidence
status: todo
template: standard
created_at: 2026-09-22T02:56:46.299Z
updated_at: "2026-09-23T03:24:02.177Z"
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

- [ ] 1. Rebase the clean 0915 worktree onto current main; trace every receipt/status reader and wrapup mutation, then record the v1 private contract in the owning design satellite. (R1)
- [ ] 2. Implement the shared input digest and receipt validator using existing fingerprint, resolver, run snapshot and artifact services; integrate source and bundled script paths. (R1, R4)
- [ ] 3. Wire verifier, lifecycle and wrapup ordering; make same-run learning/metrics writes replay-safe and keep partial-feature wrapup task-local. (R2, R3)
- [ ] 4. Exercise a harmless real workflow/CLI run plus wrong identity, stale/rework/dirty-input, command override, mid-check drift, failed write and replay cases. Run task-local, plugin standalone/parity, build and affected workflow checks; leave the feature-wide gate for the settled feature boundary. (R1–R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- D63 R2; docs/plans/2026-09-21-next-generation-spur-workflows.md; docs/design/workflow-execution-economy.md (ADR-119).
- Existing seams: config/workflows/feature-verification.yaml; config/workflows/feature-lifecycle.yaml; config/workflows/wrapup-pipeline.yaml; packages/app/src/workflow/proof-input-fingerprint.ts; packages/app/src/services/inline-run-setup.ts; scripts/commands/bundle-plugin-lib.ts; plugins/sp/scripts/wrapup-steps.ts.
- Current worktree: /Users/robin/xprojects/spur-new-0915 is clean but based on 676a405b; the coding agent must rebase onto the planning commit before work. No other wip task or worktree was found at refinement.

### History
