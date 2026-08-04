---
template: feature-impl
schema_version: 1
name: "Inbox Board module v1: All / Supervisor / per-agent tabs over a unified message+process timeline"
description: ""
status: todo
type: task
profile: standard
feature_id: M4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-03T23:02:05.562Z"
updated_at: "2026-08-04T00:07:00.232Z"
---

## 0422. Inbox Board module v1: All / Supervisor / per-agent tabs over a unified message+process timeline

### Background
Ship the first landable slice of the M4 map: the `Inbox` Board module as the single surface for the
agent message plane, replacing the message views currently scattered across two modules.

#### Requirement numbering — one namespace

Requirement and scenario numbers here are **M4's**. Task R{n} implements M4 R{n} with no
translation, so a number means the same thing in the feature map, this task, and the verdict.

| Number | Owner | In this task |
| --- | --- | --- |
| R1–R7 | M4 | **In scope** — the Inbox module, tabs, timeline, and consolidation. |
| **R8** | M4 | **Excluded** — supervisor relay hold toggle. This task has no R8; the number is skipped deliberately, not by accident. |
| R9–R14 | M4 (added by this task's refinement) | **In scope** — stream-helper extraction, DESIGN.md conformance, and resource teardown. |

**M4 R8 (supervisor relay hold toggle) is deliberately excluded** — it needs a cross-process flag
that both the server process and `spur agent loop` observe, and no such mechanism exists today. That
open question is recorded in M4's `## Notes` → *Not yet specified* and gets its own ticket once
decided.

#### What already exists (reuse, do not rewrite)

| Need | Already shipped | Path |
| --- | --- | --- |
| Global message feed + wire parsing | `parseMessagesFeed(body)` | `apps/web/src/modules/teams/MessagesTab.tsx:50` |
| Process frame parsing / buffering / backoff | `parseFrame`, `appendFrame`, `nextBackoff`, `streamUrl` | `apps/web/src/modules/teams/MemberTerminal.tsx:45,101,89,115` |
| Team roster polling | `useTeamsData()` | `apps/web/src/modules/teams/useTeamsData.ts:75` |
| Tab-strip shell pattern (roles, aria wiring) | `TeamsShell` | `apps/web/src/modules/teams/TeamsShell.tsx` |
| Module auto-discovery | named `module` export of `WebModule` in a sibling dir | `apps/web/src/modules/discover.ts` |
| Module-scoped DESIGN.md palette (the R10/R11 pattern) | `.task-kanban` scoped block | `apps/web/src/styles/global.css:78` |

No new endpoint, table, or backend service is required. Both data sources are already served:
`GET /api/messages` (durable queue) and `GET /api/team/processes/:id/stream` (SSE frames).

#### The two-channel trap

An Inbox row is **not** one thing. Durable queue messages are SQLite-backed with a
`queued → injected` lifecycle and reach the agent when `spur agent loop` calls
`TeamService.drainPending`. Process frames are an in-memory ring buffer (default 500 frames, lost on
restart) fed by `PipeProcess` stdout/stderr. The unified timeline **interleaves** them for display;
it does not merge their storage, and it does not change how messages are delivered. Writing a
message to stdin is out of scope (M4 `## Scope` → Out).
### Requirements
Requirement numbers are **M4's** — task R{n} implements M4 R{n}, one namespace, no translation.
**R8 is intentionally absent**: it is M4's supervisor relay hold toggle, excluded from this task
(see `## Background`). Every requirement below has a matching Acceptance Criteria scenario.

- [ ] R1. Register `apps/web/src/modules/inbox/` as a Board module — `index.tsx` exporting a named `module: WebModule` (`id: 'inbox'`, `route: 'inbox'`, `sidebarLabel: 'Inbox'`, icon, and an `order` placing it adjacent to Teams; discovery is automatic, no registry edit) — plus `InboxShell.tsx` mirroring `TeamsShell`'s aria wiring (`tablist`/`tab`/`tabpanel`, `aria-selected`, `aria-controls`), with `All` fixed at position 1 and `Supervisor` fixed at position 2, both present even when no team is running.
- [ ] R2. Move `teams/MessagesTab.tsx` to `inbox/AllTab.tsx`, preserving behaviour: `GET /api/messages`, newest-first, sender/recipient/status/timestamp per row, SSE-driven refetch on `message.sent|replied`, and defensive parsing that survives a malformed row.
- [ ] R3. Add `inbox/SupervisorTab.tsx` rendering the same feed filtered to rows whose `fromId` or `toId` is the supervisor endpoint. Read-only filtering — no routing change, no new backend identity, no extra call. Resolve the endpoint from a single named constant so the open M4 identity question has one place to land.
- [ ] R4. Render one tab per member of the selected (or default) team after the two fixed tabs, sourced from `useTeamsData()`; the tab set updates when the team selection changes.
- [ ] R5. Render a unified per-agent timeline: durable messages to/from that agent interleaved with its process frames, ordered by timestamp ascending, each entry showing its kind (message vs. `stdout`/`stderr` frame) and its direction (inbound to the agent vs. outbound from it). Merge client-side; no server change.
- [ ] R6. Render an explicit boundary marker at the oldest available process frame, since the ring buffer is bounded and ephemeral while messages are durable. Never synthesize frames for the period before the marker; an agent with no frames at all renders a message-only timeline, not an error.
- [ ] R7. Consolidate the message surfaces: drop `messages` from `TEAMS_TABS`, and delete `apps/web/src/modules/observability/InboxTab.tsx` (orphaned from `OBSERVABILITY_TABS` since 0254) together with its tests in `apps/web/tests/modules/observability/components.test.tsx`. No dangling imports; suite stays green.
- [ ] R9. Extract `parseFrame`, `appendFrame`, `nextBackoff`, and `streamUrl` from `teams/MemberTerminal.tsx` into `apps/web/src/lib/process-stream.ts`, imported by both `MemberTerminal` and the Inbox agent timeline. Behaviour-preserving move — no logic change, existing tests repointed.
- [ ] R10. Scope the `DESIGN.md` palette to the module: declare the DESIGN.md token values under an `.inbox` container class on the module root, leaving the shared `@theme` `spur-*` values byte-identical (13+ files across Features/Teams/Observability consume them). Mirrors `.task-kanban` (0420 R6, `apps/web/src/styles/global.css:78`). No hex literal and no Tailwind palette class (`bg-green-500`, `text-slate-400`, …) anywhere in the module — every surface resolves a `spur-*` token.
- [ ] R11. Keep the module single-hued: inside the `.inbox` scope pin `--color-primary`, `--color-primary-content`, `--color-accent`, `--color-accent-content` to the DESIGN.md lavender `#5e6ad2` on `#ffffff`. Required because `@/ui` primitives render daisyUI variants (`Button variant="primary"` → `btn-primary` → `var(--color-primary)`), which otherwise resolve daisyUI's own indigo/teal and place a second chromatic accent on screen — 0420 finding F-01. Accent is used only for focus ring, selection, and link/CTA emphasis; never a row, card, or tab fill.
- [ ] R12. Apply the DESIGN.md surface ladder and type scale: cards sit one ladder step above their container with a 1px hairline border, `rounded-xl` (12px) corners for cards and `rounded-lg` (8px) for controls, no drop shadows for hierarchy; body text 14px/w500, timestamps and identifiers as mono caption (`text-xs font-mono`), no display type.
- [ ] R13. Leave the other board modules unregressed by the Inbox palette — the Teams and Observability modules continue to resolve the unchanged shared palette, and their existing suites stay green.
- [ ] R14. Keep resources bounded: one in-flight `AbortController` per fetch path and one `EventSource` per mounted agent tab, both torn down on unmount and on agent switch, matching the existing `MemberTerminal`/`MessagesTab` pattern. Switching tabs must not leak a stream.
### Acceptance Criteria
Scenario numbers are **M4's** — this task covers M4 R1–R7 and R9–R14. **M4 R8** (supervisor relay
hold toggle) is out of this task and has no scenario here; see `## Background`.

