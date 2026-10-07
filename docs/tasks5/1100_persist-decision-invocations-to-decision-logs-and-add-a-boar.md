---
schema_version: 1
name: Persist decision invocations to decision_logs and add a Board Decisions tab
status: todo
template: feature-impl
created_at: 2026-10-07T02:58:40.297Z
updated_at: "2026-10-07T17:22:53.585Z"
feature_id: P1

dependencies: ["1095", "1113"]
priority: P2
estimate_hours: 12
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

- [ ] R0. Scope boundary: the `decision.*` lifecycle events from task 1095 stay in `system_events`, together with every other source. This task does not move, copy or widen them. `decision_logs` stores decision records (one per invocation), not events, and the two join on `invocationId`.
- [ ] R1. Add migration `0052_spur_cli_decision_logs`:
  - The file `drizzle/0052_spur_cli_decision_logs.sql` must be byte-compatible with a new `DECISION_LOGS_SCHEMA_SQL` constant in `packages/domain/src/migrations.ts`, registered after `0051_spur_cli_coordination_runs_parent` (`migrations.ts:1587`). Confirm `0052` is still the next free prefix at pickup (H15 work is landing in parallel).
  - It creates `decision_logs` with the columns of design §3.5 and a `maker_name` column holding the registered `DecisionMaker` name (the registry key, `ServedDecision.maker`; null only for a `rejected` row that failed before a maker resolved), and the indexes `(started_at)`, `(decision_id, started_at)`, `(maker_name, started_at)` and `(run_id)`.
  - It uses `CREATE TABLE IF NOT EXISTS` and is idempotent.
- [ ] R2. Add `packages/domain/src/dao/decision-log-dao.ts` (raw SQL over `DbAdapter`, the same pattern as `SystemEventDao`, `packages/domain/src/dao/system-event-dao.ts:263`). Export it from the domain index.
  - `insert(row)` inserts the row, then prunes everything beyond the newest 10,000 by `started_at`.
  - `list(spec{since?, decisionId?, makerName?, outcome?, caller?, runId?, limit, before?})` returns newest-first summary rows without `input_json`, `question` or `phases_json`, plus `nextCursor` (`started_at|id`).
  - `summary(spec)` returns `count`, `accepted`, `fallback`, `rejected` and the `duration_ms` values for the filtered set.
  - `facets(spec{since?})` returns the distinct decision ids and `maker_name` values.
  - `get(id)` returns the full row or null.
- [ ] R3. Record at the 1095 emitter seam (`packages/app/src/decision/decision-events.ts`):
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
- [ ] R4. Pass the DAO from every caller that 1095 wired:
  - `spur decision run` (`apps/cli/src/commands/decision.ts`) uses `new DecisionLogDao(await context.getDb())`, with `DecideOptions.decisionLog`;
  - the workflow decide runner uses a `DecideActionDeps.decisionLog` wired in `packages/app/src/workflow/builtins.ts`, from the workflow service DB;
  - the inline driver (`packages/app/src/services/inline-run-setup.ts`, `runInlineRunDecide`) uses `projectDb.adapter`;
  - the evidence-mode gate path (task 1099, landed: `packages/app/src/services/workflow-service.ts:2117` `buildDecisionEvaluator`, service injected at `:2179`) uses the workflow service DB. The gate calls `service.decide`, so the sink travels on `DecideOptions.decisionLog`. Mode and secrets come from the caller's own config, never from the cached service's `withConfig` state (`decision-service.ts:363-376`).
- [ ] R5. Config: `DecisionsConfigSchema` (`packages/config/src/index.ts:824`) gains a single key, `log: z.enum(['full', 'metadata', 'off']).default('full')`.
  - `off` writes no rows.
  - `metadata` writes rows with null `input_json` and `question`.
  - None of the values affects `decision.*` events.
  - `decisions` is optional in `spurConfigSchema` (`packages/config/src/index.ts:1001`); read the mode as `config?.decisions?.log ?? 'full'`.
  - Update the config table in `docs/design/decision-catalog.md` (the satellite that documents `decisions.paths/maker/makers`).
- [ ] R6. Contracts and server:
  - Add Zod schemas `decisionLogRowSchema`, `decisionLogDetailSchema` and `decisionLogListResponseSchema` (rows, summary{count, acceptedRate, fallbackRate, p95DurationMs}, facets{decisionIds, makers}, nextCursor) in `packages/contracts/src/observability.ts`.
  - Add an app query service, `packages/app/src/decision/decision-log-query.ts`, that computes rates and the nearest-rank p95.
  - Mount `GET /api/observability/decisions` and `GET /api/observability/decisions/:id` (404 when the row is missing; 400 on an invalid `outcome`, `caller` or `limit`) in `apps/server/src/modules/observability/index.ts`, next to `routing-summary` (`:360`).
  - Add both routes to the route doc comment at `:343`.
- [ ] R7. Board tab:
  - Add `apps/web/src/modules/observability/DecisionsTab.tsx` and `DecisionDetailDrawer.tsx`, following root `DESIGN.md` § Product UI — Decisions.
  - Register `{ id: 'decisions', label: 'Decisions' }` as `{ id: 'decisions', label: 'Decisions', component: DecisionsTab }` after `routing` in `OBSERVABILITY_TABS` (`apps/web/src/modules/observability/tabs.ts`), and update the exact-list test `apps/web/tests/modules/observability/tabs.test.ts`.
  - Reuse `fetchWithTimeout`/`resolveApiUrl` (`apps/web/src/lib/rpc-client`), `timeRangeSince`/`SegmentedToggle` (`ObservabilityFilters.tsx`), `formatDuration` (`SystemEventsTab.tsx`), `KpiCard` (exported from `SummaryTab.tsx:85`; currently module-private) and the `@/ui` primitives.
  - "View run events" uses the existing `{ tab: 'system-events', runId }` nav intent.
- [ ] R8. No new public `spur` noun, verb or flag. No new dependency.

### Acceptance Criteria

- [ ] AC1 — Every decision invocation is recorded in the decision log
- [ ] AC2 — The Board Decisions tab lists and explains recorded decisions

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T03:03:14.755Z backlog → todo (system)

