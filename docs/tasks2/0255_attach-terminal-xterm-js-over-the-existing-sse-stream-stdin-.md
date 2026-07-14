---
template: feature-impl
schema_version: 1
name: "Attach terminal: xterm.js over the existing SSE stream + stdin POST endpoints"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:09.688Z"
updated_at: "2026-07-14T17:05:35.915Z"
---

## 0255. Attach terminal: xterm.js over the existing SSE stream + stdin POST endpoints

### Background
**Implementation ticket** (feature M) — refined for delegation.

**Decided:** a **minimal, no-dependency terminal** — a scrolling log view rendering ring-buffer frames
from the existing SSE stream, plus an input line POSTing to stdin. **No xterm.js** (attach is
line-framed per DD-3, not a raw TTY; a real PTY terminal is deferred fog). Reuses the observability
`EventSource` pattern (`InboxTab` listens to `/api/events/planning`).

**Backend already provides** (0256 keeps these stable): `GET /api/team/processes/:id/stream` (SSE of
ring-buffer frames `{stream:'stdout'|'stderr', ts, line, seq}`) and `POST /api/team/processes/:id/stdin`
(`{line}`). The **`seq` is the stable cursor** — array index is NOT (`supervisor-service.ts:14`: overflow
splices from the front). 0253 makes the member process persistent but it can **respawn on crash**, so
the terminal must reconnect the SSE across a respawn and resume from the last `seq`.
### Requirements
R1. A `MemberTerminal` React component subscribing to `GET /api/team/processes/:id/stream` via `EventSource`, rendering frames in a scrolling `<pre>` with stdout/stderr visually distinguished, tracking the last `seq`.
R2. An input line that POSTs `{line}` to `.../stdin` on Enter; cleared on success; a failed POST surfaces an error without losing the typed text; disabled unless the member is `running`.
R3. Attach/detach lifecycle: open `EventSource` on mount, close on unmount (no leaked connections); backfill recent ring-buffer frames on attach.
R4. Reconnect on stream drop or member respawn (0253): on `EventSource` error, retry with backoff and resume from the last seen `seq` — no duplicate lines, no gap beyond ring-buffer capacity.
R5. Render member states: `running` (input enabled), `stopped`/`exited`/`errored` (input disabled + banner).
R6. Seq-cursor correctness: never render a frame whose `seq` ≤ the last rendered; tolerate ring-buffer overflow (older frames gone) without crashing.
### Acceptance Criteria
Testable checklist:

- **AC1** Mounting `<MemberTerminal agentId="alpha-claude">` opens an `EventSource` to `/api/team/processes/alpha-claude/stream`; pushed frames render as lines, newest at the bottom, auto-scrolled. (test: mock EventSource, push frames, assert DOM order.)
- **AC2** Typing a line + Enter POSTs `{line}` to `.../stdin`; input clears on 200; on failure the text is retained and an error is shown. (test: mock fetch success + failure.)
- **AC3** When status ≠ `running`, the input is disabled and a state banner shows the status.
- **AC4** On `EventSource` error the component retries with backoff and resumes from the last `seq` — no duplicate and no gap within ring-buffer capacity. (test: emit error, reopen, push overlapping+new seqs, assert dedupe.)
- **AC5** Unmount calls `EventSource.close()` (assert via mock) — no leaked connections.
- **AC6** stderr frames are styled distinctly from stdout.
- **AC7** `bun run test` (happy-dom) green; component covered ≥ the repo's per-file gate (or `.tsx` excluded per `bunfig.toml`).
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Component:** `apps/web/src/modules/teams/MemberTerminal.tsx` (new `teams/` module dir; 0254 owns the
shell). Pure React 19 + the existing `resolveApiUrl`/`fetchWithTimeout` helpers + native `EventSource`
(same primitive `InboxTab` uses for `/api/events/planning`). **No new dependency.**

**Frame wire shape:** `{ stream:'stdout'|'stderr', ts:string, line:string, seq:number }`.
**State:** `frames: Frame[]` (bounded to N in the UI), `lastSeq: number`, `status`.

**Reconnect/resume:** `EventSource.onerror` → `close()` → `setTimeout(backoff)` → new `EventSource`.
Preferred resume: `…/stream?sinceSeq=<lastSeq>` (coordinate this query param with 0256; **if unsupported,
client-side de-dupe by dropping `seq ≤ lastSeq`**). Backfill on attach: the stream replays the ring
buffer, or an initial `GET /api/team/processes/:id` snapshot.

**stdin:** `fetchWithTimeout(POST /api/team/processes/:id/stdin, {line})`.

**Grounding:** `apps/web/src/modules/observability/InboxTab.tsx` (EventSource + fetch pattern),
`ProcessListTab.tsx` (process row fetch), `packages/app/src/services/supervisor-service.ts:8-18` (frame
shape + seq-cursor caveat).

**Confidence:** SSE-consume pattern **HIGH** (mirrors InboxTab); `?sinceSeq` resume **MEDIUM** (may need a
small 0256 addition — flagged; client-dedupe is the fallback); reconnect-across-respawn **MEDIUM**.

