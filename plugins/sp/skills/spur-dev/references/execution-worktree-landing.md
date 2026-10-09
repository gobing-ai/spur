---
name: execution-worktree-landing
description: "Worktree batch end (task 1128 split): WT-4 success (merge, remove, delete or retain), WT-5 failure retention, the retained-worktree report template and the conflict-merge recipe. Read it at batch end; setup stays in execution-worktree-setup.md."
see_also:
  - execution-batch
  - execution-workflow
---

# Worktree landing (WT-4/WT-5)

Read at batch end (task 1128 R1).

### WT-4 — Success path (R4)

When the batch completes with **no failed task**, fast-forward-merge the worktree branch onto the
base ref. The terminal action after the merge differs by mode (ownership rule: *the flag removes
only what it created*):

#### Create mode — merge, remove, delete

```bash
# Run these from the main tree (not inside the worktree) - you merge the worktree branch
# back onto the base ref there. Per-call tree pinning (task 1058, § above): every command
# below selects the INVOKING tree (where the WT-3 marker lives), re-pinned with the canonical
# per-call pin protocol in its own subshell — never the execution tree. The whole sequence is
# fail-stop: checkout, guard, ancestry check, merge, landed verify, persistence, and cleanup
# each stop explicitly. Every tip/ancestry read uses local refs — no fetch runs anywhere:
MARKER=".spur/run/worktree-<marker-id>.json"
git checkout "$BASE_REF" \
  || { echo "WT-4 halt: checkout $BASE_REF failed - nothing merged, marker stays \"active\"" >&2; exit 1; }   # -> WT-5
# Guard (task 0701 R1): a zero-commit branch makes the FF-only git merge exit 0
# ("Already up to date") while merging nothing — the lines below would then delete
# the worktree holding the only copy of the batch's writes. Refuse instead:
[ "$(git rev-list --count "$BASE_REF..$BRANCH")" -gt 0 ] \
  || { echo "WT-4 halt: branch carries no commits - nothing to merge" >&2; exit 1; }   # -> WT-5, marker stays "active"
# Capture the batch tip BEFORE any cleanup or branch work: every later step (landed verify,
# mergeCommit, retained report) reads this captured value — a removed branch is never queried.
BATCH_TIP="$(git rev-parse "$BRANCH")" \
  || { echo "WT-4 halt: cannot read $BRANCH" >&2; exit 1; }
# Fresh LOCAL base tip, re-read now; the marker's baseSha may be stale and never governs this
# decision (an advanced-but-ancestor base still FF-merges, a divergent base halts):
BASE_TIP="$(git rev-parse "$BASE_REF")" \
  || { echo "WT-4 halt: cannot read $BASE_REF" >&2; exit 1; }
# Ancestry check immediately before the sole mutation (the FF merge below). Command/read
# errors are distinguished from ordinary non-ancestry; both fail closed:
ANCESTRY_RC=0
git merge-base --is-ancestor "$BASE_TIP" "$BATCH_TIP" || ANCESTRY_RC=$?
[ "$ANCESTRY_RC" -gt 1 ] \
  && { echo "WT-4 halt: ancestry check could not run (git exit $ANCESTRY_RC) - failing closed" >&2; exit 1; }
[ "$ANCESTRY_RC" -eq 1 ] && {
  echo "WT-4 halt: divergent - batch tip $BATCH_TIP vs base tip $BASE_TIP" >&2
  git log --oneline "$BASE_TIP..$BATCH_TIP" >&2   # batch-side divergent commits
  git log --oneline "$BATCH_TIP..$BASE_TIP" >&2   # base-side divergent commits
  exit 1; }   # -> WT-5: tree + branch retained, marker stays "active"
git merge --ff-only "$BRANCH"          # FF-only: never rebase, merge-commit, or resolve conflicts
[ $? -eq 0 ] \
  || { echo "WT-4 halt: FF-merge failed - the concurrent-writer race survives every precheck; marker stays \"active\"" >&2; exit 1; }   # -> WT-5
# Landed verification before anything else runs: the captured BATCH_TIP must be an ancestor of
# the base ref as it now stands (base tips advancing again later stay valid — this binds the
# merge result, not the end state):
LANDED_BASE_TIP="$(git rev-parse "$BASE_REF")" \
  || { echo "WT-4 halt: cannot read landed base tip" >&2; exit 1; }
git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP" \
  || { echo "WT-4 halt: landed verify failed - $BATCH_TIP is not an ancestor of $LANDED_BASE_TIP" >&2; exit 1; }
# --- Landed from here on. Any halt below is landed-but-incomplete: it records status
# --- "retained" + mergeCommit "$BATCH_TIP" via write_marker and stops — never a branch query.
write_marker () {   # $1 = merged | retained; read-modify-write: preserve WT-3 fields (id, command, selector, createdAt, adopted, adoptedAt); jq already assumed by WT-3/task-resolution flows
  mkdir -p "$(dirname "$MARKER")"
  if [ -f "$MARKER" ]; then
    TMP_MARKER="$(mktemp)"
    jq --arg s "$1" --arg m "$BATCH_TIP" '.status = $s | .mergeCommit = $m' "$MARKER" > "$TMP_MARKER" \
      || { echo "WT-4 halt: cannot rewrite marker $MARKER" >&2; rm -f "$TMP_MARKER"; exit 1; }
    mv "$TMP_MARKER" "$MARKER"
  else
    printf '{ "baseRef": "%s", "baseSha": "%s", "branch": "%s", "path": "%s", "status": "%s", "mergeCommit": "%s" }\n' \
      "$BASE_REF" "$BASE_SHA" "$BRANCH" "$WT_PATH" "$1" "$BATCH_TIP" > "$MARKER"
  fi
}
# WT-4a evidence persistence runs FIRST after the landed verify (Step 5, task 0720 R3):
# persist the batch report + verdict artifacts AND the per-run provenance (task
# 0975 R1) into the invoking tree before anything below touches the worktree.
# Any persistence failure routes to WT-5 — landed-but-incomplete: retained marker + mergeCommit.
WT_PATH="$(cd "../<worktree-dir>" && pwd)"   # hoisted: needed by WT-4a AND WT-4b below
# WT-4a provenance persist-out (task 0975 R1): copy the worktree DB's run rows plus
# the .spur/memory/runs/<runId>.md + .state.json records into THIS tree. Run from the main
# tree (cwd = the invoking tree). --task-file (0984 R2) forwards each merged task
# file (post-merge path) so the cited .spur/run/<file> evidence is copied/verified
# too. Resolve the merged path(s) BEFORE this block — an empty value exits 2:
#   TASK_FILE="$(spur task show <wbs> --json | jq -r .filePath)"   # per done task;
#   build TASK_FILE_ARGS=(--task-file "$TASK_FILE")                # one flag each
# Idempotent; conflicts are reported, never overwritten. A non-zero exit —
# including an unresolved or divergent citation, or a half-readable worktree — must
# NOT proceed to WT-4b removal:
SETUP_SCRIPT=plugins/sp/scripts/inline-run-setup.ts; [ -f config/plugin-scripts.json -a -f "$SETUP_SCRIPT" ] || SETUP_SCRIPT="$(superskill script path sp inline-run-setup.mjs 2>/dev/null)"
bun "$SETUP_SCRIPT" --persist-out --from "$WT_PATH" "${TASK_FILE_ARGS[@]}" \
  || { echo "halt: worktree run-record persist-out failed - worktree retained (WT-5)" >&2; write_marker retained; exit 1; }
#
# WT-4b — bounded CWD-holder cleanup (task 0720 R1). $WT_PATH above is the EXACT
# absolute worktree path; a relative path or a stale entry matches the wrong processes.
# Holders = processes with any open fd under the worktree tree (lsof +D walks the
# tree; CWD holders are the common case but +D also catches open-file holders —
# over-match errs toward removal success; a plain -t <dir> matches only the
# directory itself). Orphaned `serve` proof daemons (PPID 1) are exactly this
# class: they defeat `git worktree remove` (ENOTEMPTY), defeat rm -rf, while
# `git worktree prune` still deregisters the tree. Note +D is a full-tree walk,
# so the wait loop below bounds ITERATIONS (6 × 1s ticks + walk cost), not
# wall-clock.
HOLDERS="$(lsof -t +D "$WT_PATH" 2>/dev/null | sort -u)"
if [ -n "$HOLDERS" ]; then
  kill -TERM $HOLDERS 2>/dev/null            # 1) TERM first, all holders (unquoted — word-split PID list)
  for _ in 1 2 3 4 5 6; do                   # 2) bounded wait: 6 × 1s ticks
    sleep 1
    [ -z "$(lsof -t +D "$WT_PATH" 2>/dev/null)" ] && break
  done
  SURVIVORS="$(lsof -t +D "$WT_PATH" 2>/dev/null | sort -u)"
  if [ -n "$SURVIVORS" ]; then
    kill -KILL $SURVIVORS 2>/dev/null       # 3) KILL only the survivors (unquoted — one arg per PID)
    sleep 1
  fi
fi
# 4) Re-query: only an EMPTY holder set may proceed to remove/prune/branch delete.
FINAL="$(lsof -t +D "$WT_PATH" 2>/dev/null | sort -u)"
if [ -n "$FINAL" ]; then
  PORTS="$(lsof -nP -a -p "$(echo "$FINAL" | paste -sd, -)" -iTCP -sTCP:LISTEN 2>/dev/null \
    | awk 'NR>1 {print $9}' | sort -u | paste -sd' ' -)"
  echo "halt: worktree still held by PID(s): $FINAL ${PORTS:+listening: $PORTS}" >&2
  write_marker retained                      # landed-but-incomplete: retained + mergeCommit
  exit 1                                     # -> WT-5: retain worktree + branch,
fi                                           #   NO prune/remove/branch delete
# Pre-removal evidence assertion (task 1067 R1, E71 enforcement): refuse to remove the
# worktree while it still owns evidence absent from (or divergent from) the invoking tree —
# the D63 landing skipped persist-out and silently lost verdicts + receipts. WBSes ride the
# same TASK_FILE_ARGS resolved for WT-4a; run ids are a separate `--run-id <id>` per run and
# belong to THIS check only — `inline-run-setup.ts --persist-out` accepts `--from` and
# `--task-file` alone and exits 2 on `--run-id` (1089 driver note).
CHECK_SCRIPT=plugins/sp/scripts/persist-out-check.ts; [ -f config/plugin-scripts.json -a -f "$CHECK_SCRIPT" ] || CHECK_SCRIPT="$(superskill script path sp persist-out-check.mjs 2>/dev/null)"
bun "$CHECK_SCRIPT" --from "$WT_PATH" "${TASK_FILE_ARGS[@]}" \
  || { echo "WT-4 halt: worktree evidence would be abandoned - persist-out missing or stale (WT-5)" >&2; write_marker retained; exit 1; }
git worktree remove "../<worktree-dir>" \
  || { echo "WT-4 halt: worktree remove failed after landed merge $BATCH_TIP" >&2; write_marker retained; exit 1; }
# Branch deletion runs only after the merge landed, persisted, and the worktree is gone —
# and it is existence-guarded, so a removed branch is never queried. -D over -d: the landed
# verify already proved the merge landed, so an unmerged-refusal would only block proven-merged cleanup.
if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  git branch -D "$BRANCH" || { echo "WT-4 halt: cannot delete branch $BRANCH after landed merge $BATCH_TIP" >&2; write_marker retained; exit 1; }
fi
# WT-4c — clean up registry entry in ~/.config/spur/projects.json (task 0924)
spur projects remove "$WT_PATH" 2>/dev/null || spur projects clean --json 2>/dev/null || true
# WT-4d — relink the invoking tree when the landed diff touched a manifest or the lockfile (task 1121).
# The gate evidence came from the worktree's node_modules; the receiving tree still links the old
# workspace set until it is re-installed. --ignore-scripts mirrors the worktree convention (0701 R2a).
if git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json' | grep -q .; then
  bun install --frozen-lockfile --ignore-scripts \
    || echo "WT-4d warning: invoking tree workspace links are stale — run 'bun install --frozen-lockfile --ignore-scripts'" \
       | tee -a ".spur/run/worktree-<marker-id>-batch-report.md" >&2
fi
# Success marker, written once and only here: status "merged" + mergeCommit "$BATCH_TIP" —
# after landed verification, required persistence, and cleanup:
write_marker merged
```

