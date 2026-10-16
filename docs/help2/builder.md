# spur builder

Release plumbing: version bumps, release tags, npm publish, the four flat PR-review verbs, and read-only branch topology.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `bump-ver [target] [version]` | Bump a package version, commit, tag, optionally push |
| `drop-tags [target] [version]` | Delete release tags locally and optionally on origin |
| `publish <dir> [--otp code]` | Resolve workspace/catalog ranges, build, and `npm publish` a package (CI) |
| `show-branches [flags]` | Read-only branch topology report against a base |
| `pr-check [flags]` | Submission gate: preflight then hygiene (`PASS` / `WARN` / `BLOCK` / `FAIL`) |
| `pr-open [flags]` | Publish the branch and reuse or create its PR (`FOUND` / `CREATED` / `FAIL`) |
| `pr-review [flags]` | Request the GitHub Codex review and collect it (`CLEAN` / `FINDINGS` / `PENDING` / `FAIL`) |
| `pr-status [flags]` | Read-only PR/CI/Codex status with the current-HEAD review as `review` |

## spur builder bump-ver

```bash
spur builder bump-ver [target] [version] [--all] [--push] [--json]
```

Bump one workspace package (or every released package with `--all`), rewrite workspace pins,
commit, and tag:

```bash
spur builder bump-ver 0.1.4          # every released package (bare version = bump all)
spur builder bump-ver spur 0.1.4     # one package by id
spur builder bump-ver --all --push   # per-package + aggregate tags, push to origin
```

> `--push` publishes the branch **and** the release tag to origin — treat it as the irreversible
> step and keep it out of scripted loops unless you mean it.

## spur builder drop-tags

```bash
spur builder drop-tags [target] [version] [--all] [--remote] [--json]
```

Delete release tags locally (`--remote` also deletes them on origin) — the cleanup twin of
`bump-ver` for a botched release. `--all` drops every released tag plus the aggregate tag.

## spur builder publish

```bash
spur builder publish <dir> [--otp <code>]
spur builder bump-ver --check [target]
```

`publish` is the CI publish step (npm Trusted Publishing): it rewrites `workspace:`/`catalog:`
ranges in `<dir>/package.json`, runs `bun run build:bundle`, `npm publish --access public`, and
restores the manifest on every exit path. `bump-ver --check` is the read-only pre-publish guard
(`prepublishOnly`): exit `1` when `.claude-plugin/marketplace.json` or a listed `plugin.json`
drifted from the package version.

## spur builder show-branches

```bash
spur builder show-branches [--format markdown|json|text] [--base <ref>] [--local|--remote] [--pr] [--limit <n>] [--max-commits <n>] [--hide-contained] [--theme <name>] [--json]
```

Read-only branch topology against a base (`--base`, else the `origin/HEAD` target, else `main`):
one row per branch with its fork point, commits ahead/behind, whether it is fully contained in the
base, its last commit, and the worktree holding it.

`--format markdown` (the default) prints a summary table plus one condensed mermaid `gitGraph`;
`--format json` prints the raw report (`--json` is its alias) and `--format text` the aligned
table. `--local` / `--remote` restrict the ref namespace, `--limit <n>` (default 30) caps the rows
by most recent commit, and `--max-commits <n>` (default 3) caps the commit nodes per branch line in
the graph; `--hide-contained` drops contained branches from the graph and `--theme <name>` selects
the mermaid theme.

> `--pr` adds open pull-request state from a single `gh pr list` call; a missing or unauthenticated
> `gh` leaves those fields empty with one warning instead of failing the report.

Exit codes: `0` ok, `1` usage (bad `--format`/`--limit`/`--max-commits`, unknown base ref, `--local`
with `--remote`), `2` git failure.

## spur builder pr-status

```bash
spur builder pr-status [--since <iso>] [--head <sha>] [--json] [--status-file <path>]
```

Read-only composition of the PR status and collect operations: repository, branch, PR/base, local
changes, CI and Codex state, plus `review` — the current-HEAD Codex record when the branch has a PR,
else `null`. `--head` defaults to the current local HEAD and, when supplied, is a strict pin: a head
that no longer matches the PR head fails loud instead of attributing a review to a moved commit. A
status probe is not a gate, so no verdict is written.

```bash
spur builder pr-status --json                     # composite status + .review
spur builder pr-status --head "$(git rev-parse HEAD)" --json
```

Exit codes: `0` ok, `2` probe failure.

## spur builder pr-check

```bash
spur builder pr-check [--base <branch>] [--scan-only] [--json] [--status-file <path>]
```

Submission gate: preflight (git/gh/repo checks, detached HEAD, dirty tree, base-branch refusal) then
the hygiene scan of `base...HEAD` for secrets, `.env` files and conflict markers (`BLOCK`; debug
residue only `WARN`s). A preflight failure stops before hygiene.

```bash
spur builder pr-check --base main --json --status-file .spur/run/check.status
spur builder pr-check --scan-only --json           # hygiene alone (a dirty tree is expected)
```

Exit codes: `0` ok, `2` BLOCK / preflight failure / probe failure.

## spur builder pr-open

```bash
spur builder pr-open [--base <branch>] [--json] [--status-file <path>]
```

Publish the branch (normal push only — never force; sets upstream when missing), then reuse the
branch's PR or create one with `gh pr create --fill`. A rejected push stops before any PR work.

```bash
spur builder pr-open --base main --json --status-file .spur/run/open.status
```

Exit codes: `0` ok (`FOUND`/`CREATED`), `2` push rejected or ensure failed (`FAIL`).

## spur builder pr-review

```bash
spur builder pr-review [--force] [--focus <text>] [--no-wait] [--timeout <s>] [--interval <s>] [--json] [--status-file <path>]
```

Post the `@codex review` request (per-HEAD dedupe unless `--force`), poll for the result, then collect
it. An already-reviewed HEAD is collected without a new request; an in-flight request or `--no-wait`
returns `PENDING` right away.

```bash
spur builder pr-review --focus "migration safety" --json     # request → wait → collect
spur builder pr-review --no-wait --json                        # post and return PENDING
spur builder pr-review --force --json                           # mode=rerun: force a fresh review
```

Exit codes: `0` ok, `1` usage, `2` hard failure, `3` wait timeout (verdict `PENDING` — pending, never
failure; collect later with `pr-status`).

## Deprecated alias: `spur builder pr <op>`

Still registered for one release, hidden from `spur builder --help`: it prints one stderr deprecation
line naming the replacement verb, then runs the unchanged pass-through. `preflight`/`hygiene` →
`pr-check`, `push`/`ensure` → `pr-open`, `request`/`wait` → `pr-review`, `collect`/`status` →
`pr-status`.

## See also

- [Daily development workflow](./daily-development-workflow.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: builder.txt + verbs/builder_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
