---
title: "System Events observability — tooltip enrichment, scheduler field fix, producer audit, queue name threading"
date: 2026-07-09
topic: observability-system-events-enrichment
needs_design: true
---

# Brainstorm — System Events observability enrichment

## Overview

The System Events tab (`apps/web/src/modules/observability/SystemEventsTab.tsx`) surfaces the
server's EventBus ledger as a sortable table with typed detail renderers and a compact hover/focus
tooltip (`buildTooltipSummary`). Three observability gaps surfaced after tasks 0189–0226 built the
catalog, tap, and SSE delivery:

1. **Tooltip/detail thinness.** `buildTooltipSummary` (`SystemEventsTab.tsx:263-366`) extracts only
   `Job` + `ID` for the `queue`/`scheduler` renderers (lines 300-306), dropping duration, status,
   error, and cron schedule. The `message`, `process`/`agent`, `rule`, and `api` renderer branches
   are similarly minimal (1-2 fields). The tooltip, which is the at-a-glance signal that replaced
   row-expand in task 0223, shows too little to be useful for diagnostics.

2. **Scheduler field-name mismatch (BUG).** `serve.ts:85` emits
   `{ kind, cron, durationMs }` for `scheduler.job.executed`, but the contract type
   `SchedulerJobExecutedDetail` (`ts-libs/packages/infra/src/events.ts:48-55`) expects
   `{ name, durationMs, error? }`. The mismatch is invisible at compile time because
   `ServerEventMap` is typed as `Record<string, (detail: unknown) => void>` (`context.ts:68`) and
   every bus handoff uses `as unknown as never` / `as unknown as EventBus<…>` casts (context.ts:81,
   349, 360). The UI renderer probes `pickString('kind', 'type', 'name')` so it *displays* the
   scheduler kind today, but: (a) `cron` is an undeclared extra field not in the contract, (b) `name`
   is never populated, (c) `error` is never populated even though `serve.ts:82-86` wraps in
   `try/finally` and could capture it.

3. **Producer audit freshness.** The original idea hypothesized that catalog entries
   `agent.started`, `agent.stopped`, `agent.message.sent`, and `process.started` have no production
   emit sites. **This is stale.** Verification against the current `ts-libs` source confirms:
   - `agent.started` / `agent.stopped` / `agent.message.sent` are emitted by `TeamOrchestrator`
     (`ts-libs/packages/ai-runner/src/team-orchestrator.ts:73,86,98`), wired to the server bus via
     `ctx.teamService()` → `eventsBus` (`context.ts:349`).
   - `process.started` / `process.exited` are emitted by `ProcessExecutor`
     (`ts-libs/packages/runtime/src/process-executor.ts:138,202,272`), and the server's
     `AgentService` threads `events: ctx.eventBus()` into the `AiRunner` (`serve.ts:166`),
     which owns the executor.
   - Task 0226 already documented this: 45/47 catalog events are reachable on the canonical server
     bus; the 2 gaps are nested-CLI-context events (workflow/rule runs inside a child agent
     process), which is an intentional v1 scope limit (`serve.ts:137-145`).

   So layer 3 is **not** "wire missing producers" — it is **"refresh the audit table and close the
   documentation gap"**. The real residual producer issue is the *scheduler* contract drift in
   layer 2, not orphaned agent/process events.

**Scope (in):**

- Enrich `buildTooltipSummary` for all renderer branches: queue/scheduler (add duration, status,
  error, cron schedule, queue/job type), message (add ok/subject), process/agent (add command,
  exitCode, durationMs, pid), rule (add severity, count), api (add path, error), workflow-* (add
  phase/transition/action where present).
- Fix `serve.ts:85` scheduler emit to populate `name` (not `kind`), add `error` capture, and
  decide the disposition of the extra `cron` field (promote to contract vs. keep as undeclared).
- Thread queue/job-type fields from `DBJobQueue`/`DBQueueConsumer` emits so the queue renderer can
  distinguish job types (the single-queue architecture means there is no literal "queue name" to
  thread — `type` is the discriminator).
- Produce a refreshed producer-audit table (catalog entry → emit site → bus path → status) as a
  doc artifact, superseding the task-0226 findings with the verified-current map.

**Scope (out — preserved as-is):**

- `HISTORY_LIMIT=100` cap-and-prune, SSE delivery, `/api/events/history` and `/api/events/planning`
  endpoints, `SystemEventRow`/`EventCatalogEntry` wire shapes.
- `ServerEventMap` type tightening (the `Record<string, …>` + cast pattern is an ADR-level change
  tracked separately; this brainstorm works within it).
- Nested-CLI event bridging (task 0226 deferred scope; requires IPC or server-native execution).
- Adding queue-name as a first-class field to `QueueEvents` (single-queue architecture; `type` is
  the real discriminator — see Approach C analysis).

