---
kind: design
title: Downstream-usable tooling absorption
status: implemented
created_at: 2026-11-19
updated_at: 2026-11-20
related: [A94, A93, A92, docs/00_ADR.md, docs/design/concrete-spur-self.md, docs/design/sdlc-actions.md, docs/design/harness-surface-governance.md]
tags: [contract, A94, cli, builder, rule, workflow, agent]
---

# Downstream-usable tooling absorption

## 1. Issue and scope

A93 sorted scripts by one question: does this operation have a coherent shipped contract? A94 asks a different one: would a downstream Spur project use it? A93 retained source generators, repository gates and runners under `scripts/`. The six builder verbs it shipped resolve `apps/cli/package.json` (`packages/app/src/builder/compile.ts:87`), so they only work on Spur's own checkout. Package builds still call `scripts/spur-dev.ts` (`apps/cli/package.json:54-56`, `apps/server/package.json:9`), even though the A93 consent record said they would move (`concrete-spur-self.md:136`). Shipped surfaces also send downstream agents to repository-only commands:

| Shipped file | Repository-only reference |
| --- | --- |
| `plugins/sp/skills/code-implementation/SKILL.md:153` | `bun run script-contract-check` |
| `plugins/sp/skills/fleet-join/SKILL.md:109`, `plugins/sp/skills/spur-cli/references/agent.md:247` | `bun run fleet-e2e --host-probe` |
| `config/rules/boundary/sp-script-placement.yaml:17` | `bun scripts/commands/script-contract-check.ts` (SKIPs downstream) |
| `config/rules/quality/coverage-gate.yaml:8` | certification produced only by `scripts/commands/run-tests.ts` |

This satellite specifies the target. The §5 consent record is granted. The commands ship as their implementation tasks land. ADR-130 applies (logic in `packages/app` behind existing nouns, thin transports, two-level depth, no `dev` noun), and so does ADR-051.

## 2. Disposition (every file)

Companions (`*.test.ts`, `*.heavy.test.ts`) follow their subject. "Move" means the implementation goes to `packages/app`, the CLI verb or flag is the transport, and the script file is deleted. "Forwarder" means a file of no more than 20 lines that calls the app service, kept only for a recorded cold-boot reason.

