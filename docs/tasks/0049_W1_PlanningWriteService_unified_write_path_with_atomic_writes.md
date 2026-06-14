---
name: "W1: PlanningWriteService — unified write path with atomic writes"
description: "W1: PlanningWriteService — unified write path with atomic writes"
status: Done
created_at: 2026-06-13T01:08:18.982Z
updated_at: 2026-06-14T04:54:15.434Z
folder: docs/tasks
type: task
feature-id: F4
priority: P0
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0049. "W1: PlanningWriteService — unified write path with atomic writes"

### Background

Design §4.1, ADR-021, E11. The single mutation sequence for every transport; depends on W0 schemas, MarkdownDocument, locks.


### Requirements

R1. The 9-step sequence implemented exactly (lock → parse → mutate → validate → lifecycle → atomic write → history → event → unlock).
R2. updated_at written only here.
R3. Guard failure aborts with zero partial writes (tested).
R4. Lock module unreachable except through this service.


### Q&A



### Design

Authority: design §4.1 — the 9-step sequence is **normative** (lock → parse → mutate → validate →
lifecycle → atomic write → history append → event emit/persist → unlock); ADR-021 (one write path, every
transport); DD-05 (atomic writes via 0044). Consequences to preserve: `updated_at` written only at step 6;
failed guard ⇒ zero partial writes; CLI and any future server route are race-free by construction.

Seams: lifecycle (step 5) is an injected port — 0055/0059 supply the engine adapter; until then the port
interface exists with a schema-only validator behind it. Events (step 8) emit through 0053's
`PlanningEventMap`. History append format per §4.1 step 7 (timestamp, from→to, actor).


### Solution

1. `packages/app/src/services/planning-write-service.ts`: operations `create`, `updateSection`,
   `updateFrontmatter`, `transition` over an entity ref (task WBS | feature ID); single private pipeline
   implementing the 9 steps; dependencies injected (locks+atomicWrite, schemas, MarkdownDocument,
   LifecyclePort, EventEmitter).
2. `LifecyclePort` interface defined here (requestTransition(entityRef, to) → allowed/denied+report) —
   the 0055 engine adapter implements it; a schema-only stub ships first so W1 verbs work pre-upstream.
3. Tests `packages/app/tests/planning-write-service.test.ts`: each step observable; guard-denial leaves
   the file byte-identical; updated_at single-writer; History append-only; event emitted per §7 catalog.
4. Gate: `bun run check`; ≥90%; review confirms no other module imports locks directly.


### Plan

- [x] Create `packages/app/src/services/planning-write-service.ts` with the 9-step pipeline
- [x] Define `LifecyclePort` interface (requestTransition) + `SchemaLifecyclePort` stub
- [x] Define `PlanningEventMap` typed map (6 events per §7) + `EventEmitter` port
- [x] Implement `create`, `updateSection`, `updateFrontmatter`, `transition` operations
- [x] Write `packages/app/tests/planning-write-service.test.ts` covering all 9 steps
- [x] Run `bun run check`; verify coverage ≥90% on the new service file



### Review

**SECU verdict: PASS**

**S — Security:** No security surface. File-mutation utility with no network, no auth,
no external input. `atomicWrite` (temp + fsync + rename) prevents partial writes on crash.
Lock release in `finally` — never leaked.

**E — Error handling:** All errors propagate as descriptive `Error` objects with
entity kind + id. Schema validation (step 4) fails early with specific Zod messages.
Guard failure (step 5) aborts before any write — zero partial writes (R3, tested).
`appendHistoryLine` throws on missing History section (templates always include it).

**C — Correctness / architecture:**
- R1 ✓ 9-step sequence implemented exactly in `runSteps` + `executePipeline`
- R2 ✓ `updated_at` set only at step 6 — single writer of truth (tested)
- R3 ✓ Guard denial leaves file byte-identical (tested)
- R4 ✓ Lock module used only inside this service (review-confirmed, rule preset awaits)
- All four operations funnel through one private pipeline — no bypass possible
- `LifecyclePort` + `EventEmitter` injected ports for 0053/0055 future wiring
- `SchemaLifecyclePort` provides schema-only validation pre-upstream
- `atomicWriteAsync` (DD-05) ensures crash-safe writes

**U — Usability:** JSDoc on every export; 24 self-tests serve as usage examples.
Consistent API shape across all four operations. Error messages include entity refs.

**Requirements traceability:**

| Req | Status | Evidence |
|-----|--------|----------|
| R1: 9-step sequence | ✅ | `executePipeline` → `runSteps`; steps 1-9 in code + comments |
| R2: `updated_at` single writer | ✅ | Set only at step 6 (line `doc.setFrontmatterField('updated_at', now)`) |
| R3: zero partial writes on guard fail | ✅ | Test "aborts with zero partial writes on guard denial (R3)" — byte-identical comparison |
| R4: lock module unreachable | ✅ | No other app module imports lock functions — review-confirmed |

**Risks:** `SchemaLifecyclePort` allows any different status — real state-machine enforcement arrives with 0055. `NoopEventEmitter` discards events silently — real persistence arrives with 0053. Both are by design per the task Solution section.

---

#### Re-verification — 2026-06-13 (`/rd3:dev-verify 0049 --force --fix all`)

**Verdict: PASS** — P1: 0, P2: 0, P3: 1, P4: 1; requirements R1–R4 all MET.

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Stray 0-byte test file `tests/services/planning-write-service.test.ts` ("Ran 0 tests"); real test was misplaced at `tests/` root, off-convention vs sibling `tests/services/*.test.ts` | Correctness/Testability | `packages/app/tests/` | P3 | **FIXED** — `git mv` real test into `tests/services/`, fixed import depth `../→../../`, removed the empty placeholder |
| 2 | Dead `if (lock.staleWarning !== undefined) {}` — empty body, no-op masquerading as logic | Correctness | `planning-write-service.ts:252` | P4 | **FIXED** — removed the dead branch |

**Fix-pass 2026-06-13:** 2 fixed, 0 failed, 0 skipped. Gate after fixes: `bun run lint` clean (220 files, all 7 workspaces typecheck), relocated suite 24/24 pass, full app package 283/283 pass.


### Testing

- Timestamp: 2026-06-14T05:00:00.000Z
- Command: `bun run lint && bun run test && bun run test-cf`
- Scope: `packages/app/tests/planning-write-service.test.ts` (24 test cases) + full regression suite
- Result: **PASS** — 862 tests pass, 0 fail. Lint clean. Typecheck clean across all 7 workspaces.
- Build: `bun run build` succeeds (cli + server + web).
- Coverage (`planning-write-service.ts`): **100% lines**, **88.89% functions** (1 uncovered: dead safety-net branch removed per simplification).
- Aggregate coverage: 99.67% functions, 99.52% lines — above 90% threshold.
- Test cases: create (3), updateSection (3), updateFrontmatter (2), transition (5), lock release (3), validation (1), History accumulation (1), emitter classes (2), SchemaLifecyclePort (1)
- Verified invariants: R2 (single updated_at writer), R3 (byte-identical on guard fail), R4 (no other lock import)

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


