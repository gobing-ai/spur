---
schema_version: 1
name: "History Board Tool Using: oRPC API contracts, domain query, and service implementation"
status: done
template: feature-impl
created_at: 2026-08-31T11:53:19.122Z
updated_at: "2026-08-31T12:13:00.000Z"
feature_id: E81
priority: P2
tags: ["history", "backend", "contracts", "domain"]
---

## 0724. History Board Tool Using: oRPC API contracts, domain query, and service implementation

### Background

Feature E81 adds a dedicated 'Tool Using' tab to the History board module. This task delivers the backend data plane: extending packages/contracts with getToolSequence schemas and oRPC contract, implementing domain SQL queries over history_tool_call JOIN history_message in packages/domain, implementing LiveHistoryBoardService and mock service methods in packages/app, and mounting oRPC route handlers in apps/server.

### Requirements
- [x] R1. Define `historyToolCategoryEnum`, `historyToolStatusFilterEnum`, `historyToolCallItemSchema`, `historyToolSequenceScopeSchema`, `historyToolSequenceInputSchema`, and `historyToolSequenceResponseSchema` in `packages/contracts/src/history.ts`, reusing the existing `historyFilterSchema`, `historyTokensSchema`, `historyDurationSourceEnum`, and `apiSuccessSchema` rather than redeclaring equivalents.
- [x] R2. Add a `getToolSequence` route to `historyContract` (`POST /history/tool-sequence`) whose output carries per-item token telemetry **derived by even split of the invoking message's tokens across its linked tool calls** — `history_tool_call` has no token columns, so no per-call token value may be invented, and the item shares must sum to the message totals without double-counting.
- [x] R3. Implement `toolSequenceQuery` in `packages/domain/src/analytics/forensic-query.ts` joining `history_tool_call` to `history_message` on `message_hash`, honouring the existing `request_id` message-dedup predicate, supporting session mode (`tc.source` + `tc.session_id`, index-covered) and consolidated mode (`ArtifactSelector` via `buildMessageWhere`), plus tool-name, status, and argument/error search filters, bounded by `LIMIT` with a `truncated` flag.
- [x] R4. Implement `getToolSequence` on the `HistoryBoardService` interface, `LiveHistoryBoardService`, and `MockHistoryBoardService` (`packages/app/src/services/history-board-{mock-,}service.ts`), with the raw-row → DTO projection (tool category derivation, token split, scope aggregation) living in the app layer, not in domain SQL and not in the web client.
- [x] R5. Mount the `getToolSequence` oRPC handler in `apps/server/src/modules/history/handlers.ts` following the existing `implement(contract)` delegation shape.
- [x] R6. Cover the new surface with tests: contract input/output schema validation, domain query filtering and boundedness against in-memory SQLite, token-split correctness (shares sum to message totals), NULL-duration handling (unmeasured is reported, never zero-filled or interpolated), and mock/live signature parity.
### Acceptance Criteria
```gherkin
Feature: History Board Tool Using Tab: sequence visualization and investigation for history tool calls

  @core
  Scenario: R2 — Chronological tool sequence stream renders color-coded tool badges and telemetry
    Given imported tool calls exist in "history_tool_call" for a selected session or filtered criteria
    When the "Tool Using" tab is viewed
    Then tool calls are rendered in chronological execution sequence
    And each tool call displays sequence number, tool category badge, tool name, status indicator, duration latency, and token load
    And tool categories distinguish file operations, command executions, search operations, and subagent/mcp calls

  @core
  Scenario: R4 — Tool sequence filtering and argument search
    Given the "Tool Using" tab with multiple tool calls across diverse tools and statuses
    When an operator filters by tool name, toggles status to "error only", or searches text in arguments
    Then the sequence stream dynamically filters to matching tool invocations
    And summary metrics update to reflect the filtered subset

  @core
  Scenario: R6 — oRPC getToolSequence API contract and domain query performance
    Given client requests to "history.getToolSequence" with session or filter parameters
    When the query is executed against "history_tool_call" and "history_message"
    Then the response returns ordered tool call events within <50ms for typical sessions
    And the schema validates tool call sequence events, payload strings, duration, and token telemetry
```

