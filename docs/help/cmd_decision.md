# spur decision

> Decision catalog surface: list registered decisions, show one served contract, run a decision to
> a served outcome (never writes a workflow resultFile), and audit catalog health. Thin transport
> over `DecisionService`; the hub is `@gobing-ai/ts-ai-decision` (task 1093). Frozen at exactly
> these four verbs (`docs/design/decision-catalog.md` §3.4).

## Subcommands

| Subcommand | Description |
|---|---|
| `list` | Every visible decision: id, type, layer, catalog file, description |
| `show <id>` | One served contract: parameters, criteria, fallback, effective maker + source |
| `run <id>` | Serve one outcome with `--param` inputs and redacted `--evidence` files |
| `status` | Layer counts, registered makers, per-decision maker resolution, load errors |

## spur decision list

```
spur decision list [options]
```

| Option | Description |
|---|---|
| `--layer <layer>` | Filter to one layer: `project`, `registered`, or `shared` |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Exit 0; per-catalog load errors never fail `list` (design §3.4) — `spur decision status` reports
them and exits 1.

## spur decision show

```
spur decision show [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Decision id (catalog first-wins across layers) |

| Option | Description |
|---|---|
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Unknown id exits 1. Reports the effective maker `{name, source}` with precedence
`flag → config-decision → config-default → catalog-decision → catalog-default`.

## spur decision run

```
spur decision run [options] <id>
```

| Argument | Description |
|---|---|
| `id` | Decision id (catalog first-wins across layers) |

| Option | Description |
|---|---|
| `--param <k=v>` | Repeatable declared input; values for `number`/`boolean`/`json` params are parsed |
| `--evidence <file>` | Repeatable; redacted, bounded to 2000 chars, rides the implicit `instructions` input |
| `--maker <name>` | Override the resolved DecisionMaker (unregistered name exits 1) |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Every backend-observed outcome serves with exit 0 (envelope carries `source`/`confidence`);
exit 1 is reserved for caller mistakes caught before the backend. Never writes a resultFile.

## spur decision status

```
spur decision status [options]
```

| Option | Description |
|---|---|
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Exit 0 on a clean catalog; exit 1 when any layer reports load errors (errors are listed either
way).
