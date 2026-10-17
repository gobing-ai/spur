---
schema_version: 1
name: Route quality gate and shipped workflows through SDLC actions
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.232Z
updated_at: "2026-10-17T17:18:25.071Z"
feature_id: A92
priority: P1
tags:
  - quality-gate
  - workflow
estimate_hours: 6

dependencies: ["1222", "1223"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1224-verdict.json
---

## 1224. Route quality gate and shipped workflows through SDLC actions

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4). The gate light tier hard-codes bunx biome / bun test (packages/app/src/services/quality-gate.ts:548-576) and workflows default to bun scripts (config/workflows/task-pipeline.yaml:174,180; feature-verification.yaml:54; packages/app/src/workflow/feature-verification-run.ts:187; wrapup-pipeline.yaml:132). Covers R5, R6, R11.

**Refine corrections (2026-10-16)**
- Bun defaults listed as three vars → there is a fourth, `formatCmd: "bun run format"` (config/workflows/task-pipeline.yaml:195, run at :367) → added as R4.
- Design implied `spur self exec …` literals → gate vars run via `sh -c` (packages/app/src/services/quality-gate.ts:762) and the CLI injects `spurBin` at run start (config/workflows/wrapup-pipeline.yaml:59), so a bare `spur` could hit a stale PATH binary → defaults use `${spurBin:-spur}`.
- Feature verification was treated like the shell vars → `verificationCmd` goes through the safe argv splitter with no shell (packages/app/src/workflow/feature-verification-run.ts:219) → default stays literal `spur self exec check-feature` (PATH `spur`); splitter invariant kept.
- Light tier would call `spur self exec` → it resolves in-process through sdlc-actions (no CLI re-entry, no PATH dependency); plan ids unchanged.
- Test-scope discovery splits on `/tests/` (quality-gate.ts:567) and is bun-layout-shaped → unchanged here; recorded out of scope.
- No project-layer `.spur/workflows/` overrides exist in spur-new (ls) → only config/workflows + regenerated apps/cli/config change.

### Requirements

- [x] R1. `planLightChecks` (packages/app/src/services/quality-gate.ts:548) resolves `lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed` in-process through sdlc-actions; no `bun`, `bunx` or `biome` literal remains in quality-gate.ts.
- [x] R2. An unbound scoped action yields a plan entry note `skipped:unbound` (no command run); `workspaceHasTypecheck` gates `typecheck-changed` only when the resolved source is `preset` (bun); plan ids stay `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:<ws>`, `test:<ws>`.
- [x] R3. task-pipeline defaults: `qualityGateCmd: "${spurBin:-spur} self exec check"`, `gateProbeCmd: "${spurBin:-spur} self exec lint"` (config/workflows/task-pipeline.yaml:174,180).
- [x] R4. task-pipeline `formatCmd` default becomes `"${spurBin:-spur} self exec format"` (task-pipeline.yaml:195), still best-effort.
- [x] R5. feature-verification default is `spur self exec check-feature` in config/workflows/feature-verification.yaml:54 and the fallback at feature-verification-run.ts:187.
- [x] R6. wrapup `docTripwireCmd` (config/workflows/wrapup-pipeline.yaml:132) runs `$spurBin self exec test-repo-wide` only when `$spurBin self exec --list --json` reports it with a source other than `unbound`.
- [x] R7. Explicit `--vars` and `spur task gate run --cmd/--probe-cmd` (apps/cli/src/commands/task/gate.ts:21-22) still take precedence.
- [x] R8. Under the bun preset, the planned light-tier commands for a fixed scope on this repo are byte-identical to the pre-change baseline.
- [x] R9. apps/cli/config is regenerated (`bun run --filter @gobing-ai/spur build:bundle`) and changed workflow versions are bumped per the promotion check.

Out of scope: test-scope discovery for non-bun layouts (follow-up); the CLI verb itself (1223); plugin prose (1227); package.json script edits (1226).

### Acceptance Criteria

- [x] AC1 — Quality gate tiers resolve commands through the action map
- [x] AC2 — Workflows and feature verification call actions instead of bun scripts
- [x] AC3 — Existing bun projects keep working without config changes

Requirement map: AC1 → R1, R2; AC2 → R3, R4, R5, R6, R7, R9; AC3 → R8. Test layer: E2E gate runs on a temp python-shaped fixture and on this repo (real shell execution, stub tools record calls — no mocked resolver).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:54.155Z

