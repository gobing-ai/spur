---
schema_version: 1
name: Expose opted-in workflows as namespaced MCP tools
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:24.293Z
updated_at: "2026-11-18T05:41:50.773Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6.5

dependencies: ["1379", "1380"]
---

## 1381. Expose opted-in workflows as namespaced MCP tools

### Background

Projects already encode capabilities as workflows under `config/workflows/`. Exposing chosen ones as `<namespace>_<workflow>` MCP tools gives cc_, kk_ and sp_ tools with no new runtime: calls go through the existing `WorkflowService.run(file, { vars })` path (`packages/app/src/services/workflow-service.ts:389`), the same one `sp_workflow_run` uses.

**Refine corrections (2026-11-17)**
- "Add an optional `mcp` block to the workflow YAML schema" → the root workflow schemas live in the released engine `@gobing-ai/ts-dual-workflow-engine@0.7.1`, and both are `.strict()` (`node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema.js:78-122`, plus the transition-flow schema at `:191`), so an unknown top-level key fails parse. AGENTS.md says to fix the engine facade instead of adding a Spur workaround → the engine gains one behavior-free `metadata: Record<string, unknown>` root key in `ts-libs/packages/dual-workflow-engine`, and Spur reads `metadata.mcp.expose`.
- "`mcp: { expose, description }`" → the root schema already has `description` (`schema.js:85`) → the workflow's own `description` is the tool description, and `metadata.mcp.description` is dropped.
- "input schema derived from declared vars" → `vars` is `Record<string, string>` with defaults only, no types or required flags (`schema.js:8`), and `sp_workflow_run` already passes `stringRecord(args, 'vars')` (`apps/server/src/modules/mcp/index.ts:129-131`) → each var becomes an optional `string` property whose `default` is the declared value, with `additionalProperties: false`.
- Tool-name derivation was unspecified → workflow names contain `-` (e.g. `task-pipeline`), which is outside `[a-z0-9_]` → map `-` to `_` and lowercase. The resulting `a-b`/`a_b` collision falls under R4.
- "Discovery reuses workflow-catalog-scan" → the module exports `scanWorkflowFiles` (`packages/app/src/services/workflow-catalog-scan.ts:36`) → use it as the discovery source.

### Requirements

- [ ] R1. Add an optional, behavior-free `metadata: z.record(z.string(), z.unknown())` root key to both workflow def schemas in `ts-libs/packages/dual-workflow-engine`. Release it as a minor version, then bump the root `workspaces.catalog` pin in `package.json:38`. The publish needs operator authorization.
- [ ] R2. A workflow declaring `metadata: { mcp: { expose: true } }` is listed as a tool named `<namespace>_<name with - mapped to _>`. The description comes from the workflow `description`, and the input schema has one optional string property per declared var, with its default. Workflows without `expose: true` are not listed.
- [ ] R3. `callTool` on an exposed tool name runs `WorkflowService.run(<workflow file>, { vars })` and returns its result. Arguments outside the declared vars are refused with `invalid_arguments`.
- [ ] R4. `spur workflow validate` fails an exposed workflow when (a) the project has no namespace, (b) its tool name equals a `BUILTIN_TOOL_NAMES` entry (1379), or (c) two exposed workflows derive the same tool name. The message names the tool and the remedy. At runtime, `tools/list` omits colliding entries rather than serving an ambiguous name.
- [ ] R5. Update `docs/design/workflow-composition-contract.md` (the `metadata.mcp` key) and `docs/design/embedded-mcp-server.md` (workflow tools).

Out of scope: exposure by default, an `mcp` key in the engine schema, typed var schemas, and cross-project listing (K41).

### Acceptance Criteria

- [ ] AC1 — An opted-in workflow becomes a namespaced MCP tool (req: R1, R2, R3, R5)
- [ ] AC2 — Tool-name collisions are refused at validate time (req: R4)

Test layer: a real serve app with a fixture project in `apps/server/tests/mcp-e2e.test.ts`, plus `spur workflow validate` tests on fixture YAML.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:41:19.709Z

- **Where does the opt-in live, given the engine's strict schema?** Closed: a generic `metadata` key in the engine, and Spur reads `metadata.mcp.expose`. Rejected: an env list (awkward and invisible next to the workflow) and a Spur sidecar file (new surface). Engine publish authorization is pending with the operator.
- **Typed inputs?** Deferred: vars are untyped strings today. Revisit if the engine gains typed vars.

### Design

**WHAT.** Add a function to `packages/app` that the dispatcher and the validator both call:

```ts
export interface ExposedWorkflowTool { tool: string; file: string; workflow: string; description?: string; vars: Record<string, string> }
export interface McpExposureIssue { tool: string; file: string; reason: 'no-namespace' | 'builtin-collision' | 'duplicate'; remedy: string }
export async function resolveExposedWorkflowTools(input: {
    namespace: string | null; reserved: readonly string[]; roots: string[]; fs: FileSystem;
}): Promise<{ tools: ExposedWorkflowTool[]; issues: McpExposureIssue[] }>;
```

`McpDispatcher.listTools()` returns the built-ins plus `tools`, computed on every call (stateless server, no cache). `callTool` checks the built-ins first, then looks the name up in a fresh resolve. The validate path adds `issues` to its error list.

**WHY.** One generic `metadata` key keeps MCP out of the engine's vocabulary and lets the engine stay `.strict()` for every behavioral key. A single resolver means validate and runtime cannot disagree on names. Recomputing per call is the simplest correct option for a local server with a few dozen workflows; add an mtime-keyed cache only if `tools/list` latency shows up in the I61 data.

**WHERE.** `ts-libs/packages/dual-workflow-engine/src/schema.ts` (engine). In Spur: the new `packages/app/src/services/mcp-workflow-tools.ts`, `packages/app/src/services/workflow-inspect-ops.ts` (validate) and `apps/server/src/modules/mcp/index.ts`.

**Anti-patterns.** Don't add an `mcp` key to the engine, and don't use a Spur-side YAML pre-strip workaround. Don't run workflows through any path other than `WorkflowService.run`. Don't list unexposed workflows.

**Dependencies.** 1379 (`BUILTIN_TOOL_NAMES`) and 1380 (`registry.namespace()`). The engine release (R1) is a cross-repo publish and is the critical path.

### Plan

- [ ] Step 1 (R1): add `metadata` to both engine root schemas and an engine test that the key round-trips while other unknown keys still fail. Publish once the operator authorizes it, then bump the catalog pin and run `bun install`.
- [ ] Step 2 (test first, R2/R3): add a fixture project with namespace `cc`, one exposed workflow with vars and one hidden workflow, and cover it in `apps/server/tests/mcp-e2e.test.ts`. Assert that `tools/list` contains `cc_<name>` with the derived schema, the hidden workflow is absent, the call creates a run, and an unknown argument is refused.
- [ ] Step 3 (R2/R3): implement `resolveExposedWorkflowTools` and wire it into the dispatcher.
- [ ] Step 4 (R4): wire the issues into validate, with tests for no-namespace, built-in collision and duplicate (`a-b` vs `a_b`).
- [ ] Step 5 (R5): update the docs, then run the focused tests and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
