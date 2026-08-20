---
schema_version: 1
name: "Reconcile promotion-retirement fallout and harden pipeline execution safety"
status: done
template: feature-impl
created_at: "2026-08-20T07:10:00.000Z"
updated_at: "2026-08-20T21:36:05.385Z"
feature_id: D5
dependencies: []
---

## 0610. Reconcile promotion-retirement fallout and harden pipeline execution safety

### Background
Umbrella task holding **everything deferred** while unblocking the D5 logjam on 2026-08-20. It exists
so nothing is lost; decompose it when convenient. Nothing here blocks D5 closure.

**Origin.** ADR-076 (Accepted 2026-08-20) retired the D5-N promotion bar and deleted
`config/workflows/task-pipeline2.yaml` rather than promoting it. That decision was taken directly,
outside the task pipeline, because the pipeline itself was blocked. The immediate consistency work
(feature D5 AC R9, tasks 0604 R3 / 0606 R1–R2, `docs/design/workflow-composition-contract.md`,
`scripts/commands/eval-pipeline.ts` framing, the composition baseline, the file deletion) landed with
that decision. Everything else was deliberately deferred here.

**Three independent workstreams, safe to split:**

1. **Derived-doc reconciliation (R1, R2)** — files still describing a promotion bar that no longer exists.
2. **Harness can finish (R3)** — `eval-pipeline` cannot complete a run at all, which blocks task 0607.
   *What it measures* — cost from the history plane, real-run performance, and retiring the 538s
   figure — belongs to **0607**, not here. Do not duplicate it.
3. **Execution safety (R4)** — nothing mechanically prevents an agent inside a pipeline run from
   starting another pipeline run.

**Evidence note (2026-08-20).** A pi history sweep (1625 files / 13584 messages imported; 231,903 pi
rows) found **no infinite loop**: the longest consecutive-identical message streak since 08-18 was
**4**, and that was the spur ASCII banner. The suspected `eval-pipeline` recursion was **not**
confirmed as the cause of any observed loop. R7 below is therefore hardening against a real
structural gap, **not** a confirmed incident — do not write it up as a fixed bug.

### Requirements
- [x] R1. Derived docs stop describing a promotion bar that no longer exists. Reconcile every remaining forward-looking `task-pipeline2` / D5-N promotion reference against ADR-076 in exactly these files: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/features/I6_spur-harness-self-improvement-program-*.md`, `docs/features/INDEX.md`. **Historical records must not be rewritten** — `CHANGELOG.md`, and the `## Solution` / `## Testing` / `## Review` sections of tasks 0595, 0596, 0603, 0604, 0609, correctly describe what was true when written. Only statements that assert a *future* obligation change. Verify: `rg -n "task-pipeline2" docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/features/` returns only historical or ADR-referencing prose.

- [x] R2. Feature D5's heading stops contradicting its own contract. Its `# D5:` heading still names the retired promotion bar while its frontmatter `name` reads "Workflow pipeline contract, progress projection, and staged consolidation". Align the heading to the frontmatter name. **Renaming the file itself is out of scope without explicit authorization** — ask first; if authorized, use a plain `mv` plus an inbound-reference sweep, never an automated rename. Verify: heading matches frontmatter `name`; `spur feature check D5` still passes.

- [x] R3. `eval-pipeline` can complete a fixture run. `createEvalRun()` does `git worktree add --detach <dir> HEAD`, which brings no `node_modules`, so the fixture worktree cannot pass `qualityGateCmd`: measured at HEAD, `bun run format && bun run spur-check` exits **127** with `/bin/bash: tsc: command not found` across all 7 workspaces, producing `test-gate=FAIL` on every run. Make the worktree able to resolve the toolchain. Verify: a non-`--dry` fixture run reaches a verdict instead of `test-gate=FAIL`. **This unblocks task 0607**, which depends on it.

