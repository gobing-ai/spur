---
name: spur-cli-builder
description: "spur-cli noun reference: operate `spur builder` as the release plumbing surface - bump a workspace package (or the `workspace:`-pinned release set) with `bump-ver`, delete release tags with `drop-tags`, with commit + annotated tag + optional push; publish a package to npm with `publish` (and guard version drift with `bump-ver --check`); run the `/sp:dev-pr-review` PR loop with the four flat verbs `pr-status` (read-only status), `pr-check` (submission gate), `pr-open` (push + ensure PR) and `pr-review` (Codex request + wait + collect); report base-relative branch topology with `show-branches`. Promoted from spur-dev (task 0617, ADR-051); frozen at exactly these eight verbs."
see_also:
  - spur-cli
---

# spur builder - release plumbing

`spur builder` is the CLI for **version bumps and release tags**, plus the PR-review loop and the
read-only branch report. It wraps the internal
`release-ops` implementation behind a public eight-verb surface. The repo-local forwarder
(`scripts/commands/release.ts`) and its `spur-dev` dispatcher cases were retired in task 1173; the
root `bun run bump-ver` / `bun run drop-tags` names route to `spur builder` directly. Package ids are
the unscoped short names (`@gobing-ai/spur` → `spur`); the released set and the aggregate tag are
discovered from the repo's own workspace manifests, so the same code serves any git+semver
monorepo.

This noun is **frozen at exactly eight verbs** (`bump-ver`, `drop-tags`, `publish` from the 2026-10-15
script-absorption entries; `show-branches` and the four flat PR verbs `pr-status`, `pr-check`,
`pr-open`, `pr-review` from the 2026-10-16 feature-L1 entries) by operator consent
(`docs/design/harness-surface-governance.md` §3) — do not invent additional `builder` subcommands.
The former `pr <op>` pass-through stays registered as a **hidden, deprecated alias** for one release
(it prints one stderr deprecation line naming the replacement verb), so it is not listed here.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `bump-ver [package-id] [version]` | Bump one package (manifest + in-source `binaryVersion` + consumer `workspace:` pins), commit, tag, optionally push; `--check [package-id]` only verifies marketplace/plugin versions (exit 1 on drift) | `--all` `--push` `--check` `--json` |
| `drop-tags [package-id] <version>` | Delete a package's release tag (local only by default) | `--all` `--remote` `--json` |
| `publish <dir>` | CI npm publish: resolve `workspace:`/`catalog:` ranges, `build:bundle`, `npm publish --access public`, restore the manifest | `--otp` |
| `pr-check [--base <branch>] [--scan-only]` | Submission gate for `/sp:dev-pr-review`: preflight then the `base...HEAD` hygiene scan; a preflight failure stops before hygiene (`PASS`/`WARN`/`BLOCK`/`FAIL`) | `--base` `--scan-only` `--json` `--status-file` |
| `pr-open [--base <branch>]` | Publish the branch (never force) and reuse or create its PR (`FOUND`/`CREATED`/`FAIL`) | `--base` `--json` `--status-file` |
| `pr-review [--force] [--focus <text>] [--no-wait]` | Post the `@codex review` request, wait, then collect (`CLEAN`/`FINDINGS`/`PENDING`/`FAIL`; exit 3 = pending) | `--force` `--focus` `--no-wait` `--timeout` `--interval` `--json` `--status-file` |
| `pr-status [--since <iso>] [--head <sha>]` | Read-only PR/CI/Codex status with the current-HEAD review as `review` (no verdict) | `--since` `--head` `--json` `--status-file` |
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

## `pr-status`, `pr-check`, `pr-open`, `pr-review` - the PR-review loop

```bash
spur builder pr-status --json                          # read-only composite status + .review
spur builder pr-check --base main --json               # preflight + hygiene submission gate
spur builder pr-check --scan-only --json               # hygiene alone (local review on a dirty tree)
spur builder pr-open --base main --json                # push, then reuse or create the PR
spur builder pr-review --focus "migration safety" --json   # request → wait → collect
spur builder pr-review --no-wait --json                # post the request, return PENDING
spur builder pr-review --force --json                  # force a fresh review of the current HEAD
```

Four flat verbs over the ops absorbed from `plugins/sp/scripts/pr-reviewing.ts` (script-absorption
PR-7); driven by the `pr-review` workflow. Each composes existing ops and embeds their records in
one JSON object per verb: `pr-status` → the status object plus `review` (collect, or `null` with no
PR); `pr-check` → `{ ok, verdict, preflight, hygiene }`; `pr-open` → `{ ok, verdict, push, pr }`;
`pr-review` → `{ ok, verdict, request, findings }`.

- **`--status-file`** holds the verb's one-word verdict: `PASS`/`WARN`/`BLOCK`/`FAIL` (`pr-check`),
  `FOUND`/`CREATED`/`FAIL` (`pr-open`), `CLEAN`/`FINDINGS`/`PENDING`/`FAIL` (`pr-review`).
  `pr-status` is read-only and writes none.
- **Exit codes:** `0` ok, `1` usage, `2` hard failure, `3` wait timeout — exit 3 is `PENDING`
  (pending, never failure; collect later with `pr-status`).
- **`--head`:** `pr-status` pins the reviewed commit; it defaults to the current local HEAD, and an
  explicit pin that no longer matches the PR head fails loud instead of reporting a moved commit.
- **Deduping:** `pr-review` collects without a new request when the exact HEAD is already reviewed,
  and returns `PENDING` when a marked request is still in flight; `--force` requests a fresh review
  (`mode=rerun`). Never force-pushes.

```bash
# deprecated alias, one release: maps the old op names to the verbs above
spur builder pr preflight --json     # -> spur builder pr-check
spur builder pr status --json        # -> spur builder pr-status
```

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
