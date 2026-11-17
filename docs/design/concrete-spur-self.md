---
kind: design
title: Concrete Spur self and tooling absorption
status: proposed
created_at: 2026-11-16
updated_at: 2026-11-16
related: [A93, docs/00_ADR.md, docs/design/harness-surface-governance.md]
tags: [contract, A93, cli, planning]
---

# Concrete Spur self and tooling absorption

## 1. Issue and scope

ADR-130's 2026-11-16 amendment establishes the direction first. This satellite specifies the A93 target; none of the proposed commands below is shipped by this planning change. Current signatures remain in [cli-contracts](cli-contracts.md). Earlier absorption history remains in [the October plan](../plans/2026-10-14-spur-script-absorption.md).

The outcome is coherent machine setup, consolidated read-only status and gradual builder absorption. Do not empty scripts by moving fixtures into the runtime. No new nouns, generic build framework, dependency additions, actual installation, publishing or workflow mutation is part of this idea run.

## 2. Current evidence and ownership

- self registration delegates to shared init, migrate and status builders: apps/cli/src/commands/self/index.ts.
- status currently projects project/Git/spec/decision readiness: apps/cli/src/commands/status.ts.
- agent and decision register status; decision status includes maker/catalog details beyond self's current decisionMaker field. Other nouns do not gain invented status verbs.
- init has explicit opt-in global adoption and backup; migrate --check treats an absent DB as absent without creating it: apps/cli/src/commands/{init,migrate}.ts.
- scripts/install.sh verifies before atomic binary replacement but calls hidden init with swallowed failure, then best-effort zg/a2a installation.
- scripts/spur-dev.ts is a mixed dispatcher; root and workspace package scripts use it. Build helpers bind paths to import.meta.url and patch compile-time imports, so moving files without rebasing roots breaks them.
- Superskill owns plugin installation/adapters. self may invoke its supported CLI explicitly; it never copies adapters or imports another repository.

App services own semantics; packages/domain owns database access. CLI renders output and validates operands. No packages/app runtime import may point into scripts, test fixtures or plugin code.

## 3. Self status target

Reuse or extract read-only collectors from noun owners. The standalone noun status and aggregate must share the collector; self never spawns itself or scrapes text. Collect independently with a 5-second overall deadline and cancellation of network/child work; timeout becomes a partial section, not a dropped result.

Preserve top-level ok/packageJson/spurConfig/git/agentSpecs/decisionMaker/target and the existing optional path argument. Add schemaVersion: 1 and sections keyed installation, configuration, schema, dependencies, projects, agents, decisions, corpus and workflows. Each section has state (ready, degraded, missing, unavailable, not-applicable, error), scope (machine/project), source and a bounded message; data holds the owning service's safe result. Paths are provenance, never file contents or credentials.

| Section | Source and read policy |
| --- | --- |
| installation | Running executable/version, source versus packed/standalone provenance, PATH resolution, known installed asset locations; no network update check |
| configuration | Existing merged config metadata, global/project locations and load errors; no secret values or config write |
| schema | Existing database/ledger inspection, reusing migrate --check and CLI ledger reads without getDb creation/migration |
| dependencies | PATH/readiness for required tools and optional rg/zg/a2a/Superskill; no installation, embedding/index refresh or authentication |
| projects | Existing registry/server readiness; no start, stop or registry refresh writes |
| agents | Same spec/process data as agent status with bounded existing server request; no doctor execution or quota refresh |
| decisions | Same maker/catalog/readiness data as decision status, retaining current decisionMaker summary; never execute a decision |
| corpus | Counts/summaries from configured task/feature owners; missing corpus is explicit, no full validation or rewrite |
| workflows | Existing run summaries from an existing database only; no recovery, clean or replay |

The legacy ok and exit contract remain project-scaffold health: exit 0 when required project config exists, exit 1 when missing or a top-level path/read failure occurs. New overallState (ready/degraded/missing) conveys aggregate readiness without breaking consumers of ok. Optional or unreachable sections degrade overallState but do not change exit status; the text renderer names their remedy. No optional failure pretends to be healthy. Additive JSON is still an observable contract needing recorded consent.

Status must work outside a project and without a database, reporting missing/not-applicable sections without side effects. E2E snapshots before/after cover filesystem, schema ledger and process state with isolated HOME and PATH. The composition root currently opens/migrates a DB before ordinary dispatch (apps/cli/src/index.ts); status must join the existing boot-free routing pattern before that operation. A malformed config remains a top-level failure (exit 1), with safe diagnostics rather than config contents.

