---
schema_version: 1
name: Add per-state display phase metadata to the workflow engine state schema
status: todo
template: feature-impl
created_at: 2026-10-07T06:14:15.476Z
updated_at: "2026-10-07T06:21:14.115Z"
feature_id: I13

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
---

## 1103. Add per-state display phase metadata to the workflow engine state schema

### Background

Map I13 decided that the display phase table lives in workflow YAML. The engine's state schema is `.strict()`, and Spur
loads definitions through `loadWorkflowDef` (`packages/app/src/workflow/workflow-resolver.ts:301-304`), so a `display` key on
a state is rejected today. Per AGENTS.md, fix the released engine facade rather than stripping keys in Spur.

**Refine corrections (2026-10-06)**

1. Anchors moved from `dist/` to source: the strict state object is @gobing-ai/ts-dual-workflow-engine `src/schema.ts`
   lines 89-102 and `StateDef` is `src/types.ts` (ends at line 88, `startable` at line 87), in `~/xprojects/ts-libs`
   (HEAD `db7cf389`, 0.5.16).
2. The engine also ships JSON schemas (`schemas/state-machine-workflow.schema.json`); they already lack `resumeRerun` and
   `startable` (pre-existing drift from the zod schema). `display` is added to the JSON schema too; backfilling the two
   older keys is out of scope.
3. Release is not a local step: the engine `release` script refuses manual publish; releases go through GitHub Actions
   Trusted Publishing on a pushed tag `@gobing-ai/ts-dual-workflow-engine-v<version>`. A tag push is an external publish,
   so it needs the operator (R2 split accordingly).
4. The changelog is the ts-libs root `CHANGELOG.md` (no per-package changelog); precedent commit `da66f12a`
   (`startable`, ADR-035, ts-libs task 0102) shows the expected surface: types, zod, CHANGELOG, `docs/00_ADR.md`,
   `docs/03_ARCHITECTURE.md`, README, tests.
5. Spur validates bundled workflow YAML against its **own** JSON schema copy: `config/workflows/task-pipeline.yaml:49`
   declares `$schema: @gobing-ai/spur/schemas/state-machine-workflow.schema.json`, resolved to
   `apps/cli/schemas/state-machine-workflow.schema.json` (`additionalProperties: false` on states) via
   `apps/cli/src/config/embedded-schemas.ts:19`. Updating that copy belongs to 1104, which first writes `display` into YAML.

### Requirements

- [ ] R1. Add an optional, behavior-free per-state `display` field to the engine `StateDef` type, the state-machine zod schema and the engine state-machine JSON schema: `display: { phase: string, phaseTitle?: string, title?: string, show?: 'plan' | 'on-entry' }`, itself strict. The engine never reads it at run time.
- [ ] R2. Prepare the engine release (version bump, CHANGELOG, ADR/ARCHITECTURE/README notes) in ts-libs; after the operator pushes the release tag, bump the Spur catalog pin (`package.json:35`) and `bun install`; every bundled workflow still loads and validates unchanged.
- [ ] R3. Engine tests cover: field accepted, unknown `display` sub-keys rejected, invalid `show` rejected, absent field leaves the parsed definition unchanged.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A state may declare display metadata (req: R1, R3)
  Given a state-machine workflow whose state declares display: { phase: "test", phaseTitle: "Test", title: "Run quality gate", show: "plan" }
  When loadWorkflowDefFromText parses it
  Then parsing succeeds and the parsed state carries the same display object

Scenario: AC2 — Malformed display metadata is rejected (req: R1, R3)
  Given a state whose display has an unknown sub-key, or show: "always"
  When the definition is parsed
  Then parsing fails with a WorkflowValidationError naming the state's display field

Scenario: AC3 — Display metadata has no run-time effect (req: R1, R3)
  Given two copies of the same workflow, one with display on every state and one without
  When both run to completion with the same inputs
  Then they visit the same states in the same order and emit the same events

Scenario: AC4 — Spur adopts the release with no workflow change (req: R2)
  Given the Spur catalog pins the released engine version
  When spur workflow validate runs on every file in config/workflows
  Then every file reports valid and bun run spur-check passes
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T06:20:42.011Z

