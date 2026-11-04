# zg golden fixtures

Captured from installed `zg 0.3.0` against this repository (2026-11-04, feature A34 / task 1285).
A zg upgrade that changes the CLI grammar must fail `search-zg.test.ts` fixture comparisons
instead of failing silently in production.

- `query-hybrid.txt`: `zg --hybrid alpha --limit 3` (default `--preview short`, piped)
- `query-limit20.txt`: `zg --hybrid alpha --limit 20 --preview short` stdout (stderr warnings removed;
  truncated source ends with an indented U+2026 `…`)
- `status-ready-0.3.txt`: `zg --status` with a fresh index (glyphs restored from `cat -v`)
- `status-missing-0.3.txt`: `zg --status` in an unindexed tree
- `status-stale.txt`, `status-missing.txt`: zg 0.2.2 first-glyph status output. The parser keeps
  this rule because no 0.3.0 stale capture exists yet.
- `legacy-0.2.2-query.txt`: a zg 0.2.2 `zg query --hybrid` capture, which the parser must reject
- `malformed.txt`: hand-written unrecognized output

Missing-index behavior (not a fixture file): the query exits 1 with stderr containing
`Error[ZG.ENGINE.NOT_FOUND]`.
