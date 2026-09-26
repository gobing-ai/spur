---
schema_version: 1
name: Make idea-pipeline guards legible with terminal reasons on failure edges
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.007Z
updated_at: "2026-09-26T02:50:03.973Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - idea-pipeline

dependencies: ["0937", "0938"]
estimate_hours: 4
---

## 0945. Make idea-pipeline guards legible with terminal reasons on failure edges

### Background

Implements: R2 — Every workflow run ends with a classified terminal reason; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7.

**Refine corrections (2026-09-23) — inventory from `config/workflows/idea-pipeline.yaml`**

1. *Failure edges.* There are five `→ failed` edges:
   - `start` (agent doctor FAIL, around line 564);
   - `ac-generate` (auto profile, check/coverage failed after 3 retries, around line 663);
   - `feature-check` (failed after 3 retries, around line 714);
   - `design-approval` (rejected after 1 revise, around line 769);
   - `batch-create-run` (failed after 3 retries, around line 842).

   There are four `→ cancelled` edges: from `idea-eval`, `feature-check`, `design-approval` and `batch-create`. `failureStates` = `failed`, `cancelled`, so all nine need a declared `terminalReason` under 0937's validation rule.
2. *Compound guards.* The recurring compound predicate is the **design route**: `design ∈ {auto, skip}` × `needs_design` from `<runId>-idea-needs-design.json`. It is re-derived inline in the `ac-generate → system-design|decompose` and `feature-check → system-design|decompose` guards (lines 636–702, marked `(warn)` with 4–5 test segments). It is combined with the **AC readiness** pair (`idea-ac-check.status` and `idea-coverage.status` = PASS).
3. *agent.run count.* There are six `agent.run` actions. This task must not change that count; it is a legibility change, not a model-hop change.

### Requirements

- [x] R1. Each of the nine failure-state edges declares a `terminalReason` (0937):
  - `start → failed`: `failed-check`;
  - `ac-generate → failed`, `feature-check → failed` and `batch-create-run → failed`: `retry-exhausted`;
  - `design-approval → failed`: `retry-exhausted` (revise budget exhausted);
  - all four `→ cancelled` edges: `cancelled`.

  `spur workflow validate` passes under 0937's rule.
- [x] R2. One deterministic shell action writes two named files, and it runs at the end of both `ac-generate` and `feature-check` onEnter:
  - `.spur/run/<runId>-idea-design-route.txt`, holding `design` or `skip`. The value is `skip` when `design=skip`, or when `design=auto` and `needs_design=false`. Otherwise it is `design`, so a missing or corrupt JSON fails safe to `design`.
  - `.spur/run/<runId>-idea-ac-ready.status`, holding `PASS` or `FAIL`. It is `PASS` only when both AC check and coverage are PASS.
- [x] R3. The four route guards (`ac-generate → system-design|decompose`, `feature-check → system-design|decompose`) each read those two files plus one var (`profile` or `__hitlAnswer`). Each guard has at most three `test` segments and carries no `(warn)` marker. The routing truth table is unchanged.
- [x] R4. The `agent.run` count stays at 6, asserted by the composition baseline. The candidate record `idea-pipeline-guard-legibility` has `baselineAgentRunCount: 6`, projected 6. Its verdict cites the 0938 terminal-reason coverage for idea-pipeline, which should be 100% classified for new runs.

### Acceptance Criteria

- [x] AC1 — Every workflow run ends with a classified terminal reason
- [x] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.953Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:29:06.197Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Design-approval rejection maps to `retry-exhausted`.** The edge fires only after the revise budget is spent. The closed enum has no `rejected` value, and adding one would reopen 0937's enum. Revisit only if the 0938 mix shows operator rejections are material.
- **The truth-table test is written before the rewrite.** This is the regression proof that legibility changed nothing.
- **Estimate: 4h.**

### Design

