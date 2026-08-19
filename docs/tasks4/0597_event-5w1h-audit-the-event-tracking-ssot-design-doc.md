---
schema_version: 1
name: "Event 5W1H audit + the event-tracking SSOT design doc"
status: done
template: brainstorm
created_at: 2026-08-18T22:01:30.250Z
updated_at: "2026-08-19T03:50:00.314Z"
feature_id: I6
done_forced: "true"
done_reason: "Doc-authoring batch: event 5W1H SSOT delivered - 71/71 catalog events matrix-verified (scripted count, 0 missing), *.updated diff convention + workflow.* naming convention specified, reconciled with actionable-observability-context.md and 04_DESIGN.md 7.9; task check PASS; zero source files modified."
---

## 0597. Event 5W1H audit + the event-tracking SSOT design doc

### Background
`wayfinder:research` — ticket on map **[I6]** (Spur harness self-improvement program).

#### The sharp question
**Which of the 71 cataloged system events actually answer who / what / when / where / why / how — and
what contract closes the gaps, on both the emit side and the Board side?**

#### Ground truth already established (do not re-derive)
The premise "status-change events are missing" is **false**, and the correction matters because it
changes this ticket from a build into an audit:

- `task.transitioned` and `feature.transitioned` **exist and are cataloged**.
- A v2 envelope already exists — `SystemEventEnvelopeV2` in
  `packages/app/src/services/system-event-envelope.ts` — carrying `presentation`, `severity`,
  `renderer`, `correlation`, `actions`, and `SystemEventProjectContext`.
- `packages/app/src/services/event-names.ts` holds a real catalog: per-event `source`, `tier`
  (`default`/`diagnostic`), `persisted`, `streamed`, `payloadPolicy`
  (`metadata-only`/`redacted`/`raw-safe`), `renderer`, `producerPackage`, `subsystem`, `severity`,
  `description`, `metadataFields`.
- **71 catalog entries** across `task.*`, `feature.*`, `workflow.*` (25+ of them), `agent.*`, `team.*`,
  `message.*`, `history.*`, `queue.*`, `scheduler.*`, `process.*`, `rule.*`, `bus.*`, `api.*`.

So the design is not absent. **Refine-time verification found the actual root cause — see Design.**
In short: the catalog is *source*-parameterized rather than *event*-parameterized (71 entries, only
**12** distinct `metadataFields` shapes), descriptions are string-mangled from the event name, and the
planning emitter never populates a what-changed payload at all. It is mis-parameterized, not empty. The two concrete symptoms
the operator reported map onto that:
- `task.updated` fires constantly but never says **what** changed (no field-level diff in the payload).
- `workflow.*` events render as raw uuids — the reader cannot tell **which** workflow ran **which**
  kind of step. `workflow.node.enter`, `workflow.action.start`, `workflow.phase` and siblings all carry
  ids where a human needs names.

#### What to produce
1. **A per-event 5W1H matrix.** Every cataloged event × {who (actor/executor/role), what (the specific
   change, not the noun), when (timestamp + duration), where (project/run/task/feature correlation),
   why (the trigger — command, guard, schedule, human), how (the mechanism/stage)}. Mark each cell
   present / partial / absent, with `path:line` for the emitter.
2. **The gap list, ranked**, separated into two causes that need different fixes: payload gaps (the
   emitter never captured it) versus presentation gaps (the payload has it, the catalog's
   `metadataFields` / `renderer` does not surface it). Conflating these is why the Board looks empty
   while the data exists.
3. **`docs/design/event-tracking.md`** — the SSOT design doc the operator asked for. It owns: the 5W1H
   contract every event must satisfy, the field-level-diff convention for `*.updated` events, the
   naming convention for `workflow.*` so a step is legible without a uuid lookup, the tier/policy
   rules, and the emitter checklist. Route it per `docs/99_PROJECT_CONSTITUTION.md` and check it
   against the existing `docs/design/actionable-observability-context.md` and `docs/04_DESIGN.md §7.9`,
   which already own part of this surface — **reconcile, do not fork.**
