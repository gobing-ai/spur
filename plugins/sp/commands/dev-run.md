---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [--mode <full|implement>] [--agent <name|auto>] [--auto] [--next] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** skill (execution half).

Pick a task and run it. Two modes:
- **`full`** (default): Drive the complete pipeline via `.spur/workflows/task-pipeline.yaml` —
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
| `--wrap` | Trigger `wrapup-pipeline.yaml` after the task reaches `done`. Equivalent to running `/sp:dev-wrap <wbs>` after execution. Does not change the execution pipeline. | off |
| `--continue` | Resume an interrupted run: read the latest checkpoint from `.spur/memory/sessions/` and surface its `next_action` before resuming. See "Resume from checkpoint" below. | off |

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

## Task-type awareness

The implement step delegates to `sp:code-implementation`, which assumes a standard implementation
task (`template: default`). When the task carries a different template, the implement agent MUST
check the task's frontmatter `template` field and adjust its scope:

| Template | Scope | Primary input |
|----------|-------|---------------|
| `default` | Implement `## Requirements` → code changes | `## Requirements` R-items, `## Design`, `## Plan` |
| `review` | Fix the findings in `#### Review Findings` → code changes | `#### Review Findings` table (under `### Background`), `## Plan` |
| `brainstorm` | Research/ideation → `## Solution` write-up | `## Background` prompt, `## Design` constraints |

The implement agent reads the template field first, then picks the correct input section. For a
`review` task, the `#### Review Findings` table IS the requirements — fix each finding in
severity order (P1 → P2 → P3 → P4), then re-review.

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
4. **If the task is a partial deliverable, mark it.** When the requirements split across tasks
   (e.g. an R1/R2 split where this task ships R1 and a follow-up task owns R2), or any acceptance
   criterion is deferred to another task, the `## Solution` and `## Review` sections MUST carry a
   visible `⚠️ PARTIAL` marker naming what is shipped vs. deferred and the follow-up task's WBS.
   Without it, a downstream release can advertise a half-feature as complete (the `cancel` verb
   that couldn't yet kill its subprocess is the canonical example). Format:

   > ⚠️ **PARTIAL — R2 (subprocess kill) deferred to `<follow-up-wbs>`.** This task ships R1 only
   > (the `cancel` verb + run finalization). The subprocess-kill half needs a pid-tracking layer
   > tracked separately; until it lands, `cancel` marks the run `failed` but cannot reach the live
   > process.

   The marker belongs at the TOP of `## Solution` (so a reviewer sees it before the change-map)
   and is echoed in `## Review`'s P-row for the deferred requirement (status `OPEN → <follow-up-wbs>`,
   not `DONE`). Remove the marker only when the follow-up task closes.

## `--next` chain — advance to the next step

