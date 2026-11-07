---
schema_version: 1
name: Preserve bounded exact-search failures and skipped fuzzy outcomes
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.914Z
updated_at: "2026-11-07T06:50:41.937Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A34
priority: P1
tags:
  - simplification-2026-11
  - w2
  - approved
estimate_hours: 6

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1299-verdict.json
---

## 1299. Preserve bounded exact-search failures and skipped fuzzy outcomes

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W2; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A34: Bounded exact search never reports lost matches as an empty success; Auto search preserves skipped fuzzy outcomes.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/search.ts; packages/app/src/services/search-zg.ts; packages/app/tests/services/search.test.ts; apps/cli/tests/commands/self/search.test.ts; server search handler tests; hybrid-search contract.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Both defects reproduced again during this audit: output overflow returns successful zero hits; auto skipped fuzzy returns []. Unknown-status and missing-index failure fixtures must be explicit; nonempty status output is currently optimistically ready. Freeze an explicit error at the cap instead of a new streaming implementation.
- Verified source seams: `packages/app/src/services/search.ts:189`; `packages/app/src/services/search.ts:67`; `packages/app/src/services/search-zg.ts:115`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Bounded exact search never reports lost matches as an empty success; implement the exact Given/When/Then contract below.
- [x] R2. Auto search preserves skipped fuzzy outcomes; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Preserve bounded exact-search failures and skipped fuzzy outcomes

  Scenario: AC1 — Bounded exact search never reports lost matches as an empty success (req: R1)
    Given matching generated source lines exceeding the process output cap
    When exact search requests a limited result set
    Then the response contains a complete hit or an explicit bounded output-limit failure and preserves distinct timeout and no-match outcomes

  Scenario: AC2 — Auto search preserves skipped fuzzy outcomes (req: R2)
    Given absent, missing-index, unknown-status, failed and successfully empty fuzzy backends
    When the same auto request is evaluated against each deterministic fixture
    Then skipped routes remain null with the correct reason while successfully executed zero-match routes remain empty arrays
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:48.619Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No response schema change. Preserve fuzzy.hits in groups.fuzzy and use fuzzy.hits ?? [] only for markOverlaps. Extend internal SearchDeps.run result with outcome?:string and outputTruncated?:boolean (mapped from the installed executor result when available); otherwise detect its max-buffer failure outcome before treating exitCode as success. runExact checks timeout, cap/failure and malformed matching JSON events before exit 1/no-match handling. Throw existing SearchError rg-failed with bounded actionable reason; no new public code. Keep 2 MiB cap. Add a fixture zg executable for missing index/unknown status/failure tests so PATH installations cannot determine expected test results; production status remains unknown on failed probes, never invented missing. Streaming is out of this fix.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: No Board transport prerequisite; clients retain the same contracted SearchResponse.

#### Boundaries and verification

(cd packages/app && bun test tests/services/search.test.ts tests/services/search-zg.test.ts); (cd apps/cli && bun test tests/commands/self/search.test.ts); (cd apps/server && bun test tests/modules/search/handlers.test.ts). Save two-3MB-lines repro and bounded error result.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [x] 1. Write cap, malformed-event, timeout, valid no-match and all fuzzy outcome fixture cases before code.
- [x] 2. Preserve process outcome through defaultSearchDeps and reject incomplete exact output explicitly.
- [x] 3. Fix the null/empty distinction in auto mode; keep optional-backend degradation and unknown status truthful.
- [x] 4. Replace host-dependent CLI expectations with fixture binaries and keep a separately reported optional real-tool probe.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

