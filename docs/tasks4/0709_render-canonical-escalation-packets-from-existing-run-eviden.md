---
schema_version: 1
name: "Render canonical escalation packets from existing run evidence"
status: done
template: issue
created_at: 2026-08-28T23:03:05.689Z
updated_at: "2026-08-30T17:13:53.198Z"
priority: P1
tags: ["harness", "workflow", "escalation", "observability"]
dependencies: ["0708"]
feature_id: A6
ac_altitude: task-local
---

## 0709. Render canonical escalation packets from existing run evidence

### Background

When a run fails, Spur can already preserve workflow logs, task reports, verdicts, artifacts, system events, retry counts, and messages. The evidence is fragmented across files and stores, so an operator or successor agent must reconstruct the incident before deciding whether to retry, change scope, or intervene.

This task composes existing references into one bounded, redacted escalation packet. The packet is a projection, not a new source of truth, and is emitted when an operational trip wire or terminal workflow failure requires a decision.

### Requirements

- [x] R1. Define a versioned escalation packet with goal/task/feature identity, workflow/run/action/execution ids, current lifecycle state, proof digest when available, attempt/budget/capability summary, last failed gate, artifact/event references, and one explicit unresolved operator decision.
- [x] R2. Build the packet from existing run/task/artifact/event references; do not copy complete logs, prompts, stdout, stderr, or task bodies into it.
- [x] R3. Apply the existing recursive secret redaction and payload bounds before persistence or event projection.
- [x] R4. Persist a canonical JSON artifact under the existing run artifact ownership and optionally render Markdown from that JSON for humans. JSON remains the projection source.
- [x] R5. Packet generation must be idempotent for the same run/failure fingerprint and must not create duplicate messages on retry.
- [x] R6. Emit a bounded `workflow.escalation.created` event that references the artifact rather than embedding it.
- [x] R7. Generation failure must not erase or replace the original run failure; record a secondary diagnostic and preserve all source artifacts.
- [x] R8. Reuse current workflow artifact, event, and message mechanisms; add no database table, event bus, or public CLI noun.

Non-goals: automatic remediation, automatic operator messaging outside Spur, a ticketing integration, or summarization by an additional model call.

### Acceptance Criteria

```gherkin
Feature: Canonical escalation packet

  Scenario: Trip wire creates one actionable packet
    Given a run fails because its hard budget trip wire fired
    When the failure path records escalation
    Then one versioned JSON artifact identifies the task, run, action, observed budget, evidence references, and required operator decision
    And the system event references that artifact

  Scenario: Sensitive and unbounded content stays out
    Given source logs contain a secret-shaped field and large stdout
    When the packet is projected
    Then the secret is redacted
    And stdout is represented only by its bounded artifact reference

  Scenario: Retry is idempotent
    Given the same run failure is processed twice
    When escalation projection runs again
    Then no duplicate packet or duplicate external message is created

  Scenario: Projection failure preserves the incident
    Given packet persistence fails
    When the workflow records failure
    Then the original failure and source artifacts remain intact and a secondary diagnostic is emitted
```

### Q&A

**Q: Why JSON first?** It provides a versioned machine contract and supports deterministic Markdown rendering. Markdown
alone would force later consumers to parse prose.

**Q: Should the packet include logs?** No. Include bounded artifact references and a short normalized failure reason.
Copying logs multiplies sensitive/unbounded content and creates freshness ambiguity.

**Q: Should an LLM summarize the incident?** No. The required fields are already structured, and escalation must still
work when the agent/provider is unavailable or exhausted.

**Q: Where is it stored?** Under existing run-artifact ownership and registered with the current artifact mechanism. No
new table or external messaging integration is required.

### Design

Add a deterministic escalation projector in `packages/app` that accepts bounded identifiers/outcomes and resolves references through existing stores. Persist `<runId>-escalation.json` as a run artifact; a minimal Markdown renderer may produce `<runId>-escalation.md` from the JSON for local handoff.

Use a stable failure fingerprint from run id, action id, policy/gate id, and evidence digest to make writes idempotent. The unresolved decision is selected from a closed vocabulary such as retry, revise requirements, grant capability, raise budget, or inspect failure; include concise reason/context, not free-form hidden inference.

Wire the projector to the trip-wire and terminal failure path. Keep source authorities unchanged.

### Plan

1. Inventory existing run report, artifact, system-event, verdict, budget, and routing references.
2. Define the minimal versioned packet schema and closed decision vocabulary.
3. Implement a pure bounded/redacted projection with failure fingerprint.
4. Persist the JSON through existing run-artifact ownership; add Markdown rendering only if an existing handoff consumer needs it.
5. Invoke projection on trip-wire and eligible terminal failure paths.
6. Emit the reference-only system event and prevent duplicate emission.
7. Add tests for complete, partially unavailable, redacted, oversized, duplicate, and projector-failure cases.
8. Update run-record/actionable-observability design docs.
9. Run targeted service/event tests, `bun run spur-check`, and `bun run test-cf` if transport projections change.

