---
schema_version: 1
name: "Kind-aware workflow todo renderer and spur workflow show --format/--json"
status: done
template: feature-impl
created_at: 2026-08-27T23:57:38.268Z
updated_at: "2026-08-28T04:28:15.108Z"
feature_id: D7
priority: P2
tags: ["workflow", "cli-surface"]
---

## 0695. Kind-aware workflow todo renderer and spur workflow show --format/--json

### Background

`spur workflow show` renders exactly one projection today — a mermaid FSM diagram, hardcoded with no
options at all (`apps/cli/src/commands/workflow.ts:800` takes only `<file>`). Separately,
`renderRunPlan` (`packages/app/src/workflow/step-reporter.ts:171`) emits a one-line
`plan: a → b → c` at run start, built from declaration order and discarding everything except the
ids. Neither serves the actual consumer:
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:34` (task 0596) instructs the
inline driver to read `task-pipeline.yaml` and hand-build a two-layer todo list — a descriptive
procedure doing work a deterministic renderer should do.

This task adds the todo projection and the option surface that exposes it. It covers feature D7
scenarios R1 (default output unchanged), R2 (transition-flow declared node order with node-type
markers), R3 (state-machine declared inventory with markers), R4 (`--json` machine shape), R5 (one
shared step builder behind both the plan preview and the todo projection), R7 (unknown `--format`
value), and R8 (unresolvable or invalid definition). Scenario R6 belongs to task 0696.

Two premises were verified against the current tree during refine, and both changed the shape of
the work:

- **Every definition in `config/workflows/` is `kind: state-machine`** — all eleven of them; the
  repository contains no `transition-flow` definition, and the concrete consumer
  (`task-pipeline.yaml`) is a state machine. Topological ordering was therefore dropped: both kinds
  render in declaration order, and feature scenario R2 was retitled before any task referenced it.
- **`renderWorkflowMermaid` lives in `apps/cli`, `renderRunPlan` in `packages/app`.** The single-
  builder rule scopes to the plan/todo step sequence only; the diagram renderer stays where it is
  and is not routed through the builder.

The surface change crosses the ADR-051 public-CLI consent gate; consent was given at the D7
idea-evaluation gate, which also rejected a boolean `--todo` flag and a separate
`spur workflow todo` verb, and rejected caching the rendered output as speculative.

### Requirements

- [ ] R1. **Shared step builder.** Add `buildWorkflowSteps(def: WorkflowDef): WorkflowStep[]` to
`packages/app/src/workflow/step-reporter.ts`, returning one entry per declared state (state-machine)
or node (transition-flow) in **declaration order**, each carrying its id and its `initial`,
`terminal`, `failure`, `pause`, `loopBack`, `conditional` markers plus the transition-flow
`nodeType`. Rewrite `renderRunPlan` to derive its sequence from this builder; its emitted string
stays byte-identical (`plan: a → b → c`).

- [ ] R2. **Todo renderer.** Add `renderWorkflowTodo(def: WorkflowDef): string` to the same module,
rendering the builder output as a markdown checklist — one `- [ ] <id>` line per step with its
markers appended. For `kind: state-machine` the header block states that the list is a declared
inventory, not a predicted execution path. No topological reordering is applied for either kind.

- [ ] R3. **`--format` on `spur workflow show`.** Add `--format <mermaid|todo>` defaulting to `mermaid`.
With the option omitted, stdout is byte-identical to the pre-change output. In the **same commit**:
document the resulting `show` option surface in `docs/04_DESIGN.md` (constitution T3), add both
options to the `show` row in `plugins/sp/skills/spur-cli/references/workflows.md` (the
`cli-surface-parity` gate compares that reference bidirectionally against live
`workflow show --help`, so omitting it fails `bun run test` with `on-CLI-not-documented`), and
record the ADR-051 public-surface consent granted at the D7 idea gate.

- [ ] R4. **`--json` on `spur workflow show`.** Emit `{ name, kind, format, steps }` for
`--format todo` (steps being the `buildWorkflowSteps` output) and `{ name, kind, format, diagram }`
for `mermaid`, where `diagram` is the fenced block the human path prints. `--json` with no
`--format` returns the mermaid envelope.

- [ ] R5. **Predictable failure.** An unrecognised `--format` value exits non-zero with stderr naming both
accepted values. A path that does not resolve, or a file that fails schema validation, exits 1 with
the message the mermaid path emits today — identically for every format.

### Acceptance Criteria

Covers feature D7 scenarios R1, R2, R3, R4, R5, R7, R8. Scenario R6 belongs to task 0696.

```gherkin
  Scenario: R1 — spur workflow show without --format renders the mermaid diagram unchanged
    Given a valid workflow definition file resolvable by the two-tier project-then-bundled lookup
    When "spur workflow show <file>" is run with no --format option
    Then stdout is byte-identical to the output produced before the flag was introduced
    And the exit code is 0

  Scenario: R2 — --format todo renders a transition-flow definition in declared node order with node-type markers
    Given a workflow definition whose kind is transition-flow
    When "spur workflow show <file> --format todo" is run
    Then every node id appears exactly once as an unchecked checkbox item in declaration order
    And the initialNode is marked initial and nodes listed in terminalNodes are marked terminal
    And node type gate, decision, and parallel are labelled on their items
    And no topological reordering is applied

  Scenario: R3 — --format todo renders a state-machine definition as a declared step inventory
    Given a workflow definition whose kind is state-machine with at least one loop-back transition
    When "spur workflow show <file> --format todo" is run
    Then every state id appears exactly once as an unchecked checkbox item in declaration order
    And the output declares that the list is a declared inventory rather than a predicted execution path
    And the initialState is marked initial, terminal states are marked terminal, and failure states are marked failure
    And every state carrying pause true is marked as an operator pause
    And each state that is the target of a transition whose source is declared later is marked loop-back
    And a state entered only through guarded transitions is marked conditional

  Scenario: R4 — --json emits the machine shape of the selected format
    Given a valid workflow definition file
    When "spur workflow show <file> --format todo --json" is run
    Then stdout parses as JSON
    And the payload carries the workflow name, its kind, and an ordered array of step objects
    And each step object carries its id and its markers for initial, terminal, pause, loop-back, and conditional
    And "spur workflow show <file> --json" with no --format returns the mermaid projection in the same envelope

  Scenario: R5 — the todo projection and the run-start plan preview share one step builder
    Given a single exported step-builder function that turns a WorkflowDef into an ordered step list
    When renderRunPlan and the todo renderer are both invoked on the same definition
    Then both derive their step sequence from that one builder
    And no independent step-sequence derivation exists in the todo or plan path

  Scenario: R7 — an unrecognised --format value fails with a non-zero exit naming the accepted values
    Given a valid workflow definition file
    When "spur workflow show <file> --format outline" is run
    Then the exit code is non-zero
    And stderr names both accepted values mermaid and todo

  Scenario: R8 — an unresolvable or invalid definition fails identically for every format
    Given a workflow file path that does not resolve, or a file that fails schema validation
    When "spur workflow show <file> --format todo" is run
    Then the exit code is 1
    And the error message is the same one the mermaid path emits for that condition
