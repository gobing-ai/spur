---
schema_version: 1
name: "Configurable scheduler jobs (interval + real cron) in ts-libs adapter and spur serve"
status: backlog
template: standard
created_at: 2026-09-02T06:54:51.770Z
updated_at: "2026-09-02T16:00:59.622Z"
feature_id: A2
---

## 0734. Configurable scheduler jobs (interval + real cron) in ts-libs adapter and spur serve

### Background
Task 0734 extends active feature A2 with operator-defined recurring commands while preserving the DB-backed queue. The corrected design keeps the entire consumer-facing scheduler surface under `bootstrap.scheduler` and moves its shared contract upstream. Premises were rechecked on 2026-09-02 against both working trees:

- `@gobing-ai/ts-infra@0.4.50` is the currently consumed lockstep family. Its `NodeSchedulerAdapter` accepts only positive millisecond strings, `* * * * *`, and `*/N * * * *`; every other expression throws `RangeError` during `register()`. The two owning scheduler suites are green (13 tests).
- Upstream `runNodeApplication` already extracts `bootstrap.scheduler`, creates the configured adapter, exposes it as `appRt.scheduler`, starts it after the user `start` callback, and stops it through the plugin lifecycle. `SchedulerOptions` currently carries `enabled`, `adapter`, `entries`, and `autoStart`, but no serializable jobs.
- `apps/server/src/serve.ts:398` currently creates, starts, and stops a second `NodeSchedulerAdapter` instead of registering against `appRt.scheduler`. With the production scheduler enabled, the upstream runtime also owns an adapter; keeping both is redundant lifecycle wiring.
- `packages/config/src/index.ts:808` intentionally excludes `bootstrap` because that subtree belongs to `runNodeApplication`. Scheduler jobs therefore must not be introduced as a separate top-level Spur config section or validated by a second Zod grammar.
- The existing queue already supplies retries and `queue.job.*` events; `registerSchedulerEntries` already emits `scheduler.job.executed`. The new path needs no table, endpoint, UI, or event name.

The single project-config surface is:

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: cache-efficiency
        intervalMinutes: 5
        command: python tools/rollup.py
      - name: nightly-rollup
        cron: '0 3 * * *'
        command: bun tools/nightly.ts
