---
schema_version: 1
name: "Honest success and failure signals: close the --json-envelope failure surface and repair the developer test loop"
status: todo
template: issue
created_at: 2026-08-28T22:21:18.215Z
updated_at: "2026-08-28T22:49:12.021Z"
feature_id: F95
parent_wbs: "0698"
ac_altitude: task-local
---

## 0699. Honest success and failure signals: close the --json-envelope failure surface and repair the developer test loop

### Background
Decomposed from task **0698** (`### Requirements` R1, R2, R5, R6), which registered nineteen
root-caused findings from the 2026-08-27 dogfood sweep and the 2026-08-27/28 history-anatomy reports.
Every claim below was reproduced against `HEAD` = `dad078ad5` on 2026-08-28; the full evidence bundle
lives in 0698 `### Root Cause`.

**Why these four belong in one task.** They are the same defect wearing four costumes: *a tool
reporting success on an unproven path, or failure on a proven one*. The JSON envelope says
`{"ok": true}` on a not-found error. The workspace test suite says six failures on a clean tree
because it never loaded its own preload. The documented iterate command says exit 1 on a green test.
An implementer fixing any one of them in isolation still cannot trust the other three while
verifying the fix — which is exactly what happened across four separate dogfood runs, where retries
were burned chasing phantom failures and a real one shipped certified MET.

Items R3 and R4 are ordered first in the Plan for that reason: they are small, and until they land no other
task in the 0698 decomposition can use suite colour or exit codes as evidence.

**What the source runs actually cost.** The `dev-verify-0693` run certified AC4 MET on a single
noun's failure probe while the clause quantified over the whole surface; the `sp-dev-run-0693` run
recorded "check verbs pin `ok:true` on failure" as an accepted judgement call; the
`sp-dev-verify-0687` run recorded that the documented targeted-test loop cannot exit green and
worked around it. Three runs, three partial views of one class. This task closes the class.

**Relationship to ADR-091 and feature F95.** R1 and R2 are squarely F95's charter — F95 scenario
`R3 — Implementation follows the approved ADR` is not yet true for failure paths. R2 additionally
corrects an ADR-091 promise the shipped helper never kept. R3 and R4 are the verification
prerequisite, not F95 scope; they are here because splitting a four-line enabler into its own task
would be the wrong size, not because they belong to the envelope decision.
### Requirements
Source mapping: R1 ← 0698 R1, R2 ← 0698 R2, R3 ← 0698 R5, R4 ← 0698 R6.

- [ ] R1. **No verb that declares `--json-envelope` may report `ok: true`, or emit no JSON at all, on a path that exits non-zero.** Today `spur task check 9999` and `spur feature check F999` print `{"ok": true, "data": [], "meta": {...}}` to stdout with exit code 1, and `task path` / `task resolve` / `rule show` / `workflow show` / `agent show` print a bare stderr line and no JSON. The deliverable is the **enumeration** of all 68 verbs declaring `SHARED_OPTIONS.jsonEnvelope`, not a fix to the handful this sweep happened to name — the ten-verb probe was a sample of a fall-through pattern, and 110 raw `context.output.error(` calls live in `apps/cli/src/commands`.

- [ ] R2. **`writeJsonError` must be able to carry an error code and must not leak the JS class prefix into the machine-readable message.** `packages/app/src/output/envelope.ts:99-109` hardcodes `INTERNAL_ERROR` and accepts no `details`, so an enveloped consumer cannot distinguish a missing record from an internal fault. Thirty-five call sites pass `String(err)`, producing `"message": "Error: Task 9999 not found in any registered task folder"`. ADR-091 (`docs/00_ADR.md:1664`, `:1708`) promises CLI-local codes collapse to `INTERNAL_ERROR` **with `details.cliCode`**; only six hand-rolled sites honour it. Either the helper gains the capability or the ADR paragraph is corrected — both must end up saying the same thing in the same commit (constitution **T3**).

