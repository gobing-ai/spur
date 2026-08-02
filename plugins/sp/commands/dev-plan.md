---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create (Design by default)
argument-hint: "\"<description>\" [[`--feature`](../skills/spur-dev/references/flag-glossary.md#flag-feature) <id>] [--parent <feature-id>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [--skip-design] [[`--auto`](../skills/spur-dev/references/flag-glossary.md#flag-auto)] [--approve-taste]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill.

## Usage

```
/sp:dev-plan "<description>"
  [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--inline|--subprocess]
  [--auto]              # skip objective HITL where the plan path supports it
  [--skip-design]       # design package off (satellite + task Design)
  [--approve-taste]     # with --auto: skip design-approval taste pause when applicable
```

**Design package (unified with `/sp:dev-idea`):** Design is **on by default**. Default fills
per-task `### Design` in the batch and the feature satellite when the seam heuristic fires
(ties lean **design**). There is **no** `--design` force flag — only **[`--skip-design`](../skills/spur-dev/references/flag-glossary.md#flag-skip-design)** opts out.

**Taste re-entry:** [`--approve-taste`](../skills/spur-dev/references/flag-glossary.md#flag-approve-taste) is the same flag as on `dev-idea` (sets prior design approval
for taste gates). Alias: `--design-approved` (prefer `--approve-taste`).

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")`
- Full Design package + batch `design` field contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § plan and `planning-workflow.md` Step 5.5.
