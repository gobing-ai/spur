---
schema_version: 1
name: Restart reconciliation and operator-visible delivery failure states
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.594Z
updated_at: "2026-09-12T08:14:20.973Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

The classifier, one call site, one widened read — exactly the spec's WHERE table; no requeue/release
anywhere, no new verb, no status-column collapse.

- **`packages/app/src/services/delivery-reconciler.ts` (new)** — the classifier.
  `MAX_INJECT_ATTEMPTS` (`delivery-reconciler.ts:16`) is 0831's budget hoisted here from the CLI
  drain path so settle and reconcile share one constant (the CLI now imports it — no re-derivation);
  frozen types `HoldReason`/`UnresolvedDelivery`/`ReconcileReport` (`:23`, `:26`, `:38`);
  `DeliveryReconciler.reconcile` (`:89`) implements the five-step precedence, first match wins:
  failed→`delivery-failed` (`:114`); injected+receipt → `run-exit-only`/`delivery-failed` by the
  run's outcome, `verified` treated as a finished request and omitted (`:118-137`); injected without
  a receipt → `outcome-unknown` with `artifacts: []` — no refs may be inferred without a
  receipt-listing run row (`:120-123`); queued at/over budget → `attempts-exhausted` and the ONLY
  write, `markFailed(..., "attempts exhausted after N deliveries")` (`:142-146`); queued under
  budget → omitted. Steps 1–3 are pure reads, so a second pass over a pass-1 write claims the row at
  step 1 — idempotent (R5).
