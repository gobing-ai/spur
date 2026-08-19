---
schema_version: 1
name: "Add queue identity to ts-infra consumer lifecycle events"
status: todo
template: feature-impl
created_at: 2026-08-19T15:25:16.660Z
updated_at: "2026-08-19T17:16:36.004Z"
feature_id: J9
priority: P2
tags: ["system-events", "queue", "ts-infra", "cross-repo"]
---

## 0602. Add queue identity to ts-infra consumer lifecycle events

### Background
J9 R6 needs a fact Spur cannot derive: the identity of the queue whose consumer started or stopped. ADR-068 assigns that fact to the upstream producer boundary, so this task changes `@gobing-ai/ts-infra` and publishes the version consumed later by task 0601.

Current-tree premise verified on 2026-08-19 against `/Users/robin/xprojects/ts-libs`:

- The clean `main` tree and npm registry both report lockstep version `0.4.38`; the next candidate patch is `0.4.39`, subject to the release preflight confirming it is still unused.
- `QueueConsumerConfig` has no `queueName`; `events` is optional and `DBQueueConsumer` accepts an empty config.
- `QueueConsumerStartedDetail` and `QueueConsumerStoppedDetail` contain polling/timing/drain facts but no queue identity. `DBQueueConsumer.start()` and `stop()` emit those details from `packages/infra/src/job-queue/db-job-queue.ts`.
- `QueueConsumerConfig` is already exported from the portable main barrel, both lifecycle detail types are already exported, and `DBQueueConsumer` remains correctly isolated behind `@gobing-ai/ts-infra/job-queue-db`. No export-map or package-boundary change is needed.
- Existing infra tests cover numeric config validation, idempotent start/stop, successful drain, timeout drain, typed lifecycle emits, and subpath exports. The README has both silent and event-enabled construction examples.
- Spur task 0601 depends on this task and has frozen the downstream composition name as `server-jobs`; 0601, not this task, owns the Spur dependency update and presenter integration.

The compatibility boundary is deliberate: a consumer that does not configure `events` may continue omitting queue identity because it emits no lifecycle rows. Once `events` is configured, construction must reject a missing or invalid name so an observable consumer can never emit an anonymous lifecycle event.

Out of scope: changing queue job events or adding `queueName` to `QueueJobRef`, renaming event keys, changing job payload/storage/DAO behavior, adding a queue registry, modifying Spur code or dependency pins, editing publish workflows, manual npm publishing, or refactoring unrelated ts-libs packages.
### Requirements
- [ ] R1. Add a truthful queue identity at the existing consumer configuration boundary.
  - Add `queueName?: string` to `QueueConsumerConfig` with JSDoc stating that it is runtime-required whenever `events` is configured.
  - Validate any supplied name as a non-empty, already-trimmed string. When `events` is present, reject a missing or invalid name synchronously during `DBQueueConsumer` construction with a `TypeError` whose message begins `Queue consumer queueName`.
  - Preserve the silent-consumer contract: `{}` remains valid when `events` is absent. Do not synthesize a default, trim/normalize a supplied value, or infer identity from a job type, database table, project, or event name.

- [ ] R2. Make queue identity required on both emitted lifecycle detail contracts.
  - Add required `queueName: string` to `QueueConsumerStartedDetail` and `QueueConsumerStoppedDetail` and emit the validated configured value unchanged from both `start()` and `stop()`.
  - Preserve existing emission cardinality and state semantics: repeated `start()` emits nothing after the first effective start; `stop()` emits only when the consumer was running; successful drain reports `drained: true`; deadline expiry reports `drained: false` with warning severity.
  - Preserve every existing started/stopped field and unit: `startedAt`, `pollInterval`, `batchSize`, `maxConcurrency`, `visibilityTimeout`, `stoppedAt`, `drainTimeoutMs`, `inFlightAtStop`, `drained`, and `severity`.

