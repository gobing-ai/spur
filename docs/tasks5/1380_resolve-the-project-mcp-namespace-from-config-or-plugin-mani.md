---
schema_version: 1
name: Resolve the project MCP namespace from config or plugin manifest
status: done
template: feature-impl
created_at: 2026-11-18T05:29:24.292Z
updated_at: "2026-11-18T08:14:35.560Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

done_forced: "false"
done_reason: unforced close
---

## 1380. Resolve the project MCP namespace from config or plugin manifest

### Background

Namespaced workflow tools (1381) need a per-project namespace. The plugin prefix is already the convention in each sibling repo: `plugins/sp/plugin.json` here, `superskill/plugins/cc/plugin.json` and `knowledge-kit/plugins/kk/plugin.json`, whose manifest `name` fields read `sp`, `cc` and `kk`. The `server.mcp` config block (`packages/config/src/index.ts:1369-1374`) has only `enabled` and `authEnv`.

**Refine corrections (2026-11-17)**
- "project config `server.mcp.namespace`" → the server config surface is env-scoped. `serverBootstrapConfig` builds it with `buildConfigFromEnv` (`apps/server/src/server-config.ts:49`), the existing `mcp` keys map to `SPUR_MCP_ENABLED` / `SPUR_MCP_AUTH_ENV` (`packages/config/src/index.ts:21-22,1453-1455`), and `apps/cli/src/commands/mcp.ts:18-19` documents "env-scoped, not project-file" → the schema key stays `server.mcp.namespace`, fed by a new `SPUR_MCP_NAMESPACE` variable.
- "the single plugins/<name>/plugin.json" → knowledge-kit also has nested manifests at `plugins/<group>/<name>/plugin.json` (e.g. `plugins/generations/omni-voice-gen/plugin.json`) → resolution scans depth 1 only (`plugins/*/plugin.json`), or knowledge-kit would resolve to "none".
- `server/discover` has no field for a namespace (`apps/server/src/modules/mcp/protocol.ts:161-168`), and `McpHandlerRegistry` has no accessor → both are extended here.

### Requirements

- [x] R1. Add `namespace: z.string().regex(/^[a-z][a-z0-9]{1,15}$/).optional()` to `server.mcp` and map it from `SPUR_MCP_NAMESPACE` in `SPUR_ENV_VARS` and `buildConfigFromEnv`. An invalid value fails config load, naming the variable and the grammar.
- [x] R2. Add `resolveMcpNamespace({ configured, projectRoot, fs })` in `packages/app` that returns `{ namespace, source }` with `source` ∈ `config | plugin-manifest | none`. Order: the configured value, else the `name` of exactly one `plugins/*/plugin.json` at depth 1 if that name passes the grammar, else none.
- [x] R3. `McpHandlerRegistry` gains `namespace(): string | null`, and `server/discover` returns `namespace` (omitted when null). `McpDispatcher` resolves the namespace once at construction.
- [x] R4. Document the `SPUR_MCP_NAMESPACE` key in `docs/design/configuration-contracts.md`, and the resolution order and discover field in `docs/design/embedded-mcp-server.md`.

Out of scope: a project-file server config surface, a `spur projects` registry field, and using the namespace for built-ins (always `sp_`, 1379).

### Acceptance Criteria

- [x] AC1 — Project namespace resolves from config then plugin manifest (req: R1, R2, R3, R4)

Test layer: resolver tests against real temp directories, plus the `server/discover` assertion in `apps/server/tests/mcp-e2e.test.ts`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:41:18.335Z

- **Project-file vs env config?** Closed: env (`SPUR_MCP_NAMESPACE`), matching the existing env-scoped `server.mcp` surface. The plugin-manifest fallback covers the sp, cc and kk repos without any setting.
- **More than one manifest?** Closed: resolves to `none`, and the operator sets the env var.

### Design

**WHAT.** A pure resolver in `packages/app/src/services/mcp-namespace.ts`:

```ts
export type McpNamespaceSource = 'config' | 'plugin-manifest' | 'none';
export interface McpNamespace { namespace: string | null; source: McpNamespaceSource }
export async function resolveMcpNamespace(input: {
    configured: string | undefined; projectRoot: string; fs: FileSystem;
}): Promise<McpNamespace>;
```

