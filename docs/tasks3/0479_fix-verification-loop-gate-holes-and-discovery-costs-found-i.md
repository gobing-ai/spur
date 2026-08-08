---
template: meta
schema_version: 1
name: "Fix verification-loop gate holes and discovery costs found in the 0477 re-verify session"
description: ""
status: done
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T03:19:09.696Z"
updated_at: "2026-08-08T05:06:55.194Z"
---

## 0479. Fix verification-loop gate holes and discovery costs found in the 0477 re-verify session

### Background
Verifying task 0477 consumed a full session (2026-08-07T23:30Z → 2026-08-08T03:17Z, ~3h47m wall,
75 tool calls, 0 compactions). The verdict was ultimately PASS, but the session existed **only
because a prior run marked 0477 `done` while its Testing section recorded
`Verdict: UNKNOWN — No requirements recorded`**. The done-gate accepted a verdict artifact carrying
zero requirement rows, so "done" did not mean verified — the exact guarantee the pipeline exists to
provide.

Forensic analysis of the session log identified six root causes across two classes: **one gate
hole** (B1) that lets unverified work reach `done`, and **five discovery/loop costs** (B2–B6) where
a contract existed but was not discoverable until a checker rejected the work. B2 is a direct
contradiction between two shipped skills: `sp:code-verification` tells the agent to cite evidence as
`file:line` and never states the path must be repo-relative, while
`plugins/sp/skills/issue-finding/SKILL.md:288` prescribes a **bare filename**
(`SupervisorTab.tsx:17-20`) as the correct form — precisely what the `L4.stale-line-anchor` checker
rejects.

Time cost is dominated by B1 (an entire re-verification session) rather than by tool-loop spinning;
the loop costs are individually small (2–12 min each) but recur on **every** verify, so they
compound across the task corpus. Nothing here is a defect in 0477's own deliverable.
### Requirements
- [x] **R1 — Done-gate must reject an empty or UNKNOWN verdict artifact.** The `testing → done`
      transition currently accepts a verdict whose `requirements[]` is empty or whose verdict is
      `UNKNOWN`. Treat both as a hard gate failure (`L4.malformed-verdict-artifact` already exists
      as a finding code in `packages/config/src/finding-codes.ts`). Target: the done-gate check in
      `packages/app/src/services/task-check.ts` plus the gate contract in
      `plugins/sp/skills/spur-dev/references/gate-checklists.md` § done-gate. Measurable: a task
      whose verdict artifact has 0 requirement rows cannot reach `done`.

- [x] **R2 — State the repo-relative anchor contract once, and fix the contradicting example.**
      `plugins/sp/skills/code-verification/SKILL.md` says `file:line` at lines 119, 122, 163, 455
      without ever stating that the path must resolve **from the project root**. Add the rule to the
      Step 4 line-anchor paragraph, and correct
      `plugins/sp/skills/issue-finding/SKILL.md:288`, whose example (`SupervisorTab.tsx:17-20`) is a
      bare filename that fails the checker. Measurable: a verify run authored straight from the
      skill produces 0 `L4.stale-line-anchor` findings.

- [x] **R3 — Surface the DD-09 subset rule at AC-write time, not at `--strict-core`.** Task AC
      scenarios must be a subset of the parent feature's AC, but nothing warns when the task AC is
      written; the 18 violations surfaced only later under `task check --strict-core`. Emit the
      `L4.uncovered-task-scenario` warning (or a pointer to it) from
      `spur task update --section "Acceptance Criteria"` when a `feature_id` is set. Measurable:
      writing task AC that is not a feature-AC subset warns in the same command.

- [x] **R4 — Make the flag-parity gate cwd-independent.**
      `plugins/sp/scripts/validate-flag-contracts.ts:594` defaults `root = process.cwd()`, so
      running `bun test` from `plugins/sp/` resolves `plugins/sp/plugins/sp/commands` and reports a
      **false** gate failure. Its sibling `plugins/sp/tests/command-contract.test.ts:16` derives ROOT
      from `import.meta.dir` and is immune. Adopt the same derivation. Measurable: the sp suite
      yields identical results from the repo root and from `plugins/sp/`.