4. **A recommendation on enforcement:** can the catalog be *generated from* the SSOT, or must it be
   *checked against* it (a `spur rule`, a corpus-style two-sided gate)? A doc nothing enforces drifts
   back within a quarter. This answers a live fog item on the map.

#### Out of scope for this ticket
Changing any emitter or Board component. This ticket produces the audit and the SSOT; the remediation
graduates into its own feature. Anything under `spur task` (feature F92, concurrent agent).
### Requirements

- R1 — Produce a per-event 5W1H matrix over every cataloged system event, marking who / what / when / where / why / how as present, partial, or absent, with the emitter's `path:line` for each row.
- R2 — Separate the gap list into payload gaps (the emitter never captured it) and presentation gaps (the payload holds it but `metadataFields` or `renderer` does not surface it), and rank them — the two causes need different fixes.
- R3 — Document the specific `task.updated` / `feature.updated` failure: the event fires without a field-level diff, so the Board cannot say what changed. Specify the diff convention that closes it.
- R4 — Document the `workflow.*` legibility failure: steps render as raw ids. Specify the naming convention that makes which-workflow-which-step readable without a uuid lookup.
- R5 — Write `docs/design/event-tracking.md` as the SSOT: the 5W1H contract, the `*.updated` diff convention, the `workflow.*` naming convention, tier/policy rules, and the emitter checklist. Reconcile with `docs/design/actionable-observability-context.md` and `docs/04_DESIGN.md §7.9` rather than forking them.
- R6 — Recommend an enforcement mechanism — generate the catalog from the SSOT, or check it against the SSOT via a two-sided gate — so the doc cannot silently drift.

### Acceptance Criteria

```gherkin
Feature: Event 5W1H audit and SSOT

  Scenario: R1 — every cataloged event is assessed against 5W1H
    Given the event catalog in packages/app/src/services/event-names.ts
    When the matrix is produced
    Then each event has a present, partial, or absent mark for all six dimensions
    And each row cites its emitter path:line

  Scenario: R2 — payload gaps are not conflated with presentation gaps
    Given an event whose payload carries a field the Board does not render
    When the gap list is produced
    Then that event is classed as a presentation gap, not a payload gap

  Scenario: R3 — the what-changed gap has a specified fix
    Given task.updated fires on a field change
    When the SSOT is read
    Then it specifies a field-level diff convention for *.updated events

  Scenario: R4 — workflow steps are legible without a uuid lookup
    Given a workflow.* event is rendered
    When the SSOT naming convention is applied
    Then the reader can identify which workflow and which kind of step

  Scenario: R5 — the SSOT reconciles with existing authority
    Given docs/design/actionable-observability-context.md and docs/04_DESIGN.md section 7.9 already own part of this surface
    When docs/design/event-tracking.md is written
    Then it reconciles with them
    And it does not restate a conflicting contract

  Scenario: R6 — drift is preventable, not just documented
    Given the SSOT defines the 5W1H contract
    When the enforcement recommendation is read
    Then it names either codegen from the SSOT or a two-sided gate against it
```

### Q&A
**Closed during refine (premise verification — do not re-open).**
- Catalog size is **71** entries, not ~55.
- `metadataFields` is populated on **all 71** — the defect is that only **12 distinct shapes** exist,
  inherited per *source*, not per *event*.
- Descriptions are generated by `describeEvent()` string-mangling, not authored.
- `task.updated` carries no what-changed data because `PlanningEvent` has no `field` property and
  `data` is never set at `planning-write-service.ts:441`.
- `task.transitioned` / `feature.transitioned` **do** exist — the "missing status events" premise was
  false and is already corrected on the map.

