---
kind: plan
title: "Brainstorm: `/sp:dev-refactor`"
status: approved
created_at: 2026-09-17
updated_at: 2026-09-17
related: ["0883", "0884"]
tags: [brainstorm, planning, plugin]
needs_design: true
run_id: 3c754764-3ea9-4746-a8de-5e30f3bb2aaf
---

# Brainstorm: `/sp:dev-refactor`

## Overview

Add a slash command that routes a target through the four taste-refactoring lenses (api, architect,
tests, ui), reports findings in one shared schema, and optionally applies fixes under a
**preservation contract**: every behavior stays, or a cut is explicitly confirmed by a human. The
command is meant to be executed correctly by cheaper models, so the contract must be mechanical
(schema, severity map, fix ladder, stop rules), not prose taste.

## Review of the four taste skills (as requested)

What is good and stays: each lens carries a coherent principle set, a diagnostic pass order, and a
native output contract. Nothing below rewrites the lenses; it adds the thin contract a command needs.

| # | Gap | Affected | Refinement |
| --- | --- | --- | --- |
| G1 | No shared, machine-parseable finding schema; a cheaper model cannot merge lenses or gate on severity | all four | Add one `refactor-finding` schema (id, focus, severity, rung, evidence `file:line`, preservation class, fix eligibility, verify command) owned by the coordinator; each lens maps its native output to it |
| G2 | Severity vocabularies diverge: ui/tests use P0–P3, architect has only the A0–A7 ladder, api has none | all four | Normalize to the repo authority P1 (blocker) / P2 (major) / P3 (minor) / P4 (advisory) (`super-reviewer.md`, L3 `review-priority-table`); `--fix blockers-first` = P1/P2 per glossary |
| G3 | Preservation is uneven: architect has a Preservation Contract, tests a Confidence Contract, api only a compatibility class (additive/risky/breaking), ui none | api, ui (contract); all (classification) | Every lens emits a **preserved-behavior inventory** and classifies each proposal `preserving` / `cutting` / `breaking`; `cutting`/`breaking` is a taste gate that `--auto` never skips |
| G4 | No apply protocol: ui has Implementation mode, api a code-refactor mode, architect and tests are suggest-only; nothing defines baseline → apply → check → revert | all four | Coordinator owns the apply loop (mirrors `dev-simplify`): baseline check, one finding at a time, re-check, revert on regression; per-rung fix eligibility (`auto` / `confirm` / `suggest`) |
| G5 | No `--focus auto` heuristic | — | Deterministic path classifier in the coordinator (tests globs → tests; `apps/web`, `.astro/.tsx/.css` → ui; `packages/contracts`, routes, OpenAPI, `apps/cli/src/commands` → api; else architect); multiple matches run each lens and merge |
| G6 | api lens has REST / RPC / GraphQL / event modes but no **CLI** mode, while Spur itself is a CLI (nouns, verbs, flags, exit codes, `--json` envelope) | api | Add `## CLI mode` to `references/protocol-modes.md` (missing aspect) |
| G7 | Frontmatter parity: only `name` + `description`; other sp skills carry `license` + `metadata` (version, platforms, interactions); README lists version `—` | all four | Add the standard metadata block |
| G8 | 16–19 KB prose each; no compact entry for a cheaper executor | all four | Each SKILL.md gains a ≤40-line `## Spur contract` section (what to read, what to emit, stop rules); essays stay as references |
| G9 | Overlap with `sp:code-improvement` (module depth), `sp:code-simplification` (`/sp:dev-simplify`), `/sp:dev-review` | positioning | dev-refactor = domain-lens refactoring **with apply**; dev-simplify = generic simplification; dev-review = report only. Deferred lenses: `code` (route to code-improvement/simplification) and `data` (schema/DAO/migrations — no lens exists today) |

## Approaches

**A. Orchestration inside the command body.** Focus routing, schema, apply loop written into
`dev-refactor.md`. Rejected: violates the thin-wrapper contract (ADR-032, `validate-commands.ts`
heading whitelist) and cannot be reused by other hosts.

**B. New coordinator skill `sp:code-refactoring` + lens contracts (recommended).** The command is a
thin wrapper over the coordinator; the coordinator owns G1/G2/G4/G5 and the HITL protocol; the four
taste skills gain the `## Spur contract` section (G3/G6/G7/G8). Same spine → competency pattern
as `sp:spur-dev` (ADR-028/ADR-054).

**C. Extend `sp:code-improvement` to cover it.** Rejected: that skill is review-only inside
`/sp:dev-review`; adding apply semantics blurs the review/build boundary (`super-reviewer` never
edits).

## Recommendations

- Approach B.
- Argument surface (glossary-consistent):
  `[<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]`.
  Operator proposed `[<scope>]` (free text) + `--target <path>`; `--scope <path>` already means
  "bound to a path" for six commands, so `--target` would be a second name for the same concept.
  Semantics are unchanged; only the spelling differs. If `--target` is preferred, it needs a glossary
  entry and the positional keeps its free-text meaning.
- `--auto` skips objective gates only (scope/focus confirmation, per-batch apply confirmation).
  Feature cuts and breaking changes are taste gates: they always pause; under headless `--auto`
  they are deferred into the report, never applied. This is exactly "keep all features or explicitly
  cut with HITL".
- `--fix` default `none`; role `reviewer` (analysis is the product; fixes are mechanical after
  findings and run under the same session).
- Artifacts: `.spur/run/<run-id>-refactor-findings.json` (shared schema) + `-refactor-report.md`.

## Design Summary

- **Components:** new skill `plugins/sp/skills/code-refactoring/` (SKILL.md + `references/finding-schema.md`, `references/fix-ladder.md`, `references/focus-detection.md`); new command `plugins/sp/commands/dev-refactor.md` (thin wrapper); `## Spur contract` sections in the four taste skills; `## CLI mode` in api protocol modes.
- **Boundaries touched:** command surface (flag glossary declaring lists for `--auto`, `--focus`, `--fix`, `--scope`, `--agent`, `--check`), roles Layer-1 mapping, `plugins/sp/README.md` index, `dev-operations.md` § refactor row, design satellite (`docs/design/planning-command-contracts.md` / `dev-command-argument-contract.md`).
- **Invariants:** command passes `validate-commands.ts` (a–e) and `validate-flag-contracts.ts` (C1/C2); `roles.test.ts` closed mapping; no edit outside `--scope`; cutting/breaking findings are never applied without a human answer; baseline check green before any apply; tests never weakened.
- **needs_design = true:** cross-cutting convention across five skills, a new module, and a new command surface.

## Next Steps

1. Feature + AC (R-numbered Gherkin) covering: lens routing, shared schema, severity map, preservation gate, fix ladder + revert, artifacts, validators green.
2. System design satellite (approach B seams, schema, HITL matrix).
3. Task batch: (a) coordinator references (schema/ladder/detection); (b) lens contracts + metadata + CLI mode; (c) coordinator SKILL.md; (d) command + glossary + roles + README + satellite; (e) dry run on a real target as acceptance evidence.
