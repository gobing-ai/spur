---
schema_version: 1
name: Measure complete-run reliability and execution cost across inline, pipeline, and fleet
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:03.724Z
updated_at: "2026-09-20T05:58:02.195Z"
feature_id: I31

priority: P1
dependencies: ["0903"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "2"
---

## 0905. Measure complete-run reliability and execution cost across inline, pipeline, and fleet

### Background

Type: `wayfinder:research`. This is the third investigation on map I31 and depends on 0903's contract/adoption inventory to choose representative scenarios. It measures complete-run reliability and execution cost across inline, pipeline, and fleet surfaces using existing evaluation, run, trace, session, and history tools. It produces evidence and a ranked observation set; it makes no code fixes and does not retry unknown outcomes automatically.

**Refine corrections (2026-09-19)**
- The complete-run baseline had no cohort or denominator → freeze a 14-day historical cohort, at most ten runs per mode, with explicit missing-data outcomes.
- An eval suite could start full paid pipelines → eval-pipeline is excluded; reuse workflow trace and read-only real-run-cost instead.
- Readiness was conflated with executable frontier → this spec can be ready while execution waits for completed 0903 and its versioned scenario artifact.

### Requirements

- [ ] R1. Consume completed 0903-contract-adoption.json and freeze its scenario IDs, source revision, and available evidence sources; verify the prerequisite is done before investigation.
- [ ] R2. Build a reproducible local cohort over the 14 UTC days ending at investigation start, newest first with run-ID tie-break, at most ten terminal non-dry runs per mode (inline, pipeline, fleet); deduplicate by persisted run identity and record every exclusion.
- [ ] R3. Measure completion/verification outcomes, failures/retries, wall duration, session reuse/freshness, executor changes, and manual interventions only where persisted evidence supports them. Distinguish process exit, workflow terminal state, and verified task success.
- [ ] R4. Read existing cost/session joins and report token/USD coverage independently; missing values are null, never zero. Separate aggregate real-run-cost scope from the bounded cohort, and never label all-history totals as 14-day results.
- [ ] R5. Evaluate the fixed scenario matrix and the 0903-derived additions against existing traces/local regression tests; label unobserved behavior and missing modes rather than launching new live runs.
- [ ] R6. Deliver 0905-run-baseline.md and 0905-run-baseline.json with cohort selection, per-run metrics, scenario coverage, source/command provenance, ranked failure clusters, and owner-scoped next-batch proposals.
- [ ] R7. Validate denominators, duplicate exclusion, nonnegative durations, null handling, trace/run identity and artifact references with a repeatable local check. A sparse baseline must explicitly delimit conclusions and list the missing evidence needed for follow-up.

### Acceptance Criteria

- [ ] AC1 — 0903 is done and its scenario artifact/revision is recorded; absent or stale incompatible input stops execution. (req: R1)
- [ ] AC2 — Selection is reproducible and capped at ten terminal non-dry runs per mode, with explicit exclusions and sample counts. (req: R2)
- [ ] AC3 — Each metric distinguishes persisted fact from unknown; terminal process exit is not reported as verified success. (req: R3)
- [ ] AC4 — Token and USD coverage have separate denominators; aggregate and cohort scopes cannot be confused. (req: R4)
- [ ] AC5 — All fixed and inherited scenarios have observed, contradicted, or unobserved dispositions without fresh paid runs. (req: R5)
- [ ] AC6 — Both artifacts contain an evidence-ranked follow-up batch that reuses existing owners and names data gaps. (req: R6)
- [ ] AC7 — The local checker detects duplicate IDs, bad denominators/durations, and unsupported success claims; sparse results do not claim full coverage. (req: R7)

### Q&A

Closed for this investigation: local evidence first; no new public API; no production mutations; no live provider refresh or new benchmark runs; missing evidence is explicit; bounded 90-minute session and 60-second process deadlines. Operator decisions on future CLI compatibility, refresh cadence, and unattended execution budgets remain owned by Robin on map I31 and do not block these evidence-only deliverables. They are not delegated to the investigator to invent.

Preparation is ready-to-investigate, not proof the product behavior passes. Follow the wayfinder research route, one ticket per session. Any later source fix gets its own planned implementation task.

### Design

Type: wayfinder:research. Execute one ticket per session through the sp-wayfinder work-through-map procedure and its wayfinder-resolution research route. Do not use task-pipeline, dev-run, dev-runall, or eval-pipeline to resolve this ticket. Claim the selected ticket before investigation; verification and completion use the existing wayfinder verdict/record route. Preparation here is not execution or verification of its findings.

mutationPolicy: none

Production source, plugin/workflow definitions, installed adapters, real configuration, credentials, and real databases are read-only. Allowed deliverables are this task's CLI-owned evidence sections and the named report/JSON artifacts under docs/reports/i31/. Use an OS temporary directory for executable reproduction snippets and disposable fixture files; include the exact snippet and command in the report so it remains reproducible. No new public API, CLI verb, service, schema, dependency, scheduler, or production fix. No network probes or paid agent invocations inside the investigation; the surrounding delegated research/review session is the only model execution.

At start record git HEAD, git status, git worktree list, source-local CLI provenance, and task list --status wip --json. Use the current checkout; do not reset other work. If competing work changes a sampled source, refresh that row's evidence and record both revisions. Parallel delegates require separate worktrees; task 0905 starts only after 0903 is done and its artifact is available.

Bound one investigation to 90 minutes. Give any child shell/process a 60-second deadline, permit at most one retry for a read-only transient failure, and checkpoint partial artifacts at the budget boundary. A timeout or absent evidence is unknown, never success and never permission to rerun a pipeline. Do not mark the ticket done with unmet required deliverables. Report-only negative findings can be a valid investigation result when all specified observations and missing-data dispositions are recorded.

Choose historical evidence plus existing focused regressions over a new benchmark runner: it is reproducible, already paid for, and preserves current runtime behavior. No new API or telemetry schema. A missing fleet/inline join is an output finding, not permission to infer one from a terminal transcript.

Inputs: docs/reports/i31/0903-contract-adoption.{md,json}; config/workflows/task-pipeline.yaml and wayfinder-resolution.yaml; scripts/commands/real-run-cost.ts; packages/app/tests/workflow/session-pinned-dispatch.test.ts; apps/cli/tests/commands/agent-loop-member-session.test.ts; persisted workflow traces and their existing run/session/receipt correlation. 0904 is optional supplemental evidence, not a dependency and not a prerequisite for finishing this baseline.

Verified CLI: `bun run apps/cli/src/index.ts workflow trace --since <ISO> --last 100 --json`, then `workflow trace <run-id> --json` and `workflow progress <run-id> --json` for selected runs. The list is capped at 100 for this pass; record truncation if hit and do not imply complete population coverage. Use persisted mode/provenance fields, not agent name, to classify modes; missing classification is unknown. Fleet cases may need existing member/run records from the read-side code. Use read-only SQLite only when no CLI exposes the needed column: inspect the actual schema first, open the real DB with readonly:true and create:false, execute SELECT only, and record query text. Never import/analyze/reset history or migrate the live DB.

`bun scripts/spur-dev.ts real-run-cost --json` is a read-only all-history per-workflow summary over exact history joins. It has no date filter; preserve it as contextual aggregate, not the 14-day sample. For selected runs, use the same existing join semantics through read-only queries and report exact versus unavailable correlation. Do not edit the measurement script. Existing focused regressions may be run inside their workspace when trace evidence is absent, but label fixture evidence separately from real runs.

Fixed scenarios: S01 coder reuse across stages; S02 fresh reviewer/verify isolation; S03 mid-run quota invalidation/reselection; S04 unsupported-resume fallback; S05 fleet consecutive drains; S06 reset after restart/repeated failures; S07 settled-message non-redelivery/unknown receipt; S08 bounded contract/test-fix repair and mutation protection. Add 0903 scenario IDs, coalescing exact duplicates while retaining aliases.

Artifact JSON: {schemaVersion:1,task:"0905",sourceCommit,capturedAt,input0903:{sourceCommit,artifact},window:{from,to},selection:{capPerMode:10,listCap:100,truncated,excluded:[]},runs:[{id,mode,workflow,status,verifiedOutcome,wallMs,retries,manualInterventions,executor,sessionId,tokens,usd,evidence}],coverage:[{scenarioId,mode,disposition,runIds,testEvidence,missing}],summary:{byMode:[],costCoverage:{}},nextBatch:[{owner,problem,evidenceIds,dependency,priorityReason}],unknowns:[]}. Unobserved metrics are null. Evidence uses persisted run IDs plus file/query anchors; no transcript dumps or sensitive payloads.

Complete only the investigation, not the proposed remediations. A zero-run mode can satisfy the inventory requirement if classified unobserved with explicit follow-up, but cannot satisfy a claim that the mode works. Depend on 0903 alone; its accepted report is the fixed scenario input and ownership map.

### Plan

- [ ] Step 1 (R1, AC1): Consume completed 0903-contract-adoption.json and freeze its scenario IDs, source revision, and available evidence sources; verify the prerequisite is done before investigation.
- [ ] Step 2 (R2, AC2): Build a reproducible local cohort over the 14 UTC days ending at investigation start, newest first with run-ID tie-break, at most ten terminal non-dry runs per mode (inline, pipeline, fleet); deduplicate by persisted run identity and record every exclusion.
- [ ] Step 3 (R3, AC3): Measure completion/verification outcomes, failures/retries, wall duration, session reuse/freshness, executor changes, and manual interventions only where persisted evidence supports them. Distinguish process exit, workflow terminal state, and verified task success.
- [ ] Step 4 (R4, AC4): Read existing cost/session joins and report token/USD coverage independently; missing values are null, never zero. Separate aggregate real-run-cost scope from the bounded cohort, and never label all-history totals as 14-day results.
- [ ] Step 5 (R5, AC5): Evaluate the fixed scenario matrix and the 0903-derived additions against existing traces/local regression tests; label unobserved behavior and missing modes rather than launching new live runs.
- [ ] Step 6 (R6, AC6): Deliver 0905-run-baseline.md and 0905-run-baseline.json with cohort selection, per-run metrics, scenario coverage, source/command provenance, ranked failure clusters, and owner-scoped next-batch proposals.
- [ ] Step 7 (R7, AC7): Validate denominators, duplicate exclusion, nonnegative durations, null handling, trace/run identity and artifact references with a repeatable local check. A sparse baseline must explicitly delimit conclusions and list the missing evidence needed for follow-up.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must reuse existing eval/trace commands, record exact run identities and exit status, and distinguish measured data from inference; no production test or code fix is claimed here.

### Review

Open until the investigation runs. Review must check scenario selection, identity/receipt binding, reviewer isolation, denominator/unknown semantics, and that cost or reliability claims are not inferred from static configuration alone.

### References

- `scripts/commands/real-run-cost.ts`
- `packages/app/tests/workflow/session-pinned-dispatch.test.ts`
- `apps/cli/tests/commands/agent-loop-member-session.test.ts`
- `config/workflows/task-pipeline.yaml`
- `plugins/sp/skills/wayfinder/references/pipeline-resolution.md`
- `docs/design/session-pinned-dispatch.md`
- Feature I31, via `spur feature show I31 --json`.
- Readiness provenance: HEAD d8ff752b2; one local worktree; no wip tasks at audit. Recheck on execution.

### History