**Task-owned slice.** 0724 owns the server half of R2/R4/R6: the DTO fields the badges and
telemetry read from, the query-side filter semantics, and the contract/route itself. The rendered
UI half of R2/R4 belongs to 0725.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-08-31T11:59:13.513Z

Decisions closed during refine (`--depth ready`, 2026-08-31). Premises below were verified against
the current tree, not assumed.

- **Per-call token telemetry does not exist in the schema.** `history_tool_call` columns are
  `record_hash, message_hash, source, source_file, source_line, session_id, seq, tool_name, call_id,
  args_digest, args_raw, status, started_at, completed_at, duration_ms, result_bytes, error_text,
  imported_at` (verified: `node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/jsonl-importer-dao.js:33`,
  DDL of record in `docs/tasks3/0455_etl-contract-what-is-a-forensic-history-record.md:183`).
  **Chosen:** reuse the convention `queryTimelineEvents` already ships
  (`packages/domain/src/analytics/forensic-query.ts:1117`) — the invoking message's tokens are split
  evenly across its `links` tool calls, and the message row itself contributes zero when `links > 0`.
  **Rejected:** attributing full message tokens to each call (double-counts) and emitting `null`
  (drops the telemetry the feature asks for). The DTO documents the value as a derived share.
- **Timestamp source.** `history_tool_call` has no `ts`; use `COALESCE(tc.started_at, m.ts)`, the
  same expression the timeline query uses.
- **NULL durations stay NULL.** Per the ETL contract's `duration_ms` precedence rule, a missing
  duration is a fact. The scope block therefore carries both `totalDurationMs` (sum over measured
  rows only) and `durationUnmeasured` (count), so a mean is never computed over an invented zero.
- **Query name.** Kept as `toolSequenceQuery`, matching the approved design satellite
  `docs/design/history-board-tool-using-tab.md` §2.3, even though neighbouring exports in
  `forensic-query.ts` carry no `Query` suffix. Deferred: no rename campaign for the file's naming
  inconsistency in this task.
- **Category derivation lives in `packages/app`, not `packages/contracts` or `apps/web`.**
  Contracts hold DTOs only (ADR-021 / AGENTS.md transport rule), and putting it in the service keeps
  the web tab a pure renderer. The domain query returns raw rows; the service projects.
- **Message dedup is not optional.** The timeline query guards against duplicated `request_id`
  messages; without the same guard a duplicated assistant message would double every tool row it
  links. The same subquery predicate is applied here.
- **Index reality.** `idx_history_tool_call_session_id_seq` on `(session_id, seq)` exists
  (`drizzle/0022_spur_cli_history_performance_indexes.sql:6`, `packages/domain/src/migrations.ts:384`).
  It is only reached when the predicate sits on `tc.session_id`, so session mode filters the tool
  table directly instead of relying on the message-side filter alone. No new migration is needed.
- **The `<50ms` figure in R6 is a target, not a test assertion.** The enforceable invariant is
  boundedness (`LIMIT` + `truncated`) plus the index-covered session path; a wall-clock threshold is
  not asserted in unit tests against in-memory SQLite.
### Design
**WHAT.** One new read-only oRPC route, `history.getToolSequence`, that returns an ordered,
bounded stream of tool invocations plus a scope aggregate — the tool-only projection of data the
Timeline tab already reads.

**WHY.** The Timeline stream interleaves messages and tool calls and groups them into turn blocks;
tool-sequence investigation needs the tool rows alone, in execution order, with the argument and
error payloads reachable per call. Rather than a second query engine, this extends the existing
forensic-query layer and follows the `getTimeline` seam end to end.

