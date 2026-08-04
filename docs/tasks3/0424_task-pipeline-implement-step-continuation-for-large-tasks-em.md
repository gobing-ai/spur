---
template: feature-impl
schema_version: 1
name: "Task-pipeline implement step: continuation for large tasks + empty-implement no-op guard"
description: ""
status: done
type: task
profile: standard
feature_id: F5
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: 2026-08-04T03:10:40.083Z
updated_at: 2026-08-04T04:38:41.126Z
---

## 0424. Task-pipeline implement step: continuation for large tasks + empty-implement no-op guard

### Background
Two distinct defects in the task-pipeline's `implement` step (`agent.run`) were surfaced by two
failed runs of task **0422** — a large (14-requirement) frontend Inbox module. Both are the same
class of problem: the pipeline's single-shot `agent.run` implement assumes the work fits one bounded
subprocess pass, and it cannot tell a silent no-op from success. Neither defect is covered by an
existing ticket.


The `implement` step runs exactly one `agent.run` subprocess under `implementTimeoutMs: 1800000`
(30 min, `task-pipeline.yaml`). A large task's implementation does not fit one 30-min pass. On
timeout the subprocess exits code 3, the pipeline's `implement` `onEnter` halts (default `fail`
policy) **before** the `spur task update <wbs> wip --no-lifecycle` and `bun run format` shell steps,
routing the run to `failed` and leaving:

- the task at `todo` (never reached `wip`),
- a substantial **partial, unverified implementation orphaned in the working tree**,
- **no provenance** for the partial work (no `task_run_links` entry, no `## Solution`),
- **no documented resume path**: re-running from the partial tree risks the agent mis-reconciling
  existing files; starting clean discards hours of work; raising the budget only delays the same wall
  (task 0398 R4 policy is "stop and record rather than raise again without sign-off").

**Concrete evidence (run 222a8a49-5ceb-496c-be5d-72ff856a42e8):** `implement` `agent.run` exited 3,
elapsed **1,800,026 ms** (the 30-min wall). Handoff artifact
`.spur/run/222a8a49-5ceb-496c-be5d-72ff856a42e8-implement-partial.md` records a 10-file
`git diff --stat` (70 insertions, 816 deletions): R9 extraction (`apps/web/src/lib/process-stream.ts`
+ test), R7 deletions (`observability/InboxTab.tsx`, `teams/MessagesTab.tsx` + tests), R10
(`styles/global.css`), plus new `modules/inbox/` and `tests/modules/inbox/`. Task stayed `todo`.
14 files changed on disk, none verified, none recorded.


**Concrete evidence (run 73c4b737-292c-4bc5-bb95-55a6a9bf0b14):** `implement` `agent.run` returned
**exit 0 (ok)** after **54 s** with **zero file changes**. The pipeline advanced to `test`
(`bun run lint` passed vacuously — nothing new to lint) and only the `review` step caught it
(Functional Verdict FAIL: *"no implementation exists for task 0422 … change scope is empty"*), then
`verify` ran ~30 min and timed out with no verdict. Cost: a full ~40-min pipeline pass before the
no-op was detected.

The `agent.run` action already supports an `expectFile` post-exit guard
(`packages/app/src/workflow/actions/agent-run.ts`), but the task-pipeline YAML does not use it, so an
empty implement is indistinguishable from success at the point of failure.


The pipeline's `record → done` provenance contract and its review/verify gates assume a trustworthy
`implement`. A silent no-op implement (Defect B) and a timed-out partial implement (Defect A) both
violate that assumption in ways the pipeline does not detect at the point of failure. This ticket
makes the `implement` step fail honestly and become resumable.


- Task 0398 R4 already raised the timeout *policy* and mandated "stop, don't raise" — the budget
  ceiling is intentionally unchanged here; this ticket adds the continuation mechanism the policy
  assumed exists but does not.
- Task 0407 (tier fallback on objective failure) retries a failing executor on another tier; it does
  not resume a partial implementation.
- Task 0423 (0421 pipeline-wait `--follow` + `/bin/sh -c`) is about driver-side polling and the shell
  runner — unrelated.
