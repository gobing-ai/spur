---
schema_version: 1
name: Inventory and probe project fleet identity, delivery, and legacy migration
status: todo
template: feature-impl
created_at: 2026-09-11T18:07:39.267Z
updated_at: "2026-09-11T18:45:28.826Z"
feature_id: G6
priority: P1
tags:
  - wayfinder:research

---

## 0828. Inventory and probe project fleet identity, delivery, and legacy migration

### Background

G6's project-centered direction was approved by Robin on 2026-09-11. This task establishes the current runtime and migration facts that 0829 and 0830 consume; it does not implement the future control plane.

Current-tree premises checked during ready refinement: GlobalAgentBar.handleSubmit clears a draft and displays a stub notice; TeamService.sendMessage enqueues without requiring a recipient spec; drainIntoPrompt changes queued messages before runAgentLoop calls AgentService.run. The launch-role vocabulary is currently closed to scribe/coder/reviewer/planner; orchestrator is not an accepted role value. These are source observations, not a completed end-to-end fault investigation.

The approved policy is rest draining active work, GTD dispatching already-authorized eligible tasks, and Spur-managed loops in v1. Existing ADRs still govern production behavior until an implementation design supersedes them.

### Requirements

- [ ] R1. Produce a source-cited inventory of the project registry → config/spec → supervisor → loop → inbox → run/result path, including every CLI/HTTP/Board/plugin entry point, cwd/DB isolation, role propagation, mailbox identity, and occupant replacement.
- [ ] R2. Produce runnable isolated evidence for drain-before-spawn, nonzero/throwing invocation, duplicate submission, competing consumers, stale-generation wait, and completion-without-notification. Record both actual behavior and the desired recovery invariant; do not label an unimplemented invariant as passing.
- [ ] R3. Produce a preserve/convert/retire matrix covering team config, generated/manual/orphan specs, duplicate roles, roster reordering, conflicting worktree paths, legacy CLI/routes, workspace schema consumers, and unfinished related work. Distinguish inventory facts from an unchosen cutover policy.
- [ ] R4. Deliver an ownership-correct extension and migration proposal, including reversible conversion, stable-ID preservation, rollback constraints, and explicit handoff inputs for 0829 and 0830.

Out of scope: production fixes, new public APIs/roles/config keys, schema migrations, dependency changes, live agent invocation, host registry/config writes, and execution of downstream tasks.

### Acceptance Criteria

- [ ] R1: Given the checked-out source and consuming-workspace dependencies, when the report is read, then every hop and caller category in R1 has an owner, source citation, identity/context carrier, and evidence classification.
- [ ] R2: Given isolated fake-executor probes, when their documented commands run, then all six fault categories are reproducible with observed state and call counts; duplicate submission and duplicate consumption are distinguished, and unmet target invariants are explicitly named.
- [ ] R3: Given the legacy inventory, when migration coverage is reviewed, then every R3 category has a disposition, conflict/rollback note and source evidence, while live data and old task statuses remain unchanged.
- [ ] R4: Given the completed report, when 0829 or 0830 starts, then Handoff provides capability limits and observable state/control mappings; each proposed extension names its owning package and deferred cutover decisions have an owner.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T18:45:28.589Z

Ready-depth refinement, 2026-09-11:
- CLOSED — Robin's approval establishes the project-centered direction, rest/GTD defaults, managed-loop boundary, and three-view Projects structure; do not ask for these again.
- CLOSED — This investigation proves current behavior and produces a migration proposal; it does not fix the delivery gap or introduce the new role.
- CLOSED — A passing characterization proves an observation, not conformance to the future delivery guarantee.
- DEFERRED — Robin chooses the breaking cutover/compatibility window after this report. That decision does not block inventory or fault probes.
- DEFERRED — Exact production schema/API changes remain downstream design work; Handoff must identify the smallest missing primitives.

### Design

#### WHAT / WHY / WHERE

Deliver a current-state report at `docs/reports/g6-runtime-inventory.md`. Freeze report sections as: Provenance; Runtime path; Fault probes; Migration matrix; Handoff. No new production API.

Primary source targets are `packages/config/src/projects.ts`, `packages/config/src/index.ts`, app services `project-registry.ts`, `project-start.ts`, `team-service.ts`, `supervisor-service.ts`, `agent-service.ts`, `occupant-wait.ts`, and `system-event-follow.ts`; CLI commands agent/message/team/projects/self; server modules messages/team; and Board GlobalAgentBar/ProjectSwitcher/Workspace/Inbox/Teams. Trace references from these owners into contracts, plugin commands/skills/hooks, and domain schema/DAOs rather than treating names as ownership.

