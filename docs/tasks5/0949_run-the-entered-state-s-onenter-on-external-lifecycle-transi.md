---
schema_version: 1
name: Run the entered state's onEnter on external lifecycle transitions so the feature-lifecycle verifying caller executes
status: todo
template: issue
created_at: 2026-09-24T18:15:51.414Z
updated_at: "2026-09-24T18:16:13.079Z"
feature_id: H53

---

## 0949. Run the entered state's onEnter on external lifecycle transitions so the feature-lifecycle verifying caller executes

### Background

Discovered while closing out task 0948 (E7 review findings). `config/workflows/feature-lifecycle.yaml`
wires the ADR-119 feature-scoped verification pass into the `verifying` state's `onEnter`
(task 0880: "entering verification RUNS the feature-scoped pass"). That caller never executes.

The only path `spur feature sync` / `spur feature advance` / `spur feature update` use is
`requestTransition` (`packages/app/src/workflow/lifecycle-adapter.ts:210`). The engine's
`evaluateAndCommit` (`@gobing-ai/ts-dual-workflow-engine` dist/service.js:228-288) evaluates the
transition GUARD and commits the state snapshot, and deliberately runs no `onEnter` actions — its own
comment: "An external transition is a single guarded hop on an existing run, not a run itself."
`onEnter` is executed only by `StateMachineDriver` (dist/state-machine.js:65).

Consequences, all observed on a real transition:

1. No `feature-verification` run is ever created by the lifecycle (DB count 0 after a real
   active → verifying sync).
2. No `feature-latest` receipt is written, so `feature check <id> --strict --as done` denies with
   "no feature-latest receipt" — the `verifying → done` guard can never pass through
   `spur feature sync`, which is the documented path.
3. Task 0880's R1 evidence was a static assertion on the YAML caller text
   (`feature-verification-scope.test.ts`), and the receipt/guard tests seed receipts by hand
   (`packages/app/tests/workflow/feature-lifecycle-adapter.test.ts`) — so the dead code was never
   caught.

Scope note: `feature-lifecycle.yaml` is the ONLY lifecycle workflow that declares `onEnter`
(`verifying -> shell`); `task-lifecycle.yaml` declares none, so the runtime blast radius is one
action in one workflow.

### Requirements

- [ ] R1. An external lifecycle transition that enters a state declaring `onEnter` must execute those actions, so `spur feature sync <id>` entering `verifying` actually runs `feature-verification.yaml` and records the receipt.
- [ ] R2. The entered-state action execution must reuse the driver's action semantics (var/env resolution for shell commands, declared error policy) rather than reimplementing them — the engine's `__wfShellEnv` option key and `resolveShellCommandTemplates` are not exported, so a Spur-side copy would couple to unexported internals.
- [ ] R3. `spur feature sync <id>` alone must move a feature in `verifying` whose tasks are terminal to `done`, with the receipt produced by the lifecycle invocation and no manual pass run (task 0948 AC1).

### Acceptance Criteria

- [ ] AC1 — A feature entering `verifying` through the lifecycle records a feature-latest receipt (req: R1)
- [ ] AC2 — A feature in `verifying` with terminal tasks reaches `done` via `spur feature sync <id>` alone, receipt written by the lifecycle invocation (req: R3)
- [ ] AC3 — The entered-state action runs with the same var/env resolution the driver uses, asserted by a test rather than by reimplementing the resolution (req: R2)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] P1. Decide the owner: add an engine capability (external transitions optionally run the entered state's `onEnter`) or an exported action-sequence entry point. Prefer the engine facade per AGENTS.md ("fix their facades instead of adding Spur workarounds").
- [ ] P2. If the engine exposes it, call it from `lifecycle-adapter.requestTransition` after a successful commit and surface an action failure as a transition denial with a named report.
- [ ] P3. Add the missing regression: drive a real active → verifying sync against a fixture and assert a receipt + a `verifying → done` success (today's tests seed receipts by hand, which is why the dead code survived).

### Root Cause

`requestTransition` never runs the entered state's `onEnter`, so the `verifying` onEnter caller in
`config/workflows/feature-lifecycle.yaml` is dead code.

Evidence:
- `packages/app/src/workflow/lifecycle-adapter.ts:210` — `svc.requestTransition(workflow, runId, to, { workdir })` is the only transition path for features and tasks.
- engine `dist/service.js:228-288` (`evaluateAndCommit`) — resolves vars, evaluates the guard, commits the state; no action execution.
- engine `dist/state-machine.js:65` — `runActionSequence(current.onEnter ?? [], ...)` is the only `onEnter` executor, and it lives in the driver.
- Observed: `spur feature sync F21` from `active` produced a `feature-lifecycle` run row and 0 `feature-verification` run rows; `.spur/run/F21-feature-verification.json` was never written; the subsequent `verifying → done` guard denied with "no feature-latest receipt".

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
