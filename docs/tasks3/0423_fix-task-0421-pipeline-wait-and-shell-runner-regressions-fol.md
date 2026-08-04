---
template: meta
schema_version: 1
name: "Fix task-0421 pipeline-wait and shell-runner regressions: --follow polling + /bin/sh -c guard"
description: ""
status: backlog
type: meta
profile: standard
feature_id: D
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
created_at: "2026-08-03T23:27:07.797Z"
updated_at: "2026-08-04T00:12:22.587Z"
---

## 0423. Fix task-0421 pipeline-wait and shell-runner regressions: --follow polling + /bin/sh -c guard

### Background
Task 0421 (fine-tune workflow execution progress logging) took a full day across two OMP sessions
and ended at `testing`. Forensic analysis of the 14:02 and 20:37 session logs identified bottlenecks
worth roughly 200 min of wall-clock waste, dominated by how the driving agent waits on the async
task-pipeline and by one silent correctness regression.

#### Root causes

**RC1 — shell-runner `/bin/sh -c` regression (highest signal, 87 min).** The new
`StreamingShellActionRunner` treated `command` as a single executable instead of a `/bin/sh -c`
line, silently breaking every bare shell command containing a space (`sleep 30` was spawned as a
program literally named `sleep 30` and failed instantly with a null exit code). The engine's own
`ShellActionRunner` documents this exact semantic — and its docstring even calls the direct-spawn
form "the old behavior" it had already fixed — so the override re-introduced a bug the engine had
retired. Diagnosis cost 87 min of git-worktree baselines and direct execa/ts-runtime probes because
nothing pinned the semantics. **The fix and its regression tests have since landed** (see R1/R2).

**RC2 — pipeline-wait (~110 min).** The driving agent launched `workflow run … --async` then polled
`workflow trace` in a loop with `sleep` escalating from 1s to 300s: 47 sleep calls totalling
109.7 min across 6 poll episodes, plus 55 trace polls. The CLI already ships
`spur workflow trace --follow`, which replays a run and polls persisted state until terminal — one
blocking call. The polling loop reinvented it badly. **This is the only open work in this ticket**
(R3).

**RC3 — idle subagent wait (~258 min, advisory only).** In the 14:02 session, 258.7 of 299 min were
gaps >5 min spent blocking on pipeline subagent stages. This is largely inherent to the pipeline
model and is **not** tracked as a requirement here — it is recorded for context, and the practical
mitigation is RC2's `--follow` plus batching independent work. No AC covers it deliberately.

#### Scope note

Requirements are ordered by what remains, not by original discovery order: R1 and R2 are already
satisfied in the working tree and are listed so the guards are not silently dropped; R3 is the only
open item.

#### Related but out of scope

The working tree also carries a change to `config/workflows/idea-pipeline.yaml` dropping `--strict`
from four `ac-generate` transition guards. That change is **correct and unrelated to 0421's logging
work**: `--strict` elevates warnings to failures, and before `decompose`/`batch-create` a feature has
acceptance scenarios but zero linked tasks, which emits `L4.orphan-scenarios` at severity `warning`
by design ("a feature legitimately precedes full decomposition"). With `--strict` the success edges
out of `ac-generate` could never fire while the retry/fail edges always did, so the pipeline looped
three times into `failed`. Error-severity L3 BDD checks still gate malformed AC without it. It
belongs in its own commit, not in 0421's and not in this ticket's.
### Requirements
Two of the three requirements below are **already satisfied in the working tree** — this ticket
exists to pin them with durable guards and to land the one piece of guidance that is still missing.
Status is called out per requirement so the implementer does not redo landed work.

