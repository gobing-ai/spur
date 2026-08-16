---
template: feature-impl
schema_version: 1
name: "Move role-tier SSOT from roles.md into packages/config (code defaults + agent.roles override)"
description: ""
status: done
type: task
profile: standard
feature_id: B3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T18:41:48.594Z"
updated_at: "2026-08-16T23:12:40.987Z"
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
**Implemented 2026-08-16 (implement stage, inline dispatch).** The Layer-1 role → tier/stages SSOT moved from the runtime-parsed plugin markdown into `packages/config` code: a frozen constant, a closed-vocabulary `agent.roles` config override, and a two-line resolution order. The roles.md regex parse is deleted outright (no shim) — defaults are byte-identical to the last parsed values (R5).

Change map:

- `packages/config/src/index.ts:152` — `AGENT_ROLE_NAMES` doc updated (SSOT now here; roles.md is projection). `packages/config/src/index.ts:158` `AgentRoleSpec` (SSOT row shape: `{tier, stages}`), `packages/config/src/index.ts:173` `DEFAULT_AGENT_ROLES: ReadonlyMap<AgentRoleName, AgentRoleSpec>` with the four roles at exactly the roles.md values (scribe=cheap[changelog] · coder=standard[implement,test,wrap] · reviewer=capable-1[verify,review,dogfood] · planner=capable-2[plan,refine,brainstorm]), `packages/config/src/index.ts:187` `AgentRoleOverride` (per-field merge contract). `packages/config/src/index.ts:221` `AgentRoleConfigSchema` (tier from `EXECUTOR_CAPABILITY_TIERS`, stages as non-empty strings), threaded as optional `roles` at `packages/config/src/index.ts:433`; `packages/config/src/index.ts:439` superRefine enforces the closed key vocabulary — unknown role ids fail config load naming the offending value and the accepted four (0543 R5 message shape).
- `apps/cli/src/context.ts:35` — `resolveAgentRoles(agentConfig?)`: validated `agent.roles` merges per-field over `DEFAULT_AGENT_ROLES`; absent override → defaults wholesale. Call site `apps/cli/src/context.ts:113` = `options.agentRoles ?? resolveAgentRoles(options.agentConfig)`; `agentRoles` is now always defined on `CliContext` (resolution can no longer fail silently on a missing plugin tree). Deleted: `bundledRolesFile()`, `parseAgentRoles()`, `loadAgentRoles()`, `cachedRolesFile`, and the module-level FS seam (R4: no shim — verified `grep` finds no references; no `@transition-shim` marker added).
- `packages/app/src/services/agent-service.ts:112` — `AgentConfig` mirror interface gains `roles?: Record<string, {tier?, stages?}>` so the validated section passes through the CLI context unchanged; `AgentServiceContext.roles` type untouched (resolution never reads the field — merge happens at the CLI boundary).
- `apps/cli/tests/commands/agent.test.ts:861` — roles-map test repointed from the deleted `bundledRolesFile`/`parseAgentRoles` to `resolveAgentRoles()` asserting the four tiers from the code constant; `apps/cli/tests/commands/agent.test.ts:896` reviewer→capable-1 boundary test retitled to the new source, behavior unchanged.
- `plugins/sp/tests/roles.test.ts:310` — new R9 describe: roles.md fenced block ≡ `DEFAULT_AGENT_ROLES` on id/tier/stages (SSOT read as text — the plugin tree cannot resolve `@gobing-ai/spur-config`, same discipline as the pre-existing AGENT_ROLE_NAMES parity test; the task Design's "import from @gobing-ai/spur-config" citation was factually wrong for this tree), plus a mutation check proving the gate has teeth and a banner assertion.
- `plugins/sp/references/roles.md:41` — HTML comment projection banner above the fenced block ("generated view; edit DEFAULT_AGENT_ROLES in packages/config, not this file"; commands half stays plugin-owned); intro + consistency paragraphs updated to name the code SSOT and the R9 parity gate.
- `config/config.example.yaml:52` + `.spur/config.yaml:37` — SSOT comment blocks rewritten (DEFAULT_AGENT_ROLES in packages/config; roles.md = parity-gated projection), with a commented `agent.roles` override example (closed vocabulary, per-field merge) in config.example.yaml.
- `docs/00_ADR.md:642` — ADR-061 dated entry recording the move, the no-shim deletion decision, and the parity gate.

Design deviations (both forced by reality, verified by probe): (1) the parity test reads the constant as text rather than importing `@gobing-ai/spur-config` — `bun -e import` from `plugins/sp/tests` fails to resolve workspace packages (plugin tree installs into foreign repos; pre-existing header documents this); the frozen `AGENT_ROLE_NAMES` parity test in the same file already used the text-read pattern. (2) Unknown-key rejection uses `z.record(z.string(), …)` + superRefine rather than a zod enum-keyed record — zod 4's `z.record(z.enum(…))` requires ALL enum keys present (exhaustive semantics), which contradicts the optional-subset override; `z.partialRecord` exists but swallows custom enum errors behind a generic "Invalid key in record" message, violating the R2 AC (fail naming the accepted four). The superRefine form satisfies the AC exactly (verified message: `Unknown role "auditor" — expected one of: scribe, coder, reviewer, planner`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

**Re-audit 2026-08-16 (`/sp:dev-verify 0572 --auto --next --force --focus all --fix all`; working-tree diff, 18 files).** Every row below was re-proven with fresh evidence this run: targeted suites `bun test packages/config plugins/sp/tests/roles.test.ts` → 159 pass 0 fail; `bun test apps/cli/tests/context.test.ts apps/cli/tests/commands/agent.test.ts` → 49 pass 0 fail; `spur task check 0572` pass. Live probes re-run: schema rejects `auditor` naming the accepted four + rejects tier `deluxe`; `resolveAgentRoles()` prints the four pre-change tiers/stages; override reviewer→capable-2 wins with stages kept; roles.md physically absent → resolution still succeeds from DEFAULT_AGENT_ROLES (restored, md5-identical to pre-probe state). rg finds zero references to the deleted symbols; no transition-shim entry for this move. Verdict artifact refreshed at `.spur/run/0572-verdict.json` (all rows, incl. shippable check); fix ledger `.spur/run/0572-fix-created.json` = [] (no UNMET/PARTIAL, no major findings — no repairs minted, no follow-up tasks created).

**Post-verify P3 cleanup (2026-08-16, pre-commit, operator-requested).** After the verdict, the deferred P3 review finding was closed in-place rather than carried to a follow-up: `CliContext.agentRoles` became a required field (`apps/cli/src/context.ts:73`), the two dead `agentRoles !== undefined` spreads collapsed to `agentRoles` / `roles: agentRoles` (`context.ts:134,141`), and the dead optional chains + fallback ternary in `validateAgentSelector` collapsed to direct access (`apps/cli/src/commands/agent.ts:175-178`). Behavior-neutral: `resolveAgentRoles` could never return undefined, so no branch that could execute was removed. Re-verified after the edit — `bun run lint` exit 0 (7 workspaces typecheck), `bun test apps/cli/tests/context.test.ts apps/cli/tests/commands/agent.test.ts` 49 pass 0 fail, `bun test apps/cli` 742 pass with only the four known sandbox port-binding denials in the `projects` suite (`Failed to listen at 127.0.0.1`, unrelated surface). The verdict is unchanged at PASS; the R1–R5 evidence above was re-confirmed against this edited tree.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AC-1 (R1 DEFAULT_AGENT_ROLES + closed-vocab agent.roles schema) | MET | `packages/config/src/index.ts:173` constant (scribe=cheap[changelog] · coder=standard[implement,test,wrap] · reviewer=capable-1[verify,review,dogfood] · planner=capable-2[plan,refine,brainstorm]); `AgentRoleConfigSchema` :221; optional `roles` :433; superRefine :439 — live probe: unknown role `auditor` rejected with `Unknown role "auditor" — expected one of: scribe, coder, reviewer, planner`; `bun test packages/config` 139 pass |
| AC-2 (R2 loader rewrite, delete not shim) | MET | `apps/cli/src/context.ts:38` `resolveAgentRoles` (per-field merge, absent → defaults wholesale); call site :111 `options.agentRoles ?? resolveAgentRoles(options.agentConfig)`; production thread `apps/cli/src/index.ts:88` (`agentConfig: appRt.appConfig?.agent`); repo grep: zero refs to bundledRolesFile/parseAgentRoles/loadAgentRoles in ts sources; no @transition-shim |
| AC-3 (R3 parity gate + projection banner) | MET | `plugins/sp/tests/roles.test.ts:310` R9 (parity on id/tier/stages + mutation check + banner assertion); banner `plugins/sp/references/roles.md:41`; `bun test plugins/sp/tests/roles.test.ts` 20 pass; live mutation: tier: cheap→standard fails 2 tests, restored → green |
| AC-4 (R4 documentation sync) | MET | commented `agent.roles` block `config/config.example.yaml:60-73`; SSOT comment sync `.spur/config.yaml:37-42`; ADR-061 `docs/00_ADR.md` (dated 2026-08-16, rationale + no-shim decision + parity gate) |
| AC-5 (R5 byte-identical resolution) | MET | roles.md fenced yaml block untouched by diff; R9 parity proves constant ≡ roles.md; live probe resolves all four roles at pre-change tiers/stages; live AC: roles.md physically removed from disk → resolution still succeeds from DEFAULT_AGENT_ROLES (restored byte-identical) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Code defaults drive role resolution without the plugin file | MET | command | roles.md moved off disk; `resolveAgentRoles()` resolved scribe/coder/reviewer/planner at pre-change tiers from DEFAULT_AGENT_ROLES; restored byte-identical (`diff` clean) |
| R2 — A project `agent.roles` override wins over the code default | MET | command | `AgentConfigSchema.parse({roles:{reviewer:{tier:'capable-2'}}})` → reviewer tier=capable-2, stages keep default [verify,review,dogfood]; scribe untouched; safeParse({roles:{auditor:...}}) rejected, message names accepted four; out-of-vocab tier 'deluxe' rejected |
| R3 — roles.md is a parity-gated projection | MET | test | `bun test plugins/sp/tests/roles.test.ts` 20 pass incl. R9; live hand-edit (tier: cheap→standard) failed 2 tests (gate has teeth); restored → green; banner asserted naming DEFAULT_AGENT_ROLES + packages/config/src/index.ts |
| R4 — The markdown parse path is gone, not shimmed | MET | command | zero references to bundledRolesFile/parseAgentRoles/loadAgentRoles in apps/packages/plugins ts sources (grep exit 1); roles.md walk-up + memoized FS seam deleted from context.ts diff; no @transition-shim anywhere |
| R5 — Existing resolutions are byte-identical after the move | MET | command | live probe: scribe=cheap[changelog] coder=standard[implement,test,wrap] reviewer=capable-1[verify,review,dogfood] planner=capable-2[plan,refine,brainstorm]; R9 parity ≡ untouched roles.md fenced block |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Reviewed 2026-08-16 (review stage, /sp:dev-review 0572 --auto; working-tree diff, 12 files, +329/−113).**

Scope: `git diff` of the uncommitted 0572 implementation (dev-gtd.md not present in tree — nothing excluded). Dimensions: functional traceability, SECUA (security/correctness/efficiency/usability), architecture depth.

**Verdict: PASS — no P1/P2 findings. Disposition: approve (auto).**

**Findings (P1-P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 (minor) — **resolved 2026-08-16, pre-commit** | SECUA | `apps/cli/src/context.ts:113` | dead undefined-guards left by the deleted file-load failure mode — fixed in the pre-commit cleanup: `CliContext.agentRoles` is now a required field (`context.ts:73`), the two dead spreads at `context.ts:134,141` set `agentRoles` / `roles: agentRoles` unconditionally, and the `agent.ts:175-181` optional chains + dead fallback ternary are direct access. Evidence: `bun test apps/cli/tests/context.test.ts apps/cli/tests/commands/agent.test.ts` 49 pass 0 fail; full `bun test apps/cli` 742 pass (only the four known sandbox port-binding denials in the projects suite, unrelated to this surface); `bun run lint` exit 0 across all 7 workspaces. |
| P4 (advisory) | SECUA | `resolveAgentRoles()` | `resolveAgentRoles()` (`apps/cli/src/context.ts:35`) silently drops unknown `roles` keys when handed an unvalidated `AgentConfig` programmatically (it iterates only `DEFAULT_AGENT_ROLES`). The production path is safe: config load validates via the closed-vocabulary superRefine (`packages/config/src/index.ts:439`, verified live: `Unknown role "auditor" — expected one of: scribe, coder, reviewer, planner`), and `createCliContext`'s programmatic `agentConfig` option is a test-only seam. Note only — enforced boundary is config load, per design. |
| P4 (advisory) | SECUA | `DEFAULT_AGENT_ROLES` | R9 parity test reads `DEFAULT_AGENT_ROLES` as text with a formatting-sensitive regex (`plugins/sp/tests/roles.test.ts:310`). Failure direction is loud (size≠4 assertion), so a reformat of the literal breaks the test rather than silently passing — safe, but the regex needs a hand-update on any reformat. Mirrors the pre-existing AGENT_ROLE_NAMES pattern; documented in-file. No action. |
| P4 (advisory) | SECUA | `apps/cli/config/config.example.yaml:52` | gitignored publish-staging copy `apps/cli/config/config.example.yaml:52` still names roles.md as SSOT (stale build output, not in this diff; per docs/design it is `bundle-config` output — never hand-synced). Rebuild before npm publish so shipped comments carry ADR-061. |


**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 constant + closed-vocab schema | MET | `packages/config/src/index.ts:173` `DEFAULT_AGENT_ROLES` (four roles at frozen values; `packages/config/tests/loader.test.ts` shape test); schema `:221` threaded at `:433`; superRefine `:439` rejects unknown keys naming the accepted four (live-verified message) |
| R2 loader rewrite, delete not shim | MET | `apps/cli/src/context.ts:35` `resolveAgentRoles` (per-field merge), call site `context.ts:113`; production threading `apps/cli/src/index.ts:88`; `bundledRolesFile`/`parseAgentRoles`/`loadAgentRoles` deleted — repo grep finds zero references outside docs; no `@transition-shim` added |
| R3 parity gate + projection banner | MET | `plugins/sp/tests/roles.test.ts:310` R9 (roles.md ≡ constant on id/tier/stages + mutation check proving the gate has teeth + banner assertion); banner at `plugins/sp/references/roles.md:41`; pre-existing closure/stage-floor tests intact |
| R4 documentation sync | MET | commented `agent.roles` block `config/config.example.yaml:52`; SSOT comment sync `.spur/config.yaml:37` and `config/config.example.yaml`; ADR-061 `docs/00_ADR.md:642` |
| R5 byte-identical resolution | MET | roles.md fenced block untouched by the diff (byte-identical fixture); R9 parity proves constant ≡ roles.md; live probe resolves scribe=cheap[changelog] · coder=standard[implement,test,wrap] · reviewer=capable-1[verify,review,dogfood] · planner=capable-2[plan,refine,brainstorm] without touching the plugin file |

**SECUA + architecture notes**

- Security: no new input surface beyond the already-validated yaml config; override keys/paths reach only local diagnostics (error message echoes the offending key — fine for local config). Unknown-role and out-of-vocabulary-tier rejection verified live and in `loader.test.ts`.
- Correctness: merge semantics (`override?.tier ?? spec.tier` per field, absent role → default wholesale) unit-tested (`apps/cli/tests/context.test.ts` 0572 block) and live-probed (reviewer→capable-2 override wins, stages keep default).
- Efficiency: resolution is now pure in-memory (one Map copy per CLI boot); the FS walk-up + regex parse + memoization are gone. Strictly cheaper.
- Architecture: both inversions removed — CLI core no longer reads plugin content at runtime, and the plugin no longer tests a CLI runtime dependency (R9 tests its own projection against the code SSOT). Deviations from the task Design (text-read of the constant in the plugin tree; superRefine over z.record instead of enum-keyed record) are real, verified, and documented in Solution with rationale; both are sound.

**Verification evidence (fresh, this review)**

- `bun test packages/config plugins/sp` → **1179 pass, 0 fail**
- `bun test apps/cli` → **746 pass, 0 fail** (original review run, pre-P3-cleanup)
- Post-P3-cleanup re-run: `bun test apps/cli` → **742 pass, 4 fail** — all four are the known sandbox port-binding denials in `spur projects CLI command` (`Failed to listen at 127.0.0.1`), unrelated to the role surface; `bun test apps/cli/tests/context.test.ts apps/cli/tests/commands/agent.test.ts` → **49 pass, 0 fail**
- `bun run lint` (typecheck, all 7 workspaces) → **exit 0** (re-run after the P3 cleanup)
- Live probe: `resolveAgentRoles()` four roles at pre-change tiers/stages; `agent.roles.reviewer.tier: capable-2` override wins; unknown role `auditor` rejected at schema with the exact 0543-R5-shaped message.

**Residual risk**

- Low. Future drift between `DEFAULT_AGENT_ROLES` and roles.md is caught only when `plugins/sp` tests run (they are part of the standard suite/CI). Plugin-internal consumers (`stage-registry-adapter.ts` stage floors) still read roles.md — intentional (plugin owns its projection) and parity-gated.
- The stale gitignored `apps/cli/config/` staging copy (P4 above) must be regenerated before publish — standard build flow, but noted since its comments currently contradict ADR-061.
### References

B3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-16T22:14:57.860Z todo → wip (system)
- 2026-08-16T22:33:44.833Z wip → testing (system)
- 2026-08-16T22:34:02.797Z testing → done (system)
