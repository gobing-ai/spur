---
schema_version: 1
name: Reduce duplicated test mocks behind retained behavioral and gate evidence
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-07T02:13:52.868Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: H16
priority: P3
tags:
  - simplification-2026-11
  - w8
  - conditional
estimate_hours: 6

dependencies: ["1295"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1316-verdict.json
---

## 1316. Reduce duplicated test mocks behind retained behavioral and gate evidence

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature H16: Test scaffolding shrinks only behind equivalent behavioral evidence.

Owned surfaces/callers/fixtures/config/docs: measured duplicated rpc/editor/EventSource test mocks and brittle source-text assertions; apps/web/tests/test-helpers; affected script tests; existing isolation/discovery and gate timing owners.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- A concrete duplicated family is now identified: the shared rpc-client mock duplicates fetch timeout/cancellation code and diverges (10s vs 30s, missing pre-abort/reason/listener cleanup). This is no longer blocked on discovering a candidate or on SSE migration.
- Verified source seams: `apps/web/tests/test-helpers/rpc-client-mock.ts:32`; `apps/web/src/lib/rpc-client.ts:42`; `apps/web/src/lib/rpc-client.ts:61`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Test scaffolding shrinks only behind equivalent behavioral evidence; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reduce duplicated test mocks behind retained behavioral and gate evidence

  Scenario: AC1 — Test scaffolding shrinks only behind equivalent behavioral evidence (req: R1)
    Given an inventory of duplicated mocks and brittle source-text assertions with their contract owners
    When a measured approved candidate is replaced with shared behavior-oriented proof
    Then the old duplicate is removed while boundary assertions, ordinary discovery, coverage floors and failure sensitivity remain preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:27.891Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Keep backlog until a measured duplicated family and stronger behavior proof are identified; no blanket deletion campaign.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:24.939Z

Closed: use the existing duplicated fetch seam as the measured candidate; preserve production behavior and remove the mock copy. This task can be todo after 1295.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal dependency-free `apps/web/src/lib/rpc-fetch.ts` owns `DEFAULT_FETCH_TIMEOUT_MS`, `fetchWithTimeout`, `apiFetchWithTimeout`, `setFetchForTesting` and `resetFetchForTesting` moved unchanged from `apps/web/src/lib/rpc-client.ts`. `rpc-client` imports/reexports those same symbols, preserving all existing callers and public browser helper paths. The test mock (`apps/web/tests/test-helpers/rpc-client-mock.ts`) imports the shared functions directly from `rpc-fetch`; it keeps `api`/`resolveApiUrl` mock behavior and never recursively imports the mocked `rpc-client`. Delete its duplicate timeout/seam functions. Keep the 30s production default and caller-abort reasons/preaborted signal/listener cleanup exactly. No new package, no API stub expansion, no broad assertion deletion. Record net handwritten delta and before/after focused-suite timing.

#### Dependencies and handoff

Direct prerequisites: 1295. 1295 ensures the real-renderer safety proof stays in ordinary discovery while shared test plumbing changes.

Output/handoff: No dependency on 1301 and no unselected cleanup campaign remains.

#### Boundaries and verification

`(cd apps/web && bun test tests/lib/rpc-client.test.ts tests/rpc-client.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-sync.test.ts)`. Add `apps/web/tests/lib/rpc-fetch.test.ts` (and isolated mock-identity helper `apps/web/tests/lib/rpc-fetch-mock.ts`) with controlled timeout/abort fixtures. Repeat ordinary discovery and preserve source-boundary tests.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write failure-sensitive timeout/caller-abort/preaborted/listener-cleanup proofs using the real fetch seam, before moving code.
- [x] 2. Move the dependency-free fetch code with unchanged behavior and reexport from rpc-client.
- [x] 3. Import it into buildFullRpcMock and remove the divergent duplicate; preserve module isolation and api fixtures.
- [x] 4. Run paired real-client/mocked-client and sibling tests and publish code/timing delta without relaxing thresholds.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

**Change Map (R1 / AC1)**

- `apps/web/src/lib/rpc-fetch.ts:1-46` — Extracted dependency-free fetch deadline and test-injection seam (`DEFAULT_FETCH_TIMEOUT_MS`, `setFetchForTesting`, `resetFetchForTesting`, `fetchWithTimeout`, `apiFetchWithTimeout`) unchanged from `rpc-client.ts`, preserving the 30s default deadline, `TimeoutError` DOMException reason, caller `AbortSignal` pre-abort and in-flight reason propagation, and `finally` cleanup (`clearTimeout` + `removeEventListener`).
- `apps/web/src/lib/rpc-client.ts:8-17` — Imported `apiFetchWithTimeout` from `./rpc-fetch` for the singleton `OpenAPILink` (`apps/web/src/lib/rpc-client.ts:79-87`) and re-exported `apiFetchWithTimeout`, `DEFAULT_FETCH_TIMEOUT_MS`, `fetchWithTimeout`, `resetFetchForTesting`, and `setFetchForTesting` so all existing callers (`apps/web/tests/lib/rpc-client.test.ts:6-15`, `apps/web/tests/lib/feature-client.test.ts:16`, `apps/web/tests/rpc-client.test.ts:2`) remain source-compatible without path changes.
- `apps/web/tests/test-helpers/rpc-client-mock.ts:19-26` and `apps/web/tests/test-helpers/rpc-client-mock.ts:62-72` — Removed the 28-line divergent duplicate fetch/timeout implementation (which used a 10s deadline, dropped caller abort reasons, skipped pre-aborted signals, and leaked abort listeners) and imported the real `DEFAULT_FETCH_TIMEOUT_MS`, `fetchWithTimeout`, `apiFetchWithTimeout`, `setFetchForTesting`, and `resetFetchForTesting` symbols directly into `buildFullRpcMock` without recursively importing the mocked `rpc-client` module.
- `apps/web/tests/lib/rpc-fetch.test.ts:1-138` and `apps/web/tests/lib/rpc-fetch-mock.ts:1-29` — Added failure-sensitive behavioral proofs covering the 30s default deadline and `TimeoutError` reason on both `fetchWithTimeout` and `apiFetchWithTimeout`, explicit deadline abort reason, caller pre-abort and mid-flight cancellation reason preservation, timer + `AbortSignal` listener cleanup on both success and failure, request method/headers/body preservation, `resetFetchForTesting` restoration, and isolated subprocess verification proving `buildFullRpcMock` exposes the exact `rpc-fetch` function references and shared injection state without polluting sibling tests in the parent process.

**Handwritten Line & Timing Delta**

- Handwritten line delta recorded in `.spur/run/1316-delta.json`: `rpc-client.ts` reduced from 122 to 87 lines (-35 lines), `rpc-client-mock.ts` reduced from 95 to 76 lines (-19 net scaffold delta; 28 duplicated fetch/timeout lines removed), `rpc-fetch.ts` extracted at 46 lines unchanged, for a net production + mock scaffold reduction of -8 lines (217 to 209 lines), plus 167 lines of behavioral proof across `rpc-fetch.test.ts` (138 lines) and `rpc-fetch-mock.ts` (29 lines).
- Focused suite timing and behavioral evidence: pre-change 4-file baseline ran in 357.46ms with exit 0 (`.spur/run/1316-before.json`, `.spur/run/1316-before.junit.xml`); post-change 4-file baseline ran in 471.64ms with exit 0 (`.spur/run/1316-after.json`, `.spur/run/1316-after.junit.xml`); post-change 5-file focused suite including `rpc-fetch.test.ts` and isolated mock proof ran in 378.00ms with 59 pass, 0 fail, 96 assertions (`.spur/run/1316-focused.junit.xml`, `.spur/run/1316-rpc-mock.junit.xml`), 100% line and 100% function coverage on both `rpc-fetch.ts` and `rpc-client.ts`, and `apps/web/tests/modules/task-kanban/markdown-safety.test.ts:90-96` (`EXPECTED_PROBES`) passing in ordinary discovery.

probe: not-applicable (no public surface changed)

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/lib/rpc-fetch.ts:1-46` shared seam re-exported at `apps/web/src/lib/rpc-client.ts:8-17`; divergent duplicate removed, mock imports real seam at `apps/web/tests/test-helpers/rpc-client-mock.ts:19-26`; proof `apps/web/tests/lib/rpc-fetch.test.ts:20-138` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Test scaffolding shrinks only behind equivalent behavioral evidence (req: R1) | MET | test | `apps/web/tests/lib/rpc-fetch.test.ts:21-138` + isolated mock-identity proof `apps/web/tests/lib/rpc-fetch-mock.ts:7-29`; focused run `(cd apps/web && bun test apps/web/tests/lib/rpc-client.test.ts apps/web/tests/rpc-client.test.ts apps/web/tests/lib/feature-client.test.ts apps/web/tests/modules/features/feature-sync.test.ts apps/web/tests/lib/rpc-fetch.test.ts apps/web/tests/modules/task-kanban/markdown-safety.test.ts)` 63 pass / 0 fail; ordinary discovery `apps/web/tests/modules/task-kanban/markdown-safety.test.ts:12`; mutation probe 4 fail; full gate `spur self exec check` PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1316

**Scope:** working-tree diff vs `1d2210ddb` — `apps/web/src/lib/rpc-fetch.ts` (new), `apps/web/src/lib/rpc-client.ts`, `apps/web/tests/test-helpers/rpc-client-mock.ts`, `apps/web/tests/lib/rpc-fetch.test.ts` (new), `apps/web/tests/lib/rpc-fetch-mock.ts` (new); plus run-gate hermeticity edits in `scripts/commands/run-tests.ts`, `tests/setup.ts`, `packages/domain/tests/dao/migration-ownership.test.ts`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | Three test-harness hermeticity edits (SPUR_ROLE scrub, TMPDIR-outside-repo guard, gitignored `apps/cli/spur.js` digest excluded from the frozen ownership-report equality) sit in this tree but are not R1/AC1 scope; they were pipeline gate repairs, not 1316 deliverables. Commit them as a separate conventional commit so the 1316 commit stays one review/rollback boundary. | `scripts/commands/run-tests.ts:123`, `tests/setup.ts:148`, `packages/domain/tests/dao/migration-ownership.test.ts:431` | ACCEPTED |

No P1–P3 findings. Security: no new input surface; caller abort reasons and `TimeoutError` reasons are preserved byte-for-byte. Efficiency: extraction is a pure move (identical body, `apps/web/src/lib/rpc-fetch.ts:23-46`). Correctness: mock now shares the real functions, eliminating the 10s/no-reason/listener-leak divergence. Usability: `rpc-client` re-exports keep every caller path (`apps/web/src/lib/rpc-client.ts:10-17`); `docs/design/observability-contracts.md:383` stays accurate. Architecture: `rpc-fetch` is dependency-free, so the mock imports it without recursively importing the mocked module (`apps/web/tests/test-helpers/rpc-client-mock.ts:19-26`).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/lib/rpc-fetch.ts:1-46` shared seam; duplicate removed from `apps/web/tests/test-helpers/rpc-client-mock.ts:19-26,62-72`; behavioral proof `apps/web/tests/lib/rpc-fetch.test.ts:20-138` |

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 — Test scaffolding shrinks only behind equivalent behavioral evidence (req: R1) | MET | test+command | `apps/web/tests/lib/rpc-fetch.test.ts:21-138` (deadline, reasons, pre/mid abort, cleanup, mock identity in isolated child `apps/web/tests/lib/rpc-fetch-mock.ts:7-29`); focused 6-file run 63 pass/0 fail incl. `apps/web/tests/modules/task-kanban/markdown-safety.test.ts:12` ordinary discovery; mutation probe (10s default + dropped `removeEventListener`) → 4 fail; `rpc-fetch.ts` 100% line/func coverage; full gate `spur self exec check` PASS (`.spur/run/1316-check-receipt.json`) |

**Checks (reviewer-run):** focused web suite 63 pass / 0 fail; mutation sensitivity 4/10 fail under mutation, restored; `biome check` on 8 changed files clean; `tsc --noEmit -p apps/web` exit 0.

**Next:** record verdict and commit 1316 separately from the three hermeticity edits (finding 1).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:27.600Z todo → blocked (system)
- 2026-11-05T20:38:25.527Z blocked → todo (system)
- 2026-11-07T01:35:19.403Z todo → wip (system)
- 2026-11-07T02:12:45.233Z wip → testing (system)
- 2026-11-07T02:13:52.853Z testing → done (system)

