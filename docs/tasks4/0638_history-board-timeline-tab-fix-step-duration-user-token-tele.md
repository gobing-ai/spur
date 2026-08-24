---
schema_version: 1
name: "History Board Timeline Tab: Fix step duration, user token telemetry, duplicate tool labels, raw digest payloads, agy/codex session extraction, and multi-agent consolidated timeline"
status: done
template: feature-impl
created_at: 2026-08-23T19:39:26.250Z
updated_at: "2026-08-24T20:43:30.568Z"
feature_id: E8
ac_altitude: task-local
---

## 0638. History Board Timeline Tab: Fix step duration, user token telemetry, duplicate tool labels, raw digest payloads, agy/codex session extraction, and multi-agent consolidated timeline

### Background
The History Board Timeline crosses four in-repo seams—typed oRPC DTOs, the live analytics query, the application projection, and the React view—and one upstream seam in `@gobing-ai/ts-llm-jsonl-importer`. The current path is `HistoryShell` → `history.getTimeline({ sessionId })` → `LiveHistoryBoardService.getTimeline()` → `sessionTimeline()`.

Inspection of the current implementation and the live `.spur/spur.db` corpus on 2026-08-23 established the following:

1. **Duration is being fabricated as zero.** `sessionTimeline()` preserves nullable message/tool durations, but `LiveHistoryBoardService.getTimeline()` coerces them with `ev.durationMs ?? 0`, and `TimelineTab` renders `⏱ 0ms`. Some sources expose measured duration; others expose only event timestamps. A positive timestamp gap to the next event in the *same source/session* is useful as an inferred elapsed interval, but it is not true tool execution latency and must be labeled as inferred. Implausible or unavailable gaps must remain unmeasured.
2. **Prompt usage is recorded after the user row.** User messages normally carry no usage; later assistant/meta/tool events before the next user message carry fresh input, cache-read, and output totals. Copying those values into the event's normal token fields would double-count scope and block totals, so prompt attribution needs a separate projection field. The inline character-count chip is redundant with that prompt telemetry surface.
3. **The operation presentation conflates identity and summary.** The service sets `title` to the tool name, while `ToolTokenBadge` renders the same name. Assistant messages also fall through the generic operation-card branch. Finally, the query's `COALESCE(error_text, args_raw, args_digest)` exposes an unexplained 64-character digest when raw arguments were intentionally omitted.
4. **AGY and Codex session identity is lost during import.** In the 24-hour live sample, 18,383 AGY rows and 17,330 Codex rows have `session_id = 'unknown'`. The canonical identities are already encoded in the source paths (`brain/<uuid>/...` and the trailing UUID in `rollout-...-<uuid>.jsonl`), while the upstream `agySplit()` and `codexSplit()` currently ignore `TransformContext.sourceFile`. `RunSessionObserver` must use the same extraction rule or run/task correlation will still disagree with imported identity.
5. **The current task/run selectors are not authoritative.** Historical `history_message.run_id` and `task_wbs` are null in the live corpus. The shipped authorities are `history_run_session` for run → `(source, session_id)` and `task_run_links` for WBS → run. Consolidated timeline filters must join those tables and preserve `exact` versus `estimated` correlation; direct message-column filtering produces an empty or misleading result.
6. **A one-off migration and new CLI verb are unnecessary.** Source-local full import already recomputes normalized record hashes and atomically reconciles stale target, ledger, and checkpoint rows. After the mapper correction, the existing `history import --source <agy|codex> --mode full` path is the repair mechanism. Adding `history backfill-sessions` would duplicate importer ownership and cross the public CLI consent gate.
7. **The horizontal scrubber is a new enhancement, not prototype parity.** The reference prototype and current design document specify the vertical rail but contain no horizontal overview control. This task adds one deliberately, using native accessible interaction and no visualization dependency.

The implementation remains a bounded live-query feature: no new database table, materialized timeline read model, raw transcript mutation, or raw-argument retention policy change is in scope.
### Requirements
- **R1 — Honest duration projection and overview navigation**
  - Preserve every finite positive imported `duration_ms` as `durationSource: 'measured'`.
  - For a null/zero duration, infer only a positive `next.ts - current.ts` interval within the same `(source, session_id)` and at most 10 minutes; expose it as `durationSource: 'inferred'`. Equal, negative, unparsable, missing, cross-session, and greater-than-10-minute gaps remain `durationMs: null`, `durationSource: 'unmeasured'`—never clamp them or render `0ms`.
  - Render duration (`⏱`, with `≈`/tooltip for inferred and `—` for unmeasured) plus full event token load (`⚡ fresh + cache read + output`) in the 136px desktop gutter.
  - Add `TimelineScrubber.tsx`: a dependency-free, bounded overview above the rail that bins at most 96 points, visualizes event density and token peaks, exposes a native range control with an accessible label, and scrolls the selected block into view. It summarizes only the returned timeline window and indicates truncation.

- **R2 — Prompt telemetry without token double-counting**
  - Project a separate nullable `promptTokens` value on user events. For each `(source, session_id)` independently, assign to a user event the sum of usage-bearing events after it and before the next user event; do not move or copy those values into the user's ordinary event-token fields.
  - Keep scope, block, and tool totals derived from the original event allocation so prompt attribution does not change accounting.
  - Remove the inline character-count chip. `UserTokenBadge` must expose on hover and keyboard focus: character and line counts, fresh input, cache read, output, and full turn load. Empty/unattributed values render honestly as zero rather than borrowing from another session or turn.

