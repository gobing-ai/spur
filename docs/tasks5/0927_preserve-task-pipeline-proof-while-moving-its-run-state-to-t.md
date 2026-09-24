---
schema_version: 1
name: Preserve task-pipeline proof while moving its run state to the pair
status: done
template: feature-impl
created_at: 2026-09-23T05:09:42.308Z
updated_at: "2026-09-24T07:06:24.105Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - task-pipeline
estimate_hours: 8

dependencies: ["0926"]
---

## 0927. Preserve task-pipeline proof while moving its run state to the pair

### Background

Covers E7 R4 and reinforces R2 for the highest-risk canonical workflow. `task-pipeline.yaml`, its installed inline driver, and task proof consumers currently use multiple `.spur/run` sidecars. Depends on the writer and recovery/legacy-reader tasks; D63 task 0921 is inherited through that chain. Rubric: E8 D1 L3 C2 R2 = 16; split because task proof and installed-plugin parity need one focused high-risk review.

### Requirements

- [x] R1. Migrate only task-pipeline-owned run state and run-log sidecars to the pair; keep WBS-keyed verdict, proof, and gate evidence at their independent authoritative paths.
- [x] R2. Preserve precheck, quality, review, verify, record, terminal closure, and safe resume decisions against the same current-input digest.
- [x] R3. Prove source and bundle-only installed execution produce the same run identity and record behavior, including a project override.
- [x] R4. Remove an old run-record sidecar only after its last declared reader is migrated, with a test that fails if a consumer still expects it.

### Acceptance Criteria

- [x] AC1 — Current callers survive the storage migration (req: R1)
  Given task-pipeline's post-D63 run-directory writer/reader inventory
  When source and installed inline or subprocess execution reaches terminal status or resumes after interruption
  Then record-owned data uses the shared pair and every task-proof consumer still reads its authoritative evidence
  And an obsolete sidecar is retired only after a test proves no declared consumer needs it
  Verify with task-pipeline and plugin smoke fixtures, including a project override and a real current-input digest.

- [x] AC2 — Recording preserves privacy and current proof (req: R2)
  Given a canary secret and a task whose proof is bound to the current input and definition digest
  When task-pipeline records and inspects a run
  Then the canary is absent from the pair and the current-input, `run.artifact`, verdict, and DB trace checks still control completion
  Verify via installed-plugin execution and task proof integration checks without mocking the record or proof readers.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: consume 0926's pair reader and 0925's writer, after D63 task 0921 finalizes workflow identity and installed/source resolution. Re-inventory the task-pipeline sources before editing because D63 is active in another worktree.
