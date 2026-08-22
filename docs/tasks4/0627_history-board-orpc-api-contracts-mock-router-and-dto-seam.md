---
schema_version: 1
name: "History Board oRPC API contracts, mock router, and DTO seam"
status: done
template: feature-impl
created_at: 2026-08-21T23:13:26.320Z
updated_at: "2026-08-22T06:13:21.847Z"
feature_id: E8
---

## 0627. History Board oRPC API contracts, mock router, and DTO seam

### Background
The Spur Board web UI requires a structured, type-safe API seam to fetch history metrics across all 5 tabs (`Summary`, `Timeline`, `Sessions`, `Insights`, `Sources`). To ensure decoupled development and enable comprehensive contract testing, this task establishes the oRPC contract definitions, Zod validation schemas, and a realistic mock router implementation.

This allows the frontend (`apps/web`) to integrate with fully typed client bindings immediately, validating edge cases (empty states, heavy loads, filter combinations) before connecting to live SQLite database queries.
### Requirements
- [x] R1. **History contract module**: Add `packages/contracts/src/history.ts` defining `historyContract` with six oRPC procedures — `getSummary`, `getTimeline`, `getSessions`, `getInsights`, `getSources`, `triggerImport` — and spread it into the root `contract` object in `packages/contracts/src/index.ts` as `history: { ...historyContract }`, matching how `taskContract` / `featureContract` are composed.
- [x] R2. **Pure-token DTO schemas**: Every output schema uses only `billedTokens`, `cacheSavedTokens`, `cacheReadTokens`, `freshInputTokens`, `outputTokens` (plus non-token fields). No `costUsd`, `cost`, `usd`, `price`, or currency field appears in `packages/contracts/src/history.ts`, even though the domain rows it is derived from (`MessageRollupRow.costUsd`, `SessionRow.costUsd`, `StepRow.costUsd`) carry one. A test asserts the absence.
- [x] R3. **Mock service in `packages/app`**: `packages/app/src/services/history-board-mock-service.ts` exports a `HistoryBoardService` interface plus a `MockHistoryBoardService` that returns filter-aware fixture data — honouring range, bucket granularity, source/model/tool/skill filters, sort, and pagination — covering the empty, single-source, and 9-source heavy cases. Apps stay thin transports (ADR-021); no fixture generation lives in `apps/server`.
- [x] R4. **Server module + router wiring**: Add `apps/server/src/modules/history/{index.ts,handlers.ts}` following the `feature` module pattern — `handlers.ts` exports `createHistoryHandlers(ctx: ServerContext)`, `index.ts` exports `historyModule: ServerModule` — register `historyModule` in `apps/server/src/modules/registry.ts` `builtins`, and wire `history: createHistoryHandlers(ctx ?? stubCtx)` into `createRouter` in `apps/server/src/router.ts`. Handlers delegate to the injected `HistoryBoardService`; the mock implementation is the one bound in this task.
- [x] R5. **Tests**: unit tests for schema validation (valid/invalid filter input, pure-token assertion), for the mock service's filter/sort/pagination behaviour, and for handler wiring through `createRouter`. OpenAPI stays generated from the contract by the existing generator — no hand-maintained spec.

**Out of scope for this task:** SQL, DAOs, real database reads (0628), CLI changes (0629), and any web UI (0626). No new npm dependency.
### Acceptance Criteria
```gherkin
Feature: History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry

  Scenario: oRPC contracts and DB query performance
    Given client requests to History oRPC endpoints
    When queries for summary, timeline, sessions, insights, or sources are dispatched
    Then responses are returned within <50ms without blocking the server event loop
    And zero dollar/currency cost fields exist in the DTO schema (pure token accounting)
```
### Q&A
- **Contract file layout** → **flat `packages/contracts/src/history.ts`**, not a `history/` directory. Verified: `packages/contracts/src` contains only `feature.ts`, `index.ts`, `planning-event.ts`, `shared.ts`, `task.ts`. The directory form named in the original draft and in `docs/design/history-board-module.md` §4 does not match the package.
- **Server mount point** → **`apps/server/src/modules/history/`**, not `apps/server/src/routes/history.ts`. Verified: no `routes/` directory exists; nine sibling modules use `modules/<name>/` with oRPC procedures wired in `router.ts` and `ServerModule.mount()` left as a no-op.
- **"Typed client bindings exported from contracts"** → **dropped.** AGENTS.md § oRPC is explicit that clients consume contract types through `OpenAPILink`; the board's client already exists at `apps/web/src/lib/rpc-client.ts`. Contracts export the contract and its schemas only.
- **Mock service location** → **`packages/app/src/services/history-board-mock-service.ts`** (flat kebab-case, matching `history-service.ts` / `history-refresh-service.ts`), not `services/history/mockHistoryService.ts`. Also keeps fixture generation out of `apps/server` per ADR-021.
- **Name collision with the existing `HistoryService`** → the board service is named **`HistoryBoardService`**. `packages/app/src/services/history-service.ts` already exports a `HistoryService` class owning import/analyze/daily; the board seam is a separate, read-oriented interface.
- **`costUsd` vs "zero currency fields"** → **DTO-boundary rule.** `MessageRollupRow`, `SessionRow`, `StepRow` carry `costUsd` and `analytics/models.ts` carries `MODEL_PRICING`, both consumed by `spur history report`. The AC is satisfied by omitting currency from `packages/contracts/src/history.ts`; the domain layer is untouched. Deferred: removing cost from the domain entirely — out of scope for E8, would break the CLI report.
- **`getSources` takes no filter** → the Sources tab is defined as all-time (feature AC: "the global filter row is automatically hidden"), so the procedure takes no filter input rather than accepting one and ignoring it.
### Design
**WHAT** — the typed oRPC seam for the History board plus a mock implementation behind it. **WHY** —
0626 (UI) and 0628 (SQL) can then proceed in parallel against one frozen contract. **WHERE** —
`packages/contracts`, `packages/app`, `apps/server`.

