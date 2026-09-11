# G6 strategy prototype — rest and GTD dispatch traces with capacity and restart failures

Task 0829 · prototype/test only · **no production API, dependency, or report-of-record change; mutationPolicy: none**.
Consumed authority: [0828 runtime inventory](g6-runtime-inventory.md) (§3 probes, §5 Handoff), closed 2026-09-11. Nothing in 0828's report was edited; every place 0828 reports an absent primitive is handled here as an explicitly **simulated** proposal with the production seam named.

Frozen sections: **Commands · Strategy contract (reused vs simulated) · Per-case traces · Missing production seams · Remaining decisions for production planning**.

## 1. Commands to run

```bash
# full prototype suite (R2/R3 assertions + guard tripwires)
cd apps/cli && bun test tests/commands/g6-strategy-prototype.test.ts
# companion for context: 0828's characterization probes (unchanged by this task)
cd apps/cli && bun test tests/commands/agent-team.test.ts
```

Latest run: **17 pass, 0 fail, 80 assertions** (`bun test apps/cli/tests/commands/g6-strategy-prototype.test.ts`).

Readable one-shot trace (event → controller trace + counters), run from `apps/cli/`:

```bash
bun -e 'import {G6StrategyPrototypeController as C} from "./tests/fixtures/g6/strategy-prototype.ts";
const P="/demo/proj", c=new C();
c.addInstance(P,{instanceId:"coder-1",role:"coder",executor:"claude-code",enabled:true,capabilities:["write"]});
c.addInstance(P,{instanceId:"planner-1",role:"planner",executor:"claude-code",enabled:true,capabilities:["write"],purpose:"orchestrator"});
c.process({kind:"task",projectPath:P,task:{id:"t1",wbs:"1.1",priority:2,role:"coder",authorized:true,ready:true}});
c.process({kind:"request",projectPath:P,requestId:"r1",messageId:"m1",content:"ship it"});
const a=c.assignments(P)[0];
c.process({kind:"strategy",projectPath:P,action:"rest"});
c.process({kind:"tick",projectPath:P});
c.process({kind:"result",projectPath:P,attemptId:a.attemptId,runId:a.runId,generation:a.generation,ownerEpoch:a.ownerEpoch,instanceId:a.instanceId,taskId:"t1",exitCode:0,verified:true,notification:"failed"});
console.log(c.trace.map(l=>"- "+l).join("\n")); console.log("modelCalls:",c.modelCalls,"dispatches:",c.dispatchCount)'
```

Output of that trace command (run for this report):

```
- task t1 updated
- request r1 accepted
- dispatch t1 → coder-1 [attempt-1/run-1/gen1 ep1 v1]
- rest → strategyVersion=2; dropped 0 queued; 1 running kept
- tick (no wake)
- result attempt-1 reconciled: task-completed exit=0 verified (notification failed)
modelCalls: 3 dispatches: 1
```

The dispatch line carries the full correlation (attemptId/runId/generation/ownerEpoch/strategyVersion); the sequence demonstrates the rest-drain (the still-running assignment keeps its slot to reconciliation), the zero-work tick, and the result reconciled as task-completed even though the notification failed (result retained in durable model state, per the probe 6 seam).

## 2. Strategy contract — reusable primitives vs simulated proposals

Orchestrator binding: `planner-1` is a **planner-role** instance with `purpose: "orchestrator"`. No `orchestrator` role id exists (0828 §2.5, `AGENT_ROLE_NAMES` at packages/config/src/index.ts:153–156); the prototype does not extend the schema.

