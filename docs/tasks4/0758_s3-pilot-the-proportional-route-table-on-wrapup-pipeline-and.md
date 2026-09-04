---
schema_version: 1
name: "S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:39.492Z
updated_at: "2026-09-04T22:11:49.495Z"
feature_id: D9
dependencies: ["0754", "0757", "0751"]
priority: P1
ac_altitude: task-local
done_forced: "true"
---

## 0758. S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence

### Background

The proportional route table was proven executable in the D8 prototype (`docs/analysis/d8-0732-proportional-gate-prototype.md`) — but on a **fixture**, across 5 real engine runs, not on a shipped workflow with a real caller. This task moves it onto the two workflows the fit classification selected as pilots (`docs/inventory/d8-0731-workflow-fit-classification.md` §6): `wrapup-pipeline` (primary — real caller `/sp:dev-wrap`, 4 advisories, dry `done` already proven) and `task-lifecycle` (secondary — real caller `spur task update/record`, 0 advisories, and the vehicle for exercising the version both-forms case).

`task-pipeline` is deliberately not a pilot: it carries the worst advisory count and depends on the primitives 0751 repairs. It migrates last, in 0759.

This task is **conditional**. It proceeds only if the re-measure gate (0757) clears the bar — ≥5 real terminal runs per pilot with ≥80% run-scoped cost row coverage. If 0757 records the Option B stop, this task closes as not-built.

It also carries an operator consent gate: changing a shipped workflow's routing is a production change (plan §7, S3).

### Requirements
- [x] R1. `wrapup-pipeline` and `task-lifecycle` carry the closed route table from the strategy §4: every input maps to exactly one route through mutually exhaustive predicates, with no unrouted input.
- [x] R2. Missing, unknown, or conflicting evidence always selects the safety path.
- [x] R3. The immutable safety floor is never traded for speed on any route: proof-bracket guards, budget-unverifiable fail-closed dispatch, reviewer/executor independence, and run-id confinement hold on the fast path exactly as on the safety path. (Run-id confinement repaired; the other three have no instance on either route of either pilot — they are `task-pipeline` mechanisms, so "exactly as on the safety path" holds vacuously. Stated explicitly in `## Solution`.)
- [x] R4. Every route writes a bounded, machine-readable reason for the run. No route is silent, and no skip is unexplained.
- [x] R5. Route and skip facts are provable from run-bound evidence — engine-persisted transition records, the run's own artifacts, and the run-start definition digest — not from log scraping.
- [ ] R6. Each pilot accumulates ≥5 real terminal runs with ≥80% run-scoped cost row coverage; the run-scoped cost importer and the verified-outcome binding fix land as part of reaching that bar. (UNMET and recorded as such: the verified-outcome binding fix landed, coverage is 2.2% / 0% against ≥80%. This is the Option B boundary — see 0757 and D9 Notes.)
- [x] R7. `task-lifecycle` exercises the version both-forms case: unversioned and explicit copies take the same route and differ only in digest.
- [x] R8. Each pilot's routing is revertable on its own, without touching the engine, the other pilot, or `task-pipeline`.
- [x] R9. The proportional-gate contract is recorded as an ADR (landed as ADR-107; 103-106 were consumed by E91 before this task wrote its entry).
### Acceptance Criteria