- [ ] R3. **`bun test` must report the same result from any workspace directory on a clean tree, with no operator-set environment variable.** Run from `apps/cli` the suite is 880 pass / 6 fail; run as `SPUR_SKIP_GLOBAL_CONFIG=true bun test` from that same directory it is 886 / 0. The six failures resolve the operator's real `~/.config/spur/config.yaml` instead of each test's temp fixture, so the suite passes only on machines whose global config happens to match — meaning neither a dogfood nor a `--fix` pass can use suite colour on that workspace as a regression signal.

- [ ] R4. **The targeted-test-first command that `CLAUDE.md` prescribes as the iterate loop must exit 0 when the targeted test passes.** `bun test <file> --test-name-pattern <name>` reports `1 pass / 0 fail` and exits **1**, because `bunfig.toml`'s repo-wide `coverageThreshold = { lines = 0.9, functions = 0.9 }` is applied with a whole-repo denominator to a single-file run. Whatever command ends up documented must be executed and shown to exit 0 before it is written down.

**Out of scope.** The raw (non-enveloped) `--json` byte-identity that ADR-091 deliberately froze —
items R1 and R2 change only the `--json-envelope` branch, and the raw-path fixtures in `apps/cli/tests/`
must stay byte-identical. Also out: any new CLI noun, verb, or flag (that would trip ADR-051 consent),
per-noun behaviour changes beyond the failure envelope, and lowering the 90/90 coverage bar to make R4 green.
### Acceptance Criteria
`AC1` is titled verbatim after feature F95's third scenario so DD-09 links it; the remaining rows
warn `L4.uncovered-task-scenario` by design (see `### Q&A`).

```gherkin
Feature: Honest success and failure signals

  Scenario: R3 — Implementation follows the approved ADR
    Given every spur verb that declares SHARED_OPTIONS.jsonEnvelope
    When each is driven down a failure path with --json --json-envelope
    Then stdout carries {ok: false, error: {code, message}}
    And no verb emits {ok: true} while exiting non-zero
    And no verb exits non-zero while emitting no JSON at all
    And the enumeration covers all 68 verbs, listed in the test, not a sample

  Scenario: AC2 — The envelope distinguishes not-found from internal fault
    Given writeJsonError accepts an optional ApiErrorCode and optional details
    When spur task show 9999 --json --json-envelope runs
    Then error.code is NOT_FOUND, or INTERNAL_ERROR carrying details.cliCode
    And the message reads "Task 9999 not found in any registered task folder"
    And it does not begin with "Error: "

  Scenario: AC3 — ADR-091 and the shipped helper agree
    Given ADR-091's compat paragraph at docs/00_ADR.md:1664 and :1708
    When the helper's capability is compared against the ADR text
    Then either the helper carries details.cliCode as promised
    Or the ADR paragraph is corrected in the same commit

  Scenario: AC4 — The raw JSON path is byte-identical
    Given the pre-change raw --json output of every touched verb
    When the same verbs run after R1 and R2 land, without --json-envelope
    Then stdout is byte-identical to the recorded baseline fixtures

  Scenario: AC5 — Every workspace suite is green on a clean tree
    Given a clean checkout on a machine with a populated ~/.config/spur/config.yaml
    When bun test runs with apps/cli as the working directory
    Then the suite reports 0 failures
    And no SPUR_SKIP_GLOBAL_CONFIG is set on the command line

  Scenario: AC6 — The documented iterate command exits 0 on a passing test
    Given the targeted-test-first command written in CLAUDE.md
    When it selects a single passing test by name
    Then the process exit code is 0
    And the command as documented is the command that was executed to prove it
```
### Q&A
**Q: Is R1 a per-site patch or a seam fix?** A seam fix plus an enumeration. The failing verbs share
one shape: a not-found branch calls `context.output.error(...)` and `setExitCode(1)` but does **not**
`return`, so control falls through to the shared terminal emit — `apps/cli/src/commands/task.ts:1266-1269`
falling into `:1326`'s `toEnvelopeJson(results, { enveloped, kind: 'list' })`, which serialises the
empty accumulator as a success envelope. Patching only `task check` and `feature check` leaves every
sibling caller broken. The cheap way to enumerate is a table-driven test that drives each of the 68
verbs down a failure path, not reading 110 `output.error(` sites by hand.

