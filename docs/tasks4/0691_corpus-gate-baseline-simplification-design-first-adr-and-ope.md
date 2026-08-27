---
schema_version: 1
name: "Corpus gate & baseline simplification: design-first ADR and operator-gated implementation"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.884Z
updated_at: "2026-08-27T20:19:53.934Z"
feature_id: F94
priority: P1
---

## 0691. Corpus gate & baseline simplification: design-first ADR and operator-gated implementation

### Background

The corpus gate and `config/corpus-baseline.json` machinery is failing operationally. The dated baseline stands at ~1928 entries. Three reconcile incidents occurred in the 0688 session alone (2026-08-27): an inverted jq filter silently dropped the baseline **1907 → 18** entries (caught only by a 408-new-error gate blowup); object-construction key loss truncated the file; both were hand-rolled jq on a policy file. The recurring churn classes keep forcing reconcile: post-close checkbox flips rewriting history, filing residue (**21** class entries filed for one single filing), and matcher-change fallout forcing reconcile (the T10 same-commit rule).

Operator direction (2026-08-27): the two-sided dated-baseline direction (ADR-088 ratchet plus a reconcile verb) is the **wrong direction** — simplify the gate and baseline massively for reliability and efficiency. That direction message is the ADR-051 consent evidence for any `task check` surface change. Absorbs F96 (claim-matcher subject association, cancelled 2026-08-27): the simplification may delete the clause-window machinery rather than refine it — the three dated residue entries 0607/0677/0670 are the evidence set.

### Requirements

- [ ] R1. **ADR entry in `docs/00_ADR.md`** evaluating simplification options: e.g. drop
      dated-residue baselining entirely and gate only new findings against a committed snapshot;
      collapse superseded finding classes (testing-coverage successors, gate-language, readiness
      classes); single-sided vs two-sided tradeoffs; disposition of the claim-matcher
      clause-window machinery (F96 absorption).
- [ ] R2. **Design-first, operator-gated:** implementation waits for explicit operator approval
      of the ADR decision. Do NOT implement in this task's filing — the ADR decision gate comes
      first.
- [ ] R3. **Implement the approved option** once approved, removing the machinery it retires
      while the gate stays able to catch genuine regressions.
- [ ] R4. **Do not entrench:** any interim baseline reconcile stays minimal — this task's
      direction is simplification, not more dated-baseline machinery.

### Acceptance Criteria

- [ ] AC1. Given the simplification ADR entry in docs/00_ADR.md, when it is reviewed, then it evaluates the named options (drop dated-residue baselining / gate new-findings-vs-committed-snapshot, superseded-class collapse, single-sided vs two-sided) and records a recommendation.
- [ ] AC2. Given the operator approval gate, when implementation starts, then the ADR records the approval (ADR-051 consent evidence dated 2026-08-27).
- [ ] AC3. Given the approved option, when implementation lands, then the retired machinery is removed and the corpus gate still fails on genuine new findings.
- [ ] AC4. Given the F96 absorption, when the ADR decides the claim-matcher clause-window machinery's fate, then the decision is recorded with the 0607/0677/0670 residue as the evidence set.

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
