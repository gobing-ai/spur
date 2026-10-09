---
schema_version: 1
name: Unblock workflow housekeeping from legacy evidence-migration failures
status: todo
template: issue
created_at: 2026-10-09T06:08:08.615Z
updated_at: "2026-10-09T17:56:18.621Z"

feature_id: E71
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
---

## 1139. Unblock workflow housekeeping from legacy evidence-migration failures

### Background

`spur workflow clean` never finalizes stale non-terminal rows on this project's DB, so orphaned
`running` rows accumulate: **62** at the time of filing (41 `task-lifecycle` since 2026-10-01,
14 `feature-lifecycle` since 2026-07-02, 4 `task-pipeline`, 2 `idea-pipeline`, 1
`wrapup-pipeline`).

Cause: the command couples stale-run finalization to a pre-pass that migrates legacy scratch-plane
evidence (`.spur/run/<name>-verdict.json` and their two-file records) into the durable evidence
plane. If ANY legacy file fails that migration, the whole pass reports `housekeeping skipped` and
the stale rows are left untouched. Six files fail today, reproducibly and identically on repeated
runs:

| File | Migrator error |
| --- | --- |
| `.spur/run/0867-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/0875-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/0872-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/1092-verdict.json` | `target-mismatch` |
| `.spur/run/2f720cbc-7e9f-40c2-98cf-af32ed9a01a6-verdict.json` | `malformed: verdict identity or shape` (keys are the check-result shape, not a verdict) |
| `.spur/run/201a166a-3e31-4c3b-a425-3b0d1316a489.md` | `missing-required-item: …201a166a-….state.json` (absent in `.spur/run/`; the `.spur/memory/runs/` copy exists) |

`spur workflow clean --logs` (the scoped variant) succeeds — `Evidence migration: 0 migrated, 82
already present, 0 failed` — which shows the migration itself is healthy for every other file and
that the six offenders are genuinely legacy/malformed strays, not evidence the plane is missing.

This was observed while landing the H1 batch (1127/1129/1128): the stale `feature:H1` lifecycle row
from 2026-07-25 had to be cancelled by hand (`spur workflow cancel <run-id>`) before `persist-out`
could finish, because housekeeping could not do it.

**Refine corrections (2026-10-09)**

- "Six files fail today" → `spur workflow clean --dry-run --json` now reports **46** `migration.failures` (31 `malformed: proof owner binding`, 11 `target-mismatch`, 2 `malformed: verdict identity or shape`, 1 `malformed`, 1 `malformed: Error: schemaVersion must be 1`, 2 `missing-required-item`); exit 1; non-terminal rows are now **65** `running` + 7 `paused` in `.spur/spur.db` `runs` → scope grows; the classification below covers all 46.
- "the six offenders are genuinely legacy/malformed strays" → measured per file against `.spur/memory/evidence/`: 29 of the 31 `proof owner binding` failures have a **byte-identical** durable copy; all 11 `target-mismatch` files have a valid durable copy that is canonical (e.g. `1130-verdict.json` durable is the scratch verdict plus the later `residual-sweep` check row; feature receipts carry the newer `runId`); both `missing-required-item` records have their full `.md`+`.state.json` pair under `.spur/memory/runs/`; only 4 files (`2f720cbc…`, `4cd815f9…` check-result shapes, `E71-1024-final-verdict.json`, `E71-main-feature-verification.json`) have no durable counterpart → the dominant cause is an ordering defect in the migrator (validation precedes the identical-target check), not malformed evidence. Root Cause records it.
- R1 option (b) "an explicit flag to skip the migration" → E71 scope excludes new public flags; resolved to option (a) only.
- R5/R6 (persist-out) → kept here: same durable-vs-scratch reconciliation family and same feature (E71); made concrete in Design.
- Feature: none → **E71** (owns ADR-131 and the migration; reopened for this follow-up).

### Requirements

