---
schema_version: 1
name: "Add spur workflow show to render a workflow FSM as a mermaid diagram"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.595Z
updated_at: "2026-08-21T21:02:24.034Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0620. Add spur workflow show to render a workflow FSM as a mermaid diagram

### Background

Reading a workflow's state graph today means parsing the YAML by eye. `idea-pipeline.yaml` is
42 KB and `task-pipeline.yaml` is 39 KB; `spur workflow run` prints a linear plan line, which shows
declaration order but not the branching, the failure edges, or which states are terminal.

A mermaid rendering is directly useful to the composition review this feature is about — the fastest
way to see that a state carries an oversized action or that a failure edge is missing is to look at
the graph.

The verb is read-only and additive: a new verb on an existing noun, which is the expansion mechanism
ADR-051's noun discipline prefers.

Rubric: E2 D1 L1 C2 R1 = 7 → decompose.

### Requirements

- [x] R1. Add a read-only `show` verb on the `workflow` noun that emits a markdown snippet containing a fenced `mermaid` code block for the given definition file.
- [x] R2. Render every declared state and every transition between them, with terminal and failure states visually distinguished from ordinary states.
- [x] R3. Exit non-zero naming the file and the parse failure when the definition is missing or unparseable, emitting no partial diagram.
- [x] R4. Cover both workflow kinds the engine supports, or state explicitly which kind is rendered and how the other is reported.
- [x] R5. Update `docs/help/cmd_workflow.md`, `docs/help/spur-cli-matrix.md`, `docs/04_DESIGN.md`, and the `sp:spur-cli` workflow reference in the same commit.

### Acceptance Criteria

