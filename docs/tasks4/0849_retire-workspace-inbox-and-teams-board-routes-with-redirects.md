---
schema_version: 1
name: Retire Workspace, Inbox, and Teams board routes with redirects
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.302Z
updated_at: "2026-09-12T16:40:31.534Z"
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
  capability becomes unreachable.
- **R3** — The `--agent <spec-id>` shim is removed after confirming no workflow or plugin usage.
- **R4** — Removal is gated on Robin's recorded cutover window.
- **R5** — Board tests referencing the retired modules move to their Projects equivalents rather than
  being deleted.

### Acceptance Criteria

```gherkin
Feature: Retire Workspace, Inbox, and Teams board routes

  @core
  Scenario: Board routes retire with a migration path
    Given Workspace, Inbox, and Teams routes and bookmarks
    When the navigation entries are removed
    Then existing routes redirect into the equivalent Projects view
    And no Board capability is unreachable

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

| Change | Files |
| --- | --- |
| Delete modules | `apps/web/src/modules/{workspace,inbox,teams}/` — minus the moved file below |
| Move (not delete) | `apps/web/src/modules/teams/MemberTerminal.tsx` → `apps/web/src/modules/projects/MemberTerminal.tsx`; update 0842's import |
| Redirects | `apps/web/src/router.tsx` — new `RETIRED_ROUTES` table |
| Tests | `apps/web/tests/modules/{workspace,inbox,teams}/**`, `tests/lib/use-teams-data.test.ts`, plus reference updates in `tests/components/{BoardLayout,GlobalAgentBar}.test.tsx` |
| Shim | `apps/cli/src/commands/agent.ts` marker + `config/transition-shims.json` entry `agent-flag-spec-id` |
| Untouched | `apps/web/src/lib/process-stream.ts` (MemberTerminal's transport), `apps/server/src/modules/team/` (G63 consumes `/api/team/*`), `packages/app/src/services/team-service.ts` |

**Redirect table (R2), frozen.** A static array, because `router.tsx` derives every route from
`modules.flatMap(...)` — once a module directory is gone there is no route object left to attach a
redirect to. Both the bare path and its wildcard are registered so deep links do not 404:

```ts
// router.tsx
export const RETIRED_ROUTES: ReadonlyArray<{ from: string; to: string }> = [
    { from: 'workspace', to: '/board/projects' },
    { from: 'inbox', to: '/board/projects/conversation' },
    { from: 'teams', to: '/board/projects/agents' },
];
```

rendered as `{ path: from, element: <Navigate to={to} replace /> }` plus `{ path: `${from}/*`, … }`
inside the existing `/board` children array. Targets follow the capability, not the name: Workspace's
default tab was Overview (a project summary the Projects header now carries), Inbox is the durable
message plane (Conversation, 0841), Teams is the roster and member terminal (Agents, 0842).

**Why these are permanent routes and not a transition shim.** ADR-058 requires an objectively
checkable removal condition. "No bookmark anywhere still points at `/board/teams`" is not checkable,
so registering them as a shim would create a manifest entry that can never be retired — the opposite
of the gate's purpose. Three `Navigate` elements are cheaper than the machinery.

**Shim removal (R3) is a two-sided delete in one commit.** `transition-shim-check` fails on an
unregistered marker *and* on a registered entry whose marker is gone, so deleting
`warnAgentSpecIdOnce` + its `@transition-shim(agent-flag-spec-id)` marker and the manifest entry must
land together. The evidence is 0846's `legacy-flag-usage` artifact kind, which already scans for
`--agent <spec-id>` usage; a repo-wide grep at refine time found none — only role and executor values.
The other three manifest entries are untouched: they belong to the role transition (B2), not to G6.

**Gating on Robin's window (R4).** The whole change is one commit that merges only after the cutover
window is recorded in G64's Notes. If Robin wants a reversible canary first, the existing
`disabledModules` array (`apps/web/src/modules/config.ts:2`) drops the three ids from the enabled set
without deleting anything, and the redirect table works either way — the routes are static, not
derived. That is the rollback lever, not a required step.

**Test migration (R5), by kind.** Tests that assert a *capability* move to the Projects test that owns
that capability; tests that assert a *deleted composition shell* go with it:

| Test | Disposition |
| --- | --- |
| `tests/modules/teams/MemberTerminal.test.tsx` | moves with the file to `tests/modules/projects/` |
| `tests/modules/teams/{tabs,components}.test.ts(x)` | roster/terminal assertions merge into 0842's Agents tests |
| `tests/modules/inbox/{tabs,inbox}.test.ts(x)` | message-plane assertions merge into 0841's Conversation tests |
| `tests/modules/workspace/**` | deleted — Workspace was a composition of the other three; it asserts no capability of its own |
| `tests/lib/use-teams-data.test.ts` | deleted **only if** the hook is orphaned (see below) |
| `tests/components/{BoardLayout,GlobalAgentBar}.test.tsx` | references updated in place; never deleted |

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
   makes this a precondition, not a checklist item. *(R1)*
2. **Confirm the cutover window is recorded** in
   `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md` Notes. No merge without it.
   *(R4)*
3. **Move `MemberTerminal`.** `git mv apps/web/src/modules/teams/MemberTerminal.tsx
   apps/web/src/modules/projects/MemberTerminal.tsx` and `git mv` its test to
   `apps/web/tests/modules/projects/`. Update the import in 0842's `MemberDetail.tsx` from
   `../teams/MemberTerminal` to `./MemberTerminal`. Its `process-stream.ts` import is unchanged.
   *Test:* the moved test passes unedited except for its import path — proof the component was moved,
   not rewritten. *(R2)*
4. **Add the redirect table** to `apps/web/src/router.tsx` exactly as frozen in the Design, with both
   the bare path and the `${from}/*` wildcard for each of the three entries. *(R2)*
5. **Test intent — redirects.** Mount the memory router at `/board/teams`, `/board/inbox`,
   `/board/workspace`, and at a sub-path of each (`/board/teams/anything`), and assert the resolved
   location is the mapped Projects route. Add one guard asserting no enabled module's `route` equals
   a `RETIRED_ROUTES.from` value — a future module reusing the `inbox` route would shadow the
   redirect silently. *(R2)*
6. **Delete the three module directories** (`workspace/`, `inbox/`, `teams/` — the latter now minus
   `MemberTerminal.tsx`). Discovery is directory-based, so deletion is the whole removal: the
   registry, the sidebar, and the derived routes all follow. *(R1)*
7. **Test intent — registry after removal.** Assert `getEnabledModules()` is exactly
   `['observability', 'history', 'features', 'tasks', 'projects']` in that order, and that
   `defaultModule.route === 'observability'` — the assertion that catches an accidental `order`
   renumber. *(R1)*
8. **Migrate the tests per the Design's disposition table.** Merge the teams roster/terminal
   assertions into 0842's Agents tests and the inbox message-plane assertions into 0841's
   Conversation tests; delete only `tests/modules/workspace/**`. Update the retired-module references
   in `tests/components/BoardLayout.test.tsx` and `tests/components/GlobalAgentBar.test.tsx` in place.
   *(R5)*
9. **Retire `useTeamsData` only if orphaned.** `rg -n "use-teams-data" apps/web/src`; on zero hits
   delete `apps/web/src/lib/use-teams-data.ts` and `apps/web/tests/lib/use-teams-data.test.ts`. On
   any hit, keep both and record the surviving consumer in the Solution section. *(R5)*
10. **Prove the `--agent <spec-id>` shim is unused.** Run 0846's `legacy-flag-usage` scan, or
    equivalently `rg -n -- "--agent " config/workflows .spur/workflows plugins/sp docs scripts` and
    check each hit against the spec ids under `.spur/agents/`. A single spec-id hit stops step 11.
    *(R3)*
11. **Remove the shim on both sides in one commit:** delete `warnAgentSpecIdOnce` and its
    `@transition-shim(agent-flag-spec-id)` marker in `apps/cli/src/commands/agent.ts`, delete every
    call site, and delete the `agent-flag-spec-id` entry from `config/transition-shims.json`. Leave
    the three sibling entries alone. *Test:* `bun run transition-shim-check` passes; a deliberate
    half-removal (entry kept, marker gone) fails it — assert both directions so the gate is proven,
    not trusted. *(R3)*
12. **Gate.** `cd apps/web && bun test`, then `bun run spur-check`, then `spur task check 0849`.
    Record in the Solution section the three redirects with their targets, the moved file, and the
    orphan decision from step 9.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "CLI and Board disposition"
- Code: `apps/web/src/modules/registry.ts`; `apps/web/src/modules/workspace`, `inbox`, `teams`
- Shim: `--agent <spec-id>` warn-once path — [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4

### History
