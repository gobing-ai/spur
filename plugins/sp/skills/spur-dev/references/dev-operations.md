---
name: dev-operations
description: Unified reference for all 17+ dev-* operations — purpose, inputs, backing (skill/CLI/inline), and behavior contract. The single source of truth for what each `/sp:dev-*` command does. (`implement` is covered as a sub-mode of run, #4; `runall` is the batch execution operation, #13; `refineall` is the batch refine operation, #5a.)
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
| `Skill()` | Delegates to a backing skill via `Skill(skill="<skill>", args="<op> $ARGUMENTS")`. The skill owns the procedure; the command is a thin entry point. | implement, unit, review, verify, verifyall, run, refine, refineall, plan, brainstorm, runall, parallel, wrap, wrapall, idea |
| `inline` | The procedure is defined directly in the command file. No `Skill()` delegation — the command carries its own steps. | changelog, gitmsg, fixall, handover |

The `Skill()` commands back onto six skills: `sp:spur-dev` (planning + execution workflow + batch),
`sp:code-implementation` (single implement step), `sp:code-testing` (unit/coverage work),
`sp:code-verification` (SECUA review + traceability), `sp:parallel-execution` (fan-out / parallel batch),
and `sp:brainstorm` (structured ideation). The `runall` operation (#13) is `sp:spur-dev`'s batch entry — it delegates the driver loop to the
`sp:super-planner` agent (the batch orchestrator) per [execution-batch.md](execution-batch.md).
`dev-parallel` (#13a) is the parallel counterpart. `dev-brainstorm` carries the two artifact exits — `--task` (one task) and `--feature` (validated
feature with BDD AC; the front-half entry that hands off to `dev-plan`). The 4 `inline` commands
cover git tooling and operational utilities that have no natural skill home — creating a skill for
each would be scope creep for one-liner procedures.

> **`dev-dogfood`** is not in this table. It is a thin `Skill()` wrapper over the **`sp:dogfood-testing`**
> backbone skill (which owns the 4-phase dogfood protocol, the live ledger, and the report template);
> it does not map to a numbered dev-* operation. See its command file and the backing skill for details.

> **`dev-findissue`** is not in this table. It is a thin `Skill()` wrapper over **`sp:issue-finding`**
> (session-log forensics → optional CLI-gated fix task). Hygiene / post-batch analysis — not a spine
> pipeline stage. See `plugins/sp/commands/dev-findissue.md` and
> `plugins/sp/skills/issue-finding/SKILL.md`. After a slow `/sp:dev-runall`, prefer
> `/sp:dev-findissue [<topic>]` before re-running the batch.

> **`dev-next`** is likewise not a numbered spine operation. It is a thin `Skill()` wrapper over the
> **`sp:next-router`** skill — a status→command *meta-router* that dispatches into the operations
> above (refine/run/verify/unit/wrap/…) via TABLE A/B/C; it never implements an operation itself.
> See `plugins/sp/skills/next-router/references/routing-table.md` for the routing SSOT.
>
> **Batch consumer (task 0279):** `sp:super-planner` / `/sp:dev-runall` **consumes** TABLE A STOP rows
> for preflight + one-shot recovery (`plugins/sp/scripts/batch-preflight.ts`) but keeps
> `task-pipeline.yaml` as the happy path. Do **not** deep-merge batch orchestration into a loop of
> `/sp:dev-next`. Single-task "what's next?" stays `/sp:dev-next`; multi-task execution stays
> `/sp:dev-runall` → super-planner.

## Operation map

| # | Operation | Command | Backing | Skill / Verb | Arg-hint |
| --- | ----------- | --------- | --------- | -------------- | ---------- |
| 1 | unit | `dev-unit` | `Skill()` | `sp:code-testing` | `<target> [--coverage <pct>] [--agent <name\|auto>] [--auto]` |
| 2 | review | `dev-review` | `Skill()` | `sp:code-verification` (`review`) + `sp:functional-review` + `sp:code-improvement` | `[<wbs\|path>] [--agent <name\|auto>] [--focus <dims>] [--fix (deprecated)]` |
| 3 | verify | `dev-verify` | `Skill()` | `sp:code-verification` (`verify`) | `<wbs> [--agent <name\|auto>] [--fix <none\|blockers-first\|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--skip-shippable]` |
| 3a | verifyall | `dev-verifyall` | `Skill()` → agent | `sp:spur-dev` (`verifyall`) | `--tasks <selector> [--feature <id>] [--agent <name\|auto>] [--fix <none\|blockers-first\|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]` |
| 4 | run | `dev-run` | `Skill()` | `sp:spur-dev` (`run` / `implement`) | `<wbs> [--mode <full\|implement>] [--agent <name\|auto>] [--auto] [--next] [--wrap] [--continue]` |
| 5 | refine | `dev-refine` | `Skill()` | `sp:spur-dev` (`refine`) | `<wbs> [--focus <mode>] [--description <text>] [--agent <name\|auto>] [--auto] [--next]` |
| 5a | refineall | `dev-refineall` | `Skill()` | `sp:spur-dev` (`refineall`) | `--feature <id> \| --tasks <selector> [--focus <mode>] [--description <text>] [--agent <name\|auto>] [--auto] [--keep-going] [--status <s>] [--json]` |
| 6 | plan | `dev-plan` | `Skill()` | `sp:spur-dev` (`plan`) | `"<description>" [--feature <id>] [--parent <feature-id>] [--agent <name\|auto>] [--skip-design] [--auto] [--approve-taste]` |
| 7 | docs | *(no thin wrapper)* | `Skill()` | `sp:doc-evolve` | `"<change description>"` |
| 8 | changelog | `dev-changelog` | `inline` | git log + conventional-commit grouping | `[--since <ref>] [--until <ref>] [--version <ver>]` |
| 9 | gitmsg | `dev-gitmsg` | `inline` | per-file diff summary → group → conventional commit | `[--commit] [--squash] [--scope <path>]` |
| 10 | fixall | `dev-fixall` | `inline` | lint + test fix loop | `[<validation-command>] [--max-retry <n>] [--scope <path>]` |
| 11 | handover | `dev-handover` | `inline` | structured doc generation | `"<blocker description>"` |
| 12 | brainstorm | `dev-brainstorm` | `Skill()` | `sp:brainstorm` (`dev-brainstorm`) | `<topic> [--depth <basic\|detailed\|comprehensive>] [--options <n>] [--agent <name\|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]` |
| 13 | runall | `dev-runall` | `Skill()` → agent | `sp:spur-dev` (`runall`) → `sp:super-planner` | `--tasks <selector> [--feature <id>] [--mode <sequential\|parallel>] [--keep-going] [--auto] [--agent <name\|auto>] [--json] [--wrap] [--next] [--continue]` |
| 13a | parallel | `dev-parallel` | `Skill()` | `sp:parallel-execution` | `--tasks <selector> [--feature <id>] [--mode <fan-out\|review-panel\|investigation>] [--agent <name\|auto>] [--json]` |
| 14 | wrap | `dev-wrap` | `Skill()` | `spur workflow run` (wrapup-pipeline) | `<wbs> [--auto] [--merge] [--dry-run]` |
| 15 | wrapall | `dev-wrapall` | `Skill()` | `spur workflow run` (wrapup-pipeline) | `[--since <iso>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]` |
| 16 | idea | `dev-idea` | `Skill()` | `spur workflow run` (idea-pipeline) | `"<idea>" [--auto] [--skip-design] [--approve-taste]` |

## Flag glossary

Every flag shared by two or more commands has exactly one entry here. This is the single place a
shared flag's meaning is stated; command argument-hints and table rows cite it and must not
re-define it. The shared-flag set is derived mechanically from the 28 command argument-hints (a flag
counts as shared when it appears in two or more); flags appearing on a single command stay documented
in that command's body and are not listed here.

**Reference form (mechanically detectable).** A command file points at a glossary entry with a
markdown link whose link target is the entry's anchor — `[`--next`](#flag-next)`. The anchor is
always `#flag-<name>` where `<name>` is the flag minus its leading `--` (so `--keep-going` →
`#flag-keep-going`). The test gate (`command-flag-parity.test.ts`, task 0403) finds these references
with the regex `` \[`--<flag>`\]\(#flag- `` over each command file — **a shared flag declared without
this reference fails the build.** Prose-only citations (the flag name mentioned in a sentence but not
in the link form) do not count; the reference must be the link.

**Availability rule.** Two flags are only declared where the underlying capability already exists:
`--json` where the command already produces a structured result a script could consume; `--auto`
where the command already has at least one HITL gate. The rule forces a declaration only where the
capability exists — a command that would benefit from `--json` but produces only prose is recorded
as a follow-up, not quietly left inconsistent. `--agent` is out of scope here and handled separately
(feature H9).

### `--next` — chain-to-completion with propagation

**Anchor:** `#flag-next`.

On success, hand the task back to `sp:next-router`, which resolves the next dispatch and re-invokes
with `--next` still set, until the work is done or a gate stops it. The flag is a **chain
to completion**, not a single step, a mode selector, or a status transition. `/sp:dev-next` (the
command) runs the next step **once**; `--next` (the flag) makes any command it is passed to **keep
going**. Neither is renamed.

**Redefinition (breaking).** Before this entry (feature H8, task 0399, 2026-07-31) `--next` carried
four incompatible meanings across seven commands: chain-ish (`dev-verify`, `dev-verifyall`), a
mode selector (`dev-run` → implement-only), a deprecated no-op (`dev-review`), and undeclared
declarations never explained (`dev-refine`, `dev-refineall`, `dev-brainstorm`). Task 0401 reconciled
all seven against this single definition. Existing `dev-run --next` invocations selecting
implement-only mode are the only genuinely breaking case; the replacement is `--mode implement`.

### `--json` — emit machine-readable output

**Anchor:** `#flag-json`.

Emit the command's result as structured JSON a script can consume, instead of the human-readable
default. Only declared where the command already produces a structured result; declaring it never
implies building a new output shape.

### `--auto` — skip objective HITL confirmations

**Anchor:** `#flag-auto`.

Skip objective HITL confirmations inside this command (feature-check, batch-create, the approve
gate). Taste gates and irreversible HITL gates (e.g. `--merge`) still pause even under `--auto`.
Only declared where the command already has at least one HITL gate the flag can skip.

### `--keep-going` — batch failure policy: skip dependents, continue independents

**Anchor:** `#flag-keep-going`.

Batch operation only (`dev-runall`, `dev-refineall`, `dev-verifyall`). When a task in the batch
fails, skip its in-batch dependents and continue the independent ones, instead of the default
halt-on-first-failure. Never silently retried; the failure is still reported.

### `--continue` — resume an interrupted batch from checkpoint

**Anchor:** `#flag-continue`.

Resume a batch (`dev-runall`) or task (`dev-run`) that was interrupted mid-run, picking up from the
recorded checkpoint rather than restarting. Orthogonal to `--next` (lifecycle chaining) and
`--keep-going` (failure policy): the three axes address different problems and `routing-table.md`
offers `--continue` and `--next` as competing options only when the batch was interrupted mid-run.

### `--wrap` — run the wrap hop after the main step

**Anchor:** `#flag-wrap`.

After the main step completes, run the wrap hop (learnings, metrics, doc-sync). On `dev-runall`
with `--next`, wrap runs **once for the batch** after every task reaches terminal status, mirroring
the batch-once shippable gate `dev-verifyall` uses. Without `--next`, `--wrap` is wrap-without-
chaining — the single task or batch wraps without advancing the lifecycle.

### `--force` — bypass a named guard

**Anchor:** `#flag-force`.

Bypass a specific named guard that would otherwise stop the command (e.g. a shippable check on
`dev-verify`/`dev-verifyall`). Named, not global: the command documentation states which guard is
forced. Never bypasses lifecycle status transitions or irreversible HITL gates.

### `--feature <id>` — scope the operation to a feature

**Anchor:** `#flag-feature`.

Scope the operation to all tasks under a feature id (`^[A-Z][1-9]*$`). On feature-advancing
commands (`dev-wrapall`) it also advances the feature through legal lifecycle edges with guards
honored.

### `--focus <dims>` — constrain the operation to specific dimensions

**Anchor:** `#flag-focus`.

Constrain the operation to a named subset of dimensions — review dimensions on `dev-review`/
`dev-verify`/`dev-verifyall` (`all|stack|dependencies|data|flows|api|security|quality|performance`),
or a refine focus mode on `dev-refine`/`dev-refineall`. Narrowing reduces token cost; omitting runs
all dimensions.

### `--scope <path>` — limit the operation to a path

**Anchor:** `#flag-scope`.

Limit the operation to a file or directory path. Used by inline operations (`dev-fixall`,
`dev-gitmsg`) and review operations to bound the working set.

### `--dry-run` — print the plan without executing

**Anchor:** `#flag-dry-run`.

Resolve and print what the command would do, without dispatching or mutating state. The plan output
is the contract; divergence between `--dry-run` and the real run is a bug.

### `--tasks <selector>` — explicit task selector for a batch

**Anchor:** `#flag-tasks`.

Batch operation only (`dev-runall`, `dev-verifyall`, `dev-parallel`). An explicit selector — WBS
list, status pseudo-list (`todo`, `wip`), `feature:<id>`, or `ready` — resolving to the set the
batch runs over. Required on `dev-runall` and `dev-parallel`; optional alternative to `--feature`
on `dev-verifyall`.

### `--mode <kind>` — select an execution mode

**Anchor:** `#flag-mode`.

Select an execution mode: `full|implement` on `dev-run` (full pipeline vs implement-only),
`sequential|parallel` on `dev-runall` (serial vs fanned-out-independent-subset),
`fan-out|review-panel|investigation` on `dev-parallel`. Mode selection is explicit and orthogonal
to `--next`.

### `--task [<feature-id>]` — seed a task from the current result

**Anchor:** `#flag-task`.

Seed a new task from the current command's result (`dev-brainstorm`'s chosen approach). The task
lands at `todo` ready for `dev-refine`. Optional feature id scopes it.

### `--since <ref>` — lower bound on a range

**Anchor:** `#flag-since`.

Lower bound on a range: a git ref on `dev-changelog`, or an ISO date on `dev-wrapall` (filters done
tasks by `updated_at >= date`).

### `--fix <policy>` — remediation policy

**Anchor:** `#flag-fix`.

Remediation policy on verify-family commands (`dev-verify`, `dev-verifyall`):
`none|blockers-first|all`. `none` reports findings without fixing; `blockers-first` fixes only P1/P2;
`all` fixes everything found. Deprecated on `dev-review` (routes to `dev-verify --fix`).

### `--until <ref>` — upper bound on a range

**Anchor:** `#flag-until`.

Upper bound on a git-log range (`dev-changelog`); defaults to `HEAD`.

### `--status <s>` — filter by task status

**Anchor:** `#flag-status`.

Filter the operation by task status (`dev-wrapall` default `done`; `dev-refineall` to target a
specific status slice).

### `--skip-shippable` — skip the shippable check

**Anchor:** `#flag-skip-shippable`.

Skip the shippable guard on verify-family commands (`dev-verify`, `dev-verifyall`). Used when
verifying a task whose artifact is intentionally not yet shippable (e.g. a doc-only task).

### `--skip-design` — omit the design package

**Anchor:** `#flag-skip-design`.

Omit the design package (system-design satellite + task `### Design`) on planning commands
(`dev-plan`, `dev-idea`). The task is created without the design section; refine supplies it later.

### `--output <path>` — write the result to a path

**Anchor:** `#flag-output`.

Write the command's result to a file path (`dev-changelog`, `dev-daily`) instead of stdout.

### `--merge` — trigger branch cleanup

**Anchor:** `#flag-merge`.

Trigger branch cleanup after wrap (`dev-wrap`, `dev-wrapall`). Irreversible HITL gate — always
pauses, even under `--auto`.

### `--max-retry <n>` — bound the retry loop

**Anchor:** `#flag-max-retry`.

Bound the retry loop on fix-family commands (`dev-fixall`, `dev-dogfood`). After `n` consecutive
failed fix attempts, stop and ask the operator rather than looping indefinitely.

### `--full` — rewrite a `--next` run as full pipeline

**Anchor:** `#flag-full`.

`dev-next` only: rewrite a `dev-run … --next` primary dispatch into `dev-run <wbs> --mode full`
(without `--next`). No effect on non-run routes (warning W-FULL).

### `--description <text>` — supply a description

**Anchor:** `#flag-description`.

Supply a description (`dev-refine`/`dev-refineall` focus description, `dev-idea` idea text). Used
when the operator wants to inject a specific framing rather than derive it from context.

### `--bdd` — use BDD scenarios as the verification lens

**Anchor:** `#flag-bdd`.

Use the task's Gherkin scenarios as the verification lens on verify-family commands (`dev-verify`,
`dev-verifyall`).

### `--approve-taste` — pre-clear all taste gates this run

**Anchor:** `#flag-approve-taste`.

Planning commands (`dev-idea`, `dev-plan`): with `--auto`, skip all remaining taste pauses this
run (idea-eval + design-approval). Sets `idea_approved=true` and `design_approved=true`. One CLI
flag sets both.

---

## `--next` chain contract

The canonical definition lives in the glossary above; this section states the chain's stop
conditions, hop bound, and reporting contract that every declaring command and the router inherit.
These are derived from the per-row `Stop / notes` column in
[routing-table.md](../../next-router/references/routing-table.md), not invented here.

**Chain owner.** `sp:next-router` is the single owner of chain progression. Given a task and
`--next`, it resolves the next dispatch, invokes it with `--next` propagated, and repeats. The chain
does **not** live in the command files — per-command "what comes after me" logic would duplicate the
routing table seven or more times. Commands reference the glossary entry and the router; they do not
describe successors.

**Stop conditions.** A chain running under `--next` halts, cleanly, when any of these is true. Each
is named so the operator can tell **which step halted the chain and why**:

| Halt cause | Who reports it | Report shape |
|---|---|---|
| A failing gate (lint/type/test/rule) | The step that hit it | "chain halted at `<step>` — `<gate>` failed: `<one-line cause>`" |
| A non-PASS verdict (PARTIAL/FAIL) | The verify step | "chain halted at `dev-verify <wbs>` — verdict `<VERDICT>`; see `.spur/run/<wbs>-verdict.json`" |
| A HITL pause (taste gate, irreversible gate, multi-candidate fork) | The step that paused | "chain halted at `<step>` — HITL pause (`<which>`); resume after operator input" |
| Unmet dependencies | `dev-refine`/`dev-run` precheck or router A2 | "chain halted at `<step>` — unmet deps: `<WBS list>`" |
| Terminal status (`done`, `cancelled`) | The router | "chain complete — task `<wbs>` is `<status>`" (distinct from a halt) |

A chain that stops at a gate is a **normal outcome, not an error**: it reports where and why and
exits cleanly. It is distinct from a chain that stops because the task is complete — the report
wording makes the two unambiguous (one says "halted at", the other says "complete").

**Hop bound.** A single `--next` chain performs at most **8 primary hops** (router invocations). A
routing cycle, or a task whose status never converges on terminal, would otherwise loop forever.
When the bound is hit the chain stops and reports: "chain halted — hop bound (8) reached at
`<step>` without reaching terminal status; this indicates a routing cycle, not completion." The
bound is sized for the longest legitimate chain (refine → run → verify → wrap is four hops; the
extra four absorb probe short-circuits like `dev-fixall`/`dev-unit`) and is a rule the router agent
follows and reports against, not a counter in code (the router is a prompt skill, not executable).

**Flag vs command disambiguation.** `/sp:dev-next` runs the next step **once** and stops;
`--next` makes any command it is passed to **keep going** until the work is done or a gate stops
it. The two compose: `/sp:dev-next <wbs> --next` is valid but redundant (the flag makes the single
dispatch keep going, which is what re-running `/sp:dev-next` without `--next` would do one hop at
a time). Neither is renamed.

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

- **Purpose:** Multi-dimensional code review of a task or path — (1) functional requirements traceability (WBS mode only), (2) SECUA framework (Security, Efficiency, Correctness, Usability, Architecture), (3) architecture depth.
- **Modes:**
  - **WBS mode (`<wbs>`)**: Runs functional requirements traceability (`sp:functional-review`), SECUA framework (`sp:code-verification`), and architectural depth (`sp:code-improvement`). May write findings to the task's `## Review` section.
  - **Path mode (`<path>`)**: Runs advisory SECUA framework (`sp:code-verification`) and architectural depth (`sp:code-improvement`). Performs no task mutation.
- **Inputs:** `<wbs|path>` (required). `--agent <name|auto>` is a **pipeline** override: omit (default) → the review runs under the configured default executor (`omp`). `<name>`/`auto` spawns that agent. `--focus <lens>` narrows to one SECUA dimension. Note: `--fix` and `--next` are **deprecated** (no-op with warning; route remediation to `/sp:dev-verify --fix` and progression to `/sp:dev-next`).
- **Backing:** `sp:functional-review`, `sp:code-verification` (review mode), `sp:code-improvement`.
- **Behavior:** WBS mode runs functional traceability + SECUA + architecture depth, ranking findings P1–P4 and writing findings to the task's `## Review` section. Path mode runs advisory SECUA + architecture depth with no task mutation.
- **Delegation:** WBS mode: `sp:functional-review` + `sp:code-verification` (review) + `sp:code-improvement`; Path mode: `sp:code-verification` (review) + `sp:code-improvement`.

### 3. verify

- **Purpose:** Requirements traceability — verify a task's implementation against its acceptance criteria, producing a PASS/PARTIAL/FAIL verdict with per-requirement evidence. Optionally (with `--fix all`) evaluate **feature shippable readiness**.
- **Inputs:** `<wbs>` (required). `--agent <name|auto>` is a **pipeline** override: omit (default) → the verify pass runs under the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `<name>`/`auto` spawns that agent. `--fix`, `--focus`, `--bdd`, `--auto`, `--force` modulate the verify pass. `--next` (terminal chain link): on the **post-`--fix`** PASS verdict, transition `testing → done` through the FSM (`--strict-core` guard honored). On PARTIAL/FAIL or guard failure, stop as review-pending. **`--skip-shippable`** (alias `--skip-shipable`): disable the shippable gate that otherwise runs under `--fix all` when the task has a `feature_id`.
- **Backing:** `sp:code-verification` skill, `verify` mode.
- **Behavior:** Status guard → change-scope detection → requirements traceability → SECUA review → verdict aggregation → findings write-back → verdict-artifact emission → optional `--fix` pass → **shippable readiness** (when active). The per-task verdict gates the pipeline's `done` transition. With `--next`: the (post-`--fix`) PASS verdict → transition to `done` (FSM guard honored); PARTIAL/FAIL → stop and surface verdict. Shippable FAIL does not rewrite the task verdict line but must be printed; feature is not “ready.”
- **Shippable readiness (default on with `--fix all`):** After the task verdict, if `--fix all` and the task has `feature_id` and not `--skip-shippable`, run `spur feature check <id> --json` + linked-task completeness. Emit `Shippable: PASS|FAIL|N/A`. FAIL when feature AC scenarios are orphaned/unverified or any linked task is not `done`/`cancelled`. SSOT procedure: `sp:code-verification` Step 13.
- **Delegation:** `Skill(skill="sp:code-verification", args="verify $ARGUMENTS")`

### 3a. verifyall

- **Purpose:** Batch verification of a set of tasks (or all tasks under a feature) against their requirements and AC. Produces per-task verdicts + a summary report with aggregate statistics (counts, table, overall batch verdict). With `--fix all`, also evaluates **feature shippable readiness** once for the set.
- **Inputs:** `--tasks <selector>` (required unless `--feature`). `--feature <id>` (convenience for `--tasks feature:<id>`). Shared verify flags from `dev-verify` (`--agent`, `--fix`, `--focus`, `--bdd`, `--auto`, `--force`, **`--skip-shippable`**). `--next` (per-task lifecycle chaining: on a PASS verdict transition `testing → done` through the FSM with `--strict-core` honored; PARTIAL/FAIL does not transition; transitions run **before** the shippable gate so `spur feature check` sees final statuses). `--json` for machine-readable summary report.
- **Backing:** `sp:spur-dev` skill, `verifyall` operation (resolves the set using the shared selector grammar, dispatches per-task verify via `sp:code-verification` verify mode, writes per-task artifacts, aggregates and emits the batch summary report, then optional shippable gate).
- **Behavior:** Resolve + freeze the set (supports `--feature` sugar). For each task: apply status guard, requirements traceability + AC + SECUA review, write `## Testing` + verdict.json (per-task fix pass under `--fix`). After the batch: **shippable gate once** when active (see below). Emit a structured summary report (markdown or `--json`). Per-task behavior matches single `dev-verify` (except shippable is batch-once). **Batch verdict rollup is deterministic** — computed by `spur task verifyall-aggregate --from-file <batch-input.json> --json` (a tested service module, not agent discretion). **Per-task outcome grammar:** `PASS` / `PARTIAL` / `FAIL` for implemented tasks; `NOT-STARTED` for tasks that have not entered implementation (status `backlog`/`todo`/`blocked` — reachable only via `--force`). **Rollup rule:** all-NOT-STARTED → `UNKNOWN`; any `FAIL` → `FAIL`; any `PARTIAL` or `UNKNOWN` → `PARTIAL`; all `PASS` → `PASS`. NOT-STARTED rows are *excluded* from the FAIL/PARTIAL rollup (they cannot manufacture a batch failure) but are *reported explicitly* in the summary ("N NOT-STARTED, excluded from rollup"). This closes the 0341 dogfood gap where a healthy feature with 5 PASS + 2 unstarted tasks read as FAIL. **Shippable FAIL:** treat the batch as not clean — force rollup to at least **PARTIAL** and set `"shippable": false` under `--json` even if every task outcome is PASS.
- **Shippable readiness (default on with `--fix all`):** Active when `--fix all` and feature context exists (`--feature` or unique shared `feature_id`) and not `--skip-shippable`. Procedure: `sp:code-verification` Step 13 once after all per-task legs. Without `--fix all`, do not run the hard gate (optional note: use `--fix all` for ship evaluation).
- **Cache discipline (batch):** freeze the `spur task list --feature <id> --json` (or selector) capture once at resolve; reuse that snapshot for every per-task verify leg. Do not re-list the set mid-batch. Re-read a task body only when that task's sections changed (e.g. after a `--fix` write). Prefer re-reading only cited `file:line` anchors over re-tokenizing full Solution sections when prior Testing is already present.
- **Dogfood / mutation composition:** prefer step-split when dogfooding verifyall with `--fix all` and/or `--next` — first observe-only verifyall, then a separate fix pass, then `--next` only if status transitions are still needed. See `sp:dogfood-testing` §step-splitting.
- **Delegation:** `Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS")`

### 4. run

- **Purpose:** Run a task through the execution pipeline (full) or execute a single pipeline step (implement).
- **Inputs:** `<wbs>` (required). `--mode <full|implement>` selects the execution mode. `--agent <name|auto>` is a **pipeline** override: omit (default) → spawned steps use the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `<name>`/`auto` spawns that agent (merged into `vars.agent` for full mode, passed through `$ARGUMENTS` for implement mode). `--auto` skips the HITL approve gate / confirmations and propagates down the `--next` chain. `--next`: advance to the next step — **resolves the mode to `implement`** (even under `--mode full`); on success, transition `todo → wip → testing` through the FSM (guards honored) and invoke `/sp:dev-verify <wbs> --auto --next`. On a guard failure, stop as review-pending (leave status, surface the finding).
- **Backing:** `sp:spur-dev` skill — `run` operation for the full pipeline (the spine drives it); `sp:code-implementation` competency skill for the implement step (the spine dispatches to it).
- **Modes:**
  - **`full`** (default, no `--next`): Drive the full pipeline — precheck → implement → test → review → approve(HITL) → verify → record → done. Invokes `spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'` (with `profile: auto` when `--auto`). Monitors the run; on HITL pause surfaces to the operator. When `--next` is present the mode resolves to `implement` instead (full mode runs every stage itself, so there is nothing to advance to — `--next` reinterprets as "run the implement step, then chain").
  - **`implement`** (also the resolved mode when `--next` is set): Execute only the implement step. Read the task's `## Requirements` / `## Design` / `## Plan`, write the code that satisfies them, author the `## Solution` change-map section (file:line + what/why per changed file) via `spur task update <wbs> --section Solution --from-file`. This is the implement step the pipeline calls — it is NOT the pipeline driver. With `--next`: on success, transition `todo → wip → testing` through the FSM (guards honored — no `--no-lifecycle`) + chain to `/sp:dev-verify <wbs> --auto --next`; on a guard failure, stop as review-pending. **Partial-deliverable rule:** if the task ships only part of its requirements (e.g. an R1/R2 split with the rest in a follow-up task), the `## Solution` and `## Review` sections MUST carry a `⚠️ PARTIAL` marker naming the deferred part and the follow-up WBS — see `plugins/sp/commands/dev-run.md` → "Section ownership".
- **Delegation:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")` for full mode; `Skill(skill="sp:code-implementation", args="$ARGUMENTS")` for implement mode.

### 5. refine

- **Purpose:** Refine a task's requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria before execution.
- **Inputs:** `<wbs>` (required). `--focus <mode>` narrows the gap analysis. `--agent <name|auto>` is an **inline** override: omit (default) to run the synthesis **in the current session**; `<name>`/`auto` spawns it via `spur agent run`. `--auto` skips interactive Q&A (synthesis only) and propagates down the `--next` chain. `--next`: advance to the next step — transition `backlog → todo` through the FSM **idempotently** (only when `status == backlog`; a task already at `todo` or past it skips the transition and chains anyway — `status >= todo` ⇒ already advanced) and invoke `/sp:dev-run <wbs> --auto --next` (which resolves to the implement step). On a guard/refine failure, stop as review-pending.
- **Backing:** `sp:spur-dev` skill, `refine` operation. Q&A clarifications are presented as decision briefs per [decision-brief.md](decision-brief.md).
- **Behavior:** Read the task → elicit missing AC/Design/Plan through targeted Q&A → write each via `spur task update <wbs> --section <name> --from-file`. Done just-in-time, per task, immediately before execution. With `--next`: on success, transition status (idempotently — see Inputs) + chain to dev-run; on failure, stop and surface error.
- **Pre-synthesis skip gate (under `--auto`):** Before invoking synthesis, run `spur task check <wbs> --json`. Filter the findings to the **refine target sections** only:
  `{Background, Requirements, Acceptance Criteria, Design, Plan}`.
  These are the anti-drift surfaces: constraints + planning that cheaper implementers must follow.
  **Solution is not a refine target** (as-built change-map owned by implement). If there are no L3
  findings for any of those sections (regardless of whether the *overall* exit code is 0 — other
  sections may have findings), emit a structured SKIP result instead of synthesizing:

  ```
  SKIP — sections already meet L3: sections-considered=[Background, Requirements, Acceptance Criteria, Design, Plan], reason="no L3 findings for target sections" (N L4 advisory: <labels>)
  ```

  The `(N L4 advisory: <labels>)` suffix is emitted whenever `spur task check` returned ≥1 L4
  finding — list each L4 finding's one-line label, comma-separated. Omit the suffix when there
  are zero L4 findings. L4 advisories do not block the SKIP; the suffix is informational only.
  Under `--json`/machine consumption, emit the same decision as a structured object so a downstream
  (observe-only) driver need not re-run `spur task check` to reconstruct it:

  ```json
  {"result": "SKIP", "sections-considered": ["Background", "Requirements", "Acceptance Criteria", "Design", "Plan"], "reason": "no L3 findings for target sections", "l4Advisories": [{"message": "Missing feature_id — ..."}]}
  ```

  Synthesis is only invoked when a real L3 gap exists in a target section. The SKIP result is the normal outcome for a well-specified task under `--auto`; it is not a failure.
  **Scope:** only L3 findings whose `section` ∈ {Background, Requirements, Acceptance Criteria, Design, Plan} count toward the SKIP gate. L3 findings on other sections (e.g. `### Review`, `### Solution`) do not block the SKIP — refine does not own those sections.
  **Variant note:** for templates that omit Design or AC (e.g. `review`, `meta`, `issue`), only apply the target sections that the section-matrix allows at the current status (`spur task check` `requiredSections` / optional list).
- **SKIP short-circuits synthesis, not `--next`.** A SKIP means no synthesis was needed — it does **not** cancel the `--next` chain. Under `--auto --next`, a SKIP still flows into the (idempotent) status transition and the chained `/sp:dev-run`. "`refine --auto --next` on a well-specified task" is therefore effectively "run the pipeline"; an operator who wanted refinement only should drop `--next`.
- **Delegation:** `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`

### 5a. refineall

- **Purpose:** Batch-refine a set of tasks (or all refine-eligible tasks under a feature) — resolve a set, topo-sort by dependencies, run per-task `refine`, emit a summary report. Planning-half counterpart of `verifyall` / `runall` for the just-in-time spec-completion gate.
- **Inputs:**
  - `--feature <id>` **or** `--tasks <selector>` (required — at least one). `--feature` is sugar for `--tasks feature:<id>` (shared selector grammar: explicit WBS list, `feature:<id>`, `ready`, status pseudo-list — [execution-batch.md](execution-batch.md) Step 1). If both are present, `--tasks` wins (one-line note in the report).
  - Shared refine flags (passed through to each per-task refine): `--focus <mode>`, `--description <text>`, `--agent <name|auto>`, `--auto`, `--next`.
  - Batch-only flags: `--keep-going` (continue independents after a failure; default halt), `--status <s>` (filter resolved membership; default **`backlog,todo`** — planning-side fill candidates), `--json` (machine-readable batch report).
- **Backing:** `sp:spur-dev` skill, `refineall` operation (orchestrates; per-task body is the single-task `refine` operation — never a second refine implementation).
- **Behavior:**
  1. Resolve + **freeze** the set at kickoff (never re-query membership mid-batch).
  2. Apply `--status` filter (default `backlog,todo`). Tasks already `done`/`cancelled`/`testing` are excluded unless the operator widens `--status`. Report each exclusion with reason.
  3. Topo-sort by `dependencies[]` (Kahn, WBS-ascending tie-break). Cycle → abort entire batch before any refine. Out-of-set deps: `done` → allow; else → block subtree (same as runall).
  4. For each WBS in order: invoke single-task refine with shared flags. Under `--auto`, the per-task **pre-synthesis SKIP gate** still applies (no L3 gap in Background/Requirements/Acceptance Criteria/Design/Plan → SKIP, not failure).
  5. Failure policy: **stop-the-batch** (default) or `--keep-going` (skip in-batch dependents of a failed refine; continue independents).
  6. Emit a batch report (markdown or `--json`).
- **Per-task outcome vocabulary:** `refined` (synthesis wrote sections) | `SKIP` (already L3-clean under `--auto`) | `failed` | `skipped` (dep failed under `--keep-going`) | `not-attempted` (halted) | `blocked` (unmet out-of-set dep).
- **Batch verdict:** `clean` (all attempted tasks `refined` or `SKIP`) | `halted` (a failure stopped the batch) | `aborted` (cycle / unknown selector / empty set after filter).
- **`--next` warning:** Passing `--next` chains **each** successful refine into `/sp:dev-run <wbs> --auto --next`, which can balloon into full pipeline execution for every task. Prefer refineall without `--next`, then `/sp:dev-runall --feature <id>` for execution. Document the risk in the batch report header when `--next` is set.
- **`--auto` recommendation:** Batch refine without `--auto` requires per-task interactive Q&A and does not scale. Default operator path: `/sp:dev-refineall --feature <id> --auto`.
- **Delegation:** `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS")` → per task `Skill(skill="sp:spur-dev", args="refine <wbs> $SHARED_FLAGS")`.

### 6. plan

- **Purpose:** Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (with **Design by default**).
- **Inputs:** `"<description>"` (required). `--feature <id>` links to an existing feature. `--parent <feature-id>` nests under a parent. `--agent <name|auto>` is an **inline** override: omit (default) to run the model steps (AC generation, decomposition) **in the current session**; `<name>`/`auto` spawns them via `spur agent run`. **Design package flags (unified with `/sp:dev-idea`):**
  - **Default:** author task `design` on every batch item + feature satellite when the seam heuristic fires (**ties lean design**). There is **no** `--design` force flag.
  - `--skip-design` — skip feature satellite **and** omit task `design` fields (scaffold only; refine fills later). Sole design opt-out.
  - `--approve-taste` — with `--auto`, pre-clear design-approval taste pause when that gate is used (`design_approved=true`). Alias: `--design-approved`.
- **Backing:** `sp:spur-dev` skill, `plan` operation. Stage `plan` floors at `capable-2` (fallback `capable-3`).
- **Behavior:** Clarify scope → `spur feature create` → author BDD AC → `spur feature check` gate → decompose into task-batch JSON **including `design` (unless `--skip-design`)** → `spur task batch-create` gate. Design package details: [planning-workflow.md](planning-workflow.md) Step 5.5.
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
  - `--feature [<parent-id>]` — the **front-half entry**: `spur feature create`, then author Goal/Scope/BDD-AC by editing the feature file (no `--section` verb on `feature update`), then loop `spur feature check` to exit 0. Lands a validated feature; hands off to `/sp:dev-plan --feature <ID>` for decomposition. AC scenarios derive from the decision trace per [ac-style-guide.md](ac-style-guide.md#decision-trace--ac-scenario-mapping).
  - `--next` (with `--feature`) — on a clean `feature check`, auto-invoke `/sp:dev-plan --feature <ID>` so the planning half chains end-to-end like the execution half. Ignored without `--feature`.
  - Passing both `--task` and `--feature` is an error.
- **`--task` exit seeding:** create via `spur task create "<approach-name>" --feature <id> --template feature-impl` (omit `--feature` when no feature-id is given). The task is seeded with:
  - **Background** ← the brainstorm Overview + the chosen approach's Description + decision-trace context
  - **Requirements** ← the approach's Implementation Notes, converted to R-item checkboxes
  - **Plan** ← the brainstorm's Next Steps, converted to an ordered checklist

  Report the new task WBS and file path; the task lands at `todo`, ready for `/sp:dev-refine`.
- **Delegation:** `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`

### 13. runall

- **Purpose:** Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via `task-pipeline.yaml`, inspect verdicts, apply the failure policy, emit a batch report.
- **Inputs:** `--tasks <selector>` (required — explicit WBS list, status pseudo-list, `feature:<id>`, or `ready`). `--mode <sequential|parallel>` (default `sequential`; `parallel` fans out a proven-independent subset per `execution-batch.md` § Parallel Execution). `--keep-going` skips a failed task's in-batch dependents and continues independents (default halts on first failure). `--auto` sets `profile=auto` on each per-task run (skips the HITL approve gate). `--agent <name|auto>` is a **pipeline** override merged into each per-task `vars.agent` — pins the step executor, not the orchestrator; omit (default) → spawned steps use the configured default executor (`omp`); current-agent is **not expressible** (subprocess FSM). `--json` emits the report as JSON. `--wrap` triggers `wrapup-pipeline.yaml` after the batch completes. `--continue` resumes an interrupted batch from the latest checkpoint in `.spur/memory/sessions/`. **No `--next`** — runall drives the complete pipeline per task, so every step `--next` could chain to is already inside it; the asymmetry with `dev-run` is deliberate (see R4 rationale below).
- **Three orthogonal axes (do not confuse):** `--keep-going` = batch failure policy (halt vs skip dependents); `--continue` = resume from checkpoint (pick up an interrupted batch); `--next` = per-task lifecycle chaining (advance status on a verdict — `dev-verify`/`dev-verifyall` only). `routing-table.md` offers `--continue` and `--next` as competing options for the same situation only when the batch was interrupted mid-run; otherwise they address different problems.
- **Backing:** `sp:spur-dev` skill, `runall` operation → delegates the driver loop to the **`sp:super-planner`** agent (the batch orchestrator).
- **Behavior:** The orchestrator reads [execution-batch.md](execution-batch.md) and drives: resolve selector → freeze set → topo-sort by `dependencies[]` (Kahn, WBS-ascending tie-break; cycle aborts) → resolve out-of-set deps by status (done → allow, else → block subtree) → run each task via `spur workflow run task-pipeline.yaml --async` + `spur workflow trace` polling → inspect terminal state + `.spur/run/<wbs>-verdict.json` → stop-the-batch default or `--keep-going` subtree skip → emit batch report. Per-task pipeline is invoked **verbatim** — no new FSM, no step edits. `--auto`/`--agent` are the only flags that cross the orchestrator→pipeline boundary (both into per-task `--vars`).
- **Delegation:** `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` → `sp:super-planner` agent.

### 14. wrap

- **Purpose:** Wrap up a single completed task — capture learnings, record metrics, sync docs, and optionally advance the feature / clean up the branch.
- **Inputs:** `<wbs>` (required, positional). `--auto` skips objective confirmations (the branch-cleanup HITL gate still pauses — irreversible). `--merge` triggers branch cleanup (irreversible HITL gate).
- **Backing:** `spur workflow run .spur/workflows/wrapup-pipeline.yaml` — direct workflow invocation (no backing skill; the pipeline IS the procedure).
- **Behavior:** Builds `--vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto","merge":"true|false"}'` and invokes the wrapup pipeline. The pipeline runs: task-resolve → doc-sync → learning-capture → metrics-record → (feature-transition) → (branch-cleanup) → done. Task statuses are NOT mutated. Branch cleanup is an irreversible HITL gate that always pauses, even under `--auto`.
- **Vars string typing:** `tasks` is a JSON-encoded **string**, not a JSON array — `spur workflow run --vars` accepts only string values (`--vars values must be strings`); the pipeline's guards parse the string with `jq length`. `jq -nc` guarantees the shape:

  ```bash
  VARS=$(jq -nc --arg tasks "[\"$WBS\"]" --arg profile "$PROFILE" --arg merge "$MERGE" \
    '{tasks:$tasks, profile:$profile, merge:$merge}')
  spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars "$VARS"
  ```

- **Delegation:** Direct `spur workflow run .spur/workflows/wrapup-pipeline.yaml` (no `Skill()` call — the command builds the vars JSON and invokes the workflow directly via `Bash`).

### 15. wrapall

- **Purpose:** Wrap up a batch of completed tasks — capture learnings, record metrics, sync docs, advance a feature through legal lifecycle edges, and optionally clean up branches.
- **Inputs:** `--since <iso-date>` filters done tasks by frontmatter `updated_at >= date` (v1 approximation). `--feature <id>` selects all tasks under a feature AND advances the feature through legal lifecycle edges (`backlog → active → verifying → done`, guards honored). `--status <s>` (default: `done`) filters by task status. `--auto` skips objective confirmations. `--merge` triggers branch cleanup (irreversible HITL gate).
- **Backing:** `spur workflow run .spur/workflows/wrapup-pipeline.yaml` — direct workflow invocation.
- **Behavior:** Resolves the task list via `spur task list --json` (filtered by `--feature`, `--since`, `--status`), builds `--vars '{"tasks":"[...]","feature":"<id>","profile":"interactive|auto","merge":"true|false"}'`, and invokes the wrapup pipeline. The pipeline runs the same states as `wrap` but with the full task list and optional feature transition. Task statuses are NOT mutated. Feature transitions go through `spur feature update` so lifecycle guards apply. Branch cleanup is an irreversible HITL gate.
- **Vars string typing:** `tasks` is a JSON-encoded **string**, not a JSON array — `--vars` values must be strings (the CLI rejects raw arrays); `jq -nc` passes the array text through as a string value:

  ```bash
  VARS=$(jq -nc --arg tasks "$TASKS" --arg feature "$FEATURE" --arg profile "$PROFILE" --arg merge "$MERGE" \
    '{tasks:$tasks, feature:$feature, profile:$profile, merge:$merge}')
  spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars "$VARS"
  ```

- **Delegation:** Direct `spur workflow run .spur/workflows/wrapup-pipeline.yaml` (no `Skill()` call — the command resolves tasks and invokes the workflow directly via `Bash`).

### 16. idea

- **Purpose:** Turn a vague idea into a feature with AC and a decomposed task batch — the unified entry point for the planning half.
- **Inputs:** `"<idea>"` (required, positional, quoted). Three everyday axes:
  - `--auto` — skip **objective** HITL (feature-check, batch-create); taste gates still pause.
  - `--skip-design` — design package off (system-design + task Design).
  - `--approve-taste` — with `--auto`, skip **all** remaining taste pauses this run (idea-eval + design-approval). Sets `idea_approved=true` and `design_approved=true`.
  Aliases (prefer `--approve-taste`): `--idea-approved` → `idea_approved`; `--design-approved` → `design_approved`. There is **no** `--design` force flag.
- **Backing:** `spur workflow run .spur/workflows/idea-pipeline.yaml` — direct workflow invocation.
- **Behavior:** Builds vars from the table above and invokes the idea pipeline. Flow: discovery → **idea-eval** (taste; reject → cancelled) → feature-create → ac-generate → feature-check → system-design (conditional) → design-approval (taste) → decompose → batch-create → handoff. STOPS at handoff — no task execution, no pipeline nesting.
- **Delegation:** Direct `spur workflow run .spur/workflows/idea-pipeline.yaml` (command maps flags → vars, then `Bash`).
- **Idea-evaluation gate:** After discovery, operator reviews `.spur/run/idea-eval-report.md` ([idea-evaluation.md](idea-evaluation.md)). Approve continues; reject/cancel → no feature. Under `--auto`, still pauses unless taste pre-cleared (`--approve-taste` / alias). Enhanced idea is a sidecar — `vars.idea` is not overwritten.
- **Design package (`--skip-design` only):**

  | Flags | Feature satellite (`system-design`) | Task `### Design` in batch |
  | --- | --- | --- |
  | (default) | seam / `needs_design` signal | **author `design` on each batch item** |
  | `--skip-design` | skip (keep brainstorm summary) | **omit `design`** — refine fallback later |

  Ties lean design — when the signal is ambiguous, `system-design` runs. Task Design defaults on
  unless `--skip-design`. Plan path uses the same package contract (no `--design` force flag).
- **Taste pre-clear (`--approve-taste`):** owned with design-approval var semantics in [cross-cutting.md](cross-cutting.md) § "Design Approval Gate"; idea-eval uses the parallel `idea_approved` var. One CLI flag sets both.

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
     - `keepachangelog` (default): `## [<version>] - <date>` header, then category headings per the keepachangelog convention — `### Added` / `### Fixed` / `### Changed` / `### Removed` / `### Other` — mapped from conventional-commit types.
     - `simple`: flat bulleted list grouped by type heading (`### feat`, `### fix`, …).
  6. Print the changelog to stdout. If the operator wants it in `CHANGELOG.md`, they redirect or paste.
- **Invariants:** Never mutates `CHANGELOG.md` directly — the command surface is stdout-only; writing it to a file (e.g. appending to `CHANGELOG.md`) is the operator's redirect choice, never the command's.

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
- **MANDATORY Exit Condition.** The ONLY way to complete successfully:
  1. Run validation command: `eval "$VALIDATION_CMD"`
  2. Capture exit code: `EXIT_CODE=$?`
  3. Output: `echo "EXIT_CODE=$EXIT_CODE"`
  4. **EXIT_CODE must equal 0**

  If EXIT_CODE != 0: NOT completed. MUST continue fixing.

  **Hallucination Red Flags — STOP if you think:**
  - "The errors look fixed" — check exit code, not appearance
  - "Most tests pass" — partial success = FAILURE
  - "Good enough for now" — 0 is the ONLY acceptable exit code
- **7-Phase Workflow:**

  ```text
  ┌─────────────────────────────────────────────────┐
  │ RETRY LOOP (max --max-retry iterations)         │
  │                                                 │
  │  → Phase 1: Detect validation command           │
  │  → Phase 2: Capture validation output           │
  │  → Phase 3: Auto-fix (biome check --write)      │
  │  → Phase 4: Parse and categorize errors         │
  │  → Phase 5: Root cause diagnosis                │
  │  → Phase 6: Fix by error type group             │
  │  → Phase 7: Validate (check EXIT_CODE)          │
  │                                                 │
  │  If EXIT_CODE = 0: SUCCESS, exit loop           │
  │  If EXIT_CODE != 0: continue                    │
  │                                                 │
  │  If counter >= MAX_RETRY:                       │
  │    Ask user: [Continue / Stop]                  │
  └─────────────────────────────────────────────────┘
  ```

  The 7 phases map onto the format→lint→test behavior loop above: Phases 1–2 capture the gate, Phase 3 settles auto-fixable formatting, Phases 4–6 are the per-group root-cause fix loops, Phase 7 is the final verification re-run.
- **Fix Priority:**

  | Priority | Type | Rationale |
  | ---------- | ------ | ----------- |
  | 1 | Build/compile | Blocks everything downstream |
  | 2 | Import/module | May cause cascading type failures |
  | 3 | Type errors | Often reveals logic bugs |
  | 4 | Test failures | Confirms behavior correctness |
  | 5 | Lint warnings | Code quality (lowest priority) |

  **Critical Rule**: If THREE fixes fail consecutively, STOP. This signals architectural problems.
- **Error Patterns — TypeScript:**

  | Issue | Root Cause Approach |
  | ------- | --------------------- |
  | `any` type | Trace where untyped data enters; add types at source |
  | Unused variable | Check if removal breaks anything |
  | Missing return type | Read function to understand actual return |
  | Type mismatch | Compare expected vs. actual; find divergence |

- **Bun/V8 Coverage Quirk.** Bun uses V8's function coverage which does NOT count implicit class constructors:

  ```typescript
  // biome-ignore lint/complexity/noUselessConstructor: V8 function coverage requires explicit constructor
  constructor() {}
  ```

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
     - <what was done — reference existing artifacts by path, don't restate their content>

     ## Blocker
     <blocker description>

     ## Rejected Approaches
     - <approach> — <why it failed>

     ## Suggested Skills
     - <sp:skill-name> — <why the next agent should invoke it here>

     ## Next Steps
     1. <concrete action>
     ```

  4. Write the document & associate task:
     - Always write the standalone handover document to `docs/handover/<YYYY-MM-DD>-<slug>.md` (create `docs/handover/` if absent). This document is the durable SSOT.
     - If a task context exists, append a pointer link (`- Handover: [docs/handover/<YYYY-MM-DD>-<slug>.md](docs/handover/<YYYY-MM-DD>-<slug>.md) — <blocker summary>`) into the task's `## References` section (or non-destructively append to `## Notes` if `References` is unavailable), preserving any pre-existing content without replacing or clobbering it.
  5. Print the path to the handover document.
- **Suggested Skills section:** Name the `sp:*` skill(s) the next agent should invoke to continue —
  inferred from the task's remaining Requirements/AC and the blocker itself (e.g. a design
  disagreement suggests `sp:sys-architecture`; an unmet AC suggests `sp:code-verification`). Omit
  the section only when plain continuation is more relevant than any specific skill.
- **Redaction rule.** Never write secrets, API keys, tokens, credentials, or PII into the handover
  document — not in the Goal/Progress/Blocker prose, not in a pasted error message or log excerpt.
  Redact with `<REDACTED>` and note what kind of value was removed; a handover is a durable file
  that may be read by a different session, agent, or human than the one that hit the blocker.
- **No-duplication rule.** Reference existing artifacts — task sections (`## Solution`,
  `## Testing`, `## Review`), verdict files (`.spur/run/<wbs>-verdict.json`), diffs, and docs — by
  **path**, not by pasting their content into the handover body. The handover is a pointer document;
  restating content it can instead link to makes it stale the moment the source changes.
- **Invariants:** The handover is honest — rejected approaches are recorded so the next agent doesn't retry them. The blocker is specific, not "it doesn't work."
