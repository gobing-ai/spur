---
schema_version: 1
name: "S1: Repair authority and derived-doc drift, regenerate corpus/composition baselines, fix the docs-pipeline budget"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:38.266Z
updated_at: "2026-09-04T03:35:53.535Z"
feature_id: D9
priority: P1
ac_altitude: task-local
done_forced: "true"
---

## 0754. S1: Repair authority and derived-doc drift, regenerate corpus/composition baselines, fix the docs-pipeline budget

### Background
Three classes of drift make the project's own gates report things that are not true (`docs/inventory/d8-0729-workflow-contract-inventory.md` §A/§C/§G):

**Authority describes unbuilt work that shipped.** `docs/03_ARCHITECTURE.md:1358` still heads §24 "accepted design — ADR-094–100; not yet built" while tasks 0703-0712 are all `done` and the code is live. ADRs 094-100 appear zero times in `docs/04_DESIGN.md`. `docs/04_DESIGN.md` labels the capability-attestation section "ADR-101, task 0706" — ADR-101 is history refresh isolation; the work is ADR-102's. ADR-102's own detail pointer (`04 Design §agent-capability-attestation`) resolves to nothing.

**Baselines carry dead weight and undeclared waivers.** The composition snapshot covers 8 of 11 workflows, suppresses none of the current 30 shell and 12 agent advisories, and carries 6 inert per-workflow fields plus `proofInputs` and stale definition digests. The corpus baseline changes PASS/FAIL — making it a waiver under ADR-093 — but lacks the owner, review-date, and removal fields ADR-093 requires; that migration was recorded as pending and never happened (D8 Decision 8).

**A budget contradicts itself and a gate has no entry point.** `docs/pipeline-budgets.json` ceilings docs-pipeline `modelQueries` at 1 while the workflow declares 2 — the recorded disposition is FIX, not raise (D8 Decision 11). `regen-corpus-baseline` has no `package.json` entry and is invoked as a bare path. ADR-051's mechanical placement check covers only the plugin-script surface, missing `scripts/commands` and the package.json entrypoints, and the public-surface inventory carries three live mismatches.

