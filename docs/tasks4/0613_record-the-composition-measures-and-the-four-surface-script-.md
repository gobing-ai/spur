---
schema_version: 1
name: "Record the composition measures and the four-surface script placement rule as authority"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.495Z
updated_at: "2026-08-20T23:18:21.497Z"
feature_id: A3
priority: P1
---

## 0613. Record the composition measures and the four-surface script placement rule as authority

### Background

ADR-069 ("Workflow YAML Orchestrates Owned Capabilities") is still **Proposed** and states the
ownership principle without any detectable measure, so nothing can act on it. ADR-043 already prefers
pure slash commands in `agent.run` inputs but attaches no measure either.
`docs/design/workflow-shell-ownership.md` (accepted, task 0608) classifies all 58 `onEnter`/`onExit`
shell programs into five owner options (a–e) and grants a bulk exception for the 92 transition
guards — the fix vocabulary exists; the trigger does not.

On the script side, ADR-051 owns the public-CLI-vs-internal-spur-dev boundary and ADR-065 owns the
`plugins/sp/scripts` entrypoint contract, but neither mentions `package.json` script entries, and no
single record answers "which of the four surfaces does this new script belong on?". The gap is why
misplacement keeps accruing.

This task writes authority first: the measures, the placement table, and the operator consent record
that unblocks every sibling task under ADR-051's consent gate. No code and no advisory ships here.

Rubric: E2 D0 L1 C2 R2 = 7 → decompose (authority must land before the tooling that cites it).

### Requirements

- [ ] R1. Amend ADR-069 with the `shell` composition measure — a line-count threshold above which an action is reported as to-be-enhanced — and name the recommended fixes as the five owner options already recorded in `docs/design/workflow-shell-ownership.md`, justified against the classified programs on this tree rather than asserted.
- [ ] R2. Amend ADR-069 with the `agent.run` composition measure: a non-slash `input` is the reporting trigger (per ADR-043), raw prompt length sets severity only, and the recommended fix is to move the operation behind a centralized agent skill or slash command.
- [ ] R3. State in the ADR-069 amendment that composition findings are advisory: they never change a validate exit status, never block a run, and are not added to `spur-check` / `spur-check-new`.
- [ ] R4. Amend ADR-051 with one placement table covering all four script surfaces (`apps/cli/src/commands`, `scripts/commands`, `package.json`, `plugins/sp/scripts`), cross-referencing ADR-065 for the plugin-script entrypoint contract instead of restating it.
- [ ] R5. Record in the ADR-051 amendment the operator consent granted for this feature's public-surface changes (`spur self`, `spur builder`, `--fix` on the two check verbs, `spur workflow show`, the doctor AUTH column removal, and the `workflow validate` composition output), and author `docs/design/harness-surface-governance.md` plus its `docs/04_DESIGN.md` §0 index row in the same commit.

### Acceptance Criteria

```gherkin
@core
Scenario: R1 — ADR-069 carries a mechanical shell composition measure with its fix options
  Given ADR-069 states that reusable deterministic behavior belongs to an owning module but names no detectable threshold
  When the decision record is amended
  Then it states a line-count threshold above which a shell action is reported as to-be-enhanced
  And it names the recommended fixes as the owner options already recorded for shell programs
  And the threshold is justified against the classified programs on this tree, not asserted

@core
Scenario: R2 — ADR-069 carries an agent.run composition measure keyed on non-slash invocation
  Given ADR-043 already prefers pure slash commands in agent.run inputs but attaches no measure
  When the decision record is amended
  Then a non-slash agent.run input is the condition that reports the action as to-be-enhanced
  And raw prompt length sets the reported severity rather than triggering the report
  And the recommended fix is to move the operation behind a centralized agent skill or slash command

@core
Scenario: R6 — ADR-051 records the four-surface placement table and this feature's consent
  Given script placement is governed by two partial records that omit package.json entries entirely
  When ADR-051 is amended
  Then one table names all four script surfaces with the condition that selects each
  And the amendment records the operator consent granted for this feature's public surface changes
  And the plugin-script contract remains owned by its existing record rather than being restated
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Amend, do not invent.** ADR-069 already carries the decision; ADR-051 already owns the
CLI boundary. Adding a third record for either concern would create a competing authority, and the
constitution's conflict rule (lower number wins on content) would make the new record lose
immediately. Both changes are amendments in place.

**ADR-065 is cross-referenced, not absorbed.** The plugin-script entrypoint contract has its own
accepted record with a live two-sided gate (`script-contract-check`). The ADR-051 table names
`plugins/sp/scripts` as a surface and points at ADR-065 for what landing there requires.

**The threshold number is deliberately not frozen here.** The operator proposed 5 lines and marked it
TBD. This task states the measure and its shape; the calibration — flag rate measured at several
thresholds with dispositions applied — is the sibling advisory task's deliverable, and the ADR
records the chosen number once it survives contact. Writing a number here that the measurement later
contradicts is the failure mode to avoid.

**Consent is recorded once, centrally.** ADR-051's gate requires explicit operator consent with
design context for every noun/verb/flag/observable-output change. Six sibling tasks each carry one.
Recording all of them in one amendment means no sibling re-litigates the gate mid-implementation.

**The satellite lands with the ADRs.** `docs/design/harness-surface-governance.md` is derived from
these decisions; authoring it in the same commit satisfies the constitution's detail-first-then-index
order (§4.5 rule 5, sync trigger T9) and keeps the `04` index invariant of exactly one row per
satellite.

### Plan

- [ ] Read ADR-069, ADR-043, ADR-051, ADR-065 and `docs/design/workflow-shell-ownership.md` to fix the exact amendment sites and the existing owner-option vocabulary
- [ ] Amend ADR-069 with the shell measure, the agent.run measure, and the advisory-only posture (R1, R2, R3)
- [ ] Promote ADR-069 from Proposed to Accepted, or record why it stays Proposed
- [ ] Amend ADR-051 with the four-surface placement table, cross-referencing ADR-065 (R4)
- [ ] Append the consent record for the six public-surface changes to the ADR-051 amendment (R5)
- [ ] Author `docs/design/harness-surface-governance.md` and add its single `docs/04_DESIGN.md` §0 index row (R5)
- [ ] Reconcile `AGENTS.md` § Spur CLI surface with the new placement table
- [ ] Run `bun run lint` and the link check; confirm no gate was added by this task

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
