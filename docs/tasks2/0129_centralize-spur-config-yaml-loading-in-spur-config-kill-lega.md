---
template: feature-impl
schema_version: 1
name: Centralize .spur/config.yaml loading in spur-config; kill legacy docs/.tasks/config.jsonc
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: 2026-06-26T18:31:39.063Z
updated_at: 2026-06-26T22:43:44.957Z
---

## 0129. Centralize .spur/config.yaml loading in spur-config; kill legacy docs/.tasks/config.jsonc

### Background
`@gobing-ai/spur-config` (`packages/config`) was created to be the single, centralized
configuration surface for the Spur CLI — one schema, one loader for `.spur/config.yaml`.
That intent never fully landed: `packages/config` ships **schemas + bundled-template
helpers only**, never a loading function. As a result every consumer rolled its own
loader, and the project now has **five parallel mechanisms** for reading the same file,
plus one genuine legacy regression.

**Confirmed sprawl (all read the same `.spur/config.yaml`, differently):**

| Surface | Mechanism | Location |
|---|---|---|
| CLI `task` | `loadSpurConfig` (embedded-JSON-schema + ts-runtime `loadStructuredConfig`) → `spurConfigSchema.parse` | `apps/cli/src/commands/task.ts:460-464`, `apps/cli/src/config/loader.ts` |
| CLI `feature` + `team-service` | `resolvePlanningFolders` (raw `yaml` parse + zod) | `packages/app/src/config/planning-folders.ts` |
| CLI resolution | `resolveConfigFile` (project→global fallback) — defined, barely wired | `apps/cli/src/config/resolver.ts` |
| Server context | inline string literals, no loading at all | `apps/server/src/context.ts:23-29` |
| Server `task.folders` | reads **`docs/.tasks/config.jsonc`** (JSONC strip + `JSON.parse`) | `apps/server/src/modules/task/handlers.ts:110` |

**The legacy regression (the "stupid thing"):** `apps/server/src/modules/task/handlers.ts:110`
reads `docs/.tasks/config.jsonc` — the **old `rd3:tasks` config location**, abandoned by the
rest of the system. The contract DTO comment at `packages/contracts/src/task.ts:120` even
documents it as canonical, cementing the wrong source of truth.

**Two competing schemas for one file:**
- `apps/cli/src/config/schema.ts` — `SpurAppConfigSchema` (`agent`/`rules`/`workflows`/`redaction`), the *app section*.
- `packages/config/src/index.ts` — `spurConfigSchema` (`tasks`/`features`), the *planning section*.

Same YAML, two packages, two loaders, no unified `loadSpurConfig(cwd) → SpurConfig`.

**Root cause:** `packages/config` lacks a loader. The Workers-bundle constraint (importing
`spur-config` into the miniflare bundle crashes on load) pushed the server to fork further
into inline literals + the legacy JSONC path, widening the divergence instead of fixing it.

**Decisions for this task (operator-confirmed 2026-06-26):**
1. **CF-safe split** — `packages/config` splits into a dependency-free **core** (schemas,
   `DEFAULT_*`, types — safe on Workers) and a separate **`./loader`** subpath that pulls in
   `yaml` + `node:fs`. Server imports only the core; CLI/app import `@gobing-ai/spur-config/loader`.
2. **Full scope** — unify all five call sites onto the new facade, delete the
   `docs/.tasks/config.jsonc` read, add an ADR entry, and add a `spur rule` banning ad-hoc
   config loading outside `spur-config`.

**Sequencing constraint:** get `packages/config` (core + loader) ready and tested **first**,
then migrate consumers onto it. No consumer migration before the facade is green.
### Acceptance Criteria
```gherkin
Feature: Centralized .spur/config.yaml loading owned by @gobing-ai/spur-config

  Scenario: Single loader returns a fully-typed merged config
    Given a .spur/config.yaml with tasks, features, agent, rules, and workflows sections
    When any surface calls loadSpurConfig from @gobing-ai/spur-config/loader
    Then it receives one validated SpurConfig covering all sections
    And no surface parses the YAML or builds its own schema independently

  Scenario: Workers bundle stays config-dependency-free
    Given the server is bundled for the Cloudflare Workers runtime
    When the bundle imports DEFAULT_TASKS_DIR / DEFAULT_FEATURES_DIR from @gobing-ai/spur-config
    Then miniflare loads without crashing
    And neither yaml nor node:fs is pulled into the worker bundle

  Scenario: Legacy rd3:tasks config location is gone
    Given the server task.folders endpoint
    When it resolves task folders
    Then it reads from .spur/config.yaml via the config facade
    And no code path references docs/.tasks/config.jsonc

  Scenario: Recurrence is blocked by a guardrail rule
    Given a new ad-hoc config loader is added outside packages/config
    When spur rule run executes the constraint catalog
    Then a rule flags the direct loadStructuredConfig / parseYaml on config.yaml as an error
```

