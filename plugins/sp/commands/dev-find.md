---
description: "Find things — one routing command for four lenses: conflict (authority-aware semantic audit across source, tasks, features and authority docs), issue (daily or ad-hoc history-anatomy diagnostic report over imported history), next (prompt-first feature frontier prioritizer — which feature to work on now), way (Wayfinder — chart a multi-session investigation map, always inside an isolated git worktree + branch). Triggers: find conflict, conflict audit, semantic conflict, authority mismatch, stale projection, find historical issues, post-mortem, performance analysis, history-anatomy, run the daily report, ad-hoc diagnosis, find next, which feature, feature ranking, frontier priority, what should I work on, wayfind, chart a course, multi-session investigation."
requires: [cli:spur, local-fs]
role: planner
argument-hint: "<conflict|issue|next|way> [conflict: --tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>] --pillar <source|tasks|features|authority|all> --mode <adaptive|full> --resolve] [issue: [<focus>] --date <YYYY-MM-DD> --since <RFC3339> --until <RFC3339> --recompute --output <path>] [next: --task [<feature-id>]] [way: <idea> | <feature-id> [<wbs>]] [--agent <inline|auto|name>] [--auto] [--json] [--worktree [<name>]] [--wrap]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Edit", "Skill", "AskUserQuestion"]
---

# Dev Find

One entry point with a routing table. The lens skill owns its contract; this command only routes.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<conflict\|issue\|next\|way>` | The lens to run. Required. An unknown or missing lens prints this table and stops without dispatching. | required |
| `conflict: --tasks` `<selector>` | Conflict lens: audit an explicit task set (WBS list, status pseudo-list, `feature:<id>`, `ready`). | — |
| `conflict: --feature` `<id>` | Conflict lens: audit one feature (comma list allowed). | — |
| `--scope` `<path>` | Conflict lens: bound the audit to a path set (comma list). | — |
| `--pillar` `<source\|tasks\|features\|authority\|all>` | Conflict lens: which pillar pair to audit. | all |
| `--mode` `<adaptive\|full>` | **Conflict lens only.** The issue lens uses `--mode <daily\|ad-hoc>`; each lens skill validates its own vocabulary. | adaptive |
| `--resolve` | Conflict lens: open the confirmation workflow for confirmed repairs. | off |
| `<focus>` | Issue lens: the topic or area the report should focus on. | — |
| `--date` `<YYYY-MM-DD>` | Issue lens: report day. | today |
| `--since` `<RFC3339>` | Issue lens: lower bound of the window. | — |
| `--until` `<RFC3339>` | Issue lens: upper bound of the window. | — |
| `--recompute` | Issue lens: ignore the cache branch and recompute. | off |
| `--output` `<path>` | Issue lens: write the report to this path. | managed report path |
| `--task` `[<feature-id>]` | Next lens: rank tasks instead of features, optionally within one feature. | off |
| `<idea>` | Way lens: a new investigation idea — the foggy destination to chart. | required for `way` |
| `<feature-id>` | Way lens: an existing feature to chart, or to resolve a ticket in. | — |
| `<wbs>` | Way lens: one map ticket to resolve instead of charting. | — |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing stages — resolved by the lens skill. | omit |
| `--auto` | Skip objective HITL confirmations for the lens. | off |
| `--json` | Emit the lens result as structured JSON where supported. | off |
| `--worktree` `[<name>]` | Way lens: isolated worktree (mandatory there — omitting it means create mode). | create for `way` |
| `--wrap` | Way lens: run the wrap hop on the resolved `<wbs>` inside the worktree before landing. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-find <conflict|issue|next|way> [lens flags…]
```

| Lens | Skill | Preamble |
| --- | --- | --- |
| `conflict` | `sp:conflict-finding` | none — args pass verbatim |
| `issue` | `sp:history-anatomy` | none — args pass verbatim |
| `next` | `sp:next-feature` | none — args pass verbatim |
| `way` | `sp:wayfinder` | the worktree lifecycle below, then args pass verbatim |

`--mode` is a deliberate per-lens homonym (`adaptive|full` for conflict, `daily|ad-hoc` for issue):
arguments pass through untouched and each lens skill validates its own vocabulary, so the merge never
has to unify flag sets. An unknown or missing lens prints the table above and stops.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Resolve the lens from the first argument, then dispatch the remaining arguments **verbatim**
  (`$ARGS_WITHOUT_LENS`). Never rewrite, default or validate a lens flag here — the lens skill owns
  its contract, unchanged by this merge:
  - `conflict` → `Skill(skill="sp:conflict-finding", args="$ARGS_WITHOUT_LENS")`
  - `issue` → `Skill(skill="sp:history-anatomy", args="$ARGS_WITHOUT_LENS")`
  - `next` → `Skill(skill="sp:next-feature", args="$ARGS_WITHOUT_LENS")`
  - `way` → the worktree preamble below, then `Skill(skill="sp:wayfinder", args="$ARGS_WITHOUT_LENS")`
- An unknown or missing lens prints the lens table and stops: no dispatch, no side effect.
- **`way` preamble (moved verbatim from `dev-find-way`, task 1391):**
  - Worktree lifecycle: [execution-batch.md § Worktree isolation](../skills/spur-dev/references/execution-batch.md#worktree-isolation---worktree-name) — every host call pins the execution tree per its per-call tree-pin rule.
  - Inside the worktree: `Skill(skill="sp:wayfinder", args="$ARGUMENTS")` — the skill owns charting, ticket resolution, fog graduation and the one-ticket-per-session rule.
  - `--wrap` (work mode): `/sp:dev-wrap <wbs> [--agent <value>]` inside the worktree before WT-3b.
