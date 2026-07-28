---
template: meta
schema_version: 1
name: "Author hierarchy design reference for balanced feature trees"
description: ""
status: done
type: meta
profile: standard
feature_id: F31
parent_wbs: null
priority: P1
tags: ["wayfinder:prototype", "wayfinder"]
dependencies: ["0356"]
created_at: "2026-07-28T00:01:58.212Z"
updated_at: "2026-07-28T00:18:14.725Z"
---

## 0357. Author hierarchy design reference for balanced feature trees

### Background

wayfinder:prototype — Need a skill-consumable reference so future planning builds neat trees (depth, grouping, merge vs reparent, anti-patterns). Should cite Spur examples from the audit.

### Requirements
R1. Choose owner location (sp:spur-cli features reference vs sp:spur-dev product planning) and justify in Solution.
R2. Cover: root vs child rules; max useful depth; group tags vs real parents; merge vs reparent vs rename; done/cancelled roots; anti-patterns.
R3. Include positive examples from audit (e.g. F8/F81) and rejected false merges.
R4. Deliver a markdown reference path ready for plugin install.
### Acceptance Criteria
```gherkin
Feature: Hierarchy design reference

  Scenario: R1 — Skill-owned reference exists
    Given agents plan features via sp:spur-cli
    When they load features/hierarchy-mece.md
    Then MECE, root gate, create/extend, and reparent vs merge rules are present

  Scenario: R2 — Audit examples are cited
    Given audit 0356 dispositions
    When the reference examples section is read
    Then B vs H reject-merge and J/K/L reparent guidance appear with Spur ids
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
Owner location: **sp:spur-cli** reference `plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md` (not a second copy under spur-dev). Linked from features.md and roadmap-priority.md.

Refined after audit 0356:

- Expanded positive/negative examples with B∪H reject, K/L→J, N/O→H, P→D, Q/R→F, G vs M keep, F31 under F3, I historical keep.
- Added **Audit 0356 snapshot** table of keep vs reparent dispositions.
- Citations: hierarchy-mece.md examples section; B/H Goals at docs/features/B_agent-execution.md:14 and H_agent-integration.md:14; audit task docs/tasks3/0356_audit-feature-roots-a-r-evidence-backed-merge-reparent-keep-.md Solution.

No second SSOT invented — 0357 refines the seeded hierarchy-mece file.
### Testing
- Verified file exists: plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md
- Verified links from plugins/sp/skills/spur-cli/references/features.md (hierarchy-mece row + create guidance).
- Coverage: N/A (docs/meta skill reference).
### Review
| Sev | Finding | Disposition |
| --- | --- | --- |
| P4 | spur-dev product-planning could one-line-link hierarchy-mece later | Defer optional cross-link |

Final disposition: **PASS**
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-07-28T00:17:31.223Z todo → wip (system)
- 2026-07-28T00:18:13.286Z wip → testing (system)
- 2026-07-28T00:18:14.725Z testing → done (system)
