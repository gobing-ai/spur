---
template: issue
schema_version: 1
name: "Make sp task-write-guard hook portable across superskill/rulesync installs"
description: ""
status: todo
type: issue
profile: standard
feature_id: H2
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-06-29T05:34:21.692Z"
updated_at: 2026-06-29T05:55:06.168Z
---

## 0151. Make sp task-write-guard hook portable across superskill/rulesync installs

### Background
Review findings were checked against the current Spur plugin plus local upstream source:

- Spur hook registration: `plugins/sp/hooks/hooks.json:10` invokes
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- Spur hook implementation: `plugins/sp/hooks/task-write-guard.ts:45-88` walks up from
  `CLAUDE_PROJECT_DIR` to `apps/cli/src/index.ts`, then runs `bun run <source-file> task resolve`.
- Superskill mapper: `~/xprojects/superskill/packages/core/src/mapper.ts:93-214` converts plugin
  `hooks.json` into `.rulesync/hooks.json`; it copies support subdirs only for skills, not hook
  script files under `plugins/<plugin>/hooks/`.
- Superskill install path: `~/xprojects/superskill/apps/cli/src/commands/install.ts:127-249`
  sends hooks through rulesync for codex/opencode/antigravity and emits shims/copies for pi/omp/hermes.
- Rulesync hook tests: `~/xprojects/superskill/vendors/rulesync/src/e2e/e2e-hooks.spec.ts:51-126`
  verify that canonical hook command strings are preserved into native target configs.
- Superskill design: `~/xprojects/superskill/docs/design/design-doc-phase5.md:40-68` says the universal
  hook interface is rulesync's canonical `.rulesync/hooks.json` / `HookDefinitionSchema`, not a bespoke
  schema.
- `superskill hook --help` currently exposes `validate`, `evaluate`, `refine`, `evolve`, and `emit`; it
  does not expose the required runtime trigger command `superskill hook run`.

Current install-output verification:

- `superskill install sp --marketplace .claude-plugin --targets codex,pi,omp,opencode,antigravity-cli,antigravity-ide,hermes --dry-run --verbose`
  reports hook support but preserves the bad command in `.rulesync/hooks.json`:
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- A real isolated `executeInstall(..., outputRoot)` writes generated hook configs for codex, opencode,
  pi, omp, and hermes, and every generated hook config still invokes
  `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`.
- The isolated install does not emit a native Antigravity hook file. Superskill maps
  `antigravity-cli` and `antigravity-ide` to rulesync target `codexcli`, while rulesync has a native
  `AntigravityHooks` generator that writes `.agents/hooks.json` in project mode and
  `.gemini/config/hooks.json` in global mode.

Conclusion: all four review concerns are valid for non-Claude installs. Claude Code's native plugin
install can make `${CLAUDE_PLUGIN_ROOT}` meaningful, but rulesync/superskill do not make that variable
portable across the other installed agents, and the guard's in-repo CLI lookup only works inside the
Spur source checkout.
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

  Scenario: Behavior is verified end-to-end
    Given a temp project with a registered tasks folder and an owned task file
    When the hook payload names that task file for Write or Edit
    Then the hook returns a deny decision
    When the hook payload names a non-task file, malformed payload, or unsupported tool
    Then the hook returns allow
