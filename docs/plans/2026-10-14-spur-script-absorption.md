---
kind: plan
title: Spur script absorption — scripts/, plugins/sp/{hooks,scripts,lib} → `spur <noun> <verb>`
status: partial — ready stack integrated; implementation tasks 1212 and 1213 remain
created_at: 2026-10-14
updated_at: 2026-10-15
tags: [plan, architecture, scripts, hooks, cli]
base: origin/main @ ed29340f8 (release 0.4.8)
superskill_base: origin/main @ a480736 (@gobing-ai/superskill 0.3.37)
related: [A9, A91, ADR-130, ADR-129, ADR-065, ADR-051]
---

# Spur script absorption plan

## Landing revision 2026-10-15 — integration and remaining work

This revision records the current delivery scope and supersedes conflicting layout, runtime and status statements below. The original inventory and proposals remain as historical evidence; they do not authorize restoring withdrawn surfaces. Task 1211 owns final acceptance, under existing active feature A91.

The operator requested one dev branch, comprehensive review/refinement, integrated quality gates and CI, then an ancestry-preserving merge to main and deletion of the new dev branch. This replaces the older per-PR merge-main/gate choreography. No rebases or force pushes are part of the landing.

| Item | Current disposition |
| --- | --- |
| PR-1 / #15 | Included in the reviewed landing batch #28: proven one-off deletions, test shim relocation, original plan. |
| PR-2a / #16, PR-2b / #18, PR-L / #17, splitting / #19 | Withdrawn; keep closed. No `spur self hook`, lazy-loading or splitting implementation. |
| S-1 as originally designed | Withdrawn. Replaced by generic superskill #3/#4, landed through superskill #5; hook logic remains plugin-owned. |
| PR-3 / #20 | Included in #28: task gate, residual and diffstat with their migrated callers/tests. |
| PR-4 / #21 | Included in #28: workflow inline and commit-guard. |
| PR-5 / #22 | Included in #28: task wrapup/preflight/batch-plan and feature verify/handoff. |
| PR-6 / #25 | Included in #28 after #20–#22; remaining generated bundles and bundle-plugin-lib retired. |
| PR-7 / #24 | Included in #28: builder PR operations and agent dogfood. |
| Hook conformance / #23 | Release-gated member of #28; final main landing requires the verified superskill release containing generic dispatch, native Pi adapters and staged timeout metadata. Pi/omp installations require reinstalling after upgrade. |
| PR-9 / #26 | Draft and unfinished. Task 1212 owns completion, coverage proof and the four known CLI help/reference/shared-option parity failures. |
| PR-8 | Task 1213, after 1212: retire exhausted script-root, generated/twin/build/baseline infrastructure and simplify distribution checks. **Landed 2026-10-15 (branch sp/runall-1212-1213-9fdf):** script-root.ts/.mjs, lib/spur-bin.ts, their tests, config/plugin-scripts.json and config/script-placement-baseline.json deleted; script-contract-check rewritten as the hook-only contract (placement findings fail raw); plugin-install-smoke scans hooks/lib/scripts uniformly strict; build:scripts removed; Superskill pins aligned at 0.3.39. surface-drift-inventory stays (I3 still `verifying`). |
| PR-10 | Closed as originally designed: no context shims remain to retire. Document Spur >=0.5.0; optional runtime version enforcement and diagnostics are explicitly deferred. No new manifest field or compatibility layer. |

**Remaining implementation is two cohesive tasks, not one task per file or gate.** Task 1212 completes the already-open release/cost migration; task 1213 owns the final distribution/retirement contract and depends on 1212. Each includes its callers, tests, help, matrix, coverage and gate receipts. The landing reviewer accepts their exact tested heads before merging. Task 1211 stays open until their results and the final cross-repo checks satisfy its original acceptance criteria.

**Current layout and inventory status.**

| Original inventory group | Current disposition and reason |
| --- | --- |
| §3.1 root script tooling and shim | Preserve the repository-only KEEP set with its recorded reasons; shim is now tests/shims/spur. |
| §3.2 proven one-off tools | Deletions included in PR-1. surface-drift-inventory remains only while I3 needs its reproducible inventory; task 1213 checks live feature status before deciding. |
| §3.2 release/cost/schema tooling | Migration is unfinished in #26, owned by task 1212. Existing repository promotion/cohort policy remains repository-owned. |
| §3.3 hook registry and executable entries | hooks/hooks.json stays the registry. Executable entries move to scripts/hooks/<id>.ts so native and flattened installations resolve the same plugin-owned implementation. The old Pi guard extension is retired through #23 after its superskill dependency is released. |
| §3.4 reusable non-hook skill scripts | Absorbed into existing task/feature/workflow/history/builder/agent CLI owners by the landing batch; no standalone generated compatibility bundle remains. |
| §3.4 script-root and build/placement infrastructure | Retired by task 1213 (2026-10-15): script-root and the manifest/twin/baseline/build machinery are deleted; canonical scripts/hooks entries remain. |
| §3.5 handwritten plugin libs | Keep env.ts and actual hook-only backing libs; remove migrated non-hook cores and generated bundles. spur-bin deleted by task 1213 (2026-10-15); its last consumer was its own test. |
| §3 generated twins/bundles and build wrappers | Absorption deletions are included; task 1213 removes the last exhausted infrastructure and records any retained project-only file reason. |

**Q1–Q7 disposition.** Q1: existing nouns only, with plugin-owned hooks run by superskill. Q2: retain the generic superskill hook runner. Q3: Spur is a hard skill/workflow prerequisite; hook runtime errors retain their documented fail-open policy. Q4: clean break in 0.5.0, with a documented minimum; optional runtime minimum-version diagnostics are deferred by the PR-10 closure decision. Q5: builder release plumbing remains approved and is completed by 1212. Q6: proven one-offs are deleted; surface-drift-inventory is conditional on I3, and repository-only link/drift/coverage gates retain their reasons. Q7: root and scripts bunfig.toml remain unchanged.

**Current final-acceptance interpretation of §12.** Preserve hooks/hooks.json, canonical scripts/hooks entries and hook-only libs; remove exhausted reusable non-hook infrastructure after 1212/1213. Unconfirmable PreToolUse asks deny on Codex/omp through superskill; runner errors/timeouts are a separate fail-open contract. Native and flattened installations must preserve declared hook timeouts with the runtime margin. Main acceptance requires resolved review findings, per-file coverage and successful integrated checks, not the older plan's raw deletion counts.

Only newly created integration/planning branches and worktrees are cleanup targets authorized here. Existing remote PR/abandoned branches are retained pending separate operator consent; the prior Linux /workspace worktrees are absent from this checkout.

## Revision 2026-10-15 (owner decision: new boundary)

- **Boundary.** superskill (separate repo) is the generic foundation for agent skills and hooks. spur is the harness toolkit.
- **Hooks stay in the sp plugin.** Their logic stays where it is on `main`:
  - `plugins/sp/hooks/*.ts` and `plugins/sp/hooks/pi/guard-extension.ts`;
  - their `plugins/sp/lib` backing (`agent-hint`, `context-owner`, `context-{post-tool,session-start,session-stop}`, `destructive-policy`, `task-file-policy`).
