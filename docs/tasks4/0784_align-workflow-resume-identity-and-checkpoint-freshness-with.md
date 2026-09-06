---
schema_version: 1
name: "Align workflow resume identity and checkpoint freshness with persisted runs"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.363Z
updated_at: "2026-09-06T19:04:01.317Z"
feature_id: D6
priority: P1
dependencies: ["0782", "0783"]
---

## 0784. Align workflow resume identity and checkpoint freshness with persisted runs

### Background
Audit 0781 F-05 is confirmed in WorkflowService.continuePaused: it resolves row.workflow_name, not the original explicit source; validateResumeCheckpointFreshness compares canonical pending/running against engine paused and calls checkpointStaleness without sourceCommit or a workdir-rooted probe. The resolver returns path/workflow/digest/layer, and RunDao.stampRunIdentity currently atomically writes only digest/version. FileSystem.realPath exists in the installed runtime. Three terminal writers (feature-dev, wrapup, idea) emit ignored one-line pseudo-checkpoints; task-pipeline's canonical writer quotes artifact variables literally. These are current source facts, not a request for a new checkpoint engine.
### Requirements
- [ ] R1. Atomically retain resolved launch source and workdir with existing run identity before actions execute; resume exactly that existing source, including arbitrary filenames and bundled launches. Never fall back to another same-named file when a recorded source is missing. Preserve unrelated metadata and immutable launch digest/version on attachment and resume.
- [ ] R2. Preserve legacy name-only resolution for rows with no source metadata, with explicit degraded-identity diagnostics. Definition drift still requires the existing explicit consent path. After consent, runtime proof vars and diagnostics identify the actual resumed definition while original launch identity remains unchanged; mixed-definition execution must not masquerade as single-definition verified evidence.
- [ ] R3. For checkpoints associated with a paused run, accept pending/running/approved as nonterminal projections, then validate workflow/WBS ownership, current HEAD and workdir-resolved artifact existence. Missing or invalid required freshness evidence and stale inputs fail with a named reason; no checkpoint remains a supported engine-only resume path.
- [ ] R4. Remove the three noncanonical terminal pseudo-checkpoint writes and correct the existing task-pipeline terminal writer's run-ID/artifact expansion. Preserve existing malformed files during cleanup and do not add new checkpoint cadence, status vocabulary or a second store.
- [ ] R5. Demonstrate real local engine pause/resume in isolated DB and temporary Git fixtures: arbitrary source filename, different ambient cwd, bundled-source pinning, stale HEAD/artifact, legacy row, refused drift and consented drift. No live application runs may be used or mutated.
### Acceptance Criteria
```gherkin
Feature: Reliable workflow resume
  Scenario: R1 — Explicit-path runs resume the launched definition
    Given a paused run launched from an arbitrary filename
    When it resumes without source drift
    Then its original definition is found and resumed
    And altered definitions require explicit consent
    And a missing recorded source cannot silently resolve a same-named replacement
    And consented resume preserves launch identity and reports the executed identity
  Scenario: R2 — Checkpoint freshness respects run state and workdir
    Given a valid paused checkpoint with unchanged HEAD and existing workdir-relative artifacts
    When resume is requested from another ambient directory
    Then the checkpoint is accepted
    And stale HEAD or missing artifacts are rejected with a named reason
    And malformed checkpoint files remain preserved by cleanup
```

Verify from packages/app: bun test tests/services/workflow-service.test.ts tests/workflow/workflow-resolver.test.ts tests/workflow/checkpoint-contract.test.ts. Extend packages/domain/tests/dao/run-dao-identity.test.ts and the existing CLI workflow/version fixtures for persisted identity and compatibility. Tests use the actual engine with deterministic actions, not model runs.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T19:04:00.399Z

- Source pinning: preserve the resolved path/layer, not just requested name or basename. A deleted source requires operator repair/new run; no silent fallback.
- Missing checkpoint: valid engine-only resume. Existing associated checkpoint with stale/insufficient evidence: named refusal.
- State mapping: pending/running/approved are accepted advisory projections of a paused engine; no new paused checkpoint enum.
- Consented definition drift: execute with the actual digest and warn; keep immutable original identity, do not manufacture uniform historical provenance.
- Checkpoint frequency: remove redundant ignored terminal files; do not add a checkpoint at every state or a new journaling subsystem.
- Internal metadata extension implements existing identity obligations; no new cross-cutting storage or operator taste decision remains.
### Design
#### Frozen design
Extend existing run metadata and resolver inputs, not the engine or checkpoint storage. The metadata option wins over reconstructing filenames from workflow_name because explicit-path launch already exposes the correct resolved path.

