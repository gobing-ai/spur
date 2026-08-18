---
template: feature-impl
schema_version: 1
name: "Features tree: move status to a fixed leading slot and drop the text label"
description: ""
status: done
type: task
profile: standard
feature_id: F822
parent_wbs: null
priority: P2
tags: ["web", "features", "ui"]
dependencies: ["0332"]
created_at: "2026-07-26T00:26:23.950Z"
updated_at: "2026-08-18T04:42:47.928Z"
---

## 0333. Features tree: move status to a fixed leading slot and drop the text label

### Background

The core slice. apps/web/src/modules/features/FeatureTree.tsx:104-117 renders StatusBadge — an outline Badge holding the SVG plus the raw status string — pinned to each row's trailing edge. At tree density this repeats pill chrome down the panel and produces a ragged right edge from six different word lengths, so the status column competes with the feature names the operator is scanning. Depends on the preceding task having moved the accessible name into the markup; without it, deleting the text label would drop the status for assistive tech. Note apps/web/tests/modules/features/components.test.tsx:318-319 deliberately relies on the tree badge's status text to disambiguate a tree row from the detail pane — that strategy stops working here and must be re-keyed on role or test-id. Design: docs/design/feature-tree-status-affordance.md §1, §6.

### Requirements
R1. Delete `StatusBadge` from `apps/web/src/modules/features/FeatureTree.tsx` and render the status
    indicator as the row button's first child, ahead of the feature id span.

R2. Wrap the indicator in a fixed-width slot (`w-4 shrink-0`, centered) — fixed, not intrinsic — so
    icons form a straight column, the column does not shift as statuses differ down the tree, and a
    future expand/collapse chevron can take an adjacent slot without reflowing the row.

R3. Keep depth indentation on the button's `paddingLeft` so the indicator indents with its row and
    stays optically aligned within each depth level. Remove the `Badge` import if it becomes unused.

R4. Leave no status text and no badge border or background anywhere in the tree.

R5. Keep the indicator visible with its accessible name intact in the selected and hover row states,
    and fully visible when a long feature name truncates.

R6. Rework the four affected assertions in `apps/web/tests/modules/features/components.test.tsx`
    (`:82`, `:139`, `:172`, `:318-319`) to query by accessible name rather than rendered status text.
    `:318-319` is load-bearing — it deliberately uses the tree badge's status text to disambiguate a
    tree row from the detail pane, so re-key that disambiguation on role or test-id.

R7. Add coverage for leading-slot position and for fixed-width alignment across nesting depths.

R8. Assert the Feature detail pane still shows its labelled status pill — that surface is
    deliberately unchanged (ADR-034 scope note).

Depends on task 0332: without its accessible-name work, removing the text label drops the status for
assistive technology.

Satisfies feature AC scenarios R1, R2, R7, R8, R9, R11, R13 — see this task's Acceptance Criteria section.
### Acceptance Criteria
```gherkin
Feature: Features tree status affordance (R2) — task 0333

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R1 — Status indicator renders as the leading element of a tree row
    Given a feature "F1" with status "active" is present in the tree
    When the operator looks at that feature's row
    Then the row's first rendered element is the status indicator
    And the feature id "F1" is rendered after the status indicator
    And the feature name is rendered after the feature id

  @core
  Scenario: R2 — Status text and badge chrome are absent from the tree
    Given a feature "F1" with status "verifying" is present in the tree
    When the row is rendered
    Then the literal text "verifying" does not appear anywhere in the row
    And the status indicator has no border and no background fill

  @core
  Scenario: R7 — Indicators stay optically aligned across nesting depths
    Given a root feature "F" and a nested descendant "F1A" are present in the tree
    When both rows are rendered
    Then each row's status indicator occupies a fixed-width slot of the same width
    And the indicator does not shift horizontally as the status string length changes

  @core
  Scenario: R8 — Selected and hover row states do not obscure the indicator
    Given a feature "F1" with status "done" is present in the tree
    When the operator selects that row
    Then the status indicator remains visible
    And its accessible name is unchanged

  @core
  Scenario: R9 — Long feature names truncate without displacing the indicator
    Given a feature whose name exceeds the panel width is present in the tree
    When the row is rendered
    Then the feature name is truncated
    And the status indicator remains fully visible at its fixed leading slot

  @core
  Scenario: R11 — Existing tree tests assert on accessible name rather than status text
    Given the feature-module component tests exercise the tree
    When the suite runs against the icon-only tree
    Then no test locates a tree row by its rendered status text
    And the suite passes

  @edge
  Scenario: R13 — The detail pane keeps its labelled status pill
    Given the operator selects a feature in the tree
    When the feature detail pane renders
    Then the detail pane still shows the status as a labelled pill
    And the tree's icon-only treatment has not been applied to it

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Delete `StatusBadge` from `FeatureTree.tsx` and render the status indicator as the row
button's first child inside a fixed-width slot:

```tsx
<span className="w-4 shrink-0 flex items-center justify-center">
    <FeatureStatusIcon status={feature.status} />
