---
name: consistency_enforcement_gate_for_doc_surface_json
description: Build a test / spur rule asserting doc↔spec↔--json consistency across the CLI surface
status: Done
created_at: 2026-06-06T06:30:00.000Z
updated_at: 2026-06-06T17:20:00.000Z
folder: docs/tasks
type: task
feature-id: ""
priority: low
estimated_hours: 3
tags: ["spur","cli","help","testing","follow-up"]
preset: standard
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0022. Consistency-enforcement gate for doc↔surface↔--json

### Background

The CLI surface is defined by Commander `registerXxxCommand(program, context)` functions, one per
noun under `apps/cli/src/commands/`. `docs/04_DESIGN.md §1` documents the same surface manually.
There is no automated check that the two stay in sync, or that every `--json` claim corresponds to
a real `toJson` / `JSON.stringify` code path.

> The original framing assumed a `CommandSpec` SSOT (from an early 0021 design). That construct
> was never built; see the re-scope note under **Requirements**.

This is brainstorm Approach 3 from task 0021, explicitly deferred to a follow-up.

### Requirements

> **Re-scope note (2026-06-06).** R1/R2 originally specified AST extraction of `CommandSpec`
> declarations. The codebase has no `CommandSpec` SSOT — each noun is wired via a Commander
> `registerXxxCommand(program, context)` function (see `04_DESIGN.md §1.0`). The premise carried
> over from an earlier 0021 design that was never built that way. R1/R2 are therefore re-scoped to
> their actual goal — **doc↔code surface parity, enforced automatically** — using a `spur rule`
> structural check plus a programmatic parity test. AST was a means, not the goal; the delivered
> regex-rule + parity-test pair provides the same guarantee against the real code structure.

- **R1 — `spur rule` surface-consistency rule.** Add a `check-cli-surface` rule (in the `surface`
  preset) that scans every `apps/cli/src/commands/*.ts` file and requires the standard
  `registerXxxCommand(program, context)` wiring, and a parity test that cross-references the
  documented CLI nouns in `docs/04_DESIGN.md` against the command files for presence parity
  (every documented noun has a file; every file is documented).
  → **MET** | Evidence: `.spur/rules/surface/check-cli-surface.yaml:15-24` (`cli-register-pattern`) + `apps/cli/tests/consistency.test.ts:197-217` (doc↔code noun parity, both directions).
- **R2 — `--json` audit.** Enforce that every command file declaring a `--json` option backs it
  with a real `toJson` / `JSON.stringify` code path (structural rule), and that each verb's
  `--json` claim matches the documented surface per verb (parity test). `rule.ts` is excluded from
  the structural rule because it delegates JSON formatting to `RuleService`.
  → **MET** | Evidence: `.spur/rules/surface/check-cli-surface.yaml:26-38` (`cli-json-output` require) + `apps/cli/tests/consistency.test.ts:219-266` (per-verb `--json` parity). The structural rule guarantees serialization exists per file; the parity test enforces per-verb correctness.
- **R3 — Gate integration.** The rule runs as part of `spur rule run --preset recommended-post-check`
  and fails on mismatch.
  → **MET** | Evidence: `.spur/rules/recommended-post-check.yaml:10-13` extends `quality` + `surface`; `spur rule run --preset recommended-post-check` resolves 4 rules (incl. `cli-register-pattern`, `cli-json-output`), exits 0, 0 findings.

### Notes
### Implementation

- **Blockage resolved:** The `sg` evaluator (ast-grep) in `@gobing-ai/ts-rule-engine` v0.3.2 is stable and registered as a built-in evaluator. The note below was written before the evaluator shipped.
  - ~~Blocked on the rule-engine AST inspection support. Do not implement until stable.~~
- The existing `spur rule validate` and `spur rule run --file` paths should be sufficient;
  no new CLI command needed.

### Delivered

