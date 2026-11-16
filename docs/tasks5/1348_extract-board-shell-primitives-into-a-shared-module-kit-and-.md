---
schema_version: 1
name: Extract Board shell primitives into a shared module kit and adopt them in a built-in shell
status: todo
template: feature-impl
created_at: 2026-11-16T19:08:27.314Z
updated_at: "2026-11-16T19:36:23.971Z"
feature_id: A81
priority: P1
tags:
  - board
  - web
  - refactor

estimate_hours: 5
---

## 1348. Extract Board shell primitives into a shared module kit and adopt them in a built-in shell

### Background

Implements: R2 — Built-in shells render through shared shell primitives without visual regression.

Built-in shells inline their ADR-081 header/tab markup and keep TimeRangePresets module-private, so nothing reusable exists to share. Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md) §3.1 and §4 export set. Prerequisite for the facade task.

Rubric: E5 D1 L1 C0 R1 = 8 → own task (regression risk on built-in shells).


**Refine corrections (2026-11-16)**
- "Extract EmptyState / Diagnostic from existing usage" → no shared EmptyState exists; empty states are inline per tab (e.g. apps/web/src/modules/observability/JobsTab.tsx:304), and the diagnostic presentation is `ModuleDiagnostic` (apps/web/src/components/ModuleErrorBoundary.tsx:31) → EmptyState lifts the JobsTab markup; `Diagnostic` is a context-free presentational wrapper reused by `ModuleDiagnostic`.
- "Observability is smallest" confirmed: ObservabilityShell.tsx is 160 lines (TasksShell 223, HistoryShell 678).
- `Loading`, `Card`, `Badge`, `Button` confirmed in apps/web/src/components/ui/.

### Requirements

- [ ] R1. Create apps/web/src/components/module-kit/index.ts exporting ModuleShell, ModuleHeader, ModuleTabs, TimeRangePresets (moved from observability/ObservabilityFilters.tsx), EmptyState (from JobsTab empty markup), Diagnostic (presentational core of ModuleDiagnostic), and re-exports of Loading, Card, Badge, Button; out of scope: adopting the kit in shells other than Observability.
- [ ] R2. Components are presentational and controlled: no host context, router, rpc or registry imports; URL state stays in callers.
- [ ] R3. At least one built-in shell (Observability recommended; smallest) renders through the kit with unchanged layout, a11y roles and URL state.
- [ ] R4. Existing shell tests pass unchanged; add kit tests for tab keyboard/aria behavior and controlled change callbacks.

### Acceptance Criteria

- [ ] AC1 — Built-in shells render through shared shell primitives without visual regression

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:15.789Z

- **Closed:** Observability adopts the kit first (smallest shell, 160 lines); other built-in shells adopt opportunistically, not in this task.
- **Closed:** kit components are controlled and context-free because contributions share React but not host context (downstream design §6.6).

### Design

Approach: lift the exact markup/classes from ObservabilityShell header + tab strip and observability TimeRangePresets into props-driven components; Observability adopts first, others may follow.
Rejected: new restyled components (would change built-in visuals and widen scope); context-based API (contributions do not share host context).
Invariants: props are the public contract, not class names; no visual change to adopting shells; Tailwind classes stay inside apps/web/src so the host CSS build includes them.
Key signatures: ModuleHeader({icon,title,subtitle?,status?,filters?,tabs?}); ModuleTabs({tabs,value,onChange,label}).

Frozen names: directory `apps/web/src/components/module-kit/`, barrel `index.ts`; exports exactly ModuleShell, ModuleHeader, ModuleTabs, TimeRangePresets, EmptyState, Diagnostic, Loading, Card, Badge, Button. `ObservabilityFilters.tsx` re-imports TimeRangePresets from the kit (no duplicate).
Anti-patterns: no `useSearchParams`, rpc, registry or theme context inside module-kit; no new styles.
Leaves for 1349: a barrel with value exports only (no default export) so the facade can re-export it by name.

### Plan

1. Create module-kit components from existing markup
2. Re-export Card/Badge/Button
3. Switch ObservabilityShell to the kit
4. Kit tests + existing shell tests
5. Browser-check Observability in both themes

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
