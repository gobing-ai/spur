---
schema_version: 1
name: Remove the orphaned POST /api/team/:team/up|down routes
status: done
template: feature-impl
created_at: 2026-09-14T23:19:18.765Z
updated_at: "2026-09-15T01:23:18.440Z"
feature_id: G64

---

## 0855. Remove the orphaned POST /api/team/:team/up|down routes

### Background

`POST /api/team/:team/up|down` (`apps/server/src/modules/team/index.ts:250,280`) has no caller
anywhere outside its own server tests — verified repo-wide 2026-09-14 (task 0853 R4). Its Board
callers were deleted with the Teams SupervisorTab surface (G64 retirement).

Task 0853's Q&A (Q3) recorded the removal as intended, not accidental: G63's CLI story moved `up`
to fleet materialization at serve start and `down` to `spur agent stop` (0848). Board up/down is
superseded by the fleet model's CLI lifecycle; no Board surface gets the controls back. The routes
themselves still exist after 0853 — deletion is this follow-up's scope (0853 AC3).

Removal scope: the two routes, their describes in `apps/server/tests/modules/team/index.test.ts`,
and the two contract rows in `docs/design/observability-contracts.md`.

### Requirements

- **R1** — Remove the `POST /api/team/:team/up` and `POST /api/team/:team/down` route handlers from
  `apps/server/src/modules/team/index.ts` (the two blocks under the `// ── POST /api/team/:team/up`
  and `// ── POST /api/team/:team/down` section comments). No tombstone route, no 410, no alias —
  no caller exists to break, so plain removal (Hono default 404 for those paths) is the contract.
- **R2** — Remove the two corresponding describe blocks from
  `apps/server/tests/modules/team/index.test.ts` (`POST /api/team/:team/up` at `:802`,
  `POST /api/team/:team/down` at `:968`); re-anchor by header text, not line number. Trim
  module-stub fields that only these tests used (e.g. mock `materializeTeam`/`teardownTeam`
  entries) only when typecheck/lint flags them as unused.
- **R3** — Do not remove or modify `TeamService.materializeTeam` / `TeamService.teardownTeam`
  (`packages/app/src/services/team-service.ts:939` and the teardown counterpart) or the
  `spur team up|down` CLI verbs: the CLI calls the service directly
  (`apps/cli/src/commands/team.ts:492,537`) and G64 R4 forbids losing a capability before the
  noun retires at the recorded cutover.
- **R4** — Do not touch the surviving `/api/team/*` surfaces: `GET /api/team/processes`,
  `GET /api/team/teams`, and `/api/team/agents/:id/*` (start/stop/stdin/history/ring-buffer) —
  G63's Agents view, MemberTerminal, and 0852's ProcessesView consume them.
- **R5** — Remove the two route rows from `docs/design/observability-contracts.md` (the
  `POST /api/team/:team/up` and `POST /api/team/:team/down` rows at `:353-354`) in the same
  commit as the route removal (T3 same-commit surface-doc rule).

### Acceptance Criteria

- **AC1 — Orphaned routes are gone (R1, R2).**
  Given the Board server with the team module mounted, when any client POSTs to
  `/api/team/<team>/up` or `/api/team/<team>/down`, then the response is Hono's default 404, the
  source contains no handler for either path, and the team-module test suite passes without the
  two removed describe blocks.
- **AC2 — Capabilities survive (R3).**
  Given the unchanged service layer, when `spur team up` and `spur team down` run, then they still
  work through `TeamService.materializeTeam` / `teardownTeam`, and the `materializeTeam` /
  `teardownTeam` describes in `packages/app/tests/services/team-service.test.ts` pass unmodified.
- **AC3 — Surviving team surfaces intact (R4).**
  Given the diff, when inspected, then `GET /api/team/processes`, `GET /api/team/teams`, and
  `/api/team/agents/:id/*` handlers and their tests are unchanged, and the full
  `apps/server/tests/modules/team/index.test.ts` run is green.
