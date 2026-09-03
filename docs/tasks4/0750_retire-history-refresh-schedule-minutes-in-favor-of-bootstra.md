---
schema_version: 1
name: "Retire history.refresh.schedule_minutes in favor of bootstrap.scheduler.jobs"
status: wip
template: standard
created_at: 2026-09-03T18:15:52.095Z
updated_at: "2026-09-03T18:49:39.301Z"
feature_id: A2
---

## 0750. Retire history.refresh.schedule_minutes in favor of bootstrap.scheduler.jobs

### Background

Task 0734 shipped `bootstrap.scheduler.jobs` as the one consumer-facing surface for
operator-defined recurring work: a validated declarative entry (interval or real cron),
registered by the upstream `runNodeApplication`-owned scheduler, whose tick enqueues a
`scheduler.custom` queue job that the server's worker runs through `/bin/sh -c`.

Task 0696 had earlier added a second, history-specific scheduling surface:
`history.refresh.schedule_minutes` in the Spur app config. It registered its own interval
entry in `registerSchedulerEntries` and enqueued the coalesced `history.refresh` job with
`trigger: 'schedule'`. Two config keys in the same `.spur/config.yaml` therefore expressed
"run this every N minutes", validated by two different grammars in two different packages
(`packages/config` Zod vs. upstream ts-infra), with two different registration paths.

Robin's decision (2026-09-03): 0734 exists to centralize periodic execution. The 0696
key is exactly the kind of parallel mechanism it replaces, so it is retired rather than
kept alongside. Enhancements to the shared scheduler surface (per-name coalescing,
per-job env) are tracked separately and are not a reason to keep a second mechanism.

Completion-triggered refresh (task 0549: `on_completion`, `debounce_ms`) is a different
trigger — bound to work completing, not to a clock — and is out of scope here.

### Requirements

- [x] R1. Remove `schedule_minutes` from `HistoryRefreshConfigSchema` and `scheduleMinutes`
      from `HistoryRefreshTriggerConfig` / `resolveHistoryRefreshTrigger`. A stale key in an
      existing config resolves to the completion-trigger shape only and never resurrects a
      second scheduling path.
- [x] R2. Remove the interval registration from `registerSchedulerEntries`. Its built-ins
      are the system-events prune and smoke entries only; it no longer reads project config,
      so the `spurConfig` parameter is dropped from the signature and its call site.
- [x] R3. Remove the config-gated `'schedule'` branch from `enqueueHistoryRefresh`. Keep
      `'schedule'` in `HistoryRefreshTriggerPoint` and in `validateHistoryRefreshPayload` so
      queue rows and System Events persisted by the retired path still validate; a caller
      passing it falls back to the `on_completion` gate rather than scheduling silently.
- [x] R4. Migrate this repo's `.spur/config.yaml`: drop the `history:` block and declare the
      10-minute refresh as a `bootstrap.scheduler.jobs` entry. The command uses the
      repo-local CLI (`bun apps/cli/spur.js`), never a global `spur` that may be a stale
      bundle (AGENTS.md history-validation rule).
- [x] R5. Update `docs/04_DESIGN.md` (T3): replace the 0696 schedule-trigger paragraph with
      the shared-scheduler surface, and record the two capabilities the migration gives up —
      shared single-flight with the completion trigger, and the handler's
      `DATABASE_URL`/`resolveSpurBin` plumbing — as open enhancements against the scheduler
      surface, not as reasons to keep a second mechanism.
- [x] R6. No new config key, schema, event, table, CLI verb, or scheduler adapter. The JSON
      schema needs no edit: it never exposed `schedule_minutes`, and
      `bootstrap.scheduler.jobs` already carries the 0734 shape.

Out of scope: the `on_completion` / `debounce_ms` completion trigger, per-name coalescing
or per-job env for `scheduler.custom`, and any change to the `history.refresh` job body.

### Acceptance Criteria

