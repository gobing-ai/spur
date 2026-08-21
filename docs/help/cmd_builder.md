# spur builder

> Release plumbing for the package workspace: bump one package (or the `workspace:`-pinned
> release set), commit, tag, and optionally push. Promoted from the internal `spur-dev release`
> script (task 0617, ADR-051); `scripts/commands/release.ts` is now a thin forwarder to the same
> implementation. The noun is **frozen at these two verbs** — future promotions from `spur-dev`
> land as new nouns only with their own justification
> (`docs/design/harness-surface-governance.md` §3).

## Subcommands

| Subcommand | Description |
|---|---|
| `bump-ver <package-id> <version>` | Bump one package: manifest + in-source `binaryVersion`, commit, annotated tag |
| `bump-ver --all <version>` | Bump every `workspace:`-pinned package, plus aggregate publish tag |
| `drop-tags <package-id> <version>` | Delete one package's local release tag |
| `drop-tags --all <version>` | Delete all local per-package + aggregate release tags |

## spur builder bump-ver

```
spur builder bump-ver [options] <package-id|--all> <version>
```

| Argument | Description |
|---|---|
| `package-id` | Unscoped short name (`@gobing-ai/spur` → `spur`); omit with `--all` |
| `version` | Target semver (e.g. `0.2.0`) |

| Option | Description |
|---|---|
| `--all` | Bump the whole released set instead of one package |
| `--push` | Also push the branch and the release tag to `origin` |

Behavior: rewrites the manifest version (and `workspace:` pins of consumers, plus the
`binaryVersion` literal in `src/config.ts` when present), stages `bun.lock` when non-empty,
commits `chore(release): bump <pkg> to <version>`, and creates an annotated tag
`<pkg>-v<version>`. `--all` adds per-package trace tags plus the aggregate
`@<scope>/<root>-v<version>` publish tag. Aborts with exit 1 on invalid semver, an unknown
package id, a dirty tree, a detached HEAD, or an existing local/origin tag.

## spur builder drop-tags

```
spur builder drop-tags [options] <package-id|--all> <version>
```

| Option | Description |
|---|---|
| `--all` | Drop the whole released set's tags (per-package + aggregate) |
| `--remote` | Also delete the tag(s) on `origin` |

No-ops gracefully when a local or remote tag is already absent.
