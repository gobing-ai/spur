---
schema_version: 1
id: "G64"
name: "Retire Workspace, Inbox, Teams, and spur team"
status: done
priority: P2
tags: ["g6-program"]
created_at: "2026-09-12T04:42:44.350Z"
updated_at: "2026-09-15T06:34:48.115Z"
---

# G64: Retire Workspace, Inbox, Teams, and spur team

## Goal

Retire the overlapping surfaces once — and only once — their capabilities have real replacements:
the `spur team` CLI noun, the Board's Workspace / Inbox / Teams modules, and the legacy config and
spec identities behind them. Migration preserves mailbox identity, offers preview and rollback, and
supersedes the ADRs it invalidates instead of leaving contradictory authority in the tree.

## Scope

- In:
    - **Config and spec migration** per the preserve/convert/retire matrix
      ([runtime inventory](../reports/g6-runtime-inventory.md) §4): convert `agent.team.<id>` blocks
      to project fleet declarations; convert generated specs **with stable-ID preservation** (a spec
      id is the mailbox identity and occupant address — breaking it orphans inbox and coordination
      rows); preserve hand-authored specs; re-link or retire orphan specs; resolve teams whose
      `work_dir` disagrees with the project path; keep deterministic `<role>-<n>` derivation.
    - **Migration mechanics** — inventory report, dry-run preview, backup, idempotent conversion,
      rollback path, and old-client/schema compatibility. Any temporary alias table is tracked under
      ADR-058 with an explicit exit condition. No indefinite dual-writing of rosters or queues and
      no deletion of historical messages.
    - **`spur team` retirement** — migrate assign / status / up / down / start / stop callers to
      their owning nouns (`spur agent`, `spur message`, `spur projects`, task write service) before
      the noun is removed. `TeamService` capabilities are moved, not deleted with the command.
      Public-surface consent governs any new verb.
    - **Board route retirement** — remove Workspace, Inbox, and Teams navigation after G63 replaces
      them functionally; migrate routes and bookmarks; retire the `--agent <spec-id>` warn-once shim
      after confirming no workflow or plugin usage.
    - **Authority reconciliation** — supersede ADR-052 (team-scoped composition) explicitly; retain
      ADR-037 (registry) and ADR-057 (control-plane boundary); ADR-022 keeps task lifecycle. Update
      `docs/03_ARCHITECTURE.md`, the owning design satellites, CLI references, init templates, and
      plugin callers. Do not rewrite historical ADRs or feature receipts.
    - **Corpus reconciliation** — resolve M6 (Workspace Overview removal / Inbox-Teams label split,
      backlog), M3 (Teams board UX, verifying), and any remaining G1 / G4 work against this program
      before creating duplicate tickets.
- Out:
    - Choosing the cutover window itself — that is Robin's breaking-change decision, recorded here
      as a gate, not assumed by implementation.
    - Any destructive schema migration, deletion of historical messages, or forced roster merge.
    - New capabilities: this feature only moves, preserves, or removes what already exists.

## Acceptance Criteria

```gherkin
Feature: Retire Workspace, Inbox, Teams, and spur team

  @core
  Scenario: R1 — Migration previews before it changes anything
    Given an existing project with team config, generated specs, manual specs, and orphans
    When the migration runs in dry-run
    Then it reports every conversion, preservation, and retirement with its conflicts
    And no file, config, or database row has changed

  @core
  Scenario: R2 — Mailbox identity survives conversion
    Given generated specs addressed by existing inbox and coordination rows
    When the migration converts the roster
    Then every spec id is preserved verbatim or mapped through a recorded alias
    And no inbox or coordination row is orphaned

  @core
  Scenario: R3 — Conflicts halt rather than merge silently
    Given two legacy teams resolving to one project path, or a work_dir that disagrees with the project
    When the migration encounters them
    Then it reports the conflict and stops without merging or deleting
    And rollback restores the prior state

  @core
  Scenario: R4 — spur team is retired only after its callers move
    Given the team noun's assign, status, up, down, start, and stop callers
    When the noun is removed
    Then each capability is reachable under its owning noun
    And no capability is lost with the command

  @core
  Scenario: R5 — Board routes retire with a migration path
    Given Workspace, Inbox, and Teams routes and bookmarks
    When the navigation entries are removed
    Then existing routes redirect into the equivalent Projects view
    And no Board capability is unreachable, or its reduction is operator-accepted and owned

  @core
  Scenario: R6 — Superseded authority is corrected at its owner
    Given ADR-052's team-scoped composition no longer holds
    When this feature completes
    Then the supersession is recorded in docs/00_ADR.md with its replacement
    And architecture, design satellites, CLI references, and init templates match the shipped surface

  @core
  Scenario: R7 — The spec-id shim retires only when unused
    Given the --agent spec-id warn-once shim
    When no workflow or plugin caller remains
    Then the shim is removed


  @core
  Scenario: R8 — History is preserved
    Given historical ADRs and feature receipts
    When the supersession is recorded
    Then no historical decision or receipt is rewritten

```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0846 | Migration inventory and dry-run preview with conflict reporting | done |
| 0847 | Roster conversion with verbatim spec-ID preservation and rollback | done |
| 0848 | Retire spur team after migrating its callers to owning nouns | done |
| 0849 | Retire Workspace, Inbox, and Teams board routes with redirects | done |
| 0850 | Reconcile superseded authority across ADRs, architecture, and templates | done |
| 0851 | Reconcile M6, M3, G1, and G4 remaining work into this program | done |
| 0852 | Restore Board reachability for the retired process watch list (executions + filters) | done |
| 0853 | Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down) | done |
| 0854 | Retire the team-scoped ADRs the fleet model replaced | done |
| 0855 | Remove the orphaned POST /api/team/:team/up\|down routes | done |
<!-- END AUTO-GENERATED -->

