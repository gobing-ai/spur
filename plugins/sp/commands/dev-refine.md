---
description: Refine or re-audit a task — fill missing sections via Q&A, or with --depth ready verify existing claims and fixes against the tree, correct them, and promote to todo
requires: [cli:spur, local-fs]
role: planner
argument-hint: "[<wbs>] [--all] [--feature <id>] [--tasks <selector>] [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--keep-going] [--status <s>] [--json] [--next] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill. Three jobs:

| Job | Invocation |
| --- | --- |
| Fill blank Design/AC/Plan after `--skip-design` or an incomplete create (fallback; Design normally comes from plan/create) | `/sp:dev-refine <wbs> --auto` |
| Evaluate and correct an existing task: a review-triage filing, a stale backlog item, anything whose claims or proposed fixes may no longer hold | `/sp:dev-refine <wbs> --depth ready` (add `--auto` to skip Q&A) |
| Freeze a spec for another implementer; also the recovery command when `spur task create` ready preparation fails | `/sp:dev-refine <wbs> --auto --depth ready` |

`standard` checks only that target sections are structurally complete. It never re-checks what
they say. Use `ready` whenever the existing content itself is in doubt.

**Refine never writes `feature_id`.** It may *report* an orphan task in its result, but linking a
task to a feature is an operator decision with a lifecycle blast radius: `spur task update <wbs>
--feature <id>` reopens a `verifying` parent unless `--no-reopen` is passed. Route linking through
the opt-in [feature-link helper](../skills/spur-dev/references/feature-link-helper.md) (never
gate-time, never automatic, always confirmed) — observed 2026-10-13: the ready-preparation refine
that `spur task create` dispatches by default linked a fresh task to `P1` on its own and demoted
that feature `verifying → active`.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to refine. Exclusive with `--all`. | required unless `--all` |
| `--all` | Batch scope: refine every task in the resolved set in dependency order (the former `/sp:dev-refine --all`). Exclusive with `<wbs>`. | off |
| `--feature` `<id>` | Batch selector. Requires `--all`. | omitted |
| `--tasks` `<selector>` | Batch selector — explicit WBS list or status pseudo-list. Requires `--all`. | — |
| `--keep-going` | Continue past per-task failures. | off |
| `--status` `<s>` | Batch filter by task status. Requires `--all`. | — |
| `--json` | Emit the batch report as structured JSON. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated worktree (FF-merge on success, retain on failure). Requires `--all`. | off |
| `--focus` `<mode>` | Gap-analysis focus: `all\|requirements\|background\|constraints\|acceptance\|quick`. | `all` |
| `--description` `<text>` | Operator framing injected into Q&A/synthesis. | omitted |
| `--depth` `<standard\|ready>` | Spec depth bar (see flag glossary). | `standard` |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing refinement. | omit |
| `--auto` | Skip objective HITL gates. | off |
| `--next` | Hand off to the next-router on success. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]
```

Under `--auto` with **`--depth standard`** (default), SKIP only when target sections have no L3
findings: Background, Requirements, Acceptance Criteria, Design, Plan. Solution is not a refine
target. Under **`--depth ready`**, do **not** SKIP on L3-clean alone — run the implement-ready
checklist (dev-operations § refine) and rewrite Design/Requirements/Plan until another agent can
implement without inventing design:

1. Audit every existing claim against the current tree: facts, cited sources, fix soundness across
   all callers, test observability, environment, concurrent work, and scope.
2. Correct what is wrong and record each change in a dated `**Refine corrections (<date>)**` block
   in Background. When the task bundles several issues, triage each one. An issue that is invalid,
   already fixed or owned elsewhere is removed together with its R-items, Design/Solution notes,
   Plan steps and ACs. If no issue stays valid, cancel the task (`spur task update <wbs> cancelled`)
   and report `cancelled` instead of promoting it.
3. Run `spur task check <wbs> --as todo --json`, fill unset priority/estimate, and promote
   `backlog → todo`. If triage dropped issues, re-estimate and record old → new. Also record a
   title that still names dropped scope; the CLI cannot rename a task.
4. Report checklist rows `{id, pass, evidence}`.

Refine targets `backlog`/`todo` tasks; a `wip`-or-later task needs explicit operator consent and is
never demoted. Stage floor: the `planner` role per
[`roles.md`](../references/roles.md) — this command names roles, never tiers (0538 R4);
ready synthesis may use a higher tier when the task spans packages/seams.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- **Batch scope (`--all`, task 1390):** `--all` dispatches the former `dev-refine --all` operation —
  `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS-without---all")`, whose inner per-task leg is
  `refine`. Every former `dev-refine --all` flag keeps its meaning; `--all` and `<wbs>` are mutually exclusive.
- Single task: `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`
- Contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine.

`--next`: chain-to-completion with
propagation. `routing-table.md` row A1 dispatches `/sp:dev-refine <wbs> --auto --next` so a
backlog/todo task chains refine → run → verify without per-step re-invocation. **was: `--next` declared but never defined.**
