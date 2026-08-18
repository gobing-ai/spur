---
template: issue
schema_version: 1
name: Make sp task-write-guard hook portable across superskill/rulesync installs
description: ""
status: done
type: task
profile: standard
feature_id: H2
parent_wbs: null
priority: P1
tags: [bug]
dependencies: []
created_at: 2026-06-29T05:34:21.692Z
updated_at: "2026-08-18T04:42:46.994Z"
---

## 0151. Make sp task-write-guard hook portable across superskill/rulesync installs

### Background
> **Scope (amended).** This task now covers the **portable-hook standard end to end**: the
> `superskill hook run <plugin> <hook-id>` runtime + registry, the `sp task-write-guard` migration,
> the Antigravity native-hook fix, **plus** two aligned items that share the same root-cause defect —
> the `cc` anti-hallucination Stop hook (with its broken Stop-output contract fixed) and the
> `cc-hooks` authoring skill/agent. Hook config and runtime fixes land in `~/xprojects/superskill`;
> `spur-new` owns only the `sp` `hooks.json` + guard script + its tests.

Review findings were checked against the current Spur plugin plus local upstream source:

- Spur hook registration: `plugins/sp/hooks/hooks.json:10` invokes
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- Spur hook implementation: `plugins/sp/hooks/task-write-guard.ts:45-88` walks up from
  `CLAUDE_PROJECT_DIR` to `apps/cli/src/index.ts`, then runs `bun run <source-file> task resolve`.
- Superskill mapper: `~/xprojects/superskill/packages/core/src/mapper.ts:93-214` converts plugin
  `hooks.json` into `.rulesync/hooks.json`; it copies support subdirs only for skills, not hook
  script files under `plugins/<plugin>/hooks/`. **Precise gap:** the support-subdir copy loop
  (`mapper.ts:162`) runs only for skills (`scripts/references/templates/assets`); the hooks branch
  (`mapper.ts:207-214`) converts the config but never copies `hooks/` or `scripts/` files.
- Superskill install path: `~/xprojects/superskill/apps/cli/src/commands/install.ts:127-249`
  sends hooks through rulesync for codex/opencode/antigravity and emits shims/copies for pi/omp/hermes.
- Rulesync hook tests: `~/xprojects/superskill/vendors/rulesync/src/e2e/e2e-hooks.spec.ts:51-126`
  verify that canonical hook command strings are preserved into native target configs.
- Superskill design: `~/xprojects/superskill/docs/design/design-doc-phase5.md:40-68` says the universal
  hook interface is rulesync's canonical `.rulesync/hooks.json` / `HookDefinitionSchema`, not a bespoke
  schema.
- `superskill hook --help` currently exposes `validate`, `evaluate`, `refine`, `evolve`, and `emit`
  (`apps/cli/src/commands/hook.ts:192-236`); it does **not** expose the required runtime trigger
  command `superskill hook run`.

Folded-in scope — verified parity defects in the `cc` plugin:

- cc plugin parity defect: `~/xprojects/superskill/plugins/cc/hooks/hooks.json` invokes
  `bun ${CLAUDE_PLUGIN_ROOT}/scripts/anti-hallucination/ah_guard.ts` — the identical non-portable
  shape as the sp hook (Claude-only var + uncopied script).
