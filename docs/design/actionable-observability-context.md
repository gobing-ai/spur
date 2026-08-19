# Actionable observability context

**Area:** System Event payloads/history/SSE, Spur Board System Events, `spur workflow trace`,
`spur rule trace`.
**Status:** J5 foundation implemented (tasks 0526–0528); J9 semantic presentation accepted design, not yet built.
**Decision:** ADR-056, amended by ADR-066/067/068.

## System Event envelope

New persisted and streamed payloads use schema version 2. Legacy raw objects are wrapped into this
shape on read.

```ts
interface SystemEventEnvelopeV2 {
    schemaVersion: 2;
    data: Record<string, unknown> | null;
    context: {
        project: { name: string; root: string };
        producer: { package: SystemEventProducerPackage; subsystem: string };
        correlation: {
            runId?: string;
            executionId?: string;
            actionId?: string;
            entityKind?: string;
            entityId?: string;
            jobId?: string;
            sequence?: number;
        };
    };
    presentation: {
        severity: 'info' | 'warning' | 'error';
        summary: string;
        description: string;
        fields: Array<{ label: string; value: string }>;
        outcome?: string;
        action?: { label: string; kind: 'command' | 'filter' | 'path'; value: string };
    };
}
```

`SystemEventProducerPackage` is a closed union of `spur`, `@gobing-ai/ts-infra`,
`@gobing-ai/ts-runtime`, `@gobing-ai/ts-ai-runner`, `@gobing-ai/ts-rule-engine`, and
`@gobing-ai/ts-dual-workflow-engine`. Catalog metadata supplies package, subsystem, default
severity, description, retained data keys, and remediation kind.

`data` is the redacted domain payload. `metadata-only` entries retain only catalog-declared scalar
metadata and bounded nested metadata objects; message bodies, prompts, command environment, raw
business payloads, complete rule finding arrays, and stdout/stderr are excluded. Configured secrets
and credential patterns are redacted before the per-string and aggregate bounds.

## System Event semantic presentation (accepted design — J9; not yet built)

The v2 envelope shape does not change. The presentation step changes from generic source-family formatting to the
exhaustive event-name presenter contract in [`event-tracking.md`](event-tracking.md) §11.

Projection order is fixed:

1. apply the event's catalog payload policy, redaction, and recursive bounds;
2. extract and bound correlation;
3. pass only bounded `data` and correlation to the event-name presenter;
4. compose severity, authored description, event-specific fields, summary, optional outcome, and remediation action;
5. re-apply presentation string/field-count bounds before persistence, streaming, or response.

Each presenter declares at most eight ordered tooltip fields; the list is the intentional display set, not a blind
slice of a larger source-family list. Lower-value bounded data stays in expanded detail. The generic presenter is
reserved for unknown out-of-catalog names and failure isolation.

## Projection paths

| Path | Input | Output |
| --- | --- | --- |
| Server tap | catalog entry + bus payload + server project context | envelope persisted to `system_events` |
| CLI planning emitter | catalog entry + planning payload + CLI project context | same envelope persisted to `system_events` |
| SSE | catalog entry + bus payload + server project context | same envelope in the event frame |
| History legacy row | catalog entry + raw stored payload + request project context | envelope in the response only |
| History canonical v2 row (J9 design) | stored bounded `data` + stored `context` | same facts + current `presentation` in the response only |

Envelope construction is failure-isolated. Unknown names use a bounded generic presentation;
malformed optional values are omitted, never fabricated.

The current J5 implementation boundary is `packages/app/src/services/system-event-envelope.ts`:
`buildSystemEventEnvelope` is the only fresh-write/SSE builder, while
`projectStoredSystemEventEnvelope` preserves canonical v2 rows and adapts legacy raw rows on read. J9 changes the
second behavior per ADR-067: a valid stored v2 row keeps the exact stored `data` and `context` values and receives a
new `presentation` from the current presenter. The returned object is response-only; the DAO performs no update.
Server and CLI composition roots inject the current project and configured secret values. The
catalog in `event-names.ts` supplies each producer package, subsystem, a last-resort default
severity, description, retained metadata fields, and remediation kind. Upstream ts-libs
producers stamp `severity` on the bus payload at emit time; the envelope prefers that field
over the catalog heuristic. `RuleService` forwards the upstream
rule-engine events through a Spur-owned bridge that adds the Spur run id, ISO time, severity, and
evaluator while excluding complete finding details.

## Routing decision attribution (task 0545)

Agent-run lifecycle rows carry the routing decision as envelope metadata — no new table, no new
column, no historical rewrite. `agent.invoke.start` / `agent.invoke.exit` payloads gain a
`routing` block (`role?`, `tier`, `executor`, `source`), merged at the per-run invoke bridge in
`AgentService.executeRun` from the resolution funnel's result — `resolveExecutorSelector` and
siblings are the only place that knows role, tier, executor, and source together, so the facts are
recorded where they are decided and never re-derived downstream. The same `routing` block rides the
`AgentExecutionStartedEvent` (`kind: 'started'`) so the observer path (`workflow.agent`) carries it
too.

Selection source distinguishes the recorded paths (R5 coverage):