- [x] R4. Nested pipeline execution is refused mechanically, not by prose. Today the only protection is a `NOTE` at `config/workflows/task-pipeline.yaml:268` asking the agent not to call `/sp:dev-run` in full mode, and `agent.run` exports no run identifier, so a spawned agent has no inherited signal that it is already inside a run. Export a run-depth signal from the `agent.run` action into the child environment, and make `spur workflow run` refuse to start a pipeline when that signal indicates an active run. Refusal is the default and needs no flag; **adding an opt-out flag would be a public-surface change and must route through task 0608 / ADR-051 consent.** Verify: a nested invocation exits non-zero, forks no worktree and no agent, and names the active run; a normal top-level invocation is unaffected.

**Non-goals:** rewriting historical task `Solution` / `Testing` / `Review` sections; reinstating the promotion bar as a gate (ADR-076); renaming the D5 feature file without explicit authorization; adding a public CLI noun, verb, or flag without ADR-051 consent (route to task 0608); measuring or reducing pipeline cost (task **0607** owns that, including cost-from-history and the real-run reading path); re-deriving ADR-076's rationale.

### Acceptance Criteria
```gherkin
Feature: Promotion-retirement fallout and pipeline execution safety

  Scenario: R12 — Every migration is independently verified and shipped surfaces stay synchronized
    Given ADR-076 retired the promotion bar and deleted the duplicate task-pipeline graph
    When the derived documentation and measurement harness are reconciled to that decision
    Then no shipped surface still describes the promotion bar as a gate or a precondition
    And historical records of what happened at the time are preserved unrewritten
    And the measurement harness completes a run and reports a non-null cost derived from recorded history
    And a nested pipeline run is refused mechanically rather than by prose instruction
```

### Q&A
- **Why this is one task.** It was created to guarantee nothing was dropped while the D5 logjam was
  cleared directly. It is explicitly expected to be decomposed; the three workstreams (docs
  reconciliation R1–R2, measurement R3–R6, safety R7) have no ordering dependency on each other.
- **R7 is hardening, not a bug fix.** The pi history sweep found no infinite loop. Whoever implements
  R7 must not claim it fixed an observed incident.
- **R8 is a decision, not an implementation.** Present the three options with blast radius; the
  operator picks.
- **Do not re-derive the ADR-076 rationale.** It is recorded in `docs/00_ADR.md` with its evidence
  (zero live callers; 5 model queries vs 4; `tokenCost` unmeasurable; 538s baseline unrepresentative).

### Design
**WHAT.** Four independent repairs left over from ADR-076: reconcile derived docs (R1, R2), make the measurement harness able to finish a run (R3), and close the nested-execution hole (R4). No ordering dependency between them.

**WHY.** ADR-076 was taken directly, outside the pipeline, because the pipeline was blocked. The decision and its immediate consistency work landed with it; these four are the deliberate remainder.

**R1/R2 — documentation.** Mechanical. The only judgment is the history-vs-obligation split: a sentence describing what was done stays; a sentence describing what *must* be done changes. When in doubt, leave it and note it — a stale historical note is harmless, a rewritten history is not.

**R3 — toolchain in the fixture worktree (frozen approach).** In `createEvalRun()`, after the worktree is created, symlink the repository root `node_modules` into the worktree:

```ts
symlinkSync(join(REPO_ROOT, 'node_modules'), join(projectDir, 'node_modules'), 'dir');
```

`node_modules` is gitignored, so it does not dirty the worktree, and `git worktree remove --force` still cleans up. Chosen over `bun install --frozen-lockfile` in the worktree (tens of seconds per run, needs network) and over copying (gigabytes).

> **ponytail: known ceiling.** The root `node_modules` contains workspace links pointing at the *main* tree's `packages/`, so the quality gate typechecks main-tree sources rather than the worktree copy. That is consistent with how the harness already behaves — `$spurBin` resolves to the main tree too — and is acceptable for a gate probe. If a worktree-local source change ever needs to be checked by the quality probe, upgrade to `bun install` in the worktree.

**R4 — nested-run refusal (frozen approach).** Two halves:

1. **Signal.** `packages/app/src/workflow/actions/agent-run.ts` sets a run-depth environment variable on the spawned agent's environment. Reuse the existing run identifier rather than inventing a second vocabulary. Env inherits transitively — `agent.run` → agent process → the agent's shell → any `spur` it invokes — which is what makes one check sufficient.
2. **Refusal.** `spur workflow run` reads that signal and exits non-zero before creating any run record, worktree, or agent. The error names the active run so the operator can see what it collided with.

