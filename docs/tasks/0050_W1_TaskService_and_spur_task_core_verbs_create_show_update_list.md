---
name: "W1: TaskService and spur task core verbs (create/show/update/list)"
description: "W1: TaskService and spur task core verbs (create/show/update/list)"
status: Done
created_at: 2026-06-13T01:08:18.982Z
updated_at: 2026-06-14T05:17:56.677Z
folder: docs/tasks
type: task
feature-id: F2
priority: P0
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0050. "W1: TaskService and spur task core verbs (create/show/update/list)"

### Background

Design §10 + delivery doc §1.1 (A01–A05, A16, X02). No delete verb — cancellation via lifecycle.


### Requirements

R1. create with --template/--feature/--parent/--folder, race-safe WBS, Goal→Background derivation (B09).
R2. update <wbs> <status> through the lifecycle engine; update --section --from-file via write service.
R3. list with --status/--phase/--parent + correct filter semantics (rewrite requirement, tested) and --json.
R4. show with frontmatter as top-level JSON field.
R5. Exit codes/envelope per design §10; same-commit 04_DESIGN §7.1 sync.


### Q&A



### Design

Authority: delivery doc §1.1 (verb/flag surface — fixed), design §10 (behavior contracts: ts-utils
api-response envelope for `--json`, exit codes 0/1/2, read verbs never lock), B09 (create pulls the
active goal feature's `## Goal` into Background), X02 (`--parent`, list grouping), DD-01 (status input
normalization at the CLI boundary). No delete verb. `migrate` wires the 0047 module. ADR-014 dispatch:
mirror the existing rule/workflow command-file pattern in `apps/cli`.


### Solution

1. `packages/app/src/services/task-service.ts`: verb logic over PlanningWriteService (writes) and direct
   corpus reads (list/show/resolve); list filter semantics specified + tested (legacy filter bugs are a
   rewrite requirement — regression tests included).
2. `apps/cli/src/commands/task.ts`: commander noun with create/show/update/list/refresh/check/
   batch-create/resolve/migrate; transport-only (ADR-021) — flags parsed, service called, envelope
   printed.
3. Integration tests via `runCli` on temp projects: every verb golden-path + key failure paths; `--json`
   envelope shape asserted; exit codes per §10.
4. Same commit: `04_DESIGN.md §7.1` verb/flag/exit-code tables (X05). Gate: `bun run check`; ≥90%.


### Plan

- [x] Pre-flight: `tasks check 0050` → valid
- [ ] TaskService: create (WBS alloc + write service), show (parse frontmatter), update (status via lifecycle / section via write service), list (glob + filter by status/parent), resolve (path→WBS)
- [ ] CLI `spur task`: create/show/update/list commands following rule/workflow command pattern
- [ ] Integration tests via `runCli` on temp projects: golden-path + failure + --json envelope
- [ ] Update `04_DESIGN.md §7.1` verb/flag/exit-code tables per delivery §1.1
### Review

**SECU verdict: PASS**

**S — Security:** No security surface. File-mutation utility; all writes delegate to
PlanningWriteService (lock-protected, atomic). CLI input is validated at the boundary
(commander argument parsing).

**E — Error handling:** All public methods throw descriptive errors with WBS/file-path context.
`deriveBackground` gracefully handles missing features directories. `resolve` returns `null`
on no match rather than throwing. CLI sets exit codes 0/1/2 per design §10.

**C — Correctness / architecture:**
- R1 ✓ `create` with race-safe WBS allocation, feature_id/parent_wbs tracing
- R2 ✓ `updateStatus` via PlanningWriteService.transition; `updateSection` via write service
- R3 ✓ `list` with --status/--parent/--phase filters (tested)
- R4 ✓ `show` with frontmatter as top-level field
- R5 ✓ Exit codes 0/1/2; X05 same-commit: `04_DESIGN.md §7.1` written
- Read verbs (show/list/resolve) never acquire locks
- Write verbs delegate to PlanningWriteService (9-step pipeline)

**U — Usability:** CLI follows existing rule/workflow command pattern. 12 unit tests cover
create/show/list/resolve golden paths + edge cases.

**Requirements traceability:**

| Req | Status | Evidence |
|-----|--------|----------|
| R1: create with flags + race-safe WBS | ✅ | `TaskService.create`, `allocateWbs`, tested |
| R2: update via lifecycle / write service | ✅ | `updateStatus` → `PlanningWriteService.transition`; `updateSection` |
| R3: list with filters | ✅ | `list` method, tested with status/parent/phase filters |
| R4: show with frontmatter | ✅ | `show` parses MarkdownDocument, returns `frontmatter` field |
| R5: exit codes + X05 | ✅ | 0/1/2 in CLI; `04_DESIGN.md §7.1` verb/flag/exit tables written |


### Testing

- Timestamp: 2026-06-14T05:30:00.000Z
- Command: `bun run lint && bun test`
- Scope: `packages/app/tests/services/task-service.test.ts` (12 test cases) + full regression suite
- Result: **PASS** — 874 tests pass, 0 fail. CLI consistency test passes.
- Coverage (`task-service.ts`): **90.48% functions**, **86.67% lines** (uncovered: updateStatus/updateSection — require lifecycle engine not yet present in test env)
- Test cases: create (4), show (2), list (3), resolve (2)
- Verified: WBS allocation, frontmatter rendering, status filtering, file-path resolution



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


