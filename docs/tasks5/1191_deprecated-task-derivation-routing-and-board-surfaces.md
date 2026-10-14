---
schema_version: 1
name: Deprecated task derivation, routing and Board surfaces
status: done
template: feature-impl
created_at: 2026-10-13T16:56:12.969Z
updated_at: "2026-10-14T05:37:57.760Z"
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
| R1 | MET | Terminal closure includes deprecated (`packages/app/src/services/feature-service.ts:490`); `doneTasks`/`activeTasks` unchanged (`packages/app/src/services/feature-service.ts:492,493`). Pins green this run: `packages/app/tests/services/feature-service.test.ts:975,1001,1022,1056`. |
| R2 | MET | Routing stops a deprecated task: `plugins/sp/skills/next-router/references/routing-table.md:70` (A10 STOP); batch selection and preflight skip it (`plugins/sp/skills/spur-dev/references/execution-batch.md:155,282`). |
| R3 | MET | Board actions: `apps/web/src/modules/task-kanban/task-actions.ts:12,46` (deprecate pair), rendered at `apps/web/src/modules/task-kanban/TaskDetail.tsx:251`; off-track set derived from the enum (`apps/web/src/modules/task-kanban/TaskDetail.tsx:30`); lanes from the enum (`apps/web/src/modules/task-kanban/KanbanBoard.tsx:14`); card dot `apps/web/src/modules/task-kanban/TaskCard.tsx:32`. Legality floor against the graph: `apps/web/tests/modules/task-kanban/task-actions.test.ts:85`. Kanban suites 175 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC6 — Derivation reads a deprecated task as terminal-linked work | MET | test | `packages/app/tests/services/feature-service.test.ts:975` (leaves verifying for done) and `packages/app/tests/services/feature-service.test.ts:1001` (no reopen); closure at `packages/app/src/services/feature-service.ts:490`. |
| AC7 — The Board shows deprecated tasks with deprecate and undeprecate actions | MET | test | `apps/web/tests/modules/task-kanban/board.test.tsx:443` (deprecated lane, icon, dot) and `apps/web/tests/modules/task-kanban/board.test.tsx:464` (legal action sets); `apps/web/tests/modules/task-kanban/task-detail.test.tsx:301,465,486`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review Report — 1191 (round 4, closure pass)**
**Scope:** batch-2 commit `ead60d40a` plus main's `701951b02` (reworded the module comment). Supersedes round 3; each round-3 advisory re-checked on the artifact.
**Dimensions:** functional traceability · SECUA · architectural depth · test quality
**Verdict:** PASS
**Confidence:** HIGH

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | test-quality | Two tests restate the label and FSM-target literals they pin. Kept on purpose: they pin user-visible button labels and the action→status mapping the Board emits; the discriminating weight sits in the graph-derived legality test beside them. | `apps/web/tests/modules/task-kanban/task-actions.test.ts:28` | ACCEPTED (pins user-visible labels; legality floor at `apps/web/tests/modules/task-kanban/task-actions.test.ts:19`) |
| 2 | P4 (advisory) | architecture | Round 3 #2 — `OFF_TRACK` hand-maintained. Now derived from `TASK_STATUSES` minus the lifecycle phases, so the next status lands safely by construction. | `apps/web/src/modules/task-kanban/TaskDetail.tsx:30` | RESOLVED (`ead60d40a`) |
| 3 | P4 (advisory) | correctness | Round 3 #3 — module comment pointed at a non-existent path. Reworded to name the canonical task-lifecycle definition and the deployed runtime path. | `apps/web/src/modules/task-kanban/task-actions.ts:5` | RESOLVED (`701951b02`) |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/feature-service.ts:490` terminal closure includes `deprecated`; pins `packages/app/tests/services/feature-service.test.ts:975,1001,1022,1056` |
| R2 | MET | `plugins/sp/skills/next-router/references/routing-table.md:70` (A10 no-dispatch STOP); `plugins/sp/skills/spur-dev/references/execution-batch.md:282` |
| R3 | MET | `apps/web/src/modules/task-kanban/task-actions.ts:12`; tests `apps/web/tests/modules/task-kanban/board.test.tsx:443,464`, `apps/web/tests/modules/task-kanban/task-detail.test.tsx:301,465,486` |

#### Evidence (fresh, this round)

- `apps/web` task-kanban suites → 175 pass / 0 fail; `packages/app` feature-service included in 582 pass / 0 fail.

**Next:** none — no open finding.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T23:10:24.808Z todo → wip (system)
- 2026-10-14T03:10:29.413Z wip → testing (system)
- 2026-10-14T03:10:40.113Z testing → done (system)