```gherkin
Feature: Inbox Board module v1

  @core
  Scenario: R1 — Inbox registers as a Board module with two fixed leading tabs
    Given the web module registry has discovered the modules directory
    When the operator opens the Inbox module route
    Then the module renders with "All" as the first tab and "Supervisor" as the second tab
    And the registry reports no duplicate module id or route

  @core
  Scenario: R2 — The All tab shows message traffic across every agent
    Given messages exist addressed to more than one agent
    When the operator selects the "All" tab
    Then every message is listed newest-first with its sender, recipient, status, and timestamp
    And a malformed row from the endpoint does not crash the tab

  @core
  Scenario: R3 — The Supervisor tab filters the feed to supervisor traffic
    Given the message feed contains both supervisor and agent-to-agent messages
    When the operator selects the "Supervisor" tab
    Then only messages whose sender or recipient is the supervisor endpoint are listed
    And no message-routing behaviour changes as a result of viewing this tab

  @core
  Scenario: R4 — Per-agent tabs are derived from the team roster
    Given the selected team has members
    When the Inbox module renders its tab strip
    Then one tab appears per team member after the two fixed tabs
    And the tab set updates when the selected team changes

  @core
  Scenario: R5 — A per-agent tab renders a unified IN/OUT timeline
    Given an agent has both durable queue messages and recent process output frames
    When the operator selects that agent's tab
    Then queue messages and stdout/stderr frames appear in one timeline ordered by timestamp
    And each entry is visually distinguishable as a message or a process frame
    And each entry is marked as inbound or outbound relative to the agent

  @core
  Scenario: R6 — The process-frame history boundary is visible
    Given the process ring buffer holds fewer frames than the agent's message history spans
    When the operator views that agent's unified timeline
    Then a boundary marker indicates where process-frame history begins
    And messages older than the marker still render without fabricated frame context

  @core
  Scenario: R7 — Message surfaces are consolidated, not duplicated
    Given the Inbox module ships
    When the Board is loaded
    Then the Teams module no longer renders a "Message" tab
    And the orphaned observability InboxTab component and its tests are deleted
    And the full test suite passes with no dangling imports

  @core
  Scenario: R9 — Process-stream helpers are shared, not duplicated
    Given the frame parsing buffering backoff and stream-url helpers are extracted to a shared module
    When both the Teams member terminal and the Inbox agent timeline consume them
    Then both import the helpers from the shared module rather than redeclaring them
    And the pre-existing member-terminal tests pass unchanged against the new import path

  @core
  Scenario: R10 — Inbox surfaces resolve DESIGN.md tokens through a module scope
    Given the Inbox module root carries its own scoping class
    When Inbox surfaces render
    Then the DESIGN.md token values resolve only within that scope
    And the shared theme token values are left unmodified
    And no hard-coded hex value or framework palette class appears in the module

  @core
  Scenario: R11 — Inbox controls resolve a single chromatic accent
    Given the Inbox renders shared UI primitives that map onto component-library variants
    When a primary or accent control renders inside the Inbox
    Then it resolves the DESIGN.md accent rather than the component library's own default hue
    And the accent is used only for focus selection or link emphasis
    And no row card or tab uses the accent as a fill

  @core
  Scenario: R12 — Inbox cards and type follow the DESIGN.md ladder and scale
    Given an Inbox timeline row or panel renders
    Then its background sits one surface-ladder step above its container
    And it carries a hairline border and the DESIGN.md card corner radius
    And body text timestamps and identifiers follow the DESIGN.md type scale
    And display type is not introduced

  @core
  Scenario: R13 — Other board modules are unregressed by the Inbox palette
    Given the Inbox defines DESIGN.md token values in its own scope
    When the Teams and Observability modules render
    Then they resolve the unchanged shared palette
    And their existing tests pass

  @edge
  Scenario: R14 — Switching agent tabs tears down the previous stream
    Given an agent tab is mounted with an open event stream and an in-flight fetch
    When the operator switches to a different agent tab
    Then the previous stream is closed and its in-flight fetch aborted
    And exactly one stream remains open for the newly mounted tab
    And unmounting the module leaves no open stream or in-flight fetch
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Target layout

```
apps/web/src/lib/
  process-stream.ts        # EXTRACTED from MemberTerminal: parseFrame, appendFrame, nextBackoff, streamUrl
