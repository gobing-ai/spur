---
schema_version: 1
name: Move HistoryBoardService interface out of the mock and drop MockHistoryBoardService from the spur-app production barrel
status: todo
template: standard
created_at: 2026-09-26T04:37:17.893Z
updated_at: "2026-09-26T04:55:54.823Z"

feature_id: E82
ac_numbering: task-local
---

## 0961. Move HistoryBoardService interface out of the mock and drop MockHistoryBoardService from the spur-app production barrel

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), architecture candidate **C1 (wrong seam)**, commit base `959f84bd6`.

The production interface `HistoryBoardService` is declared inside the test double's file, and the 1,321-line test double ships in the `@gobing-ai/spur-app` production barrel:

- `packages/app/src/services/history-board-mock-service.ts:21` — `export interface HistoryBoardService` (the port).
- `packages/app/src/services/history-board-mock-service.ts:274` — `export class MockHistoryBoardService implements HistoryBoardService` plus ~250 lines of deterministic fixture catalogs (`SOURCES_CATALOG` :53, `MODELS_CATALOG` :146, `TOOLS_CATALOG` :154, `SKILLS_CATALOG` :165, `generateDeterministicSessions` :172, `MOCK_NOW` :269).
- `packages/app/src/services/history-board-service.ts:86` — the **live** implementation imports its own contract from the mock file (`import type { HistoryBoardService } from './history-board-mock-service'`); `LiveHistoryBoardService` at :877.
- `packages/app/src/index.ts:258-259` — barrel re-exports both the type and `MockHistoryBoardService`.

Consumers (verified via `rg`, 2026-09-25):
- Interface: `apps/server/src/context.ts:6,162` (type only, via the barrel).
- Mock (tests only — no production consumer): `apps/server/tests/modules/history/handlers.test.ts:2`, `packages/app/tests/services/history-response-shape.test.ts:16`, `packages/app/tests/services/history-board-mock-service.test.ts:2`.

Why it matters: the dependency points the wrong way (real → mock), and fixture data is part of a released package's public surface. Advisory severity in a standalone review; no runtime defect.

### Requirements

