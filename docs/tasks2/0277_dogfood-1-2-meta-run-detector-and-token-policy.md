---
template: feature-impl
schema_version: 1
name: "Dogfood @1.2 meta-run detector and token policy"
description: ""
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["workstream:dogfood", "impl", "dogfood-1.2"]
dependencies: ["0276"]
created_at: "2026-07-17T01:13:59.542Z"
updated_at: "2026-07-17T01:14:26.081Z"
---

## 0277. Dogfood @1.2 meta-run detector and token policy

### Background
**Type:** feature-impl · **Feature:** N · **Package:** dogfood @1.2 Impl B (from 0274)

**Goal:** Harden pipeline-driving detection and add meta-run token policy so dogfooding Spur itself costs less and fails safer.

**Authority:** 0274 W7-W9; 0273 D6, D7, D9.

**Depends on:** 0276 (protocol @1.2 strings/checklist stable).
### Requirements
- [ ] R1. Pipeline-driving detector uses word-boundary matchers for --next, dev-run, runall, wrap/wrapall, idea — not leading-space only (W7/D6).
- [ ] R2. Unit cases for detector true/false positives (as specified in 0274 tests section).
- [ ] R3. Meta-run policy: when pipeline-driving and a derived step is full implement, emit warning; recommend observe-only or step-split (W8/D7).
- [ ] R4. Cost segmentation guidance for implement-heavy steps (protocol vs implement work) in skill and/or report-template (W8).
- [ ] R5. Document expected --next chain stop-at-testing when provenance missing (W9/D9); do not change lifecycle code in this task.
- [ ] R6. Tests green; no regression of 0276 fixtures.
### Acceptance Criteria
```gherkin
@core
Scenario: Detector catches dev-run without leading space
  Given testee string containing dev-run
  When pipeline-driving detection runs without explicit --max-retry
  Then the refuse message is emitted

@core
Scenario: Implement-heavy pipeline dogfood warns
  Given a pipeline-driving testee whose derived steps include full implement
  When Phase 1 completes step derivation
  Then an advisory recommends observe-only or step-split
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. Confirm 0276 done / @1.2 strings present.
2. Rewrite detector + tests.
3. Add implement-step warning + Cost segmentation docs.
4. Gotcha for provenance/--next.
5. Solution change-map; run tests.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