```

### Q&A

**Surface shape — decided (ADR-051 consent, D7 idea gate).** `--format <mermaid|todo>` on the
existing `show` verb. A boolean `--todo` was rejected: `show` has no format flag today, and booleans
stop composing the moment a third projection lands. A separate `spur workflow todo` verb was
rejected: it would duplicate `resolveWorkflowFile`, `loadWorkflowDef`, and both error branches for a
different output encoding only — that is a flag, not an action.

**Caching — dropped, not deferred.** Rejected at the idea gate. `loadWorkflowDef` on the largest
shipped definition is single-digit milliseconds and the render is pure; a cache buys a key,
an invalidation bug class, and a stale-output failure mode for no measured gain.

**Topological ordering — dropped after premise verification.** Every definition in
`config/workflows/` is `kind: state-machine`; the repository has zero `transition-flow` definitions.
A Kahn sort plus cycle handling would be written for a kind nothing uses. Both kinds render in
declaration order. Feature scenario R2 was retitled accordingly before any task referenced it.

**`--vars` — deferred, condition stated.** v1 marks a state `conditional`; it does not resolve
whether that state will actually be entered. Add `--vars` only if the inline pipeline driver (0696)
demonstrably needs entry prediction rather than the marker.

**`renderWorkflowMermaid` stays where it is — decided.** It remains in
`apps/cli/src/workflow/mermaid-render.ts` and is *not* routed through `buildWorkflowSteps`. Emitting
diagram nodes is not step sequencing; forcing them through one builder would couple two renderers
with different output models for no benefit. R1's single-builder rule scopes to the plan/todo step
sequence only.

### Design

**WHAT.** One shared step builder plus a second renderer in the module that already owns the
run-start plan preview, exposed through two new options on the existing `show` verb. No new verb,
no new module home, no cache.

**WHY here.** `renderRunPlan` (`packages/app/src/workflow/step-reporter.ts:171`) already turns a
`WorkflowDef` into an ordered step sequence — it just throws away everything except the ids and
flattens the result to one line. The todo projection needs the same sequence with markers kept.
Putting the builder beside `renderRunPlan` and rebuilding `renderRunPlan` on top of it means the
plan preview and the todo projection cannot disagree about what the steps are.

**WHERE (frozen names).**

`packages/app/src/workflow/step-reporter.ts` — additions:

```ts
export interface WorkflowStep {
    id: string;
    initial: boolean;
    terminal: boolean;
    failure: boolean;
    pause: boolean;
    loopBack: boolean;
    conditional: boolean;
    /** transition-flow only; absent for state-machine steps. */
    nodeType?: 'action' | 'gate' | 'parallel' | 'decision';
}
export function buildWorkflowSteps(def: WorkflowDef): WorkflowStep[];
export function renderWorkflowTodo(def: WorkflowDef): string;
```

`renderRunPlan` becomes `plan: ${buildWorkflowSteps(def).map((s) => s.id).join(' → ')}` — same
string as today for every shipped definition, because the builder preserves declaration order.

`packages/app/src/index.ts` — add `buildWorkflowSteps`, `renderWorkflowTodo`, and
`type WorkflowStep` to the existing step-reporter export block (around line 591).

`apps/cli/src/commands/workflow.ts` — the `show` block (line 800):

```ts
.option('--format <name>', 'Projection to render: mermaid (default) or todo', 'mermaid')
.option(...SHARED_OPTIONS.jsonSupported)
```

**Marker algorithm (non-obvious — freeze it).** Let `order` be the declaration index of each
state/node id.

- `initial` — `id === def.initialState` (state-machine) or `def.initialNode` (transition-flow).
- `terminal` — `def.terminalStates` / `def.terminalNodes` contains the id.
- `failure` — state-machine only: `def.failureStates` contains the id. Always `false` for
  transition-flow, which has no failure-state concept.
- `pause` — the state's / node's `pause === true`.
- `loopBack` — some incoming transition/edge `t` satisfies `t.to === id && order[t.from] >= order[id]`
  (a self-loop qualifies). This is the honest "the run can come back here" signal.
- `conditional` — the step has at least one incoming transition/edge **and every one of them**
  carries a `guard` (state-machine) / `condition` (transition-flow). A step with any unconditional
  incoming edge is not conditional. The initial step is never conditional regardless of incoming
  edges.

**Todo output shape (frozen — 0696 quotes it).**

```
# task-pipeline (state-machine) — declared steps

