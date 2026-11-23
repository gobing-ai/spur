---
schema_version: 1
name: Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors
status: todo
template: issue
created_at: 2026-11-23T00:55:53.073Z
updated_at: "2026-11-23T02:51:08.334Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
---

## 1439. Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors

### Background

Task 1437 filed this as gap G2. `integrationsUsageSchema` already carries six detailed usage arrays from `protocolUsageSummary`. `SummaryTab` reduces tool and A2A rows to totals, while `McpTab` and `A2aTab` receive recent events and omit the aggregate detail. Observability Summary hashes unknown prefixes into a palette; System Events uses a muted fallback for unknown prefixes.

**Refine corrections (2026-11-22)**
- Surface detail belongs to the existing windowed usage response. A2A member counts describe received, replayed, conflicted and cancelled intake; the contract supplies no per-member outbound counters.
- The two Observability views use different rendering formats. Map the three protocol prefixes explicitly in both views using equivalent theme tokens.

### Requirements

- [ ] R1. Show the selected window's tool latency and unmeasured durations, resource reads, actor attribution, incoming A2A counts, auth refusals by surface/reason and repeated tool failures. Present tool/resource/failure detail on MCP and inbound member/A2A refusal detail on A2A.
- [ ] R2. Give `mcp`, `a2a` and `auth` explicit, consistent, distinguishable colors in Observability Summary and System Events and keep visible text labels.

Out of scope are new API fields, ledger queries, live polling and changes to metrics definitions.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Integrations shows the selected usage window in each view (req: R1)
  Given two usage windows with different tool, resource, actor, member, denial and failure-cluster rows, including null latency and unmeasured calls
  When the operator opens Summary, MCP and A2A and selects the other window
  Then the detail updates to the selected window, nullable latencies remain unavailable, unmeasured calls are counted, and empty slices have an empty state

Scenario: AC2 — Protocol event prefixes use named colors in both Observability views (req: R2)
  Given Observability fixtures for mcp, a2a, auth and an uncatalogued prefix
  When the operator opens Summary and System Events
  Then each protocol prefix has a distinct matched theme color and visible text, while the uncatalogued prefix retains the existing fallback
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T02:51:06.766Z

Closed during refinement. Summary shows all six slices. MCP and A2A show the relevant subsets, with refusal rows scoped by their reported surface. Preserve returned ordering and distinguish missing values from measured zero.

### Design

Pass `data.usage` from `IntegrationsModule.tsx` through the existing props to `SummaryTab`, `McpTab` and `A2aTab`. Use the contract's tool, resource, actor, A2A, refusal and cluster rows directly. Keep Summary surface totals, display measured latency in milliseconds and render null as an em dash. Include cluster tool/code/count and time range. Use the existing module-kit and the existing usage window; no new API or event classifier.

Extend `PREFIX_COLORS` and `PREFIX_COLOR_MAP` with MCP using info, A2A using success and auth using error. Use the corresponding computed CSS color for the chart and text utility for the event label, preserving unrelated prefixes and fallback behavior. Confirm light/dark readability with existing design tokens. 1423 supplies the usage contract; coordinate work in `McpTab` with 1438 and `A2aTab` with 1440.

### Plan

- [ ] R1. Add selected-window and missing-metric cases to `apps/web/tests/modules/integrations/integrations-module.test.tsx`; wire the existing usage data into the views.
- [ ] R2. Add rendered protocol-prefix assertions to the Observability test coverage (`apps/web/tests/modules/observability.test.ts` and `apps/web/tests/modules/observability/system-events-tab.test.ts`); update the two existing mappings.
- [ ] R1–R2. Run the focused web suite and extend the Integrations browser proof with a populated window and theme assertions. Record the repeatable command and artifact.

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
