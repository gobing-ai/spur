# Code Classification Matrix

**Task:** 0163 — Classify and distribute existing code to ts-libs and spur-new
**Generated:** 2026-05-30
**Source repo:** `/Users/robin/xprojects/spur`
**Target repo:** `/Users/robin/xprojects/spur-new`
**Reference libraries:** `/Users/robin/xprojects/ts-libs`

## Purpose

This document is the migration map for the re-foundation work. Old `spur` remains a read-only reference. Follow-up tasks use this matrix to decide whether each old export is:

- already covered by `@gobing-ai/ts-*` and should be discarded from Spur-specific code,
- generic but missing from ts-libs and therefore a future ts-libs implementation task,
- a new standalone ts-libs package extraction,
- Spur-domain code that migrates into `spur-new`, or
- dead/obsolete code to discard.

## Current ts-libs Verification Amendments

The matrix below originated from the task planning notes, then was checked against the current local `ts-libs` checkout on 2026-05-30. These amendments are authoritative when they differ from older planning text:

- `@gobing-ai/ts-runtime` already exports the file-system helpers `readJsonFile`, `writeJsonFile`, `atomicWriteFile`, `atomicWriteJson`, `walkDir`, `resolveProjectPath`, `getProjectRoot`, `ensureDirForFile`, `getFs`, `setFileSystem`, and `createLogStream`. Treat matching old `@spur/core` helpers as covered by ts-runtime, not net-new ts-libs work.
- `@gobing-ai/ts-runtime` already includes generic config/env interpolation primitives such as `buildConfigFromObject`, `buildConfigFromYaml`, `parseConfigYaml`, `interpolateEnv`, `interpolateTree`, `getNodeEnv`, `isTestEnv`, and `getDatabaseUrl`. Reuse these where they match; keep only Spur-specific config shape in `spur-new`.
- `@gobing-ai/ts-infra` currently exports `JobQueue` and `QueueConsumer` interfaces but still does not export `DBJobQueue`/`DBQueueConsumer` implementations. DB-backed queue implementation remains separate work or local `spur-new` wiring.
- `@gobing-ai/ts-utils` currently exports only `access`, `api-response`, `const`, `cursor`, `date`, `errors`, `origin`, and `output`. It still lacks `collections`, `path/glob`, general YAML document parsing, and redaction modules.

## C2 Rule for Absorb Items

"Absorb into ts-libs" means one of two things:

- **Already present:** use the existing ts-libs implementation and do not migrate old Spur code.
- **Missing today:** create a dedicated future ts-libs task, or inline locally into `spur-new` until that package work is scheduled and gated.

This task does not implement net-new ts-libs features.

## Classification Matrix

### @spur/core — Infrastructure (~150 exports)

#### Duplicates (ts-libs already has it → Discard)