- **Field shape:** one nested `display` object rather than flat `phase`/`title` keys. It keeps presentation keys out of the state's execution namespace and gives one strict place to grow. Decided by map I13 ("phase table in YAML").
- **Transition-flow and DAG nodes:** not extended. Only the state-machine dev pipelines need phases; add to `FlowNodeDef` when a transition-flow workflow needs a plan (YAGNI).
- **Who publishes:** the implementer prepares the release commit in ts-libs; the operator pushes the tag (external publish). The task pauses at that point rather than working around it with a local link.
- **Engine JSON schema drift** (`resumeRerun`, `startable` missing): recorded, not fixed here.

### Design

**What:** a presentation-only `display` field on state-machine states, accepted by the engine and ignored by it.

**Why:** the plan generator (1104) needs per-state phase metadata from the workflow YAML; the strict engine schema rejects any unknown state key, and AGENTS.md requires fixing the `@gobing-ai/ts-*` facade rather than stripping keys in Spur.

**Where (ts-libs, `packages/dual-workflow-engine`):**

| File | Change |
| --- | --- |
| `src/types.ts` | `export interface StateDisplay { readonly phase: string; readonly phaseTitle?: string; readonly title?: string; readonly show?: 'plan' \| 'on-entry' }`; `StateDef.display?: StateDisplay` with a doc comment "presentation only; the engine never reads it" |
| `src/schema.ts` | `StateDisplaySchema = z.object({ phase: z.string().min(1), phaseTitle: z.string().min(1).optional(), title: z.string().min(1).optional(), show: z.enum(['plan', 'on-entry']).optional() }).strict()`; `display: StateDisplaySchema.optional()` in the state object (lines 89-102) |
| `schemas/state-machine-workflow.schema.json` | `display` property on state items with the same shape and `additionalProperties: false` |
| `src/index.ts` | export `StateDisplay` type if types are re-exported there |
| `tests/schema.test.ts` | AC1–AC2 cases; AC3 as a run-equivalence case in `tests/state-machine.test.ts` |
| root `CHANGELOG.md`, `docs/00_ADR.md` (new ADR next number), `docs/03_ARCHITECTURE.md`, package `README.md` | document the field, per precedent `da66f12a` |
| `package.json` version | patch bump per the ts-libs "bump all packages" release convention |

**Spur side:** `package.json:35` catalog `^0.5.16` → released version; `bun install`; no source change.

**Frozen names:** `display`, `StateDisplay`, `StateDisplaySchema`, `phase`, `phaseTitle`, `title`, `show`, `'plan' | 'on-entry'`. Default for absent `show` is `plan` (interpreted by 1104, not the engine).

**Invariants:** the engine never branches on `display`; a definition without `display` parses to the identical object as before.

**Anti-patterns:** no stripping of `display` in Spur's resolver; no `display` on `FlowNodeDef`/DAG nodes; no backfill of `resumeRerun`/`startable` in the JSON schema in this task.

**Dependency handoff to 1104:** 1104 starts only after the Spur catalog pins the released version. 1104 owns Spur's JSON schema copy and the YAML annotation.

**Cross-repo note:** the engine work follows ts-libs' own docs and gates (`bun run check` in the package). Spur commits for this task carry `(1103)`.

### Plan

1. (R3, test first) In ts-libs, add failing `tests/schema.test.ts` cases for AC1–AC2 and a run-equivalence case for AC3.
2. (R1) Add `StateDisplay` to `src/types.ts`, `StateDisplaySchema` to `src/schema.ts`, and `display` to `schemas/state-machine-workflow.schema.json`; export the type.
3. (R1, R3) `bun run check` in `packages/dual-workflow-engine` until green.
4. (R2) CHANGELOG, ADR, ARCHITECTURE, README; version bump; commit in ts-libs.
5. (R2) Stop and ask the operator to push the release tag; confirm the version is on the registry (`bun pm view @gobing-ai/ts-dual-workflow-engine version`).
6. (R2, AC4) In Spur, bump `package.json:35`, `bun install`, run `spur workflow validate` over `config/workflows/*.yaml`, then `bun run spur-check`; commit `chore(deps): bump ts-dual-workflow-engine for state display metadata (1103)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:21:14.115Z backlog → todo (system)

