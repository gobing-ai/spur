---
schema_version: 1
name: "Prevent System Events overscroll from displacing the Board viewport"
status: todo
template: issue
created_at: 2026-08-25T00:12:13.257Z
updated_at: "2026-08-25T00:13:24.584Z"
feature_id: J92
---

## 0656. Prevent System Events overscroll from displacing the Board viewport

### Background
System Events can grow beyond one viewport after its historical page is loaded or “Load older” appends rows. At the bottom, continued trackpad scrolling moves the root document instead of remaining inside the Board workspace, exposing an almost blank canvas. History Timeline does not exhibit the visible failure because its content path does not expose the same unconstrained flex sizing as readily.
### Requirements
- [ ] R1. Keep the Board shell fixed to one viewport and prevent the root document from becoming a second vertical scroll owner.
- [ ] R2. Let the MainWorkspace content flex item shrink below its intrinsic content height so long module content scrolls inside the workspace.
- [ ] R3. Preserve existing module rendering, mobile header behavior, and System Events horizontal table overflow.
- [ ] R4. Add a focused regression check for the viewport and scrollport layout contract.
### Acceptance Criteria
- [ ] Long System Events history remains inside the Board viewport when the operator reaches the bottom and continues scrolling.
- [ ] The document stays fixed while vertical scrolling remains owned by the MainWorkspace content region.
- [ ] Existing module content and horizontal table overflow remain functional.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Constrain the existing shared MainWorkspace flex chain instead of adding tab-specific height logic. Give the workspace an explicit full height, allow its content child to shrink with `min-h-0`, and lock document overflow while the existing 100vh Board grid owns the viewport. “Load older” remains unchanged because it only exposes the shared layout defect.
### Plan
1. Reproduce the missing viewport/scrollport invariants against HEAD.
2. Compare the Board, MainWorkspace, Observability, and History layout chains.
3. Fix the shared height and scroll ownership boundary.
4. Add one focused regression test and run the web typecheck/tests.
### Root Cause
`MainWorkspace` did not fill its 100vh grid cell and its `flex-1 overflow-auto` child retained the default `min-height: auto`. Long System Events content therefore contributed its intrinsic height to the grid/flex chain instead of being bounded as the workspace scrollport. Because `html`/`body` also retained default overflow, the browser could scroll the root document after the inner content reached its end, displacing the fixed Board and exposing blank canvas. The Load older footer is only the height trigger; its layout is not causal.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
