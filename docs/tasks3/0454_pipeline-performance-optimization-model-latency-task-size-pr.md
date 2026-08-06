---
template: meta
schema_version: 1
name: "Pipeline performance optimization: model latency, task size precheck, progress visibility"
description: ""
status: todo
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-06T10:54:14.344Z"
updated_at: "2026-08-06T20:50:08.626Z"
---

## 0454. Pipeline performance optimization: model latency, task size precheck, progress visibility

### Background
The 0452 residual-cleanup pipeline run took ~75 minutes — far above a healthy implement budget. Forensic analysis of the OMP implement agent session (28.4 min wall, 69 turns, 85 tool calls) plus a ~30 min inline resume identified four causes:

| ID | Symptom | Root cause |
|----|---------|------------|
| S0 | Implement wall-time 28+ min | Provider TTFB degraded 4–12s → 30–55s after ~5 min sustained use (`volc` / deepseek-v4-flash) |
| S1 | Pipeline hit `implementTimeoutMs` (30 min) | Task 0452 had **9** R-items across **~12** files — too large for one implement hop |
| S2 | Operator blind while waiting | `spur workflow trace --follow` / run-log showed little mid-hop progress; 600s follow windows needed reconnect |
| S3 | Expensive resume | Partial-work artifact lacked which R# were done; resume re-derived scope and thrash-reverted |

**Quota context (operator session 2026-08-06):** executors `omp-zai`, `codex-luna`, `omp-zai-ollama` hit API limits; only the slow volc path remained. Model latency is largely **external**; the in-repo levers that prevent cascade waste are **size precheck**, **progress observability**, and **richer partial handoff**.

**Authority:** task-pipeline implement/precheck (`config/workflows/task-pipeline.yaml`), stage `implement` model_policy (`packages/domain/src/stage-registry/schema.ts`), `AgentRunActionRunner` + `writePartialWorkArtifact` (`packages/app/src/workflow/actions/agent-run.ts`), run-log sink (`packages/app/src/observability/workflow-run-log-sink.ts`), CLI `spur workflow trace --follow` (`apps/cli/src/commands/workflow.ts`).

**Non-goals (do not implement in this task):** live TTFB measurement / automatic model failover mid-hop; changing provider credentials; full implement-agent protocol rewrite; cancelling held tasks; expanding `implementTimeoutMs` as the sole “fix”.
### Requirements
**P1 — prevent timeout cascade**

- [ ] **R1. Document + wire implement executor override (no fake TTFB SLA).**

  **Issue.** Pipeline implement uses `${vars.agent}` (default `omp` → dogfood executor). There is no **implement-only** override, so operators cannot pin a faster executor for implement without retargeting every agent.run hop. Guaranteeing TTFB &lt;5s is **not** a code property (provider-side).

  **Acceptance**
  - Pipeline declares var `implementAgent` (default: same as `agent`) and the **implement** `agent.run` uses `${vars.implementAgent}` while other hops keep `${vars.agent}`.
  - Docs (task Solution + DESIGN one-liner or AGENTS pipeline note) state: pin via `--vars '{"implementAgent":"<executor>"}'`; stage `implement` remains `min_tier: standard` with existing escalation; **no** in-process TTFB probe.
  - Unit/integration: pipeline YAML / schema still validates; a test or dry-run assertion that implement step input still points at `/sp:dev-run --mode implement`.

  **Primary files:** `config/workflows/task-pipeline.yaml` (+ `.spur/` and `apps/cli/config/` copies), optional `docs/04_DESIGN.md` / help one-liner.

- [ ] **R2. Deterministic task-size precheck before implement.**

  **Issue.** Oversized tasks (R-count / plan breadth) burn a full `implementTimeoutMs` then force resume. Precheck today is doctor + `spur task check` only.

  **Acceptance**
  - New precheck shell (soft status file pattern like doctor) after doctor, before implement guard.
  - Counts **R-items** in `## Requirements` via `spur task show $wbs --json` content (lines matching `- [ ] **R` / `- [x] **R` or `**R{n}.**` / `- [ ] R{n}.` — freeze one regex in Design).
  - Pipeline vars: `maxImplementReqs` (default **`5`**), `maxImplementPlanItems` (default **`8`**, count `- [ ]` / `- [x]` under `## Plan`).
  - When either threshold is exceeded: write `.spur/run/$wbs-precheck-size.status=FAIL` and a one-line message suggesting decomposition **or** raising vars; precheck→implement guard requires size PASS (same hard fail as doctor).
  - Under `profile=auto`: **still hard-fail** (no silent proceed). Override: `--vars '{"maxImplementReqs":"12"}'`.
  - Unit test with fixture task bodies (≤5 reqs pass; 6 reqs fail). Prefer pure function in `packages/app` tested under `bun test`, called from a thin `bun` script or inlined shell that shells to spur — Design freezes which.

  **Primary files:** `config/workflows/task-pipeline.yaml` (+ copies); `packages/app/src/services/` new small helper **or** `plugins/sp/scripts/task-size-precheck.ts`; tests under `packages/app/tests/` or `plugins/sp`.

