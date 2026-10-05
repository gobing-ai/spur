---
schema_version: 1
name: Make fleet members drain their inbox and let the orchestrator converse
status: done
template: feature-impl
created_at: 2026-10-04T20:30:36.790Z
updated_at: "2026-10-05T18:22:32.282Z"
feature_id: G71

dependencies: ["1073"]
priority: P1
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1074-verdict.json
---

## 1074. Make fleet members drain their inbox and let the orchestrator converse

### Background

Implements G71 R3 and R4 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 2 and 4; decisions D1, D2, D4).

Verified state (2026-10-04):

- C1: when a fleet is declared, member loops never drain; they only `recordIdleHold` (`packages/app/src/services/agent-loop-service.ts:371`, `:413`, `:475`). Messages to members and to the orchestrator are never consumed.
- The drain path already exists: `drainPending` → `MemberSession` → `settleDelivered`/`releasePending`/`settleFailed`; `drainIntoPrompt` builds the "Pending messages:" block and threads `requestMessage` into `executeRun` (`apps/cli/src/commands/agent.ts` ~885–925; `delivery-reconciler.ts`).
- `coordination_runs` has no `session_id` column (`packages/domain/src/migrations.ts:167`); the run→agent-session mapping is `history_run_session` (`:220`, ADR-059).
- The resume session id is known only after the first drain (`member-session.ts:168`, `:310`).

**Refine corrections (2026-10-04)**

- R3 says to join `coordination_runs` with `history_run_session`. In reality, `MemberSession.recordDrain` already persists the exact resume id as `fleet.member-session` ledger rows (`packages/domain/src/dao/member-session.ts` `recordMemberSession`/`readMemberSessions`). The id is lost because the loop `finally` calls `memberSession.reset('operator')`, which writes a reset row that clears it → seed `start()` from `readMemberSessions` and reset on shutdown only in persistent mode. The "last exact session id" semantics are the same, with no join.
- Deleting the bypass alone breaks member drains: the fleet `--spec-id` guard (`agent-service.ts:1024-1042`) refuses any `spec-id` run without `beforeDispatch`, and `drainIntoPrompt` always sets `spec-id`, so drains would exit 2 → 1074 limits the refusal to runs with no drained `requestMessage` ids. 1075 deletes the branch.
- Persistent members settle on stdin acceptance and write no `coordination_runs` row (`agent-loop-service.ts:427-449`), so 1073's receipts could never complete → a drained batch carrying a dispatch key runs through `svc.run` even for a persistent member. Unkeyed conversational messages keep the stdin path.
- R4 needs no sender work: `spur message send` defaults `--from operator` (`apps/cli/src/commands/message.ts:21`), so operator messages are replyable.

### Requirements

- [x] R1. Delete the fleet bypass at `agent-loop-service.ts:371`: every member loop takes the drain → `MemberSession` → settle path; a drained batch carrying a dispatch key runs through `svc.run` (a `coordination_runs` receipt) even for a persistent member, and the fleet `--spec-id` guard admits runs carrying drained `requestMessage` ids.
- [x] R2. While a drained run carrying a dispatch key is live, the member heartbeats the write slot claimed for it (D4); TTL expiry stays with the reconciler.
- [x] R3. On loop start a resume-mode member seeds its session id from its latest `fleet.member-session` ledger observation (the exact id captured from its last drain); loop shutdown resets only persistent sessions, so a restart resumes the same conversation.
- [x] R4. The orchestrator loop drains its own inbox before the strategy tick on each wake and answers through `replyToMessage`; the LLM never decides dispatch (D2).

### Acceptance Criteria

- [x] AC1 — Members drain their inbox and hold the write slot
- [x] AC2 — The orchestrator converses through its inbox

Task-local verification:

- A member loop with a pending keyed message drains, executes and settles it; the slot heartbeat renews while the run is live.
- A restarted member loop resumes the session id recorded for its last exact run.
- An operator message to the orchestrator is replied to before the tick runs.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:00.332Z