**Q: Why is the `Error: ` strip inside the helper rather than at the 35 call sites?** Because one
line in `writeJsonError` fixes all 35 at once and cannot be forgotten by the 36th caller. Passing
`err instanceof Error ? err.message : String(err)` at each site is the same behaviour with 35× the
diff and a permanent regression surface.

**Q: For R3, why a per-workspace `bunfig.toml` rather than setting the env var in CI?** Because the
env var is already set — at `tests/setup.ts:58` — and the preload that loads it is registered only in
the **root** `bunfig.toml`. `apps/cli` has no `bunfig.toml`, so `cd apps/cli && bun test` runs with no
preload at all. Adding the file restores the intended behaviour; setting the variable in CI would
paper over a harness gap that every developer and every agent hits locally. Verify whether the other
workspaces (`packages/*`, `apps/server`, `apps/web`) have the same hole before deciding whether to add
one file or several.

**Q: For R4, is the fix to document a different command or to change the threshold?** **Open —
implementer's call, record it in `### Solution`.** Documenting a coverage-free iterate command
(`bun test --coverage=false <file> --test-name-pattern <name>`) is the smaller change and keeps the
90/90 bar intact for the real gate. Scoping the threshold is the larger change with wider blast
radius. Whichever is chosen, the constraint from R4 is non-negotiable: run the command, observe exit
0, then write it down — the current text was written without that check.

**Q: Does R1 or R2 need ADR-051 operator consent?** No. The only new name is an optional `code`
(and `details`) parameter on a module-internal helper. No CLI noun, verb, or flag is added, changed,
or removed. If the enumeration in R1 turns up a verb that needs a *new* flag to express its failure
shape, stop and get explicit consent before landing it.

**Q: Why do this task's own AC rows warn `L4.uncovered-task-scenario`?** Because AC2–AC6 are not in
feature F95's three-scenario list, and DD-09 enforces that a task's AC titles are a subset of its
feature's. That rule is the root cause filed as 0698 R9 and fixed by task **0700**. Do not silence
these warnings by renaming this task's scenarios to mimic F95's — three prior dogfood runs already
paid for that workaround, and it is named as an anti-pattern in 0698 `### Design`.
### Design
#### WHAT

Four local repairs, one shared seam parameter. No new abstraction, no new module, no new CLI surface.

#### WHY this grouping

All four are "the tool's own signal is wrong". Landing them together means an implementer verifies
each against a suite and an exit code that can actually be believed — R3 and R4 make R1's 68-verb
enumeration checkable in the first place.

#### WHERE — change map

| R | File | Anchor | Change |
| --- | --- | --- | --- |
| R1 | `apps/cli/src/commands/task.ts` | `:1266-1269` | Add the missing `return` after the not-found branch; route the message through `writeJsonError` |
| R1 | `apps/cli/src/commands/feature.ts` | check verb's not-found branch | Same fall-through, same fix |
| R1 | `apps/cli/src/commands/{task,rule,workflow,agent}.ts` | `task path`, `task resolve`, `rule show`, `workflow show`, `agent show` | Replace bare `context.output.error(...)` with `writeJsonError(context.output, options, …)` on every non-zero-exit path |
| R1 | `apps/cli/tests/output-envelope.test.ts` (extend) | — | Table-driven case per `--json-envelope` verb: drive a failure, assert `ok === false` and a parseable `error.code`/`error.message` |
| R2 | `packages/app/src/output/envelope.ts` | `:99-109` | Signature becomes `writeJsonError(output, options, message, code: ApiErrorCode = 'INTERNAL_ERROR', details?: unknown)`; strip a leading `Error: ` from `message` before emitting; pass `code`/`details` through to `toEnvelopeError` (`:86`, which already accepts `details`) |
| R2 | not-found call sites | `task.ts`, `feature.ts` | Pass `'NOT_FOUND'` where the condition is a plain missing record |
| R2 | `docs/00_ADR.md` | `:1664`, `:1708` | Reconcile the compat paragraph with what the helper now does (T3, same commit) |
| R3 | `apps/cli/bunfig.toml` (new) | — | `[test] preload = ["../../tests/setup.ts"]` plus whatever of the root `[test]` block the workspace needs to keep coverage behaviour identical. Check the sibling workspaces for the same hole |
| R4 | `bunfig.toml` and/or `CLAUDE.md` | `[test]` block; §Verification gate targeted-test paragraph | Document a command that exits 0 (see `### Q&A` for the open choice) |

