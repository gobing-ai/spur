---
template: feature-impl
schema_version: 1
name: "Keep the executor binding through team spec materialization and drain"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0541"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.653Z"
updated_at: "2026-08-14T00:07:31.308Z"
---

## 0537. Keep the executor binding through team spec materialization and drain

### Background
Feature G4 shipped `--agent <specId>` addressing on top of the un-migrated executor substrate. The
result, verified 2026-08-13, is that a team spec loses its model and tier binding across **two lossy
hops**, silently:

1. **Materialization drops it.** `packages/app/src/services/team-service.ts:674-680` calls
   `resolveExecutor(member.executor, agentConfig)` and then writes `type: resolved.agent` into the
   spec — discarding `resolved.model` and the executor **name**.
2. **Drain flattens it again.** `drainIntoPrompt` (`apps/cli/src/commands/agent.ts:357-383`) maps
   `--agent <specId>` → `--agent spec.type`, i.e. the bare coding-agent kind, while stashing
   `spec-id` for the occupant pin (ADR-057 wave 1 R1).

On-disk proof in this repo: `.spur/config.yaml` declares `- executor: codex-sol` (tier `capable-3`,
model `gpt-5.6-sol`); `.spur/agents/demo-codex.yaml` stores only `type: codex`. The operator
configures a `capable-3` executor on a named model and the process that actually runs is bare `codex`
on its default model, reading as tier `standard` because nothing declared otherwise. No error, no
warning.

A second, related gap: `--agent` accepts an executor name, a binary name, **and** (under `--drain`) a
team spec id, and nothing validates that a spec id and an executor name do not collide.

Operator ruling 2026-08-13 (feature B2 § *Where a role may be declared*): keep the `--agent` flag
name, fix the binding, and close the ambiguity with a collision guard rather than a new flag.
### Requirements
- [ ] **R1.** Carry the executor **name** into the materialized agent spec alongside the
      coding-agent kind. `packages/app/src/services/team-service.ts:674-680` currently resolves
      `member.executor` and writes only `type: resolved.agent`, discarding the name and the model.
      The kind must stay (AiRunner resolves the runner from it, and existing specs carry only
      `type`). Measurable: a spec materialized from `- executor: codex-sol` records `codex-sol`;
      a pre-existing spec with no executor field still loads, under a shim registered per 0541.
- [ ] **R2.** Addressing a spec runs the executor the operator configured. Rewrite the drain
      selector (`apps/cli/src/commands/agent.ts:357-383`) to the spec's executor **name** instead of
      `spec.type`, so `resolveExecutor`'s executor-first lookup restores `{agent, model}` with its
      declared tier. Measurable: draining a spec bound to `codex-sol` runs on `gpt-5.6-sol` at tier
      `capable-3`, not bare `codex` at the undeclared default. Task 0536 later relocates this path
      from `--agent` to `--spec`; the binding fix carries forward unchanged.
- [ ] **R3.** The occupant pin does not regress. `spec-id` is still set before the selector rewrite,
      so `AgentService.executeRun` persists the ADR-057 wave 1 occupant record. Measurable: the
      occupant record still carries specId, agentKind, runId, and generation, and the existing G4 R1
      test still passes.
- [ ] **R4.** Reject namespace collisions at config load across **all three** selector namespaces —
      role names, executor names, and spec ids must be pairwise disjoint. This is what lets `--agent`
      accept roles and executor names in one flag without ambiguity. The role names are the four in
      `plugins/sp/references/roles.md`; guard against an operator naming an executor `coder` or a
      team member `planner`. Measurable: each of the three collision pairs fails to load with both
      colliding names in the message.
- [ ] **R5.** A spec referencing an executor absent from `agent.executors` fails loudly. Inject
      `isCanonicalAgent` on the spec resolution path so `resolveExecutor`
      (`packages/config/src/index.ts:276-282`) throws instead of returning a bare binary.
      Measurable: addressing such a spec exits non-zero naming the spec and the missing executor;
      no process spawns. `docs/04_DESIGN.md` records the spec shape and `--agent` resolution order
      in the same commit (T3).
