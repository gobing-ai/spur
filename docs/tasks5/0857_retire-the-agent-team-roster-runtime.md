---
schema_version: 1
name: Retire the agent.team roster runtime
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.217Z
updated_at: "2026-09-15T18:19:35.228Z"
feature_id: G65
priority: P1
tags:
  - g65
  - config
  - server
  - web

dependencies: ["0856"]
---

## 0857. Retire the agent.team roster runtime

### Background

Covers G65 scenario R2 (the `agent.team` source) and the `team.up`/`team.down` part of R6 (design §2, §5).

`agent.team.<id>` still parses and still drives runtime code although the `spur team` noun is gone (G64):

- config: `TeamConfigSchema` / `TeamMemberConfigSchema` and the `agent.team` key with its composed-id superRefine (`packages/config/src/index.ts` ~360-440, :658-662); loader team tilde expansion (`packages/config/src/loader.ts:334-353`) and the `agent.team.*.members` identity merge rule; `misplacedGlobalKeys` reports `agent.team`.
- app: `TeamService.listTeams` / `materializeTeam` / `teardownTeam`, the team part of `getStatus`, `team.up`/`team.down` emission (`team-service.ts:991,1021`), and `resolveAutostartSet` (`team-service.ts:1202`).
- server: serve autostart unions `agent.team` autostart with `SPUR_TEAM_AUTOSTART` (`apps/server/src/serve.ts` after the fleet block; `server-config.ts:24`; `context.ts:300,354`); `GET /api/team/teams` (`modules/team/index.ts:211`).
- web: `apps/web/src/lib/use-teams-data.ts`, used only by `MemberDetail.tsx` for the work dir and model lines.

Removing the schema key alone would silently strip a leftover block, so a loader guard must fail the load instead.

### Requirements

- **R1** — Delete `TeamConfigSchema`, `TeamMemberConfigSchema` (including the bare-string shorthand), the `agent.team` key and its composed-id superRefine, the `TeamConfig`/`TeamMemberConfig`/`NormalizedTeamMember` types and `normalizeMember`. Retype `memberLocalId`'s input to the member identity fields (`id`, `executor`, `role`) without changing its derivation.
- **R2** — Loader: delete team tilde expansion and the `agent.team.*.members` merge rule. Add a guard that runs before schema parse and fails any layer carrying `agent.team`, naming that file and `agent.fleet` in `<project>/.spur/config.yaml` as the replacement. `misplacedGlobalKeys` drops its `agent.team` branch.
- **R3** — Delete `TeamService.listTeams`, `materializeTeam`, `teardownTeam`, the team roster part of `getStatus`, `resolveAutostartSet`, `TeamLifecycleEventPayload`, and the `team.up`/`team.down` events (bus map, `event-names.ts` entries and payload schemas). Keep `materializeRoster` and `resolveMemberExecutor` — `FleetService` uses them.
- **R4** — Server: delete `GET /api/team/teams`, the autostart block in `serve.ts`, `SPUR_TEAM_AUTOSTART`, `ServerBootConfig.teamAutostart` and the context option, and the `SPUR_TEAM_AUTOSTART` mention in the `scheduler-custom-job-service.ts` env-allowlist comment. Autostart returns on the fleet path in task 0858.
- **R5** — Web: delete `lib/use-teams-data.ts`; `MemberDetail` takes the work dir from the fleet snapshot `path` and the model from the declared member, showing `Executor default` when none.
- **R6** — Tests: delete or rewrite the roster cases (`apps/cli/tests/commands/agent-team.test.ts` including the 0544 case, `packages/config/tests/team-config.test.ts`, `packages/app/tests/services/team-service.test.ts` materialize/teardown/listTeams/autostart, server tests for `/api/team/teams` and autostart, config and loader tests). Add loader tests for the guard at both the project and the global layer. `apps/cli/schemas/spur-config.schema.json` drops `agent.team`.
- **R7** — Same-commit docs for these surfaces: `docs/design/observability-contracts.md` (the `/api/team/teams` row, :352 — no `team.up`/`team.down` rows live there), `docs/design/event-tracking.md` (`team.up`/`team.down` catalog rows :73-74 and payload row :296), `docs/inventory/system-events-producer-audit.md` (rows :92-93, :98, :171, :200), the `agent.team` role wording in `cli-contracts.md` (:279), and the `config/config.global.yaml` / `config.example.yaml` comments. `docs/design/configuration-contracts.md` carries no team or fleet rows today — confirm only, nothing to sync.