**P2 — operator visibility & resume**

- [ ] **R3. Mid-hop progress on the existing observability path (not raw console).**

  **Issue.** Long implement hops look stuck; `no-console-output` forbids `console.*` in app code. `workflow.agent` + run-log sink already exist.

  **Acceptance**
  - While `AgentRunActionRunner` awaits `runTraced`, emit a **heartbeat** on the observability bus at interval `progressIntervalMs` (default **30000**, optional constructor/options/config later — freeze default in Design).
  - Heartbeat is a structured event (prefer existing `workflow.agent` lifecycle shape or `workflow.action.output` with a clear `kind: 'progress'` / message prefix `agent.run progress:`) consumed by the run-log sink so `spur workflow trace <id> --follow --output` shows progress without tailing agent JSONL.
  - Unit test: fake timer / mock bus receives ≥1 heartbeat when execute is artificially delayed.
  - **Out of scope:** changing CLI default follow duration unless a one-line doc points operators at `--poll` / re-follow (optional docs-only).

  **Primary files:** `packages/app/src/workflow/actions/agent-run.ts`; tests `packages/app/tests/workflow/actions/agent-run.test.ts`; sink only if a new event type is required (`workflow-run-log-sink.ts`).

- [ ] **R4. Partial-work artifact: completed-requirements heuristic section.**

  **Issue.** `writePartialWorkArtifact` records invocation + git diff + stdout/stderr tails but not which R# finished, so resume re-scopes from scratch.

  **Acceptance**
  - On partial write, append section `## completed requirements (heuristic)` with:
    1. Plan checklist items currently `- [x]` (from task file when `vars.wbs` resolvable via `spur task path` / known tasks dir — Design freezes resolution), and/or
    2. R-ids mentioned in non-placeholder `## Solution` body.
  - If neither available: single line `unknown — Solution empty and Plan checkboxes open`.
  - Never invent MET status; label section **heuristic**.
  - Unit test: fixture task + mocked fs → artifact contains expected R lines; empty Solution → unknown line.
  - Does not mask `ok:false` (existing R9 swallow stays).

  **Primary files:** `packages/app/src/workflow/actions/agent-run.ts` (`writePartialWorkArtifact`); tests in `agent-run.test.ts`.

**Explicit non-goals**
- Automatic multi-model failover / TTFB SLOs in CI.
- Raising `implementTimeoutMs` alone as the fix.
- Requiring HITL confirm under `profile=auto` for oversized tasks (use var override instead).
- Parsing agent chat JSONL for “I finished R3” natural language (too brittle for v1).
### Acceptance Criteria
```gherkin
Feature: Pipeline performance — size precheck, implement agent override, progress, partial handoff

  @core
  Scenario: R1 — implement step honors implementAgent override
    Given task-pipeline.yaml declares vars.implementAgent defaulting to vars.agent
    When the implement agent.run step is inspected
    Then its agent option is ${vars.implementAgent}
    And other agent.run hops still use ${vars.agent}
    And no code path claims a hard TTFB&lt;5s guarantee

  @core
  Scenario: R2 — oversized task fails precheck size gate
    Given a fixture task with 6 R-items in Requirements
    And maxImplementReqs is 5 (pipeline default)
    When the size precheck runs
    Then it records FAIL for the size status file
    And precheck does not transition to implement under the default guard
    And the failure message mentions decomposition or raising maxImplementReqs

  @core
  Scenario: R2b — in-budget task passes size precheck
    Given a fixture task with ≤5 R-items and ≤8 Plan checklist items
    When the size precheck runs
    Then it records PASS and implement remains reachable after doctor + task check

  @core
  Scenario: R3 — agent.run emits progress heartbeats
    Given an agent.run hop that runs longer than progressIntervalMs (default 30s)
    When observability is subscribed
    Then at least one progress/heartbeat event is emitted on the workflow bus or run-log path
    And production code does not use raw console.* for that heartbeat

  @core
  Scenario: R4 — partial artifact lists completed requirements heuristic
    Given writePartialWorkArtifact runs after a failed implement
    And the task Plan has at least one [x] item or Solution mentions Rn
    When the partial markdown is read
    Then it contains heading "completed requirements"
    And lists those items or states unknown when none exist
```
### Q&A
**Q1: Why not require TTFB &lt;5s in AC?**  
Provider latency is external. Freezing an unenforceable SLA makes verify flaky. R1 freezes override plumbing; R2 prevents timeout cascade when the only model is slow.

