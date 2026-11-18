---
schema_version: 1
name: Rename built-in MCP harness tools to the sp namespace
status: done
template: feature-impl
created_at: 2026-11-18T05:29:24.290Z
updated_at: "2026-11-18T07:48:01.617Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2

done_forced: "false"
done_reason: unforced close
---

## 1379. Rename built-in MCP harness tools to the sp namespace

### Background

The embedded MCP endpoint advertises five unprefixed harness tools: `task_show`, `task_list`, `workflow_status`, `workflow_run` and `workflow_continue`. They are frozen in task 1372 R2 (`apps/server/src/modules/mcp/index.ts:30-88`) and dispatched by the `McpDispatcher.callTool` switch (`:116-146`). A client that loads several MCP servers cannot tell the source of `task_show`, and the names can collide with other servers. The operator approved a breaking rename to the plugin prefix (`sp`), with no alias period.

**Refine corrections (2026-11-17)**
- "Rename … in `apps/server/src/modules/mcp/index.ts`" (sole file) → the names are also asserted in `apps/server/tests/mcp-e2e.test.ts`, `apps/server/tests/modules/mcp-module.test.ts`, `apps/server/tests/modules/mcp/protocol.test.ts` and `apps/cli/tests/commands/mcp.test.ts:54`, and cited in a doc comment in `apps/server/src/modules/mcp/protocol.ts:24` → all are in scope.
- The feature Notes cite "task NS1" for the tool-name grammar check → that task id does not exist; R3 here owns the check.

### Requirements

- [x] R1. Rename the five tool descriptors and `callTool` cases to `sp_task_show`, `sp_task_list`, `sp_workflow_status`, `sp_workflow_run` and `sp_workflow_continue`.
- [x] R2. A call to an old unprefixed name fails with a tool error naming its `sp_` replacement, e.g. `tool "task_show" was renamed to "sp_task_show"`. `tools/list` never lists an old name.
- [x] R3. Verify the tool-name grammar against the MCP 2026-07-28 specification, then cite the section URL in `docs/design/embedded-mcp-server.md` §4. If `[a-z0-9_]` turns out to be narrower than the spec allows, keep it anyway and record that it was chosen deliberately.
- [x] R4. Amend ADR-152 (`docs/00_ADR.md:2956`) with a dated amendment line and update the tool table in `docs/design/embedded-mcp-server.md` §4.

Out of scope: aliases for the old names, the project namespace for non-built-in tools (1380), and workflow tools (1381).

### Acceptance Criteria

- [x] AC1 — Built-in harness tools carry the sp namespace (req: R1, R2, R3, R4)

Test layer: `apps/server/tests/mcp-e2e.test.ts`, which runs a real serve app through the gateway with no mocks.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:41:17.027Z

- **Alias period?** Closed: none. The operator approved the breaking rename, and the project is pre-1.0. A refusal hint replaces the alias.
- **Derive the built-in prefix from the project namespace?** Closed: no. Built-ins are always `sp_`.

### Design

**WHAT.** Make the `sp_` prefix a literal in each descriptor name and case label; no runtime prefixing. The built-ins always belong to Spur, whatever the project namespace is. Add a module constant `RENAMED_TOOLS: Readonly<Record<string, string>>` mapping each old name to its new one. In `callTool`'s `default` branch, look up `RENAMED_TOOLS[name]` first and throw the rename error, then fall through to the existing unknown-tool error.

**WHY.** Literal names keep the descriptors greppable and the frozen-names contract obvious. The refusal map turns an opaque "unknown tool" into a self-healing hint for clients that cached the old names, at a cost of five lines. Once 1376 lands, the refusal shows up under `errorCode: 'unknown_tool'`.

**WHERE.** `apps/server/src/modules/mcp/index.ts`, the four test files from Background, the doc comment in `protocol.ts`, `docs/00_ADR.md` and `docs/design/embedded-mcp-server.md`.

**Anti-patterns.** Don't list or serve the old names. Don't derive `sp` from the project namespace: built-ins are Spur's in every project, including superskill and knowledge-kit repos.

**Handoff.** 1381 reuses the five `sp_*` names as its reserved set for collision checks. Export them as `BUILTIN_TOOL_NAMES`.

### Plan

- [ ] Step 1 (test first, R1/R2): change the tool-name expectations in `apps/server/tests/mcp-e2e.test.ts` and add an old-name refusal case, then watch it fail.
- [ ] Step 2 (R1/R2): rename the descriptors and cases, add `RENAMED_TOOLS` and export `BUILTIN_TOOL_NAMES`.
- [ ] Step 3: update `mcp-module.test.ts`, `mcp/protocol.test.ts`, `apps/cli/tests/commands/mcp.test.ts` and the `protocol.ts` comment.
- [ ] Step 4 (R3/R4): check the spec grammar, then amend ADR-152 and the design satellite §4.
- [ ] Step 5: run `(cd apps/server && bun test tests/mcp-e2e.test.ts tests/modules)` and `(cd apps/cli && bun test tests/commands/mcp.test.ts)`, then `bun run spur-check`.

