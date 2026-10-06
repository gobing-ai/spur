---
schema_version: 1
name: Report agent lifecycle from host hooks through spur agent report
status: done
template: feature-impl
created_at: 2026-10-04T20:30:39.110Z
updated_at: "2026-10-06T19:39:31.644Z"
feature_id: G73

dependencies: ["1074", "1078"]
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1080-verdict.json
---

## 1080. Report agent lifecycle from host hooks through spur agent report

### Background

Implements G73 R1 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 item 12; herdr finding P2; decision D6, `spur agent report` consented).

herdr derives agent state from host hooks (SessionStart / UserPromptSubmit / Stop, monotonic `--seq`) rather than screen scraping (`vendors/herdr/src/integration/assets/claude/herdr-agent-state.sh`). Spur's strategy cannot tell a member blocked on a human from an idle one today. Hooks stay standalone glue (ADR-065, ADR-130) and only shell out to the CLI.

**Refine corrections (2026-10-04)**

- R4's three events can't express `blocked`. SessionStart/UserPromptSubmit/Stop give only idle/working. herdr's Claude hook reports session identity only (`vendors/herdr/src/integration/assets/claude/herdr-agent-state.sh:54`), and its Pi `blocked` comes from a herdr-private event bus (`vendors/herdr/src/integration/assets/pi/herdr-agent-state.ts:211`) → Claude adds a `Notification` hook for permission prompts → `blocked`. Pi maps `agent_start` → working and `agent_settled` → idle; Pi `blocked` is deferred because Pi has no native event.
- `SPUR_SPEC_ID` is set only for supervised persistent members (`packages/app/src/services/supervisor-service.ts:230`), not for drained `svc.run` members → `AgentService` exports `SPUR_SPEC_ID` to the child env whenever the run carries `spec-id`, using the same env seam as `SPUR_ROLE` (`packages/app/src/services/agent-service.ts:409`).
- Hooks are TS files run via `superskill hook run sp <name>` (`plugins/sp/hooks/hooks.json`), not shell scripts. The plugin-standalone contract applies: `node:*`/`bun:*` and relative imports only.
- The Board member view overlaps 1078's `teamId` edits (`ProcessesView.tsx`) and the other session's uncommitted `MemberDetail.tsx` → put the badge in the member row component that 1078 leaves, not in `MemberDetail.tsx`.

### Requirements

- [x] R1. `spur agent report --state working|idle|blocked --seq <ns>` records the member's lifecycle state; a report whose `seq` is not greater than the last accepted one is ignored.
- [x] R2. Accepted transitions emit cataloged event `agent.lifecycle.changed` with a presenter (ADR-066).
- [x] R3. `gtdStrategy` treats `blocked` as unavailable; the Board shows "needs human" on that member.
- [x] R4. The `sp` plugin's Claude hooks report in the background only when `SPUR_SPEC_ID` is set — SessionStart→idle, UserPromptSubmit→working, Notification (permission prompt)→blocked, Stop→idle; outside a fleet they exit immediately; failures are silent and never delay the agent. `AgentService` exports `SPUR_SPEC_ID` to every fleet member run. Pi reports working/idle through its extension (ADR-129); Pi `blocked` is deferred.

### Acceptance Criteria

- [x] AC1 — Agents report lifecycle through hooks

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

G73 R1–R4 land as one ledger-backed lifecycle plane: Hook → CLI → ledger → strategy/Board. The state is the newest accepted `agent.lifecycle.changed` row (G73 Q&A, CLOSED — no new table, no second state store).

