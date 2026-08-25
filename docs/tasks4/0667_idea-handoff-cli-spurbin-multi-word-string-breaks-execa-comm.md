---
schema_version: 1
name: "idea-handoff-cli: spurBin multi-word string breaks execa command"
status: backlog
template: standard
created_at: 2026-08-25T06:14:57.423Z
updated_at: "2026-08-25T06:40:20.623Z"
feature_id: F1
ac_altitude: task-local
---

## 0667. idea-handoff-cli: spurBin multi-word string breaks execa command

### Background

Found by idea-pipeline run `d6592bfe-0f6c-4d10-a220-a0d2e9f106ad` (2026-08-25): the run's `handoff-finalize` state failed in the monorepo writer (`packages/app/src/workflow/idea-handoff-cli.ts` → `finalizeIdeaHandoff`, `packages/app/src/workflow/idea-handoff.ts`) with an empty error: `idea-handoff: Failed to set dependencies for task 0666:`.

**This is a recurrence, not a new bug class.** Task **0501** (done, 2026-08-10) fixed the identical multi-token-`spurBin` fault in `plugins/sp/scripts/task-size-precheck.ts` and its R1 explicitly ruled: *"Reuse the split already established in this repo … do not invent a third helper shape."* `idea-handoff.ts` was authored later (task 0518) and reintroduced the fault by passing `spurBin` straight through. The repo now carries **six** independent splits of the same string (see Q&A), which is why the fault keeps coming back.

**Root cause chain (verified against source, 2026-08-25):**

1. `spur workflow run` injects `vars.spurBin = resolveSpurBin()` (`apps/cli/src/commands/workflow.ts:385,437`). `resolveSpurBinFrom` (`apps/cli/src/workflow/resolve-spur-bin.ts:35-43`) returns a **multi-word** string for the two runtime launch modes: `"<execPath> <mainModule>"` (e.g. `/Users/robin/.bun/bin/bun /Users/robin/xprojects/spur-new/apps/cli/src/index.ts`); only the compiled-binary mode returns a single word.
2. `finalizeIdeaHandoff` passes that whole string as `command` to `executor.run({ command: spurBin, args })` at three call sites (`idea-handoff.ts:143` `task deps`, `:163` `feature refresh`, `:174` `task check`). The executor hands `command` verbatim to `execa(options.command, args, …)` (`ts-runtime/process-executor.ts:297`) — execa does **not** shell-split, so the lookup is for a single executable literally named `bun /path/to/index.ts` → ENOENT.
3. The executor's catch path (`process-executor.ts:327-355`) maps the spawn failure to `{ exitCode: null, stderr: '' }` and returns it because `rejectOnError: false`. It also **drops execa's `error.message`**, so the ENOENT detail never reaches the caller.
4. `idea-handoff.ts:149` treats `depRes.exitCode !== 0` (null ≠ 0) as a deps failure and `:155` formats `…: ${depRes.stderr}` — stderr is empty → the observed empty error. The seeded-project shell fallback in `config/workflows/idea-pipeline.yaml` (same state) works because `$spurBin` word-splits in `/bin/sh -c`.

**Two adjacent parity gaps on the same seam** (the shell fallback fails closed; the TS writer does not):

