---
template: feature-impl
schema_version: 1
name: "Cut spur history analyze over to SQL aggregation with the forensic query set and versioned JSON artifact"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0466"]
ac_numbering: task-local
created_at: "2026-08-07T06:45:01.675Z"
updated_at: "2026-08-07T20:55:40.816Z"
---

## 0474. Cut spur history analyze over to SQL aggregation with the forensic query set and versioned JSON artifact

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0466**, which
populates the `history_message` and `history_tool_call` tables this reads.

`spur history analyze` today loads every ETL record into memory, prices each one, and folds them into
an `AnalyticsSummary` (`packages/app/src/services/history-service.ts:73-78`). That is a spend
dashboard: it answers "what did I spend" and cannot answer "which tool loop burned this session".

**Two independent reasons to move aggregation into SQL, both settled by measurement:**

1. **Memory.** Benchmarked at 600k rows — roughly this machine's real claude+codex corpus of ~590k
   lines — the load-all-and-fold path allocates **+865 MB heap** and takes 652 ms; the equivalent
   `GROUP BY` takes 286 ms at constant memory. `queryAllEtlRecords` issues a bare
   `SELECT payload_json` with no LIMIT, then `history-service.ts` holds three full-corpus arrays at
   once. Growth is measured at ~10.4 MB/day (~+280k lines/month), so the current path crosses ~1.3 GB
   within a month. This is linear in corpus size by construction, not a tuning problem.
2. **Capability.** Per-step duration, per-tool result bytes, and repeated-call loop detection cannot
   be computed from `history_etl_*` at all — they need `history_tool_call` rows.

The full query set, artifact schema, selector list, and the reuse assessment for every existing
analytics helper are specified in task 0464 `### Design` (§ R1, R2, R3, R4, R5). **Read that section
before starting; do not re-derive these decisions.**

Two anti-patterns it calls out explicitly: do not carry `etlToCostRecord`'s 4-chars-per-token estimate
(`packages/domain/src/analytics/query.ts:125-131`) into the artifact — an unflagged estimate reaching
a cost total is the fabrication the forensic contract exists to end; and do not write unbounded
per-line error arrays into the artifact.

