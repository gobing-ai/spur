---
name: spur-cli-decision
description: "spur-cli noun reference: operate `spur decision` as the read/serve surface over the decision catalog - list registered decisions, show one served contract (parameters, criteria vocabulary, effective maker), run a decision to a served outcome (never writes a workflow resultFile), and status the catalog layers. Backed by @gobing-ai/ts-ai-decision 0.5.16 hub; offline by default via the built-in `typesafe` maker. Introduced by task 1093."
see_also:
  - spur-cli
---

# spur decision - decision catalog surface

`spur decision` exposes the **decision catalog** (ADR-117 trace discipline, task 1092) to agents
and scripts: discover which decisions exist, inspect one's contract, serve one outcome, and audit
catalog health. It is a thin transport over `DecisionService` (`packages/app`); the decision hub
lives in `@gobing-ai/ts-ai-decision`.

**Frozen at exactly four verbs** (`list`, `show`, `run`, `status`) by task 1093's design
(`docs/design/decision-catalog.md` §3.4) — do not invent additional subcommands.

## Catalog layers

Decisions resolve first-wins across three layers:

| Layer | Root | Notes |
| ----- | ---- | ----- |
| `project` | `<cwd>/.spur/decisions/*.yaml` | Highest precedence |
| `registered` | programmatic catalog registrations | Agents register in-process |
| `shared` | `decisions/` under the bundled config root | Shipped catalogs (`config/decisions/` in-repo) |

The bundled shared catalog ships `task-triage`, `failure-class`, and `review-failure-class` (all
`choice` type, param `wbs`). Duplicate ids across layers keep the higher layer; duplicates inside
one file are a load error.

**Config keys** (under `decisions:` in `config.global.yaml` or project config):
`paths` (extra catalog folders joined to the registered layer), `maker` (default DecisionMaker
for every decision point), `makers` (per-decision-id overrides). An unregistered maker name is a
config error, never a silent fallback (design §3.6).

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `list` | Every visible decision: id, type, layer, catalog file, description | `--layer <layer>`, `--json` |
| `show <id>` | One served contract: type, parameters, criteria, fallback, minConfidence, effective maker + source | `--json` |
| `run <id>` | Serve one outcome (closed vocabulary; **never writes a resultFile**) | `--param <pairs...>`, `--evidence <files...>`, `--maker <name>`, `--json` |
| `status` | Layer counts, registered makers, per-decision maker resolution, load errors | `--json` |

All verbs support `--json` (bare payload) and `--json-envelope` (`{ok, data|error}` envelope,
ADR-091). Failure output for `--json` commands uses the canonical error envelope only under
`--json-envelope`; plain `--json` keeps the human message on stderr.

**Exit codes:** `status` exits 1 on catalog load errors; `show` exits 1 on unknown id; `list` exits 0
(design §3.4 — load errors surface via `status`) except for an invalid `--layer` value (exit 1).
Error envelopes use `NOT_FOUND` for an unknown id and `VALIDATION_FAILED` for every other caller mistake.

**Exit contract for `run` (design §3.4):** any backend-observed outcome — low confidence, model
error surfaced as fallback, declined — is still a **successful serve** (exit 0, envelope carries
`source`/`confidence` so callers can see why). Exit 1 is reserved for caller mistakes caught
**before** the backend: unknown id, unknown parameter, missing required parameter, type-invalid
parameter, unregistered `--maker`, unreadable evidence file.

## Parameters and evidence

`--param k=v` is repeatable and validated against the decision's declared parameters: values for
`number`/`boolean`/`json` params are parsed accordingly (`json` accepts inline JSON objects);
string/enum params pass through verbatim. A parameter with no `default` is **required** (hub
loader derives `required: !hasDefault`). Undeclared keys exit 1.

`--evidence <file>` is repeatable; each file is read, **redacted and bounded to
`DECIDE_EVIDENCE_MAX_CHARS` (2000 chars)** via the same `redactAndBound` used by workflow
agent execution. Evidence rides the hub's implicit `instructions` input parameter — it reaches the
maker through the rendered question, never as a raw input key (the hub rejects undeclared input
keys). An unreadable evidence file exits 1 before any backend call.

## Effective maker resolution

Makers resolve `flag → config-decision → config-default → catalog-decision → catalog-default`;
`decision show` reports the effective maker as `{name, source}` with that source precedence
(operator config outranks the shipped catalog because only the machine owner knows which backends
exist there). The final `catalog-default` maker is the hub built-in `typesafe` — decisions served
without a configured backend still produce deterministic closed-vocabulary outcomes, which is why
`run` is usable in tests and scripts with no model access.

## Examples

```bash
spur decision list --json | jq -r '.[].id'
spur decision show task-triage                      # inspect contract before serving
spur decision run task-triage --param wbs=1093 --json
spur decision run failure-class --param wbs=1093 \
    --evidence .spur/run/<runId>-test-output.txt    # redacted evidence -> instructions
spur decision status --json | jq '.data.errors'     # audit catalog health
```

## References

- Design: `docs/design/decision-catalog.md` (§2 catalog authoring, §3.4 CLI surface)
- Hub: `@gobing-ai/ts-ai-decision` 0.5.16 (`DecisionService`, catalog schema, maker registry)
- App service: `packages/app/src/decision/decision-service.ts`
- Shipped catalogs: `config/decisions/*.yaml`
