---
name: spur-cli-decision
description: "spur-cli noun reference: operate `spur decision` as the read/serve surface over the decision catalog - list registered decisions, show one served contract (parameters, criteria vocabulary, effective maker), run a decision to a served outcome (never writes a workflow resultFile), and status the catalog layers with per-maker readiness marks (registered, configured, recorded, probed). Backed by the @gobing-ai/ts-ai-decision hub; with no reachable backend every decision serves its declared fallback. Lifecycle (author, evaluate, triage, tune) lives in decision/lifecycle.md."
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
| `registered` | folders listed in config `decisions.paths` | Operator-added catalogs |
| `shared` | `decisions/` under the bundled config root | Shipped catalogs (`config/decisions/` in-repo) |

The bundled shared catalog ships `task-semantic-risk`, `failure-class`,
`gate-evidence`, `idea-recommendation`, `needs-design`, `anatomy-validation-verdict` and
`maker-liveness` (the last served only by `spur decision status --probe`; no workflow references
it). Layers win **per file basename** (a project `gates.yaml` replaces the shipped `gates.yaml`
whole); the same id in two winning files of different basenames is a `duplicateIds` catalog error.

**Config keys** (under `decisions:` in the global `~/.config/spur/config.yaml` or project `.spur/config.yaml`):
`paths` (extra catalog folders forming the `registered` layer), `maker` (default DecisionMaker
for every decision point), `makers` (per-decision-id overrides), `log` (`full` | `metadata` | `off`,
how much of each served decision the ledger keeps). An unregistered maker name is a
config error, never a silent fallback (design §3.6).

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `list` | Every visible decision: id, type, layer, catalog file, description | `--layer <layer>`, `--json` |
| `show <id>` | One served contract: type, parameters, criteria, fallback, minConfidence, effective maker + source | `--json` |
| `run <id>` | Serve one outcome (closed vocabulary; **never writes a resultFile**) | `--param <pairs...>`, `--evidence <files...>`, `--maker <name>`, `--json` |
| `status` | Sectioned readiness report: one status line, errors, aligned `Makers` and `Decisions` tables (registration, configuration source, recorded evidence), `Catalog` block | `--probe`, `--reliability [--since <iso>]`, `--json` |
| `outcome <invocation-id>` | Record what actually happened after a served decision — acceptance is not accuracy (task 1263). First write wins | `<outcome>`, `--review-severity <wbs>`, `--gate-status <run-id>`, `--source <text>`, `--json` |

All verbs support `--json` (bare payload) and `--json-envelope` (`{ok, data|error}` envelope,
ADR-091). Failure output for `--json` commands uses the canonical error envelope only under
`--json-envelope`; plain `--json` keeps the human message on stderr.

**Exit codes:** `status` exits 1 on any catalog load error or maker-config error; `show` exits 1 on unknown id; `list` exits 0
(design §3.4 — load errors surface via `status`) except for an invalid `--layer` value (exit 1).
Error envelopes use `NOT_FOUND` for an unknown id and `VALIDATION_FAILED` for every other caller mistake.
`outcome` exits 1 for an unknown invocation id (there is no decision to score) and 2 for a malformed
outcome (it must match `^[a-z0-9-]{1,32}$`) or for naming zero/several outcome sources.

## Acceptance versus accuracy (`outcome` + `--reliability`)

`decision.end` says **what was answered**; it never says whether the answer was right. A maker can
be accepted on every call and still add no information: `review-failure-class` answered its own
fallback 15/15 times at confidence 1.0 before task 1262 retired it. Tuning `minConfidence`, choosing
a maker, or judging a shadow maker therefore needs (value, outcome) pairs.

**Recording one.** A decide step now writes the invocation's ledger key into its result row
(`invocationId`, task 1263 R1) — the same id the `decision.*` events and the `decision_logs` row
carry. Once the outcome is known, record it:

```bash
# an explicit label (lowercase slug): what a human or a later check observed
spur decision outcome <invocation-id> fixed --source "quality gate recheck"
# derived from a task's Review findings: the worst finding, resolved rows included (p1-p4, or none)
spur decision outcome <invocation-id> --review-severity 1263
# derived from a gate visit: PASS -> fixed, anything else (or a missing token) -> not-fixed
spur decision outcome <invocation-id> --gate-status <run-id>
```

First write wins: a replay exits 0 with `recorded: false` and the outcome that already stands. The
row lands in `system_events` beside `decision.end`, on the same `run_id`, so the report joins it by
`invocationId`.

