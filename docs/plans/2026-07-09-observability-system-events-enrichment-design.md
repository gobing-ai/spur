---
feature: L
title: "System Events Payload and Wiring Enrichment — System Design"
date: 2026-07-09
status: approved
sources:
  - apps/web/src/modules/observability/SystemEventsTab.tsx:253-366
  - apps/server/src/serve.ts:75-97
  - packages/app/src/services/event-names.ts
  - ts-libs/packages/infra/src/events.ts:47-98
  - ts-libs/packages/runtime/src/process-executor.ts:61-69,138-145
  - ts-libs/packages/ai-runner/src/team-orchestrator.ts:72-99
  - apps/server/src/context.ts:68,349,360
---

# System Design — Feature L

Companion to the brainstorm: `docs/plans/2026-07-09-observability-system-events-enrichment-brainstorm.md`.
This doc locks the decomposition-relevant decisions so the task batch does not have to guess.

## 1. Change surfaces

| # | File | Surface | Nature |
|---|---|---|---|
| 1 | `apps/web/src/modules/observability/SystemEventsTab.tsx` | `buildTooltipSummary` + helpers (`pickString`, new `pickNumber`, new `formatDuration`) | Enrichment, no contract change |
| 2 | `apps/server/src/serve.ts` | `registerSchedulerEntries` scheduler emit | Bug fix: contract alignment |
| 3 | `docs/inventory/system-events-producer-audit.md` | New file | Documentation artifact |

No endpoint, DTO, transport, dependency, or cross-repo (`ts-libs`) change. The `ServerEventMap`
type-erasure root cause is explicitly deferred (brainstorm Approach B is declined for this scope).

## 2. Tooltip field budget and formatting (locks brainstorm decision 1)

### 2.1 Duration formatting — `formatDuration(ms: unknown): string | null`

```text
IF ms is not a finite number THEN return null
IF ms < 1000 THEN return `${ms}ms`
ELSE return `${(ms / 1000).toFixed(1)}s`
```

Single source of truth; every renderer that surfaces duration uses it. The label is the **value**
(e.g. `"150ms"`); the pair label is renderer-specific (`"Duration"`).

### 2.2 Per-renderer priority order (cap = 4 pairs, first-available wins)

Renderer branches are dispatched in `buildTooltipSummary` by `prefix` / `renderer`. For each branch,
build a list of `[label, value]` candidate pairs in priority order, then `.slice(0, 4)`.