- [ ] R1. Stale-run finalization (`WorkflowService.clean`, a DB-status-only pass that deletes no file) runs even when the migration pre-pass reports failures. Log reclamation (`cleanRunLogs`) and checkpoint reclamation (`cleanCheckpoints`) run only when the migration reports zero failures, because they delete files. The command still exits 1 while any migration failure remains.
- [ ] R2. Human output prints one line per failure with source, reason and remedy, plus the stale-run result. `--json` keeps the existing `migration.failures[]` shape and adds `remedy` per failure. The stale-run outcome is reported in `cleaned[]` separately from `migration`. No new flag.
- [ ] R3. The migrator classifies before it fails. (a) A unit whose every target already exists byte-identical is `already-present` before any family validation runs. (b) A unit whose durable target exists and parses as a valid member of the same family (same identity) is `superseded`, a new non-failure outcome: the durable copy is canonical per ADR-131 and is never overwritten. (c) A file whose name matches a family pattern, whose content does not parse as that family, and which has no durable counterpart is `preserved` with `reason: 'unclassified: <detail>'`, the existing unknown-scratch outcome. (d) A run-record unit whose missing sibling exists with the full pair under `.spur/memory/runs/<id>.*` is `already-present`. Only genuinely unrecoverable cases stay `failed`: write, copy, confinement, owned target-mismatch against an invalid durable copy, and a missing sibling with no durable pair.
- [ ] R4. On this repository, `spur workflow clean` reports 0 migration failures, finalizes every `running` row older than the threshold (or names each one it leaves live and why), and exits 0. A second run finalizes nothing and prints no `housekeeping skipped` line.
- [ ] R5. `persistWorktreeRuns` treats a divergent **foreign** durable evidence file as skipped, not fatal. Foreign means its wbs is not a forwarded task's and its receipt `runId` is not a worktree run row. The skip is reported in the success result as `evidenceSkipped[{name, reason: 'foreign-divergent', newer: 'invoking'|'worktree'}]`. The invoking-tree copy is never overwritten. A divergent **owned** file still throws `durable evidence conflicts`.
- [ ] R6. The record step refuses a rendered Testing section that cites a direct-child `.spur/run/<name>` resolving in neither `.spur/run/` nor `.spur/memory/{evidence,runs}/` of the recording tree. The error names the citation and the verdict check it came from, before any section is written, so teardown is never the first detector.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a migration failure no longer blocks stale-run finalization (req: R1)
  Given a scratch file the migrator fails with write-failed
  And a running run row older than the staleness threshold
  When `spur workflow clean` runs
  Then the stale row is finalized
  And log and checkpoint reclamation are skipped
  And the command exits 1 naming the failed file

Scenario: AC2 — failures are reported with a remedy in both outputs (req: R2)
  Given the same setup
  When `spur workflow clean --json` runs
  Then each migration.failures entry carries source, reason and remedy
  And cleaned lists the finalized run separately from migration

Scenario: AC3 — identical and superseded scratch copies are not failures (req: R3)
  Given a scratch verdict byte-identical to its durable copy but with a stale proof owner binding
  And a scratch verdict whose durable copy is a valid, different verdict for the same wbs
  And a run-record .md whose .state.json exists only under .spur/memory/runs
  And a <uuid>-verdict.json holding a check-result shape with no durable counterpart
  When the migration runs
  Then the outcomes are already-present, superseded, already-present and preserved (unclassified)
  And failures is empty
  And no durable file changes bytes

Scenario: AC4 — this repository converges (req: R4)
  Given this repository's .spur/run and .spur/spur.db
  When `spur workflow clean` runs twice
  Then the first run reports 0 migration failures and finalizes the stale running rows
  And the second run finalizes nothing and prints no housekeeping-skipped line

Scenario: AC5 — a divergent foreign evidence copy cannot block persist-out (req: R5)
  Given a worktree evidence plane holding another task's verdict that differs from the invoking tree's copy
  When persist-out runs for a task that does not own it
  Then it succeeds and reports the file under evidenceSkipped with reason foreign-divergent and which side is newer
  And the invoking-tree copy is byte-identical afterwards
  And a divergent owned verdict still fails with durable evidence conflicts

Scenario: AC6 — a phantom run citation fails at record (req: R6)
  Given a verdict whose check evidence cites .spur/run/bb-base.sha that exists in no plane of the tree
  When `spur task record` renders Testing
  Then it fails naming .spur/run/bb-base.sha and the check row
  And the task file is unchanged
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09T17:56:09.332Z

- **Q: Non-fatal migration or a skip flag (R1)?** A: Non-fatal for the DB-only stale-run pass. File-deleting reclamation stays fail-closed. No new public flag; E71 out-of-scope forbids one.
- **Q: When scratch and durable differ, which wins (R3b)?** A: Durable, always (ADR-131: `.spur/memory/evidence` is canonical). The scratch copy is reported `superseded` and preserved. Nothing is overwritten, and no "newer mtime" heuristic is used for the decision.
- **Q: Archive or delete the 4 unclassified files?** A: Neither. They are reported `preserved` (unclassified), the existing unknown-scratch contract. Scratch disposal remains the operator's decision under ADR-131.
- **Q: Auto-repair the phantom citation at record (R6)?** A: No. Fail with the citation named; the verdict producer must fix its evidence. Synthesizing a citation would be inventing evidence.

### Design

**Migrator (`packages/app/src/services/run-storage.ts`, `migrateRunStorage` @407):**

1. Hoist a per-unit `allTargetsIdentical` check above the family-validation block (@570–610). Targets are computed exactly as at @618–626. If every target exists with the snapshot digest, push `already-present` and `continue`.
2. After validation fails, or on a conflict (@642–658), consult the durable target. Parse it with the same family parser (`parseVerifyVerdict` / `parseFeatureVerificationReceipt` / run-record pair existence) and the same identity. If it is valid, push `superseded` with `reason: 'durable canonical'` and `continue`. Add `'superseded'` to `RunStorageOutcome` @107.
3. For a `requiresJsonParse` or family-shape failure with no durable counterpart, push `preserved` with `reason: 'unclassified: <invalid>'`, not `failed`.
4. `missingRequiredItem` (@544): if `dirs.recordsDir/<id>.md` and `<id>.state.json` both exist, the outcome is `already-present`.
5. `RunStorageFailure` gains `remedy: string`, chosen from a small reason→remedy map (write-failed → check permissions/disk; confinement → path escapes plane; target-mismatch with an invalid durable copy → repair the durable file by hand; missing pair → re-record the run).

