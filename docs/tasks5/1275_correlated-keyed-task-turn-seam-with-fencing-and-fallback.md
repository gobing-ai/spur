---
schema_version: 1
name: Correlated keyed task-turn seam with fencing and fallback
status: done
template: feature-impl
created_at: 2026-10-22T07:00:34.912Z
updated_at: "2026-10-23T01:19:49.766Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

dependencies: ["1273", "1284"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1275-verdict.json
---

## 1275. Correlated keyed task-turn seam with fencing and fallback

### Background

Implements: R6 — Warm process reuse preserves independent review and executor policy; R7 — Uncertain accepted work is reconciled without duplicate side effects; R8 — Unsupported capabilities retain an explicit compatible fallback.
Work packages E2 (Spur side) + E6. Design: docs/design/fleet-task-turn-execution.md §3-5; ADR-145.
Prerequisite: a released ts-ai-runner correlated-turn facade. Inspect the installed package first; if insufficient, record the exact upstream contract and leave this task blocked — external ts-libs edits need separate operator authorization.
Rubric: E14 D1 L3 C2 R2 = 22 → decompose (force: R=high); this is the shared seam, adapters are separate tasks.

**Refine corrections (2026-10-22)**
- Claim "inspect the installed package; if insufficient leave blocked — ts-libs edits need separate authorization" → reality: installed `@gobing-ai/ts-ai-runner@0.5.33` has no correlated turn facade (see 1284 Background). Robin authorized ts-libs edits on 2026-10-22 ("Edit ts-libs, you release"). → resolution: the facade is task **1284** (new dependency of this task); this task starts after Robin publishes `0.6.0` and begins by bumping the catalog.
- Claim "plug into the keyed branch of runDrain" → reality: the keyed drain (`agent-loop-service.ts:480`, heartbeat `:512`) calls `runFleetWorkItem` (`packages/app/src/workflow/fleet-work-item.ts:63`) → `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts:237`) → `AgentRunExecutor` whose single dispatch point is `runner.runPromptCommand(...)` at `packages/app/src/services/agent-run-executor.ts:613` (`beforeDispatch` hook `:599`, runner `deps?.runner ?? new AiRunner` `:243`). → resolution: one optional `AgentExecutionOptions.dispatchTurn` seam (`packages/app/src/observability/agent-execution.ts:146`) replaces `runPromptCommand` only when eligible.
- Claim "independent review always starts fresh" → reality: already a policy constant, `FRESH_SESSION_ROLES = ['reviewer']` (`packages/app/src/workflow/fleet-dispatch.ts:70`, ADR-121, used `:105`). → resolution: reuse it; no second list.
- Outcome vocabulary already exists: `ReceiptOutcome = 'done' | 'failed' | 'not-started' | 'outcome-unknown' | 'contract-violation'` (`packages/app/src/workflow/receipt.ts:42`); `agent-run.ts:477` maps fleet `outcome-unknown` to the resumable `interrupted` reason (G71 R2); `DeliveryReconciler` (`packages/app/src/services/delivery-reconciler.ts:51`, `HoldReason` `:9`) and the strategy hold (`strategy-runtime.ts:668–690`) already hold dispatch on ambiguous `fleet:task:*` deliveries. → resolution: map turn outcomes onto these; add no parallel uncertainty state.
- `MemberSession` (`packages/app/src/services/member-session.ts:181`, modes `persistent | resume | one-shot` `:31`) is the per-member session owner; `selectsPersistentStdinDispatch` (`:75`) is today's input-only persistent mode.

### Requirements

- [x] R1. Route keyed requests for a persistent member through a correlated turn on a policy-compatible warm worker, dispatched via AgentRunActionRunner/runFleetWorkItem so artifact and action-contract checks stay the sole success authority.
- [x] R2. Persist acceptance, native terminal outcome (success/failure/interrupted/not-started/outcome-unknown) and validated completion separately, pinned to execution, request, attempt, member, owner epoch and occupant generation.
- [x] R3. Reuse a worker only when model/provider/reasoning, tools, permissions, workspace and role match (`policyDigest`); roles in `FRESH_SESSION_ROLES` always start a fresh conversation.
- [x] R4. Outcome-unknown writing work stays uncertain until durable evidence resolves it; late/foreign/stale-generation events are diagnostic only and never certify success or release a new write lease.
- [x] R5. Before acceptance, an unsupported agent, unqualified version or failed open falls back to verified resume then one-shot with a named reason; after acceptance there is no fallback; no transport/protocol code enters Spur (it lives in ts-ai-runner, task 1284).

