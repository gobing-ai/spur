---
schema_version: 1
name: Board maturity browser proof across every built-in module
status: done
template: feature-impl
created_at: 2026-11-22T02:21:33.670Z
updated_at: "2026-11-22T18:13:42.916Z"
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
- [x] R4. It writes the live `.spur/run/board-maturity-proof/board-maturity-e2e-receipt.json`, with a stable name and overwritten each run. The receipt holds `{generatedAt, modules: [{id, route, shell, icon, errors: [], screenshot}]}`, plus one light-theme 1280×800 screenshot per module in that directory. A successful preview is explicitly published to `docs/reports/board-maturity-e2e-receipt.json` and `docs/reports/board-maturity-<id>.png`; the verification pass does not rewrite tracked proof inputs.
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

#### Forced verification repairs — 2026-11-22

- Before-fix browser probes reproduced missing panel associations, incorrect tab stops, the misplaced Tasks tab strip, capped wide Tasks layout, hidden failed assets and missing uncaught-exception capture. The screenshot check also proved the old browser default was 800x600 rather than the required 1280x800.
- The proof now pins and checks 1280x800 PNG dimensions, counts all ten sidebar entries and SVGs, checks active panel associations, and exercises wide Tasks plus the Designs/Plans document layouts.
- The existing CDP helper captures runtime exceptions and failed network connections; asset exclusions inspect URL pathnames rather than query strings. Failure probes run after the real module proof so their deliberate errors cannot contaminate the module receipt.
- Evidence-publishing correction (goal-equivalent Design change): live artifacts use the existing A81 convention under `.spur/run/board-maturity-proof/`; the committed `docs/reports/` snapshot is refreshed explicitly from a passing run. Rewriting tracked screenshots/receipts inside the feature pass changes its inputs and invalidates its digest; no L4 rule or digest exclusion was changed.
- The Integrations active tab panel now wraps loading/diagnostic states as well. Its shared heavy proof writes to `.spur/run/integrations-proof/` through an optional internal receipt destination; the standalone script's canonical docs/report default is preserved.
- Receipt writing runs in teardown too, and missing module rows count as failures. The source owns its artifact directory before any screenshot write.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:35` freezes ten ids/routes and builds/serves once. The browser-backed run passed all ten modules; the no-browser branch was the one skipped case because Chromium was available. |
| R2 | MET | `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:142` checks shell/header/title/vector, active panel labels, tab stops, module fallback and real asset/runtime errors. Explicit asset-query, network-failure and uncaught-exception probes now pass after first failing; the existing CDP helper captures both event families. |
| R3 | MET | `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:210` measures the sidebar, checks ten entries/ten vectors, compares the exact frozen id set and rejects glyph text. The fresh receipt reports all ten entries with no emoji. |
| R4 | MET | `docs/reports/board-maturity-proof.md:1` documents live ignored output plus deliberate canonical publication. The fresh receipt and fourteen screenshots were published; each primary PNG was checked at exactly 1280x800. Live paths preserve stable basenames without changing the verifier's tracked inputs. |
| R5 | MET | Fix-pass disclosure: @batch `.spur/run/1430-verify-answer.txt` lines 1-34 and `.spur/run/1430-verdict.json` lines 1-72 carry the recertified rows; raw before/after evidence remains under `.spur/run/A83-verifyall-20261122-`. `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:112` writes a receipt from teardown, including on failure; missing rows count as failures. The explicit browser-unavailable branch is skipped with its named reason when Chromium is present. Before-fix red runs retained their receipts; the final browser run passes. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A browser proof loads every built-in module and leaves an artifact | MET | test | `apps/web/tests/modules/board-maturity-browser.heavy.test.ts:142`; fresh evidence @batch `.spur/run/A83-verifyall-20261122-browser-publish.log` line 1-16, plus @batch `.spur/run/A83-verifyall-20261122-web-final.log` lines 1-326 where applicable. |
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

