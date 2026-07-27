---
template: feature-impl
schema_version: 1
name: "apps/web: eliminate the standing React act() warning in the features test suite"
description: ""
status: done
type: task
profile: standard
feature_id: F8
parent_wbs: null
priority: P3
tags: ["web", "tests", "hygiene", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.207Z"
updated_at: "2026-07-27T06:10:40.239Z"
---

## 0342. apps/web: eliminate the standing React act() warning in the features test suite

### Background

From the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, finding P4).

Every run of `bun test tests/modules/features/` prints "An update to FeaturesShell inside a test was not wrapped in act(...)". The suite passes (37/37 as of 2026-07-26) and the warning is pre-existing — `FeaturesShell.tsx` was not touched by feature R2, which changed only `FeatureTree.tsx`, `status-icons.tsx`, and `global.css`.

It is not a one-line fix. `components.test.tsx` renders `<FeaturesShell />` at eight sites, and the obvious suspects are already correctly awaited via `waitFor`, so the stray update is landing outside `act` from somewhere less direct — a likely candidate is the render at `:638` in the 'renders empty and error states' test, which is never unmounted before `afterEach` cleanup runs while a fetch promise is still settling.

The cost of leaving it is that a real act() warning introduced later will be invisible in the noise.

### Requirements
R1. Diagnose which render site and which state update produce the warning — do not blanket-wrap every interaction in `act()` to silence it, which would hide the cause rather than fix it.

R2. Fix the root cause so `bun test tests/modules/features/` runs warning-free, most likely by ensuring every rendered tree is unmounted or fully settled before the test ends.

R3. Keep all existing assertions and the current pass count intact; this is hygiene, not a behavior change.

R4. Do not suppress the warning via console filtering, reporter configuration, or a test-level mute.

R5. Confirm the wider `apps/web` suite is unaffected. Note that `tests/lib/rpc-client.test.ts` reports 2 pre-existing failures under a sandboxed shell (`Bun.serve` EADDRINUSE port-bind denial) which are environmental and out of scope here.
### Acceptance Criteria
**AC1: Warning-free features suite (R1, R2, R3)**

```gherkin
Scenario: Features test suite runs without act() warnings
  Given the test file `apps/web/tests/modules/features/components.test.tsx`
  When `bun test tests/modules/features/` runs
  Then stdout/stderr contains no "An update to FeaturesShell inside a test was not wrapped in act(...)" line
  And the pass count remains 37 (no test removed or skipped)
  And all existing assertions remain unchanged
```

**AC2: Root cause diagnosed, not masked (R1, R4)**

```gherkin
Scenario: The fix settles the stray async update rather than suppressing output
  Given the diagnosis identifies the `feature.updated` SSE test as the source
  When the fix is applied
  Then the fix waits for the pending `load()` fetch to settle (or unmounts the tree before the fetch resolves)
  And no console filter, reporter mute, or blanket `act()` wrap is introduced
```

**AC3: Wider apps/web suite unaffected (R5)**

```gherkin
Scenario: The rest of the apps/web test suite is not regressed
  When `bun test` runs in `apps/web/`
  Then no new failures are introduced by this change
  And the 2 pre-existing `rpc-client.test.ts` EADDRINUSE failures (environmental, sandboxed shell) remain out of scope
```
### Q&A
**Q1: Which test produces the warning?**

A: Isolated runs confirm the warning comes from exactly one test: `a feature.updated SSE frame refreshes the open detail panel` (`components.test.tsx:596`). Every other test in the suite runs clean in isolation, including the sibling `an unrelated SSE frame does not refresh the detail panel` (`:615`).

**Q2: Why does only this test warn?**

A: Both SSE tests fire `es.onmessage(...)`, which synchronously invokes `void load()` (an async tree fetch) plus, for `feature.updated`, `setDetailRefreshKey((n) => n + 1)`. The `feature.updated` test asserts only the detail-panel refresh via `waitFor`, and the tree `load()` fetch resolves after the test returns. The sibling `unrelated SSE` test does not nudge `refreshKey`, so it can't assert on the detail panel — instead it inserts `await new Promise((r) => setTimeout(r, 20))` (`:626`) before its sync assertion, which incidentally lets the tree fetch settle inside the test. The `feature.updated` test has no such settling wait.

**Q3: Is the bug in the source or the test?**

A: The test. `FeaturesShell.onmessage` is correct: any `feature.*` event refreshes the tree, and `feature.updated`/`feature.transitioned` additionally nudge the detail panel. The warning is a test hygiene issue — the test ends before the async tree refetch settles. R1 explicitly forbids masking the cause; the fix belongs in the test.

**Q4: Why not wrap `es.onmessage(...)` in `act()`?**

A: That would silence the warning without fixing the race. The `onmessage` call itself is sync; the stray update is the *delayed* `setFeatures(data)` inside the `load()` closure. Wrapping the sync dispatch in `act` does not capture the later microtask. The real fix is to let the fetch settle (or unmount) before the test ends.

**Q5: Why not unmount the tree before the test ends (R2 alternative)?**

