# @gobing-ai/spur-plugin-sdk

Spur Plugin SDK — types, schemas, and runtime for building Spur plugins with trust levels, capability registries, and event hooks.

## Architecture

```mermaid
classDiagram
    direction TB

    class SpurPlugin {
        <<interface>>
        +name: string
        +version: string
        +trust: TrustLevel
        +onLoad(host: PluginHost)
        +onUnload?(host: PluginHost)
        +onServerStart?(host: PluginHost)
        +onServerStop?(host: PluginHost)
    }

    class PluginHost {
        +commands: CommandRegistry
        +api: ApiRegistry
        +ui: UiRegistry
        +events: EventRegistry
        +harnesses: HarnessRegistry
        +providers: ProviderRegistry
        +rules: RuleRegistry
        +skills: SkillRegistry
        +workers: WorkerRegistry
        +eventRegistry: EventRegistry
        +logger: Logger
        +trust: TrustEngine
        +loadPlugin(plugin, ctx, overrides?, env?) Promise~Config~
        +unloadPlugin(name) Promise~void~
        +isLoaded(name) boolean
        +startServerHooks() Promise~void~
        +stopServerHooks() Promise~void~
    }

    class TrustEngine {
        +check(manifest, capability, name, ctx) void
        +enforce(capability, level, ctx) void
        +declares(manifest, capability, name) boolean
    }

    class TrustLevel {
        <<enumeration>>
        bundled
        curated
        local
        untrusted
    }

    class Capability {
        <<type>>
        commands | api | ui | events
        harnesses | providers | rules
        skills | workers
    }

    class EventRegistry {
        +subscribe(pattern, handler) void
        +unsubscribe(pattern) void
        +unsubscribeAll() void
    }

    class PluginManifest {
        +name: string
        +version: string
        +trust: TrustLevel
        +capabilities: CapabilitiesManifest
        +config?: Record~string,unknown~
    }

    class RegistrationContext {
        +source: PluginSource
        +pluginName: string
        +trustLevel: TrustLevel
    }

    class PluginManifestError~Zod~ {
        +issues: ZodIssue[]
    }
    class PluginCollisionError
    class PluginTrustError
    class PluginNotDeclaredError

    SpurPlugin --> PluginHost : onLoad(host)
    PluginHost *-- TrustEngine
    PluginHost *-- EventRegistry
    PluginHost *-- "9" Registry : typed registries
    PluginHost --> RegistrationContext
    TrustEngine --> TrustLevel
    TrustEngine --> Capability
    TrustEngine ..> PluginTrustError : throws
    TrustEngine ..> PluginNotDeclaredError : throws
    PluginHost ..> PluginManifest : validates via
    PluginManifestError --|> Error
    PluginCollisionError --|> Error
    PluginTrustError --|> Error
    PluginNotDeclaredError --|> Error
```

## Quick Start

### Installation

```bash
bun add @gobing-ai/spur-plugin-sdk
```

### 1. Define a plugin

Plugins implement the `SpurPlugin` interface. The entry point is `onLoad(host)`, which receives a `PluginHost` providing access to all capability registries.

```typescript
import type { SpurPlugin, PluginHost } from '@gobing-ai/spur-plugin-sdk';

export const myPlugin: SpurPlugin = {
    name: 'my-plugin',
    version: '1.0.0',
    trust: 'local',

    onLoad(host: PluginHost) {
        // Register a slash command
        host.commands.register({ name: 'my-cmd' }, {
            name: 'my-cmd',
            execute(args: string[]) {
                host.logger.info(`my-cmd called with: ${args}`);
            },
        });

        // Subscribe to agent lifecycle events
        host.eventRegistry.subscribe('agent.*', (event, detail) => {
            host.logger.info(`Agent event: ${event}`, detail);
        });
    },

    onUnload(host: PluginHost) {
        host.eventRegistry.unsubscribeAll();
    },
};
```

### 2. Write the manifest

Every plugin needs a `plugin.yaml` declaring its trust level and capabilities:

```yaml
# plugin.yaml
name: my-plugin
version: 1.0.0
description: Example Spur plugin
author: your-name
trust: local
capabilities:
  commands:
    - my-cmd
  events:
    - agent.run.start
    - agent.run.complete
config:
  greeting: hello
```

Validate the manifest programmatically:

```typescript
import { validateManifest, PluginManifestError } from '@gobing-ai/spur-plugin-sdk';

try {
    const manifest = validateManifest(parsedYaml);
    // Use manifest as a typed PluginManifest
} catch (err) {
    if (err instanceof PluginManifestError) {
        console.error('Invalid manifest:', err.issues);
    }
}
```

### 3. Configuration merging

Plugin configuration merges three layers (lowest to highest precedence):

1. `plugin.yaml` `config:` defaults
2. `.spur/plugins/<name>.yaml` file overrides
3. `SPUR_PLUGIN_<NAME>_<KEY>` environment variables

