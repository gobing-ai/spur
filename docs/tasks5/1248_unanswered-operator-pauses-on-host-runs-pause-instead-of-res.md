---
schema_version: 1
name: Unanswered operator pauses on host runs pause instead of resolving to a denial
status: done
template: issue
created_at: 2026-10-18T05:10:06.871Z
updated_at: "2026-10-19T01:34:18.459Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - host-executor
  - bug

estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1248-verdict.json
---

## 1248. Unanswered operator pauses on host runs pause instead of resolving to a denial

### Background

Repro (run 44f98e49-ba48-476b-93d8-a10c611ea075): `spur workflow run idea-pipeline.yaml --vars '{"executor":"host",...}' --json`, perform discovery, `spur workflow continue <run> --answer-text <receipt> --json`. idea-eval's `hitl.confirm` received an empty answer, the following shell step defaulted it to `no`, and the run ended cancelled (start→discovery→idea-eval→cancelled) with no pause. The empty-means-no default lives in idea-pipeline.yaml's idea-eval onEnter; the answer comes from the responder seam (packages/app/src/workflow/decision-hitl-responder.ts, packages/app/src/services/workflow-resume-ops.ts). Covers feature scenario R10.


**Refine corrections (2026-10-17)**

- Root cause is in the action runners, not only the responder. On a non-TTY or `--json` run the CLI selects `DefaultHitlResponder` (apps/cli/src/context.ts:186-190), which answers confirm `no`. An evidence decision that defers also clears the answer to `''` (packages/app/src/workflow/decision-hitl-responder.ts:162). A responder cannot pause because `HitlResponder.respond` returns an answer. The engine's pause seam is `ActionResult.pause` (ts-dual-workflow-engine `types.d.ts` ActionResult). `agent-run.ts:564` already uses it, and resume continues after the paused action without replay.
- R1 named the wrong resume flag. Confirm and select gates resume with `--answer yes|no|cancel`; `--answer-text` is for `hitl.input` (packages/app/src/services/workflow-resume-ops.ts:445-466, 0932 R2).
- Trap: `pendingGate` reports any host-executor run whose snapshot carries `actionResume` as a host receipt gate (`hitl.input` / `__hostReceipt`, workflow-resume-ops.ts:323). Left unchanged, a paused `hitl.confirm` on a host run would refuse `--answer` and store `--answer-text yes` as a receipt path.
- R4 was dropped as invalid. The `[ -n "$a" ] || a=no` shells in idea-pipeline.yaml (lines 216, 390, 492, 574) are the documented default-deny for headless non-host runs, and on a host run the pause means they never see an empty answer. 1250 replaces the feature-check and batch-create gates anyway.
- In scope: idea-pipeline (4 gates), task-pipeline `approve` (706) and `escalate` `hitl.input` (382), and wrapup-pipeline branch-cleanup (472). wayfinder-resolution is deleted by 1251.

### Requirements

- [x] R1. On an `executor=host` run, `hitl.confirm`, `hitl.select` and `hitl.input` pause the run (status `paused`, the question in the run result) whenever no profile=auto decision binding accepted an answer. They never take the default responder's `no` or an empty deferred answer.
- [x] R2. `spur workflow continue <run> --answer yes|no|cancel` resumes a paused confirm or select. `--answer-text <text>` resumes a paused input. The answer lands in the gate's answer var, and the state's next action sees it (no replay of the gate).
- [x] R3. `pendingGate` distinguishes a paused operator-pause action (`hitl.confirm`, `hitl.select`, `hitl.input`) from a paused host work item on the same host run. The answer flag is validated against the actual gate kind.
- [x] R4. Behaviour for non-host runs is unchanged. A TTY run still prompts. Headless and `--json` runs without `executor=host` keep the default-deny responder. profile=auto evidence binding (1236) still answers without pausing.

Out of scope: replacing objective gates with `decide` (1250); changing the default-deny policy for headless runs.

### Acceptance Criteria

