# spur decision

Decision-catalog transport: list visible decisions, show one served contract, run a decision to a
served outcome (never writes a workflow resultFile), and audit catalog health. Thin CLI over
`DecisionService`; the hub is `@gobing-ai/ts-ai-decision` (task 1093). Frozen at exactly these
five verbs (`docs/design/decision-catalog.md` §3.4; `outcome` added by task 1263).

## Catalog layers

Decisions resolve first-wins across three layers:

| Layer | Source |
|---|---|
| `project` | `<cwd>/.spur/decisions/` |
| `registered` | config `decisions.paths` folders + programmatic registrations |
| `shared` | bundled `config/decisions/` |

The shared layer ships `task-semantic-risk`, `failure-class`, `gate-evidence`,
`idea-recommendation`, `needs-design`, `anatomy-validation-verdict` and `maker-liveness` (the last
served only by `spur decision status --probe`; no workflow references it).

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

## spur decision outcome

| Option | Description |
|---|---|
| `--review-severity <wbs>` | Derive the outcome from that task's Review findings (worst P1-P4 row, resolved included) |
| `--gate-status <run-id>` | Derive the outcome from that run's gate token: PASS -> `fixed`, otherwise `not-fixed` |
| `--source <text>` | Free-text note on where the outcome was observed |
| `--json` | Output machine-readable JSON |

Records what actually happened after a served decision, keyed by the `invocationId` its result row
carries. First write wins; an unknown invocation id exits 1, a malformed outcome slug exits 2.
`spur decision status --reliability` scores recorded outcomes against `decisions.outcomeMap`.

## spur decision status

Sectioned readiness report: one status line, errors, aligned `Makers` and `Decisions` tables and a
`Catalog` block. Exit 0 on a clean catalog; exit 1 when any layer reports load errors or a configured
maker is unregistered (errors are listed either way).

| Option | Description |
|---|---|
| `--probe` | Ask one liveness decision of each distinct registered effective maker (feature P11). Refused together with `--reliability`; never changes the exit code, writes no decision log row and emits no decision event |
| `--reliability` | Report recorded decision outcomes per decision and maker from the `decision.end` ledger instead (task 1096) |
| `--since <iso>` | With `--reliability`: only rows at or after this ISO timestamp |
| `--json` | Output machine-readable JSON (bare payload) |
| `--json-envelope` | Wrap `--json` output in the `{ok, data}` envelope |

The readiness view separates four marks per maker and per decision: **registered** (the `ST` glyph),
**configured** (`CONFIGURED BY`: `decisions.maker` / `decisions.makers.<id>`), **recorded**
(`RECORDED` / `ACCEPTED` / `LAST SEEN` from the ledger, matched on `(decisionId, maker)`), and
**proven** (`PROBE`, only with `--probe`). `RECORDED` with `ACCEPTED 0` is the state that reads as
healthy elsewhere: registered and configured, never once succeeded. `--json` is additive over the
pre-P11 fields and adds `makers[]`, `perDecision[].evidence`, and `probes[]` under `--probe`.

With `--reliability [--since <iso>]`, report recorded decision outcomes per decision and maker from
the `decision.end` ledger instead (task 1096): samples, acceptedRate, fallbacks by reason,
medianConfidence, p50/p95 durationMs and firstSeen/lastSeen; catalog ids without rows report
`evidence: 'none'`. Reads recorded rows only — never calls a maker — and exits 0 on a successful
report.
