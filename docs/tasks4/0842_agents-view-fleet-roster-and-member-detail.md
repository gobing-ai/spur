---
schema_version: 1
name: "Agents view: fleet roster and member detail"
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.544Z
updated_at: "2026-09-12T05:49:59.293Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0840"]
---

## 0842. Agents view: fleet roster and member detail

### Background

Agent visibility is split across Teams and Inbox today. The replacement is one roster scoped to the
selected project, with a member detail pane that reuses the existing process, terminal, message, and
activity transports under `/api/team/*` rather than introducing a new one
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Projects Board information architecture").

Declared desired state and observed liveness are different facts: a running process may be busy,
blocked, or unable to dispatch because its executor is disabled
(`docs/reports/g6-runtime-inventory.md` §5). The roster must show both without collapsing them into
one green dot.

Prototype coverage: R3-1…R3-8 state cards (`docs/reports/g6-projects-prototype.md`).

### Requirements

- **R1** — A roster of the project's fleet: role, executor, capabilities, current work, orchestrator
  marker.
- **R2** — Declared state and observed liveness are rendered as distinct facts.
- **R3** — Member detail exposes process, terminal, messages, and activity through existing
  `/api/team/*` transports.
- **R4** — Escape closes member detail and returns focus to its opener.
- **R5** — `executor-unavailable` is a named state with its next action, distinct from offline.
- **R6** — No agent lifecycle control is invented here beyond what the existing transports already
  expose.

### Acceptance Criteria

```gherkin
Feature: Agents view fleet roster and member detail

  @core
  Scenario: The roster shows the project fleet
    Given a project with declared fleet members
    When the Agents view opens
    Then each member shows role, executor, capabilities, and current work
    And the orchestrator is marked

  @core
  Scenario: Declared and observed are separate
    Given a member that is declared enabled but whose process is not running
    When its card renders
    Then declared state and observed liveness are shown as distinct facts

  @core
  Scenario: Detail opens and returns focus
    Given a member card with focus
    When detail is opened and then dismissed with Escape
    Then focus returns to the card that opened it
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:49:59.293Z

- **Where does the roster come from? — CLOSED: `ProjectFleetSnapshot.members` (task 0840), not
  `/api/team/teams`.** The scope is the project's fleet, which task 0835's `FleetService.resolve`
  defines from `<projectPath>/.spur/fleet.json`. `/api/team/teams` returns config-declared *teams*,
  the concept this program is retiring; sourcing the roster from it would rebuild the overlap.
- **Do the transports need extending? — CLOSED: no.** Verified present in the tree:
  `GET /api/team/processes` (`apps/server/src/modules/team/index.ts:41`),
  `POST /api/team/agents/:id/start` (`:77`), `POST /api/team/agents/:id/stop` (`:88`),
  `POST /api/team/processes/:id/stdin` (`:99`), `GET /api/team/processes/:id/stream` (`:120`). The
  only new field this task needs — `members` on the fleet snapshot — was folded into task 0840's
  frozen endpoint shape during this refinement so the shape is declared once.
- **Declared vs observed — CLOSED: a two-fact card, joined by `instanceId`.** They come from different
  systems and disagree in both directions; the undeclared-live-process direction is the one a
  members-only roster would silently hide.
- **Is `capability-unknown` a failure? — CLOSED: no, it is its own state.** Task 0835 froze that
  `'unknown'` grants nothing and is never a permissive default (`packages/config/src/index.ts:228-236`).
  Rendering it as unavailable would report a missing attestation as a broken executor.
- **Reuse or re-write the terminal? — CLOSED: reuse.** `MemberTerminal({ agentId })`
  (`apps/web/src/modules/teams/MemberTerminal.tsx:66`) already streams through
  `apps/web/src/lib/process-stream.ts` with the `seq`-cursor handling the ring buffer requires.
  `ProcessStatus` and `parseProcessList` are imported from the same file rather than duplicated.
- **Modal or pane? — CLOSED: a pane with focus restore, no focus trap.** R4 asks only that Escape
  return focus to the opener. A focus-trapping dialog would add an interaction contract no requirement
  asks for and that 0845 would then have to verify.
- **Lifecycle scope — CLOSED: start, stop, stdin, nothing else.** R6 forbids inventing controls; the
  three verbs are exactly what the existing transports expose.
- **Cross-project agent visibility — DEFERRED, owner: G63 scope (out).** The feature's Out list
  excludes fleet-wide control surfaces, and one Board server serves one project (task 0840), so a
  cross-project roster is not reachable from this origin.

### Design

**WHAT.** An `Agents` tab rendering the served project's fleet as a roster of cards, each joining two
independent facts — the **declared** member from `ProjectFleetSnapshot.members` and the **observed**
process from `GET /api/team/processes` — plus a member detail pane that mounts the existing process,
terminal, message, and activity surfaces.

**WHY a join and not a status field.** The two facts come from different systems and can disagree in
both directions: a member declared `enabled: true` with no live process is *declared-but-not-running*;
a live process with no declared member is *running-but-undeclared* (a hand-started agent, or a member
removed from `fleet.json` while its process survives). Collapsing them into one indicator would erase
exactly the disagreement the runtime inventory names as the operator's main diagnostic
(`docs/reports/g6-runtime-inventory.md` §5). The card therefore has two labeled facts, never one dot.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/web/src/modules/projects/AgentsView.tsx` (new) | roster grid + detail host |
| `apps/web/src/modules/projects/roster.ts` (new) | the declared⇄observed join and its state resolver |
| `apps/web/src/modules/projects/MemberDetail.tsx` (new) | detail pane; mounts existing surfaces |
| `apps/web/src/modules/projects/tabs.ts` | register the `agents` tab |
| — | **no server change**; both transports already exist |

