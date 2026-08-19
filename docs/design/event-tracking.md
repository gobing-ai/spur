# Event tracking — System Event 5W1H SSOT

**Area:** System Event catalog (`SYSTEM_EVENT_CATALOG`), 5W1H payload contract, `*.updated` field-level diff, `workflow.*` legibility.
**Status:** audit + SSOT (task 0597); remediation ships in its own feature.
**Authority:** elaborates `docs/04_DESIGN.md` §7.9 (authoritative on the catalog surface) and `docs/design/actionable-observability-context.md` (authoritative on the v2 envelope and projection policy). This doc does **not** restate their contracts — it defines the *per-event* contract the other two deliberately leave abstract. On conflict, `04_DESIGN.md` §7.9 wins (lower number wins on content, constitution §4.1); on envelope mechanics, `actionable-observability-context.md` wins.

## 1. Scope and non-goals

This task is an **audit + SSOT only**. It changes no emitter, no catalog entry, and no Board component. It answers two questions and locks the contract that closes them:

1. Which of the 71 cataloged events actually answer who/what/when/where/why/how?
2. What convention closes the two concrete operator complaints — `task.updated` never says *what* changed, and `workflow.*` renders raw ids?

Remediation (adding `PlanningEvent.field` / populated `data`, adding `workflowName`+labels to engine-native payloads, Board label rendering) is **out of scope** and graduates into its own feature. The two payload-type options are stated here as decisions for that feature, not implemented.

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
| 33 | `history.import.completed` | `history-refresh-service.ts:174` | – | ~ | P | ~ | ~ | P |
| 34 | `history.analyze.completed` | `history-refresh-service.ts:192` | – | ~ | P | ~ | ~ | P |
| 35 | `history.daily.failed` | `history-refresh-service.ts:227` | – | ~ | P | ~ | P | P |
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

**Convention (contract for the remediation feature):**

```ts
interface PlanningEvent {
    event: 'task.updated' | 'feature.updated';
    entity: { kind: MarkdownDomain; id: string };
    at: string;
    field: string;                 // NEW — changed locus, one of:
                                   //   'status' | 'section:<Name>' | 'frontmatter:<key>'
                                   //   | 'frontmatterArray:<key>' | 'body'
    from?: string | null;          // previous value (null when the field is first set)
    to?: string;                   // new value
    data?: { changes: Array<{ field: string; from?: string | null; to?: string }> }; // multi-field writes
}
```

Rules:

1. **Single-locus writes** populate `field` + `from` + `to`. The write service already knows the locus at mutation time (`MutationDescriptor` carries `sectionName`, `fmKey`, `fmArrayValue`, `body` — `planning-write-service.ts:159-188`); it must capture the old value **before** `applyMutation` (`planning-write-service.ts:408`) and the new value after.
2. **Multi-field writes** (rare) populate `data.changes`; the catalog's planning profile must then add a `changes` field or the envelope's `metadata-only` allow-list drops it (presentation follow-on).
3. `from`/`to` keep their existing transition meaning (`planning-write-service.ts:451-452`); `field` is the new discriminator that makes `updated` distinct from `transitioned`.
4. **Do not** reuse `data` as a dumping ground for arbitrary business payload — it stays bounded by the `metadata-only` allow-list and recursive redaction (`system-event-envelope.ts` projection).

Remediation option (stated, not implemented): add `field` to `PlanningEvent` and set it + `from`/`to` in the emit block; OR move the catalog to per-event `metadataFields` declarations and emit a `changes` array. The scalar option is the minimal diff and closes G1 because the fields are already cataloged.

## 7. `workflow.*` naming convention

**Defect (G2):** step events render raw uuids — `Run <runId>` / `Node <node>` / `Action <actionId>`. The adapter threads `workflowName` only for run-start (`observability.ts:222-226`) and resolves it once in `envelope()` (`observability.ts:325-333`), but engine-native rows (`workflow.node.enter`, `workflow.action.start`, `workflow.transition.*`, `workflow.hitl.*`, `workflow.custom`) go straight through `bridgeEventBus` (`workflow-service.ts:563`) without that enrichment, and no `nodeLabel` exists anywhere.

**Convention — every `workflow.*` payload must carry, in addition to the machine id:**

```ts
interface WorkflowEventBase {
    runId: string;          // machine id (kept — indexed correlation)
    workflowName: string;   // REQUIRED — human workflow name, resolved once at run create
    // step-bearing events additionally:
    node?: string;          // machine node id (kept)
    nodeLabel?: string;     // REQUIRED on node/phase/action/transition — human step name from the workflow definition
    kind?: string;          // REQUIRED on action events — 'agent.run' | 'shell' | 'note' | …
}
```

Rules:

1. `workflowName` is mandatory on every `workflow.*` row. The adapter already resolves it (`observability.ts:221`, `:325`); the engine-native bridge (`workflow-service.ts:563`) must enrich the same way, or the catalog `workflowName` field stays unpopulated on half the family.
2. `nodeLabel` (human step name) is mandatory wherever `node` (machine id) is present. The workflow definition owns the label; the engine/adapter emits it alongside `node`. `kind` remains the *which-kind-of-step* discriminator and must be populated on node/phase events, not just actions.
3. The Board summary renders `workflowName · nodeLabel (kind)` — e.g. `plan-pipeline · plan (agent.run)` — not `Run <uuid> · Node <uuid>`. The catalog already exposes `workflowName`/`kind` (`event-names.ts` workflow profile); it must add `nodeLabel`.
4. The id-only problem is **one defect with two halves**: engine-side naming (payload does not carry `nodeLabel`, `workflowName` is not threaded on engine-native rows) and Board-side rendering (summary concatenates raw ids). Both halves are fixed by the convention above; the payload half is the root, the render half is the symptom.

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
- `docs/design/workflow-observability.md` owns the workflow runtime contract and envelope-v1 fields (`workflowName`, `runId`, `sequence`). §7 of this doc is the Board-legibility convention layered on top of that runtime contract, not a replacement.
