# spur status

> Show project, Git, and optional path status. A verb-less command — accepts an optional path
> positional and flags directly.

```
spur status [options] [path]
```

| Argument | Description |
|---|---|
| `path` | Optional file/dir path to check |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

## Example

```bash
spur status
spur status src/auth --json
```

## See Also

- [Command index](./index.md)