| Export | ts-libs Equivalent | Notes |
|--------|-------------------|-------|
| `echo`, `echoError`, `setDefaultOutputTargets`, `createBufferTarget`, `BufferTarget`, `WriteTarget` | `@gobing-ai/ts-utils` output module | Identical API |
| `getLogger`, `initializeLogger` | `@gobing-ai/ts-infra` logger | Same @logtape/logtape wrapper |
| `APIClient`, `APIClientConfig`, `APIError`, `RequestOptions` | `@gobing-ai/ts-infra` api-client | Same implementation |
| `EventBus`, `EventMap`, `SubscribeOptions`, `createLifecycleBus` | `@gobing-ai/ts-infra` event-bus | Same pattern |
| `createSystemBus`, `AppInternalEvents` + all event detail types | `@gobing-ai/ts-infra` events | Same bus + event taxonomy |
| `ProcessExecutor`, `OutputPolicy`, `ProcessExecutorConfig`, `ProcessResult` | `@gobing-ai/ts-runtime` process-executor | ts-runtime has NodeProcessExecutor + CF variant |
| `createDbAdapter`, `DbAdapter`, `DbAdapterConfig`, `DbClient`, `DbTable` | `@gobing-ai/ts-db` adapter | ts-db has BunSqliteAdapter + D1Adapter |
| `QueueJobDao`, `QueueJobRecord` | `@gobing-ai/ts-db` queue-job-dao | Same DAO pattern |
| `BaseDao`, `EntityDao`, `EntityTable`, `PKColumn`, `SoftDeletableTable` | `@gobing-ai/ts-db` base-dao / entity-dao | Same |
| `buildStandardColumns`, `buildStandardColumnsWithSoftDelete`, `nowTimestamp`, `standardColumns`, `standardColumnsWithSoftDelete` | `@gobing-ai/ts-db` schema/common | Same schema helpers |
| `API_ERROR_CODES`, `ApiEnvelope`, `successResponse`, `errorResponse`, `badRequestResponse`, `conflictResponse`, `forbiddenResponse`, `infoResponse`, `internalErrorResponse`, `notFoundResponse`, `paginatedResponse`, `unauthorizedResponse`, `validationErrorResponse`, `ApiEnvelopeResult`, `ApiErrorCode`, `ApiErrorEnvelope`, `ApiSuccessEnvelope` | `@gobing-ai/ts-utils` api-response | ts-utils has api-response module |
| `EnqueueOptions`, `Job`, `JobHandler`, `JobQueue`, `QueueConsumer`, `QueueConsumerConfig`, `QueueStats` | `@gobing-ai/ts-infra` job-queue | Interfaces are covered. `DBJobQueue` and `DBQueueConsumer` implementations are not covered; see current gaps below. |
| `CloudflareSchedulerAdapter`, `NoOpSchedulerAdapter`, `SchedulerAdapter`, `ScheduledJob`, `ScheduledJobHandler`, `initScheduler`, `wrapScheduledHandler` | `@gobing-ai/ts-infra` scheduler | ts-infra has CloudflareSchedulerAdapter, NodeSchedulerAdapter, NoopSchedulerAdapter |
| `initTelemetry`, `initMetrics`, `shutdownTelemetry`, `shutdownMetrics`, `isTelemetryInitialized`, `isMetricsInitialized`, `addSpanAttributes`, `addSpanEvent`, `getActiveSpan`, `trace`, `traceAsync`, `traceSync`, `withSpan`, `extractSqlOperation`, `sanitizeSql`, `propagation`, `context`, `getResolvedConfig`, `getTelemetryConfig`, `getMeterProvider`, `getDbOperationDuration`, `getDbOperationErrors`, `getDbOperationTotal`, `getEventbusEmitsTotal`, `getEventbusErrorsTotal`, `getHttpClientRequestDuration`, `getHttpClientRequestErrors`, `getHttpClientRequestTotal`, `getHttpServerRequestDuration`, `getHttpServerRequestErrors`, `getHttpServerRequestTotal`, `getQueueJobCompletedTotal`, `getQueueJobEnqueuedTotal`, `getQueueJobFailedTotal`, `getQueueJobProcessingDuration`, `getSchedulerJobDuration`, `getSchedulerJobExecutedTotal`, `getSchedulerJobFailedTotal`, `Span`, `SpanOptions`, `TelemetryConfig`, `Tracer` | `@gobing-ai/ts-infra` telemetry | ts-infra has similar API; minor differences in metric names |
| `AppError`, `ConflictError`, `InternalError`, `isAppError`, `NotFoundError`, `ValidationError`, `ErrorCode` | `@gobing-ai/ts-utils` errors | ts-utils has AppError + isAppError |
| `buildCursorMeta`, `createCursor`, `decodeAndParseCursor`, `decodeCursor`, `encodeCursor`, `encodeCursorFromItem`, `parseCursor`, `CursorData` | `@gobing-ai/ts-utils` cursor | Same cursor pattern |
| `fromMs`, `nowMs`, `toMs` | `@gobing-ai/ts-utils` date | Same |
| `getValidatedOrigin`, `isAllowedOrigin`, `matchOriginPattern` | `@gobing-ai/ts-utils` origin | Same |
| `getRoles`, `hasRole` | `@gobing-ai/ts-utils` access | Same Zitadel + generic RBAC |
| `Config`, `buildConfigFromObject`, `configSchema`, `getDatabaseUrl`, `ConfigLoadError` | `@gobing-ai/ts-runtime` config | ts-runtime has Config, configSchema, buildConfigFromObject |
| `RuntimeContext`, `RuntimeFactory`, `RuntimeCapabilities`, `RuntimeScope`, `RuntimeServiceMap`, `RuntimeContextOptions`, `FileSystem`, `createRuntimeContext`, `loadRuntimeFactory`, `LoadConfigOptions`, `_resetRuntimeFactory` | `@gobing-ai/ts-runtime` context + fs + types | Same runtime abstraction |
| `getEnvVar`, `getNodeEnv`, `isTestEnv` | Inline (trivial) or ts-utils | 1-2 line functions |

