---
schema_version: 1
name: Apply durable quota updates and refresh running executor selection
status: done
template: feature-impl
created_at: 2026-09-07T17:12:18.727Z
updated_at: "2026-09-08T05:58:12.685Z"
feature_id: B5
priority: P2
tags:
  - executor-availability

dependencies: ["0796", "0797", "0798"]
---

## 0799. Apply durable quota updates and refresh running executor selection

### Background

The accepted ADR-111 uses a latest-observation record per project/executor because the prunable event ledger is not a durable work queue. This cohesive delivery path spans producer persistence, restart-safe application and runtime eligibility; splitting storage from consumption would leave neither slice independently able to fulfill a quota update.

Implements:

- R12 — Quota updates survive process boundaries and server restarts
- R13 — Duplicate stale and unattributed quota events cannot overwrite state
- R14 — Subsequent dispatches see availability changes immediately
- R15 — Recovery is a reserved explicit reenable contract
- R16 — Server lifecycle owns one quota update consumer

Approved design: docs/design/executor-availability.md; ADR-111. Planning run: bd360df4-561f-40f5-94a7-ae7132c55984.
Rubric: E10 D1 L4 C2 R2 = 19; estimated 10h. Retain this cohesive deliverable; tests and doc sync are included rather than split into phase tasks.

### Requirements

- [x] R1. Persist trusted attributed CLI/server quota events into one agent_executor_updates row per project/executor in the existing SQLite database, independently of event display/history pruning; consume pending records on server startup and apply the newest desired value only through setProjectExecutorDisabled, including retained work emitted while offline.
- [x] R2. Deduplicate or supersede observations by normalized observedAt and observationId, reject unknown/foreign attribution and replaced profile bindings, and retain visible retryable failures. Conditionally acknowledge only the applied version, preserve newer arrivals, replay idempotently after a crash, and never mark a failed write successful.
- [x] R3. Immediately exclude the exhausted executor from the current invocation's fallback set and reload effective availability/cache fingerprints at subsequent selection and launch boundaries in long-running workflows/teams without restarting the server.
- [x] R4. Subscribe to the reserved agent.quota.recovered event and map trusted explicit recovery to disabled false using the same exact-name updater; absent entries remain absent and no timer, polling detector or automatic recovery producer is added.
- [x] R5. Initialize one project-scoped ordered consumer before autostart or accepting dispatch, feed bus wakeups and polling into that same drain, flush producer persistence before CLI exit, and detach subscriptions plus drain active writes before graceful shutdown/database close.

### Acceptance Criteria

