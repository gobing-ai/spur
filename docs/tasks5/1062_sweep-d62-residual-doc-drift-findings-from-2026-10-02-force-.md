---
schema_version: 1
name: Sweep D62 residual doc-drift findings from 2026-10-02 force re-verify
status: cancelled
template: issue
created_at: 2026-10-03T00:53:23.803Z
updated_at: "2026-10-03T01:18:51.780Z"
feature_id: D62

---

## 1062. Sweep D62 residual doc-drift findings from 2026-10-02 force re-verify

### Background

Captured from the creation title: "Sweep D62 residual doc-drift findings from 2026-10-02 force re-verify".

### Requirements

- [ ] R1. 0866 (.spur/run/0866-residuals.json, 5 blocking items): annotate or close the stale `feature-dev` defect-register rows and fit-classification inventory rows; add the `.github/workflows/publish.yml:64` repoint to the 0866 Solution change map; reword Solution anchors that name deleted lines (`package.json:73`, `config/plugin-scripts.json:30`); doc-evolve sweep of agent-facing docs still advertising retired workflow definitions (plugins/sp/README.md, spur-dev/spur-cli references, gate-checklists, docs/design/essential-workflow-checks.md).
- [ ] R2. 0867 (.spur/run/0867-residuals.json, 1 blocking): reconcile Solution change map (8 files described vs 10 in diff — missing apps/cli/tests/json-envelope-inventory.test.ts census pin 66→67).
- [ ] R3. 0877 (.spur/run/0877-residuals.json, 1 blocking): document the 0882-inside-4fdd1f71d one-writer violation disposition in the task record.
- [ ] R4. 0912 (.spur/run/0912-residuals.json, 3 blocking): fix summary counts vs itemized runs[] contradiction in docs/reports/i31/0912-workflow-baseline.json (:56,:821,:892); repair stale Solution anchors (:978 past EOF, :952); correct or annotate the packages/contracts/src/fleet.ts:131 tsdoc layer-default claim.
- [ ] R5. 1053 / 1055 / 1056 (each 1 blocking): these are P3 review findings carrying explicit "Accepted" dispositions in the tasks' own Review tables that the deterministic residual scanner still classifies blocking — annotate them in the scanner-recognized form (or settle) so the fold stops downgrading: 1053 closeRun-engine-path startedAt (additive optional field), 1055 bare `@scope/pkg:1` regex fallback (generic message still fails closed), 1056 non-literal subpath name silently dropped (unchanged asLiteralRunFileName contract).
- [ ] R6. After repairs: re-run residual-scan scan+fold for 0866/0867/0877/0912/1053/1055/1056 and `spur task record` the upgraded verdicts, then `spur feature check D62` — the 4 L4.scenario-unverified errors (D62 R1/R2 via 0866, R3/R11 via 0867) must clear.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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

- 2026-10-03T01:18:51.780Z todo → cancelled (system)

