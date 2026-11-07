---
schema_version: 1
name: Reject incomplete planning inputs before deriving feature state
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.912Z
updated_at: "2026-11-07T06:50:39.698Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F22
priority: P1
tags:
  - simplification-2026-11
  - w1
  - approved
estimate_hours: 6

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1296-verdict.json
---

## 1296. Reject incomplete planning inputs before deriving feature state

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W1; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F22: Incomplete planning input cannot silently drive lifecycle state.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/task-query-ops.ts; packages/app/src/services/feature-service.ts; packages/app/src/services/task-locator.ts; packages/contracts planning read DTOs and CLI/server consumers; associated task/feature service tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C1 R2 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The earlier text called TaskLocator an error-taxonomy precedent but it actually treats ENOTDIR as missing. Keep its unrelated lookup behavior intact here; fail closed at the list/feature-derivation read seam instead. Freeze all-or-error transport now; a tolerant new DTO is not required for containment.
- Verified source seams: `packages/app/src/services/task-query-ops.ts:90`; `packages/app/src/services/feature-service.ts:892`; `packages/app/src/services/task-locator.ts:50`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Incomplete planning input cannot silently drive lifecycle state; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reject incomplete planning inputs before deriving feature state

  Scenario: AC1 — Incomplete planning input cannot silently drive lifecycle state (req: R1)
    Given a done task and an unreadable todo task linked to the same feature
    When CLI or Board reads that feature or derives its status
    Then the failed read is diagnosed and no complete status is inferred from only the readable task
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:42.409Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal PlanningReadError in packages/app/src/errors.ts with readonly path:string and cause:unknown. In TaskQueryOps.list and FeatureService.list/collectTasksByFeature, wrap unexpected read/parse failures with the path; only ENOENT for an optional registered folder is empty. Do not silently skip a file lost between enumeration and read: fail and let the caller retry. Use existing transport error paths with the actionable message; do not add a list success-envelope field or change successful array/Map return types. A failing collect aborts sync before a transition/write. Parseable legacy status aliases keep taskMetadata handling; this is not a new whole-corpus schema-policy gate.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1297 consumes unchanged successful projections and PlanningReadError; 1302 may expose incomplete diagnostic state separately.

#### Boundaries and verification

(cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/task-locator.test.ts); (cd apps/server && bun test tests/modules/task/handlers.test.ts tests/modules/feature/handlers.test.ts). Add a disposable-project CLI/HTTP refusal proof and assert corpus bytes unchanged.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [x] 1. First reproduce EACCES/EIO/ENOTDIR and unreadable-todo/readable-done cases through app and fixture HTTP/CLI.
- [x] 2. Replace broad read/parse catches on the named list/collection paths with narrow missing-folder handling and PlanningReadError.
- [x] 3. Verify refresh/syncFingerprintInputs/sync callers propagate incomplete input and cannot apply a status transition.
- [x] 4. Confirm valid legacy aliases, optional ENOENT folders and successful list/Map JSON shapes are unchanged.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

| File | What changed and why |
| --- | --- |
| `packages/app/src/errors.ts:7-17` | Add internal PlanningReadError with the failing path and original cause so transports surface actionable diagnostics instead of silent omission. |
| `packages/app/src/services/task-query-ops.ts:110-152` | Treat only optional-folder ENOENT as empty; wrap every other list read/parse failure with its file or folder path. |
| `packages/app/src/services/feature-service.ts:303-332` | Fail feature-list reads with PlanningReadError rather than skipping unreadable feature files. |
| `packages/app/src/services/feature-service.ts:895-925` | Abort feature task collection on incomplete input so sync/fingerprint/status derivation cannot proceed from only the readable subset. |
| `packages/app/tests/services/task-query-ops.test.ts:59-83` | Cover unreadable-todo/readable-done, optional ENOENT, ENOTDIR and EIO with exact paths. |
| `packages/app/tests/services/feature-service.test.ts:243-291` | Prove unreadable feature files fail and an unreadable linked todo aborts sync with zero status writes. |
| `apps/cli/tests/commands/task/refresh.test.ts:64-70` | Prove refresh propagates a non-directory read error instead of silently returning success. |

Verification evidence:
- `(cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/task-locator.test.ts)` — 102 pass, 0 fail; valid legacy aliases and successful Map shapes remain green.
- `(cd apps/server && bun test tests/modules/task/handlers.test.ts tests/modules/feature/handlers.test.ts)` — 39 pass, 0 fail.
- `(cd apps/cli && bun test tests/commands/task/list.test.ts tests/commands/task/refresh.test.ts)` — 19 pass, 0 fail, including optional-folder and non-directory CLI cases.
- Disposable-project proof at `.spur/run/6c42d05a-03da-4637-ac8b-d5d138b5a00a/planning-read-refusal.json` — chmod-unreadable todo: CLI exit 1 and oRPC handler error 500 both name the file; corpus bytes preserved.
- `bun run --filter @gobing-ai/spur-app typecheck`, `bun run --filter @gobing-ai/spur typecheck`, and `bun run --filter @gobing-ai/spur-server typecheck` — all exit 0; all 51 pre-check rules passed.
- Light gate: format, pre-rules, app typecheck and related tests PASS; post-check coverage provenance is deferred to the pipeline's canonical full gate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-query-ops.ts:115` and `packages/app/src/services/task-query-ops.ts:152` throw `PlanningReadError` for unreadable folders/files; `packages/app/src/services/feature-service.ts:939` and `packages/app/src/services/feature-service.ts:960` refuse sync on unreadable linked tasks; `packages/app/src/errors.ts:8` defines the error; packages/app focused run 268 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Incomplete planning input cannot silently drive lifecycle state (req: R1) | MET | test | `packages/app/tests/services/task-query-ops.test.ts:59` unreadable todo beside done fails with its path; `packages/app/tests/services/feature-service.test.ts:267` sync aborts before any status write; `apps/cli/tests/commands/task/list.test.ts:201` CLI exits 1; command this session: chmod 000 todo beside done → `spur task list --folder <tmp> --json` exit 1 with `PlanningReadError: Failed to read planning input …/0002_todo.md: EACCES`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1296
**Scope:** planning read containment in TaskQueryOps and FeatureService plus tests and disposable-project proof
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence: MEDIUM**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | The change is deliberately limited to the three failing read seams; unrelated tolerant lookup behavior remains untouched, so no new corpus-wide schema gate or tolerant DTO was introduced. | `packages/app/src/services/task-query-ops.ts:110-152` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Task list fails at `packages/app/src/services/task-query-ops.ts:110-152`; feature list fails at `packages/app/src/services/feature-service.ts:303-332`; linked collection aborts at `:895-925`, preventing status derivation. CLI and oRPC proofs name the unreadable file with bytes preserved. |

**Next:** close through record/done; no P1–P3 finding remains and optional-folder ENOENT stays empty by design.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T23:41:49.696Z todo → wip (system)
- 2026-11-05T23:53:38.532Z wip → testing (system)
- 2026-11-05T23:53:40.502Z testing → done (system)

