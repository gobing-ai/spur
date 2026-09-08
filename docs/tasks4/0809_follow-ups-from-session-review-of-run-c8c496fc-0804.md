---
schema_version: 1
name: Follow-ups from session review of run c8c496fc (0804)
status: todo
template: issue
created_at: 2026-09-08T19:52:32.046Z
updated_at: "2026-09-08T19:53:10.062Z"

---

## 0809. Follow-ups from session review of run c8c496fc (0804)

### Background

## 0809. Follow-ups from session review of run c8c496fc (0804)

#### Background

Session-review triage of pipeline run `c8c496fc-6cfe-42a5-8989-1e9716a04179` (task 0804, done and
merged as ee3e448b0) filed the open, non-blocking findings here. Already resolved inline by that
triage (excluded from scope): verdict-schema.md AC-identity wording updated; 0804 Solution now
records the bundle-only fail-closed narrowing; inline-run-setup.test.ts header label R7→R8.

Remaining items below carry review round-2 evidence anchors and the two dogfood findings appended
to 0804's Notes.

### Requirements

- R1. Make `createOrAttachInlineRun`'s create path atomic or compensating: engine
  `createOrAttachRun` (`packages/app/src/services/inline-run-setup.ts:244`) and
  `stampRunIdentity` (`:253`) currently run as two statements; an intermediate failure leaves a
  `{}`-metadata row every later attach refuses as pre-identity. Wrap in one adapter transaction or
  delete the just-created row on stamp failure, with a test.
- R2. Fix the delegate's dead `finally` close (`plugins/sp/scripts/inline-run-setup.ts:188`):
  `process.exit(0/1)` inside the `try` means `projectDb.close()` never runs. Close before exiting.
- R3. Dogfood finding 1 root cause: worktree lifecycle `.spur/spur.db` lost its `runs` row while
  `task_run_links` retained the link (run log 19:32:32Z ANOMALY). Candidate: gate-side DB rebuild
  during focused test runs. Instrument or reproduce, then guard lifecycle-DB mutation outside the
  owning pipeline. Only in-tree DELETE today is `inline-run-setup.test.ts` fixture cleanup.
- R4. Dogfood finding 2: the inline driver should stamp 0784-R2 consented drift
  (`resumeDefinitionDigest`) automatically when the authorized task itself authored the
  `config/workflows/task-pipeline.yaml` change, instead of requiring host-side manual recovery at
  record entry.
- R5. Cosmetic (single commit, no behavior change): deduplicate the bracket/`Scenario:` strip loop
  (`plugins/sp/scripts/verify-answer-lint.ts:272`, `:339`) and replace the shadowed dynamic
  re-import in `openInlineRunProjectDb` (`packages/app/src/services/inline-run-setup.ts:114-121`)
  with static imports.
- R6. Conditional: if bundle-only inline pipelines become a supported surface, ship a bundled
  setup-script path (see 0804 Solution scope-decision note).

### Acceptance Criteria

- AC1 (R1): A stubbed stamp failure after create leaves either no runs row or a stamped row — never
  an unstamped `{}`-metadata row; the attach refusals for pre-identity rows still hold.
- AC2 (R2): Delegate exit paths close the project DB (assert via spy or restructure so `finally`
  is reachable); behavior and artifact outputs unchanged; guard tests stay green.
- AC3 (R3): Either a reproduced root cause with evidence, or an instrumentation/guard that fails
  loudly when the lifecycle DB loses the owning pipeline's runs row.
- AC4 (R4): An inline run on a task that itself changed the workflow definition resumes at record
  without manual host-side identity surgery; conflicting third-party drift still refuses.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
