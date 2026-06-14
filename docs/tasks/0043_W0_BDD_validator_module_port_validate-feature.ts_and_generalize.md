---
name: "W0: BDD validator module — port validate-feature.ts and generalize"
description: "W0: BDD validator module — port validate-feature.ts and generalize"
status: Done
created_at: 2026-06-13T01:08:18.980Z
updated_at: 2026-06-13T12:00:00.000Z
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

## 0043. "W0: BDD validator module — port validate-feature.ts and generalize"

### Background

Design §3.3, DD-09. X01/K08: port of cc-agents plugins/rd3/skills/bdd-workflow/scripts/validate-feature.ts (543 lines, 100% coverage) into packages/domain, promotion-ready for future @gobing-ai/ts-bdd.


### Requirements

## Requirements

- [x] **R1** — Gherkin-subset parser (AST aligned to @cucumber/gherkin, no runtime dep) + checklist parser → **MET** | Impl: `parser.ts:63 parseFeature()` + types `ParsedFeature`/`ParsedScenario`/`ParsedStep` (parser.ts:13/23/33); `checklist.ts:27 parseChecklist()`. Tests: `parser.test.ts` (16), `checklist.test.ts` (10). No runtime @cucumber/gherkin import (verified).
- [x] **R2** — `validateAcceptanceCriteria` with line-numbered `ValidationIssue[]` (legacy result contract) → **MET** | Impl: `validate.ts:31 validateAcceptanceCriteria()` → `ValidationResult { valid, errors, warnings }`, every issue carries `line`. Tests: `validate.test.ts` (29).
- [x] **R3** — `checkAcCoverage` by normalized scenario title (DD-09); orphans = warnings → **MET** | Impl: `coverage.ts:47 checkAcCoverage()` + `coverage.ts:30 normalizeTitle()` (lowercase, whitespace-collapse, R-id strip, smart-quote strip); orphans pushed as `severity: 'warning'` (coverage.ts:103). Subset rule enforced. Tests: `coverage.test.ts` (16).
- [x] **R4** — Legacy suite ported & passing; zero Spur-internal imports → **MET** | 71 tests pass / 0 fail. `rg '@gobing-ai/spur' src/bdd/` → none. Only relative intra-module imports. Promotion to `@gobing-ai/ts-bdd` is a pure move.

**Verdict: PASS** (post-fix) — all 4 requirements MET; 0 unmet, 0 partial. Phase 7: 0 P1/P2/P3, 1 P4 (fixed).


### Q&A



### Design

Authority: design §3.3, DD-09 (coverage matching by normalized scenario title; tags are filters, not
identity). The module is the single BDD implementation behind `task check`, `feature check`, and
pipeline-output gating — no other parser may exist (X01 consolidation).

Contracts kept from the legacy `validate-feature.ts`: `ValidationIssue`/`ValidationResult` with line
numbers, `ParsedFeature`/`ParsedScenario`/`ParsedStep` shapes. AST property names align with
`@cucumber/gherkin` types (types referenced, **no runtime dependency**). Promotion constraint: zero
Spur-internal imports inside the module — it must be movable to `@gobing-ai/ts-bdd` as a pure move.


### Solution

1. `packages/domain/src/bdd/` split: `parser.ts` (Gherkin subset: Feature/Scenario/Given/When/Then/And/
   But + tags), `checklist.ts` (`- [ ]` / `- [x]` parser), `validate.ts` (validateAcceptanceCriteria),
   `coverage.ts` (checkAcCoverage: normalized-title matching, subset rule, orphan warnings), `index.ts`.
2. Port source: `cc-agents/plugins/rd3/skills/bdd-workflow/scripts/validate-feature.ts` (543 lines,
   100% coverage) — port its full test suite first, then refactor into the split layout (tests stay green).
3. Add coverage + checklist tests (new capability): task-AC ⊆ feature-AC fixtures including R-id-prefixed
   scenario titles; orphan scenarios produce warnings, never errors.
4. Gate: legacy suite + new tests green; ≥90%; no `@gobing-ai/spur-*` imports (checked by review).


1. Created `packages/domain/src/bdd/parser.ts` — `parseFeature()` + types (`ParsedFeature`, `ParsedScenario`, `ParsedStep`), ported from legacy `validate-feature.ts` with description parsing added.
2. Created `packages/domain/src/bdd/validate.ts` — `validateAcceptanceCriteria()` (renamed from `validateFeature`), keeps legacy `ValidationIssue`/`ValidationResult` contract with line numbers.
3. Created `packages/domain/src/bdd/checklist.ts` — `parseChecklist()` for Tier-2 AC (`- [ ]`/`- [x]` with R-id extraction).
4. Created `packages/domain/src/bdd/coverage.ts` — `checkAcCoverage()` + `normalizeTitle()` implementing DD-09 normalized-title matching, subset rule, orphan warnings.
5. Created `packages/domain/src/bdd/index.ts` barrel export; added `export * from './bdd'` to domain index.
6. Split tests into 4 files matching source: `parser.test.ts`, `validate.test.ts`, `checklist.test.ts`, `coverage.test.ts` — 71 tests total.

