---
schema_version: 1
name: Remove unsupported runtime registration promises from the Board registry
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-07T01:19:20.287Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A8
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 3

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1315-verdict.json
---

## 1315. Remove unsupported runtime registration promises from the Board registry

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A8: Board extension operations no longer promise unsupported registration.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/registry.ts and tests/modules/registry.test.ts; registry callers, contribution composition and public Board declaration exports; configured React/iframe fixture tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E3 D1 L2 C0 R1 = 7. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The current caller search finds only registry implementation/exports and its tests. The public Board declaration source is contribution.ts, not Registry. Freeze removal of the unused internal method rather than leaving a compatibility choice to implementation.
- Verified source seams: `apps/web/src/modules/registry.ts:20`; `apps/web/tests/modules/registry.test.ts:90`; `scripts/commands/emit-board-types.ts:20`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Board extension operations no longer promise unsupported registration; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Remove unsupported runtime registration promises from the Board registry

  Scenario: AC1 — Board extension operations no longer promise unsupported registration (req: R1)
    Given the runtime registration stub, its caller inventory and configured contribution fixtures
    When the extension surface is simplified using the existing composition owner
    Then no callable operation silently claims a rescan and supported configured React and iframe contributions retain their behavior and compatibility
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:22.805Z

Closed: remove the unused internal operation. A newly introduced production consumer is source drift, not an open design option.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Remove registerModuleRoot from Registry, createRegistry return, and the module-level export; remove only the two tests asserting a no-op. Do not change disableModule/enableModule/order/default behavior or contribution composition. Update comments/docs that promise runtime rescans. Recheck public declaration source and production callers at implementation start; if a new real consumer has appeared, stop and report drift instead of making an unrequested break. Do not build a replacement loader. No dependency on transport task 1300.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent internal cleanup; no public contribution ABI change.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts); run declaration emit check and typecheck. Use installed Board fixtures where required, not a new loader.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write a compatibility proof of current registry operations and configured React/iframe composition before deleting the stub.
- [x] 2. Reconfirm only tests consume registerModuleRoot and the public Board declaration does not expose it.
- [x] 3. Remove the inert method/exports/no-op tests and stale promise; verify no unresolved imports and unchanged contributions.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Implemented R1 / AC1: removed the unused runtime registration stub after reconfirming that only its two no-op tests called it. No replacement loader or contribution ABI change.

- `apps/web/src/modules/registry.ts:33` — removed registerModuleRoot from Registry, the createRegistry return object and module-level exports, including the false immediate-rescan promise. Existing validation, enable/disable, ordering and default selection remain intact.
- `apps/web/tests/modules/registry.test.ts:25` — replaced the two no-op tests with a regression assertion that neither a registry instance nor its module namespace advertises runtime registration. Observed this assertion fail before the production change.
- `apps/web/tests/modules/compose.test.ts:65` — added a compatibility journey before changing production code: configured React and iframe entries compose with built-ins, render, retain native right panels and metadata, preserve ordering/default selection, and survive disable/re-enable in a different order with component identity intact. This passed before and after removal.
- `docs/help/how_to_add_a_new_ui_module.md:152` and `docs/design/downstream-board-modules.md:22` — replaced stale stub guidance with configured composition and the restart/reload boundary (constitution T3). No index pointer or architecture boundary changed.
- `scripts/commands/emit-board-types.ts:20` and `apps/web/src/modules/contribution.ts:18` — rechecked the existing public declaration owner; it does not expose Registry. Declaration parity tests confirm the generated artifact is unchanged.

Targeted validation performed in this implement stage (full pipeline gate/review remain with the parent):

1. `(cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1315/before-removal.xml)` — before production edits: 38 pass, 1 expected failure on the advertised runtime registration method; compatibility journey passed.
2. `(cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1315/focused.xml)` — 50 pass, 0 fail; includes a fresh production-shaped Astro Board build.
3. `(cd scripts && bun test commands/emit-board-types.test.ts --reporter=junit --reporter-outfile=../.spur/run/1315/declarations.xml)` — 4 pass, 0 fail; committed declarations match compiler output.
4. `bun run --filter @gobing-ai/spur-web typecheck` — exit 0.
5. `bunx biome check --write apps/web/src/modules/registry.ts apps/web/tests/modules/registry.test.ts apps/web/tests/modules/compose.test.ts` — formatted the removals; subsequent light-gate format/lint PASS. `git diff --check` passed.
6. `bun apps/cli/src/index.ts task gate 1315 light` — receipt status FAIL despite CLI exit 0. Format/lint, all 51 pre-check rules, web typecheck and 37 related tests PASS. Post-check coverage provenance could not capture the tested tree: sandbox denied the temporary Git object write during git add -A (Operation not permitted). This is not a coverage certification or gate PASS. Receipt: .spur/run/1315-check-receipt.json; detailed log: .spur/run/1315-light-gate.log.
7. Targeted caller/docs search found no remaining registerModuleRoot references in production source, declaration emitter, help or design owners. `bun apps/cli/src/index.ts task check 1315 --json` passed before evidence writes.

