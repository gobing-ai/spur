---
template: brainstorm
schema_version: 1
name: "Map and simplify .spur workflows onto canonical stages"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:workflow", "simplification"]
dependencies: []
created_at: "2026-07-18T17:29:34.902Z"
updated_at: "2026-07-18T18:28:36.750Z"
---

## 0288. Map and simplify .spur workflows onto canonical stages

### Background

Type: wayfinder:research. Review all nine .spur/workflows plus seeded template counterparts against the canonical stage model. Identify duplicated natural-language prompts, overlapping phase ownership, repeated gates/checks, nested or delegated loops, inconsistent agent selection, checkpoint friction, and behavior that belongs in a stage contract, CLI, or skill. Preserve lifecycle FSM legality, no-nesting, resumability, HITL taxonomy, bounded retries, and feature/task traceability. The output is a current-to-target mapping and simplification plan, not YAML changes.

### Requirements
R1. Inventory every workflow state, transition, action, guard, artifact, retry loop, timeout, agent selection, and terminal condition.
R2. Classify workflows as phase pipeline, entity lifecycle, umbrella, docs/wrap, or sample; document ownership and consumers.
R3. Map each agent.run prompt to canonical stages and identify duplicated or unstable prompt scaffolding.
R4. Identify redundant workflows/states and candidate consolidation while preserving phase boundaries and no-nesting.
R5. Verify lifecycle mutations remain CLI-gated and --no-lifecycle stays pipeline-internal only.
R6. Define how stage-level model policy replaces one agent variable without breaking explicit override or workflow validation.
R7. Define seeded-project migration and template/monorepo alignment requirements.
R8. Produce a dependency-ordered workflow migration table with preserve/remove/replace rationale and verification commands.
### Acceptance Criteria
Scenario: R9 Workflow simplification preserves lifecycle gates
  Given the nine current .spur/workflows and the canonical stage registry
  When workflow states/actions are mapped and a simplified target set is proposed
  Then every retained transition references a canonical stage or explicit orchestration primitive
  And duplicated prompt/domain logic is removed from workflow definitions
  And CLI-only corpus mutation, approval, verification PASS, failure, cancellation, resume, and audit semantics remain explicit
  And each workflow has a justified owner, trigger, terminal states, compatibility impact, and test strategy

Scenario: Workflow removal is evidence-backed
  Given a current workflow is proposed for merge, replacement, or retirement
  When the target mapping is reviewed
  Then all inbound references, stored run compatibility, operational recovery paths, and migration/rollback behavior are accounted for

Scenario: R14 — Workflows are orchestrated through spur workflow
  Given a simplified or newly composed lifecycle workflow
  When its execution path is specified
  Then `spur workflow` remains the driver and canonical orchestration boundary
  And driver, workflow, and stage-contract changes preserve resumability, HITL gates, and auditability
  And no plugin command, skill, or campaign introduces a competing workflow runner
### Q&A
- Locked: workflows orchestrate canonical stages; they do not duplicate the stage’s full instructions, routing policy, or context contract.
- Locked: simplification must preserve or strengthen gates and auditability, not merely reduce file count.
- Locked: current stored workflow runs and CLI contracts require explicit compatibility treatment.
- Question to resolve: which of the nine workflows represent distinct durable state machines versus convenience sequences that belong in the stage registry or campaign layer?
- Question to resolve: which transition/action semantics are imposed by the dual-workflow engine and cannot be collapsed safely?
- Question to resolve: how should failed, interrupted, blocked, or manually approved runs resume after target-state migration?
- Question to resolve: which platform adapters need workflow awareness versus only stage invocation?
### Design
Selected method: build a current-to-target transition matrix. For every workflow state/action, record purpose, canonical stage, preconditions, effects, gate, terminal/error behavior, callers, persisted data, and migration disposition (`retain`, `thin`, `merge`, `move`, or `retire`). Propose the smallest set that preserves genuinely durable lifecycle state.

Target workflow definitions should contain orchestration topology and engine-required metadata only. Stage contracts own execution semantics; campaign manifests own experiment matrices; commands own presentation/intent adaptation.

Rejected shortcuts: deleting apparently unused YAML without reference/run analysis; merging workflows solely by name similarity; or moving workflow logic into dev-next prose.
### Plan
1. Parse all current workflows, transitions, actions, agent.run calls, callers, tests, and persisted run shapes.
2. Map each action to canonical stages and flag duplicated, ambiguous, engine-specific, or unsupported semantics.
3. Define the minimal target workflow set and current-to-target disposition matrix.
4. Analyze active/historical run compatibility, resume/cancel/error paths, schema/version needs, and rollback.
5. Specify validation, dry-run, transition, recovery, and audit tests for each retained or migrated workflow.
6. Cross-check dev-next, dogfood campaign, and model-routing boundaries to prevent ownership leakage.
7. Hand a dependency-ordered migration plan to tickets 0289 and 0291 without editing workflows here.
8. For every retained, merged, or new workflow, document the exact `spur workflow` driver invocation, driver version/contract, and any required driver enhancement; reject designs that rely on an out-of-band runner.
### Solution
Execution status: reopened. Prior charting/specification artifacts exist, but implementation/resolution work has not been completed. The task contract is in the corresponding WBS file under `docs/tasks2/:1`; Feature O is defined in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`; the reusable driver is `config/workflows/wayfinder-resolution.yaml:1`. Continue execution through the workflow before claiming completion. No plugin implementation has been changed yet.
### Testing
Not complete — only structural checks have run. `spur task check` and `spur workflow validate config/workflows/wayfinder-resolution.yaml` pass for the current artifacts, but no implementation/resolution evidence has been produced yet. Re-run substantive verification after execution.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: OPEN — the prior status transition was reversed because implementation/resolution evidence is still missing. Re-review after the task's workflow execution completes.
### References
- `.spur/workflows/` (all nine current workflow files)
- Workflow CLI design and `sp:spur-cli` workflow contract
- Dual-workflow engine integration and persisted run schema
- Ticket 0280 inventory and ticket 0282 canonical stage registry
- Ticket 0283 dev-next surface and ticket 0287 campaign boundary
- Ticket 0289 migration/rollback and feature O scenarios R3, R4, R8–R10, and R12
### History
- 2026-07-18T18:24:07.796Z todo → done (system)
- 2026-07-18T18:27:40.790Z done → todo (system)
