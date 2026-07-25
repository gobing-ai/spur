---
name: "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"
description: "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"
status: done
created_at: 2026-06-15T16:56:35.804Z
updated_at: 2026-06-16T21:05:36.795Z
folder: docs/tasks
type: task
feature-id: W1
priority: P1
estimated_hours: 6
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0080. "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"

### Background

apps/web is a single index.astro SSR page (output:'server' + @astrojs/cloudflare) rendering health status; no React/Tailwind/daisyUI/layout. This task re-founds the stack: React for interactivity, Tailwind v4 for styling, daisyUI 5 for component primitives, static output for cheap deployment + fast first paint + no server compute for views. Research-validated 2026-06-14 (Astro 6 client:only=react islands over a static shell). Anchors: design §3.1.


### Requirements

## Requirements

R1: Add @astrojs/react integration + React 19 (react, react-dom). R2: Tailwind CSS v4 via @tailwindcss/vite (Astro vite plugin) — CSS-first config, NO tailwind.config.js; @import 'tailwindcss' + @plugin 'daisyui' + @theme in src/styles/global.css. R3: daisyUI v5 as a Tailwind plugin (zero-dependency). R4: astro.config.mjs output:'static' (from 'server'); remove the @astrojs/cloudflare adapter; integrations:[react()]; vite.plugins:[tailwindcss()]. R5: A client:only='react' island renders (smoke component) and hydrates; a daisyUI btn class renders correctly. R6: KEEP the proxy block REMOVAL for W5 (this task changes output mode + integrations; the unified Vite dev server is W5 — coordinate so the two don't conflict). R7: package.json catalog vs literal: React/Tailwind/daisyUI/react-router are web-only -> literals in apps/web; shared deps stay catalog. R8: Tests/typecheck green; existing health rendering either ported to a React island or temporarily a static placeholder (board comes in W3). Coverage per project standard. NOTE: W4 daisyUI custom THEMES are deferred — default theme only this round.

### Traceability verdict (2026-06-16)

- [x] **R1** → **MET** | `apps/web/package.json:12,18-19` @astrojs/react 5.0.7, react/react-dom 19.2.1
- [x] **R2** → **MET** (after fix) | `global.css:1` `@import "tailwindcss"`, `@tailwindcss/vite` 4.1.17, no tailwind.config.js; built CSS now emitted
- [x] **R3** → **MET** (after fix) | `global.css:2` `@plugin "daisyui"`, daisyui 5.0.29; `.btn-primary/.btn-ghost/.btn-outline` in `dist/web/_astro/index.*.css`
- [x] **R4** → **MET** | `astro.config.mjs:6-9` output:'static', integrations:[react()], vite.plugins:[tailwindcss()]; no @astrojs/cloudflare ref anywhere
- [x] **R5** → **MET** (after fix) | `SmokeIsland.tsx:13` client:only island hydrates (useState counter); daisyUI btn compiled+styled (verified in built CSS + linked from index.html)
- [x] **R6** → **MET** | `astro.config.mjs:10-17` temporary proxy kept with explicit W5/0081 removal note
- [x] **R7** → **MET** | react/react-dom/daisyui/tailwindcss/@tailwindcss/vite/react-router are literals; @orpc/*, typescript, @types/bun stay `catalog:`
- [x] **R8** → **MET** | all 7 workspaces typecheck clean; web tests 4/4; `astro build` static OK; health page → SmokeIsland React placeholder (real board W2/W3)

Scope drift: none. No untraced code; all changed files map to R1-R8.


### Q&A



### Design

Authority: design §3.1 (stack migration). Research-validated 2026-06-14 (daisyUI/Tailwind v4/Astro docs).

**Current (verified):** `apps/web` = `output:'server'` + `@astrojs/cloudflare` adapter, single
`index.astro` SSR health page, a Vite proxy for `/api` + `/openapi.json`. Deps: astro 6.4.2,
@astrojs/cloudflare 13.6.0, @orpc/* (catalog), spur-contracts. NO React/Tailwind/daisyUI.

**Target (design §3.1):** `output:'static'` + `@astrojs/react` (React 19) + Tailwind v4 via
`@tailwindcss/vite` (CSS-first, NO tailwind.config.js) + daisyUI 5 (Tailwind plugin). React islands via
`client:only="react"` over a static HTML shell — no SSR compute for views.

**astro.config.mjs (design §3.1):**
```javascript
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
```
**Remove `@astrojs/cloudflare`** (no SSR adapter for static). NOTE: the Vite `server.proxy` block is
removed in W5 (0081 unified dev server) — COORDINATE: this task changes output+integrations; if W5 hasn't
landed, leave a TEMPORARY proxy so dev still hits the API, and W5 removes it. Flag the seam.

**Tailwind v4 CSS-first (design §3.1):** `apps/web/src/styles/global.css`:
```css
@import "tailwindcss";
@plugin "daisyui";
@theme { --color-spur-bg: #0f1117; --color-spur-surface: #1a1d27; --color-spur-accent: #6366f1; /* … */ }
```
Tailwind v4 deprecated the JS config; `@theme` in CSS is the path; `@plugin "daisyui"` loads daisyUI.
(Full token set is W4/0085; this task wires the minimal global.css so utilities + daisyUI render.)

**Deps (R7 — catalog vs literal per AGENTS.md):** React/react-dom, @astrojs/react, tailwindcss@4,
@tailwindcss/vite, daisyui@5, react-router@7 are WEB-ONLY -> LITERALS in `apps/web/package.json`.
Shared deps (@orpc/*, typescript, @types/bun, zod) stay `catalog:`. Confirm exact latest-stable versions
at install (Tailwind v4.x, daisyUI v5.x, React 19.x, React Router 7.x).

**Smoke (R5):** a `client:only="react"` island renders + hydrates (interactive), and a daisyUI `btn`
class renders as a styled button. The existing health rendering becomes a temporary static placeholder
or a small React island (the real board is W2/W3).

**W4 deferral:** daisyUI custom THEMES are deferred (default theme only this round); `@theme` structure
is additive for W4.

**Out of scope:** layout shell (W2/0082), module system (W2/0083), unified Vite dev server (W5/0081),
full design tokens + dark mode + responsive (W4/0085).


### Solution

## Solution

Re-founded `apps/web` from SSR (`output:'server'` + `@astrojs/cloudflare`) to a static React-island stack.

**Config (`astro.config.mjs`):** `output:'static'`, `integrations:[react()]`, `vite.plugins:[tailwindcss()]`; `@astrojs/cloudflare` removed. A TEMPORARY `vite.server.proxy` for `/api` + `/openapi.json` is retained with an explicit removal note for W5/0081 (unified Vite dev server).

**Styling (`src/styles/global.css`):** Tailwind v4 CSS-first — `@import "tailwindcss"; @plugin "daisyui";` + minimal `@theme` spur tokens. No `tailwind.config.js`. Full token set + custom themes deferred to W4/0085.

**Island (`src/components/SmokeIsland.tsx` + `index.astro`):** `client:only="react"` smoke island with a `useState` counter (hydration proof) and daisyUI `btn-primary/btn-ghost/btn-outline` (style proof). The old SSR health page is replaced by this placeholder; the real board lands in W2/W3.

**Deps (`package.json`):** React 19.2.1 / react-dom, `@astrojs/react` 5.0.7, `tailwindcss`@4.1.17, `@tailwindcss/vite`, `daisyui`@5.0.29, `react-router`@7.11.0 as web-only literals; `@orpc/*`, `typescript`, `@types/bun` stay `catalog:`.

**Fix during verification:** `global.css` was not imported by any entry, so the build emitted zero CSS and Tailwind/daisyUI never ran (page rendered unstyled). Added `import '../styles/global.css';` to `index.astro` frontmatter so Astro's Vite pipeline compiles and links the stylesheet. Verified: `dist/web/_astro/index.*.css` now contains `.btn-*` + `--color-spur-*` + `.bg-spur-bg`, linked from `index.html`.

**Gate:** lint clean (319 files, 7 workspaces typecheck) · `bun run test` 1431+158 pass / 0 fail · `test-cf` 1 pass · `bun run build` static OK.


### Plan

## Plan

- [x] Add web-only deps (LITERAL versions) to apps/web/package.json: @astrojs/react, react, react-dom (19.x), tailwindcss@4, @tailwindcss/vite, daisyui@5, react-router@7. Keep @orpc/* + typescript + @types/bun as catalog. `bun install`.
- [x] astro.config.mjs: `output:'static'`, `integrations:[react()]`, `vite:{plugins:[tailwindcss()]}`; remove `@astrojs/cloudflare` adapter. Leave a TEMPORARY proxy if W5 hasn't landed (W5 removes it) — flag the seam.
- [x] Remove `@astrojs/cloudflare` from deps.
- [x] Create `apps/web/src/styles/global.css`: `@import "tailwindcss"; @plugin "daisyui";` + minimal `@theme` (full tokens in W4).
- [x] Port the health page to a static placeholder or a small `client:only="react"` island (real board comes in W2/W3).
- [x] Smoke: a React island hydrates + is interactive; a daisyUI `btn` renders styled.
- [x] Tests/typecheck green; `astro build` produces static output (full build wiring is W5).
- [x] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [x] Note: W5 (0081) removes any temporary proxy + adds the unified Vite dev server; W4 (0085) adds full tokens + themes.


### Review

## Review — 2026-06-16

**Status:** 1 finding (P1, fixed)
**Scope:** apps/web (astro.config.mjs, package.json, index.astro, global.css, tsconfig.json, SmokeIsland.tsx)
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `bun run lint` → pass · web `test` → 4/4 pass · `astro build` → pass (CSS now emitted)
**Verdict:** PASS (after fix-pass)

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `global.css` never imported → Tailwind+daisyUI never bundled (FIXED) | Correctness | apps/web/src/pages/index.astro | Add `import '../styles/global.css';` to frontmatter so Astro's Vite pipeline emits the stylesheet |

### P2 — Warnings
_(none)_

### P3 — Info
_(none)_

### P4 — Suggestions
_(none)_

**Fix-pass 2026-06-16:** 1 fixed, 0 failed, 0 skipped.
Root cause: build produced zero CSS files; `dist/web/index.html` had no `<link rel="stylesheet">`; daisyUI `btn-*` and `--color-spur-*` tokens appeared only as className literals inside SmokeIsland JS, never compiled. After importing `global.css` in `index.astro`, build emits `_astro/index.*.css` containing `.btn-primary`/`.btn-ghost`/`.btn-outline` + `--color-spur-bg` + `.bg-spur-bg`, linked from index.html. R2/R3/R5 now pass at runtime.


### Testing

## Testing

No new unit tests authored — W1 is an infrastructure/stack migration; the only runtime artifact (`SmokeIsland`) is a throwaway smoke placeholder replaced by the real board in W2/W3, so dedicated tests would test code slated for deletion (R8: coverage per standard, board comes later). Verification is gate-based + build-artifact inspection.

**Existing tests (kept green):** `apps/web/tests/rpc-client.test.ts` + `tests/lib/rpc-client.test.ts` — 4 pass / 0 fail.

**Verification performed:**
- `bun run lint` → clean (Biome 319 files; all 7 workspaces `tsc --noEmit` exit 0).
- `bun run test` → 1431 + 158 pass, 0 fail (aggregate coverage 99.64% func / 95.67% line).
- `bun run test-cf` → 1 pass (server Workers runtime).
- `bun run build` → static output across all workspaces, exit 0.

**Build-artifact assertions (the substantive R2/R3/R5 proof):**
- `dist/web/_astro/index.*.css` is emitted (was absent before the fix).
- Built CSS contains daisyUI `.btn-primary` / `.btn-ghost` / `.btn-outline`, `@theme` token `--color-spur-bg`, and utility `.bg-spur-bg`.
- `dist/web/index.html` links the stylesheet (`<link rel="stylesheet" href="/_astro/index.*.css">`) and emits the `<astro-island client="only" value="react">` for SmokeIsland (hydration path present).
- No `@astrojs/cloudflare` reference anywhere under `apps/web`.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


