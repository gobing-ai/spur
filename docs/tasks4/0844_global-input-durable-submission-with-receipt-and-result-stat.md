---
schema_version: 1
name: Global input durable submission with receipt and result states
status: done
template: feature-impl
created_at: 2026-09-12T04:54:51.545Z
updated_at: "2026-09-13T02:17:06.397Z"
feature_id: G63
priority: P1
tags:
  - g6-program

dependencies: ["0841", "0832", "0833", "0834", "0838"]
---

## 0844. Global input durable submission with receipt and result states

### Background

`GlobalAgentBar` is the requirement's most visible gap: `handleSubmit` clears the prompt and shows
"Agent dispatch is not wired yet — this bar is UI only (F84 R6)"
(`apps/web/src/components/GlobalAgentBar.tsx:36-39`). It is mounted globally by `BoardLayout` across
every module route, so wiring it is a Board-wide behavior change, not a Projects-only one.

Two failure shapes drive the requirements. Clearing on submit destroys work if acknowledgement fails,
and clearing the whole field destroys a newer edit typed while the request was in flight — the
prototype fixes this by clearing only the submitted revision (R2-1…R2-7,
`docs/reports/g6-projects-prototype.md`).

"Accepted" must also stay honest: a persisted-but-unconsumed request is `queued-awaiting-orchestrator`,
not "working", and a zero process exit without workflow verification is `completed-exit-only`.
The durable receipt this consumes is delivered by G61.

### Requirements

- **R1** — Submission persists the request against the submitting project and returns a receipt before
  the UI acknowledges anything.
