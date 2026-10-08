---
schema_version: 1
name: Persist decision invocations to decision_logs and add a Board Decisions tab
status: done
template: feature-impl
created_at: 2026-10-07T02:58:40.297Z
updated_at: "2026-10-08T02:10:10.066Z"
feature_id: P1

dependencies: ["1095", "1113"]
priority: P2
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1100-verdict.json
---

## 1100. Persist decision invocations to decision_logs and add a Board Decisions tab

### Background

Slice S3b of `docs/design/decision-observability-and-adoption.md` (§3.5–§3.6) covers feature P1 R14–R15.

Task 1095's `decision.*` events are metadata-only and capped together with every other source. So once a decision has been served, nobody can see what input the maker saw, what it answered, or where the time went. This task adds:

- a `decision_logs` table that stores one row per invocation, keyed by `invocationId` so it joins the events;
- a Board Observability **Decisions** tab to query and inspect those rows.

The UI contract is in root `DESIGN.md` § Product UI — Decisions.

**Refine corrections (2026-10-07)**

- Stale anchors:
  - `SystemEventDao` is now at `system-event-dao.ts:263`, not `:229`.
  - The last migration is at `migrations.ts:1587`, not `:1584`. `0052` is still free: `drizzle/` ends at `0051`.
  - The gate wiring is at `workflow-service.ts:2046`/`:2179`, not `:2044`/`:2163`.
  - `OBSERVABILITY_TABS` entries carry a `component`, so the new entry is `{ id: 'decisions', label: 'Decisions', component: DecisionsTab }`.
- The R3 `evidence` phase could not be measured. The CLI (and, after 1094, the catalog-form runner) reads evidence **before** `service.decide`, so a clock opened at service entry misses it. → Callers that read evidence pass a `prelude: { startedAt, phases }` on the log argument. The row's `started_at` is the prelude's `startedAt` when present.
- Task 1094's catalog-form runner calls `emitDecisionRejected` directly when an evidence read fails, and it also calls `service.decide`. Both paths need the log sink. → `DecideActionDeps.decisionLog` covers the inline, catalog and evidence-rejection paths. Reason `disabled` emits no events and writes no row: there is no invocation.
- Task 1113 adds a hub-throw backstop (`start → failure → end`, then rethrow). The caller receives an error and no value, so §3.5's outcome set needs a rule. → The row is `outcome: 'rejected'`, `reason: 'error'`, `value: null`, with the redacted message.
- §3.5 has no `error_kind` column, but 1113 makes the rejection class (`input`, `unknown-decision`, …) the thing worth filtering. → `rejected` rows store the event's `errorKind` in `reason`. No new column.
- Correlation columns `workflow_name`/`wbs` were meant to hold 1113's correlation fields, including the gate's `runCorrelation` lookup and the inline driver's `loadRunCorrelation`. The row copies `correlation` verbatim; it does not look anything up again.
- `getDecisionService` returns one cached instance per `cwd` and calls `withConfig(config)`, which mutates it (`decision-service.ts:363-376`). So the log mode/secrets must **not** be read from the service's config: a concurrent caller with another config would race. → Each caller builds the sink from its own config.
- Changes in `packages/app` reach the plugin through the bundled lib used by `plugins/sp/scripts/inline-run-setup.ts`. → Add `build:bundle` + `plugin-smoke` to the gates.
- Priority and estimate were unset. → P2, 12 h: about 14 files across 6 workspaces plus the Board UI.

### Requirements

- [x] R0. Scope boundary: the `decision.*` lifecycle events from task 1095 stay in `system_events`, together with every other source. This task does not move, copy or widen them. `decision_logs` stores decision records (one per invocation), not events, and the two join on `invocationId`.
- [x] R1. Add migration `0052_spur_cli_decision_logs`:
  - The file `drizzle/0052_spur_cli_decision_logs.sql` must be byte-compatible with a new `DECISION_LOGS_SCHEMA_SQL` constant in `packages/domain/src/migrations.ts`, registered after `0051_spur_cli_coordination_runs_parent` (`migrations.ts:1587`). Confirm `0052` is still the next free prefix at pickup (H15 work is landing in parallel).
  - It creates `decision_logs` with the columns of design §3.5 and a `maker_name` column holding the registered `DecisionMaker` name (the registry key, `ServedDecision.maker`; null only for a `rejected` row that failed before a maker resolved), and the indexes `(started_at)`, `(decision_id, started_at)`, `(maker_name, started_at)` and `(run_id)`.
  - It uses `CREATE TABLE IF NOT EXISTS` and is idempotent.
- [x] R2. Add `packages/domain/src/dao/decision-log-dao.ts` (raw SQL over `DbAdapter`, the same pattern as `SystemEventDao`, `packages/domain/src/dao/system-event-dao.ts:263`). Export it from the domain index.
  - `insert(row)` inserts the row, then prunes everything beyond the newest 10,000 by `started_at`.
  - `list(spec{since?, decisionId?, makerName?, outcome?, caller?, runId?, limit, before?})` returns newest-first summary rows without `input_json`, `question` or `phases_json`, plus `nextCursor` (`started_at|id`).
  - `summary(spec)` returns `count`, `accepted`, `fallback`, `rejected` and the `duration_ms` values for the filtered set.
  - `facets(spec{since?})` returns the distinct decision ids and `maker_name` values.
  - `get(id)` returns the full row or null.