## Notes

Last slice of the G6 program — runs only after G61, G62, and G63 have functionally replaced what is
being retired. Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
§ "Migration and delivery order"; full disposition matrix with callers and rollback constraints:
[runtime inventory](../reports/g6-runtime-inventory.md) §4.

Blocking gate: **Robin owns the compatibility and removal window.** Retirement is requested and
approved in direction; no breaking cutover date has been selected. Migration evidence precedes the
choice — do not schedule this feature's destructive steps before that decision is recorded here.

Do not re-status M3, M6, G1, or G4 as part of this feature's planning; reconcile their remaining work
into concrete tasks here, or close them at their own owners with evidence. (Task 0851 executes that
closure — the prohibition governs planning, not 0851's own deliverable.)

### Implement-ready refinement (2026-09-12)

All six tasks refined to `--depth ready`; every Design freezes its names, precedence, and
anti-patterns, and every Plan step maps to an R-item with test intent. `spur task check` PASS on
0846–0851; `spur feature check G64` PASS.

### Premise corrections — the inventory's §4 line numbers have drifted

Every claim below was checked against the current tree during refinement; the corrected fact is what
the task Designs encode.

1. **`spur self migrate` is SQL-schema-only.** `apps/cli/src/commands/migrate.ts` runs
   `loadSqlMigrations(join(cwd, 'drizzle'))` + `applyCliMigrations`; it is not a config-migration
   home. A top-level `spur migrate` noun would collide with the hidden legacy alias registered at
   `apps/cli/src/index.ts:174-185`, and 0835 already rejected a `spur fleet` noun. The migration verb
   is therefore **`spur projects migrate`** (`--dry-run` in 0846, `--apply` in 0847) — `projects`
   already owns the registry the conversion targets. It needs its own consent row; 0846's Design
   drafts it verbatim rather than riding an existing one (A3 no-further-promotion rule).
2. **Conversion can be purely additive, so backup collapses to one file.** Because spec ids are
   preserved verbatim, existing `.spur/agents/<id>.yaml` files are *already* correct — 0847 never
   opens a spec for writing. That is what makes "no inbox or coordination row is orphaned" (R2)
   provable rather than asserted, and it is why `agent.team.<id>` stays in place through 0847.
3. **`FleetMember` cannot carry six of `TeamMemberConfigSchema`'s keys** (`workspace`, `model`,
   `autonomy`, `systemPrompt`, `command`, `autostart` —
   `packages/config/src/index.ts:366-392`). Mapping `autostart` onto `enabled` would conflate "spawn
   at serve start" with "in the fleet". 0846 emits a non-blocking `unmapped-member-override` warning
   instead, and **0848 halts on it** before any `agent.team.<id>` block is deleted.
4. **`addressedSpecIds` makes retire-vs-relink deterministic.** `SELECT DISTINCT to_id FROM
   inbox_messages` ∪ `SELECT DISTINCT spec_id FROM coordination_runs` decides an orphan spec's
   disposition from data rather than judgment, and gives 0847 R2 a falsifiable assertion.
5. **No alias table is needed.** R2 allows "preserved verbatim **or** mapped through a recorded
   alias"; verbatim preservation is achievable in every case, and the one rename-forcing case
   (`derived-id-collision`) halts instead of renaming. Nothing is registered under ADR-058 for the
   roster.
6. **The retired Board modules have no URL-addressable tab state.** `WorkspaceShell.tsx:19`,
   `TeamsShell`, and `InboxShell` hold the active tab in `useState` — unlike 0840's `useProjectTab`,
   which reads the path segment. R5's migration path is therefore **three** static redirects
   (`workspace` → `/board/projects`, `inbox` → `/board/projects/conversation`, `teams` →
   `/board/projects/agents`), not a per-tab mapping.