The current decision status handler calls getDb(), and openExistingDb is not a strict read-only opener: its installed ts-db adapter enables WAL and creates missing files. Do not reuse either on the aggregate path. Use ProjectRegistry.peek(), catalog status and decisionStatusReadiness over absent evidence without mutation. Ledger-derived sections are unavailable with a precise reason when the installed facade cannot provide a proven non-mutating read; they must never fabricate empty counts. Strict read-only adapter support belongs to the ts-db facade owner, not a new raw adapter in Spur. Base agent/decision summaries remain available, with their existing standalone render/exit behavior preserved. Self status never enables decision --probe or --reliability implicitly.

## 4. Self install target and lifecycle split

Choose a new flat verb: `spur self install [--with <tool>...] [--json] [--json-envelope]`. Tool choices are zg, a2a and sp-plugin. Bare install converges Spur's machine-owned global seeds and reports missing optional tools; explicit --with selects network/package-manager work. It never scaffolds cwd, edits a shell profile, migrates a project DB or replaces a running binary. Keep project init and schema migrate contracts separate.

Use existing global seed code, extracting it from init into app/config services as needed. Preserve custom config by default. Existing init --adopt-global-config remains the explicit backed-up replacement path; install introduces no force overwrite. Optional plugin setup invokes the supported Superskill install contract only on explicit selection; missing Superskill is an actionable step failure, never a silent adapter copy. Determine supported flags from installed CLI help at implementation time.

Step results: {name, state: created|unchanged|skipped|failed, required, message}, with ok and changed summary. Exit 0 if required seeds succeed and every explicitly selected step succeeds; exit 1 for a required or selected failure, exit 2 for invalid usage. Unselected optional tools appear skipped with instructions. Existing healthy binaries are detected before invoking package managers. Avoid a separate install database/journal: filesystem/config/PATH observations are the resume authority. Repeated install must leave healthy Spur-owned seed bytes and mtimes unchanged and avoid duplicate registration/PATH/plugin entries. Superskill owns adapter convergence; its supported installer may refresh timestamps, so do not infer a reliable adapter stamp or require cross-tool timestamp identity. The supported delegation is superskill install sp --marketplace <bundled marketplace directory>; use its default configured targets and do not invent a JSON flag. Missing bundled seed assets are a required failure, not successful zero-file seeding. Install also bypasses project DB boot before dispatch.

The POSIX installer remains the unavoidable first-binary bootstrap: OS/arch selection, download/checksum verification, atomic rename and cleanup. Delegate ALL post-download setup to the installed `self install` (absolute installed binary path). Preserve SPUR_VERSION, SPUR_INSTALL, SPUR_RELEASE_URL and existing verification behavior. Translate SPUR_INSTALL_ZG/A2A defaults to explicit --with requests to retain shell-installer compatibility; direct self install remains opt-in for optional tools. Stop swallowing required setup failures. If a requested optional tool fails after binary acquisition, retain the verified binary, show all step outcomes and return nonzero; a repeat retries the failed step. The bootstrap's acquisition checks cannot be delegated before the first binary exists; document this exception instead of copying a second downloader into the CLI.

Source, npm and standalone invocations must converge on identical setup services and resolve shipped assets independently of source-tree-relative paths.

Standalone compilation stages the same filtered config tree as package bundling and embeds it with
Bun's `--asset` option. Rule seeding falls back to that shipped `config/rules` tree when the rule
engine's development assets are absent. No generated asset copy or post-install download is needed.
The no-Homebrew A2A route retains the existing curl/bash installer and `SPUR_INSTALL` destination.

## 5. Builder target and source bootstrap

First wave exposes only six flat verbs, avoiding a different grammar selected by a mode operand:

| Proposed verb | Input | Responsibility |
| --- | --- | --- |
| builder build-cli | --source-root <dir> (default cwd) | Compile the checkout's CLI |
| builder build-server | --source-root <dir> | Compile its standalone server with shared compile facade |
| builder build-binaries | --source-root <dir> | Produce release assets and checksums |
| builder bundle-config | <out-dir>, --source-root <dir> | Stage config and schemas with physical source/destination overlap guards |
| builder bundle-web | [out-dir], --source-root <dir> | Stage built Board assets with existing guards |
| builder verify-pack | <tgz> | Inspect the tarball without publishing |

Each adds --json/--json-envelope with explicit artifact/error output. All write only explicit checkout build outputs or owned temporary directories, apart from the existing temporary compile import patches, which are locked and restored. Validate source root and manifests before mutation; no reliance on moved import.meta.url depth. Preserve compile lock, restore-on-failure patches, optional-platform dependency behavior and checksums. Service code lives under packages/app/src/builder with thin transports in apps/cli/src/commands/builder. No default package publishing or git mutation.

