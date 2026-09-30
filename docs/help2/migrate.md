# spur self migrate

Apply Spur's CLI-owned schema migrations to the project database (`.spur/spur.db`).

> **Canonical path:** `spur self migrate`. The legacy `spur migrate` top-level form remains a hidden alias.

## Usage

```bash
spur self migrate [--json]
spur self migrate [--json-envelope]
```

## Options

| Flag | Description |
| --- | --- |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## Behavior

`spur self migrate` brings the SQLite schema to the current version — it is idempotent, so running it
again on an up-to-date database is a no-op. Run it once after upgrading Spur; it is not part of
the daily loop.

```bash
spur self migrate
spur self status    # confirm the project still reports healthy
```

## See also

- [maintain](./maintain.md) — database upkeep
- [Getting started](./getting-started.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: migrate.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
