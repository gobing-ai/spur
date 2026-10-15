# spur self migrate

> Apply CLI-owned schema migrations to the local `.spur/spur.db`. A **verb-less** command.
> The migrator only applies top-level `drizzle/*.sql` files carrying the `_spur_cli_` marker;
> legacy migrations under `drizzle/_legacy_reference/` are inert and never applied.
>
> **Canonical path:** `spur self migrate`. The legacy `spur migrate` top-level form remains a hidden
> alias over the same command — it keeps working unchanged for existing scripts and workflow YAML but
> is absent from `spur --help`.

```
spur self migrate [--check] [--json]
```

| Flag | Description |
|---|---|
| `--check` | Report importer schema drift without writing (exit 1 on drift) |
| `--json` | Output machine-readable JSON |

## Behavior

`spur self migrate` is a temporary helper that applies the CLI-owned migration set against
`.spur/spur.db`. Per `docs/04_DESIGN.md §1.2`, it reports `{ ok, applied }` under `--json`.
History-import and workflow-engine tables ship as static SQL composed by
`packages/domain/src/migrations.ts` and run as part of the same set.

With `--check` the command is read-only: it opens the selected database without running the
boot-time migration, reports importer schema drift from the installed
`@gobing-ai/ts-llm-jsonl-importer` (exit `1` on drift), and an absent database stays absent —
no file, schema, or repair is created.

> **Corpus migration:** the per-task CLI verb `spur task migrate` runs the one-time **A17**
> task-corpus normalization pass (`--dry-run` previews, `--folder` scopes, `--json` for machines).
> Run it once when adopting the A17 layout on an older corpus.

## Example

```bash
spur self migrate             # apply pending migrations, text summary
spur self migrate --json      # { ok, applied: [...] }
spur self migrate --check     # read-only importer-schema drift report
```

## See Also

- [Command index](./index.md)
- `docs/04_DESIGN.md` — §1.2 `spur self migrate` and the database / migrations section.