- [x] R1. `StreamingShellActionRunner` preserves the engine's `ShellActionRunner` shell semantics: a bare `command` (no explicit `args`) runs via `/bin/sh -c <command>`; explicit `args` runs `command` directly. **DONE** — `packages/app/src/workflow/actions/shell.ts:48-49` computes `usesShell = explicitArgs.length === 0` and spawns accordingly, byte-identical in logic to the engine's runner. Both paths are pinned by regression tests: `packages/app/tests/workflow/actions/shell.test.ts:58-59` asserts `/bin/sh` + `['-c', …]` for the bare form, and `packages/app/tests/workflow/actions/shell.test.ts:117-119` asserts the direct form. No further code change required.
- [x] R2. The shell-override site documents the engine as the semantic source of truth, so the next editor mirrors it rather than re-deriving it. **DONE** — `packages/app/src/workflow/actions/shell.ts:44-47` carries the comment naming `ShellActionRunner` and the shell-feature rationale.
- [ ] R3. The pipeline-driving reference instructs the driver to observe an async run with a single blocking `spur workflow trace <run-id> --follow` call rather than a manual `sleep N && workflow trace` polling loop, and to treat `--follow` as the default wait mechanism. **OPEN** — the guidance does not exist yet. It belongs in `plugins/sp/skills/spur-dev/references/execution-workflow.md` (the authoring source). Do **not** edit the generated copies under `.rulesync/` — those are regenerated by `superskill install` and hand edits are lost.
### Acceptance Criteria
```gherkin
Feature: Task-pipeline and shell-runner efficiency/regression guards

  @core
  Scenario: R1 — A bare shell command runs via /bin/sh -c
    Given a workflow shell action declares a bare command with no explicit args
    When StreamingShellActionRunner executes it
    Then the spawned program is /bin/sh with args -c and the command line
    And a command with explicit args spawns that command directly with no shell
    And a regression test asserts both spawn shapes

  @core
  Scenario: R2 — The override site names the engine as its semantic source
    Given a developer opens the streaming shell action runner
    When they read the command and args handling
    Then a comment at that site names the engine's ShellActionRunner as the semantics being mirrored
    And it states why a bare command needs a shell

  @core
  Scenario: R3 — The pipeline-driving reference prescribes --follow over sleep-polling
    Given the spur-dev pipeline-driving reference is read by a driving agent
    When the reference describes how to observe an async workflow run
    Then it instructs the driver to use a single blocking workflow trace --follow call
    And it explicitly warns against a manual sleep-and-poll loop
    And the guidance lives in the authoring source under plugins/sp, not a generated .rulesync copy
```
### Q&A
Q: Why does the pipeline-wait bottleneck cost so much?
A: The task-pipeline runs `--async` and each `agent.run` stage spawns a separate omp subprocess taking ~5-10 min. The main agent's only job during that wait is observing progress, but it reimplemented polling with escalating `sleep` (1s→300s) instead of using the CLI's `workflow trace --follow`. Across 6 poll episodes in the 20:37 session this burned ~110 min.

Q: Is `workflow trace --follow` actually available?
A: Yes — `spur workflow trace --follow` replays a run timeline and polls persisted state until it becomes terminal. It is the intended single-call wait. The fix is guidance: the driver should prefer it over manual sleep-polling.

Q: Why is R2 (the /bin/sh -c split) higher-signal than pipeline-wait?
A: Because it silently broke correctness: bare `command: "sleep 30"` was spawned as a single executable named `sleep 30` and failed instantly (exit null), yet the baseline engine ran it via `/bin/sh -c` and passed. It cost 87 min to diagnose because the override didn't mirror the engine's documented semantics and no test pinned it.

Q: Is R2 already fixed in the current tree?
A: The fix itself landed (shell.ts now spawns `/bin/sh -c` for bare commands) and the CLI workflow test passes. R2's remaining work is the durable regression guard and ensuring the semantics are documented at the override site.

Q: Should the fix be a hook or guidance?
A: Guidance (R3) plus a code-level regression test (R2). A hook forcing "read engine host first" would be overbearing; the concrete, verifiable guard is the `/bin/sh -c` regression test. B1 is pure guidance (use --follow).

Q: What is the expected time saving?
A: ~110 min per pipeline-driven session from B1; 87 min one-time from B2's diagnosis (prevented from recurring by the regression test). Combined ~3.3h of the ~7.7h across the two sessions.
### Design
Fix design per root cause. RC1 and RC2 map to R1/R2 (landed); RC3 maps to R3 (open).

#### RC1 — shell-runner `/bin/sh -c` (landed, keep the guard)

Evidence: 65 bash calls over 21:08–22:35 building git-worktree baselines under `/tmp/spur-baseline`
plus direct execa and ts-runtime probes, all to explain why a bare `command` failed instantly with a
null exit code while the same workflow passed on the engine's own runner.

Root cause: the override called `runStreaming({ command: 'sleep 30' })`, spawning a program whose
name contained a space, where the engine's `ShellActionRunner` runs bare commands through
`/bin/sh -c`.

Fix (applied): `packages/app/src/workflow/actions/shell.ts:48-49` computes
`usesShell = explicitArgs.length === 0` and spawns `/bin/sh -c <command>` or `command <args>` —
logic identical to the engine's. Guarded by `packages/app/tests/workflow/actions/shell.test.ts`,
which asserts the `/bin/sh` spawn shape for the bare form and the direct spawn for the args form.

