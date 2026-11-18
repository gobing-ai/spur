---
schema_version: 1
name: Rename built-in MCP harness tools to the sp namespace
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:24.290Z
updated_at: "2026-11-18T05:41:17.028Z"
feature_id: B91
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2

---

## 1379. Rename built-in MCP harness tools to the sp namespace

### Background

The embedded MCP endpoint advertises five unprefixed harness tools: `task_show`, `task_list`, `workflow_status`, `workflow_run` and `workflow_continue`. They are frozen in task 1372 R2 (`apps/server/src/modules/mcp/index.ts:30-88`) and dispatched by the `McpDispatcher.callTool` switch (`:116-146`). A client that loads several MCP servers cannot tell the source of `task_show`, and the names can collide with other servers. The operator approved a breaking rename to the plugin prefix (`sp`), with no alias period.

**Refine corrections (2026-11-17)**
- "Rename … in `apps/server/src/modules/mcp/index.ts`" (sole file) → the names are also asserted in `apps/server/tests/mcp-e2e.test.ts`, `apps/server/tests/modules/mcp-module.test.ts`, `apps/server/tests/modules/mcp/protocol.test.ts` and `apps/cli/tests/commands/mcp.test.ts:54`, and cited in a doc comment in `apps/server/src/modules/mcp/protocol.ts:24` → all are in scope.
- The feature Notes cite "task NS1" for the tool-name grammar check → that task id does not exist; R3 here owns the check.

### Requirements

- [ ] R1. Rename the five tool descriptors and `callTool` cases to `sp_task_show`, `sp_task_list`, `sp_workflow_status`, `sp_workflow_run` and `sp_workflow_continue`.
- [ ] R2. A call to an old unprefixed name fails with a tool error naming its `sp_` replacement, e.g. `tool "task_show" was renamed to "sp_task_show"`. `tools/list` never lists an old name.
- [ ] R3. Verify the tool-name grammar against the MCP 2026-07-28 specification, then cite the section URL in `docs/design/embedded-mcp-server.md` §4. If `[a-z0-9_]` turns out to be narrower than the spec allows, keep it anyway and record that it was chosen deliberately.
- [ ] R4. Amend ADR-152 (`docs/00_ADR.md:2956`) with a dated amendment line and update the tool table in `docs/design/embedded-mcp-server.md` §4.

Out of scope: aliases for the old names, the project namespace for non-built-in tools (1380), and workflow tools (1381).

### Acceptance Criteria

- [ ] AC1 — Built-in harness tools carry the sp namespace (req: R1, R2, R3, R4)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