**Live regression this task owns (handed off from task 0468 R4, 2026-08-07).** `analyze` is currently
blind to every source task 0466 converted to a custom mapper — `claude`, `codex`, `pi`, `omp`, `grok`,
and `agy` all now write `history_message`/`history_tool_call`, but `queryAllEtlRecords`/`SOURCE_TABLES`
(`packages/domain/src/analytics/query.ts:8-19`) read only `history_etl_*`, so those six sources return
zero records. To keep the suite honest without touching analytics production code (which this task
retires anyway, R7), task 0468 pinned the migrate-stubs `runs history analyze` test to `--source gemini`
(a still-generic sourceDefinition writing `history_etl_gemini`). This task's SQL cut-over restores
coverage for all six converted sources and removes that pin.
### Requirements
- R1 — Implement the ten forensic queries specified in task 0464 Design § R1 as SQL against history_message and history_tool_call, including per-step time cost, per-step token cost, per-step tool-call counts, repeated-call loop detection, and the unknown-record drift alarm.
- R2 — Aggregate in SQL, not in memory: no code path may load the full record set into a JavaScript array before folding. Peak heap for an analyze run must not scale with corpus size.
- R3 — Implement the six selectors from task 0464 Design § R3 (since/until, source, session, run, task, top-N), composable, each resolving against an indexed column; add the one missing index on (provenance, run_id).
- R4 — Write the versioned JSON artifact exactly as specified in task 0464 Design § R2: schemaVersion, generatedAt, selector, coverage, totals, bySource, byModel, daily, byTool, bySession, loops, warnings — at the specified path with the specified selector-digest naming.
- R5 — Carry recordsWithUsage and durationUnmeasured through to the artifact so a consumer can render unavailable rather than a fabricated zero, extending the existing cacheHitRatio never-fabricate invariant to duration.
- R6 — Bound the artifact: store error counts plus at most 20 samples per source, streaming full detail to an errors.jsonl sidecar rather than embedding unbounded arrays.
- R7 — Reuse rather than replace where task 0464 Design § R5 says to: keep cacheHitRatio and formatRatio verbatim, extend TokenTotals with the forensic dimensions, and retire aggregateCosts, accumulate, queryAllEtlRecords, and the etlToCostRecord token estimate.
- R8 — Preserve the existing human stdout summary so `spur history analyze` without artifact flags stays usable, and keep `--json` emitting the artifact shape.
### Acceptance Criteria
```gherkin
Feature: 0474 analyze answers forensic questions from SQL

  Scenario: R1 — per-step attribution is answerable
    Given a populated history_message and history_tool_call for one session
    When analyze runs with that session selector
    Then time cost by tool, token cost by tool, and tool-call counts are reported
    And repeated identical calls are surfaced as a loop finding
    And unknown-disposition records are counted as a drift signal

  Scenario: R2 — aggregation does not scale in memory
    Given a corpus large enough that loading it would exceed available heap
    When analyze runs
    Then it completes without materializing the full record set in memory
    And peak heap does not grow proportionally with the row count

  Scenario: R4 — the artifact is a contract
    Given an analyze run with a fixed selector
    When the run completes
    Then a JSON artifact is written at the specified path with a schemaVersion
    And re-running with the same selector produces the same artifact path

  Scenario: R5 — unavailable is never rendered as zero
    Given records whose duration_ms and usage are absent
    When analyze aggregates them
    Then the artifact reports how many were unmeasured
    And no fabricated zero is written in place of an unknown value

  Scenario: R6 — a mapping regression cannot produce an unbounded artifact
    Given a source producing validation errors on a large fraction of its lines
    When analyze runs
    Then the artifact holds error counts and at most 20 samples per source
    And full error detail is written to a sidecar file

Scenario: R3 — selectors compose and resolve against indexes
    Given an artifact request narrowed by time window, source, and session together
    When analyze resolves the selector set
    Then only records matching every selector are aggregated
    And the run-and-task selectors resolve against an index rather than a scan

  Scenario: R7 — retired helpers are gone and reused helpers are unchanged
    Given the SQL aggregation path is in place
    When the analytics module is inspected
    Then the never-fabricate ratio helpers are still used unchanged
    And the in-memory fold and the token-length estimate are no longer reachable

  Scenario: R8 — the existing human surface still works
    Given analyze is run with no artifact flags
    When the command completes
    Then a human-readable summary is printed to stdout as before
    And the same run with --json emits the artifact shape
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *Where does the SQL live — domain or app?* **Domain.** `packages/domain` is the sole `ts-db`
  consumer (AGENTS.md stack layout), and `analytics/` already owns the query surface. `packages/app`
  orchestrates: selector in, artifact out. Apps stay thin transports (ADR-021).
- *Who adds the `(provenance, run_id)` index?* **Spur, not ts-libs.** `history_message` is created by
  `HISTORY_IMPORT_SCHEMA_SQL` in `@gobing-ai/ts-llm-jsonl-importer`, which Spur cannot edit, so it
  lands as a Spur-side incremental migration — the same reasoning that produced
  `0005_spur_cli_run_pid` for the engine-owned `runs` table. If the importer later ships this index
  itself, `CREATE INDEX IF NOT EXISTS` makes the duplicate harmless.
- *Rename `cacheCreationTokens` → `cacheWriteTokens` everywhere?* **No — only on `TokenTotals`.**
  The aggregate now reads `history_message.cache_write_tokens`, so the bucket takes the column's
  name. `CostRecord` keeps `cacheCreationTokens` because it mirrors the provider's
  `cache_creation_input_tokens` field and `run-cost.ts` still consumes it. Two layers, two names, on
  purpose — do not "tidy" this into one.
- *How is R2 (constant memory) actually verified?* **Structurally, not by benchmark.** A heap
  measurement is worth recording but will not fail in CI. The regression guard is the assertion that
  every analyze query carries a `GROUP BY` or a `LIMIT` — a reviewer or a test can point at the
  violation. A benchmark that passes on a small fixture proves nothing about a 600k-row corpus.
- *Does the human stdout summary keep its own aggregation path?* **No.** It renders from the
  artifact. Two aggregation paths would eventually give two different answers to the same question.
- *Is `formatSummary` moved in this task?* **No.** 0464 § R5 says it becomes a section of `report` —
  that move is **0469's**. This task keeps it working against the artifact-derived totals and exports
  `formatRatio` so 0469 can reuse it. Moving it here would straddle two review contexts.

**Deferred, with the condition that reopens each:**

- `--project` / `--cwd` selector — `cwd` is already on `history_message`, so it is additive whenever
  demand appears. Not a seventh axis today (0464 § R3).
- Workflow run-cost attribution still reads `history_etl_*` and is blind to all six converted
  sources. **Not this task's** — see 0467 `### Q&A`. Reopen as its own E1 ticket; do not absorb it
  while touching `analytics/`.

