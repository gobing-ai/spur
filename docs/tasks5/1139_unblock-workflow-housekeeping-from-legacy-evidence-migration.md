---
schema_version: 1
name: Unblock workflow housekeeping from legacy evidence-migration failures
status: done
template: issue
created_at: 2026-10-09T06:08:08.615Z
updated_at: "2026-10-09T20:34:31.449Z"

feature_id: E71
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1139-verdict.json
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

- [x] R1. Stale-run finalization (`WorkflowService.clean`, a DB-status-only pass that deletes no file) runs even when the migration pre-pass reports failures. Log reclamation (`cleanRunLogs`) and checkpoint reclamation (`cleanCheckpoints`) run only when the migration reports zero failures, because they delete files. The command still exits 1 while any migration failure remains.
- [x] R2. Human output prints one line per failure with source, reason and remedy, plus the stale-run result. `--json` keeps the existing `migration.failures[]` shape and adds `remedy` per failure. The stale-run outcome is reported in `cleaned[]` separately from `migration`. No new flag.
- [x] R3. The migrator classifies before it fails. (a) A unit whose every target already exists byte-identical is `already-present` before any family validation runs. (b) A unit whose durable target exists and parses as a valid member of the same family (same identity) is `superseded`, a new non-failure outcome: the durable copy is canonical per ADR-131 and is never overwritten. (c) A file whose name matches a family pattern, whose content does not parse as that family, and which has no durable counterpart is `preserved` with `reason: 'unclassified: <detail>'`, the existing unknown-scratch outcome. (d) A run-record unit whose missing sibling exists with the full pair under `.spur/memory/runs/<id>.*` is `already-present`. Only genuinely unrecoverable cases stay `failed`: write, copy, confinement, owned target-mismatch against an invalid durable copy, and a missing sibling with no durable pair.
- [x] R4. On this repository, `spur workflow clean` reports 0 migration failures, finalizes every `running` row older than the threshold (or names each one it leaves live and why), and exits 0. A second run finalizes nothing and prints no `housekeeping skipped` line.
- [x] R5. `persistWorktreeRuns` treats a divergent **foreign** durable evidence file as skipped, not fatal. Foreign means its wbs is not a forwarded task's and its receipt `runId` is not a worktree run row. The skip is reported in the success result as `evidenceSkipped[{name, reason: 'foreign-divergent', newer: 'invoking'|'worktree'}]`. The invoking-tree copy is never overwritten. A divergent **owned** file still throws `durable evidence conflicts`.
- [x] R6. The record step refuses a rendered Testing section that cites a direct-child `.spur/run/<name>` resolving in neither `.spur/run/` nor `.spur/memory/{evidence,runs}/` of the recording tree. The error names the citation and the verdict check it came from, before any section is written, so teardown is never the first detector.

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

| Change | Location | Why |
| --- | --- | --- |
| `superseded` outcome + `failureRemedy` map + `RunStorageFailure.remedy` | `packages/app/src/services/run-storage.ts:113` | ADR-131 makes the durable copy canonical, and every failure must name a repair |
| `isDurableTargetValid()` — parse the durable target with the same family parser/identity | `packages/app/src/services/run-storage.ts:404` | Distinguishes a canonical durable copy from a corrupt one before failing |
| `allTargetsIdentical` hoisted above family validation | `packages/app/src/services/run-storage.ts:593` | Validation before the identical-target check was the dominant defect (29 byte-identical files failed) |
| Durable-target consultation on shape failure | `packages/app/src/services/run-storage.ts:738` | `superseded` when a valid durable copy exists; else target-mismatch or preserved-unclassified |
| Durable-target consultation on identity failure | `packages/app/src/services/run-storage.ts:778` | A valid durable copy supersedes even when the scratch identity is foreign |
| `missingRequiredItem` accepts a full durable pair | `packages/app/src/services/run-storage.ts:653` | Both `missing-required-item` files have their pair under `.spur/memory/runs/` |
| `clean` action finalizes stale runs on migration failure; skips only file-deleting reclamation; per-failure remedy line | `apps/cli/src/commands/workflow.ts:1518` | DB-only finalization must not be held hostage to file-migration hygiene (R1/R2) |
| Foreign-divergent evidence skip + `evidenceSkipped` | `packages/app/src/services/inline-run-setup.ts:395` | A divergent copy of another task's evidence must not block teardown (R5) |
| `persist-out.json` written beside the stdout envelope | `packages/app/src/services/inline-run-setup.ts:1671` | The pre-removal check reads the recorded outcome instead of recomputing it |
| Pre-removal check accepts the foreign-divergent set | `plugins/sp/scripts/persist-out-check.ts:166` | Same set as the recorded outcome (R5) |
| Record-time citation resolution | `packages/app/src/services/task-service.ts:2490` | Teardown must not be the first detector of a phantom citation (R6) |
| Shared citation module (regex, literalization, extraction, planes) | `packages/app/src/workflow/run-citation.ts:1` | One contract for persist-out and the record step; no drifting copies |