Repeatable JUnit receipts and command logs are retained under .spur/run/1315/. Coverage certification, full gate and review remain pending with the parent pipeline. No real-browser journey was run in this implement stage. Git writes needed for a commit are unavailable under this sandbox; source changes remain a reviewable diff, with the starting task Design note preserved.

probe: not-applicable (no public surface changed)

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/registry.ts:6` and `apps/web/src/modules/registry.ts:33` remove the unsupported operation; `apps/web/tests/modules/registry.test.ts:25` rejects its presence on instances and exports; `apps/web/tests/modules/compose.test.ts:65` proves configured contribution compatibility. Fresh focused check: 50 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Board extension operations no longer promise unsupported registration (req: R1) | MET | test | `apps/web/tests/modules/registry.test.ts:25` proves no callable registration stub; `apps/web/tests/modules/compose.test.ts:65` exercises configured React/iframe composition, rendering, metadata, ordering, defaults and disable/re-enable identity. `apps/web/tests/modules/runtime-distribution.test.ts:51` verifies a fresh distribution; `scripts/commands/emit-board-types.test.ts:18` verifies unchanged public declarations. Fresh focused/declaration checks: 50 + 4 pass, 0 fail; web typecheck exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1315

**Scope:** Working-tree diff against `4c9a06e42`; no implementation commit tagged (1315). Reviewed five implementation/test/documentation files; the task record supplies requirements and design context.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | functional / SECUA / architecture | No P1–P3 findings: the unused registration stub is removed; existing composition, validation, ordering, defaults and toggles remain intact. Regression and compatibility tests cover R1/AC1. | `apps/web/src/modules/registry.ts:6`; `apps/web/tests/modules/registry.test.ts:25`; `apps/web/tests/modules/compose.test.ts:65` | ACCEPTED |

##### Verification

- Fresh focused check: `(cd apps/web && bun test tests/modules/registry.test.ts tests/modules/compose.test.ts tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts)` — exit 0; 50 pass, 0 fail, including a fresh Board distribution build. Repeatable JUnit: `.spur/run/1315/review-focused.xml`.
- Fresh declaration check: `(cd scripts && bun test commands/emit-board-types.test.ts)` — exit 0; 4 pass, 0 fail. Repeatable JUnit: `.spur/run/1315/review-declarations.xml`.
- Fresh web typecheck: `bun run --filter @gobing-ai/spur-web typecheck` — exit 0.
- Existing pipeline full-gate receipt: PASS, 12,476 pass / 0 fail; registry function/line coverage 100%; coverage provenance and post-check rules passed. Evidence: `.spur/run/1315-check-receipt.json:16`; `.spur/run/1315-test-gate.log:256`; `.spur/run/1315-test-gate.log:646`. This supersedes the implementation-stage light-gate failure; the full gate was inspected, not rerun here.
- Caller sweep across apps, packages, plugins, scripts, config and current help/design owners found only the two negative assertions in `apps/web/tests/modules/registry.test.ts:26`. Public declarations remain contribution-owned at `scripts/commands/emit-board-types.ts:20`, with parity checked at `scripts/commands/emit-board-types.test.ts:18`.
- Documentation now states configured composition and the unsupported rescan boundary: `docs/help/how_to_add_a_new_ui_module.md:152`; `docs/design/downstream-board-modules.md:22`.
- No real-browser journey was run during this review. Static rendering and production distribution checks cover this internal removal; no visual behavior changed.

**Next:** Continue the parent pipeline's certification and record steps.
Confidence: MEDIUM

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/registry.ts:6` and `apps/web/src/modules/registry.ts:33` remove the unsupported operation; `apps/web/tests/modules/registry.test.ts:25` rejects its presence on instances and exports; `apps/web/tests/modules/compose.test.ts:65` proves configured contribution compatibility. Fresh focused check: 50 pass / 0 fail. |

##### Acceptance Evidence

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Board extension operations no longer promise unsupported registration (req: R1) | MET | test+command | `apps/web/tests/modules/registry.test.ts:25` proves no callable registration stub; `apps/web/tests/modules/compose.test.ts:65` exercises configured React/iframe composition, rendering, metadata, ordering, defaults and disable/re-enable identity. `apps/web/tests/modules/runtime-distribution.test.ts:51` verifies a fresh distribution; `scripts/commands/emit-board-types.test.ts:18` verifies unchanged public declarations. Fresh focused/declaration checks: 50 + 4 pass, 0 fail; web typecheck exit 0. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-07T01:12:12.062Z todo → wip (system)
- 2026-11-07T01:19:18.002Z wip → testing (system)
- 2026-11-07T01:19:20.268Z testing → done (system)