#### Frozen names

`writeJsonError`'s two new optional parameters. Module-internal — **ADR-051 consent not triggered**.
Nothing else is added to any public surface.

#### Anti-patterns — do not do these

- **Do not fix only the verbs this task's Root Cause names.** They are a probe of a fall-through
  pattern. The enumeration over all 68 `--json-envelope` verbs is the deliverable.
- **Do not touch the raw `--json` byte-identity.** ADR-091 froze it deliberately; AC4 is the guard.
- **Do not lower the 90/90 coverage threshold** to make R4 green. R4 is about documenting a command
  that works, not about weakening the real gate.
- **Do not set `SPUR_SKIP_GLOBAL_CONFIG` in CI** as R3's fix. The variable is already set in
  `tests/setup.ts`; the bug is that the preload declaring it is not reachable from the workspace.
- **Do not rename this task's AC scenarios** to match F95's titles to quiet the DD-09 warnings.
### Plan
1. [ ] **Restore the test signal (R3).** Add `apps/cli/bunfig.toml` with the root preload; confirm
   `cd apps/cli && bun test` goes 880/6 → 886/0 with no environment variable on the command line.
   Check `packages/*`, `apps/server`, `apps/web` for the same missing file and fix them in the same
   pass. Test intent: every later step in this task, and every task in the 0698 decomposition, can
   now use suite colour as evidence.

2. [ ] **Settle the iterate contract (R4).** Choose between a coverage-free targeted command and a
   scoped threshold (see `### Q&A`), **run the chosen command**, observe exit 0, then update
   `CLAUDE.md` §Verification gate. Record the choice and the observed exit code in `### Solution`.
   Test intent: the documented loop is the loop that was proven, not the loop that was assumed.

3. [ ] **Extend the seam (R2).** Add the optional `code` and `details` parameters and the leading-
   `Error: ` strip to `writeJsonError`; unit-test each independently (default code preserved,
   explicit code honoured, `details` passed through, prefix stripped, raw branch unchanged). Test
   intent: 35 call sites gain correct messages without 35 edits.

4. [ ] **Fix the fall-through (R1, first half).** Add the missing `return` in the `task check` and
   `feature check` not-found branches and route them through `writeJsonError` with `NOT_FOUND`.
   Regression: `spur task check 9999 --json --json-envelope` emits `ok:false` and exits 1.

5. [ ] **Enumerate the surface (R1, second half).** Build the table-driven test over all 68 verbs
   declaring `SHARED_OPTIONS.jsonEnvelope`; let it fail; fix every verb it names — expect `task path`,
   `task resolve`, `rule show`, `workflow show`, `agent show` and more. Test intent: the class is
   closed, and the test keeps it closed for verb 69.

6. [ ] **Prove the raw path is untouched (AC4).** Re-run the byte-identity fixtures in
   `apps/cli/tests/`; any diff on the non-enveloped path is a defect in this task, not a baseline to
   update.

7. [ ] **Reconcile ADR-091 (R2, T3).** Update `docs/00_ADR.md:1664,1708` so the compat story and the
   shipped helper agree. Same commit as the code.