### Root Cause

Run failures are represented across multiple existing projections: workflow state/logs, `.spur/run` reports and
artifacts, task verdicts, system events, agent routing records, and messages. Each source is useful, but no bounded
artifact resolves the references and states the exact operator decision needed. Handover therefore requires a reader to
reconstruct correlation, latest gate, attempts, proof state, and artifact paths manually.

The root cause is projection fragmentation. Persisting another authoritative incident record would worsen it; the correct
fix is a deterministic, idempotent projection over the current authorities.

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
| `apps/cli/src/commands/task.ts:1585` |
| `apps/cli/src/commands/workflow.ts:11` |
| `apps/cli/src/commands/workflow.ts:149` |
| `apps/cli/src/commands/workflow.ts:48` |
| `apps/cli/src/commands/workflow.ts:553` |
| `apps/cli/src/commands/workflow.ts:672` |
| `apps/cli/src/commands/workflow.ts:726` |
| `apps/cli/src/commands/workflow.ts:778` |
| `apps/cli/src/commands/workflow.ts:817` |
| `apps/cli/src/commands/workflow.ts:820` |
| `apps/cli/src/commands/workflow.ts:851` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:11` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:138` |
| `apps/cli/tests/agents-md-portable-alignment.test.ts:14` |
| `apps/cli/tests/commands/workflow.test.ts:823` |
| `apps/cli/tests/fixtures/agents-md-portable-contract.ts:45` |
| `apps/cli/tests/init-templates.test.ts:376` |
| `packages/app/src/index.ts:28` |
| `packages/app/src/index.ts:535` |
| `packages/app/src/observability/agent-execution.ts:153` |
| `packages/app/src/observability/agent-execution.ts:24` |
| `packages/app/src/observability/agent-execution.ts:256` |
| `packages/app/src/observability/agent-execution.ts:3` |
| `packages/app/src/observability/agent-execution.ts:52` |
| `packages/app/src/observability/agent-execution.ts:99` |
| `packages/app/src/observability/escalation-packet-sink.ts:1` |
| `packages/app/src/observability/workflow-run-log-sink.ts:118` |
| `packages/app/src/observability/workflow-run-log-sink.ts:180` |
| `packages/app/src/observability/workflow-run-log-sink.ts:237` |
| `packages/app/src/observability/workflow-run-log-sink.ts:4` |
| `packages/app/src/observability/workflow-run-log-sink.ts:58` |
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
| `packages/app/src/services/event-names.ts:1062` |
| `packages/app/src/services/event-names.ts:323` |
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
| `packages/app/src/workflow/escalation-packet.ts:1` |
| `packages/app/src/workflow/observability.ts:112` |
| `packages/app/src/workflow/observability.ts:114` |
| `packages/app/src/workflow/observability.ts:242` |
| `packages/app/src/workflow/observability.ts:335` |
| `packages/app/src/workflow/observability.ts:361` |
| `packages/app/src/workflow/observability.ts:385` |
| `packages/app/src/workflow/observability.ts:393` |
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
| `packages/app/tests/observability/escalation-packet-sink.test.ts:1` |
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
| `packages/app/tests/workflow/escalation-packet.test.ts:1` |
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
| R1 | MET | escalation-packet.ts:52-95 closed-vocab packet; tests escalation-packet.test.ts R1 + sink R1 |
| R2 | MET | evidence refs only; sink test asserts no prompt body, artifact ref present |
| R3 | MET | bounded()/boundId() pre-persist; redaction + truncation tests |
| R4 | MET | canonical JSON at .spur/run/<runId>-escalation.json + ArtifactDao row; renderEscalationMarkdown tested; CLI e2e reads packet |
| R5 | MET | reserveAndDispatch sync reservation + artifacts-row dedupe; duplicate/race/replay tests |
| R6 | MET | bounded workflow.escalation.created; catalog+presenters+§11 matrix rows; two-sided gate green |
| R7 | MET | projection_failed bounded diagnostic, never throws; run log untouched; advisory CLI construction |
| R8 | MET | shared bus, artifacts table only, no new CLI noun; RUN_LOG_EVENT_NAMES excludes escalation |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — Trip wire creates one actionable packet | MET | test | Escalation packet, sink, renderer, and CLI tests prove one bounded packet references existing evidence and carries the unresolved operator decision; all passed in the 6,953-test full gate. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I5 and Wave 3.
- `docs/design/run-record-contract.md`
- `docs/design/workflow-run-log.md`
- `docs/design/actionable-observability-context.md`
- `packages/app/src/services/system-event-emitter.ts`
- `packages/app/src/services/system-event-envelope.ts`
- `packages/app/src/services/workflow-service.ts`
- `packages/app/src/workflow/observability.ts`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-30T05:39:00.399Z todo → wip (system)
- 2026-08-30T06:24:20.561Z wip → testing (system)
- 2026-08-30T06:24:24.217Z testing → done (system)
