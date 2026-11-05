---
schema_version: 1
name: Generate offline migration embedding from verified authoritative SQL
status: blocked
template: feature-impl
created_at: 2026-11-05T20:01:23.920Z
updated_at: "2026-11-05T20:38:16.783Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A331
priority: P3
tags:
  - simplification-2026-11
  - w7
  - conditional
estimate_hours: 8

dependencies: ["1311"]
---

## 1312. Generate offline migration embedding from verified authoritative SQL

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W7; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A331: Offline migration embedding shares an authoritative source without rewriting history.

Owned surfaces/callers/fixtures/config/docs: the verified migration embedding source and build consumer selected by ownership evidence; packages/domain/src/migrations.ts; CLI bundle generators; fresh/upgrade/offline fixture tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Freeze one static mirror as a safe generation pilot instead of waiting for unspecified upstream SQL exports. All migration control flow and other mirrors remain unchanged.
- Verified source seams: `packages/domain/src/migrations.ts:1305`; `packages/domain/src/migrations.ts:1553`; `scripts/commands/build-cli.ts:32`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Offline migration embedding shares an authoritative source without rewriting history; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Generate offline migration embedding from verified authoritative SQL

  Scenario: AC1 — Offline migration embedding shares an authoritative source without rewriting history (req: R1)
    Given a recorded go decision and approved authoritative SQL ownership
    When build-time embedding and fixture upgrades use the consolidated source
    Then released identifiers and checksums remain unchanged, guarded upgrades remain idempotent and the binary works without source files
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:23.254Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Requires a recorded go decision and available compatible authoritative SQL source; remain backlog for unavailable upstream exports or unapproved dependency changes.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:16.493Z

Deferred owner: task 1311 decides measured safety/benefit. The generator source, target and pilot migration are fixed.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. The only scheduling gate is the explicitly named prerequisite artifact; remain blocked until its current positive result exists.

### Design

#### Frozen implementation contract

Entry condition is current positive 1311 artifact for 0037-dimension-marts. New repo-internal scripts/commands/emit-migration-sql.ts reads existing drizzle/0037_spur_cli_history_dimension_marts.sql and deterministically emits a tracked packages/domain/src/migration-sql.generated.ts string export; no runtime filesystem read or upstream dependency. The current migrations.ts keeps its public HISTORY_DIMENSION_MARTS_SCHEMA_SQL export by importing/reexporting the generated constant. Keep existing CLI_MIGRATIONS ID/guard objects and applyCliMigrations branches unchanged. Hook generation/check into existing CLI build/bundle entrypoints without adding public verbs or editing CI workflows; generated source is available for source-run tests. The released .sql bytes never change. Compare SQL semantics and fixture schemas, and report any harmless raw whitespace/comment differences from old embedding explicitly. Expand to other mirrors only in later scoped work.

#### Dependencies and handoff

Direct prerequisites: 1311. 1311 supplies current go evidence for 0037; no external go decision or unidentified upstream export remains.

Output/handoff: Public migration exports, IDs and runtime guards remain compatible; generated text is one static pilot.

#### Boundaries and verification

(cd packages/domain && bun test tests/dao/migrations.test.ts); add scripts/commands/emit-migration-sql.test.ts; run the required CLI bundle/relink checks only during implementation. Save IDs, SQL hashes, fixture schema comparison and offline binary result.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Require the current positive 0037 evidence artifact; absent/no-go/stale input keeps this task blocked.
- [ ] 2. Write deterministic generation/stale-artifact and schema/guard parity proofs before changing the export.
- [ ] 3. Generate the one constant, preserve its facade, remove its handwritten twin and wire existing build paths.
- [ ] 4. Verify source-free binary startup and all historical fixture upgrades without touching real DBs.
- [ ] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:22.957Z todo → blocked (system)

