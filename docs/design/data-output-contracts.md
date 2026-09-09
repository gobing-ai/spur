# Data and output contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="3-data-shapes"></a>

## 3. Data Shapes

<a id="31-tables-composed-package-owned-schema-adr-007"></a>

### 3.1 Tables (composed package-owned schema, ADR-007)

| Table                                                      | Owner                     | Purpose                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces`                                               | CLI                       | Static workspace binding (name, root, purpose, default agent)                                                                                                                   |
| `runs`, `phase_runs`, `transition_runs`, `workflow_states` | CLI + workflow engine     | Workflow run model                                                                                                                                                              |
| `artifacts`                                                | CLI                       | Captured output references                                                                                                                                                      |
| `history_import_ledger`                                    | importer                  | One row per imported record (hash, source, file, line)                                                                                                                          |
| `history_import_checkpoint`                                | importer                  | Incremental position, composite PK `(source, source_file)`                                                                                                                      |
| `history_message`                                          | importer + CLI            | Typed message rows. Nullable `request_id` identifies repeated Claude response snapshots; rollups retain the final cumulative row (`MAX(rowid)`) once, backed by partial index `idx_history_message_request_id` (migration `0020_spur_cli_history_message_request_id_idx`). |
| `history_tool_call`                                        | importer                  | Typed tool-call rows joined to messages by `message_hash`; result bodies are never stored, only bounded metadata such as `result_bytes`. |
| `history_etl_<source>`                                     | importer                  | Generic/custom-source payload rows, created lazily only when an accepted record targets the table. Built-in typed imports leave no empty ETL tables; migration `0019_spur_cli_history_etl_tables_drop` retires the ten vestigial built-in tables. |
| `inbox_messages`                                           | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_cli_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |
| `coordination_runs`                                        | ts-db (`CoordinationRunDao`) | Occupant pin + path-only artifact refs for spec-addressed runs (ADR-057 wave 1). PK `run_id`; indexed `(spec_id, generation DESC)`. Added by migration `0010_spur_cli_coordination_runs`. Never stores stdout/stderr bodies. |
| `agent_instances` (reserved draft)                         | CLI                       | Future DB home for materialized instances (ADR-086): `spec_id` PK; `team_id`, `member_key`, `executor`, nullable `role`, `workspace`, `status` (`stopped\|running\|exited\|errored`), nullable `pid`/pin fields, JSON `tags`/`config`, integer timestamps; indexes on role, executor, and team. Draft id `0026_spur_cli_agent_instances` is intentionally absent from `CLI_MIGRATIONS`. |
| `history_run_session`                                      | CLI (`RunSessionDao`)        | Run→session mapping (feature E6): `run_id` → `(source, session_id)` with `exactness` (`exact` \| `unresolved` \| `estimated`) and `mechanism` (`observed` \| `supplied` \| `inferred`). `RunSessionObserver` writes boundary observations; import may promote an unresolved row to exact when a session is observed inside that run's `.spur/run/<runId>/agent-sessions/` directory (task 0624). `RetroCorrelator` writes estimated/inferred rows and never shadows exact. Indexed on `run_id` and `(source, session_id)`. |
| `history_task_session`                                     | CLI (`TaskSessionDao`)       | Task↔session attribution (feature E6, task 0722): evidence-backed `(wbs, source, session_id)` triples recovered during history import. One row per task per session; `exactness` is `estimated` on the import path (first-party operational syntax only, echo rule per run-2 remediation R9 — task-scoped `/sp:dev-*` slash invocations in user rows, structured `spur task <verb> <wbs>` operations **only via tool-call args**; quoted command text in user rows, tool-output echoes, and prose never links and is counted skipped — validated through the task locator) and distinguishable from invoke-boundary `exact` mappings; `evidence_kind`/`evidence_ref` carry a bounded audit locator (`user-command`\|`cli-tool`, `<file basename>#<line>`), never transcript content. The primary key makes re-imports idempotent and enforces exact-over-estimated precedence. Indexed on `(source, session_id)`. |
| `rule_runs`, `rule_eval_runs`                              | ts-rule-engine (≥0.3.15)  | Persisted rule-run history powering `spur rule trace`; added by migration `0002_spur_cli_rule_history`. `applied_fix_count` is re-stamped by Spur after `applyFixes`.           |
| `agent_executor_updates`                                  | ts-db (`AgentExecutorUpdateDao`) | Durable newest-pending quota-driven executor update per project/executor (ADR-111): PK `(project_id, executor_name)`; `observation_id`/`observed_at`/`agent`/`model`/`disabled` plus `applied_observation_id`/`applied_at`/`attempts`/`retry_after`/`last_error`; survives event-history pruning. Added by migration `0040_spur_cli_agent_executor_updates`; consumed by the server drain and CLI flush-before-exit persistence (0799). |