#### Absorb into ts-libs / Current Gaps

> Current-state rule: rows marked **already present** are consumed from ts-libs and old Spur code is discarded. Rows marked **NET-NEW** are future ts-libs work or temporary local `spur-new` code.

| Export | Target Package | Rationale |
|--------|---------------|-----------|
| `readJsonFile`, `writeJsonFile`, `atomicWriteFile`, `atomicWriteJson` | Already present in `@gobing-ai/ts-runtime` | Use ts-runtime implementation; no net-new work. |
| `walkDir` | Already present in `@gobing-ai/ts-runtime` | Use ts-runtime implementation; no net-new work. `WalkDirOptions` is not currently needed. |
| `resolveProjectPath`, `getProjectRoot` | Already present in `@gobing-ai/ts-runtime` | Use ts-runtime implementation; no net-new work. |
| `ensureDirForFile`, `getFs`, `setFileSystem`, `createLogStream` | Already present in `@gobing-ai/ts-runtime` | Use ts-runtime implementation; no net-new work. |
| `buildSourceLayers`, `parseYamlString`, `readYamlFile`, `resolveSourcePath`, `validateWithZod`, `SourceLayer`, `SourceLayerOptions`, `isExistingDirectory`, `isExistingFile`, `LoaderError` | `@gobing-ai/ts-utils` (new `yaml-loader` module) OR `@gobing-ai/ts-runtime` | YAML loading with Zod validation is generic; source-layer concept is spur-domain but the loader primitives are reusable |
| `DBJobQueue`, `DBQueueConsumer` implementations | `@gobing-ai/ts-infra` or local `spur-new` | **NET-NEW:** ts-infra exposes only interfaces. Implement as a separate gated ts-libs task, or inline in `spur-new` if the CLI needs DB-backed queues before that task. |

#### Migrate to spur-new (spur-domain, not reusable)

| Export | Destination | Rationale |
|--------|-------------|-----------|
| `ArtifactDao` | `apps/cli/src/db/artifact-dao.ts` or new `packages/core-dao/` | Spur domain entity |
| `AssetRefDao` | `apps/cli/src/db/asset-ref-dao.ts` | Spur domain — asset reference tracking |
| `ConstraintFindingDao` | `apps/cli/src/db/constraint-finding-dao.ts` | Depends on `ConstraintFinding` type (will be in ts-rule-engine). DAO is spur-domain wiring. |
| `GateResultDao`, `GateResultRecord` | `apps/cli/src/db/gate-result-dao.ts` | Workflow gate evaluation persistence |
| `PhaseRunDao`, `PhaseRunRecord` | `apps/cli/src/db/phase-run-dao.ts` | Workflow phase tracking |
| `RunDao`, `RunRecord`, `CreateRunInput`, `RunStatusCallback` | `apps/cli/src/db/run-dao.ts` | Workflow run persistence |
| `RunEventDao` | `apps/cli/src/db/run-event-dao.ts` | Workflow event log |
| `TransitionRunDao`, `TransitionRunRecord`, `CreateTransitionRunInput` | `apps/cli/src/db/transition-run-dao.ts` | Workflow transition tracking |
| `WorkflowStateDao`, `WorkflowStateRecord` | `apps/cli/src/db/workflow-state-dao.ts` | Workflow state persistence |
| `WorkspaceDao`, `WorkspaceRecord`, `AddWorkspaceInput` | `apps/cli/src/db/workspace-dao.ts` | Spur workspace registry |
| `attachDefaultObservers`, `attachFileObserver`, `attachLogObserver`, `attachMetricsObserver`, `attachTelemetryObserver` | `apps/cli/src/observers/` or `apps/server/src/observers/` | EventBus lifecycle wiring — spur-domain convenience |
| `ActionRegistry`, `createDefaultRegistry`, `HealthPingAction`, `LogAction`, `QueueStatsAction`, `QueueStatsDaoProvider`, `CreateDefaultRegistryOptions`, `SchedulerOptions`, `SchedulerAction` | `apps/cli/src/scheduler/` or `apps/server/src/scheduler/` | Scheduler action wiring — spur-domain |
| `LOG_CATEGORY_APP`, `LOG_CATEGORY_CLI`, `LOG_FILE_PATH` | `packages/config/src/const.ts` in spur-new | Spur-specific logging constants |