```gherkin
Feature: Apply durable quota updates and refresh running executor selection

  @core
  Scenario: R1 — Quota updates survive process boundaries and server restarts
    Given a valid quota event is emitted by a CLI or server process for the same project while the server may be offline
    When the local server starts and processes pending updates
    Then the existing named project entry becomes disabled exactly through the common updater and event display or history pruning does not silently discard accepted pending work

  @core
  Scenario: R2 — Duplicate stale and unattributed quota events cannot overwrite state
    Given events repeat an observation, predate a newer applied executor observation, or lack trustworthy exact project and executor identity
    When the consumer processes them
    Then duplicate and stale observations cause no repeated mutation, ambiguous targets are reported without writes, and failed writes remain observable and retryable

  @core
  Scenario: R3 — Subsequent dispatches see availability changes immediately
    Given an executor exhausts quota during a long-running workflow or its project disabled value changes
    When a fallback or subsequent dispatch resolves candidates
    Then the current invocation excludes the exhausted executor without waiting for persistence and subsequent decisions reload effective availability without server restart

  @core
  Scenario: R4 — Recovery is a reserved explicit reenable contract
    Given a trusted agent.quota.recovered event targets an existing project executor
    When the consumer applies it
    Then the common updater sets disabled false, missing entries remain absent, and no timer, polling process, or automatic recovery producer is introduced

  @core
  Scenario: R5 — Server lifecycle owns one quota update consumer
    Given the local server starts with pending quota updates and autostart work
    When startup and then graceful shutdown run
    Then quota consumption is ready before dispatch, one ordered mutation path applies events, and shutdown detaches listeners and drains active writes
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Implement accepted executor-availability sections 4-6 and ADR-111, not the earlier brainstorm's ledger-cursor alternative. Owned surfaces: new packages/domain/src/schema/agent-executor-updates.ts and dao/agent-executor-update-dao.ts, their package-owned exports and the next available drizzle migration; new packages/app/src/services/agent-quota-updates.ts; existing agent-service.ts/event-bridge.ts/event-names.ts and team/workflow dispatch context; apps/cli/src/system-event-ledger.ts plus relevant composition roots; apps/server/src/serve.ts and context.ts. Add focused domain/app/server integration tests using in-memory SQLite and temporary project configs.

The table is keyed by (project_id, executor_name) and stores observation_id, observed_at, agent, optional model, disabled, applied_observation_id, applied_at, attempts, retry_after and last_error. Constrain booleans and normalize UTC timestamps before lexical comparison. The DAO owns all SQL, latest-observation conditional upserts and version-specific acknowledgements. Retain the last row after application for stale-event rejection. Persist both event names through one shared app subscription; normal event history remains separately optional. Do not extend generic queue claims, ledger sequence allocation or event pruning.

The drain is serial per project. Validate trusted project identity and exact existing project entry before recording, then revalidate effective agent/model binding before applying. Compare observation order deterministically; same timestamp uses observationId lexical order, with no claim of distributed causality. A newer arrival during YAML commit remains pending after acknowledgement of the older row. Use existing server single-instance ownership only if integration proves it covers the project; otherwise acquire one narrow project consumer lock. Failure budgets are three attempts per drain activation, retained failed state, restart retry, and no automatic conflict overwrite. Polling the pending records is delivery work, not provider recovery polling.

Dependencies: all three preceding tasks. Consume a verified approved ts-ai-runner release and compatible event exports; the producer's source commit alone is not an installed dependency. If unavailable, stop dependent integration and report the exact upstream release requirement while retaining testable local progress. No speculative version bump, registry publication or direct node_modules edit.

Decisions: YAML is the execution authority; the durable row carries delivery state only. Coalesce superseded pending values, retain audit events under normal retention, skip absent/foreign/stale/replaced targets, and preserve manual-disable limitations until a future recovery-ownership design. Premises verified: CLI/server buses are separate, current ledger retention prunes unread rows, general queue consumer is opt-in and claims all types, and loader invalidation alone does not replace captured service config.

Budget: expected 10 hours, with a checkpoint after 6 hours or the first unsuccessful full integration gate. Persist task-scoped source/check evidence and remaining edges before continuation; no broad redesign. This is one cross-layer observable update delivery slice with one lifecycle/reliability review and rollback boundary. All implementation paths require actual source differences; do not invent edits solely for requireDiff.

Preserve unrelated/concurrent edits. Start implementation in a clean isolated working tree; one writer and one conventional commit per task. No .env, workflow, IAM or deployment changes are needed.

### Plan

1. [x] After producer/updater/eligibility prerequisites, add a CLI-bus-to-database-to-temporary-YAML failing integration case with the server initially stopped.
2. [x] Implement the narrow schema/migration and DAO conditional upsert/ack semantics; test duplicates, same-time tie-breaks, stale observations, newer-arrival races, and crash replay.
3. [x] Wire one shared subscription into producer composition roots with exact project/executor binding and awaited flush; register normal catalog presentation/redaction independently.
4. [x] Start one server drain before dispatch/autostart; add polling/wakeup, bounded retry/conflict behavior and graceful-shutdown draining without enabling provider polling or unrelated job types.
5. [x] Integrate immediate in-run exclusion plus fresh config checks for subsequent workflow/team dispatch and doctor fingerprints; validate reserved explicit recovery through the same path.
6. [x] Run focused negative/positive lifecycle integration checks including telemetry disabled, history pruning, foreign/missing targets, profile replacement, simultaneous updates, shutdown and write failures.
7. [x] Run final required lint/typecheck/tests/test-cf/build/spur gates; synchronize ADR-111 implementation status, 03/04 mechanisms, feature status via harness, and upstream release evidence, then record verify PASS.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/cli/src/commands/agent.ts:2` |
| `apps/cli/src/commands/agent.ts:20` |
| `apps/cli/src/commands/agent.ts:474` |
| `apps/cli/src/commands/agent.ts:523` |
| `apps/cli/src/commands/team.ts:116` |
| `apps/cli/src/commands/team.ts:124` |
| `apps/cli/src/commands/team.ts:13` |
| `apps/cli/src/commands/team.ts:2` |
| `apps/cli/src/commands/team.ts:397` |
| `apps/cli/src/commands/team.ts:404` |
| `apps/cli/src/commands/team.ts:415` |
| `apps/cli/src/commands/team.ts:420` |
| `apps/cli/src/commands/team.ts:429` |
| `apps/cli/src/commands/team.ts:463` |
| `apps/cli/src/commands/team.ts:474` |
| `apps/cli/src/commands/team.ts:500` |
| `apps/cli/src/commands/workflow.ts:1004` |
| `apps/cli/src/commands/workflow.ts:1064` |
| `apps/cli/src/commands/workflow.ts:401` |
| `apps/cli/src/commands/workflow.ts:48` |
| `apps/cli/src/commands/workflow.ts:6` |
| `apps/cli/src/commands/workflow.ts:738` |
| `apps/cli/src/commands/workflow.ts:949` |
| `apps/cli/src/context.ts:118` |
| `apps/cli/src/context.ts:170` |
| `apps/cli/src/context.ts:200` |
| `apps/cli/src/context.ts:210` |
| `apps/cli/src/index.ts:121` |
| `apps/cli/src/index.ts:129` |
| `apps/cli/src/index.ts:83` |
| `apps/server/src/context.ts:329` |
| `apps/server/src/context.ts:472` |
| `apps/server/src/context.ts:52` |
| `apps/server/src/context.ts:563` |
| `apps/server/src/serve.ts:20` |
| `apps/server/src/serve.ts:4` |
| `apps/server/src/serve.ts:476` |
| `apps/server/src/serve.ts:655` |
| `apps/server/tests/serve.test.ts:2` |
| `apps/server/tests/serve.test.ts:483` |
| `apps/server/tests/serve.test.ts:6` |
| `packages/app/src/index.ts:56` |
| `packages/app/src/services/agent-service.ts:1002` |
| `packages/app/src/services/agent-service.ts:1277` |
| `packages/app/src/services/agent-service.ts:1322` |
| `packages/app/src/services/agent-service.ts:1427` |
| `packages/app/src/services/agent-service.ts:1464` |
| `packages/app/src/services/agent-service.ts:851` |
| `packages/app/src/services/team-service.ts:55` |
| `packages/app/src/services/team-service.ts:689` |
| `packages/app/src/services/workflow-service.ts:1615` |
| `packages/app/src/services/workflow-service.ts:474` |
| `packages/domain/src/dao/index.ts:3` |
| `packages/domain/src/migrations.ts:1230` |
| `packages/domain/src/migrations.ts:189` |
| `packages/domain/src/migrations.ts:218` |
| `packages/domain/src/migrations.ts:748` |
| `packages/domain/tests/dao/migrations.test.ts:123` |
| `packages/domain/tests/dao/migrations.test.ts:261` |
| `packages/domain/tests/dao/migrations.test.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:516` |
| `packages/domain/tests/dao/migrations.test.ts:573` |
| `packages/domain/tests/dao/migrations.test.ts:576` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `packages/domain/src/migrations.ts:1230-1236` 0040 agent_executor_updates; `apps/cli/src/agent-quota-persistence.ts:29-38` CLI bus attach; `apps/server/src/serve.ts:526-553` consumer before autostart; `packages/app/src/services/agent-quota-updates.ts:226` drain via setProjectExecutorDisabled; tests `packages/domain/tests/dao/agent-executor-update-dao.test.ts` 10 pass and `apps/cli/tests/agent-quota-persistence.test.ts` 2 pass this run |
| R2 | MET | `packages/domain/src/dao/agent-executor-update-dao.ts:76` latest-observation upsert; `packages/app/src/services/agent-quota-updates.ts:170-201` trusted-shape then attribution; `packages/app/tests/services/agent-quota-updates.test.ts:111-118` record/reject/duplicate/supersede; drain failed write stays pending `272` |
| R3 | MET | `packages/app/src/services/agent-service.ts:1002-1016` run-scoped listener; `packages/app/src/services/agent-service.ts:1326-1328` quotaConfirmed → resource-exhaustion; `packages/app/src/services/agent-service.ts:1911` stage resolve stamps executor so quotaContext attaches; `packages/app/src/services/team-service.ts:689-693` and `packages/app/src/services/workflow-service.ts:1615-1619` reloadAgentConfig; `packages/app/tests/services/agent-service.test.ts:4163-4171` correlated escalate, uncorrelated does not |
| R4 | MET | `packages/app/src/services/agent-quota-updates.ts:200-201` recovered → disabled false; `packages/app/tests/services/agent-quota-updates.test.ts:119` recovery maps to disabled false; 30s poll is pending-record delivery only (`337`) |
| R5 | MET | `apps/server/src/serve.ts:526-553` one consumer before autostart; `723-731` stop before supervisor/DB close; `apps/server/tests/serve.test.ts:483` lifecycle test pass this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R12 — Quota updates survive process boundaries and server restarts | MET | test | `cd packages/domain && bun test tests/dao/agent-executor-update-dao.test.ts tests/dao/migrations.test.ts` → 64 pass / 0 fail; `cd apps/cli && bun test tests/agent-quota-persistence.test.ts` → 2 pass this run |
| R13 — Duplicate stale and unattributed quota events cannot overwrite state | MET | test | `cd packages/app && bun test tests/services/agent-quota-updates.test.ts` → 19 pass / 0 fail this run (duplicate/stale/foreign/replaced-binding/failed-write-visible) |
| R14 — Subsequent dispatches see availability changes immediately | MET | test | `cd packages/app && bun test tests/services/agent-service.test.ts --test-name-pattern "in-run quota exclusion"` → 3 pass / 0 fail this run (role + stage quotaContext + uncorrelated negative) |
| R15 — Recovery is a reserved explicit reenable contract | MET | test | `packages/app/tests/services/agent-quota-updates.test.ts:119` trusted recovery → disabled false; no recovery timer/producer in consumer (`startAgentQuotaUpdateConsumer` poll is drain-only) |
| R16 — Server lifecycle owns one quota update consumer | MET | test | `cd apps/server && bun test tests/serve.test.ts --test-name-pattern "quota update consumer"` → 1 pass / 0 fail this run |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-08T03:31:35.908Z todo → done (system)