Every halt above stops explicitly and falls through to **WT-5** — zero-commit branch (task 0701
R1), failed checkout, divergent base, failed FF, persist-out failure (task 0975), or surviving CWD
holders (task 0720 R1). WT-4d (task 1121) is the one non-halting step: when the landed diff touched
a manifest or the lockfile it re-installs the invoking tree, and a failed relink only appends a
stale-links warning to the batch report — the success marker still records `merged`. Pre-merge
failures leave the marker at `status: active` and the worktree +
branch untouched. Landed-but-incomplete failures record `status: retained` + `mergeCommit`
BATCH_TIP: the merge landed, and the retained report reads the captured tip only. While any holder
remains, do **not** run `git worktree prune`, `git worktree remove`, or branch deletion — only an
EMPTY holder set may proceed to those steps. The holder
halt report names every surviving PID; the listening port is best-effort — a CWD holder may own no
socket, and `lsof` port discovery failing must not hide the PIDs.

#### Reuse mode — merge, retain

The fail-stop merge sequence runs identically — same guard, captured `BATCH_TIP`/`BASE_TIP`,
ancestry check immediately before FF, `git merge --ff-only`, landed verification (per-call pinned
to the invoking tree, task 1058) — but no WT-4a/4b/4c and no removal: the worktree and branch are
**retained**. Pre-merge halts leave the marker `active`; a persistence failure after the landed
merge records `retained` + `mergeCommit`:

