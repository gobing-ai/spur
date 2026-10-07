---
description: Wayfinder — chart a multi-session investigation map for a foggy destination, or resolve one map ticket, always inside an isolated git worktree + branch
role: planner
argument-hint: "<idea> | <feature-id> [<wbs>] [--agent <inline|auto|name>] [--auto] [--worktree [<name>]] [--wrap]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Dev Find Way

Wraps the **sp:wayfinder** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<idea>` | Loose idea whose destination is too foggy to spec in one session. Enters **chart** mode. | required (one of `<idea>` / `<feature-id>`) |
| `<feature-id>` | Existing wayfinder map (feature tagged `wayfinder-map`). Enters **work** mode. | required (one of `<idea>` / `<feature-id>`) |
| `<wbs>` | Work mode only: the ticket to resolve. Omit to take the first unclaimed frontier ticket. | first frontier ticket |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing charting/resolution. | omit |
| `--auto` | Skip objective HITL confirmations. Never skips the map's open-question decisions. | off |
| `--worktree` `[<name>]` | Isolation mode. Bare (or omitted) creates a fresh worktree + branch; `--worktree <name>` adopts an existing worktree by name/path/branch. FF-merge on success, retain on failure. There is no in-place mode. | create |
| `--wrap` | Work mode only: after the ticket reaches `done`, run `/sp:dev-wrap <wbs>` inside the worktree before the merge. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-way "<idea>" [--agent <inline|auto|name>] [--auto] [--worktree [<name>]]
/sp:dev-find-way <feature-id> [<wbs>] [--agent <inline|auto|name>] [--auto] [--worktree [<name>]] [--wrap]
```

A first argument that resolves as a feature id (`spur feature show <id> --json`) is work mode;
anything else is a chart-mode idea. Chart mode charts the map and stops; work mode resolves
**exactly one** ticket (one ticket per session).

**Always a worktree + branch.** Every invocation runs in an isolated git worktree on its own branch —
never in the invoking tree, and never as a branch switch (`git checkout -b`) in the invoking tree.
A branch-only session mutates the operator's checkout under every other agent sharing it, and its
`wayfind/*` branches pile up on the main tree. Omitting `--worktree` behaves exactly like bare
`--worktree`.

**Lifecycle.** `execution-batch.md` § Worktree isolation applied to a run of one (WT-1…WT-5):

- WT-1 dirty-tree precheck on the invoking tree (abort on dirty — name the files).
- WT-2 create (sibling dir, `bun install --frozen-lockfile --ignore-scripts`) or adopt by name.
- WT-3 marker in the invoking tree's `.spur/run/`: `command` = `dev-find-way`, `selector` =
  `chart:<destination-slug>` or `<feature-id>:<wbs>`.
- Derived branch: `sp/wayfind-<destination-slug>-<short-id>` (chart) or
  `sp/wayfind-<wbs>-<short-id>` (work).
- WT-3b commit the session's corpus writes on the branch, then WT-4 FF-merge onto the base ref
  (create mode removes the tree and deletes the branch; reuse mode retains both).
- WT-5 retain intact on any failure, HITL pause, unresolved open question that ends the session,
  or non-FF base — report path, branch and the resume command (`--worktree <name>`).

Success is: **chart** — map feature created, tagged `wayfinder-map`, `spur feature check <id>`
clean, child tickets wired; **work** — the ticket reached `done`, its line is in
**## Decisions so far**, and graduated fog became tickets.

**Ticket selection across parallel sessions (work mode).** Corpus writes — including the `wip`
claim — land in the worktree copy until the merge, so a claim is invisible to sibling worktrees.
Before choosing a frontier ticket, read every `.spur/run/worktree-*.json` marker in the invoking
tree with `command: dev-find-way` and `status: active`/`retained`, and exclude their `<wbs>`. A named
`<wbs>` held by such a marker aborts before any tree is created; resume it with
`--worktree <name>` instead.

**`--wrap`.** Runs after the ticket reaches `done` and before WT-3b, so the wrap's writes merge with
the resolution. `--agent` is preserved into the `/sp:dev-wrap <wbs>` handoff when supplied. In chart
mode nothing is resolved: `--wrap` is skipped with the reason `wrap skipped: chart mode resolves no
ticket`.

**Corpus visibility.** Until the FF-merge, the map and ticket writes exist only in the worktree; the
invoking tree shows the pre-session state. Expected, not a bug.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Worktree lifecycle: [execution-batch.md § Worktree isolation](../skills/spur-dev/references/execution-batch.md#worktree-isolation---worktree-name) — every host call pins the execution tree per its per-call tree-pin rule.
- Inside the worktree: `Skill(skill="sp:wayfinder", args="$ARGUMENTS")` — the skill owns charting, ticket resolution, fog graduation and the one-ticket-per-session rule.
- `--wrap` (work mode): `/sp:dev-wrap <wbs> [--agent <value>]` inside the worktree before WT-3b.
