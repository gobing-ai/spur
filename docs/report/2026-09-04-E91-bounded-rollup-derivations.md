# E91 Bounded Rollup Derivations — Task 0763 Re-verification

Task 0763 requires the same 400-message delta to be measured against at least three corpus scales.
The original closeout did not run that matrix; this re-verification does.

## Method

- Source: `.spur/spur.db` (1,830,480 messages at measurement time).
- Built isolated SQLite databases from the first 100,000, 400,000, and 1,810,110 real messages,
  including linked tool and skill calls. The source database was read-only.
- Started each scale with empty rollup tables, timed one full rebuild, inserted the same normalized
  400-message/400-tool-call delta (20 sessions, 100 files), then timed
  `refreshHistoryBoardRollupsIncremental`.
- Attributed the four task-owned derivations through a timing `DbAdapter`: alias update, loop findings,
  ranked steps, and source stats. Concurrent rank statements are summed, matching the attribution
  convention in the 0741 baseline.
- Runtime: Bun 1.3.14. Values are one-run developer-laptop measurements, not medians.

## Result

| Measure | 100,000 | 400,000 | 1,810,110 | Growth over 18.1x corpus |
| --- | ---: | ---: | ---: | ---: |
| Full rebuild, ms | 2,745.2 | 11,793.5 | 59,558.3 | 21.7x |
| 400-row delta refresh, ms | 69.2 | 179.7 | 313.8 | **4.5x** |
| Delta / full | 2.52% | 1.52% | 0.53% | — |
| Four bounded derivations, ms | 33.2 | 78.1 | 123.8 | **3.7x** |
| — alias update | 12.2 | 35.6 | 0.9 | — |
| — loop findings | 3.8 | 6.5 | 5.0 | — |
| — ranked steps | 12.7 | 25.5 | 82.9 | — |
| — source stats | 4.4 | 10.6 | 35.1 | — |

Both the whole delta refresh and the four task-owned derivations grow sublinearly in corpus rows.
The four-derivation total grows 3.7x while the corpus grows 18.1x.

Against the 0741 R9 baseline, whole-delta wall time falls from 390 / 1,172 / 4,794 ms to
69.2 / 179.7 / 313.8 ms. The former recompute-beyond-delta tier falls from
292 / 1,167 / 5,743 ms to 33.2 / 78.1 / 123.8 ms. This supersedes 0741's exemption for these four
derivations and satisfies 0763 R6.

## Re-verification corrections

The same pass repaired three correctness gaps found while exercising the scale matrix:

- An empty eligible-session delta is a loop-findings no-op instead of a full-corpus scan.
- `history_board_source_daily` is driven from raw per-day rows, preserving raw message counts for a
  day whose only message was removed by request-id deduplication.
- Alias scope unions already materialized sources with sources first seen in the message delta, so a
  new source is aliased on its first incremental refresh.

These are derivation changes, so `ROLLUP_DEFINITION_VERSION` advances from `v3` to `v4` and the
derivation digest is pinned under the new version.
