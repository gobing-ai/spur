---
name: Add ActionResult.setVars to ts-dual-workflow-engine for cross-action variable flow (F1)
description: Add ActionResult.setVars to ts-dual-workflow-engine for cross-action variable flow (F1)
status: done
created_at: 2026-06-10T00:46:55.023Z
updated_at: 2026-06-10T01:02:04.492Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0033. Add ActionResult.setVars to ts-dual-workflow-engine for cross-action variable flow (F1)

### Background

**This is the keystone dependency for task 0032's session latch and cross-action data flow.** It is an
**engine-level change in `~/xprojects/ts-libs/packages/dual-workflow-engine`**, not a spur-new change.

Today an action's output (`ActionResult.data`) is readable only by the **immediately next guard** via
`context.lastActionResult` — it cannot write a run variable that a **later state/node** reads. This
caps the usefulness of `file.read` (content goes nowhere), `http.request` (response goes nowhere), and
blocks the `agent.run` **session latch** in 0032 (which needs to set `__agentSession` after the first
agent call so subsequent calls auto-continue). Adding a way for an action to merge values back into the
run's `vars` unlocks all three.

Verified against the engine source (state-machine.ts):
- `const vars = mergeVars(workflow.vars, options.vars)` is computed **once** (line ~44) and is
  effectively immutable across the loop.
- `lastActionResult` is already threaded per step (lines ~48, ~75, ~114).
- `resolveTemplates(action.options, { vars, … })` reads `vars` on every action (line ~149).
- `Vars = Record<string, string>`; `ActionResult = { ok, data?, error?, terminal? }`.

So the change is small and localized: make the loop's `vars` mutable and merge `result.setVars` after
each action settles, in **both** drivers.

### Requirements

1. Add `setVars?: Vars` to the `ActionResult` interface (`src/types.ts`).
2. **State-machine driver:** after each `onEnter`/`onExit` action settles, if `result.setVars` is
   present, merge it over the loop-local `vars` (override semantics, same as `mergeVars`). Subsequent
   `resolveTemplates` calls in the same run see the new values.
3. **Transition-flow driver:** identical behavior after each node action.
4. Merge is **shallow string→string override** (`Vars` is `Record<string,string>`); reject/ignore
   non-string values defensively (the action layer should never produce them, but fail safe).
5. Precedence + timing: `setVars` from a step is visible to **all subsequent** template resolutions and
   guards in the run, not to the step that produced it. Document the ordering.
6. Persistence: the merged `vars` are run-scoped; no new schema. (Optionally surface final `vars` in the
   run record — decide in design; not required for 0032.)
7. Tests in the engine's suite: a two-step workflow where step 1 `setVars: {x:"1"}` and step 2's action
   option `${vars.x}` resolves to `"1"`; same for transition-flow; a guard observing a set var.
