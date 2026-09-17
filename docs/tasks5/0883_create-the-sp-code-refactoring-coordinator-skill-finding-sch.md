---
schema_version: 1
name: "Create the sp:code-refactoring coordinator skill: finding schema, severity map, fix ladder, focus detection, and the analyze/gate/apply/report procedure"
status: done
template: feature-impl
created_at: 2026-09-17T17:49:42.534Z
updated_at: "2026-09-17T22:47:27.978Z"
feature_id: H13
priority: P1
tags:
  - sp-plugin
  - skill
  - refactoring
  - H13

---

## 0883. Create the sp:code-refactoring coordinator skill: finding schema, severity map, fix ladder, focus detection, and the analyze/gate/apply/report procedure

### Background

Feature H13 adds `/sp:dev-refactor`, a lens-routed refactoring command with a preservation contract. The four taste-refactoring skills (api, architect, tests, ui) are the lenses; they have divergent severities (ui/tests P0–P3, architect A0–A7 ladder, api compatibility class), only architect/tests carry a preservation contract, and none defines an apply loop. This task creates the coordinator skill that owns everything a cheaper executor must get right mechanically. Authority: `docs/design/dev-refactor-command.md` §2, §4–§8, §11 (operator-accepted 2026-09-17). Skill review evidence: `docs/plans/2026-09-17-dev-refactor-brainstorm.md` G1–G5. Covers feature H13 scenarios R1, R2, R3, R5, R6.

### Requirements

