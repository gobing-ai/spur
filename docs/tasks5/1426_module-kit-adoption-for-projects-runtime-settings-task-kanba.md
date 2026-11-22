---
schema_version: 1
name: Module-kit adoption for projects, runtime, settings, task-kanban and search
status: done
template: feature-impl
created_at: 2026-11-22T02:21:07.473Z
updated_at: "2026-11-22T07:15:37.002Z"
feature_id: A83

tags: ["A83"]
dependencies: ["1424"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Projects, Settings and Tasks render `ModuleShell` > `ModuleHeader` (icon `<ModuleIcon id=… size="lg" />`, title, status where one exists today) > `ModuleTabs`, with tab ids from their existing `tabs` files. Search renders `ModuleShell` > `ModuleHeader` and has no tabs.
- [x] R2. Tasks' tab strip gains real tab semantics through `ModuleTabs` (`role="tab"`, `aria-selected`). "+ New Task" moves to the header `filters` slot, and its behavior is unchanged.
- [x] R3. Tab ids, URLs (Projects path segment `useProjectTab.ts`, Settings `useSettingsTab.ts`, Tasks `useTaskParams`), deep links and tab content are unchanged. The existing tests under `apps/web/tests/modules/{projects,settings,task-kanban,search}/` stay green unmodified, except selector updates where a test targeted the old hand-rolled header DOM.
- [x] R4. The Projects description becomes `'Fleet, inbox and database for this project'`, and the :9 comment names the Fleet/Inbox/Database tabs.
- [x] R5. None of the four module sources keeps a hand-built `<h1>` header or tab strip (`rg -n '<h1|role="tablist"' apps/web/src/modules/{projects,settings,task-kanban,search}` → only inside `module-kit`-rendered children, if any).

Out of scope: visual redesign, new tabs, the other four modules (1427), and icons (1428).

### Acceptance Criteria

- [x] AC1 — Every built-in Board module renders through the module-kit shell
- [x] AC2 — Module descriptions and comments match current tabs and modules

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

| File | Change | Why |
| --- | --- | --- |
| `apps/web/src/modules/settings/SettingsShell.tsx` | `ModuleShell` + `ModuleHeader` (icon/title/subtitle/`ModuleTabs`) | R1: the kit owns the rail and the one `h1`; arrow-key nav kept by a wrapper `onKeyDown` (no new kit prop) |
| `apps/web/src/modules/projects/ProjectsShell.tsx` | same migration; the degraded-state attribute moves onto a `role="status"` node in the header's `status` slot | R1 + the refine correction: `ModuleHeader` takes no rest props, so the attribute rides a slot node |
| `apps/web/src/modules/projects/index.tsx:9,23` | description → `Fleet, inbox and database for this project`; comment names the declared tabs | R4 |
| `apps/web/src/modules/task-kanban/TasksShell.tsx` | kit shell/header; the filter cluster + "+ New Task" move into `filters`; the hand-rolled segmented strip becomes `ModuleTabs` | R2: real `role="tab"`/`aria-selected`, identical behaviour and URL state |
| `apps/web/src/modules/search/index.tsx` | inline header replaced by `ModuleHeader` inside `ModuleShell`; body untouched | R1: no tabs, so no strip |
| `apps/web/tests/modules/{settings/SettingsShell,projects/ProjectsShell,task-kanban/TasksShell.kit,search/SearchShell}.test.tsx` | shell probe attribute, single `h1`, kit strip + `aria-selected`, deep-link selection, Projects description | Failing first; the four shells are now covered by their own tests |
| `apps/web/tests/modules/module-kit-adoption.test.ts` | source probe: no `<h1`/`role="tablist"` left in the migrated sources | R5, structural (a DOM test only sees the fixtures it mounts) |
| `apps/web/src/components/module-kit/ModuleTabs.tsx:34-50` | roving ArrowLeft/ArrowRight navigation with wrapping, inside the kit | The two migrated shells carried identical per-module handlers; a static wrapper tripped `noStaticElementInteractions`, and a copy per module is how strips drift. No new prop — the kit owns standard tablist keys |
| `apps/web/tests/components/module-kit.test.tsx` | arrow-key selection + wrapping tests | The kit change ships with its own test (A81 kit contract) |

Notes
- Tab ids, URLs, panel ids and content are unchanged: `useProjectTab` / `useSettingsTab` / `useTaskParams` still own the state, and `ModuleTabs` receives the same arrays (`idPrefix` keeps `projects-tab-<id>` / `settings-tab-<id>`).
- The Projects status node is `sr-only` when healthy: the old header printed the state attribute as a data hook only, so no visible text was added.
- Body layout stays module-owned (`className="projects h-full overflow-hidden"` etc. on `ModuleShell`), including Tasks' full-bleed board under a centred header.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 Projects, Settings, Tasks render `ModuleShell` > `ModuleHeader` (ModuleIcon lg, title, status) > `ModuleTabs`; Search renders shell + header, no tabs | MET | `apps/web/src/modules/projects/ProjectsShell.tsx:70-95`, `apps/web/src/modules/settings/SettingsShell.tsx:19-46`, `apps/web/src/modules/task-kanban/TasksShell.tsx:99-185`, `apps/web/src/modules/search/index.tsx:196-208` — `apps/web/tests/modules/{settings/SettingsShell,projects/ProjectsShell,task-kanban/TasksShell.kit,search/SearchShell}.test.tsx` (shell attribute, single `h1`, kit strip / no strip) |
| R2 Tasks' strip gains real tab semantics; "+ New Task" moves to `filters` with unchanged behaviour | MET | `apps/web/src/modules/task-kanban/TasksShell.tsx:150-182` (`ModuleTabs` + the button inside `filters`) — `TasksShell.kit.test.tsx` ("a real tab strip" asserts `aria-selected` on every tab; "+ New Task" still offered) |
| R3 tab ids, URLs, deep links and tab content unchanged; existing module tests green | MET | `useProjectTab` / `useSettingsTab` / `useTaskParams` untouched (`git diff` shows only shells + index.tsx + kit); `idPrefix` keeps `projects-tab-<id>` / `settings-tab-<id>`; `bun test tests/modules/{projects,settings,task-kanban,search}` → 155 pass, including the pre-existing suites |
| R4 Projects description and comment match the tabs | MET | `apps/web/src/modules/projects/index.tsx:9-10` (comment names Fleet/Inbox/Database), `:24` (`description: 'Fleet, inbox and database for this project'`) — `ProjectsShell.test.tsx` ("the module description names the surfaces it has") |
| R5 no migrated module keeps a hand-built `<h1>` or `role="tablist"` | MET | `apps/web/tests/modules/module-kit-adoption.test.ts` (source probe over the four sources: no `<h1`, no `role="tablist"`, kit import present) |
| Kit arrow-key navigation preserved without per-module duplication | MET | `apps/web/src/components/module-kit/ModuleTabs.tsx:38-58` (roving Left/Right with wrapping, focus follows) — `apps/web/tests/components/module-kit.test.tsx` (two new tests) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every built-in Board module renders through the module-kit shell | MET | test | `apps/web/tests/modules/module-kit-adoption.test.ts` + the four shell suites (this task covers projects, settings, tasks, search; designs/features/history/plans are 1427's scope and stay out of this verdict) |
| AC2 — Module descriptions and comments match current tabs and modules | MET | test | `ProjectsShell.test.tsx` description assertion + `projects/index.tsx:9-10,24` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:12.016Z backlog → todo (system)
- 2026-11-22T07:15:07.033Z todo → wip (system)
- 2026-11-22T07:15:34.389Z wip → testing (system)
- 2026-11-22T07:15:36.996Z testing → done (system)