```

`@gobing-ai/ts-infra` validates and exposes these declarative jobs with the resolved scheduler config. Spur binds each job to its queue-backed command handler during the upstream runtime's `start` callback; it does not create another configuration namespace or scheduler lifecycle.
### Requirements
- [ ] R1. Extend `@gobing-ai/ts-infra` `NodeSchedulerAdapter.register()` to accept validated five-field cron in local process time: minute `0-59`, hour `0-23`, day-of-month `1-31`, month `1-12`, and day-of-week `0-7` (`0` and `7` are Sunday). Each field accepts `*`, `*/N` with positive `N`, comma-separated numbers/ranges, inclusive non-wrapping ranges, or one number. When both day fields are restricted, standard cron OR semantics apply. Wrong field count, out-of-range values, descending ranges, zero steps, empty list members, names/macros, and unsupported operators throw `RangeError` at registration; nothing silently falls back.
- [ ] R2. Preserve the three legacy interval forms in behavior: positive millisecond strings, `* * * * *`, and `*/N * * * *` remain `setInterval` cadences measured from adapter start. Other valid five-field expressions use self-rescheduling `setTimeout`, compute the next matching minute strictly after the current instant, use local wall-clock fields, and recompute only after the prior tick settles; cron ticks do not overlap and occurrences missed while a tick runs are skipped. Delays beyond the platform timer maximum are armed in safe chunks. `stop()` cancels either timer kind and drains an in-flight cron tick through the existing ADR-024 `drainTimeoutMs` path. Add `now?: () => number` to `NodeSchedulerAdapterConfig` as the deterministic clock seam.
- [ ] R3. Make `bootstrap.scheduler.jobs` an upstream ts-infra contract. Add and export `SchedulerJobConfig` with trimmed non-empty `name` and `command` plus exactly one of integer `intervalMinutes` in `1..35791` or a cron string using R1's grammar. Extend `SchedulerOptions` with `jobs?: readonly SchedulerJobConfig[]` and resolved `ApplicationBootstrapConfig.scheduler` with `jobs: readonly SchedulerJobConfig[]` defaulting to `[]`. `runNodeApplication` validates and normalizes every YAML/inline job regardless of `enabled`, rejects duplicate post-trim names case-sensitively, and throws `ConfigValidationError` before the user `start` callback with an issue path under `bootstrap.scheduler.jobs.<index>.<field>`. The adapter and config path share one internal cron parser; add no dependency and no public parser export.
- [ ] R4. Make the upstream runtime the sole scheduler lifecycle in `spur serve`. Register built-in and configured entries against `appRt.scheduler` during the user `start` callback, before ts-infra's last-registered scheduler plugin starts it. Read configured jobs only from `appRt.config.scheduler.jobs`; `appRt.config.scheduler.enabled` is the effective gate. Remove `StartServerDeps.createScheduler` and Spur's explicit scheduler `start()`/`stop()` calls. A disabled scheduler may retain validated job definitions but creates no adapter and runs nothing. Do not add a top-level `scheduler`, `SchedulerJobConfigSchema`, or cron validator to `packages/config`.
- [ ] R5. Mirror the upstream shape under the existing `bootstrap.scheduler` object in `apps/cli/schemas/spur-config.schema.json` and `config/config.example.yaml`. For each resolved configured job, `registerSchedulerEntries` registers one entry using either the cron string or `String(intervalMinutes * 60_000)`. A tick performs a normal non-coalesced queue enqueue of `scheduler.custom` with payload `{ name, command }`, inheriting the queue's existing three-total-attempt default. The scheduler event display name is `scheduler.custom:<name>`. An absent/empty jobs array leaves the built-in registrations unchanged.
- [ ] R6. Add `SCHEDULER_CUSTOM_JOB = 'scheduler.custom'` and an app-layer `handleSchedulerCustomJob` with strict payload validation. It executes the trusted project-local command as `/bin/sh -c <command>` through `ProcessExecutor.run`, with project-root `cwd`, buffered output capped at 1,000,000 bytes, a 3,600,000 ms timeout below the server queue's two-hour visibility timeout, and exit code as the only success verdict. A spawn/timeout/signal/non-zero result throws an error naming the job and exit result plus at most the final 400 characters of stderr (stdout only when stderr is empty), so queue retry/failure records receive bounded detail. Never include the full command or successful output in scheduler/queue events.
- [ ] R7. Reuse existing observability: each enqueue tick emits exactly one `scheduler.job.executed`; each attempt emits the existing `queue.job.completed`, `queue.job.retrying`, or `queue.job.failed` path through the current consumer. Persisted System Events and the Jobs tab identify the configured name without adding instrumentation, payload columns, tables, API routes, or UI components.
- [ ] R8. Complete the cross-repo handoff and documentation. In ts-libs, update the ts-infra README, architecture wording, and changelog; run targeted scheduler/application tests, `bun run spur-check`, and `bun run build`, then commit. Robin owns the documented lockstep `bun run bump-ver <next-unused-patch> --push` release and publication confirmation. In Spur, update every root `@gobing-ai/ts-*` catalog/exact pin required by lockstep policy, regenerate `bun.lock`, prove the installed ts-infra is the published version rather than a link, update `docs/04_DESIGN.md`, and pass `bun run spur-check`, `bun run test-cf`, and `bun run build`.

Out of scope: a second/top-level scheduler config, Spur-owned duplicate job/cron validation, direct command execution by ts-infra, six/seven-field cron, seconds, year, names, aliases/macros, `L/W/#/?`, per-job timezone/DST policy, per-job `enabled`, `cwd`, environment, retry, timeout, or concurrency controls, native Windows shell execution, Cloudflare scheduled-command execution, changing legacy interval alignment/overlap semantics, coalescing custom ticks, a new scheduler framework/dependency, new storage/API/UI/event surfaces, or release-workflow edits.
### Acceptance Criteria
Task scenarios retain feature A2 scenario titles verbatim; their steps narrow those feature outcomes to task 0734.

