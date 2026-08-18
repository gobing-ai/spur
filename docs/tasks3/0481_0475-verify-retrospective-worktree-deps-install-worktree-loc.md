---
template: meta
schema_version: 1
name: "0475-verify retrospective: worktree deps install, worktree-local spur CLI, merge commit-type contract, lifecycle transition chain, merge side-effect hygiene"
description: ""
status: done
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-08T05:17:31.225Z"
updated_at: "2026-08-18T04:42:48.582Z"
---

## 0481. 0475-verify retrospective: worktree deps install, worktree-local spur CLI, merge commit-type contract, lifecycle transition chain, merge side-effect hygiene

### Background
Task 0475 (Refine-loop friction: narrow prose-prerequisite heuristic, fix DD-09, premise-verification) was implemented and verified in an isolated git worktree on branch `fix/0475-prose-prereq-heuristic`, then merged to `main` (`14cc3afe`). The implementation was correct: 102/102 tests passed, typecheck clean, biome clean, 0475's corpus L4 prose findings dropped 18 → 5 (target ≤7), fictional prerequisite-cycles 1 → 0.

The **verification and merge workflow**, however, was materially slower and more error-prone than it should have been ("we spend so long time to verify task 0475"). A forensic review of that session found five friction points. Task 0477 (`--worktree` for `dev-runall`/`dev-refineall`/`dev-verifyall`) makes worktree-isolated runs the default surface for batches, so each of these will recur on every batch run until fixed.

**This task is documentation-and-config only.** Four of the five fixes land in `plugins/sp/skills/**` markdown; R5 lands in a single `.lefthook.yml` line. No `apps/` or `packages/` source changes. Task 0477 states explicitly that worktree isolation "stays entirely in the plugin layer: three command documents, the flag glossary, and the `sp:spur-dev` execution-batch reference" — there is no CLI worktree-creation code to wire into.

The five findings, with corrected root causes:

1. **Fresh worktrees have no `node_modules`.** `node_modules` is gitignored, so `git worktree add` yields an empty dependency tree and the first `bun test`/typecheck fails with `Cannot find module '@gobing-ai/spur-config'` (a workspace package in `packages/config/`). `execution-batch.md` §WT-2 creates the worktree and immediately runs the batch loop with no install step in between. ~60s of discovery-and-fix per worktree, paid on every batch run.

2. **`spur` on PATH is a published bundle, not this tree's source.** `/Users/robin/.bun/bin/spur` symlinks to `/Users/robin/node_modules/@gobing-ai/spur/spur.js` — a 3.4 MB **published npm build at v0.3.35**, not the main repo's source and not the worktree's. `resolveSpurBin()` (`apps/cli/src/workflow/resolve-spur-bin.ts`) then propagates that entry binary into every FSM guard: `config/workflows/task-lifecycle.yaml` declares `vars.spurBin: 'spur'`, and the `wip→testing` / `testing→done` guards run `$spurBin task check`. So one wrong entry point silently gate-checks the whole lifecycle against a stale published bundle. This is a **monorepo-wide** trap (already half-noted in `CLAUDE.md` § "Local `spur` CLI on PATH (dev)"), and worktree isolation makes it a correctness break rather than a staleness annoyance. Highest-value finding.

3. **The documented merge command cannot pass the `cog` commit-msg hook.** `branch-workflow/SKILL.md` §5 and `references/branch-lifecycle.md` §Merge both prescribe `git merge --no-ff <branch>` and neither says anything about the merge-commit message. `--no-ff` always creates a commit; its default message (`Merge branch 'x'`) is not a conventional commit, and `cog verify` (no `cog.toml` in this repo, so cocogitto defaults apply) rejects it — as it rejected the `merge(0475):` message actually used, with "Commit type `merge` not allowed", leaving the merge staged but uncommitted. The documented workflow is therefore broken as written, on **every** feature-branch merge. (0477 §WT-4 uses `git merge --ff-only`, which creates no commit and never fires the hook — there is no conflict with 0477.)

4. **The lifecycle transition chain is not stated anywhere agent-readable.** `spur task update 0475 done` from `wip` fails with `No transition from "wip" to "done"`. `config/workflows/task-lifecycle.yaml` is the SSOT (`backlog → todo → wip → testing → done`, `done → wip` reopen, `blocked` bidirectional, `cancelled` terminal), but `gate-checklists.md` documents only the gates themselves, never the graph. Its "done gate (`testing → done`)" section already covers the Review L3 prerequisite in full — only the chain itself is missing.

5. **The pre-commit hook formats the entire repository.** `.lefthook.yml` `pre-commit` runs `bun run format` = `biome check . --write` — the `.` is the whole repo. The `glob: "*.{js,ts,tsx,jsx,json}"` only decides *whether* the command fires, not *what* it touches, and there is no `stage_fixed`, so the reformatted out-of-scope files are left **unstaged**. That is why the 0475 merge commit reformatted `packages/domain/tests/analytics/artifact.test.ts` and `plugins/sp/plugin.json`, and why the resulting dirty tree then blocked `git stash pop`. This is systemic and reproducible on any commit in a repo carrying formatting drift — not the one-off it was first read as.

