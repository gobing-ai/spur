---
schema_version: 1
name: Module-kit adoption for projects, runtime, settings, task-kanban and search
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:07.473Z
updated_at: "2026-11-22T04:12:03.880Z"
feature_id: A83

tags: ["A83"]
dependencies: ["1424"]
priority: P2
estimate_hours: 6
---

## 1426. Module-kit adoption for projects, runtime, settings, task-kanban and search

### Background

Implements: R1 — Every built-in Board module renders through the module-kit shell; R4 — Module descriptions and comments match current tabs and modules.

Follows DESIGN.md "Product UI — Module Shell" and the A81 module-kit (`apps/web/src/components/module-kit/`). Observability is the reference composition (`apps/web/src/modules/observability/ObservabilityShell.tsx`). Read DESIGN.md before starting.

**Refine corrections (2026-11-21)**
- Background read "Implements: R1 R4 — ." and AC1 was blank → both now name the feature scenarios R1 and R4.
- "runtime" is not a Board module. `apps/web/src/modules/runtime/` holds only `manifest.ts`, the board runtime/import-map manifest with no `WebModule`. The built-in modules are the nine with an `index.tsx` `module` export: designs, features, history, observability, plans, projects, search, settings, tasks (`task-kanban` dir, id `tasks`). → this task owns **projects, settings, tasks, search**; 1427 owns designs, features, history, plans.
- Current shells, none of which imports `module-kit`:
  - `ProjectsShell.tsx` (127 lines): own `<h1>` and `role="tablist"`.
  - `SettingsShell.tsx` (92): own `<h1>` and `role="tablist"`.
  - `TasksShell.tsx` (223): own `<h1>` at :107 and a segmented button strip at :183 with **no** tab roles, plus a "+ New Task" action.
  - `search/index.tsx` (339): an inline `<h1>` at :201, no tabs, and no separate shell file.
- Stale metadata: `projects/index.tsx:9` says "Conversation and Processes tabs" and :23 says `description: 'Conversation and processes for this project'`. The tabs are `fleet|inbox|database` (`projects/tabs.tsx:7`). The `order` comment (:10-14) names Workspace/Inbox/Teams as deleted, which is accurate history, so it stays. `task-kanban/index.tsx:19` says the Workspace module "was retired", also accurate.
- `data-projects-*` / `data-settings-*` attributes are read only by their own shells, not by tests. `ModuleHeader` takes no rest props (`module-kit/ModuleHeader.tsx:28`), so the degraded-state attribute moves onto the `status` node.
- The 1424 dependency is ordering only: Integrations becomes a second kit reference. This task does not consume any 1424 output.

### Requirements

- [ ] R1. Projects, Settings and Tasks render `ModuleShell` > `ModuleHeader` (icon `<ModuleIcon id=… size="lg" />`, title, status where one exists today) > `ModuleTabs`, with tab ids from their existing `tabs` files. Search renders `ModuleShell` > `ModuleHeader` and has no tabs.
- [ ] R2. Tasks' tab strip gains real tab semantics through `ModuleTabs` (`role="tab"`, `aria-selected`). "+ New Task" moves to the header `filters` slot, and its behavior is unchanged.
- [ ] R3. Tab ids, URLs (Projects path segment `useProjectTab.ts`, Settings `useSettingsTab.ts`, Tasks `useTaskParams`), deep links and tab content are unchanged. The existing tests under `apps/web/tests/modules/{projects,settings,task-kanban,search}/` stay green unmodified, except selector updates where a test targeted the old hand-rolled header DOM.
- [ ] R4. The Projects description becomes `'Fleet, inbox and database for this project'`, and the :9 comment names the Fleet/Inbox/Database tabs.
- [ ] R5. None of the four module sources keeps a hand-built `<h1>` header or tab strip (`rg -n '<h1|role="tablist"' apps/web/src/modules/{projects,settings,task-kanban,search}` → only inside `module-kit`-rendered children, if any).

Out of scope: visual redesign, new tabs, the other four modules (1427), and icons (1428).

### Acceptance Criteria

- [ ] AC1 — Every built-in Board module renders through the module-kit shell
- [ ] AC2 — Module descriptions and comments match current tabs and modules

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:12:03.533Z

- **Closed: Tasks segmented control → ModuleTabs.** Yes. It switches views like any tab strip, and the kit's tab semantics fix a real a11y gap (no `role="tab"` today). The look follows the kit.
- **Closed: historical "deleted/retired" comments.** Keep them. They are accurate provenance, not references to live modules. R4 targets only comments that describe the current surface wrongly.
- **Closed: dependency on 1424.** Keep it as ordering only, so Integrations lands first as the second reference. It is not a technical blocker.

### Design

- **Pattern per module**, the same as ObservabilityShell: `<ModuleShell data-<module>-shell><ModuleHeader icon title status filters tabs={<ModuleTabs tabs value onChange label idPrefix />} />{active}</ModuleShell>`. `ModuleTabs` needs `{id,label}`, and the existing tabs arrays already carry both.
- **Projects:** the dominant-state header logic (`ProjectsShell.tsx:9-12`, first-match degraded fact) renders in `status` as one `role="status"` node with `data-projects-state`. The multi-line facts stay below the header as today.
- **Tasks:** `filters` = the existing filter controls + "+ New Task". `TaskKanbanView` (headerless, embeddable) is untouched.
- **Search:** extract nothing. Wrap the existing body in `ModuleShell` and replace the inline header with `ModuleHeader`.
- **Frozen:** all tab ids, routes, `useProjectTab`/`useSettingsTab`/`useTaskParams` contracts, and `TaskKanbanView` export.
- **Anti-patterns:** no new kit props for one module (pass ReactNode into slots instead); no hex/raw palette classes; no route renames; no edits to `module-kit/` except a bug fix with its own test.
- **Leaves for 1427/1430:** the four shells carry `data-<module>-shell` on `ModuleShell`, which 1430 uses as its per-module shell probe (designs/features/history/plans add theirs in 1427).

### Plan

Premises (verified 2026-11-21):
- Kit API: `ModuleShell` spreads rest props (`ModuleShell.tsx:21`); `ModuleHeader` slots `icon,title,subtitle,status,filters,tabs` (`ModuleHeader.tsx:28`); `ModuleTabs` `{tabs,value,onChange,label,idPrefix}` (`ModuleTabs.tsx:8-21`).
- Hand-rolled headers: `ProjectsShell.tsx`, `SettingsShell.tsx`, `TasksShell.tsx:107,183`, `search/index.tsx:201`.
- Stale description: `apps/web/src/modules/projects/index.tsx:9,23`.

- [ ] 1. Failure modes to test per module: the tab click changes the URL as before; a deep link opens the right tab; the shell probe attribute is present; there are no duplicate `<h1>`; Tasks tabs expose `role="tab"`; the Projects degraded state still shows.
- [ ] 2. Add or extend tests in `apps/web/tests/modules/{projects,settings,task-kanban,search}/`: assert `[data-<module>-shell]`, `role="tablist"` from the kit, deep-link tab selection, and the Projects description string. Run them; they fail on the kit assertions.
- [ ] 3. Migrate Settings (smallest), then Projects, then Tasks, then Search. Run the module tests after each.
- [ ] 4. Fix the Projects description and comment.
- [ ] 5. Browser-check the four modules in light and dark at 375px and desktop width. Then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:12.016Z backlog → todo (system)

