---
kind: design
title: Stack-neutral SDLC actions — builder.actions, spur self exec, and script-structure consolidation
status: proposed
created_at: 2026-10-16
updated_at: 2026-10-16
related:
  - docs/features/A92_stack-neutral-sdlc-actions-builder-actions-spur-self-exec-and-script-structure-consolidation.md
  - docs/design/harness-surface-governance.md
  - docs/design/configuration-contracts.md
  - docs/00_ADR.md#adr-139
tags: [builder, config, cli, scripts, portability]
---

# Stack-neutral SDLC actions

## 1. Issue and scope

Spur is a harness for any project, but its gates assume a bun + TypeScript + Biome repository.
Feature A92 (child of A9 placement contract) introduces a Spur-owned **SDLC action vocabulary**, a
per-project binding in `.spur/config.yaml` (`builder.actions`), and one executor
(`spur self exec <action>`). Spur's own gates and shipped workflows resolve commands through that
binding. The same vocabulary is the target shape for this repository's `package.json` scripts and
for the next pass of the `scripts/` / `plugins/sp/scripts/hooks` / `plugins/sp/lib` consolidation
(ADR-130, A91).

Status: **proposed**. Migrating superskill and knowledge-kit is follow-up work per repository.

## 2. Context and constraints

**Hard-coded bun in the engine and shipped workflows (observed 2026-10-16):**

| Location | Literal |
| --- | --- |
| `packages/app/src/services/quality-gate.ts:554-576` (light tier) | `bunx biome check <files>`, `bun run test-pre-check`, `bun run test-post-check`, `cd <ws> && bun run typecheck`, `cd <ws> && bun test <paths>`; `workspaceHasTypecheck` reads `package.json` |
| `config/workflows/task-pipeline.yaml:174,180` | `qualityGateCmd: "bun run spur-check"`, `gateProbeCmd: "bun run lint"` |
| `config/workflows/feature-verification.yaml:54`, `packages/app/src/workflow/feature-verification-run.ts:187` | `bun run spur-check-feature` |
| `config/workflows/wrapup-pipeline.yaml:132` | `jq '.scripts["test-repo-wide"]' package.json … bun run test-repo-wide` |
| `plugins/sp` commands/skills (≈30 files) | prose instructing `bun run spur-check`, `bun run gate`, `bun run lint` |

The full-tier commands can be replaced per run with `--vars`; the light-tier commands cannot be
replaced at all. A python + make project therefore cannot run the task pipeline's light gate.

**Cross-project survey (spur-new, superskill, knowledge-kit — all Spur-harnessed).** All three
repositories independently converged on the same `package.json` script names, with different
bodies:

| Script name | spur-new | superskill | knowledge-kit |
| --- | --- | --- | --- |
| `build`, `dev`, `format`, `autofix`, `lint`, `typecheck` | ✓ | ✓ | ✓ |
| `test`, `test:full` | ✓ | ✓ | ✓ |
| `test-pre-check`, `test-post-check` (+ `:full`) | ✓ | ✓ | ✓ |
| `spur-check`, `spur-check:full`, `gate` | ✓ | ✓ | ✓ |
| `check`, `check:full` | ✓ | ✓ | ✓ |
| `spur-check-feature` | ✓ | ✓ (`= spur-check`) | — (workflow uses `spur-check`) |
| `bump-ver`, `drop-tags` | ✓ | ✓ | ✓ |
| `test:heavy`, `spur-check-new`, `corpus-check`, contract checks | ✓ | partial | — |

**Common script layers.** Every file in the three trees falls into one of five layers:

| Layer | spur-new | superskill | knowledge-kit | Owning surface (ADR-130 reading) |
| --- | --- | --- | --- | --- |
| L1 build / package / release | `scripts/commands/build-*`, `bundle-*`, `emit-board-types`, `verify-pack`, `plugin-install-smoke` | `scripts/builder.ts`, `build-plugin-zip.ts` | `scripts/bundle-plugins.ts`, `build-board.ts`, `publish*.ts`, `verify-sp-install.ts` | repo `scripts/`; release plumbing that any project needs moves to `spur builder` |
| L2 test runner / coverage | `run-tests.ts`, `coverage-*` | — (inline in `package.json`) | — (inline) | repo `scripts/`, bound to `test*` actions |
| L3 repo contract checks | `link-check`, `script-contract-check`, `transition-shim-check`, `inline-pipeline-parity-check`, `dependency-drift-check`, `workflow-promotion`, `validate-*`, `surface-drift-inventory` | — | `check-tool-freshness.ts`, `rule-falsification-suites.test.ts` | repo `scripts/`, composed by `check-feature` |
| L4 dev runtime / eval | `dev-all`, `eval-pipeline`, `skill-eval`, `fleet-e2e` | — | — | repo `scripts/`, bound to `dev` / custom actions |
| L5 plugin runtime | `plugins/sp/scripts/hooks/*` + `plugins/sp/lib/*` | `plugins/cc/scripts/anti-hallucination/*` (+ `lib/env.ts`) | `plugins/kk/scripts/*-stages.ts` | plugin tree; standalone imports only |

Shared observations: (a) `plugins/sp/lib/env.ts` and superskill's
`anti-hallucination/lib/env.ts` are the same vendored env gateway (task 0669 standalone contract);
(b) test placement differs — spur-new colocates `*.test.ts` beside `scripts/commands/*.ts`, the
other two use `scripts/tests/`; (c) knowledge-kit's workflow-stage scripts are legitimate for a
third-party plugin and forbidden for `sp` only (ADR-130 §2 row `plugins/sp/scripts`).

## 3. Solution

### 3.1 The action vocabulary

Action names are kebab-case intents. Spur **consumes** the reserved names; projects may add custom
names that only `spur self exec` runs.

| Action | Intent | Consumed by | `bun` preset binding |
| --- | --- | --- | --- |
| `build` | produce shippable artifacts | — | `bun run build` |
| `dev` | run the local development loop | — | `bun run dev` |
| `clean` | remove build output | — | `bun run clean` |
| `format` | rewrite sources to the formatter's style | — | `bun run format` |
| `autofix` | format plus safe automatic fixes | task-pipeline pre-gate | `bun run autofix` |
| `lint` | static checks over the whole project (incl. typecheck when the stack has one) | task-pipeline `gateProbeCmd` | `bun run lint` |
| `typecheck` | type check the whole project | — | `bun run typecheck` |
| `test` | quick test suite | `check` composite | `bun run test` |
| `test-full` | full test suite with coverage | `check-full` | `bun run test:full` |
| `test-heavy` | slow / isolated-process proofs | `check-feature` | `bun run test:heavy` |
| `rules-pre` | Spur pre-check rule preset | light + full gate | `bun run test-pre-check` (preset `none` default: `spur rule run --preset recommended-pre-check --fail-on warning --no-logo`) |
| `rules-post` | Spur post-check rule preset | light + full gate | `bun run test-post-check` (preset `none` default: `spur rule run --preset recommended-post-check --fail-on warning --no-logo`) |
| `check` | task-local gate | task-pipeline `qualityGateCmd` | `bun run spur-check` |
| `check-full` | verbose task-local gate | — | `bun run spur-check:full` |
| `check-feature` | repo-wide gate, once per feature (ADR-119) | feature-verification | `bun run spur-check-feature` |
| `lint-changed` | lint the changed files `{files}` | light tier | `bunx biome check {files}` |
| `typecheck-changed` | typecheck one workspace `{workspace}` | light tier | `cd {workspace} && bun run typecheck` (only when the workspace `package.json` declares it) |
| `test-changed` | run related tests `{paths}` in `{workspace}` | light tier | `cd {workspace} && bun test {paths}` |

The `bun` preset bindings are exactly today's commands (legacy script names), so superskill and
knowledge-kit keep working with no config change. `rules-pre`/`rules-post` stay on the
`test-pre-check`/`test-post-check` scripts under `bun` because spur-new's `test-post-check` also runs
`coverage-provenance-check` first (`package.json:82`); the stack-neutral `spur rule run` bodies are
the `none`-preset defaults. The reserved set is closed in code
(`packages/config`); adding a reserved action is a schema change with a consumer.

### 3.2 Binding: `builder.actions` and `builder.preset`

