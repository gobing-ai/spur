---
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants
authority: derived
version: 1.36.0
derived_from: [01_PRD, 00_ADR]
owner: Robin Min
updated_at: 2026-08-29
read_before: cross-module, seam, or schema work
edit_rules: 99 §6.4
sync: [T1]
---

# 03 Architecture — Spur

This document describes the **current** architecture of Spur. It specifies module boundaries
and invariants, not schemas or signatures (those live in code).

## 1. Topology

Bun-workspace monorepo (no Turborepo, ADR-002). Spur owns three apps and four local packages
(ADR-001 as amended); all reusable engines are external `@gobing-ai/ts-*` packages (ADR-006).

spur/
├── apps/
│   ├── cli/         Primary surface — commander dispatch (ADR-014) + transport-wrapper commands
│   ├── server/      Hono + oRPC OpenAPI handler; Bun + Cloudflare Worker entrypoints
│   └── web/         Astro + Cloudflare adapter; typed oRPC OpenAPI client
├── packages/
│   ├── app/         Application services — Agent/History/Plugin/Rule/Team/Workflow (ADR-021)
│   ├── contracts/   oRPC transport contracts ONLY (health/DTOs) — @gobing-ai/spur-contracts
│   ├── config/      Config SSOT — merged schema + the single `.spur/config.yaml` loader; core/loader split (ADR-027)
│   ├── domain/      DAOs + schema + analytics + migrations; sole ts-db importer (ADR-011)
├── plugins/sp/      Agent-facing layer: Fat Skills + thin command/subagent wrappers (ADR-016/023)
├── config/          Spur-owned default config SSOT — rules/, workflows/, plugins/ (ADR-015)
├── tooling/typescript/   Shared tsconfig presets (base/server/react)
└── drizzle/         0000_spur_cli_foundation.sql + incremental _spur_cli_ migrations +_legacy_reference/ (inert)

### 1.1 External dependency boundary (ADR-004/006/021)

Per-app edges as they exist today (manifest-verified):

```
apps/cli ────► packages/{app, config, domain}
               + @gobing-ai/ts-{utils, infra, runtime, ai-runner,        (semver)
                                rule-engine, dual-workflow-engine, llm-jsonl-importer}
apps/server ─► packages/{config, contracts} + @gobing-ai/ts-{infra, runtime}
               (+ packages/app — never direct DB — per ADR-021.b)
apps/web ────► packages/contracts (types via oRPC client only)
packages/app ───► packages/domain + the engine packages
packages/domain ► @gobing-ai/ts-db (sole importer — §8.1)
```

| Layer | Owns |
| ------- | ------ |
| `ts-utils` | output, errors, api-response, cursor, date, access |
| `ts-infra` | logger, EventBus, telemetry, scheduler, job-queue interfaces |
| `ts-runtime` | runtime context, FileSystem, ProcessExecutor, config loader |
| `ts-db` | DbAdapter, BaseDao, migrations, QueueJobDao |
| `ts-ai-runner` | `AgentDetector`, `DoctorRunner`, `AiRunner` |
| `ts-rule-engine` | `RuleEngine`, evaluators, presets, formatters, rule types |
| `ts-dual-workflow-engine` | FSM + transition-flow drivers, persistence, schema SQL |
| `ts-llm-jsonl-importer` | `runJsonlImport`, `SourceDefinition`, schema SQL |

**Hard constraints (enforceable as rules):**

1. No `@spur/*` imports — that scope does not exist here.
2. `packages/contracts` holds transport DTOs only; domain types live in their owning ts-libs package.
3. `apps/web` imports contract **types** via oRPC client — never server internals.
4. CLI commands are transport wrappers over package APIs — no domain logic reimplemented inline.
5. Cross-workspace imports use `@gobing-ai/*` aliases, never deep relative paths.
6. `.spur/config.yaml` is loaded only through `@gobing-ai/spur-config` — no surface parses or
   schema-validates the config itself (§1.2, ADR-027).

### 1.2 Config-loading boundary (ADR-027)

`.spur/config.yaml` has one loader, in `@gobing-ai/spur-config`. The package splits into a
dependency-free **core** (`.`: merged `spurConfigSchema`, `DEFAULT_*` constants, config types) and a
node-only **`./loader`** (`loadSpurConfig`, `resolveConfigFile`, `resolvePlanningFolders`,
embedded-schema resolution). The split exists because importing `yaml`/`node:fs` into the Cloudflare
Workers bundle crashes miniflare — so the server imports only the core; CLI and `packages/app` (on
Bun) import the loader.

This replaced five parallel paths that had diverged before ADR-027: the CLI's structured-config
loader, the app's raw-`yaml` `resolvePlanningFolders`, a CLI `resolveConfigFile`, the server's inline
folder literals, and the server's legacy `docs/.tasks/config.jsonc` read. All consumers now derive
the typed result from the single facade; config-shape types (`TaskFoldersConfig`) have one owner.
Enforced by `config/rules/boundary/config-loading-ownership.yaml`.

### 1.2.1 Composition-root merged-config wiring (built — ADR-082)

The merged `loadSpurConfig` result is loaded **once per process at the composition root** — CLI
`main()`, server startup — and threaded through the dispatch/service context as the only
app-config source. ts-infra's `runNodeApplication` keeps only the project-shaped `bootstrap`
section (`configFile` + `bootstrapSection`; no `appConfig` validator, `appRt.appConfig` unread).
Per-slice loads in `packages/app` services (workflow-service ×4, team-service) and CLI call sites
(history-refresh, workflow.ts) are replaced by the threaded object; services degrade to current
defaults when the threaded config is absent/null.

Invariants (enforceable):

1. `loadSpurConfig` is imported only by `packages/config/**`, the two composition roots
   (`apps/cli/src/index.ts`, `apps/server/src/{serve,context}.ts`), and tests — enforced by the
   extended `config/rules/boundary/config-loading-ownership.yaml`.
2. A config value defined only in the global layer reaches every CLI command; a project-layer
   value wins the same key (1.2 merge semantics, unchanged).
3. Config-load failure aborts dispatch once, at the root, with one `--json` error envelope naming
   the failing layer — never one error per consumer.
4. Role resolution against the byte-identical `DEFAULT_AGENT_ROLES` fallback (ADR-078) carries
   explicit provenance (`config` | `fallback`); `spur agent doctor` reports an active fallback.

Shapes: `docs/design/universal-config-loading.md`.

## 2. Runtime Model

Phase 1 is single-process: the CLI owns the work and is the writer of record (ADR-010).

```mermaid
flowchart TD
    User([User]) -->|spur <command>| CLI
    subgraph Process["apps/cli (Bun)"]
        CLI[commander dispatch] --> Ctx[CliContext<br/>config · fs · lazy migrated DB]
        CLI --> APP[packages/app services<br/>Agent · History · Rule · Team · Workflow]
        APP --> AR[ts-ai-runner]
        APP --> RE[ts-rule-engine]
        APP --> WF[ts-dual-workflow-engine]
        APP --> HI[ts-llm-jsonl-importer]
        APP --> DOM[packages/domain<br/>DAOs · analytics · migrations]
        DOM --> DB[(SQLite via ts-db)]
        RE -. persistence adapter .-> DB
        WF -. persistence adapter .-> DB
        HI --> DB
        AR -->|subprocess| Agent[[Coding agent CLI]]
    end
    JSONL[(Agent JSONL files)] -.read.-> HI
```

The CLI never calls an engine around the service layer (ADR-021); engines reach SQLite only
through persistence adapters constructed from `packages/domain`.

The server/web tier is a local-first planning and operations board. Its bootstrap splits by runtime
(ADR-019, amended by ADR-036):

- **Bun entry (`index.ts`)** → `runNodeApplication` (`@gobing-ai/ts-infra/application-node`):
  YAML config loading, file log sink, owned DB adapter, full module registry, and local static assets.
- **Worker entry (`worker.ts`)** → portable `runApplication` (`@gobing-ai/ts-infra/application`):
  lazy singleton plus `createWorkerApp`; health/OpenAPI routes and static-asset fallback only.

`src/server-config.ts` is shared and runtime-agnostic. `src/bootstrap.ts` is the Bun composition
root; `src/worker-app.ts` is the Worker-safe HTTP root. The Worker graph must not import
`node:*`, `bun:*`, local filesystem, SQLite, scheduler, queue, or process-control implementations.

## 3. CLI Architecture (`apps/cli`)

No file inventory here — that rots (99 §6.4 lesson); boundaries only:

- **Dispatch:** one commander `Command`; each noun registers via
  `registerXxxCommand(program, context)` (ADR-014). Commander owns parsing, subcommand dispatch,
  and `--help` rendering.
- **Commands** parse flags, call a `packages/app` service, format output, return an exit code —
  no business logic in the app (ADR-021).
- **CliContext** carries cwd/env/fs/output/`setExitCode` and lazily builds + migrates the SQLite
  adapter on first DB access.
- **DAOs, migrations, analytics** live in `packages/domain` (`dao/`, `migrations.ts` composing
  domain + engine schema SQL, `analytics/`). DAOs use the adapter's prepared-statement API.

## 4. Type Seam — oRPC (ADR-005)

```
packages/contracts (oc.route + Zod)
   ├─► apps/server/router.ts   implement(contract).handler(...)   ← compile-time bound
   ├─► apps/server/openapi.ts  OpenAPIGenerator(contract)         ← spec derived, not hand-written
   └─► apps/web/rpc-client.ts  OpenAPILink(contract)              ← typed client
```

Contract↔handler drift is a compile error. OpenAPI is generated, never hand-maintained. Domain types
never enter `packages/contracts`.

## 5. Constraint Rules (`ts-rule-engine`, `spur rule`)