Internal metadata names: definitionSource = { path, layer, workdir }, where path/workdir are absolute and layer is the resolver's existing project|bundled value (no invented global layer). Add an optional source argument to RunDao.stampRunIdentity and pass it from WorkflowRunIdentity through the existing creation decorator in the same json_set statement as definitionDigest/workflowVersion. All new application workflow launches supply it; null workflowVersion must remain a present JSON null. Preserve identity on createOrAttachRun when attaching an already stamped run; never overwrite the original identity with today's definition. The installed WorkflowPersistenceAdapter.createOrAttachRun returns WorkflowRunRecord, not a created flag. Query RunDao.traceRowById(record.id) before attachment; stamp only a genuinely new row, and retain existing identity/legacy absence for attachments. Keep the DAO identity merge conditional against overwriting an already stamped digest.

Resume loads metadata first. With valid definitionSource, verify its file still exists before invoking the resolver, and require resolution to the recorded absolute path; the general resolver's basename fallback must not substitute another file. Use its recorded workdir for extension loading context, checkpoint artifacts and engine.resumeRun. Without the source field, retain legacy name lookup from ctx.cwd and emit an explicit legacy warning; malformed present source metadata fails rather than becoming legacy.

Keep public result definitionDigest/version as launch identity for compatibility. On consented drift, merge resumeDefinitionDigest and resumeWorkflowVersion into metadata, override __definitionDigest in effective resume vars with the actually resolved digest, and emit an existing warnings entry naming both identities. On an unchanged subsequent resume, clear stale resume metadata if needed so diagnostics are truthful. Do not change the verified-outcome policy to count a mixed-definition run as a clean single-definition run; the differing actual proof stamp must remain visible. No new public flags/DTO or schema migration.

Checkpoint mapping is consumer-local, not a new persisted enum: paused run accepts pending/running/approved checkpoint state; terminal, missing or unknown checkpoint status rejects when the checkpoint belongs to this run. Existing engine-only resume with no checkpoint remains valid. Obtain current HEAD through the configured ProcessExecutor with cwd=launch workdir, check exit, and pass sourceCommit/taskWbs plus an artifactExists probe resolving relative paths under that workdir to checkpointStaleness. Missing/unreadable Git freshness when an associated checkpoint requires it is a refusal, not an empty-string fallback. Do not trust ambient process.cwd. Keep the parser/cleanup preservation contract; do not delete malformed files or tighten unrelated historical parsing as a drive-by change.

Delete only the obsolete one-line terminal write actions in feature-dev.yaml, wrapup-pipeline.yaml and idea-pipeline.yaml; retained persisted run state already records those terminal outcomes. Fix task-pipeline's existing canonical terminal writer to use __runId and expanded, YAML-safe artifact paths, preserving its terminal-only cadence. Update canonical cross-cutting checkpoint guidance to distinguish engine state from advisory checkpoint status and remove claims about nonexistent writer cadence.

Owners: packages/app/src/services/workflow-service.ts; packages/app/src/workflow/checkpoint-contract.ts; packages/domain/src/dao/run-dao.ts; the four named workflow definitions and focused tests; plugins/sp/skills/spur-dev/references/cross-cutting.md; docs/04_DESIGN.md and docs/design/workflow-observability.md. Increment changed workflow versions from their then-current value, not a hardcoded reset.

Dependencies: 0782 and 0783 deliver the final feature/wrapup graphs first; retain their simplified routes and normalized inputs. 0785 consumes preserved launch identity plus resumeDefinitionDigest for proof binding and must not restore old stamps. 0786 validates final canonical guidance. No new public noun/verb, dependency, engine, registry, cache, baseline, blanket strictness, fast-route activation, live-run mutation, external review request, host installation, or release. Workflow/source changes below are the implementation handoff, not actions performed by refine.

Execution budget: one owned task at a time; checkpoint after 45 minutes or two unsuccessful fix iterations in .spur/run/0784-execution-notes.md, preserving focused logs. Reproduce with targeted workspace tests before the single final project gate. requireDiff: source/tests for runtime tasks, canonical docs/tests for 0786; no fabricated source edit for refinement. Refinement itself changes planning sections only.
### Plan
- [ ] R1/R2: add failing engine pause/resume and DAO metadata tests, including same-name alternate files and attached-run identity preservation.
- [ ] R1/R2: extend atomic identity recording, pin exact resume source/workdir, retain legacy diagnostics, and distinguish consented execution identity.
- [ ] R3: map checkpoint states at the resume consumer; supply checked HEAD/WBS/workdir artifact probes and test missing/stale/valid checkpoints.
- [ ] R4: after 0782/0783, remove only obsolete pseudo-writers; fix canonical terminal interpolation and update its guidance/behavior tests.
- [ ] R5: run focused domain/app/CLI consumer tests and type checks; rebuild changed bundles and run the final project gate. Record actual engine fixture results, not real-model cost claims.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-05; task 0752 R5 and task 0768 identity obligations.
- docs/00_ADR.md — ADR-070, ADR-099, ADR-108.
- packages/app/src/workflow/workflow-resolver.ts — ResolvedWorkflowDefinition and explicit-path fallback behavior.
- packages/domain/src/dao/run-dao.ts — stampRunIdentity; packages/app/src/services/verified-outcome.ts — single-definition evidence policy.
- Dependencies 0782/0783; downstream 0785/0786.
### History
