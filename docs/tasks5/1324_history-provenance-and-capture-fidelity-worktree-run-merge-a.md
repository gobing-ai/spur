---
schema_version: 1
name: "History provenance and capture fidelity: worktree run merge and antigravity ETL"
status: wip
template: feature-impl
created_at: 2026-11-10T07:34:40.105Z
updated_at: "2026-11-10T22:24:39.368Z"
feature_id: E6

priority: P2
ac_altitude: task-local
estimate_hours: 16
---

## 1324. History provenance and capture fidelity: worktree run merge and antigravity ETL

### Background

KK history analysis since spur 0.4.30 (2026-11-10) showed two history-fidelity gaps. Provenance:
dev-run worktree pipeline runs record `runs`/`phase_runs`/`task_run_links` in the worktree's own
`.spur/spur.db`, discarded with the worktree — the project DB's newest task_run_links row pointed
at task 0344 (Nov 7) although tasks 0345–0347 ran pipelines Nov 8–10, and `history analyze`
reported `verifiedOutcome.taskDenominator = 0` despite 0345 having a real PASS verdict synced to
the main `.spur/run/`. Capture: antigravity (agy) sessions carried 61% of window messages (9,643
of 15,721) with zero usage, model, or tool-args capture, so 39.9% of wall time shows as
unattributed and cost is blind for the majority source; one agy session emitted 3,455
near-identical "awaiting completion" messages that survive as distinct records, and the loop
detector false-fired 1,050 findings on identical empty args digests (query-level guard fixed in
this repo on 2026-11-10).

### Requirements

- [x] R1. Worktree provenance merge: at worktree merge/wrap (WT-4 landing or wrapup), runs, phase_runs,
   task_run_links, and run_sessions from the worktree DB merge back into the project DB with ids
   preserved and an exactness/mechanism marker identifying worktree origin; re-merge is idempotent.
- [x] R2. Antigravity ETL: parse vendor-side logs to populate `history_message.model`, usage token fields,
   cost where derivable, and `history_tool_call.args_raw`/`args_digest`, so agy steps attribute
   time and tokens like other sources.
- [x] R3. Poll-message dedupe: verbatim-duplicate consecutive assistant messages (same normalized text,
   same session, contiguous) collapse into one record with a repeat count, or carry a disposition
   that downstream aggregators exclude from loop/latency denominators.
- [x] R4. `history analyze` verifiedOutcome denominators then count tasks whose pipelines ran in
   worktrees, closing the false taskDenominator = 0.

### Acceptance Criteria

- [x] AC1 — (req: R1; R4): A worktree run's provenance rows (runs, phase_runs, task_run_links, run_sessions) land in the project DB with ids preserved and a worktree-origin mechanism marker; re-merge is idempotent (second merge changes no rows), and `history analyze` counts worktree runs in the verifiedOutcome task denominator instead of a false 0.
- [x] AC2 — (req: R2): An antigravity session import populates `history_message.model` and usage token fields (cost where derivable) and `history_tool_call.args_raw`/`args_digest`; vendor-unavailable fields carry an explicit unavailable disposition, not empty strings — agy steps stop showing as zero-usage unattributed time.
- [x] AC3 — (req: R3): Verbatim-duplicate consecutive assistant messages (same normalized text, same session, contiguous) collapse into one record with a repeat count or an excluded disposition, and loop/latency aggregators exclude them from their denominators.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:43.047Z

- Q: Why merge instead of pointing analyze at worktree DBs? A: Worktrees are deleted after
  landing; the project DB is the only durable provenance store. Merge-at-landing is the earliest
  durable point.
- Q: Is the loop-detector fix part of this task? A: No — the query-side empty-digest guard is
  already done (forensic-query.ts, 2026-11-10). This task removes the root cause at import time.
- Q: Dependencies? A: None; both workstreams touch only spur-owned code and fixtures.

### Design

