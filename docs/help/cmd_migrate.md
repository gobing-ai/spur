# spur migrate

> Apply CLI-owned schema migrations to the local `.spur/spur.db`. A **verb-less** command.
> The migrator only applies top-level `drizzle/*.sql` files carrying the `_spur_cli_` marker;
> legacy migrations under `drizzle/_legacy_reference/` are inert and never applied.

```
spur migrate [--json]
```

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

## Behavior

`spur migrate` is a temporary helper that applies the CLI-owned migration set against
`.spur/spur.db`. Per `docs/04_DESIGN.md §1.2`, it reports `{ ok, applied }` under `--json`.
History-import and workflow-engine tables ship as static SQL composed by
`packages/domain/src/migrations.ts` and run as part of the same set.

> **Corpus migration:** the per-task CLI verb `spur task migrate` runs the one-time **A17**
> task-corpus normalization pass (`--dry-run` previews, `--folder` scopes, `--json` for machines).
> Run it once when adopting the A17 layout on an older corpus.

## Example

```bash
spur migrate         # apply pending migrations, text summary
spur migrate --json  # { ok, applied: [...] }
```

## See Also

- [Command index](./index.md)
- `docs/04_DESIGN.md` — §1.2 `spur migrate` and the database / migrations section.
