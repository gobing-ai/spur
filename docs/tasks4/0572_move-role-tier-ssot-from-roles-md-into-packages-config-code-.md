---
template: feature-impl
schema_version: 1
name: "Move role-tier SSOT from roles.md into packages/config (code defaults + agent.roles override)"
description: ""
status: todo
type: task
profile: standard
feature_id: B3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T18:41:48.594Z"
updated_at: "2026-08-16T18:59:09.892Z"
---

## 0572. Move role-tier SSOT from roles.md into packages/config (code defaults + agent.roles override)

### Background
The role → tier/stages map is a CLI routing contract (it defines the `--agent` selector domain and drives `packages/app/src/services/agent-service.ts` resolution), but its SSOT is a plugin markdown file that the CLI regex-parses at runtime (`apps/cli/src/context.ts:85` `loadAgentRoles`, walking up from `import.meta.dir` for `plugins/sp/references/roles.md`). Two inversions: (1) core routing depends on plugin content — a missing/stale plugin tree hard-fails every role dispatch with `Unknown declared role`; (2) the parse is regex-over-markdown whose shape is frozen by a test inside the plugin (`roles.test.ts`), i.e. the plugin tests the CLI's runtime dependency. Operator decision 2026-08-16: the SSOT must live in the spur CLI (config domain), with roles.md kept as a fast projection for agents/humans.

Current values to preserve exactly (zero-behavior-change requirement): scribe=cheap stages[changelog]; coder=standard stages[implement,test,wrap]; reviewer=capable-1 stages[verify,review,dogfood]; planner=capable-2 stages[plan,refine,brainstorm]. The vocabulary stays closed (0536): scribe, coder, reviewer, planner — the override may re-tier/re-stage but never invent roles. `AGENT_ROLE_NAMES` already lives in `packages/config/src/index.ts:151` — extend, don't duplicate.

Surfaces: `packages/config/src/index.ts` (constant + optional `agent.roles` schema), `apps/cli/src/context.ts` (loader rewrite; delete `bundledRolesFile` + the regex parse), `packages/app/src/services/agent-service.ts` (ctx.roles type unchanged), `plugins/sp/tests/roles.test.ts` (parity assertion), `plugins/sp/references/roles.md` (projection marker + regenerated content), `config/config.example.yaml` (commented `agent.roles` block), `docs/00_ADR.md` (dated entry).
### Requirements
- [ ] R1. Add `DEFAULT_AGENT_ROLES` to `packages/config` — the four roles with tier + stages at exactly today's roles.md values — and an optional `agent.roles` config schema keyed on the closed vocabulary (re-tier/re-stage only; unknown role ids fail config load). (feature B3 R2)
- [ ] R2. Rewrite `loadAgentRoles()` in `apps/cli/src/context.ts`: project config `agent.roles` (validated) wins, else `DEFAULT_AGENT_ROLES`. Delete `bundledRolesFile()` and the regex markdown parse entirely — no transition shim, since code defaults equal current values and resolution is byte-identical. (feature B3 R1, R4, R5)
- [ ] R3. Extend `plugins/sp/tests/roles.test.ts` with a parity assertion: every role's id/tier/stages in roles.md equals `DEFAULT_AGENT_ROLES`; mark roles.md's yaml block as a projection ("generated view; edit packages/config, not this file"). Keep the existing closure and command-mapping tests intact. (feature B3 R3)
- [ ] R4. Document: commented `agent.roles` block in `config/config.example.yaml`, a dated ADR entry recording the SSOT move, and a sync of the role-map comment block in `.spur/config.yaml` / `config.example.yaml` (they currently name roles.md as SSOT). (feature B3 R1, R3)
### Acceptance Criteria
```gherkin
Scenario: R1 — Code defaults drive role resolution without the plugin file
  Given `plugins/sp/references/roles.md` is temporarily unreachable
  When a role dispatch resolves (e.g. `--agent reviewer`)
  Then resolution uses `DEFAULT_AGENT_ROLES` from `packages/config` and succeeds
  And the resolved tier matches the pre-change roles.md value

Scenario: R2 — A project `agent.roles` override wins over the code default
  Given `.spur/config.yaml` declares `agent.roles.reviewer.tier: capable-2`
  When `--agent reviewer` resolves
  Then the starting tier is capable-2
  And a config naming a role outside the closed vocabulary fails at config load

Scenario: R3 — roles.md is a parity-gated projection
  Given roles.md's fenced yaml block and DEFAULT_AGENT_ROLES
  When `plugins/sp/tests/roles.test.ts` runs
  Then a parity assertion proves id/tier/stages equal for every role
  And a hand-edit to roles.md's tier without a code change fails the suite

Scenario: R4 — The markdown parse path is gone, not shimmed
  Given the fix is complete
  When `apps/cli/src/context.ts` is inspected
  Then no `bundledRolesFile` / roles.md walk-up remains
  And no `@transition-shim` entry was added for the move

Scenario: R5 — Existing resolutions are byte-identical after the move
  Given the pre-change roles.md values as fixture
  When scribe/coder/reviewer/planner resolve in this project
  Then each picks the same tier and executor as before the change
```
### Q&A
**Closed during --depth ready refinement (2026-08-16).** Delete-vs-shim: delete the markdown parse outright — code defaults are byte-identical to the current roles.md values, so a fallback could only ever reintroduce drift; registered as a deliberate no-shim decision (B3 R4 pins this). Override semantics: per-field merge (re-tier without restating stages), role-id-keyed record, closed vocabulary enforced at config load. Constant home: packages/config beside AGENT_ROLE_NAMES (the CF-safe literal home); packages/app consumes the unchanged AgentRoleDefinition shape via its existing spur-config edge. Test fallout enumerated and assigned: agent.test.ts:862 repoint is in-plan, team.ts consumes the map and is untouched.

