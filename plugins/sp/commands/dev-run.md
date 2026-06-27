---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next]"
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
| `--mode <full\|implement>` | `full` drives the complete pipeline; `implement` does only the implement step. **`--next` forces `implement`** regardless of this flag. | `full` |
| `--agent <name\|auto>` | Spawn the pipeline steps under a specific agent. Omit (the default) → the spawned `agent.run` steps use the configured default executor (`omp`). **Current-agent execution is not expressible** on the pipeline surface (the FSM runs subprocesses). | (configured default — `omp`) |
| `--auto` | Skip the HITL approval gate (full mode) or skip confirmations (implement mode) | off |
| `--next` | Advance the task to its next pipeline step. On success, transition `todo → wip → testing` through the lifecycle FSM (guards honored) and invoke `/sp:dev-verify <wbs> --auto --next`. **Implies `--mode implement`** — see below. | off |

## Behavior

Thin wrapper: mode selection routes to the correct `sp:spur-dev` operation. Task selection,
pipeline invocation, HITL surfacing, and continuation logic are all owned by the skill.

### Agent override

`--agent` is a **pipeline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"). The dual-workflow
FSM runs each stage as a subprocess; the calling agent cannot block on itself, so "current agent" is
**not expressible** here. The honest behaviors:

| Value | Behavior |
|-------|----------|
| *(omitted)* | Forward nothing — the spawned `agent.run` steps resolve to the configured default executor (`omp`). |
| `<name>` | Spawn that explicit agent — threaded to `vars.agent` (full mode) or the backing `Skill()` call (implement mode). |
| `auto` | Resolve the current runtime to its canonical agent name and spawn that. |

In full mode, `--agent <value>` is merged into the `--vars` JSON passed to `spur workflow run`. In
implement mode, it is passed through `$ARGUMENTS` to the backing skill.

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

## `--next` chain — advance to the next step

`--next` makes this command **one link in the linear execution chain**
(`refine → run → verify → done`), not the whole-pipeline driver. It always operates on the
**implement** step: when `--next` is present, the mode resolves to `implement` even if `--mode full`
was passed (full mode runs every step itself, so there is nothing to *advance to* — but rather than
reject the operator's typed flag, `--next` reinterprets it as "run the implement step, then hand
off"). This makes `/sp:dev-run <wbs> --auto --next` work as the headline chain link.

When `--next` is set and implementation succeeds:

1. **Transition through the FSM (guards honored — no `--no-lifecycle`):**
   - `spur task update <wbs> wip` — the `todo → wip` guard is `always`; passes.
   - `spur task update <wbs> testing` — the `wip → testing` guard runs `spur task check <wbs>`.
2. **On a clean transition:** invoke `/sp:dev-verify <wbs> --auto --next` (`--auto` propagates down
   the whole chain).
3. **On a guard failure — stop as review-pending:** leave the task at its current status, surface
   the blocking reason (e.g. a missing `## Solution` section that fails `spur task check`), and do
   NOT invoke dev-verify. The chain halts here for the operator to resolve, exactly like the
   pipeline's precheck/HITL gates.

```
review pending — wip → testing guard failed for <wbs>
  spur task check reported: <blocking finding, e.g. "## Solution section is empty">
  task left at wip. Resolve the finding, then re-run: /sp:dev-run <wbs> --auto --next
```

Honoring the guard is the point: the FSM is what stops a malformed task from sliding into `testing`
and then `done`. Bypassing it with `--no-lifecycle` (as the pipeline does for its own internal
transitions) would defeat the review-pending stop the chain exists to provide.

## Implementation

Delegates to **sp:spur-dev** skill. `$ARGUMENTS` passes all flags including `--agent` through verbatim:

- **full mode:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`
- **implement mode:** `Skill(skill="sp:spur-dev", args="implement $ARGUMENTS")`

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `run` operation directly.
