---
name: "W4: Web design system + theming + responsive (dark mode, prefers-color-scheme, mobile)"
description: "W4: Web design system + theming + responsive (dark mode, prefers-color-scheme, mobile)"
status: Backlog
created_at: 2026-06-15T16:57:15.361Z
updated_at: 2026-06-15T16:57:15.361Z
folder: docs/tasks
type: task
feature-id: W4
priority: P2
estimated_hours: 5
tags: ["server-side-adjustment","wave-W1","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0085. "W4: Web design system + theming + responsive (dark mode, prefers-color-scheme, mobile)"

### Background

A board that looks good, supports dark mode (developer preference), and works on mobile (quick status checks). daisyUI themes avoid hand-designing a component library. Custom daisyUI themes are DEFERRED (default theme this round); the @theme structure is ready for later. P2 — can ship after W3. Anchors: design §3.1 (Tailwind @theme), §3.3 (responsive).


### Requirements

R1: Design tokens via Tailwind @theme in global.css: color palette, spacing scale, typography scale (Spur identity over daisyUI defaults). R2: Dark mode toggle (daisyUI theme switching); persists to localStorage; respects prefers-color-scheme on first load. R3: Responsive breakpoints completing W2's structural hooks: full 3-col >=lg; md sidebar collapses to icon bar; <md single column — left sidebar = slide-in drawer, right panel = bottom sheet, main workspace full-width. R4: Custom daisyUI THEMES deferred (default theme only) — @theme structure additive for later. R5: Tests: dark mode toggles + persists + restores; prefers-color-scheme:dark active on first load; mobile viewport collapses to single column with drawer + bottom sheet. Coverage per project standard. GATED on W2 (layout) + W3 (something to theme).


### Q&A



### Design

Authority: design §3.1 (Tailwind @theme tokens), §3.3 (responsive layout). finalized W4. P2 — ships after
W3. Operator disposition (design item #4): daisyUI custom themes DEFERRED ("so far, no") — default theme
this round; the @theme structure makes customization additive later.

**Design tokens (design §3.1):** complete the `@theme` block in `apps/web/src/styles/global.css` (W1
seeded the minimal version): color palette, spacing scale, typography scale — Spur's identity over daisyUI
defaults. CSS-first (no tailwind.config.js).

**Dark mode (design §3.1, finalized W4):** daisyUI theme switching (light/dark). A toggle component;
persist the chosen theme to localStorage; on first load respect `prefers-color-scheme` (system dark ->
dark). daisyUI `data-theme` attribute on `<html>` drives it.

**Responsive (design §3.3 — completes the 0082 structural hooks):**
| Breakpoint | Layout |
|---|---|
| >=lg (1024) | full 3-col |
| md (768–1023) | sidebar -> icon bar |
| <md (<768) | single column; left sidebar = slide-in DRAWER; right panel = bottom SHEET; main full-width |
0082 laid the breakpoint structure; this task finishes the drawer + bottom-sheet behaviors (daisyUI
`drawer` + a bottom-sheet pattern) and the mobile interactions.

**Custom daisyUI themes:** DEFERRED. Use the daisyUI default (light) + its bundled dark. The `@theme`
structure is ready for a custom Spur theme in a later round — additive, no refactor.

**GATED on W2 (0082 layout) + W3 (0084 — something real to theme).**

**Out of scope:** custom daisyUI themes (deferred), animation/motion library (not needed), per-module
theming.


### Solution



### Plan

- [ ] Complete the `@theme` token block in `apps/web/src/styles/global.css`: color palette, spacing scale, typography scale (Spur identity).
- [ ] Dark mode toggle component: switches daisyUI theme via `data-theme` on `<html>`; persists to localStorage; first-load respects `prefers-color-scheme: dark`.
- [ ] Responsive: finish the drawer (left sidebar slide-in <md) + bottom-sheet (right panel <md) using daisyUI `drawer` + a bottom-sheet pattern; full-width main on mobile; complete the >=lg / md / <md breakpoints from 0082.
- [ ] Keep daisyUI default + bundled dark theme (custom themes DEFERRED); ensure the `@theme` structure stays additive for a later custom theme.
- [ ] Tests: dark mode toggles + persists + restores from localStorage; `prefers-color-scheme: dark` active on first load (mock matchMedia); mobile viewport collapses to single column with drawer + bottom sheet.
- [ ] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [ ] GATE CHECK: W2 (0082) + W3 (0084) landed. P2 — can ship after W3.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


