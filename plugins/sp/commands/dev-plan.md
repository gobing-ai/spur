---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (Design by default)
role: planner
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--skip-design] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<description>"` | Feature description to plan. | required |
| `--feature` `<id>` | Attach to an existing feature. | omitted |
| `--parent` `<feature-id>` | Create under a parent feature. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing planning. Omission and `inline` drive `idea-pipeline.yaml` in this session with zero external agent/workflow processes; `auto` tier-resolves an executor and a name pins one, both through the async workflow worker. | inline |
| `--skip-design` | Omit the system-design hop. | off |
| `--auto` | Accept the pipeline's recommendation at every operator gate (same gate table as `/sp:dev-idea`). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-plan "<description>"
  [--feature <id>] [--parent <feature-id>]
  [--skip-design]                # design package off (satellite + task Design)
  [--agent <inline|auto|name>]
  [--auto]                       # no operator pauses; follow each gate's recommendation
```

**Design package (unified with `/sp:dev-idea`):** Design is **on by default**. Default fills
per-task `### Design` in the batch and the feature satellite when the seam heuristic fires
(ties lean **design**). There is **no** `--design` force flag — only **`--skip-design`** opts out.

**Removed flags:** `--approve-taste` and `--design-approved` are folded into `--auto` (same
contract as `/sp:dev-idea`). If passed, ignore them with a one-line notice.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Omitted/`inline`: drive `idea-pipeline.yaml` through the [inline pipeline driver](../skills/spur-dev/references/inline-pipeline-driver.md). Do not launch `spur workflow run`, `spur agent run`, or a native subagent unless the operator explicitly requests delegation.
- `auto`/name: launch `spur workflow run idea-pipeline.yaml --async`, observe with one `workflow trace --follow`, and only report cancellation as stopped when `workflow cancel --json` returns `killed: true`.
- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`
- Full Design package + batch `design` field contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § plan and `planning-workflow.md` Step 5.5.