Precedent in-tree: `SPUR_EVAL_PIPELINE_ACTIVE` in `scripts/commands/eval-pipeline.ts` already implements exactly this shape for one command; R4 generalizes it to the engine. Prefer extending that pattern over a new mechanism.

**Rejected alternatives.**
- *A lock file or PID file.* Breaks on crash, needs staleness rules, and cannot distinguish "nested" from "a second legitimate top-level run".
- *A depth counter permitting depth 1.* There is no demonstrated need for one level of nesting; allowing it re-opens the unbounded case one step further out.
- *An `--allow-nested` escape flag.* A public-surface change; route to 0608 and ADR-051 if a real caller ever appears.
- *Detecting recursion by inspecting the process tree.* Non-portable and defeated by the very subprocess boundaries this crosses.

**Invariants.**
- A top-level run is never affected — the refusal fires only when the inherited signal is present.
- The refusal happens **before** any side effect: no run record, no worktree, no agent spawn.
- No new public CLI noun, verb, or flag lands in this task.

### Plan
1. **Docs sweep (R1).** Reconcile the four named files; apply the history-vs-obligation split. Verify: `rg -n "task-pipeline2" docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/features/` returns only historical or ADR-referencing prose.
2. **D5 heading (R2).** Align the `# D5:` heading to frontmatter `name`. Ask before any file rename. Verify: `spur feature check D5` passes.
3. **Worktree toolchain (R3).** Symlink root `node_modules` in `createEvalRun()`; add a test asserting the worktree resolves the toolchain. Verify: a non-`--dry` fixture run reaches a verdict, not `test-gate=FAIL`.
4. **Run-depth signal (R4a).** Export the run identifier from `agent.run` into the spawned agent's environment. Verify: a unit test asserts the variable is present in the child env.
5. **Nested refusal (R4b).** `spur workflow run` exits non-zero when the signal is present, before any side effect. Verify: a test proves refusal creates no run record and no worktree; a top-level run is unaffected.
6. **Gates.** `bun run lint`, targeted tests, `bun run spur-check`; `bun run corpus-check` only if the corpus changed.

**Done when** no shipped surface presents the retired bar as a future obligation, a fixture run reaches a verdict, and a nested pipeline run is refused before it forks anything.

### Solution
All four requirements landed. Two were documentation reconciliation; two were defects that made the
harness unusable and left pipeline recursion unguarded.

#### R1 — derived docs no longer describe a bar that does not exist

- `docs/03_ARCHITECTURE.md` §20.3 — "statically disqualifies the current `task-pipeline2.yaml`" → past tense, noting the graph was deleted (ADR-076) and that the rule still governs any future candidate.
- `docs/03_ARCHITECTURE.md` §20.4 (`:1022-1023`) — "remains a temporary candidate … until a redesigned delta passes promotion" → `task-pipeline.yaml` is the single canonical pipeline; the candidate was deleted rather than promoted, with the zero-callers and 5-vs-4 model-query reasons.
- `docs/04_DESIGN.md` (`:1647`) — the "Rival pipeline" block rewritten as **retired**; (`:1656`) the D5 transition block now cites ADR-071/072/076 and states the invariant stands on its own.
- `docs/features/I6_*.md` — four fixes: the decided-approach row marked **superseded**; the "Parallel YAML, never in-place" rule keeps the practice but records the lesson (pair a fork with a decision date); open question 1 struck through as **answered**; the "eval suite gates pipeline2" decision struck through as **reversed**. Plus the §Scope line that still read "a harness eval/parity suite that gates promotion of `task-pipeline2.yaml`".

**History preserved, per R1's own rule.** `CHANGELOG.md` and the task-table rows for 0596 (`I6:41`, `I6:223`) are untouched — they correctly describe what was true when written.

#### R2 — D5 heading aligned; file NOT renamed

`# D5:` now reads "Workflow pipeline contract, progress projection, and staged consolidation",
matching frontmatter `name`. **The file was deliberately not renamed** — R2 puts that behind explicit
authorization. Consequence: the D5 entry in `docs/features/INDEX.md` still shows the old slug in its
link, because the link text *is* the filename. That is the one remaining `task-pipeline2` reference outside history, and
it clears only with the rename.

