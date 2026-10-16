---
schema_version: 1
name: Bind builder PR operations to the caller execution context
status: done
template: issue
created_at: 2026-10-16T01:39:44.630Z
updated_at: "2026-10-16T04:08:02.570Z"
feature_id: A91

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1215-verdict.json
---

## 1215. Bind builder PR operations to the caller execution context

### Background

The path review reproduced an execution-context regression in the absorbed builder PR spine. Registering the command with a temporary non-git `context.cwd` returned preflight success and reported the checkout's real repository instead. Only a local git root lookup ran; gh and all mutations were stubbed. Evidence: `.spur/run/dev-review-2026-10-15/repro-pr-cwd.json` and its adjacent reproducible script. This belongs to A91 reusable CLI absorption and runtime ownership (R5/R7), not a new public surface. Tasks 1211/1212 are completed historical acceptance, and no active task owns the new regression. Malformed-URL redaction and serial-test comment fixes are already resolved by this review.

### Requirements

- [x] R1. Every builder PR operation must execute git/gh in the explicitly supplied CLI cwd with the caller env. Preserve process cwd/env defaults for direct application callers that omit the optional context.
- [x] R2. Resolve relative --status-file paths against the same invocation cwd, and preserve absolute paths. Do not change process.cwd(), process.env or other invocations' state to emulate context.
- [x] R3. Preserve all existing subcommands, head pinning, status vocabulary, output sinks and exit codes. Keep credentials out of diagnostics and retain the existing no-force-push guarantee.
- [x] R4. Add deterministic two-repository tests using fake gh; assert correct root, branch, environment and status placement, plus refusal for an explicitly selected non-git directory. No real network, PR comments, pushes, new verbs or new config keys.

### Acceptance Criteria

```gherkin
Feature: Builder PR operations honor their caller context
  Scenario: R5 — Workflow adapters use one approved runtime persistence path
    Given the process is running in repository A and the CLI context selects repository B
    When builder pr preflight and representative mutation-capable operations run with fake gh/git boundaries
    Then repository B and the caller environment own every external command
    And a relative status file is written beneath B while an absolute status path remains absolute
    And selecting a non-git directory refuses instead of inspecting repository A
    And process cwd and env remain unchanged after success and failure
    And consecutive invocations in A and B do not share execution context
    And the existing head-pin, output and exit-code regression suites remain green
```
Verification: run `bun test tests/services/pr-review/pr-review.test.ts` inside packages/app and `bun test tests/commands/builder/pr.test.ts` inside apps/cli, then the project gate. Both line and function coverage must remain at least 90% per measured changed file.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Thread a narrow optional application execution context (cwd/env and the existing command-runner seam) through the PR spine and pass `context.cwd/context.env` from the CLI adapter. Bind the default runner per invocation; keep argv-only test runners compatible where possible. Resolve status paths with the same context. Prefer invocation-local state/closures over changing global cwd or adding mutable global context. Target `apps/cli/src/commands/builder/pr.ts`, `packages/app/src/services/pr-review/index.ts`, their existing test files, and the builder facade documentation only if its context contract needs clarification. Reject process.chdir, temporary process.env rewriting, git-only -C patches (gh and status writes would still be wrong), and per-operation duplicated runners. Out of scope: review-request semantics, polling redesign, release publisher behavior, public flags and unrelated command migrations.

### Plan

1. Turn the captured cwd replay into a failing CLI regression and add application tests for explicit env/status paths and omitted-context compatibility.
2. Introduce the smallest invocation-bound execution context and pass it through the adapter, external runner and status-file helpers.
3. Test two independent contexts, error cleanup, non-git refusal and fake mutation operations without external side effects.
4. Run both focused suites, typechecks and the project gate; record per-file coverage and source anchors before verification. Keep this task independent of 1214.

### Root Cause

`registerBuilderPrCommand` forwards argv and output only. The application `spawnRunner` sets neither cwd nor the context env and obtains process-global env instead. Git/gh therefore resolve the process repository regardless of the CLI invocation context; relative status-file writes likewise use process cwd. Evidence: `apps/cli/src/commands/builder/pr.ts:24`, `packages/app/src/services/pr-review/index.ts:112`, and `packages/app/src/services/pr-review/index.ts:216`. The wrong-root replay is observed; no hypothesis is required for this seam.

