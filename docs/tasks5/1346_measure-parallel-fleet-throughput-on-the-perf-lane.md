---
schema_version: 1
name: Measure parallel fleet throughput on the perf lane
status: todo
template: feature-impl
created_at: 2026-11-16T01:11:48.292Z
updated_at: "2026-11-16T01:21:06.083Z"
feature_id: G76

dependencies: ["1343"]
priority: P3
estimate_hours: 3
---

## 1346. Measure parallel fleet throughput on the perf lane

### Background

Implements: R10 — Throughput is measured, not asserted.

Claims the orchestration gain only from the shared measurement receipt (ADR-145), comparing serial fleet, parallel fleet and the retired skill path.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [ ] R1 — `fleet-e2e --perf` gains a batch lane running the integration-queue fixture serially and with `maxWriters: 2`.
- [ ] R2 — The receipt records wall time, gate share and per-task windows; the target is parallel ≤ 0.6× serial-fleet wall time.
- [ ] R3 — If gate share exceeds 50%, the receipt flags a separate gate-sharding decision instead of weakening the gate.

### Acceptance Criteria

- [ ] AC1 — Throughput is measured, not asserted

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:49.565Z

- **Q: Baseline for the retired skill path?** CLOSED (refine 2026-11-15): optional. It is recorded only if measured before 1343 lands; otherwise `null` with a reason. The target compares parallel against the serial fleet (G76 R10).

### Design

**WHAT.** A batch lane in the existing `fleet-e2e --perf` harness (`scripts/commands/fleet-e2e.ts:7,806`) that runs the 1342 integration fixture with lane mode off (serial fleet) and with `maxWriters: 2`, and writes one receipt.

**WHERE / frozen names.**
- **Mode value:** `--modes batch` joins the existing `--modes <csv>` list. No new flag.
- **Receipt:** `docs/reports/fleet-perf-batch-<YYYY-MM-DD>.json` with `{ serialWallMs, parallelWallMs, ratio, gateShare, tasks: [{ wbs, dispatchedAt, receiptAt, integratedAt }], target: 0.6, pass, gateShardingFlag }`.
- **Tests:** extend `scripts/commands/fleet-e2e-perf.test.ts` for the receipt shape. The deterministic fake-agent run is the default; `--real-agents` is optional evidence.

**Rules.**
- `pass = ratio <= 0.6`.
- `gateShardingFlag = gateShare > 0.5`. That records a decision for later and never relaxes the gate.
- A failing ratio is reported, not asserted away.

**Anti-patterns.**
- No new script entrypoint.
- Do not compare against the retired skill path once 1343 deletes it: that baseline comes from a pre-1343 run recorded in the same receipt when available, and otherwise `null` with a reason.

**Handoff.** It depends on 1343 (the foreground loop drives the parallel run).

### Plan

1. Add the perf lane and receipt fields.
2. Run and commit the receipt under `docs/reports/`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:06.083Z backlog → todo (system)