Tradeoff: `superseded` widens the public `RunStorageOutcome` enum (`packages/app/src/services/run-storage.ts:113`) — additive; a
consumer that switches on `outcome` treats unknown values as non-failure, and only `apps/cli` reads it today.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:1518` runs `svc.clean(minutes, dryRun)` on the migration-failure path; log/checkpoint reclamation stays behind the zero-failure gate and the command still exits 1. |
| R2 | MET | Per-failure `source`/`reason`/`remedy` line in human output and `remedy` on every `migration.failures[]` entry; `cleaned[]` carries the finalized runs separately from `migration` (`apps/cli/tests/commands/workflow.test.ts`, F5). |
| R3 | MET | `packages/app/src/services/run-storage.ts:593` hoists `allTargetsIdentical` above family validation; `:738` and `:778` consult `isDurableTargetValid` and emit `superseded`; shape failures with no durable counterpart emit `preserved (unclassified: …)`; `:653` accepts a full durable pair for a missing sibling. |
| R4 | MET | `spur workflow clean` on the invoking tree, run 1: `Finalized 70 stale run(s) (>30m)` + `Evidence migration: 2 migrated, 1123 already present, 0 failed.`, exit 0; run 2: `No stale runs older than 30m.` + `0 failed`, and no `housekeeping skipped` line in either. |
| R5 | MET | `packages/app/src/services/inline-run-setup.ts:395` records `evidenceSkipped[{name, reason:'foreign-divergent', newer}]` and never overwrites the invoking-tree copy; a divergent owned file still throws `durable evidence conflicts` (`packages/app/tests/services/persist-worktree-runs.test.ts`, F6/F7). |
| R6 | MET | `packages/app/src/services/task-service.ts:2490` resolves every rendered Testing citation across `.spur/run/`, `.spur/memory/evidence/` and `.spur/memory/runs/` and throws before the first section write, naming the citation and its source row (`packages/app/tests/services/task-record.test.ts`, F8). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | e2e | `apps/cli/tests/commands/workflow.test.ts` — a migration failure still finalizes the stale row, skips log/checkpoint reclamation, and exits 1 naming the failed file. |
| AC2 | MET | e2e | `clean --json` carries `source`/`reason`/`remedy` per failure and lists `cleaned` separately from `migration`. |
| AC3 | MET | unit | `packages/app/tests/services/run-storage.test.ts` — byte-identical stale-binding and durable-pair cases are `already-present`, a valid differing durable copy is `superseded`, a check-result verdict with no durable copy is `preserved (unclassified)`, and `failures` stays empty. |
| AC4 | MET | e2e | Two consecutive `spur workflow clean` runs on this repository both exit 0 with 0 migration failures; the second finalizes nothing. |
| AC5 | MET | unit | `persistWorktreeRuns` succeeds for a non-owning task, reports `evidenceSkipped` with the newer side, leaves the invoking-tree copy byte-identical, and still throws for a divergent owned file. |
| AC6 | MET | unit | `spur task record` fails naming the phantom citation and its check row, leaving the task file unchanged; a citation present in the runs plane is accepted. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### R4 — this repository converges (AC4)

`spur workflow clean` (worktree's fixed source CLI, run against the **invoking tree** at
`/Users/robin/xprojects/spur-new`), twice, in order:

Run 1 (applied), exit 0:

```
Finalized 70 stale run(s) (>30m):
...
Evidence migration: 2 migrated, 1123 already present, 0 failed.
```

Run 2 (applied), exit 0:

```
No stale runs older than 30m.
Evidence migration: 0 migrated, 1124 already present, 0 failed.
```

No `housekeeping skipped` line in either output. `--dry-run --json` before the apply reported
`failures: 0` and 70 would-finalize rows (was 46 failures / exit 1 before the fix).

#### Regression suite

| Suite | Command | Result |
| --- | --- | --- |
| Migrator classification | `(cd packages/app && bun test tests/services/run-storage.test.ts)` | 38 pass / 0 fail (F1–F4 + superseded / preserved-unclassified / remedy cases) |
| persist-out foreign skip | `(cd packages/app && bun test tests/services/persist-worktree-runs.test.ts)` | 37 pass / 0 fail (F6/F7) |
| Record citation gate | `(cd packages/app && bun test tests/services/task-record.test.ts)` | 146 pass / 0 fail (F8) |
| Shared citation module | `(cd packages/app && bun test tests/workflow/run-citation.test.ts)` | 7 pass / 0 fail |
| `clean` resilience + e2e | `(cd apps/cli && bun test tests/commands/workflow.test.ts)` | 173 pass / 0 fail (F5) |
| Pre-removal assertion | `bun test plugins/sp/tests/persist-out-check.test.ts` | 12 pass / 0 fail |
| Task-local gate | `bun run spur-check` | exit 0 — lint clean, 50 pre-check rules, 10682 pass / 0 fail, 2 post-check rules |
| Plugin standalone | `bun run plugin-smoke` | PASS |
| Feature-scoped repo-wide | `bun run spur-check-feature` | all pass except `dependency-drift-check` (pre-existing, see Review) |

Coverage: `run-storage.ts` 94.05 % lines / 100 % functions (the 0.9 per-file gate); `run-citation.ts`
100 %; `inline-run-setup.ts` 95.12 % lines / 93.10 % functions.

Adjacent unblock (out of task scope): `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:793`
carried a forbidden bare `bun plugins/sp/scripts/` invocation that failed `script-contract-check` on
`main` before this task; the line was aligned with the guarded/installed-twin idiom already used four
times in the same file. Doc-only, no behavior change.

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No findings (verify verdict PASS) |

Residual risk:

- **`superseded` is public JSON.** Adding a value to `RunStorageOutcome` is additive; an external
  consumer that switches exhaustively on `outcome` would need the new value. Only `apps/cli` reads it
  in-tree.
- **Unclassified scratch is never disposed.** By ADR-131 the four genuinely-unrecoverable files
  (`2f720cbc…`, `4cd815f9…`, `E71-1024-final-verdict.json`, `E71-main-feature-verification.json`) stay
  in `.spur/run/` as `preserved (unclassified)`. That is the intended contract (scratch disposal is the
  operator's decision), not a leak.
- **`dependency-drift-check` fails in `spur-check-feature`.** Environmental: `@gobing-ai/ts-db`,
  `ts-runtime`, `ts-utils` are installed at 0.5.18 while `bun.lock`/catalog expects 0.5.19. The same
  failure reproduces in the untouched main tree at base commit `17d06fe18`; the remedy is a repo-wide
  `bun install`, outside this task's scope.
- **`inline-pipeline-driver.md` doc line 793** was fixed as an adjacent unblock for the pre-existing
  `script-contract-check` failure (see Testing). No behavior change.

Untested paths: the `write-failed`/`copy-mismatch`/`manifest-confinement`/`manifest-write` failure
branches are exercised by a test seam (`atomicCopy`) and a read-only-target fixture rather than real
disk faults; the `cleanRunLogs`/`cleanCheckpoints` skip was asserted through the CLI JSON, not by
inspecting the filesystem for each reclaimed log.

### References

- ADR-131 (+2026-10-09 amendment) — durable plane canonical.
- `packages/app/src/services/run-storage.ts`, `apps/cli/src/commands/workflow.ts:1498`, `packages/app/src/services/inline-run-setup.ts:290,361-470,587`, `packages/app/src/services/task-service.ts:1700`.
- Related: 1140/1141/1145 (same ADR-131 follow-up under E71); 1136 R8/R12 (persist-out-check caps/skips — touches `persist-out-check.ts`, sequence after this task).

### History

- 2026-10-09T18:43:23.744Z todo → wip (system)
- 2026-10-09T20:34:20.842Z wip → testing (system)
- 2026-10-09T20:34:31.444Z testing → done (system)