```bash
# Same fail-stop sequence as create mode (zero-commit guard -> BATCH_TIP/BASE_TIP -> ancestry
# rc check -> git merge --ff-only -> landed verify); local refs only — no fetch.
MARKER=".spur/run/worktree-<marker-id>.json"
git checkout "$BASE_REF" \
  || { echo "WT-4 halt: checkout $BASE_REF failed - nothing merged, marker stays \"active\"" >&2; exit 1; }   # -> WT-5
[ "$(git rev-list --count "$BASE_REF..$BRANCH")" -gt 0 ] \
  || { echo "WT-4 halt: branch carries no commits - nothing to merge" >&2; exit 1; }
BATCH_TIP="$(git rev-parse "$BRANCH")" || { echo "WT-4 halt: cannot read $BRANCH" >&2; exit 1; }
BASE_TIP="$(git rev-parse "$BASE_REF")" || { echo "WT-4 halt: cannot read $BASE_REF" >&2; exit 1; }
ANCESTRY_RC=0
git merge-base --is-ancestor "$BASE_TIP" "$BATCH_TIP" || ANCESTRY_RC=$?
[ "$ANCESTRY_RC" -gt 1 ] \
  && { echo "WT-4 halt: ancestry check could not run (git exit $ANCESTRY_RC) - failing closed" >&2; exit 1; }
[ "$ANCESTRY_RC" -eq 1 ] && {
  echo "WT-4 halt: divergent - batch tip $BATCH_TIP vs base tip $BASE_TIP" >&2
  git log --oneline "$BASE_TIP..$BATCH_TIP" >&2
  git log --oneline "$BATCH_TIP..$BASE_TIP" >&2
  exit 1; }   # -> WT-5: tree + branch retained, marker stays "active"
git merge --ff-only "$BRANCH"          # FF-only: never rebase, merge-commit, or resolve conflicts
[ $? -eq 0 ] \
  || { echo "WT-4 halt: FF-merge failed - the concurrent-writer race survives every precheck; marker stays \"active\"" >&2; exit 1; }
LANDED_BASE_TIP="$(git rev-parse "$BASE_REF")" \
  || { echo "WT-4 halt: cannot read landed base tip" >&2; exit 1; }
git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP" \
  || { echo "WT-4 halt: landed verify failed - $BATCH_TIP is not an ancestor of $LANDED_BASE_TIP" >&2; exit 1; }
WT_PATH="<resolved-worktree-path>"   # reuse mode: the adopted tree's physical path
write_marker () {   # $1 = merged | retained; read-modify-write: preserve WT-3 fields (id, command, selector, createdAt, adopted, adoptedAt); jq already assumed by WT-3/task-resolution flows
  mkdir -p "$(dirname "$MARKER")"
  if [ -f "$MARKER" ]; then
    TMP_MARKER="$(mktemp)"
    jq --arg s "$1" --arg m "$BATCH_TIP" '.status = $s | .mergeCommit = $m' "$MARKER" > "$TMP_MARKER" \
      || { echo "WT-4 halt: cannot rewrite marker $MARKER" >&2; rm -f "$TMP_MARKER"; exit 1; }
    mv "$TMP_MARKER" "$MARKER"
  else
    printf '{ "baseRef": "%s", "baseSha": "%s", "branch": "%s", "path": "%s", "status": "%s", "mergeCommit": "%s" }\n' \
      "$BASE_REF" "$BASE_SHA" "$BRANCH" "$WT_PATH" "$1" "$BATCH_TIP" > "$MARKER"
  fi
}
# Step 5 evidence persistence (task 0720 R3) — required BEFORE the success marker:
if printf 'batch report %s\n' "$BATCH_TIP" > ".spur/run/worktree-<marker-id>-batch-report.md"; then :; else
  echo "WT-5 halt: persistence failed after landed merge $BATCH_TIP; recovery reads captured tips only" >&2
  write_marker retained
  exit 1
fi
# WT-4d — relink the invoking tree when the landed diff touched a manifest or the lockfile (task 1121).
# The gate evidence came from the worktree's node_modules; the receiving tree still links the old
# workspace set until it is re-installed. --ignore-scripts mirrors the worktree convention (0701 R2a).
if git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json' | grep -q .; then
  bun install --frozen-lockfile --ignore-scripts \
    || echo "WT-4d warning: invoking tree workspace links are stale — run 'bun install --frozen-lockfile --ignore-scripts'" \
       | tee -a ".spur/run/worktree-<marker-id>-batch-report.md" >&2
fi
# Success marker: status "merged" + mergeCommit "$BATCH_TIP" — written once, only after landed verification and required persistence.
# The worktree and branch are intentionally NOT removed.
write_marker merged
```