### Acceptance Criteria

```gherkin
Scenario: AC1 — Two keyed tasks reuse one warm worker and validate through the action contract (req: R1, R2)
  Given a persistent member backed by the ts-ai-runner fake turn driver (`@gobing-ai/ts-ai-runner/testing`)
  When two keyed tasks drain serially
  Then both run in one child process, each receipt records mode `warm`, acceptedAt, native outcome and the action-contract verdict separately, and a native `success` whose expected artifact is missing ends `contract-violation`

Scenario: AC2 — Policy change and fresh roles never reuse (req: R3)
  Given a warm worker for role coder
  When the next keyed task changes model or permissions, or targets role reviewer
  Then the old session is closed and a new one opened for the policy change, and the reviewer runs fresh with fallback reason `fresh-role`

Scenario: AC3 — Accepted-then-crash stays uncertain (req: R4)
  Given the fake child exits after acceptance on a writing task
  When the drain settles
  Then the receipt outcome is `outcome-unknown`, the strategy hold keeps new dispatch for that request, no automatic retry runs, and a later terminal from that dead attempt is recorded only as diagnostic

Scenario: AC4 — Stale generation events cannot certify (req: R4)
  Given a turn from occupant generation N
  When a terminal success tagged with generation N-1 or a foreign requestId arrives
  Then it is logged as diagnostic and the current turn's outcome is unchanged

Scenario: AC5 — Pre-acceptance fallback is named and single (req: R5)
  Given openTurnSession refuses with `unsupported-agent`, `unqualified-version` or `spawn-failed`, or the turn ends `not-started`
  When the task dispatches
  Then it runs through the existing resume or one-shot path exactly once and the receipt names the fallback reason
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:38.971Z

- **Q: Wait for the facade or build it here?** CLOSED — facade is 1284 (ts-libs). Step 0 here bumps root `workspaces.catalog` `@gobing-ai/ts-ai-runner` to the released `0.6.0` (Robin publishes). If 0.6.0 is not on npm yet, this task is blocked — do not vendor or link a local copy.
- **Q: Where does eligibility live?** CLOSED — new `packages/app/src/services/warm-turn-dispatch.ts`; `MemberSession` owns the open `TurnSession` lifetime (open on first eligible keyed drain, close on policy change, reset reasons `:40`, loop shutdown `:627`).
- **Q: Schema migration for receipt fields?** CLOSED — no; turn fields ride the existing `WorkItemReceipt`/run lifecycle payload. A migration needs justification in Solution.
- **Q: Retry outcome-unknown read-only work?** CLOSED — no auto retry in this task for any role; reconciliation uses the existing `DeliveryReconciler` + strategy hold. Read-only auto-retry is deferred until 1273 shows it matters.
- **Q: Unkeyed persistent-stdin messages?** CLOSED — unchanged (`agent-loop-service.ts:486`, "acceptance is delivery", 0831).

#### Q&A entry — 2026-10-22T23:16Z (batch run block)

- **Q: Can the task start?** BLOCKED — Plan step 0 fails: `npm view @gobing-ai/ts-ai-runner version` returns **0.5.33**; 0.6.0 is not published. Per the closed Q&A decision (2026-10-22T16:25:38Z): if 0.6.0 is not on npm, the task is blocked — no vendoring, no local linking. Unblocking action (Robin): publish ts-libs 0.6.0 from `/Users/robin/xprojects/ts-libs` (committed, gate-green, untagged), then re-run this task plus 1276–1278 (which depend on it).

### Design

**Seam (frozen):** `AgentExecutionOptions.dispatchTurn?: (req: WarmTurnRequest) => Promise<WarmTurnDispatch>` in `packages/app/src/observability/agent-execution.ts:146`.
```ts
export interface WarmTurnRequest { agent: string; prompt: string; cwd: string; role: string; policy: TurnSessionPolicy; correlation: TurnCorrelation; memberId: string; ownerEpoch: number; occupantGeneration: number; signal?: AbortSignal; onOutput?: (chunk: string) => void }
export type WarmFallbackReason = 'unsupported-agent' | 'unqualified-version' | 'spawn-failed' | 'handshake-failed' | 'fresh-role' | 'not-started';
export type WarmTurnDispatch = { kind: 'warm'; outcome: TurnOutcome } | { kind: 'fallback'; reason: WarmFallbackReason; detail?: string };
```
At `agent-run-executor.ts:613`: if `options.dispatchTurn` is set, call it; `warm` → map the outcome; `fallback` → record the reason and run today's `runPromptCommand` path (resume when `MemberSession` has a resume id, else one-shot). Exactly one fallback attempt.

**Threading:** keyed `runDrain` (`agent-loop-service.ts:480`) builds `dispatchTurn` from `createWarmTurnDispatcher({ runner, session: MemberSession, freshRoles: FRESH_SESSION_ROLES })` → passes through `runFleetWorkItem` (`fleet-work-item.ts:63`) → `AgentRunActionRunner` (`agent-run.ts:237`) → `executeRun` options (as `beforeDispatch` is passed at `agent-run.ts:1147`).

**Outcome mapping → `ReceiptOutcome` (`receipt.ts:42`):** success → run the action contract; pass = `done`, fail = `contract-violation` · failure → `failed` · interrupted → `failed` with reason `interrupted` · not-started → fallback (`not-started`) · outcome-unknown → `outcome-unknown` (existing `agent-run.ts:477` path, resumable `interrupted` classifier) · runner `contract-violation` → `contract-violation`.

**Receipt fields (added to the existing receipt/lifecycle payload):** `turn: { mode: 'warm'|'resume'|'one-shot', fallbackReason?, policyDigest, acceptedAt?, nativeOutcome?, nativeSessionId?, nativeTurnId?, requestId, attempt, memberId, ownerEpoch, occupantGeneration }`.

**Fencing:** before acting on any turn event, compare `{requestId, attempt, ownerEpoch, occupantGeneration}` with the current drain; mismatch → diagnostic system event `fleet.turn.stale`; never certifies, never releases the write lease.

**Files:** `packages/app/src/services/warm-turn-dispatch.ts` (new), `member-session.ts`, `agent-loop-service.ts`, `agent-run-executor.ts`, `agent-service.ts`, `event-names.ts`, `observability/agent-execution.ts`, `workflow/fleet-work-item.ts`, `workflow/actions/agent-run.ts`, `workflow/fleet-dispatch.ts`, root `package.json` + `bun.lock` catalog (^0.6.0 lockstep), `patches/@gobing-ai%2Fts-db@0.6.0.patch` (re-targeted; the 0.5.33 file is a rename, not a second patch), `patches/@gobing-ai%2Fts-db@0.5.33.patch` (deleted by that rename) + `patches/README.md`, `docs/design/event-tracking.md` (§11 rows). Tests: `packages/app/tests/services/warm-turn-dispatch.test.ts` (new; E2E over the real fake child driver from `@gobing-ai/ts-ai-runner/testing`), `tests/services/member-session-warm.test.ts` (new; slot lifetime), `tests/services/member-session.test.ts` (harness reuse).
**Rejected:** direct stdin reuse (acceptance ≠ completion); a persistent workflow executor; vendoring runner code; a second fresh-role list.
**Invariants:** one active turn per worker; one writer per worktree; durable inbox is the only coordination transport.
**Handoff:** 1276–1278 only register drivers in ts-libs + qualify; no Spur changes beyond capability evidence and receipt rows. 1282 reuses `dispatchTurn` with the attached-member pin.

### Plan

0. Confirm `@gobing-ai/ts-ai-runner@0.6.0` exists on npm (`bun pm view @gobing-ai/ts-ai-runner version`); bump the catalog; `bun install`. Not published → stop, report blocked on Robin's release.
1. Failure cases first, as tests in `warm-turn-dispatch.test.ts`: accepted-then-crash; duplicate terminal; stale generation; foreign requestId; policy change; fresh role; unsupported agent; unqualified version; not-started; native success + missing artifact; quota refusal before acceptance; permission wait past timeout → outcome-unknown.
2. Seam types in `agent-execution.ts`; branch at `agent-run-executor.ts:613`.
3. `warm-turn-dispatch.ts` + `MemberSession` session lifetime; thread through drain → runFleetWorkItem → AgentRunActionRunner.
4. Receipt fields + fencing + diagnostic event.
5. Make all failure tests pass over the real fake child process; add a warm row to `fleet-e2e --perf` (1273) using the fake driver.
6. Focused: `(cd packages/app && bun test tests/services/warm-turn-dispatch.test.ts tests/services/agent-loop-service.test.ts)`; then `bun run spur-check`.

**Step 5 status (2026-10-23):** the failure tests over the real fake child process are done (step 1 + step 5 first half). The `fleet-e2e --perf` warm row is **deliberately deferred**: the perf lane drives real agent binaries and `TURN_SESSION_DRIVERS` is "Empty in 0.x by design", so a warm trial today records only the `unsupported-agent` fallback. It lands with driver registration/qualification in 1276–1278 (this task's Handoff). Step 6's targeted probes are green; the repo-wide gate belongs to the pipeline `gate` state.

### Solution

One decision, one owner: `packages/app/src/services/warm-turn-dispatch.ts` decides whether a keyed request may reuse the warm worker; everything else threads the decision in.

- **Dispatcher** — built fresh per drain at `packages/app/src/services/agent-loop-service.ts:584` around a loop-lifetime `memberSession` holding one optional warm `TurnSession`. `dispatch(request)` (`packages/app/src/services/warm-turn-dispatch.ts:101`): fresh-role guard (ADR-121) → agent support → version qualification → existing-session reuse (`openCalls` stays 1 across keyed requests) → spawn + handshake on first use. Outcomes are `TurnOutcome`s from `@gobing-ai/ts-ai-runner` 0.6.0 (`success` | `interrupted` | `not-started` | `outcome-unknown` | `contract-violation`); pre-acceptance refusals are named `WarmFallbackReason`s (`unsupported-agent`, `unqualified-version`, `spawn-failed`, `handshake-failed`, `fresh-role`, `not-started`). Fencing (`fleet.turn.stale` diagnostics) is evidence only — it never certifies a run (R4).
- **Session lifecycle** — `packages/app/src/services/member-session.ts:372` `adoptTurnSession`, `packages/app/src/services/member-session.ts:378` `closeTurnSession` (idempotent, tolerates a rejecting close), `turnSession`/`turnBinding`/`hasLiveState` accessors; `reset()` closes the warm worker too.
- **Threading (`agent-loop-service.ts`)** — `turnGeneration` pinned once per loop lifetime; keyed drains build the per-drain dispatcher (`runDeps.runner` present → `openSession(agent: string, policy)`; the single real-runner call site casts to `AgentName` with a SAFETY note — the dispatcher itself is agent-name-agnostic). Shutdown calls `closeTurnSession()` best-effort.
- **Executor seam** — `packages/app/src/observability/agent-execution.ts:211` `AgentExecutionOptions.dispatchTurn`; `AgentRunExecutor` (`packages/app/src/services/agent-run-executor.ts:157`) consults it before spawning; a `warm` terminal maps through `warmResult`: native success → exit 0 (the expectFile/answerFile contract stays the sole success authority, so a success missing its artifact still ends `contract-violation`), `outcome-unknown` → exit 3 + `TURN_OUTCOME_UNKNOWN_SIGNAL` (R7 reconcile path), `interrupted` → exit 3 + `interrupted` signal, other → exit 3. A `fallback` continues on today's path exactly once (R5); after acceptance there is no fallback at all.
- **Deps bag (`agent-service.ts`)** — `AgentRunDeps.dispatchTurn` is the one value that reaches `executeRun` unchanged from the loop; `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts:1150`) forwards it onto `AgentExecutionOptions.dispatchTurn`. No member-detail or CLI surface changed — the loop is the only producer.
- **Correlation + receipts (`agent-run.ts`, `fleet-work-item.ts`, `event-names.ts`)** — one `(runId, executionId, requestId, attempt)` per keyed run (`requestId` = the inbox message id, carried as `message-id`); per-drain `turn` receipt (`TurnReceipt`) projected into the work-item result `data`; a fallback
  receipt names the path the executor really takes — `resume` when the member holds a resume id
  (`MemberSession.resumeId()`), else `one-shot` — so `mode` is never a guess; `fleet.phase.turn-settled` joins the phase timeline; `fleet.turn.stale` is the diagnostic sink.
- **Lockstep** — all 12 `@gobing-ai/ts-*` deps bump `^0.5.0` → `^0.6.0` (EventBus is nominally typed); `ts-db` stays patched (re-targeted `@gobing-ai%2Fts-db@0.6.0.patch`).
- **Deliberately not done** — Plan step 5's `fleet-e2e --perf` warm row. The perf lane drives real agent binaries and `TURN_SESSION_DRIVERS` is "Empty in 0.x by design" (`node_modules/@gobing-ai/ts-ai-runner/dist/turn-session.d.ts:165`), so a warm trial today would measure only the `unsupported-agent` fallback. Warm measurement lands with driver registration/qualification in 1276–1278, exactly as this task's Handoff states; warm evidence in this task is the fake-driver E2E in `packages/app/tests/services/warm-turn-dispatch.test.ts`.

- **Seam shape (deviation from the frozen Design, deliberate)** — the Design froze `dispatchTurn(req: WarmTurnRequest)` with `policy`/`memberId`/`ownerEpoch`/`occupantGeneration` on the request. Implemented as `dispatchTurn(context: WarmTurnContext)` (`packages/app/src/observability/agent-execution.ts:163`) because the constructor of those four values is the *dispatcher*, not the executor: the executor owns no member, epoch or generation. The dispatcher pins them (`WarmTurnDispatcherDeps.binding`) and builds the `TurnSessionPolicy` itself, so there is one author per field and no unused request type.
- **R3 coverage limit (honest scope)** — `TurnSessionPolicy` can carry `provider`/`reasoning`/`tools`/`permissions`, but this side has no source for them: `PromptOptions` (`@gobing-ai/ts-ai-runner` shims) exposes only `input`/`continue`/`model`/`mode`/`purpose`/`tags`/`systemPrompt`/`taskId`/`sessionDir`/`sessionId`, and the keyed fleet path sets no permission flags — those are the agent binary's own config, which a warm worker cannot change mid-conversation either. Reuse therefore compares every field the seam can observe (`workspace`/`role`/`model`) through `turnSessionPolicyDigest`; role independence rides `FRESH_SESSION_ROLES` instead. Populating the rest becomes meaningful with driver registration in 1276–1278, not before.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/warm-turn-dispatch.ts:106-224`, `packages/app/tests/workflow/fleet-work-item.test.ts:89-146`, `packages/app/tests/services/agent-loop-service.test.ts:250-280` |
| R2 | MET | `packages/app/src/services/warm-turn-dispatch.ts:57-70`, `packages/app/tests/services/warm-turn-dispatch.test.ts:185-195`, `packages/app/tests/workflow/fleet-work-item.test.ts:138-146` |
| R3 | MET | `packages/app/src/services/warm-turn-dispatch.ts:149-165`, `packages/app/tests/services/warm-turn-dispatch.test.ts:131-137,207-220` |
| R4 | MET | `packages/app/src/services/warm-turn-dispatch.ts:135-146,177-190`, `packages/app/tests/services/warm-turn-dispatch.test.ts:240-280`, `packages/app/tests/services/agent-run-executor.test.ts:79-81` |
| R5 | MET | `packages/app/src/services/warm-turn-dispatch.ts:123-129,169,218-220`, `packages/app/src/services/agent-run-executor.ts:656-678`, `packages/app/tests/services/warm-turn-dispatch.test.ts:139-171,282-293` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Two keyed tasks reuse one warm worker and validate through the action contract (req: R1, R2) | MET | test | `packages/app/tests/services/warm-turn-dispatch.test.ts:173-205` |
| AC2 — Policy change and fresh roles never reuse (req: R3) | MET | test | `packages/app/tests/services/warm-turn-dispatch.test.ts:131-137,207-220` |
| AC3 — Accepted-then-crash stays uncertain (req: R4) | MET | test | `packages/app/tests/services/warm-turn-dispatch.test.ts:240-264` |
| AC4 — Stale generation events cannot certify (req: R4) | MET | test | `packages/app/tests/services/warm-turn-dispatch.test.ts:222-238,266-280` |
| AC5 — Pre-acceptance fallback is named and single (req: R5) | MET | test | `packages/app/tests/services/warm-turn-dispatch.test.ts:139-171,282-293` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1275
**Scope:** task 1275 diff (correlated keyed task-turn seam with fencing and fallback)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Confidence:** MEDIUM
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | Model/workspace/role policy digest covers observable fields; provider/reasoning/tools/permissions are not exposed by PromptOptions and remain pinned by binary config until driver qualification in 1276–1278 | `packages/app/src/services/warm-turn-dispatch.ts:97-103` | ACCEPTED |
| 2 | P4 (advisory) | efficiency | `fleet-e2e --perf` warm row intentionally deferred to 1276–1278 since 0.x ships with empty driver registry; warm turn execution is thoroughly verified via fake child driver E2E tests | `packages/app/tests/services/warm-turn-dispatch.test.ts:173-205` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/warm-turn-dispatch.ts:106-224` (`createWarmTurnDispatcher`), `packages/app/src/workflow/fleet-work-item.ts:153-173`, `packages/app/tests/workflow/fleet-work-item.test.ts:89-146` |
| R2 | MET | `packages/app/src/services/warm-turn-dispatch.ts:57-70` (`TurnReceipt`), `packages/app/src/workflow/fleet-work-item.ts:161-173`, `packages/app/tests/services/warm-turn-dispatch.test.ts:185-195` |
| R3 | MET | `packages/app/src/services/warm-turn-dispatch.ts:149-165` (fresh-role and policy digest checks), `packages/app/tests/services/warm-turn-dispatch.test.ts:131-137,207-220` |
| R4 | MET | `packages/app/src/services/warm-turn-dispatch.ts:177-190` (busy worker uncertainty), `:135-146` (`fence`), `packages/app/src/services/agent-run-executor.ts:79-81`, `packages/app/tests/services/warm-turn-dispatch.test.ts:240-279` |
| R5 | MET | `packages/app/src/services/warm-turn-dispatch.ts:123-129,169,218-220` (`fallback`), `packages/app/src/services/agent-run-executor.ts:656-678`, `packages/app/tests/services/warm-turn-dispatch.test.ts:139-171,282-293` |

**Next:** Ready for task completion.

### References

- Feature G74 R6–R8; design `docs/design/fleet-task-turn-execution.md` §3–5; ADR-145, ADR-121 (fresh reviewer).
- Depends on: 1284 (facade, released by Robin), 1273 (receipt driver).
- Anchors: `agent-run-executor.ts:243,599,613`; `agent-execution.ts:146`; `agent-run.ts:237,477,1147`; `fleet-work-item.ts:63`; `fleet-dispatch.ts:70,105`; `receipt.ts:42`; `delivery-reconciler.ts:9,51`; `strategy-runtime.ts:668`; `member-session.ts:31,40,75,181`; `agent-loop-service.ts:480,486,512,627`.

### History

- 2026-10-22T22:16:10.819Z todo → blocked (system)
- 2026-10-22T22:38:26.714Z blocked → todo (system)
- 2026-10-23T00:15:10.535Z todo → wip (system)
- 2026-10-23T01:19:46.706Z wip → testing (system)
- 2026-10-23T01:19:49.758Z testing → done (system)