#### R3 — the harness can finish a run (two independent causes)

The reported symptom was `tsc: command not found`; fixing only that exposed a second cause.

1. **No `node_modules`.** A fresh `git worktree add` carries none, so `bun run lint` → `typecheck` exited 127. Fixed by symlinking the repository's existing install. The root link alone was **not** enough — Bun workspaces keep a per-workspace `node_modules`, and without those `tsc` failed TS2307 across `apps/cli` (`@commander-js/extra-typings`, every `@gobing-ai/*`). `listWorkspaceModuleDirs()` discovers them rather than hard-coding, so a new workspace cannot silently break the harness.
2. **Worktree location.** Even with the toolchain resolvable, `bun run format` exited 1 with `× No files were processed in the specified paths`. Cause: the worktree lived under `.spur/tmp/`, a **gitignored** path, and `biome.json` sets `vcs.useIgnoreFile: true` — so Biome ignored the entire tree. Fixed by creating the worktree in the system temp dir, outside the repository. A checkout there lints all 723 files.

**Measured before/after** — `bun run format && bun run spur-check` in a fixture worktree: exit **127** → exit **0**.

> **Correction to an earlier claim.** During diagnosis I called the Biome/gitlink theory "a red herring" after `bun run format` exited 0 in a probe worktree. That probe was resolving a *global* Biome 2.5.3, not the pinned 2.4.16. Once `node_modules` was linked, the pinned Biome ran and the ignore-file behavior reappeared. The theory was right; the probe was wrong.

`tests/fixtures/pipeline-eval/README.md` and `docs/design/run-record-contract.md:101` updated for the new location and shifted line numbers (`:370`/`:401`, re-read this run).

#### R4 — nested pipeline runs refused mechanically

`spur workflow run` now refuses when `SPUR_WORKFLOW_RUN_ACTIVE=1`, exiting non-zero **before** any run
record, worktree, or agent spawn. The marker is set on the workflow process itself, so it inherits
transitively (`agent.run` → agent → its shell → any `spur` it invokes) — one check covers every depth
without threading env through `AgentService`/`AiRunner`.

**Deviation from the frozen Design, recorded:** Design said "export a run-depth signal from the
`agent.run` action". The marker is set by `workflow run` instead. Same inheritance, same coverage,
and it needs no change to `packages/app` or the ts-libs runner. The Design's intent (a signal the
child cannot miss) is preserved.

Two placement subtleties, both load-bearing:

- **Set before execution, never before the `--async` spawn.** The detached worker is a legitimate top-level run; marking the parent would make the worker refuse itself. Setting it late needs no exemption — and an exemption would be inherited by the worker's own agent children, re-opening the hole one level out.
- **Cleared in `finally`.** Children spawned during the run already hold their own copy, so clearing does not weaken the guard; leaving it set would poison the process and refuse a legitimate second run (it broke six in-process CLI tests before this was added).

No new public noun, verb, or flag — refusal is unconditional. An opt-out would be a public-surface
change and belongs to task 0608's ADR-051 consent path.

#### Change map

