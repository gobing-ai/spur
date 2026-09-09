# Server bootstrap and scheduler contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="5-serverweb-surface-current-slice"></a>

## 5. Server/Web Surface (current slice)

| Endpoint            | Source                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `GET /api/health`   | oRPC `health` procedure → `{ status, timestamp, service, version }` |
| `GET /openapi.json` | Generated from the oRPC contract                                    |
| `GET /`             | Redirect to `/api/health`                                           |

Web (`apps/web`) renders live health from the typed oRPC client. Deeper read surface is Phase 4.

<a id="51-bootstrap-adr-019-adr-036"></a>

### 5.1 Bootstrap (ADR-019, ADR-036)

The server bootstraps through `@gobing-ai/ts-infra` using a runtime-aware split:

| Entry                        | Bootstrap            | Subpath                     | Workers-Safe?       |
| ---------------------------- | -------------------- | --------------------------- | ------------------- |
| `src/index.ts` (Bun)         | `runNodeApplication` | `ts-infra/application-node` | No (uses `node:fs`) |
| `src/worker.ts` (CF Workers) | `runApplication`     | `ts-infra/application`      | Yes                 |

**Runtime seams:**

| Export                       | Runtime | Role                                                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `serverBootstrapConfig(env)` | Shared  | Portable `logging`/`telemetry`/`events` config with test-mute guard                         |
| `createApp(appRt?, opts?)`   | Bun     | Full Hono module registry, oRPC context, and local static assets                            |
| `createWorkerApp(env?)`      | Workers | Health, readiness, project identity, OpenAPI, and explicit 503 for local-runtime API routes |

The Worker entry uses a **lazy singleton** (`let rtPromise`) — no top-level await, `runApplication`
initialized on first `fetch`. Its static asset directory is `../../dist/web`, resolved relative to
`apps/server/wrangler.toml`. The Bun entry uses `runNodeApplication` mirroring the CLI (ADR-017).

<a id="52-scheduler-surface--bootstrapscheduler-task-0734"></a>

### 5.2 Scheduler surface — `bootstrap.scheduler` (task 0734)

| Planned surface | Status | Detail |
| --- | --- | --- |
| Shared execution deadlines, explicit unlimited mode and renewable job ownership (A21) | Shipped: deadlines + unlimited mode in ts-libs 0.4.59 (task 0813); lease/claim ownership pending upstream | [Execution deadlines](execution-deadlines.md) |

Recurring commands are declared in **one** place: the `bootstrap.scheduler` object that
`runNodeApplication` already owns. There is no top-level Spur `scheduler` section and no second
cron grammar in `packages/config` — `bootstrap` is deliberately excluded from the Spur Zod schema
(`packages/config/src/index.ts`), so adding one there would fork validation.

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: nightly-import
        cron: "30 2 * * *" # five fields, local wall-clock time
        command: bun run load-history
      - name: hourly-analyze
        intervalMinutes: 60 # 1..35791; mutually exclusive with `cron`
        command: spur history analyze