- **Q: How does the orchestrator answer without an LLM deciding dispatch?** A: Its drain uses the member drain path with its planner executor. The prompt block tells it to answer each pending message with `spur message reply <id> <answer>` and not to dispatch tasks. Dispatch stays in the deterministic `strategy.tick`, which runs after the drain settles on the same wake.
- **Q: Which drains heartbeat the write slot?** A: Only a batch containing a `fleet:task:*` key. Workflow keys (`<runId>/<state>`) don't claim the write slot today.
- **Q: Which heartbeat identity is used?** A: `ProjectClaimDao.heartbeat(projectPath, 'write', memberInstanceId, WRITE_SLOT_TTL_MS, ownerEpoch)`, with `ownerEpoch` read from the current claim row (`get`). If the holder is someone else, the member stops heartbeating (it is fenced out) and lets the run finish. Result validation belongs to the orchestrator (1073 `observe`).
- **Q: What happens to a persistent member's session on restart?** A: The process is the session, so it resets on shutdown as today. A resume-mode id survives restarts. A one-shot member never seeds.
- **Q: Where does a keyed dispatch run for a persistent member?** A: Through the run path. That is the only path that writes the receipt 1073 waits on.

### Design

**Bypass removal** (`agent-loop-service.ts:371-416`)
- Members no longer short-circuit on `fleet.load() !== null`. Every non-owner iteration takes the drain path at `:419-476`.
- Owner wake order: drain its own inbox → settle → `runtime.observe` → `runtime.tick` (from 1073).

**Keyed batches bypass stdin.** In the drain path, `const keyed = claimed.some((e) => e.requestKey != null)`. When `keyed` is true, use the `svc.run(prompt, drainFlags, runDeps)` branch even when `memberSession.mode === 'persistent'`, so the run writes `coordination_runs` with `message_ids_json` as the receipt. Unkeyed batches keep `process.send`.

**Guard** (`agent-service.ts:1024-1042`). Keep the fleet spec lookup and `assertLaunchGroundTruth`. The `beforeDispatch === undefined` refusal applies only when `requestMessageIds.length === 0` (ids from `:1232`); drained runs always carry ids. 1075 deletes the branch.

**Member heartbeat.** When a claimed `requestKey` starts with `fleet:task:`:
- start a `setInterval(WRITE_SLOT_TTL_MS/3)` heartbeat (identity per the Q&A) around `svc.run`, cleared in `finally`
- the 1073 orchestrator interval stops on its own once the receipt row is `running`

**Resume seeding** (`packages/app/src/services/member-session.ts`)
- `start(spec)` calls `readMemberSessions(db, [instanceId])`. When the resolved mode is `resume` and the latest observation has an `id`, it sets `this.id`, and the next drain passes `session-id`.
- The loop `finally` calls `memberSession.reset('operator')` only when `mode === 'persistent'`.

**Orchestrator inbox.** Same drain with recipient = the orchestrator instance id. Append one line to the prompt block: `Answer each message with \`spur message reply <id> <answer>\`; do not dispatch or edit tasks.`

**Tests to update:**
- `packages/app/tests/services/{agent-loop-service,member-session}.test.ts`
- `apps/cli/tests/commands/{agent-loop-wake,agent-loop-member-session}.test.ts`
- the agent-service guard test (locate with `rg -l "owning orchestrator loop" packages/app/tests`)

### Plan

1. Write the failure list first as tests:
   - a member drain is refused by the guard
   - a keyed batch on a persistent member writes no receipt
   - the slot is not renewed past the TTL
   - the resume id is lost on restart
   - the tick runs before the orchestrator's reply
2. Relax the guard at `agent-service.ts:1039` to admit runs with drained `requestMessage` ids.
3. Delete the fleet bypass and route members through the drain path; send keyed batches through `svc.run`.
4. Add the keyed member heartbeat around the run.
5. Seed `MemberSession.start` from the ledger; make the loop `finally` reset only in persistent mode.
6. Owner: drain its own inbox before `observe`/`tick`, with the reply instruction.
7. Scenario tests (fake clock):
   - a member drains a keyed message, then executes and settles it; the heartbeat renews
   - a restart resumes the ledger id
   - an operator message is answered before the tick
8. Gates:
   - `(cd packages/app && bun test tests/services/agent-loop-service.test.ts tests/services/member-session.test.ts)`
   - `(cd apps/cli && bun test tests/commands/agent-loop-wake.test.ts tests/commands/agent-loop-member-session.test.ts)`
   - `bun run spur-check`

