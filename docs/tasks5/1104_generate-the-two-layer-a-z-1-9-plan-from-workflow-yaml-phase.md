---
schema_version: 1
name: Generate the two-layer A-Z/1-9 plan from workflow YAML phases in workflow show and validate
status: done
template: feature-impl
created_at: 2026-10-07T06:14:17.109Z
updated_at: "2026-10-07T19:07:33.415Z"
feature_id: I13

dependencies: ["1103"]
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 10
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1104-verdict.json
---

## 1104. Generate the two-layer A-Z/1-9 plan from workflow YAML phases in workflow show and validate

### Background

Graduated from map I13 after the 1102 prototype (`docs/analysis/2026-10-plan-projection-prototype.ts`). The operator approved
the prototype's phase table (`docs/analysis/2026-10-plan-projection-prototype.ts:40-116`), approved putting it in workflow YAML,
and approved `spur workflow show --format todo` emitting the labeled two-layer plan (public surface). Today `columnLabel`
(`packages/app/src/workflow/step-reporter.ts:255-263`) emits `AA` past `Z` and `labelChild` (`step-reporter.ts:276-278`) has no
9 cap.

**Refine corrections (2026-10-06)**

1. The YAML key is the 1103 engine field `display: { phase, phaseTitle?, title?, show? }`, not a bare `phase` key.
2. Bundled YAML is validated against Spur's own JSON schema copy, not only the engine zod schema:
   `config/workflows/task-pipeline.yaml:49` declares `$schema: @gobing-ai/spur/schemas/state-machine-workflow.schema.json`,
   served from `apps/cli/schemas/state-machine-workflow.schema.json` (states `additionalProperties: false`) through
   `apps/cli/src/config/embedded-schemas.ts:19` and bundled by `scripts/commands/bundle-plugin-lib.ts:651`. That copy must
   gain `display` in the same commit as the YAML annotation (added to R1).
3. Status rendering already exists: `VisibleOutcome`/`VisibleItem` (`step-reporter.ts:423-435`) and `renderProgressMarkdown`
   (`step-reporter.ts:462-477`) already keep non-completed outcomes open with a `[outcome]` suffix. R6 reuses them; no new
   outcome type.
4. Validation must be opt-in. Only `task-pipeline` and `idea-pipeline` get `display`; the other 8 bundled workflows and every
   user workflow have none. R3's rules apply only when at least one state declares `display`; unannotated workflows keep the
   flat inventory and are not rejected.
5. The flat inventory keeps `columnLabel`: `renderWorkflowTodo` (`step-reporter.ts:287`) and the run preview `renderRunPlan`
   (`apps/cli/src/commands/workflow.ts:980`) serve unannotated workflows, some user-authored, so a throwing cap there would
   break them. The largest bundled workflow has 16 states. The hard A–Z / 1–9 cap applies to the phased plan.
6. `--format todo --json` consumers rebuild the inventory from known keys: `parseWorkflowInventory`
   (`packages/app/src/workflow/workflow-inventory.ts:49-110`) and `inline-run-setup.ts:198,659`. A new `plan` key is additive;
   `steps` stays unchanged.
7. Doc owners are `docs/design/cli-contracts.md:768` and `plugins/sp/skills/spur-cli/references/workflows.md:273`, not a
   `references/workflows/` file. Validate runs through `WorkflowService.validate`
   (`packages/app/src/services/workflow-service.ts:584`) from `apps/cli/src/commands/workflow.ts:545`.
8. A batch helper in `packages/app` alone is unreachable: agents reach Spur only through the CLI or standalone plugin scripts
   (`sp-plugin-standalone` rule). The established route is a `packages/app` core bundled into `plugins/sp/lib/*.generated.mjs`
   by `scripts/commands/bundle-plugin-lib.ts:4-17` and called from a thin plugin script (precedent
   `plugins/sp/scripts/inline-run-setup.ts:10`, invoked as `node "$(superskill script path sp <name>.mjs)"`). R5 now names that
   route; the CLI public surface stays limited to `workflow show --format todo`.

### Requirements

