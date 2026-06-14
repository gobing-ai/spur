---
name: "W3: sp:spur-dev umbrella skill — planning and execution halves"
description: "W3: sp:spur-dev umbrella skill — planning and execution halves"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: H1
priority: P0
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0064. "W3: sp:spur-dev umbrella skill — planning and execution halves"

### Background

Design §12.1/12.2, ADR-023 Fat Skills, C01–C03. Every LLM output CLI-gated (feature check + task-batch schema).


### Requirements

R1. Planning half: intake → feature create → AC generation → feature check gate loop → decomposition → batch-create gate.
R2. Execution half: task selection → workflow run task-pipeline → HITL surfacing → continue.
R3. Skill = how-to-think; CLI = what-is-valid; no validation logic in prompts.
R4. Two-halves seam documented as the future split point (risk R4).


### Q&A



### Design

Authority: design §12.1 (the two-halves contract — planning: intake → feature create → AC generation →
feature check gate loop → decomposition → batch-create gate; execution: pick task → workflow run
task-pipeline → HITL surfacing → continue), §12.2 (the two machine gates make LLM regressions unable to
corrupt the corpus), ADR-023 Fat Skills (skill = how-to-think; CLI = what-is-valid; no validation logic
in prompts). Risk R4: the two-halves seam is the sanctioned future split point — keep it visible in the
skill's structure.


### Solution

1. `plugins/sp/skills/spur-dev/SKILL.md` + `references/` (planning-half prompts: intake questions, AC
   style guide referencing R-numbering and the two AC tiers, decomposition heuristics; execution-half
   runbook).
2. Every write step in the skill text is a CLI invocation with its gate loop spelled out (feature check
   findings → revise → re-check; batch schema findings → fix JSON → retry).
3. Structure the SKILL.md with explicit `## Planning half` / `## Execution half` top sections (the R4
   seam).
4. Verification: a recorded end-to-end transcript (vague description → feature + tasks on a temp
   project → pipeline run) attached to this task's `## Testing`; review confirms zero validation logic in
   prompts. Gate: works against W1/W2 verbs.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


