---
schema_version: 1
name: Absorb CLI and server compilation into builder without a bootstrap cycle
status: done
template: feature-impl
created_at: 2026-11-16T23:01:54.456Z
updated_at: "2026-11-17T04:29:20.051Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 8

dependencies: ["1351"]
done_forced: "false"
done_reason: unforced close
---

## 1354. Absorb CLI and server compilation into builder without a bootstrap cycle

### Background

A93 implements R7 — Builder absorbs coherent reusable build and packaging operations. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Compile restoration treated as already complete → laya acquisition is outside finally after ts-runtime patch → include nested acquisition/cleanup failure regression rather than preserve a lock leak.
- Moved services assumed same dependency roots → existing patch helpers resolve via module ancestry → resolve every input and patched dependency from explicit sourceRoot.
- Source entrypoint alone assumed cold-build safe → main eagerly boots and static CLI imports can require generated artifacts → prove a disposable no-generated-artifact path and retain a minimal direct shared-service source entrypoint if required.
- Tests and outputs unspecified → freeze compile E2E, six release asset names, source-root defaults and restore receipt; retain checksum test coverage.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [x] R1. Move build-cli/build-server/build-binaries into app builder services behind the proposed flat verbs with --source-root defaulting to cwd and structured JSON/envelope. Validate the source checkout and resolve patch targets within it before mutation.
- [x] R2. Preserve one compile lock, optional-platform import behavior, six release assets and SHA256SUMS. Enclose both patch acquisitions and both cleanup actions so acquisition, compilation or restoration failure cannot leave another patch/lock unhandled.
- [x] R3. Rewire apps/cli and apps/server package callers and dispatcher imports to one shared implementation. Keep a minimal source-build entrypoint or forwarding route only where needed for cold boot/unchanged CI; it must not carry duplicate compile logic or require the output it builds.
- [x] R4. Write failing end-to-end cases first for bad sourceRoot, cold generated-artifact absence, second patch-acquisition failure, compiler nonzero and concurrent lock refusal. Verify source/packed/host-native standalone execution against explicit checkout, restoration hashes, asset/checksum naming and no DB boot.

### Acceptance Criteria

- [x] AC1 — Builder absorbs coherent reusable build and packaging operations

Requirement and verification mapping: AC1 covers R1–R4. Given a disposable source checkout with absent generated output, invoke each compile entrypoint; assert actual artifact behavior, restored patch hashes/lock absence after forced failures and release checksum/name fixtures. Foreign target execution is not certified on the host.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:39.238Z

- Closed: three flat verbs, explicit source checkout, unchanged outputs/foreign asset names; no new command group or target mode grammar.
- Closed: source-root-resolved patches use one existing lock with nested cleanup; accidental failure during second acquisition is part of this task's preservation contract.
- Closed: retain a direct source shared-service entrypoint only if necessary to avoid generated-import cycles. It is a transport, not duplicate compile logic.
- Deferred to Robin before implementation: exact compile verb/flag/output consent. Workflow mutation, publishing and network toolchain acquisition remain outside scope.

#### Q&A entry — 2026-11-16T23:49:24Z

- Grantee: Robin (operator). Granted scope: the additive `spur self status` output, `spur self install`, and the six `spur builder` verbs — exactly the scope recorded in `docs/design/concrete-spur-self.md` §7 and `docs/reports/A93-script-ownership.json` `deferredConsent`.
- Basis: operator answered the A93 batch consent question in this run (2026-11-16) with "grant all three scopes"; the grant is recorded in design §7. Step 0 of this task is therefore satisfied.
- Not granted: publishing, deployments, workflow/IAM edits, or any surface outside that list.

### Design

Frozen proposed verbs: builder build-cli|build-server|build-binaries [--source-root <dir>] [--json] [--json-envelope]. Relative sourceRoot resolves from invocation cwd; outputs stay <root>/dist/cli/spur, <root>/dist/server/spur-server and release assets under <root>/dist/cli. Reuse original function names buildCli(sourceRoot), buildServer(sourceRoot), buildBinaries(sourceRoot), buildCompiledBinary(entry,outfile,sourceRoot), patchTsRuntimeImport(sourceRoot), patchLayaMlxSourceImport(sourceRoot), layaMlxInstalled(sourceRoot), binaryAssetName, writeSha256Sums in packages/app/src/builder/{compile,binaries}.ts. Expose a narrow @gobing-ai/spur-app/builder subpath; CLI adapters never deep-import another workspace. Freeze JSON success {ok:true,sourceRoot,artifacts:[{path,kind}]} and standard CLI error output; child build logs go to diagnostics under JSON. Errors are nonzero and never publish.