#### Discard (not needed)

| Export | Reason |
|--------|--------|
| `BusLifecycleEvents`, `EmitDoneDetail`, `HandlerErrorDetail`, `AsyncEnqueuedDetail` | Replaced by ts-infra EventBus; these are internal detail types |
| `_resetMetrics`, `_resetTelemetry` | Test-only resets; ts-infra may have equivalents or they're not needed |

### @spur/tooling (~20 exports)

#### Absorb into ts-libs (ts-utils) — ⚠️ NET-NEW ts-utils modules (C2)

> None of these target modules (`collections`, `path`, `yaml`, `redaction`) exist in ts-utils today. Same rule as above: inline into spur-new for the refactor; absorb into ts-utils as a separate, gated ts-libs task. **The redaction primitives are needed by 0160 (importer pipeline) — those must land somewhere concrete before 0160, either inlined in the importer package or implemented in ts-utils first.**

| Export | Rationale |
|--------|-----------|
| `dedupeBy`, `mergeRecordLastWins`, `sortUnique` | Generic collection helpers → new `@gobing-ai/ts-utils` collections module (net-new) |
| `globToRegExp`, `matchesGlob`, `matchesSimpleGlob`, `normalizePath`, `findClosestAncestor` | Path/glob primitives → new `@gobing-ai/ts-utils` path module (net-new) |
| `isYamlFileName`, `yamlStem` | YAML file detection → new `@gobing-ai/ts-utils` path module (net-new) |
| `parseYamlDocument`, `parseYamlWithSchema`, `YamlParseContext` | YAML parsing with Zod validation → new `@gobing-ai/ts-utils` yaml module (net-new) |
| `redact`, `redactWithRules`, `RedactionRuleInput` | Redaction primitives → new `@gobing-ai/ts-utils` redaction module (net-new; **blocks 0160 — resolve placement first**) |

#### Migrate to spur-new

| Export | Destination | Rationale |
|--------|-------------|-----------|
| `PackageManifest`, `assertNoWorkspaceDependency`, `readPackageJson` | `packages/tooling/` in spur-new (keep as small local util) | Package boundary enforcement; spur-specific linting rules |

#### Discard

| Export | Reason |
|--------|--------|
| `TOOLING_VERSION` | Placeholder constant; not needed |

### @spur/kernel (~80 exports)

#### New → ts-libs (new standalone packages)

| Subdirectory | New Package | Task | Notes |
|-------------|-------------|------|-------|
| `ai-runner/` (15 exports) | `@gobing-ai/ts-ai-runner` | 0158 | Clean redesign — SourceDefinition pattern for agent shims |
| `rules/` (60+ exports) | `@gobing-ai/ts-rule-engine` | 0158 | ConstraintRule, Finding, Fix types move INTO this package |
| `workflow/` (25+ exports) | `@gobing-ai/ts-dual-workflow-engine` | 0162 | Clean redesign — dual-mode FSM + DAG engine |
| `gates/` (7 exports) | `@gobing-ai/ts-rule-engine` | 0158 | Gates evaluate rule-like conditions; belong in rule-engine |
| `agent/` (4 exports) | `@gobing-ai/ts-ai-runner` | 0158 | High-level agent service wraps AiRunner |

