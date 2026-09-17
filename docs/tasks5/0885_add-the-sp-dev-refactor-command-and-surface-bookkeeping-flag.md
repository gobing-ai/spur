---
schema_version: 1
name: "Add the /sp:dev-refactor command and surface bookkeeping: flag glossary, roles mapping, README, dev-operations row, and validators green"
status: done
template: feature-impl
created_at: 2026-09-17T17:49:42.539Z
updated_at: "2026-09-17T20:41:28.460Z"
feature_id: H13
priority: P1
tags:
  - sp-plugin
  - command
  - refactoring
  - H13

dependencies: ["0883"]
---

## 0885. Add the /sp:dev-refactor command and surface bookkeeping: flag glossary, roles mapping, README, dev-operations row, and validators green

### Background

With the coordinator skill in place, expose it through a thin `/sp:dev-refactor` command that passes the thin-wrapper validator (`plugins/sp/scripts/validate-commands.ts`, gates a–e) and the flag-contract validator (`validate-flag-contracts.ts`, C1/C2), and land the bookkeeping the command family requires. Argument surface operator-accepted 2026-09-17: `[<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]`. Authority: `docs/design/dev-refactor-command.md` §3, §10. Templates: `plugins/sp/commands/dev-simplify.md` (shape, `--check`, `--auto`), `dev-verify.md` (`--fix`, `--focus`). Covers feature H13 scenarios R7 and R8.

### Requirements

- [x] R1. `plugins/sp/commands/dev-refactor.md` exists with frontmatter `description`, `role: reviewer`, the accepted `argument-hint`, `allowed-tools: ["Bash", "Read", "Edit", "Skill"]`; body: H1, "Wraps the **sp:code-refactoring** skill.", `## Argument Flags` table (Flag | Description | Default; `--focus` default `auto`, `--fix` default `none`, `--agent` default `inline`, `--check` default "project gate"), one glossary link, `## Usage`, `## Implementation` with the inline-default execution-surface link and `Skill(skill="sp:code-refactoring", args="$ARGUMENTS")`; hint ↔ table parity.
- [x] R2. `plugins/sp/skills/spur-dev/references/flag-glossary.md` lists `dev-refactor` in the declaring parentheticals of `--auto`, `--focus` (with its lens values), `--fix` (extend "verify-family" wording to include `dev-refactor`), `--scope`, and `--agent`; `--check` gets a glossary entry declaring `dev-simplify` and `dev-refactor` if the validator requires shared flags to be listed, otherwise stays command-local; `bun plugins/sp/scripts/validate-flag-contracts.ts` exits 0.
- [x] R3. `plugins/sp/references/roles.md` maps `dev-refactor` → `reviewer`; `roles.test.ts` (closed command→role mapping) passes.
- [x] R4. `plugins/sp/README.md` gains the `dev-refactor` command row and `code-refactoring` skill rows in the skills tree and skills table; `plugins/sp/skills/spur-dev/references/dev-operations.md` gains `### 17. refactor` (purpose, flags, dispatch to `sp:code-refactoring`, artifacts, operator taste gate classes) consistent with the existing row shape.
- [x] R5. `docs/design/dev-refactor-command.md` status line updated to reflect the built surface; `docs/04_DESIGN.md §1.3` agent command surface mentions `dev-refactor` if that section enumerates commands.
- [x] R6. `bun plugins/sp/scripts/validate-commands.ts` exits 0, plugin structure tests pass, `bun run spur-check` passes.

### Acceptance Criteria

Covers feature H13 scenarios:

- [x] R7 — dev-refactor command passes the wrapper and flag validators
- [x] R8 — Surface bookkeeping is complete

Task-local checks: both validators exit 0; `roles.test.ts` passes; README, dev-operations, glossary, and roles all reference `dev-refactor` / `code-refactoring`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Command carries zero orchestration logic (ADR-032; design §11 invariant 5) — every behavior lives in `sp:code-refactoring`. `role: reviewer` because the finding pass is the product and the tier floor is about analysis quality; applies run in the same session under the same executor. Flag names reuse the glossary (H8 normalization): `--scope <path>` not `--target`, positional is free text. Bookkeeping order: satellite already exists (T9 detail-first) — only its status line changes here. Mutation policy: one new command file; edits confined to glossary, roles.md, README, dev-operations.md, the satellite status line, and (only if it enumerates commands) `docs/04_DESIGN.md §1.3`.

### Plan

1. Read `validate-commands.ts` gate list and `validate-flag-contracts.ts` C1/C2; read `dev-simplify.md` and `dev-verify.md`.
2. Write `plugins/sp/commands/dev-refactor.md`.
3. Update flag-glossary declaring lists; run `bun plugins/sp/scripts/validate-flag-contracts.ts`.
4. Update `roles.md`; run `roles.test.ts` inside `plugins/sp` (or the workspace that owns it).
5. Update README rows, dev-operations `### 17. refactor`, satellite status line, 04 §1.3 if applicable.
6. Run `bun plugins/sp/scripts/validate-commands.ts`, plugin structure tests, `bun run spur-check`.
7. Record `## Solution` via `spur task update`.

