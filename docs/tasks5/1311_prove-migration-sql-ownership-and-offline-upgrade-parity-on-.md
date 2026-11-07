---
schema_version: 1
name: Prove migration SQL ownership and offline upgrade parity on fixtures
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-07T06:53:30.563Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A331
priority: P3
tags:
  - simplification-2026-11
  - w7
  - conditional
estimate_hours: 6

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1311-verdict.json
---

## 1311. Prove migration SQL ownership and offline upgrade parity on fixtures

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W7; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A331: Migration ownership evidence decides whether embedding consolidation is safe.

Owned surfaces/callers/fixtures/config/docs: packages/domain/src/migrations.ts; active drizzle migrations; installed engine schema SQL exports; CLI build embedding and migration fixture tests; vendors and legacy reference remain read-only.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The runtime migration journal records id and applied_at, not SQL checksums. Preserve hashes as audit evidence, not a fictitious enforced DB field. Remove the W6 UI dependency; fixture evidence is runnable now.
- Verified source seams: `packages/domain/src/migrations.ts:1407`; `packages/domain/src/migrations.ts:2046`; `packages/domain/src/migrations.ts:1305`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Migration ownership evidence decides whether embedding consolidation is safe; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Prove migration SQL ownership and offline upgrade parity on fixtures

  Scenario: AC1 — Migration ownership evidence decides whether embedding consolidation is safe (req: R1)
    Given fresh, previous-release, migrated, interrupted and duplicate-column database fixtures
    When the current embedded and tracked migration paths are compared without real-data writes
    Then a versioned repeatable artifact inventories SQL ownership, released identifiers and offline behavior and records an explicit go or no-go decision
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:21.467Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Keep backlog pending measured maintenance benefit after W6. This task proves safety and proposes a source; it does not authorize a new dependency or a real database migration.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:14.092Z

Closed: fixture evidence can begin now. Runtime checksums are not invented, and historical SQL is not rewritten.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Evidence-only. Freeze candidate 0037_spur_cli_history_dimension_marts and HISTORY_DIMENSION_MARTS_SCHEMA_SQL. Compare tracked SQL with the embedded constant after SQL-aware whitespace/comment normalization while retaining exact SHA-256 for both originals. Inventory other mirrors but do not propose their migration in this slice. Verify 55 current IDs (0000..0054) from CLI_MIGRATIONS dynamically rather than assuming counts, guard metadata and journal order. Reuse migration fixture suite for fresh/previous/interrupted/already-applied and absent-column cases; no real database. Artifact docs/reports/1311-migration-ownership.md + JSON {schemaVersion:1,candidate:"0037-dimension-marts",status:"go"|"no-go"|"inconclusive",ids,hashes,semanticParity,guardParity,offlineProof,reason}. Go requires unchanged released SQL, semantic equivalence and preserved offline/guard behavior; no upstream dependency change. Both report formats must include sourceRevision (git HEAD), sourceDigests (SHA-256 keyed by each inspected source path), fixture seed and repeatable command; the downstream task rejects evidence if a named source digest changes, even on the same HEAD.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1312 consumes the exact 0037 decision and hashes; no external package release is needed.

#### Boundaries and verification

(cd packages/domain && bun test tests/dao/migrations.test.ts); add a fixture ownership/parity proof and use the existing CLI build path for a disposable source-free smoke when available. Preserve all legacy reference files read-only.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Snapshot migration IDs/guard metadata and exact file/embedded hashes before any proposed change.
- [x] 2. Run fixture upgrade/idempotence and source-free baseline proof, recording binary/runtime/package provenance.
- [x] 3. Publish the fixed candidate decision artifact and explicitly distinguish audit hashes from runtime journal fields.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Evidence only. Production SQL is unchanged. The candidate is `0037-dimension-marts` (`0037_spur_cli_history_dimension_marts` against `HISTORY_DIMENSION_MARTS_SCHEMA_SQL`). Status is `go`. Task 1312 may consume this artifact. This task does not generate SQL.

`packages/domain/tests/dao/migration-ownership.test.ts:153` strips SQL comments and collapses whitespace while quoted strings and identifiers stay literal.
`packages/domain/tests/dao/migration-ownership.test.ts:214` returns `inconclusive` when a source, digest, or bundle measurement is missing, and `no-go` when ids, semantic SQL, applied schema, released SQL cleanliness, dependency manifests, column guards, or the offline smoke fail. This run passed every gate, so the recorded status is `go`.
`packages/domain/tests/dao/migration-ownership.test.ts:570` covers each decision branch, and shows that an unguarded second `ADD COLUMN` on `external_key` throws.
`packages/domain/tests/dao/migration-ownership.test.ts:580` reads the live `CLI_MIGRATIONS` set (55 ids, `0000_spur_cli_foundation` through `0054_spur_cli_inbox_messages_rebuild`), hashes the exact 0037 bytes, compares normalized SQL and the applied `sqlite_master` snapshot, and runs fresh, already-applied, previous-release (stop after `0036`), interrupted (0037 SQL before its journal row), duplicate-column, and absent-column fixtures on in-memory databases.
`packages/domain/tests/dao/migration-ownership.test.ts:378` runs `apps/cli/spur.js migrate --json` in a temp directory that has no drizzle folder and no repository source. The command reported `{"ok":true,"applied":0}` because opening the database migrates first. The journal columns were exactly `id` and `applied_at`: 55 embedded ids plus the `importer_schema@…` ledger row. Audit SHA-256 values stay in the artifact. They are not journal fields.
`packages/domain/src/migrations.ts:1305`, `packages/domain/src/migrations.ts:1407`, and `packages/domain/src/migrations.ts:2046` were read and hashed and left as they are. `drizzle/0037_spur_cli_history_dimension_marts.sql:1` is the tracked twin. The exact SHA-256 values differ because the file starts with a header comment; normalized SQL matches and the applied schema matches. Other mirrors are inventory only: 43 tracked files, 12 embedded-only ids, and 10 normalized mismatches. None of those mismatches is 0037, and this slice proposes no rewrite.

