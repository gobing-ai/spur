---
schema_version: 1
name: spur message CLI on InboxService with show and read verbs
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.647Z
updated_at: "2026-10-20T18:02:49.942Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - cli

dependencies: ["1266"]
estimate_hours: 4
---

## 1268. spur message CLI on InboxService with show and read verbs

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.3; ADR-143. Public-surface consent: the operator approved `spur message show` and `spur message read` on 2026-10-19 (A4).

Sizing: about 4h (was 3h). The `--wait` ports and the doc set are larger than the original estimate assumed.

Implements: R10 — CLI send defaults to the orchestrator as operator; R11 — CLI shows a thread and marks a message read; R12 — CLI inbox listing writes nothing.

Depends on: 1266. Can run in parallel with 1267.

**Verified surface (2026-10-20).** `apps/cli/src/commands/message.ts` (658 lines) registers `send`, `inbox`, `reply` and `watch`, all on `AgentCoordinationService`.
- `DEFAULT_FROM = 'operator'` (:22) already exists.
- `send` requires `--to` or `--role` (:216-233).
- `inbox --unresolved` runs `DeliveryReconciler.reconcile` (:374), a write.
- `send --wait --until injected` waits for the recipient's inbox-wide `countPending` to reach 0 (`waitForPendingDrain`, :630-660). `--until invoke-exit` passes `countPending` into `waitForOccupant` for stall detection (:306).
- `spur agent wait` uses `countPending` too (`agent/wait.ts:165`).
- The help docs are hand-maintained: `docs/help/cmd_message.md` still says "ts-db `InboxMessageDao`". `docs/help/index.md`, `plugins/sp/skills/spur-cli/SKILL.md` and `references/agent.md` mention message verbs.

**Refine corrections (2026-10-20)**
- "`--wait` watches the sent message own status" → this applies to `--until injected` only; `invoke-exit` already waits on the pinned run's ledger events → `injected` becomes "the sent row left `queued`", read by id through `InboxService.get`. `invoke-exit` keeps its ledger follow, and its stall probe uses `countQueued`.
- R1 left the no-orchestrator case undefined → with no `--to`/`--role` and no resolvable orchestrator, exit 2 with a usage error naming `--to`. No row is written.
- R2 "no reconcile on read" → `--unresolved` keeps its filter through the read-only `DeliveryReconciler.classify`. The attempts-exhausted marking now happens in sweep (1266).
- R4's doc list was incomplete → it adds `docs/help/index.md` and any `spur-cli` SKILL/agent reference line that states the changed defaults. A stale "ts-db InboxMessageDao" sentence is removed.
- The `AgentCoordinationService` message wrappers (`sendMessage`, `replyToMessage`, `getInbox`, `listRecent`, `markMessageRead`, `countPending`) stay until their last caller is gone. 1268 removes the CLI callers; deleting the wrappers is a cleanup for after both 1267 and 1268 (cross-task proposal for 1269).

### Requirements

- [ ] R1. `spur message send <body>` with no `--to`/`--role` resolves the orchestrator member (`FleetService.resolveOrchestrator`) and sends from `operator` (`--from` still overrides). With no resolvable orchestrator, it exits 2 with a usage error and writes no row. `--request-key` replay output is unchanged.
- [ ] R2. `send --wait --until injected` returns once the sent message's own row leaves `queued`, not when the recipient's inbox is empty. `--until invoke-exit` is unchanged apart from `countQueued` replacing `countPending`.
- [ ] R3. `spur message inbox` writes nothing. `--unresolved` uses `DeliveryReconciler.classify`.
- [ ] R4. Add `spur message show <id> [--json]`, which prints the thread (root plus replies, oldest first, both directions), and `spur message read <id> [--reader <id>] [--json]`. `--reader` defaults to `operator`; a missing or mis-addressed message exits 1.
- [ ] R5. Every `message` verb and `spur agent wait` call InboxService. No `apps/cli` file imports a message method of `AgentCoordinationService`.
- [ ] R6. Update `docs/help/cmd_message.md`, `docs/help2/message.md`, `docs/help/index.md` and `plugins/sp/skills/spur-cli/references/message.md`, plus any `spur-cli` SKILL or agent-reference line that states the old send/inbox behavior.