**Frozen names.**

```ts
// roster.ts
export type MemberObservedState = 'running' | 'exited' | 'not-started';

export type MemberIssue =
    | 'executor-unavailable'     // capabilityState is 'unavailable'
    | 'capability-unknown'       // capabilityState is 'unknown' — no attestation, grants nothing
    | 'unresolved'               // instanceId appears in ResolvedFleet.missing
    | 'undeclared'               // a live process with no declared member
    | 'disabled';                // declared with enabled: false

export interface RosterEntry {
    instanceId: string;                       // === ResolvedFleetMember.instanceId, verbatim
    declared: ResolvedFleetMember | null;     // null for an undeclared live process
    observed: { status: MemberObservedState; pid: number | null; startedAt: string | null; exitCode: number | null };
    isOrchestrator: boolean;
    issues: readonly MemberIssue[];           // may be empty; never collapsed into one status
}

export function buildRoster(
    snapshot: ProjectFleetSnapshot,
    processes: ProcessStatus[],
): RosterEntry[];
```

`ResolvedFleetMember` (task 0835) and `OrchestratorBinding` (task 0836) are reused verbatim through
`ProjectFleetSnapshot` (task 0840); this task declares no new fleet type. `ProcessStatus` and its
runtime narrower `parseProcessList` are **imported from the existing**
`apps/web/src/modules/teams/MemberTerminal.tsx:7-20,22` rather than re-written.

**The join (`buildRoster`).** Pure, synchronous, and the unit under test.

1. Index `processes` by `agentId`.
2. For each `snapshot.members[i]`: `observed.status` is `'running'` when a matching process reports a
   running status, `'exited'` when it reports an exit, `'not-started'` when no process matches.
3. `isOrchestrator = snapshot.orchestrator.instanceId === member.instanceId`. When
   `orchestrator.state` is `missing` or `unresolvable`, **no** entry is marked — the roster never
   guesses which member would be the orchestrator.
4. `issues` accumulates, in this order: `disabled` (`enabled === false`), `executor-unavailable`
   (`capabilityState === 'unavailable'`), `capability-unknown` (`capabilityState === 'unknown'`),
   `unresolved` (`instanceId ∈ snapshot.capacity.missing`).
5. Any `processes` entry whose `agentId` matched no member is appended with `declared: null` and
   `issues: ['undeclared']`.
6. Sort: orchestrator first, then by `instanceId` ascending. Stable across polls.

`OPERATOR_AGENT_ID` (`board-operator`, task 0841) is a mailbox address, not a member; it never appears
in `snapshot.members`, and step 5 must exclude it so the operator's own mailbox is not rendered as an
undeclared agent.

**`executor-unavailable` vs offline (R5).** They are different facts with different next actions and
must never share a label:

| Condition | Label | Next action |
| --- | --- | --- |
| `capabilityState === 'unavailable'` | executor unavailable | the executor cannot run here — check the executor's install/attestation |
| `capabilityState === 'unknown'` | capability unknown | no attestation exists; it grants nothing and is not a failure |
| `observed.status !== 'running'`, no capability issue | not running | start it |
| `isOrchestrator` and `orchestrator.state === 'bound-offline'` | orchestrator offline | its claim is held but stale — see `project_claims` |

`'unknown'` renders as its own state, never as available and never as unavailable — task 0835 froze
that it grants nothing.

**Member detail (R3, R4).** A pane, not a route, opened from a card. It mounts existing components
only: `MemberTerminal` (`apps/web/src/modules/teams/MemberTerminal.tsx:66`,
`MemberTerminal({ agentId })`) for terminal and live status; the process facts already in
`RosterEntry.observed`; messages via `GET /api/messages/inbox?agent=<instanceId>`; activity via the
existing `/api/team/*` activity surface. Streaming uses `apps/web/src/lib/process-stream.ts` unchanged
— it already tracks `seq` rather than array index, which the ring buffer requires.

