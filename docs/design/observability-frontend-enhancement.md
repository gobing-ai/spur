---
doc: design/observability-frontend-enhancement
feature_id: J92
tasks: [0651, 0652, 0653, 0654]
owns: SURFACE + mechanism for the Observability Board module (unified header, customizable event table, and tab consolidation)
authority: derived (ADR wins on conflict)
updated_at: 2026-08-24
---

# Observability Board module — Frontend Enhancement & Tab Consolidation

Feature **J92** modernizes the `Observability` module in the Spur Board (`apps/web`) to match the clean, cohesive layout established in the `History` module. It unifies the module header, adds a flexible time-range selector and action button bar, consolidates tabs into high-signal surfaces (`System Events`, redesigned `Jobs`, preserved `Routing`, dropping obsolete `Tasks` and `Tool Using`), provides customizable and sortable table columns, and refines cell presentation ergonomics.

---

## 1. Design Objectives & Principles

1. **Header Consistency:** Align with the History module header pattern (`max-w-[1600px] mx-auto w-full`, icon `📡`, title `Observability`, subtitle, and a live connection chip with rolling rate and latest-event time on the left; tab navigation in a pill container on the right).
2. **Tab Simplification:**
   - **`System Events`**: Primary real-time SSE + SQLite historical telemetry log (kept and enhanced).
   - **`Jobs`**: Show current queue-state metrics plus a focused queue/scheduler event feed.
   - **`Routing`**: Attributed role routing & token consumption (preserved strictly as-is for future dedicated iteration).
   - **`Tasks` & `Tool Using`**: Dropped from tabs (tasks/workflows are tracked on Kanban; tool-using telemetry is now in the History module).
3. **Ergonomic Filter & Time Bar:** Replace the cluttered 3-row toolbar with a unified time-range selector (`30s`, `5m`, `1h`, `24h`, `7d`, `All`) and right-side Column Customizer, Popover Filters, and Live stream controls. A bounded Custom range remains deferred until `/api/events/history` accepts an indexed upper `until` bound.
4. **Customizable & Sortable Table:**
   - Column visibility customization with `localStorage` persistence (`spur:observability:columns:v1`).
   - Default visible columns: `Time`, `Severity`, `Event`, `Summary`, `Correlation`, `Outcome` (with `Agent`, `Producer`, `Action`, `Actor` toggleable).
   - Value sorting across columns with visual sort direction indicators (`▲`/`▼`).
   - Polished cell rendering (colored severity badges, monospace typography, copy actions, expandable tooltips).

---

## 2. Component Architecture (`apps/web`)

```
apps/web/src/modules/observability/
├── index.tsx                  # WebModule registration ('observability', icon '📡', order 4)
├── tabs.ts                    # Tab registry and shared liveness/range prop contract
├── ObservabilityShell.tsx     # Module shell container (max-w-[1600px], header, tab strip)
├── ObservabilityFilters.tsx   # Time-range bar + right-aligned action buttons (columns, filters, live)
├── ColumnCustomizer.tsx       # Popover dropdown to toggle column visibility with localStorage persistence
├── SystemEventsTab.tsx        # System events coordinator: SSE stream + history query + sort state + in-file table & row rendering
├── JobsTab.tsx                # Current queue KPI cards + queue/scheduler event list
└── RoutingTab.tsx             # Preserved as-is (untouched)
```

---

## 3. Tab Structure & Registration

```ts
export type ObservabilityTimeRange = '30s' | '5m' | '1h' | '24h' | '7d' | 'all';

export interface ObservabilityLiveness {
    status: 'connecting' | 'live' | 'errored' | 'paused';
    rate: number;
    lastEventAt: string | null;
}

export interface ObservabilityTabProps {
    onLivenessChange?: (next: ObservabilityLiveness) => void;
    timeRange?: ObservabilityTimeRange;
    onTimeRangeChange?: (next: ObservabilityTimeRange) => void;
}

export interface ObservabilityTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType<ObservabilityTabProps>;
}

export const OBSERVABILITY_TABS: readonly ObservabilityTab[] = [
    { id: 'system-events', label: 'System Events', component: SystemEventsTab },
    { id: 'jobs', label: 'Jobs', component: JobsTab },
    { id: 'routing', label: 'Routing', component: RoutingTab },
];
```

*Note: Legacy tabs `tasks` and `tool-using` are removed from the active tab list.*

---

## 4. Column Customizer & Sorting Contract

### 4.1 Column Definitions

| Column Key | Label | Default Visible | Width | Sortable |
| :--- | :--- | :--- | :--- | :--- |
| `time` | Time | **Yes** | `w-36` | Yes (timestamp) |
| `severity` | Severity | **Yes** | `w-24` | Yes (info < warning < error) |
| `event` | Event | **Yes** | `w-[15%]` | Yes (alphabetical) |
| `summary` | Summary | **Yes** | `w-[20%]` | Yes (alphabetical) |
| `correlation` | Correlation | **Yes** | `w-[16%]` | Yes (string) |
| `outcome` | Outcome | **Yes** | `w-28` | Yes (status) |
| `agent` | Agent | Optional | `w-28` | Yes (executor name) |
| `producer` | Producer | Optional | `w-[16%]` | No |
| `action` | Action | Optional | `w-[15%]` | No |
| `actor` | Actor | Optional | `w-24` | No |

### 4.2 State & Persistence

- Key: `localStorage.getItem('spur:observability:columns:v1')`
- Schema: `string[]` of active column keys.
- Fallback: `['time', 'severity', 'event', 'summary', 'correlation', 'outcome']`

---

## 5. Responsive Behavior

- **Desktop ($\ge$ 640px):** Full table rendering active visible columns with sticky `<thead>`.
- **Mobile (< 640px):** Collapsed view showing `Time` and `Event` with stacked secondary metadata, retaining expand-for-payload detail drawer.