- **AC4 — Docs and corpus clean (R1, R5).**
  Given the completed removal, when a repo-wide search runs for `team/:team/up` / `team/:team/down`
  (and fetch-path forms `team/up`, `team/down`) excluding `docs/tasks*`, `docs/features*`, and
  history/ADR receipts, then zero hits remain, and `docs/design/observability-contracts.md` no
  longer lists either route.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-14T23:22:28.065Z

#### Q&A entry — 2026-09-14 (auto-refine, --depth ready)

#### Q1 — Delete the routes, or reinstate a Board caller for them?

**Decision: delete.** 0853's frozen Q&A already recorded "team up/down Board controls = removal
recorded" with named successors (fleet materialization at serve start for `up`; `spur agent stop`
/ `spur agent delete` for `down`), and Robin accepted the reduction on 2026-09-14 with the cutover
window open. Keeping orphaned write routes on a retired surface contradicts that record.

#### Q2 — Why not also remove `TeamService.materializeTeam` / `teardownTeam`?

They are not orphaned: the `spur team up|down` CLI verbs call them directly
(`apps/cli/src/commands/team.ts:492,537`) and G64 R4 requires each capability to stay reachable
until the noun itself retires. Their removal belongs to the `spur team` noun cutover (G64/0848's
shim-removal condition), not to this route cleanup.

#### Q3 — 404, 410, or a compatibility shim for the removed paths?

Frozen: plain removal → Hono default 404. No caller exists (verified repo-wide 2026-09-14), so a
410 tombstone or alias table would be unobservable surface with no one to serve. This matches
0849's precedent that shims need an objectively checkable removal condition.

### Design

**WHAT** — Delete the two orphaned write routes and nothing around them: the
`app.post('/api/team/:team/up', ...)` block (materialize + best-effort autostart, anchored at the
`// ── POST /api/team/:team/up` comment, `apps/server/src/modules/team/index.ts:249`) and the
`app.post('/api/team/:team/down', ...)` block (stop + optional purge, `:279`), the two matching
describe blocks in `apps/server/tests/modules/team/index.test.ts` (`:802`, `:968`), and the two
rows in `docs/design/observability-contracts.md:353-354`.

