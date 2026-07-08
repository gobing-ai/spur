---
template: feature-impl
schema_version: 1
name: "bind structured-input tools and centralize up-front questionnaires across dev commands"
description: "Extend the 0229 AskUserQuestion binding pattern to the remaining dev commands that have up-front Q&A, and centralize all clarifying questions into a single questionnaire form so the operator fills one form and the rest runs autonomously."
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-08T23:29:24.940Z"
updated_at: "2026-07-08T23:33:21.448Z"
---

## 0230. bind structured-input tools and centralize up-front questionnaires across dev commands

### Background

Task 0229 introduced the structured-input tool binding pattern: when a command or skill presents a
decision to the operator, it should use `AskUserQuestion` (or the platform equivalent) with the
recommended answer as the pre-selected option and alternatives as the remaining options, rather than
rendering markdown text and expecting a free-form reply. The pattern was applied to
`dev-brainstorm.md`, `brainstorm/SKILL.md`, and `decision-brief.md`.

An evaluation of all 19 `dev-*.md` command files found that 12 have interactive Q&A or human
checkpoint patterns. Of those 12, five have **up-front** Q&A that can be collected before execution
begins: `dev-refine`, `dev-plan`, `dev-idea`, `dev-wrap`, `dev-wrapall`. The remaining seven either
have only post-completion checkpoints (confirming finished work, which cannot be collected in
advance) or simple confirmations during execution that are already handled by `--auto`.

The operator's key requirement: **centralize all clarifying questions into one or more questionnaire
forms presented up front**, so the operator fills out a single form at the start and the remaining
work proceeds autonomously without mid-stream interruption. This applies to the intake Q&A in
`dev-plan`/`dev-idea` (scope, constraints, success criteria) and the branch-cleanup decision in
`dev-wrap`/`dev-wrapall` (merge preference). `dev-refine` already has `--focus` bundles that
pre-collect the refinement domain; the questionnaire pattern enhances it by offering the focus
selection as a structured-input question rather than requiring the operator to know the flag names.

### Requirements

R1. Add `AskUserQuestion` to the `allowed-tools` frontmatter field of `dev-refine.md`, `dev-plan.md`, `dev-idea.md`, `dev-wrap.md`, and `dev-wrapall.md` so the structured-input tool is available to the agent when these commands run on platforms that support it.

R2. Add a "Binding to a structured-input tool" directive paragraph to each of the five command files, following the pattern established in `dev-brainstorm.md:79-85` (task 0229). The directive must be platform-agnostic ("when a structured-input tool is available") and reference the decision-brief SSOT.

R3. For `dev-plan.md` and `dev-idea.md`: add a directive that the intake Q&A (scope, constraints, success criteria per `planning-workflow.md` Step 1) should be collected as a single `AskUserQuestion` call with multiple questions — one per ambiguous dimension — rather than one question at a time across multiple turns. This satisfies the centralized-questionnaire requirement: the operator fills one form, then execution proceeds autonomously.

R4. For `dev-refine.md`: add a directive that the `--focus` mode selection should be presented as a structured-input question (with the six focus values as options and `all` as the recommended default) when the operator has not explicitly passed `--focus` on the command line. The remaining refinement questions (if any) should also be bundled into the same questionnaire call.

R5. For `dev-wrap.md` and `dev-wrapall.md`: add a directive that the `--merge` branch-cleanup decision should be presented as a structured-input question (merge vs. keep-branch, with keep-branch as the safe default) when the operator has not explicitly passed `--merge`. Since branch cleanup is irreversible, the question must be asked even under `--auto` — but it can be asked up front as part of the initial questionnaire rather than mid-stream at the human checkpoint.

R6. Update `decision-brief.md` "Where it is applied" table to add rows for `dev-plan` (intake Q&A), `dev-idea` (intake + design preference), `dev-refine` (focus selection), and `dev-wrap`/`dev-wrapall` (branch-cleanup preference). The `dev-brainstorm` row already exists.