The operator supplied the tree, so the operator owns its lifetime. After a green reuse batch
`baseRef == $BRANCH`, so the same worktree keeps fast-forwarding on the next invocation instead of
having to be rebuilt — the continue-the-work loop is stable. WT-4d (task 1121) relinks the
invoking tree there too — after the Step 5 persistence, before the success marker; a failed relink
appends the same stale-links warning to the persisted batch report, and the success marker still
records `merged`.

**Fast-forward only.** `git merge --ff-only` is the sole mutation of the terminal sequence; every
other step is a read, a check, a persistence write, or a cleanup, and every tip/ancestry read uses
local refs — no fetch runs anywhere in this lifecycle. If the fresh `BASE_TIP` is not an ancestor of
`BATCH_TIP`, the ancestry check halts before the merge: the report names both tips and both
divergent commit ranges (`$BASE_TIP..$BATCH_TIP` and `$BATCH_TIP..$BASE_TIP`) and falls to the
retention path (WT-5) with the tree and branch retained. A concurrent writer that lands between the
ancestry check and the merge still trips `--ff-only` — the race survives every precheck, and a
failed FF leaves the marker at `status: active`. Do **not** rebase, merge-commit, or resolve
conflicts. The corpus files (`docs/tasks*/`, kanban/index) are
auto-generated and conflict-prone; automated conflict resolution over generated files is exactly the
wrong thing to attempt unattended. FF-only means the merge either is trivially correct or does not
happen.

