---
schema_version: 1
id: "D9"
name: "Workflow seam stabilization and proportional gate rollout"
status: backlog
priority: P1
tags: []
created_at: "2026-09-03T20:25:50.515Z"
updated_at: "2026-09-03T21:13:05.937Z"
---

# D9: Workflow seam stabilization and proportional gate rollout

## Goal
Execute the approved D8 strategy (`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md`,
APPROVED 2026-09-03, Option A): repair the shared cross-surface seams that make workflow gates
report untrustworthy results, repair the derived-doc and baseline drift that makes the corpus and
surface gates lie, then — only if a post-S0 re-measure clears 0730 §G's sufficiency rule — validate
proportional routing on the two real-caller surrounding workflows and migrate `task-pipeline` last.

**What reaching the end looks like**

- Every R3 seam defect (F-1…F-9, F-14, run/continue/validate divergence, paused-progress resume) is
  repaired at the one seam all callers route through, each with an executable regression test.
- Proof is fail-closed: no git failure, missing task spec, or stale verifier artifact can produce a
  PASS. Run IDs cannot escape their confinement directory.
- The corpus, composition, budget, surface-drift, and script-contract gates are green on regenerated
  snapshots with ADR-093 waiver fields, and carry no inert fields.
- Authority docs describe what is actually built; ADRs 051/069/071/093/098/099/100/102 carry their
  amendments.
- The inline pipeline driver has a single owner and an executable parity check against
  `task-pipeline.yaml` — no silent second interpreter.
- Workflow `version` is an optional, behavior-neutral, non-empty opaque literal in both dialects,
  with an empty-value diagnostic and no registry.
- Either proportional routing is proven on `wrapup-pipeline` + `task-lifecycle` with ≥5 real terminal
  runs each and ≥80% run-scoped cost coverage and then applied to `task-pipeline`, **or** the
  re-measure fails its bar and the feature closes at Option B with that verdict recorded.
## Scope
**In scope**

- Slice S0 — shared-seam stabilization: `packages/app/src/workflow/actions/command-gate.ts`,
  `proof-input-fingerprint.ts`, `run-artifact.ts`, `packages/app/src/services/workflow-service.ts`
  (`continuePaused` digest binding, shared resolve/preflight), `apps/cli/src/commands/workflow.ts`
  (`makeSvc` spurConfig threading, run-id validation), `make-lifecycle-adapter.ts` source precedence,
  `config/workflows/task-pipeline.yaml` lookup/expectFile hops, `config/workflows/feature-dev.yaml`
  nested review, and dry-probe escalation-packet suppression.
- Slice S1 — authority/derived-doc + baseline repair: `docs/03_ARCHITECTURE.md` §24,
  `docs/04_DESIGN.md` capability-attestation label + ADR-094–100 design sections,
  `docs/design/workflow-observability.md`, `docs/design/workflow-composition-contract.md`,
  `docs/00_ADR.md` amendments, corpus + composition baseline regeneration under ADR-093 waiver
  fields, `config/pipeline-budgets.json` docs-pipeline FIX, `regen-corpus-baseline` package.json
  entry, ADR-051 surface-inventory refresh + mechanical placement check.
- Slice S2 — inline-driver ownership and an executable parity check against `task-pipeline.yaml`.
- **Re-measure gate** — re-run the 0730 measurement after S0; decide Option A continuation vs the
  Option B stop.
- Slice S3 (conditional on the re-measure) — proportional route table on `config/workflows/wrapup-pipeline.yaml`
  and `config/workflows/task-lifecycle.yaml`, run-scoped cost importer, verified-outcome binding fix.
- Slice S4 — optional workflow-version contract in both dialect schemas.
- Slice S5 (conditional on S3) — `config/workflows/task-pipeline.yaml` proportional migration, last.

**Out of scope**

- Re-opening the D8 strategy itself; it is frozen. Revisions go through a new decision, not this
  feature.
- F-10 (whole-worktree Solution attribution) — non-live under single-task worktrees; re-opens only if
  shared-tree execution returns.
- A second workflow engine, a generalized policy DSL, a workflow-version registry, a semantic-version
  parser, or a model judge.
- Making workflow `version` mandatory in the current major release.
- Retiring `wayfinder-resolution` or `basic` — D8 decisions D2/D8 demote, and deletion needs an
  explicit operator delete.
- Any public `spur` noun/verb change without a separate ADR-051 consent decision.
- Project/Workspace/Inbox/Teams consolidation.
- Weakening trust-boundary validation, path confinement, secret handling, or proof integrity —
  the safety floor is immutable (plan §4.2).