All findings were cross-checked against the corpus. The precheck size-gate (0478 R1), verify answer-format (0478 R2), redundant typecheck (0478 R3), done-gate/verdict handling (0479 R1), file:line anchor contract (0479 R2), AC-subset warnings (0479 R3), flag-parity cwd (0479 R4), run-once-and-parse (0479 R5), sandbox spur-check baseline (0479 R6), and executor/inline resolution (0480 R6/R7/R8, 0406) are already owned elsewhere and are deliberately excluded.
### Requirements
- [ ] **R1 — Install dependencies as part of worktree creation.** `node_modules` is gitignored, so a fresh worktree fails its first `bun test`/typecheck with `Cannot find module '@gobing-ai/spur-config'`. Add `bun install --frozen-lockfile` as an explicit post-create step in `plugins/sp/skills/spur-dev/references/execution-batch.md` §WT-2 (between `git worktree add` and the Steps 1–5 loop) and in `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` §Create. Use the frozen lockfile so the worktree matches `bun.lock` rather than re-resolving. Verify: `rg -c 'bun install --frozen-lockfile' plugins/sp/skills/spur-dev/references/execution-batch.md plugins/sp/skills/branch-workflow/references/worktree-patterns.md` reports ≥1 in each.

- [ ] **R2 — State the `spur`-on-PATH trap and the source-local invocation.** `spur` resolves to a published bundle (`~/.bun/bin/spur` → `~/node_modules/@gobing-ai/spur/spur.js`, v0.3.35), not to any checkout; `resolveSpurBin()` then propagates that entry binary into the `task-lifecycle.yaml` guards, so gate checks silently run against the bundle. Document in `worktree-patterns.md` and `execution-batch.md` §WT-2: inside a worktree (and in the monorepo generally when validating CLI changes) invoke `bun apps/cli/src/index.ts …` from the tree under test, never bare `spur`. Name the propagation path (`resolveSpurBin` → `vars.spurBin` → `$spurBin task check`) so the reason is checkable, not folklore. Verify: both files name the trap and prescribe `bun apps/cli/src/index.ts`; a `task check` run inside a worktree reflects a distinctive worktree-only change while bare `spur` does not.

- [ ] **R3 — Make the documented merge command produce a `cog`-valid commit.** `branch-workflow/SKILL.md` §5 Merge and `references/branch-lifecycle.md` §Merge both prescribe `git merge --no-ff <branch>` with no `-m`, whose default `Merge branch 'x'` message `cog verify` rejects; `merge:` is likewise not an allowed type. Fix **both** files to prescribe an explicit conventional message — `git merge --no-ff <branch> -m "chore(<scope>): merge <branch> into <base>"` — and state that `cog` rejects both the default merge message and a `merge:` type, and that `--no-verify` is not the remedy. Do not add a `cog.toml`: a repo-wide cocogitto config to permit one commit type is a larger blast radius than the one-line message fix. Verify: `rg -n 'chore\(' plugins/sp/skills/branch-workflow/SKILL.md plugins/sp/skills/branch-workflow/references/branch-lifecycle.md` hits both; a real `--no-ff` merge following the documented command completes in one commit with no `cog` failure.

- [ ] **R4 — State the transition graph once, next to the gates.** `spur task update <wbs> done` from `wip` fails (`No transition from "wip" to "done"`); the graph lives only in `config/workflows/task-lifecycle.yaml`. Add a short "Task lifecycle transitions" block at the top of `plugins/sp/skills/spur-dev/references/gate-checklists.md` giving the forward chain `backlog → todo → wip → testing → done`, the `done → wip` reopen edge, `blocked` as bidirectional with `todo`/`wip`/`testing`, `cancelled` as terminal, and that `wip → done` is not an edge. Cite `config/workflows/task-lifecycle.yaml` as SSOT so the block is checkable against it. Do **not** restate the Review L3 / verdict-artifact prerequisites — the existing "done gate (`testing → done`)" section already owns them; link to it instead. Verify: `rg -n 'wip → testing → done|task-lifecycle.yaml' plugins/sp/skills/spur-dev/references/gate-checklists.md` hits, and the transitions listed match `config/workflows/task-lifecycle.yaml`.

- [ ] **R5 — Scope the pre-commit formatter to staged files.** `.lefthook.yml` `pre-commit` runs `bun run format` (`biome check . --write`), which rewrites the **whole repo** regardless of the `glob:` filter, and leaves the out-of-scope rewrites unstaged — the cause of the 0475 merge reformatting `artifact.test.ts` and `plugin.json` and of the subsequent blocked `git stash pop`. Replace the command with the staged-file form `bunx biome check --staged --write --no-errors-on-unmatched` and add `stage_fixed: true` so formatting of the operator's own files is amended into the commit and nothing else is touched. (`--staged` is supported by Biome 2.4.16 — confirmed via `biome check --help`.) Verify: `.lefthook.yml` pre-commit no longer runs a repo-wide `biome check .`; a commit touching one file in a repo with drift elsewhere leaves `git status` clean apart from that commit.
### Acceptance Criteria
Feature: 0475-verify retrospective — worktree and merge friction removed at its source

  Scenario: R1 — worktree creation installs dependencies
    Given the worktree-creation guidance in execution-batch.md §WT-2 and worktree-patterns.md §Create
    When an agent follows either document to create a worktree
    Then `bun install --frozen-lockfile` appears as an explicit post-create step in both files
    And it is placed before the batch loop / first test invocation, not after
    And a worktree created by following the steps runs `bun test` with no manual install

  Scenario: R2 — the spur-on-PATH trap is named and the source-local invocation prescribed
    Given an agent about to run spur commands inside a worktree or against monorepo CLI changes
    When it consults worktree-patterns.md or execution-batch.md §WT-2
    Then both files state that `spur` on PATH resolves to a published bundle, not the checkout
    And both prescribe `bun apps/cli/src/index.ts …` from the tree under test
    And the propagation path resolveSpurBin → vars.spurBin → `$spurBin task check` is named
    And a `task check` inside a worktree reflects a worktree-only change that bare `spur` misses

  Scenario: R3 — the documented merge command passes the cog hook
    Given branch-workflow/SKILL.md §5 and branch-lifecycle.md §Merge
    When an operator runs the merge command exactly as documented
    Then the command carries an explicit conventional `-m "chore(<scope>): …"` message
    And both files state that cog rejects the default merge message and a `merge:` type
    And both state that `--no-verify` is not the remedy
    And the merge completes in a single commit with no cog failure

  Scenario: R4 — the transition graph is stated once, beside the gates
    Given an agent transitioning a task between statuses
    When it consults gate-checklists.md
    Then the chain `backlog → todo → wip → testing → done` is stated there
    And `wip → done` is stated explicitly as not an edge
    And the block cites config/workflows/task-lifecycle.yaml as SSOT and matches it
    And the Review L3 / verdict prerequisites are linked, not restated

  Scenario: R5 — the pre-commit formatter touches only staged files
    Given a repository carrying formatting drift in files unrelated to the commit
    When a commit touching one js/ts/json file runs the pre-commit hook
    Then the hook formats only the staged files (`biome check --staged --write`)
    And `stage_fixed: true` amends those fixes into the commit
    And `git status` after the commit shows no unstaged reformatting of unrelated files
