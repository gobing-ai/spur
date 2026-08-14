---
description: "Prompt-first feature frontier prioritizer — answers 'which feature should we work on now?' with a ranked, evidence-carrying frontier, and emits rank-distorting tree defects as proposals /sp:dev-featurechange consumes. Triggers: find next, which feature, feature ranking, frontier priority, what should I work on."
role: planner
argument-hint: "[--task [<feature-id>]] [--agent <inline|auto|name>] [--auto] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Next

Wraps the **sp:next-feature** skill — a prompt-first prioritizer that ranks the open feature frontier
by **derived** importance and urgency, shows its evidence per candidate, gates unactionable features
instead of ranking them, and emits tree structure defects as proposals only.

Answers *"which X"* — the question `/sp:dev-next` deliberately does not (next-router routing-table
§0 step 1c). Advancing a chosen target remains `/sp:dev-next`'s job; applying tree changes remains
`/sp:dev-featurechange`'s job.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--task` `[<feature-id>]` | After the report, confirm one target and dispatch the planning half to produce implement-ready tasks. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing analysis. | inline |
| `--auto` | Skip the `--task` confirm (accept the offered target) and forward into dispatched children. | off |
| `--json` | Emit the ranked frontier, gated list, and proposals as a JSON envelope. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-find-next
/sp:dev-find-next --json
/sp:dev-find-next --task
/sp:dev-find-next --task --auto
/sp:dev-find-next --task H1 --auto
```

**`--task` — confirm, then dispatch.** The command offers the rank-1 candidate (or the id you pass),
then routes on the tier the ranking already assigned: a **T3** feature with valid AC and no tasks
goes to `/sp:dev-plan --feature <id>` and then `/sp:dev-refineall --feature <id> --auto --depth ready`;
a **T1** feature (open tasks already exist) goes to refineall only, never a second decomposition;
**T2** (blocked), **T4** (stale-done), and T3 with invalid AC stop with their reason. The command
creates no tasks itself — decomposition and its schema gate belong to `/sp:dev-plan`.

**Confirm under `--auto`.** Without `--auto`, confirmation is interactive (accept the offer, name
another candidate, or decline). With `--auto`, the offered target is accepted automatically —
rank-1 for bare `--task`, or the explicit `--task <feature-id>` — and dispatch proceeds without a
HITL pause. Passing `--auto` is operator pre-consent to take the ranking's recommendation; it is
not a license to invent a different target or to bypass T2/T4 refuse / invalid-AC stop. `--auto`
is also forwarded to the dispatched children. Declining (interactive path only) writes nothing.
Without `--task`, `--auto` is a no-op (the ranking report has no HITL gate).

Without `--task` the command is read-only with respect to the corpus and docs. Under `--task` the
only mutation is the one the dispatched commands perform on `docs/tasks*/` after confirm (or
auto-accept) — the command still performs no `spur feature move`, no sync apply, and no write under
`docs/features/**`. Defect proposals conform to the `docs/plans/feature-tree-restructure-map.md`
schema and are applied only through `/sp:dev-featurechange` (dry-run → confirm → apply).

**See also:** skill `sp:next-feature` (SSOT), `sp:next-router` (`/sp:dev-next`),
`sp:conflict-finding` (the prompt-first template), `sp:spur-cli`.

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface), then invoke the next-feature skill, forwarding all arguments:

```text
Skill(skill="sp:next-feature", args="$ARGUMENTS")
```