- **R3 — Separate tool identity, summary, assistant presentation, and omitted payloads**
  - Carry `toolName: string | null` separately from `title`. For tool events, `title` is a concise target/argument summary extracted only from available retained raw arguments (`path`, `file_path`, `target`, `cmd`, `command`, `query`, `pattern`, or `url` priority); if no safe summary exists, leave it empty. Never repeat the tool name beside its tag.
  - Render assistant message/thought events in a dedicated message-card branch with `AgentBadge`, model, output-token telemetry, response preview, and disclosure drawer. Do not render `ToolTokenBadge` or exit status for assistant messages.
  - Replace the bare-digest fallback with explicit drawer text containing tool name, status, and `args_digest: <sha256> (raw payload omitted at import)`. Preserve error text and retained `args_raw` ahead of the digest fallback. Do not broaden `args_raw` retention.

- **R4 — Canonical AGY/Codex session identity and existing full-import repair**
  - In `@gobing-ai/ts-llm-jsonl-importer`, add one exported pure `sessionIdFromSourcePath(source, sourceFile)` helper. Normalize POSIX/Windows separators; accept only UUID-shaped AGY `brain/<uuid>/...` and Codex `rollout-...-<uuid>.jsonl` identities.
  - Pass `TransformContext` to `codexSplit()` and `agySplit()`. Explicit recorded session fields win; Codex `session_meta.payload.id` is valid only for the `session_meta` envelope, generic per-event `raw.id` is retained only for the legacy short format, then path extraction applies, then `'unknown'`.
  - Reuse the exported helper in `RunSessionObserver.sessionIdFor()` after explicit first-record identity so observed run/session mappings use the importer’s canonical key. AGY must no longer fall back to the literal `transcript` stem; unreadable Codex metadata must still resolve from the rollout filename.
  - Release the upstream package, update Spur’s catalog/lock to the released version, then repair existing AGY and Codex rows using source-local full import (dry-run first, write second, provenance recorded). A second full import must be idempotent. No migration or new public CLI verb is permitted.

- **R5 — Source-safe session mode and consolidated multi-agent mode**
  - Replace the timeline input with a discriminated `mode: 'session' | 'consolidated'` contract. Session mode requires both `source` and `sessionId`; consolidated mode accepts the active `HistoryFilter` plus optional `taskWbs` and `runId`, with every supplied axis composed by `AND`.
  - Replace the current GET route with `POST /history/timeline`; update all in-repo callers, handlers, mocks, and tests in the same task. No compatibility shim is required because the current consumer set is in-repo and updated atomically.
  - Fix the shared `buildMessageWhereClauses()` run/task semantics at the root: run scope resolves through `history_run_session`; task scope resolves through `task_run_links → history_run_session`; both match messages on `(source, session_id)`. Unresolved mappings cannot match. `exact` and `estimated` matches remain distinguishable in timeline blocks.
  - Add a bounded `consolidatedTimeline()` query that returns the newest 5,000 matching events and then presents them oldest-to-newest. Group and key blocks by `(source, sessionId, turnIndex)`, order blocks by timestamp with a stable tie-breaker, and report `truncated` when a 5,001st event exists. Never materialize the corpus.
  - Add an accessible Session/Consolidated mode switch. Session selection is keyed by `(source, sessionId)`; consolidated mode applies global time/source/model/tool/skill filters and optional native Task WBS/Run ID fields on explicit form submission. Each block/event retains agent/model identity, and task/run-correlated blocks disclose `exact` or `estimated` mapping.