| Module(s) | A94 disposition | Destination | Downstream reason / retained reason |
| --- | --- | --- | --- |
| `build-binaries.ts` | move, generalize | `builder build-binaries --entry --name --targets --out` | Any Bun CLI project ships cross-compiled binaries plus SHA256SUMS |
| `verify-pack.ts` | move, generalize | `builder verify-pack <tgz> [--require <member>]…` | Any npm package benefits from member safety and required-content checks |
| `build-cli.ts`, `build-server.ts` | forwarder (cold boot only) | `builder build-cli`, `builder build-server` (exist) | Spur-package verbs; package scripts call the CLI once the bootstrap (§3) holds |
| `bundle-config.ts`, `bundle-web.ts` | delete forwarder | `builder bundle-config`, `builder bundle-web` (exist) | Spur-package verbs, reached through the §3 bootstrap |
| `bundle-plugins.ts`, `bundle-laya-worker.ts` | move | `builder bundle-plugins`, `builder bundle-laya-worker` | Spur-package staging; lets `build:bundle` run as one CLI chain (operator decision) |
| `emit-board-types.ts`, `emit-migration-sql.ts` | move | `builder emit-board-types`, `builder emit-migration-sql` | Spur-package generators (operator "move more"); refuse a non-Spur source root |
| `link-check.ts`, `dependency-drift-check.ts` | move, generalize | `builder check-deps [--scope <glob>]` | Stale `bun link` dist and lockfile drift affect any Bun monorepo; scope from `builder.dependencyScope` |
| `transition-shim-check.ts` | move, generalize | `rule check-shims [--manifest <path>]` | A two-sided shim ledger works for any migrating codebase; no manifest = pass |
| `coverage-certification.ts`, `coverage-provenance-check.ts` | move | `rule certify-coverage [--lcov <path>]` (write) + `rule check-coverage-cert [--lcov <path>]` (verify) | Certified LCOV makes the shipped `coverage-gate` trustworthy downstream |
| `run-tests.ts` | retain, reduced | calls `rule certify-coverage` after a canonical run | Hermetic env scrub (registry/credential/global layers) is this repo's suite policy |
| `test-suite-termination.ts` | retain | — | Child-termination proof for this repo's suite |
| `eval-pipeline.ts` | move, generalize | `workflow eval <pipeline>… [--fixture <template>]… [--runs n] [--label] [--keep] [--dry-run]` | Projects that write their own pipelines need an A/B comparison; fixtures resolve through the template layer |
| `workflow-promotion.ts` | move | `workflow promote-check`, `workflow promote-evaluate <id>`, `workflow promote-resolve <id>` (each with `--candidates <path>`) | Downstream workflow layers use the same candidate/deadline discipline; the evaluation core already lives in `packages/app` (A93) |
| `fleet-e2e.ts` `--host-probe` arm | move | `agent doctor-hosts [--real-hosts] [--agents <csv>] [--out <file>]` | Shipped `fleet-join` relies on it; host wake-channel capability is a runtime fact |
| `fleet-e2e*.ts` (other arms), `a2a-*-e2e.ts`, `delegate-workflow-e2e.ts`, `fixtures/**` | retain | — | Isolated multi-install fixtures and benchmark receipts; not runtime behavior |
| `dev-all.ts` | move, generalize | `builder.actions.dev: { parallel: [...] }` + `spur self exec dev` | Any project runs several dev processes; the Spur server+web topology becomes config (operator "move more") |
| `validate-commands.ts`, `validate-flag-contracts.ts`, `surface-drift-inventory.ts`, `skill-eval.ts`, `plugin-install-smoke.ts`, `script-contract-check.ts` | retain + Superskill note | — | They enforce sp-plugin contracts; generic plugin-quality checks belong to Superskill (`superskill <noun> evaluate`), noted per file |
| `scripts/spur-dev.ts` | shrink | — | Dispatches only retained entries; a retired name exits 2 naming its replacement |
| `scripts/install.sh` | retain | — | First-binary bootstrap (A93) |

The repository test (`repo-wide-tests/a93-script-ownership.test.ts`, extended for A94) regenerates the file list from git and fails on any file without a disposition, any moved file still present, or any retained file without a reason.

## 3. Package-build bootstrap

The A93 forwarders exist because importing the source CLI needs `apps/cli/config/`, a gitignored generated bundle (`.gitignore:80`). Target state:

1. **Make the source CLI boot without the generated bundle.** When the source CLI runs from a checkout, config resolution falls back to the tracked `config/` tree. Only the bundle step needs the bundle, and it writes it. If this holds, every package script becomes `bun run apps/cli/src/index.ts builder <verb>` and every forwarder is deleted.
2. **Fallback, if (1) breaks a shipped-path invariant:** keep one forwarder, `build-cli.ts`, as the single cold-boot step. It builds the CLI, and every later step uses it. The reason is recorded in the inventory.

**Refine finding (2026-11-20):** (1) already holds. `bundledConfigRoot()` walks up from `packages/config/src` and reaches the tracked `config/` (`packages/config/src/bundled-config.ts:38-48`). With `apps/cli/config` moved aside, the source CLI ran `builder --help` and `rule list` successfully. Task 1410 deletes every forwarder, and no fallback forwarder is kept.

Byte-equivalence with the pre-migration route is the acceptance proof (AC R3). `.github/workflows` is not edited. CI keeps calling package scripts, whose targets change underneath.

## 4. Contracts

