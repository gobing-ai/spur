---
schema_version: 1
name: "Ship the warn-only workflow composition advisory on spur workflow validate"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.514Z
updated_at: "2026-08-21T16:42:33.674Z"
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

- [x] R1. Report each `shell` action whose program exceeds the recorded line-count threshold (non-blank, non-comment lines, counted after YAML scalar folding), naming the state, the stable action key, the measured value, and the recommended fix.
- [x] R2. Report each `agent.run` action whose `input` is not a pure slash invocation, with raw prompt length setting severity rather than triggering the report.
- [x] R3. Add an optional per-action `disposition` field to `config/workflow-composition-baseline.json` carrying the values already assigned in `docs/design/workflow-shell-ownership.md`, suppress any action that has one, and state in the report how many actions were suppressed.
- [x] R4. Emit findings on stderr and as a `composition[]` array under `--json` without changing the validate exit status, and exclude transition guards entirely under the recorded bulk exception.
- [x] R5. Calibrate the shell threshold by measuring the flag rate over `config/workflows/*.yaml` at several candidate thresholds with dispositions applied, and record the chosen number and its measured flag count back into the ADR-069 amendment.

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

- [x] Read `config/workflow-composition-baseline.json`, `packages/app/src/workflow/composition-baseline.ts`, and the validate command path to fix the integration point
- [x] Implement the shell line-count measure and the agent.run non-slash measure over resolved definitions (R1, R2)
- [x] Add the optional `disposition` field to the baseline, populate it from the recorded classification, and suppress dispositioned actions (R3)
- [x] Wire the report into `spur workflow validate` stderr output and the `--json` `composition[]` array, exit status untouched, guards excluded (R4)
- [x] Measure the flag rate at several candidate thresholds with dispositions applied and choose the number (R5)
- [x] Record the chosen threshold and its measured flag count into the ADR-069 amendment (R5)
- [x] Add unit tests for both measures, the disposition suppression, the guard exclusion, and the unchanged exit status
- [x] Confirm `spur-check` gained no new failing check and every shipped workflow still validates and runs

### Solution
- `packages/app/src/workflow/composition-baseline.ts:24-42` — optional advisory-only `disposition` field on workflow and action entries; never compared, so baseline reconciliation stays two-sided on facts only.
- `config/workflow-composition-baseline.json` — all 8 workflows carry the dispositions recorded in `docs/design/workflow-shell-ownership.md`; canonical rewrite.
- `packages/app/src/services/workflow-service.ts:207` — `CompositionAdvisory` result arm on the validate ok-arm, so validity is untouched.
- `packages/app/src/services/workflow-service.ts:1318` — `collectCompositionAdvisory` measures shell programs and agent.run non-slash inputs; guards excluded wholesale (R1, R2, R4, R14).
- `packages/app/src/services/workflow-service.ts:1404` — `loadCompositionBaselineFor` walks up ≤10 dirs for the baseline.
- `apps/cli/src/commands/workflow.ts:236-247` — human mode prints the advisory to stderr; `--json` flows `composition`; exit code unchanged (R4).
- `config/rules/strict/runtime-boundaries.yaml:76` — sync baseline read exempted in the existing sync-resolvers group (0614).
- `docs/00_ADR.md:870` ADR-069 amendment — threshold `>5`, steady state 0 shell findings / 25 suppressed / 8 agent.run over the 10 shipped workflows (R5).
- `docs/04_DESIGN.md:485-496` — composition advisory surface: JSON shape, frozen rules, suppression semantics (0614, T3).
- `docs/design/workflow-shell-ownership.md:177` — re-keyed doc-sync disposition row for `doc-sync:onEnter:1` (T3).
- `docs/design/harness-surface-governance.md` §4 — closed with 0614 shipped (T3).
- Tests: `packages/app/tests/workflow/composition-advisory.test.ts` (new, 7 tests) — measures, suppression, guard exclusion, exit-status invariance.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R3 — The composition advisory warns and never blocks a run | MET | `collectCompositionAdvisory` ok-arm field only (`packages/app/src/services/workflow-service.ts:1318`); stderr-only `composition advisory` print (`apps/cli/src/commands/workflow.ts:236-247`); exit-status invariance test in `composition-advisory.test.ts`; live 10-workflow run valid, exit 0 |
| R4 — Actions with a recorded owner disposition are not reported | MET | `disposition` suppression + `suppressed` count reporting (`apps/cli/src/commands/workflow.ts:236-247`); tests in `composition-advisory.test.ts`; live steady state 25 suppressed |
| R14 — Transition guards are outside the composition advisory | MET | guard variant (8 echos behind `edges[].condition`) → no finding; bulk exception cited in stderr line; test in `composition-advisory.test.ts` |
| R1 | MET | `collectCompositionAdvisory` (`packages/app/src/services/workflow-service.ts:1318`) — shell measure: ≥6 non-comment units flags, names state, action key, measured value, recommended fix |
| R2 | MET | `collectCompositionAdvisory` (`packages/app/src/services/workflow-service.ts:1318`) — agent.run non-slash input reported; severity by raw prompt length band |
| R3 | MET | optional `disposition` (`packages/app/src/workflow/composition-baseline.ts:24-42`); all 8 workflows dispositioned; suppression count reported |
| R4 | MET | stderr + `--json` `composition` + `suppressed` count (`apps/cli/src/commands/workflow.ts:236-247`); exit code unchanged; guards excluded wholesale |
| R5 | MET | ADR-069 amendment (`docs/00_ADR.md:870`): threshold `>5`, steady state 0 shell / 25 suppressed / 8 agent.run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA), session inline-20260821-083900-0614.

| Priority | Area | Finding | Evidence |
|---|---|---|---|
| P4 | Verify | No P1–P3 findings; gate run 2 (`spur-check-new`) green except corpus sweep, reconciled in `config/corpus-baseline.json` this commit | `.spur/run/0614-verdict.json` PASS, 8 rows |
| P4 | Risk | Baseline walk-up (≤10 dirs) cannot find a baseline above repo root — shipped workflows sit well within depth; marked in code | `loadCompositionBaselineFor` `packages/app/src/services/workflow-service.ts:1404` |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T15:56:53.262Z todo → wip (system)
- 2026-08-21T16:40:51.694Z wip → testing (system)
- 2026-08-21T16:42:33.674Z testing → done (system)
