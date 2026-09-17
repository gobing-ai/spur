---
schema_version: 1
name: Record the contract-violation pilot's first real-run routing decision
status: todo
template: feature-impl
created_at: 2026-09-17T00:46:12.717Z
updated_at: "2026-09-17T05:51:42.010Z"
feature_id: D62

dependencies: ["0871", "0873"]
priority: P2
---

## 0876. Record the contract-violation pilot's first real-run routing decision

### Background

Task 0871 shipped the `contract-violation` transition guard and piloted it on `wrapup-pipeline` (R1-R4 and acceptance scenario R8 MET with executable evidence). Its R5 second conjunct - that the pilot edge's *behaviour* is recorded from real runs rather than fixtures - is structurally post-landing: the edge landed in 0871, so no real contract-violation routing decision could exist at certification time. The verify verdict for 0871 is PARTIAL on exactly that conjunct and is recorded as such, with the task landed through the F6 provenance override.

This task closes the accrual. The evidence path is already wired by 0871 and 0870: the run log's `[contract-violation]` transition trigger, the `workflow.agent.contract-violation` event line, and the action trace's `outcome`/`contract`/`observed` triple. What is missing is a real run in which a stage's declared contract is genuinely violated by a clean agent exit, so the routing decision - and the distinction from an executor failure - is observed on production data instead of a regression pin.

### Requirements

- [ ] R1. At least one real (non-dry, non-fixture) `wrapup-pipeline` run recorded after 0871 landed (2026-09-17T00:46Z) shows the pilot edge taken: transition trigger `contract-violation` on the `doc-sync` to `repair` edge.
- [ ] R2. The recorded evidence names the violated contract, the observed value, and the transition trigger, taken from the run log (`.spur/run/<run-id>.log`) and the structured trace (`action_runs.result_json`, `system_events`), not from a regression fixture.
- [ ] R3. The recorded evidence shows the executor-failure path was NOT taken for that run, so the two outcomes remain distinguishable on real data.
- [ ] R4. The measurement is fed to the ADR-076 promotion gate as its real-run input: for each graph change that spreads the contract-first pattern to another `agent.run` stage, register a candidate in `config/workflow-candidates.json` (schema enforced by `validateCandidate`, `scripts/commands/workflow-promotion.ts:91`; `deadline` named at creation) citing this task's finding in `rationale`, then produce the verdict with `bun scripts/spur-dev.ts promotion evaluate <id>`. `promotion check` is only the repo-wide catalogue gate wired into `spur-check-feature`; it consumes no measurement.
- [ ] R5. Absence is recorded, never fabricated: if post-landing wrapup traffic exists but shows no contract violation, record the measured absence (run count and observation window) as the finding and take the promotion decision on it. If no post-landing run exists at all, the task is not yet observable and stays open — a vacuous absence is not a measurement.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @edge
  Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry
    Given a stage whose output failed a declared contract check in a real pipeline run
    When the pipeline evaluates its outgoing transitions
    Then the run log records the contract-violation trigger for that run
    And the action trace records the violated contract and its observed value
    And the executor-failure path is not taken for that run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-17T05:51:33.749Z

- Q: Why a standalone observation task instead of reopening 0871? — A: 0871 landed through the operator-approved F6 override (2026-09-16T17:45Z) with the real-run conjunct explicitly assigned to this follow-up; reopening would rewrite its recorded PARTIAL verdict instead of closing the accrual in the open.
- Q: Why is this not part of 0873? — A: 0873 built the gate (`promotion check|evaluate|resolve` + the candidate record) and is done; it deliberately contains no pilot measurement. Gate construction and pilot observation are separate units with separate evidence.
- Q: When is this task eligible to run? — A: Once `.spur/spur.db` holds at least one terminal, non-dry `wrapup-pipeline` run created after 0871 landed, or when the operator calls the promotion question — whichever comes first. At refinement (2026-09-17) the post-landing run count was zero.
- Q: Does this depend on 0868 (inline-driver trace emission)? — A: No. Verified against `.spur/spur.db`: 60 of the 99 recorded wrapup runs are state-machine engine runs that already write `action_runs` rows; 0868 covers the inline driver used by other pipelines.
- Q: What is deferred? — A: Authoring the actual spread candidates (contract-violation edges on other definitions) is promotion-time work, not this task. This task produces the measurement and the verdict input only.

