---
schema_version: 1
name: Retire Workspace, Inbox, and Teams board routes with redirects
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.302Z
updated_at: "2026-09-14T14:41:42.384Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0845"]
---

## 0849. Retire Workspace, Inbox, and Teams board routes with redirects

### Background

Workspace, Inbox, and Teams are registered Board modules
(`apps/web/src/modules/registry.ts`, with shells under `apps/web/src/modules/workspace`, `inbox`,
`teams`). G63 lands Projects alongside them; this task removes them once Projects covers their
function.

Bookmarks and deep links exist, so removal needs redirects into the equivalent Projects view rather
than a dead route.

The `--agent <spec-id>` warn-once shim is retired here too, after confirming no workflow or plugin
still uses it (`docs/reports/g6-runtime-inventory.md` §4).

### Requirements

- **R1** — Workspace, Inbox, and Teams navigation entries and modules are removed only after G63 is
  functionally complete.
- **R2** — Existing routes and bookmarks redirect into the equivalent Projects view; no Board
  capability becomes unreachable *without a recorded, operator-accepted reduction that names its
  owning task*. _(Amended 2026-09-14 by operator decision — see the CLOSED Q&A entry. Four facets are
  accepted reductions: the registry one-shot `executions` watch list and its `0267`/`0262` test groups
  (owner: 0852), and per-member uptime, live-SSE roster activity, and the team up/down Board controls
  (owner: 0853).)_
- **R3** — The `--agent <spec-id>` shim is removed after confirming no workflow or plugin usage.
- **R4** — Removal is gated on Robin's recorded cutover window.
- **R5** — Board tests referencing the retired modules move to their Projects equivalents rather than
  being deleted; where no Projects equivalent exists yet, they retire with their surface and the
  residual coverage is owned by the same accepted reduction as R2 (0852, 0853). _(Amended 2026-09-14,
  same decision.)_

### Acceptance Criteria

