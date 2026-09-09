---
schema_version: 1
name: Align review/verify contract friction and close subprocess spur-hermeticity gap (session-review 2026-09-09)
status: todo
template: issue
created_at: 2026-09-09T21:57:59.081Z
updated_at: "2026-09-09T21:58:35.783Z"

---

## 0819. Align review/verify contract friction and close subprocess spur-hermeticity gap (session-review 2026-09-09)

### Background

Captured from the creation title: "Align review/verify contract friction and close subprocess spur-hermeticity gap (session-review 2026-09-09)".

### Requirements

Session-review (2026-09-09, `--triage`) findings filed for further fixing. Three independent harness-friction items surfaced across the 0817 pipeline run, the forced re-verify, and the residual-closure sweep.

**R1 (P2 — review-template severity vocabulary vs task-check L3 contract).** The reviewer skill's findings table emits SECUA severities (`minor`/`advisory`), but `packages/app/src/services/task-check.ts:113` (`hasPopulatedPriorityTable`) requires a cell matching `/^\s*P[1-4]\b/`. Two consecutive runs (0815's SECUA merge, 0817's record guard) needed a manual P-code transcription before `task record` could proceed — the record guard denied wip→testing with `[ERR] L3 Review: Review must contain P1–P4 priority findings table` on an otherwise complete Review section. Direction: either make the review template emit P-codes natively (preferred — one vocabulary end to end) or extend the checker to accept the SECUA words; pick one and delete the transcription step. The 0817 restoration (`task update --section Review` with `P3 (minor)`/`P4 (advisory)` cells) is the working precedent for the mapping.

**R2 (P2 — subagent-shell spur hermeticity gap).** `scripts/test-shims/spur` + the `tests/setup.ts` PATH prepend (0817 residual closure) only cover `bun test` children. `agent.run` subprocesses and interactive subagent shells can still resolve a stale global `spur` from PATH — the original 0817 incident vector (false `importer_schema@0.4.60` ledger row from global 0.3.78) is only partially closed: the global binary has been rebuilt to provision 0.4.62, and `importer-schema-check` now auto-remedies false rows, but the *prevention* layer for non-test subprocess surfaces is still the prose rule in AGENTS.md. Direction: pin the source-local CLI structurally for `agent.run` subprocess env (e.g. engine-level PATH prepend or an enforced `SPUR_BIN`), or decide explicitly that auto-remedy + rebuilt-global is sufficient and close with that rationale recorded.

**R3 (P3 — DD-07 orphan pressure vs DD-09 feature-AC subset bind).** Linking an orphan fix-batch task to its natural parent feature trips DD-09 (six `[ERR]` rows: task scenarios not in the feature's AC) unless `--ac-altitude task-local` is set — but nothing in the tooling suggests that combination; I discovered the ERRs only after linking 0817 to D6 and had to find the `task-local` escape hatch in `task update --help`. Direction: decide the standing pattern for fix-batch/dogfood tasks (link with `task-local` altitude, or stay orphan), document it in the spur-cli references, and consider having `task check`'s orphan WARN name the flag. Feeds directly into 0816's "0587 AC-altitude ruling" scope — coordinate there.

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

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