Out of scope: agent drain/settle (1266), the server routes (1267), and deleting the `AgentCoordinationService` message wrappers (after 1267 and 1268).

### Acceptance Criteria

- [ ] AC1 — CLI send defaults to the orchestrator as operator
- [ ] AC2 — CLI shows a thread and marks a message read
- [ ] AC3 — CLI inbox listing writes nothing

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-20T18:02:34.967Z

- **Q: Rename `--until injected` to `claimed`?** Closed (2026-10-20): no. That would be a public flag-value change with no operator consent. The help text redefines it as "the message was claimed by the recipient".
- **Q: No orchestrator: fall back to some agent, or fail?** Closed: fail with exit 2. A silent fallback would send operator intent to the wrong member.
- **Q: Split message.ts?** Closed: yes. It is past 600 lines, and adding two verbs makes it the large-noun case in `docs/03_ARCHITECTURE.md` §3.

### Design

**WHAT.** The `spur message` verbs become thin calls into `InboxService` (1266). Two verbs are added: `show` and `read`.

**WHY.** H6 (an inbox read that writes) and C1 (operator identity). It also lets the operator and agents use one verb set against the same service as the Board (1267).

**WHERE.**
- `apps/cli/src/commands/message.ts`: replace `AgentCoordinationService` with `new InboxService({ getDb: context.getDb })`. Split into `commands/message/{index,send,inbox,reply,show,read,watch,shared}.ts`, because the file is past 600 lines and two verbs are being added (the `docs/03_ARCHITECTURE.md` §3 large-noun layout). Tests mirror it under `apps/cli/tests/commands/message/`.
- Orchestrator default: construct `FleetService` the way `agent/shared.ts:580` does (`fs`, `spurConfig: context.loadAgentConfig(cwd)`, `roles`, `openDb`), then call `resolveOrchestrator(cwd)`. The `bound-*` states yield `instanceId`; `missing` and `unresolvable` take the exit-2 path.
- `waitForPendingDrain` → `waitForClaim(inbox, msgId, pin, …)`: it polls `inbox.get(msgId).status !== 'queued'` and keeps the occupant pin, timeout and stall checks.
- `apps/cli/src/commands/agent/wait.ts` and the `occupant-wait.ts` port: rename `countPending` → `countQueued`, backed by `InboxService.countQueued`.
- Human output follows the current row format (`id\tstatus\tfrom\tbody\tcreatedAt`). `show` prints one line per message, prefixed `→`/`←` relative to the root sender.

**Anti-patterns.** No new noun. `--until injected` is not renamed (that would be a public surface change). No reconcile or sweep from any read verb.

### Plan

1. Failure modes first: E2E through `bun run apps/cli/src/index.ts` against a temp project with a migrated DB (`apps/cli/tests/commands/message/e2e.test.ts`):
   - send without `--to` and no orchestrator → exit 2, zero rows;
   - with an orchestrator bound → the row is from `operator` to the member;
   - `inbox --json` on a DB holding exhausted and queued rows → identical DB checksum before and after;
   - `show` on a replied message → both rows in order;
   - `read` → `read_at` set and one `message.read` event; a second read writes nothing;
   - `read` by a non-recipient → exit 1;
   - `--wait --until injected` returns after the target row is claimed even when other rows stay queued.
2. Split the noun into per-verb files and rewire it onto InboxService.
3. `show` and `read`; the `--wait` port changes; `agent wait`.
4. Docs.
5. `rg -n "coordination.*(sendMessage|replyToMessage|getInbox|listRecent|markMessageRead|countPending)" apps/cli/src` returns nothing; then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G11 R10–R12; plan §3.3; ADR-143; A4 consent (2026-10-19).
- Prior art: 0685 (`--role`), 0832 (`--request-key`), G4 R8 (`waitForOccupant`/ledger follow), 0834 R6 (`--unresolved`).
- Depends on 1266; runs in parallel with 1267.

### History