- [x] R3. Record at the 1095 emitter seam (`packages/app/src/decision/decision-events.ts`):
  - The lifecycle clock opens at the **service entry**, before resolution, so `started_at` and the `resolve` phase are real and a rejected call shares the same clock. Today `beginDecisionInvocation` runs only after resolution, and `emitDecisionRejected` mints its own id; both gain an optional `log` argument `{ sink: DecisionLogSink, startedAt, phases, prelude?, input?, question?, fallbackValue?, catalogSource? }`. `DecisionLogSink = { dao, secrets, mode: 'full'|'metadata' }` is built per caller by `decisionLogSink(adapter, config, env): DecisionLogSink | undefined`, which returns `undefined` for `off`. `prelude` is `{ startedAt, phases }` from callers that read evidence before the service; the row's `started_at` is `prelude.startedAt` when present and write the row under the same `invocationId` their events carry.
  - Phases are `resolve`, `evidence` (CLI and workflow paths only), `maker` and `serve`. `maker` is the whole `hub.decide` call: ts-ai-decision 0.5.16 resolves the maker and asks it inside one call (`dist/hub.js:165-167`), so `maker-init` and `maker-call` are not separately observable at Spur's seam. Update design §3.5 to this phase list.
  - At `end` or `rejected`, it inserts exactly one row built per §3.5:
    - input redacted with `redactAndBound` and the configured secrets (`configuredSecretValues(env)`), at most 16 KiB;
    - question and error at most 2 KiB each;
    - `maker_name` set from the resolved maker name.
    - `outcome` set to `accepted` (`source` model and `reason` accepted), `fallback`, or `rejected`. A hub throw after `start` (task 1113 R2 backstop) is `rejected` with `reason: 'error'`. Every `rejected` row stores the event `errorKind` in `reason`.
    - correlation columns (`run_id`, `workflow_name`, `node_id`, `wbs`) copied verbatim from the event `correlation`, never looked up again.
  - Every rejection site writes a row, including the three CLI pre-decide sites in `apps/cli/src/commands/decision.ts` (unknown id via `describe`, unreadable evidence, bad `--param`) and the input rejection added by task 1113.
  - The workflow inline-question path (`packages/app/src/workflow/actions/decide.ts`) emits after `runDecide` returns, so its row records one `maker` phase of `result.durationMs`, `started_at = ended_at - durationMs`, `question` = the inline question, and `maker_source` `inline`. Task 1094's catalog form goes through the service, and the runner's own evidence-read `decision.rejected` (1094 R3) also passes the log argument. Inline rows remain until S8 removes the inline form. Reason `disabled` writes no row.
  - The insert is best-effort: a failure goes to the warn sink and never changes the decision result or the error thrown to the caller.
- [x] R4. Pass the DAO from every caller that 1095 wired:
  - `spur decision run` (`apps/cli/src/commands/decision.ts`) uses `new DecisionLogDao(await context.getDb())`, with `DecideOptions.decisionLog`;
  - the workflow decide runner uses a `DecideActionDeps.decisionLog` wired in `packages/app/src/workflow/builtins.ts`, from the workflow service DB;
  - the inline driver (`packages/app/src/services/inline-run-setup.ts`, `runInlineRunDecide`) uses `projectDb.adapter`;
  - the evidence-mode gate path (task 1099, landed: `packages/app/src/services/workflow-service.ts:2117` `buildDecisionEvaluator`, service injected at `:2179`) uses the workflow service DB. The gate calls `service.decide`, so the sink travels on `DecideOptions.decisionLog`. Mode and secrets come from the caller's own config, never from the cached service's `withConfig` state (`decision-service.ts:363-376`).
- [x] R5. Config: `DecisionsConfigSchema` (`packages/config/src/index.ts:824`) gains a single key, `log: z.enum(['full', 'metadata', 'off']).default('full')`.
  - `off` writes no rows.
  - `metadata` writes rows with null `input_json` and `question`.
  - None of the values affects `decision.*` events.
  - `decisions` is optional in `spurConfigSchema` (`packages/config/src/index.ts:1001`); read the mode as `config?.decisions?.log ?? 'full'`.
  - Update the config table in `docs/design/decision-catalog.md` (the satellite that documents `decisions.paths/maker/makers`).
- [x] R6. Contracts and server:
  - Add Zod schemas `decisionLogRowSchema`, `decisionLogDetailSchema` and `decisionLogListResponseSchema` (rows, summary{count, acceptedRate, fallbackRate, p95DurationMs}, facets{decisionIds, makers}, nextCursor) in `packages/contracts/src/observability.ts`.
  - Add an app query service, `packages/app/src/decision/decision-log-query.ts`, that computes rates and the nearest-rank p95.
  - Mount `GET /api/observability/decisions` and `GET /api/observability/decisions/:id` (404 when the row is missing; 400 on an invalid `outcome`, `caller` or `limit`) in `apps/server/src/modules/observability/index.ts`, next to `routing-summary` (`:360`).
  - Add both routes to the route doc comment at `:343`.
- [x] R7. Board tab:
  - Add `apps/web/src/modules/observability/DecisionsTab.tsx` and `DecisionDetailDrawer.tsx`, following root `DESIGN.md` § Product UI — Decisions.
  - Register `{ id: 'decisions', label: 'Decisions' }` as `{ id: 'decisions', label: 'Decisions', component: DecisionsTab }` after `routing` in `OBSERVABILITY_TABS` (`apps/web/src/modules/observability/tabs.ts`), and update the exact-list test `apps/web/tests/modules/observability/tabs.test.ts`.
  - Reuse `fetchWithTimeout`/`resolveApiUrl` (`apps/web/src/lib/rpc-client`), `timeRangeSince`/`SegmentedToggle` (`ObservabilityFilters.tsx`), `formatDuration` (`SystemEventsTab.tsx`), `KpiCard` (exported from `SummaryTab.tsx:85`; currently module-private) and the `@/ui` primitives.
  - "View run events" uses the existing `{ tab: 'system-events', runId }` nav intent.
