---
schema_version: 1
name: Require project ownership before registry and CLI cleanup signal a listener
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:30.396Z
updated_at: "2026-10-10T07:31:03.505Z"
feature_id: K3

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
---

## 1156. Require project ownership before registry and CLI cleanup signal a listener

### Background

Registry list automatically terminates whatever PID owns a stale deleted project port, and CLI stop has the same unverified port-to-PID boundary Evidence: `packages/app/src/services/project-registry.ts:600` (discovery) and `packages/app/src/services/project-registry.ts:605` (signal). Review a71c confirmed this using injected port/PID/signal seams that recorded ordinary list sending SIGTERM to an unrelated PID. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Require verified Spur server and exact project ownership before signaling any process in refresh or CLI stop; make unverified listeners non-destructive
- [ ] R2. Existing project listings and verified owned-server cleanup remain supported, and foreign listeners survive
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a deleted project registry entry whose recorded port now belongs to an unrelated process
  When list, refresh, or stop observes that port
  Then no signal is sent to the foreign listener and the stale registration is handled without claiming termination

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given a positively identified Spur server owned by the selected project
  When the existing supported operation executes
  Then Existing project listings and verified owned-server cleanup remain supported, and foreign listeners survive
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Require verified Spur server and exact project ownership before signaling any process in refresh or CLI stop; make unverified listeners non-destructive Chosen direction follows the existing local seams. Reject trusting port occupancy or process name alone as ownership. Targets: packages/app/src/services/project-registry.ts; apps/cli/src/commands/projects.ts; corresponding project-registry and projects tests. Out of scope: general process supervision, public command changes, schemas.

### Plan

1. Add a failing regression for AC1 using injected port/PID/signal seams that recorded ordinary list sending SIGTERM to an unrelated PID.
2. Implement the chosen direction in packages/app/src/services/project-registry.ts; apps/cli/src/commands/projects.ts; corresponding project-registry and projects tests.
3. Run project-registry.test.ts and CLI projects tests from its workspace and confirm AC1 plus existing happy paths; run the project gate.

Inspect the existing project server ownership/health handshake before choosing the proof; use it rather than inventing a second identity scheme. Test PID/port reuse between discovery and termination.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`packages/app/src/services/project-registry.ts:600` (discovery) and `packages/app/src/services/project-registry.ts:605` (signal)

- `apps/cli/src/commands/projects.ts:427` — fuser discovery.
- `apps/cli/src/commands/projects.ts:444` — unverified PID signaling.
- `apps/cli/src/commands/projects.ts:452` — success reporting.

### History

- 2026-10-10T07:29:34.355Z backlog → todo (system)

