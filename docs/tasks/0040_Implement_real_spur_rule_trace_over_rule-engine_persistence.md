---
name: Implement real spur rule trace over rule-engine persistence
description: Implement real spur rule trace over rule-engine persistence
status: Done
created_at: 2026-06-11T20:40:33.400Z
updated_at: 2026-06-11T22:59:14.361Z
folder: docs/tasks
type: task
feature-id: ""
preset: complex
impl_progress:
  planning: done
  design: done
  implementation: pending
  review: pending
  testing: pending
---

## 0040. Implement real spur rule trace over rule-engine persistence

### Background

Task 0038 deliberately shipped `spur rule trace` as a placeholder only:

```text
spur rule trace [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]
TODO: spur rule trace is reserved for rule execution history (pending rule-engine persistence).
```

The alignment decision in task 0038 was explicit: rule history should use the same durable pattern as
workflow history, not JSONL and not EventBus-as-storage. The engine owns persistence through direct
adapter calls; events remain in-process observability. Task 0039 then completed the workflow-engine
side of that pattern for `action_runs`: engine schema + direct writes upstream, Spur-side DAO/read
model, and `workflow trace <run-id>` timeline rendering.

This task is the rule-engine counterpart. The published `@gobing-ai/ts-rule-engine@0.3.14` still has
no persistence seam (`RulePersistenceAdapter`, `RULE_ENGINE_SCHEMA_SQL`, `rule_runs`,
`rule_eval_runs`, etc. are absent). It does expose useful observability events
(`rule.run.start`, `rule.eval.start`, `rule.eval.done`, `rule.eval.error`, `rule.run.done`), and
Spur already uses those for `--verbose`, but events are not durable and do not carry enough query
context by themselves. `RuleService` owns the CLI run boundary and already knows the preset/file/rule
filters, fix mode, dry-run flag, fail thresholds, selected rule count, findings, fixes, and applied
fix results.

The target is to replace the placeholder with a real SQLite-backed query surface:

```text
spur rule trace [run-id] [--preset <name>] [--status <done|failed>] [--since <date>] [--last <n>] [--json]
```

No new command grammar is needed; the grammar already exists. This task turns it from a TODO marker
into a real history reader and updates the write path so `spur rule run` creates that history.


### Requirements

#### R1 — Upstream rule-engine persistence seam

1. Add an engine-owned schema SQL export, e.g. `RULE_ENGINE_SCHEMA_SQL`, with at least:
   - `rule_runs`: `id`, `preset`, `source_kind`, `source_value`, `status`, `rule_count`,
     `finding_count`, `fix_count`, `applied_fix_count`, `fail_on`, `stop_on_first`,
     `fix_mode`, `dry_run`, `started_at`, `completed_at`, `duration_ms`, `metadata_json`,
     `created_at`, `updated_at`.
   - `rule_eval_runs`: `id`, `run_id`, `rule_id`, `severity`, `evaluator`, `status`,
     `finding_count`, `fix_count`, `duration_ms`, `error`, `findings_json`, `fixes_json`,
     `started_at`, `completed_at`, `created_at`, `updated_at`.
2. Add a public `RulePersistenceAdapter` contract plus DB-backed and memory-backed implementations.
3. Persistence must be direct adapter writes from the engine/run lifecycle, not an EventBus subscriber.
4. The engine must support caller-provided `runId`; Spur stamps it so users can re-query a run.
5. Persist incrementally enough that a running process can expose at least the run row and per-rule
   progress if `trace` is polled during a long rule run.
6. Release the rule engine and bump Spur through the root Bun catalog; no `link:` dependencies remain.

#### R2 — Spur rule-run write path

1. `RuleService.evaluate()` injects the persistence adapter and run metadata into the engine.
2. Preserve existing command behavior and output for `spur rule run` in plain, `--json`, `--verbose`,
   `--fix-mode`, `--dry-run`, `--stop-on-first`, `--file`, and `--rule` modes.
3. Record run status:
   - `done` when the rule engine completes evaluation, regardless of whether findings trip `--fail-on`.
   - `failed` only for engine/runtime failures that prevent a normal result.
   - Keep CLI exit code semantics unchanged: findings at/above `--fail-on` still exit 1.
4. Record fix data without leaking unrelated file contents. Store structured findings/fixes JSON, but
   keep payloads bounded to engine result DTOs.
5. Record enough metadata to explain a run later: preset/file/rule filters, cwd-relative file paths,
   fail threshold, stop-on-first threshold, fix mode, dry-run flag, selected rule count, finding count,
   fix count, applied fix count, and duration.

#### R3 — `spur rule trace` real query surface

1. No argument: list recent rule runs from SQLite, newest first, default `--last 20`.
2. Filters:
   - `--preset <name>` filters runs by preset.
   - `--status <done|failed>` filters by run status.
   - `--since <iso-date>` filters by start time.
   - `--last <n>` requires a positive integer.
3. With `<run-id>`: show a per-run detail view including summary metadata and per-rule evaluation rows
   in execution order.
4. Plain output should mirror `workflow trace` density: compact list by default; detailed timeline for
   a run id.
5. `--json` returns stable structured DTOs for both list and detail forms.
6. Missing run id returns a clear error and exit 1.

#### R4 — Domain/app layering

1. Add domain DAOs for rule run history under `packages/domain/src/dao`.
2. Add app-layer trace methods to `RuleService` or a small adjacent service while keeping CLI wrappers thin.
3. Do not query engine internals from the CLI. CLI imports only `@gobing-ai/spur-app` / domain DTOs.
4. Do not write trace artifacts under `.spur/rules/`; that path remains the local rule-definition layer.

#### R5 — Docs and compatibility

1. Update `docs/04_DESIGN.md`: change `rule trace` from reserved/TODO to real persisted history query.
2. Update `docs/03_ARCHITECTURE.md` if a new rule-history table group or data flow is introduced.
3. If upstream rule-engine public contracts are added, document them in the upstream README before
   relying on them from Spur.
4. Keep the command grammar from task 0038 stable; do not rename `trace` or add a new noun.

#### R6 — Verification gates