- `feature refresh` result is **discarded** (`await executor.run(…)` with no exitCode check, `idea-handoff.ts:162-168`) — the shell version `&&`-chains it, so a refresh failure aborts the run there but is silently ignored here.
- `task check` spawn failure (`exitCode: null`) is recorded as `pass: false` (`idea-handoff.ts:180`), so the run returns `ok: true` with a **fabricated readiness table**: every WBS renders `FAIL` in the report though no check ever ran, and the report asserts "Per-task readiness (spur task check)". That is an evidence-integrity failure — a broken executor is laundered into a planning verdict. (It does *not* violate 0518's F1 invariant, which is the opposite direction — "any failed check ⇒ refineall, never runall"; recommending refineall here is conservative. The defect is the fabricated evidence and the `ok: true`, not the recommendation.) The shell version fails closed (jq parse of a non-JSON tmp file → `|| exit 1`, plus a row-count assertion).

**Repro (verified 2026-08-25, real two-token shape):**

```bash
# fails — exit 1, empty error after the colon
__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 \
  spurBin="$(which bun) $PWD/apps/cli/src/index.ts" \
  bun packages/app/src/workflow/idea-handoff-cli.ts
# → idea-handoff: Failed to set dependencies for task 0666:      (exit 1)

# succeeds — single-word spurBin (mutates: sets deps, refreshes roster, writes report)
__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 spurBin=spur \
  bun packages/app/src/workflow/idea-handoff-cli.ts
```

**Scope of impact:** the TS writer runs **only in this monorepo** — `config/workflows/idea-pipeline.yaml` guards it with `if [ -f packages/app/src/workflow/idea-handoff-cli.ts ]`, so seeded projects take the working shell fallback. Severity is therefore dev-productivity, not end-user: every idea-pipeline run here fails its final state after batch-create already succeeded — tasks exist but dependencies are unset, the feature roster is stale, and no handoff report is written. The run is marked `failed` despite the planning deliverable being complete (observed: run `d6592bfe` produced tasks 0665/0666 but its report had to be written by a manual single-word re-run).

### Requirements

- [ ] R1. `finalizeIdeaHandoff` splits the `spurBin` string into executable + leading args before **every** `executor.run` call (`task deps`, `feature refresh`, `task check`), so multi-word invocations (`<bun> <entry>`, `<node> <entry>`) execute correctly. Single-word values (`spur`, compiled-binary path) behave byte-identically to today.
- [ ] R2. **Reuse, do not re-implement the split.** `packages/app` already contains two byte-identical copies of this helper — `splitExecutable` (`packages/app/src/workflow/actions/command-gate.ts:68-81`) and `splitSpurBin` (`packages/app/src/workflow/actions/doctor-probe.ts:24-36`): `SHELL_METACHARACTERS` reject → `.trim().split(/\s+/).filter(t => t.length > 0)` → `{ command, leadingArgs }`. Extract that one function into a single internal module under `packages/app/src/workflow/` and route all three consumers (`command-gate.ts`, `doctor-probe.ts`, `idea-handoff.ts`) through it, deleting the two duplicates. Net duplication must go **down**, not up. This is the standing repo rule (task 0501 R1: *"Reuse the split already established in this repo … do not invent a third helper shape"*); `split(' ')` (the `apps/cli/src/commands/workflow.ts:359-361` form) is **not** the shape to copy — it mishandles repeated whitespace, and `packages/app` cannot import from `apps/cli` anyway. Keep the helper internal (no `packages/app/src/index.ts` export) until a cross-package consumer exists.
- [ ] R3. Behaviour of the shared helper is preserved exactly for its two existing callers: same error strings (the action-kind label — `command.gate "executable"` / `doctor.probe "spurBin"` — stays caller-supplied), same metacharacter rejection, same tokenisation. `packages/app/tests/workflow/actions/command-gate.test.ts` and `doctor-probe.test.ts` pass unchanged. Known residual ceiling (unchanged from all existing copies): an `execPath`/`mainModule` containing a space still mis-splits — accepted, documented in the helper's doc comment; do not build quoting/escaping machinery.
- [ ] R4. `finalizeIdeaHandoff` fails closed on a rejected `spurBin` (empty, or containing shell metacharacters): return `ok: false` with the helper's error, before any subprocess is spawned.
- [ ] R5. The `task deps` failure message never renders empty: it includes the failure evidence `ProcessResult` actually carries — `exitCode`, `signal` when present, and `stderr` or an explicit `no stderr` marker.
- [ ] R6. `feature refresh` failure (`exitCode !== 0`, including `null`) returns `ok: false` with the same evidence-carrying error format — fail-closed parity with the `&&`-chained shell fallback in `config/workflows/idea-pipeline.yaml` (`handoff-finalize`). The result is currently discarded (`idea-handoff.ts:162-168`).
- [ ] R7. `task check` spawn failure (`exitCode === null`) returns `ok: false` naming the WBS and the resolved command, and **no report is written**. Today it is recorded as `pass: false` (`idea-handoff.ts:180`), which fabricates a readiness table — every WBS renders `FAIL` under a heading claiming `spur task check` ran — and still returns `ok: true`. Real check failures (`exitCode !== 0`, non-null) keep today's behaviour: `pass: false` → refineall recommendation, preserving 0518's F1 invariant ("any failed check ⇒ refineall, never runall").
- [ ] R8. Regression coverage in `packages/app/tests/workflow/idea-handoff.test.ts` using the capturing mock `ProcessExecutor` already in that file (`:31-44`): multi-word spurBin asserts single-token `command` and correctly prefixed `args` on all three spawn sites; single-word spurBin unchanged; rejected spurBin fails before spawning; deps-failure message carries evidence; refresh failure fails the run; check spawn failure fails the run naming the WBS with no report written. If the shared module gets its own test file, it covers the tokenisation and rejection cases directly.

### Acceptance Criteria

```gherkin
Feature: idea-handoff finalization executes spur subcommands for any spurBin launch mode

  Scenario: R1. Multi-word spurBin finalizes a run end to end
    Given a pipeline run directory with valid batch, result, and order artifacts
    And spurBin is "/abs/bun /abs/apps/cli/src/index.ts"
    When finalizeIdeaHandoff runs
    Then every spawned command is the single token "/abs/bun"
    And every spawn's args begin with "/abs/apps/cli/src/index.ts" followed by the subcommand argv
    And the result is ok with a written handoff report

  Scenario: R2. The split helper is shared, not re-implemented
    Given the packages/app source tree after the change
    When the workflow sources are searched for a spurBin/executable tokenisation
    Then exactly one implementation exists under packages/app/src/workflow/
    And command-gate.ts, doctor-probe.ts, and idea-handoff.ts all import it

  Scenario: R3. Existing helper callers are behaviourally unchanged
    Given the pre-existing command-gate and doctor-probe test suites
    When they run against the extracted shared helper
    Then they pass unchanged
    And each caller's rejection error still names its own option label

  Scenario: R4. A rejected spurBin fails before any spawn
    Given spurBin is "spur; rm -rf /"
    When finalizeIdeaHandoff runs
    Then the result is ok: false naming the metacharacter rejection
    And the process executor is never invoked

  Scenario: R5. A failing task deps reports actionable evidence
    Given spurBin resolves but "task deps" exits non-zero with stderr "boom"
    When finalizeIdeaHandoff runs
    Then the result is ok: false
    And the error contains the exit code and "boom"

  Scenario: R6. A failing feature refresh fails the run (shell parity)
    Given spurBin resolves but "feature refresh" exits non-zero
    When finalizeIdeaHandoff runs
    Then the result is ok: false with an evidence-carrying error
    And no handoff report is written

  Scenario: R7. A task check spawn failure fails loudly instead of fabricating a readiness table
    Given the executor cannot spawn the resolved command (exitCode null)
    When finalizeIdeaHandoff reaches the per-task check loop
    Then the result is ok: false
    And the error names the WBS being checked and the resolved command
    And no handoff report is written

  Scenario: R7b. A real check failure still recommends refineall
    Given "task check" exits 1 with a JSON body for one WBS
    When finalizeIdeaHandoff runs
    Then the result is ok with that WBS recorded as FAIL
    And the next command is the ready-depth refineall recommendation

  Scenario: R8. (edge) Regression suite pins the split contract
    Given the unit tests in packages/app/tests/workflow/idea-handoff.test.ts
    When they run under bun test
    Then R1 and R4-R7b are covered via a capturing mock ProcessExecutor with no real subprocess
```

### Q&A

- **Inline split vs. shared helper?** Shared — the "two call-site clusters don't justify a module" reading was wrong on the count. The repo already carries **six** independent splits of the same string: `packages/app/src/workflow/actions/command-gate.ts:68` (`splitExecutable`), `packages/app/src/workflow/actions/doctor-probe.ts:24` (`splitSpurBin`), `plugins/sp/scripts/task-size-precheck.ts:130` (`runSpur`), `plugins/sp/scripts/feature-sync-bounded.ts:280` (`runSpurJson`), `plugins/sp/scripts/history-load.ts:115` (`runSpur`), and `apps/cli/src/commands/workflow.ts:359`. Two of them are in the *same package* as `idea-handoff.ts` and are byte-identical. Adding a seventh inline copy is what let this fault recur after task 0501 already fixed it once. Scope of the extraction is deliberately bounded to `packages/app` (three consumers, one new internal module, two deletions); the three `plugins/sp` scripts stay as they are — they are a separate bundle boundary with their own tests and no import path into `packages/app`.
- **Which shape wins?** The `packages/app` shape: `SHELL_METACHARACTERS` rejection + `.trim().split(/\s+/).filter(t => t.length > 0)`. It matches task 0501 R1's landed ruling, tolerates repeated whitespace, and keeps the shell-injection guard the two action runners already depend on. `split(' ')` from `workflow.ts:359` is strictly weaker and unimportable from `packages/app`.
- **Does the metacharacter guard belong on the idea-handoff path?** Yes. `spurBin` is caller-overridable through `spur workflow run --vars`, and `finalizeIdeaHandoff` spawns argv directly with no shell — the same trust boundary `command.gate` guards. Rejecting fails loud (R4) instead of producing an ENOENT with an empty message. `resolveSpurBin()` never emits a metacharacter, so no legitimate invocation regresses.
- **Fix ts-runtime to carry execa's `message` on spawn failure?** Deferred — ts-libs release coupling for marginal message quality; call-site evidence formatting (exit code / signal / stderr) is sufficient. Revisit if a second consumer needs spawn-failure messages.
- **Handle paths containing spaces?** No — `resolveSpurBin()` never quotes, every existing split has the same ceiling, and no supported install layout produces such paths. If that changes, the fix belongs in `resolve-spur-bin.ts` (emit a quoted or structured contract), not in each consumer.
- **Why does the shell fallback survive this bug?** `$spurBin task deps …` word-splits in `/bin/sh -c`; execa receives a single `command` token. Same env var, two expansion semantics — the root of the divergence.
- **Does the check-spawn-failure fix contradict 0518's F1 invariant?** No. F1 is "any failed check ⇒ refineall, never runall" — recommending refineall on a spawn failure is conservative w.r.t. it. The defect R7 fixes is orthogonal: returning `ok: true` with a report whose "Per-task readiness (spur task check)" table is fabricated from checks that never ran.
- **Why not also fix `spur task deps` idempotency for re-runs?** Out of scope — the live verification re-runs against an already-finalized run (`d6592bfe`) and `task deps … set` is a replace, so re-application is safe. No change needed.
### Design

**Step 1 — extract the shared split (R2/R3).** New internal module `packages/app/src/workflow/split-launch-command.ts` holding the function that `command-gate.ts` and `doctor-probe.ts` currently duplicate verbatim, parameterised only by the caller's option label so the existing error strings stay byte-identical:

```ts
/**
 * Shell metacharacters that must never appear in a resolved launch string.
 * These callers spawn argv directly — no shell is involved — so the presence of
 * shell syntax means a caller is smuggling a program into the executable slot.
 */
const SHELL_METACHARACTERS = /[;&|<>$`(){}[\]!*?~#\n\r"']/;

/**
 * Split a resolved launch string into its argv head and leading arguments.
 *
 * `spurBin` legitimately resolves to `"<bun> <mainModule>"` when the CLI runs under a
 * JS runtime (`resolveSpurBin()`), so a single-token rule would make every real gate
 * inexpressible. Splitting on whitespace is safe precisely because no shell is involved.
 *
 * Ceiling: an execPath/mainModule containing a space mis-splits. Accepted — resolveSpurBin
 * never quotes, and every prior copy of this function had the same ceiling. If a supported
 * install layout ever produces such a path, the fix belongs in resolve-spur-bin.ts.
 */
export function splitLaunchCommand(
    value: string,
    label: string, // e.g. 'command.gate "executable"' / 'doctor.probe "spurBin"' / 'idea-handoff "spurBin"'
): { command: string; leadingArgs: string[] } | { error: string };
```

`command-gate.ts` and `doctor-probe.ts` delete their local copies (and their local `SHELL_METACHARACTERS` constants) and call it. Their tests pin the behaviour and must pass unchanged.

**Step 2 — use it in `idea-handoff.ts` (R1/R4).** Split once at the top, prefix at each of the three call sites:

```ts
const split = splitLaunchCommand(spurBin, 'idea-handoff "spurBin"');
if ('error' in split) return { ok: false, wbsList: [], nextCommand: '', reportPath, error: split.error };
const { command: spurCommand, leadingArgs } = split;
// each call site:
await executor.run({ command: spurCommand, args: [...leadingArgs, 'task', 'deps', ownWbs, 'set', ...deps, '--json'], … });
```

The rejection branch sits *before* the batch/result/order parsing loop so no subprocess and no report can precede it. Single-word `spurBin` yields `leadingArgs: []` → argv identical to today.

**Step 3 — evidence formatting (R5/R6).** One local formatter over the fields `ProcessResult` actually carries:

```ts
const evidence = (r: ProcessResult): string =>
    `exit=${r.exitCode ?? 'null'}${r.signal ? ` signal=${r.signal}` : ''}: ${r.stderr.trim() || 'no stderr'}`;
```

Used by both the `task deps` failure (`idea-handoff.ts:155`) and the new `feature refresh` check. Do **not** change ts-runtime to thread execa's `error.message` — release coupling, and the empty-stderr symptom is fixed adequately at the call site.

**Step 4 — fail-closed parity (R6/R7).**

- `feature refresh`: check `exitCode !== 0` (covers `null`) → `ok: false` with evidence. Previously discarded.
- `task check` loop: `exitCode === null` → return `ok: false` with `` `Task check for ${wbs} could not be spawned (${spurCommand}): ${evidence(checkRes)}` `` — a spawn failure means the executor is broken, not the task. `exitCode !== 0` (non-null) → `pass: false` as today, preserving the refineall recommendation.

Both branches return before `fs.writeFile(reportPath, …)`, so no fabricated report is emitted.

**Invariants:**

- Env contract unchanged: `idea-handoff-cli.ts` still reads `spurBin` as a single string; `config/workflows/idea-pipeline.yaml` untouched.
- Behaviour parity with the shell fallback is the acceptance bar — the two writers must fail and succeed under the same conditions.
- Single-word `spurBin`: split yields one token + empty prefix → identical argv to today.
- The shared helper stays unexported from `packages/app/src/index.ts` (no cross-package consumer yet).

**Impacted surfaces:** new `packages/app/src/workflow/split-launch-command.ts`; edited `packages/app/src/workflow/idea-handoff.ts`, `packages/app/src/workflow/actions/command-gate.ts`, `packages/app/src/workflow/actions/doctor-probe.ts`; tests `packages/app/tests/workflow/idea-handoff.test.ts` (+ optional `split-launch-command.test.ts`); `packages/app/tests/workflow/actions/{command-gate,doctor-probe}.test.ts` must pass unchanged. Not touched: `idea-handoff-cli.ts`, workflow YAML, ts-runtime, `resolve-spur-bin.ts`, `plugins/sp/scripts/*`.
### Plan

1. Extract `packages/app/src/workflow/split-launch-command.ts` from the two identical copies in `actions/command-gate.ts` and `actions/doctor-probe.ts`; rewire both callers with their existing option labels; delete the duplicates and their local `SHELL_METACHARACTERS` constants.
2. Confirm no behavioural drift on the extraction alone: `bun test packages/app/tests/workflow/actions/command-gate.test.ts packages/app/tests/workflow/actions/doctor-probe.test.ts` green **before** touching `idea-handoff.ts`.
3. Write failing tests in `packages/app/tests/workflow/idea-handoff.test.ts` (capturing-mock pattern already at `:31-44`): R1 multi-word split + prefix on all three spawn sites, R4 rejected spurBin never spawns, R5 deps evidence message, R6 refresh fail-closed, R7 check spawn-failure loud with no report, R7b real check failure still recommends refineall.
4. Implement in `packages/app/src/workflow/idea-handoff.ts`: split-and-reject at the top; prefix `leadingArgs` at all three `executor.run` sites; evidence formatter; refresh exit check; check-loop `exitCode === null` branch.
5. Targeted green: `bun test packages/app/tests/workflow/idea-handoff.test.ts packages/app/tests/workflow/idea-handoff-cli.test.ts packages/app/tests/workflow/actions/command-gate.test.ts packages/app/tests/workflow/actions/doctor-probe.test.ts`.
6. Live verification (the recorded repro): `__runId=d6592bfe-0f6c-4d10-a220-a0d2e9f106ad featureId=A5 spurBin="$(which bun) $PWD/apps/cli/src/index.ts" bun packages/app/src/workflow/idea-handoff-cli.ts` → exit 0 and a written report. Idempotent: `task deps … set` replaces, refresh and checks re-run.
7. Gate: `bun run autofix && bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Failing run: `d6592bfe-0f6c-4d10-a220-a0d2e9f106ad` (idea-pipeline, 2026-08-25); artifacts in `.spur/run/d6592bfe-…-idea-*`
- Source under change: `packages/app/src/workflow/idea-handoff.ts` (deps `:143`, refresh `:163`, check `:174`, empty-error format `:155`, fabricated `pass` `:180`)
- Split helper duplicates to consolidate: `packages/app/src/workflow/actions/command-gate.ts:68-81` (`splitExecutable`), `packages/app/src/workflow/actions/doctor-probe.ts:24-36` (`splitSpurBin`)
- Other repo copies (out of scope, separate bundle boundary): `plugins/sp/scripts/task-size-precheck.ts:130`, `plugins/sp/scripts/feature-sync-bounded.ts:280`, `plugins/sp/scripts/history-load.ts:115`, `apps/cli/src/commands/workflow.ts:359-361`
- spurBin producer: `apps/cli/src/workflow/resolve-spur-bin.ts:35-43` (multi-word for both JS-runtime launch modes); injected at `apps/cli/src/commands/workflow.ts:385,437`
- Executor spawn-failure mapping (exitCode null, stderr `''`, execa message dropped): `~/xprojects/ts-libs/packages/runtime/src/process-executor.ts:297` (execa call), `:327-355` (catch)
- Shell fallback contract (fail-closed parity bar): `config/workflows/idea-pipeline.yaml`, state `handoff-finalize`
- Prior art / standing rule: task **0501** (done) — same bug class in `task-size-precheck.ts`; R1 mandates reusing the established split shape rather than adding a new one
- Invariants: task **0518** F1 (any failed check ⇒ refineall, never runall) and its 0604 Q&A (monorepo-writer / shell-fallback split)
### History
