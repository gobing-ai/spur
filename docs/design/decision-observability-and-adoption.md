---
kind: design
title: Decision observability and staged workflow adoption
status: accepted
created_at: 2026-10-06
updated_at: 2026-10-07
related: [ADR-134, ADR-125, feature P, feature P1, decision-catalog.md]
tags: [decision, events, workflow, observability]
---

# Decision observability and staged workflow adoption

## 1. Issue and scope

`spur decision` (feature P, [decision-catalog.md](decision-catalog.md)) serves catalog decisions,
but nothing records them. `DecisionService.decide`
(`packages/app/src/decision/decision-service.ts:182`) returns a `ServedDecision` and emits no
event. Feature P1 cannot start adopting decisions in workflows until reliability evidence exists
(ADR-134), and today there is no evidence to collect.

Feature P1 owns two things:

1. **Observability.** The decision lifecycle is published on the system event bus and stored in
   `system_events`. A reliability report is built from those events.
2. **Adoption.** Every shipped workflow step is audited (§4), and decision points move one slice
   at a time (§5). Each slice must cite reliability evidence before it starts.

**Out of scope:**
- Replacing deterministic PASS/FAIL checks with model calls.
- Changing bundled operator gates away from `mode: never`.
- Upstream hooks in `@gobing-ai/ts-ai-decision`. `DecisionHub` has none, and the Spur wrapper
  already holds every field the events need.

## 2. Context and constraints

- **One seam.** Every decision passes through `DecisionService.decide`: CLI `spur decision run`
  today, and the workflow `decide` action after slice S4. Emitting events there covers both
  callers. The workflow `decide` action's current inline-question path (`runDecide`) emits through
  the same payload module until S4 routes catalog-backed decides through the service; the
  inline-question form never reaches the service, so nothing is emitted twice.
- **Event catalog contract.** Every name is registered in `BASE_CATALOG`, has a presenter in
  `SYSTEM_EVENT_PRESENTERS`, and belongs to a `SystemEventSource` that has a `SOURCE_PROFILES`
  row (`packages/app/src/services/event-names.ts:14`, `:76`). The model for decision events is
  `agent.invoke.start`/`exit` (`event-names.ts:281`).
- **Persistence.** The CLI stores events through `attachSystemEventLedger`. It is wired today for
  `task`/`agent` commands (`apps/cli/src/commands/agent.ts:1397`) and workflow run/continue.
  `spur decision run` is not wired.
- **Payload privacy.** Decision inputs can contain task text, and evidence can contain diffs.
  Payloads therefore carry only metadata, and maker errors are redacted and bounded the same way
  as agent stderr.

## 3. Event contract

### 3.1 Names and ordering

| Event | When | Severity |
| --- | --- | --- |
| `decision.rejected` | A caller mistake throws (`UnknownDecisionError`, `UnknownDecisionMakerError`, `DecisionCatalogError`, and — since task 1113 — `DecisionInputError` from pre-validation). It fires before any maker call, and no `start` follows. | error |
| `decision.start` | The decision id, input and maker are resolved (input is validated by `resolveDecisionInput` before this fires), and the maker is about to be called. | info |
| `decision.success` | `source: model`, `reason: accepted` | info |
| `decision.failure` | `source: default`, and the reason is one of `low-confidence`, `no-backend`, `timeout`, `error` | warning (`error` reason → error) |
| `decision.end` | Always fires after `start`, after `success`/`failure`. | info |

The order is fixed: `start → (success | failure) → end`, or `rejected` alone. All events from one
call share an `invocationId`, a uuid minted at `start`. `decision.failure` means a fallback was
served. It does not mean a crash: the caller still receives a value. The `inferSeverity` suffix
rule does not match `failure`, so the producer stamps `severity` in the payload (event-tracking §8).
Since task 1113, a caller-input mistake is caught before `start`: `DecisionService.decide`
pre-validates with the same upstream `resolveDecisionInput` the hub runs, so a bad parameter emits
`rejected` with `errorKind: 'input'` and never opens a lifecycle (no maker call, no `start`). An
unexpected post-start throw is a backstop: the service emits `failure` (`reason: 'error'`) before
`end`, keeping the fixed order.

