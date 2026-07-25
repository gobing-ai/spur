---
name: "Design plugin system architecture"
description: "Design and implement a plugin system for extending Spur CLI commands, API routes, agent harnesses, rule evaluators, and UI components — modeled on relaydeck's plugin-first architecture"
status: done
created_at: 2026-06-02T18:00:00Z
updated_at: 2026-06-03T17:08:28.534Z
folder: docs/tasks
type: task
feature-id: "F-5 plugin-system"
priority: medium
dependencies:
  - "0005: Extract packages/app application services layer (creates the service seams plugins attach to)"
  - "Team mode Phase 3 complete (agent specs, task assignment, message queue)"
  - "@gobing-ai/ts-* 0.2.5+ published"
tags: ["architecture", "plugin-system", "extensibility", "deferred", "post-team-mode"]
impl_progress:
  planning: completed
  design: completed
  implementation: pending
  review: pending
  testing: pending
---

## 0006. Design Plugin System Architecture

### Background

relaydeck's architecture is **plugin-first**: the core engine (~3000 LOC) manages agent
lifecycle, the database, and plugin discovery. All capability — CLI commands, API routes,
dashboard UI tiles, agent harness types, model providers, event handlers — lives in 30+
self-contained plugins. The core never statically imports a plugin; plugins import only
public SDK facades. This gives relaydeck:

- **Testability:** Each plugin is independently testable.
- **Extensibility:** Third-party plugins without core changes.
- **Separation of concerns:** Engine, harness, provider, and UI are decoupled.
- **Trust boundary:** Plugin capabilities are declared and gated (bundled > curated > local > untrusted).

Spur currently has no plugin system. Commands are hardcoded in `apps/cli/src/index.ts`.
Agent harnesses are hardcoded in `@gobing-ai/ts-ai-runner`. Rule evaluators are hardcoded
in `@gobing-ai/ts-rule-engine`. There is no mechanism for a third party (or even a Spur
workspace itself) to add a custom harness, a new rule evaluator, a dashboard widget, or
an API endpoint without modifying core source code.

This task designs and implements a plugin system for Spur, adapted from relaydeck's
proven architecture to Spur's TypeScript/Bun monorepo, oRPC API layer, and existing
engine package boundaries.

**Timing:** This task is deferred until after task 0005 (application layer extraction) and
team mode Phase 3 are complete. The application layer extraction creates the service seams
that plugins will register against, making this a natural follow-on.

### Requirements

#### R1 — Plugin Manifest

- **R1.1** — `plugin.yaml` per plugin directory (YAML, not TOML — one config format project-wide;
  ADR-012 Decision 8). Validated by `PluginManifestSchema` (zod):
  ```yaml
  name: my-plugin
  version: 1.0.0
  description: Custom harness for MyAgent CLI
  author: operator
  trust: local            # bundled | curated | local | untrusted
  capabilities:
    commands: [my-agent]                    # CLI subcommand groups to register
    api: [/api/my-agent/health]             # API route prefixes
    ui: [dashboard-tile]                    # Dashboard tiles/lenses
    events: [agent.started, agent.stopped]  # Event subscriptions
    harnesses: [my-agent]                   # Agent harness types
    providers: [my-provider]                # Model provider catalogs
    rules: [my-evaluator]                   # Rule evaluator types
    skills: [my-skill]                      # Skill directories
    workers: [my-worker]                    # Background workers
  allow:
    filesystem: [workspace:read, workspace:write]
    network: [api.myagent.com]
    commands: [my-agent, which]
  ```
- **R1.2** — Manifest is the single source of truth for what a plugin can do, **enforced by
  `PluginManifestSchema` (zod `.strict()`)** — an unknown or malformed key is a validation error,
  not a silent no-op. No capability works without being declared. Every Spur YAML file type
  (`plugin.yaml`, `.spur/agents/*.yaml`, `.spur/workflows/*.yaml`, `.spur/rules/*.yaml`) is validated
  by a declarative zod schema via `schema.safeParse(parseYamlObject(text))`.
- **R1.3** — Plugin entry file is `plugin.ts` (or `plugin.js`), exporting a default class
  implementing `SpurPlugin`.