**Auto-decision carve-out.** The create-mode success path runs unattended on a fully-passing
`--worktree --auto` batch — it does **not** pause even though it performs a merge and a branch
deletion. That is the explicit single exception to Auto-Decision Principle #6 (`cross-cutting.md`),
which otherwise pauses any `--merge` / branch-deletion action regardless of `--auto`. The exception
is safe because `git merge --ff-only` fails closed (it refuses rather than risk losing work), the
branch deletion runs only after the merge has landed, persisted, and cleaned up — and is
existence-guarded (`git rev-parse --verify --quiet`), so a removed branch is never queried;
WT-5 retains the worktree and branch whenever FF is impossible or any task fails.
Reuse mode is **narrower** than the carve-out (it merges but does not delete the branch), so the
carve-out text needs no widening.

**Lifecycle-DB disposition (task 0701 R2d, amended by 0720).** The worktree has its own `.spur`
lifecycle DB, and WT-4/WT-5 remove or retain that tree — the DB state does **not** travel with the
merge. One contract, no alternatives:

- **Committed task files own lifecycle state.** The **committed task file is authoritative**: after
  a green merge the branch's task files already read `done`/`testing` in the invoking tree; no
  `spur task update` or `spur task record` replay runs post-merge. Replay is not "one of two
  options" — it is removed: it writes `updated_at`-only churn and can never restore worktree-only
  DB rows.
- **The persisted invoking-tree artifacts own evidence.** The Step 5 batch report at
  `.spur/run/worktree-<marker-id>-batch-report.md` and the copied verdict JSONs under
  `.spur/run/worktree-<marker-id>-verdicts/` (written before WT-4 removal) are the batch/verdict
  record.