### Solution

Thread one narrow optional `PrReviewContext { cwd?, env? }` through the PR spine; the CLI adapter now passes its invocation cwd/env and every git/gh call and relative status write use it. No process-global state is mutated.

**Change map** (`packages/app/src/services/pr-review/index.ts` unless noted)

- `:114` — new optional `PrReviewContext { cwd?, env? }`: the caller execution context (the only new public type).
- `:126` — `createSpawnRunner(context)`: default runner binds `cwd`/`env` per invocation — `spawnSync(..., { cwd: context.cwd, env: context.env ?? getEnvVars() })`; both fall back to process defaults when omitted.
- `:145` — `spawnRunner = createSpawnRunner()` keeps the direct-call (process-default) behavior.
- `:148` — module seam is now `injectedRunner: CommandRunner | null`; `setCommandRunner` still installs/clears an argv-only test stub, and `null` means "bind the context-bound default", so existing test runners stay compatible.
- `:162` — `SpineRuntime { run, writeStatus }`: the per-invocation execution seams.
- `:168` — `createRuntime(context)` binds the runner and roots status writes at `context.cwd ?? process.cwd()` via `path.resolve` (absolute paths stay absolute). Built once per `main` call; never touches `process.cwd()`/`process.env`.
- `:177`, `:181`, `:262`, `:268` — `run`, `runOk`, `writeStatus`, `writeFailureStatus` thread `rt`.
- `:488`–`:836` — every git/gh primitive and subcommand (`preflightContext`, `resolveUpstream`, `viewPr`, `fetchPaginated`/`fetchReviews`/`fetchInlineComments`/`fetchIssueComments`, `requireExpectedHead`, `revalidateWaitTarget`, `cmdPreflight`…`cmdStatus`) now takes `rt`. Subcommand set, head pinning, status vocabulary, output sink and exit codes are unchanged; the no-force-push `git push` is untouched.
- `:957` — `main(argv, sink, context = {})` builds the runtime once per invocation, so consecutive invocations in A and B never share cwd/env.
- `apps/cli/src/commands/builder/pr.ts:24` — the adapter forwards `{ cwd: context.cwd, env: context.env }` to the spine.

Rejected patterns are absent: no `process.chdir`, no `process.env` rewrite, no git-only `-C` patch, no per-operation duplicated runners.

**Tests**

