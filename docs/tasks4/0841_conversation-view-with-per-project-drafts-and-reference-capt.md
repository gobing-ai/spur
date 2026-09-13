---
schema_version: 1
name: Conversation view with per-project drafts and reference capture
status: done
template: feature-impl
created_at: 2026-09-12T04:54:51.543Z
updated_at: "2026-09-12T22:29:57.672Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0840"]
---

## 0841. Conversation view with per-project drafts and reference capture

### Background

No conversation surface exists. Inbox shows raw messages by endpoint
(`apps/web/src/modules/inbox/AllTab.tsx`, `AgentTab.tsx`, `SupervisorTab.tsx`), which is a queue
viewer, not a request/response thread.

The prototype models the target: human requests, orchestrator responses, holds, and result links in
one thread, with drafts retained per project and never leaking across projects
(`docs/prototypes/g6-projects/index.html`; scenarios R2-1…R2-7 and ST-1 in
`docs/reports/g6-projects-prototype.md`).

Submission itself lands in the global-input task; this task owns the thread, its rehydration, and
reference capture.

### Requirements

- **R1** — One thread per project showing human requests, orchestrator responses, hold reasons, and
  links to results.
- **R2** — Drafts are retained per project and never leak across projects; a project switch restores
  that project's draft.
- **R3** — Task and feature references are captured explicitly on the request, not parsed out of prose
  after the fact.
- **R4** — The thread rehydrates after a refresh from persisted requests and receipts, not from
  client-only state.
- **R5** — Corrupt or unavailable client storage degrades to an empty draft rather than breaking the
  view (prototype ST-1).
- **R6** — Reuses `/api/messages*`; no new client-side message store.

### Acceptance Criteria

```gherkin
Feature: Conversation view with per-project drafts and reference capture

  @core
  Scenario: Drafts stay with their project
    Given an unsent draft in one project
    When the operator switches to another project and back
    Then the draft is restored and the other project's draft is untouched

  @core
  Scenario: The thread survives a refresh
    Given requests and results in a project conversation
    When the Board is refreshed
    Then the thread rehydrates from persisted requests and receipts

  @core
  Scenario: References are explicit
    Given the operator references a task from Work
    When the request is submitted
    Then the reference travels as structured data on the request

  @core
  Scenario: Corrupt storage degrades safely
    Given unreadable client draft storage
    When the conversation opens
    Then it renders with an empty draft and no error state
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:48:14.069Z

- **How do references travel structurally? — CLOSED: a `SPUR-REQUEST/1` envelope line in the message
  body.** `inbox_messages` is owned by `@gobing-ai/ts-db`, so a `refs` column would be an engine
  release for a presentation concern; a sibling JSON body field on `POST /api/messages` would strand
  the refs because only the body reaches the agent's prompt. The envelope is written structurally at
  capture time and read by splitting on the first blank line, so R3's "not parsed out of prose" holds.
- **Where do drafts leak across projects? — CLOSED: they cannot leak live; the hazard is port reuse.**
  Browser storage is origin-scoped and each project's Board is its own origin (its own port), so a
  live cross-project read is impossible. `ProjectRegistry` can reassign a freed port to a different
  project, which is the one path by which a stale draft resurfaces. The stored `path` guard closes it.
- **One draft record or a per-project map? — CLOSED: one record with a path guard.** An origin serves
  exactly one project (task 0840), so a map would index a dimension that is always length one.
- **Which read builds the thread? — CLOSED: `getInbox`, never `drainPending`.** `getInbox` is
  documented and implemented as non-consuming (`packages/app/src/services/team-service.ts:333-349`);
  `drainPending` transitions `queued → injected` and would consume the orchestrator's own queue from
  the Board.
- **What is the operator's mailbox identity? — CLOSED: `board-operator`.** `sendMessage` validates both
  endpoints against `/^[a-z][a-z0-9_-]{1,63}$/`; `board-operator` satisfies it with no engine change.
  It is an address, not a fleet member, and the Agents roster must not show it.
- **Does this task surface `request_key`? — CLOSED: no, 0844 does.** `TeamService.getInbox` does not map
  the column that task 0832 adds, and this task does not depend on 0832. `ConversationEntry.requestKey`
  is frozen here as optional and populated by 0844, which does depend on 0832 — the seam is declared
  rather than inverted.
- **Hold reasons and result links in the thread — DEFERRED to 0844 by design, not left open.** This
  task renders the inbox row's own `deliveryStatus` verbatim; the receipt-derived state vocabulary
  (`queued-awaiting-orchestrator`, `rest-held`, `outcome-unknown`, …) is 0844's requirement R5 and
  fills `ConversationEntry.receipt`.

### Design

**WHAT.** A `Conversation` tab component that renders one request/response thread for the served
project, rehydrated from `/api/messages*`, plus a per-project draft record in client storage and an
explicit reference-capture model. Submission itself is 0844's; this task owns the thread, its
rehydration, the draft, and the payload encoding that carries references.

**WHY the thread is two existing reads, not a new store.** A Board request is an `inbox_messages` row
addressed to the orchestrator instance, and an orchestrator response is a row addressed back. Both are
already readable, non-consumingly, through `GET /api/messages/inbox?agent=<id>`
(`apps/server/src/modules/messages/index.ts:26-38` → `TeamService.getInbox`, which is explicitly a
non-consuming read, `team-service.ts:333-349`). Two fetches — one for each direction — reconstruct the
thread with no new endpoint, no new table, and no client-side message store (R6).

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/web/src/modules/projects/ConversationView.tsx` (new) | thread + composer host |
| `apps/web/src/modules/projects/conversation.ts` (new) | entry model, envelope encoder, ordering |
| `apps/web/src/modules/projects/drafts.ts` (new) | path-keyed draft load/save with a safe fallback |
| `apps/web/src/modules/projects/tabs.ts` | register the `conversation` tab |
| `docs/04_DESIGN.md` + owning satellite | record the request-envelope payload format (T3) |