#### R2 — Plugin Discovery

- **R2.1** — Plugin directories scanned at startup from prioritized paths:
  1. `SPUR_PLUGIN_PATH` env var entries (semicolon-delimited)
  2. `<project>/.spur/plugins/` (workspace-local plugins)
  3. `~/.spur/plugins/` (user-global plugins)
  4. `<spur-install>/plugins/` (bundled plugins, shipped with Spur)
- **R2.2** — Higher-priority paths shadow lower by plugin name.
- **R2.3** — Plugins are validated (manifest parseable, entry module loadable, capabilities
  parseable) before registration. Invalid plugins are logged and skipped, not fatal.
- **R2.4** — Plugin discovery is a lifecycle phase: `discover()` → `validate()` → `load()` →
  `register()`.

#### R3 — Plugin SDK (`@gobing-ai/spur-plugin-sdk`)

- **R3.1** — New package `packages/plugin-sdk/` (or a `plugin` export from `@gobing-ai/spur-app`)
  providing:
  ```typescript
  export interface SpurPlugin {
      readonly name: string;
      readonly version: string;
      onLoad(host: PluginHost): void | Promise<void>;
      onUnload?(host: PluginHost): void | Promise<void>;
  }

  export class PluginHost {
      commands: CommandRegistry;      // register CLI subcommands
      api: ApiRegistry;               // register API route handlers
      ui: UiRegistry;                  // register dashboard tiles/views
      events: EventRegistry;           // register event handlers
      harnesses: HarnessRegistry;      // register agent harness types
      providers: ProviderRegistry;     // register model provider catalogs
      rules: RuleRegistry;             // register rule evaluator types
      skills: SkillRegistry;           // register skill directories
      workers: WorkerRegistry;         // register background workers
      readonly config: PluginConfig;   // per-plugin config merged from YAML
      readonly logger: Logger;         // namespaced logger
  }
  ```
- **R3.2** — Each registry provides typed `register(name, impl)` and `unregister(name)` methods.
  Registries validate types at registration time (e.g., a harness registration must satisfy the
  structural `AgentShim` interface — there is no `BaseHarness` base class; see Solution / ADR-012
  Decision 6).
- **R3.3** — `PluginConfig` merges: default values from the `plugin.yaml` `config:` block → user overrides from
  `.spur/plugins/<name>.yaml` → env vars (`SPUR_PLUGIN_<NAME>_<KEY>`).
- **R3.4** — SDK is a standalone package with zero core dependencies (depends only on
  `@gobing-ai/ts-infra` for `Logger` and `EventBus` types).

#### R4 — Trust Ladder

- **R4.1** — Four trust levels, enforced at capability registration:
  - `bundled` — shipped with Spur, full access, no restrictions.
  - `curated` — signed/verified third-party, filesystem-read + network-allowlist.
  - `local` — workspace-local plugins, filesystem-read + no-network.
  - `untrusted` — sandboxed, no filesystem, no network, no shell, readonly APIs.
- **R4.2** — Trust level from `plugin.yaml` `trust:`; `bundled` is reserved for
  plugins in the Spur install directory.
- **R4.3** — Plugin attempting a capability NOT declared in `plugin.yaml` `capabilities:` → error at
  registration time (not runtime).
- **R4.4** — Plugin attempting an action denied by trust level → error with clear message
  including plugin name, action, and trust level.

#### R5 — Command Registration (CLI Extensibility)

- **R5.1** — Plugins register CLI subcommand groups via `host.commands.register(name, builder)`:
  ```typescript
  host.commands.register('my-agent', (program) => {
      program
          .command('run <prompt>')
          .description('Run MyAgent')
          .action(async (prompt, opts) => { ... });
  });
  ```
- **R5.2** — All plugin-registered commands appear in `spur help` under a `[Plugin Commands]` section.
  Commands from the same plugin are grouped under the plugin name.
- **R5.3** — Command name collisions across plugins → error at registration (first-loaded wins;
  second attempt logs an error).
- **R5.4** — Platform: use the existing arg parser (from `apps/cli/src/args.ts`), NOT a new
  CLI framework (no Commander, no yargs). Plugins register handler functions, not framework
  definitions.

