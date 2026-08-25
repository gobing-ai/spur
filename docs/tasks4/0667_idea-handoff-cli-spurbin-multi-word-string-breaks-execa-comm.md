---
schema_version: 1
name: "idea-handoff-cli: spurBin multi-word string breaks execa command"
status: backlog
template: standard
created_at: 2026-08-25T06:14:57.423Z
updated_at: "2026-08-25T06:30:10.320Z"
feature_id: F1
ac_altitude: task-local
---

## 0667. idea-handoff-cli: spurBin multi-word string breaks execa command

### Background

Found by idea-pipeline run `d6592bfe-0f6c-4d10-a220-a0d2e9f106ad` (2026-08-25): the run's `handoff-finalize` state failed in the monorepo writer (`packages/app/src/workflow/idea-handoff-cli.ts` → `finalizeIdeaHandoff`, `packages/app/src/workflow/idea-handoff.ts`) with an empty error: `idea-handoff: Failed to set dependencies for task 0666:`.

**Root cause chain (verified against source):**

1. `spur workflow run` injects `vars.spurBin = resolveSpurBin()` (`apps/cli/src/commands/workflow.ts:385,437`). `resolveSpurBinFrom` (`apps/cli/src/workflow/resolve-spur-bin.ts:35`) returns a **multi-word** string for the two runtime launch modes: `"<execPath> <mainModule>"` (e.g. `/Users/robin/.bun/bin/bun /Users/robin/xprojects/spur-new/apps/cli/src/index.ts`); only the compiled-binary mode returns a single word.
2. `finalizeIdeaHandoff` passes that whole string as `command` to `NodeProcessExecutor.run({ command: spurBin, args })` at three call sites (`idea-handoff.ts` — `task deps` ~:142, `feature refresh` ~:162, `task check` ~:173). The executor hands `command` verbatim to `execa(options.command, args, …)` (`ts-runtime/process-executor.ts:293`) — execa does **not** shell-split, so the lookup is for a single executable literally named `bun /path/to/index.ts` → ENOENT.
3. The executor's catch path (`process-executor.ts:323-347`) maps the spawn failure to `{ exitCode: null, stderr: '' }` and returns it because `rejectOnError: false`. It also **drops execa's `error.message`**, so the ENOENT detail never reaches the caller.
4. `idea-handoff.ts:148` treats `depRes.exitCode !== 0` (null ≠ 0) as a deps failure and formats `…: ${depRes.stderr}` — stderr is empty → the observed empty error. The seeded-project shell fallback in `config/workflows/idea-pipeline.yaml` (same state) works because `$spurBin` word-splits in shell.

**Two adjacent parity gaps on the same seam** (the shell fallback fails closed; the TS writer does not):

- `feature refresh` result is **discarded** (`await executor.run(…)` with no exitCode check, `idea-handoff.ts:162`) — the shell version `&&`-chains it, so a refresh failure aborts the run there but is silently ignored here.
- `task check` spawn failure (`exitCode: null`) is recorded as `pass: false` → `anyFailed` → recommends `/sp:dev-refineall` — a spawn failure is silently re-interpreted as "task not ready". The shell version fails closed (jq parse of a non-JSON tmp file → `|| exit 1`). This violates the F1/0518 invariant: refineall recommendation is for *real check failures*, not *checks that never ran*.

**Repro (both directions):**

```bash
# fails — exit 1, empty error after the colon
__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 spurBin="bun run apps/cli/src/index.ts" bun packages/app/src/workflow/idea-handoff-cli.ts
# succeeds — single-word spurBin
__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 spurBin=spur bun packages/app/src/workflow/idea-handoff-cli.ts
```

Impact: every idea-pipeline run in this monorepo (dev launch mode = multi-word spurBin) fails its final state after batch-create already succeeded — tasks exist but dependencies are unset, the feature roster is stale, and no handoff report is written. The run is then marked `failed` despite the planning deliverable being complete.

### Requirements

