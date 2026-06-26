---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [--mode <full|implement>] [--agent <name|inherit|auto>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** skill (execution half).

Pick a task and run it. Two modes:
- **`full`** (default): Drive the complete pipeline via `config/workflows/task-pipeline.yaml` —
  precheck, implement, test, review, HITL approval, verification, and record. The skill monitors
  the run, surfaces HITL gates to the operator, and handles continuation.
- **`implement`**: Execute only the implement step — read the task's `## Requirements` / `## Design`
  / `## Plan`, write the code that satisfies them, and author the `## Solution` change-map. This
  is the step the pipeline calls internally; it is NOT the pipeline driver. Formerly `/sp:dev-implement`.

## When to use

- A task is ready to execute ("run 0042").
- Continuing a paused pipeline run.
- A focused "just write the code for this task" request (`--mode implement`).
- The operator says "run this task", "execute the task", or "implement 0042."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--mode <full\|implement>` | `full` drives the complete pipeline; `implement` does only the implement step | `full` |
| `--agent <name\|inherit\|auto>` | Agent override: `<name>` = explicit agent, `inherit` = pipeline default, `auto` = resolve current agent | (none — pipeline `vars.agent` default) |
| `--auto` | Skip the HITL approval gate (full mode) or skip confirmations (implement mode) | off |
| `--next` | On success, auto-transition to `testing` and invoke `/sp:dev-verify <wbs> --next`. For `--mode implement` only — ignored in full mode. | off |

## Behavior

Thin wrapper: mode selection routes to the correct `sp:spur-dev` operation. Task selection,
pipeline invocation, HITL surfacing, and continuation logic are all owned by the skill.

### Agent override

`--agent` controls which agent executes the pipeline steps:

| Value | Behavior |
|-------|----------|
| `<name>` | Explicit agent name — threaded to `vars.agent` (full mode) or the backing `Skill()` call (implement mode) |
| `inherit` | Use the pipeline's configured default (`vars.agent = "omp"`). Same as omitting the flag. |
| `auto` | Resolve the current runtime to its canonical agent name (claude-code, codex, openclaw, opencode, antigravity, pi) |

In full mode, `--agent <value>` is merged into the `--vars` JSON passed to `spur workflow run`. In
implement mode, it is passed through `$ARGUMENTS` to the backing skill.`

## Section ownership — `--mode implement`

When running in `--mode implement`, the agent **owns** `## Solution` (the change-map). After
writing code, before yielding, the implement agent MUST:

1. Author the `## Solution` section — a markdown table listing each changed file with a
   `file:line` range and a one-line `what/why` summary.
2. Write it via the pipeline-sanctioned path:
   ```bash
   spur task update <wbs> --section Solution --from-file /tmp/<wbs>-solution.md
   ```
3. Write **only when the section is bare** — do not clobber a hand-authored change-map.

## `--next` chain (`--mode implement` only)

When `--next` is set and implementation succeeds:

1. Transition: `spur task update <wbs> testing --no-lifecycle`
2. Invoke: `/sp:dev-verify <wbs> --next --auto` (auto-forwarding `--auto` if it was set)
3. On failure: stop — surface the error, leave task at current status, do NOT invoke dev-verify

`--next` with `--mode full` is a no-op — full mode already handles progression internally.

**When `--next` is passed in full mode, emit a warning before doing anything else** (the flag is
silently ignored otherwise, which surprises the operator):

```
warning: --next is ignored in full mode (full mode runs all stages).
         To advance only one stage, use: /sp:dev-run <wbs> --mode implement --next
```

## Implementation

Delegates to **sp:spur-dev** skill. `$ARGUMENTS` passes all flags including `--agent` through verbatim:

- **full mode:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`
- **implement mode:** `Skill(skill="sp:spur-dev", args="implement $ARGUMENTS")`

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `run` operation directly.
