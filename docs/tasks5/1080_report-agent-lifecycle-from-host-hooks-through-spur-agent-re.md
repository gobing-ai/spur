---
schema_version: 1
name: Report agent lifecycle from host hooks through spur agent report
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:39.110Z
updated_at: "2026-10-04T21:07:08.956Z"
feature_id: G73

dependencies: ["1074", "1078"]
priority: P2
estimate_hours: 5
---

## 1080. Report agent lifecycle from host hooks through spur agent report

### Background

Implements G73 R1 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 item 12; herdr finding P2; decision D6, `spur agent report` consented).

herdr derives agent state from host hooks (SessionStart / UserPromptSubmit / Stop, monotonic `--seq`) rather than screen scraping (`vendors/herdr/src/integration/assets/claude/herdr-agent-state.sh`). Spur's strategy cannot tell a member blocked on a human from an idle one today. Hooks stay standalone glue (ADR-065, ADR-130) and only shell out to the CLI.

**Refine corrections (2026-10-04)**

- R4's three events can't express `blocked`. SessionStart/UserPromptSubmit/Stop give only idle/working. herdr's Claude hook reports session identity only (`vendors/herdr/src/integration/assets/claude/herdr-agent-state.sh:54`), and its Pi `blocked` comes from a herdr-private event bus (`assets/pi/herdr-agent-state.ts:211`) → Claude adds a `Notification` hook for permission prompts → `blocked`. Pi maps `agent_start` → working and `agent_settled` → idle; Pi `blocked` is deferred because Pi has no native event.
- `SPUR_SPEC_ID` is set only for supervised persistent members (`supervisor-service.ts:218`), not for drained `svc.run` members → `AgentService` exports `SPUR_SPEC_ID` to the child env whenever the run carries `spec-id`, using the same env seam as `SPUR_ROLE` (`agent-service.ts:395`).
- Hooks are TS files run via `superskill hook run sp <name>` (`plugins/sp/hooks/hooks.json`), not shell scripts. The plugin-standalone contract applies: `node:*`/`bun:*` and relative imports only.
- The Board member view overlaps 1078's `teamId` edits (`ProcessesView.tsx`) and the other session's uncommitted `MemberDetail.tsx` → put the badge in the member row component that 1078 leaves, not in `MemberDetail.tsx`.

### Requirements

- [ ] R1. `spur agent report --state working|idle|blocked --seq <ns>` records the member's lifecycle state; a report whose `seq` is not greater than the last accepted one is ignored.
- [ ] R2. Accepted transitions emit cataloged event `agent.lifecycle.changed` with a presenter (ADR-066).
- [ ] R3. `gtdStrategy` treats `blocked` as unavailable; the Board shows "needs human" on that member.
- [ ] R4. The `sp` plugin's Claude hooks report in the background only when `SPUR_SPEC_ID` is set — SessionStart→idle, UserPromptSubmit→working, Notification (permission prompt)→blocked, Stop→idle; outside a fleet they exit immediately; failures are silent and never delay the agent. `AgentService` exports `SPUR_SPEC_ID` to every fleet member run. Pi reports working/idle through its extension (ADR-129); Pi `blocked` is deferred.

### Acceptance Criteria

- [ ] AC1 — Agents report lifecycle through hooks

Task-local verification:

- Reports with seq 3 then 2 leave the state from seq 3.
- A blocked member is skipped by the strategy tick with a hold reason.
- `bun run plugin-smoke` passes; a hook run without `SPUR_SPEC_ID` makes no CLI call.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:16.631Z

- **Q: Where is the state stored?** A: As a ledger row in `system_events`, following the `fleet.member-session` pattern (`packages/domain/src/dao/member-session.ts`). Event `agent.lifecycle.changed`, actor = member id, payload `{ state, seq }`. The last accepted row for the actor is the current state, so no new table is needed.
- **Q: Where does `seq` come from in a TS hook?** A: `BigInt(Date.now()) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n)`, an approximation of wall-clock ns across processes. Ties lose under the strict `>` rule, which is the intended stale-drop behavior.
- **Q: What does the `--spec` default to?** A: `SPUR_SPEC_ID`. Without either, the verb exits 2 with "no member id (set SPUR_SPEC_ID or --spec)".
- **Q: Which Notification matcher?** A: Claude Code's documented permission-prompt notification type. Verify the current matcher value against the official hooks reference during implementation and cite the URL in the Solution. If no matcher exists, filter on the payload's notification type inside the hook.