**Frozen names.**

```ts
// conversation.ts
export type ConversationRef =
    | { kind: 'task'; wbs: string }
    | { kind: 'feature'; id: string };

export type ConversationEntryKind = 'request' | 'response';

export interface ConversationEntry {
    id: string;                 // inbox message id
    kind: ConversationEntryKind;
    fromId: string | null;
    toId: string;
    text: string;               // human-readable body, envelope stripped
    refs: readonly ConversationRef[];
    createdAt: string;          // ISO-8601
    inReplyTo: string | null;
    deliveryStatus: string;     // the inbox row's own status, rendered verbatim
    requestKey?: string;        // populated by 0844; absent here
    receipt?: unknown;          // populated by 0844; opaque to this task
}

export const REQUEST_ENVELOPE_PREFIX = 'SPUR-REQUEST/1 ';
export function encodeRequestEnvelope(text: string, refs: readonly ConversationRef[]): string;
export function decodeRequestEnvelope(body: string): { text: string; refs: ConversationRef[] };
export function buildThread(toOrchestrator: InboxMessage[], toOperator: InboxMessage[]): ConversationEntry[];

// drafts.ts
export const DRAFT_STORAGE_KEY = 'spur.board.projects.draft.v1';
export interface DraftRecord { path: string; text: string; refs: ConversationRef[]; revision: number }
export function loadDraft(servedPath: string): DraftRecord;   // never throws
export function saveDraft(draft: DraftRecord): void;          // never throws

// the shared composer draft, provided by BoardLayout so sibling tabs and GlobalAgentBar reach it
export interface ConversationDraft {
    draft: DraftRecord;
    setText(text: string): void;
    addRef(ref: ConversationRef): void;     // deduplicates by kind + id
    removeRef(ref: ConversationRef): void;
}
export const ConversationDraftContext: React.Context<ConversationDraft>;
export function useConversationDraft(): ConversationDraft;

// the operator's own mailbox identity
export const OPERATOR_AGENT_ID = 'board-operator';
```

