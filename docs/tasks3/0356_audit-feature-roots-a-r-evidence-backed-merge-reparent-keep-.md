---
template: meta
schema_version: 1
name: "Audit feature roots A–R: evidence-backed merge/reparent/keep dispositions"
description: ""
status: done
type: meta
profile: standard
feature_id: F31
parent_wbs: null
priority: P0
tags: ["wayfinder:research", "wayfinder"]
dependencies: []
created_at: "2026-07-28T00:01:58.199Z"
updated_at: "2026-07-28T00:15:52.992Z"
---

## 0356. Audit feature roots A–R: evidence-backed merge/reparent/keep dispositions

### Background

wayfinder:research — Operator suspects redundant roots (e.g. B∪H, J∪K). Feature S Notes flag B/H as likely false merge (agent runner vs plugins/sp) and J/K/L as plausible reparent under the observability board. Need a full evidence pass over Goal/Scope/tasks/docs references before any rewrite.

### Requirements
R1. For every top-level feature id A–R (leave S as map alone): record id, name, status, child count, linked task count, one-line Goal gist.
R2. Assign disposition keep | reparent-under:<id> | merge-into:<id> | rename-only | archive with evidence (path + section) and confidence.
R3. Explicitly accept or reject B∪H and J∪K(+L) with written reasons.
R4. Output a single markdown table artifact suitable to seed docs/plans/feature-tree-restructure-map.md.
R5. Do not apply any tree changes.
### Acceptance Criteria
```gherkin
Feature: Root feature tree audit

  Scenario: R1 — Every root A–R has a disposition row
    Given features A–R exist in docs/features
    When the audit Solution is written
    Then each root has disposition keep|reparent-under|merge-into|rename-only|archive with evidence and confidence

  Scenario: R2 — B∪H and J∪K hypotheses are explicitly ruled
    Given operator hypotheses B merge H and J merge K
    When the audit is complete
    Then B∪H is accepted or rejected with Goal evidence
    And J∪K is accepted or rejected with Goal evidence

  Scenario: R3 — No tree mutations
    Given the audit ticket is research-only
    When the ticket is closed
    Then no spur feature move was applied for A–R restructure candidates
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
Research audit complete (2026-07-28). **No tree mutations.** Method: Goals from docs/features/{A–R}_*.md, children from INDEX, task rollup by feature_id across docs/tasks{,2,3}, hierarchy-mece rules (see plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md:53).

**Legend:** keep | reparent-under:X | merge-into:X | rename-only | archive. Confidence H/M/L.

**Hypothesis rulings (R3)**

| Hypothesis | Ruling | Reason | Evidence |
| --- | --- | --- | --- |
| Merge B ∪ H | **REJECT** | B = spur agent runner; H = plugins/sp Fat Skills. Name overlap only. | docs/features/B_agent-execution.md:14; docs/features/H_agent-integration.md:14 |
| Merge J ∪ K (+ L) | **REJECT merge; ACCEPT reparent** | K/L are System Events tab slices of board module J — reparent under J. | docs/features/J_observabilities-board-module.md:14; docs/features/K_observability-system-events-table-redesign.md:14; docs/features/L_system-events-payload-and-wiring-enrichment.md:14 |

**Disposition table (seed for docs/plans/feature-tree-restructure-map.md)**

| id | name | status | children | tasks (subtree) | Goal gist | disposition | conf | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Foundation | active | 2 | 8 | Platform bootstrap/config/persistence | **keep** | H | docs/features/A_foundation.md Goal; INDEX A children |
| B | Agent execution | active | 2 | 10 | spur agent LLM execution surface | **keep** | H | docs/features/B_agent-execution.md:14 |
| C | Rules | active | 0 | 0 | spur rule constraints | **keep** | H | docs/features/C_rules.md Goal |
| D | Workflows | active | 0 | 1 | spur workflow orchestration | **keep** | H | docs/features/D_workflows.md Goal |
| E | History | active | 0 | 0 | spur history import/analytics | **keep** | H | docs/features/E_history.md Goal |
| F | Planning | active | 8+ | 42 | task/feature planning SSOT | **keep** | H | docs/features/F_planning.md Goal; F31 under F3 already |
| G | Collaboration | active | 3 | 11 | message + team multi-agent CLI | **keep** | H | docs/features/G_collaboration.md Goal |
| H | Agent integration | active | 3 | 29 | plugins/sp skills/commands/hooks | **keep** | H | docs/features/H_agent-integration.md:14 |
| I | sp plugin hands-off ready | done | 0 | 9 | Hands-off sp dev loop | **keep** | M | docs/features/I_sp-plugin-hands-off-ready.md Goal |
| J | Observabilities board module | active | 0 | 12 | Board System Events + Inbox | **keep** | H | docs/features/J_observabilities-board-module.md:14; INDEX:~33 |
| K | Observability System Events Table Redesign | done | 0 | 4 | System Events tab dense table | **reparent-under:J** | H | docs/features/K_observability-system-events-table-redesign.md:14 |
| L | System Events Payload and Wiring Enrichment | verifying | 0 | 6 | Enrich System Events diagnostics | **reparent-under:J** | H | docs/features/L_system-events-payload-and-wiring-enrichment.md:14 |
| M | Teams board + declarative teams | active | 3 | 20 | Teams board over existing backbones | **keep** | H | docs/features/M_teams-*.md Goal; not merge with G |
| N | sp plugin next-layer UX | verifying | 0 | 12 | /sp:dev-next + dogfood | **reparent-under:H** | H | docs/features/N_sp-plugin-next-layer-ux-*.md Goal |
| O | sp plugin token-efficient architecture | verifying | 0 | 27 | Token-efficient sp architecture | **reparent-under:H** | H | docs/features/O_sp-plugin-token-efficient-*.md Goal |
| P | workflow run observability | verifying | 0 | 2 | spur workflow run observability design | **reparent-under:D** | M | docs/features/P_workflow-run-observability-*.md Goal |
| Q | AC-verifiable execution + gates | done | 0 | 2 | AC BDD scaffolds + tunable gates | **reparent-under:F** | M | docs/features/Q_ac-verifiable-execution-*.md Goal |
| R | Feature status feedback loop | active | 2 | 17 | Task→feature status + Board visibility | **reparent-under:F** | M | docs/features/R_feature-status-feedback-loop-*.md Goal |

**Counts:** keep 11 (A B C D E F G H I J M) · reparent 7 (K L N O P Q R) · merge-into none.

**Suggested later apply order (not executed):** (1) K,L→J (2) N,O→H (3) P→D, Q→F, R→F.

**Out of ticket:** mapping → 0358; hierarchy-mece examples → 0357; command → 0359.
### Testing
Research verification:

- Commands: `spur feature list --json`; Goal extraction script over docs/features; feature_id rollup over docs/tasks{,2,3}.
- Coverage: N/A (research meta — 18/18 roots A–R dispositioned; no production code change).
- Outcomes: R1–R5 satisfied in Solution; wip→testing gate cleared via real AC + file:line citations.
### Review
| Sev | Finding | Disposition |
| --- | --- | --- |
| P3 | Task subtree counts are approximate (feature_id string prefix rules; multi-folder corpus). | Accept for audit; 0358 may re-count per-id exactly. |
| P3 | R→F and P→D are M confidence — operator may prefer R under F8 or P under J. | Confirm at mapping (0358) HITL if needed. |
| P4 | I left as done root rather than reparent-under:H. | Optional neatness only. |

Residual risk: low — research-only, no apply.
Final disposition: **PASS** for R1–R5.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-07-28T00:13:37.217Z todo → wip (system)
- 2026-07-28T00:15:41.412Z wip → testing (system)
- 2026-07-28T00:15:52.992Z testing → done (system)