apps/web/src/modules/inbox/
  index.tsx                # WebModule export — auto-discovered; module root carries the `inbox` scope class
  InboxShell.tsx           # tab strip: [All][Supervisor][…one per team member]
  tabs.ts                  # FIXED_INBOX_TABS (append-only, id-stable — mirrors teams/tabs.ts)
  AllTab.tsx               # MOVED from teams/MessagesTab.tsx
  SupervisorTab.tsx        # AllTab feed + supervisor endpoint filter
  AgentTab.tsx             # per-agent unified timeline
  timeline.ts              # pure merge: (messages, frames) → TimelineEntry[]
apps/web/src/styles/global.css
                           # + `.inbox { … }` scoped DESIGN.md token block (R10), beside `.task-kanban`
```

#### The merge, and why it is pure

`timeline.ts` holds a single exported function with no I/O:

```ts
mergeTimeline(messages: MsgRow[], frames: Frame[], agentId: string): TimelineEntry[]
```

A `TimelineEntry` is a discriminated union — `{ kind: 'message' | 'frame', direction: 'in' | 'out',
ts: string, … }` — so the renderer branches on `kind` and never on the presence of optional fields.
Keeping the merge pure is what makes R5 and R6 testable without mounting a component or faking an
`EventSource`; the component becomes a thin renderer over its output.

**Ordering.** Sort ascending on the ISO timestamp (`createdAt` for messages, `ts` for frames). Ties
are broken by placing messages before frames, then by `seq` among frames. Clock skew between the
server process and a spawned agent process is a known limitation — the M4 map records it under
*Not yet specified*, and this task does not attempt to correct it.

**Direction.** A message is inbound when `toId === agentId`, outbound when `fromId === agentId`. A
frame is inbound when `stream === 'stdout' | 'stderr'` (the agent talking back). Operator-typed
stdin lines are not in the ring buffer and so do not appear — this is expected, not a gap.

**Boundary (R6).** The oldest frame's `ts` is the boundary. Entries older than it are messages only;
render one marker row at that point. When there are no frames at all (agent stopped), render the
message-only timeline with a note that no process output is available — not an error state.

#### Supervisor identity (R3)

There is no supervisor agent id in the message plane today. Define one exported constant in
`SupervisorTab.tsx` (e.g. `SUPERVISOR_ENDPOINT_ID`) and filter on it. One constant, one place to
change when the M4 identity question resolves. Do **not** invent a backend identity in this task.

#### DESIGN.md application (R10-R13) — follow 0420, do not re-derive it

Task 0420 already applied `DESIGN.md` to the Task Kanban module and paid for two lessons. Reuse the
outcome rather than rediscovering it.

**Scope, don't remap (R10).** The shared `@theme` `spur-*` values are consumed by 13+ files across
Features, Teams, Observability, the sidebar, `ProjectSwitcher`, `ResizeHandle`, and
`MainWorkspace`. Remapping them globally would visibly change every one of those modules. 0420
resolved this by declaring the DESIGN.md values inside a `.task-kanban { … }` block and putting that
class on the module root, leaving the shared palette byte-identical. Do the same with `.inbox`:

```css
.inbox {
    /* DESIGN.md surface ladder / hairline / accent / ink — module-scoped */
    --color-spur-bg: #010102;
    --color-spur-surface: #0f1011;
    --color-spur-surface-2: #141516;
    --color-spur-surface-3: #18191a;
    --color-spur-border: #23252a;
    --color-spur-accent: #5e6ad2;
    --color-spur-text: #f7f8f8;
    --color-spur-text-muted: #d0d6e0;
    --color-spur-text-faint: #8a8f98;   /* DESIGN.md ink-subtle — NOT ink-tertiary #62666d */
    /* R11 — daisyUI hues, see below */
    --color-primary: #5e6ad2;
    --color-primary-content: #ffffff;
    --color-accent: #5e6ad2;
    --color-accent-content: #ffffff;
}
```

Add a `[data-theme="light"] .inbox { … }` block alongside it, mirroring `.task-kanban`'s.

**The daisyUI trap (R11).** This is 0420's finding F-01 and it is easy to miss, because the module
looks correct until you notice the buttons. This task builds on `@/ui` primitives; those map variants onto
daisyUI classes (`Button variant="primary"` → `btn-primary`), and daisyUI 5 resolves
`.btn-primary{--btn-color:var(--color-primary)}` — **its own** `--color-primary`, not any `spur-*`
token. Left alone, every primary/accent control in the Inbox renders daisyUI's default indigo/teal
next to the DESIGN.md lavender: a second chromatic accent, violating R11. Pinning the four daisyUI
variables inside the `.inbox` scope fixes it without touching daisyUI's global defaults. Verify by
grepping the built CSS for `--color-primary:` — the lavender must appear exactly once (scoped) with
daisyUI's `oklch(…)` defaults still present globally.

**Ink scale (R12).** DESIGN.md has four ink steps. `ink-subtle` is `#8a8f98` (tertiary type);
`ink-tertiary` `#62666d` is reserved for disabled text and footnotes. Map `--color-spur-text-faint`
to `ink-subtle`. A 0420 review finding briefly claimed the opposite — it was wrong.

