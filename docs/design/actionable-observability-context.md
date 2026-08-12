# Actionable observability context

**Area:** System Event payloads/history/SSE, Spur Board System Events, `spur workflow trace`,
`spur rule trace`.
**Status:** envelope and Board consumers implemented (tasks 0526–0527); trace consumers remain in
task 0528.
**Decision:** ADR-056.

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

## Projection paths

| Path | Input | Output |
| --- | --- | --- |
| Server tap | catalog entry + bus payload + server project context | envelope persisted to `system_events` |
| CLI planning emitter | catalog entry + planning payload + CLI project context | same envelope persisted to `system_events` |
| SSE | catalog entry + bus payload + server project context | same envelope in the event frame |
| History legacy row | catalog entry + raw stored payload + request project context | envelope in the response only |

Envelope construction is failure-isolated. Unknown names use a bounded generic presentation;
malformed optional values are omitted, never fabricated.

The implementation boundary is `packages/app/src/services/system-event-envelope.ts`:
`buildSystemEventEnvelope` is the only fresh-write/SSE builder, while
`projectStoredSystemEventEnvelope` preserves canonical v2 rows and adapts legacy raw rows on read.
Server and CLI composition roots inject the current project and configured secret values. The
catalog in `event-names.ts` supplies each producer package, subsystem, default severity,
description, retained metadata fields, and remediation kind. `RuleService` forwards the upstream
rule-engine events through a Spur-owned bridge that adds the Spur run id, ISO time, severity, and
evaluator while excluding complete finding details.

## Board projection (task 0527)

Desktop columns are `Time | Severity | Event | Summary | Project / Producer | Correlation | Outcome |
Action`. Prefix, tier, actor, sequence, and raw redacted data move to expanded detail. Compact mode
keeps `Time | Event` and stacks summary, producer/correlation, outcome, and action below the name.

The event-name tooltip renders `description`, `fields`, project/producer, and optional action. It is
available by hover and focus, can be pinned for selection/copy, and closes with Escape or outside
activation. Raw redacted JSON stays in expanded detail rather than dominating the tooltip.

`parseHistoryRow` and the SSE parser narrow the envelope once at the network boundary. The parsed
semantic view feeds both table and tooltip; canonical `data` is unwrapped into the existing
`SystemEventRow.payload` field so the Jobs and Tasks tabs keep their established input contract. The
full envelope remains attached only for expanded System Events detail. Legacy or malformed shapes
produce explicit `unavailable` values and no action.

## Trace DTO additions (pending task 0528)

Existing keys are retained. Additions are optional so stored rows with missing metadata remain valid.

```ts
interface TraceProjectContext { name: string; root: string }
interface TraceNextAction { label: string; kind: 'command' | 'path'; value: string }

interface WorkflowTraceEntryAdditions {
    project?: TraceProjectContext;
    durationMs?: number;
    nextAction?: TraceNextAction;
}

interface WorkflowActionTimelineAdditions {
    startedAt?: string;
    completedAt?: string;
    invocation?: { agent?: string; model?: string; summary?: string };
    error?: string;
    nextAction?: TraceNextAction;
}

interface RuleTraceContextAdditions {
    project?: TraceProjectContext;
    source?: { kind: string; value?: string };
    nextAction?: TraceNextAction;
}
```

Workflow action `result_json` is projected through an allow-list; arbitrary stdout/stderr never
enters trace output. A running run may point to the existing `trace --follow` command or run log; a
failed action may point to an existing partial-work artifact. Rule trace reconstructs a command only
when the persisted source kind/value is sufficient; otherwise it prints the source reference with no
fabricated action.
