---
schema_version: 1
name: Combined supervised and attached fleet performance receipt
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-22T16:36:59.205Z"
feature_id: G75
priority: P3
tags:
  - fleet
  - performance

dependencies: ["1282", "1276", "1277", "1278", "1280"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 4
---

## 1283. Combined supervised and attached fleet performance receipt

### Background

Implements: R6 — A combined fleet receipt distinguishes participation gains from convenience.
Work package B6. Extends the G74 phase receipt driver. Depends on attached stage execution and the G74 adapters. If attached-ready adds no material gain over supervised-warm, report it as convenience only.
Rubric: E5 D1 L1 C1 R1 = 9 → own task.

**Refine corrections (2026-10-22)**
- Dependencies were incomplete: the combined receipt compares supervised-warm (needs 1276–1278) and host capabilities (1280) as well as attached-ready (1282). → resolution: depends on 1276, 1277, 1278, 1280, 1282.
- Receipt driver and schema are 1273's (`fleet-e2e --perf`, `docs/reports/fleet-perf-receipt.json`); this task adds modes, not a harness.

### Requirements

- [ ] R1. Run identical first-batch workloads on attached-ready, supervised-cold and supervised-warm workers including busy waits, attach overhead and failures.
- [ ] R2. Report p50/p95 completion, useful throughput and completion rate with quality and cost guardrails.
- [ ] R3. Record Grok Build and Antigravity CLI as second-batch probes; unsupported attachments are never counted as gains.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R6 — A combined fleet receipt distinguishes participation gains from convenience (req: R1)
  Given `bun run fleet-e2e --perf --modes attached-ready,supervised-cold,supervised-warm`
  When the deterministic lane runs
  Then every mode runs the same workload digest, and busy waits, attach overhead and failures appear as phases or trial statuses

Scenario: AC2 — Gains are reported with guardrails (req: R2)
  Given the receipt
  When the Markdown summary is generated
  Then it shows p50/p95, validated-per-hour and completion rate per mode, and labels attached-ready "convenience only" when its gain over supervised-warm is under the plan's materiality threshold

Scenario: AC3 — Batch-2 hosts never count as gains (req: R3)
  Given Grok Build and Antigravity CLI probes
  When they are absent or unsupported
  Then their rows read `unsupported` with a reason and are excluded from gain computations
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:26:06.694Z

- **Q: Materiality threshold?** CLOSED — use the provisional target in `docs/plans/2026-10-21-fleet-performance-measurement.md` (labelled provisional); if absent there, report raw deltas and mark "no threshold" rather than inventing one.
- **Q: Real agents?** CLOSED — opt-in `--real-agents`, operator-run.

### Design

**Files:** `scripts/commands/fleet-e2e.ts` (`--modes <csv>` within `--perf`; attached mode uses the 1282 fixture occupant); same receipt schema with `mode` values extended to `attached-ready`; Markdown summary adds a mode comparison table and the convenience verdict.
**Invariants:** failure denominators kept; no fabricated gains; batch-2 rows unsupported unless qualified.
**Rejected:** separate benchmark harness.

### Plan

1. Failure cases first: attached occupant busy for the whole trial; attach failure; mode missing a qualified driver; batch-2 host absent.
2. `--modes` + attached mode trial runner.
3. Combined deterministic receipt (`docs/reports/fleet-perf-receipt.{json,md}`).
4. Opt-in real-agent comparison; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G75 R6; KPI plan `docs/plans/2026-10-21-fleet-performance-measurement.md`; design `docs/design/fleet-attached-occupants.md` §7.
- Depends on 1276, 1277, 1278, 1280, 1282 (and transitively 1273).

### History
