---
schema_version: 1
name: Make canonical workflow interruption and replay behavior explicit
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.300Z
updated_at: "2026-09-22T02:57:58.788Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w03
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0914", "0915"]
---

## 0916. Make canonical workflow interruption and replay behavior explicit

### Background

Tasks 0901/0902 and 0910/0911 supplied upstream-owned recovery and conservative decision policy. Workflow adoption must account for at-least-once entry replay, corpus mutations and external PR effects. This slice adopts and tests those contracts rather than implementing another recovery engine. Covers proposed feature R3. Depends on W01 and W02.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W03 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Classify entry actions in all canonical workflows as safely repeatable, identity-deduplicated or requiring explicit reconciliation before replay.
- [ ] R2. Opt into existing interrupted-entry recovery only where repeatability is demonstrated; preserve upstream CAS ownership, paused skip-enter semantics and unsupported inline recovery behavior.
- [ ] R3. Preserve human decision boundaries and external PR request identity, pending/collect semantics and research mutation limits across interruptions.
- [ ] R4. Make recovery/refusal outcomes actionable in existing skills and progress/trace output without a new FSM or automatic external authorization.

### Acceptance Criteria

- [ ] AC1 — Every canonical workflow has an evidenced replay classification and no unsafe action gains unconditional interrupted-entry replay. (req: R1)
- [ ] AC2 — Concurrent resume and paused/interrupted fixtures preserve existing ownership and entry semantics; inline limitations are explicit. (req: R2)
- [ ] AC3 — Replaying an authorized PR request does not duplicate it, stale HEAD results remain pending, and human/research boundaries remain enforced. (req: R3)
- [ ] AC4 — Refused or incomplete recovery names the next safe action in current surfaces without a second recovery state machine. (req: R4)
- [ ] AC5 — Recovery preserves ownership and side effects (req: R1)

Feature-level traceability: this task delivers D63 scenario R3; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the upstream engine contract from ADR-122 and the existing CLI resume boundary. Inventory is test input, not a new routing registry. Fix root causes in shared mutation helpers where replay is required. The PR helper already deduplicates by HEAD; test and reuse it. Keep decision.mode never at human boundaries and make no claim of inline evidence-mode DecisionMaker parity. If an action cannot safely replay, retain refusal/manual reconciliation rather than enabling resumeRerun universally.

### Plan

- [ ] 1. Build the action replay matrix from the current ten definitions and actual helper behavior.
- [ ] 2. Make only demonstrated necessary helper/declaration corrections; preserve explicit unsafe replay refusal.
- [ ] 3. Exercise interrupted entry, lost/concurrent ownership claim, paused decision, corpus-write replay, PR duplicate request and research mutation cases.
- [ ] 4. Update recovery guidance and run the existing validator/contract and focused engine-integration tests.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:58.788Z todo → blocked (system)

