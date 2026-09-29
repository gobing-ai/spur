---
schema_version: 1
name: Prove a changed module selection follows restart plus reload end to end
status: done
template: feature-impl
created_at: 2026-09-29T03:05:27.931Z
updated_at: "2026-09-29T04:45:41.866Z"
feature_id: A8

---

## 0998. Prove a changed module selection follows restart plus reload end to end

### Background

Feature A8 scenario **R13** ("Module selection changes use the documented restart lifecycle") and 0992 R4 promise:
change the module configuration, restart the project server, reload the browser, and the new selection is used.

The two halves are proven separately; the browser half of a *changed* selection is not.

- **Server half — owned, green:** `apps/server/src/serve.ts:706` prepares the catalog snapshot before
  `Bun.serve` at `:1042`. `apps/server/tests/board-modules.test.ts` covers: snapshot stable when the declaration
  changes on disk (`:301`), incompatible distribution refused (`:288`), enabled contribution without a
  distribution refused (`:277`), missing asset refused (`:262`), and the no-module legacy distribution path
  (`:324` manifest-less distribution is not a failure; `:343` unreadable manifest fails only with declared
  contributions).
- **Browser half — missing:** `apps/web/tests/modules/composed-board-browser.test.ts:458` (the only R4-labelled
  case) asserts `cache-control: no-store`; the second-origin case (`:420`) proves a fresh load on a *different*
  origin. No case keeps the same origin, swaps the served catalog/assets, and shows (a) the running page does not
  pick the change up and (b) a reload does. A Board that cached the catalog per origin (storage, service worker,
  memoised fetch) would pass every current test.

**Evidence:** 0992 Review residual (P2): "R4's restart-plus-reload for a *changed* selection is not driven
end-to-end in a browser here."

### Requirements

- [x] R1. In the composed browser proof, on **one fixed origin**: render the first catalog's native module, stop
  that board server, start a board server on the **same port** serving the changed catalog and assets, reload
  the page, and assert the changed selection renders — changed sidebar routes, changed module content and
  stylesheet, changed frame URL — with no first-catalog route, content or state remaining.
- [x] R2. Before the reload, with the changed server already listening, assert the running Board still shows the
  first catalog — including after an in-app (client-side) navigation away from and back to the module — so R1's
  positive result is attributable to restart plus reload, not to live replacement.
- [x] R3. Test-helper change only: `serveBoard` may gain an optional fixed `port`. No production code change, no
  live replacement, file watching, polling or HMR.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Module selection changes use the documented restart lifecycle (req: R1; R2; R3)
  Given a board server on a fixed origin whose Board has composed the first catalog and rendered its native module
  When that server is replaced on the same port by one serving a changed catalog and changed module assets
  Then the running Board, including after in-app navigation, still shows the first catalog's routes and content
  And after a page reload the changed catalog's routes, module content, stylesheet and frame URL render
  And no route, content or in-page state from the first catalog remains
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T03:18:04.038Z

- **Scope cut (2026-09-28): original R3 (incompatible override fails before listen) and R4 (no-module legacy
  override stays usable) dropped as duplicates.** Both are owned by `apps/server/tests/board-modules.test.ts`
  (`:277`, `:288`, `:324`, `:343`) and the ordering is structural in `apps/server/src/serve.ts` (prepare `:706`
  before `Bun.serve` `:1042`). `apps/web`'s static `serveBoard` helper cannot exercise server startup, so a
  browser duplicate would be a mock of the real path. Testing must name these as inherited, not re-prove them.
- **Same port, not a new server on a new port:** a new port is a new origin — that is the existing `:420`
  second-origin case. Only a same-origin swap can catch origin-scoped caching of the catalog.
- **Changed selection = the existing alt fixture.** `altCatalog(host)` + `ALT_FIXTURE_DIR` already differ from
  the first catalog in module set (`frame-alt` vs `frame-ok`/`broken-probe`/`missing-probe`), sidebar label,
  content (`data-probe-variant=alternate`), stylesheet (`rgb(10, 150, 60)`) and frame URL. No new fixture.
- **Reload mechanism:** `browser.send('Page.reload', {}, page)` then `waitFor` — no CDP helper change.
- **Config→catalog translation is out of browser scope:** `prepareBoardModules` is a pure function of the
  declarations it is given at startup; the browser proof starts from the served catalog.
