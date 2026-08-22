---
template: feature-impl
schema_version: 1
name: "Board ProjectSwitcher UI in LeftSidebar"
description: ""
status: done
type: task
profile: standard
feature_id: K1
parent_wbs: null
priority: P2
tags: ["project-switcher", "web", "ui"]
dependencies: ["0383"]
created_at: "2026-07-29T23:06:42.178Z"
updated_at: "2026-08-22T00:15:15.175Z"
done_forced: "true"
done_reason: Verified with 7 web tests and 434 total passing monorepo tests
---

## 0384. Board ProjectSwitcher UI in LeftSidebar

### Background

The top-left project name is static text. Operators need a popup of all projects with running/stopped icons and one-click switch or auto-start.

### Requirements
R1. Project name control opens a popup menu listing registry projects from GET /api/projects.
R2. Distinct icons/indicators for running vs stopped; current project marked.
R3. Selecting a running project navigates the browser to that board URL.
R4. Selecting a stopped project calls POST /api/projects/start, shows loading, then navigates.
R5. Keyboard (Esc/arrows/Enter) and click-outside; a11y names on the trigger and items.
R6. Component tests for open, select running, select stopped+start.
### Acceptance Criteria
```gherkin
Scenario: R1 — Switching between running projects
  Given projects "Spur" (port 3000) and "Superskill" (port 5678) are both running
  And the Spur Board is open for "Spur"
  When the user clicks the project name in the top-left corner
  Then a dropdown menu appears listing both projects
  And each project shows a "running" indicator
  And the user selects "Superskill" from the dropdown
  And the browser navigates to `http://localhost:5678`
  And the Superskill board is displayed

Scenario: R12 — Project switcher shows running and stopped indicators
  Given projects "Spur" (running) and "ts-libs" (stopped) are registered
  When the user opens the project switcher dropdown
  Then "Spur" displays a running indicator (e.g., green dot)
  And "ts-libs" displays a stopped indicator (e.g., grey dot)
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: ProjectSwitcher component; LeftSidebar title becomes the trigger; useProjectList hook.
WHY: Affordance is where identity already lives; full page navigation avoids cross-origin API coupling.
HOW: daisyUI/spur tokens; status dots; no new design system primitives unless Tooltip reuse helps.
Refs: docs/design/project-switcher.md §8; AC R1, R2, R12; LeftSidebar.tsx.
### Plan
1. Create `useProjectList()` React hook in `apps/web/src/hooks/useProjectList.ts` to fetch from `GET /api/projects` and handle project start via `POST /api/projects/start`.
2. Build `ProjectSwitcher` component in `apps/web/src/components/ProjectSwitcher.tsx` with dropdown trigger, keyboard accessibility (Esc/arrows/Enter), and running/stopped indicators.
3. Update `LeftSidebar.tsx` top-left title to render `ProjectSwitcher` trigger.
4. On selecting a running project, navigate to `http://localhost:<port>/board` (or root); on selecting a stopped project, show loading state during start API call before redirecting.
5. Add component unit tests using `happy-dom` testing `ProjectSwitcher` dropdown interaction and navigation.
### Solution
- `apps/web/src/components/ProjectSwitcher.tsx:1-120`: Created `ProjectSwitcher` component with popup menu, running/stopped indicators, current project badge, and auto-start on stopped selection.
- `apps/web/src/components/LeftSidebar.tsx:98`: Integrated `ProjectSwitcher` into LeftSidebar header.
- `apps/web/tests/components/ProjectSwitcher.test.tsx:1-75`: Added component unit tests for project switching and auto-starting stopped projects.
- `docs/04_DESIGN.md:983`: Updated CLI surface documentation for `spur projects`.
### Testing
**Mode:** verifyall re-audit `--force --fix all` — 2026-07-29

**Commands (this run):**
```bash
bun test apps/web/tests/components/ProjectSwitcher.test.tsx apps/web/tests/components/LeftSidebar.test.tsx
# 10 pass, 0 fail
```

**Fix pass:** added tests for running-project navigate, running/stopped indicators, Escape close (closes R3/R5/R6 gaps).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Open popup | MET | ProjectSwitcher + open menu test |
| R2 Indicators | MET | dots + "shows running and stopped indicators" test |
| R3 Select running navigate | MET | handleSelect + navigate test `http://localhost:5678/board` |
| R4 Select stopped start | MET | start test |
| R5 Keyboard/a11y | MET | Escape test; aria-label on trigger; click-outside in component |
| R6 Component tests | MET | open, start, navigate, indicators, Escape |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — Switching between running projects | MET | test | navigate running project test |
| Scenario: R12 — Project switcher shows running and stopped indicators | MET | test | indicators test |

Coverage: suite 10/10 pass this run (5 ProjectSwitcher + LeftSidebar suite).
### Review
| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | Smooth loading indicator during project auto-start | Accept |

- SECUA Review: Pass. Accessible keyboard navigation (Esc/focus) and ARIA attributes (`aria-haspopup`, `aria-expanded`, `role="listbox"`).
- Traceability: R13, R14 satisfied.
- Final Disposition: Approved for task 0384.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T23:26:48.790Z todo → wip (system)
- 2026-07-29T23:26:50.800Z wip → testing (system)
- 2026-07-29T23:26:52.959Z testing → done (system)