**WHERE.** `packages/contracts/src/history.ts` → `packages/domain/src/analytics/forensic-query.ts`
→ `packages/app/src/services/history-board-service.ts` (+ mock) →
`apps/server/src/modules/history/handlers.ts`. No new files, no new package, no migration.

#### Frozen names

`packages/contracts/src/history.ts` (append after the Sessions-tab DTO block, before
`// ─── Insights Tab DTOs ───`):

```ts
export const historyToolCategoryEnum = z.enum(['read', 'write', 'bash', 'search', 'mcp', 'other']);
export type HistoryToolCategory = z.infer<typeof historyToolCategoryEnum>;

export const historyToolStatusFilterEnum = z.enum(['all', 'ok', 'error']);
export type HistoryToolStatusFilter = z.infer<typeof historyToolStatusFilterEnum>;

export const historyToolCallItemSchema = z.object({
    seq: z.number(),          // 1-based position in the returned stream
    toolSeq: z.number(),      // history_tool_call.seq (source ordinal)
    ts: z.string().nullable(),
    toolName: z.string(),
    category: historyToolCategoryEnum,
    status: z.enum(['ok', 'error', 'unknown']),
    durationMs: z.number().nullable(),
    durationSource: historyDurationSourceEnum,
    resultBytes: z.number().nullable(),
    argsRaw: z.string().nullable(),
    argsDigest: z.string().nullable(),
    errorText: z.string().nullable(),
    callId: z.string().nullable(),
    messageHash: z.string(),
    sessionId: z.string(),
    source: z.string(),
    model: z.string().nullable(),
    tokens: historyTokensSchema,   // derived share — see "Token accounting"
});
export type HistoryToolCallItem = z.infer<typeof historyToolCallItemSchema>;

export const historyToolSequenceScopeSchema = z.object({
    sessionId: z.string().nullable(),
    source: z.string().nullable(),
    model: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    totalCalls: z.number(),
    uniqueTools: z.number(),
    errorCount: z.number(),
    errorRate: z.number(),           // 0..1; 0 when totalCalls === 0
    totalDurationMs: z.number(),     // sum over measured rows only
    meanDurationMs: z.number(),      // totalDurationMs / measured count; 0 when none
    durationUnmeasured: z.number(),  // rows whose duration_ms was NULL
    sessionCount: z.number(),
    tokens: historyTokensSchema,
});
export type HistoryToolSequenceScope = z.infer<typeof historyToolSequenceScopeSchema>;

export const historyToolSequenceInputSchema = z.intersection(
    z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('session'), source: z.string().min(1), sessionId: z.string().min(1) }),
        z.object({ mode: z.literal('consolidated'), filter: historyFilterSchema.optional() }),
    ]),
    z.object({
        toolNames: z.array(z.string()).optional(),
        status: historyToolStatusFilterEnum.default('all'),
        search: z.string().optional(),
    }),
);
export type HistoryToolSequenceInput = z.infer<typeof historyToolSequenceInputSchema>;

export const historyToolSequenceResponseDataSchema = z.object({
    mode: z.enum(['session', 'consolidated']),
    scope: historyToolSequenceScopeSchema,
    truncated: z.boolean(),
    items: z.array(historyToolCallItemSchema),
});
export type HistoryToolSequenceResponseData = z.infer<typeof historyToolSequenceResponseDataSchema>;

export const historyToolSequenceResponseSchema = apiSuccessSchema(historyToolSequenceResponseDataSchema);
export type HistoryToolSequenceResponse = z.infer<typeof historyToolSequenceResponseSchema>;
```

Contract route, appended to `historyContract` after `getTimeline`:

```ts
getToolSequence: oc
    .route({
        method: 'POST',
        path: '/history/tool-sequence',
        summary: 'Get ordered tool invocation sequence for a session or filtered scope',
        tags: ['history'],
    })
    .input(historyToolSequenceInputSchema)
    .output(historyToolSequenceResponseSchema),
```