**Deferred — owner: the remediation feature this task spawns.**
Whether `PlanningEvent` gains `field` / populated `data`, and whether `event()` gains a per-event
override or the catalog moves to per-event declarations. Both are stated as options in the doc; neither
is implemented here.

**Open, resolvable by the implementer.**
- Whether `docs/04_DESIGN.md` §7.9 should shrink to a pointer once `event-tracking.md` exists, or stay
  authoritative with the design doc as elaboration. Constitution §4.1 governs; decide and state it.
- Whether the `workflow.*` id-only problem is one defect or two (engine-side naming vs Board-side
  rendering). Split the finding if the evidence splits.
### Design
**WHAT.** An audit matrix plus one design doc. **No emitter or Board change ships from this task** —
remediation graduates into its own feature. No new API.

**WHY.** The 5W1H gap has a structural root, found during refine. It is not "the catalog is empty".

**Root cause — verified at `path:line`, do not re-derive.**

1. **The catalog is source-parameterized, not event-parameterized.**
   `packages/app/src/services/event-names.ts:254` — `event(name, source, renderer, …)` builds each entry
   by spreading `SOURCE_PROFILES[source]`. Measured: **71 catalog entries share only 12 distinct
   `metadataFields` shapes.** All six planning events (`task.created/updated/transitioned`,
   `feature.created/updated/transitioned`) carry the identical list `entity.kind, entity.id, field,
   from, to`. An event cannot describe itself when its presentation is inherited from its family.

2. **Descriptions are string-mangled from the name.**
   `event-names.ts:296` — `describeEvent()` returns `` `${words} lifecycle event.` ``, so `task.updated`
   is documented as *"Task updated lifecycle event."* Every description in the catalog is generated,
   carries zero information, and looks authored.

3. **The what-changed payload is never emitted.**
   `packages/app/src/services/planning-write-service.ts:441-448` constructs every planning event as:
   `{ event, entity{kind,id}, at, from?, to? }`. `from`/`to` are set **only** on a status transition.
   `data` exists on `PlanningEvent` (`planning-write-service.ts:115`) and is **never populated**. And
   `PlanningEvent` has **no `field` property at all** — so the `field` the catalog advertises as a
   metadata field is unpopulatable by construction. A `--section Requirements` write emits
   `{event, entity, at}` and nothing else. **That is the operator's `task.updated` complaint, exactly.**

The catalog therefore promises a field the payload type cannot carry — a contract lie, not an omission.

**WHERE — read set (frozen).**

| Area | Path |
| --- | --- |
| Catalog | `packages/app/src/services/event-names.ts` (562 lines, `SYSTEM_EVENT_CATALOG` at :316) |
| Envelope | `packages/app/src/services/system-event-envelope.ts` (578) |
| Emitter / tap | `system-event-emitter.ts` (90), `system-event-tap.ts`, `system-event-follow.ts` |
| Planning writes | `planning-write-service.ts` (the `task.*` / `feature.*` producer) |
| Workflow events | `workflow-service.ts` + the ts-dual-workflow-engine bridge |
| Board | `apps/web/src/modules/observability/SystemEventsTab.tsx` |
| Existing authority | `docs/design/actionable-observability-context.md` (181), `docs/design/workflow-observability.md` (146), `docs/04_DESIGN.md` §7.9 (:1883) |

**Output artifact — frozen path:** `docs/design/event-tracking.md`.

**Anti-patterns — do not do these.**
- Do not change an emitter, the catalog, or a Board component. Audit + doc only.
- Do not fork the three existing observability docs. `docs/04_DESIGN.md` §7.9 already owns the System
  Event catalog surface; per the constitution, lower-numbered docs win on content. Reconcile and
  cross-reference; if §7.9 must change, that is a same-commit T3 edit, not a competing doc.
- Do not "fix" `describeEvent()` by writing 71 descriptions here. Recording that the generator is the
  defect is the deliverable.
