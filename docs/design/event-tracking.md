# Event tracking — System Event 5W1H SSOT

**Area:** System Event catalog (`SYSTEM_EVENT_CATALOG`), 5W1H payload contract, `*.updated` field-level diff, `workflow.*` legibility.
**Status:** current audit baseline (task 0597) + J9 built (tasks 0601/0602, ADR-066/067/068); J91 table-legibility built (ADR-073/074; task 0605).
**Authority:** elaborates `docs/04_DESIGN.md` §7.9 (authoritative on the catalog surface) and `docs/design/actionable-observability-context.md` (authoritative on the v2 envelope and projection policy). This doc does **not** restate their contracts — it defines the *per-event* contract the other two deliberately leave abstract. On conflict, `04_DESIGN.md` §7.9 wins (lower number wins on content, constitution §4.1); on envelope mechanics, `actionable-observability-context.md` wins.

## 1. Scope and non-goals

The task-0597 baseline is an **audit + SSOT only**: it changed no emitter, catalog entry, or Board component. J9 now owns the accepted remediation design in §§6–11. This document answers two questions and locks the contract that closes them:

1. Which of the 71 cataloged events actually answer who/what/when/where/why/how?
2. What convention closes the two concrete operator complaints — `task.updated` never says *what* changed, and `workflow.*` renders raw ids?

J9 (0601/0602) shipped that shape: producer enrichment, event-specific presenters, history-read reprojection, and a Board free of event-specific switches. This document remains the per-event SSOT; it is not a second implementation.

## 2. Root cause (verified — do not re-derive)

Three structural defects, all confirmed at `path:line`:

1. **The catalog is source-parameterized, not event-parameterized.** `event-names.ts:254` (`event(name, source, renderer, …)`) builds each entry by spreading `SOURCE_PROFILES[source]` (`event-names.ts:262`). There are 12 sources → **12 distinct `metadataFields` shapes for 71 events**. All six planning events inherit the identical list `entity.kind, entity.id, field, from, to`. An event cannot describe itself when its presentation is inherited from its family.
2. **Descriptions are string-mangled.** `event-names.ts:296` (`describeEvent`) returns `` `${words} lifecycle event.` ``. `task.updated` is documented as *"Task updated lifecycle event."* — zero information, looks authored. Every description in the catalog is generated.
3. **The what-changed payload is never emitted.** `planning-write-service.ts:447-453` constructs every planning event as `{ event, entity{kind,id}, at, from?, to? }`. `from`/`to` are set **only** on a status transition (`planning-write-service.ts:451-452`). `data` exists on `PlanningEvent` (`planning-write-service.ts:115`) and is **never populated**; `PlanningEvent` has **no `field` property**. So the `field` the catalog advertises (`event-names.ts` planning profile, `field('field', 'Field')`) is unpopulatable by construction — a contract lie, not an omission. A `--section Solution` write emits `{event, entity, at}` and nothing else.

## 3. The 5W1H contract

Every cataloged event must answer six questions. "Present" means the payload carries the fact and the catalog/renderer surfaces it; "partial" means the fact exists but is machine-opaque or only sometimes present; "absent" means it is never captured.

| Dimension | Question | Present looks like |
| --- | --- | --- |
| **Who** | Which actor/executor/role did this? | `actor`, `agentId`, `memberId`, `routing.role`, `label` |
| **What** | What specifically changed/occurred (not the noun)? | `field`+`from`/`to`, `kind`, `status`, `phase`, `from`/`to`, `type` |
| **When** | When, and how long? | `at`/occurred_at, `durationMs`, `createdAt` |
| **Where** | Which project/run/task/feature? | `entity.kind`/`entity.id`, `runId`, `jobId`, `threadId`, `cwd` |
| **Why** | What triggered it (command, guard, schedule, human)? | `trigger`, `reason`, `error`, `selection source` |
| **How** | By which mechanism/stage? | `attempt`/`maxRetries`, `exitCode`/`signal`, `from`/`to`, `phase`, `kind` |

**Legend:** `P` present · `~` partial · `–` absent.

## 4. 5W1H matrix (71/71)

Scores are family-uniform **by construction** — the defect from §2.1 means presentation is inherited per source, not per event. Emitter lines are the Spur-side emit/wiring point; ts-libs producers stamp the payload upstream and are attributed via the bridge.

