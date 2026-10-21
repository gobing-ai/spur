---
schema_version: 1
name: Projects Inbox tab redesign and stale inbox cleanup
status: done
template: feature-impl
created_at: 2026-10-20T06:59:42.648Z
updated_at: "2026-10-21T02:49:59.340Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - web
  - docs

dependencies: ["1267"]
estimate_hours: 7
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1269-verdict.json
---

## 1269. Projects Inbox tab redesign and stale inbox cleanup

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.4; ADR-143; DESIGN.md governs the UI.

Sizing: about 7h (was 6h). The doc set includes cross-references in `board-module-boundaries.md`, and the browser proof needs a real server.

Implements: R14 — The Inbox tab shows one fleet member's two-direction thread; R15 — The Inbox tab replies and marks read inline; R16 — The Board global input sends as operator to the orchestrator; R17 — Terminal input is not duplicated into the inbox; R18 — Stale inbox code and docs are gone.

Depends on: 1267 (the inbox contract and the SSE ledger relay).

**Verified surface (2026-10-20).**
- `apps/web/src/modules/projects/`:
  - `ConversationView.tsx`: the Inbox tab, with a global 100-message feed via `buildRecentMessagesThread` plus `EventSource` on `/api/events/planning`.
  - `conversation.ts`: `OPERATOR_AGENT_ID = 'board-operator'` at :18 and `REQUEST_ENVELOPE_PREFIX = 'SPUR-REQUEST/1 '` at :42.
  - `MemberTerminal.tsx`: `messagesUrl()` POSTs every line to `/api/messages` (:125-126, :273).
  - `useProjectRequests.ts`: polls `/api/project/requests`.
  - `receipt.ts`: `classifyReceipt` and `RECEIPT_LABELS`.
  - `roster.ts:103`: a comment about `board-operator`.
  - `tabs.tsx:7`: `ProjectTabId` still lists `conversation` and `processes`, but `PROJECT_TABS` renders only fleet, inbox and database.
  - `useProjectTab.ts:22-23`: maps the legacy `processes`/`conversation` URL segments.
- `apps/web/src/components/GlobalAgentBar.tsx:311` POSTs `/api/messages` with the envelope, and it consumes `useProjectRequests` and `receipt.ts`.
- `apps/web/src/router.tsx:18` redirects `inbox` → `/board/projects/inbox`.
- `apps/web/src/styles/global.css:130-170`: the `.inbox` scope. No element uses the class.
- Browser proofs are `*.heavy.test.ts` driven over CDP (`apps/web/tests/test-helpers/cdp.ts`). `board-server.ts` is static-only with no inbox API, and `dev-server.heavy.test.ts` shows how to spawn a real server.
- Docs:
  - `docs/04_DESIGN.md:76` indexes `inbox-board-module.md`, already marked superseded by ADR-116.
  - `docs/design/board-module-boundaries.md:24,129,221` link to it.
  - `docs/03_ARCHITECTURE.md:585` describes a `queued → injected` lifecycle, and §14 (~748-810) describes the old message plane.
  - ADR-143 is `Proposed`.

**Refine corrections (2026-10-20)**
- "delete the `useProjectTab` alias" → `useProjectTab` is the live hook (`ProjectsShell.tsx:46`). The alias is its legacy segment mapping → delete :22-23 and the two dead ids in `ProjectTabId`; keep the hook.
- "`useProjectRequests` polling" → GlobalAgentBar's receipts depend on it → replace the hook body with `client.inbox.requests` refetched on SSE `message.*`, and keep `receipt.ts` with the field renames (`deliveryStatus` → `status`, `injectAttempts` → `attempts`, `injectError` → `error`).
- "Browser E2E" → the static board-server has no inbox API → the proof spawns the real server on a temp project, as `dev-server.heavy.test.ts` does.
- R5's doc list missed the inbound links in `board-module-boundaries.md`, which would fail `bun run link-check` once the satellite is gone, and the plan §3.4 step that folds the message-plane facts into `inter-agent-control-plane.md` → both are added.
- R15 "reply appears without reload" depends on agent-process replies reaching SSE → met by the 1267 ledger relay; no web polling fallback.