- No --vars seam is added for the light tier; the resolver replaces the literals directly.
- The wrapup tripwire probes the action list instead of package.json, so non-npm projects can opt in.

#### Q&A entry — 2026-10-17T04:16:44.263Z

- No --vars seam is added for the light tier; in-process resolution replaces the literals (closed).
- The wrapup tripwire probes the action list instead of package.json (closed).
- Shell vars use `${spurBin:-spur}`; argv-split verificationCmd uses PATH `spur` (closed 2026-10-16, see correction block).
- Non-bun test-scope discovery deferred to a follow-up task once a non-bun adopter exists (owner: operator).

### Design

WHAT: delete bun literals from the engine and shipped workflow defaults; route through the action map.
WHERE: packages/app/src/services/quality-gate.ts (planLightChecks + signature), config/workflows/{task-pipeline,feature-verification,wrapup-pipeline}.yaml, packages/app/src/workflow/feature-verification-run.ts:187, regenerated apps/cli/config/.

Frozen: `planLightChecks(scope, hasTypecheck = workspaceHasTypecheck, builder?: BuilderConfig)` — builder comes from the loaded project config at the existing call site (quality-gate.ts:661). `LightCheckPlan` gains optional `skipped?: 'unbound'`. YAML defaults exactly as R3–R6.

Why `${spurBin:-spur}`: the vars execute under `sh -c` and the CLI injects spurBin, so the gate re-enters the binary that drives the run; the `:-spur` fallback keeps a hand-run `spur task gate run` working. Feature verification stays argv-split (security invariant from its own design) and therefore uses PATH `spur`.

Anti-patterns: no bun fallback when an action is unbound; do not spawn `spur self exec` from inside the engine (in-process resolution only); do not change plan ids (receipts/logs key on them); do not touch test-scope discovery.

Assumes from deps: 1222 resolver/renderScoped/BuilderConfig; 1223 verb with exit-code propagation. Leaves for 1226: spur-new's `.spur/config.yaml` dogfood block declaring `test-repo-wide`.

### Plan

1. Baseline: dump `planLightChecks` output for a fixed scope on this repo to an artifact file (R8).
2. Swap planLightChecks to the resolver; add `skipped:unbound`; thread builder config from the call site (R1, R2).
3. Change YAML defaults and the feature-verification fallback (R3–R6); confirm `--vars`/`--cmd` precedence untouched (R7).
4. Regenerate apps/cli/config; bump workflow versions; run `bun run workflow-promotion-check` (R9).
5. E2E: run the gate (light + full) on a python-shaped temp fixture (`preset: none`, ruff/pytest stub scripts recording invocations) asserting no bun/bunx/biome executed; rerun on this repo and diff against the baseline (R8). Keep both outputs as the artifact.
6. `bun run spur-check`.

### Solution

The light tier now resolves every scoped command through the shared action map instead of
hard-coding bun literals; the shipped workflows default to `self exec`, and the wrapup tripwire
reads the action list before running anything. All line numbers are post-change.

