---
template: feature-impl
schema_version: 1
name: "Attach terminal: xterm.js over the existing SSE stream + stdin POST endpoints"
description: ""
status: todo
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:09.688Z"
updated_at: "2026-07-14T06:44:22.059Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
