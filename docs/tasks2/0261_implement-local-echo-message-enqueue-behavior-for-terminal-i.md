---
template: feature-impl
schema_version: 1
name: "Implement local echo + message-enqueue behavior for Terminal input (loop agents)"
description: ""
status: done
type: task
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-15T05:35:23.418Z"
updated_at: "2026-07-15T21:36:49.244Z"
---

## 0261. Implement local echo + message-enqueue behavior for Terminal input (loop agents)

### Background

Root cause discovered during M1 brainstorming:

The current MemberTerminal input does:
fetch(..., {method:'POST', body: {line}} ) → /api/team/processes/:id/stdin
→ supervisor.writeStdin → handle.writeStdin(`${line}\n`)

However, the default persistent team member is the wrapper `spur agent loop --agent <id>` (see supervisor-service.ts defaultWrapperArgv and agent.ts:runAgentLoop).

That loop only does:

- drainPending from the DB inbox
- if messages, prepend and call agentService.run
- else sleep(poll)

It never reads its own process.stdin. Therefore typed input "disappears" — no echo, no effect, nothing appears in Messages tab (which is the separate inter-agent bus).

Per M1 decisions: always do local echo; for default loop members, also enqueue the line as a message to the member (so it becomes visible work and will be drained on the next iteration). Preserve the raw writeStdin call for custom-command members.

### Requirements

R1. On successful (or even attempted) input submit in MemberTerminal, append a local echo line to the visible frames buffer, e.g. `> ${line}` (style it distinctly, perhaps as meta).

R2. After (or in parallel with) the existing writeStdin call, for members that are using the default loop wrapper, also POST to the messages endpoint:
{ fromId: 'terminal' | null, toId: agentId, body: line }

R3. The echo must appear immediately in the `<pre>` (client-side) so the operator gets instant feedback regardless of server processing.

R4. Keep the existing isRunning guard and error handling. Retain the line on failure.

R5. No change required to the agent loop itself for this increment (deeper stdin control is out of scope per M1).

R6. Update any tests that assert on terminal input behavior.

### Acceptance Criteria

```gherkin
@core
Scenario: R3 Terminal input produces visible local echo
  Given a member (loop or custom) is attached and running in Terminal
  When the operator types text and presses Enter
  Then the exact line appears in the output buffer prefixed with '>'

@core
Scenario: R3 + R2 line is also delivered as a message for loop agents
  Given a default `spur agent loop` member is attached
  When input is submitted
  Then a corresponding message appears in the member's inbox (visible in Messages tab)
  And on next drain the content will be injected into the agent's prompt
```

### Q&A

**Q: Should we always send the message, or try to detect "loop agent" on the client?**

A: Always send for now (v1). The message enqueue is harmless even for custom-command members. Detecting the wrapper type would require extra data in the teams roster response or agent specs. We can make it conditional later if needed. Per M1: focus on the common loop case.

**Q: Where exactly to put the echo — before the fetch, on success, or always?**

A: Immediately on submit (optimistic, client-side). This matches "the echo must appear immediately". If the POSTs fail we still show what the user typed (they can see the error banner).

**Q: Use the same Frame type for echo, or a different mechanism?**

A: Reuse the existing Frame type with `stream: 'meta'`. The renderer already treats meta specially (muted italic). This keeps the output buffer uniform and reuses scrolling/auto-scroll logic.

**Q: Should the echoed line also appear in the Messages tab immediately, or only after server confirmation?**

A: The message POST is fire-and-forget from the terminal perspective. The Messages tab already has live tail via SSE on `message.sent`. The echo in Terminal is local feedback; the Messages tab will update when the event arrives (or on its poll).

**Q: Any change needed on the server side (supervisor or messages)?**

A: No. The messages endpoint and inbox/drain path already exist and are used by the CLI and other board tabs. This is pure client enhancement.

### Design

**Client-side local echo + dual delivery for loop agents**

The root problem is architectural: the `spur agent loop` wrapper (the default for team members) never consumes its own `stdin`. Input sent via `writeStdin` is delivered to a process that ignores it.

Solution (per M1 decisions):

- Always render a local echo immediately on submit (client-side, in the frames buffer as a 'meta' frame). This gives instant feedback.
- For members using the default loop (which is the common case), additionally enqueue the line as an inter-agent message via `POST /api/messages`. This makes the input visible in the Messages tab and ensures it will be drained into the agent's next prompt.
- Preserve the existing `POST /api/team/processes/:id/stdin` call (harmless for loops, useful for any custom `command:` members that actually read stdin).

Implementation location: `MemberTerminal.tsx` (inside `sendInput`).

Changes:

- On submit (before or immediately after the fetch), construct a local meta frame:
  ```ts
  const echo: Frame = {
    stream: "meta",
    ts: new Date().toISOString(),
    line: `> ${line}`,
  };
  setFrames((prev) => [...prev, echo]); // or use appendFrame logic
  ```
- Style meta frames differently (already done in the pre renderer: italic muted).
- After the stdin call succeeds (or in parallel), also do:
  ```ts
  await fetch(sendUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromId: "terminal", toId: agentId, body: line }),
  });
  ```
  (Reuse the `sendUrl` constant and pattern from `MessagesTab.tsx`.)