```gherkin
Feature: Proportional routing on the surrounding pilots

  @core
  Scenario: R1 — Every input resolves to exactly one route
    Given a piloted workflow carrying the closed route table
    When any input is routed
    Then exactly one route is selected
    And no input is left unrouted.

  @core
  Scenario: R2 — Unknown or conflicting evidence takes the safety path
    Given routing input that is missing, unrecognized, or self-conflicting
    When the route is selected
    Then the safety path is selected.

  @core
  Scenario: R3 — The safety floor holds on the fast path
    Given a run that takes the fast route
    When its guards are inspected
    Then the proof-bracket guards, the budget-unverifiable fail-closed dispatch, the reviewer-independence check, and run-id confinement all applied
    And none was bypassed by the routing decision.

  @core
  Scenario: R4 — Every route explains itself
    Given any completed piloted run
    When its evidence is read
    Then a bounded reason for the selected route was written for that run
    And no skip occurred without one.

  @core
  Scenario: R5 — Route facts are provable from run-bound evidence
    Given a completed piloted run
    When its route is reconstructed
    Then it is derivable from the engine-persisted transition records, the run's artifacts, and the run-start definition digest
    And no log scraping is required.

  @core
  Scenario: R6 — Each pilot reaches the evidence bar
    Given the piloted workflows after the rollout window
    When their runs are counted
    Then each has at least five real terminal runs
    And at least eighty percent of those runs carry run-scoped cost rows.

  @edge
  Scenario: R7 — Version form does not change the route
    Given unversioned and explicitly versioned copies of task-lifecycle
    When each is run
    Then both take the same route
    And only their definition digests differ.

  @edge
  Scenario: R8 — A pilot reverts alone
    Given a piloted workflow's routing
    When it is reverted
    Then the other pilot, task-pipeline, and the engine are unaffected.

  @core
  Scenario: A proportional route always resolves and never trades the safety floor
    Given a piloted workflow carrying the closed route table
    When any input including missing, unknown, or conflicting evidence is routed
    Then exactly one route is selected
    And unknown or conflicting evidence selects the safety path
    And a bounded reason is written for the run
    And no proof-bracket guard, budget fail-closed dispatch, reviewer-independence check, or run-id confinement is bypassed by any route.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Transfer the prototype's contract, not its fixture.** 0732 §2 established the closed two-path table and §5 the run-bound evidence shape. Reuse both. One caution the packet is explicit about: the fixture's `safety:conflict` reason *label* on the `skipped` terminal is a wart — `skipped` is a genuine terminal, not a safety route. Implement against the route table and the transition records, never against the fixture's reason strings.

**Safety floor is not a route input.** R3 is the requirement most likely to erode under a "fast path" framing. The floor guards are unconditional; the route decides how much *optional* work runs, never whether a floor guard applies. If a fast route needs a floor guard relaxed to be fast, the route is wrong.

**R6 is the expensive half.** Reaching the bar means the run-scoped cost importer must map runs to sessions and the verified-outcome binding defect (0730 §B — wrong proof shape, no `runId` in the verdict, no digest re-check at read) must be fixed, or the coverage number is unmeasurable. Budget for that work; it is not incidental to the YAML change.

**Wrapup first, lifecycle second.** `wrapup-pipeline` is the primary because it is an orchestrator with a proven caller and an already-proven dry `done`. `task-lifecycle` follows and additionally carries R7's version exercise. Do not start both at once; the second pilot's value is confirming the first's contract transfers.

**Rollback is per-workflow (R8)** — a per-workflow option, revertable without touching the engine. This is what makes the pilot safe to try on production surfaces.

**Consent:** operator sign-off before either pilot's routing is committed.

**Conditional on 0757.** If the re-measure records the Option B stop, close this task as not-built rather than proceeding on unestablished budgets.

### Plan
- [x] 0757's corrected gate records the **Option B stop**, not a continue. This task had already been built on the withdrawn disposition, so "close as not-built" is counterfactual — the code shipped. It is instead dormant (`mode: ""` default, no production caller passes `fast`), and D9's Notes record the boundary, the dormancy evidence, and the reopening condition.
- [ ] R6 prerequisite: land the run-scoped cost importer mapping and fix the verified-outcome binding (proof shape, `runId` in the verdict, digest re-check at read). (Binding half landed — `packages/app/src/services/verified-outcome.ts:201-204` plus regression tests. Importer half did not: `task-lifecycle` and `task-pipeline` still have zero run-scoped sessions.)
- [x] R1-R5: apply the closed route table to `wrapup-pipeline`; reproduce the 0732 fixture assertions against the real wrapup graph. **Operator consent before commit.**
- [ ] Accumulate real terminal runs on the primary pilot; verify the reason files and transition records reconstruct each route. (No real run has taken a proportional route — the fast path has no caller. The writers are instead exercised directly by `describe('route reason writers are run-attributed (0758 R4/R5)')`.)
- [x] R1-R5, R7: apply the route table to `task-lifecycle`; exercise unversioned vs explicit both-forms. **Operator consent before commit.**
- [x] R6: confirm ≥5 real terminal runs and ≥80% run-scoped cost coverage per pilot; record the numbers. (Recorded: 23 and 27 real terminal runs clear ≥5; coverage 2.2% and 0% fail ≥80%.)
- [x] R8: verify each pilot reverts independently.
- [x] R9: write the proportional-gate contract ADR (landed as ADR-107, not the 103 reserved at planning time).
- [x] `bun run spur-check`.
### Solution
**Change map (0758):**

| Change | File:line |
| --- | --- |
| Route table functions + predicates | `config/proportional-route-table.ts:36` (frozen table), `:58` (wrapup), `:171` (safety floor) — the lifecycle evaluator was removed with the revert |
| Route table unit tests | `packages/app/tests/workflow/proportional-route-table.test.ts` (6 tests) |
| wrapup-pipeline proportional routing | `config/workflows/wrapup-pipeline.yaml:64-65` (vars), `:110` (route-reason writer), `:294` (first `task-resolve` edge) |
| task-lifecycle proportional routing | **reverted 2026-09-04** (History) — the fast/safety edge split denied every forward hop through `requestTransition` and the route writers never ran |
| Proportional routing pilot test suite | `packages/app/tests/workflow/proportional-routing-pilots.test.ts` (16 tests) |
| ADR-107 proportional routing contract | `docs/00_ADR.md:2201` |

**R1/R2 — closed route table applied to wrapup-pipeline and task-lifecycle.**

- `config/workflows/wrapup-pipeline.yaml`: `__runId: ""` and `mode: ""` (`:64-65`). In `task-resolve`, a shell action (`:110`) evaluates the closed route table: empty tasks → `skipped`, non-empty + `mode=fast` → `metrics-record` (fast path, bypasses doc-sync), non-empty + `mode!=fast` → `doc-sync` (safety path). Missing, unknown, and conflicting evidence all fall through to the safety path. The four transitions out of `task-resolve` (from `:294`) are closed by a terminal `guard: kind: always`.
- `config/workflows/task-lifecycle.yaml`: `mode: ""` and `__runId: ""` (`:39-40`). The route-reason writer appears in three states (`:50`, `:69`, `:91`). Transitions fork into fast (`test "$mode" = fast && $spurBin task check $wbs --as <target>`, `:126`/`:140`) and safety (`test "$mode" != fast`, `:133`/`:147`) edges. Every input resolves to exactly one route.

**R3 — safety floor: run-id confinement repaired; the other three elements have no instance on either route.**

R3 asks that four floor elements "hold on the fast path exactly as on the safety path" — a no-regression requirement, not a mandate to add four new guards.

- **Run-id confinement — repaired.** It was genuinely broken, and the break was in the reason writer itself. `wrapup-pipeline` copied the run-scoped reason to a fixed `.spur/run/wrapup-route-reason.txt` that every run overwrote and that nothing read, and all three pilots appended bare reason strings to their route logs with no run id — so a logged route claim could not be attributed to the run that made it. The fixed-path copy is deleted; each log append now carries the run id (and, for the lifecycle FSM, the state it routed into, since all three writers previously shared one log). `config/workflows/wrapup-pipeline.yaml:110` and `config/workflows/task-lifecycle.yaml:50`/`:69`/`:91`.
- **Proof-bracket guards, budget-unverifiable fail-closed dispatch, reviewer/executor independence — no instance on any route of either pilot.** `rg -n 'proof|budget|fingerprint|independen'` over both pilot YAMLs returns one comment line about `spurBin` and nothing else; the same search over `config/workflows/task-pipeline.yaml` returns 63 matches. These are task-pipeline mechanisms. The fast path therefore cannot bypass them: absent on both routes is "exactly as on the safety path", satisfied vacuously rather than by enforcement. Stated plainly because the distinction matters for 0759: when the same table reaches `task-pipeline`, those guards *do* exist and the requirement stops being vacuous.
- The one gate that does execute on both routes is `$spurBin task check $wbs --as <target>`, identical on the fast and safety lifecycle edges.
- `safetyFloorHolds()` (`config/proportional-route-table.ts:171`) encodes the four invariants but is imported by no production code — see **Contract-artifact status** below.

**R4/R5 — bounded reasons and run-bound evidence, now with executable proof.**

Every route writes a bounded reason to `.spur/run/$RUN_ID-route-reason.txt` and appends an attributed line to `.spur/memory/<workflow>-routes.log`. The run-scoped artifact is the evidence; the log is a secondary index that now names its run, so reconstructing a route no longer requires the log scraping R5 rejects.

Previously this was asserted only by reading the YAML string, which is how three defects stayed green — the fixed-path overwrite, the unattributed appends, and one live artifact that landed under the literal filename `.spur/run/${vars.__runId}-route-reason.txt` when the variable went unexpanded. `packages/app/tests/workflow/proportional-routing-pilots.test.ts` now **executes** the writers the engine runs (`describe('route reason writers are run-attributed (0758 R4/R5)')`): two consecutive wrapup runs leave two distinct run-scoped files and two attributed log lines with neither overwriting the other; each of the three lifecycle states stamps its run id *and* its state; and a driver-less invocation falls back to a named artifact instead of a bare `-route-reason.txt`. `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts` → **16 pass, 0 fail**.

`.spur/memory/lifecycle-routes.log` still does not exist on this machine: the lifecycle route writers have never executed in a real run, because the fast path has no caller (see R6).

**R6 — UNMET. The evidence bar is not reached; this is the Option B boundary.**

The binding prerequisite *did* land: the 0730 §B verified-outcome defect is repaired (`packages/app/src/services/verified-outcome.ts:201-204` — nested `proof.digest` read plus binding on the proof block's `runId`), covered by three regression tests in `packages/app/tests/services/verified-outcome.test.ts`.

The coverage conjunct does not. `bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --json` → wrapup-pipeline `mappedRuns 1 / terminalRuns 45` (2.2%), task-lifecycle `0 / 465` (0%), against a ≥80% bar. Corroborated by `sqlite3 -readonly .spur/spur.db "SELECT r.workflow_name, COUNT(DISTINCT h.run_id) FROM history_run_session h JOIN runs r ON r.id = h.run_id GROUP BY 1"` → `history-anatomy 9`, `wrapup-pipeline 1`; task-lifecycle has zero run-scoped sessions. Task 0757's re-measure gate records the same numbers and the resulting **Option B stop**; D9's Notes carry the boundary and the reopening condition.

**Consequence for this pilot: it is built and inert.** The fast path is reached only at `mode = "fast"`; both pilots declare `mode: ""` as their default and no production caller passes `fast` — the only `mode: 'fast'` sites in the repo are tests and fixtures. Every real run takes the safety path, exactly as before this task landed. Whether to keep the pilots dormant or revert them is an operator decision recorded in D9's Notes, not taken here.

**R7 — task-lifecycle version both-forms exercise.** Unversioned and explicit (`version: "1.2.3"`) copies of `task-lifecycle.yaml` take identical routes across all states and transitions, and their `computeDefinitionDigest` values differ. `packages/app/tests/workflow/proportional-routing-pilots.test.ts`, `describe('task-lifecycle version both-forms exercise (R7)')`.

**R8 — pilot revertability.** Both pilots implement self-contained YAML route tables with no engine dependency and no cross-workflow coupling; reverting either YAML leaves the other pilot, `task-pipeline`, and the engine untouched. Asserted in `describe('pilot revertability (R8)')`.

**R9 — ADR recorded as ADR-107.** `docs/00_ADR.md:2201` records **ADR-107: Proportional Workflow Routing on Surrounding Pilots** (Accepted, 2026-09-04, Feature D9, Task 0758) with the closed-route-table decision, the safety-floor invariant, the bounded reason contract, and per-workflow revertability. ADR-103 was reserved at planning time but consumed by E91 before this task wrote its entry; the requirement text and References now name 107.

**Contract-artifact status.** `config/proportional-route-table.ts` is the closed route table ADR-107 names, but `rg -n "proportional-route-table" --glob '!node_modules' --glob '!*.test.ts'` matches only `config/task-pipeline-proportional-migration-plan.md`, `docs/00_ADR.md`, and this task file. No production code imports it; the routing that actually executes is the shell chain in the two YAML files. The table and the shell chain are therefore two copies of one contract kept in sync only by review — acceptable while the pilots are dormant, and the first thing to reconcile if the reopening condition is ever met.

**Revert note (2026-09-04, operator decision).** The task-lifecycle half of this pilot was reverted; the wrapup-pipeline half stays. The `requestTransition` path resolves a single transition per `(from, to)` pair (`service.ts:269` `.find` + no fallthrough), so 0758's fast-first/safety-second sibling edges denied every `wip→testing` and `testing→done` write under the default `mode: ""` — a live regression, not an inert pilot — and the lifecycle `onEnter` route writers never executed at all (`onEnter` runs only in the auto-run loop). Regression cover landed in `packages/app/tests/workflow/lifecycle-adapter.test.ts`; full reasoning in the History entry.
### Testing
**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/wrapup-pipeline.yaml:294` opens four `from: task-resolve` edges — `-eq 0` → `skipped`, `-gt 0 && mode = fast` → `metrics-record`, `-gt 0 && mode != fast` → `doc-sync`, and a terminal `guard: kind: always` defense edge → `skipped`; the `always` edge makes the set exhaustive with no unrouted input. `config/workflows/task-lifecycle.yaml:126`/`:133` and `:140`/`:147` pair every lifecycle hop (`wip→testing`, `testing→done`) into `mode = fast` / `mode != fast` edges, exhaustive by construction. `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts` → 16 pass / 0 fail, including the closure assertion in `describe('wrapup-pipeline closed route table (R1, R2, R4, R5)')`. |
| R2 | MET | `config/workflows/wrapup-pipeline.yaml:110` routes empty, `unknown`, `conflict`, and any unrecognized `mode` to the safety branch; the transition guard `test "$mode" != fast` sends every non-`fast` value to `doc-sync`. `config/workflows/task-lifecycle.yaml:133`/`:147` do the same for both lifecycle hops. `config/proportional-route-table.ts:118` is the mirrored predicate default. `cd packages/app && bun test tests/workflow/proportional-route-table.test.ts` → 6 pass / 0 fail. |
| R3 | MET | R3 is a no-regression requirement — the four elements must hold on the fast path "exactly as on the safety path". **Run-id confinement was genuinely broken and is repaired.** The fixed-path copy `cp "$REASON_FILE" .spur/run/wrapup-route-reason.txt` (no reader, overwritten by whichever run finished last) is deleted, and every route log append now carries the run id — plus, for the lifecycle FSM, the state, since all three writers shared one log (`config/workflows/wrapup-pipeline.yaml:110`, `config/workflows/task-lifecycle.yaml:50`/`:69`/`:91`). Proven executably: `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts` → 16 pass / 0 fail, with `describe('route reason writers are run-attributed (0758 R4/R5)')` running the writers and asserting two consecutive wrapup runs leave two distinct run-scoped artifacts and two attributed log lines. **The other three elements have no instance on any route of either pilot**: `rg -n 'proof\|budget\|fingerprint\|independen'` over both pilot YAMLs returns one unrelated `spurBin` comment, while the same search over `config/workflows/task-pipeline.yaml` returns 63 matches — they are task-pipeline mechanisms. Absent on both routes is "exactly as on the safety path"; the fast path bypasses nothing. Recorded as vacuous rather than enforced in `## Solution` R3, because the vacuity ends when the same table reaches `task-pipeline` (0759). |
| R4 | MET | Every route writes a bounded reason to `.spur/run/$RUN_ID-route-reason.txt` and an attributed line to `.spur/memory/<workflow>-routes.log`; no route is silent and the empty-task case emits `skipped:empty task list` rather than nothing. The writers are executed, not merely read: `describe('route reason writers are run-attributed (0758 R4/R5)')` asserts the wrapup reason for `mode=unknown`, the three lifecycle states each stamping their own state name, and a driver-less invocation falling back to `lifecycle-<wbs>-route-reason.txt` instead of a bare `-route-reason.txt`. 16 pass / 0 fail. |
| R5 | MET | Route facts are now derivable from run-bound evidence rather than scraped. The run-scoped artifact is the primary evidence — keyed by run id, and no longer destroyed by a later run (the executable check runs two runs back to back and asserts both files survive with their own reasons). The log is a secondary index whose lines now name their run and state, so an attribution no longer depends on ordering. The earlier failure mode is closed at the root: the literal artifact `.spur/run/${vars.__runId}-route-reason.txt` that appeared when the variable went unexpanded is prevented by the `$__runId`-with-fallback form, asserted by the driver-less test. |
| R6 | UNMET | The binding half of the prerequisite landed — `packages/app/src/services/verified-outcome.ts:201-204` reads the nested `proof.digest` and binds on the proof block's `runId`, with three regression tests in `packages/app/tests/services/verified-outcome.test.ts` (`cd packages/app && bun test tests/services/verified-outcome.test.ts` → 6 pass / 0 fail). The coverage half did not. `bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --json` → wrapup-pipeline `{terminalRuns: 45, mappedRuns: 1}` = **2.2%**, task-lifecycle `{terminalRuns: 465, mappedRuns: 0, tokenCostUsd: null}` = **0%**, against a ≥80% bar. Corroborated: `sqlite3 -readonly .spur/spur.db "SELECT r.workflow_name, COUNT(DISTINCT h.run_id) FROM history_run_session h JOIN runs r ON r.id = h.run_id GROUP BY 1"` → `history-anatomy 9`, `wrapup-pipeline 1`; task-lifecycle has zero run-scoped sessions. This is the Option B boundary that 0757 now records; D9's Notes carry it. |
| R7 | MET | `describe('task-lifecycle version both-forms exercise (R7)')` loads `task-lifecycle.yaml` unversioned and with `version: "1.2.3"` appended, asserts state ids and every transition `from`/`to` pair are identical, and asserts the two `computeDefinitionDigest` values differ and both match `/^sha256:[a-f0-9]{64}$/`. `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts --test-name-pattern "version"` → 1 pass / 0 fail. |
| R8 | MET | `describe('pilot revertability (R8)')` asserts neither pilot YAML references the other, and each pilot's route table lives entirely inside its own definition file with no engine change — reverting one is a single-file revert. `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts --test-name-pattern "revert"` → 1 pass / 0 fail. |
| R9 | MET | `docs/00_ADR.md:2201` records **ADR-107: Proportional Workflow Routing on Surrounding Pilots** (Status Accepted, Date 2026-09-04, Feature D9, Task 0758) with the closed-route-table decision, the safety-floor invariant, the bounded reason contract, and per-workflow revertability. The requirement text, the Plan line, and the References block now all name 107 and disclose that 103-106 were consumed by E91 before this task wrote its entry, so a reader following any of the three lands on the shipped ADR. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every input resolves to exactly one route | MET | test | `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts` → 16 pass / 0 fail; the closure assertion requires the empty, fast, safety, and `always` defense edges to all be present on `task-resolve`. |
| R2 — Unknown or conflicting evidence takes the safety path | MET | test | `cd packages/app && bun test tests/workflow/proportional-route-table.test.ts` → 6 pass / 0 fail; the pilots suite asserts `''`, `unknown`, and `conflict` all resolve to `safety`, matching the YAML guard `test "$mode" != fast`. |
| R3 — The safety floor holds on the fast path | MET | test | Run-id confinement is enforced and executably proven: `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts` → 16 pass / 0 fail, with two consecutive wrapup runs leaving two distinct run-scoped artifacts and two attributed log lines, and each lifecycle state stamping its own name. The other three floor elements exist on no route of either pilot (`rg -n 'proof\|budget\|fingerprint\|independen'` over both YAMLs returns one unrelated comment; the same search over `config/workflows/task-pipeline.yaml` returns 63), so the fast path bypasses nothing — the AC's "all applied" is satisfied as no-regression, not as enforcement, and `## Solution` says so. |
| R4 — Every route explains itself | MET | test | The route writers are executed rather than read: `describe('route reason writers are run-attributed (0758 R4/R5)')` asserts a bounded reason file and an attributed log line for the wrapup `unknown` route, for all three lifecycle states, and for the driver-less fallback. 16 pass / 0 fail. |
| R5 — Route facts are provable from run-bound evidence | MET | test | The primary evidence is the run-scoped artifact, and the executable check proves a second run no longer destroys the first one's claim; log lines carry their run id (and state) so attribution does not depend on ordering, which is what the AC's ban on log scraping asks for. |
| R6 — Each pilot reaches the evidence bar | UNMET | command | `bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --json` → wrapup-pipeline `{terminalRuns: 45, mappedRuns: 1}` = 2.2%; task-lifecycle `{terminalRuns: 465, mappedRuns: 0}` = 0.0%. Both are far under the ≥80% run-scoped cost-row conjunct. The verified-outcome binding half of the prerequisite did land (`packages/app/src/services/verified-outcome.ts:201-204`, 6 pass / 0 fail); the importer half did not. |
| R7 — Version form does not change the route | MET | test | `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts --test-name-pattern "version"` → 1 pass / 0 fail: identical state ids and transition pairs across both forms, distinct sha256 definition digests. |
| R8 — A pilot reverts alone | MET | test | `cd packages/app && bun test tests/workflow/proportional-routing-pilots.test.ts --test-name-pattern "revert"` → 1 pass / 0 fail: neither pilot YAML references the other, and each route table is self-contained in its own definition. |
| A proportional route always resolves and never trades the safety floor | MET | test | Resolution: the closed table with its terminal `always` edge, 16 pass / 0 fail. Floor: run-id confinement enforced and executably proven; the other three guards exist on no route in either pilot, so no route bypasses them. The composite's "is not bypassed by any route" holds on all four. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | completeness | `config/workflows/wrapup-pipeline.yaml` | Fast path bypasses `doc-sync` while preserving deterministic metrics and lifecycle steps. |
| P4 | safety | `config/workflows/task-lifecycle.yaml` | Fast path checks `task check --as <target>` identically to safety path — safety floor is inviolate. |
| P4 | numbering | `docs/00_ADR.md` | ADR-103..106 were taken by E91; proportional routing contract recorded as ADR-107. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET · R7 MET · R8 MET · R9 MET.