7. **The default landing route is `observability`, not the first module alphabetically.** Every module
   declares `order` (observability 10 … teams 70; projects 45 per 0840) and `compareModules`
   (`discover.ts:66-72`) lifts declared-order modules first. Deleting 50/60/70 leaves the landing
   route unchanged — **no renumbering**.
8. **`apps/web/src/modules/teams/` cannot be deleted wholesale.** 0842 mounts `MemberTerminal`
   (`teams/MemberTerminal.tsx:66`) in the Projects Agents tab. 0849 **moves** the file into
   `modules/projects/`; deleting it would break G63.
9. **The `agent-flag-spec-id` shim's marker and manifest entry disagree** — the source comment
   (`apps/cli/src/commands/agent.ts:690-692`) says `.spur/workflows/`, the manifest says
   `config/workflows/`. 0849's scan covers both. A repo-wide grep at refine time found **no** spec-id
   `--agent` usage, only role and executor values.
10. **No ADR is allocated for the G6 program, and `docs/00_ADR.md` ends at ADR-115.** 0850 allocates
    **ADR-116** (project-scoped fleet composition) as ADR-052's replacement, flips ADR-052's status
    line at `:500`, and retains ADR-037 / ADR-057 / ADR-022 by naming them in ADR-116 rather than
    editing three correct ADRs.
11. **`config/config.example.yaml` is the portable init template.** `init.ts:170` seeds it as
    `~/.config/spur/config.yaml` on first run, so its `agent.team` block (`:183-184`) is what every
    new project inherits — the one artifact R4 of 0850 is actually about.
12. **0851's scope is a disposition record, not a pile of tickets.** M6 is `backlog` with **zero**
    linked tasks; M3, G1, and G4 are `verifying` with **every** linked task `done`, so their status is
    a verify/wrap gap at their own owners, not remaining implementation.

### Decisions closed at refinement (Robin may override)

- **Migration verb → `spur projects migrate`,** consent-gated, with the rejected shapes recorded
  (top-level `spur migrate` collides with the hidden `self migrate` alias; `spur fleet` rejected by
  0835). Plan steps that do not register CLI surface proceed without the grant.
