---
template: feature-impl
schema_version: 1
name: "Batch worktree isolation --worktree for dev-runall dev-refineall dev-verifyall"
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T23:46:39.945Z"
updated_at: "2026-08-08T03:01:41.432Z"
---

## 0477. Batch worktree isolation --worktree for dev-runall dev-refineall dev-verifyall

### Background
Add a `--worktree` flag to the three batch `/sp:dev-*` commands so a batch run operates on an
isolated git worktree instead of the operator's working directory. On success the worktree is
fast-forward-merged back onto its base ref and removed; on any failure or halt it is **retained
intact** and reported, never auto-deleted and never auto-merged.

#### Why

`/sp:dev-runall` and `/sp:dev-refineall` mutate the shared corpus (`docs/tasks*/`), and `dev-runall`
additionally mutates source and tests, across runs that last many minutes of `agent.run` time. Today
a batch that halts at task 3 of 7 leaves the operator's working tree in a partial, hand-untangleable
state, and there is no clean way to abandon a bad batch. Isolation gives the run its own blast
radius and makes "throw this away" a one-line operation.

#### Relationship to task 0142

Task 0142 (H1, P3, `blocked`) Slice A specs **per-task** worktrees for `--mode parallel`, plus
join/merge and a concurrency bound. This task is deliberately **0142 Slice A minus parallelism**:
one worktree per batch run, one writer, sequential. That sidesteps the corpus-merge-conflict risk
0142 names as its principal danger (concurrent `spur task refresh` / `spur feature refresh` output),
and lands the worktree lifecycle + cwd plumbing that 0142 Slice A would otherwise have to build
first. 0142 stays open for the parallel case and should reference this task as its prerequisite.

#### Key finding: no CLI change is required

`spur workflow run` takes no `--cwd`; it resolves everything from process cwd
(`apps/cli/src/commands/workflow.ts:124`). `spur agent run` already has `--cwd`
(`apps/cli/src/commands/agent.ts:50`). Running the existing batch loop from inside the worktree
directory is therefore sufficient — 0142's open item "confirm/extend the pipeline's cwd plumbing"
resolves to *nothing to extend*. This task stays entirely in the plugin layer: three command
documents, the flag glossary, and the `sp:spur-dev` execution-batch reference.
### Requirements
**R1 — Flag surface (three commands, not four).** Add `--worktree` to `/sp:dev-runall`,
`/sp:dev-refineall`, and `/sp:dev-verifyall`: frontmatter `argument-hint`, the Argument Flags table,
and the Usage block of each command document. Default off. `/sp:dev-next` is **explicitly excluded**
(R8.1).

**R2 — Worktree creation.** With `--worktree`, before any task work begins, create a git worktree on
a new branch cut from the current HEAD's ref (the **base ref** — often a `feat/…` branch, not
literally `main`). Location follows the existing sibling-directory convention in
`branch-workflow/references/worktree-patterns.md`. Branch and directory names are derived
(command + selector slug + short id); no operator-supplied name in this slice (R8.3). The batch loop
then runs with the worktree as process cwd.

**R3 — Dirty-tree precheck.** `git worktree add` branches from a ref, so uncommitted changes in the
main tree do **not** carry into the worktree — a batch would silently run against different tree
state than the operator sees. Before creating the worktree, abort when the main tree is dirty,
naming the offending files and instructing commit-or-stash. `--force` overrides and proceeds with
the divergence warning.

**R4 — Success path.** When the batch completes with no failed task, fast-forward-merge the worktree
branch onto the base ref, then remove the worktree and delete the branch. **Fast-forward only** — if
the base ref has moved and FF is impossible, do not rebase, merge, or resolve conflicts: fall
through to the retention path (R5) and report the divergence.

**R5 — Failure path: keep and report.** On any per-task failure, batch halt, HITL pause that ends
the run, or non-FF merge from R4, the worktree directory and branch are left **intact**. No
destructive automation on this path under any flag. Emit a report naming the worktree path, the
branch, the base ref, and the halt cause, followed by the three operator commands: **resume**
(re-enter the worktree and continue), **merge** (integrate manually), **discard** (remove worktree +
branch). The report slots into the existing halt-report shape in
`spur-dev/references/flag-glossary.md` § `--next` chain contract rather than inventing new
vocabulary.