Refinement corrections: compile currently acquires the ts-runtime patch before acquiring the laya patch outside its finally; acquisition failure can leak a patch/lock. Move both acquisitions under nested restoration scopes, and always attempt both cleanups even when one throws. Resolve/patch dependencies from the explicit source checkout, not the executing installed package. verify-pack currently compares against the checkout manifest and extracts before member validation; the installed target instead uses package/package.json inside the archive as version authority and rejects traversal/link/special-file entries before extraction. This is an integrity gap to fix, not existing protection to claim preserved. bundle-web currently auto-builds its default missing dist/web and validates Board runtime assets; preserve that behavior with source-root defaults. Move the unchanged Board facade specifier constants into the existing portable Board contract owner and re-export from the web manifest, so app packaging never imports the web workspace at runtime. These proposals retain one implementation and do not alter rendered UI or manifest values.

Retain bundle-plugins, bundle-laya-worker and declaration/SQL emitters as irreducible source/package generators in this wave. Reuse their output through explicit source inputs; reassess only when a second useful contract exists. Do not promote them simply to increase the verb count.

Source builds must work before dist/spur.js/config exist: package scripts may invoke apps/cli/src/index.ts directly or a minimal source-build entrypoint over the same app service. Never require the just-built binary to build itself, and never turn root tests' initial bundle-config step into a dependency on its missing generated output. Prove the source graph with absent generated artifacts in a disposable checkout.

## 6. Exhaustive initial script disposition

All names below are relative to scripts/commands unless a full path is shown. Companions (*.test.ts, *.heavy.test.ts) follow the listed owner. Test-only files with no subject module remain repository contract fixtures unless their subject moves. Implementation re-enumerates the tree and records exact file:line callers before removal; the run's script-caller-inventory.json provides the planning baseline.

| Modules | Destination / action | Reason and verification |
| --- | --- | --- |
| scripts/install.sh | retain minimal bootstrap; setup to self install | First-binary boundary; install-sh fixtures move setup assertions to CLI E2E, retain checksum/bootstrap checks |
| scripts/spur-dev.ts | shrink registrations after each proven move | Keep only irreducible repo entrypoints; no parallel implementation |
| build-cli.ts, build-server.ts, build-binaries.ts | app builder services + matching flat verbs | Coherent compile/release outputs; move build-binaries tests with subject, preserve restore/lock |
| bundle-config.ts, bundle-web.ts, verify-pack.ts | app builder services + matching flat verbs | Explicit artifact boundaries; move matching tests and retain destructive overlap/archive checks |
| bundle-laya-worker.ts, bundle-plugins.ts | retain repository package asset staging | Known source/package layout and optional dependency assets; tests remain with generators |
| emit-board-types.ts, emit-migration-sql.ts | retain source generators | Declaration and migration source-of-truth projections; no generic installed contract justified |
| dev-all.ts | retain repository supervisor | Hardcoded source web/server development topology; retain heavy process-cleanup proof |
| run-tests.ts, test-suite-termination.ts | retain repository suite orchestration | Preload, workspace coverage and child termination are repository policy |
| coverage-certification.ts, coverage-provenance-check.ts | retain coverage artifacts/policy | Root LCOV certification, not a shipped noun service |
| dependency-drift-check.ts, link-check.ts | retain repository dependency gates | Lockfile/dist freshness of this monorepo; caller CLI services remain reusable |
| transition-shim-check.ts, script-contract-check.ts | retain repository policy | Migration ledger and source placement checks; no new policy or weakened gates |
| validate-commands.ts, validate-flag-contracts.ts, surface-drift-inventory.ts | retain authored-source contract gates | Source skill/CLI parity and inventory; no reason to ship test corpus |
| workflow-promotion.ts | extract reusable evaluation into app/workflow; retain repository catalogue check/resolve wiring | Candidate measurements belong with workflow facts/history services; no new public promotion verb in A93 |
| eval-pipeline.ts | retain fixture orchestration; reuse existing workflow/task CLI | Worktrees and 95xx fixture tasks are test-only, not runtime behavior |
| skill-eval.ts | retain repository eval fixtures | Imports plugins/sp/tests/evals; runtime must not import it |
| fleet-e2e.ts, fleet-e2e-turn-perf.ts, fleet-e2e-batch-perf.ts | retain fleet integration/benchmark scenarios | Fixture/performance receipts, not production orchestration |
| a2a-serve-e2e.ts, a2a-member-e2e.ts, a2a-two-install-e2e.ts | retain A2A E2E fixtures | External test executables and isolated multi-install proofs |
| fixtures/fleet-host-fixture.ts | retain with fleet E2E owner | Test host, never shipped |

