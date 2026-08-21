---
name: spur-cli-builder
description: "spur-cli noun reference: operate `spur builder` as the release plumbing surface - bump a workspace package (or the `workspace:`-pinned release set) with `bump-ver`, delete release tags with `drop-tags`, with commit + annotated tag + optional push. Promoted from spur-dev (task 0617, ADR-051); frozen at exactly these two verbs."
see_also:
  - spur-cli
---

# spur builder - release plumbing

`spur builder` is the CLI for **version bumps and release tags**. It wraps the internal
`spur-dev release` flow behind a public two-verb surface, promoted verbatim from
`scripts/commands/release.ts` (now a thin forwarder to the same implementation). Package ids are
the unscoped short names (`@gobing-ai/spur` → `spur`); the released set and the aggregate tag are
discovered from the repo's own workspace manifests, so the same code serves any git+semver
monorepo.

This noun is **frozen at exactly two verbs** by operator consent (`docs/design/harness-surface-governance.md`
§3) — do not invent additional `builder` subcommands.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `bump-ver [package-id] <version>` | Bump one package (manifest + in-source `binaryVersion` + consumer `workspace:` pins), commit, tag, optionally push | `--all` `--push` `--json` |
| `drop-tags [package-id] <version>` | Delete a package's release tag (local only by default) | `--all` `--remote` `--json` |

A bare `bump-ver <version>` (single positional that parses as semver) or explicit `--all` bumps
every package pinned via `workspace:` by another workspace package, then adds per-package trace
tags plus the aggregate `@<scope>/<root>-v<version>` publish tag. `drop-tags --all` mirrors that
for deletion.

**Exit codes:** `0` success, `1` error (invalid semver, unknown package id, dirty tree, detached
HEAD, or an existing local/origin tag). **Errors abort before any write** — a re-run after fixing
the cause is safe.

## `bump-ver` - bump and tag a release

```bash
spur builder bump-ver spur 0.1.4            # one package: manifest, pins, commit, tag @gobing-ai/spur-v0.1.4
spur builder bump-ver --all 0.1.4           # every workspace:-pinned package + aggregate tag
spur builder bump-ver --all 0.1.4 --push    # also push branch + tags to origin
```

## `drop-tags` - delete release tags

```bash
spur builder drop-tags spur 0.1.4           # delete the local tag @gobing-ai/spur-v0.1.4
spur builder drop-tags --all 0.1.4 --remote # delete per-package + aggregate tags, locally and on origin
```