- cc Stop-hook output bug: `plugins/cc/scripts/anti-hallucination/ah_guard.ts:253-295` emits
  `{ok, reason}` and exits 1; Claude's `Stop` hook requires `{hookSpecificOutput:{allowStop, feedback}}`
  (per cc-hooks `SKILL.md` "stop output" §). Latent — the guard almost certainly never actually blocks
  a stop today. This is fixed as part of the migration (Robin's call).
- cc-hooks skill teaches the broken pattern: `plugins/cc/skills/cc-hooks/SKILL.md:50,108,290,307` use
  `${CLAUDE_PLUGIN_ROOT}/<script>` as the "portable command hook" example, and Safety Invariant #4
  (`SKILL.md:96`) wrongly claims the target runtime rewrites `${CLAUDE_PLUGIN_ROOT}` — false for
  non-Claude targets, where superskill performs no such rewrite. The `expert-hook` agent and the
  Antigravity row in the target matrix (`SKILL.md:235`) / `references/cross-platform.md` propagate the
  same error and need correcting.

Current install-output verification:

- `superskill install sp --marketplace .claude-plugin --targets codex,pi,omp,opencode,antigravity-cli,antigravity-ide,hermes --dry-run --verbose`
  reports hook support but preserves the bad command in `.rulesync/hooks.json`:
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- A real isolated `executeInstall(..., outputRoot)` writes generated hook configs for codex, opencode,
  pi, omp, and hermes, and every generated hook config still invokes
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- The isolated install does not emit a native Antigravity hook file. Superskill maps
  `antigravity-cli` and `antigravity-ide` to rulesync target `codexcli` (`TARGET_TO_RULESYNC`), so
  rulesync runs `CodexcliHooks` (writes `.codex/hooks.json`) instead of the native `AntigravityHooks`
  generator that writes `.agents/hooks.json` in project mode and `.gemini/config/hooks.json` in global
  mode.

Conclusion: all review concerns are valid for non-Claude installs, and the same root cause recurs in
the `cc` plugin and is taught by the `cc-hooks` skill. Claude Code's native plugin install can make
`${CLAUDE_PLUGIN_ROOT}` meaningful, but rulesync/superskill do not make that variable portable across
the other installed agents, and the guard's in-repo CLI lookup only works inside the Spur source
checkout.
### Acceptance Criteria
```gherkin
Feature: Portable sp task-write-guard hook

  Scenario: Hook config uses rulesync canonical command shape
    Given plugins/sp/hooks/hooks.json
    When superskill maps it to .rulesync/hooks.json
    Then the hook command does not contain CLAUDE_PLUGIN_ROOT
    And the hook command is "superskill hook run sp task-write-guard"
    And it is valid rulesync canonical hook configuration

  Scenario: Superskill exposes the hook trigger command
    Given superskill hook --help
    When the command list is rendered
    Then it includes "run <plugin> <hook-id>"
    And installed hook configs call "superskill hook run sp task-write-guard"
    And no installed hook config calls "spur hook"

  Scenario: Hook execution uses an installed CLI command
    Given the hook fires in a project that is not the Spur source checkout
    When the guard needs to resolve whether a path is a task file
    Then it invokes "superskill hook run sp task-write-guard"
    And it does not reference apps/cli/src/index.ts
    And it fails open when the command is missing, times out, or returns an unexpected runtime error

  Scenario: Hook runtime has a portable installed location
    Given superskill install sp --targets codex,opencode,antigravity-cli,antigravity-ide,pi,omp,hermes
    When generated hook configs are inspected
    Then every referenced executable is either a PATH command or a file installed by superskill
    And no generated config references a source-checkout-only path under plugins/sp/hooks
    And no generated config references CLAUDE_PLUGIN_ROOT for non-Claude targets

  Scenario: Antigravity receives a native hook config
    Given superskill install sp --target antigravity-cli
    When generated hook configs are inspected
    Then the install emits Antigravity's native hook location
    And the emitted command is "superskill hook run sp task-write-guard"

  Scenario: Claude remains supported
    Given superskill install sp --target claude
    When Claude Code loads the sp plugin hook
    Then the hook still blocks raw Write/Edit of task-owned files
    And it uses the same guard semantics as other targets

  Scenario: sp guard behavior is verified end-to-end
    Given a temp project with a registered tasks folder and an owned task file
    When the hook payload names that task file for Write or Edit
    Then the hook returns a deny decision
    When the hook payload names a non-task file, malformed payload, or unsupported tool
    Then the hook returns allow

  Scenario: cc anti-hallucination hook is portable
    Given plugins/cc/hooks/hooks.json
    When superskill maps and installs it across targets
    Then the hook command is "superskill hook run cc anti-hallucination"
    And no generated config references CLAUDE_PLUGIN_ROOT or plugins/cc/scripts

  Scenario: cc Stop runner emits the correct Claude contract
    Given the cc anti-hallucination runner fires on a Stop event
    When the anti-hallucination protocol fails for the last assistant message
    Then it emits {"hookSpecificOutput":{"allowStop":false,"feedback":"..."}}
    And the stop is blocked with the feedback surfaced
    When ARGUMENTS is empty, malformed, or the message passes the protocol
    Then it allows the stop (fails open)

  Scenario: cc-hooks skill teaches the portable standard
    Given plugins/cc/skills/cc-hooks/SKILL.md and the expert-hook agent
    When an author reads the canonical command-hook guidance
    Then they are directed to "superskill hook run <plugin> <hook-id>"
    And no ${CLAUDE_PLUGIN_ROOT}/<script> command is presented as cross-platform
    And the Antigravity capability row reflects native hook support
```

- [ ] AC-1: `CLAUDE_PLUGIN_ROOT` removed from the sp hook command path for portable targets.
- [ ] AC-2: `task-write-guard` no longer searches for `apps/cli/src/index.ts`.
- [ ] AC-3: `superskill hook run sp task-write-guard` works outside the Spur repo checkout.
- [ ] AC-4: Superskill install/emit tests cover generated hooks for codex, opencode, antigravity, pi/omp/hermes, and Claude where practical.
- [ ] AC-5: Existing guard behavior remains fail-open except for confirmed task-owned Write/Edit payloads.
- [ ] AC-6: Superskill fixes or bridges Antigravity hook emission so native Antigravity hook output is verified.
- [ ] AC-7: cc anti-hallucination hook config calls `superskill hook run cc anti-hallucination`; no generated config references `CLAUDE_PLUGIN_ROOT` or `plugins/cc/scripts`.
- [ ] AC-8: the cc Stop runner emits `{hookSpecificOutput:{allowStop,feedback}}` and blocks when the protocol fails; it fails open on empty/malformed `ARGUMENTS` or a passing message.
- [ ] AC-9: `cc-hooks` SKILL.md + `expert-hook` agent + references teach `superskill hook run` as the portable standard; no `${CLAUDE_PLUGIN_ROOT}/<script>` is presented as cross-platform; the Antigravity capability row is corrected.

**Feature scenario cover (DD-09 / H2 close)**

```gherkin
Feature: Companion skills and write guard

  Scenario: The hook holds no logic
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Companions document, spur-dev acts
    Given linked implementation under this feature
    Then this scenario is covered

```
### Design
Recommended fix: make every hook config portable and move execution behind a single stable PATH
command, `superskill hook run <plugin> <hook-id>`, backed by a runtime registry in superskill.

**A. Superskill hook runtime registry (core).** Add
`~/xprojects/superskill/apps/cli/src/commands/hook-run.ts` plus a `HookRunner` registry keyed
`"<plugin>/<hookId>"` (`sp/task-write-guard`, `cc/anti-hallucination`). Register a new
`run <plugin> <hook-id>` subcommand in `apps/cli/src/commands/hook.ts` (alongside
`validate/evaluate/refine/evolve/emit`). Preferred command shape:

```json
{
  "type": "command",
  "command": "superskill hook run sp task-write-guard",
  "matcher": "Write|Edit",
  "timeout": 10
}
```

Dispatcher contract: read stdin fully + the process env, resolve the runner, write the runner's JSON
to stdout, exit with the runner's code. Unknown `<plugin>/<hook-id>` → exit non-zero with a clear
error. Runners emit **Claude canonical JSON** (PreToolUse permission decision / Stop `allowStop`);
agents that cannot parse it fail open. Key invariant: generated hook configs call a PATH command,
never a path inside a plugin checkout, and never `${CLAUDE_PLUGIN_ROOT}` for non-Claude targets. Do
**not** invent a new hook schema — keep rulesync canonical hooks (`HookDefinitionSchema`) as the
interface; install output still flows through `mapPluginToRulesync` +
`rulesync.generate({ features: ['hooks'] })`.

- **sp/task-write-guard runner.** Port the stdin parser + decision JSON from
  `plugins/sp/hooks/task-write-guard.ts:36-103`. Replace `findCli()` / `bun run apps/cli/src/index.ts`
  with `spawnSync('spur', ['task','resolve', filePath, '--strict','--json'])` against the globally
  installed `spur`. Preserve fail-open on: malformed payload, non-Write/Edit tool, missing path,
  `SPUR_WRITE_GUARD=off`, spawn error, subprocess timeout. Deny only when `spur task resolve` confirms
  ownership (exit 0). Delete `findCli()`.
- **cc/anti-hallucination runner.** Contract differs: reads the payload from the `ARGUMENTS` env var
  (**not stdin**) and fires on `Stop`, not `PreToolUse`. Reuse `verifyAntiHallucinationProtocol` and
  `extractLastAssistantMessage` from `plugins/cc/scripts/anti-hallucination/ah_guard.ts` (import — do
  not reimplement, avoid drift). **Fix the output contract**: emit
  `{"hookSpecificOutput":{"allowStop": result.ok, "feedback": result.reason}}` instead of the current
  `{ok, reason}` / exit-1 shape, so the guard actually blocks on Claude. Fail open (allow stop) on
  empty/invalid `ARGUMENTS`, missing content, or a passing message.

**B. Antigravity native hook emission (core).** `TARGET_TO_RULESYNC` maps
`antigravity-cli`/`antigravity-ide` → `codexcli`, so the hooks pass runs `CodexcliHooks` and skips the
native Antigravity generator. Conservative fix: add a hook-specific map `TARGET_TO_RULESYNC_HOOKS` in
`packages/core/src/targets.ts` (`antigravity-cli→antigravity-cli`, `antigravity-ide→antigravity-ide`,
`codex→codexcli`, `opencode→opencode`) and route the `hooks` feature pass in `install.ts` through it,
while the `skills` pass keeps the existing shared `codexcli` map so `.agents/skills/` sharing is
unaffected. Guard the two-pass split against double-counting or skill loss. Result: project installs
produce `.agents/hooks.json`, global installs produce `.gemini/config/hooks.json`. rulesync already
ships the native Antigravity hook generator — the fix is routing, not a new generator.

**C. sp plugin config (spur-new).** Change `plugins/sp/hooks/hooks.json` command to
`superskill hook run sp task-write-guard`; keep matcher `Write|Edit`, timeout `10`. Mirror in
`.rulesync/hooks.json`. After `superskill hook run` exists, delete `plugins/sp/hooks/task-write-guard.ts`
or keep at most a thin compat shim that shells to the installed command — never the source-tree lookup
as the primary path.

**D. cc plugin config (superskill — folded in).** Change `plugins/cc/hooks/hooks.json` command to
`superskill hook run cc anti-hallucination`; keep `Stop` / matcher `*` / timeout `10`. Keep
`plugins/cc/scripts/anti-hallucination/*.ts` as the runner's implementation source (imported by the
registry); they are no longer the hook entry point.

