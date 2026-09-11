# spur projects

Manage the Spur multi-project registry: register additional repositories so a server-side
workflow can address and start/stop them.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `add <path>` | Register a project root |
| `remove <target>` | Remove a registered project |
| `list` | List registered projects |
| `start <target>` | Start a registered project's server |
| `stop <target>` | Stop a registered project's server |

All verbs accept `--json` (and `--json-envelope`).

## Register and list

```bash
spur projects add ../other-repo --name "Other Repo"
spur projects list
spur projects remove other-repo
```

`add` registers a project root directory; `--name` sets a display name. `remove` and `start` /
`stop` accept either the registered path or the project name as `<target>`.

## Start and stop

```bash
spur projects start other-repo
spur projects stop other-repo
```

> **Relationship to `spur serve`:** `projects start/stop` drive *registered* projects through
> the registry; `spur serve` runs the local server for the current project. The supervised
> team verbs ([team](./team.md) `start/stop`) are a third, agent-process surface.

## See also

- [serve](./serve.md) — the local web server
- [team](./team.md) — supervised agent processes

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: projects.txt + verbs/projects_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
