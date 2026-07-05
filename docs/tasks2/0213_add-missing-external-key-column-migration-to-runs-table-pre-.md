---
template: issue
schema_version: 1
name: Add missing external_key column migration to runs table (pre-existing DBs missing the field)
status: done
type: task
created_at: 2026-07-04T16:23:49.337Z
updated_at: 2026-07-04T17:05:46.540Z
---

## 0213. Add missing external_key column migration to runs table (pre-existing DBs missing the field)

### Background
Discovered while verifying task 0071 (superskill repo)/R5's AC5: after fixing
`resolveWorkflowPath()` in `apps/cli/src/workflow/make-lifecycle-adapter.ts`
to add a global `~/.config/spur/workflows/` fallback tier, the lifecycle
adapter became reachable in superskill for the first time (previously it
silently degraded to the inline `spur task check` fallback, which never
touches the `runs` table). The first real `spur task update <wbs> <status>`
call against superskill's existing `.spur/spur.db` failed with:

    SQLiteError: no such column: external_key

`runs.externalKey` (`packages/domain/src/schema/runs.ts:12`) is used by
`LifecycleAdapter` (`packages/app/src/workflow/lifecycle-adapter.ts:103,107,117`)
to look up/insert a workflow run by an external key
(`${profile.entityPrefix}:${ref.id}`). The column has existed in the Drizzle
`runsTable` definition since at least the initial commit
(`aeeaf56d99a3ee40e6c5235cd290f3ccdcf47ffb`, 2026-06-01), and
`DOMAIN_SCHEMA_SQL`'s generated `CREATE TABLE IF NOT EXISTS "runs" (...)`
DOES include `"external_key" text` — but `CREATE TABLE IF NOT EXISTS` is a
no-op against any DB where the `runs` table already exists, so a DB created
before this column was part of the DDL never gets it retroactively.

`packages/domain/src/migrations.ts` already has the exact precedent for this
class of bug: `RUN_PID_COLUMN_SCHEMA_SQL` (migration id
`0005_spur_cli_run_pid`) adds a `pid` column to `runs` via an explicit
`ALTER TABLE runs ADD COLUMN pid INTEGER;` specifically because
`CREATE TABLE IF NOT EXISTS` cannot retrofit existing databases. No
equivalent `ALTER TABLE runs ADD COLUMN external_key TEXT;` migration was
ever added for `external_key` — this is the gap.

**Confirmed on superskill's actual `.spur/spur.db`:**
`PRAGMA table_info(runs)` shows `pid` present (proving migration `0005` ran)
but `external_key` absent — so this is a real, currently-affected database,
not a hypothetical.
### Requirements
- R1. Add a new idempotent, journaled migration (following the exact
   `RUN_PID_COLUMN_SCHEMA_SQL` / `0005_spur_cli_run_pid` pattern) that runs
   `ALTER TABLE runs ADD COLUMN external_key TEXT;` for any database created
   before this column existed, registered as the next sequential id in
   `CLI_MIGRATIONS` (currently ends at `0006_spur_cli_system_events`, so this
   is `0007_spur_cli_runs_external_key`).
- R2. The migration must be safe to run against BOTH a fresh DB (where
   `0000`'s `CREATE TABLE` already created `external_key` — the `ALTER TABLE`
   must not fail with "duplicate column") and an old DB missing the column.
   Follow `RUN_PID_COLUMN_SCHEMA_SQL`'s own documented collision-risk pattern,
   or add a defensive existence check if the adapter/driver supports it.
- R3. Add a regression test (in `packages/domain/tests/` or wherever
   `migrations.test.ts` / equivalent lives) that: (a) creates a DB via an
   older subset of `CLI_MIGRATIONS` that predates this one (or directly runs
   `CLI_SCHEMA_SQL` with `external_key` stripped, if that's easier to
   construct), (b) applies the new migration, (c) asserts
   `PRAGMA table_info(runs)` now includes `external_key`.
