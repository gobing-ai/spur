---
schema_version: 1
name: Fleet phase timing receipt and cold/resume baseline driver
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.908Z
updated_at: "2026-10-22T16:26:13.818Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
---

## 1273. Fleet phase timing receipt and cold/resume baseline driver

### Background

Implements: R1 — A reproducible phase receipt compares all three first-batch agents.
Work package E0 (+ driver half of E7) in docs/plans/2026-10-21-fleet-task-execution-brainstorm.md §4; KPI contract docs/plans/2026-10-21-fleet-performance-measurement.md §2-3.
No dependency; first in the chain. Warm modes are recorded as unsupported until the adapter tasks land.
Rubric: E8 D1 L2 C1 R1 = 13 → own task (independent stream, measurement prerequisite).

**Refine corrections (2026-10-22)**
- Claim "extend scripts/commands/fleet-e2e.ts" → reality: 2027-line driver; `parseArgs` (`scripts/commands/fleet-e2e.ts:711`) accepts only `--matrix`, `--guest-join-fixture`, `--keep`, `--inject-failure` and rejects unknown flags; receipts land in `docs/reports/` (`:66`, `:97`). → resolution: add a `--perf` mode in the same parser (internal script, not a public `spur` verb), own receipt path.
- Claim "existing traced boundaries" → reality: per-run lifecycle is `AgentExecutionLifecycle` (`packages/app/src/observability/agent-execution.ts:179`); system events flow through the bus/catch-all (`packages/app/src/services/system-event-catch-all.ts:119`) and `followSystemEventsAfter` (`system-event-follow.ts:57`, poll `FOLLOW_POLL_INTERVAL_MS = 100` at `:31`). → resolution: phase marks are emitted there; no new telemetry service.
- Current stub caveat: `docs/reports/fleet-e2e-receipt.json:18` records stubbed agents — the deterministic lane stays stubbed; real agents are an opt-in lane.
- Observed binaries on this host (2026-10-22): claude 2.1.306, codex 0.163.0, pi (PATH) 1.4.0 — the driver records, never assumes, these.

### Requirements

- [ ] R1. Record the KPI phase timestamps (enqueue, claim, preflight, process ready, accepted, first output, terminal, contract validation, gates, receipt) with correlation ids; unobservable phases are absent, never zero.
- [ ] R2. Extend scripts/commands/fleet-e2e.ts with a paired-trial `--perf` mode that pins binary path/version, model/provider/reasoning, revision and workload digest for Codex, Claude Code and Pi in cold and resume modes (warm recorded `unsupported` until 1276–1278 land).
- [ ] R3. Emit a JSON receipt plus a short Markdown comparison with p50/p95 validated completion, useful throughput, completion rate, token/resource observations and a repeat command; failed, cancelled and timed-out trials stay in denominators.
- [ ] R4. Label provisional targets separately from measured values; deterministic fixture lane proves attribution, real-agent lane is opt-in.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Phase marks are correlated and missing phases stay absent (req: R1)
  Given a stubbed keyed task run through the fleet in the deterministic lane
  When the perf receipt is written
  Then every observed phase carries runId/executionId and a UTC timestamp, durations are computed only within one clock domain, and an unobservable phase (e.g. first tool start for the stub) is absent rather than 0

Scenario: AC2 — Paired trials pin provenance per agent and mode (req: R2)
  Given `bun run fleet-e2e --perf --trials 2`
  When the run completes
  Then each trial row names agent, mode (cold|resume|warm), binary path and version (or `unavailable`), model/provider/reasoning, git revision and workload digest, and warm rows read `unsupported` with a reason

Scenario: AC3 — Failures stay in the denominator (req: R3)
  Given `--perf --inject-failure <step>` kills one trial
  When the summary is computed
  Then completion rate counts the failed trial, p50/p95 cover only validated completions, and the Markdown summary prints the exact repeat command

