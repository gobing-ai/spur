---
kind: plan
title: Agent fleet over the inbox — redesign, team-residue cleanup, simplification
status: draft
created_at: 2026-10-04
updated_at: 2026-10-04
related:
  - docs/design/fleet-config-declaration.md
  - docs/design/inter-agent-control-plane.md
  - docs/design/spur-team-mode-design.md
  - docs/plans/2026-09-11-project-agent-fleet-brainstorm.md
  - docs/tasks5/1069_serve-the-run-progress-projection-and-run-list-filters.md
tags: [fleet, inbox, gtd, cleanup, herdr, G65, G66, ADR-057, ADR-086, ADR-116, ADR-121, ADR-126, ADR-132]
---

# Agent fleet over the inbox — redesign, team-residue cleanup, simplification

## 1. Objective and outcome

**Problem.** The fleet does not use the inbox. The 1069 dogfood showed this. The intended model is:

- every agent-to-agent conversation (planner → coder → reviewer) goes through the durable inbox
- the operator talks to the orchestrator through the same inbox (ADR-057)

What the code does instead:

- The GTD orchestrator runs `/sp:dev-run` synchronously inside its own process.
- Member loops ignore their inbox whenever a fleet is declared.

As a result, user → orchestrator messages are dead, and 0942 `executor: fleet` dispatches are never consumed.

**Outcome.**

1. **One dispatch primitive.** A keyed inbox message to a member, used by both the GTD strategy and workflow `agent.run executor: fleet`.
2. **Every loop drains its inbox.** The orchestrator's inbox carries operator requests; members' inboxes carry work.
3. **Completion is a receipt, not a blocking call.** The existing `coordination_runs` row is linked to the request message (0833), and the orchestrator wakes on `agent.invoke.exit`.
4. **`wip` and paused tasks resume** with `--continue`. The operator resumes a fleet task by sending a message, with no guard bypass.
5. **Team-era residue is deleted** and the fleet runtime shrinks to config → supervisor → loop → inbox.
6. **Agents report their lifecycle through hooks** (`working` / `idle` / `blocked`). The strategy knows which members are blocked waiting on a human and stops treating them as free.
7. **An existing interactive agent can join the fleet in a role.** It joins cooperatively, from inside its own session. Spur never injects keystrokes.
8. **Every execution has a durable record.** A run id binds its stdout/stderr stream, its parent run and the agent sessions it produced; `spur agent trace <runId>` shows them after a restart (ADR-132).

**Done when** an E2E run on a scratch project meets all of the following, saved as a repeatable script plus a JSON receipt under `docs/reports/`:

- `agent.fleet { strategy: gtd, orchestrator: planner, members: [coder-1, reviewer-1] }` is declared.
- A `fleet:auto` task goes `todo → done` with the coder working from its own process.
- `spur message send --to planner "status?"` gets a reply.
- A killed coder mid-run is re-dispatched with `--continue`.
- The inbox shows the whole planner ↔ coder exchange.
- An interactive Claude Code session that ran `spur agent join --role reviewer` receives the review request, and its reply settles the receipt.

## 2. Premises and dependencies

### 2.1 Review findings (by severity, with evidence)

**Critical: the design contract is broken**

| # | Finding | Evidence |
| --- | --- | --- |
| C1 | When a fleet is declared, member loops never drain their inbox. They only `recordIdleHold`, so messages to members (and to the orchestrator) are never consumed. | `packages/app/src/services/agent-loop-service.ts:371`, `:413`, `:475` |
| C2 | The GTD orchestrator dispatches by calling `runTraced('/sp:dev-run <wbs> --auto')` **inside the planner process**. The call is serial and blocking: while a task runs, the planner can't hear the operator or dispatch to other members. The coder "member" never runs anything itself; it is only an executor label. | `agent-loop-service.ts:386`; `strategy-runtime.ts` `dispatchNext` |
| C3 | 0942 `agent.run executor: fleet` enqueues a keyed inbox message and polls a file, but C1 means no one drains it, so it always times out. | `packages/app/src/workflow/fleet-dispatch.ts:59`, `:181` |

**High: the flow is incomplete**

