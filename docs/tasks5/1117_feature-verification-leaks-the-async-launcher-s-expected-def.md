---
schema_version: 1
name: feature-verification leaks the async launcher's expected definition digest into verificationCmd
status: done
template: feature-impl
created_at: 2026-10-07T20:52:28.373Z
updated_at: "2026-10-08T17:13:24.946Z"

feature_id: D3
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1117-verdict.json
---

## 1117. feature-verification leaks the async launcher's expected definition digest into verificationCmd

### Background

Found 2026-10-07 while closing features G71 and G31 from the knowledge-kit batch.

`spur workflow run feature-verification.yaml --async` fails every time it is used to verify a repo whose own tests spawn `spur workflow run`.

Observed (knowledge-kit, run 7f82bc1d): the pass reported 4 test failures, all of the same shape:

```
workflow run: refusing to start — resolved definition digest sha256:e8ba2874… differs from the
  expected digest sha256:c08f5366… sent by the async launcher
```

`c08f5366…` is *feature-verification.yaml's own* definition digest. The async launcher's expectation is inherited by the spawned `bun run spur-check`, and from there by the test children that each start a workflow run, so every one of them refuses. Re-running the identical command **foreground** — no async launcher, no injected expectation — passes on the *same* `inputDigest`, proving the tree never changed and the failures were entirely environmental.

Impact: a verification pass reports phantom test failures, and the receipt records FAIL, so `feature check --strict --as done` blocks a feature that is actually green. The failure mode is easy to misread as a real regression in the repo under test.

**Refine corrections (2026-10-07)**

- **Root cause confirmed in the tree.** The launcher `spawnAsyncWorkflowWorker` (`apps/cli/src/commands/workflow.ts:108`) copies the full parent env, sets `SPUR_ASYNC_WORKER='1'` (`:118`), and receives `SPUR_EXPECTED_DEFINITION_DIGEST` from the `run` action (`:790`). The worker reads the digest (`:936`, checked by `expectedDigestMismatch` at `:349`) but never removes either variable. Every child — shell steps, `agent.run`, guards, and any nested `spur workflow run` — inherits both.
- **R3 answered: a second leaking variable exists.** `SPUR_ASYNC_WORKER` is read again at `:1158` (`recordSelfPid`) and `:1425` (`continue` resume owner). An inherited value makes a nested *foreground* run record its own pid as an async worker and claim resume ownership. It did not surface downstream only because the refusal fired first.
- **Precedent to mirror:** `SPUR_WORKFLOW_RUN_ACTIVE` is already cleared through `removeEnvVar` in `clearWorkflowRunActive` (`:100`); the fix uses the same `@gobing-ai/spur-config` env helpers.
- **Out of scope:** `SPUR_RUN_ID` and other lineage variables are inherited on purpose (agent-run lineage). `SPUR_WORKFLOW_RUN_ACTIVE` already has its own guard and test-side scrub.
- **R4 dropped.** A header workaround note is superseded by the fix. Knowledge-kit already carries a downstream strip at its nested-spur boundary (its commit 2aa2ea82); that stays harmless after this lands.
- **R2 sharpened.** The test asserts the child env directly (the two variables are unset inside a step), plus the nested different-definition run, plus a negative check that a genuine mismatch still refuses.

### Requirements

- [x] R1. The async worker consumes `SPUR_EXPECTED_DEFINITION_DIGEST` and `SPUR_ASYNC_WORKER` exactly once, at entry of both the `workflow run` and `workflow continue` actions, and removes both from `process.env` before any state executes, so no step child (shell, `agent.run`, guard, nested `spur`) inherits either.
- [x] R2. The digest check keeps its current behavior for the worker itself: a mismatching expected digest still refuses to start with the existing message.
- [x] R3. Code that currently re-reads `SPUR_ASYNC_WORKER` after entry (`recordSelfPid` in `run`, the resume-owner/`recordSelfPid` branch in `continue`) uses the value captured at entry, so behavior of the async worker itself is unchanged.
- [x] R4. A regression test in `apps/cli/tests/commands/workflow.test.ts` proves a step launched under the async-worker env sees neither variable, and that a nested `spur workflow run` on a different definition completes instead of refusing.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A workflow step started by the async worker does not inherit the launcher's digest or worker flag (req: R1, R3)
  Given `SPUR_EXPECTED_DEFINITION_DIGEST` equals the real digest of a temp workflow and `SPUR_ASYNC_WORKER=1`
  When `spur workflow run <temp workflow>` executes a shell step that writes `${SPUR_EXPECTED_DEFINITION_DIGEST:-unset}` and `${SPUR_ASYNC_WORKER:-unset}` to a file
  Then the run completes and the file reads `unset` for both variables

Scenario: AC2 — A nested workflow run on a different definition completes under the async worker (req: R1, R4)
  Given the same async-worker env and a shell step that runs `spur workflow run <second definition>` with `SPUR_WORKFLOW_RUN_ACTIVE` unset
  When the outer run executes
  Then the nested run exits 0 and its output contains no "refusing to start" digest message

