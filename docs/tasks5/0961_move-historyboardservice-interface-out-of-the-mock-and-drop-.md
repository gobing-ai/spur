---
schema_version: 1
name: Move HistoryBoardService interface out of the mock and drop MockHistoryBoardService from the spur-app production barrel
status: done
template: standard
created_at: 2026-09-26T04:37:17.893Z
updated_at: "2026-09-26T07:25:33.520Z"

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
| R1 | MET | `packages/app/src/services/history-board-service.ts:90` declares `export interface HistoryBoardService`; `rg -n "interface HistoryBoardService" packages/app/src` returns exactly one hit; `rg -l "history-board-mock\|MockHistoryBoardService" packages/app/src` returns only `src/testing/history-board-mock.ts`; `git ls-files packages/app/src/services/history-board-mock-service.ts` empty |
| R2 | MET | `rg -n "MockHistoryBoardService\|history-board-mock" packages/app/src/index.ts` returns nothing; the fixture is reachable only through the new `./testing` subpath; `bun run test-cf` exit 0 |
| R3 | MET | `jq -r '.exports["./testing"]' packages/app/package.json` prints `./src/testing/history-board-mock.ts`; all three consumers re-pointed; `git diff --stat -- '**/tests/**'` shows import-line-only diffs |
| R4 | MET | `git diff --stat -- apps/server/src` is empty; `bun run typecheck` exits 0 across all 7 workspaces |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | command | `packages/app/src/services/history-board-service.ts:90` is the only `interface HistoryBoardService` in `packages/app/src`; the mock is the sole `src/` file referencing it; the old `services/history-board-mock-service.ts` path is gone (`git ls-files` empty) |
| AC-2 | MET | command | `rg -n "MockHistoryBoardService\|history-board-mock" packages/app/src/index.ts` → no output; `bun run test-cf` exit 0 (1 file / 1 test passed) |
| AC-3 | MET | command | `jq -r '.exports["./testing"]'` → `./src/testing/history-board-mock.ts`; `packages/app` focused suite 41 pass / 0 fail; `apps/server` history suite 7 pass / 0 fail; tests diff is import lines only (2 lines per file) |
| AC-4 | MET | command | `git diff --stat -- apps/server/src` empty; `bun run typecheck` exit 0. The lens' repo-wide `bun run spur-check` clause is red solely on a pre-existing 0961-unrelated test — full reproduction and attribution in the task's Testing section |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
**Out-of-scope note — repo-wide quality gate (2026-09-26).** `bun run spur-check` is red repo-wide on a single pre-existing test unrelated to this task: `packages/app/tests/workflow/idea-pipeline-routing.test.ts` — "idea-pipeline 0945 — routing truth-table parity (R3) > live route guards match the frozen pre-refactor oracle over the full cross product". It declares its own 60s budget (`}, 60000)` at the test) but evaluates 3456 cells, each spawning a guard process; wall clock in this environment is 84.9s–86.6s. Reproduced identically on the **unmodified base tree** (`/Users/robin/xprojects/spur-new`, HEAD `53f5fa37c`, task 0961 still at `todo`): same single failure, 84881ms vs 60000ms, 4 pass / 1 fail. The file contains no reference to history-board / MockHistoryBoardService / HistoryBoardService, and no `--timeout` is passed anywhere in the `package.json` test script. Every gate component that 0961 touches is green: lint (biome 1110 files + typecheck 7/7 workspaces), rule presets 47 pre + 2 post, focused suites 48/48, `bun run test-cf`. Full attribution: `.spur/run/0961-test-gate-attribution.txt`. Operator ruled this out of scope for 0961 and directed that a separate follow-up task be filed for the 0945 timeout.

### Review

Reviewed the 0961 diff (`git diff -M`: 8 files, 23 insertions / 22 deletions, incl. two renames) across the three dimensions the pipeline names.

**Dimension 1 — functional traceability.** All four requirements are implemented; each is independently probed.