| # | Finding | Evidence |
| --- | --- | --- |
| H1 | Candidates are `status: 'todo'` only. A `wip` task (paused or interrupted pipeline) is invisible to GTD, and the prompt never carries `--continue` although `/sp:dev-run` supports it. | `strategy-runtime.ts:428`; `agent-loop-service.ts:386`; `plugins/sp/commands/dev-run.md:22` |
| H2 | The operator has no sanctioned way to resume a fleet task: `spur agent run --spec-id` is refused without the orchestrator's `beforeDispatch`. | `packages/app/src/services/agent-service.ts:1039-1040` |
| H3 | `selectNext` calls `resume()`, which reconciles and writes, and it is invoked twice per decision. Reads have side effects. | `strategy-runtime.ts` `selectNext` / `dispatchNext` |
| H4 | The write slot is held by the planner process that runs the work. Once work runs in the member process (the fix for C2), lease ownership must move with it. | `write-slot-service.ts` (`WRITE_SLOT_TTL_MS=30000`) |
| H5 | Pinning `executor` without `id` silently renames the instance (`spur-new-pi-k3`), which breaks addressing by role-instance name. | `packages/config/src/index.ts:459` (`memberLocalId`) |

**Medium: legacy residue and dead code**

| # | Finding | Evidence |
| --- | --- | --- |
| M1 | `AgentCoordinationService.getStatus()` wraps ts-ai-runner `TeamOrchestrator`. It has no production caller; only the `TeamStatusEntry` type leaks into `agent.ts mapServerStatus`. | `agent-coordination-service.ts:17`, `:226`, `:458`, `:642` |
| M2 | `assignTask` writes task frontmatter directly with `MarkdownDocument`, bypassing `TaskService`. It is called by the public `spur task assign`. | `agent-coordination-service.ts:491-499`; `apps/cli/src/commands/task.ts:1847` |
| M3 | `RosterMember` carries team-era fields (`workspace`, `systemPrompt`, `command`, `autonomy`, `autostart`) that `FleetMemberSchema` can never populate. | `packages/app/src/services/fleet-service.ts:150-156` |
| M4 | The `agent_instances` table plus `AgentInstanceStore`/`createFileAgentInstanceStore` are exported but have **zero callers**. The ADR-086 DB cutover was never done, and the `team_id` column and index survive. | `packages/domain/src/migrations.ts:976-998`; `packages/app/src/index.ts:69` |
| M5 | `teamId` fields run through contracts → server → web. ProcessesView keeps a hidden Team filter "for test harness compatibility". | `packages/contracts/src/fleet.ts:70,86`; `apps/server/src/modules/processes/index.ts:73,90`; `apps/web/.../activity-history.ts`, `MemberTerminal.tsx`, `ProcessesView.tsx` |
| M6 | Team naming in code and errors: `team`/`teamService` locals, "matching a team agent spec", "Phase 1-3 no daemon" comments. | `apps/cli/src/commands/agent.ts:751,832,1036`; `message.ts:630`; `fleet-service.ts` comments |
| M7 | `spur-team-mode-design.md` (557 lines) describes the retired team daemon and is still linked from `04_DESIGN.md`. | `docs/04_DESIGN.md`; `docs/design/spur-team-mode-design.md` |

**Adjacent: outside this redesign, but the dogfood depends on them**

These are listed only so they don't get lost. Each becomes its own task.

| # | Finding |
| --- | --- |
| A1 | The test-triage decisionMaker is disabled, so it always falls back to "fix" and burns attempts on failures the task didn't cause. |
| A2 | Agent runs inherit the launching shell's sandbox. The pipeline can't tell sandbox failures from real ones. |
| A3 | Repo-wide gates are poisoned by concurrent writers. The write claim covers only fleet members. |
| A4 | The `/tmp/.spur` latch self-seeds when `TMPDIR ≠ os.tmpdir()`, a hole in the tmpguard. `serve.test.ts` `startServer` is fragile under load. |
| A5 | Two `serve` processes bind :3000 on IPv4 and IPv6 with no conflict, while `projects list` reports STOPPED. |

### 2.2 What is already right (reuse, don't rebuild)

