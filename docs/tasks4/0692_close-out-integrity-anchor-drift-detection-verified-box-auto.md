---
schema_version: 1
name: "Close-out integrity: anchor-drift detection, verified-box auto-flip, FSM denial guidance, resolveRepoRoot fix"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.910Z
updated_at: "2026-08-27T20:19:54.211Z"
feature_id: F94
priority: P2
---

## 0692. Close-out integrity: anchor-drift detection, verified-box auto-flip, FSM denial guidance, resolveRepoRoot fix

### Background

Three close-out frictions and one pre-existing bug from the 0688 session (2026-08-27), merged into one implementation surface (packages/app task/feature services) and one test pass:

- **Anchor drift:** 0606's `eval-pipeline.ts:528` drifted to `:562` after 0688's +34-line edit — caught only post-commit, by a human, not by any gate.
- **Unchecked boxes:** 0688 closed with **21** unchecked Requirements/AC boxes in a done task; `L3.unchecked-checklist` then forced post-close flips — a history rewrite of a done task.
- **Useless FSM denials:** `feature update F91 done` was denied with "No transition from active to done" — no hint that `feature sync` derives the legal hop path (`active → verifying → done`). Task transitions share the same silent-denial shape.
- **`resolveRepoRoot` cwd-dependence:** pre-existing bug, verified via stash during 0688; repo-root resolution varies with the invoking directory.

### Requirements

- [ ] R1. **Anchor-drift detection** — `task check` re-resolves line-number citations against
      the current tree and reports drift, surfaced at commit-prep (precedent: 0606's
      `eval-pipeline.ts:528` → `:562`).
- [ ] R2. **Auto-flip** — record/verify flips Requirements+AC checkboxes to checked when the
      verdict marks them MET/PASS; never on PARTIAL/FAIL/UNKNOWN verdicts or boxes the verdict
      does not mention.
- [ ] R3. **FSM denial guidance** — `GuardDeniedError` messages name the legal path(s) and the
      command that reaches them (e.g. the feature `active→done` denial points at `feature sync`
      hop derivation; the task FSM likewise).
- [ ] R4. **Rider** — fix `resolveRepoRoot` cwd-dependence with a regression test invoking from
      a nested directory.
- [ ] R5. **One surface** — implement in the packages/app task/feature services; one test pass
      covers all four.

### Acceptance Criteria

- [ ] AC1. Given a task citing `path:line` anchors that a source edit moved, when `task check` runs, then drift is reported naming the cited and current positions; stable citations stay silent.
- [ ] AC2. Given a verdict marking requirements MET (or a mixed PARTIAL verdict), when `task record` writes, then exactly the proven boxes flip; ambiguous or unmentioned boxes stay untouched.
- [ ] AC3. Given a denied feature/task transition, when the error renders, then it names the legal path and the command that reaches it (the `active → done` example included).
- [ ] AC4. Given invocation from the repo root and from a nested directory, when the repo root is resolved, then both resolve to the same root.
- [ ] AC5. Given the test suite, when it runs, then all four fixes are covered in one pass.

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
