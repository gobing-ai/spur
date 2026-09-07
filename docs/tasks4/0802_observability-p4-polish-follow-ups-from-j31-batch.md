---
schema_version: 1
name: Observability P4 polish follow-ups from J31 batch
status: todo
template: issue
created_at: 2026-09-07T18:51:08.761Z
updated_at: "2026-09-07T18:55:23.220Z"

priority: P3
---

## 0802. Observability P4 polish follow-ups from J31 batch

### Background

Consolidates the non-blocking P4 review residuals left by J31 tasks 0793/0794 (batch runall-j31-56a6, merged to main in df48b7900). Each finding is recorded with file:line evidence in the owning task's Review section (docs/tasks4/0793_*.md:333-336, docs/tasks4/0794_*.md:446-449) as a "fold into a later polish task" pointer; none had an owning task. Filed by the 2026-09-07 session review (--triage) so they have an owner. Direct inline fixes were deliberately not applied at review time — the surfaces are verified-and-merged code and deserve tracked, tested changes. The server-shutdown item (R2) carries the only real data-loss semantics (in-flight uncataloged persists discarded on shutdown, matching the pre-existing best-effort tap pattern).

### Requirements

- [ ] R1. Remove the unreachable `?? name` fallback in `genericSystemEventCatalogEntry` (packages/app/src/services/system-event-catch-all.ts:69) — `String.split` never returns an empty array; keep existing test behavior for empty-string names.
- [ ] R2. Server shutdown and uncataloged persists: either drain in-flight catch-all persists on shutdown (mirror the CLI path's drain, apps/cli/src/system-event-ledger.ts:108-111) or document the best-effort lossy policy at the serve.ts attach site (apps/server/src/serve.ts:495-517). Pick one; no change to the CLI path.
- [ ] R3. `matchesClientFilter` export (apps/web/src/modules/observability/SystemEventsTab.tsx:601-604): drop the export (test through the module surface) or record the Q3 letter-deviation as accepted in docs/design/observabilities-module-polish.md — do not leave it silent.
- [ ] R4. Drop dead defaults: `timeRange = '4h'` on the required prop (apps/web/src/modules/observability/JobsTab.tsx:133) and `serializeFilter`'s `timeRange = '24h'` default (SystemEventsTab.tsx:575) whose sole caller passes it explicitly.
- [ ] R5. Hoist the double `resolveApiUrl()` evaluation in RoutingTab.tsx:236-238 to one local when `since` is defined.
- [ ] R6. Resolve the unused required `onTimeRangeChange` on `ObservabilityTabProps` (apps/web/src/modules/observability/tabs.ts:31): consume it or narrow the tab-facing props.
- [ ] R7. Document the per-sink drift-warn dedup Set scope (system-event-catch-all.ts:117-125) in the design doc — documentation only.

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Group edits: catch-all module + design doc (R1, R3, R7), server shutdown (R2), web polish (R4-R6); up to three focused conventional commits.
2. Targeted tests per workspace (app catch-all, server boot, web observability), then required lint/type/test/spur gates on the final diff.
3. Verify through the task pipeline; keep docs/04_DESIGN.md / design-doc sync in the same commit for R2/R3/R7 surface notes.

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