| Req | Evidence | Status |
| --- | --- | --- |
| R1 | `packages/app/src/services/history-board-service.ts:90` declares the port; `rg -n "interface HistoryBoardService" packages/app/src` returns exactly one hit; `rg -l "history-board-mock" packages/app/src` returns only `src/testing/history-board-mock.ts` | PASS |
| R2 | `rg -n "MockHistoryBoardService / history-board-mock" packages/app/src/index.ts` returns nothing; only the `./testing` subpath reaches the fixture | PASS |
| R3 | `jq -r '.exports["./testing"]' packages/app/package.json` prints `./src/testing/history-board-mock.ts`; all three consumers re-pointed; tests diff is import-lines-only | PASS |
| R4 | `git diff --stat -- apps/server/src` is empty; `bun run typecheck` exits 0 | PASS |

**Dimension 2 — SECUA.** Security: no new attack surface — the moved module is test-only (no I/O, no network, no secrets), and the only production-visible change is a `type`-only re-export whose target swapped to the module that already owned the contract semantically; `export type` emits nothing at runtime. Efficiency: the change reduces bundle work rather than adding it — a 1,321-line fixture catalog plus its deterministic catalogs leave the public barrel, so the Worker entry no longer pulls them (confirmed by the R2 probe). Correctness: 48 focused tests green (`packages/app` 41, `apps/server` 7), `bun run test-cf` green, `bun run lint` (biome `--error-on-warnings` + typecheck across all 7 workspaces) green, rule presets 47 pre + 2 post green. Usability: n/a — no user-facing surface. Architecture: the dependency direction is corrected — previously `history-board-service.ts` imported its own contract from a test double, so the seam pointed production into test; now production owns the port and the mock consumes it.

**Dimension 3 — architecture depth.** The port lives in the live implementation's module (`history-board-service.ts:90`), which is where an implementor-driven contract belongs: the mock is a consumer of that type, not its owner. A separate `history-board-port.ts` was explicitly rejected in the task Q&A — one file fewer, and the contract has exactly one production implementor, so a standalone port module would be a shallow indirection.

**Findings.**

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P4 | Deviation from the task Q&A, resolved: the rule `require-corresponding-test` mirrors `src/testing/history-board-mock.ts` to `tests/testing/history-board-mock.test.ts`, but the Q&A chose to keep the old test filename | `config/rules/structure/test-location.yaml` has `requireCorrespondingTest: true` with no basename fallback; the first gate run failed naming the expected mirror path | Renamed via `git mv` to the mirrored path. Assertions and bodies byte-identical; only the import specifier changed, which the Q&A already sanctioned |
| P4 | Note for later: the `./testing` export targets a concrete file rather than a directory index, so a second test double needs another subpath entry or a barrel | `packages/app/package.json` exports map | Matches Design §3 verbatim — recorded as a future-flow note, no action |
| P3 | Out of scope, separately tracked: repo-wide `bun run spur-check` is red on a pre-existing 0961-unrelated test that declares a 60s budget but needs about 85s for 3456 process-spawning cells | `.spur/run/0961-test-gate-attribution.txt`; reproduced identically on the unmodified base tree at HEAD 53f5fa37c (84881ms vs 60000ms) | Operator ruled (2026-09-26): land 0961 with this recorded, and file a separate follow-up task for the 0945 timeout |
| P2 | None found | full diff reviewed across traceability, SECUA and architecture | No action |

**Residual risk.** `src/testing/` sits under `src/`, so it stays inside the typecheck and published-source scope; the design's safety rests on the invariant that no non-test module imports it. That invariant is asserted by the R1 probe (`rg -l` returns only the mock itself) but is not enforced by a lint rule, so a future direct import would not fail CI. Low likelihood, low impact — it would merely re-introduce the coupling this task removed.

**Final disposition.** Only P4/P3 notes; no P1/P2 findings and no requested-scope item unaddressed. Approved for record. The single unresolved gate clause is environmental and tracked separately.

### References

- Feature: E82 (parent E8 — History Board module).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C1; base commit `959f84bd6`.
- AGENTS.md: cross-workspace imports use `@gobing-ai/*`, never deep relative paths.

### History

- 2026-09-26T04:40:05.422Z backlog → todo (system)
- 2026-09-26T06:20:32.577Z todo → wip (system)
- 2026-09-26T07:24:56.855Z wip → testing (system)
- 2026-09-26T07:25:33.520Z testing → done (system)

