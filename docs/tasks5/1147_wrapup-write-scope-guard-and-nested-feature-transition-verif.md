---
schema_version: 1
name: Wrapup write-scope guard and nested feature-transition verification
status: done
template: feature-impl
created_at: 2026-10-09T18:05:11.090Z
updated_at: "2026-10-10T05:40:22.262Z"
feature_id: H1

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
done_forced: "true"
done_reason: "Verdict artifact .spur/memory/evidence/1147-verdict.json: aggregate PASS, R1-R5 MET, AC1-AC5 MET, Confidence MEDIUM (verifier disclosed two caveats: AC4 equivalence observed at the child-env mechanism with a stub child, and no recorded fail-without-fix transcript for the new R1/R2 tests). The deny is a checker-policy conflict, not a content gap: task-pipeline.yaml's confidence row writes status=warn for any non-HIGH level and done-transition-guard maps warn->PARTIAL, so no MEDIUM verdict can clear this gate although both pipeline completion guards accept anything above LOW. Acknowledged under the --auto batch; inconsistency filed as task 1154."
---

## 1147. Wrapup write-scope guard and nested feature-transition verification

### Background

Captured from the creation title: "Wrapup write-scope guard and nested feature-transition verification".

**Origin (split from 1136 on 2026-10-09).** Two wrapup integrity defects from the 1132 run (2026-10-08) and the H1 batch (2026-10-08).

**Defect A: doc-sync wrote outside its declared scope.**
- On the full route, the wrapup `doc-sync` `agent.run` (`config/workflows/wrapup-pipeline.yaml:224`, one model query over 04_DESIGN, 03_ARCHITECTURE, 00_ADR and `docs/design/*`) re-added the deliberately delinked row for `design/spur-team-mode-design.md` to `docs/04_DESIGN.md`. It also edited an unrelated test, `apps/app/tests/decision/decision-log-query.test.ts` (+36 lines).
- `doc-tripwire` (`:330`, repo-wide tripwires over the uncommitted wrap diff) then failed on `repo-wide-tests/adr-supersession.test.ts` (g2). That routes straight to `failed` (`:600-611`), so both edits had to be reverted by hand and the wrap finished on `mode=fast`.
- Verified 2026-10-09: the `repair` state (`:308-328`) is a shell step that only writes a status file. The unrelated edit therefore came from doc-sync's agent run, not from "repair". The delinked row is currently absent from `docs/04_DESIGN.md`, which is correct.

**Defect B: the nested feature-transition failed while its own check passed.**
- In the H1 batch, the wrapup `feature-transition` (`wrapup-steps.ts feature-transition` → `spur feature sync`) failed with `GuardDeniedError: Lifecycle transition denied for feature H1: State "verifying" onEnter shell failed (exit 1)`, while its gate printed `H1 (active): PASS`.
- Running `feature-verification.yaml` directly succeeded (`H1 verification PASS`, run `abf585eb-3e26-4b66-9835-3d3332e139dc`).
- The failing shell is `config/workflows/feature-lifecycle.yaml:53`, which runs `$spurBin workflow run feature-verification.yaml` nested inside the running wrapup workflow. The error carries no stderr, so the root cause is unknown. Candidates: inherited run env such as `__runId`, a cwd difference, or a DB lock held by the outer run.

### Requirements

- [x] R1. **doc-sync writes only inside its declared scope.**
  - After the `doc-sync` `agent.run`, a deterministic shell action compares the working diff against the entry snapshot.
  - Allowed paths: `docs/**` except `docs/tasks*`/`docs/features*`, and the learnings capture path the step declares.
  - Any other changed path fails the step: write `scope-violation: <paths>` to `.spur/run/<run>-wrapup-doc-sync-scope.status` and route to `failed` with the paths named.
  - The violating edits are reported, not auto-reverted.
- [x] R2. **doc-sync never re-adds a delinked index row.**
  - The doc-sync prompt states that a row absent from `docs/04_DESIGN.md` for a superseded satellite is intentional.
  - A deterministic check after doc-sync runs the supersession pins (`repo-wide-tests/adr-supersession.test.ts`) before `doc-tripwire`, so the failure names doc-sync, not the tripwire stage.
  - The tripwire is never weakened.
- [x] R3. **A nested onEnter shell failure carries its own error.** A lifecycle `onEnter` shell failure includes the last 2 KiB of the command's stderr in the `GuardDeniedError` message, instead of a bare `exit 1`.
- [x] R4. **The nested feature-verification agrees with the standalone run.**
  - Reproduce the H1 failure: run a wrapup whose feature-transition moves a feature to `verifying`, with a feature whose standalone `feature-verification.yaml` passes.
  - Fix the root cause R3 exposes, so the nested and standalone runs return the same verdict.
  - The fix is the one shared invocation path (`feature-lifecycle.yaml:53` or the env it inherits), not a wrapup-only special case.
