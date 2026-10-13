---
schema_version: 1
name: Deprecated task status documentation, skill parity and surface-review closure
status: todo
template: meta
created_at: 2026-10-13T16:56:12.970Z
updated_at: "2026-10-13T16:57:24.322Z"
feature_id: F43
priority: P3
estimate_hours: 3

dependencies: ["1189", "1190", "1191"]
---

## 1192. Deprecated task status documentation, skill parity and surface-review closure

### Background

Implements: R8 — Owner docs and skills record the vocabulary change and its affected surfaces.

Design: docs/design/task-deprecated-status.md §3.1 S13-S15; ADR-137; docs/00_ADR.md, docs/04_DESIGN.md. The design stage already wrote the ADR entry, the satellite and the 04 index row; this slice closes the remaining owners and the audit.

Ordering: last slice — it records what the earlier three landed, so its content depends on them.

### Requirements

- [ ] R1. Update the status vocabulary and the lifecycle graph in `docs/design/planning-record-contracts.md` so the TASK_STATUSES list and the task graph match the shipped YAML, and keep `docs/design/rd3-migration-design.md` §2.3 consistent if it enumerates the task statuses.
- [ ] R2. Update the `sp:spur-cli` task reference (`plugins/sp/skills/spur-cli/references/tasks.md`) with the `deprecated` status, its legal edges, the freeze guards and the exempt write set from the satellite's §3.2.
- [ ] R3. Close the audit rows the design marked 'audit only' (`docs/design/task-deprecated-status.md` §3.1 S14): `plugins/sp/scripts/wrapup-steps.ts` and `plugins/sp/scripts/quality-gate.mjs` either need an explicit terminal-set review or an evidence-backed no-edit note, and S2/S15 (contracts, persistence, init template) get the same treatment with a verified result rather than an assumption.
- [ ] R4. Confirm the design satellite's affected-surface table still matches the tree after the three implementation slices — update any anchor that moved and mark the ADR-137 status line from 'implementation pending' to implemented once the slices are verified.

### Acceptance Criteria

- [ ] AC8 — Owner docs and skills record the vocabulary change and its affected surfaces

Task-local checks: every 'no edit needed' audit row names the command or read that proves it; no doc restates a status list that can drift from the enum.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: close the documentation owners and re-verify the satellite anchors rather than restating the design in new docs.

Why: the ADR entry, the satellite and the design index row already exist from the idea-pipeline design stage, so this slice must not duplicate them — duplicating a design record is how two sources of truth appear. What the design stage could not do is verify the 'audit only' rows against post-implementation reality, and anchors drift when the guards land.

Rejected: writing a second status-vocabulary list into the skills reference. Link to the satellite and state only the operator-facing facts (which statuses exist, what the freeze refuses, which hops stay permitted).

Invariants: no new authoritative claim without a file anchor; every 'no edit needed' row carries the command or read that proves it; the ADR status line never claims 'implemented' before the slices are verified.

Verification: a keyword scan of the touched docs and skills for a stale status list, plus a read-back of each updated owner section.

### Plan

1. Update the planning record contracts and any other status enumeration.
2. Update the task CLI skill reference with the frozen semantics and the exempt write set.
3. Audit the S14/S2/S15 rows and record the verified result for each.
4. Re-verify the satellite anchors against the tree and flip the ADR-137 status line.
5. Scan the touched docs for a stale status list.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
