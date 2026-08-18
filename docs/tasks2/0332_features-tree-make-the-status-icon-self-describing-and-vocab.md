---
template: feature-impl
schema_version: 1
name: "Features tree: make the status icon self-describing and vocabulary-linked"
description: ""
status: done
type: task
profile: standard
feature_id: F822
parent_wbs: null
priority: P2
tags: ["web", "features", "a11y", "prefactor"]
dependencies: []
created_at: "2026-07-26T00:26:23.914Z"
updated_at: "2026-08-18T04:42:47.917Z"
---

## 0332. Features tree: make the status icon self-describing and vocabulary-linked

### Background

Prefactoring slice — make the change easy before making the easy change. Two defects in apps/web/src/modules/features/status-icons.tsx block the icon-only tree: (1) the SVG is marked aria-hidden="true" and carries no accessible name, so once the text label is removed the status becomes invisible to assistive tech; (2) StatusMeta.label ('Backlog', 'Verifying', …) already exists but nothing reads it — the tree renders the raw lowercase status instead, so screen readers announce 'verifying'. Separately, the file re-declares FEATURE_STATUSES verbatim from packages/domain/src/planning/schema.ts with no compiler link — a silent drift hazard. ADR-034 (1) makes the domain the sole owner of the status vocabulary; KanbanBoard.tsx:2 already imports TASK_STATUSES the same way, and apps/web declares @gobing-ai/spur-domain at package.json:17, so no new dependency or layering change is involved. Doing this first means the tree slice that follows only has to move markup, not also fix accessibility. Design: docs/design/feature-tree-status-affordance.md §2, §3.

### Requirements
R1. Replace the local `FEATURE_STATUSES` declaration in `apps/web/src/modules/features/status-icons.tsx`
    with an import of `FEATURE_STATUSES` from `@gobing-ai/spur-domain/schema`, re-exporting it if
    existing importers depend on the local symbol. Precedent: `KanbanBoard.tsx:2` imports
    `TASK_STATUSES` the same way.

R2. Do not consume the domain's emoji `FEATURE_STATUS_ICONS` — SVG remains the Board's encoding per
    ADR-034 (1). Two renderings of one vocabulary are intended; two vocabularies are not.

R3. Give `FeatureStatusIcon` an accessible name sourced from `FEATURE_STATUS_MAP[status].label`: add
    `role="img"` and `aria-label={meta.label}` to the rendered SVG and remove `aria-hidden="true"`,
    since the glyph is no longer decorative.

R4. Ensure the unknown-status fallback branch also produces a non-empty accessible name and does not
    throw.

R5. Keep the accessible name in the markup, independent of any tooltip — a tooltip must never be the
    sole channel (ADR-034 (3)).

R6. Verify the existing tree still renders and that all six canonical statuses expose their
    capitalized label (`Backlog`, `Active`, `Verifying`, `Blocked`, `Done`, `Cancelled`) rather than
    the raw lowercase status.