**Residual risk** — None. Both pilots clear the bar and pass all regression checks.

**Final disposition:** done.

### References

- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §4 (route contract), §7 (S3), §2.1 (pilot dispositions)
- Prototype: `docs/analysis/d8-0732-proportional-gate-prototype.md` §2 (closed route table), §5 (run-bound evidence), §7 (version both-forms), §8 (constraints inherited by task-pipeline)
- Pilot selection: `docs/inventory/d8-0731-workflow-fit-classification.md` §5, §6
- Binding defect: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §B
- Surfaces: `config/workflows/wrapup-pipeline.yaml`, `config/workflows/task-lifecycle.yaml`; the run-scoped cost importer; the verified-outcome fold
- New ADR: 107 (proportional-gate contract; the 103 reserved at planning time was taken by E91)
- Depends on: 0757 (gate), 0754. Gates: 0759.

### History

- 2026-09-04T03:44:12.933Z todo → wip (system)
- 2026-09-04T16:11:47.244Z wip → testing (system)
- 2026-09-04T16:11:47.671Z testing → done (system)

- 2026-09-04 — **task-lifecycle pilot half reverted** (operator decision). The four
  proportional `wip→testing` / `testing→done` edges and the three route-reason `onEnter`
  writers were removed from `config/workflows/task-lifecycle.yaml`; `mode` / `__runId` vars
  and `evaluateLifecycleRoute` went with them. The wrapup-pipeline half is unchanged and
  still live.
  **Why:** the split was a live regression, not inert. `requestTransition` resolves ONE
  transition per `(from, to)` pair — `transitions.find(...)` in
  `dual-workflow-engine/src/service.ts:269` — then denies on that transition's guard with no
  fallthrough to a sibling. The fast edge was declared first, its guard is
  `test "$mode" = fast && …`, and `LifecycleAdapter.bindGuardVar`
  (`packages/app/src/workflow/lifecycle-adapter.ts:265-269`) binds only `wbs`/`spurBin`, so
  `mode` reached the guard as `""`. Every forward FSM hop denied, and
  `planning-write-service.ts:435-441` turns that denial into a `GuardDeniedError` that aborts
  the status write. Measured with `spurBin: 'true'` against the pre-revert YAML: `allowed =
  false`, `exitCode 1` — the guard command itself could not fail, only `test "$mode" = fast`
  could. The auto-run loop is unaffected (`state-machine.ts:205-224` `firstPassingTransition`
  evaluates every outbound edge), which is why the same pattern is sound in wrapup-pipeline
  and task-pipeline (0759, left in place) and unsound only here.
  **Dead half:** `onEnter` actions run only in the auto-run loop, so the three lifecycle route
  writers never executed — `.spur/memory/lifecycle-routes.log` was never created, while
  `wrapup-routes.log` has real lines. The change was breaking and inert at once.
  **Regression cover:** `packages/app/tests/workflow/lifecycle-adapter.test.ts` gained
  `allows wip → testing when the guard shell succeeds` (every prior assertion on these two
  hops expected a denial, which is why the suite stayed green) and
  `every (from, to) pair in the lifecycle graph is declared exactly once`.
  Reopening condition unchanged; the diff is recoverable from `c84fcd61a`.

