---
schema_version: 1
name: "Route the inline pipeline driver and spur-cli reference to the todo projection"
status: todo
template: feature-impl
created_at: 2026-08-27T23:57:38.341Z
updated_at: "2026-08-28T00:20:59.181Z"
feature_id: D7
priority: P2
tags: ["workflow", "docs", "plugin-surface"]
dependencies: ["0695"]
---

## 0696. Route the inline pipeline driver and spur-cli reference to the todo projection

### Background

`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` § Run setup step 4 (task 0596)
tells the inline driver to render a two-layer plan into the host todo list, and names its
source of truth as "the YAML parsed in step 1 plus the dry-run walk". In practice that means the
model reads `task-pipeline.yaml` and *infers* the state list, its order, and which states are
terminal or pause every run — the exact non-determinism task 0695's `--format todo` projection
exists to remove.

This task retires that instruction. It covers the two inline-pipeline-driver `Then` lines of feature
D7 scenario R6. The other two lines of R6 — the `sp:spur-cli` workflows reference row and the
`docs/04_DESIGN.md` sync — belong to 0695, because `plugins/sp/tests/cli-surface-parity.test.ts`
compares that reference bidirectionally against live `workflow show --help` and would fail 0695's
own gate if deferred here.

Layer 2 of the plan (the active state's `onEnter` actions) is **not** replaced: the todo projection
carries step ids and markers, not action bodies, and step 1 of Run setup already reads the YAML. The
win is narrower and worth stating plainly — the driver stops *deriving* the state sequence and
markers, not reading the file.

### Requirements

R1. **Layer 1 comes from the CLI.** Rewrite `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`
§ Run setup step 4 so layer 1 is obtained from
`spur workflow show <pipeline-yaml> --format todo --json` and read out of its `steps[]` array
(ids in declaration order, with the `initial` / `terminal` / `failure` / `pause` / `loopBack` /
`conditional` markers frozen by task 0695). The driver still marks the active state. The
source-of-truth bullet names the CLI projection for layer 1 and the step-1 YAML parse for layer 2,
and its prohibition covers hand-**deriving** the state list, not only hand-copying it.

R2. **Nothing else in the reference changes.** Layer 2 (the active state's `onEnter` actions), the
stage-boundary refresh cadence, and Run-setup steps 1–3 and 5 are left as they are. The rewritten
step introduces no new state list, ordering rule, or marker vocabulary — it names only the command
and field names 0695 froze, so the two documents cannot drift.

R3. **No second hand-derivation instruction survives.** Sweep the shipped plugin tree
(`plugins/sp/**`) for any other instruction to enumerate, copy, or infer a workflow's state list by
reading YAML. Update each in the same commit, or record in this task's Solution why it is out of
scope (for example, a surface that needs action bodies the todo projection does not carry).

### Acceptance Criteria

Covers the two inline-pipeline-driver `Then` lines of feature D7 scenario R6. The remaining two
lines of R6 (`sp:spur-cli` workflows row, `docs/04_DESIGN.md` sync) are covered by task 0695.

```gherkin
  Scenario: R6 — the inline pipeline driver calls the CLI instead of hand-parsing the YAML
    Given plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md Run setup step 4
    When the reference is read after this feature ships
    Then step 4 instructs the driver to obtain layer 1 from "spur workflow show <file> --format todo --json"
    And it no longer instructs the driver to copy or hand-derive the state list
```

### Q&A

**Scope narrowed during refine — decided.** This task originally also owned the `sp:spur-cli`
workflows reference row for `show`. `plugins/sp/tests/cli-surface-parity.test.ts` compares that
reference bidirectionally against live `workflow show --help`, so leaving it here would make 0695
fail its own verification gate. The row moved to 0695; this task is now the driver rewrite plus the
sibling sweep.

**Layer 2 stays on the YAML — decided.** `steps[]` carries ids and markers, not `onEnter` action
bodies. Replacing layer 2 would require the projection to embed resolved action inputs, which is a
different feature and was not consented to at the D7 idea gate.

**`conditional` is not a prediction — decided.** v1 has no `--vars`, so a `conditional` step means
"entered only through guarded transitions". The reference must not present it as "will be skipped".

**Sibling sweep outcome — open until step 4 runs.** R3 requires the sweep result to be recorded in
`### Solution`: either the surfaces fixed, or the reason each is out of scope. An empty sweep is a
valid answer and must still be stated.

### Design

**WHAT.** A documentation-only change to one shipped plugin reference, plus a sweep for siblings.
No product code, no CLI surface, no test fixtures.

**Assumed from task 0695 (do not re-derive or re-decide).**

- The command is exactly `spur workflow show <file> --format todo --json`.
- Its JSON envelope is `{ name, kind, format: 'todo', steps: WorkflowStep[] }`.
- `WorkflowStep` fields are `id`, `initial`, `terminal`, `failure`, `pause`, `loopBack`,
  `conditional`, and optional `nodeType`.
- `steps[]` is in **declaration order** for both engine kinds; there is no topological reordering
  and no `--vars` resolution, so a `conditional` marker means "entered only through guarded
  transitions", never "will not run".
- File resolution is the same two-tier project→bundled lookup the driver already relies on, so the
  bare definition name works and no absolute path is needed.

If any of those changed while 0695 was implemented, this task's text is wrong — re-read 0695's
Design before editing rather than inventing a reconciliation.

**WHERE.** `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, § Run setup, step 4
(currently lines 34–42). Two of its four bullets change: **Layer 1** and **Source of truth**.

Frozen replacement shape:

```markdown
4. Render the two-layer plan into the host todo list (task 0596):
   - **Layer 1** = `spur workflow show <pipeline-yaml> --format todo --json` → its `steps[]`: the
     declared state inventory in declaration order with `initial` / `terminal` / `failure` /
     `pause` / `loopBack` / `conditional` markers. Mark the active state. Never re-derive this
     list from the YAML.
   - **Layer 2** = the active state's `onEnter` actions (`kind` + resolved `input`/`command`), from
     the YAML parsed in step 1, shown only for the active state.
   - **Refresh cadence** = stage boundaries only (when the current state changes after a
     transition), never per action.
   - **Source of truth** = the CLI projection for layer 1; the YAML parsed in step 1 for layer 2.
     Never hand-copy or hand-derive the state list into the driver, a command, a skill, or a script.
```

**WHY the CLI call is a win even though step 1 still parses the YAML.** Step 1's parse feeds action
execution; layer 1 needs an ordered id list with markers. Today the model produces that by reading
YAML text — order, terminality, and pause status are all inferred, and a misread is invisible.
`--format todo --json` makes them read operations. This narrows what the model derives; it does not
eliminate YAML reading, and the reference should not claim otherwise.

**Anti-patterns — do not implement.**

- Do not replace layer 2 with the todo projection; `steps[]` carries no action bodies.
- Do not add a caching or "fetch once per run" instruction — the driver already calls this once per
  run at setup, and the refresh cadence bullet is unchanged.
- Do not restate the marker semantics or the ordering rule in this reference; name the fields and
  point at the CLI. Two copies of that contract is the drift this task removes.
- Do not touch `task-pipeline.yaml`, the driver's YAML interpreter section, or any Run-setup step
  other than 4.
- Do not add the `sp:spur-cli` workflows row or the `docs/04_DESIGN.md` entry here — 0695 owns both.

**Cross-task.** This task consumes 0695 and leaves nothing for a dependent; D7 has no third task.

### Plan

1. Confirm 0695 landed as specified: run
   `spur workflow show config/workflows/task-pipeline.yaml --format todo --json` and check the
   envelope and `WorkflowStep` field names against 0695's Design. Stop and reconcile if they differ.
2. Rewrite the **Layer 1** and **Source of truth** bullets of Run setup step 4 in
   `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` to the frozen shape in Design
   (R1).
3. Verify by diff that layer 2, the refresh cadence, and Run-setup steps 1–3 and 5 are untouched
   (R2).
4. `rg` the `plugins/sp` tree for other instructions to enumerate or infer a workflow state list
   from YAML; fix each in this commit or record the exclusion reason in `### Solution` (R3).
5. Paste the step-1 command output into `### Solution` as evidence the documented command and fields
   are real.
6. `bun run test` — the root suite chains `plugins/sp` (`skill-structure`,
   `surface-drift-inventory`, `cli-surface-parity`).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/D7_workflow-todo-projection-show-format-for-deterministic-plan-rendering.md` (scenario R6).
- Dependency: task `0695` — freezes the command, the JSON envelope, and the `WorkflowStep` field names this task documents.
- Target: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:34` § Run setup step 4 (introduced by task 0596).
- Related contract: ADR-047 (inline control-inversion driver), task 0687 (inline-default selector), task 0508 (native-subagent dispatch).
- Parity gate that forced the scope split: `plugins/sp/tests/cli-surface-parity.test.ts`, helper `plugins/sp/tests/helpers/cli-surface.ts`.

### History