- [ ] R1. `finalizeIdeaHandoff` splits the `spurBin` string into executable + prefix args before **every** `executor.run` call (`task deps`, `feature refresh`, `task check`), so multi-word invocations (`bun <entry>`, `node <entry>`) execute correctly. Single-word values (`spur`, compiled binary path) behave byte-identically to today.
- [ ] R2. Split semantics mirror the existing precedent in `apps/cli/src/commands/workflow.ts:359-361` (`resolveSpurBin().split(' ')` → first token = command, rest = prefix args). Known ceiling (carried from the precedent): an `execPath`/`mainModule` containing spaces still mis-splits — accepted, documented in a code comment; do not build quoting/escaping machinery.
- [ ] R3. The `task deps` failure message never renders empty: it includes the available failure evidence from `ProcessResult` (`exitCode`, `signal` when present, `stderr` or an explicit `no stderr` marker).
- [ ] R4. `feature refresh` failure (`exitCode !== 0`, including `null`) returns `ok: false` with an evidence-carrying error — fail-closed parity with the `&&`-chained shell fallback in `config/workflows/idea-pipeline.yaml` (`handoff-finalize`).
- [ ] R5. `task check` spawn failure (`exitCode === null`) fails the run loudly with an error naming the WBS and the unresolved invocation — it must NOT be recorded as `pass: false` (which silently flips the recommendation to refineall). Real check failures (`exitCode !== 0`, non-null) keep today's behavior: `pass: false` → refineall recommendation (F1/0518 invariant: refineall is for real check failures only).
- [ ] R6. Regression coverage in `packages/app/tests/workflow/idea-handoff.test.ts` (+ `-cli.test.ts` if the seam moves): multi-word spurBin end-to-end through a capturing mock `ProcessExecutor` asserting single-token `command` and correctly prefixed `args`; deps-failure message carries evidence; refresh failure fails the run; check spawn failure fails the run with the WBS named.

### Acceptance Criteria

```gherkin
Feature: idea-handoff finalization executes spur subcommands for any spurBin launch mode

  Scenario: R1. Multi-word spurBin finalizes a run end to end
    Given a pipeline run directory with valid batch, result, and order artifacts
    And spurBin is "bun /abs/path/apps/cli/src/index.ts"
    When finalizeIdeaHandoff runs
    Then every spawned command is the single token "bun"
    And every spawn's args begin with "/abs/path/apps/cli/src/index.ts" followed by the subcommand argv
    And the result is ok with a written handoff report

  Scenario: R2. Single-word spurBin is unchanged
    Given the same run artifacts
    And spurBin is "spur"
    When finalizeIdeaHandoff runs
    Then every spawned command is exactly "spur" with no prefix args
    And the result is identical in shape to the pre-fix behavior

  Scenario: R3. A failing task deps reports actionable evidence
    Given spurBin resolves but "task deps" exits non-zero with stderr "boom"
    When finalizeIdeaHandoff runs
    Then the result is ok: false
    And the error contains the exit code and "boom"

  Scenario: R4. A failing feature refresh fails the run (shell parity)
    Given spurBin resolves but "feature refresh" exits non-zero
    When finalizeIdeaHandoff runs
    Then the result is ok: false with an evidence-carrying error
    And no handoff report is written

  Scenario: R5. A task check spawn failure fails loudly instead of recommending refineall
    Given spurBin cannot be spawned (exitCode null)
    When finalizeIdeaHandoff reaches the per-task check loop
    Then the result is ok: false
    And the error names the WBS being checked
    And the nextCommand is never a refineall recommendation derived from a check that never ran

  Scenario: R6. (edge) Regression suite pins the split contract
    Given the unit tests in packages/app/tests/workflow/idea-handoff.test.ts
    When they run under bun test
    Then R1-R5 are covered via a capturing mock ProcessExecutor with no real subprocess
```

### Q&A

- **Split locally vs. shared helper with `workflow.ts`?** Local. `packages/app` cannot import from `apps/cli`; two call-site clusters don't justify a new shared module. Conformance note in code points at the precedent.
- **Fix ts-runtime to carry execa's `message` on spawn failure?** Deferred — ts-libs release coupling for marginal message quality; call-site evidence formatting (exit/signal/stderr) is sufficient. Revisit if a second consumer needs spawn-failure messages.
- **Handle paths with spaces in spurBin?** No — `resolveSpurBin()` never quotes, `workflow.ts` has the same ceiling, and no supported install layout produces such paths today. If that changes, the fix belongs in `resolve-spur-bin.ts` (emit a quoted/structured contract), not in each consumer.
- **Why does the shell fallback survive this bug?** `$spurBin task deps …` word-splits in `/bin/sh -c`; execa receives a single `command` token. Same env var, two expansion semantics — the root of the divergence.

