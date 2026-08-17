---
name: pr-reviewing
description: "GitHub Codex PR-review workflow — prepare/reuse a PR, request `@codex review`, collect findings, and optionally validate/fix/re-review them. Backs /sp:dev-pr-review. Triggers: PR review, codex review, @codex review, review my PR, codex findings, dev-pr-review."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: engineering-core
  interactions:
    - workflow
    - review
  pipeline_steps:
    - preflight
    - hygiene
    - request
    - wait
    - collect
    - triage
see_also:
  - sp:code-verification
  - sp:functional-review
  - sp:spur-cli
  - sp:spur-dev
---

# sp:pr-reviewing — GitHub Codex PR Review

Backend for `/sp:dev-pr-review`. The invoking coding agent is the local orchestrator and
implementer; **GitHub Codex Code Review** is the independent reviewer. The point of the route is
that review effort happens on the PR, through Codex — not in the local session.

## Architecture

```text
/sp:dev-pr-review (thin command)
      │  Skill(skill="sp:pr-reviewing", args=...)
      ▼
sp:pr-reviewing (this skill — mode routing, triage, fix, rules)
      │  deterministic spine, state order + guards:
      ▼
.spur/workflows/pr-review.yaml ← workflow SSOT (seeded by spur init; project-tunable)
      │  every state resolves with `superskill script path` and shells out to:
      ▼
staged pr-reviewing.ts         ← Bun entrypoint for the tested git/gh core
```

- **State order and guards** are defined once, in the workflow YAML. Do not re-derive them in
  prose; when the YAML and this file disagree, the YAML wins and this file gets fixed.
- **Deterministic work** (every git/gh call) goes through the script subcommands — never
  hand-rolled `gh` invocations that drift from the tested core.
- **Model-bearing work** (finding triage, `fix` edits, `rules` authoring) is this skill's job and
  never enters the workflow machine.
- The workflow YAML exposes only its declared spine modes (`full`, `submit`, and `rerun`). The
  direct-mode routes below own `collect`, `fix`, `status`, and `rules`; keep those modes outside
  the workflow `mode` variable.

## Non-negotiable Codex routing

The external review MUST go through the GitHub pull request and an `@codex review` request.
Never substitute a local Codex review mechanism — no Codex CLI `/review`, no `codex review`, no
vendor-specific local review commands. If GitHub Codex Code Review is unavailable, stop and report
the setup/access problem; never silently fall back to a local review.

Never claim a request consumed a specific billing/quota bucket unless the platform exposes that
fact. The guarantee of this workflow is the route: GitHub Codex Code Review on the PR.

## Modes and routing

Parse the first positional argument as the mode; default `full`.

| Mode | Route | Behavior |
| --- | --- | --- |
| `full` | Workflow YAML | Preflight → hygiene → precheck → push → ensure-pr → request (reviewed/in-flight HEAD dedupe) → wait → collect → report. No source edits. |
| `submit` | Workflow YAML | Run the spine through `request`; return pending for a new request (`--no-wait` has the same effect). If the exact current HEAD was already reviewed, collect that result instead of requesting a duplicate. |
| `rerun` | Workflow YAML | Run the spine and request a fresh review of the current pushed HEAD with `--force`. No source edits. |
| `collect` | Direct script | Do not start the workflow or request a review. Collect the current PR's result and composite status; a missing current-HEAD result is **pending**, never clean. |
| `fix` | Direct script + model work | Collect first, independently validate current-HEAD findings, fix legitimate issues, verify, make one focused commit, push, then force-request/review/collect the new HEAD. Do not pass `mode=fix` to the workflow. |
| `status` | Direct script | Read-only composite: repository, branch, local HEAD, PR/base, local changes, CI, and Codex state for the current PR HEAD. Do not start the workflow. |
| `rules` | Model work only | Create or improve the repo-root `AGENTS.md` section `## Code Review Rules`; do not invoke the workflow, request a review, commit, or push. |

## Arguments

- `--base <branch>` — base for a newly created PR. Default: existing PR's base, else repo default.
- `--no-wait` — after a successful request, return pending instead of polling.
- `--agent <inline|auto|name>` — names **who performs model-bearing work**, per the
  [inline-default execution-surface contract](../spur-dev/references/cross-cutting.md#inline-default-execution-surface).
  Omit: the current agent is the default owner (eligible model stages may use one native subagent
  under the shared contract). `inline` keeps all model work in the host session as the hard
  zero-dispatch guarantee. `auto` resolves the command's declared role; a named executor pins that executor.
  An alternate executor gets one `spur agent run --agent <value>` dispatch with the selector removed
  from child args; that child owns model work. Current-agent selection stays inline.
  Headless surfaces reject explicit `inline` with the shared stable error.
- `--agent` describes the model owner only; it is independent of the deterministic git/GitHub spine
  and the workflow/direct route. Run the selected route in that resolved skill context. A separate
  workflow subprocess belongs to the caller's execution surface or an objective trigger (for example,
  a required durable run record), not to `--agent auto` or a name by itself.
