---
schema_version: 1
name: Persist redacted two-file workflow records for new runs
status: done
template: feature-impl
created_at: 2026-09-23T05:09:42.304Z
updated_at: "2026-09-24T04:03:45.334Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - storage
estimate_hours: 8

dependencies: ["0921"]
---

## 0925. Persist redacted two-file workflow records for new runs

### Background

Covers E7 R1, R2 and R7. Current `WorkflowRunLogSink` writes `.spur/run/<runId>.log`; `WorkflowAppService.cleanRunLogs()` filters `.log` files. Workflow DB trace, explicit trace-file output, and task verdicts have different owners. D63 task 0921 must finish first so this migration starts from its final execution contract. Rubric: E8 D1 L2 C1 R2 = 14; persistence and redaction have a distinct high-risk review boundary.

**Refine corrections (2026-09-22)**
- Original Design said "create files atomically" → the accepted contract and current sink require an append-only markdown log, while only JSON state is atomically replaced → Design now distinguishes their write modes.
- Original Design relied on extending an already-redacted event stream → the current sink assumes upstream redaction and appends event text directly → require a canary-tested persistence-boundary redaction pass.

### Requirements

- [x] R1. Write one redacted append-only `<runId>.md` and one schema-versioned, atomically replaced `<runId>.state.json` for logging-enabled new workflow runs.
- [x] R2. Key both files to the authoritative run ID and preserve workflow DB trace, `run.artifact` metadata, task/feature verdicts, and explicit trace-file output as independent owners.
- [x] R3. Ensure a canary secret in input, output, and error text is absent from both persisted files and read projections; never use the log as completion proof.
- [x] R4. Keep pair files out of the existing `.log` cleanup until a pair-retention policy is selected, while preserving the current `.log` behavior.

### Acceptance Criteria

- [x] AC1 — A logging-enabled run writes one canonical two-file record (req: R1)
  Given a source or bundled CLI workflow run with logging enabled and an authoritative run ID
  When the workflow starts, emits progress, and reaches a terminal trace status
  Then only `<runId>.md` is appended for its human run log and `<runId>.state.json` is atomically replaced for its machine state
  And the two files use the same run ID without replacing DB trace or independent evidence
  Verify in `packages/app/tests/observability/workflow-run-log-sink.test.ts` and `apps/cli/tests/commands/workflow.test.ts` using real file writes and the workflow service.

- [x] AC2 — Recording preserves privacy and current proof (req: R3)
  Given a configured canary secret in an input, agent output, and error event
  When a run persists and reads its record
  Then the canary is absent from both files and every supported read projection
  And a persisted log alone cannot establish completion or replace task/feature verdicts
  Verify at the application persistence boundary with a real temporary run directory; do not mock the redactor or file writer.

- [x] AC3 — New record files are not silently reclaimed (req: R4)
  Given an old terminal pair and an eligible legacy `.log`
  When `workflow clean --logs` runs in dry-run and apply modes before a pair-retention policy exists
  Then only the eligible `.log` is reported or deleted and both pair files remain
  Verify in the workflow-service cleanup test against a real temporary run directory.

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Design

- Scope: replace the existing `WorkflowRunLogSink` `.log` writer for newly logged source and bundled CLI runs. Task 0927 owns the separate host-inline driver and plugin scripts; this task does not migrate their sidecars.
- Format: `.spur/run/<runId>.md` is an append-only, size-bounded, redacted human log. `.spur/run/<runId>.state.json` is a schema-versioned machine projection written through a temp file and same-directory rename. Only the JSON replacement is atomic. The run ID comes from the workflow run, never from an output string or user path.
- Authority and ordering: DB trace/run status controls lifecycle and completion; state summarizes that status and must not claim a newer or stronger result than the trace. Keep `run.artifact`, task/feature verdicts, explicit `.spur/workflow/` trace-file output, and configured project overrides at their owners. Define the minimal private state fields and status mapping against the post-0921 engine shape before coding; no new public CLI verb or API is part of this task.
- Privacy: apply configured-secret redaction at the persistence boundary to every input, output, error, preview, and steering text field before either file is written. Existing upstream redaction is useful but cannot be the only protection; a real-file canary test must cover the sink. Preserve visible truncation and current best-effort logging failure behavior without treating a failed write as proof of success.
- Retention: `WorkflowAppService.cleanRunLogs()` currently filters `.log` names; keep that behavior. Do not add pair GC or apply `workflow.logRetentionDays` to the pair before an operator policy decision.
- Primary targets: `packages/app/src/observability/workflow-run-log-sink.ts`, the adjacent workflow application boundary, `apps/cli/src/commands/workflow.ts` for normal run wiring, and their existing tests. The next task, 0926, receives the pair format and reader contract; 0927 receives inline/plugin ownership.
- Anti-patterns: no second event store, raw prompt/output persistence, task-verdict copying, wholesale sidecar deletion, or treating the markdown log as a completion gate.