#### R6 — API Route Registration (Server Extensibility)

- **R6.1** — Plugins register API route groups via `host.api.register(prefix, router)`:
  ```typescript
  host.api.register('/api/my-agent', (app) => {
      app.get('/health', (c) => c.json({ ok: true }));
      app.post('/run', async (c) => { ... });
  });
  ```
- **R6.2** — Uses Hono router (matching existing `apps/server` stack). Plugin routes are
  mounted under the plugin's prefix.
- **R6.3** — Route prefix collisions → error at registration.
- **R6.4** — Plugin API routes appear in OpenAPI docs auto-generated by oRPC.

#### R7 — Agent Harness Registration

- **R7.1** — Plugins register agent harness types via `host.harnesses.register(typeName, HarnessClass)`:
  ```typescript
  class MyAgentHarness extends BaseHarness {
      static readonly typeName = 'my-agent';
      buildCommand(spec: AgentSpec): string[];
      // ... override other harness methods as needed
  }
  host.harnesses.register('my-agent', MyAgentHarness);
  ```
- **R7.2** — After registration, `spur agent create --type my-agent` and
  `spur agent run --agent my-agent` work with the new harness.
- **R7.3** — `BaseHarness` defines the contract: `CLI`, `DEFAULT_ARGS`, `buildCommand()`,
  `buildEnv()`, `resolveModel()`. Provided by `@gobing-ai/ts-ai-runner`.
- **R7.4** — `spur agent list --types` shows all registered harness types including
  plugin-contributed ones.

#### R8 — Event System

- **R8.1** — Plugins subscribe to lifecycle events via `host.events.subscribe(pattern, handler)`:
  ```typescript
  host.events.subscribe('agent.*', (event) => {
      logger.info(`Agent event: ${event.type}`, event.data);
  });
  ```
  Supported patterns: `'agent.*'`, `'agent.started'`, `'usage.record'`, `'*'` (all).
- **R8.2** — Standard events (`EventMap`):
  - `agent.started`, `agent.stopped`, `agent.errored`, `agent.status_changed`
  - `message.queued`, `message.injected`, `message.delivered`, `message.failed`
  - `usage.record` (token counts + cost, emitted by harnesses)
  - `workflow.step_started`, `workflow.step_completed`, `workflow.completed`
  - `rule.evaluated`, `rule.violation`
  - `system.startup`, `system.shutdown`
- **R8.3** — Event system uses `@gobing-ai/ts-infra`'s existing `EventBus` with
  pattern-based subscription. Events are in-process only (Phase 5+ may add external
  event sinks).
- **R8.4** — High-churn events (`usage.record`, `agent.output`) are rate-limited to avoid
  overwhelming subscribers.

#### R9 — Skills and Provider Registration

- **R9.1** — Plugins declare skill directories in `plugin.yaml` `capabilities.skills`:
  each entry is a relative path within the plugin directory containing `SKILL.md` files.
- **R9.2** — At agent spawn time, discovered skills are injected via the agent's native
  skill mechanism (pi: `--skill`, claude-code: `--plugin-dir`, etc.).
- **R9.3** — Plugins register model provider catalogs via `host.providers.register(name, catalog)`.
  A catalog is a typed list of `{ id, name, contextWindow, pricing }` records.
- **R9.4** — After registration, `spur preset add <name> --provider <plugin-provider> --model <id>`
  works with the new provider.

#### R10 — Backward Compatibility