### Acceptance Criteria

Graduates G65 feature scenario R2 — the Gherkin
below carries its exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R2 — Retired fleet declarations fail loudly with their replacement
      Given a config that still carries agent.team, a global-layer agent.fleet, or a project with .spur/fleet.json
      When the config loads or spur serve starts
      Then the load fails with an error naming the offending key or file and the agent.fleet replacement
      And nothing is silently stripped, merged, or read from the retired source
```

- **AC1 — A leftover agent.team fails loudly (R1, R2).** Given a `.spur/config.yaml` or `~/.config/spur/config.yaml` containing an `agent.team` block, when any config load runs (a CLI command or `spur serve`), then it fails with an error naming that file and `agent.fleet` as the replacement, and no command proceeds on a stripped config.
- **AC2 — The roster runtime is gone (R3, R4, R5).** Given the source tree, when `rg -n "agent\.team|TeamConfigSchema|resolveAutostartSet|SPUR_TEAM_AUTOSTART|team\.(up|down)\b|/team/teams|use-teams-data"` runs over `apps/`, `packages/` and `config/` (excluding generated bundles and the guard's own error text and tests), then there are zero hits; `GET /api/team/teams` returns 404; `MemberDetail` renders the work dir and model from the fleet snapshot.
- **AC3 — Gates pass (R6, R7).** Given the change, when `bun run spur-check`, `bun run test-cf` and `bun run build` run, then all pass with the guard tests included.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:33.800Z

**Decisions**

- **Loud failure over silent strip.** Zod would drop an unknown `agent.team` key, so the guard inspects each layer's parsed YAML before schema parse in `loader.ts` — the one path every CLI command and `spur serve` load through (design §2).
- **No converter, no shim.** Nothing reads `agent.team` after this task; the error text names the replacement.
- **Accepted interim gap.** Between this task and 0858, `spur serve` autostarts nothing: `agent.team` was the only autostart source and the fleet path lands in 0858. Both ship on the same feature branch.
- **Roster helpers stay put here.** `materializeRoster` / `resolveMemberExecutor` remain in `team-service.ts` for `FleetService`; 0860 moves them.
- **Supervisor `team:` tag reader stays until 0860.** Only `materializeTeam` wrote `team:` tags; once it is gone the reader is inert, and 0860 deletes it with the rest of the identity vocabulary.
- **`memberLocalId` frozen.** Only its parameter type narrows; derived ids are byte-identical.

**Premises (verified 2026-09-14)**

- Config: `packages/config/src/index.ts:368` `TeamMemberConfigSchema`, `:408` `TeamConfigSchema`, `:442` `normalizeMember`, `:658` `team:` key, `:732` member normalization in the superRefine, `:979` `misplacedGlobalKeys` doc.
- Loader: `packages/config/src/loader.ts:334-353` team tilde expansion, `:433` `agent.team.*.members` merge rule.
- Server: `apps/server/src/serve.ts:19,709-715` `resolveAutostartSet` + `startAutostart`; `server-config.ts:16,24-25,48`; `context.ts:300,354`; `/teams` at `modules/team/index.ts:215`.
- App: `team-service.ts:149-150` bus entries, `:991`/`:1021` `team.up`/`team.down` emits, `:1202` `resolveAutostartSet`; `scheduler-custom-job-service.ts:86` comment.
- Web: `apps/web/src/modules/projects/MemberDetail.tsx:3,24` is the only `useTeamsData` consumer.
- Tests: `packages/config/tests/{team-config,loader,config-schemas}.test.ts`, `apps/cli/tests/commands/agent-team.test.ts`, `packages/app/tests/services/team-service.test.ts`, `apps/server/tests/{serve,context}.test.ts`, `apps/server/tests/modules/team/index.test.ts`, `apps/web/tests/modules/projects/MemberDetail.test.tsx`.

**Dependencies:** 0856 (`LegacyMigrationService` reads `agent.team`).

#### Q&A entry — 2026-09-15T06:11:03.214Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:33.800Z

**Decisions**

- **Loud failure over silent strip.** Zod would drop an unknown `agent.team` key, so the guard inspects each layer's parsed YAML before schema parse in `loader.ts` — the one path every CLI command and `spur serve` load through (design §2).
- **No converter, no shim.** Nothing reads `agent.team` after this task; the error text names the replacement.
- **Accepted interim gap.** Between this task and 0858, `spur serve` autostarts nothing: `agent.team` was the only autostart source and the fleet path lands in 0858. Both ship on the same feature branch.
- **Roster helpers stay put here.** `materializeRoster` / `resolveMemberExecutor` remain in `team-service.ts` for `FleetService`; 0860 moves them.
- **Supervisor `team:` tag reader stays until 0860.** Only `materializeTeam` wrote `team:` tags; once it is gone the reader is inert, and 0860 deletes it with the rest of the identity vocabulary.
- **`memberLocalId` frozen.** Only its parameter type narrows; derived ids are byte-identical.

**Premises (verified 2026-09-14)**

- Config: `packages/config/src/index.ts:368` `TeamMemberConfigSchema`, `:408` `TeamConfigSchema`, `:442` `normalizeMember`, `:658` `team:` key, `:732` member normalization in the superRefine, `:979` `misplacedGlobalKeys` doc.
- Loader: `packages/config/src/loader.ts:334-353` team tilde expansion, `:433` `agent.team.*.members` merge rule.
- Server: `apps/server/src/serve.ts:19,709-715` `resolveAutostartSet` + `startAutostart`; `server-config.ts:16,24-25,48`; `context.ts:300,354`; `/teams` at `modules/team/index.ts:215`.
- App: `team-service.ts:149-150` bus entries, `:991`/`:1021` `team.up`/`team.down` emits, `:1202` `resolveAutostartSet`; `scheduler-custom-job-service.ts:86` comment.
- Web: `apps/web/src/modules/projects/MemberDetail.tsx:3,24` is the only `useTeamsData` consumer.
- Tests: `packages/config/tests/{team-config,loader,config-schemas}.test.ts`, `apps/cli/tests/commands/agent-team.test.ts`, `packages/app/tests/services/team-service.test.ts`, `apps/server/tests/{serve,context}.test.ts`, `apps/server/tests/modules/team/index.test.ts`, `apps/web/tests/modules/projects/MemberDetail.test.tsx`.

**Dependencies:** 0856 (`LegacyMigrationService` reads `agent.team`).

#### Q&A entry — 2026-09-14 refineall ready-depth pass

**Decisions**

- **R7 doc surface corrected on re-verification:** `configuration-contracts.md` has zero team/fleet rows (confirm only); `observability-contracts.md` holds only the `/api/team/teams` row — the `team.up`/`team.down` catalog rows live in `docs/design/event-tracking.md` (:73-74, :296) and `docs/inventory/system-events-producer-audit.md` (:92-93, :98, :171, :200), both added to R7.
- **R5 data source confirmed:** `GET /api/project/fleet` already exists (`apps/server/src/modules/health/index.ts:82`), so `MemberDetail` rewire has no hidden 0858 dependency. All other premises (file:line carriers, test files, schema key at `spur-config.schema.json:196`) re-verified against the tree unchanged.

### Design

**Guard placement.** The loader is the single path both the CLI and `spur serve` load config through, so one guard there satisfies R2 for every entry point. It inspects the parsed YAML of each layer before Zod parse (Zod would otherwise strip the unknown key silently). Error shape: `agent.team is no longer supported (<file>). Declare the project fleet under agent.fleet in <project>/.spur/config.yaml.` Task 3 extends the same guard with the global-layer `agent.fleet` and `.spur/fleet.json` checks.

**No shim, no converter.** Nothing reads `agent.team` after this task; the loud failure is the migration signal (Deterministic over implicit).

**Accepted gap.** Between this task and task 3 `spur serve` autostarts nothing: the only autostart source was `agent.team`, and the fleet path lands in task 3.

**Frozen.** `memberLocalId` derivation is byte-identical — only its parameter type narrows.

### Plan

1. Config: remove the team schemas/types/key, narrow the `memberLocalId` input type, add the retired-key guard in the loader, drop the misplaced-key branch; update config/loader tests and add guard tests.
2. App: delete the team roster methods, `resolveAutostartSet` and the `team.up/down` events; fix team-service tests.
3. Server: delete `/api/team/teams`, the autostart block and the `SPUR_TEAM_AUTOSTART` boot config; fix server tests.
4. Web: delete `use-teams-data.ts`, rewire `MemberDetail`; fix web tests.
5. CLI tests (`agent-team.test.ts`), JSON schema, config comments and the owning design satellites.
6. `bun run spur-check`, `bun run test-cf`, `bun run build`.

### Solution

The `agent.team` roster is gone end to end, and the load fails loudly instead of stripping it (R1, R2).
`packages/config/src/index.ts` drops `TeamMemberConfigSchema`, `TeamConfigSchema`, their types,
`normalizeMember` and the `agent.team` key with its composed-id `superRefine`; what remains of the
roster vocabulary is the new `MemberIdentity` interface — exactly the fields `memberLocalId` derives
from — with the derivation itself untouched, so every derived id stays byte-identical. Every consumer
that used to cast a roster member (`fleet-service.ts`) now passes its own `FleetMember` and drops the
cast. `packages/config/src/loader.ts` deletes the team tilde expansion and the
`agent.team.*.members` merge-by-id rule, and adds `assertNoRetiredTeamKey`, which inspects each
layer's parsed YAML before merge and before either schema — Zod would have stripped the unknown key
silently, and the JSON-Schema pass would have reported it generically — and throws
`agent.team is no longer supported (<file>). Declare the project fleet under agent.fleet in
<project>/.spur/config.yaml.` A sibling task extends the same guard with the global-layer
`agent.fleet` and `.spur/fleet.json` checks. `misplacedGlobalKeys` drops its `agent.team` branch,
since a leftover block is now a load error rather than a classification.

The runtime that read that roster is deleted, not renamed (R3, R4, R5).
`packages/app/src/services/team-service.ts` loses `listTeams`, `materializeTeam`, `teardownTeam`,
`resolveAutostartSet`, `TeamLifecycleEventPayload` and the `team.up` / `team.down` bus entries
together with their `event-names.ts` catalog and payload-schema rows; `materializeRoster` and
`resolveMemberExecutor` stay (they are the shared projection `FleetService` uses) and carry the new
`RosterMember` shape. `listRecent` re-derives its identity index from the specs on disk, so messages
still resolve team id, member label and agent type — only the config-supplied display name is gone.
The server side follows: `GET /api/team/teams` is unregistered, the `serve.ts` autostart block,
`SPUR_TEAM_AUTOSTART`, `ServerBootConfig.teamAutostart` and its context option are removed, and the
env-allowlist comment no longer names the retired variable. Autostart is intentionally absent until
the fleet path lands: `agent.team` was its only source, and the interim gap is recorded in the task
Q&A and in `serve.ts` where the block used to be. On the web, `lib/use-teams-data.ts` is deleted and
`MemberDetail` takes its work dir from the fleet snapshot `path` and names `Executor default` for a
declared member (a fleet member declares no model) and `Unavailable` for an undeclared process.

Tests follow the retired surfaces rather than being suppressed: `team-config.test.ts` becomes
`member-local-id.test.ts` (the frozen allocator plus `resolveExecutor`), `team-service-0258.test.ts`
and `use-teams-data.test.ts` are deleted, the loader suite gains project-layer and global-layer guard
cases (the latter hermetic through a `HOME`-redirected subprocess, since the global path binds at
module load), the 0796 disabled-executor regression is repointed at `resolveMemberExecutor` where the
guard now lives, and the 0544 role/executor case in `apps/cli/tests/commands/agent-team.test.ts`
builds its roster from `.spur/fleet.json` through `FleetService.materialize`. The hand-maintained
`spur-config.schema.json` drops `agent.team`, and the seven R7 doc surfaces (observability contract
route row, event catalog rows, producer audit rows, `cli-contracts` declaration site, both config
templates) name the replacement instead of the retired key.

R6/R7 docs and schema: the JSON Schema and both config templates are synced, and the authority-doc
sweep (ADR amendment, supersession banner, plugin references) belongs to the feature's document task.

Change map — one anchor per row, first changed line per file; the three deleted files are named in
prose above because a citation into a removed file cannot resolve:

| Change |
| --- |
| `packages/config/src/index.ts:367` |
| `packages/config/src/loader.ts:333` |
| `packages/app/src/services/team-service.ts:232` |
| `packages/app/src/services/team-service.ts:618` |
| `packages/app/src/services/fleet-service.ts:189` |
| `packages/app/src/services/event-names.ts:316` |
| `packages/app/src/services/scheduler-custom-job-service.ts:86` |
| `packages/app/src/index.ts:592` |
| `apps/server/src/serve.ts:705` |
| `apps/server/src/context.ts:158` |
| `apps/server/src/server-config.ts:15` |
| `apps/server/src/modules/team/index.ts:212` |
| `apps/web/src/modules/projects/MemberDetail.tsx:30` |
| `apps/cli/schemas/spur-config.schema.json:176` |
| `packages/config/tests/member-local-id.test.ts:14` |
| `packages/config/tests/loader.test.ts:741` |
| `packages/config/tests/config-schemas.test.ts:116` |
| `packages/config/tests/loader-layers.test.ts:253` |
| `packages/app/tests/services/team-service.test.ts:814` |
| `packages/app/tests/services/fleet-service.test.ts:473` |
| `packages/app/tests/services/event-names.test.ts:196` |
| `apps/cli/tests/commands/agent-team.test.ts:56` |
| `apps/server/tests/serve.test.ts:488` |
| `apps/server/tests/modules/team/index.test.ts:641` |
| `apps/server/tests/server-config.test.ts:16` |
| `apps/web/tests/modules/projects/MemberDetail.test.tsx:100` |
| `config/config.global.yaml:21` |
| `config/config.example.yaml:196` |
| `docs/design/observability-contracts.md:352` |
| `docs/design/event-tracking.md:73` |
| `docs/inventory/system-events-producer-audit.md:92` |
| `docs/design/cli-contracts.md:279` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | rg lens `agent\.team |
| R2 | MET | `packages/config/tests/loader.test.ts` describe "retired agent.team guard" → 4 tests, 0 fail (fresh): project-layer and global-layer `agent.team` each fail the load naming the file and the `agent.fleet` replacement; guard text at `packages/config/src/loader.ts:341`. |
| R3 | MET | rg lens `resolveAutostartSet |
| R4 | MET | rg lens `SPUR_TEAM_AUTOSTART |
| R5 | MET | `apps/web/tests/modules/projects/MemberDetail.test.tsx` → 9 pass, 0 fail (fresh); `lib/use-teams-data.ts` absent from the tree (rg `use-teams-data` → zero hits outside tests). |
| R6 | MET | Guard tests fresh-green (4 pass); `packages/config/tests/member-local-id.test.ts` backward-compat + 0857 case present; `apps/cli/schemas/spur-config.schema.json` has no `team` key. |
| R7 | MET | Same-commit docs landed in the merged G65 chain (0861 owns the authority sync and verified the satellites); `git log` for the retirement commit `9f9e1ee51` shows config templates and docs updated with the code. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Retired fleet declarations fail loudly with their replacement | MET | test | `cd packages/config && bun test tests/loader.test.ts -t "retired agent.team guard"` → 4 pass, 0 fail (fresh): a project config carrying `agent.team` and a global-layer `agent.team` each fail the load naming the file and `agent.fleet` in `<project>/.spur/config.yaml` as the replacement; nothing stripped or merged (guard runs before schema parse). |
| AC1 — A leftover agent.team fails loudly (R1, R2) | MET | test | Same guard suite (4 pass, fresh) + `bun test tests/loader.test.ts -t "backward-compat"` → 1 pass (no-`agent.team` config loads unchanged). |
| AC2 — The roster runtime is gone (R3, R4, R5) | MET | command | Fresh rg lens over apps/packages/config → zero hits outside the excluded sets (guard error text `loader.ts:341`, tests, gitignored `config/@gobing-ai` + `config/workflows/@gobing-ai` build:bundle output, and 0858's retirement-narration prose comments). `apps/server/src/modules/team/` absent → `GET /api/team/teams` unroutable; MemberDetail suite 9 pass / 0 fail. |
| AC3 — Gates pass (R6, R7) | MET | command | Focused suites fresh-green (guard 4, compat 1, health/team-module 21, MemberDetail 9, all 0 fail); full `bun run spur-check` / `test-cf` / `build` evidence captured once batch-wide for the merged G65 tree (see verifyall batch report). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T07:36:38.333Z todo → wip (system)
- 2026-09-15T08:33:54.309Z wip → testing (system)
- 2026-09-15T08:34:20.491Z testing → done (system)

