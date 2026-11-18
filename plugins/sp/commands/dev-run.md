---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
requires: [cli:spur, local-fs]
role: coder
argument-hint: "[<wbs>] [--all] [--tasks <selector>] [--feature <id>] [--mode <full|implement>] [--schedule <sequential|parallel|auto>] [--concurrency <n>] [--keep-going] [--agent <inline|auto|name>] [--auto] [--json] [--next] [--wrap] [--wrap-pr] [--continue] [--worktree [<name>]] [--no-summary] [--defer-gate]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to run. Exclusive with `--all`. | required unless `--all` |
| `--all` | Batch scope: run every task in the resolved set through `task-pipeline.yaml` in dependency order (the former `/sp:dev-run --all`). Exclusive with `<wbs>`. | off |
| `--tasks` `<selector>` | Batch selector — explicit WBS list, status pseudo-list, `feature:<id>`, or `ready`. Requires `--all`. | — |
| `--feature` `<id>` | Sugar for `--tasks feature:<id>`, plus the preflight feature check. Requires `--all`. | omitted |
| `--schedule` `<sequential\|parallel\|auto>` | Batch execution order. Formerly `dev-run --all --mode`; `--mode` keeps its per-task meaning here. | sequential |
| `--concurrency` `<n>` | Parallel-mode worker bound: at most `<n>` task pipelines at once (task 0931); a dependent starts only after its in-set dependencies are integrated onto the base ref. No-op in sequential mode. | 2 |
| `--keep-going` | Batch failure policy: continue past per-task failures (implied by `--auto`). | off |
| `--json` | Emit the batch report as structured JSON. | off |
| `--defer-gate` | Opt-in parallel-batch gate policy (task 1111): each task's `gate` state writes `DEFERRED` and one integrated full gate runs on the base ref before the feature sync. Requires a parallel schedule; dropped with a note otherwise. | off |
| `--mode` `<full\|implement>` | Full pipeline or single implement step. | full |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing stages. omit and explicit `--agent inline` resolve identically (task 0687): eligible stages dispatch once to a native subagent with host-session fallback (0508 eligibility); otherwise every stage executes in the invoking session. `auto` or a name keeps subprocess dispatch.. The opt-in `fleet` selector (0942) maps the run to `executor: 'fleet'` so `agent.run` stages dispatch through the fleet control plane (ADR-126) instead of a subprocess. | omit |
| `--auto` | Skip objective HITL confirmations. | off |
| `--next` | Chain-to-completion via the next-router. | off |
| `--wrap` | Run the wrap hop after the main step. The `--agent` selector is preserved into the `/sp:dev-wrap <wbs>` handoff when supplied; omission remains omission. The wrap hop is workflow-backed and reports its trigger-3 subprocess override. Mutually exclusive with `--wrap-pr`. | off |
| `--wrap-pr` | Run the wrap hop after the main step, commit close-out writes, push the worktree branch to remote origin, and open a Pull Request targeting the base ref (WT-PR). Mutually exclusive with `--wrap`. Full mode only; requires `--worktree` or a dedicated non-base branch. | off |
| `--continue` | Resume an interrupted task from its checkpoint. | off |
| `--worktree` `[<name>]` | Run the task pipeline in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. Full mode only. | off |
| `--no-summary` | Skip the measured execution summary (per-stage time, wait, tool calls, total / non-cached tokens) printed after a full-mode run. | off (summary printed) |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-run [<wbs>] [--all] [--tasks <selector>] [--feature <id>] [--mode <full|implement>] [--schedule <sequential|parallel|auto>] [--concurrency <n>] [--keep-going] [--agent <inline|auto|name>] [--auto] [--json] [--next] [--wrap] [--wrap-pr] [--continue] [--worktree [<name>]] [--no-summary] [--defer-gate]


`--all` runs the batch operation the former `/sp:dev-run --all` command dispatched — same operation
name, same args, same workflow YAML; only the command surface moved (task 1390).

