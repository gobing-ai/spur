---
schema_version: 1
name: "Prevent System Events overscroll from displacing the Board viewport"
status: done
template: issue
created_at: 2026-08-25T00:12:13.257Z
updated_at: "2026-08-25T00:41:01.844Z"
feature_id: J92
ac_altitude: task-local
---

## 0656. Prevent System Events overscroll from displacing the Board viewport

### Background

System Events can grow beyond one viewport after its historical page is loaded or “Load older” appends rows. At the bottom, continued trackpad scrolling moves the root document instead of remaining inside the Board workspace, exposing an almost blank canvas. History Timeline does not exhibit the visible failure because its content path does not expose the same unconstrained flex sizing as readily.

### Requirements

- [x] R1. Keep the Board shell fixed to one viewport and prevent the root document from becoming a second vertical scroll owner.
- [x] R2. Let the MainWorkspace content flex item shrink below its intrinsic content height so long module content scrolls inside the workspace.
- [x] R3. Preserve existing module rendering, mobile header behavior, and System Events horizontal table overflow.
- [x] R4. Add a focused regression check for the viewport and scrollport layout contract.

### Acceptance Criteria

- [x] Long System Events history remains inside the Board viewport when the operator reaches the bottom and continues scrolling.
- [x] The document stays fixed while vertical scrolling remains owned by the MainWorkspace content region.
- [x] Existing module content and horizontal table overflow remain functional.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Constrain the existing shared MainWorkspace flex chain instead of adding tab-specific height logic. Give the workspace an explicit full height, allow its content child to shrink with `min-h-0`, and lock document overflow while the existing 100vh Board grid owns the viewport. “Load older” remains unchanged because it only exposes the shared layout defect.

### Plan

1. Reproduce the missing viewport/scrollport invariants against HEAD.
2. Compare the Board, MainWorkspace, Observability, and History layout chains.
3. Fix the shared height and scroll ownership boundary.
4. Add one focused regression test and run the web typecheck/tests.

### Root Cause

`MainWorkspace` did not fill its 100vh grid cell and its `flex-1 overflow-auto` child retained the default `min-height: auto`. Long System Events content therefore contributed its intrinsic height to the grid/flex chain instead of being bounded as the workspace scrollport. Because `html`/`body` also retained default overflow, the browser could scroll the root document after the inner content reached its end, displacing the fixed Board and exposing blank canvas. The Load older footer is only the height trigger; its layout is not causal.

### Solution

- `apps/web/src/components/MainWorkspace.tsx:8`: bind the shared workspace to its grid-cell height and make its content child a shrinkable vertical scrollport.
- `apps/web/src/styles/board-layout.css:1`: lock `html`/`body` overflow and cap the existing Board grid at one viewport so the document cannot become a second scroll owner.

No System Events pagination or table code changed; “Load older” continues to append rows normally inside the corrected shared scroll boundary.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `apps/web/src/styles/board-layout.css:21` anchors the BoardLayout viewport rule while the same stylesheet locks document overflow; `bun run spur-check` passes. |
| R2 | MET | `apps/web/src/components/MainWorkspace.tsx:8` bounds the workspace and gives its content scrollport `min-h-0`; `bun run spur-check` passes. |
| R3 | MET | `bun run spur-check` passes the full BoardLayout suite (14/14) and all 6,336 repository tests while the diff leaves System Events table code unchanged. |
| R4 | MET | `apps/web/tests/components/BoardLayout.test.tsx:151` encodes the viewport/scrollport contract and passes within `bun run spur-check`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Long System Events history remains inside the Board viewport when the operator reaches the bottom and continues scrolling. | MET | test | The named regression at `apps/web/tests/components/BoardLayout.test.tsx:151` passes within `bun run spur-check`. |
| The document stays fixed while vertical scrolling remains owned by the MainWorkspace content region. | MET | test | `apps/web/tests/components/BoardLayout.test.tsx:151` verifies the root overflow lock, full-height workspace, and shrinkable inner scrollport; `bun run spur-check` passes. |
| Existing module content and horizontal table overflow remain functional. | MET | test | `bun run spur-check` passes the full BoardLayout suite (14/14); no System Events table or pagination code changed. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | tests-pass | — | `bun run spur-check` passes 6,336 tests with 0 failures. |
| P4 | lint-clean | — | `bun run spur-check` passes Biome and every workspace typecheck. |
| P4 | test-cf | — | `bun run test-cf` passes 1/1. |
| P4 | build | — | `bun run build` exits 0 for CLI, server, and web. |
| P4 | design-conformance | — | The implementation matches the task Design: one shared MainWorkspace flex fix plus document scroll lock; no tab-specific workaround. |
| P4 | scope-creep | — | All three task-local diff hunks map to R1-R4; no dependency or public surface was added. |
| P4 | secua-review | — | Security, efficiency, correctness, usability, and architecture review found no P1-P3 issue. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-08-25T00:14:01.537Z todo → wip (system)
- 2026-08-25T00:17:20.865Z wip → testing (system)
- 2026-08-25T00:41:01.844Z testing → done (system)