A constraint rule declares an id, severity, target paths, an evaluator, options, and a message.
`RuleEngine.evaluate(rules, cwd)` returns findings; `RuleService` (packages/app) mediates; the
CLI owns exit-code policy. Presets compose via `loadPresetRules`; ad-hoc files via `loadRuleFile`;
formatters are host-registered. Runs persist through the engine's `RulePersistenceAdapter`
(Spur's `DbRulePersistenceAdapter` over ts-db), powering `spur rule trace`. Rules are
configuration — adding one edits YAML, not code. Flags and surface: `04 §1.1`.

## 6. Workflows (`ts-dual-workflow-engine`, `spur workflow`)

Two execution models behind one host (ADR-009):

- **State-machine** — states, transitions, guards; a single readable driver loop for linear/looping
  workflows. Terminal states partition into success/failure via an optional `failureStates` subset of
  `terminalStates` (ADR-044): the driver finalizes a failure terminal via `lifecycle.fail()`, so the
  run's status, persisted row, `workflow.run.failed` event, and CLI exit code all agree; absent
  `failureStates`, every terminal finalizes as `done` (backward compatible).
- **Transition-flow** — DAG with conditional branching for multi-phase pipelines.

Definitions are YAML (Zod-validated, variable interpolation). Persistence is via a SQLite adapter
(`DbWorkflowPersistenceAdapter`) over ts-db; in-memory for tests. `WorkflowService` (packages/app)
wires the host + persistence and exposes validate/run/list; persisted runs power
`spur workflow trace`. After load, `validate` / `run` (incl. `--dry-run`) / `continue` register
YAML-declared `extensions.actions` / `extensions.guards` onto that host (0533/D4) — relative to
the workflow file, fail-closed, no absolute or `..` paths. The planning layer's task/feature
lifecycles run as workflow definitions on this engine (§12.2) — its first long-lived,
externally-triggered consumer (ADR-022).

### 6.1 Consolidated per-run run log (built — ADR-045 / feature D2)

A single all-in-one per-run log at `.spur/run/<RUNID>.log` makes every `spur workflow run`
observable from creation to terminal status. The consolidated sink is a **read-only subscriber**
on the existing `WorkflowObservabilityBus` (which ADR-035 keeps a read-only projection) that appends
the already-redacted, already-bounded event stream to the log file. It subsumes the former
`RunOutputSink` (now `workflow-run-log-sink.ts`) — the same `observe`/`close` contract, byte/line
bounds (default 1 MiB / unbounded,
configurable), visible truncation marker, and best-effort-writes-never-fail-the-run semantics — but
emits a richer event set: the run's foreground rendering (plan preview, per-step progress,
transitions, final summary), child agent stdout/stderr chunks, consumed stdin (steering), and engine
shell/HITL action lifecycle lines. Because the sink writes in-process to a file, the `--async`
detached worker (which points its own std streams at `/dev/null`) still produces the log.

Invariants (enforceable):

1. No prompt body or shell command text ever enters the log; prompt bodies become `[prompt N chars]`,
   shell commands `[shell command redacted]`, configured secrets `[REDACTED]` — the consolidated log
   is not a redaction leak.
2. The log never exceeds its configured byte/line bound; hitting a bound appends a visible truncation
   marker, never a silent cut.
3. An unwritable `.spur/run/` dir or failing disk degrades the log, never the run.
4. `spur workflow clean` reclaims retained logs older than `workflow.logRetentionDays` (default 30);
   the log is retained by default and removed only by that policy.

`spur workflow trace <RUNID> --follow --output` streams `.spur/run/<RUNID>.log` (tail -f equivalent)
as a distinct source, exiting at terminal status; the structured DB timeline remains the default and
`--output` does not interleave with it. Removed-and-repointed surfaces are compatibility changes:
`<RUNID>-output.log` folds into `<RUNID>.log`, and the timed-out-implement runbook tails the new path;
the `.spur/runs/workflow/<RUNID>.jsonl` trace-file and `<RUNID>-STEP-partial.md` salvage stay distinct
authorities. Surface shapes: `docs/design/workflow-run-log.md`; decision: `00 ADR-045`; feature `D2`.

### 6.2 Resume and guard vars contract

This is the exact contract agents rely on when resuming a paused workflow or authoring guard
commands — it is documented in-repo so no one has to reverse-engineer the engine (`node_modules`).
Source of truth: `@gobing-ai/ts-dual-workflow-engine` `WorkflowService.resumeRun` /
`evaluateAndCommit`, and spur's `EnvShellGuardRunner` (`packages/app/src/workflow/guards/shell.ts`).

**`resumeRun` vars merge (caller wins).** When a paused run is resumed
(`spur workflow continue <run-id>` / `WorkflowService.resumeRun`):

1. The run must be `paused`; it is re-opened as `running`, and execution starts from the persisted
   current state **skipping that state's on-enter**.
2. The runtime vars are restored from the `effectiveVars` snapshot persisted in the last state
   snapshot (e.g. `__hitlAnswer`, `profile`), so a resume continues with the same runtime variables.
3. Caller-supplied `options.vars` are **merged over** that persisted snapshot — **caller wins** on a
   key collision (`mergeVars(persistedVars, options.vars)`). Inject a resumed answer by passing it in
   `vars`, not by mutating the snapshot.

**Shell-guard vars resolution (two layers).** A guard command may reference workflow vars either way:

1. **Template resolution (engine).** `${vars.*}` templates in guard options (e.g.
   `spur task check ${vars.wbs}`) are resolved against `workflow.vars` _before_ the guard runs
   (`resolveTemplates`), the same interpolation the driver's `firstPassingTransition` uses.
2. **Subprocess env export (spur).** Spur's `EnvShellGuardRunner` replaces the engine's default shell
   guard and spawns `/bin/sh -c <command>` with `context.vars` merged over `process.env` as the child
   env — so a guard can also reference vars by bare name (`$wbs`, `$spurBin`). Because the value is
   passed as environment data, a variable-expansion result is **never re-parsed as shell code** (no
   backtick/`$(...)` injection — task 0435/0432). The lifecycle adapter binds the run's guard var
   (e.g. `wbs`) and `spurBin` into `workflow.vars` before requesting a transition, which is why
   `task-lifecycle.yaml` guards can run `$spurBin task check $wbs`.

Guard evaluation is fail-closed: a non-zero shell exit denies the transition atomically with zero
partial writes (see `LifecycleAdapter.requestTransition` in §12.2).

### 6.3 Interactive task-pipeline control inversion (ADR-047 amendment)

Interactive `dev-run --mode full` and sequential `dev-runall` invocations execute at the
agent-command layer, which already owns the live host session. The driver reads
`task-pipeline.yaml` at invocation time and interprets the same ordered actions and transition
guards; it does not add an engine inline mode or define a second FSM. Explicit executors, parallel
batches, and headless `spur workflow run` continue through `WorkflowService` and `agent.run`.

**Native-subagent-first model stages (task 0508, amended by feature G5).** Interactive
omitted-`--agent` keeps the controller in the host session and is **non-subprocess** — it never
invokes `spur agent run` or `spur workflow run` — but eligible model-bearing `agent.run` stages may
execute on a native platform subagent. Eligibility is decided by observable facts only: the action
is a pure-slash `agent.run`, the state is not interactive (no operator-confirmation action,
`pause: true`, or approve/taste/ask decision), and the host platform exposes a native subagent with
shared-worktree read/write/shell capability. **Omitted and explicit `--agent inline` resolve identically (task 0687 / ADR-087):** 0508 eligibility (native subagent first, host-session fallback) applies to all inline resolutions, and headless surfaces (`spur agent run`, workflow `agent.run`, serve-side dispatch) substitute tier resolution with a single warning instead of rejecting. Dispatch
happens **once**, sequentially (one writer at a time), and joins before the driver evaluates the
next action or guard; a pre-dispatch eligibility failure falls back to one host execution, while a
failure after dispatch follows the stage's error policy and is never replayed in the host. Operator
confirmation actions, `pause: true`, and approve/taste/ask decisions remain host-owned — no subagent
answers or continues them. The dispatched stage cannot recursively dispatch the same stage.

The inline path records `task_run_links` provenance before entering the FSM and appends each model
stage's state id plus host session id to a run-scoped log — for subagent-executed stages the log
names the subagent id (`stage <id> executed via subagent <agent-id> (host session <session-id>)`),
distinct from the inline provenance. It has no independent stage timeout/abort
boundary or subprocess action record. Invariants: YAML remains the sole state/guard authority; every
lifecycle guard still executes; inline failure never silently redirects to `agent.default`.

## 7. History Import & Analytics (`ts-llm-jsonl-importer`, `spur history`)

Pipeline (ADR-008), one generic control function over a `SourceDefinition` union:

```
discover files → resume from (source, source_file) checkpoint → read line-by-line
  → split (one-to-one | one-to-many | custom) → fieldMap (raw→canonical)
  → transforms → Zod validate (gate before persist) → redact → SHA-256 dedup
  → load to per-source ETL table → update checkpoint
```

Sources: pi, claude, codex, gemini, opencode, antigravity, openclaw, omp, grok, agy. Adding a source
is one `SourceDefinition` variant; the pipeline never changes. `--source all` fans out with
per-source failure isolation (E1/0470); ad-hoc `--file <path>` imports a single session (E1/0470).

**Forensic ETL contract** (E1/0466, 0468): the importer normalizes records into a machine-readable
output with `MAX_ERROR_SAMPLES` cap, `importOneIsolated` per-source isolation, `schemaVersion`
tagging, and `assertArtifactVersion` gating — the artifact is a versioned contract, not ad-hoc JSON.

**Full-mode reconciliation** (0504/0505): `--mode full` revalidates the ETL against canonical raw
files — the importer deletes stale target/ledger/checkpoint rows and returns per-source
`{ staleTargetRows, staleLedgerRows, staleCheckpointRows }`, which `importOneIsolated` passes
through `CoverageEntry` to `entries[].reconciliation` in `--json` output (optional, absent on
incremental runs). Sources that skipped malformed records are `degraded`, never clean `ok` —
shapes in `04 §1`.

**Analyze → Report** (E1/0474, 0469): `spur history analyze` aggregates the ETL tables in SQL
(`packages/domain/src/analytics/forensic-query.ts`) and writes a versioned JSON artifact
(`schemaVersion` field). `spur history report` is a pure renderer — it reads the artifact, asserts
the schema version, and renders to stdout + markdown sidecar without opening the database.
Unavailable values render as `n/a`, never `0` (never-fabricate).

**Daily pipeline** (E1/0470, 0471): `spur history daily` is a single run-once invocation:
import-all → analyze → write artifact → prune reports older than 90 days. Scheduling is via an
external launchd plist (`com.gobing-ai.spur.history.daily.plist`), not an embedded scheduler. The
history system emits `history.*` events to the event ledger for observability.