- [x] AC1 — An interactive operator pause on a host run waits for an answer (req: R1, R2, R3, R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Chosen: the pause lives in the action runners through one shared helper, because only an `ActionResult` can pause. The resume side learns to tell a paused operator-pause action apart from a host receipt.

Rejected:
- A pausing `HitlResponder`: the contract returns an answer and cannot suspend.
- Patching idea-pipeline's shells: the sibling workflows keep the bug.
- Making the CLI pick a different responder for `--json`: that would change the headless default-deny for CI.

Frozen names:
- `hostHitlPause(context, resolved)` in packages/app/src/workflow/decision-hitl-responder.ts returns an `ActionResult` (`{ ok: true, pause: true, data: { surface: 'host', reason: 'hitl-pause', kind, prompt } }`) or `null`.
- Its condition: `context.vars.executor === 'host'` and the resolution was not an accepted decision binding (delegated to the responder, or deferred).
- When it pauses it sets only the decision `statusVar`. It never writes the answer var.

File targets:
- packages/app/src/workflow/actions/hitl-confirm.ts, hitl-select.ts, hitl-input.ts — call the helper after `resolveDecision` and return its result when it is non-null.
- packages/app/src/services/workflow-resume-ops.ts:323 — when the snapshot's paused action (the cursor in `actionResume`) is an operator-pause kind, return that gate kind and answer var instead of `__hostReceipt`.
- packages/app/src/workflow/host-executor.ts:70-90 — the run result's pause payload carries the operator-pause question when there is no work item.
- Tests: packages/app/tests/workflow/actions/hitl-*.test.ts and packages/app/tests/services/workflow-resume-ops*.test.ts. E2E under apps/cli/tests/commands/workflow/.

Anti-patterns:
- No new `spur workflow continue` flag.
- No YAML edits to make the pause work.
- Do not pause when `executor` is unset.
- Do not treat an empty `--answer` as `no`.

Handoffs:
- 1250 relies on R1 for idea-eval and design-approval, which stay operator pauses.
- 1249 relies on it for wrapup branch-cleanup.
- dev-plan, dev-idea and dev-run skill text that says a host run "returns a work item" also needs "or an operator-pause question to relay"; that sweep belongs to 1252.

### Plan

- [x] 1. Failing E2E (R1, R2): a fixture state machine with `hitl.confirm` then a shell that writes the answer. Running it with `executor=host --json` ends `paused`; `continue --answer yes` reaches done with `yes` written.
- [x] 2. Failing resume test (R3): a paused hitl.confirm on a host run accepts `--answer` and refuses `--answer-text`.
- [x] 3. Failing regression tests (R4): a headless non-host run still records `no`; profile=auto binding still answers without a pause.
- [x] 4. Implement `hostHitlPause` and call it from the three runners (R1).
- [x] 5. Fix the `pendingGate` classification and the pause payload (R2, R3).
- [x] 6. Re-run the 44f98e49 repro shape on idea-pipeline with `executor=host` and confirm idea-eval pauses. Run targeted tests in packages/app and apps/cli, then `bun run spur-check`.

### Root Cause

Two layers, not one. On a non-TTY `--json` run the CLI selects `DefaultHitlResponder`
(`apps/cli/src/context.ts:186-190`), which answers confirm/select `no`; a `profile=auto` evidence
defer clears the answer to `''` (`packages/app/src/workflow/decision-hitl-responder.ts:182`). A
`HitlResponder` **cannot** pause — its contract returns an answer — so every gate on an
`executor=host` run resolved to a value nobody chose, and idea-eval's following default-deny shell
(`config/workflows/idea-pipeline.yaml:216`) turned that into `no`, ending run
`44f98e49-ba48-476b-93d8-a10c611ea075` `cancelled` with no pause.

The engine's only in-action suspend seam is `ActionResult.pause`, already used by host `agent.run`
dispatch (`packages/app/src/workflow/actions/agent-run.ts:564`), so the pause has to live in the
three gate runners.

A second defect sat on the resume side: `pendingGate` classified *any* paused host-executor run
carrying an `actionResume` cursor as a host receipt gate
(`packages/app/src/services/workflow-resume-ops.ts:337`). Left unchanged, a paused `hitl.confirm`
on a host run would refuse `--answer` and store `--answer-text yes` as a receipt path.

### Solution

The pause lives in the action runners through one shared helper, because only an `ActionResult`
can suspend a run. No new `spur workflow continue` flag, no YAML edit, no change to responder
selection.

**Pause side (R1)**

- `packages/app/src/workflow/decision-hitl-responder.ts:126` — `ResolvedHitl.operatorPending`:
  the gate needs an operator and no responder was consulted.
- `packages/app/src/workflow/decision-hitl-responder.ts:150-156` — `resolveDecision` takes
  `hostPause?: boolean`; an internal `ask()` replaces all three `responder.respond` call sites so
  every responder-bound path returns `operatorPending` **without** asking. Calling the helper
  strictly after `resolveDecision` would have prompted an interactive host operator and then
  discarded the answer.
- `packages/app/src/workflow/decision-hitl-responder.ts:183` — a `profile=auto` defer on a host
  run is also unanswered, so it pauses instead of letting the cleared answer reach a default-deny
  shell.
- `packages/app/src/workflow/decision-hitl-responder.ts:202-216` — `hostHitlPause(context,
  resolved, gate)` returns `{ ok: true, pause: true, data: { surface: 'host', reason:
  'hitl-pause', kind, prompt } }`, or `null` when the run is not on the host executor or a
  binding already accepted an answer. It sets **only** the decision `statusVar`; the answer var
  stays unset so `continue --answer` is the single source of the answer. (The frozen signature
  gained a third `gate: { kind, prompt }` argument — the payload's `kind` and `prompt` are in
  neither of the two frozen parameters.)
- `packages/app/src/workflow/actions/hitl-confirm.ts:57`,
  `packages/app/src/workflow/actions/hitl-select.ts:70` — pass `selectsHostExecutor(context.vars)`
  into `resolveDecision`, then return the pause before the `workflow.hitl.response` emit (the
  question *was* asked; no response exists yet).
- `packages/app/src/workflow/actions/hitl-input.ts:46-50` — input carries no decision binding, so
  on a host run it is always unanswered in-process; the check is standalone.

**Resume side (R2, R3)**

- `packages/app/src/workflow/host-executor.ts:94-123` — `operatorPauseAt(workflow, stateOrNodeId,
  data)` reconstructs the paused gate from the definition plus the snapshot's `actionResume`
  cursor, because only `lastActionResult.ok` survives a pause. The cursor's `nextAction` is the
  first *unexecuted* action, so the paused gate sits at `nextAction - 1`; the prompt is resolved
  against `effectiveVars`. Returns the gate's raw `options` so callers derive the answer var with
  the existing `hitlAnswerVar` — importing `composition-lint` here would close a module cycle
  (`composition-lint` → `actions/hitl-select` → `decision-hitl-responder` → `host-executor`).
- `packages/app/src/services/workflow-resume-ops.ts:337-345` — `pendingGate` classifies an
  operator gate **before** the `__hostReceipt` branch, so the CLI's existing flag validation
  (`apps/cli/src/commands/workflow/continue.ts:192-206`) accepts `--answer` and refuses
  `--answer-text` with no new flag.
- `packages/app/src/services/workflow-resume-ops.ts:274-292` — `resolveHostPauseReceipt` takes the
  resolved `WorkflowDef` instead of its `kind` and demands no receipt for an operator gate. The
  check is needed because a gate can pause in the same state an earlier `agent.run` stage left its
  consumed work item behind.
- `packages/app/src/workflow/host-executor.ts:136-155` + `packages/app/src/services/workflow-service.ts:58-67`
  — the run result's `pause` payload reports `{ reason: 'hitl-pause', kind, prompt }` for an
  operator gate, classified ahead of the work-item path; `WorkflowRunResult.pause` is now that
  union.
- `packages/app/src/services/workflow-run-ops.ts:193-199` — pass the definition to
  `attachHostPause`.

**Test correction**

`packages/app/tests/services/workflow-host-executor.test.ts:96-108` — the 1232 R2 fixture declares
`pause: true` on a state that *also* holds a `hitl.confirm`. Its second pause now carries the
gate's question (it previously asserted `undefined`, which encoded this bug), and the declared
state pause takes its own hop afterwards, so the chain is work-item → gate → declared pause →
`review`. The test's actual guard — the consumed work item must not resurface — still holds.

Out of scope as specified: replacing objective gates with `decide` (1250); the default-deny policy
for headless non-host runs (R4 keeps it byte-identical).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/decision-hitl-responder.ts:202-216`; host confirm/select/input unit and CLI tests pass without consulting default deny. |
| R2 | MET | `packages/app/src/services/workflow-resume-ops.ts:280-310`; CLI resume tests prove explicit answers reach the consumer once, including input text. |
| R3 | MET | `packages/app/src/services/workflow-resume-ops.ts:343-359`; cursor classification and wrong-answer-flag CLI regressions pass. |
| R4 | MET | `packages/app/tests/workflow/host-operator-pause.test.ts:101-142`; non-host, unset, fleet and accepted-auto binding regressions passed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R10 — An interactive operator pause on a host run waits for an answer | MET | test | `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:94-164`; fresh CLI suite passes; `apps/cli/tests/workflow/idea-pipeline-e2e.test.ts:7-72` proves the bundled idea workflow pauses and cancels explicitly. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1248 (re-review after fixes)

Scope: working tree (no implementation commit tagged 1248). Reviewed all eight changed production files and all three changed/new test files; the task document supplies requirements and design. Dimensions: functional, security, efficiency, correctness, usability, architecture. Report only; production changes untouched.

This is the re-review of the earlier FAIL (one P1, one P2). Both findings are fixed in the current tree, each with committed E2E regressions.

##### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 (blocker) | correctness | `packages/app/src/services/workflow-resume-ops.ts:290` | (Prior review) unanswered host operator resume skipped the gate and ran its consumer. **Fixed:** `resolveHostPauseReceipt` now demands the gate's answer and throws `ValidationError` (`workflow-resume-ops.ts:291-299`) before any mutation. Fresh probe re-run (exit 0): all three kinds stay `paused` with an unchanged snapshot and no consumer side effect, and the TTY CLI path exits 1 naming the required flag (`.spur/run/1248-review-probe-results.json`, cases `service hitl.* continue without gate answer`, `TTY CLI continue of shipped idea-eval without an answer`). Committed regressions: `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:229` (unanswered TTY continue refused, both engine modes, all three kinds). | FIXED |
| P2 (major) | correctness / architecture | `packages/app/src/workflow/host-executor.ts:103` | (Prior review) the unconditional `actionResume` cursor requirement made transition-flow question attachment unreachable. **Fixed:** `operatorPauseAt` resolves a transition-flow node's single action directly (`host-executor.ts:103-105`), retaining cursor-based selection for state machines. Probe: all three transition-flow kinds pause with `{ reason: 'hitl-pause', kind, prompt }` and `pendingGate` resolves the real gate. Regressions: `packages/app/tests/workflow/host-operator-pause.test.ts:180` (node-action resolution), `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:259` (question carried, resume once, both modes). | FIXED |

No new P1-P4 findings this pass.

##### Assessment

The shared action-result helper remains the right suspension seam: `resolveDecision`'s internal `ask()` reports `operatorPending` on host runs without consulting the responder (`decision-hitl-responder.ts:150-156`), and `hostHitlPause` (`decision-hitl-responder.ts:202-216`) returns the pausing `ActionResult`, writing only the decision `statusVar` and never the answer var. Resume-side classification is coherent: `pendingGate` names the operator gate before the host-receipt branch (`workflow-resume-ops.ts:349-356`), so the CLI's existing flag validation accepts `--answer` and refuses `--answer-text` with exit 2 and no mutation. Non-host behavior is byte-identical (R4 evidence below). No security or efficiency concerns established. The earlier P2's engine-mode assumption is corrected and now covered by a parametrized mode matrix.

##### Verification (fresh this pass)

- `bun .spur/run/1248-review-probe.ts` — exit 0; zero failing invariants (all seven prior defect-class checks now hold, including the TTY unanswered-refusal and all transition-flow question cases).
- `(cd packages/app && bun test tests/workflow/ tests/services/)` — 5390 pass, 0 fail, 20864 expect(), 270 files.
- `(cd apps/cli && bun test tests/commands/workflow/)` — 223 pass, 0 fail, 786 expect(), 18 files (13 new review-regression tests since the prior pass).
- `bun run --filter @gobing-ai/spur-app typecheck` / `bun run --filter @gobing-ai/spur typecheck` — exit 0.
- `git diff --check` — exit 0.
- Pipeline full check receipt: `.spur/run/1248-check-receipt.json` records `spur self exec check` PASS (tier full, run bc16c064, 2026-10-18T18:29:55Z).

Not rerun here: repo-wide feature gate (`spur-check-feature`) and physical-terminal prompting (TTY simulated via `stdout.isTTY` override, as before).

##### Batch Summary

| WBS | Outcome | P1 | P2 |
| --- | --- | --- | --- |
| 1248 | PASS | 0 | 0 |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T18:06:24.253Z todo → wip (system)
- 2026-10-18T18:46:02.638Z wip → testing (system)
- 2026-10-18T18:46:10.783Z testing → done (system)

