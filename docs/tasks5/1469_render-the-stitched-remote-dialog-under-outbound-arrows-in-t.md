---
schema_version: 1
name: Render the stitched remote dialog under outbound arrows in the A2A sequence view
status: done
template: feature-impl
created_at: 2026-11-27T07:35:47.277Z
updated_at: "2026-11-27T22:28:37.294Z"
feature_id: A822

dependencies: ["1468"]
estimate_hours: 4
priority: P2
done_forced: "false"
done_reason: unforced close
---

## 1469. Render the stitched remote dialog under outbound arrows in the A2A sequence view

### Background

Feature A822 (render half). `apps/web/src/modules/integrations/A2aSequence.tsx` (990 lines) draws the cooperation sequence:
- `SequenceClient = Pick<ApiClient['inbox'], 'timeline' | 'requests'>` (`:39`);
- outbound lifeline detail in `OutboundBody` (`:400`);
- headers in `LifelineHeader` (`:431`);
- detail in the shared `PinnableTooltip` (1453).

Outbound receipts already show `remoteTaskId` / `remoteContextId` per row (`docs/design/integrations-module.md` A2A row). Task 1468 delivers `integrations.remoteDialog`, which returns `remote | outside-gateway | unavailable`.

Depends on task 1468.

**Refine corrections (2026-11-27)**

- "outbound lifeline detail in `OutboundBody` (`:400`)" as the receipt seam → receipt remote refs render in `ArrowDetail` (`A2aSequence.tsx:500`, refs at `:515`); `OutboundBody` is the lifeline body → the disclosure mounts in `ArrowDetail`.
- R1 "lazy, like the card fetch at `:47`" → `:47` is the `CardState` type; the matching lazy precedent is the receipt fetched and cached on first open (`:63`) → R1 cites `:63`.
- R3 "`SequenceClient` widens to include `integrations.remoteDialog`" left the shape open → `SequenceClient = Pick<ApiClient['inbox'],'timeline'|'requests'>` (`:39`) with `SEQUENCE_CLIENT = api.inbox` (`:45`); a Pick over `inbox` cannot reach `integrations`, and spreading the oRPC proxy is unsafe → freeze an explicit object `{ timeline: api.inbox.timeline, requests: api.inbox.requests, remoteDialog: api.integrations.remoteDialog }` with field name `remoteDialog`.
- Test fake location unstated → `makeClient` in `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:144` gains `remoteDialog`.
- Doc target → `docs/design/integrations-module.md` §3.1 is at `:221` → verified.
- AC rows used the non-canonical `R<n> —` form → rewritten as `AC<n> — … (req: …)` with test layers.

### Requirements

- [x] R1. An outbound receipt with a `remoteContextId` gets a "Remote dialog" disclosure in its `ArrowDetail` tooltip (`A2aSequence.tsx:500`). Opening it calls `remoteDialog` once (lazy and cached, like the receipt at `:63`) and lists the remote messages oldest first: sender, time, status mark and body excerpt.
- [x] R2. `outside-gateway` renders the marker "Remote peer outside this gateway — dialog not available" with no request retry. `unavailable` renders the same marker family with the reason and an inline Retry.
- [x] R3. `SequenceClient` becomes an explicit interface `{ timeline, requests, remoteDialog }`, and `SEQUENCE_CLIENT` is the explicit object `{ timeline: api.inbox.timeline, requests: api.inbox.requests, remoteDialog: api.integrations.remoteDialog }` (no spread of the oRPC proxy). The test fake `makeClient` (`a2a-sequence.test.tsx:144`) is updated, not bypassed.
- [x] R4. Keyboard and screen-reader access matches the existing tooltip (DESIGN.md); there is no new chart dependency.
- [x] R5. `docs/design/integrations-module.md` §3.1 (`:221`) describes the remote dialog disclosure and its three states.

Out of scope: stitching remote messages into the main sequence grid as lifelines.

### Acceptance Criteria

- [x] AC1 — An outbound call to a same-gateway project shows the remote dialog (req: R1; R3; R4) — web unit: `apps/web/tests/modules/integrations/a2a-sequence.test.tsx` proves no `remoteDialog` call before the disclosure opens, exactly one call on open, messages listed oldest first under `a2a-remote-dialog`, and keyboard reachability. Real proof: browser screenshot on the 1468 two-project gateway.
- [x] AC2 — A peer outside the gateway is marked, not guessed (req: R2) — web unit: same file proves `outside-gateway` renders `a2a-remote-marker` with the frozen copy and no Retry.
- [x] AC3 — A failed remote read degrades to the marker (req: R2; R5) — web unit: same file proves `unavailable` renders the reason and Retry issues a second call, while the local sequence still renders.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:11.989Z