### Design

**Approach (mirrors `workflow.ts:359-361` precedent):** split once at the top of `finalizeIdeaHandoff`, prefix at each call site:

```ts
// ponytail: split(' ') breaks on paths containing spaces — same ceiling as
// workflow.ts:359; resolveSpurBin never emits quoted paths. Quoting belongs in
// resolve-spur-bin's contract if real installs ever need it.
const [spurCommand, ...spurPrefixArgs] = spurBin.split(' ');
// each call site:
await executor.run({ command: spurCommand, args: [...spurPrefixArgs, 'task', 'deps', ownWbs, 'set', ...deps, '--json'], … });
```

No new helper function, no new file: one split + three prefixed `args` arrays. Tested through the public function via the existing capturing-mock pattern (`idea-handoff.test.ts:31-36` captures `opts.command`/`opts.args`), not by exporting the split.

**Error evidence (R3/R4):** format from the fields `ProcessResult` actually carries — `exitCode`, `signal`, `stderr`; append `no stderr` when empty. Do NOT change ts-runtime to thread execa's `error.message` (release coupling; the empty-stderr symptom is fixed adequately at the call site).

**Fail-closed parity (R4/R5):**

- `feature refresh`: check `exitCode !== 0` (covers `null`) → `ok: false` with evidence; previously the result was discarded.
- `task check` loop: `exitCode === null` → return `ok: false` naming the WBS and `spurCommand` (a spawn failure means the executor is broken, not the task); `exitCode !== 0` (non-null) → `pass: false` as today.

**Invariants:**

- Env contract unchanged: `idea-handoff-cli.ts` still reads `spurBin` as a single string; `config/workflows/idea-pipeline.yaml` untouched.
- Behavior parity with the shell fallback is the acceptance bar — the two writers must fail/succeed under the same conditions.
- Single-word spurBin: split yields one token + empty prefix → identical argv to today.

**Impacted surfaces:** `packages/app/src/workflow/idea-handoff.ts` (only source file), `packages/app/tests/workflow/idea-handoff.test.ts`. Not touched: `idea-handoff-cli.ts`, workflow YAML, ts-runtime, `resolve-spur-bin.ts`.

### Plan

1. Write failing tests in `packages/app/tests/workflow/idea-handoff.test.ts` (mock `ProcessExecutor` capture pattern already in file): R1 multi-word split + prefix assertion, R2 single-word unchanged, R3 deps evidence message, R4 refresh fail-closed, R5 check spawn-failure loud.
2. Implement in `packages/app/src/workflow/idea-handoff.ts`: split once; prefix args at all three `executor.run` sites; evidence-carrying error formatter; refresh exit check; check-loop `exitCode === null` branch.
3. Targeted green: `bun test packages/app/tests/workflow/idea-handoff.test.ts packages/app/tests/workflow/idea-handoff-cli.test.ts`.
4. Live verification (original repro): `__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 spurBin="bun run apps/cli/src/index.ts" bun packages/app/src/workflow/idea-handoff-cli.ts` → exit 0, report written. (Idempotent: deps already set, refresh + checks re-run.)
5. Gate: `bun run spur-check` (lint + tests).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Failing run: `d6592bfe-0f6c-4d10-a220-a0d2e9f106ad` (idea-pipeline, 2026-08-25); log `.spur/run/d6592bfe-….log`
- Source: `packages/app/src/workflow/idea-handoff.ts` (deps ~:142, refresh ~:162, check ~:173), `packages/app/src/workflow/idea-handoff-cli.ts`
- spurBin producer: `apps/cli/src/workflow/resolve-spur-bin.ts:35-50` (multi-word for runtime launch modes); injected at `apps/cli/src/commands/workflow.ts:385,437`
- Split precedent: `apps/cli/src/commands/workflow.ts:359-361`
- Executor spawn-failure mapping (exitCode null, stderr '', message dropped): `~/xprojects/ts-libs/packages/runtime/src/process-executor.ts:323-347`
- Shell fallback contract (fail-closed parity bar): `config/workflows/idea-pipeline.yaml` state `handoff-finalize`
- Invariants: task 0518 (F1 — refineall recommendation only for real check failures); 0604 Q&A (monorepo-writer/shell-fallback split)

### History
