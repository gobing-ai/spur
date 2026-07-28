---
template: brainstorm
schema_version: 1
name: "Design the golden-path command surface around dev-next"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H5
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:ux", "dev-next"]
dependencies: []
created_at: "2026-07-18T17:29:34.868Z"
updated_at: "2026-07-28T00:32:26.218Z"
---

## 0283. Design the golden-path command surface around dev-next

### Background

Type: wayfinder:grilling. Simplify operator burden without deleting the recently delivered dev-next intent or creating a mega-router prompt. Define a small golden-path lifecycle surface and mechanically thin compatibility wrappers over stage contracts. dev-next remains the primary status-aware front door with one primary dispatch, explicit HITL ambiguity, --dry-run/--once/--full behavior, and no second FSM. Audit every current command for core, advanced, alias, merge, or deprecation disposition. The output is an implementation-ready surface/adapter design and migration table.

### Requirements
R1. Classify all 28 commands by operator job, current owner, duplicated logic, proposed canonical stage(s), and keep/merge/alias/deprecate disposition.
R2. Define the golden-path core, including dev-next, without requiring users to understand workflow internals.
R3. Preserve dev-next one-primary-dispatch, multi-candidate HITL stop, child-owned --next chains, explicit overrides, and non-routes.
R4. Specify Claude Code slash and Codex dollar-skill adapters generated or validated from common metadata; wrappers contain no domain workflow prose.
R5. Define discoverability, help, error, dry-run/explain, and compatibility behavior.
R6. Provide deprecation evidence requirements and rollback rules; no command is removed solely to hit a count target.
R7. Map platform/skill snapshot invalidation and fresh-session dogfood needs.
R8. Produce an adapter drift test plan and exact documentation ownership changes.
### Acceptance Criteria
Scenario: R4 Golden path preserves dev-next intent
  Given a task or feature at any supported lifecycle state
  When the user invokes dev-next through Claude Code or Codex
  Then the router performs at most one bounded canonical dispatch
  And reports current state, selected stage, reason, required confirmation or blocker, and next observable outcome
  And explicit specialist commands remain thin compatibility/escape-hatch adapters
  And no quality gate, CLI-only write rule, verification requirement, or human decision boundary is bypassed

Scenario: Ambiguity does not create an autonomous loop
  Given multiple plausible next stages or missing evidence
  When dev-next resolves the route
  Then it stops with a bounded recommendation or required choice
  And does not recursively invoke itself or silently execute multiple lifecycle transitions
### Q&A
- Locked: keep `plugins/sp/commands/dev-next.md` and its intent as the primary low-burden front door.
- Locked: one invocation selects and dispatches at most one stage; “all-in-one” means one interface, not an unbounded autonomous loop.
- Locked: specialist `/sp:dev-*` and `$sp-dev-*` surfaces may remain where they provide explicit control, debugging, or compatibility.
- Question to resolve: which current commands belong in the documented golden path, advanced surface, compatibility alias set, or retirement candidates?
- Question to resolve: how should feature-frontier routing expose several independent ready tasks without violating one-dispatch semantics?
- Question to resolve: which state transitions require user confirmation even if the next stage is deterministic?
### Design
Selected direction: dev-next is a status-aware facade over the canonical stage registry. It resolves a task WBS or feature frontier, evaluates objective readiness and blockers, chooses one eligible stage, and invokes its thin adapter/executor. The response contract is stable across Claude Code and Codex even when invocation syntax differs.

Define a surface taxonomy: golden path (`dev-next`, plan/idea intake where no corpus object exists); explicit pipeline controls for operators; diagnostic/recovery commands; and compatibility aliases with deprecation data. Every retained wrapper must state unique user value and delegate lifecycle semantics.

Rejected directions: deleting specialist commands wholesale; embedding complete stage instructions in dev-next; chaining until done; or routing based on model self-confidence.
### Plan
1. Use the 0280 surface/call graph and feature N outputs to document current dev-next behavior and overlaps.
2. Define user journeys for new idea, planned feature, ready task, in-progress task, failed gate, verified task, and feature frontier.
3. Map each journey to exactly one registry stage and specify ambiguity/blocker/confirmation behavior.
4. Classify every current dev command as golden, explicit control, diagnostic/recovery, compatibility alias, or retirement candidate with migration impact.
5. Specify shared output and telemetry contracts for Claude Code slash commands and Codex skills.
6. Validate the design against cheap-model routing, workflow simplification, and shadow rollback requirements.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
**Per-Requirement Traceability** (re-audit under `--fix all`, post-fix)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `implementation-evidence.md` §0283 classification table — 28 commands across 8 dispositions by operator job (golden 3 / pipeline-control 5 / verify 4 / wrap 2 / diagnostic 6 / compat 5 / authoring 5-incl-overlap / deprecation 0) |
| R2 | MET | §0283 golden-path surface: dev-next + dev-idea/dev-plan intake; no workflow internals required |
| R3 | MET | evidence:165 one-dispatch + Q&A locks + AC2; specialist commands remain thin adapters |
| R4 | MET | §0283 adapters: Claude `/sp:dev-*` + Codex `$sp-dev-*` generated/validated from shared metadata; wrappers carry no domain workflow prose |
| R5 | MET | §0283 surface taxonomy (golden/explicit/diagnostic/compat) + discoverability via taxonomy + README index ownership |
| R6 | MET | §0283 deprecation rule: subsumption evidence + migration note + alias-retained rollback; no count-target removal |
| R7 | MET | §0283 snapshot invalidation: command `.md` snapshotted at session start; adapter version + fresh-session dogfood need |
| R8 | MET | §0283 drift test plan (contract / metadata-parity / no-prose grep gate) + doc ownership (README index, command flags, 04_DESIGN T3) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R4 Golden path preserves dev-next intent | MET | static-ref | evidence:165 (one bounded dispatch + state/reason/blocker/next) + §0283 adapters (thin escape-hatch wrappers) + Q&A locks (no gate bypass) |
| Scenario: Ambiguity does not create an autonomous loop | MET | static-ref | evidence:165 (resolves exactly one stage) + Q&A lock (one invocation selects at most one stage; not an unbounded loop) |

**Design conformance:** 3/3 claims DONE — dev-next facade over registry (evidence:165); surface taxonomy (§0283); rejected directions (Design + §0283 deprecation rule). No NOT-DONE claims.

**SECUA Review** — documentation-only change to a specification artifact; no security/efficiency findings. Correctness: the pre-fix UNMET gaps (R1/R4/R6/R7/R8) are repaired by the §0283 extension; all citations above were line-anchor re-read this run.

Coverage: N/A (brainstorm specification task; no runtime code path added).

Verdict: PASS
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- `plugins/sp/commands/dev-next.md`
- `plugins/sp/skills/sp-dev-next/` and `plugins/sp/skills/sp-next-router/`
- Feature N and completed tasks 0270–0279
- Current `/sp:dev-*` command index in `plugins/sp/README.md`
- Ticket 0282 canonical stage-contract registry
- Tickets 0288 workflow mapping and 0289 migration/compatibility
### History
- 2026-07-18T18:24:07.305Z todo → done (system)
- 2026-07-18T18:27:40.290Z done → todo (system)
- 2026-07-18T18:35:15.641Z todo → done (system)
- 2026-07-18T18:37:50.535Z done → todo (system)
- 2026-07-19T18:47:41.945Z todo → wip (system)
- 2026-07-19T18:47:56.206Z wip → testing (system)
- 2026-07-19T18:56:17.969Z testing → done (system)
