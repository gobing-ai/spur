---
schema_version: 1
name: Absorb safe artifact staging and tarball verification into builder
status: done
template: feature-impl
created_at: 2026-11-16T23:01:54.457Z
updated_at: "2026-11-17T04:29:20.977Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 6

dependencies: ["1351", "1354"]
done_forced: "false"
done_reason: unforced close
---

## 1355. Absorb safe artifact staging and tarball verification into builder

### Background

A93 implements R7 — Builder absorbs coherent reusable build and packaging operations. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Archive safety claimed preserved → verify-pack extracts before validation and compares with checkout package.json → reject unsafe members before extraction and use the archive package manifest.
- App staging assumed import-independent → bundle-web imports Board facade constants from web → move unchanged transport constants to contracts and re-export, avoiding app-to-web runtime coupling.
- Default web source assumed already built → bundle-web auto-builds absent default dist/web → preserve default auto-build and validate custom sources without accidental rebuild.
- Artifact proof unspecified → freeze source-root paths, symlink overlap, packed manifest/version consistency, JSON diagnostics and real tarball E2E.
- Five-hour estimate omitted integrity/coupling work → current review adds archive and portable-constant ownership corrections → re-estimate to 6h.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [x] R1. Move bundle-config/bundle-web/verify-pack into app builder services and proposed flat verbs with --source-root where defined, compatible positional inputs and structured JSON/envelope. Preserve default web auto-build only for the default source checkout and validate custom source fixtures without building.
- [x] R2. Preserve physical symlink-aware source/destination overlap rejection, config filters/schema injection and Board manifest/import-map checks. Move unchanged Board facade specifier constants to contracts and re-export from web so app has no web runtime import or copied list.
- [x] R3. Validate archive entry paths/types before extraction: reject absolute/traversal names, link/special entries and entries outside package. Read expected version from extracted package/package.json and compare plugin/marketplace versions; never depend on the verifier checkout version. Preserve missing/malformed/pruned-content failures.
- [x] R4. Rewire package/dispatcher/test callers and retain documented generator/CI forwarding routes; prove cold source bundle-config, valid source/packed/standalone artifacts, symlink/source protection, archive escape rejection and independent archive version checks with a machine receipt.

### Acceptance Criteria

- [x] AC1 — Builder absorbs coherent reusable build and packaging operations

Requirement and verification mapping: AC1 covers R1–R4. Given real config/web/tarball fixtures, invoke actual builder verbs; assert preserved source snapshots on rejection, portable artifact content, archive-owned version comparisons, rejected unsafe members and default/custom web behavior.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:41.244Z

- Closed: preserve default web auto-build and internal custom-source test seam; only root rebasing changes ownership.
- Closed: tarball manifest is version authority; unsafe archive members fail before extraction. Existing integrity gaps must not be called preserved protections.
- Closed: Board constants move unchanged to the existing transport owner and retain the web export; no duplicated list or runtime app->web import.
- Deferred to Robin before implementation: exact three artifact verbs/flags/output consent. No workflow/publish or new dependency authorization is inferred.

#### Q&A entry — 2026-11-16T23:49:24Z

- Grantee: Robin (operator). Granted scope: the additive `spur self status` output, `spur self install`, and the six `spur builder` verbs — exactly the scope recorded in `docs/design/concrete-spur-self.md` §7 and `docs/reports/A93-script-ownership.json` `deferredConsent`.
- Basis: operator answered the A93 batch consent question in this run (2026-11-16) with "grant all three scopes"; the grant is recorded in design §7. Step 0 of this task is therefore satisfied.
- Not granted: publishing, deployments, workflow/IAM edits, or any surface outside that list.

### Design

Frozen proposed verbs: builder bundle-config <out-dir> [--source-root <dir>] [--json] [--json-envelope]; builder bundle-web [out-dir] [--source-root <dir>] [--json] [--json-envelope]; builder verify-pack <tgz> [--json] [--json-envelope]. sourceRoot defaults to cwd; relative explicit operands resolve from invocation cwd. Config source=<root>/config; web source=<root>/dist/web and default target=<root>/apps/cli/web. Preserve internal bundleWeb(target,source) fixture seam using explicit sourceRoot inputs, not moved module ancestry. Reuse service names bundleConfig, bundleWeb, verifyPackExtract, verifyPack under packages/app/src/builder/{bundle-config,bundle-web,verify-pack}.ts and the builder subpath from 1354. Success JSON uses {ok:true,sourceRoot?,artifacts:[{path,kind}]}; child build logs go to diagnostics.

