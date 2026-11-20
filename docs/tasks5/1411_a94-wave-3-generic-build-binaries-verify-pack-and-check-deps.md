---
schema_version: 1
name: "A94 wave 3: generic build-binaries, verify-pack and check-deps"
status: done
template: feature-impl
created_at: 2026-11-20T07:58:05.084Z
updated_at: "2026-11-20T11:04:40.204Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1410"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
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

- [x] R1. `spur builder build-binaries --entry <file> [--name <bin>] [--targets <csv>] [--out <dir>]`:
  - compiles `<entry>` with no Spur source-root check;
  - `--name` defaults to the entry basename without its extension;
  - `--targets` is a subset of `darwin-arm64,darwin-x64,linux-arm64,linux-x64,windows-x64,windows-arm64` (default all);
  - `--out` defaults to `dist/bin` under the cwd;
  - writes `<name>-<target>[.exe]` plus GNU-format `SHA256SUMS`.

  With no `--entry`, output is byte-identical to today (`dist/cli/spur-*`). An unknown target fails before any compile, with exit 1 and `unknown target: <t> (valid: …)`.
- [x] R2. `spur builder verify-pack <tgz> [--require <member>]…` checks:
  - member safety;
  - a non-empty `package/package.json` version;
  - every `--require` path present as `package/<member>`.

  A missing member fails with exit 1 and `required member missing: <member>`. Plugin and marketplace version equality plus the prune check live only in exported `verifySpurPackExtract()`, asserted by Spur's packed-tarball E2E.
- [x] R3. `spur builder check-deps [--scope <glob>]…` reads `builder.dependencyScope` (`string[]`, default `[]`). A non-empty `--scope` replaces it. For every installed package whose name matches:
  - **linked check:** a `bun link` symlink resolving outside the project whose newest `dist/` mtime is older than its newest `src/` (logic from link-check);
  - **drift check:** a `bun.lock` resolved version that differs from `node_modules/<pkg>/package.json` version, skipping `workspace:`/`link:` specs.

  An empty scope prints `check-deps: no dependencyScope configured — skipped` and exits 0. `.spur/config.yaml` sets `builder.dependencyScope: ['@gobing-ai/*']`.
- [x] R4. `check-deps` exits:
  - 0 with no findings;
  - 1 on findings;
  - 2 on usage or input errors (invalid config value, unreadable `bun.lock` when the scope is non-empty).

  `--json` emits `{ok, findings: [{kind: "stale-link"|"drift", package, detail}]}` through the standard envelope (`--json-envelope`).
- [x] R5. Root `package.json` replaces `link-check` and `dependency-drift-check` with one `check-deps` script (`bun run apps/cli/src/index.ts builder check-deps`), used in `spur-check-feature` and `spur-check:full`. `scripts/commands/{link-check,dependency-drift-check,build-binaries,verify-pack}.ts` are deleted and RETIRED entries are added. The A94 inventory is updated.

**Out of scope:** new targets, signing or notarization, publishing, a `.github/workflows` edit, an evaluator type in ts-rule-engine.

### Acceptance Criteria

- [x] AC1 — Builder packaging verbs work for a downstream project (req: R1, R2)
- [x] AC2 — Linked dist and lockfile drift checks are configurable (req: R3, R4, R5)

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

- [x] 1. Write a failing `downstream.e2e.test.ts` against the non-Spur fixture:
  - `build-binaries --entry` (host target) produces `<name>-<t>` and SHA256SUMS;
  - `verify-pack` on the fixture's `npm pack` output passes, and `--require missing.txt` exits 1;
  - `check-deps`: empty scope skips (0), a drift fixture → 1 with `--json` finding, a bad config value → 2.

  Add the Spur-tgz assertion with `verifySpurPackExtract`. (R1–R4)
- [x] 2. Generalize `binaries.ts` and `verify-pack.ts`, keeping existing Spur tests green. (R1, R2)
- [x] 3. Create `check-deps.ts` from the two scripts, add the config key, set `.spur/config.yaml`, register the verb. (R3, R4)
- [x] 4. Rewire root `package.json`, update `sdlc-actions.md:279,281`, delete the four scripts, add RETIRED entries, update A94. (R5)
- [x] 5. Receipt `.spur/run/1411-receipt.md`:
  - `bun run apps/cli/src/index.ts builder build-binaries` sha256 matches the pre-change build;
  - `bun run check-deps` → 0;
  - packed-tarball and standalone-binary runs of the three verbs;
  - `bun run spur-check`.

  (all)

### Solution

**WHAT.** The three remaining packaging/repository checks became one generic builder surface: `build-binaries` grew an `--entry` mode, `verify-pack` kept only archive-generic assertions and gained repeatable `--require`, and `link-check` + `dependency-drift-check` merged into a scope-driven `check-deps`. The four repository scripts and their two tests are gone.

**WHY.** A93's builder verbs only worked on Spur's own checkout, and the dependency checks carried a hardcoded `@gobing-ai` prefix and `process.exit` printing, so no downstream project could use them and no preset could reach them.

**Change map** (one anchored row per file):

