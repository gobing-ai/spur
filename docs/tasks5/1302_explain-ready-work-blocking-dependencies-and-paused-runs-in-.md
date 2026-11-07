---
schema_version: 1
name: Explain ready work, blocking dependencies and paused runs in planning views
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.916Z
updated_at: "2026-11-07T02:35:27.420Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F73
priority: P2
tags:
  - simplification-2026-11
  - w3
  - approved
estimate_hours: 8

dependencies: ["1297", "1301"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1302-verdict.json
---

## 1302. Explain ready work, blocking dependencies and paused runs in planning views

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W3; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F73: Daily readiness explains work and exact blockers.

Owned surfaces/callers/fixtures/config/docs: existing task/feature shells and detail panels; shared planning read projection and diagnostics; existing task/run/check contracts; related CLI/Board integration fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The first design did not freeze a readiness algorithm or response. Use existing deterministic checks and task/run data, not a second advice engine. Add a read-only procedure rather than changing task.list success shapes.
- Verified source seams: `packages/app/src/services/planning-preflight.ts:27`; `packages/app/src/services/task-check.ts:480`; `packages/app/src/services/run-store-service.ts:260`; `packages/contracts/src/task.ts:155`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Daily readiness explains work and exact blockers; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Explain ready work, blocking dependencies and paused runs in planning views

  Scenario: AC1 — Daily readiness explains work and exact blockers (req: R1)
    Given ready tasks, blocked dependencies, incomplete inputs and paused work in a fixture project
    When the operator opens the existing task or feature readiness view
    Then the view deterministically explains ready work, exact blockers and a valid existing next action without a foreground model call
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:54.879Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New application PlanningReadinessService and task.readiness GET /tasks/readiness with optional existing folder filter. Return {ok:true,data:{tasks:[{wbs,state:"ready"|"blocked"|"not-startable",reasons:[{code,message,relatedWbs?}],nextAction:null|{kind:"run-task",wbs,command}}],pausedRuns:[{runId,wbs}],diagnostics:[{path,message}]}}. A task is ready only when status todo, all declared dependencies resolve to done, its target-todo check has no errors and the relevant snapshot is complete. Missing/deprecated/undone dependencies and blocked status explain why; incomplete data never yields ready. Existing state done/cancelled/deprecated is not-startable. nextAction only for ready rows, using existing /sp:dev-run <wbs>; it is displayed, never executed. Use current TaskCheckService policy against 1297 snapshot input, not private regex checks. Add a compact keyboard-accessible panel to current TasksShell/FeatureDetail; no new module or model invocation.

#### Dependencies and handoff

Direct prerequisites: 1297, 1301. 1297 supplies complete operation-scoped records/diagnostics; 1301 supplies shared live invalidation.

Output/handoff: No dependency on recovery UX; link existing run routes now and let 1307 improve them later.

#### Boundaries and verification

Add packages/app/tests/services/planning-readiness.test.ts, apps/server/tests/modules/task/readiness.test.ts and apps/web/tests/modules/task-kanban/readiness.test.ts. Save a single fixture CLI-check/HTTP/DOM journey and zero-model-dispatch assertion.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Verified surfaces (2026-11-06)

The readiness read is additive on the existing task contract, so its declared surfaces include the
contract and barrel files the first pipeline run was refused for touching:

- `packages/contracts/src/task.ts` — `taskReadinessResponseSchema` plus its DTO.
- `packages/contracts/src/index.ts` and `packages/app/src/index.ts` — re-exports only.
- `apps/server/src/modules/task/handlers.ts` and `apps/server/tests/modules/task/handlers.test.ts` — one read-only
  procedure over the readiness projection, plus its handler test.
- `packages/app/src/services/planning-readiness.ts` — the projection owner.
- `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx` — the rendering surface.

No mutation, no schema change to an existing payload, and no new public flag or noun.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write fixtures for ready, missing/undone dependency, blocked, terminal, incomplete and paused-run cases before code.
- [x] 2. Implement the deterministic application projection and additive contracted HTTP read, preserving current task list DTOs.
- [x] 3. Render blockers/paused links/next action in existing views with the shared planning subscription.
- [x] 4. Prove displayed next action is legal and incomplete state cannot become ready.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

Implement-step focused checks and combined CLI/HTTP/DOM journey: 326 pass, 0 fail. Five workspace typechecks, changed-file lint and pre-check rules pass. The light gate records FAIL because the sandbox denies Git object writes needed for tree capture and coverage provenance; the same restriction prevents a task commit. Real Chromium failed to expose a DevTools port. Fresh commands, artifacts and limitations are recorded in Solution. The calling pipeline owns the full gate, Testing/Review and lifecycle completion.

- [x] 6. Revalidate the review P2 child-index fix, add an actual parse-count bound and legacy checker-policy parity regression before the production correction, run focused proofs and record current implementation evidence.

Current implement re-entry: 330 focused/journey tests pass; five workspace typechecks pass. The bounded scale fixture records 1,200 parses for 600 tasks. The light gate remains FAIL solely at Git-tree/coverage provenance capture because Git object writes are denied. The calling pipeline owns fresh full-gate and review certification.

### Solution

| Requirement | Implementation and rationale |
| --- | --- |
| R1 | `packages/app/src/services/planning-readiness.ts:39` pins checker corpus reads to a fresh operation-scoped snapshot and retains the existing evidence filesystem seam. `packages/app/src/services/planning-readiness.ts:59` resolves all configured folders before display filtering, reports exact dependency/status/check reasons, and offers `/sp:dev-run <wbs>` only for a complete, checked todo record with done dependencies. Paused work, ambiguous/unreadable inputs, missing policy, missing required sections, unavailable/orphan/full-page run links suppress recommendations. Incomplete-read diagnostics prevent any ready action; repeated WBS identities remain diagnostics rather than duplicate actionable rows. |
| R1 | `packages/contracts/src/task.ts:155` defines the additive readiness DTO and GET /tasks/readiness contract without altering task.list. `packages/contracts/src/index.ts:71` exports its schema/type; `packages/app/src/index.ts:559` exports the application projection. `apps/server/src/context.ts:557` composes it from resolved folders, existing matrix/severity policy and run store. `apps/server/src/modules/task/handlers.ts:39` supplies the thin read-only handler. |
| R1 | `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx:7` renders a native keyboard-accessible disclosure, exact blockers, display-only commands and existing paused-run progress links. Its shared planning subscriptions coalesce in-flight invalidations, clear previous advice during refresh, abort on unmount/folder change and reject stale responses. `apps/web/src/modules/task-kanban/TasksShell.tsx:203` mounts the folder-scoped panel; `apps/web/src/modules/features/FeatureDetail.tsx:789` filters it to the existing linked-task set while preserving the body editor. |
| R1 | `packages/app/tests/services/planning-readiness.test.ts:1`, `apps/server/tests/modules/task/readiness.test.ts:1` and `apps/web/tests/modules/task-kanban/readiness.test.ts:1` cover service failure cases, real HTTP/check/run-store composition, native disclosure, zero dispatch, 100-event trailing refreshes, teardown and stale scope rejection. `packages/app/tests/services/planning-readiness.fixture.ts:1` supplies the shared throwaway corpus. `apps/web/tests/lib/planning-source.fixture.ts:1` restores the transport fixture referenced by prerequisite 1301's committed tests and reused here. `apps/server/tests/modules/task/handlers.test.ts:90` includes the additive route in the expected inventory. `docs/design/planning-record-contracts.md:23` clarifies required-section and paused-task blockers; the existing architecture owner already describes this mechanism. |

Fresh implement-step evidence (the calling pipeline owns the full gate, Testing/Review and lifecycle transitions):

- Tests preceded production changes. Initial service/panel probes failed on absent implementations; the real HTTP probe failed with 400 for the absent readiness procedure. The fixture matrix shape was corrected to `SectionMatrix.variants.standard`. The existing handler inventory was updated for the new route; no assertion, rule or gate was suppressed.
- `(cd packages/app && bun test tests/services/planning-readiness.test.ts tests/services/planning-snapshot.test.ts tests/services/task-check.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/app-focused.xml)` — 217 pass, 0 fail.
- `(cd apps/server && bun test tests/modules/task/readiness.test.ts tests/modules/task/handlers.test.ts tests/router.test.ts tests/openapi.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/server-focused.xml)` — 33 pass, 0 fail.
- `(cd apps/web && bun test tests/modules/task-kanban/readiness.test.ts tests/modules/task-kanban/tasks-shell.test.ts tests/modules/features/planning-live-views.test.ts tests/lib/planning-events.test.ts tests/modules/task-kanban/useTasks.test.ts tests/modules/features/feature-sync.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/web-focused.xml)` — 37 pass, 0 fail, including shared stream lifetime and preservation of unsaved feature drafts.
- `(cd apps/cli && bun test tests/commands/task/check.test.ts tests/commands/task/list.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/cli-focused.xml)` — 38 pass, 0 fail.
- Public-surface probe: `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)` — 1 pass, 0 fail, 11 assertions. One throwaway project proves a source-local CLI target-todo check, GET /api/tasks/readiness and the rendered panel together. Ready work, cross-folder dependencies, exact missing-dependency/required-section blockers, paused links and display-only next actions are covered. CLI execution is bounded to 120 seconds/8 KiB. `.spur/run/1302/readiness-journey.json` records observedAt, exact command/stdout/stderr, HTTP response, DOM, modelDispatches=0 and finalStreamClosed=true. The adjacent test file repeats the proof. Focused checks plus this journey total 326 pass, 0 fail.
- `bun run --filter @gobing-ai/spur-app --filter @gobing-ai/spur-contracts --filter @gobing-ai/spur-server --filter @gobing-ai/spur-web --filter @gobing-ai/spur typecheck` — all five workspaces PASS. Changed-file Biome with error-on-warnings and `git diff --check` — PASS.
- `bun apps/cli/src/index.ts task gate 1302 light` — receipt FAIL, despite the CLI's zero process exit. Formatting/lint, all 51 pre-check rules, four changed-workspace typechecks and related tests PASS. Post-check stops at coverage provenance because Git tree capture cannot write objects: `git add -A` fails with Operation not permitted. Evidence: `.spur/run/1302-check-receipt.json` and `.spur/run/1302-light-gate.log`. The same sandbox Git metadata restriction prevents the required task commit; source changes remain a reviewable diff with new untracked files. No full-suite run or provenance bypass was attempted inside implement.
- Real-browser check unavailable: the existing CDP harness's launchBrowser failed with Chromium did not report a DevTools port. `.spur/run/1302/browser-status.json` records the result. The rendered proof uses happy-dom and is not a real-browser PASS.

External API evidence checked against installed types and existing clients: https://react.dev/reference/react/useEffect (effect cleanup and stale-response rejection); https://orpc.dev/docs/client/async-iterator-object (AbortSignal call option). Tested fixture behavior is established; canonical full-gate and real-browser results remain unverified.

#### Implement re-entry verification

Re-entered in implement mode to confirm the existing work. No escalation was needed. Preserved the existing 1302 implementation and all starting changes; no additional production edits were needed. The projection remains at `packages/app/src/services/planning-readiness.ts:59`, the additive contract at `packages/contracts/src/task.ts:155`, and the shared-subscription panel at `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx:7`. The current exported readiness interfaces and DTO have TSDoc comments. This pass revalidates the implementation rather than treating earlier results as fresh evidence.

- Fresh focused checks: app 217 PASS, server 33 PASS, web 37 PASS, CLI 38 PASS; zero failures. Exact test-file selections match the preceding implementation evidence. Repeatable JUnit receipts: `.spur/run/1302/app-resume.xml`, `.spur/run/1302/server-resume.xml`, `.spur/run/1302/web-resume.xml`, `.spur/run/1302/cli-resume.xml`; adjacent logs record commands' test output.
- Fresh public-surface journey: `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)` — 1 PASS, 0 failures, 11 assertions. Together with focused checks: 326 PASS. `.spur/run/1302/readiness-journey.json` records the throwaway project's exact CLI command/output, contracted HTTP result, rendered DOM, zero model/job dispatches and final stream cleanup. Rendering uses happy-dom.
- `bun run --filter @gobing-ai/spur-app --filter @gobing-ai/spur-contracts --filter @gobing-ai/spur-server --filter @gobing-ai/spur-web --filter @gobing-ai/spur typecheck` — all five PASS; output in `.spur/run/1302/typecheck-resume.log`.
- `bun apps/cli/src/index.ts rule run --preset recommended-post-check --rule every-export-has-tsdoc --json` — PASS, no findings; `.spur/run/1302/tsdoc-resume.json`. The older full-gate log's five missing-comment findings do not describe the current source. No full suite was run inside this implement re-entry.
- `bun apps/cli/src/index.ts task gate 1302 light` — receipt FAIL. All other nine checks PASS: changed-file formatting/lint, all 51 pre-check rules, four changed-workspace typechecks and related server/web/app tests. Post-check cannot capture the tested Git tree: `git add -A` reports `Operation not permitted`, leaving the coverage provenance unbound. `.spur/run/1302-check-receipt.json` and `.spur/run/1302-light-gate.log` record the failure; `.spur/run/1302/light-resume.log` records the driver output. The process itself exits 0, so its exit code is not a passing gate. No provenance bypass or further full-gate run was attempted.
- The same Git object-write denial prevents the required task commit. Existing source changes remain reviewable in the working tree. The task CLI also leaves a trailing blank line at the task file's EOF, reported by `git diff --check`; source-file whitespace is checked separately.

The calling pipeline still owns the full gate, Review, Testing and lifecycle transitions. No task completion, full-gate PASS, fresh coverage certification or real-browser PASS is claimed here.

#### P2 remediation — current implement re-entry

The starting tree already contained the child-index optimization responding to Review finding 1. This pass preserved it, corrected its policy drift, strengthened its regression protection, and obtained fresh focused evidence. The existing Review remains the review stage's record; this implement step does not certify or replace its verdict.

| Requirement / finding | Implementation and evidence |
| --- | --- |
| R1 / Review P2 | `packages/app/src/services/planning-readiness.ts:90` builds one parent-to-children index from the operation snapshot and passes it to the current checker. `packages/app/src/services/task-check.ts:532` accepts that operation-scoped index; `packages/app/src/services/task-check.ts:1287` uses it instead of reparsing every sibling for each row. Standalone checks retain their original scan. |
| R1 / checker-policy preservation | `packages/app/src/services/planning-readiness.ts:94` excludes self-references and retains raw child statuses to match the checker's existing scan. The parity test at `packages/app/tests/services/planning-readiness.test.ts:167` failed first for legacy `completed`: normalized display status incorrectly added a rollup-parent-open blocker. The production correction restores existing checker policy without weakening checks. |
| R1 / regression protection | `packages/app/tests/services/planning-readiness.test.ts:130` now counts actual MarkdownDocument.parse calls, bounded by two per task in the independent-row fixture, as well as physical reads. A physical-read-only assertion could miss the old quadratic parsing because the snapshot filesystem caches bytes. `packages/app/tests/services/planning-readiness.test.ts:167` compares indexed and standalone rollup findings for done/completed/todo children, legacy parent spelling, cross-folder children and self-references. `docs/design/planning-record-contracts.md:44` records index reuse and policy preservation under constitution T3. |

Fresh verification:

- `(cd packages/app && bun test tests/services/planning-readiness.test.ts tests/services/planning-snapshot.test.ts tests/services/task-check.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/app-final.xml)` — 221 pass, zero failures. Before the production correction, the new legacy-status parity case failed with an unexpected L4.rollup-parent-open finding; all seven readiness tests now pass. `.spur/run/1302/rollup-regression.xml` is the first green regression receipt.
- `(cd apps/server && bun test tests/modules/task/readiness.test.ts tests/modules/task/handlers.test.ts tests/router.test.ts tests/openapi.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/server-final.xml)` — 33 pass, zero failures.
- `(cd apps/web && bun test tests/modules/task-kanban/readiness.test.ts tests/modules/task-kanban/tasks-shell.test.ts tests/modules/features/planning-live-views.test.ts tests/lib/planning-events.test.ts tests/modules/task-kanban/useTasks.test.ts tests/modules/features/feature-sync.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/web-final.xml)` — 37 pass, zero failures.
- `(cd apps/cli && bun test tests/commands/task/check.test.ts tests/commands/task/list.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/cli-final.xml)` — 38 pass, zero failures.
- Public-surface probe: `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)` — one pass, zero failures, 11 assertions. The repeatable throwaway CLI/check/HTTP/DOM proof records exact command/output, ready/blocking/paused behavior, zero model/job dispatches and subscription cleanup in `.spur/run/1302/readiness-journey.json`. DOM rendering uses happy-dom, not a real browser. Focused tests plus the journey total **330 pass, zero failures**.
- `bun .spur/run/1302/review-scale-probe.ts` — 100/300/600 ready tasks require 200/600/1200 parses (observed 45/60/108 ms); `.spur/run/1302/review-scale-probe.json`. The review recorded 360,600 parses for 600 tasks before the index. The parse bound is deterministic; timing is an observation on this machine.
- `bun run --filter @gobing-ai/spur-app --filter @gobing-ai/spur-contracts --filter @gobing-ai/spur-server --filter @gobing-ai/spur-web --filter @gobing-ai/spur typecheck` — all five PASS; `.spur/run/1302/typecheck-final.log`.
- `bun apps/cli/src/index.ts task gate 1302 light` — receipt **FAIL**. Nine checks PASS: changed-file Biome, all 51 pre-check rules, four changed-workspace typechecks, and all three related test groups. Post-check stops at coverage provenance because Git tree capture cannot write objects: git add -A reports Operation not permitted. The driver exits zero despite the FAIL receipt; the receipt is authoritative. `.spur/run/1302-check-receipt.json`, `.spur/run/1302-light-gate.log` and `.spur/run/1302/light-final.log` retain the result. The earlier full-tier receipt was preserved as `.spur/run/1302/before-final-light-receipt.json`; it does not certify this changed tree.
- Source/test/contract-document whitespace checks pass. Full git diff --check retains the pre-existing task-file trailing blank line generated by the task CLI. The Git object-write restriction also prevents the required task commit; changes remain reviewable in the working tree.

No escalation transcript exists and no operator decision was needed. No full gate was run from implement. The calling pipeline owns the full gate, fresh review certification, Testing, lifecycle completion and commit when Git metadata writes are available. No full-gate PASS, fresh coverage certification, real-browser PASS or task completion is claimed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/planning-readiness.ts:63` composes deterministic readiness and exact blockers; `packages/app/tests/services/planning-readiness.test.ts:22` covers ready, cross-folder/missing/unfinished/deprecated dependencies, incomplete sections and paused work; `apps/server/tests/modules/task/readiness.test.ts:8` verifies real HTTP/context/run wiring with zero model/job dispatches; `apps/web/tests/modules/task-kanban/readiness.test.ts:35` verifies displayed advice. Fresh CLI/HTTP/DOM journey passes. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Daily readiness explains work and exact blockers (req: R1) | MET | test | `(cd apps/web && bun test apps/web/tests/modules/task-kanban/readiness.test.ts)` passes with 11 assertions across CLI checking, HTTP and rendered ready/blocker/incomplete/paused advice; `packages/app/tests/services/planning-readiness.test.ts:22` covers fixture states; `packages/app/tests/services/planning-readiness.test.ts:83` rejects ambiguous/unreadable inputs; `apps/server/tests/modules/task/readiness.test.ts:8` verifies zero model/job dispatches; `apps/web/tests/modules/task-kanban/readiness.test.ts:35` verifies display-only commands and paused links. Task-local AC identity retained. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1302

**Scope:** Working tree at `73fed5205`; no implementation commit tagged `(1302)` exists. Reviewed all 18 changed/new implementation, test and contract-document files; task record excluded from implementation scope.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | efficiency, architecture | The earlier quadratic sibling-parsing defect is resolved by an operation-scoped child index. Fresh probe: 100/300/600 tasks require 200/600/1200 parses; 600 tasks took 141 ms on this machine. Regression checks bound parsing and preserve standalone checker behavior for raw child statuses, parent aliases, cross-folder children and self-references. | `packages/app/src/services/planning-readiness.ts:92`; `packages/app/src/services/task-check.ts:1287`; `packages/app/tests/services/planning-readiness.test.ts:130`; `packages/app/tests/services/planning-readiness.test.ts:167` | RESOLVED |
| 2 | P4 (advisory) | verification | No open P1–P3 findings remain after all six dimensions. Completion evidence remains limited: gate reuse is refused because Git object writes are denied; target-testing check reports placeholder-only Testing. The pipeline must record Testing and establish current gate provenance before completion. Rendering is verified with happy-dom; real-browser behavior remains unverified. Existing task-record EOF whitespace remains. | `.spur/run/1302/902ce976-gate-status.json:1`; `.spur/run/1302/902ce976-structural.json:1`; `apps/web/tests/modules/task-kanban/readiness.test.ts:6`; `.spur/run/1302/902ce976-whitespace.log:1` | ACCEPTED |

##### Design and Architecture

The application projection owns readiness policy composition over the shared snapshot, existing checker and run-store read. The additive HTTP contract preserves task-list payloads. Both existing views use one display-only panel; invalidations coalesce, scope changes/unmount abort requests, and stale responses are discarded. Dependency resolution precedes folder filtering; incomplete inputs suppress recommendations. No additional security, correctness, usability or architectural defect was found.

Evidence: `packages/app/src/services/planning-readiness.ts:63`; `packages/contracts/src/task.ts:155`; `apps/server/src/modules/task/handlers.ts:39`; `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx:10`; `apps/web/src/modules/task-kanban/TasksShell.tsx:203`; `apps/web/src/modules/features/FeatureDetail.tsx:789`; `docs/design/planning-record-contracts.md:23`.

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | PASS | Frozen projection, additive read, existing-view panel, display-only action, incomplete-input suppression and CLI/HTTP/DOM proof are implemented; `packages/app/src/services/planning-readiness.ts:63`; `apps/web/tests/modules/task-kanban/readiness.test.ts:35`; `apps/server/tests/modules/task/readiness.test.ts:8`. |

##### Fresh Verification

- App focused checks: 221 pass, 0 fail; `.spur/run/1302/902ce976-app.xml:2`.
- Server focused checks: 33 pass, 0 fail; `.spur/run/1302/902ce976-server.xml:2`.
- Web focused checks: 37 pass, 0 fail; `.spur/run/1302/902ce976-web.xml:2`.
- CLI focused checks: 38 pass, 0 fail; `.spur/run/1302/902ce976-cli.xml:2`.
- `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)`: 1 pass, 0 fail, 11 assertions; `.spur/run/1302/902ce976-journey.log:1`. The repeatable fixture proves source-local CLI target-todo checking, contracted HTTP and rendered ready/blocker/paused output, zero model/job dispatches and final subscription cleanup; `.spur/run/1302/readiness-journey.json:1`. Total: 330 pass, 0 fail.
- Five affected-workspace typechecks pass; `.spur/run/1302/902ce976-typecheck.log:1`. Changed-file Biome checks all 17 TypeScript files without fixes; `.spur/run/1302/902ce976-biome.log:1`.
- `bun .spur/run/1302/review-scale-probe.ts` confirms linear parse counts; `.spur/run/1302/review-scale-probe.json:1`.
- `bun apps/cli/src/index.ts task gate 1302 status` refuses reuse because Git object writes are denied. `bun apps/cli/src/index.ts task check 1302 --as testing --json --no-logo` fails only on placeholder Testing. Neither is a passing completion gate. This review did not rerun the full gate or change lifecycle status.

##### Task Outcome

| WBS | Outcome | Open P1 | Open P2 | Open P3 |
| --- | --- | --- | --- | --- |
| 1302 | PASS | 0 | 0 | 0 |

**Next:** Pipeline records Testing and establishes current gate provenance before lifecycle completion. Review-only execution made no production fixes.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/planning-readiness.ts:63` composes deterministic readiness and exact blockers; `packages/app/tests/services/planning-readiness.test.ts:22` covers ready, cross-folder/missing/unfinished/deprecated dependencies, incomplete sections and paused work; `apps/server/tests/modules/task/readiness.test.ts:8` verifies real HTTP/context/run wiring with zero model/job dispatches; `apps/web/tests/modules/task-kanban/readiness.test.ts:35` verifies displayed advice. Fresh CLI/HTTP/DOM journey passes. |

##### Acceptance Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: AC1 — Daily readiness explains work and exact blockers (req: R1) | MET | test+command | `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)` passes with 11 assertions across CLI checking, HTTP and rendered ready/blocker/incomplete/paused advice; `packages/app/tests/services/planning-readiness.test.ts:22` covers fixture states; `packages/app/tests/services/planning-readiness.test.ts:83` rejects ambiguous/unreadable inputs; `apps/server/tests/modules/task/readiness.test.ts:8` verifies zero model/job dispatches; `apps/web/tests/modules/task-kanban/readiness.test.ts:35` verifies display-only commands and paused links. Task-local AC identity retained. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T03:01:03.750Z todo → wip (system)
- 2026-11-06T03:53:08.633Z wip → testing (system)
- 2026-11-06T03:54:08.985Z testing → done (system)

