---
schema_version: 1
name: Restore live message updates in the board conversation view
status: done
template: issue
created_at: 2026-10-11T00:19:45.975Z
updated_at: "2026-10-11T00:22:08.190Z"
feature_id: G1

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1168-verdict.json
---

## 1168. Restore live message updates in the board conversation view

### Background

G1 scenario "The board inbox view updates live" was delivered by 0206 (Observability Inbox tab live-tailing `message.*` over `/api/events/planning`). Task 0849 (G64) retired the Inbox module and redirected `/board/inbox` to `/board/projects/conversation`, but `ConversationView` only rehydrates on mount — the live tail was dropped and is not among G64's operator-accepted reductions (0852 process watch list, 0853 supervisor facets). Found by the 2026-10-10 G1 shippable re-audit.

### Requirements

- [x] R1. `ConversationView` refetches the thread when a `message.*` frame arrives on `/api/events/planning`, without remount; non-message frames do not refetch; the EventSource closes on unmount.
- [x] R2. `ConversationView` also refetches on a poll interval (default 5s, injectable for tests), because a CLI `spur message send` fires `message.sent` on its own process bus and never reaches the server SSE stream.
- [x] R3. Component tests cover the SSE path and the poll path; the existing projects suite stays green.

### Acceptance Criteria

```gherkin
Feature: Inbox IPC

  Scenario: The board inbox view updates live
    Given the Observability Inbox tab is open
    When a message is sent
    Then the tab shows the new message without a page refresh
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- One `liveTick` refetch key in `ConversationView`, bumped by (a) `message.*` SSE frames and (b) a `setInterval(pollMs)`; the existing fetch effect depends on it. Payloads are metadata-only, so refetch rather than splice.
- Poll mirrors `useProjectRequests` (`pollMs` injectable). Rejected: server-side `system_events` tailing in the SSE stream — cross-cutting change to every SSE consumer; out of scope for a regression fix.

### Plan

- [x] Reproduce: write the SSE live-tail component test; confirm it fails (no EventSource opened).
- [x] Add the SSE subscription + `liveTick` refetch key; test passes.
- [x] E2E against `spur serve`: confirm the CLI send does not stream; write the poll-tail test; confirm it fails.
- [x] Add the injectable poll interval; projects suite, biome, tsc green.
- [x] Rebuild the board bundle; run `.spur/run/verifyall/g1-e2e.sh`.

### Root Cause

`apps/web/src/modules/projects/ConversationView.tsx:70` — before this fix the only data-loading effect (now keyed `[project.path, instanceId, liveTick]`) depended on `[project.path, instanceId]`, so the thread is fetched once per mount. Commit `2ba02214f` (0849) deleted the Inbox shell that owned the `message.*` EventSource subscription without carrying it into the Projects successor. Separately, `/api/events/planning` (`apps/server/src/modules/events/index.ts:157`) streams only the server process's in-memory bus: an e2e run showed a `POST /api/messages` send emits `message.sent` on the stream while a CLI `spur message send` persists to `system_events` but never streams.

### Solution

- `apps/web/src/modules/projects/ConversationView.tsx:20-22` — `sseUrl` + `CONVERSATION_POLL_MS = 5_000`.
- `apps/web/src/modules/projects/ConversationView.tsx:30` — optional `pollMs` prop (default 5s).
- `apps/web/src/modules/projects/ConversationView.tsx:47-68` — live-tail effect: interval + EventSource bump `liveTick` on `message.*`; both torn down on unmount.
- `apps/web/src/modules/projects/ConversationView.tsx:70-71` — fetch effect keyed on `liveTick` (`void liveTick` marks the trigger for the exhaustive-deps lint without a suppression).
- `apps/web/tests/modules/projects/ConversationView.test.tsx` — SSE live-tail and poll-tail regression tests.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/projects/ConversationView.tsx:55` opens the EventSource on `/events/planning`; `:59` bumps `liveTick` only for `message.*` names; `:66` closes it on unmount; `:130` keys the fetch effect on `liveTick`. Test `apps/web/tests/modules/projects/ConversationView.test.tsx:235` (non-message frame → no refetch; `message.sent` → new entry; unmount → closed) |
| R2 | MET | `apps/web/src/modules/projects/ConversationView.tsx:22` `CONVERSATION_POLL_MS = 5_000`; `:30` injectable `pollMs`; `:53` interval bumps `liveTick`. Test `apps/web/tests/modules/projects/ConversationView.test.tsx:274` (pollMs 20, row persisted out-of-band appears without remount). E2E: CLI-sent message id present in `GET /api/messages` board feed (`g1-e2e.log`) |
| R3 | MET | `cd apps/web && bun test tests/modules/projects tests/modules/registry.test.ts` — 202 pass / 0 fail; both new tests failed before the fix (EventSource never opened; no poll); biome + `tsc --noEmit` clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: The board inbox view updates live | MET | test | `apps/web/tests/modules/projects/ConversationView.test.tsx:235` (SSE `message.sent` → entry rendered without remount) and `apps/web/tests/modules/projects/ConversationView.test.tsx:274` (cross-process send → entry on next poll); e2e `g1-e2e.sh`: API send fires `message.sent` on `/api/events/planning`, CLI and API sends both land in the board feed, built bundle carries the SSE + poll tail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-11T00:21:01.979Z todo → wip (system)
- 2026-10-11T00:21:57.000Z wip → testing (system)
- 2026-10-11T00:22:07.869Z testing → done (system)