| # | Event | Emitter (`path:line`) | Who | What | When | Where | Why | How |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `task.created` | `planning-write-service.ts:447` (CLI) / `planning-events.ts:50` (server) | – | ~ | P | P | – | – |
| 2 | `task.updated` | `planning-write-service.ts:447` | – | ~ | P | P | – | ~ |
| 3 | `task.transitioned` | `planning-write-service.ts:447` | – | ~ | P | P | ~ | P |
| 4 | `feature.created` | `planning-write-service.ts:447` | – | ~ | P | P | – | – |
| 5 | `feature.updated` | `planning-write-service.ts:447` | – | ~ | P | P | – | ~ |
| 6 | `feature.transitioned` | `planning-write-service.ts:447` | – | ~ | P | P | ~ | P |
| 7 | `queue.consumer.started` | `context.ts:411` → ts-infra `QueueConsumer` | – | ~ | P | ~ | – | ~ |
| 8 | `queue.consumer.stopped` | `context.ts:411` → ts-infra `QueueConsumer` | – | ~ | P | ~ | – | ~ |
| 9 | `queue.job.enqueued` | `context.ts:411` → ts-infra `JobQueue` | – | ~ | P | ~ | – | ~ |
| 10 | `queue.job.completed` | `context.ts:411` → ts-infra `JobQueue` | – | ~ | P | ~ | – | P |
| 11 | `queue.job.failed` | `context.ts:411` → ts-infra `JobQueue` | – | ~ | P | ~ | P | P |
| 12 | `queue.job.retrying` | `context.ts:411` → ts-infra `JobQueue` | – | ~ | P | ~ | P | P |
| 13 | `queue.stats` | `context.ts:411` → ts-infra `QueueConsumer` | – | ~ | P | ~ | – | ~ |
| 14 | `scheduler.job.executed` | `context.ts:411` → ts-infra scheduler | – | ~ | P | ~ | – | P |
| 15 | `message.sent` | `team-service.ts:314` | ~ | ~ | P | ~ | – | – |
| 16 | `message.replied` | `team-service.ts:314` | ~ | ~ | P | ~ | – | – |
| 17 | `process.spawned` | `supervisor-service.ts:244` | ~ | ~ | ~ | – | – | ~ |
| 18 | `process.exited` | `supervisor-service.ts:263` | ~ | ~ | ~ | – | P | P |
| 19 | `process.stopped` | `supervisor-service.ts:353` | ~ | ~ | ~ | – | P | P |
| 20 | `process.started` | `context.ts:474` → ts-runtime `ProcessExecutor` | ~ | ~ | ~ | – | – | ~ |
| 21 | `agent.invoke.start` | `agent-service.ts:709` (bridge) + `event-bridge.ts:43` | ~ | ~ | P | ~ | ~ | ~ |
| 22 | `agent.invoke.exit` | `agent-service.ts:709` (bridge) + `event-bridge.ts:43` | ~ | ~ | P | ~ | ~ | P |
| 23 | `agent.invoke.escalated` | `agent-service.ts:1060` | ~ | P | P | ~ | P | P |
| 24 | `agent.invoke.exhausted` | `agent-service.ts:1032` | ~ | P | P | ~ | P | P |
| 25 | `agent.started` | `context.ts:460` → ts-ai-runner | ~ | ~ | P | ~ | – | ~ |
| 26 | `agent.stopped` | `context.ts:460` → ts-ai-runner | ~ | ~ | P | ~ | – | ~ |
| 27 | `agent.message.sent` | `context.ts:460` → ts-ai-runner | ~ | ~ | P | ~ | – | ~ |
| 28 | `team.up` | `team-service.ts:801` | ~ | ~ | P | ~ | – | ~ |
| 29 | `team.down` | `team-service.ts:831` | ~ | ~ | P | ~ | – | ~ |
| 30 | `team.member.assigned` | `team-service.ts:521` | ~ | ~ | P | ~ | – | ~ |
| 31 | `team.member.started` | `team-service.ts:959` / `supervisor-service.ts:253` | ~ | ~ | P | ~ | – | ~ |
| 32 | `team.member.stopped` | `team-service.ts:969` / `supervisor-service.ts:273` | ~ | ~ | P | ~ | – | ~ |
| 33 | `history.import.completed` | `apps/cli/src/commands/history.ts:364` | – | ~ | P | ~ | ~ | P |
| 34 | `history.analyze.completed` | `apps/cli/src/commands/history.ts:378` | – | ~ | P | ~ | ~ | P |
| 35 | `history.daily.failed` | `apps/cli/src/commands/history.ts:336` / `:390` | – | ~ | P | ~ | P | P |
| 36 | `history.refresh.enqueued` | `apps/cli/src/history-refresh.ts:47` | – | ~ | P | ~ | P | ~ |
| 37 | `rule.run.start` | `rule-service.ts:523` | ~ | ~ | P | ~ | – | ~ |
| 38 | `rule.eval.start` | `rule-service.ts:532` | ~ | ~ | P | ~ | – | ~ |
| 39 | `rule.eval.done` | `rule-service.ts:540` | ~ | ~ | P | ~ | – | P |
| 40 | `rule.eval.error` | `rule-service.ts:548` | ~ | ~ | P | ~ | P | P |
| 41 | `rule.run.done` | `rule-service.ts:557` | ~ | ~ | P | ~ | – | P |
| 42 | `workflow.run.started` | `observability.ts:222` (adapter) / ts-dual-workflow-engine | ~ | ~ | P | P | – | ~ |
| 43 | `workflow.run.done` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | – | P |
| 44 | `workflow.run.failed` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 45 | `workflow.run.finalized` | `observability.ts:230` | ~ | ~ | P | P | – | P |
| 46 | `workflow.run.paused` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 47 | `workflow.run.resumed` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 48 | `workflow.run.reseeded` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 49 | `workflow.node.enter` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | – | ~ |
| 50 | `workflow.phase` | `observability.ts:242` / ts-dual-workflow-engine | ~ | ~ | P | P | – | ~ |
| 51 | `workflow.node.transition` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | ~ | P |
| 52 | `workflow.transition` | `observability.ts:247` / `observability.ts:265` | ~ | ~ | P | P | ~ | P |
| 53 | `workflow.transition.requested` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | ~ | ~ |
| 54 | `workflow.transition.denied` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 55 | `workflow.action.start` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | – | ~ |
| 56 | `workflow.action.started` | `observability.ts:284` | ~ | P | P | P | – | P |
| 57 | `workflow.action.done` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | – | P |
| 58 | `workflow.action.finished` | `observability.ts:312` | ~ | P | P | P | – | P |
| 59 | `workflow.action.failed_continue` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | P |
| 60 | `workflow.guard.evaluated` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | P | P | ~ |
| 61 | `workflow.hitl.ask` | `hitl-confirm.ts:29` / `hitl-select.ts:35` / `hitl-input.ts:29` | ~ | ~ | P | ~ | – | ~ |
| 62 | `workflow.hitl.response` | `hitl-confirm.ts:42` / `hitl-select.ts:49` / `hitl-input.ts:42` | ~ | ~ | P | ~ | ~ | ~ |
| 63 | `workflow.hitl.note` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | ~ | ~ | ~ |
| 64 | `workflow.custom` | ts-dual-workflow-engine → `workflow-service.ts:563` | ~ | ~ | P | ~ | – | ~ |
| 65 | `workflow.agent` | `agent-run.ts:260` | ~ | ~ | P | P | – | P |
| 66 | `workflow.steering` | ts-dual-workflow-engine bridge → `workflow-service.ts:563` | ~ | ~ | P | P | ~ | ~ |
| 67 | `api.request.error` | `apps/server/src/middleware/error-handler.ts:198` | – | ~ | P | ~ | P | P |
| 68 | `bus.emit.done` | `context.ts:411` → ts-infra `EventBus` | – | ~ | P | ~ | – | ~ |
| 69 | `bus.emit.noop` | `context.ts:411` → ts-infra `EventBus` | – | ~ | P | ~ | – | ~ |
| 70 | `bus.handler.error` | `context.ts:411` → ts-infra `EventBus` | – | ~ | P | ~ | P | P |
| 71 | `bus.handler.async.enqueued` | `context.ts:411` → ts-infra `EventBus` | – | ~ | P | ~ | – | ~ |

