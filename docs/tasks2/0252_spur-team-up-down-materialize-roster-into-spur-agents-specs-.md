---
template: feature-impl
schema_version: 1
name: "spur team up/down: materialize roster into .spur/agents specs; reconcile with existing team start/stop"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:02.470Z"
updated_at: "2026-07-14T06:20:43.154Z"
---

## 0252. spur team up/down: materialize roster into .spur/agents specs; reconcile with existing team start/stop

### Background
**Wayfinder ticket (grilling/prototype)** for feature M.

DD-1 requires roster → spec materialization. Existing verbs are `team assign|status|start|stop`
(start/stop act per-agent via the server API). This ticket designs `spur team up|down` (whole-team
materialize/teardown) and reconciles them with the per-agent verbs.

**Blocked by:** 0250 (schema), 0251 (identity). Resolve those first.
See `apps/cli/src/commands/team.ts`, `packages/app/src/services/team-service.ts`.
### Requirements
R1. `spur team up <team>`: generate one `.spur/agents/<member-id>.yaml` per roster member; idempotent (regenerate generated specs, preserve manually-authored ones).
R2. `spur team down <team>`: stop members and optionally remove generated specs (never manual ones).
R3. Reconcile with `team start/stop <agent-id>` — `up/down` become team-scoped wrappers over the per-member verbs.
R4. `team status` groups by team instead of listing a flat agent set.
R5. Drift detection: roster changed in config since the last `up` (stale generated specs).
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**`spur team up <team> [--check]`** — materialize (local FS), then best-effort start:

```
load agent.team.<team>                          # config-schema ticket shape
for each member (skip ref: → roster pointer only, no file):
    id   = <team>-(member.id ?? executor)       # identity ticket rule
    type = resolve(executor)                     # executors-first, raw-agent fallback
    spec = { id, name:id, type,
             workspace: member.workspace ?? team.work_dir,
             purpose, tags:[team:<team>, spur:generated],
             autoStart: member.autostart ?? team.autostart ?? false,
             config:{ model, autonomy, systemPrompt } }
existing = listAgentSpecs() ∩ {tag spur:generated ∧ tag team:<team>}
  add    = roster − existing        → saveAgentSpec (create)
  change = roster ∩ existing, differs → saveAgentSpec (overwrite)
  orphan = existing − roster        → deleteAgentSpec (prune)
--check → print add/change/orphan, write nothing
else    → write; if serverReachable start autostart members (server API)
                 else print "run spur serve to start"
```

**`spur team down <team> [--purge]`** — stop, keep specs unless purged:

```
members = listAgentSpecs() ∩ {tag team:<team>}   # includes ref: members
if serverReachable: stop each running member (per-member server stop path)
--purge: deleteAgentSpec for members tagged spur:generated  (skip ref:/manual)
```

**`spur team status`** — group by team:

```
group listAgentSpecs() by team:<id> tag → { team → [member, status] }
untethered = specs with no team:<id> tag
status per member via existing getStatus() (server), else 'stopped' offline
```

**Idempotency + safety:**

| Spec kind | tags | `up` regenerates? | `down --purge` removes? |
|---|---|---|---|
| Generated | `spur:generated` + `team:<id>` | yes | yes |
| `ref:` alias | `team:<id>` (no `spur:generated`) | no (pointer only) | no |
| Hand-authored | no `team:` tag | no | no |
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Resolved via grilling** (3 forks) — designs `spur team up/down`; concrete flow in **### Design**.

| Fork | Decision |
|---|---|
| Provenance marker | **Tag `spur:generated`** — generated specs carry `tags: [team:<id>, spur:generated]`; `team up` only regenerates/removes marked specs for that team; hand-authored + `ref:` specs are never touched |
| `team up` scope | **Materialize always (local FS) + start autostart if server reachable** — files always land; process-start is best-effort, honoring the per-member autostart from the config-schema ticket |
| `team down` scope | **Stop only + keep specs by default; `--purge` removes generated specs** (never manual / `ref:`) |