- The inbox plane: `sendMessage` (keyed, idempotent), `drainPending` → `settleDelivered`/`releasePending`/`settleFailed`, `MAX_INJECT_ATTEMPTS`, `DeliveryReconciler` hold reasons (`agent-coordination-service.ts`, `delivery-reconciler.ts`).
- Run ↔ message receipts: `drainIntoPrompt` threads `requestMessage` into `executeRun`, and the exit sink persists `coordination_runs` (`apps/cli/src/commands/agent.ts:~905`, `agent-service.ts:1284-1303`).
- `MemberSession` (persistent / resume / one-shot), the supervisor (`agent loop --spec`, restart backoff), wake events (`message.sent`, `agent.invoke.exit`, `task.updated`, `strategy.changed`, `fleet.capacity.changed`).
- `gtdStrategy` hold taxonomy, the `fleet:auto` authorization tag, `MAX_DISPATCH_ATTEMPTS`, write-slot fences (ownerEpoch, strategyVersion).

The fix is mostly **removing a bypass and moving one call site**, not new machinery.

### 2.3 Decisions (all approved by Robin, 2026-10-04)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Who runs the work: the member process (inbox) or the orchestrator process (today)? | **Member.** This is the only option consistent with ADR-057 and C2. |
| D2 | Orchestrator dual role: an LLM conversational session (drains operator messages) plus a deterministic GTD tick in the same loop? | **Yes, both.** Order per wake: drain the inbox first, then run the strategy tick. The LLM never decides dispatch; the strategy does. |
| D3 | `agent_instances` table and `.spur/agents/*.yaml` materialized specs | **Drop both.** Resolve a member's spec from `agent.fleet` at loop start (`FleetService.resolve(id)`). Instances become supervisor runtime state, which honours ADR-086's intent without a store. This needs an ADR-086 amendment and a drop-table migration. |
| D4 | Write-slot holder | **The member that runs the work.** The orchestrator claims on enqueue *for* the member; the member loop heartbeats while its run is live; TTL expiry goes to the reconciler. |
| D5 | Public surface for the core redesign | **No new nouns or verbs.** The operator resumes with `spur message send --to <member>`. `spur task assign` stays but routes through `TaskService`. |
| D6 | Public surface for the herdr-derived additions (tasks 12–13) | **Three new verbs under the existing `agent` noun, all needing consent:** `spur agent join` and `spur agent leave` (task 13), and `spur agent report` (task 12). Lifecycle reports need a verb because plugin hooks must stay standalone and can only shell out. |
| D7 | Universal session (execution record) | **Full now.** The run id is Spur's session id (ADR-132): durable per-run stdout/stderr log, `parent_run_id` lineage, and the agent session ids it produced. The read verb is `spur agent trace <runId> [--follow] [--json]` (consent given). |

### 2.4 Alternatives considered (reasons recorded for the ADR guardrail)

| Option | Verdict | Reason |
| --- | --- | --- |
| **herdr transport:** the server owns each agent's terminal; `agent prompt` writes the prompt as keystrokes; state comes from screen-parsing rules plus hooks (`vendors/herdr/src/app/api/agents.rs`, `src/detect/manifests/*.toml`) | **Rejected.** ADR-057 is unchanged. | Delivery is at-most-once with no receipt: "a timeout … does not prove that no input was sent", and "event history is not durable". It needs per-agent screen rules and input workarounds that change between agent versions (e.g. the Codex paste boundary). Its only gain, a human watching the terminal, doesn't justify losing durable receipts. |
| **herdr ideas:** wait pinned to the occupant, prompt and wait as one atomic call, hook state with an always-increasing sequence number, reporting a resume session | **Adopted** in tasks 1, 3, 12 and 2 | Each one strengthens the inbox design without touching its transport |
| **Joining by pid:** take over a running agent from outside | **Not possible** | Typing into another process requires owning its terminal. The kernel route (`TIOCSTI`) is disabled on Linux 6.2+ and restricted on macOS. herdr can't do this either: it only controls agents that run inside its own panes. The cooperative join (task 13) replaces it. |
| **ACP** (tried in early 2026) | **Rejected** | Too slow and unreliable in practice. It is also an editor ↔ agent protocol, not an agent ↔ agent one. |
| **UHP** (`2026-09-28` Draft) | **Rejected for now.** A `uhp` executor is a possible later option. | It standardizes running one task on one harness. Orchestration and messaging are explicit non-goals. It has no mid-run input, and its server-owned workdir conflicts with editing the local repo. |