The manifest scan lists `plugins/` children and reads `<child>/plugin.json`. Zero manifests, more than one, or a name that fails the grammar all resolve to `none`. Ambiguity never becomes a guess.

**WHY.** The resolver sits in `packages/app` so the gateway aggregator (K41, 1382) can reuse it per project (ADR-021: apps are thin). Discover reports the namespace so clients and the gateway can see where tools come from without parsing names. The env var keeps config on the existing env-scoped surface instead of inventing a project-file server block.

**WHERE.** `packages/config/src/index.ts`, the new `packages/app/src/services/mcp-namespace.ts` exported from `packages/app/src/index.ts`, `apps/server/src/modules/mcp/protocol.ts` (registry interface and discover) and `apps/server/src/modules/mcp/index.ts` (dispatcher).

**Anti-patterns.** Don't scan nested plugin directories. Don't fall back to the repo or directory name. Don't read the namespace on every request.

**Handoff.** 1381 calls `registry.namespace()` and refuses exposure when it is null. 1382 calls `resolveMcpNamespace` per registered project.

### Plan

- [x] Step 1 (test first, R2): write resolver cases with a temp-dir fixture: config wins; a single depth-1 manifest; two manifests → none; a nested-only manifest (knowledge-kit shape) → none; an invalid manifest name → none.
- [x] Step 2 (R1): add the schema field and env mapping, and a config test proving that an invalid `SPUR_MCP_NAMESPACE` fails load.
- [x] Step 3 (R3): extend the registry interface and discover, then add a `server/discover` namespace assertion to `apps/server/tests/mcp-e2e.test.ts`.
- [x] Step 4 (R4): update both design satellites.
- [x] Step 5: run the focused tests in `packages/app`, `packages/config` and `apps/server`, then `spur task gate 1380 light`.

### Solution