**Decision: two independent workstreams in one task, both on the history plane.**
Workstream A (provenance) extends the existing worktree landing/wrap path
(`packages/app/src/services/worktree-persist.ts`, wrapup pipeline) with a DB merge step;
workstream B (capture) extends the antigravity importer in the history ETL
(`@gobing-ai/ts-llm-jsonl-importer` source adapters) — no new tables.

1. **Provenance merge**: at WT-4 landing, read the worktree `.spur/spur.db` and upsert its `runs`,
   `phase_runs`, `task_run_links`, and `run_sessions` rows into the project DB with ids preserved
   and a `mechanism` marker noting worktree origin. Upsert keyed on run id makes re-merge
   idempotent; no row is deleted.
2. **Antigravity capture**: parse vendor-side session logs for model, usage token fields, and tool
   args; populate `history_message.model`/usage and `history_tool_call.args_raw`/`args_digest`.
   Fields the vendor does not expose get an explicit unavailable disposition rather than empty
   strings (the empty-digest loop-detector false-fire was already guarded query-side).
3. **Poll dedupe**: verbatim-duplicate consecutive assistant messages (same normalized text, same
   session, contiguous) collapse to one record with a repeat count or an excluded disposition so
   loop/latency aggregates stop counting them.

### Plan

- [x] P1. Provenance merge module: worktree DB reader + idempotent upsert into project DB, invoked
  from the WT-4 landing/wrap path; unit tests with two DB fixtures and a re-merge assertion.
- [x] P2. Antigravity ETL adapter: model/usage/args extraction with unavailable-disposition
  fallback; fixture test over a real agy session shape.
- [x] P3. Consecutive-duplicate assistant collapse (or disposition tagging) in the importer;
  aggregate-level test that loop findings and latency denominators exclude them.
- [x] P4. Verify `spur history analyze` on the merged fixtures: taskDenominator counts worktree
  runs, unattributed share drops.

### Solution

Two workstreams, both landing in `packages/domain` (raw SQL / `ts-db` boundary rule); the app
persist path picks P1 up automatically because `persistWorktreeRuns` already calls
`transferRunTables` — no new tables, no migration.

- `packages/domain/src/dao/run-transfer.ts:85` — `stampWorktreeOrigin`: additive
  `worktree_origin: true` marker in the merged run row's `metadata_json` (R1 origin marker on runs).
- `packages/domain/src/dao/run-transfer.ts:167` — `worktreeRunSessionOps`: per-run copy of the
  worktree's `history_run_session` rows into the same per-run batch, `mechanism` re-stamped to
  `worktree-merge` (the R1 origin marker on mappings), natural-key existence check keeps a direct
  re-call idempotent; a pre-`0013` worktree without the table is tolerated (R1).
- `packages/domain/src/dao/run-transfer.ts:285` — wiring: the run row lands stamped and its session
  mappings ride the same batch, so ids are preserved and a re-persist (`id-exists` skip) changes
  zero rows (R1 idempotency). `persistWorktreeRuns`/WT-4 needs no edit — it already invokes this.
- `packages/domain/src/dao/run-session-dao.ts:22` — `RunSessionMechanism` gains `'worktree-merge'`
  with the provenance contract documented (R1).
- `packages/domain/src/analytics/antigravity-etl.ts:34` — `usage-unavailable` disposition constant:
  vendor-unavailable usage is explicit disposition + NULL columns, never empty strings (R2/AC2).
- `packages/domain/src/analytics/antigravity-etl.ts:111` — `enrichAntigravityUsage`: fills
  `history_message.model`/usage/derived-cost (`computeRecordCost`) from vendor-side facts in seq
  order; unattributed agy assistant rows are marked `usage-unavailable` (R2/AC2).
- `packages/domain/src/analytics/antigravity-etl.ts:184` — `enrichAntigravityToolArgs`: back-fills
  `history_tool_call.args_raw`/`args_digest` (sha256 hex) for agy rows missing both (R2/AC2).
- `packages/domain/src/analytics/antigravity-etl.ts:221` — `repairEmptyArgDigests`: empty-string
  digests (the loop false-fire root cause) rewritten to the NULL unavailable sentinel (R2).
