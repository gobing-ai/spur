---
template: feature-impl
schema_version: 1
name: "Extend --worktree to accept an existing worktree name for batch reuse"
description: ""
status: todo
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T04:12:40.831Z"
updated_at: "2026-08-10T04:22:11.978Z"
---

## 0496. Extend --worktree to accept an existing worktree name for batch reuse

### Background
Task 0477 shipped `--worktree` on the three batch commands (`/sp:dev-runall`,
`/sp:dev-refineall`, `/sp:dev-verifyall`) as a **create-only** flag: every invocation cuts a fresh
branch, creates a sibling worktree with a derived name, runs the batch there, and then either
FF-merges + removes it (WT-4) or retains it intact (WT-5). Operator-supplied names were explicitly
deferred — `execution-batch.md` WT-7 / task 0477 R8.3 read "**No** operator-supplied worktree name".

This task retires that exclusion for the **reuse** direction only: `--worktree [<name>]` attaches a
batch to a worktree that already exists, while bare `--worktree` keeps today's create semantics
verbatim.

#### Why

The retained worktree (WT-5) is currently a dead end for the harness. A halted batch leaves a
worktree with real, partially-complete work in it, and the retention report tells the operator to
`cd` into it and resume. But once they `cd` there, the harness has lost the thread:

- Running the batch command **without** `--worktree` from inside the worktree works by accident —
  cwd happens to be the worktree — but the run is then unmanaged: no marker update, no WT-4
  FF-merge-back, no WT-5 report. The operator owns the integration by hand, which is exactly the
  manual-untangling cost 0477 existed to remove.
- Running it **with** bare `--worktree` is worse: it creates a *second* worktree nested off the
  first, doubling the `bun install` cost and branching from the wrong base.
- WT-6 `--continue` re-entry only resolves a marker when `command` **and** `selector` both match the
  original invocation. The common recovery shape — `dev-runall` halted, now run `dev-verifyall` over
  the same tasks in the same tree — has no marker match and therefore no supported path at all.

Naming the worktree closes all three: the operator points the next batch at the tree that already
holds the work, and the managed lifecycle (marker, FF-merge, retain-and-report) stays in force
across invocations instead of ending at the first halt.

Secondary: the WT-5 retention report already prints
`resume: cd <worktree-path> && <command> --continue --worktree <selector>`
(`execution-batch.md:504`). That line is wrong today — `--worktree` takes no value, so the selector
reads as a stray positional. Under this change the same line becomes literally correct once the
value is the worktree, not the selector.

#### Scope shape

Markdown/contract only. `--worktree` has **no CLI implementation** — it is a prose contract in the
`sp` plugin that the orchestrating agent executes with portable `git worktree` commands, and
`spur workflow run` already resolves cwd from the process (`apps/cli/src/commands/workflow.ts:124`).
No TypeScript, no new `spur` verb, no new flag. Same as 0477 R8.4.

#### Explicitly not in scope

- **Create-with-name.** `--worktree <name>` where `<name>` does not resolve is an **error**, not a
  create. Silently creating a fresh tree on a typo re-runs the whole batch against the wrong state
  after paying a full `bun install` — the exact failure the fail-loud convention exists to prevent.
- Per-task worktrees and `--worktree --mode parallel` (still task 0142 Slice A, still rejected).
- Auto-cleanup or GC of stale worktrees / markers from prior runs.
- `--worktree` on `/sp:dev-next` (single step; unchanged exclusion).
### Requirements
**R1 — Optional-value flag surface (three commands, not four).** `--worktree` accepts an optional
value on `/sp:dev-runall`, `/sp:dev-refineall`, `/sp:dev-verifyall`. Bare `--worktree` keeps today's
**create** semantics unchanged; `--worktree <name>` / `--worktree=<name>` selects **reuse** mode.
Update, per command: frontmatter `argument-hint` (`[--worktree [<name>]]`), the Argument Flags table
row (first cell `` `--worktree [<name>]` ``, Default cell stays `off`), and the Usage block — plus
the three matching rows in `plugins/sp/skills/spur-dev/references/dev-operations.md`. Value binding
is stated explicitly: the following token is consumed as `<name>` **only** when it does not begin
with `-`, so `--worktree --auto` is the bare form; `--worktree=<name>` is the unambiguous spelling.
`/sp:dev-next` remains excluded.