| Contract element | Status | Basis / seam |
| --- | --- | --- |
| Closed role vocabulary (scribe/coder/reviewer/planner) | **Reused (proven)** | 0828 §2.5 [S] |
| Attempt identity + durable result records persisted before notification | **Reused shape, simulated mechanics** | 0828 probe 6: `executeRun` persists the result but there is no completion-notification sink — here results persist first, notification may fail, and the retained result stays discoverable (`ProjectState.finishedResults` → reconciliation API) |
| Request dedup by projectPath+requestId (immutable content, idempotent replay) | **Simulated** | 0828 probe 3 UNMET: no idempotent/dedup message identity exists; proposal = caller-supplied idempotency key (`@gobing-ai/ts-db`, additive) |
| GTD select: authorized + ready + dependency-satisfied, ordered priority → WBS | **Simulated policy** | Production task readiness is owned by existing workflows (task Q&A, CLOSED); this is a selection gate over the same gate columns, no alternate execution path |
| Exact instance binding by stable instanceId with role match | **Simulated (stable-ID reuse)** | 0828 §4: spec ids ARE mailbox identities and must be preserved verbatim in V1; the prototype quotes that preservation rule for its instanceId tie-break |
| Capability evidence for read-only assignments (not role-name assumption) | **Simulated** | No production capability table exists; proposal: explicit capabilities on fleet instances |
| Per-project single write slot claimed against ownerEpoch/strategyVersion; atomic claim of instance+slot | **Simulated** | 0828: no per-process lease/leader primitive; shared-generation refinement explicitly deferred (agent-service.ts:1080–1084) |
| Stale decision re-evaluates instead of dispatching (select→observe→claim) | **Simulated** | Requires the lease above; demonstrated by the rest-vs-dispatch race intercept |
| Rest increments strategyVersion; no future starts; queued unstarted dropped; running finish and hold their slot to reconciliation | **Simulated** | No production rest primitive; drains active work (Robin-approved default) |
| Replacement increments ownerEpoch; stale-owner results downgraded to diagnostics | **Simulated** | Per-spec monotonic `generation` exists (coordination_runs) but supervisor restarts mint fresh `SPUR_RUN_ID` without linking (0828 §5.2.5); ownerEpoch lease is new |
| Snapshot save/reload into a fresh controller (restart) | **Simulated** | Restart here means reloading a persisted-state model only; DB/process crash recovery guarantees must remain separate evidence (task Q&A, CLOSED) |
| Outcome dedup by attemptId; late results matched to instance/run/generation ownership | **Simulated ownership check** over the existing monotonic-generation shape | coordination_runs gives per-spec generation [S]; cross-controller match is new |
| Only explicit verified workflow outcome completes a task; process exit finishes only the run | **Simulated** | Probe 6 ABSENT: nothing connects runId to a task answer, and today's invoke exit is not task verification |
| Wake only on human input / strategy change / task-capacity change / result; idle ticks zero-model-call, zero-dispatch | **Simulated wakeup surface** | 0828 §2.2: today's loop is a 2000 ms idle poll with `drainPending`; a selective wakeup needs the completion-receipt seam event |
| Actionable hold reasons on empty/exhausted eligible set | **Simulated** | `blocked` has no first-class signal in the observables (0828 §5.4) |
| Cross-project delivery isolation | **Simulated rejection** | 0828 §2.4/§5.2.7: no cross-project message plane exists — inbox identity lives in one project's DB |

Boundary statement: the suite's passing state demonstrates the **simulated policy invariants** only; it does not prove SQLite atomicity, OS crash recovery, or real agent behavior. SQLite-lease reality is at-most-once claim only (probe 4, MET on the seam).

## 3. Per-case traces (R2 cases; full sequences in the test file)