- Feature traceability: this AC closes A8 R13's browser half. The Background's original "A8 R4" label was
  0992 R4.

### Design

**Change map**

- `apps/web/tests/test-helpers/board-server.ts` — add `readonly port?: number` to `BoardServeOptions`; pass
  `port: options.port ?? 0` to `Bun.serve`. Nothing else.
- `apps/web/tests/modules/composed-board-browser.test.ts` — replace the body of the R4 describe (`:457`) scope with
  the existing no-store case **plus** one new case. The new case owns its server lifecycle (do not touch the
  shared `server`/`altServer`):
  1. `const first = serveBoard(proofBuild, { catalog: proofCatalog(host), moduleAssets: { 'native-probe': FIXTURE_DIR, 'broken-probe': FIXTURE_DIR } })`
     — `host` must be hoisted from `beforeAll` to module scope.
  2. Navigate to `${first.origin}/board/modules/native-probe`; wait for `[data-probe-counter]`; click it once
     (counter `1`) so retained state is detectable.
  3. `const port = first.port; first.stop();`
     `const changed = serveBoard(proofBuild, { catalog: altCatalog(host), moduleAssets: { 'native-probe': ALT_FIXTURE_DIR }, port });`
  4. R2: assert `data-probe-variant=original` present, sidebar hrefs contain `frame-ok`, not `frame-alt`. Click the
     `/board/designs` sidebar link, wait for it, click back to `native-probe`; assert still `original` and
     `frame-alt` still absent.
  5. `await browser.send('Page.reload', {}, page)`; wait for `[data-probe-variant=alternate]`.
  6. R1: reuse the `:420` assertions — hrefs contain `native-probe` + `frame-alt`, not `frame-ok`/`broken-probe`;
     `alternate` present, `original` absent; `[data-probe]` color `rgb(10, 150, 60)`; counter `0`; navigate to
     `/board/modules/frame-alt` and assert frame `src === fixtures.deniedUrl`.
  7. `finally { first.stop(); changed?.stop(); }`.
- Extract the `:420` post-condition assertions into a local `expectAltCatalog()` helper used by both cases, so
  the two proofs cannot drift (the only permitted refactor).

**Constraints**

- No production change. If the Board *does* pick up the change before reload, or does *not* after reload, stop
  and report — that is a product defect for a separate task, not something to accommodate in the test.
- Keep the case in the existing composed proof file; reuse its build (`buildBoardToTemp` is the slow step).
- Port rebinding: `stop()` uses `server.stop(true)`; if rebinding the same port is flaky, retry `serveBoard` a
  bounded number of times on `EADDRINUSE` in the test, never fall back to a new port (that would silently turn
  this into the second-origin case).

**Out of scope:** switcher-driven switching (0997, cancelled); server startup refusal (owned in `apps/server`);
config-file parsing.

### Plan

1. Add optional `port` to `BoardServeOptions` / `serveBoard` (`apps/web/tests/test-helpers/board-server.ts`).
2. Hoist `host` to module scope in `composed-board-browser.test.ts`; extract `expectAltCatalog()` from the `:420`
   case and keep that case green.
3. Add the same-origin restart-plus-reload case per Design steps 1–7 in the R4 describe block.
4. Run `(cd apps/web && bun test tests/modules/composed-board-browser.test.ts)` — green; then temporarily make the
   changed server serve the *first* catalog and confirm the new case fails at step 5/6 (proves it can fail);
   revert.
5. `bun run spur-check`. In Testing, name the inherited server-side owners for before-listen refusal and the
   no-module legacy path (`apps/server/tests/board-modules.test.ts:277/288/324/343`).

### Solution