| Change | Anchor |
| --- | --- |
| `AGENT_LIFECYCLE_EVENT` names the ledger row that carries the state | `packages/domain/src/dao/member-lifecycle.ts:22` |
| `recordLifecycle` owns the strict `>` seq guard (a stale report writes nothing) | `packages/domain/src/dao/member-lifecycle.ts:69` |
| `readLifecycle` returns the newest accepted row per actor, skipping malformed payloads | `packages/domain/src/dao/member-lifecycle.ts:96` |
| `recordLifecycle` public re-export for the app/CLI consumers | `packages/domain/src/dao/index.ts:32` |
| Catalog entry `agent.lifecycle.changed` (agent source, metadata-only) | `packages/app/src/services/event-names.ts:305` |
| Presenter for `agent.lifecycle.changed`: member/state/seq, summary `[agent] <member> · <state>` | `packages/app/src/services/event-names.ts:845` |
| `reportLifecycle` service hop (delegates the guard; the row is the emitted event) | `packages/app/src/services/agent-coordination-service.ts:563` |
| `setSpecIdEnv` seam on the role-propagation executor | `packages/app/src/services/agent-service.ts:402` |
| `SPUR_SPEC_ID` stamp for every spec-id-addressed run (the drained-member fix) | `packages/app/src/services/agent-service.ts:1312-1316` |
| `memberLifecycle` map on `StrategyContext` (strategy stays pure) | `packages/app/src/services/strategy-runtime.ts:125` |
| Blocked members excluded from `idle` allocation, kept in context for the hold | `packages/app/src/services/strategy-runtime.ts:207-210` |
| `member-blocked` added to `DispatchHoldReason` | `packages/app/src/services/strategy-runtime.ts:87` |
| `member-blocked` hold emitted with the member id | `packages/app/src/services/strategy-runtime.ts:276` |
| Snapshot `memberLifecycle` load (unreadable ledger degrades to nobody blocked) | `packages/app/src/services/strategy-runtime.ts:714` |
| `readLifecycle` join putting `lifecycle` on each resolved member | `packages/app/src/services/fleet-service.ts:528` |
| `report` verb registration (`--state`, `--seq`, `--spec`, `--json`) | `apps/cli/src/commands/agent.ts:392` |
| `runAgentReport` handler with the exit-2 usage contract | `apps/cli/src/commands/agent.ts:711` |
| `memberLifecycleSchema` (state/seq/at) for the transport DTO | `packages/contracts/src/fleet.ts:27` |
| `lifecycle` field added to the fleet member DTO | `packages/contracts/src/fleet.ts:46` |
| `lifecycle` client-side mirror on the member type | `apps/web/src/modules/projects/useProjectContext.tsx:45` |
| "needs human" badge on the member row (`data-member-needs-human`) | `apps/web/src/modules/projects/ProcessesView.tsx:455` |
| `lifecycleStateFor` event map (SessionStart/UserPromptSubmit/Notification/Stop, Pi names) | `plugins/sp/hooks/agent-lifecycle.ts:51` |
| `reportLifecycleHook` core: no `SPUR_SPEC_ID` → no spawn; else detached, unref'd, silent | `plugins/sp/hooks/agent-lifecycle.ts:114` |
| `runHookFromStdin` / `parseHookPayload`: testable fail-open entrypoint | `plugins/sp/hooks/agent-lifecycle.ts:143` |
| `agent-lifecycle` hook registration (SessionStart/UserPromptSubmit/Notification/Stop, timeout 5) | `plugins/sp/hooks/hooks.json:38` |
| `permission_prompt` matcher on the Notification entry (per https://docs.claude.com/en/docs/claude-code/hooks) | `plugins/sp/hooks/hooks.json:57` |
| Pi `agent_start` handler reporting through the same core | `plugins/sp/hooks/pi/guard-extension.ts:275` |
| Regenerated plugin-lib twin carrying the catalog/presenter change | `plugins/sp/lib/inline-run.generated.mjs` |

Docs kept in the same change (T3/T4): the verb and flags in `docs/help/cmd_agent.md:122`, `docs/help2/agent.md:68` and `plugins/sp/skills/spur-cli/references/agent.md:28`; the CLI matrix cell/counts in `docs/help/spur-cli-matrix.md:51`, `:72`, `:96`; and the §11 presenter row in `docs/design/event-tracking.md:307`.

Tests pinning the Plan's failure list: `packages/domain/tests/dao/member-lifecycle.test.ts:27` (stale seq 3-then-2 keeps 3, ties drop, malformed skips, per-actor isolation); `packages/app/tests/services/strategy-runtime.test.ts:320` (blocked unavailable, only-blocked-held, absent-never-blocks); `packages/app/tests/services/fleet-service.test.ts:501` (snapshot join); `apps/cli/tests/commands/agent-report.test.ts:28` (member-id default, stale drop, exit-2 usage); `plugins/sp/hooks/agent-lifecycle.test.ts:41` (event map, no-fleet no-spawn, detached default spawn via a `spur` shim on PATH, fail-open entrypoint, binary exit 0).

Verification in this phase: `bun run spur-check` PASS (10119 pass / 0 fail) after two bounded remediation passes (env-var-hygiene routed the hook test through `lib/env`; the 0699 `--json-envelope` census moved 70→71 for the new verb); `bun run plugin-smoke` PASS; `bun run test-cf` PASS; per-workspace typechecks clean; `tsc -p plugins/sp/tsconfig.json` clean.

Deferred, recorded not folded in: Pi `blocked` (no native Pi permission event) and the guest-join half of G73 both belong to task 1081.


Re-verify fix (2026-10-06, `/sp:dev-verifyall --feature G73 --fix all`): `readLifecycle` now resolves each member by the highest payload `seq` rather than the newest row (`packages/domain/src/dao/member-lifecycle.ts:116`), so two detached hook processes interleaving the writer's read-then-insert can no longer regress the state; pinned by `packages/domain/tests/dao/member-lifecycle.test.ts:100`. Anchors above re-pointed after later commits moved `agent.ts` and `strategy-runtime.ts`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/member-lifecycle.ts:75` drops a report whose seq is not strictly greater than the current one; `packages/domain/src/dao/member-lifecycle.ts:116` (re-verify fix) makes the reader return the highest-seq row, so two detached hook processes racing read-then-insert can no longer regress the state; `apps/cli/src/commands/agent.ts:392` registers `spur agent report` and `apps/cli/src/commands/agent.ts:711` is its handler. Executable: `packages/domain/tests/dao/member-lifecycle.test.ts:100` (racing seq 5 then 3 resolves to 5; a later seq 4 is still dropped) plus the stale/tie/malformed cases — 7 pass; `apps/cli/tests/commands/agent-report.test.ts:28` — 5 pass, run this pass. |
| R2 | MET | `packages/app/src/services/event-names.ts:305` catalogs `agent.lifecycle.changed` and `packages/app/src/services/event-names.ts:845` is its presenter; `packages/domain/src/dao/member-lifecycle.ts:22` names the ledger row the writer inserts. Executable: `packages/app/tests/services/event-names.test.ts` presenter matrix and catalog gate inside the 124-test app run, 0 fail. |
| R3 | MET | `packages/app/src/services/strategy-runtime.ts:210` excludes blocked members from allocation and `packages/app/src/services/strategy-runtime.ts:276` holds with `member-blocked`; `packages/app/src/services/fleet-service.ts:528` joins the state onto the snapshot; `apps/web/src/modules/projects/ProcessesView.tsx:458` renders `needs human`. Executable: `packages/app/tests/services/strategy-runtime.test.ts:320`, `packages/app/tests/services/strategy-runtime.test.ts:344`, `packages/app/tests/services/fleet-service.test.ts:502`, run this pass. |
| R4 | MET | `plugins/sp/hooks/agent-lifecycle.ts:51` maps SessionStart/UserPromptSubmit/Notification/Stop and the Pi events; `plugins/sp/hooks/agent-lifecycle.ts:114` spawns nothing without `SPUR_SPEC_ID` and otherwise spawns detached at `plugins/sp/hooks/agent-lifecycle.ts:90`; `plugins/sp/hooks/hooks.json:57` carries the `permission_prompt` matcher; `plugins/sp/hooks/pi/guard-extension.ts:275` wires Pi; `packages/app/src/services/agent-service.ts:1316` exports `SPUR_SPEC_ID` to spec-id-addressed runs. Executable: `plugins/sp/hooks/agent-lifecycle.test.ts:41` within the 52-test plugin hook run, 0 fail; `bun run plugin-smoke` PASS this pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Agents report lifecycle through hooks | MET | test | `plugins/sp/hooks/agent-lifecycle.test.ts:41` (event mapping, no `SPUR_SPEC_ID` means no CLI call, detached argv, fail-open exit 0), `apps/cli/tests/commands/agent-report.test.ts:28` (seq 3 then 2 keeps 3), `packages/domain/tests/dao/member-lifecycle.test.ts:100` (racing reports cannot regress the state), `packages/app/tests/services/strategy-runtime.test.ts:320` (blocked member skipped with a hold reason). Commands this pass: `bun run plugin-smoke` PASS; `bun run test-cf` PASS; `bun run spur-check` 10209 pass / 7 fail, all 7 environmental or pre-existing and outside this scope (sandbox-denied git hook templates, Chromium DevTools port, 1059 WT-4 cases 1/6) — `.spur/run/g73-verifyall-gate.log`. Limitation: no live Claude Code permission prompt fired here; the matcher follows `https://docs.claude.com/en/docs/claude-code/hooks`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of 1080 (`/sp:dev-review --tasks 1080 --auto`) — three dimensions over the 28-file diff (1255 insertions / 18 deletions; diffstat `sensitive: true`, lane `safety`).

**Findings**

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| P1 (blocker) | — | none: no gate, provenance or safety invariant is breached; the ledger guard, the fail-open hook and the emission path all behave as specified | closed |
| P2 (major) | — | none: no missing requirement, no untested production branch that the task's AC depends on | closed |
| P3 (minor) | `recordLifecycle`'s monotonic guard is read-then-insert (TOCTOU) — two concurrent reports can interleave so a lower `seq` lands last, and `readLifecycle` (newest-row-wins) then reports the older state until the next accepted report. Bounded and self-healing; a UNIQUE index on `(actor, seq)` or a single conditional INSERT would close it | accepted as-is for this task; the second reporter arrives with 1081 (guest join), which can add the constraint if the fleet then reports from more than one process per member |
| P3 (minor) | `--seq` accepts any finite number, including negative or fractional values; a nonsense first report is accepted (and immediately superseded by any real ns value) | accepted; the strict `>` guard makes the window harmless, and rejecting it would add a validation surface the hooks never need |
| P4 (advisory) | `plugins/sp/lib/inline-run.generated.mjs` is rewritten by the test suite itself (a tracked build artifact). A write after the `proofDigest` capture would read as post-capture drift; here the write happened in an earlier failing gate pass, so the captured digest includes it and the bracket holds | recorded for 1089 (worktree/evidence scope), not fixed here — the write is a build artifact, not a source mutation |
| P4 (advisory) | Pi `blocked` stays unimplemented because Pi exposes no permission-prompt event | declared in the task's Design/refine notes; the mapping simply has no Pi `blocked` input, so nothing silently reports a wrong state |

**Traceability (R → evidence)**

- R1 (report + monotonic drop) → `packages/domain/src/dao/member-lifecycle.ts:69`, `apps/cli/src/commands/agent.ts:711`, tests `packages/domain/tests/dao/member-lifecycle.test.ts:27`, `apps/cli/tests/commands/agent-report.test.ts:28`.
- R2 (cataloged event + presenter) → `packages/app/src/services/event-names.ts:305`, `:845`, §11 row `docs/design/event-tracking.md:307`, presenter gate test PASS.
- R3 (blocked unavailable + Board) → `packages/app/src/services/strategy-runtime.ts:207`, `:276`, `packages/app/src/services/fleet-service.ts:528`, `apps/web/src/modules/projects/ProcessesView.tsx:455`, tests `packages/app/tests/services/strategy-runtime.test.ts:320`, `packages/app/tests/services/fleet-service.test.ts:501`.
- R4 (hook glue + `SPUR_SPEC_ID` export) → `plugins/sp/hooks/agent-lifecycle.ts:51`, `plugins/sp/hooks/hooks.json:38`, `plugins/sp/hooks/pi/guard-extension.ts:275`, `packages/app/src/services/agent-service.ts:1316`, test `plugins/sp/hooks/agent-lifecycle.test.ts:41`, plus `bun run plugin-smoke` PASS.

**SECUA**

- Security: the hook passes argv to `spawn` without a shell (`plugins/sp/hooks/agent-lifecycle.ts:90`), so member ids and sequences cannot inject; no new network, file or credential surface; `SPUR_SPEC_ID` is read from the member's own env, never from the payload.
- Efficiency: one indexed read per report (`readLifecycle` filters by event name + actor); the hook spawns detached and unref'd, so it never sits on the agent's turn; the strategy loads lifecycle inside the one snapshot read it already performs, and a read failure degrades to "nobody blocked" instead of failing the tick.
- Correctness: the strict `>` rule is implemented once, in the domain; the state reader is order-independent (malformed payloads skipped rather than rendered); a report whose member is unknown is still recorded (no spec-existence requirement was asked for, and the roster join simply omits it).
- Usability: `needs human` is a single badge on the existing member row, with a title explaining the hold; the CLI prints an explicit "ignored stale report" line rather than silence.
- Architecture: no new table, no second state store, no bus/ledger double-write; the hook core is shared by the Claude hooks and the Pi extension instead of duplicating the mapping.

**Residual risk**

- The host-hook firing is verified at the seam we own (mapping, spawn args, fail-open exit, binary exit 0) and through the CLI verb; no real Claude Code session fired a `Notification` permission prompt in this environment, so the end-to-end delivery of the first `blocked` report rests on the documented matcher plus the unit seam.
- A blocked member that never reports again stays blocked forever (no TTL). Acceptable now: the member's next hook fires within a turn; a lease/TTL would belong to 1081's lease work.

**Disposition:** accept. No P1/P2; two P3s accepted with a recorded follow-up path; two P4s recorded.


**Re-verify addendum (2026-10-06).** The P3 read-then-insert race is now **fixed**, not accepted: the reader picks the highest `seq` (`packages/domain/src/dao/member-lifecycle.ts:116`, test `packages/domain/tests/dao/member-lifecycle.test.ts:100`). The `--seq` range P3 and both P4s stand as recorded.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:50.309Z backlog → todo (system)
- 2026-10-05T14:27:14.840Z todo → wip (system)
- 2026-10-05T14:45:35.063Z wip → testing (system)
- 2026-10-05T14:46:38.669Z testing → done (system)