**R6 — Crash-safe state marker.** Worktree identity must live on disk, not only in the orchestrator's
memory, so that a session that dies mid-batch is still recoverable. Write a marker under
`.spur/run/` at creation recording at minimum: marker id, worktree path, branch, base ref, base SHA,
originating command, task selector, created-at, and status. Update it at the terminal transition
(merged / retained). The marker is the authority for R7 resume and for operator recovery after a
crash.

**R7 — `--continue` interaction.** A `--continue` resume of a batch that was started with
`--worktree` must re-enter the existing worktree via its R6 marker rather than creating a second
one. `--continue` without a resolvable marker fails with a clear message rather than silently
running in the main tree.

**R8 — Scope exclusions (state explicitly in the command docs).**
- **R8.1** `/sp:dev-next` does not get the flag — it dispatches a single step; per-step isolation is
  not worth the worktree cost.
- **R8.2** Per-task worktrees and `--mode parallel` isolation remain task 0142 Slice A. This slice is
  one worktree per run, sequential only. Passing `--worktree` together with `--mode parallel` is
  rejected.
- **R8.3** No operator-supplied worktree name, no `--worktree-keep` variant, no auto-cleanup of stale
  worktrees from prior runs.
- **R8.4** No `spur` CLI changes (see Background — process cwd already suffices).

**R9 — Documentation.** Add a `--worktree` entry to `spur-dev/references/flag-glossary.md` in the
established per-flag section format, and extend
`spur-dev/references/execution-batch.md` with the worktree lifecycle for the sequential batch loop.
Reuse `branch-workflow/references/worktree-patterns.md` for the underlying git mechanics — do not
re-author create/list/remove/prune guidance.