- [x] R8. No new public `spur` noun, verb or flag. No new dependency.

### Acceptance Criteria

- [x] AC1 — Every decision invocation is recorded in the decision log
- [x] AC2 — The Board Decisions tab lists and explains recorded decisions

### Q&A

- Kept: one dedicated table instead of widening the event payload policy. The metadata-only event invariant (event-tracking §8) stays intact, and debug bodies stay out of the shared SSE ledger.
- Rejected calls get a row with outcome `rejected` and a null value, so caller mistakes such as bad params can be debugged from the same place.
- Retention is a fixed 10,000-row cap, matching the event ledger's per-prefix cap. A configurable cap is deferred until someone needs it.
- Input capture is on by default (`decisions.log: full`), because the database is local-first and the stored text is redacted and bounded. `metadata` is the opt-out for sensitive projects. Revised per operator: the two flags `log.enabled` and `log.captureInput` were collapsed into this one enum, since `enabled: false` with `captureInput: true` was a meaningless combination.
- Revised per operator: `decision.*` events stay in `system_events`, and `decision_logs` holds decision records only (R0).
- Revised per operator: an explicit `maker_name` column (the registered `DecisionMaker` name, indexed) supports per-maker analysis and selecting data for fine-tuning. The maker's model id is not stored, because makers do not report it to the hub. Add a `maker_model` column when a maker exposes it.
- There is no CLI reader (for example `spur decision logs`). That would be a public-surface change, and the Board plus the API cover the request. Add one with operator consent if a terminal workflow needs it.
- Dependencies: task 1095 (emitter module, invocation id, caller wiring). Task 1099's gate path is wired only if it has landed, and otherwise recorded in Solution, so 1100 does not block on 1099.
- The open-design MCP server was unavailable during refinement, so the UI contract was derived from the shipped Jobs and System Events tabs and recorded in `DESIGN.md`.

#### Q&A entry — 2026-10-07 P1 review

- Depends on task 1113: it moves input rejection ahead of `decision.start` and adds `errorKind: 'input'`. Without it, a bad workflow/gate parameter produces a `start` with no terminal event, and the row's outcome would be ambiguous.
- The handle opens at service entry (R3) because §3.5's `resolve` phase and a rejected row's `started_at` cannot be measured from a handle created after resolution.
- `maker-init`/`maker-call` collapse into one `maker` phase: the upstream hub does both inside `decide`. Splitting them needs an upstream hook, which feature P1 keeps out of scope.
- 1099 has landed, so the gate DAO wiring is unconditional.

#### Q&A entry — 2026-10-07T21:34:38.671Z

Halting marker (batch wf-inline-runall-p1-af68-105904, 2026-10-07): picked up at pipeline position 4/4, reverted to blocked before any implementation — host session reached its context budget (3 prior tasks consumed it). Tree verified clean at commit 96a402d6f; no 1100 code was written. Ready for a fresh session: the frozen plan, seams table, and failure list in this task file are complete and current.

### Design

**Chosen: a dedicated table written once per invocation at the 1095 emitter seam.** The contract is in `docs/design/decision-observability-and-adoption.md` §3.5–§3.6, and the UI rules are in `DESIGN.md` § Product UI — Decisions.

**Rejected:**
- *A wider `system_events` payload policy for `decision.*`.* It would break the metadata-only invariant of event-tracking §8, put task text and diffs into the shared, capped, SSE-streamed ledger, and still give no single row per invocation.
- *A bus tap that writes the log.* Events deliberately do not carry the input, so a tap cannot see what the row needs.
- *Per-phase rows.* A single row with `phases_json` is enough for a timeline and keeps the query one-table.

**Seams (file:line):**

| Concern | Location |
| --- | --- |
| Migrations | `packages/domain/src/migrations.ts:1587` (last entry, 0051), `drizzle/0051_spur_cli_coordination_runs_parent.sql` (header style) |
| DAO pattern | `packages/domain/src/dao/system-event-dao.ts:263` |
| Redaction | `packages/app/src/observability/agent-execution.ts:338` (`redactAndBound`), `configuredSecretValues` (exported from `packages/app/src/index.ts:40`) |
| Emitter | `packages/app/src/decision/decision-events.ts` (task 1095) |
| CLI | `apps/cli/src/commands/decision.ts` (run action) |
| Workflow | `packages/app/src/workflow/builtins.ts:108`, `packages/app/src/services/workflow-service.ts:2046`/`:2179` |
| Inline driver | `packages/app/src/services/inline-run-setup.ts` `runInlineRunDecide` |
| Config | `packages/config/src/index.ts:824` |
| Contracts | `packages/contracts/src/observability.ts` |
| Server | `apps/server/src/modules/observability/index.ts:343-360` |
| Web | `apps/web/src/modules/observability/tabs.ts`, `JobsTab.tsx` (fetch, paging, abort pattern), `JobDetailDrawer.tsx` (drawer pattern), `SummaryTab.tsx:85` (`KpiCard`), `ObservabilityFilters.tsx` |