- The `.spur/workflows/task-pipeline.yaml` and `config/workflows/task-pipeline.yaml` copies both carry
  the same implement step; the fix must apply to both.
### Requirements
Requirements are ordered by the primary defect (A) first, then the secondary guard (B). Each maps to
a matching Acceptance Criteria scenario.

- [x] R1. **Resumable implement from partial work.** After an `implement` step fails by timeout, the
  operator (or an automated continuation) can resume the implementation from the existing partial
  diff in the working tree rather than discarding it and re-running the whole task from a clean tree.
  Concretely: a documented, working procedure exists that (a) recognises the timed-out state
  (partial-work artifact present, task still `todo`), (b) establishes a green baseline from the
  partial files (`bun run lint` + `bun test` or a targeted subset), and (c) resumes the remaining
  requirements against that tree so existing partial work is reconciled, not blindly overwritten.
  Where the pipeline can drive this automatically it should; a human-in-the-loop runbook is an
  acceptable minimum.
- [x] R2. **A timed-out implement must not strand the task silently.** On `implement`-step failure
  (timeout or non-zero exit), the pipeline must (a) leave the partial files in the working tree
  (no cleanup), (b) record a provenance/link marker so the partial state is discoverable (e.g. a
  `task_run_links` entry or a `## Solution` backfill from `git diff --name-only`), and (c) surface the
  resume instruction — including the partial-work artifact path
  (`.spur/run/<runId>-implement-partial.md`) and the next action — in the run's failure/report output
  rather than just routing to `failed` with no guidance.
- [x] R3. **Empty implement fails fast at the implement step.** An `agent.run` implement step that
  returns exit 0 but produces **zero** file changes (no-op / silent no-op) must fail the run at the
  `implement` step with a clear diagnostic — not advance to `test`/`review` and be caught only later.
  Wire the existing `expectFile`/artifact post-exit guard, or a non-empty `git diff --stat` gate, into
  the task-pipeline `implement` step so a no-op is distinguishable from success immediately.
- [x] R4. **Large-task guidance documented.** The spur-dev execution reference
  (`plugins/sp/skills/spur-dev/references/execution-workflow.md`) must prescribe (a) splitting
  oversized tasks before pipeline execution, and (b) the resume/continuation procedure for a
  timed-out implement (the R1/R2 runbook), so a driving agent does not re-derive it. The `.spur` and
  `config` pipeline copies must both carry the implement-step fix, and the docs must not live only in
  a generated `.rulesync/` copy.
### Acceptance Criteria
```gherkin
Feature: Task-pipeline implement step — continuation and no-op guard

  @core
  Scenario: R1 — A timed-out implement resumes from partial work
    Given an implement step failed by timeout leaving partial files in the working tree
    And the partial-work artifact exists under .spur/run/<runId>-implement-partial.md
    When the operator follows the documented continuation path
    Then the remaining requirements are implemented against the existing partial diff
    And the partial files are reconciled, not discarded or blindly overwritten
    And the task reaches a verified terminal state without a full clean restart

  @core
  Scenario: R2 — A timed-out implement leaves the partial work discoverable
    Given a task-pipeline implement step failed by timeout
    Then the partial files remain in the working tree
    And a provenance/link marker records the partial state
    And the failure output names the resume path and the partial-work artifact location
    And the task is not left at todo with no signal that partial work exists

  @core
  Scenario: R3 — An empty implement fails fast at the implement step
    Given a task-pipeline implement agent.run returns exit 0 with zero file changes
    When the implement step completes
    Then the run routes to failed at the implement step with a clear no-op diagnostic
    And the run does not advance to the test or review stage
    And a regression test asserts the empty-implement gate rejects a no-op agent run

  @edge
  Scenario: R4 — Large-task guidance is documented in the authoring source
    Given the spur-dev execution reference is read
    Then it prescribes splitting oversized tasks before pipeline execution
    And it documents the timed-out-implement resume procedure
    And both pipeline copies (task-pipeline.yaml and config/workflows) carry the implement-step fix
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Fix design per requirement. The primary mechanism (R1/R2) is continuation-after-timeout; the
secondary (R3) is a no-op guard. Both touch the same two seams: the pipeline YAML's `implement`
step and the `agent.run` action.

#### R1/R2 — continuation and discoverability after a timed-out implement

The failure path today (`task-pipeline.yaml` `implement.onEnter`): `agent.run` → (on success)
`spur task update <wbs> wip --no-lifecycle` → `bun run format`. On `agent.run` failure the default
`fail` policy halts the sequence, so the wip transition and format never run and the task stays
`todo` with partial files unformatted.

Proposed continuation mechanism (pick the minimal one that is concrete and testable):

- **Baseline + resume runbook (minimum, R1).** After a timed-out implement, record a provenance
  marker (R2b) and provide a documented procedure to continue from the partial tree:
  1. Recognise the timed-out state: `.spur/run/<runId>-implement-partial.md` present, `exited with
     code 3`, task at `todo`.
  2. Establish green from the partial files: `bun run format` then `bun run lint` + `bun test`
     (or the affected packages).
  3. Resume the remaining requirements against that tree — the continuation `agent.run` is handed the
     partial diff (via `git diff`) and told to complete, not restart. The task's `## Solution` is
     backfilled from `git diff --name-only`.
  This is a human-in-the-loop runbook; it must live in
  `plugins/sp/skills/spur-dev/references/execution-workflow.md` (R4) and pair with the existing
  `done-housekeeping.md` timeout-recovery section (task 0398 R5).