### Design

Observe, do not fabricate. The pilot edge only fires when an `agent.run` exits cleanly while violating a declared post-condition (`answerFile` / `expectFile` / `requireDiff`), which is deliberately rare. The work is therefore a bounded observation over recorded history, not an implementation: read the run log's transition trigger and the action trace's discriminator columns for `wrapup-pipeline` runs that post-date 0871's landing, and record what was actually observed. A zero-traffic outcome is a legitimate result and must be recorded as absence of traffic (R5) rather than backfilled with a constructed violation - the whole point of ADR-076's gate is that promotion is decided on measured real-run data.

### Plan

0. Readiness gate: confirm at least one terminal (`done`/`failed`/`cancelled`), non-dry run with `workflow_name='wrapup-pipeline'` and `created_at` after 2026-09-17T00:46:46Z exists in `.spur/spur.db` (read-only). If none, stop and record "not yet observable"; do not fabricate. (At refinement time the post-landing count was zero.)
1. Enumerate the observation set: `SELECT id, status, created_at FROM runs WHERE workflow_name='wrapup-pipeline' AND created_at > <0871 landing>`; each run's log is `.spur/run/<id>.log`.
2. Per run, read both evidence surfaces:
   - Run log: the transition line `↪ doc-sync → repair [contract-violation]` (rendered by `renderStepLine`, `packages/app/src/workflow/step-reporter.ts:142`) and the contract-violation line `[<at>] contract-violation <contract> observed=<observed> node=<node> agent=<agent>` (`packages/app/src/observability/workflow-run-log-sink.ts:208`).
   - Structured trace: `system_events` rows with `event_name='workflow.agent.contract-violation'` for the run id, and the `doc-sync` row in `action_runs` whose `result_json` carries `$.data.outcome='contract-violation'` with `$.data.contract` / `$.data.observed` (emitted at `packages/app/src/workflow/actions/agent-run.ts:186`).
3. Record the first observed routing decision — run id, contract, observed value, trigger — and confirm the same run did NOT take the `executor-failure` edge to `failed` (R1–R3); or record the measured absence with run count and window (R5).
4. Feed the gate (R4): register one candidate per target definition in `config/workflow-candidates.json` (`id`, `canonical`, `deadline` as YYYY-MM-DD named now, `createdAt`, `rationale` citing this finding, `measurement: {workflow: '<target>'}` or explicit `runIds`, `delta.agentRunCount` matching the proposed change), then run `bun scripts/spur-dev.ts promotion evaluate <id>`; the emitted verdict (measured `agent.run` count and duration) is the ADR-076 promotion input. Leave `promotion check` to `spur-check-feature`.
5. Update 0871's R5 status note with the finding (run id, or the absence record) so its PARTIAL conjunct reads as closed-by-0876.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: D62 (`docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md`)
- Task 0870 — contract detection and the `workflow.agent.contract-violation` event
- Task 0871 — pilot edge on `wrapup-pipeline`; its PARTIAL R5 conjunct is owned by this task
- Task 0873 — the ADR-076 promotion gate this task feeds
- ADR-076 (promotion evidence standard), ADR-118 (contract-first routing)
- `docs/design/workflow-execution-economy.md` §5 (gate documentation)
- Evidence anchors: `packages/app/src/workflow/actions/agent-run.ts:186`, `packages/app/src/observability/workflow-run-log-sink.ts:208`, `packages/app/src/workflow/step-reporter.ts:142`, `scripts/commands/workflow-promotion.ts:91`

### History

- 2026-09-17T05:51:42.010Z backlog → todo (system)

