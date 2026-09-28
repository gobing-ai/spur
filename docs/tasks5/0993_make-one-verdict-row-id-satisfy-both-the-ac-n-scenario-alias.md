---
schema_version: 1
name: Make one verdict row id satisfy both the AC-N scenario alias and the AC checkbox flip
status: todo
template: feature-impl
created_at: 2026-09-28T08:31:24.792Z
updated_at: "2026-09-28T08:32:21.664Z"
feature_id: F91

ac_altitude: task-local
---

## 0993. Make one verdict row id satisfy both the AC-N scenario alias and the AC checkbox flip

### Background

Found during the 2026-09-28 `sp:dev-review-session --triage` of the 0981 → 0974 → 0970 → 0973 run, while recording 0970 (feature A32, graduating).

0958 (done) closed verdict-row scenario crediting and `prefixId`-based checkbox flipping; 0985 was cancelled as superseded. The two id spaces still do not intersect:

- `indexScenarioAliases` (`packages/app/src/services/feature-check.ts:1208-1215`) aliases scenario *i* to `AC-<i>` (hyphen).
- `parseChecklist` (`packages/domain/src/bdd/checklist.ts:57-62`) recognizes only `(?:AC|R)\d+` — no hyphen.
- `prefixId` (`packages/app/src/services/task-record.ts:191-194`) strips context only after `^R\d+`, so `prefixId('AC-1') === 'AC-1'` and never matches the `AC1` checkbox id.

Consequence for a graduating task whose AC bullets are `AC1…ACn`: a verdict AC row keyed `AC1` flips the box but keys to no feature scenario (`spur task verdict` refuses with "Verdict rows key to no scenario of linked feature …"); keyed `AC-1` it credits the scenario but flips no box, and `record` then emits a `scenarioWarnings` regression.

Observed twice in this session: the first `task verdict 0970` invocation was refused, and the re-keyed attempt emitted `Task 0970 record drops scenario key "R2 — Fresh twin with an older mtime passes"`. The only working form found was an embedded reference on a *requirement* row — `| R1 (covers: R1) [R2] | MET | … |` — which is undocumented.

AC altitude: task-local. These are regression checks on the verdict-row/checkbox-flip surface, not new feature ship criteria.

### Requirements

- [ ] R1. Make the AC-id spaces intersect so ONE verdict row id both credits the scenario alias `AC-<i>` and flips the `AC<i>` checkbox — by normalizing in `prefixId`/`flipVerifiedCheckboxes`, or by widening the alias/checklist form. Pick one; do not add a second alias.
- [ ] R2. A graduating task whose AC bullets are `AC1…ACn` passes `spur task verdict --from-answer` with AC rows keyed `AC1…ACn`, flips every AC box, and emits no `scenarioWarnings`, with no embedded `(covers:)`/`[R2]` workaround.
- [ ] R3. Document the supported authoring form in the `sp-spur-cli` verdict/answer-file reference, stating which id satisfies which check.
- [ ] R4. Non-graduating (`ac_altitude: task-local`) tasks and `R\d+` rows keep their current behavior; existing checkbox-flip and scenario-crediting tests stay green.

### Acceptance Criteria

- [ ] AC1 — One id satisfies both checks (req: R1)
  - Verify: a unit test under `packages/app/tests/` where a graduating fixture's AC bullets are `AC1`/`AC2` and the verdict rows are also `AC1`/`AC2`; assert both boxes flip AND `verdictRowsMatchScenarios` is true.
- [ ] AC2 — End-to-end record on a graduating task (req: R2)
  - Verify: `spur task verdict <wbs> --from-answer` exits 0 and `spur task record <wbs> --verdict-file …` emits no `scenarioWarnings`.
- [ ] AC3 — The authoring rule is documented (req: R3)
  - Verify: the reference names the id form and which check it satisfies.
- [ ] AC4 — No regression (req: R4)
  - Verify: `bun run spur-check` green; existing flip/crediting tests unchanged.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Fix direction (not prescriptive): the smallest surface is `prefixId` — normalize a leading `AC-(\d+)` to `AC$1` beside the existing `^R\d+` strip, so `prefixId('AC-1') === 'AC1'`. `flipVerifiedCheckboxes` then flips an `AC1` box from an `AC-1`-keyed row, and `rowMatchesScenario` still sees the alias.

Rejected alternatives:

- Widen `parseChecklist` to accept `AC-1`: the template and every existing corpus task author bullets as `AC1`; changing the parser moves the problem into the corpus.
- Add a second alias (`AC1`) beside `AC-1`: two aliases per scenario make crediting ambiguous and need a tie-break rule.

Keep the change behavior-preserving for `R\d+` rows and for `ac_altitude: task-local` tasks.

### Plan

- [ ] Add the failing fixture test first (graduating task, AC bullets `AC1`, verdict rows `AC1`).
- [ ] Normalize the AC id in `prefixId` (one regex); re-run the fixture plus the existing flip/crediting tests.
- [ ] Update the `sp-spur-cli` reference with the supported form.
- [ ] Run `bun run spur-check`; commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.277Z backlog → todo (system)