**Approach.** Compute the derived facts once and let guards read files. This mirrors the existing captured signal-file pattern (0769). The shared shell action is duplicated in two onEnter lists (YAML has no include). A test asserts the two copies are byte-equal, rather than adding an engine include feature.

**Frozen names:**
- files `<runId>-idea-design-route.txt` and `<runId>-idea-ac-ready.status`;
- candidate id `idea-pipeline-guard-legibility`.

**Invariants:**
- The routing truth table is identical before and after. A table test enumerates `profile × hitlAnswer × design × needs_design × ac × coverage`.
- Fail safe to `design` and `FAIL`.
- `agent.run` count = 6.
- The retry-cap edges are unchanged.

**Rejected alternatives:**
- Using `decide` for routing. These are deterministic facts.
- A new helper script. A single `jq`/`test` line suffices, and ADR-069's no-inline-shell rule is history-anatomy-specific.
- Engine YAML anchors or includes, which is out of scope.

**Anti-patterns:**
- Reading `needs_design` JSON inside guards after this change.
- Renaming existing status files.

**Targets:**
- Guard-parity fixture and composition baseline updated.
- `inline-pipeline-parity-check` green.
- The dev-idea inline driver reference is updated if it documents the guards.

### Plan

1. Truth-table test first: `packages/app/tests/workflow/idea-pipeline-routing.test.ts`, pinned against the current guards (green before the change).
2. Add the route and readiness writer action to the `ac-generate` and `feature-check` onEnter, then rewrite the four guards. The truth-table test stays green. Add the byte-equality test for the two action copies.
3. Declare `terminalReason` on the nine failure edges and run `spur workflow validate`.
4. Update the composition, guard-parity and bundle baselines (`bun run --filter @gobing-ai/spur build:bundle`), then run `inline-pipeline-parity-check`.
5. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
6. Run `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:317` |
| `packages/app/src/index.ts:321` |
| `packages/app/src/index.ts:733` |
| `packages/app/src/index.ts:764` |
| `packages/app/src/index.ts:918` |
| `packages/app/src/services/inline-run-setup.ts:311` |
| `packages/app/src/services/inline-run-setup.ts:33` |
| `packages/app/src/services/inline-run-setup.ts:43` |
| `packages/app/src/services/workflow-service.ts:1913` |
| `packages/app/src/services/workflow-service.ts:1949` |
| `packages/app/src/services/workflow-service.ts:2201` |
| `packages/app/src/services/workflow-service.ts:2746` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:51` |
| `packages/app/src/services/workflow-service.ts:65` |
| `packages/app/src/services/workflow-service.ts:69` |
| `packages/app/src/services/workflow-service.ts:699` |
| `packages/app/src/services/workflow-service.ts:78` |
| `packages/app/src/services/workflow-service.ts:802` |
| `packages/app/src/services/workflow-service.ts:81` |
| `packages/app/src/services/workflow-service.ts:963` |
| `packages/app/src/services/workflow-service.ts:971` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/actions/agent-run.ts:1292` |
| `packages/app/src/workflow/actions/agent-run.ts:195` |
| `packages/app/src/workflow/actions/agent-run.ts:206` |
| `packages/app/src/workflow/actions/agent-run.ts:241` |
| `packages/app/src/workflow/actions/agent-run.ts:246` |
| `packages/app/src/workflow/actions/agent-run.ts:257` |
| `packages/app/src/workflow/actions/agent-run.ts:30` |
| `packages/app/src/workflow/actions/agent-run.ts:407` |
| `packages/app/src/workflow/actions/agent-run.ts:645` |
| `packages/app/src/workflow/builtins.ts:104` |
| `packages/app/src/workflow/builtins.ts:14` |
| `packages/app/src/workflow/builtins.ts:2` |
| `packages/app/src/workflow/builtins.ts:29` |
| `packages/app/src/workflow/builtins.ts:57` |
| `packages/app/src/workflow/builtins.ts:74` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/app/tests/services/inline-run-setup.test.ts:15` |
| `packages/app/tests/services/inline-run-setup.test.ts:3` |
| `packages/app/tests/services/inline-run-setup.test.ts:649` |
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/app/tests/workflow/guard-parity.test.ts:59` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:648` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:13` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:49` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:57` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:71` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:102` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:129` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:136` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:162` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:210` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:213` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:23` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:352` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:360` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:368` |
| `packages/config/src/index.ts:771` |
| `packages/config/src/loader.ts:299` |
| `packages/config/tests/loader.test.ts:1112` |
| `packages/config/tests/loader.test.ts:30` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:53` |
| `plugins/sp/scripts/inline-run-setup.ts:103` |
| `plugins/sp/scripts/inline-run-setup.ts:318` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:347` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:430` |
| `plugins/sp/scripts/inline-run-setup.ts:465` |
| `plugins/sp/scripts/inline-run-setup.ts:48` |
| `plugins/sp/scripts/inline-run-setup.ts:557` |
| `plugins/sp/scripts/inline-run-setup.ts:562` |
| `plugins/sp/scripts/inline-run-setup.ts:575` |
| `plugins/sp/scripts/inline-run-setup.ts:580` |
| `plugins/sp/scripts/inline-run-setup.ts:596` |
| `plugins/sp/scripts/inline-run-setup.ts:612` |
| `plugins/sp/scripts/inline-run-setup.ts:629` |
| `plugins/sp/scripts/quality-gate.ts:107` |
| `plugins/sp/scripts/quality-gate.ts:16` |
| `plugins/sp/scripts/quality-gate.ts:185` |
| `plugins/sp/scripts/quality-gate.ts:29` |
| `plugins/sp/scripts/quality-gate.ts:547` |
| `plugins/sp/scripts/quality-gate.ts:552` |
| `plugins/sp/scripts/quality-gate.ts:568` |
| `plugins/sp/scripts/quality-gate.ts:625` |
| `plugins/sp/scripts/quality-gate.ts:656` |
| `plugins/sp/scripts/quality-gate.ts:658` |
| `plugins/sp/scripts/quality-gate.ts:660` |
| `plugins/sp/scripts/quality-gate.ts:668` |
| `plugins/sp/scripts/quality-gate.ts:90` |
| `plugins/sp/scripts/wrapup-steps.ts:12` |
| `plugins/sp/scripts/wrapup-steps.ts:189` |
| `plugins/sp/scripts/wrapup-steps.ts:535` |
| `plugins/sp/scripts/wrapup-steps.ts:540` |
| `plugins/sp/scripts/wrapup-steps.ts:6` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `plugins/sp/tests/wrapup-steps.test.ts:488` |
| `plugins/sp/tests/wrapup-steps.test.ts:6` |
| `scripts/commands/bundle-plugin-lib.ts:129` |
| `scripts/commands/bundle-plugin-lib.ts:176` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 9/9 failure-state edges carry terminalReason (idea-pipeline.yaml:598-600 failed-check; :705-707/:761-763/:818-820/:894-896 retry-exhausted; :638-640/:772-774/:826-828/:864-866 cancelled); workflow validate exit 0; pre-change YAML fails with exactly those 9 errors (completeness proof) |
| R2 | MET | One deterministic writer declared twice byte-equal (yaml:273-282 ac-generate, :310-319 feature-check, last onEnter action); writes <runId>-idea-design-route.txt (skip iff design=skip or design=auto&&needs_design=false; missing/corrupt JSON fails safe to design via jq-ne-false) and <runId>-idea-ac-ready.status (PASS iff both statuses PASS); byte-equality + fail-safe tests green |
| R3 | MET | Four guards exactly 3 test segments, no (warn), one var each (yaml:665-691 ac-generate route+ready+profile; :726-749 feature-check route+ac-check+__hitlAnswer per adjudicated parity-first deviation); no needs_design JSON in guards; truth table unchanged - 3456-cell executed parity vs frozen pre-refactor oracle, expect(cells).toBe(3456) green |
| R4 | MET | 6 agent.run actions unchanged; extractResolvedWorkflowFacts -> idea-pipeline modelQueries 6 = pipeline-budgets.json:14; candidate idea-pipeline-guard-legibility (config/workflow-candidates.json:54) baselineAgentRunCount 6 / agentRunCount 6, verdict null pre-promotion, rationale cites 0938 100% terminal-reason coverage + ADR-076 revert, deadline 2026-11-24 = +60d; promotion check PASS (3 candidates) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every workflow run ends with a classified terminal reason | MET | command | 0937 validator enforces terminalReason on every failureState edge; new YAML valid exit 0, old invalid - every failed/cancelled run terminates classified |
| AC2 — Workflow shape changes are accepted only on measured benefit | MET | test | Composition baseline 6->6 budget-verified; measured-benefit candidate complete with 0938-coverage citation; benefit-neutral routing proven by 3456-cell executed oracle parity; guard-parity fixture refreshed per 0874->0887 protocol; promotion check PASS; verdict null until post-promotion evaluate (adjudicated) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS (full review 874ac65c; fingerprint sha256:2d7c48e8… reproduced byte-identical; read-only run).

