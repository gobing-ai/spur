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
| `decision.rejected` | A caller mistake throws (`UnknownDecisionError`, `UnknownDecisionMakerError`, `DecisionCatalogError`). It fires before any maker call, and no `start` follows. | error |
| `decision.start` | The decision id and maker are resolved, and the maker is about to be called. | info |
| `decision.success` | `source: model`, `reason: accepted` | info |
| `decision.failure` | `source: default`, and the reason is one of `low-confidence`, `no-backend`, `timeout`, `error` | warning (`error` reason → error) |
| `decision.end` | Always fires after `start`, after `success`/`failure`. | info |

The order is fixed: `start → (success | failure) → end`, or `rejected` alone. All events from one
call share an `invocationId`, a uuid minted at `start`. `decision.failure` means a fallback was
served. It does not mean a crash: the caller still receives a value. The `inferSeverity` suffix
rule does not match `failure`, so the producer stamps `severity` in the payload (event-tracking §8).

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

1. Resolution errors emit `rejected`, then rethrow.
2. `start` fires around `hub.decide`.
3. The result maps to `success` or `failure`.
4. `end` always fires.

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

## 4. Workflow audit (`config/workflows/*.yaml`)

Classes:

- **adopt**: an inline AI decision moves to a catalog id.
- **rescue-only**: a deterministic parse stays first, and a catalog decision runs only on output
  the parse cannot classify.
- **keep-deterministic**: an exact check where a model would be a regression.
- **keep-human**: an operator taste gate.

| Workflow · step | Today | Class | Catalog id · choices · fallback |
| --- | --- | --- | --- |
| task-pipeline · `triage` (`task-pipeline.yaml:575`) | inline `decide` | adopt | `task-triage` · low/standard/high · standard |
| task-pipeline · `test-fail-triage` (`:614`) | inline `decide` | adopt | `failure-class` · fix/stop · fix |
| task-pipeline · `review-fail-triage` (`:683`) | inline `decide` | adopt | `review-failure-class` · fix/stop · fix |
| idea-pipeline · recommendation (`idea-pipeline.yaml:146`) | awk over `## Recommendation` → `unknown` pauses | rescue-only | `idea-recommendation` · proceed/reshape/drop · *pause* (fallback writes `unknown`) |
| idea-pipeline · `needs_design` (`:132`) | agent-written JSON. A missing or corrupt file means design. | rescue-only | `needs-design` · noul · yes |
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
| S4 | Task 1094: catalog-reference `decide`, the three task-pipeline decision points, and the inline deprecation warning | S3 report shows evidence for `task-triage`, `failure-class`, `review-failure-class` |
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
