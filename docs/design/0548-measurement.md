# 0548 — Incremental import + analyze cost (real data)

Measured 2026-08-15 on this machine. Source-local CLI only.

## Provenance

Every timed invocation used:

```
bun run apps/cli/src/index.ts history import …
```

`--json` `provenance` on each run:

| Field | Value |
| --- | --- |
| `binary` | `/Users/robin/xprojects/spur-new/apps/cli/src/index.ts` |
| `importer` | `@gobing-ai/ts-llm-jsonl-importer@0.4.32` |

`which spur` resolved a global binary; it was **not** used. Raw log: `/tmp/e3-0548-measure.log`.

## Steady-state incremental (`--mode incremental --dry-run`)

Condition the trigger will actually run in: shortly after a previous import (checkpoints already current). Dry-run performs the same scan/parse without writing.

| Source | Wall-clock (ms) | Files scanned | Records imported (dry-run) | Status |
| --- | ---: | ---: | ---: | --- |
| claude | 418 | 320 | 454 | ok |
| codex | 1 358 | 1 370 | 0 | ok |
| pi | 2 537 | 1 393 | 11 874 | ok |
| omp | 2 056 | 882 | 4 056 | ok |
| agy | 1 735 | 234 | 11 062 | degraded |
| grok | 2 391 | 486 | (see log) | ok |
| **Total** | **10 495** | | | |

agy was `degraded` (parse/validation skips) — counted, not dropped.

## Analyze (separate from import)

| Step | Wall-clock (ms) |
| --- | ---: |
| `history analyze --out /tmp/e3-0548-analyze.json` | **33 150** |

Analyze is ~3× the six-source incremental import. A single combined number would have hidden that.

## Cold / backlogged bound (`--mode full --dry-run`)

Upper bound for the first firing after an idle period. Full scan+parse, no write.

| Source | Wall-clock (ms) |
| --- | ---: |
| claude | 5 214 |
| codex | 9 460 |
| pi | 8 184 |
| omp | 14 712 |
| agy | 2 740 |
| grok | 18 634 |
| **Total** | **59 156** |

Backlog size: full-fidelity session files as scanned (claude 320, codex 1370, pi 1393, omp 882, agy 234, grok 486). grok's full dry-run also reported `reconciliation.staleTargetRows: 21910`.

Write cost vs dry-run was not re-measured as a third pass: dry-run already does the scan/parse work the trigger pays; persist is dominated by the same parse. The 33 s analyze is the larger term either way.

## Recommended cadence (R5)

- **Do not run the refresh inline on an operation.** Incremental import is ~10.5 s and analyze is ~33 s. That is acceptable as a background job; it is not acceptable on the hot path.
- **Coalesce a burst to one refresh.** Default `history.refresh.debounce_ms: 60000` (60 s). The window is sized from analyze (33 s) plus incremental import (10.5 s): do not start a second refresh while the first is still cheaper to join.
- **Keep import and analyze on the same job for v1** (`HistoryService.daily`). A later split (frequent import, lazier analyze) is justified by the 3× gap but is out of this measurement's wiring.
- **Cold start is ~59 s** of full dry-run scan. The first firing after a long idle should stay background-only; do not shrink the debounce to “per operation” until analyze is split off.

0549 must cite this file for `debounce_ms` and must not pick a window before reading these figures.