**Operator identity.** `POST /api/messages` routes through `TeamService.sendMessage`, which calls
`validateAgentId` on both endpoints; the engine's rule is `/^[a-z][a-z0-9_-]{1,63}$/`
(`@gobing-ai/ts-ai-runner` `agent-spec.js:10-15`). `board-operator` satisfies it with no engine change
and no spec file — it is a mailbox address, not a fleet member, and it must never appear in
`ResolvedFleet` or in the Agents roster.

**Reference capture (R3).** Refs are captured as structured values at the moment the operator picks
them (a chip in the composer, or "use this task" from Work in task 0843) and travel in a deterministic
envelope, never inferred from prose:

```text
SPUR-REQUEST/1 {"refs":[{"kind":"task","wbs":"0844"}]}
<blank line>
<the operator's text, verbatim>
```

`encodeRequestEnvelope` emits the prefix line only when `refs` is non-empty, so a plain request stays a
plain message in `spur message` output and in the Inbox module. `decodeRequestEnvelope` splits on the
first blank line, parses the JSON, and on any parse failure returns the whole body as `text` with
`refs: []` — a malformed envelope degrades to prose rather than dropping the message.

**WHY an envelope rather than a column or a new body field.** `inbox_messages` belongs to
`@gobing-ai/ts-db`; a `refs` column would be an engine release for a presentation concern. A
sibling JSON body field would strand the refs the moment a message is read by any other consumer
(`spur message read`, the Inbox module, the orchestrator's own prompt), because only the body reaches
the agent. The envelope travels wherever the body travels.

**Thread assembly (`buildThread`).**

1. Fetch `GET /api/messages/inbox?agent=<orchestratorInstanceId>` → candidate **requests**; keep rows
   whose `fromId === OPERATOR_AGENT_ID`.
2. Fetch `GET /api/messages/inbox?agent=OPERATOR_AGENT_ID` → candidate **responses**; keep all rows.
3. Decode each body through `decodeRequestEnvelope`; map to `ConversationEntry`.
4. Sort ascending by `createdAt`, tie-broken by message `id`, so refresh order is stable.
5. `inReplyTo` links a response to its request; an unlinked response renders at its timestamp rather
   than being hidden.

When `orchestrator.instanceId` is absent (`OrchestratorState` is `missing` or `unresolvable`, task
0836), step 1 is skipped, the thread renders whatever step 2 returns, and the composer shows the named
`orchestrator-missing` state instead of a generic disabled control.

**Draft model (R2, R5).** One record, not a map. The Board origin serves exactly one project (task
0840 Background), so a per-project map would model a case that cannot occur on this origin. The stored
`path` is a **guard**, not an index: `loadDraft(servedPath)` returns the stored record only when
`record.path === servedPath`, and otherwise returns an empty draft and overwrites the stale record.
That is the port-reuse guard task 0840 delegates here — `ProjectRegistry` can hand a previously used
port to a different project, and browser storage is keyed by origin, so path equality is the only thing
that distinguishes them.

`loadDraft` and `saveDraft` wrap every storage access in `try/catch` and treat *any* failure — access
denied, absent key, invalid JSON, a record missing `path` or with a non-string `text` — as "no draft"
(R5). No error state, no toast, no notice; the view renders with an empty composer. Validation is
shape-checked, not `JSON.parse`-only, because a well-formed JSON document of the wrong shape is the
case the prototype's ST-1 scenario exercises.

`revision` increments on every keystroke-batch save and is what lets 0844 clear only the submitted
revision. This task stores and restores it; it does not interpret it.

**Rehydration (R4).** On mount the view fetches both inboxes; the thread is derived from that response
only. Client storage holds the **draft** and nothing else — no cached entries, no optimistic rows that
survive a refresh. A request that was accepted but whose row is not yet visible therefore reappears
from the server or not at all, which is what makes "the thread survives a refresh" a server-backed
claim rather than a local-storage claim.

**Anti-patterns — do not implement.**

- Do not add a client-side message store, cache, or optimistic thread persisted across refreshes.
- Do not use `drainPending` or any consuming read to build the thread; `getInbox` is the non-consuming
  one (`team-service.ts:333`), and draining would steal the orchestrator's own queue.
- Do not parse task or feature references out of the operator's prose with a regex, at submission or
  at render.
- Do not add a column to `inbox_messages` or a new endpoint for the thread.
- Do not key the draft on project name, on the origin, or on a generated client id.
- Do not provide `ConversationDraftContext` from `ConversationView` or from `ProjectsShell`; both are
  below `GlobalAgentBar`.
- Do not surface a storage error to the operator; a corrupt draft is an empty draft.
- Do not register `board-operator` as a fleet member, a spec file, or a roster entry.
- Do not implement submission, receipt rendering, or retry here — that is 0844, and duplicating it
  would create two submit paths.

**Draft provider placement — `BoardLayout`, beside `ProjectProvider`.** Two consumers sit outside
`ConversationView`: the Work tab (task 0843) is a **sibling panel**, so a draft owned by the
Conversation panel would be unmounted exactly when Work needs to add a reference to it; and
`GlobalAgentBar` is mounted outside the module entirely (`apps/web/src/components/BoardLayout.tsx:161`)
and must compose from every Board route (task 0844 R7). `ConversationDraftContext` is therefore
provided in `BoardLayout` alongside `ProjectProvider`. The provider holds the record; the views render
it.

**Handoff.** 0843 calls `useConversationDraft().addRef(ref)` to push a `ConversationRef` into the
composer.
0844 owns `handleSubmit`, mints the idempotency key (task 0832), and fills `ConversationEntry.requestKey`
and `receipt` by matching each entry against its `RequestReceipt` on `ConversationEntry.id ===
RequestReceipt.messageId` — `TeamService.getInbox` is **not** widened — and renders the non-nominal
state labels. 0844 also adds one additive optional field to `DraftRecord`, `pending?: { requestKey,
revision }`, which this task's `loadDraft` / `saveDraft` carry through unchanged. 0845 asserts the composer's keyboard and IME contract against this view.

### Plan

1. **(R3)** Add `conversation.ts` with `ConversationRef`, `ConversationEntry`,
   `REQUEST_ENVELOPE_PREFIX`, and `encodeRequestEnvelope` / `decodeRequestEnvelope`.
   *Test:* round-trip with refs; no prefix emitted when `refs` is empty; a truncated or non-JSON
   prefix line decodes to the full body as `text` with `refs: []`.
2. **(R6, R1)** Add `buildThread`: two `getInbox` reads, operator filter, decode, ascending sort by
   `createdAt` then `id`. *Test:* interleaved requests and responses order deterministically; a
   response whose `inReplyTo` names a missing request still renders.
3. **(R2, R5)** Add `drafts.ts` with `DRAFT_STORAGE_KEY`, `loadDraft`, `saveDraft`.
   *Test:* a stored record whose `path` differs from the served path yields an empty draft and is
   overwritten; a throwing storage accessor, absent key, invalid JSON, and a shape-valid-but-wrong
   record each yield an empty draft with no thrown error and no notice.
4. **(R1, R4)** Build `ConversationView.tsx`: fetch both inboxes through `resolveApiUrl` /
   `fetchWithTimeout`, render entries with kind, timestamp, refs, and the row's `deliveryStatus`
   verbatim; restore the draft on mount. *Test:* remount rebuilds the thread from the fetch response
   alone, with nothing read from client storage but the draft.
5. **(R1)** Render the `orchestrator-missing` / `unresolvable` case: skip the orchestrator-side fetch,
   render the operator-side thread, and name the missing binding in the composer area.
   *Test:* a `ProjectContext` with `orchestrator.state: 'missing'` issues exactly one inbox fetch and
   renders the named state.
6. **(R3)** Expose the ref-capture entry point the Work view calls in 0843, and render captured refs
   as removable chips above the composer. *Test:* adding, deduplicating, and removing a ref updates
   the draft record and its `revision`.
7. **(R6)** Register the tab in `tabs.ts`. *Test:* `/board/projects` renders Conversation as the
   default panel.
8. **(T3)** Document the `SPUR-REQUEST/1` envelope format in `docs/04_DESIGN.md` and its owning
   satellite in the same commit.
9. Run `cd apps/web && bun test`, then `bun run spur-check`.

### Solution

Implemented the Conversation tab (thread + per-project composer draft + explicit
reference capture) over the existing inbox transports — no new endpoint, no
client-side message store (R6); submission itself is task 0844's.

Change map (file:line):

- `apps/web/src/modules/projects/conversation.ts` (new) — the conversation model:
  `OPERATOR_AGENT_ID` operator mailbox (`board-operator`, an address never in a
  fleet roster), `ConversationRef`/`ConversationEntry`, `encodeRequestEnvelope`/
  `decodeRequestEnvelope` (SPUR-REQUEST/1 prefix line + blank line + verbatim
  text; any parse failure degrades to prose, R3), `parseInboxMessages`
  (runtime-narrow, malformed rows skipped), `buildThread` (operator-sent requests
  + operator-inbox responses, ascending `createdAt` tie-broken by id).
- `apps/web/src/modules/projects/drafts.tsx` (new) — single-slot draft record
  `spur.board.projects.draft.v1` with `loadDraft` path guard (matching path
  returned; garbage overwritten; shape-valid foreign record yields empty —
  spec §Draft model, closes the port-reuse leak), `saveDraft` (storage failures
  swallowed, R5), `ConversationDraftContext` + `ConversationDraftProvider`
  (functional updates, reload per served path, `setText`/`addRef` (dedupe by
  `sameRef`)/`removeRef` each bumping `revision`).
- `apps/web/src/modules/projects/ConversationView.tsx` (new) — rehydrates the
  thread from two non-consuming `GET /api/messages/inbox` reads
  (`:16` inboxUrl; `:40-58` parallel fetch → `buildThread`, AbortController,
  orchestrator side skipped when unbound), envelope-decoded entries with verbatim
  `deliveryStatus` (`data-conversation-delivery`), named fetch-failed and
  orchestrator-missing states, composer bound to `useConversationDraft` with
  removable ref chips (`data-draft-ref`).
- `apps/web/src/modules/projects/tabs.tsx:38` — `conversation` tab registered
  (frozen order, default tab `:13`).
- `apps/web/src/components/BoardLayout.tsx:5,128` — `ConversationDraftProvider`
  mounted beside `ProjectProvider` (only permitted edit there) so Work (0843)
  and GlobalAgentBar (0844) can consume the draft.
- Tests — `apps/web/tests/modules/projects/conversation.test.ts` (13: envelope
  encode/decode incl. degradation paths, `sameRef`, `parseInboxMessages`),
  `drafts.test.ts` (8: path guard, overwrite, garbage/throwing/absent storage),
  `ConversationView.test.tsx` (7: remount rehydration from fetch alone,
  envelope rendering, one-fetch unbound state, corrupt storage ST-1, typed-draft
  persistence, project-switch restore/no-leak, ref chips dedupe/revision).
- `docs/design/project-switcher.md` §7 "Request envelope (0841)" +
  `docs/04_DESIGN.md` index entry — SPUR-REQUEST/1 payload format recorded (T3).

Resume pass (0841 continuation): attempt 1 act-wrapped the project-switch
rerenders in ConversationView.test.tsx — still red, and by trace necessarily so:
the spec-mandated overwrite in `loadDraft` replaces A's stored record during the
B phase, so a typed "switch back restores the same text" assertion cannot pass
under the recorded design (drafts.test.ts explicitly pins the overwrite).
Attempt 2 restructured that single test to the hook contract per the authorized
fallback: seed via `saveDraft` under path A → arrive at A (restore asserted) →
switch to B (empty input, no leak) → storage now serves B with no cross-project
residue. Housekeeping: removed unused `beforeEach`/`fireEvent` imports, typed
the two fetch stubs `as typeof fetch` per sibling convention
(ProjectSwitcher.test.tsx), adopted GlobalAgentBar's react-props accessor
(fixes `noUncheckedIndexedAccess` TS2532); `bunx tsc --noEmit` now clean.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/web/src/modules/projects/conversation.ts:144 buildThread (operator-sent requests fromId==='board-operator' conversation.ts:18 + all operator-inbox responses, ascending createdAt tie-broken by id) fed by ConversationView.tsx:48-59 two non-consuming GET /api/messages/inbox reads; entry rows rendered ConversationView.tsx:128-146 with verbatim deliveryStatus :142-144; hold reasons/result links ride reserved requestKey/receipt (conversation.ts:37-38) per task-doc Q&A closed deferral to 0844. Fresh tests: conversation.test.ts:113 'keeps only operator-sent rows as requests…', :134 'sorts ascending by createdAt with id tie-break…', :144 'decodes envelopes and renders deliveryStatus verbatim; unlinked response is kept', ConversationView.test.tsx:75 'remount rebuilds the thread from the fetch response alone'. |
| R2 | MET | apps/web/src/modules/projects/drafts.tsx:59-73 loadDraft path guard (:64 rec.path!==servedPath → empty draft + overwrite, closes port-reuse leak), provider reloads per served path :115-119; addRef dedupe :135. Fresh tests: drafts.test.ts:36 'stored record with matching path is returned as-is', :42 'stored record whose path differs yields an empty draft and is OVERWRITTEN (port reuse)', ConversationView.test.tsx:204 'a project switch restores the stored draft; the draft never leaks across projects (R2)'. |
| R3 | MET | apps/web/src/modules/projects/conversation.ts:56-58 encodeRequestEnvelope (SPUR-REQUEST/1 prefix line + blank line + verbatim text, emitted only when refs non-empty), :81-96 decodeRequestEnvelope total on every parse failure → whole body as prose with refs:[]; refs captured structurally via addRef/removeRef chips (drafts.tsx:132-139, ConversationView.tsx:106,178), never regexed from prose. Fresh tests: conversation.test.ts:28,32,42,49,53,60,67,72 (no-refs plain text, deterministic prefix round-trip, truncated/non-JSON/wrong-shape degradation, junk-item drop), :79 sameRef, ConversationView.test.tsx:237 'addRef dedupes, chips render removable, removeRef updates draft + revision (R3)'. |
| R4 | MET | apps/web/src/modules/projects/ConversationView.tsx:21-22 inboxUrl (GET /api/messages/inbox) + :44-59 thread rebuilt from the two fetch responses on every mount; nothing thread-shaped is ever written to client storage (drafts.tsx persists only the DraftRecord). Fresh test: ConversationView.test.tsx:75 'remount rebuilds the thread from the fetch response alone; storage keeps only the draft' (different server response followed on remount, DRAFT_STORAGE_KEY stays null). |
| R5 | MET | apps/web/src/modules/projects/drafts.tsx:43-49 parseDraftRecord shape gate, :59-73 loadDraft and :75-79 saveDraft wrapped in try/catch — absent key, invalid JSON, throwing accessor, no localStorage, 9 wrong-shape records all yield an empty draft with no throw and no notice. Fresh tests: drafts.test.ts:31,55,73,85,104; ConversationView.test.tsx:180 'corrupt storage degrades to an empty draft — view renders, no error state (ST-1)'. |
| R6 | MET | Sole transport is the existing GET /api/messages/inbox (ConversationView.tsx:21-22 resolveApiUrl+inboxUrl); grep of apps/web/src/modules/projects shows no drainPending, no POST, no new endpoint, no client-side message store — entries are per-fetch state; tab registered existing tabs.tsx:38 (default :13) with BoardLayout.tsx:128 draft provider only. apps/server working tree: 3 unrelated dirty files (context.ts, health), server suite fresh 406 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Drafts stay with their project | MET | test | ConversationView.test.tsx:204 'a project switch restores the stored draft; the draft never leaks across projects (R2)' — saveDraft under path A restored on arrival, B renders empty, storage residue serves only B; backed by drafts.test.ts:42 path-guard overwrite. |
| The thread survives a refresh | MET | test | ConversationView.test.tsx:75 'remount rebuilds the thread from the fetch response alone; storage keeps only the draft' — remount with a different server response renders only fresh rows, no client-storage thread. |
| References are explicit | MET | test | conversation.test.ts:32,42 'refs travel as a deterministic prefix line + blank line + verbatim text' + round-trip; degradation paths :49,53,60,67; structured capture ConversationView.test.tsx:237 chips/dedupe/revision. |
| Corrupt storage degrades safely | MET | test | drafts.test.ts:55 'shape-valid-but-wrong records each yield an empty draft', :73 'invalid JSON and a throwing accessor each yield an empty draft, never a throw', :85 'no localStorage at all'; ConversationView.test.tsx:180 ST-1 renders empty draft, no error state. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

Fresh verification (2026-09-12): verdict PASS (6 R, 4 AC) — `.spur/run/0841-verify-answer.txt`; review PASS (0 blocker / 1 minor P3 carried to 0844 / 2 advisory). Gate rc=0 (8211 pass / 0 fail, `.spur/run/0841-test-gate.status`); projects module 50/0; web tsc clean. Proof digest at bind: `sha256:608713f31df8345922399995b31218f8e3c782390ea52448729e7ecfb7453f8c`.


### Review

Phase 7 multi-dimensional review (batch 20260912T205800Z-G63BATCH, fresh-context, observe-only).
Scope: working-tree diff — apps/web/src/modules/projects/{conversation.ts,drafts.tsx,ConversationView.tsx,tabs.tsx}, BoardLayout wiring, projects tests, docs satellites. Dimensions: functional, security, efficiency, correctness, usability, architecture.

**Verdict: PASS** (0 blocker, 0 major, 1 minor dispositioned below, 2 advisory)

Fresh gate evidence (re-run this review, not inherited): decisive suites `bun test` conversation/drafts/ConversationView/tabs → 31 pass / 0 fail (84 expects); projects module subset → 50 pass / 0 fail (7 files); full apps/web suite → 829 pass / 0 fail (59 files, matches 0841-test-gate rc=0); `bunx tsc --noEmit` rc=0.

Findings:

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|---------|-------------|
| P3 (minor) | architecture | apps/web/src/modules/projects/drafts.tsx:49 | `parseDraftRecord` whitelists exactly `{path,text,refs,revision}`, so a stored record carrying 0844's declared additive `pending?` field is silently stripped on load — the next `saveDraft` persists it without `pending`. Contradicts the frozen handoff "which this task's loadDraft / saveDraft carry through unchanged" (0841 spec §Handoff). No current R breaks; cost lands on 0844's refresh-time idempotency recovery. One-line fix when 0844 lands: spread unknown fields through (`{...r, path: r.path, ...}`) while keeping the shape gate. | Accept now, fix in 0844 (owner of the seam); recorded so 0844 refinement cannot assume carry-through works |
| P4 (advisory) | correctness | apps/web/tests/modules/projects/ConversationView.test.tsx | R2 restructured hook-contract test assessed and accepted: in production each project's Board is its own origin (own port), so A's draft physically cannot be touched by B's session; the literal A→B→A typed-text round trip is unsatisfiable only in the single-origin harness under the recorded overwrite-on-mismatch design (pinned by drafts.test.ts). The restructured test asserts the exact mechanism production relies on — path-match restore at A (ConversationView.test.tsx 'restores the stored draft', phase 1), zero leak at B (empty input; residue is B's own record). Operator-visible intent "draft follows project, never leaks across" is covered; restructure sound. | Accepted — no action |
| P4 (advisory) | usability | apps/web/tests/modules/projects/ConversationView.test.tsx | React `act(...)` console warnings from `ConversationDraftProvider` updates resolving alongside async fetches in the draft tests; suites pass, output noise only. Wrap the settle points when the file is next touched. | Accepted — cosmetic |