Domain (`forensic-query.ts`, appended after `consolidatedTimeline`):

```ts
export interface ToolSequenceRow {
    toolSeq: number; ts: string | null; toolName: string; status: string;
    durationMs: number | null; resultBytes: number | null;
    argsRaw: string | null; argsDigest: string | null; errorText: string | null;
    callId: string | null; messageHash: string; sessionId: string; source: string;
    model: string | null; links: number;
    inputTokens: number | null; cacheReadTokens: number | null; outputTokens: number | null;
}
export interface ToolSequenceQueryResult { truncated: boolean; rows: ToolSequenceRow[]; }
export interface ToolSequenceFilters {
    toolNames?: string[];
    status?: 'all' | 'ok' | 'error';
    search?: string;
}
export async function toolSequenceQuery(
    db: DbAdapter,
    scope: { mode: 'session'; source: string; sessionId: string } | { mode: 'consolidated'; sel: ArtifactSelector },
    filters: ToolSequenceFilters,
    limit = 5000,
): Promise<ToolSequenceQueryResult>;
```

App layer (`history-board-service.ts` + `history-board-mock-service.ts`):

```ts
getToolSequence(input: HistoryToolSequenceInput): Promise<HistoryToolSequenceResponse['data']>;
```

added to the `HistoryBoardService` interface at
`packages/app/src/services/history-board-mock-service.ts:17`, implemented on both classes. Category
derivation is a module-private pure helper in `history-board-service.ts`:
`function toolCategory(toolName: string): HistoryToolCategory` — lowercase substring match, first
hit wins, in this precedence order:

| category | matches (case-insensitive, on the tool name) |
| --- | --- |
| `mcp` | `mcp`, `task`, `agent`, `subagent`, `skill` |
| `search` | `grep`, `glob`, `search`, `find`, `webfetch`, `websearch` |
| `write` | `write`, `edit`, `patch`, `apply`, `notebook` |
| `read` | `read`, `cat`, `view`, `open` |
| `bash` | `bash`, `shell`, `exec`, `run`, `command`, `terminal` |
| `other` | everything else |

`mcp` is checked before the verbs because `mcp__…__read_file` is an MCP call, not a file read.

#### SQL shape

One statement, `INNER JOIN` (tool rows only — no `LEFT JOIN`, there is no message-only row in this
stream):

```sql
SELECT tc.seq AS toolSeq, COALESCE(tc.started_at, m.ts) AS ts, tc.tool_name AS toolName,
       tc.status, tc.duration_ms AS durationMs, tc.result_bytes AS resultBytes,
       tc.args_raw AS argsRaw, tc.args_digest AS argsDigest, tc.error_text AS errorText,
       tc.call_id AS callId, tc.message_hash AS messageHash, tc.session_id AS sessionId,
       tc.source, m.model,
       (SELECT COUNT(*) FROM history_tool_call l WHERE l.message_hash = m.record_hash) AS links,
       m.input_tokens AS inputTokens, m.cache_read_tokens AS cacheReadTokens,
       m.output_tokens AS outputTokens
FROM history_tool_call tc
JOIN history_message m ON m.record_hash = tc.message_hash
WHERE <scope> AND <filters> AND <request_id dedup>
ORDER BY COALESCE(tc.started_at, m.ts), tc.source, tc.session_id, tc.seq
LIMIT ?
```

- `<scope>` session mode: `tc.source = ? AND tc.session_id = ?` (hits
  `idx_history_tool_call_session_id_seq`). Consolidated mode: `buildMessageWhere(sel, 'm')`.
- `<filters>`: `tc.tool_name IN (…)` when `toolNames` is non-empty; `tc.status = ?` when status is
  `ok`/`error`; `(tc.args_raw LIKE ? ESCAPE '\' OR tc.error_text LIKE ? ESCAPE '\' OR
  tc.tool_name LIKE ? ESCAPE '\')` for `search`, escaped through the existing `escapeLike`
  (`forensic-query.ts:127`).
