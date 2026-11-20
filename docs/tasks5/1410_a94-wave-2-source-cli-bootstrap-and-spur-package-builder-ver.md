---
schema_version: 1
name: "A94 wave 2: source-CLI bootstrap and Spur-package builder verbs"
status: todo
template: feature-impl
created_at: 2026-11-20T07:58:05.083Z
updated_at: "2026-11-20T08:38:07.437Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1409"]
estimate_hours: 6
---

## 1410. A94 wave 2: source-CLI bootstrap and Spur-package builder verbs

### Background

Implements: R3 — Package builds route through the CLI; R5 — Spur package staging and generators are builder verbs.

Package builds still route through scripts/spur-dev.ts; bundle-plugins, bundle-laya-worker and the emit-* generators move into builder (C3) so build:bundle is one CLI chain.

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- R1 "source CLI boots without apps/cli/config/ by falling back to tracked config/" → the fallback already exists. `bundledConfigRoot()` walks up from `packages/config/src` and matches the repo `config/` (`packages/config/src/bundled-config.ts:38-48`). Verified 2026-11-20 with `apps/cli/config` moved aside:
  - `bun run apps/cli/src/index.ts builder --help` exits 0.
  - `rule list --json` loads 79 rules.
  - The CLI's `src/config/*` imports are tracked sources (`apps/cli/src/config/embedded-schemas.ts`).

  → R1 becomes a regression proof with no boot code change. No cold-boot forwarder is kept, and `scripts/commands/build-cli.ts` is deleted.
- "Spur-package verbs share resolveSourceRoot" → it exists (`packages/app/src/builder/compile.ts:69`). The shared transport is `runVerb` (`apps/cli/src/commands/builder/build.ts:130`), whose failure contract is exit **1** with `not a Spur source checkout: <marker> is missing (pass --source-root <dir>)`. → R2's "exit 2 `not a Spur source checkout: <path>`" is corrected to the existing contract. A second exit contract inside one noun is rejected.
- `builder build-cli|bundle-config|bundle-web|build-server|build-binaries|verify-pack` already exist (A93). The matching `scripts/commands/*.ts` files are 14–20-line forwarders. → 1410 deletes the `build-cli`, `bundle-config`, `bundle-web` and `build-server` forwarders. `build-binaries` and `verify-pack` are generalized and deleted by 1411.
- Missed caller → root `package.json:76` `bundle:config` (`bun scripts/spur-dev.ts bundle-config apps/cli/config`) is called by `test`, `test:heavy`, `test:coverage` and `test:full`. Added to R3.
- CI → `.github/workflows/ci.yml:31` (`bun run build`) and `publish.yml:69` (`bun run build:bundle`) call package scripts only. Rewiring the scripts needs no workflow edit.

### Requirements

- [ ] R1. Source boot needs no generated config. A test asserts that `resolveBundledConfigRoot(<repo>/packages/config/src, process.execPath)` returns `<repo>/config`, and a receipt step runs `bun run apps/cli/src/index.ts builder --help` with `apps/cli/config` absent. `scripts/commands/build-cli.ts` is deleted and no cold-boot forwarder remains.
- [ ] R2. Four new leaf verbs, all with `--source-root <dir>`, `--json` and `--json-envelope`:
  - `spur builder bundle-plugins`
  - `spur builder bundle-laya-worker [out-dir]` (default `apps/cli/worker`)
  - `spur builder emit-board-types`
  - `spur builder emit-migration-sql`

  Outside a Spur checkout they fail through `resolveSourceRoot`: exit 1, `not a Spur source checkout: …`.
- [ ] R3. Package scripts call the source CLI, never `scripts/spur-dev.ts`:
  - `apps/cli/package.json:54-56`: `build`, `build:binaries`, `build:bundle`.
  - `apps/server/package.json:9`: `build`.
  - root `package.json:76`: `bundle:config`.

  All outputs are byte-identical to the pre-migration route:
  - emitters: `git diff --exit-code` on the emitted files;
  - staged trees (`apps/cli/{config,web,worker,plugins,.claude-plugin}`): a sorted sha256 manifest compared before and after.
- [ ] R4. These files are deleted:
  - forwarders: `scripts/commands/{build-cli,bundle-config,bundle-web,build-server}.ts`;
  - moved modules: `scripts/commands/{bundle-plugins,bundle-laya-worker,emit-board-types,emit-migration-sql}.ts`.

  Their dispatcher cases go into `RETIRED` (from 1409) with replacements `spur builder <verb>`. A94 inventory entries are set to `done`.

**Out of scope:** making these verbs generic for non-Spur projects (satellite §7: honestly Spur-only), `build-binaries` and `verify-pack` (1411), any publish step or workflow edit.

### Acceptance Criteria

