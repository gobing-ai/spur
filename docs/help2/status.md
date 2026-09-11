# spur status

Project health check in one command: config, database, git, and detected agent specs.

## Usage

```bash
spur status [path] [--json]
spur status [path] [--json-envelope]
```

## Arguments and options

| Item | Description |
| --- | --- |
| `path` | Optional file or directory to check in addition to the project root |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## Example

```bash
spur status
# project: ok · .spur: ok · git: <branch> · agent specs: n

spur status src/auth/   # also inspect a specific path
spur status --json      # { ok, git: {root, branch, dirty}, agentSpecs, ... }
```

## When to run it

- Right after `spur init` — confirm the scaffold is healthy.
- After upgrading Spur or pulling a collaborator's changes.
- Before starting a work session: it surfaces a dirty tree, missing config, or agent-spec
  surprises before they hit a longer command.

## See also

- [init](./init.md) — what status validates was created correctly
- [Getting started](./getting-started.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: status.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
