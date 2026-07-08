---
template: standard
schema_version: 1
name: "enhance the review capability in plugin sp"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-08T18:04:39.507Z"
updated_at: "2026-07-08T18:04:39.509Z"
---

## 0227. enhance the review capability in plugin sp

### Background

Despite we already have the following things in plugin `sp` that provide review capabilities:

- plugins/sp/commands/dev-review.md
- plugins/sp/skills/code-review
- plugins/sp/skills/code-verification

But we still can see there is an obvious gap to have a comprehensive review capability. All currently available review capabilities are more like one step of the task file based spur-dev workflow, instead of a comprehensive review capability.

Meanwhile, you can see the implementation drifting between current one with the original version of the plugin `rd3`:

- ~/projects/cc-agents/plugins/rd3/commands/dev-review.md
- ~/projects/cc-agents/plugins/rd3/agents/super-reviewer.md

Some of these changes are intentionally, but some are unintentional or the real driftings.

Meanwhile, we also collected and downloaded some excellent external repo into folder `vendors` for your reference as shown below:

- [addyosmani's agent-skills](vendors/agent-skills)
- [garrytan's gstack](vendors/gstack)
- [mattpocock's skills](vendors/skills)
- [Superpowers](vendors/Superpowers)

We should refer to the original `rd3` and these external references to figure out a solid implementation plan for the review capability in plugin `sp`.

### Requirements

## Help to evaluate the following proposal first, then based on that, figure out a solid implementation plan for the review capability in plugin `sp`:

- Refer to plugin `rd3` to add new agent skill `plugins/rd3/skills/functional-review`: this will be used to verify the task file based requirements was met or not mainly.
- Enhance the spur-dev workflow to ensure in it's review step, we will act as the real quality gate to review not only the source code implementation but also the architecture and design and functional requirements and etc.
- Enhance the slash command `plugins/sp/commands/dev-review.md` to ensure it can represent the new spur-dev review workflow.
- Add a new subagent `plugins/sp/agents/super-reviewer.md`, which will be responsible for the overall review process and coordinating between the other subagents, it's also the representative agent for the review capability of the new spur-dev workflow. With this new subagent, the original subagent `sp:super-coder` can dedicate its review capability to the new subagent `sp:super-reviewer` and more focus on the other works. It's also a step to iterate current spur-dev workflow as a subagent-driven workflow.
- One more thing with the updating of the `Review` section in the task file, we should improve it to align with the new review capability. Particularly, we should add back the `Verdict` sentence exactly to with a proper icon to show the result more clearly.

Above proposal maybe right, maybe not. You should evaluate it comprehensively before making a decision. Then refer to these external resources for more context and learnings and absorb them into your decision-making process to make our new review capability stronger and better and more reliable.

### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