- [x] **R5 — Capture the failure list from the first suite run.** This session ran the full suite
      three times (`bun run test`, `bun run spur-check`, then `bun test` again purely to enumerate
      failures) at ~65s each; one run plus retained output was sufficient. Add the
      run-once-and-parse instruction to
      `plugins/sp/skills/spur-dev/references/execution-workflow.md`. Measurable: no more than two
      full-suite executions per task, matching the existing CLAUDE.md § Verification gate rule.

- [x] **R6 — Document the sandbox baseline so `spur-check` failure is interpretable.**
      `bun run spur-check` exits 1 in the restricted sandbox because 24 port-binding tests cannot
      listen on `127.0.0.1`, making the project's own comprehensive gate permanently red locally and
      training agents to ignore it. Record the known-24 baseline and the cheap file-triage method in
      `plugins/sp/skills/spur-dev/references/gate-checklists.md`. Measurable: the gate section names
      the environmental class and the triage step.
### Acceptance Criteria
```gherkin
Feature: Verification-loop gate holes and discovery costs

  Scenario: R1 A verdict artifact with no requirement rows blocks done
    Given a task at "testing" whose verdict artifact has an empty requirements array
    When the testing-to-done transition is attempted
    Then the transition is refused
    And the failure names the malformed verdict artifact
    And a verdict recorded as UNKNOWN is refused on the same path

  Scenario: R2 Evidence anchors authored from the skill pass the checker
    Given an agent authoring a Testing section directly from sp:code-verification
    When it records file:line evidence following the skill text
    Then the paths are repo-relative from the project root
    And spur task check --strict-core reports 0 L4.stale-line-anchor findings
    And the issue-finding skill's citation example is repo-relative

  Scenario: R3 Non-subset task AC warns at write time
    Given a task with a feature_id whose parent feature AC lacks the task's scenarios
    When the task Acceptance Criteria section is written via spur task update
    Then the command warns that the scenarios are not a feature-AC subset
    And the operator learns this without running task check --strict-core

  Scenario: R4 The sp suite is cwd-independent
    Given the sp plugin test suite
    When it runs from the repository root and again from plugins/sp
    Then both runs report the same pass and fail counts
    And neither reports a path containing plugins/sp/plugins/sp

  Scenario: R5 A task needs at most two full-suite executions
    Given a task whose verification requires the full test suite
    When the suite is run and reports failures
    Then the failure list is parsed from that run's retained output
    And the suite is not re-executed solely to enumerate failures

  Scenario: R6 The sandbox baseline is documented and actionable
    Given spur-check exits non-zero in the restricted sandbox
    When an agent consults the gate checklist
    Then it finds the known environmental failure count and its cause class
    And it finds the file-triage step that distinguishes environmental from real failures
```
### Q&A
**Q: Why is B1 the headline when its tool-loop cost is near zero?**
A: Cost is not the right axis for a gate hole. B1 let a task reach `done` with an empty verdict —
a correctness failure in the one guarantee the pipeline sells. The 3h47m re-verify session is its
*consequence*, not its measure. Every task that passed the same gate is now of unknown verification
status.

**Q: Are these fixes guidance or code?**
A: Split. R1, R3, R4 are code (`task-check.ts`, the section-write path,
`validate-flag-contracts.ts`). R2, R5, R6 are guidance in shipped skill references. The skill's own
bias toward documentation fixes holds for R2/R5/R6; R1 and R4 are genuine defects where guidance
would not help.

**Q: Why not fold these into 0477?**
A: 0477's deliverable verified PASS with all 10 requirements MET. None of these six findings is a
defect in it — they are properties of the verification apparatus that 0477 happened to exercise.
Folding them in would reopen a correctly-closed task.

**Q: R4 is a one-line change — does it deserve a requirement?**
A: Yes, because its failure mode is a *false* gate failure. An agent running the sp suite from the
package directory sees a red gate that is not real, and the plausible reactions (investigate the
flag contract, "fix" a passing gate) are all wasted or harmful. Cheap to fix, disproportionate to
leave.