<a id="32-sourcedefinition-history-import"></a>

### 3.2 SourceDefinition (history import)

One config object per source: `source` discriminant, `displayName`, `filePatterns`, `defaultRoots`,
`splitConfig` (one-to-one | one-to-many | custom), `fieldMap` (raw→canonical), optional
`fieldTransforms`, and a Zod `schema` validating canonical fields. Adding a source = one variant.

**`fieldTransforms` limits (task 0722 run-2 probe, importer 0.4.48).** Transforms are per-source,
apply to **every** split record of that source, and receive only the mapper's split record — never
the raw JSONL object, and no target-table identity. Consequence measured live: a derived
`getSourceDefinition('pi')` definition adding an `args_raw` transform to recover pi bash tool-call
commands (persisted `NULL` upstream — `maybeArgsRaw` keeps args only for the todo allowlist) fails
twice over. The command is absent from the split record (`piSplit` discards non-todo
`call.input`; only the one-way `args_digest` survives), and the transform's key presence on
`history_message` split records makes the typed message insert throw (`Typed table
"history_message" has unknown columns: args_raw`). Bash-args recovery is therefore an upstream
mapper fix, not a caller-side transform.

<a id="33-analytics-records"></a>

### 3.3 Analytics records

`CostRecord` (source, date, model, input/output tokens, cache split, costUsd) is the single-record cost
shape kept for the analyze rollup helpers. The run-cost path (task 0559) no longer builds `CostRecord`s:
`attributeActionCost` folds `history_message`'s typed token columns directly through the
`history_run_session` mapping (exact vs estimated apart, never priced). The analyze path aggregates in
SQL over `history_message` / `history_tool_call` into a versioned `HistoryArtifact`
(`packages/domain/src/analytics/artifact.ts`), whose core bucket is `TokenTotals` extended with the
forensic dimensions (`messages`, `toolCalls`, `durationMs`, `durationUnmeasured`) and
`cacheWriteTokens` (matching the `history_message.cache_write_tokens` column). Artifact contract:
`schemaVersion`, `generatedAt`, `spurVersion`, `selector`, `coverage`, `totals`, `bySource`,
`byModel`, `daily`, `byTool`, `bySession`, `loops`, `warnings` (0464 R2). Additive 0581 fields for
the per-step sections: `topStepsByTokens`, `topStepsByDuration` (`StepStat[]`), `cacheWaste`
(`{ steps, inputTokens, topSteps }`), `stepSupport` (`StepSupportEntry[]`) — all optional in the
type, absent on pre-0581 artifacts (schemaVersion stays 1).

<a id="4-output-conventions"></a>

## 4. Output Conventions

- Human mode: terse, line-oriented, tab-separated where tabular.
- JSON mode (`--json`): a single JSON document to stdout, stable keys for automation.
- Errors go to the error sink with context (what failed, path/identifier); exit codes are meaningful.

<a id="41-cli---json-shape-inventory-f95--task-0693-swept-2026-08-27--emit-set-below"></a>

### 4.1 CLI `--json` shape inventory (F95 / task 0693, swept 2026-08-27 @ emit set below)

