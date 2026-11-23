---
schema_version: 1
name: "Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics"
status: todo
template: issue
created_at: 2026-11-23T00:56:05.442Z
updated_at: "2026-11-23T00:56:05.538Z"
feature_id: A82

---

## 1442. Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics

### Background

Captured from the creation title: "Gateway root page: MCP status, live counters, per-project namespaces and discover diagnostics".

### Requirements

- [ ] R1. Extend the system-info popover in `packages/app/src/services/project-gateway-html.ts` with the gateway MCP status, the live counters, the per-project namespaces and the `discoverExtras()` diagnostics (A82 design gap G5).
- [ ] R2. Keep the page server-rendered and dependency-free: the HTML is produced by the gateway process, not the Board, so no client-side fetch.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Read the gateway's MCP status, counters and namespaces at render time (R1).
2. Render them in the system-info popover beside the existing project rows (R1).
3. Assert the rendered HTML in a unit test beside the existing gateway tests (R2).

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
