---
schema_version: 1
name: Projects Inbox tab redesign and stale inbox cleanup
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.648Z
updated_at: "2026-10-20T07:07:19.862Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - web
  - docs

dependencies: ["1267"]
---

## 1269. Projects Inbox tab redesign and stale inbox cleanup

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.4; ADR-143; DESIGN.md governs the UI.

Sizing: about 6h; one Board module plus the docs it invalidates.

Implements: R14 — The Inbox tab shows one fleet member's two-direction thread; R15 — The Inbox tab replies and marks read inline; R16 — The Board global input sends as operator to the orchestrator; R17 — Terminal input is not duplicated into the inbox; R18 — Stale inbox code and docs are gone.

Depends on: Inbox oRPC contract and server handler.

### Requirements

- [ ] R1. Rebuild the Projects → Inbox tab as member list → two-direction thread → composer, with reply and mark-read, on the typed oRPC client plus SSE `message.*` refresh.
- [ ] R2. GlobalAgentBar sends from `operator` to the orchestrator with no body envelope (refs move to a contract field).
- [ ] R3. MemberTerminal stops posting to the inbox.
- [ ] R4. Delete `buildRecentMessagesThread`, the `SPUR-REQUEST/1` envelope, `board-operator`, the dead `conversation`/`processes` tab ids, the `useProjectTab` alias, the `router.tsx` inbox redirect, the `.inbox` CSS scope and `useProjectRequests` polling.
- [ ] R5. Docs: retire `docs/design/inbox-board-module.md` and its `04_DESIGN.md` row; fix the `03_ARCHITECTURE.md` inbox read path; mark ADR-143 Accepted.

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

### Design

Approach: replace ConversationView with an InboxView of three panes (member list, thread, composer) in `apps/web/src/modules/projects/`, reusing existing DESIGN.md tokens and components.
Rejected: keeping the global feed with filters (H5: no per-member view).
Invariants: one operator identity; the terminal is stdin-only; reads never write.

### Plan

1. Browser E2E: select a fleet member, see the thread, send, see the reply arrive, mark read; type into the terminal and assert no inbox row.
2. InboxView and the contract client.
3. GlobalAgentBar and MemberTerminal fixes.
4. Delete residue; docs.
5. `bun run spur-check`, then `bun run spur-check-feature`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
