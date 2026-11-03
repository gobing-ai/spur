---
schema_version: 1
name: "Hybrid search core: contracts DTO, SearchService, ZgAdapter, probe and degradation"
status: todo
template: feature-impl
created_at: 2026-11-03T16:50:38.250Z
updated_at: "2026-11-03T17:16:16.397Z"
feature_id: A34
priority: P2
tags:
  - search
  - zg
  - app

---

## 1285. Hybrid search core: contracts DTO, SearchService, ZgAdapter, probe and degradation

### Background

Feature A34 core (under A3, `spur self` family). Covers R1–R7. Spur needs one app-layer search capability: exact via rg, fuzzy via the operator-installed zg CLI, `auto` grouping (default), scope filters, optional-dependency probing and graceful degradation. zg 0.2.x prints agent markdown only (no `--json`), so one adapter isolates argv + parsing. Authoritative shapes, grammar and rules: docs/design/hybrid-search.md §2–§4 (ADR-147). This task is the dependency root for 1286, 1287 and 1289 — its exported names below are their contract.

### Requirements

- [ ] R1. Fuzzy mode returns semantic matches from the zg index.
- [ ] R2. Exact mode returns literal matches through ripgrep.
- [ ] R3. Auto mode returns exact and fuzzy groups side by side.
- [ ] R4. Search scope filters docs, code, or both.
- [ ] R5. zg is detected as an optional external dependency.
- [ ] R6. Missing zg or index degrades to exact-only search.
- [ ] R7. The zg adapter fails loudly on unrecognized output.

### Acceptance Criteria

- [ ] AC1 — Fuzzy mode returns semantic matches from the zg index
- [ ] AC2 — Exact mode returns literal matches through ripgrep
- [ ] AC3 — Auto mode returns exact and fuzzy groups side by side
- [ ] AC4 — Search scope filters docs, code, or both
- [ ] AC5 — zg is detected as an optional external dependency
- [ ] AC6 — Missing zg or index degrades to exact-only search
- [ ] AC7 — The zg adapter fails loudly on unrecognized output

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T17:16:15.948Z

- Q: `both` or `auto`? A: `auto` (operator decision). Default mode; runs fuzzy only when `zg.available && index !== 'missing'`; stale still runs fuzzy.
- Q: Parse zg markdown or drive `zg server` MCP? A: parse CLI output behind `search-zg.ts` only; no daemon management. Revisit only if zg restores `--json` or the grammar churns twice.
- Q: Score fusion across routes? A: no — groups keep their own rank; overlap only sets `matchedBy`.
- Q: zg transport mode? A: pass no `--mode`; zg's own auto uses a running server (0.28 s) or direct (1.3 s).
- Q: Relevance threshold on vector hits (zg always returns hits)? A: none; relevance is zg's concern.
- Q: Where do errors live? A: `SearchError`, `ZgOutputError` in `packages/app`; contracts hold zod wire shapes only.
- Q: Real zg in tests? A: no — unit tests inject `deps.run`/`deps.which` with golden fixtures; real zg only in the 1286 E2E.

### Design

Files (create):
- `packages/contracts/src/search.ts` — zod schemas + `searchContract` exactly as design §4 (`searchModeEnum` exact|fuzzy|auto, `searchScopeEnum`, `searchRequestSchema`, `searchHitSchema`, `searchStatusSchema`, `searchResponseSchema`, inferred types `SearchMode`, `SearchScope`, `SearchRequest`, `SearchHit`, `SearchStatus`, `SearchResponse`). Export from `packages/contracts/src/index.ts` (`export * from './search'`). Do NOT add `search` to the global `contract` object here — 1287 does that with the handlers so the router never has an unimplemented route.
- `packages/app/src/services/search-zg.ts` — `buildZgArgs(req: SearchRequest, globs: string[]): string[]` → `['query', '--hybrid', req.query, '--limit', String(req.limit), ...globs.flatMap(g => ['-g', g])]`; `parseZgQuery(stdout: string, zgVersion: string): SearchHit[]`; `parseZgStatus(stdout: string): 'ready' | 'stale' | 'missing' | 'unknown'` (first non-empty line glyph `!` → stale, `?` → missing, other glyph → ready, empty → unknown); `class ZgOutputError extends Error { zgVersion; sample }`.
- `packages/app/src/services/search.ts` — `interface SearchDeps { which(bin: string): string | null; run(cmd: string, args: string[], opts: { cwd: string; timeout: number }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }> }`; `defaultSearchDeps` (`Bun.which` + `new NodeProcessExecutor().run({ command, args, cwd, timeout, maxOutput: 2 * 1024 * 1024, rejectOnError: false })`, precedent `packages/app/src/services/anchor-qualifier.ts:252`); `searchStatus(root: string, deps = defaultSearchDeps): Promise<SearchStatus>`; `searchProject(input: unknown | SearchRequest, root: string, deps = defaultSearchDeps): Promise<SearchResponse>` (parses with `searchRequestSchema`); `scopeGlobs(scope): string[]`; `class SearchError extends Error { code: 'rg-not-installed' | 'rg-failed' | 'invalid-request' }`. Export all from `packages/app/src/index.ts` AND add subpath export `"./search": "./src/services/search.ts"` to `packages/app/package.json` `exports` (transports import `@gobing-ai/spur-app/search`, precedent `"./shell-quote"`).