**R2 — Name resolution: fail loud, never create.** `<name>` resolves against
`git worktree list --porcelain`, in order: (1) exact worktree path, (2) worktree directory basename,
(3) checked-out branch name. Exactly one match must survive. **Zero matches** → abort before any
task work, printing the resolvable worktrees (path + branch) and stating that `--worktree <name>`
never creates. **Two or more matches** → abort, naming the ambiguous candidates and requiring the
path form. A resolved worktree that is not the invoking tree's repo, is locked
(`git worktree list --porcelain` reports `locked`), or is prunable, also aborts.

**R3 — Reuse-mode lifecycle deltas (WT-1 → WT-3).** In reuse mode:
- **WT-1** keeps the *main*-tree dirty precheck unchanged (the divergence hazard is identical — the
  batch still runs somewhere the operator is not standing). The *target worktree* being dirty is
  **expected** (retained partial work) and must **not** abort: report the file list once and proceed.
- **WT-2** creation is skipped entirely. `$BRANCH` is the worktree's already-checked-out branch; a
  detached HEAD aborts. `bun install --frozen-lockfile` runs **only when `node_modules` is absent**,
  so a warm reused tree does not re-pay the install.
- **WT-3** marker: adopt the existing `.spur/run/worktree-*.json` marker for that path when present,
  updating `command`/`selector` to the current invocation and `status` to `active` while preserving
  `baseRef`/`baseSha`. When no marker exists (hand-made or foreign worktree), synthesize one with
  `baseRef` = the invoking tree's current HEAD ref, `baseSha` = `git merge-base <baseRef> <branch>`,
  and `adopted: true`. An existing marker already at `status: active` **aborts** — another session
  may own that tree (AGENTS.md one-writer-per-tree) — overridable with `--force`.

**R4 — Terminal path: the flag removes only what it created.** WT-4 in reuse mode still requires a
fully-successful batch and still FF-merges `$BRANCH` onto `baseRef` from the main tree, but then
**retains** the worktree and its branch (marker `status: merged`); it does not run
`git worktree remove` / `git branch -d`. Ownership rule, stated once in the glossary and once in
WT-4: *the operator supplied the tree, so the operator owns its lifetime.* Create mode is unchanged
(merge, remove, delete). WT-5 retention and the non-FF fall-through are unchanged in both modes.

