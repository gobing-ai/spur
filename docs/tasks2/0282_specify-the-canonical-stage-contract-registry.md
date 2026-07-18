---
template: brainstorm
schema_version: 1
name: "Specify the canonical stage-contract registry"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:architecture", "stage-contract"]
dependencies: []
created_at: "2026-07-18T17:29:34.862Z"
updated_at: "2026-07-18T18:37:50.429Z"
---

## 0282. Specify the canonical stage-contract registry

### Background

Type: wayfinder:grilling. Define the canonical reusable execution unit beneath commands, skills, workflows, dev-next, model routing, and context assembly. The stage registry must clarify ownership rather than create another orchestration engine. It should let platform adapters and workflows reference stable stage IDs while reasoning remains in skills and deterministic legality remains in CLI/gates. Inputs include the baseline inventory and existing ADR-022/ADR-028/ADR-031 boundaries. The deliverable is a versioned schema, ownership rules, examples, and validation/migration contract suitable for implementation review.

### Requirements
R1. Define stage identity, versioning, aliases, typed inputs/outputs, artifacts, reasoning skill, required references, deterministic gates, mutation class, timeout/retry, model eligibility/fallback, context layers, and observability fields.
R2. Define authority boundaries: registry describes a stage; workflow owns sequencing/state; skill owns reasoning; CLI/scripts own deterministic mutation and validation; adapters own platform syntax only.
R3. Specify compile-time/schema validation and cross-reference checks for missing skills, commands, gates, workflows, adapters, or artifact paths.
R4. Model inline, subprocess/pipeline, deterministic-only, HITL, and irreversible stages without lying about current-agent execution.
R5. Provide at least five representative stage examples spanning plan/refine, implement, test, review/verify, and wrap/dogfood.
R6. Define compatibility with explicit --agent/--model and current default-by-phase configuration.
R7. Reject registry designs that duplicate workflow graphs or embed long prose prompts.
R8. Produce an implementation-seam and migration checklist consumed by downstream tickets.
### Acceptance Criteria
Scenario: R3 Stage registry contract is implementation-ready
  Given the current command, skill, workflow, agent, gate, and context inventory
  When the canonical stage-contract registry is specified
  Then every lifecycle stage declares inputs, outputs, preconditions, gates, context layers, mutation permissions, model eligibility, retry/escalation policy, observability events, and owner
  And commands, workflows, dev-next, dogfood, and campaign execution reference the same stage identifiers
  And schema validation, versioning, extension, and compatibility rules are explicit
  And at least three representative current paths can be mapped without duplicating domain logic

Scenario: Registry errors fail before execution
  Given a stage has an unknown dependency, missing gate, invalid context layer, cyclic transition, or incompatible model policy
  When the registry is validated
  Then execution is rejected with actionable diagnostics before any corpus mutation or agent invocation
### Q&A
- Locked: the registry is the canonical unit of reuse; command markdown and workflow YAML remain entry/adaptation surfaces, not competing lifecycle authorities.
- Locked: gates remain explicit and cannot be weakened by a cheaper-model profile or a convenience command.
- Locked: stage model eligibility uses static minima plus adaptive start/fallback policy based on objective signals.
- Question to resolve: which properties are declarative data versus typed executable hooks, and where is the boundary validated?
- Question to resolve: how should compound operations such as dev-run expose substage events while preserving a single user-facing invocation?
- Question to resolve: what is the smallest registry schema that covers current paths without turning prose instructions into an opaque DSL?
- Non-goal: selecting concrete implementation modules before the baseline and provider contracts are available.
### Design
Selected direction: a typed, versioned declarative registry whose records describe stage contracts and reference a small set of named executors/validators. A stage record should include identity/version, purpose, input/output artifacts, allowed state transitions, preconditions, required gates, context envelope, side-effect class, retry budget, routing policy key, emitted events, compatibility aliases, and owner.

Separate three concerns: lifecycle semantics in the registry; host-specific presentation in thin Claude/Codex adapters; and execution mechanics in tested reusable skills/services. Registry consumers must validate the whole graph at load time and emit the same stage/run identifiers for observability.

Rejected directions: one giant universal command; workflow YAML as the only authority; prose-only conventions; or a fully programmable DSL that hides effects from static validation.
### Plan
1. Consume the 0280 inventory and identify stable lifecycle concepts versus wrapper-specific steps.
2. Draft the minimal schema and invariants, including versioning, aliases, ownership, and effect/gate declarations.
3. Map dev-plan, dev-run, dev-verify, dev-wrap, dev-next, and dogfood paths; record schema gaps instead of adding one-off escape hatches.
4. Define validation failure modes and deterministic registry resolution.
5. Specify host adapter and executor interfaces plus emitted stage lifecycle events.
6. Review against context-envelope, routing, campaign, workflow, and migration tickets; resolve ownership overlap.
7. Produce implementation slices and contract tests for the synthesis ticket, without implementing them here.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
Validated with the concrete evidence artifact `.spur/run/wayfinder-O/implementation-evidence.md:5`, `spur task check` for each WBS, `spur workflow validate config/workflows/wayfinder-resolution.yaml`, `dist/cli/spur feature check O --json`, and the final repository quality gate. These are research/specification tasks; runtime code tests are not applicable until the synthesized build tasks are created.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- `plugins/sp/commands/`, especially dev-plan, dev-run, dev-verify, dev-wrap, dev-next, and dev-dogfood
- `plugins/sp/skills/`, especially spur-dev, next-router, super-coder, code-verification, and dogfood-testing
- `.spur/workflows/` current state and action definitions
- `docs/03_ARCHITECTURE.md` entry-point/domain-logic boundaries
- Ticket 0280 baseline and ticket 0281 telemetry semantics
- Feature N and tasks 0270–0279 for preserved contracts
### History
- 2026-07-18T18:24:07.205Z todo → done (system)
- 2026-07-18T18:27:40.190Z done → todo (system)
- 2026-07-18T18:35:15.541Z todo → done (system)
- 2026-07-18T18:37:50.429Z done → todo (system)
