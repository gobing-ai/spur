---
schema_version: 1
name: Sync authority documents with the agent.fleet surface
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.220Z
updated_at: "2026-09-15T17:59:49.606Z"
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
the edge fix below. Total after this change: **68** hits across 14 files.

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
| R1 | MET | `git diff -U0 HEAD -- docs/00_ADR.md` returns exactly two husks-free addition hunks and zero deleted lines: `@@ -1175,0 +1176,8 @@` (dated `2026-09-15 · G65 / task 0861` note under ADR-086's roster-layer amendment stating the `agent.team` key is removed and a leftover block fails the load) and `@@ -1712,0 +1721,12 @@` (dated `2026-09-15 · G65 / tasks 0856–0861` ADR-116 amendment recording `agent.fleet`, the retired carriers, and the sentence that the Projects tabs are Conversation / Agents / Processes since the Work tab was dropped on 2026-09-14). `cd apps/cli && bun test tests/adr-supersession.test.ts` → 7 pass / 0 fail, including "(e) a working diff of 00_ADR.md deletes only the amended ADRs' status lines". |
| R2 | MET | Each R2-named owner now carries the shipped surface: `docs/03_ARCHITECTURE.md:560-564` §14.3 "Accepted boundary (ADR-116)" — "`agent.fleet` is the only declaration — the retired `agent.team` block and `.spur/fleet.json` carrier, the three retired Board modules, and their routes are gone"; `docs/01_PRD.md:96` names `AgentCoordinationService`, `:98` names the `agent.fleet` declaration plus the Conversation / Agents / Processes tabs; `docs/design/project-switcher.md` (11 `agent.fleet` mentions; `:108` contrasts the live `/api/project/fleet` read with the retired `GET /api/team/teams`; `:209` states the leftover `fleet.json` load failure); supersession banners at `docs/design/spur-team-mode-design.md:4` and `docs/design/workspace-design.md:9` name `agent.fleet` as the replacement; `docs/help/cmd_projects.md:55` names the declaration; `rg -n "fleet\.json |
| R3 | MET | `docs/design/fleet-config-declaration.md:3` reads `**Status:** Accepted (2026-09-15)` and its Supersedes line now points at the shipped `project-switcher.md §3.1 (shipped 2026-09-15, task 0858)`; the index row `docs/04_DESIGN.md:62` reads `Fleet declaration in spur config — \`agent.fleet\` (feature G65, accepted)`. |
| R4 | MET | Re-ran the lens myself over `docs/` (minus `plans/`, `reports/`, `tasks*/`, `features/`), `plugins/sp`, `config/` and `AGENTS.md`: 68 hits, and every per-file count matches the Solution survivor table row for row — `fleet-config-declaration.md` 22, `00_ADR.md` 18, `workspace-design.md` 5 + `board-module-boundaries.md` 3, `config.global.yaml` + `config.example.yaml` 4, `configuration-contracts.md` 4 + `project-switcher.md` 3 + `03_ARCHITECTURE.md` 1 + `cli-contracts.md` 1, `system-events-producer-audit.md` 2, `harness-surface-governance.md` 2, `04_DESIGN.md` 1, `05_FEATURES.md` 1, `prototypes/g6-projects/index.html` 1. I inspected every non-ADR, non-satellite hit: each is a dated/explanatory note (0857/0858/0860 task references, the shipped guard's own error text, the dated consent-ledger rows, the `retired (G64 / G65)` feature-index heading, the prototype fixture string) and each survivor is listed with its reason in Solution. `plugins/sp` returns zero hits. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Authority documents match the shipped fleet surface | MET | command | `git diff -U0 HEAD -- docs/00_ADR.md` → two addition-only hunks (dated ADR-116 amendment + ADR-086 roster note, 0 deletions); no owner document still presents a retired carrier as live (R4 lens: 68 hits, all dated/explanatory or Solution-listed); `docs/design/fleet-config-declaration.md:3` Accepted; `bun run spur-check` PASS at this revision — `.spur/run/0861-test-gate.status` = PASS, log mtime 10:46:40 ≥ every changed file (max 10:38:15), tail `Ran 8331 tests across 472 files` + `0 fail` + post-check `All 2 rules passed`, digest `sha256:6df3dc8b7de40bcc4e179936df6870bc924a4f202f820adba7a4cb6d7e7f81ea`. |
| **AC1 — The decision is recorded without rewriting history (R1).** Given `docs/00_ADR.md`, when this task's diff is inspected, then it only adds the dated ADR-116 amendment and the dated roster note, and prior ADR text is unchanged. | MET | command | `git diff -U0 HEAD -- docs/00_ADR.md` — both hunks are pure insertions (`@@ -1175,0 +1176,8 @@`, `@@ -1712,0 +1721,12 @@`); no pre-existing ADR line modified or deleted. `cd apps/cli && bun test tests/adr-supersession.test.ts` → 7 pass / 0 fail, including `(e) a working diff of 00_ADR.md deletes only the amended ADRs' status lines`. |
| **AC2 — Owner documents name only agent.fleet (R2, R3, R4).** Given the repo, when the R4 sweep runs, then every remaining hit is a dated historical note or a survivor listed with its reason in Solution, the design satellite is Accepted, and `bun run spur-check` passes. | MET | command | R4 lens re-run as above (68 hits; each dated-historical or a Solution-listed survivor with its reason; `plugins/sp` = 0 hits); design satellite Accepted (`docs/design/fleet-config-declaration.md:3`, index row `docs/04_DESIGN.md:62`); `bun run spur-check` PASS (`.spur/run/0861-test-gate.status` = PASS, 8331 pass / 0 fail). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | gate-pass | — | `.spur/run/0861-test-gate.status` = PASS; log tail `8331 pass` / `0 fail` / post-check rules passed; mtime 10:46:40 ≥ every changed file's mtime (max 10:38:15) |
| P4 | docs-only-diff | — | `git diff --name-only HEAD` = 17 paths, all `docs/**/*.md` — no code, config, schema or plugin path in this change set |
| P4 | predecessor-0858-not-regressed | — | `cd packages/config && bun test tests/loader.test.ts tests/config-schemas.test.ts` → 101 pass / 0 fail (retired-key guard, global-layer `agent.fleet`, `agent.fleet` defaults/validation) |
| P4 | predecessor-0860-not-regressed | — | `cd apps/server && bun test tests/modules/processes tests/registry.test.ts` → 28 pass / 0 fail; `cd apps/web && bun test tests/modules/projects/ProcessesView.test.tsx tests/modules/projects/roster.test.ts` → 39 pass / 0 fail (the remediation's restored executions `teamId` key holds) |
| P4 | mermaid-graph-consistent | — | `docs/help/index.md:71` + `:94` — node declared and wired, no `TeamSvc` and no dangling node reference; `rg -n "TeamSvc" docs/help/index.md` → 0 |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:6df3dc8b7de40bcc4e179936df6870bc924a4f202f820adba7a4cb6d7e7f81ea |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T17:22:23.100Z todo → wip (system)
- 2026-09-15T17:59:47.607Z wip → testing (system)
- 2026-09-15T17:59:49.606Z testing → done (system)