- `apps/web/tests/test-helpers/board-server.ts:49` — `BoardServeOptions` gains `readonly port?: number`; `serveBoard` passes `port: options.port ?? 0` to `Bun.serve` (`:96`). Test-helper only; no production change (R3).
- `apps/web/tests/modules/composed-board-browser.test.ts:176` — new module-scope `expectAltCatalog(origin)` helper holding the alt-catalog post-conditions: sidebar routes `native-probe` + `frame-alt` present and `frame-ok`/`broken-probe` absent, `data-probe-variant=alternate` present and `original` absent, stylesheet `rgb(10, 150, 60)`, counter reset to `0`, and `/board/modules/frame-alt` framing `fixtures.deniedUrl`. Extracted verbatim from the second-origin case (the only permitted refactor) so both proofs share one drift-proof assertion set; `host` hoisted from `beforeAll` to module scope (`:38`, `:213`) to feed it.
- `apps/web/tests/modules/composed-board-browser.test.ts:479` — new case in the R4 describe: "a changed selection is used only after restart plus reload on the same origin (R13)". It owns its server lifecycle (shared `server`/`altServer` untouched): serve the first catalog on an ephemeral port, render `native-probe`, click the counter to `1`; then `first.stop()` and a new `serveBoard` on the SAME port with `altCatalog` + `ALT_FIXTURE_DIR` (bounded EADDRINUSE retry, never a new port); R2 asserts the running Board still shows `original` and first-catalog routes before any reload, including across an in-app (client-side) click-navigation to `/board/designs` and back; then `Page.reload` and `expectAltCatalog` on the same origin — changed routes, content, stylesheet and frame URL with no first-catalog route, content or in-page state left (counter back to `0`).

Rationale: same port is load-bearing — a new port is a new origin, which is the existing AC3 case; only a same-origin swap can catch origin-scoped catalog caching (storage, service worker, memoised fetch). The pre-reload assertion plus in-app navigation attributes the post-reload positive result to restart plus reload, not live replacement.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | New case "a changed selection is used only after restart plus reload on the same origin (R13)" `apps/web/tests/modules/composed-board-browser.test.ts:479`: first catalog served and rendered with counter clicked to 1 (`:488-498`); server swapped on the SAME port (`:500-518`, bounded EADDRINUSE retry, never a new port); `Page.reload` (`:545`); then shared `expectAltCatalog` (`:551`, helper `:182-209`): alt sidebar routes `native-probe`+`frame-alt` present and `frame-ok`/`broken-probe` absent (`:187-190`), `variant=alternate` present and `original` absent (`:192-193`), stylesheet `rgb(10, 150, 60)` (`:194-196`), counter reset to 0 (`:198`), `/board/modules/frame-alt` frames `fixtures.deniedUrl` (`:201-208`) — no first-catalog route, content or in-page state remains. |
| R2 | MET | Same case before any reload, with the changed server already listening: `original` asserted and first-catalog routes held (`frame-ok` present, `frame-alt` absent, `:521-526`); in-app client-side navigation to `/board/designs` (`:528-532`) and back to `native-probe` (`:533-537`); `original` re-asserted and `frame-alt` still absent (`:538-542`) — the post-reload positive is attributable to restart plus reload, not live replacement. |
| R3 | MET | Test-helper only: `apps/web/tests/test-helpers/board-server.ts:50` adds `readonly port?: number` to BoardServeOptions; `:96` passes `port: options.port ?? 0` to Bun.serve. `git diff --name-only b21c9e264..HEAD` lists only the two test files plus the task doc — no production file; no watcher, polling or HMR anywhere in the diff. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Module selection changes use the documented restart lifecycle (req: R1; R2; R3) | MET | test | `apps/web/tests/modules/composed-board-browser.test.ts:479-556` enacts the scenario line by line: given (first catalog composed and rendered, counter=1), when (same-port server swap to the changed catalog/assets), then (running Board still shows the first catalog incl. in-app nav), and after a page reload (changed routes, module content, stylesheet and frame URL render; counter back to 0; no first-catalog residue). Fresh run this session: 16 pass / 0 fail / 66 expect() calls, real Chromium. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature A8, scenario R13 (`spur feature show A8`).
- 0992 Review residual P2 (restart-plus-reload for a changed selection).
- `apps/server/src/serve.ts:706`, `:1042`; `apps/server/tests/board-modules.test.ts:262-312`, `:319-360`.
- `apps/web/tests/modules/composed-board-browser.test.ts:141-170` (`altCatalog`), `:419-470`.
- 0997 (cancelled) — switcher path.

### History

- 2026-09-29T03:18:42.641Z backlog → todo (system)
- 2026-09-29T03:58:48.454Z todo → wip (system)
- 2026-09-29T04:44:43.963Z wip → testing (system)
- 2026-09-29T04:45:41.866Z testing → done (system)