Caller domains: root package.json (gates/dev/test aliases); apps/{cli,server,web}/package.json (build/package scripts); scripts/spur-dev.ts and script imports; apps/cli/tests, scripts/commands tests and repo-wide-tests (contract/path assertions); plugins/sp authored skills (documented invocations); .github/workflows (read-only migration audit). Workflow changes require explicit authorization if a future task discovers an essential rewrite; a temporary proven dispatcher forwarding route can preserve CI until then. Compatibility wrappers delegate one owner and have a task-bound retirement condition; no permanent duplicate.

One app-to-script edge exists today and is a boundary defect, not a classification question: `apps/cli/src/release-ops.ts:6` value-imports `scripts/commands/bundle-plugins`. `bundle-plugins` stays retained, so the release path must stop importing it — the builder service drives the retained staging route, and the edge is closed by task 1355. `docs/reports/A93-script-ownership.json` records it as `boundaryEdges[0]` until then.

## 7. Proposed public-contract decision record

Audience is local users/maintainers and installed agent workflows. The proposed new self install surface and six builder verbs above, plus additive self status output, are the exact scope to review before implementing. Rejected shapes: self init doing installs, self migrate doing non-SQL setup, self dev <command>, a new dev noun, promotion of all fixture runners and a raw dispatcher pass-through.

Operator requested exploration of installation alternatives and builder absorption, and --auto accepts planning recommendations. Neither is treated as blanket consent for every newly specified public verb. Direction is recorded in ADR-130; these exact public contracts remain proposed until an implementation intake records explicit consent with this design context. This does not block producing a complete reviewable planning batch. No actual host installation or network side effect is authorized by this document.

**Consent record (A93 R3, task 1351).** Owner: Robin. Status: **GRANTED 2026-11-16** (operator answer in the A93 `dev-runall` batch) for the three scopes listed below. The grant covers exactly these surfaces; it does not authorize publishing, deployments, workflow/IAM edits, or any verb outside the list.

Scope granted, exactly:

- `spur self install` with `--with zg|a2a|sp-plugin`, `--json`, `--json-envelope`;
- the additive `spur self status` output (schemaVersion, section keys, overallState) and the boot-free dispatch path it needs;
- `spur builder build-cli|build-server|build-binaries|bundle-config|bundle-web|verify-pack`, each with `--json`/`--json-envelope`.

Legacy behavior each of those changes: `scripts/install.sh` stops performing setup itself and delegates it to the installed binary, keeping `SPUR_VERSION`, `SPUR_INSTALL`, `SPUR_RELEASE_URL` and the zero-argument shell defaults; `spur self status` keeps `ok` semantics and the optional path argument while adding sections; package scripts for `build`, `build:bundle` and `build:binaries` move their target from `scripts/spur-dev.ts` to the builder verbs without changing their inputs. Missing consent stops the dependent public implementation, not the inventory in `docs/reports/A93-script-ownership.json`.

## 8. Waves, acceptance and evidence

1. ADR-130 amendment now; implementation contract/caller inventory task validates proposed surfaces and records missing consent before dependent public changes.
2. One status task covers R3/R4 end to end with collector extraction, renderer and snapshot/timeout proofs.
3. One install task covers R5/R6 with local release fixtures and isolated home/PATH; no real global installation needed.
4. Compile absorption task covers the three compile verbs and restore/bootstrap checks.
5. Artifact absorption task covers the three packaging verbs, caller rewires and tarball proofs.
6. Noun evaluation extraction/final migration audit covers workflow promotion core and all retained reasons.

For every task: declare failure cases and write the failing E2E/regression proof first, implement the smallest shared owner, run focused workspace checks then the pipeline's named gate. Produce a repeatable machine receipt identifying source/packed/standalone provenance, before/after observations, commands, artifacts and failures. No tests written after implementation, skipped assertions, new unit-only completion claims or actual publishes.

Feature closeout runs feature verification once when implementation is complete; this planning run records structural checks, not an implementation PASS. Ready evidence must state the public-consent prerequisite rather than claim it satisfied.

## 9. Tradeoffs and deferred scope

Retaining source generators and repository checks gives a smaller runtime and avoids new generic tooling. Six builder verbs add compatibility cost but each has one grammar and an independently testable artifact boundary. The bootstrap remains shell because a missing binary cannot execute its own installer. Optional dependencies stay explicit for direct CLI use; the legacy shell defaults are preserved visibly. No new dependency, schema or background service is needed.