**Completion-triggered refresh** (E3/0549): a second trigger bound to **work completing**
(`history.refresh.on_completion`, opt-in config, default off) enqueues one coalesced `history.refresh`
job on the feature-A2 embedded job queue at task-done and pipeline-run completion — never inline on
the firing operation. `enqueueCoalesced` (`packages/domain/src/db.ts`) makes the lookup-then-insert
atomic under cross-process concurrency via a **partial unique index** on `queue_jobs`
(`queue_jobs_history_refresh_pending_unique`, scoped to `type='history.refresh' AND status='pending'`
so other job types keep multiple pending rows); a burst inside `debounce_ms` joins the pending job
(earliest `windowStart`, latest `windowEnd`) instead of enqueuing a duplicate. Consumption is
server-side: `spur serve`'s job worker runs the job body, which reuses `HistoryService.daily`'s
import-all fan-out with per-source isolation. Coalescing shapes in `04 §3`.

**Watermark policy** (E3/0550): `analyze` bounds derived values to a still-appending session's **last
complete turn** (`packages/domain/src/analytics/watermark.ts`), so a half-written session never
contributes a partial turn's derived values; each `bySession[]` row carries additive
`sessionState: 'in-progress' | 'complete'`. The daily result reports honest coverage
(`RefreshCoverage { refreshed, skipped, window }`): full-fidelity sources refreshed, unsupported
sources skipped (operator ruling 2026-08-06), and the MIN/MAX message `ts` analyzed.

**Analytics** (`packages/domain/src/analytics`) is a domain consumer, not part of the generic
importer. The analyze rollup estimates per-model cost for the artifact from `history_message` /
`history_tool_call` (ADR-049). The workflow-trace cost path (ADR-060) joins the run→session
mapping to `history_message`'s typed token columns — exact and estimated figures folded apart,
never priced; the ETL `CostRecord` read path is retired on the read side.

**History-anatomy diagnostic (HA-S1, ADR-079/080; 0657–0661).** `analyze` records an additive
`population` block (`SelectionPopulation` — sessions, tools, loops, warnings, `appliedTop`) from
unbounded `COUNT(DISTINCT …)` queries over the active selector, never from bounded leaderboard
lengths; the forensics renderer presents bounded lists as `top N of M` (ADR-080). Diagnostic
interpretation lives in the plugin space, not the CLI: `sp:history-anatomy` owns the mode/report
contracts, `history-anatomy.yaml` owns the cache branch / bounded correction / atomic publication,
and `history-anatomy-cache.ts` (+ committed `.mjs` twin, ADR-065 standard contract) computes the
semantic artifact digest — the deterministic half always reruns, only model judgment is cacheable
(ADR-079). Shapes: `docs/design/history-anatomy.md`. I9 environment-improvement projection
(built — ADR-084/085): §22;
`docs/design/environment-improvement-lens.md`.

**History Board read plane (E8).** The six `history.*` oRPC procedures delegate through
`HistoryBoardService`; `LiveHistoryBoardService` composes the existing forensic queries and keeps
the server transport SQL-free. `HistoryService.analyze()` refreshes checkpoint-keyed SQLite read
models after producing the forensic artifact. Board reads use those models only when their recorded
history version matches the current projection version and import checkpoint; absent or stale models
fall back to the exact indexed queries. Manual Board imports enqueue the existing `history.refresh`
job, whose worker runs
`HistoryService.daily()` with the requested import mode. Shapes: `docs/design/history-board-module.md`.

**Run→session correlation (E6, ADR-059).** Every DB-backed `spur agent run` watermarks the
agent's session root before dispatch and resolves the produced session after exit
(`RunSessionObserver`, `packages/app/src/services/run-session-observer.ts`), writing an `exact`
mapping row to `history_run_session` (`observed`, or `supplied` when `--session-id` is given).
Resolution is conservative by contract: zero candidates, multiple candidates, a concurrent
same-agent overlap, or an unreadable root records `unresolved` with a NULL `session_id` — never
an exact row with a guessed session, and never a run failure. Imported history predating
observation is correlated retroactively by `(source, cwd, ts)` span against `system_events`
run windows (`RetroCorrelator`, `packages/domain/src/analytics/retro-correlation.ts`), writing
`estimated`/`inferred` rows — the DAO write path blocks shadowing an `exact` row and duplicate
`estimated` rows, so re-runs are idempotent and observation always wins. The mapping is the
provenance authority: `history_message.provenance` (`spur-run` vs `ambient`) is aligned to it
after import (`RunSessionDao.alignMessageProvenance`), replacing the cwd-substring
`detectProvenance` heuristic deleted in `@gobing-ai/ts-llm-jsonl-importer@0.4.33`. Default import
also scans run-owned session directories. When a workflow role names the directory (for example
`coder`) rather than the importer source, the run's recorded source routes discovery; imported
sessions from that directory promote its unresolved mapping to exact before provenance alignment.

**Routing attribution & token aggregates (0545–0547).** The agent invoke bridge in
`AgentService.executeRun` merges the resolution funnel's outcome — the only place that knows
role, tier, executor, and source together — into the `agent.invoke.*` event payloads;
escalations are separate `agent.invoke.escalated` records so a re-dispatch counts as its own
serve. `routingSummary` (0546) aggregates those rows in SQL over `json_extract` of the routing
envelope in one indexed round trip (composite `idx_system_events_name_occurred` + indexed
`run_id`), never by sifting a client-side window. `roleTokenSummary` (0547) joins the same
attributed rows through `history_run_session` (ADR-059) and folds `history_message`'s typed
token columns per (role, exactness) — exact and estimated kept apart, never summed, never
priced (ADR-060). Shapes: `04 §7.9`. Board render (0552): the observability server module
exposes `GET /api/observability/routing-summary`, a thin transport (ADR-021) that forwards
`since`/`until` to both domain surfaces and adds no query of its own; the Board's
`observability` Routing tab renders the pair table and per-role token totals with the
honest-state contract (unmeasured / estimated / exact / no-data-yet kept apart, never priced).

## 8. Data & Storage (ADR-007/008)

| Location | Purpose |
| ---------- | --------- |
| `.spur/` | Project config `config.yaml` (ADR-017), local rule/workflow definitions, team agent specs (`agents/`) |
| `~/.config/spur/` | Global config layer, seeded from bundled assets; resolution is bundled > global > local (ADR-015) |
| SQLite DB (`DATABASE_URL` or `.spur/spur.db`) | CLI domain tables + history ETL/ledger/checkpoint + workflow/rule run history + inbox |
| Agent JSONL files | Canonical raw history (never copied into the DB) |
| Task/feature markdown | Planning SSOT (ADR-020); the DB holds only derived data (§12.1) |
| `logs/` | Process and observer logs |

Schema is composed from package-owned SQL and applied through the `__spur_cli_migrations` journal
(`0000` foundation + incremental `_spur_cli_`-marked migrations). Tables: `workspaces`, `runs`,
`phase_runs`, `transition_runs`, `workflow_states`, `artifacts`, `history_import_ledger`,
`history_import_checkpoint`, typed `history_message` / `history_tool_call`, lazy generic
`history_etl_<source>`, `history_run_session` (E6 run→session mapping, ADR-059), `inbox_messages`,
`rule_runs`, `rule_eval_runs`, plus the workflow engine's tables. Generic ETL tables materialize
only when an accepted record targets them; schema application and empty scans create none.

### 8.1 Persistence boundary (ADR-011)

Spur consumes `@gobing-ai/ts-db` as a drizzle-free facade with a single-source-of-truth schema
model, so table/DDL/Zod drift is structurally impossible. Five rules, enforced by
`.spur/rules/boundary/dao-boundary.yaml`:

1. **`ts-db` is imported only inside `packages/domain`** — apps and the other local packages consume
   persistence through `@gobing-ai/spur-domain` DAOs, never `ts-db` or the raw adapter directly.
2. **`drizzle-orm` is confined to `packages/domain/src/schema/`** — column builders are input to
   `defineTable`; no other file (DAOs, analytics, apps) may import drizzle.
3. **Tables are defined with `defineTable`** (from `@gobing-ai/ts-db/schema`), never bare
   `sqliteTable`; each schema file exports the `DefinedTable` plus its `.table`.
4. **DDL is derived, never hand-written** — `DOMAIN_SCHEMA_SQL` composes each table's
   `createTableSql`; no raw `CREATE TABLE` for a Drizzle-backed table, no `.sql` text-imports.
5. **Raw string SQL stays inside `packages/domain`** (DAO/migration layer), never in apps.

## 9. Observability & Security

- Logging/telemetry ride `ts-infra` (logger + OpenTelemetry); telemetry is opt-in, default local-only.
- Spur never stores agent API keys — authentication is the agent's concern.
- History redaction strips secrets/PII before any persistence (redaction runs before dedup hashing).
- External content (agent output, JSONL, web) is untrusted input — validated at boundaries.

## 10. Risks & Mitigations

| Risk | Mitigation |
| ------ | ------------ |
| Contract/handler drift | `implement(contract)` makes it a compile error |
| Schema drift across engines | Each package owns its schema SQL; CLI composes (ADR-007) |
| Old migrations reactivated | Inert under `_legacy_reference/`; loader filters `_spur_cli_` marker |
| Engine MVP gaps mistaken for parity | Roadmap Phase 3 tracks the depth restore explicitly |
| History raw bloat / parse errors | Raw stays in files; only validated ETL persisted (ADR-008) |
| Lifecycle-on-workflow blocked by engine gaps (long-lived runs, pause/continue, HITL) | Stage-D ts-libs gap tasks gate the dependent waves (ADR-022); upstream-first — no local FSM fallback |
| Legacy board writes corrupt normalized task corpora during the rd3 migration | Freeze legacy `tasks server` read-only at the A17 cutover; the spur board lands in the same batch (triage doc) |

## 11. Plugin Substrate (ADR-012, amended 2026-06-09)

