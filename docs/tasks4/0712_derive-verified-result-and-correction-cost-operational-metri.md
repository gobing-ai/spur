---
schema_version: 1
name: "Derive verified-result and correction-cost operational metrics"
status: done
template: issue
created_at: 2026-08-28T23:03:05.744Z
updated_at: "2026-08-30T17:13:53.922Z"
priority: P2
tags: ["harness", "history", "metrics", "verification"]
dependencies: ["0703", "0707"]
feature_id: A6
ac_altitude: task-local
---

## 0712. Derive verified-result and correction-cost operational metrics

### Background

Spur measures agent activity, history cost, duration, and run outcomes, but its primary operational success unit is not yet explicit: a task completed with valid verification and no subsequent corrective intervention. Raw token volume, dispatch count, or nominal done status cannot answer whether the harness produced a trustworthy result efficiently.

Existing task/run links, workflow records, verdict artifacts, history session links, and cost analytics provide the required joins. This task derives a truthful verified-outcome projection from those authorities and exposes it through the existing history analysis surface.

### Requirements

- [x] R1. Define `verified result` as a task reaching done with a PASS verdict whose proof digest matches the final certified state; do not count force-done, missing verdict, synthetic verdict, PARTIAL, FAIL, or invalidated proof.
- [x] R2. Define a correction as a verified task that is reopened, receives a post-verdict proof-input mutation requiring a new verification, or is superseded by a failed/retry run before stable completion. Keep the definition deterministic and documented.
- [x] R3. Derive verified-result count/rate, verified-without-correction rate, correction count/rate, time to verified result, and retry-exhaustion count from existing task/run/workflow records.
- [x] R4. Derive cost per verified result only from attributable measured history/run cost; return null plus coverage when cost is unavailable or only partially joined. Never coalesce absence to zero.
- [x] R5. Include denominator, time window, source coverage, excluded-reason counts, and schema version so comparisons are auditable.
- [x] R6. Extend the existing `history analyze --json`/report projection rather than adding a new public command or analytics store.
- [x] R7. Queries must remain bounded by the requested window and use existing indexes/read models; no full raw-history scan on every Board request.
- [x] R8. Add fixture-backed negative cases for force-done, missing/mismatched proof, reopen/correction, unlinked cost, duplicate imports, and partial coverage.
- [x] R9. If the History Board exposes the projection, update contracts/server/web in one change and preserve nullable accounting semantics.

Non-goals: ranking individual developers/agents, treating activity as quality, inventing unavailable cost, or adding an external metrics platform.

### Acceptance Criteria

```gherkin
Feature: Verified-outcome operational metrics

  Scenario: Clean verified result is counted
    Given a task reaches done through a PASS verdict with matching proof digest and no later correction
    When history analysis covers that window
    Then verifiedResults and verifiedWithoutCorrection each increase by one
    And timeToVerified includes the task's bounded lifecycle duration

  Scenario: Nominal done is not enough
    Given a task is force-done or has a missing, synthetic, or mismatched verdict
    When metrics are derived
    Then it is excluded from verifiedResults
    And the corresponding excludedReason count increases

  Scenario: Correction is visible
    Given a verified task is reopened and reverified after a proof-input change
    When metrics are derived
    Then correctionCount increases and verifiedWithoutCorrection does not count the original result as stable

  Scenario: Missing cost remains unknown
    Given verified results exist but only some have attributable measured cost
    When costPerVerifiedResult is derived
    Then the value is nullable or based only on covered results with explicit coverage
    And absent cost is never rendered as zero
```

### Q&A

**Q: Why does this depend on verdict integrity?** A verified-result metric is only meaningful once PASS names one final
proof state. Before that, expose no historical retroactive certainty for weak/synthetic verdicts.

**Q: What is a correction?** Use observable lifecycle/proof events: reopen, post-verdict proof mutation followed by new
verification, or superseding failed/retry execution before stable completion. Do not infer developer intent.

**Q: How is partial cost handled?** Return nullable cost plus covered/total verified-result counts. A covered-subset value
must be labeled as such; absence is never zero.

**Q: Where should the metric appear?** Extend existing `history analyze --json` and its report. Add Board projection only
if it is the same DTO/query path, not a second implementation.

### Design

Add a verified-outcome fold to the existing history/domain analytics layer. Join canonical task-run links to terminal workflow records and verdict/proof evidence; then left-join history-run-session cost. Return a versioned block with counts, rates, duration distribution, nullable cost metrics, and explicit coverage/exclusion reasons.

