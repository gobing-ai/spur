---
schema_version: 1
name: "Fail closed on hollow MET verdict evidence in task-verdict derivation"
status: done
template: issue
created_at: 2026-08-30T18:21:54.351Z
updated_at: "2026-08-31T02:03:41.446Z"
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

- [x] R1. `aggregateVerifyVerdict` returns `PARTIAL`, never `PASS`, when any requirement or Acceptance Criteria row is `MET` while its evidence is absent, empty, or whitespace-only. Existing `FAIL` precedence remains unchanged.
- [x] R2. `deriveVerdict` preserves a hollow MET AC row instead of omitting it and emits a bounded diagnostic naming every hollow MET row. Its returned aggregate must match recomputation from the persisted artifact.
- [x] R3. The shared rule applies to answer derivation, persisted-artifact completion checks, record rendering, and feature-check fallback from tracked Testing evidence. Do not add a parallel corpus-only parser or finding code.
- [x] R4. Populated MET rows retain current behavior. Empty evidence remains legal for `UNMET`, `PARTIAL`, and `N/A`; zero coverage rows remain `UNKNOWN`; scenario-to-feature matching remains owned by the feature-completion check. Focused tests cover missing, empty, whitespace-only, populated, and non-MET cases, and the documented `spur task verdict` behavior is updated in the same change.

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

Fail-closed hollow MET evidence at the one shared verdict boundary (0721 R1–R4). No new parser, CLI surface, or corpus finding code.

Change map:

- `packages/app/src/services/verify-verdict.ts:220-221` — `AggregateVerdictInput` coverage rows widened with optional `id`/`evidence` so raw and parsed rows aggregate identically.
- `packages/app/src/services/verify-verdict.ts:247-257` — `isHollowMet`: a MET row whose evidence is not a non-empty string (absent, empty, whitespace-only, or non-string) is hollow.
- `packages/app/src/services/verify-verdict.ts:271-319` — inside `aggregateVerifyVerdict`, hollow MET folds into the existing PARTIAL branch: after FAIL/blocker precedence, before the final PASS. Completion (`done-transition-guard.computeAggregate`), record rendering, corpus sweep, and the feature-check tracked-Testing fallback already call `aggregateVerifyVerdict`, so the rule propagates with zero consumer edits (R3) — no parallel parser or finding code.
- `packages/app/src/services/task-verdict.ts:226-240` — the AC parser retains a three-cell data row once the table is open (missing fourth cell becomes `evidence: ''`, 0721 R2); a three-cell row counts as AC-shaped only when its status cell normalizes, so a foreign heading-less three-column table is skipped exactly as before.
- `packages/app/src/services/task-verdict.ts:379-392` — one bounded `hollow-met-evidence` check (explicit `major` severity) naming every hollow MET requirement/AC row id; the aggregate rule, not the diagnostic, stays authoritative (R2).
- `packages/app/src/services/task-record.ts:60-70` — `VerdictCheck` gains optional `severity` (`CheckSeverity`) so the diagnostic serializes into the emitted artifact and recomputes consistently at the done gate.
- `docs/04_DESIGN.md:1898` — the `spur task verdict` paragraph documents the hollow rule.

Behavior retained (R4): populated MET rows still PASS; empty evidence stays legal for UNMET (FAIL), PARTIAL, and N/A rows; zero-row answers stay UNKNOWN; scenario-to-feature matching stays at feature completion. Legacy artifacts with omitted evidence now recompute to PARTIAL at the done gate — the intended fail-closed change.