```

- [ ] AC-1: `CLAUDE_PLUGIN_ROOT` removed from the sp hook command path for portable targets.
- [ ] AC-2: `task-write-guard` no longer searches for `apps/cli/src/index.ts`.
- [ ] AC-3: `superskill hook run sp task-write-guard` works outside the Spur repo checkout.
- [ ] AC-4: Superskill install/emit tests cover generated hooks for codex, opencode, antigravity, pi/omp/hermes, and Claude where practical.
- [ ] AC-5: Existing guard behavior remains fail-open except for confirmed task-owned Write/Edit payloads.
- [ ] AC-6: Superskill fixes or bridges Antigravity hook emission so native Antigravity hook output is verified.
### Design
Recommended fix: make the hook config portable and move execution behind `superskill hook run`.

Primary design:

1. Keep rulesync canonical hooks as the interface.

   Do not invent a new hook schema. Author `plugins/sp/hooks/hooks.json` in either Claude-compatible
   input form or rulesync canonical form, but the install output must flow through superskill's existing
   `mapPluginToRulesync` plus `rulesync.generate({ features: ['hooks'] })` path.

2. Replace the loose script invocation with `superskill hook run`.

   Preferred command shape:

   ```json
   {
     "type": "command",
     "command": "superskill hook run sp task-write-guard",
     "matcher": "Write|Edit",
     "timeout": 10
   }
   ```

   This belongs in superskill, not Spur, because superskill owns cross-agent plugin installation and hook
   dispatch. `superskill hook --help` currently exposes `validate`, `evaluate`, `refine`, `evolve`, and
   `emit`; add `run` as the runtime-trigger operation that installed hook configs call. The key invariant
   is that generated hook configs call a PATH command, not a file path inside a plugin checkout.

3. Add a superskill hook runtime registry.

   `superskill hook run <plugin> <hook-id>` should resolve the installed plugin, load a known hook runner,
   pass stdin through unchanged, and print the hook response expected by the invoking agent. For `sp
   task-write-guard`, the runner may delegate to global `spur task resolve <path> --strict --json`, but
   that delegation is an implementation detail behind superskill's stable cross-agent hook command.

4. Move the guard logic behind the superskill runner.

   Port or wrap the current stdin parser and decision JSON from `plugins/sp/hooks/task-write-guard.ts`
   behind `superskill hook run sp task-write-guard`. Preserve fail-open behavior for malformed payloads,
   non-Write/Edit tools, missing paths, missing CLI state, subprocess timeout, and unexpected errors.
   Preserve deny behavior only when the underlying task ownership oracle confirms ownership.

5. Make `superskill install` responsible for portable generated hook output.

   Add focused superskill tests that install `sp` into an isolated `outputRoot` and assert every generated
   target config contains `superskill hook run sp task-write-guard`. The test must also assert that
   generated non-Claude configs do not contain `CLAUDE_PLUGIN_ROOT`, `plugins/sp/hooks`, or
   `apps/cli/src/index.ts`.

6. Fix or explicitly bridge Antigravity hook emission.

   Current `TARGET_TO_RULESYNC` maps `antigravity-cli` and `antigravity-ide` to `codexcli`, which emits
   Codex-style hook files and skips rulesync's native Antigravity hook generator. Prefer mapping
   Antigravity targets to rulesync's Antigravity target for hook generation so project installs produce
   `.agents/hooks.json` and global installs produce `.gemini/config/hooks.json`. If skill/rule content
   still needs codex-compatible emission for Antigravity, split hook target emission from the shared
   instruction target instead of losing native hook output.

7. Delete or demote `plugins/sp/hooks/task-write-guard.ts`.

   After `superskill hook run` exists, either remove the script or keep it as a tiny compatibility adapter
   that shells to the installed command. Do not keep source-tree lookup as the primary path.

8. If superskill must support plugin-level hook runtime files, implement that upstream explicitly.

   Current evidence shows no hook-script copy step. If a future design still wants file-backed hook
   executables, add a superskill feature that copies `plugins/<plugin>/scripts` or `.rulesync/hooks/*`
   into a documented installed location and rewrites command paths accordingly. That is larger and less
   clean than the PATH-command design, so treat it as fallback only.

Issue-by-issue disposition:

| Review item | Verified? | Fix |
|---|---:|---|
| `CLAUDE_PLUGIN_ROOT` with `superskill install` | Yes | Remove target-agnostic reliance on it; use installed command or target-specific rewrite only for Claude. |
| Standard script location | Yes | Prefer no script file; otherwise add an explicit superskill copy/rewrite contract. |
| Universal hook interface | Yes | Use rulesync canonical hooks; do not add a parallel schema or bespoke open script interface. |
| Global `spur` instead of source file | Yes | Replace `findCli()`/`bun run apps/cli/src/index.ts` with `superskill hook run sp task-write-guard`; let that runner delegate to global `spur` if needed. |
| `superskill install` portability | Yes | Add install-output regression tests for every supported target and fix generated hook commands. |
| Antigravity native hook output | Yes | Stop mapping Antigravity hooks through `codexcli`, or add a bridge that emits native Antigravity hook config. |
### Plan
1. Update the hook runtime surface.
   - Add `superskill hook run <plugin> <hook-id>` to the hook command surface.
   - Implement `superskill hook run sp task-write-guard` as the runtime command installed hook configs call.
   - Reuse the current guard parser/decision behavior behind the superskill runner.
   - Remove `findCli()` and all `apps/cli/src/index.ts` lookup logic.

2. Update `plugins/sp/hooks/hooks.json`.
   - Change the command from `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts` to `superskill hook run sp task-write-guard`.
   - Keep matcher `Write|Edit` and timeout `10`.
   - Prefer rulesync canonical flat hook form if it simplifies superskill mapping/tests.

3. Add tests in Spur.
   - Unit/subprocess tests for the new command: deny owned task file, allow non-task, allow malformed payload, allow unsupported tool, allow missing path, allow command/resolve failure.
   - Regression assertion that no hook implementation references `apps/cli/src/index.ts`.

4. Add or update superskill/rulesync integration coverage.
   - In `~/xprojects/superskill`, add install/emit tests that call `executeInstall` with an isolated
     `outputRoot` for codex, opencode, antigravity-cli, antigravity-ide, pi, omp, and hermes.
   - Assert every generated hook config contains `superskill hook run sp task-write-guard`.
   - Assert no generated non-Claude hook config contains `CLAUDE_PLUGIN_ROOT`, `plugins/sp/hooks`, or
     `apps/cli/src/index.ts`.
   - Add a focused regression for Antigravity native hook emission (`.agents/hooks.json` for project mode
     or the documented global Antigravity hook path for global mode).
   - Verify Claude native install separately if a local Claude plugin install test is feasible; otherwise document the manual check.

5. Verification gate.
   - `bun test plugins/sp/hooks` or replacement command tests.
   - `bun run lint`.
   - `bun run test`.
   - In superskill, run the focused install/hook tests plus its lint/test gate for touched packages.
   - Manual dry-run: `superskill install sp --targets codex,opencode,antigravity-cli,antigravity-ide,pi,omp,hermes --dry-run --verbose`.
### Root Cause
1. `hooks.json` uses a Claude-only runtime variable.

   `CLAUDE_PLUGIN_ROOT` is a Claude Code plugin concept. Superskill's non-Claude install path converts
   the hook config to rulesync canonical form and rulesync preserves command strings for target configs;
   it does not rewrite `${CLAUDE_PLUGIN_ROOT}` to a target-specific installed plugin root.

2. The hook executable has no portable install location.

   Rulesync's canonical hook examples use command paths such as `.rulesync/hooks/audit.sh`, but the
   implementation treats those as command strings. It emits native config files; it does not install the
   referenced scripts. Superskill currently copies skill support directories, but not `plugins/sp/hooks`
   script files as hook runtime payloads.

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
### References
- Spur hook config: `plugins/sp/hooks/hooks.json:10`
- Spur source-coupled CLI lookup: `plugins/sp/hooks/task-write-guard.ts:45-88`
- Superskill plugin mapper: `~/xprojects/superskill/packages/core/src/mapper.ts:93-214`
- Superskill install hook dispatch: `~/xprojects/superskill/apps/cli/src/commands/install.ts:127-249`
- Rulesync hook generation examples/tests: `~/xprojects/superskill/vendors/rulesync/src/e2e/e2e-hooks.spec.ts:51-126`
- Rulesync canonical hook decision: `~/xprojects/superskill/docs/design/design-doc-phase5.md:40-68`
- Superskill plugin-level scripts note needing reconciliation with implementation:
  `~/xprojects/superskill/docs/00_ADR.md:198-204`
### History