- [ ] R1. Add `display` to `apps/cli/schemas/state-machine-workflow.schema.json` (same shape as the 1103 engine field); annotate every non-terminal state of `config/workflows/task-pipeline.yaml` and `idea-pipeline.yaml` with the approved phases (prototype table); regenerate the bundle.
- [ ] R2. Phased projection in `packages/app/src/workflow/step-reporter.ts`: `A Prepare` (A1–A3) plus one letter per phase from B, digits = `show: plan` states, item text `<label> <title> · <state-id>`; `on-entry` states take the next digit only when entered; terminal states never appear. Labels come from a capped labeler that throws past Z or past 9; the flat inventory for unannotated workflows keeps `columnLabel`.
- [ ] R3. When a state-machine workflow declares `display` on any state, `spur workflow validate` rejects: a non-terminal state without `display`, a terminal state with `display`, more than 25 phases, more than 9 states in a phase (counting on-entry), conflicting `phaseTitle` values within one phase.
- [ ] R4. `spur workflow show --format todo --json` adds a `plan` array of ready-to-publish items for annotated workflows (`null` otherwise); `steps` unchanged. Update `docs/design/cli-contracts.md` and `plugins/sp/skills/spur-cli/references/workflows.md`.
- [ ] R5. Batch projection, reachable by agents through a plugin script `plugins/sp/scripts/batch-plan.ts` over a bundled core: `A` Prepare batch (A1–A4), one letter per task (`B 0812 <title>`), `Z` Batch report, waves of 24 tasks; **letters first** — the script's `task-children` mode produces a task's phase digits from that task's `workflow show` plan when the task starts.
- [ ] R6. Host rendering: skipped / failed / unattempted / blocked map to host `pending` with an `[outcome]` text suffix on every host; only an observed completion is `completed`.
- [ ] R7. Port the prototype's self-checks into `packages/app/tests/workflow/` tests (cap, validation, label stability across loop-back, skipped never completed, letters-first batch).

### Acceptance Criteria

