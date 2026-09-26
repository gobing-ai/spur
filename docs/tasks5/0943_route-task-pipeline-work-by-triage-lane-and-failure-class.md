---
schema_version: 1
name: Route task-pipeline work by triage lane and failure class
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.006Z
updated_at: "2026-09-26T00:58:58.536Z"
feature_id: D64
priority: P2
tags:
  - workflow
  - task-pipeline
  - promotion

dependencies: ["0938", "0940", "0941"]
estimate_hours: 8
---

## 0943. Route task-pipeline work by triage lane and failure class

### Background

Implements: R9 — Task pipeline routes work by triage lane and failure class; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7. Uses the decide action and check receipts.

**Refine corrections (2026-09-23)**

1. *A review-bypass lane already exists.* `config/workflows/task-pipeline.yaml` already has proportional fast-path edges, `test → verify` and `test-recheck → verify`, guarded by `gate_status = PASS && mode = fast` (lines 656–708). Their safety twins go to `review`. The `mode` var (default `""`) has **no producer**: it is only settable by the caller. The `precheck` route-reason map (line 197) already names `fast | "" | unknown | conflict`. The "low lane" is therefore not a new skip edge. It is a deterministic plus `decide` **producer of `mode`**, feeding the existing edges.
2. *The approve pause is untouched.* Under `profile=auto`, `review` routes around `approve`. In interactive runs `approve` stays a `hitl.confirm` with `decision: {mode: never}` (line 455). Triage never touches it.
3. *Guards read JSON result files with `jq`.* This matches the existing `record`/`verify` shell guards. `file.read.into-var` projects raw trimmed content, which is not useful for a JSON result.
4. *Dependencies.* 0941 provides `decide`, and 0938 provides the baseline. 0940 is listed only because both edit `task-pipeline.yaml` (serialize the edits). The receipt from 0939 is used transitively through 0940.

### Requirements

- [x] R1. A new deterministic state `triage` sits between a green gate and the review/verify fork. `test` (PASS) and `test-recheck` (PASS) route to `triage`, replacing their four PASS edges with two. `triage → verify` is guarded by `mode = fast`, and `triage → review` by `mode != fast`.
- [x] R2. On entering `triage`:
  - (a) A deterministic producer writes `.spur/run/<wbs>-diffstat.json`: `{files, insertions, deletions, paths[], sensitive: boolean}`, from `git diff --numstat` against the run's base plus untracked files.
  - (b) If `mode` is already non-empty (caller-set), nothing is overridden.
  - (c) If `sensitive` is true (paths under `drizzle/`, `packages/config/`, `apps/server/src/**/auth*`, `**/*secret*`, `.github/`, `plugins/sp/hooks/`, or any `*.sql`), or the diff exceeds 400 changed lines, `mode` stays safety with a `triage: deterministic-high` reason. No `decide` call is made.
  - (d) Otherwise it runs `decide task-triage` (`method: choice`, choices `[low, standard, high]`, `default: standard`, evidence = diffstat plus the task Requirements). `low` sets `mode=fast`, and anything else leaves it empty.
- [x] R3. On a FAIL at `test` or `test-recheck`, before `test-fix`, the `decide failure-class` action (`choices [retryable, fix, stop]`, `default: fix`, evidence = bounded `<wbs>-test-gate.findings`) routes:
  - `fix` → `test-fix`, as today;
  - `retryable` → `test-recheck` without fixall, still counting an attempt;
  - `stop` → `failed` with `terminalReason: failed-check`.
- [x] R4. With `workflow.decideDecisionMaker` off, `decide` degrades to its defaults (`standard`, `fix`). The graph then behaves exactly as today, apart from the deterministic `triage` hop and diffstat file.
- [x] R5. The `triage` route reason is appended to the existing `.spur/memory/task-pipeline-routes.log` line format.
- [x] R6. A candidate record `task-pipeline-triage-lanes` is added to `config/workflow-candidates.json`, with 0938 `baselineAgentRunCount` and a deadline 60 days out. The verdict cites per-task `agent.run` count and `retry-exhausted` share. If it does not win, it is reverted.

### Acceptance Criteria