**Files:** `apps/web/src/modules/teams/MemberTerminal.tsx` + `apps/web/tests/modules/teams/*.test.tsx`.
### Plan
1. Create `apps/web/src/modules/teams/` (dir; 0254 adds the module shell + tabs).
2. `MemberTerminal.tsx`: `EventSource` subscribe → `<pre>` render, seq de-dupe, auto-scroll.
3. Add the stdin input line: POST on Enter, clear-on-success, retain-on-failure, disabled off-`running`.
4. Reconnect + backoff + resume-from-seq (use `?sinceSeq` if 0256 provides it, else client-filter).
5. State banner for stopped/exited/errored.
6. Tests (happy-dom): mock `EventSource` + `fetch`; assert render/scroll/dedupe/reconnect/close/stdin.
7. `bun run lint && bun run test`.

**Depends on:** 0256's stream + stdin routes (already exist); a `?sinceSeq` query on the stream is a
nice-to-have (client-dedupe otherwise).
### Solution
**Component:** `apps/web/src/modules/teams/MemberTerminal.tsx` — a minimal, no-dependency terminal view rendering ring-buffer frames from the existing SSE stream, plus an input line POSTing to stdin. No xterm.js (per DD-3: attach is line-framed, not a raw TTY). Reuses the observability `EventSource` + `fetchWithTimeout`/`resolveApiUrl` pattern from `InboxTab.tsx`.

**Change map:**
- `apps/web/src/modules/teams/MemberTerminal.tsx:1` — new file: `MemberTerminal` React component + exported pure helpers (`parseFrame`, `parseProcessList`, `appendFrame`, `nextBackoff`, `stdinUrl`, `streamUrl`).
- `apps/web/src/modules/teams/MemberTerminal.tsx:33` — `parseFrame(value)`: runtime-narrows untrusted SSE payloads into `Frame | null` (R1, R6).
- `apps/web/src/modules/teams/MemberTerminal.tsx:57` — `parseProcessList(value)`: runtime-narrows the `/api/team/processes` response (R5).
- `apps/web/src/modules/teams/MemberTerminal.tsx:107` — `appendFrame(frames, frame, lastSeq)`: seq-cursor dedup (drops `seq <= lastSeq`), caps buffer at `MAX_FRAMES=1000`, always passes meta frames (R6).
- `apps/web/src/modules/teams/MemberTerminal.tsx:131` — `nextBackoff(attempt)`: exponential backoff schedule 1s→2s→4s→8s→15s cap (R4).
- `apps/web/src/modules/teams/MemberTerminal.tsx:140` — `MemberTerminal` component: EventSource subscribe at line 189, frame rendering in `<pre>` with stdout/stderr distinction, auto-scroll, status poll every 3s, stdin POST on Enter, reconnect with backoff on error.
- `apps/web/tests/modules/teams/MemberTerminal.test.tsx:1` — new test file: 24 tests covering pure functions (parseFrame, parseProcessList, appendFrame, nextBackoff, stdinUrl, streamUrl) + component rendering (AC1, AC3, AC4, AC5, AC6, AC2 input-enabled, DOM order).

**Rationale:** the `seq` is the stable cursor — array index is NOT (ring-buffer overflow splices from front, `supervisor-service.ts:14`). The client tracks `lastSeq` via a ref and dedupes frames with `seq <= lastSeq`. Reconnect resumes from `lastSeqRef.current` via `streamUrl(agentId, sinceSeq)`. The `?sinceSeq=` parameter is constructed for backend resume support (0256 may add this); client-side dedup is the fallback.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `MemberTerminal` component subscribes to `GET /api/team/processes/:id/stream` via `EventSource` at `MemberTerminal.tsx:189`, renders frames in a scrolling `<pre>` with stdout/stderr visually distinguished (`text-error` class for stderr, `data-stream` attribute), tracks `lastSeq` via `lastSeqRef`. `parseFrame` runtime-narrows untrusted SSE payloads. |
| R2 | MET | Input line at `MemberTerminal.tsx:265` POSTs `{line}` to `.../stdin` via `fetchWithTimeout` on Enter (`sendInput` callback at `MemberTerminal.tsx:243`); cleared on 200 success (`setInput('')` at line 255); failed POST surfaces error without losing typed text (error path retains `input` state); disabled unless `status === 'running'` (`disabled={!isRunning}`). |
| R3 | MET | `useEffect` at line 223 opens `EventSource` on mount, `es.close()` on unmount (cleanup at line 228). Backfill is handled by the server's SSE endpoint replaying the ring buffer (server `GET /api/team/processes/:id/stream` sends ring-buffer frames oldest-first, then `--replay-done--` marker). |
| R4 | MET | `es.onerror` at `MemberTerminal.tsx:210` closes the EventSource, schedules reconnect with `nextBackoff(attempt)` (1s→2s→4s→8s→15s cap), and resumes from `lastSeqRef.current` via `streamUrl(agentId, lastSeqRef.current)` — no duplicate lines (seq dedup in `appendFrame`). |
| R5 | MET | Member status polled every 3s from `GET /api/team/processes` at `MemberTerminal.tsx:155`; `running` enables input; `stopped`/`exited`/`errored` disables input and shows status banner (`data-status-banner` div at line 276). |
| R6 | MET | `appendFrame` at `MemberTerminal.tsx:107` drops frames with `seq <= lastSeq` (dedup); tolerates ring-buffer overflow by capping UI buffer at `MAX_FRAMES=1000` (splice from front); meta frames (no seq) always pass through. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-14T16:21:34.168Z todo → wip (system)
- 2026-07-14T16:29:56.274Z wip → blocked (system)
- 2026-07-14T16:44:54.445Z blocked → wip (system)
- 2026-07-14T17:05:30.800Z wip → testing (system)
- 2026-07-14T17:05:35.915Z testing → done (system)