**Tally:** Who — present `0`, partial `48`, absent `23`. What — present `4`, partial `67`, absent `0`. When — present `67`, partial `4`, absent `0`. Where — present `27`, partial `40`, absent `4`. Why — present `18`, partial `12`, absent `41`. How — present `33`, partial `34`, absent `4`.

The most complete dimension is **When** — 67 of 71 payloads carry a timestamp or duration, and the tap stamps `occurred_at` for the rest (`system-event-tap.ts:68`), so no event is ever atemporal. **Who is never fully present** (0 of 71 carry a canonical actor/executor/role; 48 carry a partial machine id such as `agentId`/`pid`/`memberId`). **Why is the deepest hole** — 41 of 71 events carry no `trigger`/`reason`, because no payload in the planning, queue, scheduler, message, history, or bus families captures what fired them.

## 5. Gap list (payload vs presentation — do not conflate)

**Payload gap** = the emitter never captured the fact. **Presentation gap** = the payload has it, but `metadataFields`/`renderer` does not surface it. Conflating these is why the Board looks empty while data exists.

Ranked (highest impact first):

| # | Gap | Class | Evidence |
| --- | --- | --- | --- |
| G1 | `task.updated` / `feature.updated` never carries `field`/`from`/`to` — the Board cannot say *what* changed | **payload** | `planning-write-service.ts:447-453`; `PlanningEvent` has no `field` (`planning-write-service.ts:110-116`). The catalog already advertises `field/from/to` (`event-names.ts` planning profile) — populated → rendered. |
| G2 | `workflow.*` step events render raw ids (`Run <uuid> · Node <uuid>`) — reader cannot tell *which* workflow / *which* step | **payload + presentation** | Engine-native rows carry `runId`/`node`/`actionId` uuids; `workflowName` is resolved only in the adapter envelope (`observability.ts:325-333`) and `nodeLabel` does not exist. The catalog surfaces `runId`/`node`/`kind` (`event-names.ts` workflow profile) but `kind` is populated only on action events. |
| G3 | **Who** is absent across 45/71 events — no actor on planning/history/queue/bus/api | **payload** | `extractSystemEventActor` (`system-event-tap.ts:146-156`) reads `actor`/`agentId`/`memberId`; none of those families set them. |
| G4 | **Why** is absent across 42/71 events — no `trigger`/`reason` on planning, message, queue-start, api, bus | **payload** | Planning payload has no `trigger` (`planning-write-service.ts:447`); `api.request.error` carries `code`/`status` but no command trigger (`error-handler.ts:198`). |
| G5 | Descriptions are string-mangled, not authored — every tooltip reads "…lifecycle event." | **presentation** | `describeEvent` (`event-names.ts:296-299`). The payload is fine; the catalog text is the defect. |
| G6 | `metadataFields` is inherited per source, not per event — 12 shapes for 71 events, so per-event relevance is wrong (e.g. `field/from/to` on `feature.created`) | **presentation** | `event()` spreads `SOURCE_PROFILES[source]` (`event-names.ts:254,262`); 12 `SOURCE_PROFILES` entries. |
| G7 | `buildPresentationFields` caps at 8 fields — `agent` (18 fields) and `history` (18 fields) silently drop the back half | **presentation** | `system-event-envelope.ts:344` `slice(0, 8)`. |

