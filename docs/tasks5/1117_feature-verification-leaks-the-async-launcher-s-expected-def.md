---
schema_version: 1
name: feature-verification leaks the async launcher's expected definition digest into verificationCmd
status: todo
template: feature-impl
created_at: 2026-10-07T20:52:28.373Z
updated_at: "2026-10-07T21:24:30.969Z"

feature_id: D3
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 2
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

- [ ] R1. The async worker consumes `SPUR_EXPECTED_DEFINITION_DIGEST` and `SPUR_ASYNC_WORKER` exactly once, at entry of both the `workflow run` and `workflow continue` actions, and removes both from `process.env` before any state executes, so no step child (shell, `agent.run`, guard, nested `spur`) inherits either.
- [ ] R2. The digest check keeps its current behavior for the worker itself: a mismatching expected digest still refuses to start with the existing message.
- [ ] R3. Code that currently re-reads `SPUR_ASYNC_WORKER` after entry (`recordSelfPid` in `run`, the resume-owner/`recordSelfPid` branch in `continue`) uses the value captured at entry, so behavior of the async worker itself is unchanged.
- [ ] R4. A regression test in `apps/cli/tests/commands/workflow.test.ts` proves a step launched under the async-worker env sees neither variable, and that a nested `spur workflow run` on a different definition completes instead of refusing.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