```gherkin
Feature: Retire Workspace, Inbox, and Teams board routes

  @core
  Scenario: Board routes retire with a migration path
    Given Workspace, Inbox, and Teams routes and bookmarks
    When the navigation entries are removed
    Then existing routes redirect into the equivalent Projects view
    And no Board capability is unreachable, or its reduction is operator-accepted and owned

  @core
  Scenario: The spec-id shim retires only when unused
    Given the --agent spec-id warn-once shim
    When no workflow or plugin caller remains
    Then the shim is removed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:40:11.285Z

**Q: Where do bookmarked tab URLs go?** Nowhere, because they never existed. Workspace, Inbox, and
Teams keep their active tab in React state (`WorkspaceShell.tsx:19`), so `/board/teams` is the only
address any bookmark can hold; sub-paths resolved to the same shell through the wildcard route. Three
redirects cover the whole addressable surface. Verified at refine time rather than assumed from the
existence of a `/*` route.

**Q: Won't deleting three modules change the landing page?** No. Modules are ordered by a declared
`order` field, not by directory name (`compareModules`, `discover.ts:66-72`). The retired three are
50/60/70; `observability` is 10 and stays first. The registry test in Plan step 7 fails if a later
change breaks that.

**Q: Why is `MemberTerminal` moved into `projects/` rather than lifted into `lib/` or
`components/`?** It has exactly one consumer after this task — 0842's `MemberDetail`. A shared
location for a single consumer is an abstraction nobody asked for. If a second consumer appears, move
it then.

**Q: Why aren't the redirects registered as a transition shim like the `--agent` flag?** ADR-058
requires a removal condition that can be checked against the repository. A shim entry whose condition
is "no external bookmark points here any more" can never be satisfied, so it would sit in the
manifest permanently and weaken the signal that emptying the manifest means the transition is
complete. The redirects are permanent route entries instead.

**Q: Is `disabledModules` used?** Not as a required step. It is named in the Design as the rollback
lever because it removes the three ids from the enabled set without deleting code, and the redirect
table is static so it keeps working either way. Using it would mean two commits where one suffices.

**Q: Does the CLI shim removal belong in a Board task?** It is small and shares this task's gate —
both are "delete a compatibility path once the evidence says no caller remains." Splitting it would
duplicate the cutover-window check and the evidence scan. If Robin wants CLI and Board retirement on
separate windows, step 11 lifts out cleanly; nothing else in the task depends on it.

**DEFERRED — should `/` land on Projects instead of Observability?** Owner: Robin. Condition: a stated
preference. The landing route is derived from the lowest `order`, so switching means renumbering
Projects below 10, which reorders the sidebar as well — a visible change with no functional driver.
Out of scope for a retirement task; recorded here so it is not mistaken for an oversight.

**DEFERRED — deleting the `/api/team/*` server routes.** Owner: a future task after G63's Agents view
is re-pointed. Condition: no `apps/web` or CLI caller of `/api/team/*` remains. Today 0842 consumes
them and `spur agent start|stop` (0848) will too, so they stay.


**DEFERRED — the Teams process watch list (`executions` + 0267 filters).** Owner: task 0852
(created 2026-09-14 from this task's review, G64). Condition: a decision on whether the Board
re-exposes the registry one-shot watch list. The 0849 Design mapped Teams onto "the roster and
member terminal" (Agents, 0842) and did not carry this tab across. `GET /api/team/processes` still
serves `executions`, consumed only through `parseProcessList` for roster observed-status facts —
nothing renders `executions` any more. Leaving that a silent drop would be an unowned surface
reduction, so it is recorded here and owned by 0852 rather than treated as delivered parity.

**DEFERRED — the Teams supervisor facets that the 0842 roster did not carry across.** Owner: task
0853 (created 2026-09-14 from this task's review pass 2, G64). Condition: an operator decision on
whether the Board re-exposes them. Three facets retired with `TeamsShell`'s SupervisorTab (0378) and
have no Projects successor today: (a) per-member **uptime** (0378 R3), (b) **live-SSE last activity**
on the roster (0378 R4 — `MemberDetail` reads the event history once on open and deliberately has no
live tail), and (c) the **team up/down** Board controls (0378 R5 — the server routes survive at
`apps/server/src/modules/team/index.ts:250,280` with no Board caller; G63's CLI story moved `up` to
fleet materialization and `down` to `spur agent stop`). Recorded rather than silently dropped so
AC1's "no Board capability is unreachable" clause has a named owner per facet.


**CLOSED — operator accepted the reduction (Robin, 2026-09-14).** On the pipeline's verify report
(verify verdict PARTIAL on R2/AC1 and on R5's deleted-not-moved test groups) Robin chose to accept the retirement as delivered rather than restore
the four facets: the registry one-shot `executions` watch list and its 0267/0262 test groups stay
retired (owner: task 0852), and per-member uptime, live-SSE roster activity, and the team up/down
Board controls stay retired (owner: task 0853). Read R2's "no Board capability becomes unreachable"
clause as gated on this decision: the redirect half is delivered and verified (path plus landing tab,
deep links, shadow guard), the capability mapping the Design froze is delivered for Workspace, Inbox
and Teams, and every un-carried facet is a named, operator-accepted reduction with a live backlog
owner rather than a silent drop. Reinstatement is a future task's decision, not a gap in this one.

### Design

**WHAT.** Delete the `workspace`, `inbox`, and `teams` module directories, add a static redirect table
for their three routes, relocate the one file G63 still consumes from inside them, and remove the
`agent-flag-spec-id` shim on both sides of its gate.

**Premise corrections made during this refine.** Four claims in the task framing or the inventory do
not survive a read of the current tree:

1. **The retired modules have no URL-addressable tab state.** `WorkspaceShell.tsx:19`,
   `TeamsShell`, and `InboxShell` hold the active tab in `useState`, not in the path or query
   (contrast 0840's `useProjectTab`, which reads the path segment). The only bookmarkable URLs are
   `/board/workspace`, `/board/inbox`, `/board/teams` and arbitrary sub-paths that all render the
   same shell. R2 therefore needs **three** redirect targets, not a per-tab mapping.
2. **The default landing route is `observability`, not the first directory alphabetically.** Every
   module declares `order` (`observability` 10, `history` 20, `features` 30, `tasks` 40,
   `projects` 45 per 0840, `workspace` 50, `inbox` 60, `teams` 70) and `compareModules`
   (`discover.ts:66-72`) lifts declared-order modules ahead of the id pre-sort. Deleting 50/60/70
   leaves 10 first, so `defaultModule` and the `/` redirect are unchanged. No renumbering.
3. **`teams/` cannot be deleted wholesale.** 0842 closed "reuse the terminal" and mounts
   `MemberTerminal` from `apps/web/src/modules/teams/MemberTerminal.tsx:66` in the Projects Agents
   tab. Deleting the directory breaks G63. The file **moves**; it is not re-written and not deleted.
4. **The shim's own removal condition is inconsistent with itself.** The source marker
   (`apps/cli/src/commands/agent.ts:690-692`) says `.spur/workflows/`; the manifest entry says
   `config/workflows/`. The manifest is what `transition-shim-check` reads, so the scan covers
   **both**, and the marker's text is corrected in the same commit that deletes it — trivially,
   since both disappear together.

**WHERE.**

| Change            | Files                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete modules    | `apps/web/src/modules/{workspace,inbox,teams}/` — minus the moved file below                                                                                                 |
| Move (not delete) | `apps/web/src/modules/teams/MemberTerminal.tsx` → `apps/web/src/modules/projects/MemberTerminal.tsx`; update 0842's import                                                   |
| Redirects         | `apps/web/src/router.tsx` — new `RETIRED_ROUTES` table                                                                                                                       |
| Tests             | `apps/web/tests/modules/{workspace,inbox,teams}/**`, `tests/lib/use-teams-data.test.ts`, plus reference updates in `tests/components/{BoardLayout,GlobalAgentBar}.test.tsx`  |
| Shim              | `apps/cli/src/commands/agent.ts` marker + `config/transition-shims.json` entry `agent-flag-spec-id`                                                                          |
| Untouched         | `apps/web/src/lib/process-stream.ts` (MemberTerminal's transport), `apps/server/src/modules/team/` (G63 consumes `/api/team/*`), `packages/app/src/services/team-service.ts` |

**Redirect table (R2), frozen.** A static array, because `router.tsx` derives every route from
`modules.flatMap(...)` — once a module directory is gone there is no route object left to attach a
redirect to. Both the bare path and its wildcard are registered so deep links do not 404:

```ts
// router.tsx
export const RETIRED_ROUTES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "workspace", to: "/board/projects" },
  { from: "inbox", to: "/board/projects/conversation" },
  { from: "teams", to: "/board/projects/agents" },
];
```

rendered as `{ path: from, element: <Navigate to={to} replace /> }` plus `{ path: `${from}/\*`, … }`
inside the existing `/board` children array. Targets follow the capability, not the name: Workspace's
default tab was Overview (a project summary the Projects header now carries), Inbox is the durable
message plane (Conversation, 0841), Teams is the roster and member terminal (Agents, 0842).

**Why these are permanent routes and not a transition shim.** ADR-058 requires an objectively
checkable removal condition. "No bookmark anywhere still points at `/board/teams`" is not checkable,
so registering them as a shim would create a manifest entry that can never be retired — the opposite
of the gate's purpose. Three `Navigate` elements are cheaper than the machinery.

**Shim removal (R3) is a two-sided delete in one commit.** `transition-shim-check` fails on an
unregistered marker _and_ on a registered entry whose marker is gone, so deleting
`warnAgentSpecIdOnce` + its `@transition-shim(agent-flag-spec-id)` marker and the manifest entry must
land together. The evidence is 0846's `legacy-flag-usage` artifact kind, which already scans for
`--agent <spec-id>` usage; a repo-wide grep at refine time found none — only role and executor values.
The other three manifest entries are untouched: they belong to the role transition (B2), not to G6.

**Gating on Robin's window (R4).** The whole change is one commit that merges only after the cutover
window is recorded in G64's Notes. If Robin wants a reversible canary first, the existing
`disabledModules` array (`apps/web/src/modules/config.ts:2`) drops the three ids from the enabled set
without deleting anything, and the redirect table works either way — the routes are static, not
derived. That is the rollback lever, not a required step.

**Test migration (R5), by kind.** Tests that assert a _capability_ move to the Projects test that owns
that capability; tests that assert a _deleted composition shell_ go with it:

| Test                                                     | Disposition                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tests/modules/teams/MemberTerminal.test.tsx`            | moves with the file to `tests/modules/projects/`                                              |
| `tests/modules/teams/{tabs,components}.test.ts(x)`       | roster/terminal assertions merge into 0842's Agents tests                                     |
| `tests/modules/inbox/{tabs,inbox}.test.ts(x)`            | message-plane assertions merge into 0841's Conversation tests                                 |
| `tests/modules/workspace/**`                             | deleted — Workspace was a composition of the other three; it asserts no capability of its own |
| `tests/lib/use-teams-data.test.ts`                       | deleted **only if** the hook is orphaned (see below)                                          |
| `tests/components/{BoardLayout,GlobalAgentBar}.test.tsx` | references updated in place; never deleted                                                    |

**`useTeamsData` is expected to be orphaned, and that is checked, not assumed.** Its only importers
today are `InboxShell`, `WorkspaceShell`, `OverviewTab`, and three `teams/` tabs — all deleted here.
0842 reads `/api/project/fleet` instead. So `apps/web/src/lib/use-teams-data.ts` and its test are
deleted **after** a grep proves zero importers remain; if 0842 shipped differently, the hook stays
and the test stays with it.

**Anti-patterns — do not implement.**

- Do not delete `apps/web/src/modules/teams/MemberTerminal.tsx`. Move it.
- Do not renumber any surviving module's `order`. The landing route is already correct.
- Do not add the redirects to `config.ts` or the registry — they are routes, not modules; a module
  entry would reappear in the sidebar.
- Do not register the redirects as a transition shim (no checkable removal condition).
- Do not delete `apps/server/src/modules/team/` or `TeamService`. G63 consumes `/api/team/*`.
- Do not delete a test that asserts a capability Projects still ships; move it.
- Do not remove any of the three sibling manifest entries while removing `agent-flag-spec-id`.
- Do not merge before the cutover window is recorded in G64's Notes.

**Handoff.** 0850 records the ADR supersession this retirement makes true; 0851 closes M6, whose
scope (Workspace Overview removal, Inbox/Teams label split) is entirely on the surfaces deleted here.

### Plan

1. **Confirm G63 is functionally complete before touching anything.** `spur task show` each of
   0840–0845 and require every one to be `done` (all six are `todo` as of this refine), and confirm
   the Projects module actually renders Conversation, Agents, and Work. If any is not, stop — R1
   makes this a precondition, not a checklist item. _(R1)_
2. **Confirm the cutover window is recorded** in
   `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md` Notes. No merge without it.
   _(R4)_
3. **Move `MemberTerminal`.** `git mv apps/web/src/modules/teams/MemberTerminal.tsx
apps/web/src/modules/projects/MemberTerminal.tsx` and `git mv` its test to
   `apps/web/tests/modules/projects/`. Update the import in 0842's `MemberDetail.tsx` from
   `../teams/MemberTerminal` to `./MemberTerminal`. Its `process-stream.ts` import is unchanged.
   _Test:_ the moved test passes unedited except for its import path — proof the component was moved,
   not rewritten. _(R2)_
4. **Add the redirect table** to `apps/web/src/router.tsx` exactly as frozen in the Design, with both
   the bare path and the `${from}/*` wildcard for each of the three entries. _(R2)_
5. **Test intent — redirects.** Mount the memory router at `/board/teams`, `/board/inbox`,
   `/board/workspace`, and at a sub-path of each (`/board/teams/anything`), and assert the resolved
   location is the mapped Projects route. Add one guard asserting no enabled module's `route` equals
   a `RETIRED_ROUTES.from` value — a future module reusing the `inbox` route would shadow the
   redirect silently. _(R2)_
6. **Delete the three module directories** (`workspace/`, `inbox/`, `teams/` — the latter now minus
   `MemberTerminal.tsx`). Discovery is directory-based, so deletion is the whole removal: the
   registry, the sidebar, and the derived routes all follow. _(R1)_
7. **Test intent — registry after removal.** Assert `getEnabledModules()` is exactly
   `['observability', 'history', 'features', 'tasks', 'projects']` in that order, and that
   `defaultModule.route === 'observability'` — the assertion that catches an accidental `order`
   renumber. _(R1)_
8. **Migrate the tests per the Design's disposition table.** Merge the teams roster/terminal
   assertions into 0842's Agents tests and the inbox message-plane assertions into 0841's
   Conversation tests; delete only `tests/modules/workspace/**`. Update the retired-module references
   in `tests/components/BoardLayout.test.tsx` and `tests/components/GlobalAgentBar.test.tsx` in place.
   _(R5)_
9. **Retire `useTeamsData` only if orphaned.** `rg -n "use-teams-data" apps/web/src`; on zero hits
   delete `apps/web/src/lib/use-teams-data.ts` and `apps/web/tests/lib/use-teams-data.test.ts`. On
   any hit, keep both and record the surviving consumer in the Solution section. _(R5)_
10. **Prove the `--agent <spec-id>` shim is unused.** Run 0846's `legacy-flag-usage` scan, or
    equivalently `rg -n -- "--agent " config/workflows .spur/workflows plugins/sp docs scripts` and
    check each hit against the spec ids under `.spur/agents/`. A single spec-id hit stops step 11.
    _(R3)_
11. **Remove the shim on both sides in one commit:** delete `warnAgentSpecIdOnce` and its
    `@transition-shim(agent-flag-spec-id)` marker in `apps/cli/src/commands/agent.ts`, delete every
    call site, and delete the `agent-flag-spec-id` entry from `config/transition-shims.json`. Leave
    the three sibling entries alone. _Test:_ `bun run transition-shim-check` passes; a deliberate
    half-removal (entry kept, marker gone) fails it — assert both directions so the gate is proven,
    not trusted. _(R3)_
12. **Gate.** `cd apps/web && bun test`, then `bun run spur-check`, then `spur task check 0849`.
    Record in the Solution section the three redirects with their targets, the moved file, and the
    orphan decision from step 9.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:680` |
| `apps/cli/src/commands/agent.ts:701` |
| `apps/cli/src/commands/agent.ts:757` |
| `apps/cli/src/commands/agent.ts:988` |
| `apps/cli/tests/commands/agent-spec-flag.test.ts:16` |
| `apps/cli/tests/commands/agent-spec-flag.test.ts:35` |
| `apps/cli/tests/commands/agent-spec-flag.test.ts:4` |
| `apps/cli/tests/commands/agent-spec-flag.test.ts:9` |
| `apps/cli/tests/commands/agent-spec-flag.test.ts:93` |
| `apps/web/src/lib/process-stream.ts:12` |
| `apps/web/src/lib/use-teams-data.ts:0` |
| `apps/web/src/lib/use-teams-data.ts:5` |
| `apps/web/src/lib/use-teams-data.ts:88` |
| `apps/web/src/modules/projects/AgentsView.tsx:2` |
| `apps/web/src/modules/projects/AgentsView.tsx:4` |
| `apps/web/src/modules/projects/MemberDetail.tsx:4` |
| `apps/web/src/modules/projects/MemberDetail.tsx:6` |
| `apps/web/src/modules/projects/activity-history.ts:1` |
| `apps/web/src/modules/projects/conversation.ts:54` |
| `apps/web/src/modules/projects/index.tsx:11` |
| `apps/web/src/modules/projects/roster.ts:12` |
| `apps/web/src/modules/projects/roster.ts:14` |
| `apps/web/src/modules/task-kanban/index.tsx:0` |
| `apps/web/src/modules/task-kanban/index.tsx:18` |
| `apps/web/src/router.tsx:30` |
| `apps/web/src/router.tsx:5` |
| `apps/web/tests/components/BoardLayout.test.tsx:11` |
| `apps/web/tests/components/BoardLayout.test.tsx:446` |
| `apps/web/tests/components/BoardLayout.test.tsx:448` |
| `apps/web/tests/components/BoardLayout.test.tsx:456` |
| `apps/web/tests/components/GlobalAgentBar.test.tsx:300` |
| `apps/web/tests/components/GlobalAgentBar.test.tsx:309` |
| `apps/web/tests/components/LeftSidebar.test.tsx:0` |
| `apps/web/tests/components/LeftSidebar.test.tsx:173` |
| `apps/web/tests/components/LeftSidebar.test.tsx:182` |
| `apps/web/tests/modules/projects/MemberDetail.test.tsx:206` |
| `apps/web/tests/modules/projects/MemberTerminal.test.tsx:7` |
| `apps/web/tests/modules/projects/ProjectsShell.test.tsx:79` |
| `apps/web/tests/modules/projects/ProjectsShell.test.tsx:88` |
| `apps/web/tests/modules/projects/activity-history.test.ts:1` |
| `apps/web/tests/modules/projects/roster.test.ts:2` |
| `apps/web/tests/modules/projects/roster.test.ts:4` |
| `apps/web/tests/modules/projects/useProjectContext.test.tsx:59` |
| `apps/web/tests/modules/registry.test.ts:0` |
| `apps/web/tests/modules/registry.test.ts:4` |
| `apps/web/tests/modules/registry.test.ts:90` |


**Plan step 12 records (authored — the auto change-map above cannot carry these).**

- Redirect table, as shipped (`apps/web/src/router.tsx:15-19`): `workspace` → `/board/projects`
  (the project summary the Projects header carries), `inbox` → `/board/projects/conversation`
  (0841's durable message plane), `teams` → `/board/projects/agents` (0842's roster and member
  terminal). Each is registered twice — the bare path and `${from}/*` — inside the `/board` children
  array ahead of the module routes, so bookmarked deep links resolve instead of 404ing.
- Moved file: `apps/web/src/modules/teams/MemberTerminal.tsx` →
  `apps/web/src/modules/projects/MemberTerminal.tsx` (`git mv`; the component was not rewritten), and
  its test moved with it to `apps/web/tests/modules/projects/MemberTerminal.test.tsx`. Its three
  consumers were re-pointed: `MemberDetail.tsx`, `AgentsView.tsx`, `roster.ts`.
- Orphan decision (Plan step 9): `useTeamsData` is **not** orphaned — `rg -n 'use-teams-data'
  apps/web/src` still hits `apps/web/src/modules/projects/MemberDetail.tsx:3`, so
  `apps/web/src/lib/use-teams-data.ts` and `apps/web/tests/lib/use-teams-data.test.ts` both stay.
  Recorded exactly as step 9 requires (`on any hit, keep both and record the surviving consumer`).
- Deviation from the Design's WHERE table: the Design listed the Teams module as deleted "minus the
  moved file below" (MemberTerminal). `teams/ActivityTab.tsx` was **also** not deletable wholesale —
  `MemberDetail` imports `ActivityRow`, `historyUrl`, and `parseHistory` from it. Those three
  symbols (plus their private helper `toRow`) now live in
  `apps/web/src/modules/projects/activity-history.ts`, next to their single consumer; the tab
  component and the Teams-only helpers (`buildRosterIndex`, `enrichRowFromRoster`,
  `prependActivityRow`, `sseUrl`) retired with the shell. Their tests came with them as
  `apps/web/tests/modules/projects/activity-history.test.ts`.
- `apps/web/src/lib/process-stream.ts` is untouched by the retirement (the Design listed it as
  untracked-in-scope): the only change is a doc comment re-pointing its consumer at the moved
  `MemberTerminal`. Same for `apps/web/src/lib/use-teams-data.ts` and
  `apps/web/src/modules/task-kanban/index.tsx`, where retired-module prose was corrected.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | The three retired module directories are absent from disk (`ls apps/web/src/modules` → config.ts, discover.ts, features, history, observability, projects, registry.ts, task-kanban, types.ts); `git diff --summary -M HEAD` shows all 20 `modules/{workspace,inbox,teams}/**` sources as deletions plus the one rename. `apps/web/tests/modules/registry.test.ts:94` asserts `getEnabledModules()` is exactly `['observability','history','features','tasks','projects']` in declared order and `apps/web/tests/modules/registry.test.ts:98` asserts `defaultModule?.route === 'observability'`; `apps/web/tests/components/LeftSidebar.test.tsx:175` pins the five surviving nav labels and `apps/web/tests/components/LeftSidebar.test.tsx:178` the five tooltips (length 5). Precondition re-derived fresh this run: `spur task show` reports 0839, 0840, 0841, 0842, 0843, 0844, 0845, 0848, 0851 all `done`, and `spur feature show G63` → `done`. Fresh subset run: 46 pass / 0 fail / 155 expect (1.88s). |
| R2 | MET | On the AMENDED text (`docs/tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md:35-40`) both conjuncts hold. Redirect half: `apps/web/src/router.tsx:14-18` is the static three-entry `RETIRED_ROUTES` table and `apps/web/src/router.tsx:30-39` registers the bare path plus the `${from}/*` wildcard per entry ahead of the module routes at `apps/web/src/router.tsx:40`; proven behaviourally by `apps/web/tests/components/BoardLayout.test.tsx:464-483` (resolved pathname AND rendered landing tab against a literal `EXPECTED_TAB` at `:470` plus key parity with `RETIRED_ROUTES.from` at `:483`), `apps/web/tests/components/BoardLayout.test.tsx:486-493` (deep links) and `apps/web/tests/components/BoardLayout.test.tsx:495-498` (no enabled module shadows a retired route), with the route-tree shape pinned at `apps/web/tests/components/BoardLayout.test.tsx:446-460` — fresh run 46 pass / 0 fail. Targets cross-checked against the live tab contract: `apps/web/src/modules/projects/tabs.tsx:18-22` (`conversation`/`agents`/`work`) and the path-segment resolution at `apps/web/src/modules/projects/useProjectTab.ts:17-22`. Reachability half: the reduction is recorded in the requirement itself (`:35-40`), per-facet at `:116` and `:124`, operator-accepted at `:135-143`, mirrored at `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:268-271`; the named owners exist and own what they are named for — `docs/tasks4/0852_restore-board-reachability-for-the-retired-process-watch-lis.md:36-49` (R1/R3/R5 name the `0262`/`0264`/`0267` groups) and `docs/tasks4/0853_record-ownership-for-the-retired-teams-supervisor-facets-upt.md:37-47` (R1 names uptime, live last-activity, team up/down) — both `backlog`, both `spur task check` PASS this run. Unreachability re-derived against the tree, not the prose: `uptime` → 0 hits under apps/web; `buildWatchRows`/`filterWatchRows`/`prependActivityRow`/`buildRosterIndex`/`enrichRowFromRoster` → 0 hits; the only `new EventSource` sites in `apps/web/src` are task-kanban/useTasks.ts, projects/MemberTerminal.tsx, features ×2 and observability ×2 (no roster tail; `apps/web/src/modules/projects/MemberDetail.tsx:59` records the deliberate read-on-open snapshot); `POST /api/team/:team/up\|down` survive at `apps/server/src/modules/team/index.ts:250,280` with 0 apps/web callers. Residual classification (the one surface neither delivered nor enumerated) is stated in Decision 1 and finding 3 — it does not falsify the clause as I read it. |
| R3 | MET | The warn-once path is gone on both sides: `grep -rn 'warnAgentSpecIdOnce\|agent-flag-spec-id\|warnedAgentSpecId' apps/cli/src config/ apps/web/src` → 0 hits; `config/transition-shims.json` lists exactly the four surviving entries (`:5` agent-bare-binary-name, `:12` spec-without-executor-field, `:19` agent-default-executor, `:26` team-noun-retired); `bun run transition-shim-check` → "4 marker(s) observed, 4 manifest entries baselined, 0 new, 0 stale, 0 incomplete — PASS" (fresh this run). No caller remains: `.spur/agents/` does not exist (ls → No such file or directory), and the refine-time repo-wide `--agent` scan is re-derivable from the empty spec corpus. `apps/cli/src/commands/agent.ts:679-683` records the retirement at the point of use. `bun test apps/cli/tests/commands/agent-spec-flag.test.ts apps/cli/tests/commands/agent.test.ts` → 50 pass / 0 fail / 123 expect (8.41s), fresh. |
| R4 | MET | `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:223-231` — the Notes location the Design designates — records the window open 2026-09-14 and names the three gates it releases (0848's shim removal condition, 0849's merge gate, 0850's supersession). The rollback lever is genuinely unused: `apps/web/src/modules/config.ts:24` still holds `disabledModules: readonly string[] = []` and the redirect table is static, so the recorded revert story holds. No merge has occurred: HEAD is still `1157f7e2b`, the task is `wip`, and every changed path is uncommitted (`git status --short`), so the pre-merge condition the requirement encodes holds. Evidence-independence caveat: the record is self-authored — see finding 4 and Decision 2; this hop's brief supplies the external corroboration earlier passes lacked, and I do not treat the requirement as unsatisfied on that account. |
| R5 | MET | On the AMENDED text (`docs/tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md:43-46`), every disposition lands in one of its two buckets. Moved, or with an independent Projects equivalent: `apps/web/tests/modules/projects/MemberTerminal.test.tsx` (git rename at 100%, one import line changed), `apps/web/tests/modules/projects/activity-history.test.ts:14,29,52,65,73` (5 cases for the extracted helpers beside their single consumer), the redirect/deep-link/landing-tab/shadow assertions at `apps/web/tests/components/BoardLayout.test.tsx:446-498` (+47 lines), the registry set and default-route assertions at `apps/web/tests/modules/registry.test.ts:94,98` (+12), the start-verb case at `apps/web/tests/modules/projects/MemberDetail.test.tsx:209-220`, the message-plane parse at `apps/web/tests/modules/projects/conversation.test.ts:86` (`parseInboxMessages`) and the thread/rehydration cases at `apps/web/tests/modules/projects/ConversationView.test.tsx:75-133`. Retired with its surface, owner named: the `0262` supervised row trio, the `0264` registry one-shots and the `0267` filters → 0852 R3/R5; the `0378` uptime / live-SSE / up-down cases plus the retired live-buffer helpers → 0853 R1. Composition-only groups (`tests/modules/{workspace,teams,inbox}/tabs.test.ts`, `workspace.test.tsx` shell cases) go with their deleted shell, which is the Design's own disposition rule (`:257-266`). Fresh numstat: `git diff --numstat HEAD -- apps/web/tests` → 170 added / 2,466 deleted (the same figures as the prior passes). Residual precision (which deleted view-groups are neither moved nor named by 0852/0853) is stated in finding 3; I do not read it as a breach of the amended clause. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: Board routes retire with a migration path | MET | test | Route/bookmark half verified behaviourally, fresh: `apps/web/tests/components/BoardLayout.test.tsx:464-483` mounts each retired route and asserts BOTH the resolved pathname and the rendered landing capability tab (workspace/inbox → `conversation`, teams → `agents`, literal `EXPECTED_TAB` at `:470`, key parity at `:483`), `apps/web/tests/components/BoardLayout.test.tsx:486-493` covers `/board/<retired>/anything`, `apps/web/tests/components/BoardLayout.test.tsx:495-498` guards against a module shadowing a retired route — `cd apps/web && bun test tests/components/BoardLayout.test.tsx tests/modules/registry.test.ts tests/components/LeftSidebar.test.tsx` → 46 pass / 0 fail / 155 expect this run. The final step ("and no Board capability is unreachable, or its reduction is operator-accepted and owned") is satisfied on the amended text: the four unreachable facets are recorded (`docs/tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md:116,124`), operator-accepted (`:135-143`), and owned by live tasks that name them (`docs/tasks4/0852_restore-board-reachability-for-the-retired-process-watch-lis.md:36-49`; `docs/tasks4/0853_record-ownership-for-the-retired-teams-supervisor-facets-upt.md:37-47`), with the unreachability itself re-derived from the tree (see R2). |
| Scenario: The spec-id shim retires only when unused | MET | command | `bun run transition-shim-check` → "4 marker(s) observed, 4 manifest entries baselined, 0 new, 0 stale, 0 incomplete — PASS" (fresh this run; `config/transition-shims.json` carries exactly the four sibling entries at `:5,:12,:19,:26`). No workflow or plugin caller remains: `.spur/agents/` is absent, and `grep -rn 'warnAgentSpecIdOnce\|agent-flag-spec-id\|warnedAgentSpecId' apps/cli/src config/ apps/web/src` → 0 hits. `bun test apps/cli/tests/commands/agent-spec-flag.test.ts apps/cli/tests/commands/agent.test.ts` → 50 pass / 0 fail / 123 expect, fresh this run. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — task 0849 (G64: retire Workspace, Inbox, Teams board routes) — pass 7 (feature-AC completion + gate re-run)

**Scope:** whole working tree vs HEAD `1157f7e2b` — 53 tracked paths changed (+622/−4988) plus the two untracked follow-ups `0852`/`0853`. Read-only: nothing outside this `### Review` section was written. The code tree is byte-unchanged since pass 6 exited (14:07Z); the only content that moved is the two record files plus four regenerated `plugins/sp/lib/*.generated.*` that are byte-identical to HEAD.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — R1–R5 and both `@core` scenarios are MET on the current tree. No P1/P2 is open, so nothing blocks the gate under `--auto`. G64's R7 completion is an honest spec completion, not a gate-shaped edit (Decision 1). The green gate re-run is bound to this exact tree by the proof digest (Decision 2). Findings 1–6 are P3/P4 and do not gate.

##### What changed this hop — and what did not

| Claim | Verified? | Evidence |
|---|---|---|
| The code is unchanged since pass 6 | **Yes** | `find apps packages config plugins docs contracts scripts tests tooling -type f -newermt '2026-09-14 07:07:00'` → exactly `docs/tasks4/0849_…md`, `docs/features/G64_…md`, and the four regenerated `plugins/sp/lib/*.generated.*` whose `git status` is clean (byte-identical to HEAD). Zero source files, zero test files. |
| G64's R7 scenario is inside the gherkin fence | **Yes** | The only fence pair in the file is `:56`/`:107`; R7 sits at `:102-106` with one blank line before the closing fence; scenarios inside the fence region = **7** |
| The task's scenario title is matched verbatim | **Yes — and by normalized title, not raw substring** | G64 `:102` = `Scenario: R7 — The spec-id shim retires only when unused`; 0849 `:61` = `Scenario: The spec-id shim retires only when unused`. `normalizeTitle` strips the `R\d+ —` prefix (`packages/domain/src/bdd/coverage.ts:58-63`), so matching is title *equality* after normalization — a stronger condition than the "verbatim substring" the brief describes. Running `checkAcCoverage(featureAc, taskAc)` directly on both files this run → `covered: true`, `uncovered: []`; orphans are R1/R2/R3/R4/R6, i.e. the scenarios covered by 0846/0847/0848/0850, not by 0849 |
| G64's structure survived the restore-from-HEAD and CLI re-apply | **Yes** | `## Goal` `:14`, `## Scope` `:21`, `## Acceptance Criteria` `:54`, `## Tasks` `:109`, `## Notes` `:122`, `## History` `:280` — each exactly once, no other `##`; 6 `###` subsections, one each; both ledger markers exactly once; 7 scenarios; the amended R5 clause exactly once in the file and once inside the fence (`:92`); `git diff HEAD` on G64 is exactly the five intended edits (updated_at, R5 clause, R7 block, cutover-window rewrite, Supersession paragraph) with no reordering and no lost Notes |
| Notes still carry the cutover-window record and the Supersession paragraph | **Yes** | `:228-236` ("Still Robin's, unchanged" → the window RECORDED 2026-09-14 with the rollback lever) and `:263-275` (`### Supersession — 2026-09-14, tasks 0849/0850 executed`, including the accepted reduction and the two backlog owners) |
| `spur task check 0849 --as done` is clean | **Yes** | `0849 (done): PASS`; `--json` → `findings: []`, `missingSections: []`, `pass: true`. The three stale `### Testing` anchors that passes 1–6 tracked are gone, and so is the DD-09 warning that stopped this hop |
| `spur feature check G64` passes | **Yes** | `G64 (active): PASS` plus exactly 3 `L4 Acceptance Criteria scenario-unverified` warnings (R5, R6, R7 — the expected shape while 0849/0850 carry no PASS verdict with a MET row) |
| The digest binds the green gate run to this tree | **Yes — independently recomputed** | `computeProofInputFingerprint({ cwd, taskContent: 0849, featureContent: G64 })` → `sha256:6f9a65be978bfaacdb762059d07bd6f59174a75e02703bc1d4ea489da5ab5258`, **exactly** the gate log's `proof-digest` trailer. Probe was written under the gitignored `.spur/run/` and deleted |
| `### Solution` is populated | **Yes** | `:304-385` — the auto change-map (46 anchors) plus the authored Plan-step-12 records: the three redirects with targets, the moved `MemberTerminal` and its re-pointed consumers, the step-9 orphan decision (`useTeamsData` retained; single consumer `projects/MemberDetail.tsx:3`), and the Design deviation (`teams/ActivityTab.tsx` was not deletable wholesale — its three symbols now live in `projects/activity-history.ts`). Pass 3's P3 and pass 6's standing caveat on that section are **closed**. |

##### Decision 1 — is G64's R7 AC completion an honest spec completion, or a gate-shaped edit?

**Honest spec completion. I am not raising the P2 the brief reserves for the gate-shaped case.** Reasons, in order of weight:

1. **The AC was completed upward from the feature's own declared Scope, not downward to fit the task.** G64's Scope already names this work — "retire the `--agent <spec-id>` warn-once shim after confirming no workflow or plugin usage" (`docs/features/G64_…md:44-45`). A feature whose Scope claims work and whose AC never tests it is internally incomplete; R7 makes the AC match the Scope. The direction of repair is the tell: complete the contract, do not lower the task to meet it.
2. **The obligation R7 adds is already discharged and verified, and was before this hop.** R3's evidence (shim path gone on both sides; `bun run transition-shim-check` → 4 markers / 4 manifest entries / 0 new / 0 stale / 0 incomplete, PASS) and AC2's `command` evidence are unchanged from pass 6. R7 recorded a contract the shipped code already meets — it did not create new work, and it did not make any previously-MET requirement easier.
3. **The task scenario is not new, and was not written to be covered.** `git show HEAD:docs/tasks4/0849_…md` carries `Scenario: The spec-id shim retires only when unused` with the identical Given/When/Then lines — authored at refinement (2026-09-12) before implementation. The run left the task's AC section untouched except for the AC1 `And` clause the operator's own decision carried at pass 6, and `ac_altitude` is absent from 0849 (`grep -c ac_altitude` → 0), so the DD-09 subset rule is genuinely enforced rather than declared away.
4. **The gate-shaped alternative was available and rejected.** Declaring `ac_altitude: task-local` on 0849 skips the subset rule outright (`packages/app/src/services/task-check.ts:1673-1678`; `packages/domain/src/bdd/coverage.ts:122-124`). That passes the same guard with less work — and leaves the feature shipping a Scope its AC never tests. The run took the branch that *adds* an obligation rather than the one that removes one.
5. **The completion was paid for, not dodged.** G64's Acceptance Criteria is a fingerprinted proof input (`packages/app/src/workflow/proof-input-fingerprint.ts:344`), so adding R7 invalidated the recorded digest and forced a full gate re-run; the run paid it (see the digest trailer and the two-attempt history). A gate-shaped edit optimizes for *not* re-running.

**The one observation that supports the weaker reading, recorded rather than buried:** the trigger was mechanical — the done guard raised `L4.uncovered-task-scenario`; no human noticed the gap first. So this is a *guard-honored* completion rather than a *discovered* one. That does not make it gate-shaped: the guard's message was accurate about the artifact (the feature AC really was missing a scenario its own Scope claimed), and the repair moved the spec in the direction the authority had already stated. It would be a P2 if adding R7 had loosened a requirement, deleted a scenario, or been paired with a task-side edit that lowered the altitude. None of that happened.

##### Decision 2 — do I accept the flake explanation for the failed first gate attempt?

**Yes, with one limit recorded.** The reading is the better of the two available, for five reasons, and the residual risk is a test-file concern, not this task's.

1. **The failing cases are hermetic-subprocess cases, so their wall time is load-coupled.** `apps/cli/tests/config-layering.test.ts:1-31` spawns the REAL CLI entry once per case against a temp `HOME` with stub agent binaries on `PATH` (the `AgentDetector` doctor probe shells `<agent> --version`), and re-enables the global config layer per case. Each case is a process spawn plus a doctor probe, not a pure assertion.
2. **The headroom is thin and I measured it.** In isolation this run the file is **7 pass / 0 fail / 10.21s**, and its two slowest cases are `R7: no config layer defines agent.roles → doctor reports rolesSource: fallback` at **2874.76ms** and `R7: text-mode doctor prints the explicit-fallback note` at **2063.34ms**, against bun's 5000ms default per-test timeout — a 1.7–2.9× margin that a 475-file parallel gate can plausibly consume. `exit 143` is the shape of a timeout killing the spawned child, not of a failed assertion.
3. **No causal link to this task.** `apps/cli/tests/config-layering.test.ts` is unmodified vs HEAD (`git status` clean) and the 0849 diff's only CLI source change is `apps/cli/src/commands/agent.ts` (shim removal). The config-layer resolution those cases exercise is not in the change set.
4. **The digest makes "nothing changed between the two attempts" a real check rather than an assertion.** The gate's digest is an input-side fingerprint captured *before* the suite runs and appended to the log (`plugins/sp/scripts/quality-gate.ts:188-193`; the pipeline captures it with `proof.fingerprint` at the test stage). It is identical across two attempts exactly when no fingerprinted input moved between them — and I reproduced the same value from the current tree, so the green attempt demonstrably ran on the inputs reviewed here.
5. **Limit, stated plainly.** The failed attempt is **not retained**: `quality-gate.ts` truncates `<wbs>-test-gate.log` at the start of every run, so "attempt 1 failed on two config-layering timeouts" rests on the run log's own sentence plus the isolation run — I cannot replay the FAIL. Accepting the explanation is a judgement on plausibility, not a reproduction. The residual risk is an intermittent load-sensitive CLI-spawn timeout owned by that test file, and it is non-blocking: the PASS artifact and its digest both exist and are bound to this tree.

I did **not** re-run the full monorepo gate myself: doing so would truncate and overwrite `.spur/run/0849-test-gate.log` / `.status` / `.findings`, i.e. destroy the pipeline's recorded artifact to produce an equivalent one. The digest recomputation plus the fresh focused runs below are the substitute, and they are pasted.

##### Functional Traceability (against the amended text, with G64 R7)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — modules/nav removed only after G63 is functionally complete | MET | No `apps/web/src/modules/{workspace,inbox,teams}` directory exists; `registry.test.ts:94` pins `getEnabledModules()` to the five survivors in declared order and `:98` pins `defaultModule?.route === 'observability'`; `LeftSidebar.test.tsx:170-183` re-pins the five labels and tooltips. Fresh subset: 46 pass / 0 fail / 155 expect |
| R2 — routes/bookmarks redirect; no capability unreachable *without a recorded, operator-accepted reduction that names its owning task* | **MET** (amended text) | Redirect half: `apps/web/src/router.tsx:14-18` + `:30-39` (bare path and `${from}/*` per entry, ahead of the module routes at `:40`); behaviourally pinned at `BoardLayout.test.tsx:464-498` (pathname, rendered landing tab, deep links, no-shadow guard). Reachability half: DEFERRED `:116`/`:124`, CLOSED `:135-143`, owners `0852`/`0853` both `backlog` and PASS `task check` this run. Decision 2 of pass 6 re-derived, unchanged |
| R3 — `--agent <spec-id>` shim removed once unused | MET | `bun run transition-shim-check` → 4/4 PASS (fresh); `config/transition-shims.json` carries exactly the four sibling entries and no `agent-flag-spec-id`; 0 hits for `warnAgentSpecIdOnce` in tracked source; `agent-spec-flag.test.ts` 2 pass / 0 fail. **Caveat: the recorded R3 evidence in the verdict artifact is truncated at 72 chars — finding 1** |
| R4 — gated on Robin's recorded cutover window | MET (self-certified evidence) | `G64:228-236` declares the window open 2026-09-14 and names the three gates it releases; `apps/web/src/modules/config.ts:24` still holds `disabledModules: readonly string[] = []`, so the recorded rollback lever holds. No merge: HEAD is still `1157f7e2b` and all 53 tracked paths are uncommitted. Independence caveat: finding 4 |
| R5 — tests move, not delete; where no equivalent exists they retire with their surface under the same accepted reduction as R2 | **MET** (amended text) | Moved/independent-equivalent groups and the owner mapping enumerated in pass 6 Decision 2 and unchanged; `git diff --numstat HEAD -- apps/web/tests` → 170 added / 2,466 deleted; fresh subset runs green |
| AC 1 — Board routes retire with a migration path | **MET** (amended text) | Both route shapes plus landing-tab assertions and the shadow guard (`BoardLayout.test.tsx:446-498`, fresh 46/0); the final step's accepted-reduction branch is satisfied and owned (`:116`, `:124`, `:135`) |
| AC 2 — the spec-id shim retires only when unused | MET | Same command as R3, fresh and PASS; two-sided delete in one commit with the three sibling manifest entries intact. **Now mirrored by G64's R7 (`:102-106`), which closes the `L4.uncovered-task-scenario` gap** |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|---|---|---|---|
| 1 | P3 (minor) | record integrity | New this hop. The verify verdict artifact truncated the evidence text of R2, R3 and AC2 at the first **unescaped pipe** in their markdown rows, and `spur task record` renders `### Testing` from that artifact, so the loss is baked into the record: R3 keeps **72 of ~897 chars**, R2 2246 of ~2498, AC2 334 of ~567. R3's lost tail is where the falsifiable claims live ("0 hits", `config/transition-shims.json` entries, `agent-spec-flag` 50 pass / 0 fail). Mechanism, reproduced: the answer file's rows carry a raw pipe inside a code span (`POST /api/team/:team/up\|down`, `grep -rn 'warnAgentSpecIdOnce\|agent-flag-spec-id\|warnedAgentSpecId'`); `splitTableCells` (`packages/app/src/services/task-verdict.ts:177-186`) treats an unescaped pipe as a column boundary and **silently drops the overflow cells** — unlike the AC path, which reports a `dropped` row diagnostic. Non-blocking: the status cell precedes the pipe, so every verdict and the gate's PASS are intact. Fix is record content plus a tooling guard, not task code — the shared `escapeTablePipe` (`task-record.ts:32`) already exists for exactly this | `docs/tasks4/0849_…md:396,397,404`; `.spur/run/0849-verdict.json`; `packages/app/src/services/task-verdict.ts:177-186`; `packages/app/src/services/task-record.ts:32,126-160` |
| 2 | P4 (advisory) | record integrity | New this hop. G64's auto-generated task ledger still lists 0849 `cancelled` and 0850 `cancelled`, while 0849's frontmatter reads `testing` and 0850's reads `todo` — two of six rows contradict the tracked status. The CLI re-apply preserved the HEAD ledger, and no checker consumes it (`spur feature check G64` PASS, only the 3 L4 warnings), so it is cosmetic-but-wrong in the one place a reader looks for the feature's task list | `docs/features/G64_…md:111-118`; 0849 frontmatter `:4`; 0850 frontmatter `:4` |
| 3 | P4 (advisory) | record hygiene | `### Solution`'s change-map header still reads "auto-generated — implement step did not record a Solution" directly above the authored Plan-step-12 records, and three of its 46 anchors are `:0` (`use-teams-data.ts:0`, `task-kanban/index.tsx:0`, `registry.test.ts:0`), which is not a location. The section's substance is correct and now complete (verified above) | `docs/tasks4/0849_…md:306-385` |
| 4 | P4 (advisory) | honesty of the record | Carried, and now **tripled**: R4's cutover-window record (`G64:228-236`), the CLOSED acceptance entry (`0849:135-143`) and the G64 Supersession paragraph (`G64:263-275`) are all authored by the same run they certify. The PASS rests on them together; if the acceptance is not real, this verdict does not hold. This hop's brief is the only external corroboration, and a brief is not a record | `docs/features/G64_…md:228-236`, `:263-275`; `docs/tasks4/0849_…md:135-143` |
| 5 | P4 (advisory) | docs / maintenance | Carried unchanged (no code moved). Stale tracked docs owned by 0850: `docs/03_ARCHITECTURE.md:530`; `docs/design/board-module-boundaries.md:24,55,60`; `docs/design/inbox-board-module.md:17,29,44,53`; `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md:44,47`. Live-source comments naming retired modules: `projects/roster.ts:7`; `task-kanban/KanbanBoard.tsx:28,34,37,75`; `projects/MemberTerminal.tsx:59`; `tests/modules/projects/ProjectsShell.test.tsx:163,179`; `styles/global.css:120`. Gitignored regeneration artifacts still carrying the retired shim — all three verified ignored by `git check-ignore`: `apps/cli/spur.js:109649`, `apps/cli/config/transition-shims.json:19`, `apps/cli/plugins/sp/skills/spur-cli/references/agent.md:59`. New this hop: 0850's own status is a live three-way disagreement — frontmatter `todo`, its History `todo → cancelled`, G64's ledger `cancelled` | as listed |
| 6 | P4 (advisory) | follow-up readiness | Carried: 0852 and 0853 still carry the placeholder AC template (`<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->`), with 0853's Q&A/Design/Plan still templates. Both `backlog`, both `spur task check` PASS. Consequence that must survive into the record step: an 0849 marked `done` means "owned, operator-accepted reduction", **not** "delivered parity" | `docs/tasks4/0852_…md:52-54`; `docs/tasks4/0853_…md:48-50` |

##### Prior pass disposition (pass 1 → pass 6)

| Pass(es) | Finding | Disposition | Evidence this run |
|---|---|---|---|
| 1 #1, 2 #1 | P2 (major) process watch list and the 0378 supervisor facets retired with no successor or owner | **RESOLVED — and OPERATOR-ACCEPTED** | 0852/0853 exist, `backlog`, both `spur task check` PASS; DEFERRED `:116`/`:124`, CLOSED `:135-143`; amended R2 names every facet and owner |
| 6 #1, and 1 #9 / 2 #8 / 3 #6 / 4 #1 / 5 #1 (P3, the only actionable one) | `### Testing` carried the pre-implementation FAIL table, contradicting the tree and the amended Requirements | **RESOLVED this hop** | `### Testing` `:387-405` now renders the PASS artifact (`- Verdict: PASS (from verdict artifact)`, MET rows); `spur task check 0849 --as done --json` → `findings: []`; the three stale anchors are gone |
| 6 #2 (P4) | Both acceptance records said the verify was "PARTIAL, R2/AC1 only" while the verdict held R5 PARTIAL too | **RESOLVED this hop** | Both now read "(PARTIAL on R2/AC1 and on R5's deleted-not-moved test groups)" — `0849:135`, `G64:268` |
| 6 #3, and pass 5's Inbox `All` queue note (P4) | Amended R2 enumerates "Four facets" without marking the list non-exhaustive; the Inbox `All` queue is nowhere in it | **STILL OPEN — unchanged** | `0849:35-40` still reads "Four facets are accepted reductions"; no DEFERRED line cites `plans/2026-09-11-…:195` |
| 6 #4, and 1 #8 / 2 #7 / 3 #4 / 4 #4 / 5 #3 (P4) | R4's evidence is self-authored | **STILL OPEN — and now tripled** | `G64:228-236`, `:263-275`; `0849:135-143`. Finding 4 |
| 1 #3 / 2 #3 / 3 #1 / 4 #1 / 5 (P3 empty `### Solution`) | `### Solution` was the untouched template | **RESOLVED this hop** | `:304-385` carries the change-map plus the authored step-12 records; verified above (redirect table, moved file, orphan decision, Design deviation) |
| 1 #4, 2 #4 (P3) | Redirect test asserted only the pathname / recomputed the app's own fallback | **RESOLVED** (pass 4) | `BoardLayout.test.tsx:470-483` — literal `EXPECTED_TAB` plus `RETIRED_ROUTES.from` key parity; fresh 46/0 |
| 1 #5, 2 #5 (P3) | Retired warn-once shim prose in `agent.ts`, `agent.md`, three design docs | **RESOLVED** (tracked sources) | `bun run transition-shim-check` → 4/4 PASS; 0 hits in tracked `apps/cli/src`, `config/`, `apps/web/src` |
| 1 #6 (P3) | `activity-history.ts` sat in `lib/` for a single consumer | **RESOLVED** | `apps/web/src/modules/projects/activity-history.ts` beside `MemberDetail.tsx`, with its test |
| 1 #7 / 2 #6 / 3 #5 / 4 #5 / 5 #4 (P4) | Tracked docs referencing the deleted modules | **STILL OPEN — 0850's scope** | Finding 5, re-spot-checked |
| 1 #2 / 2 #2 / 3 #3 / 4 #2 / 5 #7 (P4) | Deletion-dominated test migration | **ACCEPTED AS RECORDED — and carried in R5's amended clause** | `0849:43-46`; 170 added / 2,466 deleted test lines, unchanged |
| 3 #2 (P3) | Four copies of the refinement Q&A entry | **RESOLVED** | exactly one `#### Q&A entry — 2026-09-12T16:40:11.285Z` (`:68`) |
| 3 #3 | Imprecise "no `apps/web` reader left" for `/api/team/processes` | **RESOLVED** | `0852:24-30` separates the one-shot list from `parseProcessList`'s narrowing |
| 3 #7 / 4 #3 / 5 #2 (P4) | Live-source comments naming retired modules | **STILL OPEN — unchanged (no code moved)** | Finding 5 |
| 5 #5 (P4) | Gitignored regeneration artifacts still carrying the retired shim | **STILL OPEN — no owner, by design** | Finding 5; all three paths verified ignored |
| 5 #6, 6 #7 (P4) | 0852/0853 placeholder ACs | **STILL OPEN** | Finding 6 |
| 5 "feature-surface alignment" (G64 `:92` unamended) | **RESOLVED at pass 6** | G64 `:92` carries the byte-identical amended clause; R7 now extends the same alignment |
| `TaskKanbanView` has no production consumer | Recorded, not a finding — pre-existing (0197 R6 designated the embed seam) | Unchanged |

##### SECUA dimensions with no P1–P3 finding

- **Security:** unchanged this hop — no source line moved. `RETIRED_ROUTES` is a static literal consumed only by `<Navigate replace>` and matched ahead of the module routes, so a deep link cannot be re-interpreted; deleting the warn-once path removed a string-interpolated stderr line, not a check; untrusted-payload narrowing is intact (`projects/activity-history.ts` `toRow`/`parseHistory`, `projects/conversation.ts:111` `parseInboxMessages`, `MemberTerminal`'s `parseProcessList`). Finding 1 is a record-loss path, not a security surface.
- **Efficiency:** unchanged — `RETIRED_ROUTES.flatMap` runs once at module load; `git diff --summary -M HEAD` still reports `MemberTerminal.tsx` as a **100 %** rename, so the SSE/poll behaviour is byte-identical; `activity-history.ts` keeps the same 100-row cap.
- **Usability / a11y:** bookmarked deep links resolve instead of 404ing (wildcard per entry, asserted); no new focus or ARIA surface; the sidebar loses three entries, re-pinned in `LeftSidebar.test.tsx:170-183`.
- **Architecture:** the static-table-over-transition-shim decision stays right and documented at the point of use (`router.tsx:5-13`); the "no enabled module reuses a retired route" guard expresses an invariant a derived route table could not; both single-consumer files sit beside their consumer. New this hop: G64's AC now agrees with its own Scope — the property whose absence produced the guard failure.
- **Correctness:** re-derived, not assumed — no source file has an mtime after pass 6's exit, `git status` shows the same 53 tracked paths, and the current-tree digest reproduces the gate log's value exactly.

##### Verification evidence (fresh, this run)

- `spur task check 0849` → `0849 (testing): PASS` (zero findings). `spur task check 0849 --as done --json` → `findings: []`, `missingSections: []`, `pass: true`. `spur feature check G64` → `G64 (active): PASS` + 3 L4 scenario-unverified warnings (R5/R6/R7). `spur task check 0852` / `0853` → both PASS (`backlog`).
- `bun run transition-shim-check` → `4 marker(s) observed, 4 manifest entries baselined, 0 new, 0 stale, 0 incomplete — PASS`.
- `cd apps/web && bun test tests/components/BoardLayout.test.tsx tests/modules/registry.test.ts tests/components/LeftSidebar.test.tsx` → **46 pass / 0 fail / 155 expect() calls** (991ms).
- `bun test apps/cli/tests/commands/agent-spec-flag.test.ts` → **2 pass / 0 fail / 10 expect() calls**.
- `bun test apps/cli/tests/config-layering.test.ts` (isolation, for the flake claim) → **7 pass / 0 fail / 10.21s**, slowest cases 2874.76ms and 2063.34ms against a 5000ms timeout.
- `computeProofInputFingerprint` over the current tree with 0849 + G64 as the spec inputs → `sha256:6f9a65be978bfaacdb762059d07bd6f59174a75e02703bc1d4ea489da5ab5258` — equals `.spur/run/0849-test-gate.log`; `.status` = PASS, `.findings` = 0 bytes; the log's tail is `8477 pass / 0 fail / 34606 expect() calls / Ran 8477 tests across 475 files [246.09s]` then `All 2 rules passed — no violations found.`
- `checkAcCoverage` run directly on 0849's and G64's AC sections → `covered: true`, `uncovered: []` (R7 matches after title normalization).
- Structural sweeps: G64 `##` sections 6/6 unique, `###` subsections 6/6 unique, `Scenario:` inside the fence = 7, ledger markers 1/1, amended clause 1× in file; 0849 `ac_altitude` = 0, `@core` in AC = 2. `find … -newermt '2026-09-14 07:07:00'` → two record files + four byte-identical regenerated libs.
- Read, not re-run: the monorepo `spur-check` wrapper and the full gate (deliberately — re-running would truncate the recorded artifact). Probes were written under the gitignored `.spur/run/` and deleted.

##### Residual ownership — 0849 vs 0850 vs 0852 vs 0853

- **`0852`** (backlog) — the process watch list: `executions` rendering, `0264` one-shots, `0267` filters, `0262` supervised rows. Named in the amended R2; finding 6 for its placeholder AC.
- **`0853`** (backlog) — the 0378 supervisor facets: per-member uptime, live-SSE roster activity, the team up/down Board controls, the retired live-buffer helpers, and the disposition of the orphaned `POST /api/team/:team/up` / `down` routes. Named in the amended R2; finding 6.
- **`0850`** — the ADR-116 supersession plus the stale tracked documentation. Finding 5, including its own three-way status disagreement.
- **Owned by 0849's own closure (this pass's residues)** — findings 1, 2, 3, 4: the truncated verdict evidence, the stale feature ledger, the stale change-map header, and the self-witnessed records. Only finding 1 loses information a reader would otherwise use; the rest are recorded observations.
- **Dispositioned by the cited design authority, not unowned** — the Inbox `All` queue view (`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md:195`; pass 6 finding 3, still open as a one-line record edit) and the gitignored regeneration artifacts (regenerating from tracked sources clears them; they are not gate inputs).

**Next:** the gate can proceed under `--auto` — nothing blocker/major is open, `spur task check 0849 --as done` is clean, and G64's R7 completion is an honest spec completion bound to this tree by the digest. That PASS remains conditional on the CLOSED acceptance being real; if it is not, the verdict does not hold. Remaining work, none of it code: (1) re-author the R2/R3/AC2 evidence rows without unescaped pipes so the verdict artifact and `### Testing` stop truncating (finding 1) — or explicitly accept the truncation; (2) regenerate G64's task ledger and mark R2's facet list non-exhaustive (findings 2 and pass-6 finding 3); (3) keep the record-step wording that `done` here means "owned, operator-accepted reduction", not delivered parity.

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "CLI and Board disposition"
- Code: `apps/web/src/modules/registry.ts`; `apps/web/src/modules/workspace`, `inbox`, `teams`
- Shim: `--agent <spec-id>` warn-once path — [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4

### History

- 2026-09-13T15:10:05.371Z todo → cancelled (system)
- 2026-09-14T05:43:01.156Z todo → wip (system)
- 2026-09-14T14:16:54.132Z wip → testing (system)
- 2026-09-14T14:41:42.384Z testing → done (system)

