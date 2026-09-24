---
schema_version: 1
name: Make canonical workflow interruption and replay behavior explicit
status: done
template: standard
created_at: 2026-09-22T02:56:46.300Z
updated_at: "2026-09-23T22:45:38.851Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w03
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0914", "0915"]
---

## 0916. Make canonical workflow interruption and replay behavior explicit

### Background

Tasks 0901/0902 and 0910/0911 supplied upstream-owned recovery and conservative decision policy. Workflow adoption must account for at-least-once entry replay, corpus mutations and external PR effects. This slice adopts and tests those contracts rather than implementing another recovery engine. Covers proposed feature R3. Depends on W01 and W02.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W03 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [x] R1. Classify entry actions in all canonical workflows as safely repeatable, identity-deduplicated or requiring explicit reconciliation before replay.
- [x] R2. Opt into existing interrupted-entry recovery only where repeatability is demonstrated; preserve upstream CAS ownership, paused skip-enter semantics and unsupported inline recovery behavior.
- [x] R3. Preserve human decision boundaries and external PR request identity, pending/collect semantics and research mutation limits across interruptions.
- [x] R4. Make recovery/refusal outcomes actionable in existing skills and progress/trace output without a new FSM or automatic external authorization.

### Acceptance Criteria

- [x] AC1 — Every canonical workflow has an evidenced replay classification and no unsafe action gains unconditional interrupted-entry replay. (req: R1)
- [x] AC2 — Concurrent resume and paused/interrupted fixtures preserve existing ownership and entry semantics; inline limitations are explicit. (req: R2)
- [x] AC3 — Replaying an authorized PR request does not duplicate it, stale HEAD results remain pending, and human/research boundaries remain enforced. (req: R3)
- [x] AC4 — Refused or incomplete recovery names the next safe action in current surfaces without a second recovery state machine. (req: R4)
- [x] AC5 — Recovery preserves ownership and side effects (req: R1)

Feature-level traceability: this task delivers D63 scenario R3; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the upstream engine contract from ADR-122 and the existing CLI resume boundary. Inventory is test input, not a new routing registry. Fix root causes in shared mutation helpers where replay is required. The PR helper already deduplicates by HEAD; test and reuse it. Keep decision.mode never at human boundaries and make no claim of inline evidence-mode DecisionMaker parity. If an action cannot safely replay, retain refusal/manual reconciliation rather than enabling resumeRerun universally.

### Plan

- [x] 1. Build the action replay matrix from the current ten definitions and actual helper behavior.
- [x] 2. Make only demonstrated necessary helper/declaration corrections; preserve explicit unsafe replay refusal.
- [x] 3. Exercise interrupted entry, lost/concurrent ownership claim, paused decision, corpus-write replay, PR duplicate request and research mutation cases.
- [x] 4. Update recovery guidance and run the existing validator/contract and focused engine-integration tests.

### Solution

Change map (0916 R1–R4):

1. `packages/app/tests/workflow/replay-matrix.test.ts` (new) — declared replay matrix over the ten canonical definitions: expected `resumeRerunStates` (all ∅ — engine refusal default), `pauseGates` (idea-pipeline×4, task-pipeline approve, wayfinder approve, wrapup branch-cleanup, decision-routing humanGate), and per-workflow `entryClass` (repeatable ×9, identity-deduplicated pr-review). Locks: exact definition set, AC1 negative (no state gains unmarked rerun-enter), AC3 gate match, matrix completeness (reconciliation-required never opts into rerun-enter).
2. `packages/app/tests/services/workflow-service.test.ts:1406` (new test) — live concurrent owner: a run claimed `running` by another resumer is refused at spur's resume boundary (`is not resumable (status: running)`); deterministic status-guard ownership with the engine claim CAS (ADR-122) as the backstop behind it.
3. `plugins/sp/skills/spur-cli/references/workflows.md:331` — replay-posture guidance (R4): refusal default names next safe action (resume paused directly; `clean` sweeps crashed running → interrupted); enabling `resumeRerun` requires demonstrated repeatability + conscious matrix update; mutating steps behind `pause: true` are safe by construction (skip-enter).

