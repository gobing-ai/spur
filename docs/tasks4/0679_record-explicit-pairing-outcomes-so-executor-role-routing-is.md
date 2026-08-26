---
schema_version: 1
name: "Record explicit pairing outcomes so executor-role routing is evidence-based"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:45.003Z
updated_at: "2026-08-26T05:39:29.449Z"
feature_id: I81
priority: P2
tags: ["history", "observability", "pairing", "telemetry"]
dependencies: ["0677"]
---

## 0679. Record explicit pairing outcomes so executor-role routing is evidence-based

### Background

The pairing evidence surface (feature J8) records that a dispatch happened but nothing about how it went, so it cannot serve the routing and escalation decisions it exists for.

Measured on the current corpus: five pairing rows carry 17 dispatches (`codex-sol` planner 2, `grok` planner 5, `minimax` scribe 4, `omp` coder 3, `omp-deepseek` reviewer 3), and **every row has a null model, a zero success rate, zero total cost, zero mean duration, and an empty escalation map**. `ladderSnapshot` is an empty array. Both history-anatomy reports had to record `coverage:agent-pairings:outcome-metrics-unavailable` and explicitly decline to propose any routing change, because a uniform zero cannot be distinguished from 17 failed dispatches.

Executor, role, agent and dispatch-count identities *are* recorded, so the dispatch occurrence is measured — only the outcome is missing.

### Requirements
- [ ] R1. Record an explicit `success`, `failure`, or `unknown` outcome for every executor-role dispatch.
- [ ] R2. Record the resolved model for a dispatch; where it was not resolved, store absent rather than null-as-zero.
- [ ] R3. Keep an unmeasured cost or duration absent rather than zero, consistent with the absent-not-zero contract.
- [ ] R4. Make the aggregate success rate computed over dispatches with a known outcome only, and report the unknown count alongside it so the denominator is legible.
- [ ] R5. Populate `ladderSnapshot` where ladder-stage outcomes exist, or record explicitly that no ladder stage ran.
- [ ] R6. Evaluate pairing performance only over completed dispatches; an unknown-outcome dispatch must not read as a failure.
### Acceptance Criteria

```gherkin
@core
Scenario: R12 — A pairing dispatch records an explicit outcome
  Given an executor-role dispatch completes, fails, or ends in an unknown state
  When the pairing telemetry is written
  Then the row carries an explicit "success", "failure", or "unknown" outcome
  And a model, cost, or duration that was not measured is stored as absent rather than zero
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**The zero is the bug.** A zero success rate over 17 dispatches is a claim, and it is a false one. The fix is to make the absence of an outcome representable — the same absent-not-zero discipline the analyze-invariants task establishes, applied to the pairing writer instead of the analyze reader. Doing it in the writer matters: an outcome that was never recorded cannot be recovered downstream.

**Three states, not two.** `success | failure | unknown` rather than a nullable boolean, because "the dispatch ended and we do not know how" is a real and common state (a timeout, a killed subprocess, a run that lost its record) that a nullable boolean invites callers to coerce. Making it a named state forces R4's denominator question to be answered at every read site.

**Success rate needs its denominator published.** A rate over an unstated denominator is the same category of defect as the zero it replaces. R4 makes the unknown count travel with the rate.

**Scope boundary.** This task changes what the pairing writer records and how the artifact presents it. It does not change routing or escalation policy — both reports were explicit that policy tuning waits for comparable evidence, and this task produces that evidence rather than acting on it.

**Reversibility.** Stop emitting the optional outcome fields; existing dispatch identities remain intact.

### Plan

1. Locate the pairing writer on the J8 surface and identify where a dispatch's terminal state is known.
2. Add the three-state outcome, the resolved model, and absent-preserving cost and duration to the recorded row.
3. Update the analyze aggregation to compute success rate over known outcomes only and to carry the unknown count.
4. Populate `ladderSnapshot` where ladder-stage outcomes exist; record the explicit no-ladder-ran case otherwise.
5. Update the forensics rendering to show "not available" for absent model, cost, and duration rather than zero.
6. Tests: a successful dispatch, a failed dispatch, and a dispatch that ends unknown each produce the right row; the aggregate excludes unknowns from the rate and reports their count.
7. Run a dispatch through a real workflow and confirm the artifact's pairing rows are populated.
8. Run `bun run lint`, `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