**Verification.** R12 geometry and type are read off the diff; R10 is a grep (hex literals + Tailwind palette classes → none in the module).
R13 is the regression guard: assert the module root carries the `inbox` class, and confirm the
Teams/Observability suites stay green, which proves the shared palette is untouched.

#### Explicitly not built here

- No supervisor-hub routing, no forwarding actor, no change to `TeamService.sendMessage`.
- No relay toggle (**M4** R8) — blocked on the cross-process flag decision.
- No new server route, DB table, or persisted frame retention.
- No stdin composer in the Inbox; `teams/MemberTerminal` keeps that role.
### Plan
1. **Extract the stream helpers (R9).** Move `parseFrame`, `appendFrame`, `nextBackoff`, and
   `streamUrl` out of `teams/MemberTerminal.tsx` into `apps/web/src/lib/process-stream.ts`. Repoint
   `MemberTerminal` and its tests. Pure move — run `bun run test` here and confirm green before
   writing anything new, so a later failure is unambiguously new code.
2. **Write `inbox/timeline.ts` + its tests first.** `mergeTimeline` is pure, so TDD it directly:
   ordering, tie-breaks, direction assignment, the boundary index, and the no-frames case. This is
   the only non-trivial logic in the task — get it right before any component exists.
3. **Scaffold the module (R1).** `index.tsx` + `tabs.ts` + `InboxShell.tsx` mirroring
   `TeamsShell`'s aria wiring. Put the `inbox` scope class on the module root now (R10), so every
   component written afterwards renders under the DESIGN.md palette rather than being retrofitted.
   Assert discovery and the fixed tab order.
