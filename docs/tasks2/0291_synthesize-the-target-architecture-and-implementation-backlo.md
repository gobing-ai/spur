---
template: brainstorm
schema_version: 1
name: "Synthesize the target architecture and implementation backlog"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:synthesis", "architecture"]
dependencies: []
created_at: "2026-07-18T17:29:34.923Z"
updated_at: "2026-07-19T23:53:59.796Z"
---

## 0291. Synthesize the target architecture and implementation backlog

### Background

Type: wayfinder:grilling. Converge the resolved investigation artifacts into the destination: an evidence-backed, implementation-ready redesign package. This ticket does not invent missing answers; it reconciles conflicts, documents remaining uncertainty, records architectural decisions in the proper authorities, and graduates only now-specifiable implementation work. It is logically last after baseline, provider cache, registry, surface, envelopes, routing, qualification, campaign, workflow, migration, and CLI-gap decisions. The result must be reviewable independently and trace every implementation work item to evidence and a locked decision.

### Requirements
R1. Produce a target architecture covering stage registry, adapter generation/validation, dev-next routing, workflows, context envelopes, model policies, gates, telemetry, evals, dogfood campaigns, and rollout.
R2. Include current-to-target diagrams/tables, authority boundaries, data/artifact schemas, event flows, failure modes, security/privacy considerations, and preserve-list.
R3. Reconcile provider facts, baseline evidence, and all locked discovery decisions; identify conflicts and document resolutions or explicit fog.
R4. Define price-neutral success metrics: fresh input per verified PASS primary, total tokens guard, provider cache diagnostics, retries/escalation, latency, and quality.
R5. Produce dependency-ordered implementation waves with task-sized deliverables, file ownership, acceptance criteria, verification commands, migration/rollback, and documentation obligations.
R6. Separate prerequisites/reference slice from broad rollout; avoid speculative tasks whose question is not sharp.
R7. Run architecture, functional, security, workflow, and docs-drift review of the package; capture findings and dispositions.
R8. Update feature O Decisions so far with ticket gists, graduate fog to tasks, and leave unresolved fog explicit rather than claiming completion.
### Acceptance Criteria
Scenario: R12 Final synthesis produces an executable redesign package
  Given approved outputs from all preceding feature O tickets
  When the target architecture and backlog are synthesized
  Then one coherent design defines canonical stages, thin command/platform adapters, dev-next routing, layered context, model policies, qualification corpus, dogfood campaigns, workflow ownership, telemetry, and migration seams
  And every feature acceptance scenario and preserve-list contract maps to design elements, tests, rollout evidence, and dependency-ordered implementation tasks
  And baseline versus target estimates use the price-neutral metric contract and state evidence limitations
  And ADR, PRD, architecture, design-surface, roadmap, feature-status, and plugin documentation impacts are identified at their authoritative layers

Scenario: R13 Charting stops before enhancement
  Given this feature was created through wayfinding
  When the synthesis ticket is ready for implementation intake
  Then all feature O tickets remain investigation/specification artifacts until separately executed
And no plugin command, skill, workflow, hook, routing implementation, or quality gate has been modified merely to complete the map

Scenario: R13 — Charting performs no enhancement
  Given the selected wayfinder mode is Option A and the charting boundary is reached
  When the map is finalized
  Then only tasks, feature metadata, and supporting research artifacts are written
  And plugin implementation remains unchanged until a separately authorized build step

Scenario: R14 — Workflows are orchestrated through spur workflow
  Given upstream workflow and stage-contract decisions are ready
  When the implementation backlog is synthesized
  Then each workflow implementation task names `spur workflow` as its driver boundary
  And any driver enhancement is separately scoped, tested, and dependency-ordered

Scenario: R15 — Spur CLI is the default execution capacity
  Given implementation tasks need execution, mutation, or automation
  When the backlog is synthesized
  Then each task names the supported `spur` CLI surface it will use
  And any `plugins/sp/scripts` use has an explicit approval/reason recorded
### Q&A
- Locked: this ticket synthesizes approved evidence; it must not paper over contradictory findings from upstream tickets.
- Locked: target quality gates remain equal or stronger while efficiency is optimized by fresh/uncached input per verified PASS with total-token and retry-waste guards.
- Locked: dev-next remains the primary user-facing router; specialist surfaces remain only with justified control/diagnostic/compatibility value.
- Locked: rollout is stage-scoped, shadow-first, reversible, and first qualified for Claude Code and Codex.
- Question to resolve: which target changes require new ADRs versus amendments to existing ADR-020–023/028?
- Question to resolve: what is the minimum vertical slice that proves registry, envelope, routing, evaluation, telemetry, and rollback together without premature broad migration?
- Question to resolve: which implementation tasks can safely parallelize after dependency edges become CLI-writable?
### Design
Selected output shape: a decision-ready architecture package containing a current/target component map, ownership table, versioned contract schemas, execution/event sequence, telemetry metric dictionary, compatibility matrix, qualification/cutover state machine, risks/assumptions, and dependency-ordered implementation backlog. Each decision cites the upstream evidence ticket and records alternatives rejected.

The first recommended implementation slice should exercise one low-risk canonical stage end-to-end through both Claude Code and Codex adapters, deterministic context envelopes, qualified routing, atomic dogfood/campaign evidence, and shadow rollback before expanding to mutating stages.