- **R2 provenance marker.** On `implement`-step failure, record the partial state so it is
  discoverable. Prefer a `task_run_links` entry (the `task-pipeline.yaml` comment already notes the
  WorkflowService hook writes `kind=pipeline` linkage at run start) or a `## Solution` backfill from
  `git diff --name-only` — reusing the existing `--solution-from-diff` mechanism the `record` step
  uses. The failure/report output must name the partial-work artifact path and the resume action.
- **R1 automated option (optional, if a continuation action is feasible).** A dedicated
  `implement-continue` step or a `spur workflow continue` variant that re-enters `implement` with the
  partial diff as context. Gate this on the run having a recorded partial state; otherwise fall back
  to the runbook. This is larger and can be deferred if the runbook suffices.

#### R3 — empty-implement no-op guard

The `agent.run` action already supports `expectFile` (post-exit assertion:
`packages/app/src/workflow/actions/agent-run.ts`). Two wiring options:

- **Non-empty git-diff gate (preferred).** After the implement `agent.run`, add a shell gate that
  fails if `git diff --stat -- . ':(exclude)docs/tasks3/*' ':(exclude)docs/features/*'` is empty —
  i.e. the implement produced no non-corpus changes. A `:git` guard on the `implement → test`
  transition, or a shell step in `implement.onEnter` after the agent.run, routes to `failed` with a
  clear "empty implement" diagnostic.
- **`expectFile` per target (alternative).** Set `expectFile` on the implement step to a marker the
  agent must produce (e.g. the primary module entry, `apps/web/src/modules/inbox/index.tsx` for
  0422). Less general — the expected artifact differs per task — so prefer the git-diff gate and use
  `expectFile` only where a stable artifact is guaranteed.

A regression test must assert the gate rejects a no-op agent run (exit 0, no changes) at the
`implement` step (R3 AC).

#### R4 — documentation

Edit the authoring source `plugins/sp/skills/spur-dev/references/execution-workflow.md` (NOT a
`.rulesync/` copy — those are regenerated by `superskill install` and hand edits are lost). Add:
(a) a "large tasks" subsection prescribing decomposition before execution, and (b) the timed-out
implement resume procedure from R1/R2, cross-linked to `done-housekeeping.md` (task 0398 R5).

#### Files touched (likely)