Scenario: AC3 — A genuine digest mismatch still refuses (req: R2)
  Given `SPUR_EXPECTED_DEFINITION_DIGEST` is set to a digest that does not match the resolved definition
  When `spur workflow run <temp workflow>` starts as the worker
  Then it refuses with the existing "differs from the expected digest" message and runs no state
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:24:11.587Z

- **Scrub at the worker entry, not at each child spawn.** One boundary covers every child kind (shell executor, `agent.run`, guards) and matches the `SPUR_WORKFLOW_RUN_ACTIVE` precedent. Per-spawn `env` filtering would need edits in every executor and would miss future ones.
- **Why not scope the digest by definition path instead of deleting it?** A nested run on the *same* definition would still be wrongly constrained, and the variable has exactly one legitimate consumer (the worker's own startup check). Consume-and-remove is the minimal correct contract.
- **`SPUR_RUN_ID` stays inherited.** It is deliberate run lineage for agent runs; changing it is out of scope.
- **The foreground-workaround header (old R4) is dropped** because the fix lands in the same release that would carry the note.

### Design

**Change (single file, `apps/cli/src/commands/workflow.ts`).**

1. Add a small helper next to `clearWorkflowRunActive` (`:100`):
   ```ts
   /** Consume the launcher→worker handshake once; children must never inherit it (1117). */
   function takeAsyncWorkerEnv(): { expectedDigest: string | undefined; isAsyncWorker: boolean } {
       const expectedDigest = getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
       const isAsyncWorker = getEnvVar('SPUR_ASYNC_WORKER') === '1';
       removeEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
       removeEnvVar('SPUR_ASYNC_WORKER');
       return { expectedDigest, isAsyncWorker };
   }
   ```
2. `run` action (`:610`): call it at the top of the action, before the nested-run guard and any spawn. Replace the read at `:936` with the captured `expectedDigest`, and `:1158` with `isAsyncWorker`.
3. `continue` action (`:1216`): call it at the top; replace the read at `:1425` with `isAsyncWorker`.
4. The launcher (`spawnAsyncWorkflowWorker`, `:108`) is unchanged: it builds the child's env explicitly, so removing the vars from the *parent* process never affects the worker it launches.

**Invariants.**
- The worker's own digest refusal (`expectedDigestMismatch`, `:349`) behaves exactly as before.
- The async worker still records its pid and resume ownership.
- No other env variable changes; `SPUR_RUN_ID` lineage is untouched.

**Blast radius.** Only processes started *by* a worker change: they now see a clean env. Foreground runs never had these variables set by spur, so they are unaffected. If an operator exported one of them by hand, a foreground run now consumes and clears it; that is correct.

**Test seam.** `main([...])` runs in-process, so the test sets both variables on `process.env`, calls `main`, and restores in `finally` (pattern at `apps/cli/tests/commands/workflow.test.ts:262-282`). The temp workflow's digest comes from the app package's `resolveWorkflowDefinition`, so AC1 passes the startup check and reaches the step.

### Plan

1. Write the AC1–AC3 tests in `apps/cli/tests/commands/workflow.test.ts` first; confirm AC1/AC2 fail on the current tree (both variables read back as set; the nested run refuses).
2. Add `takeAsyncWorkerEnv()` and wire it into the `run` and `continue` actions; replace the three later `getEnvVar` reads with captured values.
3. Focused: `(cd apps/cli && bun test tests/commands/workflow.test.ts)`.
4. E2E: in a scratch repo run `spur workflow run <wf> --async` whose shell step runs `env | grep -E 'SPUR_(EXPECTED|ASYNC)' || echo clean` and a nested `spur workflow run` on another definition; save the run log as `.spur/run/1117-e2e.log` and cite it in Testing.
5. `bun run spur-check`; after CLI changes, `bun run --filter @gobing-ai/spur build:bundle`.

### Solution

Consume the launcher→worker handshake once at entry of the `workflow run` and `workflow continue` actions, so no step child inherits it. Single production file, mirroring the `SPUR_WORKFLOW_RUN_ACTIVE` precedent.

- `apps/cli/src/commands/workflow.ts:106-118` — new module-private `takeAsyncWorkerEnv()` next to `clearWorkflowRunActive`: captures `SPUR_EXPECTED_DEFINITION_DIGEST` + `SPUR_ASYNC_WORKER==='1'` and removes both from `process.env` (via the `@gobing-ai/spur-config` env helpers) before returning them.
- `apps/cli/src/commands/workflow.ts:630` — `run` action calls it as its first statement (before the nested-run guard, resolution, and any spawn); the captured `expectedDigest` drives the worker's own startup check (`apps/cli/src/commands/workflow.ts:957-979`, refusal message and behavior unchanged) and `isAsyncWorker` drives `recordSelfPid` (`apps/cli/src/commands/workflow.ts:1178`).
- `apps/cli/src/commands/workflow.ts:1240,1449` — `continue` action consumes at entry; the resume-owner branch uses the captured `isAsyncWorker` instead of re-reading the env.
- Launcher untouched: `spawnAsyncWorkflowWorker` at `apps/cli/src/commands/workflow.ts:124-145` builds the worker env explicitly and re-injects both variables, so removing them from the parent cannot affect the worker it launches. `SPUR_RUN_ID` lineage and all other env vars unchanged.

Rationale: the two variables have exactly one legitimate consumer each (the worker's own startup digest check and pid/resume-owner recording). Removing them at worker entry covers every child kind (shell steps, `agent.run`, guards, nested `spur`) at one boundary — per-child `env` filtering would need edits in every executor and misses future ones.

AC1 mechanism note: the task's scenario writes `${SPUR_EXPECTED_DEFINITION_DIGEST:-unset}` from the step, but the engine's shell-template pass resolves every `${...}` ref in a shell `command` and throws on non-`vars.`/`env.` refs, so `${VAR:-unset}` cannot survive authoring. The regression test asserts the identical property with brace-free `$NAME` + `-n` probes: the step child classifies each variable as `set`/`unset` and the file must read `unset unset`.

Tests (`apps/cli/tests/commands/workflow.test.ts`):
- `apps/cli/tests/commands/workflow.test.ts:292` (AC1/R1): step under the real digest + `SPUR_ASYNC_WORKER=1` probes both variables — file reads `unset unset`.
- `apps/cli/tests/commands/workflow.test.ts:345` (AC2/R4): nested `spur workflow run` on a different definition completes (exit 0, JSON `status: done`, no "refusing to start") under the async-worker env.
- `apps/cli/tests/commands/workflow.test.ts:407` (AC3/R2): a genuine expected-digest mismatch still refuses with the existing "differs from the expected digest" message and runs no state (marker file absent).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | takeAsyncWorkerEnv reads then removes both vars `apps/cli/src/commands/workflow.ts:112-118`; first statement of run `apps/cli/src/commands/workflow.ts:630` and continue `apps/cli/src/commands/workflow.ts:1240`; no other reader of either var in the file (rg this run); real --async E2E step probe reads clean (.spur/run/1117-e2e.log) |
| R2 | MET | refusal driven by the captured digest `apps/cli/src/commands/workflow.ts:979` through expectedDigestMismatch `apps/cli/src/commands/workflow.ts:367-374` with the unchanged "differs from the expected digest" message; AC3 test green this run |
| R3 | MET | captured flag drives recordSelfPid `apps/cli/src/commands/workflow.ts:1178` and the continue resume-owner branch `apps/cli/src/commands/workflow.ts:1449`; no post-entry env re-read |
| R4 | MET | tests `apps/cli/tests/commands/workflow.test.ts:292`, `apps/cli/tests/commands/workflow.test.ts:345`, `apps/cli/tests/commands/workflow.test.ts:407`: 3 pass / 0 fail this run; mutation check with both removeEnvVar lines disabled turns AC1+AC2 red (AC3 stays green), source restored clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A workflow step started by the async worker does not inherit the launcher's digest or worker flag (req: R1, R3) | MET | test | `apps/cli/tests/commands/workflow.test.ts:292` green this run and red under the mutation; real --async E2E probe reads clean (.spur/run/1117-e2e.log) |
| AC2 — A nested workflow run on a different definition completes under the async worker (req: R1, R4) | MET | test | `apps/cli/tests/commands/workflow.test.ts:345` green this run and red under the mutation; real --async E2E nested run exit 0, status done, empty stderr (.spur/run/1117-e2e.log) |
| AC3 — A genuine digest mismatch still refuses (req: R2) | MET | test | `apps/cli/tests/commands/workflow.test.ts:407` green this run: refusal message, marker file absent |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `apps/cli/src/commands/workflow.ts:100` — `clearWorkflowRunActive` precedent (`removeEnvVar`).
- `apps/cli/src/commands/workflow.ts:108-118` — `spawnAsyncWorkflowWorker` sets `SPUR_ASYNC_WORKER`.
- `apps/cli/src/commands/workflow.ts:790` — launcher passes `SPUR_EXPECTED_DEFINITION_DIGEST`.
- `apps/cli/src/commands/workflow.ts:936`, `:349` — worker reads and checks the digest.
- `apps/cli/src/commands/workflow.ts:1158`, `:1425` — later `SPUR_ASYNC_WORKER` reads.
- `apps/cli/tests/commands/workflow.test.ts:262-282` — env set/restore test pattern.
- Feature D3 (workflow run reliability defects).

### History

- 2026-10-07T21:24:30.969Z backlog → todo (system)
- 2026-10-08T04:20:12.519Z todo → wip (system)
- 2026-10-08T05:30:03.362Z wip → done (system)

