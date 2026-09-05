---
schema_version: 1
id: "D61"
name: "Essential workflow checks and observable execution"
status: backlog
priority: P1
tags: []
created_at: "2026-09-05T05:08:34.650Z"
updated_at: "2026-09-05T15:40:37.968Z"
---

# D61: Essential workflow checks and observable execution

## Goal

Reduce the time, model context, and maintenance spent on repeated structural validation while preserving trustworthy completion, and make every shipped workflow's plan, identity, and execution outcome visible to the operator.

## Scope

In scope:

- Remove routine whole-corpus validation and blanket document-warning elevation; retain essential integrity and completion checks at affected write/transition boundaries.
- Keep `bun run corpus-check` as an explicitly invoked full diagnostic over its documented corpus scope, failing essential integrity errors and reporting document-quality warnings without a suppression baseline.
- Retire the corpus waiver snapshot and exact workflow composition snapshot after migrating their useful consumers; keep the JSON compatibility fixture.
- Finish existing optional version and workflow plan/progress surfaces, including host todo integration with a Markdown fallback.
- Review, refine, version and verify all eleven canonical workflow definitions; migrate task-pipeline last and rebuild generated bundle assets.
- Synchronize authority, CLI contracts, canonical plugin skills and templates in the owning implementation changes.

Out of scope:

- Activating D9's dormant fast routes without its existing real-run coverage evidence.
- Replacing the workflow engine, introducing a version registry, validation cache service, exception framework or new public noun.
- Reimplementing task 0723's doctor-free precheck; the final task-pipeline package consumes its current result and resolves any outstanding overlap first.
- Changing feature ID syntax: canonical hierarchical IDs intentionally exclude zero.
- Deleting the JSON response compatibility fixture, rewriting archived task records for document style, or modifying external projects.
- Publishing, merging, releasing or executing the implementation task batch during this idea pipeline.

## Acceptance Criteria