```gherkin
@core
Scenario: R13 — spur workflow show renders the FSM as a mermaid diagram
  Given a valid workflow definition file
  When spur workflow show is run against it
  Then the output is a markdown snippet containing a fenced mermaid code block
  And the diagram carries every declared state and every transition between them
  And terminal and failure states are visually distinguished from ordinary states

@edge
Scenario: R17 — spur workflow show fails cleanly on an unusable definition
  Given a workflow file that is missing or fails to parse
  When spur workflow show is run against it
  Then the command exits non-zero naming the file and the parse failure
  And no partial diagram is emitted
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**A verb on an existing noun, not a new noun.** ADR-051's first-layer discipline makes verbs the
preferred expansion mechanism, and `workflow` already hosts `validate`, `run`, `trace`, and `list`.
`show` sits naturally beside them.

**Render the resolved definition, not the YAML text.** The composition baseline checker already
compares resolved definitions rather than text, for the same reason: extensions and scalar folding
mean the text and the graph are not the same thing. A diagram drawn from the text would disagree with
what the engine actually runs.

**Markdown snippet, not a bare diagram.** The operator's stated use is embedding the result in
documentation, so the output is a fenced `mermaid` block ready to paste — which also renders natively
in the places this project's docs are read.

**Distinguish terminal and failure states.** `terminalStates` and `failureStates` are declared
separately in the schema and mean different things; a diagram that flattens them hides the failure
topology, which is most of what a reviewer is looking for.

**Read-only, with no side effects.** `show` never writes, never creates a run record, and never
touches `.spur/run`.

### Plan

- [x] Read the workflow definition loader and the schema to fix which resolved structure the renderer consumes
- [x] Implement the mermaid renderer over states and transitions (R1, R2)
- [x] Distinguish terminal and failure states in the rendered graph (R2)
- [x] Handle the missing and unparseable cases with a non-zero exit and no partial output (R3)
- [x] Decide and document the handling for each supported workflow kind (R4)
- [x] Add tests over the shipped definitions plus the failure paths
- [x] Update `cmd_workflow.md`, the CLI matrix, `docs/04_DESIGN.md`, and the `sp:spur-cli` workflow reference (R5)
- [x] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution
Read-only `show` verb on the `workflow` noun (task 0620, ADR-051 consent row 4 — verb on an existing noun is the preferred expansion mechanism):

- `apps/cli/src/workflow/mermaid-render.ts` (new) — `renderWorkflowMermaid(def: WorkflowDef)` renders the **resolved** definition (via `loadWorkflowDef`) as a fenced `mermaid` `flowchart LR` block. Both engine kinds are covered, discriminated on `def.kind`: state-machine (`states[]` + `transitions[]`, `terminalStates` green stadium, `failureStates` red, initial highlighted) and transition-flow (`nodes[]` with action/gate/decision/parallel shapes, `edges[]` with condition labels, `terminalNodes` distinguished). Node ids/labels escaped; empty edge labels omitted.
- `apps/cli/src/commands/workflow.ts` — `workflow.command('show')` with `<file>` argument; `loadWorkflowDef(filePath, { validateSchema: true })` in a try/catch → missing/unparseable exits 1 naming the file with no partial output; otherwise writes the mermaid block. Read-only: never writes, never creates a run record.
- Tests — `apps/cli/tests/workflow/mermaid-render.test.ts` (4: both kinds, terminal/failure, escaping) + `apps/cli/tests/commands/workflow.test.ts` `show` describe (2: valid render, missing-file failure).
- Docs (same commit, R5) — `docs/help/cmd_workflow.md` `show` row; `docs/help/spur-cli-matrix.md` `show` under `workflow` (fixed the pre-existing misaligned `show` row) + counts 48 verbs / 72 cells; `docs/04_DESIGN.md` workflow heading gains `spur workflow show`; `plugins/sp/skills/spur-cli/references/workflows.md` command-surface fence.

**Change map (`file:line`):**

| Change |
|--------|
| `apps/cli/src/workflow/mermaid-render.ts:1` |
| `apps/cli/src/commands/workflow.ts:744` |
| `apps/cli/tests/workflow/mermaid-render.test.ts:1` |
| `apps/cli/tests/commands/workflow.test.ts:2181` |
| `docs/help/spur-cli-matrix.md:60` |
| `docs/04_DESIGN.md:517` |
| `plugins/sp/skills/spur-cli/references/workflows.md:236` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R13 — spur workflow show renders the FSM as a mermaid diagram | MET | `apps/cli/src/workflow/mermaid-render.ts:26` (`renderWorkflowMermaid`) emits a fenced `mermaid` `flowchart LR` over the resolved definition, both engine kinds discriminated on `def.kind`; wired at `apps/cli/src/commands/workflow.ts:759` (`.command('show')`). Live re-verify 2026-08-21: `spur workflow show .spur/workflows/task-pipeline.yaml` → fenced mermaid block with `classDef terminal/failure/initial/gate`, exit 0. Tests `apps/cli/tests/workflow/mermaid-render.test.ts` (both kinds, terminal/failure, escaping). |
| Scenario: R17 — spur workflow show fails cleanly on an unusable definition | MET | `apps/cli/src/commands/workflow.ts:769` emits `workflow show: cannot read or parse <file> — <err>` and exits non-zero; renderer runs only after a successful load, so no partial diagram is possible. Live re-verify 2026-08-21: `spur workflow show /nope/missing.yaml` → that message naming the file, exit 1, no diagram. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA), session inline-20260821-131601-0620.

| Priority | Area | Finding | Evidence |
|---|---|---|---|
| P4 | Verify | Renderer is a pure function over the resolved `WorkflowDef` — no I/O, no side effects; `show` never writes, never creates a run record, never touches `.spur/run` (read-only per design). | `apps/cli/src/workflow/mermaid-render.ts` |
| P4 | Verify | Both engine kinds covered by one discriminator (`def.kind`); state-machine (states/transitions) and transition-flow (nodes/edges) both tested. | `mermaid-render.test.ts` |
| P4 | Verify | Failure path exits 1, names the file, and emits no partial diagram (renderer invoked only after a successful load). | CLI test + smoke |
| P4 | Risk | Mermaid node ids/labels escaped (`"` → `&quot;`, `[`/`]` → `&#91;`/`&#93;`) — a workflow id with quotes/brackets can't corrupt the diagram. | `mermaid-render.ts` `esc()` + escaping test |
| P4 | Risk | Edge labels join trigger/guard/description with ` · `; empty labels are omitted (`A --> B`), so a plain transition renders cleanly. | renderer tests |
| P4 | Docs | Fixed a pre-existing misalignment in `spur-cli-matrix.md`'s `show` row (was under builder/self; now under task + workflow). | `docs/help/spur-cli-matrix.md:60` |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T20:34:09.468Z todo → wip (system)
- 2026-08-21T20:34:10.055Z wip → testing (system)
- 2026-08-21T20:35:33.548Z testing → done (system)
