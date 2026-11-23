---
schema_version: 1
name: Badge A2A, cross-project and MCP-exposed members in Settings and Projects
status: todo
template: issue
created_at: 2026-11-23T00:56:01.336Z
updated_at: "2026-11-23T02:51:17.511Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 4
---

## 1441. Badge A2A, cross-project and MCP-exposed members in Settings and Projects

### Background

Task 1437 filed this as gap G4. `FleetService.resolve` emits `a2a`, `project`, `member` and `authEnv` for remote declarations and the health module returns the resolved fleet. The Board fleet type and Settings/Processes badges lack the addressing information. Settings Workflows reads the project workflow listing, whose DTO has raw YAML and validity but no MCP exposure flag.

**Refine corrections (2026-11-22)**
- Widen the existing board projection for the server's addressing fields; no new fleet endpoint is needed.
- The MCP badge describes a workflow's exposure declaration. Task 1438 owns the difference between a declaration and an advertised tool, including resolver refusals.

### Requirements

- [ ] R1. Mark literal A2A targets and project-addressed targets with distinct labels in Settings › Agents and in Projects › Processes where a row has a declared member. Preserve displayed enabled and observed process states.
- [ ] R2. In Settings › Workflows, mark a valid workflow whose parsed `metadata.mcp.expose` is the boolean `true` as declaring MCP exposure.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