**R10 — Portability.** Use portable `git worktree` commands. Do **not** depend on the Claude Code
`EnterWorktree`/`ExitWorktree` tools: the `sp` plugin ships to Codex, Gemini CLI, pi, omp, and
OpenCode, and per the AGENTS.md platform-fallback contract the flag must behave identically on
platforms without those tools.
### Acceptance Criteria
```gherkin
Feature: --worktree batch isolation for the sp batch commands

  # ── R1: flag surface ──
  Scenario: R1.1 The three batch commands accept --worktree
    Given the sp plugin command documents
    When I inspect dev-runall, dev-refineall, and dev-verifyall
    Then each declares --worktree in its frontmatter argument-hint
    And each lists --worktree in its Argument Flags table with default off
    And each shows --worktree in its Usage block

  Scenario: R1.2 dev-next does not accept --worktree
    Given the dev-next command document
    When I inspect its argument-hint and flag table
    Then --worktree is absent
    And the exclusion rationale is recorded in the sp:spur-dev batch reference

  # ── R2: creation ──
  Scenario: R2.1 A clean run creates one worktree before any task work
    Given a clean main working tree on base ref "feat/example"
    When I run a batch command with --worktree
    Then exactly one git worktree is created on a new branch cut from "feat/example"
    And the worktree directory follows the sibling-directory convention
    And the batch loop executes with the worktree as its process cwd

  Scenario: R2.2 The base ref is the current ref, not literally main
    Given the main tree is checked out on "feat/example"
    When I run a batch command with --worktree
    Then the worktree branch is cut from "feat/example"
    And the recorded base ref is "feat/example"

  # ── R3: dirty-tree precheck ──
  Scenario: R3.1 A dirty main tree aborts before any worktree is created
    Given the main working tree has uncommitted modifications
    When I run a batch command with --worktree
    Then the command aborts before creating a worktree
    And the output names the uncommitted files
    And the output instructs the operator to commit or stash
    And no task work has run

  Scenario: R3.2 --force proceeds past a dirty tree with a warning
    Given the main working tree has uncommitted modifications
    When I run a batch command with --worktree --force
    Then a divergence warning is emitted naming the uncommitted files
    And the worktree is created and the batch proceeds

  # ── R4: success path ──
  Scenario: R4.1 A fully successful batch fast-forward-merges and cleans up
    Given a batch run with --worktree in which every task succeeded
    And the base ref has not moved since the worktree was created
    When the batch completes
    Then the worktree branch is fast-forward-merged onto the base ref
    And the worktree directory is removed
    And the worktree branch is deleted
    And the state marker records the terminal status "merged"

  Scenario: R4.2 A moved base ref falls through to retention, never a conflict resolve
    Given a batch run with --worktree in which every task succeeded
    And the base ref has advanced so fast-forward is impossible
    When the batch completes
    Then no rebase, merge commit, or conflict resolution is attempted
    And the worktree and branch are retained
    And the report names the divergence and the three operator commands

  # ── R5: failure path ──
  Scenario: R5.1 A halted batch retains the worktree intact
    Given a batch run with --worktree that halts at the third of seven tasks
    When the run ends
    Then the worktree directory and branch still exist
    And the work committed by the first two tasks is present in the worktree
    And nothing was merged onto the base ref

  Scenario: R5.2 The retention report names path, branch, cause, and three commands
    Given a batch run with --worktree that failed or halted
    When the report is emitted
    Then it names the worktree path, the branch, and the base ref
    And it names the halt cause in the flag-glossary halt-report shape
    And it prints a resume command, a merge command, and a discard command

  Scenario: R5.3 No flag combination auto-deletes a failed run's worktree
    Given a batch run with --worktree that failed or halted
    When the run ends under any combination of --auto, --force, and --keep-going
    Then the worktree directory and branch are retained

  # ── R6: crash-safe marker ──
  Scenario: R6.1 A marker is written under .spur/run at creation
    When a --worktree batch creates its worktree
    Then a marker file is written under .spur/run
    And it records marker id, worktree path, branch, base ref, base SHA,
        originating command, task selector, created-at, and status

  Scenario: R6.2 A killed session leaves a recoverable marker
    Given a --worktree batch whose session is killed mid-run
    When the operator inspects .spur/run afterwards
    Then the marker identifies the worktree path, branch, and base ref
    And the retained worktree can be resumed, merged, or discarded from it

  # ── R7: --continue ──
  Scenario: R7.1 --continue re-enters the existing worktree
    Given an interrupted batch started with --worktree
    When I re-run the command with --continue --worktree
    Then the existing worktree is re-entered via its marker
    And no second worktree is created

  Scenario: R7.2 --continue without a resolvable marker fails loudly
    Given no resolvable worktree marker for the batch
    When I run the command with --continue --worktree
    Then the command fails with a message naming the missing marker
    And it does not silently run in the main working tree

  # ── R8: scope exclusions ──
  Scenario: R8.1 --worktree with --mode parallel is rejected
    Given a batch command invoked with --worktree --mode parallel
    When the flags are validated
    Then the combination is rejected
    And the message points to task 0142 for per-task parallel isolation

  # ── R9/R10: docs and portability ──
  Scenario: R9.1 The flag glossary documents --worktree
    When I read spur-dev/references/flag-glossary.md
    Then it carries a --worktree section in the established per-flag format
    And execution-batch.md describes the worktree lifecycle for the sequential loop

  Scenario: R10.1 The mechanism is portable git, not a Claude-Code-only tool
    When I inspect the implementation guidance
    Then it uses portable git worktree commands
    And it does not depend on the EnterWorktree or ExitWorktree tools
    And it reuses branch-workflow/references/worktree-patterns.md for git mechanics
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
#### Where the change lives

Plugin layer only. No `apps/cli` change (Background: process cwd already suffices).

| File | Change |
|---|---|
| `plugins/sp/commands/dev-runall.md` | `--worktree` in argument-hint, flag table, usage |
| `plugins/sp/commands/dev-refineall.md` | same |
| `plugins/sp/commands/dev-verifyall.md` | same |
| `plugins/sp/commands/dev-next.md` | untouched (R8.1) |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | new `### --worktree` section |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | worktree lifecycle in the sequential loop |
| `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` | referenced, not rewritten |

