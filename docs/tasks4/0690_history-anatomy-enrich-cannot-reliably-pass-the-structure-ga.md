---
schema_version: 1
name: "history-anatomy enrich cannot reliably pass the structure gate: ledger anchors, placeholders, and section order fail nondeterministically"
status: todo
template: issue
created_at: 2026-08-27T17:50:02.492Z
updated_at: "2026-08-27T17:50:32.734Z"
feature_id: B
---

## 0690. history-anatomy enrich cannot reliably pass the structure gate: ledger anchors, placeholders, and section order fail nondeterministically

### Background
Found during 0687 verification (2026-08-27), blocking AC4/AC9. The `history-anatomy.yaml` workflow's
enrich → structure-gate path fails nondeterministically across every run this session:

| Run | Executor | Gate failure(s) |
| --- | --- | --- |
| 4f3c5bcd (06:23) | pi-k3 | evidence-claim-without-anchor |
| 68c765bd (17:20) | pi-deepseek | evidence-claim-without-anchor |
| 99333080 (17:45) | pi-deepseek | placeholder-or-todo-present + section-missing-or-out-of-order:Report-only advisories + evidence-claim-without-anchor |

Root causes identified:
1. **Ledger-anchor format underspecified.** The structure gate's `evidence-claim-without-anchor`
   check matches `` `[^`]+\.(md|ts|json)` `` or `path:line` in each Evidence-ledger row, but
   report-contract.md only said "lists the artifact anchor(s)". Published reports (08-24/08-25)
   happened to use backticked paths; enrich models write `current #/...`, which never matches.
   FIXED 2026-08-27: report-contract.md § Evidence ledger now pins the backticked format with an
   example (commit in 0687's fix pass). This alone did NOT resolve it — the model ignored the
   requirement and emitted `current #/...` again.
2. **No correction loop for structure-gate FAIL.** The workflow only routes `validate FAIL →
   correct`; structure-gate FAIL goes straight to `failed`. A one-shot model-authored candidate
   cannot be repaired in-place, so every gate miss is terminal.
3. **No post-enrich deterministic repair.** The enrich model is asked to format-sensitive output
   (placeholder scan, section order, anchor regex) that a deterministic transformer could
   normalize cheaply.

Acceptance shape: `spur workflow run history-anatomy.yaml --vars '{"mode":"daily","date":"<today>","agent":"pi-deepseek"}'`
must reach `published` and write `docs/report/<date>-history-anatomy.md` (structure gate PASS, validate
Verdict: PASS). Choose: (a) structure-gate FAIL → correct (one bounded pass) like validate, (b)
deterministic post-enrich normalization, or (c) prompt+contract hardening with a regression test
that runs the gate against a fixture candidate. State the choice in the Design. This is the last
release-blocking half of 0687's AC4/AC9.
### Requirements
**R1 — `spur workflow run history-anatomy.yaml --vars '{"agent":"pi-deepseek"}'` reaches `published`** and writes `docs/report/<today>-history-anatomy.md` whose frontmatter carries the day's identity bounds, structure gate PASS, and validate `Verdict: PASS`.

**R2 — Structure-gate failures are no longer terminal-and-nondeterministic.** Implement one of: a bounded `correct`-style retry on structure-gate FAIL, a deterministic post-enrich repair of the three known gate classes (ledger-anchor format, placeholder/todo scan, section order), or prompt/contract hardening backed by a gate-vs-fixture regression test. State the choice in the Design and the failure-rate before/after.

**R3 — The Evidence-ledger format contract stays pinned.** report-contract.md's backticked-path requirement (0687 fix pass) must survive; the regression test covers the anchor regex directly.
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