**Q: How was B2 established rather than inferred?**
A: By reading both surfaces. `plugins/sp/skills/code-verification/SKILL.md` says `file:line` at
four sites and never states repo-relative; `plugins/sp/skills/issue-finding/SKILL.md:288` gives a
bare filename as the correct form. The checker resolves from the project root
(`packages/app/src/services/task-check.ts`, runL4). The three surfaces do not agree.

**Q: What should NOT be changed?**
A: The 24 sandbox test failures are environmental, not regressions — R6 documents them rather than
suppressing them. Do not add skip flags that would hide real port-binding regressions.
### Design
#### Fix targets

| Req | Kind | Target | Change |
|---|---|---|---|
| R1 | code | `packages/app/src/services/task-check.ts` (done-gate) + `plugins/sp/skills/spur-dev/references/gate-checklists.md` | Reject verdict artifacts with empty `requirements[]` or `verdict: UNKNOWN`; reuse `L4.malformed-verdict-artifact` |
| R2 | guidance | `plugins/sp/skills/code-verification/SKILL.md` Step 4; `plugins/sp/skills/issue-finding/SKILL.md:288` | State "repo-relative from project root"; replace the bare-filename example |
| R3 | code | section-write path behind `spur task update --section` | Emit the DD-09 subset warning when `feature_id` is set |
| R4 | code | `plugins/sp/scripts/validate-flag-contracts.ts:594` | Derive default root from `import.meta.dir`, matching `command-contract.test.ts:16` |
| R5 | guidance | `plugins/sp/skills/spur-dev/references/execution-workflow.md` | Run the suite once; parse failures from retained output |
| R6 | guidance | `plugins/sp/skills/spur-dev/references/gate-checklists.md` | Record the environmental baseline + file-triage step |

#### Sequencing rationale

R1 first: it is the only finding that admits incorrect work into `done`, so every session run before
it lands can produce another unverified task. R4 next — one line, removes a false red gate. R2 and
R3 are the two discovery costs that recur per-task. R5 and R6 are guidance-only and can land with
either.

#### Deliberately not proposed

- No skip flag for the 24 port-binding tests. Suppressing them would hide genuine port regressions;
  R6 documents the class instead.
- No new rule authored here. If the anchor-format anti-pattern recurs in a second session, hand off
  to `/sp:rule-scan` rather than inventing a rule inside this task.
### Plan
- [x] **P1 — R1 done-gate rejection.** Reject empty/UNKNOWN verdict artifacts at `testing → done`;
      extend the gate-checklist contract. Add a regression test for a zero-row artifact.
- [x] **P2 — R4 cwd-independence.** Default `validate()`'s root from `import.meta.dir`; assert the
      sp suite gives identical results from both working directories.
- [x] **P3 — R2 anchor contract.** Add the repo-relative rule to `code-verification` Step 4; fix the
      contradicting example in `issue-finding/SKILL.md:288`.
- [x] **P4 — R3 DD-09 write-time warning.** Emit the subset warning from the AC section-write path.
- [x] **P5 — R5 suite-run discipline.** Add the run-once-and-parse instruction to
      `execution-workflow.md`.
- [x] **P6 — R6 sandbox baseline.** Document the 24-failure environmental class and file-triage in
      `gate-checklists.md`.