- **superskill runs the hooks.** It becomes a generic hook runner for them.
- **Hooks may call spur.** They may keep calling ordinary spur commands (for example `spur task resolve`), as they already do.
- **Withdrawn.** None of these will land:
  - **PR-2a** (`spur self hook` + hook logic ported to `packages/app/src/hooks`, #16);
  - **PR-2b** (plugin hooks routed through `spur self hook`, #18);
  - **PR-L** (lazy CLI command loading + ESM bytecode compile, #17);
  - **S-1 as designed** (superskill `spurDelegate` runners that delegate to `spur self hook`).
- **PR-10 is moot as designed.** It existed to remove the context transition shims, and with PR-2b withdrawn there are no shims to remove.
- **§5 (hook transport design) is superseded.** It is kept for the record only.
- **Unchanged.** SKILL scripts (`plugins/sp/scripts/*.ts`, their `.mjs` twins and their `lib`/generated bundles) are still absorbed into `spur <noun> <verb>` per §3.4/§4:
  - PR-review ops go under `spur builder`;
  - `builder publish` and `bump-ver --check` come later (PR-9).
- **New bases.** PR-3/4/5 no longer depend on PR-2a. They are re-landed directly on `main` as independent PRs.
- **Dispositions in §3.3 and §3.5 updated.** Every `plugins/sp/hooks/` file and the hook-only lib files are now **K**. Reason: owner boundary — hook logic belongs to the plugin and is run generically by superskill.
- **Superseded wording.** Where older text below says "ABSORB into `spur self hook`", this revision takes precedence.

> **Execution status (2026-10-15).** PR-1 and PR-2a are in review. **Owner decisions:** Q1 — **no new nouns**. Hooks run as `spur self hook <id> [--host …]` and `spur self hook list` under the existing `self` noun, and the PR-review ops go under `builder` (`spur builder pr <op>`). Q2–Q7 are confirmed as recommended. This revision rewrites the earlier `spur hook run` / `spur pr` proposals accordingly.
>
> **PR-1 keeps `surface-drift-inventory`.** I3 is still `verifying`, and its R1 ("a reproducible inventory") is produced by that tool. Per R11, its deletion moves to PR-8 or to I3 closure.


## 0. Summary

**Goal.** Move all reusable logic behind the `spur <noun> <verb>` CLI. Afterwards the plugin and repo script directories hold only:

| Directory | What remains |
| --- | --- |
| `plugins/sp/hooks/` | Unchanged (Revision 2026-10-15): `hooks.json`, every hook entry and `pi/guard-extension.ts` |
| `plugins/sp/scripts/` | **Nothing — deleted** |
| `plugins/sp/lib/` | `env.ts` plus the hook-only backing libs (Revision 2026-10-15) |
| repo-root `scripts/` | Spur-repo build, release and dev tooling only |

**Headline counts** (live tree; every file is listed in §3):

| Directory | Files | DELETE | ABSORB | THIN WRAPPER | KEEP | MOVE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `scripts/` (top level) | 5 | 0 | 0 | 0 | 4 | 1 (`test-shims/spur` → `tests/shims/`) |
| `scripts/commands/*.ts` (non-test modules) | 34 | 5 | 5 | 0 | 24 | 0 |
| `scripts/commands/*.test.ts` | 28 | 5 (subject deleted) | 3 (move with subject) | 0 | 20 | 0 |
| `plugins/sp/hooks/` | 9 | 0 | 0 | 0 | 9 (Revision 2026-10-15) | 0 |
| `plugins/sp/scripts/` (`.ts` sources) | 22 | 1 (`script-root`) | 21 | 0 | 0 | 0 |
| `plugins/sp/scripts/` (`.mjs` twins) | 22 | 22 (generated) | — | — | — | — |
| `plugins/sp/lib/` hand-written `.ts` | 14 | 2 (`inline-run-app`, `spur-bin`) | 4 | 0 | 8 (`env.ts` + 7 hook-only libs, Revision 2026-10-15) | 0 |
| `plugins/sp/lib/*.generated.{mjs,d.mts}` | 14 | 14 (generated) | — | — | — | — |

Note on hooks (Revision 2026-10-15): every hook file is KEEP. Hook logic belongs to the plugin and is run generically by superskill, so nothing under `plugins/sp/hooks/` moves into spur.

**Net effect.**

- About **77k lines of generated JavaScript** are removed: 39.4k in `.mjs` twins and 37.9k in `lib/*.generated.mjs`.
- About **9.9k hand-written plugin lines** move into `packages/app` and `apps/cli`.
- `bundle-plugin-lib.ts` (1053 lines) and its test are removed.
- `build:plugin-lib`, `build:scripts` and 22 `superskill script convert` calls are removed.
- The runtime contract becomes: **the sp plugin requires `spur` on PATH**.
  - Hooks fail open when it is missing.
  - Workflows and skills fail closed with an install hint.
- This *removes* a hidden Bun requirement. Today `inline-run-setup`, `inline-run-dispatch` and `feature-verification-steps` re-enter Bun even from their "portable" twins. The compiled `spur` binary (installed by `scripts/install.sh`) needs no Bun.

**Root `bunfig.toml`.** No step requires a change.

- The `scripts/**` coverage ignore still applies to the tooling that stays.
- The `plugins/sp/lib/*.generated.mjs` ignore becomes a harmless dead pattern. Removing it is optional cleanup and **needs owner approval** (Q7).
- `scripts/bunfig.toml` and `scripts/tsconfig.json` stay (§7.5).

---

## 1. Prior work: A9 and A91 (build on it, don't redo it)

### A9 — script placement contract (done)

"Script placement contract: CLI-owned logic, thin plugin glue, and pipeline check diet". Status **done** (2026-10-01). Plan: `docs/plans/A9-script-placement-migration.md`. Tasks 1000–1007, 1012–1014, 1016, 1018, 1019, 1034, 1035, 1037.

| Wave | What it did |
| --- | --- |
| W0 | Landed ADR-130 and the placement contract; added the `sp-script-placement` rule (`config/rules/boundary/sp-script-placement.yaml`, which runs `script-contract-check --placement-only`); seeded `config/script-placement-baseline.json` |
| W1 | Deleted `stage-registry-adapter` (1.5k LOC). Moved five repo-only gates (`surface-drift-inventory`, `validate-flag-contracts`, `validate-commands`, `inline-pipeline-parity-check`, `transition-shim-check`) from `plugins/sp/scripts` to `scripts/commands` |
| W2 | Absorbed scripts into CLI verbs and deleted them: `task-size-precheck` and `task-evidence-precheck` → `spur task check --precheck` (C1); `verify-answer-lint` → `spur task verdict` (C2); `idea-coverage-check` → `spur feature check --inventory` (C3); `feature-sync-bounded` and `record-feature-sync` → `spur feature sync` suppression (C4) |
| W3 | Moved the logic of `workflow-step-profile`, `history-anatomy-cache`, `quality-gate`, `residual-scan` and `inline-run-setup` into `packages/app`. The plugin reaches it through **generated lib bundles** (`plugins/sp/lib/*.generated.mjs`, built by `scripts/commands/bundle-plugin-lib.ts`) |
| W4 | Check diet, a single `script-root` resolver, a shared `lib/spur-bin.ts`, and action-budget targets |

Two consented flags were never used because the shapes did not fit: C5 (`workflow progress --profile`) and C6 (`history report --anatomy`). Neither exists in the CLI today (checked with `--help`).

### A91 — harness script ownership consolidation (tasks done)

"Harness script ownership consolidation and exception retirement". Status is active, but all tasks are done. The feature roster still shows 1178 as `wip` while the task file says `status: done`, so the roster is stale. Plan: `docs/plans/2026-10-11-harness-script-consolidation.md`.

| Task | What it did |
| --- | --- |
| 1173 | Enforcement and legacy cleanup: inlined `daily-summary/logger.ts`; removed `release.ts` (root `bump-ver`/`drop-tags` now forward to `spur builder`); moved the dogfood cores to `lib/dogfood-*` |
| 1174 | Hook helpers → `lib/`, hook tests → `tests/hooks/`, context cores → `lib/context-*` |
| 1175 | Evals → `scripts/commands/skill-eval.ts` and `plugins/sp/tests/evals` |
| 1176 | Planning admission/triage → `packages/app/src/services/planning-admission.ts`; feature receipt runner → `packages/app/src/workflow/feature-verification-run.ts` |
| 1177 | Shared `lib/inline-run-app.ts` loader; DB/DAO facade removed |
| 1178 | Run-summary and measurement queries → `packages/app/src/workflow/run-summary.ts` and `run-measurements.ts` |

### What is left (this plan)

A9 and A91 stopped at the same boundary. A91 §6 says:

> "An eventual owning-noun CLI transport remains operator-owned, separately approved work… Existing generated entries retain the named standalone packaging exception."

So the logic already lives in `packages/app`. What is missing is the **CLI transport**. That gap is why every plugin script still exists, along with the 7 generated bundles. One of them, `quality-gate.generated.mjs`, is 30.5k lines and embeds a second copy of the app.

This plan:

- adds the transports, then deletes the scripts, twins, bundles and the bundling step;
- absorbs pr-reviewing, daily-summary, dogfood and commit-guard, which A91 explicitly retained but the owner's rules now cover;
- adds a hook transport;
- moves the shared (not repo-only) `scripts/commands` items into the CLI.

A9 C5 and C6 are superseded by `spur workflow profile` and `spur history anatomy` (§4). The shape mismatch A9 found is exactly why they become separate verbs rather than flags.

---

## 2. Runtime model — how things run after the change, and why it is safe

### 2.1 Facts established from source

**1. Hooks today.** `plugins/sp/hooks/hooks.json` routes every hook through `superskill hook run sp <id>`. In superskill 0.3.37, `apps/cli/src/commands/hook-run.ts` behaves as follows:

- `HOOK_RUNNERS` registers only `sp/task-write-guard`, `sp/context-post-tool`, `sp/context-session-start`, `sp/context-session-stop` and `cc/anti-hallucination`.
- An unknown id **fails open** (exit 0 plus a stderr warning).
  - ⇒ **`sp/agent-lifecycle` and `sp/fleet-guest-stop` are wired in `hooks.json` but are no-ops for every installed host today.** Only Pi reaches `reportLifecycleHook`, via the extension. This is a live bug that this plan fixes.
- `sp/task-write-guard` is implemented **inside superskill** (`runSpTaskWriteGuard`). It shells to `spur task resolve --strict --json`, honours `SPUR_BIN`, and pre-filters with `couldBeTaskCorpusPath`.
  - It **never loads** `plugins/sp/hooks/task-write-guard.ts`, and Pi does not import that file either.
  - ⇒ The plugin file is dead at runtime; only its test runs it.
- `sp/context-*` **delegates in-process**. Running under Bun, it imports `hooks/context-{session-start,session-stop,post-tool}.ts` from the first location found in this order:
  1. `SPUR_PLUGIN_ROOT`
  2. `CLAUDE_PLUGIN_ROOT`
  3. the newest `~/.claude/plugins/cache/*/sp/<version>`

  It requires the exports `recordSessionStartFromPayloadText`, `recordSessionEndFromPayloadText` and `recordToolUseEvent`. If any are missing, it falls back to its own, drifted copies.
  - ⇒ **These file paths and export names are a contract with released superskill.** They cannot be deleted until the superskill floor moves (§5.2).
- Registry runners are first-party only and take no argv. A `HookRunner` may be async.

**2. Superskill guide.**

- Hooks stay on `hook run`. Staged hook paths (R6-B) have not shipped.
- "Do not assume Bun on targets."
- Repo-root `scripts/` is build/release only and is never installed.

**3. Workflows.** `config/workflows/*.yaml` ships to users through `bundle-config` and runs under `spur workflow run` or the host-inline driver.

- Every workflow already has a `spurBin` var (default `"spur"`).
- Every script call goes through `.spur/run/<runId>-script-root.json`, then `jq`, then `bun x.ts` or `node x.mjs`. `script-root.ts` exists only to pick that directory.
  - ⇒ Once the logic is called as `$spurBin <noun> <verb>`, `script-root` has no purpose.

**4. Skills and commands.** Files in `plugins/sp/{skills,commands}` already invoke `spur` directly **978 times across 108 files**. A project without `spur` cannot use the sp plugin in any meaningful way. The `superskill script path sp …` call sites are listed in §6.2.

**5. Distribution.** `spur` ships as an npm package (needs Bun) and as a compiled standalone binary (`scripts/install.sh`, no Bun). An installed `spur task resolve` takes about 120 ms (per a comment in `lib/task-file-policy.ts`).

**6. CLI nouns.** There is no hook verb. The current nouns are `agent builder decision feature history message projects rule self task workflow`. `builder` is documented as "Exactly two verbs, by explicit operator consent".

### 2.2 Target contract

**Hooks.**

- `hooks.json` keeps its shape: `superskill hook run sp <id>`, as owner rule 2 and the superskill guide require.
- The superskill sp runners collapse into one generic delegate. It:
  - spawns `${SPUR_BIN:-spur} self hook <id>`;
  - pipes stdin, and forwards stdout, stderr and the exit code;
  - applies a timeout;
  - **fails open** on spawn failure, on timeout, and when an old spur has no `self hook` verb.
- Host output shaping moves into spur. `--host` is auto-detected from `CLAUDE_PROJECT_DIR`.
- Superskill keeps its own `couldBeTaskCorpusPath` pre-filter, so ordinary edits do not pay for a spawn.

**Pi.** `hooks/pi/guard-extension.ts` stays as the one real wrapper.

- It has to stay because Pi loads a native TS extension from `plugin.json`, which `hooks.json` cannot express, and the guards need `ctx.ui.confirm` and `{block:true}` returns.
- It normalizes nothing itself: `spur self hook <id> --host pi` accepts the raw Pi event.
- Guards spawn synchronously.
- `tool_result` and session events spawn detached, so they add no latency to the turn.

**Workflows.** Replace `script-root` + `jq` + runner with `"$spurBin" <noun> <verb> …`.

- If an old spur lacks the verb, Commander exits 1 with "unknown command" and the step fails closed.
- That is the skew posture A9 accepted; releases are lockstep.

**Skills.** Replace `node "$(superskill script path sp X.mjs)" …` with `spur <noun> <verb> …`. These are one-liners, so owner rule 1 means no wrapper is allowed.

**No `spur` on PATH.**

- Hooks degrade to allow / no-op, the same as today's `task-write-guard`.
- Skills and workflows print `spur not found — install: npm i -g @gobing-ai/spur or curl …/scripts/install.sh | sh`.
- Document this in `plugins/sp/README.md` and in the `plugin.json` description (Q3).

---

## 3. Per-file inventory and disposition

**Legend:** **D** = DELETE · **A** = ABSORB into spur · **W** = thin wrapper stays · **K** = KEEP in `scripts/` (project-only) · **M** = MOVE.

"Callers" counts live references only. It excludes `docs/tasks*`, feature records, reports and CHANGELOG, which are historical and are not rewritten.

### 3.1 `scripts/` (top level)

| File | LOC | What it does | Callers | Disp. | Target / strong reason |
| --- | ---: | --- | --- | :-: | --- |
| `bunfig.toml` | 11 | Test preload for this workspace (`../tests/setup.ts`), so `(cd scripts && bun test …)` gets the hermetic setup | AGENTS.md convention "run targeted tests inside their workspace"; same pattern as the `apps/cli`, `packages/app` and `plugins/sp` bunfigs | K | Without it, targeted runs in `scripts/` lose logger muting and config hermeticity (task 1127 R8). `scripts/` keeps 24 modules with tests, so the need remains. This is not the root bunfig, so no approval is needed |
| `install.sh` | 99 | End-user installer: downloads the release binary, verifies SHA256SUMS, swaps it in atomically, runs `spur init` | Published URL `https://raw.githubusercontent.com/gobing-ai/spur/main/scripts/install.sh` in `README.md:82` and `apps/cli/README.md:46,55`; asset names in `build-binaries.ts`; `install-sh.test.ts` | K | The path is a **published URL contract** (`curl …/main/scripts/install.sh \| sh`). Moving it breaks every copied install line. It is release distribution tied to spur's own asset names, with no reuse value |
| `spur-dev.ts` | 135 | Dispatcher for repo tooling, one line per command | Root `package.json` (`bundle:config`, `link-check`, `fleet-e2e`, `workflow-promotion-check`); `apps/cli/package.json` (`build`, `build:binaries`, `build:bundle`, `prepublishOnly`); `apps/server/package.json` (`build`); `publish.yml:85` | K (shrinks) | Single entry point for the remaining repo build and dev commands. The `publish`, `check-marketplace-version`, `real-run-cost` and `check-pipeline-budgets` cases are removed (§3.2) |
| `test-shims/spur` | 18 | POSIX shim: a bare `spur` in test children runs this checkout's `apps/cli/src/index.ts` | `tests/setup.ts:127` (PATH prepend), `scripts/commands/run-tests.ts:66`, `apps/cli/tests/test-shim-launcher.test.ts`, `docs/design/configuration-contracts.md` | M → `tests/shims/spur` | Test-only helper; it belongs next to `tests/setup.ts`. Update 3 code references and 1 doc. Its anchor `$(dirname "$0")/../..` still resolves to the repo root from `tests/shims/` |
| `tsconfig.json` | 7 | Typecheck project for `scripts/**/*.ts` | Root `typecheck`: `tsc -p scripts/tsconfig.json --noEmit` | K | `scripts/` keeps TS modules. Without this file they are not typechecked: there is no workspace package.json, so `--filter '*' typecheck` misses them |

### 3.2 `scripts/commands/` (modules; tests follow in the "Tests" column)

| File | LOC | What it does | Callers | Existing spur equivalent | Disp. | Target / strong reason | Tests |
| --- | ---: | --- | --- | --- | :-: | --- | --- |
| `build-binaries.ts` | 85 | Cross-compiles `spur-<os>-<arch>` plus `SHA256SUMS` | `apps/cli` `build:binaries` → `spur-dev` | none | K | Compiles *this* CLI into *this* repo's release asset names, which `install.sh` and desktop staging consume. No reuse value | `build-binaries.test.ts` (33) K |
| `build-cli.ts` | 126 | Patches ts-runtime's variable dynamic import, then runs `bun build --compile` on the local spur | `apps/cli` `build` | none | K | Workaround for this repo's ts-runtime/ts-db compile layout | — |
| `build-server.ts` | 10 | Compiles the standalone server through the shared native-DB facade | `apps/server` `build` | none | K | Repo build step. It calls a TS facade, so it cannot be inlined into package.json | — |
| `bundle-config.ts` | 104 | Copies `config/` into the npm tarball and injects `$schema` | `bundle:config`, the `test*` scripts, `apps/cli build:bundle` | none | K | Packaging for this repo's tarball layout | `bundle-config.test.ts` (195) K |
| `bundle-plugin-lib.ts` | 1053 | Generates the 7 `plugins/sp/lib/*.generated.mjs` bundles from `packages/app` | `build:plugin-lib`, `build:scripts`, `apps/cli build:bundle` | — | **D** (PR-8) | Exists only so plugin scripts can run app logic without the CLI. Once every caller uses `spur <noun> <verb>`, no bundle has a consumer. Evidence: every importer of `*.generated.mjs` is a plugin script or lib that is being absorbed (§3.4/§3.5) | `bundle-plugin-lib.test.ts` (270) D |
| `bundle-plugins.ts` | 61 | Stages `plugins/` and `.claude-plugin/` into `apps/cli` for npm | `apps/cli build:bundle` | none | K | npm tarball layout for this repo. Its prune filter loses the twin and bundle special cases | `bundle-plugins.test.ts` (93) K (update: no `scripts/`) |
| `bundle-web.ts` | 166 | Copies `dist/web` and the board runtime manifest into the CLI tarball | `apps/cli build:bundle` | none | K | Repo packaging | `bundle-web.test.ts` (177) K |
| `check-marketplace-version.ts` | 79 | Fails publish if the version in `.claude-plugin/marketplace.json` or `plugins/sp/plugin.json` differs from `apps/cli` | `apps/cli prepublishOnly` | `spur builder bump-ver` already **writes** these same files (`syncMarketplaceAndPlugins`, `apps/cli/src/release-ops.ts:401`) | **A** (Q5) | `spur builder bump-ver --check [target]`, the read-only twin of the sync that builder already owns. Any repo that releases a marketplace with `builder` can reuse it. Replace the hard-coded paths with the existing marketplace plugin list. Logic → `apps/cli/src/release-ops.ts`. Caller: `prepublishOnly` → `bun run ../../apps/cli/src/index.ts builder bump-ver --check spur` | new tests in `apps/cli/tests/release-ops.test.ts` |
| `coverage-certification.ts` | 303 | Certifies the `.coverage/lcov.info` bytes plus a tree fingerprint, so the post-check refuses stale coverage | Imported by `run-tests.ts` and `coverage-provenance-check.ts`; comment in `config/rules/quality/coverage-gate.yaml` | none | K | Protects the integrity of this repo's own gate (`run-tests --publish-coverage`). Coupled to the repo's launcher and lcov layout | `coverage-certification.test.ts` (479) K |
| `coverage-provenance-check.ts` | 29 | Post-check precondition: refuse uncertified coverage | `test-post-check`, `test-post-check:full` | none | K | Same reason as above; a 29-line gate entry | (covered by `coverage-certification.test.ts`) |
| `dependency-drift-check.ts` | 162 | Compares the locked `@gobing-ai/ts-*` versions in `bun.lock` with what is installed in `node_modules` | `dependency-drift-check` script (only in `spur-check-feature` / `:full`) | none | K | Guards this repo's ts-libs catalog pin and link workflow. Not spur's domain (Q6 covers the alternative) | `dependency-drift-check.test.ts` (209) K |
| `dev-all.ts` | 49 | Runs server and web together; kills only the process groups it owns | Dev use, through `spur-dev` | `spur self serve` serves the built board, not the dev pair | K | Dev loop for this monorepo's two apps | `dev-all.heavy.test.ts` (131) K |
| `emit-board-types.ts` | 106 | Emits `apps/cli/board/index.d.ts` from `apps/web/src/modules/contribution.ts` | `apps/cli build:bundle` | none | K | Repo packaging ("not a public noun", ADR-051) | `emit-board-types.test.ts` (44) K |
| `eval-pipeline.ts` | 695 | Runs fixture tasks (`tests/fixtures/pipeline-eval`) through candidate pipelines and records cost and outcome | `spur-dev eval-pipeline`; `workflow-promotion` | `spur workflow run` (single run only) | K | Repo self-improvement harness bound to this repo's fixtures and its WBS 95xx scratch worktrees. Its DB reads should go through the app `run-measurements` service (already true since 1178) | `eval-pipeline.test.ts` (365) K |
| `fleet-e2e.ts` | 1403 | End-to-end proof of the inbox fleet in a scratch project; writes `docs/reports/fleet-e2e-receipt.json` | `fleet-e2e` script | none | K | Repo-owned acceptance receipt for G71. It imports domain DAOs on purpose (white-box proof) | (none; its receipt is the evidence) |
| `history-latency-measure.ts` | 183 | E91 protocol for History-tab latency (median of N runs) | **none** (cited only by `docs/report/2026-09-03-E91…` and the A91 plan) | — | **D** (PR-1, Q6) | One-off E91 measurement. E91 is `done` and its baseline is recorded in `docs/report/`. No `package.json`, CI or skill caller | `history-latency-measure.test.ts` (99) D |
| `history-surface-freeze-check.ts` | 185 | E91 gate that diffs against the merge base to enforce "the History UI must not change" | `history-surface-freeze-check` script, used only by `spur-check-feature`, `spur-check:full` and `spur-check-new:full` | — | **D** (PR-1, Q6) | It freezes a surface for a feature that is now `done`; keeping it blocks any legitimate History UI change. Remove it from the three chains | `history-surface-freeze-check.test.ts` (144) D |
| `importer-schema-check.ts` | 98 | Checks, and auto-repairs, the importer schema version in `.spur/spur.db` against the installed importer | `importer-schema-check` script (feature chains) | `spur self migrate` applies CLI migrations, but does not report drift or repair the importer ledger | **A** | `spur self migrate --check` reports drift and exits 1; `spur self migrate` also runs `repairImporterSchemaVersion`. This is DB health for **any** spur project, not repo tooling. The logic is already in `packages/domain/src/analytics/importer-schema-version.ts`. Callers: package scripts → `bun run apps/cli/src/index.ts self migrate --check` | test → `apps/cli/tests/commands/self-migrate.test.ts` |
| `inline-pipeline-parity-check.ts` | 298 | Two-sided set diff between the action/guard kinds documented for the inline driver and those used in `config/workflows/*.yaml` | `inline-pipeline-parity-check` script | none | K | Checks this repo's sp driver doc against this repo's shipped YAMLs (authoring gate, A9 W1) | `inline-pipeline-parity-check.test.ts` (109) K |
| `link-check.ts` | 133 | Fails when a `bun link`-ed `@gobing-ai/*` package serves a `dist/` older than its `src/` | `link-check` script; `spur-check-feature` | none | K | Guards this repo's local `../ts-libs` link workflow (Q6) | `link-check.test.ts` (128) K |
| `pipeline-budgets.ts` | 299 | Gates measured pipeline cost against `config/pipeline-budgets.json` | `spur-dev check-pipeline-budgets` | The app's `readWorkflowMetrics` (`packages/app/src/workflow/run-measurements.ts`) already does the measuring | **A** | `spur workflow cost --budget <file>`: a budget gate over the same measurement, usable by any spur user against their own budget file. The policy *data* stays in this repo: `config/pipeline-budgets.json` is a monorepo dev baseline that `bundled-config.ts` excludes. Package script `check-pipeline-budgets` → `spur workflow cost --budget config/pipeline-budgets.json` | test → `packages/app/tests/workflow/run-cost.test.ts` |
| `plugin-install-smoke.ts` | 120 | Release gate: scans plugin imports for standalone safety, then runs `superskill install --dry-run` on a marketplace snapshot | `plugin-smoke` script; `publish.yml`; `builder bump-ver` (`release-ops.ts:151`) | none | K (simplify in PR-8) | Proves that *this* repo's plugin installs. After absorption it only needs to scan `hooks/pi/*.ts` and `lib/env.ts` | — |
| `publish.ts` | 113 | Resolves `workspace:`/`catalog:` ranges, builds, runs `npm publish` (OIDC) | `publish.yml:85` (`spur-dev publish apps/cli`) | none | **A** (Q5) | `spur builder publish <package-dir> [--otp]`. Generic for any Bun-workspace monorepo released with `spur builder`; this is release plumbing, which is the builder noun's charter. Logic → `apps/cli/src/release-ops.ts`, next to bump-ver. If Q5 is declined: **K** | new tests in `apps/cli/tests/release-ops.test.ts` (none exist today) |
| `real-run-cost.ts` | 209 | Per-workflow wall-clock time and cost from real runs (`--workflow --by-state --since --json`) | `spur-dev real-run-cost`; referenced by `fleet-e2e` and `workflow-promotion` | The app's `run-measurements.ts` and the domain's `workflow-measurements.ts` (1178 moved the queries there) | **A** | `spur workflow cost [--workflow …] [--by-state] [--include-bookkeeping] [--since] [--json]`. Measuring a user's own workflow runs is product functionality. Logic → `packages/app/src/workflow/run-cost.ts`; CLI → `apps/cli/src/commands/workflow/cost.ts` | `real-run-cost.test.ts` (565) → `packages/app/tests/workflow/run-cost.test.ts` |
| `run-storage-census.ts` | 61 | Checks that a reviewed E71 ripgrep census JSON still matches | **none** (A91 plan only) | — | **D** (PR-1, Q6) | One-off check of a review artifact. No script, CI or test caller | — |
| `run-tests.ts` | 139 | Hermetic test launcher: env, PATH shim, coverage publication | `test`, `test:heavy`, `test:coverage`, `test:full`, `test-repo-wide` | none | K | The repo's own test entry. Update the shim path to `../../tests/shims` | (via coverage tests) |
| `script-contract-check.ts` | 829 | Gate over `plugins/sp/scripts` that keeps manifest, twins and placement consistent | `script-contract-check` script; `sp-script-placement.yaml` rule; `dev-verify(all)` docs | — | K (**rewrite**, PR-8) | Becomes the placement guard for the new contract: `plugins/sp/scripts/` must not exist; `hooks/` holds only `hooks.json` and `pi/`; `lib/` holds only `env.ts`; shipped docs and YAML contain no `superskill script path sp` and no `bun plugins/sp/`. The twin and manifest halves are deleted (about −600 LOC) | `script-contract-check.test.ts` (858) K (shrinks) |
| `skill-eval.ts` | 199 | Behavioral eval runner for skills (fixture tier and live tier) | `eval` script | none | K | Repo dev harness (placed here by A91 1175); it judges this repo's plugin skills | `skill-eval.test.ts` (120) K |
| `surface-drift-inventory.ts` | 894 | One-shot I3 inventory of drift between plugin docs and the live CLI | **none** (docs only) | `plugins/sp/tests/cli-surface-parity.test.ts` is the standing gate | **D** (PR-1, Q6) | Nothing invokes it; the test is the standing parity gate. Delete once I3 (currently `verifying`) closes; if I3 still needs it, postpone the deletion to PR-8 | `surface-drift-inventory.test.ts` (851) D |
| `transition-shim-check.ts` | 241 | Two-sided gate between `@transition-shim(id)` markers and `config/transition-shims.json` | `transition-shim-check` script | none | K | Governs this repo's own manifest | `transition-shim-check.test.ts` (153) K |
| `validate-commands.ts` | 689 | Validates `plugins/sp/commands/*.md` against the thin-wrapper contract | `validate-commands` script; `command-contract.test.ts` | none (superskill's `skill validate` is generic) | K | The heading and flag contract is sp-specific and applies to this repo's command docs | `command-contract.test.ts` (1303) K |
| `validate-flag-contracts.ts` | 890 | Checks that flag claims agree across commands, glossary, cross-cutting, dev-operations and ADR | `flag-contract-parity.test.ts`, `inline-execution-contract.test.ts` (no package script) | none | K | Authoring gate over this repo's docs. Moving it under `tests/` would put 890 lines under the 90/90 per-file gate for no benefit, whereas `scripts/**` is coverage-ignored. Optionally add a `validate-flag-contracts` package script for symmetry | `flag-contract-parity.test.ts` (594), `inline-execution-contract.test.ts` (449) K |
| `verify-pack.ts` | 100 | Asserts the packed `.tgz` ships `plugins/sp` and the marketplace with matching versions and no tests | `spur-dev verify-pack` | none | K | Checks this repo's tarball layout (plugin name `sp`, `apps/cli`) | `verify-pack.test.ts` (40) K |
| `workflow-promotion.ts` | 694 | ADR-076 promotion and retirement records for workflow candidates (`config/workflow-candidates.json`) | `workflow-promotion-check` script | none | K | Spur's own definition-governance policy. After PR-9 it should call `spur workflow cost --json` instead of opening its own DB adapter | `workflow-promotion.test.ts` (610) K |

Test-only files (no module of the same name):

| Test | LOC | Subject | Disp. |
| --- | ---: | --- | :-: |
| `command-contract.test.ts` | 1303 | `validate-commands.ts` | K |
| `flag-contract-parity.test.ts` | 594 | `validate-flag-contracts.ts` | K |
| `inline-execution-contract.test.ts` | 449 | `validate-flag-contracts.ts` plus the command docs | K |
| `install-sh.test.ts` | 127 | `install.sh` | K |
| `release-alias.test.ts` | 96 | Root `bump-ver`/`drop-tags` forwarding to `spur builder` | K |

### 3.3 `plugins/sp/hooks/`

| File | LOC | What it does | Runtime callers (evidence) | Spur equivalent today | Disp. | Target |
| --- | ---: | --- | --- | --- | :-: | --- |
| `agent-lifecycle.ts` | 155 | Maps the host event to `idle`/`working`/`blocked`; when `SPUR_SPEC_ID` is set, spawns a detached `spur agent report --state --seq` | Wired in `hooks.json` for 4 events, **but superskill has no `sp/agent-lifecycle` runner, so it is a no-op today**. The Pi extension imports `reportLifecycleHook` | `spur agent report` (the side effect) | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `careful-guard.ts` | 74 | PreToolUse `ask` before destructive Bash commands | **Not wired** (README: "opt-in, unwired"). Pi uses `lib/destructive-policy` directly | none | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-post-tool.ts` | 28 | stdin adapter → `recordToolUseEvent` in `lib/context-post-tool` | `hooks.json` PostToolUse. **Superskill imports this file path in-process and needs the export `recordToolUseEvent`** | `TokenLedgerService` reads the ledger (`packages/app/src/services/token-ledger-service.ts`) | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-session-start.ts` | 19 | stdin adapter → `recordSessionStartFromPayloadText` | Same as above (export `recordSessionStartFromPayloadText`) | — | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-session-stop.ts` | 19 | stdin adapter → `recordSessionEndFromPayloadText` | Same as above | — | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `fleet-guest-stop.ts` | 180 | On Stop, delivers a joined guest's pending fleet inbox (`decision:block`) | `hooks.json` Stop, **but no superskill runner, so a no-op today** | `spur agent wait --inbox` plus `spur message inbox` (it shells out to both) | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `hooks.json` | 95 | Canonical hook config | superskill install (native and rulesync) | — | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `pi/guard-extension.ts` | 304 | Native Pi extension: write guard, careful guard, context capture, lifecycle | `plugin.json` `extensions.pi` (Pi loads it in-process) | — | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `task-write-guard.ts` | 89 | PreToolUse: denies a raw Write/Edit to a task file | **No runtime caller.** Superskill implements `sp/task-write-guard` itself (`runSpTaskWriteGuard`) and never loads this file; Pi imports `lib/task-file-policy`, not this file | `spur task resolve --strict --json` | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |

### 3.4 `plugins/sp/scripts/` (all invoked via `superskill script path` / `script-root`; `.mjs` twins listed after)

| Source | LOC (.ts / .mjs) | What it does | Callers | Logic already in app? | Disp. | New command (noun = existing unless marked) |
| --- | ---: | --- | --- | --- | :-: | --- |
| `batch-plan.ts` | 145 / 1096 | Batch planning: waves, dependency order, task-children projection | `dev-runall.md`, `execution-batch.md` (×6), `execution-parallel-isolation.md`, `parallel-execution/SKILL.md` | yes, `workflow/plan-projection.ts` | A | `spur task batch-plan <waves\|order\|task-children> --tasks <f> [--concurrency n] [--letter X --plan f]` (sibling of `task batch-create`) |
| `batch-preflight.ts` | 270 / 423 | TABLE A preflight, quick readiness check, recovery hint | `super-planner.md`, `dev-runall.md`, `routing-table.md`, `execution-batch.md`, … (11 doc refs) | yes, `services/planning-admission.ts` | A | `spur task preflight <wbs> [--operation run\|refine\|verify] [--recovery] [--quick] [--json]`. Reads status, deps and sections from the corpus itself; the old `--status`, `--deps`, `--dep-status` and `--present-sections` stay accepted as overrides for one release |
| `commit-guard.ts` | 248 / 226 | Refuses commits that would sweep up other writers' changes (`start`/`stage`/`check --run`) | `inline-pipeline-driver.md`, `execution-worktree-setup.md`, `execution-worktree-landing.md`, `execution-batch-report.md` | no (git logic) | A | `spur workflow commit-guard <start\|stage\|check> --run <id> [--base] [-- paths…]`. Logic → `packages/app/src/workflow/commit-guard.ts`; its run-scoped `.spur/run` bookkeeping belongs with workflow runs |
| `daily-summary/daily-summary.ts` | 855 / 626 | Daily markdown report: ccusage tokens, git commits, annotations, history health | `daily-summary/SKILL.md` (×3), `dev-daily.md` | partly (`readHistoryHealth`, via the inline bundle) | A | `spur history summary [--date d] [--dry-run] [--output p] [--no-ccusage]`. Logic → `packages/app/src/services/daily-summary.ts` (the history owner, per A91 P7) |
| `dogfood-testing/detect-pipeline-driving.ts` | 110 / 211 | Refuses a testee that drives a pipeline without `--max-retry` (exit 2) | `dogfood-testing/SKILL.md` (×4) | no (`lib/dogfood-pipeline.ts`) | A | `spur agent dogfood gate --testee "…" [--max-retry-present] [--steps …] [--json]` (Q1) |
| `dogfood-testing/validate-report.ts` | 98 / 282 | Validates a dogfood report against the @1.2 contract | `dogfood-testing/SKILL.md`, `references/report-template.md` | no (`lib/dogfood-report.ts`) | A | `spur agent dogfood validate-report --file <md> [--json]` |
| `feature-verification-steps.ts` | 164 / 82 | Runs the feature-verification pass and writes the receipt (re-enters Bun) | `config/workflows/feature-verification.yaml` | yes, `workflow/feature-verification-run.ts` | A | `spur feature verify <id> --run-id <id> [--cmd "<gate>"]` |
| `history-anatomy-cache.ts` | 247 / 931 | Cache CLI with 8 ops: digest, check, paths, assert-clean, probe, stamp, refresh, publish | `config/workflows/history-anatomy.yaml` (×9), `config/workflow-candidates.json` | yes, `services/history-anatomy.ts` | A | `spur history anatomy <op> …` (supersedes the unexercised A9 C6) |
| `idea-handoff.ts` | 47 / 32 | Finalizes the idea pipeline: report, dependency ordering, roster refresh | `config/workflows/idea-pipeline.yaml` | yes, `workflow/idea-handoff-cli.ts` | A | `spur feature handoff <featureId> --run-id <id>` |
| `inline-run-dispatch.ts` | 115 / 131 | Records host-inline attribution or dispatch failure | `inline-pipeline-driver.md` | yes, `recordInlineRunAttribution` and `runInlineRunDispatchFailure` | A | `spur workflow inline attribution …` / `spur workflow inline dispatch-failure …` |
| `inline-run-setup.ts` | 198 / 746 | Host-inline run lifecycle: begin, fingerprint, action, node-enter, actions-file, close, decide, persist-out | `inline-pipeline-driver.md`, `structured-trace-emission.md`, `execution-*`, `spur-check/SKILL.md`; app services mention it | yes, `services/inline-run-setup.ts` | A | `spur workflow inline <begin\|fingerprint\|action\|node-enter\|actions\|close\|decide\|persist-out> …`. Fills the gap A91 §6 named: an "installed CLI transport for host-inline lifecycle" |
| `persist-out-check.ts` | 249 / 217 | WT-4 assertion that evidence has been persisted before a worktree is removed | `execution-worktree-landing.md` | no | A | `spur workflow inline persist-check --from <wt> …` (pairs with `persist-out`) |
| `pr-reviewing.ts` | 952 / 712 | GitHub Codex PR-review loop: preflight, push, ensure-pr, hygiene, request, wait, collect, status | `config/workflows/pr-review.yaml` (×8), `pr-reviewing/SKILL.md`, `dev-pr-review.md` | no | A | **New noun:** `spur pr <preflight\|push\|ensure\|hygiene\|request\|wait\|collect\|status>` (Q1; fallback `spur workflow pr-review <op>`). Logic → `packages/app/src/services/pr-review/` |
| `quality-gate.ts` | 80 / 30491 | Task-pipeline test gate: run, recheck, light, deferred, status | `task-pipeline.yaml` (×4), `spur-check/SKILL.md`, `gate-checklists.md`, `secu-review.md` | yes, `services/quality-gate.ts` | A | `spur task gate <wbs> <run\|recheck\|light\|deferred\|status>`. Takes flags and also reads the same env names (`qualityGateCmd`, `gateProbeCmd`, `proofDigest`, `runId`) |
| `residual-scan.ts` | 248 / 634 | F96 residual scan, fold, settle, report, review-gate | `task-pipeline.yaml` (×8), `code-verification/SKILL.md`, `dev-verify(all).md`, `super-reviewer.md` | yes, `services/residual-scan.ts` | A | `spur task residual <wbs> <scan\|fold\|settle\|report\|review-gate>` (follows the `task deps <wbs> <op>` precedent) |
| `run-summary.ts` | 107 / 758 | Measured execution summary from progress plus transcript, or from close-summary rollups | `execution-batch-report.md`, `dev-operations.md`; `inline-run-setup` imports its `writeCloseSummary` | yes, `workflow/run-summary.ts` | A | `spur workflow summary (--progress … \| --rollup …) [--transcript] [--since] [--markdown]`. `writeCloseSummary` runs inside `workflow inline close` |
| `script-root.ts` | 199 / 129 | Records which script tree a run resolved | The first action of all 6 workflows; `inline-pipeline-driver.md` | — | **D** | Obsolete once no workflow resolves a script path, because workflows call `$spurBin`. Removing it also removes one onEnter action per workflow (update the action-budget test) |
| `session-timeline.ts` | 190 / 359 | Per-prompt work time, wait time and tokens from the host transcript | `session-review/SKILL.md` (×2), `dev-review-session.md` | partly (`transcript.ts` in lib) | A | `spur history timeline [--transcript p] [--group "1-3,4"] [--json]` |
| `task-diffstat.ts` | 219 / 181 | Diff evidence plus the SENSITIVE lane flag → `.spur/run/<wbs>-diffstat.json` | `task-pipeline.yaml` (triage), `inline-pipeline-driver.md` | partly (SENSITIVE list in plan-projection; `workflow/task-triage.ts`) | A | `spur task diffstat <wbs> [--out]` (writes the same artifact atomically) |
| `workflow-step-profile.ts` | 165 / 338 | Per-node step profile across the last N runs | `spur-doctor/SKILL.md` (×3) | yes, `workflow/step-profile.ts` | A | `spur workflow profile <workflow> [--last n] [--window-sec s] [--json]` (supersedes A9 C5) |
| `wrapup-drift-probe.ts` | 261 / 190 | Probe for doc-ownership drift → `<runId>-drift-probe.json` and mode | `wrapup-pipeline.yaml`, `config/workflow-candidates.json` | no | A | `spur task wrapup drift-probe --run-id <id>` |
| `wrapup-steps.ts` | 891 / 627 | Wrap-up steps: resolve, route-reason, metrics, feature-transition, doc-sync-* | `wrapup-pipeline.yaml` (×10), `execution-*` refs | no (calls `spur feature sync`) | A | `spur task wrapup <resolve\|route-reason\|metrics\|feature-transition\|doc-sync-snapshot\|doc-sync-scope\|doc-supersession> --run-id <id> [--tasks] [--feature]`. Logic → `packages/app/src/workflow/wrapup/` |

**All 22 `.mjs` twins: DELETE**, each in the PR that absorbs its source. They are generated by `superskill script convert`, and after absorption nothing resolves them. Their `config/plugin-scripts.json` rows go with them; the manifest itself is deleted in PR-8.

### 3.5 `plugins/sp/lib/`

| File | LOC | What it does | Importers | Disp. | Target |
| --- | ---: | --- | --- | :-: | --- |
| `agent-hint.ts` | 61 | Detects the host agent and model | `lib/context-session-start` | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-owner.ts` | 56 | Derives the host-native session owner from the payload | `lib/context-session-*`, Pi extension | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-post-tool.ts` | 432 | Writes ledger events: token cascade, redaction, freshness | hook, Pi, `lib/context-session-start` | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-session-start.ts` | 214 | Session pointer and `session_start` event | hook, Pi | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `context-session-stop.ts` | 196 | `session_end` rollup, gated on the owner | hook, Pi | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `destructive-policy.ts` | 146 | Classifies destructive commands | careful-guard, Pi | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `dogfood-pipeline.ts` | 265 | Detects pipeline-driving testees | dogfood script | A | `packages/app/src/services/dogfood/pipeline-detect.ts` |
| `dogfood-report.ts` | 278 | Validates dogfood reports | dogfood script; mentioned by the `packages/domain` stage-registry | A | `packages/app/src/services/dogfood/report.ts` |
| `env.ts` | 46 | Vendored env gateway for standalone plugin code | every hook, script and lib | **K** | Still needed by `hooks/pi/guard-extension.ts`, which must stay standalone: targets have no `node_modules`, so it cannot import `@gobing-ai/ts-utils`. The `env-var-hygiene` and `sp-plugin-standalone` rules require env access to go through this gateway. Shrinks to `getEnvVar` only |
| `inline-run-app.ts` | 68 | Loads the source app or the `inline-run.generated.mjs` bundle; stale-bundle guard | inline scripts, daily-summary | **D** (PR-4/6) | A bundle loader with no bundle left. Comments and diagnostics in `packages/app/src/workflow/consumer-compat.ts` that reference it are updated |
| `run-summary-core.ts` | 225 | Summary rendering, close callback, report writing | `run-summary` script | A | `packages/app/src/workflow/run-summary-render.ts` |
| `spur-bin.ts` | 36 | `spurCommand` / `defaultSpurBin` helpers for scripts | residual-scan, step-profile, wrapup-* | **D** (PR-8) | Every importer is absorbed, and the CLI has its own resolver (`apps/cli` `resolve-spur-bin`). The Pi wrapper keeps its own 3-candidate resolution (§5.3) |
| `task-file-policy.ts` | 31 | `couldBeTaskFile` pre-filter | task-write-guard, Pi | **K** | KEEP — owner boundary (Revision 2026-10-15): hook logic belongs to the plugin, run generically by superskill. Unchanged from `main` |
| `transcript.ts` | 112 | Resolves the host transcript, sniffs its format, parses rows | run-summary, session-timeline | A | `packages/app/src/workflow/transcript.ts` (or `services/history-transcript.ts`) |
| `history-anatomy.generated.{mjs,d.mts}` | 691/112 | Bundle of `services/history-anatomy.ts` | history-anatomy-cache | D (PR-6) | Replaced by `spur history anatomy` |
| `idea-handoff.generated.*` | 1446/17 | Bundle of `idea-handoff-cli.ts` | idea-handoff | D (PR-5) | Replaced by `spur feature handoff` |
| `inline-run.generated.*` | 3103/37 | App surface for the inline scripts, feature-verification steps and daily-summary | inline scripts, feature-verification-steps, inline-run-app | D (PR-6, last consumer) | Replaced by `spur workflow inline`, `feature verify` and `history summary` |
| `plan-projection.generated.*` | 982/197 | Plan projection, admission, run-summary, SENSITIVE list | batch-*, task-diffstat, run-summary-core, transcript | D (PR-6, last consumer) | Replaced by `task batch-plan`, `task preflight`, `task diffstat` and `workflow summary` |
| `quality-gate.generated.*` | 30510/139 | Quality gate (embeds the app) | quality-gate | D (PR-3) | Replaced by `spur task gate` |
| `residual-scan.generated.*` | 383/93 | Residual-scan core | residual-scan | D (PR-3) | Replaced by `spur task residual` |
| `step-profile.generated.*` | 174/71 | Step-profile core | workflow-step-profile | D (PR-6) | Replaced by `spur workflow profile` |

### 3.6 Where the live tree differs from the brief

- `scripts/commands/dev-all.heavy.test.ts` exists; it is a test, not a module.
- There is no `release.ts`; A91 1173 deleted it.
- `scripts/commands` holds 34 modules and 28 tests. Five tests have no same-named module (listed above).
- `plugins/sp/scripts/daily-summary/logger.ts` no longer exists; 1173 inlined it.
- `plugins/sp/lib` matches the brief exactly: 14 hand-written files plus 7 generated pairs.

Related files the brief did not list, all of which this plan touches:

- `config/plugin-scripts.json` (the script manifest)
- `config/script-placement-baseline.json`
- `config/workflow-candidates.json` (references history-anatomy-cache, task-diffstat and wrapup-drift-probe)
- `config/rules/boundary/{sp-script-placement,sp-plugin-standalone}.yaml`
- `config/rules/structure/protected-files.yaml` (inline-run.generated)
- `config/rules/typescript/output-boundaries.yaml` and `config/rules/strict/runtime-boundaries.yaml` (they name quality-gate and inline-run-setup)
- `plugins/sp/tests/**` (25.9k LOC; mapping in §8)

---

## 4. New spur commands (by noun)

**Conventions.**

- **Verbs.** The new verbs follow the existing `task deps <wbs> <op>` / `task sections <wbs> <op>` shape.
- **Output.** Every verb supports `--json` and writes the same `.spur/run/*` artifacts as the script it replaces, so YAML guards, which read files, do not change.
- **Exit codes.** Each verb keeps the exit codes of the script it replaces (0 / 1 / 2).
- **Environment.** Verbs read the same env names the scripts read, so workflow `env:` blocks keep working.
- **Implementation.** Every CLI file is a thin Commander adapter in `apps/cli/src/commands/<noun>/<verb>.ts` over a `packages/app` service. This is the existing pattern; `boundaries.test.ts` enforces it.

| Noun | Command | Replaces | App home |
| --- | --- | --- | --- |
| self | `spur self hook <id> [--host claude\|codex\|pi\|auto]`. Ids: `task-write-guard`, `careful-guard`, `context-post-tool`, `context-session-start`, `context-session-stop`, `agent-lifecycle`, `fleet-guest-stop` | 7 hook files + 11 lib files | `packages/app/src/hooks/*` |
| self | `spur self hook list [--json]`, listing ids with their events and policy (for the superskill registry test and docs) | — | same |
| task | `spur task gate <wbs> <run\|recheck\|light\|deferred\|status>` | quality-gate | `services/quality-gate.ts` |
| task | `spur task residual <wbs> <scan\|fold\|settle\|report\|review-gate>` | residual-scan | `services/residual-scan.ts` |
| task | `spur task diffstat <wbs>` | task-diffstat | `workflow/task-triage.ts` (+ diffstat) |
| task | `spur task preflight <wbs> [--operation] [--recovery] [--quick]` | batch-preflight | `services/planning-admission.ts` |
| task | `spur task batch-plan <waves\|order\|task-children>` | batch-plan | `workflow/plan-projection.ts` |
| task | `spur task wrapup <resolve\|route-reason\|metrics\|feature-transition\|doc-sync-snapshot\|doc-sync-scope\|doc-supersession\|drift-probe>` | wrapup-steps, wrapup-drift-probe | `workflow/wrapup/*` (new) |
| feature | `spur feature verify <id> --run-id <id>` | feature-verification-steps | `workflow/feature-verification-run.ts` |
| feature | `spur feature handoff <id> --run-id <id>` | idea-handoff | `workflow/idea-handoff-cli.ts` |
| workflow | `spur workflow inline <begin\|fingerprint\|action\|node-enter\|actions\|close\|decide\|attribution\|dispatch-failure\|persist-out\|persist-check>` | inline-run-setup, inline-run-dispatch, persist-out-check | `services/inline-run-setup.ts`, `workflow/persist-check.ts` (new) |
| workflow | `spur workflow commit-guard <start\|stage\|check> --run <id>` | commit-guard | `workflow/commit-guard.ts` (new) |
| workflow | `spur workflow summary` | run-summary | `workflow/run-summary*.ts` |
| workflow | `spur workflow profile <workflow>` | workflow-step-profile (A9 C5) | `workflow/step-profile.ts` |
| workflow | `spur workflow cost [--workflow] [--by-state] [--since] [--budget <file>]` | real-run-cost, pipeline-budgets | `workflow/run-cost.ts` (new) |
| history | `spur history anatomy <digest\|check\|paths\|assert-clean\|probe\|stamp\|refresh\|publish>` | history-anatomy-cache (A9 C6) | `services/history-anatomy.ts` |
| history | `spur history timeline` | session-timeline | `services/session-timeline.ts` (new) |
| history | `spur history summary` | daily-summary | `services/daily-summary.ts` (new) |
| agent | `spur agent dogfood <gate\|validate-report>` | detect-pipeline-driving, validate-report | `services/dogfood/*` |
| builder | `spur builder pr <preflight\|push\|ensure\|hygiene\|request\|wait\|collect\|status>` (owner decision Q1) | pr-reviewing | `services/pr-review/*` |
| self | `spur self migrate --check` | importer-schema-check | `packages/domain/src/analytics/importer-schema-version.ts` |
| builder | `spur builder publish <dir> [--otp]` (Q5) | `scripts/commands/publish.ts` | `apps/cli/src/release-ops.ts` |
| builder | `spur builder bump-ver --check [target]` (Q5) | check-marketplace-version | `apps/cli/src/release-ops.ts` |

**Placement (owner decision Q1: no new nouns).**

- **Hooks → `self hook`.** A hook is a host-event adapter that the installation itself exposes to superskill, which makes it a self-management surface of the installed CLI. The thin CLI layer (`apps/cli/src/commands/self-hook.ts`) only mounts the app-level runner, so the placement can be moved again cheaply.
- **PR-review loop → `builder pr`.** It is release-side GitHub plumbing, which is the builder charter. That needs the same charter extension as Q5.

**Nouns deliberately not added.**

- `dogfood` goes under `agent`: it is agent-testing tooling.
- `summary` and `timeline` go under `history`: both are reports over the history and ledger data.
- `gate`, `residual` and `diffstat` go under `task`: they are per-WBS pipeline steps, like `task check`.

---

## 5. Hook transport design

### 5.1 `spur self hook <id>` contract

- **Input.** Reads the host JSON payload on stdin, capped at 1 MB with a timeout, using the same reader that `lib/` uses today.
- **Host detection.** `--host auto` resolves to `claude` when `CLAUDE_PROJECT_DIR` is set, otherwise `codex`. `pi` is explicit only.
- **Output.**
  - Guards emit host-shaped JSON: `hookSpecificOutput.permissionDecision` for claude and codex, and `{decision:"block",reason}` for Stop.
  - With `--host pi`, guards return `{"action":"allow"|"deny"|"ask","reason"}`.
  - Capture and lifecycle ids print nothing.
- **Failure mode.** Every id **fails open**: any internal error means exit 0 with no stdout and one stderr line. The only exception is a deliberate guard decision.
- **Latency.**
  - Runs in-process. There is no nested `spur` spawn, because guard and fleet logic call the app services directly.
  - Target: p50 under 150 ms on the compiled binary. Today's guard spawns `spur task resolve`, which is about 120 ms, so this is roughly neutral.
  - `--profile` prints a timing line, mirroring superskill's `--profile`.

### 5.2 superskill change (separate repo, PR S-1) and transition

**PR S-1 (superskill).** Replace the four sp runners and `loadSpPluginDelegate` with a single `spurDelegate(id)` HookRunner. It:

- spawns `${SPUR_BIN:-spur} self hook <id> --host auto`;
- forwards stdout and the exit code;
- fails open on ENOENT, on timeout (10 s for capture, 5 s for guards), and when spur reports an unknown command.

Changes to superskill's hook registry:

- **Register** `sp/agent-lifecycle`, `sp/fleet-guest-stop` and `sp/careful-guard`. This fixes the no-op bug.
- **Keep** the `couldBeTaskCorpusPath` pre-filter for `task-write-guard`.
- **Delete** the drifted fallback copies of the context runners (about −450 LOC).

**Compatibility window**, while released superskill 0.3.28 to 0.3.37 still imports the `hooks/context-*.ts` paths:

- **PR-2b.** Reduce each `hooks/context-*.ts` to an export-compatible shim of 10 lines or fewer. Each exported `record…FromPayloadText(text)` spawns `spur self hook context-… --host auto` with that text on stdin and swallows errors. The direct-run path (`import.meta.main`) does the same.
  - Rule-1 justification: an old superskill can *only* reach the logic through an in-process import of this exact path and export.
  - Mark each shim `@transition-shim(sp-context-hook-imports)` and add it to `config/transition-shims.json` with removal condition "superskill floor ≥ S-1 release".
  - This makes every installed host route through spur immediately.
- **PR-10.** After S-1 ships:
  - set `"minCliVersion": "<S-1 version>"` in `hooks.json`, so older superskill skips hook emission rather than calling missing files;
  - bump the `superskill@0.3.28` pins in `package.json` (`plugin-smoke`) and `publish.yml`;
  - delete the three shims and the transition-shim entry.

### 5.3 Pi wrapper (`hooks/pi/guard-extension.ts`, ~70 lines, standalone)

```ts
// Imports: only node:child_process and ../../lib/env.ts.
// spur(): resolves SPUR_BIN, then PATH, then ~/.bun/bin/spur, /opt/homebrew/bin/spur, /usr/local/bin/spur.
//
// guard(id, payload):
//   spawnSync(spur, ['self', 'hook', id, '--host', 'pi'], {input: JSON, timeout: 5000})
//   -> parse the {action, reason} reply
//   -> spawn failure, timeout or parse error => allow (fail open)
//
// fire(id, payload):
//   spawn detached, stdin = JSON, unref()
//
// export default (pi) => {
//   pi.on('tool_call', async (e, ctx) => {
//     // Write/Edit/MultiEdit -> guard('task-write-guard')
//     //   deny -> return {block: true, reason}
//     // Bash -> guard('careful-guard')
//     //   ask -> ctx.ui.confirm(); block unless the user confirms
//   });
//   pi.on('tool_result', e => fire('context-post-tool', e));
//   pi.on('session_start' | 'session_shutdown', ...)  // context-session-* + agent-lifecycle
//   pi.on('agent_start' | 'agent_end', ...)            // agent-lifecycle
// };
```

**Why it stays (owner rule 5).** This is the only adapter that Pi's plugin system can load:

- it is in-process TypeScript, declared in `plugin.json` `extensions.pi`;
- blocking needs a return value, which a spawned process cannot provide;
- `ask` needs `ctx.ui.confirm`.

None of that fits in 5 lines or in `hooks.json`.

**What moves out of it.**

- The Pi-payload normalization moves into `spur self hook --host pi`.
- The event-to-state map moves into `packages/app/src/hooks/agent-lifecycle.ts`.
- Pi's `session_shutdown` → `stop` mapping moves into the host adapter.

**Test surface.** It remains under coverage (`plugins/sp/**` is measured). Its test injects a fake `spur` on PATH, which is the same technique `tests/hooks/` already uses with `SPUR_BIN`.

---

## 6. Caller and config changes

### 6.1 `hooks.json`

- Commands do not change.
- PR-10 adds `"minCliVersion"`.
- **Optional:** add a commented, opt-in `careful-guard` snippet to the README. Do **not** wire it by default; that stays the current policy.

### 6.2 Skills, commands and references (`plugins/sp/**/*.md`)

Rewrite every `superskill script path sp …`, `bun plugins/sp/scripts/…`, `node "$SCRIPT_ROOT/…mjs"` and `"$scriptRoot"` call into `spur <noun> <verb>`. Files by PR:

| PR | Files |
| --- | --- |
| PR-3 | `spur-check/SKILL.md`, `spur-check/references/gate-checklists.md`, `code-verification/SKILL.md`, `commands/dev-verify.md`, `dev-verifyall.md`, `secu-review.md`, `agents/super-reviewer.md` |
| PR-4 | `spur-execution/references/{inline-pipeline-driver,structured-trace-emission,execution-worktree-setup,execution-worktree-landing,execution-batch-report}.md` |
| PR-5 | `spur-execution/references/execution-batch.md` (wrapup refs), `dev-runall.md` |
| PR-6 | `daily-summary/SKILL.md`, `commands/dev-daily.md`, `session-review/SKILL.md`, `commands/dev-review-session.md`, `spur-doctor/SKILL.md`, `spur-execution/references/dev-operations.md` |
| PR-7 | `pr-reviewing/SKILL.md`, `commands/dev-pr-review.md`, `dogfood-testing/SKILL.md` (+ `references/report-template.md`) |
| PR-5 / PR-7 | `agents/super-planner.md`, `parallel-execution/SKILL.md`, `spur-planning/references/routing-table.md`, `execution-parallel-isolation.md` |

### 6.3 Workflows (`config/workflows/*.yaml`, all 6)

- Delete the `script-root` onEnter action, its jq resolution, and the `scriptRootFile`/`scriptRoot` vars.
- Replace every `bun|node "$scriptRoot/x"` with `"$spurBin" <noun> <verb>`.
- Keep `spurBin` as the single override point (tests already set it to the checkout shim).

| Workflow | Replacement verbs |
| --- | --- |
| `task-pipeline` | `task gate`, `task residual`, `task diffstat` |
| `wrapup-pipeline` | `task wrapup` |
| `history-anatomy` | `history anatomy` |
| `pr-review` | `builder pr` |
| `idea-pipeline` | `feature handoff` |
| `feature-verification` | `feature verify` |

Other workflow-related updates:

- Update `config/workflow-candidates.json` refs.
- Tests that need updating, under `apps/cli/tests` and `plugins/sp/tests`: workflow-yaml schema/action budget, inline-pipeline parity, and every test that reads `script-root`.
- `inline-pipeline-parity-check` keeps passing because the action and guard kinds do not change; only command strings change.

### 6.4 `package.json` (root)

- Remove `build:plugin-lib`.
- Remove `build:scripts`, including all 22 `superskill script convert` calls.
- Remove `history-surface-freeze-check`.
- Remove `history-surface-freeze-check` from `spur-check-feature`, `spur-check:full` and `spur-check-new:full`.
- `importer-schema-check` → `bun run apps/cli/src/index.ts self migrate --check` (the name stays, so the chains don't change).
- `check-pipeline-budgets`, if added, → `spur workflow cost --budget config/pipeline-budgets.json`.
- `script-contract-check` stays; its implementation is rewritten.
- `spur-check-feature` **stays out of `gate`/CI**, unchanged.

### 6.5 `apps/cli/package.json`

- `build:bundle`: drop `bundle-plugin-lib`.
- `prepublishOnly`: `check-marketplace-version` → `builder bump-ver --check spur` (Q5).
- New CLI files (`src/commands/self-hook.ts`, etc.) are already covered by `files: src/**`.

### 6.6 CI (`.github/workflows/`)

| Workflow | Change |
| --- | --- |
| `ci.yml` | None (`bun run check`, `build`) |
| `publish.yml` | `bun scripts/spur-dev.ts publish apps/cli` → `bun apps/cli/src/index.ts builder publish apps/cli` (Q5); in PR-10, bump the `superskill@0.3.28` plugin-smoke pin |
| `sync-ts-libs.yml` | None |

### 6.7 Bundling

- Delete `bundle-plugin-lib.ts` and the `*.generated.*` bundles.
- Delete the `config/plugin-scripts.json` manifest; it lists twins and bundles only.
- `bundle-plugins.ts` copies `plugins/` as is.
- `plugin-install-smoke` scans `hooks/pi` and `lib/env.ts`.
- `verify-pack` assertions shrink accordingly.
- The npm tarball gets roughly 77k lines smaller.

### 6.8 `scripts/bunfig.toml`, `scripts/tsconfig.json`, root `bunfig.toml`

- `scripts/bunfig.toml`: **unchanged**. The preload is still required for targeted `scripts/` tests.
- `scripts/tsconfig.json`: unchanged. If `test-shims/` moves, nothing in `include` references it.
- Root `bunfig.toml`: **no change required.**
  - `coveragePathIgnorePatterns` keeps `scripts/**`. That ignore is *the* reason repo-only tooling must not hold product logic, and after this plan none does.
  - The `plugins/sp/lib/*.generated.mjs` pattern turns into a no-op. Removing it is optional and **needs owner approval** (Q7).

### 6.9 Rules, ADRs and docs

| Item | Change |
| --- | --- |
| `config/rules/boundary/sp-script-placement.yaml` | Rewrite to the new contract (only `hooks.json`, `hooks/pi/`, `lib/env.ts`). Still runs `script-contract-check --placement-only`. Optionally fold this rule into `sp-plugin-standalone` |
| `config/script-placement-baseline.json` | Empty at the end; delete it |
| `config/rules/structure/protected-files.yaml` | Drop the `inline-run.generated` entry |
| `config/rules/typescript/output-boundaries.yaml`, `config/rules/strict/runtime-boundaries.yaml` | Repoint the script paths to `apps/cli/src/commands/**` |
| ADR-130 | **Amend** with "plugin logic is CLI-transported; hooks route through `spur self hook`; spur is a plugin prerequisite" |
| ADR-065, if it defines the standalone-plugin exception | Amend likewise |
| `plugins/sp/README.md` | Rewrite the hooks and scripts sections |
| `docs/help/how_to_organize_scripts_for_plugin_development.md` (superskill repo) | Add a note in the superskill repo: "a plugin that ships a CLI should delegate". Optional |

---

## 7. Concerns and risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **Hard dependency on spur.** Projects without spur lose the hooks and scripts | They are already non-functional without spur (978 direct calls). Hooks fail open; skills fail closed with an install hint (Q3) |
| R2 | **Version skew.** Released superskill imports the plugin's context files | Shims in PR-2b, `minCliVersion` plus shim deletion in PR-10 (§5.2) |
| R3 | **Version skew.** An old spur lacks the new verbs | Plugin and CLI release in lockstep. Hook delegates fail open; workflows fail closed with "unknown command" (the A9 posture). `consumer-compat.ts` gains a "spur too old for plugin" diagnostic (Q4) |
| R4 | **Hook latency** | In-process app calls with no nested spawn; capture spawns are detached on Pi; superskill pre-filter; p50 < 150 ms target, measured with `--profile` (PR-2a acceptance) |
| R5 | **Coverage gate.** About 9.9k moved lines plus new CLI files must each reach ≥ 90% line and function coverage | Plugin code is *already* measured, so moving it with its tests keeps coverage. Each PR moves tests alongside (§8). New CLI adapters are thin and covered by command tests. Code moved from coverage-ignored `scripts/**` (`real-run-cost`, `pipeline-budgets`, `importer-schema-check`, `publish`, `check-marketplace-version`) needs real tests: `publish` and the marketplace check have **none today**, so budget for that in PR-9 |
| R6 | **Generated-bundle drift during the transition** | Each bundle is deleted in the same PR as its last consumer. `bundle-plugin-lib` keeps building the remaining bundles until PR-8 |
| R7 | **Pi has no automated host E2E** | Wrapper unit test with a fake spur; manual Pi smoke checklist in the PR-2b description |
| R8 | **Gate stability (100% pass)** | Every PR runs `bun run gate` and `spur-check:full` before review. No PR touches the root bunfig. `spur-check-feature` stays out of CI |
| R9 | **`[advisory]`/`[docs-only]` markers** | The plan sets none; any marker goes through task files only |
| R10 | **Big-bang surface** | 10 spur PRs plus 1 superskill PR, each independently releasable (§10) |
| R11 | **I3 still `verifying`** | `surface-drift-inventory` is deleted only once I3 closes; otherwise deletion moves to PR-8 |

---

## 8. Test migration map

| From | To |
| --- | --- |
| `plugins/sp/tests/hooks/*` (agent-lifecycle, careful-guard, context-*, fleet-guest-stop, task-write-guard, pi guard-extension) | `packages/app/tests/hooks/*` and `apps/cli/tests/commands/hook-run.test.ts`. The Pi wrapper test stays in `plugins/sp/tests/hooks/` |
| `plugins/sp/tests/scripts/*` (one per script) | `packages/app/tests/{services,workflow}/*` for logic; `apps/cli/tests/commands/<noun>-<verb>.test.ts` for transport |
| `plugins/sp/tests/lib/*` | Next to the new app module |
| Workflow YAML tests | Assert `$spurBin <noun> <verb>` strings and the reduced action count |
| `scripts/commands/{real-run-cost,…}.test.ts` | `packages/app/tests/workflow/run-cost.test.ts`, etc. |
| `cli-surface-parity.test.ts` | Extended to cover the new verbs (docs ↔ `--help`) |

---

## 9. Target layout

```
scripts/
├── bunfig.toml            # targeted-test preload (kept)
├── install.sh             # published installer URL (kept)
├── spur-dev.ts            # repo tooling dispatcher (shrinks)
├── tsconfig.json
└── commands/              # 24 repo-only modules: build-*, bundle-{config,plugins,web},
                           # coverage-*, dependency-drift-check, dev-all, emit-board-types,
                           # eval-pipeline, fleet-e2e, inline-pipeline-parity-check,
                           # link-check, plugin-install-smoke, run-tests,
                           # script-contract-check, skill-eval, transition-shim-check,
                           # validate-commands, validate-flag-contracts, verify-pack,
                           # workflow-promotion
tests/shims/spur           # moved from scripts/test-shims
plugins/sp/
├── hooks/
│   ├── hooks.json         # superskill hook run sp <id>  (+minCliVersion in PR-10)
│   └── pi/guard-extension.ts   # the only wrapper (~70 lines)
├── lib/env.ts             # standalone env gateway for the Pi wrapper
└── (scripts/ removed)
apps/cli/src/commands/
├── self-hook.ts                          # `spur self hook <id>` / `self hook list` (thin layer)
├── task/{gate,residual,diffstat,preflight,batch-plan,wrapup}.ts
├── feature/{verify,handoff}.ts
├── workflow/{inline,commit-guard,summary,profile,cost}.ts
├── history/{anatomy,timeline,summary}.ts
├── agent/dogfood.ts
├── self/migrate.ts (+--check)
└── builder (publish, bump-ver --check, pr <op>)   # Q1/Q5
packages/app/src/
├── hooks/{agent-lifecycle,agent-hint,destructive-policy,fleet-guest-stop,task-file-policy}.ts
├── services/context-ledger/{owner,record-tool-use,session-start,session-stop}.ts
├── services/{daily-summary,session-timeline}.ts, services/dogfood/*, services/pr-review/*
└── workflow/{commit-guard,persist-check,run-cost,run-summary-render,transcript}.ts, workflow/wrapup/*
```

---

## 10. PR breakdown (ordered)

Sizes are rough, as hand-written lines added and removed; generated deletions are shown separately. Every PR must pass `bun run gate` at 100%, with ≥ 90% per-file line and function coverage. None touches the root `bunfig.toml`.

| PR | Repo | Scope | Size (hand / generated) | Depends on |
| --- | --- | --- | --- | --- |
| **PR-1** | spur | Delete `history-latency-measure`, `history-surface-freeze-check`, `run-storage-census` and `surface-drift-inventory` (the last only if I3 is closed), plus their tests and package-script entries. Move `scripts/test-shims/spur` → `tests/shims/spur` (3 refs + 1 doc) | +40 / −2.6k | — |
| ~~**PR-2a**~~ (withdrawn 2026-10-15) | spur | `spur self hook <id>` / `self hook list` (thin CLI layer under `self`). Port the hook and lib logic into `packages/app/src/hooks`, with tests and a parity proof against the plugin hook files. Plugin files are unchanged (both paths live) | +2.2k | — (independent of PR-1) |
| ~~**PR-2b**~~ (withdrawn 2026-10-15) | spur | Plugin hooks delegate: `hooks/context-*.ts` → transition shims; delete `agent-lifecycle`, `careful-guard`, `fleet-guest-stop`, `task-write-guard` and the 11 hook-only lib files; rewrite the Pi wrapper; README and ADR-130 amendment | +250 / −2.9k | PR-2a |
| ~~**S-1**~~ (withdrawn as designed 2026-10-15; superskill becomes the generic hook runner instead) | superskill | Generic `spurDelegate` runners (registers agent-lifecycle, fleet-guest-stop, careful-guard); remove `loadSpPluginDelegate` and the drifted copies; release | +200 / −450 | PR-2a released |
| **PR-3** | spur | `task gate`, `task residual`, `task diffstat`; task-pipeline YAML + verification docs; delete those 3 scripts + twins + `quality-gate`/`residual-scan` bundles | +900 / −1.0k (−31k gen) | — (was PR-2a; Revision 2026-10-15) |
| **PR-4** | spur | `workflow inline` (all ops, incl. persist-check and dispatch), `workflow commit-guard`; driver and worktree references; delete those scripts + twins | +1.3k / −1.0k (−3k gen) | — (was PR-2a; Revision 2026-10-15) |
| **PR-5** | spur | `task wrapup` (incl. drift-probe), `feature verify`, `feature handoff`, `task preflight`, `task batch-plan`; wrapup, idea and feature-verification YAML; delete the idea-handoff bundle | +1.5k / −1.4k (−3.5k gen) | — (was PR-2a; Revision 2026-10-15) |
| **PR-6** | spur | `history anatomy\|timeline\|summary`, `workflow summary\|profile`; history-anatomy YAML; delete the remaining bundles (`history-anatomy`, `step-profile`, `plan-projection`, `inline-run`) and `lib/inline-run-app.ts`, `transcript.ts`, `run-summary-core.ts` | +2.3k / −2.6k (−5k gen) | PR-4, PR-5 |
| **PR-7** | spur | `builder pr`, `agent dogfood`; pr-review YAML + skills; delete pr-reviewing and dogfood scripts + libs | +1.5k / −1.7k (−2k gen) | — (was PR-2a; Revision 2026-10-15) |
| **PR-8** | spur | Retire the script infrastructure: delete `script-root`, `lib/spur-bin.ts`, `bundle-plugin-lib` (+test), `config/plugin-scripts.json`, `script-placement-baseline.json`, `build:plugin-lib`/`build:scripts`; rewrite `script-contract-check` and the `sp-script-placement` rule; simplify `plugin-install-smoke`/`verify-pack`/`bundle-plugins` | +300 / −2.6k | PR-3 to PR-7 |
| **PR-9** | spur | `self migrate --check`, `workflow cost [--budget]`; if Q5 is approved, `builder publish` and `bump-ver --check` (with new tests); shrink `spur-dev`; update `publish.yml` | +900 / −700 | PR-1 (any time) |
| ~~**PR-10**~~ (moot as designed 2026-10-15: no context shims exist) | spur | `hooks.json` `minCliVersion`; delete the context shims + transition-shim entry; bump superskill pins (`package.json` plugin-smoke, `publish.yml`) | +30 / −80 | S-1 released |

**Ordering.**

1. PR-1. (PR-2a, PR-2b and S-1 as designed were withdrawn on 2026-10-15.)
2. PR-3, PR-4, PR-5 and PR-7 can run in parallel, each directly on `main`.
3. PR-6 after PR-4 and PR-5.
4. PR-8 last of the absorption PRs.
5. PR-9 is independent.
6. PR-10 closes the transition.

**Totals.**

| Category | Lines |
| --- | ---: |
| Hand-written added | ≈ +11.4k (mostly moved code plus tests) |
| Hand-written removed | ≈ −16.5k |
| Generated removed | ≈ −77k |

**Suggested tracking.** One new feature (for example "B-next: CLI transport for plugin logic"), with one task file per PR. Any `[advisory]` or `[docs-only]` markers (for example on PR-1 doc edits) are set only in those task files.

---

## 11. Open questions (with recommendations)

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Approve the new nouns `hook` and `pr`? | **Decided (owner): no new nouns.** Hooks → `spur self hook <id>` / `self hook list`; PR-review ops → `spur builder pr <op>`; dogfood → `agent dogfood` |
| Q2 | Keep the superskill hop (`superskill hook run sp <id>` → spur) or point `hooks.json` straight at `spur self hook`? | **Confirmed as recommended.** **Keep the hop** (owner rule 2 and the superskill guide). It keeps one hook entry point across hosts and the pre-filter |
| Q3 | Make `spur` a hard prerequisite of the sp plugin? | **Confirmed as recommended.** **Yes.** This is already true in practice. Amend ADR-130/065, state it in the plugin README and `plugin.json`, fail open in hooks |
| Q4 | Transition depth for old-CLI skew? | **Confirmed as recommended.** **Hard cut in 0.5.0** (lockstep release) plus a `consumer-compat` diagnostic ("plugin needs spur ≥ 0.5.0"). The only extended compatibility is the superskill shim window (PR-2b to PR-10) |
| Q5 | Extend the `builder` charter ("exactly two verbs, by explicit operator consent") with `publish` and `bump-ver --check`? | **Confirmed as recommended.** **Yes.** Both are release plumbing for the same files `bump-ver` already writes. If declined, `publish.ts` and `check-marketplace-version.ts` stay **K** in `scripts/commands` (repo-only reason: this repo's release) |
| Q6 | Delete the four one-off tools (`history-latency-measure`, `history-surface-freeze-check`, `run-storage-census`, `surface-drift-inventory`)? Keep `link-check`, `dependency-drift-check` and the coverage trio? | **Confirmed as recommended.** **Delete the four** (no callers, or a frozen surface for a done feature). **Keep** `link-check`, `dependency-drift-check` and the coverage tools: they guard this repo's own dev setup and gate |
| Q7 | Root `bunfig.toml` cleanup (drop the now-dead `plugins/sp/lib/*.generated.mjs` ignore)? | **Confirmed as recommended.** **Not required**: leave it unchanged. If the owner wants it, do it as a separate, explicitly approved one-line change after PR-6 |

---

## 12. Acceptance checklist (end state)

> **Status overlay (2026-10-15, task 1213).** The raw-deletion items below are the plan's original
> wording; the interpretation at the top of this section (and the task spec) reconcile them —
> `plugins/sp/scripts/` remains as `scripts/hooks/` only (hook ownership stays with the plugin).
> Landed by task 1213: script-root/twin/manifest/baseline/build infrastructure deleted; the
> retired-invocation grep below is clean over `plugins/` and `config/`; `bunfig.toml` untouched.
> Superskill floor aligned at 0.3.39 (catalog, lockfile, publish smoke).

- [ ] `plugins/sp/scripts/` does not exist.
- [ ] `plugins/sp/hooks/` unchanged from `main` (Revision 2026-10-15).
- [ ] `plugins/sp/lib/` = `env.ts` + the 7 hook-only libs (Revision 2026-10-15).
- [ ] No `*.generated.*`, no `config/plugin-scripts.json`, no `bundle-plugin-lib`.
- [ ] `grep -r "superskill script path sp\|bun plugins/sp/\|scriptRoot" plugins config` finds nothing.
- [ ] ~~All 7 hook ids work through `spur self hook`~~ (withdrawn 2026-10-15; hooks stay plugin-owned, run by superskill).
- [ ] `bun run gate` passes 100% with per-file line and function coverage ≥ 90%; `spur-check:full` passes; `spur-check-feature` is not in gate/CI.
- [ ] Root `bunfig.toml` is unchanged (or changed only with recorded owner approval).
- [ ] `scripts/` holds only the KEEP set in §3.1 and §3.2, each with its reason recorded here.