#### Lifecycle

```
precheck (R3: clean tree or --force)
  → git worktree add <sibling-dir> -b <derived-branch> <base-ref>
  → write .spur/run marker (R6)
  → run the existing batch loop with cwd = worktree
  → all tasks succeeded?
       yes → git merge --ff-only <branch> onto base ref
               ok   → remove worktree, delete branch, marker = merged
               fail → retain + report divergence (R4.2)
       no  → retain + report halt (R5)
```

The only destructive step in the whole flow is on the all-succeeded + FF-clean path. Every other
exit retains.

#### Why retention is the right default

These batches are long, HITL-gated, and already resumable via `--continue`. A halt at task 3 of 7
holds real work — often tens of minutes of `agent.run` output. Auto-deleting is data loss;
auto-merging is a partial result presented as a whole, which is the failure mode the `⚠️ PARTIAL`
discipline exists to prevent. Retention makes the failure path require **no** transactional rollback
machinery: the answer to "what happens if it fails" is "nothing happens, and we tell you where the
work is."

#### Fast-forward only

The corpus files (`docs/tasks*/`, kanban/index) are auto-generated and conflict-prone — 0142 named
this as the principal merge risk. Automated conflict resolution over generated files is exactly the
wrong thing to attempt unattended. FF-only means the merge either is trivially correct or does not
happen.

#### Marker

`.spur/run/` (already the home for run state — trace writer, verdicts). Sketch:

```json
{
  "id": "…", "path": "../spur-new-sp-runall-h1-a3f2", "branch": "sp/runall-h1-a3f2",
  "baseRef": "feat/example", "baseSha": "…", "command": "dev-runall",
  "selector": "feature:H1", "createdAt": "…", "status": "active|merged|retained"
}
```

Marker-on-disk is what makes R6.2 answerable at all — a policy held only in the orchestrator's
memory dies with the orchestrator.

#### Interaction notes

- **Corpus visibility.** While the batch runs, corpus writes land in the worktree copy; the
  operator's main tree still shows pre-run task statuses. This is expected and worth one line in the
  command docs so it does not read as a bug.
- **WBS allocation.** Single worktree + sequential means one writer, so the WBS allocator cannot
  collide. This is a reason to keep per-task worktrees out of scope until 0142 addresses allocation
  explicitly.
- **`--agent`.** Orthogonal. Subprocess executors inherit the worktree cwd; `spur agent run --cwd`
  exists if a stage needs it pinned.
### Plan
- [x] **P1 - Worktree lifecycle in `execution-batch.md`.** Document create -> run -> merge-or-retain
      for the sequential loop, including the FF-only rule and the retention default. (R2, R4, R5)
- [x] **P2 - Dirty-tree precheck.** Specify the abort, the file listing, the commit-or-stash
      instruction, and the `--force` override. (R3)
- [x] **P3 - State marker.** Define the `.spur/run/` marker schema and its create/terminal
      transitions. (R6)
- [x] **P4 - Retention report.** Define the report in the existing flag-glossary halt-report shape,
      with the resume / merge / discard command triple. (R5.2)
- [x] **P5 - `--continue` re-entry.** Specify marker lookup on resume and the loud failure when no
      marker resolves. (R7)
- [x] **P6 - Flag glossary entry.** Add `### --worktree` in the established per-flag format,
      including the `--mode parallel` rejection and the dev-next exclusion. (R8, R9)
- [x] **P7 - Command documents.** Apply argument-hint + flag table + usage to dev-runall,
      dev-refineall, dev-verifyall; add the corpus-visibility note. Leave dev-next untouched. (R1)
- [x] **P8 - Portability pass.** Confirm no `EnterWorktree`/`ExitWorktree` dependency and that
      `worktree-patterns.md` is referenced rather than duplicated. (R10)
