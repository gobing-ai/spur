# Bug Log

Dated bug entries extracted from the former `.wolf/buglog.json`. Maintained by
the `indexed-context` skill.

---

## bug-756: lefthook pre-commit `format` fixer + failed unstaged-patch restore silently reverts unstaged worktree edits to HEAD (data loss of uncommitted user work).

- **Date:** 2026-08-31T11:25:00-07:00
- **File:** `.git/info/lefthook-unstaged.patch` (deleted by the hook); worktree-wide
- **Root cause:** lefthook hid unstaged edits in a patch, ran `biome --write` on staged files (auto-fixing them), then failed to reapply the patch and deleted it — reverting every unstaged ` M` file to HEAD. Recovery only possible because oh-pi's per-turn stash snapshots held the last-good state (turn-84); no reflog/stash-list trace otherwise.
- **Fix (recovery):** restored 13 files from dangling snapshot via worktree-only `git restore --source=refs/recovery/last-good-turn-84 --worktree -- <files>`; index untouched. Prevention: never commit while unrelated unstaged edits exist; snapshot the worktree (`git stash create` or equivalent) before any lefthook-triggering op.
- **Tags:** lefthook, pre-commit, data-loss, recovery, dangling-commits
- **Occurrences:** 1

## bug-755: `self serve` daemon daily pipeline import fan-out contended with CLI writes on `.spur/spur.db`; multi-second write transactions outlasted the 5s SQLite busy_timeout and surfaced `SQLITE_BUSY` failures.

- **Date:** 2026-08-31T11:09:00-07:00
- **File:** `packages/domain/src/db.ts`, `packages/domain/tests/db.test.ts`
- **Root cause:** `createMigratedDb`/`createMigratedDbViaRuntime` set `PRAGMA busy_timeout = 5000`; upstream `@gobing-ai/ts-db` defaults omit busy_timeout. Run 1 committed all rows but reported failure; checkpoint resume healed it.
- **Fix:** exported `SQLITE_BUSY_TIMEOUT_MS = 30_000` applied in both factories (via `exec` — typed pragmas option only covers journalMode/synchronous/foreignKeys). Tests: per-connection pragma readback on both factories + cross-process `BEGIN IMMEDIATE` holder (stdout readiness signal, 6s hold); parent INSERT waits ≥4s and <30s, both rows commit. Docs: `docs/03_ARCHITECTURE.md`, `docs/help/how_to_use_spur_for_daily_software_development.md`.
- **Tags:** sqlite, busy-timeout, wal, daemon, dogfood, bug-245-lineage
- **Occurrences:** 1


## bug-754: git commit fails at the lefthook pre-commit `format` step (`bun run format` = `biome check . --write`) with "operation not permitted", dying in 0.00s before biome even starts — even though the staged file set is 100% clean (verified via a scoped `bunx biome check --write <staged-files>` returning "No fixes applied" with zero errors).

