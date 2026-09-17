# Design — `/sp:dev-refactor` lens-routed refactoring with a preservation contract

Feature: [`H13`](../features/H13_dev-refactor-lens-routed-refactoring-command-with-preservation-contract.md).  
Decision: no new ADR — composes ADR-028 (spine dispatches competencies), ADR-032 (commands are thin
wrappers), ADR-054 (spine vs facade ownership).  
Working evidence: [`2026-09-17-dev-refactor-brainstorm.md`](../plans/2026-09-17-dev-refactor-brainstorm.md)
(skill review G1–G9, approach comparison).  
Status: proposed design; not yet built.

## 1. Problem

The four taste-refactoring skills (`api`, `architect`, `tests`, `ui`) are strong interactive lenses
but are unreachable from the `/sp:dev-*` surface and carry no shared contract: severities diverge,
only two of four have a preservation contract, none defines an apply loop, and a cheaper executor
cannot merge or gate their prose output. `/sp:dev-review` is report-only; `/sp:dev-simplify` is
generic. There is no safe "refactor this path and keep every feature" entry point.

## 2. Chosen approach

**Thin command → new coordinator skill `sp:code-refactoring` → four lens skills.** The coordinator
owns everything a cheaper model must get right mechanically (routing, schema, severity, preservation,
apply loop, HITL); the lenses keep their principles and gain a short `## Spur contract`. Rejected:
logic in the command body (breaks ADR-032 / `validate-commands.ts`), extending `sp:code-improvement`
(review-only inside `dev-review`; `super-reviewer` never edits).

```text
/sp:dev-refactor [<description>] [--scope <path>] [--focus …] [--fix …] [--check <cmd>] [--agent …] [--auto]
  └─ Skill(sp:code-refactoring)
       ├─ 0 resolve   scope path, focus set (auto → focus-detection), baseline check
       ├─ 1 analyze   dispatch each lens skill → native findings → map to refactor-finding schema
       ├─ 2 merge     dedupe by (file, span, rung); rank P1→P4; classify preservation
       ├─ 3 gate      objective: confirm scope/focus, confirm apply batch   (--auto skips)
       │              taste:     every cutting/breaking finding              (never skipped)
       ├─ 4 apply     --fix policy → one finding at a time → --check → revert on regression
       └─ 5 report    .spur/run/<run-id>-refactor-findings.json + -refactor-report.md
```

## 3. Command surface

File: `plugins/sp/commands/dev-refactor.md` — frontmatter `role: reviewer` (the analysis is the
product; applies are mechanical and run in the same session), `allowed-tools: ["Bash", "Read",
"Edit", "Skill"]`.

| Flag | Meaning | Default |
| --- | --- | --- |
| `[<description>]` | Free-text steering for the lenses (e.g. "pagination consistency"). | — |
| `--scope <path>` | Path bound; no edit may land outside it. Glossary `#flag-scope`. | working tree (recent changes) |
| `--focus <api\|architect\|tests\|ui\|auto>` | Lens set; comma list allowed (`api,tests`). Glossary `#flag-focus`. | `auto` |
| `--fix <none\|blockers-first\|all>` | Apply policy; `blockers-first` = P1/P2. Glossary `#flag-fix`. | `none` |
| `--check <cmd>` | Verification command for baseline and per-fix checks. | project gate (`bun run spur-check` when present) |
| `--agent <inline\|auto\|name>` | Execution surface; inline is this session. Glossary `#flag-agent`. | `inline` |
| `--auto` | Skip objective gates only. Glossary `#flag-auto`. | off |

Positional and `--scope` follow the family convention (H8 flag normalization); operator-approved
2026-09-17 over `[<scope>] --target <path>`.

## 4. Shared finding schema (`references/refactor-finding.schema.json`)

One JSON object per finding; the findings artifact is a bare array.

| Field | Type | Values / notes |
| --- | --- | --- |
| `id` | string | `RF-<focus>-<nnn>` |
| `focus` | enum | `api` `architect` `tests` `ui` |
| `severity` | enum | `P1` `P2` `P3` `P4` (see §5) |
| `rung` | string | lens-native rung (`A0–A7`, `T0–T7`, api compatibility class, ui pass name) |
| `title` | string | one line |
| `evidence` | `{file, line}[]` | at least one `file:line` inside `--scope` |
| `preservation` | enum | `preserving` (behavior identical) · `cutting` (a user-visible feature/test/endpoint/control is removed) · `breaking` (contract or behavior changes for a consumer) |
| `fix_eligibility` | enum | `auto` (mechanical, behavior-preserving, checkable) · `confirm` (needs an operator answer) · `suggest` (report only) |
| `proposal` | string | what to change, imperative |
| `verify` | string | command or check that proves the fix (defaults to `--check`) |
| `status` | enum | `open` `applied` `reverted` `deferred` `rejected` |

Structural check (no new dependency): a documented `bun -e` snippet in `finding-schema.md` asserts
required keys and enum membership; the coordinator runs it before writing the report.

## 5. Severity map (lens-native → P1–P4)

Authority: `super-reviewer.md` Output Format and the L3 `review-priority-table`.