Verification: `packages/app` suite 2354 pass / 0 fail (`bun test tests`); CLI task-verb suite 172 pass (`bun test apps/cli/tests/commands/task.test.ts`); typechecks `@gobing-ai/spur-app` and `@gobing-ai/spur` exit 0; `bun run corpus-check` — 0 new errors, the one new warning was this Solution's own anchor, fixed by citing `aggregateVerifyVerdict` directly.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `isHollowMet` (`packages/app/src/services/verify-verdict.ts:253-255`) classifies MET with absent/empty/whitespace-only/non-string evidence as hollow; folded into the PARTIAL branch after FAIL/blocker precedence, before the final PASS (`verify-verdict.ts:310-311`, ordering comment `:282-291`). Missing/empty/whitespace/non-string cases pinned (`packages/app/tests/services/verify-verdict.test.ts:262-306`); blocker-over-hollow → FAIL precedence pinned (`:310-323`). Live probe this session: `spur task verdict --from-answer` with ` |
| R2 | MET | Three-cell AC data rows retained with `evidence: ''` once the table is open (`packages/app/src/services/task-verdict.ts:226-241`, `acShaped` guard skips foreign heading-less tables exactly as before); one bounded `hollow-met-evidence` check with explicit `major` severity names every hollow req/AC id (`task-verdict.ts:379-393`); `deriveVerdict` aggregates via the shared policy (`task-verdict.ts:58-64`); done-guard recomputation agrees — hollow stored PASS denied with `self-inconsistent` (`done-transition-guard.test.ts:546-584`). Live probe this session: 4-col AC row with empty evidence cell → row retained (`C1 MET ''`), verdict PARTIAL, exit 1, diagnostic names C1. |
| R3 | MET | All five authoritative consumers route through `aggregateVerifyVerdict`: answer derivation (`task-verdict.ts:58`), done guard (`done-transition-guard.ts:167`), record rendering (`task-record.ts:298`), corpus sweep (`corpus-sweep.ts:74`), feature-check tracked-Testing fallback (`feature-check.ts:689`) — grep-verified this session; single `isHollowMet` definition, zero consumer edits, no parallel parser or finding code. `VerdictCheck.severity` added (`task-record.ts:62-65`); hollow tracked rows parse and recompute PARTIAL (`task-record.test.ts:1259-1293`); CLI hollow row → PARTIAL + exit 1 (`apps/cli/tests/commands/task.test.ts:2208-2221`). |
| R4 | MET | Populated MET PASS control (`verify-verdict.test.ts:330-335`; CLI test 8002 → verdict PASS); empty evidence legal for UNMET (→ FAIL), PARTIAL, and N/A (`verify-verdict.test.ts:315-328`); zero coverage rows → UNKNOWN (`:337-339`; also observed live — AC-only answer stays UNKNOWN per pre-existing zero-requirement semantics); scenario-to-feature matching untouched at feature completion; `docs/04_DESIGN.md:1898` documents the hollow rule in the same change (git diff confirms). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| AC1 — Hollow MET requirement cannot pass (PARTIAL + diagnostic) | MET | test | Unit pins `verify-verdict.test.ts:262-323`; live CLI probe → `Verdict: PARTIAL`, exit 1, `hollow-met-evidence` (severity major) names R1 |
| AC2 — Hollow MET AC row preserved, cannot pass, diagnostic | MET | test | `task-verdict.test.ts:562-616` (severity major, names row, whitespace-only); live probe → row retained as `C1 MET ''`, verdict PARTIAL, diagnostic names C1 |
| AC3 — Persisted/tracked hollow evidence rejected consistently | MET | test | `done-transition-guard.test.ts:546-584` (computeAggregate stored PASS → PARTIAL; gate denies self-inconsistent); `task-record.test.ts:1259-1293` (parseTesting hollow recompute); green in fresh suite run |
| AC4 — Legitimate outcomes unchanged (PASS/FAIL/PARTIAL/N-A/UNKNOWN) | MET | test | Populated-PASS, UNMET→FAIL, N/A-PASS, zero-row-UNKNOWN controls all pinned and green in fresh `bun test tests` (2354 pass / 0 fail) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | usability | `packages/app/src/services/task-record.ts:487-493` | The Review findings-table render maps check status to P1–P4 (`fail` → `P1`) and drops the new explicit `severity` (`hollow-met-evidence` is `major` but renders `P1`), so the rendered P-table loses the major/blocker distinction. Presentation-only: no aggregation consumer re-parses the rendered P-table (the done gate reads the JSON artifact, whose Zod `checkSchema` preserves `severity` — `packages/app/src/services/verify-verdict.ts:159-166`), and the aggregate rule, not the diagnostic, is authoritative (0721 R2). |
| P4 | correctness | `packages/app/src/services/task-verdict.ts:228-232` | The widened three-cell AC retention (`acShaped`) absorbs a foreign 3-column row whose cells happen to normalize as status+evidenceType (e.g. `\| foo \| MET \| test \|`) as a hollow AC row instead of skipping it. Narrow and fail-closed (row cannot PASS; `hollow-met-evidence` names it), and the canonical foreign-table shape (`Check/pass/evidence`) is pinned skipped by `packages/app/tests/services/task-verdict.test.ts:645-666`. |
| P4 | — | — | No P1–P2 findings; SECUA + architecture verdict PASS |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `isHollowMet` (`packages/app/src/services/verify-verdict.ts:254-257`) treats MET with absent/empty/whitespace/non-string evidence as hollow; folded into the PARTIAL branch after FAIL/blocker precedence, before PASS (`verify-verdict.ts:314-318`, precedence pinned by `verify-verdict.test.ts:318-323` blocker-over-hollow → FAIL). Missing/empty/whitespace/non-string cases each pinned (`verify-verdict.test.ts:260-306`). |
| R2 | MET | Three-cell AC data rows retained with `evidence: ''` once the table is open (`packages/app/src/services/task-verdict.ts:220-235`); one bounded `hollow-met-evidence` major check names every hollow req/AC id (`task-verdict.ts:376-393`); `deriveVerdict` aggregates via the shared policy (`task-verdict.ts:58-64`), and done-guard recomputation agrees — hollow stored PASS denies with `self-inconsistent` (`done-transition-guard.test.ts:547-584`). |
| R3 | MET | All five consumers route through `aggregateVerifyVerdict`: answer derivation (`task-verdict.ts:58`), done guard (`done-transition-guard.ts:167`), record (`task-record.ts:298`), corpus sweep (`corpus-sweep.ts:74`), feature-check tracked-Testing fallback (`feature-check.ts:689`); zero consumer edits, no parallel parser or finding code (single `isHollowMet` definition; grep-verified). Hollow tracked rows parse and recompute PARTIAL (`task-record.test.ts:1259-1293`); CLI hollow row → PARTIAL + exit 1 (`apps/cli/tests/commands/task.test.ts:2210-2221`). |
| R4 | MET | Populated MET PASS control (`verify-verdict.test.ts:330-335`); empty evidence legal for N/A (PASS) and PARTIAL (`verify-verdict.test.ts:322-328`); UNMET+empty → FAIL (`:315-319`); zero rows → UNKNOWN (`:337-339`); scenario-to-feature matching untouched at feature completion; `docs/04_DESIGN.md:1898` documents the hollow rule in the same change. |

