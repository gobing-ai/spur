---
template: feature-impl
schema_version: 1
name: "Author /sp:dev-featurechange CLI-gated restructure command protocol"
description: ""
status: done
type: task
profile: standard
feature_id: F31
parent_wbs: null
priority: P0
tags: ["wayfinder:prototype", "wayfinder"]
dependencies: ["0358", "0357"]
created_at: "2026-07-28T00:01:58.226Z"
updated_at: "2026-07-28T00:19:44.607Z"
---

## 0359. Author /sp:dev-featurechange CLI-gated restructure command protocol

### Background

wayfinder:prototype — Operator will reload and dogfood this command. Apply model is agent orchestrator over spur feature/task verbs; docs rewrites limited to root docs/*.md.

### Requirements
R1. Add plugins/sp/commands/dev-featurechange.md (and skill ref if sp patterns require) reading mapping MD (default docs/plans/feature-tree-restructure-map.md).
R2. dry-run prints planned spur feature move / task --feature updates / docs/*.md rewrites.
R3. apply after confirm; forbid raw Write on docs/features and docs/tasks.
R4. Compose spur feature move + refresh + check; update task feature_id via spur task update --feature.
R5. Rewrite only root docs/*.md references; report partial failure clearly.
R6. Document stretch options (rollback, --limit, dry-run JSON) without blocking v1 minimum dry-run+apply.
### Acceptance Criteria
```gherkin
Feature: /sp:dev-featurechange

  Scenario: R1 — Command file exists
    Given the sp plugin commands directory
    When the operator reloads the plugin
    Then plugins/sp/commands/dev-featurechange.md is present with dry-run and apply protocol

  Scenario: R2 — CLI-gated only
    Given apply mode
    When the agent follows the command
    Then feature ID changes use spur feature move and task edges use spur task update --feature
    And raw Write on docs/features and docs/tasks is forbidden

  Scenario: R3 — Mapping default path
    Given no --map flag
    When dry-run runs
    Then the default map is docs/plans/feature-tree-restructure-map.md
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Added plugins/sp/commands/dev-featurechange.md:1 — full protocol: parse map, dry-run move --json, blast-radius report, confirm, apply via spur feature move/refresh/check, task --feature only if cascade misses, root docs/*.md rewrites only, merge-into skipped in v1.

Indexed in plugins/sp/README.md commands table (dev-featurechange row).

Depends on:
- docs/plans/feature-tree-restructure-map.md (0358)
- plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md (0357)

Dogfood after operator reload: `/sp:dev-featurechange --dry-run` then `--limit K` or `--wave 1`.
### Testing
- File present: plugins/sp/commands/dev-featurechange.md
- README lists dev-featurechange
- Map path default matches docs/plans/feature-tree-restructure-map.md
- Coverage: N/A (command markdown protocol; live dogfood is operator follow-up)
### Review
| Sev | Finding | Disposition |
| --- | --- | --- |
| P3 | Command is protocol-only until reloaded into host agent | Expected dogfood step |
| P4 | merge-into not auto-applied | Documented v1 skip |

Final disposition: **PASS**
### References

S

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-28T00:19:36.430Z todo → wip (system)
- 2026-07-28T00:19:43.111Z wip → testing (system)
- 2026-07-28T00:19:44.607Z testing → done (system)