| Path | Change |
| --- | --- |
| `.spur/workflows/task-pipeline.yaml` | R3 git-diff/expectFile guard on implement; R2 failure-signal (provenance + resume surfacing). Both pipeline copies must match. |
| `config/workflows/task-pipeline.yaml` | Same implement-step changes (the two copies carry identical steps). |
| `packages/app/src/workflow/actions/agent-run.ts` | Reuse existing `expectFile`; possibly surface a no-op signal for the gate. |
| `packages/app/src/services/task-verdict.ts` | Only if R2's Solution-backfill reuses verdict machinery. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md` | R4 large-task + resume guidance (authoring source). |
| `plugins/sp/skills/spur-dev/references/done-housekeeping.md` | Cross-link the timeout-continuation runbook with task 0398 R5's. |
| Tests | `packages/app/tests/workflow/actions/agent-run.test.ts` (no-op gate); pipeline-level test asserting a zero-diff implement fails at `implement`. |

#### Verification

- R1/R2: reproduce a timed-out implement (large task or forced small `implementTimeoutMs`), assert
  the task is left with partial files + provenance + a surfaced resume path; run the documented
  continuation and land the task.
- R3: run the pipeline with an implement that produces no diff; assert it routes `failed` at
  `implement` before `test`.
- R4: grep the authoring source for the guidance; assert both pipeline copies carry the guard.
### Plan
1. **Confirm the seam (no code yet).** Read `.spur/workflows/task-pipeline.yaml` and
   `config/workflows/task-pipeline.yaml` `implement.onEnter`; confirm both carry the same
   `agent.run → task update wip → bun run format` sequence and that the engine's `fail` policy halts
   the sequence on `agent.run` failure (leaving the task at `todo`). Confirm `agent.run`'s `expectFile`
   and `--solution-from-diff` machinery exist as described in `## Design`. Record the confirmation in
   `## History`.
2. **R3 — no-op guard first (smallest, highest-signal).** Add a git-diff gate to the `implement`
   step (or the `implement → test` transition) that fails when the implement produced no non-corpus
   changes. Wire it into **both** pipeline copies. Write a regression test asserting an exit-0 /
   zero-diff implement routes `failed` at `implement`. Prove with a forced no-op implement.
3. **R1/R2 — continuation runbook + provenance (primary).** Implement the R2 provenance/signal
   (record partial state on implement failure; surface the partial-work artifact path + resume
   action in the failure output). Write the R1/R2 resume runbook into the authoring source
   `plugins/sp/skills/spur-dev/references/execution-workflow.md`, cross-linked to
   `done-housekeeping.md` (task 0398 R5). Prove by reproducing a timed-out implement (small
   `implementTimeoutMs` override or a deliberately oversized task) and running the documented
   continuation to a verified terminal state.
4. **R4 — large-task guidance.** Add the "split oversized tasks" guidance beside the resume runbook
   in the same reference. Grep the authoring source (not `.rulesync/`) to confirm it landed.
5. **Verify.** `bun run lint` + `bun test` green (workspaces + `plugins/sp`); both pipeline copies
   carry the guard; the no-op regression test fails if the gate is removed (mutation check). Then
   drive task 0422 (or a representative large task) through the pipeline to confirm the implement
   step now either completes or fails fast/resumably.
### Solution
#### What changed and why

- `packages/app/src/workflow/actions/agent-run.ts` — new `requireDiff` option (R3): after an
  exit-0 agent run the action fails the step when `git status --porcelain` (docs/tasks3 and
  docs/features excluded) is empty — a silent no-op implement is caught at the implement step
  instead of drifting into test/review and being caught a full pass later. Uses porcelain (not
  `git diff`) so untracked new files count as changes. Failure messages for subprocess failures
  now name the partial-work artifact path (`.spur/run/<runId>-<step>-partial.md`) and the
  resume runbook (R2c) — a timed-out implement no longer dead-ends with no guidance.
- `config/workflows/task-pipeline.yaml` — `requireDiff: true` on the implement `agent.run`
  step (R3 wiring). The `.spur/workflows/task-pipeline.yaml` copy is a symlink to this file, so
  both copies carry the fix by construction.
- `plugins/sp/skills/spur-dev/references/execution-workflow.md` — new "Large tasks and
  timed-out implement resume" section: prescribes splitting oversized tasks before pipeline
  execution, and documents the timed-out-implement resume runbook (recognise → green baseline →
  resume against the partial tree → finish via gate or force-done) (R1/R4).