| Requirement | Location | Change |
| --- | --- | --- |
| R1 | `packages/app/src/services/quality-gate.ts:553-556` | `planLightChecks` builds each entry from `resolveAction` + `renderScoped`; an unbound action becomes `{ cmd: '', skipped: 'unbound' }` and never a fallback literal. |
| R1 | `packages/app/src/services/quality-gate.ts:560-576` | The five scoped actions (`lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed`) are resolved in-process; the bun/biome/bunx command literals and the `shQuote` import are gone. |
| R2 | `packages/app/src/services/quality-gate.ts:567-575` | `workspaceHasTypecheck` gates `typecheck-changed` only when the resolved source is `preset`; plan ids stay `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:<ws>`, `test:<ws>`. |
| R2 | `packages/app/src/services/quality-gate.ts:691-696` | `runLightGate` logs `skipped:unbound` for a skipped plan and runs nothing (no receipt row). |
| R1 | `packages/app/src/services/quality-gate.ts:98` | `QualityGateOptions.builder` carries the project action binding into the engine. |
| R1 | `packages/app/src/services/quality-gate.ts:667` | The existing call site threads `options.builder` into `planLightChecks`. |
| R1/R7 | `apps/cli/src/commands/task/gate.ts:40` | The CLI passes the loaded `context.spurConfig?.builder`; the flag-over-env merge at `:34-35` is untouched. |
| R3 | `config/workflows/task-pipeline.yaml:174-180` | `qualityGateCmd` / `gateProbeCmd` default to `${spurBin:-spur} self exec check` / `... lint`. |
| R4 | `config/workflows/task-pipeline.yaml:195` | `formatCmd` defaults to `${spurBin:-spur} self exec format`. |
| R4 | `config/workflows/task-pipeline.yaml:367` | The format hop runs `sh -c "$formatCmd" ; exit 0`: a bare `$formatCmd` word cannot expand the `${spurBin:-spur}` inside the value, and the `; exit 0` keeps it best-effort. |
| R5 | `config/workflows/feature-verification.yaml:54` | `verificationCmd` defaults to `spur self exec check-feature` (argv-splitter invariant: literal PATH `spur`, no shell). |
| R5 | `packages/app/src/workflow/feature-verification-run.ts:187` | The runtime fallback matches the YAML default. |
| R5 | `packages/app/src/workflow/feature-verification-receipt.ts:61` | `DEFAULT_FEATURE_VERIFICATION_CMD` (the producer-side default recorded in a receipt) matches the shipped default, so a receipt written with it validates against the configured command at the completion boundary. |
| R6 | `config/workflows/wrapup-pipeline.yaml:132` | `docTripwireCmd` runs `$spurBin self exec test-repo-wide` only when `$spurBin self exec --list --json` reports it with a source other than `unbound` (the hop already runs it through `sh -c`, so `$spurBin` expands). |
| R9 | `config/workflows/task-pipeline.yaml:63` | Version bumped `7` → `8`. |
| R9 | `config/workflows/feature-verification.yaml:42` | Version bumped `1` → `2`. |
| R9 | `config/workflows/wrapup-pipeline.yaml:101` | Version bumped `9` → `10`. |
| R8 | `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:62` | The pre-change `planLightChecks` dump is pinned as the R8 fixture; the bun preset must render those exact bytes. |
| R1/R2 | `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:156` | E2E on a python-shaped git fixture (`preset: none`, declared `ruff`/`mypy`/`pytest` stubs that record their argv): the gate runs the declared tools, never bun/biome. |
| R2 | `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:189` | Same fixture with `typecheck-changed` undeclared: the gate logs `skipped:unbound`, records no row, and runs nothing. |
| R3-R5 | `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:25-44` | The shipped defaults are asserted from the parsed YAML, plus the format hop's `sh -c` wrapper and the feature-verification fallback. |
| R6 | `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:76-99` | The tripwire runs against a stub `spur`: bound → the action runs, unbound → nothing runs. |
| R7 | `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:114` | Through the real CLI: an env var (what `--vars` injects) beats the shipped default, and `--cmd` beats the env var. |

Regenerated `apps/cli/config` via `bundle-config` (gitignored build output; byte-identical to
`config/workflows/`). Scope discovery, the CLI verb, plugin prose and `package.json` scripts are
untouched per the task's out-of-scope list.

