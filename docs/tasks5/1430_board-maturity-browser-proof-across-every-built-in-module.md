---
schema_version: 1
name: Board maturity browser proof across every built-in module
status: done
template: feature-impl
created_at: 2026-11-22T02:21:33.670Z
updated_at: "2026-11-22T08:28:16.233Z"
feature_id: A83

tags: ["A83"]
dependencies: ["1426", "1427", "1428"]
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1430. Board maturity browser proof across every built-in module

### Background

Implements: R6 — A browser proof loads every built-in module and leaves an artifact.

Runs after the shells (1426, 1427) and icons (1428) land. Complements the A82 integrations proof (1425).

**Refine corrections (2026-11-21)**
- "An E2E script under scripts/commands/" → a **heavy browser test**, `apps/web/tests/modules/board-maturity-browser.heavy.test.ts`. This is the same decision as 1425's Board leg. The harness already exists: `buildBoardToTemp` (`tests/test-helpers/board-build.ts:108`), `serveBoard` (`board-server.ts:94`) and `launchBrowser` (`cdp.ts:93`, with `navigate`/`waitFor`/`evaluate`/`logEntries`/`failedRequests`/`send`). `scripts/commands` is reserved for irreducible repo policy and entrypoints (ADR-130), and a second CDP driver there would duplicate the helpers. Heavy tests run under `bun run test:heavy`.
- "Booting spur serve" → `serveBoard` serves the production build without a project API. Data calls therefore fail by design. The proof checks shell, header and icon composition, not data. The assertion is "no asset/MIME failures, no uncaught page errors, no module error boundary", not "an empty console".
- "Every built-in module" is a frozen list of **ten**: designs, features, history, integrations (A82), observability, plans, projects, search, settings, tasks. It is not the "nine incl. runtime" the feature text claims: `runtime/` is a manifest, not a module (see 1426).
- "a ModuleIcon renders" → this becomes checkable after 1428: the header icon is an `<svg>` (Lucide), and no sidebar entry has raw emoji text.
- Screenshots: `cdp.ts` has no screenshot helper. Use `send('Page.captureScreenshot', {format:'png'}, sessionId)` inline. Add no helper for a single caller.

### Requirements

- [x] R1. `apps/web/tests/modules/board-maturity-browser.heavy.test.ts` builds and serves the Board once, then visits `/board/<route>` for each of the ten built-in modules (frozen list in Background).
- [x] R2. Per module it asserts the following:
  - exactly one `[data-<module>-shell]` (observability: its existing kit root);
  - one kit header with an `<svg>` icon and the module title;
  - no element of `ModuleErrorBoundary`'s fallback;
  - no `failedRequests()` entry outside `/api/` and `/rpc/` data paths;
  - no `logEntries()` entry of level `error` from an uncaught exception or CSP violation.
- [x] R3. The sidebar check: every built-in nav entry renders an `<svg>`, and its text content contains no emoji code points (`/\p{Extended_Pictographic}/u`).
- [x] R4. It writes `docs/reports/board-maturity-e2e-receipt.json`, with a stable name and overwritten each run. The receipt holds `{generatedAt, modules: [{id, route, shell, icon, errors: [], screenshot}]}`, plus one screenshot per module at `docs/reports/board-maturity-<id>.png` (light theme, 1280×800).
- [x] R5. With no browser binary (`availableBrowserBinary()` undefined) it skips with a reason, as the existing heavy tests do. Any assertion failure still writes the receipt, with the failing rows, before it fails.

