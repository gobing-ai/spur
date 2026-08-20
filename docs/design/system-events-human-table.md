# System Events human table projection

**Area:** Observability > System Events table cells, presenter helpers, catalog retention, Board column mapping.
**Status:** built (J91; ADR-073/074; task 0605).
**Authority:** decisions in `00` (ADR-073/074); module boundaries in `03 §16.2`; this satellite owns shapes. Envelope v2 and projection paths remain [`actionable-observability-context.md`](actionable-observability-context.md). Per-event 5W1H / presenter matrix remain [`event-tracking.md`](event-tracking.md).

J9 stays done. J91 extends that presenter registry; it does not reopen J9 or invent envelope v3. Feature id **J91** is the allocated child under J9 because J already has nine children (DD-14); a sibling `J10` is illegal. Scope still forbids rewriting J9's shipped work.

## Invariants

- Table cells (Summary, Correlation, Action, Agent) contain no opaque id.
- Tooltip fields, tooltip footer remediation, and expanded payload remain the home for raw ids and commands that embed them.
- `SystemEventEnvelopeV2.context` stays `{ project, producer, correlation }`.
- History reads re-project `presentation` only (ADR-067). Missing historical `workflowName`, `nodeLabel`, or agent identity is omitted, never invented (ADR-068).
- The Board maps server-projected presentation into columns. It does not recover names or agent identity from raw payload keys, and it does not hide ids by client-only UUID stripping.

## Opaque id

A display token is **opaque** when it matches any of:

| Kind | Shape |
| --- | --- |
| UUID | `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` (any case) |
| Live token | prefix `live-` |
| Machine correlator used as the cell value | `eventId`, ledger row id, `runId`, `executionId`, `actionId` |

Not opaque: workflow definition name (`idea-pipeline`), step label / declared state id, action `kind` (`agent.run`), entity WBS / feature id (`0601`, `J91`), numeric `sequence`.

Shared helper `looksLikeOpaqueId(value: string): boolean` lives next to the presenter helpers in `event-names.ts`. Presenters and the table projector call it; the Board does not re-derive it.

## Presentation shape (additive)

`schemaVersion` remains `2`. Optional presentation keys join `severity` / `summary` / `description` / `fields` / `outcome` / `action`:

```ts
interface SystemEventEnvelopeV2 {
    schemaVersion: 2;
    data: Record<string, unknown> | null;
    context: {
        project: { name: string; root: string };
        producer: { package: SystemEventProducerPackage; subsystem: string };
        correlation: SystemEventCorrelationContext; // unchanged; ids stay here
    };
    presentation: {
        severity: 'info' | 'warning' | 'error';
        summary: string;
        description: string;
        fields: Array<{ label: string; value: string }>; // tooltip; may include raw ids
        outcome?: string;
        action?: { label: string; kind: 'command' | 'filter' | 'path'; value: string }; // tooltip remediation
        correlators?: string; // table Correlation cell
        actionLabel?: string; // table Action cell
        agent?: string; // table Agent cell
    };
}
```

`PRESENTATION_KEYS` and `hasOnlyKeys` on `presentation` accept the three new optional keys. `context` stays closed. Stored v2 `presentation` is discarded on read (ADR-067), so no ledger rewrite.

## Workflow SUMMARY grammar

Every cataloged `workflow.*` presenter emits:

```text
[workflow] {workflowName} · {humanStep} {result}
```

| Slot | Source | Missing |
| --- | --- | --- |
| `workflowName` | bounded `data.workflowName` (definition file/name) | omit, including the ` · ` separator |
| `humanStep` | `data.nodeLabel` (definition `description`, else declared state id) | omit, including the ` · ` |
| `result` | existing truthful suffix (`started`, `done`, `failed`, `from -> to`, …) | keep the prefix `[workflow]` plus any remaining slots |

Never substitute `runId`, `eventId`, `actionId`, or a UUID-shaped `node`. Action `kind` is not a substitute for `humanStep` in Summary (it may appear in `actionLabel`).

Helpers replace today's fallbacks:

```ts
function humanWorkflowTitle(input: SystemEventPresentationInput): string
    // data.workflowName when present and not opaque; else ''

function humanStepLabel(data: Readonly<Record<string, unknown>> | null): string | undefined
    // data.nodeLabel when present and not opaque; else undefined
    // does not read kind or UUID-shaped node
```

Operator pin: `workflow.action.start` / `workflow.action.started` with `workflowName=idea-pipeline` and a long `nodeLabel` must produce a Summary that contains neither `runId` nor `eventId`.

## Table projector

One envelope-level function runs **after** the event-name presenter. Presenters keep owning description, tooltip `fields`, `summary`, and outcome. They do not each encode the opaque-id table policy.

```ts
function projectTablePresentation(input: {
    data: Readonly<Record<string, unknown>> | null;
    correlation: Readonly<SystemEventCorrelationContext>;
    presentation: SystemEventEnvelopeV2['presentation'];
    actor?: string | null; // persistence-row actor (tap extract / history column); not a context key
}): Pick<SystemEventEnvelopeV2['presentation'], 'correlators' | 'actionLabel' | 'agent'>
```

`buildSystemEventEnvelope` / `projectStoredSystemEventEnvelope` pass optional `actor` from the tap or history row. It never enters `context`.

| Key | Composition | Forbidden |
| --- | --- | --- |
| `correlators` | Join human facts already in bounded `data`: workflow name, step label, action `kind`, entity `kind:id`. Numeric `sequence` may remain. | `runId`, `executionId`, `actionId`, `eventId`, UUID `node`, `live-` tokens, `context.correlation` UUIDs |
| `actionLabel` | Action `kind`, entity, or a short human verb | `presentation.action.value` when it embeds a UUID (`spur workflow trace <runId>`) |
| `agent` | See projection order below | `context.producer.package` / `subsystem` |

