---
schema_version: 1
name: Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down)
status: done
template: feature-impl
created_at: 2026-09-14T06:06:21.909Z
updated_at: "2026-09-15T01:23:17.879Z"
feature_id: G64

---

## 0853. Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down)

### Background

retired surface onto a Projects capability — Workspace → the project summary in the Projects header,
Inbox → Conversation (0841), Teams → the roster and member terminal (Agents, 0842). The 0842 roster
is a declared-vs-observed design, so three facets that `TeamsShell`'s SupervisorTab (0378) owned
retired with the shell and have no successor or owner today:

- **Per-member uptime (0378 R3).** The supervisor roster showed each member's uptime derived from the
  process start time. `AgentsView` shows declared and observed facts (status, pid, exit code) but no
  uptime; `uptime` has no occurrence in `apps/web/src`.
- **Live last-activity (0378 R4).** The roster kept each member's last activity fresh from the board's
  planning SSE stream. `apps/web/src/modules/projects/MemberDetail.tsx:60-77` reads
  `/api/events/history` once on open and carries an explicit `ponytail:` note that a live SSE tail
  was not added; only the Features and Observability modules subscribe to event streams.
- **Team up/down Board controls (0378 R5).** Both Board callers were deleted with the tab, while
  `POST /api/team/:team/up` and `/down` survive (`apps/server/src/modules/team/index.ts:250,280`) with
  no caller. G63's CLI story moved `up` to fleet materialization at serve start and `down` to
  `spur agent stop` (0848), so the Board control's removal may be intended — but no record says so.

Captured by the 0849 review pass 2 as a P2 (major) finding: 0849's `R2` requires that "no Board
capability becomes unreachable", and these three facets are unreachable with no owner. This task is
the owner; whether each returns or is formally dropped is the operator decision it records.

### Requirements

- **R1** — Each of the three facets (uptime, live last-activity, team up/down) gets an explicit
  recorded decision: reinstate on a surviving Board surface, or record the removal with its reason.
  The decisions are frozen in this task's Q&A (auto-refine 2026-09-14): **uptime = reinstate** on
  the Agents roster card; **live last-activity = removal recorded** (point-in-time activity stays
  in MemberDetail); **team up/down Board controls = removal recorded** (G63/0848 CLI successors).
- **R2** — The uptime reinstatement respects the frozen tab contracts of the surface it lands on —
  Projects' three tabs (Conversation, Agents, Work) are fixed by 0840; do not add a fourth. Uptime
  lands on the existing Agents roster card, no new tab, no new route.
- **R3** — Do not introduce a second event-stream subscriber or a new fetch for the roster. The
  poll tick that can carry the fact is **AgentsView's own** `setInterval(tick, pollMs)`
  (`apps/web/src/modules/projects/AgentsView.tsx:126`), which already refetches fleet + processes;
  `useProjectContext` is a one-shot mount fetch and carries nothing live. Uptime must derive from
  data the existing tick already returns (`RosterEntry.observed.startedAt`).
- **R4** — `POST /api/team/:team/up|down` has no caller anywhere outside its own server tests
  (verified repo-wide 2026-09-14). That is a server-surface removal decision, not a silent orphan:
  name it here and route removal (routes + tests + `docs/design/observability-contracts.md` rows)
  to a new follow-up task created via `spur task create`, linked from this task's References.

### Acceptance Criteria

- **AC1 — Uptime reinstated on the Agents roster (R1, R2, R3).**
  Given a fleet member whose `observed.status` is `running` with a known `startedAt`, when the
  Agents tab renders its roster cards, then the member's card shows an uptime string derived from
  `startedAt` (largest two units), and it advances on the existing poll tick with no additional
  network request. Given a member that is not running (or has null `startedAt`), when the roster
  renders, then no uptime line appears for that member.
- **AC2 — Removal decisions recorded (R1).**
  Given the three retired facets, when this task is complete, then the task's Q&A records an
  explicit reinstate-or-removed decision per facet with its reason, and each removed facet names
  its successor: live last-activity → MemberDetail's read-on-open history (with the `ponytail:`
  sseUrl upgrade path), team up/down → fleet materialization at serve start and `spur agent stop`.
- **AC3 — Orphaned server routes routed, not orphaned (R4).**
  Given `POST /api/team/:team/up|down` has no non-test caller repo-wide, when this task is
  complete, then a follow-up task created via `spur task create` owns removal of those routes,
  their server tests, and the `observability-contracts.md` rows, and this task's References link
  to it. The routes themselves still exist after this task — deletion is the follow-up's scope.
