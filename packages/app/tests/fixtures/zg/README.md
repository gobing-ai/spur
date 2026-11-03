# zg golden fixtures

Captured from installed `zg 0.2.2` against this repository (2026-11-03, feature A34 / task 1285).
A zg upgrade that changes the CLI grammar must fail `search-zg.test.ts` fixture comparisons
instead of failing silently in production.

- `query-hybrid.txt` — `zg query --hybrid "how is a paused workflow resumed" --limit 3`
- `query-docs-heading.txt` — same form scoped `-g '*.md'` (heading metadata)
- `query-code-symbols.txt` — code hits with `symbol:`/`scope:` metadata and multi-line ranges
- `status-stale.txt` — `zg status` with a stale index (first glyph `!`)
- `status-missing.txt` — hand-written from observed output: index not configured (first glyph `?`)
- `malformed.txt` — hand-written unrecognized output (no `query groups (` header)

Missing-index behavior (not a fixture file): `zg query` exits 1 with stderr containing
`[INDEX_MISSING]` (observed against an un-indexed tree).
