---
schema_version: 1
name: "Baseline reconcile verb: apply and prune corpus-baseline.json from task check --corpus output"
status: cancelled
template: feature-impl
created_at: 2026-08-27T19:44:59.389Z
updated_at: "2026-08-27T20:11:33.067Z"
feature_id: F94
priority: P1
---

## 0691. Baseline reconcile verb: apply and prune corpus-baseline.json from task check --corpus output

### Background

Reconciling `config/corpus-baseline.json` is hand-rolled jq today. During the 0688 run
(session 2026-08-27, commits f7402c21/f60e5aec1) an agent's inverted filter silently dropped the
baseline from **1907 to 18** entries; the mistake was caught only by a 408-new-error gate blowup.
ADR-088's two-sided ratchet did its job — the stale-side detection exposed the loss — but the only
tool for repairing the file is ad-hoc shell plumbing, which is exactly what caused the loss. This
task files friction G-1 of F94.

### Requirements

- [ ] R1. **Host the verb under the `task` noun per existing CLI conventions.** Survey
      `spur task --help`; the operator's stated preference is task hosting (e.g.
      `spur task baseline reconcile` or the closest convention-fitting spelling). A new noun
      requires explicit operator consent (ADR-051) — do not invent one.
- [ ] R2. **One deterministic apply-and-prune pass.** Input is a `spur task check --corpus --json`
      output (live run or from-file). New findings become dated baseline entries; entries that no
      longer reproduce are removed. One invocation, both directions.
- [ ] R3. **Dry-run default with a summary diff.** Writes require an explicit apply flag. Both
      modes print a summary diff (added/removed counts plus the entries themselves).
- [ ] R4. **Preserve ADR-088 two-sided semantics exactly.** Reconcile automates the operator's
      hand procedure; it does not change what the gate enforces. Unit tests cover apply, prune,
      and no-op paths.

### Acceptance Criteria

- [ ] AC1. Given a `--corpus` output with new findings and stale baseline entries, when the verb
      runs in its default mode, then nothing is written and a summary diff is printed.
- [ ] AC2. Given the apply flag, when the verb runs, then the baseline gains the new dated entries
      and loses the stale ones, and a follow-up corpus check is green.
- [ ] AC3. Given an output that matches the baseline exactly, when the verb runs, then it reports
      a no-op.
- [ ] AC4. Given the unit suite, when it runs, then apply/prune/no-op and the two-sided
      invariants are covered.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-27T20:11:33.067Z todo → cancelled (system)