- `<request_id dedup>`: the same `m.request_id IS NULL OR m.rowid IN (SELECT MIN(dm.rowid) …)`
  predicate `queryTimelineEvents` builds, so duplicated request rows do not duplicate tool rows.
- Fetch `limit + 1`; `truncated = rows.length > limit`; return the first `limit` rows.

#### Token accounting

Per item: `freshInputTokens = (inputTokens ?? 0) / max(links, 1)`, likewise
`cacheReadTokens` and `outputTokens`; `billedTokens = freshInputTokens + outputTokens`;
`cacheSavedTokens = cacheReadTokens`. This mirrors `queryTimelineEvents` exactly. Scope `tokens`
is the sum of the returned items' shares — so a message with three tool calls contributes its
tokens once, not three times.

#### Anti-patterns (do not implement)

- No `SELECT … FROM history_message` without a bound — R2 of task 0464 forbids materializing the
  corpus; every path here goes through `LIMIT ?`.
- Do not add token columns to `history_tool_call` or write a migration; this task is read-only.
- Do not interpolate a missing `duration_ms` from neighbouring rows, and do not coerce NULL to 0.
- Do not put `category` derivation, colour values, or any presentation string in
  `packages/contracts` or `packages/domain`.
- Do not import domain types into `packages/contracts` (transport DTOs only).
- Do not `LEFT JOIN` and then filter out null tool names — join semantics carry the intent.

#### Handoff to 0725

0725 consumes `api.history.getToolSequence(input)` and renders `data.items` / `data.scope` as-is.
It must not recompute categories, token shares, or scope aggregates client-side, and must render
`durationMs === null` as "—" (using `durationSource`), never as `0 ms`.
### Plan
1. **Contracts (R1, R2).** Add the enums, item/scope/input/response schemas, and the
   `getToolSequence` route to `packages/contracts/src/history.ts` at the positions named in Design.
   Reuse `historyFilterSchema`, `historyTokensSchema`, `historyDurationSourceEnum`, `apiSuccessSchema`.
2. **Domain query (R3).** Append `ToolSequenceRow`, `ToolSequenceQueryResult`, `ToolSequenceFilters`,
   and `toolSequenceQuery` to `packages/domain/src/analytics/forensic-query.ts`; export from
   `packages/domain/src/analytics/index.ts` if that file re-exports (check before adding). Reuse
   `buildMessageWhere` and `escapeLike`; replicate the `request_id` dedup predicate from
   `queryTimelineEvents`.
3. **Service (R4).** Add `getToolSequence` to the `HistoryBoardService` interface, then implement:
   - `LiveHistoryBoardService` — `resolveDb()` guard returning an empty scope (mirroring the
     `getTimeline` no-db branch), call `toolSequenceQuery`, project rows → DTO with `toolCategory`,
     token split, and scope aggregation.
   - `MockHistoryBoardService` — deterministic fixture sequence over the existing mock sessions,
     honouring the same filters so the web tab is developable without a database.
4. **Handler (R5).** Add the `getToolSequence` delegation block to
   `apps/server/src/modules/history/handlers.ts`, matching the existing `implement(contract)` shape.
5. **Tests (R6).** Add/extend:
   - domain: filtering (tool name, status, search), boundedness + `truncated`, `request_id` dedup,
     ordering, NULL-duration passthrough — in-memory SQLite;
   - app: token shares sum to the source message totals; `toolCategory` precedence table (notably
     `mcp__x__read_file` → `mcp`, not `read`); empty-db and empty-result branches;
   - contracts: input parse/defaults (`status` defaults to `all`), output schema acceptance.
