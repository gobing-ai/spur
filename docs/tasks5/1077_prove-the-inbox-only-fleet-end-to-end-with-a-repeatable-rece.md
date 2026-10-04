---
schema_version: 1
name: Prove the inbox-only fleet end to end with a repeatable receipt
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:37.927Z
updated_at: "2026-10-04T20:33:17.698Z"
feature_id: G71

dependencies: ["1073", "1074", "1075", "1076", "1080", "1081"]
---

## 1077. Prove the inbox-only fleet end to end with a repeatable receipt

### Background

Implements G71 R8 and closes the G7 umbrella criteria (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §1 "Done when", §3.2 item 11). Project rule: E2E is the primary test mechanism and must leave a repeatable artifact.

Scenario from plan §1: a `fleet:auto` task goes todo → done by the coder process; `spur message send --to planner "status?"` is answered; a killed coder is re-dispatched with `--continue`; the inbox shows the exchange; a joined Claude session receives a review request; `spur agent trace <root>` shows the lineage and stream.

### Requirements

- [ ] R1. A script under `scripts/` scaffolds a scratch project with a declared fleet, runs every plan §1 step against the source-local CLI, and tears down.
- [ ] R2. Each step records its command, exit code and observed evidence (message ids, receipt rows, trace output) into a JSON receipt under `docs/reports/`.
- [ ] R3. The script reruns deterministically: a stub executor is allowed for the member's model work; the fleet, inbox, receipt and trace paths are real.
- [ ] R4. The guest-join step runs only when task 1081 has landed; otherwise it is recorded as `skipped` with the reason.

### Acceptance Criteria

- [ ] AC1 — The inbox-only fleet is proven end to end

Task-local verification:

- Running the script twice produces receipts with identical step outcomes.
- A deliberately broken step (e.g. the member bypass reintroduced) makes the receipt record a failure and the script exit nonzero.

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

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History