- **R2** — The composer clears only the submitted revision; a newer edit typed during flight survives.
- **R3** — A failed acknowledgement keeps the draft; resubmitting the same payload reuses the same
  request identity, and an edited payload mints a new one (G61's idempotency key).
- **R4** — A request submitted in one project lands only in that project, even if the operator
  switches projects mid-flight; a late result lands in its originating project.
- **R5** — Every non-nominal state is distinctly labeled with its next action:
  `queued-awaiting-orchestrator`, orchestrator-missing, orchestrator-offline, `rest-held`,
  `executor-unavailable`, `blocked`, `failed-delivery`, `outcome-unknown`, `completed-exit-only`.
- **R6** — `outcome-unknown` guidance is reconcile, never an unconditional retry button.
- **R7** — The same submission path and conversation are available on every Board route, not only
  inside Projects.

### Acceptance Criteria

```gherkin
Feature: Global input durable submission with receipt and result states

  @core
  Scenario: A submission becomes a durable request before acknowledgement
    Given the operator types into the global input on any Board route
    When the request is submitted
    Then the server persists it against the submitting project and returns a receipt
    And the composer clears only the submitted revision, preserving any newer edit

  @core
  Scenario: A failed submission never loses the draft
    Given acknowledgement fails
    When the operator resubmits the same payload
    Then the same request identity is reused with no duplicate request
    And an edited payload creates a new request

  @core
  Scenario: Project identity survives navigation
    Given a request submitted in one project
    When the operator switches projects before the result arrives
    Then the result appears in the originating project only
    And the other project's conversation and drafts are untouched

  @core
  Scenario: Every non-nominal state is named and actionable
    Given any of orchestrator-missing, orchestrator-offline, rest-held, executor-unavailable, failed-delivery, or outcome-unknown
    When the operator reads the receipt
    Then each state is distinctly labeled with its next action
    And a persisted-but-unconsumed request says so rather than showing progress

  @core
  Scenario: A run exit is never shown as a verified result
    Given a run that exited zero without workflow verification
    When its result renders
    Then it is labeled unverified and does not present the task as complete
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T06:00:19.461Z

**Where does the receipt data come from — widen the inbox read, or a new route? — CLOSED: a new
read-only route, `GET /api/project/requests`.** The three facts a receipt needs live in three places
(the inbox row, 0833's `coordination_runs`, 0838's holds). Widening `TeamService.getInbox` would put
all three joins on a read that `spur message inbox` and the Inbox module also call, for facts neither
consumes, and would change the shape of an existing CLI `--json` surface. The dedicated route keeps
the join in one place and changes no existing consumer. Detail: Design § WHY a separate receipt read.

**Does the Board call `DeliveryReconciler.reconcile()`? — CLOSED: no; this task adds `classify()`.**
0834's `reconcile()` performs one write (the terminal `attempts-exhausted` marking, step 4). A browser
poll must not trigger it. Steps 1, 2, 3 and 5 are already pure, so `classify()` is that pass extracted
and `reconcile()` becomes `classify()` plus the marking — additive to 0834's surface, with its
signature, return type and behaviour unchanged. Owned by this task, not a change to 0834's contract.

**Where does the retry identity live so it survives a refresh? — CLOSED: on the draft record, as
`pending: { requestKey, revision }`.** It is stored before the POST, so a crash mid-flight still leaves
the retry able to reuse the identity, and it is reused only while `pending.revision === draft.revision`.
0841's mutators already bump `revision` on every edit, so "an edited payload mints a new key" needs no
change to the draft provider and no mutator hook. The alternative — a second storage key for the
pending submission — would give one composer two stores that can disagree.

**Does `ConversationEntry.requestKey` still come from `TeamService.getInbox`? — CLOSED: no; it comes
from the matched `RequestReceipt`.** 0841's handoff anticipated widening `getInbox`'s mapping to carry
`request_key`. The receipt route already returns `requestKey` and the entry matches it on
`ConversationEntry.id === RequestReceipt.messageId`, so the shared read stays untouched. 0841's
handoff paragraph was corrected in this refinement to match.

**What is the real source of `blocked`? — CLOSED: 0838's `DispatchHold`.** The prototype's own status
table records that the runtime had no first-class blocked signal
(`docs/prototypes/g6-projects/index.html:301`, "treat as occupancy ambiguity"). G62's 0838 supplies
one: a `DispatchHold` on the request's `taskId` whose reason is `unauthorized`, `not-ready`,
`unmet-dependency`, or `no-idle-instance`. `rest-after-drain` and `executor-unavailable` are the same
hold list's other two reasons and get their own named states. No occupancy heuristic is used.

**Is `completed-verified` reachable? — CLOSED: reachable in the vocabulary, never produced by this
program.** 0833 forbids the exit sink from writing `'verified'`; only the workflow verification path
may, and wiring that writer is out of scope in G61. The state stays so the renderer is total and so the
distinction from `completed-exit-only` is explicit in the code rather than implied.

**Does `capabilityState: 'unknown'` mean the executor is unavailable? — CLOSED: no.**
`EXECUTION_CAPABILITY_STATES` (`packages/config/src/index.ts:233`) is explicit that missing data
resolves to `unknown` and never to a permissive default; it is equally not a damning one. An unknown
capability therefore leaves the request in `queued-awaiting-orchestrator` rather than claiming a
failure that was never observed.

**Is `projectPath` required on `POST /api/messages`? — CLOSED: optional, validated when present.**
The CLI (`spur message send`) and the Inbox module post without it and must keep working; a required
field would break both for a guard that only the Board needs. Present-and-mismatched is a 409 with no
row written.

**Deferred — streamed telemetry in the execution drawer.** `agent-bar-drawer` keeps its
"not wired yet" notice. Streaming a run's tool calls into the bar needs the process-stream transport
the Agents view uses (0842) and a per-request run binding; it is not in G63's scope. Owner: Robin, at
the G6 program's next slice.

### Design

**WHAT.** Replace `GlobalAgentBar.handleSubmit`'s stub with a real submission through the existing
`POST /api/messages`, add one project guard on that route, add one read-only receipt projection
(`GET /api/project/requests`), and render the closed receipt-state vocabulary from a pure client-side
classifier. The thread, the draft, and the envelope are task 0841's and are reused, not re-implemented.

**WHY the existing message route rather than a new submit endpoint.** A Board request *is* an
`inbox_messages` row addressed to the orchestrator instance — the same row `spur message send` writes
and the same row the orchestrator drains. `POST /api/messages` already routes through
`TeamService.sendMessage` (`apps/server/src/modules/messages/index.ts:50-67`), and task 0832 already
adds `requestKey` to that body and `replayed` to its receipt. Re-implementing submission would create
a second write path into one table for one caller.

**WHY a separate receipt read.** The receipt facts live in three places — the inbox row's own
`status` / `inject_attempts` / `inject_error`, 0833's `coordination_runs` (`outcome`, `task_id`,
`message_ids_json`), and 0838's `StrategyRuntime.selectNext().holds`. Widening
`TeamService.getInbox` would push all three joins onto a read that `spur message inbox` and the Inbox
module also call, for facts neither wants. One dedicated read keeps the join in one place and changes
no existing consumer.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/web/src/components/GlobalAgentBar.tsx:36-39` | real `handleSubmit`; receipt strip; state badge |
| `apps/web/src/modules/projects/receipt.ts` (new) | `RequestReceiptState`, `classifyReceipt`, labels |
| `apps/web/src/modules/projects/useProjectRequests.ts` (new) | polls `/api/project/requests` |
| `apps/web/src/modules/projects/drafts.ts` (0841) | `DraftRecord.pending?` — additive optional field |
| `apps/server/src/modules/messages/index.ts:50-67` | accept + validate `projectPath` |
| `apps/server/src/modules/health/index.ts` (new route) | `GET /api/project/requests` |
| `packages/app/src/services/delivery-reconciler.ts` (0834) | additive `classify()` — the pure pass |
| `apps/web/tests/components/GlobalAgentBar.test.tsx:67` | the stub-notice test is replaced |
| `docs/04_DESIGN.md` + owning satellite | record the route addition and the body field (T3) |

**Frozen names — transport.**

```ts
// GET /api/project/requests?limit=<int, default 50, max 200>  →  { requests: RequestReceipt[] }
interface RequestReceipt {
    messageId: string;                 // matches ConversationEntry.id (0841)
    requestKey: string | null;         // inbox_messages.request_key (0832)
    deliveryStatus: string;            // the inbox row's status, verbatim
    injectAttempts: number;
    injectError: string | null;
    runId: string | null;              // coordination_runs.run_id (0833)
    taskId: string | null;             // coordination_runs.task_id (0833)
    outcome: 'run-exit-only' | 'errored' | 'verified' | null;
    reason: HoldReason | null;         // 0834's classification, null when resolved
    hold: DispatchHoldReason | null;   // 0838's hold for `taskId`, null when none
}

// POST /api/messages body gains one optional field:
//   projectPath?: string   — rejected with 409 when it does not equal normalizeProjectPath(ctx.cwd)
```

The route is scoped to the orchestrator's mailbox: it reads the rows addressed to
`snapshot.orchestrator.instanceId` whose `from_id` is `OPERATOR_AGENT_ID`, which is the same selection
0841's `buildThread` step 1 makes. When `orchestrator.instanceId` is absent it returns
`{ requests: [] }` — not an error; the missing orchestrator is already named by the header (0840) and
by the composer's own state.

**Frozen names — client.**

```ts
// receipt.ts
export type RequestReceiptState =
    | 'pending'                        // POST in flight; no durable acceptance yet
    | 'queued-awaiting-orchestrator'
    | 'orchestrator-missing'
    | 'orchestrator-offline'
    | 'executor-unavailable'
    | 'rest-held'
    | 'blocked'
    | 'accepted-working'
    | 'failed-delivery'
    | 'outcome-unknown'
    | 'completed-exit-only'
    | 'completed-verified';

export interface ReceiptLabel {
    icon: string;        // paired with text; never color alone (R5, G63 R7)
    label: string;
    meaning: string;     // what was observed
    action: string;      // the one action actually available in this state
    tone: 'ok' | 'warn' | 'err';
}
export const RECEIPT_LABELS: Readonly<Record<RequestReceiptState, ReceiptLabel>>;

export function classifyReceipt(
    receipt: RequestReceipt | null,
    fleet: ProjectFleetSnapshot | null,
    inFlight: boolean,
): RequestReceiptState;

// drafts.ts (0841) — additive optional field, no change to loadDraft/saveDraft behaviour
export interface DraftPending { requestKey: string; revision: number }
// DraftRecord gains `pending?: DraftPending`
```

**Classification precedence (R5, R6), first match wins.**

1. `inFlight && receipt === null` → `pending`.
2. `deliveryStatus === 'failed'` → `failed-delivery`.
3. `reason === 'outcome-unknown'` → `outcome-unknown`.
4. `reason === 'attempts-exhausted'` → `failed-delivery`.
5. `outcome === 'verified'` → `completed-verified`.
6. `outcome === 'run-exit-only'` → `completed-exit-only`.
7. `outcome === 'errored'` → `failed-delivery`.
8. `hold === 'rest-after-drain'` → `rest-held`.
9. `hold === 'executor-unavailable'` → `executor-unavailable`.
10. `hold !== null` (`unauthorized` / `not-ready` / `unmet-dependency` / `no-idle-instance`) → `blocked`.
11. `deliveryStatus === 'injected' || 'delivered'` → `accepted-working`.
12. `deliveryStatus === 'queued'` and `orchestrator.state === 'missing' | 'unresolvable'` →
    `orchestrator-missing`.
13. `deliveryStatus === 'queued'` and `orchestrator.state === 'bound-offline'` → `orchestrator-offline`.
14. `deliveryStatus === 'queued'` and the orchestrator's `ResolvedFleetMember` has
    `enabled === false` or `capabilityState === 'unavailable'` → `executor-unavailable`.
15. `deliveryStatus === 'queued'` and `strategy?.name === 'rest'` → `rest-held`.
16. otherwise → `queued-awaiting-orchestrator`.

Run state is read before project state deliberately: once a run exists, what the project's strategy
would do next says nothing about a request that has already been consumed. `capabilityState ===
'unknown'` does **not** select `executor-unavailable` — `EXECUTION_CAPABILITY_STATES`
(`packages/config/src/index.ts:233`) makes `unknown` explicitly non-permissive-and-non-damning, so an
unknown capability leaves the request in `queued-awaiting-orchestrator`, which is the honest reading.

`blocked` has a real source in this program. The prototype's own note says today's runtime has no
first-class blocked signal (`docs/prototypes/g6-projects/index.html:301`); G62's 0838 supplies one, and
step 10 is that signal and nothing else. No occupancy heuristic, no "probably waiting".

**`completed-verified` is reachable but never produced today.** 0833 forbids the exit sink from ever
writing `'verified'`; only the workflow verification path may. The state stays in the vocabulary so the
renderer is total, and `completed-exit-only` is the state a zero exit actually produces — labelled
"run exit 0 recorded (unverified)" (R6, G63 R6).

**Submission algorithm (R1, R2, R3).**

```ts
const submitted = { text: draft.text, refs: draft.refs, revision: draft.revision };
const requestKey =
    draft.pending?.revision === draft.revision ? draft.pending.requestKey : crypto.randomUUID();
saveDraft({ ...draft, pending: { requestKey, revision: submitted.revision } });   // before the POST

const res = await fetch('/api/messages', { method: 'POST', body: JSON.stringify({
    to: fleet.orchestrator.instanceId,
    from: OPERATOR_AGENT_ID,
    body: encodeRequestEnvelope(submitted.text, submitted.refs),
    requestKey,
    projectPath: path,
}) });

if (!res.ok) return;                                     // draft untouched, pending kept (R3)
if (currentDraft.revision === submitted.revision) {      // nothing newer was typed
    saveDraft({ path, text: '', refs: [], revision: submitted.revision + 1 });   // pending dropped
}                                                        // else: leave the newer draft alone (R2)
```

The key is persisted **before** the request, not after, so a crash between POST and response still
leaves the retry able to reuse the identity. Reuse is gated on `pending.revision === draft.revision`,
and 0841's mutators already bump `revision` on every edit — so an edited payload mints a new key with
no change to the draft provider (R3's second half). The key is never derived from the body; 0832
forbids content-hashed keys.

**Project identity (R4).** The Board origin serves one project (0840), so "switching projects" is
navigating to a different server and a different origin. The durable defence is nonetheless explicit:
`projectPath` travels in the body and the server compares it to `normalizeProjectPath(ctx.cwd)`
(`packages/app/src/services/project-registry.ts:11`) — the same normalizer 0840 uses for
`/api/project` — rejecting a mismatch with 409 and no row written. Combined with 0841's stored-`path`
draft guard, a reused port can neither submit into the wrong project nor resurrect the wrong draft.
A late result lands wherever its row was written, which is the project it was validated against.

**Availability on every route (R7).** `GlobalAgentBar` is mounted by `BoardLayout` at
`apps/web/src/components/BoardLayout.tsx:161`, outside `<Outlet/>`. `ProjectProvider` (0840) and
`ConversationDraftContext` (0841) are provided in `BoardLayout` around both, so the bar composes,
submits, and shows its last receipt from Features, Tasks, History, or anywhere else without the
Projects module being mounted. No second composer is created for the Conversation view — that view
renders the same `useConversationDraft()` record.

**Surface preserved.** Every existing test id stays: `agent-bar-dock`, `agent-bar`,
`agent-bar-context`, `agent-bar-input`, `agent-bar-drawer-toggle`, `agent-bar-drawer`,
`agent-bar-chips`. New attributes: `data-receipt-state="<RequestReceiptState>"` on the receipt strip
and `data-g6="composer"` on the composer row, matching the prototype's selector so 0845's ported
scenarios assert the same hooks. The `agent · stub` badge text and the
`agent-bar-drawer` telemetry notice are the two honest stubs that remain — streamed telemetry is not
in this feature's scope and keeps saying so.

**Anti-patterns — do not implement.**

- Do not clear the whole composer on submit. Only the submitted revision clears, and only after a
  durable receipt (R2).
- Do not mint a new request key for an unchanged payload, and do not derive the key from the body.
- Do not render an unconditional Retry on `outcome-unknown`; that state's action is reconcile
  (R6, 0834's own anti-pattern).
- Do not render `completed-exit-only` as success or advance a task from it (R6).
- Do not render `queued-awaiting-orchestrator` with a progress indicator, a spinner, or the word
  "working".
- Do not distinguish states by colour alone; every badge is icon + text (G63 R7).
- Do not re-implement `buildThread`, `decodeRequestEnvelope`, `loadDraft`, or `saveDraft` — import
  them from 0841.
- Do not use `drainPending` anywhere in this task; the Board must never consume the orchestrator's
  queue.
- Do not add a second composer, a second draft store, or a second submit path.
- Do not call `DeliveryReconciler.reconcile()` from an HTTP GET — it writes the terminal
  `attempts-exhausted` marking. The GET uses `classify()`.
- Do not widen `TeamService.getInbox`; the receipt read is its own route.
- Do not make `projectPath` required on `POST /api/messages`; the CLI and the Inbox module send
  without it and must keep working.
- Do not remove the `agent-bar-drawer` telemetry stub or its notice; it is a different unwired
  surface.

**Handoff.** 0845 asserts this vocabulary, the `data-receipt-state` attribute, the preserved
`agent-bar-*` ids, and the Enter / Shift+Enter / IME contract against the composer built here.
G64 retires the Inbox module that also reads `/api/messages`; nothing in this task depends on it.

### Plan

1. Add the pure pass to `packages/app/src/services/delivery-reconciler.ts`:
   `classify(agentId?): Promise<UnresolvedDelivery[]>` running 0834's steps 1, 2, 3 and 5 only;
   `reconcile()` becomes `classify()` plus the existing step-4 marking, with its behaviour and return
   type unchanged. (R5)
2. Add `projectPath?: string` to `POST /api/messages`
   (`apps/server/src/modules/messages/index.ts:50-67`): when present and not equal to
   `normalizeProjectPath(ctx.cwd)`, return 409 with the served path in the error and write no row. (R4)
3. Add `GET /api/project/requests` to `apps/server/src/modules/health/index.ts`: resolve the
   orchestrator instance id, read its inbox rows from `OPERATOR_AGENT_ID`, join 0833's
   `CoordinationRunDao.listByMessageId`, `DeliveryReconciler.classify`, and
   `StrategyRuntime.selectNext(path).holds` by `taskId`; return `RequestReceipt[]`. Empty list when no
   orchestrator is bound. (R5)
4. Add `apps/web/src/modules/projects/receipt.ts`: `RequestReceiptState`, `RECEIPT_LABELS` (icon +
   label + meaning + action + tone, ported from `docs/prototypes/g6-projects/index.html:287-307`), and
   `classifyReceipt` implementing the 16-step precedence. (R5, R6)
5. Add `apps/web/src/modules/projects/useProjectRequests.ts` polling `/api/project/requests` and
   exposing a `Map<messageId, RequestReceipt>`; reuse the existing poll cadence constant style
   (`STATUS_POLL_MS`, `apps/web/src/modules/teams/MemberTerminal.tsx:16`). (R5)
6. Add `pending?: DraftPending` to `DraftRecord` in `apps/web/src/modules/projects/drafts.ts`; no
   change to `loadDraft`/`saveDraft` behaviour beyond carrying the field through. (R3)
7. Replace `handleSubmit` in `apps/web/src/components/GlobalAgentBar.tsx:36-39` with the submission
   algorithm; read `path` and `fleet` from `useProjectContext()` and the draft from
   `useConversationDraft()`; disable Send when the orchestrator is unbound and name the state instead
   of showing a generic disabled control. (R1, R2, R3, R7)
8. Render the receipt strip in the bar: the last submitted request's `data-receipt-state`, icon,
   label, meaning and the single available action from `RECEIPT_LABELS`. `outcome-unknown` renders a
   reconcile link, never a retry button. (R5, R6)
9. Wire the same receipt strip into 0841's `ConversationView` entries so each request row carries its
   own state; entries match receipts on `ConversationEntry.id === RequestReceipt.messageId`, and
   `requestKey` / `receipt` on the entry are filled from the matched row. (R5)
10. Update `apps/web/tests/components/GlobalAgentBar.test.tsx`: replace the stub-notice test at `:67`;
    keep every other existing assertion including the drawer stub at `:152`.
11. Tests, `apps/web/tests/modules/projects/submission.test.tsx` and `receipt.test.ts`:
    submit posts `to`/`from`/`requestKey`/`projectPath` and only the encoded envelope as `body`;
    a durable receipt clears only the submitted revision while a newer edit survives verbatim;
    a failed POST leaves text, refs and `pending` intact and a resubmit sends the same `requestKey`;
    an edit between attempts sends a different one; a 409 project mismatch writes no row;
    `classifyReceipt` returns each of the twelve states for its precedence row, including
    `capabilityState: 'unknown'` resolving to `queued-awaiting-orchestrator` and `run-exit-only`
    never resolving to a verified label. (R1-R6)
12. Record the new route and the `projectPath` body field in `docs/04_DESIGN.md` and its owning
    satellite (T3).

### Solution

Solution: BoardLayout now mounts ProjectProvider+GlobalAgentBar, so any harness mounting it must stub well-formed project routes — full ProjectFleetSnapshot with `orchestrator` on /api/project/fleet, `{name,path}` on /api/project, `{requests:[]}` on /api/project/requests — because a bare `{}`/`[]` body parses as a truthy fleet snapshot without `orchestrator` and crashes GlobalAgentBar mid-render (pattern: apps/web/tests/components/BoardLayout.test.tsx:37, mirrored in ResponsiveAndTheme.test.tsx).

Carried-item dispositions (0844, declared): AgentsView silent `!ok` on the first tick — carried to
wrap (declared). MemberTerminal fire-and-forget POST — unchanged; superseded ack semantics ride the
`requestKey` idempotency (declared). StrategyRuntime heartbeat+resume — the requests route consumes
StrategyRuntime read-only (`getStrategy`/`selectNext`), zero heartbeat/resume callers added;
deferred to wrap (declared). message.send ledger — the `POST /api/messages` write path is unchanged
and idempotency rides the 0832 `requestKey`; ledger wiring deferred to wrap (declared). Results-feed
freshness: `useProjectRequests` polls `GET /api/project/requests` on a 15s `STATUS_POLL_MS` interval
(first read immediate, interval cleared with the AbortController on cleanup), so R5 result states
advance while the bar stays mounted.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/components/GlobalAgentBar.tsx:80-83` — requestKey minted/reused and `persistPending()` writes `draft.pending` BEFORE the POST; server persists the row and returns the receipt (`POST /api/messages` → TeamService.sendMessage). Tests: "R1+R2: submit persists the request before the ack and clears the submitted revision" (`GlobalAgentBar.test.tsx:135`). Fresh run: apps/web `bun test` 896 pass / 0 fail. |
| R2 | MET | `apps/web/src/modules/projects/drafts.tsx:189-196` — `clearSubmitted(submitted.revision)` is revision-gated (no-op if a newer edit bumped revision); called at `GlobalAgentBar.tsx:106` only after a durable ok. Test: "R2: an edit typed during flight survives the clear and mints a NEW key on resubmit" (`GlobalAgentBar.test.tsx:189`). |
| R3 | MET | `GlobalAgentBar.tsx:77-80` — key reuse gated on `pending.revision === draft.revision`; `:100` `!res.ok` returns leaving draft+pending intact (network-error catch too). Test: "R3: a failed ack keeps the draft and the retry reuses the SAME requestKey" (`GlobalAgentBar.test.tsx:170`). |
| R4 | MET | `apps/server/src/modules/messages/index.ts:73-81` — present-and-mismatched `projectPath` → 409 BEFORE any row write. Tests: "mismatched projectPath → 409 and NO row written" (`messages/index.test.ts:327`); "…scoped to the mailbox" (`health.test.ts:417`, feed reads only the orchestrator's operator rows, `health/index.ts:226`); CLI/Inbox parity without the field (`:347`). |
| R5 | MET | `apps/web/src/modules/projects/receipt.ts:51-61` — closed 12-state vocabulary; `RECEIPT_LABELS` icon+label+meaning+action+tone per state; `classifyReceipt` 16-row precedence (`receipt.ts:185-219`) pinned by 21 `receipt.test.ts` tests; feed advances on the 15s `STATUS_POLL_MS` poll (`useProjectRequests.ts:22-27,71-76`; F1 test `useProjectRequests.test.ts:107`); per-entry states: "request entries join the durable results feed: receipt state rendered per entry (0844 R5)" (`ConversationView.test.tsx:177`). |
| R6 | MET | `receipt.ts:142-147` — `outcome-unknown` action is inspect/reconcile, never a retry button; `:149-155` `completed-exit-only` = "run exit 0 recorded (unverified)", tone warn, reconcile-then-mark action; outcome precedence `receipt.ts:188-191`. Test: "completed-exit-only is labelled unverified (R6)" (`receipt.test.ts:211`). |
| R7 | MET | `apps/web/src/components/BoardLayout.tsx:127-167` — GlobalAgentBar mounted at `:164` inside ProjectProvider+ConversationDraftProvider, outside `<Outlet/>` (`:152`); works from any Board route. Tests: "BoardLayout renders the global agent bar dock" (`GlobalAgentBar.test.tsx:123`); "unbound orchestrator: Send is disabled and the state is named, never a bare disabled control" (`:211`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A submission becomes a durable request before acknowledgement | MET | test | `GlobalAgentBar.test.tsx:135` "R1+R2: submit persists the request before the ack and clears the submitted revision" — pending persisted before fetch, clear only after ok; fresh run apps/web bun test 896 pass / 0 fail (2026-09-13). |
| A failed submission never loses the draft | MET | test | `GlobalAgentBar.test.tsx:170` "R3: a failed ack keeps the draft and the retry reuses the SAME requestKey" + `:189` "R2: an edit typed during flight survives the clear and mints a NEW key on resubmit". |
| Project identity survives navigation | MET | test | `messages/index.test.ts:327` "mismatched projectPath → 409 and NO row written"; `health.test.ts:417` mailbox-scoped feed (foreign-orchestrator rows dropped); drafts stored-path guard. |
| Every non-nominal state is named and actionable | MET | test | `receipt.test.ts` — 21 tests pin all 12 states × icon+label+meaning+action+tone incl. capabilityState 'unknown' → queued-awaiting-orchestrator (never executor-unavailable); `ConversationView.test.tsx:177` per-entry receipt states; `GlobalAgentBar.test.tsx:211` unbound orchestrator named state. |
| A run exit is never shown as a verified result | MET | test | `receipt.test.ts:80` "outcome run-exit-only → completed-exit-only (a run exit is NEVER shown as verified)" + `:211` "completed-exit-only is labelled unverified (R6)"; precedence `receipt.ts:190-191`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Complete interaction loop"
- Reference implementation: [projects prototype report](../reports/g6-projects-prototype.md) R2-1…R2-7 capture/draft/idempotency/late-result/rehydrate
- Code: `apps/web/src/components/GlobalAgentBar.tsx:36-39` (stub submit), mounted by `BoardLayout`
- Backend dependencies: tasks 0832 (idempotency key) and 0833 (completion receipt)

### History

- 2026-09-13T00:48:30.292Z todo → wip (system)
- 2026-09-13T01:50:15.079Z wip → testing (system)
- 2026-09-13T02:17:06.397Z testing → done (system)

