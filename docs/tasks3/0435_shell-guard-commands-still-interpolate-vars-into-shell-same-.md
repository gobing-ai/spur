---
template: issue
schema_version: 1
name: "Shell guard commands still interpolate vars into shell - same injection class as 0432"
description: ""
status: done
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T19:44:59.634Z"
updated_at: "2026-10-03T15:44:00.310Z"
---

## 0435. Shell guard commands still interpolate vars into shell - same injection class as 0432

### Background



### Requirements
Task 0432 removed shell interpretation of var content from workflow shell **actions** by exporting
`context.vars` as process environment (`packages/app/src/workflow/actions/shell.ts:51-67`). Shell
**guards** (`transitions[].guard` with `kind: shell`) were explicitly left untouched and recorded in
0432's Solution as out of scope. They still embedded resolved var values directly into the command
string, so the identical injection class remained live until this task.

Measured on the tree at 2026-08-04 (pre-fix vs post-fix):

| Shell command site | Count | Residual `${vars.*}` |
|---|---|---|
| Actions (`onEnter` / `onExit`) | 41 | **0** — fixed by 0432 |
| Guards (`transitions[].guard`) | 86 | **0** — fixed by 0435 (was 86 pre-migration) |

Vars reaching guards, all operator-supplied via `--vars` or a `/sp:dev-*` wrapper:
`approval`, `design`, `design_approved`, `feature`, `featureId`, `idea_approved`, `merge`, `profile`,
`qualityGateMaxFixAttempts`, `spurBin`, `tasks`, `wbs`, plus engine-owned `__hitlAnswer` / `__runId`.

`tasks` is the sharpest edge: `/sp:dev-runall --tasks <selector>` puts a JSON-encoded WBS list into a
var that lands inside a double-quoted shell word, which is exactly the break-out-of-quoting case.

Requirements:

- [x] R1. A var value reaching a shell **guard** is evaluated as data — backticks, `$(...)`, quotes
      and backslashes in the value must not execute, and must not alter which transition is taken
      beyond the intended string comparison.
- [x] R2. Fix at the shared guard-evaluation mechanism, not per workflow file. Establish first
      whether guard evaluation lives in Spur or in `@gobing-ai/ts-dual-workflow-engine`; if upstream,
      the fix is an engine change (or a Spur-side guard runner registration), not 86 YAML edits.
- [x] R3. Guard semantics are preserved: every existing transition still fires on the same inputs.
      The 86 guard commands are the regression surface — a behavior change here silently reroutes
      every pipeline.
- [x] R4. A regression test at the guard mechanism proves a metacharacter-bearing var cannot execute,
      mirroring `packages/app/tests/workflow/actions/shell.test.ts` for the action path.