## Approaches

### Approach A — Tooltip-only enrichment + scheduler field fix (recommended)

Two surgical changes, no contract change:

1. **`buildTooltipSummary` enrichment** (`SystemEventsTab.tsx:263-366`). Extend each renderer
   branch to extract the high-value fields already present in payloads but currently dropped,
   using the existing `pickString` helper and a new `pickNumber`/`formatDuration` pair. Cap stays
   at 4 pairs (existing `.slice(0, 4)`). Specifically:
   - `queue`/`scheduler`: add `durationMs` (formatted as `123ms`/`1.2s`), `status`/`error`,
     `cron` (scheduler only). Keep `Job` (type/name) + `ID` as the first two.
   - `message`: add `ok` boolean, `subject` if present.
   - `process`/`agent`: add `command`, `exitCode`, `durationMs`, `pid`.
   - `rule`: add `severity`, `count`/`findings` count.
   - `api`: add `path`, `error`.
   - `workflow-*`: add `phase`/`transition`/`action` where the payload carries them.

2. **Scheduler emit fix** (`serve.ts:78-87`). Change the emit to populate the contract fields:
   ```ts
   ctx.eventBus().emit('scheduler.job.executed', {
       name: kind,           // was: kind (contract expects name)
       durationMs: Date.now() - startedAt,
       ...(err ? { error: String(err) } : {}),
   });
   ```
   Capture the error in the `catch` (currently swallowed by `try/finally` with no catch). Drop
   `cron` from the payload OR promote it — see design decision 2.

**Trade-offs:**

- (+) Smallest blast radius: one web file + one server file. No contract change, no DTO change, no
  new endpoint.
- (+) Fixes a real bug (scheduler contract drift) that is currently masked by loose typing.
- (+) Tooltip becomes genuinely diagnostic — the operator can see duration/error without expanding.
- (+) Fully testable: unit test `buildTooltipSummary` with fixture payloads; integration test the
  scheduler emit via the existing `upstream-system-events-wiring.test.ts` harness.
- (-) Does not address the root cause of the scheduler mismatch (the `ServerEventMap`
  `Record<string, unknown>` erasure). The fix is correct *today* but a future regression is
  possible until the bus type is tightened. Mitigate with a contract-aligned test assertion.
- (-) Queue "name" gap is acknowledged but not structurally solved — the renderer relies on `type`,
  which is correct for the single-queue architecture but would mislead if multi-queue is ever
  introduced. Document as a known limit.

**Confidence: HIGH.** All referenced fields verified present in emit-site payloads
(`serve.ts:85`, `process-executor.ts:138-145`, `team-orchestrator.ts:73-98`,
`events.ts:77-92` QueueEvents). The `pickString`/`pickNumber` helpers and the 4-pair cap are
verified in `SystemEventsTab.tsx:268-365`. No external API behavior assumed.

**Sources:**

- `apps/web/src/modules/observability/SystemEventsTab.tsx:253-366` (`buildTooltipSummary`,
  renderer switch, 4-pair cap) — read 2026-07-09.
- `apps/server/src/serve.ts:75-97` (`registerSchedulerEntries`, scheduler emit) — read 2026-07-09.
- `ts-libs/packages/infra/src/events.ts:47-98` (`SchedulerJobExecutedDetail`, `QueueEvents`,
  `SchedulerEvents`) — read 2026-07-09.
- `ts-libs/packages/runtime/src/process-executor.ts:61-69,138-145` (`ProcessEvents`,
  `process.started` emit) — read 2026-07-09.
- `ts-libs/packages/ai-runner/src/team-orchestrator.ts:72-99` (`agent.started/stopped/message.sent`
  emits) — read 2026-07-09.
- `apps/server/src/context.ts:68,349,360` (`ServerEventMap` erasure, bus wiring) — read 2026-07-09.

### Approach B — Contract-first: tighten `ServerEventMap` + typed emit + tooltip enrichment

Do Approach A's tooltip work, AND fix the root cause: replace
`ServerEventMap = Record<string, (detail: unknown) => void>` with a proper intersection type
composed from `InfraEvents & AgentEvents & ProcessEvents & PlanningEventMap & …`, so the scheduler
mismatch fails at compile time instead of being masked by `as unknown as never`.

**Trade-offs:**

- (+) Eliminates the entire class of field-name drift bugs, not just the scheduler instance.
- (+) Removes the `as unknown as never` / `as unknown as EventBus<…>` casts at every bus handoff.
- (-) **Cross-repo blast radius.** `ServerEventMap` composes types from `ts-infra`, `ts-ai-runner`,
  `ts-runtime`, and Spur's own `PlanningEventMap`. Any mismatch between the composed map and an
  emitter's local map surfaces as a compile error — and the emitters live in `ts-libs`, which Spur
  consumes by semver. A contract tightening here may require coordinated `ts-libs` releases.