Use existing test seams: `createCliContext` with explicit isolated cwd and dbUrl; `runAgentLoop` with maxIterations/fake sleep and AgentRunDeps; app `createMigratedDb`; supervisor fake ProcessExecutor; and occupant-wait fake clock/pins. Extend the relevant existing workspace test files with a clearly identified G6 characterization block only where current tests do not demonstrate a required probe. Candidate files: `apps/cli/tests/commands/agent-team.test.ts`, `packages/app/tests/services/team-service.test.ts`, `supervisor-service.test.ts`, and `occupant-wait.test.ts` in that same services directory. Do not create a parallel test harness.

#### Probe contract

For each R2 case record setup, call boundary, injected fault, observed queue status/count, number of fake invocations, run/pin/result state, command, exit code, and interpretation. Observe current behavior with assertions; if it violates the target design, the characterization may pass while the target invariant is explicitly unmet. Do not weaken existing tests or silently fix the implementation.

Duplicate submission and competing consumers are separate cases. The first checks whether two same-body requests receive distinct message IDs; the second checks whether the same queued row is claimed more than once. For completion-before-notification suppress the notification sink after persistent state is written and inspect what survives. If no durable completion-to-message association exists, demonstrate that absence and name the seam; do not manufacture a receipt table to make the probe work.

Use in-memory SQLite for DAO cases and a task-owned temporary SQLite file only when reopen/two-connection behavior is essential. Resolve installed ts-db/ts-ai-runner from the consuming workspace and record version/path. Supply explicit test environment/config so inherited SPUR_ROLE, config skip flags, and real project/global paths cannot contaminate results. Assert no external executor is invoked.

#### Migration and handoff

Migration matrix columns: existing surface/identity; current owner and callers; target owner; preserve/convert/retire; conflict condition; rollback constraint. Use task/feature show/list through Spur to inspect G4, M3, M6, K1/K2 and A7; use returned filePath rather than searching task directories. No historical status changes.

Handoff must distinguish existing primitives, absent primitives, and proposed extensions, with source/test evidence for each. 0829 consumes delivery/identity/wakeup capability limits; 0830 consumes observable state meanings and the retained-controls/route mapping. Adding a literal orchestrator role requires a later production surface change; the prototypes can use an explicit orchestrator binding to a planner-role instance. Preserve current spec IDs during migration analysis.

Execution budget: one bounded inventory pass, then one focused probe pass; checkpoint report plus commands under `.spur/run/0828/` after 60 minutes if incomplete, then resume unmet rows. This is a progress checkpoint, not permission to certify partial work. Production mutationPolicy: none; allowed deliverables are the report, targeted characterization checks, and task evidence. requireDiff is satisfied by those artifacts; do not invent a runtime fix.

### Plan

- [ ] R1: Read approved G6, owning ADRs/satellites and current manifests; record commit, source-local CLI and consuming-workspace dependency provenance.
- [ ] R1/R3: Trace callers and ownership; fill Runtime path and Migration matrix, resolving related task records through Spur.
- [ ] R2: Reuse existing fake-executor/DB/pin fixtures; add only missing characterization cases and run them inside their owning workspaces.
- [ ] R2/R4: Compare observations with approved invariants; record missing guarantees and recovery limits without implementing them.
- [ ] R3/R4: Complete Handoff and reversible migration proposal. Check every cited path, probe command and required matrix row; verify the report and task evidence before closing this investigation.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- [G6 — Projects and agent fleet unification design](../features/G6_projects-and-agent-fleet-unification-design.md)
- [Approved design direction](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
- [ADR-022, ADR-037, ADR-052, ADR-057 and ADR-058](../00_ADR.md)
- [Inter-agent control plane](../design/inter-agent-control-plane.md)
- [Project switcher](../design/project-switcher.md)
- [Workspace ownership](../design/workspace-design.md)
- [Role vocabulary and validation](../../packages/config/src/index.ts)
- [Existing loop characterization seam](../../apps/cli/tests/commands/agent-team.test.ts)
- Handoff: 0829 — Prototype rest and GTD dispatch traces with capacity and restart failures; 0830 — Prototype Projects conversation, agents, work, and global input interactions.

### History