- [x] **P9 - Tests.** Extend `plugins/sp/tests/` command/flag structure coverage for the three
      commands carrying `--worktree` and dev-next not carrying it. (R1.1, R1.2)
- [x] **P10 - Cross-link 0142.** Record in 0142 that this task lands the sequential worktree
      lifecycle its Slice A depends on, and that per-task/parallel isolation stays there. (R8.2)
- [x] **P11 - Gate.** `bun run autofix && bun run spur-check`; `spur task check 0477`.
### Solution
Plugin-layer spec only. No `apps/cli` change (R8.4 - process cwd already suffices per Background).

| File | Change | Rationale |
|---|---|---|
| `plugins/sp/commands/dev-runall.md:4` | `--worktree` added to argument-hint, flag table (line 25), usage block (line 31), and flag prose (line 47) | R1 flag surface |
| `plugins/sp/commands/dev-refineall.md:4` | same pattern: argument-hint, flag table, usage, prose | R1 flag surface |
| `plugins/sp/commands/dev-verifyall.md:4` | same pattern: argument-hint, flag table, usage, prose | R1 flag surface |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:59,62,70` | `--worktree` appended to flag-signature table rows for dev-verifyall (3a), dev-refineall (5a), dev-runall (13) | Mechanical sync required by `command-flag-parity` gate |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | New `### --worktree` section (anchor `#flag-worktree`) in established per-flag format | R9 documentation |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:355-493` | Worktree lifecycle: portability note (355-359), WT-1 dirty-tree precheck (361-376), WT-2 creation (378-395), WT-3 marker (397-420), WT-4 FF-only merge (422-441), WT-5 retention (443-470), WT-6 continue (472-484), WT-7 exclusions (486-493) | R2-R8 lifecycle spec |
| `docs/tasks2/0142_batch-execution-v2-parallel-runs-worktree-isolation-interact.md:55-62` | P10 cross-link paragraph: 0477 lands sequential worktree lifecycle; Slice A (parallel) remains open here | P10 cross-link |

**Scope note:** The working tree also contains task 0474 (history analyze SQL aggregation) changes in `apps/cli/`, `packages/app/`, `packages/domain/` - these are NOT 0477 scope and must be committed separately. `plugins/sp/plugin.json` is a trivial Biome formatting artifact, also not 0477.
### Testing
**Verdict: PASS** — re-audit via `/sp:dev-verify 0477 --auto --next --force --focus all --fix all`
(2026-08-08). Supersedes the prior `UNKNOWN` verdict, which recorded no requirements and did not
constitute a real verify.

