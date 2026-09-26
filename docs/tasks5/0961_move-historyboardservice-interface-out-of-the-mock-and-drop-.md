---
schema_version: 1
name: Move HistoryBoardService interface out of the mock and drop MockHistoryBoardService from the spur-app production barrel
status: todo
template: standard
created_at: 2026-09-26T04:37:17.893Z
updated_at: "2026-09-26T04:40:05.422Z"

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

- [ ] R1. `HistoryBoardService` is declared in production code that owns it (`history-board-service.ts` or a new `history-board-port.ts`), and no file under `packages/app/src/` imports from `history-board-mock-service`.
- [ ] R2. `MockHistoryBoardService` and its fixture catalogs are no longer exported from the `@gobing-ai/spur-app` root barrel (`packages/app/src/index.ts`).
- [ ] R3. The mock remains importable by the three existing test consumers through one documented path (see Design), with no test behavior change.
- [ ] R4. `HistoryBoardService` stays exported from the root barrel so `apps/server/src/context.ts` compiles unchanged.

### Acceptance Criteria

- [ ] AC1 — `rg "history-board-mock-service" packages/app/src` returns only the mock file itself (req: R1)
- [ ] AC2 — `rg "MockHistoryBoardService" packages/app/src/index.ts` returns nothing (req: R2)
- [ ] AC3 — `apps/server/tests/modules/history/handlers.test.ts`, `packages/app/tests/services/history-response-shape.test.ts`, `packages/app/tests/services/history-board-mock-service.test.ts` pass with unchanged assertions (req: R3)
- [ ] AC4 — `bun run typecheck` and `bun run test-cf` green (Worker bundle must not gain the fixture module) (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Recommended:** new subpath export `@gobing-ai/spur-app/testing` → `./src/testing/history-board-mock.ts` (moved file), added to `packages/app/package.json` `exports` beside the existing subpaths (`./errors`, `./feature-check`, …).

- Interface moves to `packages/app/src/services/history-board-service.ts` (it is the live implementation's contract; one fewer file than a separate port module). Mock imports the type from there.
- Test consumers switch import to `@gobing-ai/spur-app/testing` (cross-workspace) or the relative path (in-package tests).
- Keep the mock under `src/` (not `tests/`) because `apps/server` tests consume it cross-workspace; a `tests/` path would be a deep relative import (forbidden by AGENTS.md).

**Rejected:** moving the mock into `packages/app/tests/fixtures/` — forces `apps/server` to deep-import across workspaces.

**Invariant:** no public noun/verb change; this is a package-export change only. Check whether `@gobing-ai/spur-app` is consumed outside this monorepo before release — if so, note the removed root export in the changelog.

### Plan

- [ ] Move `interface HistoryBoardService` into `history-board-service.ts`; update the mock to import it.
- [ ] `git mv` mock to `packages/app/src/testing/history-board-mock.ts`; add `"./testing"` export to `packages/app/package.json`.
- [ ] Remove `MockHistoryBoardService` from `src/index.ts`; re-point `export type { HistoryBoardService }` to the live file.
- [ ] Update the three test imports.
- [ ] `(cd packages/app && bun test tests/services/history-*.test.ts)`, `(cd apps/server && bun test tests/modules/history)`, `bun run test-cf`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T04:40:05.422Z backlog → todo (system)