- **AC4 — Contracts hold (R2, R3).**
  Given the implementation, when the diff is inspected, then Projects still has exactly three tabs,
  the roster path adds no fetch/subscription (only the `roster.ts` helper and the `AgentsView.tsx`
  render line changed in `apps/web`), and the new `formatUptime` unit tests pass along with the
  existing projects suites.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-14T23:07:22.007Z

#### Q1 — Uptime: reinstate or drop?

**Decision: REINSTATE on the Agents roster card.** `RosterEntry.observed.startedAt` already exists
(`apps/web/src/modules/projects/roster.ts:45`) and rides the existing AgentsView poll tick, so the
facet costs one render-time derivation and zero plumbing. `ProcessesView.tsx:354` already renders
`startedAt` as precedent. Dropping a nearly-free fact the supervisor roster used to show would be
the worst option. Chosen over MemberDetail placement because the roster card is where 0378 R3
surfaced it and where the poll already refreshes.

#### Q2 — Live last-activity on the roster: reinstate or drop?

**Decision: REMOVAL RECORDED.** `RosterEntry` carries no `lastActivity` and no server payload
provides one; a live roster facet would need either a second event-stream subscriber (R3 forbids)
or a widened processes payload (a server change for a glance-level fact). Point-in-time activity
already survives in `MemberDetail.tsx` (read-on-open from `/api/events/history`), whose `ponytail:`
comment names the upgrade path — `sseUrl` tailing — if the pane ever becomes a dwell surface.
Removed with reason: *live roster activity has no data source that satisfies R3; the read-on-open
snapshot in MemberDetail is the recorded successor.*

#### Q3 — Team up/down Board controls: reinstate or drop?

**Decision: REMOVAL RECORDED — the removal was intended, not accidental.** G63's CLI story moved
`up` to fleet materialization at serve start and `down` to `spur agent stop` (0848); the Board
buttons' deletion with SupervisorTab is the designed end state, and 0854 (done) retired the
team-scoped Board ADRs on the same premise. Reason: *Board up/down is superseded by the fleet
model's CLI lifecycle; no Board surface gets the controls back.* R4 fallout — the orphaned server
routes — is routed to a follow-up task (see Plan step 4), not executed here.

#### Q4 — Premise correction (auto-refine, no operator input needed)

R3 as drafted named the "existing `useProjectContext` poll"; verified against the tree,
`useProjectContext.tsx` fetches once on mount — the roster's live tick is AgentsView's own
interval (`AgentsView.tsx:126`). R3 was rewritten to name the real carrier. No design change.

#### Q5 — Stale M2 claim (routed, not edited here)

`docs/features/M2_teams-residual-polish-for-release-post-m1.md` still calls for "Surface team
Up/Down bulk controls in the Teams UI" — superseded by G64's retirement and the Q3 decision.
Feature corpus is tool-owned; the implementer flags the conflict via `spur feature` tooling or to
the operator — never a raw edit, and never silently honored.

### Design

**WHAT** — Three recorded decisions (Q&A) plus exactly one code change: reinstate per-member uptime
on the Agents roster card, derived at render from the already-present
`RosterEntry.observed.startedAt`. The two removal decisions are record-only; the orphaned server
routes go to a follow-up task.

**WHY** — 0849 R2 ("no Board capability becomes unreachable") is satisfied by giving each retired
facet an owner and a decision, not by rebuilding the supervisor tab. Uptime is the only facet whose
data already reaches the Board, so it is the only one reinstated.

**WHERE (frozen names)**

- Helper: `formatUptime(startedAt: string, now?: number): string | null` in
  `apps/web/src/modules/projects/roster.ts` — pure, next to `buildRoster` (the file declares itself
  "the unit under test"). Returns `null` for non-running/absent `startedAt`; `now` injectable for
  tests. Shape: `up 4m`, `up 2h 13m`, `up 3d 1h` (largest two units; no seconds).
- Render: one line on the roster card in `apps/web/src/modules/projects/AgentsView.tsx`, shown only
  when `entry.observed.status === 'running'` and `formatUptime(...) !== null`. No new fetch, no new
  state — the existing tick (`AgentsView.tsx:126`) refreshes it.
- Tests: extend the existing roster test file (`apps/web/tests/modules/projects/` — the
  `buildRoster` suite) with `formatUptime` cases: running 4 minutes, hours+minutes, days, null
  `startedAt`, non-running.