Resolve every source file, dependency manifest and runtime dist from sourceRoot. Do not patch the executing installed CLI's dependencies by accident. Validate checkout markers before opening locks; preserve current platform/external-peer choices. Nest laya acquisition inside the scope that owns ts-runtime restoration, and attempt both restore actions with finally even if the first throws. Do not add a lock manager or redesign released dependency facades.

Own scripts/commands/build-{cli,server,binaries}.ts, app compile service/subpath export, apps/cli/src/commands/builder/{build-cli,build-server,build-binaries,index}.ts, root/workspace package callers and test locations. Builder build routes bypass eager project DB boot. A cold source path must import no missing generated migration/config/CLI bundle; if full index has such imports, retain a minimal source entrypoint calling the SAME app service. Keep CI-compatible thin forwarding dispatch until its caller can be changed within authorization. No workflow edit, publish, downloaded toolchain or new dependency.

Test first at apps/cli/tests/commands/builder/compile.e2e.test.ts; retain/move scripts/commands/build-binaries.test.ts checksum/name assertions with their owning service without rewriting them as implementation mirrors. A host-native build executes as proof; all six release names/checksum fixtures are asserted locally. Cross-compiled foreign execution is not claimed on one host. Record .spur/run/1354-compile-e2e.json including source/packed/standalone provenance, compiler invocation, exit, restored hashes and lock absence.

Input from 1351: exact compile contracts and ownership; Robin grants their public consent before implementation. Output to 1355: source-root policy, builder registration and shared artifact report; do not make packaging own compilation. Output to 1356: retired routes/compatibility reasons. Sole main worktree and no wip at audit; sequential writer. Budget 8h; requireDiff shared compile+transport/callers+behavior proof.

### Plan

1. Step 0: verify 1351 ownership/public-contract consent, sourceRoot markers, tool availability and package drift; preserve all starting Git changes.
2. R2/R4: write failing compile E2E fixtures first, including laya acquisition throwing after runtime patch and cleanup throwing; use a disposable checkout for cold bootstrap.
3. R1/R2: move shared compile/asset functions with source-root resolution, nested cleanup and JSON-safe diagnostics; wire boot-free adapters without importing missing generated artifacts.
4. R3/R4: rewire package/dispatcher/tests to the single owner; run focused compile/checksum proof, host-native source/packed/standalone artifact checks, required CLI link/bundle and task gate; persist restoration/lock/checksum receipt.

### Solution

Compilation has one owner and one grammar:

- `packages/app/src/builder/compile.ts` (new) — `resolveSourceRoot`, `patchTsRuntimeImport(sourceRoot)`, `patchLayaMlxSourceImport(sourceRoot)`, `layaMlxInstalled(sourceRoot)`, `buildCompiledBinary`, `buildCli`, `buildServer`, `BuildError`. Every path resolves from the **explicit** source root (`createRequire(<root>/apps/cli/package.json)`, `<root>/packages/app/src/decision/decision-service.ts`), never from `import.meta.url`, so building a checkout can never patch the running package.
- `packages/app/src/builder/binaries.ts` (new) — `binaryAssetName`, `releaseAssetNames`, `writeSha256Sums`, `buildBinaries`: six targets, one invocation each, `SHA256SUMS` in GNU format.
- `packages/app/src/builder/index.ts` + `packages/app/package.json` `"./builder"` export — a narrow subpath; CLI adapters never deep-import the app barrel.
- Restoration contract: both patches are acquired **inside** one restoration scope, so a failing laya acquisition still restores the ts-runtime patch and releases `.spur-compile.lock`; `finally` attempts every restore and rethrows the first failure only after all were tried. A nonzero compiler exit is a `BuildError`.
- `apps/cli/src/commands/builder/build.ts` (new) — the three flat verbs with `--source-root`, `--json`, `--json-envelope`; structured `{error:{code:'build',message,sourceRoot}}` and exit 1; registered in `builder/index.ts`.
- `scripts/commands/build-{cli,server,binaries}.ts` — reduced to thin forwarders over `@gobing-ai/spur-app/builder` (no compile logic). They exist so package scripts and CI can build **before** the CLI's generated `apps/cli/config` bundle exists; the dispatcher (`scripts/spur-dev.ts`) imports the new names. Proven by importing all three forwarders with `apps/cli/config` moved away.
- Tests, written first: `apps/cli/tests/commands/builder/compile.e2e.test.ts` (5 cases against a disposable checkout: bad source root, concurrent lock, second-acquisition failure, compiler nonzero, host-native cold build producing `dist/cli/spur`), `apps/cli/tests/commands/builder/build.test.ts` (transport/help/structured error), `packages/app/tests/builder/compile.test.ts` (patch acquisition/restore, checkout-scoped laya detection, per-target args, default runner), `packages/app/tests/builder/binaries.test.ts` (moved with its subject; six names + `SHA256SUMS`).
- Docs/governance: `docs/design/harness-surface-governance.md` §3 frozen list + a new §4 consent row (A93, 2026-11-16), `docs/design/cli-contracts.md`, `docs/help/cmd_builder.md`, `docs/help2/builder.md`, `docs/help/spur-cli-matrix.md` (builder 8→11 verbs), `plugins/sp/skills/spur-cli/references/builder.md`.
- Boundary-rule exemptions added with reasons: `ts-db-only-in-domain` for the patch writer (it writes the specifier into a dependency file, never imports it) and `no-direct-fs-io` for both builder modules (byte-exact patch/restore and binary hashing).

