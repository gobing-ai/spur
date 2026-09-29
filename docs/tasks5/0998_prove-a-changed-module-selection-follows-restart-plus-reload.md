---
schema_version: 1
name: Prove a changed module selection follows restart plus reload end to end
status: backlog
template: feature-impl
created_at: 2026-09-29T03:05:27.931Z
updated_at: "2026-09-29T03:06:48.238Z"
feature_id: A8

---

## 0998. Prove a changed module selection follows restart plus reload end to end

### Background

A8 R4 states: "Prove changes follow restart plus browser reload, and enabled modules under a compatible
project `dist/web` override work while incompatible overrides fail clearly before listen; no-module
legacy overrides remain usable."

The **mechanism** is proven. A **changed selection** is not driven end to end.

What 0992 established:
- Module assets are served `no-store`, so a restart plus reload cannot be masked by a cached chunk
  (`apps/web/tests/modules/composed-board-browser.test.ts:458` — asserts `cache.entry === 'no-store'`).
- Leaving and returning to a module mounts it fresh, with no retained in-page state.
- The server-side halves — the catalog snapshot being built before the listener opens, and an
  incompatible enabled override being refused before listen — are owned by
  `apps/server/tests/board-modules.test.ts` (0989) and run green inside the feature gate.

What is missing: no test changes a module selection (edits the declaration, or rebuilds/replaces a
served native asset), restarts the project server, reloads the browser, and observes that the **updated**
selection and assets are what render. R4's "the updated module selection/assets appear after
restart/reload" clause is therefore established by inference from mechanism rather than by one run.

**Evidence**
- `apps/web/tests/modules/composed-board-browser.test.ts:458` — the only R4-labelled case; it asserts
  the cache header, not a changed selection.
- 0992 Review residual (P2): "R4's restart-plus-reload for a *changed* selection is not driven
  end-to-end in a browser here" — disclosed and never closed.
- `apps/web/tests/modules/composed-board-browser.test.ts` serves one catalog per server instance; no case
  restarts a server with a different catalog.

**Why it matters**
"Edits the config, restarts, reloads, sees the change" is the operator-visible promise of the whole
slice. Today a regression that pinned the catalog at first composition, or that served a cached
stylesheet despite `no-store`, would be caught only by mechanism-adjacent tests, not by the outcome.

### Requirements

- [ ] R1. Drive a changed selection end to end: change a project's module declaration (and/or replace its
  served native asset), restart the project server, reload the browser, and assert the **updated**
  selection and assets are what render.
- [ ] R2. Assert no live replacement: with the same change applied, the already-running Board does not
  pick it up before the restart. This is the clause that makes R1's positive result meaningful.
- [ ] R3. Assert the incompatible-override path fails before the listener opens for that fixture — the
  process must refuse to start, not start and serve a broken catalog.
- [ ] R4. Assert a no-module (legacy) override stays usable, so the change path does not regress the
  built-ins-only deployment.
- [ ] R5. Reuse the existing composed fixtures and CDP harness; keep the proof a real-browser proof.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Module selection changes use the documented restart lifecycle (req: R4)
  Given a running project server whose Board has composed a module catalog and rendered a module
  When the module declaration or its served asset changes
  Then the running Board does not pick up the change
  And after the server restarts and the page reloads, the updated selection and assets are what render
  And an incompatible enabled override fails before listening while a no-module project still serves the built-ins
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Fix direction**

- Add the changed-selection case to `apps/web/tests/modules/composed-board-browser.test.ts`, using the
  proof server helper to (a) serve an initial catalog, (b) serve a changed catalog and/or replaced asset
  after a restart. Confirm how the helper binds a catalog to a server instance before extending it —
  0992's `serveBoard` (`apps/web/tests/test-helpers/board-server.ts`) currently serves one catalog per
  instance, so the restart likely means stopping and starting a new instance with new inputs.
- The "no live replacement" assertion (R2) is the load-bearing one: without it, a test that changes the
  fixture and then restarts proves little.
- Prefer reusing `apps/server/tests/board-modules.test.ts` for the before-listen refusal (R3) if that
  path is already covered there rather than duplicating server-level coverage in a browser test; state
  in Testing which of R3/R4 is proven here and which is inherited, with the owning test named.

**Constraints**

- Do not add live replacement, file watching, or HMR to make this easier — R4 explicitly forbids it, and
  a passing live-reload test would contradict the requirement.
- Keep the proof in `apps/web`; server-level refusal coverage stays in `apps/server`.

**Out of scope**

- The project switcher mechanism (filed separately).
- Any new runtime capability.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