- [x] **P7 — Gate.** `bun run autofix && bun run lint`; targeted tests for P1/P2; `spur task check 0479`.
### Solution
| Change (`file:line`) | Description |
|----------------------|-------------|
| `packages/app/src/services/task-check.ts:615-620` | R1: Reject verdict artifacts with empty `requirements[]` or `verdict: UNKNOWN` using `L4.malformed-verdict-artifact` |
| `plugins/sp/skills/code-verification/SKILL.md:119` | R2: Add repo-relative path requirement for evidence citations in Step 4 |
| `plugins/sp/skills/issue-finding/SKILL.md:288` | R2: Update `file:line` citation example to repo-relative path |
| `packages/app/src/services/task-service.ts:1095-1150` | R3: Emit DD-09 AC subset warning on `Acceptance Criteria` section write when task has `feature_id` |
| `plugins/sp/scripts/validate-flag-contracts.ts:594-601` | R4: Derive `validate()` default root from `import.meta.dir` for CWD independence |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:57-58` | R5: Document single-run and failure parsing discipline for suite cost control |
| `plugins/sp/skills/spur-dev/references/gate-checklists.md:142-143` | R6: Document two-sided 24-failure corpus baseline discipline |
### Testing
**Verdict: PASS** — re-audit via `/sp:dev-verify 0479 --auto --next --force --focus all --fix all`
(2026-08-08), after a fix pass that repaired two requirements which had shipped **non-functional**.

**Two requirements failed the initial audit.** R3 and R6 were marked done in `## Solution` but did
not do what they claimed. Both were caught only because this run re-executed the checks instead of
trusting the Solution change-map — the exact failure mode this task's own R1 exists to prevent.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `packages/app/src/services/task-check.ts:1152-1160` — rejects `isUnknown \|\| isEmpty` with `L4_MALFORMED_VERDICT_ARTIFACT` at `severity: 'error'` (blocking); dispatched from `:617-620` on `testing`/`done`. **Proven live:** the gate caught a real malformed artifact this run (see fix pass 3). |
| R2 | MET | `plugins/sp/skills/code-verification/SKILL.md:119` now reads "repo-relative path `file:line`, e.g. `packages/app/src/services/task-check.ts:42`"; `plugins/sp/skills/issue-finding/SKILL.md:288` now reads "repo-relative `file:line` … never bare `:line` or bare filename without path" — the contradicting example is gone. |
| R3 | MET | **Repaired this run.** `packages/app/src/services/task-service.ts:1123-1137` — prefix scan for `<id>_*.md`. Before: 0 warnings on a known non-subset write. After: 9, matching `task check`. Regression tests: `packages/app/tests/services/task-service.test.ts` § "DD-09 AC subset warning (0479 R3)", 2 pass, mutation-checked. |
| R4 | MET | `plugins/sp/scripts/validate-flag-contracts.ts:594-598` — `MODULE_ROOT` from `import.meta.dir`; `validate(root = MODULE_ROOT)`. **Proven from the failing directory:** `cd plugins/sp && bun test tests/flag-contract-parity.test.ts` → 24 pass / 0 fail (previously ENOENT on `plugins/sp/plugins/sp/commands`). |
| R5 | MET | `plugins/sp/skills/spur-dev/references/execution-workflow.md:57` — single-run & parse discipline: run full suites at most once per iteration, parse failures from retained output, re-run targeted files while iterating. |
| R6 | MET | **Repaired this run.** `plugins/sp/skills/spur-dev/references/gate-checklists.md:144-157` now documents the sandbox port-binding class, the seven affected suites, the one-line reproduction, and the file-triage method. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| R1 A verdict artifact with no requirement rows blocks done | MET | command | `spur feature check H1` surfaced `L4.malformed-verdict-artifact` against `.spur/run/0477-verdict.json`; cleared after repair |
| R2 Evidence anchors authored from the skill pass the checker | MET | command | `spur task check 0479 --strict-core` → `pass=true, errors=0`; 0 `L4.stale-line-anchor` |
| R3 Non-subset task AC warns at write time | MET | test | `packages/app/tests/services/task-service.test.ts` § DD-09 — 2 pass; mutation → 1 fail, restore → 2 pass |
| R4 The sp suite is cwd-independent | MET | command | 24 pass / 0 fail from both repo root and `plugins/sp/` |
| R5 A task needs at most two full-suite executions | MET | static | `plugins/sp/skills/spur-dev/references/execution-workflow.md:57` |
| R6 The sandbox baseline is documented and actionable | MET | static | `plugins/sp/skills/spur-dev/references/gate-checklists.md:144-157` |

**Gates run this turn**

- `bun test packages/app/tests/services/task-service.test.ts packages/app/tests/services/task-check.test.ts` → **190 pass / 0 fail** (188 + 2 new).
- `bun test plugins/sp/tests/` → **496 pass / 0 fail**; `cd plugins/sp && bun test tests/flag-contract-parity.test.ts` → **24 pass / 0 fail**.
- `bun run lint` → clean, 7/7 workspaces typecheck.
- `spur task check 0479 --strict-core` → **pass=true, errors=0**.
- Coverage: N/A for the two documentation repairs; the R3 code repair is covered by the 2 new tests.