R7. All directives must be additive to existing prose — no structural rewrites of command workflows, no new reference files, no changes to workflow YAML files or skill code. The pattern is documentation-only, binding the structured-input tool at the command surface where the agent reads it.

### Acceptance Criteria

#### AC-1: AskUserQuestion in allowed-tools

- **Given** the five command files (`dev-refine.md`, `dev-plan.md`, `dev-idea.md`, `dev-wrap.md`, `dev-wrapall.md`)
- **When** the frontmatter is read
- **Then** `AskUserQuestion` appears in the `allowed-tools` array of each file

#### AC-2: Binding directive paragraph present

- **Given** the five command files
- **When** the body text is read
- **Then** a "Binding to a structured-input tool" paragraph is present, referencing the decision-brief SSOT and stating the platform-agnostic condition ("when a structured-input tool is available")

#### AC-3: Centralized questionnaire for dev-plan and dev-idea

- **Given** `dev-plan.md` and `dev-idea.md` binding directives
- **When** the directive is read
- **Then** it instructs the agent to collect all intake Q&A (scope, constraints, success criteria) as a single `AskUserQuestion` call with multiple questions — not one-at-a-time across turns — so the operator fills one form up front

#### AC-4: Focus selection as structured input for dev-refine

- **Given** `dev-refine.md` binding directive
- **When** the directive is read
- **Then** it instructs the agent to present the `--focus` mode selection as a structured-input question with the six focus values as options and `all` as recommended, when `--focus` was not explicitly passed

#### AC-5: Branch-cleanup as structured input for dev-wrap and dev-wrapall

- **Given** `dev-wrap.md` and `dev-wrapall.md` binding directives
- **When** the directive is read
- **Then** it instructs the agent to present the `--merge` decision as a structured-input question (merge vs. keep-branch, keep-branch recommended) when `--merge` was not explicitly passed, and that this question is asked even under `--auto` because branch cleanup is irreversible

#### AC-6: decision-brief table updated

- **Given** `decision-brief.md` "Where it is applied" table
- **When** the table is read
- **Then** rows for `dev-plan`, `dev-idea`, `dev-refine`, `dev-wrap`, and `dev-wrapall` are present alongside the existing `dev-brainstorm` row

#### AC-7: No workflow or skill code changes

- **Given** the git diff of the task's commit
- **When** the changed files are listed
- **Then** only `.md` files under `plugins/sp/commands/` and `plugins/sp/skills/spur-dev/references/decision-brief.md` are changed — no YAML, TS, or JS files

### Q&A

**Q1: Why not also bind `AskUserQuestion` for `dev-run`, `dev-runall`, `dev-verify` (post-hoc approval gates)?**

Post-hoc gates fire after work is complete — the operator is approving finished output. You cannot
collect "do you approve this?" up front because the thing being approved does not exist yet. The
questionnaire pattern only helps when the question can be answered before execution begins. These
commands already have `--auto` to skip approval gates; that is the correct mechanism.

**Q2: Why not bind `dev-unit`, `dev-simplify`, `dev-dogfood` (confirmations during execution)?**

These commands have simple confirmations during execution (e.g., "run tests now?", "retry?"). They
are not up-front decisions — they are mid-stream checkpoints that depend on prior results. Moving
them up front would require asking the operator to pre-commit to decisions before seeing the results,
which is worse than the current mid-stream prompt. The `--auto` flag already handles these.

**Q3: Why not create a separate questionnaire reference file?**

The directive is one paragraph per command. Creating a reference file for a single paragraph adds
indirection without value. The decision-brief SSOT already exists and is referenced by the directive.
Keeping simplicity: the pattern is additive text in the command file, not a new file.

**Q4: Should the questionnaire be a single AskUserQuestion call with all questions, or multiple calls?**