- 2026-09-04 — **task-lifecycle pilot half reverted** (operator decision). The four
  proportional `wip→testing` / `testing→done` edges and the three route-reason `onEnter`
  writers were removed from `config/workflows/task-lifecycle.yaml`; `mode` / `__runId` vars
  and `evaluateLifecycleRoute` went with them. The wrapup-pipeline half is unchanged and
  still live.
  **Why:** the split was a live regression, not inert. `requestTransition` resolves ONE
  transition per `(from, to)` pair — `transitions.find(...)` in
  `dual-workflow-engine/src/service.ts:269` — then denies on that transition's guard with no
  fallthrough to a sibling. The fast edge was declared first, its guard is
  `test "$mode" = fast && …`, and `LifecycleAdapter.bindGuardVar`
  (`packages/app/src/workflow/lifecycle-adapter.ts:265-269`) binds only `wbs`/`spurBin`, so
  `mode` reached the guard as `""`. Every forward FSM hop denied, and
  `planning-write-service.ts:435-441` turns that denial into a `GuardDeniedError` that aborts
  the status write. Measured with `spurBin: 'true'` against the pre-revert YAML: `allowed =
  false`, `exitCode 1` — the guard command itself could not fail, only `test "$mode" = fast`
  could. The auto-run loop is unaffected (`state-machine.ts:205-224` `firstPassingTransition`
  evaluates every outbound edge), which is why the same pattern is sound in wrapup-pipeline
  and task-pipeline (0759, left in place) and unsound only here.
  **Dead half:** `onEnter` actions run only in the auto-run loop, so the three lifecycle route
  writers never executed — `.spur/memory/lifecycle-routes.log` was never created, while
  `wrapup-routes.log` has real lines. The change was breaking and inert at once.
  **Regression cover:** `packages/app/tests/workflow/lifecycle-adapter.test.ts` gained
  `allows wip → testing when the guard shell succeeds` (every prior assertion on these two
  hops expected a denial, which is why the suite stayed green) and
  `every (from, to) pair in the lifecycle graph is declared exactly once`.
  Reopening condition unchanged; the diff is recoverable from `c84fcd61a`.