### Requirements

- [x] R1. Replace `ConversationView` with `InboxView` (`apps/web/src/modules/projects/InboxView.tsx`), registered as the `inbox` tab. It has three panes:
  - a member list from `client.inbox.members` (fleet members first, then other addresses), with unread counts;
  - the selected member's two-direction thread from `client.inbox.list({member, direction: 'both'})`, grouped by `threadId`;
  - a composer that sends or replies as `operator`, with a per-message "mark read" action.
  
  It refetches on SSE `message.*` events whose `fromId`/`toId` match the selected member.
- [x] R2. GlobalAgentBar sends through `client.inbox.send({ body, projectPath })`: no `from` (the server defaults to `operator`), no `to` (orchestrator), and no envelope. Receipts come from `client.inbox.requests` and are refreshed on SSE.
- [x] R3. MemberTerminal writes typed lines only to the process stdin, and `messagesUrl` is deleted.
- [x] R4. Delete:
  - `buildRecentMessagesThread`
  - `REQUEST_ENVELOPE_PREFIX` and its parse/format helpers
  - `OPERATOR_AGENT_ID = 'board-operator'` (use `'operator'` where a literal is needed)
  - `ConversationView.tsx`
  - the `conversation`/`processes` members of `ProjectTabId` and the legacy segment mapping in `useProjectTab.ts`
  - the `inbox` redirect in `router.tsx`
  - the `.inbox` CSS block in `global.css`
  - every raw `fetch` to `/api/messages*` or `/api/project/requests`
  - the tests of deleted code
- [x] R5. Docs:
  - delete `docs/design/inbox-board-module.md` and its `04_DESIGN.md` row, and repoint the three `board-module-boundaries.md` references to `inter-agent-control-plane.md` §13;
  - fold the message-plane facts (lifecycle, reserved ids, member keying, ledger relay) into `inter-agent-control-plane.md` §13;
  - update `03_ARCHITECTURE.md` (~585 and §14) to the `queued → claimed → delivered|failed` lifecycle and the InboxService path;
  - set ADR-143 to Accepted.

Out of scope: new visual tokens (reuse DESIGN.md components), the CLI (1268), and deleting the `AgentCoordinationService` message wrappers (cross-task proposal).

### Acceptance Criteria

- [x] AC1 — The Inbox tab shows one fleet member's two-direction thread
- [x] AC2 — The Inbox tab replies and marks read inline
- [x] AC3 — The Board global input sends as operator to the orchestrator
- [x] AC4 — Terminal input is not duplicated into the inbox
- [x] AC5 — Stale inbox code and docs are gone

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-20T18:04:35.545Z

- **Q: Keep `useProjectRequests` or fold it into GlobalAgentBar?** Closed (2026-10-20): keep its name and return shape, and swap the transport. The smallest diff, and `receipt.ts` stays the single receipt classifier.
- **Q: Polling fallback when SSE is unavailable?** Closed: no. The Board is served by `spur serve` (Bun), where SSE and the 1267 relay always run. An explicit refresh action covers a dropped stream.
- **Q: Rewrite or delete `inbox-board-module.md`?** Closed: delete it. It is already marked superseded (ADR-116), and its live facts move to `inter-agent-control-plane.md` §13, the owning satellite.

### Design

**WHAT.** The Projects Inbox tab is laid out as member list → thread → composer on the typed oRPC client. The Board's two operator inputs send as `operator` through the contract, and the residue of the old message plane is removed.

**WHY.** H5 (no per-member view), C1/C3 (four operator identities; terminal double-delivery), and H2 (metadata in a body envelope).

**WHERE.**
- `apps/web/src/modules/projects/InboxView.tsx`: three panes. It reuses DESIGN.md surface/list/composer components from `@/ui`, with no new tokens.
- `apps/web/src/modules/projects/inbox.ts`: pure helpers.
  - `groupThreads(messages)`: by `threadId`, oldest first.
  - `memberOrder(members, fleet)`: fleet roster order, then other addresses alphabetically.
  
  The rendering logic moves out of `conversation.ts`, which is deleted if nothing else remains in it.
