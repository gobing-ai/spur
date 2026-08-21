---
schema_version: 1
name: "Ship the warn-only workflow composition advisory on spur workflow validate"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.514Z
updated_at: "2026-08-20T23:18:37.515Z"
feature_id: A3
priority: P1
dependencies: ["0613"]
---

## 0614. Ship the warn-only workflow composition advisory on spur workflow validate

### Background

The composition measures recorded by the authority task need a surface that reports them. The
existing `spur workflow validate` verb is the right host: every workflow author already runs it, it
needs no new noun under ADR-051's first-layer noun discipline, and it is not part of `spur-check`,
so a warn-only tier there cannot become a blocking gate by accident.

`config/workflow-composition-baseline.json` already records per-action facts keyed by the stable
`<state>:<onEnter|onExit>:<ordinal>` identity and is already two-sided. Reusing it for the exception
list avoids a second manifest that would drift against the first.

The suppression list matters more than the detector. `docs/design/workflow-shell-ownership.md`
records a deliberate disposition for all 58 classified programs plus a bulk exception for the 92
transition guards; an advisory that ignores those dispositions emits roughly fifty warnings on its
first run and gets tuned out within a week.

Rubric: E3 D1 L2 C2 R2 = 10 → decompose.

### Requirements

- [ ] R1. Report each `shell` action whose program exceeds the recorded line-count threshold (non-blank, non-comment lines, counted after YAML scalar folding), naming the state, the stable action key, the measured value, and the recommended fix.
- [ ] R2. Report each `agent.run` action whose `input` is not a pure slash invocation, with raw prompt length setting severity rather than triggering the report.
- [ ] R3. Add an optional per-action `disposition` field to `config/workflow-composition-baseline.json` carrying the values already assigned in `docs/design/workflow-shell-ownership.md`, suppress any action that has one, and state in the report how many actions were suppressed.
- [ ] R4. Emit findings on stderr and as a `composition[]` array under `--json` without changing the validate exit status, and exclude transition guards entirely under the recorded bulk exception.
- [ ] R5. Calibrate the shell threshold by measuring the flag rate over `config/workflows/*.yaml` at several candidate thresholds with dispositions applied, and record the chosen number and its measured flag count back into the ADR-069 amendment.

### Acceptance Criteria

```gherkin
@core
Scenario: R3 — The composition advisory warns and never blocks a run
  Given a workflow definition containing actions that exceed the recorded measures
  When the workflow is validated and when it is run
  Then each exceeding action is reported with its state, action key, measure, and recommended fix
  And the validation exit status is unchanged by composition findings alone
  And the run executes every action it would have executed without the advisory

@core
Scenario: R4 — Actions with a recorded owner disposition are not reported
  Given programs already classified with a deliberate disposition in the composition records
  When the advisory runs over the shipped workflow definitions
  Then a classified program is not reported merely for exceeding the threshold
  And an action with no recorded disposition that exceeds a measure is reported
  And the report names how many actions were suppressed by a recorded disposition

@edge
Scenario: R14 — Transition guards are outside the composition advisory
  Given transition guards that are single boolean predicates covered by a recorded bulk exception
  When the advisory runs
  Then no guard is reported regardless of its length
  And the recorded bulk exception is cited as the reason
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Host the advisory on `spur workflow validate`, not on a new verb.** ADR-051's first-layer noun
discipline says a new noun is justified only when no existing one can host the action; `workflow`
hosts it, and `validate` is already the "tell me what is wrong with this definition" surface. The
change is observable output on an existing verb, which the consent record covers.

**Reuse `config/workflow-composition-baseline.json` for the exception list.** It already keys
per-action facts by the stable action identity and is already reconciled two-sided. A new
suppression file would need its own reconciliation and would drift against the baseline the moment
an action moves ordinal.

**Suppression is by recorded disposition, never by threshold tuning.** The number stays honest
because the exceptions are explicit and counted; a report that says how many it suppressed keeps the
exception list visible rather than letting it become a silent allowlist — the same two-sided
discipline as `transition-shim-check` and `script-contract-check`.

**Guards are excluded wholesale, not measured.** The 92 transition guards are single boolean
predicates with a recorded bulk exception. Measuring them would produce findings whose only correct
resolution is "this is fine", which is noise by construction.

**Warn-only is a structural property, not a promise.** The advisory reports through a path that
cannot influence the exit status, and it is not registered in `spur-check` / `spur-check-new`, so
"never blocks" is enforced by where the code sits rather than by remembering not to escalate it.

### Plan

- [ ] Read `config/workflow-composition-baseline.json`, `packages/app/src/workflow/composition-baseline.ts`, and the validate command path to fix the integration point
- [ ] Implement the shell line-count measure and the agent.run non-slash measure over resolved definitions (R1, R2)
- [ ] Add the optional `disposition` field to the baseline, populate it from the recorded classification, and suppress dispositioned actions (R3)
- [ ] Wire the report into `spur workflow validate` stderr output and the `--json` `composition[]` array, exit status untouched, guards excluded (R4)
- [ ] Measure the flag rate at several candidate thresholds with dispositions applied and choose the number (R5)
- [ ] Record the chosen threshold and its measured flag count into the ADR-069 amendment (R5)
- [ ] Add unit tests for both measures, the disposition suppression, the guard exclusion, and the unchanged exit status
- [ ] Confirm `spur-check` gained no new failing check and every shipped workflow still validates and runs

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
