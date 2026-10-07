---
schema_version: 1
name: "Close decision event contract gaps: input rejection ordering and full run correlation"
status: todo
template: feature-impl
created_at: 2026-10-07T16:26:13.398Z
updated_at: "2026-10-07T16:29:37.656Z"
feature_id: P1

tags: ["decision"]
dependencies: ["1095"]
---

## 1113. Close decision event contract gaps: input rejection ordering and full run correlation

### Background

Filed from the 2026-10-07 P1 review of shipped tasks 1095–1099. The decision event contract (`docs/design/decision-observability-and-adoption.md` §3.1–§3.3, feature P1 R6–R8) has four gaps in the shipped code. Tasks 1100 (decision log), 1094 (catalog decide) and the reliability report all build on this seam, so the gaps are closed first.

1. **Input errors fire after `decision.start`.** `DecisionService.decide` (`packages/app/src/decision/decision-service.ts`) opens the lifecycle before `hub.decide`, and the hub validates parameters inside `decide` (`resolveDecisionInput`, ts-ai-decision 0.5.16 `dist/hub.js:146`), throwing `DecisionInputError`. A bad parameter from the workflow or gate path therefore emits `decision.start` → `decision.end{reason:error}` with no terminal event and no `decision.rejected`. That breaks R6 ("no decision.start for a caller mistake") and the fixed order of §3.1. The CLI is safe only because `parseParams` pre-validates.
2. **Any other hub throw skips the terminal event.** The service `finally` emits `end` with `durationMs: 0` but no `decision.failure`, so the order `start → (success|failure) → end` breaks.
3. **Correlation is partial.** R7 requires run id, workflow name, node id and WBS. The workflow decide action (`packages/app/src/workflow/actions/decide.ts`) and the gate path (`packages/app/src/workflow/decision-hitl-responder.ts:463-469`) pass only `runId` and `nodeId`.
4. **Shell rescues lose the run entirely.** The idea-pipeline and history-anatomy rescues (tasks 1097, 1098) call `"$spurBin" decision run …` from a shell action (`config/workflows/idea-pipeline.yaml:159,171`, `config/workflows/history-anatomy.yaml:270`). The CLI always emits `caller: 'cli'` with no correlation, so those decisions never reach `workflow trace <runId>` or a run filter (R7, R8). The shell action already exports workflow vars as env (`packages/app/src/workflow/actions/shell.ts:99-106`, `$__runId`), so the CLI can adopt the run without a new flag.

Also: the gate path passes its evidence as input key `evidence`, but the service digests only `input.instructions`, so gate events carry no `evidenceDigest`.

### Requirements

- [ ] R1. `DecisionService.decide` validates the input against the decision's parameters before `decision.start`, using the exported `resolveDecisionInput` from `@gobing-ai/ts-ai-decision`. A `DecisionInputError` emits one `decision.rejected` with a new `errorKind: 'input'` (extend `decisionErrorKind`, `packages/app/src/decision/decision-events.ts`) and no `start`, then rethrows the same error.
- [ ] R2. If `hub.decide` throws after `start` for any other reason, the service emits `decision.failure` (reason `error`, redacted bounded `error`, the catalog fallback as `fallbackValue`) before `decision.end`, then rethrows. Order stays `start → failure → end`.
- [ ] R3. The workflow decide action and the evidence-mode gate pass `workflowName` and `wbs` in `correlation` when the run has them (workflow name from the run context, `wbs` from the run's `wbs` var). Absent values stay absent; nothing is inferred.
- [ ] R4. `spur decision run` adopts the calling run when invoked from a workflow shell action: when the `__runId` env var is set (exported by the shell action), events carry `caller: 'workflow'` and `correlation.runId`, plus `wbs` when the `wbs` env var is set. Without `__runId`, behavior is unchanged (`caller: 'cli'`, no correlation). No new flag, verb or noun.
- [ ] R5. The service digests the evidence-bearing input consistently: `instructions` when present, else a string `evidence` input. Gate events then carry `evidenceDigest`.
- [ ] R6. Update design §3.1–§3.3 for `errorKind: 'input'` and the env-adopted correlation of R4.

### Acceptance Criteria

- [ ] AC1 — A caller mistake emits decision.rejected before any maker call
- [ ] AC2 — Decision event payloads stay metadata-only and carry run correlation
- [ ] AC3 — Decision events persist to the system event ledger

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

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

1. Failure list first:
   - A gate call with a missing required parameter emits `decision.start`.
   - A hub throw yields `start → end` without `failure`.
   - A workflow decide event lacks `workflowName` or `wbs` although the run has them.
   - A rescue `decision run` under a workflow persists with `run_id` null in `system_events`.
   - `decision run` outside a workflow gains a correlation.
   - A gate event lacks `evidenceDigest`.
2. Service: pre-validate, `input` error kind, failure-before-end on throw, digest selection.
3. Workflow decide action and gate responder: full correlation.
4. CLI `decision run`: env adoption.
5. Tests in `packages/app/tests/decision/decision-events.test.ts` and the CLI decision tests, using the config gateway (`getEnvVar`/`setEnvVar`) for env, per the env-var-hygiene rule.
6. E2E: run `spur workflow run history-anatomy` far enough to hit the rescue (or invoke the rescue shell command with `__runId=<id>` exported), then `spur workflow trace <runId>` lists the `decision.*` events. Save `.spur/run/1113-correlation.json`.
7. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:37.656Z backlog → todo (system)