**R5 — Doc consistency and the WT-5 regression.** Rewrite `#flag-worktree` in `flag-glossary.md` for
the two modes; amend `execution-batch.md` WT-1/WT-2/WT-3/WT-4 with the R3/R4 deltas; make WT-6
resolve **by name first** (an explicit `<name>` wins over the `command`+`selector` marker scan, and
makes cross-command resume — `dev-runall` halted, `dev-verifyall` resumed — a supported path);
narrow WT-7's "no operator-supplied worktree name" to "no create-with-name, no auto-cleanup of stale
worktrees or markers". Fix the WT-5 retention-report resume line from
`--continue --worktree <selector>` to the now-correct `--continue --worktree <worktree-path>`.
`bun test plugins/sp` stays green — in particular the command↔`dev-operations.md` flag/positional
parity gates and the `Default` column parity gate.
### Acceptance Criteria
```gherkin
Feature: --worktree accepts an existing worktree name for batch reuse

  # ── R1: optional-value flag surface ──
  Scenario: R1.1 The three batch commands declare the optional value
    Given the sp plugin command documents
    When I inspect dev-runall, dev-refineall, and dev-verifyall
    Then each frontmatter argument-hint contains "[--worktree [<name>]]"
    And each Argument Flags table has a row whose first cell is "--worktree [<name>]"
    And that row's Default cell is "off"
    And each Usage block shows the optional value

  Scenario: R1.2 dev-operations.md rows match the hints
    Given plugins/sp/skills/spur-dev/references/dev-operations.md
    When I read the Inputs cell for rows 3a, 5a, and 13
    Then each shows "--worktree [<name>]"

  Scenario: R1.3 Bare --worktree still creates
    Given a clean main tree on base ref "feat/example"
    When I run a batch command with "--worktree" and no value
    Then a new worktree is created on a derived branch cut from "feat/example"
    And the WT-1 through WT-5 create-mode lifecycle applies unchanged

  Scenario: R1.4 A following flag is not consumed as the name
    Given a clean main tree
    When I run a batch command with "--worktree --auto"
    Then "--auto" is parsed as a flag, not as a worktree name
    And the invocation is treated as bare --worktree (create mode)

  Scenario: R1.5 dev-next still has no --worktree
    Given the dev-next command document
    When I inspect its argument-hint and Argument Flags table
    Then --worktree is absent in both forms

  # ── R2: name resolution ──
  Scenario: R2.1 A basename resolves to exactly one worktree
    Given "git worktree list --porcelain" reports a worktree at "../spur-new-runall-h1-a3f2"
    When I run a batch command with "--worktree spur-new-runall-h1-a3f2"
    Then that worktree is selected as the batch target
    And no new worktree is created

  Scenario: R2.2 A branch name resolves to its worktree
    Given a worktree whose checked-out branch is "sp/runall-h1-a3f2"
    When I run a batch command with "--worktree sp/runall-h1-a3f2"
    Then that worktree is selected as the batch target

  Scenario: R2.3 An unresolvable name aborts without creating
    Given no worktree matches "typo-name" by path, basename, or branch
    When I run a batch command with "--worktree typo-name"
    Then the command aborts before any task work
    And it lists the resolvable worktrees with their paths and branches
    And it states that --worktree <name> never creates a worktree
    And no worktree is created

  Scenario: R2.4 An ambiguous name aborts and demands the path form
    Given two worktrees match the supplied name
    When I run a batch command with that name
    Then the command aborts naming both candidates
    And it instructs the operator to pass the full worktree path

  Scenario: R2.5 A locked or prunable worktree aborts
    Given the resolved worktree is reported locked or prunable by git
    When I run a batch command targeting it
    Then the command aborts naming the condition
    And no task work runs

  # ── R3: reuse-mode lifecycle deltas ──
  Scenario: R3.1 A dirty main tree still aborts in reuse mode
    Given the main tree has uncommitted changes
    When I run a batch command with "--worktree <existing>"
    Then the command aborts naming the offending files
    And "--force" proceeds with the divergence warning

  Scenario: R3.2 A dirty target worktree is reported, not fatal
    Given the resolved worktree has uncommitted partial work from a halted batch
    When I run a batch command targeting it
    Then the uncommitted files are reported once
    And the batch proceeds in that worktree

  Scenario: R3.3 No second worktree and no redundant install
    Given the resolved worktree already contains node_modules
    When I run a batch command targeting it
    Then WT-2 creation is skipped
    And "bun install --frozen-lockfile" is not re-run
    And the batch loop runs with that worktree as process cwd

  Scenario: R3.4 A cold reused worktree installs once
    Given the resolved worktree has no node_modules
    When I run a batch command targeting it
    Then "bun install --frozen-lockfile" runs before the first task

  Scenario: R3.5 A detached-HEAD worktree aborts
    Given the resolved worktree has a detached HEAD
    When I run a batch command targeting it
    Then the command aborts because no branch can serve as $BRANCH

  Scenario: R3.6 An existing marker is adopted, not duplicated
    Given a retained marker under .spur/run/ for the resolved worktree path
    When I run a different batch command targeting that worktree
    Then the same marker file is updated in place
    And its command and selector become the current invocation
    And its baseRef and baseSha are preserved
    And its status becomes "active"

  Scenario: R3.7 A foreign worktree gets a synthesized marker
    Given the resolved worktree has no marker under .spur/run/
    When I run a batch command targeting it
    Then a marker is written with adopted set to true
    And baseRef is the invoking tree's current HEAD ref
    And baseSha is the merge-base of baseRef and the worktree branch

  Scenario: R3.8 An active marker blocks a second writer
    Given the marker for the resolved worktree is at status "active"
    When I run a batch command targeting it
    Then the command aborts citing one-writer-per-tree
    And "--force" overrides and proceeds

  # ── R4: terminal path ──
  Scenario: R4.1 A green reuse batch merges but retains
    Given a reuse-mode batch in which every task succeeded
    When the batch completes
    Then the worktree branch is fast-forward-merged onto its base ref from the main tree
    And the worktree directory is not removed
    And the branch is not deleted
    And the marker status becomes "merged"

  Scenario: R4.2 Create mode still removes on success
    Given a bare --worktree batch in which every task succeeded
    When the batch completes
    Then the worktree is removed and its branch deleted, as before

  Scenario: R4.3 Non-FF falls through to retention in both modes
    Given the base ref has moved so fast-forward is impossible
    When the batch completes successfully
    Then no rebase, merge commit, or conflict resolution is attempted
    And the WT-5 retention report is emitted naming the divergence

  Scenario: R4.4 A failed reuse batch retains and reports
    Given a reuse-mode batch that halts on a task failure
    When the batch stops
    Then the worktree and branch are left intact
    And the marker status becomes "retained"
    And the retention report names the worktree path, branch, base ref, and halt cause

  # ── R5: doc consistency ──
  Scenario: R5.1 The retention report's resume line is correct
    Given the WT-5 retention report template in execution-batch.md
    When I read its resume line
    Then it reads "--continue --worktree <worktree-path>"
    And it no longer passes the selector as the --worktree value

  Scenario: R5.2 An explicit name outranks the marker scan
    Given a retained worktree from a halted "dev-runall --worktree" batch
    When I run "dev-verifyall --continue --worktree <that-worktree>"
    Then the named worktree is resolved directly
    And the command+selector marker scan is not required to match

  Scenario: R5.3 WT-7 no longer forbids operator-supplied names
    Given execution-batch.md section WT-7
    When I read its exclusions
    Then "no operator-supplied worktree name" is gone
    And "no create-with-name" and "no auto-cleanup of stale worktrees or markers" remain
    And "--worktree --mode parallel is rejected" remains
    And "dev-next does not get --worktree" remains

  Scenario: R5.4 The plugin contract gates stay green
    Given the sp plugin test suite
    When I run "bun test plugins/sp"
    Then command-contract, command-flag-parity, and flag-contract-parity all pass
    And the --worktree Default column parity between each command and dev-operations.md holds
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
#### Two modes, one flag

| Invocation | Mode | WT-1 | WT-2 | WT-3 | WT-4 (all green) | WT-5 (failure/non-FF) |
| --- | --- | --- | --- | --- | --- | --- |
| `--worktree` | create | abort on dirty main tree | create branch + tree, install | write marker | FF-merge, **remove tree, delete branch** | retain + report |
| `--worktree <name>` | reuse | abort on dirty main tree; target dirt is reported only | **skipped** — adopt existing branch; install only if `node_modules` absent | adopt or synthesize marker | FF-merge, **retain tree and branch** | retain + report |

The asymmetry in WT-4 is the one deliberate behavior difference, and it follows a single rule:
**the flag removes only what it created.** In create mode the flag owns the tree, so cleanup is its
job. In reuse mode the operator owns it. This also makes the continue-the-work loop stable — after
a green reuse batch, `baseRef == $BRANCH`, so the same worktree keeps fast-forwarding on the next
invocation instead of having to be rebuilt.

#### Resolution algorithm (R2)

```bash
# Authority: git, not the marker store — a marker may be stale, git is not.
git worktree list --porcelain
```

Match `<name>` in this order, stopping at the first tier that yields ≥1 hit:

1. exact `worktree <path>` (after path normalization against the invoking tree)
2. `basename(<path>)`
3. `branch refs/heads/<name>` (accept both `<name>` and the full ref)

Then require exactly one survivor:

- **0 hits** → abort. Print each candidate as `<basename>  <branch>  <path>`, and the line
  *"`--worktree <name>` selects an existing worktree; it never creates one. Use bare `--worktree`
  to create."*
- **≥2 hits** → abort naming the candidates, require the path form.
- **1 hit, but** `locked` / `prunable` / different repo → abort naming the condition.

Marker files are **not** an input to resolution — a foreign worktree with no marker is a valid
target (R3 synthesizes one). Resolving off `.spur/run/` would make the flag unable to name the very
trees the operator created by hand, which is half the use case.

#### Marker delta (WT-3)

Two fields added to the existing schema; everything else is unchanged:

```json
{
  "adopted": true,
  "adoptedAt": "<iso-8601>"
}
```

`adopted` is what WT-4 reads to decide retain-vs-remove, so it must also be set when reuse mode
adopts a marker that create mode originally wrote — i.e. it records "this run did not create this
tree", not "this tree was never created by the flag". State machine, unchanged except that `merged`
is now reachable without removal:

`active` → `merged` (WT-4) | `retained` (WT-5), and `retained` → `active` on a reuse re-entry.

#### Why the two-writer abort is worth its weight (R3)

`AGENTS.md` states one writer per working tree, and task 0487 R5 recorded the symptom: two sessions
in one checkout overwrite each other silently and it reads as a model regression. Create mode is
immune by construction — every run gets a fresh tree. Reuse mode reintroduces exactly that hazard,
so the `status: active` check is not defensive padding; it is the guard that keeps the new mode from
regressing the invariant the old mode got for free. `--force` is the escape hatch because a marker
left `active` by a crashed session is indistinguishable from one held by a live session, and the
operator can tell them apart.

#### Rejected alternatives

| Alternative | Why not |
| --- | --- |
| `--worktree <name>` creates when the name is unresolved | A typo silently starts a fresh batch against the wrong tree after a full `bun install`. Fail-loud is cheaper than a wasted batch. |
| A separate `--worktree-reuse <name>` flag | Two flags for one concept; every command doc, the glossary, and three parity gates pay for the duplication. The optional value is the smaller surface. |
| Reuse mode also removes the tree on success | Destroys the operator's own long-lived tree on its first green run — surprising, and unrecoverable-by-flag (they must re-create and re-install). |
| Resolve `<name>` against `.spur/run/` markers | Cannot name hand-made worktrees, which is a primary use case. Git is the authority for what exists. |
| Keep `cd <worktree> && <command>` as the answer | Works only by cwd accident: no marker update, no FF-merge-back, no retention report. That is the manual integration cost 0477 set out to remove. |

#### Surfaces touched

| File | Change |
| --- | --- |
| `plugins/sp/commands/dev-runall.md` | argument-hint, flag row, Usage, corpus-visibility note |
| `plugins/sp/commands/dev-refineall.md` | same |
| `plugins/sp/commands/dev-verifyall.md` | same |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | Inputs cells for rows 3a, 5a, 13 |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | `#flag-worktree` rewritten for two modes |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | WT-1…WT-7 deltas + WT-5 resume-line fix |