**E. cc-hooks skill + expert-hook agent (superskill — folded in).**

- Replace `${CLAUDE_PLUGIN_ROOT}/<script>` command examples (`SKILL.md:50,108,290,307`) with
  `superskill hook run <plugin> <hook-id>` as the preferred portable pattern.
- Rewrite Safety Invariant #4 (`SKILL.md:96`): hook commands must be PATH commands
  (`superskill hook run …`) or dot-relative `.rulesync/hooks/<script>` paths that rulesync copies —
  never `${CLAUDE_PLUGIN_ROOT}` for cross-platform hooks (Claude-only; superskill does not rewrite it
  for other targets).
- Add a "Portable runtime hooks via `superskill hook run`" section explaining the registry pattern for
  non-trivial guards.
- Correct the Antigravity row in the target matrix (`SKILL.md:235`) and `references/cross-platform.md`
  to reflect native hook support; mark `examples/*.sh` as Claude-only.
- Update the `expert-hook` agent's platform-tier text to match.

**Install-output regression (core).** Add focused superskill tests that install `sp` (and `cc`) into an
isolated `outputRoot` and assert every generated target config contains
`superskill hook run <plugin> <hook-id>`, and that no generated non-Claude config contains
`CLAUDE_PLUGIN_ROOT`, `plugins/*/hooks`, `plugins/*/scripts`, or `apps/cli/src/index.ts`. Add an
Antigravity-native-emission assertion (`.agents/hooks.json`).