- **R6 — Tests, real-data evidence, documentation, and gates**
  - Extend the existing upstream mapper tests and in-repo domain, contracts, app service/mock, server handler, observer, and web component tests. Reuse current fixtures/harnesses; add no new test framework or runtime dependency.
  - Update `docs/design/history-board-module.md` and `docs/04_DESIGN.md` in the implementation commit for the POST contract, identity/correlation rules, duration semantics, scrubber, and consolidated view. Root `DESIGN.md` is the UI SSOT and must remain satisfied; it needs no edit unless the design language itself changes.
  - Record source-local import provenance and post-import AGY/Codex sentinel counts. Finish with `bun run autofix && bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, `bun run corpus-check`, and a real `/sp:dev-verify` PASS.
### Acceptance Criteria
```gherkin
Feature: Honest and consolidated History Timeline

  @R1 @domain
  Scenario: Duration projection distinguishes measured, inferred, and unmeasured values
    Given one session contains a positive imported duration, a missing duration followed 2 seconds later, and a missing duration followed more than 10 minutes later
    When its timeline events are projected
    Then the imported duration is unchanged with source "measured"
    And the 2-second interval is returned with source "inferred"
    And the long gap is returned as null with source "unmeasured"
    And no interval is inferred from an event belonging to another source or session

  @R1 @web
  Scenario: Timeline gutter and scrubber expose honest navigation telemetry
    Given timeline data contains measured, inferred, and unmeasured events and more blocks than the overview bin limit
    When the Timeline tab renders
    Then the desktop gutter shows duration and fresh-plus-cache-plus-output token load
    And inferred duration is visibly distinguished from measured duration
    And unmeasured duration renders as a dash rather than 0ms
    And the overview renders at most 96 density/token bins plus one keyboard-operable range control
    And changing the range control scrolls the selected returned block into view
    And a truncated response is labeled as the newest 5,000-event window

  @R2 @app
  Scenario: Prompt telemetry is attributed within one session without changing accounting
    Given a user event is followed by usage-bearing assistant/tool events and then another user event
    When the application projects timeline blocks
    Then the first user's promptTokens equal the fresh, cache-read, and output sums before the next user event
    And events from another source or session are never included
    And ordinary event, block, and scope token totals are unchanged by prompt attribution

  @R2 @web
  Scenario: User prompt secondary telemetry lives in the accessible badge popover
    Given a user prompt contains multiple lines and attributed promptTokens
    When the operator hovers or focuses UserTokenBadge
    Then the popover reports character count, line count, fresh input, cache read, output, and full turn load
    And the prompt header contains no inline character-count chip

  @R3 @presentation
  Scenario: Tool and assistant cards use distinct, non-redundant presentation
    Given a read tool has retained path arguments, another tool has only args_digest, and an assistant message has response text
    When their cards render collapsed and expanded
    Then the read card shows the read tag once followed by the path summary
    And a tool without a safe summary shows only its tag in the collapsed identity area
    And its drawer names the tool and status and labels args_digest as omitted raw payload
    And no bare 64-character digest is rendered without context
    And the assistant message uses AgentBadge, model, output tokens, and response preview without a tool tag or exit code

  @R4 @upstream
  Scenario Outline: Mapper and observer derive the same canonical session id from source paths
    Given a <source> transcript path <path>
    When the upstream mapper and Spur RunSessionObserver resolve it
    Then both return <sessionId>

    Examples:
      | source | path                                                                  | sessionId                            |
      | agy    | /home/r/.gemini/antigravity-cli/brain/11111111-1111-4111-8111-111111111111/.system_generated/logs/transcript.jsonl | 11111111-1111-4111-8111-111111111111 |
      | codex  | C:\\Users\\r\\.codex\\sessions\\2026\\08\\23\\rollout-2026-08-23T12-00-00-22222222-2222-4222-8222-222222222222.jsonl | 22222222-2222-4222-8222-222222222222 |

  @R4 @integration
  Scenario: Existing full import repairs stale unknown session rows idempotently
    Given the released importer contains the corrected AGY and Codex mappers
    When source-local full dry-runs and full writes are executed for agy and codex with provenance captured
    Then valid discovered brain and rollout transcripts no longer produce unknown session rows
    And the corresponding history_tool_call rows use the same canonical session ids
    And AGY and Codex sessions appear in the session roster and can load their timelines
    And a second full import reports zero stale rows and no duplicate target rows
    And no migration or history backfill CLI verb exists

  @R5 @contract
  Scenario: Session timeline identity includes source
    Given two sources contain the same sessionId
    When session mode requests one source and that sessionId
    Then only events for the requested (source, sessionId) pair are returned

  @R5 @domain
  Scenario: Consolidated task and run filters use traceability authorities
    Given task_run_links maps WBS 0638 to a run and history_run_session maps that run to exact and estimated agent sessions
    And matching history_message rows have null run_id and task_wbs columns
    When consolidated mode requests taskWbs 0638 and that runId
    Then matching sessions are resolved through task_run_links and history_run_session
    And every active time/source/model/tool/skill filter also narrows the result
    And blocks disclose exact versus estimated correlation
    And unresolved mappings do not match

  @R5 @web
  Scenario: Operator switches between session and consolidated timelines
    Given multiple agents have matching events in the active scope
    When the operator selects Consolidated and submits optional Task WBS or Run ID scope
    Then the rail renders the newest bounded event window in stable chronological order
    And block keys remain unique across equal turn indexes from different sessions
    And each operation identifies its agent and model
    When the operator returns to Session mode
    Then source-safe roster navigation loads the selected single session

  @R6 @quality
  Scenario: Implementation evidence passes project gates
    Given the implementation and contract documentation are synchronized
    When targeted tests and the required monorepo gates run
    Then importer, observer, domain, contract, app, server, and web regression tests pass
    And the task verification verdict is PASS