**Fix pass (`--fix all`) — three repairs**

1. **R3 was a silent no-op.** `checkAcSubsetWarning` probed `<id>_feature.md` then `<id>.md`, but
   feature files are `<id>_<slug>.md` (e.g. `H1_spur-dev-skill.md`). The lookup never matched, so
   the function always returned `[]` and the warning could not fire. Replaced with the prefix scan
   already proven in `packages/app/src/services/task-check.ts:1055-1067` (`findFeatureFile`). It
   shipped green because **no test covered it at all** — the two regression tests added here fail
   if the broken probe returns.
2. **R6 documented the wrong mechanism and asserted a false number.** The written paragraph covered
   `corpus-check`'s structural corpus baseline — a different gate — and called
   `config/corpus-baseline.json` "the 24-failure baseline"; that file has **8** entries. R6 asked
   for the *sandbox* baseline: ~24 port-binding test failures that make `spur-check` exit 1
   regardless of code health. Removed the false parenthetical and added the actual sandbox-baseline
   block with triage guidance.
3. **`.spur/run/0477-verdict.json` was malformed** — `acceptanceCriteria` was written as a summary
   object (`{total, met, …}`) where the schema requires an array of rows. Rebuilt as an 18-row array
   with `id`s matching the feature scenario titles. This both cleared the finding and dropped H1's
   `L4.scenario-unverified` count from **48 → 30**.

**Artifact disclosure.** This run wrote `.spur/run/0479-verdict.json` (gitignored) and rewrote
`.spur/run/0477-verdict.json` `acceptanceCriteria` (object → 18-row array) as repair 3 above.

**Shippable: FAIL — feature H1.** Not caused by 0479. `spur feature check H1` reports 30 ×
`L4.scenario-unverified` and 4 × `L4.uncovered-feature-scenario`, plus 1 incomplete linked task
(**0480**, created 2026-08-08 and still `todo`). Recovery: re-verify the tasks behind the remaining
unverified scenarios so they carry PASS+MET verdict rows, cover the 4 orphan scenarios, and complete
0480 — none of which is 0479 work.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References
- Session log: `~/.claude/projects/-Users-robin-xprojects-spur-new/b7858a7d-0749-48b5-9278-6645b185a68b.jsonl`
  (source: claude, confidence **High** — native adapter, 392 lines, 75 tool calls, 0 compactions,
  window 2026-08-07T23:30:30Z → 2026-08-08T03:17:48Z).
- Subject task: `docs/tasks3/0477_batch-worktree-isolation-worktree-for-dev-runall-dev-refinea.md`
  (verdict PASS after re-audit; not itself defective).
- `packages/config/src/finding-codes.ts` — `L4.malformed-verdict-artifact`,
  `L4.stale-line-anchor`, `L4.scenario-unverified` finding codes (R1, R2, R3).
- `packages/app/src/services/task-check.ts` — runL4 resolves citations from the project root (R1, R2).
- `plugins/sp/scripts/validate-flag-contracts.ts:594` — `process.cwd()` default (R4).
- `plugins/sp/tests/command-contract.test.ts:16` — the `import.meta.dir` pattern R4 should adopt.
- `plugins/sp/skills/code-verification/SKILL.md` lines 119, 122, 163, 455 — `file:line` without the
  repo-relative qualifier (R2).
- `plugins/sp/skills/issue-finding/SKILL.md:288` — the contradicting bare-filename example (R2).
- `CLAUDE.md` § Verification gate — the existing two-runs-per-task cap that R5 operationalizes.
- `docs/tasks3/0478_fix-pipeline-bottlenecks-from-task-0477-run-size-gate-surpri.md` R2 — the
  **producer** half of this task's R1. R1 here hardens the *consumer* (the done-gate rejects an
  empty/UNKNOWN verdict artifact); 0478 R2 fixes the *producer* (the verify stage must emit a
  parseable answer file). Landing only R1 turns a malformed answer into a hard pipeline failure
  with no diagnosis; landing only 0478 R2 leaves the gate open to any other malformed path. They
  are two halves of one failure and should be read together.
