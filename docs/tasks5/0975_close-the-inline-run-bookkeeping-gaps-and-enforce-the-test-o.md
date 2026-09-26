---
schema_version: 1
name: Close the inline-run bookkeeping gaps and enforce the test-only subpath invariant
status: done
template: issue
created_at: 2026-09-26T16:02:38.308Z
updated_at: "2026-09-26T23:13:08.609Z"

feature_id: I31
ac_altitude: task-local
---

## 0975. Close the inline-run bookkeeping gaps and enforce the test-only subpath invariant

### Background

Surfaced by the 0961 worktree run (`dev-run 0961 --auto --next --agent inline --worktree`, run `inline-20260926T050316Z-9a4ab2d5`) and filed through `/sp:dev-review-session`. On 2026-09-26 each original finding was triaged against the code and against open tasks 0958 and 0964–0976. Verdicts:

| Finding | Verdict | Disposition |
| --- | --- | --- |
| F1: `--worktree` provenance destroyed on success | **Valid, partly new.** Record-file loss is a known gap with a prose-only mandate: `execution-batch.md` "Evidence persistence" (0720 R3) and "Stage records are worktree-local too" (0948 R9) already require copy-out, but no step does it. DB-row loss is uncovered anywhere. 0976 independently reproduced it. | **Kept → R1.** Redesigned; see Design. |
| F2: zero `action_runs` rows for a whole run | **Valid.** The writer exists (0868/0879/0914) and the driver contract requires it (`inline-pipeline-driver.md` "Every executed action"); the host agent simply never called `--action`. Prose was ignored, and nothing detects it. | **Kept → R2.** Reframed from "emit" (already specified) to deterministic detection at `--close`. |
| F3: proof-capture ordering vs completion-box ticking | **Valid, but duplicate.** Root cause is that checkbox state participates in the proof digest. **0958 Defect B** (R3/R4/AC5) fixes exactly that by canonicalizing checkbox markers in `extractTaskProofData`/`extractFeatureProofData` (`packages/app/src/workflow/proof-input-fingerprint.ts`), which makes ordering irrelevant. The original R3 (reorder capture or add a fail-closed precheck) contradicts 0958's closed Q&A "No pipeline YAML change". | **Removed.** Owned by 0958. |
| F4: `src/testing/` import invariant unenforced | **Valid, unique.** `rg -n "testing" config/rules` finds no rule, so the invariant 0961 established (`packages/app/package.json` `"./testing"` subpath) is protected only by that task's ad hoc `rg` AC. | **Kept → R3.** Precedent corrected to `boundary/dao-boundary.yaml` (a `forbidden-import` rule), not `structure/test-location.yaml` (a file-location rule). |

None of 0964–0974 overlaps F1, F2 or F4. 0976 points here for F1/F2 and to 0958 for F3.

**F1 mechanics.** `plugins/sp/scripts/inline-run-setup.ts:424` opens `openInlineRunProjectDb(process.cwd())`, and `packages/app/src/services/inline-run-setup.ts:133` resolves that to `<cwd>/.spur/spur.db`. Inside a worktree this is the worktree's own gitignored DB. WT-2 does not seed it, so it starts empty and holds only rows this run created. The run record is written by `writeOutcome` (`plugins/sp/scripts/inline-run-setup.ts:211-212`) under `<cwd>/.spur/run/`. WT-4 create mode (`execution-batch.md` § WT-4) removes the worktree after the FF-merge. After 0961's teardown, `spur workflow progress inline-20260926T050316Z-9a4ab2d5 --json` → `Run … not found.`, and `.spur/run/inline-20260926T050316Z-9a4ab2d5.md` is absent from the invoking tree. A *failed* run retains the tree (WT-5), so the success path is the only one that loses its audit trail.

**F2 mechanics.** `--action` is best-effort by design (ADR-117; exit 0 even on persistence failure). `--close` fails loudly, but only on a missing run row (`RUN_NOT_FOUND`, `plugins/sp/scripts/inline-run-setup.ts:459`). A run can therefore close `done` with zero action rows, and no gate notices. `ActionRunDao.actionRowsByRunId` (`packages/domain/src/dao/action-run-dao.ts:36`) already returns the rows needed to detect this.