1. `bun run lint` passes.
2. `bun run test` passes with no skipped tests.
3. `bun run test-cf` passes.
4. `bun run build` passes.
5. `tasks check 0040` passes before marking done.


### Q&A

**Q1. Is this a Spur-only task now that `spur rule trace` already exists?**
No. The CLI grammar exists, but it is intentionally a placeholder. Published `ts-rule-engine@0.3.14`
has no durable persistence seam. A real trace command needs upstream write support first, then Spur
can add the read/query model.

**Q2. Why not persist from Spur by wrapping `RuleService.evaluate()` only?**
Spur knows useful run metadata, but the engine owns per-rule execution order, evaluator timings,
errors, findings, and fixes. Mirroring workflow history means the engine owns the durable run/eval
schema and direct persistence calls; Spur supplies run context and queries the resulting tables.

**Q3. Why not use the existing RuleEngineEvents?**
Events are observability, not storage. They are optional, handler delivery is not the durable write
path, and the event payloads do not encode enough stable query context. They can stay useful for
`--verbose`; persistence should be direct adapter API.

**Q4. Should `rule trace` mark a run as failed when findings trip `--fail-on`?**
No. Findings causing CLI exit 1 are a successful evaluation with policy failure. Use `status=done`
with `finding_count > 0`; reserve `status=failed` for runtime/engine failures that prevent a normal
result.

**Q5. Should the command be `history` instead of `trace`?**
No. Task 0038 already fixed the grammar. `trace` is the verb across execution history surfaces:
`workflow trace` and `rule trace`.


### Design

### Architecture

Use the workflow trace pattern, adapted to the rule engine:

```text
spur rule run
  -> RuleService.evaluate()
  -> RuleEngine.evaluate/evaluateWithFixes({ persistence, runId, metadata })
  -> RulePersistenceAdapter direct writes
  -> SQLite rule_runs + rule_eval_runs
  -> RuleService.trace()
  -> spur rule trace
```

Persistence is a durable engine concern. EventBus events remain useful for `--verbose` progress and
future live UIs, but they are not the audit store because handlers are optional, lossy, and not the
right place to enforce write ordering.

### Proposed Tables

`rule_runs` should be the list/query unit:

| Column | Purpose |
|--------|---------|
| `id` | caller-provided or generated run id |
| `preset` | preset name when using preset mode |
| `source_kind` / `source_value` | `preset` or `file`; source identifier |
| `status` | `running`, `done`, `failed` |
| `rule_count` | enabled/selected rule count |
| `finding_count` | total findings |
| `fix_count` | collected fixes |
| `applied_fix_count` | applied fixes for `--fix-mode auto` |
| `fail_on` | CLI threshold |
| `stop_on_first` | optional threshold |
| `fix_mode` / `dry_run` | fix execution context |
| `metadata_json` | bounded extra metadata: selected `--rule`, cwd, engine version, stoppedEarly |
| timestamps/duration | list sorting and timeline display |

`rule_eval_runs` should be the per-rule detail unit:

| Column | Purpose |
|--------|---------|
| `id` | row id |
| `run_id` | FK to `rule_runs` |
| `rule_id` | evaluated rule id |
| `severity` | configured severity |
| `evaluator` | evaluator kind |
| `status` | `running`, `done`, `failed`, `skipped` if stop-on-first prevents later rules |
| `finding_count` / `fix_count` | quick summary |
| `findings_json` / `fixes_json` | bounded DTO payloads for detail mode |
| `error` | evaluator error, if any |
| timestamps/duration | execution order and timings |

### Trace Output

No-arg/list form:

```text
$ spur rule trace --preset recommended-pre-check --last 5
RUN ID        PRESET                  STATUS  RULES  FINDINGS  FIXES  STARTED
rule-abc123   recommended-pre-check   done    12     0         0      2026-06-11T20:00:00Z
rule-def456   recommended-pre-check   done    12     3         1      2026-06-11T19:45:10Z
```

Detail form:

```text
$ spur rule trace rule-def456
Run: rule-def456 — recommended-pre-check — done
Rules: 12   Findings: 3   Fixes: 1   Duration: 1.42s
Fail-on: error   Stop-on-first: none   Fix-mode: suggest

  ✓ no-hardcoded-secrets           0 findings   85ms
  ! no-biome-suppressions          2 findings   34ms
  ✓ no-npm-pnpm-yarn-scripts       0 findings   19ms
```

JSON form should be DTO-first, not formatted text:

```json
{
  "run": { "runId": "rule-def456", "preset": "recommended-pre-check", "status": "done" },
  "evaluations": [
    { "ruleId": "no-hardcoded-secrets", "status": "done", "findingCount": 0, "durationMs": 85 }
  ]
}
```

### Non-goals

- Do not add `--follow`/SSE/push; polling `spur rule trace` is enough for CLI mode.
- Do not persist raw source files or full console output.
- Do not write JSONL run files.
- Do not put run artifacts under `.spur/rules/`.
- Do not change `spur rule list`; it remains rule-definition inventory.


### Solution

## Solution

Implemented per the Design's workflow-trace pattern, with the persistence seam shipped upstream in
`@gobing-ai/ts-rule-engine@0.3.16` and consumed from the registry via the root Bun catalog.

**Upstream (ts-libs, released 0.3.16):** `RULE_ENGINE_SCHEMA_SQL` (`rule_runs` + `rule_eval_runs`),
public `RulePersistenceAdapter` contract with `DbRulePersistenceAdapter` / `MemoryRulePersistenceAdapter`,
and direct engine writes in `evaluateWithFixes`: run row inserted as `running` before evaluation,
per-rule eval rows inserted/updated during the loop, run finalized `done`/`failed` with counts and
duration. Engine accepts caller-provided `runId` / `runMeta`; `applied_fix_count` is by contract the
caller's to stamp after `applyFixes`.