- `packages/app/tests/services/pr-review/pr-review.test.ts:1219` — two real throwaway repositories + fake `gh`: asserts the context repo root/branch/env, relative status placement beneath the context cwd, absolute status path stays absolute, two independent invocations, non-git refusal, process cwd/env unchanged, omitted-context process defaults, and per-context runner binding.
- `apps/cli/tests/commands/builder/pr.test.ts:47` — CLI adapter regression: with the process running inside the checkout and the context selecting repo B, `builder pr preflight` resolves B (not the checkout), consecutive invocations bind to their own repo, and a selected non-git directory refuses with `not a git repository`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Adapter hands its invocation context to the spine: `apps/cli/src/commands/builder/pr.ts:22-33` passes `{ cwd: context.cwd, env: context.env }`; those are the CLI root's resolved values (`apps/cli/src/index.ts:64-65` `options.cwd ?? process.cwd()` / `options.env ?? getEnvVars()`, resolved at `apps/cli/src/context.ts:132-133`) carried on `CliContext.cwd` (`apps/cli/src/context.ts:36`) and `CliContext.env` (`apps/cli/src/context.ts:39`). The runner binds both on the child at `packages/app/src/services/pr-review/index.ts:126-141` (`cwd` at `:132`, `env: context.env ?? getEnvVars()` at `:133`); omitted-context defaults at `packages/app/src/services/pr-review/index.ts:169` (`context.cwd ?? process.cwd()`) and `packages/app/src/services/pr-review/index.ts:145` (`spawnRunner = createSpawnRunner()`). No call site bypasses the context: every runner invocation in `packages/app/src/services/pr-review/index.ts` takes `rt` (11 `runOk(rt,` plus 13 `run(rt,` occurrences; a grep for a context-less `run([`/`runOk([` returns 0 hits) and the module's only other runner reference is the default export at `:145`. The regression is real: at base `5b8de3478` the child was spawned without `cwd` (`git show 5b8de3478:packages/app/src/services/pr-review/index.ts`, spawnSync call at line 112). Fresh re-run this session: `(cd packages/app && bun test "$PWD/tests/services/pr-review/pr-review.test.ts")` -> anchor `packages/app/tests/services/pr-review/pr-review.test.ts`: 72 pass / 0 fail (251 expect calls), exit 0; `(cd apps/cli && bun test "$PWD/tests/commands/builder/pr.test.ts")` -> anchor `apps/cli/tests/commands/builder/pr.test.ts`: 6 pass / 0 fail (19 expect calls), exit 0. |
| R2 | MET | Status writes root at the invocation cwd: `packages/app/src/services/pr-review/index.ts:169` sets `baseDir = context.cwd ?? process.cwd()` and `packages/app/src/services/pr-review/index.ts:173` writes `resolve(baseDir, file)` — relative stays under the caller cwd, absolute stays absolute. Success path `packages/app/src/services/pr-review/index.ts:262-266`; failure/`--status-file`-on-error path `packages/app/src/services/pr-review/index.ts:268-274`. Delivered assertions: relative `pr.status` lands in the context repo while the other repo has none at `packages/app/tests/services/pr-review/pr-review.test.ts:1298-1311`; absolute path preservation at `packages/app/tests/services/pr-review/pr-review.test.ts:1313-1319`; CLI-side `pr.status` read out of the context repo at `apps/cli/tests/commands/builder/pr.test.ts:128-150`. No process-global emulation: `grep -n chdir` over `packages/app/src/services/pr-review/index.ts` and `apps/cli/src/commands/builder/pr.ts` -> 0 hits; `grep -nE "process\.env\[\|process\.env\.[A-Za-z_]+ *="` over the same two files -> 0 hits. |
| R3 | MET | Mechanical base-vs-worktree checks against `5b8de3478` over `packages/app/src/services/pr-review/index.ts`: the subcommand `case '<verb>':` set is identical (SUBCOMMAND SET IDENTICAL), the `fail(..., <code>)` signatures are identical (EXIT CODE SIGNATURES IDENTICAL), and the status vocabulary is identical (STATUS VOCAB IDENTICAL). Head pinning retained: `requireExpectedHead` defined at `packages/app/src/services/pr-review/index.ts:580` with 4 call sites (`packages/app/src/services/pr-review/index.ts:779`, `:796`, `:845`, `:871`). No-force-push retained: the bare fast-forward-only push at `packages/app/src/services/pr-review/index.ts:656` (`git push`, never `--force`); the `-u` push at `packages/app/src/services/pr-review/index.ts:645` is unchanged. Output sinks and exit codes unchanged (the `fail` code signatures are untouched; usage errors still exit 1, covered at `apps/cli/tests/commands/builder/pr.test.ts:27`). Credentials stay out of diagnostics: `process.env` appears 0 times in `packages/app/src/services/pr-review/index.ts` and `apps/cli/src/commands/builder/pr.ts`; the caller env is only handed to the child. Both focused suites are green (72 pass / 6 pass above). |
| R4 | MET | Two real throwaway repositories plus a fake `gh` on the fixture PATH: application suite `packages/app/tests/services/pr-review/pr-review.test.ts:1219-1370` (context repo root, branch and env marker via `nameWithOwner`, relative plus absolute status placement, consecutive A/B invocations, non-git refusal, process cwd/env unchanged, default and context-bound runners) and CLI suite `apps/cli/tests/commands/builder/pr.test.ts:47-169` (context repo instead of the process checkout, per-invocation binding, non-git refusal with `not a git repository`). The fake `gh` handles only `auth status` and `repo view` and exits 1 otherwise (`packages/app/tests/services/pr-review/pr-review.test.ts:1249-1261`), so no network, PR comment or push is reachable. Scope stays 1215-only: `git diff --stat 5b8de3478` over the four 1215 files reports 4 files changed, +513/-147 (`apps/cli/src/commands/builder/pr.ts`, `apps/cli/tests/commands/builder/pr.test.ts`, `packages/app/src/services/pr-review/index.ts`, `packages/app/tests/services/pr-review/pr-review.test.ts`); no new verb, flag or config key. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — Workflow adapters use one approved runtime persistence path | MET | test | All six clauses re-confirmed on the current digest (repo-root-relative anchors). Clause "B and the caller env own every external command": fresh re-run `(cd packages/app && bun test "$PWD/tests/services/pr-review/pr-review.test.ts")` -> anchor `packages/app/tests/services/pr-review/pr-review.test.ts`: 72 pass / 0 fail, exit 0 — inside it `packages/app/tests/services/pr-review/pr-review.test.ts:1298-1311` asserts `repoRoot` is the context repo, `branch` is `feat/b` and the env marker reaches `gh` via `nameWithOwner`, explicitly not the process checkout and not repo A; `packages/app/tests/services/pr-review/pr-review.test.ts:1365-1369` asserts the context-bearing runner binds cwd and env, with binding at `packages/app/src/services/pr-review/index.ts:126-141`. Clause "relative status beneath B, absolute stays absolute": `packages/app/tests/services/pr-review/pr-review.test.ts:1298-1311` (relative `pr.status` under the context repo, absent in repo A) and `packages/app/tests/services/pr-review/pr-review.test.ts:1313-1319` (absolute path unchanged), plus the CLI read at `apps/cli/tests/commands/builder/pr.test.ts:128-150`; implementation at `packages/app/src/services/pr-review/index.ts:169-173`. Clause "non-git directory refuses instead of inspecting A": `apps/cli/tests/commands/builder/pr.test.ts:159-169` and `packages/app/tests/services/pr-review/pr-review.test.ts:1336-1346` -> exit 2, `not a git repository`, checkout root absent from stdout. Clause "process cwd/env unchanged after success and failure": `packages/app/tests/services/pr-review/pr-review.test.ts:1348-1357` (cwd, PATH and marker captured before a success and before the refusal) and `packages/app/tests/services/pr-review/pr-review.test.ts:1359-1363` (omitted-context call keeps process cwd/env); structurally guaranteed — 0 `chdir` hits and 0 `process.env` hits in the two changed source files. Clause "consecutive invocations in A and B do not share context": `packages/app/tests/services/pr-review/pr-review.test.ts:1321-1334` and `apps/cli/tests/commands/builder/pr.test.ts:152-157`, with the runtime built once per invocation at `packages/app/src/services/pr-review/index.ts:957-967` (`runSpine(argv, createRuntime(context))` at `packages/app/src/services/pr-review/index.ts:961`). Clause "existing head-pin, output and exit-code regression suites remain green": `(cd apps/cli && bun test "$PWD/tests/commands/builder/pr.test.ts")` -> anchor `apps/cli/tests/commands/builder/pr.test.ts`: 6 pass / 0 fail, exit 0 (includes the head-pin/exit-code subcommand cases); the full gate on this proof digest is `.spur/run/1215-test-gate.log` -> 11160 pass / 0 fail, 42516 expect calls over 706 files, with `.spur/run/1215-check-receipt.json` `status: PASS` and proof digest `sha256:270e1a11e822ca70e62bf0560ea5c9c54fa3f1da014e3930f0838368576a15d3`; coverage floor from the task Verification (>=90% per changed file) holds on that log — `apps/cli/src/commands/builder/pr.ts` 100.00 funcs / 100.00 lines and `packages/app/src/services/pr-review/index.ts` 98.46 funcs / 100.00 lines; `bun apps/cli/src/index.ts task residual 1215 review-gate --no-logo` -> `residual-review-gate: 1215 blocking=0`. Accepted residual, recorded not failing: both two-repository suites drive `preflight` (read-only) rather than a mutation-capable subcommand (review finding P3, DEFER). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1215 Bind builder PR operations to the caller execution context