| Source | How the executor was selected |
| --- | --- |
| `role` | Declared role (`--role <role>` / `--agent <role>`) or inherited `SPUR_ROLE` resolution |
| `explicit` | Explicit `--agent <executor>` pin |
| `default` | `agent.default` selector (a role value routed through the default path) |
| `stage` / `phase` / `priority` | Stage-registry model policy, phase mapping, legacy Tier-1 priority |

Escalation is its **own** record — `agent.invoke.escalated`, a default-tier catalog entry emitted
by the Spur agent-service bridge (producer-attributed to `spur` / `agent-runner`, not the
ts-ai-runner family owner). Its payload carries `fromExecutor`, `fromTier`, `toExecutor`, `toTier`,
and `trigger` (the objective signal that caused it: `gate-fail`, `timeout`,
`insufficient-evidence`, `retry-exhausted`, plus the class-level `resource-exhaustion` and `auth`
members of the stage-registry vocabulary). A run that never escalates emits no such row — absence
is distinguishable from a null-valued record (R2). The starting decision and each escalation are
distinct facts with distinct timestamps; collapsing them would destroy the "routing started too
cheap" signal.

Every attribution row carries `run_id` (the minted run id threads through the invoke
correlation, task 0557; escalation payloads carry `runId` directly), so 0546 can aggregate by
selection source and 0547 can join to the history plane. Attribution is identifiers, tiers, and
counts only — prompt text, command lines, and configured secret values are excluded by the
catalog's metadata allow-list and recursive redaction before persistence (R4). Pre-existing rows
without `routing` project cleanly through `projectStoredSystemEventEnvelope` (R3).

## Board projection (task 0527)

Desktop columns are `Time | Severity | Event | Summary | Producer | Correlation | Outcome |
Action`. Prefix, tier, actor, sequence, project name/root, and raw redacted data move to expanded
detail. Compact mode keeps `Time | Event` and stacks summary, producer/correlation, outcome, and
action below the name. Project is omitted from the table because it is injected current-project
context and is constant for a Board view.

The event-name tooltip renders `description`, `fields`, producer, and optional action. It is
available by hover and focus, can be pinned for selection/copy, and closes with Escape or outside
activation. Raw redacted JSON stays in expanded detail rather than dominating the tooltip.

J9 changes only the generic tooltip shell. Its title is `eventName · correlator`, choosing entity, run, execution,
action, then job identity and finally the persisted history-row id. If a live row has none of those stable values, the
title remains the event name until the persisted row is read; the client never manufactures an id. Copy/pin guidance
moves from the title to a muted footer whose text reflects hover versus pinned mode. Visual tokens and interaction
placement remain owned by root `DESIGN.md`.

`parseHistoryRow` and the SSE parser narrow the envelope once at the network boundary. The parsed
semantic view feeds both table and tooltip; canonical `data` is unwrapped into the existing
`SystemEventRow.payload` field so the Jobs and Tasks tabs keep their established input contract. The
full envelope remains attached only for expanded System Events detail. Legacy or malformed shapes
produce explicit `unavailable` sentinels and no action. The Board renders those sentinels as `-`.

## Trace DTO additions (task 0528)

Existing keys are retained. The read projector supplies additions for every row; missing stored
metadata becomes `null` or `unavailable`.

```ts
interface TraceProjectContext { name: string; root: string }
interface TraceNextAction { label: string; kind: 'command' | 'path'; value: string }

interface WorkflowTraceEntryAdditions {
    project: TraceProjectContext;
    durationMs: number | null;
    outcome: string;
    nextAction?: TraceNextAction;
}

interface WorkflowActionTimelineAdditions {
    durationMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    outcome: string;
    result: Record<string, string | number | boolean> | null;
    invocation: Record<string, string | number | boolean> | null;
    error: string | null;
    artifacts: string[];
    nextAction?: TraceNextAction;
}

interface RuleTraceRunAdditions {
    project: TraceProjectContext;
    source: { kind: string; value: string };
    timing: { startedAt: string; completedAt: string | null; durationMs: number | null };
    policy: { failOn: string; stopOnFirst: string; fixMode: string; dryRun: boolean };
    outcome: string;
    nextAction?: TraceNextAction;
}
```

Workflow action `result_json` is projected through an allow-list; arbitrary stdout/stderr never
enters trace output. A running run may point to the existing `trace --follow` command or run log; a
failed action may point to an existing partial-work artifact. Rule trace reconstructs a command only
when the persisted source kind/value is sufficient; otherwise it prints the source reference with no
fabricated action.

Workflow list, detail, and follow human output render the same normalized run fields. Transition
rows retain both endpoints and their persisted timestamp; action rows expose id, node, status,
timestamps, allow-listed invocation fields, outcome/error/cost, and existing artifacts. JSON keeps
all pre-existing keys and adds these fields.

Rule list/detail projections retain the DAO keys and add project, normalized source/timing/policy,
outcome, and exact action when reconstructable. Evaluation rows retain severity, evaluator,
timestamps, counts, and bounded error. Persisted finding/fix JSON keeps only structural fields;
finding messages and replacement bodies are excluded. Malformed metadata becomes `{}` or `null`.
