---
schema_version: 1
name: Define the Board module-shell UI contract in DESIGN.md and route spur-composer to it
status: todo
template: feature-impl
created_at: 2026-11-16T19:08:27.311Z
updated_at: "2026-11-16T19:36:09.129Z"
feature_id: A81
priority: P1
tags:
  - board
  - design
  - docs
  - plugin

estimate_hours: 3
---

## 1347. Define the Board module-shell UI contract in DESIGN.md and route spur-composer to it

### Background

Implements: R1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules; R6 — spur-composer routes authors to the UI contract through a dedicated reference.

Knowledge-kit's native modules drifted from built-in modules because the ADR-081 shell anatomy lives only in per-module satellites (tasks-module-shell-parity, history, observability) and root DESIGN.md covers only frame/right-panel behavior for downstream modules. Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md), ADR-150. Independent of the kit tasks; runs first.

Rubric: E3 D1 L2 C0 R0 = 6 → own task (docs + plugin skill surface, separately reviewable).

### Requirements

- [ ] R1. Add a normative module-shell section to root DESIGN.md: header anatomy (icon, title, subtitle, status chip, filter/range row, tab strip right), append-only tabs, density/width (incl. ADR-081 full-bleed exception), empty/loading/diagnostic states, right-panel use and light/dark token use; state it binds built-in and project-owned native modules alike.
- [ ] R2. Reconcile the existing 'Product UI — Downstream Board Modules (proposed)' section into the new section without contradicting its frame and right-panel rules.
- [ ] R3. Add a dedicated board-module UI reference under plugins/sp/skills/spur-composer/references/ that links (never restates) the DESIGN.md section, downstream design §6 and the UI-kit satellite, and link it from the SKILL.md Board module composition step.
- [ ] R4. Keep the plugin standalone and skill budget gates green.

### Acceptance Criteria

- [ ] AC1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules
- [ ] AC2 — spur-composer routes authors to the UI contract through a dedicated reference

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:15.589Z

- **Closed:** UI rules live in root DESIGN.md, not in spur-composer — DESIGN.md is the UI/UX authority (AGENTS doc map, constitution §6.5); the composer reference only links it (ADR-150).
- **Deferred:** knowledge-kit module migration — separate repository; follow-up there once A81 ships.

#### Q&A entry — 2026-11-16T19:35:52.090Z

- **Closed:** UI rules live in root DESIGN.md, not in spur-composer — DESIGN.md is the UI/UX authority; the composer reference only links it (ADR-150).
- **Closed:** template lives at plugins/sp/skills/spur-composer/templates/board-module/ (frozen by refine 2026-11-16, delivered in 1350).
- **Deferred:** knowledge-kit module migration — separate repository; follow-up there once A81 ships.

### Design

Approach: DESIGN.md owns UI rules (constitution §6.5, AGENTS doc map); derive the section from the shipped built-in shells (ObservabilityShell, HistoryShell, TasksShell) and ADR-081 rather than inventing new styling.
Rejected: putting the UI contract inside spur-composer (a skill is guidance, not the UI authority; would duplicate DESIGN.md).
Invariants: the composer reference links owners only; no restated verb catalogs; existing frame/right-panel rules preserved.

### Plan

1. Inventory shell anatomy from built-in shells + ADR-081
2. Write DESIGN.md module-shell section; fold the downstream section in
3. Add spur-composer references/board-module-ui.md and link it from SKILL.md
4. Run skill validation and doc checks

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
