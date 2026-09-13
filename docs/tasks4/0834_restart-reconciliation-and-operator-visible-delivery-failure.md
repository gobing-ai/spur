---
schema_version: 1
name: Restart reconciliation and operator-visible delivery failure states
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.594Z
updated_at: "2026-09-13T07:03:12.833Z"
feature_id: G61

dependencies: ["0831", "0833"]
---

## 0834. Restart reconciliation and operator-visible delivery failure states

### Background

Once receipts exist (0833), the remaining half of the loop is what happens when they are missing or
ambiguous. Today an agent can have edited files with no receipt, and nothing distinguishes that from
"never started": `inbox_messages.status = 'injected'` means only "consumed by a drain — the run may or
may not have succeeded" (`docs/reports/g6-runtime-inventory.md` §5.4), and `blocked` has no
first-class signal at all.

The approved design requires that a restart reconciles unfinished requests and runs *before*
dispatching more work, and that ambiguous work surfaces as **outcome-unknown** with its run artifacts
rather than being blindly requeued (`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md`
§ "Delivery minimum"). The strategy prototype keeps such assignments holding their write slot until
authoritative evidence arrives — deliberately not automated
(`docs/reports/g6-strategy-prototype.md` §6).

**Premise check — what this task can actually build on.**

- After 0831, a claimed message ends `delivered`, `queued` (released), or `failed`; `injectAttempts`
  and `injectError` are already columns on `inbox_messages` and carry the attempt count and reason.
- After 0833, `coordination_runs` carries `message_ids_json`, `task_id`, and
  `outcome ∈ {run-exit-only, errored, verified}`, queryable by run, message, and task.
- **There is no daemon startup to hook.** The only long-lived dispatcher that exists today is
  `runAgentLoop` (`apps/cli/src/commands/agent.ts:707-737`). G62's orchestrator runtime (0838) is the
  other future call site. So this task delivers a callable, idempotent reconciler plus one real call
  site, not a bootstrap hook into something that does not exist.
- **Operator surfaces are read-only and verb-complete today.** `spur message` has `send`, `inbox`,
  `reply`, `watch` (`apps/cli/src/commands/message.ts:28/101/112/124`); `spur agent` has `list`,
  `doctor`, `run`, `loop`, `wait`, `create`, `edit`, `delete`. There is no status/receipt verb, and a
  new public verb needs operator consent (`docs/design/harness-surface-governance.md`) — so this task
  extends an existing verb rather than adding one.

### Requirements

- **R1** — A reconciler classifies every unfinished request and run against receipts and occupant
  records, and returns a report. It is callable, not a hidden hook.
- **R2** — `runAgentLoop` runs reconciliation once at startup, before its first drain, so the contract
  has a real call site today. G62's orchestrator runtime (0838) is the second caller, out of scope here.
- **R3** — A run whose receipt is missing but whose agent may have written is classified
  `outcome-unknown`, carrying run id, artifacts, and last known state. It is **never** automatically
  requeued and never auto-released.
- **R4** — Hold reasons are distinct and durable: `delivery-failed`, `attempts-exhausted`,
  `outcome-unknown`, `run-exit-only`. Each is derived from a named field, never from one overloaded
  status column.
- **R5** — Reconciliation is idempotent: a second run over unchanged state classifies identically and
  writes nothing new.
- **R6** — Operators can read attempts, last error, and the run↔message correlation from
  `spur message inbox`, without reading stderr and without a new public verb.
- **R7** — Tests cover restart with in-flight work, a missing receipt, an exhausted attempt budget, a
  late receipt arriving after reconciliation, and a double reconcile.

### Acceptance Criteria