- **`spur team` verb coverage (0848).** `assign` → `spur task update <wbs> --assignee <spec-id>`;
  `status` → `spur agent list --specs` gaining the live run-status merge (`team.ts:147-159`);
  `--by-team` **dropped**, because one project has one fleet and the group key ceases to exist;
  `up` → **no CLI verb** (config-only per the brief; `up --check`'s diff is `spur projects list
  --fleet`); `down` → `spur agent stop` plus the already-existing `spur agent delete`
  (`agent.ts:215`); `start`/`stop` → `spur agent start|stop <spec-id>`. Net consent ask: **2 new
  verbs + 1 new flag + 1 observable-output change**, drafted as one row in 0848's Design.
- **Board redirects are permanent routes, not a transition shim.** ADR-058 requires an objectively
  checkable removal condition; "no bookmark points here any more" is not checkable, so a shim entry
  could never retire. Three `Navigate` elements in `router.tsx` instead.
- **`spur team`'s docs are deprecated, not deleted, by 0850.** 0848 ships a warning and keeps all six
  verbs working until the cutover window, so deleting `team.md` or `docs/help2/team.md` in 0850 would
  make the references contradict the shipped CLI.
- **M6 closes `cancelled`, evidence first.** Its Overview deletion is subsumed by 0849, its label
  split is made moot by the same deletion, its "keep Workspace as a lens" decision is reversed by
  ADR-116, and its no-`role`-noun recommendation is already honored. `done` would claim its design
  shipped.
- **M3 resolves by merge order:** verified before 0849 merges → `done` on `0269`'s receipt; 0849
  merges first → `cancelled` citing the retirement commit. Its backend half (`/api/team/teams`
  `model`, `/api/messages` identity enrichment, `process.*` in Activity) survives and is reused by
  0842.
- **One residual, evidence-gated:** M6's "`workDir` + `model` in the member row". 0842's
  `MemberDetail.tsx` does not name either field. After 0842 ships, create **one** task only if both
  are absent — filing it now would be the duplicate R4 forbids.

### Still Robin's, unchanged

- **The cutover window — RECORDED, 2026-09-14.** 0848's shim removal condition, 0849's merge gate,
  and 0850's deletion of the superseded reference files all name this record as their trigger.
  Robin authorized the Board retirement to proceed in session on 2026-09-14 (task 0849 run):
  **the cutover window is open as of 2026-09-14**, so the destructive steps in 0849 (module
  deletion, redirects, shim removal) may land. G61/G62/G63 are functionally complete and 0840–0848
  and 0851 are `done`. Rollback lever unchanged: `apps/web/src/modules/config.ts`'s
  `disabledModules` is not used by 0849, and the redirect table is static, so a revert of the
  retirement commit restores the three modules without touching routes.
- **Public-surface consent** for `spur projects migrate` (0846/0847) and for 0848's two verbs, one
  flag, and output change. Both rows are drafted in their task Designs, granted by nobody yet.

### Current reconciliation — operator-approved staging (2026-09-13, task 0851)

Robin explicitly keeps 0849 and 0850 temporarily cancelled until the other G64 tasks pass and are
ready to ship. He will re-enable those two tasks for cleanup later. This supersedes the earlier
merge-order assumption: no retirement merge or ADR-116 is claimed to exist. Existing cancellation
statuses represent superseded plans and retained cleanup ownership, not delivered removal.

| Remaining item | Single disposition / owner |
| --- | --- |
| M6 Overview deletion | Existing G64 task 0849 owns removal of the Workspace module; deferred by Robin. |
| M6 Inbox/Teams Supervisor label collision | Existing task 0849 removes both surfaces; collision remains until that intentional cleanup, with no duplicate interim rename. |
| M6 Workspace-as-lens decision | Existing task 0850 owns ADR-052 supersession after cutover; ADR-052 remains Accepted today. |
| M6 member workDir/model | Resolved in 0851: Projects MemberDetail uses the existing shared teams feed, matches the selected spec id, shows its model and common working directory, and names unavailable/default values. |
| M6 no-role-noun recommendation | Already honored: role remains a spec value, with no new role noun. |
| M3 Teams UI verification/retirement | Existing task 0269 delivered the implementation; no UI reimplementation. Task 0849 owns final retirement. M3 stays cancelled as a superseded plan, not as evidence of shipped deletion. |
| G1 message transport / G4 occupant identity | Retained authorities consumed by G61–G64; their own verify/wrap work and statuses remain with those features. |

Every retirement-dependent item has a concrete existing task (0849 or 0850), including its deferred
status and re-enable owner. The non-cleanup residual is implemented; no duplicate task was created.
The G64 roster remains exactly 0846–0851. The four included tasks can be verified independently;
full G64 R5/R6 retirement readiness stays pending until 0849/0850 are re-enabled and pass.

### Supersession — 2026-09-14, tasks 0849/0850 executed

The staging block above is history, not current state. Task 0849 ran on 2026-09-14 with the cutover
window recorded (see "Still Robin's, unchanged"), which re-enables the destructive steps: the
Workspace/Inbox/Teams modules and their routes are retired behind redirects, and the
`agent-flag-spec-id` shim is deleted on both sides. Task 0850's ADR-116 supersession follows from the
same window opening. The 2026-09-13 note's "no retirement merge is claimed to exist" is therefore
superseded by 0849's retirement commit.

Two facets that 0849's Design did not carry into Projects are owned rather than silently dropped: the
process watch list (task 0852) and the 0378 supervisor facets — uptime, live roster activity, team
up/down (task 0853). On this run's verify report (PARTIAL on R2/AC1 and on R5's deleted-not-moved test
groups), **Robin accepted the reduction on 2026-09-14** rather than restoring them: 0852 and 0853 stay
backlog owners for any future reinstatement, and the amended R2 reads "no Board capability becomes
unreachable without a recorded, operator-accepted reduction that names its owning task". The redirect
half is delivered and verified — resolved path, landing tab, deep links, and the shadow guard.

### Noun removal — 2026-09-14 (dev-idea direct cleanup)

The deprecated `spur team` noun is removed outright: `apps/cli/src/commands/team.ts`, its tests, the
`team-noun-retired` transition shim, `docs/help/cmd_team.md`, `docs/help2/team.md` and the
`sp:spur-cli` team reference are deleted. Every capability already had an owning-noun home (0848):
`task update --assignee`, `agent start|stop`, `agent list --specs`. `spur agent create|edit|delete`
are removed — specs are materialized from the fleet declaration at serve start, so CLI authoring was a
second, unvalidated write path. `spur agent loop` stays as a hidden supervisor-internal surface with
`--spec <id>` only. Consent row: `docs/design/harness-surface-governance.md` (2026-09-14). The
`agent.team` config key, `.spur/fleet.json` → `agent.fleet`, and `/api/team` routes move under the
follow-up feature "Fleet declaration in spur config".

## History

- 2026-09-13T00:12:11.441Z backlog → active (system)
- 2026-09-15T01:05:03.022Z active → verifying (system)
- 2026-09-15T06:34:48.115Z verifying → done (system)