- [ ] `@gobing-ai/spur-config` exposes a dependency-free core entry (schemas, `DEFAULT_TASKS_DIR`, `DEFAULT_FEATURES_DIR`, all config types) importable on the Workers path
- [ ] `@gobing-ai/spur-config/loader` exposes a single `loadSpurConfig(cwd)` (and folder-resolution helper) that returns one merged, validated `SpurConfig`
- [ ] The app-section schema (`agent`/`rules`/`workflows`/`redaction`) and planning-section schema (`tasks`/`features`) are unified into one `SpurConfig` schema in `packages/config`
- [ ] All five call sites migrate onto the facade: `cli/task`, `cli/feature`, `app/planning-folders`, `app/team-service`, `server/context` + `server/task.folders`
- [ ] `apps/cli/src/config/{loader,resolver,schema}.ts` and `packages/app/src/config/planning-folders.ts` are removed or reduced to thin re-exports of the facade (no duplicate loading logic remains)
- [ ] The `docs/.tasks/config.jsonc` read is deleted; `packages/contracts/src/task.ts:120` comment corrected to reference `.spur/config.yaml`
- [ ] ADR entry added: config loading is `spur-config`-owned (single loader, core/loader split rationale, server CF exception scoped to the *core import only*)
- [ ] New `spur rule` (config/rules/boundary) bans `loadStructuredConfig`/`parseYaml`/JSONC-read of a config file outside `packages/config`
- [ ] `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` all green
- [ ] Per-file coverage ≥ 90% on the new `packages/config` loader
### Design
**Target shape — one package, two entry points (operator-confirmed: pure-core + node-loader subpath).**

```
@gobing-ai/spur-config            (core — ZERO runtime deps beyond zod)
  ├─ schemas: spurConfigSchema (merged: tasks + features + agent + rules + workflows + redaction)
  ├─ constants: DEFAULT_TASKS_DIR, DEFAULT_FEATURES_DIR, SPUR_ENV_VARS, SPUR_LOG_LEVELS
  ├─ types: SpurConfig, TasksConfig, FeaturesConfig, AgentConfig, FolderConfig, …
  └─ bundled-config / template-renderer (unchanged)

@gobing-ai/spur-config/loader     (node-only — imports yaml + node:fs / FileSystem port)
  ├─ loadSpurConfig(cwd, opts?): Promise<SpurConfig>      ← THE single loader
  ├─ resolveConfigFile(cwd): project→global fallback      ← moved from cli/config/resolver.ts
  ├─ resolvePlanningFolders(fs): PlanningFolders          ← moved from app/config/planning-folders.ts
  └─ embedded-schema resolution for `bun --compile`        ← moved from cli/config/loader.ts
```

**Why the split (the hard constraint that caused the divergence):** importing `@gobing-ai/spur-config`
into the Cloudflare Workers bundle crashes miniflare on load (`yaml`/`node:fs` reach into Node
internals). The core entry has zero such deps, so `server/context.ts` can import `DEFAULT_*` from
the core and stay CF-safe; only Node surfaces (CLI, app-on-Bun) import `/loader`. This replaces the
current "inline the literals + document an exception" hack with a real boundary.

**Schema unification.** Merge `SpurAppConfigSchema` (apps/cli/src/config/schema.ts:
`agent`/`rules`/`workflows`/`redaction`) and `spurConfigSchema` (packages/config/src/index.ts:
`tasks`/`features`) into one `spurConfigSchema` in `packages/config`. All fields optional →
missing key means "use default", preserving partial-config tolerance. Keep YAML keys verbatim
(R3 — no drift from the existing `.spur/config.yaml`).