- Keep the existing error handling, input clearing on success, retain-on-failure behavior.
- No backend changes required for this increment.
- Detection of "loop agent": for v1 we always perform the message enqueue (it is safe and useful). If a future need arises to be selective, the spec could come from the team roster response or agent spec.

Trade-offs:

- Duplicate fetch for message (small).
- Echo is "optimistic" — appears even if message POST fails (acceptable; user sees what they typed).
- Messages tab will show "terminal" as fromId for these inputs.

Impacted surfaces:

- `MemberTerminal.tsx` (main change)
- Potentially share `sendUrl` constant or move to lib/rpc-client.
- Tests that exercise terminal input (will need update to assert on echo + message side-effect).

Invariants:

- Echo always happens for any attached running member.
- Existing stdin path is untouched.
- No change to the agent loop wrapper itself (out of scope).

### Plan

1. In `MemberTerminal.tsx`, modify `sendInput`:
   - Immediately append a local 'meta' echo frame (`> ${line}`) to the frames state on submit (client-side, before awaiting network).
   - After the existing stdin POST, also perform the messages POST (reuse send pattern from MessagesTab).
   - Keep all guards (isRunning), error handling, and input retention/clearing behavior.
2. Extract or import `sendUrl` (and optionally a `sendMessage` helper) to avoid duplication with MessagesTab.
3. Update the render logic if needed to ensure meta echoes are visible (already styled as italic muted).
4. Add/update unit tests in the teams components test file to verify:
   - Local echo appears in output on submit.
   - Message POST is attempted for loop-style agents.
5. Verify against M1 R3 AC.
6. Run `bun run check` (web) and `spur task check 0261`.
7. Coordinate with 0259 (Terminal toolbar) and 0260 (Roster removal) for end-to-end flow.

### Solution
| File | Lines | What / Why |
|------|-------|------------|
| `apps/web/src/modules/teams/MemberTerminal.tsx:128` | 128–129 | Add `messagesUrl()` helper — `POST /api/messages` endpoint for loop-agent message enqueue. |
| `apps/web/src/modules/teams/MemberTerminal.tsx:239` | 239–290 | Rewrite `sendInput`: append local echo meta frame `> ${line}` immediately on submit (R1/R3), then POST to stdin + fire-and-forget POST to messages endpoint with `{ from: 'terminal', to: agentId, body: line }` (R2). Keep existing guards, error handling, and retain-on-failure (R4). |
| `apps/web/tests/modules/teams/MemberTerminal.test.tsx:458` | 458–480 | Update AC2 test: expect 2 POSTs (stdin + messages), assert message body shape `{ from, to, body }`. Add echo assertion verifying meta frame `> ls -la` in terminal output. |
### Testing
**Verify run:** 2026-07-15 — `/sp:dev-verify 0261 --auto --focus all --fix all --force` (standalone; status was `done`, forced re-audit)

**Commands**
- `bun test apps/web/tests/modules/teams/MemberTerminal.test.tsx` → 26 pass, 0 fail, exit 0
- `spur task check 0261 --json` → pass: true

**Coverage:** N/A for React `.tsx` per monorepo gate (happy-dom / per-file gate excluded). Targeted suite green; no new runtime package path outside web MemberTerminal.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 local echo `> ${line}` as meta frame | MET | `MemberTerminal.tsx:249-259` appends `stream:'meta'` frame; test asserts `data-stream=meta` text `> ls -la` at `MemberTerminal.test.tsx:477-480` |
| R2 message enqueue for loop members | MET | `MemberTerminal.tsx:270-281` POST `messagesUrl()` body `{ from:'terminal', to:agentId, body:line }` matching server `POST /api/messages` (`messages/index.ts:48-62`); test `MemberTerminal.test.tsx:462-469` |
| R3 echo immediate client-side | MET | Echo applied via `setFrames` before awaits (`MemberTerminal.tsx:249-259`); same test echo assertion |
| R4 isRunning guard + retain on failure | MET | `onKeyDown` only when `isRunning` (`:297-301`); input `disabled={!isRunning}`; failure test retains text (`MemberTerminal.test.tsx:487-541`) |
| R5 no agent-loop change | MET | Diff scope is web client only (`MemberTerminal.tsx` + test); no `agent.ts` / loop edits |
| R6 update terminal input tests | MET | `MemberTerminal.test.tsx:452-480` expects 2 POSTs (stdin + messages) + echo |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R3 Terminal input produces visible local echo | MET | test | `MemberTerminal.test.tsx:477-480` — meta frame `> ls -la` in output |
| Scenario: R3 + R2 line delivered as message for loop agents | MET | test | `MemberTerminal.test.tsx:452-469` — POST `/messages` with `{ from, to, body }`; server path already exists (`messages/index.ts:50-62`) |

**Design conformance:** 5/5 DONE (local meta echo; dual delivery stdin+messages; preserve writeStdin; always-enqueue v1; no backend change). R2 prose used `fromId`/`toId`; implementation + Solution correctly use server wire `{ from, to, body }` (CHANGED vs Requirements wording, aligned with `POST /api/messages`).

**SECUA (all):** no blockers/majors. Minor advisory only: optional extract of shared send helper with MessagesTab deferred; message POST is fire-and-forget after stdin returns (including non-OK) which matches Q&A "always send for now".
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-15T21:28:28.918Z todo → wip (system)
- 2026-07-15T21:28:30.288Z wip → testing (system)
- 2026-07-15T21:28:35.303Z testing → done (system)
