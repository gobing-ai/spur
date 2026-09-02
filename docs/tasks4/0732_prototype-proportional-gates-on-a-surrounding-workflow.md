---
schema_version: 1
name: "Prototype proportional gates on a surrounding workflow"
status: todo
template: meta
created_at: 2026-09-02T03:05:58.109Z
updated_at: "2026-09-02T04:02:46.400Z"
feature_id: D8
priority: P1
tags: ["wayfinder:prototype", "workflow", "gates", "pilot"]
dependencies: ["0731"]
---

## 0732. Prototype proportional gates on a surrounding workflow

### Background

Use the top-ranked surrounding pilot and the completed contract, measurement, and fit evidence to test the proportional-gate idea before touching task-pipeline. The prototype is evidence for strategy selection, not a production migration.

### Requirements
- [ ] R1. Select the highest-ranked eligible real-caller surrounding pilot from 0731 and cite its closed prerequisite table; if none is eligible, stop with the exact missing repair rather than weakening the prototype.
- [ ] R2. Define the smallest closed two-path route table using existing deterministic facts: a fast path and a risk/uncertainty safety path. Every input has one route, and missing/unknown/conflicting evidence routes to safety with a bounded reason.
- [ ] R3. Execute the isolated prototype through the actual workflow engine and existing actions. Use an explicit `workflow validate` preflight while run/validate parity is unresolved; do not implement another YAML interpreter, public command, policy DSL, or production definition.
- [ ] R4. Carry an explicit prerequisite-repair manifest. The prototype must avoid known-broken primitives or exercise a separately approved minimal root-cause repair with a regression test; advisory findings, `softFail`, baselines, and stale artifacts cannot stand in for correctness.
- [ ] R5. Preserve trust-boundary checks and exact run-bound proof. Record route, inputs, skipped/escalated stages, failures, source/digest, and final evidence in existing or isolated run artifacts; do not claim safety from an untested timeout, proof binding, consolidated log, or action option.
- [ ] R6. Compare current and prototype graph facts separately from measured execution: model hops, deterministic actions, pauses, artifacts, failure behavior, active/wall time, token/cost coverage, human interventions, and visible route reasons. Do not present static deltas as measured savings.
- [ ] R7. Exercise the existing optional root `version` with one quoted non-empty opaque literal and one omitted fixture. Prove both validate and execute without behavioral dispatch, capture `explicit(<literal>)` versus `unversioned` beside source/digest in prototype evidence, and record current empty-string and list/show/run/continue/progress propagation gaps; add no registry or unsupported-version policy.
- [ ] R8. Record what the prototype proves, what remains unproven, and constraints inherited by `task-pipeline`. Retain at most one minimal fixture/executable regression check and remove only disposable prototype debris.
### Acceptance Criteria
- [ ] Pilot has a proven caller, closed prerequisites, lower blast radius than `task-pipeline`, and no dependency on an unresolved known defect.
- [ ] A closed deterministic route table sends unknown/conflicting inputs to the safety path and emits a bounded reason for every route, skip, or escalation.
- [ ] The actual engine executes the isolated prototype after explicit validation; no fake/inline interpreter or production workflow mutation is used.
- [ ] Any repaired primitive has one reproducing regression check; otherwise the pilot avoids it. No `softFail`, accepted baseline, or stale artifact masks a prerequisite.
- [ ] Before/after results distinguish structural graph changes from measured time/token/attention evidence and report missing coverage.
- [ ] Explicit and omitted `version` fixtures remain behaviorally equivalent, are reported as explicit versus unversioned beside the exact digest, and do not require a registry or current mandate.
- [ ] The retained fixture/check is the minimum evidence needed for 0733; `task-pipeline`, public CLI, and production definitions remain unchanged.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Prototype one closed route table beside production and execute it with the real engine. Unknown evidence takes the existing safety path. Reuse current actions and evidence formats only after their prerequisites are proven; keep one small fixture/check if it prevents regression, and delete the rest.
### Plan
- [ ] Load predecessor evidence and verify the top candidate's prerequisite table.
- [ ] Define the minimal closed route table and safety fallback.
- [ ] Build explicit/unversioned isolated fixtures from existing engine primitives.
- [ ] Validate and execute through the real engine, repairing only an approved prerequisite if unavoidable.
- [ ] Capture run-bound route/proof evidence and separate structural from measured deltas.
- [ ] Record conclusions, retain one minimal check, and remove disposable artifacts.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Task 0729 Solution — authority, baseline, surface-parity, and defect register.
- Task 0730 Solution — measurement validity, cohorts, and budgets/evidence gaps.
- Task 0731 Solution — workflow fit matrix, prerequisites, and pilot ranking.
- `config/workflows/`; `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/actions/`.
- `apps/cli/schemas/state-machine-workflow.schema.json`; `apps/cli/schemas/transition-workflow.schema.json`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`.
### History