**`loadSpurConfig` design.** One async function, FileSystem-port-friendly so it works on both Bun
(node FS) and any injected port; folds in the embedded-schema resolution currently in
`cli/config/loader.ts` so the `bun --compile` binary still validates. Default: validate in prod,
skip schema-validation in `NODE_ENV=test` (preserve existing behavior). `resolvePlanningFolders`
becomes a thin derivation over `loadSpurConfig` (it stops re-parsing YAML itself).

**Server migration.**
- `context.ts` — keep importing the `DEFAULT_*` constants, but **from the core entry**, deleting
  the `CF_DEFAULT_*` inline copies. The boundary-rule exception for this file narrows to "core
  import only" rather than "hardcoded literals".
- `task.folders` handler — replace the `docs/.tasks/config.jsonc` read with folder resolution
  sourced from `.spur/config.yaml`. On Workers (no FS), fall back to the schema-default folders
  from the core entry — NOT a hardcoded string. Delete the JSONC strip/parse.

**Boundary rule (recurrence guard).** New `config/rules/boundary/config-loading-ownership.yaml`:
flag `loadStructuredConfig(`, top-level `parse(`/`parseYaml(` against a `config.yaml`/`config.jsonc`
path, and any `config.jsonc` reference, outside `packages/config/**`. Mirror the dialect/structure
of the existing `planning-folder-hardcode.yaml`. Exclude `packages/config/**` and tests.

**ADR.** Add `ADR-027` (next free; ADR-026 is the latest): "Config loading is `spur-config`-owned —
single `loadSpurConfig`, core/loader package split for CF-safety, legacy `docs/.tasks/config.jsonc`
retired." Reference ADR-015 (config is Spur-owned at repo-root `./config`) and ADR-017
(bootstrap standardized) as the decisions this completes. Cross-link `04_DESIGN.md §9`
(config keys) and `03_ARCHITECTURE.md` (module boundary) in the same commit.

**Open design point to resolve during implementation:** whether `loadSpurConfig` returns the
*raw merged config* or also performs folder derivation. Recommendation: keep `loadSpurConfig`
pure (returns validated `SpurConfig`); `resolvePlanningFolders` stays a separate derivation in
the loader subpath that calls it. Single responsibility; the server can derive folders without
pulling planning semantics into the core.
### Plan
**Phase A — Get `packages/config` ready FIRST (no consumer touched until this is green):**

- [ ] A1. Merge `SpurAppConfigSchema` (agent/rules/workflows/redaction) into `spurConfigSchema` in `packages/config/src`; keep all fields optional + YAML keys verbatim
- [ ] A2. Add `package.json` `exports` map: `.` → core (zero node/yaml deps), `./loader` → node loader subpath; verify the core import graph pulls neither `yaml` nor `node:fs`
- [ ] A3. Move embedded-schema resolution from `apps/cli/src/config/loader.ts` into `@gobing-ai/spur-config/loader`; implement `loadSpurConfig(cwd, opts?)` returning merged validated `SpurConfig`
- [ ] A4. Move `resolveConfigFile` (project→global fallback) from `apps/cli/src/config/resolver.ts` into the loader subpath
- [ ] A5. Move `resolvePlanningFolders` from `packages/app/src/config/planning-folders.ts` into the loader subpath, rewritten to derive over `loadSpurConfig` (stop re-parsing YAML)
- [ ] A6. Unit tests for the facade: merged-schema parse, defaults on missing keys, core-entry CF-safety (no yaml/fs in core import), loader behavior in test vs prod mode, embedded-schema path. ≥90% per-file coverage
- [ ] A7. Gate checkpoint: `bun run lint` + `bun run test` green for `packages/config` before proceeding

**Phase B — Migrate consumers onto the facade:**