- Remaining free text — extra review focus, appended to the Codex request without weakening
  repository-defined rules (e.g. `security and authorization boundaries`, `migration safety`).

## Safety rules

**Git history — never:** force-push (`--force`/`--force-with-lease`), destructive `git reset`,
`git clean`, rewriting published history, merging the PR, deleting branches, discarding unrelated
user changes.

**Local changes.** A GitHub PR only reviews pushed commits. If relevant changes are uncommitted:
inspect the tree, separate relevant from unrelated, never `git add .` blindly, and ask the user
before creating any commit outside `fix` mode. If safe separation is ambiguous, stop and explain.
In `fix` mode the user pre-authorized one focused fix commit for verified findings — still stop if
unrelated uncommitted changes make safe editing or committing ambiguous.

**Current-HEAD invariant.** Treat the PR's pushed `headRefOid` as the review identity. After every
preflight, push, commit, and request, record the returned HEAD and require `wait`, `collect`, and
the report to match that exact HEAD. A result for an older commit is stale; a result absent for the
current HEAD is pending, not clean. Reject uncorrelated issue/conversation comments rather than
using them to manufacture a current-HEAD result. In `fix` mode, discard the old result after the
fix commit and judge only the forced re-review for the new pushed HEAD.

**Reviewer authority.** Codex is an independent reviewer, not an authority. For every finding that
may lead to a code change: inspect the referenced code, verify reachability and intended behavior,
inspect callers/callees where needed, check existing tests, classify, reject false positives, fix
root causes rather than wording, prefer the smallest coherent patch, avoid drive-by refactors.

## Workflow-backed spine (`full`, `submit`, `rerun`)

Run the workflow YAML's declared states in order. Every deterministic state invokes the
staged entrypoint below, supports `--json`, and must be parsed. Stop at the first red gate and
report its artifact. The canonical installed invocation is:

```sh
bun "$(superskill script path sp pr-reviewing.ts)" <subcommand> [flags]
```

Installed targets resolve the staged TypeScript source and execute it with Bun, matching the rest
of `plugins/sp/scripts`.

1. **Preflight** — `<script> preflight --json`. Hard-fails on a
   detached HEAD, missing `gh` auth, no GitHub remote, or a dirty tree. On a dirty tree, triage
   with the user (commit/stash/exclude) before continuing — the workflow refuses to guess.
2. **Hygiene** — `<script> hygiene --base "$base" --json`. `BLOCK` (secrets, `.env`, conflict markers,
   private keys) stops the run — never submit a tainted diff. `WARN` (debug residue) rides along
   into the report. This is a submission sanity check, not a second local review.
3. **Precheck** — if the workflow YAML's `preReviewCmd` var is set, run it; a red check stops the
   run (do not spend a review request on code that fails its own gate). When unset, report that
   pre-review verification was not configured rather than inventing project commands.
4. **Push** — `<script> push --json`. Normal push only; sets upstream when missing.
5. **Ensure PR** — `<script> ensure-pr --base "$base" --json`. Reuses the branch's PR; creates with
   `gh pr create --fill` only when absent. Never a duplicate PR.
6. **Request** — `<script> request --focus "<focus>" --json` (`--force` in `rerun` mode). Dedupes when
   Codex already reviewed the exact pushed HEAD (`ALREADY_REVIEWED` → skip to collect) or a marked
   request by the current GitHub user is still in flight (`ALREADY_REQUESTED` → pending). The
   request body is concise when the repo has `## Code Review Rules`, else carries the default
   actionable-issues focus. Records PR, URL, HEAD, and request time.
7. **Wait** (full/rerun unless `--no-wait`; submit stops before it) —
   `<script> wait --since "$requestedAt" --head "$requestHead" --json`, using the request result so
   a fast response is not missed, `rerun` cannot reuse the prior review, and a moved HEAD fails loud.
   Polls every ~30s for up to
   ~10 minutes across the current HEAD's PR review and inline comments. Uncorrelated conversation
   comments are ignored. A current-HEAD clean review is a completed `CLEAN` outcome; findings are
   `FOUND`; timeout or no current-HEAD result is **pending, not failed** — collect later.
8. **Collect** — `<script> collect --since "$requestedAt" --head "$requestHead" --json`. Normalize
   only the requested HEAD and request window; then invoke `status` with the same bounds for
   PR/base/CI/local state. Never turn an absent, stale, or moved-HEAD result into `clean`.

## Fix mode

Only in `fix` mode:

1. **Collect before editing.** Invoke direct `collect --json` plus `status --json` and require a
   completed result for the current pushed HEAD. If the result is pending, stale, or unavailable,
   report it and stop without source edits. If it is explicitly clean, report no fixes and stop.