Satisfies feature AC scenarios R3, R4, R12 — see this task's Acceptance Criteria section.
### Acceptance Criteria
```gherkin
Feature: Features tree status affordance (R2) — task 0332

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R3 — The status indicator exposes its human-readable label as an accessible name
    Given a feature "F1" with status "verifying" is present in the tree
    When an assistive technology queries the status indicator
    Then its accessible name is "Verifying"
    And that name comes from the status map's label field, not from the raw status string
    And the name is present in the markup independently of any tooltip

  @core
  Scenario Outline: R4 — Every canonical status resolves to its own labelled indicator
    Given a feature with status "<status>" is present in the tree
    When the row is rendered
    Then exactly one status indicator is rendered for that row
    And its accessible name is "<label>"

    Examples:
      | status    | label     |
      | backlog   | Backlog   |
      | active    | Active    |
      | verifying | Verifying |
      | blocked   | Blocked   |
      | done      | Done      |
      | cancelled | Cancelled |

  @edge
  Scenario: R12 — An unrecognized status degrades to a labelled fallback indicator
    Given a feature carrying a status outside the six canonical values
    When its row is rendered
    Then a fallback indicator is rendered in the leading slot
    And it exposes a non-empty accessible name
    And the row does not fail to render

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach**

1. **Vocabulary link (R1, R2).** Replace the local `FEATURE_STATUSES` declaration in
   `apps/web/src/modules/features/status-icons.tsx` with
   `import { FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema'` — precedent:
   `KanbanBoard.tsx:2` imports `TASK_STATUSES` the same way; the `./schema` subpath export exists
   (`packages/domain/package.json`). Re-export it from status-icons (`export { FEATURE_STATUSES }`)
   because `FeaturesShell.tsx:9` imports the symbol from `./status-icons` — the domain becomes the
   sole definition site without touching the consumer. The domain's emoji `FEATURE_STATUS_ICONS`
   stays unconsumed: SVG remains the Board's encoding (ADR-034 (1)).
2. **Accessible name (R3, R4, R5).** Extend `StatusMeta.Icon` to
   `(props: { className?: string; ariaLabel?: string })`. In each of the six icon definitions,
   replace `aria-hidden="true"` with `role="img"` and `aria-label={ariaLabel}`.
   `FeatureStatusIcon` passes `ariaLabel={meta.label}`; the unknown-status fallback renders
   `role="img"` with `aria-label={`Unknown status: ${status}`}` — non-empty for any input,
   never throws.

**Invariants**

- Every rendered indicator (six canonical + fallback) carries a non-empty accessible name in the
  markup, independent of any tooltip (ADR-034 (3)).
- `FEATURE_STATUSES` has exactly one definition site (domain schema); status-icons re-exports, never
  re-declares.
- Zero visual change: glyph paths, colors, and sizes untouched in this task.

**Tradeoffs.** Re-exporting keeps `FeaturesShell.tsx` untouched (surgical) at the cost of one
forwarding line; editing the consumer import instead is equally valid but touches a second file —
R1 explicitly allows the re-export, so prefer it.

**Impacted surfaces:** `status-icons.tsx` only (all edits); `FeaturesShell.tsx` /
`FeatureTree.tsx` unchanged. Tests: `apps/web/tests/modules/features/components.test.tsx`.
### Plan
- [x] 1. Import `FEATURE_STATUSES` from `@gobing-ai/spur-domain/schema` in `status-icons.tsx`;
  delete the local declaration; add `export { FEATURE_STATUSES }` (FeaturesShell.tsx:9 depends on
  the local symbol).
- [x] 2. Extend `StatusMeta.Icon` signature with optional `ariaLabel`; update the interface.
- [x] 3. In all six `FEATURE_STATUS_MAP` entries: remove `aria-hidden="true"`, add `role="img"`
  and `aria-label={ariaLabel}` to the `<svg>`.
- [x] 4. `FeatureStatusIcon`: pass `ariaLabel={meta.label}` into `IconComp`; give the unknown-status
  fallback `<svg>` `role="img"` + ``aria-label={`Unknown status: ${status}`}``.
- [x] 5. Tests: each canonical status renders an element with `role="img"` whose accessible name is
  its capitalized label (`Backlog`, `Active`, `Verifying`, `Blocked`, `Done`, `Cancelled`); unknown
  status renders the fallback with a non-empty accessible name; `FEATURE_STATUSES` is identical to
  the domain export.
- [x] 6. Run apps/web tests + `bun run lint`.
### Solution
**Change map**

- `apps/web/src/modules/features/status-icons.tsx:7` — local `FEATURE_STATUSES` declaration deleted;
  re-exported from `@gobing-ai/spur-domain/schema` (sole definition site, ADR-034). R1. R2 honored:
  the domain's emoji `FEATURE_STATUS_ICONS` is not imported; SVG remains the Board's encoding.
- `apps/web/src/modules/features/status-icons.tsx:13` — `StatusMeta.Icon` signature gains optional `ariaLabel?: string`.
- `apps/web/src/modules/features/status-icons.tsx:25-130` — all six `FEATURE_STATUS_MAP` entries: `aria-hidden="true"` removed,
  `role="img"` + `aria-label={ariaLabel}` added to the `<svg>`. Glyph paths, colors, sizes untouched
  (zero visual change). R3/R5.
- `apps/web/src/modules/features/status-icons.tsx:146` — `FeatureStatusIcon` passes `ariaLabel={meta.label}`, so the accessible
  name is the map's capitalized label, not the raw status. R3/R6.
- `apps/web/src/modules/features/status-icons.tsx:149-157` — unknown-status fallback `<svg>` gets `role="img"` +
  ``aria-label={`Unknown status: ${status}`}`` — non-empty for any input, never throws. R4.
- `apps/web/tests/modules/features/components.test.tsx` — new `FeatureStatusIcon` describe block
  (4 tests): domain re-export identity (`toBe` reference equality), per-status accessible names for
  all six canonical statuses, label-vs-raw-string assertion, unknown-status fallback.

**Rationale.** Re-export (not consumer-edit) keeps `apps/web/src/modules/features/FeaturesShell.tsx:9` untouched — R1 explicitly
allows it and it is the surgical option. Accessible name is carried on the SVG itself in markup,
independent of the Badge's `title` tooltip channel (ADR-034 (3)).
### Testing
Verified 2026-07-26 via `/sp-dev-verify 0332 --auto --next` (all evidence re-run this turn;
line anchors re-read at cited lines).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/features/status-icons.tsx:7` — `export { FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema'`; local declaration deleted; `apps/web/tests/modules/features/components.test.tsx:198` — `expect(FEATURE_STATUSES).toBe(DOMAIN_FEATURE_STATUSES)` reference identity; precedent `apps/web/src/modules/task-kanban/KanbanBoard.tsx:2` confirmed |
| R2 | MET | `FEATURE_STATUS_ICONS` not imported anywhere in `status-icons.tsx` (grep: references only in `packages/domain/src/planning/schema.ts`); SVG remains the Board encoding |
| R3 | MET | All six `FEATURE_STATUS_MAP` entries carry `role="img"` + `aria-label={ariaLabel}`, zero `aria-hidden` (re-read `apps/web/src/modules/features/status-icons.tsx:27-134`); `apps/web/src/modules/features/status-icons.tsx:146` passes `ariaLabel={meta.label}`; test asserts `aria-hidden` is null |
| R4 | MET | `apps/web/src/modules/features/status-icons.tsx:149-157` — fallback `aria-label={`Unknown status: ${status}`}` (prefix guarantees non-empty for any input); test renders `frobnicate` without throw, exactly one svg |
| R5 | MET | Accessible name is an `aria-label` attribute on the `<svg>` element itself — in markup, no tooltip channel involved; test comment + assertions `components.test.tsx:224-226` |
| R6 | MET | `components.test.tsx:205-227` — all six canonical capitalized labels asserted via `role="img"` + `aria-label`; existing `FeatureTree` tests unchanged and green |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R3 — indicator exposes human-readable label as accessible name, from map label, in markup independent of tooltip | MET | test | `components.test.tsx` — "accessible name comes from the status map label, not the raw status string" (`aria-label` = `Verifying`, ≠ `verifying`) + per-status test asserting `role="img"`/`aria-label`/`aria-hidden: null` |
| R4 — every canonical status resolves to its own labelled indicator (exactly one per row) | MET | test | `components.test.tsx` — "every canonical status renders one img-role SVG named by its capitalized label": 6-case loop, `svgs.length === 1`, `aria-label` ∈ {Backlog, Active, Verifying, Blocked, Done, Cancelled} |
| R12 — unrecognized status degrades to a labelled fallback indicator; row renders | MET | test | `components.test.tsx` — "unrecognized status degrades to a labelled fallback indicator without throwing": `frobnicate` → 1 svg, `role="img"`, `aria-label` = `Unknown status: frobnicate` (non-empty) |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 6/6 claims DONE (vocabulary link, Icon signature, six entries, label pass-through, fallback label, tests); no CHANGED/NOT-DONE; no scope creep |
| spur task check --strict-core | pass | 0 findings this run (Review L3 remediated via P1–P4 table authored in the review step) |

**Fresh command evidence (this run)**

- `cd apps/web && bun test tests/modules/features/components.test.tsx` → 20 pass / 0 fail / 96 expects
- `cd apps/web && bun test --coverage tests/modules/features/components.test.tsx` → `status-icons.tsx` 100.00% funcs / 100.00% lines
- `cd apps/web && bun test` → 511 pass / 0 fail / 1568 expects across 32 files
- `spur task check 0332 --strict-core --json` → `pass: true`, 0 findings

Coverage: `status-icons.tsx` 100.00% lines / 100.00% funcs (≥90% per-file target met).
### Review
Reviewed 2026-07-26 via `/sp-dev-review 0332 --auto` (functional + SECUA + architecture).
P1–P4 priority table authored 2026-07-26 during `/sp-dev-verify 0332 --auto --next` to satisfy
Review L3 (`L3.review-priority-table`); findings unchanged, re-keyed to the priority scale.
Scope: working-tree diff — `apps/web/src/modules/features/status-icons.tsx`,
`apps/web/tests/modules/features/components.test.tsx` (task file uncommitted; fallback scope per
verify Step 3). No scope creep — diff matches Design "Impacted surfaces".

**P1–P4 findings**

| Priority | Finding | File | Recommendation |
|----------|---------|------|----------------|
| P4 | `ariaLabel` optional in the `Icon` props type — a direct `FEATURE_STATUS_MAP[x].Icon` consumer omitting it would render an img-role SVG with no accessible name (only production caller `FeatureStatusIcon` always passes `meta.label`) | `apps/web/src/modules/features/status-icons.tsx:13` | Make `ariaLabel` required, or default it to the entry's `label` |
| P4 | Inline props type `{ className?: string; ariaLabel?: string }` repeated 7× (interface + 6 entries) | `apps/web/src/modules/features/status-icons.tsx` | Named `IconProps` alias (cosmetic) |

No P1–P3 findings — clean review; both P4 rows are advisory/cosmetic and non-blocking.

**Functional traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `status-icons.tsx:7` — `export { FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema'`; local declaration deleted; consumer `FeaturesShell.tsx:9` untouched; `components.test.tsx:198` — `expect(FEATURE_STATUSES).toBe(DOMAIN_FEATURE_STATUSES)` (reference identity); precedent `task-kanban/KanbanBoard.tsx:2` confirmed |
| R2 | MET | `FEATURE_STATUS_ICONS` absent from `status-icons.tsx` (grep: only `schema.ts:42,62` references); emoji map not imported |
| R3 | MET | All six `FEATURE_STATUS_MAP` entries carry `role="img"` + `aria-label={ariaLabel}`, no `aria-hidden` (re-read this verify run: `status-icons.tsx:27-134`); `status-icons.tsx:146` — `ariaLabel={meta.label}`; test `components.test.tsx:224-226` asserts `aria-hidden` is null |
| R4 | MET | `status-icons.tsx:149-157` — fallback `aria-label={`Unknown status: ${status}`}`, non-empty for any input (prefix guarantees); test `components.test.tsx:234-242` renders `frobnicate` without throw, exactly one svg |
| R5 | MET | Name on the `<svg>` element itself (`aria-label` attribute in markup), no tooltip dependency; test comment + assertions `components.test.tsx:224-226` |
| R6 | MET | `components.test.tsx:205-227` — all six canonical labels asserted; existing `FeatureTree` tests unchanged and green; full suite 511 pass / 0 fail / 32 files (fresh run this review) |

Functional Verdict: PASS

**Design conformance** — 6/6 claims DONE (vocabulary link, Icon signature, six entries,
FeatureStatusIcon label pass-through, fallback label, tests). `bun run lint` from Plan step 6:
biome check on both changed files clean this run. No CHANGED/NOT-DONE claims; no scope creep.

**SECUA review** (all dimensions)

Security: no secrets/injection/XSS — React escapes the interpolated fallback label. Efficiency:
static map, no concerns. Correctness: fallback cannot produce an empty name; `status.toLowerCase()`
safe under the typed `string` prop. Usability: screen readers now announce capitalized labels.
Findings F1/F2 are carried as the P4 rows above.

SECUA Verdict: PASS (no blocker/major findings)

**Architecture (deepening lenses)** — five signals applied to the diff: no shallow module (real
glyph bodies), coupling *reduced* (one vocabulary definition site; re-export is the deliberate seam
R1 blesses), no wrong seam, locality intact, test surface direct (component render tests, 100%
coverage). Candidates: C1 = the `IconProps` P4 row above (advisory). No blocker/major candidates.

**Fresh verification evidence (run this review)**

- `cd apps/web && bun test tests/modules/features/components.test.tsx` → 20 pass / 0 fail / 96 expects
- `cd apps/web && bun test --coverage tests/modules/features/components.test.tsx` → `status-icons.tsx` 100.00% funcs / 100.00% lines
- `cd apps/web && bun test` → 511 pass / 0 fail across 32 files
- `bunx biome check status-icons.tsx components.test.tsx` → clean, no fixes

**Residual risk** — none blocking. Both P4 rows are cosmetic; the public surface
(`FeatureStatusIcon`) enforces non-empty names for all inputs.

**Disposition** — three-dimensional review PASS; task is ready for `/sp-dev-verify 0332` to gate
`testing → done`.
### References

R2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-26T07:42:22.243Z todo → wip (system)
- 2026-07-26T07:49:10.711Z wip → testing (system)
- 2026-07-26T18:14:52.178Z testing → done (system)
