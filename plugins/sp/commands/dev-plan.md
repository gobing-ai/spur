---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (Design by default)
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--agent <inline|auto|name>] [--skip-design] [--auto] [--approve-taste]"
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
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing planning. `inline` applies to hops this session runs; the pipeline's `agent.run` stages always dispatch and fall back to `agent.default`. | inline |
| `--skip-design` | Omit the system-design hop. | off |
| `--auto` | Skip objective HITL gates. | off |
| `--approve-taste` | With --auto: skip design-approval pause. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-plan "<description>"
  [--feature <id>] [--parent <feature-id>] [--agent <inline|auto|name>]
  [--auto]              # skip objective HITL where the plan path supports it
  [--skip-design]       # design package off (satellite + task Design)
  [--approve-taste]     # with --auto: skip design-approval taste pause when applicable
```

**Design package (unified with `/sp:dev-idea`):** Design is **on by default**. Default fills
per-task `### Design` in the batch and the feature satellite when the seam heuristic fires
(ties lean **design**). There is **no** `--design` force flag — only **`--skip-design`** opts out.

**Taste re-entry:** `--approve-taste` is the same flag as on `dev-idea` (sets prior design approval
for taste gates). Alias: `--design-approved` (prefer `--approve-taste`).

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`
- Full Design package + batch `design` field contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § plan and `planning-workflow.md` Step 5.5.
