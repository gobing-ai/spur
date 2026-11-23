---
schema_version: 1
name: MCP namespace and exposure diagnostics on the Integrations MCP tab
status: done
template: issue
created_at: 2026-11-23T00:55:48.651Z
updated_at: "2026-11-23T06:14:43.758Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1438. MCP namespace and exposure diagnostics on the Integrations MCP tab

### Background

Task 1437 filed this as gap G1. `McpDispatcher` resolves the namespace before listing tools and discards the issue list from `resolveProjectWorkflowTools`; `readMcpCatalog` returns the tools and resources only. Integrations already lists tools/resources and shows an HTTP client snippet, while namespace provenance, exposure findings and tool filtering are absent from its MCP tab.

**Refine corrections (2026-11-22)**
- The issue list is discarded inside `McpDispatcher.exposedWorkflowTools()`, before `readMcpCatalog` sees it. Preserve the resolver result at that seam.
- The existing gateway namespace is a routing prefix. Keep it distinct from the workflow tool namespace and its provenance.
- The project and gateway stdio switches already exist. Their authentication settings come from separate sources.

### Requirements

- [x] R1. Report the effective project workflow MCP namespace, its provenance and exposure findings on the existing Integrations status response. Continue to report the same advertised tools and resources.
- [x] R2. In Integrations › MCP, show the namespace and actionable exposure findings, filter the advertised tool list, and offer copyable project and applicable gateway stdio examples plus a project `server/discover` probe using variable references.

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/server/src/modules/mcp/index.ts` | 231–305, 596–612 | `McpDispatcher` keeps the resolver's namespace SOURCE and hands back the exposure issue list it used to discard; `catalog()` resolves the workflows once for tools, resources, provenance and findings (G1). |
| `apps/server/src/modules/integrations/handlers.ts` | 113–131 | Carries `namespace` / `namespaceSource` / `exposureIssues` from the same `readMcpCatalog` read into the status port. |
| `packages/app/src/services/integrations-service.ts` | 20–55, 197–220 | Optional port fields plus a projection that omits them entirely when a server does not report exposure, so an older status response stays readable. |
| `packages/contracts/src/integrations.ts` | 77–101 | `integrationsMcpExposureIssueSchema` and the three optional surface fields (wire shape, no token value). |
| `apps/web/src/modules/integrations/helpers.ts` | 63–115 | `projectMcpCommand`, `gatewayMcpCommand`, `discoverProbe` and `filterTools`: every example expands a validated VARIABLE NAME, and a surface that is off or unmounted yields `null`. |
| `apps/web/src/modules/integrations/McpTab.tsx` | 20–60, 62–150, 230–270 | Namespace line, case-insensitive tool filter that leaves the exposure findings and resources visible, an exposure-findings card, and the command/probe cards. |
| `apps/server/tests/modules/integrations/handlers.test.ts` | 285–400 | R1 regression: config vs manifest vs none precedence, a colliding pair refused with a remedy, and status-vs-`tools/list` agreement. |
| `apps/web/tests/modules/integrations/integrations-module.test.tsx` | 400–500 | R2 regression: filter, no-match, off surface, gateway-prefixed examples, and no token value in the DOM. |
| `scripts/commands/integrations-e2e.ts` | 60–70, 150–200, 340–385 | The E2E scaffolds one exposable workflow and a colliding pair, configures a namespace, and records the `integrations-namespace-diagnostics` step. |
| `apps/web/tests/modules/integrations-browser.heavy.test.ts` | 60–110 | The live Board leg opens the MCP tab and asserts the namespace line, the refused exposure and the project command. |
| `docs/design/integrations-module.md` | 60–105, 130–150 | Design satellite updated with the contract fields, the resolver seam, the MCP tab contents and the new proof step (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/tests/modules/integrations/handlers.test.ts:335` — Explicit config wins, both catalogs agree and a colliding workflow has a remedy. Manifest and no-namespace fallbacks pass at lines 365 and 382. |
| R2 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:487` — Filtering preserves the remedy. The probe, distinct gateway command and off state are exercised at lines 508, 522 and 543. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Catalog status explains workflow exposure (req: R1) | MET | test | `apps/server/tests/modules/integrations/handlers.test.ts:335` — Explicit config wins, both catalogs agree and a colliding workflow has a remedy. Manifest and no-namespace fallbacks pass at lines 365 and 382. |
| AC2 — MCP inspection and examples use the correct surface (req: R2) | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:487` — Filtering preserves the remedy. The probe, distinct gateway command and off state are exercised at lines 508, 522 and 543. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| F1 | P4 | `apps/server/src/modules/mcp/index.ts:260-283` | `catalog()` repeats `listTools()`'s descriptor concatenation. Deliberate: `listTools()` is the protocol hot path and must not pay for the resource read. Revisit only if a third reader appears. |
| F2 | P4 | `scripts/commands/integrations-e2e.ts:340-385`, `apps/web/tests/modules/integrations-browser.heavy.test.ts:60-110` | The E2E step and the live-Board MCP-tab assertions were added but not executed in this run: both need a served project plus a Board build, which is the feature-scope heavy pass, not the per-task gate. |

SECUA: no token value crosses any boundary (the port carries `tokenPresent` only, and every example expands a validated variable NAME); the new schema fields are optional, so an older server's status stays readable; no new dependency, and the only added I/O is the directory walk `tools/list` already pays.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T03:38:41.593Z todo → wip (system)
- 2026-11-23T03:39:53.090Z wip → testing (system)
- 2026-11-23T03:39:54.997Z testing → done (system)