- [ ] B1. `apps/cli/src/commands/task.ts` — replace `loadSpurConfig` (local) + `spurConfigSchema.parse` + `loadTaskFoldersConfig` with the facade loader/folder helper
- [ ] B2. `apps/cli/src/commands/feature.ts` + `packages/app/src/services/team-service.ts` — import `resolvePlanningFolders` from the facade
- [ ] B3. Delete `apps/cli/src/config/{loader,resolver,schema}.ts` and `packages/app/src/config/planning-folders.ts` (or reduce to thin re-exports if any external import path must survive); update all imports
- [ ] B4. `apps/server/src/context.ts` — import `DEFAULT_*` from the **core** entry; delete `CF_DEFAULT_*` inline literals
- [ ] B5. `apps/server/src/modules/task/handlers.ts` — replace the `docs/.tasks/config.jsonc` read with `.spur/config.yaml` folder resolution; CF fallback uses core-entry schema defaults, not a string literal. Delete JSONC strip/parse
- [ ] B6. Fix `packages/contracts/src/task.ts:120` DTO comment to reference `.spur/config.yaml`

**Phase C — Guardrails + docs:**

- [ ] C1. Add `config/rules/boundary/config-loading-ownership.yaml`; verify it flags an intentional ad-hoc loader and passes the migrated tree (`spur rule run`)
- [ ] C2. Update `config/rules/boundary/planning-folder-hardcode.yaml` exclusions: narrow the `server/context.ts` and `server/handlers.ts` exceptions now that they no longer hardcode / read legacy JSONC
- [ ] C3. Add `ADR-027` to `docs/00_ADR.md`; sync `04_DESIGN.md §9` (config keys/loader) + `03_ARCHITECTURE.md` (module boundary) in the same commit
- [ ] C4. Full gate: `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build`; `git status` shows only intentional changes

**Phase D — Verify the dogfood fix:**

- [ ] D1. Confirm a task created via `spur task create` lands in the configured active folder (this very task surfaced the phase-folder bug by landing in `docs/tasks2`) and is visible to server/web/team-service through the unified loader
### Solution

### Testing

### Review

### References
**Code — the five loading surfaces:**
- `packages/config/src/index.ts` — current schemas + constants (no loader); the facade target
- `apps/cli/src/config/loader.ts` — embedded-schema `loadSpurConfig` (to move into facade)
- `apps/cli/src/config/resolver.ts` — project→global `resolveConfigFile` (to move)
- `apps/cli/src/config/schema.ts` — `SpurAppConfigSchema` app section (to merge)
- `packages/app/src/config/planning-folders.ts` — `resolvePlanningFolders` raw-yaml loader (to move + rewrite)
- `apps/cli/src/commands/task.ts:445-470,592-600` — `loadTaskFoldersConfig` + matrix loads
- `apps/cli/src/commands/feature.ts:179,203,260-261` — `resolvePlanningFolders` callers
- `packages/app/src/services/team-service.ts:294-295` — `resolvePlanningFolders` caller
- `apps/server/src/context.ts:19-29` — inline `CF_DEFAULT_*` literals + documented exception
- `apps/server/src/modules/task/handlers.ts:109-127` — **legacy `docs/.tasks/config.jsonc` read**
- `packages/contracts/src/task.ts:120` — DTO comment citing the legacy path (to correct)

**Guardrails:**
- `config/rules/boundary/planning-folder-hardcode.yaml` — sibling rule; structure/dialect template for the new config-loading rule
- `config/rules/boundary/dao-boundary.yaml` — second boundary-rule example

**Docs:**
- `docs/00_ADR.md` — ADR-015 (config Spur-owned at `./config`), ADR-017 (bootstrap on ts-infra), ADR-019 (server runtime split). ADR-026 is the latest → new entry is ADR-027
- `docs/04_DESIGN.md §9` — config keys/schema surface (sync target)
- `docs/03_ARCHITECTURE.md` — module boundaries (sync target)

**Constraints:**
- Workers bundle MUST NOT import `yaml`/`node:fs` (miniflare crash) → drives the core/loader split
- `bun --compile` standalone binary has no `node_modules` for runtime schema resolution → embedded-schema path must survive the move into the facade
### History
- 2026-06-26T18:51:10.517Z backlog → wip (system)
- 2026-06-26T18:52:35.754Z wip → backlog (system)
- 2026-06-26T22:43:33.099Z backlog → todo (system)
- 2026-06-26T22:43:39.369Z todo → testing (system)
- 2026-06-26T22:43:44.957Z testing → done (system)
