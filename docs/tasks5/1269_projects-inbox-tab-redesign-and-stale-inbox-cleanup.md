---
schema_version: 1
name: Projects Inbox tab redesign and stale inbox cleanup
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.648Z
updated_at: "2026-10-20T18:04:36.588Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - web
  - docs

dependencies: ["1267"]
estimate_hours: 7
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

- [ ] R1. Replace `ConversationView` with `InboxView` (`apps/web/src/modules/projects/InboxView.tsx`), registered as the `inbox` tab. It has three panes:
  - a member list from `client.inbox.members` (fleet members first, then other addresses), with unread counts;
  - the selected member's two-direction thread from `client.inbox.list({member, direction: 'both'})`, grouped by `threadId`;
  - a composer that sends or replies as `operator`, with a per-message "mark read" action.
  
  It refetches on SSE `message.*` events whose `fromId`/`toId` match the selected member.
- [ ] R2. GlobalAgentBar sends through `client.inbox.send({ body, projectPath })`: no `from` (the server defaults to `operator`), no `to` (orchestrator), and no envelope. Receipts come from `client.inbox.requests` and are refreshed on SSE.
- [ ] R3. MemberTerminal writes typed lines only to the process stdin, and `messagesUrl` is deleted.
- [ ] R4. Delete:
  - `buildRecentMessagesThread`
  - `REQUEST_ENVELOPE_PREFIX` and its parse/format helpers
  - `OPERATOR_AGENT_ID = 'board-operator'` (use `'operator'` where a literal is needed)
  - `ConversationView.tsx`
  - the `conversation`/`processes` members of `ProjectTabId` and the legacy segment mapping in `useProjectTab.ts`
  - the `inbox` redirect in `router.tsx`
  - the `.inbox` CSS block in `global.css`
  - every raw `fetch` to `/api/messages*` or `/api/project/requests`
  - the tests of deleted code
- [ ] R5. Docs:
  - delete `docs/design/inbox-board-module.md` and its `04_DESIGN.md` row, and repoint the three `board-module-boundaries.md` references to `inter-agent-control-plane.md` §13;
  - fold the message-plane facts (lifecycle, reserved ids, member keying, ledger relay) into `inter-agent-control-plane.md` §13;
  - update `03_ARCHITECTURE.md` (~585 and §14) to the `queued → claimed → delivered|failed` lifecycle and the InboxService path;
  - set ADR-143 to Accepted.

Out of scope: new visual tokens (reuse DESIGN.md components), the CLI (1268), and deleting the `AgentCoordinationService` message wrappers (cross-task proposal).

### Acceptance Criteria

- [ ] AC1 — The Inbox tab shows one fleet member's two-direction thread
- [ ] AC2 — The Inbox tab replies and marks read inline
- [ ] AC3 — The Board global input sends as operator to the orchestrator
- [ ] AC4 — Terminal input is not duplicated into the inbox
- [ ] AC5 — Stale inbox code and docs are gone

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G11 R14–R18; plan §3.4; ADR-143 (→ Accepted here), ADR-116; DESIGN.md; `docs/design/inter-agent-control-plane.md` §13.
- Prior art: 0840 (Projects tabs), 0841/0844 (operator requests and receipts), 0261 (terminal → messages, now reverted), 0422 (`.inbox` retoken, removed), 0988/0992 (CDP browser proofs).
- Depends on 1267. Proposal: also depend on 1268, to own the `AgentCoordinationService` wrapper deletion.

### History
