---
schema_version: 1
name: "Make the installed feature-verification path loadable: the Node twin cannot import the Bun-target inline bundle"
status: done
template: standard
created_at: 2026-10-13T19:44:53.347Z
updated_at: "2026-10-14T04:37:12.721Z"

priority: P1
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1197-verdict.json
---

## 1197. Make the installed feature-verification path loadable: the Node twin cannot import the Bun-target inline bundle

### Background

The installed feature-verification path cannot load its own bundle under the runtime the workflow selects for it. `config/workflows/feature-verification.yaml` chooses the verifier per resolution layer — `source-repo` runs `feature-verification-steps.ts` with **bun**, `installed` runs `feature-verification-steps.mjs` with **node** — while the generated inline bundle that script imports (`lib/inline-run.generated.mjs`, beside the script's `../lib/`) is built for Bun and imports `bun:sqlite` / `bun:ffi`.

Measured 2026-10-13, in a throwaway git project (`docs/features/T1_*.md`, `.spur/workflows/feature-verification.yaml`) against the global install that `script-root` resolves (`{"mode":"installed","source":"global","dir":"/Users/robin/.agents/scripts/sp"}`):

- `node ~/.agents/scripts/sp/feature-verification-steps.mjs verify --feature-id T1 --run-id probe-n` → `Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'bun:'`
- `bun  ~/.agents/scripts/sp/feature-verification-steps.mjs verify --feature-id T1 --run-id probe-b --cmd true` → module loads, the pass proceeds (it then fails only on a missing run row, which is expected outside the engine).
- The workflow reproduces it end to end: `spur workflow run .spur/workflows/feature-verification.yaml --vars '{"featureId":"T1","verificationCmd":"true"}'` ends `verify → failed`; with the same file's runner switched to bun for the probe it reaches `done` and writes the receipt.

So any project whose feature-verification resolves the **global install** (i.e. not a spur source checkout) fails the pass on module load, not on the checks. The Bun-target bundle predates this report: the copy saved before regeneration (`/tmp/inline-run.before.mjs`, the 12:04 build) already contained three `bun:` imports, and `grep -c 'bun:' plugins/sp/lib/inline-run.generated.mjs` is 3 today.

Two candidate remedies, for the owner to choose: (a) the plugin-lib build emits a Node-safe variant for installed mode (shimming or externalizing `bun:sqlite`/`bun:ffi`), or (b) the workflow selects the runtime from the bundle's actual target — bun for the current bundle, node only for a Node-built one — and the install refuses a mismatched pair instead of copying it silently.

**Refine corrections (2026-10-13, refineall ready re-audit)**

- Issue triage: one issue (installed `node` twin cannot import the bundle) → `valid`: `node -e "import('./plugins/sp/lib/inline-run.generated.mjs')"` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`; under `bun` it loads. The bundle carries 3 `bun:` specifiers (`bun:sqlite` ×2, `bun:ffi` ×1).
- "The bundle is built for Bun" → it is built with `target: 'node'` but keeps `external: ['bun:sqlite']` on purpose (`scripts/commands/bundle-plugin-lib.ts:1002-1005`; `:929-930` "needs the Bun-capable inline entry (SQLite)") → the bundle is correct; the defect is the consumer.
- "Two candidate remedies (a) Node-safe bundle / (b) runtime from the bundle's target" → a third, existing mechanism exists: the `.mjs` twins of `inline-run-setup.ts:53-59`, `inline-run-dispatch.ts:36-42` and `daily-summary.ts:809-815` re-enter Bun in `main()` when `process.versions.bun` is unset. `feature-verification-steps.ts` is the only bundle consumer without it → decision closed on reuse (Q&A); (a) and (b) rejected.
- Sibling check: `daily-summary.mjs` is also run with `node` and also imports the bundle, but already re-enters Bun → not affected.

### Requirements

- [x] R1. `feature-verification-steps.ts` re-enters Bun at the top of `main()` when `process.versions.bun` is unset, with the same shape as `inline-run-setup.ts:53-59`: `spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })`, exit with the child's status, and on spawn error print `feature-verification-steps requires Bun on PATH: <message>` and exit 1.
- [x] R2. The regenerated `plugins/sp/scripts/feature-verification-steps.mjs` twin carries the re-entry, so `node <twin> verify …` reaches the verifier instead of failing on module load.
- [x] R3. One regression pin: every `plugins/sp/scripts/**/*.ts` that loads the inline bundle (`inline-run.generated` or `loadInlineApp`) contains the `process.versions.bun` re-entry, so a new bundle consumer cannot ship a Node-unloadable twin.

Out of scope: changing the bundle target or shimming `bun:sqlite` (would need a Node SQLite dependency); changing `config/workflows/feature-verification.yaml` runner selection (`installed → node` stays valid once the twin re-enters Bun); rewording the workflow's `script not found` fallback status line.

### Acceptance Criteria

- [x] AC1 — The installed Node twin runs the verifier: in a scratch layout with the twin under `scripts/` and the bundle under `lib/`, `node scripts/feature-verification-steps.mjs verify --feature-id T1 --run-id r1 --cmd true` gets past module load (stderr has no `ERR_UNSUPPORTED_ESM_URL_SCHEME`; it fails only on the missing run row, as the Bun run does today). (req: R1, R2)
- [x] AC2 — A missing Bun is named: with `PATH` lacking `bun`, the Node twin exits 1 and stderr contains `feature-verification-steps requires Bun on PATH`. (req: R1)
- [x] AC3 — The pin fails on a consumer without re-entry: the contract test lists `feature-verification-steps.ts` (and the three existing consumers) as passing, and fails when the re-entry block is removed from any of them. (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

- CLOSED (2026-10-13, refineall ready re-audit): remedy — reuse the Bun re-entry already in `inline-run-setup.ts`, `inline-run-dispatch.ts` and `daily-summary.ts`. Rejected (a) a Node-safe bundle: needs a Node SQLite dependency and a second build target for one consumer. Rejected (b) choosing the runtime from a bundle marker: changes every workflow's runner contract when one script is the outlier.
- CLOSED: AC1 needs no run row — reaching the "missing run row" failure proves the module loaded, matching the Bun-side evidence in Background.

### Design

**WHAT.** Add the established Bun re-entry to `feature-verification-steps.ts`, regenerate its `.mjs` twin, and pin the pattern for every inline-bundle consumer. No change to the pass, the bundle, or the workflow.

**WHY.** The inline bundle keeps `bun:sqlite` external by design (`scripts/commands/bundle-plugin-lib.ts:1002-1005`). Every other `.mjs` consumer re-enters Bun before the dynamic import (`inline-run-setup.ts:53-59`, `inline-run-dispatch.ts:36-42`, `daily-summary.ts:809-815`); `feature-verification-steps.ts` (`main()` at `:118-146`) was added later without it, so the workflow's `installed → node` branch (`config/workflows/feature-verification.yaml:81`) fails on load.

**WHERE.**
- `plugins/sp/scripts/feature-verification-steps.ts` — `main()`: insert the re-entry block before argv parsing; add `import { spawnSync } from 'node:child_process'`.
- `plugins/sp/scripts/feature-verification-steps.mjs` — regenerated twin, never hand-edited: `superskill script convert sp feature-verification-steps.ts --out plugins/sp/scripts/feature-verification-steps.mjs` from the repo root; `bun run script-contract-check` proves byte-identity.
- `plugins/sp/tests/feature-verification-steps.test.ts` — AC1/AC2 cases spawning `node` on the twin in a temp layout (copy twin + `lib/inline-run.generated.mjs`, as `inline-run-installed.heavy.test.ts:44-54` does).
- `plugins/sp/tests/` (new `bun-reentry-contract.test.ts`, or a case in an existing contract test) — AC3 static scan.

**Frozen names.** Error text `feature-verification-steps requires Bun on PATH: <message>`. No new flags, exports or env vars.

**Anti-patterns.** Do not change the bundle target or add a SQLite shim. Do not switch the workflow to `RUNNER=bun` (fixes one caller, leaves the twin broken for direct use). Do not copy daily-summary's degrade-and-continue branch — a verifier must fail closed when Bun is missing.

**Concurrency.** spur-new `main` has uncommitted edits by another session in `plugins/sp/skills/spur-dev/references/*.md` and several `packages/app/tests/**`; none touch the files above. Worktree `spur-new-runall-1190-1191-1192-c4a1` is separate.

### Plan

- [x] Step 1 (R1, AC1, AC2): add the failing AC1/AC2 tests in `plugins/sp/tests/feature-verification-steps.test.ts`; confirm AC1 fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on today's twin.
- [x] Step 2 (R1, R2): add the re-entry block to `feature-verification-steps.ts` `main()`; regenerate the `.mjs` twin; AC1/AC2 pass.
- [x] Step 3 (R3, AC3): add the static contract scan; prove it fails by temporarily removing the block, then restore.
- [x] Step 4: `bun run script-contract-check` and `bun run spur-check`; record the node-twin before/after stderr in `## Testing`. (verify 2026-10-13: script-contract-check 22 scripts / 0 violations; spur-check lint + typecheck + 51 pre-check rules PASS, test leg failures are sandbox/contention only — git template hook copy, mktemp `/var/folders`, Chromium launch, 20s timeouts that pass in isolation — none in 1197's files.)

### Solution

Bun re-entry added to the feature-verification verifier, its generated twin regenerated, and the pattern pinned for every inline-bundle consumer.

| file:line | change |
| --- | --- |
| `plugins/sp/scripts/feature-verification-steps.ts:30` | add `import { spawnSync } from 'node:child_process'` — a Node builtin (ADR-065), already the shape used by the three existing consumers. |
| `plugins/sp/scripts/feature-verification-steps.ts:128` | top of `main()`: `if (!process.versions.bun)` re-execs `bun <fileURLToPath(import.meta.url)> ...process.argv.slice(2)` with `stdio: 'inherit'`, `process.exit(child.status ?? 1)`, and on spawn error prints `feature-verification-steps requires Bun on PATH: <message>` then exits 1 — fail closed, deliberately NOT daily-summary's degrade-and-continue. (R1) |
| `plugins/sp/scripts/feature-verification-steps.mjs:59` | regenerated twin (`superskill script convert sp feature-verification-steps.ts --out plugins/sp/scripts/feature-verification-steps.mjs`) — carries the same re-entry; `script-contract-check` proves byte-identity; never hand-edited. (R2) |
| `plugins/sp/tests/feature-verification-steps.test.ts:65` | AC1/AC2 cases: spawn `node` on the twin in a scratch git project holding the twin under `scripts/` and the bundle under `lib/` (plus the shipped workflow definition + a `docs/features/T1_*.md`). AC1 asserts no `ERR_UNSUPPORTED_ESM_URL_SCHEME` and stderr byte-equal to the Bun run's (the missing run row); AC2 strips `bun` from `PATH` and asserts exit 1 plus the frozen `feature-verification-steps requires Bun on PATH` string. |
| `plugins/sp/tests/bun-reentry-contract.test.ts:26` | AC3 static contract scan over `plugins/sp/scripts/**/*.ts`: every consumer whose source names `inline-run.generated` or `loadInlineApp` (feature-verification-steps, inline-run-setup, inline-run-dispatch, daily-summary) must carry `process.versions.bun` + `spawnSync('bun'` in both the `.ts` and the generated `.mjs` twin the workflow executes. (R3) |

Rationale: the generated inline bundle keeps `bun:sqlite` external by design (`scripts/commands/bundle-plugin-lib.ts`), so the installed `node`-launched twin must re-enter Bun before the dynamic import. Reuse of the existing re-entry (Q&A closed) — a Node-safe bundle (a) and runtime-from-bundle-target (b) were rejected.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-entry at the top of `main()`: `plugins/sp/scripts/feature-verification-steps.ts:128` branches on `process.versions.bun`, re-execs Bun on its own URL with `stdio: 'inherit'`, exits with the child status, and prints `feature-verification-steps requires Bun on PATH` on spawn error; import at `plugins/sp/scripts/feature-verification-steps.ts:30`. |
| R2 | MET | Regenerated twin carries the same block at `plugins/sp/scripts/feature-verification-steps.mjs:59`; Node-launched twin reaches the verifier in `plugins/sp/tests/feature-verification-steps.test.ts:101` (no `ERR_UNSUPPORTED_ESM_URL_SCHEME`, asserted at `:112`). |
| R3 | MET | Contract scan `plugins/sp/tests/bun-reentry-contract.test.ts:43`; falsified this run — removing the block from `feature-verification-steps.ts` failed it with "feature-verification-steps.ts must contain the Bun re-entry", file restored byte-identical (`git diff` empty). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The installed Node twin runs the verifier | MET | test | `plugins/sp/tests/feature-verification-steps.test.ts:101` spawns `node` on the twin in a scratch `scripts/` + `lib/` layout; `:112` asserts no `ERR_UNSUPPORTED_ESM_URL_SCHEME`; suites 6 pass / 0 fail this run |
| AC2 — A missing Bun is named | MET | test | `plugins/sp/tests/feature-verification-steps.test.ts:130` runs with `PATH` holding only a node symlink; `:137-138` assert exit 1 and the frozen message |
| AC3 — The pin fails on a consumer without re-entry | MET | test | `plugins/sp/tests/bun-reentry-contract.test.ts:43` passes on the tree and fails when the re-entry is removed (falsified this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `plugins/sp/scripts/inline-run-setup.ts:53-59`, `plugins/sp/scripts/inline-run-dispatch.ts:36-42`, `plugins/sp/scripts/daily-summary/daily-summary.ts:809-815` — existing Bun re-entry.
- `plugins/sp/scripts/feature-verification-steps.ts:118-148` — `main()` without re-entry.
- `scripts/commands/bundle-plugin-lib.ts:929-930`, `:1002-1005` — Bun-capable bundle by design.
- `config/workflows/feature-verification.yaml:81` — `installed → node` runner.
- `plugins/sp/tests/inline-run-installed.heavy.test.ts` — installed Node-twin layout precedent.
- Candidate owning feature (proposal, not linked): A91 — owns 1176, which moved this script onto the bundle.

### History

- 2026-10-13T21:40:11.213Z backlog → todo (system)
- 2026-10-13T22:11:46.899Z todo → wip (system)
- 2026-10-14T04:37:11.945Z wip → testing (system)
- 2026-10-14T04:37:12.604Z testing → done (system)