#### Plan

1. Snapshot D63's final run writer/reader inventory and classify canonical record versus independent evidence.
2. Define the minimal state schema and writer behind existing application ownership.
3. Wire normal source and bundled workflow runs to the pair, preserving `--no-log` and `--trace-file` semantics.
4. Add focused normal-run, redaction, atomic-update, and cleanup-non-deletion checks; update the owning design contract.

#### Solution

Two-file run record written by the existing `WorkflowRunLogSink` (0925 scope: source + bundled CLI `workflow run`/`workflow continue`; inline/plugin drivers stay with 0927).

- packages/app/src/observability/workflow-run-log-sink.ts:83-84 — record paths keyed to the authoritative run ID: append-only `<runId>.md` (`filePath`) + atomically replaced `<runId>.state.json` (`statePath`); R1/AC1.
- packages/app/src/observability/workflow-run-log-sink.ts:177-196 — state writer: same-directory temp file + rename (atomic replace), schema 1, minimal private fields (`schemaVersion`, `runId`, `workflowName`, `status`, `startedAt`/`updatedAt`, `finalizedAt`); status maps `running` on start and copies the `workflow.run.finalized` trace status verbatim — state never claims stronger than the DB trace, which stays the lifecycle/completion authority alongside `run.artifact`, verdicts, and `--trace-file` output (R2/AC1).
- packages/app/src/observability/workflow-run-log-sink.ts:269 — persistence-boundary redaction: every appended line is scrubbed against `secrets` (constructor option) via the existing `redactAndBound` before byte accounting; configured secrets pass from the CLI via `configuredSecretValues(context.env)` (apps/cli/src/commands/workflow.ts:899,1199), so a canary in input/output/error/steering/preview text cannot reach either file (R3/AC2).
- apps/cli/src/commands/workflow.ts:1914-1921 — `followRunLog` (the `--follow --output` read projection) tails `.md` with the legacy `.log` as read-only fallback; option help strings updated.
- packages/app/src/services/workflow-service.ts:2479-2491 — `outputArtifactForRun` (feeds `run.artifact`) prefers `.md`, falls back to legacy `.log`; `cleanRunLogs` unchanged in behavior (still scans `.log` names only) with the pair exclusion documented (R4/AC3).
- docs/design/run-record-contract.md — recorded the 0925 implementation baseline (minimal state fields, status mapping, boundary redaction, reader fallbacks, cleanup scope).

#### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/observability/workflow-run-log-sink.ts:83-84,177-196 |
| R2 | MET | packages/app/src/observability/workflow-run-log-sink.ts:166-167 |
| R3 | MET | packages/app/src/observability/workflow-run-log-sink.ts:190-193,269-286 |
| R4 | MET | packages/app/src/services/workflow-service.ts:968 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:f66952b5953ef441b0278361ae25b6bda2a97c1e364f9cd51c35999f65e92374 |

#### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- D63 prerequisite: [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md). Handoff to [0926](0926_continue-and-inspect-legacy-workflow-runs-with-stable-identi.md) and [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md).
- D63 is active in `/Users/robin/xprojects/spur-new-runall-d63-767a` at refinement time. Recheck its merged final code, generated bundle, and dependency status before 0925 implementation; do not build against unmerged worktree assumptions.

#### History

- 2026-09-24T03:07:53.057Z todo → wip (system)
- 2026-09-24T03:30:08.687Z wip → testing (system)

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Design

- Scope: replace the existing `WorkflowRunLogSink` `.log` writer for newly logged source and bundled CLI runs. Task 0927 owns the separate host-inline driver and plugin scripts; this task does not migrate their sidecars.
- Format: `.spur/run/<runId>.md` is an append-only, size-bounded, redacted human log. `.spur/run/<runId>.state.json` is a schema-versioned machine projection written through a temp file and same-directory rename. Only the JSON replacement is atomic. The run ID comes from the workflow run, never from an output string or user path.
- Authority and ordering: DB trace/run status controls lifecycle and completion; state summarizes that status and must not claim a newer or stronger result than the trace. Keep `run.artifact`, task/feature verdicts, explicit `.spur/workflow/` trace-file output, and configured project overrides at their owners. Define the minimal private state fields and status mapping against the post-0921 engine shape before coding; no new public CLI verb or API is part of this task.
- Privacy: apply configured-secret redaction at the persistence boundary to every input, output, error, preview, and steering text field before either file is written. Existing upstream redaction is useful but cannot be the only protection; a real-file canary test must cover the sink. Preserve visible truncation and current best-effort logging failure behavior without treating a failed write as proof of success.
- Retention: `WorkflowAppService.cleanRunLogs()` currently filters `.log` names; keep that behavior. Do not add pair GC or apply `workflow.logRetentionDays` to the pair before an operator policy decision.
- Primary targets: `packages/app/src/observability/workflow-run-log-sink.ts`, the adjacent workflow application boundary, `apps/cli/src/commands/workflow.ts` for normal run wiring, and their existing tests. The next task, 0926, receives the pair format and reader contract; 0927 receives inline/plugin ownership.
- Anti-patterns: no second event store, raw prompt/output persistence, task-verdict copying, wholesale sidecar deletion, or treating the markdown log as a completion gate.