```typescript
import { mergePluginConfig } from '@gobing-ai/spur-plugin-sdk';

const config = mergePluginConfig(
    { greeting: 'hello', timeout: 30 },  // defaults from plugin.yaml
    { timeout: 60 },                       // .spur/plugins/my-plugin.yaml overrides
    process.env,                           // env vars (SPUR_PLUGIN_MY_PLUGIN_*)
    'my-plugin',
);
// => { greeting: 'hello', timeout: <from env or 60> }
```

Environment variables override everything. `SPUR_PLUGIN_MY_PLUGIN_TIMEOUT=90` sets `config.timeout` to `90`. Values are JSON-parsed when possible (`30` becomes a number, `true` becomes boolean), falling back to raw strings.

## Trust Levels & Policy

Every plugin declares a trust level in its manifest. The `TrustEngine` enforces capability access at registration time.

| Trust Level | Allowed Capabilities | Typical Use |
|---|---|---|
| `bundled` | Everything (unconditional) | Built-ins shipped with Spur |
| `curated` | Everything | Vetted, externally-reviewed plugins |
| `local` | `commands`, `api`, `ui`, `events`, `skills` | Project-local plugins |
| `untrusted` | `commands`, `api`, `ui`, `events`, `skills` | Downloaded plugins |

Capabilities denied to `local`/`untrusted`: `harnesses`, `providers`, `rules`, `workers`.

Attempting to register a capability beyond your trust level throws `PluginTrustError`. Attempting to register a capability not declared in the manifest throws `PluginNotDeclaredError`.

## Capability Registries

Each registry is typed — `register()` accepts a capability-specific `TImpl`:

| Registry | Purpose | TImpl |
|---|---|---|
| `CommandRegistry` | Slash commands | `{ name, execute(args) }` |
| `ApiRegistry` | Server API routes | `{ name, handler(req), openApi? }` |
| `UiRegistry` | UI components | `{ name, component }` |
| `EventRegistry` (plugin) | Domains events | `{ name, handlers }` |
| `HarnessRegistry` | Agent harnesses | `{ name, harness }` |
| `ProviderRegistry` | LLM/model providers | `{ name, provider }` |
| `RuleRegistry` | Validation rules | `{ name, rule }` |
| `SkillRegistry` | Agent skills | `{ name, skill }` |
| `WorkerRegistry` | Background workers | `{ name, worker }` |

All registries share a common `Registry<T>` base with collision detection (`PluginCollisionError` on duplicate `capability:name` pairs) and trust enforcement via `TrustEngine.check()`.

## Event System

The `EventRegistry` wraps `@gobing-ai/ts-infra`'s `EventBus` with glob-pattern subscriptions:

```typescript
// Subscribe to all agent events
host.eventRegistry.subscribe('agent.*', (event, detail) => { ... });

// Subscribe to everything (use sparingly)
host.eventRegistry.subscribe('*', (event, detail) => { ... });
```

**Known events** (from `SpurEventMap`):

| Event | Payload |
|---|---|
| `agent.run.start` | `{ agent, prompt, cwd? }` |
| `agent.run.complete` | `{ agent, exitCode, durationMs }` |
| `agent.run.error` | `{ agent, error }` |
| `workflow.transition` | `{ workflowId, from, to }` |
| `rule.evaluate` | `{ ruleId, result }` |
| `usage.record` | `{ tokens, model, timestamp }` |
| `history.import.start` | `{ source }` |
| `history.import.complete` | `{ source, count }` |
| `plugin.load` | `{ name, version }` |
| `plugin.unload` | `{ name }` |
| `plugin.error` | `{ name, error }` |

High-churn events (`usage.record`) have a built-in token-bucket throttle.

## Within Spur (internal usage)

Spur's own rule engine and workflow engine register as plugins through this SDK:

```typescript
// apps/server/src/plugins.ts
import { PluginHost } from '@gobing-ai/spur-plugin-sdk';

const host = new PluginHost(bus, { logger });
await host.loadPlugin(ruleEnginePlugin, { source: 'builtin', pluginName: 'spur-rule-engine', trustLevel: 'bundled' });
await host.loadPlugin(workflowEnginePlugin, { source: 'builtin', pluginName: 'spur-workflow-engine', trustLevel: 'bundled' });

// Built-in commands use seedBuiltin before loading any external plugins
host.commands.seedBuiltin('spur-rule-run', { name: 'spur-rule-run', execute: ruleCommandHandler });
```

External plugins are discovered via `PluginLoader` (in `@gobing-ai/spur-app`) from three roots:
1. **Bundled** — `packages/plugin-sdk/src/builtins/`
2. **User-global** — `~/.spur/plugins/`
3. **Project-local** — `.spur/plugins/`

## Error Handling

| Error | When |
|---|---|
| `PluginManifestError` | `plugin.yaml` fails Zod validation |
| `PluginCollisionError` | Two plugins register the same `capability:name` pair |
| `PluginTrustError` | Capability registration denied by trust policy |
| `PluginNotDeclaredError` | Capability not declared in `plugin.yaml` manifest |