</span>
```

ahead of the feature-id span. Depth indentation stays on the button's `paddingLeft` (unchanged), so
the slot indents with its row and stays aligned per depth level (R3). Remove the `Badge` import —
`StatusBadge` is its sole consumer in this file. Row layout becomes:
`[w-4 slot][id span shrink-0][name span flex-1 truncate]` — `shrink-0` on slot and id guarantees a
truncating long name never displaces the indicator (R5, AC R9).

**Invariants**

- No status text, no badge border/background anywhere in the tree (AC R2); grep the module for
  `Badge` afterwards.
- Straight indicator column: fixed `w-4` slot, independent of status (AC R7).
- The accessible name from 0332 rides along untouched; selected/hover row styles do not obscure the
  icon (AC R8).
- `FeatureDetail`'s labelled status pill is deliberately out of scope and untouched (ADR-034 scope
  note, AC R13).

**Tests** (`apps/web/tests/modules/features/components.test.tsx`): re-key the assertions at `:82`,
`:139`, `:172` to query by `role="img"` + accessible name; re-key the `:318-319` tree-row vs
detail-pane disambiguation on role or a `data-testid="feature-tree-status"` on the slot (it is
load-bearing — it must not rely on rendered status text). Add coverage for leading-slot position
(first child of the row button) and fixed-width alignment across nesting depths (R7); assert the
detail pane pill still renders (R8).

**Impacted surfaces:** `FeatureTree.tsx`; `components.test.tsx`.
### Plan
- [x] 1. In `FeatureTree.tsx`: delete `StatusBadge` and the now-unused `Badge` import; render the
  fixed `w-4 shrink-0` slot with `FeatureStatusIcon` as the row button's first child.
- [x] 2. Keep span order after the slot: id (`shrink-0`), then name (`flex-1 truncate`); leave
  `paddingLeft` depth indentation untouched.
- [x] 3. Update the four affected assertions (`components.test.tsx:82`, `:139`, `:172`, `:318-319`)
  to accessible-name queries; re-key `:318-319` disambiguation on role/test-id.
- [x] 4. Add tests: indicator is the first child of the row button; fixed-width slot alignment
  across nesting depths; selected/hover states keep the indicator visible; detail pane keeps its
  labelled status pill.
- [x] 5. Run apps/web tests + `bun run lint`.
### Solution
| File | Lines | What / Why |
|---|---|---|
| `apps/web/src/modules/features/FeatureTree.tsx` | 1, 76-80, 101 | Deleted `StatusBadge` and the now-unused `Badge` import; the row button's first child is now a fixed `w-4 shrink-0 flex items-center justify-center` slot (`data-testid="feature-tree-status"`) holding `FeatureStatusIcon`, ahead of the id span (`shrink-0`) and name span (`flex-1 truncate`). Depth indentation stays on the button's `paddingLeft`, so the slot indents with its row and icons form a straight column; shrink-0 slot + truncating name means long names never displace the indicator (R1-R5). Module doc comment updated to describe the icon-only row. |
| `apps/web/tests/modules/features/components.test.tsx` | 143-165, 177-203 | Re-keyed the two tree tests off rendered status text: the flat-list test now locates rows by `svg[aria-label="Active"/"Done"]` and asserts no `>active<`/`>done<` text nodes; the six-statuses test now asserts one `feature-tree-status` slot per row with the capitalized vocabulary label, zero `[aria-label^="Status:"]` remnants, zero `.badge` chrome in the tree, and no raw status text (R6, AC R2/R11). |
| `apps/web/tests/modules/features/components.test.tsx` | 205-275 | New coverage (R7): leading-slot position (slot is the row button's first child, then id, then name — AC R1); fixed-width `w-4 shrink-0` slot identical across depths 0/1/2 with indentation only on the button (AC R7); selected row keeps the `role="img"` icon with its accessible name (AC R8); long names truncate against a `shrink-0` leading slot (AC R9). |
| `apps/web/tests/modules/features/components.test.tsx` | 344-352 | New detail-pane test (R8, AC R13): `FeatureDetail` still renders the labelled status pill (`data-testid="status-pill"`, `rounded-full border`, raw status text) — the icon-only tree treatment is not applied there (ADR-034 scope note). |
| `apps/web/tests/modules/features/components.test.tsx` | 458-460, 466-500 | Re-keyed the load-bearing tree-row vs detail-pane disambiguation (R6 `:318-319`): the mutating-detail mock comment now states the tree renders no status text, and both SSE tests assert on the detail pane's `status-pill` test-id instead of a status-text query a tree badge could satisfy. |

No production-code changes outside `FeatureTree.tsx`; `FeatureDetail` and `status-icons.tsx` are untouched (0332's accessible-name work rides along unchanged).
### Testing
**Verdict: PASS** — verified 2026-07-26 via `/sp-dev-verify 0333 --auto --next` (8/8 requirements MET, 7/7 AC scenarios MET).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/features/FeatureTree.tsx:76-78` — `feature-tree-status` slot is the row button's first child, ahead of the id span; `StatusBadge` deleted; test `components.test.tsx:205-217` asserts child order slot → id → name |
| R2 | MET | `apps/web/src/modules/features/FeatureTree.tsx:76` — `w-4 shrink-0 flex items-center justify-center` (fixed, not intrinsic); `components.test.tsx:219-243` asserts identical slot classes across depths 0/1/2 |
| R3 | MET | `apps/web/src/modules/features/FeatureTree.tsx:73` — `paddingLeft: calc(0.5rem + depth*px)` unchanged on the button; no `Badge` import (grep exit 1, this run); test asserts `padding-left` 0/16/32px per depth |
| R4 | MET | `components.test.tsx:177-203` — zero `[aria-label^="Status:"]`, zero `.badge` in tree, no `>status<` text for all six statuses; grep of `FeatureTree.tsx` for `Badge`/raw status text: no match |
| R5 | MET | `components.test.tsx:245-256` — selected row keeps `role="img"` + `aria-label="Done"`; `:258-272` — `shrink-0` slot vs `flex-1 truncate` name; accessible name from 0332 (`status-icons.tsx`) rides unchanged |
| R6 | MET | flat-list test re-keyed to `svg[aria-label="Active"/"Done"]` (`:143-165`); six-statuses test on accessible-name queries (`:177-203`); SSE tests re-keyed to `getByTestId('status-pill')` (`:484-516`) — load-bearing disambiguation now keys on the detail pane's unique test-id |
| R7 | MET | `components.test.tsx:205-243` — leading-slot position + fixed-width alignment across nesting depths |
| R8 | MET | `components.test.tsx:361-368` — `status-pill` test-id, `rounded-full border` chrome, raw status text on `FeatureDetail`; `apps/web/src/modules/features/FeatureDetail.tsx:393` carries `data-testid="status-pill"` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 leading element | MET | test | `components.test.tsx:205-217` child-order assertion |
| R2 no status text / no badge chrome | MET | test | `components.test.tsx:177-203`, `:156-157` negative assertions |
| R7 aligned across depths | MET | test | `components.test.tsx:219-243` class-identity + padding assertions (class-level; happy-dom cannot measure rendered geometry) |
| R8 selected/hover states | MET | test | `components.test.tsx:245-256` (selected); hover is pure CSS `hover:bg-base-300` on the button and structurally cannot remove the icon |
| R9 truncation | MET | test | `components.test.tsx:258-272` `shrink-0`/`truncate` class assertions |
| R11 no status-text row queries; suite passes | MET | command | `bun test tests/modules/features/` → 30 pass / 0 fail / 147 expect() (this run) |
| R13 detail pane keeps pill | MET | test | `components.test.tsx:361-368` |

