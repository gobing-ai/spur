---
schema_version: 1
name: Hide fleet plumbing verbs from default spur agent help
status: todo
template: feature-impl
created_at: 2026-11-15T04:06:32.615Z
updated_at: "2026-11-15T04:06:32.658Z"
feature_id: G8
priority: P2
tags:
  - agent
  - fleet
  - cli
  - usability
estimate_hours: 2

---

## 1335. Hide fleet plumbing verbs from default spur agent help

### Background

Implements: R11 — Default agent help shows only the daily verbs.

`spur agent --help` lists fourteen verbs; four of them (`join`, `leave`, `wait`, `report`) are called by hooks, skills and guests, not typed by a user dispatching work. Operator accepted hiding them on 2026-11-14 (ADR-148, ADR-051 consent).

### Requirements

- [ ] R1 — `join`, `leave`, `wait` and `report` are registered hidden, as `loop` already is; `spur agent --help` omits them.
- [ ] R2 — Each still runs unchanged and `spur agent <verb> --help` still prints its help.
- [ ] R3 — The `sp:spur-cli` agent reference and `sp:fleet-join` skill keep documenting them, marked as plumbing.
- [ ] R4 — CLI contract baselines are regenerated; no verb is removed or renamed.

### Acceptance Criteria

- [ ] AC1 — Default agent help shows only the daily verbs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: commander's `{ hidden: true }` on the four registrations, the pattern `apps/cli/src/commands/agent/loop.ts` already uses.

Rejected: removing or renaming the verbs (breaks hooks and the fleet-join skill); a `--all` help flag (commander already prints a hidden verb's own help).

Invariant: behavior of the four verbs is byte-identical.

### Plan

- [ ] Add `hidden: true` to the four registrations.
- [ ] Update the help-output test and regenerate the CLI contract baseline.
- [ ] Mark the four as plumbing in the agent reference; rebuild the CLI bundle.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