Per-noun inventory of every `--json`-bearing verb across the 14 noun modules under
`apps/cli/src/commands/`, from a full `toJson(` / `JSON.stringify(` sweep (104 emit sites,
counts per module in parentheses). Target shape = the ADR-091 envelope
(`{ok: true, data}` / `{ok: false, error: {code, message, details?}}`; paginated list verbs
`{ok, data, meta}`). This table doubles as the migration ledger: rows gain a **Post-adoption**
note as nouns adopt behind `--json-envelope` (plan step 8).

**Post-adoption (task 0693 R4, 2026-08-27; re-swept 2026-08-28):** all 104 sites are accounted for — 99 adopted
behind the opt-in (`toJson(payload)` → `toEnvelopeJson(payload, { enveloped: options.jsonEnvelope })`;
raw output stays byte-identical), 5 intentionally kept raw. Default rule per row: the "Current
shape" column describes the **raw default that remains unchanged**; enveloped output wraps it
as `{ok, data}` (single), `{ok, data, meta}` (list), or normalizes it (error envelopes).
Row-level deltas from the default rule:

- **List-kind sites** (bare arrays → paginated `{ok, data, meta}`): `task list`, `task check`
  (default path), `feature list`, `feature check`. The check verbs' envelope `ok` is command
  success (`ok: true` with the verdict carried per row in `data`) — the frozen
  `apiSuccessSchema` pins `ok: true`, so an aggregate-failure cannot be expressed as
  `ok: false, data` without re-spelling the envelope (recorded as the one classification
  judgment call of R4).
- **Error normalization** (class 4 sites → enveloped `{ok: false, error: {code,
  message, details}}` with `code: 'INTERNAL_ERROR'` and the CLI-local code carried in
  `details.cliCode`): task create/batch-create collision + duplicate-follow-up,
  projects add/remove/list/start/stop error branches, builder bump-ver/drop-tags error
  branches, message send/wait usage + typed failures, agent wait resolution/usage/fail
  branches, history daily `{error: detail}`, and (close-out 2026-08-27) the `feature show` /
  `feature transition` not-found returns at `apps/cli/src/commands/feature.ts:60,175`, which had
  bypassed the seam via a direct `context.output.error(...)`.
  Task 0787 (2026-09-06) added the create/batch-create machine-error surface:
  `writeCreateJsonError` (`apps/cli/src/commands/task.ts:146`) emits ONE parseable
  `--json` result for `candidate-invalid` (exit 1, `details.findings` carrying the
  checker findings), `invalid-usage` (exit 2), collision/duplicate-follow-up (exit 3),
  and `create-failed`/`batch-create-failed` (exit 1). Unlike `writeJsonError`, raw
  mode (`--json` without envelope) writes the `ok:false` payload to **stdout**;
  without `--json` the message stays stderr prose.
- **Class-3 top-level-`ok` payloads** move under `data` unchanged; the envelope `ok` is
  recomputed as command success (task migrate, migrate-anchors, check --corpus, noop,
  agent create, init fresh run, projects/builder success payloads).
- **Kept raw (5 sites, not adopted):** `task verdict` (writes the `.spur/run` verdict
  artifact consumed by pipeline code, not CLI stdout), the two workflow internal event
  fingerprints (dedup keys, not CLI output), and the two `workflow show` `toJson` sites
  (`apps/cli/src/commands/workflow.ts:866,875` — the verb deliberately does not advertise
  `--json-envelope`, so no enveloped path exists to route to). `rule list` and
  `task verifyall-aggregate` raw `JSON.stringify(x, null, 2)` sites were adopted — their
  formatting is identical to the `toJson` raw path, so byte-identity holds.
