---
schema_version: 1
name: "Reconcile the corpus-baseline backlog: 77 unbaselined findings and the anchor-citation class"
status: backlog
template: issue
created_at: 2026-08-25T17:28:11.217Z
updated_at: "2026-08-25T17:28:53.766Z"
ac_altitude: task-local
---

## 0670. Reconcile the corpus-baseline backlog: 77 unbaselined findings and the anchor-citation class

### Background

`bun run corpus-check` (`spur task check --corpus`) is failing repo-wide. Measured 2026-08-25
during the I8 verifyall re-audit: **101 unbaselined findings**, of which **77 are unrelated to any
task or file that audit touched** — they come from A5 (14), F72 (12), 0569 (9), 0567 (7), 0666 (6),
0665 (5), 0638 (4), 0570 (4), 0556 (3), and singletons across 0664, 0663, 0662, 0649, 0632, 0629,
0628, 0624, 0420, 0102.

The sweep is deliberately two-sided (constitution T10): an unlisted error fails, **and** a listed
entry that no longer reproduces fails, so the baseline cannot rot into a silent suppression list.
That property only holds while the delta is reconciled; at 77 unreconciled findings the sweep has
stopped being a gate and started being noise, which is the failure mode the two-sidedness exists to
prevent.

## Why this is its own task, not I8 fallout

I8's verification added ~24 findings of the same managed class and was deliberately committed
without reconciling them (operator decision, 2026-08-25). Reconciling 24 while 77 sit unreconciled
tidies one corner of a room that needs a decision about the room. The 77 predate that work.

## The dominant class needs a decision, not just a baseline entry

`config/corpus-baseline.json` already carries **399** `L4.anchor-subject-mismatch` and **137**
`L4.stale-line-anchor` entries. Those two codes are the bulk of both the baseline and the new
delta. The check re-reads each cited `file:line` and requires the content to name the requirement's
subject; evidence rows that pack several anchors into one table cell reliably trip it, because the
extracted subject list is then the union of every anchor in the row.

So the real question is not "baseline or fix these 101" but: **is the check's subject-matching rule
calibrated to how evidence rows are actually authored?** A rule that 399 baselined entries already
violate is either under-enforced or mis-specified. Three outcomes are possible and the task should
pick one with evidence:

1. The rule is right and the citations are genuinely bad → fix citations, shrink the baseline.
2. The rule is too strict for multi-anchor rows → narrow it (match per-anchor, not per-row), then
   re-measure the fallout.
3. The rule is right but unenforceable retroactively → freeze the baseline as a dated legacy set,
   and enforce the rule only on entries created after that date.

## Constraints

- No hand-editing `config/corpus-baseline.json` in bulk without deciding the above first — that is
  exactly how the file becomes the silent suppression list T10 forbids.
- There is no baseline regeneration CLI today, by design. If one is added it is a public CLI
  surface change and needs ADR-051 operator consent.
- `corpus-check` is intentionally NOT part of `spur-check` (it is behind `spur-check-new`), so this
  work does not block the normal gate. Keep it that way unless the sweep gets fast and green.

### Requirements

- [ ] R1. Decide, with measured evidence, which of the three outcomes in Background applies to
      `L4.anchor-subject-mismatch` / `L4.stale-line-anchor`: fix the citations, narrow the rule, or
      freeze a dated legacy set. Record the decision and its rationale in an ADR.
- [ ] R2. Re-measure the sweep after the decision and report the resulting counts (findings,
      baseline entries, and how many of each code survive) so the change's effect is quantified
      rather than asserted.
- [ ] R3. `bun run corpus-check` exits 0 on a clean tree, with the baseline containing only entries
      that still reproduce and no entry that does not.
- [ ] R4. The two-sidedness is preserved: introducing a new unlisted finding still fails, and
      removing a real defect that a baseline entry names still fails until that entry is removed.
      Prove both with a test, not by inspection.
- [ ] R5. If the rule is narrowed, the narrowing is covered by tests over multi-anchor evidence
      rows, single-anchor rows, and external-evidence citations (ADR-062 form), so the calibration
      cannot silently regress.

### Acceptance Criteria

```gherkin
Feature: A corpus sweep that is a gate again

  @core
  Scenario: R1 — The dominant finding class gets a recorded decision
    Given 399 baselined "L4.anchor-subject-mismatch" entries and a failing sweep
    When the calibration question is resolved
    Then an ADR records which of fix-citations, narrow-rule, or freeze-legacy was chosen
    And it states the evidence the choice rests on

  @core
  Scenario: R3 — The sweep exits clean on an unmodified tree
    Given a checkout with no local modifications
    When "bun run corpus-check" runs
    Then it exits 0
    And it reports no NEW findings
    And it reports no STALE baseline entries

  @core
  Scenario: R4 — Two-sidedness survives the reconciliation
    Given a reconciled baseline
    When a task is edited to introduce an unlisted structural finding
    Then the sweep fails naming that finding
    And when a defect named by a baseline entry is repaired without removing the entry
    Then the sweep fails naming the stale entry

  @edge
  Scenario: R5 — A narrowed rule is pinned against real evidence-row shapes
    Given evidence rows carrying one anchor, several anchors, and an external citation
    When the anchor check runs against each
    Then a single-anchor row is judged on its own anchor
    And a multi-anchor row is judged per anchor rather than against the union of subjects
    And an external ADR-062 citation is not reported as a stale in-repo anchor
```

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