Use the proof contract delivered by the verdict-integrity task as the eligibility gate. Correction classification is event/transition based, not inferred by a model. Preserve unknown accounting as null. Reuse current history read-model refresh if query cost warrants materialization; do not create a second pipeline by default.

Expose the block in existing history analyze JSON and its report renderer. Board exposure is included only if that surface already consumes the same summary DTO without a parallel query.

### Plan

1. Map task-run, workflow-run, verdict/proof, transition, history-session, and cost join keys with representative fixtures.
2. Freeze deterministic verified/correction/exclusion definitions in design docs and tests.
3. Implement the bounded domain query/fold with nullable cost and coverage.
4. Add the versioned result block to history service analyze output and report rendering.
5. Reuse or refresh existing read models only if measured query cost requires it.
6. Add fixtures for clean verified, corrected, force-done, failed, mismatched proof, duplicate, and uncosted cases.
7. Add schema/contract tests and Board projection only where the existing summary path makes it a small extension.
8. Validate real-data output with a source-local CLI and record provenance/coverage.
9. Update history analytics design and public JSON surface documentation.
10. Run targeted domain/service/CLI tests, `bun run spur-check`, `bun run test-cf` if transport changes, and one bounded real-data dry run.

### Root Cause

Current analytics center on sessions, agents, tokens/cost, duration, and workflow activity. They do not join those facts to
a strict verified-task outcome. A nominal task `done` can include force-done, missing/weak verdict evidence, or later
correction, while cost joins can be absent. Counting done tasks or coalescing missing spend to zero would therefore
overstate success and understate cost.

