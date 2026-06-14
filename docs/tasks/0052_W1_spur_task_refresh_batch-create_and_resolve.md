---
name: "W1: spur task refresh, batch-create and resolve"
description: "W1: spur task refresh, batch-create and resolve"
status: Done
created_at: 2026-06-13T01:08:18.982Z
updated_at: 2026-06-13T01:08:18.982Z
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

## 0052. "W1: spur task refresh, batch-create and resolve"

### Background

Design §4.3 + delivery doc §1.1 (A06/A08/A10). batch-create is the LLM→CLI gate.


### Requirements

R1. refresh: kanban.md pure regeneration, status+parent_wbs grouping, deterministic ordering, golden-file tests.
R2. batch-create --file validated by task-batch.schema.json, all-or-nothing.
R3. resolve <path> → WBS + file (write-guard lookup).
R4. Same-commit 04 sync.


### Q&A



### Design

Authority: design §4.3 (generated artifacts are pure functions: full regeneration, deterministic
ordering, never inputs), delivery doc §1.1 rows for refresh/batch-create/resolve, §3.3
`task-batch.schema.json` (the LLM→CLI gate — all-or-nothing), A10 (resolve backs the write-guard hook).
Kanban groups by status and `parent_wbs` (X02).


### Solution

1. Kanban renderer in TaskService: corpus scan → deterministic sort → `kanban.md` write via the write
   service path (generated artifacts exempt from per-entity locks but still atomic); golden-file tests.
2. `batch-create --file`: parse → validate against `apps/cli/schemas/task-batch.schema.json` (hand-
   authored contract: name, background, requirements, feature_id, parent_wbs, priority, tags, template)
   → all items created inside one create-lock scope; any failure ⇒ nothing written, findings reported.
3. `resolve <path>`: folder registry scan + WBS filename parse → {wbs, file} or clear not-found; `--json`.
4. Tests: batch all-or-nothing (schema violation writes zero files); resolve across registered folders;
   kanban grouping incl. parent_wbs clusters. Same commit: `04 §7.1` + schema docs. Gate: ≥90%.


### Plan

- [x] `TaskService.refresh()` — corpus scan → deterministic kanban render → atomic write
- [x] `TaskService.batchCreate()` — Zod-validate → all-or-nothing create with rollback
- [x] `TaskService.resolve()` — direct match + filename WBS parse strategies
- [x] `apps/cli/schemas/task-batch.schema.json` editor/CI contract (Zod is runtime SSOT)
- [x] CLI `spur task refresh|batch-create|resolve` wired with `--folder`/`--json`, exit codes
- [x] Tests: refresh determinism + parent grouping, batch rollback (pre- and mid-write), resolve strategies
- [x] Sync `04_DESIGN.md §7.1` — refresh/batch-create/resolve active rows

### Review

**SECU verdict: PASS** (after 2026-06-14 re-verification fix-pass)

**S — Security:** Read-mostly. `batchCreate` writes through `PlanningWriteService` (lock+atomic);
rollback deletes partial files best-effort on failure. No network, no secrets. CLI input validated
at the commander boundary; batch payload validated by Zod before any write.

**E — Error handling:** `batchCreate` throws descriptive errors (bad JSON, schema violations with
per-field paths). `resolve` returns `null` (never throws) on no match. `refresh` is a pure render.

**C — Correctness / architecture:**
- R1 ✓ `refresh` → `renderKanban` — deterministic (TASK_STATUSES order, lexicographic WBS sort,
  parent_wbs clustering); determinism + grouping tested.
- R2 ✓ `batchCreate` all-or-nothing — Zod validate upfront; mid-batch write failure rolls back every
  file already written (now tested via injected failing writeService).
- R3 ✓ `resolve` — direct path match + filename WBS parse (both tested). Walk-up to a non-task owner
  is deferred to the write-guard hook (task 0067); the dead no-op loop was removed.
- R4 ✓ `04_DESIGN.md §7.1` refresh/batch-create/resolve rows active.

**U — Usability:** CLI follows the rule/workflow command pattern; `--json` envelopes throughout.

---

#### Re-verification — 2026-06-14 (`/rd3:dev-verify 0052 --force --fix all`)

Task was marked `Done` with **empty Review, Testing, and Plan sections** — no verification record
existed. Implementation quality was actually good; the task file just claimed nothing. Verdict: PARTIAL → PASS after fix-pass. P1: 0, P2: 0, P3: 4 (fixed), P4: 1 (fixed).

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Empty Review/Testing/Plan despite `Done` — unverifiable as delivered | Process | task md | P3 | **FIXED** — verification record written |
| 2 | **R2 schema drift** — runtime uses Zod `taskBatchSchema`, not the named `task-batch.schema.json`; the two had diverged (JSON: `additionalProperties:false`; Zod: non-strict + stricter `feature_id`/`parent_wbs` regexes) | Architecture | `schema.ts` / `task-batch.schema.json` | P3 | **FIXED** — Zod `.strict()` to match JSON; JSON `feature_id`/`parent_wbs` patterns + "Zod is SSOT" note added |
| 3 | `resolve` strategy-3 walk-up was dead code (loop only ever returned `null`) | Correctness | `task-service.ts` | P3 | **FIXED** — removed; deferred to 0067 with a comment |
| 4 | Mid-batch rollback (post-write) untested — only pre-write validation rollback was covered | Testability | `task-service.test.ts` | P3 | **FIXED** — added test injecting a writeService that fails on item 2; asserts zero files remain |
| 5 | Empty `} catch {}` with no comment in `deriveBackground` | Correctness | `task-service.ts` | P4 | **FIXED** — explanatory comment |

**Fix-pass 2026-06-14:** 5 fixed, 0 failed, 0 skipped.

### Testing

- Command: `bun run lint && bun run test && bun run test-cf && bun run build`
- Scope: `packages/app/tests/services/task-service.test.ts` (24 cases incl. refresh determinism,
  batch pre-/mid-write rollback, resolve strategies) + `apps/cli/tests/commands/task.test.ts`
  (refresh/batch-create/resolve CLI golden paths + `--json` + exit codes) + full regression.
- Result: **PASS** — full suite green, lint clean across 7 workspaces, `test-cf` + `build` succeed.
- Coverage: `task-service.ts` exercised across all three verbs at unit + CLI integration layers.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