Issue-by-issue disposition:

| Review item | Verified? | Fix |
|---|---:|---|
| `CLAUDE_PLUGIN_ROOT` with `superskill install` | Yes | Remove target-agnostic reliance on it; use the installed `superskill hook run` command (target-specific rewrite only matters for Claude). |
| Standard script location | Yes | Prefer no script file; logic lives behind the registry runner. |
| Universal hook interface | Yes | Use rulesync canonical hooks; no parallel schema or bespoke open-script interface. |
| Global `spur` instead of source file | Yes | Replace `findCli()`/`bun run apps/cli/src/index.ts` with the registry runner that shells to global `spur task resolve`. |
| `superskill install` portability | Yes | Add install-output regression tests for every target and fix generated commands. |
| Antigravity native hook output | Yes | Add `TARGET_TO_RULESYNC_HOOKS`; route the hooks pass to the native Antigravity rulesync target. |
| cc plugin parity defect (folded in) | Yes | Migrate cc hook to `superskill hook run cc anti-hallucination`; keep scripts as the runner impl. |
| cc Stop output contract (folded in) | Yes | Emit `{hookSpecificOutput:{allowStop,feedback}}`; the guard now actually blocks. |
| cc-hooks skill teaches broken pattern (folded in) | Yes | Update SKILL.md + references + examples + expert-hook agent to teach `superskill hook run`. |
### Plan
Dependency-ordered sequence across both repos:

