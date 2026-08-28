---
schema_version: 1
name: "Route the inline pipeline driver and spur-cli reference to the todo projection"
status: todo
template: feature-impl
created_at: 2026-08-27T23:57:38.341Z
updated_at: "2026-08-27T23:57:55.458Z"
feature_id: D7
priority: P2
tags: ["workflow", "docs", "plugin-surface"]
dependencies: ["0695"]
---

## 0696. Route the inline pipeline driver and spur-cli reference to the todo projection

### Background

The point of the todo projection is to retire a hand-parsing instruction. plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md § Run setup step 4 (task 0596) currently tells the driver to render a two-layer plan whose "source of truth is the YAML parsed in step 1 plus the dry-run walk" — that is, the agent parses task-pipeline.yaml itself every run. Once `spur workflow show --format todo --json` exists, layer 1 comes from one deterministic call and the prose can be replaced.

This task covers feature D7 scenario R6. It is deliberately separated from the renderer task because it edits shipped plugin surfaces rather than product code, and because it cannot be written until the CLI contract it names is real. The docs/04_DESIGN.md sync stays with the code task (T3 requires surface code and design doc in one commit); only the plugin-facing references move here.

### Requirements

R1. Replace the hand-parsing prose in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` § Run setup step 4 so the driver obtains layer 1 from `spur workflow show <file> --format todo --json`, and remove the instruction to copy or hand-derive the state list. Layer 2 (the active state's `onEnter` actions) and the stage-boundary refresh cadence are unchanged.

R2. Update the `sp:spur-cli` workflows reference (`plugins/sp/skills/spur-cli/references/workflows.md`) `show` row so its documented input lists `--format <mermaid|todo>` and `--json`, keeping the reference at parity with the shipped CLI.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