| Area | Anchor | Change |
| --- | --- | --- |
| generic compile | packages/app/src/builder/compile.ts:214 | `patchRuntime` option: the generic path skips the Spur-only source patches |
| entry binaries | packages/app/src/builder/binaries.ts:129 | `buildEntryBinaries`: `--entry`/`--name`/`--targets`/`--out`, target validation before compiling, `SHA256SUMS` |
| archive checks | packages/app/src/builder/verify-pack.ts:112 | `verifyPackExtract` = version + requires; Spur invariants moved to `verifySpurPackExtract` |
| Spur pack path | packages/app/src/builder/verify-pack.ts:233 | `verifySpurPack` = generic extraction + Spur assertions, for the packed-tarball E2E |
| dependency checks | packages/app/src/builder/check-deps.ts:111 | `findStaleLinks` scope-driven; `lockKeyInScope`; `checkDeps` merges both findings |
| barrel | packages/app/src/builder/index.ts:26 | exports the check-deps surface, `BINARY_TARGETS`, the pack split |
| CLI verbs | apps/cli/src/commands/builder/build.ts:236 | `check-deps` (0/1/2, envelope) and the `build-binaries`/`verify-pack` flags |
| config schema | packages/config/src/index.ts:1168 | `builder.dependencyScope` (glob list, default `[]`) |
| repo config | .spur/config.yaml:101 | `dependencyScope: ['@gobing-ai/*']` |
| boot-free config access | apps/cli/src/index.ts:60 | `loadProjectConfigOrNull` threads a lazy loader into the boot-free context |
| root scripts | package.json:93 | `check-deps` replaces `link-check` + `dependency-drift-check` in both repo-wide chains |
| dispatcher | scripts/spur-dev.ts:111 | four more RETIRED names; imports/cases and the usage entries removed |
| inventory | docs/reports/A94-script-ownership.json:1 | 51 → 45 entries; caller anchors re-resolved to the shrunk dispatcher |
| boundary rule | config/rules/strict/runtime-boundaries.yaml:86 | one exemption for symlink/mtime `node:fs` use, with its reason |
| help pages | docs/help/cmd_builder.md:60 | `--entry`/`--name`/`--targets`/`--out`, `--require`, and the `check-deps` section |
| plugin help page | docs/help2/builder.md:14 | the same rows and sections |
| prompt reference | plugins/sp/skills/spur-cli/references/builder.md:34 | verb-map rows for `--entry`, `--require` and `check-deps` |
| surface matrix | docs/help/spur-cli-matrix.md:22 | `builder` 18 → 19 verbs, unique verbs 98 → 99, cells 125 → 126 |
| JSON inventory | docs/design/data-output-contracts.md:233 | `check-deps` findings-envelope row |
| scope test | plugins/sp/tests/feature-verification-scope.test.ts:25 | the repo-wide list names `check-deps` instead of the two retired scripts |
| envelope sweeps | apps/cli/tests/output-envelope.test.ts:395 | `verify-pack` + `build-binaries` recorded as `runVerb` delegates; census 89 → 91 |
| unit proofs | packages/app/tests/builder/check-deps.test.ts:44 | merge/empty-scope/input-error/scope-selection cases |
| entry proofs | packages/app/tests/builder/binaries.test.ts:105 | generic mode assets, naming defaults, unknown-target refusal |
| archive proofs | packages/app/tests/builder/verify-pack.test.ts:216 | `verifySpurPack` on a real archive + `--require` presence/absence |
| transport proofs | apps/cli/tests/commands/builder/check-deps.test.ts:63 | skip/findings/exit-2/envelope and the generic build refusals |
| moved tests | packages/app/tests/builder/link-check.test.ts:14 | same cases, explicit scope argument |
| moved tests | packages/app/tests/builder/dependency-drift-check.test.ts:10 | same cases, explicit scope argument |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/builder/binaries.ts:129 `buildEntryBinaries`; assets/SHA256SUMS/name/out and the pre-compile target refusal pinned at packages/app/tests/builder/binaries.test.ts:105 |
| R2 | MET | packages/app/src/builder/verify-pack.ts:112 generic extract + `--require`; Spur invariants at :140/:233; receipt shows `required member missing: worker/laya_worker.py` and a clean 257-file tarball |
| R3 | MET | packages/app/src/builder/check-deps.ts:111 scope-driven checks; `.spur/config.yaml:101` sets `['@gobing-ai/*']`; live run prints `check-deps OK — @gobing-ai/* in step with source and lockfile.` |
| R4 | MET | exit codes proven at apps/cli/tests/commands/builder/check-deps.test.ts:63 (0 skip, 1 findings, 2 input error) with the `{ok, findings}` envelope |
| R5 | MET | four scripts + two companion tests deleted; `check-deps` wired into `spur-check-feature`/`spur-check:full` (package.json:93); RETIRED carries all four names; inventory 51 → 45 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Builder packaging verbs work for a downstream project (req: R1, R2) | MET | test | packages/app/tests/builder/binaries.test.ts:105 and verify-pack.test.ts:216 run both verbs against fixture projects and archives with no Spur checkout |
| AC2 — Linked dist and lockfile drift checks are configurable (req: R3, R4, R5) | MET | command | `bun apps/cli/src/index.ts builder check-deps` on this repo (exit 0); fixture findings and exit-2 case in apps/cli/tests/commands/builder/check-deps.test.ts:63 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Satellite §4 (scope config, check-verb exits), §5 C1/C2/C4.
- Code: `packages/app/src/builder/{binaries.ts:21-60,verify-pack.ts:65,109}`, `scripts/commands/link-check.ts:43`, `dependency-drift-check.ts:28`, `packages/config/src/index.ts:1161`.
- Upstream: 1410 (rewired `build:binaries`). Downstream: 1415.

### History

- 2026-11-20T10:40:23.150Z todo → wip (system)
- 2026-11-20T11:04:39.018Z wip → testing (system)
- 2026-11-20T11:04:40.198Z testing → done (system)

