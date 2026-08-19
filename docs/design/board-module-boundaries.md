---
doc: design/board-module-boundaries
feature_id: I6
owns: SURFACE + mechanism — responsibility boundary across Workspace / Inbox / Teams board modules
authority: derived (ADR wins on conflict)
updated_at: 2026-08-19
---

# Board module boundaries — Workspace / Inbox / Teams under the agent-role mechanism

This doc answers one question: after `spur agent run` roles (M4/M5, both `done`) landed, what are
Workspace, Inbox, and Teams each *for*, and which should still exist. It is a boundary
specification, not a UI plan — no React ships and no files move from this ticket. It supersedes the
per-module ownership fragments in `workspace-design.md` and `inbox-board-module.md` by naming the
one genuine overlap and its disposition, and leaves those docs intact as their module's detail.

## 1. What the feature history already decided (R4)

Do not re-decide these; this ticket builds on them.

| Feature | Already answered | Citation |
| --- | --- | --- |
| M | Teams is a capstone over existing message/drain/supervisor/executor backbones; DD-4 = new Teams module, migrate Inbox/Process tabs out of Observability, Observability stays system-wide telemetry | `docs/features/M_….md` § "Anchored decisions" DD-4 |
| M1 | Roster tab dropped; Terminal owns team/member selection; Processes = watch list; Messages unfiltered (temporary). Open fog explicitly deferred: "interaction model with the emerging Workspace module (G3)" | `docs/features/M1_….md` § "Not yet specified" |
| M2 | `useTeamsData` extracted to dedupe `/api/team/teams` polling across Terminal/Processes | `docs/features/M2_….md` AC (0268) |
| M3 | Terminal = sole control surface; Process = read-only system watch list; Message/Activity = global identity-rich timelines | `docs/features/M3_….md` § D1–D6 |
| M4 | **D1 Placement** — new `inbox/` module owns the *whole* message plane; Teams drops its Message tab; orphaned `observability/InboxTab.tsx` deleted. Teams reduced to process lifecycle | `docs/features/M4_….md` § "Decisions so far" D1 |
| M5 | A member = **role + executor**; either half optional; role is the primary declared axis; role is **not** an address (multiplicity — two members may share a role) | `docs/features/M5_….md` § Scope + Notes |