- Do not grow `inferSeverity()` — the source comment explicitly forbids it.
- Do not touch `spur task` or `packages/app/src/services/task-*` (feature F92, concurrent agent).

**Handoff.** The remediation feature this spawns will need to decide payload-type changes
(`PlanningEvent.field` / `data`) and whether `event()` gains a per-event override. State both as
options in the doc; do not implement either.
### Plan
- [x] Enumerate all 71 `SYSTEM_EVENT_CATALOG` entries programmatically; do not hand-list (R1)
- [x] For each, locate the emit site and record its actual payload shape with `path:line` (R1)
- [x] Score each event on who/what/when/where/why/how as present, partial, or absent (R1)
- [x] Classify each gap as payload-side (emitter never captured it) or presentation-side (payload has it, catalog/renderer drops it); rank (R2)
- [x] Document the `*.updated` diff gap from the verified root cause at `planning-write-service.ts:441`, and specify the field-level diff convention that closes it (R3)
- [x] Audit the `workflow.*` family for id-only rendering; specify the naming convention that makes workflow + step legible without a uuid lookup (R4)
- [x] Read `docs/design/actionable-observability-context.md`, `workflow-observability.md`, and `docs/04_DESIGN.md` §7.9; record what each already owns (R5)
- [x] Write `docs/design/event-tracking.md`: 5W1H contract, diff convention, workflow naming, tier/policy rules, emitter checklist; cross-reference rather than restate (R5)
- [x] Assess whether the catalog can be generated from the SSOT or must be gate-checked against it; recommend one with reasoning (R6)
- [x] Verification: the matrix covers all 71 entries; every root-cause claim carries `path:line`; zero source files modified
### Solution
Wrote the audit + 5W1H contract SSOT at `docs/design/event-tracking.md:1` (title line names the SSOT) — a single doc delivering all six requirements, with zero source-file modifications (doc-authoring mode).

- **R1 matrix** — §4 enumerates all 71 `SYSTEM_EVENT_CATALOG` entries (programmatically enumerated from the catalog), each scored who/what/when/where/why/how as P/~/– with an emitter `path:line`. Every emitter line was re-read from source before writing.
- **R2 gap split** — §5 ranks 7 gaps, separating payload gaps (G1/G3/G4 — emitter never captured the fact) from presentation gaps (G5/G6/G7 — payload holds it, catalog/renderer drops it). The two operator complaints split precisely: `task.updated` "what changed" is a pure payload gap (the planning catalog profile already advertises `field/from/to`; the emitter never fills them), while `workflow.*` id-only is both (the id is in the payload so it renders, but the human name is neither emitted nor threaded on engine-native rows).
- **R3 diff convention** — §6 specifies the `*.updated` field-level diff, rooted at the verified cause (event built without `field`, `from`/`to` set only on transition; the event type has no `field`).
- **R4 workflow naming** — §7 specifies `workflowName` + `nodeLabel` + `kind` mandatory on every `workflow.*` row; one defect, two halves (engine payload + Board render), root at the engine-native bridge lacking the adapter's `workflowName` threading.
- **R5 reconcile** — §10 cross-references `04_DESIGN.md` §7.9 (surface authority), `actionable-observability-context.md` (envelope authority), and `workflow-observability.md` (runtime contract); does not restate them.
- **R6 enforcement** — §9 recommends a two-sided gate (catalog↔matrix parity, corpus-style) over codegen, with reasoning (the catalog carries runtime behavior — tier/policy/renderer/producer overrides — so it is already the SSOT; codegen would bless the description mangle and the 12-shape inheritance).

