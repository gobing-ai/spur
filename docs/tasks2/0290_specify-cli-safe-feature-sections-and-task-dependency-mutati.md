---
template: brainstorm
schema_version: 1
name: "Specify CLI-safe feature sections and task dependency mutation"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:corpus", "cli-gap"]
dependencies: []
created_at: "2026-07-18T17:29:34.916Z"
updated_at: "2026-07-19T23:53:47.509Z"
---

## 0290. Specify CLI-safe feature sections and task dependency mutation

### Background

Type: wayfinder:research. Charting exposed two corpus-contract gaps: task frontmatter supports dependencies[] and task-check enforces it, but task create/update/batch-create expose no dependency write; feature update replaces only existing sections, so a newly created wayfinder feature cannot add the five canonical map sections without a forbidden direct edit. Specify the smallest CLI-safe contract that lets wayfinder and decomposition author validated blocking edges and map sections while preserving crash safety, lifecycle legality, refresh behavior, and write guards. No CLI implementation occurs in this ticket.

### Requirements
R1. Trace schemas, services, commands, docs, hooks, tests, and existing corpus behavior for dependencies[] and feature section replacement.
R2. Define supported dependency operations (set/add/remove/clear), validation of WBS existence/self-edge/cycles/duplicates, atomicity, JSON output, and exit codes.
R3. Decide whether batch-create accepts dependencies and how references to not-yet-allocated tasks are represented or resolved atomically.
R4. Define a CLI-safe way to initialize/add canonical wayfinder sections or an approved template/variant that creates them.
R5. Preserve task-write guard, section matrix, history/update timestamps, lifecycle readiness, feature refresh, and backwards compatibility.
R6. Specify documentation and schema SSOT updates so JSON schema/runtime/help cannot drift.
R7. Provide migration behavior for existing direct-authored dependency arrays and feature N-style maps.
R8. Produce acceptance tests and an implementation task split; record how feature O sequencing is represented until the gap ships.
### Acceptance Criteria
Scenario: R11 Dependency wiring has a CLI-safe contract
  Given task frontmatter supports dependencies and wayfinder features require explicit map sections
  When the current CLI create/update/batch schemas and feature section mutation behavior are evaluated
  Then the gap between persisted schema and writable CLI surface is documented with code/test evidence
  And a backward-compatible command/schema design supports dependency add/replace/remove and validated batch creation without direct corpus writes
  And feature section behavior either supports validated wayfinder sections or defines an explicit canonical representation
  And validation covers unknown WBS, self-edge, duplicate edge, cycle, atomic failure, ordering, and JSON output

Scenario: Corpus mutation remains harness-gated
  Given agents must not edit task/feature files directly
  When dependency graphs or wayfinder metadata are authored
  Then every supported mutation is available through a documented, testable CLI operation

Scenario: R15 — Spur CLI is the default execution capacity
  Given implementation, qualification, or operational automation needs an execution surface
  When a supported `spur` CLI command exists
  Then that command is used instead of a plugin-local script
  And `plugins/sp/scripts` is used only with explicit approval recorded in the owning task or rollout decision
  And a missing CLI capability becomes a CLI enhancement task rather than a silent bypass
### Q&A
- Observed constraint: task files persist `dependencies[]`, but current task create/update/batch-create surfaces do not expose dependency mutation and the batch schema rejects the field.
- Observed constraint: feature update can replace known sections but cannot add the wayfinder-specific Destination/Decisions/Fog/Out-of-scope headings as peer sections.
- Locked: do not bypass these gaps by directly editing corpus files; feature O records wayfinder metadata as subsections under Notes and title-based sequencing in task Plans.
- Question to resolve: should dependency mutation be dedicated verbs, repeatable flags, a validated JSON patch, or a combination?
- Question to resolve: should custom feature sections be schema-registered variants or should wayfinder define a canonical Notes substructure?
- Question to resolve: what concurrency and atomicity guarantees prevent lost updates during multi-agent batch wiring?
### Design
Selected evaluation direction: align CLI writable schemas with the domain schema while retaining explicit validation and machine-readable failure. Compare repeatable dependency flags and dedicated graph verbs against JSON batch mutation for discoverability, idempotency, atomicity, and automation. Define one canonical output shape for the resulting graph.

For feature sections, compare registered template variants with a documented structured Notes representation. The chosen contract must preserve parser/check compatibility, deterministic rendering, and future schema migration.

