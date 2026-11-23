---
schema_version: 1
name: Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors
status: todo
template: issue
created_at: 2026-11-23T00:55:53.073Z
updated_at: "2026-11-23T00:55:53.165Z"
feature_id: A82

---

## 1439. Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors

### Background

Captured from the creation title: "Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors".

### Requirements

- [ ] R1. Render the telemetry `integrations.usage` already returns — per-tool p50/p95, resources, `byActor`, per-member A2A counts, `authDenied` reasons and `failureClusters` (`packages/domain/src/analytics/protocol-usage.ts`) — in `SummaryTab.tsx`, and the per-surface slices in `McpTab`/`A2aTab`, instead of summing aggregates only.
- [ ] R2. Add `mcp`, `a2a` and `auth` to `PREFIX_COLORS` (`apps/web/src/modules/observability/SummaryTab.tsx`) and `PREFIX_COLOR_MAP` (`SystemEventsTab.tsx`) (A82 design gap G2).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Project the unused usage slices into the Summary tables (R1).
2. Render the per-tool and per-member detail in the MCP and A2A tabs (R1).
3. Add the three missing protocol prefixes to both color maps (R2).
4. Extend the module tests with the new rows and the color-map coverage.

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
