# spur decision

> Decision catalog surface: list registered decisions, show one served contract, run a decision to
> a served outcome (never writes a workflow resultFile), and audit catalog health. Thin transport
> over `DecisionService`; the hub is `@gobing-ai/ts-ai-decision` (task 1093). Frozen at exactly
> these five verbs (`docs/design/decision-catalog.md` §3.4; `outcome` added by task 1263).

## Subcommands

| Subcommand | Description |
|---|---|
| `list` | Every visible decision: id, type, layer, catalog file, description |
| `show <id>` | One served contract: parameters, criteria, fallback, effective maker + source |
| `run <id>` | Serve one outcome with `--param` inputs and redacted `--evidence` files |
| `status` | Sectioned readiness report: registration, configuration, recorded evidence and the opt-in liveness probe |
| `outcome <invocation-id>` | Record what actually happened after a served decision (acceptance is not accuracy); first write wins |

## Catalog layers and config

Decisions resolve first-wins across three layers:

| Layer | Source |
|---|---|
| `project` | `<project>/.spur/decisions/*.yaml` |
| `registered` | Extra catalog folders listed in config `decisions.paths` |
| `shared` | Bundled catalogs (`config/decisions/`; ships `task-triage`, `failure-class`, `review-failure-class`, `gate-evidence`, `idea-recommendation`, `needs-design`, `anatomy-validation-verdict`, `maker-liveness`) |

Config keys under `decisions:` (global `~/.config/spur/config.yaml` or project `.spur/config.yaml`):
`paths`, `maker` (default DecisionMaker), `makers` (per-decision-id overrides). An unregistered
maker name is a config error, never a silent fallback.

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

With no backend configured, the built-in `typesafe` maker serves the catalog fallback:

```json
{ "id": "task-triage", "type": "choice", "value": "standard", "source": "default",
  "reason": "no-backend", "confidence": null, "maker": "typesafe", "makerSource": "catalog-default" }
```

## spur decision outcome

```
spur decision outcome <invocation-id> [<outcome>] [options]
```

| Option | Description |
|---|---|
| `--review-severity <wbs>` | Derive the outcome from that task's `## Review` findings: the worst P1-P4 row, resolved rows included (`p1`-`p4`), or `none` |
| `--gate-status <run-id>` | Derive the outcome from that run's gate token (`PASS` -> `fixed`, anything else or a missing token -> `not-fixed`) |
| `--source <text>` | Free-text note on where the outcome was observed |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Pass exactly one outcome source: the positional `<outcome>` (a lowercase slug matching
`^[a-z0-9-]{1,32}$`), `--review-severity`, or `--gate-status`. The invocation id is the one a decide
step writes into its result row (`invocationId`) and that keys the `decision.*` events and the
`decision_logs` row.

Exit 0 when the outcome is recorded, or when one already stands (`recorded: false`, first write
wins). Exit 1 for an unknown invocation id — there is no decision to score. Exit 2 for a malformed
outcome slug or for naming zero or several outcome sources.

`--json` payload: `{ invocationId, decisionId, outcome, recorded }`. The row lands in
`system_events` beside `decision.end`, on the same run id, and
`spur decision status --reliability` scores it against `decisions.outcomeMap`.

## spur decision status

```
spur decision status [options]
```

| Option | Description |
|---|---|
| `--reliability` | Report recorded decision outcomes per decision and maker from the `decision.end` ledger (task 1096) instead of the readiness view |
| `--probe` | Ask one liveness decision of each distinct registered effective maker (feature P11). Refused together with `--reliability`. Never changes the exit code, writes no decision log row and emits no decision event |
| `--since <iso>` | With `--reliability`: only rows at or after this ISO timestamp |
| `--json` | Output machine-readable JSON |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

Exit 0 on a clean catalog; exit 1 on any catalog load error or maker-config error (an unregistered
maker named in config). Errors are listed either way.

`--json` payload: `{ ok, layers: {project, registered, shared}, loadErrors, duplicateIds,
registeredMakers, configDefaultMaker, configDecisionMakers, perDecision: [{id, type, maker, source,
registered, layer, minConfidence, evidence: {recorded, accepted, lastSeen}}], errors, makers: [{name,
registered, configuredBy, serves, evidence}] }` — additive over the pre-P11 fields, plus `probes:
[{maker, ok, value, reason, durationMs}]` only under `--probe`.

The readiness view separates four marks per maker and per decision (feature P11): **registered**
(the `ST` glyph), **configured** (`CONFIGURED BY` names `decisions.maker` / `decisions.makers.<id>`),
**recorded** (`RECORDED` / `ACCEPTED` / `LAST SEEN` from the ledger, matched on `(decisionId,
maker)`), and **proven** (`PROBE`, only with `--probe`). `RECORDED` with `ACCEPTED 0` is the state
that reads as healthy elsewhere: registered and configured, never once succeeded. The human report
renders one status line, then errors, then aligned `Makers` and `Decisions` tables and a `Catalog`
block (`✓`/`✗` glyphs, `—` for empty cells). `--probe` bounds every driver, streams each result to
stderr, and is the only path that constructs a maker.

With `--reliability`, reads recorded rows only (never calls a maker) and exits 0 on a successful
report. `--json` payload: `{ generatedAt, groups: [{decisionId, maker, evidence: 'recorded' |
'none', samples, accepted, acceptedRate, fallbacks, medianConfidence, p50DurationMs,
p95DurationMs, firstSeen, lastSeen}] }`; catalog ids with zero rows report `evidence: 'none'`.
