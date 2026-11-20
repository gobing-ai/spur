---
schema_version: 1
name: "A94 wave 3: generic build-binaries, verify-pack and check-deps"
status: todo
template: feature-impl
created_at: 2026-11-20T07:58:05.084Z
updated_at: "2026-11-20T08:38:07.663Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1410"]
estimate_hours: 6
---

## 1411. A94 wave 3: generic build-binaries, verify-pack and check-deps

### Background

Implements: R4 — Builder packaging verbs work for a downstream project; R6 — Linked dist and lockfile drift checks are configurable.

A93 builder verbs resolve apps/cli/package.json; C1/C2 make packaging generic and C4 replaces link-check and dependency-drift-check with a scoped verb.

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- "build-binaries is generic once flags exist" → `buildBinaries` hardcodes the source root (`packages/app/src/builder/binaries.ts:56` via `resolveSourceRoot`), the `spur-` asset prefix (`:31`), six targets (`:21`) and `dist/cli` (`:58`). → With `--entry` it runs with no source-root check and uses `--name`, `--targets` and `--out`. With no `--entry`, the current Spur release build (names and SHA256SUMS consumed by `scripts/install.sh`) stays byte-identical.
- "verify-pack: Spur members move to its own invocation" → the Spur checks are not just member presence. `verifyPackExtract` asserts that the plugin.json and marketplace versions equal the package version, plus a marketplace entry shape and a tests/evals prune check (`verify-pack.ts:109-140`). `--require` cannot express version equality, and a new flag is outside C2. → The generic verb keeps member-safety (`assertSafeMembers`, `:65`), the package.json version, and `--require`. The Spur-specific assertions move to exported `verifySpurPackExtract()`, called only from Spur's packed-tarball E2E. No repo or CI caller invokes `builder verify-pack` (rg 2026-11-20), so no route changes.
- "check-deps = link-check + drift" → the two scripts use different scope filters. link-check covers all `@gobing-ai/*` symlinks (`scripts/commands/link-check.ts:43`). The drift check covers only `@gobing-ai/ts-*` (`dependency-drift-check.ts:28`). The lockfile also carries `@gobing-ai/spur-*@workspace:` entries. → One `dependencyScope` glob list drives both. `workspace:` specs are skipped. Spur's `['@gobing-ai/*']` deliberately widens the drift check to `superskill`, which matches today (lock 0.3.44 = installed 0.3.44).
- Exit-code split → R4's 0/1/2 contract applies to `check-deps` only. `build-binaries` and `verify-pack` keep the existing `runVerb` contract (exit 1 on failure, `apps/cli/src/commands/builder/build.ts:130`).
- Callers → root `package.json:102` `link-check`, `:107` `dependency-drift-check`, both chained in `:93` `spur-check-feature` and `:96` `spur-check:full`. `apps/cli/package.json:55` `build:binaries` is rewired by 1410. The `docs/design/sdlc-actions.md:279,281` table rows are updated.

### Requirements

- [ ] R1. `spur builder build-binaries --entry <file> [--name <bin>] [--targets <csv>] [--out <dir>]`:
  - compiles `<entry>` with no Spur source-root check;
  - `--name` defaults to the entry basename without its extension;
  - `--targets` is a subset of `darwin-arm64,darwin-x64,linux-arm64,linux-x64,windows-x64,windows-arm64` (default all);
  - `--out` defaults to `dist/bin` under the cwd;
  - writes `<name>-<target>[.exe]` plus GNU-format `SHA256SUMS`.

  With no `--entry`, output is byte-identical to today (`dist/cli/spur-*`). An unknown target fails before any compile, with exit 1 and `unknown target: <t> (valid: …)`.
- [ ] R2. `spur builder verify-pack <tgz> [--require <member>]…` checks:
  - member safety;
  - a non-empty `package/package.json` version;
  - every `--require` path present as `package/<member>`.

  A missing member fails with exit 1 and `required member missing: <member>`. Plugin and marketplace version equality plus the prune check live only in exported `verifySpurPackExtract()`, asserted by Spur's packed-tarball E2E.
- [ ] R3. `spur builder check-deps [--scope <glob>]…` reads `builder.dependencyScope` (`string[]`, default `[]`). A non-empty `--scope` replaces it. For every installed package whose name matches:
  - **linked check:** a `bun link` symlink resolving outside the project whose newest `dist/` mtime is older than its newest `src/` (logic from link-check);
  - **drift check:** a `bun.lock` resolved version that differs from `node_modules/<pkg>/package.json` version, skipping `workspace:`/`link:` specs.

  An empty scope prints `check-deps: no dependencyScope configured — skipped` and exits 0. `.spur/config.yaml` sets `builder.dependencyScope: ['@gobing-ai/*']`.
- [ ] R4. `check-deps` exits:
  - 0 with no findings;
  - 1 on findings;
  - 2 on usage or input errors (invalid config value, unreadable `bun.lock` when the scope is non-empty).

  `--json` emits `{ok, findings: [{kind: "stale-link"|"drift", package, detail}]}` through the standard envelope (`--json-envelope`).
- [ ] R5. Root `package.json` replaces `link-check` and `dependency-drift-check` with one `check-deps` script (`bun run apps/cli/src/index.ts builder check-deps`), used in `spur-check-feature` and `spur-check:full`. `scripts/commands/{link-check,dependency-drift-check,build-binaries,verify-pack}.ts` are deleted and RETIRED entries are added. The A94 inventory is updated.

**Out of scope:** new targets, signing or notarization, publishing, a `.github/workflows` edit, an evaluator type in ts-rule-engine.

### Acceptance Criteria

- [ ] AC1 — Builder packaging verbs work for a downstream project (req: R1, R2)
- [ ] AC2 — Linked dist and lockfile drift checks are configurable (req: R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:34:31.942Z

- **Q:** How are Spur's version-consistency checks kept without a new verify-pack flag? **A (closed):** exported `verifySpurPackExtract()`, asserted in Spur's packed-tarball E2E. No production caller exists today.
- **Q:** Widening the drift check to `@gobing-ai/*` adds `superskill`. Is that intended? **A (closed):** yes. It is a real consumed dependency, and it matches today.
- **Q:** Does exit 0/1/2 apply to all three verbs? **A (closed):** only to `check-deps`, a check verb per satellite §4. The build verbs keep `runVerb` exit 1.

### Design

**WHAT/WHY.** Three builder verbs become usable in any Bun project. Spur's own invocation keeps today's defaults, so the release build and `install.sh` contract don't move.

**WHERE (frozen).**
- `packages/app/src/builder/binaries.ts`:
  - `buildBinaries(options & {entry?, name?, targets?, out?})`.
  - Set `entry` → skip `resolveSourceRoot` and compile through the existing `buildCompiledBinary` runner.
  - Generalize `binaryAssetName(suffix, name = 'spur')`.
- `packages/app/src/builder/verify-pack.ts`:
  - `verifyPack(tgz, {require?: string[]})`;
  - split `verifyPackExtract` into a generic part plus exported `verifySpurPackExtract(extractRoot)`.
- `packages/app/src/builder/check-deps.ts`: new. Move the logic from `scripts/commands/{link-check,dependency-drift-check}.ts` with `git mv` of one plus merge, keeping the WHY comments on Bun lockfile resolution kinds. Export `checkDeps({cwd, scope}) → {findings}`.
- `packages/config/src/index.ts:1161` `BuilderConfigSchema`: add `dependencyScope: z.array(z.string()).default([])`. Regenerate the embedded schema if the build requires it.
- CLI:
  - `apps/cli/src/commands/builder/build.ts`: add the new flags on `build-binaries` and `verify-pack`.
  - `apps/cli/src/commands/builder/check-deps.ts`: new. Register it in `builder/index.ts`, `bootFree`.
- Tests:
  - move `scripts/commands/{link-check,dependency-drift-check}.test.ts` → `packages/app/tests/builder/check-deps.test.ts`;
  - E2E `apps/cli/tests/commands/builder/downstream.e2e.test.ts` with fixture `apps/cli/tests/fixtures/downstream-bun/` (`package.json`, `src/index.ts`, `bun.lock`).

**Algorithm notes.**
- Glob matching uses `new Bun.Glob(pattern).match(pkgName)`.
- Lockfile parsing reuses the drift script's JSONC reader, unchanged.
- E2E compiles the host target only (`--targets $(host)`), so the test stays offline. The receipt runs the full set.

**Config precedence.** `--scope` (non-empty) > `builder.dependencyScope` > `[]`.

**Handoff.** 1415 includes `check-deps` in the surface-shape test, and the shipped-surface scan covers the new `builder.md` reference rows.

**Anti-patterns.**
- No Spur path guessing in generic mode.
- No new flag beyond C1/C2/C4.
- No mode flag on `check-deps` (e.g. `--links-only`).
- No change to `install.sh`.
- No hardcoded `@gobing-ai` left in `packages/app`.

### Plan

- [ ] 1. Write a failing `downstream.e2e.test.ts` against the non-Spur fixture:
  - `build-binaries --entry` (host target) produces `<name>-<t>` and SHA256SUMS;
  - `verify-pack` on the fixture's `npm pack` output passes, and `--require missing.txt` exits 1;
  - `check-deps`: empty scope skips (0), a drift fixture → 1 with `--json` finding, a bad config value → 2.

  Add the Spur-tgz assertion with `verifySpurPackExtract`. (R1–R4)
- [ ] 2. Generalize `binaries.ts` and `verify-pack.ts`, keeping existing Spur tests green. (R1, R2)
- [ ] 3. Create `check-deps.ts` from the two scripts, add the config key, set `.spur/config.yaml`, register the verb. (R3, R4)
- [ ] 4. Rewire root `package.json`, update `sdlc-actions.md:279,281`, delete the four scripts, add RETIRED entries, update A94. (R5)
- [ ] 5. Receipt `.spur/run/1411-receipt.md`:
  - `bun run apps/cli/src/index.ts builder build-binaries` sha256 matches the pre-change build;
  - `bun run check-deps` → 0;
  - packed-tarball and standalone-binary runs of the three verbs;
  - `bun run spur-check`.

  (all)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Satellite §4 (scope config, check-verb exits), §5 C1/C2/C4.
- Code: `packages/app/src/builder/{binaries.ts:21-60,verify-pack.ts:65,109}`, `scripts/commands/link-check.ts:43`, `dependency-drift-check.ts:28`, `packages/config/src/index.ts:1161`.
- Upstream: 1410 (rewired `build:binaries`). Downstream: 1415.

### History