Focus contract: opening records the triggering card element; Escape and an explicit close both call
`.focus()` on that element before unmount. The pane traps nothing else — it is a panel, not a modal
dialog, and no focus trap is introduced.

**Lifecycle controls (R6).** The pane exposes exactly what the existing transports expose and nothing
more: start (`POST /api/team/agents/:id/start`), stop (`POST /api/team/agents/:id/stop`), and stdin
(`POST /api/team/processes/:id/stdin`). No restart, no bulk action, no fleet-wide control, no
strategy change. A control is disabled with its reason named when the entry carries
`executor-unavailable` or `unresolved`.

**Polling.** Reuse the existing `STATUS_POLL_MS = 3000` cadence from `MemberTerminal.tsx:16`; do not
introduce a second interval or a websocket. The fleet snapshot is refetched on the same tick as the
process list so the two facts in a card are never more than one tick apart.

**Test attributes.** `data-roster-entry="<instanceId>"`, `data-roster-declared`, `data-roster-observed`,
`data-roster-issue="<issue>"`, `data-member-detail`, `data-g6="open-member"` — the last one matches the
prototype's selector so 0845's ported tests need no rename.

**Anti-patterns — do not implement.**

- Do not collapse declared and observed into one status value, one badge, or one colour.
- Do not render `executor-unavailable` as offline, or `capability-unknown` as either available or
  unavailable.
- Do not add a new process, terminal, stream, or activity transport; all four already exist under
  `/api/team/*`.
- Do not invent lifecycle actions beyond start / stop / stdin.
- Do not re-declare `ResolvedFleetMember`, `ProcessStatus`, or `parseProcessList` in this module.
- Do not guess an orchestrator when the binding is `missing` or `unresolvable`.
- Do not show `board-operator` in the roster.
- Do not make the detail pane a focus-trapping modal or a route; Escape must restore focus to the
  card that opened it, not to the document body.
- Do not filter the roster by team; the scope is the project's fleet, and `teamId` on the process rows
  is display metadata only.

**Handoff.** 0843 reuses nothing from this task. 0844 renders `executor-unavailable` as a receipt
state using the same label text frozen above, so the two surfaces agree. 0845 asserts the Escape /
focus-restore contract and the icon-plus-text rendering of every `MemberIssue`.

### Plan

1. **(R1, R2)** Add `roster.ts` with `MemberObservedState`, `MemberIssue`, `RosterEntry`, and the pure
   `buildRoster(snapshot, processes)` implementing the six join steps.
   *Test:* declared-but-not-running, running-and-declared, exited, undeclared-process, and
   `board-operator`-excluded cases each produce the expected entry; ordering is orchestrator-first then
   `instanceId`-ascending and is stable across two identical calls.
2. **(R5)** Cover the issue resolver: `capabilityState` `'unavailable'` → `executor-unavailable`,
   `'unknown'` → `capability-unknown`, `enabled: false` → `disabled`, membership in
   `capacity.missing` → `unresolved`; multiple issues accumulate in the frozen order.
   *Test:* one case per branch plus one multi-issue entry.
3. **(R1)** Build `AgentsView.tsx`: fetch `GET /api/project/fleet` and `GET /api/team/processes` on
   one 3 s tick, narrow the process payload with the existing `parseProcessList`, render cards showing
   role, executor, capability, current work, and the orchestrator marker.
   *Test:* a malformed process payload skips the tick without clearing the roster.
4. **(R2)** Render declared and observed as two labeled facts per card with icon plus text.
   *Test:* a card whose member is `enabled: true` with `observed.status: 'not-started'` renders both
   facts and no single combined status element.
5. **(R3)** Build `MemberDetail.tsx` mounting `MemberTerminal`, the process facts, the member inbox
   read, and activity. *Test:* the pane renders for a selected `instanceId` and issues no new
   transport beyond the four existing ones.
6. **(R4)** Implement the focus contract: store the opener element, restore focus on Escape and on
   explicit close. *Test:* open from a card, press Escape, assert `document.activeElement` is that
   card.
7. **(R6)** Wire start / stop / stdin to the existing endpoints, disabled with a named reason when the
   entry carries `executor-unavailable` or `unresolved`. *Test:* the disabled control renders its
   reason text and issues no request.
8. **(R1)** Register the `agents` tab in `tabs.ts`. *Test:* `/board/projects/agents` renders the
   roster panel.
9. Run `cd apps/web && bun test`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Reference implementation: [projects prototype report](../reports/g6-projects-prototype.md) R3-1…R3-8 state cards
- Retained transports: `/api/team/*` process, terminal, stream
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5 declared-vs-observed state

### History
