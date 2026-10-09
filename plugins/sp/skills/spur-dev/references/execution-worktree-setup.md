---
name: execution-worktree-setup
description: "Worktree batch start (task 1128 split): --worktree creation or adoption — WT-1 dirty-tree precheck, WT-2 create/reuse/evidence-staging/name resolution, WT-3 crash-safe marker and WT-3b the batch commit on the branch. Read it with --worktree at batch start; landing stays in execution-worktree-landing.md."
see_also:
  - execution-batch
  - execution-workflow
---

# Worktree setup (WT-1…WT-3b)

Read with `--worktree` at batch start (task 1128 R1).

## Worktree isolation (`--worktree [<name>]`)

When a batch command (`dev-runall`, `dev-refineall`, `dev-verifyall`) is invoked with
[`--worktree [<name>]`](flag-glossary.md#flag-worktree), the entire driver loop runs inside an
isolated git worktree instead of the operator's working directory. This section owns the worktree
lifecycle for the sequential batch loop. `--mode parallel` has its own per-task isolation — see
[§ Parallel isolation](execution-parallel-isolation.md#parallel-isolation---mode-parallel); `--worktree --mode parallel` is
rejected there (parallel mode already isolates each task in its own worktree).

**Startup ordering (task 0814 R3).** Resolve the selector/status filter and run the quick
command-aware readiness (the `quickReadiness` contract in `batch-preflight.ts`) **before** creating
or adopting the tree. The admission decision is what determines whether a tree should be cut at all;
all subsequent tools, agents, task/feature writes, and run artifacts use the confirmed execution
tree's cwd. A stale or empty selector, an unsupported mode, or an invalid target creates no tree and
no marker (WT-2/WT-7), and the required Git safety checks (WT-1) still precede creation.

> **Command wiring (task 0814 R3).** The four task-set worktree commands (`dev-run`, `dev-runall`,
> `dev-refineall`, `dev-verifyall`) each call `quickReadiness` with their operation (`run`/`refine`/
> `verify`), the resolved selector/status, and the filtered-set size **before** WT-1/WT-2. The
> admission outcome gates the tree: an invalid/empty selector, unsupported mode, or a target that
> quickReadiness marks `blocked`/`invalid` creates no tree and no marker (WT-2/WT-7); a
> `needs-refinement` refine batch is still work to do (the tree is created, the gaps are the work).
> The required Git safety checks (WT-1) still precede creation, and ownership/identity is confirmed
> before any tool, agent, corpus write, or run artifact. A later failure retains the tree with
> recovery information (WT-5).

**Single-task `dev-run` (batch of one).** `/sp:dev-run <wbs> --worktree [<name>]` runs this same
lifecycle with a one-task loop: WT-1…WT-6 apply unchanged, the marker's `command` is `dev-run` and
its `selector` is the `<wbs>` (so WT-6's command+selector fallback resolves the resume), and the
derived branch/directory slug is the WBS — `sp/run-<wbs>-<short-id>`. The WT-4 success condition
"no failed task" reads as "the task reached terminal `done` with no failed stage"; a failing gate, a
non-PASS verify verdict, or a HITL pause that ends the run take the WT-5 retention path. Only the
full pipeline is eligible — `--worktree --mode implement` is rejected (WT-7), because that mode is
the pipeline's implement stage and already runs in the driver's tree.

**Review triage `dev-review` (run of one).** `/sp:dev-review [--tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>]] --triage --worktree [<name>]`
runs this lifecycle around one review-plus-triage pass: WT-1…WT-6 apply unchanged, the marker's
`command` is `dev-review` and its `selector` records the full normalized target list, and the slug
is `sp/review-<first>-and-<N>-<short-id>` for a multi-target run (N = target count) or
`sp/review-<slug>-<short-id>` for a single target (the WBS or the path's basename). It skips
`quickReadiness` (there is no task set; admission is "every target resolves" — each WBS/path must
resolve before the tree is cut). Under `--triage` the findings are bucketed across all targets once
(identical `file:line` findings deduped). WT-4 success reads as "every direct fix passed its check and the
project gate is green"; anything else takes WT-5. Contract: [dev-operations.md § 2. review](dev-operations.md#2-review).

**Wayfinding `dev-find-way` (run of one, mandatory).** `/sp:dev-find-way` always runs this
lifecycle — an omitted flag is create mode, never in-place. Marker `command` is `dev-find-way`,
`selector` is `chart:<destination-slug>` or `<feature-id>:<wbs>`, branch is
`sp/wayfind-<slug|wbs>-<short-id>`. It skips `quickReadiness` (admission is "the feature/ticket
resolves and no other `dev-find-way` marker holds the ticket"). WT-4 success reads as "the map
checks clean (chart) or the one ticket reached `done` (work)"; anything else takes WT-5. Contract:
[dev-operations.md § 12a. find-way](dev-operations.md#12a-find-way).

One flag, two modes (see the glossary entry for the ownership rule). Bare `--worktree` is **create
mode** (cut a fresh branch + sibling tree). `--worktree <name>` is **reuse mode** (attach to a tree
that already exists); name resolution (§ WT-2 below) runs before WT-1. The deltas each mode applies
are stated inline in WT-1…WT-4. `--continue` re-entry (WT-6) resolves by explicit name first, then
falls back to the command+selector marker scan.

The lifecycle wraps Steps 1–5 unchanged: a precheck creates or adopts the worktree before selector
resolution runs, the loop executes with the worktree as process cwd, and a terminal action merges or
retains after the batch report is emitted. Steps 1–5 themselves are not modified — only their cwd
differs.

**Per-call tree pinning (task 1058).** A host shell call starts in an arbitrary directory and
inherits no cwd from the previous call, so "the loop runs with the worktree as process cwd" is a
bootstrap convenience, never a carried guarantee. Every host command boundary in this lifecycle —
corpus reads/writes, the WT-3b commit, WT-4's merge and evidence persistence, the WT-4a
persist-out — re-selects its intended tree within the same call via the canonical per-call pin
protocol ([inline-pipeline-driver.md](inline-pipeline-driver.md) § "Per-call execution-tree
pin"): `cd --` to the quoted absolute tree, verify `pwd -P` against the recorded physical tree,
verify Git top-level and expected branch, then execute the already-resolved Spur invocation. The
identity is consumed, not re-derived: it is the WT-3 marker's confirmed `path` + `branch` (or the
resolved worktree's physical path + checked-out branch in reuse mode). The one deliberate tree
change is WT-4: the terminal merge actions select the **invoking** tree, not the execution tree —
and pin it explicitly the same way. FF ancestry, marker and cleanup sequencing remain owned by
1059.

**Portability (R10).** Use portable `git worktree` commands only. Do **not** depend on the Claude
Code `EnterWorktree`/`ExitWorktree` tools — the `sp` plugin ships to Codex, Gemini CLI, pi, omp, and
OpenCode. The underlying git mechanics (create / list / remove / prune, sibling-directory naming,
disk-space awareness) are reused from [worktree-patterns.md](../../branch-workflow/references/worktree-patterns.md);
this section does not re-author them.

### WT-1 — Dirty-tree precheck (R3)

`git worktree add` branches from a ref, so uncommitted changes in the main tree do **not** carry
into the worktree — a batch would silently run against different tree state than the operator sees.
Before creating the worktree, check the main tree:

```bash
git status --porcelain
```

- **Clean tree** → proceed to WT-2.
- **Dirty tree** → **abort** before any worktree is created. Name the offending files (from
  `git status --porcelain`) and instruct the operator to commit or stash. No task work has run.
- **`--force`** → proceed past a dirty tree with a divergence warning that names the uncommitted
  files. The worktree is created and the batch proceeds against the committed base ref, not the
  operator's working-directory state.

**Reuse-mode delta.** The main-tree precheck is unchanged — the divergence hazard is identical (the
batch still runs somewhere the operator is not standing). The *target* worktree being dirty is
**expected** (it holds retained partial work from a prior halt) and must **not** abort: report the
file list once and proceed. The batch runs against the target worktree's working-directory state, not
a clean checkout — which is exactly the point of reuse mode.

### WT-2 — Worktree creation or adoption

**Name resolution runs first** for both modes — bare `--worktree` skips it (no name to resolve);
`--worktree <name>` must resolve before WT-1's precheck touches anything. Resolution is specified
in [§ Name resolution](#name-resolution---worktree-name) below; this section covers creation
(create mode) and adoption (reuse mode).

#### Create mode (bare `--worktree`)

Create one worktree on a new branch cut from the current HEAD's ref (the **base ref** — often a
`feat/…` branch, not literally `main`). Location follows the sibling-directory convention in
[worktree-patterns.md](../../branch-workflow/references/worktree-patterns.md):

**Location rule (0948 R9) — never under `.spur/`.** The default root is the **sibling** directory
(`../<repo>-<command>-<selector-slug>-<short-id>`). A worktree nested under `.spur/` breaks Biome's
vcs-root detection: `bunx biome check .` inside it reports `Checked 0 files`, so lint/format silently
no-op for the whole run. Verified in both directions — a sibling worktree reports a non-zero file
count (`Checked 1076 files` at the time of the fix) while a `.spur/`-nested one reports
`Checked 0 files`. If a project's tooling needs a custom root, keep it **outside** any path that a
VCS-root-detecting tool treats as ignorable.

```bash
BASE_REF=$(git rev-parse --abbrev-ref HEAD)
BASE_SHA=$(git rev-parse HEAD)
BRANCH="sp/<command>-<selector-slug>-<short-id>"     # e.g. sp/runall-h1-a3f2
# `git worktree add -b` creates the branch BEFORE the directory, so a failed create leaves a
# dangling branch and the natural retry dies on "a branch named ... already exists"
# (task 0701 R2b). Wrap the create: on failure, delete the branch — or derive a fresh
# short-id per attempt — before surfacing the error.
git worktree add "../<repo>-<command>-<selector-slug>-<short-id>" -b "$BRANCH" "$BASE_REF" \
  || { git branch -D "$BRANCH"; false; }
# WT-2r — register the worktree in ~/.config/spur/projects.json so the Board project switcher
# lists it; WT-4c deregisters it. Best-effort: a registry failure never blocks the run.
spur projects add "../<repo>-<command>-<selector-slug>-<short-id>" --json >/dev/null 2>&1 || true
```

Reuse mode does not re-register: `projects add` rewrites `port` to `0`, which would clobber the
port of a live serve in an adopted tree. A served tree is already registered by `spur serve`.

**Worktree root is outside `.spur/` (0948 R9).** The default create path is that
sibling directory, which sits next to the repository and not under it. Do not
put the default root at `.spur/worktrees` or any other gitignored path: Biome's
`vcs.useIgnoreFile` then treats the checkout as empty ("Checked 0 files") and
the quality gate cannot see the tree. Same class as the eval-pipeline worktree
move off `.spur/tmp/` (task 0610).

Branch and directory names are derived (command + selector slug + short id); the create path never
takes an operator-supplied name (R8.3 — no create-with-name; `--worktree <name>` where `<name>` does
not resolve is an error, not a create).

A fresh worktree has no `node_modules` (gitignored), so the first `bun test` or
typecheck fails on the first workspace import. Install before any task work:

    cd "../<worktree-dir>" && bun install --frozen-lockfile --ignore-scripts

`--frozen-lockfile` pins the worktree to `bun.lock` rather than re-resolving,
so the worktree's dependency tree matches the base ref's. `--ignore-scripts` is required, not
stylistic (task 0701 R2a): worktrees share the main tree's `.git`, and this repo's `prepare`
script is `lefthook install` (`package.json`) — a bare install rewrites the operator's
main-repo hooks from inside the "isolated" tree. Scripts are skipped only at this call site;
a normal clone keeps `prepare`. The worktree still gets a usable dependency tree — the install
exists so the first `bun test` resolves workspace imports.

#### Reuse mode (`--worktree <name>`)

Creation is **skipped entirely**. `$BRANCH` is the resolved worktree's already-checked-out branch; a
detached HEAD aborts (no branch can serve as `$BRANCH` for WT-4's FF-merge). `BASE_REF` is the
invoking tree's current HEAD ref (not the worktree's branch) and `BASE_SHA` is
`git merge-base <BASE_REF> <BRANCH>` — so WT-4's FF-merge lands the worktree's accumulated commits
onto the invoking tree's base ref, exactly as create mode does.

`bun install --frozen-lockfile --ignore-scripts` runs **only when `node_modules` is absent** in
the resolved worktree (same `--ignore-scripts` rationale as create mode — task 0701 R2a). A warm reused tree does not re-pay the install; a cold one (hand-made, or a retained tree
whose deps were removed) installs exactly once before the first task. This is the R3 conditional
install rule (source: task 0481) — create mode always installs because a fresh tree is always cold.

After creation or adoption, immediately write/adopt the state marker (WT-3), then run the
existing batch loop (Steps 1–5) with the worktree as process cwd. `spur workflow run` resolves cwd
from the process (`apps/cli/src/commands/workflow.ts:124`), so no CLI change is needed — `cd` into
the worktree directory before launching the loop.

#### Evidence staging before the first task (create and reuse mode)

`.spur/memory/evidence/` and `.spur/run/` are **untracked per-tree** planes, so a fresh worktree
starts with neither while the invoking tree holds every earlier task's verdict. Both
`preflightFeature` (`plugins/sp/scripts/wrapup-steps.ts` → `spur feature check --strict --as done`
with cwd = the worktree) and `runMetrics` resolve verdict artifacts relative to the tree they run
in, so without this step an already-`done` linked task reads as missing evidence
(`L4.evidence-not-recoverable`, `L4.scenario-unverified`) and its metrics row degrades to
`UNKNOWN`.

Stage the invoking tree's verdict artifacts into the worktree **before the first task runs** —
from the invoking tree (cwd), with `$WT` the resolved absolute worktree path. `cp -n` is
load-bearing: reuse mode may be re-entering a tree that already owns divergence-checked evidence,
and this step must never clobber it. Only `*-verdict.json` travels in each direction; receipts and
other scratch artifacts are not staged, so WT-4a's identity classification is unaffected.

```bash
# Run from the INVOKING tree; $WT is the worktree (create- or reuse-mode) absolute path.
for d in .spur/memory/evidence .spur/run; do
  mkdir -p "$WT/$d"
  for f in "$d"/*-verdict.json; do [ -f "$f" ] && cp -n "$f" "$WT/$d/"; done
done
```

The position relative to the dependency install is immaterial (this is a plain copy into an
untracked plane); the position relative to the **first task** is not — a preflight or metrics read
that runs before this step sees an empty evidence plane.

#### Name resolution (`--worktree <name>`)

<a id="name-resolution---worktree-name"></a>

Authority: **git**, not the marker store — a marker may be stale, git is not. A foreign worktree
with no marker is a valid target (R3 synthesizes one). Resolve `<name>` against
`git worktree list --porcelain`, matching in this order and stopping at the first tier that yields
≥1 hit:

1. **exact `worktree <path>`** (after path normalization against the invoking tree)
2. **`basename(<path>)`**
3. **checked-out branch** — accept both `<name>` and the full `refs/heads/<name>` form

Then require exactly one survivor across the tiers:

- **0 hits** → abort before any task work. Print each candidate worktree as
  `<basename>  <branch>  <path>`, and the line: *"`--worktree <name>` selects an existing worktree;
  it never creates one. Use bare `--worktree` to create."*
- **≥2 hits** → abort naming the candidates and require the path form (tier 1).
- **1 hit, but** the worktree is `locked`, `prunable`, or belongs to a different repo → abort naming
  the condition.

### `spur` on PATH is not this checkout

`spur` (`~/.bun/bin/spur`) resolves to a *published* bundle in `~/node_modules/`,
not to the repo you are standing in and not to the worktree. `resolveSpurBin()`
propagates whichever binary you entered through into `vars.spurBin`, which the
`task-lifecycle.yaml` guards run as `$spurBin task check` — so one wrong entry
point silently gate-checks against the published bundle.

Inside a worktree, and in the monorepo whenever CLI behavior is under test, invoke
the tree's own source:

    cd "<worktree>" && bun apps/cli/src/index.ts task check <wbs> --json

Run that as a per-call pin subshell (task 1058) — `cd --` plus the `pwd -P` / git-top-level /
branch identity checks of the canonical protocol (inline-pipeline-driver.md § "Per-call
execution-tree pin") — rather than relying on a persistent `cd` between host tool calls.

Confirm isolation by making a distinctive change in the worktree and checking that
the command reflects it.

**General rule — every path-resolving tool, not just `spur`.** The same failure class is not
limited to the CLI on PATH. A host-agent file-edit or hash/`hashline` tool may resolve main-repo
paths while the shell `cwd` is the worktree, silently acting on the wrong tree. Before relying on any
path-resolving tool inside a `--worktree` batch, verify it is acting on the worktree — for example
by making a distinctive change and confirming the path the tool reports matches the worktree. When a
tool cannot be pointed at the worktree, fall back to `perl -i` in-place edits (or the agent's `write`
verb) whose path argument you control.

### WT-3 — Crash-safe state marker (R6)

Worktree identity lives on disk under `.spur/run/`, not only in the orchestrator's memory, so a
session that dies mid-batch is recoverable. Write the marker at creation and update it at the
terminal transition (merged / retained). The marker is written to the **invoking** tree's
`.spur/run/` (task 0701 R2c) — the tree where the driver process started, not the worktree's own
`.spur/run/` — so WT-6's resume scan finds it regardless of where the operator stands. Schema:

```json
{
  "id": "<marker-id>",
  "path": "../<repo>-<command>-<selector-slug>-<short-id>",
  "branch": "sp/<command>-<selector-slug>-<short-id>",
  "baseRef": "feat/example",
  "baseSha": "<sha-at-creation>",
  "command": "dev-runall",
  "selector": "feature:H1",
  "createdAt": "<iso-8601>",
  "status": "active"
}
```

`status` transitions: `active` → `merged` (WT-4 success) | `retained` (WT-5 failure/halt/non-FF),
and `retained` → `active` on a reuse re-entry (WT-6). The marker file is named
`.spur/run/worktree-<marker-id>.json`. It is the authority for WT-6 resume and for operator recovery
after a crash: a killed session leaves the marker at `status: active`, which the operator reads to
find the worktree path, branch, and base ref.

**Reuse-mode marker adoption.** Two new optional fields record when a run did not create the tree:

```json
{
  "adopted": true,
  "adoptedAt": "<iso-8601>"
}
```

`adopted` is what WT-4 reads to decide retain-vs-remove, so it is set whenever the current run did
not create the tree — including when reuse mode adopts a marker that create mode originally wrote.
It records "this run did not create this tree", not "this tree was never created by the flag".

Reuse mode resolves the marker by the resolved worktree's `path` (not by `command`+`selector`):

- **Existing marker for that path** → adopt it in place: update `command`/`selector` to the current
  invocation, set `status` to `active`, set `adopted: true` + `adoptedAt`, **preserve `baseRef` and
  `baseSha`**. This makes cross-command resume — `dev-runall` halted, now `dev-verifyall` over the
  same tree — a supported path (R5.2).
- **No marker** (hand-made or foreign worktree) → synthesize one with `baseRef` = the invoking
  tree's current HEAD ref, `baseSha` = `git merge-base <baseRef> <BRANCH>`, `adopted: true`.
- **Marker already at `status: active`** → **abort** — another session may own that tree
  (AGENTS.md one-writer-per-tree; task 0487 R5). Overridable with `--force` (the operator can tell
  a crashed-session marker from a live-session one; the harness cannot).

**Commit fingerprint (1129 R1).** As soon as the run's identity exists — before the first task
writes — fingerprint **the tree that will be committed** under the batch's run id (`$RUN_ID`: the
WT-3 marker's `id`, i.e. `<command>-<selector-slug>-<short-id>`), so the WT-3b/integration commit
has a start point to compare against. The artifact is cwd-relative under `.spur/run/` (gitignored
per tree), so the fingerprint and the commit that consumes it must select the SAME tree: in create
and reuse mode that is the worktree, because WT-3b commits there; a batch without `--worktree`
fingerprints the invoking tree, which is also where its commit lands. The conflict recipe
fingerprints the invoking tree for the same reason (its own step 1b).

```bash
GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)"
# Pinned subshell, same discipline as WT-3b: select the execution tree for this one call.
(
  cd -- "../<worktree-dir>" || { echo "tree missing: expected ../<worktree-dir>" >&2; exit 1; }
  [ "$(git branch --show-current)" = "$BRANCH" ] \
    || { echo "branch mismatch: expected $BRANCH, got $(git branch --show-current)" >&2; exit 1; }
  RUN_ID="<marker-id>"   # the WT-3 marker's id — the same id WT-3b's stage call uses
  bun "$GUARD" start --run "$RUN_ID"   # <worktree>/.spur/run/$RUN_ID-tree-start.json = { head, dirty[] }
)
```

### WT-3b — Commit the batch's writes on `$BRANCH` (task 0701 R1)
Before any terminal action, commit the batch's corpus writes **on `$BRANCH`, inside the
worktree** — including the generated task files under `docs/tasks*/` and the kanban index. The
commit runs as a per-call pinned subshell (task 1058): it selects the execution tree inside the
same call, verifies the WT-3 identity, and never relies on a persistent `cd` or a trailing
`cd -` to restore the caller's directory:

```bash
(
  cd -- "../<worktree-dir>" || { echo "tree missing: expected ../<worktree-dir>" >&2; exit 1; }
  [ "$(git branch --show-current)" = "$BRANCH" ] \
    || { echo "branch mismatch: expected $BRANCH, got $(git branch --show-current)" >&2; exit 1; }
  GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)"
  bun "$GUARD" check --run "$RUN_ID"        # 1129 R3: concurrent foreign writers; a non-empty list goes in the batch report
  bun "$GUARD" stage --run "$RUN_ID" -- <files-the-batch-wrote> \
    || { echo "WT-3b halt: commit-guard refused a path (foreign, unmerged or conflict-marked); nothing committed" >&2; exit 1; }
  git commit -m "<type>(<scope>): <command> <selector> batch writes"
)
```

> **Forbidden in every driver commit step:** `git add -A` and `git add .`. They stage whatever a
> concurrent writer happened to leave in the tree — the two incidents this guard exists for are
> `a94f9f431` and `36f274590` — so a driver stages only through `commit-guard stage`.

The FF-only git merge carries only commits — uncommitted writes in the worktree would be left
behind by the merge and then destroyed by create mode's `git worktree remove`. WT-3b exists so
that can never happen.
