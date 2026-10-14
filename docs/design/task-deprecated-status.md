---
kind: design
title: Task `deprecated` status — frozen-but-retained lifecycle state
status: current
created_at: 2026-10-13
updated_at: 2026-10-13
related: [F43, F42, ADR-137, ADR-136, ADR-135, DD-01, DD-13]
tags: [task, lifecycle, status, planning]
---

# Task `deprecated` status — frozen-but-retained lifecycle state

## 1. Issue and scope

Feature records can say "kept for history, do not change unless removing it" (F42/ADR-136). Task
records cannot. The only available spellings are wrong in one of two ways: `cancelled` is terminal
and claims the work was abandoned, and `blocked` is an impediment awaiting resolution, with edges
straight back into `wip`/`testing`. So a task we intend to keep but never touch again either
disappears from the "not abandoned" reading of the corpus or keeps inviting resumption.

Scope (F43): add `deprecated` as a canonical non-terminal `TaskStatus`, wire it through the
lifecycle graph, the freeze guards, checks, derivation, routing, Board, skills and docs. Out of
scope: deleting records, relabelling existing corpus tasks, and an override flag.

**Structural difference from F42 — read this before mirroring F42.** A feature *contains* work, so
its freeze rejects child links. A task *precedes* work, so its freeze has two separate meanings and
must not conflate them:

1. **Nothing new attaches to it** — a dependency edge onto a deprecated task is refused.
2. **It never starts or advances** — admission refuses it and the status graph has no forward edge.
3. **It stops holding other work back** — derivation reads it as terminal-linked, or a frozen task
   blocks its feature forever with no exit but deletion (which is out of scope).

## 2. Context and constraints

- Status is task frontmatter only; there is no DB column or migration
  (`packages/domain/src/planning/schema.ts:20`).
- Contracts use `z.enum(TASK_STATUSES)` (`packages/contracts/src/task.ts:12,44,79,87`), so the enum
  addition reaches oRPC/OpenAPI with no hand edits.
- Every status write is proven against `task-lifecycle.yaml` or refused, on every transport
  (ADR-135).
- **There is no `spur task advance` verb.** The task-side forward path is the graph-mediated status
  write plus the auto-walk chain at `packages/app/src/services/task-service.ts:1930–1968`. The
  feature-side `advance` refusal has no task-side twin to extend; the equivalent surface is the
  status-write refusal message and the auto-walk guard.
- **The dependency field has two names in play, and the freeze guards two writers.**
  Edges are authored at handoff time as `depends_on_names` in the ready-set payload and resolved to
  WBS by `packages/app/src/workflow/idea-handoff.ts:149,256`; the WBS values land in the task
  frontmatter key **`dependencies`** (what `spur task deps <wbs> set` writes, verified 2026-10-13 on
  tasks 1190–1192), and `plugins/sp/scripts/batch-preflight.ts` consumes them for admission. The
  proof extractor accepts either `depends_on` or `dependencies`
  (`packages/app/src/workflow/proof-input-fingerprint.ts`). So the freeze attaches at two writers:
  the handoff resolver (S8) and `TaskService.mutateDependencies`
  (`packages/app/src/services/task-service.ts:1228–1232`) — the second is required exactly because
  `spur task deps` reaches the frontmatter without the handoff — plus the preflight refusal (S9).
- Derivation's terminal test is a closure, not an enum:
  `packages/app/src/services/feature-service.ts:490` — `st === 'done' || st === 'cancelled' || st === 'deprecated'`.
- Consumer projects may carry a project-layer `task-lifecycle.yaml`; it resolves before the shipped
  graph, so a stale override refuses the new edges until re-synced (ADR-136's consequence, now at
  the task layer).

## 3. Solution

`deprecated` means **retained and frozen**: the record stays readable and countable, nothing new
attaches to it, it never starts, and leaving the state is explicit — un-deprecate to `todo`, or
`cancelled` once removed.

### 3.1 Affected-surface review

