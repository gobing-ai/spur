---
schema_version: 1
name: Derive agent instances from agent.fleet, drop the instance store and sync fleet docs
status: done
template: feature-impl
created_at: 2026-10-04T20:30:38.690Z
updated_at: "2026-10-05T18:22:32.288Z"
feature_id: G72

dependencies: ["1074", "1078"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1079-verdict.json
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

- [x] R1. Delete the never-registered `agent_instances` draft DDL/ID constants and their test (no migration — the table was never created), `AgentInstanceStore`, `createFileAgentInstanceStore` and `agent-instance.ts`; `resolveAgentSelector`/`resolveRoleTarget` resolve over `FleetService.resolve` members.
- [x] R2. Members resolve their spec from `agent.fleet` at loop start; `.spur/agents/` fleet materialization is removed (hand-authored specs there remain supported).
- [x] R3. Update `03_ARCHITECTURE` (fleet topology), `docs/design/fleet-config-declaration.md` §5, and `docs/design/inter-agent-control-plane.md` §11 to the inbox-only fleet.
- [x] R4. Delink the already-superseded `spur-team-mode-design.md` from `04_DESIGN.md`, update `repo-wide-tests/adr-supersession.test.ts`, and add an ADR-116 current-reading note.

### Acceptance Criteria

- [x] AC1 — Agent instances are derived, not stored
- [x] AC2 — Docs describe the inbox-only fleet

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

Implements G72 R3/R4 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §2.1 M4/M7, §3.2 items 9–10; decision D3; ADR-086 amendment A3). Fleet members are now DERIVED from `agent.fleet` plus occupancy: nothing is materialized into `.spur/agents/`, the never-registered instance store and its draft DDL are gone, and the fleet satellites describe the inbox-only fleet.

**Derivation replaces materialization (R1/R2)**
- `packages/app/src/services/fleet-service.ts:613` — new `FleetService.specs(projectPath)`: the declaration-only projection (enabled members, ids over the frozen roster, `fleet:<slug>` / `spur:generated` / `fleet:generated` tags, `validateAgentId` at the read boundary). Returns `[]` — never an exception — for no declaration, a disabled fleet, or an empty enabled roster, so read surfaces on fleet-less projects keep working.
- `packages/app/src/services/fleet-service.ts:350` — new pure `mergeAgentSpecs(diskSpecs, fleetSpecs)`: hand-authored `.spur/agents/` specs plus declared members, declaration wins an id clash (reported as `shadowed`), and a stale `fleet:generated` file on disk is **ignored** so it can never shadow config.
- `packages/app/src/services/fleet-service.ts` — deleted `materialize()` and its write/prune half, `MaterializeResult`, and the hand-authored skip in `materializeRoster` (nothing writes any more). `assertLaunchGroundTruth` stays the launch gate, now called explicitly by its consumers.
- `packages/app/src/services/supervisor-service.ts:374` — `registerAgentSpecs()` is the additive, idempotent seam that makes config-derived specs addressable; `startAutostart` still fails loud on an unknown id.
- `apps/server/src/serve.ts:930` — serve asserts ground truth, derives `specs(projectRoot)`, registers them with the supervisor, then autostarts exactly those ids (no disk read).
- `packages/app/src/services/agent-service.ts:1049` — the `--spec-id` launch lookup resolves through the same merged list, so declared members and hand-authored specs are both addressable (R3: `spur agent loop --spec <member>` resolves from config).

**Selector moves onto the declared roster (R1)**
- `packages/app/src/services/fleet-selector.ts:25` / `:47` — `resolveAgentSelector` / `resolveRoleTarget` now resolve over `ResolvedFleetMember` (role, executor, instanceId, enabled), keeping the same result type and error texts; disabled members are not addressable. `packages/app/src/services/agent-instance-store.ts` is deleted.
- `packages/app/src/services/agent-coordination-service.ts:528` — `listAgentSpecs()` merges disk + declaration (warns on each shadowed id); `:541` `listFleetMembers()` feeds role addressing. CLI call sites: `apps/cli/src/commands/message.ts:73`, `apps/cli/src/commands/agent.ts:366`.
- `packages/app/src/index.ts:284` — exports the selector from `fleet-selector`; the `agent-instance-store` exports are gone.

**Instance store and draft DDL deleted (R1)**
- Deleted `packages/domain/src/agent-instance.ts` (`AgentInstance`, `AgentInstanceStore`, `specRole`), its export in `packages/domain/src/index.ts`, and the never-registered `AGENT_INSTANCES_DDL_DRAFT` / `AGENT_INSTANCES_MIGRATION_ID_DRAFT` constants in `packages/domain/src/migrations.ts`. The table was never created, so no drop migration exists.
- `plugins/sp/lib/idea-handoff.generated.mjs` + `plugins/sp/lib/inline-run.generated.mjs` regenerate from that source change (`bun run build:plugin-lib`, idempotent).