Correlation sources (task 1113). The engine injects a `__workflowName` run var next to `__runId`
on the run-var seam (`workflow-service.ts`); the shell action additionally exports `__nodeId` to
child env. The workflow `decide` action and the gate build correlation via
`decisionCorrelationFromVars` / `loadRunCorrelation` (read from the run row + effective-vars
snapshot), so `workflowName` and `wbs` are present when the run has them. `wbs` is included only
when it matches `^\d{4}$` and is not `0000` (the placeholder default counts as absent).
Rescue shell steps that call `spur decision run` adopt the run from env: a non-empty `__runId`
makes every command event carry `caller: 'workflow'` plus the full correlation (`__workflowName`,
`__nodeId`, `wbs`); without `__runId` behavior is unchanged (`caller: 'cli'`, no correlation).
Correlation values pass through the standard ledger redaction, so a name containing an
`sk-…`-shaped substring (for example `task-pipeline`) is masked in persisted rows; `runId`,
`nodeId` and `wbs` survive and remain the join keys.

### 3.2 Payloads (metadata-only)

Common fields on every event:

- `invocationId`, `decisionId`, `caller` (`cli` | `workflow` | `gate`)
- `correlation`: `{ runId?, workflowName?, nodeId?, wbs? }`. These come from the caller and are
  never inferred.

Per event:

| Event | Extra fields |
| --- | --- |
| `start` | `type` (`choice` / `noul` / …), `maker`, `makerSource` (`flag` / `config-decision` / `config-default` / `catalog-decision` / `catalog-default`; `inline` for the workflow inline-question path), `catalogLayer`, `inputKeys[]`, `evidenceDigest?` (sha256 of the bounded evidence), `minConfidence` |
| `success` | `value`, `confidence`, `maker` |
| `failure` | `reason`, `fallbackValue`, `confidence \| null`, `maker`, `error?` (redacted, ≤ 512 chars) |
| `end` | `durationMs`, `value`, `source`, `reason`, `maker`, `confidence` |
| `rejected` | `errorKind`, `message` (redacted), `maker?` |

`value` is allowed in payloads because it is always a member of the catalog's closed vocabulary.
Input values and evidence text are never included.

### 3.3 Emission seam

`DecisionService.decide` accepts a per-call `bus` and `context` (`{ caller, correlation }`) on
`DecideOptions`. They are not passed to the constructor, because `getDecisionService` caches one
instance per process. Payloads are built in one module, `packages/app/src/decision/decision-events.ts`.
Until S4, the workflow inline-question `decide` runner emits through the same module (caller
`workflow`, makerSource `inline`; reason `disabled` emits nothing). The flow is:

1. Resolution and input errors emit `rejected` (input mistakes carry `errorKind: 'input'`), then
   rethrow. Input validation runs before `start`.
2. `start` fires around `hub.decide`.
3. The result maps to `success` or `failure` (`failure` also covers an unexpected post-start
   throw: the service emits it with `reason: 'error'` before rethrowing).
4. `end` always fires.

The per-call digest source is `instructions` when it is a non-empty string, else a string
`evidence` input (the gate path), so gate events carry `evidenceDigest`.

Emission is best-effort. A bus listener error never changes the decision result. The new source
`decision` gets a `SOURCE_PROFILES` row with producer `spur` and subsystem `decision`.

`spur decision run` and the workflow `decide` action attach `attachSystemEventLedger` (CLI) or
use the run's existing bus (workflow). This makes the events visible to the Board SSE stream and
to `workflow trace <runId>`.

### 3.4 Reliability report

`spur decision status` gains a reliability view. The CLI surface is chosen in the slice that
implements it, under the existing `decision` noun; any new public verb needs operator consent.
The view reads `system_events` where source = `decision` and groups by `decisionId × maker`. For
each group it reports:

- `samples`
- `acceptedRate`
- `fallbacks{reason: count}`
- `medianConfidence`
- `p50/p95 durationMs`
- `firstSeen`/`lastSeen`

It never calls a maker. A decision with zero rows reports `evidence: none`. This report is the
evidence each adoption slice cites.

### 3.5 Decision log (`decision_logs`)

The `decision.*` lifecycle events of §3.3 are stored in `system_events` with every other source.
They stay metadata-only and are capped together with the rest. `decision_logs` is a separate table
of **decision records, not events**: one row per invocation, holding the input the maker actually
saw, the answer it gave, and where the time went. Its primary key is the `invocationId`, so a record
joins its events. The table is owned by `packages/domain` (migration `0052`), and the DDL is
mirrored in `packages/domain/src/migrations.ts`.