**Scope.** Spec-only deliverable (R8.4: no `apps/cli` change). The `sp` plugin's execution model is
agent-read-markdown, so the instruction text *is* the implementation; AC evidence is deterministic
`rg` anchors against the shipped spec plus the executable flag-parity gate.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `bun test plugins/sp/tests/flag-contract-parity.test.ts` → 24 pass / 0 fail. `plugins/sp/commands/dev-runall.md:3`, `plugins/sp/commands/dev-refineall.md:3`, `plugins/sp/commands/dev-verifyall.md:3`; `plugins/sp/commands/dev-next.md` 0 matches |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:378` WT-2 — base ref `git rev-parse --abbrev-ref HEAD:385`, `git worktree add … -b:388` |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:361` WT-1 — abort names files `:372`; `--force` override `:374` |
| R4 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:422` WT-4 — `git merge --ff-only:431`; non-FF → retention `:439` |
| R5 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:443` WT-5 — retained intact `:448`; resume/merge/discard block `:458` |
| R6 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:397` WT-3 — marker schema `:403`; crash recovery `:419` |
| R7 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:472` WT-6 — re-enter `:476`; loud failure `:483` |
| R8 | MET | **Repaired this run.** `plugins/sp/commands/dev-runall.md:51` states the `--mode parallel` rejection in the command doc as R8 requires; also `plugins/sp/skills/spur-dev/references/execution-batch.md:486` WT-7, `plugins/sp/skills/spur-dev/references/flag-glossary.md:346` |
| R9 | MET | `plugins/sp/skills/spur-dev/references/flag-glossary.md:339` (`### --worktree`, anchor `#flag-worktree`); `plugins/sp/skills/spur-dev/references/execution-batch.md:343` lifecycle |
| R10 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:355` portability note; `rg EnterWorktree plugins/sp` → 0 matches |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| R1.1 three commands accept --worktree | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts` 24 pass; parity across hint/table/usage/`plugins/sp/skills/spur-dev/references/dev-operations.md:59` |
| R1.2 dev-next does not accept --worktree | MET | test | Mutation-proven: adding `--worktree` to `dev-next.md` makes the parity gate fail with "glossary declaring-commands list for --worktree omits dev-next that declared it"; reverted, gate green |
| R2.1 clean run creates one worktree | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:388` |
| R2.2 base ref is current ref not main | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:385` |
| R3.1 dirty tree aborts pre-creation | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:372` |
| R3.2 --force proceeds with warning | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:374` |
| R4.1 success FF-merges and cleans up | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:431` |
| R4.2 moved base falls through to retention | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:439` |
| R5.1 halted batch retains worktree | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:448` |
| R5.2 report names path/branch/cause + 3 cmds | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:458` |
| R5.3 no flag combination auto-deletes | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:448` (`--auto`/`--force`/`--keep-going` all retain) |
| R6.1 marker written under .spur/run | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:403` |
| R6.2 killed session leaves recoverable marker | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:419` |
| R7.1 --continue re-enters existing worktree | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:476` |
| R7.2 --continue without marker fails loudly | MET | static | `plugins/sp/skills/spur-dev/references/execution-batch.md:483` |
| R8.1 --worktree + --mode parallel rejected | MET | static | `plugins/sp/commands/dev-runall.md:51` (repaired this run); `plugins/sp/skills/spur-dev/references/execution-batch.md:349` |
| R9.1 flag glossary documents --worktree | MET | command | `rg -n -- --worktree plugins/sp/skills/spur-dev/references/flag-glossary.md` → `:339,348,351` |
| R10.1 portable git, not Claude-Code-only | MET | command | `rg EnterWorktree plugins/sp` → 0 matches; `plugins/sp/skills/spur-dev/references/execution-batch.md:355` |

**Gates run this turn**

- `bun test plugins/sp/tests/` → **496 pass / 0 fail** (13 files), re-run after the R8 repair.
- `bun test plugins/sp/tests/flag-contract-parity.test.ts` → **24 pass / 0 fail**; mutation-checked
  against `dev-next` (fails when mutated, green when reverted).
- `spur task check 0477 --strict-core` → **pass=true, errors=0**.
- Coverage: N/A (documentation-only change; no runtime code path added).

**Fix pass (`--fix all`)**

Three repairs applied:

1. `plugins/sp/commands/dev-runall.md:51` — added the `--worktree --mode parallel` rejection. R8
   requires exclusions be stated *in the command docs*; they existed only in `execution-batch.md`
   WT-7 and the flag glossary. R8 PARTIAL → MET. A missing blank line before the corpus-visibility
   paragraph was corrected in the same edit.
2. `docs/features/H1_spur-dev-skill.md` § Acceptance Criteria — promoted all 18 task scenarios into
   the feature AC (34 → 52 scenarios), matching how sibling tasks 0141 and 0161 already appear
   there. Cleared 18 × `L4.uncovered-task-scenario` (DD-09 subset rule).
3. This Testing section — rewrote all evidence anchors as repo-relative paths after the checker
   flagged 5 × `L4.stale-line-anchor` on bare filenames.

**Residuals**

| Severity | Finding | State |
|---|---|---|
| P3 | "No executable test asserts `dev-next` must not carry `--worktree`" | **Withdrawn — false finding.** The parity gate's `checkGlossaryMembership` enforces exact declaring-commands equality; mutation-proven above. |

