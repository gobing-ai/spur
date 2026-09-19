---
schema_version: 1
name: Expose fleet member session mode and id in the fleet snapshot, process entries and agent status, and document the persistent-member contract
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-19T06:33:06.954Z"
feature_id: G66
priority: P2
tags:
  - fleet
  - observability
  - G66
estimate_hours: 4

dependencies: ["0896"]
---

## 0897. Expose fleet member session mode and id in the fleet snapshot, process entries and agent status, and document the persistent-member contract

### Background

Task 9 gives each member a session. Operators need to see it: `GET /api/project/fleet`, `GET /api/processes`, `spur agent status` and `spur agent list --specs` show no session information. Authority: `docs/design/session-pinned-dispatch.md` §6 (observability row), AC R5/R6; ADR-057 (durable artifacts, no terminal scraping).

### Requirements

- [x] R1. The fleet snapshot member entry and the process entry carry `session: {{ mode, id }}` (id absent for `one-shot`); the oRPC contract in `packages/contracts` is extended and OpenAPI regenerated.
- [x] R2. `spur agent status` and `spur agent list --specs` render mode and a shortened id; `--json` carries the full object.
- [x] R3. The Board `AgentsView` / `MemberDetail` show the session mode (read-only text; no new interaction).
- [x] R4. The fleet design satellite (`fleet-config-declaration.md` or its successor) and `plugins/sp/skills/spur-cli/references/agent.md` document the three modes, the reset reasons and the no-redelivery invariant.
- [x] R5. Tests cover the contract shape and the CLI rendering; `bun run spur-check` and `bun run test-cf` pass.

### Acceptance Criteria

Covers feature G66 scenarios R5, R6.