| Lens | Native | → P1 (blocker) | → P2 (major) | → P3 (minor) | → P4 (advisory) |
| --- | --- | --- | --- | --- | --- |
| tests | P0–P3 | P0 | P1 | P2 | P3 |
| ui | P0–P3 | P0 | P1 | P2 | P3 |
| architect | A-ladder + 7-axis scores | any axis ≤1 with a correctness/safety consequence | axis ≤2 or A5–A7 seam problems | A3–A4 | A0–A2, ADR candidates, deferred questions |
| api | compatibility class | `breaking` change already shipped or contract ambiguity that corrupts data | `risky` inconsistency across ≥2 endpoints | `additive` cleanups | naming/docs |

Rule: a `cutting` or `breaking` finding is never below P2 and never `fix_eligibility: auto`.

## 6. Fix ladder and eligibility (`references/fix-ladder.md`)

| Rung | Example | `preservation` | `fix_eligibility` |
| --- | --- | --- | --- |
| Rename / move / dedupe / inline with identical behavior | A3 consolidate, T3 fixture cleanup, ui token normalization | preserving | `auto` |
| Add missing test, contract field, a11y attribute | T4, api additive, ui P3 | preserving | `auto` |
| Remove dead code with zero references | A1 direct removal proven dead | preserving | `auto` only when a reference search finds no caller; else `confirm` |
| Remove a test, endpoint, control, or code path with callers | T1, A1/A2 live, api removal, ui control removal | cutting | `confirm` |
| Change a contract or observable behavior | api breaking, A5–A7 seam moves | breaking | `confirm` (or `suggest` when multi-task) |
| Architectural migration plan | A6–A7, ADR candidates | — | `suggest` |

Apply loop (mirrors `dev-simplify`): baseline `--check` must be green before any edit; apply one
finding; run `--check`; on failure revert that finding (`git checkout -- <files>` limited to the
finding's evidence files), mark `reverted`, continue. Tests are never deleted or weakened by an
`auto` fix. `--fix blockers-first` applies P1/P2 with `auto`; `--fix all` applies every `auto`
finding and queues every `confirm` finding for the taste gate.

## 7. HITL matrix

| Gate | Class | `--auto` | Headless (`--agent auto|name`) |
| --- | --- | --- | --- |
| Confirm resolved scope + lens set | objective | skipped | skipped |
| Confirm apply batch of `auto` findings | objective | skipped | skipped |
| Each `cutting` / `breaking` finding | taste | **pauses** | deferred: `status: deferred`, listed as SUGGEST in the report |
| Baseline check red | hard stop | stop, report | stop, report |

## 8. Focus auto-detection (`references/focus-detection.md`)

Deterministic, first match per file, union across files; report the set before running lenses.

| Order | Glob | Lens |
| --- | --- | --- |
| 1 | `**/tests/**`, `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**` | tests |
| 2 | `apps/web/**`, `**/*.astro`, `**/*.tsx`, `**/*.jsx`, `**/*.css`, `**/*.vue` | ui |
| 3 | `packages/contracts/**`, `**/routes/**`, `**/openapi*`, `**/*.proto`, `**/*.graphql`, `apps/cli/src/commands/**`, `apps/server/src/**` | api |
| 4 | anything else | architect |

## 9. Lens refinements (additive, per taste skill)

- `## Spur contract` section (≤40 lines) in each `SKILL.md`: inputs (scope, description), what to
  read, native output → schema mapping (§4/§5), preserved-behavior inventory requirement, stop rules.
- Frontmatter: `license: Apache-2.0` + `metadata` (author, version, platforms, category, interactions)
  matching sibling skills; README version column filled.
- `taste-refactoring-api/references/protocol-modes.md`: new `## CLI mode` (nouns/verbs, flag
  vocabulary, exit codes, `--json` envelope, help text parity) — Spur itself is the first consumer.
- No change to principles, pass orders, or native output sections.

## 10. Artifacts and bookkeeping

- `.spur/run/<run-id>-refactor-findings.json` (schema §4) and `-refactor-report.md` (lens set,
  P1–P4 table, preservation summary, applied / reverted / deferred lists).
- `flag-glossary.md`: add `dev-refactor` to the `--auto`, `--focus`, `--fix`, `--scope`, `--agent`
  declaring lists; add `--check` entry if it becomes shared (`dev-simplify`, `dev-refactor`).
- `plugins/sp/references/roles.md`: `dev-refactor → reviewer`.
- `plugins/sp/README.md`: command row + `code-refactoring` skill rows.
- `spur-dev/references/dev-operations.md`: `### 17. refactor` dispatch row.
- Validators: `validate-commands.ts` (a–e), `validate-flag-contracts.ts` (C1/C2), `roles.test.ts`,
  plugin structure tests.

## 11. Invariants

1. No edit outside `--scope`; no edit before a green baseline.
2. `cutting` / `breaking` findings are applied only after an explicit operator `yes`.
3. Tests are never removed or weakened by an `auto` fix.
4. Every finding carries `file:line` evidence inside scope.
5. The command file contains no orchestration logic (ADR-032).

## 12. Deferred

- Lenses `code` (route to `sp:code-improvement` / `sp:code-simplification`) and `data`
  (schema / DAO / migrations).
- Turning `deferred` findings into tasks via `spur task create`.