```gherkin
Feature: Embedded job queue and scheduler

  Scenario: Scheduler fires a registered cron entry
    Given the legacy schedules '60000', '* * * * *', and '*/5 * * * *'
    And real cron schedules '0 3 * * *', '* 3 * * *', and '30 8 1,15 * 1-5'
    When they are registered with NodeSchedulerAdapter
    Then every schedule is accepted and each legacy schedule retains its existing interval cadence
    And '0 25 * * *', '1-0 * * * *', '*/0 * * * *', and '0 3 * * MON' each throw RangeError during registration
    Given bootstrap.scheduler contains enabled true and two jobs with unique names
    When runNodeApplication loads the configuration
    Then appRt.config.scheduler.jobs contains the two normalized definitions
    And duplicate names, blank commands, unsafe interval values, both/neither schedule fields, and invalid cron abort startup with the exact bootstrap.scheduler.jobs.<index> field path
    When spur serve registers its entries
    Then built-in and custom entries are registered on appRt.scheduler before its upstream lifecycle starts
    And no second scheduler adapter is created, started, or stopped by Spur

  Scenario: Worker executes an enqueued job
    Given a configured scheduler job whose command is 'bun -e "process.exit(0)"'
    When its registered tick fires and the queue consumer handles scheduler.custom
    Then the payload is validated, the child runs in the project root through ProcessExecutor, and the job completes
    Given a configured command that writes 'tail-marker' to stderr and exits 7
    When its queue attempt runs
    Then the attempt retries or fails under the existing queue policy
    And last_error names the job and exit 7, contains a bounded stderr tail, and does not contain the full command

  Scenario: Graceful shutdown never orphans a claimed job
    Given TZ is America/Los_Angeles, cron is '30 1 * * *', and the clock crosses the 2026-11-01 25-hour fall-back day
    When next fires are recomputed from the injected clock
    Then both distinct 01:30 wall-clock instants are selected once
    Given a cron tick is in flight when appRt.stop is called
    When the action settles before drainTimeoutMs
    Then the upstream scheduler plugin waits for it and no later cron timer is armed
    And a command exceeding 3600000 ms is terminated and routed to queue retry/failure before the two-hour visibility timeout

  Scenario: Cloudflare entrypoint is unaffected
    Given SchedulerJobConfig is portable data and cron execution remains behind scheduler-node
    When the Cloudflare test and production build run
    Then the Workers bundle imports no Node scheduler or command child implementation
    And the ts-libs and Spur full checks named in R8 pass

  Scenario: Job stats are readable over the API
    Given one scheduler.custom job completed and one exhausted its retries
    When GET /api/jobs/stats is requested
    Then the existing completed and failed counts include those rows without an API change

  Scenario: Jobs tab shows queue activity on the board
    Given the System Events tap is active
    When a configured scheduler tick enqueues a successful job and another attempt fails
    Then persisted events include scheduler.job.executed and the corresponding queue.job.completed or queue.job.failed rows
    And the existing Jobs tab renders scheduler.custom:<name> and queue lifecycle activity without a new presenter
```
### Q&A
<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Where do configured jobs live?** Robin chose one consumer-facing scheduler object: `bootstrap.scheduler.jobs`. The earlier top-level `scheduler.jobs` proposal exposed the internal split between ts-infra bootstrap config and Spur app config, making one capability look like two unrelated settings. That proposal is superseded.

**What does ts-infra own?** The public `SchedulerJobConfig` shape, normalization and validation, cron grammar, resolved `appRt.config.scheduler.jobs`, adapter construction, and scheduler start/stop. This is one upstream contract and one parser, not parallel ts-infra and Spur schemas.

**What remains Spur-specific?** Binding a validated definition to the DB queue and executing its `command` through the existing process port. ts-infra treats `command` as declarative data and never runs it directly; otherwise scheduled commands would bypass Spur retry state and System Events.

**Which scheduler instance does Spur use?** Only `appRt.scheduler`. `runApplication` creates it before the user `start` callback and starts its scheduler plugin afterward, so Spur can register built-ins and configured jobs during `start`. The separate `createScheduler` dependency and manual start/stop path are removed.