Out of scope: dark-mode or mobile screenshot matrices, data-path proofs (each module's own tests own these), and integrations protocol checks (1425).

### Acceptance Criteria

- [x] AC1 — A browser proof loads every built-in module and leaves an artifact

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:13:28.349Z

- **Closed: script vs heavy test.** Heavy test. The CDP and board-server helpers already exist there, `test:heavy` already runs it, and ADR-130 keeps reusable behavior out of `scripts/commands`.
- **Closed: Integrations in the list.** Yes. A82 lands first (1426 depends on 1424), and the proof covers every built-in module that ships.

### Design

- **Shape:** one `describe` with a `beforeAll` that runs `buildBoardToTemp` → `serveBoard(dist)` → `launchBrowser()` once. An `afterAll` closes the browser, stops the server and runs `removeBoardBuild`. One `test` per module, generated from the frozen list, so failures name the module. A final `afterAll` writes the receipt from the collected rows.
- **Frozen list:** `const BUILTIN = [{id:'designs',route:'designs'}, …, {id:'tasks',route:'tasks'}] as const` lives in the test. Do not derive it from discovery, because a deleted module must fail the proof rather than silently shrink it.
- **Allowed noise:** data-endpoint 404s (`/api/`, `/rpc/`) are expected under `serveBoard`. Filter by path prefix, not by message text.
- **Screenshot:** inline `send('Page.captureScreenshot', {format:'png'})` → base64 → `Bun.write`.
- **Anti-patterns:** no new CDP helper or driver; no `scripts/commands` entry; no sleeps (use `waitFor` on the shell selector); no snapshot images compared pixel-wise.
- **Depends on handoffs:** `data-<module>-shell` on `ModuleShell` (1426/1427); `<svg>` icons and no emoji (1428); `data-integrations-shell` (1424). If one is missing, the proof fails. That is the point.

### Plan

Premises (verified 2026-11-21): the helpers at `board-build.ts:108`, `board-server.ts:94`, `cdp.ts:93`; the heavy-test pattern in `composed-board-browser.heavy.test.ts`; the receipt convention from `a2a-serve-e2e` (stable name, overwrite).

- [ ] 1. Failure modes the proof must catch: a module missing from the build; a shell not on the kit; an emoji icon; an asset 404 or MIME error; an uncaught render error; a receipt not written on failure.
- [ ] 2. Write the test against the frozen list first. Before 1426–1428 land it fails on the shell and icon assertions, which confirms it discriminates.
- [ ] 3. After 1426/1427/1428, run `(cd apps/web && bun test tests/modules/board-maturity-browser.heavy.test.ts)` until green. Inspect the screenshots by eye.
- [ ] 4. Confirm `bun run test:heavy` picks it up, then commit the receipt and PNGs.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `apps/web/tests/modules/board-maturity-browser.heavy.test.ts` | production build + `serveBoard` + real Chromium over the frozen ten modules: one shell, kit header with an `<svg>` icon, no `ModuleErrorBoundary` fallback, no asset/MIME failure, no uncaught/CSP page error; then the sidebar check (`svg` present, no `Extended_Pictographic` text); screenshot per module; receipt written even when an assertion fails | R1-R5 |
| `apps/web/src/modules/{designs,features,plans}/*Shell.tsx` | the loading and error branches now render inside `ModuleShell` + `ModuleHeader` instead of a bare `<div>` | The browser proof's first real finding: with data unreachable (no project API under `serveBoard`, or any slow first load) those three modules rendered NO module shell at all — no header, no title. A module's shell must not depend on its data |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx:43` | `data-integrations-shell` on `ModuleShell` | Every other shell carries its probe attribute; integrations (A82) was the only one missing it, so a structural check could not see it |

Artifacts: `docs/reports/board-maturity-e2e-receipt.json` (`passed: 10`, `failed: 0`, `sidebar: {entries: 10, withSvg: 10, emoji: []}`) and `docs/reports/board-maturity-<id>.png` (ten light-theme screenshots, 1280x800).

Measured: `(cd apps/web && bun test tests/modules/board-maturity-browser.heavy.test.ts)` → 1 pass, 1 skip (the no-browser row) in 8.8 s; `tests/modules` → 416 tests, 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 builds and serves the Board once, then visits `/board/<route>` for the frozen ten modules | MET | `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:46-57` (frozen list), `:110-135` (one build, one server, one page) — run: 1 pass in 8.8 s |
| R2 per module: exactly one `[data-<module>-shell]`, one kit header with an `<svg>` icon and the module title, no error-boundary fallback, no non-data asset failure, no uncaught/CSP error | MET | `board-maturity-browser.heavy.test.ts:137-186` (`shells`, `h1`, `iconSvg`, boundary text, `assetFailures()`, `pageErrors()`), receipt `docs/reports/board-maturity-e2e-receipt.json` → all ten rows `shell: true, icon: true, errors: []` |
| R3 sidebar: every built-in nav entry renders an `<svg>` and no `Extended_Pictographic` text | MET | `board-maturity-browser.heavy.test.ts:189-198`; receipt `sidebar: {ent: 10, withSvg: 10, emoji: []}` (1428's vector table is what makes this pass) |
| R4 receipt `docs/reports/board-maturity-e2e-receipt.json` (stable name, overwritten) with `{generatedAt, modules[]}` + one screenshot per module at `docs/reports/board-maturity-<id>.png` | MET | `:100-127` (`writeReceipt`), `:170-176` (screenshot per module); `ls docs/reports/board-maturity-*.png` → 10 files; receipt shows `passed: 10, failed: 0` |
| R5 skips with a reason without a browser binary, and a failing run still writes the receipt first | MET | `:203-206` (`test.skipIf(!browserReady)`), receipt written before the assertions (`:167-178`) |
| Findings fixed by the proof | MET | `apps/web/src/modules/{designs,features,plans}/*Shell.tsx` loading/error branches now render inside `ModuleShell` + `ModuleHeader` (they rendered a bare `<div>`: no shell, no header, no title while data was unreachable); `IntegrationsModule.tsx:43` gained `data-integrations-shell` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A browser proof loads every built-in module and leaves an artifact | MET | command | `bun test tests/modules/board-maturity-browser.heavy.test.ts` → 1 pass; `docs/reports/board-maturity-e2e-receipt.json` + 10 PNGs |
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

- 2026-11-22T02:22:13.647Z backlog → todo (system)
- 2026-11-22T08:27:49.425Z todo → wip (system)
- 2026-11-22T08:28:14.607Z wip → testing (system)
- 2026-11-22T08:28:16.228Z testing → done (system)