**Do not remove either assertion.** They are the only thing preventing a silent re-break; the
failure mode produces no error at the action layer, just a null exit code, so a regression surfaces
as an unexplained workflow failure hours later.

#### RC2 — override site documents its source (landed)

`packages/app/src/workflow/actions/shell.ts:44-47` names the engine's `ShellActionRunner` and states
why a bare command line needs a shell. This is what turns "mirror the engine" from tribal knowledge
into something the next editor reads before changing the spawn logic.

#### RC3 — pipeline-wait guidance (open, the only work left)

Evidence: 47 `sleep` calls totalling 109.7 min, 55 `workflow trace` calls, 6 poll episodes — the
largest 17.7 min with sleeps of 240/240/300/280s, another 16.8 min with 240/290/240/240s, all
polling one run.

Root cause: the driver reimplemented polling with escalating `sleep` instead of using the blocking
`workflow trace --follow` the CLI already provides.

Fix: add guidance to `plugins/sp/skills/spur-dev/references/execution-workflow.md` — after launching
with `--async`, observe via a single `spur workflow trace <run-id> --follow` call, which polls
persisted state until the run is terminal; a manual `sleep N && workflow trace` loop is the
anti-pattern it replaces. Guidance only: a hook forcing the behaviour would be overbearing, and the
concrete verifiable guard for the correctness half already exists as the RC1 regression test.

**Authoring source only.** The `.rulesync/skills/sp-spur-dev/references/…` copies are generated by
`superskill install`; hand edits there are silently overwritten on the next install.

#### What worked well — preserve it

Restoring the `/bin/sh -c` semantics brought the CLI workflow suite back to green (71 tests) and the
full monorepo suite and `spur-check` rules passed after the fix. The regression tests and the
`--follow` guidance are the durable residue worth keeping from this investigation.
### Plan
1. **R1 / R2 — confirm, do not redo.** Both landed. Verify with
   `bun test packages/app/tests/workflow/actions/shell.test.ts` and confirm the two spawn-shape
   assertions still pass. If they do, R1 and R2 need no code change.
2. **R3 — add the `--follow` guidance.** Edit
   `plugins/sp/skills/spur-dev/references/execution-workflow.md` (the authoring source). State that
   after launching a run with `--async`, the driver observes it with a single blocking
   `spur workflow trace <run-id> --follow` call, and that a manual `sleep N && workflow trace` loop
   is the anti-pattern it replaces. Keep it short — this is guidance, not a runbook.
3. **Do not touch `.rulesync/`.** The generated per-platform copies of that reference are produced by
   `superskill install`; edits there are overwritten. Authoring source only.
4. **Verify.** `bun test packages/app/tests/workflow/actions/shell.test.ts`, then the CLI workflow
   suite, then `spur task check 0423`.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session logs: `~/.omp/agent/sessions/home-spur-new-dcc…/2026-08-03T14-02-17-536Z…jsonl` (task 0420/0421, 299 min), `…/2026-08-03T20-37-25-197Z…jsonl` (task 0421 R9, 166 min, 287 bash calls).
- Source/agent: omp.
- Engine shell semantics: `ShellActionRunner` in the `@gobing-ai/ts-dual-workflow-engine` package's `src/host.ts` — the authority the override mirrors.
- Fix site: `packages/app/src/workflow/actions/shell.ts` (spawn split at lines 48-49; rationale comment at 44-47).
- Regression tests: `packages/app/tests/workflow/actions/shell.test.ts` (bare form at 58-59, direct-args form at 117-119).
- Pipeline-driving reference to edit (R3), **authoring source**: `plugins/sp/skills/spur-dev/references/execution-workflow.md`. The `.rulesync/skills/sp-spur-dev/references/…` copies are generated by `superskill install` — never hand-edit them.
- Pipeline: `.spur/workflows/task-pipeline.yaml`; run `9c0a707d` failed at verify.
- Parent work: task 0421 (the logging change whose session produced these findings).
### History
### Notes

- RC1: pipeline-wait — 109.7 min sleep / 55 trace polls; use `workflow trace --follow`.
- RC2: shell-runner /bin/sh -c — 87 min diagnosis; engine `ShellActionRunner` (ts-dual-workflow-engine/src/host.ts) runs bare `command` via `/bin/sh -c`; override must mirror and pin with a test.
- RC3: idle subagent wait — 258.7 min idle in 14:02 session; advisory.
- B4 (test-loop): folded into RC2 verification; targeted runs preferred over flag-variant re-runs.

