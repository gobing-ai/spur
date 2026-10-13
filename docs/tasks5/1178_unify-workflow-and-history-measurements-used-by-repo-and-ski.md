---
schema_version: 1
name: Unify workflow and history measurements used by repo and skill tools
status: done
template: feature-impl
created_at: 2026-10-12T03:34:10.720Z
updated_at: "2026-10-13T05:43:32.638Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 10

dependencies: ["1177"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1178-verdict.json
---

## 1178. Unify workflow and history measurements used by repo and skill tools

### Background

Implements: R6 — Workflow and history analytics share canonical measurement services.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Query extraction was described only as an app move → domain is sole SQL/DAO owner; app composes queries and measurements.
- Existing workflow-promotion and budget policy looked like reusable harness behavior → keep repository candidate/cohort policy local and centralize only reusable measurements.
- Whole transcript helper could move into app → host path/env/format normalization remains a plugin adapter; only normalized measurement/actor/window aggregation moves.
- History absence could silently look like zero → missing DB/tables is unavailable, genuinely empty measured data is zero; preserve estimate labels.
- Analytics might require a public reporting extension → current app services and documented generated packaging suffice; public transport is separately deferred.

### Requirements

- [x] R1. Move reusable workflow run/state query and cost aggregation out of repository commands into domain query ownership plus app workflow measurement; preserve repo cohort, budget and promotion policy locally.
- [x] R2. Move pure actor/window/run-summary aggregation into app workflow ownership while retaining host transcript resolution/normalization and summary file presentation in plugin adapters.
- [x] R3. Replace daily-summary SQLite access with a high-level app history-health reader using existing domain history rollups; retain skill report composition and explicitly distinguish unavailable measurements from measured zero.
- [x] R4. Preserve installed source/Node/Bun contracts, deterministic reports and provenance without new public reporting flags, migrations or paid/live-agent calls.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [x] AC1 — Workflow and history analytics share canonical measurement services (req: R1)

Given the frozen supported source and installed contracts, when this slice runs against deterministic fixtures, then new app tests/workflow/run-measurements.test.ts and run-summary.test.ts observe real query/aggregation behavior with in-memory SQLite and normalized transcript fixtures; keep scripts/commands/real-run-cost.test.ts, pipeline-budgets.test.ts and workflow-promotion.test.ts as adapter/cohort-policy parity tests. Plugin tests/run-summary.test.ts, session-timeline.test.ts and daily-summary/daily-summary.test.ts observe rendering, absence/zero distinctions and close callback behavior. Extend app history-service/history-board-service tests to observe real rollup health reads, including missing tables, empty tables and date filters. Bundle tests and isolated plugin-smoke prove source/installed/runtime parity without paid models or real history DB access.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T04:01:28.074Z

- Closed: no new public CLI API; canonical application services and current script contracts are sufficient for this batch.
- Closed: generated application operations remain an explicit standalone packaging exception with a single source owner, compatibility tests and no plugin DAO facade.
- Deferred owner: operator, separately approved owning-noun transport can retire the exception later. It is outside this implementation scope; --auto does not approve it.

### Design

WHAT/WHY: one measurement implementation with explicit provenance, no second SQL reader in scripts/plugin lib. No new public CLI API. Primary targets: existing domain run/action/session/transition DAOs and history-board analytics; proposed app `packages/app/src/workflow/run-measurements.ts` and `packages/app/src/workflow/run-summary.ts`; existing app history services; real-run-cost/pipeline-budgets/workflow-promotion scripts and plugin summary/timeline/daily adapters.

Move reusable readWorkflowRuns/readWorkflowMetrics/readStateMetrics and their existing WorkflowMetrics/StateMetrics result contracts to the application measurement owner. Put SQL access in existing domain DAO/query modules (a focused domain analytics workflow-measurements.ts is allowed if no existing DAO owns the joins); do not transplant bun:sqlite into app as a shortcut. App composes explicit database/project inputs instead of fixed REPO_ROOT. Repository scripts retain workflowsDir cohort selection, candidate promotion decisions, baselines, stable JSON formatting and CLI dispatch. Preserve current exported wrappers needed by local callers until callers/tests migrate coherently; no production code imports scripts/commands. Reuse existing step-profile projections/statistics when semantics match; do not replace a percentile/median with a differently defined estimator. Move workflow-promotion readAgentRunHistory and countRealTerminalRuns query bodies to the same domain/app measurement boundary. Keep their distinct existing dryRun/cohort predicates: the former excludes numeric dryRun=1 and requires valid timestamps, while the retirement count accepts only its documented absent/false/zero forms and has no timestamp gate. Do not silently align those predicates. Existing Database-accepting repository wrappers may remain temporarily for caller/test compatibility but must delegate query access rather than contain SQL. Both read-only workflow-promotion queries and real-run-cost queries must leave the repo adapter. Keep pipeline-budgets' repository threshold decisions local.

Move actorSplit and buildRunSummary plus their pure interval/token aggregation into app workflow/run-summary, preserving current structural Progress/SummaryRow/ActorSplit/RunSummary shapes and existing workflow progress projection. Normalized transcript types belong with app measurement, imported type-only by plugin; application code must not import plugins/sp. Plugin transcript.ts retains resolveTranscript, host format detection/parsing and environment/path handling; normalize once before passing rows/timestamps. Plugin run-summary-core retains close summary host callback, receipt file read, Markdown rendering and durable/scratch report writing only; use existing generated pure plan-projection entry for pure summary exports rather than adding a new bundle framework. Avoid forcing Bun into Node-pure timeline/rollup paths. Close callback remains injected into app inline runner, preserving dependency direction and nonfatal summary failure.

Add internal `readHistoryHealth` to the existing app history service, with explicit date/db inputs and result matching daily report needs. Reuse domain loop findings/tool rollup queries and current app history owners; no raw SQL or SQLite import in daily-summary. Its getSpurHistoryHealth adapter calls the high-level operation through the existing Bun-capable inline generated entry; retain Node-to-Bun conversion where required. Missing DB or required schema returns null/unavailable and renders existing n/a path; an existing empty table produces measured zero. Keep the repeats*250 estimate explicitly estimated and suggested remediation as text only. No history import/mutation or real-data telemetry during tests.

Preserve mapped/unmapped coverage, terminal/nonterminal/dry cohort filtering, null costs, stable key order and first-to-last transition active lower bound. Actor spans are clipped/unioned and priority-subtracted so categories exactly partition each run window; overlap and rollup wall span are not sums of elapsed windows. Missing transcript/gate receipt remains n/a with a reason; receipt.runId must match. Retain total versus noncached token semantics. No new parser, general analytics abstraction or extra registry.

Dependencies and handoff: Requires 1177 canonical runtime loader/export boundaries (1173/1176 transitive); set dependency to 1177 only. Consume the preserved pure and Bun-capable generated entries without new bundle/CLI contracts. Final A91 slice leaves all measurement ownership in domain/app and only repo/host presentation policy in adapters.

Environment: use current Bun/TypeScript workspaces and Superskill conversion; no dependency or migration change. No wip tasks or extra worktrees existed at batch kickoff. Recheck file conflicts and generated freshness before implementation.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [x] 1. R1: inventory real-run-cost, pipeline-budgets and workflow-promotion queries/callers; freeze deterministic outputs and cohort/statistics semantics with in-memory SQLite fixtures.
- [x] 2. R1: move queries to domain and reusable aggregation to app run-measurements; update all repository imports while leaving candidate/budget/config policy local.
- [x] 3. R2: move pure run-summary aggregation/types to app; normalize host rows in plugin, update run-summary/timeline/close callers and use existing pure generated export entry.
- [x] 4. R3: add readHistoryHealth using current app/domain history queries; replace daily-summary direct SQLite with high-level call and explicit unavailable/empty handling.
- [x] 5. R4: regenerate affected bundles/twins; test unknowns, overlap partitions, skew, installed summary/daily behavior, deterministic reports, placement/standalone and task-local gate. Update ownership docs and shrink baseline only after current scans prove removal.

### Solution

One measurement implementation, one SQL owner, adapters keep host/policy concerns. SQL moved to `packages/domain` (ADR-011 keeps `bun:sqlite` there); reusable folding moved to `packages/app/src/workflow`; repository scripts keep cohort/budget/promotion policy and stable output; plugin adapters keep transcript resolution, rendering and the close callback. The pure aggregation rides the existing generated pure entry (`plan-projection`) and the Bun-capable `inline-run` entry — no new bundle, registry, flag, migration or public CLI surface.

**R1 — reusable run/state queries + cost aggregation out of repository commands**

| `file:line` | Change |
| --- | --- |
| `packages/domain/src/analytics/workflow-measurements.ts:76` | `readWorkflowRuns` — the runs SQL (terminal/non-dry population, typed cost/token columns, `sinceMs` on epoch-ms `created_at`) now lives in domain, returning null for unmeasured cost/tokens instead of 0 |
| `packages/domain/src/analytics/workflow-measurements.ts:178` | `readWorkflowStateActionRows` — per-state action/wall folds moved out of the repo script |
| `packages/domain/src/analytics/workflow-measurements.ts:210` | `readWorkflowStateVisitRows` — per-(state, run) visit query moved out of the repo script |
| `packages/domain/src/analytics/workflow-measurements.ts:251` | `readAgentRunHistoryRows` — workflow-promotion's read-only agent-run query; keeps its distinct predicate (rejects numeric `dryRun=1`, requires valid timestamps) |
| `packages/domain/src/analytics/workflow-measurements.ts:287` | `readRealTerminalRunCounts` — the retirement count with its own predicate (no timestamp gate; accepts only absent/false/zero dry-run forms); the two predicates stay deliberately unaligned |
| `packages/domain/src/analytics/index.ts:281` | Domain analytics barrel re-exports the moved `readWorkflowRuns`/state/promotion query entry points to their consumers |
| `packages/app/src/workflow/run-measurements.ts:155` | `readWorkflowMetrics` — reusable folding (excluded-row coverage, independent cost/token folds, transition active-time bound) now in app workflow ownership |
| `packages/app/src/workflow/run-measurements.ts:198` | `readStateMetrics` — per-state visit/retry/agent.run and wall-percentile fold in app |
| `packages/app/src/workflow/run-measurements.ts:88` | `nearestRankPercentile` reused unchanged (nearest-rank, no interpolation) rather than re-estimated |
| `packages/app/src/workflow/run-measurements.ts:21` | `WorkflowMetrics` result contract preserved for existing callers |
| `scripts/commands/real-run-cost.ts:53` | Repository wrapper delegates to the app measurement owner (`readWorkflowMetrics`); the module carries no reader of its own |
| `scripts/commands/real-run-cost.ts:41` | Re-export of `nearestRankPercentile`/metric types keeps the script's prior import surface |
| `scripts/commands/pipeline-budgets.ts:252` | Budget threshold decisions stay local; the module only consumes the shared `readWorkflowMetrics` |
| `scripts/commands/workflow-promotion.ts:242` | Promotion adapter delegates `readAgentRunHistoryRows` to domain; workflow cohort selection for this path is unchanged |
| `scripts/commands/workflow-promotion.ts:445` | Retirement count delegates to domain; candidate/baseline policy local |
| `scripts/commands/workflow-promotion.ts:317` | Incumbent-baseline promote/delete decision and the stable report bytes remain in the repository adapter |

**R2 — pure actor/window/summary aggregation in app; host handling in plugin**

| `file:line` | Change |
| --- | --- |
| `packages/app/src/workflow/run-summary.ts:391` | `actorSplit` — clipped/unioned spans, priority subtraction, exact window partition; app-owned |
| `packages/app/src/workflow/run-summary.ts:518` | `buildRunSummary` — pure run-summary projection over normalized rows |
| `packages/app/src/workflow/run-summary.ts:200` | `accumulate` — token/wall/wait interval aggregation (total vs noncached semantics preserved) |
| `packages/app/src/workflow/run-summary.ts:299` | `RunSummary`/`SummaryRow`/`ActorSplit`/`GateTime` structural shapes unchanged so renderers keep working |
| `packages/app/src/workflow/plan-projection.ts:25` | Pure aggregation exported through the existing generated pure entry — no second bundle or registry |
| `plugins/sp/lib/transcript.ts:81` | `resolveTranscript` — host path/env resolution stays in the plugin adapter |
| `plugins/sp/lib/transcript.ts:57` | `parseRows` — host format detection and normalization happen once, in the adapter |
| `plugins/sp/lib/transcript.ts:18` | Re-export block keeps the plugin's single import path to the app-owned pure aggregation |
| `plugins/sp/lib/run-summary-core.ts:34` | Adapter re-exports `actorSplit`/`buildRunSummary`/types from the generated entry; the implementation is delegated, never duplicated |
| `plugins/sp/lib/run-summary-core.ts:42` | Markdown rendering stays in the plugin |
| `plugins/sp/lib/run-summary-core.ts:168` | `writeCloseSummary` — receipt read and durable/scratch report writing stay host-side |
| `plugins/sp/lib/run-summary-core.ts:212` | `gateFromReceipt` — receipt `runId` match and missing-receipt reason n/a path unchanged |
| `plugins/sp/lib/plan-projection.generated.d.mts:193` | Generated declaration for the app-owned `buildRunSummary` |
| `plugins/sp/lib/plan-projection.generated.mjs:1` | Committed generated twin carries the moved pure code; the bundle source is the pure plan-projection entry, regenerated never hand-edited |
| `scripts/commands/bundle-plugin-lib.ts:694` | Bundle comment/doc records the shared pure entry; regenerated, not hand-edited |

**R3 — daily-summary reads history health through the app service**

| `file:line` | Change |
| --- | --- |
| `packages/app/src/services/history-service.ts:1249` | `HistoryService.readHistoryHealth` — high-level health reading over existing domain rollups |
| `packages/app/src/services/history-service.ts:1676` | `readHistoryHealth({ date, dbPath })` — file-database entry used by the installed adapter |
| `packages/app/src/services/history-service.ts:294` | `HistoryHealthReading` / input types carry the n/a-vs-zero distinction explicitly |
| `packages/domain/src/db.ts:50` | `openExistingDb` — opens an existing file without migrations, so an absent schema cannot be migrated into a fake empty table |
| `packages/domain/src/analytics/history-board-rollup.ts:1091` | `historyHealthSchemaPresent` — required-table presence check; absent ⇒ unavailable (`null`) |
| `packages/domain/src/analytics/history-board-rollup.ts:1105` | `historyBoardDailyLoopFindings` — loop findings from existing rollups |
| `packages/domain/src/analytics/history-board-rollup.ts:1123` | `historyBoardDailyToolTotals` — tool call/error totals from existing rollups |
| `packages/domain/src/analytics/index.ts:144` | Domain barrel exports the new rollup readers |
| `packages/app/src/index.ts:467` | App service export; the plugin reaches it through the documented generated-entry exception |
| `plugins/sp/lib/inline-run.generated.d.mts:24` | Bun-capable generated entry declares `readHistoryHealth` for the adapter |
| `plugins/sp/scripts/daily-summary/daily-summary.ts:380` | `getSpurHistoryHealth` calls the app operation; the adapter opens no SQLite and holds no SQL |
| `plugins/sp/scripts/daily-summary/daily-summary.ts:795` | `null` leaves `historyHealth` unset (existing n/a path); a measured zero is composed and rendered |
| `plugins/sp/scripts/daily-summary/daily-summary.ts:806` | Bun re-entry when the installed twin runs under plain node |
| `config/script-placement-baseline.json:24` | Placement baseline drops the retired daily-summary database-import exception |

**R4 — installed/Node/Bun contracts, determinism, provenance preserved**

| `file:line` | Change |
| --- | --- |
| `plugins/sp/lib/inline-run.generated.mjs:3147` | Installed bundle export list includes the app operation, so the staged plugin resolves it |
| `plugins/sp/tests/inline-run-app.test.ts:11` | `resolveAppEntry` — source checkout vs staged bundle resolution and stale-export naming |
| `plugins/sp/tests/inline-run-app.test.ts:27` | `loadInlineApp` — portable bundle export check names skew instead of failing as `is not a function` |
| `plugins/sp/tests/daily-summary/daily-summary.test.ts:962` | Unavailable database omits `historyHealth` (the n/a path) |
| `plugins/sp/tests/daily-summary/daily-summary.test.ts:973` | Empty tables keep a measured-zero history section |
| `apps/cli/tests/output-envelope.test.ts:41` | Byte-identity assertions freeze the clock so deterministic-report parity is a real assertion, not a same-instant artifact |

**Tests pinning the moved behavior**

| `file:line` | Change |
| --- | --- |
| `packages/domain/tests/analytics/workflow-measurements.test.ts:62` | Domain query fixtures against an in-memory database: unmapped cost/tokens null, dry-run metadata, time-bound gate |
| `packages/domain/tests/analytics/workflow-measurements.test.ts:120` | Per-state visit/action folds and promotion predicates in domain |
| `packages/domain/tests/analytics/workflow-measurements.test.ts:161` | `readAgentRunHistoryRows` vs `readRealTerminalRunCounts` predicate divergence pinned |
| `packages/app/tests/workflow/run-measurements.test.ts:71` | App folding (`readWorkflowMetrics`) over real query results: wall/active/cost/tokens/coverage and the since window narrowing |
| `packages/app/tests/workflow/run-measurements.test.ts:139` | Per-state metrics over the domain query |
| `plugins/sp/tests/run-summary.test.ts:91` | Pure summary aggregation on normalized transcript rows |
| `plugins/sp/tests/run-summary.test.ts:136` | `actorSplit` window partition (no overlap double-count) |
| `packages/app/tests/services/history-service.test.ts:1854` | Health read: missing table ⇒ null, empty tables ⇒ zero, day filtering, and a real file database |
| `scripts/commands/real-run-cost.test.ts:112` | Adapter parity: measurement repairs, cohort scope, deterministic serialization preserved |
| `scripts/commands/pipeline-budgets.test.ts:23` | Budget decisions stay local and keep their thresholds |
| `scripts/commands/workflow-promotion.test.ts:129` | Cohort/promotion policy parity across the delegated query boundary |
| `plugins/sp/tests/run-summary.test.ts:69` | Adapter rendering/close behavior over app-owned aggregation |
| `plugins/sp/tests/session-timeline.test.ts:96` | Timeline rendering over the adapter's normalized rows |
| `plugins/sp/tests/daily-summary/daily-summary.test.ts:343` | Report composition for loops/remediation and the clean-status path |

**Gate defects and the branch rebase (2026-10-12)**

The full gate was red on four test-harness defects. Three of them were fixed independently on `main`
while this task ran, and this branch rebased onto `main`'s tip (`3e1251018`) inherits those fixes rather
than duplicating them:

| `file:line` | Change | Owner |
| --- | --- | --- |
| `apps/cli/tests/output-envelope.test.ts:302` | The raw-vs-enveloped equality compares `withoutLiveAge(...)`, so `agent doctor`'s live `usage.age` cannot break byte identity. | `main` (76eeede8b) |
| `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:66` | The `@/ui` `MockInput` forwards `value`/`onChange`, so the process-wide mock can no longer starve a later file's controlled input. | `main` (b6dd3e64c) |
| `apps/web/tests/modules/projects/DatabaseView.test.tsx:131` | `setControlValue` reads the props handle with `Object.getOwnPropertyNames` (the React key is non-enumerable), and the filter settles before the read. | `main` (59c2e6013, b6dd3e64c) |
| `apps/web/src/modules/projects/DatabaseView.tsx` | The filter value is settled before the rows read (product fix behind the above test repair). | `main` (59c2e6013) |

What this branch adds on the gate front instead:

| `file:line` | Change |
| --- | --- |
| `plugins/sp/tests/inline-run-app.test.ts:13` | New file pinning the portable bundle fallback and the stale-bundle refusal — the R3 adapter path's only coverage; `plugins/sp/lib/inline-run-app.ts` was 75.76% lines and failed the coverage gate. |
| `plugins/sp/tests/run-summary.test.ts:366` | New evidence for the `writeCloseSummary` success path (via `PI_SESSION_FILE`) and the unreadable-receipt branch: the old "success" assertion also held for the `n/a` branch, so the function body never executed and the file failed the coverage gate at 85.52%. |
| `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:207` | `CLI_GUARD_TIMEOUT_MS` 20s to 60s: the R4 guard cases spawn a real CLI child, which starved past 20s while three full suites ran concurrently on this host (isolated: ~1.3s). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Domain owns the SQL: `packages/domain/src/analytics/workflow-measurements.ts:76` (readWorkflowRuns), `:178`, `:210`, `:251` (readAgentRunHistoryRows), `:287` (readRealTerminalRunCounts); app folding `packages/app/src/workflow/run-measurements.ts:155` (readWorkflowMetrics), `:198` (readStateMetrics); repo adapters delegate: `scripts/commands/real-run-cost.ts:60`, `scripts/commands/workflow-promotion.ts:242`, `scripts/commands/workflow-promotion.ts:445`, `scripts/commands/pipeline-budgets.ts:252`; rg for bun:sqlite/SELECT/json_extract in adapters and run-measurements.ts → 0 hits. Re-run this turn: domain workflow-measurements 7 pass; scripts real-run-cost/pipeline-budgets/workflow-promotion/bundle-plugin-lib 85 pass 0 fail |
| R2 | MET | App-owned pure aggregation `packages/app/src/workflow/run-summary.ts:391` (actorSplit) and `packages/app/src/workflow/run-summary.ts:518` (buildRunSummary); plugin re-exports from the generated pure entry `plugins/sp/lib/run-summary-core.ts:34-40`; host transcript handling stays in `plugins/sp/lib/transcript.ts:57` (parseRows) and `plugins/sp/lib/transcript.ts:81` (resolveTranscript). Re-run: plugin run-summary/session-timeline/daily-summary/inline-run-app 138 pass 0 fail |
| R3 | MET | `packages/app/src/services/history-service.ts:1249` (HistoryService.readHistoryHealth) and file-db entry `packages/app/src/services/history-service.ts:1676`; schema presence `packages/domain/src/analytics/history-board-rollup.ts:1091`; daily-summary calls the app op at `plugins/sp/scripts/daily-summary/daily-summary.ts:389` and leaves historyHealth unset on null at `plugins/sp/scripts/daily-summary/daily-summary.ts:795-797`; unavailable vs measured-zero tests `plugins/sp/tests/daily-summary/daily-summary.test.ts:962` and `plugins/sp/tests/daily-summary/daily-summary.test.ts:973`. Re-run: app run-measurements/run-summary/history-service 92 pass 0 fail |
| R4 | MET | Installed entry declares the op `plugins/sp/lib/inline-run.generated.d.mts:24`; daily-summary contains no bun:sqlite/SQL (rg → 0 hits); `bun scripts/commands/plugin-install-smoke.ts` → PASS this turn; bundle-plugin-lib tests pass in-workspace; no new CLI noun/verb/flag, migration or dependency in the tagged commits |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Workflow and history analytics share canonical measurement services (req: R1) | MET | test | Re-run this turn, deterministic fixtures, no paid/live calls: `packages/domain/tests/analytics/workflow-measurements.test.ts` 7 pass (in-memory SQLite); `packages/app/tests/workflow/run-measurements.test.ts` + `run-summary.test.ts` + `packages/app/tests/services/history-service.test.ts` 92 pass; `scripts/commands/real-run-cost.test.ts`, `pipeline-budgets.test.ts`, `workflow-promotion.test.ts`, `bundle-plugin-lib.test.ts` 85 pass; plugin `tests/run-summary.test.ts`, `tests/session-timeline.test.ts`, `tests/daily-summary/daily-summary.test.ts`, `tests/inline-run-app.test.ts` 138 pass (n/a at `plugins/sp/tests/daily-summary/daily-summary.test.ts:962`, measured zero at `plugins/sp/tests/daily-summary/daily-summary.test.ts:973`); plugin-install-smoke PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — Confidence: HIGH.

Confidence: HIGH

Fresh reviewer session; review-only (no product/test edit, no worktree, no pipeline re-entry). Reviewed the uncommitted tree on `sp/run-1178-6066` at the certified digest `sha256:1bd6e66b0146b849570f6c58812acef5180e892466114f2581202f7d640a124a`.

Dimensions: functional traceability R1–R4 met and the `## Solution` map is accurate in substance; SECUA clean (no SQL/`bun:sqlite` outside `packages/domain`, no secret or shell-interpolation change, no new public surface, no paid/live call); architecture ownership holds (ADR-011, ADR-130 glue budget, plugin standalone contract).

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P3 (minor) | Four R2 change-map rows (`:115`–`:118`) name `plugins/sp/scripts/run-summary.ts` as the home of `actorSplit`/`buildRunSummary`/`accumulate`/`RunSummary`, but that file is 107 lines and holds none of them; the quoted line numbers (391 `actorSplit`, 518 `buildRunSummary`, 200 `accumulate`, 299 `RunSummary`) match `packages/app/src/workflow/run-summary.ts` exactly, so only the path in the map is wrong, not the code. | `docs/tasks5/1178_unify-workflow-and-history-measurements-used-by-repo-and-ski.md:115` | DEFER — documentation-only; correct the path in the Solution map after this run (the digest is frozen). No code or test impact. |
| P4 (advisory) | Seven changed paths are absent from the Solution change map (3 `apps/web/tests` files removing a process-wide `mock.module('@/ui')` leak, `apps/cli/tests/output-envelope.test.ts` clock freeze, `feature-lifecycle-adapter.test.ts` 20s→60s subprocess budget, feature-doc status). All are test-hygiene/gate-contention edits with no product behavior change; they are part of the certified digest (e.g. the leak site `apps/web/tests/modules/observability/decisions-tab.test.tsx:16`). | `apps/web/tests/modules/observability/decisions-tab.test.tsx:1` | DEFER — operator decides whether to keep them as in-run gate hygiene or split them; no correctness impact either way. |
| P4 (advisory) | `daily-summary` `main()` now re-execs `bun` when not running under Bun, so the documented `node …/n.mjs` invocation exits 1 on a host without `bun` on PATH, where it previously degraded to an unavailable history section (precedent `plugins/sp/scripts/inline-run-setup.ts:53`). | `plugins/sp/scripts/daily-summary/daily-summary.ts:807` | ACCEPT — identical precedent already shipped by 1177 in `plugins/sp/scripts/inline-run-setup.ts:53` and `inline-run-dispatch.ts:36`; the installed runtime contract is unchanged in kind. |

Evidence (all run in this tree on 2026-10-12; no gate re-run):

- `rg -n "bun:sqlite" packages/app apps/web plugins --glob '!node_modules'` → hits only in the generated `plugins/sp/lib/inline-run.generated.mjs` bundle and plugin tests; no `packages/app/src`, no `apps/web/src`.
- `rg -n "scripts/commands" packages/app/src packages/domain/src` → comment references only, no value import.
- `bun scripts/commands/script-contract-check.ts` → `22 script(s) baselined (22 standard, 0 repo-only), 0 violation(s) — PASS` (proves each `.mjs` twin is byte-identical to a fresh convert of its `.ts` source, and that no plugin script carries an `@gobing-ai/*` value import).
- Behaviour preservation by normalized body diff of `HEAD:plugins/sp/lib/run-summary-core.ts`, `HEAD:plugins/sp/lib/transcript.ts`, `HEAD:plugins/sp/scripts/run-summary.ts` against `packages/app/src/workflow/run-summary.ts`: `actorSplit`, `buildRunSummary` internals, `accumulate`, `sumSpans`, `formatTokenSplit`, `formatDuration`, `formatTokens`, `isCompaction`, `promptText`, `skillInvocationPrompt`, `subtract`, `summaryRow`, `unionMs`, `attemptWindow` are byte-identical after comment/whitespace normalization; the only textual delta is `actorOf` reading the renamed `LOWERCASE_OPERATOR_TOOLS` (`{askuserquestion, ask_user_question}` — same members as the old `OPERATOR_TOOLS`), while the case-sensitive `OPERATOR_TOOLS` used by `accumulate` is preserved verbatim.
- Domain SQL vs `HEAD:scripts/commands/real-run-cost.ts` and `HEAD:scripts/commands/workflow-promotion.ts`: identical predicates/subqueries (`json_extract(metadata_json,'$.dryRun') IS NOT 1`, `started_at/completed_at` bounds, `completed_at >= started_at`, `s.exactness = 'exact'`, `transition_runs`, `action_runs`, `r.created_at >= ?` for `sinceMs`), with the parameter order matching the placeholder order — a move, not a re-query. No second query path is left in the repo adapters (`rg "SELECT |json_extract" scripts/commands/real-run-cost.ts workflow-promotion.ts pipeline-budgets.ts` → 0 hits).
- The two promotion predicates stay distinct: `packages/domain/src/analytics/workflow-measurements.ts:251` rejects numeric `dryRun=1` and requires both timestamps (`readAgentRunHistoryRows`), while `:287` (`readRealTerminalRunCounts`) has no timestamp gate and accepts only absent/`0`/`'0'`/`'false'`; the domain test pins the divergence (`packages/domain/tests/analytics/workflow-measurements.test.ts:161`).
- `nearestRankPercentile` is reused unchanged (`packages/app/src/workflow/run-measurements.ts:88`, nearest-rank, `null` on an empty sample); unmapped cost/tokens stay `null` (`:155` fold), measured zero stays 0, and the daily report keeps `n/a` for an unavailable reading (`plugins/sp/scripts/daily-summary/daily-summary.ts:795`, tests at `:962` unavailable vs `:973` measured zero).
- `buildRunSummary` signature change (`lines[]` → normalized `rows`) is threaded by both callers with `skippedLines` (`plugins/sp/scripts/run-summary.ts:94`, `plugins/sp/lib/run-summary-core.ts:185`); no caller still passes raw lines.
- Generated twins carry the moved code and agree with their declarations: `actorSplit`/`buildRunSummary` in `plugins/sp/lib/plan-projection.generated.mjs:371,472`; `readHistoryHealth` declared in `plugins/sp/lib/inline-run.generated.d.mts:24` and exported by the `.mjs`; every declared-but-unexported name in the `.d.mts` is a type-only declaration.
- No new public surface, migration or dependency: `git status --porcelain` touches no `apps/cli/src`, no `package.json`, no `drizzle/`; the only `apps/cli` change is a test.
- Tests run green in this tree: `packages/app` `run-measurements`/`run-summary`/`history-service` → 92 pass/0 fail; `packages/domain` `workflow-measurements` → 7 pass/0 fail; `scripts/commands` `real-run-cost`/`pipeline-budgets`/`workflow-promotion` → 67 pass/0 fail; `plugins/sp` `run-summary`/`daily-summary`/`session-timeline`/`inline-run-app` → 138 pass/0 fail.

Residual risk (accepted, non-blocking): the pure aggregation now rides `plan-projection.generated.mjs`, so converted twins that import that entry inline it — `plugins/sp/scripts/batch-plan.mjs` grew +381 lines, `inline-run-setup.mjs`/`run-summary.mjs`/`session-timeline.mjs` carry it too. This is build-output duplication in one-shot Node scripts, not a second source implementation, and no generated lib bundle has an automated freshness check (the gate covers script twins only). `daily-summary` also pays one ~0.3 s app-bundle import per invocation instead of a direct `bun:sqlite` open. Second, an ad-hoc combined plugin test invocation (`bun test tests/run-summary.test.ts tests/daily-summary/... tests/session-timeline.test.ts tests/inline-run-app.test.ts`) failed `parseArgs > ignores --date when no value follows` once and passed on two re-runs — the argv-mutating tests in that file are pre-existing and untouched by this diff.

Not checked (out of scope for this review): `bun run test:heavy` / installed `plugin-smoke` runtime parity; the full 9-minute `bun run spur-check` (the stated digest is trusted, and re-running it is forbidden here); the three `apps/web` test files were inspected as diffs only, and the pre-fix gate red they claim to repair was not reproduced; no live-history comparison of the pre/post `daily-summary` numbers on a real database (only fixtures); no paid/live model call was exercised or needed.

#### Post-review corrections (driver, record stage — 2026-10-12)

Applied after the reviewer signed off, in the corpus only (no code, no test, so the certified digest
`sha256:1bd6e66b…` is unchanged and no re-review is owed):

- **P3 (minor) — RESOLVED.** The four R2 change-map rows now cite `packages/app/src/workflow/run-summary.ts`
  (`:391` `actorSplit`, `:518` `buildRunSummary`, `:200` `accumulate`, `:299` `RunSummary`), the file that
  actually holds them; the line numbers were already the reviewer's verified ones. This also clears the
  invalid-anchor class the `done` probe would otherwise report.
- **P4 (advisory), unlisted paths — RESOLVED.** The `## Solution` map gained a "Gate-hygiene edits" subsection
  listing all seven previously-unlisted paths with `file:line` anchors and their reasons (three `apps/web`
  test files, two `apps/cli`/`packages/app` test files, two `plugins/sp` test files — one of them new).
- **P4 (advisory), `daily-summary` node re-exec — ACCEPTED as authored** (precedent: 1177 shipped the same
  contract in `inline-run-setup.ts`); recorded as an accepted residual, not a deferral.


#### Post-rebase note (driver — 2026-10-12, after the review above was signed)

This branch was rebased onto `main`'s tip (`3e1251018`) so it can fast-forward rather than merge. `main`
had independently fixed the same four gate defects while this task ran (`76eeede8b` envelope clock,
`b6dd3e64c` the process-wide `@/ui` mock, `59c2e6013`/`45465ed47` DatabaseView filter settle and paging
bounds). The rebase therefore took `main`'s copies of those files; the reviewer's P4 row about seven
unlisted paths is resolved by inheritance, and the `## Solution` map now names only this branch's own
gate-related additions (the two coverage test files and the adapter budget). Nothing in the reviewed
implementation changed: the R1–R4 source files rebased without conflict.

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065, ADR-021. Investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `scripts/commands/real-run-cost.ts:133`
- `scripts/commands/real-run-cost.ts:354`
- `scripts/commands/pipeline-budgets.ts:35`
- `scripts/commands/workflow-promotion.ts:1`
- `plugins/sp/lib/run-summary-core.ts:167`
- `plugins/sp/lib/run-summary-core.ts:288`
- `plugins/sp/lib/run-summary-core.ts:502`
- `plugins/sp/lib/transcript.ts:248`
- `plugins/sp/scripts/daily-summary/daily-summary.ts:290`
- `packages/app/src/workflow/step-profile.ts:244`
- `packages/app/src/services/history-service.ts:1`
- `packages/app/src/services/history-board-service.ts:1`

### History

- 2026-10-12T23:53:36.225Z todo → wip (system)
- 2026-10-13T02:40:17.781Z wip → testing (system)
- 2026-10-13T02:43:55.993Z testing → done (system)

