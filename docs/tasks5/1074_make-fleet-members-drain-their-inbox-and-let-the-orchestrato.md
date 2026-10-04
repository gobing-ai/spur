---
schema_version: 1
name: Make fleet members drain their inbox and let the orchestrator converse
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:36.790Z
updated_at: "2026-10-04T20:57:39.393Z"
feature_id: G71

dependencies: ["1073"]
priority: P1
estimate_hours: 6
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

- [ ] R1. Delete the fleet bypass at `agent-loop-service.ts:371`: every member loop takes the drain → `MemberSession` → settle path; a drained batch carrying a dispatch key runs through `svc.run` (a `coordination_runs` receipt) even for a persistent member, and the fleet `--spec-id` guard admits runs carrying drained `requestMessage` ids.
- [ ] R2. While a drained run carrying a dispatch key is live, the member heartbeats the write slot claimed for it (D4); TTL expiry stays with the reconciler.
- [ ] R3. On loop start a resume-mode member seeds its session id from its latest `fleet.member-session` ledger observation (the exact id captured from its last drain); loop shutdown resets only persistent sessions, so a restart resumes the same conversation.
- [ ] R4. The orchestrator loop drains its own inbox before the strategy tick on each wake and answers through `replyToMessage`; the LLM never decides dispatch (D2).

### Acceptance Criteria

- [ ] AC1 — Members drain their inbox and hold the write slot
- [ ] AC2 — The orchestrator converses through its inbox

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:39.393Z backlog → todo (system)