## Acceptance Criteria
```gherkin
Feature: Workflow seam stabilization and proportional gate rollout

  Scenario: A command gate timeout actually fires
    Given a workflow step whose command.gate declares a timeoutMs
    And a command that runs longer than that deadline
    When the step executes
    Then the process is terminated at the deadline
    And the step does not report PASS

  Scenario: Proof fingerprinting fails closed on a git failure
    Given a proof-input fingerprint computation whose git invocation fails
    When the fingerprint is requested
    Then the computation reports an error
    And no empty-tree digest is produced
    And no downstream step records a verified PASS from it

  Scenario: A resumed run is bound to the exact definition it launched from
    Given a paused workflow run
    And its definition file is edited after the pause
    When the run is continued
    Then the digest mismatch is detected
    And the resume is refused or requires an explicit confirmation

  Scenario: Run IDs cannot escape their confinement directory
    Given a workflow run invoked with a run ID containing a path separator or traversal segment
    When the CLI parses the invocation
    Then the run ID is rejected before any path is constructed

  Scenario: A missing task spec fails instead of degrading to tree-only proof
    Given a task-pipeline run whose task path lookup returns nothing
    When the proof step executes
    Then the step fails with a named error
    And it does not report a successful lookup

  Scenario: A stale verifier answer cannot satisfy a fresh assertion
    Given a verifier answer file left behind by a previous run
    When a new run asserts on that artifact
    Then the assertion reads only an artifact produced by the current run

  Scenario: Dry probes emit no human-inspect escalation
    Given a dry-run sweep across the shipped workflow definitions
    When the sweep completes
    Then no escalation packet is emitted for a dry probe

  Scenario: The corpus and composition gates are green on regenerated snapshots
    Given the regenerated corpus and composition baselines
    When the project check runs
    Then the corpus, composition, budget, surface-drift, and script-contract gates all pass
    And the corpus snapshot carries ADR-093 owner, review-date, and removal fields
    And no inert per-workflow field remains in the composition baseline

  Scenario: The inline driver cannot silently diverge from the engine pipeline
    Given the inline pipeline driver reference and task-pipeline.yaml
    When the parity check runs
    Then any action or guard present in one and absent in the other is reported as a failure

  Scenario: An unversioned workflow keeps working and an explicit version is observable
    Given one workflow definition with no version field and one with a non-empty version literal
    When each is validated and run
    Then both execute identically
    And the first is reported as unversioned and the second as its explicit literal
    And their definition digests differ

  Scenario: An empty version value is rejected with a diagnostic
    Given a workflow definition declaring an empty-string version
    When it is validated
    Then validation fails with a diagnostic naming the empty value

  Scenario: The re-measure decides whether proportional routing is built
    Given slice S0 has landed
    When the 0730 measurement is re-run against the refreshed database
    Then the run-scoped cost coverage and real terminal run counts are recorded
    And exactly one disposition is recorded: continue to S3, or close at the Option B boundary

  Scenario: A proportional route always resolves and never trades the safety floor
    Given a piloted workflow carrying the closed route table
    When any input including missing, unknown, or conflicting evidence is routed
    Then exactly one route is selected
    And unknown or conflicting evidence selects the safety path
    And a bounded reason is written for the run
    And no proof-bracket guard, budget fail-closed dispatch, reviewer-independence check, or run-id confinement is bypassed by any route
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->

## Notes
### Authority

Implementation vehicle for the **approved** D8 decision packet:
`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` (APPROVED 2026-09-03, Option A,
all D1-D8 defaults accepted). The packet is frozen — read it for the matrices, defect register
anchors, ADR map, and per-slice rollback boundaries rather than restating them here.

Evidence artifacts behind the packet: `docs/inventory/d8-0729-workflow-contract-inventory.md`,
`docs/analysis/d8-0730-workflow-cost-attention-measurement.md`,
`docs/inventory/d8-0731-workflow-fit-classification.md`,
`docs/analysis/d8-0732-proportional-gate-prototype.md`.

### Slice order and gates

```text
S0 ─┬─> S2 ──> (re-measure) ──> S3 ──> S5
    ├─> S4
S1 ─┘
```

- **S0** and **S1** have no dependency on each other and may run in parallel.
- **S2** and **S4** depend on S0 only.
- **Re-measure gate** sits between S0 and S3, and is a real decision point, not a formality: if real
  terminal runs and run-scoped cost coverage stay thin, the feature stops at Option B and S3/S5 are
  never built. Recording that verdict is a completion path, not a failure.
- **S5** is last and touches the canonical pipeline.

### Consent gates carried from the packet

S1 (corpus/baseline regeneration + surface-inventory refresh), S3 (surrounding workflow routing), and
S5 (task-pipeline routing) each need operator sign-off at execution time. S0, S2, and S4 are internal
or behavior-neutral and do not.

### Deferred to slice execution

Two P3 findings from the 0733 review are carried here rather than into the frozen packet: the
ADR-094/102 relationship should be stated explicitly when S1 writes the ADR amendments, and the
Option A/B "affected ADRs" summary lines under-report the §6 matrix by two ADRs each (051, 098). The
§6 matrix is authoritative on both counts.
## History