The underlying correlation already exists in task-run links, workflow/run records, verdict artifacts, history run-session
links, and cost analytics. The missing element is a deterministic outcome definition and one bounded fold over those
authorities.

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/history.ts:11` |
| `apps/cli/src/commands/history.ts:160` |
| `apps/cli/src/commands/history.ts:196` |
| `apps/cli/src/commands/history.ts:299` |
| `apps/cli/src/commands/history.ts:53` |
| `apps/cli/src/commands/history.ts:8` |
| `apps/cli/src/commands/workflow.ts:778` |
| `apps/cli/src/commands/workflow.ts:781` |
| `apps/cli/src/commands/workflow.ts:812` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:11` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:138` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:14` |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:45` |
| `apps/cli/tests/init-templates.test.ts:376` |
| `packages/app/src/observability/agent-execution.ts:153` |
| `packages/app/src/observability/agent-execution.ts:24` |
| `packages/app/src/observability/agent-execution.ts:256` |
| `packages/app/src/observability/agent-execution.ts:3` |
| `packages/app/src/observability/agent-execution.ts:52` |
| `packages/app/src/observability/agent-execution.ts:99` |
| `packages/app/src/observability/workflow-run-log-sink.ts:178` |
| `packages/app/src/observability/workflow-run-log-sink.ts:235` |
| `packages/app/src/observability/workflow-run-log-sink.ts:4` |
| `packages/app/src/observability/workflow-run-log-sink.ts:88` |
| `packages/app/src/observability/workflow-run-log-sink.ts:9` |
| `packages/app/src/services/agent-service.ts:1102` |
| `packages/app/src/services/agent-service.ts:1393` |
| `packages/app/src/services/agent-service.ts:265` |
| `packages/app/src/services/agent-service.ts:49` |
| `packages/app/src/services/agent-service.ts:53` |
| `packages/app/src/services/agent-service.ts:812` |
| `packages/app/src/services/agent-service.ts:984` |
| `packages/app/src/services/agent-usage.ts:1` |
| `packages/app/src/services/capability-attestation.ts:1` |
| `packages/app/src/services/done-transition-guard.ts:16` |
| `packages/app/src/services/history-service.ts:227` |
| `packages/app/src/services/history-service.ts:582` |
| `packages/app/src/services/history-service.ts:74` |
| `packages/app/src/services/history-service.ts:77` |
| `packages/app/src/services/review-independence.ts:1` |
| `packages/app/src/services/task-record.ts:311` |
| `packages/app/src/services/task-record.ts:316` |
| `packages/app/src/services/verified-outcome.ts:1` |
| `packages/app/src/services/workflow-service.ts:1` |
| `packages/app/src/services/workflow-service.ts:297` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:47` |
| `packages/app/src/services/workflow-service.ts:848` |
| `packages/app/src/workflow/actions/agent-run.ts:16` |
| `packages/app/src/workflow/actions/agent-run.ts:173` |
| `packages/app/src/workflow/actions/agent-run.ts:186` |
| `packages/app/src/workflow/actions/agent-run.ts:188` |
| `packages/app/src/workflow/actions/agent-run.ts:201` |
| `packages/app/src/workflow/actions/agent-run.ts:219` |
| `packages/app/src/workflow/actions/agent-run.ts:23` |
| `packages/app/src/workflow/actions/agent-run.ts:25` |
| `packages/app/src/workflow/actions/agent-run.ts:285` |
| `packages/app/src/workflow/actions/agent-run.ts:356` |
| `packages/app/src/workflow/actions/agent-run.ts:363` |
| `packages/app/src/workflow/actions/agent-run.ts:394` |
| `packages/app/src/workflow/actions/agent-run.ts:427` |
| `packages/app/src/workflow/actions/agent-run.ts:559` |
| `packages/app/src/workflow/actions/agent-run.ts:584` |
| `packages/app/src/workflow/actions/agent-run.ts:600` |
| `packages/app/src/workflow/actions/agent-run.ts:683` |
| `packages/app/src/workflow/actions/agent-run.ts:694` |
| `packages/app/src/workflow/actions/agent-run.ts:699` |
| `packages/app/src/workflow/actions/agent-run.ts:767` |
| `packages/app/src/workflow/actions/agent-run.ts:772` |
| `packages/app/src/workflow/actions/agent-run.ts:8` |
| `packages/app/src/workflow/actions/agent-run.ts:95` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:3` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:47` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:5` |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:81` |
| `packages/app/src/workflow/builtins.ts:96` |
| `packages/app/src/workflow/checkpoint-contract.ts:1` |
| `packages/app/src/workflow/observability.ts:112` |
| `packages/app/src/workflow/observability.ts:114` |
| `packages/app/src/workflow/observability.ts:208` |
| `packages/app/src/workflow/observability.ts:297` |
| `packages/app/src/workflow/observability.ts:323` |
| `packages/app/src/workflow/observability.ts:347` |
| `packages/app/src/workflow/observability.ts:355` |
| `packages/app/src/workflow/observability.ts:55` |
| `packages/app/src/workflow/steering.ts:239` |
| `packages/app/src/workflow/steering.ts:255` |
| `packages/app/src/workflow/steering.ts:269` |
| `packages/app/src/workflow/steering.ts:273` |
| `packages/app/src/workflow/steering.ts:66` |
| `packages/app/src/workflow/step-reporter.ts:103` |
| `packages/app/src/workflow/step-reporter.ts:115` |
| `packages/app/src/workflow/step-reporter.ts:18` |
| `packages/app/src/workflow/step-reporter.ts:23` |
| `packages/app/src/workflow/step-reporter.ts:274` |
| `packages/app/src/workflow/tripwire.ts:1` |
| `packages/app/tests/observability/agent-execution.test.ts:40` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:221` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:357` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:66` |
| `packages/app/tests/services/agent-service.test.ts:3884` |
| `packages/app/tests/services/agent-service.test.ts:5` |
| `packages/app/tests/services/agent-usage.test.ts:1` |
| `packages/app/tests/services/capability-attestation.test.ts:1` |
| `packages/app/tests/services/checkpoint-cleanup.test.ts:1` |
| `packages/app/tests/services/event-names.test.ts:306` |
| `packages/app/tests/services/event-names.test.ts:323` |
| `packages/app/tests/services/review-independence.test.ts:1` |
| `packages/app/tests/services/verified-outcome.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:1714` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:2290` |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:59` |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts:8` |
| `packages/app/tests/workflow/capability-requirements.test.ts:1` |
| `packages/app/tests/workflow/checkpoint-contract.test.ts:1` |
| `packages/app/tests/workflow/docs-pipeline-measured-verdict.test.ts:1` |
| `packages/app/tests/workflow/observability.test.ts:328` |
| `packages/app/tests/workflow/steering.test.ts:155` |
| `packages/app/tests/workflow/step-reporter.test.ts:188` |
| `packages/app/tests/workflow/step-reporter.test.ts:198` |
| `packages/app/tests/workflow/step-reporter.test.ts:212` |
| `packages/app/tests/workflow/step-reporter.test.ts:215` |
| `packages/app/tests/workflow/step-reporter.test.ts:280` |
| `packages/app/tests/workflow/step-reporter.test.ts:45` |
| `packages/app/tests/workflow/step-reporter.test.ts:72` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:1` |
| `packages/app/tests/workflow/tripwire.test.ts:1` |
| `packages/config/src/index.ts:209` |
| `packages/config/src/index.ts:307` |
| `packages/domain/src/analytics/artifact.ts:242` |
| `packages/domain/src/analytics/artifact.ts:6` |
| `packages/domain/src/analytics/index.ts:170` |
| `packages/domain/src/analytics/render-report.ts:189` |
| `packages/domain/src/analytics/render-report.ts:194` |
| `packages/domain/src/analytics/render-report.ts:4` |
| `packages/domain/src/analytics/verified-outcome.ts:1` |
| `packages/domain/src/dao/run-dao.ts:145` |
| `packages/domain/tests/analytics/render-report.test.ts:247` |
| `packages/domain/tests/analytics/verified-outcome.test.ts:1` |
| `plugins/sp/hooks/context-hooks.test.ts:630` |
| `plugins/sp/hooks/context-post-tool.ts:2` |
| `plugins/sp/hooks/context-post-tool.ts:23` |
| `plugins/sp/hooks/context-post-tool.ts:287` |
| `plugins/sp/hooks/context-post-tool.ts:323` |
| `plugins/sp/hooks/context-session-start.ts:15` |
| `plugins/sp/hooks/context-session-start.ts:166` |
| `plugins/sp/hooks/context-session-start.ts:17` |
| `plugins/sp/hooks/context-session-start.ts:19` |
| `plugins/sp/hooks/context-session-start.ts:2` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1422` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1455` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1487` |
| `plugins/sp/scripts/stage-registry-adapter.ts:1496` |
| `plugins/sp/scripts/stage-registry-adapter.ts:207` |
| `plugins/sp/scripts/stage-registry-adapter.ts:27` |
| `plugins/sp/scripts/stage-registry-adapter.ts:999` |
| `plugins/sp/tests/cli-surface-parity.test.ts:10` |
| `plugins/sp/tests/cli-surface-parity.test.ts:239` |
| `plugins/sp/tests/cli-surface-parity.test.ts:241` |
| `plugins/sp/tests/cli-surface-parity.test.ts:423` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:230` |
| `plugins/sp/tests/routing-checkpoint.test.ts:1` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | verified-outcome.ts:145-171 exclusion ladder + certifying-run proxy ('done'\|\|'completed' per review P0 fix); domain test :44-66 |
| R2 | MET | verified-outcome.ts:172 reopened\|supersedingFailedRun; test :69-77 |
| R3 | MET | verified-outcome.ts:179-194 counts/rates/timeToVerified/retryExhausted |
| R4 | MET | gatherer :199-210 measured-only + fold null + explicit costCoverage; tests :94-106 + app smoke |
| R5 | MET | verified-outcome.ts:179-199 denominator/window/coverage/excludedReasons/schemaVersion=1 |
| R6 | MET | artifact.ts:247 additive (no bump); history-service.ts:584-594; render-report.ts:189,199; history.ts:51-72 |
| R7 | MET | gatherer :37,84-108 bounded traceRows+listByRun+in-memory until |
| R8 | MET | 9 domain fixtures + 3 app smoke tests incl. duplicate-wbs, uncosted, partial coverage |
| R9 | MET | conditional requirement — Board consumes its own seed rows, not HistoryArtifact; projection intentionally skipped per conditionality, documented in docs/04_DESIGN.md verified-outcome paragraph |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R10 — Clean verified result is counted | MET | test | Verified-outcome domain and app tests prove a proof-valid PASS is counted, later correction is visible, duration is bounded, and absent cost stays unknown; all passed in the 6,953-test full gate. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I8 and Wave 3.
- `packages/domain/src/analytics/run-cost.ts`
- `packages/domain/src/analytics/pairings.ts`
- `packages/app/src/services/history-service.ts`
- `packages/app/src/services/workflow-service.ts`
- `packages/app/src/services/done-transition-guard.ts`
- `apps/cli/src/commands/history.ts`
- `docs/design/history-data-processing.md`
- `docs/design/run-record-contract.md`
- `config/pipeline-budgets.json`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-30T04:45:05.585Z todo → wip (system)
- 2026-08-30T05:35:43.055Z wip → testing (system)
- 2026-08-30T05:35:50.727Z testing → done (system)
