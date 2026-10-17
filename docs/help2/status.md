# spur self status

Project health check in one command: config, database, git, and detected agent specs.

> **Canonical path:** `spur self status`. The legacy `spur status` top-level form remains a hidden alias.

## Usage

```bash
spur self status [path] [--json]
spur self status [path] [--json-envelope]
```

## Arguments and options

| Item | Description |
| --- | --- |
| `path` | Optional file or directory to check in addition to the project root |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | With `--json`, wrap output in the standard `{ok, data\|error}` envelope |

## Example

```bash
spur self status
# project: ok · .spur: ok · git: <branch> · agent specs: n

spur self status src/auth/   # also inspect a specific path
spur self status --json      # { ok, git: {root, branch, dirty}, agentSpecs, ... }
```

## When to run it

- Right after `spur self init` — confirm the scaffold is healthy.
- After upgrading Spur or pulling a collaborator's changes.
- Before starting a work session: it surfaces a dirty tree, missing config, or agent-spec
  surprises before they hit a longer command.

## Related: run project SDLC actions

`spur self exec` is the sibling operation that acts on what `status` reports: it runs one action
resolved from the project's `builder` config (`builder.actions.<action>`, else `builder.preset`,
else the stack-neutral default) in the project root and exits with the command's own code.

```bash
spur self exec build            # run the resolved build command
spur self exec --list           # every reserved + declared action, its source and command
spur self exec --list --json    # machine-readable action inventory
spur self exec test --dry-run   # print the resolved command(s), run nothing
```

`--list` prints the action table and `--dry-run` prints the resolved command(s) without running
them; `--json` makes both emit machine-readable JSON (`--list`: the action rows; `--dry-run`: one
`{ name, command }` object per step; alone: a final `{ action, steps, exitCode }` summary). See
`docs/design/sdlc-actions.md` for the exact shapes. Exit code `2` means the action is
unbound, a composite was given arguments, or neither an action nor `--list` was supplied.

## See also

- [init](./init.md) — what status validates was created correctly
- [Getting started](./getting-started.md)

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: status.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