### Solution

Fleet members now consume their inbox, and the orchestrator converses through its own (R1–R4).

**The bypass is gone (R1).** The loop's `if (fleet.load() !== null)` short-circuit — which made every
member of a declared fleet `recordIdleHold` forever without ever draining (C1) — is deleted. There is
now one drain pass, `runDrain`, shared by the orchestrator and its members: drain → execute → settle →
`recordDrain`. The orchestrator's wake order is drain its own inbox, then `observe`, then `tick` (R4),
so answers are sent before dispatch; the reply instruction is appended to its prompt only
(`ORCHESTRATOR_REPLY_INSTRUCTION`), and dispatch stays with the deterministic `strategy.tick` — the LLM
never decides it (decision D2).

**Keyed batches take the run path (R1).** A drained batch whose claimed rows carry a `fleet:task:*`
request key runs through `svc.run` even for a persistent member, because only the run path writes the
`coordination_runs` receipt that 1073's dispatcher waits on — a stdin-accepted send writes none. The
drain result now carries `requestKeys` (`drainIntoPrompt`) so the loop can make that call; unkeyed
conversational traffic keeps the stdin path and its acceptance-is-delivery contract.

At the same time the fleet `--spec-id` guard stops refusing drained runs. The refusal is an
*orchestrator boundary* rule, not a spec-id rule: it now applies only when the run carries no
originating request ids, which is exactly the bare `agent run --spec-id` dispatch case. To express
that, `requestMessageIds` is computed before the guard instead of after it.

**The member keeps its own slot alive (R2).** While a keyed run is live, the member heartbeats the
write slot it holds — `createWriteSlotHeartbeat`, one `WRITE_SLOT_TTL_MS / 3` interval, fenced on
holder identity: if the row's holder is not this member it stops instead of fighting, so a fenced-out
member lets its run finish while the orchestrator's 1073 standby heartbeat has already stopped on the
`running` receipt. Result validation stays with the orchestrator. Unkeyed batches claim and renew no
slot at all.

**A resume conversation survives its process (R3).** `MemberSession.start` seeds a resume member from
its latest `fleet.member-session` ledger observation, and the loop's shutdown now resets only
*persistent* sessions — for a persistent member the process IS the session, while a resume id must
outlive it. Ordering was the subtle part: the mode mirror writes a fresh observation, so seeding runs
BEFORE the mirror and the mirror carries the recovered id; otherwise the mirror's id-less row becomes
the newest observation and hides the very id the seeding exists to recover.

Loops and the orchestrator both drain; the deterministic tick still owns dispatch, and no member work
runs inside the orchestrator process.

| Change | Anchor |
| --- | --- |
| One drain pass shared by members and the orchestrator (drain → run/stdin → settle → recordDrain) | `packages/app/src/services/agent-loop-service.ts:423` |
| Keyed batches (`fleet:task:*`) take the run path so the receipt exists | `packages/app/src/services/agent-loop-service.ts:431` |
| Orchestrator wake order: drain + reply, then observe, then tick | `packages/app/src/services/agent-loop-service.ts:497` |
| Every member loop drains — the fleet bypass is deleted | `packages/app/src/services/agent-loop-service.ts:525` |
| Reply instruction (prose answer, no dispatch by the LLM) | `packages/app/src/services/agent-loop-service.ts:63` |
| Member-side write-slot heartbeat, fenced on holder identity | `packages/app/src/services/agent-loop-service.ts:27` |
| Shutdown resets only a persistent session | `packages/app/src/services/agent-loop-service.ts:538` |
| Shared `fleet:task:` prefix constant | `packages/app/src/services/strategy-runtime.ts:42` |
| Guard admits a drained run; refusal only without originating ids | `packages/app/src/services/agent-service.ts:1053` |
| Request ids resolved before the guard | `packages/app/src/services/agent-service.ts:1028` |
| Resume id seeded from the ledger before the mode mirror | `packages/app/src/services/member-session.ts:244` |
| Drain result carries the claimed rows' request keys | `apps/cli/src/commands/agent.ts:931` |