**Spur write path (`packages/app/src/services/rule-service.ts`):** `evaluate()` builds
`DbRulePersistenceAdapter` from the lazy CLI DB, stamps a Spur-generated `runId` (`createId('rule')`),
and passes `runMeta` (source kind/value, preset, thresholds, dry-run, `metadata_json` with cwd +
selected `--rule`). Verbose mode constructs one engine with both persistence options and the
progress `EventBus`. After `--fix-mode auto` application (non-dry-run), Spur re-stamps
`applied_fix_count` via `persistence.updateRunStatus` using the engine-written row.

**Read path:** `RuleRunDao` / `RuleEvalRunDao` (`packages/domain/src/dao/rule-run-dao.ts`) with raw-row
DTOs mirroring `workflow trace`; `RuleService.traceList/traceDetail`; thin CLI action in
`apps/cli/src/commands/rule.ts` with `--last`/`--status`/`--since` validation, tab-table list,
per-rule timeline detail, `toJson` DTO output, and `Run not found` → exit 1.

**Migrations:** `RULE_ENGINE_SCHEMA_SQL` folded into `CLI_SCHEMA_SQL` (fresh DBs) plus incremental
`0002_spur_cli_rule_history` (embedded `CLI_MIGRATIONS` + `drizzle/0002_spur_cli_rule_history.sql`)
so pre-0040 databases gain the tables — the team-inbox `0001` precedent.

**Dependency closure:** root catalog bumped to `^0.3.16`; two stale root bun-links to the ts-libs
working tree removed; `packages/domain` now declares `@gobing-ai/ts-rule-engine: "catalog:"`
(previously resolved through the stale link). Two behavioral regression tests pin the contract:
run → trace end-to-end (CLI) and evaluate-persists (service) fail against any engine that silently
ignores persistence options.


### Plan

1. **Upstream discovery:** Re-check the currently consumed `@gobing-ai/ts-rule-engine` export surface.
   If no persistence seam exists, implement it in `~/xprojects/ts-libs` first.
2. **Upstream implementation:** Add schema SQL, adapters, engine options, direct write calls, and
   tests for run/eval persistence, running rows, finalized rows, failures, stop-on-first, fixes, and dry-run.
3. **Release closure:** Publish the rule-engine package, bump Spur's root Bun catalog, run `bun install`,
   and verify workspace resolution from the consuming workspace.
4. **Spur domain:** Add `RuleRunDao` / `RuleEvalRunDao` or equivalent typed query helpers in
   `packages/domain`.
5. **Spur app:** Extend `RuleService.evaluate()` to create/stamp a run id and pass persistence metadata
   to the engine. Add `RuleService.trace()` list/detail methods.
6. **Spur CLI:** Replace the placeholder action in `apps/cli/src/commands/rule.ts` with the real service
   call. Keep existing flags and validation; add missing validation for `--last` and `--since`.
7. **Docs:** Update `docs/04_DESIGN.md`; update architecture docs if new DB tables are documented there.
8. **Tests:** Add app-service DAO/service tests plus CLI wrapper tests for list, detail, filters, JSON,
   missing run, invalid flags, and post-run trace data.
9. **Verification:** Run lint/test/test-cf/build and update task `0040` with Phase 7/8 verification notes.


### Review

## Review — 2026-06-11 (rd3:dev-verify, mode=full, focus=all, channel=inline)

**Status:** 11 findings (2 P1, 5 P2, 2 P3, 2 P4)
**Scope:** working-tree diff for task 0040 (9 modified + 2 new files)
**Gate (pre-fix):** `bun run lint` ✅ · `bun run test` 553 pass ✅ · `bun run test-cf` ✅ · `bun run build` ✅ — all against the LOCAL store only (see F1)

### P1 — Blockers

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Unreleased engine masquerading as published 0.3.14 (R1.6 unmet) | Correctness | `node_modules/.bun/@gobing-ai+ts-rule-engine@0.3.14+ff341c5bfed10990` vs registry tarball | Registry `ts-rule-engine@0.3.14` (published 2026-06-11T20:20Z) has NO `persistence/` module, no `DbRulePersistenceAdapter`, no `RULE_ENGINE_SCHEMA_SQL`; the local `.bun` store content does. Fresh `bun install` breaks compile in CI. Release ts-libs rule-engine (0.3.15+), bump root catalog, reinstall from registry. NOT auto-fixable from this repo (requires npm publish in ~/xprojects/ts-libs). |
| 2 | Existing DBs never get rule history tables — silent no-op trace | Correctness | `packages/domain/src/migrations.ts:59-62`, `drizzle/` | `RULE_ENGINE_SCHEMA_SQL` folded only into `0000_spur_cli_foundation`, which the `__spur_cli_migrations` journal marks applied on every existing DB; no incremental migration added and `drizzle/*.sql` not regenerated. DAOs swallow `no such table`, so `rule trace` silently returns empty forever. Add `0002_spur_cli_rule_history` (embedded + drizzle file), mirroring the 0001 inbox precedent. |

### P2 — Warnings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | evaluateVerbose reaches into private engine fields via lying casts | Correctness | `packages/app/src/services/rule-service.ts:451-458` | `(engine as unknown as {persistence: unknown}).persistence as undefined` reads private fields and builds a second engine. Pass `events` into `buildEngine` and construct one engine. |
| 4 | `applied_fix_count` always 0; Spur never stamps runId (R1.4/R2.5) | Correctness | `rule-service.ts:220,242`; engine.js:189 | Engine writes `appliedFixCount=0` with comment "set by the caller after applying fixes"; Spur applies fixes on a third bare engine and never updates the row. Stamp a Spur-generated runId into the engine and call `persistence.updateRunStatus` with the applied count after `applyFixes`. |
| 5 | `metadata_json` never populated — `--rule` filter/cwd not recorded (R2.5) | Correctness | `rule-service.ts:212-219` | Engine reads `runMeta['metadataJson']`; Spur never sets it. Pass bounded `metadataJson` (selected `--rule`, cwd). |
| 6 | No `--since` validation on `rule trace` (plan item 6) | Usability | `apps/cli/src/commands/rule.ts` trace action | Malformed dates silently string-compare in SQL and filter wrong. Reject non-ISO-parsable `--since` with exit 1. |
| 7 | CLI trace tests not hermetic — open real workspace DB | Correctness | `apps/cli/tests/commands/rule.test.ts` trace tests | `main(['rule','trace'])` opens `apps/cli/.spur/spur.db`; the "(no DB)" assertions pass only because of F2's missing tables. Pass `dbUrl: ':memory:'`/temp path; add run→trace e2e. |