| # | Surface | Location | Change |
| --- | --- | --- | --- |
| S1 | Domain vocabulary | `packages/domain/src/planning/schema.ts:20,48,151,201` | Append `deprecated` to `TASK_STATUSES`; add `TASK_STATUS_ICONS.deprecated`; add the identity alias `deprecated: 'deprecated'` (`normalizeTaskStatus` throws on keys missing from the alias map); `normalizeTaskStatusSafe` needs no branch. |
| S2 | Contracts / OpenAPI | `packages/contracts/src/task.ts:12,44,79,87` | **No edit — verified 2026-10-13.** All four status fields are `z.enum(TASK_STATUSES)`, and `packages/contracts/src` holds no task-status list of its own (its only status enum is run statuses, `runs.ts:86`), so the enum addition reaches oRPC/OpenAPI with no hand edits. OpenAPI is built at runtime — nothing to regenerate. |
| S3 | Lifecycle graph | `config/workflows/task-lifecycle.yaml` | States + edges in §4.1; `deprecated` stays out of `terminalStates` (which holds only `cancelled`). |
| S4 | Shipped graph copy | `apps/cli/config/workflows/task-lifecycle.yaml` (generated) | Byte-identical to S3 via `build:bundle` (verified 2026-10-13: matching sha256). **No separate init template — verified 2026-10-13:** `SCAFFOLD_MANIFEST` (`apps/cli/src/config/scaffold-manifest.ts:39`) lists no workflow entry, and `seedGlobalConfig` (`apps/cli/src/commands/init.ts:152`) seeds the bundled config copy wholesale, so the only task-lifecycle YAML an init produces is a copy of S3. `/apps/cli/config` is gitignored build output, so the regenerated copy never appears in a diff — parity is asserted by sha256, not by a tracked file. |
| S5 | Status derivation | `packages/app/src/services/feature-service.ts:490` (closure used at `:491,494,539,606`) | Extend the terminal test to `deprecated` so frozen work stops holding its feature back; a deprecated task is never `activeTasks` (`:493` reads `wip`/`testing` only) and never `doneTasks` (`:492`), so the "at least one done" rule is unaffected. |
| S6 | Task section writes | `packages/app/src/services/task-service.ts:1498` (`updateSection`, shared by CLI and server; warning channel at `:1584,1641,1701,1715`; freeze advisory at `:1523,1605`) | Write lands; append a freeze note to `warnings[]`. |
| S7 | Status writes / auto-walk | `task-service.ts:1930–1968` (forward-chain walk) | No new branch needed: with no `deprecated` forward edge the walk finds no hop and the write is refused by the graph (ADR-135). Add the un-deprecate hint to the refusal message. |
| S8 | Dependency resolution | `packages/app/src/workflow/idea-handoff.ts:149,256` (refusal at `:276`); `packages/app/src/services/task-service.ts:1156` (`mutateDependencies`, refusal at `:1228–1232`); frontmatter key `dependencies` (written by `spur task deps`) | Refuse a ready-set item whose resolved dependency is a deprecated task, naming it and the un-deprecate command, before any dependency frontmatter is written. |
| S9 | Pipeline admission | `plugins/sp/scripts/batch-preflight.ts` (adapter; `--dep-status`) over `packages/app/src/services/planning-admission.ts:161,205,325` (`quickReadiness`) | Treat a deprecated task as non-runnable (like a cancelled dep) and report it by code rather than silently admitting the set. |
| S10 | Task check | `packages/app/src/services/task-check.ts:1180` (beside `L4_FEATURE_DEPRECATED`; the new branch at `:1251`); `packages/config/src/finding-codes.ts:47,48,149,154` | New warning `L4.task-deprecated` for a live dependent of a deprecated task, plus the deprecated task's own advisory; guidance names re-point and un-deprecate. |
| S11 | Routing | `plugins/sp/skills/next-router/SKILL.md`, `plugins/sp/skills/next-router/references/routing-table.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md` | Never select a deprecated task as the next step; `spur task list --status deprecated` works through the enum with no edit. |
| S12 | Board | `apps/web/src/modules/task-kanban/KanbanBoard.tsx`, `TasksShell.tsx` (filter membership from `TASK_STATUSES`), `TaskCard.tsx:32` (colour), `task-actions.ts:17` (deprecate/undeprecate actions) | Status icon/colour, filter membership from `TASK_STATUSES`, and deprecate/undeprecate actions on the legal source statuses. |
| S13 | Skills / docs | `plugins/sp/skills/spur-cli/references/tasks.md`; `docs/design/planning-record-contracts.md` §7.3.3; `docs/design/rd3-migration-design.md` §2.3; `docs/design/planning-workflow-contracts.md` §7.5; `docs/design/e2e-workflow-for-system-development.md` (lifecycle FSM node) | Document the status, the legal edges, the freeze guards and the exempt write set; keep every task-status enumeration identical to `TASK_STATUSES`. |
| S14 | Plugin scripts | `plugins/sp/scripts/wrapup-steps.ts:171`, `plugins/sp/scripts/quality-gate.mjs` | **Audit only — verified 2026-10-13, no edit.** `wrapup-steps.ts:171` is the sole task-status terminal set (`done`/`cancelled`): a wrapup batch must resolve to a *completed* status, and `deprecated` is non-terminal and did not complete, so keeping it out is correct. `quality-gate.mjs` is generated (`quality-gate.ts` glue + `lib/quality-gate.generated.mjs`, regenerate with `build:plugin-lib && build:scripts`); its only terminal set is run statuses (`lib/quality-gate.generated.mjs:27498`, from `packages/domain/src/dao/run-transfer.ts`), and the bundled `TASK_STATUSES` already carries `deprecated` — hand-editing generated output would desync the committed twin. |
| S15 | Persistence | — | **None (frontmatter only) — verified 2026-10-13.** No `tasks` table exists in `drizzle/` (only `task_run_links`), no DAO owns task status, and the status lives in frontmatter (`packages/domain/src/planning/schema.ts:20`). `planning_events.from_status`/`to_status` is an append-only event ledger rebuildable from `## History`, not a status store. |

