---
description: Run a task — full pipeline (precheck→implement→test→review→approve→verify→record→done) or single-step (implement)
argument-hint: "<wbs> [[`--mode`](../skills/spur-dev/references/flag-glossary.md#flag-mode) <full|implement>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [--auto] [--next] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** and **sp:code-implementation** skills.

## Usage

/sp:dev-run <wbs> [--mode <full|implement>] [--agent <name|auto>] [--inline|--subprocess] [--auto] [--next] [--wrap] [--continue]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface). Full mode retains workflow `agent.run` subprocess steps; implement mode runs the competency inline unless a trigger or `--subprocess` applies.
- Full pipeline (default `--mode full`): `Skill(skill="sp:spur-dev", args="run $ARGUMENTS")`
- Implement step only (`--mode implement`): `Skill(skill="sp:code-implementation", args="$ARGUMENTS")`

**Flags:**

| Flag | Meaning |
|---|---|
| `--mode <full\|implement>` | Select execution mode. `--mode implement` is the documented way to run only the implement step. |
| [`--next`](../skills/spur-dev/references/flag-glossary.md#flag-next) | Chain-to-completion with propagation: on success, hand the task back to `sp:next-router`, which resolves the next dispatch and re-invokes with `--next` still set, until the work is done or a gate stops it. **No longer selects implement-only mode** — use `--mode implement`. |
| [`--wrap`](../skills/spur-dev/references/flag-glossary.md#flag-wrap) | Run the wrap hop after the main step. |
| [`--continue`](../skills/spur-dev/references/flag-glossary.md#flag-continue) | Resume an interrupted task from its checkpoint. |
| [`--auto`](../skills/spur-dev/references/flag-glossary.md#flag-auto) \| `--agent <name\|auto>` | Skip objective HITL confirmations (taste/irreversible gates still pause). The `--agent` selector is a pipeline-stage executor selector, not the orchestrator surface — merged into `vars.agent` so `agent.run` steps spawn that executor while the orchestrator runs inline. See the [pipeline-wrapper carve-out](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface). |

> **⚠ Redefinition (feature H8, 2026-07-31).** `--next` previously selected implement-only mode on
> this command. It no longer does — use `--mode implement`. The replacement already existed and is
> what `routing-table.md` row A5 dispatches, which is evidence the overload was accidental. This
> warning is marked for removal after one release (these are prompt files; leaving it is permanent
> noise). See ADR-039. **was: `--next` selected implement-only mode.**
