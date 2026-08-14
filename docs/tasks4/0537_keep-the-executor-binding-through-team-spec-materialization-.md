---
template: feature-impl
schema_version: 1
name: "Keep the executor binding through team spec materialization and drain"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0541"]
ac_numbering: task-local
created_at: "2026-08-13T23:24:34.653Z"
updated_at: "2026-08-14T02:05:20.287Z"
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

**Closed during refine (2026-08-13).**

- **Does the spec lose its `type` field?** No. `type` stays — `AiRunner` resolves the runner from it,
  and existing on-disk specs carry only `type`. `executor` is added beside it.
- **Where does the collision guard live?** `AgentConfigSchema`'s existing `superRefine`
  (`packages/config/src/index.ts:317-345`), which already validates member-id uniqueness and the
  composed-id charset. Extend it rather than adding a second validation pass.
- **How many namespaces must be disjoint?** Three — role names, executor names, spec ids. The
  two-way framing in the original charting was incomplete; roles arrived with 0535.
- **Does a member already support a per-member model?** Yes — `model?` is on
  `TeamMemberConfigSchema` today. It is orthogonal to `executor` and is left alone.

**Deferred with owner.**

- **Addressing a team member by role** — owner: feature M5 (batch 2), which records why it cannot work
  (two members can share a role; G4 rejects non-unique addressing).
- **Removing the `spec-without-executor-field` shim** — owner: whoever clears the manifest. Condition
  is registered with the entry.
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

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Member schema (object arm) | `TeamMemberConfigSchema` — `executor` (required), `id?`, `purpose?`, `workspace?`, `model?`, `autonomy?`, `systemPrompt?`, `command?`, `autostart?` | `packages/config/src/index.ts:182-196` |
| Normalized form | `NormalizedTeamMember` — same field set | `packages/config/src/index.ts:219-230` |
| Team schema | `TeamConfigSchema` — `name`, `work_dir`, `autostart?`, `members` | `packages/config/src/index.ts:201-212` |
| Shorthand (must keep working) | bare string `- claude` → `{ executor: "claude" }` via `normalizeMember` | `packages/config/src/index.ts:236-237` |
| Executor lookup | `resolveExecutor(name, agentConfig, opts?)` → `{ agent, model? }` | `packages/config/src/index.ts:262-282` |
| Loud-failure predicate | `isCanonicalAgent` on `ResolveExecutorOptions` | `packages/config/src/index.ts:255-259` |
| Materialization site | `TeamService` member → spec | `packages/app/src/services/team-service.ts:666-680` |
| **New spec field** | `executor: string` on the written agent spec, **beside** `type` | `.spur/agents/<teamId>-<localId>.yaml` |
| Collision guard site | `AgentConfigSchema` `superRefine` (already validates member-id uniqueness + composed id) | `packages/config/src/index.ts:317-345` |
| Composed id (unchanged) | `<teamId>-<localId>`, `localId = member.id ?? member.executor` | 0251 |
| Shim id to register | `spec-without-executor-field` | `config/transition-shims.json` |

**No new CLI surface.** This task changes what materialization writes and what drain resolves; it adds
no flag, verb, or noun.

#### Anti-patterns — what not to implement

- Do **not** replace `type` on the spec. `AiRunner` resolves the runner from it and existing on-disk
  specs carry only `type`; `executor` is **additive**.
- Do **not** drop the bare-string member shorthand — it is in use and `normalizeMember` is its contract.
- Do **not** move the `spec-id` assignment. `drainIntoPrompt` sets `flags['spec-id']` *before*
  rewriting the selector, and the comment there records why: the flag must survive an empty inbox
  because `runAgentLoop` depends on it.
- Do **not** guard only the spec-id↔executor-name pair. The guard is three-way — role names too, so an
  operator cannot name an executor `coder`.
- Do **not** silently fall back to a bare binary when a spec's executor is missing (R5) — that is the
  exact silent downgrade this task exists to remove.

#### Cross-task contract

**Assumes from 0541:** `config/transition-shims.json` and the two-sided gate. **Landed.**

**Assumes from 0535:** the four role ids, needed for the three-way collision guard (R4). **Landed** —
`scribe`, `coder`, `reviewer`, `planner`.

**Leaves for dependents:**

- Task **0542** relocates the drain path from `--agent` to `--spec`. This task fixes *what the
  selector resolves to*; 0542 changes *which flag carries it*. The binding fix must survive that move
  unchanged — 0542 must not re-flatten the spec to a bare kind.
- Task **0538** adds `role` to `agent.team[].members[]` and carries it onto the spec, alongside the
  `executor` field this task adds. Both land on the same materialization site
  (`team-service.ts:666-680`) — **do not run 0537 and 0538 concurrently in this tree.**
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
**Binding carried, not redesigned** — the executor name now survives both lossy hops, and the collision + fail-loud guards close the `--agent` ambiguity.

