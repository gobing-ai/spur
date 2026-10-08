---
schema_version: 1
name: Make one verdict row id satisfy both the AC-N scenario alias and the AC checkbox flip
status: done
template: feature-impl
created_at: 2026-09-28T08:31:24.792Z
updated_at: "2026-10-08T15:49:05.995Z"
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

- [x] R1. Make the AC-id spaces intersect so ONE verdict row id both credits the scenario alias `AC-<i>` and flips the `AC<i>` checkbox — by normalizing in `prefixId`/`flipVerifiedCheckboxes`, or by widening the alias/checklist form. Pick one; do not add a second alias.
- [x] R2. A graduating task whose AC bullets are `AC1…ACn` passes `spur task verdict --from-answer` with AC rows keyed `AC1…ACn`, flips every AC box, and emits no `scenarioWarnings`, with no embedded `(covers:)`/`[R2]` workaround.
- [x] R3. Document the supported authoring form in the `sp-spur-cli` verdict/answer-file reference, stating which id satisfies which check.
- [x] R4. Non-graduating (`ac_altitude: task-local`) tasks and `R\d+` rows keep their current behavior; existing checkbox-flip and scenario-crediting tests stay green.

### Acceptance Criteria

- [x] AC1 — One id satisfies both checks (req: R1)
  - Verify: `packages/app/tests/services/task-record.test.ts` — a verdict AC row keyed `AC1 — <title>` flips the task's `AC1` box; and a direct probe over feature A32's real AC shows the same row form credits all three scenarios via `verdictRowsMatchScenarios`.
- [x] AC2 — Both halves verified directly (req: R2)
  - Verify: box flip by the unit test above; scenario crediting by `verdictRowsMatchScenarios` / `matchedScenarioKeys` (the functions the done gate uses) over `docs/features/A32_*.md` → 3 of 3 scenarios matched.
- [x] AC3 — The authoring rule is documented (req: R3)
  - Verify: `plugins/sp/skills/spur-cli/references/tasks/verbs.md` states the `AC<n> — <scenario title>` form and which check each variant satisfies.
- [x] AC4 — No regression (req: R4)
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

- [x] Add the fixture test first (AC row keyed `AC1 — <title>` must flip the `AC1` box).
- [x] Normalize the AC id in `prefixId` (one regex); re-run the fixture plus the existing flip/crediting tests.
- [x] Update the `sp-spur-cli` reference with the supported form.
- [x] Verify both halves and run `bun run spur-check`.

### Solution

One-line normalization, plus the reference note.

- `packages/app/src/services/task-record.ts:191-194` — `prefixId` now matches `^(?:AC|R)\\d+` instead of `^R\\d+`, so a verdict row keyed `AC1 — <scenario title>` normalizes to `AC1` and matches the checkbox id `parseChecklist` extracts from `- [ ] AC1 — …`. Previously only `R`-keyed rows could flip a box, so an AC row written in the form that credits a feature scenario could never tick its own task box.
- `packages/app/tests/services/task-record.test.ts` — pins that an AC row keyed `AC1 — R4 — one table` flips `AC1`, and that `AC-2` is left alone.

**The working form (verified, now documented at `plugins/sp/skills/spur-cli/references/tasks/verbs.md:337`).** Key the row `AC<n> — <scenario title>`, omitting the scenario's own `R<n>` label. `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:61-69`) strips the leading `AC<n>` so the row still matches the scenario title; `prefixId` strips it for the box flip. Direct probe over feature A32's real AC: the three `AC<n> — <title>` rows matched **3 of 3** scenarios (`verdictRowsMatchScenarios` → true), while bare `AC1..AC3` credited none and `AC-1` credited but would not flip a box.