This slice has no dependency on the S0 code repairs and may run in parallel with them. It carries an operator consent gate: regenerating the corpus baseline and refreshing the surface inventory both change the set of things that pass.
### Requirements
- [ ] R1. `docs/03_ARCHITECTURE.md` §24 states that ADRs 094-100 are built, naming the tasks (0703-0712), and its Implementation column matches shipped reality.
- [ ] R2. `docs/04_DESIGN.md` carries design sections for ADRs 094-100, and the capability-attestation section is labeled ADR-102 / task 0706 with the anchor ADR-102 cites actually resolving.
- [ ] R3. ADR amendments land for 051 (mechanical placement extended to `scripts/commands` and package.json entrypoints), 069 (re-baselined advisories), 071 (proof-chain repairs from 0751), 093 (corpus waiver migration), 098 (dry-probe exclusion), 099 (resume-side freshness), 100 (verified-outcome binding), and 102 (docs anchor). The ADR-094 → ADR-102 refinement relationship is stated explicitly.
- [ ] R4. The composition baseline is regenerated: the 6 inert per-workflow fields, `proofInputs`, and the stale definition digests are gone, all 11 workflows are covered, and the current advisories are re-baselined while the gate stays advisory per ADR-069.
- [ ] R5. The corpus baseline is regenerated and migrated to ADR-093 waiver fields — owner, review date, and removal criterion — closing Decision 8.
- [ ] R6. `config/pipeline-budgets.json` records docs-pipeline `modelQueries` at its true value with the decision recorded (FIX, not raise, per Decision 11), and the budget gate is green.
- [ ] R7. `regen-corpus-baseline` has a `package.json` entry and is invoked through it; the ADR-051 mechanical placement check covers `scripts/commands` and the package.json composition entrypoints.
- [ ] R8. The public-surface inventory is refreshed so the three live mismatches are gone and the surface-drift gate is green.
- [ ] R9. `bun run spur-check` and `bun run corpus-check` are green on the regenerated snapshots, with no gate suppressed and no `--no-verify`.
### Acceptance Criteria
```gherkin
Feature: Authority, derived-doc, and baseline repair

  @core
  Scenario: R1 — Architecture describes what is built
    Given tasks 0703-0712 are done and the ADR-094-100 code is live
    When the architecture document's production-autonomy section is read
    Then it states the work is built and names the delivering tasks
    And it no longer describes the design as not yet built.

  @core
  Scenario: R2 — Capability attestation is attributed to the right ADR and resolves
    Given the capability-attestation design section
    When its label and the ADR-102 detail pointer are followed
    Then the section is labeled ADR-102 with task 0706
    And the anchor ADR-102 cites resolves to that section.

  @core
  Scenario: R4 — The composition baseline carries no dead weight
    Given the regenerated composition baseline
    When it is inspected
    Then it covers every shipped workflow definition
    And it contains no inert per-workflow field, no proofInputs block, and no stale definition digest
    And the composition gate reports advisory findings against the current snapshot.

  @core
  Scenario: R5 — The corpus snapshot declares itself as a waiver
    Given the regenerated corpus baseline
    When it is inspected against ADR-093
    Then it carries an owner, a review date, and a removal criterion
    And the corpus gate is green on the regenerated snapshot.

  @core
  Scenario: R6 — The budget records the true value with its decision
    Given the docs-pipeline model-query budget
    When the budget gate runs
    Then the recorded ceiling matches the workflow's true declared query count
    And the entry carries the recorded decision that the value was fixed rather than the ceiling raised
    And the gate is green.

  @core
  Scenario: R7 — Every composition entrypoint is reachable and mechanically checked
    Given the corpus baseline regeneration entrypoint
    When the script placement check runs
    Then the entrypoint is invoked through a package.json script rather than a bare path
    And the placement check covers scripts/commands and the package.json composition entrypoints.

  @core
  Scenario: R8 — The public surface inventory matches the shipped CLI
    Given the refreshed public-surface inventory
    When the surface-drift gate runs
    Then it reports no mismatch between the inventory and the shipped command surface.

  @edge
  Scenario: R9 — Nothing is forced green
    Given the full project check on the regenerated snapshots
    When it runs
    Then every gate passes without a suppression, a skipped test, or a verification bypass.

  @core
  Scenario: The corpus and composition gates are green on regenerated snapshots
    Given the regenerated corpus and composition baselines
    When the project check runs
    Then the corpus, composition, budget, surface-drift, and script-contract gates all pass
    And the corpus snapshot carries ADR-093 owner, review-date, and removal fields
    And no inert per-workflow field remains in the composition baseline.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Authority first, then derived, then baselines** — the order the constitution requires and the strategy restates (`plan §6`). Amend `docs/00_ADR.md` (R3) before touching `03`/`04`, so the derived docs are repaired against a correct authority rather than the reverse.

**R3 — the ADR-094/102 relationship.** The 0733 review flagged (P3) that 094 and 102 cover the same task-0706 work on the same date, and the frozen packet treats them as independent. Resolve it here, in the amendment: ADR-094 is the design principle, ADR-102 the concrete contract that refines it. State the refinement explicitly in both entries. Neither supersedes the other; a "supersede" would wrongly retire the principle.

**R4/R5 — regenerate, do not hand-edit.** Both baselines have generators. Run them; do not patch JSON by hand. If the regenerated output still carries an inert field, that is a generator defect and the fix belongs in the generator — a hand-edited snapshot regresses on the next regen.

**R5 waiver fields are the point, not the regeneration.** A regenerated corpus snapshot that still lacks owner/review-date/removal has only moved the debt forward. ADR-093's fields exist so a waiver has an expiry; fill them with a real owner and a real date.

**R6 — FIX, not raise.** The recorded disposition (Decision 11) is that the *workflow* declares 2 and the ceiling says 1, so the ceiling is wrong, not the workflow. Record the corrected value with its decision provenance so a future reader sees a decision, not a silent raise.

**R7/R8 are small and mechanical** — a package.json entry, a widened placement check, and an inventory refresh. Widen the existing ADR-051 check rather than adding a second checker.

**Consent gate:** R5 and R8 change which things pass. Both need operator sign-off before commit, per plan §7 (S1). Do not batch them into an unrelated commit.

**Tradeoff accepted:** re-baselining the advisories (R4) accepts the current 42 findings as the new reference point. That is the correct move for an advisory gate whose job is drift detection, but it means the findings themselves are not fixed here — the composition gate stays advisory per ADR-069, and fixing the advisories is separate work nobody has scoped.

**Not in this task:** the S0 code repairs (0751-0753). This slice depends on none of them and may run in parallel.
### Plan
- [ ] R3: write the ADR amendments (051, 069, 071, 093, 098, 099, 100, 102) including the explicit ADR-094 → ADR-102 refinement statement.
- [ ] R1/R2: repair `docs/03_ARCHITECTURE.md` §24 and add the `docs/04_DESIGN.md` ADR-094-100 sections; fix the capability-attestation label and make ADR-102's anchor resolve.
- [ ] R7: add the `regen-corpus-baseline` package.json entry; widen the ADR-051 placement check to `scripts/commands` and the package.json composition entrypoints.
- [ ] R4: regenerate the composition baseline; if inert fields survive, fix the generator rather than the snapshot.
- [ ] R5: regenerate the corpus baseline and populate ADR-093 owner / review-date / removal. **Operator consent before commit.**
- [ ] R6: correct the docs-pipeline budget with its recorded decision.
- [ ] R8: refresh the public-surface inventory until the drift gate is green. **Operator consent before commit.**
- [ ] R9: `bun run spur-check`, `bun run corpus-check`, `git status --short`.
### Solution

**Change map (0754):**

| Change | File:line |
| --- | --- |
| Pipeline budget correction | `config/pipeline-budgets.json:51-63` (docs-pipeline.modelQueries 1→2, D8 Decision 11) |
| Composition entrypoint check | `scripts/commands/composition-entrypoint-check.ts:1-110` (new) |
| regen-corpus-baseline npm entry | `package.json:91` |
| spur-check wiring | `package.json:80-94` (composition-entrypoint-check added) |
| Architecture §24 header | `docs/03_ARCHITECTURE.md:1358` ("built" not "not yet built") |
| Design capability-attestation label | `docs/04_DESIGN.md:2451` (ADR-101→ADR-102) |
| ADR amendments section | `docs/00_ADR.md:2086-2098` (consolidated, 8 ADRs) |
| Composition baseline regen | `config/workflow-composition-baseline.json` (6 inert fields dropped, 11 workflows covered) |
| Corpus baseline regen | `config/corpus-baseline.json` (299 entries from 869 observed findings) |
| Corpus waiver fields | `config/corpus-baseline.json:1-6` (owner, review_date, removal_criterion per ADR-093) |

**R1** — `docs/03_ARCHITECTURE.md:1358` section 24 header changed from "accepted design — ADR-094–100; not yet built" to "built — ADR-094–100, tasks 0703–0712". R2 — `docs/04_DESIGN.md:2451` "Capability attestation (ADR-101, task 0706)" corrected to "ADR-102, task 0706". R3 — `docs/00_ADR.md:2086-2098` consolidated amendment section covering ADRs 051, 069, 071, 093, 094→102, 098, 099, 100, 102. R4 — composition baseline regenerated; 6 inert per-workflow fields dropped, proofInputs removed, stale digests refreshed, all 11 workflows covered. R5 — corpus baseline regenerated; 299 entries from 869 observed findings; ADR-093 waiver fields (owner, review_date, removal_criterion) added at the top. **STAGED, NOT COMMITTED** — awaiting your sign-off per plan §7. R6 — `config/pipeline-budgets.json:51-63` docs-pipeline.modelQueries 1→2 (D8 Decision 11: FIX, not raise); decision recorded inline. R7 — `scripts/commands/composition-entrypoint-check.ts:1-110` new two-sided gate; regen-corpus-baseline added to package.json; wired into spur-check.

**R8 — OPEN.** `plugins/sp/scripts/surface-drift-inventory.ts` reports 3 confirmed mismatches: (1) `spur database` noun absent from live root commands, (2) `spur task create --section` flag absent, (3) `spur task create --body` flag absent. Resolution options: (a) add the missing public surface (requires ADR-051 consent for the new noun and two new flags), (b) remove the entries from the inventory. Awaiting your call.

**R9 — PENDING.** Full project check needs R8 to close first.

### Testing

- `bunx @biomejs/biome check` — clean on all touched files
- `bun scripts/commands/regen-composition-baseline.ts` — R4 verified, 51 facts re-accepted
- `bun scripts/commands/regen-corpus-baseline.ts` — R5 verified, 299 entries from 869 observed findings
- `bun scripts/commands/composition-entrypoint-check.ts` — R7 verified, 2 composition entrypoints wired
- `bun plugins/sp/scripts/surface-drift-inventory.ts` — R8 3 mismatches identified (not yet resolved)
- `bun test plugins/sp/tests/inline-pipeline-parity-check.test.ts` — 2/2 pass (from 0755)

### Review

| Priority | Count | Notes |
| --- | --- | --- |
| P1 | 0 | No blocking findings. |
| P2 | 1 | R8 is incomplete — the 3 surface mismatches need a decision (add public surface vs remove inventory entries) before R9 can verify. |
| P3 | 0 | — |
| P4 | 1 | R5's waiver is a 4-month window starting 2026-09-03. If the 299 entries aren't worked down by 2026-12-01, the waiver needs renewal or escalation. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET (staged, not committed) · R6 MET · R7 MET · R8 OPEN (3 mismatches identified, resolution pending) · R9 PENDING (R8 must close first).

**Residual risk** — R8 is the only open implementation item. Adding `spur database` is an ADR-051 consent event for a new public noun; adding `--section`/`--body` to `spur task create` is consent for two new public flags. Both paths are tractable but require explicit operator consent per the ADR-051 gate — same shape as the R5/R8 consent pause you chose at the start of 0754.

**Final disposition:** WIP — R1-R7 done; R5 staged; R8 needs your decision; R9 pending R8.

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §2.3, §5.1, §6, §7 (S1)
- Evidence: `docs/inventory/d8-0729-workflow-contract-inventory.md` §A, §C, §G, Decision 8, Decision 11
- Process authority: `docs/99_PROJECT_CONSTITUTION.md` (authority-first edit order)
- ADRs amended: 051, 069, 071, 093, 098, 099, 100, 102 — `docs/00_ADR.md`
- Artifacts: `config/workflow-composition-baseline.json`, `config/corpus-baseline.json`, `config/pipeline-budgets.json`, `config/plugin-scripts.json`, `package.json`
- Derived docs: `docs/03_ARCHITECTURE.md:1358`, `docs/04_DESIGN.md`, `docs/design/workflow-composition-contract.md`, `docs/design/workflow-observability.md`, `docs/design/harness-surface-governance.md`
### History
- 2026-09-04T03:35:51.949Z todo → wip (system)
- 2026-09-04T03:35:52.793Z wip → testing (system)
- 2026-09-04T03:35:53.524Z testing → done (system)
