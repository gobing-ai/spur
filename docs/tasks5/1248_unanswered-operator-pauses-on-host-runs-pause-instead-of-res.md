---
schema_version: 1
name: Unanswered operator pauses on host runs pause instead of resolving to a denial
status: todo
template: issue
created_at: 2026-10-18T05:10:06.871Z
updated_at: "2026-10-18T05:53:33.958Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - host-executor
  - bug

estimate_hours: 4
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

- [ ] R1. On an `executor=host` run, `hitl.confirm`, `hitl.select` and `hitl.input` pause the run (status `paused`, the question in the run result) whenever no profile=auto decision binding accepted an answer. They never take the default responder's `no` or an empty deferred answer.
- [ ] R2. `spur workflow continue <run> --answer yes|no|cancel` resumes a paused confirm or select. `--answer-text <text>` resumes a paused input. The answer lands in the gate's answer var, and the state's next action sees it (no replay of the gate).
- [ ] R3. `pendingGate` distinguishes a paused operator-pause action (`hitl.confirm`, `hitl.select`, `hitl.input`) from a paused host work item on the same host run. The answer flag is validated against the actual gate kind.
- [ ] R4. Behaviour for non-host runs is unchanged. A TTY run still prompts. Headless and `--json` runs without `executor=host` keep the default-deny responder. profile=auto evidence binding (1236) still answers without pausing.

Out of scope: replacing objective gates with `decide` (1250); changing the default-deny policy for headless runs.

### Acceptance Criteria

- [ ] AC1 — An interactive operator pause on a host run waits for an answer (req: R1, R2, R3, R4)

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

- [ ] 1. Failing E2E (R1, R2): a fixture state machine with `hitl.confirm` then a shell that writes the answer. Running it with `executor=host --json` ends `paused`; `continue --answer yes` reaches done with `yes` written.
- [ ] 2. Failing resume test (R3): a paused hitl.confirm on a host run accepts `--answer` and refuses `--answer-text`.
- [ ] 3. Failing regression tests (R4): a headless non-host run still records `no`; profile=auto binding still answers without a pause.
- [ ] 4. Implement `hostHitlPause` and call it from the three runners (R1).
- [ ] 5. Fix the `pendingGate` classification and the pause payload (R2, R3).
- [ ] 6. Re-run the 44f98e49 repro shape on idea-pipeline with `executor=host` and confirm idea-eval pauses. Run targeted tests in packages/app and apps/cli, then `bun run spur-check`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

