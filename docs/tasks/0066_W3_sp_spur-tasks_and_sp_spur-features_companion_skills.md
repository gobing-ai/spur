---
name: "W3: sp:spur-tasks and sp:spur-features companion skills"
description: "W3: sp:spur-tasks and sp:spur-features companion skills"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: H2
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0066. "W3: sp:spur-tasks and sp:spur-features companion skills"

### Background

Design §12.3, F01. Reference companions: verb usage, conventions, check-before-write discipline. They document; sp:spur-dev acts.


### Requirements

R1. sp:spur-tasks: verb guide, section-editing workflow, matrix querying via check --json.
R2. sp:spur-features: authoring, AC conventions (R-numbering → scenarios), traceability habits.
R3. No pipeline logic in companions.


### Q&A



### Design

Authority: design §12.3 (companions document, `sp:spur-dev` acts — reference skills for verb usage,
conventions, check-before-write discipline; **no pipeline logic**), F01, delivery doc §7.1. Existing
style precedent: `plugins/sp/skills/spur-rules`, `spur-workflows`.


### Solution

1. `plugins/sp/skills/spur-tasks/SKILL.md`: verb guide (incl. the two hot paths), section-editing
   workflow, querying the matrix via `spur task check <wbs> --json` (zero-token matrix access),
   R-numbering convention, status vocabulary + lifecycle expectations.
2. `plugins/sp/skills/spur-features/SKILL.md`: authoring guide (Goal/Scope/AC tiers), hierarchical ID
   semantics (groups, depth, ≤9), traceability habits (feature_id edges, scenario-title mapping),
   one-active-goal discipline.
3. Both delegate every action to CLI verbs; cross-reference sp:spur-dev for pipeline work rather than
   duplicating it.
4. Gate: review against the design's DD-08/DD-14 vocabulary for drift; trigger descriptions follow the
   existing sp skill frontmatter style.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


