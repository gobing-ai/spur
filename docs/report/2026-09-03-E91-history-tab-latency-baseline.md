# E91 History Tab Latency — Measured Baseline and No-Regression Result

**Date:** 2026-09-03 (protocol) · 2026-09-04 (measurement) · **Feature:** E91 — History read path materialized-only
**Tasks:** 0741 · 0743 · 0744 (landed) · 0745 (this verification task)
**Pre-change tree:** `0f896a8e4` (E91 merge base, detached worktree) · **Post-change tree:** `4273b8786`
**Provenance:** binary `bun run apps/cli/src/index.ts` (source-local, both trees) ·
importer `@gobing-ai/ts-llm-jsonl-importer` `0.4.55` (pre) / `0.4.56` (post)
**Corpus:** 1,809,612 messages · 494,215 tool calls · 4.10 GB database (`VACUUM INTO` snapshot of the live `.spur/spur.db`)

---

## What this record is

E91's value claim is a latency claim; its central constraint is a no-change claim. This record holds
the measured pre-change and post-change medians for the History board's six tabs and the
no-regression protocol that gates them.

## Protocol (stated before measuring, frozen)

- Each tab's latency = **median of `LATENCY_SAMPLE_COUNT` (5) runs** — never a single sample or a mean.
- A tab **regresses** when its post-change median exceeds its baseline median by more than
  `LATENCY_NOISE_TOLERANCE_RATIO` (0.30). The ratio is set from the observed re-GROUP BY variance
  (0.087–0.112 s, ~29%); a tolerance below the measured noise band would fail spuriously.
- Measurements run through the source-local CLI (`bun run apps/cli/src/index.ts`), never a global
  `spur`, and record the binary path + resolved importer version (R8).
- Improvement is recorded but is **not** the gate; this task's gate is no regression.

## How the two trees were made comparable

A pre-change measurement needs the pre-change **schema**, not just the pre-change code: run against a
forward-migrated database, the old tree falls through to its cold no-rollup path and the number
measures a fallback it never shipped.

1. `VACUUM INTO` a consistent snapshot of the live WAL-mode `.spur/spur.db` (a plain `cp` of a
   WAL database yields `SQLITE_CORRUPT`), duplicated to `corpus-pre.db` and `corpus-post.db`.
2. `corpus-pre.db` had the E91 board schema inverted back to the pre-E91 shape — migration 0035's
   column additions reversed, the E91-only tables (`history_board_dimension_daily`,
   `history_board_kpi_window`, `history_board_rollup_watermark`, `history_board_rollup_bucket`)
   dropped, `history_board_tool_stats` restored to its pre-E91 columns.
3. Each tree ran the identical harness (`apps/cli/.spur/e91bench/measure.ts`): clear every
   materialized board table, rebuild rollups with **that tree's own** refresh code, then take the
   median of 5 reads per tab. Inputs are parsed through the `@gobing-ai/spur-contracts` schemas, so
   the timed call is the exact shape the endpoint receives.
4. Payload byte counts are recorded per tab, proving each timed call returned real data rather than
   short-circuiting on an empty result.

## Measured result — all six tabs, `range=all`

| Tab | Pre median (ms) | Post median (ms) | Post/Pre | Change | Regressed? |
| --- | ---: | ---: | ---: | ---: | --- |
| `summary` | 99.9 | 21.3 | 0.21 | **−78.7%** | no |
| `timeline` | 3896.9 | 3251.9 | 0.83 | −16.6% | no |
| `tool-using` | 1253.0 | 1252.2 | 1.00 | −0.1% | no |
| `sessions` | 0.7 | 0.1 | 0.14 | **−85.7%** | no |
| `insights` | 39.4 | 35.9 | 0.91 | −8.9% | no |
| `sources` | 1.1 | 0.6 | 0.55 | −45.5% | no |

**No tab regresses.** Every tab's post/pre ratio is ≤ 1.00, well inside the 1.30 tolerance, so
`assertNoRegression` passes for all six (R7).

Per-sample values and payload sizes for both runs are in the harness output
(`pre.json` / `post.json`, `sampleCount: 5`).

Notes on the shape of the result:

- **`summary` and `sessions` are the tabs E91 targeted**, and they carry the gains: Summary now reads
  precomputed KPI/dimension rollups instead of re-aggregating, and Sessions reads
  `history_board_session_stats` instead of running the 2.3 s `bySession` aggregation.
- **`timeline` and `tool-using` are not materialization targets.** ADR-103 permits per-message
  drill-down by `record_hash` point lookup, which is what they do; they are measured as regression
  guards, and neither regressed. Their cost is dominated by serializing a 5.7 MB / 4.9 MB payload.
- **`sources` and `insights`** were already reading rollups pre-change; the gains are the new
  covering indexes.

## Refresh cost (not a tab gate)

Full `refreshHistoryRollups` over the same corpus: **34,429 ms pre → 44,148 ms post** (+28%). The
post-change refresh materializes strictly more (`history_board_dimension_daily`,
`history_board_kpi_window`, the bucket ledger), which is what buys the read-side gains above. Refresh
is not one of the six tabs and is not covered by R7's no-regression gate.

### Delta-refresh scaling (0741 R8/R9)

Refresh cost in normal operation is the **delta** refresh, not the full rebuild. Measured with the
delta held constant at 400 messages while the corpus grows 18×, on corpora built from this same
database (`apps/cli/.spur/e91bench/scale.ts` + `delta-class.ts`: clear every board table, full-rebuild,
import the delta, time `refreshHistoryBoardRollupsIncremental` through a statement-attributing proxy):

| | 100,000 msgs | 400,000 msgs | 1,810,110 msgs | growth over 18× corpus |
| --- | ---: | ---: | ---: | ---: |
| Full rebuild (wall) | 2,902 ms | 12,631 ms | 45,565 ms | 15.7× |
| Delta refresh (wall) | 390 ms | 1,172 ms | 4,794 ms | 12.3× |
| Delta / full | 13.4% | 9.3% | **10.5%** | — |
| — per-bucket derivations | 144 ms | 179 ms | 324 ms | **2.3×** |
| — recompute-beyond-delta derivations | 292 ms | 1,167 ms | 5,743 ms | 19.7× |

The two tier rows are instrumented per-statement times and sum above wall clock, because a `db.batch`'s
statements are attributed individually; the ratio row is wall clock.

The split is the point. The **per-bucket** tier — the 5-minute buckets, `history_daily_stats`,
`history_board_source_daily`, `history_board_session_stats`, and the ledger/watermark/day-scoped
bookkeeping — is bounded by materialized bucket and day count, not by row count, which is what 0741 R8
asserts. The **recompute-beyond-delta** tier has no bounded-candidate path today and scales with the
corpus: `loops()`'s `filtered_messages` CTE (3,547 ms at 1.81M), the three `topStepsBy*` (1,376 ms),
`sourceSummary`'s `COUNT(DISTINCT source_file)` (604 ms), and `applyToolAliases`' full-table UPDATE
(96 ms). 0741 R9 budgets that tier at its measured cost; task 0763 owns bounding it.

## Where the numbers live

- `HISTORY_TAB_BASELINE`, `LATENCY_SAMPLE_COUNT`, `LATENCY_NOISE_TOLERANCE_RATIO`,
  `median`, `assertNoRegression`, `resolveMeasurementProvenance`, `measureTabLatency` —
  `scripts/commands/history-latency-measure.ts`.
- Diff freeze over the frozen surfaces — `scripts/commands/history-surface-freeze-check.ts`.
