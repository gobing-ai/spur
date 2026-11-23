---
schema_version: 1
name: Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors
status: done
template: issue
created_at: 2026-11-23T00:55:53.073Z
updated_at: "2026-11-23T06:14:44.427Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1439. Render per-tool protocol telemetry and the mcp/a2a/auth prefix colors

### Background

Task 1437 filed this as gap G2. `integrationsUsageSchema` already carries six detailed usage arrays from `protocolUsageSummary`. `SummaryTab` reduces tool and A2A rows to totals, while `McpTab` and `A2aTab` receive recent events and omit the aggregate detail. Observability Summary hashes unknown prefixes into a palette; System Events uses a muted fallback for unknown prefixes.

**Refine corrections (2026-11-22)**
- Surface detail belongs to the existing windowed usage response. A2A member counts describe received, replayed, conflicted and cancelled intake; the contract supplies no per-member outbound counters.
- The two Observability views use different rendering formats. Map the three protocol prefixes explicitly in both views using equivalent theme tokens.

### Requirements

- [x] R1. Show the selected window's tool latency and unmeasured durations, resource reads, actor attribution, incoming A2A counts, auth refusals by surface/reason and repeated tool failures. Present tool/resource/failure detail on MCP and inbound member/A2A refusal detail on A2A.
- [x] R2. Give `mcp`, `a2a` and `auth` explicit, consistent, distinguishable colors in Observability Summary and System Events and keep visible text labels.

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/modules/integrations/SummaryTab.tsx` | 1–5, 186–210, 300–420 | A local `Slice` card renders the window's six usage slices — tool latency, resource reads, actor attribution, A2A intake, auth refusals, repeated failures — each with its own empty state, so a window with no rows explains itself instead of showing a bare header. |
| `apps/web/src/modules/integrations/McpTab.tsx` | 1–20, 30–50, 220–300 | Carries the MCP subsets of the same window: tool latency with unmeasured calls counted, resource reads, and repeated `(tool, errorCode)` failures with their range. |
| `apps/web/src/modules/integrations/A2aTab.tsx` | 1–5, 12–30, 70–130 | Carries the inbound per-member intake and only this surface's auth refusals — an `mcp` denial stays on the MCP tab. |
| `apps/web/src/modules/integrations/helpers.ts` | 118–140 | `formatLatency` (a null percentile is `—`, never `0ms`), `unmeasuredLabel` and `clusterRange`: the three formatters the tabs share, so the missing-vs-zero rule lives in one place. |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx` | 128–142 | Passes the hook's existing `usage` to the MCP and A2A tabs — no new read, no new endpoint. |
| `apps/web/src/modules/observability/SummaryTab.tsx` | 18–36, 48–50 | `mcp` / `a2a` / `auth` map to `var(--color-spur-info|success|error)`, so the chart follows the theme; `prefixColor` is exported for the mapping assertion. |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | 125–146 | The same three prefixes map to `text-spur-info|success|error`; every other prefix and the muted fallback are unchanged; `prefixColorClass` is exported for the assertion. |
| `apps/web/tests/modules/integrations/integrations-module.test.tsx` | 165–200, 505–610 | R1 regression: all six slices on Summary, a window switch that replaces the detail, `—` for a null percentile with `4 unmeasured`, and the MCP/A2A subsets including the surface-scoped refusals. |
| `apps/web/tests/modules/observability/system-events-tab.test.ts` | 470–490 | R2 regression: the three prefixes resolve to distinct theme tokens and an uncatalogued prefix keeps the muted fallback. |
| `apps/web/tests/modules/observability.test.ts` | 60–75 | R2 regression: the Summary chart's three prefixes are distinct theme colors and an unknown prefix still hashes into the palette. |
| `apps/web/tests/modules/integrations-browser.heavy.test.ts` | 60–80 | The live Board leg asserts the populated tool-latency slice from the run's own MCP calls. |
| `docs/design/integrations-module.md` | 130–160 | Tab contents and the protocol-prefix color rule recorded beside the surface change (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:597` — The six Summary slices render and update by selected window. MCP and A2A subsets render at lines 633 and 647. |
| R2 | MET | `apps/web/tests/modules/observability.test.ts:68` — Summary resolves distinct theme tokens. System Events uses named styles and preserves its fallback at apps/web/tests/modules/observability/system-events-tab.test.ts:451. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Integrations shows the selected usage window in each view (req: R1) | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:597` — The six Summary slices render and update by selected window. MCP and A2A subsets render at lines 633 and 647. |
| AC2 — Protocol event prefixes use named colors in both Observability views (req: R2) | MET | test | `apps/web/tests/modules/observability.test.ts:68` — Summary resolves distinct theme tokens. System Events uses named styles and preserves its fallback at apps/web/tests/modules/observability/system-events-tab.test.ts:451. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| F1 | P4 | `apps/web/src/modules/integrations/SummaryTab.tsx:186-210` | `Slice` is a local presentational helper rather than a module-kit export. Six cards justify it here; promote it only if a second module needs the same shape. |
| F2 | P4 | `apps/web/tests/modules/observability*.test.ts` | The prefix assertions exercise the same resolver the views call rather than a mounted chart; mounting the Observability Summary needs the full observability fixture set, which this task does not own. The rendered label and its class are unchanged. |
| F3 | P4 | `apps/web/tests/modules/integrations-browser.heavy.test.ts:60-80` | The populated-window assertion was added but not executed in this run (needs a served project plus a Board build — the feature-scope heavy pass). |

SECUA: no new API field, ledger query or polling; the missing-vs-zero distinction is centralized in `formatLatency`/`unmeasuredLabel`; the prefix map keeps every existing entry and its fallback, and color is never the only signal.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T03:50:09.312Z todo → wip (system)
- 2026-11-23T03:50:44.502Z wip → testing (system)
- 2026-11-23T03:50:46.321Z testing → done (system)