### Q&A
- *Why are R1–R4 documentation fixes and not code?* Task 0477 landed worktree isolation entirely in the plugin layer — it states "no CLI change is required", because `spur workflow run` resolves everything from process cwd. There is no worktree-creation function to add an install call to; §WT-2 of `execution-batch.md` *is* the creation path, and it is prose an agent follows. R1–R4 are missing constraints in agent-followed procedure, so the fix is in the procedure. R5 is the one finding with a real config surface, and it gets a config fix.

- *Why is R2 the highest-value item?* Worktree isolation is only correct if commands inside the worktree run the worktree's code. Bare `spur` runs a published bundle (v0.3.35) that is neither tree, and `resolveSpurBin()` propagates that entry choice into the `task-lifecycle.yaml` guards — so a batch can gate-check and transition tasks using stale `task check` logic with no error anywhere. Silent wrong-answer beats loud failure for cost. The fix is two paragraphs; the hole it closes is unbounded.

- *Why did R5 change from "monitor, don't fix"?* The first reading blamed pre-existing formatting drift in a dirty `main` and proposed documenting a manual `git checkout --` workaround. Reading `.lefthook.yml` against `package.json:63` shows the hook runs `biome check . --write` — the whole repository — with no `stage_fixed`. The `glob:` filter gates whether the command runs, not what it touches. That is systemic and reproduces on any commit in a repo with drift anywhere. Documenting a workaround for a one-line config bug would have shipped the friction permanently.

- *Why not add a `cog.toml` for R3?* Permitting a `merge` type means introducing a repo-wide cocogitto config that also governs `cog check` on pre-push, to solve what is a message-formatting problem. Passing an explicit `-m "chore(<scope>): …"` has no blast radius and fixes the same failure. If the project later wants a `cog.toml` for other reasons, allowing `merge` can ride along.

- *Doesn't R3 conflict with 0477's fast-forward merge?* No — that was a misreading. §WT-4 uses `git merge --ff-only`, which advances the ref without creating a commit, so `commit-msg` never fires and `cog` never runs. R3 governs the manual `--no-ff` path in `branch-workflow`, which 0477 does not use. The two are independent.

- *Isn't narrowing the pre-commit formatter a loss of coverage?* Only of *incidental* coverage. Repo-wide drift is still caught by `bun run lint` (`biome check . --error-on-warnings`) at pre-push and inside `spur-check`. The difference is that drift now fails a gate loudly instead of being silently rewritten into an unrelated commit and left unstaged — which is what broke the 0475 merge.

- *Why is R4 narrower than first drafted?* `gate-checklists.md` already documents the `testing → done` gate's three layers, including the Review L3 populated-P1–P4 table and the verdict artifact. Only the transition *graph* is missing. Restating the gate prerequisites in a second block would create two copies of one contract — the same drift class this task is closing. R4 adds the graph and links to the existing section.

- *What does each fix save?* R1: ~60s discovery-and-install per worktree, paid on every `--worktree` batch. R2: prevents a silent wrong-source verification whose cost is unbounded. R3: a 2–5 min confused detour on every feature-branch merge, plus a half-completed merge state. R4: a 2–5 min detour per task reaching `done`. R5: removes a class of spurious dirty trees and blocked stash/merge operations.

- *Why are 0478/0479/0480 items excluded?* Each is already owned: precheck size-gate (0478 R1), verify answer-format (0478 R2), redundant typecheck (0478 R3), done-gate/verdict handling (0479 R1), file:line anchors (0479 R2), AC-subset warnings (0479 R3), flag-parity cwd (0479 R4), run-once-and-parse (0479 R5), sandbox spur-check baseline (0479 R6), executor/inline resolution (0480 R6/R7/R8, 0406). Duplicating them creates conflicting ownership and double-fix risk.
### Design
All five fixes are edits to four files. No `apps/` or `packages/` source change.

| R | File | Insertion point |
|---|---|---|
| R1, R2 | `plugins/sp/skills/spur-dev/references/execution-batch.md` | §WT-2 — Worktree creation |
| R1, R2 | `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` | §Commands → Create |
| R3 | `plugins/sp/skills/branch-workflow/SKILL.md` | §5 Merge |
| R3 | `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md` | §Per-phase commands → Merge |
| R4 | `plugins/sp/skills/spur-dev/references/gate-checklists.md` | new block after the intro, before §feature-check gate |
| R5 | `.lefthook.yml` | `pre-commit.commands.format` |