**Scoring one.** `decisions.outcomeMap` in config (project or global layer) holds Spur's reading of
Spur's own artifacts — per decision id, which recorded outcomes count as correct for each served
value (`String(value)` keys, so a yes/no decision uses `"true"`/`"false"`). The shipped defaults
score `failure-class` (`fix` → `fixed`, `stop` → `not-fixed`) and `task-semantic-risk`
(`"false"` → `none`/`p4`/`p3`, `"true"` → `p1`/`p2`).

`spur decision status --reliability` then reports, per (decision × maker) group:

| Field | Meaning |
| --- | --- |
| `samples`, `accepted`, `acceptedRate` | `decision.end` rows; acceptance only |
| `outcomes` | recorded outcomes by label over those samples |
| `accuracy` | correct accepted answers ÷ accepted answers **with an outcome**; null when the decision has no map entry or no accepted sample recorded one |
| `fallbackAccuracy` | the same ratio over fallback (`source: default`) samples |

`accuracy: null` is deliberate: an unmapped decision or an unobserved one is unknown, never zero.
Acceptance and accuracy answer different questions — a high `acceptedRate` with `accuracy: null`
means "the maker answered and we have not looked at whether it was right yet".

**Reading a sampled maker.** Sampled makers report unanimity, not calibration: with two options,
2-of-3 agreement is ~0.08 confidence and the 0.8 floor only accepts when every sample agreed
(ts-libs `docs/design/llm-agent-decision-backend.md` § Confidence granularity). A 1.0 confidence on
that kind of maker therefore means "the samples agreed", not "the answer is calibrated".

**Retuning `minConfidence` from the report.** Read a group's `accuracy` and `fallbackAccuracy`
together with `fallbacks` by reason. Accepted-but-wrong answers point at raising the floor (or
changing the maker); fallbacks that were right point at lowering it. Change the floor in the
catalog entry (or `defaults.minConfidence`), record the new samples, and compare the same two
numbers — never one of them alone.

## Readiness marks (`status`, feature P11)

The default `status` output separates four marks per maker and per decision
(`docs/design/decision-observability-and-adoption.md` §3.4.1):

| Mark | Column | Source |
| ---- | ------ | ------ |
| registered | `ST` glyph on the maker row | the maker registry holds the name |
| configured | `CONFIGURED BY` | `decisions.maker` / `decisions.makers.<id>` |
| recorded | `RECORDED` / `ACCEPTED` / `LAST SEEN` | the recorded `decision.end` ledger, matched on `(decisionId, maker)` |
| proven | `PROBE` (only with `--probe`) | one live liveness decision per maker |

`RECORDED` with `ACCEPTED 0` is the state that reads as healthy everywhere else: the maker is
registered and configured but has never once succeeded. `--probe` is the only path that calls a
maker, is bounded per driver, writes no decision log row and emits no event (`--probe` with
`--reliability` is refused). Parse the marks with `--json`: `makers[]`
(`registered`, `configuredBy`, `serves`, `evidence`), `perDecision[].evidence`, and `probes[]`
under `--probe`.

**Exit contract for `run` (design §3.4):** any backend-observed outcome — low confidence, model
error surfaced as fallback, declined — is still a **successful serve** (exit 0, envelope carries
`source`/`confidence` so callers can see why). Exit 1 is reserved for caller mistakes caught
**before** the backend: unknown id, unknown parameter, missing required parameter, type-invalid
parameter, unregistered `--maker`, unreadable evidence file.

## Executor failure rescue (`executor-failure-class`)

The agent executor escalates on `FAILURE_RULES` matches only (`packages/app/src/services/failure-classification.ts`).
A failure no rule matches — a reworded rate limit, "credits depleted", a proxy error body — ends
the run as a task defect until somebody adds a regex. `executor-failure-class` covers that residue:
`resource-exhaustion` / `auth` / `task-defect`, fallback `task-defect`, `minConfidence: 0.85`
(a false `resource-exhaustion` costs a failover attempt; a false `task-defect` equals today's
behaviour, so uncertainty must resolve downward).

**It ships off.** `workflows.executorFailureDecisionMaker: true` is the opt-in; without it the executor
makes no model call and the context carries no rescue seam at all. Turning it on is an operator
call backed by replay evidence (`spur decision run executor-failure-class --evidence <tail>` over
real unmatched tails), not a default.

The rescue runs only when every deterministic check declined: non-zero exit without a timeout
signal, `undefined` from `classifyDispatch`, no permission-denial evidence (a denial stays terminal),
no confirmed quota event, and non-blank output. It sees the failure text **redacted first, then
tailed** to 4096 characters — tailing first could cut a secret at the boundary and send the
fragment off-box, so never reorder that.

**Evidence leaves the machine with a hosted maker.** The tail is failure output from whatever the
agent printed, so a hosted maker (`clef`) sees it. Two consequences:

- Prefer a **probability-native** maker for this id (`decisions.makers.executor-failure-class`):
  sampled makers accept only on unanimity (ts-libs `docs/design/llm-agent-decision-backend.md`
  § Confidence granularity), so the 0.85 floor does not grade them.
- `laya-local` keeps the evidence on-box (it needs Apple Silicon, and since task 1262 R1 the bundled
  CLI ships its worker, so `workerScript` resolves without a source checkout).

Every rescue is attributed `caller: executor` with the failing run's id, so it shows up in
`decision.*` events, `decision_logs` and `spur decision status --reliability` with no extra work.
To promote recurring text into a deterministic rule, list the accepted rescues:

```bash
sqlite3 .spur/spur.db "
  SELECT o.decision_id, json_extract(o.payload_json, '$.data.outcome') AS answer,
         json_extract(s.payload_json, '$.data.workflowName') AS workflow, o.run_id
  FROM system_events o
  JOIN system_events s
    ON s.event_name = 'decision.start'
   AND json_extract(s.payload_json, '$.data.invocationId')
       = json_extract(o.payload_json, '$.data.invocationId')
  WHERE o.event_name = 'decision.end'
    AND json_extract(o.payload_json, '$.data.caller') = 'executor'
    AND json_extract(o.payload_json, '$.data.source') = 'model'
  ORDER BY o.occurred_at DESC;"
```

Add the `FAILURE_RULES` entry by hand, with a test — the rescue stays the safety net for what the
table still misses.

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
exist there). The final `catalog-default` maker is the hub built-in `typesafe`, a **hosted** maker
that needs `TYPESAFE_API_KEY`. Without a reachable backend `run` still exits 0 with the declared
fallback (`source: default`, reason `no-backend`), which is why it is usable in tests and scripts
with no model access — the outcome is deterministic, not model-judged.

**Available makers:** the four upstream built-ins (`typesafe`, `fm-local`, `laya-local`,
`llm-agent`) plus Spur's hosted `clef` (Cloudflare Workers AI via `@gobing-ai/ts-decision-clef`).

- `llm-agent` samples an installed coding agent: by default the first installed tier-1 agent, 3
  one-shot samples, accepted only when every sample agrees. Spur passes it no driver options, so
  each ask costs several agent runs; name it per decision (`decisions.makers.<id>`) rather than as
  the project-wide `decisions.maker`.
- `clef` registers only when both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN` are set in
  the environment; without them it is absent from `registeredMakers`, so naming it in config or
  `--maker` is a config error, never a silent fallback. Its model defaults to `clef-flash` (a
  catalog `model` selects `clef`).

## Workflow consumption

Workflows consume a decision through the catalog-reference `decide` action
(`{id, decision, params?, evidence? | instructions?, resultFile}`); the inline
`question`/`method`/`default` form is deprecated. `workflows.decideDecisionMaker` (default off)
gates model calls there — off, every `decide` serves its fallback. `hitl.confirm`/`hitl.select`
with `decision: {mode: evidence, …}` route through `gate-evidence` under the separate
`workflows.hitlDecisionMaker` switch (default off — the gate defers to the operator, or under
`profile=auto` to its declared fallback). Neither switch affects `spur decision run`. Shape, adoption classes and
guards: [decision/lifecycle.md](decision/lifecycle.md) §1, §3.

## Examples

```bash
spur decision list --json | jq -r '.[].id'
spur decision show task-semantic-risk               # inspect contract before serving
spur decision run task-semantic-risk --param wbs=1093 \
    --evidence .spur/run/1093-diffstat.json --evidence docs/tasks/1093_*.md --json
spur decision run failure-class --param wbs=1093 \
    --evidence .spur/run/<runId>-test-output.txt    # redacted evidence -> instructions
spur decision status --json | jq '.loadErrors'      # audit catalog health
spur decision status                                 # readiness marks: registered / configured / recorded
spur decision status --probe                          # prove each effective maker answers now
spur decision status --json | jq '.makers[] | {name, registered, recorded: .evidence.recorded}'
```

## References

- Design: `docs/design/decision-catalog.md` (§2 catalog authoring, §3.4 CLI surface),
  `docs/design/decision-observability-and-adoption.md` (§3.4 reliability report, §3.4.1 readiness view)
- Lifecycle: [decision/lifecycle.md](decision/lifecycle.md) (create, wire, evaluate, triage, enhance)
- Hub: `@gobing-ai/ts-ai-decision`, version pinned by the root `workspaces.catalog` (`DecisionService`,
  catalog schema, maker registry)
- App service: `packages/app/src/decision/decision-service.ts` (makers, `probeMaker`),
  `packages/app/src/decision/decision-status-readiness.ts` (readiness marks, probe loop)
- Shipped catalogs: `config/decisions/*.yaml`