A single call with multiple questions (the `questions[]` array in `AskUserQuestion`) is the
centralized form. This is the operator's stated preference: "collect all questions up front via
questionnaire forms so users don't have to monitor execution and respond mid-stream." One call, all
questions, then autonomous execution.

### Design

**Three-layer consistency:** This task extends the 0229 pattern at the **command surface layer**
(`plugins/sp/commands/*.md`). It does not touch the skill layer or the engine layer. The
decision-brief SSOT (`references/decision-brief.md`) gains rows in its application-site table but
no new rules.

**Tradeoff: centralized vs. one-at-a-time.** The 0229 pattern in `dev-brainstorm.md` uses
"one `AskUserQuestion` at a time" for the discovery interview. This task's centralized
questionnaire directive overrides that for `dev-plan` and `dev-idea` intake: all intake questions
go in one call. The reasoning: the discovery interview in brainstorm is exploratory (later questions
depend on earlier answers), while the intake Q&A in planning is structured (scope, constraints,
success criteria are independent dimensions that can all be asked at once).

**Invariants:**
- Platform-agnostic: "when a structured-input tool is available" — no hard dependency on Claude Code.
- Additive only: no existing workflow logic is changed; the directives bind the tool at the surface.
- Irreversible actions still pause: `dev-wrap`/`dev-wrapall` branch-cleanup question is asked even
  under `--auto`, but it moves from a mid-stream human checkpoint to an up-front questionnaire item.

**Impacted surfaces:**
- `plugins/sp/commands/dev-refine.md` — frontmatter + 1 paragraph
- `plugins/sp/commands/dev-plan.md` — frontmatter + 1 paragraph
- `plugins/sp/commands/dev-idea.md` — frontmatter + 1 paragraph
- `plugins/sp/commands/dev-wrap.md` — frontmatter + 1 paragraph
- `plugins/sp/commands/dev-wrapall.md` — frontmatter + 1 paragraph
- `plugins/sp/skills/spur-dev/references/decision-brief.md` — table rows

### Plan

- [ ] P1: Add `AskUserQuestion` to `allowed-tools` in `dev-refine.md` frontmatter
- [ ] P2: Add `AskUserQuestion` to `allowed-tools` in `dev-plan.md` frontmatter
- [ ] P3: Add `AskUserQuestion` to `allowed-tools` in `dev-idea.md` frontmatter
- [ ] P4: Add `AskUserQuestion` to `allowed-tools` in `dev-wrap.md` frontmatter
- [ ] P5: Add `AskUserQuestion` to `allowed-tools` in `dev-wrapall.md` frontmatter
- [ ] P6: Add binding directive paragraph to `dev-refine.md` (focus selection as structured input)
- [ ] P7: Add binding directive paragraph to `dev-plan.md` (centralized intake questionnaire)
- [ ] P8: Add binding directive paragraph to `dev-idea.md` (centralized intake questionnaire)
- [ ] P9: Add binding directive paragraph to `dev-wrap.md` (branch-cleanup as structured input)
- [ ] P10: Add binding directive paragraph to `dev-wrapall.md` (branch-cleanup as structured input)
- [ ] P11: Add five rows to `decision-brief.md` "Where it is applied" table
- [ ] P12: Run `spur task check 0230 --strict` to verify task file quality
- [ ] P13: Run lint gate (`biome check . --error-on-warnings && bun run typecheck`)
- [ ] P14: Run test gate (`bun test --reporter=dots ./apps/cli ./apps/server ./apps/web ./packages ./plugins`)
- [ ] P15: Commit with conventional commit message

### Solution

Added `AskUserQuestion` to `allowed-tools` and a **Structured input binding** directive paragraph in 5 `dev-*.md` command files, plus 5 new table rows in `decision-brief.md`.

**Files changed (6):**