```
### Q&A
**Q: Are inferred timestamp gaps true tool execution latency?**

A: No. They are elapsed intervals between consecutive events in the same session. The UI labels them as inferred, preserves producer-measured durations as authoritative, and leaves implausible or missing intervals unmeasured.

**Q: Why is there no one-time migration or `history backfill-sessions` command?**

A: Full import already recomputes normalized rows and atomically removes stale target/ledger rows. Running the existing source-local full import after releasing the mapper fix repairs both message and tool-call identity with dry-run evidence and idempotence. A second repair surface would duplicate ownership and add an unjustified public CLI verb.

**Q: Why must session mode include `source`?**

A: `session_id` is only unique within an importer source; the existing session rollup already groups by `(source, session_id)`. Querying by ID alone can merge unrelated agents that happen to share an identifier.

**Q: How are prompt tokens shown without double-counting?**

A: The application adds a separate `promptTokens` projection to the leading user event. Original event allocations remain the only input to event/block/scope totals and tool badges.

**Q: How do Task WBS and Run ID filters find historical messages when their direct columns are null?**

A: Run scope joins `history_run_session` on `(source, session_id)`; task scope first resolves runs through `task_run_links`, then uses the same mapping. Exact and estimated mappings are surfaced separately; unresolved rows never match.

**Q: Is the horizontal scrubber copied from the reference prototype?**

A: No. The prototype contains the vertical timeline only. This is a new bounded overview built with SVG for the visual bins and a native range input for keyboard/touch interaction.

**Q: Why not persist a timeline read model or retain all raw tool arguments?**

A: The existing indexed live query is bounded to 5,000 returned events, and raw-argument omission is an intentional storage/security policy. Add a read model only if measured query latency misses the Board budget; do not weaken retention for presentation convenience.
### Design
#### 1. Frozen decisions and boundaries

| Decision | Choice | Rationale |
| --- | --- | --- |
| Existing-row repair | Upstream mapper release + existing source-local full import | Reuses atomic hash reconciliation; no migration or public CLI change |
| Duration | `measured \| inferred \| unmeasured`, nullable value, 10-minute inference ceiling | Prevents `0ms` fabrication and avoids calling idle gaps execution time |
| Prompt attribution | Separate `promptTokens` projection | Preserves existing token accounting and tool telemetry |
| Timeline transport | One discriminated POST input, one response shape | Consolidated filters do not belong in a path-only GET; all current callers are in-repo |
| Task/run scope | `task_run_links → history_run_session → history_message` | Those are the shipped traceability authorities; direct message columns are null historically |
| Query/storage | Bounded live SQL, newest 5,000 events, `limit + 1` truncation probe | No speculative read model, migration, or corpus materialization |
| Overview control | At most 96 SVG bins plus native `<input type="range">` | Dependency-free visualization with native keyboard/touch semantics |

Non-goals: changing transcript files, broadening `args_raw` retention, inferring AGY model names, claiming chronological adjacency is causal, adding a timeline table/index before measurement, preserving the obsolete GET route, or adding any public `spur history` verb.

#### 2. Contract and transport (`packages/contracts`, `apps/server`)

In `packages/contracts/src/history.ts`, replace the current path-only input and session-only response with these Zod-equivalent shapes:

```ts
type HistoryTimelineInput =
    | { mode: 'session'; source: string; sessionId: string }
    | {
          mode: 'consolidated';
          filter?: HistoryFilter;
          taskWbs?: string;
          runId?: string;
      };

interface HistoryTimelineScope {
    sessionId: string | null;
    source: string | null;
    model: string | null;
    start: string | null;
    end: string | null;
    durationMs: number;
    tokens: HistoryTokens;
    messageCount: number;
    toolCallCount: number;
    sessionCount: number;
}