```gherkin
Feature: Essential workflow checks and observable execution

  @core
  Scenario: R1 — Normal checks preserve essential completion integrity
    Given a task or feature with missing required evidence, a stale verdict, a broken required reference, or an illegal completion transition
    When its affected write or completion boundary is checked without blanket strict warning elevation
    Then the operation fails with the essential finding
    And document-style warnings alone do not block otherwise valid completion
    And the legacy task strict-core alias produces the same result as the normal task check

  @core
  Scenario: R2 — Routine work does not scan the whole corpus
    Given a task iteration, feature batch wrapup, or commit preparation that does not change checker policy
    When its applicable validation runs
    Then no automatic command invokes a whole-corpus sweep
    And the affected task, feature, and required linked evidence remain checked
    And adjacent guards reuse one result only until a relevant input changes

  @core
  Scenario: R3 — Explicit corpus audits remain useful without suppressions
    Given a corpus with essential integrity errors and historical document-quality warnings
    When the operator invokes bun run corpus-check
    Then the command reports both categories and exits non-zero for essential errors
    And warnings alone do not fail the audit
    And no corpus-baseline file suppresses a finding
    And checker-policy changes retain a documented one-time audit obligation

  @core
  Scenario: R4 — Baseline retirement preserves useful consumers
    Given the corpus and composition snapshot readers and the JSON response compatibility fixture
    When the baseline migration completes
    Then corpus and composition snapshots and their regeneration-only machinery are removed
    And budgets, inventory, evaluation, advisory, and proof digest consumers retain their useful behavior using live definitions or focused behavior checks
    And the JSON compatibility fixture still verifies its response contract
    And no automatic regeneration accepts new debt during migration

  @core
  Scenario: R5 — Planning and execution share workflow identity
    Given a versioned or unversioned definition in either supported workflow dialect
    When it is shown, listed, run, traced, or resumed
    Then the existing surfaces report the applicable version identity consistently
    And plan, execution, and resume use the same resolved definition digest
    And an empty version is rejected and an unknown non-empty literal remains opaque
    And producing a plan executes no workflow actions or guards

  @core
  Scenario: R6 — Progress is readable and truthful across execution surfaces
    Given an inline, synchronous, asynchronous, or resumed workflow run with branches or retries
    When the plan and subsequent state-boundary updates are presented
    Then the operator can identify the current state, active actions, retries, skips, and final outcome
    And a native todo tool is used when available with a Markdown fallback otherwise
    And conditional states are not falsely reported as an inevitable path or completed work
    And machine stdout and quiet, silent, and no-plan behavior remain compatible

  @core
  Scenario: R7 — Planning and document workflows use evidence instead of ceremony
    Given the upgraded idea-pipeline, docs-pipeline, and wayfinder-resolution definitions
    When their success, revision, and failed-evidence paths execute
    Then repeated structural checks and word-count proof proxies are eliminated
    And atomic task creation, design approval, run-bound evidence, and normal completion guards still hold
    And the idea pipeline ends at handoff without implementing tasks

  @core
  Scenario: R8 — Lifecycle and wrapup outcomes remain authoritative
    Given the upgraded task-lifecycle, feature-lifecycle, feature-dev, and wrapup-pipeline definitions
    When transitions, existing-feature execution, and wrapup are exercised
    Then each externally driven transition has one edge per source and target pair
    And incomplete or unverified work cannot become done
    And invalid wrapup input or failed required synchronization is not reported as success
    And requesting an integration review is not treated as a collected clean review

  @core
  Scenario: R9 — Example and specialist workflows preserve their useful behavior
    Given the upgraded basic, history-anatomy, and pr-review definitions
    When their successful and relevant failed or pending paths execute
    Then the example executes a valid configurable quality command with bounded fixes
    And history cache hits avoid unnecessary model work while invalid evidence cannot publish
    And PR review remains head-pinned, deduplicated, and honest about pending results

  @core
  Scenario: R10 — The task pipeline is upgraded last without weakening proof
    Given the surrounding workflow upgrades have passed and task-pipeline uses its normal safety route
    When quality checking, review, verification, and record complete or fail
    Then the exact certified inputs and run-bound verdict govern completion
    And changed inputs or missing, stale, or non-PASS evidence deny done
    And redundant structural work and full-log echoing are reduced
    And no production caller enables fast mode without D9's existing coverage conditions

  @core
  Scenario: R11 — All shipped definitions and generated assets complete the migration
    Given all eleven canonical workflow upgrade packages have passed their focused checks
    When the CLI bundle is rebuilt and checked
    Then every canonical definition has a quoted non-empty version and a recorded upgrade outcome
    And unversioned external definitions remain supported
    And retired baseline assets are absent from generated package output
    And canonical skills, templates, authority, and derived contracts describe the implemented behavior

  @core
  Scenario: R12 — Savings are measured against comparable verified outcomes
    Given matched before and after inputs for the affected workflows
    When rollout evidence is collected
    Then invocation counts, elapsed time, and output volume are recorded with source provenance
    And measured tokens and costs remain unknown where unavailable
    And no dry run is counted as a real verified outcome
    And applicable lint, type, test, rule, and task verification results remain explicit
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0765 | Make essential completion checks explicit without blanket strictness | done |
| 0766 | Retire routine corpus sweeps and suppression-based acceptance | todo |
| 0767 | Replace composition mirrors with live workflow facts and behavior checks | todo |
| 0768 | Unify workflow plan identity and readable execution progress | todo |
| 0769 | Upgrade planning and evidence workflows without structural ceremony | todo |
| 0770 | Upgrade lifecycle and wrapup workflows with truthful outcomes | todo |
| 0771 | Upgrade example, history and PR-review workflow behavior | todo |
| 0772 | Complete the final task-pipeline and packaged workflow rollout | todo |
| 0773 | Audit and migrate config/corpus-baseline.json | todo |
| 0774 | Migrate CLI/fallback accepted callers and dependent fixtures | todo |
| 0775 | Delete corpus/composition baselines and snapshot tests | todo |
<!-- END AUTO-GENERATED -->

## Notes

Approved by Robin after discovery; the same approved Design Summary governs the implementation package.

- Decision: ADR-108 (accepted design; implementation pending).
- Design: `docs/design/essential-workflow-checks.md`.
- Evidence and corrections: `docs/plans/2026-09-04-workflow-upgrade-brainstorm.md`.
- Parent D6 owns workflow cost; D8/D9 remain completed prerequisites with Option B unchanged.
- `bun run corpus-check` remains an explicit diagnostic after task 0775 (deferred from the original 0766), with essential-error failure, advisory document warnings, no baseline suppression and no automatic iteration/wrap/ordinary-commit sweep.
- Task 0723 remains the owner of doctor-free precheck. Task 0772 inspects and consumes its result before beginning, rather than duplicating its implementation.

**Scenario-to-task mapping (current):**

- **R2 — Routine work does not scan the whole corpus.** Plan coverage via 0766 (R1) and 0775 (R3 — T10/T11 application); classification phase is 0773 (audit + repaired corpus; ac_altitude=task-local so the task does not formally register as a feature ship criterion).
- **R3 — Explicit corpus audits remain useful without suppressions.** Plan coverage via 0766 (R2) and the decomposed chain 0773 → 0774 → 0775; classification, caller migration, and snapshot deletion are the three phases respectively (ac_altitude=task-local).
- **R4 — Baseline retirement preserves useful consumers.** Plan coverage via 0767 (R1) and 0775 (R1 — snapshot deletion, R2 — focused behavior tests); the JSON compatibility fixture stays.
- All other scenarios (R1, R5–R12) continue to be covered 1:1 by the original 0765/0768/0769/0770/0771/0772 chain; the decomposition does not change their coverers.

**Implementation order (encoded in `dependencies[]`):** 0765 first; 0773 after 0765 (audit + repaired corpus); 0774 after 0773 (caller migration + fixtures); 0775 after 0774 (snapshot + script removal + template/plugin/wrapup default); 0767/0768 after 0775; 0769/0770 after 0775/0767/0768; 0771 after 0767/0768; 0772 last after 0769/0770/0771. Execute sequentially with one writer and one task commit at a time. Task 0766 (original "Retire routine corpus sweeps") is **superseded** by 0773/0774/0775 per the per-fixture remediation plan and remains in `todo` to preserve history — its Solution section directs readers to the three sub-tasks.

Planning handoff: eleven task readiness checks PASS (0765 done; 0766–0775 todo with structural readiness met via the decomposition; 0767, 0768, 0769, 0770, 0771, 0772 still blocked on their upstream chain); all twelve feature scenarios have task coverage. Unverified scenario warnings are expected until implementation obtains real PASS evidence. No task has been implemented or certified by this planning run beyond 0765 (which is `done`).

Next command: `/sp:dev-runall --feature D61 --auto` (the decomposition resolves the previous batch halt at 0766; the new chain drives 0773 → 0774 → 0775 first, then 0767/0768 in parallel, then 0769/0770/0771, then 0772 last).

## History