- **Per-worktree lifecycle DB rows intentionally do not travel.** No `task_run_links` import, no
  cross-database provenance synthesis — the DB is per-tree by design.
- **No timestamp-only corpus churn.** Post-merge the invoking tree's DB statuses may read stale
  relative to the committed files; that divergence is accepted, not repaired. Do not run
  `task update`/`task record` to "catch up" the DB, and do not repair churn with
  `git checkout -- docs/tasks*/`.

This is a deliberate choice over auto-migrating DB state: the committed corpus files are the durable
record and the persisted run artifacts are the evidence record.

### WT-5 — Failure path: retain and report (R5)

On any per-task failure, batch halt, HITL pause that ends the run, or a WT-4 halt, the
worktree directory and branch are left **intact**. No destructive automation on this path under
any flag combination (`--auto`, `--force`, `--keep-going` — all leave the worktree in place). The
marker records which class of halt occurred (frozen vocabulary):

- **Pre-merge failure** (failed checkout, zero-commit guard, divergent base, failed FF): the merge
  never landed, so the marker **stays at `status: active`** — the WT-3 marker stands and WT-5 is
  its disposition. Nothing was merged onto the base ref.
- **Landed-but-incomplete failure** (persist-out, holder cleanup, or worktree removal failed after
  a landed merge): the marker records `status: retained` + `mergeCommit` BATCH_TIP — a truthful
  report that the merge landed. The retained path reads the captured `BATCH_TIP` only; a removed
  branch is never queried.

The worktree's own `.spur` lifecycle DB is retained with the tree,
so nothing is lost on either path (see the WT-4 lifecycle-DB disposition for the merged case —
task 0701 R2d). Emit a retention report in the existing halt-report shape:

**Persist-out skip recovery (task 1067 R2, E71).** When evidence was lost to a landing that
skipped persist-out (or the pre-removal assertion fired too late), verdicts remain derivable
from the task records — `spur task show <wbs> --json` carries the recorded verdict and its
proof block, so a lost `<wbs>-verdict.json` is regenerated by re-recording or copying from
the task store. Feature run/latest receipts are re-runnable, not recovered: rerun the
feature-verification workflow in the invoking tree —
`spur workflow run feature-verification.yaml --vars '{"featureId":"<id>"}'` — which rewrites
the receipt files it owns. Divergent files are never auto-overwritten; reconcile by hand.

```
## Worktree retained — <command> <selector>

**Halt cause:** <one-line cause — batch halted at task <wbs> / non-FF base ref / HITL pause / landed-but-incomplete cleanup failure>
**Worktree path:** ../<worktree-dir>
**Branch:** sp/<command>-<selector-slug>-<short-id>
**Base ref:** <base-ref> (<base-sha>)
**Merge state:** pre-merge failure — nothing landed | landed-but-incomplete — mergeCommit <batch-tip-sha>

The worktree and its branch are intact.
pre-merge failure: nothing was merged onto the base ref.
landed-but-incomplete: the batch merge LANDED as <batch-tip-sha> on <base-ref>; retention covers post-merge persistence/cleanup only.
Resume, merge, or discard:

  resume:  cd <worktree-path> && <command> --continue --worktree <worktree-path>
  merge:   git checkout <base-ref> && git merge <branch>     # resolve conflicts manually
  discard: git worktree remove <worktree-path> && git branch -D <branch> && spur projects remove <worktree-path>
```

When the halt cause is `non-FF base ref`, the report replaces the one-line `merge:` hint with this
ordered divergence recipe, run by the operator — the driver never merges, rebases, or resolves
conflicts itself. Other halt causes (task failure, HITL pause) keep the hint as printed:

