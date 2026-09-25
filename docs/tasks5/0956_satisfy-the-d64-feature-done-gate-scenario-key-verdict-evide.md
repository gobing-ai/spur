---
schema_version: 1
name: "Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact"
status: backlog
template: feature-impl
created_at: 2026-09-25T23:21:04.700Z
updated_at: "2026-09-25T23:21:22.923Z"
feature_id: D64

---

## 0956. Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact

### Background

Deferred from the D64 runall wrapup (2026-09-25). The ADR-119 feature-done gate (`spur feature check D64 --strict --as done`) fails with exactly three finding codes after the batch merged (4a8f7daa8):

- `L4.verdict-rows-match-no-scenario` ×10 — every task 0937–0946 carries verdict/Testing evidence rows not keyed to feature scenarios (repair per gate: `/sp:dev-verify <wbs>` per task).
- `L4.scenario-unverified` ×10 — same root cause.
- `L4.dogfood-missing` ×1 — no dogfood artifact for D64 (precedents: E7, H14 close commits).

Dispositions from the batch: tasks are genuinely done (all runs closed done/done, reviews/verifies PASS); only the scenario KEYING of verdict rows and the dogfood artifact are missing. Digest-defect scare during wrapup was a stale-install artifact: node_modules had ts-dual-workflow-engine 0.5.0 vs lockfile 0.5.6; after `bun install` + `build:bundle` + `bun link` the receipt digest check passes in bundled mode — no code defect.

Scope when picked up: run `/sp:dev-verify 0937..0946` re-keying evidence rows to feature scenarios (or re-record verdicts keyed by scenario/AC-N alias), produce the D64 dogfood artifact, re-run the strict gate to PASS, then transition D64 verifying → done and sync docs. Batch report: `.spur/run/batch-report-d64-9001.md` (worktree spur-new-runall-d64-9001).

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
