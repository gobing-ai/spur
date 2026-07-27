---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (Design by default)
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--skip-design] [--auto] [--design-approved]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Usage

```
/sp:dev-plan "<description>" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--skip-design] [--auto] [--design-approved]
```

Design package (unified): default fills per-task `### Design` in the batch and the feature satellite
when the seam heuristic fires. `--design` forces the satellite on (task Design still default-on).
`--skip-design` skips the satellite **and** leaves task Design blank — refine is the fallback.

## Implementation

- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`
- Full Design package + batch `design` field contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § plan and `planning-workflow.md` Step 5.5.