8. [ ] **Commit prep.** `bun run autofix && bun run spur-check`; then `spur task check --corpus`
   **once** (constitution T11). Author `### Solution` with the file:line change map, the R4 decision,
   and the count of verbs the enumeration actually repaired.
### Root Cause
All four reproduced against `HEAD` = `dad078ad5` on 2026-08-28. Commands are literal, from the repo root.

**R1 — the envelope reports success on a failure path.** The not-found branch at
`apps/cli/src/commands/task.ts:1266-1269` calls `context.output.error(...)` and `setExitCode(1)` but
does **not** `return`; control reaches the shared terminal emit at `:1326`
(`toEnvelopeJson(results, { enveloped: options.jsonEnvelope, kind: 'list' })`), which serialises the
empty `results` accumulator as a success envelope.

```
$ bun run apps/cli/src/index.ts task check 9999 --json --json-envelope
{ "ok": true, "data": [], "meta": { "hasMore": false, "limit": 1 } }   # exit 1
$ bun run apps/cli/src/index.ts feature check F999 --json --json-envelope
Feature F999 not found                                                 # stderr, unenveloped
{ "ok": true, "data": [], "meta": { "hasMore": false, "limit": 1 } }   # exit 1
```

Ten-verb not-found sweep under `--json --json-envelope`:

| verb | exit | envelope |
| --- | --- | --- |
| `task show 9999` | 1 | `ok: false` ✓ |
| `feature show F999` | 1 | `ok: false` ✓ |
| `task check 9999` | 1 | **`ok: true`** |
| `feature check F999` | 1 | **`ok: true`** |
| `task path 9999` | 1 | **no JSON** |
| `task resolve /nope/nope.ts` | 1 | **no JSON** |
| `rule show nonexistent-rule` | 1 | **no JSON** |
| `workflow show nonexistent.yaml` | 1 | **no JSON** |
| `agent show nonexistent-agent` | 1 | **no JSON** |
| `feature check` (empty id) | 1 | **`ok: true`** |

Surface size: `grep -rn "SHARED_OPTIONS.jsonEnvelope" apps/cli/src/commands | wc -l` = **68**;
`writeJsonError` call sites = **39**; raw `context.output.error(` calls in `apps/cli/src/commands` =
**110**.

**R2 — `writeJsonError` cannot express a code.** `packages/app/src/output/envelope.ts:99-109` is:

```ts
export function writeJsonError(output, options, message: string): void {
    if (options.json && envelopeEnabled(options.jsonEnvelope)) {
        output.write(toEnvelopeError('INTERNAL_ERROR', message));
        return;
    }
    output.error(message);
}
```

`toEnvelopeError` at `:86` already accepts a third `details` argument; the helper never passes one.
Thirty-five sites pass `String(err)`:

```
$ bun run apps/cli/src/index.ts task show 9999 --json --json-envelope
{ "ok": false, "error": { "code": "INTERNAL_ERROR",
  "message": "Error: Task 9999 not found in any registered task folder" } }
```

`docs/00_ADR.md:1708` promises "CLI-local codes collapse to `INTERNAL_ERROR` with `details.cliCode`".
Only hand-rolled sites honour it — `history.ts:80,101,129`, `builder.ts:56,108`, `message.ts:55` —
never the generic helper.

**R3 — `apps/cli` is red on a clean tree.** Proven both ways:

```
$ cd apps/cli && bun test                                #  880 pass /  6 fail
$ cd apps/cli && SPUR_SKIP_GLOBAL_CONFIG=true bun test   #  886 pass /  0 fail
```

Failing: 4 × workflow list/run, 2 × agent-team role/executor. The assertion at
`apps/cli/tests/commands/agent-team.test.ts:296` expects `capable-exec` and receives
`alpha-reviewer-1  antigravity-cli  reviewer  agy-opus  antigravity-cli agent` — `agy-opus` is
declared at `~/.config/spur/config.yaml:161`, not in the test's temp fixture.