Validate BOTH physical source/destination directions before destructive replacement; retain realpath behavior for nonexistent tails and propagate errors other than ENOENT. Preserve default missing-web auto-build, runtime/import-map ordering and facade existence checks. Move BOARD_UI_KIT_SPECIFIER and BOARD_FACADE_SPECIFIERS unchanged into packages/contracts/src/board.ts with exports, and re-export them from apps/web/src/modules/runtime/manifest.ts; no new facade values, UI behavior or app->web dependency.

verify-pack version authority is <extract>/package/package.json. Before extraction validate member names/types with the existing archive tool metadata path, refusing all link/special entries and traversal/absolute/outside-package names. Do not follow archive links or expose host paths. Extract only into a private temp directory and always clean owned temporary files on failure. Keep plugin/version/marketplace/pruned tests/evals integrity checks. No new archive dependency or shell command interpolation. An uninspectable archive is a failure, not an extraction fallback.

Owned: three original modules/adapters, app builder services, narrow exports, package callers, Board transport constants and their unchanged web re-export, plus apps/cli/tests/commands/builder/artifacts.e2e.test.ts and moved matching script tests. Keep bundle-plugins, bundle-laya-worker, emit-board-types and emit-migration-sql as generators. Do not repurpose their package-root assumptions or edit workflows.

1351 supplies report/consent; 1354 supplies root semantics/subpath/report shape and registration. Robin owns deferred public changes before implementation. 1356 receives final route inventory. Test FIRST through real CLI and tarballs: safe files, differing verifier/archive versions, invalid members, malformed metadata, symlink overlap, missing default/custom web and cold config. Receipt .spur/run/1355-artifacts-e2e.json includes artifact hashes and protected-source snapshots. One writer/no wip at audit; shared builder/index/package edits are ordered after 1354. Budget revised 5h -> 6h; requireDiff service/transport/caller/constant relocation+proof.

### Plan

1. Step 0: verify 1351 consent/ownership and 1354 source-root/export contract; inspect every old path caller before changing it.
2. R2/R3: write failing real-CLI artifact E2E cases first for symlink overlap, default/custom web, malicious archive members and archive-vs-checkout version authority.
3. R1/R2/R3: move shared staging/verification with explicit inputs and pre-extraction safety; relocate unchanged Board transport constants and wire adapters.
4. R4: rewire package/dispatcher/tests; run focused artifact E2E and moved regression proofs, source/packed/host-native standalone invocations, required CLI link/bundle and task gate; save hashes, archive listings and no-data-loss snapshots.

### Solution

Staging and inspection joined the builder, with the safety rules the move required:

- `packages/app/src/builder/bundle-config.ts` — `bundleConfig(target, { sourceRoot })`: source is `<sourceRoot>/config`, physical (realpath) overlap refusal in both directions kept, fixture/OS-junk prune and `$schema` injection unchanged.
- `packages/app/src/builder/bundle-web.ts` — `bundleWeb({ target?, source?, sourceRoot, run? })`: defaults `<root>/dist/web` → `<root>/apps/cli/web`; auto-builds ONLY the checkout's default missing `dist/web` (custom sources must already be built), and keeps the board-runtime/import-map/facade-asset checks. `BOARD_UI_KIT_SPECIFIER` + `BOARD_FACADE_SPECIFIERS` moved **unchanged** to `packages/contracts/src/board.ts` and are re-exported by `apps/web/src/modules/runtime/manifest.ts`, so packaging has no runtime app→web import and no second list.
- `packages/app/src/builder/verify-pack.ts` — `verifyPack(tarball)` / `verifyPackExtract(root)` / `parseArchiveListing` / `assertSafeMembers`. **Integrity changed, not just moved:** members are validated from the `tar -tvzf` type column paired with exact names from `tar -tzf` (portable across BSD/GNU padding, name-spaces included) before any extraction — absolute, drive-qualified, backslash, `..` traversal, outside-`package/`, link and special members are refused; the archive is then extracted into a private temp dir that is always removed; the version authority is `<extract>/package/package.json` instead of the verifier's checkout.
- `packages/app/src/builder/index.ts` — re-exports; `apps/cli/src/commands/builder/build.ts` gains `bundle-config`, `bundle-web`, `verify-pack` (positional operand or `<out-dir>` + `--source-root`; `verify-pack` skips checkout validation because its subject is an artifact), registered in `builder/index.ts`.
- `scripts/commands/{bundle-config,bundle-web,verify-pack}.ts` reduced to thin forwarders; `scripts/spur-dev.ts` imports them under new names so package scripts/CI keep working. `bundle-plugins.ts` gained an `import.meta.main` CLI entry so the release path can **drive** it.
- Boundary edge closed: `apps/cli/src/release-ops.ts` no longer value-imports `scripts/commands/bundle-plugins`; `stagePluginCopy()` spawns the retained generator and skips visibly when it is absent (fixture repos) — the release-ops fixture test now copies the real generator in and exercises the spawn path.
- Tests: `apps/cli/tests/commands/builder/artifacts.e2e.test.ts` (10 cases: staging + prune + overlap refusal, built-board staging, missing-manifest refusal, archive-owned version, link-member refusal, uninspectable archive, plugin-version mismatch, temp-dir cleanup, missing tarball); `packages/app/tests/builder/{verify-pack,bundle-config,bundle-web}.test.ts` moved with their subjects and extended (member classification, traversal/absolute/link/special refusal, version authority, pruned content, default-source auto-build via injected runner).
- Docs/governance: `docs/design/harness-surface-governance.md` (§3 frozen list → fourteen verbs, §4 A93 row now lists all six builder verbs), `docs/design/cli-contracts.md`, `docs/help/cmd_builder.md`, `docs/help2/builder.md`, `docs/help/spur-cli-matrix.md` (builder 11→14), `plugins/sp/skills/spur-cli/references/builder.md`.

Receipt: `.spur/run/1355-artifacts-e2e.json`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/builder/bundle-config.ts:41`, `packages/app/src/builder/bundle-web.ts:161`, `packages/app/src/builder/verify-pack.ts:178`; source, packed and standalone artifact commands all exited zero on valid real fixtures. |
| R2 | MET | `packages/app/src/builder/bundle-config.ts:41`, `packages/contracts/src/board.ts:118`; physical-overlap guards, config filtering/schema injection and unchanged portable facade constants are covered by current builder tests. |
| R3 | MET | `packages/app/src/builder/verify-pack.ts:178`; pre-extraction member inspection and archive-owned manifest version are exercised by artifact E2E, including rejected link/uninspectable/mismatched archives. |
| R4 | MET | `apps/cli/tests/commands/builder/artifacts.e2e.test.ts:10`; fresh protected-source/fixture checks and nine actual source/packed/standalone artifact invocations passed, using an archive version different from the verifier checkout. Fix-pass artifacts: `.spur/run/1355-verify-answer.txt:1-34` and `.spur/run/1355-verdict.json:1-72` (re-evaluated requirement/AC evidence); session-local batch report `.spur/run/A93-verifyall-20261116-report.md:1-60`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Builder absorbs coherent reusable build and packaging operations | MET | test | `apps/cli/tests/commands/builder/artifacts.e2e.test.ts:10`; fresh test output and real CLI receipts: batch artifact `.spur/run/A93-verifyall-20261116-artifact-golden.json` line 1. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: scripts/commands/verify-pack.ts:52.
- Verified current tree: scripts/commands/verify-pack.ts:98.
- Verified current tree: scripts/commands/bundle-web.ts:24.
- Verified current tree: apps/web/src/modules/runtime/manifest.ts:67.
- Verified current tree: scripts/commands/bundle-config.ts:57.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History

- 2026-11-17T01:04:48.883Z todo → wip (system)
- 2026-11-17T01:18:28.701Z wip → testing (system)
- 2026-11-17T01:18:30.237Z testing → done (system)