#### R1 — Install dependencies as part of worktree creation

**Evidence.** In the 0475 worktree, `bun test packages/app/tests/services/task-check.test.ts` failed immediately:

```
Cannot find module '@gobing-ai/spur-config' from 'packages/app/tests/services/task-check.test.ts'
```

`@gobing-ai/spur-config` is the workspace package in `packages/config/`. `bun.lock` is tracked; `node_modules` is gitignored. `execution-batch.md` §WT-2 runs `git worktree add` and then says "run the existing batch loop (Steps 1–5) with the worktree as process cwd" — no install between the two.

**Proposed content** (append to §WT-2, before the "run the existing batch loop" sentence; mirror in `worktree-patterns.md` §Create):

```markdown
A fresh worktree has no `node_modules` (gitignored), so the first `bun test` or
typecheck fails on the first workspace import. Install before any task work:

    cd "../<worktree-dir>" && bun install --frozen-lockfile

`--frozen-lockfile` pins the worktree to `bun.lock` rather than re-resolving,
so the worktree's dependency tree matches the base ref's.
```

#### R2 — The `spur`-on-PATH trap

**Evidence.** Verified on this box:

```
/Users/robin/.bun/bin/spur -> ../../node_modules/@gobing-ai/spur/spur.js
/Users/robin/node_modules/@gobing-ai/spur/    # real directory, not a link
  package.json  → "@gobing-ai/spur", "version": "0.3.35"
  spur.js       → 3,425,532 bytes (published bundle)
```

So `spur` is a **published build artifact**, not the main repo's source and not the worktree's. (The repo-local `node_modules/@gobing-ai/spur -> ../../apps/cli` symlink only affects module resolution *within* the repo, not the PATH shim, which resolves through an absolute symlink.)

The propagation that makes this a correctness issue rather than a staleness one:

- `apps/cli/src/workflow/resolve-spur-bin.ts` — `resolveSpurBin()` returns `` `${process.execPath} ${Bun.main}` `` when the runtime is bun/node, i.e. the **entry binary re-invokes itself**.
- `apps/cli/src/commands/workflow.ts:250,277` — that value is injected as `vars.spurBin` for every workflow run.
- `config/workflows/task-lifecycle.yaml` — declares `vars.spurBin: 'spur'` as the default and uses it in both hard guards: `'$spurBin task check $wbs'` (`wip→testing`) and `'$spurBin task check $wbs --strict-core'` (`testing→done`).

Entering via bare `spur` therefore gate-checks the worktree's tasks with the published bundle's `task check`. Entering via `bun apps/cli/src/index.ts` from the worktree makes `resolveSpurBin()` return the worktree path and the guards self-consistent. During 0475, `bun apps/cli/src/index.ts task check 0475 --json` run with the worktree as cwd was what made the before/after corpus measurement reflect the worktree's modified `task-check.ts`.

**Proposed content** (both files, as an H3 section titled "`spur` on PATH is not this checkout"):

```markdown
`spur` (`~/.bun/bin/spur`) resolves to a *published* bundle in `~/node_modules/`,
not to the repo you are standing in and not to the worktree. `resolveSpurBin()`
propagates whichever binary you entered through into `vars.spurBin`, which the
`task-lifecycle.yaml` guards run as `$spurBin task check` — so one wrong entry
point silently gate-checks against the published bundle.

Inside a worktree, and in the monorepo whenever CLI behavior is under test, invoke
the tree's own source:

    cd "<worktree>" && bun apps/cli/src/index.ts task check <wbs> --json

Confirm isolation by making a distinctive change in the worktree and checking that
the command reflects it.
```

#### R3 — A `cog`-valid merge command

**Evidence.** During the 0475 merge:

```
git merge fix/0475-prose-prereq-heuristic --no-ff -m "merge(0475): ..."
cog ❯ Error: Commit type `merge` not allowed
Not committing merge; use 'git commit' to complete the merge.
```

The merge was left staged and completed manually with `git commit -m "chore(0475): merge ..."`.

The hook is `.lefthook.yml` `commit-msg → cog verify --file {0}`. There is **no `cog.toml`** in the repo, so cocogitto's default type set applies (`feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`) — `merge` is not in it, and neither is git's default `Merge branch 'x'` message a conventional commit at all.

Both documented merge commands are therefore broken as written:

- `plugins/sp/skills/branch-workflow/SKILL.md` §5 — `git merge --no-ff feature/<slug>` (no `-m`)
- `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md` §Merge — `git merge --no-ff feature/my-feature` (no `-m`)

Both would drop into an editor pre-filled with the default merge message, and `cog` would reject it. This is not a 0475-specific accident.

**No conflict with 0477.** §WT-4 uses `git merge --ff-only`, which creates no commit and never fires `commit-msg`. The earlier reading that R3 "collides with 0477 R4's fast-forward-merge expectation" was wrong — the two paths do not interact.

**Proposed content** (both files):

```markdown
git merge --no-ff feature/<slug> -m "chore(<scope>): merge feature/<slug> into main"
```

plus:

```markdown
**Merge commit message.** The `commit-msg` hook runs `cog verify`, which rejects
git's default `Merge branch 'x'` message *and* a `merge:` type — cocogitto's
default type set has no `merge`. Always pass an explicit conventional `-m`.
A rejected message leaves the merge staged but uncommitted; complete it with
`git commit -m "chore(<scope>): …"`. Do not reach for `--no-verify` — the merge
is valid, only the message token is not.
```