### P3 — Info

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 8 | 03_ARCHITECTURE places rule DAOs in nonexistent `apps/cli/src/db/` | Usability | `docs/03_ARCHITECTURE.md:101-103` | New DAOs live in `packages/domain/src/dao/rule-run-dao.ts`; correct the layout text instead of extending a stale entry. |
| 9 | Missing tests required by task Testing section | Correctness | `packages/app/tests/`, `apps/cli/tests/` | No traceList/traceDetail service tests; no CLI e2e (run→trace), no detail/--json-detail via main(), no invalid `--last`, no malformed `--since` tests. |

### P4 — Suggestions

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 10 | `require()` instead of ES import in formatter tests | Usability | `apps/cli/tests/commands/rule.test.ts:271,335` | Import `formatTraceList`/`formatTraceDetail` at top with the other imports. |
| 11 | Inline `JSON.stringify(x, null, 2)` bypasses `toJson` helper; `byId` returns null while typed `undefined` | Usability | `apps/cli/src/commands/rule.ts`; `packages/domain/src/dao/rule-run-dao.ts:76` | Use `toJson` like every other command; normalize `?? undefined` in `byId` so runtime matches the signature. |

### Requirements traceability (Phase 8)

| Req | Verdict | Evidence / gap |
|-----|---------|----------------|
| R1.1 schema SQL export | PARTIAL | Exists in local store (`dist/persistence/schema.js`, 3× IF NOT EXISTS); absent from registry 0.3.14 tarball |
| R1.2 adapter contract + Db/Memory impls | PARTIAL | `DbRulePersistenceAdapter`/`MemoryRulePersistenceAdapter` exported locally only |
| R1.3 direct adapter writes (not EventBus) | PARTIAL | engine.js:64 `persistence.insertRun(...)` direct call; unreleased |
| R1.4 caller-provided runId, Spur stamps it | PARTIAL | engine.d.ts:21 `runId?` supported; Spur `buildEngine` passes none (F4) |
| R1.5 incremental persistence during run | PARTIAL | insertRun before evals + per-rule updateEvalRun (engine.js); unverifiable vs published pkg |
| R1.6 release + catalog bump, no links | **UNMET** | Registry 0.3.14 lacks the seam; local store diverges from registry (F1) |
| R2.1 evaluate() injects persistence + metadata | MET | `rule-service.ts:211-220 buildEngine(runMeta)` |
| R2.2 preserve run behavior/output | MET | 553 tests pass incl. existing run-mode suites |
| R2.3 status semantics done/failed | PARTIAL | engine.js:189 writes 'done'; failure path untested in Spur |
| R2.4 bounded findings/fixes JSON | MET | engine persists result DTO JSON only |
| R2.5 full run metadata | PARTIAL | metadata_json never set; `--rule`/cwd missing; applied_fix_count always 0 (F4, F5) |
| R3.1 no-arg list, default last 20 | MET | `rule.ts` default '20'; DAO `ORDER BY started_at DESC LIMIT` |
| R3.2 filters preset/status/since/last | PARTIAL | All filter; `--since` unvalidated (F6) |
| R3.3 run-id detail with eval rows in order | MET | `RuleService.traceDetail`; `rule-run-dao.ts:107 ORDER BY started_at` |
| R3.4 plain output mirrors workflow trace | MET | `formatTraceList`/`formatTraceDetail` |
| R3.5 --json stable DTOs | MET | Raw-row DTOs consistent with `workflow trace` (`run-dao.ts traceRows`) |
| R3.6 missing run id → error + exit 1 | MET | `rule-service.ts traceDetail` throws 'Run not found'; CLI sets exit 1 (untested, F9) |
| R4.1 domain DAOs | MET | `packages/domain/src/dao/rule-run-dao.ts` |
| R4.2 app-layer trace methods, thin CLI | MET | `RuleService.traceList/traceDetail` |
| R4.3 CLI imports app/domain DTOs only | MET | `rule.ts` imports from `@gobing-ai/spur-app` |
| R4.4 no artifacts under .spur/rules | MET | No such writes |
| R5.1 04_DESIGN updated | MET | trace section rewritten |
| R5.2 03_ARCHITECTURE accurate | PARTIAL | Updated but places DAOs in nonexistent CLI `db/` (F8) |
| R5.3 upstream README documents contracts | PARTIAL | Unverifiable from Spur; blocked on release |
| R5.4 grammar stable | MET | No grammar change |
| R6 gates | PARTIAL | lint/test/test-cf/build pass locally only (F1); `tasks check 0040` pending |

---

**Fix-pass 2026-06-11T14:55 (–08:00):** 10 fixed, 1 skipped (F1).

