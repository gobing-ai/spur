---
schema_version: 1
name: "Reconcile promotion-retirement fallout and harden pipeline execution safety"
status: todo
template: feature-impl
created_at: "2026-08-20T07:10:00.000Z"
updated_at: "2026-08-20T07:10:00.000Z"
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
- [ ] R1. Derived docs stop describing a promotion bar that no longer exists. Reconcile every remaining forward-looking `task-pipeline2` / D5-N promotion reference against ADR-076 in exactly these files: `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/features/I6_spur-harness-self-improvement-program-*.md`, `docs/features/INDEX.md`. **Historical records must not be rewritten** — `CHANGELOG.md`, and the `## Solution` / `## Testing` / `## Review` sections of tasks 0595, 0596, 0603, 0604, 0609, correctly describe what was true when written. Only statements that assert a *future* obligation change. Verify: `rg -n "task-pipeline2" docs/03_ARCHITECTURE.md docs/04_DESIGN.md docs/features/` returns only historical or ADR-referencing prose.

- [ ] R2. Feature D5's heading stops contradicting its own contract. Its `# D5:` heading still names the retired promotion bar while its frontmatter `name` reads "Workflow pipeline contract, progress projection, and staged consolidation". Align the heading to the frontmatter name. **Renaming the file itself is out of scope without explicit authorization** — ask first; if authorized, use a plain `mv` plus an inbound-reference sweep, never an automated rename. Verify: heading matches frontmatter `name`; `spur feature check D5` still passes.

- [ ] R3. `eval-pipeline` can complete a fixture run. `createEvalRun()` does `git worktree add --detach <dir> HEAD`, which brings no `node_modules`, so the fixture worktree cannot pass `qualityGateCmd`: measured at HEAD, `bun run format && bun run spur-check` exits **127** with `/bin/bash: tsc: command not found` across all 7 workspaces, producing `test-gate=FAIL` on every run. Make the worktree able to resolve the toolchain. Verify: a non-`--dry` fixture run reaches a verdict instead of `test-gate=FAIL`. **This unblocks task 0607**, which depends on it.

- [ ] R4. Nested pipeline execution is refused mechanically, not by prose. Today the only protection is a `NOTE` at `config/workflows/task-pipeline.yaml:268` asking the agent not to call `/sp:dev-run` in full mode, and `agent.run` exports no run identifier, so a spawned agent has no inherited signal that it is already inside a run. Export a run-depth signal from the `agent.run` action into the child environment, and make `spur workflow run` refuse to start a pipeline when that signal indicates an active run. Refusal is the default and needs no flag; **adding an opt-out flag would be a public-surface change and must route through task 0608 / ADR-051 consent.** Verify: a nested invocation exits non-zero, forks no worktree and no agent, and names the active run; a normal top-level invocation is unaffected.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Decision: `docs/00_ADR.md` — **ADR-076** (retire the promotion bar, delete task-pipeline2), ADR-071 (proof-state invariant), ADR-072 (one canonical pipeline), ADR-051 (public-surface consent)
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (scenario R12)
- Sibling that shipped the decision: task `0606`
- Harness: `scripts/commands/eval-pipeline.ts`, `tests/fixtures/pipeline-eval/`
- Contract doc: `docs/design/workflow-composition-contract.md`
- Cost data plane: `history_message` (`input_tokens` / `output_tokens` / `cost_usd`)

### History
- 2026-08-20T07:10:00.000Z created as todo (umbrella for ADR-076 deferred work)