```yaml
builder:
  preset: none            # bun (default) | none
  actions:
    build: make build
    lint: ruff check .
    typecheck: mypy src
    test: pytest -q
    test-full: pytest --cov
    lint-changed: ruff check {files}
    test-changed: pytest {paths}
    check: [lint, rules-pre, test, rules-post]   # composite: action names, run in order, fail-fast
    release: ./scripts/release.sh                # custom action: exec-only
```

Resolution for action `a`: `builder.actions[a]` → `preset[a]` → stack-neutral default
(`rules-pre`, `rules-post`, used by preset `none`) → **unbound**. `preset` defaults to `bun`, so a config without a
`builder` block resolves every reserved action to today's command (R11). `preset: none` exposes
only declared actions plus the stack-neutral defaults.

Values: a **string** is one shell command run by `/bin/sh -c` in the project root; a **list** is a
composite of action names (not raw commands), executed in order and stopping at the first non-zero
exit. Placeholders `{files}`, `{paths}`, `{workspace}` are allowed only in the three `*-changed`
actions; each substituted item is shell-quoted with the existing `shQuote`
(`quality-gate.ts:520`).

Load-time validation (Zod, `packages/config`): names match `^[a-z][a-z0-9-]*$`; composites
reference only resolvable actions; composite cycles are rejected with the cycle path; placeholders
outside `*-changed` are rejected. Errors name the key path.

### 3.3 Executor: `spur self exec`

```text
spur self exec <action> [-- <args...>]   run the action; exit code propagated
spur self exec --list [--json]           every reserved + declared action, resolved command, source
spur self exec <action> --dry-run        print the resolved command(s), run nothing
spur self exec <action> --dry-run --json print [{ name, command }] per resolved step, run nothing
```

- Runs in the project root with stdout/stderr inherited (the shared process seam never forwards
  stdin); sets `SPUR_ACTION=<name>` for the child.
- `-- <args>` are shell-quoted and appended to a string action; refused for composites.
- `--list --json` rows: `{ name, reserved, command | steps, source: config|preset|default|unbound }`.
- Unbound action → exit 2 with `action "<a>" is not bound; add builder.actions.<a> to .spur/config.yaml` (actionable error, no stack guess).
- Composite runs echo one `▶ <step>` line per step on stderr; `--json` (non-list) prints a final
  `{ action, steps: [{ name, exitCode, durationMs }], exitCode }`.

Placement: `self` owns project-local operations (`init`, `status`, `migrate`, `serve`,
`maintain`); `exec` lives in the `commands/self/` folder noun as
`apps/cli/src/commands/self/exec.ts`, registered through `registerSelfCommand`
(`apps/cli/src/commands/self/index.ts`) from the `selfCommand` block, with resolution in
`packages/app` (`services/sdlc-actions.ts`) so the quality gate and the CLI share one resolver.
Public-surface consent: the operator named `spur self exec <action>` in the A92 ask; the flags
above (`--list`, `--dry-run`, `--json`, `--`) are recorded here and need operator confirmation at
the implementing task's design review.

### 3.4 Consumers

| Consumer | Change |
| --- | --- |
| Quality gate light tier (`planLightChecks`) | resolve in-process (no `spur` subprocess) from `lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed`; an unbound scoped action is skipped with a `skipped:unbound` plan note, never replaced by a bun literal. Plan ids (`format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:<ws>`, `test:<ws>`) are unchanged. Test-scope discovery (`<ws>/tests/` split) is unchanged and stays bun-layout-shaped; a non-bun layout gets `test-changed` only once scope discovery learns it (follow-up) |
| Quality gate full tier / task-pipeline | `qualityGateCmd` default `${spurBin:-spur} self exec check`; `gateProbeCmd` default `${spurBin:-spur} self exec lint`; `formatCmd` default `${spurBin:-spur} self exec format`; `--vars` overrides still win. These vars run through `sh -c` (`quality-gate.ts:762`), and the CLI injects `spurBin` at run start, so the gate re-enters the same binary that drives the run, not whatever `spur` is first on `PATH` |
| feature-verification (YAML + `feature-verification-run.ts`) | default `spur self exec check-feature`. `verificationCmd` is launched through the safe argv splitter with no shell (`feature-verification-run.ts:219`), so `$spurBin` cannot expand there; `spur` resolves on `PATH`. The splitter invariant is kept; the action body that `self exec` runs is project-owned config, the same trust boundary as a `package.json` script today |
| wrapup-pipeline tripwire | run `$spurBin self exec test-repo-wide` only when `$spurBin self exec --list --json` shows it bound (spur-new declares it as a custom action) |
| `spur self init` | seed `builder.preset` + `builder.actions`: `bun` when `bun.lock`/`bun.lockb`; `none` + `make <target>` bindings for each matching Makefile target; commented skeleton otherwise |
| sp plugin commands/skills | replace "run `bun run spur-check`" with "run `spur self exec check`" (and `lint`, `check-feature`, `autofix`) |

