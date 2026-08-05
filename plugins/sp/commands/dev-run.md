---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto] [--next] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to run. | required |
| `--mode` `<full\|implement>` | Full pipeline or single implement step. | full |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing stages. `--mode implement` honors `inline` (runs in this session). `--mode full` never runs stages inline — they always dispatch a subprocess (ADR-046); `inline` is not merged into `vars.agent` there, omit to use the configured `agent.default`. | inline (implement) · agent.default (full) |
| `--auto` | Skip objective HITL confirmations. | off |
| `--next` | Chain-to-completion via the next-router. | off |
| `--wrap` | Run the wrap hop after the main step. | off |
| `--continue` | Resume an interrupted task from its checkpoint. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-run <wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto] [--next] [--wrap] [--continue]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface). Full mode retains workflow `agent.run` subprocess steps; implement mode runs the competency inline unless a trigger or `--agent auto` applies.
- Full pipeline (default `--mode full`): `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`
- Implement step only (`--mode implement`): `Skill(skill="sp:code-implementation", args="$ARGUMENTS")`

**Flags:**

- `--auto` | `--agent <inline|auto|name>` — Skip objective HITL confirmations (taste/irreversible gates still pause). `--agent` names who does the model-bearing work. In `--mode implement` that is this session, so `inline` is honored literally. In `--mode full` the model-bearing work is the pipeline's `agent.run` stages, which **always dispatch a subprocess** (triggers 2 and 3) — `inline` is therefore not merged into `vars.agent`, because `spur agent run` rejects the literal and every stage would fail. An explicit `--agent inline` on the `--mode full` path is a surface error: surface a diagnostic naming `agent.default` (or `--agent <name>` / `--agent auto`) as the supported redirect, and do not merge `inline` into `vars.agent` (ADR-046). A named executor or `auto` **is** merged into `vars.agent`; omitting `--agent` leaves the stages on the configured `agent.default`. Either way the orchestrator loop continues in this session. See the [execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).

**Mode split (load-bearing — bug-742)**

| Mode | What runs | Must not do |
| --- | --- | --- |
| `--mode full` (default) | Launches `task-pipeline.yaml` via `sp:spur-dev` | — |
| `--mode implement` | Single implement competency via `sp:code-implementation` | Re-launch the full pipeline, `spur workflow run …task-pipeline…`, or `/sp:dev-run` **without** `--mode implement` |

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