```gherkin
Scenario: AC1 — Annotated pipelines load and validate (req: R1)
  Given task-pipeline.yaml and idea-pipeline.yaml carry display on every non-terminal state
  When spur workflow validate runs on every file in config/workflows
  Then every file reports valid, including the 8 unannotated workflows

Scenario: AC2 — The task pipeline publishes the approved two-layer plan (req: R2, R4)
  Given the annotated task-pipeline.yaml
  When spur workflow show config/workflows/task-pipeline.yaml --format todo --json runs
  Then .plan starts with "A Prepare", "A1 Quick readiness", "A2 Prepare Git", "A3 Publish plan"
  And phases B Implement, C Test, D Review, E Verify & record follow with only show: plan states as digits
  And no terminal state and no on-entry state appears, and .steps is unchanged

Scenario: AC3 — Validation rejects malformed phase tables (req: R3)
  Given an annotated workflow with a non-terminal state lacking display, or a terminal state with display, or 10 states in one phase, or 26 phases, or two phaseTitle values for one phase
  When spur workflow validate runs on it
  Then it exits non-zero and the finding names the offending state or phase

Scenario: AC4 — Labels are capped and stable (req: R2, R7)
  Given the capped labeler
  When asked for a letter past Z or a digit past 9
  Then it throws instead of emitting AA or A10
  And a run that loops verify -> test-fix -> verify keeps every existing item's label

Scenario: AC5 — Batch plans are letters first (req: R5, R7)
  Given a 30-task JSON file
  When node plugins/sp/scripts/batch-plan.mjs waves --tasks <file> runs
  Then wave 1 has A Prepare batch, B..Y one item per task with no digit children, and Z Batch report
  And wave 2 holds the remaining 6 tasks
  And the digits for a task are produced only when that task starts

Scenario: AC6 — Non-completed outcomes never render as completed (req: R6, R7)
  Given items with outcomes skipped, failed, unattempted and blocked
  When they are rendered for a full-list host and for a per-item host
  Then each has host status pending and text ending in its [outcome] suffix
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T06:22:28.204Z

- **Validation scope:** opt-in per workflow (any state declares `display`). Forcing phases on all workflows would reject user workflows for a presentation feature.
- **Flat inventory:** kept with `columnLabel` for unannotated workflows and `renderRunPlan`; the cap is a property of the phased plan only.
- **Phase order:** first appearance in declaration order; children in declaration order. `triage` is declared before `test-fail-triage` but they sit in different phases, which this rule handles.
- **Defaults:** absent `show` = `plan`; absent `title` = state id; absent `phaseTitle` on every state of a phase = phase key.
- **Workflow `version`:** not bumped. `display` is behavior-neutral; the digest changes anyway (authoring-workflows.md § Optional version literal).
- **JSON shape:** additive `plan` key; `steps` remains for `parseWorkflowInventory` and inline-run setup. Public-surface consent given on map I13.
- **Engine JSON-schema drift** (`resumeRerun`/`startable`) on Spur's copy: not fixed here; only `display` is added.

### Design

**What:** generate the two-layer plan from YAML phase metadata, so agents copy items instead of hand-writing them.

**Why:** 1101 classes C1 (no generator), C3 (plan step skipped) and C4 (raw FSM, colliding labels).

**Where:**

| File | Change |
| --- | --- |
| `apps/cli/schemas/state-machine-workflow.schema.json` | `display` on state items, strict, mirrors 1103 |
| `config/workflows/task-pipeline.yaml`, `idea-pipeline.yaml` | `display` per non-terminal state from the prototype table (`2026-10-plan-projection-prototype.ts:40-116`); phase keys `implement`, `test`, `review`, `verify` / `discover`, `define`, `design`, `decompose`, `handoff` |
| `packages/app/src/workflow/step-reporter.ts` | unchanged except reuse of `VisibleItem`; existing `columnLabel`/`renderWorkflowTodo`/`renderRunPlan` untouched |
| `packages/app/src/workflow/plan-projection.ts` (new) | the frozen functions below; a separate file because it is a bundle entrypoint; `step-reporter.ts` keeps `VisibleItem`/`VisibleOutcome` and re-exports nothing new |
| `scripts/commands/bundle-plugin-lib.ts` | add `plan-projection.generated.mjs|.d.mts` entry (pattern at lines 120-135) |
| `plugins/sp/scripts/batch-plan.ts` (+ committed `.mjs`) | thin standalone wrapper: `batch-plan.mjs waves --tasks <file.json>` prints `{ waves: PhasedPlanItem[][] }`; `batch-plan.mjs task-children --letter <L> --plan <workflow-show.json>` prints the task's digit items. Imports only `node:*`, relative lib, `import type` |
| `packages/app/src/services/workflow-service.ts:584` | call `validatePhaseTable` after the existing load; findings are errors |
| `apps/cli/src/commands/workflow.ts:1676-1700` | add `plan: buildPhasedPlan(def)` (or `null`) to the todo projection |
| `packages/app/src/index.ts` | export the new functions/types |
| `docs/design/cli-contracts.md:768`, `plugins/sp/skills/spur-cli/references/workflows.md:273` | document `plan`, item text, cap |
| bundle | `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/` and `plugins/sp/lib/*.generated.mjs` |

**Frozen names (packages/app):**

- `planLetter(index: number): string` — 0→A … 25→Z, throws past Z.
- `planChild(parent: string, index: number): string` — 0→`A1` … 8→`A9`, throws past 9.
- `interface PhasedPlanItem extends VisibleItem { text: string; parent?: string }` — `id` is the state id, `prepare.<n>`, `phase.<key>`, `task.<wbs>` or `report`.
- `buildPhasedPlan(def: WorkflowDef): PhasedPlanItem[] | null` — `null` when no state declares `display`.
- `validatePhaseTable(def: WorkflowDef): string[]` — empty when unannotated.
- `insertOnEntry(items: PhasedPlanItem[], stateId: string, def: WorkflowDef): PhasedPlanItem[]` — next digit under the state's phase.
- `buildBatchPlan(tasks: { wbs: string; name: string }[]): PhasedPlanItem[][]` — waves of 24; `taskPhaseChildren(taskLetter: string, plan: PhasedPlanItem[]): PhasedPlanItem[]` for start-time digits.
- `hostStatus(outcome: VisibleOutcome): 'pending' | 'in_progress' | 'completed'` and `hostText(item: PhasedPlanItem): string` (appends `[outcome]` for skipped/failed/unattempted/blocked).
- Prepare rows: single `Quick readiness`, `Prepare Git`, `Publish plan`; batch `Resolve and freeze task set`, `Order by dependencies`, `Prepare Git`, `Publish plan`. Task titles truncate at 60 chars with `…`.

**Invariants:** labels are display addresses, ids are identity; a label once issued never changes within a run; `completed` only from an observed completion; terminal states never get an item.

**Anti-patterns:** no `AA`/`A10`; no new outcome enum; no host-specific code in `packages/app` beyond the status/text mapping; no change to `steps` or to unannotated workflows' output; no run-time tracker class (1105's agents drive state transitions; the functions are pure).

**Dependency handoff:** needs 1103's released engine pinned in Spur. 1105 consumes `plan`, `insertOnEntry`, `buildBatchPlan`, `taskPhaseChildren`, `hostStatus`, `hostText` names in skill prose.

### Plan

1. (R7, test first) Write `packages/app/tests/workflow/plan-projection.test.ts` for AC3–AC6 from the prototype self-checks (`2026-10-plan-projection-prototype.ts:422-481`); confirm they fail.
2. (R2, R5, R6) Implement the frozen functions in `plan-projection.ts`; export from `packages/app/src/index.ts`; tests green.
3. (R3) Wire `validatePhaseTable` into `WorkflowService.validate`; add the AC3 CLI case.
4. (R1) Add `display` to `apps/cli/schemas/state-machine-workflow.schema.json`; annotate both pipeline YAMLs; `spur workflow validate` across `config/workflows/*.yaml` (AC1).
5. (R4) Add `plan` to the todo JSON projection; assert AC2 with an `apps/cli/tests` case against the real `task-pipeline.yaml`.
6. (R4) Update `docs/design/cli-contracts.md` and `plugins/sp/skills/spur-cli/references/workflows.md`.
7. (R5) Add the `bundle-plugin-lib.ts` entry and `plugins/sp/scripts/batch-plan.ts`; run it on a 30-task fixture (AC5); `bun run plugin-smoke`.
8. `bun run --filter @gobing-ai/spur build:bundle`; `bun run spur-check`; commit `feat(workflow): generate the two-layer plan from YAML display phases (1104)`.

### Solution

Two-layer A-Z/1-9 plan derived from the engine's presentation-only `StateDef.display` (0.5.17); no hand-maintained mirror table.

- `packages/app/src/workflow/plan-projection.ts` (new, pure; caps `planLetter` at packages/app/src/workflow/plan-projection.ts:26, `planChild` at :37, item shape `PhasedPlanItem` at :50, projection `buildPhasedPlan` at :106, `validatePhaseTable` at :173, `insertOnEntry` at :226, `buildBatchPlan` at :269, `taskPhaseChildren` at :329, `hostStatus`/`hostText` at :354/:361): `planLetter(i)` 0→A…25→Z and `planChild(parent, i)` 0→A1…8→A9 both throw past their caps; `interface PhasedPlanItem extends VisibleItem { text: string; parent?: string; title?: string }` with ids `prepare`, `prepare.<n>`, `phase.<key>`, state ids, `task.<wbs>`, `report`; `buildPhasedPlan(def)` returns null when no state declares `display` (unannotated pipelines unchanged), opens with `A Prepare` + A1..A3, letters phases by first appearance in state declaration order (`phaseTitle` when any state of the phase declares one, else the phase key), and projects only `show: 'plan'` states as digits; `validatePhaseTable(def)` is opt-in per annotated workflow — unannotated defs and non-state-machine kinds are valid by omission, findings name the offending state or phase (non-terminal without display, terminal with display, >25 phases, >9 states in a phase, conflicting `phaseTitle`); `insertOnEntry(items, stateId, def)` adds the on-entry digit the moment the host enters the state — pure, idempotent, existing labels never change (loop verify→test-fix→verify renders identically); `buildBatchPlan(tasks)` slices waves of 24 (`A Prepare batch` + A1..A4, B..Y task rows with no digit children, `Z Batch report`; task names truncate to 60 chars with `…`); `taskPhaseChildren(taskLetter, plan)` yields one digit per phase row; `hostStatus(outcome)` maps only `completed`→completed and `active`→in_progress — `skipped`/`failed`/`unattempted`/`blocked` stay pending because the host decides them; `hostText(item)` appends `[outcome]` for exactly those four.
- Annotations: `config/workflows/task-pipeline.yaml` (13 non-terminal states; phases implement / test / review / "Verify & record"; `show: on-entry` on escalate, test-fix, test-recheck, test-fail-triage, review-fail-triage, approve) and `idea-pipeline.yaml` (discover / "Define feature" / design / decompose / "Hand off"; all states plan-visible). Initial task-pipeline plan: A prepare block, B Implement (precheck, implement), C Test (test), D Review (triage, review), E Verify & record (verify, record).
- `apps/cli/schemas/state-machine-workflow.schema.json:108`: backfilled `display` (same commit as the YAML annotation, R1). Engine JSON-schema drift (`resumeRerun`/`startable`) intentionally not fixed here; no workflow version bump (digest changes are expected).
- `WorkflowAppService.validate` calls `validatePhaseTable` after the terminal-reason check (packages/app/src/services/workflow-service.ts:695); findings fail validate as `{ ok: false, valid: false, file, errors }` (R3).
- `workflow show --format todo --json` additionally projects `plan: buildPhasedPlan(def) ?? null` (apps/cli/src/commands/workflow.ts:1698) — additive; `steps` and the JSON schema for unannotated definitions unchanged (R4).
- `plugins/sp/scripts/batch-plan.ts` + committed `.mjs` twin: ADR-130 thin wrapper over `plugins/sp/lib/plan-projection.generated.*` — `waves --tasks <file>` prints `{ waves }`, `task-children --letter <A-Z> --plan <file>` prints the phase digits (accepts a bare plan array or a todo `--json` payload); exit 2 usage / 1 IO. Bundler entry `bundlePlanProjectionLib` added to `scripts/commands/bundle-plugin-lib.ts`; script registered in `config/plugin-scripts.json` and the `build:scripts` chain.
- Docs (T3): `docs/design/cli-contracts.md` and `plugins/sp/skills/spur-cli/references/workflows.md` document the additive `plan` key and the validate phase-table gate.

Tests were written first (red), then implemented (green): `packages/app/tests/workflow/plan-projection.test.ts` (20 tests — caps AC4, projection AC2, validation AC3, batch AC5, children R5, host mapping AC6, label stability), `apps/cli/tests/workflow/display-plan.test.ts` (AC1 every bundled workflow validates; AC2 todo `--json` plan content vs the real task-pipeline with `steps` unchanged; AC3 CLI rejection of a half-annotated table naming state `b` and terminal `done`, plus a fully annotated pass). Existing 0695 R4 exact-shape test updated with the additive `plan: null`.

Verification: `bun run spur-check` PASS (biome + workspace typechecks + 10393 tests + pre/post rules); `bun run plugin-smoke` PASS; `script-contract-check` PASS (21 scripts, 0 violations); AC5 demonstrated with bare `node plugins/sp/scripts/batch-plan.mjs` on a 30-task fixture (2 waves of 24/6, B..Y letters, A/Z bookends) and `task-children --letter B` over the live todo projection (B1..B4 phase rows).

Constraints honored: no lifecycle status transitions from this task; `plugins/sp/lib/idea-handoff.generated.mjs` and `inline-run.generated.mjs` left untouched (pre-existing working-tree churn from a concurrent session — full `build:plugin-lib` regeneration deliberately not run; only the new `plan-projection.generated.*` was bundled).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/schemas/state-machine-workflow.schema.json:108; config/workflows/task-pipeline.yaml:216; idea-pipeline.yaml:82 |
| R2 | MET | packages/app/src/workflow/plan-projection.ts:26,106 |
| R3 | MET | plan-projection.ts:173 + workflow-service.ts:76 |
| R4 | MET | apps/cli/src/commands/workflow.ts:1709; docs/design/cli-contracts.md:779 |
| R5 | MET | plan-projection.ts:269; plugins/sp/scripts/batch-plan.ts:1; config/plugin-scripts.json:11 |
| R6 | MET | plan-projection.ts:354,361 |
| R7 | MET | packages/app/tests/workflow/plan-projection.test.ts:54 |
| AC1 | MET | apps/cli/tests/workflow/display-plan.test.ts:29 |
| AC2 | MET | display-plan.test.ts:47 |
| AC3 | MET | display-plan.test.ts:156 + plan-projection.test.ts:193-233 |
| AC4 | MET | plan-projection.test.ts:54,153 |
| AC5 | MET | plan-projection.test.ts:251; plugins/sp/scripts/batch-plan.mjs |
| AC6 | MET | plan-projection.test.ts:308,316 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

Review + verify (2026-10-07, fresh-context reviewer subagent):

- Review verdict: pass — 0 P1/P2; P3 doc wording (docs/design/cli-contracts.md:779 "exact pre-1104 shape" vs additive plan:null); P4 UTF-16 surrogate edge in truncateTitle (plan-projection.ts:259). Both non-blocking.
- Verify verdict: PASS — R1–R7, AC1–AC6 all MET.
- Evidence: .spur/run/evidence/1104-review-verdict.json, .spur/run/1104-verdict.json.
- Implementation: commit cb11ac0e6; gates spur-check 10393 pass/0 fail, plugin-smoke PASS, script-contract-check PASS.

Findings table (fresh-context review, 2026-10-07):

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P1 | none found | — | — |
| P2 | none found | — | — |
| P3 | Contract-doc wording overstates "exact pre-1104 shape" (todo --json now always carries plan, null when unannotated) | docs/design/cli-contracts.md:779 | Deferred — cosmetic doc nuance, non-blocking |
| P4 | truncateTitle may split a surrogate pair at the 60-unit cut | packages/app/src/workflow/plan-projection.ts:259 | Deferred — cosmetic, all bundled titles BMP |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:23:30.237Z backlog → todo (system)
- 2026-10-07T17:06:08.581Z todo → wip (system)
- 2026-10-07T17:20:10.093Z wip → testing (system)
- 2026-10-07T17:20:11.976Z testing → done (system)

