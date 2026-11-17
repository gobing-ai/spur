# A93 tooling absorption — final ownership record

Status: complete (planning + six implementation tasks). Source commit for the inventory:
see `A93-script-ownership.json` `sourceCommit`. Machine receipts live under `.spur/run/135x-*`.

This is the closing record for feature A93 ("Concrete Spur self: installation, consolidated
readiness and tooling absorption"). It states what each script surface became, which checks back
the claim, and what remains deliberately local.

## 1. What changed

| Surface | Before | After |
| --- | --- | --- |
| Machine setup | `scripts/install.sh` ran a hidden `spur init` with the failure swallowed, then best-effort `zg`/`a2a` recipes | `spur self install [--with zg\|a2a\|sp-plugin]` owns seeds and optional tools (`packages/app/src/services/self-install.ts`); the shell keeps only acquisition — OS/arch, download, checksum, atomic rename — and propagates a setup failure |
| Readiness | `spur status` projected project/Git/agent/decision fields from CLI-local code | `spur self status` + hidden `spur status` render one app-owned aggregate (`packages/app/src/services/self-status.ts`): nine sections, `schemaVersion`, `overallState`, one 5000 ms budget, no database open |
| Compilation | `scripts/commands/build-{cli,server,binaries}.ts` | `spur builder build-cli|build-server|build-binaries` over `packages/app/src/builder/{compile,binaries}.ts`; the scripts are thin forwarders (cold-boot/CI) |
| Staging/inspection | `scripts/commands/{bundle-config,bundle-web,verify-pack}.ts` | `spur builder bundle-config|bundle-web|verify-pack` over `packages/app/src/builder/{bundle-config,bundle-web,verify-pack}.ts`; forwarders remain |
| Promotion evaluation | measurement + verdict lived in `scripts/commands/workflow-promotion.ts` | `packages/app/src/workflow/promotion-evaluation.ts` owns read/measure/verdict; the script keeps catalogue, deadlines, check/resolve policy and its grammar |

Governance: ADR-130 carries a dated 2026-11-16 amendment; `harness-surface-governance.md` §3 lists
`builder` at fourteen verbs and §4 records the A93 consent grant (owner: Robin, 2026-11-16). Public
surface changes are exactly `spur self install`, the additive `spur self status` output, and six
`spur builder` artifact verbs.

## 2. Deliberately retained (repository-only)

Each retained file keeps a responsibility reason in `A93-script-ownership.json`; none is retained
for size. The classes:

- **Source generators** — `emit-board-types`, `emit-migration-sql` (authored sources are the SSOT).
- **Package asset staging** — `bundle-plugins`, `bundle-laya-worker` (source/package layout and
  optional dependency assets; `bundle-plugins` gained a CLI entry so the release path can drive it).
- **Repository policy gates** — `script-contract-check`, `transition-shim-check`, `link-check`,
  `dependency-drift-check`, `validate-commands`, `validate-flag-contracts`, `surface-drift-inventory`,
  `plugin-install-smoke`, `coverage-certification`, `coverage-provenance-check`.
- **Suite orchestration** — `run-tests`, `test-suite-termination` (preload, workspace coverage, child
  termination).
- **Fixtures and benchmarks** — `eval-pipeline`, `skill-eval`, `fleet-e2e*`, `a2a-*-e2e`,
  `fixtures/fleet-host-fixture`, `dev-all`.

## 3. Evidence per task

| Task | Receipt | What it proves |
| --- | --- | --- |
| 1351 | `docs/reports/A93-script-ownership.json` + `repo-wide-tests/a93-script-ownership.test.ts` | Candidate coverage regenerated from git, classification consistency, caller-anchor resolution, boundary ledger, ADR/consent projections |
| 1352 | `.spur/run/1352-*` | Boot-free status, nine sections, no DB creation, credential sentinel absent, 5 s deadline cuts a non-answering provider |
| 1353 | `.spur/run/1353-install-e2e.json` | Convergent seeds (byte/mtime identity on rerun), custom config preserved, unknown `--with` exits 2 before writes, selected-tool failure exits 1 with the binary kept |
| 1354 | `.spur/run/1354-compile-e2e.json` | Bad source root refused pre-mutation, single lock, both patches restored after a second-acquisition failure, host-native artifact produced |
| 1355 | `.spur/run/1355-artifacts-e2e.json` | Source snapshots survive overlap rejection, archive-owned version, link/traversal members refused before extraction, temp dir cleaned |
| 1356 | `.spur/run/1356-promotion-e2e.json` | Dispatcher-driven evaluate/check/resolve against isolated fixtures: zero-history refusal, strict-fewer bar, pinned baseline, contradicting resolve refused |

## 4. Boundary state

`boundaryEdges` is empty. The one real app→script import
(`apps/cli/src/release-ops.ts:6` → `scripts/commands/bundle-plugins`) was replaced by a driven
subprocess call, so no app or package service value-imports repository tooling. `apps/cli/src/index.ts`
keeps its documented `ts-db` bundler-hint import exemption (it imports nothing functionally).

## 5. Not done here (explicit)

- No publishing, deployment, workflow or IAM edit was performed.
- Cross-compiled foreign-target binaries are produced and checksummed but not executed on this host.
- Strict read-only database reads remain an upstream `ts-db` capability; until it exists, `self status`
  reports ledger sections `unavailable` with the reason instead of guessing.
- Superskill adapter timestamps are not asserted; adapter convergence belongs to Superskill.
