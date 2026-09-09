---
schema_version: 1
name: Add reusable scheduler and queue deadlines with renewable attempt ownership
status: done
template: feature-impl
created_at: 2026-09-08T22:33:10.235Z
updated_at: "2026-09-09T02:20:53.217Z"
feature_id: A21
priority: P1
tags:
  - A21
  - execution-timeouts
  - upstream

dependencies: ["0810"]
---

## 0812. Add reusable scheduler and queue deadlines with renewable attempt ownership

### Background

Robin selected reusable upstream timeout control and an explicit unlimited mode on 2026-09-08. Feature A21 and ADR-112 define the scope; docs/design/execution-deadlines.md is the accepted design.

- Implements: R1 — Shared upstream policy governs actual execution
- Implements: R2 — Timeout values preserve inheritance and explicit unlimited mode
- Implements: R5 — Unlimited jobs retain ownership beyond visibility intervals
- Implements: R6 — Expired ownership cannot acknowledge a replacement attempt
- Implements: R9 — Cancellation settles before retry and preserves shutdown controls

- Owner: Upstream /Users/robin/xprojects/ts-libs: packages/infra/src/job-queue, scheduler, application-node.ts and portable option types; packages/db/src/queue-job-dao.ts and schema/queue-jobs.ts plus the owning migration mechanism; corresponding tests/README/design docs. Keep DB/runtime implementations behind existing subpaths.
- Rubric: E8 D1 L2 C1 R2 = 14; independently verifiable deliverable, estimated 6–8 hours. Tests/docs stay in this task. Whole feature E23 D4 L5 C2 R2 = 36; split by reusable capability and release boundary, not by scenario.
- Evidence baseline: installed upstream 0.4.57 and read-only ts-libs checkout f01336f7b770219babaf62c2bde2f11ac9c1d86e; existing 65 focused Spur tests passed but do not prove the new contract.

### Requirements

- **R1** — Use one native execution policy/context for direct scheduler callbacks and queue handlers; persist the scheduled job execution option through enqueue so timing an enqueue does not replace timing the actual job.
- **R2** — Resolve timeoutMs as omitted=inherited, null=unlimited, or positive supported milliseconds, rejecting invalid explicit values before work. Preserve upstream omitted behavior and add compatible optional context/options without breaking existing handlers.
- **R3** — Renew finite queue leases while a bounded or unlimited execution remains owned; two consumers must not execute the same live attempt after multiple visibility intervals.
- **R4** — Fence claim, renewal, completion, failure and retry by fresh attempt ownership. Recover expired work after worker loss, refuse stale acknowledgements, and document idempotency and drained old-consumer rollout.
- **R5** — Request cancellation on deadline/ownership loss; settle owned cancellable work before normal retry or release. Keep non-cooperative live work cancelling/observable, retain explicit manual cancellation and separate bounded/drain-to-completion shutdown policies.

### Acceptance Criteria