- (-) The casts at `context.ts:81,349,360` exist *because* the composed maps don't perfectly
  align today (e.g., `PlanningEventMap` vs `ServerEventMap` detail shapes). Removing the casts
  requires resolving each mismatch, which is unbounded scope.
- (-) Contradicts R2/R3 (simplicity, surgical changes) for a brainstorm whose primary ask is
  tooltip enrichment. This is an ADR-level refactor (`docs/00_ADR.md` territory) masquerading as
  a sub-task.

**Confidence: MEDIUM** that the tightening is mechanically possible; **LOW** that it is warranted
in this brainstorm's scope. The root-cause fix is correct but belongs in its own task with its own
ADR entry, not bundled into observability tooltip work.

**Sources:**

- `apps/server/src/context.ts:68` (`ServerEventMap` definition) — read 2026-07-09.
- `apps/server/src/context.ts:81,349,360` (cast sites) — read 2026-07-09.
- `ts-libs/packages/infra/src/events.ts:111` (`InfraEvents` aggregate) — read 2026-07-09.

### Approach C — Thread a real queue name end-to-end

The original idea's layer 2 asked to "thread queue name" because `QueueEvents` payloads carry
`{jobId, type}` with no queue name. Investigate adding a `queueName` field to `QueueEvents` in
`ts-infra`, populate it in `DBJobQueue`/`DBQueueConsumer`, and surface it in the queue renderer +
tooltip.

**Trade-offs:**

- (+) Structurally complete: every queue event carries its origin.
- (-) **The architecture has one queue.** `serve.ts:279-294` creates a single `JobHandlerRegistry`
  and one `DBJobQueue` instance; `ctx.jobQueue()` returns that singleton. There is no second queue
  to disambiguate. A `queueName` field would be constant across all events — pure noise.
- (-) The real discriminator is `type` (job type: `system-events-prune`, `smoke`, task-action
  commands), which `QueueEvents` already carries (`events.ts:79,85`). The tooltip already extracts
  it as `Job` (`pickString('kind','type','name')`).
- (-) Cross-repo change to `ts-infra` `QueueEvents` contract + `DBJobQueue`/`DBQueueConsumer`
  emitters, for a field with no current informational value. Violates R2 (no speculative features).

**Confidence: HIGH** that the single-queue premise is accurate (`serve.ts:279-294`, `context.ts`
`jobQueue()` singleton); **LOW** that this approach is warranted. The original idea's "queue name
gap" is a misdiagnosis — the gap is *duration/status/error* missing from the tooltip, not *queue
name*.

**Sources:**

- `apps/server/src/serve.ts:279-294` (single `JobHandlerRegistry` + queue setup) — read 2026-07-09.
- `ts-libs/packages/infra/src/events.ts:77-92` (`QueueEvents` — `type` already present) — read
  2026-07-09.
- `ts-libs/packages/infra/README.md:165-167,281-284` (single-bus wiring example) — read 2026-07-09.

## Recommendation

**Approach A.** It satisfies the three real problems (tooltip thinness, scheduler contract drift,
stale audit) with a two-file blast radius, no contract change, and no cross-repo dependency. The
scheduler field fix is a genuine bug correction, not cosmetic. Approach B is the right *next*
conversation — the `ServerEventMap` erasure is a real debt — but it is an ADR-scoped refactor, not
a sub-task of tooltip enrichment. Approach C is declined: the single-queue architecture makes a
`queueName` field constant noise, and `type` already carries the discriminator.

The refreshed producer-audit table (layer 3, redefined) is a documentation deliverable produced as
part of Approach A — it supersedes the task-0226 findings with the verified map and records the
nested-CLI residual as the only known gap.

### Design decisions to lock before decomposition

1. **Tooltip field budget.** The existing cap is 4 `(label, value)` pairs (`.slice(0, 4)`). Keep
   the cap; prioritize fields by diagnostic value per renderer:
   - `queue`: `Job` (type), `ID`, `Status`/`Duration`, `Error`.
   - `scheduler`: `Job` (name), `Cron`, `Duration`, `Error`.
   - `process`/`agent`: `Agent`/`Command`, `Exit`/`Duration`, `Op`, `PID`.
   - `message`: `Route`, `OK`, `Subject`.
   - `rule`: `Rule`, `Severity`, `Findings`.
   - `api`: `HTTP` (method+status), `Path`, `Error`.
   - `workflow-*`: `Workflow`, `Run`, `Phase`/`Transition`/`Action`.
   When a payload lacks a higher-priority field, fall through to the next (existing `pickString`
   semantics). Duration formatting: `<1000ms` → `${n}ms`; `>=1000ms` → `${(n/1000).toFixed(1)}s`.