The lifecycle extension seam lives upstream in `@gobing-ai/ts-infra` (≥0.3.6): `Plugin`
(lifecycle-only — `onLoad`/`onStart`/`onStop`/`onUnload` + `failFast`) and `PluginHost`
(register; fail-fast load, fail-soft start/stop/unload in reverse registration order), driven
natively by `runApplication`/`runNodeApplication` via `plugins`/`pluginHost` options. ts-infra
registers its own core services (logger, telemetry, scheduler, user-callback) as built-in
plugins; Spur consumes the lifecycle and does not re-plugin-ize core services. When plugins are
registered, `startAll()` runs before command dispatch.

Deferred/removed until a real plugin consumer exists (shapes in `04 §6`):

- Spur-side SDK, manifest discovery, capability registries, and the four-tier trust ladder —
  removed with the SDK; re-addable on the ts-infra `Plugin` interface (`failFast: true` already
  covers critical-plugin abort).
- Server route seam (`apps/server/src/plugins.ts`) and the Spur `EventRegistry` — removed; the
  `PluginHost`'s raw `EventBus` is the direct event seam.
- Harness registry (Phase 5d) — blocked on upstream `AiRunner` shim injection; task 0015
  (`Blocked`).

## 12. Planning Layer (built — ADR-020–023)

The task/feature domain migrated from `cc-agents/plugins/rd3`. This section records the mechanism
and invariants the implementation must satisfy; per-item scope lives in
`docs/plans/2026-06-10-rd3-migration-feature-list.md`, concrete command/schema shapes land in
`04_DESIGN.md` as commands ship. The spec pipeline is a `plugins/sp` fat skill over these
mechanisms (ADR-020/023), not a separate CLI noun.

### 12.1 Markdown as the single source of truth

- **Tasks** live in configured folders (e.g. `docs/tasks/`), **features** in
  `docs/features/FT-<NNN>_<name>.md` — YAML frontmatter + structured markdown body, both
  Zod-validated with a `schema_version` key. Parse-validate-serialize replaces all regex
  read-modify-write.
- **The DB holds only derived data** (lifecycle events, run links, caches) — mirroring ADR-008's
  raw-stays-in-files principle. Deleting the DB loses no planning state.
- **Generated artifacts** (`kanban.md`, `docs/features/INDEX.md`) are outputs of `refresh`
  commands, never hand-edited, never inputs.
- The task/feature domain is **Spur-local** (ADR-006 division: it is Spur's own domain glue, not a
  reusable engine). The generic Gherkin-subset validator is the exception — it is upstreamed to
  ts-libs.
- **Default package home (ADR-021):** task/feature services — including the write service — join
  `packages/app`; frontmatter schemas, file I/O, and derived-data DAOs join `packages/domain`.
  Creating a new local package requires a recorded decision; no package sprawl by default.

### 12.2 Write service & lifecycle (ADR-021/022)

One write service in `packages/app` serves every transport; lifecycle transitions run through
`spur workflow`:

```
spur task/feature <verb> ──┐
                           ├──► write service (packages/app) ──► markdown file
future server routes ──────┘         │
                                     ├─► per-WBS lock + create-lock (one domain)
                                     ├─► lifecycle = spur workflow definition
                                     │     (config/workflows/*; guards = task check;
                                     │      EventBus seam for extensions)
                                     └─► transition → append `## History` + event
```

Invariants:

1. No mutation path bypasses the write service — the legacy CLI/server dual-lock race is
   structurally impossible (a consequence of ADR-021, not a policy).
2. Status lifecycles are `spur workflow` definitions (ADR-022). The frontmatter `status` is the
   single source of truth; engine persistence is derived and rehydratable from the files.
3. Engine gaps for long-lived, externally-triggered lifecycles (pause/continue, HITL) are closed
   upstream in `ts-dual-workflow-engine` — never re-implemented locally.
4. Customization attaches via the engine's EventBus pub/sub seam (`on_transition`,
   `on_guard_fail`, `on_complete`), not engine forks; SSE/board and (later) the scheduler are
   subscribers on the same seam.

### 12.3 BDD traceability chain

```
feature ## Acceptance Criteria (Gherkin / checklist)
   ▲ validated by shared BDD validator
   │
   feature-id frontmatter (single edge — the entire integration surface)
   │
task ## Acceptance Criteria (subset coverage)
   ▲ validated by `spur task check`: edge exists · AC covered · orphan warnings
```

- One shared BDD validator (Gherkin-subset parser + checklist parser + coverage check; AST aligned
  with `@cucumber/gherkin` types, no runtime dependency on it) behind `task check`, `feature
  check`, and pipeline output validation.
- Section-Status-Matrix + per-section format rules are **config** (`./config`, ADR-015 pattern),
  enforced warning-first; only the small core (AC format, Solution `file:line` citation, Review
  P1–P4 table) hard-gates. Tightening follows compliance data, not aspiration.

### 12.4 Boundaries

- `apps/cli` task/feature commands stay transport wrappers (ADR-021) over `packages/app`
  services.
- Task DTOs for any future board cross the oRPC seam via `packages/contracts` (ADR-005) — domain
  types never leak into contracts. The server/web shape itself is a separate design task
  (ADR-021 consequence b).
- `plugins/sp` centralizes agent-facing behavior in **skills** (Fat Skills — ADR-023); slash
  commands and subagents are thin wrappers of skills. Skills delegate deterministic execution to
  CLI verbs where they exist, but are not limited to CLI wrapping. The environment-improvement
  lens (built — ADR-084/085) is a plugin-level mapping projected into
  those skills' report contracts, not a third analysis skill: §22.
- Cross-cutting needs reuse the owning ts-libs package (`ts-utils` output/errors, `ts-runtime`
  FileSystem, `.spur/config.yaml` via ADR-017) — no parallel local re-implementations.

### 12.5 Lifecycle projection and corpus-gate convergence (task 0625)

Lifecycle state and its generated markdown projection converge at the application-service seam that
applies the transition. `FeatureService.syncFeature` refreshes only the touched feature's `## Tasks`
marker region after at least one lifecycle hop, including when a later hop rejects and the method
rethrows; dry runs, refused confirmations, and no-op proposals perform no refresh. The global
`INDEX.md` remains a deterministic derived view.

```text
linked task edges
  -> derive feature status
  -> try apply lifecycle hop(s)
  -> finally refresh({ featureId }) when any hop landed
  -> return applied result or rethrow the later-hop failure
  -> wrap-up runs the corpus-aware gate on applied result or non-zero sync exit
```

The per-task quality gate deliberately remains the fast `spur-check` chain. The wrap-up
`feature-transition` action reads the sync result and runs trusted project command `featureGateCmd`
(default `bun run spur-check-new`) when either `applied` is true or sync exits non-zero (a
conservative signal that an earlier hop may already have landed). The shell remains advisory: it
emits an explicit corpus-gate PASS or FAIL and exits 0 so the operator owns the recovery decision;
a complete or partial feature transition cannot leave the corpus gate unobserved.

Content checks close the remaining projection gaps at read time. `TaskCheckService` flags the
record-generated hollow Testing row and derives subject tokens from a bare Solution change-map
path before checking its cited line. `FeatureCheckService` treats a dogfood artifact as proof only
when the feature ID is a delimited filename segment. The corpus sweep covers the active task folder
and reconciles new findings single-sided against the generated snapshot (ADR-090/092). That snapshot
is the current gate-waiver exception and must migrate to ADR-093 before another waiver wave is
accepted; it is temporary debt, not a permanent pass rule.

Enforceable invariants:

1. A feature sync that lands any hop refreshes the scoped roster before returning or rethrowing; it
   never triggers the all-feature sweep.
2. Broad refresh is opt-in at the CLI boundary; a bare `spur feature refresh` cannot mutate feature
   projections.
3. An applied or possibly-partial wrap-up feature transition executes and reports the corpus-aware
   gate before the transition action returns.
4. A lifecycle projection is not accepted as proof merely because it exists; the check layer
   validates its content or identity.

Concrete command, finding, and workflow-var shapes:
`docs/design/lifecycle-projection-integrity.md`.

## 13. Dev-Command Argument Contract (built — ADR-032 amendment)

The agent-facing input contract stays inside each hand-authored command file and is projected to
platform adapters by Superskill. The three representations have separate ownership:

| Representation | Owner | Content |
| --- | --- | --- |
| `argument-hint` frontmatter | command file | canonical invocation syntax only |
| `## Argument Flags` | command file | public positionals and flags, command-local descriptions, deterministic defaults |
| shared flag glossary | `spur-dev` reference | canonical cross-command semantics and compatibility vocabulary |

`validate-commands.ts` parses command structure and hint-to-table parity. The command-contract and
flag-parity tests derive the dev-command inventory from `plugins/sp/commands/dev-*.md`, validate
shared glossary membership across that complete set, and retain the numbered `dev-operations.md`
parity check as an additional catalog constraint.

Invariants:

1. Every dev command has exactly `Argument Flags`, `Usage`, and `Implementation` level-two headings
   in that order.
2. Dev-command `argument-hint` values contain no Markdown link or prose definition.
3. Canonical public positionals and flags match bidirectionally between the hint and table.
4. Each shared flag resolves to one glossary entry or an explicitly documented contextual meaning.
5. Aliases and deprecated spellings remain compatibility metadata; they do not silently become
   canonical hint syntax or disappear without migration evidence.
6. No generated command registry or committed platform adapter participates in validation.

Concrete shapes and rollout: `docs/design/dev-command-argument-contract.md`.

## 14. Web Board Modules & Team-Scoped Composition (ADR-052)

`apps/web` renders the Board as a set of **auto-discovered modules**: `apps/web/src/modules/discover.ts`
eagerly globs sibling directories that export a named `module: WebModule` (`id`, `route`,
`sidebarLabel`, `order`, `component`). A new module needs **no registry edit** — discovery is
automatic; `order` only places it in the sidebar. Current modules: `teams`, `inbox`, `task-kanban`,
`observability`, `features`, plus shell-level pieces (sidebar, project switcher).

### 14.1 Current shipped state: two channels merged client-side

Spur has **two independent channels** between the Board and a backend coding agent. They are merged
_for display_ by the Inbox module; they are never merged in storage and delivery is unchanged.