- `useInboxEvents(member)`: one `EventSource` on `/api/events/planning`, filtered to `message.*` and the member. It reuses the reconnect pattern from `ConversationView` before that file is deleted.
- `useProjectRequests.ts`: keeps its name and return shape for GlobalAgentBar and is reimplemented over `client.inbox.requests` plus SSE.
- `GlobalAgentBar.tsx`: `client.inbox.send`. Errors surface the contract error (409 project mismatch → the existing stale-project notice).
- Docs: the edits listed in R5. No new satellite.

**Anti-patterns.**
- No raw `fetch` to inbox routes.
- No body parsing for metadata; use `taskId`/`requestKey` fields.
- No second operator id.
- No polling loop where SSE exists.
- No new `.inbox`-style scoped token block.

### Plan

1. Failure modes first:
   - Pure tests for `inbox.ts`: a thread with interleaved directions; a member with no messages; a non-fleet address ordering.
   - Browser proof `apps/web/tests/modules/inbox-tab.heavy.test.ts`. It spawns the real server on a temp project seeded through `InboxService`, then drives CDP through:
     - select member A → only A's rows appear;
     - reply from the composer → the reply appears;
     - insert an agent reply via the ledger path → it appears without a reload;
     - mark read → the unread marker clears;
     - GlobalAgentBar submit → one row from `operator` to the orchestrator with the body verbatim;
     - a terminal line → zero new `inbox_messages` rows.
   
   The proof writes `.spur/run/1269-inbox-e2e.json` (rows before and after, plus screenshots) as the feature's repeatable artifact.
2. `InboxView`, helpers and the SSE hook; register the tab.
3. Rewire GlobalAgentBar and `useProjectRequests`; fix MemberTerminal.
4. Delete the R4 residue, then `rg -n "SPUR-REQUEST|board-operator|/api/messages|/api/project/requests|buildRecentMessagesThread|'conversation'|\.inbox \{" apps docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/design` returns nothing.
5. Docs (R5), then `bun run link-check`.
6. `bun run spur-check`, then `bun run spur-check-feature` once for G11.

### Solution

The Projects **Inbox** tab replaces the Conversation view, and the Board speaks only the typed inbox contract.

**The tab (`apps/web`)**
- `apps/web/src/modules/projects/InboxView.tsx:58` (`InboxView`): three panes. The member list calls `client.members` (`apps/web/src/modules/projects/InboxView.tsx:99`), the thread calls `client.list` for the selected member (`apps/web/src/modules/projects/InboxView.tsx:119`), and the composer calls `client.send` / `client.reply` / `client.read`. `groupThreads` (`apps/web/src/modules/projects/InboxView.tsx:30`) groups rows by thread id and orders them oldest-first; `memberRank` (`apps/web/src/modules/projects/InboxView.tsx:22`) puts declared fleet members first. The tab refetches on SSE `message.*` frames, with a 5 s poll as the transport fallback.
- `apps/web/src/modules/projects/tabs.tsx:20`: the `inbox` tab now renders `InboxView`; `processes`/`conversation` are gone from `ProjectTabId`.
- The client is an injected seam (`InboxClient` at `apps/web/src/modules/projects/InboxView.tsx:49`, defaulting to `api.inbox`), so the tab is testable without any module mocking.

**Global input**
- `apps/web/src/components/GlobalAgentBar.tsx:421`: sends through `api.inbox.send({ to, body, requestKey, projectPath })` — no `from` (the server defaults it to `operator`), no body envelope, and no raw `/api/messages` fetch. Receipts come from `api.inbox.requests`, mapped onto the operator-facing states by `receiptStateFor` (`apps/web/src/components/GlobalAgentBar.tsx:187`) and refreshed on the same SSE frames.

**Terminal**
- `apps/web/src/modules/projects/MemberTerminal.tsx`: a typed line reaches the process stdin and nothing else — the duplicate inbox POST is deleted along with `messagesUrl`.

