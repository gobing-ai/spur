---
name: spur-cli-builder
description: "spur-cli noun reference: operate `spur builder` as the release plumbing surface - bump a workspace package (or the `workspace:`-pinned release set) with `bump-ver`, delete release tags with `drop-tags`, with commit + annotated tag + optional push; publish a package to npm with `publish` (and guard version drift with `bump-ver --check`); run the `/sp:dev-pr-review` spine ops with `pr`. Promoted from spur-dev (task 0617, ADR-051); frozen at exactly these four verbs."
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

This noun is **frozen at exactly four verbs** (`bump-ver`, `drop-tags`, plus `pr` and `publish` from the 2026-10-15 script-absorption entries) by operator consent (`docs/design/harness-surface-governance.md`
§3) — do not invent additional `builder` subcommands.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `bump-ver [package-id] [version]` | Bump one package (manifest + in-source `binaryVersion` + consumer `workspace:` pins), commit, tag, optionally push; `--check [package-id]` only verifies marketplace/plugin versions (exit 1 on drift) | `--all` `--push` `--check` `--json` |
| `drop-tags [package-id] <version>` | Delete a package's release tag (local only by default) | `--all` `--remote` `--json` |
| `publish <dir>` | CI npm publish: resolve `workspace:`/`catalog:` ranges, `build:bundle`, `npm publish --access public`, restore the manifest | `--otp` |
| `pr <op>` | PR-review spine ops for `/sp:dev-pr-review`: `preflight` `push` `ensure` `hygiene` `request` `wait` `collect` `status` | `--base` `--since` `--head` `--json` `--status-file` |

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