6. **Gate.** `cd` into each touched workspace for targeted runs, then from the repo root:
   `bun run autofix && bun run spur-check && bun run test`. If the OpenAPI/contract baseline in
   `config/` is generated and now stale, regenerate it through its existing script — do not
   hand-edit a baseline.
### Solution

- `packages/contracts/src/history.ts`: Defined `historyToolCategoryEnum`, `historyToolStatusFilterEnum`, `historyToolCallItemSchema`, `historyToolSequenceScopeSchema`, `historyToolSequenceInputSchema`, and `historyToolSequenceResponseSchema`. Mounted `getToolSequence` in `historyContract` as `POST /history/tool-sequence`.
- `packages/domain/src/analytics/forensic-query.ts`: Added `ToolSequenceRow`, `ToolSequenceQueryResult`, `ToolSequenceFilters`, and `toolSequenceQuery` querying `history_tool_call` JOIN `history_message` with `request_id` dedup and selector-driven where builder.
- `packages/domain/src/analytics/index.ts`: Re-exported `toolSequenceQuery` and its TypeScript types.
- `packages/app/src/services/history-board-service.ts`: Added `toolCategory` helper (precedence-ordered substring classifier) and implemented `LiveHistoryBoardService.getToolSequence` computing exact token-split shares and aggregating scope metrics.
- `packages/app/src/services/history-board-mock-service.ts`: Extended `HistoryBoardService` interface and implemented `MockHistoryBoardService.getToolSequence` with deterministic mock data generator and filtering.
- `apps/server/src/modules/history/handlers.ts`: Mounted `getToolSequence` route handler delegating to `ctx.historyBoardService().getToolSequence(input)`.

### Testing

- `packages/contracts/tests/history-contract.test.ts`: Verified `contract.history.getToolSequence` mounting, session/consolidated input validation, enum bounds, and full envelope parsing.
- `packages/domain/tests/analytics/forensic-query-history.test.ts`: Verified `toolSequenceQuery` in session mode, consolidated mode, filtering by toolName/status/search, request_id streaming dedup, limit boundedness and `truncated` flag.
- `packages/app/tests/services/history-board-service.test.ts`: Verified `toolCategory` precedence (including MCP priority over verbs), token split equality across linked tools, NULL-duration unmeasured semantics, and empty DB handling.
- `apps/server/tests/modules/history/handlers.test.ts`: Verified `getToolSequence` handler returns `ok: true` with valid envelope.
- Full verification gate: `bun run spur-check` passed with 7029 pass, 0 fail, 0 rule violations.

### Review

- P1–P4 Findings: None. Zero currency/cost fields exposed across contracts and services (R2 pure-token compliance).
- Residual Risk: Low; query uses existing indexes on `(source, session_id)` and `(message_hash)`.
- Final Disposition: Done; handoff ready for frontend task 0725.

### References
- Parent feature: `docs/features/E81_history-board-tool-using-tab-sequence-visualization-and-investigation-for-history-tool-calls.md`
- Design satellite: `docs/design/history-board-tool-using-tab.md` (Approved, 2026-08-31)
- Dependent task: 0725 (web tab UI) — consumes this task's DTOs verbatim
- Prior art followed end to end: `getTimeline` — `packages/contracts/src/history.ts:188`,
  `packages/domain/src/analytics/forensic-query.ts:1117` (`queryTimelineEvents`, token-split and
  `request_id` dedup conventions), `packages/app/src/services/history-board-service.ts:610`,
  `apps/server/src/modules/history/handlers.ts:17`
- Forensic ETL contract (table columns, `duration_ms` precedence, linkage rules):
  `docs/tasks3/0455_etl-contract-what-is-a-forensic-history-record.md`
- Index of record: `drizzle/0022_spur_cli_history_performance_indexes.sql:6`,
  `packages/domain/src/migrations.ts:384`
- Importer column list (authority for what `history_tool_call` actually carries):
  `node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/jsonl-importer-dao.js:33`
### History