#### Plan

1. Snapshot D63's final run writer/reader inventory and classify canonical record versus independent evidence.
2. Define the minimal state schema and writer behind existing application ownership.
3. Wire normal source and bundled workflow runs to the pair, preserving `--no-log` and `--trace-file` semantics.
4. Add focused normal-run, redaction, atomic-update, and cleanup-non-deletion checks; update the owning design contract.

#### Solution

Two-file run record written by the existing `WorkflowRunLogSink` (0925 scope: source + bundled CLI `workflow run`/`workflow continue`; inline/plugin drivers stay with 0927).

- packages/app/src/observability/workflow-run-log-sink.ts:83-84 — record paths keyed to the authoritative run ID: append-only `<runId>.md` (`filePath`) + atomically replaced `<runId>.state.json` (`statePath`); R1/AC1.
- packages/app/src/observability/workflow-run-log-sink.ts:177-196 — state writer: same-directory temp file + rename (atomic replace), schema 1, minimal private fields (`schemaVersion`, `runId`, `workflowName`, `status`, `startedAt`/`updatedAt`, `finalizedAt`); status maps `running` on start and copies the `workflow.run.finalized` trace status verbatim — state never claims stronger than the DB trace, which stays the lifecycle/completion authority alongside `run.artifact`, verdicts, and `--trace-file` output (R2/AC1).
- packages/app/src/observability/workflow-run-log-sink.ts:269 — persistence-boundary redaction: every appended line is scrubbed against `secrets` (constructor option) via the existing `redactAndBound` before byte accounting; configured secrets pass from the CLI via `configuredSecretValues(context.env)` (apps/cli/src/commands/workflow.ts:899,1199), so a canary in input/output/error/steering/preview text cannot reach either file (R3/AC2).
- apps/cli/src/commands/workflow.ts:1914-1921 — `followRunLog` (the `--follow --output` read projection) tails `.md` with the legacy `.log` as read-only fallback; option help strings updated.
- packages/app/src/services/workflow-service.ts:2479-2491 — `outputArtifactForRun` (feeds `run.artifact`) prefers `.md`, falls back to legacy `.log`; `cleanRunLogs` unchanged in behavior (still scans `.log` names only) with the pair exclusion documented (R4/AC3).
- docs/design/run-record-contract.md — recorded the 0925 implementation baseline (minimal state fields, status mapping, boundary redaction, reader fallbacks, cleanup scope).

#### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/observability/workflow-run-log-sink.ts:83-84,177-196 |
| R2 | MET | packages/app/src/observability/workflow-run-log-sink.ts:166-167 |
| R3 | MET | packages/app/src/observability/workflow-run-log-sink.ts:190-193,269-286 |
| R4 | MET | packages/app/src/services/workflow-service.ts:968 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:f66952b5953ef441b0278361ae25b6bda2a97c1e364f9cd51c35999f65e92374 |

#### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- D63 prerequisite: [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md). Handoff to [0926](0926_continue-and-inspect-legacy-workflow-runs-with-stable-identi.md) and [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md).
- D63 is active in `/Users/robin/xprojects/spur-new-runall-d63-767a` at refinement time. Recheck its merged final code, generated bundle, and dependency status before 0925 implementation; do not build against unmerged worktree assumptions.

#### History