### 3.5 This repository: `package.json` and `scripts/`

`.spur/config.yaml` keeps `preset: bun` and declares the custom actions it needs
(`test-repo-wide`, `plugin-smoke`, `corpus-check`, `eval`) so the dogfood exercises the map.

`package.json` review rules — every entry is exactly one of: (1) a **binding** of a reserved action
under its preset name, (2) a **composition** of other scripts with no inline logic, or (3) a
**repo tool** listed in the satellite table below. Remove exact duplicates with no caller:
`spur-check-new` and `spur-check-new:full` (= `spur-check` / `spur-check:full`), `check:full`
(= `check`), and fold `test-pre-check:full` / `test-post-check:full` into `--verbose` passthrough
(`spur self exec rules-pre -- --verbose`). References to removed names (AGENTS.md, plugin prose,
workflows) move in the same change.

`scripts/commands` gets one entry style: every command is reachable through
`bun scripts/spur-dev.ts <command>`; `package.json` stops calling `bun scripts/commands/<x>.ts`
directly (today 9 scripts do). Files with no runtime or package caller
(`surface-drift-inventory.ts`, `validate-flag-contracts.ts` — prose-only references) are either
registered with a caller or retired. Tests stay colocated (`*.test.ts` beside the module) — the
spur-new convention; the other repos may adopt it on their own migration. No folder reshuffle: the
L1–L4 layer is recorded in the `spur-dev.ts` header table, not encoded in paths.

`plugins/sp/scripts/hooks` + `plugins/sp/lib` already satisfy ADR-130 (A91); this feature only
re-runs the placement rule plus a reachability scan and removes anything dead.

## 4. Contract and compatibility

- **Default behavior is unchanged.** No `builder` block ⇒ `preset: bun` ⇒ the gate executes the
  same commands it does today (R11). Light-tier `typecheck-changed` keeps the
  `workspaceHasTypecheck` check under the bun preset only.
- **Overrides keep precedence:** explicit `--vars qualityGateCmd/gateProbeCmd/verificationCmd` and
  `spur task gate run --cmd` beat the action map.
- **Errors:** invalid `builder.actions` fails config load with the key path (same surface as other
  config errors); unbound action → exit 2; child non-zero → same exit code.
- **Schema:** `BuilderConfigSchema` gains `preset` and `actions`; `bump-ver` unchanged.
  `config.example.yaml` documents both.
- **Migration for other repos:** none required; to go stack-neutral a repo sets `preset: none` and
  declares its actions.

## 5. Tradeoffs and open questions

- **Why not `<runner> run <script>` over package.json?** It keeps the npm assumption; make/just/
  poetry have no `package.json`. The map is one indirection that covers every stack.
- **Why not runtime stack detection?** Unreliable in monorepos and invisible to the reader; detection
  is limited to `spur self init` seeding, where the result is written down and reviewable.
- **Why drop the `cmd-` prefix?** The `actions` map already scopes the key; bare intents read as the
  contract (`spur self exec check`).
- **Why composites as action names only?** Raw command lists would duplicate `&&` chains — the
  drift the survey found. Composites keep each command defined once.
- **Open:** whether `check-feature`'s repo-wide checks (L3) should become one composite per repo or
  stay a `package.json` chain — decide in the package.json task once the duplicates are gone.
- **Open:** a future `spur builder` absorption of L1 release plumbing shared by ≥2 repos
  (`bundle-plugins`, `verify-pack`) — out of scope here; tracked as a follow-up candidate.

Decision record: [ADR-139](../00_ADR.md#adr-139-sdlc-commands-resolve-through-a-project-bound-action-map).