Grammar (zg 0.2.2, design §2): header `query groups (N):` → `Q1 [primary]: <q>` → `hits: N` → blank; hit regex `^#(\d+) matchedBy=(fts|vector|fts\+vector) (.+?):(\d+)(?:-(\d+))?$`; metadata `^(heading|heading_level|scope|symbol): (.*)$`; source `^(\d+)\t(.*)$`; literal `...` ignored. snippet = source texts joined by `\n`, capped 300 chars. Throw `ZgOutputError` when stdout is non-empty without `query groups (`, a `#` line fails the regex, or parsed count ≠ `hits:`. Missing index: zg exit 1 + stderr `[INDEX_MISSING]` → skipped `zg-index-missing`.

Exact: `rg --json --max-count <limit> [-F unless regex] <scope+user globs as -g> -- <query> .`; parse `type:"match"` events (`data.path.text` stripped of `./`, `data.line_number`, `data.lines.text` trimmed to 300); truncate overall to `limit`; rank = order. rg exit 1 = no matches; exit 2 or spawn failure → `SearchError('rg-failed')`; rg absent → `SearchError('rg-not-installed')`.

Rules: scope globs per design §3 (docs `*.md *.mdx *.txt *.rst`; code = `!`-negations; user globs appended). Timeouts rg 10 s, zg query 15 s, zg status/version 5 s. Overlap: same path and `exact.startLine ∈ [fuzzy.startLine, fuzzy.endLine]` → both `matchedBy: ['exact','fuzzy']`. Degradation and skip reasons (`zg-not-installed`, `zg-index-missing`, `zg-timeout`, `zg-failed`, `zg-output-error`) and hints exactly as design §4. Explicit `fuzzy` mode never spawns rg; `groups.exact = null`.

Rejected: `zg --rg` for exact (breaks zg-absent mode); `zg server` MCP daemon; Spur-side score fusion; `--fts`/`--vector` value-less flags (they swallow the next token).
Invariants: never read/write `.zvec-grep/`; never run `zg index`/`zg install`; fuzzy failure never throws; rg missing in exact/auto throws; every spawn bounded by timeout and `maxOutput`.

### Plan

1. Write the failure list first as test names in `packages/app/tests/services/search.test.ts` and `search-zg.test.ts`: zg absent; index missing (exit 1 `[INDEX_MISSING]`); status `!`/`?`/ready/empty; malformed header; hit-count mismatch; zg timeout; rg absent; rg exit 1 (no matches); rg exit 2; empty/whitespace query; limit 0/101; scope docs/code/all globs; user glob ordering; overlap marking; explicit fuzzy never spawns rg; single-line hit `path:12`.
2. Capture golden fixtures (no index rebuild): `zg query --hybrid "how is a paused workflow resumed" --limit 3 > packages/app/tests/fixtures/zg/query-hybrid.txt`, a docs-heading hit fixture via `-g '*.md'`, `zg status > status-ready-or-stale.txt`; hand-write `status-missing.txt` (`? Workspace index is not configured`) and `malformed.txt`. Record the `zg version` in a fixture README line.
3. Add contracts schemas + index export.
4. Implement `search-zg.ts` until parser tests pass.
5. Implement `search.ts` (status, exact, fuzzy, auto, overlap, degradation) with injected deps.
6. Export from `packages/app/src/index.ts`.
7. `(cd packages/app && bun test tests/services/search.test.ts tests/services/search-zg.test.ts)`, `(cd packages/contracts && bun test)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R1–R7)
- Design: docs/design/hybrid-search.md §2 (zg grammar), §3 (rules), §4 (schemas, hints, skip reasons)
- ADR: docs/00_ADR.md#adr-147; ADR-021 (thin transports)
- Precedents: packages/app/src/services/anchor-qualifier.ts:252 (NodeProcessExecutor.run), packages/app/src/services/project-start.ts:227 (Bun.which), packages/contracts/src/history.ts:655 (zod + oc route style)
- Dependents: 1286 (CLI), 1287 (server + Board), 1289 (init)

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)