4. **Move MessagesTab → `inbox/AllTab.tsx` (R2).** A move, not a rewrite; keep `parseMessagesFeed`
   exported and its tests passing at the new path.
5. **Add `SupervisorTab.tsx` (R3).** Reuse `AllTab`'s fetch/parse; apply the endpoint filter via
   the single `SUPERVISOR_ENDPOINT_ID` constant.
6. **Add per-agent tabs (R4) and `AgentTab.tsx` (R5, R6).** Roster from `useTeamsData()`;
   `AgentTab` fetches messages, opens one `EventSource` for frames, and renders `mergeTimeline`'s
   output. Verify teardown on agent switch (R14).
7. **Consolidate (R7).** Drop `messages` from `TEAMS_TABS`; delete
   `observability/InboxTab.tsx` and its three test blocks in
   `apps/web/tests/modules/observability/components.test.tsx`.
8. **Design pass (R10–R13).** Add the `.inbox` scoped block (dark + light) to `global.css`; pin the
   four daisyUI variables (R11); check the surface ladder, hairline borders, radii, and type scale
   against root `DESIGN.md` (R12). Then verify: grep the module for hex literals and Tailwind
   palette classes (expect none), grep the built CSS so `--color-primary:` shows the lavender
   exactly once with daisyUI's `oklch(…)` defaults still global, and run the Teams + Observability
   suites to prove the shared palette is untouched (R13).