**Q2: Why hard-fail oversized tasks under profile=auto?**  
Silent proceed re-creates the 0452 burn. Escape hatch is explicit `--vars` limit raise after operator acknowledgment.

**Q3: Why not `console` progress?**  
`no-console-output` project rule; progress must use observability → run log (`workflow.agent` / existing sink).

**Q4: Can completed requirements be exact?**  
Not without agent-written markers. v1 is heuristic from Plan `[x]` + Solution R# mentions, clearly labeled.

**Q5: feature_id?**  
Meta performance task; feature link optional (L4 advisory only). Prefer a future “pipeline ergonomics” feature if product wants ship tracking.

**Q6: Dependencies?**  
None. Builds on 0451/0452 agent-run/partial paths already on main/worktree.
### Design
## Approach

Ship **deterministic pipeline guards + observability** first (R2, R3, R4). Treat model choice (R1) as **operator override plumbing + docs**, not a runtime TTFB oracle. Prefer extending existing seams over new CLIs.

---

## R1 — `implementAgent` override

| Piece | Location | Change |
|-------|----------|--------|
| Pipeline var | `task-pipeline.yaml` `vars:` | Add `implementAgent: "${vars.agent}"` **or** literal default same as `agent` seed — freeze: **`implementAgent` defaults to empty and implement step uses `${vars.implementAgent}` when set else `${vars.agent}`** via shell-safe pattern **or** set `implementAgent: "omp"` same as agent and document override. **Chosen:** seed `implementAgent` with same default string as `agent` (`omp` in monorepo seed); implement `agent.run` uses `agent: ${vars.implementAgent}`; comment: override with `--vars '{"implementAgent":"omp-zai"}'`. |
| Copies | `.spur/workflows/`, `apps/cli/config/workflows/` | Keep basename in sync with `config/workflows/`. |
| Docs | `docs/04_DESIGN.md` workflow vars table or task References | One paragraph: implement-only pin; stage `implement` model_policy unchanged (`min_tier: standard`, fallback capable-1 on timeout/resource). |

**Anti-patterns**
- Do **not** add HTTP calls to probe provider TTFB.
- Do **not** change all hops to a “fast” model.
- Do **not** hardcode volc/deepseek in app TypeScript.

**Frozen names:** `vars.implementAgent`, stage id `implement`.

---

## R2 — Size precheck


```ts
// packages/app/src/services/task-size-precheck.ts (new)
export interface TaskSizeLimits {
  maxReqs: number;       // default 5
  maxPlanItems: number;  // default 8
}
export interface TaskSizeReport {
  reqCount: number;
  planItemCount: number;
  ok: boolean;
  reasons: string[]; // human lines when !ok
}
export function evaluateTaskSize(content: string, limits: TaskSizeLimits): TaskSizeReport
```

**Req count regex (freeze):** count lines matching  
`/^\s*-\s*\[[ xX]\]\s*(\*\*)?R\d+/m`  
(covers `- [ ] **R1.` and `- [x] R1.`).

**Plan item count:** under section body of `## Plan` / `### Plan` (task uses `### Plan`), count  
`/^\s*-\s*\[[ xX]\]/m`.


1. Soft shell after doctor reopen block:
   - Read limits from env/vars: `maxImplementReqs` (default 5), `maxImplementPlanItems` (default 8).
   - Run `bun plugins/sp/scripts/task-size-precheck.ts $wbs --spur-bin $spurBin` **or** `bun -e` calling exported evaluate after `spur task show` — **Chosen:** small script under `plugins/sp/scripts/task-size-precheck.ts` that shells `spur task show`, evaluates, writes `.spur/run/$wbs-precheck-size.status` (`PASS`|`FAIL`) and message to stderr; always exit 0 (soft), like doctor.
2. Extend precheck→implement guard:
   ```bash
   test "$(cat .spur/run/$wbs-precheck-doctor.status)" = PASS \
     && test "$(cat .spur/run/$wbs-precheck-size.status 2>/dev/null || echo PASS)" = PASS \
     && $spurBin task check $wbs
   ```
   Missing size file → treat as PASS only if we always write the file; **always write** PASS/FAIL.

**Anti-patterns**
- Do not use `git diff` “files outside corpus” at precheck (no implement yet) — that was a bad original wording.
- Do not HITL under auto; var override is the escape hatch.

**Frozen names:** `maxImplementReqs`, `maxImplementPlanItems`, `.spur/run/<wbs>-precheck-size.status`, `evaluateTaskSize`.

---

## R3 — Progress heartbeats