interface HistoryTimelineResponseData {
    mode: 'session' | 'consolidated';
    scope: HistoryTimelineScope;
    truncated: boolean;
    blocks: HistoryTimelineBlock[];
}
```

Change event/block schemas as follows:

- `HistoryTimelineEvent.durationMs`: `number | null`.
- Add `durationSource: 'measured' | 'inferred' | 'unmeasured'`.
- Add `toolName: string | null`; keep `title` as presentation summary only.
- Add `promptTokens: HistoryTokens | null`; non-user events always use null.
- Add block `key: string`, `sessionId: string`, and `correlationExactness: 'exact' | 'estimated' | null`.
- Make block `timestamp` nullable rather than manufacturing the Unix epoch.

Change `history.getTimeline` to `POST /history/timeline` with the discriminated input. `apps/server/src/modules/history/handlers.ts` passes the complete input to `HistoryBoardService.getTimeline(input)`. Update the live service interface, mock service, contract tests, and handler tests together; do not retain a hidden alias.

#### 3. Domain query and projection (`packages/domain`)

In `packages/domain/src/analytics/forensic-query.ts`:

1. Correct `buildMessageWhereClauses()` once so every existing analytics caller gets authoritative run/task semantics:
   - `runId`: `EXISTS` a `history_run_session` row with the requested run and the message's `(source, session_id)`.
   - `taskWbs`: `EXISTS` a `task_run_links` row for the WBS joined to `history_run_session` by `run_id`, again matching `(source, session_id)`.
   - Supplied selectors remain composable `AND` predicates. Do not fall back to `history_message.run_id/task_wbs` and do not match `session_id IS NULL`.
2. Change `sessionTimeline(db, source, sessionId, limit)` so source is part of identity. Add `consolidatedTimeline(db, selector, limit)`. Both thin exports reuse one private joined-row query/projector rather than duplicating message/tool expansion.
3. Preserve the current request-id de-duplication and token division across linked tool calls. Add `sessionId` and `recordType` to the row projection so grouping/correlation remains source-session safe.
4. For tool payload, use this precedence: error text → retained raw arguments → explicit multiline digest metadata → null. The digest metadata is:

   ```text
   tool: <toolName>
   status: <status>
   args_digest: <sha256> (raw payload omitted at import)
   ```

5. Fetch `limit + 1`, retain the newest `limit` matching expanded events, then return them in stable ascending order. Stable order is parsed timestamp, message row id, tool sequence, and source/session tie-breakers; null timestamps sort last. Return a truncation bit to the application layer.
6. Apply a single private duration finalizer per `(source, sessionId)`, before consolidated streams are interleaved. A finite positive imported value is measured. Otherwise parse the current/next timestamps; accept only `0 < delta <= 600_000`; all other cases remain null/unmeasured. Multiple calls sharing one timestamp do not receive fabricated divided time.
7. For task/run-scoped consolidated rows, derive block exactness from the matching `history_run_session` rows (`exact` wins over `estimated`; unresolved cannot match). Time-only consolidated blocks use null.

Add focused cases to `packages/domain/tests/analytics/forensic-query-history.test.ts` for source collision, measured/inferred/unmeasured duration, same-session boundaries, stable bounded ordering/truncation, structured digest fallback, and authority-table run/task filtering. Add a direct regression test for `buildMessageWhereClauses()` so CLI `history analyze --run/--task` cannot regress to the null message columns.

#### 4. Application projection (`packages/app`)

Change `HistoryBoardService.getTimeline()` and both implementations to accept `HistoryTimelineInput`.

`LiveHistoryBoardService.getTimeline()` selects the domain query by mode and passes global filter axes through the existing `toArtifactSelector()`, setting `runId`/`taskWbs` only from consolidated input. Keep the existing event-kind classifier.

Use one projection pass with maps keyed by `${source}\u0000${sessionId}\u0000${turnIndex}`:

- Build `scope` from the returned bounded window; do not manufacture epoch timestamps for an empty result.
- Preserve original event token fields as the only source for block/scope totals.
- Build `promptTokens` in a separate per-`(source, sessionId)` scan: hold the latest user event, sum later event usage until the next user event, assign the accumulator, and reset. Flush at end of session. Never scan across interleaved sessions.
- Set `toolName` directly. Parse retained JSON arguments only for the ordered summary keys `path`, `file_path`, `target`, `cmd`, `command`, `query`, `pattern`, `url`; stringify a primitive value, truncate only in the React presentation, and return an empty title on parse failure/digest-only payload.
- Build block keys from source/session/turn, then sort by timestamp and stable key. Session mode throws for empty/sentinel identity; consolidated mode may return an empty scope.

Update `packages/app/tests/services/history-board-service.test.ts`, `history-board-mock-service.test.ts`, and the mock fixtures for the new shape. Assert prompt telemetry does not change scope totals and equal session IDs from two sources never merge.

#### 5. Canonical session identity (`ts-libs` upstream + Spur observer)

In `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`, add and export:

```ts
sessionIdFromSourcePath(source: string, sourceFile: string): string | undefined
```

Normalize `\\` to `/`, then use one UUID pattern:

- `agy`: capture the segment immediately after `/brain/`.
- `codex`: capture the trailing UUID immediately before `.jsonl` in a basename beginning `rollout-`.

Update `codexSplit(raw, context?)` and `agySplit(raw, context?)`. Codex precedence is explicit `raw.session_id` / legacy nested session metadata, `session_meta.payload.id` only when `raw.type === 'session_meta'`, legacy short-format `raw.id`, path helper, then `unknown`. AGY precedence is `raw.session_id` / `raw.conversation_id`, path helper, then `unknown`. Export the helper from the package root.

In `packages/app/src/services/run-session-observer.ts`, import that helper. Refactor `sessionIdFor()` so first-record IDs still win, then call the path helper outside the parse `try/catch`, then use the existing generic stem fallback. This covers AGY `transcript.jsonl` and unreadable Codex metadata without duplicating regexes.

Tests:

- Extend upstream `packages/llm-jsonl-importer/tests/mappers.test.ts` with POSIX and Windows AGY/Codex paths, explicit-ID precedence, non-session Codex `payload.id`, legacy short format, malformed/non-UUID paths, and message/tool rows sharing one ID.
- Extend `packages/app/tests/services/run-session-observer.test.ts` with AGY and Codex path fallback cases.
- Run the upstream package check, release via its existing trusted-publishing tag workflow, then update Spur's root catalog and `bun.lock` to the released version. Temporary `bun link` is validation-only and must not remain in evidence.

Repair/validate real data with the source-local CLI required by the project contract; capture each JSON `provenance` field before accepting output:

```bash
bun run apps/cli/src/index.ts history import --source agy --mode full --dry-run --json
bun run apps/cli/src/index.ts history import --source codex --mode full --dry-run --json
bun run apps/cli/src/index.ts history import --source agy --mode full --json
bun run apps/cli/src/index.ts history import --source codex --mode full --json
bun run apps/cli/src/index.ts history analyze --source all --json
```

Run the two full imports a second time and assert zero stale reconciliation. Query postconditions by source: valid discovered brain/rollout files produce no sentinel session IDs; message/tool session IDs agree; roster/timeline smoke checks include AGY and Codex. Do not use a bare global `spur` for this evidence.

#### 6. Timeline UI (`apps/web`)

In `HistoryShell.tsx`, replace `selectedSessionId` with source-safe selection state, add `timelineMode`, and keep submitted (not per-keystroke) `taskWbs`/`runId` scope. Session mode calls `{ mode: 'session', source, sessionId }`; consolidated mode calls `{ mode: 'consolidated', filter, taskWbs?, runId? }`. Preserve the existing 100-row roster and pass the complete mode/scope state into `TimelineTab`.

In `TimelineTab.tsx`:

- Add an accessible Session/Consolidated segmented radio control. Show the native session selector/Previous/Next only in session mode; show a small `<form>` with Task WBS and Run ID inputs plus Apply in consolidated mode.
- Key expansion state, drawer IDs, test IDs, and block anchors with `block.key`, not `turnIndex` alone.
- Split user, assistant-message, and tool/other rendering branches. The assistant branch never invokes `toolPresentation()` or `ToolTokenBadge`.
- Extend `UserTokenBadge` with `promptTokens`, character count, and line count; remove the inline chip.
- Render the tool tag from `toolName`; render `title` only when non-empty. Keep existing disclosure/touch/focus behavior and dark payload drawer.
- Render gutter duration source honestly and add full token load. `hideOtherEmpty` treats `durationMs: null` as empty only when payload and tokens are also empty.
- Show `correlationExactness` on scoped consolidated blocks, with estimated visibly labeled.

Add `apps/web/src/modules/history/TimelineScrubber.tsx`. Derive at most 96 time bins from returned blocks, scale bar height by event density and color/intensity by token load, render bins in an `aria-hidden` SVG, and overlay one labeled native range input whose value maps to a concrete block anchor. Show returned-window start/end labels and the truncation notice. No chart package, canvas, inner timeline scrollbar, or speculative zoom/pan state.

Extend `apps/web/tests/modules/history/components.test.tsx` and existing History shell tests for all accessible labels, keyboard focus/popovers, mode requests, source-safe selection, card separation, honest durations, bounded bins, range navigation, and truncation notice.

#### 7. Documentation and verification

Update `docs/design/history-board-module.md` and `docs/04_DESIGN.md` in the same implementation commit as the DTO/route changes. Document POST input/response, nullable/inferred duration semantics, separate prompt attribution, `(source, sessionId)` identity, authority-table task/run filtering, exactness labels, bounded newest-window behavior, and the new scrubber. Follow root `DESIGN.md`; no edit is needed unless its visual contract changes.

Run targeted failing tests first, then the upstream package check and in-repo gates in R6. Because task/docs corpus changes are part of the task, the final corpus sweep is mandatory. `/sp:dev-verify 0638` must produce PASS before transition to done.
### Plan
- [x] Add/test/export canonical AGY/Codex source-path session extraction in `@gobing-ai/ts-llm-jsonl-importer`; reuse it from `RunSessionObserver` and prove mapper/observer identity parity (R4).
- [x] Release the upstream importer through trusted publishing, update Spur's catalog/lock to the released version, and remove any temporary link (R4).
- [x] Correct shared run/task selector predicates, refactor the bounded timeline row projector, and add source-safe session plus consolidated queries with honest duration/digest/correlation metadata (R1, R3, R5).
- [x] Replace the timeline contract/handler/service/mock seam with the discriminated POST request and common scope/event/block response; add prompt-token projection without changing accounting (R2, R5).
- [x] Update `HistoryShell` for source-safe session identity and submitted consolidated scope; split user/assistant/tool rendering, repair tool titles/drawers/gutter telemetry, and add the native-accessible bounded `TimelineScrubber` (R1–R5).
- [x] Green the narrow upstream and in-repo mapper, observer, domain, contract, service/mock, handler, and web regressions before running any full suite (R1–R6).
- [x] Run source-local AGY/Codex full dry-runs, record provenance, perform full writes and analysis, repeat for idempotence, and capture sentinel/session-roster postconditions (R4).
- [x] Synchronize `docs/design/history-board-module.md` and `docs/04_DESIGN.md`, then run all R6 gates and `/sp:dev-verify 0638` to PASS (R6).
### Solution
Curated change-map — one row per task-owned changed file, anchored at the primary symbol or assertion.

| Change | Anchor |
| --- | --- |
| Released `@gobing-ai/ts-llm-jsonl-importer` catalog version | `package.json:36` |
| Resolved `@gobing-ai/ts-llm-jsonl-importer@0.4.42` integrity | `bun.lock:414` |
| `historyTimelineInputSchema` discriminated input | `packages/contracts/src/history.ts:172` |
| `timeline is POST` contract regression | `packages/contracts/tests/history-contract.test.ts:31` |
| `ArtifactSelector` mapping-authority contract | `packages/domain/src/analytics/artifact.ts:20` |
| `buildMessageWhereClauses` authoritative predicates | `packages/domain/src/analytics/forensic-query.ts:135` |
| `consolidatedTimeline` public export | `packages/domain/src/analytics/index.ts:46` |
| `duration projection distinguishes` regression | `packages/domain/tests/analytics/forensic-query-history.test.ts:503` |
| `selectors resolve through mapping authorities` regression | `packages/domain/tests/analytics/forensic-query.test.ts:516` |
| Mock `getTimeline` implementation | `packages/app/src/services/history-board-mock-service.ts:519` |
| Live `getTimeline` projection | `packages/app/src/services/history-board-service.ts:605` |
| Canonical `sessionIdFor` observation | `packages/app/src/services/run-session-observer.ts:246` |
| Mock `getTimeline returns valid` regression | `packages/app/tests/services/history-board-mock-service.test.ts:64` |
| `prompt attribution source-safe` regression | `packages/app/tests/services/history-board-service.test.ts:215` |
| `agy transcript.jsonl derives canonical session id` regression | `packages/app/tests/services/run-session-observer.test.ts:324` |
| Complete `getTimeline` handler delegation | `apps/server/src/modules/history/handlers.ts:17` |
| `getTimeline handler returns` regression | `apps/server/tests/modules/history/handlers.test.ts:29` |
| `HistoryShell` source-safe mode and scope state | `apps/web/src/modules/history/HistoryShell.tsx:56` |
| `InsightsTab` source-aware navigation | `apps/web/src/modules/history/InsightsTab.tsx:13` |
| `SessionsTab` source-aware selection | `apps/web/src/modules/history/SessionsTab.tsx:20` |
| `TimelineScrubber` bounded overview | `apps/web/src/modules/history/TimelineScrubber.tsx:13` |
| `TimelineTab` honest/consolidated presentation | `apps/web/src/modules/history/TimelineTab.tsx:306` |
| `Timeline session selection distinguishes` regression | `apps/web/tests/modules/history/components.test.tsx:1121` |
| `TimelineScrubber renders 96 bins` regression | `apps/web/tests/modules/history/timeline-consolidated.test.tsx:13` |
| Agent-facing `getTimeline` transport/input contract | `AGENTS.md:392` |
| `Modes` Timeline surface contract | `docs/design/history-board-module.md:64` |
| `history-board-module.md` satellite index | `docs/04_DESIGN.md:66` |
| `0638` feature task projection | `docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md:115` |

Upstream implementation: `@gobing-ai/ts-llm-jsonl-importer` commits `5fdc2dc` and `c3293fc`, released as `0.4.42`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `finalizeSessionDurations` enforces measured/inferred/unmeasured values at `packages/domain/src/analytics/forensic-query.ts:1020`; `TimelineScrubber` and `jumpToTime` implement the bounded accessible overview at `apps/web/src/modules/history/TimelineScrubber.tsx:13` and `apps/web/src/modules/history/TimelineTab.tsx:406`. Direct regressions: `duration projection distinguishes` at `packages/domain/tests/analytics/forensic-query-history.test.ts:503` and `TimelineScrubber renders 96 bins` at `apps/web/tests/modules/history/timeline-consolidated.test.tsx:13`. |
| R2 | MET | `promptTokens` are accumulated per source/session without changing ordinary totals at `packages/app/src/services/history-board-service.ts:755`; `UserTokenBadge` reports zero-safe lines/chars and turn tokens at `apps/web/src/modules/history/TimelineTab.tsx:137`. Regressions: `prompt attribution source-safe` at `packages/app/tests/services/history-board-service.test.ts:215` and `zero prompt characters and lines` at `apps/web/tests/modules/history/components.test.tsx:510`. |
| R3 | MET | `formatToolPayload`, `extractToolTitle`, and `isAssistantEvent` separate digest context, safe summaries, and assistant presentation at `packages/domain/src/analytics/forensic-query.ts:955`, `packages/app/src/services/history-board-service.ts:183`, and `apps/web/src/modules/history/TimelineTab.tsx:81`. Direct regressions: `digest-only tool payload` at `packages/domain/tests/analytics/forensic-query-history.test.ts:444` and `assistant and tool cards` at `apps/web/tests/modules/history/components.test.tsx:525`. |
| R4 | MET | `sessionIdFor` reuses canonical path extraction at `packages/app/src/services/run-session-observer.ts:246`; released `@gobing-ai/ts-llm-jsonl-importer` 0.4.42 is pinned at `package.json:36`. Observer regressions cover AGY and Codex at `packages/app/tests/services/run-session-observer.test.ts:324` and `packages/app/tests/services/run-session-observer.test.ts:381`; upstream mapper suite passed 131/0. Source-local dry-runs/writes used importer 0.4.42; second passes reported zero stale target/ledger/checkpoint rows. SQLite postconditions: AGY 111,183 messages/50,894 tools/115 sessions and Codex 280,904 messages/55,943 tools/1,405 sessions, with zero sentinel IDs, identity mismatches, or duplicate hashes; both latest sessions loaded via `LiveHistoryBoardService`. |
| R5 | MET | `historyTimelineInputSchema`, `buildMessageWhereClauses`, `sessionTimeline`, and `consolidatedTimeline` implement the source-safe POST and authoritative bounded queries at `packages/contracts/src/history.ts:172`, `packages/domain/src/analytics/forensic-query.ts:135`, `packages/domain/src/analytics/forensic-query.ts:1233`, and `packages/domain/src/analytics/forensic-query.ts:1252`. Executable coverage includes `timeline is POST` at `packages/contracts/tests/history-contract.test.ts:31`, `selectors resolve through mapping authorities` at `packages/domain/tests/analytics/forensic-query.test.ts:516`, `consolidatedTimeline retrieves multi-session events` at `packages/domain/tests/analytics/forensic-query-history.test.ts:875`, `prompt attribution source-safe` at `packages/app/tests/services/history-board-service.test.ts:215`, and `Timeline session selection distinguishes` at `apps/web/tests/modules/history/components.test.tsx:1121`. |
| R6 | MET | Surface synchronization records POST `getTimeline` at `AGENTS.md:392`, `docs/design/history-board-module.md:121`, and the `history-board-module.md` index at `docs/04_DESIGN.md:66` (version 1.48.0). `bun run spur-check` passed 6,245/0 across 341 files with 99.19% functions and 99.06% lines; the later direct AC assertions passed in the domain workspace (1,033/0) and focused web suite (20/0). `bun run autofix`, `bun run test-cf` (1/0), and `bun run build` passed. `bun run corpus-check` completed with zero new/stale errors after 31 task-caused historical anchors were repaired through Spur; its repository-wide exit 1 is solely the 10 unrelated A4 draft warnings on tasks 0639/0640/0642, which remain operator-owned and out of 0638 scope. Fix-pass evidence was re-evaluated in `.spur/run/0638-verdict.json:31-34`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Duration projection distinguishes measured, inferred, and unmeasured values | MET | test | `duration projection distinguishes measured, inferred, and unmeasured values` passes at `packages/domain/tests/analytics/forensic-query-history.test.ts:503`. |
| Scenario: Timeline gutter and scrubber expose honest navigation telemetry | MET | test | `TimelineScrubber renders 96 bins` and `TimelineTab in consolidated mode` pass at `apps/web/tests/modules/history/timeline-consolidated.test.tsx:13` and `apps/web/tests/modules/history/timeline-consolidated.test.tsx:65`, including aria-hidden bins, keyboard range navigation, scroll targeting, inferred duration, and truncation notice. |
| Scenario: Prompt telemetry is attributed within one session without changing accounting | MET | test | `consolidated timeline keeps same-id sessions and prompt attribution source-safe` passes at `packages/app/tests/services/history-board-service.test.ts:215`. |
| Scenario: User prompt secondary telemetry lives in the accessible badge popover | MET | test | `Timeline renders compact cards` and `zero prompt characters and lines` pass at `apps/web/tests/modules/history/components.test.tsx:390` and `apps/web/tests/modules/history/components.test.tsx:510`. |
| Scenario: Tool and assistant cards use distinct, non-redundant presentation | MET | test | `sessionTimeline labels a digest-only tool payload` passes at `packages/domain/tests/analytics/forensic-query-history.test.ts:444`; `Timeline renders assistant and tool cards` passes at `apps/web/tests/modules/history/components.test.tsx:525`. |
| Scenario Outline: Mapper and observer derive the same canonical session id from source paths | MET | test | Upstream importer mapper suite passed 131/0; local `agy transcript.jsonl derives canonical session id` and `codex generic event ids cannot override` regressions pass at `packages/app/tests/services/run-session-observer.test.ts:324` and `packages/app/tests/services/run-session-observer.test.ts:381`. |
| Scenario: Existing full import repairs stale unknown session rows idempotently | MET | command | Source-local AGY/Codex dry-run, full write, and second full write all exited 0 with binary `/Users/robin/xprojects/spur-new/apps/cli/src/index.ts` and importer 0.4.42. Both second passes reported staleTargetRows=0, staleLedgerRows=0, staleCheckpointRows=0; SQLite and live-service probes found zero sentinel/mismatch/duplicate rows and loaded 115 AGY plus 1,405 Codex roster sessions. |
| Scenario: Session timeline identity includes source | MET | test | `timeline is POST and requires source-safe session` passes at `packages/contracts/tests/history-contract.test.ts:31`; `consolidated timeline keeps same-id sessions` passes at `packages/app/tests/services/history-board-service.test.ts:215`. |
| Scenario: Consolidated task and run filters use traceability authorities | MET | test | `selectors resolve through mapping authorities` passes at `packages/domain/tests/analytics/forensic-query.test.ts:516`; `consolidatedTimeline retrieves multi-session events` passes at `packages/domain/tests/analytics/forensic-query-history.test.ts:875`. |
| Scenario: Operator switches between session and consolidated timelines | MET | test | `TimelineTab in consolidated mode` passes at `apps/web/tests/modules/history/timeline-consolidated.test.tsx:65`; `Timeline session selection distinguishes equal ids from different sources` passes at `apps/web/tests/modules/history/components.test.tsx:1121`. |
| Scenario: Implementation evidence passes project gates | MET | command | `bun run autofix`, `bun run spur-check` (6,245/0; 99.19% functions, 99.06% lines), domain workspace tests (1,033/0), focused web tests (20/0), `bun run test-cf` (1/0), and `bun run build` all exited 0. The task-owned corpus result has zero new/stale errors; the unscoped corpus command is nonzero only for 10 unrelated A4 draft warnings. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Phase | Focus | Status | Findings |
|---|---|---|---|
| P1 | Functional Traceability | PASS | All 6 requirements (R1–R6) verified against code and test assertions. Honest duration projection, prompt token attribution, card separation, AGY/Codex canonical session extraction, consolidated multi-agent timeline, and scrubber overview all pass. |
| P2 | SECUA & Quality | PASS | Zero new external runtime dependencies, secure sanitized element IDs, robust error boundary, honest unmeasured duration handling, pure token accounting. |
| P3 | Architecture Depth | PASS | Clean 4-layer seam (contracts DTOs -> domain queries -> application service -> web presentation) with upstream ts-libs mapper integration. |
| P4 | Documentation & Parity | PASS | Synchronized docs/design/history-board-module.md and docs/04_DESIGN.md. |

### References
- Parent feature: `docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md`
- UI design SSOT: `DESIGN.md`; current Timeline surface and API: `docs/design/history-board-module.md:63`, `docs/design/history-board-module.md:108`
- Current event DTO and GET route: `packages/contracts/src/history.ts:162`, `packages/contracts/src/history.ts:445`
- Current shared selectors and session-only query: `packages/domain/src/analytics/forensic-query.ts:132`, `packages/domain/src/analytics/forensic-query.ts:925`
- Current service projection: `packages/app/src/services/history-board-service.ts:582`
- Current UI request/state and rendering defects: `apps/web/src/modules/history/HistoryShell.tsx:58`, `apps/web/src/modules/history/HistoryShell.tsx:231`, `apps/web/src/modules/history/TimelineTab.tsx:149`, `apps/web/src/modules/history/TimelineTab.tsx:617`, `apps/web/src/modules/history/TimelineTab.tsx:684`, `apps/web/src/modules/history/TimelineTab.tsx:712`
- Traceability authorities: `packages/domain/src/dao/run-session-dao.ts:50`, `packages/domain/src/dao/task-run-link-dao.ts:22`, `docs/04_DESIGN.md:355`, `docs/04_DESIGN.md:1353`
- Run observer identity seam: `packages/app/src/services/run-session-observer.ts:242`
- `@gobing-ai/ts-llm-jsonl-importer` `src/mappers.ts` line 608 (`codexSplit`), line 779 (`agySplit`), line 982 (current filename helper)
- `@gobing-ai/ts-llm-jsonl-importer` `src/importer.ts` line 410 and `src/jsonl-importer-dao.ts` line 495 (existing full-mode reconciliation)
### History
- 2026-08-23T20:15:57.727Z todo → wip (system)
- 2026-08-23T20:51:49.325Z wip → testing (system)
- 2026-08-23T20:52:05.596Z testing → done (system)
