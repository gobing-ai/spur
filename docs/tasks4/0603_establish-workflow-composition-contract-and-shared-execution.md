---
schema_version: 1
name: "Establish workflow composition contract and shared execution infrastructure"
status: done
template: feature-impl
created_at: 2026-08-19T20:03:57.619Z
updated_at: "2026-08-19T22:35:04.960Z"
feature_id: D5
priority: P2
tags: ["workflow", "infrastructure", "observability"]
---

## 0603. Establish workflow composition contract and shared execution infrastructure

### Background
Establishes the prerequisite contract and reusable runtime capabilities **before any shipped pipeline YAML is migrated**. Implements feature D5 scenarios R1–R6. Task 0604 depends on this work and owns the staged migrations.

**Rubric:** E2 D1 L2 C2 R2 = 9 → standalone task (force: high-risk cross-cutting runtime and ADR seam). Operator-directed decomposition is exactly two WBS tasks; D5-A–D5-H are internal Plan items, not child tasks.

**Premise verification (2026-08-19 tree, not deferred to implement):**

- Shipped pipeline inventory under `config/workflows/`: `docs-pipeline.yaml`, `idea-pipeline.yaml`, `planning-pipeline.yaml`, `task-pipeline.yaml`, `task-pipeline2.yaml`, `wrapup-pipeline.yaml`, plus separate `pr-review.yaml`. `feature-dev.yaml` is a caller/orchestrator, not a seventh lifecycle owner.
- `task-pipeline2.yaml` is a parallel I6 file: `residual-sweep` is an editing-capable `agent.run` after verify PASS (around line 505) then `record` with no re-run of quality/review/verify. Live default remains `task-pipeline.yaml`. Promotion comparator already exists: `scripts/spur-dev.ts eval-pipeline` (task 0595).
- Live verify hop is `/sp:dev-verify … --fix all` (`stateEffect: may-write`); it cannot establish digest-bound `verified`.
- ADR-069/070/071/072 exist in `docs/00_ADR.md` as **Proposed** (taste gate pending). ADR-029 remains Accepted “defer planning-pipeline fate”; ADR-072 would amend it to absorb/retire. Do not flip those statuses in this task.
- `config/workflow-composition-baseline.json` is **absent** (named only in `docs/design/workflow-composition-contract.md`).
- Progress DTO and follower contract are design-only (`docs/design/workflow-observability.md` §D5; `docs/03_ARCHITECTURE.md` §21). No `projectWorkflowProgress` module exists.
- Builtins live in `packages/app/src/workflow/builtins.ts`. Current kinds: `agent.run`, streaming `shell` (bare command still uses `/bin/sh -c`), file/confirm/select/input/http/rule. **No** `command.gate` or `run.artifact`.
- Persistence already present: `RunDao`, `PhaseRunDao`, `TransitionRunDao`, `ActionRunDao` (`node`+`kind`, not definition action key), `ArtifactDao` (path+kind+optional runId). `RunDao.stampMetadata` **replaces** `metadata_json` (`packages/domain/src/dao/run-dao.ts:100`); `stampFailureReason` already `json_set`-merges. Sole production caller of replace-stamp: `packages/app/src/services/workflow-service.ts:573` (`{ dryRun: true }`).
- `followSystemEventsAfter` shipped (task 0531) in `packages/app/src/services/system-event-follow.ts` (poll 100 ms, sequence cursor). Occupant wait/message remain identity-pinned.
- Alternate-index snapshot used by `agent.run` is the fingerprint substrate to deepen, not a new hasher to invent.

