---
schema_version: 1
name: "Add spur workflow show to render a workflow FSM as a mermaid diagram"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.595Z
updated_at: "2026-08-20T23:18:38.784Z"
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

- [ ] R1. Add a read-only `show` verb on the `workflow` noun that emits a markdown snippet containing a fenced `mermaid` code block for the given definition file.
- [ ] R2. Render every declared state and every transition between them, with terminal and failure states visually distinguished from ordinary states.
- [ ] R3. Exit non-zero naming the file and the parse failure when the definition is missing or unparseable, emitting no partial diagram.
- [ ] R4. Cover both workflow kinds the engine supports, or state explicitly which kind is rendered and how the other is reported.
- [ ] R5. Update `docs/help/cmd_workflow.md`, `docs/help/spur-cli-matrix.md`, `docs/04_DESIGN.md`, and the `sp:spur-cli` workflow reference in the same commit.

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

- [ ] Read the workflow definition loader and the schema to fix which resolved structure the renderer consumes
- [ ] Implement the mermaid renderer over states and transitions (R1, R2)
- [ ] Distinguish terminal and failure states in the rendered graph (R2)
- [ ] Handle the missing and unparseable cases with a non-zero exit and no partial output (R3)
- [ ] Decide and document the handling for each supported workflow kind (R4)
- [ ] Add tests over the shipped definitions plus the failure paths
- [ ] Update `cmd_workflow.md`, the CLI matrix, `docs/04_DESIGN.md`, and the `sp:spur-cli` workflow reference (R5)
- [ ] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
