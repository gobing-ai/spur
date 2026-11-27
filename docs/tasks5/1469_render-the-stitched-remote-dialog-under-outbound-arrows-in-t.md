---
schema_version: 1
name: Render the stitched remote dialog under outbound arrows in the A2A sequence view
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:47.277Z
updated_at: "2026-11-27T16:56:14.095Z"
feature_id: A822

dependencies: ["1468"]
estimate_hours: 4
priority: P2
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

- [ ] R1. An outbound receipt with a `remoteContextId` gets a "Remote dialog" disclosure in its `ArrowDetail` tooltip (`A2aSequence.tsx:500`). Opening it calls `remoteDialog` once (lazy and cached, like the receipt at `:63`) and lists the remote messages oldest first: sender, time, status mark and body excerpt.
- [ ] R2. `outside-gateway` renders the marker "Remote peer outside this gateway — dialog not available" with no request retry. `unavailable` renders the same marker family with the reason and an inline Retry.
- [ ] R3. `SequenceClient` becomes an explicit interface `{ timeline, requests, remoteDialog }`, and `SEQUENCE_CLIENT` is the explicit object `{ timeline: api.inbox.timeline, requests: api.inbox.requests, remoteDialog: api.integrations.remoteDialog }` (no spread of the oRPC proxy). The test fake `makeClient` (`a2a-sequence.test.tsx:144`) is updated, not bypassed.
- [ ] R4. Keyboard and screen-reader access matches the existing tooltip (DESIGN.md); there is no new chart dependency.
- [ ] R5. `docs/design/integrations-module.md` §3.1 (`:221`) describes the remote dialog disclosure and its three states.

Out of scope: stitching remote messages into the main sequence grid as lifelines.

### Acceptance Criteria

- [ ] AC1 — An outbound call to a same-gateway project shows the remote dialog (req: R1; R3; R4) — web unit: `apps/web/tests/modules/integrations/a2a-sequence.test.tsx` proves no `remoteDialog` call before the disclosure opens, exactly one call on open, messages listed oldest first under `a2a-remote-dialog`, and keyboard reachability. Real proof: browser screenshot on the 1468 two-project gateway.
- [ ] AC2 — A peer outside the gateway is marked, not guessed (req: R2) — web unit: same file proves `outside-gateway` renders `a2a-remote-marker` with the frozen copy and no Retry.
- [ ] AC3 — A failed remote read degrades to the marker (req: R2; R5) — web unit: same file proves `unavailable` renders the reason and Retry issues a second call, while the local sequence still renders.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `apps/web/src/modules/integrations/A2aSequence.tsx:39,47,400,431`
- `docs/design/integrations-module.md` §3.1; root `DESIGN.md`
- Task 1468; feature A822

### History

- 2026-11-27T07:54:34.381Z backlog → todo (system)

