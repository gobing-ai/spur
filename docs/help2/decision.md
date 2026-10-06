# spur decision

> Decision-catalog transport: list visible decisions, show one served contract, run a decision to a
> served outcome (never writes a workflow resultFile), and audit catalog health. Thin CLI over
> `DecisionService`; the hub is `@gobing-ai/ts-ai-decision` (task 1093). Frozen at exactly these
> four verbs (`docs/design/decision-catalog.md` §3.4).

## Catalog layers

Decisions resolve first-wins across three layers:

| Layer | Source |
|---|---|
| `project` | `<cwd>/.spur/decisions/` |
| `registered` | config `decisions.paths` folders + programmatic registrations |
| `shared` | bundled `config/decisions/` |

## spur decision list

Every visible decision: id, type, layer, catalog file, description.

| Option | Description |
|---|---|
| `--layer <layer>` | Filter to one layer: `project`, `registered`, or `shared` |
| `--json` | Output machine-readable JSON (bare payload) |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Exit 0; per-catalog load errors never fail `list` (design §3.4) — `spur decision status` reports them and exits 1.

## spur decision show

One served contract: type, parameters, criteria vocabulary, fallback, minConfidence, and the
effective maker `{name, source}` with precedence `flag → config-decision → config-default →
catalog-decision → catalog-default`.

```
spur decision show <id>
```

Unknown id exits 1.

## spur decision run

Serve one outcome. Every backend-observed result — low confidence, model error surfaced as
fallback, declined — is a successful serve (exit 0; the envelope carries `source`/`confidence`).
Exit 1 is reserved for caller mistakes caught before the backend: unknown id, unknown parameter,
missing required parameter, type-invalid parameter, unregistered maker, unreadable evidence file.
`run` never writes a workflow resultFile.

| Option | Description |
|---|---|
| `--param <pairs...>` | Repeatable declared input as `k=v`; `number`/`boolean`/`json` values are parsed |
| `--evidence <files...>` | Repeatable; redacted, bounded to 2000 chars, rides the implicit `instructions` input |
| `--maker <name>` | Override the resolved DecisionMaker for this call |
| `--json` | Output machine-readable JSON (bare payload) |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

## spur decision status

Layer counts, registered makers, per-decision maker resolution, and load errors. Exit 0 on a clean
catalog; exit 1 when any layer reports load errors (errors are listed either way).
