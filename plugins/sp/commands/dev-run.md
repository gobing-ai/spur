---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
role: coder
argument-hint: "<wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto] [--next] [--wrap] [--continue] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to run. | required |
| `--mode` `<full\|implement>` | Full pipeline or single implement step. | full |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing stages. omit and explicit `--agent inline` resolve identically (task 0687): eligible stages dispatch once to a native subagent with host-session fallback (0508 eligibility); otherwise every stage executes in the invoking session. `auto` or a name keeps subprocess dispatch.. | omit |
| `--auto` | Skip objective HITL confirmations. | off |
| `--next` | Chain-to-completion via the next-router. | off |
| `--wrap` | Run the wrap hop after the main step. The `--agent` selector is preserved into the `/sp:dev-wrap <wbs>` handoff when supplied; omission remains omission. The wrap hop is workflow-backed and reports its trigger-3 subprocess override. | off |
| `--continue` | Resume an interrupted task from its checkpoint. | off |
| `--worktree` `[<name>]` | Run the task pipeline in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. Full mode only. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-run <wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto] [--next] [--wrap] [--continue] [--worktree [<name>]]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Full pipeline (default `--mode full`): interactive omit/`--agent inline` uses the
  [inline pipeline driver](../skills/spur-dev/references/inline-pipeline-driver.md) via
  `Skill(skill="sp:spur-dev", args="run-inline $ARGUMENTS")`; `--agent auto` or a named executor
  uses `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")` and the workflow subprocess path.
- Implement step only (`--mode implement`): `Skill(skill="sp:code-implementation", args="$ARGUMENTS")`

**Flags:**

- `--auto` | `--agent <inline|auto|name>` — Skip objective HITL confirmations (taste/irreversible gates still pause). `--agent` names who does the model-bearing work. Interactive omit/`inline` keeps the controller and implement-only stages in this session; full mode reads `task-pipeline.yaml` as the SSOT and interprets its actions/guards through the inline driver, whose eligible `agent.run` stages dispatch once to a native subagent and otherwise run in the host (0508 eligibility — task 0687 resolved-inline) It records `stage <id> executed inline in session <session-id>` or `stage <id> executed via subagent <agent-id> (host session <session-id>)` in the run log. `auto` or a name is merged into `vars.agent` and `vars.implementAgent` and keeps the existing subprocess workflow. Headless `spur workflow run` / `spur agent run` is unchanged. See the [execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).

`--worktree` `[<name>]` (run the task's pipeline in an isolated git worktree — FF-merge onto the
base ref on full success, retain intact on any failure/halt/non-FF; bare form creates a fresh tree,
`<name>` form adopts an existing worktree by name/path/branch). The lifecycle — dirty-tree precheck,
creation or adoption, crash-safe `.spur/run/` marker, merge-or-retain, `--continue` re-entry — is
`execution-batch.md` § Worktree isolation applied to a batch of one: marker `command` is `dev-run`
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
