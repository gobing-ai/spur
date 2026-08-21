---
schema_version: 1
name: "Teach expert-spur and the spur-cli workflow reference to measure and fix composition defects"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.528Z
updated_at: "2026-08-21T18:01:09.988Z"
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

- [x] R1. Add a Composition measures section to `plugins/sp/skills/spur-cli/references/workflows.md` stating both triggers, how to run the advisory, and how to read its report.
- [x] R2. Map each defect class to its recommended fix path in that section — shell to the five recorded owner options, `agent.run` to a centralized skill or slash command.
- [x] R3. State in the same section that findings are advisory: they never justify blocking a run, failing a gate, or editing a pipeline that is currently executing.
- [x] R4. Add the routing line to `plugins/sp/agents/expert-spur.md` pointing at the new section, without duplicating its content into the agent file.
- [x] R5. Keep the plugin surface parity and command-validation gates green.

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

- [x] Read `plugins/sp/skills/spur-cli/references/workflows.md` and `plugins/sp/agents/expert-spur.md` to place the section inside the existing harness loop
- [x] Write the Composition measures section: both triggers, how to run the advisory, how to read the report (R1)
- [x] Add the defect-class to fix-path map, citing the five recorded owner options (R2)
- [x] State the advisory-only rule explicitly (R3)
- [x] Add the routing line to `expert-spur.md` with no content duplication (R4)
- [x] Run the plugin parity and command-validation gates plus `bun run test` for `plugins/sp` (R5)

### Solution
Taught the corpus steward and its per-noun reference the composition measures. The reference is the
SSOT; the agent file only routes to it (no content duplication).

- Added a `Composition measures and the advisory` section to the `workflow` noun reference: states
  both triggers (shell ≥6 non-comment units; `agent.run` non-slash `input`), how to run the advisory
  (`workflow validate --json` → `composition: {findings[], suppressed}`, human mode stderr, exit 0),
  and how to read the report including baseline `suppressed`
  (`plugins/sp/skills/spur-cli/references/workflows.md:202-235`).
- The same section maps each defect class to its fix path: shell findings to the five recorded owner
  options (public verb / application service / built-in action kind / external extension /
  deliberately-stays-shell), `agent.run` findings to a centralized skill or slash command
  (`plugins/sp/skills/spur-cli/references/workflows.md:219-227`).
- The advisory-only rule is stated explicitly — never block a run, fail a gate, or edit a pipeline
  that is currently executing (`plugins/sp/skills/spur-cli/references/workflows.md:229-234`).
- `expert-spur.md` gained a routing line under Workflow work pointing at the new section without
  duplicating its content (`plugins/sp/agents/expert-spur.md:48-51`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R5 — expert-spur and its backing reference teach measuring and fixing composition defects | MET | R1: composition-measures section states both triggers and how to run/read the advisory (`plugins/sp/skills/spur-cli/references/workflows.md:202-235`). R2: defect-class fix-path map — shell to the five recorded owner options, `agent.run` to a centralized skill or slash command (`plugins/sp/skills/spur-cli/references/workflows.md:219-227`). R3: advisory-only rule stated verbatim (`plugins/sp/skills/spur-cli/references/workflows.md:229-235`). R4: routing line in the agent file, no content duplication (`plugins/sp/agents/expert-spur.md:48-51`). R5: plugin parity + command-validation gates green via full `bun run test` (6047 pass / 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Kind | Finding | Ref |
|---|---|---|---|
| P4 | Verify | No P1–P3 findings. Content matches the frozen rules in `docs/04_DESIGN.md` §composition advisory (≥6 shell units, non-slash input, severity bands, baseline suppression) | R1/R2 MET |
| P4 | Verify | Advisory-only posture stated verbatim (never block / never fail a gate / never edit an executing pipeline), matching ADR-069 §1.3 | R3 MET |
| P4 | Verify | Agent file carries a routing line only — no duplicated measures content, preserving the reference-as-SSOT design | R4 MET |
| P4 | Verify | Plugin parity + command-validation gates green via full `bun run test` | R5 MET |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T18:01:03.451Z todo → wip (system)
- 2026-08-21T18:01:04.021Z wip → testing (system)
- 2026-08-21T18:01:09.988Z testing → done (system)