```

Mirrored for editor completion in `apps/cli/schemas/spur-config.schema.json` and documented in
`config/config.example.yaml`. The JSON Schema is an IDE aid only — `runNodeApplication` is the
validator of record and aborts startup with an issue path under
`bootstrap.scheduler.jobs.<index>.<field>`.

**Ownership seam.** `@gobing-ai/ts-infra` owns the contract and the lifecycle; Spur owns execution:

| Concern                                                        | Owner                                            |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `SchedulerJobConfig` shape, validation, normalization           | ts-infra (`/application`)                        |
| Cron parsing and the `NodeSchedulerAdapter` timers              | ts-infra                                         |
| Adapter construction, `start()`, `stop()`                       | ts-infra runtime (`appRt.scheduler`)             |
| Binding each job to a queue entry                               | `registerSchedulerEntries` (`apps/server/src/serve.ts`) |
| Running the command                                             | `handleSchedulerCustomJob` (`packages/app`)      |

`spur serve` registers built-in **and** configured entries against `appRt.scheduler` inside the
`start` callback — which runs before ts-infra's scheduler plugin starts the adapter — and reads
configured jobs only from `appRt.config.scheduler.jobs`. `StartServerDeps.createScheduler` is gone:
a second Spur-owned adapter would have run every entry twice once the production scheduler was
enabled. `appRt.config.scheduler.enabled` is the effective gate; a disabled scheduler still carries
validated job definitions but creates no adapter and runs nothing.

**Cron semantics.** Five fields (minute hour day-of-month month day-of-week), evaluated in **local
process wall-clock time** — no timezone or DST policy per job. `ts-infra` keeps the three legacy
interval forms (`"600000"`, `* * * * *`, `*/N * * * *`) on `setInterval`; every other valid
expression self-reschedules with `setTimeout` to the next matching minute, never overlaps its own
tick, and skips occurrences missed while a tick runs. Anything outside the grammar throws
`RangeError` at registration — nothing silently degrades to a 60-second fallback.

**Trust boundary.** `command` is trusted operator input from the project's own config file, executed
as `/bin/sh -c <command>` with the project root as `cwd`. It is never echoed into an event payload
or a log line — only the job `name` is. Spur adds no per-job `cwd`, `env`, `enabled`, timeout, or
concurrency knob; a job that needs those wraps them in the script it invokes.

**Execution bounds** (`handleSchedulerCustomJob`): buffered output capped at 1,000,000 bytes, a
native execution deadline of 600,000 ms (task 0813) — overridable per job/environment via
`SPUR_SCHEDULER_TIMEOUT_<NAME>_MS` and `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` (positive-integer
milliseconds; `'none'` removes the deadline; anything else falls back to the default), deliberately
under the server queue's two-hour visibility timeout so the queue never reclaims a still-running
command — and the child's exit outcome as the only success verdict (a deadline kill yields a
truthful timed-out failure). A non-zero exit, signal, or spawn failure
throws an error naming the job plus at most the final 400 characters of stderr (stdout only when
stderr is empty), so retry and failure records carry bounded, non-secret detail. A kill at or
beyond the resolved deadline (`exitCode === null` with `durationMs >= timeoutMs`, the shared
`isTimeoutResult` classifier in `packages/app`) is labeled `timed out after <n>ms (killed)` in the
error, so a wedged child is distinguishable from an externally signaled one; the same resolved
timeout bounds the `history daily` child (`handleHistoryRefreshJob`) so both periodic paths share
one number per daemon.

**Observability — enqueue vs. attempt.** The two are separate on purpose and reuse existing events:

| Event                                                     | Emitted by            | Means                                   |
| --------------------------------------------------------- | --------------------- | --------------------------------------- |
| `scheduler.job.executed` (name `scheduler.custom:<name>`) | the scheduler tick    | the tick fired and enqueued (or failed to) |
| `queue.job.completed` / `.retrying` / `.failed`           | the queue consumer    | one execution **attempt** of the command |

A tick is a normal non-coalesced enqueue of `scheduler.custom` with payload `{ name, command }` and
`maxRetries: 1` (task 0803 R3): one attempt per enqueue, and a failed attempt goes terminal instead
of re-pending — a `pending` row counts as active in the single-flight lookup, so queue-level
retries would suppress later ticks for the whole backoff window. The next tick is the retry for an
idempotent periodic command. The same tick sweeps a wedged row (task 0803 R4): a `processing` row
whose `processing_at` (falling back to `updated_at`) is older than the resolved timeout is failed
in place by `failStaleSchedulerCustomJob` (guarded `status = 'processing'` update, reported via a
`swept: true` `scheduler.job.executed` event) and a fresh job is enqueued on that same tick — no
daemon restart needed. Younger processing rows and any pending row keep the single-flight skip.
No new table, column, event name, API route, or UI component: the Jobs tab and System Events
already render both families.

<a id="6-plugin-system-removed--adr-012-amended-2026-06-09"></a>

## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

> **Amendment (2026-06-09):** The standalone `@gobing-ai/spur-plugin-sdk` is deleted. The bare
> lifecycle core (`Plugin` + `PluginHost`) lives upstream in `@gobing-ai/ts-infra` (shipped in
> `0.3.6`). Capability registries, trust ladder, manifest-driven discovery, and the server route
> seam are **deferred** — re-addable later on top of the ts-infra `Plugin` interface when a real
> plugin consumer exists. Mechanism lives in `03 §11`.

<a id="61-current-state"></a>

### 6.1 Current state

Spur consumes the ts-infra `Plugin` interface directly:

```ts
import type { Plugin, PluginHost } from "@gobing-ai/ts-infra/application";
```

The `Plugin` interface provides lifecycle hooks only: `onLoad`, `onStart`, `onStop`, `onUnload`,
plus `failFast`. The `PluginHost` drives registration and lifecycle fan-out (load → start →
stop → unload) with fail-fast load, fail-soft start/stop/unload in reverse registration order.

The `runApplication` / `runNodeApplication` bootstrap accepts `plugins`/`pluginHost` options
and drives the plugin lifecycle natively — no Spur-side host wiring needed.

<a id="62-deferred-not-permanently-rejected"></a>

### 6.2 Deferred (not permanently rejected)

| Concern                  | Status  | Notes                                                                                           |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Manifest (`plugin.yaml`) | Removed | Re-addable as YAML + Zod on the ts-infra `Plugin` interface                                     |
| Capability registries    | Removed | 9 registries (api, command, event, harness, provider, rule, skill, ui, worker) — re-addable     |
| Trust ladder             | Removed | 4-tier (`bundled` > `curated` > `local` > `untrusted`) — re-addable as registration-time gating |
| CLI plugin command       | Removed | `spur plugin list                                                                               | info` — re-addable when plugin discovery returns |
| Server route seam        | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist               |
| Plugin config override   | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable                                             |
| Event registry           | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable                               |