- 2026-09-24T03:07:53.057Z todo → wip (system)
- 2026-09-24T03:30:08.687Z wip → testing (system)
- 2026-09-24T03:31:09.134Z testing → done (system)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Scope: replace the existing `WorkflowRunLogSink` `.log` writer for newly logged source and bundled CLI runs. Task 0927 owns the separate host-inline driver and plugin scripts; this task does not migrate their sidecars.
- Format: `.spur/run/<runId>.md` is an append-only, size-bounded, redacted human log. `.spur/run/<runId>.state.json` is a schema-versioned machine projection written through a temp file and same-directory rename. Only the JSON replacement is atomic. The run ID comes from the workflow run, never from an output string or user path.
- Authority and ordering: DB trace/run status controls lifecycle and completion; state summarizes that status and must not claim a newer or stronger result than the trace. Keep `run.artifact`, task/feature verdicts, explicit `.spur/workflow/` trace-file output, and configured project overrides at their owners. Define the minimal private state fields and status mapping against the post-0921 engine shape before coding; no new public CLI verb or API is part of this task.
- Privacy: apply configured-secret redaction at the persistence boundary to every input, output, error, preview, and steering text field before either file is written. Existing upstream redaction is useful but cannot be the only protection; a real-file canary test must cover the sink. Preserve visible truncation and current best-effort logging failure behavior without treating a failed write as proof of success.
- Retention: `WorkflowAppService.cleanRunLogs()` currently filters `.log` names; keep that behavior. Do not add pair GC or apply `workflow.logRetentionDays` to the pair before an operator policy decision.
- Primary targets: `packages/app/src/observability/workflow-run-log-sink.ts`, the adjacent workflow application boundary, `apps/cli/src/commands/workflow.ts` for normal run wiring, and their existing tests. The next task, 0926, receives the pair format and reader contract; 0927 receives inline/plugin ownership.
- Anti-patterns: no second event store, raw prompt/output persistence, task-verdict copying, wholesale sidecar deletion, or treating the markdown log as a completion gate.

### Plan

1. Snapshot D63's final run writer/reader inventory and classify canonical record versus independent evidence.
2. Define the minimal state schema and writer behind existing application ownership.
3. Wire normal source and bundled workflow runs to the pair, preserving `--no-log` and `--trace-file` semantics.
4. Add focused normal-run, redaction, atomic-update, and cleanup-non-deletion checks; update the owning design contract.

### Solution

Two-file run record written by the existing `WorkflowRunLogSink` (0925 scope: source + bundled CLI `workflow run`/`workflow continue`; inline/plugin drivers stay with 0927).

- packages/app/src/observability/workflow-run-log-sink.ts:83-84 — record paths keyed to the authoritative run ID: append-only `<runId>.md` (`filePath`) + atomically replaced `<runId>.state.json` (`statePath`); R1/AC1.
- packages/app/src/observability/workflow-run-log-sink.ts:177-196 — state writer: same-directory temp file + rename (atomic replace), schema 1, minimal private fields (`schemaVersion`, `runId`, `workflowName`, `status`, `startedAt`/`updatedAt`, `finalizedAt`); status maps `running` on start and copies the `workflow.run.finalized` trace status verbatim — state never claims stronger than the DB trace, which stays the lifecycle/completion authority alongside `run.artifact`, verdicts, and `--trace-file` output (R2/AC1).
- packages/app/src/observability/workflow-run-log-sink.ts:269 — persistence-boundary redaction: every appended line is scrubbed against `secrets` (constructor option) via the existing `redactAndBound` before byte accounting; configured secrets pass from the CLI via `configuredSecretValues(context.env)` (apps/cli/src/commands/workflow.ts:899,1199), so a canary in input/output/error/steering/preview text cannot reach either file (R3/AC2).
- apps/cli/src/commands/workflow.ts:1914-1921 — `followRunLog` (the `--follow --output` read projection) tails `.md` with the legacy `.log` as read-only fallback; option help strings updated.
- packages/app/src/services/workflow-service.ts:2479-2491 — `outputArtifactForRun` (feeds `run.artifact`) prefers `.md`, falls back to legacy `.log`; `cleanRunLogs` unchanged in behavior (still scans `.log` names only) with the pair exclusion documented (R4/AC3).
- docs/design/run-record-contract.md — recorded the 0925 implementation baseline (minimal state fields, status mapping, boundary redaction, reader fallbacks, cleanup scope).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/observability/workflow-run-log-sink.ts:83-84,177-196 |
| R2 | MET | packages/app/src/observability/workflow-run-log-sink.ts:166-167 |
| R3 | MET | packages/app/src/observability/workflow-run-log-sink.ts:190-193,269-286 |
| R4 | MET | packages/app/src/services/workflow-service.ts:968 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:f66952b5953ef441b0278361ae25b6bda2a97c1e364f9cd51c35999f65e92374 |

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- D63 prerequisite: [0921](0921_complete-measured-workflow-migration-and-catalogue-reconcili.md). Handoff to [0926](0926_continue-and-inspect-legacy-workflow-runs-with-stable-identi.md) and [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md).
- D63 is active in `/Users/robin/xprojects/spur-new-runall-d63-767a` at refinement time. Recheck its merged final code, generated bundle, and dependency status before 0925 implementation; do not build against unmerged worktree assumptions.

### History

- 2026-09-24T03:07:53.057Z todo → wip (system)
- 2026-09-24T03:30:08.687Z wip → testing (system)
- 2026-09-24T03:31:09.134Z testing → done (system)

