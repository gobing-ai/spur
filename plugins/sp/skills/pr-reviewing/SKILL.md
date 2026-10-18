---
name: pr-reviewing
description: "Local-first PR review — status, a local /sp:dev-review of the branch diff, and validated fixes; `--codex` opts into the GitHub Codex review spine. Backs /sp:dev-pr-review. Triggers: PR review, codex review, @codex review, review my PR, dev-pr-review."
license: Apache-2.0
version: 2.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: engineering-core
  interactions:
    - workflow
    - review
  pipeline_steps:
    - status
    - check
    - review
    - open
    - triage
    - fix
see_also:
  - sp:code-verification
  - sp:functional-review
  - sp:spur-cli
  - sp:spur-dev
---

# sp:pr-reviewing — Local-First PR Review

Backend for `/sp:dev-pr-review`. Local-first by default: `status` is a read-only snapshot and
`review` reviews the branch diff locally with `/sp:dev-review`. `review --codex` opts into the
GitHub Codex review on the pull request; `fix` triages and fixes findings from either reviewer. The
invoking coding agent is the local orchestrator and implementer.

## Architecture

```text
/sp:dev-pr-review (thin command)
      │  Skill(skill="sp:pr-reviewing", args=...)
      ▼
sp:pr-reviewing (this skill — mode routing, local-review dispatch, triage, fix)
      │  local route:  pr-check --scan-only → git diff --name-only → /sp:dev-review
      │  Codex route:  pr-check → pr-open → pr-review → pr-status
      ▼
`spur builder pr-<verb>` + `spur builder show-branches`  ← tested git/gh core
```

- **Deterministic work** (every git/gh call) goes through the four flat `spur builder pr-<verb>`
  commands and `spur builder show-branches` — never hand-rolled `gh` invocations that drift from
  the tested core.
- **Sequencing inside a verb** (preflight→hygiene, push→ensure, request→wait→collect) lives in
  `runPrVerb`, not in this file. This skill orders the *verbs*; each verb owns its own ops, its
  one-word verdict and its exit code.
- **Model-bearing work** (the local review dispatch, finding triage, `fix` edits) is this skill's
  job and never enters a deterministic verb.

## Modes and routing

Parse the first positional argument as the mode; default `status`.

| Mode | Route | Behavior |
| --- | --- | --- |
| `status` | direct CLI | `spur builder show-branches --base <b> --pr --format markdown`, with the report filtered to the current branch and its base, plus `spur builder pr-status --json` (PR number, CI, local changes, latest current-head review in `.review`). Read-only. |
| `review` | local stack | `spur builder pr-check --base <b> --scan-only --json`; `BLOCK` stops, `WARN` is reported. Then `git diff --name-only <b>...HEAD` → `/sp:dev-review --scope <comma-joined paths> --focus <focus>`. An empty diff ends with "nothing to review". Posts nothing to GitHub. |
| `review --codex` | direct verb sequence | `spur builder pr-check --base <b> --json` → `pr-open --base <b> --json` → `pr-review --focus <focus> [--force] [--no-wait] --json` → `pr-status --json`. Each verb's verdict gates the next; `PENDING` is reported as pending, never failure. |
| `fix` | direct verb + model work | Findings from the latest local review verdict, or from `spur builder pr-status --json` `.review` when the last review was Codex. Validate each finding against the code before editing; rejected findings are listed with a reason. Fix the legitimate ones, run the project gate, make one focused commit and push without force (`spur builder pr-open` handles a first push). |

Retired modes print one notice line and run their replacement: `full` → `review --codex`;
`submit` → `review --codex --no-wait`; `rerun` → `review --codex --force`; `collect` → `status`.
`rules` prints a notice that `AGENTS.md` review-rule authoring belongs to `cc:cc-magents` (in the
`cc` plugin, not `sp`) and exits.

## Arguments

- `--codex` — run `review` through the GitHub Codex spine instead of the local stack.
- `--force` — with `--codex`, request a fresh review of the current HEAD even when it was already
  reviewed.
- `--no-wait` — with `--codex`, post the request and return pending instead of polling.
- `--base <branch>` — base for the branch report, the `pr-check` diff and a newly created PR.
  Default: the existing PR's base, else the repo default.