No TypeScript. No `spur` CLI change (0477 R8.4 still holds — `spur workflow run` takes cwd from the
process, `apps/cli/src/commands/workflow.ts:124`).

#### Parity-gate constraints the edits must respect

- `validate-commands.ts` `extractHintTokens` pulls `<...>` positionals from the hint and compares
  them against the Argument Flags table's first cells. Writing `[--worktree [<name>]]` in the hint
  therefore **requires** the table cell to be `` `--worktree [<name>]` `` — matching literals on
  both sides, exactly as `--mode <full|implement>` already does.
- `checkDefaultsParity` compares the command table's `Default` cell against the `dev-operations.md`
  Inputs section. Keep `off` on both sides: "off" means *no worktree when the flag is absent*, which
  both modes still satisfy.
- Flag extraction is `/(--[a-z][a-z0-9-]*)/g`, so the added value placeholder cannot introduce a
  phantom flag.
### Plan
- [ ] Rewrite `#flag-worktree` in `flag-glossary.md` for the two modes, the value-binding rule, and the removes-only-what-it-created ownership line (R1, R4)
- [ ] Amend `execution-batch.md` WT-1/WT-2/WT-3 with the reuse-mode deltas: main-tree precheck unchanged, target dirt reported, creation skipped, conditional install, marker adopt/synthesize/active-abort (R3)
- [ ] Add the `<name>` resolution algorithm to `execution-batch.md` as a new sub-section under WT-2, including the 0-hit and ≥2-hit abort messages (R2)
- [ ] Split WT-4 into create-mode and reuse-mode terminal paths, add `adopted` + `adoptedAt` to the WT-3 marker schema (R4)
- [ ] Make WT-6 resolve by explicit name first, falling back to the command+selector marker scan; fix the WT-5 retention-report resume line to `--continue --worktree <worktree-path>` (R5)
- [ ] Narrow WT-7 exclusions: drop "no operator-supplied worktree name", keep no-create-with-name, no auto-cleanup, parallel-rejected, dev-next-excluded (R5)
- [ ] Update all three command docs — argument-hint, Argument Flags row, Usage block — and the three `dev-operations.md` Inputs cells (R1)
- [ ] Run `bun test plugins/sp` and `bun run lint`; extend `command-flag-parity.test.ts` with an assertion that the three hints carry the `[<name>]` placeholder (R5)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing
**Coverage target: N/A.** This task adds no TypeScript — the deliverable is the `sp` plugin's prose
contract. The `bunfig.toml` per-file ≥ 90% line/function gate has no new production code to bind, and
the one test edit below extends an existing suite rather than adding a measurable unit. Report
coverage as unchanged, not as a number.