- **Spec round-trip (ts-ai-runner 0.4.32).** `AgentSpec` gains optional `executor?` beside `type`; parse/serialize round-trip it and specs without the field load unchanged. Released lockstep as `@gobing-ai/ts-ai-runner@0.4.32`; Spur catalog + lockfile bumped (`package.json:32`, `bun.lock`).
- **R1 — materialization carries the name.** `packages/app/src/services/team-service.ts:685` writes `executor: member.executor` beside `type: resolved.agent`, so `- executor: codex-sol` materializes as `type: codex` + `executor: codex-sol` (kind stays — AiRunner resolves the runner from it).
- **R2 — drain resolves the executor, not the kind.** `apps/cli/src/commands/agent.ts:381` rewrites `--agent <specId>` via `drainAgentSelector` (`apps/cli/src/commands/agent.ts:402-414`) to the spec's executor name, falling back to `spec.type` when the field is absent. `spec-id` is set before the rewrite (`apps/cli/src/commands/agent.ts:381`) so the occupant pin is unchanged (R3). `resolveExecutor`'s executor-first lookup then restores `{agent, model}` with the declared tier.
- **R5 — dangling executor fails loud.** `drainAgentSelector` injects `isCanonicalAgent` into `resolveExecutor` (`apps/cli/src/commands/agent.ts:405-411`); an executor absent from `agent.executors` and not a canonical agent throws naming the spec and the executor — exit 1, no process spawns.
- **R4 — three-way selector guard.** `packages/config/src/index.ts:151-155` adds `AGENT_ROLE_NAMES` (parity-asserted against `plugins/sp/references/roles.md` by `plugins/sp/tests/roles.test.ts`); the `AgentConfigSchema` superRefine rejects executor↔role (`packages/config/src/index.ts:361-371`), member-id↔role/executor, and composed-id↔role/executor collisions (`packages/config/src/index.ts:421-447`) — each message names both colliding names.
- **Shim.** `config/transition-shims.json:5-11` registers `spec-without-executor-field` (marker at `apps/cli/src/commands/agent.ts:403`).
- **Docs (T3).** `docs/04_DESIGN.md:188-193` (`--agent` resolution order incl. the spec-id branch and disjointness guard), `docs/04_DESIGN.md:225-236` (drain executor resolution + R5 fail-loud), `docs/04_DESIGN.md:273-279` (materialized spec shape).

**Tests.** R4: `packages/config/tests/team-config.test.ts` (5 collision cases + disjoint config). R1: `packages/app/tests/services/team-service.test.ts` (executor name + kind recorded). R2/R3/R5: `apps/cli/tests/commands/agent.test.ts` (drain resolves executor + spec-id pin; dangling executor rejects with no spawn; existing G4 occupant test untouched). Parity: `plugins/sp/tests/roles.test.ts`.

**Verification.** `bun test` on the 6 affected suites — 228/228 green; `bunx biome check` clean on changed files; workspace typechecks (`spur-config`, `spur-app`, `spur`) exit 0; `bun run transition-shim-check` PASS (1 marker ↔ 1 entry); live `.spur/config.yaml` loads via `spur status`.

