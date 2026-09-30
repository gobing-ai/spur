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
| `clean` | Purge missing project directories and terminate lingering processes |

All verbs accept `--json` (and `--json-envelope`).

## Register and list

```bash
spur projects add ../other-repo --name "Other Repo"
spur projects list [--fleet]
spur projects remove other-repo
spur projects clean [--no-terminate-processes]
```

`add` registers a project root directory; `--name` sets a display name. `remove` and `start` /
`stop` accept either the registered path or the project name as `<target>`. `list --fleet` also
resolves each project's `agent.fleet` declaration and orchestrator binding. `clean` drops registry
entries whose directory is gone and terminates processes lingering on occupied ports
(`--no-terminate-processes` skips the termination).

## Start and stop

```bash
spur projects start other-repo [--port <n>]
spur projects stop other-repo
```

> **Relationship to `spur self serve`:** `projects start/stop` drive *registered* projects through
> the registry; `spur self serve` runs the local server for the current project. The supervised
> agent verbs ([agent](./agent.md) `start/stop`) are a third, agent-process surface.

## See also

- [serve](./serve.md) — the local web server
- [agent](./agent.md) — supervised agent processes

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: projects.txt + verbs/projects_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