**Out of scope (this task):** editing live `config/workflows/*.yaml` (except adding test fixtures under `packages/app/tests/` or `tests/`); accepting/rejecting Proposed ADRs; public `spur workflow` JSON/human output; E7 run-record retention; J9/J91 presentation; role-addressed wait/message; new public CLI noun/verb/flag.
### Requirements
- [x] R1. Workflow composition rules are recorded and linked without duplicated authority: ADR-069/070/071/072 in `docs/00_ADR.md` remain the decision records; `docs/03_ARCHITECTURE.md` §§20–21 stay mechanism; `docs/design/workflow-composition-contract.md` and `docs/design/workflow-observability.md` stay surface; ADR-029 is **not** flipped to Accepted-retired in this task — ADR-072 remains the named amendment. Public-surface consent stays ADR-051 (no new `spur` noun/verb/flag/JSON/human field).
- [x] R2. Every reviewed pipeline has a frozen baseline: `config/workflow-composition-baseline.json` is committed and **truthful to live YAML on first land**. A two-sided checker in `packages/app` (not a new public CLI) fails on unresolved graph, caller, terminal, artifact-owner, failure-policy, model-query location, action kind, or `stateEffect`/`evidenceEffect` drift, **and** fails if a listed baseline entry no longer reproduces. Covered workflows: docs, idea, planning, task, task-pipeline2, wrap-up, and separate pr-review.
- [x] R3. One detailed persisted progress projection exists: `projectWorkflowProgress(runId)` in `packages/app/src/workflow/progress-projection.ts` returns the frozen `WorkflowProgressProjection` DTO (Design) from the resolved definition plus existing run/phase/transition/action/artifact rows. Inline and engine-driven consumers share that function. No new table, EventBus store, or public trace field.
- [x] R4. Event wakeups cannot mutate workflow truth: a follower snapshots `system_events.sequence`, projects from persistence, then `followSystemEventsAfter` with `sequence > snapshot`. Correlated events only wake a re-query. Reconnect, duplicate, missed-event, sparse-stream, and bounded-poll fixtures return the same projection; payloads never authorize transitions.
- [x] R5. Deterministic capabilities have explicit owners: `command.gate` and `run.artifact` are registered in `registerSpurBuiltins`; `ProofInputFingerprint` is a tested module; `RunDao` metadata writes used for definition digest and dry-run **merge** (never replace). Product semantics stay in existing app/CLI services. Live shipped YAML still uses current `shell`/`agent.run` until 0604. Filesystem/process access is confined (`.spur/run/` for artifacts/result files; literal executable/args for gates).
- [x] R6. Role-aware coordination preserves occupant identity: `agent.run` keeps role-based executor selection; `agent wait` / `message` remain pinned to spec+run+generation. No raw role addressing. Any future exact-one role bind is deferred until a concrete caller, cardinality-one resolution, persisted occupant pin, and ADR-051 consent exist.

