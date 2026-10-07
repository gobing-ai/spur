---
schema_version: 1
name: Migrate workflow decide action to catalog references
status: blocked
template: feature-impl
created_at: 2026-10-06T17:55:55.426Z
updated_at: "2026-10-07T01:03:52.529Z"
feature_id: P1
priority: P2
tags:
  - decision
  - workflow

dependencies: ["1092", "1093", "1096"]
---

## 1094. Migrate workflow decide action to catalog references

### Background

Feature P1 (deferred; docs/design/decision-catalog.md §3.5). Postponed by operator decision 2026-10-06: workflow decision points adopt catalog decisions only after feature P ships and `spur decision run` evidence shows the DecisionMaker is reliable. This task holds the whole workflow replacement; at refine time it is split into one slice per decision point (task-triage, failure-class, review-failure-class), each citing its reliability evidence. Covers P1 scenarios R1, R2 and R3.

### Requirements

- [ ] R1. `DecideOptionsSchema` accepts `{decision, params?, evidence?, resultFile}`; inline `{id, method, question, choices, default, ...}` remains accepted.
- [ ] R2. `runDecide` calls DecisionService and maps the hub result onto the unchanged schemaVersion-1 row (method=type, backend=maker, degraded=source==='default').
- [ ] R3. task-triage, failure-class and review-failure-class in `config/workflows/task-pipeline.yaml` use catalog references; no inline decide remains in shipped workflows.
- [ ] R4. Inline decide options emit a deprecation warning from composition lint and the runner naming the replacement.
- [ ] R5. `inline-run-setup --decide` executes the same runner and writes the same row.

### Acceptance Criteria

- [ ] AC1 — Workflow decide action resolves a catalog decision by id
- [ ] AC2 — Every AI decision in shipped workflows comes from a catalog
- [ ] AC3 — Inline decide options keep working for one release with a deprecation warning

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T17:56:36.916Z

- Union schema with a one-release deprecation for inline options; removal is a later task.
- resultFile stays schemaVersion 1 with identical fields, so guards are untouched.
- Evidence is passed as one redacted/bounded `${params.evidence}` string; per-file params deferred until a decision needs them.

#### Q&A entry — 2026-10-06T18:16:30.738Z

- Postponed: stays in backlog until feature P is done and reliability evidence exists for the first decision point (P1 entry condition).
- Gradual adoption: split per decision point at refine time; one decision point per slice.
- Union schema with a one-release deprecation for inline options; removal is a later slice.
- resultFile stays schemaVersion 1 with identical fields, so guards are untouched.
- Evidence is passed as one redacted/bounded `${params.evidence}` string; per-file params deferred until a decision needs them.

### Design

Union schema over a flag day so third-party workflows keep running for one release. Evidence stays redacted/bounded at 2000 and is passed as `${params.evidence}`. Guards and resultFile paths are unchanged, so routing behavior is identical with the switch off. Reject: a new resultFile schemaVersion (breaks existing guards for no gain).

### Plan

1. E2E: run task-pipeline decide states with switch off and a stub maker; compare rows to current fixtures.
2. Schema union + runner rewrite + warning.
3. Edit task-pipeline.yaml; regenerate bundle.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:16:39.105Z todo → blocked (system)

