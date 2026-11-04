---
schema_version: 1
name: Remove the 1290 one-release nested-verb deprecation shims
status: backlog
template: feature-impl
created_at: 2026-11-04T06:08:04.782Z
updated_at: "2026-11-04T06:08:32.814Z"
feature_id: A35

---

## 1291. Remove the 1290 one-release nested-verb deprecation shims

### Background

Task 1290 (feature A35) flattened every depth-3 `spur` verb to `<noun> <prefix>-<op>` and kept hidden nested-group shims for one release so existing scripts keep working while they print a stderr deprecation warning. This task removes those shims after that release window closes. `apps/cli/tests/cli-depth-guard.test.ts` `SHIM_ALLOWLIST` currently names the five remaining hidden depth-3 commands.

### Requirements

- [ ] R1. Remove the hidden `spur agent dogfood <gate|validate-report>` shim group; only `agent dogfood-gate` and `agent dogfood-validate-report` remain.
- [ ] R2. Remove the hidden `spur workflow commit-guard <start|stage|check>` shim group; only the flat `workflow commit-guard-*` verbs remain.
- [ ] R3. Remove the shared shim deprecation-warning helper if no caller remains after R1–R2.
- [ ] R4. Empty `SHIM_ALLOWLIST` in `apps/cli/tests/cli-depth-guard.test.ts` so any depth-3 command (hidden or visible) fails.
- [ ] R5. Drop the "hidden shims" notes from `docs/help/spur-cli-matrix.md`, `docs/00_ADR.md` ADR-051 amendment, and the spur-cli references; add a CHANGELOG/BREAKING note.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature A35 (CLI two-level surface conformance)
- Task 1290 — commit 54133745c plus its follow-up
- `apps/cli/tests/cli-depth-guard.test.ts`

### History
