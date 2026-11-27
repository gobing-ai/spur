---
schema_version: 1
name: Render the stitched remote dialog under outbound arrows in the A2A sequence view
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:47.277Z
updated_at: "2026-11-27T07:54:34.381Z"
feature_id: A822

dependencies: ["1468"]
estimate_hours: 4
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

### Requirements

- [ ] R1. An outbound receipt with a `remoteContextId` gets a "Remote dialog" disclosure in its tooltip. Opening it calls `integrations.remoteDialog` once (lazy, like the card fetch at `:47`) and lists the remote messages oldest first: sender, time, status mark and body excerpt.
- [ ] R2. `outside-gateway` renders the marker "Remote peer outside this gateway — dialog not available" with no request retry. `unavailable` renders the same marker family with the reason and an inline Retry.
- [ ] R3. `SequenceClient` widens to include `integrations.remoteDialog`; existing tests' fakes are updated, not bypassed.
- [ ] R4. Keyboard and screen-reader access matches the existing tooltip (DESIGN.md); there is no new chart dependency.
- [ ] R5. `docs/design/integrations-module.md` §3.1 describes the remote dialog disclosure and its three states.

Out of scope: stitching remote messages into the main sequence grid as lifelines.

### Acceptance Criteria

- [ ] R1 — An outbound call to a same-gateway project shows the remote dialog
- [ ] R2 — A peer outside the gateway is marked, not guessed
- [ ] R3 — A failed remote read degrades to the marker

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:11.989Z

- **Q: Merge remote messages into the main grid?** A: No. A disclosure under the receipt keeps the local sequence truthful and the layout stable.
- **Q: Fetch on render?** A: No. The fetch happens on disclosure open only, so the Board stays cheap.

### Design

- **Chosen:** a lazy `RemoteDialog` sub-component inside the outbound receipt tooltip that switches on the 1468 union.
- **Rejected:** fetching remote dialogs in `useA2aTimeline`, which would run N network reads per render.
- **Frozen names:** marker copy "Remote peer outside this gateway — dialog not available"; test ids `a2a-remote-dialog`, `a2a-remote-marker`.
- **Invariants:** a remote failure never breaks the local sequence.
- **Anti-patterns:** silent empty state on failure.
- **Handoff:** none.

### Plan

1. Failure modes first (web tests with a fake client):
   - `remote` lists messages in order;
   - `outside-gateway` shows the marker with no retry;
   - `unavailable` shows the reason, and Retry calls again;
   - no fetch happens until the disclosure opens.
2. Implement `RemoteDialog` and widen `SequenceClient`.
3. Update integrations-module §3.1.
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

