---
schema_version: 1
name: spur message CLI on InboxService with show and read verbs
status: done
template: feature-impl
created_at: 2026-10-20T06:59:42.647Z
updated_at: "2026-10-21T05:58:06.671Z"
feature_id: G11
priority: P1
tags:
  - inbox
  - cli

dependencies: ["1266"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
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

- [x] R1. `spur message send <body>` with no `--to`/`--role` resolves the orchestrator member (`FleetService.resolveOrchestrator`) and sends from `operator` (`--from` still overrides). With no resolvable orchestrator, it exits 2 with a usage error and writes no row. `--request-key` replay output is unchanged.
- [x] R2. `send --wait --until injected` returns once the sent message's own row leaves `queued`, not when the recipient's inbox is empty. `--until invoke-exit` is unchanged apart from `countQueued` replacing `countPending`.
- [x] R3. `spur message inbox` writes nothing. `--unresolved` uses `DeliveryReconciler.classify`.
- [x] R4. Add `spur message show <id> [--json]`, which prints the thread (root plus replies, oldest first, both directions), and `spur message read <id> [--reader <id>] [--json]`. `--reader` defaults to `operator`; a missing or mis-addressed message exits 1.
- [x] R5. Every `message` verb and `spur agent wait` call InboxService. No `apps/cli` file imports a message method of `AgentCoordinationService`.
- [x] R6. Update `docs/help/cmd_message.md`, `docs/help2/message.md`, `docs/help/index.md` and `plugins/sp/skills/spur-cli/references/message.md`, plus any `spur-cli` SKILL or agent-reference line that states the old send/inbox behavior.

Out of scope: agent drain/settle (1266), the server routes (1267), and deleting the `AgentCoordinationService` message wrappers (after 1267 and 1268).

### Acceptance Criteria

- [x] AC1 — CLI send defaults to the orchestrator as operator
- [x] AC2 — CLI shows a thread and marks a message read
- [x] AC3 — CLI inbox listing writes nothing

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

`spur message` is a thin surface over `InboxService`; the two new verbs make the operator's side of a thread complete.

**Module layout.** The noun is a folder — `apps/cli/src/commands/message/{index,send,inbox,show,read,reply,watch,shared}.ts`, largest file 338 lines — with tests mirrored under `apps/cli/tests/commands/message/`, per `docs/03_ARCHITECTURE.md`.

**The plane, not the wrapper (R5)**
- `apps/cli/src/commands/message/shared.ts:14`: `inboxOf(context)` is the only inbox handle any verb uses. `send`, `inbox`, `reply`, `watch`, `show` and `read` call the service directly — no `apps/cli` file calls a message method of `AgentCoordinationService` any more. The two remaining agent paths follow: the drain claims through `InboxService.claim` (`apps/cli/src/commands/agent/shared.ts:436`) and `spur agent wait` reads `countQueued` from the service (`apps/cli/src/commands/agent/wait.ts:167`).

**Send defaults (R1)**
- `apps/cli/src/commands/message/shared.ts:19` (`resolveOrchestratorAddress`): no `--to`/`--role` resolves the project's orchestrator member through `FleetService.resolveOrchestrator` and sends from `operator`. A project with no bound orchestrator exits 2 with a usage error and writes no row. Both endpoint ids are syntax-checked before the write, and a blank `--request-key` is refused, so a typo cannot become an undeliverable message.

**Wait semantics (R2)**
- `apps/cli/src/commands/message/shared.ts:75` (`waitForMessageClaim`): `--wait --until injected` is satisfied when THIS message leaves `queued` — claimed, delivered or failed — instead of when the recipient's inbox happens to be empty, which another consumer draining a different row would also satisfy. `--until invoke-exit` is unchanged apart from reading `countQueued`.

**Read-only listing (R3)**
- `apps/cli/src/commands/message/inbox.ts` (`runMessageInbox`): `--unresolved` and `--json` classify through `DeliveryReconciler.classify` (the pure pass), so `spur message inbox` never sweeps, settles or expires anything; the write side lives on the orchestrator's strategy tick (1267).

**New verbs (R4)**
- `apps/cli/src/commands/message/show.ts:9` (`show`): the whole thread — root plus replies, oldest first, both directions — as text or `{ messages, count }`; an unknown id exits 1.
- `apps/cli/src/commands/message/read.ts:10` (`read`): `--reader` (default `operator`) stamps the receipt through the service's guarded `markRead`; idempotent, and a missing or mis-addressed message exits 1 without writing an event.

**Docs (R6)**
- `docs/help/cmd_message.md`, `docs/help2/message.md`, `plugins/sp/skills/spur-cli/references/message.md` and `docs/help/spur-cli-matrix.md` (verb counts, the `read` row, the `show` cell, the 79/107 summary) describe the new surface; the CLI parity sweeps pass against them.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/message/shared.ts:19` (`resolveOrchestratorAddress`) consumed at `apps/cli/src/commands/message/send.ts:166`; no orchestrator → usage error and no row `apps/cli/src/commands/message/send.ts:167-170`; sender defaults to `operator` (`apps/cli/src/commands/message/shared.ts:8`, `apps/cli/src/commands/message/send.ts:187`); both ids syntax-checked before the write `apps/cli/src/commands/message/send.ts:191-193`; tests `apps/cli/tests/commands/message.test.ts:1000` and `apps/cli/tests/commands/message.test.ts:1046` |
| R2 | MET | `apps/cli/src/commands/message/shared.ts:75` (`waitForMessageClaim`) polls the SENT row via `InboxService.get` `apps/cli/src/commands/message/shared.ts:97` and treats any non-`queued` status as consumed `apps/cli/src/commands/message/shared.ts:99`; test claims only the sent row on a second connection `apps/cli/tests/commands/message.test.ts:1186` |
| R3 | MET | `apps/cli/src/commands/message/inbox.ts:29-37` classifies through the pure `DeliveryReconciler.classify`; test seeds a claim past `CLAIM_LEASE_MS` (the row a sweep would requeue), runs `--json` and `--unresolved --json`, and asserts `system_events` unchanged, zero `message.requeued`, row still `claimed` `apps/cli/tests/commands/message.test.ts:1145-1184`; strengthened this pass (the prior test claimed with a fresh lease, so a writing implementation also passed) and mutation-checked: swapping in `reconcile` fails it (2 → 3 rows) |
| R4 | MET | show reads `InboxService.thread` `apps/cli/src/commands/message/show.ts:27` and refuses an unknown id `apps/cli/src/commands/message/show.ts:29`; read stamps via `InboxService.markRead` `apps/cli/src/commands/message/read.ts:28` and refuses a non-recipient `apps/cli/src/commands/message/read.ts:43-47`; tests `apps/cli/tests/commands/message.test.ts:1060`, `apps/cli/tests/commands/message.test.ts:1082`, `apps/cli/tests/commands/message.test.ts:1092`, `apps/cli/tests/commands/message.test.ts:1120`, plus `apps/cli/tests/commands/message/show.test.ts` and `apps/cli/tests/commands/message/read.test.ts` |
| R5 | MET | `rg` for the coordination message methods over `apps/cli/src` is empty this run; drain claims through `InboxService.claim` `apps/cli/src/commands/agent/shared.ts:436`; `spur agent wait` reads `countQueued` `apps/cli/src/commands/agent/wait.ts:167` through the wait port member renamed `countQueued` this pass `packages/app/src/services/occupant-wait.ts:104` (no `countPending` left on the port) |
| R6 | MET | `plugins/sp/skills/spur-cli/SKILL.md:49` (message row lists send, inbox, show, read, reply, watch) and `plugins/sp/skills/spur-cli/SKILL.md:164`; matrix read row `docs/help/spur-cli-matrix.md:69`; `docs/help/cmd_message.md`, `docs/help2/message.md` and `plugins/sp/skills/spur-cli/references/message.md` describe the surface |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R10 — CLI send defaults to the orchestrator as operator | MET | command | `apps/cli/tests/commands/message.test.ts:1000` (exit 0 to the declared orchestrator, `from: operator`) and `apps/cli/tests/commands/message.test.ts:1046` (exit 2, zero rows when unbound); source `apps/cli/src/commands/message/send.ts:166-170` |
| R11 — CLI shows a thread and marks a message read | MET | test | `apps/cli/tests/commands/message.test.ts:1060`, `apps/cli/tests/commands/message.test.ts:1092`, `apps/cli/tests/commands/message/show.test.ts`, `apps/cli/tests/commands/message/read.test.ts` |
| R12 — CLI inbox listing writes nothing | MET | test | `apps/cli/tests/commands/message.test.ts:1145` — an expired claim leaves the ledger count unchanged, the row `claimed`, zero `message.requeued` |
| R21 — Every member consumer claims and settles through the inbox service | MET | test | `apps/cli/src/commands/agent/shared.ts:436` (claim), `apps/cli/src/commands/agent/wait.ts:167` (countQueued), covered by `apps/cli/tests/commands/agent/loop.test.ts` and `apps/cli/tests/commands/agent/wait.test.ts` (green this pass) |
| AC1 | MET | command | `apps/cli/tests/commands/message.test.ts:1000` — declared orchestrator, no `--to`: exit 0, `toId` the orchestrator instance, `from: operator`, one row; `apps/cli/tests/commands/message.test.ts:1046` — undeclared: exit 2, `inbox_messages` empty |
| AC2 | MET | test | `apps/cli/tests/commands/message.test.ts:1060-1143` — thread oldest-first in both directions, unknown id exit 1, read transitions once with one `message.read` row, repeat reports `transitioned: false`, non-recipient exit 1 with no event |
| AC3 | MET | command | `apps/cli/tests/commands/message.test.ts:1145` drives `message inbox --json` and `--unresolved --json` over an expired claim and asserts `system_events` unchanged and the row still `claimed`; source `apps/cli/src/commands/message/inbox.ts:29-37` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1268

**Scope:** working tree on top of 45864bd49 — 10 modified files plus 2 untracked server files (`git diff 45864bd49 --stat`)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P1 (blocker) | functional (R1) | `send` with no `--to` can never resolve the orchestrator. `resolveOrchestratorAddress` constructs `FleetService` with only `fs` and `openDb`, so `effectiveConfig()` is `null`, `load()` is `null`, and `resolveOrchestrator` returns `missing` for every project — `FleetService` never reads config from disk on its own. The resolved-address branch is dead code: an end-to-end run in a project declaring `agent.fleet.orchestrator` (role planner + purpose orchestrator) exits 2 with "no orchestrator member". The bare `catch` also maps any FleetService or DB error onto that same exit 2. Fix: thread `spurConfig: await context.loadAgentConfig(context.cwd)` and `roles: context.agentRoles` the way `apps/cli/src/commands/agent/shared.ts:578-585` does. | `apps/cli/src/commands/message.ts:215-226` | RESOLVED — Fixed: `resolveOrchestratorAddress` now threads `spurConfig: await context.loadAgentConfig(context.cwd)` and `roles`, matching `apps/cli/src/commands/agent/shared.ts:589`; the config-load failure is rethrown as its own error instead of being folded into "no orchestrator". Probed end-to-end: a project declaring `agent.fleet.orchestrator` now sends (exit 0) to the orchestrator's instance id with `from: operator`, and the no-orchestrator case writes no row. |
| 2 | P2 (major) | verification (R1) | The R1 test is a tautology: it accepts `code === 0` OR the exit-2 branch, so it stayed green over the dead branch in finding 1 and asserts nothing about the default recipient. No test in the tree takes the resolved-orchestrator path. | `apps/cli/tests/commands/message.test.ts:1000-1042` | RESOLVED — Fixed: the tautology is gone. The R1 test now declares a planner-role orchestrator and asserts exit 0, the resolved `toId`, `status: queued`, and one stored row with `fromId: operator`; a second test asserts the no-orchestrator case exits 2 with zero rows. |
| 3 | P2 (major) | verification (R2) | The `--until injected` test seeds exactly one message, so the retired inbox-empty implementation would also pass it. Nothing pins the requirement's discriminator: the sent row leaves `queued` while another row stays queued. The implementation itself is correct by inspection. | `apps/cli/tests/commands/message.test.ts:1156-1182` | RESOLVED — Fixed: the test now seeds an ALREADY-QUEUED row for the same member and has a separate connection claim only that older row, so an inbox-empty implementation cannot pass — the wait keys on the sent row. |
| 4 | P2 (major) | architecture (R5) | The noun was not split. `message.ts` is one 829-line file holding six verbs and their helpers, against the closed Q&A ("Split message.ts? Closed: yes") and the layout rule at `docs/03_ARCHITECTURE.md:187-189` (a large noun is `commands/<noun>/` with `index.ts`, one `<verb>.ts` per verb, helpers in `shared.ts`, tests mirrored under `tests/commands/<noun>/`). The Solution prose silently rewrote the Design by citing the single file. | `apps/cli/src/commands/message.ts:1-829` | RESOLVED — Fixed: the noun is a folder — `commands/message/{index,send,inbox,show,read,reply,watch,shared}.ts`, largest file 338 lines — with tests mirrored under `tests/commands/message/` and per-module files. The CLI parity sweeps still key `message.ts:<verb>` because the reader concatenates the folder. |
| 5 | P3 (minor) | verification (R3) | The committed "inbox --json writes nothing" test seeds a fresh claim under the default 600s lease, which the pre-change `reconcile()` sweep would not have touched either — the test cannot fail for the write it guards. `--unresolved` has no write-freeness test at all. I proved the behaviour separately with an expired claim (see Functional Traceability R3). | `apps/cli/tests/commands/message.test.ts:1129-1155` | RESOLVED — Fixed: the write-freeness test now seeds an EXPIRED claim (the case a reconcile sweep would have requeued) and asserts both `inbox --json` and `inbox --unresolved --json` leave the ledger count unchanged, the row still `claimed`, and zero `message.requeued` events. |
| 6 | P3 (minor) | correctness | `runMessageRead` wraps the whole call in a bare `catch` and reports "message not found for reader" with exit 1. A DB fault, or a `pruneEvents` failure after the transition already committed, is misreported as a missing message — the operator is told nothing was written when the receipt may be stamped. Catch the service's typed not-found error and let the rest surface. | `apps/cli/src/commands/message.ts:586-610` | RESOLVED — Fixed: `runMessageRead` now catches only `MessageNotFoundError` and rethrows everything else, so a ledger fault cannot be reported as a missing message. |
| 7 | P3 (minor) | docs (R6) | `SKILL.md` still enumerates the message verbs as "send, inbox, reply, watch" in both places, so the surface map an agent reads never learns that `show` and `read` exist. No parity sweep covers an inline verb enumeration. | `plugins/sp/skills/spur-cli/SKILL.md:49` and `plugins/sp/skills/spur-cli/SKILL.md:164` | RESOLVED — Fixed: `SKILL.md:49` and `:164` now enumerate send, inbox, show, read, reply, watch. |
| 8 | P4 (advisory) | naming | The `waitForOccupant` port still names the member `countPending` while both CLI callers now feed `InboxService.countQueued`, so the Design's port rename did not land and the port name is the one place the queued-vs-pending distinction is still wrong. Behaviour is correct. | `packages/app/src/services/occupant-wait.ts:104` | ACCEPTED |
| 9 | P4 (advisory) | output shape | `widenInboxRow` now always emits `injectAttempts`, `injectError` and `taskId` (null where the key was previously omitted), a receipt-shape change on `inbox --json`. The widened row feeds only this verb's own output path and the envelope inventory test was updated to 80 advertising verbs. | `apps/cli/src/commands/message.ts:493-518` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | PARTIAL | The no-orchestrator half is right: exit 2 at `apps/cli/src/commands/message.ts:270-292` happens before any write (the occupant snapshot and the insert follow it), and both endpoints are syntax-checked at `apps/cli/src/commands/message.ts:296-307` before the row exists. The default-recipient half is dead (finding 1) — a project declaring `agent.fleet.orchestrator` still exits 2. |
| R2 | MET | `apps/cli/src/commands/message.ts:794-829` polls `inbox.get(msgId)` and treats only `status === 'queued'` as unsatisfied, so a claimed, delivered or failed row satisfies the wait regardless of the inbox contents. `invoke-exit` is unchanged apart from `countQueued` at `apps/cli/src/commands/message.ts:397`. Stalled and unpinned waits still fail through `sendWaitFail` with the WaitError code. |
| R3 | MET | `apps/cli/src/commands/message.ts:468` uses `DeliveryReconciler.classify`, whose body is queries only (`packages/app/src/services/delivery-reconciler.ts:64-116`). Verified on a file-backed project with one request row in an expired claim: `system_events` 2 rows before, 2 after; the row still `claimed`; 0 `message.requeued` — the write the old `reconcile()` would have performed. Same result for `inbox --json` and `inbox --unresolved --json`. |
| R4 | MET | `show` (`apps/cli/src/commands/message.ts:552-583`) reads `InboxService.thread`, which orders `created_at ASC` over the thread root (`packages/domain/src/dao/inbox-dao.ts:409-417`) so root plus replies spanning both directions come out oldest-first; unknown id exits 1. `read` (`apps/cli/src/commands/message.ts:586-610`) calls the guarded `markRead` (`packages/domain/src/dao/inbox-dao.ts:337-364`: `id AND to_id AND read_at IS NULL`), so a repeat reports `transitioned: false` with one ledger row and a non-recipient gets null and exits 1 writing no event. Both covered at `apps/cli/tests/commands/message.test.ts:1044-1155`. |
| R5 | MET | No message method of `AgentCoordinationService` is called anywhere under `apps/cli/src` — `sendMessage`, `getInbox`, `replyToMessage`, `markMessageRead`, `drainPending`, `countPending`, `releasePending`, `settleDelivered`, `settleFailed`, `listRecent` all grep empty. The drain claims through `InboxService.claim` (`apps/cli/src/commands/agent/shared.ts:436-441`) and `spur agent wait` reads `countQueued` (`apps/cli/src/commands/agent/wait.ts:167`). The remaining `AgentCoordinationService` uses are non-message surfaces (spec listing, fleet members, task assignment). |
| R6 | MET | `docs/help/cmd_message.md:30` (the `--to` default and the exit-2 contract), `:65` and `:78` (the two new verb sections), `:100` (inbox writes nothing); `docs/help2/message.md:45-50`; `plugins/sp/skills/spur-cli/references/message.md:24-25`; and the matrix verb counts at `docs/help/spur-cli-matrix.md:21` (4 to 6, 78 to 79 unique verbs, 105 to 107 cells). `docs/help/index.md` needs no change: its only message lines are the noun summary and the link (`docs/help/index.md:54`), neither stale. The one gap is finding 7. |

##### Other dimensions

- **Security:** no finding. The new reads stay inside the project DB, `markRead` is guarded in SQL rather than in the caller, and no new user input reaches a shell, a path or a query string. The recipient guard is not weakened by `show` (a thread read is a deliberate operator capability, ADR-143).
- **Efficiency:** no finding. `inboxOf(context)` builds a thin service per call over the cached adapter; `show` is one indexed read; the wait polls a single row by primary key every 100ms instead of a count over the inbox.
- **Usability:** exit codes and messages are consistent with the noun's existing contract (2 for usage, 1 for a missing or mis-addressed id). Finding 6 is the one place an error message can mislead.

##### Confidence

Confidence: MEDIUM

The verdict is not PASS and the P1-P3 rows above are not closed, so the disposition-derived level is LOW. Not a self-grade: the rows decide it.

##### Residual risk

- R1's positive path has no coverage in the tree. Only a manual `FleetService` probe shows the fix direction (`reloadAgentConfig` threaded yields `bound-offline` with an `instanceId` for the same declaration), so the repaired branch will need its own test.
- `--until injected` now treats claimed, delivered *and* failed as satisfied. A claim that is subsequently released back to `queued` still reports `injected` while the row is queued again. Transient and untested; acceptable for a wait primitive, worth a comment.
- The wait signal can now move only once (queued to not-queued), so a claim that outlives `DEFAULT_STALL_MS` always ends in `wait_stalled`. That matches the task Design (a row that never moves from an idle occupant is a stall), but it now fires for any slow-but-healthy recipient rather than only a wedged one.
- The gate receipt (`bun run spur-check` 11540 pass) is for this tree; any fix to `apps/cli/src/commands/message.ts` invalidates the digest and needs the gate re-run.
- Cross-task: the working tree carries 1267's server handler files untracked (see below), so the gate is green against a HEAD (45864bd49) that does not build on a clean checkout.

##### Carried to dependent work

- **1267 — commit 45864bd49 is not self-contained.** `apps/server/src/router.ts:8` imports `./modules/inbox/handlers` and calls `createInboxHandlers` at `apps/server/src/router.ts:44`, but `apps/server/src/modules/inbox/handlers.ts` (277 lines) and `apps/server/tests/modules/inbox/handlers.test.ts` (523 lines) are untracked — the commit references files it does not contain, so a fresh checkout of it cannot typecheck. Commit them with 1267 (or amend) before 1268 lands.
- **1269 — wrapper deletion.** The `AgentCoordinationService` message wrappers stay until their last caller is gone; `InboxService.recent()` already carries an explicit `shortcut:` note naming 1269 as the replacement.
- **1269 — test sweep.** Findings 2, 3 and 5 all want a discriminating seed: a bound-orchestrator project for R1, a sibling queued row for R2, an expired claim (constructor `leaseMs` override) for R3.
- **Optional cleanup.** The `countPending` member name on the `waitForOccupant` port (finding 8) is a two-line rename in `packages/app/src/services/occupant-wait.ts` plus its two callers.

##### Disposition

FAIL. One blocker (finding 1) and two major test defects (findings 2 and 3) keep this out of a PASS; rows 1-7 are deferred to the remediate hop and rows 8-9 are accepted. The blocker is a five-line fix (thread the config loader into `FleetService`) plus the positive-path test that finding 2 asks for. Nothing is implemented in this review. After the fix: re-run `bun run spur-check`, re-review R1 and AC1 only, then proceed.

### References

- Feature G11 R10–R12; plan §3.3; ADR-143; A4 consent (2026-10-19).
- Prior art: 0685 (`--role`), 0832 (`--request-key`), G4 R8 (`waitForOccupant`/ledger follow), 0834 R6 (`--unresolved`).
- Depends on 1266; runs in parallel with 1267.

### History

- 2026-10-21T00:15:15.979Z todo → wip (system)
- 2026-10-21T01:39:39.811Z wip → testing (system)
- 2026-10-21T01:42:23.931Z testing → done (system)

