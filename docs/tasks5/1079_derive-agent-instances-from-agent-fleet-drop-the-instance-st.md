---
schema_version: 1
name: Derive agent instances from agent.fleet, drop the instance store and sync fleet docs
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:38.690Z
updated_at: "2026-10-04T20:57:52.105Z"
feature_id: G72

dependencies: ["1074", "1078"]
priority: P2
estimate_hours: 6
---

## 1079. Derive agent instances from agent.fleet, drop the instance store and sync fleet docs

### Background

Implements G72 R3 and R4 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §2.1 M4, M7; §3.2 items 9 and 10; decision D3; ADR-086 amendment A3).

Verified state (2026-10-04):

- M4: the `agent_instances` table (`packages/domain/src/migrations.ts:976-998`) and `AgentInstanceStore`/`createFileAgentInstanceStore` (exported at `packages/app/src/index.ts:69`) have zero callers; the `team_id` column and index survive.
- `.spur/agents/*` specs are materialized as untracked scratch; members can resolve from `agent.fleet` via `FleetService.resolve`.
- `packages/config/src/loader.ts:359` holds the retired `agent.team` guard and stays.
- M7: `docs/design/spur-team-mode-design.md` (557 lines) describes the retired daemon and is linked from `docs/04_DESIGN.md`.
- ADR amendments already landed (057, 086, 121, 126, new 132); this task syncs the satellites.

**Refine corrections (2026-10-04)**

- R1's "add a drop migration" is unnecessary: the table was never created. `AGENT_INSTANCES_DDL_DRAFT` and `AGENT_INSTANCES_MIGRATION_ID_DRAFT` are "intentionally absent from `CLI_MIGRATIONS`" (`packages/domain/src/migrations.ts:975-998`; `packages/domain/tests/agent-instance.test.ts:39` asserts the absence) → delete the draft constants, their `packages/domain/src/index.ts:39-40` exports and that test. No migration.
- "Zero callers" is wrong. `resolveAgentSelector` builds `createFileAgentInstanceStore` over `listAgentSpecs()`, and it backs role/executor addressing in `spur message send --role` (`apps/cli/src/commands/message.ts:72`) and `spur agent wait --role` (`apps/cli/src/commands/agent.ts:356`) → first move `resolveRoleTarget`/`resolveAgentSelector` onto `FleetService.resolve` members (declared members only, which 1081 R3 relies on), then delete the store.
- More `.spur/agents` consumers than R2 names:
  - `FleetService.materialize` (its only caller is `apps/server/src/serve.ts:805` → `supervisor.startAutostart`)
  - the supervisor's lazy `loadAgentSpecs(configDir)` (`supervisor-service.ts:402`; it already accepts pre-loaded `specs`, `:83`)
  - `AgentCoordinationService.listAgentSpecs` (`:556`; used by `task.ts:528`, `message.ts:73`, `agent.ts:357,486,565,897`)
  - the fleet `--spec-id` lookup (`agent-service.ts:1034`)

  Hand-authored specs (`AgentCoordinationService` create path, `:525-545`) also live in `.spur/agents/` and stay supported.
- R4: `spur-team-mode-design.md` already has `status: superseded`, and its `04_DESIGN.md:44` row already says "superseded by ADR-116" → the remaining work is to delink it and add the ADR-116 note. The supersession test lives at `repo-wide-tests/adr-supersession.test.ts`.

### Requirements

- [ ] R1. Delete the never-registered `agent_instances` draft DDL/ID constants and their test (no migration — the table was never created), `AgentInstanceStore`, `createFileAgentInstanceStore` and `agent-instance.ts`; `resolveAgentSelector`/`resolveRoleTarget` resolve over `FleetService.resolve` members.
- [ ] R2. Members resolve their spec from `agent.fleet` at loop start; `.spur/agents/` fleet materialization is removed (hand-authored specs there remain supported).
- [ ] R3. Update `03_ARCHITECTURE` (fleet topology), `docs/design/fleet-config-declaration.md` §5, and `docs/design/inter-agent-control-plane.md` §11 to the inbox-only fleet.
- [ ] R4. Delink the already-superseded `spur-team-mode-design.md` from `04_DESIGN.md`, update `repo-wide-tests/adr-supersession.test.ts`, and add an ADR-116 current-reading note.

### Acceptance Criteria

- [ ] AC1 — Agent instances are derived, not stored
- [ ] AC2 — Docs describe the inbox-only fleet