Tests: `packages/app/tests/services/agent-loop-service.test.ts` (member drains and settles; keyed batch
bypasses stdin; unkeyed batch claims no slot; heartbeat renews a held slot and stops when fenced;
shutdown leaves a resume session alone), `packages/app/tests/services/member-session.test.ts` (resume
seeding, reset clears the seed, no-observation start), the guard case in
`packages/app/tests/services/agent-service.test.ts`, and the two CLI traces updated to the new
contract (`agent-loop-wake`, `agent-loop-member-session`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The fleet bypass is deleted, so every member loop drains and settles its inbox (`packages/app/src/services/agent-loop-service.ts:525`); a batch carrying a `fleet:task:*` key runs through `svc.run` even for a persistent member (`packages/app/src/services/agent-loop-service.ts:431`) because only that path writes the receipt 1073 waits on; the fleet `--spec-id` guard admits a drained run, keeping the refusal only for a dispatch with no originating ids (`packages/app/src/services/agent-service.ts:1053`, ids resolved before it at `:1028`). Tests: "R1: a fleet member drains its inbox and settles the run instead of only holding", "R1: a keyed batch runs through the run path even for a persistent member", and the guard case in `packages/app/tests/services/agent-service.test.ts` |
| R2 | MET | `createWriteSlotHeartbeat` renews the held write slot while a keyed run is live, fenced on holder identity (`packages/app/src/services/agent-loop-service.ts:27`). Tests: "R2: the member heartbeat renews the held slot and stops when it is fenced out" and "R1: an unkeyed conversational batch claims and renews no write slot" |
| R3 | MET | A resume member seeds its session id from its latest `fleet.member-session` ledger observation, before the mode mirror (`packages/app/src/services/member-session.ts:244`), and loop shutdown resets only a persistent session (`packages/app/src/services/agent-loop-service.ts:538`). Tests: "start seeds a resume member with the exact id its last drain recorded", "a deliberate reset clears the seed", "an unreadable ledger starts the resume member without an id", and the CLI traces "G71 R3: loop shutdown leaves a resume session alone" / "resume mode mirrors { mode, id } mid-loop and keeps the id across shutdown" |
| R4 | MET | The orchestrator's wake order is drain its own inbox (with the reply instruction) then `observe` then the deterministic `tick` (`packages/app/src/services/agent-loop-service.ts:497`, instruction at `packages/app/src/services/agent-loop-service.ts:63`); a throwing drain is logged and cannot stop the loop. Tests in `packages/app/tests/services/agent-loop-service.test.ts` and the CLI trace asserting the orchestrator's only dispatch effect is the keyed inbox row with `runTraced` replaced by a throwing stub |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Members drain their inbox and hold the write slot | MET | test | `packages/app/tests/services/agent-loop-service.test.ts` drains a member's claimed row and settles it as delivered (no idle hold written), routes a keyed batch through the run path, and renews the held slot from the member's own heartbeat |
| AC2 — The orchestrator converses through its inbox | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts` and `agent-loop-member-session.test.ts` exercise the orchestrator drain path with the reply instruction, and the drain-guard test proves the tick still runs when the drain itself fails |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of the 1074 diff (10 files: the loop's bypass removal and shared drain pass, the member heartbeat,
the resume seed, the relaxed fleet guard, and the adapted suites). Dimensions: functional traceability
(R1–R4), SECUA, architecture depth.

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P2 (major) | The orchestrator's own drain now runs inside the owner branch, which it never did before. A throwing `deps.drain` (unreadable inbox, DB error) would therefore propagate out of the wake loop and terminate the orchestrator — stopping dispatch for the whole project until restarted. Newly reachable, not previously possible. | Fixed before verify: the owner's drain is wrapped so a failure is logged and the wake loop survives (the deterministic tick still runs, and the next wake retries). Pinned by `packages/app/tests/services/agent-loop-service.test.ts` "R4: a throwing orchestrator drain is logged and does not take the dispatch loop down". |
| P3 (minor) | `requestKeys` is optional on the drain result, so a future caller that omits it routes a `fleet:task:*` batch down the stdin path — stdin writes no `coordination_runs` receipt, and 1073's dispatcher would wait out its budget to `outcome-unknown`. | Accepted: the CLI's `drainIntoPrompt` always sets it (asserted by the CLI traces), and `outcome-unknown` is the non-destructive failure (no double execution). Documented at the field. |
| P3 (minor) | `createWriteSlotHeartbeat` schedules async work per tick; a `stop()` during an in-flight tick can allow one further renewal. | Accepted: the extra renewal is bounded by one interval and the slot expires on its own; the alternative (awaiting in-flight renewals on a synchronous stop) buys nothing. |
| P3 (minor) | Two G62 CLI assertions were relaxed from "the queued message stays queued" to "the message is no longer queued", because members now drain. | Intent preserved: both tests still assert that no `fleet:task:*` dispatch was enqueued for anyone, which is the actual no-dispatch guarantee those tests exist to protect. The old assertion was a proxy that the redesign invalidates. |
| P4 (advisory) | `ORCHESTRATOR_REPLY_INSTRUCTION` is prose guidance to a model, so the orchestrator may fail to answer a message. | Accepted and harmless by construction: dispatch is the deterministic tick, so ignoring the instruction cannot start or change work — it only leaves a message unanswered, which the next drain retries. |
| P4 (advisory) | Resume seeding fails open: an unreadable ledger starts the member id-less (a fresh session) rather than refusing to drain. | Accepted: refusing to serve a member because an observability read failed is worse than starting a new conversation, and the seed is a convenience over the durable `fleet.member-session` row. |

No open P1; the single P2 was repaired inside the reviewed diff.

## Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 every member loop drains; a keyed batch runs through `svc.run` even for a persistent member; the fleet `--spec-id` guard admits runs carrying drained `requestMessage` ids | MET | the bypass is deleted (`packages/app/src/services/agent-loop-service.ts:525`); keyed routing (`agent-loop-service.ts:431`); guard relaxation (`packages/app/src/services/agent-service.ts:1053`) with ids resolved before it (`:1028`); tests "R1: a fleet member drains its inbox and settles the run instead of only holding", "R1: a keyed batch runs through the run path even for a persistent member", and the guard case in `tests/services/agent-service.test.ts` |
| R2 the member heartbeats the write slot claimed for it while a keyed run is live | MET | `packages/app/src/services/agent-loop-service.ts:27`; tests "R2: the member heartbeat renews the held slot and stops when it is fenced out", "R1: an unkeyed conversational batch claims and renews no write slot" |
| R3 a resume member seeds its session id from `fleet.member-session`; shutdown resets only persistent sessions | MET | `packages/app/src/services/member-session.ts:244` (seeded before the mode mirror); `agent-loop-service.ts:538`; tests "start seeds a resume member with the exact id its last drain recorded", "a deliberate reset clears the seed", plus the CLI traces "G71 R3: loop shutdown leaves a resume session alone" and "resume mode mirrors { mode, id } mid-loop and keeps the id across shutdown" |
| R4 the orchestrator drains and answers before the tick; the LLM never decides dispatch | MET | owner order `agent-loop-service.ts:497`; instruction `agent-loop-service.ts:63`; CLI test asserts the orchestrator's effect is the keyed inbox row with a throwing `runTraced`, and the drain-guard test asserts the tick still runs |

## Architecture depth

The bypass deletion makes the loop *smaller* at the point where it was special-casing a project shape:
one drain pass now serves the orchestrator and every member, and the only branch left is who ticks after
it. The heartbeat is an exported factory rather than a closure because it is the one piece the loop's
clock-owning wake wait cannot exercise (the alternative was an untestable interval). No new module, no
new configuration, and the stdin path's 0831 acceptance semantics are untouched for unkeyed traffic.

## Residual risk

- The member drain path itself is unchanged; what changed is which loops reach it. A live end-to-end
  member drain against a real agent binary is still 1077's job.
- Member heartbeat and orchestrator standby heartbeat overlap deliberately for the moment between
  enqueue and the member's `running` receipt; both are fenced on holder identity, so neither can renew
  a slot it does not hold.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:39.393Z backlog → todo (system)
- 2026-10-05T04:07:49.928Z todo → wip (system)
- 2026-10-05T04:20:40.947Z wip → testing (system)
- 2026-10-05T04:20:54.882Z testing → done (system)

