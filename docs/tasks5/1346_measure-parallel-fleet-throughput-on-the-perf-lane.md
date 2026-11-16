---
schema_version: 1
name: Measure parallel fleet throughput on the perf lane
status: done
template: feature-impl
created_at: 2026-11-16T01:11:48.292Z
updated_at: "2026-11-16T03:24:50.422Z"
feature_id: G76

dependencies: ["1343"]
priority: P3
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1346. Measure parallel fleet throughput on the perf lane

### Background

Implements: R10 — Throughput is measured, not asserted.

Claims the orchestration gain only from the shared measurement receipt (ADR-145), comparing serial fleet, parallel fleet and the retired skill path.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [x] R1 — `fleet-e2e --perf` gains a batch lane running the integration-queue fixture serially and with `maxWriters: 2`.
- [x] R2 — The receipt records wall time, gate share and per-task windows; the target is parallel ≤ 0.6× serial-fleet wall time.
- [x] R3 — If gate share exceeds 50%, the receipt flags a separate gate-sharding decision instead of weakening the gate.

### Acceptance Criteria

- [x] AC1 — Throughput is measured, not asserted

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

Throughput is measured now, not asserted. `fleet-e2e --perf --modes batch` runs the same four-task
fixture twice over the REAL lane service and the REAL integration queue — one writer (serial fleet)
and `maxWriters: 2` (parallel) — and writes `docs/reports/fleet-perf-batch-<date>.json` with the wall
times, the ratio, the gate's share, and every task's dispatch/receipt/integration window. Landings
stay serialized by the `integrate` claim but overlap the remaining members' work, exactly as the
tick does, so the measured ratio is the orchestration's own throughput rather than a fixture artefact.

**Measured (recorded receipt):** serial 9,116 ms vs parallel 4,961 ms → **ratio 0.544** against the
0.6 target, `pass: true`, gate share 0.098 (below the 0.5 sharding threshold, so no flag), zero merge
commits. The fixture's member and gate windows are deterministic sleeps (2,000 ms / 120 ms) and the
receipt states them, so a reader can see the conditions the ratio holds under.

**Change map**

- **Lane (new):** `scripts/commands/fleet-e2e-batch-perf.ts`
  - `:120-215` `runFixture` — real git repo, real `WorktreeLaneService.open`, real `FleetIntegrationQueue.drainOne`; a chained per-task landing so the queue drains while other members still work.
  - `:64-110` `batchPerfReceipt` — pure rules: `pass = ratio <= 0.6`, `gateShardingFlag = gateShare > 0.5` (a sharding decision for the operator, never a weaker gate), and a failing ratio is reported rather than asserted away; a zero-length serial run yields `ratio: null`.
  - `:186-215` `runBatchPerf` writes the receipt and returns an exit code tied to `ff-only` integrity (a merge commit fails the lane), not to the ratio.
  - `retiredSkillBaseline` stays `null` with the reason: G76 1343 retired the skill path before this lane ran (Q&A CLOSED).
- **Wiring:** `scripts/commands/fleet-e2e.ts:1974-1979` adds `batch` to `ALL_PERF_MODES`; `:2894-2910` runs it once (repo-level, no agent column) before the per-agent lanes and returns early when it is the only mode selected. No new flag and no new entrypoint.
- **Tests:** `scripts/commands/fleet-e2e-batch-perf.test.ts` — the three receipt rules (including the zero-serial division guard) plus one real measurement asserting `pass`, no sharding flag, four windows and `integratedAt >= receiptAt`; `scripts/commands/fleet-e2e-perf.test.ts` updated for the new mode in the documented order.

**Verification**

- `bun test scripts/commands/fleet-e2e-batch-perf.test.ts`: 3 pass (the measurement case ~14 s).
- `bun test scripts/commands/fleet-e2e-perf.test.ts`: 24 pass, 0 fail.
- `every-export-has-tsdoc` and `require-corresponding-test`: PASS; biome clean on every changed file.
- probe: not-applicable (no public noun/verb/flag; the lane rides the existing `--perf --modes`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `fleet-e2e --perf` gains a batch lane running the integration-queue fixture serially and with `maxWriters: 2` | MET | `scripts/commands/fleet-e2e-batch-perf.ts:120-215` (`runFixture` over the real `WorktreeLaneService` + `FleetIntegrationQueue`), `:186-215` (`runBatchPerf` runs serial then parallel); registered as `batch` in `scripts/commands/fleet-e2e.ts:1974-1979` and driven at `:2894-2910`; test "the lane measures a real serial and parallel run and writes the receipt" |
| R2 — the receipt records wall time, gate share and per-task windows; the target is parallel ≤ 0.6× serial | MET | `:27-40` (the `BatchPerfReceipt` shape), `:64-110` (`batchPerfReceipt` computes `ratio`, `gateShare`, `pass`, windows); recorded receipt `docs/reports/fleet-perf-batch-2026-11-16.json` — serial 9,116 ms, parallel 4,961 ms, ratio 0.544, pass true |
| R3 — if gate share exceeds 50%, the receipt flags a separate gate-sharding decision instead of weakening the gate | MET | `:102-105` (`gateShardingFlag = gateShare > 0.5` with no change to the gate itself); test asserts the flag fires at 0.89 share and stays false at 0.2 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — throughput is measured, not asserted | MET | test | the measurement case asserts `pass`, no sharding flag and four windows with `integratedAt >= receiptAt`; `docs/reports/fleet-perf-batch-2026-11-16.json` is the reproducible artifact (`bun test scripts/commands/fleet-e2e-batch-perf.test.ts`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:06.083Z backlog → todo (system)
- 2026-11-16T03:22:15.344Z todo → wip (system)
- 2026-11-16T03:24:49.148Z wip → testing (system)
- 2026-11-16T03:24:50.417Z testing → done (system)

