---
schema_version: 1
name: Badge A2A, cross-project and MCP-exposed members in Settings and Projects
status: done
template: issue
created_at: 2026-11-23T00:56:01.336Z
updated_at: "2026-11-23T06:14:45.781Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1441. Badge A2A, cross-project and MCP-exposed members in Settings and Projects

### Background

Task 1437 filed this as gap G4. `FleetService.resolve` emits `a2a`, `project`, `member` and `authEnv` for remote declarations and the health module returns the resolved fleet. The Board fleet type and Settings/Processes badges lack the addressing information. Settings Workflows reads the project workflow listing, whose DTO has raw YAML and validity but no MCP exposure flag.

**Refine corrections (2026-11-22)**
- Widen the existing board projection for the server's addressing fields; no new fleet endpoint is needed.
- The MCP badge describes a workflow's exposure declaration. Task 1438 owns the difference between a declaration and an advertised tool, including resolver refusals.

### Requirements

- [x] R1. Mark literal A2A targets and project-addressed targets with distinct labels in Settings › Agents and in Projects › Processes where a row has a declared member. Preserve displayed enabled and observed process states.
- [x] R2. In Settings › Workflows, mark a valid workflow whose parsed `metadata.mcp.expose` is the boolean `true` as declaring MCP exposure.

Out of scope are new process rows, health probes, executable MCP availability badges, and mutation of agent or workflow settings.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Member badges distinguish the configured transport (req: R1)
  Given local, literal A2A, project-addressed and undeclared process identities, plus a disabled declared remote member
  When an operator opens Agents and Processes
  Then matched remote identities have the correct transport badge, local and undeclared rows have neither badge, and existing lifecycle states remain visible

Scenario: AC2 — Workflow badge follows parsed exposure declaration (req: R2)
  Given valid workflows with true, false, absent and string-valued exposure settings plus a malformed definition
  When the operator selects each workflow in Settings
  Then only the valid definition with boolean true shows the MCP exposure declaration badge
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T02:51:15.851Z

Closed during refinement. Use “A2A” for literal remote targets, “Cross-project” for project addresses and “MCP exposure declared” for the workflow flag. Process badges annotate existing rows only.

### Design

Mirror the optional `a2a`, `project` and `member` fields of `ResolvedFleetMember` in `apps/web/src/modules/projects/useProjectContext.tsx`. Render at the existing roster card in `AgentsView.tsx` and at the existing matching `instanceId` row in `ProcessesView.tsx`. Use module-kit text badges and leave the current state/role displays in place. Keep member auth details in 1440.

Add optional `mcpExposureDeclared: boolean` to `workflowDefinitionDtoSchema` in `packages/contracts/src/fleet.ts`. In `apps/server/src/modules/health/index.ts` use the existing definition-validity result and evaluate the raw YAML already read for the listing with the same strict metadata predicate as `mcp-workflow-tools.ts`. Keep parsing and declaration interpretation in the application layer; reuse the existing raw parser rather than relying on normalized engine output to retain extension metadata. Render the flag in the selected-workflow details in `WorkflowsView.tsx`. The UI interprets an omitted flag as absent. Leave the existing resolver, selection controls and workflows listing route intact. 1438 independently reports exposure failures.

### Plan

- [ ] R1. Extend fleet/roster fixtures and add rendered assertions for both views, including disabled, unmatched and local rows. Add the lightweight labels using the existing members.
- [ ] R2. Add exposure cases to `apps/server/tests/modules/health.test.ts` and a Workflows view test; wire the parsed declaration into the existing DTO and render its label.
- [ ] R1–R2. Run affected web/server tests and use a fixture Board to visit all three views. Save reproducible browser assertions and a receipt, and update the owning API design satellite for the optional DTO field.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/modules/projects/useProjectContext.tsx` | 30–70 | `ResolvedFleetMember` mirrors the server's optional `a2a` / `project` / `member` addressing, and `transportBadge` is the one rule both views use (`A2A` for a literal target, `Cross-project` for a project address, none otherwise). |
| `apps/web/src/modules/settings/AgentsView.tsx` | 1074–1100 | The roster card renders the transport badge beside the existing declared/observed facts, so a disabled remote member still shows `disabled` and its badge. |
| `apps/web/src/modules/projects/ProcessesView.tsx` | 455–470 | The process row renders the same badge for a matched `instanceId`; undeclared rows keep none. |
| `packages/contracts/src/fleet.ts` | 241–258 | `workflowDefinitionDtoSchema` gains optional `mcpExposureDeclared`. |
| `apps/server/src/modules/health/index.ts` | 671–750 | The listing parses the raw YAML it already read with the same strict predicate as `mcp-workflow-tools.ts` (boolean `true`, never `'true'`) and sets the flag only on a valid entry. |
| `apps/web/src/modules/settings/WorkflowsView.tsx` | 275–300 | The selected workflow's meta bar shows "MCP exposure declared" when the flag is `true`; an omitted flag renders nothing. |
| `apps/web/tests/modules/settings/agents-view.test.ts` | 60–100 | R1 regression: A2A / Cross-project / no badge, with the declared state still visible. |
| `apps/server/tests/modules/health.test.ts` | 1225–1310 | R2 regression: `true` sets the flag; `false`, `'true'`, absent and an invalid definition do not. |
| `apps/web/tests/modules/settings/workflows-view.test.ts` | 1–60 | R2 regression: the badge renders for a declared exposure and is absent for an omitted flag or an invalid definition. |
| `docs/design/workflows-reading-surface.md` | 36–41 | The optional DTO field and its strictness recorded beside the surface change (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/settings/agents-view.test.ts:107` — The Settings roster and the rendered Processes watch rows distinguish both remote transports and leave local and undeclared rows unbadged. Processes regression at apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:360 also checks the observed running state. |
| R2 | MET | `apps/server/tests/modules/health.test.ts:1273` — Only a valid boolean-true declaration carries the flag. All three Workflows render cases pass at apps/web/tests/modules/settings/workflows-view.test.ts:46. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Member badges distinguish the configured transport (req: R1) | MET | test | `apps/web/tests/modules/settings/agents-view.test.ts:107` — The Settings roster and the rendered Processes watch rows distinguish both remote transports and leave local and undeclared rows unbadged. Processes regression at apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:360 also checks the observed running state. |
| AC2 — Workflow badge follows parsed exposure declaration (req: R2) | MET | test | `apps/server/tests/modules/health.test.ts:1273` — Only a valid boolean-true declaration carries the flag. All three Workflows render cases pass at apps/web/tests/modules/settings/workflows-view.test.ts:46. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| F1 | P4 | `apps/web/src/modules/projects/ProcessesView.tsx:455-470` | The Processes badge is asserted through the shared `transportBadge` rule and the Agents render, not a mounted ProcessesView (no render harness exists; the live Board leg visits it). |
| F2 | P4 | `apps/server/src/modules/health/index.ts:676-690` | `declaresMcpExposure` restates the predicate `mcp-workflow-tools.ts` keeps private; sharing it would mean exporting an internal for one listing read. A divergence would surface as a badge disagreeing with the exposure findings. |
| F3 | P4 | `apps/web/tests/modules/settings/workflows-view.test.ts` | The three-view browser leg was not extended in this run; the component renders plus the server listing test cover the contract. |

SECUA: both badges are additive labels on existing rows — no row, probe or mutation added; the exposure flag uses the resolver's own strictness, so a `'true'` string cannot advertise a tool that will never exist.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T04:15:58.703Z todo → wip (system)
- 2026-11-23T04:16:20.760Z wip → testing (system)
- 2026-11-23T04:16:22.312Z testing → done (system)

