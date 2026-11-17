# spur self maintain

> Run database maintenance: PRAGMA optimize, WAL checkpoint truncation, optional VACUUM compaction.
>
> **Canonical path:** `spur self maintain`. The legacy `spur maintain` top-level form remains a hidden alias.

## Usage

```
spur self maintain [options]
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

## Gateway daemon (feature K4)

`spur self daemon <install|uninstall|status> [--port <n>] [--json]` keeps the one-port project
gateway always on as a macOS user LaunchAgent (`~/Library/LaunchAgents/ai.gobing.spur.gateway.plist`,
logs under `~/Library/Logs/spur/`). `install` refuses a non-macOS platform and a port held by another
process without writing anything; `status` reports loaded/pid/last exit plus `GET /api/health`;
`uninstall` boots it out and removes the plist (absent = success). The agent runs
`spur self serve --gateway`. See [cmd_serve](./cmd_serve.md) for gateway mode itself.