```gherkin
Feature: Restart reconciliation and operator-visible delivery failure states

  @core
  Scenario: Ambiguous outcomes hold instead of replaying
    Given a run whose receipt is missing but whose agent may have edited files
    When reconciliation runs at restart
    Then the work is reported as outcome-unknown with its artifacts and run state
    And no automatic requeue occurs

  @core
  Scenario: Reconciliation precedes new dispatch
    Given unfinished requests and runs at restart
    When the runtime resumes
    Then they are reconciled before any new work is dispatched

  @core
  Scenario: Delivery failure is readable without stderr
    Given a message in a failed delivery state
    When the operator inspects it through the message and agent surfaces
    Then the attempt count, last error, and run correlation are shown
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:11:18.912Z

- **Where reconciliation runs — CLOSED: a callable reconciler plus `runAgentLoop` startup.** The
  original R1 assumed a runtime bootstrap that does not exist. The only long-lived dispatcher today is
  `spur agent loop`; G62's orchestrator (0838) becomes the second caller. Building a bootstrap hook for
  a daemon that is not written yet would be speculative.
- **Blocking dispatch on unresolved work — CLOSED: no.** The report is operator information here.
  Whether unresolved work holds capacity is a strategy decision and belongs to G62's 0838. This keeps
  0834 independent of G62, matching its declared dependencies (0831, 0833).
- **New CLI verb — CLOSED: none.** `spur message inbox --unresolved` plus widened `--json` covers R6
  under the existing verb. A `reconcile` or `agent status` verb would need operator consent per
  `docs/design/harness-surface-governance.md`; not requested, not needed.
- **Auto-recovery of `outcome-unknown` — CLOSED: never.** Explicitly excluded by the approved design;
  the agent may have edited files. Human decision only.
- **Deferred (owner: 0844).** Board rendering of the four hold reasons. This task freezes the names.

### Design

**WHAT.** One pure classifier over the two tables 0831 and 0833 leave behind, one call site, and one
widened operator read.

**WHY a classifier, not a repair job.** Every ambiguous case in this feature is one a machine must not
resolve: a missing receipt may mean the agent edited files. So the reconciler's output is a *report*.
The only state it writes is the terminal `attempts-exhausted` marking that 0831's budget already
authorizes; everything else it names and leaves alone.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/app/src/services/delivery-reconciler.ts` (new) | the classifier |
| `apps/cli/src/commands/agent.ts:707-737` | call at loop startup, before the first drain |
| `apps/cli/src/commands/message.ts:101` / `:339` | `--unresolved` on `inbox`; receipt fields in `--json` |
| `packages/domain/src/dao/coordination-run-dao.ts` | reuse 0833's `listByMessageId` |

**Frozen names.**

```ts
type HoldReason = 'delivery-failed' | 'attempts-exhausted' | 'outcome-unknown' | 'run-exit-only';

interface UnresolvedDelivery {
    messageId: string;
    toId: string;
    reason: HoldReason;
    injectAttempts: number;
    injectError?: string;
    runId?: string;
    taskId?: string;
    artifacts: CoordinationArtifactRef[];
}

interface ReconcileReport {
    unresolved: UnresolvedDelivery[];
    exhausted: string[];   // message ids marked failed by this pass
    scanned: number;
}

class DeliveryReconciler {
    async reconcile(agentId?: string): Promise<ReconcileReport>;
}
```

**Classification precedence** (first match wins, per message still in a non-terminal state):

1. `status = 'failed'` → `delivery-failed` (reason from `injectError`).
2. `status = 'injected'` **and** a `coordination_runs` row lists it → that run's `outcome`:
   `run-exit-only` or `errored` → `run-exit-only` / `delivery-failed` respectively.
3. `status = 'injected'` and **no** run row lists it → `outcome-unknown`. This is the dangerous case
   the design names: the drain consumed it and no sink ever reported. Carry whatever artifacts the
   occupant row has.
