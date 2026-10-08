---
schema_version: 1
name: "Close decision event contract gaps: input rejection ordering and full run correlation"
status: done
template: feature-impl
created_at: 2026-10-07T16:26:13.398Z
updated_at: "2026-10-08T16:17:05.230Z"
feature_id: P1

tags: ["decision"]
dependencies: ["1095"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1113-verdict.json
---

## 1113. Close decision event contract gaps: input rejection ordering and full run correlation

### Background

Filed from the 2026-10-07 P1 review of shipped tasks 1095–1099. The decision event contract (`docs/design/decision-observability-and-adoption.md` §3.1–§3.3, feature P1 R6–R8) has four gaps in the shipped code. Tasks 1100 (decision log), 1094 (catalog decide) and the reliability report all build on this seam, so the gaps are closed first.

1. **Input errors fire after `decision.start`.** `DecisionService.decide` (`packages/app/src/decision/decision-service.ts`) opens the lifecycle before `hub.decide`, and the hub validates parameters inside `decide` (`resolveDecisionInput`, ts-ai-decision 0.5.16 `dist/hub.js:146`), throwing `DecisionInputError`. A bad parameter from the workflow or gate path therefore emits `decision.start` → `decision.end{reason:error}` with no terminal event and no `decision.rejected`. That breaks R6 ("no decision.start for a caller mistake") and the fixed order of §3.1. The CLI is safe only because `parseParams` pre-validates.
2. **Any other hub throw skips the terminal event.** The service `finally` emits `end` with `durationMs: 0` but no `decision.failure`, so the order `start → (success|failure) → end` breaks.
3. **Correlation is partial.** R7 requires run id, workflow name, node id and WBS. The workflow decide action (`packages/app/src/workflow/actions/decide.ts`) and the gate path (`packages/app/src/workflow/decision-hitl-responder.ts:463-469`) pass only `runId` and `nodeId`.
4. **Shell rescues lose the run entirely.** The idea-pipeline and history-anatomy rescues (tasks 1097, 1098) call `"$spurBin" decision run …` from a shell action (`config/workflows/idea-pipeline.yaml:159,171`, `config/workflows/history-anatomy.yaml:270`). The CLI always emits `caller: 'cli'` with no correlation, so those decisions never reach `workflow trace <runId>` or a run filter (R7, R8). The shell action already exports workflow vars as env (`packages/app/src/workflow/actions/shell.ts:99-106`, `$__runId`), so the CLI can adopt the run without a new flag.

Also: the gate path passes its evidence as input key `evidence`, but the service digests only `input.instructions`, so gate events carry no `evidenceDigest`.

**Refine corrections (2026-10-07)**

- Claim "any other hub throw skips the terminal event" (gap 2) → `hub.decide` catches every resolve/ask failure and returns a fallback (ts-ai-decision 0.5.16 `dist/hub.js:162-205`), and catalog load already rejects bad template refs (`dist/catalog.js:186`). After R1, the only post-start throw is an unexpected one. → R2 stays as a backstop, not a known live path.
- Claim "workflow name from the run context" (R3) → not reachable. `ActionRunContext` (ts-dual-workflow-engine 0.5.11 `dist/types.d.ts:149`) has `runId`, `stateOrNodeId` and `vars`. `HitlRequest` (`dist/hitl.d.ts:4`) has `runId` and `node`. No run var carries the name. → R3 injects a `__workflowName` run var on the `__runId` seam (`packages/app/src/services/workflow-service.ts:802`), and the gate reads the run row.
- Claim "`wbs` from the run's `wbs` var" → `task-pipeline.yaml` declares the placeholder default `wbs: "0000"`. → `0000` and empty values count as absent.
- Q&A deferral "node id and workflow name are not exported to shell env" → feature R7 requires all four keys. Both are cheap to export: `__workflowName` arrives through the run var, and `shell.ts` adds `__nodeId`. → Deferral reversed (R4).
- R4 named only the `service.decide` call → the CLI also emits three pre-decide rejections (`apps/cli/src/commands/decision.ts:151,175,183`) with a hard-coded `caller: 'cli'`. → All four sites use one env-derived context.
- CLI `parseParams` throws plain `Error` (`decision.ts`, `invalid --param` and others) → `errorKind` would be `error`, not `input`. → It now throws `DecisionInputError`.
- Out of scope: the inline-run driver (`runDecideForInlineRun`, `packages/app/src/services/inline-run-setup.ts:864`) emits no decision events today. Task 1094 R8 owns inline parity.

- Correction to the "Out of scope" line above, which was wrong. The inline-run driver **does** emit decision events. `runInlineRunDecide` (`packages/app/src/services/inline-run-setup.ts:1538`) taps a local bus into `system_events` and runs `DecideActionRunner` through `runDecideForInlineRun` with `vars: {}` (`:887`), so its events carry only `runId` and `nodeId`. Inline runs persist a `workflow_runs` row with `workflow_name` (`:794-806`), so the same lookup the gate uses applies. → R3 covers the inline driver.

### Requirements

- [x] R1. `DecisionService.decide` validates the input before `decision.start` by calling `resolveDecisionInput(definition, input)` from `@gobing-ai/ts-ai-decision`. `definition` is `file.catalog.decisions[id]`, the parsed catalog entry, which already carries the implicit `instructions` parameter (`dist/catalog.js:224`). A `DecisionInputError` emits one `decision.rejected` with the new `errorKind: 'input'` (extend `decisionErrorKind`, `packages/app/src/decision/decision-events.ts:97`) and no `start`, then rethrows the same error. CLI `parseParams` throws `DecisionInputError(message, id, key)` in place of plain `Error`, so CLI parse failures also report `input`.
- [x] R2. Backstop: if `hub.decide` throws after `start`, the service emits `decision.failure` before `decision.end`, then rethrows. The failure carries reason `error`, a redacted and bounded `error` message, and `fallbackValue` = `description.fallback`. The order stays `start → failure → end`. Today's `finally` that emits only `end` goes away.
- [x] R3. Engine runs carry a `__workflowName` run var, injected next to `__runId` in `workflow-service.ts:802`. The resume path restores it from the effective-vars snapshot, as it does `__runId`. The workflow decide action (`packages/app/src/workflow/actions/decide.ts:118`) passes `workflowName` from `context.vars.__workflowName` and `wbs` from `context.vars.wbs` in `correlation`. The evidence-mode gate (`packages/app/src/workflow/decision-hitl-responder.ts:467`) gets both through a new optional evaluator dep, `runCorrelation(runId)`, wired in `buildDecisionEvaluator` (`workflow-service.ts:2117`). It reads `workflow_name` from `loadRun(runId)` and `wbs` from `loadLatestStateSnapshot(runId).data.effectiveVars`. The lookup is the shared helper `loadRunCorrelation(persistence, runId)` (new, `packages/app/src/workflow/run-correlation.ts`). The inline-run driver (`runDecideForInlineRun`, `packages/app/src/services/inline-run-setup.ts:864`) uses the same helper against the project DB it already opens (`:1545`) and passes the result as `vars: { __workflowName, wbs }` in place of `vars: {}`. If the lookup fails, the fields are left out. A `wbs` is passed only when it matches `^\d{4}$` and is not `0000`. Absent values stay absent; nothing is inferred.
- [x] R4. `spur decision run` adopts the calling run when the `__runId` env var is non-empty. The shell action exports workflow vars as env (`packages/app/src/workflow/actions/shell.ts:106`), and `shell.ts` now also sets `__nodeId` = `context.stateOrNodeId`. Every event the command emits, the three pre-decide rejections and the served lifecycle alike, then carries `caller: 'workflow'` and `correlation` `{ runId, workflowName?, nodeId?, wbs? }`, built from `__runId`, `__workflowName`, `__nodeId` and `wbs` under the R3 `wbs` rule. Without `__runId`, behavior is unchanged: `caller: 'cli'` and no correlation. No new flag, verb or noun.
- [x] R5. The service digests the evidence-bearing input consistently: `instructions` when it is a non-empty string, else a string `evidence` input. Gate events then carry `evidenceDigest`.
- [x] R6. Update design §3.1–§3.3 (`docs/design/decision-observability-and-adoption.md`) for `errorKind: 'input'`, the `__workflowName`/`__nodeId` sources and the env-adopted correlation of R4.

**Out of scope:** decision log rows (task 1100); any change to the reliability report query.

### Acceptance Criteria

- [x] AC1 — A caller mistake emits decision.rejected before any maker call
- [x] AC2 — Decision event payloads stay metadata-only and carry run correlation
- [x] AC3 — Decision events persist to the system event ledger

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:26:49.157Z

- Env adoption (R4) over a new `--run-id` flag: the shell action already exports workflow vars, the idea-handoff CLI reads `__runId` the same way (`packages/app/src/workflow/idea-handoff-cli.ts:45`), and a flag would be a public-surface change needing consent.
- Rejected: rewriting the rescue steps as in-process `kind: decide` actions. That needs task 1094's catalog decide and would break the 1098 placement scan (`apps/cli/tests/workflow-decision-scan.test.ts` forbids `kind: decide` in history-anatomy) for no gain over R4.
- Node id and workflow name are not exported to shell env today. R4 carries only what the env has; extending shell env exports is deferred until a report needs per-node rescue joins.
- Pre-validation (R1) runs the same upstream function the hub runs, so the two cannot disagree; the hub's own check stays as a backstop.

### Design

**What.** Make every decision producer follow the §3.1 lifecycle exactly and carry full run correlation, with no new public surface.

**Where (frozen names).**

| Seam | Change |
| --- | --- |
| `packages/app/src/decision/decision-events.ts` | `decisionErrorKind` returns `'input'` for `DecisionInputError`. The union becomes `'catalog' \| 'error' \| 'input' \| 'unknown-decision' \| 'unknown-decision-maker'`. |
| `packages/app/src/decision/decision-service.ts` `decide` | After the maker check and before `beginDecisionInvocation`: `resolveDecisionInput(file.catalog.decisions[id], input ?? {})` in a try that emits `emitDecisionRejected` and rethrows. Replace the bare `finally` with `catch` (emit `fail{reason:'error', error: redactAndBound(msg, [], 512), fallbackValue: description.fallback, confidence: null, maker: name}`, then rethrow) plus `finally` (`end`). The digest source is `instructions` when it is a non-empty string, else `evidence` when it is a string. |
| `packages/app/src/services/workflow-service.ts:802` | Add `__workflowName: workflow.name` next to `__runId`. |
| `packages/app/src/workflow/actions/shell.ts:106` | `env.__nodeId = context.stateOrNodeId` (shell env only, not a run var). |
| `packages/app/src/workflow/actions/decide.ts:118` | `correlation: { runId, nodeId, ...workflowName, ...wbs }` built with the shared helper below. |
| `packages/app/src/decision/decision-events.ts` | New exported helper `decisionCorrelationFromVars(vars: Record<string,string\|undefined>): DecisionCorrelation \| undefined`. It reads `__runId`, `__workflowName`, `__nodeId` and `wbs`, applies the `wbs` rule, and returns `undefined` when `__runId` is empty. The CLI uses it on `getEnvVars()`. The decide action uses it on `{...context.vars, __nodeId: context.stateOrNodeId}`, with `runId` taken from `context.runId`. |
| `packages/app/src/workflow/run-correlation.ts` (new) | `loadRunCorrelation(persistence: Pick<WorkflowPersistence,'loadRun'\|'loadLatestStateSnapshot'>, runId): Promise<{ workflowName?: string; wbs?: string }>`. It never throws: a failure returns `{}`. It applies the `wbs` rule. The gate dep and the inline driver both call it. |
| `packages/app/src/services/inline-run-setup.ts:864,:1538` | `InlineDecideInput.correlationVars?`; `runInlineRunDecide` fills it from `loadRunCorrelation` on the opened project DB. |
| `packages/app/src/workflow/decision-hitl-responder.ts` | Optional dep `runCorrelation?: (runId: string) => Promise<{ workflowName?: string; wbs?: string }>`, merged into the gate `correlation`. A throw is swallowed. |
| `apps/cli/src/commands/decision.ts` | One `callContext` = `correlation ? { caller: 'workflow', correlation } : { caller: 'cli' }`, used at all four emit sites. `parseParams` throws `DecisionInputError`. |

**Why.** Reports join on `invocationId` and filter by run (feature R7, R8). An input error that opens a lifecycle counts as a maker failure in `--reliability` and skews the evidence the adoption slices (1114–1116) gate on.

**Invariants.** `resolveDecisionInput` is the same upstream function the hub runs, so pre-validation cannot disagree with the hub. The hub check stays as the backstop. Event emission stays best-effort (§5). The CLI result envelope and exit codes are unchanged.

**Anti-patterns.** Do not add a `--run-id` flag (public surface). Do not infer `wbs` from file names or the task corpus. Do not rewrite the rescue steps as `kind: decide`: the 1098 placement scan forbids it in history-anatomy. Do not read `process.env` directly; use `getEnvVars()` (env-var-hygiene rule).

**Handoff.** Task 1100 reuses `errorKind: 'input'` and the correlation fields for `decision_logs` columns. Task 1094's catalog-form runner passes the same `decisionCorrelationFromVars` correlation. Tasks 1114–1116 rely on accurate `--reliability` counts.

### Plan

1. Write the failure list first:
   - A gate call with a missing required parameter emits `decision.start`.
   - A CLI `--param` type error reports `errorKind: 'error'` (should be `input`).
   - A hub throw yields `start → end` without `failure`.
   - A workflow decide event lacks `workflowName` or `wbs` even though the run has them.
   - A `wbs` of `0000` leaks into correlation.
   - A rescue `decision run` under a workflow persists with `run_id` null in `system_events`.
   - A `decision run` outside a workflow gains a correlation.
   - A gate event lacks `evidenceDigest`.
2. Events: add `errorKind: 'input'` and the `decisionCorrelationFromVars` helper (R1, R3, R4).
3. Service: pre-validate, failure-before-end on throw, digest selection (R1, R2, R5).
4. Run vars and shell env: `__workflowName` in `workflow-service.ts:802`, `__nodeId` in `shell.ts` (R3, R4).
5. Decide action correlation; `loadRunCorrelation`; the gate `runCorrelation` dep wired in `buildDecisionEvaluator`; the inline driver `correlationVars` (R3). Then regenerate the plugin bundle (`bun run --filter @gobing-ai/spur build:bundle`) and run `bun run plugin-smoke`.
6. CLI `decision run`: one env-derived `callContext` at all four emit sites; `parseParams` throws `DecisionInputError` (R1, R4).
7. Tests:
   - `packages/app/tests/decision/decision-events.test.ts` and the service tests use a real `EventBus` and recorded emits.
   - The CLI decision tests set env through `getEnvVar`/`setEnvVar` (env-var-hygiene rule).
   - The ledger test uses `registerSystemEventTap` with an in-memory `SystemEventDao` and asserts `run_id`.
8. E2E: run the history-anatomy rescue shell command with `__runId=<id>`, `__workflowName=history-anatomy` and `__nodeId=<node>` exported against the project DB. Then check that `spur workflow trace <runId> --json` lists the `decision.*` events with full correlation. Save the trace and the matching `system_events` rows to `.spur/run/1113-correlation.json`.
9. Design §3.1–§3.3 update (R6), then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/decision.ts:148` |
| `apps/cli/src/commands/decision.ts:15` |
| `apps/cli/src/commands/decision.ts:161` |
| `apps/cli/src/commands/decision.ts:185` |
| `apps/cli/src/commands/decision.ts:193` |
| `apps/cli/src/commands/decision.ts:199` |
| `apps/cli/src/commands/decision.ts:329` |
| `apps/cli/src/commands/decision.ts:334` |
| `apps/cli/src/commands/decision.ts:336` |
| `apps/cli/src/commands/decision.ts:343` |
| `apps/cli/src/commands/decision.ts:350` |
| `apps/cli/src/commands/decision.ts:357` |
| `apps/cli/src/commands/decision.ts:5` |
| `apps/cli/src/commands/decision.ts:7` |
| `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:139` |
| `apps/cli/tests/workflow/idea-pipeline-rescue.test.ts:173` |
| `docs/design/decision-observability-and-adoption.md:116` |
| `docs/design/decision-observability-and-adoption.md:119` |
| `docs/design/decision-observability-and-adoption.md:123` |
| `docs/design/decision-observability-and-adoption.md:58` |
| `docs/design/decision-observability-and-adoption.md:68` |
| `packages/app/src/decision/decision-events.ts:103` |
| `packages/app/src/decision/decision-events.ts:107` |
| `packages/app/src/decision/decision-events.ts:115` |
| `packages/app/src/decision/decision-events.ts:16` |
| `packages/app/src/decision/decision-events.ts:24` |
| `packages/app/src/decision/decision-service.ts:10` |
| `packages/app/src/decision/decision-service.ts:14` |
| `packages/app/src/decision/decision-service.ts:231` |
| `packages/app/src/decision/decision-service.ts:255` |
| `packages/app/src/decision/decision-service.ts:277` |
| `packages/app/src/decision/decision-service.ts:388` |
| `packages/app/src/index.ts:10` |
| `packages/app/src/index.ts:26` |
| `packages/app/src/services/inline-run-setup.ts:1578` |
| `packages/app/src/services/inline-run-setup.ts:72` |
| `packages/app/src/services/inline-run-setup.ts:840` |
| `packages/app/src/services/inline-run-setup.ts:894` |
| `packages/app/src/services/workflow-service.ts:2185` |
| `packages/app/src/services/workflow-service.ts:77` |
| `packages/app/src/services/workflow-service.ts:804` |
| `packages/app/src/workflow/actions/decide.ts:118` |
| `packages/app/src/workflow/actions/decide.ts:6` |
| `packages/app/src/workflow/actions/shell.ts:107` |
| `packages/app/src/workflow/decision-hitl-responder.ts:473` |
| `packages/app/src/workflow/decision-hitl-responder.ts:79` |
| `packages/app/tests/decision/decision-events.test.ts:12` |
| `packages/app/tests/decision/decision-events.test.ts:15` |
| `packages/app/tests/decision/decision-events.test.ts:2` |
| `packages/app/tests/decision/decision-events.test.ts:328` |
| `plugins/sp/lib/inline-run.generated.mjs:1722` |
| `plugins/sp/lib/inline-run.generated.mjs:1727` |
| `plugins/sp/lib/inline-run.generated.mjs:1743` |
| `packages/app/src/workflow/run-correlation.ts:1` |
| `packages/app/tests/workflow/run-correlation.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | input validated before decision.start via resolveDecisionInput `packages/app/src/decision/decision-service.ts:282-287`, then beginDecisionInvocation `packages/app/src/decision/decision-service.ts:292`; DecisionInputError maps to errorKind input `packages/app/src/decision/decision-events.ts:110`; CLI parseParams throws DecisionInputError `apps/cli/src/commands/decision.ts:342`; tests `packages/app/tests/decision/decision-events.test.ts:329` and `packages/app/tests/decision/decision-events.test.ts:440` |
| R2 | MET | post-start hub throw emits failure (reason error, redacted error, fallbackValue description.fallback) before end `packages/app/src/decision/decision-service.ts:347-357`, end in finally `packages/app/src/decision/decision-service.ts:358-371`; test `packages/app/tests/decision/decision-events.test.ts:344` |
| R3 | MET | __workflowName injected next to __runId `packages/app/src/services/workflow-service.ts:842-846` (engine snapshot carries it on resume; injection site static-verified, no dedicated engine test); decide action correlation from run vars `packages/app/src/workflow/actions/decide.ts:158-169`; shared helper loadRunCorrelation `packages/app/src/workflow/run-correlation.ts:29-45`; gate dep runCorrelation `packages/app/src/workflow/decision-hitl-responder.ts:505-510` wired `packages/app/src/services/workflow-service.ts:2245-2246`; inline driver `packages/app/src/services/inline-run-setup.ts:1604-1608`; tests `packages/app/tests/workflow/run-correlation.test.ts:22`, `packages/app/tests/workflow/run-correlation.test.ts:31`, `packages/app/tests/workflow/run-correlation.test.ts:55` |
| R4 | MET | shell action exports __nodeId `packages/app/src/workflow/actions/shell.ts:107-109`; CLI adopts the calling run from env `apps/cli/src/commands/decision.ts:150-154`; producer test `packages/app/tests/decision/decision-events.test.ts:421` and no-__runId case `packages/app/tests/decision/decision-events.test.ts:432` |
| R5 | MET | evidenceDigest from instructions else string evidence `packages/app/src/decision/decision-service.ts:291-306`; test `packages/app/tests/decision/decision-events.test.ts:369` |
| R6 | MET | design §3.1 input rejection `docs/design/decision-observability-and-adoption.md:70`, correlation sources `docs/design/decision-observability-and-adoption.md:74-82`, §3.3 flow `docs/design/decision-observability-and-adoption.md:116` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A caller mistake emits decision.rejected before any maker call | MET | test | input rejection without start `packages/app/tests/decision/decision-events.test.ts:329`; fresh 2026-10-08 run 1266 pass / 0 fail |
| AC2 — Decision event payloads stay metadata-only and carry run correlation | MET | test | correlation producers `packages/app/tests/decision/decision-events.test.ts:421`; ledger projection keeps correlation `packages/app/tests/decision/decision-events.test.ts:479`; run-correlation helper `packages/app/tests/workflow/run-correlation.test.ts:31` |
| AC3 — Decision events persist to the system event ledger | MET | test | rejected errorKind persisted `packages/app/tests/decision/decision-events.test.ts:518`; lifecycle rows persisted `packages/app/tests/decision/decision-events.test.ts:479` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:37.656Z backlog → todo (system)
- 2026-10-07T18:32:31.160Z todo → wip (system)
- 2026-10-07T19:58:36.654Z wip → testing (system)
- 2026-10-07T20:00:49.259Z testing → done (system)

