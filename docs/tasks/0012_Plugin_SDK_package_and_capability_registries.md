---
name: Plugin SDK package and capability registries
description: Plugin SDK package and capability registries
status: Backlog
created_at: 2026-06-03T17:06:42.747Z
updated_at: 2026-06-03T17:06:42.747Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: medium
dependencies: ["ADR-012","@gobing-ai/ts-infra 0.3.0 (EventBus/EventMap)"]
tags: ["plugin-system","sdk","phase-5a"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0012. Plugin SDK package and capability registries

### Background

Phase 5a of the plugin system (ADR-012). Standalone @gobing-ai/spur-plugin-sdk package.


### Requirements

SpurPlugin interface; PluginHost with 8 typed registries (command/api/ui/event/harness/provider/rule/skill+worker); PluginConfig merge (plugin.yaml defaults -> .spur YAML override -> env); a zod schema per YAML file type (PluginManifestSchema, PluginConfigSchema) validating parseYamlObject output; TrustLevel + registration-time capability gating (policy only, no runtime sandbox); zero core deps (ts-infra only); unit tests; coverage >=85% line / 90% func.

SUBSTRATE constraints (ADR-012 Decision 7 — plugins are system primitives, not an add-on):
- Each registry's `register(name, impl)` is a PUBLIC, SemVer-significant SDK contract (first-party primitives will live behind it), not an internal convenience. Design it as the real runtime wiring for that capability.
- Built-ins are modeled as implicit PRE-REGISTRATIONS through the same `register()` path, so migrating a hardcoded built-in to a bundled plugin later is a move, not a re-architecture. (HarnessRegistry overlay is the first instance — task 0015.)
- Trust engine: `bundled` = "this is the system" — a bundled capability is UNCONDITIONALLY allowed; gating applies to curated/local/untrusted only.
- Registries must support being populated before command dispatch / server route-mount (the substrate sits on the startup hot path).


### Q&A

Micro-decisions resolved at design time so implementation does not guess:

- **Manifest + config format → YAML, validated by a Zod schema** (ADR-012 Decision 8). Spur
  standardizes on YAML project-wide; `@gobing-ai/ts-runtime` already ships `parseYamlObject` /
  `stringifyYamlObject` / `YamlParseError`. The manifest is **`plugin.yaml`** and overrides are
  **`.spur/plugins/<name>.yaml`** — no TOML, no new parser dependency.
- **Validation is schema-first, not ad-hoc.** Each YAML file type has a declarative `zod` schema
  (the convention `packages/config`'s `configSchema` already sets). The SDK owns and exports
  `PluginManifestSchema` and `PluginConfigSchema`; a file is consumed only after
  `schema.safeParse(parsed)` succeeds, yielding structured, path-pointed errors. This replaces the
  upstream agent-spec `requireString` field-by-field style.
- **Where parsing happens (keeps the SDK pure):** ADR-012 requires the SDK depend only on
  `ts-infra`; YAML parsing lives in `ts-runtime`. So the SDK is **I/O- and parser-free**: it exports
  the Zod *schemas* and pure `validateManifest(obj)` / `PluginConfig.merge(defaults, overrides, env)`
  helpers that take already-parsed plain objects. The host/loader (5b, in `packages/app`, which
  already uses `ts-runtime`) reads the file, calls `parseYamlObject`, then validates with the SDK's
  schema. `zod` is a SDK dependency (catalog `4.4.3`); `ts-runtime` is **not**.
- **Built-in vs plugin resolution:** one store, `preRegister()` seeds built-ins tagged
  `source: 'builtin'`; `get()` is a single overlay lookup — no branching (enables the 5f migration).
- **`bundled` trust:** unconditionally allowed; `TrustEngine.enforce` short-circuits for `bundled`.
- **Collision policy:** first-registered wins; a later `register()` of the same name throws
  `PluginCollisionError` (built-ins occupy their names first, so a plugin cannot shadow a primitive).
- **`untrusted` in 5a:** capability *policy* only; runtime fs/net/shell isolation is 5e (out of
  scope). The schema records the `allow` block but the SDK does not enforce it at runtime.
- Shared deps stay `catalog:` (`@gobing-ai/ts-infra`, `zod`) per the version-SSOT rule.


### Design

Grounded against the real upstream APIs (verified 2026-06-03):
`Logger` (ts-infra) has `info/warn/error/.../child(ctx)`; `EventBus<TEvents extends EventMap>` with
`EventMap = Record<string, (...args: never[]) => void>`, methods `on/once/off/emit`; YAML parsing via
`ts-runtime` `parseYamlObject`/`stringifyYamlObject`/`YamlParseError`; validation via `zod` (catalog
`4.4.3`), following `packages/config`'s `configSchema` precedent.

#### Package layout (`packages/plugin-sdk`, `@gobing-ai/spur-plugin-sdk`)

```
packages/plugin-sdk/
  package.json        # deps: @gobing-ai/ts-infra (catalog:), zod (catalog:); devDeps @types/bun, typescript
  tsconfig.json       # extends ../../tooling/typescript/base.json
  src/
    index.ts          # public surface — types + schemas + PluginHost + TrustLevel + errors
    plugin.ts         # SpurPlugin interface + inferred types (from schemas)
    schema.ts         # PluginManifestSchema, PluginConfigSchema (zod) — the validation SSOT
    host.ts           # PluginHost (owns the 8 registries + config + logger)
    trust.ts          # TrustLevel, TrustEngine, capability→tier policy table
    config.ts         # PluginConfig.merge(defaults, overrides, env) — pure, object-in
    events.ts         # SpurEventMap, EventRegistry (glob adapter over EventBus)
    registries/
      base.ts         # Registry<T> base: register/unregister/get/list + collision + trust hook
      command.ts api.ts ui.ts harness.ts provider.ts rule.ts skill.ts worker.ts
  tests/
    schema.test.ts host.test.ts trust.test.ts config.test.ts events.test.ts registries/*.test.ts
```

#### Validation schemas (`schema.ts`) — the substantive deliverable (ADR-012 Decision 8)

```ts
import { z } from 'zod';

export const TrustLevelSchema = z.enum(['bundled', 'curated', 'local', 'untrusted']);

export const CapabilitiesSchema = z
    .object({
        commands: z.array(z.string()).optional(),
        api: z.array(z.string()).optional(),
        ui: z.array(z.string()).optional(),
        events: z.array(z.string()).optional(),
        harnesses: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        rules: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        workers: z.array(z.string()).optional(),
    })
    .strict();

export const PluginManifestSchema = z
    .object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/),
        version: z.string(),
        description: z.string().optional(),
        author: z.string().optional(),
        trust: TrustLevelSchema,
        capabilities: CapabilitiesSchema.default({}),
        allow: z
            .object({
                filesystem: z.array(z.string()).optional(),
                network: z.array(z.string()).optional(),
                commands: z.array(z.string()).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// Base override schema; a plugin may extend with its own typed config schema.
export const PluginConfigSchema = z.record(z.string(), z.unknown());

/** Validate an already-parsed YAML object; structured error on failure (R1.2/R2.3). */
export function validateManifest(parsed: unknown): PluginManifest {
    const r = PluginManifestSchema.safeParse(parsed);
    if (!r.success) throw new PluginManifestError(r.error); // path-pointed messages
    return r.data;
}
```

The host/loader does `validateManifest(parseYamlObject(text))`. The SDK never reads files — it owns
the *schema* (the SSOT for the manifest shape) and pure validators. `.strict()` rejects unknown keys
so a typo in `plugin.yaml` is an error, not a silent no-op.

#### Public types (SDK surface)

```ts
export interface SpurPlugin {
    readonly name: string;
    readonly version: string;
    onLoad(host: PluginHost): void | Promise<void>;
    onUnload?(host: PluginHost): void | Promise<void>;
}
export type TrustLevel = z.infer<typeof TrustLevelSchema>;
export type Capability =
    'commands' | 'api' | 'ui' | 'events' | 'harnesses' | 'providers' | 'rules' | 'skills' | 'workers';
```

#### Registry base contract (the SemVer-significant seam — ADR-012 Decision 7)

```ts
export abstract class Registry<TImpl> {
    constructor(protected capability: Capability, protected trust: TrustEngine, protected logger: Logger) {}
    register(name: string, impl: TImpl, ctx: RegistrationContext): void; // validates type, trust, collision
    unregister(name: string): void;
    get(name: string): TImpl | undefined;   // overlay-first; built-ins are ordinary entries
    list(): { name: string; source: PluginSource }[];
    protected preRegister(name: string, impl: TImpl): void; // built-in seeding (no trust check)
}
```
Built-ins seed via `preRegister()` tagged `source: 'builtin'`; `get()` is one lookup (no
builtin-vs-plugin branching) — what makes the 5f migration a *move*. Collision → `PluginCollisionError`.

#### TrustEngine (policy only — runtime sandbox is 5e, out of scope)

```ts
export class TrustEngine {
    enforce(capability: Capability, level: TrustLevel, ctx: RegistrationContext): void; // throws PluginTrustError
    declares(manifest: PluginManifest, capability: Capability, name: string): boolean;   // R4.3
}
```
| capability | bundled | curated | local | untrusted |
|------------|---------|---------|-------|-----------|
| commands/api/ui/events/skills | ✓ | ✓ | ✓ | read-only APIs only |
| harnesses/providers/rules/workers | ✓ | ✓ | ✗ | ✗ |

Reject if not declared in `manifest.capabilities` (R4.3) or the tier forbids it (R4.4); error names
plugin + capability + level. `bundled` short-circuits to allow.

#### PluginConfig merge
Precedence: `plugin.yaml` `config:` defaults → `.spur/plugins/<name>.yaml` overrides → env
`SPUR_PLUGIN_<NAME>_<KEY>`. `PluginConfig.merge(defaults, overrides, env)` is **pure** (objects in,
no file I/O). The host parses YAML with `ts-runtime` and may validate overrides with a plugin-supplied
config schema before merge.

#### Event seam (ADR-012 Decision 4)
`SpurEventMap` enumerates the R8.2 events as a typed `EventMap`. `EventRegistry` wraps
`EventBus<SpurEventMap>`: `subscribe(pattern, handler)` expands a glob (`agent.*`, `*`) to matching
keys and registers each via `bus.on`. High-churn events (`usage.record`) get a token bucket in the
registry.

#### NOT in 5a
File discovery / YAML reading / dynamic import (5b), Hono mounting (5c), AiRunner harness wiring (5d),
runtime sandboxing (5e). 5a is the pure, in-memory, fully-unit-testable core (schemas + registries +
trust + host).


### Solution



### Plan

Build order (each step lands with its tests; gate green before the next):

1. Scaffold `packages/plugin-sdk/` — `package.json` (`@gobing-ai/spur-plugin-sdk`, deps
   `@gobing-ai/ts-infra: catalog:`, `zod: catalog:`), `tsconfig.json` (extends
   `tooling/typescript/base.json`), empty `src/index.ts`. Add to root workspace; `bun install`;
   confirm `bun run lint` sees it.
2. `schema.ts` — `TrustLevelSchema`, `CapabilitiesSchema`, `PluginManifestSchema` (`.strict()`),
   `PluginConfigSchema`, `validateManifest()`, inferred `PluginManifest` type. Tests: a valid
   `plugin.yaml` object parses; missing `trust`/`name` → structured error; unknown key rejected
   (`.strict`); bad `trust` enum rejected; error message is path-pointed (R1.2/R11 schema coverage).
3. `plugin.ts` — `SpurPlugin`, `Capability`, `PluginSource` types (re-exporting inferred schema types).
4. `trust.ts` — `TrustEngine.enforce/declares` + policy table. Tests for every cell: bundled
   unconditionally allowed; local/untrusted denied harness/provider; undeclared capability throws;
   error contains plugin + capability + level (R4.3/R4.4, R11.2).
5. `registries/base.ts` — `Registry<TImpl>` (register/unregister/get/list, `preRegister`, collision,
   trust hook). Tests: register→get, collision throws, preRegister seeds a `builtin` entry resolvable
   through the same `get`.
6. The eight concrete registries — thin subclasses binding `TImpl` + a registration-time type check
   (harness impl must satisfy the `AgentShim` shape; full wiring is 5d). Tests per registry.
7. `events.ts` — `SpurEventMap` (R8.2), `EventRegistry` glob adapter over `EventBus`, token bucket
   for high-churn events. Tests: `agent.*` fans to the right keys; `*` catches all; rate limit drops
   excess `usage.record` in a window (R8.4).
8. `config.ts` — `PluginConfig.merge(defaults, overrides, env)` (pure). Tests for precedence
   (yaml-defaults < override-yaml < env) and `SPUR_PLUGIN_<NAME>_<KEY>` parsing.
9. `host.ts` — `PluginHost` owning the 8 registries + `config` + namespaced `logger` (`logger.child`).
   Tests: a fake `SpurPlugin.onLoad(host)` registers a command + subscribes an event; `onUnload`
   unregisters.
10. `index.ts` — export only the public surface (types, schemas, `validateManifest`, `PluginHost`,
    `TrustLevel`, error classes). No registry internals leak.
11. Gate: `bun run lint` + `bun run test` (coverage ≥85% line / 90% func) + `bun run build`.
    Backfill task sections; verdict.

Out of scope (tracked in 0013–0016): file discovery, YAML reading, dynamic import, Hono mount,
AiRunner harness wiring, runtime sandboxing.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


