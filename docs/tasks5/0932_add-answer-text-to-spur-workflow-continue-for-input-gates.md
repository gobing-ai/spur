---
schema_version: 1
name: Add --answer-text to spur workflow continue for input gates
status: done
template: feature-impl
created_at: 2026-09-23T06:52:00.690Z
updated_at: "2026-09-24T20:01:08.593Z"
feature_id: H1

priority: P2
estimate_hours: 4
---

## 0932. Add --answer-text to spur workflow continue for input gates

### Background

Covers H1 R27 (CLI half) and R28. It is the engine and CLI prerequisite for Slice B (0933).

- The engine already has a free-text gate, input gate action (`actions/hitl-input.ts`) (`packages/app/src/workflow/actions/hitl-input.ts`). Its answer variable defaults to `__hitlInput` (`packages/app/src/services/workflow-service.ts:2009-2013`).
- A **headless** operator cannot answer it:
  - `spur workflow continue` takes only `--answer <yes|no|cancel>` (`apps/cli/src/commands/workflow.ts:1046-1049`, validated at `:1056-1068`).
  - A headless continue without `--answer` is refused (`:1069-1081`, 0901 R3).
  - `WorkflowService.continuePaused` accepts only `hitlAnswer?: 'yes'|'no'|'cancel'`, injected under `hitlVar ?? '__hitlAnswer'` (`workflow-service.ts:1146-1150`, `:1341-1343`). The injected var is never `__hitlInput`.
- Nothing checks that the answer flag matches the gate the run is actually paused on. `--answer yes` on an input gate silently writes the wrong var.

The operator granted public-surface consent for `--answer-text` on 2026-09-22.

Rubric: E1 D1 L1 C1 R1 = 5.

### Requirements

- [x] R1. Add `--answer-text <text>` to `spur workflow continue`. The value is injected into the pending input gate action (`actions/hitl-input.ts`) gate's answer var (the action's `options.var`, else `__hitlInput`) before guards re-evaluate. The text is stored verbatim, and an empty string is rejected.
- [x] R2. Gate-kind validation before any resume claim:
  - `--answer-text` requires a pending input gate action (`actions/hitl-input.ts`) gate;
  - `--answer` requires a pending confirm or select gate action gate;
  - passing both flags is rejected;
  - the answer var for `--answer` also comes from the gate's `options.var` (fixing the hard-coded `__hitlAnswer`).
  A mismatch fails with `VALIDATION_FAILED` (exit 2), naming the pending gate kind and state, and the run stays `paused` with no ownership claim or metadata change. A run paused with no gate action (for example `interrupted`) accepts neither answer flag and resumes as today.
- [x] R3. The headless guard (0901 R3) is satisfied by either `--answer` or `--answer-text`, and its message names both. `--async` validates first, then forwards `--answer-text` to the worker exactly like `--answer`.
- [x] R4. Surface sync:
  - governance ledger row;
  - `docs/design/cli-contracts.md:641` synopsis;
  - `plugins/sp/skills/spur-cli/references/workflows.md:113`, `:263`, `:319`.

### Acceptance Criteria

- [x] AC1 — R27 The operator's free-text answer resumes the paused step (req: R1, R3)
  Given a run paused at an input gate with a pending question
  When the operator runs spur workflow continue <run-id> --answer-text "<answer>"
  Then the answer is injected into the gate's input variable before guards re-evaluate
  And the escalating step is re-dispatched with the question and the answer in its input
  Verify in this task with a service test (`packages/app/tests/services/workflow-service.test.ts`): a fixture state machine with a `pause: true` state whose onEnter is input gate action (`actions/hitl-input.ts`) (default var, and a custom `var: answerX`) and a guard on `${vars.__hitlInput}`; `continuePaused(runId, {answerText})` routes on the text. Also a CLI test in `apps/cli/tests/commands/workflow.test.ts` covering headless `--json --answer-text` and `--async` forwarding. The re-dispatch clause is owned by 0933 and is verified there.

- [x] AC2 — R28 Answer flags are validated against the pending gate kind (req: R2, R4)
  Given a paused run
  When the operator passes --answer-text to a confirm gate, or --answer to an input gate, or both flags together
  Then the command fails with VALIDATION_FAILED naming the pending gate kind
  And the run stays paused and unchanged
  Verify with CLI tests for the three rejection cases, asserting exit 2, the error code, and an unchanged run row (`status`, `metadata_json`, no resume owner). Add a flag-parity/docs test that `--answer-text` appears in cli-contracts.md and spur-cli workflows.md.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T06:57:44.268Z

- **Flag shape (closed 2026-09-22, operator).** A separate `--answer-text <text>`, not an overloaded `--answer`. Overloading would turn the validated yes/no/cancel enum into an unvalidated string for confirm gates. Public-surface consent was granted in this planning session.
- **Where validation lives (closed).** In the app service, through a new read-only `WorkflowService.pendingGate(runId)`. The CLI calls it before both the sync and async paths, and `continuePaused` re-checks it defensively. Validation lives in the service rather than the CLI so the async worker and future callers share one rule.
- **File input (deferred).** `--answer-file` is not added; shell `"$(cat f)"` covers it. Add it only if answers exceed the argv limits in practice.