**Is `* 3 * * *` valid?** Yes. It means every minute during local hour 03. Invalid examples exercise field range, range direction, zero step, and unsupported names.

**Which cron semantics are frozen?** Local process time, minute precision, `0|7 = Sunday`, and traditional day-of-month/day-of-week OR behavior when both are restricted. A fall-back hour can fire twice at two distinct instants; a nonexistent spring-forward minute does not fire. No per-job timezone is added.

**Do the legacy wildcard forms become wall-clock cron?** No. Exact `* * * * *` and `*/N * * * *` remain start-relative intervals, preserving existing users. Every other valid five-field expression uses the new wall-clock path.

**What does `command` mean?** It is an intentional POSIX shell command, executed by Spur as `/bin/sh -c`, matching the existing workflow shell contract and supporting quoting/pipes. It comes only from trusted local project config and its frozen queue payload; no request, event, or remote field is interpolated. `splitLaunchCommand` is not reused because it rejects quotes and shell syntax.

**How is a hung command bounded?** A fixed 60-minute ProcessExecutor timeout keeps the attempt below the server queue's two-hour visibility timeout. No per-job knob is added now; add one only when a real job needs a longer bound. Output is capped at 1 MiB and only a 400-character failure tail reaches `last_error`.

**Are custom ticks coalesced or serialized?** Neither. Every tick is a real non-coalesced queue enqueue; the existing consumer controls attempts/concurrency. Cron action execution itself does not overlap, but its action only enqueues. Per-name single-flight is deferred until duplicate command runs demonstrate a need.

**Does this task change Spur's tolerant `loadSpurConfig(...).catch(() => null)` path?** No. Scheduler jobs no longer pass through that loader, so the issue is unrelated to this task and is not bundled into the scheduler change. Invalid jobs fail in `runNodeApplication` before the user `start` callback.

**Who crosses the release boundary?** The implementation agent prepares and verifies a clean ts-libs commit. Robin owns the lockstep version/tag push and OIDC publication. The next patch is selected at release time; Spur proceeds only after registry verification and never uses `bun link` as delivery evidence.

**How does this remain traceable to feature A2?** The task reuses A2's existing scenario titles exactly. It elaborates the scheduler, worker, shutdown, Cloudflare, stats, and Jobs-tab outcomes without changing the feature file.
### Design
**Upstream config contract — WHAT/WHERE.** In `ts-libs/packages/infra/src/scheduler/types.ts`, add the exported portable data type:

```ts
export type SchedulerJobConfig =
    | { readonly name: string; readonly command: string; readonly intervalMinutes: number; readonly cron?: never }
    | { readonly name: string; readonly command: string; readonly cron: string; readonly intervalMinutes?: never };
```

Re-export the type from the existing scheduler/main and `/application` surfaces. In `application/types.ts`, add `jobs?: readonly SchedulerJobConfig[]` to `SchedulerOptions` and required `jobs: readonly SchedulerJobConfig[]` to resolved `ApplicationBootstrapConfig.scheduler`. In `application/index.ts`, copy `schedOpts.jobs ?? []` into the resolved config; definitions are data for the user callback and are not automatically executed. This is additive and keeps the main barrel portable because the export is type-only.

In `application-node.ts`, add internal `normalizeSchedulerJobs(raw: unknown): readonly SchedulerJobConfig[]`. It accepts only object entries, trims `name`, `command`, and `cron`, enforces schedule XOR and `intervalMinutes` bounds, validates cron through the shared internal parser, detects duplicate trimmed names case-sensitively, and throws `ConfigValidationError` with `bootstrap.scheduler.jobs.<index>.<field>`. Normalize jobs whether the scheduler is enabled or disabled, forward them through `schedulerConfig`, and default to `[]`; construct an adapter only when enabled. Do not add Zod or another dependency.

**Upstream cron adapter — WHAT/WHERE.** Extract the pure internal cron grammar/matching functions to `packages/infra/src/scheduler/cron.ts`, which is not added to `package.json` exports. `application-node.ts` uses its validator and `scheduler/node.ts` uses the same parsed representation, eliminating grammar duplication. Keep `parseInterval(schedule)` in `node.ts` for the three legacy forms; other five-field strings route through `parseCronExpression(schedule)`. Make `ScheduledEntry` a discriminated `interval | cron` union. The only new adapter API is optional `NodeSchedulerAdapterConfig.now?: () => number`.