This removes the need for the `R1 (covers: R1) [R2]` workaround used when 0970 was recorded. The verdict → record CLI plumbing is unchanged and was exercised on 0981, 0974, 0970 and 0973.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:331-334` prefixId normalizes `AC<n> — <title>` to the `AC<n>` box id; `packages/app/src/services/task-record.ts:355-369` acRowProves resolves `AC-<n>` through the feature scenario order to the aliasing AC box (no numeric guess); wired with feature titles at `packages/app/src/services/task-service.ts:1558-1563` — one alias path, no second alias |
| R2 | MET | `packages/app/tests/services/task-record.test.ts:1560-1576` graduating record: `AC-<n>` rows tick both aliasing boxes and two records emit no scenarioWarnings; fresh A32 probe over `docs/features/A32_content-verified-standard-script-twins.md` (verdictRowsMatchScenarios `packages/app/src/services/feature-check.ts:1314`, matchedScenarioKeys `packages/app/src/services/feature-check.ts:1331`): 3 scenarios, `AC<n> — <title>` rows match 3/3 and `AC-<n>` rows match 3/3 |
| R3 | MET | `plugins/sp/skills/spur-cli/references/tasks/verbs.md:359-367` documents `AC<n> — <scenario title>` and bare `AC-<i>`, and which check each satisfies |
| R4 | MET | fresh 2026-10-08: `packages/app/tests/services/task-record.test.ts` 142 pass / 0 fail; packages/app suite 4189 pass / 3 fail (all 3 in DecisionService `packages/app/tests/decision/decision-events.test.ts:283`, reproduced at clean HEAD, outside F91); lint + typecheck exit 0; 50 pre-check rules pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:1996-2008` AC-<n> resolves through scenario order to the aliasing box; `packages/app/tests/services/task-record.test.ts:1973-1982` an `AC1 — <title>` row flips AC1; fresh A32 probe credits 3/3 scenarios for both row forms |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts:1560-1576` drives TaskService.record end to end: boxes flip, scenarioWarnings undefined on both records; fresh A32 probe matchedScenarioKeys 3 of 3 (`packages/app/src/services/feature-check.ts:1331`) |
| AC3 | MET | command | `rg -c "Graduating tasks — one row keyed to both checks" plugins/sp/skills/spur-cli/references/tasks/verbs.md` → 1 (`plugins/sp/skills/spur-cli/references/tasks/verbs.md:359`) |
| AC4 | MET | command | fresh 2026-10-08: lint + typecheck exit 0, 50 pre-check rules pass, packages/app 4189 pass with the only 3 failures in out-of-scope DecisionService (`packages/app/tests/decision/decision-events.test.ts:283`, reproduced at HEAD); post-check fails only on TSDoc in `packages/app/src/decision/confidence-level.ts:13` (commit b3b6c304d, outside F91) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (self-review)

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|---------|-------------|
| P4 | Correctness | `packages/app/src/services/task-record.ts:192` | `prefixId`'s AC/R-number pattern does not match the hyphenated alias `AC-1`, so that spelling still flips no box. Accepted: `AC-1` is the *crediting* alias and the title-suffixed form is the documented one-id answer. | Resolved — `AC-<n>` resolves through the linked feature's scenario order to the aliasing AC box (`packages/app/src/services/task-record.ts:217-233`, titles from `packages/app/src/services/feature-check.ts:1324`, wired at `packages/app/src/services/task-service.ts:1471`); never the same-numbered box (unit `packages/app/tests/services/task-record.test.ts:1474`); authoring note `plugins/sp/skills/spur-cli/references/tasks/verbs.md:342` |
| P4 | Scope | `packages/app/tests/services/task-record.test.ts` | The end-to-end graduating `record` path was not re-run; both halves are verified against the production functions the gate uses, and the CLI plumbing is covered by the four pipeline tasks. | Resolved — end-to-end graduating `record` test: feature-linked task, `AC-<n>` rows tick the aliasing boxes and two records emit no `scenarioWarnings` (`packages/app/tests/services/task-record.test.ts:1371`) |

No P1–P3 findings. Behavior for `R\\d+` rows and `ac_altitude: task-local` tasks is unchanged.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.277Z backlog → todo (system)
- 2026-09-28T17:27:35.336Z todo → wip (system)
- 2026-09-28T17:27:36.440Z wip → testing (system)
- 2026-09-28T17:27:36.850Z testing → done (system)