- `--agent <inline|auto|name>` — names **who performs model-bearing work**, per the
  [inline-default execution-surface contract](../spur-dev/references/cross-cutting.md#inline-default-execution-surface).
  `--agent` describes the model owner only; it is independent of the deterministic git/GitHub spine.
- Remaining free text — extra review focus, passed to the local review and appended to the Codex
  request without weakening repository-defined rules (e.g. `security and authorization boundaries`).

## Status mode

Read-only; no source edits, PR creation, pushes, or review requests.

1. Resolve the base: `--base`, else the existing PR's base, else the repo default.
2. `spur builder show-branches --base "$base" --pr --format markdown` — keep only the rows for the
   current branch and its base (the full report is long) plus the current branch's graph line.
3. `spur builder pr-status --json` for the composite repository/branch/PR/base/local/CI status and
   `.review` (the current-HEAD Codex record). With no PR, report `PR: none` rather than failing.

Report:

```text
PR:            <number + URL | none>
Branch:        <branch>
HEAD:          <short SHA>
Base:          <base>
Ahead/Behind:  <n>/<n> vs <base>
CI:            <status | unavailable>
Codex:         clean | findings | pending | not requested | unavailable
```

## Review mode (local)

1. **Submission scan.** `spur builder pr-check --base "$base" --scan-only --json`. Three outcomes:
   - `PASS`/`WARN` — continue. A `WARN` (debug residue) is reported and rides into the review.
   - `BLOCK` (secrets, `.env`, conflict markers, private keys) — stop; never review a tainted diff,
     and name the blocking files.
   - hard failure (exit 2, e.g. `gh` missing or unauthenticated, no GitHub remote, not a
     repository) — stop and report the tool's message plus the one-line remedy (`gh auth login`
     and a GitHub `origin` remote). A hard failure is **not** a `BLOCK`; hygiene did not run.
   `--scan-only` skips the preflight sub-op so a dirty tree is expected, but hygiene itself still
   resolves the repository through `gh` — the scan needs `gh` authenticated with a GitHub remote.
2. **Diff scope.** `git diff --name-only "$base"...HEAD`. An empty list ends the mode with
   "nothing to review". `/sp:dev-review` takes `--scope` paths, not a diff range, so pass the
   comma-joined file list.
3. **Local review.** `/sp:dev-review --scope <comma-joined paths> --focus "<focus>"`. It owns the
   review dimensions — do not re-implement them here. Report findings by severity with `file:line`.
   Post nothing to GitHub.

## Review mode (--codex)

Four verbs in order. Each one's `--status-file` verdict gates the next — stop at the first red
verdict and report it with the stage's JSON record; never run a later verb to "retry" an earlier
one, and never force-push around a rejected push.

```sh
spur builder pr-check  --base "$base" --json --status-file .spur/run/pr-check.status
# PASS|WARN → continue (a WARN rides into the report).  BLOCK|FAIL → stop.
# BLOCK = secrets/.env/conflict markers/private keys. FAIL = preflight (detached HEAD, dirty
# tree, gh unauthenticated, no GitHub remote, or the current branch *is* the base).

# Optional project fast check before spending a review request. Run it only when the project
# defines one; a red check stops here rather than reviewing code that fails its own gate.

spur builder pr-open   --base "$base" --json --status-file .spur/run/pr-open.status
# FOUND|CREATED → continue.  FAIL → stop (push rejected, no reviewable delta, PR create failed).

spur builder pr-review --focus "$focus" [--force] [--no-wait] \
    --timeout 600 --interval 30 --json --status-file .spur/run/pr-review.status
# CLEAN|FINDINGS → collected.  PENDING → pending, not failed.  FAIL → stop.

spur builder pr-status --json   # composite PR/CI/Codex report; read-only, never gates
```

- **Flags from the invocation:** `--force` requests a fresh review of an already-reviewed HEAD;
  `--no-wait` posts the request and returns `PENDING` without polling. Both are optional and
  independent — pass each as its own argument. The default is request → wait → collect, with
  per-HEAD dedupe.
- **`PENDING` is pending, not failed** (a wait timeout included): report the requested or in-flight
  state and collect later with `status`.
- **`pr-review` owns request → wait → collect in one runtime** (`runPrVerb`), so there is no
  separate request record to thread between steps.
- When `--codex` is passed, the external review goes through the GitHub PR and an `@codex review`
  request only — never a local Codex CLI review. If GitHub Codex Code Review is unavailable, stop
  and report the setup/access problem; never silently fall back to a local review.

## Fix mode

Only in `fix` mode:

1. **Collect findings before editing.** Use the latest local review verdict when the last `review`
   was local. When the last review was Codex, invoke `spur builder pr-status --json` and read
   `.review` — the current-HEAD Codex record. Treat the PR's pushed `headRefOid` as the review
   identity: a result for an older commit is stale, and a result absent for the current HEAD is
   pending, not clean. If the record is pending, stale, or unavailable, report it and stop without
   source edits.