The layered merge is **working as designed**: `packages/config/src/loader.ts:146-230` deep-merges the
global and project layers with executors merged by `name`, and the escape hatch already exists —
`tests/setup.ts:58` sets `process.env.SPUR_SKIP_GLOBAL_CONFIG = 'true'`. The defect is reachability:
that preload is declared only in the **root** `bunfig.toml` (`preload = ["./tests/setup.ts"]`), and
`apps/cli` has no `bunfig.toml` at all. Root `bun run test` is green for exactly this reason.

**R4 — the documented iterate loop exits 1 on a green test.**

```
$ bun test apps/cli/tests/commands/agent-team.test.ts --test-name-pattern "role and executor"
 1 pass
 0 fail
$ echo $?
1
```

`bunfig.toml` `[test]` sets `coverage = true` with `coverageThreshold = { lines = 0.9, functions = 0.9 }`,
so a single-file run is scored against the whole-repo denominator. `CLAUDE.md` §Verification gate
prescribes exactly this command as the targeted-test-first iterate loop (task 0436 R2), which means
every agent following the documented contract reads a green test as a failure.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Parent:** task **0698** — `### Requirements` R1, R2, R5, R6; full evidence bundle in its
`### Root Cause`. **Feature:** F95 (ADR-091 envelope standard).

**Source dogfood runs.** `docs/dogfood/2026-08-27-dev-verify-0693-dogfood.md` (P1 sampled-AC
certification; P2 red `apps/cli` baseline; P3 `INTERNAL_ERROR` collapse; P3 `String(err)` prefix) ·
`docs/dogfood/2026-08-27-sp-dev-run-0693-worktree-dogfood.md` (F3 enveloped failure surface;
unresolved "check verbs pin `ok:true` on failure") ·
`docs/dogfood/2026-08-27-dev-run-0697-dogfood.md` (F-R1 dead env-var opt-in, the same
flags-boundary class) · `docs/dogfood/2026-08-27-sp-dev-verify-0687-dogfood.md` (P3 targeted-test
coverage denominator).

**Authority.** `docs/00_ADR.md` ADR-091 `:1629-1710` — the envelope decision, its frozen
`API_ERROR_CODES` set, and the compat paragraph R2 corrects (`:1664`, `:1708`) ·
`docs/00_ADR.md` ADR-051 (amended 2026-08-20) — the public-CLI consent gate this task must not trip ·
`docs/99_PROJECT_CONSTITUTION.md` **T3** (surface code + design doc same commit), **T11** (corpus
sweep is a commit gate) · `docs/04_DESIGN.md` §4.1 — the 102-verb `--json` ledger R1's enumeration
must keep truthful.

**Code anchors.**

- `packages/app/src/output/envelope.ts:86` (`toEnvelopeError`, accepts `details`), `:99-109` (`writeJsonError`)
- `apps/cli/src/commands/task.ts:1266-1269` (fall-through), `:1326` (terminal emit), `:269` (a `String(err)` site)
- `apps/cli/src/commands/feature.ts:60,175` — the 0693 precedent fix for `feature show`, the pattern R1 generalises
- `apps/cli/src/commands/shared-options.ts` — `SHARED_OPTIONS.jsonEnvelope`, the 68-verb enumeration key
- `apps/cli/tests/output-envelope.test.ts:34,60,66` — existing `details.cliCode` expectations
- `apps/cli/tests/commands/agent-team.test.ts:292-300` — the R3 failing assertion
- `packages/config/src/loader.ts:146-230` — layered merge (working as designed; context for R3)
- `bunfig.toml` `[test]` block · `tests/setup.ts:58` · `~/.config/spur/config.yaml:161` (operator-local, do not commit)
- `CLAUDE.md` §Verification gate — the targeted-test-first paragraph R4 rewrites

**Commits consulted.** `6b89162e1` (feature not-found envelope — the precedent), `791dc9c94`
(envelope adoption across nouns), `9043d390c` / `7dcddadbb` / `33e642f42` (0697 service-layer seam),
`79df734f0` (envelope byte-identity baseline — the fixture set AC4 guards).
### History