### 2.5 ADR changes (approved 2026-10-04, landed before implementation)

| ADR | Change |
| --- | --- |
| 057 | Clarify: dispatch is message-plane only; guests pull via their own continuation hook (no new channel). |
| 121 | Guest occupants: interactive sessions may pull inbox work; id-only addressing; no unattested constrained stages. |
| 086 | Layer-3 carriers superseded: no `agent_instances` table, no `.spur/agents` specs. |
| 126 | One dispatcher for workflows and the strategy; timeout is outcome-unknown; `wip` → `--continue`. |
| 132 (new) | Every execution is a run; the run id is Spur's session id (stream log, lineage, agent sessions). |

No change: 112 (heartbeat slot is renewable ownership), 094/102 (fail closed on guests), 059, 116, 129–131.

## 3. Execution sequence

### 3.1 Target architecture

```text
operator ──spur message send──▶ inbox(planner) ─┐
                                                ▼
                         planner loop: drain → MemberSession (LLM reply via inbox)
                                     → strategy.tick()  (deterministic, non-blocking)
                                          │ select (pure) → claim write slot for coder-1
                                          ▼
                         sendMessage(keyed "task:<wbs>:<attempt>", to coder-1,
                                     body "/sp:dev-run <wbs> --auto [--continue]")
                                          ▼
                         inbox(coder-1) ─▶ coder loop: drain → MemberSession run
                                               heartbeat write slot while live
                                               exit sink → coordination_runs(requestMessage)
                                               emits agent.invoke.exit
                                          ▼
                         planner wakes → strategy.observe(): receipt → done / retry / hold
                                       → release slot → next tick
workflow agent.run executor: fleet ──▶ same sendMessage primitive ──▶ waits on the receipt
```

**Invariants**

- The inbox is the only transport between agents and between the operator and an agent. No in-process `runTraced` for fleet work.
- A dispatch is a keyed message. Re-enqueueing is idempotent, so retries use a new `<attempt>` key.
- The strategy's `select` is pure. `reconcile` writes, once per tick.
- The planner never blocks on a member run.

### 3.2 Task sketch (ordered by dependency)

