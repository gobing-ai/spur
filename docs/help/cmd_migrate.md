# spur migrate

> Apply CLI-owned schema migrations. A verb-less command. The migrator only applies top-level
> `drizzle/*.sql` files carrying the `_spur_cli_` marker; legacy migrations under
> `drizzle/_legacy_reference/` are inert and never applied.

```
spur migrate [--json]
```

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

## Example

```bash
spur migrate
spur migrate --json
```

## See Also

- [Command index](./index.md)