| | Durable message queue | Process pipe |
| --- | --- | --- |
| Write path | `TeamService.sendMessage` → DAO `enqueue` | `POST /api/team/processes/:id/stdin` |
| Read path | `TeamService.getInbox` / `listRecent` / `drainPending` | `GET /api/team/processes/:id/stream` (SSE) |
| Delivery to agent | `spur agent loop` calls `drainPending`, prepends to prompt | written straight to `PipeProcess` stdin |
| Storage | SQLite (`inbox_messages`), durable, `queued → injected` lifecycle | in-memory ring buffer, bounded (default 500), lost on restart |
| Ordering cursor | `createdAt` | `seq` (monotonic) + `ts` |

The merge is a **pure function** in `apps/web/src/modules/inbox/timeline.ts`:
`mergeTimeline(messages, frames, agentId) → TimelineEntry[]` — a discriminated union
(`kind: message | frame`, `direction: in | out`). Pure keeps R5/R6 testable without mounting a
component. The oldest frame's `ts` is the process-frame **history boundary** (R6): entries older
than it are messages only, rendered behind a marker; an agent with no frames renders a message-only
timeline, not an error.

### 14.2 Shared process-stream helpers (R9)

`parseFrame`, `appendFrame`, `nextBackoff`, and `streamUrl` live once in
`apps/web/src/lib/process-stream.ts` and are imported by both `teams/MemberTerminal` and the Inbox
agent timeline. No duplicated frame-parsing logic.

### 14.3 Accepted G3 boundary (ADR-052)

G3 removes the display merge above. `agent.team.<teamId>` is the v1 workspace context: the team
config already owns its work folder and roster. Teams owns roster/process lifecycle/terminal/activity;
Inbox owns durable `inbox_messages`; Workspace is a Board composition shell that passes `teamId`
scope into existing Team, Inbox, and Task views. It introduces no workspace persistence, service,
HTTP route, or CLI noun. Until task 0197 lands, §14.1–14.2 describe the shipped transitional state.

### 14.4 Module-scoped DESIGN.md palette (R10–R13)

Each DESIGN.md-consistent Board module scopes its palette to its root rather than remapping the
shared `@theme` `spur-*` values (consumed by 13+ files across Features/Teams/Observability — they
must stay byte-identical). `global.css` carries a `.inbox { … }` block (and
`[data-theme="light"] .inbox`) declaring the DESIGN.md ladder, hairline, ink, and the four daisyUI
variables (`--color-primary/--color-primary-content/--color-accent/--color-accent-content` pinned to
the DESIGN.md lavender `#5e6ad2` on `#ffffff`). The daisyUI pins exist because `@/ui` primitives map
variants onto daisyUI's **own** `--color-primary`, which would otherwise place a second chromatic
accent on screen (0420 finding F-01). Module code carries **no hex literals and no Tailwind palette
classes** — every surface resolves a `spur-*` token.

### 14.5 Module shell convention (built — ADR-081; feature F72)

A multi-view Board module composes a **shell**: `<Module>Shell.tsx` plus an append-only `tabs.ts`
(`{ id, label, component }`; never reorder or rename — the tab strip and persisted UI state key on
`id`). Header anatomy is one row: icon + name + live chip left, module-specific inline filters
middle, tab strip right. Width rule: the default module layout is the centered `max-w-[1600px]`
column; a density-first module whose primary canvas is a multi-lane board MAY go full-bleed, with
header and body sharing one horizontal padding so lanes align under the header. Tasks
(`task-kanban/TasksShell.tsx` + `tabs.ts`, F72) is the first full-bleed instance; its shell absorbs
the old in-board toolbar (phase select, lane toggles, combined WBS/feature input, `+ New Task`) and
`TaskFilters.tsx` is deleted.

Embed rule: a module embedded under another module (Workspace ⊃ Tasks) exports a **headerless**
view (`TaskKanbanView`) rendering pure content; the shell is the route component only. Header-owned
state (phase folder, lane visibility) reaches the board as optional controlled props with
uncontrolled in-board defaults, so the embed keeps working with no shell present. Enforceable
invariants: one shell per module route; `tabs.ts` files are append-only; a full-bleed module shares
exactly one horizontal padding between header and body; the headerless embed never imports its
module's shell. Shapes: `docs/design/tasks-module-shell-parity.md`.

## 15. Agent-Facing Plugin Surface Parity (ADR-053/054)

Implemented 2026-08-11 (tasks 0512–0517): the frozen capture helper
`plugins/sp/tests/helpers/cli-surface.ts` (`captureCliSurface` / `parseCommanderHelp`) and the
focused parity suite `plugins/sp/tests/cli-surface-parity.test.ts` (plus `skill-structure.test.ts`
extensions) enforce the contract below against the live monorepo CLI.