### Design

**Domain** — new file `packages/domain/src/dao/member-lifecycle.ts`:
- `AGENT_LIFECYCLE_EVENT = 'agent.lifecycle.changed'`
- `recordLifecycle(db, actor, { state, seq })`
- `readLifecycle(db, actors): Map<actor, { state, seq, at }>`

**App**
- `AgentCoordinationService.reportLifecycle(specId, state, seq)`: read the last row → if `seq <= last.seq`, return `{ accepted: false }` → else record it and emit `agent.lifecycle.changed` on `ctx.events`.
- Catalog entry in `packages/app/src/services/event-names.ts`: `baseEvent('agent.lifecycle.changed', 'agent', 'agent')`, plus a presenter whose fields are member, state and seq, with summary `[agent] <id> · <state>`.

**CLI.** `spur agent report --state <s> --seq <n> [--spec <id>] [--json]` in `apps/cli/src/commands/agent.ts` (consented 2026-10-04). It is a thin call to the service.

**Strategy.** `selectNext`/`select` loads `readLifecycle` for the members. A `blocked` member is excluded from idle with the new hold reason `member-blocked` (added to `DispatchHoldReason`).

**Board**
- The fleet snapshot (`fleet-service.ts`, next to the `readMemberSessions` use at `:473`) gains `lifecycle?: { state, seq, at }` per member.
- Contract field in `packages/contracts/src/fleet.ts`.
- A "needs human" badge in the fleet member row (`apps/web/src/modules/projects/ProcessesView.tsx` or its row component), per `DESIGN.md` status-badge tokens.

**Env.** In `agent-service.ts` executeRun, when `spec-id` is set, add `SPUR_SPEC_ID: <specId>` to the runner env (the same seam as `SPUR_ROLE`, `:395`).

**Hooks** — new `plugins/sp/hooks/agent-lifecycle.ts`, one entry point with the event read from the hook stdin `hook_event_name`:
1. Exit 0 immediately when `SPUR_SPEC_ID` is unset.
2. Otherwise `Bun.spawn(['spur','agent','report','--state',s,'--seq',seq], { stdio: ['ignore','ignore','ignore'] }).unref()`.
3. Exit 0. All errors are swallowed.

Register it in `hooks.json` for SessionStart, UserPromptSubmit, Stop and Notification (`superskill hook run sp agent-lifecycle`, timeout 5). For Pi, add `agent_start`/`agent_settled` handlers in `plugins/sp/hooks/pi/guard-extension.ts` that call the same core.

**Tests**
- domain ledger (in-memory SQLite: seq 3 then 2 keeps 3)
- strategy `member-blocked` hold
- `plugins/sp/hooks/agent-lifecycle.test.ts`: no spawn without the env; spawn args with it
- `bun run plugin-smoke`

### Plan

1. Write the failure list first as tests:
   - a stale seq overwrites
   - a blocked member is dispatched
   - a hook runs `spur` outside a fleet
   - a hook blocks on a slow CLI
   - a drained member lacks `SPUR_SPEC_ID`
2. Domain ledger helpers + service `reportLifecycle` + event catalog/presenter.
3. The `spur agent report` verb; update the spur-cli agent reference and the parity test.
4. `SPUR_SPEC_ID` env export in `agent-service`.
5. Strategy `member-blocked` hold.
6. Snapshot field, contract, Board badge.
7. The hook file, `hooks.json` and the Pi extension handlers.
8. Gates:
   - focused tests
   - `bun run plugin-smoke`
   - `bun run spur-check`
   - `bun run test-cf`

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

- 2026-10-04T20:57:50.309Z backlog → todo (system)

