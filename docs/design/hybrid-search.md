---
kind: design
title: Local-first hybrid search — exact (rg) and semantic (zg) over docs and code
status: proposed
created_at: 2026-11-03
updated_at: 2026-11-05
related: [docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md, docs/00_ADR.md#adr-147]
tags: [search, external-dependency, zg, rg, board, cli]
---

# Local-first hybrid search — exact (rg) and semantic (zg) over docs and code

## 1. Issue and scope

Feature A34 (under A3, the `spur self` capability family). Downstream projects have no Spur-native
way to search docs and code: agents call `rg` ad hoc, the Board has per-module filters only, and
nothing offers fuzzy/semantic retrieval. The operator installs `zg` (`@zvec/zvec-grep`) and builds
the index (`zg --index --embedding local/potion-code-16m-v2`); Spur consumes that and does not own
vector search. Status: **proposed**.

In scope: zg/rg detection, one app search service with `exact` / `fuzzy` / `auto` modes, a zg
adapter, graceful degradation, `spur self search`, an oRPC search contract served by the local Bun
server, a Board module, init readiness and skill guidance. Out of scope: embeddings, chunking,
index formats, index creation, bundling zg, remote embedding providers, the Cloudflare Worker path.

## 2. Context and constraints

- `rg` and `sg` are external binaries Spur already relies on (through the `ts-rule-engine`
  evaluators). They are resolved on PATH and never bundled. zg joins that class as **optional**.
- **zg 0.3.0 CLI, observed against this repo** (these facts bind the adapter; 0.2.x is unsupported):
  - 0.3.0 dropped subcommands. Management verbs are flags (`--index`, `--status`, `--version`),
    and bare words, including `query`, `status`, `index` and `version`, are literal search text.
  - Query form: `zg --hybrid <q> --limit <n> --preview short [-g <glob>]…` produces one group.
    `--fts`, `--vector` and `--hybrid` take a **value** and are repeatable, so the adapter always
    uses one explicit `--hybrid <q>`. That form also lets a query begin with `-` and bypasses
    zg's automatic path lookup for path-shaped queries. `--limit` applies per group (default 7).
  - **Transport:** the default `--mode auto` uses a running zg server or falls back to direct.
    Spur passes no `--mode`.
  - **Output.** There is no `--json`. Spur pins `--preview short` (the default) because
    `--preview detail` adds outlines and file grouping. Piped output is uncoloured (`--color auto`).
    The grammar is:

    ```text
    #1 packages/app/tests/services/agent-quota-updates.test.ts:537-537
    symbol: [function] alpha     (optional `key: value` metadata; `heading:` on docs)
      537: <source line>
      …                          (U+2026; marks truncated source)
    ```

    - A hit header is `#<rank> <path>:<start>(-<end>)?`. Ranks run consecutively from 1.
    - Metadata lines are unindented `key: value`. Spur keeps `heading` and `symbol` raw.
      Source lines are indented `<lineNo>: <text>`.
    - A miss prints `No matches.`. Multi-query output adds `-- query i/n: text --` separators;
      Spur sends one query and only tolerates them.
    - Vector retrieval returns hits even for nonsense queries. Relevance is zg's concern, and
      Spur does not threshold.
  - **Missing index:** the query exits **1** with stderr
    `Error[ZG.ENGINE.NOT_FOUND]: No index found in <dir>`. The adapter also accepts 0.2.x's
    `[INDEX_MISSING]`.
  - **`zg --status`** exits 0.
    - An unindexed tree prints `Coverage    Unavailable (index not configured)`, which means missing.
    - A ready index prints a `Coverage` bar such as `100%  3,859 / 3,859 files`, followed by
      `Embedding`, `FTS` and `Storage .zvec-grep/index` lines.
    - A stale index has not been captured for 0.3.0. The parser keeps 0.2.x's first-glyph rule
      (`!` stale, `?` missing); any other non-empty output counts as ready.
  - `zg --version` prints the version string, which goes into `ZgOutputError`. `zg version` is
    search text, not a subcommand, and may prompt for or build an index.
- zg also ships an MCP server (`zg server`) with structured results. It is a daemon with its own
  lifecycle, and Spur does not manage third-party daemons.
- Apps are thin transports (ADR-021): logic lives in `packages/app`, wire shapes live in
  `packages/contracts`, and the server uses `implement(contract)`.
- **Public-surface consent (ADR-051):** one verb under the existing `self` noun and no new noun.
  The operator's idea premise ("if needed, add a command under `spur self`") plus the mode rename
  the operator requested in this feature's planning conversation count as consent for exactly
  this shape.
- Spur stores no API keys. Embedding is local only.

## 3. Solution

```text
spur self search ─┐
Board /search ────┼─► SearchService (packages/app/src/services/search.ts)
spur init ────────┘        ├─ exact  → rg --json [-F] … (stable JSON events)
                           ├─ fuzzy  → ZgAdapter (search-zg.ts) → zg --hybrid <q> --limit n -g …
                           └─ status → Bun.which('rg'|'zg') + `zg --version` + `zg --status`
```

- **SearchService** exposes `searchProject(req, deps) → SearchResponse` and
  `searchStatus(root, deps) → SearchStatus`. These are plain functions; `deps` injects
  `which` and `run` (a `NodeProcessExecutor.run` wrapper) so tests can fake binaries. It spawns
  with `rejectOnError: false`, `cwd: root`, `maxOutput` 2 MiB, and these timeouts:
  - rg: 10 s
  - zg query: 15 s
  - zg status / version: 5 s

  The internal process result preserves `outcome` and `outputTruncated`; reaching either output cap
  marks truncation even when the executor reports a normal exit. A failed status probe leaves the
  zg index `unknown`, never an inferred `missing`.

  It never reads or writes `.zvec-grep/` and never runs `zg --index`.
- **ZgAdapter** (`packages/app/src/services/search-zg.ts`) is the only code that knows zg's argv
  and grammar. It exports `buildZgArgs(req)` and `parseZgQuery(stdout, zgVersion) → SearchHit[]`.
  - Any line that fits no grammar rule throws `ZgOutputError`, and so do out-of-sequence ranks.
    0.2.x output is therefore rejected rather than misparsed. The error carries
    `{ zgVersion, sample }`, where sample is the first 400 chars.
  - Empty output and `No matches.` give `[]`.
  - Golden fixtures captured from installed zg 0.3.0 live under `packages/app/tests/fixtures/zg/`.
    A zg upgrade that changes the grammar fails these fixtures instead of failing silently in
    production.
- **Exact route:** `rg --json --max-count <limit> [-F] [-g …] -- <q> .`.
  - Parse `type:"match"` events into `path` (from `data.path.text`), `line_number`, and a snippet
    taken from `data.lines.text` trimmed to 300 chars.
  - Rank is emission order, truncated to `limit`.
  - Timeout, output at the 2 MiB cap, or a malformed JSON match event is an explicit
    `SearchError('rg-failed')`, never a truncated/empty success. Only after output validation does
    rg exit 1 mean no matches; exit 2 is an error.
  - It does not use `zg --rg`, so exact mode works without zg (R2/R6).
- **Scope mapping:**
  - `docs` → `-g '*.md' -g '*.mdx' -g '*.txt' -g '*.rst'`
  - `code` → `-g '!*.md' -g '!*.mdx' -g '!*.txt' -g '!*.rst'`
  - `all` → no scope globs

  The same globs go to both rg and zg (`-g`). User globs append after the scope globs, and later
  globs win, matching rg semantics.
- **`auto` mode (default):**
  - When `status.zg.available && status.zg.index !== 'missing'`, run both routes concurrently.
  - Otherwise run exact only and add a `skipped` entry for fuzzy.
  - A stale index still runs fuzzy and adds `stale: true` to `status`. It is not skipped.
  - Each route keeps its own group. Spur does no cross-route score fusion. A successfully executed
    zero-match fuzzy route returns `groups.fuzzy = []`; every skipped route keeps `null`.
- **Overlap rule:** a fuzzy hit and an exact hit overlap when they have the same `path` and
  `exact.startLine ∈ [fuzzy.startLine, fuzzy.endLine]`. Both hits then get
  `matchedBy: ['exact','fuzzy']`, and neither group drops the hit.
- **Degradation:**
  - Fuzzy fails in `auto` (zg absent, index missing, exit≠0, timeout, `ZgOutputError`). The
    result is `groups.fuzzy = null` plus `skipped: [{ route: 'fuzzy', reason, hint? }]`, exact
    still returns, and the exit code is 0.
  - In explicit `fuzzy` mode the same failures produce the same `skipped` shape with
    `groups.exact = null`, and the exit code is still 0 (R6).
  - `ZgOutputError` is a fuzzy failure reported as `reason: 'zg-output-error'` with the version
    and sample. Its hits are never presented (R7).
  - Exact unavailable (rg missing, timeout, capped/malformed output, a non-exit process outcome, or rg
    exit 2) in `exact` or `auto` throws `SearchError`, and the transport exits nonzero.

## 4. Contract and compatibility

**Wire shapes** go in `packages/contracts/src/search.ts`, as zod schemas plus `oc` routes in the
`history.ts` style. `SearchError` and `ZgOutputError` live in `packages/app`, not in contracts.

```ts
export const searchModeEnum = z.enum(['exact', 'fuzzy', 'auto']);
export const searchScopeEnum = z.enum(['docs', 'code', 'all']);
export const searchRequestSchema = z.object({
    query: z.string().trim().min(1),
    mode: searchModeEnum.default('auto'),
    scope: searchScopeEnum.default('all'),
    globs: z.array(z.string().min(1)).max(20).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    regex: z.boolean().default(false),
});
export const searchHitSchema = z.object({
    path: z.string(),            // project-root relative, forward slashes
    startLine: z.number().int(),
    endLine: z.number().int(),   // == startLine for rg hits
    snippet: z.string(),
    route: z.enum(['exact', 'fuzzy']),
    rank: z.number().int().min(1),
    matchedBy: z.array(z.enum(['exact', 'fuzzy'])).min(1),
    heading: z.string().optional(),
    symbol: z.string().optional(),
});
export const searchStatusSchema = z.object({
    rg: z.object({ available: z.boolean(), version: z.string().optional() }),
    zg: z.object({
        available: z.boolean(),
        version: z.string().optional(),
        index: z.enum(['ready', 'stale', 'missing', 'unknown']),
        hint: z.string().optional(),
    }),
});
export const searchResponseSchema = z.object({
    query: z.string(), mode: searchModeEnum, scope: searchScopeEnum,
    groups: z.object({ exact: z.array(searchHitSchema).nullable(), fuzzy: z.array(searchHitSchema).nullable() }),
    skipped: z.array(z.object({ route: z.enum(['exact', 'fuzzy']), reason: z.string(), hint: z.string().optional() })),
    status: searchStatusSchema,
});
export const searchContract = {
    query: oc.route({ method: 'POST', path: '/search/query', summary: 'Hybrid exact/semantic project search', tags: ['search'] })
        .input(searchRequestSchema).output(searchResponseSchema),
    status: oc.route({ method: 'GET', path: '/search/status', summary: 'rg/zg search readiness', tags: ['search'] })
        .output(searchStatusSchema),
};
```

**Hints** are exact strings, printed and never executed (R5):

- zg absent: `bun add -g @zvec/zvec-grep`
- index missing: `zg --index --embedding local/potion-code-16m-v2`
- stale: `zg --index` (incremental refresh; operator's choice)
- rg absent: `brew install ripgrep`

**Skip reasons** form a closed set: `zg-not-installed`, `zg-index-missing`, `zg-timeout`,
`zg-failed`, `zg-output-error`.

**CLI** synopsis:

```text
spur self search <query> [--mode exact|fuzzy|auto] [--scope docs|code|all]
                 [--glob <g>…] [--limit <n>] [--regex] [--status] [--json]
```

- Defaults are `auto` / `all` / `20`. With `--status`, `<query>` is optional and only
  `SearchStatus` is printed.
- `--json` prints the response in the standard `toEnvelopeJson` output. Human output prints one
  block per group with `path:start-end` and the snippet, then the skipped reasons with hints.
- Exit 0 on results, empty results or degradation. Exit nonzero on an empty query, an invalid
  mode/scope/limit, missing rg, or an exact-route failure.

**Server:**

- `contract.search = { ...searchContract }` is added to the global contract. The router gets
  `search: createSearchHandlers(ctx ?? stubCtx)` in `apps/server/src/modules/search/`.
- Handlers call the app service with `root = ctx.cwd`. Requests cannot pass a root, so there is
  no path traversal outside the project.
- The Worker entry (`worker-app.ts`) mounts no oRPC router, so the route is local-only without
  extra code. `apps/server/tests/openapi.test.ts` must still pass with the new tag.

**Board:**

- The module lives in `apps/web/src/modules/search/index.tsx` with
  `module: WebModule { id: 'search', route: 'search', order: 15 }`.
- It contains:
  - a query input (Enter submits)
  - a mode segmented control (Auto / Exact / Fuzzy)
  - a scope select
  - a grouped result list (path:line range, snippet, matchedBy badge)
  - a status strip with the same hints, from `api.search.status`
- The skipped reasons render inline, not as an error state. Imports go through the UI seam per
  root `DESIGN.md`, and the `ui-import-seam-only` and `no-daisyui-class-leak` rules apply.

**Init** (R12):

- `spur init` appends `.zvec-grep/` to `.gitignore`, beside the `.spur/context/` entry. The
  append is idempotent and runs in every mode, including `--minimal`.
- It calls `searchStatus(cwd)` and prints one readiness line. The `--json` payload gains
  `search: SearchStatus`.
- A probe failure or timeout yields `index: 'unknown'` and never fails init.
- It never installs zg, runs `zg --index`, or downloads a model. Reasons:
  - zg needs Node ≥ 22 and about 100 MB of runtime deps.
  - Its model cache and per-project index (about 300 MB for this repo) are operator-owned cost.
  - The standalone `install.sh` path has no package manager.

  This is the same posture as `rg`/`sg`, which Spur also never installs.

**Skills:**

- Guidance changes in `sp:reverse-engineering`, `sp:issue-finding`, `sp:conflict-finding` and
  `sp:wayfinder`:
  - Concept or cross-file questions go to semantic search first (the zg MCP tool, or
    `spur self search --mode fuzzy`) when it is available.
  - Literal lookups and zg-absent environments use `rg`.
- The plugin standalone contract is unaffected; the change is guidance text only.

## 5. Tradeoffs and open questions

- **Parse CLI markdown vs MCP server:** the choice is CLI parsing behind one adapter, guarded by
  golden fixtures. It needs no daemon management, and zg's own auto transport still uses its
  server when one is running. The upgrade path is to switch the adapter to `zg server` MCP (or a
  restored `--json`) without changing the DTO. Decision: [ADR-147](../00_ADR.md#adr-147).
- **`auto` vs `both`:** an explicit "both" mode would fail or skip noisily on zg-absent projects.
  `auto` gives agents one default that is always safe. `exact` and `fuzzy` remain explicit
  overrides.
- **No score fusion:** zg already ranks. Mixing rg line hits with zg chunk ranks would invent a
  scoring model Spur does not want to own, so grouped results keep each route's own rank.
- **Index freshness** is surfaced from `zg --status` as `index: 'stale'`. Spur does not refresh;
  `zg --index` stays the operator's choice.
- **Deferred:** `spur self status` does not print `SearchStatus`; `spur self search --status`
  owns it. Revisit if operators ask for it.
