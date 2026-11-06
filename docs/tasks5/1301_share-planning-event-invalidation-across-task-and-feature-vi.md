---
schema_version: 1
name: Share planning-event invalidation across task and feature views
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.915Z
updated_at: "2026-11-06T01:59:08.696Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F73
priority: P2
tags:
  - simplification-2026-11
  - w3
  - approved
estimate_hours: 6

dependencies: ["1298"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1301-verdict.json
---

## 1301. Share planning-event invalidation across task and feature views

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W3; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F73: Planning live updates share one owned subscription.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/task-kanban/useTasks.ts; apps/web/src/modules/features/FeaturesShell.tsx and useFeatureActionProgress.ts; planning-event helpers and shell ownership; related hook/rendered tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Transport conversion is independent of event connection ownership. Remove dependency 1300; retain 1298 because the new stream invalidation must use its source/lifetime and trailing-refresh rules.
- Verified source seams: `apps/web/src/modules/features/FeaturesShell.tsx:105`; `apps/web/src/modules/features/useFeatureActionProgress.ts:39`; `apps/web/src/modules/task-kanban/useTasks.ts:157`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Planning live updates share one owned subscription; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Share planning-event invalidation across task and feature views

  Scenario: AC1 — Planning live updates share one owned subscription (req: R1)
    Given task and feature views mounted in one Board session
    When one hundred planning events arrive and views mount or unmount
    Then one planning stream coalesces affected-query refreshes and final state is fresh without leaking subscriptions or modifying process stream cursors
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:52.778Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New browser-only lib/planning-events.ts exports subscribePlanningEvents(listener):unsubscribe and subscribePlanningConnection(listener):unsubscribe over one lazily created EventSource at resolveApiUrl()+/events/planning. Parse each frame once into {eventName,payload}; ignore invalid frames; deliver only task.*, feature.* and queue.job.* planning frames to interested listeners. Retain connection state callbacks and close on last listener. Consumers own query-specific invalidation; TaskStore retains its coalescer, feature shell uses a same-generation trailing reload, progress reducer still matches job/run IDs. Do not introduce a cache/query library or merge process/history streams.

#### Dependencies and handoff

Direct prerequisites: 1298. 1298 owns per-store source generation and coalesced/trailing refresh; reuse it rather than rebuilding ownership.

Output/handoff: 1302 subscribes to the same planning source; process output remains separately addressed.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/task-kanban/useTasks.test.ts tests/modules/features/useFeatureActionProgress.test.ts tests/modules/features/sse-helpers.test.ts); add tests/lib/planning-events.test.ts and rendered multi-view proof.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [x] 1. Write a rendered multi-consumer connection/ref-count/invalid-frame/action-progress proof first.
- [x] 2. Create the one subscription owner and migrate TaskStore, FeaturesShell and action progress without changing their data ownership.
- [x] 3. Test unmount, reconnection notification, irrelevant events and 100-event final freshness; record 60-second request/connection counts.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

Implement-step evidence is in Solution. The light gate's post-check is blocked by sandbox Git object-write permissions; the parent pipeline owns the canonical full gate, Testing/Review and lifecycle completion.

### Solution