**Docs (R3/R4)**
- `docs/03_ARCHITECTURE.md:322`/`:581` (derived roster, hand-authored `agents/` only), `docs/design/fleet-config-declaration.md` §3/§5 (serve sequence + services row + the retired constants), `docs/design/inter-agent-control-plane.md` §2/§11 (inbox-only derivation).
- `docs/04_DESIGN.md:45` — the superseded `spur-team-mode-design.md` row is delinked (the file stays as history); `docs/00_ADR.md` ADR-116 carries a `**Current reading:**` note; `repo-wide-tests/adr-supersession.test.ts:176` pins all three.
- Surface docs updated where the changed surfaces are described: `docs/design/cli-contracts.md` (spec-id addressing, `--specs` listing, the agent-specs section, `--role` resolution), `docs/design/project-switcher.md`, `docs/design/configuration-contracts.md`, `docs/01_PRD.md`.

**Tests**
- New `packages/app/tests/services/fleet-selector.test.ts` (selector over members, incl. disabled members not addressable).
- `packages/app/tests/services/fleet-service.test.ts` — the `materialize` block becomes a `specs` block plus `mergeAgentSpecs` cases (stale generated file never shadows config; declaration wins an id clash).
- `packages/app/tests/services/supervisor-service.test.ts` — config-derived specs autostart with no spec file on disk.
- `packages/app/tests/services/agent-coordination-service.test.ts` — hand-authored specs survive the merge, stale generated files are ignored.
- Fixtures migrated from spec files to `agent.fleet` declarations with a lowercase project slug: `apps/cli/tests/commands/{message,agent-team,agent-wait}.test.ts`, `packages/app/tests/services/agent-service.test.ts`; `apps/server/tests/serve.test.ts` asserts the derivation/registration path and that no spec file is written.

**Verification.** `bun run spur-check` (lint → `test-pre-check` rules → 10,093 tests → `test-post-check` rules) is green; targeted suites for every touched workspace run green individually.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Draft `agent_instances` DDL/ID constants + their test deleted, `AgentInstanceStore` / `createFileAgentInstanceStore` / `agent-instance.ts` deleted, selector resolves over `FleetService.resolve` members. Evidence: `packages/domain/src/migrations.ts` (constants + DDL gone), `packages/domain/src/index.ts`, `packages/domain/tests/agent-instance.test.ts` + `packages/app/tests/services/agent-instance-store.test.ts` deleted, `packages/app/src/services/fleet-selector.ts:25,47`, `apps/cli/src/commands/message.ts:73`, `apps/cli/src/commands/agent.ts:366`; `rg AgentInstanceStore packages apps` → no matches |
| R2 | MET | Members resolve their spec from `agent.fleet` at loop start; `.spur/agents/` fleet materialization removed; hand-authored specs remain supported. Evidence: `packages/app/src/services/fleet-service.ts:611` (`FleetService.specs`), `:350` (`mergeAgentSpecs`), `:264` (declaration-only `materializeRoster`), `packages/app/src/services/supervisor-service.ts:374` (`registerAgentSpecs`), `apps/server/src/serve.ts:930`, `packages/app/src/services/agent-service.ts:1049`, `packages/app/src/services/agent-coordination-service.ts:520,533`; targeted suites in `packages/app/tests/services/{fleet-service,agent-coordination-service,supervisor-service,agent-service}.test.ts` and `apps/server/tests/serve.test.ts` |
| R3 | MET | `03_ARCHITECTURE` fleet topology, `fleet-config-declaration.md` §5, `inter-agent-control-plane.md` §11 describe the inbox-only fleet. Evidence: `docs/03_ARCHITECTURE.md:322,581`, `docs/design/fleet-config-declaration.md` §3/§5, `docs/design/inter-agent-control-plane.md` §2/§11; satellites `docs/design/cli-contracts.md`, `docs/design/project-switcher.md`, `docs/design/configuration-contracts.md`, `docs/01_PRD.md` |
| R4 | MET | Superseded team-mode design delinked from `04_DESIGN.md`, supersession test updated, ADR-116 current-reading note added. Evidence: `docs/04_DESIGN.md` (row removed; design file retained as history), `docs/00_ADR.md` ADR-116 `**Current reading:**`, `repo-wide-tests/adr-supersession.test.ts:176` (assertions (g1)–(g3)) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Agent instances are derived, not stored | MET | command | `bun run spur-check` → 10,093 pass / 0 fail, covering `fleet-service.test.ts` ("FleetService.specs", "mergeAgentSpecs"), `agent-coordination-service.test.ts` ("listAgentSpecs merges hand-authored specs with the declared fleet and ignores stale generated files"), `supervisor-service.test.ts` ("config-derived specs autostart with no spec file on disk"), `agent-service.test.ts` ("fleet spec execution validates the actual launch context") |
| AC2 — Docs describe the inbox-only fleet | MET | command | `bun test repo-wide-tests/adr-supersession.test.ts` → 10 pass / 0 fail, including "G72 R4 — inbox-only fleet docs; the team-mode design stays superseded and delinked" (g1)–(g3) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed three dimensions — functional traceability, SECUA, architectural depth. No P1/P2/P3 findings; disposition PASS.

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — draft DDL/ID constants + their test, `AgentInstanceStore`, `createFileAgentInstanceStore`, `agent-instance.ts` deleted; selector resolves over `FleetService.resolve` members | MET | `packages/domain/src/migrations.ts`, `packages/domain/src/index.ts`, `packages/domain/src/agent-instance.ts` (deleted), `packages/app/src/services/agent-instance-store.ts` (deleted), `packages/app/src/services/fleet-selector.ts:25,47`; `rg AgentInstanceStore packages apps` returns nothing |
| R2 — members resolve their spec from `agent.fleet` at loop start; `.spur/agents/` materialization removed, hand-authored specs still supported | MET | `packages/app/src/services/fleet-service.ts:611` (`specs`), `:350` (`mergeAgentSpecs`), `packages/app/src/services/supervisor-service.ts:374`, `apps/server/src/serve.ts:930`, `packages/app/src/services/agent-service.ts:1049`, `packages/app/src/services/agent-coordination-service.ts:520,533` |
| R3 — `03_ARCHITECTURE` fleet topology, `fleet-config-declaration.md` §5, `inter-agent-control-plane.md` §11 describe the inbox-only fleet | MET | `docs/03_ARCHITECTURE.md:322,581`, `docs/design/fleet-config-declaration.md` §3/§5, `docs/design/inter-agent-control-plane.md` §2/§11; `cli-contracts.md`, `project-switcher.md`, `configuration-contracts.md`, `01_PRD.md` synced |
| R4 — superseded team-mode design delinked from `04_DESIGN.md`, supersession test updated, ADR-116 current-reading note added | MET | `docs/04_DESIGN.md` (row removed, file kept as history), `docs/00_ADR.md` ADR-116 `**Current reading:**`, `repo-wide-tests/adr-supersession.test.ts:176` |
| AC1 — agent instances are derived, not stored | MET | as R1/R2; verification gate green (10,093 tests) |
| AC2 — docs describe the inbox-only fleet | MET | as R3/R4; `repo-wide-tests/adr-supersession.test.ts` (g1)–(g3) |

