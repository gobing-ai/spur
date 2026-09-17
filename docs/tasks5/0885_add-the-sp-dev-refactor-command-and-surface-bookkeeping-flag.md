---
schema_version: 1
name: "Add the /sp:dev-refactor command and surface bookkeeping: flag glossary, roles mapping, README, dev-operations row, and validators green"
status: todo
template: feature-impl
created_at: 2026-09-17T17:49:42.539Z
updated_at: "2026-09-17T17:52:35.777Z"
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

- [ ] R1. `plugins/sp/commands/dev-refactor.md` exists with frontmatter `description`, `role: reviewer`, the accepted `argument-hint`, `allowed-tools: ["Bash", "Read", "Edit", "Skill"]`; body: H1, "Wraps the **sp:code-refactoring** skill.", `## Argument Flags` table (Flag | Description | Default; `--focus` default `auto`, `--fix` default `none`, `--agent` default `inline`, `--check` default "project gate"), one glossary link, `## Usage`, `## Implementation` with the inline-default execution-surface link and `Skill(skill="sp:code-refactoring", args="$ARGUMENTS")`; hint ↔ table parity.
- [ ] R2. `plugins/sp/skills/spur-dev/references/flag-glossary.md` lists `dev-refactor` in the declaring parentheticals of `--auto`, `--focus` (with its lens values), `--fix` (extend "verify-family" wording to include `dev-refactor`), `--scope`, and `--agent`; `--check` gets a glossary entry declaring `dev-simplify` and `dev-refactor` if the validator requires shared flags to be listed, otherwise stays command-local; `bun plugins/sp/scripts/validate-flag-contracts.ts` exits 0.
- [ ] R3. `plugins/sp/references/roles.md` maps `dev-refactor` → `reviewer`; `roles.test.ts` (closed command→role mapping) passes.
- [ ] R4. `plugins/sp/README.md` gains the `dev-refactor` command row and `code-refactoring` skill rows in the skills tree and skills table; `plugins/sp/skills/spur-dev/references/dev-operations.md` gains `### 17. refactor` (purpose, flags, dispatch to `sp:code-refactoring`, artifacts, operator taste gate classes) consistent with the existing row shape.
- [ ] R5. `docs/design/dev-refactor-command.md` status line updated to reflect the built surface; `docs/04_DESIGN.md §1.3` agent command surface mentions `dev-refactor` if that section enumerates commands.
- [ ] R6. `bun plugins/sp/scripts/validate-commands.ts` exits 0, plugin structure tests pass, `bun run spur-check` passes.

### Acceptance Criteria

Covers feature H13 scenarios:

- [ ] R7 — dev-refactor command passes the wrapper and flag validators
- [ ] R8 — Surface bookkeeping is complete

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