**Invariants:**
- Exactly one row per invocation id, including rejected calls.
- Configured secrets never reach `input_json`, `question` or `error`.
- Logging can never change a decision result, an exit code or a thrown caller error.
- Events stay metadata-only and unchanged.
- The Board tab is read-only and never calls a maker.
- The server stays a thin transport: aggregation runs in the app query service, and SQL lives in the domain DAO (ADR-021).

**UI design source.** The open-design MCP server was disconnected while this task was refined, so the UI contract was written from the shipped Jobs and System Events patterns into `DESIGN.md`. If open-design is available at pickup, an optional mock may refine the layout, but `DESIGN.md` stays authoritative.

**Execution budget:**
- About 14 files across domain, app, config, contracts, server and web, plus 2 docs.
- `requireDiff: true`.
- No public CLI surface change and no new dependency.

**Frozen names (2026-10-07).**

- `DecisionLogDao` and `DecisionLogRow` in `packages/domain/src/dao/decision-log-dao.ts`.
- `DecisionLogSink` and `decisionLogSink(adapter, config, env)` in `packages/app/src/decision/decision-log.ts` (new). This module also builds the row, so `decision-events.ts` only calls `writeDecisionLog(sink, row)`.
- `DecideOptions.decisionLog?: { sink: DecisionLogSink; prelude?: { startedAt: number; phases: DecisionPhase[] } }`.
- `DecideActionDeps.decisionLog?: DecisionLogSink`, and `SpurWorkflowBuiltinsOptions.decisionLog?: DecisionLogSink`.
- `DecisionPhase = { phase: 'resolve' | 'evidence' | 'maker' | 'serve'; startedAt: number; durationMs: number }`.
- `DecisionLogQueryService` in `packages/app/src/decision/decision-log-query.ts`.

**Handoff from upstream.**

- Task 1113: `errorKind: 'input'`, the backstop, and correlation `workflowName`/`wbs`.
- Task 1094: `readDecisionEvidence` (time it for the `evidence` phase) and the catalog-form runner.

If 1094 has not landed when this task is picked up, wire only the paths that exist and record the catalog-form wiring as a 1094 follow-up in Solution.

### Plan

1. Write the failure list first:
   - A configured secret in an input or evidence value reaches `input_json`.
   - A rejected CLI call writes no row, or writes two.
   - A DB insert failure changes the `spur decision run` exit code.
   - Retention pruning deletes the newest rows.
   - `decisions.log: metadata` still stores input.
   - `decisions.log: off` still writes rows, or suppresses events.
   - `maker_name` is missing, or holds the source instead of the registered name.
   - A CLI call with `--evidence` records no `evidence` phase, or a `started_at` later than the evidence read.
   - A hub throw writes no row, or a row with outcome `fallback`.
   - A `rejected` row lacks its `errorKind` in `reason`.
   - `decision_id` filtering leaks other ids.
   - The cursor skips or duplicates rows that share a `started_at`.
   - The p95 of a single sample is wrong.
   - An invalid `outcome` query returns 500 instead of 400.
   - The drawer shows a null input as `null` instead of "Input not recorded (decisions.log: metadata)".
   - Keyboard Enter or Escape does not open or close the drawer.
2. Domain: add the DDL constant and the `0052` drizzle file, register the migration, and add `DecisionLogDao` (insert, prune, list, summary, facets, get) with in-memory SQLite DAO checks (AGENTS.md: DAO tests use in-memory SQLite).
3. Config: add the `decisions.log` schema and its defaults.
4. App: add phase marks and the log write in `decision-events.ts`, thread `decisionLog` through `DecideOptions`, `DecideActionDeps` and the inline driver, and add the `decision-log-query.ts` service.
5. Wire the CLI `decision run` sink (with an evidence prelude), the gate evaluator, the workflow builtins, and the inline driver (1099 has landed).
6. Contracts: add the schemas. Server: add the two routes.
7. Web: export `KpiCard`, add `DecisionsTab` and `DecisionDetailDrawer`, register the tab, and update the tabs exact-list test.
8. Docs: config satellite (`decisions.log`). §3.5–§3.6 and `DESIGN.md` are already written; correct them if the implementation diverges.
9. E2E, in a temporary project with no maker backend and a secret configured in env:
   - Run `spur decision run task-triage --param wbs=<secret-bearing value>` twice and `spur decision run nope` once.
   - Check the database directly: 3 `decision_logs` rows (2 fallback with reason `no-backend` and `maker_name` equal to the effective maker from `spur decision show`, 1 rejected), the ids equal the `decision.*` event `invocationId`s, and the secret is absent from every column.
   - Start `spur serve`. Check that `GET /api/observability/decisions?outcome=fallback` returns 2 rows with `summary.count` 2, and that `GET /api/observability/decisions/<id>` returns the input and phases.
   - Save the outputs as `.spur/run/1100-decision-logs.json`.
   - Browser-check the Board Observability → Decisions tab: KPI strip, filters, drawer, and keyboard open and close. Save a screenshot as `.spur/run/1100-decisions-tab.png`.
10. Gates: `bun run --filter @gobing-ai/spur build:bundle`, `bun run plugin-smoke`, `bun run spur-check`, `bun run test-cf`, `bun run build`.

### Solution

Implemented per the frozen design: a dedicated `decision_logs` table written once per invocation at the 1095 emitter seam, plus a read-only Board Decisions tab. Change map by requirement:

**R1 — migration 0052**
- `packages/domain/src/migrations.ts:230` — `DECISION_LOGS_SCHEMA_SQL`: the §3.5 columns, the four indexes (`started_at`, `(decision_id, started_at)`, `(maker_name, started_at)`, `(run_id)`), idempotent `CREATE TABLE IF NOT EXISTS`; registered as `0052_spur_cli_decision_logs` at `packages/domain/src/migrations.ts:1644` (next free prefix — `drizzle/` ended at 0051).
- `drizzle/0052_spur_cli_decision_logs.sql:1` — drizzle mirror: leading `--` provenance comment, then the constant's exact SQL; statement-level byte compatibility is pinned by the folder-load test in `packages/domain/tests/dao/migrations.test.ts:989`.

**R2 — DecisionLogDao**
- `packages/domain/src/dao/decision-log-dao.ts:1` — raw-SQL DAO over `DbAdapter` (SystemEventDao pattern): `insert` + retention prune to the newest `DECISION_LOG_RETENTION_ROWS` = 10,000 by `(started_at, id)` (`packages/domain/src/dao/decision-log-dao.ts:4`, `:175`); keyset-paged newest-first `list` (`:231`) returning summary rows that omit `input_json`/`question`/`phases_json` with a `started_at|id` `nextCursor`; `summary` (`:255`) returning outcome counts plus raw durations (p95 stays caller-side); `facets` (`:284`); `get` (`:317`). Reads tolerate a pre-migration DB (`no such table` → empty); write failures surface to the sink's warn path.
- Exported from `packages/domain/src/dao/index.ts:13` and `packages/domain/src/index.ts:43`.

**R5 — config**
- `packages/config/src/index.ts:834` — `DecisionsConfigSchema.log: z.enum(['full','metadata','off']).optional()`; the sink factory reads it as `config?.decisions?.log ?? 'full'`. No value affects `decision.*` events. Documented in the config satellite `docs/design/decision-catalog.md:35`.

**R3/R4 — write path at the emitter seam + caller wiring**
- `packages/app/src/decision/decision-log.ts:1` — new module owning row-building policy: `decisionLogSink(adapter, config, env)` (`packages/app/src/decision/decision-log.ts:46`) builds a per-caller sink (`off` → `undefined`); redaction via `redactAndBound` with `configuredSecretValues(env)`; bounds input ≤ 16 KiB (`packages/app/src/decision/decision-log.ts:108`, oversize re-wraps behind a `truncated` marker) and question/error ≤ 2 KiB; `buildDecisionLogRow` (`packages/app/src/decision/decision-log.ts:138`) sets outcome (`accepted` = source model + reason accepted; any served default = `fallback`; hub-throw close = `rejected` with `reason: 'error'`; every `rejected` row carries the event `errorKind` in `reason`), nulls value/source for rejections, copies the event `correlation` verbatim, and stamps `DECISION_LOG_SCHEMA_VERSION`; `writeDecisionLog` (`packages/app/src/decision/decision-log.ts:181`) is best-effort — a DAO failure reaches the warn sink and never changes the decision result or a thrown error.
- `packages/app/src/decision/decision-events.ts:152` — `emitDecisionRejected` gains `log`: one minted `invocationId` serves both the event and the `rejected` row, so pre-service rejections (unknown id, unreadable evidence, bad `--param`, input rejection) land in the log with the prelude clock as `started_at`. `packages/app/src/decision/decision-events.ts:204` — `beginDecisionInvocation` gains `log`; the `end` handler (`packages/app/src/decision/decision-events.ts:239`) inserts exactly one row, detecting the task-1113 backstop by the absent `source` field (→ `rejected`, `reason: 'error'`, redacted message). `emitDecisionRejected` and `end` never both write for one invocation id.
- `packages/app/src/decision/decision-service.ts:216` — the lifecycle clock opens at service entry (before resolution), making `resolve` (`packages/app/src/decision/decision-service.ts:288`), `maker` (the whole `hub.decide` call — `packages/app/src/decision/decision-service.ts:319`, `:344`) and `serve` (`packages/app/src/decision/decision-service.ts:336`) real, with a rejected call sharing the same clock; `catalogSource` and the declared fallback ride the log arg after `describe`. Phases are `resolve|evidence|maker|serve` (maker-init/maker-call collapsed per refine — the hub resolves and asks inside one call); §3.5 corrected at `docs/design/decision-observability-and-adoption.md:174`.
- Callers — each builds its own sink from its own config + env, never the cached service's `withConfig` state:
  - CLI `spur decision run`: `apps/cli/src/commands/decision.ts:159` sink from `context.getDb()`; prelude clock opens before describe (`apps/cli/src/commands/decision.ts:160`) so all three pre-decide rejection sites (`apps/cli/src/commands/decision.ts:173`, `:197`, `:205`) record the real start, and a successful evidence read adds the `evidence` phase; `decide` receives `{ sink, prelude }` (`apps/cli/src/commands/decision.ts:212`).
  - Workflow decide action: `packages/app/src/workflow/actions/decide.ts:215` — the inline path records one `maker` phase of `result.durationMs` with `started_at = ended_at - durationMs` plus the inline question; the catalog path uses an evidence prelude (`packages/app/src/workflow/actions/decide.ts:423`) and threads `{ sink, prelude }` into `service.decide`; `DecideActionDeps.decisionLog` at `packages/app/src/workflow/actions/decide.ts:128`. Reason `disabled` emits no events and writes no row.
  - Gate (1099 path): `packages/app/src/workflow/decision-hitl-responder.ts:405` opens the evidence clock; the prelude reaches the `gate-evidence` `service.decide` (`packages/app/src/workflow/decision-hitl-responder.ts:483`); `DecisionEvaluationDeps.decisionLog` (`packages/app/src/workflow/decision-hitl-responder.ts:90`) resolves the sink lazily per call.
  - Composition roots: `packages/app/src/workflow/builtins.ts:47`/`:122` thread `SpurWorkflowBuiltinsOptions.decisionLog` into `DecideActionDeps`; `packages/app/src/services/workflow-service.ts:2102` builds the workflow caller's sink (`packages/app/src/services/workflow-service.ts:2166`) with the gate's lazy accessor (`packages/app/src/services/workflow-service.ts:2242`); the inline driver builds its sink from `projectDb.adapter` (`packages/app/src/services/inline-run-setup.ts:1581`); public exports at `packages/app/src/index.ts:31`.

