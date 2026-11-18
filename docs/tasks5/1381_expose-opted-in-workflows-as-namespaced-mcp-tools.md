---
schema_version: 1
name: Expose opted-in workflows as namespaced MCP tools
status: done
template: feature-impl
created_at: 2026-11-18T05:29:24.293Z
updated_at: "2026-11-18T08:33:48.651Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6.5

dependencies: ["1379", "1380"]
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Add an optional, behavior-free `metadata: z.record(z.string(), z.unknown())` root key to both workflow def schemas in `ts-libs/packages/dual-workflow-engine`. Release it as a minor version, then bump the root `workspaces.catalog` pin in `package.json:38`. The publish needs operator authorization.
- [x] R2. A workflow declaring `metadata: { mcp: { expose: true } }` is listed as a tool named `<namespace>_<name with - mapped to _>`. The description comes from the workflow `description`, and the input schema has one optional string property per declared var, with its default. Workflows without `expose: true` are not listed.
- [x] R3. `callTool` on an exposed tool name runs `WorkflowService.run(<workflow file>, { vars })` and returns its result. Arguments outside the declared vars are refused with `invalid_arguments`.
- [x] R4. `spur workflow validate` fails an exposed workflow when (a) the project has no namespace, (b) its tool name equals a `BUILTIN_TOOL_NAMES` entry (1379), or (c) two exposed workflows derive the same tool name. The message names the tool and the remedy. At runtime, `tools/list` omits colliding entries rather than serving an ambiguous name.
- [x] R5. Update `docs/design/workflow-composition-contract.md` (the `metadata.mcp` key) and `docs/design/embedded-mcp-server.md` (workflow tools).

Out of scope: exposure by default, an `mcp` key in the engine schema, typed var schemas, and cross-project listing (K41).

### Acceptance Criteria

- [x] AC1 — An opted-in workflow becomes a namespaced MCP tool (req: R1, R2, R3, R5)
- [x] AC2 — Tool-name collisions are refused at validate time (req: R4)

Test layer: a real serve app with a fixture project in `apps/server/tests/mcp-e2e.test.ts`, plus `spur workflow validate` tests on fixture YAML.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:41:19.709Z

- **Where does the opt-in live, given the engine's strict schema?** Closed: a generic `metadata` key in the engine, and Spur reads `metadata.mcp.expose`. Rejected: an env list (awkward and invisible next to the workflow) and a Spur sidecar file (new surface). Engine publish authorization is pending with the operator.
- **Typed inputs?** Deferred: vars are untyped strings today. Revisit if the engine gains typed vars.

- **Engine publish authorized (operator, 2026-11-17).** The engine side of R1 is done: commit `eab057fd` in `ts-libs` adds an optional `metadata` record to the state-machine and transition-flow root schemas and the def types. Tests show it round-trips, a non-object value is rejected, and other unknown root keys still fail.
- **The release is not out yet, so Step 1 is blocked.** `ts-libs` `main` also has two new packages, `@gobing-ai/ts-decision-gemini` and `@gobing-ai/ts-decision-openai`, that were never published to npm (npm returns 404). The CI publish checks for that first and stops the whole release, so they must be bootstrapped by hand first. Once the release (`0.8.0`) is out, all Step 1 needs is to bump the root `workspaces.catalog` pin and run `bun install`. Don't start R2 or later before that.

- **Step 1 is done (2026-11-17).** `@gobing-ai/ts-*` 0.8.0 is published, and the root `workspaces.catalog` pins it. The local ts-db patch has been moved to `patches/@gobing-ai%2Fts-db@0.8.0.patch`, unchanged: ts-db code is identical from 0.7.1 to 0.8.0, and without the patch `DbSyncTransaction` fails typecheck. The engine's `metadata` key is in `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema.js`. Implementation starts at R2.

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

| File | Lines | What/Why |
| --- | --- | --- |
| `packages/app/src/services/mcp-workflow-tools.ts` | 1-186 | R2/R4: `resolveExposedWorkflowTools` + `workflowToolName` — one resolver shared by `tools/list` and validate, so a name cannot be advertised while validate rejects it. Reads `metadata.mcp.expose === true`, keeps the workflow `description` and declared `vars`, discovers across all roots, and turns no-namespace / built-in collision / duplicate derivations into issues rather than guesses. |
| `packages/app/src/services/mcp-builtin-tools.ts` | 1-17 | R4: `MCP_BUILTIN_TOOL_NAMES` in the app layer — validate cannot import `apps/server` (apps are thin, ADR-021); a server test asserts parity with the advertised descriptors. |
| `packages/app/src/services/workflow-inspect-ops.ts` | 24-25, 221-231, 417-441 | R4: validate appends exposure issues for the validated file before the composition advisory, phrasing reason + remedy. Namespace comes from the env funnel (`getEnvVars`) because the app-layer config view has no `server` block. |
| `packages/app/src/index.ts` | 571-580 | Exports the resolver and both name lists. |
| `apps/server/src/modules/mcp/index.ts` | 1-14, 99-115, 148-186, 196-204 | R2: `listTools` appends a descriptor per exposed tool (var defaults, `additionalProperties: false`); R3: `callTool` falls through to the resolver and runs `WorkflowService.run(file, { vars })`, refusing undeclared or non-string arguments with `invalid_arguments`. |
| `apps/server/tests/mcp-e2e.test.ts` | 285-380 | R2/R3 end-to-end on a fixture project: `kk_daily_report` listed with the derived schema, unexposed absent, undeclared arg refused, declared arg creates a real `done` run. |
| `apps/server/tests/modules/mcp-module.test.ts` | 1, 459-470, 500-520 | Built-in-list parity guard; the direct-handler seam now passes the documented `fs` the resolver needs. |
| `packages/app/tests/services/mcp-workflow-tools.test.ts` | 1-140 | Resolver cases: naming, hidden workflow, all three R4 reasons, multi-root discovery, unparseable file skipped. |
| `packages/app/tests/services/workflow-inspect-ops.test.ts` | 118-190 | R4 through `validate` with the namespace from a plugin manifest (no env mutation). |
| `packages/app/tests/services/mcp-builtin-tools.test.ts` | 1-13 | Namespace and uniqueness guard for the app-layer list. |
| `docs/design/workflow-composition-contract.md` | 73-95 | R5: the `metadata.mcp` opt-in shape, name derivation and refusal rules. |
| `docs/design/embedded-mcp-server.md` | 69-80 | R5: workflow tools in `tools/list`, the run path, and the shared-resolver guarantee. |

