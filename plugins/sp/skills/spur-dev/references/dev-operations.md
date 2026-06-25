---
name: dev-operations
description: Unified reference for all 12 dev-* operations — purpose, inputs, backing (skill/CLI/inline), and behavior contract. The single source of truth for what each `/sp:dev-*` command does. (`implement` is covered as a sub-mode of run, #4.)
see_also:
  - spur-dev
---

# Dev Operations

Every `sp:dev-*` command maps to exactly one **operation** defined here. This is the authoritative
reference: if an operation is not in this file, no command should delegate to it. The operation
table is the index; the per-operation sections below are the detail.

## Two backing patterns

| Pattern | Meaning | Commands |
|---------|---------|----------|
| `Skill()` | Delegates to a backing skill via `Skill(skill="<skill>", args="<op> $ARGUMENTS")`. The skill owns the procedure; the command is a thin entry point. | implement, unit, review, verify, run, refine, plan |
| `inline` | The procedure is defined directly in the command file. No `Skill()` delegation — the command carries its own steps. | changelog, gitmsg, fixall, handover, new-task |

The 7 `Skill()` commands back onto two skills: `sp:spur-dev` (planning + execution workflow) and
`sp:code-verification` (SECU review + traceability). The 5 `inline` commands cover git tooling and
operational utilities that have no natural skill home — creating a skill for each would be scope
creep for one-liner procedures.

> **`dev-dogfood`** is not in this table. It is a sanctioned fat-file exception that carries its full
> 4-phase protocol inline and does not map to a dev-* operation. See its command file for details.

## Operation map

| # | Operation | Command | Backing | Skill / Verb | Arg-hint |
|---|-----------|---------|---------|--------------|----------|
| 1 | unit | `dev-unit` | `Skill()` | `sp:spur-dev` (`unit`) | `<wbs> [--coverage <pct>]` |
| 2 | review | `dev-review` | `Skill()` | `sp:code-verification` (`review`) | `<wbs> [--focus <lens>] [--fix <none\|blockers-first\|all>]` |
| 3 | verify | `dev-verify` | `Skill()` | `sp:code-verification` (`verify`) | `<wbs> [--fix ...] [--focus <lens>] [--bdd] [--auto] [--force]` |
| 4 | run | `dev-run` | `Skill()` | `sp:spur-dev` (`run` / `implement`) | `<wbs> [--mode <full\|implement>] [--auto]` |
| 5 | refine | `dev-refine` | `Skill()` | `sp:spur-dev` (`refine`) | `<wbs>` |
| 6 | plan | `dev-plan` | `Skill()` | `sp:spur-dev` (`plan`) | `"<description>" [--feature <id>] [--parent <feature-id>]` |
| 7 | docs | *(no thin wrapper)* | `Skill()` | `sp:doc-evolve` | `"<change description>"` |
| 8 | changelog | `dev-changelog` | `inline` | git log + conventional-commit grouping | `[--from <ref>] [--to <ref>] [--format <style>]` |
| 9 | gitmsg | `dev-gitmsg` | `inline` | git diff + conventional commit | `[--commit] [--scope <path>]` |
| 10 | fixall | `dev-fixall` | `inline` | lint + test fix loop | `[--scope <path>]` |
| 11 | handover | `dev-handover` | `inline` | structured doc generation | `"<blocker description>"` |
| 12 | new-task | `dev-new-task` | `inline` | `spur task create` + intake | `"<description>" [--feature <id>] [--template <variant>] [--parent <wbs>]` |

---

## Skill-backed operations

These delegate to a backing skill via `Skill()`. The command file is a thin wrapper; the skill
owns the full procedure. The command's `## Implementation` section contains the `Skill()` call and
must not be changed without updating the backing skill.

### 1. unit

- **Purpose:** Extend or generate tests for a task until the coverage target is met.
- **Inputs:** `<wbs>` (required). `--coverage <pct>` overrides the default target.
- **Backing:** `sp:spur-dev` skill, `unit` operation.
- **Behavior:** Read the task's implementation → identify untested paths → write targeted tests → run `bun test --coverage` → iterate until the per-file line/function coverage target (≥90%) is met.
- **Delegation:** `Skill(skill="sp:spur-dev", args="unit $ARGUMENTS")`

### 2. review

- **Purpose:** SECU-framework code review of a task's diff — Security, Efficiency, Correctness, Usability.
- **Inputs:** `<wbs>` (required). `--focus <lens>` narrows to one SECU dimension. `--fix <none|blockers-first|all>` controls auto-fix.
- **Backing:** `sp:code-verification` skill, `review` mode.
- **Behavior:** Detect the diff scope → run SECU analysis → rank findings P1–P4 → write findings to the task's `## Review` section. With `--fix`, applies fixes for the selected severity tier.
- **Delegation:** `Skill(skill="sp:code-verification", args="review $ARGUMENTS")`

### 3. verify

- **Purpose:** Requirements traceability — verify a task's implementation against its acceptance criteria, producing a PASS/PARTIAL/FAIL verdict with per-requirement evidence.
- **Inputs:** `<wbs>` (required). `--fix`, `--focus`, `--bdd`, `--auto`, `--force` modulate the verify pass. `--next`: on PASS verdict, auto-transition `testing → done` (terminal — no further command in chain). On PARTIAL/FAIL, stop.
- **Backing:** `sp:code-verification` skill, `verify` mode.
- **Behavior:** Status guard → change-scope detection → requirements traceability → SECU review → verdict aggregation → findings write-back → verdict-artifact emission → optional `--fix` pass. The verdict gates the pipeline's `done` transition. With `--next`: PASS → transition to `done`; PARTIAL/FAIL → stop and surface verdict.
- **Delegation:** `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

### 4. run

- **Purpose:** Run a task through the execution pipeline (full) or execute a single pipeline step (implement).
- **Inputs:** `<wbs>` (required). `--mode <full|implement>` selects the execution mode. `--auto` skips the HITL approve gate / confirmations. `--next`: on success, auto-transition to `testing` and invoke `/sp:dev-verify <wbs> --next --auto` (implement mode only — ignored in full mode).
- **Backing:** `sp:spur-dev` skill — `run` operation for full pipeline, `implement` operation for the implement step.
- **Modes:**
  - **`full`** (default): Drive the full pipeline — precheck → implement → test → review → approve(HITL) → verify → record → done. Invokes `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'` (with `profile: auto` when `--auto`). Monitors the run; on HITL pause surfaces to the operator. `--next` is a no-op in this mode.
  - **`implement`**: Execute only the implement step. Read the task's `## Requirements` / `## Design` / `## Plan`, write the code that satisfies them, author the `## Solution` change-map section (file:line + what/why per changed file) via `spur task update <wbs> --section Solution --from-file`. This is the implement step the pipeline calls — it is NOT the pipeline driver. With `--next`: on success, transition to `testing` + chain to dev-verify; on failure, stop.
- **Delegation:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")` for full mode; `Skill(skill="sp:spur-dev", args="implement $ARGUMENTS")` for implement mode.

### 5. refine

- **Purpose:** Refine a task's requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria before execution.
- **Inputs:** `<wbs>` (required). `--next`: on success, auto-transition `backlog → todo` and invoke `/sp:dev-run --mode implement <wbs> --next --auto`.
- **Backing:** `sp:spur-dev` skill, `refine` operation.
- **Behavior:** Read the task → elicit missing AC/Design/Plan through targeted Q&A → write each via `spur task update <wbs> --section <name> --from-file`. Done just-in-time, per task, immediately before execution. With `--next`: on success, transition status + chain to dev-run; on failure, stop and surface error.
- **Delegation:** `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`

### 6. plan

- **Purpose:** Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create.
- **Inputs:** `"<description>"` (required). `--feature <id>` links to an existing feature. `--parent <feature-id>` nests under a parent.
- **Backing:** `sp:spur-dev` skill, `plan` operation.
- **Behavior:** Clarify scope → `spur feature create` → author BDD AC → `spur feature check` gate → decompose into task-batch JSON → `spur task batch-create` gate.
- **Delegation:** `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`

### 7. docs

- **Purpose:** Evolve project documentation — update ADR, PRD, ARCHITECTURE, DESIGN, FEATURES docs per the constitution's edit rules.
- **Inputs:** `"<change description>"` (required).
- **Backing:** `sp:doc-evolve` skill — no thin `dev-docs` command wrapper exists (the skill is invoked directly or via the operator).
- **Behavior:** Read the affected doc → apply the constitution's edit rules (single-source-of-truth, cross-reference updates, same-commit sync triggers) → write via the correct tool.
- **Delegation:** `Skill(skill="sp:doc-evolve", args="$ARGUMENTS")` (no thin command wrapper)

---

## Inline operations

These define their procedure directly in the command file. No `Skill()` delegation — the command
is the procedure. The backing is a combination of git CLI, `spur` CLI, and agent reasoning.

### 8. changelog

- **Purpose:** Generate a structured changelog from git commits between two refs.
- **Inputs:** `--from <ref>` (default: last tag), `--to <ref>` (default: `HEAD`), `--format <style>` (default: `keepachangelog`).
- **Backing:** `inline` — git log + conventional-commit grouping.
- **Behavior:**
  1. Resolve `--from`: if not given, use the most recent tag (`git describe --tags --abbrev=0`). If no tags exist, use the repo root commit.
  2. Run `git log --oneline <from>..<to>` (apply `--scope` if given to limit to a path: `git log --oneline <from>..<to> -- <path>`).
  3. Parse each commit's conventional-commit prefix (`feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`, `ci`, `build`). Commits without a recognized prefix go under `Other`.
  4. Group commits by type. Within each group, list one bullet per commit: `- <summary> (<short-hash>)`.
  5. Format as markdown:
     - `keepachangelog` (default): `## [<version>] - <date>` header, then `### Added` / `### Fixed` / `### Changed` / `### Removed` / `### Other` sections mapped from conventional-commit types.
     - `simple`: flat bulleted list grouped by type heading (`### feat`, `### fix`, …).
  6. Print the changelog to stdout. If the operator wants it in `CHANGELOG.md`, they redirect or paste.
- **Invariants:** Never mutates `CHANGELOG.md` directly — the command outputs to stdout. The operator decides where it lands.

### 9. gitmsg

- **Purpose:** Generate a conventional commit message from staged changes.
- **Inputs:** `--scope <path>` (default: all staged changes) — limits diff analysis to a path.
- **Backing:** `inline` — git diff + conventional commit formatting.
- **Behavior:**
  1. Run `git diff --cached` (add `-- <path>` when `--scope` is given). If the diff is empty, report "no staged changes" and stop.
  2. Analyze the diff: identify changed files, the nature of changes (new feature, bug fix, refactor, docs, chore, etc.), and the primary scope.
  3. Determine the commit type from the dominant change:
     - New functionality → `feat`
     - Bug fix → `fix`
     - Code restructuring without behavior change → `refactor`
     - Documentation only → `docs`
     - Build/config/tooling → `chore`
     - Performance improvement → `perf`
     - Test additions/changes → `test`
  4. Determine the scope from the affected module/package (e.g. `cli`, `domain`, `server`, `web`, `app`). If `--scope` was given, use that.
  5. Generate the message:
     ```
     <type>(<scope>): <summary>

     <body — optional, only if the change is non-trivial>
     ```
     - Summary: imperative mood, ≤72 chars, lowercase first word, no period.
     - Body (optional): bullet list of key changes, wrapped at 72 chars. Only include when the diff is non-obvious.
  6. Print the message to stdout. The operator copies it into `git commit -m`.
- **Invariants:** Never runs `git commit` — the command generates the message only. The operator commits.

### 10. fixall

- **Purpose:** Fix all lint, type, and test errors systematically across the working tree.
- **Inputs:** `--scope <path>` (default: entire working tree) — limits fixes to a file or directory.
- **Backing:** `inline` — lint + test fix loop.
- **Behavior:**
  1. Run `bun run lint` (add `-- <path>` if `--scope` is given). Collect all errors.
  2. If lint is clean, skip to step 4.
  3. **Lint fix loop:** for each error, diagnose the root cause and apply the smallest fix. Re-run `bun run lint` after each batch of fixes. Loop until lint is green. If a fix introduces new errors, back it out and try a different approach.
  4. Run `bun run test`. Collect all failures.
  5. If tests are green, done.
  6. **Test fix loop:** for each failure, diagnose (test bug vs implementation bug), apply the fix, re-run the failing test. Loop until all tests pass.
  7. Final verification: run `bun run lint && bun run test` once more to confirm both are green simultaneously.
  8. Report: list what was fixed (file + one-line summary per fix). If any error could not be resolved, report it explicitly — do not suppress.
- **Invariants:** Never bypass with `--no-verify`, `--force`, or new `biome-ignore`/`eslint-disable` suppressions. Never skip or `.skip` a test to make the suite green. Fix the root cause, not the symptom.

### 11. handover

- **Purpose:** Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps.
- **Inputs:** `"<blocker description>"` (required, positional) — what is blocking progress.
- **Backing:** `inline` — structured doc generation from task context.
- **Behavior:**
  1. Identify the current task context: read the active task file (if any) via `spur task list --status wip --json` to find the WIP task. If a WBS was given as part of the blocker or is otherwise known, use it; otherwise work from the current conversation.
  2. Gather context:
     - **Goal:** what the task is trying to accomplish (from the task's `## Background` / `## Requirements`).
     - **Progress:** what has been done so far (from the task's `## Solution`, `## Testing`, `## Review` sections, and the current conversation).
     - **Blocker:** the `"<blocker description>"` argument — what is stuck and why.
     - **Rejected approaches:** what was tried and why it didn't work (from the conversation + any prior handover).
     - **Next steps:** concrete actions the next agent should take.
  3. Format as a markdown document:
     ```markdown
     # Handover — <task WBS / title>

     ## Goal
     <one-sentence goal>

     ## Progress
     - <what was done>

     ## Blocker
     <blocker description>

     ## Rejected Approaches
     - <approach> — <why it failed>

     ## Next Steps
     1. <concrete action>
     ```
  4. Write the document:
     - If a task context exists, write to the task's `## Notes` section via `spur task update <wbs> --section Notes --from-file <path>`.
     - Otherwise, write to `docs/handover/<YYYY-MM-DD>-<slug>.md` (create `docs/handover/` if absent).
  5. Print the path to the handover document.
- **Invariants:** The handover is honest — rejected approaches are recorded so the next agent doesn't retry them. The blocker is specific, not "it doesn't work."

### 12. new-task

- **Purpose:** Create a single task file from a description via intake Q&A and `spur task create`.
- **Inputs:** `"<description>"` (required, positional). `--feature <id>` links the task to a feature. `--template <variant>` selects the task template (`default`, `feature-impl`, `issue`, `review`, `meta`). `--parent <wbs>` creates a sub-task.
- **Backing:** `inline` — `spur task create` + intake Q&A.
- **Behavior:**
  1. **Intake:** clarify the task scope with the operator:
     - What is the task trying to accomplish? (Refine the description if vague.)
     - Which feature does it belong to? (Use `--feature` if given; ask if not.)
     - What template variant fits? (Use `--template` if given; default to `feature-impl` when `--feature` is set, `default` otherwise.)
     - Is this a sub-task? (Use `--parent` if given; ask if the description implies nesting.)
  2. **Create:** run `spur task create "<title>" --feature <id> --template <variant> --parent <wbs> --json` (omit `--feature`/`--parent` if not applicable).
  3. **Report:** print the new task's WBS and file path.
  4. For batch task creation from a decomposed feature, direct the operator to `dev-plan` instead — this command creates one task at a time.
- **Invariants:** Always goes through `spur task create` — never writes a task file directly. The CLI validates the frontmatter and section structure before writing.