- **R10.1** — Existing hardcoded commands (`spur agent`, `spur rule`, `spur workflow`,
  `spur history`, `spur init`, `spur status`, `spur migrate`) continue to work unchanged.
  They are NOT moved to plugins in this task (that's a future migration).
- **R10.2** — If no plugins are installed, `spur help` shows no plugin section and all
  existing behavior is unchanged.
- **R10.3** — Plugin system is opt-in: Spur starts and functions normally with zero plugins.

#### R11 — Tests and Verification

- **R11.1** — Unit tests for `PluginHost` and each registry (command, api, harness, event, etc.).
- **R11.2** — Unit tests for trust ladder enforcement.
- **R11.3** — Integration test: create a minimal test plugin, verify it registers a command,
  verify the command is discoverable and executable.
- **R11.4** — Integration test: verify trust level `untrusted` plugin cannot perform
  denied actions.
- **R11.5** — Integration test: two plugins with colliding command names → second rejected.
- **R11.6** — Coverage target: ≥ 85% line, ≥ 90% function.
- **R11.7** — `bun run check` green; `bun run test-cf` green; `bun run build` green.

### Design

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PluginHost (core runtime)              │
│                                                         │
│  discover() → validate() → load() → register()          │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Command  │ │   API    │ │ Harness  │ │  Provider  │  │
│  │ Registry │ │ Registry │ │ Registry │ │  Registry  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │  Event   │ │   UI     │ │   Rule   │ │   Skill    │  │
│  │ Registry │ │ Registry │ │ Registry │ │  Registry  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│                                                         │
│  TrustEngine — capability gating by trust level          │
│  EventBus   — pub/sub event dispatch (ts-infra)         │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ bundled/     │ │ curated/     │ │ local/       │
│ plugins/     │ │ ~/.spur/     │ │ .spur/       │
│              │ │ plugins/     │ │ plugins/     │
│ (shipped     │ │ (signed      │ │ (workspace-  │
│  with Spur)  │ │  third-party)│ │  local)      │
└──────────────┘ └──────────────┘ └──────────────┘
```

#### Plugin directory layout

```
.spur/plugins/my-plugin/
  plugin.yaml          ← manifest (source of truth; zod-validated)
  plugin.ts            ← entry: export default class MyPlugin implements SpurPlugin
  commands/            ← CLI subcommand handlers
    index.ts
  api/                 ← API route handlers
    routes.ts
  ui/                  ← Dashboard tiles/components
    tile.ts
  skills/              ← Skill markdown files
    my-skill/
      SKILL.md
  workers/             ← Background worker entry points
    my-worker.ts
```

#### Trust Ladder Details

| Level | Filesystem | Network | Shell | API Access |
|-------|-----------|---------|-------|-------------|
| `bundled` | Read/write workspace | Any | Any | Full (all registries) |
| `curated` | Read workspace | Allowlist | Allowlist | Full (all registries) |
| `local` | Read workspace | None | None | Read APIs only, no harness/provider register |
| `untrusted` | None | None | None | Read APIs only, no harness/provider register, sandboxed |

#### Phase 1 Example: Bundled Plugins

After Phase 4, the existing hardcoded functionality can be **migrated** into bundled plugins
(not in this task — this is a future migration):

```
plugins/
  harnesses/           ← agent harness types
    claude-code/
    codex/
    pi/
    gemini/
    opencode/
    cursor/
    antigravity/
  providers/           ← model provider catalogs
    openai/
    anthropic/
    openrouter/
  analytics/           ← analytics/reporting
    history/
  guardrails/          ← rule evaluators
    file-boundary/
    dao-boundary/
```

This migration is NOT part of task 0006 — it's a follow-on task once the plugin system
is stable.

### Plan

#### Phase 1 — Plugin SDK Package

1. Create `packages/plugin-sdk/package.json` with name `@gobing-ai/spur-plugin-sdk`,
   dependencies on `@gobing-ai/ts-infra` (Logger, EventBus types), zero core Spur deps.
2. Create `packages/plugin-sdk/tsconfig.json`.
3. Define `SpurPlugin` interface and `PluginHost` class with typed registries.
4. Define `PluginConfig` type with merge logic.
5. Define `TrustLevel` enum and `TrustEngine`.
6. Write unit tests for PluginHost registration/unregistration, config merging, trust gating.
7. Export only public types from `packages/plugin-sdk/src/index.ts`.

#### Phase 2 — Plugin Discovery and Loading

8. Add `PluginLoader` to `packages/app/` (uses the SDK, not the other way around).
9. Implement `discover(roots: string[]): DiscoveredPlugin[]` — scans directories for
   `plugin.yaml` files.
10. Implement `validate(plugin: DiscoveredPlugin): ValidationResult` — parses manifest,
    validates capabilities, checks trust level constraints.
11. Implement `load(plugin: DiscoveredPlugin): LoadedPlugin` — dynamic import of
    `plugin.ts`, instantiation of default export.
12. Implement lifecycle: `discover()` → `validate()` → `load()` → `register()`.
13. Write integration tests with real temp directories and sample plugins.

#### Phase 3 — Registry Implementations

14. Implement `CommandRegistry`: collects plugin-registered commands, surfaces in help,
    routes to handler on match, enforces collision detection.
15. Implement `ApiRegistry`: collects plugin-registered route groups, mounts on Hono app.
16. Implement `HarnessRegistry`: collects harness type registrations, integrates with
    `ts-ai-runner`'s agent type resolution.
17. Implement `EventRegistry`: wraps `ts-infra` EventBus with pattern-based subscription
    and rate limiting for high-churn events.
18. Implement `ProviderRegistry`, `RuleRegistry`, `SkillRegistry`, `WorkerRegistry` as
    stubs (full implementation in follow-on tasks as plugins need them).
19. Write tests for each registry.

#### Phase 4 — CLI Integration

20. Wire `PluginHost` startup into `apps/cli/src/index.ts` (or a new `apps/cli/src/plugins.ts`).
21. At CLI startup: discover, load, register all plugins before dispatching commands.
22. Plugin-registered commands appear in `spur help`.
23. Graceful error handling: a plugin that fails to load does not crash Spur.
24. `spur plugin list` — new built-in command to list loaded plugins with status.
25. `spur plugin info <name>` — show plugin details (manifest summary, capabilities, trust level).

#### Phase 5 — Server Integration

26. Wire plugin API routes into `apps/server/src/index.ts` Hono app.
27. Plugin-contributed routes appear in OpenAPI docs.
28. Plugin lifecycle hooks: `onServerStart`, `onServerStop`.

#### Phase 6 — Trust Enforcement

29. Implement `TrustEngine.enforce(capability, plugin, trustLevel): void` — throws if denied.
30. Each registry calls `enforce()` before accepting a registration.
31. Integration test: `untrusted` plugin cannot register a harness or provider.
32. Integration test: `untrusted` plugin cannot write files or make network calls.

#### Phase 7 — Verification and Documentation

33. Full integration test: create a bundled test plugin that registers a command,
    an API route, a harness, and event handlers; verify all work end-to-end.
34. Write developer documentation: "Creating a Spur Plugin" guide.
35. `bun run check` green across all workspaces.
36. Add `spur-plugin-sdk` to root `package.json` workspace catalog if shared deps exist.

### Open Design Questions (to resolve during implementation)

1. **Plugin SDK package name:** `@gobing-ai/spur-plugin-sdk` (standalone) vs
   re-export from `@gobing-ai/spur-app` (fewer packages, but creates circular risk)?
   *Recommendation: standalone — SDK should have zero core deps so plugins import nothing heavy.*

2. **Command registration API:** Use the existing simple arg parser or introduce a
   lightweight declarative API? *Recommendation: wrap existing arg parser — no new CLI
   framework, plugins register handler functions directly.*

3. **Plugin loading mechanism:** `import()` dynamic imports (works natively in Bun)
   vs worker threads (sandboxing)? *Recommendation: `import()` for Phase 1-4,
   worker threads for Phase 5+ if sandboxing justified.*

4. **UI plugin registration:** How should plugins register dashboard components in
   `apps/web` (Astro + React)? *Defer — design after the dashboard exists (team mode Phase 5).*

5. **Plugin hot-reload:** Should plugins be reloadable without restarting Spur?
   *Recommendation: Defer — `spur plugin reload` for development, full restart for production.*

6. **Plugin signing/verification for curated tier:** How to verify plugin integrity?
   *Recommendation: Defer — curated tier starts empty, signing mechanism designed when
   first third-party plugin is onboarded.*

### Solution

**Design-only deliverable** (per operator decision: design + defer build). No plugin code ships
from this task. The architecture decision is recorded in **ADR-012**; the build is re-scoped into
Phase-5 slices **0012–0016**; the six open design questions are resolved below.

### Decision summary (see ADR-012)

The relaydeck-style plugin architecture is adopted as Spur's **Phase 5+ extension model**, built as
gated, independently-shippable slices rather than the monolithic 7-phase task. Two task assumptions
were found to be wrong against the real upstream and the doc set, and are corrected here.

### Pre-flight findings that reshaped the task

1. **R7's `BaseHarness` does not exist — but the harness seam is NOT upstream-blocked** (corrected
   after a first mis-reading). The task states `BaseHarness` is "Provided by
   `@gobing-ai/ts-ai-runner`". There is no such class. The runner models agents as a *structural*
   `AgentShim` interface; the `AgentName` union is **compile-time only** — at runtime `AGENT_SHIMS`
   is a plain object, `isAgentName(v)` is `Object.hasOwn(AGENT_SHIMS, v)`, and `getAgentShim(a)` is
   `AGENT_SHIMS[a]`. A plugin harness only needs to supply an object satisfying `AgentShim`, resolved
   through a Spur-side overlay map. → **0015**, buildable with **no upstream gate** (ADR-012
   Decision 6). An optional upstream nicety (export an `AgentShim` guard / inject a shim into
   `AiRunner`) merely removes seam casting.
2. **R4/R11.4 sandboxing conflicts with PRD §5.4** (sandboxing out of scope, Phase 1). Doc-map
   authority: PRD wins. Runtime sandboxing → deferred into **0016**; `untrusted` plugins fail-closed
   (not loaded) until then. The trust ladder still ships as *registration-time policy* in 0012.
3. **Roadmap placement.** `02_ROADMAP.md` puts extension seams in Phase 5+; the task was tagged
   `deferred`. Honored — build slices are queued, not executed now.

### Sub-task breakdown (Phase 5a–5e)

| WBS | Slice | Scope | Gate |
|-----|-------|-------|------|
| 0012 | 5a SDK | `@gobing-ai/spur-plugin-sdk`: `SpurPlugin`, `PluginHost`, 8 registries, `PluginConfig` merge, trust *policy* | ready |
| 0013 | 5b Discovery+CLI | `PluginLoader` (discover→validate→load→register), `spur plugin list\|info`, help integration, non-fatal failures | after 5a |
| 0014 | 5c Server seam | mount plugin Hono routers, OpenAPI, server lifecycle hooks | after 5a/5b |
| 0015 | 5d Harness registry | **blocked** on upstream `BaseHarness`/open-`AgentName` contract | upstream |
| 0016 | 5e Sandboxing | runtime fs/net/shell isolation (worker/process) for curated/untrusted | deferred (PRD §5.4) |

### Open design questions — resolved

1. **SDK package name** → **standalone `@gobing-ai/spur-plugin-sdk`** (not a re-export from
   `spur-app`). Zero core deps (only `ts-infra` for `Logger`/`EventBus`); `packages/app` depends on
   the SDK, never the reverse — prevents a circular `app ↔ sdk` edge and keeps third-party plugins
   importing a light facade. (Confirms the task's recommendation.)
2. **Command registration API** → **wrap the existing `apps/cli/src/args.ts` parser.** No
   Commander/yargs (consistent with ADR-010, ADR-002 "no new tooling"). Plugins register handler
   functions; the host owns dispatch, help grouping (`[Plugin Commands]`), and collision detection
   (first-loaded wins, second logs an error).
3. **Plugin loading mechanism** → **native Bun `import()`** for slices 5a–5c. Worker-thread/process
   isolation is introduced only with 5e (sandboxing), where it is the enforcement vehicle — not
   before. No sandboxing teeth ship without isolation, so `import()` is correct for the trusted
   (`bundled`/`local`) path that ships first.
4. **UI plugin registration** → **deferred until the dashboard exists** (team-mode Phase 5 / roadmap
   Phase 4 inspection surface). `UiRegistry` is a typed stub in 5a; concrete Astro/React tile
   registration is designed when there is a dashboard to register into.
5. **Plugin hot-reload** → **deferred.** `spur plugin reload` is a dev convenience for a later slice;
   production uses full restart. Not in 5a–5c scope.
6. **Curated-tier signing/verification** → **deferred.** The `curated` tier starts empty; the signing
   mechanism is designed when the first third-party plugin is onboarded (alongside 5e sandboxing).

### Event seam note

`ts-infra`'s `EventBus<TEvents extends EventMap>` is **key-typed** (`on`/`emit` over `keyof TEvents`),
not glob-subscribable. R8's patterns (`agent.*`, `*`) therefore live in a thin Spur-side
`EventRegistry` adapter that expands a pattern to concrete event keys and applies rate limiting for
high-churn events (`usage.record`). The adapter — not the bus — owns pattern semantics.

### Backward compatibility (R10) — preserved by construction

The plugin system is opt-in and additive: existing hardcoded commands are untouched, `spur help`
shows no plugin section with zero plugins, and Spur starts/functions normally without any plugins.
Migrating first-party functionality into bundled plugins is explicitly a *future* task, not part of
this design or its slices.


### Review

**Verdict: PASS (design-only deliverable).**

This task was executed as a **design + defer** run (operator decision via `/rd3:dev-run 0006 --verify`,
pre-flight surfaced the conflicts below). No plugin code ships; the deliverable is the architecture
decision and a buildable decomposition.

### What was delivered
- **ADR-012** — plugin system seam model, phased build, sandboxing deferred (authoritative).
- **`02_ROADMAP.md`** — Phase 5+ expanded with slices 5a–5e.
- **`05_FEATURES.md`** — plugin feature marked `💤` with ADR-012 as the design anchor.
- **Sub-tasks 0012–0016** — buildable slices replacing the monolithic 0006 build.
- **0006 Solution** — the six open design questions resolved; upstream blocker documented.

### Why not built now (pre-flight findings)
1. **Roadmap/scope:** plugin system is Phase 5+ ("later"); the task is tagged `deferred`. Phase-4
   (inspection) work is still unstarted.
2. **Hard blocker (R7):** `@gobing-ai/ts-ai-runner` has **no `BaseHarness`** — agents are a closed
   `AgentName` union + `AGENT_SHIMS` record. Harness registration needs an upstream `ts-libs` change
   first (→ task 0015, gated).
3. **Doc conflict (R4/R11.4 vs PRD §5.4):** runtime sandboxing is out of scope per the PRD; the PRD
   wins (lower-number authority). Sandboxing → deferred (task 0016); `untrusted` plugins fail-closed
   until then.

### Traceability (design intent, not code)
- R1 manifest, R2 discovery, R3 SDK, R5 commands, R6 api, R8 events, R9 skills/providers, R10 back-compat
  → **designed**, allocated to slices 5a–5c (tasks 0012–0014).
- R4 trust ladder → split: *policy* gating in 5a (0012), *runtime enforcement* deferred to 5e (0016).
- R7 harness → **blocked upstream**, allocated to 5d (0015).
- R11 tests/coverage → carried into each slice's own gate.

### Gate
No code → no `lint/test/build` delta to assert. Docs (ADR-012, ROADMAP, FEATURES) edited and
internally consistent. `bun run lint` remains green (verified: no source changed). Design is complete
and self-consistent; the build is queued, not done.


### References

- `vendors/relaydeck/relaydeck/plugin.py` — relaydeck PluginRegistry, PluginEventBus, trust ladder (~2065 LOC)
- `vendors/relaydeck/relaydeck/sdk.py` — relaydeck public SDK facade (~1400 LOC)
- `vendors/relaydeck/AGENTS.md` — relaydeck plugin architecture documentation
- `docs/analysis/relaydeck-vs-spur-analysis.md` — Section 5.1: Plugin-First Architecture
- `docs/design/spur-team-mode-design.md` — Team mode design (Phase 5 mentions plugin dashboard registration)
- `docs/00_ADR.md` — ADR-001 (re-foundation), ADR-006 (external engine packages)
- `docs/03_ARCHITECTURE.md` — Module boundaries
- `docs/tasks/0005_Extract_packages_app_application_services_layer.md` — Prerequisite task
- `~/xprojects/ts-libs/packages/infra/src/event-bus/event-bus.ts` — Existing EventBus implementation (~230 LOC)
- `~/xprojects/ts-libs/packages/infra/src/event-bus/types.ts` — EventMap, SubscribeOptions types
