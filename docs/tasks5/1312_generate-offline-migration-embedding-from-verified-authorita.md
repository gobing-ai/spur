---
schema_version: 1
name: Generate offline migration embedding from verified authoritative SQL
status: testing
template: feature-impl
created_at: 2026-11-05T20:01:23.920Z
updated_at: "2026-11-07T07:17:05.354Z"
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

- [x] R1. Offline migration embedding shares an authoritative source without rewriting history; implement the exact Given/When/Then contract below.

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

- [x] 1. Require the current positive 0037 evidence artifact; absent/no-go/stale input keeps this task blocked.
- [x] 2. Write deterministic generation/stale-artifact and schema/guard parity proofs before changing the export.
- [x] 3. Generate the one constant, preserve its facade, remove its handwritten twin and wire existing build paths.
- [x] 4. Verify source-free binary startup and all historical fixture upgrades without touching real DBs.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Entry condition was met: `docs/reports/1311-migration-ownership.json` records candidate `0037-dimension-marts`, status `go`.

- New repo-internal `scripts/commands/emit-migration-sql.ts`:
  - Reads `drizzle/0037_spur_cli_history_dimension_marts.sql`.
  - Deterministically emits the tracked `packages/domain/src/migration-sql.generated.ts`: a template literal with `\`, backtick and `${` escaped.
  - Writes only when the content changed.
- `packages/domain/src/migrations.ts:8,1293` imports and re-exports `HISTORY_DIMENSION_MARTS_SCHEMA_SQL`.
  - The handwritten twin is removed.
  - The `CLI_MIGRATIONS` IDs, guards and `applyCliMigrations` branches are unchanged.
- Wiring:
  - `scripts/spur-dev.ts` gains the `emit-migration-sql` case.
  - `apps/cli/package.json` `build:bundle` runs it before `bun build`.
  - No public verb and no workflow edit.
- Docs: `docs/03_ARCHITECTURE.md` §8.1 rule 5 and the `docs/design/sdlc-actions.md` L1 row are updated.
- Raw-byte difference from the old embedding, reported explicitly:
  - The old constant started with `\n` and kept the 12-line header comment in JSDoc. Its sha256 was `34d7b3…`.
  - The generated constant is the released file verbatim, header comment included. Its sha256 is `bbbd92…`, equal to the tracked file.
  - The normalized SQL hash `249811…` is unchanged, and the applied schema is equal.
  - The comment contains no `;`, so `splitSqlStatements` is unaffected.
- The 1311 proof gains a consumed-decision branch:
  - The frozen report must be authentic at its revision.
  - The live embedding must equal the tracked bytes, with the same normalized SQL.
  - `drizzle/` must be clean.
  - Every other field stays frozen.
- Handwritten source delta: `migrations.ts` +3/−58 (twin removed); the generator is 43 lines and the generated module 59.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/emit-migration-sql.ts:23` deterministic escaped render of `drizzle/0037_spur_cli_history_dimension_marts.sql`; `packages/domain/src/migrations.ts:8` imports the generated constant and `packages/domain/src/migrations.ts:1293` re-exports it (twin removed, IDs/guards unchanged); `apps/cli/package.json:53` `build:bundle` runs `emit-migration-sql`; `packages/domain/tests/dao/migration-ownership.test.ts:886` consumed-decision branch: embedded sha256 == tracked `bbbd92…`, normalized `249811…` unchanged, `drizzle/` clean; live proof `.spur/run/1312-migration-ownership-live.json` 55 ids 0000…0054, six guard fixtures pass, schemaEqual, offline bundle pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Offline migration embedding shares an authoritative source without rewriting history | MET | test | `scripts/commands/emit-migration-sql.test.ts:28` committed module equals the render; `scripts/commands/emit-migration-sql.test.ts:33` export carries released bytes verbatim; `scripts/commands/emit-migration-sql.test.ts:46` escaping round-trip (mutation dropping `${` escape fails it); `packages/domain/tests/dao/migration-ownership.test.ts:643` fresh/already-applied/previous-release/interrupted/duplicate/absent fixtures and source-free bundled CLI migrate; `.spur/run/1312-domain.junit.xml` 74/0, `.spur/run/1312-generator.junit.xml` 9/0 — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:22.957Z todo → blocked (system)
- 2026-11-07T07:07:49.268Z blocked → todo (system)
- 2026-11-07T07:07:49.483Z todo → wip (system)
- 2026-11-07T07:17:05.354Z wip → testing (system)

