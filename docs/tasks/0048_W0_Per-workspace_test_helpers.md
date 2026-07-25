---
name: "W0: Per-workspace test helpers"
description: "W0: Per-workspace test helpers"
status: done
created_at: 2026-06-13T01:08:18.981Z
updated_at: 2026-06-14T03:56:04.879Z
folder: docs/tasks
type: task
feature-id: F1
priority: P1
tags: ["rd3-migration","wave-0"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0048. "W0: Per-workspace test helpers"

### Background

Design §13, H05. Shared @gobing-ai/spur-testing workspace is held — helpers live per-workspace in tests/helpers.ts.


### Requirements

R1. Temp-project factory (folders, config, fixtures).
R2. Task/feature file fixture factories on the new schemas.
R3. In-memory SQLite adapter factory per test.
R4. CLI invocation helper for verb-level integration tests.


### Q&A



### Design

Authority: design §13 testing strategy; H05 disposition (shared `@gobing-ai/spur-testing` workspace is
**held** — helpers live per-workspace in `tests/helpers.ts`). Project rules: in-memory SQLite per test,
≥90% per-file line+function coverage, tests describe behavior under condition.

**Scope:** three new `tests/helpers.ts` modules (domain, app, cli). No shared workspace.

**Key decisions:**

- **Domain helpers** (`packages/domain/tests/helpers.ts`):
  - `createTempProject()` — temp dir + `.spur/config.yaml` (minimal valid project marker) +
    `docs/tasks/` + `docs/features/`. Replaces the ad-hoc `mkdtemp` pattern duplicated across
    dao/planning tests.
  - `createMigratedDb()` re-export — thin pass-through to `@gobing-ai/spur-domain`'s existing
    `createMigratedDb({ url: ':memory:' })`. No new DB factory; the existing one is the canonical one.
  - `makeTaskFile(overrides?)` — builds a task markdown string with `schema_version: 1` frontmatter
    (per `taskFrontmatterSchema`) + canonical `###` sections. Override-merge on the frontmatter object.
  - `makeFeatureFile(overrides?)` — builds a feature markdown string with `featureFrontmatterSchema`
    frontmatter + `##` sections.

- **App helpers** (`packages/app/tests/helpers.ts`):
  - Re-export domain `createTempProject` / `createMigratedDb` (app tests need the same substrate).
  - `nullOutput()` — the `{ write, error }` sink already duplicated in 4 app test files. Canonicalized
    here with the `RuleServiceOutput` / `TeamServiceOutput` shape.
  - `createCapturedOutput()` — output sink that stores writes for assertions (mirrors cli helper).
  - `makeTempDir(prefix?)` — bare `mkdtemp` wrapper with a `spur-app-` prefix; for tests that don't
    need a full project scaffold.

- **CLI helpers** (`apps/cli/tests/helpers.ts`):
  - Existing `createTempProject()` + `createCapturedOutput()` + `CapturedOutput` — **kept** (they are
    already the canonical shape used by command tests).
  - **Add** `runCli(args, cwd?)` — spawns `bun run apps/cli/src/index.ts` as a subprocess, returns
    `{ code, stdout, stderr }`. This is R4 (verb-level integration helper). Parses `--json` output
    into an object when stdout is valid JSON. Does NOT replace in-process `main()` testing (which is
    faster and already covers most commands); it's for subprocess-isolation cases.

**Boundaries affected:** only `tests/` directories. No `src/` changes. No new dependencies.

**Risks:** over-building helpers that have no consumer (design §13: "no dead helper code"). Mitigated
by R5: helpers are covered by the suites that use them — each helper must have at least one consuming
test to avoid rot.


### Solution

1. `packages/domain/tests/helpers.ts`: temp-project factory (task folders + `.spur/config.yaml` +
   `docs/features/`), task/feature file fixture factories generating new-schema files, in-memory
   DbAdapter factory.
2. `packages/app/tests/helpers.ts`: service wiring helpers over the domain factories.
3. `apps/cli/tests/helpers.ts`: `runCli(args, cwd)` spawning the Bun entry, returning
   {code, stdout, json}.
4. Keep helpers minimal — grow on demand from 0041+ test needs; no speculative fixtures. Gate: helpers
   themselves covered by the suites that use them (no dead helper code).


### Plan

- [x] Review task requirements and existing test patterns across domain/app/cli
- [x] Create `packages/domain/tests/helpers.ts` (temp project, db, task/feature fixtures)
- [x] Create `packages/app/tests/helpers.ts` (nullOutput, capturedOutput, tempDir, re-exports)
- [x] Extend `apps/cli/tests/helpers.ts` with `runCli` subprocess helper
- [x] Add a helpers self-test in each workspace so helpers are covered (R5)
- [x] Run `bun run lint` + `bun run test` and verify coverage ≥90% on helper files

### Review

**SECU verdict: PASS**

**S — Security:** No security surface. Test helpers only; no production code paths touched.
No secrets, no external input, no auth. `runCli` spawns the existing CLI entry — no injection
vector (args are passed as array, not shell string).

**E — Error handling:** All factories return typed results; no silent failures.
`runCli` JSON parse is wrapped in try/catch — `json` left `undefined` on non-JSON stdout.
`createTempProject` creates parent dirs before writing (via `Bun.write` recursive).

**C — Correctness / architecture:**
- R1 ✓ `createTempProject()` — creates `.spur/config.yaml` + `docs/tasks/` + `docs/features/`
- R2 ✓ `makeTaskFile()` / `makeFeatureFile()` — generate schema-valid frontmatter (validated against
  `taskFrontmatterSchema` / `featureFrontmatterSchema` in self-tests) + canonical sections
- R3 ✓ `createMigratedDb()` — thin pass-through to domain's canonical factory; per-test isolation
- R4 ✓ `runCli(args, cwd?)` — subprocess invocation returning `{code, stdout, stderr, json?}`
- Boundary respected: `tests/` only, no `src/` changes (except `package.json` export addition)
- Domain helpers export added to `packages/domain/package.json` (`./tests/helpers`) so app can re-import

**U — Usability:** JSDoc on every export; self-tests serve as usage examples. Override pattern is
consistent across task/feature factories.

**Requirements traceability:** all four R-items satisfied; self-tests prove each.

**Risks:** none beyond normal regression risk. Helpers are additive — no existing test behavior changed.

#### Dev-Verify — 2026-06-14 (`--force --fix all`, full SECU + traceability)

**Verdict: PASS** (post-fix). Initial pass: 0 P1, 0 P2, 2 P3, 2 P4 — all requirements MET. Fixed the actionable findings in the same run. Final: 0 findings; 4/4 MET; 28/28 helper self-tests + 328/328 domain suite pass; lint clean (218 files, 7/7 workspaces).

Phase 8 — Requirements traceability:

- [x] **R1** → **MET** | `packages/domain/tests/helpers.ts:32 createTempProject()` (`.spur/config.yaml` + `docs/tasks/` + `docs/features/`). Test `helpers.test.ts:16-37`.
- [x] **R2** → **MET** | `makeTaskFile`:124 / `makeFeatureFile`:165, validated against `taskFrontmatterSchema` / `featureFrontmatterSchema` (tests `:115`, `:147`). **P3 fixed** — see below.
- [x] **R3** → **MET** | `createMigratedDb`:51 — independent `:memory:` per call. Test `:39-57` asserts `a !== b` + migrations applied.
- [x] **R4** → **MET** | `apps/cli/tests/helpers.ts:57 runCli()` — subprocess, `{code, stdout, stderr, json?}`. Tests `:27-62` (exit 0, stderr capture, JSON parse, non-JSON undefined).

Phase 7 — SECU:

- Security ✅: `runCli` and the `rm -rf` cleanups use arg arrays (no shell injection); cleanup targets only `mkdtemp` temp dirs. No secrets, no external input.
- **P3 (Correctness) — FIXED:** `makeTaskFile` accepted `feature_id`/`parent_wbs`/`profile` in its override interface but the renderer emitted none of them — a silent fixture trap. Worse, rendering `parent_wbs: 0049` **unquoted** would let YAML coerce it to the number `49`, failing `wbsString` (`^\d{4}$` string) validation. Fixed: emit all optional keys; quote `parent_wbs` so the 4-digit string survives. New test `helpers.test.ts` ("no silent drop") locks this in.
- **P4 (Usability) — FIXED:** `runCli` JSDoc said "When the **last** arg is `--json`" but the code uses `args.includes('--json')` (any position). Corrected the JSDoc.
- **P3 (Process) — FIXED:** frontmatter `impl_progress` was all-`pending` despite `status: Done` + completed Review/Testing; Artifacts table was empty. Corrected `impl_progress` to `done` and populated Artifacts (6 files + the package.json export).

Gate: `bun run lint` clean; helper self-tests 28/28; domain suite 328/328, no regression. Status `Done` confirmed correct.

### Testing

- Timestamp: 2026-06-14T03:55:00.000Z
- Scope: all workspaces; new self-test files + existing suites (regression check)
- Result: **PASS** — 837 tests pass, 0 fail. CF server test passes. Lint clean.
- Coverage (new helper files): `packages/domain/tests/helpers.ts` 100% L/100% F;
  `packages/app/tests/helpers.ts` 100% L/100% F; `apps/cli/tests/helpers.ts` 100% L/100% F.
- Self-tests: 17 (domain), 7 (app), 5 (cli) = 29 new test cases covering every exported helper (domain +1 from dev-verify 2026-06-14: makeTaskFile override round-trip).
- Evidence: full coverage table in run output; helpers at 100% line+function in aggregate.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| impl | `packages/domain/tests/helpers.ts` | main | 2026-06-14 |
| impl | `packages/app/tests/helpers.ts` | main | 2026-06-14 |
| impl | `apps/cli/tests/helpers.ts` | main | 2026-06-14 |
| test | `packages/domain/tests/helpers.test.ts` | main | 2026-06-14 |
| test | `packages/app/tests/helpers.test.ts` | main | 2026-06-14 |
| test | `apps/cli/tests/helpers.test.ts` | main | 2026-06-14 |
| export | `packages/domain/package.json` (`./tests/helpers`) | main | 2026-06-14 |

### References


