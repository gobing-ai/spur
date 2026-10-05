---
schema_version: 1
name: Calibrate subprocess-bound test budgets so the repo-wide gate survives host load
status: backlog
template: standard
created_at: 2026-10-05T02:55:58.167Z
updated_at: "2026-10-05T02:56:05.955Z"

feature_id: D61
---

## 1088. Calibrate subprocess-bound test budgets so the repo-wide gate survives host load

### Background

The 1085 run's repo-wide gate (`bun run spur-check`) went red four times on host contention while 10007/10008 tests passed: `config-layering` x3-5, `agent list` (30s budget), `agent doctor` (15s/5s), and `proof-fingerprint > captures the digest into the declared var` (5000ms). Each failing test spawns the Spur CLI; `bun apps/cli/src/index.ts agent doctor coder --json` measured 1.5s on a quiet host and 7.0-8.4s while the operator's agent fleet ran (4 x `spur agent loop`, 3 x `spur serve`). `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` passes 13/13 when run alone (3 consecutive runs, 4.5-4.8s), so the gate's red is host-attributable, not a code defect — but it made a truthful PASS unattainable and forced an operator waiver.

Baseline anchor: `docs/reports/i31/0912-workflow-baseline.md` F4 (gate measures the whole tree; repeated gate runs) and its INSUFFICIENT_EVIDENCE note asking for retained failing-gate output and diff-attribution samples before freezing a target. Owner handoff: D61 (checks), D62 (driver adoption).

AC-subset note: the scenario below is new for D61's AC; add it there when this task is refined.

### Requirements

- [ ] R1. The subprocess-bound tests named above declare explicit, calibrated timeouts instead of relying on bun's 5000ms default.
- [ ] R2. No assertion, threshold or test is removed or weakened; only the time budget (and, where cheap, the number of CLI spawns) changes.
- [ ] R3. The budgets' basis (measured CLI startup cost, quiet and contended) is recorded next to them.

### Acceptance Criteria

- [ ] AC1 — The subprocess-bound tests declare explicit calibrated budgets

Task-local verification: the affected files pass on a contended host (fleet running) with the new budgets, and their budgets cite the measured spawn cost; a deliberate assertion failure still fails (the budget does not mask real failures).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: per-test `{ timeout }` on the identified tests (or one shared helper expressing "spawn-cost x margin"), calibrated from the measurement recorded in the task Background.
- Rejected: raising bun's global default in `bunfig.toml` (invisible to reviewers, would mask real hangs everywhere); `--max-concurrency` tuning (does not help a single 7s spawn); gating on a "quiet host" probe (fragile).
- Invariants: same tests, same assertions, same per-file coverage thresholds.

### Plan

- [ ] 1. Measure `agent doctor`/`agent list` startup quiet and contended; record both numbers in the task.
- [ ] 2. Set explicit budgets on the affected tests (and drop redundant spawns where equivalent).
- [ ] 3. Verify: run the affected files while the fleet runs; then `bun run spur-check` once.
- [ ] 4. Record the calibration in the Design section and, if a shared helper is introduced, in `docs/design/`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