| Column | Content |
| --- | --- |
| `id` | `invocationId` (PK) |
| `decision_id`, `decision_type` | Catalog id or inline-question id, and the decision type |
| `caller` | `cli`, `workflow` or `gate` |
| `run_id`, `workflow_name`, `node_id`, `wbs` | Correlation. Null when the caller did not pass it. |
| `maker_name` | Name of the registered `DecisionMaker` that served the call: the registry key, the same as `ServedDecision.maker`. Not null for served calls; null for a `rejected` call that failed before a maker resolved. Used to compare makers and to select data for maker fine-tuning. |
| `maker_source`, `catalog_layer`, `catalog_source`, `min_confidence` | How the maker was chosen, and catalog resolution |
| `question` | Inline-question text, or null for catalog ids. Redacted, ≤ 2 KiB. |
| `input_json` | The decide input, redacted with the built-in pattern plus configured secrets, ≤ 16 KiB, with a `"truncated": true` marker when cut. Null when `decisions.log` is `metadata`. |
| `input_keys_json`, `evidence_digest` | Always stored, even when input capture is off |
| `outcome` | `accepted`, `fallback` or `rejected` |
| `value`, `fallback_value`, `source`, `reason`, `confidence` | Served result. `value` is null for `rejected`. |
| `error` | Maker error or rejection message, redacted, ≤ 2 KiB |
| `started_at`, `ended_at`, `duration_ms` | Wall clock |
| `phases_json` | `[{ phase, startedAt, durationMs }]` with phase ∈ `resolve`, `evidence`, `maker`, `serve`. Only phases the caller observed are listed; `maker` covers the one maker call (the outcome's `durationMs`). |
| `schema_version` | `1` |

Indexes: `(started_at)`, `(decision_id, started_at)`, `(maker_name, started_at)`, `(run_id)`.

**Write seam.**
- The §3.3 emitter module builds the row and inserts it once, at `end` (or at `rejected`), through
  a `DecisionLogDao` that the caller passes in. That is the CLI context DB, the workflow service DB,
  the inline driver's `projectDb.adapter`, or the gate evaluator's DB.
- The write is best-effort, like emission: a failed insert is warned and swallowed, and it never
  changes the decision result.
- With no DAO passed, nothing is written.

**Retention.** After each insert, rows beyond the newest 10,000 are deleted by `started_at`.

**Config.** One key, `decisions.log`: `full` (default) | `metadata` | `off`.
- `full` writes every column.
- `metadata` writes the row but nulls `input_json` and `question`, for projects whose inputs are too sensitive to keep even after redaction.
- `off` writes no rows.
- Events are not affected by any of these values.

### 3.6 Board Decisions tab

The Observability module gains a `decisions` tab, placed after Routing. It is served by:

- `GET /api/observability/decisions`:
  - Query params: `since`, `decisionId`, `maker` (matches `maker_name`), `outcome`, `caller`, `runId`, `limit` ≤ 200, and `before` (cursor `started_at|id`).
  - Returns `{ rows, summary: { count, acceptedRate, fallbackRate, p95DurationMs }, facets: { decisionIds, makers }, nextCursor }`.
  - List rows omit `input_json`, `question` and `phases_json`.
- `GET /api/observability/decisions/:id`: the full row, or 404.

Both are Zod schemas in `packages/contracts/src/observability.ts`. The handlers in
`apps/server/src/modules/observability/index.ts` call a `packages/app` query service. UI rules live
in root `DESIGN.md` § Product UI — Decisions.

## 4. Workflow audit (`config/workflows/*.yaml`)

Classes:

- **adopt**: an inline AI decision moves to a catalog id.
- **rescue-only**: a deterministic parse stays first, and a catalog decision runs only on output
  the parse cannot classify.
- **keep-deterministic**: an exact check where a model would be a regression.
- **keep-human**: an operator taste gate.

| Workflow · step | Today | Class | Catalog id · choices · fallback |
| --- | --- | --- | --- |
| task-pipeline · `triage` (`task-pipeline.yaml:603`) | catalog `decide` — migrated (task 1114, operator waiver on the evidence bar) | adopted | `task-triage` · low/standard/high · standard |
| task-pipeline · `test-fail-triage` (`task-pipeline.yaml:667`) | catalog `decide` — migrated (task 1115) | adopted | `failure-class` · fix/stop · fix |
| task-pipeline · `review-fail-triage` (`task-pipeline.yaml:750`) | catalog `decide` — migrated (task 1116) | adopted | `review-failure-class` · fix/stop · fix |
| idea-pipeline · recommendation (`idea-pipeline.yaml:146`) | awk over `## Recommendation` → `unknown` pauses | rescue-only | `idea-recommendation` · proceed/reshape/drop · *pause* (fallback writes `unknown`) |
| idea-pipeline · `needs_design` (`:132`) | agent-written JSON. A missing or corrupt file means design. | rescue-only | `needs-design` · design/skip · design |
| history-anatomy · validation verdict (`history-anatomy.yaml:270`) | shell normalization of `Verdict:` lines; rescue shell step after it | rescue-only | `anatomy-validation-verdict` · PASS/FAIL · FAIL. Any exact `Verdict: FAIL` line short-circuits to FAIL without calling a maker. |
| 7 operator gates: idea-eval, feature-check, design-approval, batch-create (`idea-pipeline.yaml:160/299/379/439`), task-pipeline approve (`task-pipeline.yaml:706`), wayfinder (`wayfinder-resolution.yaml:163`), wrapup branch cleanup (`wrapup-pipeline.yaml:443`) | `hitl.confirm` `mode: never` | keep-human (bundled). In evidence-mode overrides, the decision is catalog-backed. | `gate-evidence` · yes/no · defer to operator |
| pr-review preflight/hygiene/precheck; wayfinder precheck/final; wrapup gates; feature-verification; history structure-gate; task-pipeline `command.gate`s | exact status files | keep-deterministic | — |
| feature-lifecycle, task-lifecycle | status transitions | keep-deterministic | — |

The evidence-mode path is `decision-hitl-responder.ts:340,442`. It calls the legacy
`defaultDecisionMaker().choice`. Slice S7 routes it through `DecisionService` so that override
gates get catalog entries and lifecycle events.

## 5. Staged roadmap

| Slice | Delivers | Starts when |
| --- | --- | --- |
| S1 | Event catalog entries, presenters, the `decision` source, and emission in `DecisionService` | now |
| S2 | Ledger wiring for `spur decision run` and the workflow bus, plus correlation passing | S1 |
| S3 | Reliability report over `system_events` | S2 |
| S3b | `decision_logs` table and Board Decisions tab (§3.5–§3.6, task 1100) | S2 |
| S4 | Task 1094: catalog-reference `decide` and the inline deprecation warning (framework; no shipped workflow change) | S2, task 1113 |
| S4a–c | Tasks 1114–1116: migrate `task-triage`, `failure-class`, `review-failure-class`, one per slice | 1094, plus S3 evidence for that id meeting the operator-recorded bar (reachable-maker samples only) |
| S5 | `idea-recommendation` + `needs-design` catalog entries and rescue paths in idea-pipeline | S3 evidence for both ids (gathered with `spur decision run`) |
| S6 | `anatomy-validation-verdict` rescue in history-anatomy | S3 evidence |
| S7 | Evidence-mode operator gates use `gate-evidence` through `DecisionService` | S3 evidence |
| S8 | Remove inline `decide` options, and make validation reject inline questions in shipped workflows (R2) | S4–S7 landed, plus one release of deprecation |

Each slice is reversible on its own. Rescue slices keep the current deterministic route, and the
decision fallback reproduces today's behavior.

## 6. Tradeoffs and risks

- **Seam vs. upstream hooks.** Emitting in the Spur wrapper avoids a library release. If a second
  consumer of `ts-ai-decision` needs events, move them upstream and keep these names.
- **`failure` naming.** The operator's requested name is kept. "Fallback served" is documented
  explicitly so that dashboards do not read it as a crash.
- **Rescue latency.** A maker is called only when the deterministic parse fails, so the happy
  path costs nothing.
- **Report surface (closed 2026-10-07, task 1096).** Chosen: `spur decision status --reliability
  [--since <iso>] [--json]` — `status` already owns readiness reporting, so a flag is the smaller
  surface change; operator consent for the new public flag was granted. A separate `decision
  report` verb was rejected.