- [x] R5. If the migration changes guard authoring (`${vars.NAME}` → `$NAME`), update the workflow
      authoring reference so new workflows are written the safe way, and state the rule for guards
      and actions side by side.
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
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Guard-specific conditions (not feature scenarios — D3's AC predates this finding):**

- A guard whose command embeds a var carrying a backtick or `$(...)` does not execute that content;
  a probe equivalent to the 2026-08-04 reproduction creates no marker file.
- All 86 existing guard commands under `config/workflows/` still select the same transitions for the
  same inputs — verified by the workflow suites, not by inspection.
- The fix is located at the shared guard-evaluation mechanism; if that mechanism is upstream in
  `@gobing-ai/ts-dual-workflow-engine`, the resolution is recorded as an engine change or a
  Spur-side guard runner, and the decision is written down either way.
- A regression test exists at the guard mechanism proving the metacharacter case, sibling to
  `packages/app/tests/workflow/actions/shell.test.ts`.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Spur-side env-var shell guard runner (`EnvShellGuardRunner`), registered by kind on both the
production host (`registerSpurBuiltins`) and the lifecycle host (`LifecycleAdapter`), plus YAML
migration of all 86 shell-guard `command:` lines from `${vars.X}` to `$X`. Engine template
pre-resolution is left alone; safety is env handoff + authoring rule (same shape as 0432 for actions).
### Plan
- [x] Locate guard evaluation (Spur vs engine) and choose Spur-side registration
- [x] Implement EnvShellGuardRunner + register on production and lifecycle hosts
- [x] Add guard-mechanism regression tests (metacharacter + transition semantics)
- [x] Migrate 86 guard commands `${vars.X}` → `$X` under config/workflows/
- [x] Document `$NAME` rule for guards and actions in authoring reference
- [x] Re-verify live probes + residual scan + workflow validate
### Root Cause
Proven live on 2026-08-04 during the `/sp:dev-verify 0432 --force` re-audit, on the tree with 0432
already merged and `done`.

Probe workflow — one transition whose guard compares a var:

```yaml
transitions:
  - from: start
    to: done
    guard:
      kind: shell
      options:
        command: 'test "${vars.probe}" = PASS'
```

Run with a backtick payload in the var:

```
$ spur workflow run .spur/tmp-guard-probe2.yaml \
    --vars '{"probe":"x`touch .spur/GUARD_INJECTION_MARKER`"}'
workflow done: guard-injection-probe -> failed

$ ls .spur/GUARD_INJECTION_MARKER
.spur/GUARD_INJECTION_MARKER      ← created
```

The marker file was created, so the backticked command executed. The guard itself evaluated false
(the comparison failed, routing to `failed`) — which is the dangerous shape: **the side effect fires
while the guard reports a normal negative result**, so nothing in the run output signals that
anything ran. The action-path equivalent at least produced visible stderr noise.

Probe artifacts were removed after the run; nothing persists in the tree.

Contrast — the same payload through a shell *action* is inert after 0432:
`packages/app/tests/workflow/actions/shell.test.ts:248-257` asserts a value carrying backticks,
`$(...)`, quotes and backslashes is observed literally with no second process spawned.
### Solution
**Status: DONE** — shared guard runner + 86-line YAML migration + authoring rule landed and re-verified 2026-08-04.

**R2 — Spur-side, not upstream.** The engine exposes `host.registerGuard` and `GuardContext.vars`. Its default `ShellGuardRunner` spawns `/bin/sh -c` with no `env` (pre-0432 shape). No engine change required.

**Landed**

- `packages/app/src/workflow/guards/shell.ts:38-67` — `EnvShellGuardRunner`: merges `{ ...process.env, ...context.vars }` into the subprocess env; mirrors engine spawn semantics (explicit `args` → program; bare `command` → `/bin/sh -c`) and `{ passed, report }` shape.
- `packages/app/src/workflow/builtins.ts:53-56` — `host.registerGuard(new EnvShellGuardRunner(...), 'builtin')` replaces the engine's `shell` guard by kind on the production host.
- `packages/app/src/workflow/lifecycle-adapter.ts:111-116` — same registration on the lifecycle host (without it, migrated `$featureId` expands empty and every transition denies — caught by feature-lifecycle-adapter tests).
- `packages/app/tests/workflow/guards/shell.test.ts:21-88` — regression suite (env handoff, exit→passed, metacharacter literal, no transition flip).
- `config/workflows/*.yaml` — **86** shell-guard `command:` lines migrated `${vars.X}` → `$X` across 10 files; residual scan **0**. Action `command:` residual remains **0** (0432).
- `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:160-187` — authoring rule: shell actions and guards use `$NAME`; everything else may use `${vars.NAME}`.

**Live proof (source CLI, this verify)**

| Form | Result |
|---|---|
| `test "$probe" = PASS` + backtick payload | **SAFE** — no marker file |
| `test "${vars.probe}" = PASS` + same payload | **INJECTS** — engine pre-resolution residual (forbidden by authoring rule; corpus has zero) |
| `test "$profile" = auto` with `auto` / `standard` | `done` / `failed` — semantics preserved |

**Not done / out of scope**

- Engine template pre-resolution of `${vars.*}` into shell command strings is unchanged; safety is env handoff + authoring/migration, not engine surgery.
- Packaged global `spur` must be rebuilt/published to pick up the runner (workspace source is authoritative).
### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `EnvShellGuardRunner.evaluate` passes vars as env (`{ ...getEnvVars(), ...context.vars }`), commands reference `$NAME` — `packages/app/src/workflow/guards/shell.ts:39-62` (re-read this run); metachar-payload literal-observation test in guard suite (8 pass, 0 fail this run). |
| R2 | MET | Spur-side shared mechanism: `EnvShellGuardRunner` registered at `packages/app/src/workflow/builtins.ts:92` and `packages/app/src/workflow/lifecycle-adapter.ts:168` — no upstream engine change needed (host guard registry is kind-keyed). |
| R3 | MET | Guard semantics preserved: runner mirrors engine spawn semantics exactly (`shell.ts:46-49` comment); zero residual `${vars.*}` in any `command:` line across `config/workflows/*.yaml` (grep this run: 0 matches). |
| R4 | MET | `packages/app/tests/workflow/guards/shell.test.ts` — 8 pass, 0 fail, 22 expect() this run (metachar literal, no transition flip, env handoff). |
| R5 | MET | Authoring rule § "Shell commands take vars by name, never by template" at `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:160` (re-read this run). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — a workflow var carrying shell metacharacters is treated as data | MET | test | Guard-twin closure: guard suite metachar test passes this run (8/8); action twin closed by 0432. |
| Scenario: R8 — each defect is covered at the shared mechanism | MET | test | Guard mechanism suite `packages/app/tests/workflow/guards/shell.test.ts` — mechanism-level, not single-workflow. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
**Disposition:** Approve — injection closed for migrated corpus; residual is authoring-discipline only.

**SECUA findings (P1–P4)**

| Sev | Dim | Finding | Location | Disposition |
|-----|-----|---------|----------|-------------|
| P4 | S | Engine still pre-resolves `${vars.*}` into guard command strings; old authoring form remains injectable | engine template path (pre-runner) | Documented; corpus has 0 residual; R5 authoring rule |
| P4 | U | Packaged global `spur` binary predates EnvShellGuardRunner — live `$NAME` guards fail closed (empty expand) until rebuild | `~/.bun/bin/spur` vs workspace source | Operational note; not a code defect |
| — | E | No efficiency concern | — | n/a |
| — | C | Semantics preserved (`auto`/`standard`); dual host registration prevents empty-expand deny | `packages/app/src/workflow/builtins.ts:56`, `packages/app/src/workflow/lifecycle-adapter.ts:116` | OK |
| — | A | Mirrors 0432 action handoff; kind-keyed host replace is the right seam | `EnvShellGuardRunner` | OK |

**Functional:** R1–R5 MET with live + unit evidence (see Testing).

**Architecture:** Spur-side guard runner + YAML `$NAME` migration is the minimal correct fix; no engine fork required.

**Residual risk:** Low — only if a future workflow reintroduces `${vars.X}` in a shell guard/action command.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-04T19:56:32.066Z todo → wip (system)
- 2026-08-04T20:24:37.367Z wip → testing (system)
- 2026-08-04T20:24:41.456Z testing → done (system)