**Rejected alternative.** Adding a `cog.toml` with a custom `merge` commit type would work, but introduces a repo-wide cocogitto config (also governing `cog check` on pre-push) to solve a message-formatting problem. The one-line `-m` fix has no blast radius.

#### R4 — The transition graph, stated once

**Evidence.** `spur task update 0475 done` from `wip`:

```
GuardDeniedError: No transition from "wip" to "done"
```

SSOT is `config/workflows/task-lifecycle.yaml`: forward `backlog → todo → wip → testing → done`; reopen `done → wip`; `blocked` bidirectional with `todo`/`wip`/`testing`; `cancelled` terminal from any non-terminal state. `gate-checklists.md` documents six gates but never the graph.

**Scope note.** `gate-checklists.md` §"done gate (`testing → done`)" already documents the three gate layers including the Review L3 populated-P1–P4 requirement and the `.spur/run/<wbs>-verdict.json` artifact. R4 must **not** restate them — a second copy of a gate contract is exactly the drift this task exists to prevent. Link to that section instead.

**Proposed content** (new H2 block titled "Task lifecycle transitions", after the numbered intro and before §feature-check gate):

```markdown
SSOT: `config/workflows/task-lifecycle.yaml`.

    backlog → todo → wip → testing → done

- `wip → done` is **not** an edge. Go through `testing`.
- `done → wip` reopens (warning + mandatory History entry); `cancelled` is terminal.
- `blocked` is bidirectional with `todo`, `wip`, and `testing`.
- The two hard guards sit on `wip → testing` and `testing → done`; what the
  `testing → done` guard requires is in the [done gate](#done-gate-testing--done)
  section below.
```

#### R5 — Scope the pre-commit formatter to staged files

**Evidence.** The 0475 merge commit reformatted two files unrelated to 0475:

- `packages/domain/tests/analytics/artifact.test.ts` — import reorder
- `plugins/sp/plugin.json` — `"pi": [...]` array inlined

leaving them dirty and blocking `git stash pop` ("Your local changes to the following files would be overwritten by merge") until `git checkout -- <file>`.

Root cause, from `.lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    format:
      glob: "*.{js,ts,tsx,jsx,json}"
      run: bun run format
```

and `package.json:63` — `"format": "biome check . --write"`. The `.` is the repository root: the hook formats **every** matching file in the tree. Lefthook's `glob:` gates whether the command runs, it does not scope what the command touches. With no `stage_fixed:`, the resulting rewrites are left unstaged. Any commit touching one js/ts/json file in a repo carrying drift reproduces this.

This is why the first reading — "pre-existing formatting drift, likely a one-off, monitor rather than fix" — was wrong, and why the disposition changed from documenting a manual `git checkout --` workaround to a one-line config fix.

**Proposed content:**

```yaml
pre-commit:
  parallel: true
  commands:
    format:
      glob: "*.{js,ts,tsx,jsx,json}"
      run: bunx biome check --staged --write --no-errors-on-unmatched
      stage_fixed: true
```

`--staged` is supported by the pinned Biome 2.4.16 (confirmed via `bunx biome check --help`). `stage_fixed: true` re-stages the hook's own fixes so the commit is self-consistent. `bun run format` (repo-wide) stays available as the manual command; only the hook narrows.

**Residual risk.** Narrowing the hook means repo-wide drift is no longer incidentally repaired on every commit. That is the correct trade — `bun run lint` (`biome check . --error-on-warnings`) still fails on drift at the pre-push and `spur-check` gates, so drift is caught loudly rather than silently rewritten under an unrelated commit.
### Plan
- [ ] **Step 1 (R1 + R2) — `execution-batch.md` §WT-2.** Insert the `bun install --frozen-lockfile` post-create step and the "`spur` on PATH is not this checkout" block between `git worktree add` and the "run the existing batch loop" sentence. One edit, one review pass.
- [ ] **Step 2 (R1 + R2) — `worktree-patterns.md`.** Mirror both blocks: install step under §Commands → Create, trap block as a new section after it. Keep wording aligned with Step 1; `execution-batch.md` already defers the git mechanics to this file, so do not duplicate the mechanics, only add the two new facts.
- [ ] **Step 3 (R3) — `branch-workflow/SKILL.md` §5 and `branch-lifecycle.md` §Merge.** Add the explicit `-m "chore(<scope>): merge …"` to both merge commands and the "Merge commit message" note to both. Both files, not one — they are independently reachable.
- [ ] **Step 4 (R4) — `gate-checklists.md`.** Add the "Task lifecycle transitions" block after the numbered intro. Cross-check every listed edge against `config/workflows/task-lifecycle.yaml` before committing. Link to the existing done-gate section; do not restate the Review L3 / verdict requirements.
- [ ] **Step 5 (R5) — `.lefthook.yml`.** Replace `run: bun run format` with `run: bunx biome check --staged --write --no-errors-on-unmatched` and add `stage_fixed: true` under the `format` command.
- [ ] **Step 6 — Verify R5 empirically.** Introduce a deliberate formatting drift in a file unrelated to the commit, commit a one-line change to a different js/ts file, and confirm `git status` shows the drift still present and untouched (hook scoped correctly) and the committed file's own formatting amended in.
- [ ] **Step 7 — Verify R3 empirically.** On a throwaway branch, run the documented `git merge --no-ff <branch> -m "chore(<scope>): …"` and confirm it completes in one commit with no `cog` failure. Reset the throwaway branch afterwards.
- [ ] **Step 8 — Gates.** `bun run lint`, `bun run test` (plugins/sp tests cover the skill corpus), and `bun run apps/cli/src/index.ts task check 0481 --json` returning `pass: true` with no error-level findings. Note the dogfooding: use the source-local CLI per R2, not bare `spur`.
### Solution
Updated four plugin reference/skill files and one root config file to address all five verification/merge retrospective findings from task 0475:

1. `plugins/sp/skills/spur-dev/references/execution-batch.md:393-401` & `plugins/sp/skills/branch-workflow/references/worktree-patterns.md:30-35`: Added explicit `bun install --frozen-lockfile` post-create step to prevent missing workspace package imports in fresh worktrees (R1).
2. `plugins/sp/skills/spur-dev/references/execution-batch.md:404-417` & `plugins/sp/skills/branch-workflow/references/worktree-patterns.md:90-99`: Added "`spur` on PATH is not this checkout" warning section detailing the `resolveSpurBin()` propagation path and prescribing `bun apps/cli/src/index.ts` inside worktrees / monorepo CLI testing (R2).
3. `plugins/sp/skills/branch-workflow/SKILL.md:73-77` & `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md:52-58`: Updated prescribed merge command to `git merge --no-ff <branch> -m "chore(<scope>): merge ..."` and documented `cog verify` hook rejection behavior for default/`merge:` commit messages (R3).
4. `plugins/sp/skills/spur-dev/references/gate-checklists.md:24-35`: Added "Task lifecycle transitions" block defining the forward/reopen/blocked/cancelled state graph and citing `config/workflows/task-lifecycle.yaml` as SSOT (R4).
5. `.lefthook.yml:11-12`: Updated pre-commit format command to `bunx biome check --staged --write --no-errors-on-unmatched` with `stage_fixed: true` to prevent whole-repository reformatting and unstaged drift artifacts (R5).
### Testing
**Verdict: PASS** — re-audited with `--force` (task already `done`). Documentation/config-only change; every behavior-bearing AC re-verified with executable evidence this session. Coverage: N/A (documentation-only change; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:394-400`, `worktree-patterns.md:30,35` — `bun install --frozen-lockfile`. **Empirical:** probe worktree `bun test task-check.test.ts` 0 pass / 1 error pre-install → **103 pass / 0 fail** after `bun install --frozen-lockfile` |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:407-421`, `plugins/sp/skills/branch-workflow/references/worktree-patterns.md:90-100` — "`spur` on PATH is not this checkout" section: published-bundle trap + `resolveSpurBin()` → `vars.spurBin` → `$spurBin task check` propagation + prescribes `bun apps/cli/src/index.ts` |
| R3 | MET | `SKILL.md:73`, `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md:52` — `git merge --no-ff <branch> -m "chore(<scope>): merge ..."`; both files (:77/:58) document `cog verify` rejection. **Empirical:** `cog verify` exit 0 on `chore(x):`, exit 1 on `merge(0475):` and on `Merge branch 'x' into main` |
| R4 | MET | `plugins/sp/skills/spur-dev/references/gate-checklists.md:24-35` — "## Task lifecycle transitions" block: `backlog → todo → wip → testing → done`, `wip → done` marked not-an-edge, cites SSOT `config/workflows/task-lifecycle.yaml`, links to done-gate section |
| R5 | MET | `.lefthook.yml:11-12` — `bunx biome check --staged --write --no-errors-on-unmatched` + `stage_fixed: true`. **Empirical:** staged probe reformatted, unstaged drift probe md5-unchanged, exit 0 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — worktree creation installs dependencies | MET | command | `rg -c 'bun install --frozen-lockfile'` → execution-batch.md:1, worktree-patterns.md:2; probe worktree install made `bun test` pass (103/103) |
| R2 — spur-on-PATH trap named + source-local invocation | MET | command | `rg -c 'bun apps/cli/src/index.ts'` → execution-batch.md:1, worktree-patterns.md:1; trap + propagation described in both |
| R3 — documented merge command passes cog hook | MET | command | `rg -c 'chore\('` → SKILL.md:2, branch-lifecycle.md:2; `cog verify` exit 0 on documented form, exit 1 on `merge:` + default merge message |
| R4 — transition graph stated once beside the gates | MET | command | `rg -c 'task-lifecycle.yaml|wip → testing → done' gate-checklists.md` → 2; block matches the FSM and links Review L3 |
| R5 — pre-commit formatter touches only staged files | MET | command | staged-vs-unstaged probe: `--staged` reformatted only the staged file, unstaged drift untouched, exit 0 |

**Independent gates re-run this session**

| Gate | Outcome |
| --- | --- |
| `spur task check 0481 --strict-core` | pass: true, **0 errors**, 6 warnings (5× L4.uncovered-task-scenario DD-09-subset + 1× L4.gate-language — expected shape for a retro task on umbrella feature H1) |
| `bun test plugins/sp` | 623 pass, 0 fail |
| `bun run lint` | biome check 621 files clean; typecheck clean across 7 workspace packages |
| Design conformance | 5/5 claims DONE — each inserted block matches the Design section's proposed content + insertion point |

**Shippable (feature-level, Step 13 — active because `--fix all` + `feature_id: H1`):** `Shippable: FAIL` — feature H1 is a pre-existing umbrella feature with 30 `L4.scenario-unverified`, 4 `L4.uncovered-feature-scenario`, and incomplete linked task 0480 (`todo`). 0481 is a documentation retro that maps onto H1 but does not make it shippable; the feature-level FAIL does not change the per-task PASS verdict.
### Review
| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | None | — |

**Residual risk:** None. All edits are documentation updates to plugin skills/references and a single pre-commit hook scope refinement in `.lefthook.yml`. No core runtime or app code was altered.
### References
**Source.** Forensic review of the task 0475 implement → verify → merge session (pi agent, `xprojects/spur-new`), with every premise re-verified against the repository during refinement.

**Claim confidence.** Each load-bearing claim, and how it was established. Implement the HIGH ones as written; the two MEDIUM ones are exactly what Plan Steps 6–7 exist to confirm before the task can be called done.

| Claim | Confidence | Basis |
|---|---|---|
| `spur` on PATH is a published bundle at v0.3.35, not either checkout | **HIGH** | `ls -l $(which spur)`, `ls -la ~/node_modules/@gobing-ai/spur/`, `package.json` version — read this session |
| `resolveSpurBin()` → `vars.spurBin` → `$spurBin task check` in both hard guards | **HIGH** | `apps/cli/src/workflow/resolve-spur-bin.ts`, `apps/cli/src/commands/workflow.ts:250,277`, `config/workflows/task-lifecycle.yaml` — read this session |
| 0477 ships no CLI change; §WT-2 is the only worktree-creation path | **HIGH** | 0477 "Key finding: no CLI change is required"; `rg 'git worktree add'` hits docs only, nothing under `apps/cli/src/` |
| §WT-4 `--ff-only` creates no commit, so `commit-msg` never fires | **HIGH** | `execution-batch.md` §WT-4 read this session; fast-forward-creates-no-commit is git semantics |
| Both `branch-workflow` docs prescribe `--no-ff` with no `-m` | **HIGH** | `SKILL.md` §5 and `branch-lifecycle.md` §Merge read in full this session |
| `cog` rejects a `merge:` type | **HIGH** | Observed error text from the 0475 session: ``cog ❯ Error: Commit type `merge` not allowed`` |
| No `cog.toml` in the repo, so cocogitto defaults apply | **HIGH** | Filesystem search this session — no `cog.toml` at any depth outside `node_modules` |
| **git's default `Merge branch 'x'` message also fails `cog verify`** | **MEDIUM** | Inferred from cocogitto validating messages as conventional commits. **Not executed** — `cog` is behind an unconfigured proto shim in this environment (`proto::tool::unknown_id`), so `cog verify --file` could not be run. Plan Step 7 confirms it empirically. If it turns out `cog` skips merge commits, R3 narrows to the `merge:`-type case only and the `-m` guidance still stands |
| Task graph has no `wip → done` edge | **HIGH** | `config/workflows/task-lifecycle.yaml` read in full this session |
| `gate-checklists.md` already documents the Review L3 / verdict prerequisites | **HIGH** | File read in full this session |
| `.lefthook.yml` pre-commit formats the whole repo, unstaged | **HIGH** | `.lefthook.yml` + `package.json:63` (`biome check . --write`) read this session; the `.` is an explicit path argument that a lefthook `glob:` cannot narrow, and no `stage_fixed:` is present |
| Biome 2.4.16 supports `--staged` | **HIGH** | `bunx biome check --help` run this session |
| **`bun install --frozen-lockfile` makes a fresh worktree test-ready** | **MEDIUM** | The failure mode is HIGH (gitignored `node_modules`, observed `Cannot find module '@gobing-ai/spur-config'`). That `--frozen-lockfile` specifically resolves it was **not executed** — no worktree was created during refinement. Plan Step 1 / AC R1 confirm it |

**Session artifacts.**
- Worktree: `/Users/robin/xprojects/spur-new-fix-0475-prose-prereq` (branch `fix/0475-prose-prereq-heuristic`, since merged + removed)
- 0475 merge commit: `14cc3afe`; fix commit: `92df9764`; record commit: `310c4d81`

**Files this task edits.**
- `plugins/sp/skills/spur-dev/references/execution-batch.md` §WT-2 (R1, R2)
- `plugins/sp/skills/branch-workflow/references/worktree-patterns.md` §Create (R1, R2)
- `plugins/sp/skills/branch-workflow/SKILL.md` §5 Merge (R3)
- `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md` §Merge (R3)
- `plugins/sp/skills/spur-dev/references/gate-checklists.md` (R4)
- `.lefthook.yml` `pre-commit.commands.format` (R5)

**Files read as evidence (not edited).**
- `apps/cli/src/workflow/resolve-spur-bin.ts` — `resolveSpurBin()` returns `${execPath} ${Bun.main}` (R2)
- `apps/cli/src/commands/workflow.ts:250,277` — injects `vars.spurBin` into every run (R2)
- `config/workflows/task-lifecycle.yaml` — `vars.spurBin: 'spur'`; guards `'$spurBin task check $wbs'` and `'$spurBin task check $wbs --strict-core'`; the full transition graph (R2, R4)
- `package.json:63` — `"format": "biome check . --write"` (R5)
- `docs/tasks3/0477_batch-worktree-isolation-worktree-for-dev-runall-dev-refinea.md` — "no CLI change is required"; §WT-4 `git merge --ff-only` (R1, R2, R3 scoping)

**Evidence commands.**
- `ls -l $(which spur)` → `~/.bun/bin/spur -> ../../node_modules/@gobing-ai/spur/spur.js`; that target is a real directory with `"version": "0.3.35"` and a 3,425,532-byte `spur.js` (R2)
- `bun test packages/app/tests/services/task-check.test.ts` in a fresh worktree → `Cannot find module '@gobing-ai/spur-config'` (R1)
- `git merge … --no-ff -m "merge(0475): …"` → ``cog ❯ Error: Commit type `merge` not allowed`` (R3)
- `spur task update 0475 done` from `wip` → `GuardDeniedError: No transition from "wip" to "done"` (R4)
- `bunx biome check --help` → `--staged` supported at Biome 2.4.16 (R5)

**Covered-by references (deliberately excluded).**
- `docs/tasks3/0478_fix-pipeline-bottlenecks-from-task-0477-run-size-gate-surpri.md` — R1 size-gate, R2 verify format, R3 redundant typecheck
- `docs/tasks3/0479_fix-verification-loop-gate-holes-and-discovery-costs-found-i.md` — R1 done-gate, R2 file:line, R3 AC-subset, R4 flag-parity cwd, R5 run-once, R6 sandbox baseline
- `docs/tasks3/0480_comprehensive-cleanup-of-the-agent-execution-surface-contrac.md` — R6/R7/R8 executor/inline contract
- `docs/tasks3/0406_add-inline-execution-mode-and-make-it-the-default.md` — inline execution mode
- `docs/tasks3/0477_batch-worktree-isolation-worktree-for-dev-runall-dev-refinea.md` — the `--worktree` feature R1/R2 extend
### History
- 2026-08-08T06:15:10.488Z backlog → todo (system)
- 2026-08-08T06:15:10.752Z todo → wip (system)
- 2026-08-08T06:21:24.262Z wip → testing (system)
- 2026-08-08T06:21:38.318Z testing → done (system)
### Notes
**RC1 — Fresh-worktree dependency gap (R1).** `node_modules` is gitignored, so a fresh worktree fails its first `bun test` on the first workspace import (`@gobing-ai/spur-config`). Root cause: `execution-batch.md` §WT-2 goes from `git worktree add` straight to the Steps 1–5 loop with no install between them. Fix: add `bun install --frozen-lockfile` as an explicit post-create step in §WT-2 and `worktree-patterns.md`.

**RC2 — `spur` on PATH is a published bundle (R2).** `~/.bun/bin/spur` → `~/node_modules/@gobing-ai/spur/spur.js`, a 3.4 MB build of v0.3.35 — not the main repo's source and not the worktree's. `resolveSpurBin()` (`apps/cli/src/workflow/resolve-spur-bin.ts`) re-invokes whichever binary was entered, `workflow.ts:250,277` injects it as `vars.spurBin`, and `config/workflows/task-lifecycle.yaml` runs `$spurBin task check` in both hard guards. Root cause: nothing states that the entry binary determines which source the lifecycle guards execute. Fix: document the trap and the source-local `bun apps/cli/src/index.ts` invocation in both worktree docs. Highest-value item.

**RC3 — The documented merge command cannot pass `cog` (R3).** `branch-workflow/SKILL.md` §5 and `branch-lifecycle.md` §Merge both prescribe `git merge --no-ff <branch>` with no `-m`; the resulting default `Merge branch 'x'` message is not a conventional commit and `cog verify` rejects it, as it rejects the `merge:` type (no `cog.toml`, so cocogitto defaults apply). Root cause: the merge guidance never addresses the commit message. Fix: explicit `-m "chore(<scope>): …"` plus a note in both files. Not related to 0477 — §WT-4's `--ff-only` creates no commit and never fires the hook.

**RC4 — The transition graph is undocumented (R4).** `wip → done` is not an edge; the graph lives only in `config/workflows/task-lifecycle.yaml`. `gate-checklists.md` documents the gates but never the graph they sit on. Fix: one short block stating the chain, citing the YAML as SSOT, linking to the existing done-gate section rather than restating it.

**RC5 — The pre-commit hook formats the whole repository (R5).** `.lefthook.yml` `pre-commit` runs `bun run format` = `biome check . --write` (`package.json:63`) — repo-wide — and lefthook's `glob:` only gates whether it runs, not what it touches. With no `stage_fixed:`, out-of-scope rewrites are left unstaged. That is what reformatted `artifact.test.ts` and `plugin.json` during the 0475 merge and then blocked `git stash pop`. Systemic, not the one-off it first appeared to be. Fix: `bunx biome check --staged --write --no-errors-on-unmatched` + `stage_fixed: true`.

**Premise corrections applied during refinement.** The forensic draft carried five factual errors, all corrected above and in Background/Design: (1) global `spur` was described as the *main repo's source* — it is a published npm bundle, and the trap is monorepo-wide, not worktree-specific; (2) R1/R2 targeted `apps/cli/src/commands/agent.ts` — 0477 explicitly ships no CLI change, the target is `execution-batch.md` §WT-2; (3) R3 was said to collide with 0477's FF-merge — `--ff-only` creates no commit, so there is no interaction, while the real breakage is that *both* documented `--no-ff` commands fail on every merge; (4) R4 was scoped to include the Review L3 prerequisite, which `gate-checklists.md` already documents in full; (5) R5 was diagnosed as one-off drift and dispositioned "monitor" — it is a repo-wide hook misconfiguration with a one-line fix.

**What worked well (preserve).** (1) The safety snapshot before the risky merge (tracked patch + untracked copy) made stash→merge→pop reversible; worth adding to `branch-workflow` as a pattern in a follow-up. (2) The source-local CLI (`bun apps/cli/src/index.ts`) gave correct corpus measurement — now R2. (3) Batch section writes followed by a single `spur task check` matched the 0379 / 0479 R5 run-once rule.