- Record: this task's Q&A is the decision record; Plan step 4 creates the follow-up task
  (server/team noun) owning removal of `POST /api/team/:team/up|down` at
  `apps/server/src/modules/team/index.ts:250,280`, their describes in
  `apps/server/tests/modules/team/index.test.ts`, and the two contract rows in
  `docs/design/observability-contracts.md`.

**Anti-patterns — do not implement**

- No SSE/event-stream subscriber or new fetch anywhere in the roster path (R3).
- No fourth Projects tab, no route change (R2, frozen by 0840).
- No `lastActivity` field on `RosterEntry` or the processes payload (Q2).
- No Board UI calling `/api/team/:team/up|down` (Q3); no deletion of those routes in this task.
- No edits to `docs/design/inter-agent-control-plane.md` (another task's uncommitted changes are in
  flight there) and no raw edits to feature corpus (M2 conflict routes via `spur feature`, Q5).

**Handoffs** — the follow-up route-removal task (created in Plan step 4) owns the server surface;
M2's stale up/down bullet is flagged to `spur feature` tooling, not fixed here. No `dependencies[]`
changes; sibling residual 0852 (process watch list) is untouched.

### Plan

1. Add `formatUptime(startedAt: string, now?: number): string | null` to
   `apps/web/src/modules/projects/roster.ts` (pure helper beside `buildRoster`). (R1, AC1)
2. Extend the roster test suite under `apps/web/tests/modules/projects/` with the five
   `formatUptime` cases named in Design; run that test file first. (AC1, AC4)
3. Render the uptime line on the roster card in
   `apps/web/src/modules/projects/AgentsView.tsx` — running entries only, no new state or fetch.
   (R2, R3, AC1)
4. Create the follow-up removal task:
   `spur task create "Remove the orphaned POST /api/team/:team/up|down routes" --json`
   seeding Background with this task's R4 + Q3 (routes at
   `apps/server/src/modules/team/index.ts:250,280`, tests in
   `apps/server/tests/modules/team/index.test.ts`, contract rows in
   `docs/design/observability-contracts.md`); link its WBS in this task's References. (R4, AC3)
5. Author `## Solution` (change map) and confirm the Q&A record matches what shipped; flag the M2
   stale bullet via `spur feature` tooling or to the operator (Q5). (AC2)
6. Verify: focused projects/roster tests, then `bun run spur-check` once; confirm AC4's guards
   (`rg` shows no new fetch/subscription in the roster path; three tabs unchanged). (AC4)

### Solution

Reinstates the supervisor uptime facet (R1/AC1) on the 0842 roster, deriving it from data the
existing process poll already carries — no new fetch or subscription (R3, AC4).

- `apps/web/src/modules/projects/roster.ts:125-145` — exported `formatUptime(startedAt, now?)`
  next to the join: largest two units, never seconds (`up 4m`, `up 2h 13m`, `up 3d 1h`); null for
  an absent start, an unparseable timestamp, or a future one (clock skew would read as negative).
  Signature widened from the Design's `startedAt: string` to `string | null` to mirror
  `RosterEntry.observed.startedAt` and make the AC1 null case type-honest (only deviation).
- `apps/web/src/modules/projects/AgentsView.tsx:194-195` — `RosterCard` computes
  `uptime = status === 'running' ? formatUptime(entry.observed.startedAt) : null` beside its other
  derived fact, so exited/not-started members and null `startedAt` render no line (AC1).
- `apps/web/src/modules/projects/AgentsView.tsx:239-243` — one muted `data-roster-uptime` line on
  the card between the declared/observed facts and the issue list.
- `apps/web/tests/modules/projects/roster.test.ts:175-198` — five `formatUptime` unit cases in the
  existing `buildRoster` suite file: 4 minutes, hours+minutes, days, null `startedAt`, future start.