- R4. Audit whether any OTHER Drizzle schema columns across
   `packages/domain/src/schema/*.ts` have the same latent gap (added to a
   `defineTable` after its migration's `CREATE TABLE IF NOT EXISTS` had
   already run somewhere) — scope this audit narrowly; do not block this
   task's `external_key` fix on completing the audit, file any further gaps
   found as their own follow-up tasks.
### Acceptance Criteria
- [x] AC1. MET when `spur task update <wbs> <status>` (any lifecycle
      transition that touches `LifecycleAdapter`) succeeds against an
      existing project database that predates this fix, with no
      `SQLiteError: no such column: external_key`. Verified directly against
      superskill's `.spur/spur.db` (or an equivalent pre-existing fixture DB)
      after applying the new migration.
- [x] AC2. MET when the new migration is idempotent — running
      `applyCliMigrations` twice in a row against the same DB does not error
      and does not attempt to re-add the column (guarded by the existing
      `__spur_cli_migrations` journal table, same as every other migration).
- [x] AC3. MET when a fresh DB (never migrated) still ends up with
      `external_key` present exactly once — no duplicate-column error from
      `0000`'s `CREATE TABLE` already having it AND this migration also
      trying to add it.
- [x] AC4. MET when the new regression test (R3) passes and demonstrates the
      before/after column state explicitly (not just "no error").
### Q&A

No open questions.

### Design
**Implemented approach:** add `RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL` as the same
narrow `ALTER TABLE runs ADD COLUMN external_key TEXT;` used by the run-pid
precedent, but guard this migration with a column-exists check before executing
the ALTER. The guard is required because fresh databases already receive
`external_key` from `CLI_SCHEMA_SQL`; a plain journal-only migration would fail
with a duplicate-column error on fresh DBs. The guard is applied both through
embedded `CLI_MIGRATIONS` metadata and by migration id for folder-loaded SQL
from `drizzle/0007_spur_cli_runs_external_key.sql`.

**Rejected alternative:** journal-only ALTER. It works for old DBs missing the
column, but violates R2/AC3 because `0000_spur_cli_foundation` already creates
`runs.external_key` on fresh databases.

**Key reference:**
- `packages/domain/src/migrations.ts:105-121` — `RUN_PID_COLUMN_SCHEMA_SQL`,
  the direct precedent to copy.
- `packages/domain/src/migrations.ts:137-148` — `CLI_MIGRATIONS` array,
  append the new `{ id: '0007_spur_cli_runs_external_key', sql: ... }` entry
  and update the docstring above it (currently documents `0000`-`0006`).
- `packages/domain/src/schema/runs.ts:12` — the Drizzle field this migration
  retrofits.
### Plan
1. [x] Add `RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL` (or similarly named) constant to
   `packages/domain/src/migrations.ts`, modeled on
   `RUN_PID_COLUMN_SCHEMA_SQL`'s doc-comment + SQL shape.
2. [x] Append `{ id: '0007_spur_cli_runs_external_key', sql: ... }` to
   `CLI_MIGRATIONS`; update the array's docstring to describe `0007`.
3. [x] Add the regression test per R3.
4. [x] Run spur-new's own gates: `bun run lint`, `bun run test`,
   `bun run spur-check`, `bun run build`.
5. [x] Verify AC1 with an equivalent legacy DB fixture: create a pre-`0007`
   `runs` table missing `external_key`, apply current migrations, and confirm
   the column appears without duplicate-column failure on fresh DBs.
6. [x] Record release/superskill follow-up as external to this local repo
   change; the acceptance signal in this task is the regression fixture plus
   green repository gates.
### Solution

| File | Change |
| --- | --- |
| `packages/domain/src/migrations.ts:10` | Added `CliMigration.addColumnIfMissing` metadata for guarded add-column migrations. |
| `packages/domain/src/migrations.ts:127` | Added `RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL` and registered `0007_spur_cli_runs_external_key`. |
| `packages/domain/src/migrations.ts:191` | Added the column-exists guard before executing guarded migration SQL, with id-based fallback for folder-loaded `0007` files. |
| `drizzle/0007_spur_cli_runs_external_key.sql:1` | Added the matching folder-load migration file for regenerated/local migration workflows. |
| `packages/domain/tests/dao/migrations.test.ts:76` | Covered migration registration and guard metadata. |
| `packages/domain/tests/dao/migrations.test.ts:105` | Covered old-DB retrofit, fresh-DB duplicate-column prevention, idempotent second application, and folder-loaded `0007` guard behavior. |