- [ ] R3. Keep the public/package boundary surgical and document the compatibility change.
  - Retain the existing `queue.consumer.started` and `queue.consumer.stopped` names, `QueueEvents` map, portable type exports, and `/job-queue-db` value subpath. No new export, package, dependency, event version, or adapter is introduced.
  - Do not add queue identity to `queue.job.*`; those events continue using `jobId` and handler `type` as job correlators and never carry business payload `T`.
  - Update the event-enabled README example to configure `queueName`, document the conditional requirement, and add a dated lockstep changelog entry with a Breaking Changes note for event-enabled constructors/manual lifecycle detail emitters.

- [ ] R4. Extend upstream tests at the owning seams.
  - Add constructor cases for missing, empty, whitespace-only, and padded names with `events`; add a control proving a silent consumer may still omit the field.
  - Assert the exact configured name on started, successfully drained stopped, and timed-out stopped details; retain assertions for all pre-existing fields and severities.
  - Update typed manual emits and every event-enabled `DBQueueConsumer` fixture to supply a name, while leaving silent fixtures unchanged where they exercise backward compatibility.
  - Keep main-barrel/subpath tests green and add no skipped tests, broad mocks, fixtures, or new test framework.

- [ ] R5. Produce and record a consumable lockstep release for task 0601.
  - Run targeted infra tests, `bun run spur-check`, and `bun run build` in the ts-libs repository; commit the implementation and changelog before release.
  - Use the next unused lockstep patch (`0.4.39` while local/npm remain `0.4.38`). The operator owns `bun run bump-ver <version> --push`; do not hand-edit package versions, tags, publish workflows, or invoke `npm publish`.
  - Confirm the aggregate Publish workflow and `npm view @gobing-ai/ts-infra@<version> version`, then record the ts-libs implementation commit, release commit/tag, workflow evidence, and exact published version in this task's Solution/Testing sections.
  - Leave the Spur `package.json`, lockfile, `server-jobs` composition, and presenter work to dependent task 0601.
### Acceptance Criteria
```gherkin
Feature: Event 5W1H payload and catalog remediation

  @core
  Scenario: R6 — Queue consumer lifecycle rows identify the queue and result
    Given a `DBQueueConsumer` configured with an EventBus and `queueName` equal to `server-jobs`
    When its effective start and stop lifecycle events are emitted
    Then both details carry `queueName` equal to `server-jobs` unchanged
    And start preserves its polling, concurrency, visibility, timestamp, and severity facts
    And stop preserves its timestamp, drain timeout, in-flight count, drained result, and severity facts
    And successful drain reports `drained: true` while deadline expiry reports `drained: false`
    When an event-enabled consumer is constructed without a non-empty trimmed queue name
    Then construction fails before polling with a queue-name validation error
    And a consumer without an EventBus may still omit queue identity
    And the published ts-infra version and release evidence are recorded for Spur task 0601
```
### Q&A
- **Is `queueName` globally required?** No. It is optional in `QueueConsumerConfig` so silent consumers keep the existing `{}` contract, but it is runtime-required whenever `events` is configured. That is the narrow boundary where anonymous lifecycle rows would otherwise be possible and matches Spur architecture's “optional configured identity” wording.
- **What names are valid?** Any non-empty string with no leading or trailing whitespace. The producer validates but does not normalize; the emitted value is byte-for-byte the configured value. No slug vocabulary or registry is introduced.
- **Do queue job events gain this field?** No. J9 asks for consumer lifecycle identity. `queue.job.*` keeps `jobId` plus handler `type`; copying the consumer name onto every job event is unnecessary payload churn.
- **Is this release fully backward-compatible?** Silent consumers are. Event-enabled consumers must add `queueName`, and manual construction of started/stopped detail objects must add the new required field. Record that source/runtime compatibility change under the release's Breaking Changes section.
- **Which version ships it?** The next unused lockstep patch. Current source and npm are `0.4.38`, so the candidate is `0.4.39`; release preflight is authoritative if another release lands first.
- **Who performs publication?** The implementation agent prepares a clean, reviewed ts-libs commit and full gate evidence. Per ts-libs `AGENTS.md`, Robin/operator runs `bun run bump-ver <version> --push`; GitHub Actions publishes through OIDC. No agent runs manual npm publish or edits `.github/workflows/`.
- **What exactly is handed to 0601?** The required started/stopped `queueName` field, conditional config validation behavior, and exact published ts-infra version. 0601 supplies `server-jobs`, updates Spur's catalog/override and lockfile, and implements presentation/integration tests.
- **Does this need a new upstream ADR or package surface?** No. It extends the existing injected EventBus observability contract (ts-libs ADR-013) within the existing core/adapter boundary (ADR-014) and implements Spur ADR-068. Existing barrels already export every changed public type.
### Design
**1. Public contract (R1–R3).** In `/Users/robin/xprojects/ts-libs/packages/infra/src/job-queue/types.ts`, add `queueName?: string` to `QueueConsumerConfig`. Keep the property optional at the type level because `events` remains optional; the cross-field invariant is enforced during construction rather than with a conditional union that would make variables typed `EventBus | undefined` awkward to compose.

