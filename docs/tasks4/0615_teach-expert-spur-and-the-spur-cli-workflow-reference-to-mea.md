---
schema_version: 1
name: "Teach expert-spur and the spur-cli workflow reference to measure and fix composition defects"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.528Z
updated_at: "2026-08-20T23:18:37.732Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0614"]
---

## 0615. Teach expert-spur and the spur-cli workflow reference to measure and fix composition defects

### Background

`plugins/sp/agents/expert-spur.md` is the corpus steward that handles multi-step workflow
authoring and refactoring, and it delegates verb guidance to the `sp:spur-cli` facade — whose
`references/workflows.md` is the per-noun reference it reads before acting. Neither knows the
composition measures exist, so a steward asked to review or author a workflow has no way to apply
them.

The advisory ships as a warn-only report; without guidance, a steward reading warnings has two
plausible wrong reactions — treat them as blocking, or rewrite a running pipeline's shell in place.
Both are excluded by the recorded posture, so the guidance has to say so explicitly.

Rubric: E1 D2 L1 C2 R1 = 7 → decompose (separate surface, separate parity gate, depends on the
advisory existing).

### Requirements

- [ ] R1. Add a Composition measures section to `plugins/sp/skills/spur-cli/references/workflows.md` stating both triggers, how to run the advisory, and how to read its report.
- [ ] R2. Map each defect class to its recommended fix path in that section — shell to the five recorded owner options, `agent.run` to a centralized skill or slash command.
- [ ] R3. State in the same section that findings are advisory: they never justify blocking a run, failing a gate, or editing a pipeline that is currently executing.
- [ ] R4. Add the routing line to `plugins/sp/agents/expert-spur.md` pointing at the new section, without duplicating its content into the agent file.
- [ ] R5. Keep the plugin surface parity and command-validation gates green.

### Acceptance Criteria

```gherkin
@core
Scenario: R5 — expert-spur and its backing reference teach measuring and fixing composition defects
  Given a corpus steward asked to review or author a workflow definition
  When it consults the sp plugin's Spur-corpus guidance
  Then the guidance states both measures and how to run the advisory
  And it maps each defect class to its recommended fix path
  And it states that findings are advisory and never justify blocking or editing a running pipeline
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**The reference is the SSOT; the agent file routes to it.** `expert-spur.md` states its own core
principle — delegate to the `sp:spur-cli` facade for verb guidance, do not reimplement it. Writing
the measures into the agent file would create a second copy that drifts from the reference the agent
is told to read. The agent gets a routing line; the reference gets the content.

**`references/workflows.md` is the correct file** — it is the per-noun reference for the `workflow`
noun, already carries the author-validate-dry-run harness loop, and the advisory is a new step in
exactly that loop.

**The advisory-only rule is stated, not implied.** A warn-only report is easy to misread as a soft
gate. Saying plainly that findings never justify blocking, failing, or hot-editing a running pipeline
is what keeps the operator's "warn and suggest, do not stop current executions" constraint intact
once an autonomous steward is reading the output.

**No new skill or agent.** The capability is guidance about an existing verb; adding a surface for it
would violate the same reuse-first discipline this feature is written to enforce.

### Plan

- [ ] Read `plugins/sp/skills/spur-cli/references/workflows.md` and `plugins/sp/agents/expert-spur.md` to place the section inside the existing harness loop
- [ ] Write the Composition measures section: both triggers, how to run the advisory, how to read the report (R1)
- [ ] Add the defect-class to fix-path map, citing the five recorded owner options (R2)
- [ ] State the advisory-only rule explicitly (R3)
- [ ] Add the routing line to `expert-spur.md` with no content duplication (R4)
- [ ] Run the plugin parity and command-validation gates plus `bun run test` for `plugins/sp` (R5)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
