---
schema_version: 1
name: Absorb safe artifact staging and tarball verification into builder
status: todo
template: feature-impl
created_at: 2026-11-16T23:01:54.457Z
updated_at: "2026-11-16T23:11:41.606Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 6

dependencies: ["1351", "1354"]
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

- [ ] R1. Move bundle-config/bundle-web/verify-pack into app builder services and proposed flat verbs with --source-root where defined, compatible positional inputs and structured JSON/envelope. Preserve default web auto-build only for the default source checkout and validate custom source fixtures without building.
- [ ] R2. Preserve physical symlink-aware source/destination overlap rejection, config filters/schema injection and Board manifest/import-map checks. Move unchanged Board facade specifier constants to contracts and re-export from web so app has no web runtime import or copied list.
- [ ] R3. Validate archive entry paths/types before extraction: reject absolute/traversal names, link/special entries and entries outside package. Read expected version from extracted package/package.json and compare plugin/marketplace versions; never depend on the verifier checkout version. Preserve missing/malformed/pruned-content failures.
- [ ] R4. Rewire package/dispatcher/test callers and retain documented generator/CI forwarding routes; prove cold source bundle-config, valid source/packed/standalone artifacts, symlink/source protection, archive escape rejection and independent archive version checks with a machine receipt.

### Acceptance Criteria

- [ ] AC1 — Builder absorbs coherent reusable build and packaging operations

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
