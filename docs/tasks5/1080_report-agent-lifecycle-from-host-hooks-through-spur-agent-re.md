---
schema_version: 1
name: Report agent lifecycle from host hooks through spur agent report
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:39.110Z
updated_at: "2026-10-04T20:33:18.277Z"
feature_id: G73

dependencies: ["1074"]
---

## 1080. Report agent lifecycle from host hooks through spur agent report

### Background

Implements G73 R1 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 item 12; herdr finding P2; decision D6, `spur agent report` consented).

herdr derives agent state from host hooks (SessionStart / UserPromptSubmit / Stop, monotonic `--seq`) rather than screen scraping (`vendors/herdr/src/integration/assets/claude/herdr-agent-state.sh`). Spur's strategy cannot tell a member blocked on a human from an idle one today. Hooks stay standalone glue (ADR-065, ADR-130) and only shell out to the CLI.

### Requirements

- [ ] R1. `spur agent report --state working|idle|blocked --seq <ns>` records the member's lifecycle state; a report whose `seq` is not greater than the last accepted one is ignored.
- [ ] R2. Accepted transitions emit cataloged event `agent.lifecycle.changed` with a presenter (ADR-066).
- [ ] R3. `gtdStrategy` treats `blocked` as unavailable; the Board shows "needs human" on that member.
- [ ] R4. The `sp` plugin's Claude SessionStart/UserPromptSubmit/Stop hooks call `spur agent report` in the background only when `SPUR_SPEC_ID` is set; outside a fleet they exit immediately; failures are silent and never delay the agent. Pi gets the equivalent through its normalizer (ADR-129).

### Acceptance Criteria

- [ ] AC1 — Agents report lifecycle through hooks

Task-local verification:

- Reports with seq 3 then 2 leave the state from seq 3.
- A blocked member is skipped by the strategy tick with a hold reason.
- `bun run plugin-smoke` passes; a hook run without `SPUR_SPEC_ID` makes no CLI call.

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
