---
template: brainstorm
schema_version: 1
name: "Specify shadow qualification, compatibility, cutover, and rollback"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:migration", "shadow-mode"]
dependencies: []
created_at: "2026-07-18T17:29:34.909Z"
updated_at: "2026-07-19T23:53:35.167Z"
---

## 0289. Specify shadow qualification, compatibility, cutover, and rollback

### Background

Type: wayfinder:grilling. Convert the shadow-first decision into an operational migration contract. Current commands/workflows remain authoritative while candidate stage bindings run in non-mutating or isolated comparison mode. A stage cuts over only after token and quality qualification; compatibility wrappers remain until usage/evidence supports retirement; rollback restores the prior binding without corpus repair. Inputs are all architectural/evidence tickets, especially campaign, qualification, workflow, surface, and model-policy outputs.

### Requirements
R1. Define baseline, shadow, qualified, canary, default, deprecated, and retired states for stage bindings/adapters.
R2. Define evidence required for each transition, including verified outcome, fresh/total token guards, cache diagnostics, retries/escalations, P1/P2 findings, and representative cases.
R3. Define non-mutating shadow or isolated-worktree semantics so candidate runs cannot double-apply changes.
R4. Define compatibility behavior for current /sp:dev-* and $sp-dev-* names, explicit agent flags, workflows, configs, and seeded projects.
R5. Define per-stage rollback triggers, mechanics, retained artifacts, and operator messages.
R6. Define rollout order that starts with low-risk/high-repeat stages and never weakens review/verify gates to accelerate adoption.
R7. Define docs/ADR/design/versioning/release-note obligations and observability dashboards/reports.
R8. Produce a cutover checklist and risk register consumable by the synthesis ticket.
### Acceptance Criteria
Scenario: R10 Shadow migration is reversible
  Given a current path and proposed registry-based path for Claude Code or Codex
  When the proposed path runs in shadow or comparison mode
  Then it cannot perform duplicate irreversible effects
  And stage decisions, context fingerprints, model attempts, gates, outputs, tokens, duration, and verdicts can be compared with declared equivalence rules
  And cutover occurs independently per qualified stage/platform cohort
  And a documented kill switch and rollback restore the prior path without corpus corruption or loss of audit evidence

Scenario: Compatibility retirement is controlled
  Given a legacy command, skill, workflow, config, event, or stored run shape
  When migration disposition is proposed
  Then compatibility window, adapter behavior, warning/telemetry, removal criteria, and recovery path are explicit
### Q&A
- Locked: rollout is shadow-first with per-stage qualification, cutover, monitoring, and rollback.
- Locked: Claude Code and Codex are first live cohorts; other agent surfaces receive structural checks until separately qualified.
- Locked: shadow execution must not duplicate writes, approvals, external messages, commits, or other irreversible effects.
- Question to resolve: which stages can safely execute fully in shadow and which need decision-only, read-only, or replay-based comparison?
- Question to resolve: what constitutes outcome equivalence when wording differs but artifacts and gates agree?
- Question to resolve: how long must compatibility aliases and persisted workflow/run readers remain?
- Question to resolve: which regression thresholds trigger automatic rollback versus operator review?
### Design
Selected direction: introduce a versioned execution-path selector at the canonical dispatch boundary. Cohorts are keyed by stage, platform, registry version, context-envelope version, routing-policy version, and qualification result. Shadow modes are effect-aware: pure/read-only stages may run paired; mutating stages compare decisions or replay sanitized snapshots.

A comparison record links reference and candidate attempts and reports structural equivalence, critical gate agreement, behavioral rubric, fresh input, total tokens, retries/escalations, duration, and missing evidence. Cutover and rollback are configuration operations with immutable audit events.

Rejected directions: repository-wide flag-day replacement; shadowing that writes twice; one aggregate success threshold for all stages; or compatibility wrappers with no retirement criteria.
### Plan
1. Inventory compatibility surfaces: commands, skill names, workflows, config profiles, events, reports, stored run schemas, and external docs.
2. Classify each stage by effect risk and select paired, decision-only, replay, or structural shadow mode.
3. Define cohort selector, comparison identity, equivalence rules, thresholds, observation windows, and missing-evidence behavior.
4. Specify cutover prerequisites, kill switch, rollback procedure, data compatibility, and audit events.
5. Define per-stage/platform promotion order starting with low-risk deterministic stages.
6. Exercise failure scenarios: candidate crash, divergence, retry storm, false PASS, stale context, partial write, and schema downgrade.
7. Produce migration waves and rollback tests for final synthesis; no live cutover occurs in this ticket.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
**Per-Requirement Traceability**

| Requirement | Description | Evidence |
|---|---|---|
| R1 | Define baseline, shadow, qualified, canary, default, deprecated, and retired states for stage bindings/adapters | implementation-evidence.md:214 |
| R2 | Define evidence required for each transition, including verified outcome, fresh/total token guards, cache diagnostics, retries/escalations, P1/P2 findings, and representative cases | implementation-evidence.md:214 |
| R3 | Define non-mutating shadow or isolated-worktree semantics so candidate runs cannot double-apply changes | implementation-evidence.md:214 |
| R4 | Define compatibility behavior for current /sp:dev-* and $sp-dev-* names, explicit agent flags, workflows, configs, and seeded projects | implementation-evidence.md:214 |
| R5 | Define per-stage rollback triggers, mechanics, retained artifacts, and operator messages | implementation-evidence.md:214 |
| R6 | Define rollout order that starts with low-risk/high-repeat stages and never weakens review/verify gates to accelerate adoption | implementation-evidence.md:214 |
| R7 | Define docs/ADR/design/versioning/release-note obligations and observability dashboards/reports | implementation-evidence.md:214 |
| R8 | Produce a cutover checklist and risk register consumable by the synthesis ticket | implementation-evidence.md:214 |

**Acceptance Criteria Verification**

| Scenario | Status | Evidence |
|---|---|---|
| R10 Shadow migration is reversible | Verified by specification | implementation-evidence.md:214 - cohort-based migration with effect-aware safeguards against duplicate writes, per-stage/platform cutover, and rollback as configuration/audit operations |
| Compatibility retirement is controlled | Verified by specification | implementation-evidence.md:214 - cutover and rollback are configuration/audit operations with effect-aware safeguards preserving audit evidence |

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
- Tickets 0282–0288 target contracts and evidence inputs
- Current config model/executor profiles and command/skill packaging aliases
- Current workflow run/event/report persistence contracts
- Feature N compatibility commitments for dev-next and dogfood v1.2
- Project safety and CLI-only mutation contract in `AGENTS.md`
- Feature O scenarios R3–R10 and R12
### History
- 2026-07-18T18:24:07.893Z todo → done (system)
- 2026-07-18T18:27:40.890Z done → todo (system)
- 2026-07-18T18:35:16.258Z todo → done (system)
- 2026-07-18T18:37:51.157Z done → todo (system)
- 2026-07-19T23:53:30.059Z todo → wip (system)
- 2026-07-19T23:53:32.601Z wip → testing (system)
- 2026-07-19T23:53:35.167Z testing → done (system)
