---
template: issue
schema_version: 1
name: "Workflow var interpolation into shell action commands executes as shell"
description: ""
status: done
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.672Z"
updated_at: "2026-08-18T04:42:48.455Z"
---

## 0432. Workflow var interpolation into shell action commands executes as shell

### Background



### Requirements
Workflow `var` values are interpolated verbatim into `shell` action command strings, so any shell
metacharacter inside a var executes as shell in the action's subprocess. `.spur/workflows/idea-pipeline.yaml`
interpolates the operator-supplied idea text straight into a command:

```yaml
if [ "$doctor_rc" -eq 0 ] && test -n "${vars.idea}"; then
```

The value lands inside a double-quoted shell word, where backticks and `$(...)` still expand. An idea
containing either executes arbitrary commands with the workflow runner's privileges; an idea
containing a bare `"` breaks out of the quoting entirely and can append further commands.

This is not confined to `idea-pipeline.yaml` — it is a property of how the shell action composes
commands from resolved template vars, so every workflow that interpolates a var into a `shell`
action's `command` shares it. Vars routinely carry operator free text (`idea`), agent-authored
content, and file-derived values.

Beyond the security exposure, the failure is silent and misattributed: the injected commands write
their own noise to stderr while the intended command's real work (here, writing a gate's status
file) is skipped, so the workflow then fails a downstream guard for a reason unrelated to the
actual cause.

Fix by removing shell interpretation of var content: pass resolved vars to the shell action as
environment variables referenced by name in the command, or escape values at interpolation time.
Prefer the env-var handoff — escaping is a recurring source of near-misses. The remediation must
cover the shell action itself, not only the one workflow where it was first observed; auditing
existing workflow YAMLs for interpolated vars is part of the work.
### Acceptance Criteria
```gherkin
Feature: Workflow var interpolation into shell actions is data, not code

  @core
  Scenario: R3 — a workflow var carrying shell metacharacters is treated as data
    Given a workflow whose shell action interpolates a var into its command
    When the run supplies a value containing backticks, command substitution, quotes and backslashes
    Then the command observes the value literally
    And no additional process is spawned from the value's content
    And the action's own writes and exit status match the inert-text case

  @core
  Scenario: R4 — shell interpolation cannot silently mask a gate
    Given the idea-pipeline start state whose shell action writes a doctor status file
    When the run is started with an idea containing Markdown backticks around file paths
    Then the status file is written with the correct verdict
    And the step terminates rather than hanging in-flight

  @core
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Audit obligation (not a scenario):** every var reference inside a `shell` action `command` across
`config/workflows/` must reach the command through the safe handoff — the fix belongs to the shell
action, not to the one workflow where it was first observed.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause
Reproduced live on 2026-08-04, run `941bf031-fc7b-4011-ab1c-975ddc6014e2`.

An `idea-pipeline.yaml` run was launched with an idea containing ordinary Markdown backticks — file
paths and identifiers in prose, e.g. `` `.spur/run/<runId>-output.log` ``. The `start/shell` action
executed roughly forty injected commands. Representative stderr from the run:

```
stderr> /bin/sh: RunOutputSink: command not found
stderr> /bin/sh: packages/app/src/observability/run-output-sink.ts:51: No such file or directory
stderr> /bin/sh: agent.run: command not found
stderr> /bin/sh: .spur/config.yaml: Permission denied
stderr> /bin/sh: command substitution: line 0: syntax error near unexpected token `newline'
stderr> trace: illegal option -- -
```

Each backticked span became a command substitution; `<runId>` inside those spans became shell
redirection. No destructive command happened to be present in the prose — `git status` and a
scan of the repo root confirmed no file was created, truncated, or modified — but nothing about the
mechanism prevents one. Prose that merely mentions a command would run it.

Second-order effect that made the cause hard to see: the mangled command never reached its
`printf 'PASS' > "$DOCTOR_FILE"` branch, so
`.spur/run/941bf031-...-idea-precheck-doctor.status` was never written, and the step then hung
in-flight rather than failing with a message naming the interpolation.