`docs/reports/1311-migration-ownership.md:5` and `docs/reports/1311-migration-ownership.json:4` record `status: go`, source revision `da6484006e41fbe7ed02d16792733acf223f8c65`, source digests, fixture seed `1311-offline-upgrade-v1`, and the regenerate command. `docs/reports/1311-migration-ownership.md:15` and `docs/reports/1311-migration-ownership.json:157` state that audit hashes are not runtime journal fields (`auditOnly: true`, journal columns `id` and `applied_at`).

No authority document in `docs/00`–`docs/05` or `docs/99` changed: no mechanism, public surface, or governance fact changed. The evidence owner is the report pair above.

probe: not-applicable (no public surface changed)

Focused check `(cd packages/domain && bun test tests/dao/migrations.test.ts tests/dao/migration-ownership.test.ts)` exited 0 with 72 pass and 0 fail. Domain typecheck passed. `recommended-pre-check` passed (51 rules) after the source-free spawn stopped reading the parent environment. Light gate receipt `.spur/run/1311-check-receipt.json` is FAIL only on `rules:post`: `coverage-provenance-check` reports a stale tree for the three new paths and names `bun run test:full` as the recovery. That full suite belongs to the pipeline gate, so this implement pass did not run it. Format, pre-check, domain typecheck, and the ownership test passed inside `task gate 1311 light`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/tests/dao/migration-ownership.test.ts:633` publishes the 0037 ownership decision from fixtures; `packages/domain/tests/dao/migration-ownership.test.ts:841` non-candidate mirrors stay inventory-only; `packages/domain/src/migrations.ts:1733` `__spur_cli_migrations` ledger; tracked `docs/reports/1311-migration-ownership.json:3-4` candidate 0037-dimension-marts, status go; `packages/domain/tests/dao/migration-ownership.test.ts:421` `stable()` now drops package versions and `DEPENDENCY_PATHS` (`:45`) digests so a release bump cannot fail the frozen check; domain 11 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Migration ownership evidence decides whether embedding consolidation is safe | MET | test | `packages/domain/tests/dao/migration-ownership.test.ts:594` release bump ignored but a migration SQL change is not; `packages/domain/tests/dao/migration-ownership.test.ts:612` missing measurement inconclusive, failed gate no-go; `packages/domain/tests/dao/migration-ownership.test.ts:624` unguarded duplicate ADD COLUMN fails; `packages/domain/tests/dao/migration-ownership.test.ts:633` decision from fixtures — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1311
**Scope:** working tree at `da6484006e41fbe7ed02d16792733acf223f8c65`, no `(1311)` commit. Untracked proof: `packages/domain/tests/dao/migration-ownership.test.ts`, `docs/reports/1311-migration-ownership.md`, `docs/reports/1311-migration-ownership.json`. `packages/domain/src/migrations.ts` and `drizzle/0037_spur_cli_history_dimension_marts.sql` are unmodified.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 (blocker) | correctness | Frozen equality used to compare git HEAD stored in the report, so the commit that adds the report could not keep the same sourceRevision. `stable()` now drops sourceRevision the same way it drops measuredAt, and the unit test locks two different revisions as equal. Re-read `packages/domain/tests/dao/migration-ownership.test.ts:424` and `packages/domain/tests/dao/migration-ownership.test.ts:560`. | `packages/domain/tests/dao/migration-ownership.test.ts:424` | RESOLVED |
| 2 | P4 (advisory) | correctness | The markdown twin is written only when the JSON report is absent. Later runs compare the JSON document only, so a hand edit of the markdown can drift without failing the ownership test. JSON is the machine contract this slice hands onward. Re-read `packages/domain/tests/dao/migration-ownership.test.ts:826`. | `packages/domain/tests/dao/migration-ownership.test.ts:826` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/tests/dao/migration-ownership.test.ts:248` returns go only after the id set, normalized 0037 SQL, applied schema, clean released SQL, clean dependency manifests, guard fixtures, and the source-free bundle smoke all pass. `packages/domain/tests/dao/migration-ownership.test.ts:841` names fresh, already-applied, previous-release, interrupted, duplicate-column, and absent-column. `packages/domain/src/migrations.ts:1733` journals id and applied_at. `docs/reports/1311-migration-ownership.json:4` records status go. Named check: packages/domain `bun test tests/dao/migration-ownership.test.ts` exited 0 (6 pass, 0 fail). |

**Next:** 1312 may consume `docs/reports/1311-migration-ownership.json`.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:21.178Z todo → blocked (system)
- 2026-11-05T20:38:14.680Z blocked → todo (system)
- 2026-11-06T08:25:57.996Z todo → wip (system)
- 2026-11-06T08:57:28.766Z wip → testing (system)
- 2026-11-06T16:21:25.614Z testing → done (system)

