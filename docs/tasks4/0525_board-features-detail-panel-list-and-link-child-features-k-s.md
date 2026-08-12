---
template: feature-impl
schema_version: 1
name: "Board Features detail panel: list and link child features (K subtree)"
description: ""
status: done
type: task
profile: standard
feature_id: K
parent_wbs: null
priority: P2
tags: ["board-features"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T07:09:29.141Z"
updated_at: "2026-08-12T07:57:54.775Z"
---

## 0525. Board Features detail panel: list and link child features (K subtree)

### Background
- Closure-audit result for K (`sp:dev-find-next` handoff, 2026-08-12): Feature K Goal/Scope
  includes Board Features (`apps/web/src/modules/features`). K's carried R2 scenario ("Project
  switcher is a child of K") is only partially met: K1 exists as a child feature, but the Board
  detail panel never lists or links child features — operators on K hit "No linked tasks" with no
  in-panel path into K1 (tree sidebar still works; detail is a dead end for umbrellas).
- Implements: Feature K scenario **R2** (DD-09: feature scenario title kept; task-local R1–R5 are
  the implementation clauses).
- **Premise verification (2026-08-12, this refine):**

  | Claim | Live evidence |
  | --- | --- |
  | Detail filters linked tasks by `featureId` only | `apps/web/src/modules/features/FeatureDetail.tsx:83` `linkedTasks = tasks.filter(t => t.featureId === featureId)`; empty copy at `:597-598` |
  | No children section / props | `FeatureDetailProps` (`:24-35`) is only `featureId`, `onClose?`, `refreshKey?` — no `children` / `onSelectFeature` |
  | Hierarchy algorithm already in tree | Private `groupByParent` in `apps/web/src/modules/features/FeatureTree.tsx:49-65`; docblock `:14-15` = `id.length === parent.length + 1 && startsWith` via `parentId = id.slice(0, -1)` + skip roots |
  | Shell owns flat list + selection | `apps/web/src/modules/features/FeaturesShell.tsx:40-41` `features` / `selectedId`; tree uses **filtered** list `:260`; detail gets only `featureId` / `refreshKey` / `onClose` `:267-271` |
  | No server children field | `FeatureShowData` in `apps/web/src/lib/feature-types.ts:18-26` has no children; list is `FeatureSummary[]` |
  | Corpus refresh is task-edge only | `feature-service` `renderTasksTable` empty → `_No linked tasks._` (`:1060-1062`); refresh populates from `feature_id` task edges (`collectTasksByFeature` ~`:622+`) — not child features |
  | K1 is direct child of K | `docs/features/K1_project-switcher.md` id K1; ID-prefix rule ⇒ parent K |

- **Note:** K's `## Tasks` may list this task (0525) after create — R3 is about product behavior when
  the **direct task edge set is empty**, not a permanent claim that K has zero tasks forever.
- Non-duplication: F8 / F81 / F82 / K1 ship tree, detail actions, status icons/filter, project
  switcher — none ship a **child-feature listing inside the detail metadata pane**.
- Rubric: E2 D1 L1 C0 R0 = 4 → single cohesive task; keep whole.
### Requirements
- **R1 — Child section with status.** `FeatureDetail` renders a `Child features (N)` heading for
  every **direct** child of the selected feature, using the same ID-prefix grouping as
  `FeatureTree` (`groupByParent` / exported helper: parent of `id` is `id.slice(0, -1)` for
  `id.length > 1`). Each row shows **id**, **name**, and **`FeatureStatusIcon`** for that child's
  status.
- **R2 — Navigable rows.** Each child row is a `<button type="button">` whose accessible name is
  `Open child feature <id>: <name>` and whose click calls the shell-owned selection callback with
  that child id (production: `setSelectedId`).
- **R3 — Umbrella with empty task edges.** For a selected feature with zero direct linked tasks and
  at least one direct child (K-like), the metadata pane still provides a navigable child row — the
  Linked Tasks empty state must not be the only content path.
- **R4 — No children ⇒ no section.** When the selected feature has no direct children, render
  **neither** a Child features section **nor** any child empty-state text.
- **R5 — Client-only derivation.** Children come from the **unfiltered** `FeatureSummary[]` already
  loaded by `FeaturesShell` (not `filteredFeatures`). No server contract, endpoint, extra fetch,
  corpus-rendering rule, or feature/task lifecycle behavior changes.

**Out of scope / non-goals:**
- Changing Linked Tasks section markup, empty-state copy (`No linked tasks`), or task navigation
- Changing feature-tree hierarchy semantics or sidebar filter behavior
- Recursive multi-level descendants inside the detail panel (tree already owns depth)
- Server-side `children` on `FeatureShowData`, CLI `feature refresh` child links, contracts
- New npm dependencies or new abstraction modules outside the three feature files + tests
### Acceptance Criteria
```gherkin
Feature: Features module (Spur Board)

  Scenario: R1 — Project switcher is a child of K
    Given a selected feature has two direct children with different statuses
    When the metadata pane renders
    Then `Child features (2)` lists each child's id and name
    And each child uses `FeatureStatusIcon` for its status

  Scenario: R2 — Project switcher is a child of K
    Given a child feature row is displayed
    When the operator activates its accessible `Open child feature <id>: <name>` button
    Then `onSelectFeature` receives that child id
    And the shell selects the child's detail panel

  Scenario: R3 — Project switcher is a child of K
    Given feature K has no direct linked tasks and has direct child K1
    When K is selected in the Board Features detail panel
    Then the metadata pane provides a navigable K1 child row despite the linked-task empty state

  Scenario: R4 — Project switcher is a child of K
    Given the selected feature has no direct children
    When the metadata pane renders
    Then no Child features section or child empty-state text is present

  Scenario: R5 — Project switcher is a child of K
    Given the shell already loaded the unfiltered flat feature list
    When direct children are derived for the selected feature
    Then `groupFeaturesByParent` supplies the same sorted ID-prefix grouping used by `FeatureTree`
    And no server contract, endpoint, additional fetch, or corpus-rendering behavior changes
```
### Q&A
**Q: Why export/rename `groupByParent` instead of reading `parentId` on `FeatureSummary`?**

A: Tree already uses ID-prefix (DD-14). `parentId` on the summary is optional and not what the tree
uses today; a second algorithm would desync. One helper, two consumers.

**Q: Why optional props instead of required children + onSelectFeature?**

A: Existing focused `FeatureDetail` tests render with only `featureId`. Defaults (`[]` / undefined)
preserve them; the production shell always supplies both.

**Q: Why derive from unfiltered `features` while the tree uses `filteredFeatures`?**

A: Filtering children by the tree status filter would hide a child that is "out of filter" even when
the parent is selected — wrong for detail navigation. Rejected design option 4.

**Q: Should corpus `## Tasks` list child features?**

A: No — out of scope (CLI refresh / task-edge semantics). Board detail is the product gap for K R2.

**Q: K now has task 0525 linked — does R3 still apply?**

A: Yes. R3 is the empty-task-edges case; tests construct that fixture. Product still needs children
navigation whenever tasks are empty; K1 remains the motivating child.
### Design
**WHAT:** Add a conditional **Child features (N)** block to the Features detail metadata pane so
umbrella features (e.g. K → K1) are navigable from the panel without leaving the module.

**WHY:** Linked Tasks only shows `feature_id` edges. Containers with children but few/no own tasks
read as dead ends in the detail pane even though the tree already knows the hierarchy.

**WHERE / frozen files (only):**

| Path | Change |
| --- | --- |
| `apps/web/src/modules/features/FeatureTree.tsx` | Export the existing private helper (rename on export for clarity) |
| `apps/web/src/modules/features/FeaturesShell.tsx` | Derive children from unfiltered `features`; pass props into `FeatureDetail` |
| `apps/web/src/modules/features/FeatureDetail.tsx` | Props + conditional section in expanded metadata |
| `apps/web/tests/modules/features/components.test.tsx` | Prove R1–R4 (and R5 via no extra fetch mocks) |

**No changes:** `feature-types.ts`, contracts, server, CLI, `feature-service` corpus rendering,
`FeatureTree` visual tree behavior (aside from exporting the helper).

**Frozen API**

```ts
// FeatureTree.tsx — export existing algorithm (today: private groupByParent at :49-65)
export function groupFeaturesByParent(
  features: FeatureSummary[],
): Map<string, FeatureSummary[]>;
// Implementation MUST remain: skip id.length <= 1; parentId = id.slice(0, -1);
// push into map; sort each sibling group with byFeatureId (localeCompare).
// FeatureTree continues to call the same function for childrenMap.

// FeatureDetail.tsx — extend props (optional for unit isolation)
// NOTE: prop is childFeatures (not React-reserved `children`) — biome noChildrenProp.
interface FeatureDetailProps {
  featureId: string;
  onClose?: () => void;
  refreshKey?: number;
  /** Direct children of featureId; default []. */
  childFeatures?: FeatureSummary[];
  /** Shell selection callback; production passes setSelectedId. */
  onSelectFeature?: (id: string) => void;
}
```

**Shell wiring (R5 critical)**

```ts
// FeaturesShell — ALWAYS use unfiltered `features`, never filteredFeatures
const childrenByParent = useMemo(
  () => groupFeaturesByParent(features ?? []),
  [features],
);
const selectedChildren = selectedId
  ? (childrenByParent.get(selectedId) ?? [])
  : [];

<FeatureDetail
  featureId={selectedId}
  refreshKey={detailRefreshKey}
  onClose={() => setSelectedId(null)}
  childFeatures={selectedChildren}
  onSelectFeature={setSelectedId}
/>
```

**Why unfiltered:** status filter on the tree must not hide real children from the selected
feature's detail (rejected option 4).

**Rendering (R1–R4)**

- Placement: inside the **expanded** metadata pane (`showMetadata === true`), **immediately above**
  the Linked Tasks block, so umbrellas see children before the task empty state.
- Guard: render section **iff** `childFeatures.length > 0` (default `[]`).
- Heading: `Child features ({childFeatures.length})` — same visual density as `Linked Tasks ({n})`.
- Row: `<button type="button">` with `FeatureStatusIcon`, mono id, truncated name,
  `aria-label={\`Open child feature ${child.id}: ${child.name}\`}`,
  `onClick={() => onSelectFeature?.(child.id)}`.
- R4: zero children → **omit entire section** (no empty-state text).
- Linked Tasks block: **byte-behavior unchanged**.

**Rejected alternatives:** (1) server `children` on FeatureShowData; (2) corpus refresh child links;
(3) recursive descendants in detail; (4) derive from `filteredFeatures`.

**Invariants:** DD-14 ID-prefix hierarchy; ascending sibling sort; no new deps; optional props default.

**Anti-patterns:** second hierarchy algorithm; fetch inside FeatureDetail; change Linked Tasks copy;
wire selection to router; use React-reserved prop name `children` (use `childFeatures`).

**Handoff:** Feature K owns AC scenario titles (DD-09). No task dependencies. Implement owns Solution.
### Plan
- [x] **P1 (R5):** Export `groupFeaturesByParent` from `FeatureTree.tsx` (rename/export of current
      `groupByParent`); keep `FeatureTree` consuming it; no tree UI change.
- [x] **P2 (R1/R2/R5):** In `FeaturesShell.tsx`, `useMemo` children map from unfiltered `features`;
      pass `childFeatures` + `onSelectFeature={setSelectedId}` into `FeatureDetail`.
- [x] **P3 (R1–R4):** Extend `FeatureDetailProps`; import `FeatureStatusIcon`; render conditional
      Child features section above Linked Tasks; leave Linked Tasks untouched.
- [x] **P4 (R1–R4 tests):** Extend `apps/web/tests/modules/features/components.test.tsx`:
  - two children with different statuses → `Child features (2)` + ids/names + status icons  
  - click child button → selection callback with child id; aria-label shape  
  - zero linked tasks + one child → child row still present with "No linked tasks"  
  - empty `childFeatures` / omit prop → no Child features heading or empty-state  
  - R5 shell: unfiltered children under status filter  
- [x] **P5 (R5 verify):**  
      `bun test apps/web/tests/modules/features/components.test.tsx` — 42 pass / 0 fail  
      `bun run --filter @gobing-ai/spur-web typecheck` — clean  
      `git diff --name-only` ⊆ Design paths (plus task corpus bookkeeping)
### Solution
Board Features detail panel lists and links direct child features (K → K1) using the existing
ID-prefix hierarchy helper — client-only, no server/contract/CLI change.

- `apps/web/src/modules/features/FeatureTree.tsx:49-70` — renamed/exported private `groupByParent`
  as `groupFeaturesByParent` (same algorithm: skip roots, `parentId = id.slice(0, -1)`, sort
  siblings by id). Tree continues to consume it for `childrenMap` (`:31`). (R5)
- `apps/web/src/modules/features/FeaturesShell.tsx:50-55` — `useMemo` of
  `groupFeaturesByParent(features ?? [])` over the **unfiltered** list; `:162`
  `selectedChildren`; `:275-280` passes `childFeatures={selectedChildren}` and
  `onSelectFeature={setSelectedId}` into `FeatureDetail`. (R1/R2/R5)
- `apps/web/src/modules/features/FeatureDetail.tsx:36-39,51-56` — optional `childFeatures` (default
  `[]`; not React-reserved `children` — biome `noChildrenProp`) and `onSelectFeature`. `:603-629` —
  inside expanded metadata, **above** Linked Tasks: when `childFeatures.length > 0` render
  `Child features (N)` with `FeatureStatusIcon`, mono id, name,
  `aria-label="Open child feature <id>: <name>"`, click → `onSelectFeature?.(child.id)`. Zero
  children omits the section (R4). Linked Tasks block unchanged (R3 empty-task path still shows
  "No linked tasks").
- `apps/web/tests/modules/features/components.test.tsx:677-816` — R1–R4 FeatureDetail cases +
  FeaturesShell R5 (child remains visible when tree status filter hides it).

Verification (this verify run): `bun test apps/web/tests/modules/features/components.test.tsx` →
42 pass / 0 fail; `bun run --filter @gobing-ai/spur-web typecheck` clean. Diff scoped to the four
Design paths (+ task corpus).
### Testing
**Force re-verify (2026-08-12) — `/sp:dev-verify 0525 --auto --force --fix all --focus all`**

- Verdict: PASS
- Coverage: N/A (UI feature; component suite is the evidence surface)
- Fix-pass: Design/Solution/Testing use full repo-relative anchors; prop is `childFeatures` (biome `noChildrenProp`). Artifacts: `.spur/run/0525-verdict.json`, `.spur/run/0525-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/features/FeatureDetail.tsx:606-629` — `childFeatures.length > 0` section above Linked Tasks; heading `Child features (N)`; rows with mono id, name, `FeatureStatusIcon`. Test `apps/web/tests/modules/features/components.test.tsx:677` — two children → `Child features (2)` + Done/Active icon labels. Suite this run: 42 pass / 0 fail. |
| R2 | MET | `apps/web/src/modules/features/FeatureDetail.tsx:613-618` — `<button type="button">`, `aria-label=Open child feature <id>: <name>`, click → `onSelectFeature?.(child.id)`. Shell `apps/web/src/modules/features/FeaturesShell.tsx:280` passes `onSelectFeature={setSelectedId}`. Test `apps/web/tests/modules/features/components.test.tsx:703` — click K1 pushes id. |
| R3 | MET | Section independent of linked tasks; empty tasks still show "No linked tasks" (`apps/web/src/modules/features/FeatureDetail.tsx:637`). Test `apps/web/tests/modules/features/components.test.tsx:736` — K + empty `/tasks` → empty task copy AND navigable K1. |
| R4 | MET | Guard `childFeatures.length > 0` (`apps/web/src/modules/features/FeatureDetail.tsx:606`); default `[]` (`apps/web/src/modules/features/FeatureDetail.tsx:55`). Test `apps/web/tests/modules/features/components.test.tsx:769` — no Child features heading / no empty-state. |
| R5 | MET | `apps/web/src/modules/features/FeaturesShell.tsx:55` `groupFeaturesByParent(features ?? [])` on unfiltered list; `:162` selectedChildren; `:279` `childFeatures={selectedChildren}`; tree only gets `filteredFeatures`. Shared helper `apps/web/src/modules/features/FeatureTree.tsx:55`. Test `apps/web/tests/modules/features/components.test.tsx:791` — filter active hides F1 in tree, detail still lists F1. No server/contract/CLI files in diff. Typecheck clean. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Project switcher is a child of K | MET | test | `apps/web/tests/modules/features/components.test.tsx:677` — Child features (N) + ids/names + FeatureStatusIcon; suite 42 pass / 0 fail |
| Scenario: R2 — Project switcher is a child of K | MET | test | `apps/web/tests/modules/features/components.test.tsx:703` — Open child feature button + onSelectFeature; shell wires setSelectedId (`apps/web/src/modules/features/FeaturesShell.tsx:280`) |
| Scenario: R3 — Project switcher is a child of K | MET | test | `apps/web/tests/modules/features/components.test.tsx:736` — No linked tasks + navigable K1 |
| Scenario: R4 — Project switcher is a child of K | MET | test | `apps/web/tests/modules/features/components.test.tsx:769` — no section when no children |
| Scenario: R5 — Project switcher is a child of K | MET | test | `apps/web/tests/modules/features/components.test.tsx:791` — unfiltered derivation under status filter; `apps/web/src/modules/features/FeatureTree.tsx:55` shared helper |

**Design conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| Export groupFeaturesByParent | DONE | `apps/web/src/modules/features/FeatureTree.tsx:55` |
| Shell unfiltered map + props | DONE | `apps/web/src/modules/features/FeaturesShell.tsx:55,162,279-280` |
| Detail section + FeatureStatusIcon | DONE | `apps/web/src/modules/features/FeatureDetail.tsx:603-629` |
| Prop name early draft `children` | CHANGED | Shipped `childFeatures` (biome `noChildrenProp`); Design updated this fix pass |

**SECUA (focus=all)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3. Optional prop defaults preserve existing tests; selection stays shell-owned. |

**Gates this run**

- `bun test apps/web/tests/modules/features/components.test.tsx` → 42 pass / 0 fail
- `bun run --filter @gobing-ai/spur-web typecheck` → clean
- `task check 0525` → pass after full-path anchors
- `feature check K` → pass with residual L4.uncovered-feature-scenario (R1 — no covering task; out of 0525 scope)
### Review
**Verdict: PASS** — no P1/P2 findings. All five requirements (R1–R5) implemented and each covered by a behavior test.
Evidence: `bun test apps/web/tests/modules/features/components.test.tsx` → 42 pass / 0 fail (239 expect calls);
`bun run typecheck` (apps/web) clean.


| Req | Evidence | Verdict |
| --- | --- | --- |
| R1 — Child section with status | `apps/web/src/modules/features/FeatureDetail.tsx:606-631` — `Child features (N)` heading inside expanded metadata, immediately above Linked Tasks; rows render mono id, name, `FeatureStatusIcon status={child.status}` (role="img", human label via `featureStatusLabel`). Test `apps/web/tests/modules/features/components.test.tsx:677` — two children (done/active) → `Child features (2)`, ids/names present, icon labels `Done`/`Active`. | PASS |
| R2 — Navigable rows | Row is `<button type="button">` (`:615`) with `aria-label={Open child feature ${id}: ${name}}` (`:618`) and `onClick={() => onSelectFeature?.(child.id)}` (`:616`); shell passes `onSelectFeature={setSelectedId}` (`apps/web/src/modules/features/FeaturesShell.tsx:280`), so activation selects the child's panel. Test `apps/web/tests/modules/features/components.test.tsx:703` asserts button type, accessible name, click → callback id. | PASS |
| R3 — Umbrella with empty task edges | Section renders independently of `linkedTasks`. Test `apps/web/tests/modules/features/components.test.tsx:736` — K fixture with empty `/tasks` + child K1 → `No linked tasks` AND navigable K1 row present; click selects K1. | PASS |
| R4 — No children ⇒ no section | `childFeatures.length > 0 &&` guard (`:606`) with default `[]` (`:55`); no empty-state text anywhere. Test `apps/web/tests/modules/features/components.test.tsx:769` asserts no heading and no `/No child features/i`. | PASS |
| R5 — Client-only derivation from unfiltered list | `apps/web/src/modules/features/FeaturesShell.tsx:55` — `useMemo(() => groupFeaturesByParent(features ?? []), [features])` derives from the **unfiltered** `features` state; hook unconditional (before early returns). `filteredFeatures` is passed only to `FeatureTree` (`:264`), never to the children map. Single shared helper (`apps/web/src/modules/features/FeatureTree.tsx:55`, exported `groupFeaturesByParent`, same ID-prefix algorithm + sort) consumed by both tree and detail. No server contract, endpoint, fetch, or corpus change. Test `apps/web/tests/modules/features/components.test.tsx:791` — tree filtered to `active` (hides F1 `done`), select F → `Child features (1)` + `Open child feature F1: Child` — proves unfiltered derivation end-to-end. | PASS |


| Severity | Dimension | Finding | Disposition |
| --- | --- | --- | --- |
| P3 | Docs | Task Design "Frozen API" (`:162`, `:184`) and Solution (`:259`, `:262`) still document the prop as `children?: FeatureSummary[]` / `children={selectedChildren}`, but shipped code renames it to `childFeatures` (biome `noChildrenProp` — React-reserved collision). Task file contradicts the shipped contract. | Accept (rename is biome-mandated and correct); update task doc Design/Solution to `childFeatures` for accuracy |
| P4 | UI polish | Child name span is `truncate` without `flex-1 min-w-0` (`apps/web/src/modules/features/FeatureDetail.tsx:624`); flex default `min-width:auto` defeats the ellipsis, so a long child name overflows the panel instead of truncating — the sibling Linked Tasks row uses `flex-1 min-w-0` (`:648`,`:652`). | Optional; add `flex-1 min-w-0` to match the panel's own row pattern |

- Low. No P1/P2: no functional, security, or a11y-blocking issue. Rows are native buttons (keyboard-focusable, Enter/Space activation); explicit aria-label gives a stable accessible name independent of content.
- Note (not a finding): row icon wrapper `title={child.status}` shows the raw status code on hover — identical to the Linked Tasks rows' `title={t.status}` convention in the same panel, so it is module-consistent; ADR-034's single-source human label is only used for the accessible channel.
- Scope: diff confined to the three feature files + tests (43/10/14/146 lines); no changes to Linked Tasks markup, tree semantics, contracts, or corpus.
### References
- Feature K — Features module (Spur Board); carried AC titles R1–R5 (DD-09 R2 scenario wording)
- Child K1 — Project switcher (motivating subtree)
- `apps/web/src/modules/features/FeatureTree.tsx` — hierarchy helper (export target)
- `apps/web/src/modules/features/FeatureDetail.tsx` — metadata pane / Linked Tasks
- `apps/web/src/modules/features/FeaturesShell.tsx` — list load + selection ownership
- `apps/web/tests/modules/features/components.test.tsx` — component tests
- Related shipped work: F8 tree/detail, F81 actions, F82 status icons/filter — no child-detail listing
### History
- 2026-08-12T07:44:09.365Z todo → wip (system)
- 2026-08-12T07:52:13.623Z wip → testing (system)
- 2026-08-12T07:52:14.101Z testing → done (system)