**WHY** — Both Board callers died with `TeamsShell` in 0849; the routes are dead write surface on a
retired module. 0853 AC3 names this exact follow-up. Removal is the recorded reduction's
follow-through, not a new decision (G64 amended R5: reduction must be "recorded,
operator-accepted, named" — it is).

**WHERE** — `apps/server/src/modules/team/index.ts` (routes),
`apps/server/tests/modules/team/index.test.ts` (route tests),
`docs/design/observability-contracts.md` (contract rows). No `packages/app` change, no `apps/web`
change, no `apps/cli` change.

**Invariants**
- `TeamService.materializeTeam` / `teardownTeam` signatures and behavior unchanged (R3): the
  module's deps type references the real service, so no interface edit should be needed; if the
  module-local deps interface declares fields now used by nothing, trim only what typecheck/lint
  flags.
- The team module itself stays mounted — it still serves the read/control routes G63 and 0852 use.
- Surgical diff: no drive-by edits to neighboring routes, helpers, or imports beyond what the two
  handler bodies exclusively used (e.g. an import only the removed handlers referenced may go; a
  shared one stays).

**Anti-patterns (do not implement)**
- Do NOT delete `apps/server/src/modules/team/` or `TeamService` (G64 R4; CLI still calls them).
- Do NOT remove the `spur team up|down` CLI verbs or add a deprecation warning change here (0848
  owns the noun lifecycle; `warnTeamNounRetiredOnce` already fires).
- Do NOT touch `GET /api/team/processes`, `GET /api/team/teams`, `/api/team/agents/:id/*`.
- Do NOT add a 410/redirect tombstone or an alias (Q3).
- Do NOT edit other `observability-contracts.md` rows — only the two route rows at `:353-354`.

**Handoff** — None. No dependents; `legacy-migration.test.ts:827`'s "migration code must not call
materializeTeam/teardownTeam" assertion is unaffected (this task adds no calls).

### Plan

1. **Remove the two route blocks** — delete the `POST /api/team/:team/up` and
   `POST /api/team/:team/down` handler blocks from
   `apps/server/src/modules/team/index.ts` (anchor on the section comments; `:249` and `:279`
   today). Prune imports used only by these handlers. → R1
2. **Remove the route tests** — delete the `describe('POST /api/team/:team/up')` and
   `describe('POST /api/team/:team/down')` blocks from
   `apps/server/tests/modules/team/index.test.ts` (`:802`, `:968`); fix stub fields only if
   typecheck flags them unused. → R2
3. **Capability check** — run the service suite subset in `packages/app`
   (`bun test tests/services/team-service.test.ts`) and confirm the `materializeTeam` /
   `teardownTeam` describes pass unmodified (capability invariant, not modified by this task).
   → R3
4. **Server suite** — run `cd apps/server && bun test tests/modules/team/index.test.ts` and the
   middleware pipeline test; all green. → AC1, AC3
5. **Doc rows** — delete the two route rows at `docs/design/observability-contracts.md:353-354`,
   same commit as steps 1–2 (T3). → R5
6. **Grep audit** — `rg -n "team/:team/up|team/:team/down|team/up|team/down"` excluding
   `docs/tasks*`, `docs/features*`, ADR/history receipts → zero hits; `git status` shows only the
   three intended files. → AC4

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/server/src/modules/team/index.ts:248` |
| `apps/server/tests/modules/team/index.test.ts:801` |
| `apps/web/src/modules/projects/AgentsView.tsx:193` |
| `apps/web/src/modules/projects/AgentsView.tsx:239` |
| `apps/web/src/modules/projects/AgentsView.tsx:5` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:13` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:38` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:48` |
| `apps/web/src/modules/projects/WorkView.tsx:16` |
| `apps/web/src/modules/projects/WorkView.tsx:35` |
| `apps/web/src/modules/projects/WorkView.tsx:5` |
| `apps/web/src/modules/projects/WorkView.tsx:75` |
| `apps/web/src/modules/projects/WorkView.tsx:79` |
| `apps/web/src/modules/projects/WorkView.tsx:8` |
| `apps/web/src/modules/projects/roster.ts:124` |
| `apps/web/tests/modules/projects/roster.test.ts:174` |
| `apps/web/tests/modules/projects/roster.test.ts:18` |
| `apps/web/tests/modules/projects/roster.test.ts:3` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Committed removal: `git show 56b8dddfa --numstat` → 54 deleted lines in `apps/server/src/modules/team/index.ts`, only the two handler blocks (fresh this run); live route-def audit this run: exactly seven surviving routes at `apps/server/src/modules/team/index.ts:41` (GET processes), `:77` (POST agents/:id/start), `:88` (POST agents/:id/stop), `:99` (POST processes/:id/stdin), `:120` (GET processes/:id/stream), `:213` (GET teams), `:250` (GET health) — no up\|down handlers; `rg -n 'team/:team/(up\|down)' apps/server apps/web/src` → 0 hits (exit 1, fresh) |
| R2 | MET | `git show 56b8dddfa --numstat` → 274 deleted test lines removing both route describe blocks (fresh this run); surviving suite green inside the fresh server batch: cd apps/server && bun test tests/modules/health.test.ts tests/serve.test.ts tests/modules/team/index.test.ts tests/middleware/pipeline.test.ts — exit 0, 130 pass / 0 fail / 390 expect (fresh 2026-09-14); typecheck + biome green across the tree in the fresh spur-check |
| R3 | MET | `git status --short packages/app/src apps/cli/src` → clean (untouched by the removal); `packages/app/src/services/team-service.ts:939` `materializeTeam` and `:1014` `teardownTeam` intact (anchors re-read this run); CLI verbs intact at `apps/cli/src/commands/team.ts:482` (`team up`) and `:527` (`team down`) — re-read this run; team-service suites green inside the fresh packages/app batch: cd packages/app && bun test tests/services/fleet-service.test.ts tests/services/legacy-migration.test.ts tests/services/team-service.test.ts tests/services/team-service-0258.test.ts — exit 0, 139 pass / 0 fail / 462 expect (fresh 2026-09-14) |
| R4 | MET | Surviving handlers present per the fresh route audit (same seven-route listing, this run); `apps/server/src/modules/team/index.ts:41-72` processes handler re-read this run; surviving-surface suites green: team module + middleware pipeline inside the fresh 130-pass server batch |
| R5 | MET | `git show 56b8dddfa --numstat` → exactly 2 rows removed from `docs/design/observability-contracts.md` (fresh this run); corpus grep fresh this run: `rg -n 'team/:team/(up\|down)' docs` → only historical/procedural mentions (the 0855 task file itself, 0849/0853 record docs, tasks2 historical receipts, 04_DESIGN's deprecation note) — no live contract or test references the removed routes |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| **AC1 — Orphaned routes are gone (R1, R2).** | MET | command | Seven-route audit with no up\|down handlers + 0-hit code grep (both fresh this run); committed numstat 54 + 274 deletions (fresh this run); surviving server suites green (130 pass / 0 fail, fresh) |
| **AC2 — Capabilities survive (R3).** | MET | test | `team-service.ts:939`/`:1014` and `team.ts:482`/`:527` intact (anchors re-read); team-service suites green inside the fresh 139-pass packages/app batch |
| **AC3 — Surviving team surfaces intact (R4).** | MET | test | Seven surviving handlers enumerated fresh this run; team module + pipeline suites green inside the fresh 130-pass server batch |
| **AC4 — Docs and corpus clean (R1, R5).** | MET | command | observability-contracts.md exactly −2 rows (committed numstat, fresh); docs grep shows only historical/procedural mentions (fresh this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0855

**Scope:** 0855 working-tree diff (uncommitted, pure deletion, −330 lines / 0 insertions): `apps/server/src/modules/team/index.ts` (both POST `/api/team/:team/up|down` handlers removed, lines 249–302), `apps/server/tests/modules/team/index.test.ts` (both route describe blocks removed, lines 802–1075), `docs/design/observability-contracts.md` (two contract rows removed, lines 353–354). Excluded per stage contract: 0852 in-flight files and 0853 shipped files.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Review run:** 677c7e80-6014-4072-b805-6625be7e37a5 · reviewed 2026-09-14

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | AC4's literal "zero hits" carve-out (docs/tasks*, docs/features*, history/ADR excluded) leaves two textual mentions, both disposition-aware not stale: CHANGELOG.md:2069 is an immutable historical release note about a past version; docs/04_DESIGN.md:415 explicitly records the routes as "removed by 0855". Neither implies live surface; optional CHANGELOG append at release time | `CHANGELOG.md:2069`, `docs/04_DESIGN.md:415` |
| 2 | P4 (advisory) | usability | AC1's "Hono default 404" behavior has no standing negative test (R2 removes the route describes and does not ask for 404 tests); verified this review via a live mount check (`bun -e` Hono + teamModule → POST both paths → 404/404). Add a one-test 404 assertion only if the corpus later demands executable coverage for removed paths | `apps/server/src/modules/team/index.ts:249` (removal site) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Both handler blocks deleted (diff hunk @@ -246,60 +246,6 @@); `rg "app\.(get\|post)\('/api/team"` on the module shows only the 7 surviving routes; live mount check POSTs `/api/team/devops/up` and `/api/team/devops/down` → both 404 (plain-removal contract, no tombstone) |
| R2 | MET | Test diff pure deletion (274 lines, 0 added), describes re-anchored by header text; R2's conditional stub-trim correctly not triggered: `biome lint` clean on both touched TS files, `tsc --noEmit` (apps/server) exit 0 |
| R3 | MET | Diff touches exactly the 3 declared files (packages/app untouched); service fns intact `packages/app/src/services/team-service.ts:939,1014`; CLI verbs intact `apps/cli/src/commands/team.ts:492,537`; focused suites: team-service.test.ts 73 pass / 0 fail, team-service-0258.test.ts 9 pass / 0 fail |
| R4 | MET | Surviving handlers unchanged post-edit: `apps/server/src/modules/team/index.ts:41` (GET processes), `:120` (GET stream), `:213` (GET teams), `:250` (GET health); full team-module suite green |
| R5 | MET | Exactly the two rows (353–354) removed from the contract table; rhythm preserved (health row follows teams row); same changeset as the route removal |

##### SECUA (Security · Efficiency · Correctness · Usability · Architecture)

- **Security — PASS.** Removal shrinks attack surface: two unauthenticated-by-design write routes are gone; no new input handling, no new trust boundary. No orphaned imports (Hono/ServerContext/enqueueSseFrame/ServerModule all still used — lint/tsc clean).
- **Efficiency — PASS.** Pure deletion; no runtime cost remains behind the dead paths; middleware pipeline suite unchanged (28 pass).
- **Correctness — PASS** (2 P4 notes above). Zero repo-wide refs to the removed paths (rg across apps/packages/plugins/scripts); 404 fall-through verified live; no stale code references.
- **Usability — PASS.** No caller existed to break (0853 R4 audit + fresh rg confirm); CLI `spur team up|down` remains the documented lifecycle path.
- **Architecture — PASS.** Follows through on the recorded G64 reduction (0853 Q3) at the exact frozen scope — no tombstone surface, service layer retained for the CLI until noun cutover; single-responsibility seams left clean (health route follows teams route directly).

##### Architecture Depth

Nothing to deepen: the change deletes dead surface rather than adding module boundaries. Service layer (`materializeTeam`/`teardownTeam`) stays testable and CLI-reachable; the removal is the architecturally correct shrink, not a refactor opportunity.

##### Fresh Evidence (re-run during this review, 2026-09-14)

- `bun test tests/modules/team/index.test.ts` (apps/server) → 31 pass / 0 fail (95 expect)
- `bun test tests/middleware/pipeline.test.ts` (apps/server) → 28 pass / 0 fail
- `bun test tests/services/team-service.test.ts` + `team-service-0258.test.ts` (packages/app) → 73 + 9 pass / 0 fail
- `bunx tsc --noEmit` (apps/server) → exit 0; `bunx biome lint` (both touched TS files) → clean
- Live 404 mount check for both removed paths → 404 / 404
- Gate log `.spur/run/0855-test-gate.log`: 8497 pass / 0 fail across 477 files, rules `recommended-post-check` all pass, proof-digest sha256:5b00661321ab77de11c310d5000e290f9d180d03b7e452420855c2a04540e283, status PASS

**Next:** Proceed. No P0–P3 findings; the two P4 advisories are recorded, non-blocking.

### References

- Task 0853 (R4/AC3): records the up/down removal decision and names this follow-up task as owner.
- Task 0849 review, finding 6 + "DEFERRED" section (`docs/tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md:111-119,523`): origin of the orphan-route disposition.
- Feature G64 (Retire Workspace, Inbox, Teams, and spur team): R4 (capability preservation) and the amended R5 (recorded, operator-accepted reduction); cutover window recorded open 2026-09-14.
- `docs/design/observability-contracts.md:353-354` — the contract rows this task removes.
- `docs/reports/g6-runtime-inventory.md` §4 — disposition matrix context.

### History

- 2026-09-14T23:23:02.814Z backlog → todo (ready-preparation)
- 2026-09-15T00:41:18.403Z todo → wip (system)
- 2026-09-15T01:04:50.816Z wip → testing (system)
- 2026-09-15T01:05:02.116Z testing → done (system)