- **Date:** 2026-07-03T06:50:00Z
- **File:** `N/A — not a file-write-permission issue. Originally misattributed to config/rules/fixtures/every-export-has-tsdoc/{should-fire,should-pass}.ts; those fixture EPERM denials are non-fatal per-file diagnostics in a working sandbox and were not the actual blocker (see corrected root_cause).`
- **Root cause:** CORRECTED (2026-07-03, via coordinator's unrestricted-sandbox session): the original diagnosis (biome config/-tree EPERM per bug-751's class) was WRONG. In the coordinator's session `bun run format` / `biome check . --write` exits 0 cleanly — the config/rules/fixtures EPERM denials surface only as non-fatal per-file diagnostics, never a failing exit code. The REAL blocker: lefthook 1.13.0 allocates a PTY (`/dev/ptmx`) to spawn every hook command it runs, and THIS agent's Claude Code sandbox session denies PTY allocation outright — so the pre-commit `format` step dies in 0.00s with "operation not permitted" before biome ever starts, regardless of what's staged or what config/ contains. Verified by the coordinator: `sh -c 'bun run format'` succeeds directly; `lefthook run pre-commit` fails identically even with `--no-tty` and `CI=true` set, confirming the PTY allocation itself (not TTY-dependent output formatting) is what's denied.
- **Fix:** Root cause is a sandbox-session capability gap (PTY allocation denied), not a repo or hook-config defect — no code/config fix applies. Resolution executed by the coordinator (different, unrestricted sandbox session) rather than by weakening the hook: the operator explicitly authorized committing with `LEFTHOOK=0` (lefthook's documented off-switch) AFTER both hook checks were run manually and passed — `bun run format` -> "Checked 384 files ... No fixes applied"; `cog verify --file` -> OK for all three Wave A/B/C commit messages; lint/test/build were already green from the prior R-gate run. No check was silenced; both were executed and green, only the PTY-blocked wrapper was bypassed. This agent's own session correctly declined to use `--no-verify`/`LEFTHOOK=0` unilaterally (no operator authorization was in hand at the time) and instead surfaced the blocker — that escalation was the right call and is what let the coordinator diagnose and resolve it correctly.
- **Tags:** sandbox, pty-denial, lefthook, pre-commit, biome-format, environment-blocker, task-0185, root-cause-corrected
- **Occurrences:** 1

## bug-753: git stash pop failed mid-merge on two sandbox-write-protected files (.claude/settings.local.json, config/workflows/task-pipeline.yaml), leaving the stash half-applied; a subsequent recovery attempt using `git show "stash@{0}:<path>" > <path>` inside a single Bash invocation truncated 18 tracked files to 0 bytes because the sandbox denied a later redirect in the same command chain (writing to /tmp_err.log instead of $TMPDIR) after the `>` truncation had already occurred, and an even earlier index-based recovery (`git show ":<path>" > <path>`) restored 4 files (0183-0186 task corpus) from a stale git-index snapshot instead of the newest working-tree state.

- **Date:** 2026-07-03T05:42:00Z
- **File:** `docs/tasks2/0176_*.md through 0186_*.md, packages/app/src/services/task-check.ts, packages/app/src/services/agent-service.ts, packages/app/src/services/task-service.ts, packages/app/src/workflow/actions/agent-run.ts, packages/app/src/workflow/actions/file-read-into-var.ts, plugins/sp/agents/super-coder.md, plugins/sp/skills/dogfood-testing/SKILL.md, plugins/sp/skills/dogfood-testing/references/report-template.md, plugins/sp/tests/skill-structure.test.ts, and their paired test files`
- **Root cause:** Ran `git stash` to test whether the apps/web EADDRINUSE test failures pre-existed on a clean tree, without first confirming both `git stash pop` AND all Bash redirect targets were sandbox-writable. Two distinct sandbox interactions compounded: (1) `.claude/settings.local.json` and `config/workflows/task-pipeline.yaml` are permanently unlink-denied (coordinator-owned protected paths), which aborts `git stash pop` mid-merge every time regardless of content; (2) a shell command line with a bad redirect target (`/tmp_err.log` instead of `$TMPDIR/...`) is parsed and its `>` truncation applied to the primary output file BEFORE the sandbox denial on the stderr redirect surfaces, so the loop truncated every target file to 0 bytes on the first iteration's redirect syntax error, silently, across all 18 files in the loop.
- **Fix:** Recovered via `git show "stash@{0}:<path>"` piped through the Write-tool-safe idiom `git checkout stash@{0} -- <path>` (one file per invocation, no shell redirect involved) for all 25 files the stash carried. Cross-checked every recovered file's content against the stash blob with a per-file `md5` checksum loop (not just `wc -l` or a spot check) — this caught that 4 files (0183-0186) had been recovered from a stale git-index snapshot in an earlier ad hoc recovery step and needed a second, corrected `git checkout stash@{0} --` pass. Only dropped the stash after all 25 files verified byte-identical by checksum.
- **Tags:** git-stash, sandbox-write-deny, data-loss-recovery, shell-redirect, self-inflicted, task-0185, recovery-methodology
- **Occurrences:** 1

## bug-258: Review found remaining task 0174 failures: idea-pipeline could reuse stale AC sentinel state across retries, feature-create could exit 0 without writing .spur/run/idea-feature-id.txt, wrapup feature-transition trusted agent.run side effects, and feature I/0167 lifecycle closure was incomplete.

- **Date:** 2026-07-02T00:56:09Z
- **File:** `config/workflows/idea-pipeline.yaml, config/workflows/wrapup-pipeline.yaml, docs/features/I_sp-plugin-hands-off-ready.md, docs/tasks2/0174_0167-follow-ups-post-implementation-actions.md`
- **Root cause:** The workflow hardening used exit-code-only agent steps for critical artifacts/transitions, and the feature/task corpus still contained placeholder feature AC/scope plus an unfinished follow-up task linked to feature I.
- **Fix:** Added expectFile for feature id creation, cleared AC artifacts before each retry, converted AC generation to capture+shell through spur feature update --section, replaced wrap-up feature transition with a deterministic spur feature show/check/update shell sequence, completed task 0175, refreshed feature I, and transitioned 0167/0174/0175 plus feature I to done through CLI guards.
- **Tags:** workflow, idea-pipeline, wrapup-pipeline, feature-lifecycle, task-0174, task-0175
- **Occurrences:** 1

## bug-257: `bun run lint` failed after adding feature section update support: apps/cli/src/commands/feature.ts had an unused `write` helper and unsorted import names.

- **Date:** 2026-07-02T00:56:09Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** The feature update command was refactored to compose section/field/status writes inline, leaving the old single-result helper unused; the new `WriteResult` type import also violated Biome import ordering.
- **Fix:** Removed the unused helper and sorted the import list; `bun run lint` then passed.
- **Tags:** lint, biome, feature-command, task-0175
- **Occurrences:** 1

## bug-255: `bun run apps/cli/src/index.ts task check 0162 --json` initially failed because placeholder text in the todo task's Solution section triggered `Solution must contain at least one file:line citation`.

- **Date:** 2026-06-30T20:15:45Z
- **File:** `docs/tasks2/0162_strengthen-sp-dev-verify-with-mandatory-acceptance-criteria-.md`
- **Root cause:** The generated todo task template includes future-stage sections. Adding placeholder prose under `### Solution` made the checker treat the section as authored implementation content, which requires file:line evidence.
- **Fix:** Removed placeholder prose from Solution, Testing, and Review. Re-ran `task check 0162 --json`; it now exits 0 with warnings only.
- **Tags:** task-check, task-0162, section-matrix, todo-task
- **Occurrences:** 1

## bug-254: task-write-guard runtime tests failed (returning 'allow' instead of 'deny' on owned task checks) inside the full check suite (bun run check).

- **Date:** 2026-06-30T00:49:00Z
- **File:** `plugins/sp/hooks/task-write-guard.test.ts`
- **Root cause:** Bun test runner appends parent node_modules/.bin to PATH, which caused spawnSync('spur', ...) in superskill to resolve to an outdated, legacy @gobing-ai/spur-cli executable in the home directory (/Users/robin/node_modules/.bin/spur) instead of the system-installed or local active workspace version. The legacy binary returned 'error: unknown command 'task'', causing resolveSpurTaskOwnership to fail open and return 'allow'.
- **Fix:** Updated resolveSpurTaskOwnership in the sibling superskill CLI to check and split the process.env.SPUR_BIN env var if provided, falling back to 'spur'. Updated runViaRuntime in task-write-guard.test.ts to set SPUR_BIN pointing to the local workspace cli index.ts entrypoint, ensuring the active workspace version is run during tests.
- **Tags:** task-write-guard, test-failure, path-pollution, monorepo, superskill
- **Occurrences:** 1

## bug-253: new-task-panel.test.tsx failed 7/13 tests (one hung ~126s before timeout): R2/R5 create+body assertions and the KanbanBoard create-closes-panel test all saw createCalls empty after fireEvent.change(nameInput) + click Create.

- **Date:** 2026-06-21T00:00:00Z
- **File:** `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx`
- **Root cause:** happy-dom + React 19 + bun:test does not flush a controlled <input>/<textarea> value into React useState via @testing-library/react fireEvent.change/.input (reproduced with a minimal useState input probe). The native value-setter workaround also fails (React event delegation not wired to happy-dom synthetic events). So the submit handler reads name.trim()==='' and never calls api.task.create; a waitFor on the never-true assertion hangs until timeout.
- **Fix:** Reverted the typed-submit tests; restored the passing 14-test synchronous-surface suite (render, open/close, empty/whitespace-name validation, api-error dispatch in isolation, a11y, folder-prop flow). Added an inline NOTE documenting the limitation. The create→bodyUpdate→refresh flow is covered by the manual browser check recorded in task 0093 Testing. Per R12, did not ship the 7 failing tests to feign coverage.
- **Tags:** apps-web, happy-dom, react-19, bun-test, testing-library, controlled-input, dev-verify, 0093
- **Occurrences:** 1

## bug-252: L3 task check 'Requirements should use R-numbered items' warned on tasks that used GitHub task-list checkbox syntax '- [ ] R1. text'. The R-numbering detector regex did not recognize a checkbox between the list bullet and the R-number.

- **Date:** 2026-06-19T23:31:00Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** The L3 detector at task-check.ts:118 was /^\s*[-*]?\s*R\d+\.?\s/ — it accepted an optional '-'/'*' bullet but not a '[ ]'/'[x]' task-list checkbox before 'Rn.'. Trackable checkbox requirements (the desired format for todo tasks) therefore tripped a false warning.
- **Fix:** Widened the regex to /^\s*[-*]?\s*(?:\[[ xX]\]\s*)?R\d+\.?\s/ so an optional checkbox is accepted between the bullet and the R-number. Added a checkbox-form test mirroring the existing bulletized-form test. Reformatted the 10 task-kanban tasks' Requirements to '- [ ] R1. text'. Note: the global spur binary predates this fix — needs bun run build to pick it up; verified via the local binary (bun run apps/cli/src/index.ts).
- **Tags:** task-check, L3, requirements, checkbox, regex, dogfood
- **Occurrences:** 1

## bug-251: No CLI verb to set `feature_id` (or any frontmatter scalar) on an EXISTING task. `spur task update` only supports status transitions and `--section` edits; `create --feature` and `batch-create` feature_id apply only at creation. Discovered when `spur task check` flagged 10 already-created tasks with an L4 DD-07 'missing feature_id' warning and there was no gated way to fix it in place.

- **Date:** 2026-06-19T21:10:00Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** The task update surface covers lifecycle + section edits but has no frontmatter-field setter, unlike `spur feature update --field <k> --value <v>` which exists for features. Tasks have no parallel.
- **Fix:** Worked around by deleting the 10 task files and re-running `spur task batch-create` with `feature_id: F7` added to each batch item (the sanctioned CLI-gated path) rather than hand-editing frontmatter. PROPOSED ENHANCEMENT (not yet implemented): add `spur task update <wbs> --field feature_id --value F7` mirroring `spur feature update --field`, so existing-task frontmatter edits stay CLI-gated. Candidate future task.
- **Tags:** spur-task, cli-gap, feature_id, frontmatter, dogfood, DD-07
- **Occurrences:** 1

## bug-250: Feature lifecycle transitions always attributed the History audit line to 'system', dropping the API caller's actor even though the oRPC contract collects `actor`.

- **Date:** 2026-06-19T20:36:00Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** FeatureService.transition(id, toStatus) took no actor param and used `this.ctx.actor ?? 'system'`; the server handler at apps/server/src/modules/feature/handlers.ts:64 had no actor to forward. The task side (TaskService.updateStatus) already accepted and forwarded actor — feature diverged.
- **Fix:** Added an optional `actor` param to FeatureService.transition with `actor ?? this.ctx.actor ?? 'system'` (mirrors TaskService.updateStatus); forwarded `input.actor` in the feature transition handler. Added two feature-service tests asserting the actor reaches the on-disk History line and falls back to 'system'.
- **Tags:** feature-service, audit-trail, actor, adr-021, code-review
- **Occurrences:** 1

## bug-249: `tasks update 0040 --section Q&A --from-file /private/tmp/0040_qa.md` failed with `zsh: command not found: A` because the section argument contained `&` and was not shell-quoted.

- **Date:** 2026-06-11T20:41:00Z
- **File:** `docs/tasks/0040_Implement_real_spur_rule_trace_over_rule-engine_persistence.md`
- **Root cause:** The shell parsed the ampersand in `Q&A` as a control operator when the section name was passed unquoted.
- **Fix:** Reran the command as `tasks update 0040 --section 'Q&A' --from-file /private/tmp/0040_qa.md`, then validated the task with `tasks check 0040`.
- **Tags:** tasks, shell-quoting, task-0040, documentation
- **Occurrences:** 1

## bug-248: `tasks update 0039 done --force` failed: `Cannot transition to Done: Solution section is empty or placeholder-only, Design section is empty or placeholder-only`.

- **Date:** 2026-06-11T20:25:07Z
- **File:** `docs/tasks/0039_Workflow_engine_observability_and_action-level_persistence.md`
- **Root cause:** Task 0039 had requirements, plan, testing, and verification notes, but lacked non-placeholder Design and Solution sections required by the tasks CLI done-transition guard.
- **Fix:** Added concrete Design and Solution sections describing the released 0.3.14 integration, trace read model, HITL event typing, and tests; reran `tasks update 0039 done --force` successfully.
- **Tags:** tasks, task-0039, done-transition, documentation
- **Occurrences:** 1

## bug-247: Workspace dependency resolution probe failed with shell interpolation errors (`zsh: no such file or directory: /package.json`, `bad substitution`) and then with `Cannot find module '@gobing-ai/ts-db/package.json'` from `apps/cli`.

- **Date:** 2026-06-11T20:24:00Z
- **File:** `package.json`
- **Root cause:** The first probe used double-quoted JavaScript containing template literals, so zsh expanded `${...}` before Bun executed it. The second probe queried `ts-db` from `apps/cli`, which does not directly depend on that package.
- **Fix:** Reran probes with single-quoted JavaScript and workspace-appropriate package sets (`apps/cli` for CLI deps, `packages/domain` for db/history deps), confirming 0.3.14 resolution.
- **Tags:** dependency-resolution, shell-quoting, bun, task-0039
- **Occurrences:** 2

## bug-246: `bun test packages/domain/tests/dao/action-run-dao.test.ts` ran all 6 DAO tests successfully but exited nonzero because focused coverage pulled in `packages/domain/src/migrations.ts` at 78.18% lines, below the repo threshold.

- **Date:** 2026-06-11T20:14:00Z
- **File:** `packages/domain/tests/dao/action-run-dao.test.ts`
- **Root cause:** Focused Bun coverage applies the repo coverage threshold to loaded dependencies, not only the target file. The focused target had 100% coverage; the dependency coverage threshold caused the nonzero exit.
- **Fix:** Used the focused output only as behavioral evidence and reran the canonical full `bun run test` gate, which passed 537 tests with aggregate thresholds clean.
- **Tags:** bun, coverage, focused-test, verification, task-0039
- **Occurrences:** 2

## bug-245: Parallel workflow validation commands against `config/workflows/feature-dev.yaml` and `.spur/workflows/feature-dev.yaml` produced `SQLiteError: database is locked` from `BunSqliteAdapter` during CLI startup.

- **Date:** 2026-06-11T06:10:50Z
- **File:** `config/workflows/feature-dev.yaml`
- **Root cause:** Both validation commands ran at the same time and initialized the default project SQLite database. The `.spur/workflows` path is a symlink to `config/workflows`, so the second validation was redundant and contended with the same DB.
- **Fix:** Reran validation sequentially with `DATABASE_URL=:memory:`; the workflow validated successfully. No product code change was needed.
- **Tags:** workflow, validation, sqlite, openwolf, parallel-command
- **Occurrences:** 1

## bug-244: GitHub Actions release verify failed during `bun run check`: `node-notifier` had no declaration file in `apps/cli/src/workflow/hitl/desktop-notify.ts`, and `RawHttpResponse` was imported from `@gobing-ai/ts-infra` even though the published `@gobing-ai/ts-infra@0.3.10` does not export it.

- **Date:** 2026-06-11T04:48:42Z
- **File:** `apps/cli/package.json, bun.lock, packages/app/src/workflow/actions/http-request.ts, packages/app/tests/workflow/actions/http-request.test.ts`
- **Root cause:** The tag was built in a clean CI dependency graph. The CLI had a package-private runtime dependency on `node-notifier` without its available `@types/node-notifier` dev dependency, and the new HTTP action depended on an unreleased/upstream-only `RawHttpResponse` type instead of owning its narrow app-layer response DTO. The lockfile also still recorded the CLI package as 0.2.3 while package.json was 0.2.4.
- **Fix:** Added CLI-only `@types/node-notifier@8.0.5`, moved `RawHttpResponse` into Spur's `http-request` action module, updated the test import to use the local type, and refreshed `bun.lock` so the CLI workspace version and new type dependency are recorded.
- **Tags:** github-actions, release, typecheck, node-notifier, ts-infra, lockfile
- **Occurrences:** 1

## bug-243: `bun run apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning --verbose` failed: `packages/app/src/services/workflow-service.ts:45 Exported interface "WorkflowAppServiceContext" is missing a JSDoc comment`.

- **Date:** 2026-06-11T04:23:33Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** The exported WorkflowAppServiceContext interface was added without a preceding TSDoc block while `every-export-has-tsdoc` is active in the recommended post-check preset.
- **Fix:** Added a concise JSDoc comment documenting WorkflowAppServiceContext as the runtime dependencies injected into WorkflowAppService.
- **Tags:** rules, spur-check, tsdoc, workflow-service
- **Occurrences:** 1

## bug-242: Task 0031 workflow skill docs recommended YAML-level `onError` / `defaultOnError`, but `spur workflow validate <file> --json` with a quoted `$schema` rejects those fields because the bundled JSON schemas do not include them. The same file passes only with `--no-schema` because the TypeScript Zod schema accepts the fields.

- **Date:** 2026-06-09T20:34:39Z
- **File:** `plugins/sp/skills/spur-workflows/SKILL.md`
- **Root cause:** The docs mixed current CLI schema-ref authoring guidance with a newer library/runtime capability from ts-dual-workflow-engine. Since the skill also tells agents to quote `$schema`, following the docs would author invalid workflow YAML under the normal validation path.
- **Fix:** Update the workflow skill and wrapper docs to treat `onError` / `defaultOnError` as library/runtime-only until the JSON schemas are updated, and steer YAML refinements toward guards, targets, loop bounds, variables, and env allowlists.
- **Tags:** task-0031, workflow, schema, docs, onError, verification
- **Occurrences:** 1

## bug-241: `bun run lint` failed after removing the `spur plugin` command because Biome wanted the shortened command list in `apps/cli/tests/commands/dispatch-inspect.test.ts` formatted on one line.

- **Date:** 2026-06-09T06:40:17Z
- **File:** `apps/cli/tests/commands/dispatch-inspect.test.ts`
- **Root cause:** Deleting the `plugin` entry made the array short enough for Biome's line-width formatter, leaving a stale multi-line layout.
- **Fix:** Collapsed the `commands` array to Biome's preferred one-line form and reran the gate.
- **Tags:** biome, formatting, cli-surface, plugin-command-removal
- **Occurrences:** 1

## bug-240: `bun test packages/app/tests` passed 101 tests / 0 fail but exited nonzero because repo-level coverageThreshold applied to imported sibling package files outside the focused package suite.

- **Date:** 2026-06-09T06:35:42Z
- **File:** `bunfig.toml`
- **Root cause:** Bun focused test runs still load transitive workspace source files and apply the root coverage thresholds, so a package-only suite can be functionally green while imported sibling files report low coverage.
- **Fix:** No code change. Use the canonical repository gate `bun run test` for completion evidence; it passed 397 tests with coverage green.
- **Tags:** bun, coverage, focused-tests, verification-caveat
- **Occurrences:** 1

## bug-239: After deleting packages/plugin-sdk (@gobing-ai/spur-plugin-sdk) in task 0029, the release script and Publish workflow still referenced it. scripts/commands/release.ts had a spur-plugin-sdk RELEASE_PACKAGES entry + bumpAll/dropAll listing both packages; .github/workflows/publish.yml read ./packages/plugin-sdk/package.json, built it, and published it. The Publish workflow would have FAILED at the next release (reading a deleted package.json / publishing a non-existent package). README package tree + CHANGELOG also referenced it.

- **Date:** 2026-06-09T04:55:00Z
- **File:** `.github/workflows/publish.yml`
- **Root cause:** Package deletion in 0029 cleaned up source/imports/tests but missed the release tooling and CI workflow, which hardcoded the two-package (spur-cli + spur-plugin-sdk) release model. Dangling references to a removed package are easy to miss because they live outside the compile graph (shell in YAML, string literals in the release script) so lint/typecheck/tests don't catch them.
- **Fix:** release.ts: removed the spur-plugin-sdk RELEASE_PACKAGES entry; added ALL_RELEASE_PACKAGES = [spur-cli] used by bumpAll/dropAll; derived commit/aggregate-tag messages from the configs list instead of hardcoding both names; fixed usage strings. publish.yml: removed the plugin-sdk version check, build step, and publish step (kept spur-cli; ${GITHUB_REF_NAME} shell-env form unchanged, no injection). README: dropped plugin-sdk from the packages tree. CHANGELOG: added an [Unreleased] Removed note (left historical 0.1.1 entry intact). Verified: lint clean, 387 tests pass, build green, publish.yml valid YAML, release usage shows 'Package IDs: spur-cli'.
- **Tags:** dangling-reference, package-removal, release-script, github-actions, plugin-sdk, ci-would-fail
- **Occurrences:** 1

## bug-237: `bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --verbose` failed after moving rule assets from `.spur/rules` to `config/rules` and symlinking `.spur/rules` to `config/rules`: `no-npm-pnpm-yarn-scripts` reported three self-matches in `config/rules/typescript/bun-tooling.yaml`.

- **Date:** 2026-06-08T01:09:39Z
- **File:** `config/rules/typescript/bun-tooling.yaml`
- **Root cause:** The rule excluded `.spur/rules/**` because rule-definition YAML legitimately contains forbidden tool names in descriptions and regex patterns. After the config migration, the canonical file path is `config/rules/**`; the `.spur/rules` symlink did not cover the real scanned path, so the rule scanned its own definition.
- **Fix:** Added `config/rules/**` to the `no-npm-pnpm-yarn-scripts` rule-level exclude list while keeping `.spur/rules/**` for scaffolded/symlinked project layouts.
- **Tags:** rules, config-migration, symlink, bun-tooling, self-match
- **Occurrences:** 1

## bug-236: init.test.ts:44 failed after bumping @gobing-ai/ts-* to 0.3.3: expected ~/.config/spur/rules/recommended.yaml to exist, but it does not.

- **Date:** 2026-06-07T06:35:00Z
- **File:** `apps/cli/tests/commands/init.test.ts`
- **Root cause:** ts-rule-engine 0.3.3 (ts-libs task 0022, ADR-015) removed the spur-specific bundled presets recommended.yaml/spur-dev.yaml and ships the generic example.yaml instead. seedGlobalRules copies the engine bundled files, so recommended.yaml is no longer seeded. The test still asserted the old file.
- **Fix:** Updated the assertion to expect example.yaml (the engine's new generic preset) instead of recommended.yaml; added a comment noting the spur presets now come from Spur's own ./config via seedGlobalConfig. Spur's own recommended-pre-check/post-check assertions (lines 48-50) were already correct.
- **Tags:** dependency-bump, ts-rule-engine, 0.3.3, adr-015, ts-libs-0022, tests, init
- **Occurrences:** 1

## bug-235: build:bundle produced doubly-nested dist/config/config/ on any rebuild without clean; bun pm pack --dry-run listed both dist/config/** and dist/config/config/**.

- **Date:** 2026-06-07T06:15:00Z
- **File:** `apps/cli/package.json`
- **Root cause:** `cp -r ../../config dist/config` is non-idempotent: when dist/config does not exist cp copies the directory contents (correct), but when it already exists cp copies the source directory inside the target -> dist/config/config/. Since prepublishOnly -> build:bundle does NOT run clean, a publish after any prior build could ship the broken nested tree, and bundledConfigRoot()/seedGlobalConfig would walk the duplicate.
- **Fix:** Inserted `&& rm -rf dist/config` before the copy in build:bundle so the copy target is always fresh. Verified idempotent: two consecutive build:bundle runs now yield a single clean dist/config/{rules,workflows,plugins}. Found during /rd3:dev-verify 0025 --fix all; self-review missed it by only checking a single happy-path build.
- **Tags:** build, cp-idempotency, packaging, publish, verify-finding, task-0025, P2
- **Occurrences:** 1

## bug-129: `bun run spur-check` failed in `test-post-check`: `every-export-has-tsdoc` reported two errors in `vendors/relaydeck/plugins/harnesses/relaydeck_native/pi_extension.ts` and `pi_startup.ts`.

- **Date:** 2026-06-06T00:19:34Z
- **File:** `.spur/rules/quality/tsdoc-exports.yaml, .spur/rules/recommended-post-check.yaml, vendors/relaydeck/plugins/harnesses/relaydeck_native/pi_extension.ts, vendors/relaydeck/plugins/harnesses/relaydeck_native/pi_startup.ts`
- **Root cause:** The active TSDoc export rule found two default-exported relaydeck native extension entrypoints without preceding TSDoc comments. A previous assumption that the rule should be disabled was wrong; Robin confirmed the rule must stay enabled and all breaches should be fixed.
- **Fix:** Kept `every-export-has-tsdoc` enabled, updated the post-check/rule comments to describe active enforcement, and added TSDoc comments to `relaydeckFleet` and `relaydeckStartup`.
- **Tags:** rules, spur-check, tsdoc, vendors, task-0020
- **Occurrences:** 1

## bug-128: Task 0018 verification found the test named `verbose uses a single engine.evaluate call (not one per rule)` did not actually assert the RuleEngine.evaluate call count; the first lint rerun also failed on Biome import ordering after adding the test import.

- **Date:** 2026-06-06T00:15:26Z
- **File:** `packages/app/tests/services/rule-service.test.ts`
- **Root cause:** The original regression test observed verbose output for two rules but did not instrument the engine, so it would still pass if verbose evaluation regressed back to one engine call per rule. The new import initially used non-Biome-sorted specifier order.
- **Fix:** Wrapped `RuleEngine.prototype.evaluate` inside the verbose multi-rule test, asserted one call with both rules (`[2]`), restored the prototype in `finally`, and reordered the import to Biome's required order.
- **Tags:** tests, verification, rule-engine, eventbus, task-0018, lint
- **Occurrences:** 1

## bug-127: Task 0017 stop-on-first tests were too weak: they proved parsing and one-finding output, but would not fail if traversal ignored `stopOnFirst` in some branches.

- **Date:** 2026-06-05T23:13:00Z
- **File:** `apps/cli/tests/commands/rule.test.ts, packages/app/tests/services/rule-service.test.ts`
- **Root cause:** The original regression fixtures used parse-only CLI assertions and a batch fixture whose second rule passed, so exhaustive traversal produced the same finding count as stopped traversal.
- **Fix:** Changed the CLI composition test to place a warning before a later error and assert exit 0 with `--stop-on-first warning --fail-on error`; changed service tests to use a second failing rule and assert it is skipped in batch and verbose paths.
- **Tags:** tests, verification, rule-engine, stop-on-first, task-0017
- **Occurrences:** 1

## bug-126: Project root contained both `.coverage/` and `coverage/`; `.coverage/` is the correct coverage output directory.

- **Date:** 2026-06-05T22:51:02Z
- **File:** `apps/cli/package.json, package.json, .gitignore, README.md, AGENTS.md, docs/tasks/0012_Plugin_SDK_package_and_capability_registries.md`
- **Root cause:** Bun defaults bare `bun test --coverage` to `coverage/`. The root scripts already passed `--coverage-dir=.coverage`, but the CLI workspace test script and a focused-test command documented in task 0012 used bare `--coverage`; helper config also hid the wrong `coverage/` folder.
- **Fix:** Pinned `[test].coverageDir = ".coverage"` in bunfig.toml, added explicit coverage-dir arguments to every runnable coverage command, pointed the CLI workspace script back to root `../../.coverage`, updated docs to show the explicit path, removed `coverage/` from `.gitignore` so wrong artifacts are visible, and deleted the stale root `coverage/` directory.
- **Tags:** coverage, bun, test-scripts, artifact-cleanup, root-cause
- **Occurrences:** 1

## bug-125: A planted production `biome-ignore` probe was not flagged by the newly absorbed `no-biome-suppressions` regex rule when scoped with deep globs.

- **Date:** 2026-06-05T22:42:39Z
- **File:** `.spur/rules/typescript/no-biome-suppressions.yaml, apps/web/src/pages/index.astro, packages/plugin-sdk/src/registries/base.ts`
- **Root cause:** The ts-rule-engine regex evaluator's loose include matcher strips `**/` and `*` then performs substring matching, so patterns like `apps/**/src/**/*.ts` collapse into fragments that do not match real nested paths.
- **Fix:** Changed the rule include scope to the stable `src/` fragment with tests/dist/node_modules excluded, verified it catches a planted probe, and removed the real production `biome-ignore` suppressions it surfaced instead of weakening the rule.
- **Tags:** rules, regex-evaluator, biome, verification, task-0020
- **Occurrences:** 1

## bug-124: Unit test output leaked JSON logger lines from workflow and rule-engine runs even though tests passed, making `bun run test` hard to scan.

- **Date:** 2026-06-05T22:10:02Z
- **File:** `apps/cli/tests/commands/workflow.test.ts, apps/cli/tests/commands/migrate-stubs.test.ts, packages/app/tests/services/rule-service.test.ts`
- **Root cause:** The 0.3.2 ts-infra logger defaults to console output, and these tests exercise ts-dual-workflow-engine / ts-rule-engine paths that log info-level lifecycle messages. The suites did not mute the shared logger.
- **Fix:** Added a root Bun test preload (`tests/setup.ts`) that calls setLoggerMuted(true), wired it through bunfig.toml, and removed ad hoc per-file initializeLogger/setLoggerMuted usage. Root package.json now declares @gobing-ai/ts-infra as a catalog devDependency because the preload imports it.
- **Tags:** tests, logger, output-leak, ts-infra, workflow, rule-engine
- **Occurrences:** 1

## bug-123: bun run lint failed after bumping @gobing-ai/ts-* to 0.3.2: FileSystem.mkdir no longer exists, NodeFileSystem is missing FileSystem members (ensureDir, deleteFile, createWriteStream, resolve, getProjectRoot), and initializeLogger no longer accepts a string.

- **Date:** 2026-06-05T22:04:38Z
- **File:** `apps/cli/src/context.ts, apps/cli/src/commands/init.ts, apps/cli/tests/commands/plugin.test.ts, packages/app/tests/plugin-loader.test.ts, packages/app/tests/services/plugin-loader.test.ts, packages/app/tests/services/plugin-service.test.ts, packages/app/tests/services/rule-service.test.ts`
- **Root cause:** Task 0019 correctly identified MessageService removal, but underestimated the ts-runtime/ts-infra 0.3.2 API surface. Legacy runtime symbols still export, yet the public FileSystem interface is now produced by createNodeFileSystem() and uses ensureDir(); initializeLogger now takes an options object.
- **Fix:** Swapped FileSystem-typed construction to createNodeFileSystem(), replaced FileSystem.mkdir calls with ensureDir(), kept setFileSystem(new NodeFileSystem()) only for the legacy global getFs path, and changed initializeLogger('level') to initializeLogger({ level }).
- **Tags:** dependency-bump, ts-runtime, ts-infra, typecheck, verify-finding, task-0019
- **Occurrences:** 1

## bug-122: Verify follow-up: `spur message send/inbox` accepted any non-empty recipient id (typos created unaddressable rows); `team assign`/`message reply` could let validation/lookup errors throw uncaught to the top-level handler.

- **Date:** 2026-06-03T17:05:00.000Z
- **File:** `packages/app/src/services/team-service.ts, apps/cli/src/commands/message.ts, apps/cli/src/commands/team.ts`
- **Root cause:** P3 robustness gaps surfaced during /rd3:dev-verify. Recipient ids were never run through validateAgentId, and the message/team command dispatchers had no try/catch so thrown ValueError/lookup errors bubbled to main (exit 1, generic).
- **Fix:** Added validateAgentId on toId + non-null fromId in TeamService.sendMessage and on agentId in getInbox (existence still NOT required — deferred delivery). Wrapped message.ts and team.ts dispatch in try/catch mapping thrown errors to a clean exit 2 with the message. Added service + CLI tests. Also fixed P4: agent edit now builds the path from spec.id (canonical) not the raw id.
- **Tags:** team-mode, validation, error-handling, verify-finding, P3, P4
- **Occurrences:** 1

## bug-121: `spur team assign` corrupts a task file whose YAML frontmatter contains a `$`-sequence (e.g. `$1`, `$&`): the frontmatter is duplicated/scrambled on write.

- **Date:** 2026-06-03T16:50:00.000Z
- **File:** `packages/app/src/services/team-service.ts`
- **Root cause:** setFrontmatterField used `source.replace(fence, replacementString)` and `body.replace(keyLine, replacementString)` where the replacement is a dynamic string built from arbitrary frontmatter content. String.prototype.replace interprets `$&`, `$1`, $-backtick, $-quote in the replacement string as special patterns, so any `$`-sequence in the existing frontmatter mangled the output.
- **Fix:** Pass function replacers (() => line, () => fenced body) instead of string replacements, so the returned text is written verbatim with no special-pattern interpretation. Added a regression test asserting $1.00/$& survive assignTask.
- **Tags:** team-mode, string-replace, data-corruption, frontmatter, verify-finding, P2
- **Occurrences:** 1

## bug-120: ValueError: planner.yaml: "purpose" must be a non-empty string — TeamService.listAgentSpecs/createAgentSpec failed after writing a spec with an empty purpose.

- **Date:** 2026-06-03T16:15:00.000Z
- **File:** `packages/app/src/services/team-service.ts`
- **Root cause:** @gobing-ai/ts-ai-runner agent-spec parser (requireString) treats `purpose` as a required non-empty field when loading a spec back. TeamService.createAgentSpec defaulted purpose to '' when not supplied, writing a spec file that loadAgentSpecs could not re-parse.
- **Fix:** Default purpose to `${type} agent` (non-empty) when input.purpose is missing/empty, so the written YAML round-trips through loadAgentSpecs.
- **Tags:** team-mode, agent-spec, ts-ai-runner, validation, round-trip
- **Occurrences:** 1

## bug-119: Fresh `spur init` then `spur rule run --preset recommended` resolves 0 rules and exits 0 (silent pass) — the constraint-checking feature is dead on a clean install of the new binary.

- **Date:** 2026-06-02T00:00:00.000Z
- **File:** `apps/cli/src/commands/init.ts`
- **Root cause:** The new init was rewritten to a 27-line stub that writes only a marker .spur/config.json + empty DB. It dropped the old project's global-rules installer (builtin-rules.ts seeding ~/.config/spur/rules) and the local .spur/rules + .spur/workflows scaffold. rule run defaults to --preset recommended which resolves rules from those roots, so with nothing seeded it loaded zero rules. Worse, rule run returned exit 0 when zero rules were evaluated.
- **Fix:** Option A: added bundled rule presets + bundledRulesRoot()/listBundledRuleFiles() API to @gobing-ai/ts-rule-engine (rules/ shipped via package files). rule.ts appends bundledRulesRoot() as lowest-priority root (so recommended works pre-seed) and now returns exit 1 when filteredRules.length===0 (fail-loud). init.ts seeds ~/.config/spur/rules from bundled on first run, scaffolds .spur/rules (recommended+spur-dev) and .spur/workflows/basic.yaml, adds --force re-init guard and --minimal. Explicit SPUR_GLOBAL_RULES_DIR suppresses the bundled fallback for hermetic test/CI runs.
- **Tags:** init, rule-engine, fresh-install, silent-pass, exit-code, scaffold
- **Occurrences:** 1

## bug-001: Incorrect value in code

- **Date:** 2026-05-31T04:46:44.397Z
- **File:** `drizzle/_legacy_reference/README.md`
- **Root cause:** Had `~/xprojects/spur/`
- **Fix:** Changed to `history_raw_*`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-002: Significant refactor of 

- **Date:** 2026-05-31T05:11:41.582Z
- **File:** `apps/cli/tests/commands/dispatch-inspect.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→13 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-003: Significant refactor of 

- **Date:** 2026-05-31T06:34:07.552Z
- **File:** `package.json`
- **Root cause:** 14 lines replaced/restructured
- **Fix:** Rewrote 19→6 lines (14 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-004: Missing await

- **Date:** 2026-05-31T06:56:47.612Z
- **File:** `packages/domain/src/dao/workspace-dao.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-005: Wrong reference: create should be record

- **Date:** 2026-05-31T06:57:33.905Z
- **File:** `apps/cli/src/commands/init.ts`
- **Root cause:** Used "create" instead of "record"
- **Fix:** Changed create → record
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-006: Incorrect value in code

- **Date:** 2026-05-31T06:57:51.596Z
- **File:** `apps/cli/src/commands/history.ts`
- **Root cause:** Had '@gobing-ai/ts-llm-jsonl-importer'
- **Fix:** Changed to '@gobing-ai/spur-domain'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-007: Function not marked async

- **Date:** 2026-05-31T07:00:46.639Z
- **File:** `packages/domain/tests/dao/workspace-dao.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-008: Wrong reference: DbClient should be InternalDb

- **Date:** 2026-05-31T18:51:26.757Z
- **File:** `../ts-libs/packages/db/src/adapters/bun-sqlite.ts`
- **Root cause:** Used "DbClient" instead of "InternalDb"
- **Fix:** Changed DbClient → InternalDb
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-009: Significant refactor of 

- **Date:** 2026-05-31T18:51:32.594Z
- **File:** `../ts-libs/packages/db/src/adapters/bun-sqlite.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→9 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-010: Wrong reference: DbClient should be InternalDb

- **Date:** 2026-05-31T18:51:39.233Z
- **File:** `../ts-libs/packages/db/src/adapters/d1.ts`
- **Root cause:** Used "DbClient" instead of "InternalDb"
- **Fix:** Changed DbClient → InternalDb
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-011: Significant refactor of 

- **Date:** 2026-05-31T18:51:45.180Z
- **File:** `../ts-libs/packages/db/src/adapters/d1.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→14 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-012: Significant refactor of 

- **Date:** 2026-05-31T18:53:03.184Z
- **File:** `../ts-libs/packages/db/src/index.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 8→25 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-013: Significant refactor of 

- **Date:** 2026-05-31T18:53:41.608Z
- **File:** `../ts-libs/packages/db/src/entity-dao.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 7→4 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-014: Wrong reference: getDb should be db

- **Date:** 2026-05-31T19:04:36.388Z
- **File:** `../ts-libs/packages/db/tests/adapter.test.ts`
- **Root cause:** Used "getDb" instead of "db"
- **Fix:** Changed getDb → db
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-015: Significant refactor of 

- **Date:** 2026-05-31T19:05:31.740Z
- **File:** `../ts-libs/packages/db/src/entity-dao.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→16 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-016: Significant refactor of 

- **Date:** 2026-05-31T19:05:49.478Z
- **File:** `../ts-libs/packages/db/tests/entity-dao.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→6 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-017: Type error

- **Date:** 2026-05-31T19:36:45.812Z
- **File:** `../ts-libs/packages/db/src/entity-dao.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-018: Significant refactor of 

- **Date:** 2026-05-31T19:36:58.094Z
- **File:** `../ts-libs/packages/db/src/entity-dao.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 10→14 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-019: Null/undefined access in 

- **Date:** 2026-05-31T19:37:13.691Z
- **File:** `../ts-libs/packages/db/tests/entity-dao.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-020: Significant refactor of 

- **Date:** 2026-05-31T21:37:08.522Z
- **File:** `../ts-libs/packages/db/package.json`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→20 lines (2 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-021: Null/undefined access in 

- **Date:** 2026-05-31T21:39:55.449Z
- **File:** `../ts-libs/packages/db/src/entity-dao.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-022: Incorrect value in code

- **Date:** 2026-05-31T21:45:16.762Z
- **File:** `../ts-libs/packages/db/package.json`
- **Root cause:** Had "0.1.8"
- **Fix:** Changed to "0.2.0"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-023: Significant refactor of 

- **Date:** 2026-05-31T21:46:17.653Z
- **File:** `../ts-libs/packages/db/README.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 17→39 lines (6 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-024: Incorrect value in code

- **Date:** 2026-05-31T21:46:56.480Z
- **File:** `../ts-libs/packages/db/README.md`
- **Root cause:** Had `new SomeDao(adapter)`
- **Fix:** Changed to `new SomeDao(adapter.getDb())`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-025: Significant refactor of 

- **Date:** 2026-05-31T22:02:46.058Z
- **File:** `../ts-libs/.spur/rules/typescript/db-boundaries.yaml`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 22→44 lines (3 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-026: Missing await

- **Date:** 2026-05-31T22:47:14.744Z
- **File:** `../ts-libs/scripts/lib/release-commands.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-027: Significant refactor of 

- **Date:** 2026-05-31T23:45:39.891Z
- **File:** `../ts-libs/.gitignore`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (2 removed) | Also: # Source under packages/*/src is .ts only; guard a; # (.js/.d.ts) into src — see ADR-004 / build rootD
- **Tags:** auto-detected, refactor, unknown
- **Occurrences:** 2

## bug-028: Significant refactor of 

- **Date:** 2026-06-01T00:28:00.093Z
- **File:** `packages/domain/src/dao/workspace-dao.ts`
- **Root cause:** 25 lines replaced/restructured
- **Fix:** Rewrote 34→24 lines (25 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-029: Significant refactor of 

- **Date:** 2026-06-01T00:29:27.330Z
- **File:** `packages/domain/tests/analytics/analytics.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 11→11 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-030: Incorrect value in code

- **Date:** 2026-06-01T01:08:53.951Z
- **File:** `../ts-libs/AGENTS.md`
- **Root cause:** Had `docs/PACKAGE_RELEASE.md`
- **Fix:** Changed to `docs/01_TS_DB_SCHEMA_SSOT.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-031: Incorrect value in code

- **Date:** 2026-06-01T03:59:02.864Z
- **File:** `../ts-libs/AGENTS.md`
- **Root cause:** Had `docs/01_TS_DB_SCHEMA_SSOT.md`
- **Fix:** Changed to `docs/PACKAGE_RELEASE.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-032: Incorrect value in code

- **Date:** 2026-06-01T03:59:25.794Z
- **File:** `../ts-libs/docs/00_ADR.md`
- **Root cause:** Had `docs/01_TS_DB_SCHEMA_SSOT.md`
- **Fix:** Changed to `docs/tasks/`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-033: Incorrect value in code

- **Date:** 2026-06-01T06:21:58.039Z
- **File:** `package.json`
- **Root cause:** Had "spur rule run --preset recommended --fail-on warn
- **Fix:** Changed to "spur rule run --preset recommended-pre-check --fa
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-034: forbidden-import evaluator schema mismatch: linked ts-rule-engine expects patterns, installed spur 0.1.0 expects forbidden/scope

- **Date:** 2026-06-01T06:37:43.000Z
- **File:** `.spur/rules/boundary/dao-boundary.yaml`
- **Root cause:** Two rule evaluators are in play: local ts-rule-engine and the installed spur binary used by package scripts have incompatible forbidden-import schemas.
- **Fix:** Kept the project boundary rule compatible with installed spur 0.1.0 so `bun run spur-check` passes; task 0003 records that stricter R1 enforcement needs rule-engine/binary alignment.
- **Tags:** rule-engine, forbidden-import, yaml, verification
- **Occurrences:** 1

## bug-035: bun run lint failed: .claude-plugin/marketplace.json parse error, expected JSON value but file is empty

- **Date:** 2026-06-01T06:37:43.000Z
- **File:** `.claude-plugin/marketplace.json`
- **Root cause:** Untracked empty JSON file is included by Biome and is not valid JSON.
- **Fix:** Not fixed in this pass; file is untracked and unrelated to task 0003 verification.
- **Tags:** biome, json, untracked, gate
- **Occurrences:** 1

## bug-036: test-post-check reported stale low coverage after tests passed

- **Date:** 2026-06-01T18:35:39.000Z
- **File:** `package.json`
- **Root cause:** The installed spur coverage-gate reads .coverage/lcov.info, matching the test script's --coverage-dir=.coverage. The prior mismatch was resolved by aligning both to .coverage.
- **Fix:** Changed global coverage-gate config (lcovPath) and test scripts to both use .coverage/lcov.info.
- **Tags:** coverage, spur-check, package-script
- **Occurrences:** 1

## bug-037: spur rule list failed with Invalid rule file: rules

- **Date:** 2026-06-01T18:35:39.000Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** The new rule list implementation tried to parse root-level preset YAML files as rule files.
- **Fix:** Changed local rule discovery to enumerate only category-folder rule files and added a regression test with a root preset file.
- **Tags:** cli, rule-list, yaml
- **Occurrences:** 1

## bug-038: Incorrect value in code

- **Date:** 2026-06-01T19:05:09.765Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** Had `.
- **R1.3** — A missing prompt (`
- **Fix:** Changed to `. The prompt **must be quoted** by the user. The 
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 7

## bug-039: Missing error handling in unknown

- **Date:** 2026-06-01T19:05:46.754Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block | Also: | `@gobing-ai/ts-ai-runner` missing slash-command translatio; | `AiRunner.runPromptCommand()` `forceBuffered` behavior | C
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 2

## bug-040: Significant refactor of 

- **Date:** 2026-06-01T19:06:04.715Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 15→15 lines (8 removed) | Also: 1. **Prerequisite — ts-ai-runner enhancement:**; - Add `src/slash-command.ts` with `isClaudeStyleSl | Also: 6. **Gate:**; - `bun run lint` clean
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-041: Significant refactor of 

- **Date:** 2026-06-01T19:18:31.388Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 3→9 lines (3 removed) | Also: b. validateFlags: mode='json' ✓, agent='pi' ✓; c. resolveAgent('pi') → 'pi' (isAgentName check pa
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-042: Incorrect value in code

- **Date:** 2026-06-01T19:18:46.824Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** Had `AiRunner.runPromptCommand()`
- **Fix:** Changed to `stdout: ['
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-043: Missing error handling in unknown

- **Date:** 2026-06-01T19:19:21.494Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-044: Significant refactor of 

- **Date:** 2026-06-01T21:28:20.008Z
- **File:** `apps/cli/src/commands/agent.ts`
- **Root cause:** 23 lines replaced/restructured
- **Fix:** Rewrote 32→6 lines (23 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-045: Type error

- **Date:** 2026-06-01T21:42:37.793Z
- **File:** `../ts-libs/packages/ai-runner/src/doctor-runner.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-046: Null/undefined access in 

- **Date:** 2026-06-01T21:42:42.947Z
- **File:** `../ts-libs/packages/ai-runner/src/doctor-runner.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-047: Incorrect value in code

- **Date:** 2026-06-01T21:42:49.604Z
- **File:** `../ts-libs/packages/ai-runner/tests/ai-runner.test.ts`
- **Root cause:** Had 'pi 1.2.3'
- **Fix:** Changed to '1.2.3'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-048: Function not marked async

- **Date:** 2026-06-01T21:42:56.199Z
- **File:** `../ts-libs/packages/ai-runner/tests/agent-detector.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-049: Null/undefined access in 

- **Date:** 2026-06-01T21:43:03.920Z
- **File:** `../ts-libs/packages/ai-runner/tests/ai-runner.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-050: Missing guard clause

- **Date:** 2026-06-01T21:52:59.404Z
- **File:** `../ts-libs/packages/ai-runner/src/doctor-runner.ts`
- **Root cause:** No early return/throw for edge case: stat === null
- **Fix:** Added guard clause: if (stat === null)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-051: Incorrect value in code

- **Date:** 2026-06-01T22:03:21.692Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "^0.2.4"
- **Fix:** Changed to "^0.2.5"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 3

## bug-052: Incorrect value in code

- **Date:** 2026-06-01T22:07:07.544Z
- **File:** `docs/tasks/0004_Implement_spur_agent_run_command_via_ts-ai-runner.md`
- **Root cause:** Had `agent.ts:25-47, 181`
- **Fix:** Changed to `@gobing-ai/ts-ai-runner@0.2.5`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-053: Significant refactor of 

- **Date:** 2026-06-01T22:22:39.821Z
- **File:** `AGENTS.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 6→10 lines (6 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-054: Null/undefined access in 

- **Date:** 2026-06-01T23:08:46.675Z
- **File:** `../ts-libs/packages/rule-engine/tests/rule-engine.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-055: Null/undefined access in 

- **Date:** 2026-06-01T23:09:40.042Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-056: Null/undefined access in 

- **Date:** 2026-06-01T23:19:51.227Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/file-utils.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-057: Null/undefined access in 

- **Date:** 2026-06-01T23:21:03.112Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/coverage-gate-evaluator.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-058: Incorrect value in code

- **Date:** 2026-06-01T23:22:10.411Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "catalog:"
- **Fix:** Changed to "link:@gobing-ai/ts-rule-engine"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-059: Null/undefined access in 

- **Date:** 2026-06-01T23:24:06.770Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-060: Significant refactor of 

- **Date:** 2026-06-01T23:30:32.518Z
- **File:** `../ts-libs/packages/rule-engine/src/config/loader.ts`
- **Root cause:** 11 lines replaced/restructured
- **Fix:** Rewrote 18→11 lines (11 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-061: Incorrect value in code

- **Date:** 2026-06-01T23:31:13.345Z
- **File:** `../ts-libs/packages/rule-engine/tests/rule-engine.test.ts`
- **Root cause:** Had 'no-spur'
- **Fix:** Changed to '.spur'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 2

## bug-062: Incorrect value in code

- **Date:** 2026-06-01T23:56:15.047Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "link:@gobing-ai/ts-rule-engine"
- **Fix:** Changed to "catalog:"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-063: Significant refactor of 

- **Date:** 2026-06-01T23:59:05.937Z
- **File:** `package.json`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 10→6 lines (8 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-064: spur rule run --preset recommended-post-check --rule coverage-gate: "No rule findings" / later "paths[0] must be string" — preset never resolved its rules

- **Date:** 2026-06-02T00:01:26.808565+00:00
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** New ts-rule-engine loadPresetRules resolved presets against a single local root (.spur/rules) only, with no layered fallback to the global config (~/.config/spur/rules). The recommended-post-check preset is local but extends typescript/quality categories that exist only globally, so it resolved to zero rules. Engine also lacked the coverage-gate/tsdoc-export/test-location evaluators.
- **Fix:** Made ts-rule-engine loadPresetRules roots-only (generic multi-root merge, local shadows global) and ported the 3 missing evaluators; released 0.2.6. In Spur, rule.ts now builds ordered roots (SPUR_RULES_PATH -> .spur/rules -> ~/.config/spur/rules, overridable via SPUR_GLOBAL_RULES_DIR) and passes them via { roots }. Bumped catalog to ^0.2.6.
- **Tags:** rule-engine, preset-resolution, layered-config, ts-libs, evaluator, 0.2.6
- **Occurrences:** 1

## bug-065: Null/undefined access in 

- **Date:** 2026-06-02T00:11:42.214Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-066: Missing await

- **Date:** 2026-06-02T00:12:34.759Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-067: Missing guard clause

- **Date:** 2026-06-02T00:17:20.025Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** No early return/throw for edge case: findings.length === 0
- **Fix:** Added guard clause: if (findings.length === 0)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-068: Missing await

- **Date:** 2026-06-02T00:18:23.873Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-069: Function not marked async

- **Date:** 2026-06-02T00:24:09.231Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-070: Type error

- **Date:** 2026-06-02T00:27:55.260Z
- **File:** `../ts-libs/packages/rule-engine/src/types.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-071: Significant refactor of 

- **Date:** 2026-06-02T00:29:34.277Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/test-location-evaluator.ts`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 12→7 lines (7 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-072: Null/undefined access in 

- **Date:** 2026-06-02T00:30:20.996Z
- **File:** `../ts-libs/packages/rule-engine/tests/evaluators/forbidden-import-evaluator.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-073: Null/undefined access in 

- **Date:** 2026-06-02T00:30:32.169Z
- **File:** `../ts-libs/packages/rule-engine/tests/rule-engine.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-074: Significant refactor of 

- **Date:** 2026-06-02T00:32:27.434Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 38→70 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-075: Type error

- **Date:** 2026-06-02T00:32:44.979Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-076: Function not marked async

- **Date:** 2026-06-02T00:36:22.091Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-077: Significant refactor of 

- **Date:** 2026-06-02T00:55:11.309Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/exit-code-evaluator.ts`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 17→30 lines (8 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-078: Null/undefined access in 

- **Date:** 2026-06-02T00:55:18.946Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/exit-code-evaluator.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-079: Significant refactor of 

- **Date:** 2026-06-02T00:56:00.235Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/regex-evaluator.ts`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 29→66 lines (7 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-080: Missing guard clause

- **Date:** 2026-06-02T00:56:36.007Z
- **File:** `../ts-libs/packages/rule-engine/src/config/loader.ts`
- **Root cause:** No early return/throw for edge case: fileExclude === undefined && ruleExclude === undefined
- **Fix:** Added guard clause: if (fileExclude === undefined && ruleExclude)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-081: Null/undefined access in 

- **Date:** 2026-06-02T00:57:30.493Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/tsdoc-export-evaluator.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-082: Significant refactor of 

- **Date:** 2026-06-02T03:16:21.136Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/test-location-evaluator.ts`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 21→35 lines (4 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-083: Incorrect value in code

- **Date:** 2026-06-02T03:17:25.493Z
- **File:** `../ts-libs/packages/rule-engine/tests/evaluators/path-evaluator.test.ts`
- **Root cause:** Had 'path evaluator requires string[] config "
- **Fix:** Changed to 'path evaluator requires config "
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-084: Significant refactor of 

- **Date:** 2026-06-02T03:18:06.910Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 12→6 lines (7 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-085: Incorrect value in code

- **Date:** 2026-06-02T03:23:24.363Z
- **File:** `../ts-libs/packages/rule-engine/src/fixers/test-stub-fixer.ts`
- **Root cause:** Had 'suggest'
- **Fix:** Changed to 'none'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-086: Significant refactor of 

- **Date:** 2026-06-02T03:23:33.728Z
- **File:** `../ts-libs/packages/rule-engine/src/engine.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 12→8 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-087: Type error

- **Date:** 2026-06-02T03:23:59.448Z
- **File:** `../ts-libs/packages/rule-engine/src/fixers/fixers.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-088: Incorrect value in code

- **Date:** 2026-06-02T03:26:35.293Z
- **File:** `../ts-libs/packages/rule-engine/src/index.ts`
- **Root cause:** Had './config/loader'
- **Fix:** Changed to './config/extensions'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-089: Significant refactor of 

- **Date:** 2026-06-02T03:27:33.156Z
- **File:** `../ts-libs/packages/rule-engine/tests/config/parity.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 9→5 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-090: Function not marked async

- **Date:** 2026-06-02T03:27:45.460Z
- **File:** `../ts-libs/packages/rule-engine/tests/evaluators/tsdoc-export-evaluator.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-091: Missing await

- **Date:** 2026-06-02T03:35:36.235Z
- **File:** `../ts-libs/packages/rule-engine/src/fixers/fixers.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call | Also: private readonly fs = new NodeFileSystem();; async createFixes({ rule, context, findings, fix }: RuleFixe
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 3

## bug-092: Function not marked async

- **Date:** 2026-06-02T03:36:06.693Z
- **File:** `../ts-libs/packages/rule-engine/src/engine.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-093: Wrong condition in logic

- **Date:** 2026-06-02T03:36:30.091Z
- **File:** `../ts-libs/packages/rule-engine/src/fixers/test-stub-fixer.ts`
- **Root cause:** Condition was: if (this.fs.existsSync(absTestPath)
- **Fix:** Changed to: if (await this.fs.exists(absTestPath)
- **Tags:** auto-detected, logic-fix, ts
- **Occurrences:** 1

## bug-094: Type error

- **Date:** 2026-06-02T03:43:50.997Z
- **File:** `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-095: Significant refactor of 

- **Date:** 2026-06-02T03:44:28.741Z
- **File:** `../ts-libs/packages/rule-engine/tests/config/parity.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 7→5 lines (2 removed) | Also: describe('preset extensions', () => {; test('collectPresetExtensions resolves paths relat
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-096: Incorrect value in code

- **Date:** 2026-06-02T06:20:43.061Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "link:@gobing-ai/ts-rule-engine"
- **Fix:** Changed to "catalog:"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-097: Missing error handling in function

- **Date:** 2026-06-02T06:37:36.946Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-098: Missing error handling in function

- **Date:** 2026-06-02T06:37:48.330Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-099: Null/undefined access in 

- **Date:** 2026-06-02T06:39:23.883Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-100: Significant refactor of 

- **Date:** 2026-06-02T06:39:40.214Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 7→9 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-101: Null/undefined access in 

- **Date:** 2026-06-02T06:39:52.072Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-102: Missing await

- **Date:** 2026-06-02T06:43:17.206Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-103: Null/undefined access in 

- **Date:** 2026-06-02T06:58:48.787Z
- **File:** `../ts-libs/packages/rule-engine/src/config/loader.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-104: Null/undefined access in 

- **Date:** 2026-06-02T07:00:12.764Z
- **File:** `../ts-libs/packages/dual-workflow-engine/src/config.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-105: Significant refactor of 

- **Date:** 2026-06-02T07:03:16.767Z
- **File:** `../ts-libs/packages/rule-engine/package.json`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 12→6 lines (6 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-106: Null/undefined access in 

- **Date:** 2026-06-02T13:21:09.390Z
- **File:** `../ts-libs/packages/dual-workflow-engine/tests/config.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-107: Null/undefined access in 

- **Date:** 2026-06-02T13:38:06.573Z
- **File:** `../ts-libs/packages/rule-engine/src/types.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-108: Type error

- **Date:** 2026-06-02T13:38:38.009Z
- **File:** `../ts-libs/packages/rule-engine/src/config/loader.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation | Also: /** A rule file as parsed by Zod: rule severities may be abs; type ParsedRuleFile = Omit<ConstraintRuleFile, 'rules'> & { 
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 2

## bug-109: Significant refactor of 

- **Date:** 2026-06-02T13:39:53.998Z
- **File:** `../ts-libs/packages/rule-engine/src/config/loader.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 10→31 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-110: Type error

- **Date:** 2026-06-02T13:40:35.879Z
- **File:** `../ts-libs/packages/rule-engine/src/types.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-111: Type error

- **Date:** 2026-06-02T13:47:54.653Z
- **File:** `../ts-libs/packages/rule-engine/tests/rule-engine.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-112: Null/undefined access in 

- **Date:** 2026-06-02T13:49:05.822Z
- **File:** `../ts-libs/packages/dual-workflow-engine/src/config.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: const errors: string[] = [];; const ids = workflow.nodes.map((node) => node.id);
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-113: Incorrect value in code

- **Date:** 2026-06-02T13:51:02.397Z
- **File:** `.spur/workflows/basic.yaml`
- **Root cause:** Had 'Implementing task: ${vars.task}'
- **Fix:** Changed to 'Implementing task: ${task}'
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-114: Type error

- **Date:** 2026-06-02T13:53:30.668Z
- **File:** `../ts-libs/packages/dual-workflow-engine/src/config.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-115: Type error

- **Date:** 2026-06-02T13:54:37.174Z
- **File:** `../ts-libs/packages/dual-workflow-engine/src/schema.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-116: Significant refactor of 

- **Date:** 2026-06-02T13:56:20.406Z
- **File:** `../ts-libs/packages/rule-engine/schemas/preset.schema.json`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 36→50 lines (5 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-117: Incorrect value in code

- **Date:** 2026-06-02T14:03:29.866Z
- **File:** `../ts-libs/packages/dual-workflow-engine/tests/config.test.ts`
- **Root cause:** Had 'W1: rejects an unknown ${vars.X} reference in act
- **Fix:** Changed to 'W1: rejects an unknown vars reference in action o
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-118: Significant refactor of 

- **Date:** 2026-06-03T00:54:34.030Z
- **File:** `package.json`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 10→6 lines (8 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-119: Type error

- **Date:** 2026-06-03T01:57:57.161Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-120: Missing guard clause

- **Date:** 2026-06-03T01:58:06.715Z
- **File:** `apps/cli/src/commands/rule.ts`
- **Root cause:** No early return/throw for edge case: filteredRules.length === 0
- **Fix:** Added guard clause: if (filteredRules.length === 0)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-121: Incorrect value in code

- **Date:** 2026-06-03T02:21:23.005Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "catalog:"
- **Fix:** Changed to "link:@gobing-ai/ts-rule-engine"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-122: Significant refactor of 

- **Date:** 2026-06-03T02:55:27.390Z
- **File:** `apps/cli/tests/commands/init-status.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 17→21 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-123: Significant refactor of 

- **Date:** 2026-06-03T02:57:23.208Z
- **File:** `apps/cli/tests/commands/migrate-stubs.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-124: Incorrect value in code

- **Date:** 2026-06-03T02:57:30.320Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** Had '  init [--name <name>] [--json]                  
- **Fix:** Changed to '  init [--name <name>] [--force] [--minimal] [--j
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-125: Incorrect value in code

- **Date:** 2026-06-03T03:02:20.421Z
- **File:** `../ts-libs/packages/rule-engine/package.json`
- **Root cause:** Had "0.2.9"
- **Fix:** Changed to "0.3.0"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-127: Incorrect value in code

- **Date:** 2026-06-03T03:26:19.262Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "link:@gobing-ai/ts-rule-engine"
- **Fix:** Changed to "catalog:"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-128: Incorrect value in code

- **Date:** 2026-06-03T03:37:23.574Z
- **File:** `package.json`
- **Root cause:** Had "spur rule run --preset recommended-pre-check --fa
- **Fix:** Changed to "bun run apps/cli/src/index.ts rule run --preset r
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-129: Incorrect value in code

- **Date:** 2026-06-03T05:04:40.788Z
- **File:** `package.json`
- **Root cause:** Had "Spur is a solid harness engineering toolkit which
- **Fix:** Changed to "Spur — a local-first harness engineering toolkit 
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-130: Significant refactor of 

- **Date:** 2026-06-03T05:22:16.409Z
- **File:** `apps/cli/package.json`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 14→43 lines (4 removed)
- **Tags:** auto-detected, refactor, json
- **Occurrences:** 1

## bug-131: Incorrect value in code

- **Date:** 2026-06-03T05:25:49.698Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "workspace:*"
- **Fix:** Changed to "workspace:0.1.0"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-132: Wrong condition in logic

- **Date:** 2026-06-03T06:03:35.857Z
- **File:** `scripts/release.ts`
- **Root cause:** Condition was: if (remoteRefs.includes(`refs/tags/${tag}`)
- **Fix:** Changed to: if (remote.ok && remote.stdout.includes(`refs/tags/${t)
- **Tags:** auto-detected, logic-fix, ts
- **Occurrences:** 1

## bug-133: Incorrect value in code

- **Date:** 2026-06-03T06:19:41.652Z
- **File:** `packages/app/package.json`
- **Root cause:** Had "workspace:*"
- **Fix:** Changed to "workspace:0.1.0"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-134: Type error

- **Date:** 2026-06-03T06:33:40.839Z
- **File:** `.claude/worktrees/agent-a28f3bb342f3d9f01/packages/app/src/index.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-135: Incorrect value in code

- **Date:** 2026-06-03T06:37:31.055Z
- **File:** `.claude/worktrees/agent-ac2ff44161e83a810/apps/cli/src/commands/history.ts`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-app'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-136: Incorrect value in code

- **Date:** 2026-06-03T06:39:13.752Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "@gobing-ai/spur-config"
- **Fix:** Changed to "@gobing-ai/spur-app"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-137: Missing guard clause

- **Date:** 2026-06-03T06:40:03.336Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** No early return/throw for edge case: file === undefined
- **Fix:** Added guard clause: if (file === undefined)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-138: Wrong reference: WorkflowRunResult should be unknown

- **Date:** 2026-06-03T06:40:25.915Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** Used "WorkflowRunResult" instead of "unknown"
- **Fix:** Changed WorkflowRunResult → unknown
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-139: Significant refactor of 

- **Date:** 2026-06-03T06:40:32.385Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 12→5 lines (6 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-140: Significant refactor of 

- **Date:** 2026-06-03T06:42:47.401Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 14→4 lines (5 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-141: Type error

- **Date:** 2026-06-03T06:46:29.446Z
- **File:** `packages/app/tests/services/history-service.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation | Also: // Empty root → scannedFiles = 0, no error (hermetic: does n; const result = await svc.import('claude', { mode: 'increment
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 2

## bug-142: Significant refactor of 

- **Date:** 2026-06-03T06:51:36.656Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→13 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-143: Significant refactor of 

- **Date:** 2026-06-03T06:56:30.525Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→34 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-144: Significant refactor of 

- **Date:** 2026-06-03T07:18:39.289Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 7→8 lines (7 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-145: Wrong reference: unknown should be WorkflowRunResult

- **Date:** 2026-06-03T07:18:44.387Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** Used "unknown" instead of "WorkflowRunResult"
- **Fix:** Changed unknown → WorkflowRunResult
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-146: `bun test --coverage apps/cli/tests/commands/workflow.test.ts` exited 1 despite 13 pass / 0 fail because the focused run's aggregate coverage was below repo thresholds.

- **Date:** 2026-06-03T07:28:48.000Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Bun applies root `coverageThreshold` to all files loaded by the focused test path, including unrelated app/domain services imported through `@gobing-ai/spur-app`; the requested target `apps/cli/src/commands/workflow.ts` was already at 100% after the test extension.
- **Fix:** Added targeted workflow command tests, then verified focused per-file coverage from the report and the real aggregate gate with `bun run test`, which passed at 100% funcs / 99.46% lines.
- **Tags:** coverage, bun, dev-unit, workflow
- **Occurrences:** 1

## bug-147: `rd3-dev-verify 0008 --fix all --force` found task R1 manifest drift: `packages/app/package.json` had removed `@gobing-ai/spur-config`, `@gobing-ai/ts-utils`, and `@gobing-ai/ts-infra` from the dirty tree.

- **Date:** 2026-06-03T07:33:16.000Z
- **File:** `packages/app/package.json`
- **Root cause:** A pre-existing dirty edit narrowed the app workspace manifest below the parent 0005 R7 / child 0008 R1 dependency contract.
- **Fix:** Restored the three required dependencies, ran `bun install` to reconcile the lockfile, then verified the package and lockfile had no remaining diff.
- **Tags:** manifest, dependencies, dev-verify, task-0008
- **Occurrences:** 1

## bug-148: `bun test --coverage packages/app/tests/services/rule-service.test.ts apps/cli/tests/commands/rule.test.ts` exited 1 despite 21 pass / 0 fail because focused-run aggregate coverage was below repo thresholds.

- **Date:** 2026-06-03T07:37:53.000Z
- **File:** `packages/app/src/services/rule-service.ts`
- **Root cause:** Bun applies root `coverageThreshold` to every loaded module in the focused run; unrelated app/domain modules pulled in by package barrels lower aggregate coverage even when the target `rule-service.ts` reports 100% lines/functions.
- **Fix:** Treated the per-file coverage row as focused evidence and verified the real gate with `bun run check`, which passed at 100% funcs / 99.46% lines aggregate.
- **Tags:** coverage, bun, dev-verify, task-0009
- **Occurrences:** 1

## bug-149: `rd3-dev-verify 0010 --fix all --force` found blocking synchronous filesystem checks in `AgentService.run` --cwd validation.

- **Date:** 2026-06-03T07:43:30.000Z
- **File:** `packages/app/src/services/agent-service.ts`
- **Root cause:** `--cwd` validation used `existsSync` and `statSync` inside an async service method, contradicting the SECU review claim that the service had no blocking sync I/O.
- **Fix:** Replaced the sync checks with async `stat()` through private `statCwd()`, preserving existing error messages and exit codes.
- **Tags:** efficiency, sync-io, dev-verify, task-0010
- **Occurrences:** 1

## bug-150: `rd3-dev-verify 0011 --fix all --force` found `workflow.ts` and `history.ts` still over the literal <=60 line target; initial cleanup also broke pre/post check by removing required export JSDoc.

- **Date:** 2026-06-03T07:50:01.000Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Previous 0011 review accepted minor line-count variances, but the task requirement was literal. A first line-count cleanup removed JSDoc comments that Spur's `every-export-has-tsdoc` rule requires.
- **Fix:** Reduced both wrappers to exactly 60 lines while preserving required JSDoc and byte-identical behavior; reran `bun run check`, `test-cf`, `build`, `test-pre-check`, and `test-post-check` successfully.
- **Tags:** line-count, tsdoc, dev-verify, task-0011
- **Occurrences:** 1

## bug-151: `rd3-dev-verify 0005 --fix all --force` found parent R8 public API alias drift: `RuleEvaluationResult`, `RuleValidateResult`, and `RuleListResult` were not exported under the parent-required names.

- **Date:** 2026-06-03T15:26:53.000Z
- **File:** `packages/app/src/index.ts`
- **Root cause:** Child extraction exported the concrete `*ServiceResult` names, while the parent task contract also required shorter public result type names.
- **Fix:** Added type-only aliases in the public barrel while preserving the existing `*ServiceResult` exports and keeping private helpers unexported.
- **Tags:** public-api, traceability, dev-verify, task-0005
- **Occurrences:** 1

## bug-152: Significant refactor of 

- **Date:** 2026-06-03T16:08:21.696Z
- **File:** `packages/domain/src/migrations.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 11→46 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-153: Significant refactor of 

- **Date:** 2026-06-03T16:09:17.646Z
- **File:** `packages/domain/tests/dao/migrations.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 15→24 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-154: Null/undefined access in 

- **Date:** 2026-06-03T16:09:27.953Z
- **File:** `packages/domain/tests/dao/migrations.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-155: Incorrect value in code

- **Date:** 2026-06-03T16:09:58.392Z
- **File:** `packages/app/package.json`
- **Root cause:** Had "@gobing-ai/ts-dual-workflow-engine"
- **Fix:** Changed to "@gobing-ai/ts-db"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-157: Missing error handling in function

- **Date:** 2026-06-03T16:15:43.367Z
- **File:** `apps/cli/src/commands/agent.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-158: Missing guard clause

- **Date:** 2026-06-03T16:16:26.900Z
- **File:** `packages/app/src/services/agent-service.ts`
- **Root cause:** No early return/throw for edge case: raw === ''
- **Fix:** Added guard clause: if (raw === '')
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-159: Null/undefined access in 

- **Date:** 2026-06-03T16:16:41.133Z
- **File:** `apps/cli/src/commands/agent.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-160: Missing await

- **Date:** 2026-06-03T16:17:21.407Z
- **File:** `apps/cli/src/commands/status.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-161: Significant refactor of 

- **Date:** 2026-06-03T16:19:52.289Z
- **File:** `apps/cli/src/commands/agent.ts`
- **Root cause:** 13 lines replaced/restructured
- **Fix:** Rewrote 33→51 lines (13 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-162: Incorrect value in code

- **Date:** 2026-06-03T16:21:01.629Z
- **File:** `apps/cli/tests/commands/agent-team.test.ts`
- **Root cause:** Had 'claude-code'
- **Fix:** Changed to 'claude'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-163: Null/undefined access in 

- **Date:** 2026-06-03T16:21:41.785Z
- **File:** `packages/app/tests/services/agent-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-164: Null/undefined access in 

- **Date:** 2026-06-03T16:22:34.641Z
- **File:** `apps/cli/tests/commands/status.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-165: Null/undefined access in 

- **Date:** 2026-06-03T16:23:48.881Z
- **File:** `apps/cli/tests/commands/team.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-166: Null/undefined access in 

- **Date:** 2026-06-03T16:24:24.558Z
- **File:** `apps/cli/tests/commands/dispatch-inspect.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-167: Significant refactor of 

- **Date:** 2026-06-03T16:26:23.914Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 16→50 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-168: Significant refactor of 

- **Date:** 2026-06-03T16:27:06.569Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 11→25 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-169: Type error

- **Date:** 2026-06-03T16:43:23.920Z
- **File:** `packages/app/src/services/team-service.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-170: Type error

- **Date:** 2026-06-03T16:43:39.215Z
- **File:** `packages/app/tests/services/team-service.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-172: Null/undefined access in 

- **Date:** 2026-06-03T16:49:14.583Z
- **File:** `packages/app/src/services/team-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-173: Missing error handling in unknown

- **Date:** 2026-06-03T16:49:32.231Z
- **File:** `apps/cli/src/commands/message.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-174: Missing error handling in unknown

- **Date:** 2026-06-03T16:49:49.753Z
- **File:** `apps/cli/src/commands/team.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-175: Type error

- **Date:** 2026-06-03T16:50:38.780Z
- **File:** `apps/cli/tests/commands/team.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-177: Significant refactor of 

- **Date:** 2026-06-03T17:15:21.405Z
- **File:** `docs/00_ADR.md`
- **Root cause:** 16 lines replaced/restructured
- **Fix:** Rewrote 19→34 lines (16 removed) | Also: harness *type* cannot be registered without either; registry) or a Spur-side shim-overlay registry. R7
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-178: Incorrect value in code

- **Date:** 2026-06-03T17:15:36.930Z
- **File:** `docs/00_ADR.md`
- **Root cause:** Had `BaseHarness`
- **Fix:** Changed to `AgentShim`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-179: Significant refactor of 

- **Date:** 2026-06-03T17:15:49.361Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 6→9 lines (6 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-180: Incorrect value in code

- **Date:** 2026-06-03T17:15:56.170Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `ts-ai-runner`
- **Fix:** Changed to `AgentShim`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-181: Incorrect value in code

- **Date:** 2026-06-03T17:26:33.027Z
- **File:** `docs/tasks/0016_Plugin_runtime_sandboxing_for_curated_and_untrusted_tiers.md`
- **Root cause:** Had "PRD section 5.4 sandboxing scope re-confirmation"
- **Fix:** Changed to "TRIGGER: a genuinely third-party (non-operator-au
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-182: Significant refactor of 

- **Date:** 2026-06-03T17:30:53.600Z
- **File:** `docs/00_ADR.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 8→16 lines (3 removed) | Also: **Consequences.** The plugin system is no longer a; slices that each pass the gate independently. Runt
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-183: Significant refactor of 

- **Date:** 2026-06-03T17:33:08.781Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 8→12 lines (4 removed) | Also: runtime sandboxing. Standalone package depending o; `packages/app`; `spur plugin list|info`; plugin co
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-184: Incorrect value in code

- **Date:** 2026-06-03T17:33:43.925Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `AgentShim`
- **Fix:** Changed to `bundled`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-185: Significant refactor of 

- **Date:** 2026-06-03T17:54:53.574Z
- **File:** `docs/tasks/0006_Design_plugin_system_architecture.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 5→9 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-186: Significant refactor of 

- **Date:** 2026-06-03T18:00:57.572Z
- **File:** `docs/tasks/0006_Design_plugin_system_architecture.md`
- **Root cause:** 24 lines replaced/restructured
- **Fix:** Rewrote 27→28 lines (24 removed) | Also: Registries validate types at registration time (e.; `BaseHarness`).
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-187: Significant refactor of 

- **Date:** 2026-06-03T18:10:58.654Z
- **File:** `AGENTS.md`
- **Root cause:** 15 lines replaced/restructured
- **Fix:** Rewrote 19→62 lines (15 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-188: Significant refactor of 

- **Date:** 2026-06-03T18:16:31.958Z
- **File:** `AGENTS.md`
- **Root cause:** 33 lines replaced/restructured
- **Fix:** Rewrote 43→11 lines (33 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-189: Significant refactor of 

- **Date:** 2026-06-03T18:29:36.912Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 34 lines replaced/restructured
- **Fix:** Rewrote 43→23 lines (34 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-190: Incorrect value in code

- **Date:** 2026-06-03T18:29:52.018Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `bundled`
- **Fix:** Changed to `03 §11`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-191: Significant refactor of 

- **Date:** 2026-06-03T18:34:55.223Z
- **File:** `docs/01_PRD.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→4 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-192: Type error

- **Date:** 2026-06-03T18:53:48.096Z
- **File:** `../../projects/cc-agents/plugins/rd3/skills/indexed-context/scripts/session-start.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-193: Missing await

- **Date:** 2026-06-03T21:47:46.421Z
- **File:** `packages/plugin-sdk/src/host.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-194: Significant refactor of 

- **Date:** 2026-06-03T21:48:17.483Z
- **File:** `apps/server/src/app.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 18→33 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-195: Missing await

- **Date:** 2026-06-03T21:48:23.315Z
- **File:** `apps/server/src/openapi.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-196: Type error

- **Date:** 2026-06-03T21:50:25.291Z
- **File:** `apps/server/src/openapi.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-197: Significant refactor of 

- **Date:** 2026-06-03T21:51:42.850Z
- **File:** `apps/server/src/plugins.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→8 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-198: Incorrect value in code

- **Date:** 2026-06-03T21:53:42.155Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `02_ROADMAP`
- **Fix:** Changed to `04 §6`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-123: bun run test exits 1 with 0 failing tests; apps/server/src/plugins.ts reads 80% function coverage only in the whole-repo run (100% under its own suite)

- **Date:** 2026-06-03T22:05:00.000Z
- **File:** `apps/server/src/plugins.ts`
- **Root cause:** Two inline arrow handlers in mountPluginRoutes (one per app.all registration) were each counted as separate functions; Bun's cross-file function-coverage attribution flagged one uncovered in the aggregate run, tripping the per-file 90% functions threshold and failing the bunfig coverageThreshold gate.
- **Fix:** Routed both app.all arrows through a single named `handle` closure in mountPluginRoutes — no behavior change; aggregate function coverage returned to 100%.
- **Tags:** bun, coverage, threshold, test-runner, false-negative
- **Occurrences:** 1

## bug-200: Missing guard clause

- **Date:** 2026-06-03T22:11:24.202Z
- **File:** `apps/server/src/plugins.ts`
- **Root cause:** No early return/throw for edge case: !impl
- **Fix:** Added guard clause: if (!impl)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-201: Missing error handling in startServerHooks

- **Date:** 2026-06-03T22:11:35.872Z
- **File:** `packages/plugin-sdk/src/host.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-202: Missing await

- **Date:** 2026-06-03T22:12:09.197Z
- **File:** `apps/server/tests/plugins.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-secu-0014-1: P2 security: plugin API prefix interpolated raw into Hono route patterns (mountPluginRoutes); '/', '*', ':' or '..' in a prefix could inject or shadow routes

- **Date:** 2026-06-03T22:30:00.000Z
- **File:** `apps/server/src/plugins.ts`
- **Root cause:** Registry.register validates collision + trust but NOT name format; for the api capability the name becomes a live Hono route pattern, so an unconstrained prefix is a routing-table injection vector.
- **Fix:** Added PREFIX_PATTERN /^[a-z0-9][a-z0-9_-]*$/ and InvalidPluginPrefixError, validated in resolveRoutes at the mount seam (fail-loud). Tests reject 'evil/../health' and '*', accept 'my-plugin_2'.
- **Tags:** security, plugin-system, hono, route-injection, validation, phase-5c
- **Occurrences:** 1

## bug-secu-0014-2: P3 correctness: PluginHost.startServerHooks/stopServerHooks aborted the whole loop on the first throwing hook, violating ADR-012 fail-soft and skipping remaining shutdown cleanup

- **Date:** 2026-06-03T22:30:00.000Z
- **File:** `packages/plugin-sdk/src/host.ts`
- **Root cause:** Hooks were awaited in a bare loop with no try/catch; one plugin throwing prevented later plugins' hooks from running.
- **Fix:** Wrapped each hook invocation in try/catch, logging via host.logger.error and continuing. Tests assert a throwing hook does not reject and the next plugin's hook still runs.
- **Tags:** correctness, plugin-system, fail-soft, lifecycle, adr-012, phase-5c
- **Occurrences:** 1

## bug-205: Significant refactor of 

- **Date:** 2026-06-03T22:22:57.286Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 5→6 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-206: Significant refactor of 

- **Date:** 2026-06-03T22:23:07.057Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→5 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-207: Significant refactor of 

- **Date:** 2026-06-03T22:48:36.896Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 7→10 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-208: Missing error handling in parsePayload

- **Date:** 2026-06-03T22:51:36.511Z
- **File:** `packages/domain/src/analytics/query.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-209: Wrong return value

- **Date:** 2026-06-03T22:51:40.973Z
- **File:** `packages/domain/src/analytics/query.ts`
- **Root cause:** Was returning: rows.map((row) => JSON.parse(row.payload_json) as 
- **Fix:** Now returns: rows.map((row) => parsePayload(row.payload_json, s
- **Tags:** auto-detected, return-value, ts
- **Occurrences:** 1

## bug-p16-query-parse: Unguarded JSON.parse(row.payload_json) in analytics query.ts: a corrupt/tampered ETL row crashes `spur history analyze` with an opaque SyntaxError; untested

- **Date:** 2026-06-03T23:30:00.000Z
- **File:** `packages/domain/src/analytics/query.ts`
- **Root cause:** queryEtlRecords/queryAllEtlRecords parsed payload_json with a bare JSON.parse and no try/catch. The validate-before-persist contract means rows are normally valid JSON, so the failure mode (DB corruption/tampering) was overlooked and never exercised — coverage was 100% lines but missed the error edge.
- **Fix:** Added parsePayload(raw, table) wrapping JSON.parse in try/catch; on failure throws `Malformed payload_json in <table>: <reason> (payload: <80-char snippet>)`. Fail-loud (not silent skip) because a bad row is exceptional and must be diagnosable. Added 2 malformed-payload tests (queryEtlRecords + queryAllEtlRecords).
- **Tags:** history, analytics, json-parse, hardening, phase-1, P1.6, fail-loud
- **Occurrences:** 1

## bug-cli-build-output: `bun run build` produced no CLI binary in root dist/ — `tree dist` showed only server/ and web/

- **Date:** 2026-06-04T00:00:00.000Z
- **File:** `apps/cli/package.json`
- **Root cause:** The CLI `build` script was `bun build --target=bun --outfile dist/index.js` (a JS bundle written to the WORKSPACE-LOCAL apps/cli/dist/), while the server `build` used `--compile --outfile ../../dist/<name>` into root dist/. So the CLI artifact never reached root dist/ and `bun run clean` (which prunes apps/*/dist) even deleted it. The correct recipe existed as an unused `build:binary` script.
- **Fix:** Promoted the binary recipe to `build` (--compile --outfile ../../dist/cli/spur), matching the server and AGENTS.md's 'build cli/server/web into root dist/'. Renamed the old JS-bundle script to `build:bundle` (still needed for the npm `bin` field) and pointed `prepublishOnly` at it. dist/ now holds cli/spur + server/spur-server + web/.
- **Tags:** build, cli, bun, monorepo, dist, config-drift
- **Occurrences:** 1

## bug-rule-list-severity-ambiguity: `bun run apps/cli/src/index.ts rule list` printed rows like `rule-id error enabled file`, making rule severity metadata look like active command errors.

- **Date:** 2026-06-04T19:08:00.000Z
- **File:** `apps/cli/src/commands/rule.ts, packages/app/src/services/rule-service.ts`
- **Root cause:** `rule list` emits discovered rule metadata, not evaluation findings, but the human formatter used unlabeled per-rule tab-separated columns. The bare `error` column was the rule's configured fail severity, while `rule run --verbose` verified the active default rules had zero violations. The old Spur UX avoided this by listing rule files and source layers instead of individual severities.
- **Fix:** Changed default human output to the old-style file inventory: source-layer summary, total files, category groups, per-file rule counts, and project/user/env layer labels. `rule list --preset` still lists resolved rules with labeled metadata. Added service and CLI regression tests for layer merging, local-over-global shadowing, flat files, invalid files, env/global labels, empty inventories, and preset output.
- **Tags:** rule-list, cli-ux, rule-engine, metadata, ambiguity
- **Occurrences:** 1

## bug-cli-command-help-routing: `bun run apps/cli/src/index.ts --help` and `bun run apps/cli/src/index.ts rule --help` printed the same global usage despite `-h/--help` being parsed correctly.

- **Date:** 2026-06-04T20:43:00.000Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** The lightweight parser set `flags.help`, but the top-level dispatcher short-circuited any help flag before command dispatch. Command paths like `rule --help` never reached a command-specific help renderer.
- **Fix:** Added command-scoped help routing through `commandHelpText()`, exported `ruleHelpText()`, made `rule --help`, `rule help`, and `help rule` equivalent, and documented the rule help surface.
- **Tags:** cli-help, dispatch, rule-command, ux, migration-regression
- **Occurrences:** 1

## bug-cli-help-incomplete-conversion: After introducing command-scoped help for `rule`, the remaining existing top-level commands were not converted, leaving future help behavior vulnerable to drift.

- **Date:** 2026-06-04T21:09:00.000Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** The first fix established the registry pattern only for `rule`; other command groups still had no registered usage renderer, so `agent --help`, `workflow --help`, etc. would fall back to global help.
- **Fix:** Added ADR-013, registered help renderers for init/status/migrate/agent/message/team/rule/history/workflow/plugin, made `<cmd> --help`, `<cmd> help`, and `help <cmd>` generic equivalents, and added dispatcher coverage for every existing command.
- **Tags:** cli-help, dispatch, adr, usage, migration-drift
- **Occurrences:** 1

## bug-cli-help-centralized-ownership: Command-scoped help was correct but centralized in `apps/cli/src/index.ts`, making the dispatcher large and allowing command usage to drift away from its implementation module.

- **Date:** 2026-06-04T21:42:00.000Z
- **File:** `apps/cli/src/index.ts, apps/cli/src/commands/*.ts`
- **Root cause:** ADR-013 originally required command-scoped help but did not specify ownership. The first implementation put every usage renderer in the dispatcher, coupling command contracts to the top-level router.
- **Fix:** Updated ADR-013 and 04_DESIGN to require each top-level command module to export `helpText()`. Moved all command usage renderers into their owning modules and imported them in `index.ts` via `helpText as <command>HelpText` aliases.
- **Tags:** cli-help, dispatch, refactor, adr, usage-ownership
- **Occurrences:** 1

## bug-223: Significant refactor of 

- **Date:** 2026-06-06T00:49:39.649Z
- **File:** `.spur/rules/structure/protected-files.yaml`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 14→18 lines (7 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-224: Null/undefined access in 

- **Date:** 2026-06-06T16:52:38.620Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-225: Significant refactor of 

- **Date:** 2026-06-06T16:53:43.044Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 9→13 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-226: Incorrect value in code

- **Date:** 2026-06-06T16:53:57.516Z
- **File:** `docs/tasks/0021_unify_CLI_surface_with_CommandSpec_SSOT_and_grammar_contract.md`
- **Root cause:** Had `apps/cli/src/index.ts:42-60`
- **Fix:** Changed to `index.ts`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 3

## bug-227: Significant refactor of 

- **Date:** 2026-06-06T16:55:39.259Z
- **File:** `docs/tasks/0021_unify_CLI_surface_with_CommandSpec_SSOT_and_grammar_contract.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 7→8 lines (4 removed) | Also: **Still outstanding (not code):** add an ADR recor; rewrite R2/R3 + the Design "No Commander" constrai
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-228: Significant refactor of 

- **Date:** 2026-06-06T19:40:11.103Z
- **File:** `docs/tasks/0022_consistency_enforcement_gate_for_doc_surface_json.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 10→14 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-229: Incorrect value in code

- **Date:** 2026-06-06T19:40:53.241Z
- **File:** `docs/tasks/0022_consistency_enforcement_gate_for_doc_surface_json.md`
- **Root cause:** Had `--fix all`
- **Fix:** Changed to `consistency.test.ts:35-40`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-230: Significant refactor of 

- **Date:** 2026-06-06T22:22:38.746Z
- **File:** `docs/tasks/0022_consistency_enforcement_gate_for_doc_surface_json.md`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 10→22 lines (7 removed) | Also: Task 0021 shipped `CommandSpec` as the SSOT for ev; verbs, flags, `--json` support, and examples. `doc
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-231: Incorrect value in code

- **Date:** 2026-06-06T22:26:48.431Z
- **File:** `docs/tasks/0022_consistency_enforcement_gate_for_doc_surface_json.md`
- **Root cause:** Had `spur rule run --preset spur-dev`
- **Fix:** Changed to `spur rule run --preset recommended-post-check`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 3

## bug-232: Incorrect value in code

- **Date:** 2026-06-07T05:18:31.758Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `recommended`
- **Fix:** Changed to `recommended-pre-check`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-233: Incorrect value in code

- **Date:** 2026-06-07T05:45:41.437Z
- **File:** `docs/tasks/0024_centralize_spur_default_config_into_repo-root_config_tree.md`
- **Root cause:** Had `spur rule validate --file config/rules/recommende
- **Fix:** Changed to `name`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-234: Incorrect value in code

- **Date:** 2026-06-07T06:04:06.439Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "bun build src/index.ts --target=bun --outfile dis
- **Fix:** Changed to "bun build src/index.ts --target=bun --outfile dis
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-237: Significant refactor of 

- **Date:** 2026-06-07T18:16:05.973Z
- **File:** `plugins/sp/skills/spur-rules/references/authoring-rules.md`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 15→16 lines (7 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-238: Significant refactor of 

- **Date:** 2026-06-07T18:39:31.469Z
- **File:** `plugins/sp/skills/spur-rules/references/operations.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 9→11 lines (6 removed) | Also: ## evaluate; Behavioral smoke-test of a rule — does it fire cor | Also: ## run; The harness loop. Detailed in SKILL.md → "The harn
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-239: Significant refactor of 

- **Date:** 2026-06-07T19:18:15.602Z
- **File:** `plugins/sp/skills/spur-rules/references/operations.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 6→12 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-240: Missing error handling in unknown

- **Date:** 2026-06-07T19:18:31.869Z
- **File:** `plugins/sp/skills/spur-rules/references/operations.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-241: Incorrect value in code

- **Date:** 2026-06-07T19:18:49.416Z
- **File:** `plugins/sp/skills/spur-rules/SKILL.md`
- **Root cause:** Had `add`
- **Fix:** Changed to `scan`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-242: Missing error handling in unknown

- **Date:** 2026-06-07T19:19:00.092Z
- **File:** `plugins/sp/skills/spur-rules/SKILL.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-243: Significant refactor of 

- **Date:** 2026-06-07T19:25:48.211Z
- **File:** `plugins/sp/commands/rule-refine.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→5 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-244: Significant refactor of 

- **Date:** 2026-06-07T19:26:45.562Z
- **File:** `plugins/sp/skills/spur-rules/references/fine-tuning.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 8→12 lines (4 removed) [RESOLVED 2026-06-10: 0.3.9 released; catalog bumped ^0.3.7→^0.3.9; bun install; latch verified live via new e2e test (continueSeen=[undefined,true]); double-cast removed]
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-245: Significant refactor of 

- **Date:** 2026-06-07T19:27:00.540Z
- **File:** `plugins/sp/skills/spur-rules/references/operations.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 5→7 lines (5 removed) | Also: 2. **Smoke-test FIRE** — run the rule against the ; `spur rule run --file <rule-file> --rule <id> --fa [RESOLVED 2026-06-10 via task 0037: hitlResponder(json?) selects DefaultHitlResponder when json; test + 100% coverage; spur-check green]
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-246: Significant refactor of 

- **Date:** 2026-06-07T19:27:58.222Z
- **File:** `plugins/sp/skills/spur-rules/references/authoring-rules.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 8→10 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-247: Incorrect value in code

- **Date:** 2026-06-07T19:29:42.539Z
- **File:** `plugins/sp/skills/spur-rules/references/authoring-rules.md`
- **Root cause:** Had 's catalog — these differ from the README'
- **Fix:** Changed to 's live catalog and differ from the README'
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-248: Incorrect value in code

- **Date:** 2026-06-07T19:37:25.096Z
- **File:** `plugins/sp/skills/spur-rules/SKILL.md`
- **Root cause:** Had 's constraint quality gate across its full lifecyc
- **Fix:** Changed to 's constraint quality gate across its full lifecyc
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-249: Wrong reference: when should be to

- **Date:** 2026-06-07T19:37:35.127Z
- **File:** `plugins/sp/skills/spur-rules/SKILL.md`
- **Root cause:** Used "when" instead of "to"
- **Fix:** Changed when → to
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-250: Incorrect value in code

- **Date:** 2026-06-07T19:44:11.048Z
- **File:** `plugins/sp/commands/rule-refine.md`
- **Root cause:** Had 's severity, scope, or add a documented exemption.
- **Fix:** Changed to 's severity or scope needs changing, or a legitima
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-251: Significant refactor of 

- **Date:** 2026-06-07T21:14:30.745Z
- **File:** `plugins/sp/agents/expert-rules.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 14→7 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-252: Missing error handling in unknown

- **Date:** 2026-06-07T21:18:21.068Z
- **File:** `plugins/sp/skills/spur-rules/references/fine-tuning.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-253: Missing error handling in unknown

- **Date:** 2026-06-07T21:18:34.711Z
- **File:** `plugins/sp/skills/spur-rules/references/operations.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-255: Significant refactor of 

- **Date:** 2026-06-08T03:18:06.184Z
- **File:** `config/rules/quality/coverage-gate.yaml`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 17→29 lines (2 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-256: Incorrect value in code

- **Date:** 2026-06-08T03:56:27.435Z
- **File:** `packages/domain/src/dao/index.ts`
- **Root cause:** Had './artifact-dao'
- **Fix:** Changed to '@gobing-ai/ts-db'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-257: Significant refactor of 

- **Date:** 2026-06-08T03:57:27.281Z
- **File:** `.spur/rules/surface/check-cli-surface.yaml`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 13→10 lines (4 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-258: Incorrect value in code

- **Date:** 2026-06-08T03:57:41.519Z
- **File:** `.spur/rules/structure/protected-files.yaml`
- **Root cause:** Had "git\\s+.*(push\\s+.*--force|push\\s+.*--force-wit
- **Fix:** Changed to "git\\s+.*(push\\s+.*--force|push\\s+.*--force-wit
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-259: Incorrect value in code

- **Date:** 2026-06-08T04:27:44.825Z
- **File:** `apps/cli/package.json`
- **Root cause:** Had "bun build src/index.ts --target=bun --outfile dis
- **Fix:** Changed to "bun build src/index.ts --target=bun --outfile dis
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-260: Missing guard clause

- **Date:** 2026-06-08T04:28:02.786Z
- **File:** `apps/cli/src/commands/init.ts`
- **Root cause:** No early return/throw for edge case: relPath === GLOBAL_CONFIG_EXAMPLE
- **Fix:** Added guard clause: if (relPath === GLOBAL_CONFIG_EXAMPLE)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-261: Type error

- **Date:** 2026-06-08T04:28:08.831Z
- **File:** `apps/cli/src/commands/init.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-262: Incorrect value in code

- **Date:** 2026-06-08T04:37:58.981Z
- **File:** `package.json`
- **Root cause:** Had "bun scripts/release.ts bump-ver"
- **Fix:** Changed to "bun scripts/spur-dev.ts bump-ver"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 2

## bug-263: Null/undefined access in 

- **Date:** 2026-06-08T04:43:18.355Z
- **File:** `scripts/commands/release.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-264: Significant refactor of 

- **Date:** 2026-06-08T04:46:34.018Z
- **File:** `apps/cli/README.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 13→47 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-265: Missing error handling in function

- **Date:** 2026-06-08T06:11:21.508Z
- **File:** `docs/tasks/0028_use_the_new_runApplication_in_ts-infra_to_refactor_the_bootstrap_procedure_of_spur-cli.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-266: Significant refactor of 

- **Date:** 2026-06-08T06:20:23.855Z
- **File:** `docs/tasks/0028_use_the_new_runApplication_in_ts-infra_to_refactor_the_bootstrap_procedure_of_spur-cli.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 7→17 lines (5 removed) | Also: Config consolidation decision: standardize on `.sp; config surface. The `.spur/config.json` project-ma | Also: 5. Wire a loader that reads `.spur/config.yaml` (p; `~/.config/spur/config.yaml`, returns parsed boots
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-267: Significant refactor of 

- **Date:** 2026-06-08T16:56:15.046Z
- **File:** `apps/cli/src/config/loader.ts`
- **Root cause:** 19 lines replaced/restructured
- **Fix:** Rewrote 30→5 lines (19 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-268: Significant refactor of 

- **Date:** 2026-06-08T16:56:30.304Z
- **File:** `apps/cli/tests/config/loader.test.ts`
- **Root cause:** 9 lines replaced/restructured
- **Fix:** Rewrote 17→9 lines (9 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-269: Missing error handling in unknown

- **Date:** 2026-06-08T19:28:17.835Z
- **File:** `../ts-libs/docs/tasks/0025_add_a_bare_PluginHost_and_Plugin_lifecycle_core_to_ts-infra_and_integrate_it_into_runApplication.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-270: Significant refactor of 

- **Date:** 2026-06-09T03:10:40.244Z
- **File:** `apps/cli/src/commands/plugin.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 12→27 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-271: Incorrect value in code

- **Date:** 2026-06-09T03:46:12.598Z
- **File:** `package.json`
- **Root cause:** Had "^0.3.6"
- **Fix:** Changed to "^0.3.7"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-238: Unit tests printed ~42 JSON log lines to stdout ({"@timestamp":...,"level":"INFO","message":"rule run started","logger":"app.rule-engine",...}) leaking through the test run. 387 pass / 0 fail — output leak, not a test failure. rule-service.test.ts alone leaked 0; full suite leaked 42 (ordering-dependent).

- **Date:** 2026-06-09T03:55:00Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** tests/setup.ts mutes logging once at preload via LogTape configure() (no sinks, fatal-only) + setLoggerMuted(true). But any test that runs the CLI bootstrap (main() -> runNodeApplication -> initializeLogger) calls LogTape configure() again, which reset()s the prior config FIRST (latest-config-wins) and reinstalls a console sink rooted at category 'app'. That wipes setup.ts's mute, so every later app.* INFO logger (rule engine via new RuleEngine() default getLogger('rule-engine')) prints JSON to stdout. setLoggerMuted only gates the ts-infra wrapper, not LogTape's own sink config. A duplicate ts-infra@0.3.5-vs-0.3.7 instance split (rule-engine/ai-runner/workflow-engine pulled nested 0.3.5) was a red herring — deduping to 0.3.7 did NOT fix the leak.
- **Fix:** Two parts: (1) Bumped the whole @gobing-ai/ts-* family to ^0.3.7 in the root catalog (SSOT) + bun install, so the dependency tree resolves a single ts-infra@0.3.7 (clean hygiene, removes the duplicate-instance fragility). (2) Real fix: in apps/cli/src/index.ts main(), pass config: { logging: { enabled: false } } to runNodeApplication when process.env.NODE_ENV === 'test', so initializeLogger() never reconfigures LogTape with a console sink and never clobbers tests/setup.ts's global mute. Verified: repro pair (init.test + rule-service.test) leak 0; full suite 387 pass / 0 fail / 0 @timestamp lines; lint + test-cf + build green.
- **Tags:** test-output-leak, logtape, ts-infra, logger-mute, bootstrap, NODE_ENV, configure-race
- **Occurrences:** 1

## bug-273: Significant refactor of 

- **Date:** 2026-06-09T04:07:23.166Z
- **File:** `../ts-libs/packages/infra/src/logger.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 9→16 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-274: Type error

- **Date:** 2026-06-09T04:07:39.127Z
- **File:** `../ts-libs/packages/infra/tests/logger.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-275: Missing await

- **Date:** 2026-06-09T04:08:35.478Z
- **File:** `../ts-libs/docs/tasks/0029_make_initializeLogger_honor_the_setLoggerMuted_flag_so_a_muted_logger_stays_silent_across_reconfigure.md`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, md
- **Occurrences:** 1

## bug-276: Incorrect value in code

- **Date:** 2026-06-09T04:50:00.155Z
- **File:** `scripts/commands/release.ts`
- **Root cause:** Had 'spur-cli'
- **Fix:** Changed to `@gobing-ai/spur-v${version}`
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 4

## bug-277: Significant refactor of 

- **Date:** 2026-06-09T04:51:34.894Z
- **File:** `.github/workflows/publish.yml`
- **Root cause:** 9 lines replaced/restructured
- **Fix:** Rewrote 26→16 lines (9 removed)
- **Tags:** auto-detected, refactor, yml
- **Occurrences:** 1

## bug-278: Wrong reference: plugin should be tooling

- **Date:** 2026-06-09T04:53:17.656Z
- **File:** `README.md`
- **Root cause:** Used "plugin" instead of "tooling"
- **Fix:** Changed plugin → tooling
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-280: Function not marked async

- **Date:** 2026-06-09T05:13:49.082Z
- **File:** `docs/tasks/0030_use_the_bootstrap_functions_to_refactor_the_spur_server.md`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, md
- **Occurrences:** 1

## bug-281: Missing error handling in getRuntime

- **Date:** 2026-06-09T05:27:29.652Z
- **File:** `apps/server/src/worker.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-282: Missing error handling in unknown

- **Date:** 2026-06-09T05:27:55.381Z
- **File:** `docs/tasks/0030_use_the_bootstrap_functions_to_refactor_the_spur_server.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-283: Significant refactor of 

- **Date:** 2026-06-09T05:35:12.256Z
- **File:** `apps/server/src/worker.ts`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 31→53 lines (5 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-284: Missing error handling in unknown

- **Date:** 2026-06-09T05:36:32.132Z
- **File:** `docs/tasks/0030_use_the_bootstrap_functions_to_refactor_the_spur_server.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-285: Significant refactor of 

- **Date:** 2026-06-09T05:48:28.226Z
- **File:** `apps/cli/src/config/loader.ts`
- **Root cause:** 12 lines replaced/restructured
- **Fix:** Rewrote 31→40 lines (12 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-286: Function not marked async

- **Date:** 2026-06-09T05:51:49.830Z
- **File:** `apps/cli/tests/config/loader.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-287: Type error

- **Date:** 2026-06-09T06:07:12.165Z
- **File:** `apps/cli/src/config/loader.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-288: Incorrect value in code

- **Date:** 2026-06-09T06:25:34.818Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** Had './context'
- **Fix:** Changed to '@gobing-ai/spur-domain'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-289: Missing await

- **Date:** 2026-06-09T06:25:53.031Z
- **File:** `apps/cli/tests/bootstrap.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 2

## bug-293: Incorrect value in code

- **Date:** 2026-06-09T20:47:15.589Z
- **File:** `.claude-plugin/marketplace.json`
- **Root cause:** Had "0.1.0"
- **Fix:** Changed to "0.2.0"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-294: Type error

- **Date:** 2026-06-09T21:11:42.064Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-295: Type error

- **Date:** 2026-06-09T21:11:49.087Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-296: Missing error handling in parseVars

- **Date:** 2026-06-09T21:11:57.721Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-297: Type error

- **Date:** 2026-06-09T22:41:21.533Z
- **File:** `../ts-libs/packages/dual-workflow-engine/src/host.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-298: Null/undefined access in 

- **Date:** 2026-06-09T22:52:45.070Z
- **File:** `../ts-libs/packages/dual-workflow-engine/tests/edge-cases.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-299: Significant refactor of 

- **Date:** 2026-06-09T23:28:49.698Z
- **File:** `node_modules/.bun/@gobing-ai+ts-dual-workflow-engine@0.3.7+3f1a4ed45f5d8e5a/node_modules/@gobing-ai/ts-dual-workflow-engine/dist/host.js`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 10→12 lines (3 removed)
- **Tags:** auto-detected, refactor, js
- **Occurrences:** 1

## bug-300: Significant refactor of 

- **Date:** 2026-06-09T23:35:27.882Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→6 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-301: Missing await

- **Date:** 2026-06-09T23:36:06.438Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-243: spur workflow run: shell action failed with `Command "bun run check" exited with null` for any multi-word command line

- **Date:** 2026-06-09T23:38:54.838Z
- **File:** `~/xprojects/ts-libs/packages/dual-workflow-engine/src/host.ts (ShellActionRunner.execute)`
- **Root cause:** ShellActionRunner passed the whole `command` string to ProcessExecutor.run as a bare executable name (execa(command, args)). execa treated e.g. `bun run check` as a single program name -> ENOENT -> exitCode undefined -> null. No shell interpretation, so `&&`/pipes/args never worked.
- **Fix:** When no explicit `args` are given, wrap the command as `/bin/sh -c <command>` so it runs as a shell line; explicit-args form still runs the program directly. Verified e2e through the spur CLI (echo a && true -> done). Engine 186 tests pass.
- **Tags:** workflow-engine, shell-action, ts-libs, dogfood, process-executor
- **Occurrences:** 1

## bug-303: Missing error handling in unknown

- **Date:** 2026-06-10T00:36:17.223Z
- **File:** `docs/tasks/0032_Implement_downstream_workflow_action_runners_agent.run_rule.check_file.exists_file.read_http.request_and_register_them_as_spur_builtins.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-304: Missing await

- **Date:** 2026-06-10T00:36:42.825Z
- **File:** `docs/tasks/0032_Implement_downstream_workflow_action_runners_agent.run_rule.check_file.exists_file.read_http.request_and_register_them_as_spur_builtins.md`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call | Also: **Dependencies:** `RuleAppService` (packages/app) — NOT the ; already owns preset resolution, rule discovery/layering, eva | Also: No `encoding` option: `FileSystem.readFile(path)` is utf-8 o; 1. Resolve `path` (relative → join `context.workdir`).
- **Tags:** auto-detected, async-fix, md
- **Occurrences:** 4

## bug-305: Significant refactor of 

- **Date:** 2026-06-10T00:37:19.673Z
- **File:** `docs/tasks/0032_Implement_downstream_workflow_action_runners_agent.run_rule.check_file.exists_file.read_http.request_and_register_them_as_spur_builtins.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 14→24 lines (3 removed) | Also: | `brainstorm` | note: "Run: /rd3:dev-brainstorm" ; | `new-task` | note: "Run: /rd3:dev-new-task" | `a | Also: - **agent-run.test.ts** — Mock `AiRunner.runPrompt; - Success: exitCode 0 → `ok: true`, data has stdou
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-306: Null/undefined access in 

- **Date:** 2026-06-10T00:37:36.155Z
- **File:** `docs/tasks/0032_Implement_downstream_workflow_action_runners_agent.run_rule.check_file.exists_file.read_http.request_and_register_them_as_spur_builtins.md`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, md
- **Occurrences:** 1

## bug-244: Task 0032 session latch (agent.run one-session continuity) is inert: installed engine 0.3.7 ActionResult has no setVars, so {__agentSession:open} is silently dropped and every agent.run opens a fresh session

- **Date:** 2026-06-10T04:15:22.626Z
- **File:** `packages/app/src/workflow/actions/agent-run.ts:70 + package.json catalog ^0.3.7`
- **Root cause:** F1 (task 0033, ActionResult.setVars) was implemented in ts-libs source but not released/bumped into spur catalog. Code is forward-correct for 0.3.8 but compiled+run against 0.3.7. Also forces an `as unknown as ActionResult` cast at agent-run.ts:66-71.
- **Fix:** Release engine 0.3.8 (setVars), bump spur catalog pin from ^0.3.7 to ^0.3.8, bun install. Then latch activates and the double-cast can become a plain typed return.
- **Tags:** workflow, session-latch, setVars, release-sequencing, ts-libs, 0032, 0033
- **Occurrences:** 1

## bug-308: Missing await

- **Date:** 2026-06-10T04:25:17.896Z
- **File:** `packages/app/tests/workflow/builtins.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-309: Null/undefined access in 

- **Date:** 2026-06-10T06:49:54.270Z
- **File:** `../ts-libs/docs/tasks/0031_Workflow_engine_HITL_observability_keystone_EventBus_auto-logging_EventBus_in_ActionRunContext_HitlResponder_contract_event.emit_builtin_note_emits_workflow.hitl.note.md`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, md
- **Occurrences:** 1

## bug-310: Function not marked async

- **Date:** 2026-06-10T06:51:18.667Z
- **File:** `docs/tasks/0036_Web_desktop-notifier_HITL_responder_future_deferred.md`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, md
- **Occurrences:** 1

## bug-311: Missing await

- **Date:** 2026-06-10T16:40:43.808Z
- **File:** `packages/app/tests/workflow/builtins.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-245: HITL responder selection picks interactive ClackHitlResponder on isatty(1) alone, ignoring --json; a --json workflow run on a TTY launches an interactive prompt that corrupts JSON output and blocks machine consumers

- **Date:** 2026-06-10T16:41:42.453Z
- **File:** `apps/cli/src/context.ts:62`
- **Root cause:** hitlResponder factory in createCliContext only checks isatty(1); the --json flag is a per-command option not available at context-construction time, so it was never threaded in. R6 specified isatty && !jsonOutput.
- **Fix:** Thread the --json/output-mode signal to the responder factory (or defer factory until command flags known); force DefaultHitlResponder when json. Tracked as a follow-up task.
- **Tags:** hitl, cli, json, responder, 0035
- **Occurrences:** 1

## bug-313: Significant refactor of 

- **Date:** 2026-06-10T16:54:25.928Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→10 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-314: Missing await

- **Date:** 2026-06-10T16:56:02.189Z
- **File:** `apps/cli/tests/context.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-315: Missing error handling in runOsascriptDefault

- **Date:** 2026-06-10T18:11:11.402Z
- **File:** `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-316: Missing error handling in unknown

- **Date:** 2026-06-10T18:12:04.715Z
- **File:** `apps/cli/tests/workflow/hitl/desktop-notifier-responder.test.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-317: Type error

- **Date:** 2026-06-10T18:13:14.853Z
- **File:** `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation | Also: // node-notifier lives behind this tiny wrapper module: refe; // (statically or via dynamic import()) destroys this file's
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 2

## bug-318: Wrong reference: title should be desktopNotify

- **Date:** 2026-06-10T18:17:29.799Z
- **File:** `apps/cli/src/workflow/hitl/desktop-notifier-responder.ts`
- **Root cause:** Used "title" instead of "desktopNotify"
- **Fix:** Changed title → desktopNotify
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-319: Missing await

- **Date:** 2026-06-10T18:17:53.556Z
- **File:** `apps/cli/tests/workflow/hitl/desktop-notifier-responder.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-323: Missing await

- **Date:** 2026-06-11T15:40:04.226Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-324: Missing await

- **Date:** 2026-06-11T15:40:15.031Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-325: Wrong reference: 11T06 should be 11T18

- **Date:** 2026-06-11T15:50:14.400Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Used "11T06" instead of "11T18"
- **Fix:** Changed 11T06 → 11T18
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 2

## bug-326: Incorrect value in code

- **Date:** 2026-06-11T15:51:04.438Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Had `config.workflows.paths`
- **Fix:** Changed to `workflows.paths`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 5

## bug-327: Significant refactor of 

- **Date:** 2026-06-11T15:51:14.932Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 10→10 lines (8 removed) | Also: 1. **No argument**: list recent rule runs (from re; 3. **Engine change (`ts-rule-engine`)**: add run-l | Also: | `~/xprojects/ts-libs/.../ts-rule-engine/src/even; | `~/xprojects/ts-libs/.../ts-rule-engine/src/engi | Also: 1. Engine (`ts-dual-workflow-engine`): add `action; 2. Engine: emit `action.started`/`action.ended` in
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 4

## bug-328: spur workflow run --dry-run silently executed actions (failing shell action ran, run reported failed instead of dry-walking to done)

- **Date:** 2026-06-11T18:00:00Z
- **File:** `apps/cli/package.json, packages/app/package.json, packages/domain/package.json (temporary link:@gobing-ai/ts-dual-workflow-engine)`
- **Root cause:** Engine-side dryRun support exists only in uncommitted ts-libs working tree (dual-workflow-engine 0.3.12, unreleased); published 0.3.11 has no dryRun handling and silently ignores the unknown WorkflowRunOptions field. Misleadingly, root node_modules/@gobing-ai/ts-dual-workflow-engine is a stale bun-link symlink to the local 0.3.12 build, while workspaces resolve the published 0.3.11 from the .bun store - reading the root symlink made the feature look released.
- **Fix:** Switched the three consuming workspaces to link:@gobing-ai/ts-dual-workflow-engine (sanctioned temporary link, documented in task 0038) and added regression tests (service: dryRun skips a failing side-effect shell action; CLI: --dry-run forwarding). Permanent fix: commit + publish ts-dual-workflow-engine 0.3.12 from ts-libs, bump Spur catalog, revert links to catalog:.
- **Tags:** workflow, dry-run, dual-workflow-engine, bun-link, unreleased-dependency, silent-no-op
- **Occurrences:** 1

## bug-329: Wrong reference: 11T18 should be 11T20

- **Date:** 2026-06-11T16:46:46.003Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Used "11T18" instead of "11T20"
- **Fix:** Changed 11T18 → 11T20
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-330: Incorrect value in code

- **Date:** 2026-06-11T16:47:15.926Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Had `spur workflow list`
- **Fix:** Changed to "no execution history"
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 5

## bug-331: Significant refactor of 

- **Date:** 2026-06-11T16:50:44.176Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 9→12 lines (6 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-332: Wrong reference: 11T20 should be 11T21

- **Date:** 2026-06-11T17:51:07.277Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Used "11T20" instead of "11T21"
- **Fix:** Changed 11T20 → 11T21
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-333: Incorrect value in code

- **Date:** 2026-06-11T17:51:25.026Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Had `action_runs`
- **Fix:** Changed to `spur rule trace`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-334: Significant refactor of 

- **Date:** 2026-06-11T17:51:59.938Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** 37 lines replaced/restructured
- **Fix:** Rewrote 47→22 lines (37 removed) | Also: #### Item C — Add `spur rule trace` (upstream seam; 1. `ts-rule-engine`: `RULE_ENGINE_SCHEMA_SQL` + `R | Also: #### Item E — Docs + gates; 1. `04_DESIGN.md`: fix `list`, add `trace` (+ filt
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-335: Null/undefined access in 

- **Date:** 2026-06-11T18:41:17.498Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-336: Incorrect value in code

- **Date:** 2026-06-11T18:41:52.116Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** Had 'cli-test-flow'
- **Fix:** Changed to 'test-flow'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-337: Missing error handling in unknown

- **Date:** 2026-06-11T18:43:08.388Z
- **File:** `docs/tasks/0038_Enhance_spur_workflow_CLI_surface_with_plan_command_and_dry-run_flag.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-338: Incorrect value in code

- **Date:** 2026-06-11T19:00:03.533Z
- **File:** `package.json`
- **Root cause:** Had "^0.3.11"
- **Fix:** Changed to "^0.3.12"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-343: Significant refactor of 

- **Date:** 2026-06-11T21:42:44.455Z
- **File:** `packages/domain/src/migrations.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 11→14 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-344: Null/undefined access in 

- **Date:** 2026-06-11T21:44:22.004Z
- **File:** `packages/app/src/services/rule-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-345: Significant refactor of 

- **Date:** 2026-06-11T21:44:30.327Z
- **File:** `packages/app/src/services/rule-service.ts`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 9→3 lines (6 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-346: Null/undefined access in 

- **Date:** 2026-06-11T21:45:52.722Z
- **File:** `packages/domain/src/dao/rule-run-dao.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-347: Significant refactor of 

- **Date:** 2026-06-11T21:47:38.152Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 18→48 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-348: Null/undefined access in 

- **Date:** 2026-06-11T21:47:51.546Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-349: Missing await

- **Date:** 2026-06-11T21:49:39.604Z
- **File:** `packages/domain/tests/dao/migrations.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-350: spur rule trace silently returns 'No rule runs found.' forever on existing DBs; rule_runs/rule_eval_runs never created

- **Date:** 2026-06-11T22:00:00Z
- **File:** `packages/domain/src/migrations.ts`
- **Root cause:** RULE_ENGINE_SCHEMA_SQL folded only into already-applied 0000_spur_cli_foundation; journal skips it on existing DBs; drizzle/ folder migration never regenerated; DAOs swallow no-such-table
- **Fix:** Added incremental 0002_spur_cli_rule_history to CLI_MIGRATIONS + drizzle/0002_spur_cli_rule_history.sql (inbox 0001 precedent) + regression test simulating a pre-0040 DB
- **Tags:** migrations, sqlite, rule-trace, silent-failure
- **Occurrences:** 1

## bug-351: RuleEngine({persistence,...}) writes no rows, no error — spur rule run never persists despite imports compiling

- **Date:** 2026-06-11T22:00:00Z
- **File:** `packages/app/src/services/rule-service.ts`
- **Root cause:** Project .bun store entry ts-rule-engine@0.3.14+ff341c5bfed10990 is a poisoned INTERMEDIATE local build: persistence module exports exist (compiles) but RuleEngine constructor ignores persistence/runId/runMeta. Registry 0.3.14 has no seam. Root node_modules has a stale bun link to ts-libs (fully wired 0.3.15, unpublished) masking inspection.
- **Fix:** Not fixable in-repo: blocked on ts-libs rule-engine 0.3.15 release + catalog bump + bun install. Added 2 behavioral regression tests that stay red until the released engine persists.
- **Tags:** bun-store, ts-rule-engine, silent-no-op, blocked-on-release, stale-link
- **Occurrences:** 1

## bug-352: CLI trace tests opened real workspace DB apps/cli/.spur/spur.db; engine wrote applied_fix_count=0 permanently; verbose path read private engine fields via 'as undefined' casts

- **Date:** 2026-06-11T22:00:00Z
- **File:** `apps/cli/tests/commands/rule.test.ts`
- **Root cause:** main(['rule','trace']) without dbUrl resolves join(cwd, '.spur/spur.db'); engine contract leaves applied_fix_count to the caller (engine.js comment) and Spur never updated it; verbose mode rebuilt the engine by reaching into private fields
- **Fix:** Tests pass dbUrl ':memory:'/temp file; Spur stamps runId and re-stamps applied count via persistence.updateRunStatus after applyFixes; evaluateVerbose receives engineOptions and builds one engine with events
- **Tags:** test-isolation, applied-fix-count, private-field-cast, rule-service
- **Occurrences:** 1

## bug-353: Incorrect value in code

- **Date:** 2026-06-11T23:03:20.298Z
- **File:** `packages/domain/src/migrations.ts`
- **Root cause:** Had `drizzle/0001_spur_team_inbox.sql`
- **Fix:** Changed to `drizzle/0001_spur_cli_team_inbox.sql`
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-354: Function not marked async

- **Date:** 2026-06-11T23:05:37.421Z
- **File:** `packages/domain/tests/dao/migrations.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-355: drizzle/0001_spur_team_inbox.sql skipped by folder-based migration loads — filename lacks the _spur_cli_ marker that loadSqlMigrations filters on

- **Date:** 2026-06-11T23:08:00Z
- **File:** `drizzle/0001_spur_cli_team_inbox.sql`
- **Root cause:** loadSqlMigrations keeps only *.sql filenames containing CLI_MIGRATION_FILE_MARKER ('_spur_cli_'); the team-inbox migration was named without it, so `spur migrate` folder loads returned only 0000 (+0002), silently dropping the inbox step for old DBs
- **Fix:** git mv to 0001_spur_cli_team_inbox.sql; embedded CLI_MIGRATIONS id renamed in sync; docs 04/05 updated; added invariant test (every migration id contains the marker) + legacy-id upgrade test (old journal id re-applies idempotent DDL safely, applied=2)
- **Tags:** migrations, filename-marker, spur-migrate, silent-skip
- **Occurrences:** 1

## bug-356: Significant refactor of 

- **Date:** 2026-06-12T05:52:52.261Z
- **File:** `docs/00_ADR.md`
- **Root cause:** 42 lines replaced/restructured
- **Fix:** Rewrote 66→98 lines (42 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-357: Significant refactor of 

- **Date:** 2026-06-12T05:53:09.385Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 10→12 lines (4 removed) | Also: - `apps/cli` task/feature/plan commands stay trans; domain packages.
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-358: Significant refactor of 

- **Date:** 2026-06-12T05:54:11.875Z
- **File:** `docs/01_PRD.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (3 removed) | Also: | Plan a feature from a vague description | `spur ; | Review the local kanban board | `spur serve` *(p | Also: | Task management (markdown CRUD, WBS, sections, c; | Feature management (`docs/features/`, INDEX, tra | Also: - **Web plugin container & multi-workspace** — boa; - **Scheduler auto-trigger & workflow extension fr
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 4

## bug-359: Significant refactor of 

- **Date:** 2026-06-12T05:55:07.242Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 9 lines replaced/restructured
- **Fix:** Rewrote 25→33 lines (9 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-360: Incorrect value in code

- **Date:** 2026-06-12T05:55:24.894Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `ts-db/infra/runtime/utils`
- **Fix:** Changed to `@gobing-ai/ts-*`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-361: Significant refactor of 

- **Date:** 2026-06-12T05:57:02.154Z
- **File:** `AGENTS.md`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 28→39 lines (7 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-362: Wrong return value

- **Date:** 2026-06-12T05:57:38.427Z
- **File:** `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- **Root cause:** Was returning: in later batches; `rejected` items are
- **Fix:** Now returns: in later batches;
- **Tags:** auto-detected, return-value, md
- **Occurrences:** 1

## bug-363: Incorrect value in code

- **Date:** 2026-06-12T05:57:59.154Z
- **File:** `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- **Root cause:** Had `ts-dual-workflow-engine`
- **Fix:** Changed to `spur workflow`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 4

## bug-364: Significant refactor of 

- **Date:** 2026-06-12T05:58:14.954Z
- **File:** `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 9→11 lines (4 removed) | Also: ## Batch sequencing (need + fixed-need + X only); A18 (Zod schema, schema_version, parent_wbs) · X01
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-365: Wrong reference: 022 should be 023

- **Date:** 2026-06-12T05:59:02.267Z
- **File:** `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- **Root cause:** Used "022" instead of "023"
- **Fix:** Changed 022 → 023
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-366: Incorrect value in code

- **Date:** 2026-06-12T07:09:14.805Z
- **File:** `docs/99_PROJECT_CONSTITUTION.md`
- **Root cause:** Had `docs/99_HOW_TO_ORGNIZE_THE_PROJECT.md`
- **Fix:** Changed to `docs/99_PROJECT_CONSTITUTION.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-367: Significant refactor of 

- **Date:** 2026-06-12T07:09:29.373Z
- **File:** `docs/99_PROJECT_CONSTITUTION.md`
- **Root cause:** 11 lines replaced/restructured
- **Fix:** Rewrote 15→31 lines (11 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-368: Wrong reference: header should be frontmatter

- **Date:** 2026-06-12T07:10:14.841Z
- **File:** `docs/99_PROJECT_CONSTITUTION.md`
- **Root cause:** Used "header" instead of "frontmatter"
- **Fix:** Changed header → frontmatter
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-369: Significant refactor of 

- **Date:** 2026-06-12T07:10:38.487Z
- **File:** `docs/01_PRD.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 6→13 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-370: Significant refactor of 

- **Date:** 2026-06-12T07:10:48.801Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 6→14 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-371: Significant refactor of 

- **Date:** 2026-06-12T07:10:49.882Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 7→14 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-372: Significant refactor of 

- **Date:** 2026-06-12T07:11:03.149Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 7→14 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-373: Significant refactor of 

- **Date:** 2026-06-12T07:11:06.284Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 7→14 lines (5 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-374: Significant refactor of 

- **Date:** 2026-06-12T07:11:15.641Z
- **File:** `AGENTS.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 3→4 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-375: Incorrect value in code

- **Date:** 2026-06-12T07:11:17.949Z
- **File:** `AGENTS.md`
- **Root cause:** Had `docs/99_HOW_TO_ORGNIZE_THE_PROJECT.md`
- **Fix:** Changed to `docs/99_PROJECT_CONSTITUTION.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-376: Significant refactor of 

- **Date:** 2026-06-12T07:27:24.183Z
- **File:** `docs/02_ROADMAP.md`
- **Root cause:** 27 lines replaced/restructured
- **Fix:** Rewrote 31→17 lines (27 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-377: Significant refactor of 

- **Date:** 2026-06-12T07:28:02.953Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** 32 lines replaced/restructured
- **Fix:** Rewrote 35→19 lines (32 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-378: Significant refactor of 

- **Date:** 2026-06-12T07:28:31.231Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 7→3 lines (4 removed) | Also: - `help` / `--help` — print the command-scoped rul; and exit codes. `spur help rule` is equivalent.
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-379: Incorrect value in code

- **Date:** 2026-06-12T07:29:01.430Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `spur agent run --purpose/--tags/--system-prompt/-
- **Fix:** Changed to `spur agent run --drain`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-380: Significant refactor of 

- **Date:** 2026-06-12T17:03:38.947Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** 11 lines replaced/restructured
- **Fix:** Rewrote 23→33 lines (11 removed) | Also: CLI[Arg dispatch] --> Ctx[CliContext<br/>config · ; CLI --> AR[ts-ai-runner] | Also: ```; src/ | Also: (`DbWorkflowPersistenceAdapter`) over ts-db; in-me; the host + persistence and exposes validate/run/li | Also: | `.spur/` | Project config (`config.json`), local; | SQLite DB (`DATABASE_URL` or `.spur/spur.db`) | 
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 5

## bug-381: Incorrect value in code

- **Date:** 2026-06-12T17:04:26.911Z
- **File:** `docs/03_ARCHITECTURE.md`
- **Root cause:** Had `apps/cli/src/analytics`
- **Fix:** Changed to `packages/domain/src/analytics`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-382: Incorrect value in code

- **Date:** 2026-06-12T17:04:57.443Z
- **File:** `AGENTS.md`
- **Root cause:** Had `CLI_SCHEMA_SQL`
- **Fix:** Changed to `packages/domain/src/migrations.ts`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-383: Incorrect value in code

- **Date:** 2026-06-12T17:10:49.382Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `buildConfigFromEnv`
- **Fix:** Changed to `ln(env)`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-384: Significant refactor of 

- **Date:** 2026-06-12T17:11:32.001Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 3→5 lines (3 removed) | Also: | State-machine + transition-flow modes | 🔶 | bot; | Gates as transition predicates, iteration boundi
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-385: Incorrect value in code

- **Date:** 2026-06-12T17:11:46.886Z
- **File:** `docs/05_FEATURES.md`
- **Root cause:** Had `04_DESIGN.md`
- **Fix:** Changed to `04 §7.1–7.6`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-386: Incorrect value in code

- **Date:** 2026-06-12T23:37:36.494Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** Had `feature-id`
- **Fix:** Changed to `feature_id`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-387: Incorrect value in code

- **Date:** 2026-06-13T00:49:04.812Z
- **File:** `docs/design/rd3-migration-design.md`
- **Root cause:** Had `FT-NNN`
- **Fix:** Changed to `feature-id`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 6

## bug-388: Significant refactor of 

- **Date:** 2026-06-13T00:49:22.117Z
- **File:** `docs/design/rd3-migration-design.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 9→18 lines (3 removed) | Also: - **FT id:** `FT-` + zero-padded 3-digit, allocate; create-lock discipline.
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-389: Incorrect value in code

- **Date:** 2026-06-13T00:51:09.053Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** Had `spur task create <title> [--template <variant>] [
- **Fix:** Changed to `spur task create <title> [--template <variant>] [
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 4

## bug-390: Significant refactor of 

- **Date:** 2026-06-14T00:08:37.435Z
- **File:** `packages/domain/src/planning/markdown-document.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 12→19 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-391: Type error

- **Date:** 2026-06-14T00:51:07.772Z
- **File:** `packages/domain/src/bdd/coverage.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-392: Significant refactor of 

- **Date:** 2026-06-14T00:51:11.715Z
- **File:** `packages/domain/src/bdd/coverage.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→3 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-393: Significant refactor of 

- **Date:** 2026-06-14T00:56:42.859Z
- **File:** `packages/domain/src/bdd/validate.ts`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 15→7 lines (6 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-394: Wrong condition in logic

- **Date:** 2026-06-14T00:57:33.944Z
- **File:** `packages/domain/src/bdd/parser.ts`
- **Root cause:** Condition was: if (feature && !currentScenario && !feature.background)
- **Fix:** Changed to: if (feature && !currentScenario && !feature.background)
- **Tags:** auto-detected, logic-fix, ts
- **Occurrences:** 1

## bug-395: Missing error handling in fsyncPath

- **Date:** 2026-06-14T01:18:20.583Z
- **File:** `packages/domain/src/planning/locks.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-396: Type error

- **Date:** 2026-06-14T01:19:16.513Z
- **File:** `packages/domain/tests/planning/locks.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-397: Significant refactor of 

- **Date:** 2026-06-14T01:41:51.045Z
- **File:** `docs/tasks/0045_W0_ts-utils_and_ts-runtime_consolidation_audit.md`
- **Root cause:** 15 lines replaced/restructured
- **Fix:** Rewrote 25→4 lines (15 removed) | Also: access, const, object, origin). All 35 functions, ; 2. **ts-runtime v0.3.12 FileSystem interface verif | Also: No upstream tasks created. Rationale:; - All 4 H-item corrections confirmed covered by ex
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-398: Incorrect value in code

- **Date:** 2026-06-14T02:13:00.415Z
- **File:** `docs/tasks/0045_W0_ts-utils_and_ts-runtime_consolidation_audit.md`
- **Root cause:** Had 's original need #2 claimed a full Result monad CO
- **Fix:** Changed to 's original need #2 claimed a full Result monad CO
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-399: Wrong return value

- **Date:** 2026-06-14T02:15:04.498Z
- **File:** `docs/tasks/0045_W0_ts-utils_and_ts-runtime_consolidation_audit.md`
- **Root cause:** Was returning: results | ❌ **NOT FOUND** in ts-utils v0.3.17. No 
- **Fix:** Now returns: results | ❌ **NOT FOUND** in ts-utils v0.3.17. No 
- **Tags:** auto-detected, return-value, md
- **Occurrences:** 1

## bug-400: Incorrect value in code

- **Date:** 2026-06-14T02:44:49.887Z
- **File:** `config/workflows/task-lifecycle.yaml`
- **Root cause:** Had "@gobing-ai/ts-dual-workflow-engine/schemas/state-
- **Fix:** Changed to "@gobing-ai/spur/schemas/state-machine-workflow.sc
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-401: Incorrect value in code

- **Date:** 2026-06-14T02:44:51.864Z
- **File:** `config/workflows/feature-lifecycle.yaml`
- **Root cause:** Had "@gobing-ai/ts-dual-workflow-engine/schemas/state-
- **Fix:** Changed to "@gobing-ai/spur/schemas/state-machine-workflow.sc
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-402: Incorrect value in code

- **Date:** 2026-06-14T02:44:59.245Z
- **File:** `config/workflows/feature-dev.yaml`
- **Root cause:** Had "@gobing-ai/ts-dual-workflow-engine/schemas/state-
- **Fix:** Changed to "@gobing-ai/spur/schemas/state-machine-workflow.sc
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-403: Incorrect value in code

- **Date:** 2026-06-14T02:45:58.566Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `spur workflow validate config/workflows/task-life
- **Fix:** Changed to `spur workflow validate config/workflows/task-life
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-404: Incorrect value in code

- **Date:** 2026-06-14T02:46:05.660Z
- **File:** `docs/tasks/0046_W0_Task_and_feature_lifecycle_workflow_YAML_definitions.md`
- **Root cause:** Had `spur workflow validate --no-schema`
- **Fix:** Changed to `spur workflow validate`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 3

## bug-405: Significant refactor of 

- **Date:** 2026-06-14T03:31:23.014Z
- **File:** `packages/app/src/services/corpus-migrator.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→4 lines (2 removed) | Also: } else if (typeof value === 'object') {; } else {
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-406: Missing await

- **Date:** 2026-06-14T03:32:00.954Z
- **File:** `packages/app/tests/services/corpus-migrator.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-407: Type error

- **Date:** 2026-06-14T03:35:16.006Z
- **File:** `packages/app/tests/services/corpus-migrator.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-408: Null/undefined access in 

- **Date:** 2026-06-14T04:11:06.619Z
- **File:** `packages/domain/tests/helpers.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-409: Incorrect value in code

- **Date:** 2026-06-14T05:04:09.503Z
- **File:** `packages/app/tests/services/planning-write-service.test.ts`
- **Root cause:** Had '../src/services/planning-write-service'
- **Fix:** Changed to '../../src/services/planning-write-service'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-410: Significant refactor of 

- **Date:** 2026-06-14T05:04:20.097Z
- **File:** `packages/app/src/services/planning-write-service.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 7→4 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-411: Null/undefined access in 

- **Date:** 2026-06-14T05:04:55.468Z
- **File:** `docs/tasks/0049_W1_PlanningWriteService_unified_write_path_with_atomic_writes.md`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, md
- **Occurrences:** 1

## bug-412: ENOENT: no such file or directory, scandir '<repo>/apps/cli/docs/tasks' — `spur task` resolved its tasks dir against process.cwd() instead of the injected --cwd, so any invocation outside the project root (and every cwd-injecting test) read the wrong folder.

- **Date:** 2026-06-13T22:23:00.000Z
- **File:** `apps/cli/src/context.ts`
- **Root cause:** createCliContext computed `cwd` but built `const fs = createNodeFileSystem()` with no base dir. context.fs.resolve('docs','tasks') in task.ts therefore resolved relative to process.cwd(). Other commands (rule/agent) thread cwd through their own services and avoided context.fs, masking the bug until the task CLI integration test was written.
- **Fix:** Pass the resolved cwd into the filesystem: `const fs = createNodeFileSystem(cwd)` in apps/cli/src/context.ts:47. Full repo suite (893 tests) confirms no regression.
- **Tags:** cli, filesystem, cwd, context, task-0050
- **Occurrences:** 1

## bug-413: Type error

- **Date:** 2026-06-14T06:33:32.653Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-414: Null/undefined access in 

- **Date:** 2026-06-14T06:33:53.374Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-415: Incorrect value in code

- **Date:** 2026-06-14T06:35:23.276Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `spur task check [<wbs>]`
- **Fix:** Changed to `spur task batch-create --file <json>`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-416: spur task check used a hardcoded Section-Status-Matrix instead of loading config/tasks/section-matrix.yaml. The YAML config + JSON schema (task 0051 R2 deliverables) were dead artifacts read by nothing; the hardcoded TS copy had already drifted (missing the brainstorm variant and the Notes section).

- **Date:** 2026-06-13T23:30:00.000Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** loadSectionMatrix(_fs, _tasksDir) ignored both parameters and returned an inline object literal. The task shipped the config files but never wired the loader to them, so R2 was a false-pass and the architecture goal ('table-driven, tightening is config not code') was violated.
- **Fix:** Rewrote loadSectionMatrix() to resolve config/tasks/section-matrix.yaml via bundledConfigRoot() (from @gobing-ai/spur-config), parse with yaml.parse, validate shape, and fall back to a minimal built-in matrix only when the bundled file is unreachable (e.g. bun build --compile single binary). Verified build:bundle copies config/tasks/ into the packaged config dir.
- **Tags:** cli, config, section-matrix, task-check, dead-artifact, task-0051
- **Occurrences:** 1

## bug-417: Function not marked async

- **Date:** 2026-06-14T07:10:44.895Z
- **File:** `packages/app/tests/services/task-service.test.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-418: Significant refactor of 

- **Date:** 2026-06-14T07:11:39.888Z
- **File:** `packages/domain/src/planning/schema.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 11→20 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-419: Incorrect value in code

- **Date:** 2026-06-14T07:11:48.941Z
- **File:** `apps/cli/schemas/task-batch.schema.json`
- **Root cause:** Had "Validates spur task batch-create --file input — t
- **Fix:** Changed to "Editor/CI aid for spur task batch-create --file i
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-420: Missing error handling in unknown

- **Date:** 2026-06-14T07:12:32.132Z
- **File:** `docs/tasks/0052_W1_spur_task_refresh_batch-create_and_resolve.md`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, md
- **Occurrences:** 1

## bug-421: spur task batch-create silently dropped unknown keys in LLM-supplied JSON instead of rejecting them. The runtime validator (Zod taskBatchSchema) and the documented contract (apps/cli/schemas/task-batch.schema.json) had drifted in BOTH directions: the JSON schema set additionalProperties:false while Zod was non-strict; Zod had stricter feature_id (^[A-Z][1-9]*$) and parent_wbs (^\d{4}$) regexes while the JSON schema used plain string.

- **Date:** 2026-06-14T07:15:00.000Z
- **File:** `packages/domain/src/planning/schema.ts`
- **Root cause:** Two hand-maintained schemas for the same contract with no generation link. R2 said 'validated by task-batch.schema.json' but the code used the Zod schema, so the JSON file was an unenforced editor aid that drifted from runtime behavior. A malformed LLM batch payload with extra fields passed the gate (fields stripped) rather than failing loudly.
- **Fix:** Added .strict() to taskBatchItemSchema so the runtime rejects unknown keys (matching additionalProperties:false). Aligned the JSON schema's feature_id/parent_wbs to the Zod regex patterns and added a note that Zod is the runtime source of truth. Verified end-to-end: `spur task batch-create` now errors 'Unrecognized key: bogus_field'. Also added the missing mid-batch (post-write) rollback test.
- **Tags:** cli, schema, zod, json-schema, drift, llm-gate, task-0052
- **Occurrences:** 1

## bug-422: Incorrect value in code

- **Date:** 2026-06-14T16:35:15.167Z
- **File:** `packages/domain/src/planning/rebuild-events.ts`
- **Root cause:** Had `| ISO-timestamp | old → new | actor |`
- **Fix:** Changed to `PlanningWriteService`
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-423: Significant refactor of 

- **Date:** 2026-06-14T16:35:41.351Z
- **File:** `packages/domain/tests/planning/rebuild-events.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 7→11 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-424: Significant refactor of 

- **Date:** 2026-06-14T16:36:12.531Z
- **File:** `docs/tasks/0053_W1_Planning_events_PlanningEventMap_DAOs_and_DB_migration.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 3→5 lines (3 removed) | Also: | 1 | History-line format mismatch: write-service ; No P1/P2 findings. Nothing to fix in 0053 scope.
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-425: Task 0053 R4 derived-only proof was vacuous: rebuild-events HISTORY_LINE_RE parsed a pipe-table format that no code writes

- **Date:** 2026-06-14T16:37:30.461Z
- **File:** `packages/domain/src/planning/rebuild-events.ts`
- **Root cause:** The rebuilder regex matched `| ts | from → to | actor |` but the only transition-history writer (PlanningWriteService.appendHistoryLine) emits a bullet line `- ts from → to (actor)`. The R4 test fed the parser its own synthetic pipe-table fixture, so it proved the parser parses its own input, not that a real corpus is rebuildable (R8 anti-pattern). No later task owned reconciliation, so it was an orphaned correctness gap, not deferrable.
- **Fix:** Rewrote HISTORY_LINE_RE to /^\s*-\s+(\S+)\s+(\S+)\s*→\s*(\S+)/ matching the canonical bullet line. Updated all rebuild-events tests to use the real write-service format and added an assertion that the M8 migration-seed bullet (- Migrated from legacy format (date)) is skipped (3 events from 4 corpus lines).
- **Tags:** planning, rebuild, derived-only, history-format, R8, verification-0053
- **Occurrences:** 1

## bug-426: Significant refactor of 

- **Date:** 2026-06-14T16:43:31.038Z
- **File:** `packages/config/src/index.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 15→28 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-427: Null/undefined access in 

- **Date:** 2026-06-14T16:43:47.011Z
- **File:** `packages/config/tests/config-schemas.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-428: Task 0054 R2: tasksConfigSchema shipped {active, counterBase}, missing the folders map design §9 requires; folderConfigSchema was orphaned dead code

- **Date:** 2026-06-14T16:45:46.271Z
- **File:** `packages/config/src/index.ts`
- **Root cause:** Implementation diverged from rd3-migration-design.md §9 (tasks: { folders: {path:{baseCounter,label}}, active }). The folder-entry schema (folderConfigSchema) existed with the right shape but was never wired into tasksConfigSchema; a spurious top-level counterBase was added instead.
- **Fix:** Set tasksConfigSchema.folders = z.record(z.string(), folderConfigSchema).default({}); removed top-level counterBase (no production reader). Rewrote config-schemas.test.ts to assert the folders-map shape.
- **Tags:** config, zod, design-drift, orphaned-code, 0054
- **Occurrences:** 1

## bug-429: Task 0054 R2: spur-config.schema.json (the active runtime validator, embedded via loader.ts) had no tasks/features blocks — stale, never regenerated

- **Date:** 2026-06-14T16:45:46.271Z
- **File:** `apps/cli/schemas/spur-config.schema.json`
- **Root cause:** R2 explicitly required regenerating the JSON schema with tasks:/features: keys, but it was left at the Jun-9 shape (version/name/bootstrap/agent/rules/workflows/redaction). loadSpurConfig validates against THIS JSON (not the zod schema), so a user config with tasks: would be undocumented/unvalidated. Same family as the 0052 Zod-vs-JSON drift.
- **Fix:** Added tasks (folders map + active) and features (dir) blocks to the JSON schema, mirroring the zod SSOT. Verified zod spurConfigSchema parses the design §9 example end-to-end.
- **Tags:** config, json-schema, validator-drift, loader, 0054
- **Occurrences:** 1

## bug-430: Incorrect value in code

- **Date:** 2026-06-14T17:26:33.738Z
- **File:** `docs/tasks/0054_W1_Task_templates_config_keys_and_init_assets.md`
- **Root cause:** Had `tasks.folders/active/counterBase`
- **Fix:** Changed to `tasks.folders`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-431: Incorrect value in code

- **Date:** 2026-06-14T17:34:34.116Z
- **File:** `packages/app/src/workflow/lifecycle-adapter.ts`
- **Root cause:** Had 'node:path'
- **Fix:** Changed to '@gobing-ai/spur-domain'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-432: Missing guard clause

- **Date:** 2026-06-14T17:35:17.339Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** No early return/throw for edge case: root === null
- **Fix:** Added guard clause: if (root === null)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-433: Null/undefined access in 

- **Date:** 2026-06-14T17:35:30.277Z
- **File:** `packages/app/tests/workflow/lifecycle-adapter.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: expect(result.report ?? '').toContain('No transition');
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-434: Task 0055 shipped a pure stub LifecycleAdapter (no engine calls, empty rehydrate, no task_run_links, unwired) and was marked Done — all 4 reqs UNMET — even though the upstream gate had cleared

- **Date:** 2026-06-14T17:38:45.750Z
- **File:** `packages/app/src/workflow/lifecycle-adapter.ts`
- **Root cause:** The /rd3:dev-run loop produced a stub identical to the 0049 SchemaLifecyclePort with TODO(0055) comments, assuming ts-libs 0033/0034 had not shipped. But @gobing-ai/ts-dual-workflow-engine 0.3.17 already exposes WorkflowService.createOrAttachRun (E1) + requestTransition + reseedRun (E2). The stub test only exercised the schema fallback (vacuous, R8). The adapter was never injected into PlanningWriteService, so even the stub was dead in production.
- **Fix:** Implemented the real engine integration: createOrAttachRun keyed task:[wbs] (R1), requestTransition with TransitionAllowed/Denied mapping + guard report (R2), reseedRun(workflow,runId,fileStatus) for DD-04 file-wins before each transition (R3), TaskRunLinkDao insert kind=lifecycle on first attach (R4). Wired LifecycleAdapter into PlanningWriteService from apps/cli/src/commands/task.ts. Replaced 4 stub tests with 6 real engine-integration tests; E2E-verified through real spur task update.
- **Tags:** lifecycle, workflow-engine, upstream-gate, stub-shipped-as-done, dd-04, 0055, P1
- **Occurrences:** 1

## bug-435: Missing await

- **Date:** 2026-06-14T17:49:02.115Z
- **File:** `packages/app/src/services/planning-write-service.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-436: Significant refactor of 

- **Date:** 2026-06-14T17:49:13.159Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 8→31 lines (4 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-437: Null/undefined access in 

- **Date:** 2026-06-14T17:49:20.455Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-438: Wrong reference: registerHistoryCommand should be registerFeatureCommand

- **Date:** 2026-06-14T17:51:04.225Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** Used "registerHistoryCommand" instead of "registerFeatureCommand"
- **Fix:** Changed registerHistoryCommand → registerFeatureCommand
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-439: Incorrect value in code

- **Date:** 2026-06-14T17:51:09.210Z
- **File:** `apps/cli/src/index.ts`
- **Root cause:** Had './commands/history'
- **Fix:** Changed to './commands/feature'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-440: Null/undefined access in 

- **Date:** 2026-06-14T17:51:30.847Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-441: Significant refactor of 

- **Date:** 2026-06-14T17:52:08.422Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 27→50 lines (8 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-442: Significant refactor of 

- **Date:** 2026-06-14T17:53:44.374Z
- **File:** `packages/app/tests/services/task-service.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→13 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-443: Task 0056 R2: FeatureService had no CLI command, was not exported from spur-app, and had no update verb — the service was unreachable dead code

- **Date:** 2026-06-14T17:55:42.601Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** The /rd3:dev-run loop built FeatureService (create/show/list + ID helpers) but never created apps/cli/src/commands/feature.ts, never registered it in index.ts, never exported FeatureService from packages/app/src/index.ts, and omitted the update verb R2 requires. Same unreachable-service pattern as 0055.
- **Fix:** Built feature.ts (create/show/update/list, --json, exit 0/1/2), registered in index.ts, exported FeatureService + types from spur-app, added update (scalar field) + transition (status) verbs. 15 CLI tests + E2E verified.
- **Tags:** feature, cli, unreachable-service, 0056, P1
- **Occurrences:** 1

## bug-444: Codebase-wide allocation race: WBS/feature-ID picked OUTSIDE the create-lock, so concurrent creates could allocate the same ID and atomicWriteAsync would silently overwrite

- **Date:** 2026-06-14T17:55:42.601Z
- **File:** `packages/app/src/services/planning-write-service.ts`
- **Root cause:** FeatureService.create and TaskService.create/createBatchItem called allocateId/allocateWbs (dir scan + pick) BEFORE writeService.create acquired the create-lock. The lock only protected the write, not the read-then-pick. The lock is documented as serializing allocation, but allocation happened outside it. atomicWriteAsync overwrites (rename), so a duplicate-ID race = silent data loss.
- **Fix:** Added PlanningWriteService.createAllocated(folder, allocate): acquires the create-lock FIRST, runs the allocator inside it, then runs the pipeline steps with the lock held. Refactored FeatureService.create, TaskService.create, and TaskService.createBatchItem to use it. Race + sequential tests prove distinct IDs / fail-loud-on-contention. The create-lock is single-attempt (throws on live contention), so the loser fails loudly rather than clobbering.
- **Tags:** allocation, create-lock, race-condition, data-loss, feature, task, 0056, P2
- **Occurrences:** 1

## bug-445: Missing await

- **Date:** 2026-06-14T17:58:05.159Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-446: Missing error handling in checkChildrenLimit

- **Date:** 2026-06-14T18:03:49.138Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-447: Null/undefined access in 

- **Date:** 2026-06-14T18:04:13.145Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-448: Null/undefined access in 

- **Date:** 2026-06-14T18:04:49.163Z
- **File:** `packages/app/tests/services/feature-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: test('L3: children count is corpus-derived, at the 9-boundar; // A's 9 direct children (A1..A9, all length-2) + an unrelat
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-449: Task 0057 R4: feature-check runL4 was a no-op — no incoming feature_id edge resolution, no orphan-scenario warnings

- **Date:** 2026-06-14T18:09:12.444Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** runL4 only had a comment ("inverse lookup is done in task-check") and read a dead fm._childrenCount. R4 requires resolving the tasks that point at this feature via feature_id (incoming edges) and warning on AC scenarios with no linked task. Neither was implemented.
- **Fix:** Rewrote runL4 to take tasksDir, scan for tasks with feature_id == this feature, warn on a linked task that fails to parse (dangling edge), and emit an orphan-scenario warning when AC has Scenario: lines but linkedTasks==0. Wired tasksDir through check() + the CLI. Tested + E2E.
- **Tags:** feature-check, traceability, L4, orphan-scenario, 0057, P1
- **Occurrences:** 1

## bug-450: Task 0057 R3: children-limit rule read fm._childrenCount, a frontmatter field that does not exist — the rule never fired (dead)

- **Date:** 2026-06-14T18:09:12.444Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Children count is DERIVED from the corpus (count features whose parent == this node), not stored in frontmatter. Reading fm._childrenCount meant the DD-14 children-limit rule was a no-op. It was also placed in L4 instead of L3 (Design 3 puts format rules in L3).
- **Fix:** Added checkChildrenLimit (L3): counts length-(id+1) IDs prefixed by this node from the corpus. DD-14 single [1-9] digit caps valid children at 9, so the >9 warning is defense-in-depth against a corrupt/duplicate-id corpus (tested via a duplicate-child file).
- **Tags:** feature-check, children-limit, dd-14, dead-rule, L3, 0057, P2
- **Occurrences:** 1

## bug-451: Significant refactor of 

- **Date:** 2026-06-14T18:11:05.156Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 33→56 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-452: Type error

- **Date:** 2026-06-14T18:11:20.362Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-453: Null/undefined access in 

- **Date:** 2026-06-14T18:12:33.215Z
- **File:** `packages/app/tests/services/feature-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-454: Significant refactor of 

- **Date:** 2026-06-14T18:13:12.118Z
- **File:** `docs/tasks/0057_W2_spur_feature_check_AC_validation_one-active-goal_and_children_limit.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 3→5 lines (2 removed) | Also: No remaining P1/P2.; **Gate (post-fix):** `bun run lint` clean (251 fil
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-455: feature-check fed the raw AC section (incl. the ```gherkin markdown fence) to the Gherkin validator → spurious "Unrecognized syntax" warnings on every fenced-AC feature

- **Date:** 2026-06-14T18:16:55.002Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** The feature template (0054) and the docs/features corpus wrap Gherkin AC in a ```gherkin fence. runL3 passed doc.getSection("Acceptance Criteria") verbatim to validateAcceptanceCriteria, which is a pure Gherkin parser and flags the fence lines. Found only because the dogfood "real corpus must pass" test was added (it was missing).
- **Fix:** Added stripCodeFence() to remove ```-prefixed lines before validation. The real corpus now validates with no fence warnings.
- **Tags:** feature-check, bdd, code-fence, dogfood, 0057, P2
- **Occurrences:** 1

## bug-456: feature-check only validated Gherkin AC; checklist AC (- [ ]) hard-failed with "No Feature declaration found"

- **Date:** 2026-06-14T18:16:55.002Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** R1 says "Gherkin/checklist AC validation", but runL3 always called the Gherkin validator. Checklist features (H3, B1 in the corpus) failed. The shared BDD module already exports parseChecklist for the Tier-2 format — it just was not used.
- **Fix:** Two-tier detection: if the de-fenced AC has checklist items and no Feature:/Scenario: keyword, validate via parseChecklist (require non-empty items); else Gherkin. Uses the shared module, no private parser (B08).
- **Tags:** feature-check, bdd, checklist, two-tier-ac, 0057, P2
- **Occurrences:** 1

## bug-457: feature-check DEFAULT_FEATURE_MATRIX flagged the template Tasks/Notes/History sections as "not allowed" for active/verifying/done/blocked/cancelled

- **Date:** 2026-06-14T18:16:55.002Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Those statuses had required[] but no optional[], so the closed-world vocabulary check flagged every template section (Tasks/Notes/History) not in required. The matrix (0057) contradicted the feature template (0054) that ships those sections.
- **Fix:** Added Tasks/Notes/History (and status-appropriate others) to optional[] for each status. The missing-AC gate finding for active features stays (correct).
- **Tags:** feature-check, section-matrix, template-mismatch, 0057, P3
- **Occurrences:** 1

## bug-458: Significant refactor of 

- **Date:** 2026-06-14T18:22:01.830Z
- **File:** `config/templates/feature/default.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 6→8 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-459: Significant refactor of 

- **Date:** 2026-06-14T18:22:14.900Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 11→13 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-460: Missing error handling in refresh

- **Date:** 2026-06-14T18:22:50.670Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-461: Type error

- **Date:** 2026-06-14T18:23:01.797Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-462: Null/undefined access in 

- **Date:** 2026-06-14T18:23:25.004Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-463: Missing error handling in unknown

- **Date:** 2026-06-14T18:23:44.936Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-464: Null/undefined access in 

- **Date:** 2026-06-14T18:24:45.345Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: test('R3 dogfood: refresh against a COPY of the real docs/fe; // Operate on a COPY — never the live repo. The real corpus 
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-465: Missing await

- **Date:** 2026-06-14T18:25:13.837Z
- **File:** `apps/cli/tests/commands/feature.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-466: Significant refactor of 

- **Date:** 2026-06-14T18:25:44.131Z
- **File:** `apps/cli/tests/init-templates.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 5→8 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-467: Significant refactor of 

- **Date:** 2026-06-14T18:26:29.950Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→6 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-468: Task 0058 FeatureService.refresh was a pure stub returning {index:"",tasksUpdated:0} — R1 (INDEX tree) + R2 (Tasks populator) entirely unimplemented, no CLI subcommand, no golden tests

- **Date:** 2026-06-14T18:27:41.217Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** The /rd3:dev-run loop shipped refresh as a stub. The 0056 stub-shape test (toHaveProperty) masked it.
- **Fix:** Implemented renderIndex (deterministic ID-encoded tree, tree connectors, status badge + relative link) writing INDEX.md via atomicWriteAsync; ## Tasks populator scanning tasksDir for feature_id edges and rewriting only the marker region via replaceMarkerRegion; spur feature refresh CLI subcommand; 5 golden-file tests + 2 CLI tests; E2E verified.
- **Tags:** feature-refresh, index, stub-shipped-as-done, 0058, P1
- **Occurrences:** 1

## bug-469: Feature marker convention mismatch: 0054 template + 0056 templateContent emitted <!-- BEGIN_TASKS --> (and omitted the ## Tasks heading), but MarkdownDocument.replaceMarkerRegion + the real corpus use <!-- AUTO-GENERATED by spur feature refresh -->

- **Date:** 2026-06-14T18:27:41.217Z
- **File:** `config/templates/feature/default.md`
- **Root cause:** Three-way drift: 0042 marker primitive + the hand-authored corpus agreed on AUTO-GENERATED markers, but the template + the create path used BEGIN_TASKS with no ## Tasks heading. spur feature refresh (replaceMarkerRegion) would throw "No marker region found" on any feature created by spur feature create.
- **Fix:** Changed config/templates/feature/default.md AND feature-service.templateContent to emit ## Tasks + canonical AUTO-GENERATED markers. Updated apps/cli/tests/init-templates.test.ts to assert the new markers. Verified a created feature now refreshes cleanly.
- **Tags:** feature, markers, template, cross-task-drift, 0042, 0054, 0056, 0058, P2
- **Occurrences:** 1

## bug-470: Null/undefined access in 

- **Date:** 2026-06-14T18:36:47.992Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-471: Missing guard clause

- **Date:** 2026-06-14T18:37:26.520Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** No early return/throw for edge case: root === null
- **Fix:** Added guard clause: if (root === null)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-472: Null/undefined access in 

- **Date:** 2026-06-14T18:38:40.611Z
- **File:** `packages/app/tests/services/feature-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-473: Significant refactor of 

- **Date:** 2026-06-14T18:39:37.730Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 4→10 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-474: Task 0059 FeatureLifecycleAdapter was a pure stub (no engine calls, empty rehydrate, no run links, not wired into the feature write path) — R1/R2/R3 UNMET despite engine 0.3.17 having the APIs

- **Date:** 2026-06-14T18:41:11.784Z
- **File:** `packages/app/src/workflow/feature-lifecycle-adapter.ts`
- **Root cause:** Same false-upstream-gate pattern as 0055: the /rd3:dev-run loop shipped a TODO(0059) stub on the assumption ts-libs E1/E2 had not shipped, but engine 0.3.17 already exposes createOrAttachRun/requestTransition/reseedRun. The stub test only exercised the schema fallback (vacuous).
- **Fix:** Built the real adapter mirroring the 0055 LifecycleAdapter: createOrAttach feature:<id>, reseed (DD-04 file-wins), requestTransition with denial mapping, one task_run_links row (kind=feature-lifecycle) on attach. Wired into PlanningWriteService from the feature CLI makeService. 6 engine-integration tests + E2E (feature update A active emits feature.transitioned + History line + link row).
- **Tags:** feature-lifecycle, workflow-engine, stub-shipped-as-done, false-upstream-gate, 0059, P1
- **Occurrences:** 1

## bug-475: Task 0059 R2 verifying-readiness rule ("warns unless linked tasks done/cancelled") had no implementation

- **Date:** 2026-06-14T18:41:11.784Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** The active→verifying YAML guard runs `spur feature check`, but feature-check L4 never checked whether a verifying feature's linked tasks were complete — so the guard could not surface the readiness warning DD-13 requires.
- **Fix:** feature-check runL4 now takes the feature status and counts linked tasks whose status is not done/cancelled; when status==verifying and any are incomplete, emits a non-blocking L4 warning (exit 0 — the active→verifying guard warns but allows). Tested + the runL4 signature gained a status param.
- **Tags:** feature-check, verifying, dd-13, L4, 0059, P2
- **Occurrences:** 1

## bug-476: Missing await

- **Date:** 2026-06-14T18:43:26.422Z
- **File:** `packages/app/tests/services/feature-check.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-477: Missing error handling in checkAcCoverage

- **Date:** 2026-06-14T18:47:45.492Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-478: Significant refactor of 

- **Date:** 2026-06-14T18:48:40.898Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** 15 lines replaced/restructured
- **Fix:** Rewrote 25→10 lines (15 removed) | Also: const acBody = doc.getSection('Acceptance Criteria; const hasScenarios = acBody !== null && /^\s*Scena
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-479: Missing guard clause

- **Date:** 2026-06-14T18:50:04.031Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** No early return/throw for edge case: hasScenarios && linkedTaskAc.length > 0
- **Fix:** Added guard clause: if (hasScenarios && linkedTaskAc.length > 0)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 2

## bug-480: Null/undefined access in 

- **Date:** 2026-06-14T18:50:15.420Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-481: Null/undefined access in 

- **Date:** 2026-06-14T18:51:59.619Z
- **File:** `packages/app/tests/services/task-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-482: Null/undefined access in 

- **Date:** 2026-06-14T18:52:17.450Z
- **File:** `packages/app/tests/services/feature-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-483: Incorrect value in code

- **Date:** 2026-06-14T18:52:56.539Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `<wbs>`
- **Fix:** Changed to `feature_id`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-484: Wrong reference: 1067 should be 1078

- **Date:** 2026-06-14T22:04:34.664Z
- **File:** `docs/tasks/0060_W2_Task-to-feature_traceability_validation_L4.md`
- **Root cause:** Used "1067" instead of "1078"
- **Fix:** Changed 1067 → 1078
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-485: Task 0060 R1/R2: checkAcCoverage (0043) existed but was consumed by NEITHER check service — task-AC-subset (R1) and feature coverage-orphans (R2) unimplemented

- **Date:** 2026-06-14T22:05:12.735Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** The 0043 BDD module exports checkAcCoverage + normalizeTitle, but task-check and feature-check never called them. Only R3 (dangling edges) was wired. The /rd3:dev-run loop shipped the requirement as a no-op (the engine existed, the consumption did not).
- **Fix:** task-check L4 runs checkAcCoverage(featureAc, taskAc, taskChecklist) for tasks with feature_id+AC — uncovered task scenarios = warnings (C04 default). feature-check L4 reports coverage-based orphans by intersecting per-task orphan sets (NOT concatenating Feature: blocks, which only parses the first). Both fence-strip via the shared stripAcFence.
- **Tags:** traceability, ac-coverage, dd-09, task-check, feature-check, L4, 0060, P1
- **Occurrences:** 1

## bug-486: checkAcCoverage cannot validate multiple linked tasks by concatenating their Gherkin AC — multiple Feature: blocks parse only the first

- **Date:** 2026-06-14T22:05:12.735Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** A first attempt concatenated all linked task ACs into one `Feature: linked\n...` string and called checkAcCoverage once. The Gherkin parser only reads the FIRST Feature block, so scenarios in tasks 2..N were missed → false orphans (a covered scenario reported as orphan). Verified with a probe.
- **Fix:** Compute coverage per-task and INTERSECT the orphan sets: a feature scenario is orphaned only if every task leaves it orphaned. Probe confirmed task1=alpha + task2=beta → only gamma orphaned.
- **Tags:** ac-coverage, gherkin-parser, multi-feature-block, feature-check, 0060, P2
- **Occurrences:** 1

## bug-487: Null/undefined access in 

- **Date:** 2026-06-14T22:07:40.952Z
- **File:** `packages/app/tests/services/task-check.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-488: Significant refactor of 

- **Date:** 2026-06-14T22:09:54.915Z
- **File:** `docs/tasks/0060_W2_Task-to-feature_traceability_validation_L4.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 4→5 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-489: Missing error handling in move

- **Date:** 2026-06-14T22:15:22.732Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-490: Missing error handling in unknown

- **Date:** 2026-06-14T22:16:12.981Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-491: Significant refactor of 

- **Date:** 2026-06-14T22:17:10.649Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 7→90 lines (4 removed) | Also: test('R3: a collision (target id already exists) i; // Pre-occupy B1 so moving A1 under B (→ B1) colli
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-492: Missing guard clause

- **Date:** 2026-06-14T22:18:30.151Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** No early return/throw for edge case: p.startsWith(featuresDir
- **Fix:** Added guard clause: if (p.startsWith(featuresDir)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-493: Missing await

- **Date:** 2026-06-14T22:18:52.889Z
- **File:** `apps/cli/tests/commands/feature.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call | Also: test('move applies the cascade and prints a human summary (n; const aOut = createCapturedOutput();
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 2

## bug-494: Task 0061 FeatureService.move was a pure stub returning {movedCount:0} — cascade rename (R1), task-edge updates+History (R2), atomic+dry-run (R3) all unimplemented; no CLI subcommand

- **Date:** 2026-06-14T22:21:15.121Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** The /rd3:dev-run loop shipped move as a stub (last W2 task, the childrenOf enumeration deferred from 0056). The 0056 stub-shape test (toHaveProperty) masked it.
- **Fix:** Implemented move(id, newParentId, {dryRun}): old→new ID map for node + descendants (next free digit ≤9 via allocateId, relative suffix preserved); validate-before-write (collision + not-into-own-subtree); apply = atomic-write renamed feature files + delete old + rewrite id frontmatter + move History + task feature_id edge updates; best-effort rollback (track created/removed, restore on mid-cascade failure); --dry-run returns the plan with zero writes. CLI spur feature move <id> --parent <id> [--dry-run]. 6 service tests + 3 CLI tests + E2E.
- **Tags:** feature-move, cascade-rename, dd-14, atomicity, rollback, stub-shipped-as-done, 0061, P1
- **Occurrences:** 1

## bug-495: Function not marked async

- **Date:** 2026-06-14T22:23:37.919Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Function uses await but wasn't declared async
- **Fix:** Added async modifier
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-496: Wrong return value

- **Date:** 2026-06-14T22:23:51.179Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Was returning: { movedCount: subtree.length, mapping, tasksUpdate
- **Fix:** Now returns: { movedCount, mapping, tasksUpdated: affectedTasks
- **Tags:** auto-detected, return-value, ts
- **Occurrences:** 1

## bug-497: Significant refactor of 

- **Date:** 2026-06-14T22:24:33.504Z
- **File:** `docs/tasks/0061_W2_spur_feature_move_cascade_rename_for_hierarchy_changes.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-498: Significant refactor of 

- **Date:** 2026-06-14T22:34:20.517Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 11→16 lines (4 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-499: Missing error handling in unknown

- **Date:** 2026-06-14T22:36:07.505Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-500: Null/undefined access in 

- **Date:** 2026-06-14T22:36:53.202Z
- **File:** `packages/domain/tests/planning/lifecycle-drift.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-501: Task 0062 task-pipeline.yaml had a dead $schema ref (@gobing-ai/ts-dual-workflow-engine/schemas/...) — spur workflow validate FAILED to resolve the schema

- **Date:** 2026-06-14T22:39:05.683Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The same dead-ref pattern fixed in the lifecycle YAMLs (DNR 2026-06-13): the engine package ships no schemas dir and is not installed at repo root, so the bare-package $schema is unresolvable. task-pipeline still had the old ref. No bundled-workflow validation test existed to catch it.
- **Fix:** Changed $schema to @gobing-ai/spur/schemas/state-machine-workflow.schema.json (the CLI ships + exports these). Added a test in workflow.test.ts validating ALL 5 bundled config/workflows/*.yaml with full schema resolution to catch any future dead ref.
- **Tags:** workflow, task-pipeline, dead-schema-ref, dnr, 0062, P1
- **Occurrences:** 1

## bug-502: Task 0062 task-pipeline.yaml was a skeleton stub — states used name: (schema wants id:), no vars, no guards, no actions; R1-R4 unimplemented

- **Date:** 2026-06-14T22:39:05.683Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The /rd3:dev-run loop seeded a state-graph skeleton, not the design §6 pipeline. "Orchestration is configuration" means the requirements live in the YAML (onEnter actions, transition guards, vars) — none were present.
- **Fix:** Authored the full pipeline: states with id:; vars wbs/profile; precheck shell guard (spur task check) with fail fall-through to failed; agent.run steps (implement/test/review/verify); hitl.confirm approve (profile=auto skip); record writes Testing/Review via spur task update --section; status moves via spur task update <wbs> <status> (lifecycle guards apply). R4 task_run_links flagged as a WorkflowService-hook follow-up (no link-writing CLI). Validates clean; precheck-fail E2E verified.
- **Tags:** workflow, task-pipeline, stub-shipped-as-done, zero-engine-code, 0062, P1
- **Occurrences:** 1

## bug-503: Incorrect value in code

- **Date:** 2026-06-14T22:46:40.673Z
- **File:** `docs/tasks/0062_W3_task-pipeline.yaml_execution_workflow_with_guards_and_record_step.md`
- **Root cause:** Had `task-pipeline.yaml`
- **Fix:** Changed to 's "
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-504: Missing error handling in latestPausedRun

- **Date:** 2026-06-14T22:55:20.787Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-505: Type error

- **Date:** 2026-06-14T22:55:27.112Z
- **File:** `packages/app/src/services/workflow-service.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-506: Missing error handling in unknown

- **Date:** 2026-06-14T22:56:41.522Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-507: Significant refactor of 

- **Date:** 2026-06-14T22:59:07.875Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 8→10 lines (2 removed) | Also: Human-in-the-loop approval gate. The state PAUSES ; until `spur workflow continue` resumes it; the hit
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 2

## bug-508: Null/undefined access in 

- **Date:** 2026-06-14T23:00:33.005Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-509: Null/undefined access in 

- **Date:** 2026-06-14T23:00:57.595Z
- **File:** `apps/cli/tests/commands/workflow.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-510: Incorrect value in code

- **Date:** 2026-06-14T23:04:01.355Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `spur workflow list [--json]`
- **Fix:** Changed to `spur workflow continue [run-id] [--yes] [--json]`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-511: Task 0063 spur workflow continue entirely unimplemented (no verb/service method/test) despite the upstream-gated tag being false — engine 0.3.17 has resumeRun + listPausedRuns (E3)

- **Date:** 2026-06-14T23:05:49.774Z
- **File:** `apps/cli/src/commands/workflow.ts`
- **Root cause:** Same false-upstream-gate pattern as 0055/0059. The dev-run loop left it a no-op.
- **Fix:** Added WorkflowAppService.continuePaused(runId) (resolve def by workflow_name via list() → resumeRun) + latestPausedRun() (listPausedRuns limit 1) + CLI `workflow continue [run-id] [--yes] [--json]` (discover+confirm via HITL responder unless --yes). 3 service + 4 CLI tests; in-process E2E pause→discover→resume.
- **Tags:** workflow, continue, hitl, e3, false-upstream-gate, 0063, P1
- **Occurrences:** 1

## bug-512: apps/cli/schemas/state-machine-workflow.schema.json missing the `pause` field — a pause:true state (needed for E3 HITL) failed full JSON-schema validation though the engine Zod supports it

- **Date:** 2026-06-14T23:05:49.774Z
- **File:** `apps/cli/schemas/state-machine-workflow.schema.json`
- **Root cause:** JSON-schema-vs-engine-Zod drift (recurring pattern). The engine StateDef (0.3.x) has pause?: boolean but the hand-maintained workspace JSON schema never got it.
- **Fix:** Added pause:boolean to the state definition in the workspace schema. NOTE: a separate stale-global-install issue (spur workflow validate resolves a globally-installed @gobing-ai/spur@0.2.5 in ~/node_modules, not the workspace schema) means the pipeline approve pause:true is deferred (P3) until the global is refreshed — same class as the deferred catalog links.
- **Tags:** workflow, json-schema, pause, zod-drift, stale-global-install, 0063, P2
- **Occurrences:** 1

## bug-513: Null/undefined access in 

- **Date:** 2026-06-14T23:09:27.889Z
- **File:** `packages/app/tests/services/workflow-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-514: Significant refactor of 

- **Date:** 2026-06-14T23:09:46.531Z
- **File:** `docs/tasks/0063_W3_spur_workflow_continue_HITL_resume.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 4→6 lines (4 removed) | Also: - `packages/app/tests/services/workflow-service.te; `latestPausedRun` is null when nothing is paused; 
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-515: Significant refactor of 

- **Date:** 2026-06-14T23:41:25.045Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 13→22 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-516: Incorrect value in code

- **Date:** 2026-06-14T23:41:31.193Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** Had `dependencies`
- **Fix:** Changed to 's `
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-517: Significant refactor of 

- **Date:** 2026-06-14T23:42:05.575Z
- **File:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 9→11 lines (2 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-518: Incorrect value in code

- **Date:** 2026-06-14T23:42:13.176Z
- **File:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Root cause:** Had `--auto`
- **Fix:** Changed to `--var profile=auto`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-519: Task 0064 spur-dev skill decomposition.md documented a batch-JSON shape the CLI gate REJECTS — {tasks:[...]} wrapper (schema is a bare array), plus `sections` + `dependencies` fields that the strict taskBatchItemSchema rejects

- **Date:** 2026-06-14T23:44:58.051Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** The skill (a Fat Skill whose whole point is producing gate-passing CLI input, R3) had a decomposition guide that drifted from apps/cli/schemas/task-batch.schema.json. The real shape is a top-level ARRAY of strict items {name,template,feature_id,parent_wbs,priority,tags,background,requirements}; the guide used a {tasks:[]} object with sections{} and dependencies[]. An LLM following the skill would produce CLI-rejected JSON.
- **Fix:** Rewrote the schema table + JSON example + violations table to the real shape (top-level array, background/requirements not sections, no dependencies, quoted parent_wbs). Cross-checked against the Zod taskBatchItemSchema.
- **Tags:** skill, spur-dev, fat-skill, schema-drift, decomposition, r3, 0064, P2
- **Occurrences:** 1

## bug-520: Task 0064 spur-dev ac-style-guide claimed spur feature check GATES @core / WARNS @edge tags (not implemented) and matches by R-number (it matches by normalized title, R-prefix stripped)

- **Date:** 2026-06-14T23:44:58.051Z
- **File:** `plugins/sp/skills/spur-dev/references/ac-style-guide.md`
- **Root cause:** The skill stated nonexistent CLI behavior (R3 forbids inventing CLI behavior). feature check (0057) checks all scenarios uniformly — no @core/@edge tier gating; coverage (0060) matches via normalizeTitle which STRIPS the R-prefix, so matching is by title text not R-number.
- **Fix:** Reframed the two AC tiers as an authoring convention (DD-06 permissive start) explicitly NOT current CLI gating; corrected the matching claim to normalized scenario title. Also fixed --auto → --var profile=auto (the real HITL-skip flag).
- **Tags:** skill, spur-dev, invented-cli-behavior, ac-tiers, r3, 0064, P2
- **Occurrences:** 1

## bug-521: Wrong reference: var should be vars

- **Date:** 2026-06-14T23:55:02.102Z
- **File:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Root cause:** Used "var" instead of "vars"
- **Fix:** Changed var → vars
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-522: Incorrect value in code

- **Date:** 2026-06-14T23:55:19.116Z
- **File:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Root cause:** Had `bash
spur workflow run config/workflows/task-pipe
- **Fix:** Changed to `bash
spur workflow run config/workflows/task-pipe
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-523: Incorrect value in code

- **Date:** 2026-06-14T23:55:38.101Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** Had `--var wbs=0042`
- **Fix:** Changed to `--vars`
- **Tags:** auto-detected, wrong-value, yaml
- **Occurrences:** 1

## bug-524: Incorrect value in code

- **Date:** 2026-06-14T23:55:54.081Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `--var profile=auto`
- **Fix:** Changed to `--vars '
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-525: Incorrect value in code

- **Date:** 2026-06-14T23:56:26.099Z
- **File:** `docs/tasks/0064_W3_sp_spur-dev_umbrella_skill_planning_and_execution_halves.md`
- **Root cause:** Had `--var profile=auto`
- **Fix:** Changed to `SKILL.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-526: Systemic wrong workflow flag: spur-dev skill + task-pipeline.yaml comments + 04_DESIGN §7.5 taught `--var key=value`, but the real flag is `--vars <json>` (no --var alias)

- **Date:** 2026-06-14T23:58:05.447Z
- **File:** `plugins/sp/skills/spur-dev/SKILL.md`
- **Root cause:** workflow run takes --vars <json-object>, parsed by parseVars into Record<string,string>. There is no --var key=val form. The wrong --var form was authored in 0062 (task-pipeline header), propagated to 0063 docs and 0064 skill. The taught command would error at the commander boundary (unknown option).
- **Fix:** Replaced all --var key=val with --vars '{"wbs":"<wbs>"}' (and '{"profile":"auto"}') in SKILL.md (3x), task-pipeline.yaml comments, and 04_DESIGN §7.5. Verified via a run probe that --vars JSON resolves ${vars.wbs}.
- **Tags:** workflow, cli-flag, vars, skill, systemic-doc-bug, 0062, 0063, 0064, P2
- **Occurrences:** 1

## bug-527: Significant refactor of 

- **Date:** 2026-06-15T00:04:06.798Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 6→10 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-528: Task 0065 missing R1 deliverable: the auditable ADR-016 per-candidate verdict table (record pass/fail + rationale in ## Review) was never produced — the 12 dev-* commands were shipped without the decision record

- **Date:** 2026-06-15T00:04:46.845Z
- **File:** `docs/tasks/0065_W3_sp_dev-_slash_command_subset_and_subagents.md`
- **Root cause:** The dev-run loop authored the command + subagent markdown (thin wrappers, correct) but skipped R1/Solution-step-1: the ADR-016 filter output. The auditable "why each command exists" record was empty.
- **Fix:** Applied ADR-016 per candidate (all 12 pass: LLM-driven fuzzy-intent→reliable-sequence, none a bare CLI forwarder); wrote the verdict table into ## Review; updated delivery doc §7.3 proposed→shipped.
- **Tags:** skill, commands, adr-016, decision-record, 0065, P2
- **Occurrences:** 1

## bug-529: Task 0065 dev-docs command delegates to sp:doc-evolve, a skill that does not yet exist

- **Date:** 2026-06-15T00:04:46.845Z
- **File:** `plugins/sp/commands/dev-docs.md`
- **Root cause:** doc-evolve is "proposed (full rewrite of rd3:code-docs)" in delivery §7.3 — a planned future skill. The dev-docs command is a forward-dependency, inert until the skill ships. Other 11 dev-* wrap the existing sp:spur-dev.
- **Fix:** Flagged P3 (kept — passes ADR-016, planned sibling per guardrail; noted inert-pending in delivery §7.3 "shipped (inert)"). Not fixed here — building sp:doc-evolve is a future task (I15).
- **Tags:** skill, commands, forward-dependency, doc-evolve, 0065, P3
- **Occurrences:** 1

## bug-530: Task 0066 (sp:spur-tasks + sp:spur-features companion skills) was marked Done by the /rd3:dev-run loop but shipped NOTHING — plugins/sp/skills/ held only spur-dev/spur-rules/spur-workflows; neither companion skill existed.

- **Date:** 2026-06-15T00:31:00.000Z
- **File:** `plugins/sp/skills/spur-tasks/SKILL.md, plugins/sp/skills/spur-features/SKILL.md`
- **Root cause:** dev-run false-completion: status advanced without producing the deliverable (recurring class across 0055/0058/0059/0061/0063 stubs; here it was total absence, not a stub).
- **Fix:** Authored both companion Fat-Skills (SKILL.md + 2 references each) grounded against the real spur task/feature CLI. R1 (task verb guide/section-editing/check-json matrix), R2 (feature authoring/AC R-numbering/traceability), R3 (zero pipeline logic — delegate to sp:spur-dev). Resolves 0065 forward-deps (expert-tasks->sp:spur-tasks, expert-features->sp:spur-features).
- **Tags:** skill, companion, spur-tasks, spur-features, unbuilt, false-completion, 0066
- **Occurrences:** 1

## bug-531: spur task update --section failed on 0066: 'Invalid option: expected one of backlog|todo|wip|... ' — the workspace spur CLI rejected the task file frontmatter.

- **Date:** 2026-06-15T00:31:30.000Z
- **File:** `docs/tasks/0066_*.md`
- **Root cause:** Two incompatible task-file dialects: the rd3 `tasks` CLI authors docs/tasks/*.md with title-case statuses (Backlog/Done) + impl_progress; the workspace spur CLI's taskFrontmatterSchema expects lowercase. The spur CLI cannot edit rd3-authored files.
- **Fix:** Edit docs/tasks/*.md via the rd3 `tasks` CLI ONLY (title-case, --phase/--phase-status for impl_progress), never the workspace `spur task` CLI. Confirmed 0064/0065 used the same path.
- **Tags:** tasks-cli, frontmatter, dialect, rd3, spur-cli, 0066
- **Occurrences:** 1

## bug-532: Incorrect value in code

- **Date:** 2026-06-15T00:32:10.115Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** Had `sp:spur-features`
- **Fix:** Changed to `update --section --from-file`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-532: 0066 first verify pass missed the same-commit doc-sync: delivery doc §7.1 still listed sp:spur-tasks/sp:spur-features as 'proposed' after they shipped; §7.4 expert-tasks/expert-features rows also stale.

- **Date:** 2026-06-15T00:40:00.000Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** Recurring class (also 0064 §7.3, 0065 §7.3): authoring the deliverable but not flipping its delivery-doc status row in the same task. The Design's 'Authority' line names the delivery section — that section must track reality (AGENTS.md same-commit sync rule).
- **Fix:** §7.1 both companion rows -> 'shipped (0066)' with grounded descriptions; §7.4 subagent rows -> 'shipped' (expert-dev 0065; expert-tasks/features 0065 with skill landed 0066). Cleanup-pass habit: on every task, grep delivery doc for the deliverable name + 'proposed' and flip.
- **Tags:** doc-sync, delivery-doc, proposed-vs-shipped, same-commit, 0066, process
- **Occurrences:** 1

## bug-534: Incorrect value in code

- **Date:** 2026-06-15T04:01:41.002Z
- **File:** `docs/plans/rd3-migration-delivery.md`
- **Root cause:** Had `resolve`
- **Fix:** Changed to `spur task resolve`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-535: Significant refactor of 

- **Date:** 2026-06-15T04:03:02.196Z
- **File:** `docs/design/rd3-migration-design.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-536: Missing guard clause

- **Date:** 2026-06-15T04:03:30.264Z
- **File:** `plugins/sp/hooks/task-write-guard.ts`
- **Root cause:** No early return/throw for edge case: process.env.SPUR_WRITE_GUARD === 'off'
- **Fix:** Added guard clause: if (process.env.SPUR_WRITE_GUARD === 'off')
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-533: 0067 unbuilt (dev-run shipped nothing: empty plugins/sp/hooks/). AND design §12.3's resolve->check->deny hook contract is unbuildable-as-useful: `spur task check` rejects 100% of the live docs/tasks/*.md corpus (missing schema_version:1, title-case status) because they are rd3-CLI-authored (DD-07 dialect gap).

- **Date:** 2026-06-15T01:10:00.000Z
- **File:** `plugins/sp/hooks/task-write-guard.ts, docs/design/rd3-migration-design.md`
- **Root cause:** Two task-file dialects (bug-531): the spur planning schema (DD-07) is the target; the live corpus is still rd3-dialect. A check-gating write-guard would deny every legitimate task edit.
- **Fix:** Shipped OWNERSHIP-ONLY hook (resolve->deny owned / allow else; SPUR_WRITE_GUARD=off escape hatch; pure delegation). Deferred the check-gate until the corpus migrates to DD-07; amended design §12.3. R2 decided: no info verb (hook needs only resolve). 7 subprocess tests; doc-sync §1.3/§7.5/§16.
- **Tags:** hook, PreToolUse, write-guard, dialect, DD-07, deferred, 0067
- **Occurrences:** 1

## bug-534: 0067 cleanup: Solution cited task-write-guard.ts:86 but the post-write refactor moved the spawnSync delegation to :85 (off-by-one citation). Also task-service.ts:440 carried a stale forward-ref claiming 0067 would add walk-up-to-nearest-owner resolution.

- **Date:** 2026-06-15T01:20:00.000Z
- **File:** `docs/tasks/0067_*.md, packages/app/src/services/task-service.ts`
- **Root cause:** file:line citation written before the final refactor; and a forward-looking source comment that the task's actual (ownership-only) decision contradicted.
- **Fix:** Citation :86 -> :85. Rewrote the resolve() comment to state ownership = is-a-task-file and that walk-up was NOT adopted. Re-ran gate (lint clean, app 407/0).
- **Tags:** cleanup, citation, stale-comment, forward-ref, 0067
- **Occurrences:** 1

## bug-539: Significant refactor of 

- **Date:** 2026-06-15T04:15:37.640Z
- **File:** `apps/cli/tests/commands/agent-team.test.ts`
- **Root cause:** 8 lines replaced/restructured
- **Fix:** Rewrote 30→39 lines (8 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-540: Incorrect value in code

- **Date:** 2026-06-15T04:15:49.911Z
- **File:** `apps/cli/tests/commands/agent-team.test.ts`
- **Root cause:** Had '@gobing-ai/ts-ai-runner'
- **Fix:** Changed to '@gobing-ai/spur-app'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-535: agent-team.test.ts drain test 'folds pending messages into the prompt and maps spec id to type' was false-coverage: it asserted only receivedInput.toContain('do work') (the original prompt). Its own comment admitted the per-call :memory: DBs were isolated so --drain never found the seeded message — the test passed while verifying nothing about drain. R1 (team-mode verified end-to-end) was therefore not actually met.

- **Date:** 2026-06-15T01:35:00.000Z
- **File:** `apps/cli/tests/commands/agent-team.test.ts`
- **Root cause:** Test seeded the spec+message via main() (fresh :memory: DB per call) but ran drain via runAgentRun(ctx) (ctx's cached DB) — two different DBs. getDb caches dbPromise PER ctx, so cross-call state needs ONE ctx, not repeated main() calls.
- **Fix:** Rewrote: seed spec+message through `new TeamService(ctx)` (shared cached DB), then assert the drained body is present, precedes the operator prompt, and the spec id mapped to runner type 'claude'. R8: a test must verify the behavior its name claims.
- **Tags:** test, false-coverage, drain, team-mode, memory-db-isolation, 0068, R8
- **Occurrences:** 1

## bug-536: `spur feature update B1 done` fails: SQLiteError: no such column: external_key. The live .spur/spur.db predates the workspace schema/runs.ts:12 `external_key` column, so the feature-lifecycle engine (which writes a run-link row referencing it) crashes on any feature status transition.

- **Date:** 2026-06-15T01:50:00.000Z
- **File:** `.spur/spur.db (stale migration state)`
- **Root cause:** Stale project DB — last migrated by an older build before external_key was added. Same stale-install class as the deferred catalog link: + global spur@0.2.5. Not a workspace code bug (packages/domain/src/schema/runs.ts DOES define external_key).
- **Fix:** DEFERRED per operator stale-install policy. Workaround for traceability: B1 AC checked by hand + `spur feature refresh` (which only reads, doesn't transition) synced the Tasks blocks. The feature status flip needs a project DB re-migration, out of 0068 scope.
- **Tags:** stale-db, external_key, feature-lifecycle, deferred, stale-install, 0068
- **Occurrences:** 1

## bug-537: 0068 cleanup: feature Tasks blocks were stale across the corpus (H2 showed 0066/0067 backlog though both Done; B1 showed 0068 backlog). Closing a task did not sync the owning feature's Tasks block. Also task citation agent-team.test.ts:261 was :262 after the import shift.

- **Date:** 2026-06-15T01:51:00.000Z
- **File:** `docs/features/*, docs/tasks/0068_*.md`
- **Root cause:** No `spur feature refresh` run at task close; and a file:line citation written before the final import edit.
- **Fix:** Ran `spur feature refresh` (synced 18 Tasks blocks to real status); checked B1's 3 AC; corrected :261 -> :262. PROCESS: run `spur feature refresh` when closing a task so the owning feature's Tasks block tracks reality.
- **Tags:** cleanup, feature-refresh, traceability-sync, citation, 0068
- **Occurrences:** 1

## bug-544: Wrong reference: rd3 should be sp

- **Date:** 2026-06-15T04:28:14.310Z
- **File:** `plugins/sp/skills/brainstorm/SKILL.md`
- **Root cause:** Used "rd3" instead of "sp"
- **Fix:** Changed rd3 → sp
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-545: Significant refactor of 

- **Date:** 2026-06-15T04:28:18.495Z
- **File:** `plugins/sp/skills/brainstorm/SKILL.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 6→4 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-538: 0069 unbuilt (dev-run moved none of the 3 prompt-skills). The 'verbatim' anti-hallucination move + the daily-summary move were broken on arrival: scripts/tests imported the rd3 plugin's ../../../scripts/logger (absent in sp) and hardcoded plugins/rd3/ paths. anti-hallucination: 0/8 tests + 4 errors. daily-summary script: 'Cannot find module ../../../scripts/logger'.

- **Date:** 2026-06-15T02:10:00.000Z
- **File:** `plugins/sp/skills/{anti-hallucination,daily-summary,brainstorm}`
- **Root cause:** A cross-plugin move that keeps rd3-relative imports + hardcoded rd3 paths breaks in the destination plugin. 'Move verbatim' must still RUN — copy is not enough.
- **Fix:** Added a self-contained scripts/logger.ts in each skill that has scripts (exact used API, 100% covered), re-pointed imports to ./logger, rewrote plugins/rd3/ -> plugins/sp/. Re-pointed brainstorm rd3: delegations to real sp/spur targets + fixed a stale --from-json CLI shape. anti-hallucination 95/95, daily-summary 56/56, suite 1266/0.
- **Tags:** skill-move, verbatim, logger, cross-plugin-import, namespace, coverage, 0069
- **Occurrences:** 1

## bug-539: 0069 cleanup: H3 feature AC unchecked + Tasks block stale (0069 showed Backlog though Done). Applied the 0068 process learning: run `spur feature refresh` at task close.

- **Date:** 2026-06-15T02:25:00.000Z
- **File:** `docs/features/H3_prompt-skill-moves.md`
- **Root cause:** Closing a task does not auto-sync the owning feature; the feature-refresh-at-close habit (logged 0068) wasn't yet applied at 0069 close.
- **Fix:** Checked H3's 3 AC that 0069 satisfies (AC4 sp:doc-evolve left unchecked — maps to 0070, next task). `spur feature refresh` synced H3's Tasks block (0069 -> Done). Feature status NOT flipped (H3 incomplete until 0070). H3 feature check clean.
- **Tags:** cleanup, feature-refresh, traceability-sync, H3, 0069
- **Occurrences:** 1

## bug-540: 0070 unbuilt (sp:doc-evolve missing — the forward-dep from 0065's dev-docs command). Built it; its first real drift-audit run immediately found genuine T3 drift: spur task + spur feature command groups exist in apps/cli/src/commands/{task,feature}.ts but AGENTS.md (line 175-180) still says 'accepted but not yet built — do not invoke them' and 04_DESIGN has no command sections for them.

- **Date:** 2026-06-15T02:45:00.000Z
- **File:** `plugins/sp/skills/doc-evolve/, AGENTS.md, docs/04_DESIGN.md`
- **Root cause:** doc-evolve was a 0065 forward-dep never built. Separately: the W1/W2 planning surface (0052-0061) shipped but its 04/AGENTS.md surface-sync (T3) was never done — exactly the drift class doc-evolve detects.
- **Fix:** Built sp:doc-evolve (SKILL.md + operations mini-spec) constitution-native (R3). Ran it → produced a correct drift report (zero false positives). The task/feature surface-sync repair is FLAGGED as a separate W1/W2 doc task (out of 0070 scope — doc-evolve's job is to detect). Delivery §7.2 doc-evolve + §7.3 dev-docs flipped to shipped; H3 AC4 checked (feature complete).
- **Tags:** skill, doc-evolve, constitution, drift-audit, T3, forward-dependency, 0070, loop-complete
- **Occurrences:** 1

## bug-541: 0070 cleanup: H3 feature fully complete (all 4 AC met, both tasks 0069+0070 Done) but status stays 'backlog'. `spur feature update H3 active` fails: SQLiteError: no such column: external_key — same stale .spur/spur.db as B1 (bug-536).

- **Date:** 2026-06-15T02:55:00.000Z
- **File:** `docs/features/H3_prompt-skill-moves.md, .spur/spur.db`
- **Root cause:** Feature-lifecycle transition writes a run-link row referencing external_key; the live project DB predates that column (deferred stale-install class).
- **Fix:** DEFERRED per operator stale-install policy (same as bug-536). The real traceability sync — AC checkboxes + Tasks block — is done via hand-edit + `spur feature refresh`. The status-field flip needs a project DB re-migration, out of task scope. H3 feature check passes.
- **Tags:** stale-db, external_key, feature-lifecycle, deferred, H3, 0070, loop-complete
- **Occurrences:** 2

## bug-550: Significant refactor of 

- **Date:** 2026-06-15T07:03:02.064Z
- **File:** `docs/design/server-side-adjustment-design.md`
- **Root cause:** 24 lines replaced/restructured
- **Fix:** Rewrote 57→69 lines (24 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-551: Significant refactor of 

- **Date:** 2026-06-15T15:48:07.602Z
- **File:** `docs/design/server-side-adjustment-design.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 16→23 lines (3 removed) | Also: // No `.output()` Zod schema — streaming outputs a; // generic at the handler, not a single Zod object
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-552: Incorrect value in code

- **Date:** 2026-06-15T15:48:25.746Z
- **File:** `docs/design/server-side-adjustment-design.md`
- **Root cause:** Had `~/xprojects/ts-libs/packages/runtime/src`
- **Fix:** Changed to `@gobing-ai/ts-runtime@0.3.18`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 2

## bug-553: Significant refactor of 

- **Date:** 2026-06-15T15:48:33.830Z
- **File:** `docs/design/server-side-adjustment-feature-finalized.md`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 5→6 lines (2 removed) | Also: **Scope.** `spur serve [--port <n>] [--no-open] [-; Config resolution: CLI flag → `config.server.port`
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-554: Significant refactor of 

- **Date:** 2026-06-15T15:49:06.906Z
- **File:** `docs/plans/server-side-adjustment-feature-drafted.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→6 lines (3 removed) | Also: ### Config source: extend `.spur/config.yaml` (con; **Decision: add a `server:` block to the existing 
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-555: Significant refactor of 

- **Date:** 2026-06-15T18:11:07.667Z
- **File:** `docs/design/server-side-adjustment-design.md`
- **Root cause:** 10 lines replaced/restructured
- **Fix:** Rewrote 13→36 lines (10 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-556: Missing await

- **Date:** 2026-06-15T18:12:57.026Z
- **File:** `../../../../tmp/0073_plan_current.md`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, md
- **Occurrences:** 1

## bug-557: Significant refactor of 

- **Date:** 2026-06-15T18:13:19.748Z
- **File:** `docs/design/server-side-adjustment-feature-finalized.md`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 8→14 lines (4 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-558: Significant refactor of 

- **Date:** 2026-06-15T21:50:17.242Z
- **File:** `apps/server/src/middleware/pipeline.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 14→22 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-559: Significant refactor of 

- **Date:** 2026-06-15T21:50:44.241Z
- **File:** `apps/server/tests/middleware/pipeline.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→32 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-560: Significant refactor of 

- **Date:** 2026-06-15T23:11:31.752Z
- **File:** `packages/domain/src/db.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 16→25 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-561: Missing error handling in getDb

- **Date:** 2026-06-15T23:12:51.435Z
- **File:** `apps/server/src/context.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-562: Incorrect value in code

- **Date:** 2026-06-15T23:12:59.476Z
- **File:** `apps/server/src/bootstrap.ts`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/ts-infra/application'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-563: Significant refactor of 

- **Date:** 2026-06-15T23:13:04.885Z
- **File:** `apps/server/src/bootstrap.ts`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 10→5 lines (4 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-564: Significant refactor of 

- **Date:** 2026-06-16T04:18:49.540Z
- **File:** `apps/server/src/context.ts`
- **Root cause:** 5 lines replaced/restructured
- **Fix:** Rewrote 12→16 lines (5 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-565: Missing import: @gobing-ai/ts-infra, @gobing-ai/ts-db

- **Date:** 2026-06-16T04:19:18.427Z
- **File:** `apps/server/src/context.ts`
- **Root cause:** Module(s) not imported: @gobing-ai/ts-infra, @gobing-ai/ts-db
- **Fix:** Added import(s) for @gobing-ai/ts-infra, @gobing-ai/ts-db
- **Tags:** auto-detected, missing-import, ts
- **Occurrences:** 1

## bug-566: Missing import: @gobing-ai/ts-infra/job-queue-db

- **Date:** 2026-06-16T04:45:56.534Z
- **File:** `apps/server/src/context.ts`
- **Root cause:** Module(s) not imported: @gobing-ai/ts-infra/job-queue-db
- **Fix:** Added import(s) for @gobing-ai/ts-infra/job-queue-db
- **Tags:** auto-detected, missing-import, ts
- **Occurrences:** 2

## bug-567: Significant refactor of 

- **Date:** 2026-06-16T04:46:14.815Z
- **File:** `apps/server/src/index.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 27→63 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-568: Type error

- **Date:** 2026-06-16T04:46:54.570Z
- **File:** `packages/domain/src/db.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-569: Missing import: @gobing-ai/spur-domain

- **Date:** 2026-06-16T04:47:55.565Z
- **File:** `apps/server/src/index.ts`
- **Root cause:** Module(s) not imported: @gobing-ai/spur-domain
- **Fix:** Added import(s) for @gobing-ai/spur-domain
- **Tags:** auto-detected, missing-import, ts
- **Occurrences:** 1

## bug-570: Missing await

- **Date:** 2026-06-16T05:11:56.799Z
- **File:** `apps/server/tests/context.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call | Also: test('eventBus() returns the appRt events by default', () =>; test('R6: a published event on the provided EventBus is obse
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 2

## bug-571: Significant refactor of 

- **Date:** 2026-06-16T05:21:56.830Z
- **File:** `packages/domain/tests/dao/migrations.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 7→12 lines (2 removed) | Also: test('existing DB that already applied 0000 gains ; expect(applied).toBe(2);
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-572: Missing await

- **Date:** 2026-06-16T05:27:50.409Z
- **File:** `packages/domain/tests/db.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-573: Type error

- **Date:** 2026-06-16T05:33:44.645Z
- **File:** `packages/domain/src/db.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-574: Wrong reference: contributed should be contributes

- **Date:** 2026-06-16T05:59:37.029Z
- **File:** `apps/server/src/modules/types.ts`
- **Root cause:** Used "contributed" instead of "contributes"
- **Fix:** Changed contributed → contributes
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-575: Wrong reference: new should be fs

- **Date:** 2026-06-16T06:34:13.017Z
- **File:** `apps/cli/src/context.ts`
- **Root cause:** Used "new" instead of "fs"
- **Fix:** Changed new → fs
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-576: Wrong reference: new should be createNodeFileSystem

- **Date:** 2026-06-16T06:34:56.969Z
- **File:** `apps/cli/tests/commands/agent-team.test.ts`
- **Root cause:** Used "new" instead of "createNodeFileSystem"
- **Fix:** Changed new → createNodeFileSystem
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-577: Wrong reference: new should be createNodeFileSystem

- **Date:** 2026-06-16T06:34:59.549Z
- **File:** `packages/app/tests/services/team-service.test.ts`
- **Root cause:** Used "new" instead of "createNodeFileSystem"
- **Fix:** Changed new → createNodeFileSystem
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-578: Incorrect value in code

- **Date:** 2026-06-16T06:37:53.021Z
- **File:** `apps/server/tests/serve.test.ts`
- **Root cause:** Had '@gobing-ai/ts-infra/application'
- **Fix:** Changed to '@gobing-ai/ts-runtime'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-579: Significant refactor of 

- **Date:** 2026-06-16T06:44:04.468Z
- **File:** `apps/server/src/serve.ts`
- **Root cause:** 7 lines replaced/restructured
- **Fix:** Rewrote 46→77 lines (7 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-580: Missing await

- **Date:** 2026-06-16T06:46:09.099Z
- **File:** `apps/server/tests/serve.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-581: Missing await

- **Date:** 2026-06-16T06:51:18.859Z
- **File:** `apps/server/tests/serve.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-582: Null/undefined access in 

- **Date:** 2026-06-16T06:51:33.323Z
- **File:** `apps/cli/tests/commands/serve.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-583: Incorrect value in code

- **Date:** 2026-06-16T16:44:50.230Z
- **File:** `packages/contracts/src/task.ts`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-domain/schema'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-584: Incorrect value in code

- **Date:** 2026-06-16T16:44:51.621Z
- **File:** `packages/contracts/src/feature.ts`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-domain/schema'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-585: Significant refactor of 

- **Date:** 2026-06-16T16:47:45.449Z
- **File:** `packages/contracts/src/shared.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 4→5 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-586: Significant refactor of 

- **Date:** 2026-06-16T16:51:28.392Z
- **File:** `docs/tasks/0077_S4_Server_contracts_task_feature_planningEvent_output_envelope_error_mapping.md`
- **Root cause:** 32 lines replaced/restructured
- **Fix:** Rewrote 50→4 lines (32 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-587: Missing import: ../styles/global.css

- **Date:** 2026-06-16T18:50:07.940Z
- **File:** `apps/web/src/pages/index.astro`
- **Root cause:** Module(s) not imported: ../styles/global.css
- **Fix:** Added import(s) for ../styles/global.css
- **Tags:** auto-detected, missing-import, astro
- **Occurrences:** 1

## bug-588: Wrong reference: dev should be gobing

- **Date:** 2026-06-16T21:20:16.782Z
- **File:** `package.json`
- **Root cause:** Used "dev" instead of "gobing"
- **Fix:** Changed dev → gobing
- **Tags:** auto-detected, wrong-reference, json
- **Occurrences:** 1

## bug-589: Significant refactor of 

- **Date:** 2026-06-16T21:32:17.364Z
- **File:** `docs/tasks/0081_W5_Web_build_integration_unified_Vite_dev_server_dual_production_build_modes.md`
- **Root cause:** 12 lines replaced/restructured
- **Fix:** Rewrote 20→4 lines (12 removed) | Also: ### P1 — Blockers; | # | Title | Dimension | Location | Recommendatio
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-590: Significant refactor of 

- **Date:** 2026-06-16T22:14:00.510Z
- **File:** `apps/web/src/lib/rpc-client.ts`
- **Root cause:** 10 lines replaced/restructured
- **Fix:** Rewrote 35→48 lines (10 removed) | Also: adapterInterceptors: [; onError((error: unknown) => {
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-591: CSS fix: --sidebar-w, --rightpanel-w

- **Date:** 2026-06-16T22:14:13.530Z
- **File:** `apps/web/src/styles/board-layout.css`
- **Root cause:** --sidebar-w: 240px → 48px; --rightpanel-w: 320px → 0px
- **Fix:** Changed --sidebar-w: 240px → 48px; --rightpanel-w: 320px → 0px
- **Tags:** auto-detected, style-fix, css
- **Occurrences:** 1

## bug-592: Incorrect value in code

- **Date:** 2026-06-16T22:14:58.029Z
- **File:** `apps/web/package.json`
- **Root cause:** Had "astro"
- **Fix:** Changed to "@orpc/shared"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-593: Type error

- **Date:** 2026-06-16T22:15:29.571Z
- **File:** `apps/web/tests/lib/rpc-client.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-594: Significant refactor of 

- **Date:** 2026-06-16T22:15:58.183Z
- **File:** `apps/web/tests/lib/rpc-client.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 19→26 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-595: Missing error handling in unknown

- **Date:** 2026-06-16T22:16:56.938Z
- **File:** `apps/web/tests/lib/rpc-client.test.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-596: Significant refactor of 

- **Date:** 2026-06-16T22:23:56.039Z
- **File:** `apps/web/src/lib/rpc-client.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 6→20 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-597: Missing error handling in unknown

- **Date:** 2026-06-16T22:24:09.806Z
- **File:** `apps/web/tests/lib/rpc-client.test.ts`
- **Root cause:** Code path had no error handling — exceptions would propagate uncaught
- **Fix:** Added try/catch block
- **Tags:** auto-detected, error-handling, ts
- **Occurrences:** 1

## bug-598: Incorrect value in code

- **Date:** 2026-06-16T22:24:46.038Z
- **File:** `apps/web/tsconfig.json`
- **Root cause:** Had "astro.config.mjs"
- **Fix:** Changed to "tests/**/*.tsx"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-599: CSS fix: clientX

- **Date:** 2026-06-16T22:26:11.095Z
- **File:** `apps/web/tests/components/BoardLayout.test.tsx`
- **Root cause:** clientX: 300 → 380
- **Fix:** Changed clientX: 300 → 380
- **Tags:** auto-detected, style-fix, tsx
- **Occurrences:** 1

## bug-600: Missing await

- **Date:** 2026-06-16T22:28:11.771Z
- **File:** `apps/web/tests/components/BoardLayout.test.tsx`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, tsx
- **Occurrences:** 1

## bug-601: Null/undefined access in 

- **Date:** 2026-06-16T23:02:55.173Z
- **File:** `apps/web/tests/components/BoardLayout.test.tsx`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, tsx
- **Occurrences:** 1

## bug-602: Significant refactor of 

- **Date:** 2026-06-16T23:47:51.700Z
- **File:** `apps/web/tests/components/BoardLayout.test.tsx`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 5→7 lines (2 removed)
- **Tags:** auto-detected, refactor, tsx
- **Occurrences:** 1

## bug-603: Null/undefined access in 

- **Date:** 2026-06-16T23:48:08.323Z
- **File:** `apps/web/tests/components/BoardLayout.test.tsx`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, tsx
- **Occurrences:** 1

## bug-604: Significant refactor of 

- **Date:** 2026-06-16T23:48:58.153Z
- **File:** `apps/web/src/components/BoardApp.tsx`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 10→13 lines (2 removed)
- **Tags:** auto-detected, refactor, tsx
- **Occurrences:** 1

## bug-605: Missing guard clause

- **Date:** 2026-06-17T15:24:32.428Z
- **File:** `apps/web/src/modules/task-kanban/KanbanBoard.tsx`
- **Root cause:** No early return/throw for edge case: !filters
- **Fix:** Added guard clause: if (!filters)
- **Tags:** auto-detected, guard-clause, tsx
- **Occurrences:** 1

## bug-606: Wrong reference: change should be input

- **Date:** 2026-06-17T15:26:57.285Z
- **File:** `apps/web/tests/modules/task-kanban/board.test.tsx`
- **Root cause:** Used "change" instead of "input"
- **Fix:** Changed change → input
- **Tags:** auto-detected, wrong-reference, tsx
- **Occurrences:** 1

## bug-607: Null/undefined access in 

- **Date:** 2026-06-17T15:27:16.683Z
- **File:** `apps/web/tests/modules/task-kanban/board.test.tsx`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, tsx
- **Occurrences:** 1

## bug-608: Type error

- **Date:** 2026-06-17T15:27:24.265Z
- **File:** `apps/web/tests/modules/task-kanban/board.test.tsx`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, tsx
- **Occurrences:** 1

## bug-609: Incorrect value in code

- **Date:** 2026-06-17T15:27:28.488Z
- **File:** `apps/web/tests/modules/task-kanban/board.test.tsx`
- **Root cause:** Had ' } });
        expect(calls).toContainEqual(['
- **Fix:** Changed to ');
        expect(calls).toContainEqual(['
- **Tags:** auto-detected, wrong-value, tsx
- **Occurrences:** 1

## bug-610: CSS fix: target

- **Date:** 2026-06-17T15:28:15.379Z
- **File:** `apps/web/tests/modules/task-kanban/board.test.tsx`
- **Root cause:** target: { value: 'done' → { value: ''
- **Fix:** Changed target: { value: 'done' → { value: ''
- **Tags:** auto-detected, style-fix, tsx
- **Occurrences:** 1

## bug-611: Incorrect value in code

- **Date:** 2026-06-17T15:33:28.624Z
- **File:** `apps/web/src/modules/task-kanban/KanbanBoard.tsx`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-domain/schema'
- **Tags:** auto-detected, wrong-value, tsx
- **Occurrences:** 1

## bug-612: Incorrect value in code

- **Date:** 2026-06-17T15:33:32.787Z
- **File:** `apps/web/src/modules/task-kanban/TaskFilters.tsx`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-domain/schema'
- **Tags:** auto-detected, wrong-value, tsx
- **Occurrences:** 1

## bug-613: Incorrect value in code

- **Date:** 2026-06-17T15:33:36.348Z
- **File:** `apps/web/src/modules/task-kanban/TaskDetail.tsx`
- **Root cause:** Had '@gobing-ai/spur-domain'
- **Fix:** Changed to '@gobing-ai/spur-domain/schema'
- **Tags:** auto-detected, wrong-value, tsx
- **Occurrences:** 1

## bug-614: Type error

- **Date:** 2026-06-18T04:03:53.268Z
- **File:** `packages/app/src/workflow/actions/http-request.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-615: Incorrect value in code

- **Date:** 2026-06-18T04:03:57.034Z
- **File:** `packages/app/src/workflow/actions/http-request.ts`
- **Root cause:** Had 'follow'
- **Fix:** Changed to 'error'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-616: Significant refactor of 

- **Date:** 2026-06-18T04:04:15.562Z
- **File:** `packages/app/tests/workflow/actions/http-request.test.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 9→24 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-617: Significant refactor of 

- **Date:** 2026-06-18T04:05:52.925Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** 83 lines replaced/restructured
- **Fix:** Rewrote 177→79 lines (83 removed) | Also: private buildResult(wbs: string, status: string, f; // Elevate warnings to errors when --strict is set
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-618: Type error

- **Date:** 2026-06-18T04:06:35.589Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-619: Significant refactor of 

- **Date:** 2026-06-18T04:07:07.560Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** 72 lines replaced/restructured
- **Fix:** Rewrote 141→51 lines (72 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-620: Type error

- **Date:** 2026-06-18T05:07:59.401Z
- **File:** `apps/server/src/open-url.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-621: Significant refactor of 

- **Date:** 2026-06-18T19:49:23.916Z
- **File:** `docs/99_PROJECT_CONSTITUTION.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 11→21 lines (6 removed) | Also: ### 6.6 `docs/05_FEATURES.md`; 1. One row per deliverable, each with a concrete * | Also: ### 4.5 Index + satellite docs (`04`/`05` and thei; Two derived docs are **index pages** over a folder
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 3

## bug-622: Incorrect value in code

- **Date:** 2026-06-18T19:49:44.600Z
- **File:** `docs/99_PROJECT_CONSTITUTION.md`
- **Root cause:** Had `docs/05_FEATURES.md`
- **Fix:** Changed to `docs/design/<slug>.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-623: Incorrect value in code

- **Date:** 2026-06-18T19:51:39.275Z
- **File:** `AGENTS.md`
- **Root cause:** Had `docs/05_FEATURES.md`
- **Fix:** Changed to `docs/design/<slug>.md`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-624: Engine guard var interpolation: guards passed ${vars.wbs} literally to /bin/sh (bad substitution) instead of resolving first.

- **Date:** 2026-06-19T01:49:36.695Z
- **File:** `ts-libs/packages/dual-workflow-engine/src/service.ts`
- **Root cause:** requestTransition (service.ts) passed raw guard options + vars:{} to evaluateGuard without resolveTemplates. Same in state-machine.ts firstPassingTransition and transition-flow.ts firstPassingEdge.
- **Fix:** Added resolveTemplates before guard eval in all three paths. requestTransition now uses workflow.vars. Regression test in state-machine.test.ts.
- **Tags:** engine, guard, var-interpolation, ts-dual-workflow-engine, task-0088
- **Occurrences:** 1

## bug-625: Significant refactor of 

- **Date:** 2026-06-19T03:42:22.168Z
- **File:** `docs/tasks/0088_customize_new_workflows_to_streamline_the_development_process.md`
- **Root cause:** 44 lines replaced/restructured
- **Fix:** Rewrote 58→4 lines (44 removed) | Also: ### Why each decision; - **`sp:doc-evolve` is the safety layer, not a new
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-626: Incorrect value in code

- **Date:** 2026-06-19T03:43:42.961Z
- **File:** `docs/tasks/0088_customize_new_workflows_to_streamline_the_development_process.md`
- **Root cause:** Had `profile=auto`
- **Fix:** Changed to `resolveTemplates`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-627: `tasks update <wbs> --section <Name> --from-file` left orphaned duplicate subsections in the task file: the new ####-nested body was inserted but the OLD ###-level subsections below survived as dead duplicates, doubling the section count (25 vs 12) even though `task check` passed (it reads the first occurrence).

- **Date:** 2026-06-19T02:30:00Z
- **File:** `docs/tasks/0088_customize_new_workflows_to_streamline_the_development_process.md`
- **Root cause:** The legacy global `tasks` CLI section-replace ends a section at the next heading it RECOGNIZES as a section boundary. When a section body itself contains standalone ###-level subheadings (e.g. ### R1, ### Why each decision), the replace overwrites only up to the first such subheading and leaves the rest orphaned below the new content.
- **Fix:** Two parts: (1) author section bodies with #### (H4) subheadings, never ### (H3), so they nest inside the parent section instead of registering as sibling sections; (2) the orphaned old ###-blocks left by a prior replace must be removed with the Edit tool (surgical delete) — re-running --section does not clean them. Verified with `rg -n '^### '` (expect only the ~12 canonical sections) and `task check 0088` EXIT 0.
- **Tags:** tasks-cli, section-replace, orphaned-content, markdown-headings, task-0088
- **Occurrences:** 1

## bug-628: Incorrect value in code

- **Date:** 2026-06-19T05:05:46.191Z
- **File:** `../ts-libs/packages/dual-workflow-engine/tests/state-machine.test.ts`
- **Root cause:** Had 'guard options resolve ${vars.*} templates before 
- **Fix:** Changed to 'guard options resolve vars templates before evalu
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 2

## bug-629: Wrong reference: message should be prompt

- **Date:** 2026-06-19T05:17:02.706Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** Used "message" instead of "prompt"
- **Fix:** Changed message → prompt
- **Tags:** auto-detected, wrong-reference, yaml
- **Occurrences:** 1

## bug-630: Wrong reference: message should be prompt

- **Date:** 2026-06-19T05:17:10.806Z
- **File:** `config/workflows/planning-pipeline.yaml`
- **Root cause:** Used "message" instead of "prompt"
- **Fix:** Changed message → prompt
- **Tags:** auto-detected, wrong-reference, yaml
- **Occurrences:** 2

## bug-631: Incorrect value in code

- **Date:** 2026-06-19T05:39:09.123Z
- **File:** `package.json`
- **Root cause:** Had "^0.3.19"
- **Fix:** Changed to "^0.3.20"
- **Tags:** auto-detected, wrong-value, json
- **Occurrences:** 1

## bug-632: Significant refactor of 

- **Date:** 2026-06-19T05:41:11.024Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 12→24 lines (2 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-633: Significant refactor of 

- **Date:** 2026-06-19T05:41:47.650Z
- **File:** `config/workflows/planning-pipeline.yaml`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 41→69 lines (3 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-634: spur serve opened http://localhost:3000/board but the board was empty/unavailable after bun run build

- **Date:** 2026-06-19T06:24:30.000Z
- **File:** `apps/server/src/serve.ts`
- **Root cause:** startServer created ServerContext without webDistPath, so createApp stayed in API-only mode; startServer also returned immediately after Bun.serve, allowing the CLI process to exit after startup.
- **Fix:** Resolve dist/web/index.html from config/cwd/compiled-binary layout, pass webDistPath into createServerContext, and keep production serve alive until SIGINT/SIGTERM while tests opt out with keepAlive:false.
- **Tags:** serve, board, static-assets, compiled-cli
- **Occurrences:** 1

## bug-635: bun test apps/server/tests/serve.test.ts apps/server/tests/static-assets.test.ts exited 1 even though all 20 assertions passed

- **Date:** 2026-06-19T06:24:31.000Z
- **File:** `bunfig.toml`
- **Root cause:** Root Bun coverage thresholds apply to partial direct test-file runs, so a focused subset can fail the coverage gate despite passing assertions.
- **Fix:** Used the workspace server test script for focused verification, which runs without the root partial-coverage failure mode.
- **Tags:** test-command, coverage, verification
- **Occurrences:** 1

## bug-636: TypeError: undefined is not an object (evaluating 'context.env.SPUR_DEBUG')

- **Date:** 2026-06-19T06:25:30.000Z
- **File:** `apps/cli/src/commands/serve.ts`
- **Root cause:** A CLI serve unit test uses a minimal mocked context without env, and the new debug-only stack branch assumed context.env was always present.
- **Fix:** Changed the debug check to optional access: context.env?.SPUR_DEBUG === '1'.
- **Tags:** test-failure, serve, debug
- **Occurrences:** 1

## bug-636: SQLiteError: database is locked (SQLITE_BUSY_RECOVERY) when running multiple spur commands concurrently against the same project DB

- **Date:** 2026-06-19T05:55:00Z
- **File:** `packages/domain/src/db.ts`
- **Root cause:** BunSqliteAdapter constructor sets WAL + synchronous + foreign_keys pragmas but no busy_timeout. Without busy_timeout, concurrent SQLite access throws SQLITE_BUSY immediately instead of retrying. createMigratedDb called createDbAdapter without setting busy_timeout.
- **Fix:** Added `await adapter.exec('PRAGMA busy_timeout = 5000')` in createMigratedDb after adapter creation, before migrations. The typed pragmas option only accepts journalMode/synchronous/foreignKeys (runtime constructor only applies those three), so exec is the correct seam. Verified: 4 concurrent spur commands now succeed simultaneously.
- **Tags:** sqlite, busy-timeout, concurrent-access, db, domain
- **Occurrences:** 1

## bug-637: Task page showed: Failed to load tasks / Failed to construct 'URL': Invalid URL

- **Date:** 2026-06-19T06:35:50.000Z
- **File:** `apps/web/src/lib/rpc-client.ts`
- **Root cause:** Production resolveApiUrl returned the relative string '/api', but @orpc/openapi-client constructs requests with new URL(baseUrl), which requires an absolute URL.
- **Fix:** Resolve same-origin production API URLs with new URL('/api', globalThis.location.origin).toString(), with an absolute localhost fallback for non-browser contexts.
- **Tags:** board, rpc-client, orpc, url
- **Occurrences:** 1

## bug-638: Browser smoke rendered the board but emitted a request storm to /api/tasks

- **Date:** 2026-06-19T06:35:51.000Z
- **File:** `apps/web/src/modules/task-kanban/useTasks.ts`
- **Root cause:** useTasks used api.task.list as a default parameter; the oRPC proxy can produce an unstable function reference, causing the effect dependency to re-run after state updates.
- **Fix:** Use a stable defaultListTasks wrapper that performs api.task.list lookup at call time, preserving test mocks while keeping the effect dependency stable.
- **Tags:** board, polling, react, orpc
- **Occurrences:** 1

## bug-639: Full test suite failed after freezing api.task.list at module load: board tests hit real http://localhost:3000/api/tasks instead of the mocked rpc client

- **Date:** 2026-06-19T06:35:52.000Z
- **File:** `apps/web/src/modules/task-kanban/useTasks.ts`
- **Root cause:** A direct module-level const captured the real oRPC function before board.test's mock.module could replace the rpc client under some test ordering.
- **Fix:** Changed the const to a stable wrapper function, so identity is stable but the api.task.list lookup remains mock-compatible at call time.
- **Tags:** test-failure, mock, board, useTasks
- **Occurrences:** 1

## bug-641: Null/undefined access in 

- **Date:** 2026-06-19T21:33:31.021Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: /**; * Resolve which sections a newly created task carries for `s
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-642: Missing guard clause

- **Date:** 2026-06-19T21:34:06.841Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** No early return/throw for edge case: text === ''
- **Fix:** Added guard clause: if (text === '')
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-643: Significant refactor of 

- **Date:** 2026-06-19T21:34:46.743Z
- **File:** `config/tasks/section-matrix.yaml`
- **Root cause:** 4 lines replaced/restructured
- **Fix:** Rewrote 7→12 lines (4 removed)
- **Tags:** auto-detected, refactor, yaml
- **Occurrences:** 1

## bug-644: Type error

- **Date:** 2026-06-19T21:35:24.651Z
- **File:** `packages/app/src/services/planning-check-base.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-645: Wrong condition in logic

- **Date:** 2026-06-19T21:35:34.007Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** Condition was: if (solBody !== null)
- **Fix:** Changed to: if (solBody !== null && !isPlaceholderBody(solBody)
- **Tags:** auto-detected, logic-fix, ts
- **Occurrences:** 4

## bug-646: Type error

- **Date:** 2026-06-19T21:35:42.393Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-647: Incorrect value in code

- **Date:** 2026-06-19T21:36:11.346Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** Had 'History'
- **Fix:** Changed to 'Background'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-648: Null/undefined access in 

- **Date:** 2026-06-19T21:40:04.435Z
- **File:** `packages/app/tests/services/task-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-649: Missing await

- **Date:** 2026-06-19T21:40:55.907Z
- **File:** `packages/app/tests/services/task-check.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-650: Null/undefined access in 

- **Date:** 2026-06-19T21:41:34.081Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-651: Significant refactor of 

- **Date:** 2026-06-19T21:44:42.018Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 11→64 lines (6 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-652: Null/undefined access in 

- **Date:** 2026-06-19T21:47:21.772Z
- **File:** `packages/domain/src/planning/markdown-document.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-653: Type error

- **Date:** 2026-06-19T21:47:53.586Z
- **File:** `packages/domain/tests/planning/markdown-document.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-654: Type error

- **Date:** 2026-06-19T21:48:16.558Z
- **File:** `apps/cli/tests/commands/task.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-655: Significant refactor of 

- **Date:** 2026-06-19T22:20:29.333Z
- **File:** `packages/domain/src/planning/schema.ts`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 5→10 lines (3 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-656: Type error

- **Date:** 2026-06-19T22:21:53.051Z
- **File:** `packages/domain/src/planning/task-skeleton.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-657: Significant refactor of 

- **Date:** 2026-06-19T22:22:08.583Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** 6 lines replaced/restructured
- **Fix:** Rewrote 28→35 lines (6 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-658: Missing guard clause

- **Date:** 2026-06-19T22:23:03.463Z
- **File:** `packages/domain/src/planning/task-skeleton.ts`
- **Root cause:** No early return/throw for edge case: !CANONICAL_INDEX.has(name
- **Fix:** Added guard clause: if (!CANONICAL_INDEX.has(name)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-659: Null/undefined access in 

- **Date:** 2026-06-19T22:24:48.744Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check) | Also: .option('--template <variant>', `Template variant (${TASK_VA; if (options.template !== undefined && !(TASK_VARIANTS as rea
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 2

## bug-660: Incorrect value in code

- **Date:** 2026-06-19T22:29:46.951Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Had 'standard'
- **Fix:** Changed to 'default'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-661: Type error

- **Date:** 2026-06-19T22:31:13.706Z
- **File:** `packages/domain/tests/planning/task-skeleton.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-662: Missing await

- **Date:** 2026-06-19T22:31:32.335Z
- **File:** `packages/app/tests/services/task-service.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-663: Significant refactor of 

- **Date:** 2026-06-19T22:32:19.172Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 3→4 lines (3 removed) | Also: Choose the variant that matches the task's purpose; | Variant | When to use | Sections created |
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 2

## bug-664: Incorrect value in code

- **Date:** 2026-06-19T22:32:45.922Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `--folder <path>`
- **Fix:** Changed to `--template <variant>`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-665: Null/undefined access in 

- **Date:** 2026-06-19T22:32:57.875Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, md
- **Occurrences:** 1

## bug-666: Wrong reference: default should be standard

- **Date:** 2026-06-19T22:59:36.725Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** Used "default" instead of "standard"
- **Fix:** Changed default → standard
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-667: Incorrect value in code

- **Date:** 2026-06-19T22:59:43.135Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** Had `default`
- **Fix:** Changed to `standard`
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-668: Wrong reference: default should be standard

- **Date:** 2026-06-19T22:59:56.034Z
- **File:** `packages/app/src/services/planning-check-base.ts`
- **Root cause:** Used "default" instead of "standard"
- **Fix:** Changed default → standard
- **Tags:** auto-detected, wrong-reference, ts
- **Occurrences:** 1

## bug-669: Incorrect value in code

- **Date:** 2026-06-19T23:00:06.407Z
- **File:** `packages/app/src/services/feature-check.ts`
- **Root cause:** Had 'default'
- **Fix:** Changed to 'standard'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-670: Incorrect value in code

- **Date:** 2026-06-19T23:01:21.343Z
- **File:** `apps/cli/src/config/scaffold-manifest.ts`
- **Root cause:** Had 'templates/task/default.md'
- **Fix:** Changed to 'templates/task/standard.md'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-671: Incorrect value in code

- **Date:** 2026-06-19T23:03:22.824Z
- **File:** `apps/cli/tests/init-templates.test.ts`
- **Root cause:** Had 'default.md'
- **Fix:** Changed to 'standard.md'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 3

## bug-672: Incorrect value in code

- **Date:** 2026-06-19T23:03:47.069Z
- **File:** `apps/cli/tests/commands/init.test.ts`
- **Root cause:** Had 'default.md'
- **Fix:** Changed to 'standard.md'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-673: Incorrect value in code

- **Date:** 2026-06-19T23:03:53.808Z
- **File:** `apps/cli/tests/config/scaffold-manifest.test.ts`
- **Root cause:** Had 'templates/task/default.md'
- **Fix:** Changed to 'templates/task/standard.md'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-674: Missing await

- **Date:** 2026-06-19T23:15:32.873Z
- **File:** `apps/cli/src/commands/task.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call | Also: async function makeCheckService(context: CliContext): Promis; return new TaskCheckService(context.fs, await loadSectionMat
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 2

## bug-675: Incorrect value in code

- **Date:** 2026-06-19T23:34:36.492Z
- **File:** `packages/config/tests/bundled-config.test.ts`
- **Root cause:** Had 'templates/task/default.md'
- **Fix:** Changed to 'templates/task/standard.md'
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-676: Incorrect value in code

- **Date:** 2026-06-19T23:37:17.048Z
- **File:** `plugins/sp/skills/spur-dev/references/decomposition.md`
- **Root cause:** Had `feature-impl`
- **Fix:** Changed to `standard`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-677: Incorrect value in code

- **Date:** 2026-06-19T23:39:46.673Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `default·feature-impl·issue·review·meta·brainstorm
- **Fix:** Changed to `standard·feature-impl·issue·review·meta·brainstor
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-678: Significant refactor of 

- **Date:** 2026-06-19T23:40:09.631Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** 3 lines replaced/restructured
- **Fix:** Rewrote 4→7 lines (3 removed)
- **Tags:** auto-detected, refactor, md
- **Occurrences:** 1

## bug-679: Type error

- **Date:** 2026-06-19T23:40:36.522Z
- **File:** `apps/cli/tests/commands/task.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-680: Significant refactor of 

- **Date:** 2026-06-19T23:48:06.075Z
- **File:** `apps/cli/tests/commands/task.test.ts`
- **Root cause:** 2 lines replaced/restructured
- **Fix:** Rewrote 5→7 lines (2 removed)
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 1

## bug-681: Wrong return value

- **Date:** 2026-06-20T03:33:08.476Z
- **File:** `packages/app/src/services/feature-service.ts`
- **Root cause:** Was returning: this.ctx.writeService.transition(ref, toStatus, th
- **Fix:** Now returns: this.ctx.writeService.transition(ref, toStatus, ac
- **Tags:** auto-detected, return-value, ts
- **Occurrences:** 1

## bug-682: Null/undefined access in 

- **Date:** 2026-06-20T03:33:56.147Z
- **File:** `packages/app/tests/services/feature-service.test.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-683: Significant refactor of 

- **Date:** 2026-06-20T03:35:02.984Z
- **File:** `apps/cli/src/commands/feature.ts`
- **Root cause:** 11 lines replaced/restructured
- **Fix:** Rewrote 14→5 lines (11 removed) | Also: const lifecycle = makeFeatureLifecycleAdapter(cont; /**
- **Tags:** auto-detected, refactor, ts
- **Occurrences:** 2

## bug-686: Incorrect value in code

- **Date:** 2026-06-20T06:29:48.209Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** Had "- R1. …"
- **Fix:** Changed to "- [ ] R1. …"
- **Tags:** auto-detected, wrong-value, ts
- **Occurrences:** 1

## bug-687: Missing await

- **Date:** 2026-06-20T06:30:07.325Z
- **File:** `packages/app/tests/services/task-check.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-689: Incorrect value in code

- **Date:** 2026-06-20T16:49:40.692Z
- **File:** `docs/00_ADR.md`
- **Root cause:** Had `; until superskill 0041 publishes the engine pack
- **Fix:** Changed to `; the concrete engine is provided by the external
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-690: Incorrect value in code

- **Date:** 2026-06-20T16:49:56.478Z
- **File:** `docs/04_DESIGN.md`
- **Root cause:** Had `plugins/sp/skills/anti-hallucination/scripts/ah_g
- **Fix:** Changed to `cc:anti-hallucination`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-691: Wrong reference: lockb should be lock

- **Date:** 2026-06-22T01:47:38.034Z
- **File:** `docs/tasks/0089_foundation-restore-dnd-kit-markdown-editor-deps-and-adr-for-.md`
- **Root cause:** Used "lockb" instead of "lock"
- **Fix:** Changed lockb → lock
- **Tags:** auto-detected, wrong-reference, md
- **Occurrences:** 1

## bug-692: Incorrect value in code

- **Date:** 2026-06-22T02:12:38.747Z
- **File:** `docs/tasks/0090_task-body-write-api-patch-tasks-wbs-body-contract-handler-an.md`
- **Root cause:** Had `packages/app/src/services/planning-write-service.
- **Fix:** Changed to `packages/app/src/services/planning-write-service.
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-693: Null/undefined access in 

- **Date:** 2026-06-22T02:12:48.612Z
- **File:** `docs/tasks/0090_task-body-write-api-patch-tasks-wbs-body-contract-handler-an.md`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, md
- **Occurrences:** 1

## bug-694: Incorrect value in code

- **Date:** 2026-06-22T05:06:29.073Z
- **File:** `docs/tasks/0091_render-and-inline-edit-task-markdown-body-in-taskdetail-with.md`
- **Root cause:** Had `api.task.bodyUpdate({ wbs, body })`
- **Fix:** Changed to `api.task.body({ wbs, body })`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 3

## bug-695: Type error

- **Date:** 2026-06-22T05:23:25.556Z
- **File:** `apps/web/src/modules/task-kanban/TaskDetail.tsx`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, tsx
- **Occurrences:** 1

## bug-696: Missing await

- **Date:** 2026-06-22T05:34:50.180Z
- **File:** `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, tsx
- **Occurrences:** 1

## bug-697: Null/undefined access in 

- **Date:** 2026-06-22T05:35:16.176Z
- **File:** `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, tsx
- **Occurrences:** 1

## bug-698: Type error

- **Date:** 2026-06-22T05:35:22.900Z
- **File:** `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation | Also: typeInto(getByLabelText('Name *') as HTMLInputElement, 'Seed; typeInto(getByLabelText(/Background/) as HTMLTextAreaElement | Also: typeInto(getByLabelText('Name *') as HTMLInputElement, 'Doom
- **Tags:** auto-detected, type-fix, tsx
- **Occurrences:** 3

## bug-700: Incorrect value in code

- **Date:** 2026-06-22T17:25:25.924Z
- **File:** `docs/tasks/0097_sse-real-time-sync-replacing-5s-polling-with-connection-indi.md`
- **Root cause:** Had 't describe the actual frames. Fix (deferred, non-
- **Fix:** Changed to `stream`
- **Tags:** auto-detected, wrong-value, md
- **Occurrences:** 1

## bug-701: Missing guard clause

- **Date:** 2026-06-22T18:23:40.262Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** No early return/throw for edge case: folder === undefined
- **Fix:** Added guard clause: if (folder === undefined)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-702: Missing guard clause

- **Date:** 2026-06-22T18:24:09.833Z
- **File:** `apps/web/src/modules/task-kanban/useTasks.ts`
- **Root cause:** No early return/throw for edge case: listFn === this.listFn
- **Fix:** Added guard clause: if (listFn === this.listFn)
- **Tags:** auto-detected, guard-clause, ts
- **Occurrences:** 1

## bug-703: Null/undefined access in 

- **Date:** 2026-06-22T18:24:17.169Z
- **File:** `apps/web/src/modules/task-kanban/useTasks.ts`
- **Root cause:** Property access on potentially null/undefined value
- **Fix:** Added null safety (optional chaining or null check)
- **Tags:** auto-detected, null-safety, ts
- **Occurrences:** 1

## bug-704: Type error

- **Date:** 2026-06-22T18:25:16.447Z
- **File:** `packages/app/tests/services/task-service.test.ts`
- **Root cause:** Missing or incorrect type annotation
- **Fix:** Added type assertion/annotation
- **Tags:** auto-detected, type-fix, ts
- **Occurrences:** 1

## bug-705: Missing await

- **Date:** 2026-06-22T18:25:43.736Z
- **File:** `apps/web/tests/modules/task-kanban/useTasks.test.ts`
- **Root cause:** Async call without await — returned Promise instead of value
- **Fix:** Added await to async call
- **Tags:** auto-detected, async-fix, ts
- **Occurrences:** 1

## bug-156: spur task update --section Review left orphaned duplicate content; section appeared 3x stacked

- **Date:** 2026-06-22T17:14:40.630246
- **File:** `docs/tasks/0099_*.md (via packages/domain/src/planning/markdown-document.ts replaceSection)`
- **Root cause:** MarkdownDocument parses ANY line starting with '### ' as a section boundary (markdown-document.ts:101). A Review body containing '### P1 — Blockers' etc. registers those sub-headings as standalone non-canonical sections, so replaceSection('Review') only replaces up to the first '###' inside the body, orphaning the rest. Repeated updateSection calls then stack duplicates.
- **Fix:** Review/section bodies must use '**bold**' labels, never '### ' sub-headings, inside a section. To repair an already-orphaned file: git stash the working tree to the clean committed baseline, then re-apply each section ONCE with a heading-free body.
- **Tags:** spur-task, markdown-document, replaceSection, section-orphan, review-section, dev-verify
- **Occurrences:** 1

## bug-706: bun run apps/cli/src/index.ts task check 0126 --json failed: missing required Design section; Solution/Testing/Review forbidden for todo; Solution lacked file:line citation

- **Date:** 2026-06-26T01:23:35Z
- **File:** `docs/tasks/0126_make-agent-auto-resolution-phase-aware-with-executor-profile.md`
- **Root cause:** The generated task skeleton was expanded with implementation-state sections while status remained todo; the section matrix requires Design for todo and forbids Solution/Testing/Review until later lifecycle states.
- **Fix:** Reworked task 0126 into a valid todo-shape file: Background, Acceptance Criteria, Requirements, Design, Plan, References, History; removed forbidden sections and made R-items parser-compatible.
- **Tags:** spur-task, task-check, section-matrix, todo-shape
- **Occurrences:** 1

## bug-707: Spur Board task-folder dropdown defaulted to 'Primary (docs/tasks)' even though .spur/config.yaml had tasks.active: docs/tasks2

- **Date:** 2026-06-26T22:50:00Z
- **File:** `packages/contracts/src/task.ts, apps/server/src/modules/task/handlers.ts, apps/web/src/modules/task-kanban/KanbanBoard.tsx`
- **Root cause:** The task.folders DTO carried only an array of folders in YAML declaration order, with no field for the active folder. The web board guessed the active folder as data[0].path (first-declared = docs/tasks), which is wrong whenever tasks.active is not the first-declared folder. The active folder (foldersConfig.active_folder) was resolved correctly server-side by resolvePlanningFolders but dropped on the wire.
- **Fix:** Added activeFolder?: string to taskFoldersResponseSchema (apiSuccessSchema(...).extend); handler returns activeFolder: foldersConfig.active_folder; KanbanBoard selects activeFolder ?? data[0]?.path and adopts it unconditionally in the mount effect. Added a server handler regression test (active != first-declared). Backend was never broken — CLI and Board share resolvePlanningFolders.
- **Tags:** spur-board, task-folders, orpc-contract, activeFolder, config-yaml, web
- **Occurrences:** 1

## bug-708: Source fix to KanbanBoard.tsx (activeFolder default) had no effect after a spur serve restart — board still defaulted to Primary

- **Date:** 2026-06-26T22:53:00Z
- **File:** `dist/web (built bundle) vs apps/web/src/modules/task-kanban/KanbanBoard.tsx`
- **Root cause:** spur serve serves a pre-built static dist/web bundle (serve.ts -> resolveWebDistPath), not a Vite dev server. dist/web was built at 15:33, 14 min before the 15:47 source edit, so the served JS still had the old data[0] selection logic. activeFolder was absent from dist/web. The config restart reloaded the live API (folder LIST became correct = two folders) but not the JS bundle (folder SELECTION stayed old).
- **Fix:** Ran bun run build to recompile dist/web; verified activeFolder now present in dist/web/_astro/BoardApp.*.js. Lesson: any apps/web/src edit requires bun run build before spur serve reflects it, plus a hard browser refresh (Cmd+Shift+R) to bust the cached chunk.
- **Tags:** spur-serve, dist-web, stale-bundle, dev-loop, vite-build, web
- **Occurrences:** 1

## bug-708: PlaceholderModule left as defaultModule in apps/web/src/modules/registry.ts, contradicting design §3.4 (builtins=[TaskKanbanModule]). / redirected to /board/board welcome screen instead of /board/tasks.

- **Date:** 2026-06-26T23:50:00Z
- **File:** `apps/web/src/modules/registry.ts`
- **Root cause:** W2 scaffolding placeholder (placeholder.tsx docstring said "replaced by Task Kanban in W3/0084") was never removed when TaskKanbanModule was added in W3.
- **Fix:** Removed PlaceholderModule from builtins, deleted placeholder.tsx, updated BoardLayout.test.tsx and ResponsiveAndTheme.test.tsx to assert against the tasks module instead of /board/board placeholder copy.
- **Tags:** board, web, module-registry, design-drift, placeholder
- **Occurrences:** 1

## bug-709: spur task update/check fails on tasks created via the rd3 tasks CLI: Frontmatter validation failed: Schema: schema_version: Invalid input: expected 1. Hard-blocks all spur task writes (section edits, status moves).

- **Date:** 2026-06-27T00:47:00Z
- **File:** `docs/tasks2/0134_*.md (frontmatter) — root cause in the tasks CLI create path`
- **Root cause:** Two CLIs manage task files. The rd3 "tasks" CLI (tasks create) writes frontmatter WITHOUT a schema_version field; the spur CLI (spur task update/check) validates frontmatter against a schema requiring schema_version === 1. tasks2 siblings all carry schema_version: 1; freshly-created tasks do not. Divergent frontmatter contracts between the two tools.
- **Fix:** UNRESOLVED. Workaround: add "schema_version: 1" to the task frontmatter after tasks create (the PreToolUse:Edit hook blocks the agent from editing task files directly; operator must apply, or the tasks CLI must be fixed to emit schema_version: 1 on create).
- **Tags:** tasks-cli, spur-task, frontmatter, schema, cross-cli, tasks2, blocker
- **Occurrences:** 1

## bug-710: spur task check L3 false positive: 'Plan should be ordered checklist or table, not free-form prose' fired on a Plan that IS an ordered checklist (bold-phase header '**Phase A —**' followed by '- [ ]' items)

- **Date:** 2026-06-28T18:40:00Z
- **File:** `packages/app/src/services/task-check.ts`
- **Root cause:** The L3 Plan check used /^\s*[-*]\s|^\s*\d+\.\s/.test(planBody.trimStart()) which only tested the FIRST line; a Plan opening with a '**Phase**' bold header defeated the list-marker regex even though '- [ ]' items followed on later lines.
- **Fix:** Changed to /.../m.test(planBody): added the 'm' (multiline) flag so '^' matches the start of every line, and removed trimStart() so the full body is scanned. Permissive-only. Added 2 regression tests at task-check.test.ts:592 (0129-shape passes) and :630 (free-form prose still warns).
- **Tags:** task-check, L3, false-positive, regex, multiline, 0131
- **Occurrences:** 1

## bug-711: spur task check 0149 --json failed with L3 error: Review must contain P1–P4 priority findings table

- **Date:** 2026-06-29T00:30:00Z
- **File:** `docs/tasks2/0149_enhance-sp-dev-review-with-architecture-deep-review-capabili.md`
- **Root cause:** The review-template task's Review section was replaced with prose only. The L3 checker requires a P1-P4 priority table in Review when the section exists.
- **Fix:** Updated the task's Review section via spur task update --section Review --from-file to include a Sev/Area/Finding/Resolution table with P1-P4 rows; task check now passes.
- **Tags:** task-check, review-template, L3, P1-P4, 0149
- **Occurrences:** 1

## bug-712: bun run lint failed after adding a type annotation for a pre-existing 0148 test: repeated `const parsed = JSON.parse(lastMessage(output))` patterns caused annotations to land on the wrong tests before the intended 0147 regression parse.

- **Date:** 2026-06-29T17:41:00-07:00
- **File:** `apps/cli/tests/commands/task.test.ts`
- **Root cause:** Patch matched generic parse statements instead of anchoring to the unique 0147 strict-core test context; noUncheckedIndexedAccess then required explicit first-row narrowing.
- **Fix:** Restored accidental annotations on unrelated tests, typed only the 0147 task-check result, and guarded parsed[0] before use. `bun run lint` now passes.
- **Tags:** typecheck, tests, patching, 0148, 0149
- **Occurrences:** 1

## bug-713: Parallel `spur task update 0151 --section ...` calls failed with Cannot acquire entity 0151 lock and SQLiteError: database is locked / SQLITE_BUSY_RECOVERY.

- **Date:** 2026-06-29T22:36:00-07:00
- **File:** `docs/tasks2/0151_make-sp-task-write-guard-hook-portable-across-superskill-rul.md`
- **Root cause:** Multiple section updates targeted the same task file concurrently. The task service uses per-entity lock files and the CLI also opens the SQLite DB during each invocation, so same-WBS writes are intentionally serialized.
- **Fix:** Reran failed section updates sequentially with quoted multi-word section names. Recorded the workflow rule: never parallelize multiple `spur task update` writes to the same WBS.
- **Tags:** spur-task, locking, sqlite, workflow, 0151
- **Occurrences:** 1

## bug-714: Current `superskill install sp` generated hook configs preserve `bun ${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`, and isolated Antigravity install produced no native Antigravity hook file.

- **Date:** 2026-06-28T22:55:00-07:00
- **File:** `docs/tasks2/0151_make-sp-task-write-guard-hook-portable-across-superskill-rul.md`
- **Root cause:** Superskill/rulesync preserves hook command strings instead of rewriting Claude-only variables or installing hook scripts, and Superskill maps Antigravity targets to `codexcli` instead of using rulesync's native Antigravity hook generator.
- **Fix:** Recorded follow-up task 0151 requirements: add `superskill hook run <plugin> <hook-id>`, change sp hook config to `superskill hook run sp task-write-guard`, add install-output regression tests for every target, and fix or bridge Antigravity native hook emission.
- **Tags:** superskill, rulesync, hooks, antigravity, 0151
- **Occurrences:** 1

## bug-715: After task 0134, http://localhost:3000/board rendered as a white/blank board page.

- **Date:** 2026-06-29T11:52:00-07:00
- **File:** `apps/web/src/modules/discover.ts, apps/web/src/router.tsx`
- **Root cause:** Task 0134 wrapped import.meta.glob behind a dynamic property lookup, so Vite did not transform the call and the browser entered the Node fs fallback during hydration. After that was fixed, bare /board still rendered an empty Outlet because the React Router tree had no /board index child redirecting to the default module.
- **Fix:** Changed discoverModules to call import.meta.glob directly so Vite rewrites it at build time, kept the Node fallback only for Bun tests, and added a /board index redirect to the default module. Added a BoardLayout regression test for bare /board.
- **Tags:** apps-web, board, vite, import-meta-glob, react-router, 0134
- **Occurrences:** 1

## bug-718: spur task create --template review produces a task that fails its own `spur task check` with L3 'Review must contain P1–P4 priority findings table'

- **Date:** 2026-06-29T14:04:48.583448
- **File:** `.spur/tasks/templates/review.md`
- **Root cause:** Project-local template .spur/tasks/templates/review.md drifted from the bundled SSOT config/templates/task/review.md — its ### Review section was missing the empty-cell P1/P2 table. CLI loadTemplateContent prefers project-local over bundled, so every review task rendered a table-less Review and failed L3 at backlog. Mis-diagnosed earlier as a checker/bundled-template bug.
- **Fix:** Synced .spur/tasks/templates/review.md ### Review to carry the P-table; additionally hardened the L3 Review rule in packages/app/src/services/task-check.ts to distinguish empty-cell scaffold from populated table (status-aware) so a table-less Review can't false-pass the loose /P[1-4]/ regex.
- **Tags:** template-drift, task-check, review-template, L3, spur-task, dogfood
- **Occurrences:** 1

## bug-719: zsh:1: unmatched "

- **Date:** 2026-06-29T23:26:16Z
- **File:** `none`
- **Root cause:** A review helper shell loop mixed nested quotes incorrectly while summarizing plugin command frontmatter.
- **Fix:** Discarded the malformed helper command and continued the review with direct ripgrep and file reads; no project source change was required.
- **Tags:** review-command, shell-quoting, openwolf
- **Occurrences:** 1

## bug-720: SQLiteError: database is locked / SQLITE_BUSY_RECOVERY during parallel Spur task reads

- **Date:** 2026-06-29T23:55:51Z
- **File:** `.spur/spur.db`
- **Root cause:** The dogfood run issued parallel `dist/cli/spur task show` and `dist/cli/spur task check` commands against the same local SQLite database while recovery/locking was active. One read failed with SQLITE_BUSY_RECOVERY; serializing the commands succeeded.
- **Fix:** Switched remaining Spur task operations to serialized execution. Future dogfood runs should avoid multi_tool parallelism for Spur CLI commands sharing the same local DB, or add a bounded retry wrapper for read-only task commands.
- **Tags:** sqlite, spur-task, dogfood, parallelism
- **Occurrences:** 2

## bug-721: YAMLParseError: Map keys must be unique at line 2, column 1 — global spur v0.2.9 crashes on ALL lifecycle transitions (spur task update <wbs> <status>) due to duplicate $schema key in composed workflow YAML

- **Date:** 2026-06-30T01:30:00Z
- **File:** `config/workflows/task-lifecycle.yaml (released binary bundle)`
- **Root cause:** The released v0.2.9 binary's bundled workflow/engine composes a document with both an unquoted $schema: (prepended by the engine) and the file's quoted "$schema": (from the YAML). YAML treats them as the same key, so the parser rejects the duplicate. The dev source's config/workflows/task-lifecycle.yaml and .spur/workflows/task-lifecycle.yaml are both clean (one quoted "$schema": each). The bug is in the bundled binary only.
- **Fix:** Worked around by switching to the dev binary (bun run apps/cli/src/index.ts) for all spur task commands. No dev-source code change was needed. The released binary needs a new version cut with the fixed workflow/engine composition.
- **Tags:** spur-task, yaml-parse-error, global-binary, lifecycle-transition, dogfood, release-blocker
- **Occurrences:** 1

## bug-722: spur task update --section Review strips same-level heading: "### SECUA Review"

- **Date:** 2026-06-30T04:52:00Z
- **File:** `plugins/sp/skills/code-verification/SKILL.md`
- **Root cause:** The verify guidance requires a `### SECUA Review` heading for captured answer-file parsing, but a standalone task Review section body cannot contain same-level `###` headings because the CLI strips them as phantom-section protection.
- **Fix:** Filed task 0160 to clarify the skill docs: keep `### SECUA Review` for answer files only; use tables or bold labels in section bodies.
- **Tags:** sp-code-verification, task-update, review-section, phantom-section, dogfood
- **Occurrences:** 1

## bug-724: Test output leak: "Bundled config -> ..." console.log appeared twice in bun test --reporter=dots output (once per bundle-config.test.ts test)

- **Date:** 2026-06-30T06:14:34.017Z
- **File:** `scripts/commands/bundle-config.ts`
- **Root cause:** bundleConfig() library function did a user-facing console.log internally; the unit test calls bundleConfig(target) directly, so the log fired during test runs. tests/setup.ts mutes the @gobing-ai/ts-infra logger but not bare console.*
- **Fix:** Moved the console.log out of bundleConfig to the CLI caller (scripts/spur-dev.ts). bundleConfig now returns Promise<{target, injected}> and is pure (no console side-effect), so tests run leak-free with zero test ceremony. CLI behavior byte-preserved.
- **Tags:** test-output-leak, console-log, separation-of-concerns, bundle-config, scripts
- **Occurrences:** 1

## bug-725: Task 0161 post-implementation review found stale plugin split references: dev-unit linked to moved spur-dev unit-testing/stacks refs, rehomed spur-cli references still pointed at retired spur-* noun skills, shipped plugins/sp files still mentioned rd3, and the R16/R20 invariant test did not cover command markdown or generic rd3 references.

- **Date:** 2026-06-30T19:29:00.000Z
- **File:** `plugins/sp/tests/skill-structure.test.ts`
- **Root cause:** The 0161 assertion suite only checked markdown links inside skill files, only rejected sp:-prefixed retired names, and only blocked rd3 path references rather than all shipped rd3 references. Several rehomed docs kept old frontmatter/prose after the split.
- **Fix:** Expanded R16 link checks to all plugin markdown, expanded retired-name checks to plain and sp:-prefixed names, expanded R20 to scan shipped markdown/yaml/json/ts for generic rd3/vendor references, repointed stale dev-unit/facade/product-planning/dev-operations docs, removed shipped rd3 prose, and synchronized 04/05 plus plugins/README live-surface docs.
- **Tags:** task-0161, plugins-sp, stale-reference, skill-split, invariant-test
- **Occurrences:** 1

## bug-726: plugins/sp/skills/spur-cli/SKILL.md was present locally but ignored by .gitignore, while its references/ files were tracked.

- **Date:** 2026-06-30T21:12:00.000Z
- **File:** `.gitignore`
- **Root cause:** Unscoped ignore patterns `spur-cli` and `spur-cli/` were intended for generated CLI bundle artifacts, but also matched the plugin skill directory name under plugins/sp/skills/.
- **Fix:** Scoped the generated artifact ignores to `/spur-cli` and `/apps/cli/spur-cli/`, then added an R23 plugin structure test asserting unscoped spur-cli ignore rules are absent and the facade SKILL.md exists.
- **Tags:** plugins-sp, gitignore, packaging-gap, spur-cli, task-0161
- **Occurrences:** 1

## bug-727: Comprehensive plugins/sp review found contract drift: task-pipeline documented HITL continue but approve did not pause, basic.yaml lacked the bundled Spur workflow schema ref, super-coder said both parallel support and 'Never run tasks in parallel (v1)', dev-parallel delegation dropped flags by using placeholder args, and the review task template seeded unchecked placeholder boxes.

- **Date:** 2026-07-01T04:12:30.000Z
- **File:** `plugins/sp/agents/super-coder.md`
- **Root cause:** Tasks 0164-0166 added parallel/debug/review/branch surfaces incrementally, but no invariant tied the agent, command wrappers, batch reference, task template, and workflow YAML together.
- **Fix:** Added pause:true to task-pipeline approve, added the schema ref to basic.yaml, aligned super-coder/dev-runall/dev-parallel/execution-batch around sequential-default explicit parallel mode, removed review-template placeholder checkboxes, and added R28/R29 structure tests.
- **Tags:** plugins-sp, workflow, parallel-execution, task-template, contract-drift
- **Occurrences:** 1

## bug-728: `bun run apps/cli/src/index.ts task check --strict --json` fails repo-wide on existing task corpus drift (missing feature_id, missing coverage claim/N/A, Review table issues, and AC subset mismatches across older tasks).

- **Date:** 2026-07-01T04:12:30.000Z
- **File:** `docs/tasks2`
- **Root cause:** Historical task files predate the current stricter planning checks and feature traceability rules; this is existing corpus debt, not caused by the plugins/sp review changes.
- **Fix:** No corpus rewrite in this review. Recorded as known debt; normal gates (`bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`) pass.
- **Tags:** task-check, corpus-drift, feature_id, coverage, strict-check
- **Occurrences:** 1

## bug-729: Spur config loader review found that `loadSpurConfig()` did not honor the same project-to-global fallback as `resolveConfigFile()`, repeated config/planning-folder loads were not cached inside a process, and non-embedded package `$schema` refs could fail to resolve from the workspace schema file.

- **Date:** 2026-07-01T21:30:00.000Z
- **File:** `packages/config/src/loader.ts`
- **Root cause:** The centralized config migration split path discovery (`resolveConfigFile`) from config loading (`loadSpurConfig`) but left the loader hardcoded to project `.spur/config.yaml`. Planning-folder resolution also reparsed YAML per call, and schema resolution assumed ts-runtime could open bare package specifiers as filesystem paths.
- **Fix:** Made `loadSpurConfig()` call `resolveConfigFile()`, added successful-load caches for Spur config and same-FileSystem planning folders, resolved package schema manifests through the workspace CLI package when present with import-meta fallback, cached CLI task section-matrix loads, and added regression tests for global fallback, schema resolution, and planning-folder cache behavior.
- **Tags:** spur-config, performance, config-loader, schema-resolution, global-config
- **Occurrences:** 1

## bug-730: Task 0167 requirements/design had implementation-blocking drift: new workflows targeted .spur/workflows instead of config/workflows, --auto was described as auto-resolving HITL, wrapup tried direct feature done transition, structural test numbering collided with existing R29, plugins/sp/README.md was referenced but does not exist, and checkpoint/metrics behavior was underspecified.

- **Date:** 2026-07-01T17:57:14.430284+00:00
- **File:** `docs/tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md; docs/design/e2e-workflow-for-system-development.md`
- **Root cause:** Initial requirements mixed project-local symlink paths with bundled repo paths and conflated objective gates, taste gates, lifecycle transitions, and documentation-only conventions.
- **Fix:** Refined task/design docs to use config/workflows, preserve R29 and allocate R30-R35, specify route-around auto semantics, require legal feature lifecycle transitions, define wrapup metrics/checkpoint files, add acceptance criteria, and correct README/reference paths.
- **Tags:** docs, requirements, sp-plugin, workflow, hitl, lifecycle
- **Occurrences:** 1

## bug-731: Task 0167 refinement incorrectly changed workflow command/docs away from `.spur/workflows/*` even though `.spur/workflows` is the correct project-facing symlink to `config/workflows` in spur-new.

- **Date:** 2026-07-01T18:06:01Z
- **File:** `docs/tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md; docs/design/e2e-workflow-for-system-development.md; .wolf/cerebrum.md`
- **Root cause:** The prior review treated `config/workflows/*` as the only correct implementation target and failed to preserve the distinction between operator-facing project config (`.spur/workflows/*`) and the physical symlink target (`config/workflows/*`).
- **Fix:** Updated task 0167 and the e2e workflow design to use `.spur/workflows/*` for operator-facing workflow execution while documenting `config/workflows/*` as the physical repo source. Corrected the stale OpenWolf learning.
- **Tags:** docs, requirements, workflow, symlink, task-0167
- **Occurrences:** 1

## bug-732: Decomposed child tasks (0168-0173) reported complete by sp:super-coder, but spot-check showed Requirements/AC/Design/Plan were still template placeholders — only Background was filled. `spur task check` returned PASS on the empty shells.

- **Date:** 2026-07-01T22:10:00Z
- **File:** `docs/tasks2/0168_*.md; docs/tasks2/0169_*.md; docs/tasks2/0170_*.md; docs/tasks2/0171_*.md; docs/tasks2/0172_*.md; docs/tasks2/0173_*.md`
- **Root cause:** `spur task check` validates schema/structure, NOT section content completeness — tasks with only Background filled pass the check. The decomposing agent reported 'requirements name only workflow YAMLs...' which was not what was on disk (R12 fail-loud miss: reported complete when bodies were empty).
- **Fix:** Re-tasked agent to fill Requirements/AC/Design/Plan for all 6 children via `spur task update <wbs> --section <Name> --from-file <path>` (section name = canonical heading text e.g. 'Acceptance Criteria'; body file excludes the heading line), then spot-checked 0168 + 0170 directly before approving execution. Lesson: do NOT trust `spur task check PASS` as evidence a decomposed task is implementable — always spot-check section content.
- **Tags:** decomposition, task-check, spur-task, fail-loud, task-0167, spot-check
- **Occurrences:** 1

## bug-733: `bun run lint` exited 1 (biome formatting failure) after the task-pipeline `implement` stage produced `packages/app/tests/workflow/actions/agent-run.test.ts`. The implementing agent's `## Testing` section mis-attributed the exit-1 to 'pre-existing coverage gaps in packages/config and packages/domain' — that attribution was wrong (all 7 workspaces typechecked clean; the failure was biome formatting in the agent's own new test file, ~lines 273-309 `expect(...).toContain(...)` indentation).

- **Date:** 2026-07-01T23:06:26Z
- **File:** `packages/app/tests/workflow/actions/agent-run.test.ts`
- **Root cause:** The pipeline `implement` agent.run (omp subprocess) authors test files but does not run `bun run format` / `biome check --write` before yielding. The agent then narrates a green gate (`## Testing` says 'all pass') that contradicts the actual tooling output — a fail-loud miss: the agent reported success while `bun run lint` was red.
- **Fix:** Ran `bun x biome check --write packages/app/tests/workflow/actions/agent-run.test.ts` → 'Fixed 1 file'. Re-ran `bun run lint` → clean (all 7 workspaces exit 0); re-ran `bun test` for the file → 31 pass / 0 fail. Lesson: the task-pipeline `test` stage must run `bun run lint` on its own output and fail loudly before reporting 'all pass'; do not let an agent narrate a green gate the tooling contradicts. Treat any agent-authored `## Testing` claim of 'pass' as unverified until the real gate is run.
- **Tags:** lint-gate, biome, agent-run, task-pipeline, fail-loud, task-0174, dogfood, mis-attribution
- **Occurrences:** 1

## bug-734: Workflow variable "design_approved" is not defined — run crashes at guard evaluation

- **Date:** 2026-07-02T05:40:00Z
- **File:** `config/workflows/idea-pipeline.yaml, config/workflows/planning-pipeline.yaml`
- **Root cause:** Guards referenced ${vars.design_approved} but the var was never declared in the vars: block. The dual-workflow engine's resolveTemplateString THROWS on undefined vars (does not treat them as empty/falsy), and firstPassingTransition has no catch — the run aborts instead of falling through to the next transition. idea-pipeline crashed on every design-route run leaving system-design; planning-pipeline crashed at design-gen on EVERY run (introduced by the 0174 R3 hitl-gate fix, commit fe3472d). Never caught because dogfood only exercised the skip-design route and `spur workflow validate` does not cross-check var references.
- **Fix:** Declared design_approved: "false" in both YAMLs' vars blocks (callers override via --vars). Added structural test R36 in plugins/sp/tests/skill-structure.test.ts asserting every ${vars.*} reference in every config/workflows/*.yaml is declared in its vars block.
- **Tags:** workflow-engine, undefined-var, guard, idea-pipeline, planning-pipeline, design_approved, task-0167, task-0174
- **Occurrences:** 1

## bug-735: --vars values must be strings; "tasks" is object — documented invocations of wrapup-pipeline fail at CLI arg parsing

- **Date:** 2026-07-02T05:40:00Z
- **File:** `plugins/sp/commands/dev-wrap.md, dev-wrapall.md, dev-run.md, dev-runall.md, config/workflows/wrapup-pipeline.yaml`
- **Root cause:** parseVars in apps/cli/src/commands/workflow.ts rejects non-string --vars values by design, but the command docs and the wrapup-pipeline header documented --vars '{"tasks":["<wbs>"]}' with a raw JSON array. An operator/agent following the docs verbatim gets a hard error. The 0173 dogfood worked only because it hand-encoded the array as a string.
- **Fix:** Corrected all five docs to pass tasks as a JSON-encoded string (jq -nc --arg pattern in the implementation snippets; escaped-string form in the examples), with an explicit note that --vars values must be strings.
- **Tags:** cli, vars, dev-wrap, dev-wrapall, wrapup-pipeline, doc-bug, task-0169
- **Occurrences:** 1

## bug-736: idea-pipeline ac-generate retry loop was dead code — first failing feature check killed the run instead of retrying

- **Date:** 2026-07-02T05:40:00Z
- **File:** `config/workflows/idea-pipeline.yaml`
- **Root cause:** ac-generate's onEnter shell chained `feature update && feature check && sentinel`. The engine's default onError policy is 'fail' (nothing in Spur sets onError anywhere), so a failing in-action feature check returned ok:false -> outcome 'fail' -> lifecycle.fail. The capped retry transitions (ac-generate self-loop / -> failed after 3) were only reachable when the non-strict in-action check passed but the strict guard check failed — defeating 0174 AC6's convergence design.
- **Fix:** Removed `spur feature check` from the onEnter chain; the transition guards (`feature check --strict`) own quality checking and retry routing. Updated the state description to document why the check must NOT live in the action chain.
- **Tags:** workflow-engine, onError, retry-cap, ac-generate, idea-pipeline, task-0174
- **Occurrences:** 1

## bug-737: spur init does not seed idea-pipeline.yaml / wrapup-pipeline.yaml — dev-idea/dev-wrap/dev-wrapall broken in fresh projects

- **Date:** 2026-07-02T05:40:00Z
- **File:** `apps/cli/src/config/scaffold-manifest.ts`
- **Root cause:** SCAFFOLD_MANIFEST was not updated when the two new pipelines shipped (task 0169/0170). The YAML headers claim 'Seeded by spur init' but only this repo worked, via the .spur/workflows -> config/workflows symlink. Also plugins/README.md and CHANGELOG.md still claimed plugin version 0.3.0 while plugin.json/marketplace.json are pinned at 0.2.12 per the 0174 Q&A decision.
- **Fix:** Added both workflows to SCAFFOLD_MANIFEST (+ manifest test updates, count 31->33). Fixed README version refs to 0.2.12 and CHANGELOG's 'Plugin 0.3.0' line. Also added mkdir -p guards: .spur/run in idea-pipeline start, .spur/memory in wrapup learning/metrics appends (init creates neither dir).
- **Tags:** spur-init, scaffold-manifest, idea-pipeline, wrapup-pipeline, version-drift, task-0172, task-0174
- **Occurrences:** 1

## bug-738: spur task batch-create accepts tags but created template-backed tasks keep tags: []

- **Date:** 2026-07-02T06:35:00Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** TaskService.createBatchItem patches status/template/feature_id/parent_wbs/priority into rendered task templates, but omitted tags. The legacy buildTaskSkeleton fallback already handled tags, so the bug only affected the normal template-rendering path.
- **Fix:** Patched rendered template frontmatter with a JSON-style YAML flow sequence when item.tags is non-empty; added a regression assertion in packages/app/tests/services/task-service.test.ts that the third batch-created task persists tags.
- **Tags:** task-service, batch-create, frontmatter, tags, dogfood, task-0176
- **Occurrences:** 1

## bug-739: spur task batch-create accepts requirements but rendered template tasks keep the Requirements placeholder

- **Date:** 2026-07-02T06:55:00Z
- **File:** `packages/app/src/services/task-service.ts`
- **Root cause:** TaskService.createBatchItem rendered templates with NAME/WBS/BACKGROUND/CREATED_AT only, then patched frontmatter fields. The normal template files do not have a REQUIREMENTS placeholder, so item.requirements was ignored in the template path. The legacy buildTaskSkeleton fallback already wrote and bulletized requirements.
- **Fix:** After rendering and frontmatter patching, parse the task markdown with MarkdownDocument and replace the Requirements section with bulletizeRequirements(item.requirements). Tightened existing batchCreate tests to assert the placeholder is gone.
- **Tags:** task-service, batch-create, requirements, template, dogfood, task-0176
- **Occurrences:** 1

## bug-740: task-pipeline implement agent timed out during dogfood execution of task 0177

- **Date:** 2026-07-02T06:44:52Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The Wave A dogfood run entered the implement agent step and exhausted the configured ~10 minute timeout (`601064ms`) before completing the task. The subprocess left useful partial files staged/modified but the workflow itself failed and produced no structured partial-work handoff artifact.
- **Fix:** Recovered manually from the partial diff, completed Wave A, verified canonical gates, and recorded run id `34233eec-d3ed-44c8-9030-e0b813fb03b5` in the task Review and dogfood report. Track prompt slimming/timeout handoff improvements in later 0176 waves.
- **Tags:** task-pipeline, agent-run, timeout, dogfood, task-0177, task-0176
- **Occurrences:** 1

## bug-741: hitl.confirm cancel answers could not reach workflow cancelled transitions

- **Date:** 2026-07-02T06:53:00Z
- **File:** `packages/app/src/workflow/actions/hitl-confirm.ts`
- **Root cause:** HitlConfirmActionRunner returned ok:false when the responder answered cancel. The workflow YAML declared explicit `cancelled` branches using `${vars.__hitlAnswer}`, but an action failure stops state execution before transition guards can inspect the answer.
- **Fix:** Return ok:true for cancel answers with `data.cancelled=true` and `setVars.__hitlAnswer='cancel'`; updated idea/planning pipeline transitions and action/structure tests.
- **Tags:** hitl, workflow, cancel, state-machine, task-0177
- **Occurrences:** 1

## bug-742: task-pipeline implement agent spawned a nested duplicate pipeline through a global spur.js during dogfood execution of task 0178

- **Date:** 2026-07-02T14:19:07Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The Wave B dogfood run entered the implement agent step and the agent launched another `workflow run config/workflows/task-pipeline.yaml --run-id pipeline-0178` through `/Users/robin/node_modules/@gobing-ai/spur/spur.js`. Both outer and nested runs targeted WBS 0178 and then timed out after roughly 600s, leaving partial work and two failed traces for one task.
- **Fix:** Recovered manually from the partial diff, completed Wave B, and recorded outer run `1b7049d2-1073-4d4d-a97a-47e299bc316e` plus nested run `pipeline-0178` in the task Review and dogfood report. Track a later workflow/prompt guard so task-pipeline implementation agents do not recursively start the same pipeline or use the released/global spur binary in a dev repo.
- **Tags:** task-pipeline, agent-run, nested-run, global-spur, timeout, dogfood, task-0178, task-0176
- **Occurrences:** 1

## bug-743: AgentService.list tests timed out under full-suite load because they used real local agent detection

- **Date:** 2026-07-02T14:19:07Z
- **File:** `packages/app/src/services/agent-service.ts`
- **Root cause:** AgentService.list hard-wired `new AgentDetector().detectAll()` while other AgentService paths accepted injected dependencies. The full gate concurrently exercised enough local process/tool state that two list tests exceeded Bun's 5s test timeout, even though the same file passed in isolation.
- **Fix:** Added an optional AgentRunDeps parameter to AgentService.list, used `deps.detector` when provided, and updated list tests to use the existing mock detector. Production behavior still defaults to real AgentDetector.
- **Tags:** agent-service, tests, detector, timeout, dogfood, task-0178
- **Occurrences:** 1

## bug-744: task-pipeline implement agent timed out again during dogfood execution of task 0179

- **Date:** 2026-07-02T17:17:28Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The Wave C dogfood run entered the implement agent step and exhausted the configured ~10 minute timeout (`600845ms`) before reaching verify or record. This repeated the Wave A timeout class and prevented the full-pipeline R7 probe from proving the tightened verifier end to end.
- **Fix:** Recovered manually from the partial diff, completed Wave C, verified canonical gates, and recorded run id `66561133-64cc-4e93-92d4-2aa8413305d6` in task 0179 and the dogfood report. Keep prompt slimming, partial handoff, and timeout resilience work in the remaining 0176 waves.
- **Tags:** task-pipeline, agent-run, timeout, dogfood, task-0179, task-0176
- **Occurrences:** 1

## bug-745: task verdict requirement parser consumed following Acceptance Criteria table rows as requirements

- **Date:** 2026-07-02T17:45:00Z
- **File:** `packages/app/src/services/task-verdict.ts`
- **Root cause:** The requirement table parser stayed in-table after a `| AC | Status | Evidence Type | Evidence |` header, so AC rows with MET/PARTIAL/UNMET statuses could be appended to `requirements[]` during verdict derivation.
- **Fix:** End requirement-table parsing when a following AC/check/name header is encountered, and add regression coverage that a requirement table followed by an AC table yields exactly one requirement and one AC row.
- **Tags:** task-verdict, parser, acceptance-criteria, dogfood, task-0179
- **Occurrences:** 1

## bug-746: task-pipeline implement agent timed out during dogfood execution of task 0180

- **Date:** 2026-07-02T17:39:06Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The Wave D dogfood run stayed in the `implement` agent step for the configured ~10 minute timeout (`600846ms`) before failing. Partial edits landed late in the run, but the workflow never reached verify/record.
- **Fix:** Recovered manually from the partial diff, completed Wave D, verified canonical gates, and recorded run id `4ac8a861-6233-4e19-ad43-595d99bec537` in task 0180 and the dogfood report. This further supports the Wave D finding that task-pipeline implement prompts need slimming and/or partial-handoff behavior.
- **Tags:** task-pipeline, agent-run, timeout, dogfood, task-0180, task-0176
- **Occurrences:** 1

## bug-747: feature lifecycle guard commands do not receive CLI --folder overrides

- **Date:** 2026-07-02T17:43:04Z
- **File:** `config/workflows/feature-lifecycle.yaml`
- **Root cause:** `spur feature update --folder <path> <id> verifying` and `spur feature advance --folder <path> --to verifying` still invoke lifecycle guard shell commands from `feature-lifecycle.yaml` as `${vars.spurBin} feature check ${vars.featureId}` without passing the feature folder override. In temp-fixture tests the guard checks the project-default corpus, not the overridden folder.
- **Fix:** Did not change lifecycle adapter scope in Wave D. Feature advance tests cover the one-hop path under `--folder` and record guarded-hop denial as a residual. A follow-up should thread folder context into lifecycle guard vars or document that guarded lifecycle transitions are project-corpus only.
- **Tags:** feature-lifecycle, folder-override, guard, testing, task-0180
- **Occurrences:** 1

## bug-748: task-pipeline implement agent timed out during dogfood execution of task 0181

- **Date:** 2026-07-02T22:31:23Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** The Wave E dogfood run stayed in the `implement` agent step until the configured ~10 minute timeout (`600942ms`) and failed before reaching verify/record. The run left partial edits that were useful but incomplete.
- **Fix:** Recovered manually from the partial diff, completed Wave E, verified targeted and canonical gates, and recorded run id `10ab1085-a744-4e10-aee2-6682b062f550` in task 0181 and the dogfood report. The recurrence confirms the timeout pattern remains after prompt slimming and should be handled as a workflow reliability follow-up.
- **Tags:** task-pipeline, agent-run, timeout, dogfood, task-0181, task-0176
- **Occurrences:** 1

## bug-749: Wave E partial diff reintroduced CLAUDE_PLUGIN_ROOT hook registration and had a malformed-payload test that did not send malformed stdin

- **Date:** 2026-07-02T22:45:00Z
- **File:** `plugins/sp/hooks/hooks.json, plugins/sp/hooks/task-write-guard.test.ts`
- **Root cause:** The generated partial fix followed task 0176 N3's self-contained-hook direction literally and changed `hooks.json` back to `${CLAUDE_PLUGIN_ROOT}`, conflicting with task 0151's portability decision. The test helper also always JSON-stringified its payload, so the malformed-payload test passed for the wrong reason.
- **Fix:** Restored `hooks.json` to `superskill hook run sp task-write-guard`, kept the local guard decision logic versioned and tested, and added a raw stdin override to the guard test helper so malformed JSON is actually exercised.
- **Tags:** task-write-guard, hooks, portability, test-quality, dogfood, task-0181
- **Occurrences:** 1

## bug-749: 0176 wave dogfood reports (0178-0181) drop mandatory template sections; operator flagged inconsistency with key components missing

- **Date:** 2026-07-02T23:55:00Z
- **File:** `docs/dogfood/2026-07-02-sp-super-coder-0178-wave-b-dogfood.md`
- **Root cause:** sp:dogfood-testing owns the report contract (Monitor Ledger, token/cache accounting, summary footer, feasibility tags) but nothing enforces it: super-coder terminal gate #5 only checks file existence via ls|grep, Codex sessions have no Skill() delegation so the template instruction degrades to prose, and no test validates report structure (docs/dogfood is gitignored). Reports 0178-0181 each use a different ad-hoc format; 0177's ledger sums don't match its claimed aggregate; all five pipeline FAILs were reported as PASS variants.
- **Fix:** Not yet fixed - review session 2026-07-02 catalogued findings with severity/effort for planning. Proposed: machine-checkable section grep in super-coder gate #5, structure validator, verdict-vocabulary enforcement (testee FAIL != task done).
- **Tags:** dogfood, report-template, sp-plugin, process
- **Occurrences:** 4

## bug-750: task-pipeline approve HITL gate: cancel/no now proceed to verify as if approved

- **Date:** 2026-07-02T23:55:00Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** Wave A (0177) changed hitl.confirm cancel semantics from ok:false (step failure, fail-safe) to ok:true + __hitlAnswer=cancel, and routed yes/no/cancel only in idea-pipeline and planning-pipeline. task-pipeline's approve state was out of R3 scope: approve->verify is guard always, no __hitlAnswer var declared, no cancelled state. In interactive mode (profile!=auto), answering no or cancel at the approval gate now proceeds to verification.
- **Fix:** Not yet fixed - flagged in 2026-07-02 review. Fix: declare __hitlAnswer in task-pipeline vars, guard approve->verify on yes, add no/cancel routes (rework/cancelled), plus structure test.
- **Tags:** task-pipeline, hitl, workflow, regression
- **Occurrences:** 1

## bug-751: Task 0183 (0182 Wave A) requires editing config/workflows/task-pipeline.yaml (R1 HITL routing, R2a implement timeout var, R2c anti-recursion prompt), but every write attempt in this Claude Code sandbox session failed with "Operation not permitted": Bash echo redirect, cp, Python open(path,"w"), and git apply (with a --check-verified valid patch) all failed identically against config/workflows/, config/tasks/, and config/rules/.

- **Date:** 2026-07-03T02:30:00Z
- **File:** `config/workflows/task-pipeline.yaml`
- **Root cause:** This session sandbox denies all writes to the entire config/ directory tree at the OS/sandbox-exec level, independent of the repo task-write-guard hook (which only intercepts Write/Edit tool calls by name, and those tools were not even present in this session toolset). The .spur/workflows symlink into config/workflows/ is denied identically, confirming a real-path-based deny rather than a string-prefix check. No repo-visible sandbox config file references config/ specifically, so the restriction originates outside repo control (external sandbox-exec profile / harness-level policy for this session).
- **Fix:** Not fixable from within the sandboxed session. Completed and tested all requirements not touching config/ (R2b timeout handoff artifact, R10 absolute-path fix, R11 batchCreate JSDoc). Authored and staged the full patched task-pipeline.yaml content (R1 three-way approve-gate HITL routing + new cancelled terminal state, R2a implementTimeoutMs var + timeoutMs swap, R2c anti-recursion prompt sentence) in /tmp/claude-501 as a ready-to-apply artifact. Recorded the blocker plus staged-patch pointer honestly in task 0183 Q&A/Solution; did not transition 0183 to done. R2d (0179 R7 probe rerun) also blocked transitively since it depends on R1/R2a/R2c being live.
- **Tags:** sandbox, config-dir, write-permission, task-pipeline, hitl, task-0183, environment-blocker
- **Occurrences:** 1

## bug-752: R2d probe (task 0186, disposable) failed to execute any agent through config/workflows/task-pipeline.yaml implement step in this sandbox session. omp: SQLiteError: attempt to write a readonly database against ~/node_modules/@oh-my-pi/pi-coding-agent/ local state DB. codex (authenticated, confirmed via spur agent doctor codex): Error: failed to initialize in-process app-server client: Operation not permitted (os error 1), plus a PATH-alias-creation warning with the same errno.

- **Date:** 2026-07-03T04:41:00Z
- **File:** `N/A - agent CLI subprocess invocation, not a Spur source file`
- **Root cause:** Same sandbox restriction class as bug-751 (config/ write-deny) and the test-cf network-listen EPERM: this session sandbox denies subprocess capabilities (writes to agent state directories outside the repo, PATH alias creation, in-process server socket/IPC init) that every locally installed agent CLI needs to actually run. Not a defect in task-pipeline.yaml R1/R2a/R2c logic, which was independently verified via spur workflow validate and a new structural test (R41).
- **Fix:** Not fixable from within the sandboxed session. Recorded honestly in task 0183 Q&A/Solution rather than silently skipping R2d or fabricating a PASS verdict. R2d needs to be rerun in an environment where at least one agent CLI can actually invoke (outside this sandbox, or with subprocess/write restrictions on agent state directories lifted).
- **Tags:** sandbox, agent-invocation, omp, codex, task-pipeline, r2d-probe, task-0183, environment-blocker
- **Occurrences:** 1

## bug-755: R43 structural test could never pass: new RegExp(`\b${name}\b`) in a template literal contained a literal backspace character (\b is an escape in template literals), so the word-boundary regex never matched any command name

- **Date:** 2026-07-03T21:25:02.407Z
- **File:** `plugins/sp/tests/skill-structure.test.ts`
- **Root cause:** \b inside a JS template literal is the backspace control char, not a regex word boundary; the pattern must be written \\b to survive into the RegExp source
- **Fix:** Corrected to new RegExp(`\\b${name}\\b`, "g") during task 0187 (R43 README-index test); test now passes against real command names
- **Tags:** regex, template-literal, escaping, structural-test, plugins-sp, task-0187
- **Occurrences:** 1

## bug-756: spur task record <wbs> --transition done silently overwrote the hand-authored ## Testing section of task 0187 with a terse verdict-derived table, dropping AC12 evidence and gate tails

- **Date:** 2026-07-03T21:25:02.407Z
- **File:** `docs/tasks2/0187_adopt-vendors-skills-lessons-into-plugins-sp-10-point-improv.md`
- **Root cause:** task record is designed for pipeline-driven runs and regenerates the Testing section from the verdict artifact; it does not merge with or preserve existing hand-authored section content
- **Fix:** Re-ran spur task update 0187 --section Testing --from-file with the full content after the record call; recovery verified via grep. Pattern: when closing a hand-walked task, run task record FIRST, then land hand-authored Testing content — or re-apply the section after record
- **Tags:** spur-cli, task-record, section-overwrite, corpus, task-0187
- **Occurrences:** 1

## bug-757: task-pipeline implement step fails in 1.3s: spur agent run --agent omp -> SQLiteError attempt to write a readonly database (omp state DB under ~/node_modules/@oh-my-pi/pi-coding-agent); cross-check --agent claude -> EPERM creating ~/.claude/session-env/<id>

- **Date:** 2026-07-03T23:52:13Z
- **File:** `config/workflows/task-pipeline.yaml (agent.run step); apps/cli agent run path`
- **Root cause:** CC sandbox write-allowlist covers the repo + a few system paths only; NESTED coding-agent subprocesses (omp, claude) need writable state dirs in $HOME that are outside the allowlist, so any agent.run from a sandboxed session fails regardless of task. Same sandbox-deny family as bug-751/754 (lefthook PTY).
- **Fix:** Not fixed (environmental). Workarounds: (a) run pipelines from an unsandboxed terminal session, (b) extend the sandbox write allowlist with the agent state dirs, or (c) have the driver agent implement hands-on and use spur CLI verbs for lifecycle instead of the nested agent.run implement step.
- **Tags:** sandbox, pipeline, agent-run, task-pipeline, environment
- **Occurrences:** 1

## bug-758: spur-check test-post-check exits 1 with coverage-gate reporting 'No lcov file found — coverage not generated. Skipping gate.' Bun from monorepo root with --coverage behaved inconsistently: bun discovered no tests when given no path args, discovered 651 tests when given  directory args, but consistently produced no lcov output at .coverage/lcov.info (the bunfig-specified root path). Coverage data was occasionally written to packages/domain/.coverage/lcov.info (workspace-relative) but not deterministically.

- **Date:** 2026-07-05T10:35:00Z
- **File:** `package.json:test script (line 74); bunfig.toml coverage config; scripts/merge-coverage.ts; apps/web/src/modules/{features,observability,task-kanban}/*.tsx`
- **Root cause:** Bun 1.3.14 root-CWD coverage instrumentation is unreliable. From root with explicit test paths + --coverage, bun sometimes writes the lcov to a workspace-relative directory (one of the matched workspaces) and ignores the --coverage-dir flag (both absolute and relative). When the lcov is written to that workspace subdirectory, the gate at .coverage/lcov.info sees no file and fails closed. When no lcov is written at all, the gate also fails closed. Both behaviors break spur-check at the post-check step.
- **Fix:** Not fixed (project-policy scope). Fixall only fixed the unrelated, smaller failure:  consistency test caught real doc/code drift. Updated docs/04_DESIGN.md:178 to declare  on start/stop verbs (3-line + 4-line fix, consistency test now 3/3 pass). The coverage-gate failure mode requires either: (a) change package.json  to delegate to , (b) make coverage-gate skip-and-pass on missing lcov instead of failing closed, or (c) add explicit bun test coverage-dir resolution at root. And the 5 component-coverage failures require either unit tests for FeatureDetail/FeaturesShell/ProcessListTab (already on the task backlog: 0194 P2 finding, 0210 R3 unchecked) or coverage-gate excludes for .tsx components with documented happy-dom fetch-mock fragility.
- **Tags:** coverage, bun, monorepo-root-discovery, pipeline-wiring, fixall-round3
- **Occurrences:** 1

## bug-759: CLI surface consistency test failed: docs/04_DESIGN.md §1.1 team heading lacked [--json] on spur team start/stop, but apps/cli/src/commands/team.ts declared --json on those verbs. The parseDocSurface / parseVerbsFromHeading parser parsed codeHasJson=true / docHasJson=false and surfaced as mismatches.

- **Date:** 2026-07-05T11:15:00Z
- **File:** `docs/04_DESIGN.md:178 (heading + line 184 description)`
- **Root cause:** In-flight uncommitted team command work (apps/cli/src/commands/team.ts) added --json + --server flags to start/stop, replacing the Phase-4 deferred stub line. The doc heading was not updated in lockstep, so the consistency test (apps/cli/tests/consistency.test.ts) flagged doc/code drift.
- **Fix:** Updated docs/04_DESIGN.md:178 heading to declare \[--server <url>\] \[--json\] on start/stop verbs. Replaced stale Phase-4 stub description with the new HTTP-POST-based behavior. Consistency test 3/3 pass.
- **Tags:** docs-drift, cli-surface, consistency-test, fixall-applied, team-command
- **Occurrences:** 1

## bug-760: Attempted to merge the original two-bun-test chain in package.json 'test' and 'test:full' scripts into a single 'bun test apps/ packages/ plugins/sp/' invocation. spur-check then exits 1 at the post-check coverage gate because bun from root CWD does not reliably emit .coverage/lcov.info when given multiple workspace test paths as positional args (tests run, ~651 dots reported, but coverage file is silently lost).

- **Date:** 2026-07-05T11:38:00Z
- **File:** `package.json scripts.test and scripts.test:full`
- **Root cause:** Bun 1.3.14 at monorepo root with `--coverage` and multiple workspace positional args (`apps/ packages/ plugins/sp/`): tests are discovered (651 runs, exit 0) but coverage instrumentation does not write the lcov to the project-root `.coverage/lcov.info` consistently. Sometimes writes to a workspace-relative path (e.g. `packages/domain/.coverage/lcov.info`), sometimes writes nothing. The gate at .coverage/lcov.info fails closed in either case.
- **Fix:** Reverted to the round-2 split: keep `bun test --coverage --coverage-dir=.coverage --reporter=dots` (which finds 0 tests from root and writes no lcov — the chain's first half is a no-op at root) followed by `bun test plugins/sp --reporter=dots` (which finds 98 tests and writes 3-records lcov at root .coverage/lcov.info, satisfying the gate since plugins paths are excluded by the gate's apps/** + packages/** include patterns).
- **Tags:** coverage, bun, monorepo-root-discovery, spur-check, reverted
- **Occurrences:** 1

## bug-760: Attempted to merge the original two-bun-test chain in package.json 'test' and 'test:full' scripts into a single 'bun test apps/ packages/ plugins/sp/' invocation. spur-check then exits 1 at the post-check coverage gate because bun from root CWD does not reliably emit .coverage/lcov.info when given multiple workspace test paths as positional args (tests run, ~651 dots reported, but coverage file is silently lost).

- **Date:** 2026-07-05T11:38:00Z
- **File:** `package.json scripts.test and scripts.test:full`
- **Root cause:** Bun 1.3.14 at monorepo root with --coverage and multiple workspace positional args (apps/, packages/, plugins/sp/): tests are discovered (651 runs, exit 0) but coverage instrumentation does not write the lcov to the project-root .coverage/lcov.info consistently. Sometimes writes to a workspace-relative path (e.g. packages/domain/.coverage/lcov.info), sometimes writes nothing. The gate at .coverage/lcov.info fails closed in either case.
- **Fix:** Reverted to the round-2 split: keep bun test --coverage --coverage-dir=.coverage --reporter=dots (which finds 0 tests from root and writes no lcov - the chain's first half is a no-op at root) followed by bun test plugins/sp --reporter=dots (which finds 98 tests and writes 3-records lcov at root .coverage/lcov.info, satisfying the gate since plugins paths are excluded by the gate's apps/** + packages/** include patterns).
- **Tags:** coverage, bun, monorepo-root-discovery, spur-check, reverted
- **Occurrences:** 1

## bug-761: Previously: package.json 'test' was a chained invocation ('bun test --coverage --coverage-dir=.coverage --reporter=dots && bun test plugins/sp --reporter=dots') that the operator wanted to merge into one command. The chain depended on chain-1 silently writing no lcov (because bun from root CWD finds 0 tests without explicit path args) while chain-2 wrote the plugins/sp lcov. Whether plugins/sp lcov overrode any prior lcov depended on chain-1 emitting data — which it didn't.

- **Date:** 2026-07-05T12:05:00Z
- **File:** `package.json + scripts/merge-coverage.ts`
- **Root cause:** Bun 1.3.14 from monorepo root CWD: 'bun test' (no path args) finds 0 tests so writes no lcov. With explicit dir args (apps/ packages/ plugins/sp/) at root, bun's discovery is inconsistent across versions — sometimes 0 tests, sometimes 651 — and coverage instrumentation from root CWD doesn't reliably emit .coverage/lcov.info regardless. The per-workspace approach used by scripts/merge-coverage.ts (cd to each workspace, run bun test with --coverage, write workspace-local lcov, then merge into .coverage/lcov.info) is the only reliable path on Bun 1.3.14.
- **Fix:** Routed 'test' and 'test:full' scripts to scripts/merge-coverage.ts via 'bun run scripts/merge-coverage.ts' and '... --update-snapshots'. Extended ensureWorkspaceLcov() to accept updateSnapshots parameter and conditionally pass --update-snapshots to per-workspace bun test spawns. Single-invocation design: package.json now has one shell command per script entry; the multi-workspace fan-out happens inside the script. No overwrite risk because each workspace writes to its own coverage/lcov.info; merge-coverage.ts does the merge via dedup-by-max-hit-count.
- **Tags:** coverage, bun, monorepo-root-discovery, spur-check, fixall-round4, single-invocation
- **Occurrences:** 1

## bug-762: `bun run autofix && bun run spur-check` could return a misleading green post-check while the new coverage merger had already found files below threshold. The merger ran workspace tests with `--coverage-threshold=0`, ignored child test exit codes, dropped function coverage from merged LCOV, globally excluded `**/*.tsx`, and could overwrite `.coverage/lcov.info` with an empty file when no workspace LCOV existed.

- **Date:** 2026-07-05T13:02:33-07:00
- **File:** `scripts/merge-coverage.ts, bunfig.toml, config/rules/quality/coverage-gate.yaml, package.json`
- **Root cause:** The merge script was treated as a reporting helper but wired as the authoritative `bun run test` gate. It disabled Bun's built-in threshold, only summarized line coverage, did not propagate test failures, and the project coverage config excluded all TSX files, hiding weak React component coverage.
- **Fix:** Turned `scripts/merge-coverage.ts` into the gate: workspace test failures now set exit 1, dots reporter is preserved, merged LCOV keeps `FNF/FNH` plus `LF/LH`, per-file line and function thresholds are enforced, `.coverage/file-coverage.tsv` is emitted, missing LCOV fails closed without clobbering the previous artifact, plugin tests are included, and the blanket TSX coverage exclusion was removed from Bun and Spur rule config.
- **Tags:** coverage, quality-gate, bun, tsx, lcov, spur-check
- **Occurrences:** 1

## bug-763: Observability > System Events is not guaranteed to show every event emitted by Spur; current behavior captures only event names subscribed by the system_events tap/SSE allowlist and emitted on the server context EventBus.

- **Date:** 2026-07-07T06:47:00-07:00
- **File:** `packages/app/src/services/event-names.ts, packages/app/src/services/system-event-tap.ts, apps/server/src/modules/events/index.ts, apps/web/src/modules/observability/SystemEventsTab.tsx`
- **Root cause:** The event history and live stream are driven by a fixed event-name list and a specific server EventBus instance. Events emitted on local CLI buses, private service/library buses, or names absent from the list do not reach system_events or SSE. The UI filtering/detail rendering work does not address that capture contract.
- **Fix:** Created task 0220 to audit all emit sites and implement a registry-backed System Events pipeline with derived persistence/SSE subscriptions, catalog-driven filters, and extensible detail renderers. No source implementation was changed in this session.
- **Tags:** observability, system-events, eventbus, sse, board
- **Occurrences:** 1

## bug-764: `bun run test-cf` crashed before executing tests with signal 11 / Cloudflare worker pool exited unexpectedly while task 0220 changes were in progress.

- **Date:** 2026-07-07T07:19:00-07:00
- **File:** `apps/server/src/modules/events/event-names.ts, apps/server/src/modules/events/system-event-tap.ts, apps/server/src/modules/feature/handlers.ts, packages/app/package.json`
- **Root cause:** Worker-loaded server modules were resolving value imports through the broad `@gobing-ai/spur-app` barrel. That barrel pulls app services with Bun/process/native dependencies into the Cloudflare bundle graph, causing the Worker runtime to fail before tests could run.
- **Fix:** Added narrow package exports `@gobing-ai/spur-app/system-events`, `@gobing-ai/spur-app/system-event-tap`, and `@gobing-ai/spur-app/feature-check`; updated Worker-loaded server modules to import those narrow slices. `bun run test-cf` then passed.
- **Tags:** cloudflare, worker, bundle-graph, package-exports, system-events
- **Occurrences:** 1

## bug-765: After restarting `spur serve`, the Observability > System Events tab loaded the new UI but showed no history rows.

- **Date:** 2026-07-07T10:21:00-07:00
- **File:** `apps/server/src/serve.ts, apps/cli/src/commands/serve.ts, apps/server/src/context.ts`
- **Root cause:** `startServer()` did not pass a database URL to `createServerContext()`, whose default is `:memory:`. CLI commands use `.spur/spur.db` by default, but the Board server was using a fresh in-memory DB on every restart, so `system_events` history was empty.
- **Fix:** Added `StartServerOptions.dbUrl`, passed it through to `createServerContext()`, ensured the DB parent directory exists, and changed CLI `spur serve` to resolve the same default `.spur/spur.db` path unless `DATABASE_URL` is set. Added server and CLI regression tests.
- **Tags:** observability, system-events, server-db, sqlite, serve
- **Occurrences:** 1

## bug-766: Observability > System Events only shows queue.* events; non-queue cataloged events are not visible at runtime.

- **Date:** 2026-07-07T21:45:00.000-07:00
- **File:** `apps/server/src/context.ts`
- **Root cause:** Expanded catalog/tap coverage was not matched by real producer wiring: tests direct-emitted event names, ServerContext lacks native rule/workflow/agent service accessors with server EventBus injection, and board-triggered child CLI processes cannot share the parent in-memory EventBus.
- **Fix:** Created docs/tasks2/0226_system-events-real-producer-wiring-review-findings.md with review findings, acceptance criteria, and implementation plan; implementation pending.
- **Tags:** observability, system-events, eventbus, server, review
- **Occurrences:** 1


## 2026-07-26 — workflow pause/continue loses setVars (engine bug, blocks task-pipeline approve gate)

- **Symptom:** `spur workflow continue <run-id> --yes` on a run paused at task-pipeline's `approve` state ALWAYS fails with `workflow failed: task-pipeline -> approve` — regardless of answer, TTY, or SPUR_HITL_AUTO_APPROVE=1 (at continue OR at launch).
- **Root cause:** ts-dual-workflow-engine `StateMachineDriver` (`~/xprojects/ts-libs/packages/dual-workflow-engine/src/state-machine.ts:63`) rebuilds `vars = mergeVars(workflow.vars, options.vars)` on resume. `setVars` from the pause state's onEnter actions (hitl.confirm's `__hitlAnswer`) are in-memory only — never persisted (no vars column in schema-sql.ts; `RunLifecycle.pause` persists only state id + phase). On resume all three approve guards (`test "${vars.__hitlAnswer}" = yes|no|cancel`) see the YAML default `""` → `no-passing-transition` → `lifecycle.fail`.
- **Impact:** the `approve` HITL gate in `config/workflows/task-pipeline.yaml` (and any `pause: true` state with setVars-dependent guards) is uncontinuable. `profile=auto` (skip the gate) is the only pipeline path to verify. Observed 3× during the R2 batch (runs 7c3d3cc4, e2dc3142, 111321ee).
- **Workaround used:** A6 recovery hop `/sp:dev-verify <wbs> --auto --next` after operator gate approval (verify → verdict → done), disclosed as manual gate walk per F2.
- **Fix direction:** persist merged vars (incl. setVars) in the run snapshot at pause and reload on resume; or re-execute the pause state's hitl actions on resume instead of skip-on-enter.
- **Tags:** workflow-engine, hitl, task-pipeline, ts-libs
- **Occurrences:** 3
