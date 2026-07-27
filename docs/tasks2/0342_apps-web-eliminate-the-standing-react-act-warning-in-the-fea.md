---
template: feature-impl
schema_version: 1
name: "apps/web: eliminate the standing React act() warning in the features test suite"
description: ""
status: todo
type: task
profile: standard
feature_id: F8
parent_wbs: null
priority: P3
tags: ["web", "tests", "hygiene", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.207Z"
updated_at: "2026-07-26T23:50:31.207Z"
---

## 0342. apps/web: eliminate the standing React act() warning in the features test suite

### Background

From the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, finding P4).

Every run of `bun test tests/modules/features/` prints "An update to FeaturesShell inside a test was not wrapped in act(...)". The suite passes (37/37 as of 2026-07-26) and the warning is pre-existing — `FeaturesShell.tsx` was not touched by feature R2, which changed only `FeatureTree.tsx`, `status-icons.tsx`, and `global.css`.

It is not a one-line fix. `components.test.tsx` renders `<FeaturesShell />` at eight sites, and the obvious suspects are already correctly awaited via `waitFor`, so the stray update is landing outside `act` from somewhere less direct — a likely candidate is the render at `:638` in the 'renders empty and error states' test, which is never unmounted before `afterEach` cleanup runs while a fetch promise is still settling.

The cost of leaving it is that a real act() warning introduced later will be invisible in the noise.

### Requirements
R1. Diagnose which render site and which state update produce the warning — do not blanket-wrap every interaction in `act()` to silence it, which would hide the cause rather than fix it.

R2. Fix the root cause so `bun test tests/modules/features/` runs warning-free, most likely by ensuring every rendered tree is unmounted or fully settled before the test ends.

R3. Keep all existing assertions and the current pass count intact; this is hygiene, not a behavior change.

R4. Do not suppress the warning via console filtering, reporter configuration, or a test-level mute.

R5. Confirm the wider `apps/web` suite is unaffected. Note that `tests/lib/rpc-client.test.ts` reports 2 pre-existing failures under a sandboxed shell (`Bun.serve` EADDRINUSE port-bind denial) which are environmental and out of scope here.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

F8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