| File | What changed and why |
| --- | --- |
| `packages/app/src/services/search.ts:78-89` | Preserve process `outcome` and mark output at the unchanged 2 MiB cap as truncated, so a normal exit cannot hide lost exact-search output. |
| `packages/app/src/services/search.ts:209` | Return `fuzzy.hits` directly in auto mode: skipped routes stay null while a successful zero-match route remains an empty array. |
| `packages/app/src/services/search.ts:251-264` | Reject timeout, capped output, every non-exit process outcome and malformed JSON match events before accepting rg's no-match exit; remediation names the 2 MiB bound. |
| `packages/app/tests/services/search.test.ts:225-258` | Added timeout, cancelled/signaled, cap and malformed-event regressions while retaining valid no-match and complete-hit coverage. |
| `packages/app/tests/services/search.test.ts:441-467` | Added unknown-status, failed-backend and successful-empty auto fixtures proving the null/empty distinction. |
| `packages/app/tests/services/search.test.ts:544-549` | Proved the real process wrapper marks 3 MiB output as truncated at its 2 MiB cap. |
| `apps/cli/tests/commands/self/search.test.ts:148-175` | Replaced host-dependent zg behavior with a fixture executable and PATH lifecycle; host installations no longer choose the expected skip reason. |
| `docs/design/hybrid-search.md:90-145` | Synchronized the owning contract with cap/malformed/timeout failures, unknown status, and skipped-null versus successful-empty fuzzy outcomes. |

Verification evidence:
- `(cd packages/app && bun test tests/services/search.test.ts tests/services/search-zg.test.ts)` — 65 pass, 0 fail.
- `(cd apps/cli && bun test tests/commands/self/search.test.ts)` — 19 pass, 0 fail, including the previously blocking auto-degraded assertion.
- `(cd apps/server && bun test tests/modules/search/handlers.test.ts)` — 3 pass, 0 fail.
- `bun run --filter @gobing-ai/spur-app typecheck` and `bun run --filter @gobing-ai/spur typecheck` — both exit 0; all 51 pre-check rules passed.
- Real-rg cap artifact: `.spur/run/69b79df6-9fea-4023-8e0b-efe2f3159d2f/cap-repro/result.json` — two 1,450,025-byte matching lines produced explicit `rg-failed` at the 2 MiB cap.
- Public-surface probe: `.spur/run/69b79df6-9fea-4023-8e0b-efe2f3159d2f/public-probe/result.json` — throwaway roots, real rg + fixture zg: exact exit 0 with a complete hit, auto exit 0 with skipped fuzzy null, capped exact exit 1 with the bounded error.
- Light gate: format, pre-rules, app/CLI typechecks and related tests PASS; post-check coverage provenance is deferred to the pipeline's canonical full gate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/search.ts:244` bounds rg with `--max-count`; `packages/app/src/services/search.ts:262-272` raises `SearchError` rg-failed on bounded/abnormal outcomes instead of an empty success; `packages/app/tests/services/search.test.ts:245` bounded output is an explicit failure; packages/app 268 pass / 0 fail. |
| R2 | MET | `packages/app/src/services/search.ts:197-202` and `packages/app/src/services/search.ts:217` carry fuzzy `skipped` entries into the result; `packages/app/tests/services/search.test.ts:450` failed fuzzy backend keeps the skipped route. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Bounded exact search never reports lost matches as an empty success (req: R1) | MET | test | `packages/app/tests/services/search.test.ts:245`; 268 pass / 0 fail. |
| AC2 — Auto search preserves skipped fuzzy outcomes (req: R2) | MET | test | `packages/app/tests/services/search.test.ts:450`; `apps/cli/tests/commands/self/search.test.ts:344` CLI auto mode reports zg-not-installed and exits 0 — 19 pass / 0 fail after the fix. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1299
**Scope:** remediated working tree (four implementation/test/design files plus task evidence)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence: HIGH**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | correctness | Cancelled or signaled rg processes were accepted as empty success. Every non-`exit` outcome now fails explicitly, with executable cancelled/signaled regressions. | `packages/app/src/services/search.ts:261-264` | RESOLVED (65 app tests + 19 CLI tests + full gate 11848 pass) |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Timeout, cap, cancelled/signaled and malformed output fail at `packages/app/src/services/search.ts:251-281`; regressions at `packages/app/tests/services/search.test.ts:225-258` and the real-rg cap artifact passed. |
| R2 | MET | Auto returns `fuzzy.hits` directly at `packages/app/src/services/search.ts:209`; unknown/failed/empty outcomes pass at `packages/app/tests/services/search.test.ts:450-476`. |

**Next:** close through the deterministic record/done gate; no open P1–P3 finding remains.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T22:28:00.215Z todo → wip (system)
- 2026-11-05T22:49:22.000Z wip → testing (system)
- 2026-11-05T22:51:16.362Z testing → done (system)