Not done here by decision: Board up/down controls stay deleted (Q3); the orphaned
`POST /api/team/:team/up|down` routes are owned by follow-up 0855 (R4/AC3, linked in References).
Live last-activity stays retired — MemberDetail's read-on-open history is the successor (Q2).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All three facet decisions frozen in the task Q&A with reasons and successors — uptime REINSTATE (Q1), live last-activity REMOVAL RECORDED → MemberDetail read-on-open history (Q2), team up/down REMOVAL RECORDED → 0848 CLI successors (Q3) (`docs/tasks4/0853_record-ownership-for-the-retired-teams-supervisor-facets-upt.md:37-47` — anchor re-read this run); shipped code is the uptime facet: `apps/web/src/modules/projects/roster.ts:136-147` `formatUptime` (re-read this run), `apps/web/src/modules/projects/AgentsView.tsx:193-194` (derivation, re-read) and `:239-241` (render, re-read); green inside the fresh web batch: cd apps/web && bun test tests/modules/registry.test.ts tests/components/LeftSidebar.test.tsx tests/components/BoardLayout.test.tsx tests/modules/projects/ProcessesView.test.tsx tests/modules/projects/roster.test.ts tests/modules/projects/MemberTerminal.test.tsx tests/modules/projects/activity-history.test.ts tests/modules/projects/MemberDetail.test.tsx tests/modules/projects/conversation.test.ts tests/modules/projects/ConversationView.test.tsx — exit 0, 130 pass / 0 fail / 438 expect (fresh 2026-09-14) |
| R2 | MET | Uptime lands on the existing Agents roster card — no fourth tab, no new route: `apps/web/src/modules/projects/tabs.tsx:17-21` still exactly conversation/agents/work (re-read this run; file untouched by the diff); render at `apps/web/src/modules/projects/AgentsView.tsx:239-241` (re-read) |
| R3 | MET | No new fetch or subscriber: AgentsView's only fetches are the pre-existing fleet+processes pair (`apps/web/src/modules/projects/AgentsView.tsx:108-109` — re-read this run) on the pre-existing `setInterval(tick, pollMs)` (`AgentsView.tsx:126` — re-read); uptime derives at render from `RosterEntry.observed.startedAt` (`apps/web/src/modules/projects/roster.ts:45`, `:74` — re-read); fresh grep this run: `new EventSource` sites under apps/web/src unchanged (task-kanban/useTasks.ts, projects/MemberTerminal.tsx, features ×2, observability ×2 — no roster tail) |
| R4 | MET | Orphaned routes named and routed, then REMOVED by their owner: Q3 records the removal decision; follow-up 0855 exists and is now `done` — fresh route audit this run: seven surviving routes at `apps/server/src/modules/team/index.ts:41,77,88,99,120,213,250`, no up\|down handlers; `rg -n 'team/:team/(up\|down)' apps/server apps/web/src` → 0 hits (exit 1, fresh) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| **AC1 — Uptime reinstated on the Agents roster (R1, R2, R3).** | MET | test | `roster.ts:136-147` formatUptime + `AgentsView.tsx:193-194`, `:239-241` (anchors re-read); roster suite green inside the fresh 130-pass web batch; tab contract intact (`tabs.tsx:17-21` re-read); no new fetch/subscriber (`AgentsView.tsx:108-109`, `:126` re-read; EventSource grep fresh) |
| **AC2 — Removal decisions recorded (R1).** | MET | command | Task Q&A freeze re-read this run (`docs/tasks4/0853_….md:37-47`): three explicit decisions with reasons and successors |
| **AC3 — Orphaned server routes routed, not orphaned (R4).** | MET | command | 0855 delivered the removal: fresh route audit (7 surviving routes, no up\|down) + repo grep 0 hits for `team/:team/up\|down` outside historical docs — both this run |
| **AC4 — Contracts hold (R2, R3).** | MET | test | `tabs.tsx:17-21` unchanged (re-read); single process-poll pair unchanged (`AgentsView.tsx:108-109`, `:126` re-read); full web batch green (130 pass / 0 fail, fresh) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0853