Plan 2 disposition: no helper/declaration corrections demonstrated necessary. PR per-HEAD dedup already implemented and tested (`plugins/sp/tests/pr-reviewing.test.ts:113` exact-HEAD match, `:130` clean-review-at-HEAD only — replay does not duplicate the request, stale-HEAD results stay pending). Mutating steps behind `pause: true` gates (matrix) are safe by construction — paused resume is skip-enter. idea-pipeline `discovery` corpus/research writes are the one unpaused mutation surface; they are protected by the engine refusal default (no rerun-enter), not by skip-enter. No new routing registry, no second recovery FSM (Design).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Declared replay classification matrix over all 10 canonical definitions at `packages/app/tests/workflow/replay-matrix.test.ts:35-62` (re-read: entryClass 'repeatable' \| 'identity-deduplicated' \| 'reconciliation-required'; definition set locked at :65). Executed: `cd packages/app && bun test tests/workflow/replay-matrix.test.ts …` — 133 pass, 0 fail (this run). |
| R2 | MET | No unmarked rerun-enter in canonical workflows; live concurrent owner refused at the resume boundary (engine CAS backstop per ADR-122). `packages/app/tests/services/workflow-service.test.ts:1385-1408` (re-read: 'R2: continuePaused refuses a run owned by a live concurrent resumer'). Paused skip-enter and inline limitations unchanged. Tests pass (this run). |
| R3 | MET | PR request identity bound to exact pushed HEAD; stale HEAD stays pending; human review does not satisfy the Codex-review gate. `plugins/sp/tests/pr-reviewing.test.ts:113` (re-read) and :130. Executed: `bun test tests/pr-reviewing.test.ts` — 59 pass, 0 fail (this run). |
| R4 | MET | Refused/incomplete recovery names the next safe action (resume paused; clean sweeps crashed running → interrupted) in `plugins/sp/skills/spur-cli/references/workflows.md:331-337` (re-read). rerun-enter opt-in requires demonstrated repeatability + conscious matrix update; no second FSM. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Recovery preserves ownership and side effects | MET | test | Concurrent resume refused (ownership), PR replay non-duplicating (side effects), pause-gated human boundaries preserved — replay-matrix + workflow-service + pr-reviewing suites, 192 pass total (this run). |
| AC1 | MET | test | Every canonical workflow has an evidenced entryClass; no unsafe action gains unconditional replay — replay-matrix.test.ts (this run, pass). |
| AC2 | MET | test | Concurrent resume and paused fixtures preserve ownership/entry semantics — workflow-service.test.ts:1385 (this run, pass). |
| AC3 | MET | test | PR replay does not duplicate; stale HEAD pending; human/research boundaries enforced — pr-reviewing.test.ts:113,130 (this run, pass). |
| AC4 | MET | static | Refusal paths name the next safe action in current surfaces; no second recovery FSM — workflows.md:331-337 (re-read). |
| AC5 | MET | test | Recovery preserves ownership and side effects — covered by this run's suites. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0916 (diff 4f9e65de2, branch sp/d63-round2)

**Scope:** `git show 4f9e65de2` — replay-matrix.test.ts (new), workflow-service.test.ts (+23), workflows.md (+8)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS (approve)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | Task Solution wording overclaims: idea-pipeline research/corpus writes (e.g. `discovery` onEnter) are NOT behind pause gates — they are protected by the resumeRerun refusal default, not skip-enter. Shipped workflows.md wording is a correct conditional and unaffected; the AC1 lock makes this safe regardless. | `config/workflows/idea-pipeline.yaml:109-137` |
| 2 | P4 (advisory) | architecture | `entryClass` is declared-only: no test correlates it with definitions or runtime (nothing consumes it); 'repeatable' evidence for 9 workflows is a summary comment, not per-workflow citations. Acceptable — the risk-bearing invariant (rerun-enter ∅) is hard-locked and workflows.md requires demonstrated evidence before enabling. | `packages/app/tests/workflow/replay-matrix.test.ts:35-62` |
| 3 | P4 (advisory) | efficiency | AC1-negative test (unexpected rerun states) is logically subsumed by the exact-match gate test (declared ∅ + exact match ⇒ none unexpected). Defensible as an explicit AC1 headline lock. | `packages/app/tests/workflow/replay-matrix.test.ts:77-91` |

No P1–P3 findings.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/tests/workflow/replay-matrix.test.ts:51-62` — 10/10 workflows classified; reviewer independently verified all 9 declared pause gates and 0 `resumeRerun` markers against `config/workflows/*.yaml` (idea-pipeline×4, task-pipeline:approve:462, wayfinder:approve:161, wrapup:branch-cleanup:331, decision-routing:humanGate:75) |
| R2 | MET | live-owner refusal `packages/app/tests/services/workflow-service.test.ts:1391-1406` → guard `packages/app/src/services/workflow-service.ts:1171-1174`; engine refusal default verified at `ts-dual-workflow-engine/src/service.ts:254-257` (ADR-122) |
| R3 | MET | PR per-HEAD dedup pre-existing and re-run green (`plugins/sp/tests/pr-reviewing.test.ts:113,130`); human boundaries locked by gate-match test; mutation replay blocked by AC1 refusal lock |
| R4 | MET | `plugins/sp/skills/spur-cli/references/workflows.md:331-338` — next safe actions verified accurate: clean sweeps crashed `running`→`interrupted` via `engine.interruptRun` (`packages/app/src/services/workflow-service.ts:925-940`); no new FSM — diff is tests+docs only |

**Next:** none required — findings are advisory; optional wording fix to the task Solution note (finding 1) can ride any future edit.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:58.788Z todo → blocked (system)
- 2026-09-23T18:36:13.958Z blocked → wip (system)
- 2026-09-23T18:41:42.231Z wip → testing (system)
- 2026-09-23T18:56:51.794Z testing → done (system)