In `packages/infra/src/events.ts`, add required `queueName: string` to `QueueConsumerStartedDetail` and `QueueConsumerStoppedDetail`. The `QueueEvents` keys and existing barrel exports do not change. This is the only public shape addition.

**2. Constructor invariant and emission (R1–R2).** In `packages/infra/src/job-queue/db-job-queue.ts`, validate `config.queueName` before any polling state is created. If a value is present, require `value.length > 0` and `value.trim() === value`; if `config.events` is present, absence is also an error. Throw `TypeError('Queue consumer queueName ...')` for all identity failures. Keep `config = {}` and all numeric defaults for silent consumers.

Store the bus only together with its validated name (an internal object/tuple is sufficient; no exported helper or abstraction). All existing consumer event emits continue through that stored bus. Add `queueName` only to the started/stopped literals. `start()` retains its `running` early return, and `stop()` retains `wasRunning`, drain waiting, timestamps, severity, and timeout behavior; identity must not alter scheduling or shutdown.

**3. Documentation and compatibility (R3).** Update `packages/infra/README.md` so the event-enabled example passes `queueName: 'email-jobs'` and the lifecycle section states the conditional requirement. Silent/process-once examples may remain unnamed. Add a `0.4.39` dated section to root `CHANGELOG.md` if release preflight still selects that version, with the field addition under Added/Changed and explicit event-enabled/manual-detail migration under Breaking Changes. Do not touch package export maps, dependency ranges, generated `dist`, numbered ts-libs architecture docs, or `.github/workflows/`.

**4. Test design (R4).** Extend `packages/infra/tests/job-queue/db-job-queue.test.ts` at the current config/start/stop/drain tests. Event-enabled fixtures use a stable `test-jobs` name. Add a compact table of invalid names and assert the error prefix; keep one no-events/no-name control. The started test, normal drained stop test, and existing hung-handler timeout test each assert `queueName`. Update `packages/infra/tests/events.test.ts` manual lifecycle details with the required field and assert it survives the typed EventBus. Existing `job-queue-db.test.ts`, `subpaths.test.ts`, typecheck, and build prove export compatibility; no separate public-export file or fixture tree is needed.

**5. Release and cross-repo handoff (R5).** Work on one isolated ts-libs branch/worktree and commit the code/tests/README/changelog after the full upstream gates. With a clean tree, the operator runs the documented lockstep release command for the next unused patch; `bump-ver` alone owns manifest edits, release commit, tags, and push orchestration. Publication is complete only after the aggregate workflow is visible and npm returns the exact version. Record those immutable identifiers in 0602 before marking it done. 0601 reads that evidence and owns every Spur-side dependency/composition/presenter change; 0602 must not locally link or cast around an unpublished contract.