```gherkin
Feature: Embedded job queue and scheduler

  Scenario: Scheduler fires a registered cron entry
    Given a project config with no history-specific scheduling key
    When spur serve registers its scheduler entries
    Then only the system-events prune and smoke built-ins are registered
    And a bootstrap.scheduler.jobs entry named history-refresh registers one 600000 ms entry
    And registerSchedulerEntries takes no project-config argument

  Scenario: Worker executes an enqueued job
    Given the migrated .spur/config.yaml is loaded by runNodeApplication
    Then appRt.config.scheduler.jobs contains exactly the normalized history-refresh job
    And its tick enqueues scheduler.custom, which the worker runs through /bin/sh -c

  Scenario: Graceful shutdown never orphans a claimed job
    Given a queue row or System Event persisted by the retired interval path
    When its payload is validated
    Then trigger 'schedule' is still accepted
    And enqueueHistoryRefresh with trigger 'schedule' returns disabled while on_completion is false
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T18:32:48.825Z

**Why not keep both?** Two keys in one config expressing "every N minutes" is the exact
duplication 0734 was created to remove. There is now one scheduling grammar (upstream),
one registration path (`registerSchedulerEntries`), and one job lane for periodic work.

**Why does `'schedule'` stay in the trigger union?** Queue rows and System Events
persisted by the retired path carry `trigger: 'schedule'`; removing the value would make
their payloads fail `validateHistoryRefreshPayload`. It is accepted data, not a live
trigger — nothing enqueues with it, and a caller passing it hits the `on_completion` gate.

**What was given up?** (a) Periodic refresh no longer coalesces with the completion
trigger through `enqueueHistoryRefresh`'s single-flight row; ticks are non-coalesced
`scheduler.custom` enqueues. (b) No `DATABASE_URL`/`resolveSpurBin` plumbing — the
command's own `cwd` resolves the DB, and the operator pins the binary in the command.
Both are open enhancements against the shared scheduler surface, tracked separately.

**Why `bun apps/cli/spur.js` in the command?** AGENTS.md's history-validation rule:
real-data history work uses the source-local CLI, never a potentially stale global `spur`.
The bundled `apps/cli/spur.js` is rebuilt by `build:bundle` on every release.

**Why no JSON-schema change?** `schedule_minutes` was never mirrored into
`spur-config.schema.json` (the `history.refresh` mirror carries only `on_completion` and
`debounce_ms`), and `bootstrap.scheduler.jobs` already carries the 0734 shape.

### Design

**Removal, not replacement.** `history.refresh.schedule_minutes` is deleted from
`HistoryRefreshConfigSchema` (`packages/config/src/index.ts`) and `registerSchedulerEntries`
(`apps/server/src/serve.ts`) no longer takes `spurConfig`. Periodic execution lives
exclusively under `bootstrap.scheduler.jobs`.

**Payload compatibility seam.** The only piece of the old path that survives is the
`'schedule'` string in `HistoryRefreshTriggerPoint`/`validateHistoryRefreshPayload` —
persisted queue rows stay valid. The enqueue gate loses its schedule branch.

**Config migration (dogfood).** `.spur/config.yaml` drops its `history:` block and gains:

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: history-refresh
        intervalMinutes: 10
        command: bun apps/cli/spur.js --no-logo history daily
```

The tick enqueues `scheduler.custom { name, command }`; the worker runs it through
`/bin/sh -c` in the project root with a 60-min timeout and 1 MiB output cap (0734 R6).

### Plan

- [x] 1. Create task 0750 from a clean decision point (0734 done).
- [x] 2. Remove `schedule_minutes`/`scheduleMinutes` from config schema + resolver (R1).
- [x] 3. Remove the interval registration and the `spurConfig` parameter from
      `registerSchedulerEntries` + call site (R2).
- [x] 4. Remove the `'schedule'` gate branch from `enqueueHistoryRefresh`; keep the
      payload value for row compatibility (R3).
- [x] 5. Migrate `.spur/config.yaml` to `bootstrap.scheduler.jobs` (R4).
- [x] 6. Update `docs/04_DESIGN.md` with the new surface and the recorded trade-off (R5).
- [x] 7. Rewrite the affected tests: config resolver, enqueue gate, registration set (R1–R3).
- [x] 8. Verify: targeted tests, full `spur-check`, `test-cf`, build, resolved-config probe.

### Solution

- `packages/config/tests/config-schemas.test.ts:89` — dropped `schedule_minutes` from
  `HistoryRefreshConfigSchema`, `scheduleMinutes` from `HistoryRefreshTriggerConfig`,
  and the resolver branch (R1).
- `apps/server/src/serve.ts:139` — `registerSchedulerEntries(scheduler, ctx, jobs)`; built-ins
  are prune + smoke only; removed `enqueueHistoryRefresh`/`resolveHistoryRefreshTrigger`/
  `SpurConfig` imports from the registration path (R2). The `history.refresh` queue
  consumer (completion trigger, task 0549/0717) is untouched.
- `packages/app/src/services/history-refresh-service.ts:170` — removed the schedule gate;
  `'schedule'` stays in the trigger union as a persisted-payload value only (R3).
- `.spur/config.yaml:33` — `history:` block removed; `bootstrap.scheduler.jobs` gains
  `history-refresh` (10 min, repo-local bundle) (R4).
- `docs/04_DESIGN.md:806` — 0696 paragraph replaced with the shared-scheduler description and
  the recorded trade-off; config snippet updated (R5).
- Tests rewritten: `packages/config/tests/config-schemas.test.ts`,
  `packages/app/tests/services/history-refresh-service.test.ts`,
  `apps/server/tests/serve.test.ts` (unused `createMigratedDb` import dropped).

### Testing

- `packages/config`: 14 pass / 0 fail — retired key resolves to completion shape only.
- `packages/app`: 20 pass / 0 fail — `'schedule'` falls back to the on_completion gate;
  persisted rows still validate.
- `apps/server`: 38 pass / 0 fail — registration is prune + smoke only; configured jobs
  unchanged; unused import removed (typecheck clean).
- Resolved-config probe via `runNodeApplication` against `.spur/config.yaml`:
  `{enabled:true, jobs:[{name:'history-refresh', command:'bun apps/cli/spur.js --no-logo
  history daily', intervalMinutes:10}]}` — the migrated job survives upstream validation.
- `bun apps/cli/spur.js --no-logo history daily --help` resolves the bundle the command
  names (path-independent of a global install).
- `bun run spur-check` PASS (7149 pass / 0 fail); `bun run test-cf` PASS;
  `bun run build` PASS; `bun run lint` clean.
- First `spur-check` run showed 26 flakes from concurrent-DB contention; rerun green.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-09-03T18:49:39.301Z todo → wip (system)
