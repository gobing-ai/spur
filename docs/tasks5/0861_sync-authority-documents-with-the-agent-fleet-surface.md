---
schema_version: 1
name: Sync authority documents with the agent.fleet surface
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.220Z
updated_at: "2026-09-15T20:35:38.867Z"
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

Graduates G65 feature scenario R7 — the Gherkin
below carries its exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R7 — Authority documents match the shipped fleet surface
      Given ADR-116, the architecture, design satellites, config templates, the JSON schema, and plugin references describe fleet.json and agent.team
      When this feature completes
      Then a dated ADR-116 amendment records agent.fleet without rewriting history
      And every owner document, template, and reference names agent.fleet as the only declaration
```

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

The G65 decision is recorded in the ADR history and every live owner document now describes the shipped `agent.fleet` surface.

| Change | Anchor |
| --- | --- |
| ADR-116 amendment added (dated 2026-09-15, G65) — `agent.fleet` replaces `.spur/fleet.json`, the Projects tabs are Conversation / Agents / Processes, and the renamed runtime vocabulary | `docs/00_ADR.md:1722` |
| ADR-086 roster-layer note added (dated 2026-09-15) — the `agent.team` key is removed and a leftover block fails the load | `docs/00_ADR.md:1176` |
| Accepted-boundary section states `agent.fleet` as the only declaration, with the retired carriers and Board modules gone | `docs/03_ARCHITECTURE.md:560` |
| PRD coordination row names `AgentCoordinationService` | `docs/01_PRD.md:96` |
| PRD fleet row names the `agent.fleet` declaration and the Conversation / Agents / Processes tabs | `docs/01_PRD.md:98` |
| Architecture diagram in the CLI help index declares **and wires** `AgentCoordinationService` — no phantom `TeamSvc` node, renamed node not orphaned | `docs/help/index.md:71`, `docs/help/index.md:94` |
| `projects list --fleet` help names the `agent.fleet` declaration | `docs/help/cmd_projects.md:55` |
| `spur message` help attributes the inbox store to `AgentCoordinationService` | `docs/help/cmd_message.md:4`, `docs/help/cmd_message.md:151` |
| `spur task update --assignee` help names `AgentCoordinationService.assignTask` and the `task.assigned` event | `docs/help/cmd_task.md:118` |
| CLI-contracts declaration sites name the `agent.fleet` members that declare `role` | `docs/design/cli-contracts.md:279` |
| Project-switcher CLI surface table no longer carries the conversion verb (the removed row's neighbours now close the table) | `docs/design/project-switcher.md:158-166` |
| Project-switcher read-surface note names the retired `.spur/fleet.json` as a load failure | `docs/design/project-switcher.md:209` |
| Project-switcher Processes tab names the moved `GET /api/processes` read and the owning-noun lifecycle verbs | `docs/design/project-switcher.md:332` |
| Team-mode supersession banner names the `agent.fleet` carrier | `docs/design/spur-team-mode-design.md:4` |
| Workspace supersession banner names `agent.fleet` as the replacement carrier (R2-named path, previously unexercised) | `docs/design/workspace-design.md:9` |
| Config-loading design names `AgentCoordinationServiceContext` and its constructor | `docs/design/universal-config-loading.md:52` |
| Feature-index section annotated as retired | `docs/05_FEATURES.md:51` |
| Design satellite flipped Proposed → Accepted (with §9's open question resolved) | `docs/design/fleet-config-declaration.md:3` |
| `agent.fleet` index row reads accepted | `docs/04_DESIGN.md:62` |

## R4 sweep — intentional survivors

Lens: `rg -n "fleet\.json|agent\.team|/api/team|TeamService|SPUR_TEAM_"` over `docs/`, `plugins/sp`,
`config/` and `AGENTS.md`, excluding `docs/plans/`, `docs/reports/`, `docs/tasks*/` and
`docs/features/`. `plugins/sp` returns **zero** hits (0856/0857 swept the plugin references). Every
remaining hit is a dated historical note or is listed here. `docs/help/index.md` is not a survivor: its
last retired-name hit (the diagram node label, the lens's only hit in the file) is gone with the rename and
the edge fix below. Total after this change: **68** hits across 15 files.

| Survivor | Hits | Reason |
| --- | --- | --- |
| `docs/00_ADR.md` | 18 | ADR decision history. R1 appends dated amendments; prior text is never rewritten, so the retired names there are the record of the decisions being amended. |
| `docs/design/fleet-config-declaration.md` | 22 | The Accepted G65 migration record: §5/§6 are the rename/delete map for the retired surface and §8 is the ADR amendment text. |
| `docs/design/workspace-design.md`, `docs/design/board-module-boundaries.md` | 8 | Superseded historical design records (G3 / I6) whose bodies are the record of the retired surface — 5 + 3 lens hits, each naming a retired carrier historically. Both carry an ADR-116 supersession banner; the banner dates come from their `updated_at: 2026-09-14` frontmatter, not an inline date. |
| `docs/design/spur-team-mode-design.md` | 0 | R2-named and already swept: this diff rewrote its banner to name `agent.fleet`, so it no longer carries a lens hit. Listed for the R2 path's accounting, not as a survivor. |
| `config/config.global.yaml`, `config/config.example.yaml` | 4 | Name the retired carriers only to state the replacement and the load failure the guard produces — the error text is shipped behavior. |
| `docs/design/configuration-contracts.md`, `docs/design/project-switcher.md`, `docs/03_ARCHITECTURE.md`, `docs/design/cli-contracts.md` | 9 | Dated migration notes ("retired in 0857", "moved by 0858") explaining a shipped load failure or the replacement surface. |
| `docs/inventory/system-events-producer-audit.md` | 2 | Dated task notes (0371 / 0857 / 0860) recording which event rows were retired. |
| `docs/design/harness-surface-governance.md` | 2 | The dated consent-ledger rows (2026-09-12 grant, 2026-09-15 removal) the public-surface rule requires. |
| `docs/04_DESIGN.md` | 1 | Records the 0855 removal of the orphaned `/api/team/:team/up|down` routes. |
| `docs/05_FEATURES.md` | 1 | The feature index's historical section heading, now annotated "retired (G64 / G65)". |
| `docs/prototypes/g6-projects/index.html` | 1 | A static G6 prototype fixture; a historical artifact, not a surface claim. |

#### Residual corrections inside this task's declared scope

- `docs/design/board-module-boundaries.md:9` — the supersession banner claimed the Projects module owns
  Conversation / Agents / **Work**; the Work tab was dropped on 2026-09-14, so the current-state claim now
  reads Conversation / Agents / **Processes**, matching the ADR-116 amendment this task landed.
- `docs/design/fleet-config-declaration.md` — an Accepted record no longer describes the pre-G65 world in the
  present tense (§1 reads as history), §8 is retitled to the landed amendment with the ADR text authoritative
  and the design-time draft named as its source, and §9's approval framing is replaced by the resolution it
  already carried.
- `docs/help/index.md:94` — the CLI-help architecture diagram's edge follows the node renamed at `:71`; the
  mermaid render no longer shows a phantom `TeamSvc` node. No repo checker parses mermaid, so this drift was
  invisible to the gate and is recorded here as such.

## Gates

`bun run spur-check` — see the pipeline `test` gate artifact `.spur/run/0861-test-gate.log`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/00_ADR.md:1722-1732` — dated ADR-116 amendment (2026-09-15 · G65 / tasks 0856–0861) recording `agent.fleet` and the Conversation/Agents/Processes tabs; `:1176-1179` — dated ADR-086 roster note that `agent.team` is removed. Commit `d78ffdaf0` touches `docs/00_ADR.md` with 20 insertions, **0 deletions** (append-only, history not rewritten). `apps/cli/tests/adr-supersession.test.ts` → 7 pass, 0 fail (fresh). |
| R2 | MET | R4 sweep (fresh) over docs/plugins/config/AGENTS.md: `plugins/sp` zero retired-name hits; every docs hit is a dated historical note or a survivor listed in the task Solution's R4 table (`docs/00_ADR.md` history, the Accepted migration record, superseded design records, replacement-narration config comments, the 0855 removal row, the retired feature heading, the static G6 prototype). |
| R3 | MET | `docs/design/fleet-config-declaration.md:3` — `Status: Accepted (2026-09-15)`; `docs/04_DESIGN.md:62` index row reads "feature G65, accepted". |
| R4 | MET | Fresh sweep: remaining hits match the prior Solution's survivor accounting (`config/config.example.yaml:185,201` replacement/error-text narration; `docs/dogfood/2026-09-15-g64-*` dated dogfood report; the survivors above). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — Authority documents match the shipped fleet surface | MET | command | ADR-116 amendment dated and appended (00_ADR.md:1722, 20+/0- in `d78ffdaf0`); owner documents/templates/references name `agent.fleet` as the only declaration (fresh R4 sweep + survivor table); adr-supersession suite 7 pass / 0 fail (fresh). |
| AC1 — The decision is recorded without rewriting history (R1) | MET | command | `git show d78ffdaf0 -- docs/00_ADR.md` → 20 insertions, 0 deletions. |
| AC2 — Owner documents name only agent.fleet (R2, R3, R4) | MET | command | Fresh R4 sweep classified against the Solution survivor table — every hit is dated history or listed with reason; satellite Accepted at `fleet-config-declaration.md:3` + index row `docs/04_DESIGN.md:62`; full `bun run spur-check` evidence captured once batch-wide (see verifyall batch report). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T17:22:23.100Z todo → wip (system)
- 2026-09-15T17:59:47.607Z wip → testing (system)
- 2026-09-15T17:59:49.606Z testing → done (system)