#### Automated

`--worktree` is a prose contract, not code, so the executable surface is the plugin contract suite —
that is where the check belongs, not in a new file:

```bash
bun test plugins/sp
```

Must stay green, specifically:

- `command-contract.test.ts` — gate (b) frontmatter schema, gate (e) Argument Flags table shape and
  hint↔table token parity. The nested `[<name>]` placeholder is the risk: the hint's `<name>`
  positional must have a matching literal in the table's first cell.
- `command-flag-parity.test.ts` — bidirectional parity between each `dev-operations.md` row and the
  matching argument-hint; glossary membership for flags declared by ≥2 commands (`--worktree` is
  declared by 3, so it must keep exactly one canonical glossary entry).
- `flag-contract-parity.test.ts` — `checkDefaultsParity` (command table `Default` vs
  `dev-operations.md` Inputs) and `checkSsotAnchorsResolve` (the `#flag-worktree` anchor stays
  resolvable from `execution-batch.md`).

**One new assertion** in `command-flag-parity.test.ts`: the three batch hints contain
`--worktree [<name>]` and `dev-next` contains no `--worktree` at all. This is the only part of the
contract a test can bind — it fails if a future edit silently drops the optional value from one of
the three surfaces, which is the drift class this task's parity gates exist for.

Then the full gate:

```bash
bun run autofix && bun run spur-check
```

#### Manual smoke (the lifecycle a test cannot bind)

Run from a scratch feature branch; the point is to confirm the prose is executable as written.

1. **Reuse resolves and does not duplicate.** `git worktree add ../spur-new-smoke -b sp/smoke HEAD`,
   then run `/sp:dev-verifyall --tasks <small-set> --worktree spur-new-smoke`. Confirm:
   `git worktree list` still shows exactly two trees, and a marker with `adopted: true` appears
   under `.spur/run/`.
2. **Cold vs warm install.** Repeat with `node_modules` present in the target; confirm
   `bun install --frozen-lockfile` is skipped.
3. **Fail-loud on a typo.** `--worktree spur-new-smoek` aborts, lists candidates, creates nothing.
4. **Retain on success.** After a fully-green reuse batch, confirm the FF-merge landed on the base
   ref **and** `../spur-new-smoke` plus `sp/smoke` still exist, marker `status: merged`.
5. **Two-writer abort.** Hand-set the marker to `status: active`, re-run, confirm the abort, then
   confirm `--force` proceeds.
6. **Cross-command resume.** Halt a `dev-runall --worktree` batch, then
   `dev-verifyall --continue --worktree <path>` — the path resolves without the command+selector
   marker scan matching (R5.2). This is the case that is unsupported today.

Cleanup: `git worktree remove ../spur-new-smoke && git branch -D sp/smoke`.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
#### Prior art

- Task 0477 (`docs/tasks3/0477_batch-worktree-isolation-worktree-for-dev-runall-dev-refinea.md`) —
  shipped `--worktree`; its R8.3 is the exclusion this task narrows.
- Task 0481 (`docs/tasks3/0481_0475-verify-retrospective-worktree-deps-install-worktree-loc.md`) —
  worktree dependency-install cost; source of the conditional-install rule in R3.
- Task 0484 (`docs/tasks3/0484_fix-feature-n-batch-defects-worktree-merge-contradiction-p.md`) —
  prior worktree/merge contract contradiction; read before touching WT-4.
- Task 0142 (`docs/tasks2/0142_batch-execution-v2-parallel-runs-worktree-isolation-interact.md`) —
  Slice A owns per-task worktrees and `--mode parallel`; still out of scope here.
- Task 0487 R5 — one writer per working tree; the invariant R3's `status: active` abort protects.

#### Contract surfaces

- `plugins/sp/skills/spur-dev/references/execution-batch.md` § Worktree isolation (WT-1 … WT-7)
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` § `--worktree` (`#flag-worktree`)
- `plugins/sp/skills/spur-dev/references/dev-operations.md` — rows 3a, 5a, 13
- `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` — git mechanics; reuse, do not
  re-author
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:449` — the WT-4 auto-decision carve-out;
  reuse mode's retain-on-success is *narrower* than the carve-out (no branch deletion), so the
  carve-out text needs no widening

#### Gate implementations to read before editing

- `plugins/sp/scripts/validate-commands.ts:388` `extractHintTokens` / `:408` `extractTableTokens`
- `plugins/sp/scripts/validate-flag-contracts.ts:287` `checkDefaultsParity`
- `plugins/sp/tests/command-flag-parity.test.ts` — header comment documents which task owns each gate

#### Project rules in force

- `AGENTS.md` § Conventions — one writer per working tree; commit per task
- `AGENTS.md` § Verification gate — `bun run autofix && bun run spur-check`
### History