`parseCronExpression` produces allowed-value sets plus wildcard flags for minute, hour, day-of-month, month, and day-of-week. Lists contain numbers or inclusive non-wrapping ranges; `*/N` is a whole-field form. Day-of-week `7` normalizes to `0`. Matching requires minute/hour/month plus the standard day rule: when both day fields are wildcards both pass; when one is wildcard the restricted field must match; when both are restricted either may match.

`nextCronTime` starts at the next epoch-minute boundary and scans forward in one-minute increments using local `Date` fields. It is bounded to eight calendar years so an unsatisfiable expression fails during registration; add a `ponytail:` comment naming this small-job-count O(minutes) ceiling and the field-jumping upgrade only if measured startup cost requires it. Registration parses once and verifies that a next occurrence exists.

Interval entries retain `setInterval`. Cron entries retain their target epoch and use `setTimeout`; arm at most `2_147_483_647` ms, and on a chunk wake re-check `now()` before firing. After `_onScheduledTick` settles, compute the next occurrence strictly from current `now()` and re-arm only while running. This prevents overlap and skips missed instants. `stop()` flips `running` first, clears either timer kind, and drains the shared `inflight` set through ADR-024. Extend `packages/infra/tests/scheduler/node.test.ts` for grammar/timers/DST, `tests/scheduler-node.test.ts` for cron drain, `tests/application-node.test.ts` for YAML validation and paths, and `tests/application.test.ts` for resolved jobs and lifecycle order.

**Spur config surface — WHAT/WHERE.** Extend only the existing `bootstrap.scheduler` object in `apps/cli/schemas/spur-config.schema.json` with the jobs array and structural XOR/range constraints, and place the nested commented example in `config/config.example.yaml`. Add a JSON-schema loader test for valid/invalid nested shapes. Do not add a top-level `scheduler`, a Zod scheduler schema, or a config-to-infra dependency in `packages/config`; its loader may continue dropping `bootstrap` from `SpurConfig` because server scheduling reads the upstream resolved runtime config.

**Spur server composition — WHAT/WHERE.** In `apps/server/src/serve.ts`, delete `StartServerDeps.createScheduler`, `defaultDeps.createScheduler`, the second-adapter construction block, the explicit scheduler `start()`, and the signal-handler scheduler `stop()`. Use `appRt.scheduler` as the sole adapter. It exists before the user callback when `appRt.config.scheduler.enabled` is true, and ts-infra's scheduler plugin starts after that callback and stops during `appRt.stop()`.

Change `registerSchedulerEntries` to accept `jobs: readonly SchedulerJobConfig[] = []` in addition to the existing Spur config needed by history refresh. During `start`, call it once with `appRt.scheduler`, the server context, the existing Spur config, and `appRt.config.scheduler.jobs`. Its configured loop is:

```text
for job of jobs
  schedule = job.cron ?? String(job.intervalMinutes * 60_000)
  register(schedule, "scheduler.custom:" + job.name, enqueue scheduler.custom {name, command})
```

Use ordinary `queue.enqueue` with no retry override or coalescing key. The existing `register` wrapper remains the sole `scheduler.job.executed` producer; success means enqueue succeeded, while `queue.job.*` reports command-attempt outcome. Tests prove all entries use the runtime-owned adapter, it starts/stops once through ts-infra, empty jobs preserve built-ins, and configured interval/cron jobs enqueue exact payloads.

**Spur command handler — WHAT/WHERE.** Add `packages/app/src/services/scheduler-custom-job-service.ts` and export it from `packages/app/src/index.ts`:

- `SCHEDULER_CUSTOM_JOB = 'scheduler.custom'`
- `SchedulerCustomJobPayload { name: string; command: string }`
- `SchedulerCustomJobDeps { cwd: string; executor: ProcessExecutor; timeoutMs?: number }`
- `validateSchedulerCustomJobPayload(raw)`
- `handleSchedulerCustomJob(deps, job)`