### Solution

Implemented 2026-09-17 (H13, pipeline implement state).

- **R1** `plugins/sp/commands/dev-refactor.md` (new, 40 lines): frontmatter `description`, `role: reviewer`, `argument-hint` = operator-accepted surface verbatim, `allowed-tools: ["Bash", "Read", "Edit", "Skill"]`; body H1 (:10), "Wraps the **sp:code-refactoring** skill." (:12), `## Argument Flags` table (:14-24) with defaults `--scope` working tree / `--focus` auto / `--fix` none / `--check` project gate / `--agent` inline / `--auto` off, single glossary link (:26), `## Usage` (:28-30) mirroring the hint, `## Implementation` (:32-35) with inline-default execution-surface link + `Skill(skill="sp:code-refactoring", args="$ARGUMENTS")` (:35). Zero orchestration logic (ADR-032 / design §11.5). Shape follows `dev-simplify.md` (`--check`, `--auto`) and `dev-verify.md` (`--fix`, `--focus`).
- **R2** `flag-glossary.md`: `dev-refactor` added to the `--scope` declaring parenthetical (:178) and `--fix` verify-family wording extended with a refactor-coordinator parenthetical (:258-259); new `### --check <cmd>` entry (:160-165) declaring `dev-simplify` + `dev-refactor` (the flag became shared by two commands, so the design §10 "if shared" condition triggered); `dev-refactor` added to the `--focus` lens enumeration (:167-170). `validate-flag-contracts.ts` exit 0 (74 contract surfaces, was 73).
- **R3** `plugins/sp/references/roles.md:61` — `dev-refactor` added to the reviewer `commands:` list; `roles.test.ts` closure test (every file in `commands/` maps to exactly one role) passes.
- **R4** `plugins/sp/README.md:137` `dev-refactor` command row; :202 `code-refactoring/` skills-tree entry (the skills-table row already landed in 0883 at :320 — not duplicated); `dev-operations.md:89` operation-map row 17 + `### 17. refactor` (:364-371) with purpose, inputs/defaults, backing, behavior, artifacts, and operator taste-gate classes matching the row shape.
- **R5** `docs/design/dev-refactor-command.md:8` status line → built (H13, 0883-0885). `docs/04_DESIGN.md` §1.3 does not enumerate agent commands (no dev-simplify/dev-verify/dev-review entries), so per the "only if it enumerates" condition it was left untouched.
- **Decisions:** (1) `--auto` and `--agent` glossary entries carry no declaring-commands parenthetical (their claims are structural/SSOT-pointing), so no parenthetical edit was needed there — the validator's exact-equality rule governs. (2) `--scope` command-table default written as "working tree" (not design §3's longer "working tree (recent changes)") to keep C2 default parity exact with dev-operations Inputs.
- **Validator evidence:** `validate-commands.ts` -> "40 commands pass all 5 thin-wrapper gates" exit 0; `validate-flag-contracts.ts` -> "All 74 contract surfaces agree" exit 0; `cd plugins/sp && bun test tests/roles.test.ts tests/skill-structure.test.ts` -> 106 tests, 0 fail.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/commands/dev-refactor.md:1-33 (frontmatter :3-5; H1 :7; wrap :9; flag table :11-22; glossary link :24; Usage :26; Implementation :30-33) |
| R2 | MET | plugins/sp/skills/spur-dev/references/flag-glossary.md:167 (--check), :176 (--focus), :186 (--scope), :264-265 (--fix); :38-44/:113-119 (--agent/--auto structural, no parenthetical); validator exit 0 at 74 surfaces |
| R3 | MET | plugins/sp/references/roles.md:61 (reviewer commands list); roles.test.ts closure green (146/146 attested) |
| R4 | MET | plugins/sp/README.md:137 (command row), :203 (skills tree), :321 (skills table, pre-existing from 0883); plugins/sp/skills/spur-dev/references/dev-operations.md:89 (row 17), :360-366 (§17 refactor) |
| R5 | MET | docs/design/dev-refactor-command.md:8 (status: built, H13 0883-0885); docs/04_DESIGN.md:201-211 (§1.3 lacks command-family enumeration → conditional not triggered), :51 (H13 satellite indexed) |
| R6 | MET | Supervisor-attested: validate-commands.ts exit 0 (40 commands), validate-flag-contracts.ts exit 0 (74 surfaces), roles.test.ts + skill-structure.test.ts 146/146, spur-check PASS |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — dev-refactor command passes the wrapper and flag validators | MET | test | validate-commands.ts gates a–e exit 0 (40 commands, 39→40 sanctioned ratchet) + validate-flag-contracts.ts C1/C2 exit 0 (74 surfaces, 73→74 sanctioned ratchet) — supervisor-run |
| R8 — Surface bookkeeping is complete | MET | test | roles.test.ts command-closure ratchet green (146/146) + flag-contract 74-surface validator exit + static cross-check of glossary/roles/README/dev-operations/design-status references above |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:a9317d03c91411e4cca7b60877afcfdbfdab3e3914805b92f783055b9d9a505a |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T20:41:28.460Z todo → done (system)

