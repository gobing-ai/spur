---
schema_version: 1
name: Record the agent dispatch failure as the run terminal reason
status: todo
template: issue
created_at: 2026-10-18T19:33:17.168Z
updated_at: "2026-10-19T02:41:28.500Z"

feature_id: D3
---

## 1256. Record the agent dispatch failure as the run terminal reason

### Background

Six of the eight `task-pipeline` runs in the D66 batch (2026-10-18) recorded `runs.terminal_reason = 'failed-check'`, although every one of them died inside an `action_runs.agent.run` dispatch. Only `6078a8a6` recorded `retry-exhausted`.

Reproduce (project DB `.spur/spur.db`):

```sql
select substr(r.id,1,8), r.terminal_reason, a.node, a.kind, json_extract(a.result_json,'$.error')
from runs r join action_runs a on a.run_id = r.id
where r.workflow_name = 'task-pipeline' and r.status = 'failed' and a.ok = 0;
```

Rows observed: `379d95ff` (attestation refusal), `03d1ebe0` (claude session limit), `1ae85188` (model-not-found), `cdc15aa1` (openai OAuth `invalid_grant`), `e37ba001` (45-min implement timeout), `7e85e782` (model-not-found), `d5bfbe22`, `7d19fd81` — all `failed-check`; `ab81d950` (distinct-executor policy at review) also `failed-check`.

**Mechanism (verified).** `packages/app/src/workflow/terminal-reason.ts:56-76` (`classifyTerminalReason`) already maps `actionKind === 'agent.run'` → `failed-agent`, and maps `/timeout/i` in the error text → `failed-timeout`. Two paths bypass that: an `engineReason` that is already a valid terminal reason returns at the top (`if (isTerminalReason(engineReason)) return engineReason`), and the caller can pass `actionKind` for the *terminal transition* rather than the failing action. Either way `failed-check` wins, which names the quality gate and points an operator at the wrong subsystem.

**Why it matters.** The reason is the only machine-readable cause on the run row; the Board, `spur history analyze` and a resuming operator all read it. During the batch, the wrong reason hid three distinct executor classes (attestation, model resolution, provider quota) behind one label and made the runs table useless for triage.

### Requirements

- [ ] R1. A run whose terminal stage failed inside `agent.run` records a reason that names the hop and the executor, e.g. `failed-agent:implement:agy-gemini`, never `failed-check`.
- [ ] R2. The dispatch failure keeps its own class so the runs table is filterable: `attestation` | `model-resolution` | `provider-auth` | `provider-quota` | `timeout` | `distinct-executor`.
- [ ] R3. `failed-check` is reserved for a quality-gate (`command.gate` / shell guard) failure and is never produced by an `agent.run` failure.
- [ ] R4. The existing reason taxonomy stays closed and typed (`isTerminalReason`); new classes are added to that union, not smuggled through free text.
- [ ] R5. A regression test per class asserts the recorded reason for one dispatch failure and one gate failure.

### Acceptance Criteria

- [ ] AC1 — An agent dispatch failure records a reason naming the hop and executor, with its cause class (req: R1, R2)
- [ ] AC2 — `failed-check` appears only for gate/guard failures (req: R3, R4)
- [ ] AC3 — One test per class plus one gate case pins the mapping (req: R5)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: classify at the failure site, not at the run close.**
1. Pass the failing action's `kind` and its structured dispatch error to `classifyTerminalReason` (R1-R3). The action already carries `resultData.error`/`errorClass` — extend `TerminalReasonInput` with the class rather than re-parsing `errorText`.
2. Extend `TerminalReason` (packages/app/src/workflow/terminal-reason.ts) with the hex-class field: keep `failed-agent` and add a `reasonClass` column/value beside it (the runs table already stores `terminal_reason` as free text, so `failed-agent:attestation` is readable without a migration; a typed split column is acceptable if a migration is cheap).
3. Stop letting an `engineReason` short-circuit a better classification: when the engine reason is `failed-check` but the failing action is an `agent.run`, prefer the action-derived reason (R3).

**Rejected.**
- Parsing the error text harder: the classes are known at the throw site.
- One reason per executor name: the executor is already on the run row / action row; the reason needs the *cause*.
- A new column with a migration in this change: the string form is additive; a typed column can follow.

**Frozen names.** `TerminalReasonClass = 'attestation' | 'model-resolution' | 'provider-auth' | 'provider-quota' | 'timeout' | 'distinct-executor'`; rendering `failed-agent:<class>`.

**File targets.** `packages/app/src/workflow/terminal-reason.ts:10,56-76`; the callers that build `TerminalReasonInput` (grep `classifyTerminalReason` in `packages/app/src/workflow/`); `packages/app/src/workflow/actions/agent-run.ts` error paths (~:1459-1500); tests `packages/app/tests/workflow/terminal-reason*.test.ts`.

**Anti-patterns.** Do not touch the failure *policy* (retry, remediation budget); only the recorded reason. Do not reorder the existing `paused`/`interrupted`/`outcome-unknown` precedence.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

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