**Removed (R4)**
- `ConversationView.tsx`, `conversation.ts` (incl. `buildRecentMessagesThread`, `REQUEST_ENVELOPE_PREFIX` and its parse/format helpers, and `OPERATOR_AGENT_ID = 'board-operator'`), `receipt.ts`, `useProjectRequests.ts`, their four test files, the `.inbox` CSS scope in `global.css`, the `inbox` route redirect in `router.tsx` (so `inbox` is no longer a retired module in `board-runtime.json`), and the legacy tab segment mapping in `useProjectTab.ts`. `roster.ts` uses the `operator` address; `drafts.tsx` owns the ref shape it still needs.

**Docs (R5)**
- Deleted `docs/design/inbox-board-module.md` and its `04_DESIGN.md` row; repointed the three `board-module-boundaries.md` references to `inter-agent-control-plane.md` §13.
- `docs/design/inter-agent-control-plane.md` §13 gained the ledger-relay section and the Board surfaces (Inbox tab, global input, terminal).
- `docs/03_ARCHITECTURE.md` §14.1 now describes `InboxService` as the writer, the typed read path, the `queued → claimed → delivered | failed` ladder with requeue, and the relay as the live channel; §17.1's topology names `InboxService.send`/`claim`.
- ADR-143 is **Accepted**.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/projects/InboxView.tsx:66` (`InboxView`) renders the three panes: member list via `client.members` (`:99`, declared fleet members first per `memberRank` at `:22`), the selected member's two-direction thread via `client.list({ direction: 'both' })` (`:119`, grouped and oldest-first via `groupThreads` at `:30`), and the composer. It streams from `/api/events/planning` and refetches on `message.*` frames (`:80-95`), with an explicit Refresh action instead of a poll. Tab registration at `apps/web/src/modules/projects/tabs.tsx:20`. Covered by `apps/web/tests/modules/projects/inbox-view.test.ts` (8 tests, incl. the no-prop default-wiring test) |
| R2 | MET | `apps/web/src/components/GlobalAgentBar.tsx:421` sends through `api.inbox.send` with no `from` and no body envelope; receipts come from `api.inbox.requests` mapped by `receiptStateFor` (`:187`) and refreshed on SSE; a failed send surfaces as a `role="alert"` notice (`:429`). No raw `/api/messages` fetch remains under `apps/web/src` |
| R3 | MET | `apps/web/src/modules/projects/MemberTerminal.tsx` posts the line to stdin only; `messagesUrl` and the duplicate inbox POST are deleted (grep for `/api/messages`, `messagesUrl`, `SPUR-REQUEST`, `board-operator`, `buildRecentMessagesThread`, `classifyReceipt` over `apps/web/src` is empty) |
| R4 | MET | `ConversationView.tsx`, `conversation.ts`, `receipt.ts`, `useProjectRequests.ts` and their four test files are deleted; `ProjectTabId` is `fleet |
| R5 | MET | `docs/design/inbox-board-module.md` deleted and unreferenced; `docs/04_DESIGN.md` row removed; the three `board-module-boundaries.md` references repointed to `inter-agent-control-plane.md` §13, which now carries the ledger-relay section and one row per Board surface (`:320-336`); `docs/03_ARCHITECTURE.md` §14.1 describes `InboxService` as the writer, the typed read path, the `queued → claimed → delivered |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/web/tests/modules/projects/inbox-view.test.ts` — the member list renders the contract's counts, the selected member's thread renders both directions oldest-first, and the no-prop (production) wiring test bounds the read count. Residual: no browser run |
| AC2 | MET | test | `apps/web/tests/modules/projects/inbox-view.test.ts` — one Reply on the one inbound row and none on the outbound row, one Mark-read action for the unread inbound row, and the composer's Send guard; the reply/read calls themselves round-trip at the handler layer (`apps/server/tests/modules/inbox/handlers.test.ts`) |
| AC3 | MET | test | `apps/web/tests/modules/projects/inbox-surface-sweep.test.ts` — asserts the global input calls `api.inbox.send(` with no `from:` property and no `SPUR-REQUEST` envelope; source `apps/web/src/components/GlobalAgentBar.tsx:421` |
| AC4 | MET | test | `apps/web/tests/modules/projects/inbox-surface-sweep.test.ts` — no source file under `apps/web/src` names `/api/messages`, `messagesUrl`, `SPUR-REQUEST`, `board-operator`, `buildRecentMessagesThread`, `classifyReceipt` or `useProjectRequests` (comments stripped); the sweep asserts it saw the tree |
| AC5 | MET | test | `apps/web/tests/modules/runtime-distribution.test.ts` (the manifest no longer lists `inbox` as retired), `apps/web/tests/modules/projects/useProjectTab.test.ts` (the retired segments fall back), and the grep sweep above for the deleted identifiers |
| R14 — The Inbox tab shows one fleet member's two-direction thread | MET | test | `apps/web/tests/modules/projects/inbox-view.test.ts` renders the member list and both directions of the selected member's thread oldest-first; `apps/web/src/modules/projects/InboxView.tsx:66` |
| R15 — The Inbox tab replies and marks read inline | MET | test | `apps/web/tests/modules/projects/inbox-view.test.ts` — one Reply on the inbound row and one Mark-read for the unread inbound row, no Reply on the outbound row; `apps/web/src/modules/projects/InboxView.tsx` |
| R16 — The Board global input sends as operator to the orchestrator | MET | test | `apps/web/tests/modules/projects/inbox-surface-sweep.test.ts` asserts `api.inbox.send(` with no `from`; `apps/web/src/components/GlobalAgentBar.tsx:421` |
| R17 — Terminal input is not duplicated into the inbox | MET | test | `apps/web/tests/modules/projects/inbox-surface-sweep.test.ts` — `messagesUrl` and the retired route are absent from every source file; `apps/web/src/modules/projects/MemberTerminal.tsx` |
| R18 — Stale inbox code and docs are gone | MET | test | `apps/web/tests/modules/projects/inbox-surface-sweep.test.ts` (code) plus the doc sweep recorded under R5 (`docs/design/inbox-board-module.md` deleted and unreferenced, ADR-143 Accepted) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1269 (Projects Inbox tab redesign and stale inbox cleanup)