Note the precise split for the two operator complaints: **G1 is purely a payload gap** (the catalog already advertises `field/from/to`; the emitter just never fills them), while **G2 is both** — the id is in the payload (so it renders), but the *human name* is neither emitted (`nodeLabel`) nor reliably threaded (`workflowName` on engine-native rows), so the presentation can only render what the payload carries.

## 6. `*.updated` diff convention

**Defect (G1):** `task.updated`/`feature.updated` fire on every non-transition mutation but carry no field-level diff, so the Board shows "Task updated" and nothing else. Root cause at `planning-write-service.ts:447-453`; the catalog already advertises the fields (`event-names.ts` planning profile) but `PlanningEvent` (`planning-write-service.ts:110-116`) cannot carry them.

**Accepted J9 contract:** section writes use the existing `PlanningEvent.data` carrier rather than adding an opaque tagged `field` string. The write service copies the successful mutation descriptor after validation and before emission:

```ts
interface PlanningSectionMutationData {
    mutation: {
        kind: 'section';
        name: string;
    };
    after?: string;
    diff?: string;
}
```

Rules:

1. `updateSection` emits `data.mutation.kind = 'section'` and the exact canonical `sectionName` as `data.mutation.name`; presenters never parse a synthetic `section:<name>` token.
2. The event may carry either `after` or a safe `diff` when the write path can produce it without a second parse. Projection redacts first and applies the existing string/object bounds; absence is valid.
3. Status transitions keep top-level `from` / `to` and remain `*.transitioned`; J9 does not invent another status event.
4. Other mutation kinds remain generic until separately scoped. `data` is not an arbitrary document dump, and event-specific allow-lists retain only the paths declared for `task.updated` / `feature.updated`.
5. Existing rows without mutation data render a truthful generic task/feature update; history projection never fabricates a section name.

## 7. `workflow.*` naming convention

**Defect (G2):** step events render raw uuids — `Run <runId>` / `Node <node>` / `Action <actionId>`. The adapter threads `workflowName` only for run-start (`observability.ts:222-226`) and resolves it once in `envelope()` (`observability.ts:325-333`), but engine-native rows (`workflow.node.enter`, `workflow.action.start`, `workflow.transition.*`, `workflow.hitl.*`, `workflow.custom`) go straight through `bridgeEventBus` (`workflow-service.ts:563`) without that enrichment, and no `nodeLabel` exists anywhere.

**Accepted J9 convention — every engine-native and persistence-adapter `workflow.*` payload carries the available human identity in addition to machine correlation:**

```ts
interface WorkflowEventBase {
    runId: string;
    workflowName: string;
    node?: string;
    nodeLabel?: string;
    kind?: string;
}
```