**Non-goals:** pipeline graph edits; flipping Proposed ADR status; public progress CLI; spending eval-pipeline quota on current unsafe pipeline2.
### Acceptance Criteria
```gherkin
Feature: Workflow contract and shared execution infrastructure

  Scenario: R1 — Workflow composition rules are authoritative and enforceable
    Given ADR-069/070/071/072 exist as Proposed entries and ADR-029 still defers planning-pipeline fate
    When this task's documentation and code land
    Then YAML/shell/deterministic/agent ownership, observability-as-wakeup, and post-PASS invalidation are each named in exactly one ADR plus one architecture section
    And no new public spur noun, verb, flag, JSON field, or human-output contract is introduced
    And ADR-029 status is unchanged in this task

  Scenario: R2 — Every shipped pipeline has a reviewed disposition and frozen baseline
    Given live definitions at config/workflows/{docs,idea,planning,task,task-pipeline2,wrapup}-pipeline.yaml and pr-review.yaml
    When config/workflow-composition-baseline.json is generated and the checker runs
    Then the baseline matches the resolved graphs (not raw YAML text)
    And each workflow records disposition, callers, terminals, artifacts, failure policy, model-query locations, and per-action stateEffect/evidenceEffect
    And a field-level diff fails the checker until baseline and definition are updated together
    And a listed entry that no longer reproduces also fails

  Scenario: R3 — Long runs expose one detailed persisted todo projection
    Given running, looping, failed, skipped, cancelled, and completed fixture rows including retry attempts
    When projectWorkflowProgress(runId) is invoked for an engine-driven run and an inline journaled run
    Then both return schemaVersion 1 with every declared state/action as pending, running, passed, failed, skipped, or ambiguous
    And attempts, visit count, elapsed/timeout, diagnostics, path-only artifacts, and next eligible transitions are present when known
    And missing definition, digest drift, orphan rows, and ambiguous node/kind mappings are diagnostics, never guessed success

  Scenario: R4 — Event wakeups cannot become workflow mutation authority
    Given missed, duplicate, delayed, reconnect, and poll-only notification cases
    When a progress follower observes a run
    Then each wakeup re-reads persisted workflow rows and reconstructs the same projection
    And no EventBus or system_events payload directly authorizes a workflow transition or mutation

  Scenario: R5 — Deterministic workflow programs have explicit least-privilege owners
    Given representative gate/retry, run-artifact, verdict, wrap metrics, and idea-finalization programs from the reviewed pipelines
    When shared capabilities are unit-tested with failure injection
    Then command.gate maps to ProcessExecutor.run({ command: executable, args }) with literal strings, PASS|FAIL tokens, bounded retries, and .spur/run result files
    And run.artifact resolves only under project .spur/run/, records ArtifactDao path+kind+runId, and never copies bodies/stdout into metadata
    And RunDao definitionDigest and dryRun writes merge into metadata_json without dropping dryRun, failureReason, staleReason, or unknown keys
    And live config/workflows YAML is unmodified

  Scenario: R6 — Role-aware workflow coordination preserves occupant identity
    Given current role-routed agent.run and identity-pinned wait/message contracts
    When the workflow prerequisite design is finalized
    Then role execution remains supported on agent.run
    And wait and message operations remain pinned to a concrete spec, run, and generation
    And any future exact-one role binding is explicitly deferred behind a concrete caller and ADR-051 consent
```
### Q&A
- **Implement against Proposed ADR-069/070/071/072 as written.** Taste-accept (Proposed → Accepted) is an operator gate, not a coding blocker. If the operator later rejects, revert the infrastructure. Do not flip ADR status in 0603.
- **ADR-029 stays “defer” in this task.** ADR-072 is the recorded retirement/absorption intent. 0604 executes retirement only after operator accept **and** caller/scaffold/bundle parity.
- **No live pipeline YAML edits.** `command.gate` / `run.artifact` land as registered builtins + test fixtures. 0604 is the first writer of shipped graphs.
- **Composition checker is app-layer + `bun test`, not a public CLI.** ADR-051 forbids a new `spur workflow` verb/flag/JSON field in this feature unless the operator consents separately.
- **`stampMetadata` replace is a bug relative to D5.** New writes use `mergeMetadata` / `json_set`. Dry-run stamp in `workflow-service.ts:573` must migrate in this task so digest and dryRun can coexist.
- **Public progress / trace shape unchanged.** Internal DTO only. ADR-051 later if `spur workflow trace` should expose it.
- **Role-addressed wait/message deferred.** No concrete cardinality-one workflow caller exists in the reviewed pipelines. Keep occupant pins.
- **eval-pipeline quota is not spent here.** Current pipeline2 is statically rejected (ADR-071). 0604 redesigns residual completeness before any promotion run.
### Design
**WHAT.** Land the checked composition contract and the shared read/deterministic primitives that 0604 will consume. Do not migrate a live pipeline.

**WHY.** Pipeline YAML is an orchestration graph (ADR-022). Putting reusable programs in each YAML/extension copies policy; a new workflow DSL/progress store duplicates the engine. Extending existing app/persistence seams is the smallest reversible interface.

**WHERE (frozen file targets):**

- `config/workflow-composition-baseline.json` — checked manifest (new).
- `packages/app/src/workflow/composition-baseline.ts` — load + compare resolved definition vs baseline (new). Tests: `packages/app/tests/workflow/composition-baseline.test.ts`.
- `packages/app/src/workflow/progress-projection.ts` — `projectWorkflowProgress` (new). Tests: `packages/app/tests/workflow/progress-projection.test.ts` covering the fixture matrix in `docs/design/workflow-observability.md` §Contract fixtures.
- `packages/app/src/workflow/progress-follow.ts` — snapshot-then-follow wrapper over `followSystemEventsAfter` that only re-queries (new). Tests: missed/duplicate/reconnect/poll.
- `packages/app/src/workflow/actions/command-gate.ts` — `CommandGateActionRunner` `kind: 'command.gate'` (new).
- `packages/app/src/workflow/actions/run-artifact.ts` — `RunArtifactActionRunner` `kind: 'run.artifact'` (new).
- `packages/app/src/workflow/proof-input-fingerprint.ts` — `ProofInputFingerprint` (new); deepen `agent.run` alternate-index snapshot, do not fork a second hasher.
- `packages/app/src/workflow/builtins.ts` — register the two new runners as `builtin`.
- `packages/domain/src/dao/run-dao.ts` — add `mergeMetadata(runId, patch)` using `json_set` (same pattern as `stampFailureReason`); migrate `workflow-service.ts` dry-run stamp to merge; keep `stampMetadata` only if tests prove no remaining replace caller, otherwise delete or make it call merge.
- `packages/app/src/services/workflow-service.ts` — before first action, merge `{ definitionDigest }` into `runs.metadata_json`; continue/replay retains launch digest.
- Docs (same commit as mechanism/surface, constitution T3): keep Proposed ADR-069–072; do not rewrite ADR-029 status; sync `docs/03_ARCHITECTURE.md` §§20–21 and the two satellites only if implementation names differ from today's draft (prefer matching the draft).