8. No change to the public `WorkflowRunOptions`/`run` signature. Backward compatible (absent `setVars`
   = today's behavior).

### Q&A

**Q1. Why engine-level, not a downstream workaround?** Variable lifetime is the engine's concern — it
owns `mergeVars`, the loop, and `resolveTemplates`. A downstream shim cannot inject into the loop's
`vars` between steps. (Robin's standing rule: enhance the owning `@gobing-ai/ts-*` package rather than
pad downstream.)

**Q2. Does this need a new ADR?** It extends an existing public type (`ActionResult`) additively and
changes internal loop behavior — no transport/boundary/storage swap. A dated note in the engine's docs
suffices unless design surfaces a cross-cutting consequence (e.g. persisting final vars).

**Q3. Could `setVars` clobber workflow-defined `vars`?** Yes by design (override semantics) — that's the
point (a latch flips a default). Namespacing convention: internal/engine-set vars use a `__` prefix
(`__agentSession`) to avoid colliding with author vars. Document it.

### Design

- Scope: Add `setVars?: Vars` to `ActionResult` and merge into the loop-local `vars` after each action settles in both state-machine and transition-flow drivers.
- Key decision: Make loop `vars` mutable (change `const` to `let`) and call `mergeVars(vars, result.setVars)` after each action — simple, localized, backward-compatible.
- Boundaries affected: `src/types.ts` (ActionResult), `src/variables.ts` (defensive merge helper), `src/state-machine.ts` (loop), `src/transition-flow.ts` (loop), engine test suite.
- Risks: `setVars` can clobber workflow-defined `vars` by design (override semantics) — documented with `__` prefix convention for internal vars.


### Solution

1. Add `setVars?: Vars` to the `ActionResult` interface (`src/types.ts:121-126`).
2. Add `mergeSetVars` helper in `src/variables.ts` that filters non-string values defensively, then delegates to `mergeVars`.
3. State-machine driver (`src/state-machine.ts`): change `const vars` to `let vars` (line 44); after enter actions merge `enter.result.setVars` (line 75-76); after exit actions merge `exit.result.setVars` (line 114).
4. Transition-flow driver (`src/transition-flow.ts`): change `const vars` to `let vars` (line 42); after action execution merge `lastActionResult.setVars` (after line 68-75).
5. Engine tests: two-step workflow verifying cross-step variable visibility in both drivers; guard reading a set var.
6. Build + version bump + release; bump spur's catalog.


### Plan

1. Add `setVars?: Vars` to `ActionResult` (`src/types.ts`).
2. State-machine driver: make `vars` mutable; merge `result.setVars` after each action settles.
3. Transition-flow driver: mirror the merge after each node action.
4. Defensive string-only merge helper (reuse/extend `mergeVars`).
5. Engine tests (both drivers + a guard reading a set var).
6. Verify with the engine's own gate; build + version-bump + release; bump spur's catalog so 0032 can
   consume it.


### Review


---

## Re-verification (dev-verify --force) — 2026-06-10

**Verdict: PASS** (independent re-audit of the Done task against real `ts-libs` source).
**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** current (dogfood — engine change) · **Focus:** all

### Phase 8 — Requirements traceability (verified against source, not the self-report)

| Req | Verified at | Status |
|-----|-------------|--------|
| R1 `setVars?: Vars` on `ActionResult` | `src/types.ts:127` | MET |
| R2 state-machine merges after enter/exit | `src/state-machine.ts:76,115` (`let vars` @44) | MET |
| R3 transition-flow merges after node action | `src/transition-flow.ts:84` (`let vars` @42) | MET |
| R4 defensive string-only merge | `src/variables.ts:23-30` `mergeSetVars` (filters non-strings, delegates to `mergeVars`) | MET |
| R5 visible to subsequent steps, not producer | confirmed: action resolves templates with pre-merge `vars` (sm:150-151) BEFORE the post-action merge (sm:76); guard@94, exit@107, next iteration@64 read updated `vars` | MET |
| R6 run-scoped, no schema change | merge is loop-local; no persistence/schema touched | MET |
| R7 tests both drivers + guard | `tests/state-machine.test.ts:377-415` (cross-step) + `:417` (guard sees var); `tests/transition-flow.test.ts`; `tests/edge-cases.test.ts` | MET |
| R8 backward compatible, no signature change | `setVars?` optional; `WorkflowRunOptions`/`run` unchanged | MET |

### Phase 7 — SECU
- **Security:** `mergeSetVars` is a pure string-filtering function — no injection/secret/auth surface. Defensive non-string drop prevents type confusion at the engine boundary. Clean.
- **Correctness:** ordering proven correct (merge strictly after the producing action's own resolution → R5 holds); `let vars` reassignment propagates to each `runActions` call (no stale-closure). Clean.
- **Efficiency / Usability:** O(keys) shallow merge per action; `mergeSetVars` exported; `__`-prefix convention documented. Clean.

### Gate (independently re-run)
- `tsc --noEmit` → clean.
- `bun test` → **193 pass / 0 fail** (matches the task's claim).

### Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Cross-step test asserts status only, proves var visibility indirectly | Usability (test quality) | `tests/state-machine.test.ts:410-414` | P4 — strengthen by asserting the reader's `data.resolved === '42'` directly rather than relying on "would throw if missing". The guard test (`:417`) already does direct assertion; non-blocking. |

No P1/P2/P3 findings. `--fix all` requested → only a P4 test-quality suggestion remains; no mechanical blocker/warning fixes to apply. Verdict stands: **PASS**.


### Requirements Traceability

| Req | Description | Status |
|-----|-------------|--------|
| R1 | Add `setVars?: Vars` to `ActionResult` | PASS — `src/types.ts:127` |
| R2 | State-machine merges setVars after enter/exit actions | PASS — `src/state-machine.ts:76,115` |
| R3 | Transition-flow merges setVars after node action | PASS — `src/transition-flow.ts:84` |
| R4 | Defensive string-only merge | PASS — `src/variables.ts:24-28`, tested |
| R5 | Precedence: visible to subsequent steps, not current | PASS — vars merged AFTER action settles |
| R6 | Run-scoped, no persistence change | PASS — vars loop-local, no schema change |
| R7 | Tests: two-step + guard + both drivers | PASS — 7 new tests, 193 total |
| R8 | Backward compatible, no signature change | PASS — `setVars` optional, additive |

### Verdict

**PASS** — All 8 requirements satisfied. 193/193 tests passing. Typecheck clean. Backward compatible.


### Requirements Traceability

| Req | Description | Status |
|-----|-------------|--------|
| R1 | Add `setVars?: Vars` to `ActionResult` | PASS — `src/types.ts:127` |
| R2 | State-machine merges setVars after enter/exit actions | PASS — `src/state-machine.ts:76,115` |
| R3 | Transition-flow merges setVars after node action | PASS — `src/transition-flow.ts:84` |
| R4 | Defensive string-only merge (reject non-string) | PASS — `src/variables.ts:24-28`, tested |
| R5 | Precedence: setVars visible to subsequent steps, not current | PASS — vars merged AFTER action settles |
| R6 | Run-scoped, no persistence change | PASS — vars are loop-local; no schema change |
| R7 | Tests: two-step + guard + both drivers | PASS — 7 new tests, 193 total |
| R8 | Backward compatible, no signature change | PASS — `setVars` optional; additive export |

### Verdict

**PASS** — All 8 requirements satisfied. 193/193 tests passing. Typecheck clean. Backward compatible.


### Security
- No new auth/secret/crypto surface. `setVars` is a pass-through string map; no injection risk (template resolution already guards against undefined vars via `WorkflowValidationError`).
- Defensive non-string filtering in `mergeSetVars` prevents type confusion at the engine boundary.

### Error Handling
- `mergeSetVars` is a pure function — no I/O, no throws. Non-string values silently dropped.
- Both drivers merge `setVars` after action settle — on `fail` policy, run stops before next step so vars don't matter; on `continue` policy, vars are merged before continuing (tested).

### Correctness
- `ActionResult` extended additively — absent `setVars` is backward-compatible (no existing code breaks).
- `const vars → let vars` in both drivers is the minimal change; no other mutation paths introduced.
- Precedence: `setVars` overrides existing vars (by design), matching `mergeVars` semantics.

### Usability
- `setVars` is a simple `Record<string, string>` — actions return it inline with their result.
- `__` prefix convention documented for internal/engine vars to avoid author collisions.
- `mergeSetVars` exported from public API for consumers.

## Requirements Traceability

| Req | Description | Status |
|-----|-------------|--------|
| R1 | Add `setVars?: Vars` to `ActionResult` | PASS — `src/types.ts:127` |
| R2 | State-machine merges setVars after enter/exit actions | PASS — `src/state-machine.ts:76,115` |
| R3 | Transition-flow merges setVars after node action | PASS — `src/transition-flow.ts:84` |
| R4 | Defensive string-only merge (reject non-string) | PASS — `src/variables.ts:24-28`, tested in edge-cases |
| R5 | Precedence: setVars visible to subsequent steps/guards, not current step | PASS — `vars` merged AFTER action settles; `resolveTemplates` called before action |
| R6 | Run-scoped, no persistence change | PASS — vars are loop-local; no schema change |
| R7 | Tests: two-step workflow + guard reading + both drivers | PASS — 7 new tests, 193 total passing |
| R8 | Backward compatible, no signature change | PASS — `setVars` is optional; `mergeSetVars` exported additively |

## Verdict

**PASS** — All 8 requirements satisfied. 193/193 tests passing. Typecheck clean. Backward compatible.


### Testing

- Command: `bun test` in `~/xprojects/ts-libs/packages/dual-workflow-engine`
- Scope: All 193 engine tests including 7 new setVars tests (cross-step visibility, guard reading, onExit flow, continued-failure merge, defensive filtering unit test)
- Result: 193 pass, 0 fail, 364 expect() calls. Typecheck clean.
- Evidence: 
  - State-machine: `setVars from step 1 is visible to step 2 template resolution` ✓
  - State-machine: `setVars is visible to a guard reading the var` ✓
  - State-machine: `onExit setVars visible to subsequent state onEnter` ✓
  - Transition-flow: `setVars from node 1 is visible to node 2 template resolution` ✓
  - Transition-flow: `setVars is visible to an edge condition reading the var` ✓
  - Transition-flow: `setVars from a continued-failure action is still merged` ✓
  - Edge-cases: `mergeSetVars filters non-string values defensively` ✓ (5 assertions)
- Next action: Catalog bump in spur-new after 0.3.8 release publishes


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


