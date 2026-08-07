---
template: feature-impl
schema_version: 1
name: "Choose the scheduling surface for the morning import-analyze-report loop"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0460"]
created_at: "2026-08-06T23:09:54.990Z"
updated_at: "2026-08-06T23:29:59.651Z"
---

## 0461. Choose the scheduling surface for the morning import-analyze-report loop

### Background
**Wayfinder ticket** — type: `wayfinder:research`. Map: feature E1. **Blocked by 0460** (the loop's
payload is the analyze→report chain).

**The question:** What runs the morning import→analyze→report loop, and how does it fail safely?

**Why it is open.** Feature A2 (embedded job queue and scheduler) is done and `spur-config.schema.json:90`
exposes `runtime.scheduler.enabled`, described as "OFF by default for CLI (run-once)". Whether that
scheduler can drive a multi-step daily job, or is only for in-process server work, is unestablished.

**Candidate surfaces (establish what each can actually do before choosing):**

- Spur's own scheduler (A2) plus a `spur workflow` — keeps the loop inside the harness, visible to
  `spur status` and the Board. Requires the CLI to be running, which conflicts with "run-once".
- OS-level `launchd` (macOS primary) invoking the CLI — reliable, unattended, but outside harness
  observability.
- Agent-side scheduling — the coding agent's own cron surface. Makes the follow-up *action*
  agentic, which is where this map is ultimately headed, but couples the loop to one agent.

**Sub-questions:**

- Multi-source fan-out: `--source` takes one value at a time (default `pi`). Six agents means six
  invocations or a new `--source all`. Which, and does one source's failure abort the rest? (AC R6
  says it must not.)
- What is "yesterday's sessions"? Incremental mode resumes from checkpoints, so the loop may not
  need a date window at all — confirm against 0457's findings.
- Where does the report land, and how does the operator learn it exists? File, `spur message`, or
  something else. This is currently in the map's fog — resolve it here or graduate it.
- Observability: does the run appear in `system_events`? Note the ledger is ~90% prune heartbeat
  with no workflow or agent rows today, so "it will show up in events" needs verifying, not assuming.
- Failure surface: a scheduled job that silently stops is worse than none. How is a failed or skipped
  morning run noticed?

**Resolved when** the task body names the scheduling surface with its reasoning, the fan-out and
failure-isolation model, the delivery mechanism, and how a missed run is detected.
### Requirements
- R1 — Establish what the A2 embedded scheduler can actually drive, given `runtime.scheduler.enabled` is documented as OFF by default for run-once CLI use.
- R2 — Choose the scheduling surface with reasoning across Spur scheduler, OS-level launchd, and agent-side scheduling.
- R3 — Define multi-source fan-out across six agents and guarantee that one source failing does not abort the others.
- R4 — Define report delivery: where it lands and how the operator learns it exists.
- R5 — Define how a failed or skipped morning run is detected, given `system_events` currently carries no workflow or agent rows.
### Acceptance Criteria
```gherkin
Feature: 0461 wayfinder investigation

  Scenario: R1 — the loop has an owner and fails visibly
    Given the analyze artifact contract from 0460
    When ticket 0461 is resolved
    Then the scheduling surface is named with its reasoning
    And fan-out across six sources isolates per-source failure
    And report delivery and missed-run detection are both specified
    And claims about event-ledger visibility are verified rather than assumed
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-06T23:29:59.651Z todo → cancelled (system)