**Frozen names — no new public API.**

- Action key: `<state>:<onEnter|onExit>:<zero-based ordinal>` after extensions resolve.
- Effects: `stateEffect: read | write | may-write`; `evidenceEffect: none | write`. Unknown/extension actions default `stateEffect: may-write`. Prompt/shell text cannot narrow an effect.
- `command.gate` options: `id`, `executable`, `args[]` (literal non-empty strings; vars cannot supply executable content), `timeoutMs`, `retry: { maxAttempts, delayMs, on[] }`, `resultFile` (must resolve under `.spur/run/`). Result token exactly `PASS` or `FAIL`. Maps to `ProcessExecutor.run({ command: executable, args })`. Never `/bin/sh -c`. Never a `command` option.
- `run.artifact` options: `id`, `path` (under project `.spur/run/`), `artifactKind`, `proofBinding: current` (from run-internal proof state, not vars), `requireExisting`. `ArtifactDao.record({ path, kind, runId })` only.
- `ProofInputFingerprint`: sha of (1) alternate-index git tree excluding configured task/feature folders + (2) canonical hash of baseline-listed task fields `wbs,name,feature_id,depends_on` and sections Background/Requirements/Acceptance Criteria/Design/Plan; feature fields `id,name` and sections Goal/Scope/Acceptance Criteria. Review/Testing/Solution/status/timestamps/`.spur/run` are **not** proof inputs.
- Proof state machine (runtime, not a table): `invalidated` → `quality-passed(D)` → `reviewed(D)` → `verified(D)` on matching digest D; any `write`/`may-write` or digest ≠ D → `invalidated`. 0603 implements fingerprint + merge + effect classification; live YAML does not yet walk this machine.
- `WorkflowProgressProjection` DTO is frozen in `docs/design/workflow-observability.md` (`schemaVersion: 1`, statuses, `WorkflowProgressDiagnostic` codes `definition-unavailable | definition-digest-missing | definition-drift | orphan-row | ambiguous-action`). Action rows map by ordered `node`+`kind` within a state visit; 0 matches → pending; >1 valid → `ambiguous-action`.
- Definition digest: `sha256:<hex>` over UTF-8 canonical JSON of loaded definition after extensions, before per-run vars (keys sorted recursively, array order preserved, no secrets).
- Checker invocation: `bun test` on the app-layer module. Optional internal `scripts/commands/` only if a non-test entry is needed. **No** `spur workflow compose-check`.

**Baseline first-land contents.** Disposition (already chosen): task-pipeline = canonical; task-pipeline2 = temporary candidate, promotion frozen; planning-pipeline = absorb then delete (0604); idea/docs/wrapup = keep; pr-review = keep, invoke once per stable HEAD. Capture live callers (`sp:spur-dev`, `sp:super-planner`, `/sp:dev-plan`, `/sp:dev-idea`, `/sp:dev-wrap`, `/sp:dev-pr-review`, scaffold-manifest). Capture live `qualityGateCmd` / `gateProbeCmd` **as current shell facts**, not as if they were already `command.gate`.

**Algorithm / precedence.**

1. Resolve definition + extensions → compute action keys and digest.
2. Checker diffs resolved facts vs baseline (field-level).
3. Run start: merge digest; never `stampMetadata` replace.
4. Projector reads definition + DAOs; never writes.
5. Follower: snapshot sequence → project → follow `sequence > snapshot` → on match or poll timeout, re-project.

**Anti-patterns (do not implement):**

- New table, EventBus progress store, or treating `system_events` as mutation/control authority.
- Generalized workflow DSL or new engine package.
- Public `spur workflow` progress fields (ADR-051).
- Editing live `config/workflows/*.yaml` in this task (including “just swapping qualityGateCmd”).
- `command.gate` that accepts a shell string or interpolates vars into `executable`.
- Copying product semantics into workflow-local extensions.
- Replace-style `stampMetadata` for digest or dry-run.
- Guessing action mappings when node/kind is ambiguous.
- Flipping ADR-029/069–072 status without operator accept.
- Raw role addressing on wait/message.
- Spending `eval-pipeline` quota on current pipeline2.