| F# | Action | Result |
|----|--------|--------|
| F1 | Upstream release | **SKIPPED — blocked on release.** Deeper diagnosis: the project `.bun` store entry "0.3.14+ff341c5bfed10990" is a poisoned **intermediate** local build — it exports `DbRulePersistenceAdapter`/`RULE_ENGINE_SCHEMA_SQL` (so lint/tsc pass) but its `RuleEngine` constructor **silently ignores** `persistence`/`runId`/`runMeta` → `spur rule run` persists nothing even locally. The root `node_modules/@gobing-ai/ts-rule-engine` is a stale bun link to `~/xprojects/ts-libs/packages/rule-engine` (fully wired, v0.3.15, **uncommitted+unpublished**) which masked this during inspection. Registry 0.3.14 has no persistence at all. Close-out: commit+gate ts-libs rule-engine, publish 0.3.15, bump root catalog to ^0.3.15, `bun install`, remove the stale root link; the two red regression tests below then go green. |
| F2 | Added `0002_spur_cli_rule_history` migration (embedded `CLI_MIGRATIONS` + `drizzle/0002_spur_cli_rule_history.sql`), regression test simulating a pre-0040 DB | FIXED |
| F3 | `evaluateVerbose` now receives `engineOptions` and constructs one engine with `events`; private-field casts removed | FIXED |
| F4 | Spur stamps `runId` (`createId('rule')`); after `applyFixes` (non-dry-run) re-stamps `applied_fix_count` via `persistence.updateRunStatus` using the engine-written row | FIXED |
| F5 | `runMeta.metadataJson` now records `cwd` + selected `--rule` | FIXED |
| F6 | `--since` validated (`Date.parse`), exit 1 with clear message | FIXED |
| F7 | Trace CLI tests hermetic (`dbUrl: ':memory:'`/temp file); run→trace e2e added | FIXED (e2e red by design, see F1) |
| F8 | `03_ARCHITECTURE.md` corrected: DAOs/migrations/analytics live in `packages/domain`, stale CLI `db/` entry removed | FIXED |
| F9 | Added app-layer `traceList`/`traceDetail` tests (order/limit/filters/missing-id/no-DB) + CLI invalid `--last`, malformed `--since`, unknown-run-id tests | FIXED |
| F10 | `require()` → top-level ES imports in formatter tests | FIXED |
| F11 | `toJson` helper used for trace JSON; `byId` normalizes `null → undefined` | FIXED |

**Gate (post-fix):** `bun run lint` ✅ · `bun run test-cf` ✅ · `bun run build` ✅ · `bun run test` **564 pass / 2 fail** — the 2 failures are deliberate behavioral regression tests (`rule run persists a run that trace lists and details`, `evaluate() persists a finalized run row…`) that MUST stay red until the released engine actually persists (cerebrum do-not-repeat 2026-06-11). Do not skip or weaken them.

**Post-fix verdict: FAIL (blocked on upstream release).** R1.6 unmet; R1.1–R1.5/R2.3 unverifiable against a published package. All Spur-side findings resolved. Task stays In Progress.

---

**Release closure 2026-06-11T15:58 (–08:00) — F1 RESOLVED, verdict upgraded to PASS.**

- All `@gobing-ai/ts-*` published at **0.3.16** (operator). Registry tarball verified: `dist/persistence/` present, `engine.js` contains the direct `insertRun`/`updateRunStatus` write path.
- Root catalog bumped `^0.3.14` → `^0.3.16`; `bun install`; workspaces resolve registry `0.3.16+3f1a4ed45f5d8e5a` with a behaviorally wired engine (prototype probe confirms `insertRun`).
- Removed two stale root bun-link symlinks (`ts-rule-engine`, `ts-dual-workflow-engine` → ts-libs working tree). The poisoned intermediate 0.3.14 store entry is no longer referenced.
- Latent gap exposed by the cleanup and fixed: `packages/domain` imported `@gobing-ai/ts-rule-engine` (migrations + DAO tests) without declaring it — it had resolved through the stale root link. Added `"@gobing-ai/ts-rule-engine": "catalog:"` to `packages/domain/package.json`.
- Upstream README documents the persistence contracts (R5.3 ✅); ts-libs ships its own persistence test suite.

**Final gate:** `bun run lint` ✅ · `bun run test` **566 pass / 0 fail** (both behavioral regression tests now green against the published engine) · `bun run test-cf` ✅ · `bun run build` ✅ · `tasks check 0040` ✅

**Final requirements verdicts:** R1.1–R1.6 **MET** (released 0.3.16: schema export, adapter contract + Db/Memory impls, direct writes, caller runId stamped by Spur, incremental run/eval rows, catalog bump with no links). R2.1–R2.5 **MET** (persistence injected; behavior preserved; done/failed semantics engine-owned with exit codes unchanged; bounded DTO payloads; metadata incl. `--rule` filter, cwd, thresholds, fix counts — `applied_fix_count` re-stamped post-apply). R3.1–R3.6 **MET** (list/detail/filters/validation/JSON DTOs/missing-run error). R4.1–R4.4 **MET**. R5.1–R5.4 **MET**. R6.1–R6.5 **MET**.

**Final verdict: PASS** — task complete.


### P1 — Blockers

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Unreleased engine masquerading as published 0.3.14 (R1.6 unmet) | Correctness | `node_modules/.bun/@gobing-ai+ts-rule-engine@0.3.14+ff341c5bfed10990` vs registry tarball | Registry `ts-rule-engine@0.3.14` (published 2026-06-11T20:20Z) has NO `persistence/` module, no `DbRulePersistenceAdapter`, no `RULE_ENGINE_SCHEMA_SQL`; the local `.bun` store content does. Fresh `bun install` breaks compile in CI. Release ts-libs rule-engine (0.3.15+), bump root catalog, reinstall from registry. NOT auto-fixable from this repo (requires npm publish in ~/xprojects/ts-libs). |
| 2 | Existing DBs never get rule history tables — silent no-op trace | Correctness | `packages/domain/src/migrations.ts:59-62`, `drizzle/` | `RULE_ENGINE_SCHEMA_SQL` folded only into `0000_spur_cli_foundation`, which the `__spur_cli_migrations` journal marks applied on every existing DB; no incremental migration added and `drizzle/*.sql` not regenerated. DAOs swallow `no such table`, so `rule trace` silently returns empty forever. Add `0002_spur_cli_rule_history` (embedded + drizzle file), mirroring the 0001 inbox precedent. |