**Design conformance**: 5/5 claims DONE — `StatusBadge` deleted; fixed `w-4` leading slot; row layout `[slot][id shrink-0][name flex-1 truncate]`; `paddingLeft` indentation untouched; `Badge` import removed. No silent deviations, no scope-creep beyond the two Solution-documented additions (sibling-sort test, `FeatureStatusIcon` describe block).

**Verification evidence (this run)**

- `bun test tests/modules/features/` (apps/web): **30 pass / 0 fail, 147 expect() calls**.
- `bunx biome check src/modules/features/FeatureTree.tsx tests/modules/features/components.test.tsx`: clean.
- `bunx tsc --noEmit` (apps/web): exit 0.
- `spur task check 0333 --strict-core`: pass, zero findings.
- Target file coverage (implementer's run): `FeatureTree.tsx` 100% Funcs / 100% Lines; per AGENTS.md the ≥90% per-file gate excludes React `.tsx`, and the `localeCompare` sibling-sort gap was closed with a behavior test.
- Pre-existing happy-dom `act()` warning from a FeaturesShell SSE test remains; non-fatal, out of scope.
### Review
Reviewed 2026-07-26 via `/sp-dev-review 0333 --auto` — three dimensions: functional traceability, SECUA, architecture. Diff scope: working tree (task file uncommitted) — `FeatureTree.tsx` (+4/-19), `components.test.tsx` (+195/-57 region), `status-icons.tsx` (0332 riding work, documented in Solution).

**Functional traceability (sp-functional-review)**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/features/FeatureTree.tsx:76-78` — slot span is the row button's first child, ahead of the id span; `StatusBadge` deleted (diff -19 lines); test `components.test.tsx:205-217` asserts child order slot → id → name |
| R2 | MET | `FeatureTree.tsx:76` — `w-4 shrink-0 flex items-center justify-center`; fixed-width test `components.test.tsx:219-243` asserts identical slot classes across depths 0/1/2 |
| R3 | MET | `FeatureTree.tsx:73` — `paddingLeft: calc(0.5rem + depth*16px)` unchanged on the button; `Badge` import removed (line 1); test asserts `padding-left` 0/16/32px per depth |
| R4 | MET | six-statuses test `components.test.tsx:177-203` asserts zero `[aria-label^="Status:"]`, zero `.badge` in tree, and no `>status<` text for all six statuses; grep: no `Badge` in `FeatureTree.tsx` |
| R5 | MET | selected-state test `components.test.tsx:245-256` asserts `role="img"` + `aria-label="Done"` on the selected row; truncation test `:258-272` asserts `shrink-0` slot vs `flex-1 truncate` name; accessible name confirmed in `status-icons.tsx` (0332: `role="img" aria-label={ariaLabel}`) |
| R6 | MET | flat-list test re-keyed to `svg[aria-label="Active"/"Done"]` (`:143-165`); six-statuses test re-keyed to accessible-name queries (`:177-203`); both SSE tests re-keyed to `getByTestId('status-pill')` (`:484-514`) — the load-bearing disambiguation now keys on the detail pane's unique test-id, not status text. Note: R6's `:82` ref resolves to mock data in the original file, not an assertion (refs were authored pre-0332); all four affected test bodies are covered |
| R7 | MET | new tests `components.test.tsx:205-243` — leading-slot position and fixed-width alignment across nesting depths |
| R8 | MET | `components.test.tsx:358-367` asserts `status-pill` test-id, `rounded-full border` chrome, raw status text on `FeatureDetail`; `FeatureDetail.tsx:393` carries `data-testid="status-pill"` |

Functional Verdict: **PASS** (8/8 MET)

**Acceptance Criteria cross-check**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 leading element | MET | test | `components.test.tsx:205-217` child-order assertion |
| R2 no text/chrome | MET | test | `components.test.tsx:177-203`, `:156-157` negative assertions |
| R7 aligned across depths | MET | test | `components.test.tsx:219-243` class-identity + padding assertions (class-level; happy-dom cannot measure rendered geometry) |
| R8 selected/hover states | MET | test | `components.test.tsx:245-256` (selected); hover is pure CSS `hover:bg-base-300` on the button and structurally cannot remove the icon |
| R9 truncation | MET | test | `components.test.tsx:258-272` `shrink-0`/`truncate` class assertions |
| R11 no status-text row queries; suite passes | MET | command | grep: only negative text assertions remain; `bun test tests/modules/features/` → 30 pass / 0 fail / 147 expect() (this run) |
| R13 detail pane keeps pill | MET | test | `components.test.tsx:358-367` |

**Design conformance**

5/5 claims DONE: `StatusBadge` deleted; fixed `w-4` leading slot; row layout `[slot][id shrink-0][name flex-1 truncate]`; `paddingLeft` indentation untouched; `Badge` import removed. The design's "grep the module for Badge" invariant is satisfied for `FeatureTree.tsx`; `FeatureDetail.tsx` retains `Badge` deliberately (AC R13 carve-out + tag badges). Re-key of `:318-319` uses the detail pane's `status-pill` test-id rather than adding tree-side hooks — stronger than the design's fallback. Scope additions beyond plan, both documented in Solution/Testing: sibling-sort test (closes a real `localeCompare` coverage gap, asserts observable id ordering); `FeatureStatusIcon` describe block (0332's riding coverage).

**SECUA review (sp-code-verification review mode, focus=all)**

No blocker or major findings.

- **S** — clean: no secrets, no injection surface; aria-labels come from a fixed status map; the unknown-status fallback interpolates into an aria-label string (React-escaped).
- **E** — clean: fixed-width slot removes status-dependent reflow; no new render complexity.
- **C** — clean: index-based child-order assertions are intentionally brittle (they encode the leading-slot contract); reference-class comparison across depths is sound.
- **U** — improved: accessible name preserved without visual text; unknown status degrades to a labelled fallback.
- **A** — improved: `StatusBadge` shallow wrapper deleted; status vocabulary single-sourced in the domain schema (re-export, ADR-034).

**Architecture (sp-code-improvement, five lenses)**

No candidates. Shallow-module signal resolved by deletion (`StatusBadge` collapsed into its caller's markup); test surface improved (accessible-name/test-id queries replace text scraping); no new coupling, seams, or locality friction introduced.

**Findings (P1–P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | correctness | `docs/tasks2/0333…md` Solution §row 2 | Line anchor `components.test.tsx:344-352` for the detail-pane pill test drifts ~14 lines — actual test is at `:358-367`. Documentation-only drift. |
| P4 | usability | `components.test.tsx:245-256` | AC R8's hover half has no explicit test; hover is CSS-only background (`hover:bg-base-300`) and cannot obscure the icon. Acceptable as class-level evidence. |
| P4 | correctness | `components.test.tsx:219-243`, `:258-272` | AC R7/R9 layout claims (straight column, truncation) verified at class level; happy-dom cannot measure rendered geometry. Browser check of the Board would be the visual evidence if wanted. |

No P1–P3 findings; all rows advisory-level.

**Verification run this review**: `bun test tests/modules/features/` → 30 pass / 0 fail / 147 expect() calls; `bunx biome check` on the three changed files → clean; `bunx tsc --noEmit` (apps/web) → exit 0. Pre-existing happy-dom `act()` warning from a FeaturesShell SSE test remains (documented in Testing, out of scope).

**Disposition**: all three dimensions clean; no blocking findings. Ready for `/sp-dev-verify 0333 --next`.
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T18:26:26.291Z todo → wip (system)
- 2026-07-26T18:27:22.730Z wip → testing (system)
- 2026-07-26T18:54:37.908Z testing → done (system)