2. **Validate each finding.** Open the referenced code; trace callers/callees; verify the problem is
   reachable; check intended behavior and existing tests. Classify: `Confirmed`, `Likely valid`,
   `Needs investigation`, `Likely false positive`. List every rejected finding with its reason;
   never edit for a likely false positive.
3. **Fix legitimate issues** with the smallest coherent change. No unrelated refactoring; add or
   update tests when they materially demonstrate the fix; follow repository conventions. Inspect
   `git diff` — the patch must contain only intended review fixes.
4. **Verify** with repository-defined targeted checks. Never claim a check passed unless it ran
   successfully.
5. **Commit** one focused review-fix commit describing the actual defect (`fix: prevent duplicate
   transaction retry`), never `fix codex comments`. No unrelated files.
6. **Push** normally (never force) and report the new HEAD. `spur builder pr-open` handles a first
   push.

## Safety rules

**Git history — never:** force-push (`--force`/`--force-with-lease`), destructive `git reset`, `git
clean`, rewriting published history, closing or integrating the PR, deleting branches, or discarding
unrelated user changes.

**Local changes.** A GitHub PR only reviews pushed commits. `review` without `--codex` makes no
GitHub writes. `fix` pre-authorizes one focused fix commit for verified findings — still stop if
unrelated uncommitted changes make safe editing or committing ambiguous.

**Reviewer authority.** A remote reviewer is an independent reviewer, not an authority. For every
finding that may lead to a code change: inspect the referenced code, verify reachability and
intended behavior, inspect callers/callees, check existing tests, classify, reject false positives,
fix root causes rather than wording, prefer the smallest coherent patch, avoid drive-by refactors.

## Reporting

Findings report:

```text
Reviewer
  local (/sp:dev-review) | GitHub Codex

Findings

1. [severity] path:line
   Classification: Confirmed | Likely valid | Needs investigation | Likely false positive
   Problem:
   Why it matters:
   Evidence:
   Recommended next action:
```

Preserve filenames, line references, severity, and the important technical reasoning. Do not inflate
suggestions into confirmed bugs. If a review completed without actionable findings, say so clearly.
`fix` appends: `Fixed: <n>`, `Rejected: <n>`, `New HEAD: <sha>`. `status` prints its summary block
and nothing else.

## Failure handling

- **No PR for the branch** — `pr-status --json` returns `pr: null` and `review: null`; `status`
  reports `PR: none` and the branch report still prints.
- **`gh` missing, unauthenticated, or no GitHub remote** — `show-branches --pr` degrades with a
  warning; `pr-status` and `pr-check` exit non-zero with an error object (their hygiene step shares
  the gh-backed repository resolution). Report the branch report plus `PR: unavailable`, and stop
  the Codex path. The review's own diff scope and `/sp:dev-review` need no `gh`.
- **`pr-check` BLOCK** — stop before any review; report the blocking files and never review a
  tainted diff.
- **Empty diff** — "nothing to review"; stop.
- **Codex pending or wait timeout** — report `pending`, never failure; collect later.
- **A finding that refers to a stale head** — discard it, never fix against it.
- **A retired mode passed** — one notice line, then the replacement.

## Platform notes

- The skill and command are platform-neutral; per-platform emission is owned by superskill. On
  platforms without a Skill tool, read this file and follow the protocol manually.
- Prerequisites: `git` for every path. `gh` authenticated with a GitHub remote wherever PR state is
  touched: `status` (its `pr-status` half — the `show-branches` topology runs on `git` alone, and
  its `--pr` enrichment only degrades with a warning), `review` (step 1's `pr-check --scan-only`),
  `review --codex` (its `pr-check`/`pr-open`/`pr-review` verbs), and `fix` when it reads a Codex
  verdict or pushes through `pr-open`. The `git diff --name-only` scope, `/sp:dev-review`, and
  `fix`'s local-verdict edit/commit path need only `git`. The `--codex` path additionally needs
  GitHub Codex Code Review enabled for the repository.

## Additional Resources

- **Command source:** the four flat verbs `pr-status` / `pr-check` / `pr-open` / `pr-review` plus the
  read-only `show-branches` report — see `sp:spur-cli` `references/builder.md`
- **Local review:** `/sp:dev-review` — its dimensions live in `sp:code-verification` and
  `sp:functional-review`, never re-implemented here
- **Tests:** `packages/app/tests/services/pr-review/pr-review.test.ts` — stubbed git/gh suites