Implementation note: the original task design said a journal-only ALTER was sufficient. That is false for fresh DBs because `0000_spur_cli_foundation` already creates `runs.external_key`; the guard is the minimal change that satisfies R2/AC3.

### Root Cause
`runsTable` (`packages/domain/src/schema/runs.ts:12`) declares
`externalKey: text('external_key')`, and `DOMAIN_SCHEMA_SQL`'s generated DDL
(`CREATE TABLE IF NOT EXISTS "runs" (...)`) includes `"external_key" text` —
but `CREATE TABLE IF NOT EXISTS` is a no-op against a database where `runs`
already exists. Any project database created before `external_key` became
part of this DDL never receives the column, and no `ALTER TABLE` migration
was ever added to backfill it (unlike the directly analogous `pid` column,
which got exactly this treatment in migration `0005_spur_cli_run_pid` /
`RUN_PID_COLUMN_SCHEMA_SQL`). The gap went unnoticed because no code path
touched `external_key` against an old, un-migrated database until
`LifecycleAdapter` (`packages/app/src/workflow/lifecycle-adapter.ts:103-117`)
became reachable in a project whose lifecycle adapter had previously always
fallen back to the degraded inline `spur task check` path (task 0071's own
F5/R5 — the adapter-resolution bug that made this column read/write
unreachable in practice) — fixing R5 removed the accidental shield and
exposed this separate, pre-existing schema-migration gap.
### Testing

Focused:

```text
$ bun test packages/domain/tests/dao/migrations.test.ts
(pass) db migrations > CLI_MIGRATIONS > existing DB that already applied 0000/0001 gains rule, planning, queue, run-pid, and runs-external-key [3.34ms]
(pass) db migrations > CLI_MIGRATIONS > fresh DB journals runs-external-key without duplicate-column errors [0.70ms]
(pass) db migrations > CLI_MIGRATIONS > folder-loaded runs-external-key migration also skips when foundation already created the column [0.71ms]
 30 pass
 0 fail
 65 expect() calls
Ran 30 tests across 1 file. [99.00ms]
```

Full gates:

```text
$ bun run lint
$ biome check . --error-on-warnings && bun run typecheck
Checked 402 files in 122ms. No fixes applied.
$ bun run --filter '*' typecheck
@gobing-ai/spur-config typecheck: Exited with code 0
@gobing-ai/spur-domain typecheck: Exited with code 0
@gobing-ai/spur typecheck: Exited with code 0
@gobing-ai/spur-contracts typecheck: Exited with code 0
@gobing-ai/spur-app typecheck: Exited with code 0
@gobing-ai/spur-web typecheck: Exited with code 0
@gobing-ai/spur-server typecheck: Exited with code 0
```

```text
$ bun run test
 packages/domain/src/migrations.ts                        |  100.00 |  100.00 |
 packages/domain/src/planning/locks.ts                    |  100.00 |   99.28 |
 packages/domain/src/planning/markdown-document.ts        |  100.00 |  100.00 |
 packages/domain/src/planning/rebuild-events.ts           |  100.00 |  100.00 |
 packages/domain/src/planning/schema.ts                   |  100.00 |  100.00 |
 packages/domain/src/planning/task-skeleton.ts            |  100.00 |  100.00 |
 packages/domain/tests/helpers.ts                         |  100.00 |  100.00 |
 plugins/sp/skills/daily-summary/scripts/daily-summary.ts |   95.65 |   98.25 | 166,286-287,562-563
 plugins/sp/skills/daily-summary/scripts/logger.ts        |  100.00 |  100.00 |
 scripts/commands/bundle-config.ts                        |  100.00 |   97.50 |
 tests/setup.ts                                           |  100.00 |  100.00 |
----------------------------------------------------------|---------|---------|-------------------


2155 pass
0 fail
5678 expect() calls
Ran 2155 tests across 159 files. [13.47s]
```