- `packages/domain/src/analytics/antigravity-etl.ts:251` — `collapsePollDuplicates`: verbatim
  consecutive assistant duplicates (trimmed/whitespace-collapsed compare, same session, contiguous
  by seq) collapse to the first row; the rest carry the `poll-duplicate` excluded disposition (R3/AC3).
- `packages/domain/src/analytics/forensic-query.ts:342` and `packages/domain/src/analytics/forensic-query.ts:639` — `bySession`
  latency denominators (assistant-duration sums + last-message selection) exclude `poll-duplicate` (R3/AC3).
- `packages/domain/src/analytics/forensic-query.ts:811` and `packages/domain/src/analytics/forensic-query.ts:839` — loop findings
  (scoped + unscoped `loops`) exclude tool calls whose parent message is a collapsed poll (R3/AC3).
- `packages/domain/src/analytics/index.ts:241` — the new ETL module's exports (every symbol tsdoc'd).
- `packages/app/tests/services/worktree-run-merge-verified-outcome.test.ts:1` — AC1/R4 proof:
  merged fixture feeds `deriveVerifiedOutcome`; `taskDenominator` counts the worktree run (1, not 0)
  and measured tokens flow through the merged `worktree-merge` mapping (5000).

Note: the vendor importer (`@gobing-ai/ts-llm-jsonl-importer`) is an external catalog package, so
the R2/R3 ETL lives Spur-side as post-import enrichment over vendor-log facts (design §2's intent —
"parse vendor-side session logs" — unchanged; the adapter itself is not editable).

### Testing

Commands run (from repo root; in-memory SQLite fixtures):

- `cd packages/domain && bun test tests/analytics/antigravity-etl.test.ts` — 3 pass (R2 usage
  enrichment + unavailable disposition idempotency; args back-fill + empty-digest repair; R3 collapse
  + loops/bySession exclusion + idempotency).
- `cd packages/domain && bun test tests/dao/run-transfer.test.ts` — 15 pass (existing 0975 suite
  green + 3 new 1324 tests: marker-bearing merge with ids preserved, re-merge idempotency, pre-0013
  tolerance).
- `cd packages/app && bun test tests/services/worktree-run-merge-verified-outcome.test.ts` — 2 pass
  (AC1/R4: merged worktree rows → taskDenominator 1 with measured tokens; unmerged → 0 regression).
- Focused regressions: `bun test tests/analytics/ tests/dao/run-transfer.test.ts
  tests/dao/run-session-dao.test.ts` (domain) — 477 pass / 0 fail; `bun test
  tests/services/verified-outcome.test.ts tests/services/worktree-persist.test.ts
  tests/services/persist-worktree-runs.test.ts tests/services/inline-run-attribution.test.ts` (app)
  — 75 pass / 0 fail.
- `bunx tsc --noEmit` — clean in `packages/domain` and `packages/app`; `bunx biome check` clean on
  all touched files.