R1 was already landed before this run (`@gobing-ai/ts-*` 0.8.0 catalog pin; engine `metadata` key), so implementation started at R2. Public-surface probe: no new CLI/HTTP route — `tools/list` gains entries and `workflow validate` gains findings, both inside existing surfaces.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 engine `metadata` key + catalog pin | MET | static-ref: root `package.json:39-40` pins `@gobing-ai/ts-*` 0.8.0; `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/schema.js` carries `metadata` (published 0.8.0, pre-landed before this run) |
| R2 opted-in workflow listed as `<namespace>_<name>`, description + per-var schema | MET | static-ref: `packages/app/src/services/mcp-workflow-tools.ts:36-42` (name derivation), `:96-186` (resolver); `apps/server/src/modules/mcp/index.ts:99-115` (descriptor), `:159-176` (discovery); test: `apps/server/tests/mcp-e2e.test.ts` `kk_daily_report` listed with `{target: {type:'string', default:'default-target'}}` and `additionalProperties: false`, unexposed `hidden-flow` absent; resolver cases `packages/app/tests/services/mcp-workflow-tools.test.ts:57-140` |
| R3 call runs `WorkflowService.run(file, {vars})`; undeclared args → `invalid_arguments` | MET | static-ref: `apps/server/src/modules/mcp/index.ts:178-197`; test: e2e refuses `{bogus:'x'}` with `invalid_arguments` and runs `{target:'today'}` to a real `done` run with a runId |
| R4 validate refuses no-namespace / built-in collision / duplicate; list omits them | MET | static-ref: `packages/app/src/services/workflow-inspect-ops.ts:221-231` (validate hook), `:417-441` (issues→errors), `packages/app/src/services/mcp-builtin-tools.ts:10-16`; test: `packages/app/tests/services/workflow-inspect-ops.test.ts` R4(a)/R4(b)/R4(c) all fail validate with reason + remedy; resolver test asserts neither duplicate is listed |
| R5 document `metadata.mcp` and the workflow tools | MET | static-ref: `docs/design/workflow-composition-contract.md:73-95`, `docs/design/embedded-mcp-server.md:69-80` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 an opted-in workflow becomes a namespaced tool | MET | test | `apps/server/tests/mcp-e2e.test.ts` (list + call + run), `packages/app/tests/services/mcp-workflow-tools.test.ts` (8 cases) |
| AC2 collisions refused at validate time | MET | test | `packages/app/tests/services/workflow-inspect-ops.test.ts` R4(a)(b)(c) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of run b72adaf6 — verdict tables (merged fragments, backfill bare only).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 engine `metadata` + catalog pin | MET | static-ref: `package.json:39-40` (ts-* 0.8.0), engine `dist/schema.js` carries `metadata` (pre-landed) |
| R2 opted-in workflow listed as `<ns>_<name>` with description + per-var schema | MET | static-ref: `packages/app/src/services/mcp-workflow-tools.ts:36-42,96-186`, `apps/server/src/modules/mcp/index.ts:99-115,159-176`; test: e2e `kk_daily_report` schema/defaults, hidden absent; `packages/app/tests/services/mcp-workflow-tools.test.ts:57-140` |
| R3 call runs `WorkflowService.run(file,{vars})`; undeclared args refused | MET | static-ref: `apps/server/src/modules/mcp/index.ts:178-197`; test: e2e `invalid_arguments` refusal + real `done` run with runId |
| R4 validate refuses no-namespace / builtin / duplicate; list omits | MET | static-ref: `packages/app/src/services/workflow-inspect-ops.ts:221-231,417-441`, `packages/app/src/services/mcp-builtin-tools.ts:10-16`; test: `workflow-inspect-ops.test.ts` R4(a)(b)(c) |
| R5 document `metadata.mcp` + workflow tools | MET | static-ref: `docs/design/workflow-composition-contract.md:73-95`, `docs/design/embedded-mcp-server.md:69-80` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 opted-in workflow becomes a namespaced tool | MET | test | `apps/server/tests/mcp-e2e.test.ts` (list+call+run), resolver 8 cases |
| AC2 collisions refused at validate time | MET | test | `packages/app/tests/services/workflow-inspect-ops.test.ts` R4(a)(b)(c) |

P2 fixed in run: `callTool` now awaits the async namespace resolution (`apps/server/src/modules/mcp/index.ts:161-164`); the ordering test does not deterministically reproduce the pre-fix behaviour (resolver fs awaits settle first), so the fix is reasoned, not test-proven. P3 accepted: `listTools` re-walks layers per call (no cache, by design); non-string var defaults stringified at the boundary. P4: built-in names duplicated app-side, guarded by a parity test. No P1.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T08:26:33.513Z todo → wip (system)
- 2026-11-18T08:33:46.233Z wip → testing (system)
- 2026-11-18T08:33:48.646Z testing → done (system)

