---
schema_version: 1
name: Continue and inspect legacy workflow runs with stable identity
status: done
template: feature-impl
created_at: 2026-09-23T05:09:42.307Z
updated_at: "2026-09-24T04:07:51.661Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - recovery
estimate_hours: 8

dependencies: ["0925"]
---

## 0926. Continue and inspect legacy workflow runs with stable identity

### Background

Covers E7 R3 and R6. Existing `workflow continue`, `workflow trace --output`, `--no-log`, and `--trace-file` callers must retain their documented behavior as the record format changes. Depends on the two-file writer task; it inherits that task's D63 gate. Rubric: E8 D1 L2 C1 R2 = 14; split because replay and backwards compatibility need an independent safety review.

### Requirements

- [x] R1. Continue a paused/interrupted run under its existing run ID; append only new log sections and atomically update state after the authoritative trace outcome.
- [x] R2. Preserve the recorded disposition of external effects and operator decisions on replay; record inspection cannot by itself authorize re-execution or completion.
- [x] R3. Let follow/output and supported continue paths read old `.log` records without bulk migration; handle missing new state explicitly.
- [x] R4. Preserve explicit `--no-log` and `--trace-file` behavior and source/bundled parity.

### Acceptance Criteria

- [x] AC1 — Continue and replay retain run identity and state (req: R1)
  Given a paused or interrupted run with a pair and a recorded external effect or human decision
  When the supported continue path resumes it
  Then it keeps the run ID, appends only new markdown sections, and atomically updates state to agree with the DB trace
  And record recovery does not repeat the prior effect or decision
  Verify through workflow-service and CLI resume tests with persisted artifacts and an observable side-effect counter.

- [x] AC2 — Existing run surfaces retain compatibility (req: R3)
  Given a legacy `.log` run, a run started with `--no-log`, and a run with `--trace-file`
  When a supported follow, inspect, or continue path accesses each run
  Then legacy output is readable without bulk migration, `--no-log` creates no pair, and trace-file output remains independent
  And a missing pair state is reported as missing rather than success
  Verify in `apps/cli/tests/commands/workflow.test.ts` for both source and bundled command paths.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: 0925 supplies the pair writer and private state format. Recheck its shipped fields after completion; do not redefine or fork the schema. D63 task 0921 is inherited through 0925.
- Read precedence: for a run with a valid pair, use the pair for record output/state; for a historical `.log`-only run, retain the legacy log path. Treat a missing or invalid state file as an explicit incomplete/unavailable record, not as success and not as permission to synthesize state from markdown. Keep the existing DB trace as lifecycle authority.
- Continue: `WorkflowAppService.continuePaused()` and the `workflow continue` command retain the original run ID and authoritative resume claim. A supported resume appends new sections and replaces state after the trace advances. Existing external-effect and operator-decision receipts govern replay; reading a record must not re-execute actions.
- CLI compatibility: adapt `followRunLog()` and `workflow trace --follow --output` to prefer the pair while preserving `.log` fallback. Preserve `--no-log`, `--trace-file`, and source/bundled parity. No new public CLI verb or flag.
- Primary targets: `packages/app/src/services/workflow-service.ts`, `apps/cli/src/commands/workflow.ts`, their focused tests, and the shared application reader introduced by 0925. Leave task-pipeline plugin YAML/scripts to 0927.
- Anti-patterns: no bulk migration of legacy logs, status inference from markdown, duplicate side-effect replay, or fallback that hides corrupt new state as a successful old run.

### Plan

1. Identify current CLI follow, continue, and trace read paths after D63.
2. Add format detection and bounded legacy reads behind the existing workflow service.
3. Bind continuation to authoritative trace/state identity and append-only record behavior.
4. Verify interrupted/paused/terminal, legacy, `--no-log`, and trace-file cases through focused service and CLI checks.

### Solution

Two-file record reads and resume identity, built on the 0925 pair writer (no schema fork). Post-D63
reader inventory (plan step 1): CLI `followRunLog` (`workflow trace --follow --output`) and
`run.artifact` (`outputArtifactForRun`) already prefer `.md` over legacy `.log` (0925); the remaining
pre-pair reader is `AgentService.resolveArtifactRefs` (packages/app/src/services/agent-service.ts,
`.spur/run/<runId>.log` probe for coordination inline runs) — an inline-driver surface owned by 0927,
left unchanged here. The DB trace stays the lifecycle/completion authority everywhere; nothing infers
status from markdown.

