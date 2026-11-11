---
schema_version: 1
name: Residuals from 1323
status: done
template: standard
created_at: 2026-11-10T22:10:44.717Z
updated_at: "2026-11-11T17:53:37.304Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1327-verdict.json
---

## 1327. Residuals from 1323

### Background

Source task: 1323 (feature D3) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:4df96b6a — packages/app/src/services/agent-run-executor.ts:689, packages/app/src/services/agent-run-executor.ts:812, packages/app/src/observability/agent-execution.ts:291: A `timeout-exhausted-skip` on the node's first attempt `continue`s the loop before any dispatch, so the first real dispatch runs at `attempt >= 1` and `lifecycle.start` (guarded `attempt === 0`) never executes: the run emits no `started` lifecycle event and no progress heartbeats for that entire dispatch. `finish` still emits (its guards tolerate a missing start), dispatch behavior and all recorded ladder/budget decisions are unaffected — observability-only. Suggested fix: a start-once flag instead of the `attempt === 0` guard.

### Requirements

- [x] R1. `runTraced`'s lifecycle start guard is start-once (`lifecycleStarted` flag) rather than `attempt === 0`, so a 1323 R2 timeout-exhausted-skip on attempt 0 does not suppress the run's `started` event (and heartbeats) for the executor that actually dispatches.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Replace the `attempt === 0` guard on `lifecycle.start` with a `lifecycleStarted` flag (packages/app/src/services/agent-run-executor.ts).
2. Regression test in packages/app/tests/services/agent-run-executor-d3.test.ts: the timeout-exhausted-skip scenario emits exactly one `started` event naming the executor that ran.
3. `(cd packages/app && bun test tests/services/agent-run-executor-d3.test.ts)` green; fail-proof by stashing the src fix.

### Solution

- packages/app/src/services/agent-run-executor.ts:544 — `lifecycleStarted` flag declared beside `dispatchStartedAt`.
- packages/app/src/services/agent-run-executor.ts:815-818 — the `lifecycle.start` guard flips from `attempt === 0` to the start-once flag; the first real dispatch (including one after a timeout-exhausted-skip `continue`) emits `started` and resets `dispatchStartedAt` exactly once.
- packages/app/tests/services/agent-run-executor-d3.test.ts:318 — regression test reusing the AC2 skip scenario with an execution observer: exactly one `started` event, naming `codex`.

### Testing

- `(cd packages/app && bun test tests/services/agent-run-executor-d3.test.ts)` — 9 pass / 0 fail (43 expects).
- Fail-proof: with the src fix stashed, the new test fails (zero `started` events); restored, it passes.

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | No new findings. The flag is set inside the guard so any later re-entry (escalation, warm-worker paths) cannot double-start; `attempt === 0` remains meaningful for the model pin (1255), which is intentionally untouched. | Accepted. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-11T17:53:17.110Z backlog → todo (system)
- 2026-11-11T17:53:17.446Z todo → wip (system)
- 2026-11-11T17:53:37.261Z wip → done (system)

