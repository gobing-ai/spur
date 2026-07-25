---
name: "W2: FeatureService and spur feature core verbs with hierarchical IDs"
description: "W2: FeatureService and spur feature core verbs with hierarchical IDs"
status: done
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-14T17:55:21.147Z
folder: docs/tasks
type: task
feature-id: F3
priority: P0
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0056. "W2: FeatureService and spur feature core verbs with hierarchical IDs"

### Background

Design §2.2/§2.4, DD-14. B01/B02/B05. Groups = top-level letters; ID length = depth.


### Requirements

R1. create --parent <id> with digit allocation under create-lock; no parent = next free group letter.
R2. show/update/list (status/priority filters, --json) sharing the write path.
R3. ID regex ^[A-Z][1-9]*$; parent derived by dropping last char; no parent_id field.
R4. Same-commit 04_DESIGN §7.2 sync.


### Q&A



### Design

Authority: delivery doc §1.2 (verb surface incl. `create --parent`), design §2.2 (feature field table —
no `parent_id`), §2.4 + DD-14 (hierarchical IDs: groups = single letters; children one digit 1–9 per
level; length = depth; allocation scans the parent's children under the create-lock; parent = drop last
char; no-parent create allocates the next free group letter), §10 behavior contracts. Same write path as
tasks (PlanningWriteService).


### Solution

1. `packages/app/src/services/feature-service.ts`: create/show/update/list over PlanningWriteService;
   ID allocation in the create-lock scope; ID parsing/derivation helpers (`parentOf`, `depthOf`,
   `isValidId`). (`childrenOf` enumeration is deferred to the tasks that consume it — 0058 INDEX/tree
   refresh and 0061 cascade-move — since 0056's verbs need only allocation + parent derivation.)
2. `apps/cli/src/commands/feature.ts`: commander noun, transport-only.
3. Dogfood requirement (F3 note): the hand-authored `docs/features/` corpus (A–H groups + leaves) is a
   fixture — parsing, listing, and ID derivation must accept it unchanged; add it to the test fixtures.
4. Tests: allocation sequences (A→A1→A2; A1→A11), next-free-group-letter, regex rejections, list
   filters, `--json` envelope. Same commit: `04 §7.2`. Gate: `bun run check`; ≥90%.


### Plan

- [x] `FeatureService` create/show/update/list over PlanningWriteService (`packages/app/src/services/feature-service.ts`)
- [x] ID helpers: `parentOf` (drop last char), `depthOf` (length), `isValidId` (`^[A-Z][1-9]*$`), no `parent_id` (R3)
- [x] R1: ID allocation inside the create-lock via new `PlanningWriteService.createAllocated()` (race-safe; applied to Task too)
- [x] R2: `apps/cli/src/commands/feature.ts` (create/show/update/list, `--json`), registered in `index.ts`; `FeatureService` exported
- [x] `update` (scalar field) + `transition` (status) verbs over the shared write path
- [x] Tests: allocation sequences, concurrent-race safety, regex rejections, list filters, `--json` envelope, CLI surface
- [x] R4: sync `04_DESIGN §7.2` (feature command table + DD-14 ID rules)
- [x] Dogfood: the hand-authored `docs/features/` corpus (A–H + leaves) parses via `FEATURE_FILE_RE` unchanged


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0056 --force --fix all`)

As shipped, the `FeatureService` existed with good ID helpers (R3), but R2 was UNMET (no CLI command, no
`update` verb, service not even exported), R1 had an allocation race, and R4 (doc) was not synced. Fixed
all during the fix-pass.

**S — Security:** Feature files are inert markdown; IDs validated by `^[A-Z][1-9]*$`. CLI input validated at
the commander boundary; no injection surface.

**C — Correctness / architecture:**
- R1 ✓ **Allocation now runs inside the create-lock.** Added `PlanningWriteService.createAllocated(folder,
  allocate)` — the allocator (dir-scan → pick next free child digit / group letter) and the file write are
  one atomic critical section. Applied to FeatureService AND TaskService (`create` + `batchCreate`) for
  consistency (R6). Concurrent creates can no longer allocate the same ID and clobber: the lock holder
  wins, contenders fail loudly (no silent overwrite). Verified by a concurrency test + a sequential
  A1/A2/A3 test.
- R2 ✓ `apps/cli/src/commands/feature.ts` (create/show/update/list, `--json`, exit 0/1/2), registered in
  `index.ts`; `FeatureService` exported from `@gobing-ai/spur-app`; added `update` (scalar field) +
  `transition` (status) verbs over the shared write path. Status/priority list filters + ID-sorted output.
- R3 ✓ ID regex `^[A-Z][1-9]*$`, `parentOf` (drop last char), `depthOf` (length), no `parent_id` field —
  tested incl. rejections (`A0`, `a`, `1`, empty).
- R4 ✓ `04_DESIGN §7.2` filled with the full `spur feature` command table + DD-14 ID rules.

**U — Usability:** Verb surface mirrors `spur task`; `--json` envelopes throughout; `refresh`/`move` noted as
0058/0061 follow-ups in the doc table.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | R2 UNMET: no `spur feature` CLI command, `FeatureService` not exported from spur-app, no `update` verb — the service was unreachable dead code (same pattern as 0055). | Correctness | `apps/cli/src/commands/feature.ts` (missing) | P1 | **FIXED** — built the CLI command (create/show/update/list/`--json`), registered it, exported the service, added `update`+`transition`. |
| 2 | R1 allocation race: IDs picked OUTSIDE the create-lock — concurrent creates could allocate the same ID and `atomicWriteAsync` would silently overwrite. Codebase-wide (TaskService too). | Correctness | `feature-service.ts`, `task-service.ts` | P2 | **FIXED** — `PlanningWriteService.createAllocated()` runs allocation inside the create-lock; applied to Feature + Task create + batchCreate. Race + sequential tests added. |
| 3 | R4: `04_DESIGN §7.2` was an unfilled landing-zone row despite the "same-commit §7.2" requirement. | Process | `docs/04_DESIGN.md §7.2` | P3 | **FIXED** — §7.2 command table + ID rules written. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1045 pass / 0
fail · `feature.ts` coverage 90.6% line / 92.9% func · E2E `spur feature create`/`--parent`/`list` verified.


### Testing

Verified 2026-06-14. Tests genuine (real assertions, no stubs for the verified paths).

- `packages/app/tests/services/feature-service.test.ts` — 15 tests: ID helpers (parentOf/depthOf/isValidId
  incl. DD-14 rejections), create (top-level + child), list, show, `update` (field set + unknown-ID throw),
  and **allocation race-safety** (sequential A1/A2/A3 + concurrent creates never produce duplicate IDs;
  loser fails loudly; no duplicate IDs on disk).
- `apps/cli/tests/commands/feature.test.ts` — 15 tests: noun help, create (top-level/child/`--json`), show
  (`--json` + human + unknown→exit 1), update (`--field/--value`, status transition, exit 2 on bad usage),
  list (`--json` sorted + `--priority` filter + human rows). Exercises the real `main()` entry point.
- `packages/app/tests/services/task-service.test.ts` — batchCreate mid-batch rollback test updated to inject
  failure via the new `createAllocated` path (race-safe allocation); rollback still leaves zero files.

E2E through the real CLI: `feature create Foundation` → `A`, `feature create --parent A` → `A1`, `feature
list` shows both sorted; files written as `A_foundation.md` / `A1_sub-thing.md`.

Full suite: 1045 pass / 0 fail. `feature.ts` coverage 90.6% line / 92.9% func.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