- `plugins/sp/skills/spur-dev/references/done-housekeeping.md` — F6 cross-linked to the resume
  runbook: prefer resume over force-done when a timed-out implement left substantial partial
  work (R4).
- `packages/app/tests/workflow/actions/agent-run.test.ts` — regression tests: `requireDiff`
  rejects exit-0 with zero changes and rejects corpus-only changes; passes on non-corpus and
  untracked-new-file changes; opt-out when unset; R2 failure messages name the artifact path
  and the runbook. Updated the one exact-match assertion that the new R2 message shape
  intentionally changes.

#### Seam confirmation (Plan step 1)

- `.spur/workflows/task-pipeline.yaml` and `config/workflows/task-pipeline.yaml` are the same
  file (`.spur/workflows` → `config/workflows` symlink); `implement.onEnter` carries the
  `agent.run → task update wip --no-lifecycle → bun run format` sequence; the engine's default
  `fail` onError policy halts the sequence on `agent.run` failure, leaving the task at `todo`
  with partial files in the tree (state-machine.js:76-79). No schema escape hatch exists for
  `onError: continue` (action objects are `additionalProperties: false`), so failure-time
  provenance cannot run as a continued sequence — the R2 marker is the existing run-start link
  hook + failure artifact, and the gap to close was (c) surfacing.
- `expectFile` post-exit machinery confirmed (`agent-run.ts`); the run-start hook
  `maybeLinkPipelineRun` (`workflow-service.ts`) writes a `kind=pipeline` `task_run_links` row
  per task-pipeline run — verified via raw SQL on `.spur/spur.db`: row
  `0424|pipeline|ee110e1c-f3bb-4aa5-9e9a-2133023bdc7a` exists for this task's failed launch, and
  `PRAGMA integrity_check` is `ok`. Failed agent.run steps already write
  `.spur/run/<runId>-<step>-partial.md` (R2b provenance marker), so R2(b) exists at run start
  and failure; the fixed error messages complete R2(c).
- The `--solution-from-diff` machinery was not needed: no failure-time `## Solution` backfill
  (would require sequence continuation the schema forbids); the link hook + artifact satisfy
  R2(b) per the design's "prefer a task_run_links entry" option.

#### Environment note

