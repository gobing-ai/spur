---
template: feature-impl
schema_version: 1
name: "Workspace design: ADR + design doc (data model, config, API, board tabs)"
description: ""
status: todo
type: task
profile: standard
feature_id: G3
parent_wbs: null
priority: P2
tags: [approach-c,design,collaboration]
dependencies: []
created_at: 2026-07-03T23:35:28.259Z
updated_at: 2026-07-03T23:44:13.181Z
---

## 0196. Workspace design: ADR + design doc (data model, config, API, board tabs)

### Background

Cycle position P7a (decision D3: Workspace is the capstone, design-first — docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). A Workspace composes a git work-folder, an agent team, and per-agent inboxes into one collaborative unit surfaced as a board module with tabbed views. Its constituents are being built through this cycle (G1 inbox IPC, G2 team supervision, the board module system) — this design task runs EARLY (in parallel with P1/P2 implementation) so those features grow workspace-shaped seams instead of needing rework, while the implementation task stays gated until the design is ratified.

Deliverables are documents, not code: a dated ADR entry in `docs/00_ADR.md` (the binding decision + one-line reason, per the doc-ownership rules in AGENTS.md) and `docs/design/workspace-design.md` (the mechanism detail the ADR points to). The design must resolve at minimum: the workspace data model (name, git folder vs worktree semantics, team roster binding to `.spur/agents` specs, inbox scoping rule), where workspace definitions live (config schema — note the two-schema split in packages/config: env `configSchema` vs project `spurConfigSchema`), lifecycle (create/open/close; single-active-workspace stance for v1), the server API surface, the board module tab set (overview, team processes, inboxes, workspace-scoped tasks), and the isolation rule (workspace-scoped messaging).

Dependencies: none to START (it's a design doc), but it must incorporate the shipped shapes of G1 (message events/API) and G2 (supervisor registry/attach) as they land — schedule its final review after G1's API is merged. The G3 implementation task consumes the approved design.

### Requirements
- [ ] R1 — `docs/design/workspace-design.md`: data model (workspace = name + git folder/worktree + team roster + inbox scoping), config placement decision (which schema owns `workspaces`), lifecycle semantics (v1 single active workspace or justified alternative), server API sketch (nouns/routes/DTO shapes), and the board module tab set with what each tab composes from G1/G2/task modules.
- [ ] R2 — Inbox isolation rule specified precisely: how messages are scoped to a workspace's agent set and what happens for agents in multiple workspaces (or why that is disallowed in v1).
- [ ] R3 — Dated ADR entry in `docs/00_ADR.md` recording the cross-cutting decision (workspace as composition layer; one-line reason) pointing at the design doc — added BEFORE any implementation diverges from current architecture (AGENTS.md ADR rule).
- [ ] R4 — Explicit non-goals section: multi-machine workspaces, permissions, non-git folders, concurrent multi-workspace scheduling (per feature G3 scope).
- [ ] R5 — Seam review: a short section listing what G1/G2/board modules must expose for workspace composition, cross-checked against their shipped shapes; any gap fed back as a scoped follow-up item, not silent scope creep.
- [ ] R6 — Operator review gate: design reviewed and approved by the operator (record approval in this task's Review section); the G3 implementation task stays blocked until then.
### Acceptance Criteria
```gherkin
Feature: Workspace module

  Scenario: Workspace design is ratified before implementation
    Given the workspace design task completes
    When the ADR entry and design doc land
    Then docs/00_ADR.md carries a dated workspace decision pointing at docs/design/workspace-design.md
    And the design doc defines the data model, config schema, server API, and board tab set
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Docs-only task (decision D3: workspace is the capstone, design-first). Produce `docs/design/workspace-design.md` + a dated ADR entry in `docs/00_ADR.md`, run it through operator review, and refresh task 0197's requirements from the ratified design. Runs EARLY (in parallel with 0189/0190 implementation) so inbox (G1), supervision (G2), and board modules grow workspace-shaped seams; FINAL review waits until G1's API shape has merged so the design binds real shapes, not guesses.

**Design doc structure (R1–R5)** — `docs/design/workspace-design.md`:
1. *Data model*: workspace = name + git work-folder (plain folder vs `git worktree` semantics — analyze both, recommend one for v1) + team roster (binding to `.spur/agents` spec ids) + inbox scoping rule.
2. *Config placement*: which schema owns `workspaces` — the env `configSchema` vs project `spurConfigSchema` (`packages/config` has BOTH with disjoint homes; the 2026-06-15 note documents the collision trap). Workspaces are project-shaped data — justify the placement explicitly.
3. *Lifecycle*: create/open/close; v1 single-active-workspace stance (or a justified alternative); what happens to supervised processes and watches on close.
4. *Server API sketch*: nouns, routes, DTO shapes; which parts are oRPC-contract-bound vs module-mounted (follow the precedent split: contracts for the typed seam, Hono mounts for streams).
5. *Board module tab set*: overview, team processes (composes G2's registry/attach), inboxes (composes G1's API/events), workspace-scoped tasks (filter contract against the task module). Per-tab: data source + which existing module surface it reuses.
6. *Isolation rule* (R2): precise scoping — how messages are constrained to the workspace's agent set; multi-workspace agent membership allowed or disallowed in v1 (recommend disallow; justify).
7. *Non-goals* (R4): multi-machine, permissions, non-git folders, concurrent multi-workspace scheduling.
8. *Seam review* (R5): the explicit list of what G1/G2/board must expose for composition, cross-checked against their shipped/planned shapes (0193/0195 Designs); gaps become scoped follow-up items — never silent scope creep into 0197.

**ADR (R3).** One dated entry: the cross-cutting decision (workspace as a composition layer over team + inbox + board, not a new engine) + one-line reason, pointing at the design doc — decision in `00`, mechanism in the design doc, per the doc-ownership rules. Land the ADR BEFORE 0197 starts.

**Process (R6).** Draft → operator review (HITL — record the review outcome and any overrides in this task's Review section) → on approval, update task 0197's Requirements/Design via `spur task update 0197 --section ... --from-file` so the implementation task binds the ratified design.

**Inputs.** `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md` (D3/D4/D5/D6/D7 decisions + feature G3 scope), 0193/0195 Design sections, the module system contract (`docs/help/how_to_add_a_new_ui_module.md`), config two-schema note.

**Decomposition guidance.** Single task; the review gate is a step, not a boundary.

**Dependencies.** None to START. Final review gate: after 0193 (G1 API) merges. Downstream: 0197 is hard-gated on this task's approval.
### Plan
- [ ] Collect inputs: brainstorm decisions, feature G3 scope, 0193/0195 Design sections, module-system contract, config two-schema note.
- [ ] Draft `docs/design/workspace-design.md` §1–§8 per the Design outline (R1, R2, R4, R5).
- [ ] Seam review pass against 0193/0195 shipped/planned shapes; record gaps as scoped follow-ups (R5).
- [ ] Hold final review until 0193's API shape is merged; then operator review (HITL); record outcome + overrides in Review (R6).
- [ ] On approval: dated ADR entry in `docs/00_ADR.md` pointing at the design doc (R3).
- [ ] Refresh task 0197: rewrite its Requirements/Design from the ratified design via `spur task update 0197 --section ... --from-file`; move 0197 out of blocked once G1/G2 are also done (R6).
- [ ] Docs gate: `spur rule run --preset recommended-pre-check` clean on the touched docs; corpus checks green (`spur task check 0196`).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
