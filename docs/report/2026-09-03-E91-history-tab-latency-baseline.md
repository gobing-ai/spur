# E91 History Tab Latency — Baseline and No-Regression Protocol Record

**Date:** 2026-09-03 · **Feature:** E91 — History read path materialized-only
**Tasks:** 0741 · 0743 · 0744 (landed) · 0745 (this verification task)
**Branch:** `sp/runall-e91-d93df5` · **Merge base:** `main` `0f896a8`
**Provenance:** binary `bun run apps/cli/src/index.ts` (source-local) · importer `@gobing-ai/ts-llm-jsonl-importer` `0.4.55`
**Corpus (Background):** 1,791,462 messages · 494,215 tool calls · 4.20 GB database

---

## What this record is

E91's value claim is a latency claim; its central constraint is a no-change claim. This record
captures the pre-change latency reference for the History board's six tabs, and the no-regression
protocol that gates them.

**Provenance caveat (PARTIAL, R8 pattern from 0741).** The E91 changes (0741/0743/0744) were already
in this tree when 0745 ran, so a genuine live pre-change baseline could not be re-captured. The
per-tab figures below are the task Background's recorded reference values, **not** a live median.
The live post-change median (fresh rollups, `LATENCY_SAMPLE_COUNT` runs) requires the real 1.79M-row
corpus and is recorded in this document as a residual risk, matching 0741's R8 PARTIAL disposition.

## Protocol (stated before measuring, frozen)

- Each tab's latency = **median of `LATENCY_SAMPLE_COUNT` (5) runs** — never a single sample or a mean.
- A tab **regresses** when its post-change median exceeds its baseline median by more than
  `LATENCY_NOISE_TOLERANCE_RATIO` (0.30). The ratio is set from the Background's own observed
  variance: the re-GROUP BY figure spans 0.087–0.112 s (~29%), so a stated tolerance below the
  measured noise band would fail spuriously.
- Measurements run through the source-local CLI (`bun run apps/cli/src/index.ts`), never a global
  `spur`, and record the binary path + resolved importer version (R8).
- Improvement is recorded but is **not** the gate; this task's gate is no regression.

## Recorded reference baseline (from Background figures)

| Tab | Baseline | Source figure (Background) |
| --- | --- | --- |
| `summary` | 0.001 s (1 ms) | rollup point read ~0.001 s |
| `timeline` | 1.29 s (1290 ms) | consolidated `toolSequenceQuery` 1.29 s |
| `tool-using` | 4.17 s (4170 ms) | `byTool` 4.17 s |
| `sessions` | 2.30 s (2300 ms) | `bySession` 2.30 s |
| `insights` | ~0.10 s (100 ms) | rollup re-GROUP BY 0.087–0.112 s (midpoint) |
| `sources` | 43.9 s (43900 ms) | full `refreshHistoryRollups` 43.9 s |

**Sources caveat.** The Background supplied a corpus-scale **refresh/ETL** figure for the Sources
surface (43.9 s), not a measured Sources-tab read. The Sources read-path baseline is not separately
recorded in Background and requires a live measurement. Recorded here as a documented uncertainty.

## Post-change measurements — PARTIAL / residual risk

The post-change median for each tab (fresh rollups, same protocol) **cannot be computed here**: it
requires the live 1.79M-row corpus, not the test fixtures in this tree. Leave those cells unfilled
rather than fabricating numbers.

| Tab | Baseline (ms) | Post median (ms) | Ratio | Regressed? |
| --- | --- | --- | --- | --- |
| `summary` | 1 | — | — | — |
| `timeline` | 1290 | — | — | — |
| `tool-using` | 4170 | — | — | — |
| `sessions` | 2300 | — | — | — |
| `insights` | 100 | — | — | — |
| `sources` | 43900 | — | — | — |

**Residual risk:** the no-regression gate for all six tabs is unverified against live data. The
harness (`scripts/commands/history-latency-measure.ts`) implements the protocol and assertion
(`assertNoRegression`), and `measureTabLatency` times a provided runnable per tab; wiring the
per-tab CLI invocation and capturing the real corpus medians is a live-corpus follow-up, matching
0741's R8 disposition.

## Where the numbers live

- `HISTORY_TAB_BASELINE`, `LATENCY_SAMPLE_COUNT`, `LATENCY_NOISE_TOLERANCE_RATIO`,
  `median`, `assertNoRegression`, `resolveMeasurementProvenance`, `measureTabLatency` —
  `scripts/commands/history-latency-measure.ts`.
- Diff freeze over the frozen surfaces — `scripts/commands/history-surface-freeze-check.ts`.