- **Q: Merge remote messages into the main grid?** A: No. A disclosure under the receipt keeps the local sequence truthful and the layout stable.
- **Q: Fetch on render?** A: No. The fetch happens on disclosure open only, so the Board stays cheap.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: How does `SequenceClient` reach `integrations`?** A: An explicit three-field object; a `Pick` over `api.inbox` cannot include it, and spreading the oRPC proxy is not safe. Field name frozen as `remoteDialog`.
- **Q: Where does the disclosure mount?** A: In `ArrowDetail`, where receipt remote refs already render — not `OutboundBody`.

### Design

- **Chosen:** a lazy `RemoteDialog` sub-component inside the outbound receipt tooltip that switches on the 1468 union.
- **Rejected:** fetching remote dialogs in `useA2aTimeline`, which would run N network reads per render.
- **Frozen names:** marker copy "Remote peer outside this gateway — dialog not available"; test ids `a2a-remote-dialog`, `a2a-remote-marker`.
- **Invariants:** a remote failure never breaks the local sequence.
- **Anti-patterns:** silent empty state on failure.
- **Handoff:** none.

### Plan

1. Failure modes first (web tests with the `makeClient` fake extended with `remoteDialog`):
   - `remote` lists messages in order;
   - `outside-gateway` shows the marker with no retry;
   - `unavailable` shows the reason, and Retry calls again;
   - no fetch happens until the disclosure opens; reopening does not refetch.