| # | Task | Fixes | After |
| --- | --- | --- | --- |
| 1 | **Shared dispatch primitive** `FleetDispatcher.enqueue(member, work)` in `packages/app`: a keyed message plus a prompt artifact, extracted from `fleet-dispatch.ts`. `fleet-dispatch` keeps its API but waits on the `coordination_runs` receipt keyed by `requestMessage` instead of polling a file; `expectFile` remains a post-condition only. Adopted from herdr: enqueueing and the wait are **one call**, and the wait is **pinned to the occupant**, so a restarted or replaced member can't satisfy it. A timeout returns `outcome-unknown`, never `not-sent`. | C3 | — |
| 2 | **Members drain under a fleet.** Delete the bypass at `agent-loop-service.ts:371`: a non-owner member takes the existing drain → `MemberSession` → settle path. Add a write-slot heartbeat while a drained run is live, scoped to messages carrying a dispatch key. Also seed the resume session from the member's last exact `history_run_session.session_id` (joined by `run_id` to its latest `coordination_runs` row; `coordination_runs` has no session column) when the loop starts, so a supervisor restart keeps the conversation (today the id is only known after the first drain; `member-session.ts:168,310`). This follows herdr's "report the resume command". | C1, D4 | 1 |
| 3 | **Non-blocking GTD.** `strategy.tick()` = `reconcile()` once → pure `select()` → claim the slot for the member → `FleetDispatcher.enqueue`. `strategy.observe()` on `agent.invoke.exit` reads the receipt → done / retry (new attempt key, `MAX_DISPATCH_ATTEMPTS`) / hold → releases the slot. Remove `runTraced` from the loop. A retry happens only on a definite `failed`/`not-started` receipt. `outcome-unknown` holds, and is never re-sent blindly (the herdr lesson: a timeout doesn't mean the work wasn't sent). | C2, H3, H4 | 1, 2 |
| 4 | **Orchestrator converses.** The owner loop drains its own inbox before the tick, and replies go through `replyToMessage`. | C1 (operator path), D2 | 2 |
| 5 | **`wip` and resume.** Candidates are `todo ∪ wip` with `fleet:auto`. A `wip` task, or one with a prior run that isn't done, gets `--continue`. Delete the `beforeDispatch` guard branch (`agent-service.ts:1039`); operator resume is `spur message send --to coder-1 "/sp:dev-run <wbs> --continue"`. | H1, H2, D5 | 3 |
| 6 | **Identity hygiene.** `memberLocalId` stops using `executor` as the id. The fallback is `<role>-<n>`, and a pinned executor no longer renames the instance. This is a breaking change for configs relying on executor-named ids; it goes in the release notes with a config fix-it error. | H5 | — |
| 7 | **Remove team residue (code).** Delete `getStatus`/`orchestrator()`/`TeamOrchestrator` import/`TeamStatus*` (M1). Route `assignTask` through `TaskService.update` (M2). Delete the dead `RosterMember` fields (M3). Rename `team`/`teamService` locals and error text (M6). | M1–M3, M6 | 3 |
| 8 | **Remove team residue (contract + web).** Drop `teamId` from `contracts/fleet.ts`, server `processes`, web `activity-history`/`MemberTerminal`/`ProcessesView`, and the hidden Team filter; update the matching web tests. Coordinate with the concurrent `MemberDetail`/`MemberTerminal` edits. | M5 | 7 |
| 9 | **Drop the instance store.** Add a migration `00NN_drop_agent_instances`; delete `AgentInstanceStore`, `createFileAgentInstanceStore`, `agent-instance.ts`. Members resolve specs from `agent.fleet` (`FleetService.resolve`) and `.spur/agents/` materialization is removed. `loader.ts:359` keeps its retired-key guard. | M4, D3 | 2, 7 |
| 10 | **Docs.** The ADR amendments landed before implementation (057, 121, 086, 126 and new ADR-132; see §2.5). Add an ADR-116 current-reading note once the cleanup lands. Update `03_ARCHITECTURE`, `fleet-config-declaration.md` §5, `inter-agent-control-plane.md` §11. Mark `spur-team-mode-design.md` superseded, delink it from `04_DESIGN.md`, and update `adr-supersession.test.ts`. | M7 | 3, 5, 9 |
| 11 | **E2E receipt.** A scratch-project script runs the §1 *done* scenario, plus `spur agent trace <root-run>` showing the dispatch → member turn lineage with its stream, and writes a JSON receipt to `docs/reports/`. | §1 | 1–6, 12, 13, 15 |
| 12 | **Hook-reported lifecycle** (herdr P2). The `sp` plugin's `SessionStart` / `UserPromptSubmit` / `Stop` hooks call `spur agent report --state working\|idle\|blocked --seq <ns>` when `SPUR_SPEC_ID` is set; outside the fleet they do nothing. The server ignores any report whose `seq` isn't higher than the last one accepted. A new event, `agent.lifecycle.changed`, carries the state. `gtdStrategy` treats `blocked` as unavailable, and the Board shows "needs human". Reporting runs in the background, fails silently, and never slows the agent down. | outcome 6, D6 | 2 |
| 13 | **Cooperative join** (herdr P1; replaces joining by pid). `spur agent join --role <r> [--id <id>]`, run inside a live session, registers a *guest* occupant (pid, session id, executor) under ADR-075 identity. The `sp` skill `fleet-join` loop then repeats: `spur agent wait --inbox` (re-armed before the Bash tool's ~10-min limit) → do the work → `spur message reply`. A Claude `Stop` hook returns `decision: block` with pending inbox messages, so work arrives at turn end. `spur agent leave`, or an expired lease, releases the occupant. Guest members can be dispatched to but are never supervised or restarted, and they hold the write slot only through their heartbeat. | outcome 7, D6 | 2, 12, 14 |
| 14 | **Spike: Codex parity.** (a) Do Codex `hooks.json` `Stop` hooks support a block/continue decision? (herdr installs `SessionStart`/`UserPromptSubmit`/`Stop` for Codex; whether it can block is unverified.) (b) Is `codex app-server` usable as a persistent `MemberSession` mode? Output: a note plus a go/no-go per item. | supports 13 | — |
| 15 | **Execution record** (ADR-132, D7). `spur agent run` and every fleet member turn tee stdout/stderr frames to `.spur/memory/runs/<runId>.log` through the existing `WorkflowRunLogSink` (redacted, ADR-131 retention). The supervisor ring buffer tags frames with the current `run_id`. A migration adds `coordination_runs.parent_run_id`; the dispatch message carries the parent run id. New `spur agent trace <runId> [--follow] [--json]` prints the lineage tree, the agent session ids from `history_run_session`, and the stream. | outcome 8, D7 | 1, 2 |

**Decomposition (coarse, per Robin: do not split too small).** The rows above are work items, not tasks. Three features, nine tasks:

- **Core inbox fleet** (G-series successor to G66): T1 = items 1 + 3 (dispatcher + non-blocking GTD); T2 = items 2 + 4 (member drain/heartbeat + orchestrator converses); T3 = items 5 + 6 (wip/resume + identity); T4 = item 15 (execution record); T5 = item 11 (E2E receipt).
- **Team residue cleanup:** T6 = items 7 + 8 (code + contract/web); T7 = items 9 + 10 (instance store + docs).
- **herdr-derived:** T8 = item 12 (hook lifecycle); T9 = items 13 + 14 (spike first, then cooperative join).

T1, T3's identity half, T6 and T9's spike can start in parallel; the rest follow the "After" column.

**Not changing:** `spur message` verbs and existing `spur agent` verbs (new: `join`/`leave`/`report`/`trace`, consented), the `fleet:auto` authorization, strategy fences, supervisor backoff, `MemberSession` modes, and `DeliveryReconciler` hold reasons.

## 4. Risks and verification

| Risk | Mitigation / decision point |
| --- | --- |
| A member drains a non-dispatch chat message while it holds the write slot | The heartbeat and slot are tied to the dispatch key. A chat message runs read-only: it is refused a write claim and held with `no-idle-instance` semantics until the run ends. |
| Lost receipt: member crashes after the run starts | The existing `DeliveryReconciler` `outcome-unknown` hold plus slot TTL expiry. `observe()` treats an expired slot with no exit receipt as a failed attempt, so the retry goes out with `--continue`. |
| The persistent-mode stdin session swallows the dispatch prompt | Dispatch messages force `one-shot`/`resume` mode per ADR-121, and the reviewer stays fresh (`FRESH_SESSION_ROLES`). |
| The task 6 identity change breaks existing configs | A loud config error naming the old → new id. The repo's `.spur/config.yaml` gets `id: coder-1`. |
| A guest (joined) member goes idle waiting on a human and never drains | Task 12 reports `blocked`/`idle`, so the strategy skips it. An unclaimed dispatch to it times out to `outcome-unknown` → hold, and the Board shows it. Guests are a best-effort capacity source, never the only member for a role. |
| Hook storms or stale reports | Strictly increasing `seq` and a latest-only send, both taken from herdr |
| Concurrent web edits conflict with task 8 | Run it after the current `MemberDetail`/`MemberTerminal` work lands, from a clean tree. |

**Verification:**

- The task 11 E2E receipt is the acceptance artifact.
- Per task: `bun run spur-check`. Per feature: `bun run spur-check-feature`.
- `bun run plugin-smoke` runs before release.
- Tasks 8–10 also need `rg -n "teamId|TeamOrchestrator|TeamStatus|agent_instances" packages apps` to return only migration history and the retired-key guard.

## 5. Follow-up

- **Upstream:** ts-ai-runner still names the classes `TeamAgentProcess` and `TeamOrchestrator`. Ask the library to rename them (`AgentProcess`) and drop `TeamOrchestrator`; Spur keeps importing until then. This is a facade fix, not a Spur shim.
- **A1–A5** become separate tasks. A2 (sandbox inheritance) and A3 (gate isolation) matter most for unattended fleet runs.
- **Repo config:** `.spur/config.yaml` gets `id: coder-1` on the pinned coder (pending from 1069).
- **Deferred:** an optional herdr *visibility* adapter (members launched into herdr panes, with delivery still through the inbox) and a `uhp` executor for containerized members. Revisit after task 11 is green and UHP leaves Draft.
