---
schema_version: 1
name: Badge A2A, cross-project and MCP-exposed members in Settings and Projects
status: todo
template: issue
created_at: 2026-11-23T00:56:01.336Z
updated_at: "2026-11-23T00:56:01.432Z"
feature_id: A82

---

## 1441. Badge A2A, cross-project and MCP-exposed members in Settings and Projects

### Background

Captured from the creation title: "Badge A2A, cross-project and MCP-exposed members in Settings and Projects".

### Requirements

- [ ] R1. Add the A2A and cross-project fields to `ResolvedFleetMember` (`apps/web/src/modules/projects/useProjectContext.tsx`) so Settings › Agents and Projects › Processes can badge A2A and cross-project members.
- [ ] R2. Badge `metadata.mcp.expose: true` workflows in Settings › Workflows (A82 design gap G4).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Widen `ResolvedFleetMember` with the A2A/cross-project fields the server already resolves (R1).
2. Render the badges in Settings › Agents and Projects › Processes (R1).
3. Badge exposed workflows in Settings › Workflows (R2).
4. Component tests for each badge, and a regression test for a member with no A2A surface.

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