| Prefix/Renderer | Candidate pairs in priority order |
|---|---|
| `queue` | `["Job", pickString("kind","type","name")]`, `["ID", pickString("jobId","id")]`, `["Duration", formatDuration(pickNumber("durationMs"))]`, `["Status", pickString("status","state")]`, `["Error", pickString("error")]` |
| `scheduler` | `["Job", pickString("name","kind")]`, `["Duration", formatDuration(pickNumber("durationMs"))]`, `["Error", pickString("error")]` |
| `process` / `agent` | `["Command", pickString("command","cmd","agent","name")]`, `["Exit", pickString("exitCode","code")]`, `["Duration", formatDuration(pickNumber("durationMs"))]`, `["Op", pickString("op","action","event","type")]`, `["PID", pickString("pid")]` |
| `message` | `["Route", pickString("route","direction","type")]`, `["OK", pickBool("ok","success")]`, `["Subject", pickString("subject","topic")]` |
| `rule` | `["Rule", pickString("rule","ruleId","name")]`, `["Severity", pickString("severity")]`, `["Findings", pickString("count","findings","total")]` |
| `api` | `["HTTP", \`${pickString("method")} ${pickString("status")}\`]` (null if either missing)`, `["Path", pickString("path")]`, `["Error", pickString("error")]` |
| `workflow` / `workflow-*` | `["Workflow", pickString("workflow","workflowName","name")]`, `["Run", pickString("runId","run","id")]`, `["Phase", pickString("phase","transition","action")]` (first non-null becomes `["Phase"/"Transition"/"Action", value]`) |

**Null filtering:** a candidate pair is dropped if its value is null/empty. This means the tooltip
auto-prioritizes — a payload missing `durationMs` falls through to `status`, etc. The existing
`pickString` already returns `null` for missing keys; `pickNumber`/`formatDuration`/`pickBool` follow
the same null-propagation discipline.

**HTTP pair special case:** combine method+status only if both present; otherwise fall through to
each individually. This avoids a half-populated `"POST null"` label.

### 2.3 No new dependency

All formatting is plain TS string ops. No `date-fns`, no `humanize-duration`. The 2-branch
(`<1000`/`>=1000`) formatter is deliberately crude — it is a tooltip, not a metrics dashboard.

## 3. Scheduler emit contract fix (locks brainstorm decisions 2 & 3)

### 3.1 Current (buggy) shape

```ts
// serve.ts:78-87 (approx)
try {
    startedAt = Date.now();
    await job();
} finally {
    ctx.eventBus().emit('scheduler.job.executed', {
        kind,           // ← contract expects `name`
        cron,           // ← not in contract
        durationMs: Date.now() - startedAt,
    });
}
```

### 3.2 Target shape

```ts
let startedAt = Date.now();
let error: unknown;
try {
    await job();
} catch (err) {
    error = err;
    throw err;   // preserve propagation (scheduler adapter handles retry/logging)
} finally {
    ctx.eventBus().emit('scheduler.job.executed', {
        name: kind,
        durationMs: Date.now() - startedAt,
        ...(error !== undefined ? { error: String(error) } : {}),
    });
}
```

**Contract reference** — `SchedulerJobExecutedDetail` (`ts-infra` `events.ts:48-55`):
```ts
{ name: string; durationMs: number; error?: string }
```

### 3.3 Locked dispositions

- **`cron` field: DROP.** Not in the contract; static per job name; the tooltip derives schedule from
  a job registry if ever needed (brainstorm decision 2, option a). Do **not** promote to `ts-infra`.
- **`error` field: CAPTURE.** Add the `catch` so the contract's optional `error` is populated on
  failure (decision 3). Re-throw to preserve the existing propagation contract — the scheduler
  adapter owns retry/logging, not this emit site.
- **`name` field: RENAME** `kind` → `name` to match the contract.

## 4. Producer-audit artifact (locks brainstorm decision 4)

New file: `docs/inventory/system-events-producer-audit.md`. Columns:

| Catalog entry | Emit site (file:line) | Bus path to tap | Status |
|---|---|---|---|

Statuses: `✅ reachable`, `⚠️ nested-CLI (deferred)`, `❌ unwired`.

Source of truth for the table: `SYSTEM_EVENT_CATALOG` (`packages/app/src/services/event-names.ts`)
cross-referenced against verified emit sites:

- `agent.started` / `agent.stopped` / `agent.message.sent` → `team-orchestrator.ts:73,86,98` →
  `ctx.teamService()` → `eventsBus` (`context.ts:349`) — ✅ reachable.
- `process.started` / `process.exited` → `process-executor.ts:138,202,272` → `AgentService` →
  `AiRunner` → `ctx.eventBus()` (`serve.ts:166`) — ✅ reachable.
- `process.spawned` / `process.stopped` → `supervisor-service.ts` — ✅ reachable.
- `workflow.*` / `rule.*` / `api.*` → verified real emit sites in `apps/server/` — ✅ reachable.
- `queue.*` / `scheduler.*` → `DBJobQueue`/`DBQueueConsumer`/`serve.ts` — ✅ reachable.
- Nested-CLI-context events (workflow/rule runs *inside* a child agent process) — ⚠️ deferred (v1
  scope limit, `serve.ts:137-145`).
- `agent.invoke.start` / `agent.invoke.exit` — ⚠️ test-only today; record honestly.

Footer note: single-queue architecture → no `queueName` field; `type` is the discriminator. Supersede
note referencing task 0226.

## 5. Testing strategy

| Layer | Test | Asserts |
|---|---|---|
| Unit (web) | `buildTooltipSummary` fixture tests — one per renderer branch, plus the 3 duration-formatting boundary cases (999/1000/65000) | Right fields extracted, 4-pair cap honored, null-candidates dropped, duration formatting across the boundary |
| Unit (web) | `formatDuration` direct tests | `null` on non-number, `999ms`, `1.0s`, `65.0s` |
| Integration (server) | Extend `upstream-system-events-wiring.test.ts` — drive a scheduler entry to fire and assert the emitted payload | `name` populated (not `kind`), `cron` absent, `error` populated on thrown job, error re-propagates |
| Doc | The audit table itself is the verification artifact — every catalog entry must have a row with a verified emit site or a `⚠️`/`❌` marker | Completeness vs catalog |

All tests follow the existing harnesses — no new test infra.

## 6. What does NOT change

- `ServerEventMap` type definition and the `as unknown as never` cast pattern (ADR-scoped, deferred).
- `SystemEventRow`, `EventCatalogEntry`, `HistoryResponse`, `SseEnvelope` wire shapes.
- `parseHistoryRow`, `parseSseEnvelope`, `parseCatalog` untrusted-input narrowing.
- `HISTORY_LIMIT=100` cap-and-prune, SSE malformed-frame drop, `connected`-frame drop.
- `/api/events/history` and `/api/events/planning` endpoints.
- `DETAIL_RENDERERS` registry, `EventDetails`, `RawPayloadView` (the tooltip mirrors a subset; it
  does not replace them).
- `QueueEvents` contract in `ts-infra` (no `queueName` field added).

## 7. Decomposition plan

Three tasks, one per change surface, in dependency order:

1. **Scheduler emit fix** (`serve.ts`) — lands first; it defines the payload contract the tooltip
   branch will render. Smallest, most isolated. Test: extend the wiring test.
2. **Tooltip enrichment** (`SystemEventsTab.tsx`) — lands second; its fixture tests can use the
   corrected scheduler payload shape from task 1. Largest. Test: per-renderer fixture tests.
3. **Producer-audit table** (`docs/inventory/`) — lands last; documents the final state of tasks 1
   and 2 plus the verified emit-site map. No code; doc-only verification.

Tasks 1 and 2 are code-coupled (2 renders 1's payload); task 3 depends on both for accuracy but
touches no code. All three link to feature L and resolve the orphan-scenarios finding.