### P2 — Warnings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | evaluateVerbose reaches into private engine fields via lying casts | Correctness | `packages/app/src/services/rule-service.ts:451-458` | `(engine as unknown as {persistence: unknown}).persistence as undefined` reads private fields and builds a second engine. Pass `events` into `buildEngine` and construct one engine. |
| 4 | `applied_fix_count` always 0; Spur never stamps runId (R1.4/R2.5) | Correctness | `rule-service.ts:220,242`; engine.js:189 | Engine writes `appliedFixCount=0` with comment "set by the caller after applying fixes"; Spur applies fixes on a third bare engine and never updates the row. Stamp a Spur-generated runId into the engine and call `persistence.updateRunStatus` with the applied count after `applyFixes`. |
| 5 | `metadata_json` never populated — `--rule` filter/cwd not recorded (R2.5) | Correctness | `rule-service.ts:212-219` | Engine reads `runMeta['metadataJson']`; Spur never sets it. Pass bounded `metadataJson` (selected `--rule`, cwd). |
| 6 | No `--since` validation on `rule trace` (plan item 6) | Usability | `apps/cli/src/commands/rule.ts` trace action | Malformed dates silently string-compare in SQL and filter wrong. Reject non-ISO-parsable `--since` with exit 1. |
| 7 | CLI trace tests not hermetic — open real workspace DB | Correctness | `apps/cli/tests/commands/rule.test.ts` trace tests | `main(['rule','trace'])` opens `apps/cli/.spur/spur.db`; the "(no DB)" assertions pass only because of F2's missing tables. Pass `dbUrl: ':memory:'`/temp path; add run→trace e2e. |

### P3 — Info

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 8 | 03_ARCHITECTURE places rule DAOs in nonexistent `apps/cli/src/db/` | Usability | `docs/03_ARCHITECTURE.md:101-103` | New DAOs live in `packages/domain/src/dao/rule-run-dao.ts`; correct the layout text instead of extending a stale entry. |
| 9 | Missing tests required by task Testing section | Correctness | `packages/app/tests/`, `apps/cli/tests/` | No traceList/traceDetail service tests; no CLI e2e (run→trace), no detail/--json-detail via main(), no invalid `--last`, no malformed `--since` tests. |

### P4 — Suggestions

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 10 | `require()` instead of ES import in formatter tests | Usability | `apps/cli/tests/commands/rule.test.ts:271,335` | Import `formatTraceList`/`formatTraceDetail` at top with the other imports. |
| 11 | Inline `JSON.stringify(x, null, 2)` bypasses `toJson` helper; `byId` returns null while typed `undefined` | Usability | `apps/cli/src/commands/rule.ts`; `packages/domain/src/dao/rule-run-dao.ts:76` | Use `toJson` like every other command; normalize `?? undefined` in `byId` so runtime matches the signature. |

### Requirements traceability (Phase 8)

| Req | Verdict | Evidence / gap |
|-----|---------|----------------|
| R1.1 schema SQL export | PARTIAL | Exists in local store (`dist/persistence/schema.js`, 3× IF NOT EXISTS); absent from registry 0.3.14 tarball |
| R1.2 adapter contract + Db/Memory impls | PARTIAL | `DbRulePersistenceAdapter`/`MemoryRulePersistenceAdapter` exported locally only |
| R1.3 direct adapter writes (not EventBus) | PARTIAL | engine.js:64 `persistence.insertRun(...)` direct call; unreleased |
| R1.4 caller-provided runId, Spur stamps it | PARTIAL | engine.d.ts:21 `runId?` supported; Spur `buildEngine` passes none (F4) |
| R1.5 incremental persistence during run | PARTIAL | insertRun before evals + per-rule updateEvalRun (engine.js); unverifiable vs published pkg |
| R1.6 release + catalog bump, no links | **UNMET** | Registry 0.3.14 lacks the seam; local store diverges from registry (F1) |
| R2.1 evaluate() injects persistence + metadata | MET | `rule-service.ts:211-220 buildEngine(runMeta)` |
| R2.2 preserve run behavior/output | MET | 553 tests pass incl. existing run-mode suites |
| R2.3 status semantics done/failed | PARTIAL | engine.js:189 writes 'done'; failure path untested in Spur |
| R2.4 bounded findings/fixes JSON | MET | engine persists result DTO JSON only |
| R2.5 full run metadata | PARTIAL | metadata_json never set; `--rule`/cwd missing; applied_fix_count always 0 (F4, F5) |
| R3.1 no-arg list, default last 20 | MET | `rule.ts` default '20'; DAO `ORDER BY started_at DESC LIMIT` |
| R3.2 filters preset/status/since/last | PARTIAL | All filter; `--since` unvalidated (F6) |
| R3.3 run-id detail with eval rows in order | MET | `RuleService.traceDetail`; `rule-run-dao.ts:107 ORDER BY started_at` |
| R3.4 plain output mirrors workflow trace | MET | `formatTraceList`/`formatTraceDetail` |
| R3.5 --json stable DTOs | MET | Raw-row DTOs consistent with `workflow trace` (`run-dao.ts traceRows`) |
| R3.6 missing run id → error + exit 1 | MET | `rule-service.ts traceDetail` throws 'Run not found'; CLI sets exit 1 (untested, F9) |
| R4.1 domain DAOs | MET | `packages/domain/src/dao/rule-run-dao.ts` |
| R4.2 app-layer trace methods, thin CLI | MET | `RuleService.traceList/traceDetail` |
| R4.3 CLI imports app/domain DTOs only | MET | `rule.ts` imports from `@gobing-ai/spur-app` |
| R4.4 no artifacts under .spur/rules | MET | No such writes |
| R5.1 04_DESIGN updated | MET | trace section rewritten |
| R5.2 03_ARCHITECTURE accurate | PARTIAL | Updated but places DAOs in nonexistent CLI `db/` (F8) |
| R5.3 upstream README documents contracts | PARTIAL | Unverifiable from Spur; blocked on release |
| R5.4 grammar stable | MET | No grammar change |
| R6 gates | PARTIAL | lint/test/test-cf/build pass locally only (F1); `tasks check 0040` pending |

---

**Fix-pass 2026-06-11T14:55 (–08:00):** 10 fixed, 1 skipped (F1).