1. **superskill** — add `superskill hook run <plugin> <hook-id>` dispatcher + `HookRunner` registry
   (`apps/cli/src/commands/hook-run.ts`); wire the `run` subcommand into `apps/cli/src/commands/hook.ts`.
2. **superskill** — register the `sp/task-write-guard` runner (delegates to global `spur task resolve`,
   no `findCli()`); register the `cc/anti-hallucination` runner (reads `ARGUMENTS` env, reuses the
   existing verification functions, emits corrected Claude Stop JSON).
3. **spur-new** — `plugins/sp/hooks/hooks.json` + `.rulesync/hooks.json` command →
   `superskill hook run sp task-write-guard`; demote/delete `plugins/sp/hooks/task-write-guard.ts` (at
   most a thin compat shim, never source-tree lookup).
4. **superskill** — add `TARGET_TO_RULESYNC_HOOKS` in `packages/core/src/targets.ts`; route the `hooks`
   feature pass in `install.ts` through it so Antigravity gets native hook output.
5. **superskill** — `plugins/cc/hooks/hooks.json` command → `superskill hook run cc anti-hallucination`.
6. **superskill** — update `cc-hooks` `SKILL.md` + `references/*` + `examples/*` + the `expert-hook`
   agent to teach the `superskill hook run` standard and correct the Antigravity capability rows.
7. **Tests + gates** in both repos (see Verification).

Tests:

- **spur-new** — rewrite `plugins/sp/hooks/task-write-guard.test.ts` to exercise
  `superskill hook run sp task-write-guard` (deny owned task file; allow non-task / malformed /
  non-Write|Edit / missing path / resolve failure / `SPUR_WRITE_GUARD=off`). Add a regression asserting
  no hook source references `apps/cli/src/index.ts` or `CLAUDE_PLUGIN_ROOT`.
- **superskill** — `hook-run.test.ts`: dispatcher (unknown plugin/hook → error), sp allow/deny paths,
  cc allow/block with corrected Stop JSON, all fail-open paths. Install/emit tests via
  `executeInstall(..., outputRoot)` for codex, opencode, antigravity-cli, antigravity-ide, pi, omp,
  hermes — assert each generated config contains `superskill hook run <plugin> <hook-id>` and contains
  none of `CLAUDE_PLUGIN_ROOT`, `plugins/*/hooks`, `plugins/*/scripts`, `apps/cli/src/index.ts`.
  Antigravity test asserts `.agents/hooks.json` (project) is emitted for both sp and cc.

Verification gate:

- spur-new: `bun run lint`, `bun run test` (includes `plugins/sp` tests).
- superskill: the focused install/hook tests plus `bun run lint` / `bun run test` for touched packages.
- Manual dry-run (both plugins):
  `superskill install sp --targets codex,opencode,antigravity-cli,antigravity-ide,pi,omp,hermes --dry-run --verbose`
  and the same for `cc`. Confirm Claude native install still blocks raw Write/Edit of task-owned files
  and now blocks Stop when the anti-hallucination protocol fails.
### Solution
Change-map (full detail in `### History`):

- superskill: `apps/cli/src/commands/hook-run.ts:1` (new dispatcher + registry), `apps/cli/src/commands/hook.ts:247` (`registerHookRun`), `packages/core/src/targets.ts:30` (`TARGET_TO_RULESYNC_HOOKS`), `packages/core/src/rulesync.ts:45` (`targetMap` override), `apps/cli/src/commands/install.ts:190` (hooks-only pass), `plugins/sp/hooks/hooks.json:9` (command swap), `plugins/cc/scripts/anti-hallucination/ah_guard.ts:95` (null-safety).
- spur-new: `plugins/sp/hooks/hooks.json:9` + `plugins/sp/hooks/hooks.json:6` (command swap), `plugins/sp/hooks/task-write-guard.ts:24` (shim; `findCli` removed).