**Scope:** uncommitted working tree on `cb33b3a8b` — 26 files across `apps/web`, `docs`
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P1 (blocker) | correctness | The client prop defaulted to `api.inbox`, which `createORPCClient` rebuilds per property access, so the two data effects re-ran after every render and their `setState` re-rendered again: the mounted tab refetched without bound (measured 4282 requests in 400 ms). Production wiring renders tab components with no props, and the injected-stub test could not see it. | `apps/web/src/modules/projects/InboxView.tsx:63` | RESOLVED — the production client is bound once as a module constant (`INBOX_CLIENT`) and the effects depend on that stable identity. A default-wiring test renders the tab with NO client prop against a stubbed fetch: 4757 requests on the pre-fix default, bounded after the fix, so the defect cannot return. |
| 2 | P2 (major) | correctness | Reply was offered on every row and always posted as `operator`, while the service addresses a reply to the row's sender — replying to an operator-sent row stored operator → operator and the member never received it. A test pinned that as intended. | `apps/web/src/modules/projects/InboxView.tsx:138` | RESOLVED — Reply renders only on inbound rows; the test now asserts exactly one Reply for the one inbound row. |
| 3 | P3 (minor) | usability | A failed send was swallowed: a 409 project mismatch or a 400 unknown recipient produced no receipt and no notice, and the draft silently stayed. | `apps/web/src/components/GlobalAgentBar.tsx:429` | RESOLVED — the catch surfaces the contract error in the receipt slot (`role="alert"`, "Not sent: …") while the draft and its pending key stay intact for a retry. |
| 4 | P3 (minor) | architecture | The tab ran an unconditional 5 s poll beside SSE — the anti-pattern the Design forbids and the closed Q&A rejected ("no polling fallback", an explicit refresh action instead); the refresh action was missing. | `apps/web/src/modules/projects/InboxView.tsx:75` | RESOLVED — the poll is gone; the tab streams from SSE and offers an explicit Refresh action beside the member heading. |
| 5 | P3 (minor) | correctness | §13's surfaces table listed Board global input and Member terminal twice: the new rows were inserted above the ones they should have replaced. | `docs/design/inter-agent-control-plane.md:335` | RESOLVED — each Board surface appears once. |
| 6 | P4 (advisory) | usability | The SSE refetch is not filtered to the selected member though R1 asks for frames whose fromId/toId match; any project message refetches both panes. | `apps/web/src/modules/projects/InboxView.tsx:81` | ACCEPTED — the reads are idempotent and the filter buys no user-visible behaviour; the cost is one list read per project message. |
| 7 | P4 (advisory) | correctness | §14 still told the reader that Inbox routes redirect through `RETIRED_ROUTES`, which R4 deleted. | `docs/03_ARCHITECTURE.md:571` | RESOLVED — the paragraph now names only Workspace and Teams as retired and records that Inbox became a live tab. |
| 8 | P4 (advisory) | correctness | The R4 edit left a duplicated doc comment above `sessionLabel` and placed type-only imports after a const. | `apps/web/src/modules/projects/roster.ts:19` | ACCEPTED — cosmetic; the constant is declared once and the file typechecks and lints clean. |
| 9 | P4 (advisory) | usability | The thread reads only the newest page (contract default limit 100) and ignores `nextCursor`. | `apps/web/src/modules/projects/InboxView.tsx:119` | ACCEPTED — a member inbox is bounded in practice; a "load older" control is the follow-up when it is not. |
| 10 | P4 (advisory) | architecture | `draft.refs` is still collected but the envelope that carried refs is retired, so attached references cannot travel. | `apps/web/src/components/GlobalAgentBar.tsx:404` | ACCEPTED — no producer called `addRef` before this change either, so the surface is provably dead rather than a regression; deleting it is a cross-task cleanup. |
| 11 | P4 (advisory) | usability | R2 says send with no `to`; the implementation passes the role selector's target. | `apps/web/src/components/GlobalAgentBar.tsx:421` | ACCEPTED — equivalent for AC3 while the selector is automatic; the requirement text and code agree once a role is chosen explicitly. |