| Piece | Behavior |
|-------|----------|
| Where | `AgentRunActionRunner.execute` around the `runTraced` await |
| Interval | `progressIntervalMs = 30_000` constant (export for tests) |
| Mechanism | `setInterval` / abort-cleared timer; each tick `observabilityBus?.emit('workflow.agent', { type: 'output' \| existing progress-compatible shape, message: \`agent.run progress: ${agentLabel} elapsed=${ms}ms\` })` — **match existing `AgentExecutionEvent` fields** used by run-log sink (read `agent-execution.ts` before coding; do not invent a dead event type). |
| Clear | `clearInterval` in `finally` |
| Tests | Mock bus + delayed `runTraced`; advance timers; expect ≥1 emit |

**Anti-patterns**
- `console.log` / `console.warn` in packages/app (project rule).
- Changing default CLI follow timeout as the only fix (docs OK).

**Frozen names:** `progressIntervalMs` (or `AGENT_RUN_PROGRESS_INTERVAL_MS`), message prefix `agent.run progress:`.

---

## R4 — Partial completed-requirements section

Extend `writePartialWorkArtifact`:

1. If `context.vars.wbs` is a non-empty string, best-effort load task markdown:
   - Prefer `join(cwd, 'docs/tasks3')` scan is wrong — use multi-folder: call existing task path resolution if injectable; **v1 freeze:** try `spur`-free path via optional read of `context.vars.__taskPath` if set; else `createNodeFileSystem(cwd)` + search `docs/tasks*/*${wbs}*` (same pattern as other scripts) **or** pass content only when tests inject via reading a path from env. **Chosen for implementability:** pure helper `extractCompletedRequirementsHeuristic(taskMarkdown: string): string[]` + in `writePartialWorkArtifact`, if `vars.wbs` set, best-effort `readFile` using `TaskLocator`-style dirs from config defaults `['docs/tasks3','docs/tasks2','docs/tasks']` under cwd (no network).
2. Heuristic extractors:
   - Plan lines `- [x] ...`
   - Solution body matches `/\bR\d+\b/g` unique sorted
3. Append markdown section always when writing partial.

**Anti-patterns**
- Claiming AC MET from stdout natural language.
- Failing the action if task file missing.

**Frozen names:** section heading exactly `## completed requirements (heuristic)`.

---

## Touch map

| File | R# |
|------|----|
| `config/workflows/task-pipeline.yaml` (+ `.spur/`, `apps/cli/config/`) | R1, R2 |
| `packages/app/src/services/task-size-precheck.ts` (new) + tests | R2 |
| `plugins/sp/scripts/task-size-precheck.ts` (new thin CLI) | R2 |
| `packages/app/src/workflow/actions/agent-run.ts` + tests | R3, R4 |
| `docs/04_DESIGN.md` (short) | R1 optional |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Size precheck false fail on prose Requirements | Document regex; allow var override |
| Heartbeat noise | 30s default; single line |
| Heuristic wrong R# | Label heuristic; operator still reads git diff |
### Plan
- [ ] R2a: Implement `evaluateTaskSize` + unit tests (pass ≤5 reqs; fail 6; plan item cap).
- [ ] R2b: Add `plugins/sp/scripts/task-size-precheck.ts`; wire soft status file + guard into all task-pipeline copies; monorepo validate YAML.
- [ ] R1: Add `implementAgent` var; point implement `agent.run` at it; sync workflow copies; doc one-liner for `--vars` override.
- [ ] R3: Heartbeat interval in `AgentRunActionRunner` + bus emit; unit test with fake timers.
- [ ] R4: `extractCompletedRequirementsHeuristic` + partial artifact section; unit test fixtures.
- [ ] Gate: `bun test` on new/changed tests; `spur workflow validate` on task-pipeline; `bun run autofix && bun run spur-check` if code changed.
- [ ] Solution/Testing filled by implement/verify (not this refine).
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Incident: 0452 residual pipeline ~75m; implement timeout `implementTimeoutMs` 1800000
- Pipeline: `config/workflows/task-pipeline.yaml` (precheck, implement agent.run)
- Stage implement model_policy: `packages/domain/src/stage-registry/schema.ts` id `implement`
- Partial artifact: `packages/app/src/workflow/actions/agent-run.ts` `writePartialWorkArtifact`
- Observability: `packages/app/src/observability/agent-execution.ts`, `workflow-run-log-sink.ts`
- Follow CLI: `apps/cli/src/commands/workflow.ts` `followRunLog` / `followTrace`
- Prior tasks: 0451 (agent.run affinity), 0452 (residual cleanup / partial catch docs), 0453 (precheck reopen)
- Dogfood: operator session 2026-08-06 volc TTFB degradation
### History
- 2026-08-06T20:50:04.872Z backlog → todo (system)