The handler validates the queue boundary, then calls `executor.run({ command: '/bin/sh', args: ['-c', payload.command], cwd, timeout: deps.timeoutMs ?? 3_600_000, maxOutput: 1_000_000, forceBuffered: true, rejectOnError: false })`. A null/non-zero exit throws bounded detail as R6 specifies. Reuse one `NodeProcessExecutor` for the server's child-backed handlers. Do not use `splitLaunchCommand`, log the command, parse stdout, introduce a shell library, or emit output on success. Unit tests use a structural fake executor for payload/options/error cases plus one real Bun smoke child.

**Docs, release, and handoff.** In ts-libs, update `packages/infra/README.md`, `docs/03_ARCHITECTURE.md` (real cron plus declarative job config/runtime ownership), and root `CHANGELOG.md`; no new ADR is required because the scheduler remains behind the existing application/scheduler subpaths and ADR-024 remains authoritative for drain. Read ts-libs `docs/99_PROJECT_CONSTITUTION.md` before numbered-doc edits. After upstream checks and commit, pause for Robin's lockstep release. In Spur, update all lockstep family catalog/exact pins and `bun.lock`, then update `docs/04_DESIGN.md` through `sp:doc-evolve` with the single nested config surface, runtime-owned lifecycle, trusted-shell boundary, retry/timeout behavior, and observability split.

**Cross-task contract.** No same-corpus `dependencies[]` exist. This task consumes feature A2's shipped queue/scheduler seams (0190/0200/0201), ts-libs ADR-024, and task 0060 F7's fail-loud invariant; it supersedes only 0060's task-local "do not implement real cron" scope limit. The immutable cross-repo handoff is the published lockstep version plus upstream implementation/release commits recorded in this task's Solution/Testing. No dependent work may consume an unpublished or locally linked build.