- **Surface shape (operator rule, 2026-11-20):** every new A94 command is exactly `spur <noun> <verb>`. That means no nested subcommand group and no flag that switches the verb to a different operation. A second operation gets a composed verb (`<action>-<object>`, e.g. `doctor-hosts`, `check-coverage-cert`, `promote-check`). Flags only parameterize the one operation (`--json`, `--out`, `--lcov`, `--dry-run`). Positional operands are allowed. Existing commands that break the rule are out of scope here and are not copied.
- **Scope config:** a new `builder.dependencyScope: string[]` (globs; default `[]`, which skips linked-package checks). Spur's own config sets `['@gobing-ai/*']`. The hardcoded scope is removed.
- **Spur-package verbs** (`bundle-*`, `emit-*`, `build-cli`, `build-server`) resolve a Spur source root with `resolveSourceRoot`. Any other root exits 1 with the existing `runVerb` error `not a Spur source checkout: <marker> is missing (pass --source-root <dir>)` (`packages/app/src/builder/compile.ts:69`). There is one exit contract per noun. The 0/1/2 split below applies to check verbs only. A generic verb never guesses Spur paths.
- **Check verbs** (`builder check-deps`, `rule check-shims`, `rule check-coverage-cert`) exit 0 on pass, 1 on findings and 2 on usage errors. `--json` emits the standard findings envelope. Shipped presets reach them through the existing `exit-code` evaluator, so `ts-rule-engine` is unchanged. Promoting them to native evaluator types is deferred: that is a released-package change in ts-libs.
- **`builder.actions` parallel form:** `{ parallel: string[], graceMs?: number }`. It runs each entry (≥2 shell commands, never action names) in its own process group. SIGINT, SIGTERM or SIGHUP, the first child exit, or a spawn error triggers one shutdown: SIGTERM to every owned group, an unconditional `graceMs` wait (default 3000), then SIGKILL and exit. The exit code is the first-exiting child's code, or `128+signo` for a received signal, or 1 for a spawn error. This matches `dev-all.ts:23-48` (refine correction 2026-11-20). Composite (sequential) actions are unchanged. This is a config-schema change with a consumer (`self exec`), so `sdlc-actions.md` §reserved needs it.
- **`workflow eval`** keeps the `eval-pipeline` record shape (`wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode`, runCount/variance). Fixture task ids stay in a reserved range, inside a detached run-local worktree.
- **Promotion verbs** keep the current candidate-file schema and refusal semantics (zero-history refusal, strict-fewer bar, pinned baseline, contradicting resolve refused).

## 5. Consent request (ADR-051)

Owner: Robin. Status: **GRANTED 2026-11-19** (operator answer at the A94 design-approval gate, run `ec49bcbb`) for exactly C1–C10 below. The grant does not cover publishing, deployments, workflow/IAM edits or any surface outside this list. Exact scope:

| # | Surface | Kind | Replaces |
| --- | --- | --- | --- |
| C1 | `spur builder build-binaries` `--entry <file>` `--name <bin>` `--targets <csv>` `--out <dir>` | new flags | Spur-only compile |
| C2 | `spur builder verify-pack` `--require <member>` (repeatable); checks generalized off Spur members | new flag + behavior | Spur-only member list |
| C3 | `spur builder bundle-plugins`, `bundle-laya-worker`, `emit-board-types`, `emit-migration-sql` (+ `--json`/`--json-envelope`) | 4 new verbs | `spur-dev.ts` cases |
| C4 | `spur builder check-deps [--scope <glob>]…` + config `builder.dependencyScope` | new verb + config key | `link-check`, `dependency-drift-check` |
| C5 | `spur rule check-shims [--manifest <path>]` | new verb | `transition-shim-check` |
| C6 | `spur rule certify-coverage [--lcov <path>]`, `spur rule check-coverage-cert [--lcov <path>]` | 2 new verbs | `coverage-certification`, `coverage-provenance-check` |
| C7 | `spur workflow eval <pipeline>… [--fixture] [--runs] [--label] [--keep] [--dry-run]` | new verb | `eval-pipeline` |
| C8 | `spur workflow promote-check`, `promote-evaluate <id>`, `promote-resolve <id>` (`--candidates <path>`) | 3 new verbs | `spur-dev.ts promotion <op>` |
| C9 | `spur agent doctor-hosts [--real-hosts] [--agents <csv>] [--out <file>]` | new verb | `fleet-e2e --host-probe` |
| C10 | `builder.actions.<name>: { parallel, graceMs }` | config schema | `dev-all` |

**Shape amendment (2026-11-20, operator):** to satisfy the surface-shape rule in §4, C6's `--check` mode becomes the separate verb `check-coverage-cert` and C9's `doctor --hosts` becomes the verb `doctor-hosts`. The operator's instruction covers both renamed surfaces. Nothing else in the grant changes.

**Amendment 2 (2026-11-20, operator, refine of task 1412):** C6's `certify-coverage` becomes `spur rule certify-coverage [--lcov <path>] -- <command…>`. Certification is two-phase: a pre-run tree fingerprint, then certify after the run. So the verb wraps the test command:
- it opens the pending window;
- it spawns the argv with no shell, setting env `SPUR_COVERAGE_DIR` and substituting the argv token `{coverageDir}`;
- it certifies only if the child exits 0.

`--lcov` is the published certified LCOV path on both C6 verbs. The rejected alternatives were a separate `open-coverage-cert` verb and a single-shot certify-time fingerprint (weaker provenance).

Rejected shapes: `agent doctor --hosts` and `rule certify-coverage --check` (a mode flag acting as a hidden verb), a `dev` noun, `spur self exec <script>` pass-through, `workflow promotion <op>` (depth-3 group in disguise), native `ts-rule-engine` evaluators in this feature.

## 6. Waves and evidence

1. Inventory and dispatcher hygiene (R1, R14 usage fix). No public surface.
2. Bootstrap and builder Spur-package verbs (C3, §3), then rewire package scripts (R3, R5).
3. Generic builder (C1, C2, C4) with a non-Spur Bun fixture (R4, R6).
4. Rule checks (C5, C6) and `run-tests` reduction (R7, R8).
5. Workflow verbs (C7, C8) (R9, R10).
6. Agent host probe and dev supervisor (C9, C10) (R11, R12).
7. Shipped-surface scan, retained-gate Superskill notes, ADR/governance/help/parity sync, final audit (R13, R15).

For every wave: write the failing E2E first, then implement the shared owner, then prove the source CLI, the packed tarball and a standalone binary before deleting the script route. Each wave writes a repeatable receipt under `.spur/run/`. No publish, deployment or workflow edit.

## 7. Tradeoffs

The shipped runtime gains 13 verbs, 2 flag sets, 1 config key and 1 config form. The sp-plugin gates and test fixtures stay out of it. Check verbs reach presets through `exit-code`, which costs a process spawn per rule but avoids a cross-repo engine release. Spur-package verbs in `builder` are honest about being Spur-only (they fail fast elsewhere) rather than pretending to be generic. Taking them back out of the shipped CLI was rejected as A93 churn.

## 6. Receipt index

Feature A94 shipped in seven waves; every receipt is a per-task artifact under `.spur/run/`.

| Wave | Task | Shipped surface | Receipt |
| --- | --- | --- | --- |
| 1 | 1409 | A94 downstream-use inventory + dispatcher hygiene | `.spur/run/1409-receipt.md` |
| 2 | 1410 | `builder bundle-plugins`, `bundle-laya-worker`, `emit-board-types`, `emit-migration-sql`; package scripts route through the CLI | `.spur/run/1410-receipt.md` |
| 3 | 1411 | `builder build-binaries --entry`, `verify-pack --require`, `check-deps` | `.spur/run/1411-receipt.md` |
| 4 | 1412 | `rule check-shims`, `check-coverage-cert`, `certify-coverage` + two shipped presets | `.spur/run/1412-receipt.md` |
| 5 | 1413 | `workflow eval`, `promote-check`, `promote-evaluate`, `promote-resolve` | `.spur/run/1413-receipt.md` |
| 6a | 1416 | parallel `builder.actions` + `spur self exec dev` | `.spur/run/1416-receipt.md` |
| 6b | 1414 | `agent doctor-hosts` (report half; guest-join E2E stays a repository fixture) | `.spur/run/1414-receipt.md` |
| 7 | 1415 | shipped-surface scan, surface-shape guard, governance sync | `.spur/run/1415-receipt.md` |