**Ordering.** Dependency `0466` is **done** — the contract tables are populated. This task blocks
0469 (renders the artifact) and 0470 (fills `coverage[]`), so the artifact shape must be right before
either starts; a post-hoc change is a `schemaVersion` bump.
### Design
**WHAT.** Replace `analyze`'s load-all-and-fold path with SQL aggregation over `history_message` /
`history_tool_call`, and make its output a versioned JSON artifact on disk. The stdout summary stays;
the in-memory corpus scan goes.

**WHY.** Two independent, already-settled reasons — memory (+865 MB at 600k rows, linear in corpus
size by construction) and capability (per-step duration, result bytes, and loop detection cannot be
computed from `history_etl_*` at all). Both are measured in task 0464 `### Design` § R4. **Do not
re-derive them; read 0464 § R1–R5 before writing code.** This ticket implements that decision.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/domain/src/analytics/forensic-query.ts` | **New.** The ten Q1–Q10 queries as functions over a `DbAdapter`. Each returns typed rows; none returns the raw corpus. Sole owner of the SQL. |
| `packages/domain/src/analytics/artifact.ts` | **New.** Artifact types + `HISTORY_ARTIFACT_SCHEMA_VERSION`, selector canonicalization, and `selectorDigest()`. Pure — no I/O. |
| `packages/domain/src/analytics/types.ts:40-52` | Extend `TokenTotals` (see "Frozen type changes"). |
| `packages/domain/src/analytics/costs.ts:81-87,127-131` | `cacheHitRatio` + `formatRatio` unchanged. Export `formatRatio` (currently module-private) so 0469's renderer can reuse it. |
| `packages/domain/src/analytics/costs.ts:29-37,40-70` | Delete `accumulate` and `aggregateCosts`. |
| `packages/domain/src/analytics/query.ts:55-72,119-144` | Delete `queryAllEtlRecords` and `etlToCostRecord`. Keep `queryEtlRecords`, `parsePayload`, `extractClaudeTokens`, `SOURCE_TABLES` — `run-cost.ts` still uses them. |
| `packages/app/src/services/history-service.ts:73-78` | `analyze()` becomes: resolve selector → run queries → assemble artifact → write artifact + sidecar → return artifact. |
| `apps/cli/src/commands/history.ts:30-38` | New selector flags; `--json` emits the artifact; no flags still prints the human summary. |
| `drizzle/0009_spur_cli_history_message_run_idx.sql` + `packages/domain/src/migrations.ts` | The one added index (see below). |
| `docs/04_DESIGN.md` §`spur history analyze` | Same-commit surface update (T3). |

**Frozen names — freeze these; do not rename during implementation.**

- `HISTORY_ARTIFACT_SCHEMA_VERSION = 1` (integer const).
- Types: `HistoryArtifact`, `ArtifactSelector`, `CoverageEntry`, `ForensicTotals`, `ToolStat`,
  `SessionStat`, `LoopFinding`, `ArtifactWarning`.
- `selectorDigest(selector: ArtifactSelector): string` — first 8 hex of sha256 over the
  **canonicalized** selector (keys sorted, `undefined` normalized to `null`, source list sorted).
  Canonicalization is what makes yesterday's and today's artifacts diffable; an unstable digest
  silently breaks the whole daily loop.
- Artifact path: `.spur/reports/history/<YYYY-MM-DD>/analyze-<selectorDigest>.json`.
  Sidecar: `analyze-<selectorDigest>.errors.jsonl` beside it.
  Pointer: `.spur/reports/history/latest.json` → newest artifact.
- CLI flags on `spur history analyze`: `--since <iso>`, `--until <iso>`, `--source <s|all>`,
  `--session <id>`, `--run <runId>`, `--task <wbs>`, `--top <n>` (default **20**), `--out <path>`,
  `--json`. Six selectors exactly — 0464 § R3 explicitly rules `--project`/`--cwd` out of scope.

**Frozen type changes to `TokenTotals`** (`packages/domain/src/analytics/types.ts:40-52`) — additive
plus one rename:

- Add `messages`, `toolCalls`, `durationMs`, `durationUnmeasured`.
- Rename `cacheCreationTokens` → `cacheWriteTokens` to match the landed
  `history_message.cache_write_tokens` column. This is a **breaking rename across the package** —
  update `emptyTotals`, `formatSummary`, and every test in the same commit. `CostRecord`
  (`types.ts:2-37`) keeps `cacheCreationTokens`; it maps the ETL payload's provider field name and
  `run-cost.ts` still consumes it. Two names, two layers, deliberately.
- `recordsWithUsage` stays and stays load-bearing: with `durationUnmeasured` it is the denominator
  that lets 0469 print `n/a` instead of a fabricated `0`.

**Algorithm — the one non-obvious rule.** Every aggregate is a `GROUP BY` whose result set is bounded
by the selector or by `--top`. **No code path may materialize the row set first.** Concretely: no
`SELECT ... FROM history_message` without an aggregate or a `LIMIT`; no `rows.map(...)` over a
corpus-sized array; `bySession` and `byTool` carry `ORDER BY ... LIMIT ?`. If a reviewer can point at
an array whose length grows with the corpus, R2 has failed regardless of what a benchmark says.

**Selector precedence.** Selectors compose as `AND` — narrowing, never widening. `--source all` means
"no source predicate", not a ten-way `IN`. Absent `--since` means no lower bound. `--top` bounds only
`bySession` / `byTool`, never `totals` / `bySource` / `byModel` / `daily`, which must stay complete
for the artifact to be a faithful rollup.

**The one added index.** `CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON
history_message(provenance, run_id);` — the five 0455 indices cover every other selector. The table is
created by `HISTORY_IMPORT_SCHEMA_SQL` in ts-libs, which Spur cannot edit, so add it Spur-side as
`0009_spur_cli_history_message_run_idx` in **both** `drizzle/` and `CLI_MIGRATIONS`
(`packages/domain/src/migrations.ts:190+`), following the `0005_spur_cli_run_pid` precedent.
`CREATE INDEX IF NOT EXISTS` makes it idempotent.

**Artifact bounding (R6).** `coverage[].parseErrors` / `validationErrors` are **counts**, plus at most
**20 samples per source** in the artifact; full detail streams to the `.errors.jsonl` sidecar. This is
not hypothetical: 0464 probed `spur history import --source gemini --json` and the unbounded error
array alone overran a 64 KB pipe buffer. At 590k lines a mapping regression produces a
multi-hundred-MB "report".

**Anti-patterns — each one is a specific mistake that has a reason to be tempting:**

- Do **not** carry `etlToCostRecord`'s 4-chars-per-token estimate
  (`packages/domain/src/analytics/query.ts:125-131`) into the artifact. An unflagged estimate reaching
  a cost total is exactly the fabrication this contract exists to end. It is deleted, not ported.
- Do **not** write a fabricated `0` where a value is unknown. NULL `duration_ms` and absent `usage`
  are facts; carry them as `durationUnmeasured` / `recordsWithUsage`.
- Do **not** embed unbounded per-line error arrays in the artifact (see R6 above).
- Do **not** keep `aggregateCosts` around "for the non-forensic path". Two aggregation paths means two
  answers to the same question; the stdout summary must render from the artifact.
- Do **not** delete `queryEtlRecords` / `SOURCE_TABLES` / `extractClaudeTokens` — `run-cost.ts` still
  reads them, and this task does not own that path.
- Do **not** widen scope to `report`, `--source all`, `daily`, or the launchd agent. Those are 0469,
  0470, 0471. This ticket ends at "the artifact is written".

**Handoff.**

- **Assumes from dep 0466 (done):** `history_message` / `history_tool_call` are populated for claude,
  codex, pi, omp, grok, agy, with the five 0455 indices in place. This task reads that contract and
  must not re-specify it.
- **Live regression this task closes (from 0468 R4):** post-0466 those six sources write only the
  contract tables, so today's `analyze` returns zero for all of them. Task 0468 pinned the
  migrate-stubs `runs history analyze` test to `--source gemini` (still a generic ETL source) to keep
  the suite honest. **Remove that pin as part of this task** and restore coverage for the six.
- **Leaves for 0469:** the artifact is the contract. Export the artifact types and `formatRatio`;
  the renderer never opens the DB. Any later shape change is a `schemaVersion` bump, so get
  `byTool` / `bySession` / `loops` right here.
- **Leaves for 0470:** `coverage[]` is written by this task but populated per-source by fan-out.
  Include the `status: 'ok' | 'failed' | 'empty'` field now so 0470 fills it rather than reshaping
  the artifact.
- **Not in scope, still broken:** workflow run-cost attribution (`run-cost.ts:103`) reads
  `history_etl_*` and is blind to all six converted sources. This task does not fix it (see 0467
  Q&A); do not absorb it.

**ADR: no.** 0455 already routed the structural decision (the two-table contract) to `docs/00_ADR.md`;
0464 ruled that this consumption surface belongs in `docs/04_DESIGN.md`, same commit as the code (T3).
A future `schemaVersion` 2 would be the ADR-worthy event, not v1.
### Plan
- [ ] **0. Read 0464 `### Design` § R1–R5 first.** The query set, artifact shape, selector list, and
      per-helper reuse verdicts are already decided. Baseline `bun run lint` + `bun test packages/domain`
      green before changes.
