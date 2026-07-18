---
template: brainstorm
schema_version: 1
name: "Design the golden-path command surface around dev-next"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:ux", "dev-next"]
dependencies: []
created_at: "2026-07-18T17:29:34.868Z"
updated_at: "2026-07-18T18:28:15.488Z"
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
- `plugins/sp/commands/dev-next.md`
- `plugins/sp/skills/sp-dev-next/` and `plugins/sp/skills/sp-next-router/`
- Feature N and completed tasks 0270–0279
- Current `/sp:dev-*` command index in `plugins/sp/README.md`
- Ticket 0282 canonical stage-contract registry
- Tickets 0288 workflow mapping and 0289 migration/compatibility
### History
- 2026-07-18T18:24:07.305Z todo → done (system)
- 2026-07-18T18:27:40.290Z done → todo (system)