**Scope:** 0853 working-tree diff (uncommitted): `apps/web/src/modules/projects/roster.ts`, `apps/web/src/modules/projects/AgentsView.tsx`, `apps/web/tests/modules/projects/roster.test.ts`, task docs 0853/0855. Excluded per stage contract: 0852's in-flight siblings (MemberTerminal.tsx, WorkView.tsx, ProcessesView.tsx + test, docs/design/project-switcher.md).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | Sub-minute age renders `up 0m`; the frozen shape examples (`up 4m` / `up 2h 13m` / `up 3d 1h`) never name the <60s case and the "never seconds" rule makes `up 0m` unavoidable — acceptable, flag only if it reads oddly in practice | `apps/web/src/modules/projects/roster.ts:145` |
| 2 | P4 (advisory) | correctness | Unparseable `startedAt` → null (NaN guard) is the helper's only untested branch; Design specified exactly five cases and the implementation ships exactly those five, so this is polish, not a gap vs Design | `apps/web/src/modules/projects/roster.ts:140` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | All three facet decisions frozen in Q&A with reasons and successors (task doc Q&A Q1–Q3); uptime reinstated: `apps/web/src/modules/projects/roster.ts:136-147`, `apps/web/src/modules/projects/AgentsView.tsx:194,239-241` |
| R2 | MET | No tab/route change: `apps/web/src/modules/projects/tabs.tsx:7,19-21` still exactly three tabs (`conversation|agents|work`), untouched by the diff; render lands on the existing roster card |
| R3 | MET | Diff adds no fetch/subscription; `formatUptime` derives from `RosterEntry.observed.startedAt` (`apps/web/src/modules/projects/roster.ts:45,74`), carried by AgentsView's own poll (`apps/web/src/modules/projects/AgentsView.tsx:126` `setInterval(tick, pollMs)` → `setEntries` → render-time recompute) |
| R4 | MET | Follow-up 0855 created (spur task frontmatter, status todo) and linked from References; routes survive this task by design (`apps/server/src/modules/team/index.ts:250,280`) — deletion is 0855's scope |
| AC1 | MET | Running-only guard and null for absent/future start (`AgentsView.tsx:194`, `roster.ts:137-140`); five unit cases at `apps/web/tests/modules/projects/roster.test.ts:177-199` |
| AC2 | MET | Q&A Q1/Q2/Q3 record an explicit reinstate-or-removed decision per facet with reasons; removed facets name successors (MemberDetail read-on-open history; fleet materialization at serve start + `spur agent stop`) |
| AC3 | MET | `docs/tasks4/0855_remove-the-orphaned-post-api-team-team-up-down-routes.md` exists, seeded from R4/Q3, linked in this task's References |
| AC4 | MET | Only `roster.ts` + `AgentsView.tsx` changed in apps/web (0852 siblings excluded per stage contract); fresh evidence: focused suite 20 pass / 0 fail; gate `0853-test-gate.log` 8507 pass / 0 fail, proof digest `sha256:af01244e…` matches `0853-proofdigest.txt` and `dev-run-0853-inline-160905-review-proof.digest`, and the gate log mtime is newer than all three source files |

##### SECUA (Security · Efficiency · Correctness · Usability · Architecture)

- **Security — PASS.** Uptime renders as a plain text node (`AgentsView.tsx:241`), no `dangerouslySetInnerHTML`; `startedAt` from the server payload goes through `Date` parsing with a NaN guard (`roster.ts:138-140`) — no injection surface, no new trust boundary.
- **Efficiency — PASS.** O(1) integer math per card per render; zero new network traffic (reuses the existing poll); no memoization warranted at roster scale.
- **Correctness — PASS** (2 P4 notes above). NaN and negative-age guards present; largest-two-units arithmetic verified by tests; the only untested branch is the unparseable-input path.
- **Usability — PASS.** Muted line (`text-spur-text-muted`) with a `data-roster-uptime` test hook; hidden for exited/not-started members exactly as AC1 requires.
- **Architecture — PASS.** Pure exported helper beside `buildRoster` in the file that declares itself the unit under test; injectable `now` for deterministic tests; a single derived line at the render site; matches the frozen Design names. The one self-declared deviation (signature `string | null` vs Design's `string`) is type-honest and recorded in `## Solution`.

##### Architecture Depth

No deepening opportunity at this size: the helper encapsulates the whole formatting policy (unit selection, edge → null) behind a two-arg pure signature, is unit-testable without DOM, and adds zero coupling to the roster data flow. Removal decisions are recorded rather than shipped — the correct altitude for a record-ownership task.

**Next:** Proceed to gate. No P1–P3 findings; the two P4 notes are optional polish (sub-minute `up 0m` shape; unparseable-input test case) and do not block.

### References

- Raised by: [0849 review](../tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md) pass 2, P2 (major), 2026-09-14
- Retirement that dropped them: [G64](../features/G64_retire-workspace-inbox-teams-and-spur-team.md); task 0849
- Deleted surface: `apps/web/src/modules/teams/SupervisorTab.tsx` (0378 R3/R4/R5), `tests/modules/teams/components.test.tsx`
- Surviving server routes: `apps/server/src/modules/team/index.ts:250,280` (`up`/`down`)
- Surviving Board surfaces: `apps/web/src/modules/projects/AgentsView.tsx`, `MemberDetail.tsx`
- CLI successors for the team verbs (0848): fleet materialization at serve start; `spur agent stop`
- Sibling residual: task 0852 (process watch list)
- Orphaned-route removal follow-up: [0855](../tasks4/0855_remove-the-orphaned-post-api-team-team-up-down-routes.md) (R4/AC3 — owns the `up`/`down` routes, their server tests, and the observability-contracts rows)

### History

- 2026-09-14T23:26:06.192Z backlog → wip (system)
- 2026-09-14T23:57:48.299Z wip → testing (system)
- 2026-09-14T23:57:56.504Z testing → done (system)