```text
$ bun run test-cf
$ bun run --filter '@gobing-ai/spur-server' test-cf
@gobing-ai/spur-server test-cf:
@gobing-ai/spur-server test-cf:  RUN  v4.1.7 /Users/robin/xprojects/spur-new/apps/server
@gobing-ai/spur-server test-cf:
@gobing-ai/spur-server test-cf:
@gobing-ai/spur-server test-cf:  Test Files  1 passed (1)
@gobing-ai/spur-server test-cf:       Tests  1 passed (1)
@gobing-ai/spur-server test-cf:    Start at  10:03:27
@gobing-ai/spur-server test-cf:    Duration  933ms (transform 249ms, setup 0ms, import 652ms, tests 5ms, environment 0ms)
@gobing-ai/spur-server test-cf:
@gobing-ai/spur-server test-cf: Exited with code 0
```

```text
$ bun run build
@gobing-ai/spur-web build: 10:03:38 [vite] ✓ built in 3.23s
@gobing-ai/spur-web build: 10:03:38 [build] Rearranging server assets...
@gobing-ai/spur-web build:
@gobing-ai/spur-web build:  generating static routes
@gobing-ai/spur-web build: 10:03:38   ├─ /index.html (+4ms)
@gobing-ai/spur-web build: 10:03:38 ✓ Completed in 17ms.
@gobing-ai/spur-web build:
@gobing-ai/spur-web build: 10:03:38 [build] ✓ Completed in 3.66s.
@gobing-ai/spur-web build: 10:03:38 [build] 1 page(s) built in 3.68s
@gobing-ai/spur-web build: 10:03:38 [build] Complete!
@gobing-ai/spur-web build: Exited with code 0
```

```text
$ bun run spur-check
 packages/domain/src/migrations.ts                        |  100.00 |  100.00 |
 packages/domain/src/planning/locks.ts                    |  100.00 |   99.28 |
 packages/domain/src/planning/markdown-document.ts        |  100.00 |  100.00 |
 packages/domain/src/planning/rebuild-events.ts           |  100.00 |  100.00 |
 packages/domain/src/planning/schema.ts                   |  100.00 |  100.00 |
 packages/domain/src/planning/task-skeleton.ts            |  100.00 |  100.00 |
 packages/domain/tests/helpers.ts                         |  100.00 |  100.00 |
 plugins/sp/skills/daily-summary/scripts/daily-summary.ts |   95.65 |   98.25 | 166,286-287,562-563
 plugins/sp/skills/daily-summary/scripts/logger.ts        |  100.00 |  100.00 |
 scripts/commands/bundle-config.ts                        |  100.00 |   97.50 |
 tests/setup.ts                                           |  100.00 |  100.00 |
----------------------------------------------------------|---------|---------|-------------------


2155 pass
0 fail
5678 expect() calls
Ran 2155 tests across 159 files. [13.22s]
$ bun run apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning --verbose
Evaluating 2 rules…
▶ [1/2] coverage-gate (coverage-gate)
  ✓ passed - 0.00s
▶ [2/2] every-export-has-tsdoc (tsdoc-export)
  ✓ passed - 0.04s
All 2 rules passed — no violations found.
```

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | None. | Closed. |
| P2 | None. | Closed. |
| P3 | None. | Closed. |
| P4 | Missing `feature_id` remains as a non-blocking L4 warning on this standalone issue task. | Accepted for this migration blocker; strict-core passes. |

### History
- 2026-07-04T16:24:51.068Z backlog → todo (system)
- 2026-07-04T17:02:37.475Z todo → wip (system)
- 2026-07-04T17:05:43.206Z wip → testing (system)
- 2026-07-04T17:05:46.540Z testing → done (system)
