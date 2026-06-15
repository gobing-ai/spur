---
name: "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"
description: "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"
status: Backlog
created_at: 2026-06-15T16:56:35.804Z
updated_at: 2026-06-15T16:56:35.804Z
folder: docs/tasks
type: task
feature-id: W1
priority: P1
estimated_hours: 6
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0080. "W1: Web stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5"

### Background

apps/web is a single index.astro SSR page (output:'server' + @astrojs/cloudflare) rendering health status; no React/Tailwind/daisyUI/layout. This task re-founds the stack: React for interactivity, Tailwind v4 for styling, daisyUI 5 for component primitives, static output for cheap deployment + fast first paint + no server compute for views. Research-validated 2026-06-14 (Astro 6 client:only=react islands over a static shell). Anchors: design §3.1.


### Requirements

R1: Add @astrojs/react integration + React 19 (react, react-dom). R2: Tailwind CSS v4 via @tailwindcss/vite (Astro vite plugin) — CSS-first config, NO tailwind.config.js; @import 'tailwindcss' + @plugin 'daisyui' + @theme in src/styles/global.css. R3: daisyUI v5 as a Tailwind plugin (zero-dependency). R4: astro.config.mjs output:'static' (from 'server'); remove the @astrojs/cloudflare adapter; integrations:[react()]; vite.plugins:[tailwindcss()]. R5: A client:only='react' island renders (smoke component) and hydrates; a daisyUI btn class renders correctly. R6: KEEP the proxy block REMOVAL for W5 (this task changes output mode + integrations; the unified Vite dev server is W5 — coordinate so the two don't conflict). R7: package.json catalog vs literal: React/Tailwind/daisyUI/react-router are web-only -> literals in apps/web; shared deps stay catalog. R8: Tests/typecheck green; existing health rendering either ported to a React island or temporarily a static placeholder (board comes in W3). Coverage per project standard. NOTE: W4 daisyUI custom THEMES are deferred — default theme only this round.


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



### Plan

- [ ] Add web-only deps (LITERAL versions) to apps/web/package.json: @astrojs/react, react, react-dom (19.x), tailwindcss@4, @tailwindcss/vite, daisyui@5, react-router@7. Keep @orpc/* + typescript + @types/bun as catalog. `bun install`.
- [ ] astro.config.mjs: `output:'static'`, `integrations:[react()]`, `vite:{plugins:[tailwindcss()]}`; remove `@astrojs/cloudflare` adapter. Leave a TEMPORARY proxy if W5 hasn't landed (W5 removes it) — flag the seam.
- [ ] Remove `@astrojs/cloudflare` from deps.
- [ ] Create `apps/web/src/styles/global.css`: `@import "tailwindcss"; @plugin "daisyui";` + minimal `@theme` (full tokens in W4).
- [ ] Port the health page to a static placeholder or a small `client:only="react"` island (real board comes in W2/W3).
- [ ] Smoke: a React island hydrates + is interactive; a daisyUI `btn` renders styled.
- [ ] Tests/typecheck green; `astro build` produces static output (full build wiring is W5).
- [ ] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [ ] Note: W5 (0081) removes any temporary proxy + adds the unified Vite dev server; W4 (0085) adds full tokens + themes.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


