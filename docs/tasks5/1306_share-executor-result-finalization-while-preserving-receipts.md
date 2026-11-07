---
schema_version: 1
name: Share executor result finalization while preserving receipts and partial work
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-07T06:52:00.870Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: D65
priority: P2
tags:
  - simplification-2026-11
  - w5
  - approved
estimate_hours: 8

dependencies: ["1305"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1306-verdict.json
---

## 1306. Share executor result finalization while preserving receipts and partial work

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W5; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature D65: Executor results share truthful finalization and failure context.

Owned surfaces/callers/fixtures/config/docs: AgentRunActionRunner result paths; existing receipt/host-resume/fleet-result handling; failure classification, usage and redaction helpers; executor matrix fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Receipt writing is already shared by execute/recordReceipt. Do not create a second finalizer or duplicate failure classification. Share repeated post-condition/freshness result preparation around the existing one writer, preserving the host receipt exception.
- Verified source seams: `packages/app/src/workflow/actions/agent-run.ts:587`; `packages/app/src/workflow/actions/agent-run.ts:598`; `packages/app/src/services/failure-classification.ts:6`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Executor results share truthful finalization and failure context; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Share executor result finalization while preserving receipts and partial work

  Scenario: AC1 — Executor results share truthful finalization and failure context (req: R1)
    Given success, refusal, timeout, cancellation, contract failure and partial-work fixtures on each executor surface
    When execution finishes or the host resumes from its receipt
    Then shared finalization preserves freshness, usage, redaction and ownership while recording a classified failure and evidence without duplicating policy
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:03.257Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep execute -> dispatch -> recordReceipt as the sole nonhost receipt path. Add private finalizeAgentDispatchResult(invocation,result) only for common post-condition/result decoration proven repeated; use existing contractViolation, receiptOutcomeOf, redaction and failure-classification helpers. Host pause returns its workItem with no action-owned receipt; host continue retains validation ownership. Fleet fallback retains fallbackReason and subprocess executor attribution, late fleet writes remain fenced, first failure is not masked by a secondary receipt-write failure. Preserve existing result.data fields, outcome vocabulary and telemetry; any normalized diagnostic is additive internal data, not a new public enum.

#### Dependencies and handoff

Direct prerequisites: 1305. 1305 freezes private invocation data and a behavior matrix; do not repeat or change its admission decisions.

Output/handoff: 1307 reads preserved resultSummary/outcome/fallback metadata; it must not depend on an invented new public failure enum.

#### Boundaries and verification

(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/host-executor.test.ts tests/services/workflow-host-executor.test.ts). Real-agent dogfood is separately reported; fake process fixtures must prove containment without external agent availability.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write completion matrix for success/refusal/timeout/cancel/contract failure, missing receipt and resumed/late results.
- [x] 2. Extract repeated completion decoration into the existing path; retain surface exceptions and one receipt writer.
- [x] 3. Compare full result/receipt/redaction golden outputs and source policy delta before removing the old branches.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

One shared completion hop was added between the settled dispatch and the single receipt writer;
`execute -> dispatch -> recordReceipt` remains the sole nonhost receipt path.

**Change map**

- `packages/app/src/workflow/actions/agent-run.ts:590-599` — `execute` now normalizes the invocation
  once, dispatches, and funnels the settled row through the new finalization hop before the one
  existing `recordReceipt` call. No second writer, no new public surface.
- `packages/app/src/workflow/actions/agent-run.ts:602-652` — private
  `finalizeAgentDispatchResult(invocation, result)`: the completion matrix lives in its TSDoc
  (success / refusal / timeout / cancellation / contract failure / missing receipt / fleet fallback
  x host / fleet / subprocess). It adds only (a) the declared fleet `fallbackReason` and (b) a
  `failureSignal` classified by the existing `classifyDispatch` from the row's OWN already-redacted
  `stdoutTail` / `stderrTail` / `error`. It rewrites nothing a surface reported, returns an
  undecorated row by identity, and returns a host pause untouched (ADR-126 A4 ownership exception).
- `packages/app/src/workflow/actions/agent-run.ts:350-374` — `contractViolation` no longer stamps
  `fallbackReason`; the single shared stamp now covers the early contract-violation return and the
  success path together, so they cannot drift.
- `packages/app/src/workflow/actions/agent-run.ts:1630-1631` — the duplicate success-path
  `fallbackReason` stamp is removed for the same reason (comment records where it moved).
- `packages/app/src/workflow/actions/agent-run.ts:1617-1619` — on a failing subprocess row the
  terminating `signal` now rides the result, so finalization can classify a timeout/cancellation
  from the row itself instead of re-reading the streams. Redaction therefore stays strictly
  upstream of classification.
- `packages/app/src/workflow/actions/agent-run.ts:1247-1252` — `postConditionData()` plus one
  `artifactFs` handle replace six identical `buildResultData(...)` call sites and three ad-hoc
  `createNodeFileSystem(cwd)` constructions across the post-exit contract chain (tripwire stop,
  answerFile empty, expectFile empty, requireDiff clean-check-failed / empty-implement /
  out-of-scope).
- `packages/app/src/workflow/actions/agent-run.ts:1869-1888` — `fleetDispatchRow(dispatch, reason,
  expectFile)` replaces the three repeated dispatched-fleet rows, preserving the exact key order the
  subprocess/fleet trace-parity test pins. `FLEET_USAGE_NOTE`
  (`packages/app/src/workflow/actions/agent-run.ts:68-69`) names the honest usage-unavailability reason
  in one place.
- `packages/app/src/workflow/actions/agent-run.ts:1890-1897` — `resolveUnder(cwd, path)` is the one
  freshness/post-condition/receipt path rule inside this action, replacing four inline
  `isAbsolute(p) ? p : join(cwd, p)` copies. Host `continue` keeps validation ownership in
  `validateWorkItemReceipt`; that validator was not moved into the action finalizer.
- `packages/app/tests/workflow/actions/agent-run-completion.test.ts:117-275` — the Plan step 1
  completion matrix as executable characterization (9 tests): subprocess success keeps measured
  usage and stays surface-less; a refusal is classified from the redacted tail (secret replaced by
  `[REDACTED]`); a SIGTERM row with `timeoutMs` classifies as `timeout`, keeps its partial-work
  artifact and leaves an `outcome-unknown` receipt; a SIGINT row with no timeout uses the
  cancellation wording and the same `timeout` classification (the existing classifier maps every
  signal to `timeout`); a contract violation is never reported as a provider failure; a fleet
  failure keeps member identity and honest `unavailable` usage; a host pause writes no action-owned
  receipt and is not decorated; the fallback stamp appears on both a success and a violation row;
  absolute and relative declared paths resolve identically.

**Deliberate non-changes**

- No new public failure enum. `failureSignal` is additive internal diagnostic data produced by the
  existing `ObjectiveEscalationSignal` classifier; `ReceiptOutcome` and `receiptOutcomeOf` are
  untouched, so 1307's `resultSummary` / `outcome` / `fallback` reads are unaffected.
- `surface` and `usage` are NOT stamped in finalization. `packages/app/tests/workflow/agent-run-fleet.test.ts:169`
  and `:225` pin a subprocess and a fleet-fallback row as `surface: undefined`; stamping them would
  have broken the declared parity contract.
- A fleet failure row gets no `failureSignal`: `FleetReceipt`
  (`packages/app/src/services/fleet-dispatcher.ts:42-46`) carries status only, and
  `packages/app/src/workflow/fleet-dispatch.ts:257` deliberately reports the coarse `reason:
  'errored'`. There is no provider evidence on that row, so finalization adds nothing rather than
  guessing a cause. Plumbing member failure text through the control plane would be a new
  capability, outside this task's frozen contract.
- Host resume validation stays in `validateWorkItemReceipt`. The frozen contract says host
  `continue` retains validation ownership, and only a `done` receipt resumes the run.

**Verification**

- `(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/host-executor.test.ts tests/services/workflow-host-executor.test.ts tests/workflow/actions/agent-run-completion.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1306/focused-junit.xml)`
  -> 223 pass / 0 fail, 695 expect() calls. Repeatable JUnit artifact: `.spur/run/1306/focused-junit.xml`
  (`<testsuites tests="223" failures="0" skipped="0" assertions="695">`).
- `bun test tests/workflow/actions/agent-run-admission.test.ts tests/services/failure-classification.test.ts tests/workflow/fleet-dispatch.test.ts` -> 91 pass / 0 fail, 262 expect() calls.
- Changed-path matrix (`packages/app` service surface): `bun run --filter @gobing-ai/spur-app typecheck`
  and `bun run --filter @gobing-ai/spur typecheck` both exit 0.
- `bun apps/cli/src/index.ts rule run --preset recommended-pre-check --json` -> 51 rules, 0 findings.
  `--preset recommended-post-check` -> 2 rules, 0 findings. Biome check on the two changed TypeScript
  files: no fixes.
- `bun apps/cli/src/index.ts task gate 1306 light` -> FAIL. Format-lint, rules:pre, app typecheck
  and the related app tests passed. `rules:post` failed in `coverage-provenance-check` before the
  post-check preset ran: `coverage-artifact: stale-tree` because
  `packages/app/tests/workflow/actions/agent-run-completion.test.ts` changed after the certified
  coverage run. The script's recovery is `bun run test:full`, which is the pipeline `gate` state's
  full project check, not an implement-step suite. Log: `.spur/run/1306-light-gate.log`.
- Public-surface probe: not-applicable (no public CLI verb, HTTP route or plugin script changed).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:598` dispatch routes through `finalizeAgentDispatchResult`; `packages/app/src/workflow/actions/agent-run.ts:622-623` host pause bypass; `packages/app/src/workflow/actions/agent-run.ts:661` `recordReceipt`; `packages/app/src/workflow/receipt.ts:201` refuses non-done outcomes; packages/app 268 + 26 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Executor results share truthful finalization and failure context (req: R1) | MET | test | `packages/app/tests/workflow/actions/agent-run-completion.test.ts:118` usage survives finalization; `packages/app/tests/workflow/receipt.test.ts:170` non-done outcomes refused; `packages/app/tests/services/workflow-host-executor.test.ts:154` missing receipt keeps run paused — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1306

**Scope:** working tree (no `(1306)` commit): `packages/app/src/workflow/actions/agent-run.ts`, `packages/app/tests/workflow/actions/agent-run-completion.test.ts`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Outcome:** PASS

Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | No P1-P3 findings. One private hop decorates a settled dispatch before the existing receipt writer and leaves host pause, contract-violation, and status-only fleet rows undecorated. This review re-ran the executor suite: 237 pass / 0 fail. The recorded light gate is stale-tree until the pipeline full check refreshes coverage provenance. | `packages/app/src/workflow/actions/agent-run.ts:622` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:598` sends the settled row through `packages/app/src/workflow/actions/agent-run.ts:622-651` before `packages/app/src/workflow/actions/agent-run.ts:661`. Host pause returns at `packages/app/src/workflow/actions/agent-run.ts:623`. A failed row is not replaced when receipt write throws at `packages/app/src/workflow/actions/agent-run.ts:697`. Host resume still requires outcome done at `packages/app/src/workflow/receipt.ts:201`. |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Executor results share truthful finalization and failure context (req: R1) | MET | test | `packages/app/tests/workflow/actions/agent-run-completion.test.ts:118-274`; host resume `packages/app/tests/workflow/receipt.test.ts:170` and `packages/app/tests/services/workflow-host-executor.test.ts:154`. bun test of the task named executor files plus receipt.test.ts exited 0, 237 pass / 0 fail. |

Verdict: PASS

**Next:** certify the answer and let the pipeline full gate refresh coverage provenance.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T05:19:08.038Z todo → wip (system)
- 2026-11-06T05:43:56.502Z wip → testing (system)
- 2026-11-06T05:43:58.554Z testing → done (system)

