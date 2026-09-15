# Fleet declaration in spur config — system design (feature G65)

- **Status:** Accepted (2026-09-15) · **Date:** 2026-09-14 · **Feature:** G65 (parent G6)
- **Amends:** ADR-116 (carrier of the fleet declaration) · **Supersedes:** [project-switcher.md](project-switcher.md) §3.1 (shipped 2026-09-15, task 0858)
- **Retains:** `FleetService` lifecycle, the frozen `memberLocalId` allocator, `StrategyRuntime`, ADR-057 control plane

## 1. Problem

Before G65, three carriers described one fleet: `.spur/fleet.json` (composition, ADR-116), `agent.team.*`
(serve autostart), and the `project_strategy` row (strategy default, DB-only). No config switch turned
the fleet off, and the runtime still spoke `team` (`/api/team/*`, `team.*` events, `TeamService`). G65
made one validated project-config section the only declaration and removed or renamed the team
vocabulary; the shipped surface is stated in §2 and recorded in the ADR-116 amendment (§8).

## 2. Config contract — `agent.fleet`

Owned by `packages/config/src/index.ts`. Project layer (`<project>/.spur/config.yaml`) only.

```typescript
const FLEET_STRATEGIES = ['rest', 'gtd'] as const; // moved from strategy-runtime; StrategyName derives from it

const AgentFleetSchema = z
    .object({
        enabled: z.boolean().default(false),
        strategy: z.enum(FLEET_STRATEGIES).default('rest'),
        orchestrator: z.string().min(1).optional(), // memberLocalId of the planner member with purpose 'orchestrator'
        members: z.array(FleetMemberSchema).default([]), // FleetMemberSchema unchanged (id/role/executor/purpose/enabled)
    })
    .superRefine(/* members[i] declares role or executor — moved from FleetDeclarationSchema */);
```

```yaml
# .spur/config.yaml
agent:
  fleet:
    enabled: true
    strategy: gtd
    orchestrator: planner-1
    members:
      - { role: planner, purpose: orchestrator }
      - { role: coder, executor: claude }
      - { role: reviewer, enabled: false }
```

- `version` is dropped (the config file has its own); `FleetDeclarationSchema` / `FleetDeclaration` are deleted.
- Zod issues keep their `agent.fleet.<path>` so an invalid section names every issue (R8).
- `apps/cli/schemas/spur-config.schema.json` replaces `agent.team` with `agent.fleet`; `config/config.example.yaml`
  carries the demo roster as an `agent.fleet` block.

### Retired sources — hard errors (R2)

One loader guard (`packages/config/src/loader.ts`) runs before schema parse, so nothing is stripped silently and
every CLI command and `spur serve` fail the same way:

| Found | Error names |
| --- | --- |
| `agent.team` in any layer | the file, and `agent.fleet` in `<project>/.spur/config.yaml` as the replacement |
| `agent.fleet` in `~/.config/spur/config.yaml` | the global file, and the project config as the only legal layer |
| `<project>/.spur/fleet.json` exists | the file; move `members`/`orchestrator` under `agent.fleet`, then delete it |

No converter: no registered project carries a fleet declaration. `misplacedGlobalKeys` drops its `agent.team` branch.

## 3. Serve start sequence

`apps/server/src/serve.ts`, replacing the `fs.exists(.spur/fleet.json)` gate and the `resolveAutostartSet` block:

1. Config load (the §2 guard fails the start on a retired source).
2. `agent.fleet` absent or `enabled: false` → no materialization, no autostart; log the disabled state once.
3. `enabled: true` → `FleetService.materialize(projectRoot)` (ground-truth guard unchanged) →
   `supervisor.startAutostart(result.upserted)`: every materialized (enabled) member starts.
4. Strategy reconcile (R4): `current = getStrategy(path)`; `if (current.name !== fleet.strategy) setStrategy(path, fleet.strategy)`.
   `setStrategy` already bumps `strategy_version` and emits `strategy.changed`; the compare keeps restarts silent.
   Runs whenever `agent.fleet` is present, enabled or not.

`SPUR_TEAM_AUTOSTART`, `ServerBootConfig.teamAutostart` and `resolveAutostartSet` are deleted, not renamed.

## 4. Read surfaces (R3)

| Surface | Change |
| --- | --- |
| `FleetService.load(projectPath)` | reads `agent.fleet` from the project's merged config (`reloadAgentConfig`/`spurConfig`), not a file |
| `FleetService.resolve()` | absent section → `missing: ['no-declaration']`; `enabled: false` → members still resolved, `missing` gains `'fleet-disabled'` |
| `spur projects list --fleet` | prints `fleet: disabled (agent.fleet.enabled: false)` / `fleet: no declaration (agent.fleet)`; help text names `agent.fleet` |
| `GET /api/project/fleet` | adds `enabled: boolean`; `strategy` still read through `StrategyRuntime` (reconciled at start) |
| Board hints (`ProjectsShell`, `AgentsView`, `useProjectContext`) | `.spur/fleet.json` → `agent.fleet in .spur/config.yaml` |

