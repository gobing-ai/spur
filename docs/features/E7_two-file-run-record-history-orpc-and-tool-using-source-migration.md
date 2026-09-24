---
schema_version: 1
id: "E7"
name: Workflow run record and inspection
status: verifying
priority: P2
tags: []
created_at: "2026-08-19T05:34:32.698Z"
updated_at: "2026-09-24T06:01:39.268Z"
---

# E7: Two-file run-record, history oRPC, and Tool Using source migration

## Goal

Produce a reliable, inspectable record for each workflow run without weakening the existing workflow trace, recovery state, or task/feature proof. After D63, a logging-enabled run has one redacted append-only execution log and one atomic machine-state file keyed by its authoritative run ID. Operators can inspect that record through the existing Board surface, including after a safe resume.

## Scope

**In scope**

- Re-inventory `.spur/run` readers/writers after D63 and migrate run-record-owned facts to `<runId>.md` (redacted, append-only) and `<runId>.state.json` (schema-versioned, atomic replacement). Keep the workflow DB trace/events and path-only artifact metadata authoritative for run status; keep task/feature verdicts and proof receipts with their current owners.
- Preserve one run identity and append/update semantics across source and installed workflow execution, inline and subprocess paths, interruption, continue, and replay. Migrate current consumers before retiring any run-record sidecar; retain read compatibility for legacy `.log` runs and the existing `--no-log` and `--trace-file` options.
- Expose a confined, bounded, redacted run-record read by run ID through the existing Observability server boundary and link it from an existing run-inspection view. Distinguish missing, legacy, and incomplete records without inventing success. Label a record expired only when persisted cleanup evidence proves that outcome; the current `.log` cleaner leaves no tombstone, so an absent file alone is missing.
- Validate that current-input verification and completion gates, recovery, run trace, and installed/plugin-override behavior remain correct when record storage changes. The target is two **canonical run-record files** per logging-enabled run, not two files for every independent task or project artifact.

**Out of scope**

- Rebuilding the History oRPC module or Tool Using view: E8/E81 already ship `historyContract.getToolSequence` and the History Tool Using tab; J92 removed Observability's old Tool Using tab.
- A new Board module or a duplicate Tool Using tab; a new public `spur` noun or verb; changing the workflow engine, task/feature evidence ownership, or source-owned agent transcripts.
- Deleting `.spur/workflow/` traces or the existing `--trace-file` contract; bulk-rewriting or deleting historical `.spur/run` artifacts.
- The 0594 injected-file-list cost idea. It needs a separately measured owner and is not needed for run-record inspection.
- Automatic cleanup of the new pair until its retention policy is explicitly selected. Existing `.log` cleanup remains governed by `workflow.logRetentionDays`.

## Acceptance Criteria

```gherkin
Feature: E7 workflow run record and inspection

  @core
  Scenario: R1 — A logging-enabled run writes one canonical two-file record
    Given a workflow run with an authoritative run ID and logging enabled
    When its source or installed execution writes the run record
    Then `.spur/run/<runId>.md` is appended in execution order and never rewritten
    And `.spur/run/<runId>.state.json` is schema-versioned and atomically replaced
    And no undeclared run-record sidecar is required after terminal closure
    And task evidence, workflow DB trace, and explicit trace-file output keep their own owners

  @core
  Scenario: R2 — Recording preserves privacy and current proof
    Given workflow inputs, outputs, and a current-input verification receipt
    When the record is persisted or read
    Then configured secrets and sensitive content are redacted at the persistence boundary
    And the record does not replace or invalidate the workflow trace or task/feature proof
    And an inspection log alone never establishes completion

  @core
  Scenario: R3 — Continue and replay retain run identity and state
    Given an interrupted or paused workflow with an existing run record
    When the supported continue or replay path runs
    Then it keeps the original run ID and appends only new execution sections
    And its state update is atomic and agrees with the authoritative trace outcome
    And a previously completed external action or human decision is not repeated by record recovery

  @core
  Scenario: R4 — Current callers survive the storage migration
    Given the post-D63 inventory of run-scoped writers and readers
    When the canonical pipelines and installed plugin use the two-file record
    Then every declared mid-run reader obtains its needed state or a supported legacy artifact
    And existing task gates, verdicts, workflow trace, follow output, and project overrides remain usable
    And no old artifact is removed before its last supported reader is migrated

  @core
  Scenario: R5 — Operators inspect the record by run ID
    Given a run with a persisted record
    When an operator opens it from an existing Board run-inspection surface
    Then the server rejects traversal and symlink escapes and returns bounded redacted content
    And the view identifies the run's actual state without treating a partial log as success
    And malformed IDs, absent records, and legacy records have explicit outcomes

  @core
  Scenario: R6 — Existing run surfaces retain compatibility
    Given a legacy `.log` run, an explicit `--no-log` run, or a `--trace-file` run
    When it is inspected or continued through a supported path
    Then legacy records remain readable without bulk migration
    And `--no-log` remains an explicit logging opt-out
    And `--trace-file` continues to write its independent redacted projection

  @edge
  Scenario: R7 — New record files are not silently reclaimed
    Given a new two-file record and the existing `.log` retention setting
    When workflow cleanup runs before the operator selects a pair-retention policy
    Then neither new record file is deleted
    And existing `.log` cleanup behavior remains unchanged
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0925 | Persist redacted two-file workflow records for new runs | done |
| 0926 | Continue and inspect legacy workflow runs with stable identity | done |
| 0927 | Preserve task-pipeline proof while moving its run state to the pair | done |
| 0928 | Move the remaining canonical workflows to the run record | done |
| 0929 | Inspect a bounded run record from the existing Board | done |
<!-- END AUTO-GENERATED -->

## Notes

**2026-09-22 rebaseline.** The H1 heading and file slug retain the original title for link stability;
the tool-owned `name` field now states the current scope. E8/E81 delivered the History Board,
`historyContract.getToolSequence`, and the History Tool Using tab; J92 removed the obsolete
Observability Tool Using tab. E7 owns the remaining workflow run-record and inspection outcome.
Those delivered prerequisites are not tasks to regenerate.

Design: `docs/design/run-record-contract.md` → **Current E7 contract (2026-09-22 rebaseline)**. The older §0–§9 material is historical inventory, not permission to remove current task evidence or `.spur/workflow/` traces. D63 completion is the implementation baseline because its inline, recovery, and proof contracts determine the final reader/writer inventory.

Retention is intentionally undecided for the new pair. Current `cleanRunLogs` removes old `.log` files after `workflow.logRetentionDays` (default 30 days); that does not authorize deleting new records. Select the pair policy before adding pair GC. The feature can deliver durable records and inspection without an automatic pair-GC task.

## History

- 2026-09-24T03:30:09.851Z backlog → active (system)
- 2026-09-24T06:01:39.268Z active → verifying (system)