- [x] AC1 — Task pipeline routes work by triage lane and failure class
- [x] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.178Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:27:33.224Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Triage produces `mode` for the existing fast-path edges.** It adds no new skip edge. It reuses the 0587/proportional routing and its route-reason log.
- **Deterministic checks run before the model.** Sensitive paths and diffs over 400 lines are decided without `decide`.
- **Failure class `retryable` still counts an attempt.** The loop stays bounded by the existing cap.
- **Estimate: 8h** (plus shadow-run time).

### Design

**Approach.** One deterministic state (`triage`) and one pre-fix decision.
- The diffstat producer is a plugin script, `plugins/sp/scripts/task-diffstat.ts` (standalone, `node:*`/`bun:*` only), with the sensitive-path list as an exported constant.
- The `triage` onEnter sequence is `shell` (diffstat), then `decide`, then `shell` (project `mode` from the result file via `jq`, honoring a caller-set mode and `sensitive`), then `file.read.into-var` (`mode`).
- The failure-class `decide` runs inside the `test`/`test-recheck` onEnter after the gate, and only when the status is FAIL, using a `when`-style shell pre-check that skips writing on PASS. Alternatively it runs in a `test-fail-triage` deterministic state if onEnter conditionals are unavailable. The implementer picks the one the engine supports and records it in Solution.

**Frozen names:**
- state `triage`;
- decide ids `task-triage`, `failure-class`;
- files `<wbs>-diffstat.json`, `<wbs>-triage.decision`, `<wbs>-failure-class.decision`;
- candidate id `task-pipeline-triage-lanes`;
- script `task-diffstat.ts`.

**Invariants:**
- The full gate is always green before `verify` or `review`.
- The approve pause is unchanged.
- A caller-set `mode` wins.
- Sensitive paths never take the fast lane.
- The attempt cap still bounds `retryable`.

**Rejected alternatives:**
- A parallel `task-pipeline2.yaml` (retired pattern).
- Model-only risk judgment.
- Adding a new skip edge beside the existing fast-path edges.

**Anti-patterns:**
- Asking `decide` whether the gate passed.
- Letting `stop` bypass the `failed` state.

**Targets:**
- Inline parity check green.
- Composition baseline updated.
- Guard-parity fixture updated (`packages/app/tests/workflow/fixtures/guard-parity-baseline.json`).

### Plan