A: Unmounting would also work — `cleanup()` runs in `afterEach` anyway — but an explicit `unmount()` before the assertion does not help here because the pending `load()` fetch still resolves after unmount and still calls `setFeatures` on an unmounted component. React 18 `useSyncExternalStore`/`useState` after unmount is a no-op warning-free, but `setFeatures` on a still-mounted component (the test hasn't returned) is the actual stray. The cleanest fix is to await the tree fetch's effect, mirroring the sibling test's settling wait.
### Design
**Decision: Test-only fix — await the tree refetch after the SSE dispatch in the `feature.updated` test.**

The root cause is a test that ends before an async update settles. The source (`FeaturesShell.onmessage`) is correct and unchanged.

**Fix shape**

After `es?.onmessage?.(...)` at `components.test.tsx:610`, the `waitFor` at `:612` asserts the detail panel refreshed, but the parallel `void load()` tree fetch is still in flight. When it resolves after the test returns, `setFeatures(data)` fires outside `act`.

The fix mirrors the sibling `unrelated SSE` test's settling pattern (`:626`): after the detail-panel `waitFor`, add a short `waitFor` that confirms the tree fetch settled. The fetch mock is synchronous, so a single `await waitFor(() => expect(calls.some((url) => url.includes('/features'))).toBe(true))` — or, simpler, a `await new Promise((r) => setTimeout(r, 0))` — lets the microtask drain inside `act`.

**Chosen approach:** add a `await new Promise((r) => setTimeout(r, 0))` after the `waitFor` at line 612. This:
- Lets the pending `load()` fetch resolve and its `setFeatures` update flush inside the test boundary (React testing-library wraps pending updates in `act` when `waitFor`/eventual settling is inside the test).
- Does not mask the warning — it genuinely lets the update land.
- Matches the sibling test's `:626` pattern (20ms vs 0ms — both work because the fetch mock is sync; 0ms is enough since `setTimeout(0)` drains the microtask queue after the sync fetch resolves).
- No source change, no assertion change, no test removed.

**Tradeoffs considered**

|Option|Pro|Con|Verdict|
|---|---|---|---|
|Settle wait in test (chosen)|Root-cause fix; matches sibling pattern; zero source risk|Adds 0ms `setTimeout` to one test|**Yes**|
|Unmount before fetch resolves|R2-suggested; clean separation|Unmount does not cancel the fetch — `setFeatures` on unmounted component is a no-op, but the warning fires before unmount reaches cleanup; fragile|No|
|Wrap `onmessage` in `act()`|One-line|R1 forbids; doesn't capture the delayed microtask anyway|No|
|Suppress console in test|R4 explicitly forbids|Hides future real warnings|No|

**Invariants**

- All 37 tests pass; no assertion weakened.
- No source change to `FeaturesShell.tsx` or any production code.
- No new `act` import; no blanket wrap.
- The fix is local to the one test that reproduces the warning.
### Plan
1. **Isolate the warning** — run each FeaturesShell test in isolation via `bun test -t "<name>"`; confirm the single offending test (`a feature.updated SSE frame refreshes the open detail panel`, `components.test.tsx:596`). ✅ done in diagnosis.

2. **Confirm the mechanism** — read `FeaturesShell.tsx:86-107` (`onmessage` handler) and the test at `:596-613`; verify the stray update is the delayed `setFeatures(data)` from `void load()` resolving after the test's final `waitFor`. ✅ done in diagnosis.

3. **Apply the fix** — after the `await waitFor(...)` at `components.test.tsx:612`, insert `await new Promise((r) => setTimeout(r, 0));` to drain the pending tree fetch inside the test boundary. No source change.

4. **Verify warning-free** — run `cd apps/web && bun test tests/modules/features/`; confirm 37 pass, 0 fail, zero `act(...)` warnings in output.

5. **Verify suite-wide** — run `cd apps/web && bun test`; confirm no new failures beyond the 2 pre-existing `rpc-client.test.ts` EADDRINUSE environmental failures (R5).

6. **Lint** — `cd /Users/robin/xprojects/spur-new && bun run lint` (Biome); confirm clean.

7. **Typecheck** — `cd /Users/robin/xprojects/spur-new/apps/web && bunx tsc --noEmit`; confirm clean.
### Solution
**Single test-only change in `apps/web/tests/modules/features/components.test.tsx`.**

**Import (line 3):** added `act` to the `@testing-library/react` import.

```diff
-import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
+import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
```

**Test `a feature.updated SSE frame refreshes the open detail panel` (line 596, dispatched at `:610`):** wrapped the external SSE `onmessage` dispatch in `await act(async () => { ... })`.

```diff
-        es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));
-
+        await act(async () => {
+            es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));
+        });
         await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('verifying'));
```

**Why this works**

The SSE `onmessage` handler in `FeaturesShell.tsx:90-101` fires `void load()` (an async tree refetch) and `setDetailRefreshKey((n) => n + 1)`. The `load()` fetch resolves as a chain of microtasks (`fetchWithTimeout` → `.finally` → `await res.json()` → `setFeatures`). Without `act`, the test's `waitFor` passes as soon as the *detail panel* shows 'verifying', but the tree `load()` fetch is still in flight — its `setFeatures(data)` lands after the test returns and fires outside `act`, producing the warning.

`await act(async () => { ... })` flushes all pending microtasks (including the fetch chain) after the sync `onmessage` dispatch returns, so `setFeatures` lands inside the test boundary. The subsequent `waitFor` still asserts the detail panel refreshed to 'verifying'.

**Why not `setTimeout(0)` (the sibling test's pattern)**

The sibling `unrelated SSE` test uses `await new Promise((r) => setTimeout(r, 20))` (`:626`) to settle the fetch. A `setTimeout(0)` was tried first and did NOT suppress the warning — the fetch chain has multiple `await` hops (`fetchWithTimeout` → `.finally` → `res.json()` → `loadFeatures` → `load` → `setFeatures`), and `setTimeout(0)` is a single macrotask that only drains microtasks queued before it; the chained `await` hops each schedule a new microtask after the previous resolves, and a single `setTimeout(0)` does not span them. `act` is the correct tool: it recursively flushes microtasks until the queue is empty.

**What did NOT change**

- `FeaturesShell.tsx` — unchanged. The `onmessage` handler is correct: tree refetch on any `feature.*` event, detail nudge on `feature.updated`/`feature.transitioned`.
- No assertions removed. The 4 expects in this test are all preserved; the suite total dropped from 204 → 203 because `waitFor` no longer needs a retry poll to observe 'verifying' — `act` already flushed the state, so the first `waitFor` check passes.
- No console filtering, reporter mute, or blanket `act()` wrap (R1, R4 satisfied).
### Testing
**Commands run and outcomes:**

|Command|Result|
|---|---|
|`cd apps/web && bun test tests/modules/features/components.test.tsx -t "feature.updated SSE frame refreshes"` (pre-fix)|1 pass, **warned** — "An update to FeaturesShell inside a test was not wrapped in act(...)"|
|Same command (post-fix)|1 pass, **0 warnings**, 4 expect() calls|
|`cd apps/web && bun test tests/modules/features/` (post-fix)|37 pass, 0 fail, **0 warnings**, 203 expect() calls|
|`cd apps/web && bun test` (full web suite)|524 pass, 0 fail, 1664 expect() calls — no regressions|
|`bun run lint` (Biome + typecheck)|Clean — all 7 workspaces typecheck green|
|`git diff apps/web/tests/modules/features/components.test.tsx`|2-line diff: import + `act` wrap|

**Coverage claim:** N/A — test-only hygiene fix, no production code changed.

**R5 note:** The 2 pre-existing `rpc-client.test.ts` EADDRINUSE failures mentioned in the task did not manifest in this environment (524/524 pass). They are environmental (sandboxed shell port-binding) and out of scope.
### Review
| Severity | Finding | Disposition |
|---|---|---|
| P1 | None | — |
| P2 | None | — |
| P3 | The `act` wrap is the idiomatic fix for external event dispatchers (React docs: "Wrap outside events in act"). Not a blanket wrap — targets the single `onmessage` dispatch that starts async state updates. | Accepted — matches React testing guidance. |
| P4 | The sibling `unrelated SSE` test (`:618`) uses `setTimeout(20)` rather than `act`. Consistent style would prefer both tests use the same settling pattern. | Left as-is — `setTimeout(20)` works for the sibling because its fetch resolves within a single macrotask window (no chained `await` hops that escape `setTimeout(0)`). The `feature.updated` test has the detail-panel `waitFor` which the sibling lacks, so the patterns legitimately differ. Not worth churning the sibling test. |

**Residual risk:** None. The fix is test-only and additive (wrapping an existing dispatch in `act`). No production behavior change, no assertion weakened, no test removed.

**Verification:**
- R1 (diagnose, don't blanket-wrap): ✅ isolated the single offending test; `act` wraps one dispatch, not every interaction.
- R2 (fix root cause): ✅ the stray `setFeatures` now flushes inside `act` rather than after the test.
- R3 (assertions + pass count intact): ✅ 37 pass; all 4 expects in the fixed test preserved.
- R4 (no suppression): ✅ no console filter, reporter mute, or test-level mute.
- R5 (wider suite): ✅ 524 pass, 0 fail.

**Final disposition:** PASS — ready for `done`.
### References
- **Task background**: `docs/dogfood/2026-07-26-dev-verifyall-dogfood.md` finding P4 (2026-07-26 dogfood).
- **Offending test**: `apps/web/tests/modules/features/components.test.tsx:596` (`a feature.updated SSE frame refreshes the open detail panel`).
- **Source under test**: `apps/web/src/modules/features/FeaturesShell.tsx:86-107` (SSE `onmessage` handler — unchanged).
- **Sibling test pattern**: `apps/web/tests/modules/features/components.test.tsx:618` (`an unrelated SSE frame does not refresh the detail panel`) — uses `setTimeout(20)` settling wait.
- **React act() docs**: https://react.dev/link/wrap-tests-with-act
- **Parent feature**: F8.
### History
- 2026-07-27T06:04:52.357Z todo → wip (system)
- 2026-07-27T06:10:39.689Z wip → testing (system)
- 2026-07-27T06:10:40.239Z testing → done (system)
