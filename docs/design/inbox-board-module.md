---
doc: design/inbox-board-module
feature_id: M4
owns: SURFACE + mechanism for the Inbox Board module (message plane)
authority: derived (ADR wins on conflict)
updated_at: 2026-08-04
---

# Inbox Board module — unified agent message plane

The Inbox is the single Board surface for the agent message plane (ADR-042). Fixed `All` /
`Supervisor` tabs plus one tab per team member render a unified IN/OUT timeline that interleaves
durable queue messages with process stdout/stderr frames. Shipped by task 0422 (M4 R1–R7, R9–R14).

## 1. Module registration

`apps/web/src/modules/inbox/index.tsx` exports the auto-discovered `module: WebModule` — no registry
edit needed (`discover.ts` eager glob):

| Field | Value |
| --- | --- |
| `id` / `route` | `inbox` |
| `name` / `sidebarLabel` | `Inbox` |
| `icon` | `💬` |
| `order` | `1` (adjacent to Teams) |

## 2. Tab contract

`apps/web/src/modules/inbox/tabs.ts` — append-only, id-stable (never reorder/rename):

```ts
interface InboxTab { readonly id: string; readonly label: string }
const FIXED_INBOX_TABS = [
    { id: 'all', label: 'All' },          // position 1 — global feed
    { id: 'supervisor', label: 'Supervisor' }, // position 2 — feed filtered to supervisor traffic
];
```

Both fixed tabs render even when no team is running. Per-agent tabs (R4) are appended after them,
derived from `useTeamsData()` roster; the set updates on team selection change.

## 3. Supervisor filter

`apps/web/src/modules/inbox/SupervisorTab.tsx` exports `SUPERVISOR_ENDPOINT_ID = 'supervisor'` — the
one place to change when the open M4 identity question resolves. The tab reuses the shared
`useMessageFeed` from `AllTab` and filters rows to `fromId === SUPERVISOR_ENDPOINT_ID ||
toId === SUPERVISOR_ENDPOINT_ID`. Read-only: no routing change, no new backend identity, no extra call.

## 4. Timeline merge

`apps/web/src/modules/inbox/timeline.ts` — pure, no I/O:

```ts
mergeTimeline(messages: MsgRow[], frames: Frame[], agentId: string): TimelineEntry[]
```

- `TimelineEntry` is a discriminated union: `{ kind: 'message' | 'frame', direction: 'in' | 'out', ts, … }`.
- **Ordering:** ascending on ISO timestamp (`createdAt` for messages, `ts` for frames); ties break
  messages before frames, then by `seq` among frames.
- **Direction:** message inbound when `toId === agentId`, outbound when `fromId === agentId`; frame
  inbound when `stream === 'stdout' | 'stderr'`. Operator-typed stdin lines are not in the ring buffer
  and do not appear (expected).
- **Boundary (R6):** the oldest frame's `ts` is the history boundary; entries older are messages
  only, rendered behind a marker. No frames at all → message-only timeline with a "no process output"
  note, not an error.

Clock skew between server and agent processes is a known limitation (M4 `## Notes`), not corrected here.

## 5. Shared stream helpers (R9)

`apps/web/src/lib/process-stream.ts` holds `Frame`, `parseFrame`, `appendFrame`, `nextBackoff`, and
`streamUrl(agentId, sinceSeq?)` — extracted from `teams/MemberTerminal.tsx`, imported by both
`MemberTerminal` and the Inbox agent timeline.

## 6. Resource teardown (R14)

One in-flight `AbortController` per fetch path and one `EventSource` per mounted agent tab, both torn
down on unmount and on agent switch (`AgentTab.tsx:88-129`, `AllTab.tsx:112-146`). Switching tabs
never leaks a stream.

## 7. DESIGN.md scoping (R10–R13)

`apps/web/src/styles/global.css` carries a `.inbox { … }` block (and `[data-theme="light"] .inbox`)
beside `.task-kanban`. It declares the DESIGN.md ladder/hairline/ink tokens as module-scoped
`--color-spur-*` overrides (shared `@theme` values stay byte-identical — 13+ files consume them) and
pins the four daisyUI variables:

```
--color-primary / --color-primary-content / --color-accent / --color-accent-content
    → #5e6ad2 on #ffffff
```

The daisyUI pins exist because `@/ui` primitives map variants onto daisyUI's **own** `--color-primary`
(`btn-primary → var(--color-primary)`), which would otherwise render daisyUI's indigo/teal next to the
DESIGN.md lavender — a second chromatic accent (0420 finding F-01). The accent is used only for focus
ring, selection, and link/CTA emphasis; never a row, card, or tab fill. Module code has **no hex
literal and no Tailwind palette class** — every surface resolves a `spur-*` token. Ink scale: map
`--color-spur-text-faint` to DESIGN.md `ink-subtle` `#8a8f98`; `ink-tertiary` `#62666d` is reserved for
disabled text/footnotes.

## 8. Consolidation (R7)

- `messages` dropped from `TEAMS_TABS`; `teams/MessagesTab.tsx` moved to `inbox/AllTab.tsx`
  (behaviour-preserving).
- `apps/web/src/modules/observability/InboxTab.tsx` (orphaned since 0254) deleted with its tests.

## 9. Out of scope (ADR-042 / M4)

- Supervisor-hub routing (A→supervisor→B), a supervisor message-plane identity, and the relay hold
  toggle (M4 R8, blocked on the cross-process flag decision) — no forwarding actor, no new endpoint,
  table, or persisted frame retention. No stdin composer; `teams/MemberTerminal` keeps that role.
