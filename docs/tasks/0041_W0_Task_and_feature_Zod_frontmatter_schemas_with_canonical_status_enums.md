---
name: "W0: Task and feature Zod frontmatter schemas with canonical status enums"
description: "W0: Task and feature Zod frontmatter schemas with canonical status enums"
status: WIP
created_at: 2026-06-13T01:08:18.979Z
updated_at: 2026-06-13T16:51:36.391Z
folder: docs/tasks
type: task
feature-id: F1
priority: P0
tags: ["rd3-migration","wave-0"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0041. "W0: Task and feature Zod frontmatter schemas with canonical status enums"

### Background

Design: docs/design/rd3-migration-design.md §2.1–2.3, DD-01/02/03/07/10. The parse-validate-serialize SSOT for the planning layer (A18).


### Requirements

R1. taskFrontmatterSchema + featureFrontmatterSchema in packages/domain per the design field tables (schema_version literal 1, feature_id, parent_wbs; no impl_progress/folder/preset).
R2. Lowercase TaskStatus/FeatureStatus unions (incl. feature `verifying`) with case/alias-tolerant input normalization (legacy alias map preserved as input-only).
R3. Round-trip property tests: parse→serialize lossless; per-file coverage ≥90%.
R4. Same-commit 04_DESIGN §7.3 sync.


### Q&A



### Design

Authority: `docs/design/rd3-migration-design.md` §2.1 (task field table), §2.2 (feature field table),
§2.3 (status enums + graphs). Binding decisions: DD-01 (lowercase canonical statuses, alias/case-tolerant
input only), DD-02 (`profile` single key), DD-03 (`schema_version` literal `1`), DD-07 (snake_case keys,
`feature_id`), DD-10 (no `folder`, no `description==name` default), DD-13 (`verifying` in FeatureStatus),
DD-14 (feature ID regex `^[A-Z][1-9]*$`, no `parent_id` field).

Placement: `packages/domain` (03 §12.1 default home). Exported names are fixed by the delivery doc §5.1:
`taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskFrontmatter`, `FeatureFrontmatter`,
`TaskStatus`, `FeatureStatus`. Input normalization (alias map) is a separate exported helper — storage
values are always lowercase canon; aliases never persist.


### Solution

1. New module `packages/domain/src/planning/schema.ts` (re-exported from the package index): zod schemas
   mirroring the design field tables exactly; `z.literal(1)` for `schema_version`.
2. Port the legacy alias map (`cc-agents/plugins/rd3/skills/tasks/scripts/types.ts` `normalizeStatus`)
   as an input-only `normalizeTaskStatus` / `normalizeFeatureStatus` helper in the same module; extend
   for the feature vocabulary (`verifying`, lowercase canon).
3. Tests `packages/domain/tests/planning-schema.test.ts`: every field-table row exercised; alias + case
   normalization; rejection errors list the allowed set; `feature_id`/`parent_wbs` regex edges.
4. Gate: `bun run check`; per-file coverage ≥90%; same commit updates `04_DESIGN.md §7.3` field tables (X05).


### Plan
- [x] Author `packages/domain/src/planning/schema.ts` with `taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskStatus`/`FeatureStatus` unions, and `normalizeTaskStatus`/`normalizeFeatureStatus` input-only helpers (legacy alias map preserved)
- [x] Re-export planning module from `packages/domain/src/index.ts`
- [x] Add `tests/planning-schema.test.ts` exercising every field-table row, alias/case normalization, regex edges, and a round-trip parse → serialize lossless assertion
- [x] Update `docs/04_DESIGN.md §7.3` with the Zod field tables (same-commit X05)
- [x] Run `bun run lint` and `bun test` in `packages/domain`; per-file coverage ≥90%
- [x] Run `bun plugins/rd3/skills/task-runner/scripts/postflight-check.ts 0041` (mandatory subset + full audit)


### Review

Stage 4 SECU review of the W0 frontmatter schema slice.

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P3 | `packages/domain/src/planning/schema.ts:142,145` | The `z.enum(...).transform((value) => value as TaskStatus)` wrapper is a redundant cast — zod 4 already narrows the inferred type to the literal union. | Leave as-is: the explicit type alias keeps the public API stable and is exercised by the round-trip test. No change required. |

**Verdict:** PASS.

Evidence: 27/27 new unit tests pass; domain `bun run typecheck` clean; root `bun run lint` clean across all 7 workspaces; per-file coverage on `src/planning/schema.ts` is 100% (lines + funcs), exceeding the ≥90% requirement; `04_DESIGN.md §7.3` synced in the same commit with the Zod field tables.

### Testing

- Result: 2026-06-13T17:05:00Z — 27 pass / 0 fail; per-file coverage on `src/planning/schema.ts` is 100% funcs, 100% lines (≥90% target met).
- Command: `cd packages/domain && bun test tests/planning-schema.test.ts --coverage`
- Scope: 27 new tests across 6 describe blocks (task schema, feature schema, normalizeTaskStatus, normalizeFeatureStatus, round-trip, vocabulary exports) — every field-table row, alias/case normalization, regex edges (single-letter feature_id, 4-digit parent_wbs, `A0`/`a1` rejection), and parse → JSON-serialize lossless assertions.
- Result: 27 pass / 0 fail. Per-file coverage on `src/planning/schema.ts`: 100% funcs, 100% lines (≥90% target met). Full domain suite: 120 pass / 33 fail — the 33 failures are pre-existing in DAO/migration tests, reproducible at the baseline commit (34 fail before my change).
- Evidence: `bun test tests/planning-schema.test.ts` → "27 pass, 0 fail, 90 expect() calls". Root `bun run lint` clean across all 7 workspaces.
- Next action: none.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Code | `packages/domain/src/planning/schema.ts` | task-runner | 2026-06-13 |
| Code | `packages/domain/src/index.ts` | task-runner | 2026-06-13 |
| Test | `packages/domain/tests/planning-schema.test.ts` | task-runner | 2026-06-13 |
| Doc  | `docs/04_DESIGN.md` §7.3 | task-runner | 2026-06-13 |

### References