Net: the message-plane split (Inbox) and the process-plane ownership (Teams) are **already settled
by M4 D1**. The only surface those features left unassigned is Workspace (M1's open fog), which
`workspace-design.md` later answered as "a team-scoped composition lens" (ADR-052). This ticket's
remaining work is to verify that answer against the code and remove the residual overlap.

## 2. One sentence per module (R1)

- **Workspace** is a read-only composition *lens*: it pins one project-local team (`isCurrentProject`)
  and re-renders the scoped Team, Inbox, and Tasks views under that `teamId`, owning selection and
  scope only.
- **Inbox** is the durable **message plane**: the queue of operator/supervisor/agent messages with
  delivery state (`queued`→`injected`) and reply state, viewed as All / Supervisor-filtered /
  per-agent slices.
- **Teams** is the **process-and-control plane**: roster identity, start/stop/up/down, terminal
  stdin/stdout/stderr, the process watch list, and lifecycle activity.

**Finding (R1):** the three sentences are non-overlapping, but only because Workspace owns *no data*.
Workspace is not a peer of the other two — it is a navigation lens over them. A boundary that needs
"composition" to keep Workspace distinct is the finding the handoff predicted: Workspace survives as
a lens or not at all; it has no independent domain to defend.

## 3. Overlap evidence (R2)

### 3.1 The two `SupervisorTab`s are a name collision, not duplication or delegation

- `apps/web/src/modules/inbox/SupervisorTab.tsx` (**50 lines**) is a **message-plane filter**: it
  imports `filterMessagesByTeam, MessageFeedList, useMessageFeed` (`SupervisorTab.tsx:1`), defines
  `SUPERVISOR_ENDPOINT_ID = 'supervisor'` (`SupervisorTab.tsx:10`), and keeps rows where
  `row.fromId === SUPERVISOR_ENDPOINT_ID || row.toId === SUPERVISOR_ENDPOINT_ID`
  (`SupervisorTab.tsx:13-14`). No roster, no controls, no process stream.
- `apps/web/src/modules/teams/SupervisorTab.tsx` (**502 lines**) is the **operational roster/control
  landing view**: it reads `useTeamsData()` (`SupervisorTab.tsx:94`), renders team cards with Up/Down
  (`SupervisorTab.tsx:172`, `:201`), per-member status/type/role/uptime/last-activity rows
  (`SupervisorTab.tsx:307-374`), and confirm modals (`SupervisorTab.tsx:422`, `:462`).

Verdict: **same label, disjoint responsibilities** — no delegation (inbox does not call teams) and no
duplication of *function* (inbox filters messages; teams controls processes). The overlap is the
shared *name* `Supervisor`, which re-encodes the M4/M5 identity gap: "supervisor" is a message-plane
endpoint in Inbox but a process manager in Teams. That is a naming defect, not a module duplication,
and the fix is renaming (see §5), not merging.

### 3.2 Shared data source: `useTeamsData` (one feed, six consumers)

`apps/web/src/lib/use-teams-data.ts:92` is the neutral `GET /api/team/teams` poller. Its own header
says it was "Moved out of the Teams module so Teams, Inbox, and Workspace consume the same feed"
(`use-teams-data.ts:81-82`). Consumers:

- `workspace/WorkspaceShell.tsx:16` — `const { teams } = useTeamsData()`
- `workspace/OverviewTab.tsx:22` — `const { teams } = useTeamsData()`
- `inbox/InboxShell.tsx:38` — `const { teams } = useTeamsData()`
- `teams/SupervisorTab.tsx:94` — `const { teams, error, reload } = useTeamsData()`
- `teams/TerminalTab.tsx:75` — `const { teams, error, reload: load } = useTeamsData()`
- `teams/ActivityTab.tsx:144` — `const { teams } = useTeamsData()`

This is the *correct* shared seam (M2 0268), not an overlap to remove. It is cited to show the three
modules already agree on a single roster source.

### 3.3 Duplicated render: member roster rows in Workspace Overview vs Teams Supervisor

Both render a per-member list of `{status}` badge + `{id}` + `{type}` badge from the same feed:

- `workspace/OverviewTab.tsx:65-76` — `team.members.map((m) => … <Badge>{m.status}</Badge> …
  <span>{m.id}</span> … <Badge>{m.type}</Badge>`
- `teams/SupervisorTab.tsx:307-335` — `team.members.map((member) => … <Badge>{member.status}</Badge> …
  <span>{member.id}</span> … <Badge>{member.type}</Badge> … {member.role ?? 'unset'}`

Teams' version is a **superset**: it also renders role (`SupervisorTab.tsx:329-335`), uptime, and
last-activity. Workspace's Overview row is the duplicated subset — and, because M5 added role, it is
now *stale* relative to Teams (Overview renders no `role`, so a Workspace reader sees an incomplete
roster). This is the one true duplication and the only overlap that warrants a code change.

### 3.4 Duplicated control + modal code inside Teams (intra-module, cited for the merge plan)

Within Teams, the start/stop/up/down URL builders and the two confirm modals are copied between two
tabs, with the copy sites labeled:

- `teams/SupervisorTab.tsx:16-20` — comment "mirror TerminalTab.tsx:11-15"; identical
  `startUrl/stopUrl/teamUpUrl/teamDownUrl` at `teams/TerminalTab.tsx:11-15`.
- `teams/SupervisorTab.tsx:422` — "mirrors TerminalTab.tsx:336-373" (Stop modal);
  `teams/SupervisorTab.tsx:462` — "mirrors TerminalTab.tsx:375-411" (Down modal).
- `formatTime` is declared twice: `workspace/OverviewTab.tsx:5` and `teams/SupervisorTab.tsx:45`.

These are intra-Teams / Workspace-Teams duplication, not cross-module duplication. They inform the
migration cost in §5 (extract one control/modal helper) rather than a module merge.

### 3.5 No cross-module process/message leak (negative evidence)

- `apps/web/src/lib/process-stream.ts` (frame parse/append/backoff) is now consumed only by Teams —
  the header notes "Shared by the Teams member terminal and the Inbox agent timeline (0422 R9)" is
  historical; task 0197 removed Inbox's frame streaming, and `inbox-board-module.md` §5/§9 records
  Inbox renders no stdout/stderr.
- Inbox's `AgentTab` opens no `EventSource` and renders no frames (`inbox/AgentTab.tsx` header: "It
  opens no process `EventSource` and renders no stdout/stderr rows — Teams exclusively owns the
  process plane").

So the durable-message channel and the process-pipe channel are already cleanly separated across
modules. The remaining overlaps are: (1) the shared `Supervisor` name, (2) the Workspace Overview
roster duplicate, (3) intra-Teams control/modal duplication.

## 4. Role-mechanism impact (R3)

`spur agent run --agent <role|executor|binary|auto|inline>` accepts a role as a first-class value
(`apps/cli/src/commands/agent.ts:56`), validated before spawn by `validateAgentSelector`
(`agent.ts:167-181`). M5 then made `role` the primary declared axis of a roster member
(`docs/features/M5_….md` § Goal), with `purpose` demoted to annotation and `executor` optional.

- **Redundant (module-level): nothing.** Roles did not collapse any of the three modules; each still
  owns its plane. The role mechanism is a *content* change to the roster, not a *structural* change
  to the board.
- **Newly necessary:** every surface that renders a member must now show `role` (else it shows a
  stale roster). Teams Supervisor did this (`teams/SupervisorTab.tsx:329-335`, via
  `use-teams-data.ts:17-18`). Workspace Overview did **not** — that omission is the concrete way the
  role mechanism invalidated the Workspace Overview tab.
- **M5 "a member is a role plus an executor" implication for the other two modules:** Inbox is
  unaffected — its per-agent tabs are addressed by member *id*, and M5 explicitly ruled that role is
  not an address (multiplicity, `agent-service.ts:1341-1343`). Workspace's Overview is affected and
  becomes redundant: the only identity a roster needs (role + executor + status) is already rendered
  in Teams, so Workspace's role-less roster copy is now both duplicate and incomplete.

## 5. Dispositions, Teams-absorbs-both evaluation, target IA (R5)

### 5.1 Teams-absorbs-both hypothesis — **rejected**

- **Teams absorbs Inbox — reject.** M4 D1 already split them, and the two channels are distinct:
  durable queue (`GET /api/messages`, `status: queued→injected`) vs process pipe
  (`GET /api/team/processes/:id/stream` SSE + stdin). Merging would re-create the "messages shown in
  three places" problem M4 explicitly removed and re-couple Teams' process plane to the message
  plane.
- **Teams absorbs Workspace — reject, with one partial merge.** Folding Workspace into Teams would
  require Teams to add a Tasks (Kanban) tab and an Inbox tab to compose a project-local view — i.e.
  re-couple Teams to the message and task planes it is deliberately decoupled from. Workspace's
  composition *lens* is the right home for cross-plane project scoping (ADR-052). The only thing
  worth merging into Teams is Workspace's **OverviewTab content**, because that is a pure roster
  duplicate (§3.3).

### 5.2 Dispositions

| Module | Disposition | Reason | Migration cost |
| --- | --- | --- | --- |
| Teams | **keep** | Owns the process/control/roster plane; only module with real domain depth (1,931 lines); M5 role axis lives here | None. Fold Workspace Overview's two unique fields (`workDir`, `model`) into the Teams Supervisor team header / member row |
| Inbox | **keep** | Owns the durable message plane; M4 D1 deliberately split it from Teams; no process-stream dependency | None |
| Workspace | **keep as lens; delete its `OverviewTab`** | Owns selection + scope only (composition). Its Overview is a stale, role-less subset of Teams Supervisor (§3.3). The module survives because scoped Team/Inbox/Tasks composition is still a distinct, non-overlapping value | Trivial: delete `workspace/OverviewTab.tsx` (91 lines) + its `WORKSPACE_TABS` entry; fold `workDir`/`model` into Teams Supervisor; update Workspace tests |

### 5.3 Target information architecture

- **Nav entries (unchanged set, clarified purpose):** `Workspace` (project-local lens), `Inbox`
  (message plane), `Teams` (process/control plane), plus Observability (system-wide telemetry) and
  the task/feature Kanban modules. No module is added or removed at the nav level.
- **Workspace tabs:** `Team` (scoped Teams), `Inbox` (scoped Inbox), `Tasks` (scoped Kanban).
  `Overview` is removed (its content lives in scoped Teams Supervisor).
- **Inbox tabs:** `All` → `Supervisor` (message filter) → per-agent member slices (unchanged; M4).
- **Teams tabs:** `Supervisor` (roster + controls + activity) → `Terminal` → `Process` → `Activity`
  (unchanged; M3). Rename the *Inbox* `Supervisor` tab to `Supervisor traffic` (or similar) to kill
  the §3.1 name collision — the Inbox tab filters supervisor-*endpoint messages, the Teams tab
  supervises *processes*; one label for two planes is the defect.

## 6. `role` CLI noun recommendation (R6)

**Recommend: do not add a `role` noun. Keep role as a value under the existing `agent` noun.**

Reasoning, against ADR-051's rule that "a new first-layer noun is justified only when no existing
noun can host the action":

- Role is already a first-class *value* in `spur agent run --agent <role>` (`agent.ts:56`,
  `agent.ts:167-181`) and a column in `spur agent list --specs` (`agent.ts:216-223`). There is no
  *action* on a role that an `agent` verb cannot host.
- The role vocabulary is config (`DEFAULT_AGENT_ROLES`, `packages/config/src/index.ts`; human view
  `plugins/sp/references/roles.md`), not a mutable corpus. A `role` noun would expose
  list/inspect-only verbs with no mutation — a "data-entry noun" with a one-gate verb set, the exact
  anti-pattern ADR-051 names (`docs/00_ADR.md:449-455`).
- Roles are not addressable (M5: two members may share a role), so a `role` noun cannot be the
  target of run/stop/attach — those stay on `agent`/`team`.

If a machine-readable role inventory is ever needed, the host is `spur agent roles` (a new **verb**
on the existing noun), not a new noun — and that too is ADR-051-gated. This ticket recommends only;
no CLI surface change is made.

## 7. Cross-references (reconciled, not forked)

- `docs/design/workspace-design.md` — Workspace = team-scoped composition (ADR-052); this doc narrows
  it by removing Overview and naming the roster overlap.
- `docs/design/inbox-board-module.md` — Inbox message-plane contract; this doc confirms its §9 G3
  boundary holds post-role.
- `docs/design/dev-spine-cost-and-drift.md`, `event-tracking.md`, `run-record-contract.md` — prior I6
  docs; no boundary is re-decided here, only the board-module ownership fragment.
- `docs/features/M…M5` — settled decisions tabulated in §1.
