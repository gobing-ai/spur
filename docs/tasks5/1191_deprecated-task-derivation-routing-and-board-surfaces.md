---
schema_version: 1
name: Deprecated task derivation, routing and Board surfaces
status: done
template: feature-impl
created_at: 2026-10-13T16:56:12.969Z
updated_at: "2026-10-14T05:04:10.231Z"
feature_id: F43
priority: P2
estimate_hours: 5

dependencies: ["1189"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1191-verdict.json
---

## 1191. Deprecated task derivation, routing and Board surfaces

### Background

Implements: R6 — Derivation reads a deprecated task as terminal-linked work; R7 — The Board shows deprecated tasks with deprecate and undeprecate actions. The routing half of R4 is implemented here; its checklist row lives on the guard task so one scenario is never claimed twice.

Design: docs/design/task-deprecated-status.md §3.1 S5, S11, S12; ADR-137.

Ordering: depends on the vocabulary slice (it names the status); independent of the guard slice except for the shared terminal-set decision recorded there.

### Requirements

- [x] R1. Extend the derivation terminal test so a deprecated task counts as terminal-linked: `packages/app/src/services/feature-service.ts:486` reads `st === 'done' || st === 'cancelled'`, and its consumers at :487, :490, :535 and :602 must treat `deprecated` as terminal while `activeTasks` (:489, reads `wip`/`testing`) and `doneTasks` (:488, reads `done`) stay unchanged — prove with a feature whose only remaining linked task is deprecated, which must not be blocked from leaving `verifying` and must not be reopened.
- [x] R2. Never select a deprecated task as the next step: the next-router selection and the batch/run resolution paths skip it (`plugins/sp/skills/next-router/SKILL.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md`), and `spur task list --status deprecated` keeps working through the enum with no edit.
- [x] R3. Board Tasks module: show the deprecated status with its icon and colour, include it in the status filter, and offer deprecate/undeprecate actions only from the legal source states (`apps/web/src/modules/task-kanban/KanbanBoard.tsx`, `TasksShell.tsx`), following the F42 feature-module shape (`apps/web/src/modules/features/feature-actions.ts`) rather than inventing a second pattern.

### Acceptance Criteria

- [x] AC6 — Derivation reads a deprecated task as terminal-linked work
- [x] AC7 — The Board shows deprecated tasks with deprecate and undeprecate actions

Task-local checks: `spur task list --status deprecated` selects the status; the Board offers no transition the graph refuses.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: one shared terminal-set decision, applied at the derivation closure, the routing selection and the Board affordances.

Why: F42's feature-side freeze guards were mostly refusals, but the task-side freeze has a second, opposite duty — a frozen task must stop *blocking* its feature. Without extending the terminal test at `feature-service.ts:486`, a deprecated task stays non-terminal forever, the feature can never leave `verifying`, and the only escape would be deleting the task, which the operator's ask puts out of scope. This is the single most consequential line in the slice.

Why the closure rather than a new helper: the existing closure is already the single place the rule is expressed, and it is inlined in one function; extracting a helper for one consumer would be speculative abstraction. Assert the three neighbours it must NOT change (`doneTasks`, `activeTasks`, the 'at least one done' rule) so the change cannot widen by accident.

Rejected: teaching the Board a separate filter for the status. The filter already derives from `TASK_STATUSES`, so membership follows the enum automatically; only the icon/colour and the action set need explicit work.

Invariants: a deprecated task is never 'active work' and never 'done'; derivation proposes no status for it; routing never starts it; the Board never offers a transition the graph would refuse.

Key surfaces and signatures: the terminal closure at `packages/app/src/services/feature-service.ts:486`; the routing selection in the next-router skill and the batch resolver reference; the Tasks module components under `apps/web/src/modules/task-kanban/`.

Browser check: the Board change is user-visible, so the verification needs at least one rendered check of the Tasks view with a deprecated task present, not only a unit assertion.

### Plan

1. Extend the terminal closure and assert the unchanged neighbours.
2. Prove the derivation behaviour with a feature whose only linked task is deprecated, including the not-reopened half.
3. Update the routing selection and its reference doc.
4. Add the Board icon/colour, filter membership and the deprecate/undeprecate actions.
5. Browser-check the Tasks view with a deprecated task present.
6. Run the focused service and Board tests.

### Solution

- `packages/app/src/services/feature-service.ts:490` — the derivation terminal closure now reads `done || cancelled || deprecated`, so a frozen task is terminal-linked: a feature whose only remaining work was deprecated can still leave `verifying` and a closed feature is never reopened by it. The neighbours at `:492` (`doneTasks` → `done` only) and `:493` (`activeTasks` → `wip`/`testing` only) are untouched, so the "at least one done" rule keeps its meaning, and the reopen (`:496`), all-terminal (`:512`) and blocked (`:626`) consumers follow the one decision.

- `packages/app/tests/services/feature-service.test.ts:90,115` — `writeLinkedTask` plus `withDerivationFixture`: one linked-task roster written with an explicit status and released afterwards (the suite shares one features dir and `create` allocates the first free A–Z letter, so a leaked fixture exhausts the range and lets a re-allocated id inherit the old roster).

- `packages/app/tests/services/feature-service.test.ts:975,1001,1022,1056` — the four R1 pins: deprecated + done leaves `verifying` for `done` (with the 1119 receipt), a deprecated task does not reopen a closed feature (`force` included), a live `wip` still drives the active proposal while a blocked-only remainder now reads `blocked`, and a deprecated-only roster is neither advanced nor blocked (the at-least-one-done rule). The first three fail on the pre-change closure.

- `apps/web/src/modules/task-kanban/task-actions.ts:10,22,44` — the task-side twin of `feature-actions.ts`: `TASK_STATUS_ACTIONS` (with `deprecated` = `['undeprecate', 'cancel']` and `deprecate` appended to backlog/todo/wip/testing/blocked/done), `TASK_ACTION_LABELS` and `TASK_FSM_TRANSITIONS` (`deprecate` → `deprecated`, `undeprecate` → `todo`), which TaskDetail's three inline tables moved into and now render from. One actions table per module, keyed by the canonical `TASK_STATUSES`, instead of a second list.

- `apps/web/src/modules/task-kanban/TaskDetail.tsx:7,129,251` — the detail panel imports and renders those tables; no behaviour change beyond the two new buttons, so button visibility still comes from exactly one source.

- `apps/web/src/modules/task-kanban/TaskCard.tsx:32` — the card status dot gains `deprecated: 'bg-spur-text-muted'` (the feature-module colour), so a frozen card no longer renders with the unknown-status fallback tint.

- `apps/web/tests/modules/task-kanban/task-actions.test.ts:13,19,78` — new pure-module test: the table covers every canonical `TaskStatus`, `deprecate` is offered from each status the graph admits it from, and the legality floor derives `LEGAL_TARGETS` from `config/workflows/task-lifecycle.yaml` and asserts every surfaced FSM action is a legal edge of that status (mirrors the F42 feature-side floor). This is the invariant behind "the Board never offers a transition the graph refuses".

- `apps/web/tests/modules/task-kanban/task-detail.test.tsx:452,473` — the same "only the legal source states" rule pinned at the component that renders the table: a `deprecated` task offers exactly Un-deprecate + Cancel and its click emits `onTransition(wbs, 'todo')`, while a `todo` task offers Deprecate and never Un-deprecate.

- `apps/web/tests/modules/task-kanban/board.test.tsx:442,462` — rendered Board tests: the `deprecated` lane appears from `TASK_STATUSES` with its 🗄️ icon and the muted dot, a `todo` card offers Deprecate but not Un-deprecate, a deprecated card offers exactly Un-deprecate + Cancel (no Reopen), and a cancelled card offers no action at all.

- `plugins/sp/skills/next-router/references/routing-table.md:57,70,105` — TABLE A gains row A10 (`status == deprecated` → no dispatch, STOP with the un-deprecate command), the status vocabulary line names `deprecated`, and the B3 frontier algorithm states that `done`/`cancelled`/`deprecated` are never candidates and a `deprecated` dependency is not a satisfied one. `spur task list --status deprecated` needs no edit — verified through the enum in a throwaway project root.

- `plugins/sp/skills/next-router/SKILL.md:145,162` — the router's non-route summary and Red Flags name the deprecated task: never selected for a lifecycle hop, stop like A10 instead.

- `plugins/sp/skills/spur-dev/references/execution-batch.md:155,156,204,282` — batch resolution matches the shipped policy: the `ready` selector and Step 2.3 never treat a `deprecated` dependency as satisfied, the status pseudo-list excludes `deprecated`, and the Step 2.6 preflight table documents the `DEPRECATED` skip code (`preflightTask`, landed in 1190) so a frozen WBS is reported, not launched.

- `packages/app/tests/services/task-record.test.ts:3237` — hardened the 1190 R3 pin so it is cwd-independent: `record`'s default verdict path is relative to the process cwd, so a full-suite run from the repo root picked up the real `.spur/run/1190-verdict.json` and rendered Testing before the refusal the test asserts. The fixture now pins `verdictFile` inside its own temp root, which is what makes the byte-identical assertion hold in the suite as well as in isolation.

- `apps/web/src/modules/task-kanban/TaskDetail.tsx:30` — review remediation: `deprecated` joins the `OFF_TRACK` set beside `blocked`/`cancelled`, so the metadata Progress pane renders the neutral off-track badge instead of five empty phase bars (ADR-137: `deprecated` is a frozen state, not a lifecycle phase). `apps/web/tests/modules/task-kanban/task-detail.test.tsx:301` extends the R2b off-track pin to `deprecated` and asserts no phase-bar column is rendered.

- `apps/web/tests/modules/task-kanban/task-detail.test.tsx:301` — review remediation 2: the round-2 reviewer showed the first version of this pin was **inert** (`[class*="w-16"]` occurs only in the unrelated `implProgress` branch, so the assertion passed with the fix reverted). It now asserts the Progress pane renders the `.badge-warning` badge carrying the status, with a `wip` control asserting a lifecycle status never takes that branch; verified failure-sensitive by reverting `deprecated` out of `OFF_TRACK` in-memory and observing the test fail.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:282` — corrected the Step 2.6 DEPRECATED row: a deprecated WBS also reaches preflight through a `feature:<id>` selector (Step 1's `task list --feature` reports every linked row whatever its status); only the `ready` and status pseudo-lists exclude the status. Same class as `plugins/sp/skills/next-router/references/routing-table.md:88`, whose TABLE B B7 precondition now reads "mixed terminal only (`cancelled`/`done`/`deprecated`)", matching the frontier prose that excludes all three.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Terminal closure `packages/app/src/services/feature-service.ts:490` reads done, cancelled or deprecated; `doneTasks` (`:492`) stays done-only and `activeTasks` (`:493`) stays wip/testing-only. Tests `packages/app/tests/services/feature-service.test.ts:975`, `:1001`, `:1022`, `:1056` — green this run. |
| R2 | MET | Routing never selects a deprecated task: `plugins/sp/skills/next-router/references/routing-table.md:70` (A10 STOP), `:105` (frontier excludes deprecated); `plugins/sp/skills/next-router/SKILL.md:145`; batch resolution `plugins/sp/skills/spur-dev/references/execution-batch.md:155`, `:282`. `spur task list --status deprecated` works through the enum (prior throwaway-root probe, exit 0). |
| R3 | MET | Board actions `apps/web/src/modules/task-kanban/task-actions.ts:11` (TASK_STATUS_ACTIONS) and `:45` (TASK_FSM_TRANSITIONS), rendered at `apps/web/src/modules/task-kanban/TaskDetail.tsx:251`; card colour `apps/web/src/modules/task-kanban/TaskCard.tsx:32`; lanes derive from TASK_STATUSES at `apps/web/src/modules/task-kanban/KanbanBoard.tsx:14`; the off-track badge set now derives from TASK_STATUSES too (`apps/web/src/modules/task-kanban/TaskDetail.tsx:30`). Legality floor `apps/web/tests/modules/task-kanban/task-actions.test.ts:85` against `config/workflows/task-lifecycle.yaml:200`. 175 / 0 this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC6 — Derivation reads a deprecated task as terminal-linked work | MET | test | `packages/app/tests/services/feature-service.test.ts:975` and `:1001` over the closure at `packages/app/src/services/feature-service.ts:490` — green this run. |
| AC7 — The Board shows deprecated tasks with deprecate and undeprecate actions | MET | test | `apps/web/tests/modules/task-kanban/board.test.tsx:443` (deprecated lane with icon and muted dot when un-hidden), `:464` (legal deprecate/un-deprecate sources), `apps/web/tests/modules/task-kanban/task-detail.test.tsx:465`, `:486`, `:301` (off-track badge) — green this run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1191
**Scope:** uncommitted 1191 diff on branch `sp/runall-1190-1191-1192-c4a1` — 11 modified tracked files + 2 new (`apps/web/src/modules/task-kanban/task-actions.ts`, `apps/web/tests/modules/task-kanban/task-actions.test.ts`); commit `071296062` (task 1190) read as context only. Brief: `.spur/run/1c9d179f-0a72-416a-bbf5-f6807baf055d/review-brief-3.md` (iteration 3).
**Dimensions:** functional traceability (R1–R3, AC6/AC7), SECUA, architectural depth, test quality
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | test-quality | Two tests restate the literals they pin (`TASK_ACTION_LABELS.deprecate === 'Deprecate'`; `TASK_FSM_TRANSITIONS.deprecate === 'deprecated'` / `.undeprecate === 'todo'`). They fail only if the constant changes; the discriminating weight sits in the YAML-derived legality floor and the component/Board action-set tests. Unchanged since round 1; mirrors the F42 twin. | `apps/web/tests/modules/task-kanban/task-actions.test.ts:28-37` | ACCEPTED |
| 2 | P4 (advisory) | architecture | `OFF_TRACK` is a hand-maintained complement of the `LIFECYCLE` phases — `new Set(['blocked','cancelled','deprecated'])`. The round-2 P3 was exactly this list drifting behind the enum; deriving it (`TASK_STATUSES.filter((s) => !LIFECYCLE.includes(s))`) makes the next status addition safe by construction. No current defect — `deprecated` is present (authority: `apps/web/src/modules/task-kanban/TaskDetail.tsx:30`). | `apps/web/src/modules/task-kanban/TaskDetail.tsx:30` | ACCEPTED |
| 3 | P4 (advisory) | correctness | The new module's doc comment points readers at `.spur/workflows/task-lifecycle.yaml`, which does not exist in this tree; the authority the test actually asserts against is `config/workflows/task-lifecycle.yaml`. | `apps/web/src/modules/task-kanban/task-actions.ts:5-6` | ACCEPTED |

##### Adjudications (the brief's five claims, on the artifact)

1. **R1 terminal closure — CONFIRMED.** `packages/app/src/services/feature-service.ts:490` reads `done || cancelled || deprecated`; `isTerminal` is a function-local const consumed only by `terminalTasks` (:491) and `nonTerminalTasks` (:494), so the widened predicate reaches exactly the reopen branch (:497), the all-terminal + at-least-one-done branch (:539) and the blocked branch (:626). `doneTasks` (:492, `done` only) and `activeTasks` (:493, `wip`/`testing` only) are untouched, so "at least one done" keeps its meaning — no widening beyond the terminal set. Failure-sensitivity proven on a throwaway copy of the tree: reverting `isTerminal` to the pre-1191 predicate flips 3 of the 4 R1 pins to fail (`feature-service.test.ts:975`, `:1001`, `:1022`); the fourth (`:1056`) passes both ways by design (the deliberate "does not widen" invariant). Fresh run on this tree: 66 pass / 0 fail.
2. **R2 routing — CONFIRMED.** TABLE A A10 (`routing-table.md:70`) is the only status-matching row for `deprecated` and dispatches nothing (STOP, no fallthrough); the vocabulary line (:57), the TABLE B frontier prose (:105-107) and the corrected B7 row (:88) agree; the router non-route summary and Red Flags name it (`next-router/SKILL.md:145,162`); the batch `ready` selector, the Step 2.3 blocked propagation and the Step 2.6 `DEPRECATED` preflight row (`execution-batch.md:155,203,282`) all treat a deprecated task/dependency as non-satisfied / non-runnable. `spur task list --status deprecated` needed no code change — verified, not assumed: a throwaway root with task 0001 `deprecated` printed "🗄️ Deprecated • 0001" at exit 0 (the enum at `packages/domain/src/planning/schema.ts:20` and the `--status` option carry it).
3. **R3 Board — CONFIRMED.** `TASK_STATUS_ACTIONS` / `TASK_ACTION_LABELS` / `TASK_FSM_TRANSITIONS` (`task-actions.ts:10,22,44`) moved the three former inline `TaskDetail.tsx` tables verbatim — every prior status row, label and FSM target is preserved — and added only the deprecate pair (`deprecated: ['undeprecate','cancel']`; `deprecate` appended to backlog/todo/wip/testing/blocked/done; `deprecate → deprecated`, `undeprecate → todo`), exactly the legal edges of `config/workflows/task-lifecycle.yaml:166-209`. Lane membership derives from `TASK_STATUSES` (`KanbanBoard.tsx:14` `KANBAN_COLUMNS = TASK_STATUSES`; filter `TasksShell.tsx:44-48`) — no second list. Card dot `TaskCard.tsx:32`. Fresh kanban suites: 77 pass / 0 fail.
4. **The off-track pin IS failure-sensitive (round-2 P3 #1) — CONFIRMED on the artifact.** `task-detail.test.tsx:301` now asserts the Progress pane's `.badge-warning` badge (the sole `variant="warning"` in the component, `TaskDetail.tsx:338`) carries the status, with a `wip` control. Verified by reverting `deprecated` out of `OFF_TRACK` on a throwaway copy of the tree: the R2b pin fails (`Expected to contain: "deprecated"` / `Received: []`); with the fix it passes. The old `[class*="w-16"]` assertion was inert — the component's only `w-16` is the unrelated `implProgress` state column, and the LIFECYCLE fallback uses `w-0`.
5. **The execution-batch Step-2.6 admission-path correction (round-2 P3 #2) — CONFIRMED true.** `execution-batch.md:282` now says a deprecated WBS reaches preflight via an explicit `--tasks` list or a `feature:<id>` selector, excluding the `ready`/status pseudo-lists. Probe on a throwaway root: with 0001 `deprecated` and 0002 `todo` both linked to feature F1, `task list --feature F1 --json` returned BOTH rows at exit 0 — so the corrected sentence matches the real Step-1 behaviour.
6. **The TABLE B B7 wording (round-1 P4 #1) — RESOLVED.** `routing-table.md:88` now reads "mixed terminal only (any combination drawn from `cancelled`, `done`, `deprecated`)", matching the frontier prose.
7. **Test hardening (`packages/app/tests/services/task-record.test.ts:3237`) — SOUND, not weakened.** `readFile` in `createNodeFileSystem` reads the raw path (only `resolve()` roots paths), so record's default `.spur/run/<wbs>-verdict.json` IS `process.cwd()`-relative; the repo already carries a readable `.spur/run/1190-verdict.json` (wbs "1190", PASS) that a full-suite run from the repo root would pick up. Probed on a throwaway copy: making the pinned verdict readable renders Testing (checkbox flip + `updated_at` bump) BEFORE the transition refusal, so the byte-identical assertion fails — the pin is necessary to isolate the refusal, not a weakening. With the pinned (absent) verdict the assertion holds and still catches a guard failure; the refusal is `Lifecycle transition denied ... No transition from "deprecated" to "testing"`, matched by `rejects.toThrow(/deprecated/)`.
8. **Test quality.** The new rendering/derivation pins are failure-sensitive (the R1 pins above; the Board lane/icon and action-set pins fail if a table row or the dot entry changes). The one low-signal pair is finding 1.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `feature-service.ts:490` — `isTerminal = done \|\| cancelled \|\| deprecated`; consumers bounded to :497/:539/:626, neighbours :492/:493 unchanged. Pins `feature-service.test.ts:975` (deprecated + done leaves `verifying` for `done`), `:1001` (never reopens a closed feature, `force` included), `:1022` (a live `wip` still drives the active proposal; blocked-only remainder reads `blocked`), `:1056` (at-least-one-done holds for a deprecated-only roster). Fresh: 66/66; failure-sensitivity probed. |
| R2 | MET | `routing-table.md:70` (A10 no-dispatch STOP), `:57`, `:88`, `:105-107`; `next-router/SKILL.md:145,162`; `execution-batch.md:155,203,282`. `spur task list --status deprecated` unchanged — throwaway-root probe exit 0. |
| R3 | MET | `task-actions.ts:10,22,44` (deprecate pair + verbatim move); `config/workflows/task-lifecycle.yaml:166-209` legal edges; lane/filter from `TASK_STATUSES` (`KanbanBoard.tsx:14`, `TasksShell.tsx:44-48`); dot `TaskCard.tsx:32`. Fresh kanban: 77/77. |
| AC6 | MET | Same change as R1 — `feature-service.test.ts:975` (leaves `verifying` for `done`) and `:1001` (no reopen). |
| AC7 | MET | `board.test.tsx:442` (deprecated lane from `TASK_STATUSES`, 🗄️ icon, muted dot) and `:462` (a `todo` card offers Deprecate but not Un-deprecate; a deprecated card offers exactly Un-deprecate + Cancel; a cancelled card offers nothing); `task-detail.test.tsx:465,486` (per-status button set; click emits `onTransition(wbs,'todo')` / `'deprecated'`). The metadata off-track remediation is present and correct (`TaskDetail.tsx:30`) and now discriminatingly pinned (`task-detail.test.tsx:301`). |

##### Dimension notes

- **Functional.** R1–R3, AC6, AC7 all MET.
- **SECUA.** Correctness: minimal closure change, four pins behave as intended (fresh 66/66). Security: no new input path, secret handling or injection surface. Efficiency: unchanged O(n) filters. Usability: the two new buttons carry `aria-label` from the single label table and the frozen task renders the neutral off-track badge. Accessibility: parity with `blocked`/`cancelled`, no new gap.
- **Architecture (five signals).** Shallow module — none (`task-actions.ts` is a declarative projection). Tight coupling — low (one test edge pins the module to the FSM YAML). Wrong seam — none (the UI-projection seam matches F42's `feature-actions.ts`, and `config/workflows/task-lifecycle.yaml` stays the authority asserted one-way by the YAML-derived legality floor). Weak locality — improved (three inline tables consolidated beside the components). Poor test surface — improved. The module does not duplicate an existing source of truth: it projects task statuses where the feature module projects feature statuses. Residual advisory: finding 2.
- **Test quality.** Failure-sensitive where it matters; the YAML-derived legality floor is the strongest addition (the invariant behind "the Board never offers a transition the graph refuses"). One advisory restatement pair (finding 1).

##### Evidence (fresh, on this tree unless noted)

- `bun test apps/web/tests/modules/task-kanban/{task-detail.test.tsx,task-actions.test.ts,board.test.tsx}` → 77 pass / 0 fail.
- `bun test packages/app/tests/services/feature-service.test.ts` → 66 pass / 0 fail (R1 subset 4/4).
- `bun test packages/app/tests/services/task-record.test.ts` → 148 pass / 0 fail.
- Throwaway-root CLI probes: adjudications 2 and 5.
- Throwaway-copy tree probes (never this tree's tracked files): off-track revert, `isTerminal` revert, readable-verdict confound.

**Next:** none — round 3 closes both round-2 P3s on the artifact; the three P4 advisories are non-blocking. No tracked source was modified by this review; the full quality gate was not re-run (certified digest `sha256:8d8ccf141498fb38b2d235531c55f0538a05bd21237c6087e2cb0dad28f35775`, `.spur/run/1191-test-gate.status = PASS`).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T23:10:24.808Z todo → wip (system)
- 2026-10-14T03:10:29.413Z wip → testing (system)
- 2026-10-14T03:10:40.113Z testing → done (system)