Task-local verification:

- A database migrated from a pre-drop snapshot has no `agent_instances` table, and `spur agent loop --spec <member>` resolves from config.
- `rg AgentInstanceStore packages apps` returns nothing.
- The doc-sync and ADR-supersession checks pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:19.720Z

- **Q: What happens to stale generated specs left on disk?** A: `listAgentSpecs` ignores on-disk specs tagged `fleet:generated`, so declared fleet specs always come from config. The untracked files are harmless scratch, and nothing deletes them automatically.
- **Q: How do hand-authored and fleet specs merge?** A: `listAgentSpecs()` = on-disk specs without `fleet:generated`, plus `FleetService.specs(cwd)`. On an id clash the fleet spec wins, with a one-line warning.
- **Q: Does an ADR text change need justification?** A: The ADR-116 current-reading note records an existing fact: the team-mode design is superseded and fleets are inbox-only per the amended ADR-126/086. It sits under the 2026-10-04 approved amendments. ADR-086 A3 already says the table and the store are deleted, so the correction above is consistent with it.

### Design

**Spec projection** (`packages/app/src/services/fleet-service.ts`)
- Add `specs(projectPath): Promise<AgentSpec[]>`. It contains `materialize`'s body without the write:
  - `materializeRoster(...)` → `projection.toUpsert` filtered to enabled members
  - tags `fleet:<slug>`, `spur:generated`, `fleet:generated`
- Delete the write/prune half and the `materialize` method; rename its tests.
- `apps/server/src/serve.ts:805` uses `const specs = await fleetService.specs(projectRoot)`, gives them to the supervisor (constructor `specs` option, `supervisor-service.ts:83`, or a new `register(specs)` if the supervisor is already built), then calls `startAutostart(specs.map((s) => s.id))`.

**Spec resolution sites**
- `AgentCoordinationService.listAgentSpecs` merges per the Q&A.
- `agent-service.ts:1034` resolves through `FleetService.specs`.
- `drainIntoPrompt` and the loop's `listAgentSpecs` dep already go through `listAgentSpecs`.

**Selector** (`packages/app/src/services/agent-instance-store.ts`)
- Move `resolveRoleTarget` and `resolveAgentSelector` into `fleet-service.ts`, or a small `fleet-selector.ts`, over `ResolvedFleetMember` (`role`, `executor`, `instanceId`, `enabled`). Keep the same result type and error texts.
- Keep the `packages/app/src/index.ts` exports for the two functions; delete `createFileAgentInstanceStore`.
- Delete `agent-instance-store.ts`, `packages/domain/src/agent-instance.ts` (keep `specRole` if it is used elsewhere; move it if so) and the draft constants.

**Docs**
- `03_ARCHITECTURE` fleet topology: inbox-only, no materialized specs
- `fleet-config-declaration.md` §5 (runtime vocabulary)
- `inter-agent-control-plane.md` §11
- `04_DESIGN.md:44`: remove the row (the file stays as history)
- `repo-wide-tests/adr-supersession.test.ts`: assertion for the ADR-116 note
- `docs/00_ADR.md` ADR-116: one `**Current reading:**` line

**Tests**
- `packages/app/tests/services/{agent-instance-store,fleet-service,supervisor-service}.test.ts`
- `packages/domain/tests/agent-instance.test.ts` (delete)
- role-addressing tests in `apps/cli/tests/commands/{message,agent}.test.ts`

### Plan

1. Write the failure list first as tests:
   - `--role coder` stops resolving once the store is gone
   - serve autostart starts nothing without disk specs
   - a hand-authored spec disappears from `listAgentSpecs`
   - a stale generated spec shadows the config
2. Add `FleetService.specs`; switch serve and supervisor to it; delete the `materialize` write path.
3. Merge `listAgentSpecs`; switch the `agent-service.ts:1034` lookup.
4. Move the selector onto fleet members; delete the store, `agent-instance.ts` and the draft constants and their tests.
5. Docs: 03, fleet-config §5, control-plane §11, the 04 delink, the ADR-116 note and the supersession test.
6. Gates:
   - `rg -n AgentInstanceStore packages apps --glob '!**/node_modules/**'` returns nothing
   - `(cd repo-wide-tests && bun test adr-supersession.test.ts)` if it has its own bunfig, else the root runner
   - `bun run spur-check`
   - `bun run test-cf`

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:52.105Z backlog → todo (system)