#### Migrate to spur-new

| Export | Destination | Rationale |
|--------|-------------|-----------|
| `config/profile.ts` — loadProfile, NormalizedProfile | With ts-rule-engine (config module) | Profile loading is rule-engine domain |
| `config/interpolation.ts` — env var interpolation | `@gobing-ai/ts-utils` or ts-runtime | Generic env interpolation is reusable |
| `persistence/` — DAO implementations | spur-new `apps/cli/src/db/` | Persistence adapters — spur-domain wiring |

#### Discard

| Export | Reason |
|--------|--------|
| `_coverageAnchorRuleService1` through `_coverageAnchorRuleService5` | Test coverage anchors; not needed |
| `KERNEL_VERSION` | Placeholder constant |

### @spur/contracts (~50 exports)

#### Distribute to ts-libs packages

| Export | Moves To | Rationale |
|--------|----------|-----------|
| `ConstraintRule`, `ConstraintRuleFile`, `ConstraintFinding`, `Fix`, `FixMode`, `Severity`, `NormalizedRuleSet` + schemas | `@gobing-ai/ts-rule-engine` | Core rule types — belong with their domain package |
| `ProfileConfig`, `PresetDefinition`, `ExtensionConfig` + schemas | `@gobing-ai/ts-rule-engine` | Profile/preset config types |
| `WorkflowDef`, `ActionDef`, `Vars`, `Env` + schemas | `@gobing-ai/ts-dual-workflow-engine` | Workflow definition types |
| `EtlBlock`, `EtlRow`, `EtlTrait` | Discard | Old ETL trait pattern — replaced by ts-data-pipeline (0157) |
| `RedactionRule`, `RedactionRulePack` + schemas | `@gobing-ai/ts-utils` (redaction module) | Generic redaction types |

#### Migrate to spur-new contracts

| Export | Destination | Rationale |
|--------|-------------|-----------|
| `HealthResponse`, `ErrorCode`, `errorCodeToHttpStatus`, `ApiResponse`, `ApiError` | `packages/contracts/src/` | API transport contracts |
| `CursorPaginationSchema`, `IdParamSchema`, `PaginationSchema` | `packages/contracts/src/pagination.ts` | Pagination contracts |
| `Workspace`, `Run`, `PhaseRun`, `RunEvent`, `WorkflowState`, `GateResult`, `Artifact`, `AssetRef` + schemas | `packages/contracts/src/domain.ts` | Spur domain entity schemas |
| `SpurEvent`, `SpurEventPayloadMap` + payload types | `packages/contracts/src/events.ts` | Spur event taxonomy |
| `SPUR_ENV_VARS`, `SPUR_LOG_LEVELS` | `packages/config/src/env.ts` | Environment variable contract |
| Error classes (`DuplicateWorkspaceNameError`, `FSMError`, etc.) | Distribute: rule errors → ts-rule-engine, workflow errors → ts-dual-workflow-engine, spur errors → spur-new | Error classes belong with domain packages |

### @spur/history-ingest (~15 files, ~2.8k LOC)

#### New → ts-libs

| Scope | New Package | Task | Notes |
|-------|-------------|------|-------|
| Entire package | `@gobing-ai/ts-llm-jsonl-importer` | 0160 | COMPLETE REDESIGN. SourceDefinition + discriminated union. NOT old adapter bloat. |

#### Discard

Old 35-file adapter pattern, `history-ingest-service.ts` + `ingest-service.ts` two-level duplication — all replaced.

### @spur/history-analytics (~20 files, ~3k LOC)

#### Defer + Redesign

| Scope | New Approach | Task | Notes |
|-------|-------------|------|-------|
| Entire package | Consumer of `@gobing-ai/ts-data-pipeline` in spur-new | 0157 | Old ETL trait pattern discarded. Generic toolkit built first. Analytics rebuilt as consumer. |

### @spur/assets (~5 files, ~0.3k LOC)

#### Discard