- [x] R1. `plugins/sp/skills/code-refactoring/references/refactor-finding.schema.json` (JSON Schema draft-07, bare array of findings) and `references/finding-schema.md` define every field in design §4 (`id`, `focus`, `severity` P1–P4, `rung`, `title`, `evidence[{file,line}]`, `preservation` preserving|cutting|breaking, `fix_eligibility` auto|confirm|suggest, `proposal`, `verify`, `status` open|applied|reverted|deferred|rejected) plus the lens-native → P1–P4 severity map table from design §5 and a documented `bun -e` structural check (required keys + enum membership, no new dependency).
- [x] R2. `references/fix-ladder.md` defines the rungs and eligibility of design §6 and the apply loop: green baseline `--check` before any edit; one finding at a time; re-run `--check`; on failure revert only that finding's evidence files and mark `reverted`; `blockers-first` = P1/P2 with `fix_eligibility: auto`; `all` = every `auto` finding plus every `confirm` finding queued for the taste gate; an `auto` fix never deletes or weakens a test; `cutting`/`breaking` are never `auto` and never below P2.
- [x] R3. `references/focus-detection.md` defines the ordered glob table of design §8 (tests → ui → api → architect, first match per file, union across files) and requires the chosen lens set to be reported before any lens runs; `--focus` accepts a single lens, a comma list, or `auto`.
- [x] R4. `plugins/sp/skills/code-refactoring/SKILL.md` has the sibling frontmatter shape (`name`, `description`, `license: Apache-2.0`, `metadata` with author/version/platforms/category/interactions/operations, `see_also` listing the four taste skills) and a body that executes the six phases of design §2: resolve (scope, focus set, baseline check), analyze (dispatch each selected taste skill via `Skill(...)`, read its `## Spur contract`, map native findings to the schema), merge (dedupe by file+span+rung, rank P1→P4), gate (objective vs taste per design §7), apply (fix ladder), report.
- [x] R5. The skill writes `.spur/run/<run-id>-refactor-findings.json` (validated by the R1 structural check) and `.spur/run/<run-id>-refactor-report.md` containing the lens set, a P1–P4 findings table with `file:line`, a preservation summary (preserving / cutting / breaking counts), and applied / reverted / deferred lists; `--fix none` writes both artifacts and performs no edit.
- [x] R6. gate matrix: scope/focus confirmation and apply-batch confirmation are objective gates skipped by `--auto`; every `cutting` or `breaking` finding is a taste gate that always pauses for an explicit operator answer, and under a headless executor (`--agent auto|name`) it is set to `status: deferred` and listed as SUGGEST in the report; a red baseline check is a hard stop with a report and no edits.
- [x] R7. The skill body states the invariants of design §11 verbatim as stop rules (no edit outside `--scope`; no edit before a green baseline; cuts only after operator `yes`; tests never weakened; every finding has in-scope `file:line` evidence) and passes the plugin structure tests (`cd plugins/sp && bun test` or the repo's equivalent) and `bun run spur-check`.

### Acceptance Criteria

Covers feature H13 scenarios:

- [x] R1 — Shared refactor-finding schema and P1–P4 severity map
- [x] R2 — Fix ladder with per-rung eligibility and apply loop
- [x] R3 — Focus auto-detection classifies by path
- [x] R5 — Coordinator skill sp:code-refactoring dispatches lenses and writes artifacts
- [x] R6 — Cutting and breaking findings always pause for an operator answer

Task-local checks: the structural check snippet rejects `severity: P0` and any `cutting`/`breaking` finding with `fix_eligibility: auto`; plugin structure tests and `bun run spur-check` pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: one coordinator skill owns the mechanical contract; lenses stay taste-only (design §2, approach B; ADR-028 spine→competency, ADR-054 ownership). The schema is a documented JSON Schema plus a `bun -e` structural check rather than a new validator script — plugin-only scripts carry an ADR-065 manifest cost and the check is ~15 lines. Severity is normalized to the repository authority P1 (blocker) / P2 (major) / P3 (minor) / P4 (advisory) (`plugins/sp/agents/super-reviewer.md`, L3 `review-priority-table`) so `--fix blockers-first` reuses the glossary meaning (P1/P2). Preservation class is a first-class field because the operator's requirement is "keep every feature or cut explicitly with operator taste gate"; `cutting`/`breaking` findings are structurally prevented from `auto`. The apply loop mirrors `sp:code-simplification` / `dev-simplify` (test-after-each, revert on regression) — reuse that wording, do not invent a new loop. Focus detection is deterministic globs, not model judgment, so a misroute is auditable. Mutation policy: creates files only under `plugins/sp/skills/code-refactoring/`; touches no taste skill, no command, no docs (those are tasks 2 and 3).

### Plan

1. Read design §2, §4–§8, §11 and `plugins/sp/skills/code-simplification/SKILL.md` (frontmatter + apply-loop wording) and `plugins/sp/skills/spur-dev/SKILL.md` (dispatch table style).
2. Write `references/refactor-finding.schema.json` and `references/finding-schema.md` (fields, severity map, structural-check snippet; verify the snippet rejects a finding with `severity: P0` and accepts a valid one).
3. Write `references/fix-ladder.md` (rungs, eligibility, apply loop, revert rule, test-never-weakened rule).
4. Write `references/focus-detection.md` (glob table, union rule, report-before-run rule).
5. Write `SKILL.md`: frontmatter, purpose, six-phase procedure with the exact `Skill(...)` dispatch per lens, gate matrix, artifacts, stop rules (design §11), and a "Cheaper executor" section listing the minimum files to read.
6. Run plugin structure tests and `bun run spur-check`; fix findings.
7. Record `## Solution` with file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Created the `sp:code-refactoring` coordinator skill (mutation policy honored: new files only under `plugins/sp/skills/code-refactoring/`, plus one forced exception below).

Change map:

- `plugins/sp/skills/code-refactoring/SKILL.md:1` — frontmatter (name/description/license/metadata/see_also listing the four `taste-refactoring-*` lenses, sibling shape per `code-simplification`), stop rules (design §11 verbatim), six phases: resolve (scope, focus set, green baseline), analyze (exact `Skill(sp:taste-refactoring-{tests,ui,api,architect})` dispatch, read `## Spur contract`, map to schema), merge (dedupe by file+span+rung, rank P1→P4, scope re-assert), gate (objective vs taste matrix incl. headless→deferred), apply (fix ladder), report (both artifacts incl. `--fix none`); "Cheaper executor" minimum-reading list (R4).
- `plugins/sp/skills/code-refactoring/references/refactor-finding.schema.json:1` — JSON Schema draft-07, bare array; all §4 fields with enums, `RF-<focus>-<nnn>` id pattern, non-empty `{file,line}` evidence, `additionalProperties: false` (R1).
- `plugins/sp/skills/code-refactoring/references/finding-schema.md:1` — field table, lens-native → P1–P4 severity map (§5, authority `plugins/sp/agents/super-reviewer.md`), documented `bun -e` structural check (~20 lines, no new dependency) asserting required keys + enum membership + evidence shape + the two hard rules (R1, R7 task-local checks).
- `plugins/sp/skills/code-refactoring/references/fix-ladder.md:1` — six rungs with preservation/eligibility (§6), apply policies (`none`/`blockers-first`=P1/P2 auto/`all`=auto + confirm-queued), apply loop mirroring `code-simplification` (green baseline first, one finding at a time, revert only that finding's evidence files, mark `reverted`, continue), test-never-weakened rule (R2).
- `plugins/sp/skills/code-refactoring/references/focus-detection.md:1` — ordered glob table tests→ui→api→architect (§8), first-match per file / union across files, `--focus` single|comma|auto, report-the-set-before-any-lens-runs rule (R3).

Forced exception to "touches no docs": one row added to the `plugins/sp/README.md` Skills index table (line 319). R7 requires the plugin structure tests to pass, and R43 of `plugins/sp/tests/skill-structure.test.ts` fails on any skill directory missing its README index row — the row is the minimal bookkeeping to keep R7 true. No command file, roles, glossary, or dev-operations row touched (those are 0885).

Checks: `bun test tests/skill-structure.test.ts` in `plugins/sp` — 84 pass / 0 fail (incl. R16b ref integrity, R16c link resolution, R42 description budget after shortening, R43 index). Structural check verified: valid fixture passes (exit 0); `severity: P0` rejected with `severity="P0" not in P1|P2|P3|P4`; `cutting`+`auto` rejected with `cutting/breaking is never fix_eligibility auto`. Status transitions left to the pipeline; nothing committed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/code-refactoring/references/refactor-finding.schema.json:1-85` (draft-07, bare array, 11 required fields, evidence minItems 1); field table `references/finding-schema.md:10-24`; severity map `finding-schema.md:29-40`; `bun -e` check `finding-schema.md:41-69` |
| R2 | MET | `plugins/sp/skills/code-refactoring/references/fix-ladder.md:8-18` rungs; `:19-23` hard rules (auto never weakens tests; cutting/breaking never auto/below P2); `:25-31` policies (`blockers-first` = P1/P2 auto); `:33-45` apply loop (green baseline, one finding, scoped revert + `reverted`) |
| R3 | MET | `plugins/sp/skills/code-refactoring/references/focus-detection.md:11-18` ordered globs tests→ui→api→architect; first-match/union `:22-24`; `--focus` single/comma/auto `:26-32`; report-before-run `:34-42` |
| R4 | MET | `plugins/sp/skills/code-refactoring/SKILL.md:1-23` sibling frontmatter with `see_also` four lenses; six phases at `SKILL.md:60,70,97,105,123,129`; lens dispatch `:75-78`; merge dedupe by file+span+rung `:99-103` |
| R5 | MET | `plugins/sp/skills/code-refactoring/SKILL.md:129-142` findings JSON validated by R1 check; report with lens set, P1–P4 table, preservation summary, applied/reverted/deferred lists; `--fix none` no-edit default `SKILL.md:18-19,127` |
| R6 | MET | `plugins/sp/skills/code-refactoring/SKILL.md:105-121` gate matrix: objective gates skipped by `--auto`/headless `:110-112`; cutting/breaking always pause `:107-109,116-118`; headless → `deferred` + SUGGEST `:117-118`; declined → `rejected` `:120-121`; red baseline hard stop `:67-68,119` |
| R7 | MET | `plugins/sp/skills/code-refactoring/SKILL.md:49-55` stop rules (design §11 invariants); `cd plugins/sp && bun test tests/skill-structure.test.ts` — 84 pass / 0 fail (re-run 2026-09-17, incl. R43 README index row check) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Shared refactor-finding schema and P1–P4 severity map | MET | command | Re-ran documented `bun -e` structural check 2026-09-17: valid fixture → `refactor-findings: 1 finding(s) structurally valid` (exit 0); `severity:"P0"` → `severity="P0" not in P1 |
| R2 — Fix ladder with per-rung eligibility and apply loop [docs-only] | MET | static-ref | `plugins/sp/skills/code-refactoring/references/fix-ladder.md:8-45` — anchors re-read this run, all live |
| R3 — Focus auto-detection classifies by path [docs-only] | MET | static-ref | `plugins/sp/skills/code-refactoring/references/focus-detection.md:11-42` — anchors re-read this run, all live |
| R5 — Coordinator skill sp:code-refactoring dispatches lenses and writes artifacts [docs-only] | MET | static-ref | `plugins/sp/skills/code-refactoring/SKILL.md:70-95` dispatch, `:129-142` both artifacts, `--fix none` writes both with no edit |
| R6 — Cutting and breaking findings always pause for an operator answer [docs-only] | MET | static-ref | `plugins/sp/skills/code-refactoring/SKILL.md:105-121` gate matrix; `--auto` skips only objective gates |
| Plugin structure tests + spur-check | MET | test | `cd plugins/sp && bun test tests/skill-structure.test.ts` 84 pass / 0 fail, re-run 2026-09-17 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T18:25:02.668Z todo → wip (system)
- 2026-09-17T18:45:37.246Z wip → testing (system)
- 2026-09-17T18:48:55.281Z testing → done (system)