Root-cause claims carry `path:line` throughout the doc (§2, §5, §6, §7). No emitter, catalog, or Board change ships; the two remediation payload-type options are stated as options, not implemented (per the task's deferred scope).
### Testing
Coverage: N/A — doc-authoring task; no source or test files touched, no runtime behavior to cover.

Verification performed:

- **Matrix completeness:** scripted check against `event-names.ts` → "catalog count: 71, missing from matrix: 0" (all 71 catalog names present in §4, each with a 5W1H row and emitter `path:line`).
- **Tally re-count:** programmatically re-scored the §4 matrix (71 rows) and corrected the Tally line to the measured counts (Who 0/48/23, What 4/67/0, When 67/4/0, Where 27/40/4, Why 18/12/41, How 33/34/4).
- **Emitter-citation verification:** every `path:line` in §4/§5 was re-read from source; all resolve to the cited emit/wiring site.
- **`sp:doc-evolve` sync-check:** not run — the skill surface is not invocable from this worker context. Performed the equivalent manual reconciliation: §10 cross-references the three authority docs and asserts the authority hierarchy (`04_DESIGN.md` §7.9 wins on conflict; `actionable-observability-context.md` owns envelope mechanics) rather than forking them.
### Review
| Priority | Finding | Evidence / Disposition |
| --- | --- | --- |
| P1 | `task.updated`/`feature.updated` carry no what-changed — Board shows "Task updated" with no field/diff | Verified `planning-write-service.ts:447-453` (no `field`, `from`/`to` transition-only); `PlanningEvent` lacks `field` (`:110-116`). Disposition: §6 convention; remediation feature adds `field`/`data`. |
| P1 | `workflow.*` step rows render raw uuids (Run/Node/Action) — unreadable without a uuid lookup | Engine-native rows bypass the adapter's `workflowName` threading (`workflow-service.ts:563` vs `observability.ts:325-333`); no `nodeLabel` exists. Disposition: §7 convention (`workflowName`+`nodeLabel`+`kind`). |
| P2 | **Who** never fully present (0/71); **Why** absent on 41/71 | No `actor`/`trigger` on planning/history/queue/bus/api families. Disposition: §3 contract + emitter checklist (§8); remediation adds actor/trigger to payloads. |
| P2 | Catalog is source-parameterized — 12 `metadataFields` shapes for 71 events | `event-names.ts:254-255` spreads `SOURCE_PROFILES[source]`. Disposition: G6; remediation moves to per-event declarations. |
| P3 | Descriptions are string-mangled, not authored | `describeEvent` (`event-names.ts:296-299`). Disposition: G5; remediation authors descriptions. |
| P3 | `buildPresentationFields` caps at 8 fields, silently dropping agent/history tail fields | `system-event-envelope.ts:344` `slice(0, 8)`. Disposition: G7; remediation raises cap or prioritizes per-event. |
| P4 | Enforcement not yet wired — doc can drift | §9 recommends a two-sided gate (catalog↔matrix parity). Disposition: implement in the remediation feature. |
| P4 | §7.9 authority split (stay authoritative vs shrink to pointer) | Open per task Q&A. §10 recommends §7.9 stays authoritative + one pointer line. Disposition: operator decides; stated, not changed. |
### References
- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- `docs/04_DESIGN.md` §7.9 (line 1883) — System Event catalog; **authoritative surface, reconcile with it**
- `docs/design/actionable-observability-context.md` — v2 envelope + actionable context policy
- `docs/design/workflow-observability.md` — workflow run observability
- `docs/99_PROJECT_CONSTITUTION.md` §4.1 / §4.4 — doc authority and routing (lower number wins on content)
- Source: `packages/app/src/services/event-names.ts:254` (`event()`), `:296` (`describeEvent`), `:316` (`SYSTEM_EVENT_CATALOG`)
- Source: `packages/app/src/services/planning-write-service.ts:115` (`PlanningEvent`), `:441` (emit site — the root cause)
- Related features: J1–J5 (observability data plane + board surfaces)
- Skill: `sp:doc-evolve` (sync-check, contract-verify)
### History
- 2026-08-19T03:09:42.230Z todo → wip (system)
- 2026-08-19T03:09:42.765Z wip → testing (system)
- 2026-08-19T03:09:50.648Z testing → done (system)