The agent-facing surfaces in `plugins/sp/` are maintained under a mechanical parity contract with
the monorepo CLI (ADR-053, extending ADR-038's `spur-cli`-reference coverage). Three surfaces are in
contract — the `sp:spur-cli` facade inventories (noun routing table, Tier C exclusions, per-noun
verb/flag references), the `sp:spur-dev` spine step-routing table, and the `AGENTS.md` noun table.
The parity harness (bun:test + the monorepo CLI only; no new runtime/dependency/schema/transport)
resolves the CLI via `bun run apps/cli/src/index.ts` and captures the surface `--help`-primary:
`<noun> --help` is the universal capture surface; `--json` is used only where the noun actually
exposes a machine-readable inventory. Human `--help` parsing is a narrow adapter with fixtures and
explicit exclusions (ADR-053 amendment), never an assumed machine API. Diffs are bidirectional:
documented-but-absent and live-but-undocumented are both findings. Exclusions are marker-driven,
never silent — Tier C nouns the facade marks as outside its documentation scope, and spine rows
whose target is a slash command or inline execution rather than a CLI verb, are ignored by explicit
rule, never by absence of a match. The harness records the resolved binary's provenance;
published-npm `spur` skew is a documented drift source the tests cannot catch on end-user installs.
The spine/facade boundary is ownership-defined and asserted by the same tests, not redesigned
(ADR-054): the facade owns CLI noun/verb/flag semantics — including status-transition verbs — and
the spine owns multi-step lifecycle orchestration; the tests assert each surface documents its
owned scope, not the absence of "lifecycle steps" in the facade. The harness extends the existing
parity suite with at most one shared CLI-surface helper and at most one new focused parity test.
Duplication assertions cover exact catalogs and structured inventories only, never arbitrary prose.
Content surfaces (README index, cross-links) are pinned by the same harness.

Invariant (enforceable): every CLI surface change keeps the three contract surfaces in parity —
enforced mechanically by the parity harness (ADR-053), not by review discipline.

Shapes: `docs/design/plugin-surface-parity.md`.

Planning ownership follows ADR-055: B owns runtime agent execution; I owns the `sp` plugin harness
described in this section; H is frozen mixed history, not an active destination for new work.

## 16. Actionable Observability Context (foundation current — ADR-056; task 0526)

Cataloged events retain their domain-local ts-libs payloads until they cross Spur's canonical
observability seam. `registerSystemEventTap` and the CLI `SystemEventEmitter` call one pure envelope
builder before persistence; SSE uses the same projection. The history read path recognizes legacy
raw payloads and projects them into the current envelope without rewriting storage.

The task-0526 foundation is current. Board semantic rendering and additive workflow/rule trace
context remain downstream consumers in tasks 0527–0528; neither creates another envelope builder.

```text
Spur / @gobing-ai/ts-* typed event
  → SYSTEM_EVENT_CATALOG entry
  → buildSystemEventEnvelope(event, project context)
  → redacted + bounded system_events payload / SSE frame
  → Board semantic table + tooltip

workflow_runs / rule_runs
  → existing trace services
  → additive contextual DTO projection
  → human trace + JSON
```

Invariants:

- ts-libs event maps do not depend on Spur project context or presentation vocabulary.
- Redaction precedes recursive bounds and every persistence/streaming sink.
- `metadata-only` is an allow-list; it never retains business payloads or complete finding/output bodies.
- Indexed `system_events` correlation columns remain query authority; envelope correlation is the
  portable display projection.
- Legacy rows are adapted on read; no history migration or payload rewrite is required.
- Remediation values name only existing commands, Board filters, or local artifact paths and are
  omitted when exact reconstruction is impossible.
- Trace stores remain replay authority; System Events never reconstruct workflow or rule traces.

Shapes: `docs/design/actionable-observability-context.md`.

### 16.1 J9 semantic presentation (built — ADR-066/067/068; tasks 0601/0602)

J9 deepens the existing observability seam instead of adding a client or transport seam. Catalog membership and
operational policy remain in `event-names.ts`; an exhaustive presenter registry owns event-specific description,
retained fields, summary, and outcome support. `system-event-envelope.ts` remains the only composition boundary for
redaction, bounds, correlation, remediation, and the canonical v2 envelope. The Board consumes that result and owns
only generic table/tooltip chrome.

| Module | Ownership |
| --- | --- |
| Event producers | Emit facts known at mutation/execution time; never presentation prose. |
| `SYSTEM_EVENT_CATALOG` | Name, tier, payload policy, producer attribution, remediation policy, and resolved presenter metadata. |
| `SYSTEM_EVENT_PRESENTERS` | One typed entry per catalog name: authored description, fields, summary function, and derived/unsupported outcome policy. |
| Envelope projector | Redact and bound facts before invoking a presenter; compose one canonical `presentation`. |
| History projector | Preserve stored v2 `data`/`context`; recompute only `presentation` without a ledger write. |
| Board | Render canonical semantics; choose generic tooltip identity from correlation and row id without event-name switches. |

```text
fresh producer payload
  → catalog payload policy → redacted/bounded data + correlation
  → event-name presenter → canonical presentation
  → same envelope shape → system_events and SSE

stored legacy payload
  → fresh projection path (response only)

stored canonical v2 envelope
  → preserve stored data + context
  → current event-name presenter → replacement presentation (response only)
```

Producer enrichment stays at the narrowest owner:

- `PlanningWriteService` copies the successful `updateSection` mutation's section name and bounded after-value or safe
  diff into `task.updated` / `feature.updated`; transitions keep their existing `from` / `to` facts.
- `WorkflowService` builds one run-scoped identity decorator from the loaded definition and uses it for engine-native
  events, the persistence adapter, built-in action observability (`workflow.agent`), and steering acknowledgements.
  It supplies `workflowName`, a definition-derived step label when a step exists, and action `kind` where known;
  machine ids remain correlation fields, not primary summary text.
- `@gobing-ai/ts-infra` adds an optional configured queue identity to `QueueConsumerConfig` and both consumer lifecycle
  details. Spur supplies its real composition-root name and consumes a released dependency version; no local payload
  cast or job-type substitution stands in for the upstream contract.

Invariants (enforceable):

- Every catalog name has exactly one presenter; unknown out-of-catalog names alone use the bounded generic fallback.
- Presenters receive only bounded projected data and normalized correlation, never the raw producer payload.
- A derived outcome is a pure function of carried data; unsupported or missing historical facts omit Outcome.
- Reprojection never changes stored `data`, stored `context`, indexed correlation columns, or the ledger row.
- React contains no event-specific summary, outcome, description, or field switch.
- Catalog names and the `event-tracking.md` semantic matrix are checked in both directions.

Shapes and the per-event matrix: `docs/design/actionable-observability-context.md` and
`docs/design/event-tracking.md`.

### 16.2 J91 human table projection (built — ADR-073/074; task 0605)

J91 deepens the existing envelope projector; it does not add a client interpretation seam, an envelope
v3, or a CLI noun. Event-name presenters keep owning description, tooltip fields, summary, and outcome.
A single table projector, invoked after the presenter inside `system-event-envelope.ts`, owns the
opaque-id policy for table cells.

```text
bounded data + correlation + optional persistence-row actor
  → event-name presenter (summary, fields, outcome)
  → table projector (correlators, actionLabel, agent)
  → canonical presentation (tooltip action / fields unchanged)
  → Board maps those slots; no payload-key switches
```

| Module | J91 ownership |
| --- | --- |
| Presenter helpers | `humanWorkflowTitle`, `humanStepLabel`, `looksLikeOpaqueId`; workflow summaries never fall back to `runId` / UUID `node` / `kind`-as-step. |
| Presenter `retain` | Extra allow-list paths (`metadata.agent`, `metadata.role`, `routing.executor`) that are not tooltip fields. Catalog `metadataFields` = `fields` ∪ `retain`. |
| Table projector | Compose `presentation.correlators`, `presentation.actionLabel`, `presentation.agent` from bounded data + optional row `actor`. |
| Envelope `context` | Unchanged closed set. Actor is a projector input, never a context key. |
| Producers | Stamp identity at existing Spur fan-ins (`withWorkflowIdentity` on every engine-native emit, `projectActionMetadata`, invoke routing). ts-libs only if those paths cannot emit the fact. |
| Board | Render the new slots. Correlation is not `context.correlation` concatenation; Action is not the remediation command. |

Invariants (enforceable):

- Summary, `correlators`, `actionLabel`, and `agent` contain no UUID, no `live-` prefix, and no `eventId` / `runId` / `executionId` / `actionId` used as the cell value.
- `presentation.action` (remediation) is not the Action column value when its `value` embeds a UUID.
- `presentation.agent` is omitted when none of `data.routing.executor`, `data.agent`, `data.metadata.agent`, or an executor-shaped row `actor` is present.
- `context.producer` is never copied into `presentation.agent`.
- React contains no event-specific recovery of workflow name, step label, or agent identity.
- Reprojection still never changes stored `data`, stored `context`, indexed correlation columns, or the ledger row.

Shapes: `docs/design/system-events-human-table.md`.

## 17. Inter-Agent Control Plane (ADR-057 — waves 1–2 landed; wave 3 follow helper landed)

Current shipped coordination is two independent channels (`03` §14.1): durable `inbox_messages`
drained by `spur agent loop`, and a supervised process pipe (stdin POST + bounded SSE ring).
Wave 1 (task 0529) persists an `OccupantRef` + `coordination_runs` row when a run is addressed by
spec id (`flags['spec-id']` is set before `--drain` rewrites `--agent` to the spec's **executor
name** when the spec records one — falling back to the coding-agent type only via the
`spec-without-executor-field` shim, task 0537; `--spec <id>` is the canonical carrier since 0542)
and injects `SPUR_SPEC_ID` / `SPUR_TEAM_ID` / `SPUR_RUN_ID` / `SPUR_SERVE_URL` on supervised spawn.
Wave 2 (task 0530) ships the identity-pinned wait surface: `spur agent wait <specId>` (pins
`specId+runId+generation`, typed errors `occupant_gone|run_replaced|wait_stalled|timeout`)
and atomic `spur message send --wait` (snapshots the occupant before enqueue, waits on that
pin in the same process). Wave 3 (task 0531) replaced the 100 ms `system_events` poll with
`followSystemEventsAfter` (snapshot sequence, then follow `sequence > snapshot`; identity /
stall / timeout still heartbeat at 100 ms). Lifecycle is derived by a pure projector
(`working` = latest `agent.invoke.start`; `idle` = latest `agent.invoke.exit` + empty queued
inbox; `blocked` requires a first-class signal, none yet). First-class `blocked` remains
accepted design.
Task 0685 adds an exact-one selector above this unchanged pin layer: `--role` resolves a configured
Layer-1 role or executor name through `AgentInstanceStore.byRole` / `byExecutor`; zero or multiple
matches fail with count + candidates. `agent wait` and `message send --wait` snapshot the resolved
spec's occupant; an unwaited send queues to the resolved `specId` without requiring an occupant.
The Board Inbox `mergeTimeline` remains display-only; G3 (ADR-052) still owns un-merging it and
is not this section's work.

### 17.1 Target topology

```text
Agent A (spec reviewer)
  → spur message send --to implementer
  → inbox_messages (queued)
  → implementer agent loop drain
  → OccupantRef { specId, agentKind, processId, runId, generation }
  → CoordinationRun + artifact paths
Agent A
  → spur agent wait implementer --run <runId> --until invoke-exit
  → snapshot system_events seq → follow cataloged events → re-probe occupant
  → read artifactRefs (files), never a PTY
```

The process pipe stays the operator attach path. It is not the agent-to-agent command bus.

### 17.2 Invariants (enforceable)

1. No production module may open a socket to another coding-agent process for coordination.
2. No production module may read another pane's terminal buffer, screen manifest, or OSC title
   to decide agent lifecycle or to return “the other agent's output.”
3. No production module may write synthetic keystrokes to another agent's stdin as a substitute
   for `spur message send`.
4. `POST /api/team/processes/:id/stdin` remains operator/process-pipe only; `agent loop` delivery
   stays `drainPending` → prepend until a later accepted design replaces it.
5. Wait and send-wait pin `specId` + `runId` + `generation`. A replacement occupant cannot
   satisfy an in-flight wait.
6. `TeamService` / `AgentService` mutation methods return without blocking on wait. Waits live
   on the CLI or connection side and follow `system_events` / EventBus after a snapshot sequence.
7. New coordination verbs land on `agent` or `message` only (ADR-051). A new noun is a new ADR.
8. Semantic wait targets (`idle`, `working`, `blocked`) are derived only from cataloged events
   or an explicit report API. Presentation fields (titles, tokens, Board timeline rows) never
   satisfy a wait.
9. Coordination-run rows store artifact **paths**, not stdout/stderr bodies. Redaction runs
   before persist.

Shapes: `docs/design/inter-agent-control-plane.md`.

## 18. Transition-Shim Gate (ADR-058 — task 0541, feature B2)

The agent-role transition ships tracked compatibility: a compatibility path carries a source
comment marker `@transition-shim(<id>)`, registered in `config/transition-shims.json` with id /
owning WBS / file / what it keeps working / removal condition. The gate
`plugins/sp/scripts/transition-shim-check.ts` reconciles markers against the manifest
**two-sided**, mirroring `packages/app/src/services/corpus-check.ts` semantics: a marker with no
manifest entry fails as a **new unregistered shim** (id + file named); a manifest entry whose
marker no longer appears fails as a **stale entry**; an incomplete entry fails naming the missing
field. It scans the source roots `apps, packages, plugins, config, scripts, tooling`, skipping
build output, `vendors`, and `tests`/`test` directories (a fixture mentioning a marker id is test
data, not a shim) and `docs/` (prose examples do not trip the gate). Node-builtin only so it ships
to arbitrary projects; `--manifest` / `--roots` overridable. Wired into the fast `spur-check`
chain; `spur-check-new` composes that chain and then adds `corpus-check` (§12.5). Exit 0 when every
entry is present and every marker registered; 1 on any violation.

**Invariants (enforceable)**

1. Every `@transition-shim(<id>)` marker in a production source root has a manifest entry, and
   every manifest entry has a live marker — both directions fail the gate.
2. A manifest entry's `removalCondition` is checkable against the repository; a condition
   resolvable only by human judgement is rejected in review.
3. Emptying `config/transition-shims.json` is the definition of the agent-role transition being
   complete; a shim is removed by its owning task when its condition holds.
4. The gate runs inside the existing quality gate (`spur-check`), never as a separate opt-in
   step.

Shapes: `04 §2.5`; `config/transition-shims.json`.

## 19. Agent Executor Selection — Two-Layer Contract (features B2/B3, tasks 0535–0542, 0572)

Executor selection is a two-layer contract. **Layer 1** maps _role → tier/stages_ and its SSOT is
code: `DEFAULT_AGENT_ROLES` in `packages/config/src/index.ts` (ADR-061 / task 0572) declares the
four roles — `scribe`·cheap, `coder`·standard, `reviewer`·capable-1, `planner`·capable-2 — with an
optional closed-vocabulary `agent.roles` overlay (per-field merge, validated at config load) that
wins over the constant; a project re-tiers/re-stages a known role, never invents one. Layer 1 never
names an executor, model, or vendor. **Layer 2** maps _tier → executor_ and is owned by the operator
in `.spur/config.yaml` (`agent.executors` entries carrying a `tier` field). `packages/config`
exposes the four-id `AGENT_ROLE_NAMES` literal beside the SSOT. The CLI resolves roles in
`apps/cli/src/context.ts` (`resolveAgentRoles`) so `--agent <role>` resolves before any spawn; the
runtime regex parse of `plugins/sp/references/roles.md` is deleted outright (no shim — values are
byte-identical), and roles.md survives as a parity-gated projection: its tier/stages half is
asserted equal to `DEFAULT_AGENT_ROLES` by `plugins/sp/tests/roles.test.ts` (R9) and its
command→role half stays plugin-owned. Plugin-internal stage floors read the projection
(`plugins/sp/scripts/stage-registry-adapter.ts`, 0538 R4) and degrade to the `standard` floor when
it is unreachable.

Resolution (`AgentService.resolveAgent`): an explicit role starts at its tier's cheapest eligible
executor; an explicit executor name is a permanent pin (0536 R2, beats role routing); a bare binary
name survives under the `agent-bare-binary-name` shim with a one-time warning; `auto`/omitted falls
to the declared role (command frontmatter or workflow step `role:`), else `agent.default` as the
default role (0542 R2, shim `agent-default-executor`); on miss, Tier-1 priority. `extractPhase`
prompt-regex stage detection is retired (0536 R4) — the prompt text never derives a stage or role;
the stage door is the explicit `--stage` flag. Role names, executor names, and spec ids are proven
pairwise disjoint at config load (0537 R4), so one `--agent` value never means two things. A
spec-addressed run (`--spec <id>`, legacy `--agent <specId>`) rewrites the selector to the spec's
executor name when the spec records one (0537), restoring the operator's `{ agent, model }` + tier;
specs without an executor field fall back to `type` (shim `spec-without-executor-field`), and a
dangling executor reference fails loudly at drain, spawning nothing.

**Invariants (enforceable)**

1. `--agent` accepts only a Layer-1 role, a configured executor name, a bare binary name (shim), or
   `auto`/`inline`; anything else exits 2 before a process spawns (0536 R3).
2. Role names, executor names, and spec ids never collide in one config — a config that collides
   them fails to load naming both names (0537 R4).
3. A spec whose `executor` is absent from `agent.executors` fails at drain naming the spec and the
   missing executor; it never silently downgrades to a bare binary (0537 R5).
4. The prompt text never derives a stage or role (`extractPhase` retired); undeclared callers land
   on the default role visibly.

Shapes: `04 §2.1` (`agent.roles`); `packages/config/src/index.ts` (`DEFAULT_AGENT_ROLES`,
`AgentRoleConfigSchema`); `config/config.global.yaml` (the ADR-078 SSOT); `plugins/sp/references/roles.md` (projection).

## 20. Workflow Composition and Canonical Pipelines (ADR-069/072 accepted; ADR-071 accepted design)

D5 implemented an existing-seam, infrastructure-first migration. Workflow definitions remain the
orchestration graph; they do not become a second application layer. Shared deterministic behavior
is owned behind existing application and persistence interfaces. The remaining gap is proof
finality in the canonical task/docs pipelines (ADR-071; tasks 0703/0704).

### 20.1 Options and decision

| Option | Coupling and blast radius | Reversibility and cost | Disposition |
| --- | --- | --- | --- |
| Clean up commands independently inside each YAML/extension | couples policy to callers; drift remains across graphs | cheap initially, expensive to keep aligned | rejected |
| Add a generalized workflow DSL, progress store, and event-driven controller | duplicates engine, persistence, and replay authority | largest one-way change and migration surface | rejected |
| Extend existing app capabilities, engine action seam, persistence rows, and read projection | localizes changes behind proven owners | incremental, fixtureable, and reversible per pipeline | recommended |

The selected option has the smallest new interface: a checked composition baseline, two narrowly
owned deterministic action capabilities, a proof-input fingerprint, and a read projection. It adds
no package, transport, data store, or public CLI surface.

The rejected taste-gate details require three narrower decisions:

| Seam | Candidates | Choice | Strongest reason |
| --- | --- | --- | --- |
| Proof establishment | trust a post-fix verdict; combine mutation and proof in one new capability; split remediation from observe-only proof | split remediation from the final `--fix none` verification | a PASS can name one state without trusting a capability that may edit it |
| Gate execution | opaque shell string; structured executable/args; new gate DSL | literal executable/args invoking a named project script | it maps directly to `ProcessExecutor` and makes quoting and trust ownership explicit |
| Definition binding | replace run metadata; add a digest table; merge at run creation | atomically merge into `runs.metadata_json` | it preserves one run authority and every pre-existing metadata key |

### 20.2 Ownership topology

```text
workflow YAML
  ├─ graph, guards, retries, failure policy, capability selection
  ├─ deterministic app/CLI capability ──→ existing application owner
  ├─ command.gate ──→ literal executable/args + ProcessExecutor + attempt evidence
  ├─ run.artifact ──→ existing ArtifactDao (run id + kind + path only)
  ├─ workflow-local extension ──→ policy unique to one graph
  └─ agent.run ──→ model judgment through existing role/executor resolution

resolved workflow + composition baseline
  └─ static contract checker ──→ field-level graph/effect/artifact/caller diff

repository snapshot + normative task/feature sections
  └─ ProofInputFingerprint ──→ digest carried by gate/review/verify evidence
```

The baseline freezes behavior visible at the pipeline boundary: resolved graph, callers, terminal
states, artifact owners, failure policy, model-query locations, and every action's two effects:
`stateEffect: read|write|may-write` for repository/corpus inputs and
`evidenceEffect: none|write` for declared result artifacts. It is checked data, not another
executor. Unknown or extension-defined actions fail closed as `stateEffect: may-write` until their
owning capability declares and enforces a narrower contract. An evidence write is proof-neutral only
when its target is declared, confined, and tagged with the current proof-input digest.

`ProofInputFingerprint` deepens the existing alternate-index snapshot code used by `agent.run`. It
hashes the working repository outside configured task/feature folders, then combines that tree with
a canonical projection of normative corpus input: task identity/dependencies plus Background,
Requirements, Acceptance Criteria, Design, and Plan; feature identity plus Goal, Scope, and
Acceptance Criteria. Derived Review/Testing/Solution evidence, lifecycle status, timestamps, and
`.spur/run` artifacts are not proof inputs; their writers must be explicitly declared as evidence
writes. A write outside those confined projections changes the digest and invalidates the proof.

`command.gate` owns bounded attempts, process execution, PASS/FAIL normalization, and persisted
attempt evidence. It accepts literal executable/args only and delegates directly to
`ProcessExecutor`; a compound gate belongs in the named project script, not a runtime shell string.
`run.artifact` owns safe `.spur/run` path resolution and path-only artifact metadata. Domain
mutations continue through the normal application/CLI boundaries so task and feature lifecycle
guards cannot be bypassed. Exact shapes live in
`docs/design/workflow-composition-contract.md`.

### 20.3 Proof-state invariant

A verification verdict proves one final proof-input digest. Mutating remediation and proof
establishment are separate phases:

```text
remediation write|may-write                         → invalidated
invalidated + quality PASS(digest D)                → quality-passed(D)
quality-passed(D) + review PASS(D)                  → reviewed(D)
reviewed(D) + observe-only verify --fix none PASS(D) → verified(D)
verified(D) + confined evidence write tagged D      → verified(D)
any state write|may-write or current digest != D    → invalidated
```

The live `verify:onEnter:0` action is `/sp:dev-verify ... --fix all`; it is therefore
`stateEffect: may-write`, not `read`, and cannot establish `verified`. The target flow moves all
remediation before the proof chain, uses a read-only named project script for `command.gate`, and
runs final verification with `--fix none`. A failed verification may enter one bounded remediation
hop, but that hop returns to quality, review, and verification on a fresh digest.

Only `verified(D)` may cross the completion boundary, and the boundary re-captures D immediately
before transition. This statically disqualified the former `task-pipeline2.yaml`: both its
editing-capable verify action and post-PASS residual `agent.run` could mutate proof inputs before
record. That graph was deleted rather than promoted (ADR-076, 2026-08-20). The rule stands for any
future candidate: residual logic must be read-only or loop through remediation and the entire proof
chain.

Enforceable invariants:

1. Every resolved action in a reviewed pipeline declares both state and evidence effects in the checked baseline.
2. Unknown action kinds and editing-capable model actions are `stateEffect: may-write`, never implicitly `read`.
3. Quality, review, and final verification evidence must carry the same current proof-input digest.
4. Any state write, possible state write, or digest mismatch clears all earlier proof stages.
5. A gate never accepts missing, malformed, or non-token output as PASS.
6. Evidence metadata contains bounded references and the proof-input digest; file bodies and raw process output never enter the row.
7. Workflow actions cannot bypass task/feature lifecycle services or direct-write their corpus files.

### 20.4 Canonical topology and migration

The canonical topology retains separate workflows where the lifecycle and rollback boundary is real:
docs, wrap-up, idea/design review, task execution, and integration-HEAD PR review. Planning is a
duplicate front half and was absorbed into the canonical idea/dev-plan path, resolving
ADR-029's deferral (ADR-072 accepted 2026-08-20; `planning-pipeline.yaml` deleted).
`task-pipeline.yaml` is the single canonical task pipeline. The parallel `task-pipeline2.yaml`
candidate was **deleted rather than promoted** (ADR-076 accepted 2026-08-20): it had no live caller
and declared a fifth model query against the canonical pipeline's four, so promoting it would have
added cost against a goal of reducing it.

The migration order keeps rollback local; step 5 remains open under tasks 0703/0704:

1. Baseline every reviewed graph and freeze pipeline2 promotion.
2. Build projection, gate, artifact, and proof-state prerequisites without migrating a pipeline.
3. Migrate wrap-up, then docs, with parity and injected-failure fixtures for each.
4. Absorb planning; remove it only after caller, scaffold, and bundle parity.
5. Refactor task execution and redesign residual completeness around proof preservation.
6. Promote the safe delta only after clean comparator, artifact, gate, query-count, and exit parity plus operator approval.
7. Migrate idea last and invoke PR review once per stable integration HEAD after local gates.

Role selection stays on `agent.run`. Identity-pinned wait/message operations continue to address an
exact occupant; a role never becomes a mutable coordination address. PR-review pending/unavailable
stays advisory unless a later policy decision explicitly makes it blocking.

## 21. Workflow Progress Projection (built — ADR-070)

`WorkflowProgressProjection` is a pure application read module built inside `packages/app` beside
`WorkflowService`; it is not a new engine, DAO schema, or controller. Its narrow interface accepts a
run id and returns a projection assembled from the resolved definition and existing persisted truth.

### 21.1 Data flow

```text
run id
  ├─ definition resolver ──→ resolved states/actions/edges + definition digest
  ├─ runs ─────────────────→ workflow identity, terminal status, metadata_json.definitionDigest
  ├─ PhaseRunDao ──────────→ state visits
  ├─ TransitionRunDao ─────→ taken edges/current state
  ├─ ActionRunDao ─────────→ attempts, timing, and outcomes
  └─ ArtifactDao ──────────→ path-only run artifacts
           │
           ▼
  WorkflowProgressProjection ──→ one internal progress DTO + explicit diagnostics
```

Before the first action, the persistence composition merges `{ definitionDigest }` into the run
record's existing `metadata_json`; it never replaces the object. The same atomic merge contract is
used for `dryRun`, while terminal failure and stale-run finalization retain their current keys.
Existing and unknown metadata keys survive every write. A continued run retains its launch digest;
a different currently resolved digest becomes `definition-drift`, never an overwrite.

No schema or second progress store is added. Definition actions receive the stable key
`<state>:<onEnter|onExit>:<ordinal>` after extensions resolve. Persisted action rows currently carry
`node` and `kind`, not that key, so mapping uses ordered node/kind occurrences within a state visit.
An ambiguous mapping is surfaced as a diagnostic and never guessed. Definition drift, missing
launch digests, orphan rows, and unavailable definitions are explicit degraded states.

### 21.2 Follow model

The follower snapshots the latest System Event sequence, queries the complete persisted projection,
then follows events strictly after the snapshot. A correlated event only wakes a re-query; it never
changes progress directly. On timeout, disconnect, or event gap, bounded polling re-queries the same
sources. Duplicate or lost events therefore affect latency, not truth.

Inline execution remains controlled by the host-session driver. A record-only journal writes the
same run/phase/transition/action observation shapes through the existing persistence interface, but
cannot execute an action or request a transition. Engine-driven and inline runs consequently share
one read model without creating a competing controller.

Enforceable invariants:

1. Projection is deterministic for the same definition digest and persisted row set.
2. System Event payloads never become projection state; every wake-up re-reads persistence.
3. Poll fallback remains enabled until a persisted terminal run status is observed.
4. Ambiguous or orphaned rows produce diagnostics and never synthetic success.
5. Definition-digest writes merge into `runs.metadata_json`; they never erase `dryRun`, `failureReason`, `staleReason`, or unknown keys.
6. Inline journaling is record-only and cannot influence host execution semantics.
7. Public trace JSON/human output stays unchanged until an ADR-051 consent decision lands.

Detailed DTO, source mapping, follower sequence, and fixture matrix:
`docs/design/workflow-observability.md` §D5 detailed progress projection.

## 22. Environment-Improvement Lens and Active Session Review (ADR-084/085/089)

One plugin-level mapping projects vendor retro's seven-category environment-improvement taxonomy
into two imported-history/testee report contracts. It does not create a standalone retro analyzer.
ADR-089 adds a separate active-context reviewer whose broader job is immediate session outcome and
issue-state synthesis; it consumes the mapping only for improvement placement.

```text
plugins/sp/references/environment-lens.md     mapping SSOT (seven categories + placement rule)
        │
        ├─► sp:dogfood-testing  references/report-template.md §6
        │     optional finding class: environment | testee | waste
        │     protocol stays sp:dogfood-testing@1.2
        │
        └─► sp:history-anatomy  references/report-contract.md
              section 4: finding keys (closed category + retro <signal>)
              section 9: operator-facing environment/process candidates
              section 7: remediations stay proposals
              closed categories unchanged

active host conversation
        │
        └─► sp:session-review
              compact outcome / resolved / open / improvements / next-actions report
              inline, read-only, no history import or workflow
```

`sp:issue-finding` is a coexistence-window non-target (`/sp:dev-find-issue` already wraps
history-anatomy). Wrap-up learnings and gitignored `.spur/context/` memory do not own the lens.

**Build vs extend.** The mapping is a real seam: two report projections (dogfood §6, history-anatomy
section 9) must not drift. A new `sp:retro` skill would be a third overlapping analysis owner and
fails the deletion test relative to section 9 (Approach 2). Folding the scan into wrap-up
(Approach 3) mixes task-lifecycle gitignored learnings with harness-file proposals. Extending the
two existing reference files plus one plugin-level mapping is the smallest change that keeps a
single category table. `sp:session-review` does not own another category table: it reviews the live
conversation and applies the mapping's placement rule to at most three supported proposals.

**Placement rule** (mapping content; both projections apply it):

1. If an automated check can catch it, propose the check — not a new always-loaded sentence.
2. If it is a coding standard, the owner surface is the review path (`sp:code-verification` /
   `sp:code-review` / pipeline review), never the implementer skill.
3. `AGENTS.md` / `CLAUDE.md` stay navigation pointers; depth lives in skills and numbered docs.

**Present-don't-apply** (ADR-085): environment remediations are proposals. Dogfood fix-mode
repairs testee-contract step failures only; it must not `Edit`/`Write` environment sources for
an environment-tagged finding. History-anatomy already forbids applied changes.

**BODY_BUDGET.** `dogfood-testing` and `issue-finding` `SKILL.md` bodies are two-sided baselines
and must not grow. Dogfood driver-facing lens rules live in `report-template.md` (already linked
from that skill). History-anatomy `SKILL.md` stays a dispatcher; it does not copy the seven names.

**History-anatomy homes.** Environment-lens items that qualify as findings keep the closed
`category` and put the retro name in `<signal>` or owner-surface (section 4). Section 9 is the
I9 projection: each projected candidate names owner surface, expected impact, verification
method, and reversibility, and may cite a section-4 `key`. Section 7 remediations remain
proposals (existing contract). Existing section 9 prose that is not an I9 projection stays valid
and does not gain required fields.

**Structure gate.** `checkReportStructure` today matches pipe-rows whose first segment is already
in the closed vocabulary, so a retro-as-category key is currently invisible to that regex. The
I9 extension is an **additive reject**: a finding whose `category` or key first segment is a
retro name fails. Retro names in `<signal>` or owner-surface must not fail. Closed-vocabulary
fixtures that carry no retro signal must still pass.

Invariants (enforceable):

1. Exactly one file under `plugins/sp/references/` enumerates the seven retro category names.
   Dogfood `report-template.md` and history-anatomy `report-contract.md` name that file and do
   not redefine the seven names with different wording.
2. History-anatomy finding `category` is one of `reliability | repetition | workflow |
   performance | coverage | telemetry | positive`. A retro name (`navigation`, `automated checks`,
   `coding standards`, `AGENTS.md placement`, `tool economy`, `no-ops`, `information access`,
   and their kebab-case signal slugs) as `category` fails the structure gate.
3. Dogfood protocol remains `sp:dogfood-testing@1.2`. Class tags are optional; `validate-report`
   does not parse them; untagged reports and the cache-health P3 remain valid.
4. An environment-tagged dogfood finding is never applied as a tree mutation in fix-mode.
5. `plugins/sp/skills/issue-finding/` gains no category, flag, or lens projection.
6. No public CLI noun/verb/flag and no `/sp:dev-retro` command (ADR-016 / ADR-051).
7. `/sp:dev-review-session` stays inline and report-only; no workflow, delegation, import, baseline,
   cache, task creation, or indexed-context append (ADR-089).

Shapes: `docs/design/environment-improvement-lens.md`; `docs/design/session-review.md`.

## 23. Baseline Taxonomy and Waiver Lifecycle (accepted design — ADR-093; enforcement pending)

Baseline files are classified by effect, not filename:

| Class | Current artifact | Gate effect | Lifecycle |
| --- | --- | --- | --- |
| Gate waiver | `config/corpus-baseline.json` | matching current findings pass | temporary debt; migrate before the next acceptance wave |
| Reference contract | `config/workflow-composition-baseline.json` | drift from reviewed workflow facts fails | durable while the reviewed contract exists |
| Regression budget | `config/pipeline-budgets.json` | measured regression beyond a numeric ceiling fails | durable; `null` means unenforced measurement debt, not an exemption |
| Transition manifest | `config/transition-shims.json` | undeclared and stale shims both fail | temporary by construction; complete only when empty (ADR-058) |

A gate-waiver record must identify bounded scope, owner, review date, and an objective remediation or
removal condition. New findings never inherit an existing waiver, and regeneration may remove
resolved debt but cannot silently accept new debt. Missing or expired governance metadata must fail
closed once the ADR-093 enforcement lands. Until then, the current corpus snapshot is legacy debt;
ADR-090/092 describe its present behavior, not permission to keep it indefinitely.

## 24. Production Autonomy Contracts (accepted design — ADR-094–100; not yet built)

These controls extend existing owners; they add no agent runtime, workflow engine, event bus,
analytics store, or memory authority:

```text
agent.run requirement
  -> executor resolution -> host capability attestation -> dispatch
  -> typed usage at safe boundary -> budget/trip-wire decision
  -> existing failure transition -> bounded escalation artifact

repository state D -> fresh review(D) -> fresh verify(D) -> verified result(D)

checkpoint/index -> freshness validation -> resume or ignore -> confined retention cleanup
```

| Concern | Existing owner reused | Current gap | Implementation |
| --- | --- | --- | --- |
| Capability enforcement | executor config + `agent.run` resolution | host enforcement is not attested | 0706 / ADR-094 |
| Live budgets | action timeout + typed runner results | token/cost are nullable or retrospective | 0707 / ADR-095 |
| Trip wires | workflow guards/failure edges + System Events | signals lack one deterministic stop mapping | 0708 / ADR-096 |
| Independent judgment | reviewer/verifier roles + agent sessions | fresh context and executor separation are not enforced | 0710 / ADR-097 |
| Escalation | run artifacts + event ledger + messages | evidence has no canonical handoff projection | 0709 / ADR-098 |
| Memory lifecycle | checkpoints + `.spur/context` indexes + workflow cleanup | freshness and retention contracts are uneven | 0711 / ADR-099 |
| Outcome accounting | verdicts + proof digest + history/run records | activity is measured; verified-result quality is not | 0712 / ADR-100 |

Capability, budget, proof, and trip-wire failures are deterministic and fail closed at existing safe
boundaries. Raw prompts, output, and logs remain bounded references rather than packet/event content.
Unavailable measurement stays unavailable; it never becomes zero. The always-loaded guide byte gate
is process enforcement owned by `99 §6.7` and task 0705, so it does not receive a project ADR.