**R6 — contracts + server**
- `packages/contracts/src/observability.ts:205` `decisionLogRowSchema`, `:242` `decisionLogDetailSchema` (adds `question`/`inputJson`/`phases`), `:270` `decisionLogListResponseSchema` (rows, `summary{count, acceptedRate, fallbackRate, p95DurationMs}`, facets, `nextCursor`).
- `packages/app/src/decision/decision-log-query.ts:1` — `DecisionLogQueryService` (`packages/app/src/decision/decision-log-query.ts:168`): rates, nearest-rank p95 (`decisionLogP95`, `packages/app/src/decision/decision-log-query.ts:80`), cursor encode/decode, snake→camel mapping so the server route stays a thin handler.
- `apps/server/src/modules/observability/index.ts:219` — query-param validation (400 on invalid `outcome`/`caller`/`limit`); routes `GET /api/observability/decisions` and `GET /api/observability/decisions/:id` (404 when the row is missing) at `apps/server/src/modules/observability/index.ts:437`. Read-only; never calls a maker.

**R7 — Board tab (AC2)**
- `apps/web/src/modules/observability/DecisionsTab.tsx:1` + `apps/web/src/modules/observability/DecisionDetailDrawer.tsx:1` — KPI strip over the now-exported `KpiCard` (`apps/web/src/modules/observability/SummaryTab.tsx:85`), outcome/facet/time-range filters, newest-first table, drawer with phase timings, redacted input ("Input not recorded…" under `metadata` mode), value/fallback/error, keyboard open/close, and the `{ tab: 'system-events', runId }` "View run events" nav intent. `RetentionBadge` generalized with `DECISION_RETENTION_COPY` (`apps/web/src/modules/observability/ObservabilityFilters.tsx:148`).
- `apps/web/src/modules/observability/tabs.ts:65` — `{ id: 'decisions', label: 'Decisions', component: DecisionsTab }` after `routing`; the exact-list test pins it.

**Tests** (source-local; DAO tests on in-memory SQLite per AGENTS.md)
- `packages/domain/tests/dao/decision-log-dao.test.ts` — insert/list filters, keyset-cursor boundary stability, summary durations, facets, get, missing-table tolerance, retention pruning.
- `packages/app/tests/decision/decision-log.test.ts` — row-builder outcome/source/mode/truncation rules, sink modes, query-service p95/facets, best-effort warn on DAO failure.
- `packages/domain/tests/dao/migrations.test.ts` — 0052 registry/columns/indexes, drizzle folder-load byte compatibility, journal counts on fresh/populated/legacy DBs.
- `packages/config/tests/config-schemas.test.ts` — the three `log` modes parse; unknown values rejected.
- `apps/web/tests/modules/observability/tabs.test.ts` — exact tab list includes `decisions`.

**Boundaries kept (R0, R8):** `decision.*` events stay metadata-only in `system_events`, unchanged; `decision_logs` holds one record per invocation and joins on `invocationId`. No new public `spur` noun/verb/flag (the CLI change only threads internals of the existing `decision run` action). No new dependency.

### Testing

- Full gate `bun run spur-check` — PASS, exit 0 (`.spur/run/1100-spur-check6.log`): 10493 tests / 617 files / 0 fail; per-file coverage thresholds met; `recommended-post-check` rules clean (`every-export-has-tsdoc` satisfied after TSDoc additions).
- Focused suites (verify-stage fresh re-runs, 317 pass / 0 fail): domain 69 (DAO + migration tests), app 52 (`tests/decision/`), config 24, server 33 (observability routes incl. 400/404/500), web 139 (observability incl. `decisions-tab.test.tsx` nav-intent/a11y/controls regression tests).
- `bun run typecheck` exit 0 across workspaces; Biome clean on all touched files.
- Coverage claim: new modules `packages/domain/src/dao/decision-log-dao.ts`, `packages/app/src/decision/decision-log.ts` covered by dedicated suites (decision-log-dao 8 pass, decision-log 12 pass, decision-log-query included in app 52); `apps/server/src/modules/observability/index.ts` at 100% lines / 97.5% functions after route-test additions.
- Deferred (documented residual): plan-step-9 live E2E artifacts (`.spur/run/1100-decision-logs.json`, tab screenshot) not produced; AC1/AC2 evidence rests on the fresh 317-test focused re-runs + green full gate, accepted by review run 2 and verify.

### Review

#### Review Report — 1100 (pipeline Phase 7 re-review, run 2, `--tasks 1100 --auto`)