### Solution

| File | Lines | What/Why |
| --- | --- | --- |
| `apps/server/src/modules/mcp/index.ts` | 36-141 | R1/R2: renamed the five descriptors and `callTool` cases to `sp_*`; added `RENAMED_TOOLS` refusal map in the `default` branch and exported `BUILTIN_TOOL_NAMES` (1381 handoff). |
| `apps/server/src/modules/mcp/protocol.ts` | 24 | Doc comment now cites `sp_task_show`. |
| `apps/server/tests/mcp-e2e.test.ts` | 129-165, 224 | R1: expectations to `sp_*`; R2: new old-name-refusal case (500 + rename hint). |
| `apps/server/tests/modules/mcp-module.test.ts` | 197-348 | Renamed advertised-tool list and every `tools/call` name to `sp_*`. |
| `apps/server/tests/modules/mcp/protocol.test.ts` | 24-265 | Stub-registry tool name renamed to `sp_task_show` (protocol layer is name-agnostic). |
| `apps/cli/tests/commands/mcp.test.ts` | 54 | Stdio-bridge fixture line renamed. |
| `docs/design/embedded-mcp-server.md` | §4 | R3/R4: sp_ names, no-alias refusal contract, `[a-z0-9_]` kept deliberately narrower than spec with citation. |
| `docs/00_ADR.md` | 2956-2964 | R4: ADR-152 `Amended: 2026-11-17 (task 1379)` bullet + Decision names updated. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 rename five tools (descriptors + cases) | MET | test: e2e `tools/call sp_task_show` green (apps/server/tests/mcp-e2e.test.ts:148); static-ref: descriptors apps/server/src/modules/mcp/index.ts:33-76, cases index.ts:130-145 |
| R2 old names refused, no alias; list never shows them | MET | test: refusal case asserts rename hint (apps/server/tests/mcp-e2e.test.ts:164); map index.ts:89-94, default-branch throw index.ts:156-158; static-ref: tools/list advertises only `sp_*` (apps/server/tests/modules/mcp-module.test.ts:462) |
| R3 grammar verified vs MCP 2026-07-28; deliberate narrowness cited | MET | static-ref: `docs/design/embedded-mcp-server.md:65-67` — `[a-z0-9_]` kept deliberately narrower than spec SHOULD-set, cited https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names (fetched this run) |
| R4 ADR-152 dated amendment + §4 table | MET | static-ref: `docs/00_ADR.md:2957-2961` (`Amended: 2026-11-17 (task 1379)` + Decision names), `docs/design/embedded-mcp-server.md:61-67` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 built-ins carry the `sp` namespace in every project | MET | test | refusal hint maps every legacy name (apps/server/src/modules/mcp/index.ts:89-94); `BUILTIN_TOOL_NAMES` export index.ts:98; e2e suite green |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Run d0462ea9 review of task 1379 — verdict tables (merged fragments, backfill bare only).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 rename five tools (descriptors + cases) | MET | test: e2e `tools/call sp_task_show` green (apps/server/tests/mcp-e2e.test.ts:148); static-ref: descriptors apps/server/src/modules/mcp/index.ts:33-76, cases index.ts:130-145 |
| R2 old names refused, no alias; list never shows them | MET | test: refusal asserts rename hint (apps/server/tests/mcp-e2e.test.ts:164); map apps/server/src/modules/mcp/index.ts:89-94, default-branch throw index.ts:156-158; static-ref: tools/list advertises only `sp_*` (apps/server/tests/modules/mcp-module.test.ts:462) |
| R3 grammar vs MCP 2026-07-28 + deliberate narrowness cited | MET | static-ref: `docs/design/embedded-mcp-server.md:65-67` + spec anchor (fetched this run) |
| R4 ADR-152 dated amendment + §4 table | MET | static-ref: `docs/00_ADR.md:2957-2961`, `docs/design/embedded-mcp-server.md:61-67` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 built-ins carry the `sp` namespace in every project | MET | test | refusal hint maps every legacy name (apps/server/src/modules/mcp/index.ts:89-94); `BUILTIN_TOOL_NAMES` index.ts:98; e2e suite green |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T07:43:54.151Z todo → wip (system)
- 2026-11-18T07:47:59.735Z wip → testing (system)
- 2026-11-18T07:48:01.612Z testing → done (system)