**Requirements resolution:**
- **R1 — `team up`:** per roster member (skip `ref:` → record a roster pointer, no file), build an `AgentSpec` (config-schema shape; id `<teamId>-(member.id ?? executor)` per the identity ticket), stamp `tags: [team:<id>, spur:generated]`, and **upsert via `saveAgentSpec`** — NOT `createAgentSpec`, which is create-only and throws on an existing spec (`packages/app/src/services/team-service.ts:304`). Idempotent: regenerate marked specs, never touch unmarked ones. Then start autostart members if `spur serve` is reachable.
- **R2 — `team down`:** stop running members via the per-member server stop path; keep specs by default; `--purge` deletes only `spur:generated`-tagged specs for the team.
- **R3 — reconcile:** `up/down` iterate the roster and delegate to the SAME per-member start/stop the existing `team start/stop <agent-id>` use (server API, `apps/cli/src/commands/team.ts:48`) — team-scoped wrappers, not a new supervisor path.
- **R4 — `team status`:** group `listAgentSpecs()` by the `team:<id>` tag → team → members → status; specs with no team tag list as untethered.
- **R5 — drift:** `team up` diffs roster ⇄ marked specs for the team — add new, regenerate changed, prune orphans (marked specs whose member left the roster). `team up --check` reports drift, writes nothing.

**Constraints surfaced (not averaged):**
- **Per-member `command` cannot round-trip today.** `serializeAgentSpec` + `loadAgentSpecs` drop a top-level `command`, but the supervisor reads top-level `spec.command` (`packages/app/src/services/supervisor-service.ts:252`). Fix: route a member's `command` through `config.command` AND update `resolveCommand` to read `config.command` (fallback = drain wrapper). Hands back to the config-schema ticket + a supervisor change; until then `command` is not a materializable override.
- **Autostart wiring gap.** Serve-boot autostart reads the `SPUR_TEAM_AUTOSTART` env list (`apps/server/src/bootstrap.ts`), not `agent.team.*.autostart`. The config→autostart-set derivation belongs to the lifecycle ticket; `team up`'s best-effort start and serve-boot must share it.

**Grounding (where this lands):**
- `packages/app/src/services/team-service.ts:304` — `createAgentSpec` (create-only; materialization needs a `saveAgentSpec` upsert wrapper, e.g. `TeamService.materializeTeam`).
- `packages/app/src/services/team-service.ts:337` — `listAgentSpecs` (the spec set to diff for drift + the `team:<id>` grouping source).
- `packages/app/src/services/supervisor-service.ts:252` — `resolveCommand` reads top-level `spec.command` (the round-trip gap).
- `apps/cli/src/commands/team.ts:48` — server-backed `team start/stop` (`up/down` delegate here per member).

**Hands off to:**
- Lifecycle ticket — serve-boot autostart derivation from `agent.team.*.autostart` (shared with `team up`'s best-effort start) + keep-alive over started members.
- Implementation — a `TeamService.materializeTeam(teamId)` (upsert + prune by marker) and the `command` → `config.command` supervisor fix.
### Testing
**N/A** — decision ticket, no code to test. Verification = citation accuracy + a confidence rating on each claim.

**Citation check (verified from source, 2026-07-14):** every `file:line` in ## Solution confirmed —
`team-service.ts:304` (`createAgentSpec`, create-only throw), `:337` (`listAgentSpecs`),
`supervisor-service.ts:252` (reads top-level `spec.command`), `team.ts:25,48` (server-backed `start`,
`DEFAULT_SERVER` = localhost:3000). `agent-spec.ts` contains no `command` token → round-trip gap confirmed.

**Confidence (HIGH = verified from source today · MEDIUM = sound design, unproven until built · LOW = assumption to resolve at implementation):**

| Claim / decision | Level | Basis |
|---|---|---|
| Per-member `command` can't round-trip (serializer/loader drop it; supervisor reads top-level) | HIGH | `agent-spec.ts` has no `command`; `supervisor-service.ts:252` |
| Autostart via `SPUR_TEAM_AUTOSTART` env, not `agent.team.*.autostart` | HIGH | `bootstrap.ts:44` |
| `createAgentSpec` is create-only → materialization needs a `saveAgentSpec` upsert | HIGH | `team-service.ts:304` throw |
| `team start/stop` are server-backed (start needs `spur serve`) | HIGH | `team.ts:25,48` |
| `tags` is persisted → usable as the `spur:generated` marker | HIGH | `serializeAgentSpec` includes `tags` |
| The three forks (provenance tag / up-scope / down-scope) | MEDIUM | internally consistent design; unproven until implemented + dogfooded |
| Drift = roster ⇄ marked-spec diff; `team status` grouping by tag | MEDIUM | design, unimplemented |
| "server reachable" detection for `team up` best-effort start | LOW | mechanism unspecified (health-ping vs fetch-failure path) — decide at implementation |
| Reusing the per-agent server start path for team-batch start (no new endpoint) | LOW | assumed loop over existing `POST …/start`; batch semantics unverified |
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-14T06:12:39.186Z todo → wip (system)
- 2026-07-14T06:17:20.143Z wip → testing (system)
- 2026-07-14T06:17:22.672Z testing → done (system)