**SECUA**

- Security — no new I/O, transport, or trust boundary; `mergeAgentSpecs` is pure; the `validateAgentId` check the deleted write path performed is preserved at the read boundary.
- Efficiency — net −255 production lines; one projection plus one pure merge seam replaces materialization, never a second read path.
- Correctness — `specs()` returns `[]` (never throws) for no declaration / disabled fleet / empty enabled roster; disabled members are not addressable; `registerAgentSpecs` is additive and idempotent; selector error codes and texts are unchanged.
- Usability — `unknown_selector` (exit 2) / `selector_unmatched` / `selector_ambiguous` (exit 1) preserved verbatim; `startAutostart` now names `agent.fleet` first.
- Architecture — declared roster derived once at `agent.fleet`; the write/prune half and the 114-line instance store are deleted rather than deprecated.

**Findings**

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | P4 (advisory) | `RosterProjection.desiredIds` (`packages/app/src/services/fleet-service.ts:172`) has no production reader left — its consumer was the deleted prune half. | Deferred: removing the field breaks an exported 0835 projection shape and is outside this task's Design. |
| 2 | P4 (advisory) | `AgentCoordinationService.fleetService()` supplies `openDb`, so `specs()`/`listFleetMembers()` may run `resolve()`'s member-session join that neither consumer reads. | Deferred: harmless (the CLI paths already hold an open DB) and keeps the instance complete for `resolveOrchestrator`. |
| 3 | P4 (advisory) | `agent list --specs` / `--role` on a project whose directory basename is not a valid agent-id prefix now fails loudly (`validateAgentId`) where the pre-G72 disk read was silent. | Accepted by design — a fleet whose derived ids cannot be formed is unaddressable; the error is named and the fixtures pin a lowercase project slug. |
| 4 | P4 (advisory) | Two `test-recheck` re-entries were needed because the proof digest is captured at quality-gate entry (cli-contracts wording; a stale pruning comment). | Accepted and recorded in `.spur/memory/runs/<runId>.md`; each re-entry re-ran the full gate, never a silent re-certification. |

**Residual risk**

- Reviewer independence is session-level only: this batch ran with `--agent inline`, so review and verify executed in the same host session as implement; a fresh-executor review is the stronger check for P0/P1-style risk.
- Upgraded projects keep inert `fleet:generated` files under `.spur/agents/` on disk; they are ignored by the merge and never addressable, but nothing deletes them (accepted as scratch in the task Q&A).

**Disposition: PASS** — every requirement and both ACs trace to evidence; no blocking findings.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:52.105Z backlog → todo (system)
- 2026-10-05T08:26:54.958Z todo → wip (system)
- 2026-10-05T08:46:44.791Z wip → testing (system)
- 2026-10-05T08:47:01.443Z testing → done (system)