### Requirements

- [x] R1. When a `--worktree` inline run succeeds, its provenance is persisted into the invoking tree before WT-4 removes the worktree. Two things must be copied:
  - every `runs` row in the worktree DB, together with its run-keyed child rows (`action_runs`, `transition_runs`, `phase_runs`, `workflow_states`), copied into the invoking tree's `.spur/spur.db`;
  - every run record (`.spur/run/<run-id>.md` and `.state.json`), copied into the invoking tree's `.spur/run/`.

  Persistence runs as a mechanical step, not prose. It is idempotent: a re-run leaves no duplicate rows and overwrites no existing invoking-tree row. A `runs` row whose `id` already exists, or whose `(workflow_name, external_key)` collides with the invoking tree's unique `idx_runs_external_key` (for example a `task-lifecycle` run keyed `task:<wbs>`), is skipped together with its children. It is reported in the output as `skipped[{id,reason}]` and is not a failure. It fails closed: any read, write or copy failure exits non-zero, and the lifecycle retains the worktree (WT-5).
- [x] R2. `--close --status done` detects a run that recorded zero `action_runs` rows. The run row is still finalized, so `spur workflow clean` never reaps it. The invocation then exits `1` with `{"ok":false,…,"code":"NO_ACTION_ROWS"}`. A successful close reports the row count (`{"ok":true,"actionRows":<n>}`). `--status failed|paused` with zero rows is not an error, because a run can halt before its first action.
- [x] R3. The test-only subpath invariant is enforced by an `error`-severity `forbidden-import` rule under `config/rules/boundary/`. The rule has two parts:
  - (a) any `@gobing-ai/spur-app/testing` import from `apps/*/src/**` or `packages/*/src/**` fails;
  - (b) any relative import of a `testing/` path from `packages/app/src/**` outside `packages/app/src/testing/**` fails.

  Tests (`**/tests/**`) stay out of scope. The rule is picked up by the `recommended-pre-check` preset through its `boundary` extend.

### Acceptance Criteria