**Anti-patterns.** Do not add a top-level Spur scheduler block, duplicate Zod/cron grammar, second scheduler adapter, manual server scheduler lifecycle, default command execution in ts-infra, cron npm package, generic command framework, per-job DAO/table, new event, UI panel, CLI noun/verb, config migration, public parser export, direct `Bun.spawn`/`child_process`, raw command/output event payload, fixed-delay cron approximation, minute polling loop, legacy interval behavior change, or release-workflow edit.
### Plan
- [ ] 1. Reconfirm both repositories' implementation baselines; record current ts-libs commit/version and Spur pins. Read ts-libs `AGENTS.md`, `docs/99_PROJECT_CONSTITUTION.md`, ADR-014/ADR-024, and task 0060 F7 before upstream edits (R1-R4, R8).
- [ ] 2. In `ts-libs/packages/infra`, add failing cron grammar/range/day-OR/legacy-interval tests and an injected-clock fall-back-DST next-fire test in `tests/scheduler/node.test.ts`; extend `tests/scheduler-node.test.ts` with an in-flight cron drain case (R1, R2).
- [ ] 3. Implement the dependency-free internal cron module, parsed adapter union, next-minute scan, long-timeout chunking, non-overlap reschedule, and shared stop drain. Run `bun test tests/scheduler/node.test.ts tests/scheduler-node.test.ts` from `packages/infra` (R1, R2).
- [ ] 4. Add failing application/application-node tests for the public `SchedulerJobConfig`, nested YAML normalization, exact error paths, name uniqueness, schedule XOR/bounds, shared cron vectors, jobs default/preservation while disabled, and user-callback-before-scheduler-start order. Implement the types and bootstrap forwarding/validation without default command execution or a new dependency (R3, R4).
- [ ] 5. Update the ts-infra README, architecture wording, and changelog; run ts-libs `bun run spur-check`, `bun run build`, and `git status --short`, then commit the upstream implementation (R8).
- [ ] 6. Pause for Robin to choose the next unused lockstep patch and run the documented `bun run bump-ver <version> --push`. Confirm the aggregate publish run and registry version; record implementation commit, release commit/tag/run, and exact version. Do not publish manually or edit workflows (R8).
- [ ] 7. In Spur, update every lockstep `@gobing-ai/ts-*` catalog/exact pin required by current policy, regenerate `bun.lock`, and verify `node_modules/@gobing-ai/ts-infra/package.json` resolves the published version with no link/symlink (R8).
- [ ] 8. Add a JSON-schema loader test for nested `bootstrap.scheduler.jobs`; extend the existing bootstrap scheduler schema and config example. Assert no top-level scheduler key and no `packages/config` runtime/schema dependency were added (R3, R5).
- [ ] 9. Add `scheduler-custom-job-service.test.ts` first, covering strict payloads, exact ProcessExecutor options, success, null/non-zero exit, bounded stderr/stdout fallback, timeout, command redaction, and one real Bun smoke child. Implement and export the app service (R6).
- [ ] 10. Extend `apps/server/tests/serve.test.ts` to prove `appRt.scheduler` is the only adapter, registration precedes its single upstream start, `appRt.stop()` owns its single stop, empty jobs preserve built-ins, configured jobs register exact schedules/display names/payloads, and the custom handler is wired. Remove Spur's duplicate adapter and manual lifecycle, then register resolved upstream jobs (R4, R5).
- [ ] 11. Add one migrated-DB integration assertion that fires a registered custom tick, processes the queue, and verifies completed/failed state plus persisted `scheduler.job.executed` and `queue.job.*` rows. Reuse current context/event-tap helpers; add no new harness (R7).
- [ ] 12. Update `docs/04_DESIGN.md` through `sp:doc-evolve` and run its sync-check. Document the one nested scheduler surface, ts-infra/Spur ownership seam, local-time cron semantics, trusted-shell boundary, retry/timeout/output bounds, and enqueue-vs-attempt observability (R8).
- [ ] 13. Run targeted workspace tests first, then from the Spur root run `bun run autofix`, `bun run spur-check`, `bun run test-cf`, `bun run build`, `spur task check 0734 --json`, one final `bun run corpus-check`, and `git status --short`. Record commands/results and both repositories' immutable release evidence before verification (R1-R8).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/A2_embedded-job-queue-and-scheduler.md:14`; shipped seams: tasks 0190, 0200, and 0201.
- Current Spur scheduler registration and duplicate lifecycle: `apps/server/src/serve.ts:105`, `apps/server/src/serve.ts:124`, `apps/server/src/serve.ts:398`, `apps/server/src/serve.ts:515`, and `apps/server/src/serve.ts:557`.
- Queue/event wiring: `apps/server/src/context.ts:615`, `packages/app/src/services/job-worker-service.ts:10`, and `packages/app/src/services/event-names.ts:259`.
- Child-process precedent: `packages/app/src/services/history-refresh-service.ts:227` and `packages/app/src/workflow/actions/shell.ts:45`.
- Existing config ownership: `config/config.example.yaml:14`, `packages/config/src/index.ts:808`, and `apps/cli/schemas/spur-config.schema.json:22`.
- Dependency/release consumption: `package.json:29`, `package.json:95`, and `bun.lock:406`.
- Upstream scheduler config/runtime: `ts-libs packages/infra/src/application/types.ts:77`, `ts-libs packages/infra/src/application/index.ts:124`, `ts-libs packages/infra/src/application/index.ts:231`, and `ts-libs packages/infra/src/application-node.ts:250`.
- Current upstream parser and rejection tests: `ts-libs packages/infra/src/scheduler/node.ts:15` and `ts-libs packages/infra/tests/scheduler/node.test.ts:91`.
- Upstream boundaries and drain decision: `ts-libs docs/00_ADR.md:226` (ADR-014), `ts-libs docs/00_ADR.md:360` (ADR-024), and `ts-libs docs/03_ARCHITECTURE.md:59`.
- Prior fail-loud constraint: `ts-libs docs/tasks/0060_fix-2026-08-12-packages-secua-and-architecture-review-findin.md:436`.
- Upstream release contract: `ts-libs AGENTS.md:1`, `ts-libs docs/PACKAGE_RELEASE.md:1`, and `ts-libs packages/infra/package.json:1`.
- Premise checks on 2026-09-02: upstream scheduler suites 13 pass/0 fail; Spur config suites 81 pass/0 fail; Spur server serve suite 36 pass/0 fail; both repository status checks captured before refinement.
### History