- packages/app/src/services/workflow-service.ts:2495-2552 — shared reader seam `readWorkflowRunRecord(runDir, runId)` (plan step 2): explicit `pair` / `incomplete` (`state-missing` | `state-invalid`) / `legacy-log` / `missing` outcomes, traversal-rejecting run-id guard, bounded path+state read behind the service (R3). No bulk migration: legacy `.log` reads in place.
- packages/app/src/observability/workflow-run-log-sink.ts:185-207 — resume identity carry-forward: a resumed run never re-emits `workflow.run.started`, so the resumed sink's state write carries `workflowName`/`startedAt` forward from the prior valid state file (never from markdown); missing/invalid prior state stays an explicit gap (R1).
- packages/app/src/observability/workflow-run-log-sink.ts:220-233 — a failed atomic state replace now unlinks its `.tmp` (no residue) while staying best-effort (R1).
- packages/app/src/observability/workflow-run-log-sink.ts:83-84 + apps/cli/src/commands/workflow.ts:1196-1202 (unchanged 0925 wiring) — continue keeps the original run id; the sink opens `<runId>.md` append-only and atomically replaces state on the trace's finalize event, so recovery appends only new sections and never re-executes recorded effects (engine receipts; verified by the side-effect counter tests).
- apps/cli/src/commands/workflow.ts:1913-1963 — `followRunLog` re-detects the record format every poll (0926 R3): a legacy `.log` run continued mid-follow switches the tail to the new `.md` (once, from the top) instead of tracking the stale `.log` forever; a pair record with missing/invalid state is reported as an explicit incomplete record at terminal, never as success (AC2). `--no-log`, `--trace-file`, and the no-record `--no-log` message are unchanged (R4).
- packages/app/src/index.ts — exports `readWorkflowRunRecord` / `WorkflowRunRecordRead` for the 0927/0929 seams.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test — workflow-service.test.ts:2669 (same run id, `mdAfterResume.startsWith(mdAfterRun)`, counter stays `['tick']`, state `paused`→`done` agreeing with DB trace, `startedAt` carried forward); test — workflow.test.ts:685 (CLI mirror with persisted artifacts) + static-ref — workflow-run-log-sink.ts:186-233 (resume identity carry-forward from prior valid state, atomic temp+rename with `.tmp` unlink) and workflow.ts:1198-1202 (continue sink reuses `targetId`) |
| R2 | MET | test — workflow-service.test.ts:2669 and workflow.test.ts:685 (side-effect counter unchanged `['tick']` across resume = no replayed disposition) + static-ref — workflow-service.ts:2503-2521 (`readWorkflowRunRecord` is a pure reader returning a data union; no execution, no status transition, no synthesis from markdown) and workflow.ts:1957-1960 (incomplete record explicitly defers completion authority to the DB trace) |
| R3 | MET | test — workflow-service.test.ts:2565-2628 (pair / incomplete state-missing / incomplete state-invalid / legacy-log in place / missing / traversal-reject) ; test — workflow.test.ts:2848 (legacy `.log` run continued mid-follow switches tail to the new `.md`, `['legacy', 'resumed section']`) and workflow.test.ts:2876 (missing state reported as `Run record incomplete (state-missing)`, never success) + static-ref — workflow-service.ts:2515-2552 (reader precedence: pair > explicit incomplete > legacy-log in place > missing) and workflow.ts:1917-1945 (format re-detected every poll, `.log` fallback preserved) |
| R4 | MET | test — workflow.test.ts:728 (`continue --no-log` leaves `.md` and `.state.json` byte-identical) ; test — workflow.test.ts:1388 (`--trace-file` writes its independent JSONL projection under `.spur/workflow/`) + static-ref — workflow.ts:532,814 (`--trace-file` option/wiring untouched by the diff) and workflow.ts:898-902,1201 (secrets added to sink only; `--no-log` still suppresses sink construction entirely) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | proof-input-digest | — | sha256:b41f167a7f2d20db13612cdc70602f80b4e19c0da6f7fc3bc099aad82b248cc7 |

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0925](0925_persist-redacted-two-file-workflow-records-for-new-runs.md); provides the reader/compatibility seam to [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md) and [0929](0929_inspect-a-bounded-run-record-from-the-existing-board.md).
- D63 is active in a separate worktree at refinement time. Recheck the merged 0921 execution contract and the completed 0925 state schema before implementation.

### History

- 2026-09-24T03:31:48.575Z todo → wip (system)
- 2026-09-24T04:07:16.983Z wip → testing (system)
- 2026-09-24T04:07:51.661Z testing → done (system)

