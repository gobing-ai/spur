# spur self exec

Run one SDLC action — build, lint, test, check and the rest — resolved from the project's
`builder` config, in the project root. It is the stack-neutral replacement for
"run the project's build/lint/test script" aliases (ADR-139).

## Usage

```bash
spur self exec [options] [action] [-- args...]
```

| Argument | Description |
| --- | --- |
| `action` | Reserved or declared action name |
| `args` | Extra arguments appended to a string action (pass after `--`) |

## Options

| Flag | Description |
| --- | --- |
| `--list` | List every reserved and declared action with its resolved command and source |
| `--dry-run` | Print the resolved command(s) and run nothing |
| `--json` | Machine-readable JSON: with `--list` the action rows; otherwise a final `{ action, steps, exitCode }` summary |

## Resolution

`builder.actions.<action>` in `.spur/config.yaml` → the active `builder.preset` → the
stack-neutral default. `--list` prints the winning `SOURCE` (`config`, `preset`, …) per action.

The action runs via `sh -c` in the project root and inherits stdout/stderr; stdin is not
forwarded. The child sees `SPUR_ACTION=<action>`, and `spur` exits with the child's exit code.

## Examples

```bash
spur self exec build            # run the resolved build command
spur self exec --list           # every reserved + declared action, its source and command
spur self exec --list --json    # machine-readable action inventory
spur self exec test --dry-run   # print the resolved command(s), run nothing
```

## See also

- [builder](./builder.md) — the config `self exec` resolves against
- [status](./status.md) — project status and probes

<!-- Provenance (invisible)
Generated: 2026-10-19 from live `spur self exec --help` and `--list` output, plus
docs/help/cmd_status.md "Related: run project SDLC actions" (accuracy carry-over).
-->