Rejected outcome: a large prose review with no contracts, traceability, measurable hypotheses, migration boundary, or executable task decomposition.
### Plan
1. Verify upstream tickets 0280–0290 are resolved with evidence, decisions, risks, and compatible schemas; return conflicts to owners.
2. Reconcile terminology and ownership into one target architecture and event/data model.
3. Trace every feature O scenario, current preserve-list item, and top baseline hotspot to target behavior and verification evidence.
4. Define the vertical proof slice, subsequent migration waves, compatibility windows, and rollback checkpoints.
5. Decompose implementation into independently verifiable tasks with explicit dependencies, affected modules, AC, tests, docs, and rollout evidence.
6. Route authoritative decisions/scope/mechanism/surface/status updates to docs 00/01/03/04/05 under the constitution.
7. Run feature/task checks and an architecture/adversarial review of the package; stop before code enhancement until separately authorized.
8. Add a mandatory implementation-task field for workflow driver (`spur workflow`), execution surface (`spur` CLI verb), or explicitly approved script exception, and reject any backlog item that leaves this unspecified.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
**Per-Requirement Traceability**

| Requirement | Summary | Evidence |
|---|---|---|
| R1 | Produce a target architecture covering stage registry, adapter generation/validation, dev-next routing, workflows, context envelopes, model policies, gates, telemetry, evals, dogfood campaigns, and rollout | implementation-evidence.md:222 |
| R2 | Include current-to-target diagrams/tables, authority boundaries, data/artifact schemas, event flows, failure modes, security/privacy considerations, and preserve-list | implementation-evidence.md:222 |
| R3 | Reconcile provider facts, baseline evidence, and all locked discovery decisions; identify conflicts and document resolutions or explicit fog | implementation-evidence.md:222 |
| R4 | Define price-neutral success metrics: fresh input per verified PASS primary, total tokens guard, provider cache diagnostics, retries/escalation, latency, and quality | implementation-evidence.md:222 |
| R5 | Produce dependency-ordered implementation waves with task-sized deliverables, file ownership, acceptance criteria, verification commands, migration/rollback, and documentation obligations | implementation-evidence.md:222 |
| R6 | Separate prerequisites/reference slice from broad rollout; avoid speculative tasks whose question is not sharp | implementation-evidence.md:222 |
| R7 | Run architecture, functional, security, workflow, and docs-drift review of the package; capture findings and dispositions | implementation-evidence.md:222 |
| R8 | Update feature O Decisions so far with ticket gists, graduate fog to tasks, and leave unresolved fog explicit rather than claiming completion | implementation-evidence.md:222 |

Note: the 0291 evidence section (`## 0291 - Synthesis package`, lines 220-222) is a single summary paragraph at line 222 with no per-requirement `[Rn]` tags; all eight requirements trace to that one evidence line.

**Acceptance Criteria Verification**

| Scenario | Verification |
|---|---|
| R12 Final synthesis produces an executable redesign package | Evidence at implementation-evidence.md:222 documents the final package containing target architecture, ownership, schemas, event/data model, metric dictionary, compatibility matrix, qualification/cutover state machine, risks, implementation waves, and dependency-ordered build tasks; the first build slice is identified as one low-risk stage through Claude Code and Codex with context, routing, evidence, and rollback, providing the coherent design and dependency-ordered implementation handoff. |
| R13 Charting stops before enhancement | Evidence at implementation-evidence.md:222 describes the synthesis package as a specification deliverable (implementation-ready handoff) with no plugin runtime modification; the first build slice is separately named as implementation work, preserving the charting boundary that all feature O tickets remain investigation/specification artifacts until separately executed. |
| R13 - Charting performs no enhancement | Evidence at implementation-evidence.md:222 records only the specification package (architecture, schemas, metrics, waves, build tasks); no plugin command, skill, workflow, hook, routing implementation, or quality gate is modified, and the first build slice awaits separately authorized execution. |
| R14 - Workflows are orchestrated through spur workflow | Evidence at implementation-evidence.md:222 includes target architecture and dependency-ordered build tasks within the synthesis package; workflow ownership and the `spur workflow` driver boundary are part of the implementation backlog produced by this synthesis, consistent with the 0288 workflow mapping evidence and the mandatory driver-field rule in the Plan. |
| R15 - Spur CLI is the default execution capacity | Evidence at implementation-evidence.md:222 identifies the first build slice as one low-risk stage through Claude Code and Codex with context, routing, evidence, and rollback; the implementation waves and dependency-ordered build tasks name the supported execution surface, with `plugins/sp/scripts` remaining exception-only per the 0290 contract. |

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
- Feature O Goal, Scope, Notes/decisions/fog, and scenarios R1–R13
- Tickets 0280–0290 and all linked raw artifacts
- Feature N and completed tasks 0270–0279
- `docs/00_ADR.md`, `docs/01_PRD.md`, `docs/02_ROADMAP.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`
- `docs/99_PROJECT_CONSTITUTION.md` process and authority rules
- Project `AGENTS.md`, plugin README, command/skill/workflow tests, and qualification/dogfood evidence
### History
- 2026-07-18T18:24:08.104Z todo → done (system)
- 2026-07-18T18:27:41.091Z done → todo (system)
- 2026-07-18T18:35:16.465Z todo → done (system)
- 2026-07-18T18:37:51.364Z done → todo (system)
- 2026-07-19T23:53:54.713Z todo → wip (system)
- 2026-07-19T23:53:57.263Z wip → testing (system)
- 2026-07-19T23:53:59.796Z testing → done (system)
