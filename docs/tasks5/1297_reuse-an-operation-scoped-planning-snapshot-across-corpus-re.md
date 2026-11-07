---
schema_version: 1
name: Reuse an operation-scoped planning snapshot across corpus readers
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.913Z
updated_at: "2026-11-07T06:50:40.444Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F22
priority: P1
tags:
  - simplification-2026-11
  - w1
  - approved
estimate_hours: 8

dependencies: ["1296"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1297-verdict.json
---

## 1297. Reuse an operation-scoped planning snapshot across corpus readers

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W1; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F22: Corpus snapshots preserve identifiers and cross-folder relationships.

Owned surfaces/callers/fixtures/config/docs: packages/app task-query/feature/check services; TaskLocator; MarkdownDocument consumers; packages/app planning fixture tests; owning planning contracts and architecture.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Snapshot reuse needs an operation boundary and frozen shape. A singleton/request-spanning cache would change freshness; use an explicitly passed snapshot and keep original public service signatures.
- Verified source seams: `packages/app/src/services/task-query-ops.ts:119`; `packages/app/src/services/feature-service.ts:906`; `packages/app/src/services/task-locator.ts:91`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Corpus snapshots preserve identifiers and cross-folder relationships; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reuse an operation-scoped planning snapshot across corpus readers

  Scenario: AC1 — Corpus snapshots preserve identifiers and cross-folder relationships (req: R1)
    Given registered task folders with aliases, duplicate identifiers, and cross-folder dependencies
    When one operation builds and reuses its parsed snapshot
    Then each relevant file is parsed once and duplicate identifiers and dependencies remain visible with actionable diagnostics
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:44.493Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal services/planning-snapshot.ts exports readPlanningSnapshot({fs, taskDirs, featuresDir?}) and PlanningSnapshot {tasks,features,tasksByWbs,tasksByFeature,dependenciesByWbs,diagnostics,complete}. Record entries contain path, raw, parsed MarkdownDocument and metadata; duplicate WBS produce diagnostics instead of map overwrite. Use taskMetadata for alias/feature-edge normalization. Read each selected file once and reuse within feature refresh, syncAll and check operations; optional private parameters carry the snapshot. Strict public list/derive paths call an assert-complete helper producing the 1296 error. Do not retain snapshots on service instances or reuse after a write; construct a fresh operation snapshot for the next transition/refresh.

#### Dependencies and handoff

Direct prerequisites: 1296. 1296 supplies all-or-error list/derive behavior and PlanningReadError; do not reopen its successful transport contracts.

Output/handoff: 1302 consumes the internal snapshot and existing check results; no public snapshot DTO is promised.

#### Boundaries and verification

(cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/feature-check.test.ts tests/services/task-check.test.ts); add tests/services/planning-snapshot.test.ts with instrumented fs counts and CLI/HTTP golden outputs.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [x] 1. Write read/parse-count and cross-folder/duplicate-ID golden fixtures before introducing the helper.
- [x] 2. Implement operation-scoped snapshot creation using existing locator folder order and parser.
- [x] 3. Migrate one complete feature refresh/syncAll/check operation at a time, deleting its old scan and preserving stable public outputs.
- [x] 4. Prove a subsequent read after mutation sees new bytes and no persistent cache or second authority exists.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

| File | What changed and why |
| --- | --- |
| `packages/app/src/services/planning-snapshot.ts:1-180` | New internal readPlanningSnapshot parses each selected task/feature file once, groups by WBS/feature and dependencies, and records duplicate identifiers as diagnostics rather than overwriting maps. |
| `packages/app/src/services/planning-snapshot.ts:44-52` | assertPlanningSnapshotComplete refuses lifecycle derivation on an ambiguous snapshot using the 1296 PlanningReadError. |
| `packages/app/src/services/feature-service.ts:303-340` | list() now delegates to the snapshot's parsed feature records so one operation reuses them instead of re-reading. |
| `packages/app/src/services/feature-service.ts:455-530` | deriveFeatureStatus takes an optional operation snapshot and reuses it for feature/task reads while still validating the same inputs. |
| `packages/app/src/services/feature-service.ts:874-900` | syncAllFeatures builds one snapshot for the whole sweep and passes it into each feature's sync instead of rescanning per feature. |
| `packages/app/src/services/feature-service.ts:393-440` | refresh() consumes the same snapshot for INDEX and Tasks regions. |
| `packages/app/src/services/feature-check.ts:236-330` | check() reuses the snapshot's parsed feature document and task records for L1/L4 unless --fix mutates the tree. |
| `packages/app/tests/services/planning-snapshot.test.ts:1-82` | Parse-count, duplicate-WBS/feature diagnostics and mutation-freshness proofs. |
| `packages/app/tests/services/feature-service.test.ts:295-320` | syncAll over two features reads each selected corpus file exactly once. |

Verification evidence:
- `(cd packages/app && bun test tests/services/planning-snapshot.test.ts tests/services/feature-service.test.ts tests/services/feature-check.test.ts tests/services/task-query-ops.test.ts tests/services/task-check.test.ts)` — 436 pass, 0 fail.
- `(cd packages/app && bun test tests/services/planning-snapshot.test.ts tests/services/feature-service.test.ts tests/services/feature-check.test.ts)` — 213 pass, 0 fail after the final typecheck fixes.
- `bun run --filter @gobing-ai/spur-app typecheck` — exit 0; all 51 pre-check rules passed.
- Light gate: format, pre-rules, app typecheck and related tests PASS; post-check coverage provenance is deferred to the pipeline's canonical full gate.
- Freshness: snapshot.test proves a second operation after a write sees the new bytes; no snapshot is retained on a service instance.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/planning-snapshot.ts:72` `readPlanningSnapshot` parses the corpus once; `packages/app/src/services/feature-service.ts:874-876` `syncAllFeatures` reuses one snapshot; `packages/app/tests/services/planning-snapshot.test.ts:24-26` duplicate IDs retained with diagnostics; packages/app focused run 268 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Corpus snapshots preserve identifiers and cross-folder relationships (req: R1) | MET | test | `packages/app/tests/services/planning-snapshot.test.ts:26` duplicate IDs and cross-folder links; `packages/app/tests/services/feature-service.test.ts:295` snapshot sync across features; 268 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1297
**Scope:** operation-scoped planning snapshot plus feature list/derive/refresh/syncAll/check wiring
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence: MEDIUM**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | The snapshot is passed explicitly and never cached on the service; post-write paths (`refresh` in sync's finally, `--fix`) build a fresh one. This is the intended freshness boundary, not a second authority. | `packages/app/src/services/feature-service.ts:837-920` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/planning-snapshot.ts:72-180` parses each selected file once and keeps duplicates as diagnostics; `packages/app/src/services/feature-service.ts:874-920` builds one snapshot per syncAll sweep; `packages/app/tests/services/planning-snapshot.test.ts:24-82` and `packages/app/tests/services/feature-service.test.ts:295-320` prove parse-once, duplicate visibility and mutation freshness. |

**Next:** close through record/done; the accepted P4 records the deliberate freshness boundary.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T00:17:39.546Z todo → wip (system)
- 2026-11-06T00:22:21.161Z wip → testing (system)
- 2026-11-06T00:22:24.071Z testing → done (system)

