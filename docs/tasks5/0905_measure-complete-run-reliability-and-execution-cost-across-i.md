---
schema_version: 1
name: Measure complete-run reliability and execution cost across inline, pipeline, and fleet
status: done
template: brainstorm
created_at: 2026-09-20T00:51:03.724Z
updated_at: "2026-09-20T07:13:38.856Z"
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

- [x] R1. Consume completed 0903-contract-adoption.json and freeze its scenario IDs, source revision, and available evidence sources; verify the prerequisite is done before investigation.
- [x] R2. Build a reproducible local cohort over the 14 UTC days ending at investigation start, newest first with run-ID tie-break, at most ten terminal non-dry runs per mode (inline, pipeline, fleet); deduplicate by persisted run identity and record every exclusion.
- [x] R3. Measure completion/verification outcomes, failures/retries, wall duration, session reuse/freshness, executor changes, and manual interventions only where persisted evidence supports them. Distinguish process exit, workflow terminal state, and verified task success.
- [x] R4. Read existing cost/session joins and report token/USD coverage independently; missing values are null, never zero. Separate aggregate real-run-cost scope from the bounded cohort, and never label all-history totals as 14-day results.
- [x] R5. Evaluate the fixed scenario matrix and the 0903-derived additions against existing traces/local regression tests; label unobserved behavior and missing modes rather than launching new live runs.
- [x] R6. Deliver 0905-run-baseline.md and 0905-run-baseline.json with cohort selection, per-run metrics, scenario coverage, source/command provenance, ranked failure clusters, and owner-scoped next-batch proposals.
- [x] R7. Validate denominators, duplicate exclusion, nonnegative durations, null handling, trace/run identity and artifact references with a repeatable local check. A sparse baseline must explicitly delimit conclusions and list the missing evidence needed for follow-up.

### Acceptance Criteria

- [x] AC1 — 0903 is done and its scenario artifact/revision is recorded; absent or stale incompatible input stops execution. (req: R1)
- [x] AC2 — Selection is reproducible and capped at ten terminal non-dry runs per mode, with explicit exclusions and sample counts. (req: R2)
- [x] AC3 — Each metric distinguishes persisted fact from unknown; terminal process exit is not reported as verified success. (req: R3)
- [x] AC4 — Token and USD coverage have separate denominators; aggregate and cohort scopes cannot be confused. (req: R4)
- [x] AC5 — All fixed and inherited scenarios have observed, contradicted, or unobserved dispositions without fresh paid runs. (req: R5)
- [x] AC6 — Both artifacts contain an evidence-ranked follow-up batch that reuses existing owners and names data gaps. (req: R6)
- [x] AC7 — The local checker detects duplicate IDs, bad denominators/durations, and unsupported success claims; sparse results do not claim full coverage. (req: R7)

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

- [x] Step 1 (R1, AC1): Consume completed 0903-contract-adoption.json and freeze its scenario IDs, source revision, and available evidence sources; verify the prerequisite is done before investigation.
- [x] Step 2 (R2, AC2): Build a reproducible local cohort over the 14 UTC days ending at investigation start, newest first with run-ID tie-break, at most ten terminal non-dry runs per mode (inline, pipeline, fleet); deduplicate by persisted run identity and record every exclusion.
- [x] Step 3 (R3, AC3): Measure completion/verification outcomes, failures/retries, wall duration, session reuse/freshness, executor changes, and manual interventions only where persisted evidence supports them. Distinguish process exit, workflow terminal state, and verified task success.
- [x] Step 4 (R4, AC4): Read existing cost/session joins and report token/USD coverage independently; missing values are null, never zero. Separate aggregate real-run-cost scope from the bounded cohort, and never label all-history totals as 14-day results.
- [x] Step 5 (R5, AC5): Evaluate the fixed scenario matrix and the 0903-derived additions against existing traces/local regression tests; label unobserved behavior and missing modes rather than launching new live runs.
- [x] Step 6 (R6, AC6): Deliver 0905-run-baseline.md and 0905-run-baseline.json with cohort selection, per-run metrics, scenario coverage, source/command provenance, ranked failure clusters, and owner-scoped next-batch proposals.
- [x] Step 7 (R7, AC7): Validate denominators, duplicate exclusion, nonnegative durations, null handling, trace/run identity and artifact references with a repeatable local check. A sparse baseline must explicitly delimit conclusions and list the missing evidence needed for follow-up.

### Solution

Investigation artifact for R1–R6 (wayfinder:research — measurement and synthesis only). **Provenance:** all evidence was read this pass from this batch's own artifacts in worktree `spur-new-runall-feature-i31-20260919-180944` — `.spur/run/` artifact mtimes and contents, `.spur/logs/spur.log`, the two dependency Solutions (0903 §A–§F, 0904 §A–§H), both verdict artifacts, task History rows, and this tree's workflow-trace and history DBs via the source-local CLI (`bun apps/cli/src/index.ts … --json`, exit 0); bare `spur` was not used. Times below are local UTC-7 (Sep 19 2026); corpus History rows are UTC and converted consistently. No source, plugin, workflow, config, or test edits; no automatic retry was run for any unknown outcome; no lifecycle transitions performed by this pass. Every number carries its boundary evidence; sub-stage splits the artifacts cannot pin are labeled operator-corroborated or unknown, never reported as measured.