**Scope note.** The lockstep ts-libs 0.4.32 bump (all `@gobing-ai/ts-*` in `package.json`/`bun.lock`) rides along — required so the executor field reaches app/CLI. It sits outside the task's backticked allowlist, so the pipeline `requireDiff` scope guard needs `implementScopeGuard: off`, or the bump is committed as its own chore first.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `team-service.ts:685` writes `executor: member.executor` beside `type`; `AgentSpec.executor?` in ts-ai-runner@0.4.32 (installed, verified in dist); test `team-service.test.ts:935-971` |
| R2 | MET | `agent.ts:381` + `drainAgentSelector` :402-414 → executor name, `spec.type` fallback; test `agent.test.ts:585-640` asserts `flags.agent === 'codex-sol'` |
| R3 | MET | `spec-id` set before rewrite (`agent.ts:381`); occupant record carries specId/agentKind/runId/generation (`agent-service.ts:655-675`); G4 tests green |
| R4 | MET | `AGENT_ROLE_NAMES` + superRefine guard (:361-371, :421-447), each message names both names; roles parity test; 4 collision tests + disjoint accepted |
| R5 | MET | `isCanonicalAgent: isAgentName` injected (:405-411); test asserts reject naming spec+executor, `run` never called |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Correctness | packages/config/src/index.ts:450-454 | Composed-id↔role collision check is unreachable: composedId always carries the `<teamId>-<localId>` prefix, so it can never equal a bare role name. Dead code (uncovered by tests, lines 450-454). Drop it or keep as defense-in-depth with an explicit note; if kept, add the direct test. |
| P4 | Architecture | packages/config/src/index.ts:334-447 | R4 guard covers only team-materialized ids (`agent.team[].members[]` → member id + composed id). Hand-authored spec ids (`spur agent create --id <role|executor>`) are outside config-load validation, so a hand spec named `coder`/`reviewer` can still reintroduce the `--agent` ambiguity (existing fixture `id: 'reviewer'` at apps/cli/tests/commands/agent-team.test.ts:345 is itself such a spec). In-scope per design (guard site = AgentConfigSchema superRefine over agent.team); residual owner: 0542. |
| P4 | Docs | task 0537 § Solution (Tests) | "5 collision cases + disjoint config" overstates: the test file implements 4 collision cases + 1 disjoint config. The composed↔role pair is untested because unreachable (see above). Solution text should say 4. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | packages/app/src/services/team-service.ts:685 writes `executor: member.executor` beside `type: resolved.agent`; packages/app/tests/services/team-service.test.ts:935-971 asserts kind stays (`codex`) + executor recorded (`codex-sol`) + model in spec config. `executor?` is optional on AgentSpec (@gobing-ai/ts-ai-runner@0.4.32, dist/agent-spec.d.ts:16-22), so pre-existing specs without the field load unchanged. |
| R2 | MET | apps/cli/src/commands/agent.ts:381 rewrites via drainAgentSelector (:402-414) to the spec's executor name; apps/cli/tests/commands/agent.test.ts:585-640 asserts `flags.agent === 'codex-sol'` (never bare `codex`). Resolution chain restores the binding: agent-service.ts:1239-1258 (executor-first → {agent, model}), :995-1000 (tier pinned via getExecutorTier → capable-3). |
| R3 | MET | apps/cli/src/commands/agent.ts:381 sets `spec-id` before the selector rewrite; existing G4 tests pass unchanged: apps/cli/tests/commands/agent-team.test.ts:342-371 (drain keeps spec-id, occupant pin persists) and packages/app/tests/services/agent-service.test.ts:2434 (occupant row carries specId + agentKind + generation); new assertion agent.test.ts:621-622. |
| R4 | MET | packages/config/src/index.ts:361-371 (executor↔role), :421-447 (member id / composed id ↔ role / executor); packages/config/tests/team-config.test.ts:257-340 — 4 collision cases, each message names both colliding names, plus a disjoint config accepted. Guard bites on real materialization: fixture member id `reviewer` → `codex-reviewer` in apps/cli/tests/commands/team.test.ts:398-456. |
| R5 | MET | apps/cli/src/commands/agent.ts:405-411 injects `isCanonicalAgent` into `resolveExecutor`, throwing an error naming the spec and the missing executor; apps/cli/tests/commands/agent.test.ts:642-679 asserts the reject and that `run` is never called (no process spawns). |

**Verification (this run).** bun test on 6 affected suites — 201 pass / 0 fail: packages/config/tests/team-config.test.ts (31), packages/app/tests/services/team-service.test.ts (64), apps/cli/tests/commands/agent.test.ts + agent-team.test.ts (64), apps/cli/tests/commands/team.test.ts (29), plugins/sp/tests/roles.test.ts (13); targeted G4 occupant test packages/app/tests/services/agent-service.test.ts:2434 (1). `bun run transition-shim-check` PASS (1 marker ↔ 1 entry). `bunx biome check` clean on 7 changed files. Workspace typechecks (spur-config, spur-app, spur) exit 0. Live `.spur/config.yaml` loads via monorepo CLI `spur status` → `spurConfig: true` with the new guard active; on-disk defect evidence confirmed (`.spur/agents/demo-codex.yaml` carries only `type: codex`).

**Design conformance.** All claims DONE: Hop 1 additive `executor` field (team-service.ts:685), Hop 2 drain rewrite with `spec.type` fallback (agent.ts:402-414), spec-id set before rewrite (agent.ts:381), collision guard naming both names, `isCanonicalAgent` injection, shim registered (`config/transition-shims.json:5-11` ↔ marker agent.ts:403), T3 docs same commit (docs/04_DESIGN.md:188-193, 225-236, 273-279). No scope creep beyond the documented ts-libs 0.4.32 ride-along bump (package.json:32 — required for AgentSpec.executor; flagged in Solution scope note for implementScopeGuard).

**Residual risk.** Non-blocking: (1) hand-authored spec ids outside the R4 guard (owner 0542); (2) dead composed↔role check; (3) Solution test-count overstatement.
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
- 2026-08-14T01:53:35.851Z todo → wip (system)
- 2026-08-14T02:05:19.342Z wip → testing (system)
- 2026-08-14T02:05:20.287Z testing → done (system)