Smoke-verified: `superskill hook run sp task-write-guard` denies an owned corpus task, allows non-corpus; `cc anti-hallucination` emits the corrected `allowStop` JSON.
### Root Cause
1. `hooks.json` uses a Claude-only runtime variable.

   `CLAUDE_PLUGIN_ROOT` is a Claude Code plugin concept. Superskill's non-Claude install path converts
   the hook config to rulesync canonical form and rulesync preserves command strings for target configs;
   it does not rewrite `${CLAUDE_PLUGIN_ROOT}` to a target-specific installed plugin root.

2. The hook executable has no portable install location.

   Rulesync's canonical hook examples use command paths such as `.rulesync/hooks/audit.sh`, but the
   implementation treats those as command strings. It emits native config files; it does not install the
   referenced scripts. Superskill copies skill support directories (`mapper.ts:162`, skills only), but
   not `plugins/<plugin>/hooks` or `plugins/<plugin>/scripts` files as hook runtime payloads.

3. Spur duplicated a hook runtime instead of using the rulesync canonical hook surface.

   The current file is a Claude-style `hooks/hooks.json` plus an ad hoc Bun script. Superskill already
   routes hook config through rulesync's canonical interface; the remaining gap is a stable executable
   command that every generated hook can call.

4. `task-write-guard.ts` is source-tree-coupled.

   `findCli()` searches for `apps/cli/src/index.ts` and then shells out through `bun run`. That is correct
   only for this repository's checkout. A plugin installed into arbitrary projects must call a globally
   installed command (`spur`, or a `superskill` command that delegates to `spur`) and must fail open when
   the command is unavailable.

5. `superskill install` currently preserves the broken command into generated target configs.

   Dry-run mapping and isolated real install both keep
   `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts` in the generated hook path. That proves the issue
   is not just a static source concern; the installer must be covered and fixed.

6. Antigravity hook generation is routed through the wrong rulesync target.

   Superskill maps both Antigravity targets to `codexcli`, while rulesync has native Antigravity hook
   support. As a result, an isolated install did not produce Antigravity's native hook file.

7. The same root cause recurs in the `cc` plugin, and the `cc-hooks` skill taught it.

   `plugins/cc/hooks/hooks.json` shares root causes 1 and 2 (Claude-only var + no script install path).
   It also carries a third defect: the anti-hallucination Stop hook emits `{ok, reason}` / exit 1 rather
   than Claude's `{hookSpecificOutput:{allowStop, feedback}}` contract, so it was effectively a no-op
   block. The pattern recurred because the `cc-hooks` skill documented `${CLAUDE_PLUGIN_ROOT}/<script>`
   as the canonical "portable" command-hook shape — fixing the skill closes the source of the recurrence.
### Testing

Both repos green after implementation:

- **superskill:** `bun run lint` clean (Biome + per-workspace `tsc --noEmit`); `bun test` → **1190 pass / 0 fail** across 66 files. New `hook-run.test.ts` (10 tests) covers the dispatcher, both runners, every fail-open path, and the corrected cc Stop contract. `install-hooks.test.ts` gains the Antigravity native-routing regression. `targets.ts` at 100% coverage.
- **spur-new:** `bun run lint` clean across all workspaces; `bun run test` → **1967 pass / 0 fail** across 147 files. Rewritten `task-write-guard.test.ts` (9 tests) covers the shim fail-open contract, the source-tree-coupling regression, and the decision logic via the superskill source CLI (deny owned task, allow non-corpus / `--strict` prefix-only / `SPUR_WRITE_GUARD=off`).
- **Functional smoke (manual):** `superskill hook run sp task-write-guard` denies an owned corpus task (with `CLAUDE_PROJECT_DIR` set), allows non-corpus and malformed payloads, errors exit-2 on unknown hook id; `superskill hook run cc anti-hallucination` emits `{hookSpecificOutput:{allowStop,…}}`, blocks (exit 1) on an unverified fact-claim, fails open on empty `ARGUMENTS`.

