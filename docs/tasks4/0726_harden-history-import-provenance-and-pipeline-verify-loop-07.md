---
schema_version: 1
name: "Harden history import provenance and pipeline verify loop (0722 session review)"
status: backlog
template: meta
created_at: 2026-08-31T15:58:12.645Z
updated_at: "2026-08-31T15:58:41.211Z"
---

## 0726. Harden history import provenance and pipeline verify loop (0722 session review)

### Background

From the 0722 session review (--triage, 2026-08-31). Task 0722 took 3 runs and ~10h of execution because three failure classes each cost a full loop: (1) run-1/2 verified against a DB whose evidence channel (`history_tool_call.args_raw` for pi bash rows) did not exist in the published importer — discoverable in minutes with a precheck probe, cost ~2:23 in reruns; (2) a full-mode import with the broken published engine (BASH_TOOL_ALLOWLIST build, ts-libs 0.4.48) NULLed 73k args and required a ~2:57 detect→repair→re-verify cycle; (3) the async verifier hit the 30m timeout at ~90% and had to be resumed to emit one file, plus the verdict gate dropped 2 AC rows on non-enum evidence labels (mechanical retry).

Direct fixes applied in this review: docs/design/history-data-processing.md now names the `%index.ts task%` prefilter arm (was the run-3 review P4 finding). All other findings from the review land here.

### Requirements

- R1 (provenance guard): `history import` must refuse (or warn-then-refuse) a full-mode import when the installed importer engine is a known data-destructive build — detect via the `BASH_TOOL_ALLOWLIST` marker or importer version — before any row is written.
- R2 (data-channel precheck probe): the task pipeline precheck (or refine) stage must sample the live evidence channel an AC depends on (e.g. `SELECT count(*) FROM history_tool_call WHERE args_raw IS NOT NULL AND source='pi'`) and fail loudly when the channel is empty, instead of discovering it at verify.
- R3 (verifier incremental output): the verify skill/pipeline stage must write the answer file incrementally per certified section and must schema-lint it (enum check on evidence types) before the final write, so a timeout resumes from partial output instead of restarting.

### Acceptance Criteria

- [ ] AC1 (R1): importing with a destructive-build engine exits non-zero with a provenance error and the DB is unchanged (dry guard run + unit test).
- [ ] AC2 (R2): precheck against a DB missing the AC's evidence channel fails with a named probe query in the message.
- [ ] AC3 (R3): killing a verify mid-run leaves a valid partial answer file; the gate rejects enum-invalid labels with a row-level message before verdict derivation.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
