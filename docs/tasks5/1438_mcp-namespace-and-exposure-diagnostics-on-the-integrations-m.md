---
schema_version: 1
name: MCP namespace and exposure diagnostics on the Integrations MCP tab
status: todo
template: issue
created_at: 2026-11-23T00:55:48.651Z
updated_at: "2026-11-23T02:51:01.365Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
---

## 1438. MCP namespace and exposure diagnostics on the Integrations MCP tab

### Background

Task 1437 filed this as gap G1. `McpDispatcher` resolves the namespace before listing tools and discards the issue list from `resolveProjectWorkflowTools`; `readMcpCatalog` returns the tools and resources only. Integrations already lists tools/resources and shows an HTTP client snippet, while namespace provenance, exposure findings and tool filtering are absent from its MCP tab.

**Refine corrections (2026-11-22)**
- The issue list is discarded inside `McpDispatcher.exposedWorkflowTools()`, before `readMcpCatalog` sees it. Preserve the resolver result at that seam.
- The existing gateway namespace is a routing prefix. Keep it distinct from the workflow tool namespace and its provenance.
- The project and gateway stdio switches already exist. Their authentication settings come from separate sources.

### Requirements

- [ ] R1. Report the effective project workflow MCP namespace, its provenance and exposure findings on the existing Integrations status response. Continue to report the same advertised tools and resources.
- [ ] R2. In Integrations › MCP, show the namespace and actionable exposure findings, filter the advertised tool list, and offer copyable project and applicable gateway stdio examples plus a project `server/discover` probe using variable references.

Out of scope are changes to workflow exposure rules, MCP dispatch, gateway routing and the CLI command surface.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Catalog status explains workflow exposure (req: R1)
  Given fixtures with explicit config, a single valid plugin manifest and no namespace, and workflows refused for missing namespace or name collision
  When the server returns Integrations status and the project MCP catalog is listed
  Then status identifies the effective namespace source and refused exposures with remedies, and the advertised tool sets agree

Scenario: AC2 — MCP inspection and examples use the correct surface (req: R2)
  Given a gateway-prefixed project with advertised tools and one refused exposure
  When the operator opens MCP and filters by a partial tool name
  Then only matching tools remain, the exposure remedy remains visible, and the project probe and stdio examples point to their respective surfaces using credential variable names only
  And an off or standalone surface omits its unavailable command
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T02:50:59.794Z

Closed during refinement. Scope the search to advertised tool names, case-insensitive, and keep the catalog resources and exposure findings visible while filtering. Show a project probe only when the project endpoint exists. Show the gateway stdio command only when gateway MCP reports enabled.

### Design

Use the existing `resolveMcpNamespace` result in `apps/server/src/modules/mcp/index.ts`: explicit configuration, otherwise one valid manifest, otherwise null with source `none`. Keep the asynchronous readiness and existing resolver failure fallback. Reuse one `resolveProjectWorkflowTools` result per catalog read, preserving `listTools`, `tools/call`, resource and discovery behavior.

Add optional `namespace: string | null`, `namespaceSource: 'config' | 'plugin-manifest' | 'none'` and `exposureIssues` to `integrationsMcpSurfaceSchema` in `packages/contracts/src/integrations.ts`. Findings carry `tool`, `file` (project-relative display path, or basename for sources outside the checkout), `reason` and `remedy`. Carry them through `apps/server/src/modules/integrations/handlers.ts` and `packages/app/src/services/integrations-service.ts`; new servers populate the fields and older status responses remain readable. Use the existing tab components in `McpTab.tsx`. Show the protocol header and a JSON-RPC `server/discover` request using the status endpoint and the project auth variable. Use shell-safe quoting and validate variable names before generating expansions. The project example uses `spur mcp --url <project MCP URL>`; the gateway example uses `spur mcp --gateway` and its own auth configuration. Keep examples inert and feed them from status only.

1421 and 1423 supply the protocol catalog and status seam. Coordinate edits to `McpTab` with 1439, which adds usage rows independently.

### Plan

- [ ] R1. Add a server status regression in `apps/server/tests/modules/integrations/handlers.test.ts` with real fixture workflows; exercise namespace precedence, refused exposure and agreement with the protocol catalog, then extend the existing status projection.
- [ ] R2. Extend `apps/web/tests/modules/integrations/integrations-module.test.tsx` to exercise filter, no-match, off and gateway-prefixed examples with fake auth names, then add the MCP UI.
- [ ] R1–R2. Run the affected workspace tests and extend the existing browser/E2E Integrations proof with namespace, diagnostic and command rendering assertions. Run with a Board build from the same tree as the served API, and record the command and receipt. Update the Integrations design satellite alongside its contract change.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