### 3.2 The exempt write set (settles inventory item I16)

The freeze constrains **status-moving** writes only. These pipeline hops keep working on a
deprecated task, because each edits the record rather than declaring the work resumable:

| Hop | Permitted | Why |
| --- | --- | --- |
| `spur task record` (Testing/Solution/Review sections) | yes | Records what already happened; refusing it would strand the evidence trail. |
| `spur task migrate-anchors`, verdict writes | yes | Corpus-integrity and evidence hops, same reasoning. |
| `spur task update <wbs> --section <any>` | yes, with a freeze warning | Matches `FeatureService.updateSection` (S6). |
| `spur task update <wbs> <status>` to anything but `todo`/`cancelled` | no | The graph refuses it (S3/S7). |
| New dependency edge onto the task (`dependencies[]`) | no | S8/S9. |

A dependency edge that already exists when the task is deprecated is **reported, never rewritten**
(I5/R5): the freeze is prospective, exactly as F42's is.

## 4. Contract and compatibility

### 4.1 Lifecycle edges

| From | To | Guard | Note |
| --- | --- | --- | --- |
| backlog, todo, wip, testing, blocked, done | deprecated | `always` | Freeze; `done` included so a withdrawn capability can be marked after the fact. |
| deprecated | todo | `always` | Un-deprecate; History entry mandatory. |
| deprecated | cancelled | `always` | Remove the deprecated task. |

Undeclared targets stay refused by the graph, and `deprecated` is not terminal.

### 4.2 Guards and findings

| Guard | Surface | Behaviour |
| --- | --- | --- |
| Dependency link | `idea-handoff.ts`, `TaskService.mutateDependencies` (S8) | Refuse before write, naming the task and the un-deprecate command. |
| Admission | `batch-preflight.ts` (S9) | Non-runnable; reported by code. |
| Live dependents | `task-check.ts` (S10) | `L4.task-deprecated` warning; `--strict` elevates per existing policy. |
| Section write | `task-service.ts` (S6) | Succeeds with a freeze warning in the result. |
| Status write | graph (S3/S7) | Refused unless `todo`/`cancelled`; hint names un-deprecation. |
| Derivation | `feature-service.ts` (S5) | Terminal-linked: never blocks a feature's exit, never reopened. |

### 4.3 Compatibility

- The enum addition is additive; old task files parse unchanged and no migration runs.
- A project-layer `task-lifecycle.yaml` override must be re-synced to gain the edges; until then a
  deprecation write is refused by the stale graph rather than silently accepted.
- No DB, contract-regeneration or Board-API change is required.

## 5. Tradeoffs and open questions

- **Rejected: a `frozen` flag beside `status`.** A second axis every consumer must combine, and the
  status vocabulary could no longer express the actual situation.
- **Rejected: terminal `deprecated`.** Duplicates `cancelled` and loses un-deprecation (ADR-136
  rejected the same shape at the feature layer).
- **Rejected: `task advance` refusal.** There is no such verb; adding one to have somewhere to
  refuse would be a public-surface expansion for no operator benefit.
- **Resolved during planning (2026-10-13):** the dependency edge's on-disk key is `dependencies`
  (not `depends_on`); the ordering vocabulary `depends_on_names` is handoff-payload-only. Recorded
  above so the guard slice does not grep for a key that never reaches the file.
- **Open:** whether `L4.task-deprecated` should be an error once the status has been in use for a
  release (the F42 finding stayed a warning; the same ratchet discussion belongs to the corpus-gate
  work, not to this feature).
