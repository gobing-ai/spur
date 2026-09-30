---
description: "Review code for a task set or paths — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. With --triage: fix small findings directly, then file the rest as implement-ready tasks. Triggers: \"review this\", \"check the code\", \"SECUA review\", \"dev review\", \"audit this\", \"triage review findings\"."
role: reviewer
argument-hint: "[--tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>]] [--agent <inline|auto|name>] [--focus <dims>] [--triage] [--worktree [<name>]] [--auto]"
allowed-tools: ["Bash", "Read", "Skill", "Edit", "Write"]
---

# Dev Review

Wraps the **sp:functional-review**, **sp:code-verification**, and **sp:code-improvement** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks <selector>` | Review a task set — batch selector grammar ([execution-batch.md § Step 1](../skills/spur-dev/references/execution-batch.md#step-1--selector-resolution-r1)): comma WBS list or `feature:<id>`; status pseudo-lists and `ready` are rejected for review (they select work to do, not work to review). Resolved once, frozen; one WBS-mode review per task, each writing its own merged `## Review`; the run ends with a combined summary table (WBS, verdict, P1/P2 counts). | — |
| `--feature <id>[,<id>]` | Sugar for the union of the `feature:<id>` sets — resolved once, frozen, then reviewed as `--tasks`. | — |
| `--scope <path>[,<path>]` | Advisory review of the tracked files under one or more paths: paths must exist (exit 2 otherwise), are normalized, duplicates dropped and nested paths collapse to the ancestor (`--scope apps,apps/cli` → `apps`); one sub-review per path, one merged report with a cross-path architecture pass; no task mutation. | — |
| `[<wbs\|path>]` | **Deprecated positional alias** (one release): a `^\d{4}$` token with a resolvable task → `--tasks <wbs>`; an existing path → `--scope <path>`; otherwise exit 2. Prints a deprecation warning naming the replacement. | — |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing review. | omit |
| `--focus` `<dims>` | Review dimensions — vocabulary and skill routing: [code-verification/SKILL.md](../skills/code-verification/SKILL.md) review mode (SSOT). | all |
| `--triage` | After the review: bucket findings across all targets once (identical `file:line` findings deduped), fix small findings directly, file the rest as one or more implement-ready tasks. | off (report-only) |
| `--worktree` `[<name>]` | Run the triage in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. Multi-target aware (below). Requires `--triage`. | off |
| `--auto` | Skip objective HITL confirmations. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-review [--tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>]] [--agent <inline|auto|name>] [--focus <dims>] [--triage] [--worktree [<name>]] [--auto]
/sp:dev-review --tasks 0962,0963 --triage
/sp:dev-review --scope apps,packages,plugins,scripts
/sp:dev-review 0962 --triage --worktree
```

Put the target first: a bare token after `--worktree` is read as the worktree name.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- **Selector validation (before any review runs).** Exactly one target kind per invocation: `--tasks`, `--feature`, or `--scope`. More than one → exit 2 naming the conflicting selectors (a positional beside an explicit selector is a second target kind → exit 2); none (and no positional) → exit 2 with usage — there is no implicit `cwd` target. The set is resolved once and frozen through the [execution-batch.md § Step 1](../skills/spur-dev/references/execution-batch.md#step-1--selector-resolution-r1) batch resolver — no review-specific parser; `--feature <id>[,<id>]` is sugar for the union of the `feature:<id>` sets.
- **WBS mode (per task target):** `Skill(skill="sp:functional-review", args="<wbs> $FLAGS")` + `Skill(skill="sp:code-verification", args="review <wbs> $FLAGS")` + `Skill(skill="sp:code-improvement", args="<wbs> $FLAGS")` (functional traceability + SECUA framework + architectural depth — each skill receives its one resolved WBS exactly once plus `$FLAGS` = `$ARGUMENTS` minus the selector (`--tasks`/`--feature`/`--scope` or positional) and its value, never the raw selector, and returns a review fragment only — F92 0593 R1)
- **Task fan-out (`--tasks` / `--feature`).** One WBS-mode review per task in the frozen set. Tasks in `backlog`/`todo`/`blocked` are reported NOT-STARTED and skipped (§ 3a outcome vocabulary); a per-task failure does not stop the remaining tasks. Each implemented task gets its own merged `## Review`; the run ends with a combined summary table (WBS, verdict, P1/P2 counts).
- Coordinator = this session. No `sp:super-reviewer` subagent is dispatched: act as the review coordinator defined in [agents/super-reviewer.md](../agents/super-reviewer.md) — merge the fragments per its Output Format (native `P1`–`P4` priority cells, section-relative headings) and, for every task target (standalone or pipeline), write that task's combined `## Review` via `spur task update <wbs> --section Review --from-file`. Path mode emits advisory output only.
- **Path mode (per path target):** `Skill(skill="sp:code-verification", args="review <path> $FLAGS")` + `Skill(skill="sp:code-improvement", args="<path> $FLAGS")` (advisory SECUA quality + architectural depth — one normalized path forwarded once plus `$FLAGS`; performs no task mutation). Under `--scope <path>[,<path>]`: paths must exist (exit 2 otherwise), are normalized, duplicates dropped and nested paths collapse to the ancestor (`--scope apps,apps/cli` → `apps`); each surviving path gets a sub-review (Step 3p path scope), eligible for native-subagent dispatch per [dispatch-surface.md](../skills/parallel-execution/references/dispatch-surface.md); the coordinator merges the sub-reviews, runs **one** cross-path architecture pass (`sp:code-improvement` over the inter-path imports), and emits **one** advisory report. No task mutation.
- **Positional alias (deprecated).** A positional `<wbs|path>` is accepted for one release: a `^\d{4}$` token with a resolvable task behaves as `--tasks <wbs>`; an existing path as `--scope <path>`; otherwise exit 2. Print a deprecation warning naming the replacement selector; removal is a follow-up.
- `--triage`: after the review returns, run the triage protocol in [dev-operations.md § 2. review](../skills/spur-dev/references/dev-operations.md#2-review) **inline in this session** — the review skills and `sp:super-reviewer` stay report-only. With multiple targets, bucket the findings across all targets once (identical `file:line` findings deduped before bucketing). `Edit`/`Write` in `allowed-tools` exist only for these direct fixes.
- Without `--worktree`, every write lands in the current working tree on the current branch: no branch creation, no checkout, no commit.
- `--worktree [<name>]`: the [execution-batch.md § Worktree isolation](../skills/spur-dev/references/execution-batch.md#worktree-isolation---worktree-name) lifecycle as a run of one (marker `command` = `dev-review`, `selector` = the full normalized target list). Admission requires every target to resolve before the tree is cut. Branch slug: `sp/review-<first>-and-<N>-<short-id>` for a multi-target run (N = target count), `sp/review-<slug>-<short-id>` for a single target (the WBS or the path's basename). Rejected without `--triage`.
  While it runs, fixes and filed tasks land in the worktree copy; the main tree shows them only after the FF-merge.
- `--fix`: Deprecated (still accepted: no-op + warning; route remediation to `--triage` or `/sp:dev-verify --fix`). **`--next` removed** (feature H8, 2026-07-31) — it was a deprecated no-op; route progression to `/sp:dev-next`. **was: `--next` deprecated no-op.**