| Artifact | Path | Role |
|----------|------|------|
| Rule file | `.spur/rules/surface/check-cli-surface.yaml` | Two `rg` rules: `cli-register-pattern` (require every command file exports `registerXxxCommand`) and `cli-json-output` (require `toJson` or `JSON.stringify` in all command files; excludes `rule.ts` which delegates to `RuleService`) |
| Preset wiring | `.spur/rules/recommended-post-check.yaml` | Extended `quality` → `quality` + `surface` so the surface checks run in the post-test gate |
| Test | `apps/cli/tests/consistency.test.ts` | Programmatic doc↔code cross-reference: noun presence, --json claim parity |
| Doc fix | `docs/04_DESIGN.md:87` | Added `[--json]` to `agent create` heading for consistency |

### Review — 2026-06-06

**Status:** 3 findings (0 P1, 0 P2, 2 P3, 1 P4)
**Scope:** `apps/cli/tests/consistency.test.ts`, `.spur/rules/surface/check-cli-surface.yaml`, `.spur/rules/recommended-post-check.yaml`, `docs/04_DESIGN.md:87`
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Gate:** `bun run lint` → pass; `bun test consistency.test.ts` → 3 pass; `spur rule run --preset recommended-post-check` → 4 rules, 0 findings
**Verdict:** **PASS** (post re-scope 2026-06-06) — R1/R2/R3 all MET after re-scoping R1/R2 to doc↔code parity (the goal) rather than AST mechanism. No P1/P2 findings; P3#1/#2 resolved by the re-scope, P4#3 fixed.

#### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Mechanism drift: regex used where R1/R2 specified AST (`sg`/CommandSpec) | Correctness | `.spur/rules/surface/check-cli-surface.yaml:20-38` | Re-scope R1/R2 to accept regex+test parity (consistency IS enforced), or migrate `cli-json-output` to the stable `sg` evaluator for true per-verb AST. Recommend re-scope: AST was a means, not the goal. |
| 2 | `cli-json-output` is file-level, not per-verb | Correctness | `.spur/rules/surface/check-cli-surface.yaml:26-38` | A multi-verb file where only one verb serializes still passes `require`. The per-verb `--json` parity check in `consistency.test.ts:219-266` covers the gap, so the combined gate is sound; document that the test is the per-verb authority. |

#### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | Regex doc parser fragile to heading-format changes | Maintainability | `apps/cli/tests/consistency.test.ts:37-137` | Parser depends on exact `#### \`spur <noun>\`` and `·`-joined headings. Add a comment pinning the doc heading contract so a future reformat fails loudly instead of silently parsing zero nouns. |

**Fix-pass 2026-06-06:** 3 resolved. P4#3 fixed (pinned doc-heading contract comment at
`consistency.test.ts:35-40`). P3#1/#2 resolved by re-scoping R1/R2 to doc↔code parity (the goal)
instead of AST mechanism — the `CommandSpec` premise was never built; the code uses Commander
`registerXxxCommand`, which the regex rule + parity test enforce directly. Verdict re-evaluated
to **PASS**.

**Final gate (2026-06-06):** `bun run lint` ✓ · `bun run test` ✓ (542 pass) · `bun run test-cf` ✓
(2 pass) · `bun run build` ✓ · `spur rule run --preset recommended-post-check` ✓ (4 rules,
0 findings). Status confirmed **Done**.

**Correction (2026-06-06):** the gate was initially wired via a stray `.spur/rules/spur-dev.yaml`.
That preset doesn't belong to this repo's `recommended-pre-check` / `recommended-post-check`
convention (the old `spur-dev.yaml` was renamed to `recommended-post-check.yaml` during migration).
Removed the stray file and extended `recommended-post-check` with the `surface` category instead.

### References

- Task 0021 (parent task that deferred this)
- `apps/cli/src/help.ts` (CommandSpec types)
- `docs/04_DESIGN.md §1.0` (CLI grammar contract)