- **Service-side adoption — CLOSED (task 0697, 2026-08-27).** The envelope helpers moved to
  `packages/app/src/output/envelope.ts` (ADR-091 amendment 2026-08-27); `apps/cli/src/output.ts`
  re-exports them, so all 99 sites adopted at 0693 are unedited. The verbs that emit their JSON
  from a `packages/app` service now receive the decision through an `enveloped` option threaded
  from the command layer, and `envelopeEnabled()` applies the same precedence
  (explicit flag > `SPUR_JSON_ENVELOPE=1` > raw) — no service reads the env var itself:

  | Verb | Emit site (post-0697) | Threaded from | Enveloped shape |
  | --- | --- | --- | --- |
  | `agent list` | `agent-service.ts` `list()` | `agent.ts` → `runAgentList` → `svc.list({enveloped})` | `{ok, data: {agents}}` |
  | `agent doctor` | `agent-service.ts` `renderDoctor()` (2 sites) + role-ladder failure | `agent.ts` → `svc.doctor({enveloped})` | `{ok, data: {agents, rolesSource, cache}}`; failure → `{ok:false, error:{code:'INTERNAL_ERROR', details:{cliCode:'agent-resolution'}}}` |
  | `agent run` | `agent-service.ts` `handleRunOutput()` + resolution failure | `agent.ts` → `flags.jsonEnvelope` shim → `AgentService.run()` | `{ok, data: {exitCode, stdout, …}}`; failure as above |
  | `rule run` | `rule-service.ts` `evaluate()` | `rule.ts` → `service.evaluate({enveloped})` | `{ok, data: {preset, ruleCount, findings, fixes}}` |
  | `rule validate` | `rule-service.ts` `validate()` (valid + invalid branches) | `rule.ts` → `service.validate({enveloped})` | `{ok, data: {valid, kind, source, …}}` |

  `agent run` was **not** in the original four; the AC4 scan surfaced it as the same defect class
  (it registers the flag and emits from the service) and it is closed with them. All five emit
  **flat objects**, so `apiSuccessSchema` `{ok, data}` applies and `paginatedResponseSchema` does
  not — the arrays inside (`agents`, `findings`) stay fields of the payload rather than being
  unwrapped to the top level. The private `toJson` helper in `agent-service.ts` is deleted; every
  emitter routes through the one seam.

  **The inventory is now guarded, not swept by hand.** `apps/cli/tests/json-envelope-inventory.test.ts`
  walks every `.command()` block registering `SHARED_OPTIONS.jsonEnvelope` (68 verbs) and fails on
  any verb that advertises the flag without routing it to an envelope emitter — in-module, through
  a module-level helper, or threaded to a service. The only permitted exception is its explicit
  `KEPT_RAW` allowlist, which must stay in sync with the "Kept raw" bullet above; today it holds
  one entry (`task verdict`, whose stdout doubles as the `.spur/run` artifact bytes). Raw-default
  byte-identity for the service verbs is pinned against a pre-relocation baseline captured before
  any edit: `packages/app/tests/fixtures/json-raw-baseline.json`, asserted by
  `packages/app/tests/services/json-envelope-adoption.test.ts`.