- Ownership test: classify each `task-pipeline.yaml`, inline-driver, and plugin-script artifact by its live readers and authority. Move only run-record-owned log/state data. WBS-keyed verdicts, current-input digest receipts, `run.artifact` ledger entries, transition/gate evidence, and session checkpoints remain independent even when they reside under `.spur/run`.
- Run identity: use the engine/inline setup's authoritative `__runId` and definition digest; preserve the existing project override precedence. Use the shared pair seam, with temporary legacy dual-read only while a declared consumer remains. Retire an obsolete sidecar only after its last reader and source/installed fixture are updated.
- Primary targets: `config/workflows/task-pipeline.yaml`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/scripts/inline-run-setup.ts`, directly related plugin scripts and tests. 0928 owns other canonical YAML; 0929 owns Board reads. No new public CLI/API.
- Anti-patterns: no global `.spur/run` filename rewrite, no verdict-to-state flattening, no D63 graph redesign, and no simulated installed parity that bypasses bundled plugin resolution.

### Plan

1. Re-inventory task-pipeline and plugin-script sidecars after D63; mark independent proof versus migratable run state.
2. Switch each run-state producer/consumer to the shared pair in dependency order, retaining temporary dual-read where needed.
3. Exercise source and installed inline/subprocess paths, current-input proof, interrupted resume, and project override behavior.
4. Update the owning workflow/plugin contract and retire only proven-unread run-record sidecars.

### Solution

R1 — inline/plugin drivers now produce the shared two-file record: `plugins/sp/scripts/inline-run-setup.ts:41` (and its regenerated bundled twin `inline-run-setup.mjs`) writes `.spur/run/<runId>.state.json` (schemaVersion 1, atomic temp+rename; identity fields workflowName/status/attached/workflowVersion/resolvedPath/layer/definitionDigest, startedAt preserved on re-setup) plus a one-line run-start header in `.spur/run/<runId>.md`; trace failure lines append to the same `.md`. R2 — same-digest re-setup reattaches and the `.md` keeps exactly one header. R3 — installed (bundle-only) parity extended with a project-layer override scenario: the source CLI resolves `<project>/.spur/workflows/installed-smoke.yaml` (layer project, distinct digest) and the Node twin records the identical identity shape in the pair. R4 — the `-inline-setup.json` sidecar and driver `.log` writes are retired; the legacy `.log` is read-only fallback for pre-0927 runs via `readWorkflowRunRecord` (`packages/app/src/services/workflow-service.ts:2515`), and the last declared reader, `AgentService.resolveArtifactRefs` (`packages/app/src/services/agent-service.ts:2551`), now reads the seam (pair → `.md` ref, legacy → `.log` ref, none → no ref; ref paths stay project-relative). task-pipeline.yaml is deliberately unchanged: its YAML action outputs and WBS-keyed verdict/gate evidence are live run-scoped workflow data with existing readers; migrating them would need a new public API (0926 deferred). `-idea-*` idea-pipeline driver artifacts are 0928 scope.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AC-4 | MET | Task R1+R3+R4 — task-pipeline run state moved to the pair while WBS-keyed proof stays independent: `plugins/sp/scripts/inline-run-setup.ts:186-235` (`writeOutcome` writes `<runId>.state.json` via temp+rename, retired `<run-id>-inline-setup.json` not written); `packages/app/src/services/agent-service.ts:2551-2562` (`resolveArtifactRefs` reads through the shared record seam, legacy `.log` ref in place); source/installed parity + project override: `plugins/sp/tests/inline-run-setup.test.ts`, `inline-run-installed.test.ts`, `inline-run-trace.test.ts` 16/16 pass this run (installed twin records identical identity shape; project-layer override produces same record behavior; retired sidecars absent on both paths); `packages/app/tests/services/agent-service.test.ts:3270` "artifact refs read the run-record pair, legacy log in place, none when missing" pass this run |
| AC-2 | MET | Task R2 — proof gates preserved against the same current-input digest: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:91-93,266-271` (run/definition identity agreement gate reads the pair state; verdict `proof.runId`/`proof.definitionDigest` must agree); canary `SPUR-CANARY-0927` absent from both pair files: `plugins/sp/tests/inline-run-setup.test.ts:113-177` pass this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Current callers survive the storage migration | MET | test | `plugins/sp/tests/inline-run-setup.test.ts` + `inline-run-installed.test.ts` + `inline-run-trace.test.ts` 16/16 pass this run; `packages/app/tests/services/agent-service.test.ts:3270` pass this run |
| AC2 — Recording preserves privacy and current proof | MET | test | `plugins/sp/tests/inline-run-setup.test.ts:166-173` canary + retired-sidecar assertions pass this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0926](0926_continue-and-inspect-legacy-workflow-runs-with-stable-identi.md); hands the installed/plugin seam to [0928](0928_move-the-remaining-canonical-workflows-to-the-run-record.md). D63 final inventory is owned by [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md).
- D63 is active in a separate worktree at refinement time. Recheck the merged YAML, inline driver, plugin bundle, and 0925–0926 contracts before implementation.

### History

- 2026-09-24T04:08:31.384Z todo → wip (system)
- 2026-09-24T04:56:42.072Z wip → testing (system)
- 2026-09-24T04:56:44.028Z testing → done (system)