**Rejected approaches.** A global required name would break silent consumers that emit no lifecycle rows; an optional emitted detail field would permit anonymous rows; a conditional config union adds composition friction without replacing runtime validation; defaulting to `default`, a table name, project name, or job `type` fabricates identity; adding the field to all job events is unrelated churn; a new event version, queue registry, schema migration, local Spur shim, manual package-version edit, or manual npm publish is out of scope.
### Plan
- [ ] 1. R1/R4 — Add failing constructor tests for event-enabled missing/invalid names and the silent-consumer compatibility control in `packages/infra/tests/job-queue/db-job-queue.test.ts`.
- [ ] 2. R1/R2/R3 — Add the config/detail fields and constructor invariant, then stamp the validated name onto the existing start/stop literals without changing event names, job events, scheduling, or drain behavior.
- [ ] 3. R2/R4 — Update typed manual emits and event-enabled fixtures; assert identity on started, normally drained stopped, and timed-out stopped paths while retaining all prior fact/severity assertions.
- [ ] 4. R3 — Update the ts-infra README event-enabled example/contract and add the candidate release changelog entry with explicit migration/breaking notes; leave barrels/export maps unchanged unless typecheck proves an actual gap.
- [ ] 5. R4/R5 — Run targeted tests: `bun test packages/infra/tests/job-queue/db-job-queue.test.ts packages/infra/tests/events.test.ts packages/infra/tests/job-queue-db.test.ts packages/infra/tests/subpaths.test.ts`.
- [ ] 6. R5 — Run upstream verification from the ts-libs root: `bun run spur-check`, `bun run build`, and intentional `git status`; commit the implementation on its isolated branch/worktree.
- [ ] 7. R5 — Reconfirm the next patch is unused (`package.json`, tags, and `npm view`), then hand the clean commit to the operator for `bun run bump-ver <version> --push`; do not create/push tags or publish manually.
- [ ] 8. R5 — Confirm the aggregate Publish run and npm version, then use Spur's CLI-owned section-update path to record the ts-libs implementation/release commits, tag/version, workflow evidence, and checks. Mark 0602 done only after publication; 0601 then consumes the recorded version.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature and exact scenario: `docs/features/J9_event-5w1h-payload-and-catalog-remediation.md` → R6
- Dependent Spur work: task 0601, `docs/tasks4/0601_implement-exhaustive-system-event-presenters-and-history-rep.md`
- Spur decisions/design: `docs/00_ADR.md` ADR-068; `docs/03_ARCHITECTURE.md` §16.1; `docs/design/event-tracking.md` §11
- Upstream agent/release contract: `/Users/robin/xprojects/ts-libs/AGENTS.md`; `/Users/robin/xprojects/ts-libs/docs/PACKAGE_RELEASE.md`
- Upstream decisions: `/Users/robin/xprojects/ts-libs/docs/00_ADR.md` ADR-001, ADR-003, ADR-013, ADR-014
- Prior lifecycle detail contract: `/Users/robin/xprojects/ts-libs/docs/tasks/0055_enrich-queue-eventbus-payloads-consumer-lifecycle-job-correl.md`
- Primary upstream source: `/Users/robin/xprojects/ts-libs/packages/infra/src/job-queue/types.ts`, `events.ts`, `job-queue/db-job-queue.ts`
- Primary upstream verification/docs: `/Users/robin/xprojects/ts-libs/packages/infra/tests/job-queue/db-job-queue.test.ts`, `tests/events.test.ts`, `tests/job-queue-db.test.ts`, `tests/subpaths.test.ts`, `packages/infra/README.md`, root `CHANGELOG.md`
- Premise evidence (2026-08-19): local manifests/tags and `npm view @gobing-ai/ts-infra version --json` reported `0.4.38`
### History