Rules:

1. `WorkflowService` creates one identity decorator from the already-loaded definition and passes it to the typed engine bridge, `ObservableWorkflowAdapter`, built-in action runners, and the steering controller. Thus engine-native events, `workflow.agent`, and `workflow.steering` carry the same `workflowName`; no history lookup occurs per event.
2. Step-bearing events derive `nodeLabel` from the workflow definition (`description` when non-empty, otherwise the declared state/node id). Missing definitions on legacy rows stay missing.
3. Action events retain `kind`; transition events retain `from` / `to`. Machine `runId`, `node`, and `actionId` remain tooltip fields/correlation. J9: they never become the primary summary while a human name or kind exists. J91 (built, 0605): they never become the Summary cell at all — no `runId` / UUID `node` / `kind`-as-step fallback; see [`system-events-human-table.md`](system-events-human-table.md).
4. Every workflow summary begins `[workflow]` and orders identity as `workflowName`, then `nodeLabel` or transition/action semantics. The Board renders the supplied string.

## 8. Tier/policy rules and emitter checklist

Tier/policy rules are owned by `04_DESIGN.md` §7.9 (tier table) and `actionable-observability-context.md` (payload policy). Not restated here; this doc adds the **per-event contract** only.

**Emitter checklist** (for any new or changed event):

1. **Catalog first.** Register in `SYSTEM_EVENT_CATALOG` (`event-names.ts:316`) — an unregistered name is not board-observable (`system-event-tap.ts` subscribes only catalog names; `system-event-emitter.ts:90` no-ops unregistered planning names).
2. **6-dimension self-check.** Payload must satisfy §3: who (`actor`/`agentId`/`memberId`), what (`field`+`from`/`to` or `kind`/`status`), when (`at` or tap-stamped), where (`entity`/`runId`/`jobId`), why (`trigger`/`reason`), how (`attempt`/`exitCode`/`from`/`to`/`phase`).
3. **Per-event `metadataFields`, not per-source.** New events must declare their own retention fields rather than inherit a family profile (closes G6).
4. **Authored description.** A description is a sentence naming the change, not `describeEvent` output (closes G5).
5. **Payload policy by content.** `redacted` for anything with operator context (`workflow.hitl.*`, `workflow.steering`); `metadata-only` for counts/ids/outcomes; `raw-safe` only when no secrets/prompts/commands can ever ride the payload.
6. **Tier by volume.** High-frequency per-chunk/per-interval rows stay `diagnostic`; semantically important low-volume rows stay `default`. Do not grow `inferSeverity` — producers stamp severity at emit time (`event-names.ts:288-294`).

## 9. Enforcement recommendation

**Recommendation: two-sided gate against the SSOT, not codegen from it.**