2. **`cron` field disposition.** `serve.ts:85` currently emits `cron` but the contract
   (`SchedulerJobExecutedDetail`) has no `cron` field. Two options:
   - **(a)** Drop `cron` from the emit; the tooltip can derive the schedule from the catalog/job
     name if needed. Keeps the contract clean. **Recommended** — `cron` is static per job name and
     better surfaced from a job registry than per-event.
   - **(b)** Promote `cron` to `SchedulerJobExecutedDetail` in `ts-infra`. Cross-repo contract
     change for low diagnostic value (the schedule doesn't change between fires). Decline unless
     the operator wants per-event schedule visibility.
   Lock **(a)** unless the operator overrides.

3. **Scheduler error capture.** `serve.ts:79-87` uses `try/finally` with no `catch`, so errors
   propagate (the scheduler adapter handles retry/logging) but the `scheduler.job.executed` event
   never carries `error`. Add a `catch (err)` that sets a local `error` variable, emitted in the
   `finally`. Re-throw after emit to preserve current propagation. This populates the contract's
   optional `error` field and makes the tooltip diagnostic on failure.

4. **Audit table artifact location.** Produce as
   `docs/inventory/0226-emit-sites.md` refresh (or a new `docs/inventory/system-events-producer-audit.md`
   if the task-0226 file should be preserved as historical). Columns: `Catalog entry | Emit site
   (file:line) | Bus path to tap | Status`. Statuses: `✅ reachable`, `⚠️ nested-CLI (deferred)`,
   `❌ unwired`. Supersede note referencing task 0226.

5. **No `queueName` field.** Document in the audit table that the single-queue architecture uses
   `type` (job type) as the discriminator and a literal queue name is not threaded. Record as a
   known limit; revisit only if multi-queue is introduced.

### What does NOT change

- `ServerEventMap` type definition (`context.ts:68`) and the cast pattern at bus handoffs.
- `SystemEventRow`, `EventCatalogEntry`, `HistoryResponse`, `SseEnvelope` wire shapes.
- `parseHistoryRow`, `parseSseEnvelope`, `parseCatalog` untrusted-input narrowing.
- `HISTORY_LIMIT=100` cap-and-prune, SSE malformed-frame drop, `connected`-frame drop.
- `/api/events/history` and `/api/events/planning` endpoints.
- `DETAIL_RENDERERS` registry, `EventDetails`, `RawPayloadView` (the tooltip mirrors a subset of
  their fields; it does not replace them).
- `QueueEvents` contract in `ts-infra` (no `queueName` field added).
- Nested-CLI event bridging (task 0226 deferred scope).

## Design Summary

A two-file observability enrichment: (1) `buildTooltipSummary` in
`apps/web/src/modules/observability/SystemEventsTab.tsx` is extended so each renderer branch
extracts the high-value diagnostic fields already present in payloads but currently dropped
(duration, status, error, cron schedule, command, exit code, pid, severity, path) — capped at 4
pairs, prioritized per renderer, with duration formatted human-readably; (2) the scheduler emit in
`apps/server/src/serve.ts:registerSchedulerEntries` is corrected to populate the
`SchedulerJobExecutedDetail` contract (`name` not `kind`, add `error` capture, drop the undeclared
`cron` field). A refreshed producer-audit table is produced as a documentation artifact,
superseding task-0226 findings with the verified-current emit-site map and recording the
nested-CLI residual as the only known gap.

No backend endpoint, DTO, transport, dependency, or cross-repo (`ts-libs`) contract change. The
`ServerEventMap` type-erasure root cause is acknowledged but deferred to a separate ADR-scoped
task. The original idea's "queue name threading" layer is declined: the single-queue architecture
means `type` (job type) is the real discriminator and a `queueName` field would be constant noise.
The original idea's "unwired agent/process producers" layer is redefined: those producers ARE
wired (TeamOrchestrator + ProcessExecutor → server bus), so the deliverable is a refreshed audit
table, not new wiring.

**`needs_design`: true.** Rationale: the change touches two subsystems (web tooltip extraction
logic with a per-renderer field-priority convention, and server event-contract alignment with a
cross-repo type contract). The tooltip field-priority convention is a cross-cutting client-side
decision (which fields matter per renderer) that the decomposition step should not guess. The
scheduler `cron` disposition (drop vs. promote to contract) is an architectural choice with
cross-repo implications. Ties lean design: the cost of a skipped step (inconsistent field
priorities across renderers, or a contract change that forces a `ts-libs` release) exceeds the
cost of a redundant one.

## Next steps

1. Operator reviews this doc (Design Approval Gate pattern 4) — in particular the `cron`
   disposition (decision 2) and the declined Approaches B/C.
2. `idea-pipeline.yaml` consumes `.spur/run/idea-needs-design.json` (`{"needs_design": true}`) and
   routes to `system-design`.
3. After `system-design`, `sp:spec-decomposition` produces the task batch.