- [ ] R1. `HistoryBoardService` is declared in `packages/app/src/services/history-board-service.ts` (the live implementation's module), and no file under `packages/app/src/` other than the mock itself imports the mock module.
- [ ] R2. `MockHistoryBoardService` and its fixture catalogs are no longer exported from the `@gobing-ai/spur-app` root barrel (`packages/app/src/index.ts`), so the Worker bundle stops pulling the mock module.
- [ ] R3. The mock moves to `packages/app/src/testing/history-board-mock.ts`, exposed only via a new `"./testing"` subpath export, and its three test consumers import it from there with no assertion change.
- [ ] R4. `HistoryBoardService` stays exported (type-only) from the root barrel, so `apps/server/src/context.ts:6,162` compiles with no edit under `apps/server/src/`.

### Acceptance Criteria

Graduates all four of feature E82's scenarios (exact titles below); the numbered rows are the verify lens.

- [ ] AC1 — R1 — Production code owns the History Board port (req: R1)
- [ ] AC2 — R2 — The root barrel ships no History Board fixture (req: R2)
- [ ] AC3 — R3 — Tests reach the mock through the testing subpath (req: R3)
- [ ] AC4 — R4 — Server context compiles against the unchanged port export (req: R4)

**Verify lens**

- **AC1** — `rg -n "interface HistoryBoardService" packages/app/src` hits only `services/history-board-service.ts`; `rg -l "history-board-mock|MockHistoryBoardService" packages/app/src` lists only `src/testing/history-board-mock.ts`; `git ls-files packages/app/src/services/history-board-mock-service.ts` is empty.
- **AC2** — `rg -n "MockHistoryBoardService|history-board-mock" packages/app/src/index.ts` returns nothing; `bun run test-cf` green.
- **AC3** — `jq -r '.exports["./testing"]' packages/app/package.json` prints `./src/testing/history-board-mock.ts`; the three consumers import `@gobing-ai/spur-app/testing` (cross-workspace) or `../../src/testing/history-board-mock` (in-package) and pass: `(cd packages/app && bun test tests/services/history-response-shape.test.ts tests/services/history-board-mock-service.test.ts)` and `(cd apps/server && bun test tests/modules/history/handlers.test.ts)`; `git diff <base> -- '**/tests/**'` shows only import-line changes.
- **AC4** — `git diff <base> --stat -- apps/server/src` is empty; `bun run typecheck` and `bun run spur-check` green.

### Q&A

- **Q:** Test-only subpath (`@gobing-ai/spur-app/testing`) or move the mock under `packages/app/tests/fixtures/`? **A:** Subpath. `apps/server` tests consume the mock cross-workspace; a `tests/` location would force a deep relative import across workspaces (forbidden by AGENTS.md). Decided 2026-09-25 (refinement).
- **Q:** Separate `history-board-port.ts` for the interface? **A:** No — the interface is the live implementation's contract; declaring it in `history-board-service.ts` is one file fewer. The mock imports the type from there (test → prod direction is correct).
- **Q:** Is removing `MockHistoryBoardService` from the root barrel a breaking change for external consumers? **A:** No external consumer: `packages/app/package.json` is `"private": true` (checked 2026-09-25) and `rg` finds no production importer. No changelog entry required.
- **Q:** Keep the test filename `history-board-mock-service.test.ts`? **A:** Yes — renaming a test file is churn outside the requirement; only its import line changes.

### Design

Package-export change only; no public `spur` noun/verb change, no behavior change.

1. **Interface move.** Cut `export interface HistoryBoardService { … }` (mock file :21, plus any request/response types it declares that the live file needs) into `services/history-board-service.ts`. Replace `import type { HistoryBoardService } from './history-board-mock-service'` (:86) with the local declaration.
2. **Mock move.** `git mv packages/app/src/services/history-board-mock-service.ts packages/app/src/testing/history-board-mock.ts`; its import becomes `import type { HistoryBoardService, … } from '../services/history-board-service'`. Content otherwise unchanged.
3. **Subpath.** Add `"./testing": "./src/testing/history-board-mock.ts"` to `packages/app/package.json` `exports`, in the same style as the existing entries (`./errors`, `./feature-check`, …). Name it `testing` (not `history-board-mock`) so later test doubles can join without another export.
4. **Barrel.** In `src/index.ts:258-259`: re-point `export type { HistoryBoardService }` to `./services/history-board-service` (merge into the :260 line), delete the `MockHistoryBoardService` export.
5. **Consumers** (all three import `MockHistoryBoardService` today — two via the in-package barrel `../../src`, one via `@gobing-ai/spur-app`): `apps/server/tests/modules/history/handlers.test.ts:2` → `@gobing-ai/spur-app/testing`; `packages/app/tests/services/history-response-shape.test.ts:16` and `history-board-mock-service.test.ts:2` → `../../src/testing/history-board-mock`. `history-board-service.test.ts` imports the live class only — untouched.

**Invariant:** nothing under `packages/app/src/` (other than `src/testing/`) imports `src/testing/`. The Worker entry never imports the `./testing` subpath.

**Rejected:** fixture under `tests/` (deep cross-workspace import); keeping the mock in the barrel behind a comment (still ships in the Worker bundle).

### Plan

- [ ] Move the interface (and any types it needs) into `services/history-board-service.ts`; drop the reverse import at :86.
- [ ] `git mv` the mock to `src/testing/history-board-mock.ts`; fix its type import.
- [ ] Add the `"./testing"` export to `packages/app/package.json`.
- [ ] Edit `src/index.ts:258-260` per Design §4.
- [ ] Update the three test imports (Design §5).
- [ ] Focused: `(cd packages/app && bun test tests/services/history-response-shape.test.ts tests/services/history-board-mock-service.test.ts tests/services/history-board-service.test.ts)`; `(cd apps/server && bun test tests/modules/history)`.
- [ ] Gates: `bun run spur-check`, `bun run test-cf`; run the AC1–AC4 `rg`/`jq`/`git diff` probes and paste output into Testing.
- [ ] One commit: `refactor(app): own HistoryBoardService in the live module; mock moves to /testing subpath (0961)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: E82 (parent E8 — History Board module).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C1; base commit `959f84bd6`.
- AGENTS.md: cross-workspace imports use `@gobing-ai/*`, never deep relative paths.

### History

- 2026-09-26T04:40:05.422Z backlog → todo (system)