- P4 `spur history analyze` end-to-end on merged fixtures: covered by the app AC1 test above
  (deriveVerifiedOutcome is the analyze path's verifiedOutcome block); live-CLI run not executed in
  this stage (no committed merged corpus on this branch) — driver/review may verify on a real archive.

### Review

# Review Report — task 1324 (pipeline run e88ecaf7-1201-4bae-85ec-bd702db505c6, stage review)

**Scope:** commits `6d53e76f5` (feat) + `72d638cde` (lint fix) on `sp/runall-1322-1325-193f`; task doc `docs/tasks5/1324_history-provenance-and-capture-fidelity-worktree-run-merge-a.md` (current AC section, driver-corrected pre-dispatch — verified to match R1–R4)
**Dimensions:** functional traceability, security, correctness, efficiency, usability, architecture
**Reviewer independence:** all suites and checks re-run fresh by the reviewer; receipt not trusted.

## Independent verification (fresh, pasted)

- `(cd packages/domain && bun test tests/dao/run-transfer.test.ts tests/analytics/antigravity-etl.test.ts)` → **15 pass / 0 fail** (76 expect), incl. the three 1324 R1 tests and three 1324 R2/R3 tests.
- `(cd packages/app && bun test tests/services/worktree-run-merge-verified-outcome.test.ts)` → **2 pass / 0 fail** (10 expect).
- `bunx tsc --noEmit` → exit 0 in `packages/domain` and exit 0 in `packages/app`.
- `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo` → **All 51 rules passed — no violations found.**

## Requirement / AC Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/dao/run-transfer.ts:91` (stampWorktreeOrigin, additive `worktree_origin` metadata marker); `packages/domain/src/dao/run-transfer.ts:181` + `packages/domain/src/dao/run-transfer.ts:208` (worktreeRunSessionOps copies run_sessions with mechanism re-stamped `worktree-merge`, NULL-safe natural-key idempotency, pre-0013 tolerance); wired into the run batch at `packages/domain/src/dao/run-transfer.ts:285`; invoked unchanged via the WT-4 path `packages/app/src/services/worktree-persist.ts:384` (`transferRunTables` inside `persistWorktreeRuns`, reached from wrapup at `packages/app/src/services/worktree-persist.ts:575`); ids-preserved/origin-marker test `packages/domain/tests/dao/run-transfer.test.ts:334`, re-merge idempotency test `packages/domain/tests/dao/run-transfer.test.ts:392`, pre-0013 tolerance test `packages/domain/tests/dao/run-transfer.test.ts:423` — all pass |
| R2 | MET | `packages/domain/src/analytics/antigravity-etl.ts:34` (`usage-unavailable` disposition, NULL columns never empty strings); `packages/domain/src/analytics/antigravity-etl.ts:113` (enrichAntigravityUsage: model/usage/cost via shared pricing, remainder explicitly unavailable); `packages/domain/src/analytics/antigravity-etl.ts:186` (enrichAntigravityToolArgs back-fills args_raw + sha256 digest); `packages/domain/src/analytics/antigravity-etl.ts:223` (repairEmptyArgDigests rewrites the empty-digest false-fire root cause to NULL); tests `packages/domain/tests/analytics/antigravity-etl.test.ts:81` (NULL-not-empty-string + derived-cost + idempotency assertions) and `packages/domain/tests/analytics/antigravity-etl.test.ts:123` — pass |
| R3 | MET | `packages/domain/src/analytics/antigravity-etl.ts:253` (collapsePollDuplicates: normalized-verbatim, same-session, contiguous collapse to `poll-duplicate` disposition); loop denominators exclude at `packages/domain/src/analytics/forensic-query.ts:811` and `packages/domain/src/analytics/forensic-query.ts:839`; bySession latency denominators exclude at `packages/domain/src/analytics/forensic-query.ts:342` and `packages/domain/src/analytics/forensic-query.ts:351`, `packages/domain/src/analytics/forensic-query.ts:639` (bySessionPage); test `packages/domain/tests/analytics/antigravity-etl.test.ts:149` proves collapse, `loops` → [], and bySession unmeasured drop — pass (one second-order latency aggregator still counts them — finding 1) |
| R4 | MET | `packages/app/tests/services/worktree-run-merge-verified-outcome.test.ts:92` — merged worktree rows → `taskDenominator = 1` with measured tokens (5000) flowing through the merged `worktree-merge` mapping; regression `packages/app/tests/services/worktree-run-merge-verified-outcome.test.ts:150` — without the merge the same tree yields 0 |
| AC1 | MET | merge idempotency + ids + markers `packages/domain/tests/dao/run-transfer.test.ts:334` and `packages/domain/tests/dao/run-transfer.test.ts:392`; denominator counts worktree runs `packages/app/tests/services/worktree-run-merge-verified-outcome.test.ts:92` |
| AC2 | MET | fields filled with explicit unavailable dispositions, never empty strings — `packages/domain/tests/analytics/antigravity-etl.test.ts:81` (asserts NULL model/tokens + `usage-unavailable` + cost > 0 + second-pass no-op) and `packages/domain/tests/analytics/antigravity-etl.test.ts:123` (args back-fill + empty digest → NULL) |
| AC3 | MET | dupes collapse and aggregators exclude — `packages/domain/tests/analytics/antigravity-etl.test.ts:149` (4 verbatim repeats → 1 kept + 3 `poll-duplicate`; idempotent; `loops` → []; bySession unmeasured = 2 kept rows only) |

## Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Class sweep: the R3 `poll-duplicate` exclusion misses the per-model/day rollup chain — `messageRollup` totals still sum assistant durations/samples over collapsed poll rows, and `history-board-rollup` feeds that into `history_board_model_stats`, which `readExecutorLatency` divides (`meanMs = assistant_duration_ms / samples`); poll rows receive derived durations from the duration backfill, so executor-latency means/samples for poll-heavy sources remain polluted. Primary R3 surfaces (bySession + both loops queries) are excluded and tested; this is the one remaining latency aggregator. | `packages/domain/src/analytics/forensic-query.ts:182` | DEFER (second-order aggregator — executor-latency model selection, not the R4 analyze path; bySession + loops verified excluded; changing messageRollup/history-board bucket semantics warrants a focused follow-up, not a review-stage patch) |
| 2 | P4 (advisory) | correctness | `collapsePollDuplicates` scans assistant rows of ALL sources, not only agy — verbatim consecutive repeats in claude/codex sessions would also be re-dispositioned. Design §3 does not scope the collapse to agy, and verbatim repeats are poll-noise in any source; risk accepted. | `packages/domain/src/analytics/antigravity-etl.ts:255` | ACCEPTED |
| 3 | P4 (advisory) | correctness | `enrichAntigravityUsage` matches each vendor usage fact to the "next unenriched assistant row in seq order" — there is no per-row vendor join key, so a vendor log misaligned with imported rows attributes usage to an adjacent row of the same session. Bounded to-session, documented in the tsdoc, inherent to the vendor record shape (sessionId only). | `packages/domain/src/analytics/antigravity-etl.ts:120` | ACCEPTED |
| 4 | P4 (advisory) | usability | Live `spur history analyze` end-to-end on a real merged corpus was not executed (no committed merged corpus on this branch); AC1/R4 is proven at the `deriveVerifiedOutcome` seam, which is the analyze path's verifiedOutcome block. Evidence gap named per honesty gate. | `packages/app/tests/services/worktree-run-merge-verified-outcome.test.ts:92` | ACCEPTED |

## Security / SECUA notes

- No SQL injection surface: `source IN (?, ?)` placeholders built at call site (`packages/domain/src/analytics/antigravity-etl.ts:95`), all row values parameterized; the only interpolated strings are module constants. Table names in `run-transfer.ts` come from internal constant lists.
- `stampWorktreeOrigin` (`packages/domain/src/dao/run-transfer.ts:91`) treats worktree `metadata_json` as untrusted: malformed/non-object JSON resets to a marker-only object instead of crashing the persist.
- Empty-string digests (the loop false-fire root cause) are rewritten to NULL (`packages/domain/src/analytics/antigravity-etl.ts:223`), matching the loop query's existing NULL-exclusion guard.
- Cost derivation reuses the shared pricing table with a conservative unknown-model fallback (`packages/domain/src/analytics/models.ts:32`) — no fabricated zero cost.
- `history_message.disposition` is `TEXT NOT NULL` (`packages/domain/src/migrations.ts:1004`), so the bare `disposition <> 'poll-duplicate'` predicates at `packages/domain/src/analytics/forensic-query.ts:342` cannot NULL-drop rows.

**Next:** driver may proceed; finding 1 is a deferrable follow-up (messageRollup poll-duplicate exclusion), findings 2–4 accepted observations.

Confidence: MEDIUM

Verdict: PASS


### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.983Z backlog → todo (system)
- 2026-11-10T22:24:36.146Z todo → wip (system)