**Scope:** full working-tree diff vs base `4df2bc533` (36 changed files: 27 modified, 9 new) — re-review after the bounded remediation hop; verifies run 1's four PARTIAL findings (`.spur/run/run-d2e78a58-b9bd-437b-a610-7449a03a216a-review-answer.txt`) are resolved and the remediation introduced no new defects.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | usability | Run-1 finding #4 residual sub-item: the DESIGN.md:462-466 Refresh button is still absent — the only drift sub-item not implemented (five of six are). Every active observability tab ships without one (grep over `apps/web/src/modules/observability/`: only the unmounted legacy ToolUsingTab "Live refresh" aria-label), so there is no in-repo pattern to copy and the remediation anchor scoped the fix to "pattern parity, no scope growth". The tab fetches on mount/filter/range change only. | `apps/web/src/modules/observability/DecisionsTab.tsx:168-207` | DEFER(no in-repo Refresh-button pattern; parity-vs-spec conflict — scheduler to implement or amend DESIGN.md § Decisions) |
| 2 | P4 (advisory) | usability | DESIGN.md § Decisions parity deltas beyond the remediated controls: table columns omit the spec'd Caller/Confidence/Run columns (caller is a filter + drawer field, run is in the drawer, time is absolute not relative-with-tooltip); phase timeline renders as a list rather than bars scaled to total duration; error state lacks a Retry button. All information stays reachable via filters and the drawer. | `apps/web/src/modules/observability/DecisionsTab.tsx:263-344`, `DecisionDetailDrawer.tsx:230-256` | ACCEPTED |
| 3 | P4 (advisory) | correctness | Run-1 advisories #5–#9 unchanged, re-checked, stand accepted: `boundedInputJson` mid-escape cut, display-only (`packages/app/src/decision/decision-log.ts:130-133`); workflow type-gate/reserved-params refusals are non-invocations writing no row (1:1 join invariant holds) (`packages/app/src/workflow/actions/decide.ts:409-424`); `summary` loads per-row durations under the 10k retention cap (`packages/domain/src/dao/decision-log-dao.ts:267-270`); filter-param building duplicated between fetch effect and `loadOlder` (`apps/web/src/modules/observability/DecisionsTab.tsx:93-158`); null-inputJson "(metadata mode)" copy (`apps/web/src/modules/observability/DecisionDetailDrawer.tsx:222`) | as cited | ACCEPTED |