4. `status = 'queued'` and `injectAttempts >= MAX_INJECT_ATTEMPTS` (0831's constant) →
   `attempts-exhausted`; mark the row `failed` via `markFailed` with the reason string
   `attempts exhausted after N deliveries`. This is the only write.
5. `status = 'queued'` below budget → not unresolved; omit from the report.

**Idempotence (R5).** Step 4 is the only mutation and it moves `queued → failed`, which step 4 can no
longer select on a second pass (step 1 claims it instead, as `delivery-failed`). Steps 1–3 are pure
reads. A late receipt arriving after a pass simply reclassifies the message on the next pass — from
`outcome-unknown` to `run-exit-only` — which is the intended behavior, not a violation.

**Call site (R2).** `runAgentLoop` calls `reconcile(recipient)` once before entering its poll loop and
writes the report to the run log; a non-empty `unresolved` list does not block the loop — it is
operator information, not a gate. Blocking dispatch on unresolved work is G62's strategy decision
(0838), not this task's.

**Operator surface (R6).** `spur message inbox --unresolved` filters the listing to the reconciler's
classification, and every `--json` row gains `injectAttempts`, `injectError`, `reason`, `runId`,
`taskId`, `artifacts`. No new verb — governance (`docs/design/harness-surface-governance.md`) requires
consent for one, and the existing `inbox` verb already owns this read. Update
`plugins/sp/skills/spur-cli/references/` for the message noun.

**Anti-patterns — do not implement.**

- Do not requeue, release, or re-dispatch anything classified `outcome-unknown`. No retry button, no
  "probably fine" heuristic.
- Do not collapse the four hold reasons into one status column — that is the exact defect G61 exists
  to remove.
- Do not add a `spur message reconcile` or `spur agent status` verb without operator consent.
- Do not block `runAgentLoop` on a non-empty report.
- Do not scan terminal output or process lists to decide whether an agent "may have written" — use the
  persisted artifact refs on the occupant row.
- Do not re-derive the attempt budget; import 0831's `MAX_INJECT_ATTEMPTS`.

**Handoff.** G62's 0838 calls the same `reconcile()` before its first dispatch and may choose to hold
capacity on unresolved work. G63's 0844 renders `HoldReason` values as the Board's distinct result
states; the names above are the contract between them.

### Plan

1. Add `packages/app/src/services/delivery-reconciler.ts` with `HoldReason`, `UnresolvedDelivery`,
   `ReconcileReport`, and `DeliveryReconciler.reconcile`, implementing the five-step precedence over
   `InboxMessageDao` and 0833's `listByMessageId`. (R1, R3, R4)
2. Unit tests on in-memory SQLite, one per precedence branch: failed row, injected-with-run,
   injected-without-run (`outcome-unknown`), queued-over-budget (marks failed), queued-under-budget
   (absent from the report). (R3, R4, R7)
3. Idempotence test: reconcile twice over unchanged state — identical classification, `exhausted`
   empty on the second pass. (R5, R7)
4. Late-receipt test: reconcile, then write a receipt, then reconcile again — the message moves from
   `outcome-unknown` to `run-exit-only` with no requeue. (R3, R7)
5. Call `reconcile(recipient)` once at `runAgentLoop` startup before the first drain; log the report;
   do not gate the loop. Test restart-with-in-flight-work through this path. (R2, R7)
6. Add `--unresolved` to `spur message inbox` and widen its `--json` rows with `injectAttempts`,
   `injectError`, `reason`, `runId`, `taskId`, `artifacts`. (R6)
7. Update the `spur message` reference under `plugins/sp/skills/spur-cli/references/`. (R6)
8. `cd packages/app && bun test tests/services/delivery-reconciler.test.ts`,
   `cd apps/cli && bun test tests/commands/message.test.ts`, then `bun run spur-check`.

### Solution

Re-audit fixes and current change map:

- `packages/app/src/services/delivery-reconciler.ts:110` — callable report classifies all candidates; shared classify is read-only and ambiguous work is never released
- `packages/app/tests/services/delivery-reconciler.test.ts:86` — fresh test carries run ID, task ID, running state, persisted artifacts; message remains injected
- `packages/app/tests/services/delivery-reconciler.test.ts:61` — fresh test retains delivered failed and exit-only runs; only verified receipt removes the hold
- `packages/app/tests/services/delivery-reconciler.test.ts:214` — fresh test asserts identical unresolved rows and no second write; attempts-exhausted is stable
- `apps/cli/tests/commands/message.test.ts:227` — fresh CLI JSON invocation shows run/task/artifacts for a delivered row; unresolved tests cover attempts and errors

Goal-equivalent Design corrections: delivered is only a delivery state and remains a reconciliation candidate; running rows cannot establish completion. The shared classifier retains runStatus and artifacts, preserves attempts-exhausted across passes, and never requeues ambiguous work. This supersedes the old five-step exclusion of delivered rows and old pass-two relabeling. Legacy rows without an attributable origin remain unknown without invented artifacts.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/delivery-reconciler.ts:110` — callable report classifies all candidates; shared classify is read-only and ambiguous work is never released |
| R2 | MET | `apps/cli/tests/commands/agent.test.ts:826` — fresh loop integration reconciles before its first drain |
| R3 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:86` — fresh test carries run ID, task ID, running state, persisted artifacts; message remains injected |
| R4 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:61` — fresh test retains delivered failed and exit-only runs; only verified receipt removes the hold |
| R5 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:214` — fresh test asserts identical unresolved rows and no second write; attempts-exhausted is stable |
| R6 | MET | `apps/cli/tests/commands/message.test.ts:227` — fresh CLI JSON invocation shows run/task/artifacts for a delivered row; unresolved tests cover attempts and errors |
| R7 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:235` — fresh regression changes unknown to exit-only without replay |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Ambiguous outcomes hold instead of replaying | MET | test | `packages/app/tests/services/delivery-reconciler.test.ts:86` — fresh test carries run ID, task ID, running state, persisted artifacts; message remains injected; command: packages/app: bun test tests/services/delivery-reconciler.test.ts tests/services/strategy-runtime.test.ts; apps/cli: bun test tests/commands/message.test.ts tests/commands/agent-team.test.ts tests/commands/agent.test.ts; apps/server: bun test tests/modules/health.test.ts (exit 0) |
| Scenario: Reconciliation precedes new dispatch | MET | test | `apps/cli/tests/commands/agent.test.ts:826` — fresh loop integration reconciles before its first drain; command: packages/app: bun test tests/services/delivery-reconciler.test.ts tests/services/strategy-runtime.test.ts; apps/cli: bun test tests/commands/message.test.ts tests/commands/agent-team.test.ts tests/commands/agent.test.ts; apps/server: bun test tests/modules/health.test.ts (exit 0) |
| Scenario: Delivery failure is readable without stderr | MET | test | `apps/cli/tests/commands/message.test.ts:227` — fresh CLI JSON invocation shows run/task/artifacts for a delivered row; unresolved tests cover attempts and errors; command: packages/app: bun test tests/services/delivery-reconciler.test.ts tests/services/strategy-runtime.test.ts; apps/cli: bun test tests/commands/message.test.ts tests/commands/agent-team.test.ts tests/commands/agent.test.ts; apps/server: bun test tests/modules/health.test.ts (exit 0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### G61 final forced re-audit — 0834

Verdict: PASS

Review coordinator: inline sp-super-reviewer; functional traceability, SECUA (security, efficiency, correctness, usability, architecture), and architecture-improvement lenses applied to current source. No remaining findings in this task.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | All | `packages/app/src/services/delivery-reconciler.ts:56` | No remaining findings after fixes and verification against published 0.4.66. |

#### Functional traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/delivery-reconciler.ts:110` — callable report classifies all candidates; shared classify is read-only and ambiguous work is never released |
| R2 | MET | `apps/cli/tests/commands/agent.test.ts:826` — fresh loop integration reconciles before its first drain |
| R3 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:86` — fresh test carries run ID, task ID, running state, persisted artifacts; message remains injected |
| R4 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:61` — fresh test retains delivered failed and exit-only runs; only verified receipt removes the hold |
| R5 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:214` — fresh test asserts identical unresolved rows and no second write; attempts-exhausted is stable |
| R6 | MET | `apps/cli/tests/commands/message.test.ts:227` — fresh CLI JSON invocation shows run/task/artifacts for a delivered row; unresolved tests cover attempts and errors |
| R7 | MET | `packages/app/tests/services/delivery-reconciler.test.ts:235` — fresh regression changes unknown to exit-only without replay |


Verification: final bun run spur-check exit 0 (8498 tests, 0 failures; 99.21% functions / 98.99% lines), bun run test-cf exit 0 (1 test), bun run build exit 0. Published ts-ai-runner 0.4.66 is installed; its probe verifies acceptance only after process creation. Focused evidence and Design corrections are recorded in Testing and Solution.

--next: no-op — task already terminal (done). All four G61 tasks are re-verified against the final dependency and code state.

### References

- Parent feature: [G61 — Durable project command and result loop](../features/G61_durable-project-command-and-result-loop.md)
- Depends on: 0833 (completion receipt seam), 0831 (failure marking)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5.2, §5.4; [strategy prototype](../reports/g6-strategy-prototype.md) §3 (restart, stale-owner, exit-only), §6
- Board states this feeds: [projects prototype](../reports/g6-projects-prototype.md) R3-5…R3-8
- Surface governance: `docs/design/harness-surface-governance.md`

### History

- 2026-09-12T04:57:18.106Z backlog → todo (system)
- 2026-09-12T07:41:11.649Z todo → wip (system)
- 2026-09-12T08:14:20.350Z wip → testing (system)
- 2026-09-12T08:14:20.973Z testing → done (system)