- `packages/config/src/index.ts:23-27`, `packages/config/src/index.ts:1376-1384`, `packages/config/src/index.ts:1467` — added `SPUR_ENV_VARS.mcpNamespace` (`SPUR_MCP_NAMESPACE`), exported `MCP_NAMESPACE_PATTERN` (`/^[a-z][a-z0-9]{1,15}$/`), added `server.mcp.namespace` with a custom error naming `SPUR_MCP_NAMESPACE` and the regex, and mapped it in `buildConfigFromEnv`.
- `packages/config/tests/config.test.ts:98-112` — added tests verifying `SPUR_MCP_NAMESPACE` loads when valid and fails config load naming the variable and grammar when invalid.
- `packages/app/src/services/mcp-namespace.ts:1-69`, `packages/app/src/index.ts:565-570` — added and exported `resolveMcpNamespace({ configured, projectRoot, fs })` resolving `config` → single depth-1 `plugins/*/plugin.json` `name` → `none`.
- `packages/app/tests/services/mcp-namespace.test.ts:1-97` — added temp-dir fixture tests covering config precedence, single depth-1 manifest, multiple manifests, nested-only (depth-2) manifests, invalid manifest names, and missing/malformed manifests.
- `apps/server/src/server-config.ts:27`, `apps/server/src/server-config.ts:71` — added `namespace?: string | null` to `ServerBootConfig.mcp` and populated it in `serverBootstrapConfig`.
- `apps/server/src/modules/mcp/protocol.ts:59`, `apps/server/src/modules/mcp/protocol.ts:163-174` — added `namespace(): string | null` to `McpHandlerRegistry` and updated `server/discover` to include `namespace` when non-null and omit it when `null`.
- `apps/server/src/modules/mcp/index.ts:117-148`, `apps/server/src/modules/mcp/index.ts:266-269` — updated `McpDispatcher` to resolve the project namespace once at construction via `resolveMcpNamespace` and expose it through `namespace()`.
- `apps/server/tests/modules/mcp/protocol.test.ts:29`, `apps/server/tests/modules/mcp/protocol.test.ts:123-135` — updated the registry fixture with `namespace: () => null` and verified `server/discover` omits `null` and includes non-null `namespace`.
- `apps/server/tests/mcp-e2e.test.ts:115`, `apps/server/tests/mcp-e2e.test.ts:129`, `apps/server/tests/mcp-e2e.test.ts:229-280` — asserted `server/discover` omits `namespace` when unconfigured and reports `kk` / `cc` from plugin manifest and `SPUR_MCP_NAMESPACE` override.
- `docs/design/configuration-contracts.md:128-130`, `docs/design/embedded-mcp-server.md:34-49` — documented `SPUR_MCP_NAMESPACE`, resolution order, and the `server/discover` `namespace` field.
- Public-surface probe: not-applicable (no public CLI/HTTP route/plugin script surface changed; `server/discover` response field is covered by `apps/server/tests/mcp-e2e.test.ts`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 config key + env mapping, fail-closed grammar | MET | static-ref: `packages/config/src/index.ts:23` (`SPUR_MCP_NAMESPACE`), `:27` (`MCP_NAMESPACE_PATTERN`), `:1374-1384` (schema + error naming variable and regex), `:1467` (env mapping); test: `packages/config/tests/config.test.ts:107` (invalid value fails load) |
| R2 `resolveMcpNamespace` with `config → plugin-manifest → none` | MET | static-ref: `packages/app/src/services/mcp-namespace.ts:18-69`, exported `packages/app/src/index.ts:569`; test: 6 resolver cases `packages/app/tests/services/mcp-namespace.test.ts:29-95` (config wins, single manifest, ambiguous→none, depth-2→none, bad grammar→none, missing/malformed→none) |
| R3 registry `namespace()` + `server/discover` field, resolved once | MET | static-ref: `apps/server/src/modules/mcp/protocol.ts:59` (interface), `:163-174` (discover, omitted when null), `apps/server/src/modules/mcp/index.ts:117-138` (resolve at construction); test: `apps/server/tests/mcp-e2e.test.ts:229` (manifest `kk` + `SPUR_MCP_NAMESPACE` override, omit when unconfigured) |
| R4 document key + resolution order + discover field | MET | static-ref: `docs/design/configuration-contracts.md:130`, `docs/design/embedded-mcp-server.md:34-49` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 namespace resolves config then plugin manifest (R1–R4) | MET | test | `packages/app/tests/services/mcp-namespace.test.ts` 6/6 pass; `packages/config/tests/config.test.ts` 16/16; `apps/server` modules+e2e 390/390 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of run 294c9e7e — verdict tables (merged fragments, backfill bare only).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 config key + env mapping, fail-closed grammar | MET | static-ref: `packages/config/src/index.ts:23,27,1376-1384,1467`; test: `packages/config/tests/config.test.ts:107` |
| R2 `resolveMcpNamespace` (`config → plugin-manifest → none`) | MET | static-ref: `packages/app/src/services/mcp-namespace.ts:18-69`, export `packages/app/src/index.ts:569`; test: `packages/app/tests/services/mcp-namespace.test.ts:29-95` (6 cases) |
| R3 registry `namespace()` + discover field, resolved once | MET | static-ref: `apps/server/src/modules/mcp/protocol.ts:59,163-174`, `apps/server/src/modules/mcp/index.ts:117-138`; test: `apps/server/tests/mcp-e2e.test.ts:229` |
| R4 document key, resolution order, discover field | MET | static-ref: `docs/design/configuration-contracts.md:130`, `docs/design/embedded-mcp-server.md:34-49` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 namespace resolves config then plugin manifest | MET | test | `packages/app/tests/services/mcp-namespace.test.ts` 6/6; `packages/config/tests/config.test.ts` 16/16; `apps/server` modules+e2e 390/390 |

Open P3: `namespace()` is synchronous while resolution is async, awaited only in `listTools`/`listResources` (`apps/server/src/modules/mcp/index.ts:140-148`) — 1381 must read it after listing. No P1/P2. P4: grammar-invalid configured value falls through to the manifest scan (`packages/app/src/services/mcp-namespace.ts:25`), unreachable via fail-closed config load.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T08:13:02.260Z todo → wip (system)
- 2026-11-18T08:14:33.721Z wip → testing (system)
- 2026-11-18T08:14:35.553Z testing → done (system)

