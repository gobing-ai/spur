---
schema_version: 1
name: Sync authority documents with the agent.fleet surface
status: todo
template: feature-impl
created_at: 2026-09-15T05:26:45.220Z
updated_at: "2026-09-15T05:33:08.224Z"
feature_id: G65
priority: P2
tags:
  - g65
  - docs

dependencies: ["0859", "0860"]
---

## 0861. Sync authority documents with the agent.fleet surface

### Background

Covers G65 scenario R7 (design §8).

Tasks 0856-0860 update the satellites their surfaces own in the same commit. This task records the architectural decision and sweeps cross-document residue:

- ADR-116 (`docs/00_ADR.md:1698`) still names `.spur/fleet.json` as the carrier and says the Projects module owns "Conversation, Agents, and Work" (`:1701-1703`), although the Work tab was dropped on 2026-09-14.
- ADR-086's roster-layer amendment (`docs/00_ADR.md:1157-1174`) still describes `agent.team` autostart as live; its 2026-09-14 note defers the key removal to this feature.
- `docs/03_ARCHITECTURE.md:560,562`, `docs/01_PRD.md:98`, `docs/design/project-switcher.md` (§5, the CLI table), `docs/design/spur-team-mode-design.md`, `docs/design/workspace-design.md` and plugin references may still name the retired carriers.

### Requirements

- **R1** — Append the dated ADR-116 amendment (text in `docs/design/fleet-config-declaration.md` §8, plus one sentence that the Projects module tabs are Conversation / Agents / Processes since the Work tab was dropped on 2026-09-14) and a dated note under ADR-086's roster-layer amendment that the `agent.team` key is removed. Existing ADR text is not rewritten; `apps/cli/tests/adr-supersession.test.ts` stays green.
- **R2** — Bring `docs/03_ARCHITECTURE.md`, `docs/01_PRD.md`, `docs/design/project-switcher.md`, the supersession banners of `spur-team-mode-design.md` and `workspace-design.md`, `docs/help*` and `plugins/sp/skills/spur-cli/references/*.md` in line with `agent.fleet` as the only declaration.
- **R3** — Flip `docs/design/fleet-config-declaration.md` from Proposed to Accepted, including its `docs/04_DESIGN.md` index row.
- **R4** — Residual sweep: `rg -n "fleet\.json|agent\.team|/api/team|TeamService|SPUR_TEAM_"` over `docs/` (excluding `plans/`, `reports/`, `tasks*/`, `features/`), `plugins/sp`, `config/` and `AGENTS.md` leaves only dated historical notes; record any intentional survivor with its reason in this task's Solution.

### Acceptance Criteria

- **AC1 — The decision is recorded without rewriting history (R1).** Given `docs/00_ADR.md`, when this task's diff is inspected, then it only adds the dated ADR-116 amendment and the dated roster note, and prior ADR text is unchanged.
- **AC2 — Owner documents name only agent.fleet (R2, R3, R4).** Given the repo, when the R4 sweep runs, then every remaining hit is a dated historical note or a survivor listed with its reason in Solution, the design satellite is Accepted, and `bun run spur-check` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:35.751Z

**Decisions**

- **The ADR amendment lands last.** After 0858-0860 ship, so the decision record never describes an unshipped surface.
- **The Work-tab correction rides the ADR-116 amendment.** The decision body at `:1703` is history; amendments are the only legal edit.
- **The roster note goes under ADR-086**, whose 2026-09-14 note (`:1173-1174`) explicitly defers the `agent.team` removal to this feature. (The batch draft pointed at ADR-042/052; the roster amendment is ADR-086's.)
- **Survivors are listed, not hidden.** Any sweep hit kept on purpose is recorded with its reason in Solution; historical plans, reports and corpus are never edited.

**Premises (verified 2026-09-14)**

- `docs/00_ADR.md:1698` ADR-116 heading; `:1701-1703` names `.spur/fleet.json` and "Conversation, Agents, and Work".
- `docs/00_ADR.md:1129` ADR-086; roster-layer amendment `:1157-1174` still calls `agent.team` autostart live.
- `docs/03_ARCHITECTURE.md:560` (`fleet.json`), `:562` (`agent.team.<teamId>`); `docs/01_PRD.md:98` (`.spur/fleet.json` fleet).
- `apps/cli/tests/adr-supersession.test.ts` pins ADR-042/052/116 supersession and amendment strings (e.g. `:98`), so additions must not alter existing lines.

**Dependencies:** 0859 and 0860 (the amendment and sweep document both shipped surfaces).

### Design

Documentation governance per `docs/99_PROJECT_CONSTITUTION.md`: ADRs take dated amendments only, satellites are corrected in place, historical plans/reports/corpus are never edited. `sp:doc-evolve` is the route for drift checks. The ADR amendment lands after the code (tasks 3-5) so the decision record never describes an unshipped surface.

### Plan

1. Run the R4 sweep to build the edit list.
2. Append the ADR amendment and the dated roster note.
3. Update architecture, PRD, satellites, banners, help and plugin references.
4. Flip the design status and index row.
5. Re-run the sweep; `bun run spur-check` (doc parity tests).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History