#### SECUA + Architecture

- Security: fail-closed direction is the change — a status that claims success without recorded evidence can no longer aggregate PASS at any authoritative boundary; the raw-row trust boundary is preserved (structurally-invalid artifacts degrade to UNKNOWN, `verify-verdict.ts:274-289`); no new exec/secrets/IO.
- Correctness: the aggregate rule stays authoritative and the diagnostic advisory, so persisted-artifact recomputation and derivation cannot drift (`severity` round-trips the artifact via Zod `checkSchema`; harsher-of-two done semantics unchanged). Legacy artifacts with omitted evidence now recompute PARTIAL and deny at the done gate — the intended fail-closed behavior, pinned by test.
- Usability: one bounded diagnostic names every hollow row with remediation text; `spur task verdict` exits 1 on hollow (CLI-pinned), consistent with non-PASS verdicts.
- Architecture: deepening follows the Design exactly — one rule at the one shared boundary, zero new parsers/finding codes/CLI surfaces; the optional `severity` on `VerdictCheck` (`task-record.ts:62-69`) mirrors the canonical type for artifact consumption without a parallel schema.

#### Verification (fresh, this review)

- `packages/app`: `bun test tests` — 2354 pass / 0 fail (matches the Solution claim).
- CLI: `bun test apps/cli/tests/commands/task.test.ts` — 172 pass / 0 fail.
- Typechecks: `@gobing-ai/spur-app` and `@gobing-ai/spur` both exit 0.
- `bun run corpus-check` — errors 4 observed / 4 baselined / 0 new; warnings 812 observed / 269 baselined / 0 new.

#### Residual Risk

- Legacy done tasks with hollow MET rows will deny any future done re-transition until re-verified or `--force-done --reason` — intended fail-closed behavior; no migration needed (corpus scan found no remaining hollow tracked rows; corpus-check green).
- P3 render-table severity loss above: if a future consumer ever aggregates from the rendered Review P-table instead of the artifact, major/blocker distinction would be lost there. No such consumer exists today.

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
- 2026-08-31T01:41:01.341Z todo → wip (system)
- 2026-08-31T02:02:46.477Z wip → testing (system)
- 2026-08-31T02:03:41.446Z testing → done (system)
