---
schema_version: 1
name: Resolve the project MCP namespace from config or plugin manifest
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:24.292Z
updated_at: "2026-11-18T05:41:18.336Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

---

## 1380. Resolve the project MCP namespace from config or plugin manifest

### Background

Namespaced workflow tools (1381) need a per-project namespace. The plugin prefix is already the convention in each sibling repo: `plugins/sp/plugin.json` here, `superskill/plugins/cc/plugin.json` and `knowledge-kit/plugins/kk/plugin.json`, whose manifest `name` fields read `sp`, `cc` and `kk`. The `server.mcp` config block (`packages/config/src/index.ts:1369-1374`) has only `enabled` and `authEnv`.

**Refine corrections (2026-11-17)**
- "project config `server.mcp.namespace`" → the server config surface is env-scoped. `serverBootstrapConfig` builds it with `buildConfigFromEnv` (`apps/server/src/server-config.ts:49`), the existing `mcp` keys map to `SPUR_MCP_ENABLED` / `SPUR_MCP_AUTH_ENV` (`packages/config/src/index.ts:21-22,1453-1455`), and `apps/cli/src/commands/mcp.ts:18-19` documents "env-scoped, not project-file" → the schema key stays `server.mcp.namespace`, fed by a new `SPUR_MCP_NAMESPACE` variable.
- "the single plugins/<name>/plugin.json" → knowledge-kit also has nested manifests at `plugins/<group>/<name>/plugin.json` (e.g. `plugins/generations/omni-voice-gen/plugin.json`) → resolution scans depth 1 only (`plugins/*/plugin.json`), or knowledge-kit would resolve to "none".
- `server/discover` has no field for a namespace (`apps/server/src/modules/mcp/protocol.ts:161-168`), and `McpHandlerRegistry` has no accessor → both are extended here.

### Requirements

- [ ] R1. Add `namespace: z.string().regex(/^[a-z][a-z0-9]{1,15}$/).optional()` to `server.mcp` and map it from `SPUR_MCP_NAMESPACE` in `SPUR_ENV_VARS` and `buildConfigFromEnv`. An invalid value fails config load, naming the variable and the grammar.
- [ ] R2. Add `resolveMcpNamespace({ configured, projectRoot, fs })` in `packages/app` that returns `{ namespace, source }` with `source` ∈ `config | plugin-manifest | none`. Order: the configured value, else the `name` of exactly one `plugins/*/plugin.json` at depth 1 if that name passes the grammar, else none.
- [ ] R3. `McpHandlerRegistry` gains `namespace(): string | null`, and `server/discover` returns `namespace` (omitted when null). `McpDispatcher` resolves the namespace once at construction.
- [ ] R4. Document the `SPUR_MCP_NAMESPACE` key in `docs/design/configuration-contracts.md`, and the resolution order and discover field in `docs/design/embedded-mcp-server.md`.

Out of scope: a project-file server config surface, a `spur projects` registry field, and using the namespace for built-ins (always `sp_`, 1379).

### Acceptance Criteria

- [ ] AC1 — Project namespace resolves from config then plugin manifest (req: R1, R2, R3, R4)

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

- [ ] Step 1 (test first, R2): write resolver cases with a temp-dir fixture: config wins; a single depth-1 manifest; two manifests → none; a nested-only manifest (knowledge-kit shape) → none; an invalid manifest name → none.
- [ ] Step 2 (R1): add the schema field and env mapping, and a config test proving that an invalid `SPUR_MCP_NAMESPACE` fails load.
- [ ] Step 3 (R3): extend the registry interface and discover, then add a `server/discover` namespace assertion to `apps/server/tests/mcp-e2e.test.ts`.
- [ ] Step 4 (R4): update both design satellites.
- [ ] Step 5: run the focused tests in `packages/app`, `packages/config` and `apps/server`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