**Scope:** task 1215's change set vs base `5b8de3478` (`.spur/run/1215-base.sha`) — 4 files, +513/−147: `apps/cli/src/commands/builder/pr.ts`, `packages/app/src/services/pr-review/index.ts`, and their two test files, plus this task's `### Solution`. Task 1214's still-uncommitted files (`plugins/sp/lib/destructive-policy.ts`, `plugins/sp/scripts/hooks/careful-guard.ts`, `plugins/sp/tests/hooks/*`) were excluded from this review and contribute no finding.
**Dimensions:** functional traceability (R1–R4 + the AC R5 scenario), correctness, security, efficiency, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | functional | The AC scenario names "preflight **and representative mutation-capable operations**" under the caller context, but both delivered two-repository suites exercise only `preflight` (read-only): no test runs `push`/`ensure`/`request`/`collect`/`status` with an explicit cwd+env, so the mutation-capable half of the scenario is proven by structure rather than by a test. The behaviour itself holds and was verified in this review: a fake `gh` that logs `$PWD` and the env marker shows all 7 `gh` calls of `request` running with cwd = the context repo and the context env marker, `REQUESTED` landing in the context cwd's `req.status`, and the process cwd/env untouched; a context-less spine cannot bypass the seam because every runner call site takes `rt` (`packages/app/src/services/pr-review/index.ts:177`, 26 call sites) and nothing else in the module can reach the runner. Test hardening only — the fix is one extra case in the existing suite. | `apps/cli/tests/commands/builder/pr.test.ts:128`, `packages/app/tests/services/pr-review/pr-review.test.ts:1298` | DEFER(follow-up test-hardening: add one mutation-capable op, e.g. `request`, to the two-repository suite) |
| 2 | P4 (advisory) | architecture | `createRuntime` reads the module-global test seam at invocation time (`injectedRunner ?? createSpawnRunner(context)`), so while a stub is installed a context-bearing call runs commands through the stub (context cwd/env ignored) while the status writer still resolves against `context.cwd` — the two seams of one `SpineRuntime` can disagree. Test-only (no production caller sets the seam), documented at `packages/app/src/services/pr-review/index.ts:147`, and `setCommandRunner()` restores the context-bound default, so it is an accepted invariant debt rather than a defect. | `packages/app/src/services/pr-review/index.ts:171` | ACCEPTED |
| 3 | P4 (advisory) | architecture | `main` still swaps the module-level `io` sink for the duration of the call; it is restored in `finally`, so sequential invocations do not leak, but the module is not reentrant for concurrent in-process calls. Pre-existing (unchanged by 1215, same shape at base); the new cwd/env state is invocation-local — `rt` is built per call at `:168` and passed by value, so consecutive A/B invocations share nothing. | `packages/app/src/services/pr-review/index.ts:957` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Adapter forwards its invocation context to the spine: `apps/cli/src/commands/builder/pr.ts:28-32` passes `{ cwd: context.cwd, env: context.env }`; `CliContext.cwd/env` are the CLI's own invocation values (`apps/cli/src/context.ts:65-66`, `apps/cli/src/index.ts:64-65` — `process.cwd()`/`getEnvVars()`, or the caller's injected values), and `spur builder pr` is reached from the root context (`apps/cli/src/commands/builder.ts:166`). `createSpawnRunner` binds them on the child: `packages/app/src/services/pr-review/index.ts:126-141` (`spawnSync(..., { cwd: context.cwd, env: context.env ?? getEnvVars() })`); `createRuntime` at `:168-174` builds one runner per invocation and `main` builds one runtime per call (`:957-966`). No bypass exists: `rg -n "\b(run|runOk)\(\s*\[" packages/app/src/services/pr-review/index.ts` → 0 hits (all 26 call sites pass `rt`), and `spawnRunner` has no in-module caller. Omitted-context defaults preserved: `:133` (`context.env ?? getEnvVars()`) and `:169` (`context.cwd ?? process.cwd()`); re-run this review with no context → `preflight` resolved the process checkout (`"working tree is dirty (11 entries)"`, exit 2), i.e. the pre-1215 process-cwd behaviour. Regression is real: at base, `spawnSync` carried no `cwd` (`git show 5b8de3478:…/pr-review/index.ts`), so the same assertion would have reported the checkout root, not repo B. |
| R2 | MET | Status writes now resolve against the invocation cwd: `packages/app/src/services/pr-review/index.ts:173` (`writeFileSync(resolve(baseDir, file), content)`) with `baseDir = context.cwd ?? process.cwd()` at `:169`; `resolve` keeps an absolute path absolute. Both paths are covered — success `writeStatus` `:262-266`, failure `writeFailureStatus` `:268-274` (the `--status-file`-on-error path). Delivered tests: relative placement + absolute preservation at `packages/app/tests/services/pr-review/pr-review.test.ts:1298-1319` (asserts `repoB/pr.status` = `PASS`, `repoA` has none, absolute stays absolute) and `apps/cli/tests/commands/builder/pr.test.ts:128-151`. No global emulation: `rg -n "chdir"` and `rg -n "process\.env\[|process\.env\.[A-Za-z_]+ *="` over both changed source files → 0 hits (env-var-hygiene rule `apps/cli/config/rules/boundary/env-var-hygiene.yaml:38-44` holds). |
| R3 | MET | Mechanical diffs vs base, all empty: `writeStatus` status vocabulary (`STATUS VOCAB IDENTICAL`), the `switch (args.subcommand)` case set (`SUBCOMMAND SET IDENTICAL`), `fail(..., <code>)` signatures (`EXIT CODE SIGNATURES IDENTICAL`), and `io?.out|err` call count (`IO SINK CALL COUNT IDENTICAL`); `PR_REVIEW_HELP` and the `emit` payloads are untouched context in the diff. No-force-push retained: `packages/app/src/services/pr-review/index.ts:656` is a bare `runOk(rt, ['git', 'push'], …)`, and the only `--force` is the `request` dedupe at `:729`. Credentials stay out of diagnostics: the change adds no logging, `rg -n "process\.env"` in the source → 0 hits, and the env is only handed to the child at `:133`. Regression suites green (re-run below): 72 pass / 0 fail incl. the 0771/1161 head-pin and exit-code suites, 6 pass / 0 fail in the CLI wrapper. |
| R4 | MET | Two real throwaway repositories + a fake `gh` on PATH: `packages/app/tests/services/pr-review/pr-review.test.ts:1219-1370` (root, branch, env marker via `nameWithOwner`, relative + absolute status placement, consecutive A/B invocations, non-git refusal, process cwd/env unchanged, default runner, context-bound runner) and `apps/cli/tests/commands/builder/pr.test.ts:47-169` (context repo instead of the process checkout, per-invocation binding, non-git refusal with `not a git repository`). The fake `gh` handles only `auth status` / `repo view` and exits 1 otherwise, so no PR comment, push or network call can occur; only `preflight` (read-only) is driven. No new verbs (case set identical) and no new config keys — the diffstat is the 4 files above. |
| AC R5 scenario | MET | Repo B owns every external command (R1 evidence; plus this review's logging-fake-`gh` run of `request`: 7/7 calls cwd = context repo, env marker = context env). Relative status under B and absolute path preserved (R2). Non-git directory refuses instead of inspecting repo A (`pr.test.ts:159-169`, `pr-review.test.ts:1336-1347`). Process cwd/env unchanged after success and failure (`pr-review.test.ts:1348-1357`; re-confirmed by the independent run). Consecutive A/B invocations share no context (`pr-review.test.ts:1321-1335`, `pr.test.ts:152-158`). Existing head-pin/output/exit-code suites green. |

##### Dimension verdicts

| Dimension | Verdict | Note |
| --- | --- | --- |
| Functional traceability | PASS | R1–R4 MET with file:line anchors; the one gap is test coverage of the AC's mutation-op clause, filed as F1 (P3, deferred) with the behaviour verified here. |
| Correctness | PASS | Single runner seam threaded as the first argument through every git/gh primitive and subcommand (26/26 call sites); `writeFailureStatus` and `requireExpectedHead` write through the same context-rooted writer; absolute paths unchanged by `resolve`; no `process.chdir`/env rewriting. |
| Security | PASS | No new input surface, no credential logging, env handed to the child only; the caller env *narrows* what a child sees vs the previous process-env pass-through, and no privileged path is added; the no-force-push guarantee is untouched (`:656`). |
| Efficiency | PASS | One closure + one status-writer closure per invocation (no per-operation runner duplication); `spawnSync` call count per op is unchanged — the diff only rebinds cwd/env on the existing call. |
| Usability | PASS | No CLI-visible change: same subcommands, flags, help text, status words and exit codes (mechanical diffs); the new context parameter is optional and internal to the app module. |
| Architecture | PASS | The design's rejected patterns are absent (no `process.chdir`, no temporary env rewriting, no git-only `-C` patch, no per-op runners); cwd/env are invocation-local (`:168`, `:957`), the type is narrow and optional (`:114`), and the CLI→app hand-off follows the repo's existing `{ cwd: context.cwd, env: context.env }` idiom (`rg` → 18 sibling call sites). F2/F3 record the two remaining module-level mutable seams as accepted. |

##### Verification evidence (fresh, this review run)

- `git diff --stat 5b8de3478 -- apps/cli/src/commands/builder/pr.ts apps/cli/tests/commands/builder/pr.test.ts packages/app/src/services/pr-review/index.ts packages/app/tests/services/pr-review/pr-review.test.ts` → 4 files, +513/−147 (no other file in the 1215 scope; `docs/tasks5/1215…md` carries the Solution).
- `(cd packages/app && bun test tests/services/pr-review/pr-review.test.ts)` → **72 pass / 0 fail**, 251 expect() calls (includes the 1215 block and the 0771/1161 head-pin suites).
- `(cd apps/cli && bun test tests/commands/builder/pr.test.ts)` → **6 pass / 0 fail**, 19 expect() calls.
- Coverage of the changed sources: `bun test --coverage` → `packages/app/src/services/pr-review/index.ts` 98.46% funcs / **100% lines**; `apps/cli/src/commands/builder/pr.ts` **100% funcs / 100% lines** (task Verification floor is 90%).
- Vocabulary/behaviour preservation diffs (base vs worktree): status words, subcommand case set, `fail(…, n)` signatures, `io?.out|err` count — all identical.
- Static absence checks: `rg -n "chdir"` / `rg -n "process\.env\[|process\.env\.[A-Za-z_]+ *="` over the two changed source files → 0 hits; `rg -n "\b(run|runOk)\(\s*\["` → 0 hits (no context-less runner call).
- Independent re-derivation (`bun` fixture under `/tmp`, two throwaway repos + a `gh` shim that appends `$PWD` and the env marker to a log): `preflight` with `{cwd: repoB}` → `repoRoot` = repoB, `branch` = `feat/b`, `nameWithOwner` = `octo/marker-b`, `repoB/ok.status` = `PASS`; non-git context cwd → exit 2 and **`fail.status` = `FAIL` under that context cwd** (failure path); absolute `--status-file` unchanged; **`request` (mutation-capable) → 7/7 `gh` calls with cwd = repoB and env marker `marker-b`, `repoB/req.status` = `REQUESTED`**; no-context `preflight` → runs in the process checkout (pre-1215 default); `process.cwd()` and the process env unchanged after all runs.

##### Evidence gaps / assumptions

- The external repro cited by the task (`.spur/run/dev-review-2026-10-15/repro-pr-cwd.json` + `repro-pr-cwd.ts`) no longer exists on disk, so it could not be replayed. The regression is instead evidenced statically (base `spawnSync` had no `cwd`) and empirically (a context-less preflight resolves the process checkout, which is what the new `repoRoot === repoB` assertions would have caught).
- The two "process env unchanged" assertions are inherently weak positive checks (the fixture pre-seeds the fake-gh PATH), so I additionally read the implementation: no `process.env` write exists in either changed source file (`rg` → 0 hits), which is what makes the guarantee structural.
- `/tmp/r1215` fixtures used for the independent runs held throwaway git repos and a shell `gh` shim only; no real network, push, PR or comment was issued in any run.

**Next:** proceed to verify; F1 is a deferred test-hardening residual for the record stage, F2/F3 are accepted advisory observations on unchanged seams.

### References

Feature A91 R5/R7; `apps/cli/src/commands/builder/pr.ts:24`; `packages/app/src/services/pr-review/index.ts:112`; `packages/app/src/services/pr-review/index.ts:216`; `apps/cli/tests/commands/builder/pr.test.ts`; `packages/app/tests/services/pr-review/pr-review.test.ts`. External evidence: review scratch `.spur/run/dev-review-2026-10-15/repro-pr-cwd.json` and `repro-pr-cwd.ts`; rerun with `bun .spur/run/dev-review-2026-10-15/repro-pr-cwd.ts`. Only the git-root lookup is real; all gh commands/mutations are stubbed.

### History

- 2026-10-16T03:44:30.912Z todo → wip (system)
- 2026-10-16T04:04:24.601Z wip → testing (system)
- 2026-10-16T04:08:02.561Z testing → done (system)