### History
- 2026-08-08T04:07:08.780Z todo → wip (system)
- 2026-08-08T04:31:45.701Z wip → testing (system)
- 2026-08-08T04:31:48.035Z testing → done (system)
### Notes

#### RC1 — Done-gate accepts an empty verdict artifact (S1)

**Evidence.** Task 0477 carried `status: done` while its Testing section read
`Verdict: UNKNOWN (from verdict artifact)` and `No requirements recorded; verify verdict UNKNOWN`.
`plugins/sp/skills/code-verification/SKILL.md` states only `PASS` clears the completion gate, and
`packages/config/src/finding-codes.ts` already defines `L4.malformed-verdict-artifact` — the code
exists but nothing rejected a zero-row artifact at the transition.

**Cost.** One full re-verification session (2026-08-07T23:30Z → 2026-08-08T03:17Z). Recurring for
every task whose verify step produces no parseable table.

#### RC2 — `file:line` contract underspecified, and contradicted across skills (S2)

**Evidence.** `plugins/sp/skills/code-verification/SKILL.md` lines 119, 122, 163, 455 all say
`file:line`; none says repo-relative. `plugins/sp/skills/issue-finding/SKILL.md:288` prescribes
`SupervisorTab.tsx:17-20` — a bare filename — as correct. The checker resolves from the project
root and emitted 5 × `L4.stale-line-anchor` on exactly that form.

**Cost.** Three Testing-section rewrites (~12 min), recurring on every verify that cites evidence.

#### RC3 — DD-09 subset rule surfaces too late (S2)

**Evidence.** 18 × `L4.uncovered-task-scenario` appeared only at `task check --strict-core`, long
after the AC was authored. Sibling tasks 0141 and 0161 already had their scenarios promoted into
feature H1, so the convention was established but undiscoverable at write time. The late signal also
produced a wrong judgment call — the gap was first triaged as "operator call, probably the wrong
repair" before the sibling evidence corrected it.

**Cost.** ~10 min plus one reversed decision.

#### RC4 — Flag-parity gate is cwd-dependent (S2)

**Evidence.** `plugins/sp/scripts/validate-flag-contracts.ts:594` —
`export function validate(root: string = process.cwd())`; `plugins/sp/tests/flag-contract-parity.test.ts:247`
calls `validate()` with no argument. Running `bun test` from `plugins/sp/` produced
`ENOENT: scandir '/Users/robin/xprojects/spur-new/plugins/sp/plugins/sp/commands'` and a false
`1 fail`. `plugins/sp/tests/command-contract.test.ts:16` derives ROOT from `import.meta.dir` and is
immune.

**Cost.** ~5 min false-alarm investigation; recurs for anyone running the package suite in place.

#### RC5 — Full suite executed three times (S2)

**Evidence.** Session log: `bun run test`, `bun run spur-check` (re-runs the suite), then
`bun test 2>&1` solely to enumerate failures — ~65s each. CLAUDE.md § Verification gate already caps
this at two per task; no mechanism enforced it.

**Cost.** ~2–3 min per task, compounding across batch runs.

#### RC6 — `spur-check` is permanently red in the sandbox (S2)

**Evidence.** 24 failures, all `Failed to listen at 127.0.0.1`, across seven port/serve/registry
suites in files untouched by this work. The gate therefore exits 1 regardless of code health.

**Cost.** Low per session, but it erodes the gate's signal value — an always-red gate gets ignored.

#### What worked well (preserve)

- **Mutation-testing a suspected coverage gap.** Adding `--worktree` to `dev-next.md` made the
  parity gate fail with a precise message, then reverting restored green. This disproved a proposed
  finding in ~2 min and avoided writing an unnecessary test.
- **File-triage instead of a baseline run.** Listing failing test *files* and grepping them for the
  changed surface classified all 24 failures as environmental in seconds, with no repo mutation —
  materially cheaper than a stash- or worktree-based baseline.