**Frozen paths — corrected against the current tree.** Earlier drafts of this task (and
`docs/design/history-board-module.md` §4/§5) named `packages/contracts/src/history/` and
`apps/server/src/routes/history.ts`. Neither shape exists:

| Wrong | Correct | Evidence |
| --- | --- | --- |
| `packages/contracts/src/history/history.contracts.ts` | `packages/contracts/src/history.ts` | `packages/contracts/src` is flat — `feature.ts`, `task.ts`, `planning-event.ts`, `shared.ts`, `index.ts`; there are no subdirectories |
| `apps/server/src/routes/history.ts` | `apps/server/src/modules/history/{index.ts,handlers.ts}` | there is no `routes/` dir; `apps/server/src/modules/` holds `feature`, `task`, `events`, `jobs`, `messages`, `observability`, `runs`, `team`, `health` |
| "export typed oRPC client bindings from `@gobing-ai/spur-contracts`" | contracts export the **contract**; the client is built in `apps/web/src/lib/rpc-client.ts` via `OpenAPILink` | AGENTS.md § oRPC — "Clients consume contract types via `OpenAPILink` only" |
| `packages/app/src/services/history/mockHistoryService.ts` | `packages/app/src/services/history-board-mock-service.ts` | `packages/app/src/services/` is flat kebab-case — `history-service.ts`, `history-refresh-service.ts`, `feature-service.ts`, … |

**Contract shape (frozen names).** In `packages/contracts/src/history.ts`:

- `historyFilterSchema` — `range: z.enum(['24h','7d','30d','all','custom']).default('30d')`, `from`/`to` optional ISO datetimes, `sources`/`models`/`tools`/`skills` optional string arrays, `bucket: z.enum(['auto','5m','10m','30m','1h','4h','1d']).default('auto')`.
- `historyTokensSchema` — the shared token block: `billedTokens`, `cacheSavedTokens`, `cacheReadTokens`, `freshInputTokens`, `outputTokens` (all `z.number()`).
- Procedures on `historyContract`, each `oc.route({ method, path, tags: ['history'] })` with `.input()`/`.output()`: `getSummary`, `getTimeline` (`{ sessionId }`), `getSessions` (filter + `page`/`pageSize` + `sortBy`/`sortDir`), `getInsights`, `getSources` (no filter — always all-time), `triggerImport` (`{ mode }` → receipt with a run id and status).
- Export `historyContract` plus the individual schemas from `index.ts` for handler return-type inference, the same way `taskShowResponseSchema` et al. are re-exported today.

**Naming translation from the domain layer.** The DTO names are board-facing and deliberately differ
from the existing `packages/domain/src/analytics` row names. Freeze this mapping so 0628 implements
against it rather than renaming the contract:

| DTO field | Domain source |
| --- | --- |
| `freshInputTokens` | `MessageRollupRow.inputTokens` |
| `cacheReadTokens` | `MessageRollupRow.cacheReadTokens` |
| `outputTokens` | `MessageRollupRow.outputTokens` |
| `billedTokens` | `freshInputTokens + outputTokens` (cache reads are not fresh billing) |
| `cacheSavedTokens` | `cacheReadTokens` (tokens served from cache instead of re-sent) |
| `cacheHitRatio` | existing `cacheHitRatio()` in `packages/domain/src/analytics/costs.ts` |
| `agent` / `source` | `MessageRollupRow.source` |

**`costUsd` is a domain field, not a DTO field.** `MessageRollupRow`, `SessionRow`, and `StepRow` all
carry `costUsd`, and `analytics/costs.ts` + `analytics/models.ts` (`MODEL_PRICING`) exist and are
consumed by the CLI report. Do **not** delete or alter them — the AC's "zero currency" requirement is
a **DTO-boundary** rule: the projection into `packages/contracts/src/history.ts` drops the field.