Empty `correlators` / `actionLabel` render as `-` (existing missing-projection sentinel). Empty `agent` renders as a blank cell (the event has no executor — not a missing projection).

`presentation.action` (remediation object) is unchanged and remains tooltip / expanded-detail only.

## Agent projection order

First non-empty, non-opaque string wins:

1. `data.routing.executor`
2. `data.agent`
3. `data.metadata.agent`
4. persistence-row `actor` when that actor is an executor or agent id: non-empty, not opaque, not a `SystemEventProducerPackage` string, matching `^[A-Za-z][A-Za-z0-9._-]*$`

Otherwise omit `presentation.agent`. Pure engine rows (`workflow.node.enter`, `workflow.transition`) stay empty even when `context.producer` is `@gobing-ai/ts-dual-workflow-engine`.

## Retention vs tooltip fields

Today `presenter.fields` is both the tooltip list (max 8) and the metadata allow-list. Agent paths must survive `projectAllowedMetadata` without crowding ids out of the tooltip.

```ts
interface SystemEventPresenterSpec {
    description: string;
    fields: readonly SystemEventMetadataField[]; // tooltip; at most eight
    retain?: readonly SystemEventMetadataField[]; // extra allow-list; not tooltip
    summary(input: SystemEventPresentationInput): string;
    outcome: SystemEventOutcomeSpec;
}
```

Catalog `metadataFields` = `fields` ∪ `retain`. `workflow.action.*` (and other agent-executed workflow rows) **retain** `metadata.agent`, `metadata.role`, `routing.executor`. Tooltip `fields` may keep `runId` / `node` / `actionId`.

Do not add those keys to `CORE_METADATA_PATHS` (that would retain them on every event).

## Producer stamp (Spur-first)

Identity is stamped at an existing Spur fan-in, not inferred later by the Board:

| Fan-in | Gap |
| --- | --- |
| `decorateWorkflowEvent` / `withWorkflowIdentity` | Always wrap engine-native emits. Today's `workflow-service` adapter bus wraps only when `opts.extensions` is set. |
| `projectActionMetadata` | Already copies `options.agent` / `options.role` onto `metadata.*`; presenters must retain those paths. |
| `withInvokeRouting` / agent-service invoke bridge | Already merges `routing.executor` onto `agent.invoke.*` and `workflow.agent`. |

A ts-libs producer-contract upgrade is in scope **only** when an agent-executed event that Spur already fans in still cannot emit any of the four Agent sources. If required, add fields to the domain payload (`data`), not a new envelope version.

Do not invent names for historical rows that never stored them.

## Board mapping

Desktop columns become:

`Time | Severity | Event | Summary | Producer | Correlation | Agent | Outcome | Action`

| Column | Server field | Client must not |
| --- | --- | --- |
| Summary | `presentation.summary` | rewrite `[workflow] <uuid>` |
| Correlation | `presentation.correlators` | concatenate `context.correlation` UUIDs |
| Agent | `presentation.agent` | read `event.actor` / `data.*` as a fallback |
| Action | `presentation.actionLabel` | render `presentation.action.value` (remediation stays in tooltip) |
| Producer | `context.producer` package / subsystem | use producer as Agent |

`parseSystemEventView` remains the single network-boundary narrow. Compact (≤639 px) keeps `Time | Event` and stacks Summary, Correlation, Action, and Agent under the name. Tooltip title identity (J9) may still use run/execution/action ids. Visual tokens stay in root `DESIGN.md`.

## Rejected alternatives

| Option | Why rejected |
| --- | --- |
| Board-only UUID stripping / client SUMMARY rewrite | Violates ADR-066; SSE, history, and the table diverge; cannot recover `idea-pipeline` the presenter never emitted. |
| `context.human` / `context.executor` | Opens the closed context set; historical v2 rows cannot gain the keys without a rewrite or an equivalent presenter. |
| Reserved tooltip-field label `"Agent"` promoted by the Board | Couples the 8-field tooltip cap to the column contract; Board still special-cases a label. |
| Per-presenter `correlators` / `actionLabel` / `agent` | Copies opaque-id policy across 71 entries. One envelope projector is the deep module. |

## Test pins

- `workflow.action.start` / `started` with `workflowName=idea-pipeline` and a long `nodeLabel`: Summary matches the grammar; contains neither `runId` nor `eventId`.
- Correlation and Action strings contain no UUID and no `live-` token.
- Action is not `spur workflow trace <runId>`. That command remains on `presentation.action` for the tooltip.
- Agent from `routing.executor`, then `data.agent`, then `metadata.agent`, then executor-shaped row `actor`; empty for `workflow.node.enter` / `workflow.transition`.
- `context.producer.package` is never the Agent value.
- History v2 row without `workflowName` / `nodeLabel` / agent omits those slots; stored `data` / `context` bytes unchanged.
- Compact layout still omits opaque ids from stacked cells.

## Implementation seams (for decomposition)

1. Opaque-id helpers + workflow SUMMARY (no-id `humanWorkflowTitle` / `humanStepLabel`).
2. Envelope table projector (`correlators`, `actionLabel`) + Board Correlation/Action mapping.
3. `retain` on presenters + `presentation.agent` + Agent column.
4. Producer decoration-gap audit (`withWorkflowIdentity` always-on); ts-libs only if seam 3 cannot find a fact.
