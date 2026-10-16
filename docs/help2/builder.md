# spur builder

Release plumbing: version bumps, release tags, npm publish, PR-review spine ops, and read-only branch topology.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `bump-ver [target] [version]` | Bump a package version, commit, tag, optionally push |
| `drop-tags [target] [version]` | Delete release tags locally and optionally on origin |
| `publish <dir> [--otp code]` | Resolve workspace/catalog ranges, build, and `npm publish` a package (CI) |
| `show-branches [flags]` | Read-only branch topology report against a base |
| `pr <op> [flags]` | PR-review spine ops for `/sp:dev-pr-review` |

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

## spur builder pr

```bash
spur builder pr <preflight|push|ensure|hygiene|request|wait|collect|status> [--base b] [--since iso] [--head sha] [--json] [--status-file <path>]
```

The deterministic spine for `/sp:dev-pr-review`: preflight, push (never force), reuse-or-create
the PR, hygiene scan, request and wait for the Codex review, and a read-only composite `status`.
Exit `3` from `wait` means pending, not failed.

## See also

- [Daily development workflow](./daily-development-workflow.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: builder.txt + verbs/builder_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