| Finding | Priority | Disposition |
| --- | --- | --- |
| F1: Out-of-contract `design` values (≠auto\|skip) shift fail-closed→fail-open (old guards dead-end; new writer folds any non-skip value to design-route) | P3 | ACCEPTED — fail-open-to-design is R2's own letter ("Otherwise it is design … fails safe to design"); a fail-closed writer would violate R2 AND shift out-of-domain cells away from old-guard parity. Declared-domain scoping documented in routing test :46-49. Typo risk noted as residual |
| F2: "Test green pre/post rewrite" is by construction (file untracked, no pre-run record) | P4 | ACCEPTED — reviewer byte-verified all four frozen oracle guards against git 34d3dd0de; oracle ≡ old guard makes pre-green tautological (stronger than a historical run) |
| F3: R4 "verdict cites 0938 coverage" lives in candidate rationale; verdict field null until post-merge promotion evaluate | P4 | ACCEPTED — per protocol; citation content present and correct (100% classified for new runs, all nine edges) |
| F4: Writer measures 7 logical commands (above ADR-115's 5) on both onEnter lists | P4 | ACCEPTED — declared honestly via (warn) 7 commands comment; validate exits 0 advisory; rewritten guards dropped 4–5+warn to 3 no-warn |
| F5: Driver TS-fix narrative not independently reconstructable (origin expression replaced, no failed-attempt log) | P4 | ACCEPTED — fix effect fully verified: typecheck green all packages, zero non-null assertions, all lookups narrowed by throw-guards; gate attempt-2 evidence fresh |
| F6: Task Solution/Testing placeholders at review time | P4 | RESOLVED — filled in closing chain (record --solution-from-diff + Testing section) |

Spec-defect resolution (driver decision 2026-09-25, parity-first) — reviewer UPHELD: R2/R3 letter vs R3 parity clause + closed Q&A conflicted in cell class (feature-check, yes, ac=PASS, coverage≠PASS). Resolution: ac-generate guards read route + idea-ac-ready.status + profile; feature-check guards read route + EXISTING idea-ac-check.status + __hitlAnswer (old operator-governs semantics verbatim). 3456-cell executed parity (expect(cells).toBe(3456)) proves truth table identical; frozen names + R3 shape (≤3 segments, no warn, 2 files + 1 var) intact; single-letter deviation test-pinned at routing test :332-341.

Residual risk: operator typo in `design` value now routes as design instead of dead-ending (fail-open per spec letter); writer 7-command advisory above ADR-115 soft cap (declared); parity is exact on the declared domain only.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T19:21:40.115Z todo → wip (system)
- 2026-09-25T20:28:12.700Z wip → testing (system)
- 2026-09-25T20:28:19.525Z testing → done (system)