**Context.** This task exists because the operator ruled (2026-08-16) that the role→tier SSOT belongs to the spur CLI config domain, treating the roles.md runtime parse as implementation drift; roles.md survives as the agent-facing projection with a parity gate so the cache can never silently stale.
### Design
**WHAT.** Move the role→tier/stages map's SSOT from a runtime-parsed plugin markdown file into the CLI: a code constant in `packages/config`, an optional `agent.roles` override in the config schema, and a two-line resolution order. `roles.md` survives only as a parity-gated projection.

**WHY (premise-verified 2026-08-16).** The current chain is `loadAgentRoles()` → walk-up from `import.meta.dir` → regex-parse of `plugins/sp/references/roles.md` (`apps/cli/src/context.ts:40-91`). Core routing depends on plugin content; the regex shape is frozen by a plugin test. All consumers enumerated: `context.ts:159` (CLI context), `apps/cli/tests/commands/agent.test.ts:18,862` (imports `bundledRolesFile`/`parseAgentRoles` — must be repointed), `apps/cli/src/commands/team.ts:365` (consumes `context.agentRoles` map — unaffected). AgentService consumes `ctx.roles: ReadonlyMap<string, AgentRoleDefinition>` — shape unchanged, no app-layer edit beyond imports.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/config/src/index.ts` | add `AgentRoleConfigSchema`, optional `roles` on the agent schema, `DEFAULT_AGENT_ROLES` constant, `AgentRoleOverride` type |
| `apps/cli/src/context.ts` | add `resolveAgentRoles(config)`; rewrite `loadAgentRoles()` call site to `options.agentRoles ?? resolveAgentRoles(options.agentConfig)`; DELETE `bundledRolesFile()` + `parseAgentRoles()` |
| `apps/cli/tests/commands/agent.test.ts` | repoint the roles-file assertions (line ~862) at `DEFAULT_AGENT_ROLES` |
| `plugins/sp/tests/roles.test.ts` | add parity assertion: roles.md fenced block ≡ `DEFAULT_AGENT_ROLES` (import from `@gobing-ai/spur-config`; precedent: stage-registry-parity.test.ts imports workspace packages) |
| `plugins/sp/references/roles.md` | projection banner above the fenced block ("edit DEFAULT_AGENT_ROLES in packages/config, not this file"); command→role mapping stays — that half is plugin data |
| `config/config.example.yaml` | commented `agent.roles` example block |
| `docs/00_ADR.md` | dated ADR-061 entry (SSOT move rationale) |

**Frozen names / shapes.**

- `DEFAULT_AGENT_ROLES: ReadonlyMap<AgentRoleName, { tier: ExecutorCapabilityTier; stages: readonly string[] }>` in packages/config — values byte-identical to today's roles.md: scribe=cheap[changelog] · coder=standard[implement,test,wrap] · reviewer=capable-1[verify,review,dogfood] · planner=capable-2[plan,refine,brainstorm].
- Config shape: `agent.roles: { <roleId>: { tier?: <tier>; stages?: string[] } }` — record keyed by role id. Unknown key fails config load naming the accepted four (zod key validation + superRefine message). Per-field merge over the default (override `tier` without restating `stages`); a role absent from the map uses the default wholesale. Merge semantics documented on the schema field.
- `AgentRoleDefinition` (packages/app, `{tier, stages}`) unchanged — the override resolves into the same map shape; packages/app already depends on `@gobing-ai/spur-config` (package.json:20).

**Anti-patterns — do NOT:**

- Do not keep the roles.md read as a fallback tier of the resolution chain — delete, not shim (defaults equal current values; a silent fallback would reintroduce the drift this task removes). No `@transition-shim` entry.
- Do not widen the vocabulary — a project may re-tier/re-stage, never invent roles (0536 closed domain).
- Do not move `AGENT_ROLE_NAMES` — extend in place (it's already the CF-safe home).
- Do not edit roles.md's `commands:` lists from this task — command→role closure stays plugin-owned (command frontmatter is its SSOT).

**Handoff.** No `dependencies[]`. Downstream expectation: none — resolution outputs are byte-identical by construction (B3 R5 fixture test proves it).
### Plan
- [ ] Add `DEFAULT_AGENT_ROLES` + `AgentRoleConfigSchema` + optional `agent.roles` field (with closed-vocabulary superRefine) to `packages/config/src/index.ts`; unit tests for default shape + override merge + unknown-role rejection (R1)
- [ ] Rewrite the loader in `apps/cli/src/context.ts` (`resolveAgentRoles` + new call site); delete `bundledRolesFile`/`parseAgentRoles`; repoint `agent.test.ts:862` assertions at the constant (R2)
- [ ] Add the roles.md ≡ DEFAULT_AGENT_ROLES parity assertion to `plugins/sp/tests/roles.test.ts` + the projection banner in roles.md (R3)
- [ ] Commented `agent.roles` block in `config/config.example.yaml`; ADR-061 dated entry; update the SSOT comment blocks in `.spur/config.yaml` and `config.example.yaml` (they currently name roles.md as SSOT) (R4)
- [ ] Verify: `bun test packages/config apps/cli plugins/sp` green; `bun run lint` clean; live re-probe `--agent scribe|coder|reviewer|planner` resolution byte-identical to pre-change (R5 fixture) (R2, R4)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

B3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