### Review

## Review — 2026-06-13 (dev-verify --force --fix all)

**Status:** 3 findings — all fixed
**Scope:** `packages/domain/src/bdd/` (parser, validate, coverage, checklist, index — 564 LoC)
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate (full project):** lint clean (208 files, 7 workspaces) · `tsc --noEmit` clean · 706/706 tests pass · test-cf 1/1 · build OK · **bdd module 100% func / 100% line**

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | None | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | None | — | — | — |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Dead `!stepText` branch — unreachable defensive code (regex `\s+(.*)$` after `trim()` can never yield empty group 2); ported verbatim from legacy 543-line source | Correctness | validate.ts:223-229 (orig) | FIXED — removed branch + now-unused `stepText` var. validate.ts → 100% line (was 97.78%) |
| 2 | Dead `allowDescriptionLines` guard in `isDescriptionLine` — sole caller hardcodes `true`, so `if (!allowDescriptionLines) return false` is unreachable | Correctness | parser.ts:46-48 (orig) | FIXED — dropped the dead parameter + branch; simplified to single-purpose predicate. parser.ts → 100% line (was 99.35%) |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | Stray value-import at file bottom with false circular-dep comment | Usability | coverage.ts:141-142 (orig) | FIXED — merged into top `./parser` import; removed misleading "import lazily to avoid circular dependency" comment (static import is hoisted; parser imports nothing from coverage → no cycle). Biome import-sort applied |

**Fix-pass 2026-06-13:** 3 fixed, 0 failed, 0 skipped. All five project gates green post-fix. BDD module now 100% line + function coverage across all 4 source files; 71 module tests pass / 706 project tests pass.

### SECU clean-bill notes
- **Security:** no hardcoded secrets, no injection/eval/exec, no `innerHTML`. Pure string/regex parsing of trusted in-process content.
- **Efficiency:** linear single-pass parsers; `Set`-based O(1) coverage lookups. No N+1, no unbounded growth.
- **Correctness:** no `any` (noExplicitAny clean), no swallowed catch blocks, exhaustive optional-capture guards (`?? ''`). Two dead branches eliminated (findings 1–2).
- **Promotion constraint (R4):** zero `@gobing-ai/spur-*` imports; only intra-module relative imports → pure move to `@gobing-ai/ts-bdd` confirmed.


### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | None | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | None | — | — | — |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | None | — | — | — |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Stray value-import at file bottom with false circular-dep comment | Usability | coverage.ts:141-142 | Merge `parseFeature` value import into the top `./parser` import; remove misleading "import lazily to avoid circular dependency" comment (a static import is hoisted, not lazy; parser imports nothing from coverage → no cycle exists) |

**Fix-pass 2026-06-13:** 1 fixed, 0 failed, 0 skipped. coverage.ts top import now merged (`import { type ParsedFeature, type ParsedScenario, parseFeature as parseFeatureInternal } from './parser'`); bottom import + comment removed; Biome import-sort autofix applied. Gate re-run green.

### SECU clean-bill notes
- **Security:** no hardcoded secrets, no injection/eval/exec, no `innerHTML`. Pure string/regex parsing of trusted in-process content.
- **Efficiency:** linear single-pass parsers; `Set`-based O(1) lookups for coverage matching. No N+1, no unbounded growth in hot paths.
- **Correctness:** no `any` (noExplicitAny clean), no empty/swallowed catch blocks, exhaustive null-guards on optional captures (`?? ''`).
- **Promotion constraint (R4):** zero `@gobing-ai/spur-*` imports; only intra-module relative imports → pure move to `@gobing-ai/ts-bdd` confirmed.


### Testing

Full suite: `bun run spur-check` — lint clean (7 workspaces), 706 pass / 0 fail / 1788 assertions.
Pre-check: 21/21 rules pass. Post-check: 2/2 rules pass (coverage-gate + tsdoc-export).

### Artifacts

| Type | Path | Agent | Date |
| impl | `packages/domain/src/bdd/parser.ts` | main | 2026-06-13 |
| impl | `packages/domain/src/bdd/validate.ts` | main | 2026-06-13 |
| impl | `packages/domain/src/bdd/checklist.ts` | main | 2026-06-13 |
| impl | `packages/domain/src/bdd/coverage.ts` | main | 2026-06-13 |
| impl | `packages/domain/src/bdd/index.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/bdd/parser.test.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/bdd/validate.test.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/bdd/checklist.test.ts` | main | 2026-06-13 |
| test | `packages/domain/tests/bdd/coverage.test.ts` | main | 2026-06-13 |


### References