The catalog cannot be *generated from* this doc, because the catalog is TypeScript that carries runtime behavior (tier switches, payload policy, renderer keys, producer attribution overrides like `agent.invoke.escalated`'s `package: 'spur'` at `event-names.ts:380-383`) — a codegen source would have to be a full schema, at which point the catalog is already the SSOT and the doc is a duplicate. Generating the doc *from* the catalog inverts the authority and would silently bless `describeEvent`'s mangle and the 12-shape inheritance.

A **two-sided gate** (corpus-style, mirroring `spur task check --corpus` / `transition-shim-check`) is the right shape:

- **One side:** every `SYSTEM_EVENT_CATALOG` name must appear in `event-tracking.md`'s matrix (§4) with a 5W1H row and an emitter `path:line` — an entry missing from the doc fails.
- **Other side:** every matrix row in §4 must resolve to a catalog name — a row that no longer reproduces fails, so the doc cannot rot into a silent list.
- Optionally: assert the count (71 today) and the "no `describeEvent`-only description / no source-inherited `metadataFields`" invariants once remediation lands.

This is enforceable today as a `spur rule` or a small script the same way `transition-shim-check` (`bun run transition-shim-check`) enforces marker↔manifest parity — and it costs nothing until remediation, because it fails *open* (audit-only) until emitters are fixed.

## 10. Reconciliation (not restated)

- `docs/04_DESIGN.md` §7.9 owns the catalog *surface*: tier table, envelope projection, source families, alias policy, producer invariant. This doc adds the per-event 5W1H contract and the two conventions. **Recommendation:** §7.9 stays authoritative; add one line pointing to `design/event-tracking.md` for the per-event contract, rather than shrinking §7.9 to a pointer (the surface rules are still load-bearing for the tap/SSE implementation).
- `docs/design/actionable-observability-context.md` owns the v2 envelope and projection policy. This doc's diff convention (§6) and naming convention (§7) operate **inside** the envelope `data`/`presentation` it defines; no envelope shape change is proposed here.
- `docs/design/system-events-human-table.md` owns J91 table-cell keys, opaque-id definition, and Agent projection (ADR-073/074). §12 overlays this matrix; it does not replace it.
- `docs/design/workflow-observability.md` owns the workflow runtime contract and envelope-v1 fields (`workflowName`, `runId`, `sequence`). §7 of this doc is the Board-legibility convention layered on top of that runtime contract, not a replacement.

## 11. J9 semantic presenter contract (built — tasks 0601/0602)

`SYSTEM_EVENT_PRESENTERS` is a typed record over `SystemEventName`. The catalog resolves each name to one presenter;
source profiles may still supply producer attribution or remediation defaults, but may not supply descriptions,
retained fields, summaries, or outcome policy.

```ts
interface SystemEventPresentationInput {
    data: Readonly<Record<string, unknown>> | null;
    correlation: Readonly<SystemEventCorrelationContext>;
}

type SystemEventOutcomeSpec =
    | { support: 'derived'; derive(input: SystemEventPresentationInput): string | undefined }
    | { support: 'unsupported' };

interface SystemEventPresenterSpec {
    description: string;
    fields: readonly SystemEventMetadataField[];
    summary(input: SystemEventPresentationInput): string;
    outcome: SystemEventOutcomeSpec;
}

const SYSTEM_EVENT_PRESENTERS = {
    // exactly one entry per SystemEventName
} satisfies Record<SystemEventName, SystemEventPresenterSpec>;
```

Rules:

1. Presenters receive only redacted/bounded `data` plus normalized correlation. The envelope applies output bounds
   again before persistence or response.
2. `description` is an authored diagnostic sentence. Generated `"<event name> lifecycle event"` text fails the gate.
3. `fields` is event-specific. Shared field-array helpers are allowed; implicit inheritance from a source family is not.
4. A `derived` outcome may return `undefined` when an old row lacks its source fact. `unsupported` always omits Outcome.
5. Unknown, unregistered names use the existing bounded generic fallback outside this registry.

The following matrix fixes summary behavior, retained facts, and outcome support. Braces denote carried bounded data;
`—` means explicitly unsupported, not missing design.

| Event | Retained facts | Summary | Outcome source |
| --- | --- | --- | --- |
| `task.created` | `entity.kind`, `entity.id` | `[task] {id} created` | — |
| `task.updated` | `entity.*`, `data.mutation.*`, `data.after`, `data.diff` | `[task] {section}`; old-row fallback `[task] {id}` | — |
| `task.transitioned` | `entity.*`, `from`, `to` | `[task] {id} : {from} -> {to}` | `to` |
| `feature.created` | `entity.kind`, `entity.id` | `[feature] {id} created` | — |
| `feature.updated` | `entity.*`, `data.mutation.*`, `data.after`, `data.diff` | `[feature] {section}`; old-row fallback `[feature] {id}` | — |
| `feature.transitioned` | `entity.*`, `from`, `to` | `[feature] {id} : {from} -> {to}` | `to` |
| `queue.consumer.started` | `queueName`, `startedAt`, polling/concurrency settings | `[queue] {queueName} : consumer started` | `startedAt` → `running` |
| `queue.consumer.stopped` | `queueName`, `stoppedAt`, `drainTimeoutMs`, `inFlightAtStop`, `drained` | `[queue] {queueName} : consumer stopped` | `drained` → `drained` / `timeout` |
| `queue.job.enqueued` | `jobId`, `type`, enqueue/retry timing | `[queue] {type} · job {jobId} enqueued` | — |
| `queue.job.completed` | `jobId`, `type`, `attempt`, `durationMs` | `[queue] {type} · job {jobId} completed` | — |
| `queue.job.failed` | `jobId`, `type`, attempts, `durationMs`, `error` | `[queue] {type} · job {jobId} failed` | `error` |
| `queue.job.retrying` | `jobId`, `type`, attempts, `nextRetryAt`, `error` | `[queue] {type} · job {jobId} retrying` | `attempt` / `maxRetries` |
| `queue.stats` | ready/running/completed/failed counts | `[queue] stats` | — |
| `scheduler.job.executed` | `name`, `durationMs`, `error` | `[scheduler] {name}` | `error` when present; otherwise `completed` |
| `message.sent` | `msgId`, `fromId`, `toId`, `threadId`, `createdAt` | `[message] {fromId} -> {toId}` | — |
| `message.replied` | `msgId`, `fromId`, `toId`, `threadId`, `createdAt` | `[message] {fromId} replied in {threadId}` | — |
| `process.spawned` | `label`, `pid`, `teamId`, `agentId` | `[process] {label | pid} spawned` | — |
| `process.exited` | `label`, `pid`, `exitCode`, `signal`, `durationMs`, `reason`, `error` | `[process] {label | pid} exited` | `exitCode` / `signal` / `reason` |
| `process.stopped` | `label`, `pid`, `signal`, `reason` | `[process] {label | pid} stopped` | `reason` |
| `process.started` | `label`, `pid`, `timestamp` | `[process] {label | pid} started` | — |
| `agent.invoke.start` | agent/operation/label, routing, correlation | `[agent] {agent} · {operation}` | — |
| `agent.invoke.exit` | agent/operation/label, routing, `exitCode`, `signal`, `durationMs` | `[agent] {agent} · {operation} exited` | `exitCode` / `signal` |
| `agent.invoke.escalated` | from/to executor+tier, `trigger` | `[agent] {fromExecutor} -> {toExecutor}` | `toTier` / `trigger` |
| `agent.invoke.exhausted` | `stage`, attempted tiers/executors, `attempts` | `[agent] {stage} escalation exhausted` | `attempts` |
| `agent.started` | `agentId`, `agentType`, `pid` | `[agent] {agentId} started` | — |
| `agent.stopped` | `agentId`, `exitCode` | `[agent] {agentId} stopped` | `exitCode` |
| `agent.message.sent` | `agentId`, `ok` | `[agent] message -> {agentId}` | `ok` |
| `team.up` | `teamId`, `memberCount`, `outcome` | `[team] {teamId} up` | `outcome` |
| `team.down` | `teamId`, `memberCount`, `outcome` | `[team] {teamId} down` | `outcome` |
| `team.member.assigned` | team/member/type/task, `outcome` | `[team] {teamId} · {memberId} assigned` | `outcome` |
| `team.member.started` | team/member/type, `outcome` | `[team] {teamId} · {memberId} started` | `outcome` |
| `team.member.stopped` | team/member/type, `outcome` | `[team] {teamId} · {memberId} stopped` | `outcome` |
| `history.import.completed` | source(s), files/messages, duration, exit code, artifact, `coverage`; + `trigger`/window/`importMode` when a refresh context is present | `[history] import · {source | sources}` | `exitCode` |
| `history.analyze.completed` | source(s), duration, exit code, artifact; + `trigger`/window/`importMode` when a refresh context is present | `[history] analyze · {source | sources}` | `exitCode` |
| `history.daily.failed` | source(s), `detail`, `reason`, `exitCode`; + `trigger`/window/`importMode` when a refresh context is present | `[history] daily failed` | `reason` / `exitCode` |
| `history.refresh.enqueued` | `trigger`/`triggerId`, `jobId`, window, `coalesced`, `outcome` | `[history] refresh · {windowStart} -> {windowEnd}` | `outcome` when coalesced/already-running |
| `rule.run.start` | `runId`, rule count, evaluator | `[rule] run {runId} started` | — |
| `rule.eval.start` | `runId`, `ruleId`, evaluator, index/total | `[rule] {ruleId} evaluating` | — |
| `rule.eval.done` | `runId`, `ruleId`, findings count, duration, severity | `[rule] {ruleId} evaluated` | `findings` |
| `rule.eval.error` | `runId`, `ruleId`, evaluator, `error` | `[rule] {ruleId} error` | `error` |
| `rule.run.done` | `runId`, rules/findings, duration, stoppedEarly, severity | `[rule] run {runId} done` | `findings` / `stoppedEarly` |
| `workflow.run.started` | `runId`, `workflowName`, mode, dryRun | `[workflow] {workflowName} started` | — |
| `workflow.run.done` | `runId`, `workflowName`, `finalState`, transitionsTaken | `[workflow] {workflowName} done` | `finalState` |
| `workflow.run.failed` | `runId`, `workflowName`, `finalState`, `reason` | `[workflow] {workflowName} failed` | `reason` |
| `workflow.run.finalized` | `runId`, `workflowName`, `status` | `[workflow] {workflowName} finalized` | `status` |
| `workflow.run.paused` | `runId`, `workflowName`, `node`, `nodeLabel`, transitionsTaken | `[workflow] {workflowName} · {nodeLabel} paused` | — |
| `workflow.run.resumed` | `runId`, `workflowName`, `node`, `nodeLabel` | `[workflow] {workflowName} · {nodeLabel} resumed` | — |
| `workflow.run.reseeded` | `runId`, `workflowName`, `fromState`, `toState` | `[workflow] {workflowName} : {fromState} -> {toState}` | `toState` |
| `workflow.node.enter` | `runId`, `workflowName`, `node`, `nodeLabel`, transitionsTaken | `[workflow] {workflowName} · {nodeLabel}` | — |
| `workflow.phase` | `runId`, `workflowName`, `phase`, `status` | `[workflow] {workflowName} · {phase}` | `status` |
| `workflow.node.transition` | `runId`, `workflowName`, `from`, `to`, `trigger` | `[workflow] {workflowName} : {from} -> {to}` | `to` |
| `workflow.transition` | `runId`, `workflowName`, `from`, `to`, `trigger` | `[workflow] {workflowName} : {from} -> {to}` | `to` |
| `workflow.transition.requested` | `runId`, `workflowName`, `from`, `to`, `trigger` | `[workflow] {workflowName} requested {from} -> {to}` | — |
| `workflow.transition.denied` | `runId`, `workflowName`, `from`, `to`, `reason` | `[workflow] {workflowName} denied {from} -> {to}` | `reason` |
| `workflow.action.start` | `runId`, `workflowName`, node identity, `kind` | `[workflow] {workflowName} · {nodeLabel | kind} started` | — |
| `workflow.action.started` | `runId`, `workflowName`, node identity, action id, `kind` | `[workflow] {workflowName} · {nodeLabel | kind} started` | — |
| `workflow.action.done` | run/workflow/node/action identity, `kind`, duration, `ok` | `[workflow] {workflowName} · {nodeLabel | kind} done` | `ok` |
| `workflow.action.finished` | run/workflow/node/action identity, `kind`, duration, `status`, `ok` | `[workflow] {workflowName} · {nodeLabel | kind} finished` | `status` / `ok` |
| `workflow.action.failed_continue` | run/workflow/node identity, transitionsTaken, `error` | `[workflow] {workflowName} · {nodeLabel} failed; continuing` | `error` |
| `workflow.guard.evaluated` | `runId`, `workflowName`, `from`, `to`, `kind`, `passed` | `[workflow] {workflowName} guard {from} -> {to}` | `passed` |
| `workflow.hitl.ask` | `runId`, `workflowName`, node identity, `kind` | `[workflow] {workflowName} · {nodeLabel | kind} awaiting input` | — |
| `workflow.hitl.response` | `runId`, `workflowName`, node identity, `ok` | `[workflow] {workflowName} · {nodeLabel} input received` | `ok` |
| `workflow.hitl.note` | `runId`, `workflowName`, node identity | `[workflow] {workflowName} · {nodeLabel} note` | — |
| `workflow.custom` | `runId`, `workflowName`, custom `name` | `[workflow] {workflowName} · {name}` | — |
| `workflow.agent` | run/execution/action identity, `kind`, agent/model/routing, terminal facts | `[workflow] {workflowName} · agent {kind}` | `outcome` only for `kind=finished` |
| `workflow.steering` | run/action/command identity, operation, actor, accepted/state/reason | `[workflow] {workflowName} · steering {operation}` | `accepted` / `state` / `reason` |
| `api.request.error` | `method`, `path`, `status`, `code`, `requestId`, error | `[api] {method} {path}` | `status` / `code` / `error` |
| `bus.emit.done` | `event`, `handlers`, `durationMs` | `[bus] {event} emitted` | `handlers` |
| `bus.emit.noop` | `event`, `handlers`, `durationMs` | `[bus] {event} had no handlers` | `handlers` |
| `bus.handler.error` | `event`, `handlers`, `durationMs`, `error` | `[bus] {event} handler error` | `error` |
| `bus.handler.async.enqueued` | `event`, `handlers` | `[bus] {event} handlers enqueued` | `handlers` |

The deterministic gate compares matrix event names with `SYSTEM_EVENT_CATALOG` in both directions and validates each
resolved catalog entry has non-generated description text, an explicit field list, a summary function, and exactly one
outcome support branch. It does not generate TypeScript or Markdown from the other side.

## 12. J91 table-legibility overlay (built — ADR-073/074; task 0605)

This matrix stays the per-event SSOT for tooltip fields and outcome. J91 overlays three table-cell
rules without adding events:

1. **SUMMARY** for `workflow.*` uses `{workflowName}` and `{nodeLabel}` only; `{nodeLabel|kind}` in
   §11 action rows becomes `{nodeLabel}` (kind moves to `presentation.actionLabel`).
2. **Retain vs fields.** Presenters may declare `retain` paths that join the metadata allow-list
   without occupying a tooltip slot. `workflow.action.*` retain `metadata.agent`, `metadata.role`,
   and `routing.executor`.
3. **Table projector** emits `correlators` / `actionLabel` / `agent`. Shapes:
   [`system-events-human-table.md`](system-events-human-table.md).