- **`packages/domain/src/dao/inbox-unfinished-dao.ts` (new)** — `listUnfinished(toId?)`
  (`inbox-unfinished-dao.ts:26-34`): the reconciler's scan set (all `status != 'delivered'` rows
  with attempt/error fields), cross-recipient when no id is given (G62's 0838 caller). Raw SQL lives
  in domain per `raw-sql-only-in-domain`; exported at `packages/domain/src/dao/index.ts:22`.
- **`apps/cli/src/commands/agent.ts:822-823`** — R2 call site: `runAgentLoop` reconciles
  `reconcile(recipient)` once at startup, before the first drain, and writes the report to the run
  log via `formatReconcileReport` (`agent.ts:772`); the loop is never gated on the report. Local
  `MAX_INJECT_ATTEMPTS` deleted; imported from `@gobing-ai/spur-app` (`agent.ts:9`).
- **`apps/cli/src/commands/message.ts:115-119`** — `--unresolved` on `spur message inbox`;
  `runMessageInbox` (`message.ts:366`) runs the reconciler first (so its one authorized write is
  reflected in the listing), filters to holds with `--unresolved`, and widens every `--json` row via
  `widenInboxRow` (`message.ts:403`) with `injectAttempts`, `injectError`, `reason`, `runId`,
  `taskId`, `artifacts`. Plain-text output without `--unresolved` is byte-identical to before.
- **`packages/app/src/services/team-service.ts:172`** — `InboxEntry` gains optional
  `injectAttempts`/`injectError`, populated by `getInbox` (`team-service.ts:364-365`) so the CLI can
  widen rows without a second read. Additive/optional; watch and board consumers untouched.
- **Exports** — `packages/app/src/index.ts:156-162`.
- **Docs** — `plugins/sp/skills/spur-cli/references/message.md` (verb map + "Delivery failure
  states (0834)" section), `docs/help/cmd_message.md` (`--unresolved` row + JSON shape),
  `docs/help2/message.md`.

Anti-patterns respected: no requeue/release/re-dispatch (outcome-unknown rows stay `injected` —
asserted in tests), four distinct hold reasons from named fields, no new public verb, no
terminal/process-list inference, budget imported not re-derived.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Callable classifier, not a hook: `packages/app/src/services/delivery-reconciler.ts:89` `DeliveryReconciler.reconcile(agentId?)` returns `ReconcileReport {unresolved, exhausted, scanned}`; fresh run 11/11 pass incl. "reconcile() with no agentId scans all recipients" |
| R2 | MET | `apps/cli/src/commands/agent.ts:824-825` — `runAgentLoop` reconciles `recipient` before entering the poll loop and logs via `formatReconcileReport` (`:772`), non-gating; test `apps/cli/tests/commands/agent.test.ts:834` "loop startup reconciles in-flight work before its first drain" pass |
| R3 | MET | `delivery-reconciler.ts:112-115` — injected with no receipt → `outcome-unknown`, artifacts `[]` (none inferred), row left `injected`, never requeued/released; test `delivery-reconciler.test.ts:104` "outcome-unknown, no artifacts inferred, no requeue" and `:179` late-receipt reclassification still never requeued |
| R4 | MET | Four distinct HoldReasons each from a named field: `status='failed'`→delivery-failed (`:106`); run `outcome`→run-exit-only/delivery-failed (`:118-127`); no run row→outcome-unknown (`:114`); `inject_attempts>=MAX_INJECT_ATTEMPTS`→attempts-exhausted (`:136`, import not re-derived `:16`); no status-column collapse |
| R5 | MET | Steps 1-3 pure reads; only write is `markFailed` queued→failed at budget (`:134`) which removes itself from its own selection; test `delivery-reconciler.test.ts:157` "double reconcile: identical classification, exhausted empty on pass 2" pass |
| R6 | MET | `apps/cli/src/commands/message.ts:115-119` `--unresolved` on existing inbox verb (no new verb); `runMessageInbox:366` reconciles first, `widenInboxRow:401` adds injectAttempts/injectError/reason/runId/taskId/artifacts to `--json`; docs satellites `plugins/sp/skills/spur-cli/references/message.md:70-78`, `docs/help/cmd_message.md`, `docs/help2/message.md`; 3 CLI tests pass (message.test.ts 48/48) |
| R7 | MET | All five scenarios: restart in-flight via loop (agent.test.ts:834), missing receipt (:104), exhausted budget (step-4 test), late receipt (:179), double reconcile (:157) — 13/13 reconciler+DAO, 48/48 message, 48/48 agent, all fresh this verify |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Ambiguous outcomes hold instead of replaying | MET | test | delivery-reconciler.test.ts:104 "step 3: injected with no receipt → outcome-unknown, no artifacts inferred, no requeue" (pass): status stays `injected`, artifacts [] , no requeue/release anywhere in `delivery-reconciler.ts` |
| Reconciliation precedes new dispatch | MET | test | agent.test.ts:834 "0834: loop startup reconciles in-flight work before its first drain" (pass): report in run log at agent.ts:824-825 before first `drainIntoPrompt` iteration |
| Delivery failure is readable without stderr | MET | test | message.test.ts 3× 0834 tests (pass): "--unresolved --json shows held messages with reason, attempts, error, run correlation", run-correlated rows carry runId/taskId/artifacts, plain-text --unresolved filtering — no stderr, no new verb |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0834 (pipeline Phase 7, profile=auto, mode=safety)

**Scope:** 0834 diff surface only (HEAD 3761051f9; 0831/0832/0833 changes excluded): `packages/app/src/services/delivery-reconciler.ts` (new), `packages/domain/src/dao/inbox-unfinished-dao.ts` (new) + dao/index.ts export, `apps/cli/src/commands/agent.ts` (formatReconcileReport, runAgentLoop startup), `apps/cli/src/commands/message.ts` (--unresolved, reconcile-first, widenInboxRow), team-service InboxEntry widening, app/domain exports, 3 doc files, 4 test files.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | Multi-receipt tie-break is undefined by the spec: a message listed by >1 `coordination_runs` row (redelivered, consumed twice) takes the newest-start receipt (`[0]` of `listByMessageId`, newest-first). Deterministic and sensible (latest evidence wins), but an older `errored` receipt superseded by a newer `verified` one silently omits the message as finished — no test covers the multi-receipt case | `packages/app/src/services/delivery-reconciler.ts:121` |
| 2 | P4 (advisory) | usability | `spur message inbox --json` without `--unresolved` still runs the reconciler, so its one authorized write (queued→failed at budget) fires on every JSON read — a polling script mutates state as a read side effect. Spec'd (reason field requires classification; Solution documents it) and idempotent | `apps/cli/src/commands/message.ts:371` |
| 3 | P4 (advisory) | architecture | New `InboxUnfinishedDao` is a WHERE-table addition (spec's WHERE lists only reconciler + 2 CLI files + reuse of `listByMessageId`). Justified: per-recipient `inbox()` has no status filter, the cross-recipient scan needs raw SQL, and `raw-sql-only-in-domain` forbids it in app — precedent exists (`InboxRecentDao`); disclosed in Solution with its own domain tests | `packages/domain/src/dao/inbox-unfinished-dao.ts:26-34` |
| 4 | P4 (advisory) | correctness | For the outcome-unknown case R3's "carrying run id, artifacts" is vacuously satisfied: no receipt-listing run row exists by construction, so runId/taskId are undefined and artifacts `[]`. Correct per the no-inference anti-pattern (last-known state `injectAttempts`/`injectError` is carried); no defect | `packages/app/src/services/delivery-reconciler.ts:122-125` |
| 5 | P4 (advisory) | correctness | Any receipt outcome outside the frozen `{run-exit-only, errored, verified}` is silently omitted as finished. Safe default today (vocabulary is closed, dao:58-66); a future "still-working" outcome would under-report | `packages/app/src/services/delivery-reconciler.ts:135-137` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Callable class + report; no hidden hook — `delivery-reconciler.ts:89` `reconcile()`; scanned/unresolved/exhausted per frozen `ReconcileReport` |
| R2 | MET | `runAgentLoop` reconciles before the first drain, logs via `formatReconcileReport` (`agent.ts:822-823`, `:772`), never gates; tested through the real call path (`agent.test.ts:834`) |
| R3 | MET | `injected` + no receipt → `outcome-unknown`, row left `injected` (asserted), nothing requeued/released/inferred (`delivery-reconciler.ts:122-125`; reconciler test "no requeue") |
| R4 | MET | Four distinct reasons, each from a named field: `status` → `delivery-failed`; run `outcome` → `run-exit-only`/`delivery-failed`; absent run → `outcome-unknown`; `inject_attempts` ≥ budget → `attempts-exhausted`. No status-column collapse. `verified` correctly omitted as finished |
| R5 | MET | Steps 1–3 pure reads; step 4's `queued→failed` removes itself from its own selection; pass 2 claims the row at step 1 with `exhausted: []` — tested (`delivery-reconciler.test.ts` "double reconcile") |
| R6 | MET | `--unresolved` + widened `--json` rows (`injectAttempts`, `injectError`, `reason`, `runId`, `taskId`, `artifacts`) at `message.ts:115-119`/`:366`/`:403`; plain text without flags byte-identical (`classify=false`, `formatInboxLine` untouched); no new verb; docs updated in all 3 surfaces (reference/message.md §0834, cmd_message.md, help2/message.md) |
| R7 | MET | All five scenarios: restart-with-in-flight via loop (`agent.test.ts:834`), missing receipt, exhausted budget, late receipt (`outcome-unknown → run-exit-only`, still injected), double reconcile — 11 reconciler cases + DAO tests + CLI tests |

**Scrutiny results (all clean):** precedence branches match the spec exactly incl. `verified`-omitted; single-write idempotence verified pass-2-empty; no requeue/inference anywhere in the diff; `MAX_INJECT_ATTEMPTS` defined once (`delivery-reconciler.ts:16`), CLI imports it (`agent.ts:9`), local copy deleted, zero other hardcodings; reconcile-first in `runMessageInbox` is justified (its write must precede the listing it filters); raw SQL confined to domain; no terminal-output/process-list inference; frozen type shapes match the spec verbatim.

**Verification (fresh, this review):** `bun test packages/app/tests/services/delivery-reconciler.test.ts packages/domain/tests/dao/inbox-unfinished-dao.test.ts` → 13 pass, 0 fail. `bun test apps/cli/tests/commands/message.test.ts apps/cli/tests/commands/agent.test.ts` → 96 pass, 0 fail. Implementer's `spur-check` rc 0 (8071 tests) on record.

**Residual risk:** multi-receipt precedence (finding 1) is the only behavioral surface without an explicit spec rule or test; recommend a task-0844/G62 follow-up note, not a fix now. Read-verb write side effect (finding 2) is accepted spec behavior — document if operators poll `--json`.

**Next:** PASS — no blockers; disposition 0834 as done. Carry finding 1 (multi-receipt tie-break test) as an advisory into 0838's reconcile-caller work.

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