- [ ] **1. Index migration (R3).** Add `drizzle/0009_spur_cli_history_message_run_idx.sql` and the
      matching `CLI_MIGRATIONS` entry in `packages/domain/src/migrations.ts`, following the
      `0005_spur_cli_run_pid` precedent. Verify it applies to both a fresh DB and an existing one.
- [ ] **2. Artifact types + digest (R4).** `packages/domain/src/analytics/artifact.ts`:
      `HISTORY_ARTIFACT_SCHEMA_VERSION`, the eight frozen types, and `selectorDigest()`. Test that
      canonicalization makes the digest stable across key order and source-list order, and that a
      changed selector changes the digest.
- [ ] **3. Forensic queries (R1).** `packages/domain/src/analytics/forensic-query.ts` — Q1–Q10 from
      0464 § R1 as typed functions over `DbAdapter`. Test each against an in-memory SQLite seeded with
      a small fixture session: per-tool time, per-tool tokens/result-bytes, call counts, the `>= 3`
      repeat threshold for loops, and the unknown-disposition drift count.
- [ ] **4. Selector composition (R3).** Apply the six selectors as composable `AND` predicates.
      Test that time-window + source + session together return only records matching all three, and
      assert via `EXPLAIN QUERY PLAN` that `--run` / `--task` use the step-1 index rather than a scan.