**CLI (`apps/cli/src/commands/workflow.ts` clean action @1498–1560):** on `migration.failures.length > 0`, still call `svc.clean(minutes, dryRun)` (unless `--logs`). Skip `cleanRunLogs` and `cleanCheckpoints`. Set exit 1. Emit `cleaned` from the real result. The human line becomes `Migration failed for <src>: <reason> — <remedy>; log/checkpoint reclamation skipped.`

**persist-out (`packages/app/src/services/inline-run-setup.ts` `persistWorktreeRuns` @361):** the evidence loop @380–406 currently throws on any divergent target. Compute ownership with the same prefixes the 1012 block builds (@452–465: forwarded wbs plus worktree run ids); hoist that computation above the evidence loop. On divergence: if owned, throw (unchanged); if foreign, record `{name, reason: 'foreign-divergent', newer}` (newer by `mtimeMs`, report-only) and skip the copy. The second conflict throw @587 is reached only for copies that survived the first pass, so it keeps its semantics. Add `evidenceSkipped` to `PersistWorktreeRunsSuccess`. `persist-out-check.ts` must accept the same foreign-divergent set; it reads the success JSON and does not recompute it.

**record (`packages/app/src/services/task-service.ts` @1700):** after `renderTesting(verdict)`, extract citations with the `RUN_CITATION_RE` from `inline-run-setup.ts:290`. Move it to a shared module, `packages/app/src/workflow/run-citation.ts`, and import it from both places. Keep direct-child names only; subpath citations are skipped, matching 1056 R1. Resolve each in `.spur/run/`, `.spur/memory/evidence/` and `.spur/memory/runs/` under `cwd`. Unresolved → throw before `spur task update` writes.

Tradeoff: `superseded` widens a public JSON enum, which is additive. Consumers that switch on `outcome` must treat unknown values as non-failure; only `apps/cli` reads it today.

### Plan

1. Failure modes first, in `packages/app/tests/services/run-storage.test.ts`:
   - F1: an identical target behind a stale proof binding fails.
   - F2: a valid durable copy that differs fails.
   - F3: a check-result-shaped `-verdict.json` fails.
   - F4: a record pair present only in `memory/runs` fails.
   - F5: a write-failed migration blocks finalization (CLI e2e).
   - F6: foreign divergent evidence throws in persist-out.
   - F7: an owned divergent file is silently skipped (must still throw).
   - F8: a phantom citation passes record.
2. Migrator changes (Design 1–5). Make F1–F4 green.
3. CLI clean action change. Add an e2e in `apps/cli/tests` using a temp project with a stale `running` row and a forced write failure (`atomicCopy` seam or read-only target dir) → F5.
4. persist-out ownership hoist plus `evidenceSkipped`. Extend `packages/app/tests/services/persist-worktree-runs.test.ts` → F6, F7.
5. Extract `run-citation.ts`; add the record-time check plus a test in the task-service suite → F8.
6. Update `docs/design/` run-storage satellite (outcome enum, `remedy`) and the `execution-batch.md` persist-out reconcile note. Run `bun run build:bundle`.
7. On this repo: `spur workflow clean --dry-run --json` must show 0 failures. Then run `spur workflow clean` twice and record both outputs in Testing (R4).
8. `bun run spur-check`.

### Root Cause

- `packages/app/src/services/run-storage.ts:570-610`: family validation (`proof owner binding`, `verdict identity or shape`) runs **before** any target comparison. A scratch verdict whose durable copy is already byte-identical (29 files here) is therefore reported `failed`, not `already-present`.
- `run-storage.ts:642-658`: any differing durable target is `target-mismatch`/`failed`, even though ADR-131 makes the durable copy canonical. All 11 here are durable-canonical (a superset or a newer run).
- `run-storage.ts:544-549`: `missingRequiredItem` checks only the scratch sibling, never the durable pair that already exists.
- `apps/cli/src/commands/workflow.ts:1516-1546`: any failure returns before `svc.clean`, so DB-only stale-run finalization is held hostage to file-migration hygiene.
- `packages/app/src/services/inline-run-setup.ts:380-406`: persist-out iterates **every** worktree evidence file, owned or not, and throws on the first divergence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ADR-131 (+2026-10-09 amendment) — durable plane canonical.
- `packages/app/src/services/run-storage.ts`, `apps/cli/src/commands/workflow.ts:1498`, `packages/app/src/services/inline-run-setup.ts:290,361-470,587`, `packages/app/src/services/task-service.ts:1700`.
- Related: 1140/1141/1145 (same ADR-131 follow-up under E71); 1136 R8/R12 (persist-out-check caps/skips — touches `persist-out-check.ts`, sequence after this task).

### History