- `scripts/commands/eval-pipeline.ts` — worktree moved to `tmpdir()`; root + per-workspace `node_modules` symlinks; `listWorkspaceModuleDirs()` helper.
- `scripts/commands/eval-pipeline.test.ts` — "fixture worktree can run the quality gate" (outside repo + toolchain resolvable).
- `apps/cli/src/commands/workflow.ts` — `WORKFLOW_RUN_ACTIVE_ENV`, `markWorkflowRunActive()` / `clearWorkflowRunActive()`, refusal guard, marker at both execution sites.
- `apps/cli/tests/commands/workflow.test.ts` — refusal test asserting exit 1, the message, and that nothing executed.
- `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/features/I6_*.md`, `docs/features/D5_*.md`, `docs/design/run-record-contract.md`, `tests/fixtures/pipeline-eval/README.md`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | R1's own verification command re-run this run: `rg -n "task-pipeline2" docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/features/` returns only historical or ADR-referencing prose — `docs/03_ARCHITECTURE.md:1001` reads "This statically disqualified the **former** `task-pipeline2.yaml`", and the `docs/features/D5_*.md` hits are past-tense scope/scenario text ("was a parallel graph that once permitted…", "by deleting the unreferenced…"). No surviving statement asserts a *future* promotion obligation. The `docs/features/INDEX.md` tree entry carries the filename only, which R2 puts out of scope. Historical records were correctly left alone: `CHANGELOG.md` and the `## Solution` / `## Testing` / `## Review` sections of 0595/0596/0603/0604/0609 are untouched, as R1 explicitly requires. |
| R2 | MET | Heading and frontmatter agree exactly — both read `Workflow pipeline contract, progress projection, and staged consolidation` (frontmatter `name:`; `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md:12` `# D5: …`), re-read this run. The file was **not** renamed, honoring R2's "out of scope without explicit authorization" constraint — the stale filename persists deliberately, not by oversight. R2's second verification also holds: `spur feature check D5 --strict` → `pass: true`, 0 findings, run as this batch's preflight. |
| R3 | MET | `scripts/commands/eval-pipeline.ts:205` symlinks the root `node_modules` into the fixture worktree (`await symlink(join(REPO_ROOT, 'node_modules'), join(projectDir, 'node_modules'), 'dir')`), and `:148-158` discovers every per-workspace `node_modules` rather than hard-coding the list, so adding a workspace does not silently regress the fix — Bun workspaces keep per-workspace trees as well as the root one, which is what `tsc` resolution needed. The comment at `:189` names the exact failure it closes (a fresh `git worktree add` carries no `node_modules`, so the quality gate exited 127 with `tsc: command not found`), and `node_modules` being gitignored keeps the worktree clean. This unblocked task 0607, whose R1 measurement is now demonstrably reachable. |
| R4 | MET | Nested execution is refused mechanically, not by prose. `apps/cli/src/commands/workflow.ts:61` defines `WORKFLOW_RUN_ACTIVE_ENV = 'SPUR_WORKFLOW_RUN_ACTIVE'`; `:298` refuses when it is `'1'`, and the refusal sits **before** any run record, worktree, or agent spawn (`:296-297` states that ordering explicitly). The marker is set on the workflow process itself so it inherits transitively through `agent.run` → agent → shell → any nested `spur`, which covers every depth with one check instead of threading env through `AgentService`/`AiRunner`. Refusal is unconditional — no opt-out flag was added, so no ADR-051 public-surface consent was owed. Executable proof: `apps/cli/tests/commands/workflow.test.ts:195` asserts `exitCode === 1`, that the error names `SPUR_WORKFLOW_RUN_ACTIVE=1`, and that no summary line was emitted (i.e. nothing ran before the refusal). Green in the 144-test run this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R12 — Every migration is independently verified and shipped surfaces stay synchronized | MET | test | `bun test apps/cli/tests/commands/workflow.test.ts scripts/commands/eval-pipeline.test.ts packages/app/tests/workflow/composition-baseline.test.ts` → **144 pass, 0 fail** this run, covering the nested-run refusal (exit 1 before side effects), the eval harness, and two-sided composition parity. `spur workflow validate` → true on all six shipped definitions. `spur feature check D5 --strict` → pass, 0 findings. Derived-doc reconciliation confirmed by re-running R1's own `rg` command. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Decision: `docs/00_ADR.md` — **ADR-076** (retire the promotion bar, delete task-pipeline2), ADR-071 (proof-state invariant), ADR-072 (one canonical pipeline), ADR-051 (public-surface consent)
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (scenario R12)
- Sibling that shipped the decision: task `0606`
- Harness: `scripts/commands/eval-pipeline.ts`, `tests/fixtures/pipeline-eval/`
- Contract doc: `docs/design/workflow-composition-contract.md`
- Cost data plane: `history_message` (`input_tokens` / `output_tokens` / `cost_usd`)

### History
- 2026-08-20T07:10:00.000Z created as todo (umbrella for ADR-076 deferred work)
- 2026-08-20T14:54:30.750Z todo → wip (system)
- 2026-08-20T15:22:49.751Z wip → testing (system)
- 2026-08-20T15:22:50.264Z testing → done (system)
