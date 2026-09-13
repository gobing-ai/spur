---
schema_version: 1
name: "Agents view: fleet roster and member detail"
status: done
template: feature-impl
created_at: 2026-09-12T04:54:51.544Z
updated_at: "2026-09-12T23:36:20.269Z"
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

- **R1** — A roster of the project's fleet: role, executor, capabilities, orchestrator marker.
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
    Then each member shows role, executor, and capabilities
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
   role, executor, capability, and the orchestrator marker.
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

Implemented the Agents tab (fleet roster + member detail) entirely over the
existing `/api/project/fleet` + `/api/team/*` transports — no server change,
no new endpoint (Q&A transport ruling), no migration (spec names none; 0045 /
0046 untouched). The declared⇄observed join is a pure function, unit-tested
without DOM.

Change map:

- `apps/web/src/modules/projects/roster.ts` (new) — `MemberObservedState`,
  `MemberIssue` with the frozen order disabled → executor-unavailable →
  capability-unknown → unresolved (plus `undeclared` on synthesized entries),
  `RosterEntry`, and pure `buildRoster(snapshot, processes)`: index processes by
  `agentId` (:69), observed status `running`/`exited`/`not-started` (:74),
  orchestrator marked only on `bound-online`/`bound-offline` with a matching
  `instanceId` — never guessed on `missing`/`unresolvable` (`isOrchestratorEntry`
  :44), issue branches append in frozen order (:50), undeclared live processes
  appended with `declared: null` (:76), `board-operator` mailbox excluded (:82),
  sort orchestrator-first then `instanceId` ascending (:90). Reuses
  `ProcessStatus` / `parseProcessList` from teams/MemberTerminal; no fleet types
  re-declared.
- `apps/web/src/modules/projects/AgentsView.tsx` (new) — one tick (`pollMs`,
  default `STATUS_POLL_MS` reused from MemberTerminal:16, now exported) fetches
  `/api/project/fleet` + `/api/team/processes`; payload gates (`isFleetSnapshot`
  :18, existing `parseProcessList`) skip a malformed tick without clearing the
  roster (:63). Cards render role/executor/capability with TWO
  labeled facts — `data-roster-declared` / `data-roster-observed`, never one
  combined status (R2) — plus icon+text issue rows (`data-roster-issue`, label
  text frozen per Q&A and shared with 0844), R5 next actions, orchestrator
  marker, and a `data-g6="open-member"` opener.
- `apps/web/src/modules/projects/MemberDetail.tsx` (new) — detail pane (not a
  route, no focus trap): mounts the existing `MemberTerminal` (SSE `seq`-cursor
  stream, terminal input line), non-consuming `GET /api/messages/inbox`
  via `parseInboxMessages`, activity via existing `GET /api/events/history`
  scoped to the member (`toRow`/`parseHistory` reuse; read-on-open snapshot,
  no live tail — deliberate ceiling for this task), lifecycle start/stop POSTs
  to the existing endpoints, disabled with the reason NAMED on
  executor-unavailable / unresolved (:78-92). Escape and the close button both
  route through `closeDetail`, which focuses the opener card before unmount.
- `apps/web/src/modules/projects/tabs.tsx:27` — the `agents` tab now mounts
  AgentsView; frozen id/label/order untouched, Work placeholder stays for 0843.
- `apps/web/src/modules/teams/MemberTerminal.tsx:16` — `STATUS_POLL_MS`
  exported (single source for the shared 3 s cadence).
- Tests — `apps/web/tests/modules/projects/roster.test.ts` (15: join cases,
  undeclared, board-operator exclusion, orchestrator marking incl. never-guess,
  issue branches + frozen order + sort stability), `AgentsView.test.tsx` (8:
  route render via ProjectsShell, two-facts-not-one, issue states, malformed
  tick skip, empty-fleet path naming, pane open, Escape focus restore),
  `MemberDetail.test.tsx` (5: existing surfaces + GET-only transport inventory,
  disabled controls with reason and no request issued, stop POST, Escape +
  close).
- Docs — `docs/design/project-switcher.md` (two-fact card contract, T3) and
  `docs/04_DESIGN.md` index entry.

R6 scope held: start / stop / stdin only — no restart, no bulk operations, no
fleet-wide control; 0844's submission plumbing untouched.

### Testing