| Noun | Verb | Emit sites (`apps/cli/src/commands/<noun>.ts`) | Current shape | Deviation from ADR-091 envelope |
| --- | --- | --- | --- | --- |
| task (26) | create | 228, 241, 272, 307, 312 | success flat-object `{…result, wbs, filePath, readiness:{status: ready\|skipped, depth: ready}}` (0788); all error branches via `writeCreateJsonError` (0787): raw `--json` stdout `{ok:false, error:{code, message, …}}` — `candidate-invalid` carries `findings`, `preparation-failed` (0788) carries `failedStage`/`wbs`/`filePath`/`recoveryCommand`/`readiness`/`findings?` — enveloped collapses to `INTERNAL_ERROR` + `details.cliCode` | success unwrapped; exits: candidate-invalid/preparation-failed/failed 1, usage 2, collision/dedupe 3 |
| task | show | 255 | flat-object `{…rest, frontmatter}` | unwrapped |
| task | update | 324, 349, 431, 475 | flat-object; `--section` result `{ref, warnings, …}` has **no `ok`** (0688 case 1); `noop` path `{ok:true, noop, …}` | unwrapped; top-level `ok` on a subset of branches = two meanings of `ok` across calls |
| task | deps | 546 | flat-object | unwrapped |
| task | sections | 610 | flat-object | unwrapped |
| task | list | 657 | **bare-array** | no envelope; becomes `{ok:true, data, meta}` paginated form |
| task | refresh | 690 | flat-object | unwrapped |
| task | migrate | 715 | flat-object-with-ok `{ok:true, dryRun, corpusDir, …report}` | `ok` at top level means command success, not envelope discriminant |
| task | migrate-anchors | 754 | flat-object-with-ok | same top-level-`ok` conflict |
| task | refresh-roster | 797 | flat-object | unwrapped |
| task | batch-create | 959, 1015, 1020 | success flat-object `{created, wbs, parentsWired, readiness:{status: ready\|skipped, depth: ready}}` (0788 — whole batch prepared before commit unless `--skip-ready`); error branches via `writeCreateJsonError` (0787): raw `--json` stdout `{ok:false, error:{code, …}}`, `candidate-invalid` carrying `findings`, `preparation-failed` (0788) carrying `failedStage`/`recoveryCommand` | unwrapped success; enveloped errors collapse to `INTERNAL_ERROR` + `details.cliCode`; any invalid item aborts the whole batch (zero files) |
| task | record | 880 | flat-object | unwrapped |
| task | verdict | 947 | flat-object artifact written to `.spur/run/<wbs>-verdict.json` (raw `JSON.stringify`) | file artifact, not stdout; unwrapped; bypasses `toJson` |
| task | verifyall-aggregate | 1013 | flat-object (raw `JSON.stringify`) | unwrapped; bypasses `toJson` |
| task | check | 1104 (`--corpus`), 1245 (default) | `--corpus`: flat-object-with-ok (0688 case 4); default: **bare-array** `[{wbs, status, findings, pass, …}]` (0688 case 3) | bare-array path wraps array as `data` with `ok` from aggregate pass/fail; corpus `ok` moves under `data` |
| task | resolve | 1268 | flat-object | unwrapped |
| task | path | 1294 | flat-object `{wbs, filePath}` | unwrapped |
| task | run-link | 1332 | flat-object | unwrapped |
| task | scaffold-tests | 1368 | flat-object | unwrapped |
| workflow (14) | validate | 273 | flat-object | unwrapped |
| workflow | run | 406, 431, 440, 621 | flat-object (sync/async-fallback result, `{status:'failed', reason, hint}` failure, `{runId, status:'started', …}` handle, sync result) | unwrapped; failure is status-discriminated, not `{ok:false, error}` |
| workflow | continue | 698 | flat-object | unwrapped |
| workflow | clean | 744 | flat-object (`logsOnly ? logResult : {…result, logs}`) | unwrapped |
| workflow | cancel | 788 | flat-object (status union incl. `not_found`) | not-found is a status value, not an error envelope |
| workflow | list | 813 | flat-object (`WorkflowListResult`) | list verb without paginated `{ok, data, meta}` form |
| workflow | show | 855, 864 | flat-object (`{name, kind, format, steps}` todo · `{name, kind, format, diagram}` mermaid) | **kept raw** — registers `SHARED_OPTIONS.jsonSupported`, not `jsonEnvelope`, so it never advertises the flag (added by task 0695 after the 0693 sweep; recorded 2026-08-28) |
| workflow | trace | 946 | flat-object (timeline/summary union) | unwrapped |
| workflow | (internal) | 1121, 1128 | `JSON.stringify` event fingerprints — **not CLI output** (dedup/dedupe keys) | none — counted in the 104 for sweep parity, no migration |
| feature (11) | create | 33 | flat-object | unwrapped |
| feature | show | 64 | flat-object `{…rest, content}` | unwrapped |
| feature | update | 143 | flat-object | unwrapped |
| feature | advance | 178, 210 | flat-object `{id, status, hops}` | unwrapped |
| feature | list | 241 | **bare-array** | wraps as paginated `{ok, data, meta}` |
| feature | move | 269 | flat-object | unwrapped |
| feature | refresh | 328 | flat-object `{index_path, tasksUpdated}` | unwrapped |
| feature | check | 403 | **bare-array** (0688 case 2) | wraps array as `data`, `ok` from aggregate pass/fail |
| feature | sync | 450, 474 | flat-object | unwrapped |
| projects (10) | add | 32, 39 | `{ok:true, project, …}` / `{ok:false, error:"<string>"}` | top-level `ok` is command success, not envelope discriminant; `error` is a bare string, not `{code, message}` |
| projects | remove | 60, 67 | same `{ok, …}` / `{ok:false, error:"…"}` pattern | same |
| projects | list | 91, 106 | `{projects}` (no `ok`) / `{ok:false, error:"…"}` | unwrapped success; string error |
| projects | start | 128, 148 | `{ok:true, project, running}` / `{ok:false, error:"…"}` | top-level-`ok` conflict; string error |
| projects | stop | 204, 211 | `{ok:true, stopped}` / `{ok:false, error:"…"}` | same |
| message (10) | send | 49, 64, 154, 190, 274, 470 | errors: pseudo-envelope `{error:{code:'usage'\|…, message}}` (**no `ok`**); success: flat-object queued ack / wait payload `{msgId, toId, status, wait}` | error shape is near-miss (no discriminant, CLI-local codes); success unwrapped |
| message | inbox | 296 | flat-object `{count, messages}` | unwrapped |
| message | reply | 323 | flat-object | unwrapped |
| message | watch | 388 | stream of flat-object message rows (one JSON doc per poll) | streamed rows stay per-row flat; envelope applies per emitted row under `--json-envelope` |
| history (9) | import | 72, 85, 104, 125 | errors `{status:'error', message}`; success `{…fanOut, provenance}` | failure discriminated by `status` field, not envelope; success unwrapped |
| history | analyze | 162 | flat-object (HistoryArtifact) | unwrapped |
| history | report | 198 | flat-object (HistoryArtifact) | unwrapped |
| history | daily | 217, 347, 356 | errors `{status:'error', message}` / `{error: detail}`; success flat-object | mixed failure conventions, none the envelope |
| team (6) | status | 150, 329 | flat-object status doc; `--by-team` `{teams}` | unwrapped |
| team | start | 261 | flat-object (`result.body`) | unwrapped |
| team | stop | 307 | flat-object (`result.body`) | unwrapped |
| team | up | 399 | flat-object `{…result, started}` | unwrapped |
| team | down | 438 | flat-object `{…result, stopped}` | unwrapped |
| agent (6) | list | 243 (`--specs`); plain path emits service-side (`agent-service.ts` `AgentService.list`) | flat-object `{specs:[…]}` / `{agents}` | unwrapped; plain path adopted 0697 — honors flag/env via threaded `enveloped` |
| agent | doctor | service-side (`agent-service.ts` `AgentService.doctor` / `renderDoctor`; errors were pseudo-envelopes `{error:{code:'agent-resolution', message}}`) | flat-object `{agents, rolesSource, cache…}`; errors pseudo-envelope | adopted 0697 — success honors flag/env; enveloped errors normalize to `INTERNAL_ERROR` with `details.cliCode: 'agent-resolution'`; raw bytes unchanged |
| agent | run | service-side (`agent-service.ts` `handleRunOutput`); failure pseudo-envelope `{error:{code:'agent-resolution', message}}` | flat-object `{exitCode, stdout, stderr, durationMs, …}` | adopted 0697 — honors flag/env via tri-state `jsonEnvelopeFlag(flags)` (absent → `SPUR_JSON_ENVELOPE`); raw bytes unchanged |
| agent | wait | 137, 775, 792, 802 | errors pseudo-envelope `{error:{code:'usage'\|'wait_stalled'\|…, message}}`; success flat-object `{satisfied, pin}` | near-miss error shape (no `ok`), CLI-local codes |
| agent | create | 308 | flat-object-with-ok `{ok:true, spec}` | top-level-`ok` conflict |
| builder (4) | bump-ver | 38, 44 | `{ok:true, verb, target, version}` / `{ok:false, verb, error:"…"}` | top-level-`ok` conflict; string error |
| builder | drop-tags | 74, 80 | same pattern | same |
| rule (3) | run | service-side (`packages/app/src/services/rule-service.ts` `RuleService.evaluate`, JSON branch) | flat-object `{preset, ruleCount, …engine result}` | unwrapped; adopted 0697 — honors flag/env via threaded `enveloped` |
| rule | validate | service-side (`RuleService.validate`, both JSON branches) | flat-object `{valid, kind, source, …}` (`valid: false` carries `errors`) | unwrapped; adopted 0697 — `valid` stays a payload field; envelope `ok` is command success |
| rule | list | 98 | flat-object (`RuleListServiceResult`) via **raw `JSON.stringify`** | unwrapped; bypasses `toJson` helper |
| rule | trace | 135, 147 | flat-object detail / `{runs}` | unwrapped |
| init (2) | init | 282, 426 | converged re-run flat-object `{…result, globalRulesSeeded, …}` (no `ok`); fresh run `{ok:true, project, config, …result}` | inconsistent between branches; top-level-`ok` on fresh path only |
| status (1) | status | 51 | flat-object | unwrapped |
| serve (1) | serve | 37 | flat-object `{port, url, pid:null, running:false}` (dry probe) | unwrapped |
| migrate (1) | migrate | 23 | flat-object | unwrapped |