- [x] AC1 — A successful `--worktree` inline run is queryable after teardown. `spur workflow progress <run-id> --json` in the invoking tree returns the run with status `done` and its per-action rows, and `.spur/run/<run-id>.md` plus `.state.json` exist there (req: R1)
- [x] AC2 — Persisting the same worktree twice leaves the invoking-tree row counts unchanged and does not modify a pre-existing invoking-tree row with the same id. A `task-lifecycle` run whose `external_key` already exists in the invoking tree is reported as `skipped` with reason `external-key-conflict`, and the command exits 0 (req: R1)
- [x] AC3 — A persistence failure (unreadable worktree DB, or an unwritable target) exits non-zero, and the documented WT-4 step routes to WT-5, which retains the worktree and branch (req: R1)
- [x] AC4 — `--close --status done` on a run with zero `action_runs` rows finalizes the row as `done` and exits 1 with `code:"NO_ACTION_ROWS"`. With ≥1 row it exits 0 and reports `actionRows`. With `--status failed` and zero rows it exits 0 (req: R2)
- [x] AC5 — `spur rule run` passes on the current tree and fails, naming the rule id, on a synthetic `packages/app/src/<x>.ts` importing `./testing/history-board-mock` and on a synthetic `apps/server/src/<x>.ts` importing `@gobing-ai/spur-app/testing`. Imports inside `packages/app/src/testing/**` and under `**/tests/**` stay clean (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-26T16:48:41.165Z

- **Q: Should the inline run write straight into the invoking tree's DB, which was the original F1 proposal?** **Closed: no.** Parallel worktree batches would all write one SQLite file concurrently. `--action` is best-effort, so a busy-lock loss would drop rows silently, and each tree's `.spur/run/` records would split across two trees. A single sequential persist-out at WT-4a keeps "one writer per working tree" and turns the existing 0720 R3/0948 R9 copy-out mandate into a mechanical step.
- **Q: Persist only the inline run's rows, or every run row?** **Closed: every run row.** The worktree DB starts empty (WT-2 seeds nothing under `.spur/`), so every row in it belongs to this worktree. That includes the `task-lifecycle` FSM runs created by `spur task update` inside the tree, which are lost the same way today. Tables not keyed to runs (for example `system_events` and history) are out of scope. Inline runs carry no `external_key` (`packages/app/src/services/inline-run-setup.ts:281`), so they never collide. Lifecycle runs are find-or-create by `task:<wbs>` (`packages/app/src/workflow/lifecycle-adapter.ts:141-199`) and often already exist in the invoking tree. Those are skipped and reported rather than re-parented, because the task file's committed status and History remain the lifecycle SSOT.
- **Q: Where does F3 (capture ordering) go?** **Closed: 0958 Defect B.** A checkbox-canonical proof digest removes the drift at its root. The original R3 (reorder capture or add a fail-closed precheck) contradicted 0958's closed "No pipeline YAML change" decision and is dropped.
- **Q: Should `--close` refuse to close a zero-row `done` run?** **Closed: close it, then fail.** A non-terminal row is the stale state `workflow clean` reaps as `failed`, which destroys evidence. Finalizing first and exiting 1 keeps the bookkeeping honest while making the trace gap loud. Retroactively fabricating rows is forbidden by ADR-117.
- **Q: Is this a public-surface change?** **Closed: no.** `--persist-out` is a mode of the internal plugin script `inline-run-setup.ts` (ADR-065), not a `spur` noun or verb.

### Design

**R1: mechanical persist-out at WT-4a, not a cross-tree writer.**

- **Domain (sole ts-db consumer, `config/rules/boundary/dao-boundary.yaml`).** Add a DAO-level transfer. Each run-table DAO (`packages/domain/src/dao/run-dao.ts`, `action-run-dao.ts`, `phase-run-dao.ts`, `transition-run-dao.ts`, `workflow-state-dao.ts`) gets whatever read-all and insert-if-absent method it lacks. One domain function then copies from a source adapter to a target adapter inside a single target transaction:
  1. For each source `runs` row, skip it with reason `id-exists` or `external-key-conflict` if the target already has its `id`, or already has its `(workflow_name, external_key)`.
  2. Otherwise insert it, then insert its child rows with `INSERT … ON CONFLICT DO NOTHING`.
  3. Return `{ persisted, skipped[] }`.
- **App.** Add `persistWorktreeRuns({ fromWorkdir, toWorkdir })` in `packages/app/src/services/inline-run-setup.ts`, next to `openInlineRunProjectDb`. It opens both DBs through `openInlineRunProjectDb` (same migrations and busy timeout), calls the domain transfer, and then copies each persisted run's `.spur/run/<id>.md` and `.state.json`. It never overwrites an existing target file with different bytes; that case is reported as skipped.
- **Plugin script.** Add a `--persist-out --from <worktree-path>` mode to `plugins/sp/scripts/inline-run-setup.ts`. It resolves the app through the existing dynamic `resolveAppEntry` (plugin standalone contract: no `@gobing-ai/*` value import) and runs with cwd set to the invoking tree. On success it prints `{"ok":true,"persisted":n,"skipped":[…]}` and exits 0. On any failure it prints `{"ok":false,"error":…}` and exits 1. Usage errors exit 2.
- **Docs.** In `plugins/sp/skills/spur-dev/references/execution-batch.md` § WT-4 create mode, add the `bun "$SETUP_SCRIPT" --persist-out --from "$WT_PATH"` call to the WT-4a block before WT-4b, with a non-zero exit routing to WT-5. Replace the two prose copy-out paragraphs' "must copy those records out" with a pointer to this step. Reuse mode is unchanged, because its tree survives. Single-task `dev-run --worktree` inherits WT-1…WT-6, so no separate edit is needed.

**R2: detect at close, don't fabricate.** Extend `closeRun` in `packages/app/src/workflow/action-trace.ts:284`:

1. Finalize the run row exactly as today.
2. Count rows through `ActionRunDao.actionRowsByRunId` (`packages/domain/src/dao/action-run-dao.ts:36`).
3. Return `{ ok: true, actionRows }`.

The script's `runTraceMode` (`plugins/sp/scripts/inline-run-setup.ts:397`) maps `status==='done' && actionRows===0` to exit 1 with `code:"NO_ACTION_ROWS"`, after the row is already terminal. Update the `--close` contract paragraph in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (around :515–538) to state the new failure. The driver must surface it in its final report and must not backfill rows.

**R3: a `forbidden-import` rule.** Add `config/rules/boundary/test-subpath-boundary.yaml`, shaped like `dao-boundary.yaml`/`ui/ui-import-boundary.yaml`, with two rules:

- **(a)** `{ specifier: "@gobing-ai/spur-app/testing" }`, scoped to `apps/*/src/**/*.{ts,tsx}` and `packages/*/src/**/*.ts`.
- **(b)** `{ pattern: "from\\s+['\"](\\.\\.?/)+(?:[^'\"]*/)?testing(?:/|['\"])" }`, scoped to `packages/app/src/**/*.ts` with `packages/app/src/testing/**` excluded.

The `specifier` form is an exact prefix match with a `/` or quote boundary (ts-rule-engine 0.5.7 `forbidden-import-evaluator.ts` `compileEntry`), so relative paths need the `pattern` form. Run `build:bundle` so `apps/cli/config/rules/` carries the copy.

**Rejected.**

- Writing the run row to the invoking tree's DB from inside the worktree. This breaks one-writer-per-tree for parallel batches and silently drops best-effort rows under lock contention; see Q&A.
- Refusing to close a zero-row run. That leaves a `running` row for `workflow clean` to reap as `failed`.
- A prose-only reminder for F2. Prose is what already failed.
- Reordering capture for F3, which 0958 owns.

### Plan

- [x] Domain: add the run-table transfer function and missing DAO methods, with an in-memory SQLite test covering persisted, `id-exists`, `external-key-conflict` and child-row idempotence.
- [x] App: add `persistWorktreeRuns` (DB transfer plus run-record copy) with a test using two temp workdirs.
- [x] Script: add the `--persist-out --from` mode to `plugins/sp/scripts/inline-run-setup.ts`, with tests for exit 0, exit 1 and exit 2 in `plugins/sp/tests/inline-run-setup.test.ts` (or a sibling). Regenerate the `.mjs` twin with `build:scripts`.
- [x] Docs: wire the call into `execution-batch.md` WT-4a and fold the two copy-out paragraphs into a pointer. Extend `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` to pin the step and its WT-5 routing.
- [x] R2: make `closeRun` return `actionRows`, make `runTraceMode` map a zero-row `done` close to `NO_ACTION_ROWS`, and update the driver doc's `--close` paragraph. Cover all three AC4 cases in `plugins/sp/tests/inline-run-trace.test.ts`.
- [x] R3: add `config/rules/boundary/test-subpath-boundary.yaml`. Run `spur rule validate`, then smoke both directions per `sp:rule-add` (a clean tree passes; two synthetic violations fail; remove the fixtures). Run `bun run --filter @gobing-ai/spur build:bundle`.
- [x] Acceptance smoke for AC1: one real `dev-run <small-wbs> --agent inline --worktree` to completion, then `spur workflow progress <run-id> --json` from the invoking tree.
- [x] Gates: `bun run spur-check`, `bun run plugin-smoke`, `git status --short`.
- [x] One commit: `fix(sp): persist inline --worktree run provenance, flag zero-action closes, enforce the test-only subpath (0975)`.

### Root Cause

- **R1 (F1):** the worktree's `.spur/` is gitignored and unseeded. `openInlineRunProjectDb(process.cwd())` (`plugins/sp/scripts/inline-run-setup.ts:424` → `packages/app/src/services/inline-run-setup.ts:133`) and `writeOutcome` (`plugins/sp/scripts/inline-run-setup.ts:211-212`) therefore place the run row and the run record in the tree that WT-4 create mode removes. The copy-out mandate (`plugins/sp/skills/spur-dev/references/execution-batch.md` "Evidence persistence" and "Stage records are worktree-local too") is prose with no executing step, and it does not mention DB rows at all.
- **R2 (F2):** `--action` is intentionally best-effort (ADR-117), and `--close` checks only that the run row exists (`plugins/sp/scripts/inline-run-setup.ts:434`, `:459`). No deterministic point compares "run reached done" against "run recorded ≥1 action", so a driver that skips every `--action` is invisible.
- **R3 (F4):** 0961 introduced the `./testing` subpath (`packages/app/package.json` exports) but added no rule. The only enforcement was an ad hoc `rg` AC in 0961.

### Solution

Implemented R1 (worktree provenance persist-out), R2 (`NO_ACTION_ROWS` done-close guard), and R3
(test-only subpath boundary rules). Deviation from the plan's step (1): the transfer is a single
domain module (`run-transfer.ts`, raw SQL through `DbAdapter.batch`) instead of per-DAO methods —
the copy is schema-shaped (`SELECT *` + column intersection), not entity-shaped, and one module
keeps the conflict policy (`id-exists` / `external-key-conflict`) in one place. Another deviation:
the domain transfer copies the column INTERSECTION of source/target — the engine's guarded ALTER
columns (`owner_attempt`/`owner_pid`/`interrupt_reason`) exist in an engine-touched worktree DB but
not yet in a freshly CLI-migrated invoking tree; dropping them unblocks the copy without
duplicating engine migration policy (found by the e2e persist-out test, not visible at DAO level).

#### R1 — worktree run persistence (AC1/AC2/AC3)

- `packages/domain/src/dao/run-transfer.ts:36` — `RunTransferResult`/`RunTransferSkipped`; `:72`
  `transferRunTables(from, to)`: id-conflict and `(workflow_name, external_key)` conflict checks
  via SELECT before insert; per-run children copied with `ON CONFLICT(id) DO NOTHING`; run +
  children commit as one `DbAdapter.batch` (half-copied runs impossible). Target rows never
  modified on skip (AC2).
- `packages/domain/src/dao/index.ts:63` — domain facade export.
- `packages/app/src/services/inline-run-setup.ts:168` — `persistWorktreeRuns`: opens both project
  DBs, transfers rows, then copies `.spur/run/<id>.md` + `.state.json` for persisted ids —
  identical bytes are an idempotent no-op, divergent invoking-tree records are skipped as
  `record-conflict:<file>` (never overwritten), a missing source record throws (fail-closed).
- `packages/app/src/index.ts:322` — app export for the script surface.
- `plugins/sp/scripts/inline-run-setup.ts:577` — `runPersistOutMode` (`--persist-out --from
  <path>`, cwd = invoking tree): success `{ok:true,persisted:n,skipped:[…]}` exit 0; failure
  `{ok:false,error}` exit 1 (AC3 → WT-5 retention); `:613`/`:633`/`:667` flag parsing,
  mutually-exclusive mode guard, usage errors exit 2. Header usage docs `:38`/`:59`.
- Docs: `plugins/sp/skills/spur-dev/references/execution-batch.md:824-833` — WT-4a now runs `bun
  "$SETUP_SCRIPT" --persist-out --from "$WT_PATH"` before WT-4b, `WT_PATH` hoisted to one
  resolution site `:823`, non-zero exit halts → WT-5; prose `:489-495` + `:497-508` fold the
  0948 R9 copy-out paragraphs into the mechanical persist-out pointer.
- Pins: `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:155` (ordering, single
  WT_PATH site, WT-5 routing, no manual-copy wording).
- Tests: `packages/domain/tests/dao/run-transfer.test.ts:68` (4 — fresh copy, id-exists skip,
  external-key-conflict skip, idempotent re-persist), `packages/app/tests/services/persist-worktree-runs.test.ts:41`
  (3 — rows+records copied, divergent record skipped unmodified, unreadable DB rejects),
  `plugins/sp/tests/inline-run-setup.test.ts:593-696` (4 — e2e exit 0 + queryable rows/records,
  idempotent second persist, exit 1 on garbage DB, exit 2 usage matrix).

#### R2 — NO_ACTION_ROWS (AC4)

- `packages/app/src/workflow/action-trace.ts:295` — `closeRun` returns `{ ok: true, actionRows }`,
  counting via `ActionRunDao.actionRowsByRunId` when the raw db handle is present (`:309-311`);
  omitted on the engine path (writer without db).
- `plugins/sp/scripts/inline-run-setup.ts:463-471` — `--close --status done` with `actionRows ===
  0` → prints `{ok:false,runId,code:"NO_ACTION_ROWS",actionRows:0}` and exits 1 (row already
  terminal; finding appended to the run log); ≥1 row exits 0 reporting `actionRows`; `failed`/
  `paused` exempt.
- Docs: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:530-537` — the driver
  surfaces the code in its final report and must not backfill rows.
- Tests: `plugins/sp/tests/inline-run-trace.test.ts:338/372/403` (zero+done → exit 1
  NO_ACTION_ROWS with terminal row + log line; ≥1 row → exit 0 `actionRows:1`; zero+failed →
  exit 0 with `terminal_reason`), `packages/app/tests/workflow/action-trace.test.ts:191-212`
  (app-level pin of the new return shape: `actionRows:1`).

#### R3 — test-only subpath boundary (AC5)

- `config/rules/boundary/test-subpath-boundary.yaml:14` — `no-testing-subpath-import`
  (specifier `@gobing-ai/spur-app/testing`, scope `apps/**/src/**/*.ts` + `packages/**/src/**/*.ts`,
  exclude `packages/app/src/testing/**`) and `:32` `no-relative-testing-module-import` (line
  pattern for relative `…/testing…` imports in `packages/app/src/**`). Globs are `.ts` only —
  the evaluator's segment-aware matcher has no brace groups, matching the dao-boundary precedent;
  `src`-only scope keeps `**/tests/**` clean by construction. Auto-wired into
  `recommended-pre-check` via the preset's `boundary` category (verified: both ids present in
  `rule validate --preset recommended-pre-check`).
- Generated catalog staged by `bun run build:bundle` (`apps/cli/config/` is gitignored).
- Evidence: `rule validate <file>` valid; synthetic fixtures in `packages/app/src/` +
  `apps/server/src/` → `rule run --rule <id>` exit 1 naming the rule id and file:line; relative
  fixture → `no-relative-testing-module-import` exit 1; clean control + full preset `rule run` →
  exit 0, 0 findings; fixtures removed afterwards.

#### Gates

`bunx biome check` clean on all changed files; `typecheck` exit 0 for all 7 workspaces; targeted
suites green (domain 4, app services 2256 incl. the 3 new, app workflow 20 incl. the updated pin,
plugins/sp full suite 1648 incl. the 11 new/updated); `bun run build:scripts` regenerated the
`.mjs` twins (script-contract-check 0 violations); `bun run plugin-smoke` PASS; working tree
contains only the intended 17 paths; nothing committed (host owns the commit boundary).


#### Run 2 addendum (2026-09-26, implement follow-up)

Closed the two P3s run-1 review/verify left open; no behavior contract changed. (1) Run-id
hardening: `persistWorktreeRuns` now validates every DB-sourced run id against the same
single-safe-filename-component charset as the script's `SAFE_RUN_ID_RE` arg guard (0804 R8)
BEFORE the target DB is even opened — an unsafe id throws the named `InvalidWorkflowRunIdError`
(`invalid-run-id`, 0948 R5), so a hostile worktree row can never reach a `.spur/run/<id>` path
and rejection leaves zero partial state. The `--persist-out` arg seam itself takes no run-id
input (ids come only from the worktree DB), so the app seam is the single choke point; the
`.mjs` twin was regenerated (`build:plugin-lib`). One focused accept+reject test added in
`persist-worktree-runs.test.ts`. (2) `execution-batch.md` WT-4a prose now pins the exact
persist-out shapes: exit 0 `{"ok":true,"persisted":<n>,"skipped":[{"id":<run-id>,"reason":"id-exists"|"external-key-conflict"|"record-conflict:<file>"}]}`,
exit 1 `{"ok":false,"error":<message>}` — doc and `runPersistOutMode` now agree. Plan boxes
whose run-1 evidence exists are ticked; the AC1 live-smoke boxes and the single-commit box stay
open for this run's own completion and WT-3b.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/run-transfer.ts:86` transferRunTables (id-exists / external-key-conflict skip, one batch per run); `packages/app/src/services/inline-run-setup.ts:186` persistWorktreeRuns; script `plugins/sp/scripts/inline-run-setup.ts:577` runPersistOutMode; WT-4a wiring `plugins/sp/skills/spur-dev/references/execution-batch.md:836`. Forced re-verify 2026-09-26: domain run-transfer.test.ts 4/4, app persist-worktree-runs + action-trace 23/23, plugins/sp inline-run-setup/trace/installed/execution-batch-contract 52/52 — all green this run. Live: worktree run inline-20260926T215924Z-e9ac (worktree spur-new-run-0975-9039, torn down) is present in the invoking tree .spur/spur.db (status done, 13 action_runs rows) with .md + .state.json in .spur/run/. |
| R2 | MET | `packages/app/src/workflow/action-trace.ts:290` closeRun returns actionRows; `plugins/sp/scripts/inline-run-setup.ts:470` NO_ACTION_ROWS exit 1 after finalize; tests `plugins/sp/tests/inline-run-trace.test.ts:338` / `:372` / `:403` green this run. |
| R3 | MET | `config/rules/boundary/test-subpath-boundary.yaml:14` no-testing-subpath-import + `:32` no-relative-testing-module-import, both severity error; preset `spur rule run` (recommended-pre-check) exit 0, 0 findings this run; synthetic fixtures re-fired this run (see AC5). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Live: `spur workflow progress inline-20260926T215924Z-e9ac --json` in invoking tree → status completed; sqlite action_runs count=13, runs.status=done; `.spur/run/inline-20260926T215924Z-e9ac.md` + `.state.json` exist after worktree teardown. Component test `plugins/sp/tests/inline-run-setup.test.ts:593` green. |
| AC2 | MET | test | `packages/domain/tests/dao/run-transfer.test.ts:68` id-exists / external-key-conflict / idempotent re-persist — 4/4 green this run; script idempotence `plugins/sp/tests/inline-run-setup.test.ts:593` green. |
| AC3 | MET | test | Unreadable-DB exit 1 `{ok:false}` in `plugins/sp/tests/inline-run-setup.test.ts:593` block + `packages/app/tests/services/persist-worktree-runs.test.ts:41` green; WT-5 routing pinned by `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:155` green. |
| AC4 | MET | test | `plugins/sp/tests/inline-run-trace.test.ts:338` (done+0 → exit 1 NO_ACTION_ROWS, row terminal), `:372` (≥1 → exit 0 actionRows), `:403` (failed+0 → exit 0) — green this run. |
| AC5 | MET | command | This run: `spur rule run --file config/rules/boundary/test-subpath-boundary.yaml` clean tree exit 0; allowed-location fixtures (packages/app/src/testing/zz0975-ok.ts, packages/app/tests/zz0975-ok.ts) exit 0; violating fixtures packages/app/src/zz0975-fx.ts (relative ./testing/…) + apps/server/src/zz0975-fx.ts (@gobing-ai/spur-app/testing) → exit 1 naming no-relative-testing-module-import and no-testing-subpath-import; fixtures removed, git status clean. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=3 housekeeping=0 |

### References

- Origin: 0961 worktree run `inline-20260926T050316Z-9a4ab2d5`, filed via `/sp:dev-review-session`.
- F3 moved to **0958** Defect B (R3/R4/AC5), which covers the checkbox-canonical proof digest.
- **0976**, which independently reproduced F1 and points here.
- Prior art for the copy-out mandate: **0720** R3 and **0948** R9 (`plugins/sp/skills/spur-dev/references/execution-batch.md` "Evidence persistence", "Stage records are worktree-local too", § WT-4).
- Trace writer lineage: **0868**, **0879**, **0914** (`--action`/`--close` contract, ADR-117), and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` "Every executed action".
- Rule precedent: `config/rules/boundary/dao-boundary.yaml` and `config/rules/ui/ui-import-boundary.yaml`.
- Invariant origin: **0961** (`packages/app/package.json` `"./testing"` export).

### History

- 2026-09-26T17:54:45.020Z todo → wip (system)
- 2026-09-26T23:00:44.258Z wip → testing (system)
- 2026-09-26T23:00:44.735Z testing → done (system)