| F# | Action | Result |
|----|--------|--------|
| F1 | Upstream release | **SKIPPED — blocked on release.** Deeper diagnosis: the project `.bun` store entry "0.3.14+ff341c5bfed10990" is a poisoned **intermediate** local build — it exports `DbRulePersistenceAdapter`/`RULE_ENGINE_SCHEMA_SQL` (so lint/tsc pass) but its `RuleEngine` constructor **silently ignores** `persistence`/`runId`/`runMeta` → `spur rule run` persists nothing even locally. The root `node_modules/@gobing-ai/ts-rule-engine` is a stale bun link to `~/xprojects/ts-libs/packages/rule-engine` (fully wired, v0.3.15, **uncommitted+unpublished**) which masked this during inspection. Registry 0.3.14 has no persistence at all. Close-out: commit+gate ts-libs rule-engine, publish 0.3.15, bump root catalog to ^0.3.15, `bun install`, remove the stale root link; the two red regression tests below then go green. |
| F2 | Added `0002_spur_cli_rule_history` migration (embedded `CLI_MIGRATIONS` + `drizzle/0002_spur_cli_rule_history.sql`), regression test simulating a pre-0040 DB | FIXED |
| F3 | `evaluateVerbose` now receives `engineOptions` and constructs one engine with `events`; private-field casts removed | FIXED |
| F4 | Spur stamps `runId` (`createId('rule')`); after `applyFixes` (non-dry-run) re-stamps `applied_fix_count` via `persistence.updateRunStatus` using the engine-written row | FIXED |
| F5 | `runMeta.metadataJson` now records `cwd` + selected `--rule` | FIXED |
| F6 | `--since` validated (`Date.parse`), exit 1 with clear message | FIXED |
| F7 | Trace CLI tests hermetic (`dbUrl: ':memory:'`/temp file); run→trace e2e added | FIXED (e2e red by design, see F1) |
| F8 | `03_ARCHITECTURE.md` corrected: DAOs/migrations/analytics live in `packages/domain`, stale CLI `db/` entry removed | FIXED |
| F9 | Added app-layer `traceList`/`traceDetail` tests (order/limit/filters/missing-id/no-DB) + CLI invalid `--last`, malformed `--since`, unknown-run-id tests | FIXED |
| F10 | `require()` → top-level ES imports in formatter tests | FIXED |
| F11 | `toJson` helper used for trace JSON; `byId` normalizes `null → undefined` | FIXED |

**Gate (post-fix):** `bun run lint` ✅ · `bun run test-cf` ✅ · `bun run build` ✅ · `bun run test` **564 pass / 2 fail** — the 2 failures are deliberate behavioral regression tests (`rule run persists a run that trace lists and details`, `evaluate() persists a finalized run row…`) that MUST stay red until the released engine actually persists (cerebrum do-not-repeat 2026-06-11). Do not skip or weaken them.

**Post-fix verdict: FAIL (blocked on upstream release).** R1.6 unmet; R1.1–R1.5/R2.3 unverifiable against a published package. All Spur-side findings resolved. Task stays In Progress.


### P1 — Blockers

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Unreleased engine masquerading as published 0.3.14 (R1.6 unmet) | Correctness | `node_modules/.bun/@gobing-ai+ts-rule-engine@0.3.14+ff341c5bfed10990` vs registry tarball | Registry `ts-rule-engine@0.3.14` (published 2026-06-11T20:20Z) has NO `persistence/` module, no `DbRulePersistenceAdapter`, no `RULE_ENGINE_SCHEMA_SQL`; the local `.bun` store content does. Fresh `bun install` breaks compile in CI. Release ts-libs rule-engine (0.3.15+), bump root catalog, reinstall from registry. NOT auto-fixable from this repo (requires npm publish in ~/xprojects/ts-libs). |
| 2 | Existing DBs never get rule history tables — silent no-op trace | Correctness | `packages/domain/src/migrations.ts:59-62`, `drizzle/` | `RULE_ENGINE_SCHEMA_SQL` folded only into `0000_spur_cli_foundation`, which the `__spur_cli_migrations` journal marks applied on every existing DB; no incremental migration added and `drizzle/*.sql` not regenerated. DAOs swallow `no such table`, so `rule trace` silently returns empty forever. Add `0002_spur_cli_rule_history` (embedded + drizzle file), mirroring the 0001 inbox precedent. |

### P2 — Warnings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 3 | evaluateVerbose reaches into private engine fields via lying casts | Correctness | `packages/app/src/services/rule-service.ts:451-458` | `(engine as unknown as {persistence: unknown}).persistence as undefined` reads private fields and builds a second engine. Pass `events` into `buildEngine` and construct one engine. |
| 4 | `applied_fix_count` always 0; Spur never stamps runId (R1.4/R2.5) | Correctness | `rule-service.ts:220,242`; engine.js:189 | Engine writes `appliedFixCount=0` with comment "set by the caller after applying fixes"; Spur applies fixes on a third bare engine and never updates the row. Stamp a Spur-generated runId into the engine and call `persistence.updateRunStatus` with the applied count after `applyFixes`. |
| 5 | `metadata_json` never populated — `--rule` filter/cwd not recorded (R2.5) | Correctness | `rule-service.ts:212-219` | Engine reads `runMeta['metadataJson']`; Spur never sets it. Pass bounded `metadataJson` (selected `--rule`, cwd). |
| 6 | No `--since` validation on `rule trace` (plan item 6) | Usability | `apps/cli/src/commands/rule.ts` trace action | Malformed dates silently string-compare in SQL and filter wrong. Reject non-ISO-parsable `--since` with exit 1. |
| 7 | CLI trace tests not hermetic — open real workspace DB | Correctness | `apps/cli/tests/commands/rule.test.ts` trace tests | `main(['rule','trace'])` opens `apps/cli/.spur/spur.db`; the "(no DB)" assertions pass only because of F2's missing tables. Pass `dbUrl: ':memory:'`/temp path; add run→trace e2e. |

### P3 — Info

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 8 | 03_ARCHITECTURE places rule DAOs in nonexistent `apps/cli/src/db/` | Usability | `docs/03_ARCHITECTURE.md:101-103` | New DAOs live in `packages/domain/src/dao/rule-run-dao.ts`; correct the layout text instead of extending a stale entry. |
| 9 | Missing tests required by task Testing section | Correctness | `packages/app/tests/`, `apps/cli/tests/` | No traceList/traceDetail service tests; no CLI e2e (run→trace), no detail/--json-detail via main(), no invalid `--last`, no malformed `--since` tests. |

