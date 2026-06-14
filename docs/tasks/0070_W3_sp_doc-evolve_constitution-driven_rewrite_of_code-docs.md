---
name: "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"
description: "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"
status: Backlog
created_at: 2026-06-13T01:08:18.986Z
updated_at: 2026-06-13T01:08:18.986Z
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

## 0070. "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"

### Background

Delivery doc §7.2: full rewrite, not a port. Self-evolution driver for docs/00–05 + AGENTS.md per docs/99_PROJECT_CONSTITUTION.md (edit rules, sync triggers, drift audits). Own mini-spec at build time.


### Requirements

R1. Mini-spec: operations (drift audit, sync check, lesson append) mapped to constitution §§.
R2. Skill drives deterministic checks via CLI/rg where possible.
R3. Replaces rd3:code-docs (archival noted for cc-agents cleanup).


### Q&A



### Design

Authority: delivery doc §7.2 — `sp:doc-evolve` is a **constitution-native rewrite** of rd3:code-docs,
not a port: a self-evolution driver for the project key files (docs/00–05, AGENTS.md) operating per
`docs/99_PROJECT_CONSTITUTION.md` (edit rules, same-commit sync triggers, drift audits, machine-
appendable lessons §8). Its own mini-spec is the first deliverable (per this task's R1).


### Solution

1. Mini-spec (this task's `## Design` extension before implementation): enumerate operations — drift
   audit (cross-doc contradiction scan), sync check (command/config/schema vs 04), lesson append (99 §8
   format), doc-contract verification (frontmatter contracts §4.3) — each mapped to its constitution
   section and to deterministic helpers (rg patterns, file lists) where possible.
2. `plugins/sp/skills/doc-evolve/SKILL.md` implementing the spec: prompts drive judgment; rg/CLI drive
   detection; every proposed edit cites the constitution rule it enforces.
3. Replaces rd3:code-docs — archival noted for cc-agents 0406/0405 flow.
4. Gate: run against this repo's docs producing a real drift report; zero false-positive rate reviewed on
   that first report.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