Functional traceability (all evidence file:line verified fresh):

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | conversation.ts:144 `buildThread` (operator-sent requests + all operator-inbox responses, ascending createdAt tie-broken by id); ConversationView.tsx:48-59 two non-consuming inbox reads → :134 `[data-conversation-entry]` rows with verbatim `deliveryStatus` (:142). Hold reasons/result links ride reserved `requestKey`/`receipt` (conversation.ts:33-35) per the spec's recorded 0844 deferral (Q&A: "Hold reasons … DEFERRED to 0844 by design"). |
| R2 | MET | drafts.tsx:59-73 `loadDraft` path guard (`:64 rec.path !== servedPath` → empty + overwrite — port-reuse closure); provider reload per served path; drafts.test.ts 8-test guard suite; ConversationView.test.tsx switch test (restore at A, empty at B, residue is B's). |
| R3 | MET | conversation.ts:56 encodeRequestEnvelope (prefix line + blank line + verbatim text only when refs exist), :81 decode total on every failure → whole body as prose; refs captured structurally via addRef/removeRef chips (ConversationView.tsx:106,178), never parsed from prose; conversation.test.ts envelope suite incl. degradation paths. |
| R4 | MET | ConversationView.tsx:48-59 thread rebuilt per mount from `GET /api/messages/inbox` only; nothing thread-shaped written to storage — remount test asserts a changed server response is followed and `DRAFT_STORAGE_KEY` stays null. |
| R5 | MET | drafts.tsx shape gate (parseDraftRecord) + try/catch on load (:59) and save (:75); drafts.test.ts invalid-JSON / throwing accessor / absent key / 9 wrong-shape records each → empty draft, no throw; ConversationView ST-1 test renders empty draft, no `[data-conversation-fetch-failed]`. |
| R6 | MET | Sole transport `GET /api/messages/inbox` (ConversationView.tsx:21); grep confirms no `drainPending`, no POST, no client-side message store in the module; entries are per-fetch state. |

AC scenarios: drafts stay with their project → switch test (MET, hook-contract form); thread survives refresh → remount test (MET); references are explicit → envelope suite + chip test (MET); corrupt storage degrades safely → ST-1 test + drafts.test.ts (MET).

0840 frozen contracts verified: tab ids `conversation|agents|work` (tabs.tsx:5, frozen order :36-40); canonical path as identity key (draft guard on `project.path`); ProjectProvider functional updates (useProjectContext.tsx:99,109); orchestrator wire projection consumed as `{state,instanceId}` only, never echoed; FleetService untouched. 0844 boundary respected: encodeRequestEnvelope is the spec-assigned payload encoding; no submission, no retry, no receipt rendering, `board-operator` appears only as the mailbox constant, never in any roster.

T3 docs: docs/design/project-switcher.md §7 "Request envelope (0841)" (:160-176) + docs/04_DESIGN.md:387 index entry — format matches implementation.

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Reference implementation: `docs/prototypes/g6-projects/index.html`; [projects prototype report](../reports/g6-projects-prototype.md) R2-1…R2-7, ST-1
- Retained transport: `/api/messages*` (owner: G1)
- Code: `apps/web/src/modules/inbox/AllTab.tsx`, `AgentTab.tsx`, `SupervisorTab.tsx`

### History

- 2026-09-12T22:28:49.951Z todo → wip (system)
- 2026-09-12T22:28:50.453Z wip → testing (system)
- 2026-09-12T22:29:57.672Z testing → done (system)