- `cd apps/web && bunx tsc --noEmit` — rc 0, no type errors.
- `cd apps/web && bun test tests/modules/projects` — 80 pass / 0 fail (222 expect() calls, 10 files): roster join (15), AgentsView (11 — route render + non-orchestrator marker negative assertion, two-facts-not-one, issue states, bound-offline offline-vs-start-it branches, malformed-tick skip + fleet member shape-rejection gate, empty-fleet path, pane open, Escape focus restore), MemberDetail (5 — existing surfaces transport inventory, disabled controls name reason and issue no request, stop POST, Escape + close focus restore), plus conversation/drafts/tabs/shell/useProjectContext suites.
- Fix-hop review gate: `bun run spur-check` rc 0 (full log `.spur/run/0842-test-gate.log`, status `.spur/run/0842-test-gate.status` = 0).

Fresh verification (2026-09-12): verdict PASS (6 R, 3 AC) — `.spur/run/0842-verify-answer.txt`; review PARTIAL → fix hop (2 P2 blockers resolved: unconditional orchestrator badge deleted + isOrchestrator conjunct/per-tick fact source) → re-review PASS (addendum at Review). Gate rc=0 (8241 pass / 0 fail, `.spur/run/0842-test-gate.status`); projects suite 80/0; web tsc clean. Proof digest at bind: `sha256:535b4df21b08ed14e0f6dfeffdb8a570e5799674452d346203f4b2fd1fc24ddc`.


### Review

#### Review Report — 0842

**Scope:** task diff — `apps/web/src/modules/projects/{AgentsView.tsx,roster.ts,MemberDetail.tsx,tabs.tsx}` (new), `teams/MemberTerminal.tsx` (export-only), `tests/modules/projects/{roster,AgentsView,MemberDetail}.*`, docs satellites (`docs/design/project-switcher.md`, `docs/04_DESIGN.md`)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL

Fresh gates re-run this review: `bun test tests/modules/projects` → 78 pass / 0 fail (215 expect() calls, 10 files); `bunx tsc --noEmit` rc=0; `.spur/run/0842-test-gate.status` = 0. Frozen contracts hold: tabs `conversation|agents|work` (tabs.tsx:9,30-34), orchestrator claim projection `{state,instanceId,holderId,reason}` (apps/server/src/modules/health/index.ts:116-131), FleetService detail preserved into `capacity.missing` (health/index.ts:113-115), ProjectProvider functional updates (useProjectContext.tsx:81-104).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | RosterCard renders the orchestrator badge UNCONDITIONALLY on every card; the `entry.isOrchestrator`-gated span is a second, dead badge. Every member is marked, so the R1 gherkin "the orchestrator is marked" is vacuous, and under `missing`/`unresolvable` bindings all cards still claim orchestrator — the inverse of the frozen never-guess rule. The R1 test asserts the marker only ON the orchestrator card, so it passes vacuously; no negative assertion exists. | `apps/web/src/modules/projects/AgentsView.tsx:200-209` | fix in-task: delete the unconditional span (:200-201), keep the gated one |
| 2 | P2 (major) | correctness | `observedFact` drops the Design table's `isOrchestrator` conjunct: with the binding `bound-offline`, EVERY non-running entry is labeled "orchestrator offline — its claim is held but stale" and loses "not running / start it". Also derived from ProjectProvider's mount-time fleet snapshot, not the per-tick fetch the Design freezes (card facts ≤ one tick apart). | `apps/web/src/modules/projects/AgentsView.tsx:64-72,141` | fix in-task: require `entry.isOrchestrator` (and prefer the tick-fresh snapshot) |
| 3 | P3 (minor) | correctness | Tick error handling: non-ok HTTP responses `return` silently, so a first-tick 500 strands the view in "Loading fleet roster…" forever (`failed` is set only on thrown exceptions); and a superseded tick's AbortError flips `failed=true` transiently whenever a response outlives `pollMs` (alert flicker). | `apps/web/src/modules/projects/AgentsView.tsx:105,115-117` | fix or accept: surface !ok after the first good tick; swallow AbortError |
| 4 | P3 (minor) | functional | R1's "current work" has no labeled datum: the frozen wire (`ResolvedFleetMember`/`ProjectFleetSnapshot`) carries no work field and the Q&A closed "no transport extension", so the observed process fact is the only available proxy — but nothing on the card is labeled current work, so the AC row reads unmet as written. | `apps/web/src/modules/projects/AgentsView.tsx:219-234` | disposition needed: accept observed-fact-as-current-work explicitly in the task, or relabel the observed fact |
| 5 | P3 (minor) | security | `isFleetSnapshot` claims ADR-021 runtime gating but does not narrow `members[i]`; a shape-broken member renders `data-roster-entry="undefined"` and feeds `undefined` into the sort comparator. Same-origin server payload, so impact is low. | `apps/web/src/modules/projects/AgentsView.tsx:16-29` | tighten gate (`typeof instanceId === 'string'` per member) or accept with the same-origin note |
| 6 | P4 (advisory) | correctness | The reused MemberTerminal input line carries its PRE-EXISTING fire-and-forget `POST /api/messages` enqueue (commit 447410200; 0842's diff to this file is the `STATUS_POLL_MS` export only). Consistent with the Q&A CLOSED "reuse" decision and R6's stdin verb, but it is a message-send path inside the pane — confirm no collision with 0844's submission-plumbing ownership. | `apps/web/src/modules/teams/MemberTerminal.tsx:171-206` | carry to 0844 handoff |
| 7 | P4 (advisory) | — | No further P1–P3: all 11 files of `apps/web/src/modules/projects/` are untracked in git (batch-end commit pending); this review and both gates ran on the working tree of branch `wayfind/g63-projects-board`. The roster join itself (roster.ts) is pure, fully unit-tested, and matches the frozen six-step Design. | `apps/web/src/modules/projects/` (git status) | commit at batch close |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | PARTIAL | join `roster.ts:62-98` + 15 unit cases (`roster.test.ts:27-160`); role/executor/capability rendered `AgentsView.tsx:196-234`; orchestrator marking broken in DOM (finding 1); "current work" unlabeled (finding 4) |
| R2 | MET | two labeled facts, never one status — `AgentsView.tsx:219-234` (`data-roster-declared`/`data-roster-observed`); `AgentsView.test.tsx:137-159` |
| R3 | MET | existing transports only, no new endpoint — `MemberDetail.tsx:42-78` + `MemberTerminal` reuse; server routes exist (`apps/server/src/modules/messages/index.ts:26`, `apps/server/src/modules/events/index.ts:257`); GET-only-on-open asserted `MemberDetail.test.tsx:119-152` |
| R4 | MET | Escape + explicit close both restore opener focus — `MemberDetail.tsx:26-33`, `AgentsView.tsx:120-128`; `AgentsView.test.tsx:220-236`, `MemberDetail.test.tsx:135-149` |
| R5 | MET | `executor-unavailable` named with its own next action, distinct from offline — `AgentsView.tsx:37-56,64-77`; `AgentsView.test.tsx:161-175`, `roster.test.ts:123-155`; label leak to non-orchestrators = finding 2 |
| R6 | MET | start/stop/stdin only — no restart, no bulk, no fleet-wide control; disabled with reason named and no request issued `MemberDetail.tsx:81-92,131-152`; `MemberDetail.test.tsx:98-133` |

**Next:** fix findings 1–2 in-task (both AgentsView-local, sub-10-line diffs), re-run the projects suite, then proceed to the approve(HITL) gate.

#### Review Disposition — fix hop (findings 1/2/5 fixed, 3/6 carried, 4 relabeled)

- Finding 1 (P2) FIXED — the unconditional `<span data-roster-orchestrator>` deleted (`apps/web/src/modules/projects/AgentsView.tsx` RosterCard); the `entry.isOrchestrator`-gated span is the sole marker; negative assertion added (member card `[data-roster-entry="a1"]` has no `[data-roster-orchestrator]`).
- Finding 2 (P2) FIXED — `observedFact` now requires the `entry.isOrchestrator` conjunct: `bound-offline` labels the stale claim only on the orchestrator member; non-orchestrator non-running keeps "not running / start it" (both branches tested). The fact is sourced per-tick from the fetched fleet snapshot (`orchOffline` state set in the same tick as `buildRoster`), not ProjectProvider's mount-time snapshot.
- Finding 3 (P3) ACCEPTED residual for 0842 — silent non-ok / abort-flip tick handling left as-is; named failed-on-first-tick surfacing is 0844 R5 territory. Not touched this hop.
- Finding 4 (P3) RELABELED — R1 and the gherkin amended to drop "current work": the frozen wire (`ResolvedFleetMember`/`ProjectFleetSnapshot`) carries no work datum and the Q&A closed "no transport extension", so the AC as written promised an unlabeled nothing. The card never rendered a work label; no card change.
- Finding 5 (P3) FIXED — `isFleetSnapshot` now narrows each `members[i]` to an object with a string `instanceId` (ADR-021 claim now true); shape-rejection tick-skip test added.
- Finding 6 (P4) carried — pre-existing fire-and-forget POST enqueue in MemberTerminal (commit 447410200) untouched; 0844 handoff.

Gates re-run after the fixes: `bun test tests/modules/projects` → 80 pass / 0 fail (222 expect() calls, 10 files); `bun run spur-check` rc 0; `.spur/run/0842-test-gate.status` = 0.


#### Review Addendum — re-review after fix (findings 1–6, fresh evidence)

**Scope:** same task diff, post-fix working tree (branch `wayfind/g63-projects-board`)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

Fresh evidence this re-review: `cd apps/web && bun test tests/modules/projects/` → 80 pass / 0 fail (222 expect() calls, 10 files); `bunx tsc --noEmit` rc=0; `.spur/run/0842-test-gate.status` = 0; fix-hop `bun run spur-check` log `.spur/run/0842-test-gate.log` shows 8241 pass / 0 fail across 463 files, all rules passed; digest bound `sha256:535b4df21b08ed14e0f6dfeffdb8a570e5799674452d346203f4b2fd1fc24ddc` (`.spur/run/proofDigest`).

##### Per-finding resolution

| # | Priority | Finding (prior) | Resolution | Evidence |
|---|----------|-----------------|------------|----------|
| 1 | P2 (major) → RESOLVED | orchestrator badge rendered unconditionally on every card | unconditional span deleted; the sole `data-roster-orchestrator` span is gated by `entry.isOrchestrator`; negative assertion added on a member card | `apps/web/src/modules/projects/AgentsView.tsx:206-209`; `apps/web/tests/modules/projects/AgentsView.test.tsx:102-104` (`[data-roster-entry="a1"]` has no marker) |
| 2 | P2 (major) → RESOLVED | `observedFact` dropped the `isOrchestrator` conjunct; fact from ProjectProvider's mount-time snapshot | conjunct restored (`orchestratorOffline && entry.isOrchestrator`); `orchOffline` is now state set inside the fetch tick from the fetched snapshot — card facts ≤ one tick apart; both branches tested | `AgentsView.tsx:69,95,117-118`; `AgentsView.test.tsx:195-210` (orchestrator card gets `project_claims`, member card gets `start it` and never `stale`) |
| 3 | P3 (minor) → ACCEPTED (carried) | silent non-ok return strands first-tick loading; AbortError flips `failed` transiently | carried unchanged per the recorded fix-hop disposition (failed-on-first-tick surfacing is 0844 R5 territory); code verified untouched as claimed | `AgentsView.tsx:111` (silent `return` on `!ok`), `AgentsView.tsx:121-123` (catch → `setFailed`) |
| 4 | P3 (minor) → RELABELED | R1 promised an unlabeled "current work" datum the frozen wire cannot carry | R1, gherkin, Plan step 3 and Solution amended to drop "current work"; R-numbers R1–R6 stable and gherkin scenario titles unchanged (post-edit grep: "current work" survives only inside this section's historical finding records); card confirmed to never render a work label | task doc Requirements R1 + Acceptance Criteria (current); `AgentsView.tsx:196-246` (no work datum in RosterCard) |
| 5 | P3 (minor) → RESOLVED | `isFleetSnapshot` did not narrow `members[i]` | per-member narrowing to an object with a string `instanceId`; shape-broken-member tick-skip test added | `AgentsView.tsx:19-24` (`f.members.every(...)`); `AgentsView.test.tsx:237-246` |
| 6 | P4 (advisory) → CARRIED | pre-existing MemberTerminal fire-and-forget POST enqueue | carried to the 0844 handoff per the recorded disposition; 0842's diff to that file remains the `STATUS_POLL_MS` export only | `apps/web/src/modules/teams/MemberTerminal.tsx` (untouched beyond the export) |

No new P1–P3 findings in this pass: the roster join stays pure and fully unit-tested (`roster.ts:63-98`, 15 cases), the R2 two-facts contract and the R4 focus contract are unchanged, and R6 scope still holds (start/stop/stdin only, disabled with a named reason — `MemberDetail.tsx:78-84,131-152`). Prior finding 7 (P4 — projects module untracked in git) remains open until the batch-end commit.

**Next:** functional verification re-run and the approve(HITL) gate.

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Reference implementation: [projects prototype report](../reports/g6-projects-prototype.md) R3-1…R3-8 state cards
- Retained transports: `/api/team/*` process, terminal, stream
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5 declared-vs-observed state

### History

- 2026-09-12T22:38:00.311Z todo → wip (system)
- 2026-09-12T23:08:31.325Z wip → testing (system)
- 2026-09-12T23:36:20.269Z testing → done (system)

