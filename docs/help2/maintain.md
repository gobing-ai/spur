# spur maintain

Database maintenance for `.spur/spur.db`: routine optimization and optional compaction.

## Usage

```bash
spur maintain [options]
```

## Options

| Flag | Description |
| --- | --- |
| `--vacuum` | Run VACUUM defragmentation and page compaction |
| `--json` | Output machine-readable JSON where supported |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## Behavior

A bare `spur maintain` runs the safe, always-applicable upkeep: `PRAGMA optimize` and a WAL
checkpoint with truncation. Add `--vacuum` to also rewrite the database file for compaction.

> **When:** run the bare form occasionally (it is cheap and safe); reach for `--vacuum` after
> large deletions or when the database file has grown well beyond its live content. VACUUM
> rewrites the file — run it when no other spur process is writing.

## See also

- [Getting started](./getting-started.md)
- [migrate](./migrate.md) — schema migrations

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: maintain.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
