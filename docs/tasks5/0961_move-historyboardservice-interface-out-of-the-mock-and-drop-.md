---
schema_version: 1
name: Move HistoryBoardService interface out of the mock and drop MockHistoryBoardService from the spur-app production barrel
status: done
template: standard
created_at: 2026-09-26T04:37:17.893Z
updated_at: "2026-09-26T16:31:07.350Z"

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

- [x] R1. `HistoryBoardService` is declared in `packages/app/src/services/history-board-service.ts` (the live implementation's module), and no file under `packages/app/src/` other than the mock itself imports the mock module.
- [x] R2. `MockHistoryBoardService` and its fixture catalogs are no longer exported from the `@gobing-ai/spur-app` root barrel (`packages/app/src/index.ts`), so the Worker bundle stops pulling the mock module.
- [x] R3. The mock moves to `packages/app/src/testing/history-board-mock.ts`, exposed only via a new `"./testing"` subpath export, and its three test consumers import it from there with no assertion change.
- [x] R4. `HistoryBoardService` stays exported (type-only) from the root barrel, so `apps/server/src/context.ts:6,162` compiles with no edit under `apps/server/src/`.

### Acceptance Criteria

Graduates all four of feature E82's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Production code owns the History Board port (req: R1)
- [x] AC2 — R2 — The root barrel ships no History Board fixture (req: R2)
- [x] AC3 — R3 — Tests reach the mock through the testing subpath (req: R3)
- [x] AC4 — R4 — Server context compiles against the unchanged port export (req: R4)

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

- [x] Move the interface (and any types it needs) into `services/history-board-service.ts`; drop the reverse import at :86.
- [x] `git mv` the mock to `src/testing/history-board-mock.ts`; fix its type import.
- [x] Add the `"./testing"` export to `packages/app/package.json`.
- [x] Edit `src/index.ts:258-260` per Design §4.
- [x] Update the three test imports (Design §5).
- [x] Focused: `(cd packages/app && bun test tests/services/history-response-shape.test.ts tests/services/history-board-mock-service.test.ts tests/services/history-board-service.test.ts)`; `(cd apps/server && bun test tests/modules/history)`.
- [x] Gates: `bun run spur-check`, `bun run test-cf`; run the AC1–AC4 `rg`/`jq`/`git diff` probes and paste output into Testing.
- [x] One commit: `refactor(app): own HistoryBoardService in the live module; mock moves to /testing subpath (0961)`.

### Solution

Package-surface change only. No public `spur` noun/verb change and no runtime behaviour change — every edit is a type declaration, a module location, an export map, or an import specifier.

| Change (`file:line`) | Why |
| --- | --- |
| `packages/app/src/services/history-board-service.ts:90` | Declares the port `HistoryBoardService` in the live implementation's own module, so production owns its contract. Replaces the reverse import that used to sit at `:86`, inverting the seam from production-into-test to test-into-production. |
| `packages/app/src/index.ts:258` | Re-points `export type { HistoryBoardService }` at `./services/history-board-service` and deletes the `MockHistoryBoardService` export. The 1,321-line fixture catalog plus its deterministic catalogs leave the public barrel, so the Worker entry stops pulling them. |
| `packages/app/src/testing/history-board-mock.ts:17` | The mock, `git mv`-ed from `services/history-board-mock-service.ts`, now imports the port type from `../services/history-board-service`. Its body is otherwise byte-identical. |
| `packages/app/package.json:14` | Adds `"./testing": "./src/testing/history-board-mock.ts"` so cross-workspace test consumers (`apps/server`) reach the double without a deep relative import. Named `testing` rather than `history-board-mock` so later test doubles join without another export entry. |
| `apps/server/tests/modules/history/handlers.test.ts:2` | Imports the mock from `@gobing-ai/spur-app/testing` instead of the root barrel. |
| `packages/app/tests/services/history-response-shape.test.ts:16` | Imports the mock from `../../src/testing/history-board-mock`. |
| `packages/app/tests/testing/history-board-mock.test.ts:2` | Same in-package import. The file was `git mv`-ed from `tests/services/history-board-mock-service.test.ts` because the repo rule `require-corresponding-test` derives its mirror path from the source path; assertions and bodies are unchanged (see the Review section, P4). |

**Invariants.** Nothing under `packages/app/src/` other than `src/testing/` imports `src/testing/`; the Worker entry never imports the `./testing` subpath. Both hold and are asserted by the R1/AC1 probes.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/history-board-service.ts:90` declares `export interface HistoryBoardService`; re-run 2026-09-26: `rg -n "interface HistoryBoardService" packages/app/src` → 1 hit; `rg -l "history-board-mock\|MockHistoryBoardService" packages/app/src` → only `src/testing/history-board-mock.ts`; `git ls-files` old path empty |
| R2 | MET | `packages/app/src/index.ts:258` exports only the type from `./services/history-board-service`; `rg -n "MockHistoryBoardService\|history-board-mock" packages/app/src/index.ts` → no output; `bun run test-cf` exit 0 |
| R3 | MET | `packages/app/src/testing/history-board-mock.ts:17` imports the port type; `jq -r '.exports["./testing"]' packages/app/package.json` → `./src/testing/history-board-mock.ts`; rename-aware `git diff -M dcb27b0e2~1 dcb27b0e2` on tests shows only import-line changes (98-99% similarity renames) |
| R4 | MET | `git diff --stat dcb27b0e2~1 dcb27b0e2 -- apps/server/src` empty; `bun run typecheck` exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | command | `packages/app/src/services/history-board-service.ts:90` sole `interface HistoryBoardService`; mock is sole `src/` referrer; old path absent from `git ls-files` |
| AC-2 | MET | command | `rg` on `packages/app/src/index.ts` → no mock export; `bun run test-cf` exit 0 |
| AC-3 | MET | test | `apps/server/tests/modules/history/handlers.test.ts:2` imports `@gobing-ai/spur-app/testing`; `packages/app/tests/services/history-response-shape.test.ts:16` and `packages/app/tests/testing/history-board-mock.test.ts:2` import `../../src/testing/history-board-mock`; packages/app focused 41 pass / 0 fail; apps/server history 7 pass / 0 fail |
| AC-4 | MET | command | apps/server/src diff empty for commit dcb27b0e2; `bun run typecheck` exit 0. Repo-wide spur-check red only on pre-existing 0945 timeout (`.spur/run/0961-test-gate-attribution.txt`), operator-ruled out of scope |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Re-review 2026-09-26 of commit `dcb27b0e2` (`git diff -M`: 8 files, 2 renames at 98–99% similarity), using fresh probes from this session. Supersedes the 2026-09-26 pipeline review, whose findings table had a placeholder `P2 | None found` row and an out-of-scope P3 with no machine-readable deferral. The residual sweep scored both as blocking.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 | C | `packages/app/tests/workflow/idea-pipeline-routing.test.ts` | Repo-wide `bun run spur-check` fails only on a pre-existing 0945 parity test. It has a 60s budget but takes about 85s because it runs 3456 process-spawning cells. The test predates 0961, has no link to it, and fails the same way on the unmodified base tree (`.spur/run/0961-test-gate-attribution.txt`) | DEFERRED → 0974 (dedup inert-var cells); out of 0961 scope per operator ruling 2026-09-26 |
| P4 | A | `packages/app/src/testing/history-board-mock.ts:17` | The invariant that no `src/**` module outside `src/testing/` imports it holds (`rg` probe: no importer), but no rule in `config/rules/` enforces it | DEFERRED → 0975 R4 (rule-enforce the test-only subpath) |
| P4 | A | `packages/app/package.json:14` | `./testing` points at one concrete file, so a second test double will need a barrel or another export entry | Accepted — matches Design §3; revisit when a second double lands |
| P4 | U | `packages/app/tests/testing/history-board-mock.test.ts:2` | The test file was renamed despite the Q&A saying to keep its name, because `require-corresponding-test` mirrors the source path | RESOLVED — rename via `git mv`, bodies unchanged (99% similarity) |

**Functional traceability** — verdict PASS

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/history-board-service.ts:90` declares the port; `rg -n "interface HistoryBoardService" packages/app/src` → 1 hit; `rg -l "history-board-mock\|MockHistoryBoardService" packages/app/src` → only `src/testing/history-board-mock.ts`; old path absent from `git ls-files` |
| R2 | MET | `packages/app/src/index.ts:258` re-exports the type only; `rg` for the mock in `index.ts` → no output; `bun run test-cf` exit 0 |
| R3 | MET | `packages/app/package.json:14` `./testing` → `./src/testing/history-board-mock.ts`; consumers at `apps/server/tests/modules/history/handlers.test.ts:2`, `packages/app/tests/services/history-response-shape.test.ts:16`, `packages/app/tests/testing/history-board-mock.test.ts:2`; focused suites 41/41 + 7/7 |
| R4 | MET | `git diff --stat dcb27b0e2~1 dcb27b0e2 -- apps/server/src` empty; `bun run typecheck` exit 0 |

**SECUA.**
- **S:** Nothing new is exposed. The moved module is a test-only fixture with no I/O and no secrets. `export type` emits nothing at runtime.
- **E:** The fixture catalogs are out of the root barrel, so the Worker entry no longer loads them.
- **C:** In the rename-aware diff, the only non-import change moves the interface declaration. Behavior is unchanged.
- **U:** No user-facing surface changed.
- **A:** The dependency direction is fixed: tests import from production, not the other way round.

**Architecture (code-improvement lenses).** Candidate C1 ("wrong seam"), the reason this task was opened, is resolved. The port lives with its only production implementor, and the mock consumes it. No new shallow modules, coupling, or locality problems. The unenforced invariant above is the only structural residue, and 0975 tracks it.

**Final disposition.** No P1 or P2 findings. The P3 is deferred to 0974 and the enforcement gap to 0975. Approved.

### References

- Feature: E82 (parent E8 — History Board module).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C1; base commit `959f84bd6`.
- AGENTS.md: cross-workspace imports use `@gobing-ai/*`, never deep relative paths.

### History

- 2026-09-26T04:40:05.422Z backlog → todo (system)
- 2026-09-26T06:20:32.577Z todo → wip (system)
- 2026-09-26T07:24:56.855Z wip → testing (system)
- 2026-09-26T07:25:33.520Z testing → done (system)

