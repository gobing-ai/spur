---
name: "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"
description: "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: H3
priority: P2
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0069. "W3: Prompt-skill moves — brainstorm, anti-hallucination, daily-summary"

### Background

Delivery doc §7.2 dispositions. brainstorm: move + plan scenario-command set; anti-hallucination: move-only; daily-summary: verify+enhance before adoption (script stays embedded).


### Requirements

R1. sp:brainstorm moved; scenario-specific command candidates listed for Stage-later.
R2. sp:anti-hallucination moved verbatim.
R3. sp:daily-summary verified working, enhanced, then adopted; no CLI extraction.


### Q&A



### Design

Authority: delivery doc §7.2 dispositions — `sp:brainstorm`: move + record scenario-specific command
candidates for later (today's skill too generic); `sp:anti-hallucination`: move verbatim (K05 — stays a
skill forever); `sp:daily-summary`: verify-and-enhance **before** adoption, script stays embedded (I16 —
no CLI extraction). Source skills live in `cc-agents/plugins/rd3/skills/`. Removal side is cc-agents
task 0406, gated on this landing.


### Solution

1. Move skill directories into `plugins/sp/skills/` with frontmatter renamed to the sp: namespace;
   adjust any rd3-internal references.
2. `sp:daily-summary`: run it end-to-end, fix what verification finds, document usage; only then mark
   adopted.
3. `sp:brainstorm`: record the scenario-command candidate list (from operator usage patterns) in the
   skill's notes for a later batch — no commands shipped now.
4. Gate: all three invocable from this repo; daily-summary verification transcript in `## Testing`;
   cc-agents 0406 unblocked (note added there).


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