Rejected shortcuts: permitting direct YAML edits as an exception; accepting dependency text only in prose; silently ignoring unknown batch fields; or allowing arbitrary unvalidated Markdown headings to become schema.
### Plan
1. Trace task/feature domain schemas, CLI option parsing, batch schemas, repository services, renderers, checks, and tests.
2. Reproduce each gap with current CLI commands and capture JSON/error behavior.
3. Specify dependency mutation semantics, graph validation, atomicity, idempotency, and batch behavior.
4. Specify canonical wayfinder section representation and migration/compatibility behavior.
5. Design CLI help, JSON schemas, errors, unit/integration tests, and docs changes.
6. Show how feature O’s title-based sequencing would be converted to real WBS edges after implementation.
7. Hand a self-contained implementation slice to 0291; do not patch the CLI in this ticket/session.
8. Inventory every proposed script/subprocess path and label its `spur` CLI equivalent, required CLI/driver enhancement, or explicitly approved `plugins/sp/scripts` exception.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
**Per-Requirement Traceability**

| Requirement | Summary | Evidence |
|---|---|---|
| R1 | Trace schemas, services, commands, docs, hooks, tests, and existing corpus behavior for `dependencies[]` and feature section replacement | implementation-evidence.md:218 |
| R2 | Define dependency operations (set/add/remove/clear), validation of WBS existence/self-edge/cycles/duplicates, atomicity, JSON output, exit codes | implementation-evidence.md:218 |
| R3 | Decide whether batch-create accepts dependencies and how not-yet-allocated task references are represented or resolved atomically | implementation-evidence.md:218 |
| R4 | Define a CLI-safe way to initialize/add canonical wayfinder sections or an approved template/variant | implementation-evidence.md:218 |
| R5 | Preserve task-write guard, section matrix, history/update timestamps, lifecycle readiness, feature refresh, backwards compatibility | implementation-evidence.md:218 |
| R6 | Specify documentation and schema SSOT updates so JSON schema/runtime/help cannot drift | implementation-evidence.md:218 |
| R7 | Provide migration behavior for existing direct-authored dependency arrays and feature N-style maps | implementation-evidence.md:218 |
| R8 | Produce acceptance tests and an implementation task split; record feature O sequencing representation until the gap ships | implementation-evidence.md:218 |

Note: the 0290 evidence section (`## 0290 - CLI-safe mutation`, lines 216-219) is a single summary paragraph at line 218 with no per-requirement `[Rn]` tags; all eight requirements trace to that one evidence line.

**Acceptance Criteria Verification**

| Scenario | Verification |
|---|---|
| R11 Dependency wiring has a CLI-safe contract | Evidence at implementation-evidence.md:218 documents the CLI schema gap for `dependencies[]` and custom sections and specifies validated CLI operations with atomicity, idempotency, cycle/self-edge checks, and machine-readable errors; the implementation task split is handed to 0291 without direct corpus writes. |
| Corpus mutation remains harness-gated | Evidence at implementation-evidence.md:218 states every supported mutation must flow through validated CLI operations and that `plugins/sp/scripts` remains exception-only with explicit approval, preserving the CLI-gated corpus-write rule. |
| R15 - Spur CLI is the default execution capacity | Evidence at implementation-evidence.md:218 confirms CLI operations are the mutation surface and that script subprocess paths stay exception-only; a missing CLI capability is recorded as a CLI enhancement (deferred to 0291), not a silent bypass. |

Coverage: N/A (specification task)
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- Task frontmatter/domain schema containing `dependencies[]`
- Task create, update, batch-create command implementations and input validators
- Feature update section parser/renderer and template schema
- `sp:spur-cli` task and feature authoring contracts
- Project `AGENTS.md` CLI-gated corpus-write rule
- Feature O Notes representation and scenarios R11–R13
### History
- 2026-07-18T18:24:07.992Z todo → done (system)
- 2026-07-18T18:27:40.993Z done → todo (system)
- 2026-07-18T18:35:16.361Z todo → done (system)
- 2026-07-18T18:37:51.260Z done → todo (system)
- 2026-07-19T23:53:42.378Z todo → wip (system)
- 2026-07-19T23:53:44.952Z wip → testing (system)
- 2026-07-19T23:53:47.509Z testing → done (system)