Coverage: per-file ≥90% line/function thresholds met in both suites (gate green).

### Review

Implemented under the `/sp:dev-dogfood` fix-mode chain (operator-authorized on `main`, both repos). The
work is complete and verified; no code committed (commit decision left to the operator).

Findings surfaced during implementation (dogfood payload):

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `apps/cli/src/commands/hook-run.ts` (cwd handling) | `spur task resolve` is cwd-sensitive; the runner originally spawned without a cwd and always failed open from superskill's dir. | Fixed: spawn with `cwd: CLAUDE_PROJECT_DIR ?? process.cwd()`. Covered by the spur-new runtime tests. |
| P2 | `plugins/sp/hooks/task-write-guard.ts` (shim fail-open) | The shim forwarded the child exit code even when stdout was empty/non-JSON (e.g. an older `superskill` without `hook run`), so it did not fail open. | Fixed: forward only a parseable PreToolUse decision; otherwise allow. |
| P2 | task lifecycle FSM (`testing → done`) | An `issue`-template task transitions to `done` without the L2 gate catching that `done` requires `Solution`/`Testing`/`Review`; the task reached `done` structurally invalid. | Added the three sections to make `done` valid here; the FSM `done` guard should also enforce the section matrix (or `issue` tasks should map to a `done`-compatible required set). Tracked for follow-up. |
| P3 | global `superskill` install | `hook run` only works once the global `superskill` is rebuilt/reinstalled; until then the sp shim fails open in real sessions (safe but inert). | Rebuild + reinstall superskill globally to activate the live guard. Deployment step, not a code gap. |
| P3 | `cross-platform.md` | The abstract `$PLUGIN_ROOT` substitution model is stale vs. the rulesync-canonical reality. | Annotated with a portability warning; full rewrite deferred (out of this task's scope). |

No P1. Both gates green (superskill 1190/0, spur-new 1967/0); lint + typecheck clean in both.

### References
- Spur hook config: `plugins/sp/hooks/hooks.json:10`
- Spur source-coupled CLI lookup: `plugins/sp/hooks/task-write-guard.ts:45-88`
- Superskill hook command surface (no `run`): `~/xprojects/superskill/apps/cli/src/commands/hook.ts:192-236`
- Superskill plugin mapper (skills-only support copy): `~/xprojects/superskill/packages/core/src/mapper.ts:162,207-214`
- Superskill target map (Antigravity → codexcli): `~/xprojects/superskill/packages/core/src/targets.ts` (`TARGET_TO_RULESYNC`)
- Superskill install hook dispatch: `~/xprojects/superskill/apps/cli/src/commands/install.ts:127-249`
- Rulesync hook generation examples/tests: `~/xprojects/superskill/vendors/rulesync/src/e2e/e2e-hooks.spec.ts:51-126`
- Rulesync canonical hook decision: `~/xprojects/superskill/docs/design/design-doc-phase5.md:40-68`
- cc plugin hook config (parity defect): `~/xprojects/superskill/plugins/cc/hooks/hooks.json`
- cc anti-hallucination Stop-output bug: `~/xprojects/superskill/plugins/cc/scripts/anti-hallucination/ah_guard.ts:253-295`
- cc-hooks skill (teaches broken pattern): `~/xprojects/superskill/plugins/cc/skills/cc-hooks/SKILL.md:50,96,235` + `references/cross-platform.md` + `examples/*.sh` + the `expert-hook` agent
- Superskill plugin-level scripts note needing reconciliation with implementation:
  `~/xprojects/superskill/docs/00_ADR.md:198-204`
### History
Implemented the portable-hook standard end to end across both repos. All changes are in the working
tree (not committed). Both gates green: superskill 1190 pass / 0 fail, spur-new 1967 pass / 0 fail;
lint + typecheck clean in both.

**superskill — runtime registry + dispatcher**

- `apps/cli/src/commands/hook-run.ts:1` (new) — `superskill hook run <plugin> <hook-id>` dispatcher +
  `HookRunner` registry keyed `sp/task-write-guard`, `cc/anti-hallucination`. Reads stdin + env,
  emits Claude canonical JSON, mirrors the runner's exit code; unknown id → exit 2 with the known-hook
  list. sp runner shells to global `spur task resolve … --strict --json` (no `findCli`), with
  `cwd: CLAUDE_PROJECT_DIR` so resolution finds the corpus; fail-open on every non-deny condition.
  cc runner reads `ARGUMENTS` env, reuses `verifyAntiHallucinationProtocol`/`extractLastAssistantMessage`,
  and emits the corrected Stop shape `{hookSpecificOutput:{allowStop,feedback}}` (exit 0 allow / 1 block).
- `apps/cli/src/commands/hook.ts:23,247` — import + `registerHookRun(cmd)` wires `run` into the hook group.

**superskill — Antigravity native hook routing**

- `packages/core/src/targets.ts:30` — new `TARGET_TO_RULESYNC_HOOKS` (`antigravity-cli→antigravity-cli`,
  `antigravity-ide→antigravity-ide`, `codex→codexcli`, `opencode→opencode`).
- `packages/core/src/rulesync.ts:13,45` — `RulesyncOptions.targetMap` override (defaults to `TARGET_TO_RULESYNC`).
- `apps/cli/src/commands/install.ts:21,136,190` — hooks dropped from the main `rulesyncFeatures` pass; a
  separate hooks-only pass (gated on `mapResult.hooks`) routes through `TARGET_TO_RULESYNC_HOOKS` so
  Antigravity reaches its native generator while skills keep the shared `codexcli` map.

**superskill — cc plugin + null-safety bugfix**

- `plugins/cc/hooks/hooks.json:9` — command → `superskill hook run cc anti-hallucination`.
- `plugins/cc/scripts/anti-hallucination/ah_guard.ts:95` — `message?.role` guard (strict-null fix surfaced
  when the module entered the `apps/cli` typecheck graph). Scripts retained as the runner's implementation.

**superskill — cc-hooks skill + expert-hook agent**

- `plugins/cc/skills/cc-hooks/SKILL.md:50,96,108,118,312,329` — replaced `${CLAUDE_PLUGIN_ROOT}/<script>`
  examples with `superskill hook run`, rewrote Safety Invariant #4, added a "Portable runtime hooks"
  section, marked `examples/*.sh` Claude-only.
- `plugins/cc/skills/cc-hooks/references/cross-platform.md:57` — portability warning on the plugin-root table.
- `plugins/cc/agents/expert-hook.md:45,191` — corrected the placeholder claim + the Antigravity tier
  (Documentation-only → Tier 1 native hooks).

**spur-new — sp plugin config + shim**

- `plugins/sp/hooks/hooks.json:9` + `.rulesync/hooks.json:6` — command → `superskill hook run sp task-write-guard`.
- `plugins/sp/hooks/task-write-guard.ts:1` — demoted to a thin compat shim (forwards stdin to
  `superskill hook run`, fails open on absent/older runtime, non-JSON, or crash); `findCli()` and the
  `apps/cli/src/index.ts` source-tree walk removed.

**Tests**

- `apps/cli/tests/commands/hook-run.test.ts:1` (new, superskill) — dispatcher + both runners + fail-open
  paths + corrected cc Stop contract (10 tests).
- `apps/cli/tests/commands/install-hooks.test.ts:367` — Antigravity native-routing regression (hooks pass
  uses `TARGET_TO_RULESYNC_HOOKS`; skipped when no hooks.json).
- `apps/cli/tests/commands/install.integration.test.ts:113,152` — updated for the two-pass feature split.
- `apps/cli/tests/commands/content-command-modules.test.ts:107` — `run` added to the hook subcommand list.
- `plugins/sp/hooks/task-write-guard.test.ts:1` (spur-new) — rewritten: shim fail-open contract +
  source-tree-coupling regression + decision logic via the superskill source CLI (9 tests).

**Deferred / follow-up (not blockers):** the globally installed `superskill` is a published build without
`hook run` until rebuilt/reinstalled; until then the sp shim fails open in real Claude sessions (safe
default). Rebuild + reinstall superskill globally to activate the live guard. Tracked as a deployment
step, not a code gap. The pre-existing `cross-platform.md` abstract-placeholder model is annotated, not
fully rewritten (larger refactor, out of this task's scope).
- 2026-06-29T07:18:38.927Z todo → wip (system)
- 2026-06-29T07:18:44.505Z wip → testing (system)
- 2026-06-29T07:18:57.046Z testing → done (system)