- [x] R5. **Docs and bundle ship in the same change.** Update the wrapup workflow comments (doc-sync scope, the new check), `docs/design/` for the lifecycle onEnter error contract if one owns it, then run `bun run --filter @gobing-ai/spur build:bundle`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A doc-sync edit outside docs fails the step naming the path (req: R1)
  Given a doc-sync run that modifies apps/app/tests/decision/decision-log-query.test.ts
  When the post-doc-sync scope check runs
  Then the step fails with scope-violation naming that path
  And an edit confined to docs/design/*.md passes the check
```

```gherkin
Scenario: AC2 — A resurrected delinked row fails at doc-sync, not at doc-tripwire (req: R2)
  Given doc-sync re-adds the design/spur-team-mode-design.md row to docs/04_DESIGN.md
  When the post-doc-sync supersession check runs
  Then the failure names doc-sync and the adr-supersession (g2) pin
  And repo-wide-tests/adr-supersession.test.ts is unchanged
```

```gherkin
Scenario: AC3 — A lifecycle onEnter failure shows the nested stderr (req: R3)
  Given a lifecycle onEnter shell that writes "boom" to stderr and exits 1
  When the transition is attempted
  Then the GuardDeniedError message contains "boom"
```

```gherkin
Scenario: AC4 — Nested and standalone feature verification agree (req: R4)
  Given a feature whose standalone feature-verification.yaml run passes
  When a wrapup feature-transition moves it to verifying
  Then the transition succeeds with the verification receipt recorded
  And a regression test reproducing the nested invocation fails without the fix
```

```gherkin
Scenario: AC5 — Workflow comments and bundle reflect the scope check (req: R5)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass and the wrapup workflow documents the doc-sync scope check
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:07:18.152Z

- **Q: Auto-revert out-of-scope doc-sync edits?** A: No. Report and fail. A revert destroys evidence of what the model did; the operator decides.
- **Q: Fix the H1 nested failure by bypassing verification in wrapup?** A: No. Root-cause it through R3's stderr and fix the shared invocation path.

### Design

- **Scope is enforced by a deterministic check, not by prompt wording alone.** doc-sync is a free-form model step (ADR-043 residual), and its prompt cannot be the only guard. A shell action right after it diffs `git status --porcelain -uall` against the snapshot taken at doc-sync entry, filters to the allowed globs, and fails on the rest. Report, don't revert: reverting a model's edit hides evidence, and the operator decides.
- **Run the supersession pin where the defect is introduced.** Running `bun test repo-wide-tests/adr-supersession.test.ts` (seconds) right after doc-sync turns a late doc-tripwire failure into an attributable doc-sync failure. `doc-tripwire` stays as the full backstop.
- **Root-cause before fixing R4.** R3 is the instrument. The fix goes where R3's stderr points. Hypotheses to test, cheapest first:
  - (a) the inherited `__runId`/workflow env makes the nested `workflow run` resolve the outer run;
  - (b) the nested run hits the outer run's DB lock;
  - (c) a cwd/`spurBin` difference.
- **Boundaries.** Do not weaken `adr-supersession.test.ts`, do not make doc-sync skip index files wholesale, do not turn `mode=fast` into the default, and do not special-case wrapup in the lifecycle engine.
- **Failure inventory:**
  - the scope check flags the learnings capture file;
  - the scope check misses an untracked file;
  - the snapshot is taken after doc-sync has already written;
  - the stderr tail leaks a secret, which is why the tail goes through the existing redaction;
  - the R4 fix masks a genuine verification failure.

### Plan

1. Write the failure inventory (Design) as test names.
2. Tests first:
   - `plugins/sp/tests/wrapup-steps.test.ts` fixtures for R1/R2: an out-of-scope edit, an in-scope edit, a resurrected row;
   - an engine test for R3's stderr tail;
   - a nested-invocation reproduction for R4 that runs the lifecycle onEnter from inside a running workflow context.
3. R1/R2: add the entry snapshot and the post-doc-sync check actions in `config/workflows/wrapup-pipeline.yaml`, implemented in `plugins/sp/scripts/wrapup-steps.ts`, and route the failure edge.
4. R3: include the redacted stderr tail in the lifecycle onEnter failure message.
5. R4: reproduce, read the stderr, fix the root cause, and confirm that nested and standalone runs agree.
6. R5: docs, then `build:bundle`.
7. Acceptance drill: one full-route wrapup on a scratch branch that completes with `doc-tripwire` PASS, plus one deliberately out-of-scope doc-sync edit that fails naming the path. Record both in Testing.
8. Run `bun run spur-check` once.

### Solution

**WHAT.** Four defects closed on two owned surfaces: the wrapup `doc-sync` write-scope guard
(R1), the doc-sync supersession check (R2), the lifecycle onEnter error contract (R3), and the
nested feature-verification invocation (R4), with docs + bundle in the same change (R5).

| Req | Change | Anchor |
| --- | --- | --- |
| R1 | New `doc-sync-snapshot` / `doc-sync-scope` subcommands: a `git status --porcelain -uall` listing recorded at doc-sync entry, then diffed against the working listing. Allowed = `docs/**` minus `docs/tasks*`/`docs/features*`, the declared learnings capture, and the guard's own snapshot/status files; pre-existing dirt (a sibling task's uncommitted work) is never attributed. A violation writes `scope-violation: <paths>` and is reported, never reverted; a missing snapshot fails closed. | `plugins/sp/scripts/wrapup-steps.ts:806`, `plugins/sp/scripts/wrapup-steps.ts:776`, `plugins/sp/scripts/wrapup-steps.ts:720`, `plugins/sp/scripts/wrapup-steps.ts:709`, `plugins/sp/scripts/wrapup-steps.ts:696` |
| R1 | Workflow wiring: the snapshot action runs BEFORE the model query; the scope check runs after it and always exits 0 (status truth in the file, 0783 R4). A declared guard edge routes a recorded violation to `failed` naming the paths. | `config/workflows/wrapup-pipeline.yaml:260`, `config/workflows/wrapup-pipeline.yaml:297`, `config/workflows/wrapup-pipeline.yaml:610` |
| R2 | New `doc-supersession` subcommand re-runs the supersession pins (`bun test repo-wide-tests/adr-supersession.test.ts`) after doc-sync, writing `supersession-pin-failed: <pin>` — or PASS; a project without the pin skips. `doc-tripwire` is untouched and stays the repo-wide backstop. | `plugins/sp/scripts/wrapup-steps.ts:847`, `plugins/sp/scripts/wrapup-steps.ts:680` |
| R2 | Workflow wiring + prompt: the pin action runs after doc-sync with its own fail edge; the doc-sync prompt now states the write scope and that a row absent from `docs/04_DESIGN.md` for a superseded satellite is intentional. | `config/workflows/wrapup-pipeline.yaml:311`, `config/workflows/wrapup-pipeline.yaml:622`, `config/workflows/wrapup-pipeline.yaml:273` |
| R3 | The onEnter denial now carries the last **2 KiB by bytes** (was a 2000-char slice) of the child's stderr, redacted with the run's configured secrets before the bound is taken. The exit-code + error-line + tail plumbing itself already shipped (task 0948, commit `775e4e908`); this closes the bound and the leak the design's failure inventory named. | `packages/app/src/workflow/lifecycle-adapter.ts:37`, `packages/app/src/workflow/lifecycle-adapter.ts:355`, `packages/app/src/workflow/lifecycle-adapter.ts:147`, `apps/cli/src/workflow/make-lifecycle-adapter.ts:49` |
| R4 | Root cause: a workflow-spawned `spur workflow run` inherits the parent's `SPUR_WORKFLOW_RUN_ACTIVE=1`, and the CLI's nested-run refusal (0610 R4, `apps/cli/src/commands/workflow.ts:695`) rejects it — so the same `feature-verification` pass that passes standalone failed under a wrapup with a bare `exit 1`. The one shared invocation path now clears that marker for this bounded, definition-pinned child (shell-only, no `agent.run`, no further nesting); the recursion guard stays binding for every other nested invocation. No wrapup-side workaround. | `config/workflows/feature-lifecycle.yaml:60` |
| R5 | Workflow comments updated (doc-sync scope + the two new checks, shape and `failed`-state text); the lifecycle onEnter error contract and the wrapup contract documented in their owning satellites. Version tags bumped (`wrapup-pipeline` 7→8, `feature-lifecycle` 1→2) with their pins updated. | `config/workflows/wrapup-pipeline.yaml:26`, `docs/design/planning-workflow-contracts.md:56`, `docs/design/essential-workflow-checks.md:174`, `packages/app/tests/workflow/wrapup-pipeline.test.ts:142` |
| R5 | Bundle + script twins rebuilt in the same change: `bun run --filter @gobing-ai/spur build:bundle`, then `bun run build:scripts` (the bundle invalidates the `.mjs` twins — the stale-twin trap this batch hit), verified by `bun scripts/commands/script-contract-check.ts` → PASS. | `apps/cli/package.json:52`, `package.json:66`, `package.json:100`, `plugins/sp/scripts/wrapup-steps.mjs:529` |
| — | Tests: scope/supersession suites over a real temp git repo, the supersession pin executed for real (failing fixture, passing fixture, absent pin), the marker-clearing execution test against the shipped lifecycle command, the 2 KiB + redaction denial test, and the pipeline-structure pins (edge table, action shapes, prompt, versions). | `plugins/sp/tests/wrapup-steps.test.ts:1125`, `plugins/sp/tests/feature-verification-scope.test.ts:143`, `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:543`, `packages/app/tests/workflow/wrapup-pipeline.test.ts:645` |

**WHY.** doc-sync is a free-form model step (ADR-043 residual), so its scope cannot rest on prompt
wording alone: the deterministic post-step check is what makes an out-of-scope write an attributable
failure instead of a hand-revert at the next stage. Same reasoning for the supersession pin — run the
check where the defect is introduced so the failure names doc-sync, and keep the tripwire as the full
backstop rather than weakening it. R4 was a shared-path defect: the pass was never wrong, its
invocation was refused, and the fix belongs where every caller inherits it.

**Boundaries honored.** `repo-wide-tests/adr-supersession.test.ts` is unchanged; `doc-tripwire` and
its `docTripwireCmd` are unchanged; nothing auto-reverts doc-sync's edits; no wrapup-only bypass of
verification; the nested-run guard is not relaxed globally (one bounded child clears the marker for
itself).

**Residuals.** `bun apps/cli/src/index.ts workflow validate config/workflows/wrapup-pipeline.yaml`
exits 0 with warn-level composition findings on the new locator wrappers (6 logical commands vs the
warn threshold of 5) — the same warn class the existing `metrics-record`/`feature-transition`
wrappers already carry; no error-level finding. The scope check reads an environment-owned listing,
so a doc-sync write landing in a globally gitignored path is invisible to it (git semantics; both
listings agree) — disclosed, not silently accepted. R3's stderr tail covers the one lifecycle
transition that has an `onEnter` shell; the pre-existing tail plumbing was already tested for the
small-stderr case, and this change adds the byte-bound + redaction cases.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Entry snapshot action is declared BEFORE the model query and the two checks after it: `config/workflows/wrapup-pipeline.yaml:260` (doc-sync-snapshot), `config/workflows/wrapup-pipeline.yaml:266` (agent.run), `config/workflows/wrapup-pipeline.yaml:297` (doc-sync-scope). Allowed-scope logic `plugins/sp/scripts/wrapup-steps.ts:709-711` (docs/ minus docs/tasks*/docs/features* plus the declared learnings capture); listing diff `plugins/sp/scripts/wrapup-steps.ts:720-730` (pre-existing dirt is never attributed); violation write + always-exit-0 `plugins/sp/scripts/wrapup-steps.ts:806-841`; missing snapshot fails closed `plugins/sp/scripts/wrapup-steps.ts:818-819`. Fail edge declared before action-ok `config/workflows/wrapup-pipeline.yaml:598-610`. Tests `plugins/sp/tests/wrapup-steps.test.ts:1125-1186` (fresh 111 pass / 0 fail). Disclosed deferrable P3: the contract-violation edge is declared first `config/workflows/wrapup-pipeline.yaml:589-596`, so a doc-sync that both misses its post-condition and writes out of scope routes to `repair`; the scope status file is still written and echoed on stderr. |
| R2 | MET | `doc-supersession` re-runs the pin and writes `supersession-pin-failed: <pin>`, skipping when the pin is absent: `plugins/sp/scripts/wrapup-steps.ts:847-880`; pin identity `plugins/sp/scripts/wrapup-steps.ts:685`. Wiring runs after doc-sync with its own fail edge `config/workflows/wrapup-pipeline.yaml:311` and `config/workflows/wrapup-pipeline.yaml:611-622`, before the doc-tripwire state (`config/workflows/wrapup-pipeline.yaml:388`). Prompt states the write scope and that the delinked row is intentional: `config/workflows/wrapup-pipeline.yaml:273-275`. doc-tripwire and docTripwireCmd are untouched (no diff line; `config/workflows/wrapup-pipeline.yaml:129`, `config/workflows/wrapup-pipeline.yaml:388` unchanged); the pin file is unmodified (`git status --porcelain -- repo-wide-tests/adr-supersession.test.ts` -> empty). Test `plugins/sp/tests/wrapup-steps.test.ts:1188-1210` (absent pin PASS; failing pin named; clean pin PASS). |
| R3 | MET | Byte bound `packages/app/src/workflow/lifecycle-adapter.ts:37` (ENTER_STDERR_TAIL_BYTES = 2048). The denial redacts the FULL stderr first, then takes the last 2 KiB by bytes: `packages/app/src/workflow/lifecycle-adapter.ts:353-356`; the byte-safe primitive advances past continuation bytes `packages/app/src/workflow/actions/shell.ts:21-27`. Secrets reach the adapter through the one production construction `apps/cli/src/workflow/make-lifecycle-adapter.ts:49` (`// 1147 R3` comment present). Test `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:543-616`: asserts `exit 7` present, TAILEND present, BOUNDMARK present (2026 bytes from the end — inside 2 KiB, outside the former 2000-char slice), HEADMARK absent, `[REDACTED]` present and the literal secret absent, and the report length bounded. Fresh run pass. |
| R4 | MET | Root cause reproduced this pass: the CLI refusal at `apps/cli/src/commands/workflow.ts:693-705` fires when `SPUR_WORKFLOW_RUN_ACTIVE=1` (exit 1, message on stderr) and does NOT fire under the shipped `env -u` form. The fix is the ONE shared invocation path (`config/workflows/feature-lifecycle.yaml:60`, the only `workflow run feature-verification.yaml` caller in config/). Boundedness: `config/workflows/feature-verification.yaml:22` states no `agent.run` nodes; the run stays shell-only. Guard still binds everywhere else: exactly one `env -u SPUR_WORKFLOW_RUN_ACTIVE` occurrence across the repo, in that one command. Test `plugins/sp/tests/feature-verification-scope.test.ts:143-179` runs the shipped command string with the marker set and observes the child env unset. |
| R5 | MET | Workflow comments + failed-state prose `config/workflows/wrapup-pipeline.yaml:26-34`, `config/workflows/wrapup-pipeline.yaml:583-586`; onEnter + nested-invocation contract `docs/design/planning-workflow-contracts.md:56-72`; wrapup contract `docs/design/essential-workflow-checks.md:174-190`. Version tags bumped and pinned: `config/workflows/feature-lifecycle.yaml:12` = "2", `config/workflows/wrapup-pipeline.yaml:98` = "8", pinned at `packages/app/tests/workflow/wrapup-pipeline.test.ts:152-153`. Bundle mirror regenerated with the same tags and the two new check commands (`apps/cli/config/workflows/wrapup-pipeline.yaml:98`, `apps/cli/config/workflows/wrapup-pipeline.yaml:297`, `apps/cli/config/workflows/wrapup-pipeline.yaml:311`); `.mjs` twin carries all three subcommands `plugins/sp/scripts/wrapup-steps.mjs:446-448`. `script-contract-check` PASS (fresh) and `workflow validate` exit 0 (fresh); certified gate rules PASS in-log. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A doc-sync edit outside docs fails the step naming the path (req: R1) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:1125-1160` over a real temp git repo: an out-of-scope edit fails naming `apps/app/tests/decision/decision-log-query.test.ts`, the task/feature corpus and an untracked path are caught, while an edit confined to `docs/design/keep.md` records PASS. Fail-sensitivity confirmed by construction this pass (`bun plugins/sp/scripts/wrapup-steps.ts <unknown>` -> exit 2 and no status file, so the `code`/`readStatus` assertions fail without the subcommand); no recorded fail-without-fix transcript exists (disclosed). |
| AC2 — A resurrected delinked row fails at doc-sync, not at doc-tripwire (req: R2) | MET | test | `plugins/sp/tests/wrapup-steps.test.ts:1188-1210` drives the real pin: absent -> PASS, a failing fixture -> `supersession-pin-failed: repo-wide-tests/adr-supersession.test.ts`, clean -> PASS. The pin file is unchanged (`git status --porcelain` empty for `repo-wide-tests/adr-supersession.test.ts`) and `doc-tripwire`/`docTripwireCmd` carry no diff line. Fail-sensitivity by construction (same exit-2 path); no recorded fail-without-fix transcript (disclosed). |
| AC3 — A lifecycle onEnter failure shows the nested stderr (req: R3) | MET | test | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:543-616` fails a real onEnter shell that writes "boom-equivalent" markers plus a configured secret and exits 7; the denial report contains `exit 7`, the tail markers and `[REDACTED]`, and contains no literal secret. Fresh run pass. |
| AC4 — Nested and standalone feature verification agree (req: R4) | MET | test | `plugins/sp/tests/feature-verification-scope.test.ts:143-179` asserts the shipped caller contains `env -u SPUR_WORKFLOW_RUN_ACTIVE`, then runs that command string with the marker set and a stub child, observing the child env is `unset` (exit 0). Root cause independently reproduced this pass at the CLI. Caveat stated: the equivalence is observed at the child-env mechanism (the stub child), not in a recorded end-to-end wrapup that prints a verification receipt. |
| AC5 — Workflow comments and bundle reflect the scope check (req: R5) | MET | command | Certified gate `.spur/run/1147-test-gate.log` runs the repo rule preset -> "All 2 rules passed — no violations found"; fresh `bun scripts/commands/script-contract-check.ts` -> PASS (0 violations); fresh `workflow validate config/workflows/wrapup-pipeline.yaml` -> exit 0 (warn-level composition findings only); the wrapup comments/docs name the two checks (`config/workflows/wrapup-pipeline.yaml:583-586`, `docs/design/essential-workflow-checks.md:174-190`); the bundle mirror carries version "8" and both check commands (`apps/cli/config/workflows/wrapup-pipeline.yaml:98`, `apps/cli/config/workflows/wrapup-pipeline.yaml:297`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1147 (wrapup write-scope guard and nested feature-transition verification)

**Scope:** task 1147's own diff — `config/workflows/feature-lifecycle.yaml`, `config/workflows/wrapup-pipeline.yaml`, `apps/cli/src/workflow/make-lifecycle-adapter.ts`, `packages/app/src/workflow/lifecycle-adapter.ts`, `plugins/sp/scripts/wrapup-steps.ts` (+ `.mjs` twin), `config/script-placement-baseline.json`, 4 test files, `docs/design/essential-workflow-checks.md`, `docs/design/planning-workflow-contracts.md`. Sibling tasks 1137/1144's uncommitted work was excluded.
**Dimensions:** functional (R1–R5, AC1–AC5), correctness, security, efficiency, usability, architecture.
**Verdict:** PASS

Independently re-verified (this review, fresh): 111 tests pass / 0 fail across the four touched suites; `bun scripts/commands/script-contract-check.ts` → PASS (0 violations); `spur workflow validate config/workflows/wrapup-pipeline.yaml` → valid(8), warn-level composition findings only; the nested-run guard reproduced directly at the CLI (see R4).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Compound routing: doc-sync's `contract-violation` edge (declared first) is evaluated before the two new deterministic-check edges, and the engine's `firstPassingTransition` returns the first match in declaration order. A doc-sync that both misses its learnings post-condition and writes out of scope (or resurrects a delinked row) therefore routes to `repair` → `doc-tripwire` → `metrics` instead of failing the step; the violation is still written to the status file and echoed on stderr, so the evidence is not lost. | `config/workflows/wrapup-pipeline.yaml:588-628`; engine `node_modules/@gobing-ai/ts-dual-workflow-engine/src/state-machine.ts:244-245` | DEFER(follow-up: declare the scope-violation and supersession-pin edges before the contract-violation edge — a one-line reorder that loses nothing for the repair case) |
| 2 | P4 (advisory) | correctness | Pre-existing dirt is compared by whole `git status --porcelain` line, so a doc-sync edit to a file that was ALREADY dirty outside `docs/` yields the identical ` M <path>` line and is not attributed. Inherent to the design's mandated listing-diff ("pre-existing dirt … is never attributed", task Design); the implementer disclosed only the gitignored-path residual, not this one. Relevant because a batch wrap starts with the batch's own uncommitted work in the listing. | `plugins/sp/scripts/wrapup-steps.ts:728-740` | ACCEPTED |
| 3 | P4 (advisory) | evidence | No recorded "test fails without the fix" transcript for the new R1/R2 tests (implementer-disclosed: revert drills interrupted). Verified failure-sensitive by construction instead: with no subcommands `main` returns `2` and writes no status file, so the tests' `runSteps(...).code` → 0 and `readStatus(...)` assertions fail; the R4 test's `env -u` assertion fails on the pre-fix string. | `plugins/sp/tests/wrapup-steps.test.ts:1125-1210`, `plugins/sp/tests/feature-verification-scope.test.ts:143-179` | ACCEPTED |
| 4 | P4 (advisory) | evidence | AC4's regression test proves the *mechanism* (the shipped lifecycle command clears the marker; a stub child sees it unset) rather than the end-to-end "nested verdict == standalone verdict" claim — it stubs `$spurBin` and never runs a real nested workflow. The mechanism was independently confirmed at the CLI (see R4 evidence). | `plugins/sp/tests/feature-verification-scope.test.ts:143-179` | ACCEPTED |
| 5 | P4 (advisory) | correctness | The two git-unavailable branches — snapshot records `# git-unavailable:` and the check skips; `git status` fails at check time and the check writes `scope-violation: git-unavailable` — have no test (coverage shows `wrapup-steps.ts:784-786,822-823,827` uncovered). Their fail-open/fail-closed behaviour is reasoned, not observed. | `plugins/sp/scripts/wrapup-steps.ts:783-786`, `plugins/sp/scripts/wrapup-steps.ts:821-827` | ACCEPTED |

##### Functional Traceability

| Req / AC | Status | Evidence |
|---|---|---|
| R1 — scope guard (snapshot → post-check, allowed globs, `scope-violation: <paths>`, reported not reverted, missing snapshot fails closed, pre-existing dirt never attributed) | MET | Snapshot action declared BEFORE the `agent.run` and the two checks after it (`config/workflows/wrapup-pipeline.yaml:252-268, 288-330`); structural pin asserts the kind order `['shell','agent.run','shell','shell']` (`packages/app/tests/workflow/wrapup-pipeline.test.ts:636-645`). Logic: `plugins/sp/scripts/wrapup-steps.ts:709-786` (`isDocSyncAllowedPath` excludes `docs/tasks*`/`docs/features*`), `:728-740` (listing diff, `PASS`/`scope-violation: <paths>`, always exit 0 per 0783 R4), `:829-834` (missing snapshot ⇒ `scope-violation: snapshot-missing`). Fail edge declared before `action-ok`: `config/workflows/wrapup-pipeline.yaml:606-616`. Tests: `plugins/sp/tests/wrapup-steps.test.ts:1125-1190` (in-scope pass; out-of-scope + corpus + untracked fail naming the path; declared learnings capture allowed; pre-existing dirt never attributed; missing snapshot fails closed). |
| R2 — supersession pin re-run before `doc-tripwire`, prompt states the delinked row is intentional, tripwire never weakened | MET | `plugins/sp/scripts/wrapup-steps.ts:842-866` re-runs `repo-wide-tests/adr-supersession.test.ts`, writes `supersession-pin-failed: <pin>`, skips when the pin is absent, always exits 0; fail edge `config/workflows/wrapup-pipeline.yaml:617-628`; prompt clause `:273-275`; test `plugins/sp/tests/wrapup-steps.test.ts:1180-1210` (absent pin ⇒ PASS; failing pin ⇒ named; clean pin ⇒ PASS). `doc-tripwire` / `docTripwireCmd` carry zero diff lines; `repo-wide-tests/adr-supersession.test.ts` is unmodified (`git status` clean). |
| R3 — last 2 KiB **by bytes** of redacted child stderr in the `GuardDeniedError` | MET | `packages/app/src/workflow/lifecycle-adapter.ts:37` (`ENTER_STDERR_TAIL_BYTES = 2048`), `:347-357` (redact the FULL stderr with `configuredSecretValues`, THEN `utf8SafeByteTail`); byte-tail primitive is the existing `packages/app/src/workflow/actions/shell.ts:21-27` (advances past continuation bytes — never char-sliced). Secrets reach the adapter through the one production construction: `apps/cli/src/workflow/make-lifecycle-adapter.ts:47-49` (`configuredSecretValues(context.env ?? {})`, the same source the run's shell-output redactor uses). Test `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:543-617`: asserts `BOUNDMARK` (2026 bytes from the end — inside 2 KiB, outside the former 2000-char slice), `HEADMARK` absent, `[REDACTED]` present and the literal secret absent, `exit 7` present, report length bounded. |
| R4 — root cause + shared-path fix; nested == standalone; guard binds everywhere else | MET | Root cause confirmed independently: with `SPUR_WORKFLOW_RUN_ACTIVE=1`, `bun apps/cli/src/index.ts workflow run <def>` refuses with the `workflow.ts:695` message **on stderr** and exit 1; with `env -u SPUR_WORKFLOW_RUN_ACTIVE` the refusal does not fire (it proceeds to definition resolution). Child env does inherit the marker (`packages/app/src/workflow/actions/child-env.ts:20-27` merges the parent env). Fix is the ONE shared invocation path: `config/workflows/feature-lifecycle.yaml:60` is the single `workflow run feature-verification.yaml` caller in `config/` (grep: 1 occurrence). Boundedness: `feature-verification.yaml` declares no `agent.run` and no nested run; a workflow run re-marks itself for its own children (`apps/cli/src/commands/workflow.ts:814-831, 1167-1188`), so the recursion guard binds one level down. Guard still binds everywhere else: exactly one `env -u SPUR_WORKFLOW_RUN_ACTIVE` occurrence in the repo, in that one command. Test: `plugins/sp/tests/feature-verification-scope.test.ts:143-179` (runs the shipped command string with the marker set; the child sees `unset`). |
| R5 — comments/docs + bundle in the same change | MET | Workflow comments + `failed` prose `config/workflows/wrapup-pipeline.yaml:26-34, 244-248, 521-524, 583-586, 606-628`; onEnter error contract + nested-invocation contract in `docs/design/planning-workflow-contracts.md:56-72`; wrapup contract in `docs/design/essential-workflow-checks.md:174-190`. Version tags bumped and pinned: `wrapup-pipeline` 7→8 (`config/workflows/wrapup-pipeline.yaml:98`), `feature-lifecycle` 1→2 (`features-lifecycle.yaml:12`), pins in `packages/app/tests/workflow/wrapup-pipeline.test.ts:115-152`. Bundle evidence: the gitignored generated mirror `apps/cli/config/workflows/{feature-lifecycle,wrapup-pipeline}.yaml` carries `version: "2"`/`"8"` and the `env -u` fix; the `.mjs` twin carries all three subcommands and the identical helpers (`plugins/sp/scripts/wrapup-steps.mjs:446-545, 576-594`). |
| AC1 (out-of-scope doc-sync edit fails naming the path; in-scope `docs/design/*.md` passes) | MET | `plugins/sp/tests/wrapup-steps.test.ts:1125-1160`. |
| AC2 (resurrected delinked row fails at doc-sync naming the pin; the pin file unchanged) | MET | `plugins/sp/tests/wrapup-steps.test.ts:1180-1210`; `repo-wide-tests/adr-supersession.test.ts` unmodified. |
| AC3 (onEnter failure shows the nested stderr) | MET | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:543-617`. |
| AC4 (nested and standalone agree; regression test fails without the fix) | MET with the noted evidence caveat | `plugins/sp/tests/feature-verification-scope.test.ts:143-179` + the CLI reproduction above; end-to-end equivalence is asserted structurally, not observed in a recorded run (finding 4). |
| AC5 (workflow comments + bundle; `spur-check` and the rebuild pass) | MET | Certified gate `.spur/run/1147-test-gate.status` = PASS (0 fail, digest `sha256:fb94467…`); this review re-ran `script-contract-check.ts` → PASS and `workflow validate` → valid(8). |

##### Dimension notes

- **Security.** R3 closes the leak the design's failure inventory named: redaction runs on the full stderr before the bound is taken, so a secret split across the 2 KiB boundary is still redacted, and the only production adapter construction supplies the configured secret values (verified: one `new LifecycleAdapter(` in `apps/cli`). No new secret surface.
- **Efficiency.** The new steps add no model query (`config/pipeline-budgets.json` `wrapup-pipeline.modelQueries = 1` still holds); the supersession re-run is one bounded `bun test` of a single file and is skipped when the pin is absent. `redactAndBound` over full stderr is linear and already the 0901 shell-redactor behaviour.
- **Usability / architecture.** The guards live in the workflow, the logic in the owner script, and the failure edges are named and documented; the placement exemption is honest and minimal (one `kind` added to an existing exempt entry — a path-prefix *exclusion* trips the checker's literal `docs/tasks`/`docs/features` substring rule, the same class already carried by `wrapup-drift-probe.ts`; `script-contract-check.ts` PASSes with it, and there is no honest way to test the prefix without the literal).
- **Residuals carried from the implementer (agreed, non-blocking).** A doc-sync write into a globally gitignored path (`.spur/run` is gitignored) is invisible to the listing diff; `workflow validate` reports warn-level composition findings on the new locator wrappers (6 logical commands vs the warn threshold of 5), the same warn class the pre-existing wrappers carry.

**Next:** no blocking fix; one deferrable follow-up (finding 1 — reorder the two deterministic fail edges ahead of the `contract-violation` edge).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:08:17.886Z backlog → todo (system)
- 2026-10-10T05:10:57.285Z todo → wip (system)
- 2026-10-10T05:39:15.999Z wip → testing (system)
- 2026-10-10T05:40:22.160Z testing → done (system)