| File | What changed and why |
| --- | --- |
| `apps/web/src/lib/planning-events.ts:20` | Browser-only lazy planning EventSource owner. Parses each frame once, drops malformed and non-planning frames, shares task/feature/queue-job events and connection notifications, and closes with the final listener. Separate registration identities and connection identity checks make unsubscribe idempotent and stale callbacks inert. |
| `apps/web/src/modules/task-kanban/useTasks.ts:62-240` | TaskStore releases shared event/connection subscriptions instead of owning an EventSource. Preserves prerequisite 1298's source/lifetime refresh guards, one trailing refresh, 5s polling, connected and lastSyncAt behavior. |
| `apps/web/src/modules/features/FeaturesShell.tsx:69` | Feature-list requests coalesce within the mounted generation, abort on teardown and discard superseded results/trailing work. Selected-detail nudges coalesce after the final list read; selection changes retain the subscription. |
| `apps/web/src/modules/features/useFeatureActionProgress.ts:15-41` | Action progress consumes parsed shared planning frames while retaining the existing correlation reducer and feature-switch reset. |
| `apps/web/tests/lib/planning-events.test.ts:17` | Proves parse-once/filtering, lazy ref-counted ownership, current/reconnected connection notifications, duplicate registration ownership, malformed input and late-callback cleanup. |
| `apps/web/tests/modules/features/planning-live-views.test.ts:30-197` | Rendered task/feature/action journey proves one connection, 100-event trailing freshness, job matching, irrelevant process frames, selected-detail coalescing, cancellation and final-unmount cleanup. Writes repeatable JSON proof. |
| `apps/web/tests/modules/task-kanban/useTasks.test.ts:326` | Existing direct-subscription tests now release their listeners, preventing test transport ownership from leaking into later rendered suites. |
| `docs/03_ARCHITECTURE.md:165` and `docs/design/planning-record-contracts.md:322` | Synchronize the browser ownership mechanism and subscription contract; process/history/message streams retain their independent owners. |

Implementation verification:
- Red proof before production changes: rendered journey opened 3 streams instead of 1; the pending feature-list request overlapped after one event.
- `(cd apps/web && bun test tests/lib/planning-events.test.ts tests/modules/features/planning-live-views.test.ts tests/modules/task-kanban/useTasks.test.ts tests/modules/features/useFeatureActionProgress.test.ts tests/modules/features/sse-helpers.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1301/focused-tests.xml)` — 39 pass, 0 fail. JUnit evidence is `.spur/run/1301/focused-tests.xml`.
- Controlled 60-second polling proof: 1 planning connection; 2 feature-list reads; 14 task-list reads (initial + trailing + twelve 5s polls); final rendered names Task version 100 / Feature version 100; closed after final unmount. Repeatable artifact: `.spur/run/1301/planning-live-proof.json`.
- `bun run --filter @gobing-ai/spur-web typecheck` — PASS. Changed-path Biome — PASS.
- `bun apps/cli/src/index.ts task gate 1301 light` — receipt FAIL: formatting, pre-check rules (51 rules), web typecheck and related tests PASS; post-check coverage provenance cannot capture the Git tree because sandbox permissions prohibit Git object writes (Operation not permitted). No bypass or gate weakening. The canonical full gate belongs to the parent pipeline.
- Real Chromium probe unavailable: the browser process failed bootstrap_check_in with Permission denied (1100). The rendered happy-dom proofs above passed; no real-browser PASS is claimed. Scratch browser fixture/probe retained under `.spur/run/1301/` for retry outside this sandbox.
- Commit unavailable under the same Git metadata/object write restriction; this implement step leaves a reviewable source diff and does not change task lifecycle status or author Testing/Review.
- probe: not-applicable (no public surface changed: no CLI verb/flag, HTTP route, or plugin script entry changed).

API evidence: existing repository consumer patterns plus https://developer.mozilla.org/en-US/docs/Web/API/EventSource and https://react.dev/reference/react/useEffect. Confidence: high for the focused rendered contract from passing tests/typechecking; real-browser execution and the canonical full gate remain unverified.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/planning-events.ts:20` owns one lazy stream; `packages/app/src/services/planning-events.ts:50` closes the final reference. `apps/web/src/modules/task-kanban/useTasks.ts:224`, `apps/web/src/modules/features/FeaturesShell.tsx:143` and `apps/web/src/modules/features/useFeatureActionProgress.ts:34` share it. Fresh focused check: 39 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Planning live updates share one owned subscription (req: R1) | MET | test | Fresh passing tests at `apps/web/tests/modules/features/planning-live-views.test.ts:32` prove one stream across concurrent task/feature/action consumers, 100-event trailing freshness, connection notifications, ignored process frames and final-unmount cleanup. `apps/web/tests/modules/features/planning-live-views.test.ts:139` proves selected-detail coalescing; `apps/web/tests/modules/features/planning-live-views.test.ts:178` proves cancellation and discarded trailing work. `packages/app/tests/services/planning-events.test.ts:17` proves parse-once filtering, ref-counting and stale-callback rejection. `apps/web/src/lib/process-stream.ts:68` retains its independent sequence cursor and is unchanged in this diff. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1301