**Artifact disclosure.** This run wrote `.spur/run/0477-verdict.json` (gitignored) — verdict `PASS`,
10 requirement rows, 18 AC rows, `checks[]` carrying `design-conformance`, `strict-core`,
`plugin-test-suite`, `coverage`, and `shippable`.

**Shippable: FAIL — feature H1.** Not caused by 0477 and not 0477 work to fix.
`spur feature check H1` carries `L4.scenario-unverified` findings against covering tasks **0141**
and **0161** (neither has a PASS verdict with MET requirement rows), plus
`L4.uncovered-feature-scenario` orphans predating this task. Incomplete linked tasks: **0**.
Recovery: re-verify 0141 and 0161 so their scenarios carry PASS+MET verdict rows.
### Review
**Reviewer:** inline `sp-dev-review --auto` (functional traceability + SECUA + architecture).
**Verdict: PASS** - all R1–R10 requirements and every AC scenario are satisfied by the plugin-layer spec. Three low-severity residuals noted; none block progression to verify.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | SECUA | `execution-batch.md:428` | [LOW] WT-4 `git checkout "$BASE_REF"` does not state *where* it runs. The commands are only valid from the main tree. A clarifying phrase ("in the main tree") would remove the ambiguity. Not a defect - the procedure is correct. |
| P4 | SECUA | - | [INFO] No executable lifecycle test. Procedural-spec deliverable, not callable code. Realistic coverage is the flag-surface parity gate (95 pass). P9 over-promised a target with no natural executable form for a doc-only task. |
| P4 | Architecture | `docs/tasks2/0142…md:57` | [LOW] Cross-link says "task 0477 (…, `done`)" but 0477 is `wip`. Self-corrects when 0477 reaches done. |
| P4 | Functional | `dev-runall.md`, `dev-refineall.md`, `dev-verifyall.md` | [LOW] Corpus-visibility caveat not propagated to command docs. execution-batch.md:495-500 says "worth one line in each command doc" but command docs carry only the generic flag pointer. Behavior is correct and documented in execution-batch.md; only the command-surface mention is missing. No AC scenario asserts this. |
| P4 | Functional | `plugins/sp/tests/` | [LOW] P9 explicit dev-next-exclusion test absent. Generic parity gate + grep cover it; an explicit assertion would lock the exclusion against regression. |
| P4 | - | - | No P1–P3 findings; verify verdict PASS. All R1–R10 MET, all 18 AC scenarios MET. |

**Functional traceability (R1–R10 -> evidence)**

| Req | Status | Evidence |
|---|---|---|
| R1 flag surface (3 cmds) | ✅ | dev-runall/dev-refineall/dev-verifyall each carry `--worktree` in argument-hint, Argument Flags table (default off), and Usage block. `command-flag-parity` gate enforces hint↔dev-operations.md↔table bidirectional parity (95 pass). |
| R1.2 dev-next excluded | ✅ | dev-next.md has no `worktree` token (grep clean). Exclusion rationale recorded in execution-batch.md WT-7 + flag-glossary. **Gap:** no explicit test asserts the absence (P9); covered only by the generic parity gate + grep. Low. |
| R2 creation | ✅ | execution-batch.md WT-2: new branch from current HEAD ref (base ref, not literal main), sibling-dir convention, derived names, no operator name. |
| R3 dirty-tree precheck | ✅ | WT-1: `git status --porcelain`, abort naming files + commit-or-stash, `--force` override with divergence warning. |
| R4 success path | ✅ | WT-4: FF-only merge -> remove worktree -> delete branch -> marker=merged. Non-FF falls through to retention (WT-5). `git branch -d` (safe; refuses unmerged) used correctly post-FF. |
| R5 failure path | ✅ | WT-5: retain intact under any flag combo (`--auto`/`--force`/`--keep-going`), marker=retained, retention report names path/branch/base-ref/cause + resume/merge/discard triple in the `--next` chain halt-report shape. |
| R6 crash-safe marker | ✅ | WT-3: `.spur/run/worktree-<id>.json` records id, path, branch, baseRef, baseSha, command, selector, createdAt, status; transitions active->merged\|retained. Killed session leaves `status: active` for recovery. |
| R7 `--continue` | ✅ | WT-6: marker lookup by command+selector, re-enter existing worktree (no second), not-found fails loudly, never silently runs in main tree. |
| R8 exclusions | ✅ | R8.1 dev-next (WT-7), R8.2 `--mode parallel` rejected (WT-7 + flag-glossary), R8.3 no operator-name/keep/auto-cleanup (WT-7), R8.4 no CLI change (Design confirms; no apps/cli diff in 0477 scope). |
| R9 docs | ✅ | flag-glossary `### --worktree` (anchor `#flag-worktree`) in established format; execution-batch.md § Worktree isolation owns the lifecycle. Bidirectional links resolve. |
| R10 portability | ✅ | WT portability note: portable `git worktree` only, no `EnterWorktree`/`ExitWorktree` dependency, reuses `worktree-patterns.md`. (L4 `uncovered-task-scenario` warning for R10.1 is a feature-AC-numbering artifact, not a content gap.) |

