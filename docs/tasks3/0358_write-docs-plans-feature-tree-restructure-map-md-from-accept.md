---
template: feature-impl
schema_version: 1
name: "Write docs/plans/feature-tree-restructure-map.md from accepted audit"
description: ""
status: done
type: task
profile: standard
feature_id: F31
parent_wbs: null
priority: P0
tags: ["wayfinder:task", "wayfinder"]
dependencies: ["0356"]
created_at: "2026-07-28T00:01:58.219Z"
updated_at: "2026-07-28T00:19:18.026Z"
---

## 0358. Write docs/plans/feature-tree-restructure-map.md from accepted audit

### Background

wayfinder:task — Dogfood must not re-scan the tree. Mapping file is the SSOT for old→new dispositions.

### Requirements
R1. Create docs/plans/feature-tree-restructure-map.md with columns/schema: old_id, new_id_or_parent, disposition, rationale, task_edge_notes, docs_root_refs_known.
R2. Populate from the audit ticket outcome.
R3. Include changing nodes and a completeness section so every root is accounted for.
R4. No live feature moves in this ticket.
### Acceptance Criteria
```gherkin
Feature: Restructure mapping file

  Scenario: R1 — Mapping file exists at docs/plans path
    Given audit 0356 is done
    When the mapping artifact is written
    Then docs/plans/feature-tree-restructure-map.md exists with schema and all roots A–R

  Scenario: R2 — Dogfood can apply without re-scan
    Given the mapping file
    When /sp:dev-featurechange reads the default path
    Then dispositions for keep and reparent nodes are listed without requiring a full tree audit
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Created docs/plans/feature-tree-restructure-map.md:1 with schema, full A–R inventory, rejected merges, apply waves, and non-root keep notes (F31, F81, …).

Source audit: docs/tasks3/0356_audit-feature-roots-a-r-evidence-backed-merge-reparent-keep-.md Solution.  
Hierarchy rules: plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md.

expected_new_id left as dry-run placeholders — real IDs come from `spur feature move --dry-run` at apply time (digit allocation).
### Testing
- File exists: docs/plans/feature-tree-restructure-map.md
- Counted 18 root rows A–R + F31 keep note
- Coverage: N/A (planning artifact)
### Review
| Sev | Finding | Disposition |
| --- | --- | --- |
| P3 | expected_new_id not fixed until dry-run | By design |
| P3 | P/Q/R remain M confidence | Documented in map |

Final disposition: **PASS**
### References

S

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-28T00:19:09.909Z todo → wip (system)
- 2026-07-28T00:19:16.573Z wip → testing (system)
- 2026-07-28T00:19:18.026Z testing → done (system)