- [ ] **5. Extend `TokenTotals` (R7).** Add `messages`, `toolCalls`, `durationMs`,
      `durationUnmeasured`; rename `cacheCreationTokens` → `cacheWriteTokens` and fix every call site
      and test in the same commit. Leave `CostRecord.cacheCreationTokens` alone.
- [ ] **6. Never-fabricate carry-through (R5).** Thread `recordsWithUsage` and `durationUnmeasured`
      into every totals bucket. Test that a fixture whose `duration_ms` is entirely NULL yields
      `durationUnmeasured == toolCalls` and **no** zero duration total.
- [ ] **7. Bounded artifact + sidecar (R6).** Counts plus at most 20 samples per source in the
      artifact; full detail appended to `analyze-<digest>.errors.jsonl`. Test with a fixture producing
      >20 errors for one source: assert exactly 20 samples, the true count, and the sidecar holding
      the remainder.
- [ ] **8. Artifact writer.** Write to
      `.spur/reports/history/<YYYY-MM-DD>/analyze-<digest>.json`, refresh the `latest.json` pointer,
      honor `--out`. Test that the same selector twice yields the same path.
- [ ] **9. Service cut-over (R2).** Rewrite `HistoryService.analyze`
      (`packages/app/src/services/history-service.ts:73-78`) onto the SQL path. Delete
      `aggregateCosts`, `accumulate`, `queryAllEtlRecords`, `etlToCostRecord`. Confirm no remaining
      caller — `run-cost.ts` must still compile against the helpers that survive.
- [ ] **10. Prove R2, do not assert it.** Add a test that fails if any analyze code path materializes
      the full record set: assert every aggregate query carries a `GROUP BY` or a `LIMIT` (no bare
      `SELECT ... FROM history_message`). Optionally record a heap measurement in `### Testing`, but
      the structural assertion is the regression guard — a benchmark alone will not fail in CI.
- [ ] **11. CLI surface + human summary (R8).** Add the nine flags. No artifact flags ⇒ the existing
      stdout summary, now rendered from the artifact; `--json` ⇒ the artifact shape. Test both.
- [ ] **12. Remove the 0468 test pin.** The migrate-stubs `runs history analyze` test is pinned to
      `--source gemini`; unpin it and assert coverage for the six converted sources.
- [ ] **13. Docs (T3).** Update `docs/04_DESIGN.md` §`spur history analyze` — flags, artifact path,
      `schemaVersion` — in this commit.
- [ ] **14. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test`,
      `bun run build` green. Use targeted `bun test <file> --test-name-pattern <test>` while iterating;
      full `spur-check` at most twice.
- [ ] **15. Record.** `### Solution` gets the `path:line` change map plus what was deleted and why;
      `### Testing` gets the commands, the R2 evidence, and the coverage claim.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