9. **Gate.** `bun run autofix && bun run spur-check`, then `bun run lint`, `bun run test`,
   `bun run test-cf`, `bun run build`. `git status` intentional only.

#### Risks

- **The move in step 1 touches a file with a known flaky test** (`TerminalTab` localStorage, ~50%
  at HEAD, owned by 0263). If it fails, verify against a clean stash before blaming this change.
- **Deleting the observability tests reduces that file's coverage denominator.** `apps/web` `.tsx`
  is excluded from the per-file coverage gate, so this should not trip `bunfig.toml` — confirm in
  step 9 rather than assuming.
- **Retrofitting the scope class late is the expensive path.** Step 3 sets it deliberately early;
  if components are built first and scoped afterwards, every surface needs re-checking against the
  ladder (this is what 0420 had to do).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
#### Feature

- `docs/features/M4_inbox-board-module-unified-agent-message-plane-all-supervisor-per-agent-tabs.md`
  — the wayfinder map: destination, the two-channel table, decisions D1–D4, and the open questions
  blocking R8.

#### Code to reuse

- `apps/web/src/modules/teams/MemberTerminal.tsx:45,89,101,115` — `parseFrame`, `nextBackoff`,
  `appendFrame`, `streamUrl` (extracted in step 1).
- `apps/web/src/modules/teams/MessagesTab.tsx:50` — `parseMessagesFeed` (moves with the file).
- `apps/web/src/modules/teams/useTeamsData.ts:75` — `useTeamsData()` roster hook.
- `apps/web/src/modules/teams/TeamsShell.tsx` — tab-strip + aria pattern to mirror.
- `apps/web/src/modules/teams/tabs.ts` — append-only, id-stable tab contract to mirror.
- `apps/web/src/modules/discover.ts` — module auto-discovery contract.
- `apps/web/src/modules/types.ts` — `WebModule` shape (`order` controls sidebar placement).

#### Endpoints consumed (both already ship)

- `GET /api/messages` — global feed; `apps/server/src/modules/messages/index.ts:41`.
- `GET /api/team/processes/:id/stream` — SSE frames; `apps/server/src/modules/team/index.ts:120`.
- `GET /api/events/planning` — `message.sent|replied` refetch signal.

#### Backend context (read-only for this task)

- `packages/app/src/services/team-service.ts:268,286,308,349` — `sendMessage`, `getInbox`,
  `drainPending`, `listRecent`. `drainPending` is where R8's relay gate will eventually go.
- `packages/app/src/services/supervisor-service.ts:9,22` — `ProcessFrame` / `ProcessEntry`; the ring
  buffer's boundedness is why R6 exists.

#### Design

- Root `DESIGN.md` — UI/UX SSOT (REQ-10).
- `docs/design/workspace-design.md:84` — notes the earlier tab-component reuse pattern.
### History