Confirmed as the mechanism by re-running the identical pipeline with backticks, `$`, `"` and `\`
stripped from the idea text: run `ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef` executed `start/shell`
cleanly in 1s with the doctor status file written as intended.
### Solution
**Fix.** Env-var handoff for shell actions (task 0432): workflow vars are exported as process environment, so shell commands reference them by name (`$idea`) and their content is treated as data, not re-parsed as shell code.

**Core mechanism.** `packages/app/src/workflow/actions/shell.ts:51-67` — `StreamingShellActionRunner.execute` now passes `context.vars` (merged over the inherited `process.env`) to the subprocess via `runStreaming({ env })`. Because a shell variable-expansion result is never re-parsed for metacharacters, a var carrying backticks / `$()` / quotes / backslashes is observed literally. The engine still pre-resolves `${vars.*}` in every option before an action sees it, so shell commands must reference vars as `$NAME` — never `${vars.NAME}` in a command.

**Workflow audit (config/workflows/ — all 8 files with shell-action var refs).** Migrated every `- kind: shell` **action** `command:` from `${vars.NAME}` to `$NAME`:
- `idea-pipeline.yaml` (start doctor, ac-generate x2, decompose, batch-create-run, handoff)
- `task-pipeline.yaml` (precheck, implement x2, test, test-fix, test-recheck, verify, record x2, done x2)
- `basic.yaml` (implement, check, fix)
- `docs-pipeline.yaml` (precheck, draft, record, done x2)
- `feature-dev.yaml` (precheck, done)
- `planning-pipeline.yaml` (start, feature-id, handoff)
- `wayfinder-resolution.yaml` (precheck, collect x3, verify, record x2)
- `wrapup-pipeline.yaml` (feature-transition, done)

`.spur/workflows/*.yaml` are hardlinks to the same inodes, so the runtime read path is covered by the same edit. Shell **guards** (`guard:` `kind: shell`) are a separate engine mechanism and were left untouched (out of scope per AC — "the shell action"). Non-shell actions (`agent.run`, `note`, `hitl.*`, `file.*`, `rule.check`) keep engine `${vars.*}` resolution, which is safe (not shell-interpreted).

**Regression tests.** `packages/app/tests/workflow/actions/shell.test.ts:221-277` — 3 new tests at the shared mechanism:
1. env-var handoff exports `context.vars` as env (and inherits `process.env`);
2. R3 — a var carrying backticks, `$()`, quotes and backslashes is observed literally by a real shell (`NodeProcessExecutor`), no second process spawned;
3. R4 — a doctor-status write command mirroring the idea-pipeline start action survives a backtick idea, writes the correct verdict, and terminates (no in-flight hang).
### Testing
**Verdict: PASS** (re-audit 2026-08-04, `/sp:dev-verify 0432 --force --focus all --fix all`).

Every requirement and AC row was independently re-run this turn rather than read from the prior
summary.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R3 — workflow var carrying shell metacharacters is treated as data | MET | `packages/app/src/workflow/actions/shell.ts:51-67` re-read at anchor — `context.vars` merged over `process.env`, passed via `runStreaming({ env })`; `packages/app/src/workflow/builtins.ts:49` confirms `StreamingShellActionRunner` is the **registered runtime runner**, so the fix is on the live path |
| R4 — shell interpolation cannot silently mask a gate | MET | `packages/app/tests/workflow/actions/shell.test.ts:260-277` — doctor-status write survives a backtick idea, writes `PASS`, terminates with no in-flight hang |
| R8 — defect covered at the shared mechanism, plus YAML audit | MET | 3 regression tests target shared `shell.ts`, not `idea-pipeline.yaml`; independent YAML re-parse of `config/workflows/` reproduced the claim exactly: **41 action commands, 0 residual `${vars.*}`** |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — metachar var treated as data, no spawned process | MET | test | `shell.test.ts:248-257` — real `NodeProcessExecutor`, payload observed literally, exit 0 (**12 pass / 0 fail** this run) |
| R4 — interpolation cannot silently mask a gate | MET | test | `shell.test.ts:260-277` |
| R8 — covered at shared mechanism | MET | test | all 3 tests target `shell.ts`; `shell.ts` at 100% function + line coverage |
- Coverage: 100% function / 100% line on `packages/app/src/workflow/actions/shell.ts` (guard suite run).

**Claims independently re-verified rather than accepted:**

| Claim | Method | Result |
|---|---|---|
| `.spur/workflows/*.yaml` are hardlinks, so runtime reads the fixed files | `stat -f %i` both paths | Confirmed — same inode |
| The fixed runner is the one actually used | read `packages/app/src/workflow/builtins.ts:49` | Confirmed — registered `shell` runner |
| "41 actions, zero residual" | independent YAML re-parse | Reproduced exactly |

**Prior PARTIAL now cleared.** The first pass of this re-audit returned **PARTIAL** — not for any
requirement or AC failure, but for an unresolved major security finding: the same injection class
remained live in **86 shell guard commands**, proven with a probe whose guard executed a backticked
payload while still reporting an ordinary boolean. That finding is now **resolved**, not merely
tracked:

- `packages/app/src/workflow/guards/shell.ts` — `EnvShellGuardRunner`, the guard-side counterpart to
  this task's action fix, registered in `builtins.ts` and `lifecycle-adapter.ts`.
- All 86 guard commands across 10 workflows migrated `${vars.X}` → `$X`; post-migration scan is
  **41 action / 0 residual and 86 guard / 0 residual**.
- Re-run of the original probe: **no execution** (pre-fix it created the marker).
- Tracked and closed as task **0435** (feature D3), which carries the full evidence.

**SECUA re-review: no unresolved findings.** Security — both injection surfaces closed at shared
mechanisms with regression tests. Correctness — a real regression surfaced during 0435's verification
(`lifecycle-adapter.ts` built a bare engine host, so migrated `$NAME` guards expanded to empty and
denied every transition); found by test, fixed, covered.

**Gate:** `bun run lint` exit 0; `bun run test` **4471 pass / 24 fail**, all 24 in the standing
sandbox network set across the same seven suites, zero non-environmental failures; all 10 workflows
pass `spur workflow validate`.

**Gitignored writes (disclosure).** `.spur/run/0432-verdict.json` (this verdict),
`.spur/run/0432-fix-created.json` (follow-up ledger naming 0435), `.spur/run/0435-verdict.json`.
### Review
**Functional traceability** (requirements gate)

The `## Requirements` section is prose (no numbered R-items); the numbered targets are the AC Gherkin scenarios R3/R4/R8. Every scenario maps to a passing regression test at the shared mechanism, and the prose Requirements obligations (env-var handoff, fix covers the shell action itself, audit all workflow YAMLs) are each met with file:line evidence.

| Req / AC | Status | Evidence |
|----------|--------|----------|
| R3 — metachar var treated as data, no spawned process | MET | `packages/app/tests/workflow/actions/shell.test.ts:248-257` — real `NodeProcessExecutor`, command `printf '%s' "$idea"` observes `` `printf INJECTED` $(printf INJECTED) "dq" \bs `` literally; stdout == value; exit 0. Passed this run (12 pass / 0 fail). |
| R4 — shell interpolation cannot silently mask a gate | MET | `packages/app/tests/workflow/actions/shell.test.ts:260-277` — doctor-status write mirrors idea-pipeline start action; backtick/`$()`/quote idea yields `PASS` in the status file, exit 0, terminates (no in-flight hang). Passed. |
| R8 — defect covered at the shared mechanism, not the single workflow | MET | 3 regression tests all target the shared shell action (`packages/app/src/workflow/actions/shell.ts`), not `idea-pipeline.yaml`. |
| Req: env-var handoff (data, not code) | MET | `packages/app/src/workflow/actions/shell.ts:51-67` — `context.vars` merged over `process.env`, passed via `runStreaming({ env })`; shell var-expansion result is never re-parsed for metacharacters. |
| Req: fix covers the shell action itself, not one workflow | MET | Mechanism lives in the shared `StreamingShellActionRunner`; every `shell` action inherits it. |
| Req: audit existing workflow YAMLs | MET | All 8 `config/workflows/*.yaml` shell action `command:` blocks migrated `${vars.NAME}` → `$NAME`; scripted scan + manual read of every shell-action command block finds zero `${vars.*}` remaining. `.spur/workflows/*.yaml` are hardlinks (same inode) → runtime read path covered. |

**SECUA review**

No blockers. Minor findings:

- **P2/minor — `${vars.*}` in a future shell command silently regresses.** The engine still pre-resolves `${vars.*}` in every option before the action runs (`shell.ts:51-57` comment). A workflow author who writes `${vars.idea}` in a `shell` command reintroduces the exact injection (interpolation into the string, then `/bin/sh -c`). Current YAMLs are clean and documented (`$NAME`-only contract), but there is no enforcement preventing a future regression. Documented, accepted tradeoff.
- **P3/advisory — env collision surface.** `{...process.env, ...context.vars}` lets a workflow-declared var override an ambient env var (e.g. a var named `PATH`/`HOME`). Vars are operator/workflow-authored, not untrusted content, so low risk; internal vars use `__`-prefixed names to avoid collision. No change required.
- **P3/advisory — NUL byte in a var value** would fail the subprocess spawn (POSIX execve limit). Not an injection vector; free-text vars realistically never carry NUL. No action.

**Architecture review**

No deepening candidates. The env-var handoff is the correct seam: the shared `StreamingShellActionRunner` is the single point where vars cross into a subprocess, and passing data as environment (referenced by name) is the deep fix versus per-callsite escaping (recurring near-miss source the task explicitly rejected). Mechanism, audit, and regression tests are co-located at the mechanism — good locality.

**Disposition**

Functional PASS; no SECUA or architecture blockers. Mechanism and tests verified this run: `bun test packages/app/tests/workflow/actions/shell.test.ts` → 12 pass / 0 fail (`shell.ts` 100% line/func); `bun test packages/app/tests/workflow/` → 243 pass / 0 fail; `packages/app` `tsc --noEmit` exit 0.

**Priority findings**

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | — | None | — |
| P2 | `packages/app/src/workflow/actions/shell.ts` (engine option pre-resolution) | Engine still pre-resolves `${vars.*}` in any option; a future `shell` command writing `${vars.idea}` would reintroduce the injection. | Accept: documented `$NAME`-only contract; current YAMLs audited clean. Enforcement out of AC scope. |
| P3 | `packages/app/src/workflow/actions/shell.ts:58` (`{...process.env, ...context.vars}` merge) | Workflow-declared var can override an ambient env var (e.g. `PATH`/`HOME`). | Accept: vars are operator/workflow-authored, not untrusted; internal vars use `__`-prefix to avoid collision. |
| P3 | `packages/app/src/workflow/actions/shell.ts` (env spawn) | NUL byte in a var value fails the subprocess spawn (POSIX execve limit). | Accept: not an injection vector; free-text vars realistically never carry NUL. |
| P4 | — | None | — |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-04T19:26:13.717Z todo → wip (system)
- 2026-08-04T19:40:16.530Z wip → testing (system)
- 2026-08-04T19:40:20.818Z testing → done (system)