## 5. Runtime vocabulary (R6)

### Routes — `apps/server/src/modules/team/` → `modules/processes/`

| Today | After |
| --- | --- |
| `GET /api/team/processes` | `GET /api/processes` |
| `GET /api/team/processes/:id/stream` | `GET /api/processes/:id/stream` |
| `POST /api/team/processes/:id/stdin` | `POST /api/processes/:id/stdin` |
| `POST /api/team/agents/:id/start\|stop` | `POST /api/agents/:id/start\|stop` |
| `GET /api/team/teams` | removed (roster = `/api/project/fleet`) |
| `GET /api/team/health` | removed (`/api/health` owns liveness) |

Callers move in the same change: web `ProcessesView`, `MemberTerminal`, `AgentsView`, `MemberDetail`,
`lib/process-stream.ts`; CLI `agent status|start|stop`; the CSRF matcher in `middleware/pipeline.ts`.
`lib/use-teams-data.ts` is deleted; `MemberDetail` takes work dir from the fleet snapshot `path` and model from the
declared member.

### Events

| Today | After |
| --- | --- |
| `team.up`, `team.down` | removed (no producer once `materializeTeam`/`teardownTeam` go) |
| `team.member.assigned` | `task.assigned` (producer `assignTask` / CLI `assignTaskWithLedger`) |
| `team.member.started\|stopped` | removed; the supervisor emits the existing `agent.started\|stopped` |

Payloads drop `teamId`. Persisted `system_events` rows keep their old names (history, no data migration).

### Services

| Today | After |
| --- | --- |
| `TeamService` messaging (`getInbox`, `drainPending`, `releasePending`, `settleDelivered`, `settleFailed`, `countPending`, `listRecent`, `replyToMessage`), `assignTask`, `listAgentSpecs`, `createAgentSpec`, `buildIdentity` | `AgentCoordinationService` (`agent-coordination-service.ts`) |
| `materializeRoster`, `resolveMemberExecutor`, `MaterializeResult` | `fleet-service.ts` (sole consumer; `teamId` field dropped) |
| `listTeams`, `materializeTeam`, `teardownTeam`, team `getStatus`, `resolveAutostartSet` | deleted |
| supervisor `team:` tag → `teamId`, `SPUR_TEAM_ID` env | deleted (no producer tags `team:` any more) |

Kept: the `agent_instances.team_id` column and index stay nullable and unwritten — a rename is a schema
migration and is out of scope.

## 6. Deletions (R5)

`spur projects migrate`, `LegacyMigrationService` (`packages/app/src/services/legacy-migration.ts`), their tests,
exports (`packages/app/src/index.ts`), help doc and plugin `projects.md` rows. Removing a public verb records a row in
[harness-surface-governance.md](harness-surface-governance.md) (consent given at G65 idea-eval).

## 7. Task sketch (ordered by compile dependency)

| # | Task | AC | After |
| --- | --- | --- | --- |
| 1 | Delete `projects migrate` + `LegacyMigrationService` | R5 | — |
| 2 | Retire the `agent.team` roster runtime (schema, loader rules, retired-key guard, team roster methods, `team.up/down`, `/api/team/teams`, autostart env) | R2, R6 | 1 |
| 3 | `agent.fleet` section replaces `fleet.json`; serve `enabled` gate + autostart; read surfaces | R1, R2, R3, R8 | 2 |
| 4 | Reconcile `agent.fleet.strategy` into `project_strategy` | R4 | 3 |
| 5 | Rename routes/events; split `TeamService` | R6 | 2 |
| 6 | ADR-116 amendment, `03_ARCHITECTURE`, satellites, plugin references, residual sweep | R7 | 3, 4, 5 |

Each task updates the satellite rows its surface owns (T3 rule); task 6 is the cross-document sweep.

## 8. ADR-116 amendment

Landed in [ADR-116](../00_ADR.md) on 2026-09-15 under the heading “Amendment (2026-09-15 · G65)”. The block
below is the design-time draft the ADR text was cut from; where the two differ, the ADR is authoritative. The
landed text adds the Projects-tab sentence (Conversation / Agents / Processes) and the runtime-vocabulary
sentence (routes, events, and the service renamed or removed).

> **Amendment (2026-09-14 · G65):** The fleet declaration moves from `.spur/fleet.json` into the project config
> section `agent.fleet { enabled, strategy, orchestrator, members }`. `agent.team` is removed. `enabled` gates serve
> materialization and autostart; `strategy` is reconciled into `project_strategy` at serve start. Retired carriers
> fail loudly; none is read.

## 9. Open question — resolved

**Autostart granularity.** Original question: does `enabled: true` need a per-member `autostart` flag next to
`agent.fleet.enabled` and `members[].enabled`? **Resolved (2026-09-15, with the Accepted flip):** no per-member
flag. `enabled: true` starts **every** enabled member at serve start; individual members start from the Board or
`spur agent start` when the fleet is off. Shipped that way by 0858.