2. **Validate each finding.** Open the referenced code; trace callers/callees; verify the problem
   is reachable; check intended behavior and existing tests. Classify: `Confirmed`,
   `Likely valid`, `Needs investigation`, `Likely false positive`. Never edit for a likely false
   positive; investigate further before editing a `Needs investigation`.
3. **Fix legitimate issues** with the smallest coherent change. Preserve existing interfaces
   unless the defect requires otherwise; no unrelated refactoring; add or update tests when they
   materially demonstrate the fix; follow repository conventions. Inspect `git diff` — the patch
   must contain only intended review fixes.
4. **Verify** with repository-defined targeted tests/type checks/linters. Never claim a check
   passed unless it actually ran successfully.
5. **Commit** one focused review-fix commit. The message describes the actual defect
   (`fix: prevent duplicate transaction retry`), never `fix codex comments`. No unrelated files.
6. **Push** normally to the existing PR branch (never force), record the new HEAD, and discard the
   previous review identity.
7. **Re-review:** invoke the staged `request --force`, then wait/collect as usual. The new review
   must correspond to the new pushed HEAD — never present stale findings from the previous HEAD as
   the new result. Include composite CI/status fields in the final report.

## Rules mode

Only in `rules` mode. Inspect the architecture, existing instructions, and current root
`AGENTS.md`, then create or improve a section named exactly `## Code Review Rules`, preserving
unrelated content. Prefer repository-specific invariants over generic advice, using only categories
that matter to the project: data safety (atomic multi-step writes, idempotency, transaction
boundaries), security (server-side authorization, untrusted client identifiers, secrets in logs),
API compatibility (public contracts, CLI, serialized formats, event payloads, schema), concurrency
(races, stale writes, retry semantics), migration safety (backward-compatible rollout,
mixed-version operation), tests (which high-risk changes require regression coverage), and project
invariants a reviewer unfamiliar with the codebase could miss. Avoid generic advice (`write clean
code`) and anything lint/format already enforces mechanically. Keep it concise and actionable.
Show the diff, summarize the meaningful rules added, and do not commit or push.

## Reporting

Findings report:

```text
PR
  #<number> <url>

HEAD
  <short SHA>

Codex review
  Clean | Findings | Pending | Unavailable

Findings

1. [severity] path:line
   Classification: Confirmed | Likely valid | Needs investigation | Likely false positive
   Problem:
   Why it matters:
   Evidence:
   Recommended next action:

CI
  <status summary>
```

Preserve filenames, line references, severity, and the important technical reasoning. Do not
inflate suggestions into confirmed bugs. If the review completed without actionable findings, say
so clearly.

`wait` and `collect` must distinguish an explicit current-HEAD clean result from pending, stale, or
unavailable data. `collect` and `fix` reports also include the composite PR/base/branch/HEAD/local/CI
status; an unavailable CI signal remains `unavailable`, never an inferred pass.

Always end with the compact summary:

```text
PR:        <number + URL | none>
Branch:    <branch>
HEAD:      <short SHA>
Base:      <base>
CI:        <status>
Codex:     clean | findings | pending | not requested | unavailable
Findings:  <count>
```

`fix` mode appends: `Fixed: <n>`, `Rejected: <n>`, `New HEAD: <sha>`,
`Re-review: clean | findings | pending | unavailable`. If findings remain, state the recommended
next action.

`status` mode prints the same summary block and nothing else — no file edits, PR creation, pushes,
or review requests.

## Failure handling

- **`gh` missing or unauthenticated** — stop and report; do not switch to browser automation.
- **GitHub Codex unavailable** (not enabled/authorized for the repo) — preserve the error, explain
  the required repository/account setup, do not fall back to local Codex.
- **PR creation failure** — report the actual git/GitHub state; never rewrite history as a
  workaround.
- **Review timeout** — return `pending`, not `failed`, unless GitHub explicitly reports a failure.
- **CI failure** — Codex review and CI are independent signals; always surface failing checks even
  when Codex reports clean.

## Platform notes

- The skill, command, workflow YAML, and script are platform-neutral; per-platform emission is
  owned by superskill. On platforms without a Skill tool, read this file and follow the protocol
  manually — the script subcommands are plain CLI invocations.
- Prerequisites on any platform: `git`, GitHub CLI (`gh`) authenticated, and GitHub Codex Code
  Review enabled for the repository.

## Additional Resources

- **Workflow SSOT:** `.spur/workflows/pr-review.yaml` (seeded by `spur init`; tune per project —
  wait budget, `preReviewCmd`, dedupe policy)
- **Script source:** [scripts/pr-reviewing.ts](../../scripts/pr-reviewing.ts) — subcommand CLI
- **Tests:** [tests/pr-reviewing.test.ts](../../tests/pr-reviewing.test.ts) — stubbed git/gh suites
- **Related skills:** `sp:code-verification` (local SECUA review), `sp:functional-review`
  (requirements traceability) — complements, never substitutes, the independent Codex review
