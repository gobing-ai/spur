---
description: Get things done — quality gate → fix → act CI simulation → commit → push → gh verify in one flow
argument-hint: "[<quality-gate-command>] [--dry-run] [--skip-act] [--no-push] [--no-verify] [--scope <path>] [--max-retry <n>]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# Dev GTD

Self-contained end-to-end delivery command: local quality gate (auto-fix via `/sp:dev-fixall`),
local CI/CD simulation via `act`, conventional commit message generation, commit, push, and
GitHub push-success verification via `gh`. Designed to stand alone (no backing skill); once mature
it supersedes `/sp:dev-gitmsg` and is absorbed into the shared command structure.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<quality-gate-command>` | Local quality gate to run first; on failure, invoke `/sp:dev-fixall "<cmd>"` to fix all issues automatically. | `bun run check` |
| `--dry-run` | Generate the git message and plan only — no commit, push, or gh verify. | off |
| `--skip-act` | Skip the local `act` CI/CD simulation step. | off |
| `--no-push` | Commit but do not git push or gh-verify. | off |
| `--no-verify` | Push but skip the `gh` push-success verification. | off |
| `--scope <path>` | Scope the commit-message diff analysis to a path. | all staged changes |
| `--max-retry <n>` | Max fix iterations per failing stage. | 3 |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-gtd [<quality-gate-command>] [--dry-run] [--skip-act] [--no-push] [--no-verify] [--scope <path>] [--max-retry <n>]

## Implementation

Execute the stages below in order. A stage that cannot succeed after `--max-retry` attempts stops
the run with the specific failing output — do not silently skip a real failure.

**1 — Local quality gate (auto-fix).** Resolve the gate command from the first positional argument,
default `bun run check`. Run it. If it exits non-zero, invoke `/sp:dev-fixall "<gate-command>"`
(pass through `--scope` and `--max-retry`) to fix all lint/type/test issues automatically, then
re-run the gate. Loop until the gate is clean or `--max-retry` is exhausted. Report what was fixed
per file.

**2 — Local CI/CD simulation via `act`.** Confirm Docker is running (`docker info`). On macOS the
repo uses OrbStack — if the default context is not ready, use
`DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`. Run
`act -W .github/workflows/ci.yml -j verify` (or the repo's `bun run verify-gha-ci`); prefer
`--container-architecture` matching your host when the runner pulls a foreign platform. If a step
fails, diagnose the root cause and fix it, then re-run `act` until every job is green. Note: `act`
executes the workflow inside a **root** container, so a test that asserts an OS permission error
(e.g. `EACCES` after `chmod 0000`) may fail under root even though it passes on GitHub's non-root
runner — treat that as a container-environment artifact and do **not** weaken a correct test to
satisfy the root container. Skip this stage entirely when `--skip-act` is given.

**3 — Generate a conventional commit message.** Follow the gitmsg procedure (the same one
`/sp:dev-gitmsg` runs). Run `git diff --cached --stat` (add `-- <path>` when `--scope` is given) for
the outline; if it is empty, stage the intended changes first and report "no staged changes" if
nothing was meant to be committed. Capture the full diff to a temp file
(`TEMP_FILE="/tmp/gitdiff_$(date +%s)"; git diff --cached > "$TEMP_FILE" 2>&1`). Read it and write
**one sentence per changed file** — what changed and why. Group the per-file sentences by concern;
for each group derive its commit type (`feat` · `fix` · `refactor` · `docs` · `chore` · `perf` ·
`test` · `style`), scope (affected module/package, or the `--scope` value), and message:

```
<type>(<scope>): <summary>

<body — optional bullets from the group's per-file sentences>
```

Summary: imperative mood, ≤72 chars, lowercase first word, no period. Body only when the change is
non-obvious. Resolve groups: one group → emit its message; multiple groups → emit one message per
group plus a split recommendation (stage per concern, re-run); under this all-in-one flow, prefer a
single combined message (dominant type/scope, per-file bullets) so the push is atomic. Delete the
temp file (`rm "$TEMP_FILE"`) — no `/tmp` diff residue.

**4 — Commit.** Stage all intended changes (`git add`) and commit with the resolved message
(`git commit -m "$MESSAGE"`). When `--dry-run`, print the message and the copy-paste `git commit` /
`git push` lines instead, then stop (skip stages 5–6).

**5 — Push.** `git push` to the remote (`origin`). On failure (rejected non-fast-forward, auth,
missing upstream), diagnose and fix — e.g. set the upstream (`git push -u origin <branch>`),
pull/rebase a stale remote, or re-authenticate — then retry until the push succeeds. Stop here when
`--no-push`.

**6 — Verify the push with `gh`.** `gh run list` (optionally `--branch <branch>`) to confirm the
pushed commit triggered a workflow run and that the latest run for the pushed HEAD is successful.
If the push did not trigger a run or the run is failing, diagnose and fix, then re-push and re-check
until the push is confirmed successful. Stop here when `--no-verify`.
