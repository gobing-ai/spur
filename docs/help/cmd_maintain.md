# spur maintain

> Run database maintenance: PRAGMA optimize, WAL checkpoint truncation, optional VACUUM compaction.

## Usage

```
spur maintain [options]
```

## Options

| Flag | Description |
|---|---|
| `--vacuum` | Run VACUUM defragmentation and page compaction |
| `--json` | Output machine-readable JSON |

Runs PRAGMA optimize and a WAL checkpoint truncation against the active database, and reports
per-step ok/failed. `--vacuum` adds page compaction and reports reclaimed bytes. Exits 1 when
optimize or the checkpoint fails.

## See Also

- [Command index](./index.md)
- [cmd_status.md](./cmd_status.md) — inspect the installation before and after maintenance