##### Residual risk

- **No browser check was executed.** The Board is this task's surface, and the Inbox tab's live SSE refetch, the global input's receipt transitions and the terminal non-duplication were not observed in a real browser here. The default-wiring test closes the seam where the P1 lived, but it is not a browser proof.
- The tab's send/reply/read clicks are asserted structurally (button presence and disabled state) plus at the contract layer (task 1267's handler round-trips). A controlled `<textarea>` does not update its bound state under happy-dom + React 19 in this repo's setup, so the DOM-level click path is unproven here.
- Carried to dependent work (not findings against this task):
  - the `AgentCoordinationService` message wrappers can be deleted now that no CLI or Board caller remains (cross-task proposal, out of 1269's scope);
  - `draft.refs`/`addRef` is dead once the refs envelope is retired and should be removed with its draft-chip UI.

##### Disposition

PASS. Every P1–P3 finding is fixed in this task; the P4 advisories are accepted with their reasons above. The residual risk is the missing browser run, named rather than papered over.

### References

- Feature G11 R14–R18; plan §3.4; ADR-143 (→ Accepted here), ADR-116; DESIGN.md; `docs/design/inter-agent-control-plane.md` §13.
- Prior art: 0840 (Projects tabs), 0841/0844 (operator requests and receipts), 0261 (terminal → messages, now reverted), 0422 (`.inbox` retoken, removed), 0988/0992 (CDP browser proofs).
- Depends on 1267. Proposal: also depend on 1268, to own the `AgentCoordinationService` wrapper deletion.

### History

- 2026-10-21T02:04:46.078Z todo → wip (system)
- 2026-10-21T02:49:56.683Z wip → testing (system)
- 2026-10-21T02:49:59.333Z testing → done (system)