Sweep parity: 104 raw sites = 102 verb emit sites + 2 workflow internal fingerprints
(1121/1128, footnoted above); per-module counts in the Noun column match the live sweep
(task 26, workflow 14, feature 11, projects 10, message 10, history 9, team 6,
agent 6, builder 4, rule 3, init 2, status/serve/migrate 1 each). The 0693 sweep recorded
102 sites / workflow 12; task 0695 added `workflow show --format todo|mermaid` (855/864),
re-swept 2026-08-28 during the 0693 `--force` re-verify.

Cross-cutting deviation classes (every row is an instance of one of these):

1. **Unwrapped flat-object** — no `{ok, data}` envelope (majority).
2. **Bare-array** — `task list`, `task check`, `feature check`.
3. **Top-level `ok` with non-envelope meaning** — projects/builder/init-fresh/agent-create/
   task migrate/migrate-anchors/corpus-check: `ok` states command success and siblings sit
   beside it, so `.ok` is not an envelope discriminant (the two-`ok`s hazard ADR-091 rule 4
   resolves by moving these under `data`).
4. **Pseudo-envelope errors** — `{error:{code, message}}` with no `ok` (message/agent/task
   collision paths) or `{ok:false, error:"<string>"}` (projects/builder): neither validates
   against `apiErrorSchema`; codes are CLI-local strings, not `API_ERROR_CODES`.