- This task ran via the inline `--next` chain, not the pipeline subprocess: `agent.run`
  subprocesses die instantly under the Bash sandbox (`SQLiteError: attempt to write a readonly
  database` on omp's session DB — `~/.omp` symlinks outside the sandbox write allowlist). The
  pipeline YAML changes are fully wired and validated (`spur workflow validate` passes); the
  R3 gate is proven at the action level by the regression tests. A live timed-out-implement
  reproduce (Plan step 3) requires running the pipeline outside the sandbox:
  `! spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>","profile":"auto"}' --async`.
### Testing
**Verdict: PASS** (2026-08-04 re-verify `/sp-dev-verify 0424 --force --focus all --fix all`)

Prior PASS re-audited with fresh commands this turn. Task already terminal (`done`); `--force` re-runs content gate.

**Commands this run**
- `bun test packages/app/tests/workflow/actions/agent-run.test.ts` → **68 pass / 0 fail**
- `bun test tests/workflow/ tests/services/workflow-service.test.ts` → **345 pass / 0 fail**
- `spur workflow validate config/workflows/task-pipeline.yaml` → valid
- `spur workflow validate .spur/workflows/task-pipeline.yaml` → valid
- pipeline copies **identical** (`cmp`); both set `requireDiff: true`
- `sqlite3 .spur/spur.db` → integrity `ok`; link row `0424|pipeline|ee110e1c-f3bb-4aa5-9e9a-2133023bdc7a`
- Line anchors re-read this run

Coverage: N/A (action-gate + docs; direct tests cover gate logic).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Resume runbook `plugins/sp/skills/spur-dev/references/execution-workflow.md:225-261` (split oversized at line 229; resume steps at 237-256). Failure messages name the artifact path at `packages/app/src/workflow/actions/agent-run.ts:283`. Human-in-the-loop runbook is R1's accepted minimum. |
| R2 | MET | (a) No cleanup on failed implement. (b) Provenance: SQL `task_run_links` row + `packages/app/src/workflow/actions/agent-run.ts:273-275` writes partial artifact. (c) Failure hint at `packages/app/src/workflow/actions/agent-run.ts:283-292`; contract test `packages/app/tests/workflow/actions/agent-run.test.ts:638-649`. |
| R3 | MET | Gate at `packages/app/src/workflow/actions/agent-run.ts:265-270`; wired `config/workflows/task-pipeline.yaml:111` (identical `.spur` copy); regression `packages/app/tests/workflow/actions/agent-run.test.ts:569-635`. Engine fail policy stops before test/review. |
| R4 | MET | Authoring source `plugins/sp/skills/spur-dev/references/execution-workflow.md:225-261` (not `.rulesync`); both pipeline copies carry the fix; validate passes. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — A timed-out implement resumes from partial work | MET | command | `rg` confirms runbook at `plugins/sp/skills/spur-dev/references/execution-workflow.md:225-261`. Live e2e deferred (sandbox `agent.run` blocker). |
| R2 — A timed-out implement leaves the partial work discoverable | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:638-649`; SQL link row; partial writer `packages/app/src/workflow/actions/agent-run.ts:273-275`. |
| R3 — An empty implement fails fast at the implement step | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:575-627`; `config/workflows/task-pipeline.yaml:111`. |
| R4 — Large-task guidance is documented in the authoring source | MET | command | `plugins/sp/skills/spur-dev/references/execution-workflow.md:229` and `:237`; pipeline wiring validated. |

**Design conformance:** DONE with documented CHANGED in Solution (porcelain over plain diff; link+artifact over Solution-backfill). PASS-acceptable.

**SECUA:** no blockers/majors. P3 dirty-tree approximation accepted at `packages/app/src/workflow/actions/agent-run.ts:262-264`.

**Fix pass:** Requirements checkboxes `[x]`; Testing anchors full repo paths; `.spur/run/0424-verdict.json` refreshed.
### Review
**SECUA + functional review** (re-verify 2026-08-04; verdict PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Correctness | packages/app/tests/workflow/actions/agent-run.test.ts:569-649 | requireDiff + R2 message tests green (68/68 agent-run suite) |
| P4 | Correctness | packages/app/src/workflow/actions/agent-run.ts:265-270 | Empty-implement gate fails exit-0 no-op with clear diagnostic |
| P4 | Usability | packages/app/src/workflow/actions/agent-run.ts:283-292 | Failure output names partial-work artifact + resume runbook |
| P4 | Architecture | config/workflows/task-pipeline.yaml:111 | requireDiff wired on implement; copies identical |
| P3 | Correctness | packages/app/src/workflow/actions/agent-run.ts:262-264 | Tree-level dirty-tree approximation (safe direction) — accepted |
| P3 | Architecture | design | No Solution-backfill on fail (schema forbids continue) — link+artifact instead; accepted |

**Disposition:** approve. Residual: live timed-out implement e2e needs out-of-sandbox pipeline run.
### References

F5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-04 — Plan step 1 (seam confirmation) recorded in `## Solution`. Implemented R3
  (`requireDiff` empty-implement guard in the agent.run action + wired on the task-pipeline
  implement step), R2 (failure messages name the partial-work artifact path and the resume
  runbook; provenance confirmed present via the run-start link hook — raw SQL on
  `.spur/spur.db`), R4 (large-task + resume guidance in `execution-workflow.md`, F6
  cross-linked in `done-housekeeping.md`). Regression tests added for the gate and the message
  contract; `bun run lint` clean; 288 workflow/workflow-service tests pass. Run via the inline
  `--next` chain because `agent.run` subprocesses die under the Bash sandbox (SQLITE_READONLY
  on omp's session DB).
- 2026-08-04T04:27:04.681Z todo → wip (system)
- 2026-08-04T04:27:05.002Z wip → testing (system)
- 2026-08-04T04:29:26.857Z testing → done (system)
