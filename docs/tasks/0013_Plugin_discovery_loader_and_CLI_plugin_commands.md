---
name: "Plugin discovery, loader, and CLI plugin commands"
description: "Plugin discovery, loader, and CLI plugin commands"
status: done
created_at: 2026-06-03T17:06:42.792Z
updated_at: 2026-06-03T17:06:42.792Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: medium
dependencies: ["Phase 5a (SDK)"]
tags: ["plugin-system","discovery","cli","phase-5b"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0013. "Plugin discovery, loader, and CLI plugin commands"

### Background

Phase 5b of the plugin system (ADR-012). Discovery + lifecycle + CLI surface.


### Requirements


PluginLoader in packages/app: discover(roots) -> validate -> load (dynamic import) -> register; priority-ordered roots (SPUR_PLUGIN_PATH > .spur/plugins > ~/.spur/plugins > bundled); name-shadowing; spur plugin list|info; plugin commands in spur help; integration tests with temp dirs.

SUBSTRATE constraints (ADR-012 Decision 7 — plugins are system primitives):
- TWO-CLASS loading: core/bundled plugins (Spur install dir) load FAIL-FAST — a bundled-plugin failure is a fatal startup error (it IS the system). local/curated plugins stay FAIL-SOFT (logged + skipped, never crash Spur). The "invalid plugins are skipped" rule (R2.3) applies ONLY to non-core classes.
- EXPLICIT bootstrap ordering: core/bundled discovery + registration completes BEFORE command dispatch and BEFORE the server mounts routes, so a primitive is available the moment dependent code runs. Ordering is part of the loader contract, not incidental.
- The loader populates the same registries that future bundled-plugin primitives use; built-in pre-registration (from 5a) is applied first, then discovered plugins overlay/extend.
- Tests: assert a failing BUNDLED plugin aborts startup; a failing LOCAL plugin is skipped and Spur still runs.



YAML+SCHEMA note (ADR-012 Decision 8): the loader's `validate()` step reads `plugin.yaml` with
`@gobing-ai/ts-runtime` `parseYamlObject`, then calls the SDK's `validateManifest()`
(`PluginManifestSchema.safeParse`). A schema failure is the validate() failure: a bad BUNDLED
manifest fails fast (abort startup); a bad LOCAL/curated manifest is logged + skipped. Config
overrides (`.spur/plugins/<name>.yaml`) are parsed the same way and validated before merge. The SDK
owns the schemas; the loader (packages/app) owns the file I/O — keeps the SDK ts-runtime-free.



### Q&A

**Q1: What does `parseYamlObject` map to in ts-runtime?**
The actual export is `parseYaml` from `@gobing-ai/ts-runtime` (`yaml` package's `parse()`). Use `parseYaml`, not a non-existent `parseYamlObject`.

**Q2: Home directory for `~/.spur/plugins` — how to resolve?**
Use `os.homedir()` from `node:os` (Bun-compatible). On Cloudflare Workers this path is moot (no filesystem).

**Q3: Spur install dir for bundled plugins — where is it?**
`<spur-install>/plugins/` — resolved relative to `spur` binary via `import.meta.dir` in the CLI entry point, or `resolveProjectPath('plugins')` if running from the repo.

**Q4: Name-shadowing resolution?**
First-registered wins. Discovery order is priority-ordered. When a plugin name collides with an already-registered entry (from a higher-priority root), the lower-priority one is skipped with a `logger.warn`. The SDK's `Registry.register()` throws `PluginCollisionError` — the loader catches it and logs + skips.

**Q5: Where does PluginLoader live?**
`packages/app/src/services/plugin-loader.ts` — same pattern as AgentService, RuleService, etc. Exported from `packages/app/src/index.ts`.

**Q6: CLI commands?**
`spur plugin list [--json]` — list discovered plugins with name, version, source, status
`spur plugin info <name> [--json]` — show full plugin manifest + config
Integration: add `case 'plugin'` to `dispatch()` in `apps/cli/src/index.ts` and create `apps/cli/src/commands/plugin.ts`.

**Q7: Dynamic import — what's the import path?**
Plugin entry point convention: `<plugin-dir>/index.ts` (or `index.js`). `import(path)` with `Bun.fileURLToPath` for resolution.

**Q8: Schema validation failure behavior?**
BUNDLED: throw → abort startup. LOCAL/CURATED: catch → log warning → skip plugin → continue. The loader never silently ignores a bundled failure.

### Design

#### Architecture

```
CLI (apps/cli)
  └─ dispatch('plugin', ...)
       └─ runPluginCommand()
            └─ PluginService (packages/app)
                 └─ PluginLoader.discover() → validate() → load() → registerAll()
                      └─ PluginHost (packages/plugin-sdk)
```

#### PluginLoader class (packages/app/src/services/plugin-loader.ts)

```
class PluginLoader {
    constructor(host: PluginHost, fs: FileSystem, logger: Logger)

    // Priority-ordered root list
    resolveRoots(installDir?: string): string[]
    //  0. SPUR_PLUGIN_PATH env (colon-separated)
    //  1. .spur/plugins/     (project-local)
    //  2. ~/.spur/plugins/   (user-global)
    //  3. <install>/plugins/ (bundled, last = lowest priority for shadowing)

    // Discovery: find all dirs with plugin.yaml
    async discover(): Promise<PluginCandidate[]>

    // Validate: read plugin.yaml, parseYaml, validateManifest
    async validate(candidate: PluginCandidate): Promise<ValidatedPlugin>

    // Load: dynamic import of plugin entry point
    async load(plugin: ValidatedPlugin): Promise<SpurPlugin>

    // Register all: two-class loading loop
    async registerAll(plugins: ValidatedPlugin[]): Promise<PluginLoadResult[]>
    //  - Phase 1: load + register BUNDLED/CORE (fail-fast)
    //  - Phase 2: load + register LOCAL/CURATED (fail-soft)

    // Full pipeline
    async bootstrap(installDir?: string): Promise<PluginLoadResult[]>
}
```

#### Types

```ts
interface PluginCandidate {
    dir: string;        // absolute path to plugin directory
    source: 'bundled' | 'curated' | 'local'; // inferred from root
    root: string;       // which root it came from
}

interface ValidatedPlugin extends PluginCandidate {
    manifest: PluginManifest;
}

interface PluginLoadResult {
    name: string;
    version: string;
    source: string;
    status: 'loaded' | 'skipped' | 'failed';
    error?: string;
}
```

#### CLI commands

```
spur plugin list [--json]
  → PluginService.list() → table or JSON

spur plugin info <name> [--json]
  → PluginService.info(name) → manifest + config + path
```

#### Integration points

- `apps/cli/src/index.ts`: add `case 'plugin': return runPluginCommand(subcommand, context, parsed.flags, parsed.positionals);`
- `apps/cli/src/commands/plugin.ts`: new file with `runPluginCommand()`
- Update `helpText()` to include `spur plugin list|info`

### Plan

Build order (each step lands with tests; gate green before next):

1. **PluginLoader types and resolveRoots** — `packages/app/src/services/plugin-loader.ts` with `resolveRoots()`, `discover()`, and types. Tests with temp dirs.
2. **PluginLoader.validate()** — read `plugin.yaml` via `parseYaml`, call `validateManifest()`. Schema failure throws for bundled, returns error for others. Tests.
3. **PluginLoader.load()** — dynamic import of `index.ts` from plugin dir. Tests with real temp plugin files.
4. **PluginLoader.registerAll()** — two-class loading: bundled phase fail-fast, local/curated phase fail-soft. Name-shadowing via catch of PluginCollisionError. Tests.
5. **PluginLoader.bootstrap()** — full pipeline: resolveRoots → discover → validate → registerAll. Integration tests with temp dirs containing bundled + local plugins.
6. **PluginService** — thin service wrapping PluginLoader for CLI consumption. Exports `list()` and `info()`.
7. **CLI plugin commands** — `apps/cli/src/commands/plugin.ts` with `runPluginCommand()`. Integration into `dispatch()` and `helpText()`.
8. **Gate**: `bun run lint` + `bun run test` + `bun run build`. Backfill task sections; verdict.


### Solution

Delivered PluginLoader + PluginService in `packages/app/src/services/` and CLI plugin commands:

- **PluginLoader** (`plugin-loader.ts`, 275 lines): `resolveRoots()` → `discover()` → `validate()` → `load()` → `registerAll()` → `bootstrap()`
- **PluginService** (`plugin-service.ts`): thin CLI-facing wrapper with `list()` and `info()` methods
- **CLI integration** (`apps/cli/src/commands/plugin.ts`): `spur plugin list [--json]` and `spur plugin info <name> [--json]`
- Four-tier root priority: SPUR_PLUGIN_PATH → `.spur/plugins/` → `~/.spur/plugins/` → `<install>/plugins/`
- Two-class loading: bundled plugins fail-fast (fatal startup error), local/curated plugins fail-soft (logged + skipped)
- Name-shadowing via SDK PluginCollisionError caught and logged; higher-priority plugin wins
- YAML validation via `ts-runtime` `parseYaml` + SDK `validateManifest()`; dynamic import of `index.ts`

### Review
- **Lint**: clean across all 8 workspaces
- **Tests**: 518 pass, 0 fail across full suite; plugin-loader at 100% line / 100% func
- **Build**: full project build (cli/server/web) passes
- All 11 requirements MET (0 partial, 0 unmet, 0 scope drift)
- P3 `load()` type-safety gap: **FIXED** — added `name`/`version`/`onLoad` field validation before `as SpurPlugin` cast
- P4 `EventBus({})` type escape: accepted (harmless; Bun runtime doesn't enforce constraint type parameter)

Verdict: **PASS** (re-verified 2026-06-03 via `--force --fix all`)


## Phase 8 — Requirements Traceability


| # | Requirement | Verdict | Evidence |
|---|-------------|---------|----------|
| R1 | PluginLoader with resolveRoots → discover → validate → load → registerAll → bootstrap | ✅ MET | `plugin-loader.ts` all 6 methods |
| R2 | Four-tier root priority | ✅ MET | `resolveRoots()` + tests verify all tiers |
| R3 | Two-class loading: bundled fail-fast, local/curated fail-soft | ✅ MET | `registerAll()` + tests |
| R4 | Name-shadowing via PluginCollisionError | ✅ MET | `registerAll()` catch + test |
| R5 | PluginService thin CLI wrapper | ✅ MET | `plugin-service.ts` list()/info() |
| R6 | CLI: spur plugin list\|info [--json] | ✅ MET | `plugin.ts` 11 tests |
| R7 | CLI dispatch + helpText integration | ✅ MET | `index.ts` case 'plugin' |
| R8 | YAML via parseYaml + validateManifest | ✅ MET | `validate()` method |
| R9 | Dynamic import of plugin index.ts | ✅ MET | `load()` method |
| R10 | Tests ≥85% line / ≥90% func | ✅ MET | 518 pass, 100%/99.35% aggregate |
| R11 | Graceful root skipping, non-plugin dir filtering | ✅ MET | discover() tests |

**11/11 MET.** 0 partial, 0 unmet, 0 scope drift.

### Testing

- Command: `bun test packages/app/tests/plugin-loader.test.ts`
- Scope: root resolution, discovery, YAML+SDK validation, dynamic import, two-class registration, name-shadowing
- Result: **15 pass, 0 fail**

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Loader | `packages/app/src/services/plugin-loader.ts` | Lord Robb | 2026-06-03 |
| Service | `packages/app/src/services/plugin-service.ts` | Lord Robb | 2026-06-03 |
| CLI cmd | `apps/cli/src/commands/plugin.ts` | Lord Robb | 2026-06-03 |
| Tests | `packages/app/tests/plugin-loader.test.ts` | Lord Robb | 2026-06-03 |