### Design

- **Service (`packages/app/src/services/workflow-service.ts`):**
  - Extract the per-state site walk used by `collectHitlDecisionViolations` (`:2015-2050`) into a small exported helper, `gateSitesForState(def, stateId): the existing action-site type[]`, and reuse it there. Do not copy it.
  - Add `async pendingGate(runId): Promise<{ stateId: string; kind: GateActionKind; answerVar: string } | null>` (`GateActionKind` = the three gate action kind strings in the answer-var defaults map):
    - load the run row (as `continuePaused` does at `:1170`) and resolve the definition the same way (reuse that code path; don't fork it);
    - take the paused state from `projectWorkflowProgress(runId, { db, projectRoot }).currentState` (`packages/app/src/workflow/progress-projection.ts:169`, `:248-250`);
    - return the first gate action site in that state, or `null`;
    - `answerVar` = `options.var` when it is a non-empty string, else the answer-var defaults map (`workflow-service.ts:2009`).
  - `continuePaused` opts: add `answerText?: string`. Keep `hitlVar` as an explicit override for tests. Before `svc.resumeRun`:
    - `gate = await this.pendingGate(runId)`;
    - validate against R2 and throw the typed `ValidationError` that every transport maps to `VALIDATION_FAILED` (same import and pattern as `packages/app/src/services/task-service.ts:1744`, task 0800 R4);
    - set `resumeVars[opts.hitlVar ?? gate.answerVar]` to the answer.
    - This must happen **before** the resume-ownership claim, so a rejected call mutates nothing.
- **CLI (`apps/cli/src/commands/workflow.ts` `continue`):**
  - add `.option('--answer-text <text>', 'Answer a pending input-gate action gate with free text (H1 R27)')`;
  - after the enum check: both flags present → `VALIDATION_FAILED`; empty text → `VALIDATION_FAILED`;
  - the headless guard (`:1072`) accepts either flag;
  - resolve `targetId` (existing logic), then `await svc.pendingGate(targetId)` and map a mismatch to `writeJsonError(..., 'VALIDATION_FAILED')` + exit 2. Run this before the TTY confirmation and before the `--async` spawn;
  - async: `if (answerText !== undefined) cmd.push('--answer-text', answerText)` next to `:1142`;
  - sync: pass `answerText` to `continuePaused`.
- **Docs:**
  - governance ledger row: new flag on an existing verb; consent 2026-09-22, H1 R27;
  - `cli-contracts.md:641`: add `[--answer <yes|no|cancel> | --answer-text <text>]`;
  - `workflows.md`: add the flag to the table row, the synopsis, and the gate pause/resume paragraph, with one line on gate-kind matching.
- **Invariants.**
  - Existing `--answer` behavior is unchanged for confirm and select gates. Its var now honors `options.var`, and every current YAML uses the default, so the result is identical.
  - An `interrupted` run with no gate still resumes.
  - No new dependency.
  - The answer text is never logged beyond the existing run-var persistence.
- **Budget.** About 4 h. Mutation policy: code.
- **Out of scope.** Pipeline YAML changes and the question-artifact contract (0933); `--answer-file`; the steering channel.

### Plan

1. Write failing service tests: `pendingGate` returns kind and var for confirm, input (default var) and input (custom var) fixtures; `continuePaused({answerText})` injects and routes; mismatch throws before claim (the run row is unchanged).
2. Extract `gateSitesForState`, then implement `pendingGate` and the `continuePaused` validation and injection. Run `cd packages/app && bun test tests/services/workflow-service.test.ts`.
3. Write failing CLI tests: headless `--answer-text`, both flags, a mismatch in each direction, empty text, and `--async` forwarding. Implement the CLI changes. Run `cd apps/cli && bun test tests/commands/workflow.test.ts`.
4. Update the governance ledger, cli-contracts, and spur-cli workflows.md. Run `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:1055` |
| `apps/cli/src/commands/workflow.ts:1081` |
| `apps/cli/src/commands/workflow.ts:1113` |
| `apps/cli/src/commands/workflow.ts:1117` |
| `apps/cli/src/commands/workflow.ts:1169` |
| `apps/cli/src/commands/workflow.ts:1204` |
| `apps/cli/src/commands/workflow.ts:1264` |
| `apps/cli/tests/commands/workflow.test.ts:2764` |
| `apps/cli/tests/commands/workflow.test.ts:6` |
| `packages/app/src/services/workflow-service.ts:1152` |
| `packages/app/src/services/workflow-service.ts:1188` |
| `packages/app/src/services/workflow-service.ts:1199` |
| `packages/app/src/services/workflow-service.ts:1220` |
| `packages/app/src/services/workflow-service.ts:1275` |
| `packages/app/src/services/workflow-service.ts:1277` |
| `packages/app/src/services/workflow-service.ts:1312` |
| `packages/app/src/services/workflow-service.ts:2141` |
| `packages/app/src/services/workflow-service.ts:2181` |
| `packages/app/src/services/workflow-service.ts:2248` |
| `packages/app/src/services/workflow-service.ts:2253` |
| `packages/app/src/services/workflow-service.ts:2260` |
| `packages/app/src/services/workflow-service.ts:2268` |
| `packages/app/src/services/workflow-service.ts:47` |
| `packages/app/src/services/workflow-service.ts:65` |
| `packages/app/tests/services/workflow-service.test.ts:1737` |
| `packages/app/tests/services/workflow-service.test.ts:19` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/commands/workflow.ts:1055-1058 - --answer-text <text> option registered; empty text rejected at :1096-1105; service injects verbatim text under options.var else __hitlInput at packages/app/src/services/workflow-service.ts:1471-1479 (via hitlAnswerVar :2186-2189), resolved before resumeRun so guards see it (:1229); test: workflow-service.test.ts:1945-1961 routes on guard test "${vars.__hitlInput}" = "tok-7" (:1838-1841) with default + custom var: answerX (:1851-1867) - test + static-ref |
| R2 | MET | Read-only pendingGate at workflow-service.ts:1324-1352; CLI validates gate kind before TTY confirm / async spawn / any claim at workflow.ts:1173-1191; both-flags rejected :1090-1094 + service :1466-1469; --answer now honors gate options.var (workflow-service.ts:1483-1487); mismatch message names kind+state (:2222-2235, workflow.ts:1187); run-unchanged tests workflow-service.test.ts:1973-2002 and CLI workflow.test.ts:2906-2969 (exit 2 + VALIDATION_FAILED + row untouched); gateless pause accepts flags (pendingGate->null, workflow.ts:1200-1209, test :1932-1943) - test + static-ref |
| R3 | MET | Headless guard accepts either flag, message names both: workflow.ts:1113-1119, test workflow.test.ts:2995-3009 (asserts both flag names in refusal); --async validates first (workflow.ts:1173 precedes :1201) then forwards :1204; forwarding proven by spawned-line assertion "'--answer-text' 'mocha'" in workflow.test.ts:2871-2905 - test + static-ref |
| R4 | MET | Governance ledger row docs/design/harness-surface-governance.md:123 (sorted ascending after 0930 :122); cli-contracts.md synopsis updated to --answer <yes\|no\|cancel> \| --answer-text <text> (workflows.md :113, :263, prose :329-336); docs parity test workflow.test.ts:3011-3021 asserts --answer-text <text> in both files - test + static-ref |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Service: fixture state machine with pause: true + hitl.input onEnter (default var workflow-service.test.ts:1815-1846, custom var: answerX :1851-1867), guard on ${vars.__hitlInput}; continuePaused(..., {answerText}) routes to answered (:1945-1961); pendingGate reports answerVar: 'answerX' (:1905-1930). CLI: headless --json --answer-text resumes and routes (workflow.test.ts:2856-2869, finalState vanilla); --async validates then forwards (:2871-2905). Command check: cd packages/app && bun test tests/services/workflow-service.test.ts -> 154 pass / 0 fail; cd apps/cli && bun test tests/commands/workflow.test.ts -> 164 pass / 0 fail. Re-dispatch clause owned by 0933, verified there per AC |
| AC2 | MET | test | Three rejection CLI tests, each asserting exit 2, VALIDATION_FAILED, unchanged run row: --answer-text on confirm gate workflow.test.ts:2906-2937; --answer on input gate :2938-2969; both flags :2970-2981; empty text :2982-2994; docs parity test :3011-3021. Service mirror with unchanged-row asserts workflow-service.test.ts:1973-2002; P2 regression mm-4 (validation before stale-consent metadata write) :2004-2019 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature `docs/features/H1_spur-dev-skill.md` R27, R28.
- `apps/cli/src/commands/workflow.ts:1040-1215` (`continue`); `packages/app/src/services/workflow-service.ts:1130-1360` (`continuePaused`), `:2008-2013` (`HITL_ANSWER_VAR_DEFAULTS`).
- `packages/app/src/workflow/actions/hitl-input.ts`; `packages/app/src/workflow/progress-projection.ts:169`.
- Prior art: 0433 (`--answer` injection), 0901 R3/R4 (headless guard, async worker).
- `docs/design/harness-surface-governance.md`; `docs/design/cli-contracts.md:641`; `plugins/sp/skills/spur-cli/references/workflows.md`.
- Consumed by 0933.

### History

- 2026-09-23T06:58:40.189Z backlog → todo (system)
- 2026-09-24T18:29:03.744Z todo → wip (system)
- 2026-09-24T19:59:28.250Z wip → testing (system)
- 2026-09-24T20:01:08.593Z testing → done (system)