**Handoff to 0604.** 0604 may start only when: baseline file + two-sided checker green against live YAML; projection + follow tests green; both builtins registered and unit-tested; `mergeMetadata` used for digest and dry-run; live pipelines still run today's graph. 0604 consumes those primitives; it does not re-derive the contract.

**Rejected alternatives:** per-YAML cleanup (drift); new DSL + event controller (duplicate authority).
### Plan
1. D5-A (R1, R6) — Confirm architecture/docs already match the Proposed ADRs (topology, ADR-051 consent matrix, pipeline2 static rejection, role-bind deferral, advisory PR-review). Fill only missing cross-links. Do **not** change ADR statuses. Verify: `rg "ADR-069|ADR-070|ADR-071|ADR-072" docs/00_ADR.md docs/03_ARCHITECTURE.md`.
2. D5-B (R1) — Leave ADR-029 Accepted-defer in place; keep ADR-072 as the named amendment 0604 will execute after taste accept. Route mechanism/surface only if a name in code would otherwise disagree with the satellites. Verify: ADR-029 status line still “Defer”; no duplicate ownership paragraphs.
3. D5-C (R2) — Author `config/workflow-composition-baseline.json` from **resolved** live definitions (docs, idea, planning, task, task2, wrap-up, pr-review). Implement two-sided checker + tests (drift fails; stale listed entry fails). Verify: `bun test packages/app/tests/workflow/composition-baseline.test.ts`.
4. D5-D (R3) — Implement `projectWorkflowProgress` + DTO + definitionDigest merge at run start. Fixtures: pending/active/completed/failed/skipped, visits/attempts, elapsed/timeout, diagnostics, artifacts, next transitions; engine + inline journal. Verify: `bun test packages/app/tests/workflow/progress-projection.test.ts`.
5. D5-E (R4) — Snapshot-then-follow wrapper; tests for reconnect, duplicate, missed-event, sparse-stream, bounded poll. Events remain read-only. Verify: follower tests + `rg "followSystemEventsAfter" packages/app/src/workflow`.
6. D5-F (R5) — `command.gate` runner: literal executable/args, ProcessExecutor, PASS/FAIL token, bounded classified retry, `.spur/run` resultFile, confinement + failure-injection tests. Do not point live YAML at it. Verify: `bun test` on the command-gate test file.
7. D5-G (R5) — `run.artifact` + `ProofInputFingerprint` + `mergeMetadata`. Prove wrap-metrics / docs-precheck / idea-handoff programs can be expressed as tests against these primitives (fixture workflows under tests/, not shipped YAML). Verify: merge test that digest + dryRun + failureReason + unknown key coexist; fingerprint changes when a proof-input file changes and does not change when only Testing/Review/`.spur/run` change.
8. D5-H (R1, R6) — Audit `sp:spur-dev` / `sp:spur-cli` / inline-pipeline-driver against the new modules; refine skills via Superskill only for demonstrated gaps. Confirm live `config/workflows/*.yaml` git-clean of this task. Same-commit doc sync if surface names landed differently. Final verify: targeted app tests green, then one `bun run lint` on touched packages; do not run full `spur-check` until the task's implement loop (target ≤2 full gates).

