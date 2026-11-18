---
description: Deprecated one-release redirect — use `/sp:dev-refine --all`
requires: [cli:spur, local-fs]
role: planner
argument-hint: "--feature <id> | --tasks <selector> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--keep-going] [--status <s>] [--json] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# dev-refineall (deprecated redirect)

**Deprecated (task 1390, feature H84).** A batch is a **scope**, not a different operation:
`/sp:dev-refine --all` is the authoritative surface, and the `sp:spur-dev` operation (`refineall`) it
dispatches is unchanged.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--feature` `<id>` | Refine all tasks in a feature. | required (one of `--feature` / `--tasks`) |
| `--tasks` `<selector>` | Task selector to refine (alternative to `--feature`). | required (one of `--feature` / `--tasks`) |
| `--focus` `<mode>` | Gap-analysis focus: `all\|requirements\|background\|constraints\|acceptance\|quick`. | `all` |
| `--description` `<text>` | Operator framing injected into each task's Q&A/synthesis. | omitted |
| `--depth` `<standard\|ready>` | Spec depth bar (see flag glossary). | `standard` |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing refinement. | omit |
| `--auto` | Skip objective HITL gates. | off |
| `--keep-going` | Continue past per-task failures. | off |
| `--status` `<s>` | Only refine tasks in these statuses (applied in-agent to the frozen set). | `backlog` + `todo` |
| `--json` | Emit structured JSON. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-refine --all <forwarded arguments>
```

## Implementation

- Dispatch `Skill(skill="sp:spur-dev", args="refineall <forwarded flags>")`; its inner per-task leg is `refine`.
- The workflow YAML and the operation name are unchanged; only the command surface moved.
