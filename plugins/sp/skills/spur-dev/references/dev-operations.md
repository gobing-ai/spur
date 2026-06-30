---
name: dev-operations
description: Unified reference for all 13 dev-* operations — purpose, inputs, backing (skill/CLI/inline), and behavior contract. The single source of truth for what each `/sp:dev-*` command does. (`implement` is covered as a sub-mode of run, #4; `runall` is the batch operation, #13.)
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
| `Skill()` | Delegates to a backing skill via `Skill(skill="<skill>", args="<op> $ARGUMENTS")`. The skill owns the procedure; the command is a thin entry point. | implement, unit, review, verify, run, refine, plan, brainstorm, runall |
| `inline` | The procedure is defined directly in the command file. No `Skill()` delegation — the command carries its own steps. | changelog, gitmsg, fixall, handover |

The 9 `Skill()` commands back onto three skills: `sp:spur-dev` (planning + execution workflow + batch), `sp:code-verification` (SECUA review + traceability), and `sp:brainstorm` (structured ideation). The `runall` operation (#13) is `sp:spur-dev`'s batch entry — it delegates the driver loop to the `sp:super-coder` agent (the batch orchestrator) per [execution-batch.md](execution-batch.md). `dev-brainstorm` carries the two artifact exits — `--task` (one task) and `--feature` (validated feature with BDD AC; the front-half entry that hands off to `dev-plan`). The 4 `inline` commands cover git tooling and operational utilities that have no natural skill home — creating a skill for each would be scope creep for one-liner procedures.

> **`dev-dogfood`** is not in this table. It is a thin `Skill()` wrapper over the **`sp:dogfood-testing`**
> backbone skill (which owns the 4-phase dogfood protocol, the live ledger, and the report template);
> it does not map to a numbered dev-* operation. See its command file and the backing skill for details.

## Operation map

| # | Operation | Command | Backing | Skill / Verb | Arg-hint |
|---|-----------|---------|---------|--------------|----------|
| 1 | unit | `dev-unit` | `Skill()` | `sp:spur-dev` (`unit`) | `<wbs> [--coverage <pct>] [--agent <name\|auto>]` |
| 2 | review | `dev-review` | `Skill()` | `sp:code-verification` (`review`) | `<wbs> [--agent <name\|auto>] [--focus <lens>] [--fix <none\|blockers-first\|all>] [--auto]` |
| 3 | verify | `dev-verify` | `Skill()` | `sp:code-verification` (`verify`) | `<wbs> [--agent <name\|auto>] [--fix ...] [--focus <lens>] [--bdd] [--auto] [--force]` |
| 4 | run | `dev-run` | `Skill()` | `sp:spur-dev` (`run` / `implement`) | `<wbs> [--mode <full\|implement>] [--agent <name\|auto>] [--auto]` |
| 5 | refine | `dev-refine` | `Skill()` | `sp:spur-dev` (`refine`) | `<wbs> [--focus <mode>] [--description <text>] [--agent <name\|auto>] [--auto] [--next]` |
| 6 | plan | `dev-plan` | `Skill()` | `sp:spur-dev` (`plan`) | `"<description>" [--feature <id>] [--parent <feature-id>] [--agent <name\|auto>] [--design] [--auto]` |
| 7 | docs | *(no thin wrapper)* | `Skill()` | `sp:doc-evolve` | `"<change description>"` |
| 8 | changelog | `dev-changelog` | `inline` | git log + conventional-commit grouping | `[--since <ref>] [--until <ref>] [--version <ver>]` |
| 9 | gitmsg | `dev-gitmsg` | `inline` | per-file diff summary → group → conventional commit | `[--commit] [--squash] [--scope <path>]` |
| 10 | fixall | `dev-fixall` | `inline` | lint + test fix loop | `[--scope <path>]` |
| 11 | handover | `dev-handover` | `inline` | structured doc generation | `"<blocker description>"` |
| 12 | brainstorm | `dev-brainstorm` | `Skill()` | `sp:brainstorm` (`dev-brainstorm`) | `"<topic>" [--depth <basic\|detailed\|comprehensive>] [--options <n>] [--agent <name\|auto>] [--skip-discovery] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]` |
| 13 | runall | `dev-runall` | `Skill()` → agent | `sp:spur-dev` (`runall`) → `sp:super-coder` | `--tasks <selector> [--keep-going] [--auto] [--agent <name\|auto>] [--json]` |

---

## Skill-backed operations

These delegate to a backing skill via `Skill()`. The command file is a thin wrapper; the skill
owns the full procedure. The command's `## Implementation` section contains the `Skill()` call and
must not be changed without updating the backing skill.

### 1. unit

- **Purpose:** Extend or generate tests for a task or file until the coverage target is met with a fully passing suite.
- **Inputs:** `<target>` (required — WBS, task file, source file, or glob). `--coverage <pct>` overrides the default target. `--agent <name|auto>` is an **inline** override: omit (default) to run test generation **in the current session**; `<name>`/`auto` spawns it via `spur agent run` (see cross-cutting.md § "Honor `--agent`").
- **Backing:** `sp:code-testing` competency skill.
- **Behavior:** Detect the project stack → read the implementation → identify untested paths → write targeted tests → measure coverage → iterate until the per-file line/function target (≥90%) is met. The language-agnostic procedure (two workflows, gap categorization, coverage-vs-quality, escalation) and the per-stack adapters are the SSOT in **`sp:code-testing`** (`references/unit-testing.md` + `references/stacks/`). The spine dispatches here; it does not inline the procedure.
- **Delegation:** `Skill(skill="sp:code-testing", args="$ARGUMENTS")`

### 2. review

- **Purpose:** SECUA-framework code review of a task's diff — Security, Efficiency, Correctness, Usability, Architecture.
- **Inputs:** `<wbs>` (required). `--agent <name|auto>` is a **pipeline** override: omit (default) → the review runs under the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `<name>`/`auto` spawns that agent. `--focus <lens>` narrows to one SECUA dimension. `--fix <none|blockers-first|all>` controls auto-fix. `--auto` skips confirmations for review/fix passes.
- **Backing:** `sp:code-verification` skill, `review` mode.
- **Behavior:** Detect the diff scope → run SECUA analysis → rank findings P1–P4 → write findings to the task's `## Review` section. With `--fix`, applies fixes for the selected severity tier.
- **Delegation:** `Skill(skill="sp:code-verification", args="review $ARGUMENTS")`

### 3. verify

- **Purpose:** Requirements traceability — verify a task's implementation against its acceptance criteria, producing a PASS/PARTIAL/FAIL verdict with per-requirement evidence.
- **Inputs:** `<wbs>` (required). `--agent <name|auto>` is a **pipeline** override: omit (default) → the verify pass runs under the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `<name>`/`auto` spawns that agent. `--fix`, `--focus`, `--bdd`, `--auto`, `--force` modulate the verify pass. `--next` (terminal chain link): on the **post-`--fix`** PASS verdict, transition `testing → done` through the FSM (`--strict-core` guard honored). On PARTIAL/FAIL or guard failure, stop as review-pending.
- **Backing:** `sp:code-verification` skill, `verify` mode.
- **Behavior:** Status guard → change-scope detection → requirements traceability → SECUA review → verdict aggregation → findings write-back → verdict-artifact emission → optional `--fix` pass. The verdict gates the pipeline's `done` transition. With `--next`: the (post-`--fix`) PASS verdict → transition to `done` (FSM guard honored); PARTIAL/FAIL → stop and surface verdict.
- **Delegation:** `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

### 4. run

- **Purpose:** Run a task through the execution pipeline (full) or execute a single pipeline step (implement).
- **Inputs:** `<wbs>` (required). `--mode <full|implement>` selects the execution mode. `--agent <name|auto>` is a **pipeline** override: omit (default) → spawned steps use the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `<name>`/`auto` spawns that agent (merged into `vars.agent` for full mode, passed through `$ARGUMENTS` for implement mode). `--auto` skips the HITL approve gate / confirmations and propagates down the `--next` chain. `--next`: advance to the next step — **resolves the mode to `implement`** (even under `--mode full`); on success, transition `todo → wip → testing` through the FSM (guards honored) and invoke `/sp:dev-verify <wbs> --auto --next`. On a guard failure, stop as review-pending (leave status, surface the finding).
- **Backing:** `sp:spur-dev` skill — `run` operation for the full pipeline (the spine drives it); `sp:code-implementation` competency skill for the implement step (the spine dispatches to it).
- **Modes:**
  - **`full`** (default, no `--next`): Drive the full pipeline — precheck → implement → test → review → approve(HITL) → verify → record → done. Invokes `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'` (with `profile: auto` when `--auto`). Monitors the run; on HITL pause surfaces to the operator. When `--next` is present the mode resolves to `implement` instead (full mode runs every stage itself, so there is nothing to advance to — `--next` reinterprets as "run the implement step, then chain").
  - **`implement`** (also the resolved mode when `--next` is set): Execute only the implement step. Read the task's `## Requirements` / `## Design` / `## Plan`, write the code that satisfies them, author the `## Solution` change-map section (file:line + what/why per changed file) via `spur task update <wbs> --section Solution --from-file`. This is the implement step the pipeline calls — it is NOT the pipeline driver. With `--next`: on success, transition `todo → wip → testing` through the FSM (guards honored — no `--no-lifecycle`) + chain to `/sp:dev-verify <wbs> --auto --next`; on a guard failure, stop as review-pending. **Partial-deliverable rule:** if the task ships only part of its requirements (e.g. an R1/R2 split with the rest in a follow-up task), the `## Solution` and `## Review` sections MUST carry a `⚠️ PARTIAL` marker naming the deferred part and the follow-up WBS — see `plugins/sp/commands/dev-run.md` → "Section ownership".
- **Delegation:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")` for full mode; `Skill(skill="sp:code-implementation", args="$ARGUMENTS")` for implement mode.

### 5. refine

- **Purpose:** Refine a task's requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria before execution.
- **Inputs:** `<wbs>` (required). `--focus <mode>` narrows the gap analysis. `--agent <name|auto>` is an **inline** override: omit (default) to run the synthesis **in the current session**; `<name>`/`auto` spawns it via `spur agent run`. `--auto` skips interactive Q&A (synthesis only) and propagates down the `--next` chain. `--next`: advance to the next step — transition `backlog → todo` through the FSM **idempotently** (only when `status == backlog`; a task already at `todo` or past it skips the transition and chains anyway — `status >= todo` ⇒ already advanced) and invoke `/sp:dev-run <wbs> --auto --next` (which resolves to the implement step). On a guard/refine failure, stop as review-pending.
- **Backing:** `sp:spur-dev` skill, `refine` operation.
- **Behavior:** Read the task → elicit missing AC/Design/Plan through targeted Q&A → write each via `spur task update <wbs> --section <name> --from-file`. Done just-in-time, per task, immediately before execution. With `--next`: on success, transition status (idempotently — see Inputs) + chain to dev-run; on failure, stop and surface error.
- **Pre-synthesis skip gate (under `--auto`):** Before invoking synthesis, run `spur task check <wbs> --json`. Filter the findings to the target sections only ({Background, Requirements, Plan}). If there are no L3 findings for any of those sections (regardless of whether the *overall* exit code is 0 — other sections may have findings), emit a structured SKIP result instead of synthesizing:
  ```
  SKIP — sections already meet L3: sections-considered=[Background, Requirements, Plan], reason="no L3 findings for target sections"
  ```
  Under `--json`/machine consumption, emit the same decision as a structured object so a downstream
  (observe-only) driver need not re-run `spur task check` to reconstruct it:
  ```json
  {"result": "SKIP", "sections-considered": ["Background", "Requirements", "Plan"], "reason": "no L3 findings for target sections"}
  ```
  Synthesis is only invoked when a real L3 gap exists in a target section. The SKIP result is the normal outcome for a well-specified task under `--auto`; it is not a failure.
  **Scope:** only L3 findings whose `section` ∈ {Background, Requirements, Plan} count toward the SKIP gate. L3 findings on other sections (e.g. `### Review`) do not block the SKIP — refine does not own those sections.
- **SKIP short-circuits synthesis, not `--next`.** A SKIP means no synthesis was needed — it does **not** cancel the `--next` chain. Under `--auto --next`, a SKIP still flows into the (idempotent) status transition and the chained `/sp:dev-run`. "`refine --auto --next` on a well-specified task" is therefore effectively "run the pipeline"; an operator who wanted refinement only should drop `--next`.
- **Delegation:** `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`

### 6. plan

- **Purpose:** Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create.
- **Inputs:** `"<description>"` (required). `--feature <id>` links to an existing feature. `--parent <feature-id>` nests under a parent. `--agent <name|auto>` is an **inline** override: omit (default) to run the model steps (AC generation, decomposition) **in the current session**; `<name>`/`auto` spawns them via `spur agent run`. `--design`/`--auto` drive the conditional design-doc step (Step 5.5).
- **Backing:** `sp:spur-dev` skill, `plan` operation.
- **Behavior:** Clarify scope → `spur feature create` → author BDD AC → `spur feature check` gate → decompose into task-batch JSON → `spur task batch-create` gate.
- **Delegation:** `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`

### 7. docs

- **Purpose:** Evolve project documentation — update ADR, PRD, ARCHITECTURE, DESIGN, FEATURES docs per the constitution's edit rules.
- **Inputs:** `"<change description>"` (required).
- **Backing:** `sp:doc-evolve` skill — no thin `dev-docs` command wrapper exists (the skill is invoked directly or via the operator).
- **Behavior:** Read the affected doc → apply the constitution's edit rules (single-source-of-truth, cross-reference updates, same-commit sync triggers) → write via the correct tool.
- **Delegation:** `Skill(skill="sp:doc-evolve", args="$ARGUMENTS")` (no thin command wrapper)

### 12. brainstorm

- **Purpose:** Interactive solution design — heuristic discovery interview (grilling) followed by structured ideation with trade-offs and confidence scoring.
- **Inputs:** `"<topic>"` (required). `--depth <basic|detailed|comprehensive>` controls how deep to walk the decision tree. `--options <n>` sets the number of solution approaches (default 3). `--agent <name|auto>` is an **inline** override: omit (default) to run the ideation/research calls **in the current session**; `<name>`/`auto` spawns them via `spur agent run`. `--skip-discovery` skips the grilling interview and goes straight to ideation. `--task [<feature-id>]` and `--feature [<parent-id>]` are the two **artifact exits** (mutually exclusive — see below). `--next` chains the `--feature` exit into `/sp:dev-plan` decomposition.
- **Backing:** `sp:brainstorm` skill, `dev-brainstorm` operation.
- **Behavior:** Two-phase protocol. Phase 1 (inline): walk the decision tree one question at a time, each with a recommended answer, exploring the codebase before asking the user. Phase 2 (delegated): pass the resolved decision tree to `sp:brainstorm` for structured ideation — each approach includes description, trade-offs, implementation notes, confidence level, and decision trace.
- **Artifact exits (mutually exclusive):**
  - `--task [<feature-id>]` — create one `todo` task from the ⭐ approach via `spur task create` (Background/Requirements/Plan seeded from the brainstorm). The fast path for a single unit of work.
  - `--feature [<parent-id>]` — the **front-half entry**: `spur feature create`, then author Goal/Scope/BDD-AC by editing the feature file (no `--section` verb on `feature update`), then loop `spur feature check` to exit 0. Lands a validated feature; hands off to `/sp:dev-plan --feature <ID>` for decomposition. AC scenarios derive from the decision trace per [ac-style-guide.md](ac-style-guide.md).
  - `--next` (with `--feature`) — on a clean `feature check`, auto-invoke `/sp:dev-plan --feature <ID>` so the planning half chains end-to-end like the execution half. Ignored without `--feature`.
  - Passing both `--task` and `--feature` is an error.
- **Delegation:** `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`

### 13. runall

- **Purpose:** Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via `task-pipeline.yaml`, inspect verdicts, apply the failure policy, emit a batch report.
- **Inputs:** `--tasks <selector>` (required — explicit WBS list, status pseudo-list, `feature:<id>`, or `ready`). `--keep-going` skips a failed task's in-batch dependents and continues independents (default halts on first failure). `--auto` sets `profile=auto` on each per-task run (skips the HITL approve gate). `--agent <name|auto>` is a **pipeline** override merged into each per-task `vars.agent` — pins the step executor, not the orchestrator; omit (default) → spawned steps use the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `--json` emits the report as JSON.
- **Backing:** `sp:spur-dev` skill, `runall` operation → delegates the driver loop to the **`sp:super-coder`** agent (the batch orchestrator).
- **Behavior:** The orchestrator reads [execution-batch.md](execution-batch.md) and drives: resolve selector → freeze set → topo-sort by `dependencies[]` (Kahn, WBS-ascending tie-break; cycle aborts) → resolve out-of-set deps by status (done → allow, else → block subtree) → run each task via `spur workflow run task-pipeline.yaml --async` + `spur workflow trace` polling → inspect terminal state + `.spur/run/<wbs>-verdict.json` → stop-the-batch default or `--keep-going` subtree skip → emit batch report. Per-task pipeline is invoked **verbatim** — no new FSM, no step edits. `--auto`/`--agent` are the only flags that cross the orchestrator→pipeline boundary (both into per-task `--vars`).
- **Delegation:** `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` → `sp:super-coder` agent.

---

## Inline operations

These define their procedure directly in the command file. No `Skill()` delegation — the command
is the procedure. The backing is a combination of git CLI, `spur` CLI, and agent reasoning.

### 8. changelog

- **Purpose:** Generate a structured changelog from git commits between two refs.
- **Inputs:** `--since <ref>` (default: last tag), `--until <ref>` (default: `HEAD`), `--version <ver>` (default: auto-detect from latest tag).
- **Backing:** `inline` — git log + conventional-commit grouping.
- **Behavior:**
  1. Resolve `--since`: if not given, use the most recent tag (`git describe --tags --abbrev=0`). If no tags exist, use the repo root commit.
  2. Run `git log --oneline <since>..<until>`.
  3. Parse each commit's conventional-commit prefix (`feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`, `ci`, `build`). Commits without a recognized prefix go under `Other`.
  4. Group commits by type. Within each group, list one bullet per commit: `- <summary> (<short-hash>)`.
  5. Format as markdown:
     - `keepachangelog` (default): `## [<version>] - <date>` header, then `### Added` / `### Fixed` / `### Changed` / `### Removed` / `### Other` sections mapped from conventional-commit types.
     - `simple`: flat bulleted list grouped by type heading (`### feat`, `### fix`, …).
  6. Print the changelog to stdout. If the operator wants it in `CHANGELOG.md`, they redirect or paste.
- **Invariants:** Never mutates `CHANGELOG.md` directly — the command outputs to stdout. The operator decides where it lands.

### 9. gitmsg

- **Purpose:** Generate conventional commit message(s) from staged changes via per-file summarization → concern grouping → one message per group.
- **Inputs:** `--scope <path>` (default: all staged changes) — limits diff analysis to a path. `--commit` — execute the commit (off by default; refuses on a multi-group staging unless `--squash`). `--squash` — collapse all concerns into one combined message and let `--commit` proceed on a mixed staging.
- **Backing:** `inline` — per-file diff summary + concern grouping + conventional commit formatting.
- **Behavior:**
  1. Run `git diff --cached --stat` (add `-- <path>` when `--scope` is given) for the outline. If the diff is empty, report "no staged changes" and stop.
  2. Capture the full diff to a temp file (`TEMP_FILE="/tmp/gitdiff_$(date +%s)"; git diff --cached > "$TEMP_FILE" 2>&1`) so analysis reads from disk, not a giant inline blob.
  3. Read `$TEMP_FILE` and write **one sentence per changed file** — what changed and why, not a line count.
  4. **Group the per-file sentences by concern.** For each group derive its commit type, scope, and message:
     - Type from the dominant change — `feat` (new functionality) · `fix` (bug fix) · `refactor` (restructuring, no behavior change) · `docs` (documentation only) · `chore` (build/config/tooling) · `perf` · `test` · `style`.
     - Scope from the affected module/package (`cli`, `domain`, `server`, `web`, `app`, …); `--scope` overrides.
     - Message:
       ```
       <type>(<scope>): <summary>

       <body — optional bullets from the group's per-file sentences>
       ```
       Summary: imperative mood, ≤72 chars, lowercase first word, no period. Body: only when the change is non-obvious.
  5. **Resolve groups:** one group → emit its message; multiple groups (default) → emit one message per group **plus a split recommendation** (stage per concern, re-run); `--squash` → collapse to one combined message (dominant type/scope, per-file bullets).
  6. Print the resolved message + a copy-paste `git commit -m` line. With `--commit`: execute it for a single group or under `--squash`; on a multi-group staging without `--squash`, **do not commit** — print the split guidance instead (one `git commit` can't honor per-group messages).
  7. `rm "$TEMP_FILE"` once done — no `/tmp` diff residue (the F5 cleanup discipline).
- **Invariants:** Without `--commit`, never runs `git commit` — message only, the operator commits. With `--commit`, only commits when the staging is a single concern OR `--squash` was given — a mixed staging without `--squash` is reported, never silently squashed. Never leave the temp diff file behind.

### 10. fixall

- **Purpose:** Fix all lint, type, and test errors systematically across the working tree.
- **Inputs:** `--scope <path>` (default: entire working tree) — limits fixes to a file or directory.
- **Backing:** `inline` — lint + test fix loop.
- **Behavior:**
  1. Run `bun run format` (add `-- <path>` if `--scope` is given) to settle formatter-only diffs first — `bun run lint` asserts `--error-on-warnings` + typecheck but does **not** rewrite formatting, so a formatter-only change (e.g. a multi-line import reflow) can pass `lint` locally yet still be unformatted. Formatting before linting removes that class of false-green.
  2. Run `bun run lint` (add `-- <path>` if `--scope` is given). Collect all errors.
  3. If lint is clean, skip to step 5.
  4. **Lint fix loop:** for each error, diagnose the root cause and apply the smallest fix. Re-run `bun run lint` after each batch of fixes. Loop until lint is green. If a fix introduces new errors, back it out and try a different approach.
  5. Run `bun run test`. Collect all failures.
  6. If tests are green, done.
  7. **Test fix loop:** for each failure, diagnose (test bug vs implementation bug), apply the fix, re-run the failing test. Loop until all tests pass.
  8. Final verification: run `bun run format && bun run lint && bun run test` once more to confirm formatting is settled and both gates are green simultaneously.
  9. Report: list what was fixed (file + one-line summary per fix). If any error could not be resolved, report it explicitly — do not suppress.
- **Invariants:** Never bypass with `--no-verify`, `--force`, or new `biome-ignore`/`eslint-disable` suppressions. Never skip or `.skip` a test to make the suite green. Fix the root cause, not the symptom. Never claim green on `bun run lint` alone — a formatter-only diff passes `lint` but fails the formatter; run `bun run format` (or assert it produces no diff) before declaring the gate clean.

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