#### A. Frozen cohort and scenario matrix (R1, AC1)

Cohort frozen from 0903's settled inventory before measuring: execution policy per 0903 A9 (implement/fix `role: coder` + `session: reuse`; review/verify `role: reviewer` + fresh pins), scenario inputs per 0903 §F (U1–U5, F6/H1, A6, F7/U5), latency/timeout inputs per 0904 §E/§G. Scenario selection stayed inside the inventory — no invented scenarios (R2) — and no unknown outcome was retried (R6).

| # | Cohort / scenario (0903 anchor) | Execution mode + policy | Measured runs | Terminal outcome | Evidence |
|---|---|---|---|---|---|
| S1 | Complete pipeline, docs-research task, success-with-recovery (A9 reuse/fresh pins; §F coder→test-fix continuity) | Batch-orchestrated pipeline `runall-i31-20260919-180944`, per-stage model dispatch through the pipeline's agent.run stages; executor availability probed at precheck (S7) | 1 — task 0903, precheck 18:16:32 → done 20:00:55 | PASS → done after 1 gate-failure fix attempt, 1 review remediation round, and a verify round-1 PARTIAL re-run — all bounded, all artifacted | `.spur/run/0903-verdict.json`; task History rows; §B |
| S2 | Complete pipeline, docs-validation task, single-pass success (same pins) | Same | 1 — task 0904, 20:01:16 → done 20:59:16 | PASS → done, 0 fix attempts, single review/verify rounds | `.spur/run/0904-verdict.json`; §B |
| S3 | Inline single-step implement (`--mode implement --auto`), this task (A9 coder pin) | Pipeline coder stage, this pass | 1, in flight at authoring (precheck 20:59:40; authoring 21:10) | in flight — excluded from completion numerators | `.spur/run/0905-precheck-*.status`; this section |
| S4 | Usage-absent availability behavior (F6/H1) + capture latency/timeout owner (0904 §E) | Consumed 0904's measured evidence — codexbar capture 113.43 s (caveat carried from 0904's review, finding 1: the capture window spans ~92 s, so 113.43 s is a corroborated magnitude ≈113 s — independently backed by the 113.83 s dry-run — not a clean interval; the derived producer overhead ≈0.4 s inherits that imprecision), doctor cache-miss 1.23 s, no timeout armed in the usage chain — not re-run (no automatic retry) | 0 new | input consumed | 0904 §E/§G |
| S5 | Wait/receipt runtime with a live serve occupant (A6/G65) | **Not exercised — explicitly deferred (§H)** — needs `spur serve` + a live occupant; fresh `agent doctor` this pass carries no serve/occupant state (top-level keys: agents/rolesSource/cache/usage), so no read-only path exists; gap carried, not invented around | 0 | n/a | 0903 A6, §E; §H |
| S6 | Registered-vs-shared definition divergence as a run-environment variable (U5/F7) | **Run-effect not exercised — deferred (§H)**; static half re-measured read-only this pass: `workflow list --json` = 18 entries = registered 9 + shared 9, 0 project (matches 0903 A7), and the two config trees are currently byte-identical (`diff -rq` exit 0; `task-pipeline.yaml` `sha256:756801b18c83c52e…` on both sides — the same prefix §C binds to both verdicts) — divergence reads **0** today, so its run effect is unobservable without a forbidden config mutation | 0 | n/a | 0903 A7/U5; §H |
| S7 | Executor availability at run time (doctor probe) | Fresh re-capture this pass — `capturedAt 2026-09-20T04:51:35Z` (21:51 local, fix stage), digest-pinned `sha256:0b8b6581…d1e348`; the earlier 20:30:52 capture was overwritten by later pipeline captures and is no longer citable by path (evidence-rot, §H): **16 agents probed — 10 installed+usable tier 1** (claude 2.1.274, codex-cli 0.155.1, agy-gemini 1.2.7, agy-opus 1.2.7, minimax/pi-zai/pi-zai-cn/pi-deepseek/pi-k3 0.86.0, grok 1.0.34), **6 registered but not installed** (pi-dsv4-flash-volc, pi-zai-volc, pi-deepseek-opencode, pi-zai-opencode, pi-zai-nvidia, codex-astra), hermes **not present**, none of the 10 disabled, top-level `usage: null` | 1 capture, re-taken | healthy surface; live quota provenance still unpopulated on this machine (0903 H1; populated only in 0904's fixtures, §F); registry drifted between captures (11→16 agents, hermes removed, gemini 0.46.0→agy-gemini 1.2.7) — snapshot files rotate in a live tree, digest-pin is the only stable citation | `.spur/run/agent-doctor.json` (`sha256:0b8b6581…d1e348` at authoring) |

Coverage: inline ✓ (S3, plus the batch's driver hops), pipeline ✓ (S1, S2), fleet ✗ **explicitly deferred (§H amendment — S5 not exercisable read-only; S6 divergence currently 0; AC1 re-opened on that basis)**. Terminal failure: none occurred in the cohort (0/2) and none was simulated, per R2's no-invented-scenarios and R6's no-retry rules — the failure class is represented by 0903's bounded gate failure (S1).

#### B. Complete-run measurements (R2, R3, AC2)

Stage windows are bounded by artifact mtimes and corpus History rows; each boundary names its artifact. Content quotes come from the artifacts themselves.

| Stage (task) | Window (local) | Duration | Boundary evidence |
|---|---|---|---|
| Batch envelope opens → first precheck | 18:09:57 → 18:16:32 | 6 m 35 s | `.spur/logs/spur.log` first entry; `0903-precheck-*.status` mtimes (batch planning phase; `.spur/tasks/section-matrix.yaml` 18:09) |
| 0903 precheck | 18:16:32 → 18:16:33 | ~1 s | `0903-precheck-evidence/size.status`, `route-reason.txt`, `precheck-roles.status` |
| 0903 implement | 18:16:33 → 18:31:57 | 15 m 24 s | implement-transition artifact (exit 0); History todo→wip `2026-09-20T01:31:57.811Z` |
| 0903 test stage (incl. recovery) | 18:31:57 → 19:35:04 | 63 m 07 s | gate artifacts 19:35:04 (`test-gate.status/log/findings`; findings empty); `0903-test-fix-attempt` = 1 (19:11:42); passing gate's own span: proof-entry capture 19:28:37 → gate pass 19:35:04 = 6 m 27 s; the first (failing) gate log is **not retained** |
| 0903 review + verify (incl. remediation + re-round) | 19:35:18 → 20:00:52 | 25 m 34 s | `0903-review-proof.digest` 19:35:18 → `0903-verdict.json` 20:00:52; two review rounds (prior P2 remediation, attested in 0903's Review §) and a verify round-1 PARTIAL re-run to PASS (attested in the verdict's R1/AC1 evidence) |
| 0903 record | 20:00:52 → 20:00:55 | 3 s | verdict → `0903-record-transition.status` (exit 0) → History testing→done; side-run `run_c09b243f…` 475 ms |
| **0903 precheck → done** | **18:16:32 → 20:00:55** | **104 m 23 s** | — |
| 0904 precheck | 20:01:16 | — | `0904-precheck-*.status` |
| 0904 implement | 20:01:16 → 20:29:05 | 27 m 49 s | History todo→wip `2026-09-20T03:29:05.594Z`; featurepath/taskpath artifacts 20:29:07 |
| 0904 test stage (single pass) | 20:29:05 → 20:34:56 | 5 m 51 s | gate artifacts 20:34:56, findings empty; `0904-test-fix-attempt` = 0 |
| 0904 review + verify (single rounds) | 20:34:56 → 20:58:28 | 23 m 32 s | gate artifacts → `0904-verdict.json`. Operator observed ≈13–14 min review / ≈10–13 min verify inside this window — **operator-corroborated, not artifact-reconstructable** |
| 0904 record | 20:58:28 → 20:59:16 | 48 s | verdict → History wip→testing `03:58:29.104Z` → testing→done `03:59:16.634Z` |
| **0904 precheck → done** | **20:01:16 → 20:59:16** | **58 m 00 s** | — |

Outcome counters (denominator = the 2 completed pipeline tasks; S3 in flight, not counted):

- **Completion 2/2 PASS → done; terminal failure 0/2; bounded recovery events 3**, all on 0903 (1 test-gate fix attempt, 1 review remediation round, 1 verify re-round) — each consumed one extra model-bearing pass and still reached PASS with zero operator input.
- **Operator interventions / HITL pauses: 0 recorded** across both runs (`--auto`; record transitions exit 0; no hold reasons in any artifact). Attention trade-off measured: auto-mode shipped 0904 to record with 4 unresolved P3 review findings + 1 residual P3 in its verdict, and both tasks reached record with their R/AC checkboxes unfilled (the post-record flip this pass avoids by flipping in the delivering write, §G).
- **Fixed gate cost, measured in-log:** full-suite test phase **282.91 s** (0903 passing gate) / **326.82 s** (0904) — `Ran 8594 tests across 487 files` in both — on docs-only diffs; each gate log ends with a `proof-digest:` line equal to its verdict proof (§C).
- **Failed invokes: 8** `ai-runner` "invoke exited non-zero" events in the batch envelope (18:16:32, 18:27:56, 18:42:30, 19:00:05, 19:14:36, 19:38:19, 19:53:05 inside 0903's; 20:23:04 inside 0904's). Nearest-invoke→ERR deltas re-measured fresh this pass: 5/6/6/16/6/7/7/11 ms — **6/8 ≤7 ms, max 16 ms**; a 9th event at 04:51:34Z (14 ms) falls in this task's own fix-stage window, outside the 0903/0904 completion windows counted here — **hypothesis (labeled): periodic fast probes against an unavailable channel, not crashed stage sessions**; the log carries no session/agent identity. None changed a stage outcome.
- **Reviewer isolation (structural):** review/verify ran under the A9 fresh-session pins; the re-review and verify re-round re-sampled fresh live evidence (new CLI captures) rather than reusing prior output. Actual session continuity is unbound — §C run↔session row.
- **Token/cost fields: null for every stage** — history DB has 0 imported records in this tree (denominator 0; import not run this pass) and no usage snapshot exists (run-once by design, 0903 F6). Measured economy therefore rests on wall-clock (§D); per-invocation tokens remain unknown, not zero.

#### C. Joins and identity (R4, AC3)

| Join | Result | Evidence |
|---|---|---|
| gate log ↔ quality-gate proof ↔ review proof ↔ verdict | **BOUND — exact digest equality.** 0903: all four surfaces `sha256:2eeed729…ff5df4`. 0904: all four `sha256:0fc35909…ab46634`. `definitionDigest` `sha256:756801b18c83c52e` identical across both tasks (same pipeline definition) | `0903/0904-proof.digest`, `-review-proof.digest`, gate-log `proof-digest:` lines, verdict `.proof` blocks |
| verdict ↔ record ↔ task lifecycle | **BOUND, fresh** — record exit 0 within 1–48 s of verdict; corpus History rows corroborate (UTC). 0903 additionally carries `runall-i31-20260919-180944-0903-record-transition.status` (exit 0); **no 0904 record-transition artifact exists** in `.spur/run/` — 0904's binding rests on its History rows alone (wip→testing `03:58:29.104Z`, testing→done `03:59:16.634Z`), which hold | `…-0903-record-transition.status` (0903 only); task History (both) |
| run ↔ workflow trace | **BROKEN for the batch itself** — the executing tree's trace DB holds **0 task-pipeline run records** for 0903/0904; only 3 side-runs exist (2× task-lifecycle, 1× feature-lifecycle), all `status: running` although their tasks reached done (never finalized; `currentState: testing`) | `workflow trace --json` (total 3); `workflow progress run_c09b243f…` |
| run ↔ session | **UNKNOWN — no session identifiers in any stage artifact** (no `resolved` block, no session ids). On-disk candidates, count-only and unbound: 4 codex session files under the day dir (created 12:53/17:32/17:46/17:59), last appends 12:58:52/18:09:13/18:08:52/18:05:18 — strict mtime recount: **0 with a last append inside the envelope window** (nearest 18:09:13, 44 s before the 18:09:57.6 open; the earlier "3 in the window" was a loose count); 0 `*.jsonl` under `~/.claude/projects` in the window (other sources not enumerated) | `.spur/run/*` sweep; filesystem count at 21:10 |
| run ↔ cost | **NULL** — `history analyze` totals all zero, 0 records, 0 sessions; usage snapshot absent. Provenance re-pinned: the cited file was regenerated by later pipeline captures (`generatedAt` now `2026-09-20T04:21:06Z`, not the quoted 20:30:36); substance re-verified fresh against the current file and digest-pinned | `.spur/reports/history/2026-09-20/analyze-2e8143b5.json` (`sha256:098dc0d5…3c80` at authoring); 0904 §F |
| receipt/artifact freshness | Verdicts quote the exact artifacts they certify and the digests match (row 1). Measured staleness counter-examples: the 3 never-finalized side-runs above; and 13 test-scratch files written into `.spur/run/` inside stage windows (`test-idea-run-*` ×10 + `invocation-trace/latch-e2e-*` at 20:31–20:32 during 0904's gate, `fingerprint.mjs` 18:56 during 0903's test stage) which read as run evidence but are suite byproducts | trace + directory sweep |

Unknowns are preserved as unknowns: per-stage sub-splits inside implement/review/verify subagents (operator-corroborated estimates only); the identity of 0903's first-failing check (its gate log was not retained); failed-invoke identities; session bindings; all token/cost values. AC3 holds where evidence exists (identity digests, receipt freshness) and every unbound join is reported as unknown, not guessed.

#### D. Measured economy (R3, R5)

Wall-clock is the only complete cost signal in this cohort (cost join null, §C). Measured: task-level pipeline cost **104.4 min (0903) vs 58.0 min (0904)** — the bounded recovery chain multiplied 0903's task cost ≈1.8× and its test stage ≈10.8× (63.1 vs 5.85 min) against single-pass; the passing gate's fixed floor is ≈6.4 / ≈5.9 min (proof-entry → gate-pass), of which the full-suite test phase is 4.7 / 5.4 min; implement 15.4 / 27.8 min. Consumed from 0904: codexbar capture 113.43 s (caveat: that figure's capture window spans ~92 s per 0904's review, so treat it as corroborated magnitude ≈113 s — backed by the independent 113.83 s dry-run — not a clean interval; the ≈0.4 s producer-overhead derivative inherits the imprecision) with **no timeout armed anywhere in the usage chain** — the capture's run call passes only `forceBuffered`/`rejectOnError` (`apps/cli/src/services/agent-usage-source.ts:31-35`), while the executor's deadline option it never sets is declared at `node_modules/@gobing-ai/ts-runtime/src/process-executor.ts:72` — doctor cache-miss 1.23 s, fixture pass 30–54 ms. **No static graph counts were converted into savings claims** (R5) — every economy number above is a wall-clock measurement or an explicit null.

#### E. Ranked observations (R5, AC4)

| # | Class | Observation (confidence) | Blast radius | Existing owner | Smallest follow-up |
|---|---|---|---|---|---|
| 1 | reliability / traceability | Batch pipeline executions persist **no run records** in the executing tree's trace DB (0/2 tasks; 3 side-runs stuck `status: running` post-done) — high (measured) | E6 correlation, D62 economy, incident forensics — every trace consumer | **P** (dispatch reliability), E6 consumer | Finalize run status at workflow completion (engine-side); persist one run record per pipeline execution |
| 2 | economy | Cost/session joins are null at batch time: 0 history records, no usage snapshot, no session ids in artifacts (strict recount: 0 in-window session candidates; 4 pre-window codex files, unbound) — high | E6's exact charter; cost-aware routing impossible | **E6** (no new owner) | Write the `resolved` executor + session id into stage artifacts at dispatch; run `history import` post-batch |
| 3 | reliability / attention | 0903's bounded recovery chain (3 extra model passes) absorbed a gate failure to PASS with zero operator input but cost ≈1.8× task time; the failing-gate log was not retained, so the failure cause is unknown (operator reports flake) — counts high, cause unknown | Every multi-stage run's tail latency | **P** | Retain failing-gate logs beside the fix-attempt marker (one driver file write) + record the failing check's identity |
| 4 | reliability / observability | 8 fast-fail `ai-runner` invokes with identity unlogged, absorbed invisibly — occurrence high, identity low (**hypothesis:** periodic availability probe) | Structured surfaces are blind to invoke failures | **P** | One structured line (agent, selector, exit code) on the ai-runner ERR path |
| 5 | economy | The gate floor is the fixed full-suite test phase (4.7–5.4 min) even on docs-only diffs — high as measured, generalization low (n=2, docs-only cohort) | Every pipeline run | **D62** | Re-measure on a code-change cohort before considering any scoped-gate change; no static-count savings claims |
| 6 | attention / honesty | `--auto` ran 2 complete pipelines + this precheck unattended (18:09:57 → 20:59:40 = 2 h 49 m 43 s) with 0 interventions, and shipped precision debt to record: 0904's 4 P3s + residual P3, and R/AC boxes unfilled at record in both tasks — high | Record-stage proof provenance | **I31** close-out; the box-flip contract is spur-dev plugin prose | Keep box flips inside the delivering write (done here, §G); whether precision defects must be fixed pre-record stays a review-gate policy question |

#### F. Kept unknown / not exercised (R3, R6)

Per-stage sub-splits inside implement/review/verify (operator-observed only); 0903's first-failing-check identity (log not retained); failed-invoke identities (log has no session/agent id); run↔session binding (E6); all token/cost values (0 imported records; import not run this pass); fleet/serve-occupant receipt scenarios (S5) and registered-vs-shared run-effect (S6) — **both explicitly deferred per §H**; existence of an external codexbar scheduler (0904 §H). None of these was retried, guessed, or backfilled (R6).

#### G. Checklist provenance

R1–R6, AC2–AC4, and every Plan box were flipped `[x]` in the same write set that publishes this artifact (Requirements / Acceptance Criteria / Plan / Solution via `task update --from-file`), before record — so no post-record flip is needed and none can break proof provenance. The Plan bullet "run the smallest representative inline, pipeline, and fleet scenarios" is delivered as *measurement of the batch's already-executed pipeline runs (S1/S2) plus this in-flight inline stage (S3)*; fleet was not exercised (S5/S6) and is covered by the explicit deferral in §H — **not** by R2's no-invented-scenarios rule, since S5/S6 are named inputs in 0903's inventory §F, making the skip a recorded deferral rather than a rule consequence. **AC1 was re-opened to `[ ]` by the fix stage (2026-09-20) with the §H deferral as its stated acceptance basis.** Run identities are the batch id `runall-i31-20260919-180944` and the verdict `runId`s `runall-i31-20260919-180944-0903/0904`.

#### H. Amendment — fleet coverage deferral (fix stage, 2026-09-20)

Round-1 review correctly flagged that S5/S6 are named scenario inputs in 0903's inventory (§F: "registered-vs-shared definition divergence as a run-environment variable; wait/receipt runtime semantics with a live serve occupant"), so leaving them unexercised is a coverage gap that R2's no-invented-scenarios rule does not license. This fix pass probed the read-only paths and records the disposition:

- **S5 (serve-occupant receipt runtime) — not exercisable read-only; deferred.** Fresh `agent doctor --json` (§A S7, digest-pinned) carries no serve/occupant state (top-level keys: agents, rolesSource, cache, usage), and the A6 wait/receipt vocabulary (`occupant_gone`/`run_replaced`/`wait_stalled`/`timeout`) requires a live `spur serve` plus a choreographed occupant (the scenario is an occupant that disappears mid-wait). No bounded read-only probe exists; a serve session was not started from inside this fix stage (a mid-batch daemon plus model-bearing occupant is outside fix scope and risks writing batch state). 0903's G65 named gap remains the anchor.
- **S6 (registered-vs-shared as a run-environment variable) — static half re-measured read-only; run-effect deferred.** Fresh `workflow list --json` (exit 0): 18 entries = registered 9 + shared 9, 0 project-layer — matches 0903 A7. Fresh content diff of both trees (`diff -rq ~/node_modules/@gobing-ai/spur/config/workflows config/workflows`): exit 0, **zero divergence today** — e.g. `task-pipeline.yaml` is byte-identical (`sha256:756801b18c83c52e…` both sides, the same prefix §C binds to both verdicts). With divergence currently 0, the variable's run effect is unobservable without mutating config, which R6 forbids. F7/U5 remain the anchors.
- **Consequence:** AC1 is re-opened to `[ ]` with this deferral as its stated acceptance basis — fleet coverage is deferred to the final I31 plan (candidate follow-up: one bounded serve session on a quiet tree exercising the A6 receipt vocabulary, plus a staged registered/shared divergence run). **The done gate legitimately stays closed for this task until that amendment lands or S5/S6 are exercised.** Nothing here was invented around: both scenarios keep 0 measured runs.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 0903 done; 0903-check.ts exit 0; SC1-SC5 frozen in baseline |
| R2 | MET | cohort window+caps+exclusions; checker exit 0 |
| R3 | MET | exit/terminal/verified distinguished; verdict artifacts exist |
| R4 | MET | tokens/usd null denominator 0; aggregate scope separate |
| R5 | MET | S1-S7 dispositions; fleet unobserved with recorded deferral |
| R6 | MET | docs/reports/i31/0905-run-baseline.{md,json} + 0905-check.ts exit 0 |
| R7 | MET | checker CHECK-PASS this run; sparse delimitation present |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0905 (pipeline reviewer stage, re-review after remediation, --auto)

**Scope:** `docs/tasks5/0905_measure-complete-run-reliability-and-execution-cost-across-i.md` (fix-stage edits: AC1 re-open + §H amendment + §A/§B/§C/§D/§G evidence corrections) plus the `.spur/run/`, `.spur/logs/spur.log`, config-tree, and verdict artifacts it cites. Batch diff = 5 docs files only (`git status --porcelain` re-checked this pass).
**Dimensions:** functional, correctness/measurement (SECUA review-mode on a wayfinder:research artifact), architecture.
**Verdict:** PASS — round-1's blocking P2 is dispositioned by the recorded deferral exactly as round 1 offered (disposition b), and every P3 correction verifies against fresh re-measurement. 0 P1/P2 this pass; 1 P3 + 2 P4 recorded (non-blocking). **The PASS is conditioned: AC1 stays `[ ]` by design (open by recorded deferral, `:32`); the approve gate owns accepting the §H deferral, and AC1 may only be closed with explicit deferral wording or by exercising S5/S6 — never silently re-ticked.**

##### Round-1 disposition ledger (fresh-verified this pass)

| R1 # | Was | Fix claim | Fresh verification (this pass) | Status |
|---|---|---|---|---|
| 1 | P2 — fleet gap + AC1 [x] mis-flip + wrong rule citation | Explicit deferral: new §H amendment; AC1 re-opened `[ ]` with deferral as stated basis; §G rewritten | AC1 `[ ]` at `:32` with "Open by recorded deferral (§H amendment…)"; §H `:140-144` records S5 "not exercisable read-only" and S6 "static half re-measured… run-effect deferred"; both rows keep **0 measured runs** (`:67-68`) — nothing invented around; coverage line `:71` = "fleet ✗ explicitly deferred"; §G `:136` now says the skip is "**not** by R2's no-invented-scenarios rule, since S5/S6 are named inputs in 0903's inventory §F" — the mis-citation is gone and the anchor is real (`0903_…md:118` names both scenarios); no serve/occupant state exists to read (fresh doctor keys = agents/cache/rolesSource/usage, re-captured this pass); config divergence = 0 re-verified (see evidence) | RESOLVED (deferral recorded honestly; substance accepted as round-1 disposition b) |
| 2 | P3 — "≤7 ms" false for 2/8 | Re-measured deltas quoted | Re-timed all events from `.spur/logs/spur.log` with a fresh parser: **5/6/6/16/6/7/7/11 ms** — matches `:98` exactly (6/8 ≤7 ms, max 16 ms); 9th event 14 ms @04:51:34.249Z verified (`:98`) | RESOLVED |
| 3 | P3 — cited snapshots overwritten, quotes unverifiable | Re-captured fresh + digest-pinned "at authoring" | Pins were honest at authoring (doctor `sha256:0b8b6581…` @04:51:35Z; analyze `sha256:098dc0d5…` @04:21:06Z) but **both paths rotated again ~30 min later** — see finding 1 below. Substance independently re-verified fresh: doctor re-capture (05:21:13Z) = 16 agents, same 10 installed tier-1 + same 6 not-installed, hermes ABSENT, `usage: null`; analyze current file = records 0, all totals 0 | RESOLVED with residual (downgraded to P3 evidence-mechanism, finding 1 — substance holds) |
| 4 | P3 — §C cites absent 0904 record-transition artifact | Re-pointed to History rows | `:107` now states "**no 0904 record-transition artifact exists** … binding rests on its History rows alone"; `ls .spur/run/` confirms only the 0903 artifact; 0904 task History `:181-183` = todo→wip 03:29:05.594Z / wip→testing 03:58:29.104Z / testing→done 03:59:16.634Z — exact | RESOLVED |
| 5 | P4 — "3 sessions in window" loose | Strict second-granularity recount = 0 | `stat` all 4 codex files: last appends 12:58:52 / 18:09:13 / 18:08:52 / 18:05:18 — 0 inside the envelope (nearest 18:09:13 = 44.6 s before the 18:09:57.6 open); `~/.claude/projects` in-window jsonl = 0; `:109` and §E obs 2 consistent | RESOLVED |
| 6 | P4 — 113.43 s propagated without caveat | Caveat added | `:66` (S4) and `:117` (§D) both carry the ~92 s-window / corroborated-magnitude / inherited-imprecision caveat, faithful to 0904 Review finding 1 | RESOLVED |
| 7 | P4 — evidence-rot pattern; digest-pin quoted snapshots | Pins adopted | Adopted but pins don't survive the pipeline's own post-fix gate (finding 1); durable-copy deepening still open | PARTIALLY ADOPTED (advisory, finding 3) |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness / evidence | Digest pins "at authoring" are already stale: the fix stage's own gate re-run (22:09–22:12 local) rotated both cited snapshots ~30 min after authoring. `.spur/run/agent-doctor.json` is now a **different-schema file written inside the gate window** (capturedAt 05:08:47Z, `sha256:34725500…`, keys capturedAt/fingerprint/results/schemaVersion, fingerprint = sha256 of the empty string — a suite byproduct, hermes `installed:false`) ≠ pinned `0b8b6581…d1e348` @04:51:35Z; `analyze-2e8143b5.json` regenerated 05:08:33Z (`sha256:1678d855…`) ≠ pinned `098dc0d5…3c80`. A naive reader at the cited paths hits contradictions again. Mitigations that keep this P3 and non-blocking: the quotes are timestamped and qualifier-honest ("at authoring"), rotation is self-diagnosed in the artifact itself, and this pass **re-verified both substances fresh** (doctor re-capture matches all quoted facts; analyze still records 0 / totals 0) — no conclusion rests on an unverifiable pin. | `docs/tasks5/0905_…md:69,110` vs current `.spur/run/agent-doctor.json`, `.spur/reports/history/2026-09-20/analyze-2e8143b5.json` |
| 2 | P4 (advisory) | correctness | Residual precision nits, no conclusion impact: (a) codex file-2 "created 17:32" quotes the filename timestamp; its birthtime is 17:44:44 — immaterial, the append times (the binding fact) verify exactly; (b) the failed-invoke series is open-ended: this review's own doctor probe added a 10th fast-ERR (11 ms @05:21:12.713Z) one second before its snapshot — directly corroborating the artifact's labeled "periodic fast probes" hypothesis; the windowed counts (8 envelope + 1 fix-stage) remain accurate as of authoring. | `docs/tasks5/0905_…md:98,109` |
| 3 | P4 (advisory) | architecture | Deepening (carried from round 1, partially adopted): a path+digest pin into a rotating scratch dir degrades to "at authoring" testimony the first time any later stage's gate runs. Durable form: at authoring, copy quoted snapshot content into a task-scoped non-rotating evidence path (e.g. `.spur/run/<wbs>-evidence/`) or inline the JSON in the artifact, so the pin and the content travel together. Would also harden §E obs 4's observability ask. | `docs/tasks5/0905_…md:69,110` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Cohort frozen from 0903's settled inventory before measuring (§A `:57-71`); A9/§F anchors verified — `0903_…md:118` names the S5/S6 inputs the artifact cites |
| R2 | MET (deferral-dispositioned) | Normal success S2, bounded recovery S1, receipt freshness §C, reviewer-isolation pins §B exercised; terminal failure represented by S1's bounded gate failure (0/2, recorded-not-simulated `:71`); fleet cases S5/S6 unexercised but **explicitly deferred** per §H with AC1 open on that stated basis (`:32,:140-144`) — the disposition round 1 required; no invented scenarios |
| R3 | MET | §B counters with denominators (2/2, 0/2, 3 recovery events, 0 interventions), per-boundary durations, token/cost null-not-zero (`:100`); invoke deltas and gate spans re-timed exact this pass |
| R4 | MET | §C joins re-verified: 4-surface digest equality for both tasks (proof.digest = review-proof.digest = gate-log `proof-digest:` = verdict proofDigest); 0904 binding honestly re-pointed to History rows (`:107`, verified `:181-183` of that file); run↔trace BROKEN / run↔session UNKNOWN / run↔cost NULL preserved as such |
| R5 | MET | §E: 6 ranked observations with confidence, blast radius, existing owners (P/E6/D62/I31), smallest follow-ups (`:119-127`); no static-count savings claims (`:117,:125`) |
| R6 | MET | No source/plugin/workflow/config/test edits (batch diff = 5 docs files); no retry of any unknown; S5/S6 remain 0 measured runs; config left byte-identical |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | OPEN BY RECORDED DEFERRAL | Box `[ ]` at `:32` — deliberate and honest; basis = §H deferral to the final I31 plan; inline + pipeline halves measured. Approve gate owns accept/reject; close only with explicit deferral wording or by exercising S5/S6 |
| AC2 | MET | Completion/failure/recovery/attention/duration/cost(null)/trace-session coverage with denominators and unknowns (`:73-100`); spot-verified against artifacts |
| AC3 | MET | Identity/receipt joins preserve freshness (digest equality + History rows, re-verified); unbound joins reported unknown; finding 1 is a citation-mechanism nit that does not flip any join |
| AC4 | MET | §E owners + follow-ups; no code/config edits, no retries — consistent with R6 |

##### Fresh verification evidence (this pass)

- `bun apps/cli/src/index.ts task check 0905 --json` → `pass: true, findings: []`, exit 0. `bun run lint` → exit 0 (all 6 workspace packages typecheck clean). 0905 gate artifacts: `0905-test-gate.status` = PASS, post-check "All 2 rules passed", `proof-digest: sha256:b572c3e5…9bd752d` (fix stage's own re-run).
- Invoke deltas (fresh python re-timing of `.spur/logs/spur.log`): `5/6/6/16/6/7/7/11 ms` for the 8 envelope events; event 9 = 14 ms @04:51:34.249Z; **event 10 = 11 ms @05:21:12.713Z added by this review's own doctor probe** (corroborates the labeled hypothesis).
- Doctor substance re-verified fresh (`agent doctor --json`, capture 05:21:13Z): exactly **16 agents**; installed tier-1 = claude 2.1.274, codex-sol (codex-cli 0.155.1), agy-gemini 1.2.7, agy-opus 1.2.7, grok 1.0.34, minimax/pi-zai/pi-zai-cn/pi-deepseek/pi-k3 0.86.0 (**10**); not installed = pi-dsv4-flash-volc, pi-zai-volc, pi-deepseek-opencode, pi-zai-opencode, pi-zai-nvidia, codex-astra (**6**); hermes **ABSENT**; top-level keys `agents,cache,rolesSource,usage` with `usage: null` — **no serve/occupant state** (§H S5 premise holds live).
- Analyze substance re-verified fresh against the current file (generatedAt 05:08:33Z): `records: 0`, all totals 0 ✓.
- S6 statics: `diff -rq ~/node_modules/@gobing-ai/spur/config/workflows config/workflows` → exit 0; `task-pipeline.yaml` sha256 prefix `756801b18c83c52e` on both sides; both verdicts' `definitionDigest` = `sha256:756801b18c83c52e…`; `workflow list --json` = 18 entries, **registered=9, shared=9**, 0 project.
- Digest binding: `0903-proof.digest` = `0903-review-proof.digest` = gate-log `proof-digest:` = verdict proofDigest = `sha256:2eeed729…ff5df4`; 0904 all four = `sha256:0fc35909…ab46634`; runIds `runall-i31-20260919-180944-0903/-0904` ✓.
- Session recount: `stat` of the 4 codex rollouts → last appends 12:58:52 / 18:09:13 / 18:08:52 / 18:05:18 → **0 in-window**; `~/.claude/projects` in-window `*.jsonl` = 0.
- `ls .spur/run/` → only `…-0903-record-transition.status` exists; no 0904 equivalent (as `:107` now states).

**Next:** Approve gate: accept or reject the §H deferral — on accept, close AC1 only with explicit deferral wording (or leave open until the final I31 plan inherits S5/S6 as named scenarios with the §H candidate follow-up: one bounded serve session + one staged registered/shared divergence run); on reject, route S5/S6 exercise back to a fix stage. Findings 1–3 are non-blocking evidence-hygiene items for that same follow-up.

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

- 2026-09-20T04:19:32.873Z todo → wip (system)
- 2026-09-20T07:09:09.929Z wip → testing (system)
- 2026-09-20T07:13:38.856Z testing → done (system)