`--next` makes this command **one link in the linear execution chain**
(`refine → run → verify → done`), not the whole-pipeline driver. It always operates on the
**implement** step: when `--next` is present, the mode resolves to `implement` even if `--mode full`
was passed (full mode runs every step itself, so there is nothing to *advance to* — but rather than
reject the operator's typed flag, `--next` reinterprets it as "run the implement step, then hand
off"). This makes `/sp:dev-run <wbs> --auto --next` work as the headline chain link.

When `--next` is set and implementation succeeds:

0. **Backlog promotion (chain step 0).** If the task's current status is `backlog`, the chain
   first auto-promotes `backlog → todo` via `spur task update <wbs> todo`. The FSM permits this
   transition unguarded (no section gate), so the promotion is pure ceremony — but the chain
   performs it explicitly rather than surfacing a raw `GuardDeniedError: No transition from
   "backlog" to "wip"`. `--auto --next` already expresses the operator's intent to drive the
   task, so the mechanical two-hop (`backlog → todo → wip`) is correct behavior, not a bypass:
   the lifecycle guard stays authoritative for every subsequent transition. If the promotion
   itself fails, stop as review-pending and include both the FSM error and the concrete remediation
   `spur task update <wbs> todo`; never surface a raw `GuardDeniedError` unaided.
1. **Transition through the FSM (guards honored — no `--no-lifecycle`):**
   - `spur task update <wbs> wip` — the `todo → wip` guard is `always`; passes.
   - `spur task update <wbs> testing` — the `wip → testing` guard runs `spur task check <wbs>`.
2. **Record provenance** — `spur task run-link <wbs> --source next-auto --json`. Writes a
   `kind: pipeline` entry into `task_run_links` so the `testing → done` provenance guard
   (lifecycle-adapter.ts L106-131) accepts the in-session implementation path. Idempotent:
   safe to call even when a pipeline link already exists.
3. **On a clean transition:** invoke `/sp:dev-verify <wbs> --auto --next` (`--auto` propagates
   down the whole chain). The verify step's `--next` transition to `done` now passes the
   provenance guard because step 2 recorded the link.
4. **On a guard failure — stop as review-pending:** leave the task at its current status, surface
   the blocking reason (e.g. a missing `## Solution` section that fails `spur task check`), and do
   NOT invoke dev-verify. The chain halts here for the operator to resolve, exactly like the
   pipeline's precheck/HITL gates.

```
review pending — wip → testing guard failed for <wbs>
  spur task check reported: <blocking finding, e.g. "## Solution section is empty">
  task left at wip. Resolve the finding, then re-run: /sp:dev-run <wbs> --auto --next
```

**Status precondition (R2).** The chain assumes the task is at `todo` or later when step 0 is
absent — i.e. the operator has already moved it off `backlog` via `spur task update <wbs> todo`
during refinement. Step 0's auto-promote covers the case where they did not: a `backlog`-seeded
task with `--next` is promoted mechanically rather than denied (`--auto` only controls objective
confirmations). There is no refusal path for `backlog` when `--next` is present. To retain manual
status control, omit `--next` and promote explicitly with `spur task update <wbs> todo` before a
later chained run.

Honoring the guard is the point: the FSM is what stops a malformed task from sliding into `testing`
and then `done`. Bypassing it with `--no-lifecycle` (as the pipeline does for its own internal
transitions) would defeat the review-pending stop the chain exists to provide.

## Mode resolution (deterministic — run before dispatch)

`--next` always resolves the mode to `implement` (the chain link), regardless of `--mode`. The
mode is decided mechanically from `$ARGUMENTS`, then the dispatch below runs. This is a
deterministic resolution, not agent discretion.

| `$ARGUMENTS` carries | Resolved mode | Dispatch |
|---|---|---|
| `--next` (with or without `--mode implement`) | `implement` | `implement $ARGUMENTS` |
| `--next` **and** explicit `--mode full` | `implement` + **MANDATORY warning** (below) | `implement $ARGUMENTS` |
| `--mode full` (no `--next`) | `full` | `run $ARGUMENTS` |
| `--mode implement` (no `--next`) | `implement` | `implement $ARGUMENTS` |
| neither (default) | `full` | `run $ARGUMENTS` |

**MANDATORY warning — emit when `$ARGUMENTS` carries BOTH an explicit `--mode full` AND `--next`.**
This is the only case `--next` is "ignored" (the operator asked for the full pipeline *and* the
advance-chain; `--next` won the resolution, so the explicit `--mode full` has no effect). Emit
this literal string to the operator **before** dispatching — it is a required step, not optional
prose:

```
⚠️  --next is ignored in full mode: --next resolves the mode to `implement` (the chain link),
    so an explicit --mode full has no effect. Running the implement step only. Drop --next to
    run the full pipeline, or drop --mode full to silence this warning.
```

The plain `--next` case (no explicit `--mode full`) emits **no** warning — that is the intended
chain-link behavior, not a silent ignore.

## Implementation

Resolve the mode per the table above (emit the mandatory warning if triggered), then delegate.
`$ARGUMENTS` passes all flags including `--agent` through verbatim. The two modes route to different
owners — **full** drives the whole pipeline (the spine), **implement** dispatches the single
implementation competency:

- **full mode:** `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")` — the orchestration spine.
- **implement mode:** `Skill(skill="sp:code-implementation", args="$ARGUMENTS")` — the implementation
  competency the spine's `implement` step dispatches to.

## `--wrap` — post-execution wrap-up

When `--wrap` is set and the task reaches `done`, automatically invoke the wrap-up pipeline:

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto"}'
```

(`tasks` is a JSON-encoded string — `--vars` values must be strings.)

This is equivalent to running `/sp:dev-wrap <wbs>` after execution. The wrap-up captures learnings,
records metrics, syncs docs, and optionally advances the feature / cleans up the branch (when `--merge`
is also passed). `--wrap` does NOT change the execution pipeline — it only adds a post-done wrap-up
step. If the task fails (does not reach `done`), `--wrap` is not triggered.


## Resume from checkpoint (`--continue`)

When resuming a paused or interrupted task run, read the latest checkpoint from
`.spur/memory/sessions/` to recover context:

```bash
ls -t .spur/memory/sessions/*-${wbs}-*.md 2>/dev/null | head -1
cat .spur/memory/sessions/<session-id>.md
```

The checkpoint's YAML frontmatter contains `session_id`, `workflow`, `task_wbs`, `phase`,
`last_gate`, `timestamp`, and `next_action`. Surface `next_action` to the operator before
resuming. Checkpoints are working memory (not a validated corpus) — the task file is the
authoritative state.

See [cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Session Checkpoint
Convention" for the full format and write/read triggers.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. For full mode invoke the
  `sp:spur-dev` skill's `run` operation; for implement mode invoke `sp:code-implementation` directly.
