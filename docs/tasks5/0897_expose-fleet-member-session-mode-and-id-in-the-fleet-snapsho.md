---
schema_version: 1
name: Expose fleet member session mode and id in the fleet snapshot, process entries and agent status, and document the persistent-member contract
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-19T05:54:16.082Z"
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
| R1 | MET | Inherited MET from attempt 1 (live end-to-end: mirror write at apps/cli/src/commands/agent.ts:1524-1536, GET /api/project/fleet carried session {mode: resume, id} and {mode: persistent}; join at apps/server/src/modules/processes/index.ts:56-80; fleet snapshot join at packages/app/src/services/fleet-service.ts:467-483; ledger reader/writer packages/domain/src/dao/member-session.ts:45-118). Re-confirmed this session on 36d18e536: memberSessionSchema at packages/contracts/src/fleet.ts:14-17 (mode enum persistent/resume/one-shot, optional id), MEMBER_SESSION_EVENT/MEMBER_SESSION_RESET_EVENT at packages/domain/src/dao/member-session.ts:24-26, recordMemberSession call sites at apps/cli/src/commands/agent.ts:1530,1679 — surfaces unchanged from the audited diff. |
| R2 | MET | Inherited MET from attempt 1 (live agent status "resume id=cafe1234" / "persistent", list --specs session column, --json full object; unit evidence apps/cli/tests/commands/agent.test.ts:283-346). Re-confirmed this session: shortSessionId/formatSessionColumn at apps/cli/src/commands/agent.ts:468-475, session column in list --specs row at :545 and status row at :593, server feed parser at :658-686 — unchanged. |
| R3 | MET | Inherited MET from attempt 1 (read-only web surface: AgentsView.tsx:245-251, MemberDetail.tsx:140-145, roster.ts:17-20 sessionLabel, malformed-session narrowing MemberTerminal.tsx:44-56; tests roster.test.ts:229-234, AgentsView.test.tsx:300-330, MemberDetail.test.tsx:294-301). Diff stat confirms those exact files in 36d18e536; not re-audited live per instructions. |
| R4 | MET | Inherited MET from attempt 1 (docs/design/fleet-config-declaration.md "Member sessions (G66 / task 0897)" section + plugins/sp/skills/spur-cli/references/agent.md:256-272 mode table, reset triggers, no-redelivery invariant). Diff stat confirms both doc files in 36d18e536 (+30 / +47 lines). |
| R5 | MET | Full gate on record: .spur/run/0897-test-gate.log lines 379-382 — 8554 pass / 0 fail across 485 files, plus recommended-post-check rules, biome check, per-workspace typecheck. bun run test-cf CONFIRMED GREEN THIS SESSION (was the sole PARTIAL cause): `cd apps/server && bun run test-cf` on b11e20c86 → "Test Files  1 passed (1) / Tests  1 passed (1)", Duration 983ms, exit 0 (run at 2026-09-18 22:30:32). The prior miniflare/workerd macOS 26.5 blockage is fixed by HEAD b11e20c86 ("restore test-cf on macOS 26.5; unify ts-* deps on 0.4.69"). Both halves of R5 now pass — no remaining non-MET row. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | AC label: Session mode and id are observable (req R1). Attempt 1 live evidence: curl of GET /api/project/fleet on temp project returned member session {mode: resume, id: 3f9c2a1d-...} and {mode: persistent}; agent status rendered "resume id=cafe1234" / "persistent". Test evidence fresh this session: contract/OpenAPI/producer suites green on record (contract.test.ts:483-569, openapi.test.ts:22-44, processes/index.test.ts, fleet-service.test.ts within the 8554/0 gate) and schema surface spot-verified at packages/contracts/src/fleet.ts:14-17. |
| AC2 | MET | test | AC label: Resumed sessions never redeliver settled messages (req R4). EVIDENCE CLASS UPGRADED from attempt 1's manual-review + static-ref to TEST: fresh runs this session — apps/cli: `bun test tests/commands/agent-loop-member-session.test.ts tests/commands/agent-team.test.ts` → 35 pass / 0 fail (158 expect() calls, 1.64s), covering the loop mirror-write rows (loop-member-session, +44 lines in 36d18e536) and team loop delivery behavior; packages/domain: `bun test tests/dao/member-session.test.ts` → 4 pass / 0 fail (record/reset ledger semantics incl. reset row clearing the id); plus the gate redelivery/regression coverage on record (8554/0 full gate incl. agent.test.ts rendering + agent-server.test.ts) and the regenerated plugin bundle (idea-handoff.generated.mjs) covered by the gate's plugin tests. Attempt 1's hunk-boundary audit stands as supporting static evidence: only additive recordMemberSession mirror writes with .catch(() => undefined) at agent.ts:1524-1536/1674-1686; no reconcile-before-first-drain, inbox-settle, or delivery code touched — so the 0831/0834 no-redelivery guarantee is structurally unchanged, now backed by passing tests rather than review alone. |
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