5. **Helper bypass** — `rule list`, `task verdict`, `task verifyall-aggregate` stringify
   without `toJson`.

<a id="42-citation-convention--prefer-pathsymbol-over-pathline-task-0694-f94"></a>

### 4.2 Citation convention — prefer `path:symbol` over `path:line` (task 0694, F94)

Line anchors rot: 0606's `eval-pipeline.ts:528` drifted to `:562` after an unrelated +34-line
edit, caught post-commit by a human. New task citations and test evidence therefore prefer
the `path:symbol` form — the symbol names a named code entity, so an edit that shifts lines
does not invalidate it.

- **Preferred form:** `` `anchor-qualifier.ts:resolveRepoRoot` `` — repo-relative path plus a
  named symbol (function, class, exported const). Applies to new citations in task files
  (Solution/Testing/References evidence) and test descriptions.
- **Line anchors stay acceptable** when there is no enclosing named symbol or the reference is
  not to code position: a specific line in a non-code file, a diff hunk under review, a quoted
  log line, or code with no enclosing named symbol. State the exception explicitly in the
  citation (a convention with no stated exception gets ignored wholesale).
- **No rewrite of existing `path:line` citations.** This governs new citations only; a mass
  rewrite would mint the churn F94 exists to remove.
- **Dated decision note:** the 0688 friction review (2026-08-27) recorded this preference (the
  per-code diagnosis lived in the corpus-baseline `note` field, retired by task 0775). The
  drift *detection* side is task 0692's report; enforcement is deliberately deferred — this is a
  documentation convention, not a gate.