### P4 — Suggestions

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 10 | `require()` instead of ES import in formatter tests | Usability | `apps/cli/tests/commands/rule.test.ts:271,335` | Import `formatTraceList`/`formatTraceDetail` at top with the other imports. |
| 11 | Inline `JSON.stringify(x, null, 2)` bypasses `toJson` helper; `byId` returns null while typed `undefined` | Usability | `apps/cli/src/commands/rule.ts`; `packages/domain/src/dao/rule-run-dao.ts:76` | Use `toJson` like every other command; normalize `?? undefined` in `byId` so runtime matches the signature. |

### Requirements traceability (Phase 8)

| Req | Verdict | Evidence / gap |
|-----|---------|----------------|
| R1.1 schema SQL export | PARTIAL | Exists in local store (`dist/persistence/schema.js`, 3× IF NOT EXISTS); absent from registry 0.3.14 tarball |
| R1.2 adapter contract + Db/Memory impls | PARTIAL | `DbRulePersistenceAdapter`/`MemoryRulePersistenceAdapter` exported locally only |
| R1.3 direct adapter writes (not EventBus) | PARTIAL | engine.js:64 `persistence.insertRun(...)` direct call; unreleased |
| R1.4 caller-provided runId, Spur stamps it | PARTIAL | engine.d.ts:21 `runId?` supported; Spur `buildEngine` passes none (F4) |
| R1.5 incremental persistence during run | PARTIAL | insertRun before evals + per-rule updateEvalRun (engine.js); unverifiable vs published pkg |
| R1.6 release + catalog bump, no links | **UNMET** | Registry 0.3.14 lacks the seam; local store diverges from registry (F1) |
| R2.1 evaluate() injects persistence + metadata | MET | `rule-service.ts:211-220 buildEngine(runMeta)` |
| R2.2 preserve run behavior/output | MET | 553 tests pass incl. existing run-mode suites |
| R2.3 status semantics done/failed | PARTIAL | engine.js:189 writes 'done'; failure path untested in Spur |
| R2.4 bounded findings/fixes JSON | MET | engine persists result DTO JSON only |
| R2.5 full run metadata | PARTIAL | metadata_json never set; `--rule`/cwd missing; applied_fix_count always 0 (F4, F5) |
| R3.1 no-arg list, default last 20 | MET | `rule.ts` default '20'; DAO `ORDER BY started_at DESC LIMIT` |
| R3.2 filters preset/status/since/last | PARTIAL | All filter; `--since` unvalidated (F6) |
| R3.3 run-id detail with eval rows in order | MET | `RuleService.traceDetail`; `rule-run-dao.ts:107 ORDER BY started_at` |
| R3.4 plain output mirrors workflow trace | MET | `formatTraceList`/`formatTraceDetail` |
| R3.5 --json stable DTOs | MET | Raw-row DTOs consistent with `workflow trace` (`run-dao.ts traceRows`) |
| R3.6 missing run id → error + exit 1 | MET | `rule-service.ts traceDetail` throws 'Run not found'; CLI sets exit 1 (untested, F9) |
| R4.1 domain DAOs | MET | `packages/domain/src/dao/rule-run-dao.ts` |
| R4.2 app-layer trace methods, thin CLI | MET | `RuleService.traceList/traceDetail` |
| R4.3 CLI imports app/domain DTOs only | MET | `rule.ts` imports from `@gobing-ai/spur-app` |
| R4.4 no artifacts under .spur/rules | MET | No such writes |
| R5.1 04_DESIGN updated | MET | trace section rewritten |
| R5.2 03_ARCHITECTURE accurate | PARTIAL | Updated but places DAOs in nonexistent CLI `db/` (F8) |
| R5.3 upstream README documents contracts | PARTIAL | Unverifiable from Spur; blocked on release |
| R5.4 grammar stable | MET | No grammar change |
| R6 gates | PARTIAL | lint/test/test-cf/build pass locally only (F1); `tasks check 0040` pending |


### Testing

- Upstream rule-engine tests:
  - schema creates `rule_runs` and `rule_eval_runs`.
  - run row is inserted as `running` before evaluations and finalized as `done`/`failed`.
  - per-rule rows record finding/fix counts, timings, and evaluator errors.
  - stop-on-first records executed rules and does not pretend skipped rules ran.
  - fix-mode `suggest` and `auto` record collected/applied fix counts; `dry-run` records no applied writes.
  - memory adapter mirrors DB adapter behavior for unit tests.
- Spur domain/app tests:
  - `trace({})` returns recent rule runs newest first with default limit 20.
  - filters by `preset`, `status`, `since`, and `last`.
  - `trace(runId)` returns run summary plus per-rule evaluation rows ordered by `created_at`.
  - missing run id throws a clear `Run not found` error.
  - old DBs without rule history tables degrade only where intentionally supported; unrelated DB errors rethrow.
- CLI tests:
  - `spur rule run --preset <x>` followed by `spur rule trace` lists the run.
  - `spur rule trace <run-id>` shows per-rule details.
  - `--json` list and detail return structured DTOs.
  - invalid `--status`, invalid `--last`, and malformed `--since` exit 1 with clear messages.
  - existing placeholder tests are removed or rewritten to assert real data.
- Gate:
  - `bun run lint`
  - `bun run test`
  - `bun run test-cf`
  - `bun run build`
  - `tasks check 0040`


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- Task 0038: `spur rule trace` placeholder and alignment decision that rule persistence goes upstream.
- Task 0039: workflow-engine action persistence and `workflow trace` action-line integration pattern.
- `apps/cli/src/commands/rule.ts`: current placeholder command and flag grammar.
- `packages/app/src/services/rule-service.ts`: current rule run boundary and existing EventBus verbose wiring.
- `packages/domain/src/dao/run-dao.ts`, `phase-run-dao.ts`, `transition-run-dao.ts`, `action-run-dao.ts`: workflow trace DAO shape to mirror.
- `docs/04_DESIGN.md`: CLI surface SSOT; update when placeholder becomes real.
- Published `@gobing-ai/ts-rule-engine@0.3.14`: verified to lack a persistence seam as of task creation.

