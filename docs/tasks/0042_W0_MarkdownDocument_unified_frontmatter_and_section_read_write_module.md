---
name: "W0: MarkdownDocument — unified frontmatter and section read/write module"
description: "W0: MarkdownDocument — unified frontmatter and section read/write module"
status: done
created_at: 2026-06-13T01:08:18.980Z
updated_at: 2026-06-13T11:30:00.000Z
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

## 0042. "W0: MarkdownDocument — unified frontmatter and section read/write module"

### Background

Design §2.1/2.2 heading conventions, DD-08 canonical section vocabulary. H01 — the one markdown I/O layer for tasks and features; packages/domain module (no new package).


### Requirements

R1. Parse/serialize markdown with YAML frontmatter, lossless for untouched content. → **MET** | Evidence: `packages/domain/src/planning/markdown-document.ts:310 serialize()`; round-trip tests (task/feature/no-fm/bad-yaml) + body-byte-identity test in `tests/planning/markdown-document.test.ts`.
R2. Section get/replace by canonical name; per-domain heading conventions (tasks h2/h3, features h1/h2). → **MET** | Evidence: `getSection` (`:251`), `replaceSection` (`:267`) validate the per-domain vocabulary; `HEADING_LEVELS` (`:54`) drives task `###` vs feature `##`; `findHeadings` skips code blocks.
R3. Auto-gen marker region support (feature ## Tasks). → **MET** | Evidence: `replaceMarkerRegion` (`:287`) swaps the marker block, preserving surrounding text; marker tests in the suite.
R4. No regex read-modify-write anywhere downstream. → **MET** | Evidence: `team-service.ts:204-206 assignTask` now uses `MarkdownDocument.setFrontmatterField`; legacy `new RegExp`/`source.replace(fence,…)` helper removed; `rg` over `packages/app/src` + `packages/domain/src` + `apps/cli/src` confirms zero regex frontmatter read-modify-write remains.


### Q&A



### Design

Authority: design §2.1/§2.2 heading conventions (tasks: `## <WBS>. <name>` + `### <Section>`; features:
`# <ID>: <name>` + `## <Section>`), DD-08 (closed canonical section vocabulary — module rejects unknown
section names rather than inventing), §2.2 auto-gen marker region (`<!-- AUTO-GENERATED … -->` /
`<!-- END AUTO-GENERATED -->` — the only machine-owned region in an SSOT file).

H01 home: a module inside `packages/domain` (operator decision — no new package). Export name fixed:
`MarkdownDocument` (delivery doc §5.1). Losslessness is the core contract: untouched content is
byte-preserved, which is what makes parse-validate-serialize safe to put under every write.


### Solution

1. `packages/domain/src/planning/markdown-document.ts`: parse(content) → frontmatter (raw YAML text +
   parsed object) + ordered body segments; `getSection(name)` / `replaceSection(name, body)` keyed on the
   canonical vocabulary; `replaceMarkerRegion(section, table)` for feature `## Tasks`; `serialize()`
   reassembles preserving untouched segments byte-identically.
2. Both heading conventions supported via a domain parameter (task | feature), not duplicated code paths.
3. Tests `packages/domain/tests/planning/markdown-document.test.ts`: lossless round-trip against
   fixture copies of real corpus structure (task `###` sections + feature `##` sections);
   section-replace isolation (only the target section's bytes change); marker-region rewrite leaves
   surrounding section text intact; canonical section validation rejects unknown names per domain.
4. Gate: `bun run check`; ≥90% per file.


1. Added `yaml` to root catalog (shared across `packages/domain` + `packages/app`); migrated both to `catalog:`.
2. Implemented `MarkdownDocument` class in `packages/domain/src/planning/markdown-document.ts` — `parse()` extracts frontmatter + sections, `serialize()` reassembles losslessly.
3. Exported from `packages/domain/src/index.ts`.
4. Wrote 34 tests covering: frontmatter parse (valid/null/malformed YAML), lossless round-trip (4 fixture variants), getSection/replaceSection (isolation + canonical validation), replaceMarkerRegion (content swap + surrounding preservation), heading-level isolation (code-block skipping + h3-vs-h2), edge cases (empty/no-section/CRLF/scalar-array YAML).

### Review

- R1 ✅: Lossless round-trip verified — `parse(content).serialize() === content` for task, feature, no-frontmatter, and malformed-YAML files.
- R2 ✅: `getSection`/`replaceSection` validate against the canonical vocabulary per domain (task 12 / feature 6). Heading levels domain-driven; code-block headings skipped.
- R3 ✅: `replaceMarkerRegion` swaps the `<!-- AUTO-GENERATED -->` … `<!-- END AUTO-GENERATED -->` block; surrounding text byte-preserved.
- R4 ✅ (**fixed in re-verify**): `MarkdownDocument` is now actually adopted downstream — `team-service.ts:204-206 assignTask` uses `setFrontmatterField`; the legacy regex helper (`new RegExp`/`source.replace(fence,…)`) is removed. `rg` confirms zero regex frontmatter read-modify-write remains in `packages/app/src`, `packages/domain/src`, `apps/cli/src`.
- Coverage: `markdown-document.ts` — 100% functions / 100% lines (39 tests; +5 for `setFrontmatterField`).

**Re-verification (dev-verify --force --fix all):** 2026-06-13 — Phase 7 SECU + Phase 8 traceability.

| Severity | File | Finding | Resolution |
|----------|------|---------|------------|
| P2 | `packages/app/src/services/team-service.ts:306` (pre-fix) | R4 asserted "no regex read-modify-write downstream", but `setFrontmatterField` used `new RegExp` + `source.replace(fence,…)` for a frontmatter write, and `MarkdownDocument` was adopted nowhere outside its own module — so R4 was UNMET. | **FIXED** — added `MarkdownDocument.setFrontmatterField(key, value)` (pure string assembly; preserves fence trailer + line-endings + `$`-sequences losslessly), migrated `assignTask` to `parse → setFrontmatterField → serialize`, deleted the regex helper. 5 new domain tests; 19/19 team-service tests still pass (byte-equivalent output). |

**Verdict:** PASS — no P1/P2 remaining; all 4 requirements MET; gate clean; coverage 100%/100%.

Evidence: domain `bun test tests/planning/markdown-document.test.ts` → 39 pass / 0 fail, 100%/100% coverage; app `bun test tests/services/team-service.test.ts` → 19 pass / 0 fail; root `bun run lint` (biome + typecheck × 7 workspaces) clean.

**Fix-pass 2026-06-13:** 1 fixed (P2 — R4 regex elimination + module adoption), 0 failed, 0 skipped. Gate re-run green after the fix.


### Testing

Full suite: `bun run check` — lint clean (7 workspaces), 630 pass / 0 fail, `markdown-document.ts` 100% coverage.
Pre-check: 21/21 rules pass. Post-check: 2/2 rules pass.

### Artifacts

| Type | Path | Agent | Date |
| impl | `packages/domain/src/planning/markdown-document.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/planning/markdown-document.test.ts` | main | 2026-06-13 |
| dep  | `package.json` (yaml catalog entry) | main | 2026-06-13 |
| dep  | `packages/domain/package.json` (yaml catalog:) | main | 2026-06-13 |
| dep  | `packages/app/package.json` (yaml catalog:) | main | 2026-06-13 |


### References


