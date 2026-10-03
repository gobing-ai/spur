---
schema_version: 1
name: Residuals from 1061
status: backlog
template: feature-impl
created_at: 2026-10-03T01:53:33.466Z
updated_at: "2026-10-03T01:56:22.269Z"
feature_id: F96

priority: P3
ac_numbering: task-local
ac_altitude: task-local
---

## 1063. Residuals from 1061

### Background

Source task: 1061 (feature F96) — deferred residuals filed by residual-scan settle.

- review-finding:fc5ed7cf — config/templates/task/standard.md:30, apps/cli/tests/commands/task.test.ts:3696: AC-guidance comment now exists in 7 near-identical copies (6 templates + condensed style-guide form) plus a sed-escaped 8th copy in the 0788 test; only standard.md's copy is contract-pinned, so the other five templates can drift silently — this task's own diff (8 coordinated lockstep edits for one wording change) demonstrates the coupling cost. Follow-up candidate: a cross-template AC-comment consistency check (or generator); full dedup is wrong since templates must stay self-contained for `spur task create` without the plugin.

### Requirements

- [ ] R1. A repo test (bun) detects drift of the AC-guidance comment across the 8 synchronized copies (6 config/templates/task/*.md templates, the condensed form in plugins/sp/skills/spur-dev/references/ac-style-guide.md, the sed-escaped copy in apps/cli/tests/commands/task.test.ts): a perturbed copy fails with the drifted file named; the committed tree passes.
- [ ] R2. Templates stay self-contained — the check reads existing repo files only, adds no dependencies, and changes no template content beyond fixing actual drift found.

### Acceptance Criteria

```gherkin
Scenario: AC1 — perturbed copy fails with drifted file named (req: R1)
  Given the committed template copies in a temp fixture
  When one copy's guidance comment gains a stray sentence
  Then the consistency test fails and names that file

Scenario: AC2 — committed tree passes (req: R1)
  Given the current repository
  When the consistency test runs via bun test
  Then it passes with zero source edits

Scenario: AC3 — self-contained, dependency-free check (req: R2)
  Given the implementation
  When manifests and template contents are reviewed
  Then no dependencies were added and all 8 copies remain inline and self-contained
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] P1. Extract the AC-guidance comment from each of the 8 copies (normalize the sed-escaped test copy) and compare.
- [ ] P2. Add the consistency test under apps/cli/tests/ with the AC1 perturbation fixture.
- [ ] P3. Run the focused test, then `bun run spur-check`; record results in Testing/Review.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