1. `plugins/sp/scripts/task-diffstat.ts`, with `plugins/sp/tests/task-diffstat.test.ts` (temp git repo covering sensitive and large diffs).
2. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
3. `task-pipeline.yaml`: the `triage` state and edges, plus failure-class routing with a `terminalReason` on the new `failed` edge (0937). Then update the guard-parity and composition baselines, run `bun run --filter @gobing-ai/spur build:bundle`, and run `inline-pipeline-parity-check`.
4. Workflow tests for routing: fast, safety, caller-mode, sensitive, degraded-default, and each of retryable/fix/stop.
5. Shadow runs on real tasks, then a verdict from the 0938 report.
6. Run `bun run spur-check` and `bun run plugin-smoke`.

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
| `packages/app/tests/workflow/guard-parity.test.ts:91` |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:648` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:13` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:49` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:57` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:71` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:109` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:113` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:115` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:117` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:123` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:128` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:81` |
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
| `plugins/sp/tests/inline-pipeline-driver.test.ts:222` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `plugins/sp/tests/skill-structure.test.ts:799` |
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
| R1 | MET | State `triage` at config/workflows/task-pipeline.yaml:513; test PASS → triage (:931-933) and test-recheck PASS → triage (:964-966) replace the four former gate-PASS edges (frozen-contract test asserts they are gone); triage → verify guarded `mode = fast` (:992-997), triage → review `mode != fast` (:999-1005), fork exhaustive (triage-routing suite, 14 pass fresh) |
| R2 | MET | (a) shell producer writes `.spur/run/$wbs-diffstat.json` via task-diffstat.ts (numstat + untracked scan, yaml:531-533; untracked newline-count at task-diffstat.ts:115-125); (b) caller-set mode projected verbatim, pre-guard exits before decide (yaml:537-539; test :243); (c) pre-guard jq pins safety on sensitive \|\| insertions+deletions > 400 and the projection shell never consults the decide row when mode.txt is non-empty (yaml:538-539, :559-561; test :256 — sensitive beats decide-low; >400 test); (d) decide task-triage choice [low,standard,high] default standard, evidence diffstat+taskSpec, resultFile `<wbs>-triage.decision`, low → fast only (yaml:543-555, :559-561; frozen contract test :199) |
| R3 | MET | test-fail-triage state (yaml:572) reached from both red gates (:941, :974); decide failure-class choices [retryable,fix,stop] default fix, evidence `<wbs>-test-gate.findings`, resultFile `<wbs>-failure-class.decision` (yaml:584-595); stop → failed(failed-check) declared first (:1009-1017), cap → failed(retry-exhausted), retryable → test-recheck with attempt counter incremented on entry (:601, cap still bounds), fix → test-fix (:1044); missing/corrupt decision fails closed (:1046); dead `test → test-fix` FAIL edge deleted per delta review (yaml:948-955) |
| R4 | MET | runDecide disabled branch (packages/app/src/workflow/decide.ts:98) returns degraded default row (value=options.default → `standard`/`fix`); runner threads the flag (actions/decide.ts:93); harness stub pre-writes the exact runner row shape (task-pipeline-triage-routing.test.ts:118) and the R4 test (:278-287) asserts mode stays empty → standard review lane; with flag off triage is pure shell (no model call) |
| R5 | MET | Precheck writer and triage writer share the `<runId> <wbs> <reason>` line format into .spur/memory/task-pipeline-routes.log with the same `pipeline-$wbs` fallback (task-pipeline.yaml ~:227 vs :565) |
| R6 | MET | Candidate `task-pipeline-triage-lanes` in config/workflow-candidates.json:6-20 — canonical task-pipeline, deadline 2026-11-24, baselineAgentRunCount 0 (= 0938 agentRunCountMedian, cited in rationale), verdict null (spec'd pre-promotion state), ADR-076 revert clause; promotion check PASS; retry-exhausted/agent.run citation is post-merge via promotion evaluate as instructed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Task pipeline routes work by triage lane and failure class | MET | test | Live-YAML routing suite packages/app/tests/workflow/task-pipeline-triage-routing.test.ts — 14 pass / 0 fail (fresh re-run): lanes, caller-mode, sensitive, degraded-default, failure-class fix/retryable/stop/cap/missing-decision, frozen contracts; inline-pipeline-parity-check ok (12 actions / 4 guards / 10 workflows, worker report + review); YAML validates |
| AC2 — Workflow shape changes are accepted only on measured benefit | MET | command | config/workflow-candidates.json:6-20 — candidate with 0938 measured baseline (agentRunCountMedian 0), honest 'projected from 0938, NOT shadow-run-confirmed' status, deadline 2026-11-24, ADR-076 revert clause; promotion check PASS (4 candidates, all verdicts null — spec'd pre-promotion state; verdict citation post-merge via promotion evaluate) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Fresh-context review `2a5a8458` (sp-super-reviewer, report `.spur/run/review-0943.md`): **PASS** — no P1/P2; 3×P3 dispositioned below; P4s advisory. Bounded delta review `c1f8b296`: **PASS**, no new P1–P3; two P4 advisories accepted — (i) gitignored bundle twin `apps/cli/plugins/sp/scripts/task-diffstat.ts` stale until next `bundle-plugins` (consumed surfaces fresh, twins byte-identical), (ii) multi-space `' => '` rename split leaves space-padded halves (unreachable from real git output; probe failures fail safe). All work reviewed on diff vs base `34d3dd0de`.

| # | Pri | Finding (abridged) | Disposition |
| --- | --- | --- | --- |
| F1 | P3 | Rename rows bypass the sensitive classifier: `--numstat` renders renames as `old => new` / `head{old => new}tail`; anchored matchers missed a rename INTO a sensitive path (`src/x.ts => drizzle/schema.sql` → `sensitive:false`). | **FIXED** — `expandDiffPath()` (task-diffstat.ts:154-171) splits both rename forms before matching; regression test (rename-into-sensitive → `sensitive:true`, both halves listed); twins regenerated. Delta-reviewed. |
| F2 | P3 | Dead edge `test → test-fix` (FAIL guard) unreachable behind `test → test-fail-triage`'s identical guard; silent spec-bypass trap; proportional test asserted it under a now-false comment. | **FIXED** — edge deleted (comment documents why it must not return); corrupt-status always-defense retained (pre-0943 behavior); tests re-anchored: exactly 3 outgoing `test` edges, bypass asserted `undefined`, fix lane reachable only via `test-fail-triage → test-fix`; guard-parity baseline regenerated + biome-formatted. Delta-reviewed. |
| F3 | P3 | `decide task-triage` runs unconditionally on every triage entry incl. caller-set-mode and deterministic-high paths — R2(c) "No decide call is made" not literal; wasted model call + sensitive path lists reach the DecisionMaker as discarded evidence (flag ON only). | **ACCEPTED** — outcome-correct in every branch (projection shell exits before consulting the row when `mode.txt` is non-empty; flag-off default is pure shell). The engine has no onEnter conditionals — the spec's own sanctioned alternative is a separate state; remediation (two-state split: +1 state, +3 edges) re-opens routing/parity/smoke surfaces for a budget-only waste under an opt-in flag. Deferred to `task-pipeline-triage-lanes` candidate evaluation (deadline 2026-11-24). Precedent: 0945 F1 acceptance. |
| F4 | P4 | Triage R5 log writer lacks the RUN_ID safety filter its precheck sibling has; caller-set mode emitted verbatim (whitespace corrupts the 3-field line). | Accepted — transitively guarded (precheck hard-fails unsafe RUN_ID first). Hardening note rides the candidate evaluation. |
| F5 | P4 | Pre-guard comment overclaims "empty diffstat → safety"; empty `mode.txt` actually falls through to decide (safe only via degraded default standard). | Accepted — producer fail-safe (missing base/git failure → `sensitive:true`) makes the flag-ON fast-lane path near-impossible; comment accuracy + empty-pin option deferred with F3. |
| F6 | P4 | Caller-set `mode=fast` overrides the sensitive pin (R2b precedes R2c) — tensions the invariant wording. | Accepted — matches spec letter; precedence documented here: caller-set mode wins over the deterministic safety pin by design (R2b before R2c). |
| F7 | P4 | Candidate measurement plan pins agent.run savings + routes.log counts but not the retry-exhausted share R6 requires the verdict to cite. | Accepted — verdict is null pre-promotion; post-merge `promotion evaluate` (due 2026-11-24) must cite the retry-exhausted share (tracked in batch report). |
| F8 | P4 | Driver brief over-listed `lifecycle-drift.test.ts` as driver-gate-fixed; it has no diff vs base. | Note — record-accuracy only; suite green, no change was needed there (the `--spur-bin` invariant fix landed in task-diffstat.ts + YAML instead). |

#### Driver gate fixes (adjudicated by review — accepted)
1. env-var-hygiene: `process.env` → `getEnvVars()` funnel (3 test sites) per task-0902 precedent.
2. 0062 R2/0482 blanket invariant: diffstat YAML step passes `--spur-bin "$spurBin"`; `task-diffstat.main()` accepts-and-ignores the flag (shells only git), stray argv still usage-exit 2.
3. 0503: smoke harness lacked a `decide` handler → decision file never written → defense edge after one fix hop. Added stub (doctor.probe precedent) writing the degraded-default row `{schemaVersion:1, value:<default>, degraded:true, reason:'disabled'}` — the decisionMaker-off contract; graph then yields the expected two `test-fix` hops. Boundedness holds for all lanes (fix hops count in `test-fix` onEnter; retryable counts on entry).
4. R41/0182: `test → review` assertion re-anchored to `test → triage` (0943 R1 replaced the edge; green path still reaches review without a second full gate).

#### Residual risks (from review, post-disposition)
- Flag ON: wasted decide call per triage entry on caller-set/deterministic-high paths (F3, deferred).
- Flag ON + missing/corrupt diffstat + model `low` → fast without evidence; near-impossible via producer fail-safe (F5).
- Benefit is projected (0938 baseline), not shadow-run-confirmed; revert enforced by candidate deadline + post-merge `promotion evaluate` (shadow-run deferral declared in Solution).

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T20:28:28.737Z todo → wip (system)
- 2026-09-25T22:03:42.338Z wip → testing (system)
- 2026-09-25T22:04:07.961Z testing → done (system)