Scenario: AC4 — Targets and measurements are labelled apart (req: R4)
  Given the receipt JSON and Markdown
  When they are read
  Then provisional targets appear only under `targets` (labelled provisional) and measured values only under `measured`; the real-agent lane runs only with `--real-agents`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:32.963Z

- **Q: New script or a mode?** CLOSED — mode `--perf` of `scripts/commands/fleet-e2e.ts` (task 1238 precedent: `--matrix` is a mode, not a second script). Flags: `--perf`, `--trials <n>` (default 3), `--real-agents`, `--agents <csv>`; compose with `--keep`/`--inject-failure`.
- **Q: Receipt paths?** CLOSED — `docs/reports/fleet-perf-receipt.json` and `docs/reports/fleet-perf-receipt.md` (stable names, overwritten each run, same as the other receipts).
- **Q: Paid real-agent runs?** CLOSED — opt-in only (`--real-agents`); default lane is deterministic stubs and costs nothing.
- **Q: Warm mode before 1276–1278?** CLOSED — rows present with `status: unsupported` and the named reason; 1276–1278 and 1283 fill them.

### Design

**Files:**
- `packages/app/src/observability/agent-execution.ts` — add `phase(name, at?)` marks on `AgentExecutionLifecycle` (`:179`) for process-ready/accepted/first-output/terminal/contract-validated; emit as system events named `fleet.phase.<name>` with the lifecycle correlation.
- Enqueue/claim/preflight marks at their existing boundaries: keyed drain (`packages/app/src/services/agent-loop-service.ts:469–512`), `runFleetWorkItem` (`packages/app/src/workflow/fleet-work-item.ts:63`), `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts:237`).
- `scripts/commands/fleet-e2e.ts` — `--perf` mode: reuse the scratch project/stub model/fleet scaffolding; collect `fleet.phase.*` events per trial via the event follow API; compute stats; write JSON + Markdown.

**Receipt schema (frozen):** `{schemaVersion:1, generatedAt, repeatCommand, revision, workloadDigest, targets:{provisional:true, ...}, trials:[{agent, mode, status:'validated'|'failed'|'cancelled'|'timed-out'|'unsupported', reason?, binary:{path, version}|null, model, provider, reasoning, phases:{<name>:{at, monotonicMs?}}, tokens?, rssMb?}], measured:{<agent>:{<mode>:{p50Ms, p95Ms, completionRate, validatedPerHour}}}}`.

**Invariants:** no env/credential dumps (reuse `redactAndBound`, `agent-execution.ts:352`); monotonic deltas only within one process, UTC + ids across processes; failed trials counted.
**Rejected:** separate metrics product; cross-process wall-clock deltas; zero-filling missing phases.
**Execution budget:** deterministic lane < 3 min; real-agent lane is operator-run.

### Plan

1. Failure cases first (tests in `apps/cli`/`scripts` E2E lane): dropped trial still counted; clock-domain mix rejected; missing phase absent; killed trial `failed`; warm `unsupported`.
2. Phase marks on `AgentExecutionLifecycle` + boundary marks (drain, runFleetWorkItem, action runner).
3. `--perf` parser arm + trial loop + stats + JSON/Markdown writers.
4. Deterministic E2E: `bun run fleet-e2e --perf --trials 2` produces `docs/reports/fleet-perf-receipt.{json,md}` (the repeatable artifact); `--inject-failure` arm proves denominators.
5. Focused tests in their workspaces, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- KPI contract: `docs/plans/2026-10-21-fleet-performance-measurement.md` §2–3; work package E0/E7: `docs/plans/2026-10-21-fleet-task-execution-brainstorm.md` §4.
- Design: `docs/design/fleet-task-turn-execution.md`; ADR-145.
- Anchors: `scripts/commands/fleet-e2e.ts:66,97,685,711`; `package.json:103` (`fleet-e2e`); `docs/reports/fleet-e2e-receipt.json:18`; `packages/app/src/services/system-event-follow.ts:31`.
- Consumers: 1276–1278 (warm rows), 1283 (attached modes).

### History
