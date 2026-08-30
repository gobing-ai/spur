---
schema_version: 1
name: "Fail closed on hollow MET verdict evidence in task-verdict derivation"
status: todo
template: issue
created_at: 2026-08-30T18:21:54.351Z
updated_at: "2026-08-30T19:11:08.213Z"
feature_id: F91
priority: P1
ac_numbering: task-local
ac_altitude: task-local
---

## 0721. Fail closed on hollow MET verdict evidence in task-verdict derivation

### Background
The A6 post-close verification pass found six done tasks (0704 and 0708–0712) whose tracked Testing
tables did not carry enough evidence to support their recorded outcome. Commit `5967b65e7` repaired
the rows, but the current source still reproduces the underlying defect:

- `| R1 | MET |  |` is parsed as a MET requirement with `evidence: ''` and derives `PASS`.
- A four-column AC row ending in an empty evidence cell is reduced to three cells, omitted by the AC
  parser, and the remaining MET requirement still derives `PASS`.

The surrounding foundations have changed since the A6 implementation. Task 0592 centralized verdict
aggregation, task 0700 made scenario-to-feature matching a feature-completion responsibility, and task
0712 delivered verified-outcome duration/cost metrics. This task therefore addresses only the remaining
evidence-integrity hole at the shared verdict boundary. It does not reopen those completed designs.
### Requirements
- [ ] R1. `aggregateVerifyVerdict` returns `PARTIAL`, never `PASS`, when any requirement or Acceptance Criteria row is `MET` while its evidence is absent, empty, or whitespace-only. Existing `FAIL` precedence remains unchanged.
- [ ] R2. `deriveVerdict` preserves a hollow MET AC row instead of omitting it and emits a bounded diagnostic naming every hollow MET row. Its returned aggregate must match recomputation from the persisted artifact.
- [ ] R3. The shared rule applies to answer derivation, persisted-artifact completion checks, record rendering, and feature-check fallback from tracked Testing evidence. Do not add a parallel corpus-only parser or finding code.
- [ ] R4. Populated MET rows retain current behavior. Empty evidence remains legal for `UNMET`, `PARTIAL`, and `N/A`; zero coverage rows remain `UNKNOWN`; scenario-to-feature matching remains owned by the feature-completion check. Focused tests cover missing, empty, whitespace-only, populated, and non-MET cases, and the documented `spur task verdict` behavior is updated in the same change.
### Acceptance Criteria
```gherkin
Feature: Verdict evidence integrity

  Scenario: R1 — Hollow MET requirement cannot pass
    Given a verification answer containing a MET requirement with blank evidence
    When the verdict is derived
    Then the verdict is PARTIAL
    And the diagnostic names the hollow requirement

  Scenario: R2 — Hollow MET acceptance criterion is preserved and cannot pass
    Given a verification answer containing a MET acceptance-criteria row with an empty final evidence cell
    When the verdict is derived
    Then the row remains present with empty evidence
    And the verdict is PARTIAL
    And the diagnostic names the hollow acceptance criterion

  Scenario: R3 — Persisted hollow evidence is rejected consistently
    Given a persisted or tracked verdict record containing a hollow MET coverage row
    When completion or feature validation recomputes the canonical aggregate
    Then the computed result is PARTIAL rather than PASS

  Scenario: R4 — Legitimate outcomes are unchanged
    Given populated MET evidence, a non-MET row, or an answer with no coverage rows
    When the verdict is derived
    Then the existing PASS, FAIL, PARTIAL, N/A, and UNKNOWN semantics remain unchanged
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-30T18:45:06.439Z

**2026-08-30 (session review --triage, operator request):** F2–F4 folded into this task as the single
A6-lane follow-up vehicle. Scope boundary: R1–R4 = verdict-integrity core (F1); R5 = ingestion
strictness (F2, same parser surface); R6–R8 = pipeline observability (F3/F4) — each independently
shippable, priority order R1 → R5 → R2 → R3 → R6 → R7 → R8. Nothing from the review was dropped;
no new task will be filed for these findings. R8 explicitly builds on 0712's existing duration
metrics rather than adding a parallel metric system.

#### Q&A entry — 2026-08-30T19:09:24.947Z

**2026-08-30 — current-source triage of the A6 session-review findings**

- **Kept:** hollow MET evidence is reproducible on current `main` for both requirement and AC rows.
  This is the only unresolved correctness defect in this task.
- **Absorbed into the shared fix:** a separate corpus-sweep rule is unnecessary. Feature validation
  already recomputes tracked Testing evidence with `aggregateVerifyVerdict`; strengthening that shared
  function covers live artifacts, completion, and the tracked fallback without a second parser.
- **Dropped as resolved:** headerless requirement tables already derive `UNKNOWN`, make
  `spur task verdict --from-answer` exit 1, and have CLI regression coverage. Naming the first line
  would be a usability enhancement, not the acceptance hole observed in A6.
- **Dropped as superseded:** task 0700 deliberately owns scenario-row matching at feature completion.
  Reintroducing it during derivation would restore the duplicate, misleading warning removed there.
- **Dropped as non-defects:** `.spur/context/memory.md` is managed by indexed-context hooks, not a
  runall-wrap output contract; an `active` worktree marker is the documented recovery state after an
  interrupted owner, not proof that cleanup failed.
- **Routed to existing owners:** task 0712 owns verified-result duration/cost metrics. Missing imported
  child-session attribution and multi-worktree history discovery belong to task 0722.

Decision: keep 0721 as one verdict-integrity task under F91. No new command, configuration, parser,
metric, memory writer, worktree state, or task is introduced.

#### Q&A entry — 2026-08-30T19:11:08.212Z

**Supersession:** This entry supersedes the preceding 18:45 session-review triage in full. Only the
19:09 current-source triage defines 0721's implementation scope; the earlier "nothing was dropped"
decision was made before the present code and ownership checks.
### Design
Extend the existing canonical aggregation path rather than adding a new validation layer.

1. Widen `AggregateVerdictInput` coverage rows to include optional `evidence`. In
   `aggregateVerifyVerdict`, classify a MET row whose evidence is not a non-empty string as PARTIAL,
   after FAIL/blocker precedence and before the final PASS. Because completion, record, and feature
   validation already call this function, the rule propagates to every authoritative consumer.
2. In `task-verdict.ts`, retain an AC data row with three parsed cells after the table is open; the
   missing fourth cell becomes `evidence: ''`. Requirement parsing already retains the equivalent row.
3. Add one diagnostic check (explicit `major` severity) listing hollow MET row ids. The aggregate rule,
   not the diagnostic, remains authoritative; re-reading the emitted artifact therefore produces the
   same PARTIAL result.
4. Keep the canonical artifact schema backward-compatible. Legacy rows with omitted evidence still
   parse, but their recomputed aggregate is no longer PASS. Do not add a new corpus finding or CLI
   surface.

Expected implementation surface: `packages/app/src/services/verify-verdict.ts`,
`packages/app/src/services/task-verdict.ts`, focused tests for those services and their completion /
feature consumers, and the existing task-verdict paragraph in `docs/04_DESIGN.md`.
### Plan
1. Add failing unit cases for hollow requirement and AC evidence, including absent, empty, and whitespace-only values; pin the required PARTIAL aggregate and diagnostic row ids.
2. Add the evidence-aware branch to `aggregateVerifyVerdict` with existing FAIL and check precedence unchanged.
3. Preserve three-cell AC data rows as empty-evidence rows and emit the bounded major diagnostic from `deriveVerdict`.
4. Add cross-consumer regressions for persisted-artifact completion and feature-check fallback; retain populated, non-MET, and zero-row controls.
5. Update the existing `spur task verdict` design paragraph. Run targeted tests from `packages/app`, then `bun run spur-check` and one `bun run corpus-check` pass.
### Root Cause
`extractRequirements` in `packages/app/src/services/task-verdict.ts` defaults a missing evidence cell
to the empty string and accepts the row. The AC path is worse: `splitTableCells` removes the empty
final cell, while `extractAcceptanceCriteria` accepts data rows only when at least four cells remain,
so the hollow AC row disappears without reaching the existing dropped-row diagnostic.

`aggregateVerifyVerdict` in `packages/app/src/services/verify-verdict.ts` currently reads only row
status. Once at least one coverage row exists, all-MET rows plus non-blocking checks produce PASS;
evidence content is outside the policy. This shared omission is why answer derivation, persisted
artifacts, and tracked Testing fallback agree on the same incorrect result.

Current-source probes on 2026-08-30 produced `PASS` for both hollow shapes. The same probe produced
`UNKNOWN` for a headerless requirement row, and the focused CLI test confirmed exit code 1, so the
headerless-table claim is not part of this root cause. A corpus scan found no remaining tracked MET /
PARTIAL rows with empty evidence after `5967b65e7`; no migration is required.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature F91 — corpus evidence integrity owner; task 0721 is a task-local follow-up slice.
- Task 0592 / feature F92 — canonical verdict schema, aggregation, and completion enforcement.
- Task 0700 — scenario-row matching belongs to feature completion.
- Task 0712 — verified-result duration and attributable-cost metrics.
- Task 0722 — original-history import discovery and task/run/session attribution.
- Commit `5967b65e7` — repaired hollow A6 Testing evidence in 0704 and 0708–0712.
- `packages/app/src/services/task-verdict.ts`
- `packages/app/src/services/verify-verdict.ts`
- `packages/app/src/services/done-transition-guard.ts`
- `packages/app/src/services/feature-check.ts`
- `packages/app/tests/services/task-verdict.test.ts`
- `packages/app/tests/services/verify-verdict.test.ts`
### History

- 2026-08-30T18:48:21.679Z backlog → todo (system)