**Scope:** Working-tree fallback; no implementation commit tagged (1301). Reviewed four production files, four test/fixture files, two owning documents and the task record.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | Previous finding resolved: Solution now cites the browser subscription owner and its browser tests, matching the implementation claims at `apps/web/src/lib/planning-events.ts:20` and `apps/web/tests/lib/planning-events.test.ts:17`. | `docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:101`; `docs/tasks5/1301_share-planning-event-invalidation-across-task-and-feature-vi.md:105` | RESOLVED |
| 2 | P4 (advisory) | architecture | No new P1–P3 findings across all six dimensions: shared parsing, listener ownership and late-callback guards remain centralized; query generations and trailing refreshes remain consumer-owned. Rendered tests exercise the task, feature and action consumers together. | `apps/web/src/lib/planning-events.ts:20`; `apps/web/src/modules/features/FeaturesShell.tsx:74`; `apps/web/tests/modules/features/planning-live-views.test.ts:32` | ACCEPTED |

##### Verification

- Fresh focused check, run inside apps/web: `bun test tests/lib/planning-events.test.ts tests/modules/features/planning-live-views.test.ts tests/modules/task-kanban/useTasks.test.ts tests/modules/features/useFeatureActionProgress.test.ts tests/modules/features/sse-helpers.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1301/reviewer-focused-tests.xml` — exit 0; 39 pass, 0 fail, 147 assertions.
- Fresh `bun run --filter @gobing-ai/spur-web typecheck` — exit 0. Fresh Biome check of all eight changed source/test files with `--error-on-warnings` — exit 0; no fixes applied.
- Repeatable rendered proof: `.spur/run/1301/planning-live-proof.json:1` records one connection, two feature reads, fourteen task reads over a controlled 60-second polling window, version-100 final state and closure after final unmount.
- Existing pipeline receipt `.spur/run/1301-check-receipt.json:1` records full-tier PASS for this run. Fresh `task gate 1301 status` returned reuse=false because sandbox permissions prevented Git tree capture. Receipt reuse is unconfirmed; the reviewer did not rerun the full gate.
- Design conformance: shared browser transport, filtering, connection notifications, last-listener cleanup, task source/lifetime ownership, feature trailing reload and progress correlation match the frozen design. Process-stream implementation is unchanged.
- Limits: rendered proofs use happy-dom and a fake transport; polling time is controlled. No fresh real-browser proof or feature-wide completion claim. `git diff --check` reports an extra blank line at the task file's EOF; source/test formatting passes.

**Next:** Return this certified review to the pipeline; preserve its remaining gate and lifecycle guards.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/lib/planning-events.ts:20` owns one lazy stream; `apps/web/src/lib/planning-events.ts:50` closes the final reference. `apps/web/src/modules/task-kanban/useTasks.ts:224`, `apps/web/src/modules/features/FeaturesShell.tsx:143` and `apps/web/src/modules/features/useFeatureActionProgress.ts:34` share it. Fresh focused check: 39 pass, 0 fail. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Planning live updates share one owned subscription (req: R1) | MET | test+static-ref | Fresh passing tests at `apps/web/tests/modules/features/planning-live-views.test.ts:32` prove one stream across concurrent task/feature/action consumers, 100-event trailing freshness, connection notifications, ignored process frames and final-unmount cleanup. `apps/web/tests/modules/features/planning-live-views.test.ts:139` proves selected-detail coalescing; `apps/web/tests/modules/features/planning-live-views.test.ts:178` proves cancellation and discarded trailing work. `apps/web/tests/lib/planning-events.test.ts:17` proves parse-once filtering, ref-counting and stale-callback rejection. `apps/web/src/lib/process-stream.ts:68` retains its independent sequence cursor and is unchanged in this diff. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T01:45:05.390Z todo → wip (system)
- 2026-11-06T01:59:06.727Z wip → testing (system)
- 2026-11-06T01:59:08.692Z testing → done (system)