1. `plugins/sp/commands/dev-refine.md:4` — `allowed-tools` gains `AskUserQuestion`; `:70` adds binding directive under Step 3 (Question): focus-bundle selection and multi-option clarifications presented via a single `AskUserQuestion` call with multiple questions (one per focus dimension). Scored choices from the decision brief become `options[]`.
2. `plugins/sp/commands/dev-plan.md:4` — `allowed-tools` gains `AskUserQuestion`; `:70-72` adds binding directive: intake questionnaire (scope, constraints, success, design) collected as a single multi-question call. Independent dimensions presented simultaneously for autonomous handoff.
3. `plugins/sp/commands/dev-idea.md:4` — `allowed-tools` gains `AskUserQuestion`; `:56-58` adds binding directive: intake questionnaire (idea scope, target feature, design preference, success) collected as a single multi-question call. Independent dimensions presented simultaneously.
4. `plugins/sp/commands/dev-wrap.md:4` — `allowed-tools` gains `AskUserQuestion`; `:52-54` adds binding directive: branch-cleanup confirmation (merge strategy, target branch, cleanup scope) presented via single call — asked even under `--auto` (irreversible).
5. `plugins/sp/commands/dev-wrapall.md:4` — `allowed-tools` gains `AskUserQuestion`; `:61-63` adds binding directive: batch branch-cleanup confirmation (merge strategy, target, scope, feature transition) presented via single call — asked even under `--auto` (irreversible).
6. `plugins/sp/skills/spur-dev/references/decision-brief.md:75-79` — 5 new rows in "Where it is applied" table documenting the structured-input rendering for `dev-plan` intake, `dev-idea` intake, `dev-wrap` branch cleanup, `dev-wrapall` batch branch cleanup, and `dev-refine` focus selection.


- **Centralized questionnaire for independent dimensions**: `dev-plan` and `dev-idea` intake use a single `AskUserQuestion` call with multiple questions because scope, constraints, success, and design preference are independent axes — presenting them simultaneously lets the operator answer all at once and enables autonomous handoff to the planning skill.
- **One-at-a-time retained for exploratory flows**: `dev-brainstorm` discovery interview (already addressed in task 0229) stays one-at-a-time because later questions depend on earlier answers — that is the nature of exploratory discovery.
- **Irreversible gates always ask**: `dev-wrap` and `dev-wrapall` branch-cleanup confirmation is presented even under `--auto` because branch operations are irreversible. The structured-input form collects all parameters (merge strategy, target branch, cleanup scope) up front.
- **Fallback path**: Every binding directive includes "Fall back to sequential prompts only when the tool is unavailable" — the directives are additive and platform-agnostic.
- **No code changes**: Only `.md` files under `plugins/sp/commands/` and `plugins/sp/skills/spur-dev/references/` were modified. No YAML, TS, or JS files touched.

Coverage: N/A (documentation-only change, no executable code modified)
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- H1
- Task 0229: `docs/tasks2/0229_bind-structured-input-tool-calls-in-dev-brainstorm-and-brain.md`
- 0229 pattern source: `plugins/sp/commands/dev-brainstorm.md:79-85`
- Decision-brief SSOT: `plugins/sp/skills/spur-dev/references/decision-brief.md`
- Planning workflow intake: `plugins/sp/skills/spur-dev/references/planning-workflow.md` Step 1
- Evaluated commands: `dev-refine.md`, `dev-plan.md`, `dev-idea.md`, `dev-wrap.md`, `dev-wrapall.md`
- Commands not enhanced (post-hoc gates): `dev-run.md`, `dev-runall.md`, `dev-verify.md`, `dev-unit.md`, `dev-simplify.md`, `dev-dogfood.md`
- Commands not enhanced (no Q&A): `dev-arch.md`, `dev-fixall.md`, `dev-handover.md`, `dev-gitmsg.md`, `dev-changelog.md`, `dev-parallel.md`, `dev-review.md`

### History
- 2026-07-08T23:30:57.260Z todo → wip (system)
- 2026-07-08T23:33:21.081Z wip → testing (system)
- 2026-07-08T23:33:21.448Z testing → done (system)
