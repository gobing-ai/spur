# spur builder

Release plumbing: version bumps and release tags. Two verbs, both guard-railed.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `bump-ver [target] [version]` | Bump a package version, commit, tag, optionally push |
| `drop-tags [target] [version]` | Delete release tags locally and optionally on origin |

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

## See also

- [Daily development workflow](./daily-development-workflow.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: builder.txt + verbs/builder_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