Declared step inventory in declaration order, not a predicted execution path.

- [ ] precheck — initial
- [ ] implement
- [ ] approve — pause
- [ ] verify — loop-back
- [ ] done — terminal
```

The disclaimer line is emitted for `state-machine` only. Markers are appended after ` — ` joined by
` · ` in the order initial, terminal, failure, pause, loop-back, conditional, then `nodeType` when
it is not `action`. A step with no markers gets no suffix.

**JSON envelopes.** `--format todo --json` → `{ name, kind, format: 'todo', steps: WorkflowStep[] }`.
`--format mermaid --json` (and bare `--json`) → `{ name, kind, format: 'mermaid', diagram: string }`
where `diagram` is the exact fenced block the human path writes. Both go through `toJson`
(`apps/cli/src/output.ts:20`).

**Error handling.** Validate `--format` before resolving the file so an unknown value fails fast:
`context.output.error("workflow show: unknown --format '<v>' — expected mermaid or todo")` +
`context.setExitCode(1)`. The existing not-found and parse-failure branches are untouched and run
identically for both formats, satisfying R5's "identical message" requirement by construction.

**Anti-patterns — do not implement.**

- No topological sort, Kahn pass, or cycle detection. Declaration order for both kinds.
- No cache, memo, or fingerprint of the rendered output.
- Do not change `renderRunPlan`'s emitted string, the `--no-plan` flag, or any run-time behaviour.
- Do not move, re-implement, or route `renderWorkflowMermaid` through `buildWorkflowSteps`.
- Do not add a `todo` verb or a boolean `--todo` alias.
- Do not resolve `--vars` or predict which conditional steps will be entered.

**Handoff to 0696.** Task 0696 rewrites `inline-pipeline-driver.md` § Run setup step 4 and the
`sp:spur-cli` workflows `show` row against the exact command
`spur workflow show <file> --format todo --json` and the `WorkflowStep` field names frozen above.
Changing those names after this task lands invalidates 0696's text — treat them as the contract.

**Parity gate — verified constraint, not a guess.** `plugins/sp/tests/cli-surface-parity.test.ts`
compares each noun's `spur-cli/references/*.md` verb/flag inventory bidirectionally against live
`<noun> <verb> --help`, captured from the source-local monorepo entry
(`plugins/sp/tests/helpers/cli-surface.ts`). Adding `--format` and `--json` to `show` without
updating the `show` row in `plugins/sp/skills/spur-cli/references/workflows.md` fails `bun run test`
with `on-CLI-not-documented`. That reference edit therefore belongs to **this** task, not 0696 —
otherwise this task cannot reach a green gate on its own, violating the commit-per-task rule.
Consequently this task covers two of feature scenario R6's four `Then` lines (the `spur-cli`
reference row and the `docs/04_DESIGN.md` sync); 0696 covers the two inline-pipeline-driver lines.

**Existing doc anchors to edit.** `docs/04_DESIGN.md:556` carries the one-line `spur workflow …`
signature run for the whole noun — extend the `show` entry there. `docs/04_DESIGN.md:258` carries
the `spur workflow show      <file>` synopsis line — extend it too.

### Plan

1. Add `WorkflowStep` and `buildWorkflowSteps` to `packages/app/src/workflow/step-reporter.ts`, and
   rewrite `renderRunPlan` on top of the builder (R1).
2. Add `renderWorkflowTodo` in the same module, rendering the frozen checklist shape (R2).
3. Export `buildWorkflowSteps`, `renderWorkflowTodo`, and `type WorkflowStep` from
   `packages/app/src/index.ts` (R1, R2).
4. Add `--format <name>` (default `mermaid`) and `--json` to the `show` block in
   `apps/cli/src/commands/workflow.ts`; wire both projections, both JSON envelopes, and the
   unknown-format fast-fail (R3, R4, R5).
5. Extend `packages/app/tests/workflow/step-reporter.test.ts`: builder markers on a state-machine
   fixture carrying a loop-back, a `pause` state, a guarded-only state, and a failure state; a
   transition-flow fixture for `nodeType`; and a `renderRunPlan` assertion pinning the existing
   string (R1, R2).
6. Add CLI tests for `show`: bare invocation byte-identical to the mermaid renderer output,
   `--format todo` shape, both `--json` envelopes, unknown `--format` non-zero exit naming both
   values, and unresolvable path exit 1 under `--format todo` (R3, R4, R5).
7. Same-commit doc + parity edits (R3): `docs/04_DESIGN.md` lines 258 and 556 (`show` synopsis and
   signature run), the `show` row in `plugins/sp/skills/spur-cli/references/workflows.md`, and the
   ADR-051 consent record.
8. `bun run lint && bun run test` (root test chains `plugins/sp`, so `cli-surface-parity` runs);
   confirm `spur workflow show config/workflows/task-pipeline.yaml` is unchanged against a
   pre-change capture.

### Solution

- `packages/app/src/workflow/step-reporter.ts:166` — `WorkflowStep` interface (id + initial/terminal/failure/pause/loopBack/conditional markers + transition-flow `nodeType`), exactly the frozen field names 0696 consumes.
- `packages/app/src/workflow/step-reporter.ts:186` — `buildWorkflowSteps(def)`: one entry per declared state/node in declaration order, no topological reordering. Markers per the frozen algorithm: `initial` = initialState/initialNode; `terminal` = terminalStates/terminalNodes; `failure` = failureStates (always false for transition-flow); `pause` = declared pause; `loopBack` = some incoming edge whose source declares at-or-after the target (self-loops included); `conditional` = at least one incoming edge and every one guarded (state-machine `guard` / transition-flow `condition`), never on the initial step.
- `packages/app/src/workflow/step-reporter.ts:232` — `renderWorkflowTodo(def)`: markdown checklist `- [ ] <id>` with markers appended after ` — ` joined by ` · ` in the frozen order; `# <name> (<kind>) — declared steps` header; the declared-inventory disclaimer line emitted for state-machine only.
- `packages/app/src/workflow/step-reporter.ts:261` — `renderRunPlan` rebuilt on the shared builder; emitted string unchanged (`plan: a → b`, byte-identical, verified against a pre-change capture of `config/workflows/task-pipeline.yaml`).
- `packages/app/src/index.ts:592-601` — `buildWorkflowSteps`, `renderWorkflowTodo`, `type WorkflowStep` added to the step-reporter export block.
- `apps/cli/src/commands/workflow.ts:816` — `show` gains `--format <name>` (default `mermaid`) and `--json` (`SHARED_OPTIONS.jsonSupported`); unknown format fails fast before file resolution with `workflow show: unknown --format '<v>' — expected mermaid or todo` + exit 1; not-found and parse-failure branches untouched (identical for every format); `--json` envelopes via `toJson`: `{ name, kind, format: 'todo', steps }` and `{ name, kind, format: 'mermaid', diagram }` (`diagram` = the exact fenced block the human path prints).
- Docs/parity (same change-set): `docs/04_DESIGN.md` workflow signature run (`show` entry gains `[--format <mermaid|todo>] [--json]`); `plugins/sp/skills/spur-cli/references/workflows.md` `show` fence row gains both flags (cli-surface-parity is bidirectional); `docs/design/harness-surface-governance.md` §4 records the ADR-051 consent granted at the D7 idea gate (rejected shapes noted: boolean `--todo`, separate `todo` verb, caching).
- Anti-patterns respected: no topo sort, no cache, no `todo` verb, `renderWorkflowMermaid` untouched in `apps/cli/src/workflow/mermaid-render.ts`, no `--vars` prediction.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/step-reporter.ts:186` — `buildWorkflowSteps(def)`: one entry per declared state/node in declaration order, id + initial/terminal/failure/pause/loopBack/conditional + transition-flow `nodeType`; `renderRunPlan` rebuilt on the builder at `packages/app/src/workflow/step-reporter.ts:261`; byte-identity re-proven this run (`spur workflow show config/workflows/task-pipeline.yaml` current vs stashed-HEAD pre-change output: diff empty, 2936 bytes); builder-parity pin `packages/app/tests/workflow/step-reporter.test.ts:433`; byte-identical CLI test `apps/cli/tests/commands/workflow.test.ts:2260`; exports at `packages/app/src/index.ts:592-601`. |
| R2 | MET | `packages/app/src/workflow/step-reporter.ts:232` — `renderWorkflowTodo(def)`: `- [ ] <id>` checklist, markers after ` — ` joined by ` · ` in frozen order, state-machine-only declared-inventory disclaimer, no topological reordering; frozen-shape tests for both kinds `packages/app/tests/workflow/step-reporter.test.ts:346,385`; live render of the real consumer config matches a hand-computation of the marker algorithm (loop-back on test-fix only, pause on approve, failure on failed/cancelled). |
| R3 | MET | `apps/cli/src/commands/workflow.ts:823` — `--format <name>` default `mermaid`; default-path byte-identity (2936 bytes, diff empty this run); docs synced same change-set: `docs/04_DESIGN.md:556` (show synopsis gains `[--format <mermaid |
| R4 | MET | `apps/cli/src/commands/workflow.ts:846-871` — `--json` envelopes via `toJson`: `{name, kind, format:'todo', steps: buildWorkflowSteps(def)}` and `{name, kind, format:'mermaid', diagram}` (exact fenced block); bare `--json` returns the mermaid envelope; tests `apps/cli/tests/commands/workflow.test.ts:2304,2358`; live smoke this run: todo JSON parses, 12 steps, step[3] `test-fix` loopBack=true; bare JSON parses, 2733-byte diagram. |
| R5 | MET | Unknown format fails fast BEFORE file resolution: `apps/cli/src/commands/workflow.ts:825-831` — exit 1, stderr names both values (live smoke: `workflow show: unknown --format 'outline' — expected mermaid or todo`, exit=1); not-found and schema-invalid branches untouched and shared by both formats (tests `apps/cli/tests/commands/workflow.test.ts:2385,2403` — identical errors, exit 1). Single-builder rule: `renderRunPlan` derives from `buildWorkflowSteps` at `step-reporter.ts:261`, todo renderer iterates the builder at `step-reporter.ts:240`, no independent derivation (`packages/app/tests/workflow/step-reporter.test.ts:433`; CLI equivalence test `workflow.test.ts:2418`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — spur workflow show without --format renders the mermaid diagram unchanged | MET | test | `apps/cli/tests/commands/workflow.test.ts:2260` (bare == `--format mermaid` == renderer, exit 0); git-stash diff this run: 2936 bytes identical |
| Scenario: R2 — --format todo renders a transition-flow definition in declared node order with node-type markers | MET | test | `packages/app/tests/workflow/step-reporter.test.ts:313` (nodeType gate/decision/parallel, declaration order, no reordering) + todo shape `:385` |
| Scenario: R3 — --format todo renders a state-machine definition as a declared step inventory | MET | test | `packages/app/tests/workflow/step-reporter.test.ts:346` (disclaimer, initial/terminal/failure/pause/loop-back/conditional); CLI `apps/cli/tests/commands/workflow.test.ts:2280`; live render of `config/workflows/task-pipeline.yaml` hand-verified against the frozen marker algorithm |
| Scenario: R4 — --json emits the machine shape of the selected format | MET | test | `apps/cli/tests/commands/workflow.test.ts:2304,2358`; live `--format todo --json` parses with 12 steps and correct markers; bare `--json` returns mermaid envelope |
| Scenario: R5 — the todo projection and the run-start plan preview share one step builder | MET | test | `packages/app/tests/workflow/step-reporter.test.ts:433` (plan sequence == builder sequence, both kinds); `apps/cli/tests/commands/workflow.test.ts:2418` (CLI steps == `buildWorkflowSteps(def)`) |
| Scenario: R7 — an unrecognised --format value fails with a non-zero exit naming the accepted values | MET | test | `apps/cli/tests/commands/workflow.test.ts:2373` (exit 1, message names mermaid and todo); live smoke exit=1 with identical stderr |
| Scenario: R8 — an unresolvable or invalid definition fails identically for every format | MET | test | `apps/cli/tests/commands/workflow.test.ts:2385` (unresolvable path, identical errors both formats) and `:2403` (schema-invalid, exit 1, same mermaid-path message) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- Feature: `docs/features/D7_workflow-todo-projection-show-format-for-deterministic-plan-rendering.md`
- Dependent task: `0696` — consumes the frozen command and `WorkflowStep` field names from this task's Design.
- Consumer being retired: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:34` (task 0596 two-layer host todo list).
- Surface governance: ADR-051 (public CLI consent gate), `docs/design/harness-surface-governance.md`.
- Code touched: `packages/app/src/workflow/step-reporter.ts:171` (`renderRunPlan`), `packages/app/src/index.ts:591` (export block), `apps/cli/src/commands/workflow.ts:800` (`show`), `apps/cli/src/output.ts:20` (`toJson`), `apps/cli/src/commands/shared-options.ts:31` (`jsonSupported`).
- Not touched by design: `apps/cli/src/workflow/mermaid-render.ts` (`renderWorkflowMermaid` stays put).
- Engine types: `@gobing-ai/ts-dual-workflow-engine` `StateDef` / `TransitionDef` / `FlowNodeDef` / `FlowEdgeDef` (`dist/types.d.ts:36-113`).

### History
- 2026-08-28T04:02:22.601Z todo → wip (system)
- 2026-08-28T04:28:14.501Z wip → testing (system)
- 2026-08-28T04:28:15.108Z testing → done (system)