- [ ] AC1 — Package builds route through the CLI (req: R1, R3, R4)
- [ ] AC2 — Spur package staging and generators are builder verbs (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:32:56.895Z

- **Q:** Bootstrap option 1 (config fallback) or option 2 (keep a `build-cli.ts` forwarder)? **A (closed):** neither is needed. The fallback already exists (verified 2026-11-20), so every forwarder is deleted.
- **Q:** Exit 2 or exit 1 for a non-Spur root? **A (closed):** exit 1 with the existing `runVerb`/`resolveSourceRoot` contract, for consistency within `builder`. Satellite §4's exit-2 rule applies to `check-*` verbs only.

### Design

**WHAT/WHY.** `build:bundle` becomes one CLI chain, so the packed CLI owns every staging step it ships. Bootstrap needs no new mechanism: config resolution already reaches tracked `config/`.

**WHERE (frozen).**
- `git mv scripts/commands/<m>.ts packages/app/src/builder/<m>.ts` for `bundle-plugins`, `bundle-laya-worker`, `emit-board-types` and `emit-migration-sql`.
  - Replace `REPO_ROOT` with a `sourceRoot` parameter.
  - Each entry point returns `BuildResult` (`{artifacts: [{kind, path}]}`), the shape `runVerb` renders.
- Export from `packages/app/src/builder/index.ts`: `bundlePlugins`, `bundleLayaWorker`, `emitBoardDeclarations`, `emitKitDeclarations` and `emitMigrationSql`. Keep the names.
- `git mv scripts/commands/<m>.test.ts packages/app/tests/builder/<m>.test.ts` and repoint the imports. These tests already exist and move with their code.
- `apps/cli/src/commands/builder/build.ts`: register the four verbs inside `registerBuilderArtifactCommands`, wrapped in `bootFree(...)`, each through `runVerb`.
- Package scripts invoke the CLI from the workspace cwd:
  - from `apps/cli`: `bun run src/index.ts builder <verb>`;
  - from `apps/server`: `bun run ../cli/src/index.ts builder build-server`;
  - from root: `bun run apps/cli/src/index.ts builder bundle-config apps/cli/config`.
- `build:bundle` order is unchanged: bundle-web → emit-board-types → emit-migration-sql → `bun build` → bundle-config config → bundle-laya-worker → bundle-plugins.

**Precedence.** The CLI imports `packages/domain/src/migration-sql.generated.ts`, which is tracked, while `emit-migration-sql` rewrites it. Running the emitter from a CLI that imported the old copy is safe because the output is deterministic from `drizzle/0037_*.sql`. `git diff --exit-code` proves it.

**Coverage.** Moved files land under `packages/**/src/**` and the 90% per-file `coverage-gate`. The moved tests must keep each file ≥ 90%. Add cases only for uncovered failure paths, written before code, never to pad coverage.

**Handoff.**
- 1411 consumes the rewired `build:binaries` and generalizes `builder build-binaries` and `verify-pack`.
- 1415 includes these four verbs in the surface-shape test.
- Every new verb is exactly `spur builder <verb>`, with no mode flags.

**Anti-patterns.**
- No new boot fallback code: it exists.
- No generic bundler abstraction.
- Do not shell out from the verb to `scripts/`.
- No exit code other than `runVerb`'s.
- No `.github/workflows/` edit, no publish.

### Plan

- [ ] 0. Precondition: run `bun install` (lockfile current), then `bun run build:all` on the old route. Record the sha256 manifest of `apps/cli/{config,web,worker,plugins,.claude-plugin}` and the emitted files in `.spur/run/1410-baseline.txt`.
- [ ] 1. Write a failing E2E in `apps/cli/tests/commands/builder/artifacts.e2e.test.ts` covering the four verbs:
  - each produces its artifacts and the `--json` envelope;
  - a non-checkout `--source-root` exits 1 with `not a Spur source checkout`;
  - the `resolveBundledConfigRoot` source-boot assertion.

  (R1, R2)
- [ ] 2. Move the four modules and their tests into `packages/app/src/builder` and `packages/app/tests/builder`, then parameterize `sourceRoot`. (R2)
- [ ] 3. Register the verbs in `build.ts` and export them from the builder index. (R2)
- [ ] 4. Rewire `apps/cli/package.json:54-56`, `apps/server/package.json:9` and root `package.json:76`. Delete the forwarders and moved scripts, add `RETIRED` entries, update the A94 inventory. (R3, R4)
- [ ] 5. Rerun `bun run build:all` and compare against the step-0 manifest. Run `git diff --exit-code` on the emitted files. Prove the packed tarball (`npm pack` in `apps/cli` + `spur builder verify-pack`) and standalone binary (`builder build-cli`, then `<bin> builder --help`). Run `bun run spur-check`. Receipt: `.spur/run/1410-receipt.md`. (R1, R3)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature A94, satellite §2–§4, consent C3.
- Code: `packages/app/src/builder/compile.ts:69`, `apps/cli/src/commands/builder/build.ts:36,130`, `packages/config/src/bundled-config.ts:38`.
- Upstream: 1409 (RETIRED map, A94 inventory). Downstream: 1411, 1415.

### History
