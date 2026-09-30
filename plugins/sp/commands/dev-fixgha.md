---
description: Find and fix failing GitHub Actions runs — gh fetch → diagnose → root-cause fix → commit → push → re-verify until green
role: coder
argument-hint: "[<context>] [--max-retry <n>] [--no-push]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# Dev Fixgha

Self-contained all-in-one GitHub Actions repair loop (no backing skill): fetch failing runs with
`gh`, diagnose each from its failed-step log, fix the root cause locally, commit, push, and watch the
new runs — repeating until every in-scope workflow is green. Invoking this command is the operator's
explicit request to edit `.github/workflows/` when the root cause lives there.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<context>` | Free-text context and/or search filter: a workflow name or file, run ID/URL, PR number, branch, job/step name, or a hint about the failure. Narrows which runs are in scope and seeds the diagnosis. | latest failing run per workflow on the current branch |
| `--max-retry <n>` | Max fix → push → verify iterations before stopping with the remaining failures. | 3 |
| `--no-push` | Fix and commit locally but do not push or re-verify on GitHub. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-fixgha [<context>] [--max-retry <n>] [--no-push]

## Implementation

Execute the stages below in order. Parse `gh` output with `--json` / `--jq`; never scrape tables.
A stage that cannot succeed after `--max-retry` iterations stops the run with the specific failing
output — do not silently skip a real failure.

**1 — Preflight.** `gh auth status` must pass (otherwise stop and tell the operator to run
`! gh auth login`). Resolve the repo (`gh repo view --json nameWithOwner`), the current branch, and
`HEAD`. The working tree must be clean of unrelated changes (one writer per tree) — if it is not,
stop and report instead of mixing them into CI-fix commits.

**2 — Collect failing runs.** Build the in-scope set from `<context>`:

- run ID / URL → that run (`gh run view <id> --json databaseId,workflowName,headBranch,headSha,conclusion,jobs,url`);
- PR number → `gh pr checks <n> --json name,state,link,workflow` (failed checks only);
- workflow name/file → `gh run list --workflow <wf> --branch <branch> --limit 10 --json databaseId,workflowName,headSha,status,conclusion,event,url`;
- otherwise → `gh run list --branch <branch> --limit 30 --json …` and keep the **latest** run per
  workflow whose `conclusion` is `failure`, `startup_failure`, or `timed_out`. An older failure
  already superseded by a green run of the same workflow is out of scope.

Free text that is not an identifier narrows by workflow/job/step name and is carried into diagnosis.
If `actionlint` is on `PATH`, also run it over `.github/workflows/` and add its findings as
static issues. Nothing failing and no static findings → report "all GitHub Actions green" and stop.

**3 — Diagnose each failure.** Pull only the failing output: `gh run view <id> --log-failed`
(bounded — keep the tail around the first error per failed step, not the whole log). Classify:

| Class | Signal | Action |
| --- | --- | --- |
| Code | test / lint / typecheck / build error | Reproduce locally with the failing step's command, then fix the source. |
| Workflow | YAML / expression error, bad action ref or deprecated version, missing `permissions`, wrong runner/tool version, cache/path mismatch | Fix the workflow file minimally. |
| Environment | CI-only behavior (OS, root vs non-root, missing binary, timezone, case-sensitive FS) | Fix the code or workflow so both environments are correct — never weaken a correct test. |
| Transient | network/registry timeout, runner outage, rate limit, no code/workflow cause | `gh run rerun <id> --failed` once; if it fails again, reclassify. |
| External | missing/expired secret, repo setting, billing, third-party outage | Cannot be fixed from the tree — record and report for the operator. |

**4 — Fix.** Root cause only, surgical diff. Forbidden shortcuts: `continue-on-error`, `if: false`,
deleting or skipping jobs/steps/tests, loosening thresholds, `--no-verify`, force-push, and any edit
to secrets. After fixing, run the local quality gate (`bun run check`, or the project's equivalent);
if red, run `/sp:dev-fixall "<gate-command>"` before continuing.

**5 — Commit.** Follow the gitmsg procedure in
[dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) to produce one
conventional commit per iteration (typically `fix(ci): …` for workflow changes, or the owning
`fix(<scope>): …` for code), whose body names the run IDs it addresses. Commit with the
repository's hooks enabled.

**6 — Push and re-verify.** Skip when `--no-push` (report the commits and stop). Otherwise
`git push` (set upstream if missing; on rejection, pull `--rebase` then retry — never force). Find
the runs for the pushed SHA (`gh run list --commit <sha> --json databaseId,workflowName,status,conclusion`;
poll briefly — runs can take a few seconds to appear), then `gh run watch <id> --exit-status` for
each in-scope workflow. Any new failure feeds back into stage 3. Stop when all in-scope workflows
are green or `--max-retry` iterations are spent.

**7 — Report.** One table: workflow · run ID · class · root cause · fix (`path:line`) · commit ·
final status. List External/unfixed items separately with the exact operator action required.