A tree-wide sweep for `bun run spur-check-feature` leaves only deliberate pins: the bun-preset
binding `spur self exec check-feature` maps to (`packages/app/src/services/sdlc-actions.ts:37`, satellite-table contract),
test fixtures that declare their own literal (`apps/cli/tests/commands/workflow/run.test.ts:685`,
`packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:206`, `packages/app/tests/services/workflow-service.test.ts:3227`,
`packages/app/tests/workflow/feature-verification-run.test.ts:61`), the frozen pr5 golden capture, and prose naming the
`package.json` script (which still exists). No other default remained stale.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:548-585` — `planLightChecks` builds every entry through `resolveAction` + `renderScoped` for `lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed` (`:553-556`, `:561-576`); `grep -n 'bunx\|biome' packages/app/src/services/quality-gate.ts` → 0 matches; the remaining `bun` tokens are the `bunfig.toml` coverage reader (`:147-160`, `:1017-1018`) and the `globalThis.Bun.sleepSync` sleep helper (`:751-755`), none of them a command literal; the python-shaped fixture E2E asserts the gate log matches no `bun`/`biome` while running the declared tools (`packages/app/tests/services/quality-gate-sdlc-actions.test.ts:156-187`) |
| R2 | MET | Unbound → `{ id, cmd: '', skipped: 'unbound' }` at `packages/app/src/services/quality-gate.ts:553-556`; `runLightGate` logs `--- light <id>: skipped:unbound` and `continue`s with no command and no receipt row at `:691-696`; the `workspaceHasTypecheck` gate is `if (typecheck.source === 'preset' && !hasTypecheck(workspace)) continue` at `:570-572`, so a declared binding owns its scope; ids stay `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:<ws>`, `test:<ws>` (`:561`, `:564`, `:565`, `:581`) and are asserted at `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:67-89`, with the skip path at `:91-101` and the E2E skip/log/no-run case at `:189-206` |
| R3 | MET | `config/workflows/task-pipeline.yaml:174` `qualityGateCmd: "${spurBin:-spur} self exec check"`, `:180` `gateProbeCmd: "${spurBin:-spur} self exec lint"`; asserted from the parsed YAML at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:25-29` |
| R4 | MET | `config/workflows/task-pipeline.yaml:195` `formatCmd: "${spurBin:-spur} self exec format"`; the post-implement hop wraps it as `sh -c "$formatCmd" ; exit 0` at `:367` so the inner expansion resolves and the run stays best-effort; asserted at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:31-36` and `plugins/sp/tests/skill-structure.test.ts:775` |
| R5 | MET | `config/workflows/feature-verification.yaml:54` `verificationCmd: "spur self exec check-feature"`; runtime fallback `packages/app/src/workflow/feature-verification-run.ts:187` carries the same literal; the producer-side receipt default `packages/app/src/workflow/feature-verification-receipt.ts:61` matches, so a receipt written with it validates against the configured command; asserted at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:38-44` and `plugins/sp/tests/feature-verification-scope.test.ts:116` |
| R6 | MET | `config/workflows/wrapup-pipeline.yaml:134` runs `$spurBin self exec test-repo-wide` only after `$spurBin self exec --list --json` is filtered by `jq -e` to a row named `test-repo-wide` whose `.source` is not `unbound`; absent or unbound rows leave jq non-zero so the action is not executed and, since 1229, the skip is announced on stderr. Bound/unbound behavior asserted against a stub `spur` at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:76-99` and `packages/app/tests/workflow/wrapup-pipeline.test.ts:963-1082` |
| R7 | MET | `apps/cli/src/commands/task/gate.ts:23-24` keeps `--cmd`/`--probe-cmd`; `:34-35` keeps the flag-over-env merge unchanged (env carries the `--vars` injection); `:39-41` only adds `builder: context.spurConfig?.builder`; asserted through the real CLI at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:114-126` (env value beats the shipped default, `--cmd` beats the env value) |
| R8 | MET | `.spur/run/1224-light-baseline-before.json` and `.spur/run/1224-light-baseline-after.json` are byte-identical (`diff` → no output, SAME); the pre-change plan is pinned as a literal and the current planner reproduces it under the default bun preset at `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:41-65` (12 pass / 0 fail on the two new test files) |
| R9 | MET | `diff -r config/workflows apps/cli/config/workflows` → no output (regenerated twins identical; `apps/cli/config` is a gitignored build artifact, `.gitignore:80`); versions bumped `task-pipeline 7→8` (`config/workflows/task-pipeline.yaml:63`), `feature-verification 1→2` (`config/workflows/feature-verification.yaml:42`), `wrapup-pipeline 9→10` (since 11 via 1229) (`config/workflows/wrapup-pipeline.yaml:101`); `bun run workflow-promotion-check` → `PASS (4 candidate(s), no parallel definitions)`; the per-definition version pins updated at `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:316`, `packages/app/tests/workflow/wrapup-pipeline.test.ts:130`, `:168` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Quality gate tiers resolve commands through the action map | MET | test | `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:62-101` asserts every planned command and id comes from the resolver (bun preset, declared binding, unbound skip); `:156-187` runs `runLightGate` on a `preset: none` python fixture and asserts the recorded argv is exactly ruff/mypy/pytest while the log matches no `bun`/`biome`; `bun test` on that file → pass, 0 fail |
| AC2 — Workflows and feature verification call actions instead of bun scripts | MET | test | `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:25-44` pins `qualityGateCmd`, `gateProbeCmd`, `formatCmd` and `verificationCmd` to the `self exec` forms from the parsed YAML and pins the `sh -c "$formatCmd"` hop; `:76-99` exercises the wrapup tripwire guard both ways; `plugins/sp/tests/feature-verification-scope.test.ts:116` pins the feature-verification default; `bun test` on the four affected workflow/plugin files → 183 pass, 0 fail |
| AC3 — Existing bun projects keep working without config changes | MET | test | `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:62-65` asserts the no-`builder` plan equals the pre-change bytes for the fixed repo scope, and `.spur/run/1224-light-baseline-{before,after}.json` diff clean; `BuilderConfigSchema.parse({})` defaults `preset: 'bun'` (`packages/config/src/index.ts:1064-1071`), whose `BUN_PRESET` entries (`packages/app/src/services/sdlc-actions.ts:22-41`) are the deleted literals verbatim (`bunx biome check {files}`, `bun run test-pre-check`, `bun run test-post-check`, `cd {workspace} && bun run typecheck`, `cd {workspace} && bun test {paths}`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1224
**Scope:** `git diff HEAD` on 12 tracked files (quality-gate.ts, sdlc-actions consumer wiring, 3 shipped workflows, the feature-verification fallback + receipt default, 4 pinning tests, the task doc) plus 2 untracked test files (the 14-file change set).
**Dimensions:** functional traceability (R1–R9, AC1–AC3), SECUA, architectural depth.
**Evidence run (narrow, read-only, no gate/format):** `bun test` on the 2 new + 9 affected test files — 290 tests, 0 fail (12/0 on the new pair, 129/0 on quality-gate-receipt + sdlc-actions + wrapup-pipeline + task-pipeline-proof-chain, 46/0 on the feature-verification triple, 103/0 on the two plugin tests); `bun run workflow-promotion-check` → PASS (4 candidates); `diff .spur/run/1224-light-baseline-before.json .spur/run/1224-light-baseline-after.json` → identical; `diff -r config/workflows apps/cli/config/workflows` → no output; `bun apps/cli/src/index.ts self exec --list --json` probes for the R6 guard; `grep 'bunx\|biome'` on quality-gate.ts → 0.

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | functional | The wrapup doc tripwire is a silent no-op in spur-new until the `test-repo-wide` custom action is declared: `self exec --list --json` emits no row for it (jq `select` exits 4, verified against the real CLI), so the guard never runs it, whereas the previous probe matched the `package.json` script that still exists; the task explicitly leaves the `.spur/config.yaml` dogfood declaration to 1226 (still `todo`) and design §3.5 requires it | `config/workflows/wrapup-pipeline.yaml:132` | FIXED(e70fe9363) — declared by 1226, and an unbound skip now prints a stderr note instead of passing silently |
| 2 | P4 (advisory) | usability | Stale prose in two files this change edits: the CLI help still describes the light tier as "biome on changed files", and the comment above the tripwire still says it probes `package.json` | `apps/cli/src/commands/task/gate.ts:13`, `config/workflows/wrapup-pipeline.yaml:127-128` | ACCEPTED |
| 3 | P4 (advisory) | correctness | Feature verification spawns PATH `spur` through the no-shell launcher at `packages/app/src/workflow/feature-verification-run.ts:219-236`, and the `exec` verb it now calls is registered at `apps/cli/src/commands/self/exec.ts:39`; the installed PATH binary predates that verb (`spur self exec --list --json` → `error: unknown command 'exec'`, exit 1, probed directly). A `spur feature check` driven by the source CLI therefore fails at the A92 feature transition until the global install is refreshed; the diff itself matches R5 verbatim | `packages/app/src/workflow/feature-verification-run.ts:187`, `config/workflows/feature-verification.yaml:54` | ACCEPTED |
| 4 | P4 (advisory) | usability | The light-tier summary line counts only reused rows, so an all-unbound tier prints `checks: 0 … PASS` with no summary signal that nothing ran (the per-check `skipped:unbound` log lines do carry it) | `packages/app/src/services/quality-gate.ts:691-695`, `:731-738` | ACCEPTED |
| 5 | P4 (advisory) | correctness | A load-valid binding `test-changed: 'pytest {files}'` crashes the gate: config validation admits all three placeholders on the three scoped actions, while the planner supplies only `{workspace, paths}` for `test-changed`, so `renderScoped` throws uncaught out of `qualityGateMain` (reproduced: `THREW: renderScoped: {files} has no value`). Fails closed (red gate, stack trace), never silently widens | `packages/app/src/services/quality-gate.ts:553-558`, `packages/config/src/index.ts:966` | ACCEPTED |
| 6 | P4 (advisory) | functional | R8's pinned baseline was captured with a hermetic predicate (`workspace === 'packages/app'`), so it omits `typecheck:apps/cli`, which the repo's real predicate produces; byte-identity is verified for that pinned predicate, and the preset strings are literal re-uses of the deleted commands, so the AC3 claim holds | `.spur/run/1224-light-baseline.ts:10`, `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:62-65` | ACCEPTED |

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:548-585`: `planLightChecks` builds every entry from `resolveAction` + `renderScoped` (`lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed`); `grep -c 'bunx\|biome' packages/app/src/services/quality-gate.ts` → 0; the remaining `bun` tokens are `bunfig.toml` coverage parsing (`:147-160`, `:1017-1018`) and `globalThis.Bun.sleepSync` (`:753-755`), no command literal; python-fixture E2E runs ruff/mypy/pytest and asserts the log matches no bun/biome (`packages/app/tests/services/quality-gate-sdlc-actions.test.ts:156-187`) |
| R2 | MET | Unbound → `{ id, cmd: '', skipped: 'unbound' }` at `packages/app/src/services/quality-gate.ts:553-558`, executed as log-and-continue with no receipt row and no command at `:691-695`; the preset gate is `typecheck.source === 'preset' && !hasTypecheck(ws) → continue` at `:571-572` (a declared binding owns its scope); ids unchanged (`:561`, `:564`, `:565`, `:581`) and asserted at `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:67-78`, `:80-89`, `:91-101`, `:189-212` |
| R3 | MET | `config/workflows/task-pipeline.yaml:174` `qualityGateCmd: "${spurBin:-spur} self exec check"`, `:180` `gateProbeCmd: "${spurBin:-spur} self exec lint"`; asserted at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:25-29` |
| R4 | MET | `config/workflows/task-pipeline.yaml:195` `formatCmd: "${spurBin:-spur} self exec format"`; the hop wraps it as `sh -c "$formatCmd" ; exit 0` at `:367` so the expansion resolves and the exit stays best-effort; asserted at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:31-36` and `plugins/sp/tests/skill-structure.test.ts:775` |
| R5 | MET | `config/workflows/feature-verification.yaml:54` and the run fallback `packages/app/src/workflow/feature-verification-run.ts:187` both `spur self exec check-feature`; the producer-side constant `packages/app/src/workflow/feature-verification-receipt.ts:61` matches, so a receipt written with it validates at the completion boundary; asserted at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:38-44` and `plugins/sp/tests/feature-verification-scope.test.ts:116` |
| R6 | MET | `config/workflows/wrapup-pipeline.yaml:132` guards on `$spurBin self exec --list --json \| jq -e '.[] \| select(.name == "test-repo-wide" and .source != "unbound")'` before `$spurBin self exec test-repo-wide`; the guard cannot run an unbound row — absent/unbound → jq exit 4 (verified against the real CLI: no `test-repo-wide` row here), bound → exit 0 and the action runs; a second fail-safe layer remains (`self exec` on an unbound name exits 2 without executing); asserted bound/unbound at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:76-99` and `packages/app/tests/workflow/wrapup-pipeline.test.ts:962-1000` |
| R7 | MET | `apps/cli/src/commands/task/gate.ts:23-24` keeps `--cmd`/`--probe-cmd`, `:34-35` keeps the flag-over-env merge, `:39-41` only adds `builder: context.spurConfig?.builder`; the loader never overrides a present env value; asserted through the real CLI at `packages/app/tests/workflow/sdlc-action-workflow-defaults.test.ts:114-130` |
| R8 | MET | `.spur/run/1224-light-baseline-before.json` (capture script `.spur/run/1224-light-baseline.ts:10`) and `.spur/run/1224-light-baseline-after.json` are byte-identical (`diff` → SAME); pinned as a literal in `packages/app/tests/services/quality-gate-sdlc-actions.test.ts:41-65`, which the current planner satisfies under the default (bun) preset |
| R9 | MET | `diff -r config/workflows apps/cli/config/workflows` → no output (regenerated twins identical); versions bumped `task-pipeline 7→8` (`config/workflows/task-pipeline.yaml:63`), `feature-verification 1→2` (`:42`), `wrapup-pipeline 9→10` (`config/workflows/wrapup-pipeline.yaml:101`); `bun run workflow-promotion-check` → `PASS (4 candidate(s), no parallel definitions)`; pins updated at `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:316`, `packages/app/tests/workflow/wrapup-pipeline.test.ts:129`, `:164` |
| AC1 | MET | R1 + R2 rows above: all five scoped actions resolve through the action map, unbound skips with no fallback literal |
| AC2 | MET | R3–R7 + R9 rows above: workflow defaults, format hop, feature verification (both surfaces) and the wrapup tripwire call actions; twins regenerated and versions bumped |
| AC3 | MET | R8 row above: the default (no `builder` block → preset `bun`) renders the pre-change commands byte-for-byte; `BuilderConfigSchema` defaults `preset: 'bun'` (`packages/config/src/index.ts:1051-1056`) |

#### SECUA

- **Security.** Changed-file paths are still quoted by `shQuote` through `renderScoped`, so a crafted filename cannot split or expand an argument. Every new shell surface stays inside the documented trusted-config boundary (`qualityGateCmd`/`gateProbeCmd`/`formatCmd` under `sh -c`, `verificationCmd` under the no-shell argv splitter); nothing interpolates run data into a command string. `$spurBin` is CLI-injected, and the `:-spur` fallback keeps hand runs working (`config/workflows/task-pipeline.yaml:174`).
- **Correctness / error handling.** Unbound actions fail closed in both tiers: the light tier skips and records nothing, the full tier's `spur self exec check` exits 2, so a project that declares nothing gets a red full gate rather than a vacuous green. The tripwire guard is fail-open on a missing `jq`/`spur` (skip, no execution) — the same shape the previous `jq package.json` probe had.
- **Efficiency.** One extra `self exec --list --json` spawn per wrapup; the light tier is strictly cheaper than before (no `spur` subprocess, in-process resolution). No new dependency.
- **Usability.** Two stale prose instances (finding 2) and the summary-line observability gap (finding 4).

#### Architectural depth

The resolver stays the single deep module (`packages/app/src/services/sdlc-actions.ts`, pure `resolveAction`/`renderScoped`/`listActions`), the engine keeps only a thin planner that delegates, and the CLI threads one option (`builder`) from loaded config. No new abstraction was introduced at the call site, ids/receipts keying are untouched, and the same table serves the verb and the gate — the intended one-indirection shape. Residual shallowness is pre-existing and out of scope: bun-shaped test-scope discovery (`quality-gate.ts:576-577`) and `bunfig.toml` coverage parsing (`:1017-1018`).

#### Confidence (verified — no asserted level)
- **Absence verified, not asserted.** The answer carries no `Confidence: HIGH|MEDIUM|LOW` line: `grep -c '^Confidence:' .spur/run/1224-a4f77f1f-review-answer.txt` → 0. That grade was retired together with the verify-answer one — `packages/app/src/services/residual-scan.ts:326-328` — and its owning task is deprecated in favour of the retirement batch (`docs/tasks5/1204_review-answer-files-carry-a-confidence-level-high-medium-low.md:184`).
- **No gate reads one.** The findings gate parses only the findings table (`reviewContractViolations`, `packages/app/src/services/residual-scan.ts:333-345`), and `spur task residual 1224 review-gate` reports `blocking=0`; `grep -rn 'confidence' apps/cli/src/commands/task` returns no reader.
- **What carries the signal instead (checkable):** dispositions — 0 OPEN, 1 DEFER, 5 ACCEPTED in `#### Findings (ranked)`; pasted narrow-test evidence — 290 pass / 0 fail across 11 files; and the two independent recomputes recorded above (the R8 baseline/after artifact diff and the R6 CLI probe). The gaps a level would have compressed stay named verbatim in the next section.

#### Assumptions / evidence gaps

- No automated check ties a *content* change of a shipped definition to its version bump; R9's bumps are enforced by the pinned-version tests, and the promotion check validates candidates/parallel definitions, not the numbers.
- The R8 byte-identity proof is scoped to the pinned predicate (finding 6); the real-scope plan additionally carries `typecheck:apps/cli`, which the pre-change code emitted for the same predicate.
- `spur feature check` with the source CLI was not executed end-to-end (would run the repo-wide suite); the PATH-`spur` verb gap is reported from the direct `spur self exec` probe (finding 3).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T06:09:10.856Z todo → wip (system)
- 2026-10-17T06:31:57.090Z wip → testing (system)
- 2026-10-17T06:32:10.394Z testing → done (system)