```gherkin
Feature: Add reusable scheduler and queue deadlines with renewable attempt ownership

  @core
  Scenario: R1 — Shared upstream policy governs actual execution
    Given a scheduler callback and a queued job have explicit execution budgets
    When each execution reaches its deadline
    Then the upstream infrastructure requests cancellation through the same execution contract
    And a scheduler callback that only enqueues does not substitute its elapsed time for the queued job deadline

  @core
  Scenario: R2 — Timeout values preserve inheritance and explicit unlimited mode
    Given timeout configuration is omitted, null, positive, or invalid
    When the upstream policy resolves the execution limit
    Then omitted values inherit and null disables this scope's deadline
    And zero, negative, fractional, non-finite, and unsupported timer values fail validation before work starts

  @core
  Scenario: R3 — Unlimited jobs retain ownership beyond visibility intervals
    Given an unlimited job has a live owner and another consumer polls the same queue
    When execution exceeds multiple visibility intervals
    Then the owner renews its lease and no other consumer claims that live attempt
    And the job can complete normally without a hidden execution timer

  @core
  Scenario: R4 — Expired ownership cannot acknowledge a replacement attempt
    Given an old worker loses its renewable lease and another worker claims the job
    When the old attempt tries to renew, complete, or fail the job
    Then each stale mutation is refused using attempt ownership
    And expired work becomes recoverable without claiming arbitrary side effects are exactly once

  @core
  Scenario: R5 — Cancellation settles before retry and preserves shutdown controls
    Given a queue handler receives cancellation or the server starts shutdown
    When the worker coordinates settlement and retry
    Then the attempt is not retried while its owned cancellable work remains active
    And unlimited jobs remain manually cancellable and obey the separately selected shutdown drain policy
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend existing ts-infra scheduler/consumer APIs with compatible optional execution options/context and one internal mechanism; reuse native runtime termination via handler signal integration instead of importing application shell commands. Persist explicit null distinctly from absence. Add an attempt token and lease expiry through the existing ts-db queue schema/migration owner; claims generate fresh tokens, every mutation compares its token, and expired-lease reclaim is atomic. Renew during running and cancellation cleanup on a cadence derived from the finite visibility interval, independent of execution timeout. Handle DB renewal failure by losing ownership, aborting and fencing acknowledgements; no exactly-once side-effect promise. Replace age-based reclaim for upgraded leased attempts. Explicit drain-to-completion keeps renewal alive; bounded drain cannot falsely release live work. Keep native main barrels portable and reusable adapters on sanctioned subpaths. No queue replacement, scheduler grammar rewrite or committed package link.

#### Decisions

- Follow ADR-112 and docs/design/execution-deadlines.md; null means unlimited, omitted inherits. Native mechanisms own lifecycle; no parallel Spur framework.
- Rejected: constant-only deduplication, -1 sentinels passed to timers, unbounded visibility leases and promise-race-only cancellation.
- Preserve concurrent changes; work in a clean isolated checkout for implementation and use only task-owned temporary processes/databases.

#### Dependencies and premises

The current consumer resets jobs by processing age and marks completion by job ID. A finite visibility lease must remain recoverable for unlimited execution; changing only timeout values is insufficient. Runtime containment must be available before proving native process integration.

#### Execution budget and evidence

- Budget: 6–8 hours; checkpoint at the upper bound with changed-file/commit/test evidence, then resume against the same requirements.
- Ownership: Upstream /Users/robin/xprojects/ts-libs: packages/infra/src/job-queue, scheduler, application-node.ts and portable option types; packages/db/src/queue-job-dao.ts and schema/queue-jobs.ts plus the owning migration mechanism; corresponding tests/README/design docs. Keep DB/runtime implementations behind existing subpaths.
- Upstream work follows upstream AGENTS.md and harness; this Spur record tracks acceptance and cross-repository ordering. Record the exact upstream commit and verification commands in this task through spur task, never fabricate local product changes to satisfy requireDiff.
- requireDiff: source changes must be verified in the owning repository; documentation/evidence here is allowed tracking, not proof of upstream implementation. If the task pipeline cannot verify external source scope, use its explicit external-evidence path and report that limit before completion.
- No production mutations, releases, workflow edits, new toolchains or publication are included.

### Plan

1. Verify runtime predecessor evidence; read upstream queue DAO/schema/migration and scheduler bootstrap tests. Add a two-consumer reproduction of reclaiming an alive long execution.
2. Implement additive attempt ownership and atomic lease operations with migration/legacy-row tests; require old consumers to drain/upgrade before enabling leased execution.
3. Implement the shared nullable policy and execution context, schedule-to-enqueue propagation, renewal lifecycle, cancellation settlement, timeout results and bounded/unlimited drain semantics.
4. Test short controlled intervals for live unlimited jobs, finite siblings, null/default precedence, worker disappearance, renewal failure, stale ack rejection, cancellation-before-retry and shutdown. Verify old omitted options and portable imports.
5. Run focused db/infra tests, then upstream bun run spur-check and bun run build; update upstream schema/API docs and include the release compatibility contract and immutable upstream evidence in this task. Do not publish.

### Solution

Per-attempt execution deadlines and ownership fencing for background work (A21), implemented as one shared deadline seam plus per-surface integration. First-match-wins policy resolution everywhere: explicit value → explicit `null` (unlimited) → inherited default → unlimited.

**ts-db — lease/token persistence (migration 0005):**

- `packages/db/src/schema/queue-jobs.ts:22` — new columns `timeout_ms`, `timeout_unlimited`, `attempt_token`, `lease_expires_at`.
- `packages/db/src/embedded-migrations.ts:45` — embedded migration `0005_queue_attempt_ownership` (ALTER TABLE queue_job ADD COLUMN ×4).
- `packages/db/src/queue-job-dao.ts` — `QueueEnqueueOptions.timeoutMs` validated by `assertValidTimeoutMs` (queue-job-dao.ts:49, applied at :82/:106); `claimReady(batch, {leaseMs})` (queue-job-dao.ts:211) leases claimed rows and mints an `attemptToken` (recovery branch in the same atomic UPDATE skips rows holding live leases); `renewLease(id, token, leaseMs)` (queue-job-dao.ts:350); token-fenced `markCompleted`/`markFailed`/`markForRetry` (return `false` when the token no longer matches; clear token/lease on settlement; refresh `updatedAt`); `resetStuckJobs` skips token-holding rows so live leases survive sweeps.

**ts-infra — shared deadline seam:**

- `packages/infra/src/execution-policy.ts` (new) — `ExecutionContext` (:22), `resolveExecutionTimeoutMs` (:61), `runWithExecutionDeadline` (:101), `unlimitedExecutionContext` (:83); `resolveExecutionTimeoutMs(scope, value, inherited)` (validates positive int | null; throws with scope in message), `runWithExecutionDeadline(action, {timeoutMs, signal})` → `{outcome: 'completed'|'timeout'|'cancelled'|'error', timedOut, elapsedMs, error?, result?}`, `ExecutionContext {signal, deadlineMs, cancellationReason}` (single shared clock per attempt — not setTimeout+clearTimeout), `unlimitedExecutionContext()` for callers without a ts-infra deadline (Cloudflare adapter).

**ts-infra — job queue:**

- `packages/infra/src/job-queue/types.ts` — `Job.timeoutMs`, `EnqueueOptions.timeoutMs`, `JobHandler(job, context)`, `QueueConsumerConfig.defaultTimeoutMs` + `drainPolicy: 'bounded'|'drain-to-completion'`, `QueueConsumer.cancel(jobId)`.
- `packages/infra/src/job-queue/db-job-queue.ts` — `DBJobQueue` timeout passthrough; `DBQueueConsumer` rewritten (`DBQueueConsumer` at db-job-queue.ts:72, `defaultTimeoutMs` :83, `drainPolicy` :107): claims with `claimReady(batch, {leaseMs: visibilityTimeout})`, resolves per-job policy (`timeoutUnlimited` → null; else `timeoutMs ?? defaultTimeoutMs`), wraps each handler in `runWithExecutionDeadline` with an attempt AbortController, renews the lease at `max(1, ⌊visibilityTimeout/3⌋)` until settlement, aborts + fences all acks on lease loss, marks timed-out/cancelled/failed/completed with the attempt token, `cancel(jobId)` aborts the in-flight attempt (markFailed without retry, lastError 'job cancelled'), `stop()` bounded (drainTimeoutMs, default 30s) or `drain-to-completion` (unbounded until in-flight reaches 0).

**ts-infra — scheduler:**

- `packages/infra/src/scheduler/types.ts:13` — `ScheduledAction(context)` (zero-arg handlers stay assignable), `ScheduledActionOptions {timeoutMs}`, `register(cron, action, options?)`, `SchedulerJobConfig.timeoutMs`.
- `packages/infra/src/scheduler/node.ts` — `NodeSchedulerAdapterConfig.timeoutMs` validated in constructor (per-entry `timeoutMs: ExecutionDeadlineMs` resolved onto entries, node.ts:65/:74); per-entry resolution at `register` time (invalid → throw); ticks run under `runWithExecutionDeadline`; timeout → failed metric + warn log (tick never rejects the interval).
- `packages/infra/src/scheduler/cloudflare.ts:65` — invokes actions with `unlimitedExecutionContext()` (Workers runtime owns tick limits).
- `packages/infra/src/scheduler/wrap-handler.ts` — threads the context through the event-emitting wrapper.

**ts-infra — application bootstrap:**

- `packages/infra/src/application/types.ts` — `SchedulerOptions.timeoutMs` (:100), `SchedulerOptions.entries` typed `[string, ScheduledAction]`, `ApplicationBootstrapConfig.scheduler.timeoutMs` (:128, resolved, `null` = unlimited).
- `packages/infra/src/application-node.ts` — per-job `timeoutMs` validation → `ConfigValidationError` path `bootstrap.scheduler.jobs.N.timeoutMs` (application-node.ts:161); bootstrap-level `timeoutMs` validated via `resolveBootstrapSchedulerTimeout` (application-node.ts:108) and applied at :406; auto-constructed `NodeSchedulerAdapter` receives the resolved default.
- `packages/infra/src/application/index.ts:131` — portable scheduler config resolves `timeoutMs` (unlimited when omitted).
- Barrel exports: `execution-policy` from `src/index.ts`; `ScheduledActionOptions` from `scheduler/index.ts`.

**Tests:** db `tests/queue-job-lease.test.ts` (12 — token mint/renew/fence/recovery/reset semantics); infra `tests/job-queue/execution-policy.test.ts` (9), `tests/job-queue/lease-consumer.test.ts` (9 — deadline fail, unlimited inherit, lease-loss fencing, cancel(jobId), drain policies), `tests/scheduler/deadline.test.ts` (3 — finite/unlimited/invalid policies), `tests/application-node.test.ts` (+ scheduler timeoutMs config/jobs validation). Suites: db 209 pass, infra 366 pass; `tsc --noEmit` + Biome clean in both packages. Docs: queue/scheduler README sections updated.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | One seam for scheduler callbacks and queue handlers: @gobing-ai/ts-infra `packages/infra/src/execution-policy.ts` line 101 (`runWithExecutionDeadline`, single shared AbortController clock) used by both @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` line 316 and `packages/infra/src/scheduler/node.ts` line 273. Enqueue persists the job policy: @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` lines 82/95 (enqueue `timeoutColumns`) and `packages/db/src/schema/queue-jobs.ts` lines 22-29 (`timeout_ms`/`timeout_unlimited` columns). Enqueue-timing cannot substitute job timing — @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` line 310 resolves the persisted per-job policy at claim time; test `job timeoutMs bounds the handler, not the enqueuing caller` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 56 (pass, this run). |
| R2 | MET | `resolveExecutionTimeoutMs`: undefined=inherited, null=unlimited, positive integer wins, else RangeError with scope — @gobing-ai/ts-infra `packages/infra/src/execution-policy.ts` lines 61-77; tests `omitted inherits the parent scope` / `explicit null disables this scope deadline even over a finite parent` / `explicit finite value wins over inheritance` / `invalid explicit values are rejected before work` @gobing-ai/ts-infra `packages/infra/tests/job-queue/execution-policy.test.ts` lines 11-31 (pass, this run). Validation before work at every surface: enqueue @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` lines 49/82/106; scheduler registration/construction @gobing-ai/ts-infra `packages/infra/src/scheduler/node.ts` lines 124/143; bootstrap ConfigValidationError @gobing-ai/ts-infra `packages/infra/src/application-node.ts` lines 108-115/155-164. Upstream omission preserved: @gobing-ai/ts-infra `packages/infra/tests/application-node.test.ts` line 1059 (`omitted scheduler timeoutMs resolves to unlimited`). |
| R3 | MET | Finite-lease claim with fresh token: @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` line 215 (`claimReady(batch, {leaseMs})`, atomic UPDATE…RETURNING; recovery branch lines 226-232 reclaims only expired leases — live attempts unclaimable). Renewal at max(1, ⌊visibilityTimeout/3⌋) until settlement: @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` lines 388-412. Tests (pass, this run): `renews the lease so a second consumer never claims the live attempt` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 113; `expired-lease processing work is recoverable with a fresh token` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 134; unlimited completes without a hidden timer — `completes without arming a timer for unlimited policy` @gobing-ai/ts-infra `packages/infra/tests/job-queue/execution-policy.test.ts` line 33. |
| R4 | MET | Every mutation fenced by fresh attempt ownership: token-fenced `markCompleted`/`markFailed`/`markForRetry` @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` lines 277/298/322 (return false on token mismatch; clear token/lease on settlement); token-gated `renewLease` line 356; consumer fences all acks on lease loss @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` lines 327-336 (`attempt.lost` → acknowledgement fenced). Expired work recovery: claimReady expired-lease branch + `resetStuckJobs` skips token-holding rows @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` lines 374-388. Tests (pass, this run): `stale attempt cannot renew, complete, fail, or retry a replacement attempt` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 149; `lease renewal loss aborts the attempt and fences its acknowledgements` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 139. Idempotency doc: fenced-ack semantics documented @gobing-ai/ts-db `packages/db/README.md` lines 240-255; the explicit at-least-once/no-exactly-once + old-consumer-drain rollout statement remains thin (declared report-only residual, SECUA P3 below; does not unmet the implemented behavior). |
| R5 | MET | Cancellation settles before retry: `cancel(jobId)` aborts the in-flight attempt @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` lines 196-202; cancelled attempt is failed without retry only after handler settlement, checking `applied` before telemetry lines 344-360. Non-cooperative work stays observable, never reported successfully cancelled: @gobing-ai/ts-infra `packages/infra/src/execution-policy.ts` lines 143-160 (always awaited; `timedOut` flag) with test `an uncooperative handler is not reported as successfully cancelled` @gobing-ai/ts-infra `packages/infra/tests/job-queue/execution-policy.test.ts` line 73. Separate shutdown policies: bounded (drainTimeoutMs cap, attempts keep ownership) vs drain-to-completion @gobing-ai/ts-infra `packages/infra/src/job-queue/db-job-queue.ts` lines 153-181; tests `manual cancellation settles the attempt and fails it without retry` line 173, `drain-to-completion stop waits for the unlimited job` line 200, `bounded drain expiry leaves the running attempt owned, not released` line 219 @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` (pass, this run). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Scenario: R1 — Shared upstream policy governs actual execution | MET | test | `job timeoutMs bounds the handler, not the enqueuing caller` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 56; `finite deadline aborts the tick through the shared context` @gobing-ai/ts-infra `packages/infra/tests/scheduler/deadline.test.ts` line 25; `deadline expiry aborts the context, awaits settlement, and reports timeout` @gobing-ai/ts-infra `packages/infra/tests/job-queue/execution-policy.test.ts` line 50 — all pass this run (infra 366/0). |
| Scenario: R2 — Timeout values preserve inheritance and explicit unlimited mode | MET | test | @gobing-ai/ts-infra `packages/infra/tests/job-queue/execution-policy.test.ts` lines 11/17/21/25 (omitted inherits; null disables scope; finite wins; zero/negative/fractional/non-finite rejected) + `invalid explicit timeoutMs is rejected before insert` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 76 + `rejects invalid default and per-entry timeoutMs at configuration time` @gobing-ai/ts-infra `packages/infra/tests/scheduler/deadline.test.ts` line 14 — all pass this run. |
| Scenario: R3 — Unlimited jobs retain ownership beyond visibility intervals | MET | test | `renews the lease so a second consumer never claims the live attempt` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 113; `explicit unlimited job ignores the consumer default` line 83; `expired-lease processing work is recoverable with a fresh token` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 134 — all pass this run. |
| Scenario: R4 — Expired ownership cannot acknowledge a replacement attempt | MET | test | `stale attempt cannot renew, complete, fail, or retry a replacement attempt` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 149; `lease renewal loss aborts the attempt and fences its acknowledgements` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 139; recovery without exactly-once claims documented @gobing-ai/ts-db `packages/db/README.md` lines 240-242 — all pass this run. |
| Scenario: R5 — Cancellation settles before retry and preserves shutdown controls | MET | test | `manual cancellation settles the attempt and fails it without retry` @gobing-ai/ts-infra `packages/infra/tests/job-queue/lease-consumer.test.ts` line 173; `drain-to-completion stop waits for the unlimited job` line 200; `bounded drain expiry leaves the running attempt owned, not released` line 219 — all pass this run. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | vs docs/design/execution-deadlines.md (A21, accepted) and task Design: single shared mechanism for scheduler + queue DONE (`execution-policy.ts` used by both surfaces); job policy carried with durable enqueue, enforced at claim DONE (queue-jobs.ts:22-29, db-job-queue.ts:310); ts-db atomic claims/lease renewal/ownership-conditional mutations DONE (claimReady single-statement UPDATE…RETURNING, renewLease, fenced acks); context with signal/deadline/cancellation-reason DONE (execution-policy.ts:22-33); one-arg handler source compatibility DONE (JobHandler two-arg at job-queue/types.ts:61; zero-arg scheduler handlers assignable at scheduler/types.ts:13; monorepo tsc exit 0); age-based reclaim replaced for leased attempts while legacy path preserved DONE (resetStuckJobs skips token rows, P1 legacy regression test); bounded/drain-to-completion DONE. Doc-heavy rollout/idempotency wording partial → tracked as P4 residual. Scope-creep: none — all diff hunks map to R1-R5/Design/Plan. |
| P4 | Fix | — | Evidence |
| P4 | P1 legacy claims mint no ownership markers | — | @gobing-ai/ts-db `packages/db/src/queue-job-dao.ts` line 239 (`attemptToken: leased ? randomblob : null`) + leaseExpiresAt null when not leased; stale-marker clearing on legacy reclaim of expired-lease rows; resetStuckJobs keeps legacy sweep for untokened rows (lines 374-388). Regression test `legacy claims (no leaseMs) mint no token and stay recoverable via the age sweep` @gobing-ai/ts-db `packages/db/tests/queue-job-lease.test.ts` line 98 — includes crash-simulation `resetStuckJobs(0)` recovery and stale-marker clearing; pass this run. |
| P4 | P2 Cloudflare comment accuracy | — | @gobing-ai/ts-infra `packages/infra/src/scheduler/types.ts` lines 8-13 now states the Cloudflare adapter invokes actions with an unlimited execution context, matching `unlimitedExecutionContext()` at `packages/infra/src/scheduler/cloudflare.ts` line 65. |
| P4 | P2 README fenced-ack example | — | @gobing-ai/ts-db `packages/db/README.md` lines 243-255: claimReady with leaseMs, renewLease, and markCompleted/markFailed/markForRetry all pass `attemptToken`. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:eb7a46dae6c331631fd77d30dc92bf51737add08329bd3f0abff728504c5ef65 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-09T01:49:36.552Z todo → wip (system)
- 2026-09-09T02:20:51.913Z wip → testing (system)
- 2026-09-09T02:20:53.217Z testing → done (system)