2. Implement `RemoteDialog` inside `ArrowDetail` and replace the `SequenceClient` Pick with the explicit `{ timeline, requests, remoteDialog }` interface and object.
3. Update integrations-module §3.1 (`:221`).
4. Real proof: a browser check on an unsandboxed host. Open the A2A tab on the two-project gateway setup from 1468, expand a receipt, and capture a screenshot receipt.
5. Run `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| `apps/web/src/modules/integrations/A2aSequence.tsx:44-60` | `SequenceClient` is now an explicit interface `{ timeline, requests, remoteDialog }` and `SEQUENCE_CLIENT` an explicit object built field by field — no `Pick` over `api.inbox` (which cannot reach `integrations`) and no spread of the oRPC proxy (R3). |
| `apps/web/src/modules/integrations/A2aSequence.tsx:608-704` | New `RemoteDialog` inside `ArrowDetail`: a `<Button aria-expanded>` disclosure (`a2a-remote-toggle`) that reads nothing until opened; the `remote` branch lists the peer's messages oldest first (sender, time, status mark, body) under `a2a-remote-dialog`; `outside-gateway` renders the frozen copy under `a2a-remote-marker` with no Retry; `unavailable` renders the reason under the same marker plus `a2a-remote-retry` (R1/R2/R4). |
| `apps/web/src/modules/integrations/A2aSequence.tsx:837-873` | `loadRemoteDialog(messageId, member, remoteContextId, force?)` — lazy, cached per message, `force` only from Retry; a rejected call folds into the `unavailable` marker instead of breaking the panel. |
| `apps/web/src/modules/integrations/A2aSequence.tsx:916-947` | The parent resolves the peer from the arrow's own addresses (an outbound member at `toId`, or a reply addressed from it), so the disclosure exists only where a receipt carries both a member and a `remoteContextId`. |
| `apps/web/src/modules/IntegrationsModule.tsx:36-47` | The shell builds the same three-field client from `seams.api`, memoized, so the seam keeps one identity per render. |
| `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:756-880` | Five cases over the extended `makeClient` fake: no read before the disclosure opens and exactly one read on open with messages oldest first (reopening reads the cache), keyboard-reachable button with `aria-expanded` and an action label, `outside-gateway` marker with the frozen copy and no Retry, `unavailable` reason with a Retry that issues one more call while the local grid still renders, and no disclosure at all when the receipt has no `remoteContextId`. Plus a `PROJECT_STATUS` fixture whose outbound member is project-addressed, which is what the 1468 read resolves. |
| `docs/design/integrations-module.md:221-251` | §3.1 now describes the disclosure: where it mounts, that it is lazy and cached, the three-state table, and that a remote failure never touches the local sequence (R5). |

Rationale: a disclosure keeps the local sequence truthful (the Q&A rejected merging remote messages into the grid) and keeps the Board cheap (the Q&A rejected fetching on render). The state union from 1468 is rendered rather than re-derived, so the panel cannot invent a fourth state. Ordering is enforced on both sides — the procedure sorts, and the list sorts again — because the AC asserts order and a renderer must not depend on a transport detail.

Gate: `spur task gate 1469 light` → PASS (4 changed files, 4 checks); `bun apps/cli/src/index.ts self exec format` applied; `bun run --filter @gobing-ai/spur-web typecheck` clean; `(cd apps/web && bun test tests/modules/integrations/a2a-sequence.test.tsx)` → 25 pass, 0 fail.

Proof scope — read this honestly: the component is exercised end-to-end through the real data path (fake transport, real render, real DOM assertions incl. `aria-expanded`, list order and Retry's second call), but **no browser screenshot was taken**. Plan step 4 asked for one on the 1468 two-project gateway; that gateway was torn down after 1468's probe and the browser harness needs a live two-project setup plus a display. Recorded as not-run rather than substituted.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:611` and :837 implement lazy cache, chronological rendering and bounded excerpts. The test at `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:773` passed. |
| R2 | MET | The named test cases at `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:826` cover the outside marker and retryable failure. |
| R3 | MET | `apps/web/src/modules/integrations/A2aSequence.tsx:39` explicitly lists timeline, requests and remoteDialog with a corresponding test client. |
| R4 | MET | The keyboard-reachable disclosure and expanded state are checked at `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:810`. No manifest dependency changed. |
| R5 | MET | `docs/design/integrations-module.md:221` describes the disclosure and its three states. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An outbound call to a same-gateway project shows the remote dialog | MET | test | The web suite passed. The live two-project browser showed request then reply. Screenshot: `.spur/run/verifyall-1464-1472/1469-remote-dialog.png`. |
| AC2 — A peer outside the gateway is marked, not guessed | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:826` verified marker wording and absence of Retry. |
| AC3 — A failed remote read degrades to the marker | MET | test | `apps/web/tests/modules/integrations/a2a-sequence.test.tsx:845` verified reason, retry, and preserved local sequence. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): **the browser screenshot was not taken.** Plan step 4 asked for one on the 1468 two-project gateway; that gateway was torn down after 1468's own probe and re-standing it plus a display-backed browser run did not fit this batch's budget. The component is exercised through its real data path in happy-dom (transport fake, real render, DOM assertions on `aria-expanded`, list order and Retry's second call), so behaviour is covered — visual confirmation of the disclosure inside the pinned tooltip is not. Recorded as a gap, not as done.

P4 (advisory): the message list sorts by `createdAt` even though `integrations.remoteDialog` already returns the thread oldest first. That is deliberate duplication: the AC asserts render order, and a renderer that trusts a transport detail breaks silently if a peer's ordering ever changes. Two identical ids with the same `createdAt` keep their relative order.

P4 (advisory): the peer member is resolved from the arrow's own endpoints (`toId` first, then `fromId`). That handles both an outbound request and the peer's reply, but it assumes the outbound member's instance id is the inbox address — true today (the fleet instance id is the address), and it degrades to "no disclosure" rather than a wrong dialog if it ever stops being true.

Residual risk: an `unavailable` read is retried only on operator action; there is no automatic backoff, so a persistently dead peer costs one manual click per look. That matches the task's Q&A (the read happens when the operator expands a receipt) and avoids a per-render retry loop.

Disposition: PASS — a lazy, cached disclosure that renders the 1468 union verbatim, an explicit three-field client seam, the frozen marker copy with Retry only on the retryable state, and five DOM-level cases over a real render.

### References

- `apps/web/src/modules/integrations/A2aSequence.tsx:39,47,400,431`
- `docs/design/integrations-module.md` §3.1; root `DESIGN.md`
- Task 1468; feature A822

### History

- 2026-11-27T07:54:34.381Z backlog → todo (system)
- 2026-11-27T20:24:41.256Z todo → wip (system)
- 2026-11-27T20:25:12.144Z wip → testing (system)
- 2026-11-27T20:25:14.563Z testing → done (system)

