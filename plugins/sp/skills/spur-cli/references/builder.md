---
name: spur-cli-builder
description: "spur-cli noun reference: operate `spur builder` as the release plumbing surface - bump a workspace package (or the `workspace:`-pinned release set) with `bump-ver`, delete release tags with `drop-tags`, with commit + annotated tag + optional push; publish a package to npm with `publish` (and guard version drift with `bump-ver --check`); run the `/sp:dev-pr-review` spine ops with `pr`; report base-relative branch topology with `show-branches`. Promoted from spur-dev (task 0617, ADR-051); frozen at exactly these five verbs."
see_also:
  - spur-cli
---

# spur builder - release plumbing

`spur builder` is the CLI for **version bumps and release tags**. It wraps the internal
`release-ops` implementation behind a public four-verb surface. The repo-local forwarder
(`scripts/commands/release.ts`) and its `spur-dev` dispatcher cases were retired in task 1173; the
root `bun run bump-ver` / `bun run drop-tags` names route to `spur builder` directly. Package ids are
the unscoped short names (`@gobing-ai/spur` → `spur`); the released set and the aggregate tag are
discovered from the repo's own workspace manifests, so the same code serves any git+semver
monorepo.

This noun is **frozen at exactly five verbs** (`bump-ver`, `drop-tags`, plus `pr` and `publish` from the 2026-10-15 script-absorption entries and `show-branches` from the 2026-10-16 feature-L1 entry) by operator consent (`docs/design/harness-surface-governance.md`
§3) — do not invent additional `builder` subcommands.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `bump-ver [package-id] [version]` | Bump one package (manifest + in-source `binaryVersion` + consumer `workspace:` pins), commit, tag, optionally push; `--check [package-id]` only verifies marketplace/plugin versions (exit 1 on drift) | `--all` `--push` `--check` `--json` |
| `drop-tags [package-id] <version>` | Delete a package's release tag (local only by default) | `--all` `--remote` `--json` |
| `publish <dir>` | CI npm publish: resolve `workspace:`/`catalog:` ranges, `build:bundle`, `npm publish --access public`, restore the manifest | `--otp` |
| `pr <op>` | PR-review spine ops for `/sp:dev-pr-review`: `preflight` `push` `ensure` `hygiene` `request` `wait` `collect` `status` | `--base` `--since` `--head` `--json` `--status-file` |
| `show-branches` | Read-only branch topology report against a base (default `markdown` with a condensed mermaid `gitGraph`) | `--format` `--json` `--base` `--local` `--remote` `--pr` `--limit` `--max-commits` `--hide-contained` `--theme` |

A bare `bump-ver <version>` (single positional that parses as semver) or explicit `--all` bumps
every package pinned via `workspace:` by another workspace package, then adds per-package trace
tags plus the aggregate `@<scope>/<root>-v<version>` publish tag. `drop-tags --all` mirrors that
for deletion.

**Exit codes:** `0` success, `1` error (invalid semver, unknown package id, dirty tree, detached
HEAD, or an existing local/origin tag). Release preflight errors abort before mutation. `publish` temporarily rewrites dependency
ranges for packaging and restores the original manifest in `finally`, including build/publish
failures; npm publication itself is an external side effect.

## `bump-ver` - bump and tag a release

```bash
spur builder bump-ver --check               # aggregate marketplace/plugin version drift, read-only
spur builder bump-ver --check spur          # named package drift, read-only
spur builder bump-ver spur 0.1.4            # one package: manifest, pins, commit, tag @gobing-ai/spur-v0.1.4
spur builder bump-ver --all 0.1.4           # every workspace:-pinned package + aggregate tag
spur builder bump-ver --all 0.1.4 --push    # also push branch + tags to origin
```

`--check` accepts only an optional package id; it rejects a version argument and `--all`/`--push`.
Normal bump mode requires a version. `publish <dir> [--otp <code>]` builds and publishes the
package using native argv, then restores the original manifest on success or failure.

## `drop-tags` - delete release tags

```bash
spur builder drop-tags spur 0.1.4           # delete the local tag @gobing-ai/spur-v0.1.4
spur builder drop-tags --all 0.1.4 --remote # delete per-package + aggregate tags, locally and on origin
```

## `pr` - PR-review spine ops

```bash
spur builder pr preflight --json            # repo/gh checks
spur builder pr ensure --base main --json   # reuse or create the branch PR
spur builder pr wait --since "$t" --head "$sha" --json   # exit 3 = still pending
spur builder pr status --json               # read-only composite status
```

Absorbed from `plugins/sp/scripts/pr-reviewing.ts` (script-absorption PR-7); driven by
the `pr-review` workflow. Exit codes: `0` ok, `1` usage, `2` hard failure, `3` wait timeout.

## `show-branches` - read-only branch topology report

```bash
spur builder show-branches                      # markdown: summary table + condensed mermaid gitGraph
spur builder show-branches --base origin/main   # measure every branch against another base
spur builder show-branches --format json        # raw { base, generatedAt, branches[], omitted, warnings[] }
spur builder show-branches --pr --limit 50      # add open pull-request state, keep up to 50 rows
```

One row per branch — local, remote-only, or the detached HEAD by short sha — with the fork point,
commits ahead/behind the base, the contained flag (`ahead == 0`, i.e. everything in it is already in
the base), the last commit, and the worktree path that has it checked out. Base resolution is
`--base <ref>`, else the `origin/HEAD` target, else `main`. `--local` / `--remote` filter the ref
namespace (mutually exclusive), `--limit <n>` (default 30) caps rows by most recent commit and
reports the omitted count, and `--pr` adds the open pull-request number/state/review decision from a
single `gh pr list` call (a missing or unauthenticated `gh` degrades to null PR fields plus one
warning, never a failure).

| Flag | Description |
| ---- | ----------- |
| `--format <markdown\|json\|text>` | Output format; `markdown` is the default |
| `--json` | Alias of `--format json` |
| `--base <ref>` | Base ref (default: the `origin/HEAD` target, else `main`) |
| `--local` / `--remote` | Restrict to local or remote branches |
| `--pr` | Enrich rows with open pull-request state (one `gh pr list` call) |
| `--limit <n>` | Maximum branch rows (default 30) |
| `--max-commits <n>` | Maximum commit nodes per branch line in the graph (default 3) |
| `--hide-contained` | Drop contained branches from the graph instead of drawing their join |
| `--theme <name>` | Mermaid theme for the graph init directive |

The graph draws the base line, one `branch` per open branch, a `+N earlier` summary node for the
commits a cap hides, `HIGHLIGHT` tips, `REVERSE` reverts and the tag names of the commits it shows.
Read-only: it never creates, moves or deletes a ref, config entry, index entry or worktree.

The graph rules are `mermaid@11.15.0` HIGH, pinned at `apps/web/package.json:28` and asserted by
`apps/web/tests/branch-topology-graph.heavy.test.ts:155`. The `--pr` vocabulary is `gh@2.102.0` HIGH at
`https://cli.github.com/manual/gh_pr_list` (read 2026-10-16), measured against this repo's own PRs.

**Exit codes:** `0` ok, `1` usage (unknown `--format`, non-positive `--limit`/`--max-commits`,
unknown base ref, `--local` with `--remote`), `2` git failure (not a repository, `git` missing).