**AC coverage:** all 18 Gherkin scenarios map to a WT-1…WT-7 spec section. `spur task check 0477` -> `pass: true` (advisory L4 gate-language + R10.1-subset warnings only).

**SECUA quality**

- **Safety posture is correct.** The only destructive step (worktree remove + branch delete) is gated behind all-tasks-succeeded AND FF-clean. Every other exit retains. R5.3 (no flag combo auto-deletes) is honored in spec and in the WT-5 prose. Retention default is the right call for long, HITL-gated, already-resumable batches.
- **FF-only is correctly scoped.** Automated WT-4 is FF-only (never rebase/merge-commit/resolve). The manual `merge` command in the retention report (WT-5) intentionally omits `--ff-only` because it is human-driven recovery - the asymmetry is deliberate, not an oversight.

**Architectural depth**

- **Reuse, not re-authoring:** git mechanics delegated to `worktree-patterns.md`; flag-glossary owns the definition, execution-batch owns the lifecycle, command docs point to both. No duplication.
- **Clean layering:** the lifecycle wraps Steps 1–5 unchanged - only cwd differs plus a terminal merge/retain action. Single worktree + sequential ⇒ one writer ⇒ WBS allocator cannot collide (explicitly noted), which is why `--mode parallel` is correctly rejected.
- **Scope discipline:** 0142 relationship (sequential lands here; parallel deferred) is explicit. No speculative generality (operator-name / keep / auto-cleanup all deferred per R8.3).

**Final disposition**

**PASS.** The spec is complete, internally consistent, safe by construction (FF-only automated merge; retention everywhere else), and reuses existing patterns. The P4 residuals are cosmetic/doc-polish and do not block progression.
### References
- `docs/tasks2/0142_batch-execution-v2-parallel-runs-worktree-isolation-interact.md` — Slice A
  (per-task worktrees for parallel mode) and its corpus-merge-conflict risk note. This task is that
  slice minus parallelism; 0142 remains open for the parallel case.
- `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` — git worktree add/list/
  remove/prune, sibling-directory naming, disk-space guidance. Reused, not re-authored.
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` — per-flag section format; the `--next`
  chain contract halt-report table whose shape R5.2 reuses.
- `plugins/sp/skills/spur-dev/references/execution-batch.md` §3 — the sequential batch loop this flag
  wraps; §"Parallel Execution" for the excluded case.
- `apps/cli/src/commands/workflow.ts:124` — `spur workflow run` resolves from process cwd; no `--cwd`
  flag, hence no CLI change needed.
- `apps/cli/src/commands/agent.ts:50` — `spur agent run --cwd`, available if a stage needs a pinned
  working directory.
- `CLAUDE.md` § Harness-first contract — platform-fallback requirement behind R10 (portable git over
  Claude-Code-only worktree tools).
### History
- 2026-08-08T00:08:22.439Z todo → wip (system)
- 2026-08-08T00:22:05.469Z wip → testing (system)
- 2026-08-08T00:22:09.858Z testing → done (system)