| Case | Event sequence (abridged) | Final state asserted | Dispatch count |
| --- | --- | --- | --- |
| Plain dispatch (R1) | `task t1,t2(prio2)` → `request r1` → result | dispatch `t2` → coder-1 `[attemptId/runId/gen1/ep1/v1]`; exact correlation held; freed slot re-dispatches `t1` | 2 |
| Duplicate input | same `requestId` twice (identical) | idempotent replay: 0 new dispatches, `requests` size 1; different content → error thrown | 1 |
| Duplicate roles GTD | tasks a(wbs1.1) b(wbs1.2), extra coder-0 added | a → coder-0 first (stable tie-break); after a is verified, b → coder-0 again (stable instanceId tie-break reuses the idle instance; coder-1 likewise exact-bound) | 2 |
| Unmet dependency | t2(prio1) depends t1 | dispatched t1 first (not urgent-but-blocked t2); after verified completion t2 dispatches; `holds: unmet-dependency` recorded | 2 |
| Authorization/readiness gates | unauthorized a(prio1), unready b(prio2), ok c | c dispatched; `holds: unauthorized` and `not-ready` recorded | 1 |
| Disabled/unavailable | both coders disabled; scribe task also queued | scribe dispatch; `holds: no-idle-instance role coder`; capacity restore re-wakes coder work | 2 |
| Exhausted capacity | coders disabled, only coder task | 0 dispatches, actionable hold recorded | 0 |
| Unmet read-only capability | writer-only instance, read-only task | 0 dispatches; capable instance restores dispatch | 0→1 |
| Rest drain | request+tasks, rest, extra task+request during rest, result | strategyVersion 2, 0 future starts, running kept and reconciled, then `rest-after-drain` hold, slot freed only via reconciliation | 1 |
| Rest-vs-dispatch race | intercept between select and claim: rest fires | decision declared stale (v1→v2), re-evaluate → no dispatch, slot free | 0 |
| Restart w/ persisted strategy | snapshot after rest → fresh controller | compactState identical; running assignment + slot owner restored; result reconciled in fresh controller; durable dispatch count 1 | 1 |
| Stale-owner rejection | replace (ownerEpoch 1→2), then old-epoch result | `stale-owner-rejected` diagnostic, task NOT advanced; current-epoch result completes the task normally | 2 |
| Duplicate results | same attemptId twice | `finishedResults` size 1, 1 dispatch | 1 |
| Exit-as-task-success | result exit 0, verified false | `finishedResults` returns `exit-only`: run finishes, slot free, but task NOT completed; re-wake re-dispatches with a fresh attempt | 2 |
| Notification failure | result reconciled with notification failed | result discoverable in `finishedResults` AND after a snapshot reload; `reconcileNotifications()` delivers it later | 1 |
| Cross-project delivery | P1-owned attempt delivered at P2 | `orphan-result` diagnostic in P2; P1 work intact; no advance | 1 |
| Idle tick | 5 ticks | modelCalls delta 0, dispatch delta 0, `holds: idle` | 0 |

## 3.1 Guard tripwires ("suite must FAIL on …")

Each violation is asserted in the positive policy (nothing wrong happens while the policy holds) AND in the negative (the guard mechanics demonstrably throw when the violation is forced through `unsafeForceAssignment`):

- duplicate assignment → guard `duplicate-assignment` throws when a non-idle instance is forced;
- cross-project delivery → `orphan-result` diagnostic + no advance;
- dispatch after rest → `claimAndAssign` throws `no-dispatch-after-rest`; re-evaluated stale decisions during rest assert zero dispatches;
- double writer → guard `single-writer` throws when a second writer claims the project write slot;
- stale-owner advancement → `stale-owner-rejected` downgrade + task not advanced.

## 4. Missing production seams (each simulated by this prototype)

1. **Idempotency key on send** (probe 3 UNMET) — request dedup needs a caller-supplied id; owning package `@gobing-ai/ts-db` (additive).
2. **Completion-receipt linking runId↔msgId/task** (probe 6 ABSENT) — needed before "result wakes and reconciles" can be real; owning packages `@gobing-ai/ts-db` (additive) + `packages/app` sink at executeRun exit.
3. **Per-project write-slot lease / leader** (no shared generation across restarts, §5.2.5) — one write slot per project + ownerEpoch; owning package `packages/app` (or a small control-plane service), needs durable lease storage in ts-db.
4. **Commit-after-confirm delivery + notification retry reconciliation** (probe 1/2 UNMET; `markFailed` has no caller) — keeps ambiguous work held rather than replayed.
5. **Deliver-after-invoke semantics** for `queued→injected` (drain finalizes before spawn today).
6. **Orchestrator binding** — planner-role instance with `purpose: "orchestrator"`; zero production surface change but the runtime has no purpose field (simulated here as prompt-side convention).
7. **Explicit capability evidence for instances** — read-only constraint has no production carrier.
8. **Strategy extension surface** — rest/resume selection/disposition over the same gate needs a config/event seam; today nothing wakes on "task/capacity change" short of the drain loop.

## 5. Remaining decisions for production planning

- Lease storage shape for ownerEpoch/strategyVersion (coordination_runs extension vs new fleet table) — needs Robin + schema design (additive-only).
- Whether `orchestrator`'s binding (`purpose`) becomes a persisted column or remains a config-side annotation at V1.
- Wake semantics: replace the 2000 ms drain poll with receipt-triggered wake, or keep the poll and only add dedup? (Cutover risk for loops promoted by long-lived processes.)
- Cutover window and spec-id migration constraints remain with Robin (0828 §4 unchanged: preserve current spec IDs through V1).
- Verified-workflow-outcome definition for a real coding agent (what receipt format counts as "verified" is a later product contract; this prototype only asserts the distinct-from-exit gate).