**Selectors and the feature preflight.** `--tasks <selector>` takes an explicit WBS list, a status
pseudo-list, `feature:<id>`, or `ready`; `--feature <id>` is sugar for `feature:<id>`. When the
effective selector is feature-derived, run `spur feature check <id> --fix --json` then
`spur feature check <id> --strict --json` **once**, before any task-list resolution, freeze — before `task list`
— and before any task pipeline action (task 0510 R2). A non-zero strict check aborts the batch with verdict `aborted` and the structured findings (`--fix` repairs land in the report's `autoRepairs`).
`L4.scenario-unverified` and `L4.verifying-incomplete-tasks` — the expected pre-run states of a
not-yet-run or reopened feature — are reported verbatim but do not abort (the non-aborting set is
`NON_ABORTING_PREFLIGHT_CODES` behind `spur task preflight --classify-feature`); any other strict
error aborts. Explicit WBS lists, status pseudo-lists, and `ready` selectors add no feature preflight.

**`--schedule auto`.** Ordering is always dependency-correct: every schedule topo-sorts the frozen
set with `spur task batch-plan order` (deterministic, never hand-sorted). `auto` additionally reads
that schedule's dependency waves (tasks declaring the same file are serialized) and decides once,
before the first task: `parallel` when some wave holds ≥2 independent tasks and `--concurrency` ≥2;
otherwise `sequential` in the host session. `--worktree` or explicit `--agent inline` pins
`sequential`. The batch report records `schedule: auto → <resolved>` and why. The default stays
`sequential`: parallel costs ~N× tokens, worktree setup and subprocess executors, which a dependency
chain never pays back (rules: `execution-batch.md` § 2.4a).

**`--worktree` and a parallel schedule.** `--worktree --schedule parallel` is **rejected** —
parallel mode already isolates each task in its own worktree, and reuse mode (`--worktree <name>`) has no
per-task meaning. Run parallel batches without `--worktree`, or run them sequentially with it.

**`--next` (batch-once wrap).** Each task runs `task-pipeline.yaml` to terminal status, then the
wrap hop runs **once for the batch** — mirroring the batch-once shippable gate `dev-verify --all`
uses — rather than once per task. Without `--next`, `--wrap` wraps without advancing the feature
lifecycle.

**`--agent auto` pins one executor per batch.** With `--agent auto`, the first run's implement
`result.executor` is pinned for every later task in the frozen set; only a `failed-agent` ending
re-resolves it, exactly once (task 1318 R2/R3).

**Three orthogonal axes.** `--keep-going` is the batch failure policy (halt, or skip a failed task's
in-batch dependents and continue independents; `--auto` implies `--keep-going`). `--continue` resumes an
interrupted batch against its frozen identity — persisted plan membership, worktree marker,
identity-filtered checkpoints as hints (`execution-batch-continuation.md`, task 0919). `--next`
chains each task to terminal status plus the batch-once wrap.

**Corpus visibility.** While the batch runs in a worktree, corpus writes (task statuses, kanban) land
in the worktree copy; the invoking tree keeps the pre-run statuses until the FF-merge on success.

## Implementation

- **Bootstrap reads (1128):** before the first dispatch, read [SKILL.md § Bootstrap reads](../skills/spur-dev/SKILL.md#bootstrap-reads) and load only that mode's files — everything else under `references/` is on demand.
- **Publish the generated plan first (1105):** your first tool call — before invoking the skill,
  reading any reference, or showing the task — is `spur workflow show task-pipeline.yaml --no-logo
  --format todo --json` (the CLI resolves the project→registered→shared layer); then publish every
  `.plan` row's `text` verbatim as the host todo list (the `steps[]` inventory when `.plan` is
  `null`) before readiness, Git, or isolation work —
  [shared startup contract](../skills/spur-dev/references/cross-cutting.md#shared-startup-contract-task-0814-r1r3r4r6r7r8)
  step 1 / [engine run setup](../skills/spur-dev/references/cross-cutting.md#shared-startup-contract-task-0814-r1r3r4r6r7r8) step 5.
- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Apply the [shared startup contract](../skills/spur-dev/references/cross-cutting.md#shared-startup-contract-task-0814-r1r3r4r6r7r8) — publish the generated plan first, quick readiness before isolation, digest binding, comprehensive checks at their owning boundaries (task 0814 R1/R3/R4/R7/R8; 1105 R1).
- **Batch scope (`--all`, task 1390):** `--all` dispatches the former `dev-run --all` operation — interactive sequential omit/`--agent inline` uses `Skill(skill="sp:spur-dev", args="runall-inline $ARGUMENTS-without---all")`, otherwise `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS-without---all")` (→ `sp:super-planner`). Every former `dev-run --all` flag keeps its meaning except `--mode`, which is `--schedule` here. `--all` and `<wbs>` are mutually exclusive; without either, the per-task pipeline below runs. The batch driver, `execution-batch.md` and the workflow YAML stay unchanged — only the command surface moved.
- Full pipeline (default `--mode full`): interactive omit/`--agent inline` runs
  [the engine loop](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface)
  with `executor=host` — `spur workflow run` returns a work item, this session performs it, and
  `spur workflow continue <run-id> --answer-text <receipt>` advances the run; `--agent auto` or a
  named executor runs the same definition as a child process. Both go through
  `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`.
- Implement step only (`--mode implement`): `Skill(skill="sp:code-implementation", args="$ARGUMENTS")`
- After a full-mode run settles (done, failed or paused), print the
  [execution summary](../skills/spur-dev/references/dev-operations.md#execution-summary) unless `--no-summary`.
- Then report the run's decision points (triage lane, failure classes, approval) from their rows
  ([reporting a run](../skills/spur-dev/references/decision-points.md#reporting-a-run)). A `failed` or `remediate` route is explained by the row
  that chose it; quote its value, source and reason, never a fresh judgment.

**Flags:**

- `--auto` | `--agent <inline|auto|name>` — Skip objective HITL confirmations (taste/irreversible gates still pause). `--agent` names who does the model-bearing work. Interactive omit/`inline` keeps the controller and implement-only stages in this session; full mode reads `task-pipeline.yaml` as the SSOT and runs on the host executor (`vars.executor: 'host'`; the engine walks its actions/guards and `spur workflow continue` advances each pause), whose eligible `agent.run` stages dispatch once to a native subagent and otherwise run in the host (0508 eligibility — task 0687 resolved-inline) It records `stage <id> executed inline in session <session-id>` or `stage <id> executed via subagent <agent-id> (host session <session-id>)` in the run log. `auto` or a name is merged into `vars.agent` and `vars.implementAgent` and keeps the existing subprocess workflow; `--agent fleet` maps the run to `vars.executor: 'fleet'` instead (fleet dispatch, 0942). Headless `spur workflow run` / `spur agent run` is unchanged. See the [execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `--escalation-file <path>` (implement step only, 0933) — names the Q/A escalation transcript
  (default `.spur/run/<wbs>-escalation.md`). Absent on a first attempt means "no prior
  escalations". When the implement agent needs an operator decision it appends its question to
  `.spur/run/<wbs>-question.md` and exits 0 — the pipeline's `escalate` hop surfaces the question,
  the operator answers via `spur workflow continue --answer-text`, and the guard appends the Q/A
  pair to this transcript before re-entering implement, where the agent reads it and resumes.
- `--wrap-pr` (run wrap hop, push branch, and create PR) — runs the wrap hop on `$BRANCH`, commits close-out
  writes, pushes the branch to `origin`, and opens a Pull Request targeting `$BASE_REF`
  (`WT-PR`, execution-worktree-landing.md). Mutually exclusive with `--wrap`: passing both exits 2. Full mode only;
  requires `--worktree` or execution on a dedicated non-base branch (refuses execution directly on `main`).

`--worktree` `[<name>]` (run the task's pipeline in an isolated git worktree — FF-merge onto the
base ref on full success, retain intact on any failure/halt/non-FF; bare form creates a fresh tree,
`<name>` form adopts an existing worktree by name/path/branch). The lifecycle — dirty-tree precheck,
creation or adoption, crash-safe `.spur/run/` marker, merge-or-retain, `--continue` re-entry — is
`execution-worktree.md` (creation/adoption, WT-1…WT-3b) + `execution-worktree-landing.md`
(WT-4/WT-5) applied to a batch of one: marker `command` is `dev-run`
and `selector` is the `<wbs>`, the derived branch is `sp/run-<wbs>-<short-id>`, and the success
condition is the task reaching terminal `done` with no failed stage. A failing gate, a non-PASS
verify verdict, or a HITL pause that ends the run all take the retention path.

**`--worktree` is full-mode only.** `--worktree --mode implement` is **rejected**. `--mode implement`
*is* the pipeline's implement stage and runs in whatever tree the driver already set up (bug-742);
giving it a second worktree would split one task's evidence across two trees. Use `--worktree` on the
full-mode invocation, which carries the implement stage with it.

**`--worktree` corpus visibility.** While the task runs in a worktree, corpus writes (status
transitions, evidence sections, kanban) land in the worktree copy; your main tree still shows the
pre-run status until the FF-merge on success. This is expected, not a bug.

**Mode split (load-bearing — bug-742)**

| Mode | What runs | Must not do |
| --- | --- | --- |
| `--mode full` (default) | Interactive omit/inline: host-session driver over `task-pipeline.yaml`; explicit/headless executor: workflow subprocess | — |
| `--mode implement` | Single implement competency via `sp:code-implementation` | Re-launch the full pipeline, `spur workflow run …task-pipeline…`, `/sp:dev-run` **without** `--mode implement`, or accept `--worktree` (rejected) |

The pipeline's `implement` step invokes this command **only** as:

```text
/sp:dev-run --mode implement <wbs> --auto
```

That pure slash form is intentional (ADR-043): workflow `agent.run` `input` is a command pointer, not an inline essay. Anti-recursion, scope, and Solution authorship live in this command + `sp:code-implementation`, not in YAML prose bolted onto the slash line.

**When `--mode implement` is active (including as a pipeline subprocess):** work only in the current working tree on `<wbs>`. **NEVER invoke** `spur workflow run` for the task pipeline, and **NEVER invoke** `/sp:dev-run` without an explicit `--mode implement` — this step *is* the pipeline's implement stage; re-entering full mode recurses (bug-742).

> **⚠ Redefinition (feature H8, 2026-07-31).** `--next` previously selected implement-only mode on
> this command. It no longer does — use `--mode implement`. The replacement already existed and is
> what `routing-table.md` row A5 dispatches, which is evidence the overload was accidental. This
> warning is marked for removal after one release (these are prompt files; leaving it is permanent
> noise). See ADR-039. **was: `--next` selected implement-only mode.**