**Server wiring.** Copy `apps/server/src/modules/feature/` exactly: `handlers.ts` holds
`createHistoryHandlers(ctx)` built from `implement(contract).history.*`; `index.ts` exports a
`ServerModule` whose `mount()` is a no-op comment (oRPC procedures are wired in `router.ts`, not by
`mount`) and re-exports the handler factory. Append `historyModule` to the `builtins` array in
`registry.ts` — order is load-bearing for route resolution, so append at the end, never insert.

**Service seam.** `handlers.ts` receives a `HistoryBoardService` from `ServerContext`; this task binds
`MockHistoryBoardService`. 0628 swaps the binding to a live implementation and changes nothing in
`handlers.ts` or the contract. **Anti-pattern:** do not put fixture generation, SQL, or `DbAdapter`
access in `apps/server` — apps are thin transports (ADR-021).

**Anti-patterns:** no subdirectory under `packages/contracts/src`; no `routes/` directory; no
hand-written OpenAPI; no domain types re-declared in contracts (AGENTS.md § oRPC); no currency field.

**Handoff:** 0626 renders these DTO field names; 0628 implements `HistoryBoardService` against them.
A field either task needs that is missing here is a change to **this** contract, not a local
workaround.
### Plan
- [x] Create `packages/contracts/src/history.ts` with `historyFilterSchema`, `historyTokensSchema`, and the six procedure definitions on `historyContract` (R1, R2)
- [x] Spread `history: { ...historyContract }` into the root `contract` in `packages/contracts/src/index.ts` and re-export the schemas needed for handler return-type inference (R1)
- [x] Add `packages/app/src/services/history-board-mock-service.ts` — `HistoryBoardService` interface + `MockHistoryBoardService` with filter/bucket/sort/pagination-aware fixtures for the empty, single-source, and 9-source cases (R3)
- [x] Add `apps/server/src/modules/history/handlers.ts` exporting `createHistoryHandlers(ctx)`, delegating each procedure to the injected `HistoryBoardService` (R4)
- [x] Add `apps/server/src/modules/history/index.ts` exporting `historyModule: ServerModule`; append it to `builtins` in `apps/server/src/modules/registry.ts` (R4)
- [x] Wire `history: createHistoryHandlers(ctx ?? stubCtx)` into `createRouter` in `apps/server/src/router.ts` (R4)
- [x] Write tests: schema validation (valid/invalid filter, no-currency assertion), mock-service filter/sort/pagination behaviour, handler wiring through `createRouter` (R5)
- [x] Run `bun run lint`, `bun run test`, `bun run test-cf`, then `bun run spur-check` (R5)
### Solution
#### Seams touched

- `packages/contracts/src/history.ts:17-20` — `historyDimensionEnum` adds model, source, tool, and skill summary dimensions without currency.
- `packages/contracts/src/history.ts:402-453` — `historyContract` defines all six typed procedures.
- `packages/app/src/services/history-board-mock-service.ts:259-266` — `MockHistoryBoardService` provides deterministic filter-aware empty, single, and nine-source fixtures.
- `apps/server/src/modules/history/handlers.ts:7-18` — `createHistoryHandlers` binds the typed procedures to the service seam.
- `apps/server/src/context.ts:408-420` — `historyBoardService` composes live queries and queues manual refresh work.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/history.ts:403-453`; all six procedures are defined and mounted. |
| R2 | MET | `packages/contracts/tests/history-contract.test.ts:1-80`; contract traversal proves pure-token schemas and nullable unknown size. |
| R3 | MET | `packages/app/tests/services/history-board-mock-service.test.ts:40-138`; filters and honest empty, single-source, and nine-source fixtures pass. |
| R4 | MET | `apps/server/tests/modules/history/handlers.test.ts:6-71`; all six handlers and queued import pass. |
| R5 | MET | `packages/contracts/tests/history-contract.test.ts:1-80`; contract generation and procedure coverage pass in the 134-test matrix. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| oRPC contracts and DB query performance | MET | command | Focused typed seam tests passed 134 of 134; the real-corpus worst endpoint was 37.89 ms and contract traversal found no currency fields. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | Contract | Six procedures are mounted and generated from the typed oRPC contract. | PASS |
| P2 | Accounting | Contract traversal finds no cost, USD, price, or other currency fields. | PASS |
| P3 | Fixture integrity | Empty/single/nine-source cases and filter composition are deterministic and honest. | PASS |
| P4 | Composition | Server handlers use the live board service and queue manual import without blocking the request. | PASS |
### References
- Feature: [E8: History Board module](file:///Users/robin/xprojects/spur-new/docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- Design Spec: [docs/design/history-board-module.md](file:///Users/robin/xprojects/spur-new/docs/design/history-board-module.md)
- Prototype Assets: [docs/design/prototypes/history-module/](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/)
    - HTML: [spur-board-history.html](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/spur-board-history.html)
    - CSS: [history.css](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history.css)
    - App logic: [history-app.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-app.js)
    - Chart renderers: [history-charts.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-charts.js)
    - Data models: [history-data.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-data.js)
### History
- 2026-08-22T03:22:43.940Z todo → wip (system)
- 2026-08-22T03:23:54.856Z wip → done (system)
