---
schema_version: 1
name: MCP namespace and exposure diagnostics on the Integrations MCP tab
status: todo
template: issue
created_at: 2026-11-23T00:55:48.651Z
updated_at: "2026-11-23T00:55:48.801Z"
feature_id: A82

---

## 1438. MCP namespace and exposure diagnostics on the Integrations MCP tab

### Background

Captured from the creation title: "MCP namespace and exposure diagnostics on the Integrations MCP tab".

### Requirements

- [ ] R1. Add `namespace`, `namespaceSource` and `exposureIssues` to `integrationsMcpSurfaceSchema` (`packages/contracts/src/integrations.ts`) and populate them from `readMcpCatalog` (`apps/server/src/modules/mcp/index.ts`), which currently drops the `issues: McpExposureIssue[]` that `resolveExposedWorkflowTools` (`packages/app/src/services/mcp-workflow-tools.ts`) already returns.
- [ ] R2. Render the namespace, the exposure findings, a tool search box, the `spur mcp` / `spur mcp --gateway` stdio snippets, and a `server/discover` curl probe in `apps/web/src/modules/integrations/McpTab.tsx` (A82 design gap G1).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Extend the MCP surface contract with the namespace + exposure-issue fields (R1).
2. Thread the existing `McpExposureIssue[]` through `readMcpCatalog` instead of dropping it (R1).
3. Render namespace, exposure findings, tool search, CLI snippets and the discover probe in `McpTab` (R2).
4. Component test beside the existing `integrations-module.test.tsx` seams.

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