```
# 1. decide whether conflicts need resolving FIRST, because that decides the merge form.
#    Use the rc of `git merge-tree --write-tree` (git ≥ 2.38; `git --version` here reports 2.55):
#      git merge-tree --write-tree <base-ref> <branch> >/dev/null && echo "clean — use the atomic form" \
#        || echo "conflicts — use the two-phase form below"
#    Do NOT use the legacy three-argument form
#    (`git merge-tree $(git merge-base …) <base-ref> <branch> | grep '^<<<<<<<'`): it reports no
#    conflict markers at all — verified 2026-10-08 on 2.55 against a synthetic repo, where it
#    printed 0 markers for a real same-file conflict and sent this report's own landing into the
#    atomic form on a diverging base (the merge then conflicted and had to be driven two-phase by
#    hand). If `--write-tree` is unavailable on the operator's git, assume conflicts: the
#    two-phase form is always correct, it just costs the resolution window described in 1a.
#
# 1a. CLEAN (the common case): integrate as ONE atomic merge commit. Never a rebase — task
#     evidence cites the branch's commit SHAs. This is the file's sanctioned merge commit.
#     Do NOT split this into a two-phase merge + commit when nothing needs resolving: that spans
#     the whole gate run, and anything in that window that touches the repository's git state
#     (a test, a hook, a tool invocation) discards MERGE_HEAD silently. The failure is invisible
#     until the history is read — it produced a single-parent commit in run ada5a36c (task 1090),
#     which then needed an extra empty ancestry merge to repair. A cheap probe could not
#     reproduce it (MERGE_HEAD survived `bun run lint`, the rule preset and a test-file subset),
#     so the cross-command dependency is removed rather than diagnosed.
git checkout <base-ref> && git merge --no-ff -m "<prepared message>" <branch>

# 1b. CONFLICTING: the two-phase form is correct here, because the resolution work must land
#     between the merge and the commit. Everything in steps 2–4 belongs to this branch only.
#     A divergent branch cannot fast-forward, so the merge flag from 1a is not needed here.
#     Fingerprint FIRST — step 3 stages through this guard, so a path that was already dirty
#     before the merge is refused as foreign instead of riding into the merge commit (1129 R2).
#     This commit lands in the INVOKING tree, so the fingerprint is taken there too (`$RUN_ID` is
#     the batch's run id, the same one WT-3b's worktree fingerprint used — the two trees keep two
#     artifacts under the same id):
#       RUN_ID="<marker-id>"   # the WT-3 marker's id
#       GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)"
#       bun "$GUARD" start --run "$RUN_ID"
#     git checkout <base-ref> && git merge --no-commit <branch>
# 2. resolve source conflicts by hand; generated files are then regenerated with the project's
#    generator, never hand-merged
#    (this repo: bun run build:plugin-lib && bun run --filter @gobing-ai/spur build:bundle)
# 3. stage every resolved path and regenerated bundle through the guard — an unmerged or
#    unstaged path makes step 5 abort, and a conflict-marked path exits 3 (resolve, then retry):
#      bun "$GUARD" stage --run "$RUN_ID" -- <resolved paths and regenerated bundles>
#    Forbidden here as in every driver commit step: `git add -A` and `git add .`.
# 4. run qualityGateCmd once, after ALL conflicts are resolved
# 5. commit the merge with the prepared message file — CHECK THE PARENTS FIRST (step 5a)
#    git commit -F <message-file>
#
# 5a. ALWAYS verify the merge really is a merge before treating it as landed:
#       git log -1 --format='%h parents=%p'   # must print TWO parents
#     One parent means MERGE_HEAD was lost somewhere between steps 1 and 5 — the content is on
#     the base ref but the branch is not an ancestor, so `git branch -d` would refuse and the
#     retained worktree's provenance would not be readable from the base ref. Recover by
#     re-running step 1a against the already-landed tree (a content-free merge commit restores
#     ancestry).

# 6. persist evidence out (WT-4a), then WT-4b/4c cleanup, and set the marker to merged
inline-run-setup --persist-out --from <worktree> --task-file …
```

The report reuses the [`--next` chain contract](flag-glossary.md#--next-chain-contract) halt-report
shape (halt cause + where + why), not new vocabulary. Retention is the right default: these batches
are long and already resumable via `--continue`; auto-deleting is data loss, auto-merging is a
partial result presented as a whole. The answer to "what happens if it fails" is "nothing happens,
and we tell you where the work is."

**Partial worktree-removal recovery is inspection-only.** If a create-mode run halted partway
through removal (leftover directory, stale registration), the recovery pass gathers facts and
nothing else: `git worktree list` (is the tree still registered?), `ls` of the path (what remains
on disk?), and the marker / `~/.config/spur/projects.json` registration state. Before removing
anything, verify the leftover path is the batch's **owned** path — match it against the marker's
`path`/`branch` (or the resolved `--worktree <name>` identity), never a guessed sibling directory.
Recursive deletion of leftover directories that survived `git worktree remove` is **never
automatic** — it requires explicit operator authorization. No automatic rebase, recovery merge,
`git worktree prune`, or holder kill runs on this path.