### Acceptance Criteria
```gherkin
Scenario: R1 — A materialized spec retains its executor name
  Given a team member declares executor codex-sol
  When spur team up writes the agent spec
  Then the spec records the executor name codex-sol
  And the spec still records the coding-agent kind the runner needs

Scenario: R2 — Addressing a spec runs the executor the operator configured
  Given a spec whose executor is codex-sol at tier capable-3 on model gpt-5.6-sol
  When spur agent run --drain --agent <specId> starts an invoke
  Then the spawned process uses that executor's model
  And the run's resolved tier is capable-3, not the undeclared default

Scenario: R3 — The occupant pin survives the executor resolution
  Given ADR-057 wave 1 requires spec-id on the occupant record
  When the drain path rewrites the agent selector
  Then spec-id still names the spec
  And the occupant record retains specId, agentKind, runId, and generation

Scenario: R4 — A spec id colliding with an executor name is rejected at config load
  Given a team member id equal to a name in agent.executors
  When config is loaded
  Then loading fails naming both the colliding spec id and the executor name
  And no run is dispatched against the ambiguous selector

Scenario: R5 — An executor that no longer exists fails loudly
  Given a spec references an executor name absent from agent.executors
  When that spec is addressed
  Then the command exits non-zero naming the spec and the missing executor
  And it does not silently fall back to a bare coding-agent binary
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Root cause is one dropped field, not a redesign.** `agent.team[].members[].executor` already exists
and is already correct in config. Both hops discard it. Carry it instead.

**Hop 1 — spec materialization** (`team-service.ts:674-680`). Add the executor name to the spec
record alongside the kind. The kind must stay: `AiRunner` resolves the runner from it, and existing
specs on disk carry only `type`. New field, additive, existing specs keep working by falling back to
`type` when the executor field is absent (R1).

**Hop 2 — drain rewrite** (`agent.ts:357-383`). Rewrite `--agent <specId>` to the spec's **executor
name** rather than `spec.type`. `resolveExecutor` is executor-first, so the name resolves back to
`{agent, model}` with its declared tier intact (R2). When the spec carries no executor name (a
pre-existing spec), fall back to today's `spec.type` behavior so nothing breaks. Set `spec-id`
before the rewrite exactly as now — the occupant pin must not regress (R3).

**Collision guard (R4).** Validate at config load that no `agent.team[].members[].id` (or its derived
local id) equals any `agent.executors[].name`. Fail loud with both names. This is what closes the
`--agent` ambiguity without a flag split: the two namespaces are allowed to coexist precisely because
they are proven disjoint.

**Fail loud on a dangling executor (R5).** `resolveExecutor` already throws when given
`isCanonicalAgent` and an unmatched name (`packages/config/src/index.ts:276-282`); the spec path does
not inject the predicate. Inject it so a renamed executor surfaces as an error rather than as a bare
binary on a default model — the exact silent downgrade this task exists to remove.

**Not in this task:** declaring an `intention` on team members. That is 0538, alongside every other
declaration site, and it needs 0535's vocabulary. This task is the binding fix only, which is why it
has no dependency and can ship first.
### Plan
- [ ] Carry the executor name into the materialized spec alongside the coding-agent kind (R1)
- [ ] Fall back to `type` when a pre-existing spec carries no executor name (R1)
- [ ] Rewrite the drain selector to the spec's executor name instead of `spec.type` (R2)
- [ ] Keep `spec-id` set before the rewrite so the occupant pin is unchanged (R3)
- [ ] Add a config-load guard rejecting a spec id equal to an executor name, naming both (R4)
- [ ] Inject `isCanonicalAgent` on the spec resolution path so a dangling executor throws (R5)
- [ ] Add tests: model survives the round trip, tier resolves capable-3, occupant pin intact, collision rejected, dangling executor exits non-zero (R1-R5)
- [ ] Add a regression test asserting a spec materialized from `executor: codex-sol` does not run bare `codex`
- [ ] Update `docs/04_DESIGN.md` on the spec shape and `--agent` resolution order in the same commit (T3)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **R1 targets:** `packages/app/src/services/team-service.ts:666-680` (member → spec; `:674`
  `resolveExecutor`, `:678-680` writes `type: resolved.agent`), `:191-193` + `:237-242`
  (`AgentSpec` / `AgentSpecInput` shape), `:509-522` (`createAgentSpec`)
- **R2 targets:** `apps/cli/src/commands/agent.ts:357-383` (`drainIntoPrompt`; `:373` the rewrite),
  `packages/config/src/index.ts:262-282` (`resolveExecutor`, executor-first)
- **R3 targets (must not regress):** `packages/app/src/services/agent-service.ts:655-675`
  (occupant record), `:1341-1343` (`getOccupant`); feature G4 AC R1/R3
- **R4 targets:** `packages/config/src/index.ts:299-345` (`agent` section superRefine — existing
  duplicate-executor-name check is the pattern to extend), role list from
  `plugins/sp/references/roles.md`
- **R5 target:** `packages/config/src/index.ts:276-282` (`isCanonicalAgent` injection point)
- **On-disk evidence of the defect:** `.spur/config.yaml` (`- executor: codex-sol`, tier `capable-3`,
  model `gpt-5.6-sol`) versus `.spur/agents/demo-codex.yaml` (`type: codex` only)
- **Shim manifest:** `config/transition-shims.json` (task 0541) — register the "spec with no executor
  field" fallback
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