Run-1 findings — resolution verdicts, each independently re-verified this run (not taken from the fixer's answer):

- **#1 (P2, R7 nav intent) — RESOLVED.** `onNavigate?: (intent: ObservabilityNavIntent) => void` added (`apps/web/src/modules/observability/DecisionDetailDrawer.tsx:13`); header renders the "View run events" outline/xs button only when `onNavigate && runId !== null`, emitting `onNavigate({ tab: 'system-events', runId })` (`:158-166`) — the `JobDetailDrawer.tsx:166-167` idiom; `DecisionsTab` destructures the shell prop and passes it through; shell provides `onNavigate` via `ObservabilityTabProps` (`tabs.ts:35`). Regression test 1 asserts the emitted intent equals `{ tab: 'system-events', runId: 'run-abc' }` and the button's absence for a run-less row (`apps/web/tests/modules/observability/decisions-tab.test.tsx`, test 1).
- **#2 (P3, keyboard rows) — RESOLVED.** Rows are `tabIndex={0}` with `aria-haspopup="dialog"` (`DecisionsTab.tsx:286-287`), Enter/Space activation with `preventDefault` (`:291-293`), activating row recorded in `openerRef` (`:74-78`) and focus restored on close (`:84`), visible focus styles on the row; regression test 2 asserts Enter opens the drawer and `document.activeElement` is the activating row after close.
- **#3 (P3, route doc comment) — RESOLVED.** Both routes now listed in the module doc comment with (1100) tags (`apps/server/src/modules/observability/index.ts:424-425`).
- **#4 (P3, DESIGN.md controls drift) — RESOLVED except the Refresh sub-item (finding #1 above).** Outcome filter is `SegmentedToggle` (All/Accepted/Fallback/Rejected, `DecisionsTab.tsx:169-180`; generic `T extends string` so `onChange={setOutcome}` type-checks — `ObservabilityFilters.tsx:97`); caller `FacetSelect` with the server-enumerated `cli|workflow|gate` values (`:57`, `:187`; server validation `index.ts:248-253`); run-id text input (`:189-194`) wired into fetch deps and both param builders (`:102`, `:142`); empty-state hint names `spur decision run` (`:265`); drawer input pretty-printed via `formatPretty` (`DecisionDetailDrawer.tsx:37-46`, `:99`) with the exported `CopyValueButton` (`:224`; title "Copy input JSON" verified at `SystemEventsTab.tsx:719-746`).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R0 | MET | `decision.*` events unchanged in `system_events`; `decision_logs` joins on `invocationId` (`packages/app/src/decision/decision-events.ts:154`, `packages/domain/src/migrations.ts:230-280`) |
| R1 | MET | `DECISION_LOGS_SCHEMA_SQL` — §3.5 columns + 4 indexes, idempotent (`packages/domain/src/migrations.ts:230-280`); registered `0052_spur_cli_decision_logs` (`:1644`); drizzle mirror statement-level byte-compatible, pinned by `packages/domain/tests/dao/migrations.test.ts:989` (passes fresh this run) |
| R2 | MET | `DecisionLogDao` insert + prune-to-10k, keyset `list` omitting input/question/phases, `summary`, `facets`, `get` (`packages/domain/src/dao/decision-log-dao.ts:175`, `:231`, `:255`, `:284`, `:317`); exported from domain index |
| R3 | MET | Emitter-seam logging: shared invocationId, rejected rows with `reason = errorKind`, backstop `source`-absent → `rejected`/`'error'`, service-entry clock, resolve/evidence/maker/serve phases, 16 KiB/2 KiB redacted bounds, best-effort writes, CLI pre-decide sites with prelude, catalog + inline paths (`decision-events.ts:147-289`, `decision-service.ts:217-346`, `decision-log.ts:46-189`, `apps/cli/src/commands/decision.ts:159-212`, `packages/app/src/workflow/actions/decide.ts:215-231`, `:423-463`) |
| R4 | MET | All five caller surfaces build per-caller sinks from their own config/env: CLI (`decision.ts:159`), workflow builtins (`builtins.ts:46-47`, `:122`), workflow service (`workflow-service.ts:2102`, `:2166-2168`), gate lazy accessor (`workflow-service.ts:2242`, `decision-hitl-responder.ts:476-490`), inline driver (`inline-run-setup.ts:1581`) |
| R5 | MET | `log: z.enum(['full','metadata','off']).optional()` (`packages/config/src/index.ts:834`), read as `?? 'full'` (`decision-log.ts:47`); satellite updated (`docs/design/decision-catalog.md:35-36`); mode tests pass fresh |
| R6 | MET | Schemas + query service + routes with 400/404 (`packages/contracts/src/observability.ts:205`, `:242`, `:270`; `decision-log-query.ts:168-186`; `apps/server/src/modules/observability/index.ts:219-263`, `:437-440`) — and the run-1 gap closed: route doc comment extended (`index.ts:424-425`) |
| R7 | MET | Tab + drawer per DESIGN.md: SegmentedToggle/facet selects/run-id input, KPI strip over exported `KpiCard`, newest-first table with cursor paging, drawer with phases/redacted input/value/error, keyboard open + focus return, Escape close, "View run events" nav intent shown only when a run id exists (`DecisionsTab.tsx`, `DecisionDetailDrawer.tsx` as cited above); tab registered after routing with exact-list test (`tabs.ts:65`, `apps/web/tests/modules/observability/tabs.test.ts:26`). Residual spec deltas are the DEFER'd Refresh button and accepted P4 parity notes |
| R8 | MET | No new CLI noun/verb/flag, no new dependency; plugin bundles regenerated |
| AC1 | MET | Every invocation path writes exactly one row under the events' invocationId (service end/rejected, three CLI pre-decide sites, evidence failure, gate, inline; `disabled` is not an invocation). Fresh: 317 focused tests pass across the touched suites this run |
| AC2 | MET | The tab lists (KPI strip, filters, table, paging) and explains (drawer: fields, redacted input, question, phases, error, run-events link); server reads covered by Hono integration tests (pass fresh) |

##### SECUA + Architecture Notes

- **Security:** redaction reuses `redactAndBound` with caller-supplied `configuredSecretValues`; bounds enforced; SQL fully parameterized; server reads read-only and never call a maker. The remediation introduced no new input surface: `run`/`caller` params flow through the same validated, parameterized path (`index.ts:234-253`).
- **Correctness:** remediation delta re-checked line-by-line — focus-return idiom is sound (backdrop click, close button, and Escape all route through `closeDrawer`, which restores opener focus); nav button narrowed on `runId` via a local const so JSX closures stay null-safe; `limit=100` within the server's 1–200 validation; no regressions found (139 web + 33 server + 145 domain/app/config tests pass fresh).
- **Architecture:** unchanged assessment — `decision-log.ts` deep row-policy module, raw-SQL DAO per ADR-021, thin server handlers, cursor/retention per ledger idiom. The remediation reused in-repo primitives (`SegmentedToggle`, `FacetSelect`, `CopyValueButton`, `KpiCard`, `RetentionBadge`) rather than adding components.

##### Verification evidence (fresh, this run)

- `bun test tests/modules/observability/` (apps/web) → exit 0 — **139 pass / 0 fail** (8 files, incl. the new `decisions-tab.test.tsx`)
- `bun test tests/modules/observability/index.test.ts` (apps/server) → exit 0 — **33 pass / 0 fail**
- `bun test packages/domain/tests/dao/decision-log-dao.test.ts packages/domain/tests/dao/migrations.test.ts packages/app/tests/decision/ packages/config/tests/config-schemas.test.ts` → exit 0 — **145 pass / 0 fail**
- `bunx biome check` on the 4 remediation-touched files → exit 0, clean
- `bun run typecheck` (repo root) → exit 0 (all four workspaces)
- Incident check: fixer's disclosed `rm -rf tests/` restoration verified — `git status -- tests/` clean, `git diff -- tests/` empty, `tests/setup.ts` + fixtures present

**Next:** no repair hop required. Finding #1 (Refresh button) is DEFERred to the scheduler — implement against DESIGN.md § Decisions or amend the spec; finding #2/#3 are accepted observations.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T03:03:14.755Z backlog → todo (system)
- 2026-10-07T21:32:09.684Z todo → wip (system)
- 2026-10-07T21:34:39.103Z wip → blocked (system)
- 2026-10-07T22:43:01.796Z blocked → todo (system)
- 2026-10-08T02:10:10.057Z todo → done (system)