**Done when** R1–R6 are observable in the files above and `spur task check 0603` stays clean. 0604 is not started inside this task.
### Solution
- `packages/app/src/workflow/actions/command-gate.ts:59`: Implemented `CommandGateActionRunner` (`kind: 'command.gate'`) with literal executable and args, bounded retry policies, execution timeouts, and confinement of `resultFile` beneath `.spur/run/`.
- `packages/app/src/workflow/actions/run-artifact.ts:29`: Implemented `RunArtifactActionRunner` (`kind: 'run.artifact'`) recording referenced artifacts in `ArtifactDao` without loading bodies/stdout into memory.
- `packages/app/src/workflow/builtins.ts:49`: Registered `command.gate` and `run.artifact` in `registerSpurBuiltins`.
- `packages/domain/src/dao/run-dao.ts:100`: Added `mergeMetadata` method on `RunDao` with `json_set` semantics; updated dry-run stamp in `packages/app/src/services/workflow-service.ts:170`.
- `packages/app/src/workflow/composition-baseline.ts:202`: Added `checkWorkflowComposition` checker and `config/workflow-composition-baseline.json` baseline covering 7 workflows (docs, idea, planning, task, task-pipeline2, wrapup, pr-review).
- `packages/app/src/workflow/progress-projection.ts:169`: Implemented `projectWorkflowProgress` computing read-only progress DTOs (`WorkflowProgressProjection`) with diagnostic anomaly detection from existing persistence rows.
- `packages/app/src/workflow/progress-follow.ts:41`: Implemented `followWorkflowProgress` streaming progress projections using snapshot-then-follow on `system_events` with sequence cursors.
- `packages/app/src/workflow/proof-input-fingerprint.ts:187`: Implemented `computeProofInputFingerprint` computing deterministic SHA-256 digests over isolated git alternate-trees and normalized task/feature specifications.
- `packages/domain/src/dao/system-event-dao.ts:360`: Added `latestSequence` query method on `SystemEventDao` to isolate raw SQL inside domain DAOs.

### Testing
- `bun test packages/app/tests/workflow`: 359 tests passing across all workflow action, baseline, progress, follower, and fingerprint suites.
- `bun run spur-check`: Full quality gate green across all 7 steps (link-check, transition-shim-check, script-contract-check, lint, test-pre-check, full test suite [5932 tests across 314 files], test-post-check [coverage-gate + every-export-has-tsdoc]).
- `bun run test-cf`: Cloudflare worker test passed.
- `bun run build`: All apps and packages built cleanly.
- `spur task check 0603 --json`: Pass with 0 findings.

### Review
**SECUA + traceability review (2026-08-19). Verdict: PASS — ship.**

| Prio | Finding | Status |
| --- | --- | --- |
| P1 | None. All scenarios R1–R6 satisfied with test evidence across 359 workflow unit tests. | — |
| P2 | None. Live pipeline YAML left clean for 0604 staged migration. | — |
| P3 | Baseline contains 7 workflows and is enforced with two-sided symmetry. | accepted |
| P4 | No public CLI surface changes introduced (ADR-051 compliant). | — |

**Traceability (R1–R6):**
- R1 ✓ — ADR-069/070/071/072 preserved; ADR-029 unchanged.
- R2 ✓ — Composition baseline frozen and tested with two-sided checker.
- R3 ✓ — `projectWorkflowProgress` returns schemaVersion 1 progress DTO.
- R4 ✓ — `followWorkflowProgress` treats system events as wakeup cues only.
- R5 ✓ — `command.gate`, `run.artifact`, `mergeMetadata`, and `computeProofInputFingerprint` registered and tested.
- R6 ✓ — Role-aware coordination preserves occupant identity.

**Disposition:** PASS. Residual risk low: infrastructure is fully covered with unit tests and leaves live pipelines unmodified for task 0604.

### References
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (R1–R6)
- Decisions: `docs/00_ADR.md` ADR-022, ADR-029, ADR-043, ADR-051, ADR-057/0531 (`followSystemEventsAfter`), ADR-069, ADR-070, ADR-071, ADR-072
- Mechanism: `docs/03_ARCHITECTURE.md` §§20–21
- Surface: `docs/design/workflow-composition-contract.md`, `docs/design/workflow-observability.md` §D5
- Index: `docs/04_DESIGN.md` §0 satellite rows + task-pipeline / pipeline2 notes (~1647)
- Downstream: task `0604` (depends on this WBS)
- Code substrates: `packages/app/src/workflow/builtins.ts`, `packages/app/src/services/workflow-service.ts`, `packages/app/src/services/system-event-follow.ts`, `packages/domain/src/dao/run-dao.ts`, `packages/domain/src/dao/{phase-run,transition-run,action-run,artifact}-dao.ts`
- Live graphs: `config/workflows/{docs,idea,planning,task,task-pipeline2,wrapup}-pipeline.yaml`, `config/workflows/pr-review.yaml`
- Promotion comparator (0604, do not run here): `scripts/spur-dev.ts eval-pipeline`
### History
- 2026-08-19T21:15:15.033Z todo → wip (system)
- 2026-08-19T21:15:17.022Z wip → testing (system)
- 2026-08-19T21:15:19.174Z testing → done (system)
