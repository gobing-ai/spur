---
schema_version: 1
name: "Make the installed feature-verification path loadable: the Node twin cannot import the Bun-target inline bundle"
status: todo
template: standard
created_at: 2026-10-13T19:44:53.347Z
updated_at: "2026-10-13T21:40:11.213Z"

priority: P1
estimate_hours: 2
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

- [ ] R1. `feature-verification-steps.ts` re-enters Bun at the top of `main()` when `process.versions.bun` is unset, with the same shape as `inline-run-setup.ts:53-59`: `spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })`, exit with the child's status, and on spawn error print `feature-verification-steps requires Bun on PATH: <message>` and exit 1.
- [ ] R2. The regenerated `plugins/sp/scripts/feature-verification-steps.mjs` twin carries the re-entry, so `node <twin> verify …` reaches the verifier instead of failing on module load.
- [ ] R3. One regression pin: every `plugins/sp/scripts/**/*.ts` that loads the inline bundle (`inline-run.generated` or `loadInlineApp`) contains the `process.versions.bun` re-entry, so a new bundle consumer cannot ship a Node-unloadable twin.

Out of scope: changing the bundle target or shimming `bun:sqlite` (would need a Node SQLite dependency); changing `config/workflows/feature-verification.yaml` runner selection (`installed → node` stays valid once the twin re-enters Bun); rewording the workflow's `script not found` fallback status line.

### Acceptance Criteria

- [ ] AC1 — The installed Node twin runs the verifier: in a scratch layout with the twin under `scripts/` and the bundle under `lib/`, `node scripts/feature-verification-steps.mjs verify --feature-id T1 --run-id r1 --cmd true` gets past module load (stderr has no `ERR_UNSUPPORTED_ESM_URL_SCHEME`; it fails only on the missing run row, as the Bun run does today). (req: R1, R2)
- [ ] AC2 — A missing Bun is named: with `PATH` lacking `bun`, the Node twin exits 1 and stderr contains `feature-verification-steps requires Bun on PATH`. (req: R1)
- [ ] AC3 — The pin fails on a consumer without re-entry: the contract test lists `feature-verification-steps.ts` (and the three existing consumers) as passing, and fails when the re-entry block is removed from any of them. (req: R3)

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

- [ ] Step 1 (R1, AC1, AC2): add the failing AC1/AC2 tests in `plugins/sp/tests/feature-verification-steps.test.ts`; confirm AC1 fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on today's twin.
- [ ] Step 2 (R1, R2): add the re-entry block to `feature-verification-steps.ts` `main()`; regenerate the `.mjs` twin; AC1/AC2 pass.
- [ ] Step 3 (R3, AC3): add the static contract scan; prove it fails by temporarily removing the block, then restore.
- [ ] Step 4: `bun run script-contract-check` and `bun run spur-check`; record the node-twin before/after stderr in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/scripts/inline-run-setup.ts:53-59`, `plugins/sp/scripts/inline-run-dispatch.ts:36-42`, `plugins/sp/scripts/daily-summary/daily-summary.ts:809-815` — existing Bun re-entry.
- `plugins/sp/scripts/feature-verification-steps.ts:118-148` — `main()` without re-entry.
- `scripts/commands/bundle-plugin-lib.ts:929-930`, `:1002-1005` — Bun-capable bundle by design.
- `config/workflows/feature-verification.yaml:81` — `installed → node` runner.
- `plugins/sp/tests/inline-run-installed.heavy.test.ts` — installed Node-twin layout precedent.
- Candidate owning feature (proposal, not linked): A91 — owns 1176, which moved this script onto the bundle.

### History

- 2026-10-13T21:40:11.213Z backlog → todo (system)