- [x] AC1 — Session mode and id are observable (req: R1)
- [x] AC2 — Resumed sessions never redeliver settled messages (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: session identity is exposed through the existing snapshot/process surfaces, not a new endpoint (docs/design/session-pinned-dispatch.md §6; ADR-057 durable artifacts). Board change is display-only so no `DESIGN.md` token work is needed. Mutation policy: fleet snapshot + process entry producers (`fleet-service.ts`, supervisor process registry), `packages/contracts` + generated OpenAPI, CLI renderers, `apps/web` `AgentsView`/`MemberDetail`, tests, satellites; no loop behaviour changes (task 9).

### Plan

1. Read design §6, the fleet snapshot and process-entry producers, and the contracts for `/api/project/fleet` and `/api/processes`.
2. Add the `session` field end to end (producer → contract → OpenAPI → web).
3. Render in `agent status` / `agent list --specs`; update satellites and `agent.md`.
4. Write the tests; run `bun run spur-check` and `bun run test-cf`.
5. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:1527` |
| `apps/cli/src/commands/agent.ts:1677` |
| `apps/cli/src/commands/agent.ts:226` |
| `apps/cli/src/commands/agent.ts:34` |
| `apps/cli/src/commands/agent.ts:38` |
| `apps/cli/src/commands/agent.ts:467` |
| `apps/cli/src/commands/agent.ts:499` |
| `apps/cli/src/commands/agent.ts:502` |
| `apps/cli/src/commands/agent.ts:521` |
| `apps/cli/src/commands/agent.ts:535` |
| `apps/cli/src/commands/agent.ts:543` |
| `apps/cli/src/commands/agent.ts:545` |
| `apps/cli/src/commands/agent.ts:605` |
| `apps/cli/src/commands/agent.ts:618` |
| `apps/cli/src/commands/agent.ts:625` |
| `apps/cli/src/commands/agent.ts:627` |
| `apps/cli/src/commands/agent.ts:993` |
| `apps/cli/tests/commands/agent-loop-member-session.test.ts:25` |
| `apps/cli/tests/commands/agent-loop-member-session.test.ts:503` |
| `apps/cli/tests/commands/agent-server.test.ts:208` |
| `apps/cli/tests/commands/agent-server.test.ts:239` |
| `apps/cli/tests/commands/agent.test.ts:16` |
| `apps/cli/tests/commands/agent.test.ts:230` |
| `apps/cli/tests/json-envelope-inventory.test.ts:283` |
| `apps/server/src/modules/processes/index.ts:1` |
| `apps/server/src/modules/processes/index.ts:56` |
| `apps/server/src/modules/processes/index.ts:62` |
| `apps/server/src/modules/processes/index.ts:7` |
| `apps/server/src/modules/processes/index.ts:74` |
| `apps/server/tests/modules/processes/index.test.ts:22` |
| `apps/server/tests/modules/processes/index.test.ts:3` |
| `apps/server/tests/modules/processes/index.test.ts:65` |
| `apps/server/tests/modules/processes/index.test.ts:757` |
| `apps/server/tests/openapi.test.ts:21` |
| `apps/web/src/modules/projects/AgentsView.tsx:245` |
| `apps/web/src/modules/projects/AgentsView.tsx:5` |
| `apps/web/src/modules/projects/MemberDetail.tsx:140` |
| `apps/web/src/modules/projects/MemberDetail.tsx:6` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:15` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:44` |
| `apps/web/src/modules/projects/MemberTerminal.tsx:63` |
| `apps/web/src/modules/projects/roster.ts:115` |
| `apps/web/src/modules/projects/roster.ts:15` |
| `apps/web/src/modules/projects/roster.ts:53` |
| `apps/web/src/modules/projects/roster.ts:84` |
| `apps/web/src/modules/projects/useProjectContext.tsx:39` |
| `apps/web/tests/modules/projects/AgentsView.test.tsx:283` |
| `apps/web/tests/modules/projects/AgentsView.test.tsx:73` |
| `apps/web/tests/modules/projects/MemberDetail.test.tsx:269` |
| `apps/web/tests/modules/projects/MemberDetail.test.tsx:53` |
| `apps/web/tests/modules/projects/MemberTerminal.test.tsx:112` |
| `apps/web/tests/modules/projects/roster.test.ts:213` |
| `apps/web/tests/modules/projects/roster.test.ts:3` |
| `apps/web/tests/modules/projects/roster.test.ts:54` |
| `apps/web/tests/modules/projects/roster.test.ts:68` |
| `packages/app/src/services/fleet-service.ts:15` |
| `packages/app/src/services/fleet-service.ts:467` |
| `packages/app/src/services/fleet-service.ts:86` |
| `packages/app/tests/services/fleet-service.test.ts:439` |
| `packages/app/tests/services/fleet-service.test.ts:6` |
| `packages/contracts/src/index.ts:33` |
| `packages/contracts/src/index.ts:4` |
| `packages/contracts/src/index.ts:41` |
| `packages/contracts/tests/contract.test.ts:15` |
| `packages/contracts/tests/contract.test.ts:481` |
| `packages/domain/src/dao/index.ts:24` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `memberSessionSchema` `packages/contracts/src/fleet.ts:14-17` on fleet member `:31` and process entry `:71`. Snapshot join `packages/app/src/services/fleet-service.ts:467-479`. Process join `apps/server/src/modules/processes/index.ts:63-74`. Ledger `packages/domain/src/dao/member-session.ts:35-46` / `:77-105`. Tests this turn: `packages/contracts/tests/contract.test.ts:482-568` (4 pass); `packages/app/tests/services/fleet-service.test.ts:439` (session join); `apps/server/tests/modules/processes/index.test.ts:758-795` (2 pass, suite 30/30). |
| R2 | MET | `formatSessionColumn` / `shortSessionId` `apps/cli/src/commands/agent.ts:468-476`; list `--specs` column `:545`; status `:593`; `--json` full object `:508-523` / `:581-583`. Tests this turn: `apps/cli/tests/commands/agent.test.ts:283-345` (5 session-rendering tests pass inside 55/55). |
| R3 | MET | Read-only Board: `sessionLabel` `apps/web/src/modules/projects/roster.ts:18-20`; `AgentsView.tsx:245-250`; `MemberDetail.tsx:140-144`. Tests this turn: `apps/web/tests/modules/projects/roster.test.ts:229-233`; `AgentsView.test.tsx:287-303`; `MemberDetail.test.tsx` session line — 45 pass / 0 fail across 3 files. |
| R4 | MET | `docs/design/fleet-config-declaration.md:127-155` (three modes, reset reasons, no-redelivery). `plugins/sp/skills/spur-cli/references/agent.md:254-272` (mode table, reset triggers, invariant). Re-read this turn. |
| R5 | MET | This turn: `cd apps/server && bun run test-cf` → Test Files 1 passed (1), Tests 1 passed (1), Duration 2.14s, exit 0. Contract/CLI/web/domain suites above all pass. `bun run spur-check` exit 0: **8577 pass / 0 fail across 486 files** + 2 post-check rules. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — Session mode and id are observable | MET | test | Contract `packages/contracts/tests/contract.test.ts:483`; fleet join `packages/app/tests/services/fleet-service.test.ts:439`; processes `apps/server/tests/modules/processes/index.test.ts:768`; CLI `apps/cli/tests/commands/agent.test.ts:283-345`; web `apps/web/tests/modules/projects/AgentsView.test.tsx:287`. Schema `packages/contracts/src/fleet.ts:14-17`. This turn: all listed suites pass. |
| R6 — Resumed sessions never redeliver settled messages | MET | test | `apps/cli/tests/commands/agent-loop-member-session.test.ts:251` (resume + no redelivery) and `:505` (ledger mirror + reset clears id); G61 settle suites in `apps/cli/tests/commands/agent-team.test.ts` (this turn 35 pass / 0 fail across those two files). Domain reset-clears-id `packages/domain/tests/dao/member-session.test.ts` 4/4. Loop still settles via `apps/cli/src/commands/agent.ts:1660` after resume flags `:1650-1653`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Attempt-1 fresh review (sp-super-reviewer, fresh session, run inline-G66-20260918T204139): **APPROVE** (functional PASS · SECUA PASS · architecture PASS). Full report: `.spur/run/inline-G66-20260918T204139-review-0897.txt`.

| Priority | Dimension | Finding | Location | Disposition |
|----------|-----------|---------|----------|-------------|
| P3 | efficiency | `readMemberSessions` unbounded: both 3s-polled endpoints scan full session-event history per poll (no `(event_name, actor)` composite index); correct today, O(history) ceiling with `MAX(sequence)` fix path | `packages/domain/src/dao/member-session.ts:77-110` | Accepted named ceiling; add index + window query if poll cost ever shows |
| P4 | correctness | `memberSessionSchema` accepts `{mode:'one-shot', id}` — producers enforce id-absence, schema not self-defending | `packages/contracts/src/fleet.ts:14-18` | Advisory; `superRefine` when contracts harden |
| P4 | architecture | Web redeclares `MemberSession` locally despite contracts dep (follows file's local-interface convention) | `apps/web/src/modules/projects/useProjectContext.tsx:41-47` | Advisory |
| P4 | security | CLI trusts server `session` shape via type assertion without runtime narrowing (trusted internal boundary; web path narrows) | `apps/cli/src/commands/agent.ts:613-632` | Advisory |

Evidence: 283 fresh tests across 6 workspaces all pass; gate 8554/0 + post-check rules PASS. R5 `test-cf` environment-blocked (miniflare segfault, zero tests executed, reproduced on clean base eae5c7ac6; bun 1.3.14 + miniflare 4.20260526.0 pre-existing defect) — recorded, not counted as met. AC2 no-redelivery invariant verified untouched by hunk-boundary audit.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T22:39:58.577Z todo → wip (system)
- 2026-09-18T22:39:58.956Z wip → testing (system)
- 2026-09-19T05:54:16.082Z testing → done (system)