Receipt: `.spur/run/1354-compile-e2e.json`.

#### Forced verification corrections — 2026-11-16

- `apps/cli/src/index.ts:104` routes the six build/staging verbs before project DB/config boot; a malformed unrelated project config no longer masks source-root validation.
- `packages/app/src/builder/compile.ts:217` reuses bundleConfig to stage filtered assets, embeds that config directory in the executable and removes its owned staging directory after compilation/restoration.
- `apps/cli/tests/commands/builder/compile.e2e.test.ts:8` reproduced absent standalone seeds before the repair, then executed the generated binary away from source/sibling assets. Compile restoration/lock proofs remain intact.
- The compiler asset option was checked against the installed CLI help and Bun's official executable documentation: https://bun.sh/docs/compiler/executables . No dependency/toolchain was added.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/builder/compile.ts:217`, `apps/cli/src/commands/builder/build.ts:24`; three flat build verbs use source-root-resolved app services and structured output. |
| R2 | MET | `packages/app/src/builder/compile.ts:217`, `packages/app/src/builder/binaries.ts:36`; nested acquisition/cleanup, exclusive lock, asset names and SHA256SUMS assertions pass. Filtered embedded config staging is cleaned after compilation. |
| R3 | MET | `scripts/commands/build-cli.ts:1`, `scripts/commands/build-server.ts:1`, `scripts/spur-dev.ts:1`; retained source entrypoints forward to one app implementation; no second compiler implementation was added. |
| R4 | MET | `apps/cli/tests/commands/builder/compile.e2e.test.ts:8`, `apps/cli/src/index.ts:104`; bad root/cold build/patch failure/compiler failure/lock refusal plus no-DB boot and embedded-asset proofs passed. The actual checkout's host-native CLI was compiled and executed. Fix-pass artifacts: `.spur/run/1354-verify-answer.txt:1-34` and `.spur/run/1354-verdict.json:1-72` (re-evaluated requirement/AC evidence); session-local batch report `.spur/run/A93-verifyall-20261116-report.md:1-60`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Builder absorbs coherent reusable build and packaging operations | MET | test | `apps/cli/tests/commands/builder/compile.e2e.test.ts:8`; fresh test output and real CLI receipts: batch artifact `.spur/run/A93-verifyall-20261116-compile-real.json` line 1. |
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
- Verified current tree: scripts/commands/build-cli.ts:155.
- Verified current tree: scripts/commands/build-binaries.ts:66.
- Verified current tree: scripts/commands/build-server.ts:1.
- Verified current tree: apps/cli/src/index.ts:135.
- Verified current tree: apps/cli/package.json:54.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History

- 2026-11-17T00:44:03.933Z todo → wip (system)
- 2026-11-17T00:53:05.300Z wip → testing (system)
- 2026-11-17T00:53:06.620Z testing → done (system)