Unclear scope. Asset inspection can be rebuilt from scratch if needed.

### @spur/workspaces (~5 files, ~0.3k LOC)

#### Discard (partial absorption)

| Export | Action | Rationale |
|--------|--------|-----------|
| `gitContext`, `GitContext` | Migrate to spur-new CLI as inline utility | Small, useful, spur-domain |
| Workspace registry + everything else | Discard | Unclear scope; rebuild from scratch with WorkspaceDao |

### @spur/api-types (~2 files, ~0.1k LOC)

#### Discard

Re-exports `@spur/server` AppType. Replaced by oRPC client types generated from contracts.

### @spur/profiles — NOTE: no standalone package (M2)

There is no `packages/profiles/` in old spur. Profile config code lives in `packages/kernel/src/config/profile.ts`. It is classified under @spur/kernel below (→ ts-rule-engine config module). This heading is retained only to flag that earlier plan references to a `@spur/profiles` package / `packages/profiles/` delete step (0155 §2e.7) are no-ops.

---

## Summary Statistics

| Bucket | Count |
|--------|-------|
| Discard (ts-libs duplicate) | ~100 exports (@spur/core) |
| Absorb → ts-libs | ~20 exports (@spur/tooling → ts-utils/ts-runtime) |
| New → ts-libs | 5 packages (ai-runner, rule-engine, workflow-engine, jsonl-importer, data-pipeline) |
| Migrate → spur-new | ~40 exports (DAOs, contracts, events, scheduler wiring) |
| Discard (dead/bloat) | ~30 exports (adapter bloat, coverage anchors, version constants) |
| Defer | 2 packages (history-analytics redesign, assets maybe never) |

### Key Architectural Decisions

1. **ConstraintRule et al. move INTO ts-rule-engine**, not a separate contracts package. Types belong with their domain.
2. **Spur-new `packages/contracts/` is transport DTOs only** — API envelopes, health check, pagination. No domain types.
3. **No `@spur/core` in new codebase.** Everything is ts-libs or local spur-new.
4. **`@spur/kernel` ceases to exist.** Distributed: ai-runner → ts-ai-runner, rules → ts-rule-engine, workflow → ts-dual-workflow-engine, gates → ts-rule-engine.
5. **Old history-ingest + history-analytics are reference-only.** Complete redesigns.

## Required ts-libs Additions / Local Inline Decisions

| Gap | Default Decision | Follow-up |
| --- | --- | --- |
| Generic source-layer YAML loader primitives: `buildSourceLayers`, `readYamlFile`, `validateWithZod`, source descriptors | Inline locally in `spur-new` until a reusable shape is proven | Consider ts-runtime/ts-utils enhancement only after 0158/0162 config loaders settle. |
| `DBJobQueue` / `DBQueueConsumer` implementations | Inline in `spur-new` only if CLI/server need DB-backed queue before ts-infra catches up | Separate ts-infra task if reused outside Spur. |
| ts-utils collections/path/yaml/redaction modules | Redaction must be resolved before 0160; other helpers can inline locally | Create explicit ts-utils task(s), or keep in importer/rule-engine packages if not broadly reusable. |

## Follow-up Task Mapping

| Follow-up | Uses This Classification For |
| --- | --- |
| 0157 | Extract `ts-data-pipeline`, rebuild analytics as a consumer, and remove old ETL trait assumptions. |
| 0158 | Extract `ts-ai-runner` and `ts-rule-engine`, including rule/gate contracts. |
| 0159 | Port server/web app contracts and oRPC seam into `spur-new`. |
| 0160 | Extract `ts-llm-jsonl-importer`; decide redaction placement before importer gate. |
| 0161 | Port CLI and local Spur-domain persistence/wiring into `spur-new`. |
| 0162 | Extract `ts-dual-workflow-engine`. |

## Verification Notes

- Old Spur baseline gate passed before this document was written.
- `spur-new` scaffold gate passed after this document was written.
- This document intentionally lives at `docs/refactor/CLASSIFICATION.md` to avoid collisions with copied `docs/00_ADR.md` and `docs/01-06`.
