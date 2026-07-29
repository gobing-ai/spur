---
template: feature-impl
schema_version: 1
name: "Author and emit the team.* event family for team and member lifecycle"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "teams", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.025Z"
updated_at: "2026-07-29T04:50:54.511Z"
---

## 0371. Author and emit the team.* event family for team and member lifecycle

### Background

There is no `team.*` event family anywhere in SYSTEM_EVENT_CATALOG. Team lifecycle operations — `spur team up`, `down`, `assign`, and the server's POST /api/team/:team/up and /down — emit nothing. The only adjacent signal is `agent.started`/`agent.stopped` from TeamOrchestrator and `process.spawned|exited|stopped` from SupervisorService, of which the entire ledger holds 3 rows. Meanwhile the Teams Activity tab already filters for the `'team.'` and `'supervisor.'` prefixes (ActivityTab.tsx:72) — prefixes that have never once fired. The Supervisor tabview in feature J4 has no data to render until this family exists, which is precisely the gap the operator anticipated when requesting it.

### Requirements
- [x] R1. Define the `team.*` catalog entries covering team up, team down, member assignment, and member state change, with renderers, tiers, and payload policies consistent with the existing families.
- [x] R2. Emit them from the owning services (TeamService, TeamOrchestrator, SupervisorService) on the injected event bus, following the existing `agent.*` wiring precedent from task 0237.
- [x] R3. Payloads carry `teamId`, `memberId`, and `agentType` plus the operation outcome; they stay metadata-only, with no message bodies or command lines.
- [x] R4. Resolve the row `actor` to the member identity via the existing `extractSystemEventActor` contract, extending it only if the member identity is not already reachable through `actor` or `agentId`.
- [x] R5. An event referencing a member absent from the current roster must persist with null unresolved fields rather than being dropped.
- [x] R6. Ensure the events reach the ledger from both the server path and the CLI path, consistent with the bridge task.
- [x] R7. Add the new entries to the producer audit table with emit site and reachability status.
### Acceptance Criteria
```gherkin
Scenario: R15 — Team lifecycle transitions emit cataloged events
Scenario: R16 — Member state changes are attributable to a team and an agent type
Scenario: R17 — A team event for an unknown member still persists
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach:** Catalog five default-tier, metadata-only `team.*` events and emit them from the owning services on the injected EventBus, matching the `agent.*` / `message.*` pattern (optional bus, failure-isolated).

**Invariants:**
- Payloads are metadata-only (`teamId`, `memberId`/`memberCount`, `agentType`, `outcome`, optional `taskId`) — never message bodies or argv (R3).
- Unknown roster members still emit with null unresolved fields (R5); events are never dropped for missing identity.
- Dry-run `materializeTeam({ check: true })` does not emit `team.up`.
- Supervisor `stop()` claims `team.member.stopped` before kill so natural exit does not double-row.
- `extractSystemEventActor` prefers `actor` → `agentId` → `memberId` (R4).

**Tradeoffs:** CLI ledger attach for `team up|down|assign` only; supervisor-driven `team.member.started|stopped` remain Board-path (same residual as `process.*`). Orchestrator bridge re-emits `team.member.*` from `agent.started|stopped` so the team family reaches the ledger when TeamService owns the path.
### Plan
1. Register `team.up|down` and `team.member.assigned|started|stopped` in `SYSTEM_EVENT_CATALOG` with source/renderer `team`.
2. Extend `extractSystemEventActor` with `memberId` fallback (app tap + server SSE path).
3. Emit lifecycle events from TeamService (`materializeTeam` / `teardownTeam` / `assignTask`) and bridge TeamOrchestrator `agent.*` → `team.member.*`.
4. Emit member start/stop from SupervisorService with stop/exit dedupe.
5. Attach CLI EventBus + system-event ledger for `spur team up|down|assign`.
6. Update producer audit table; export types from `packages/app`.
7. Unit tests for catalog, R15–R17, orchestrator bridge (start+stop), supervisor emit, actor extraction.
### Solution
Change map (task 0371 — author and emit the `team.*` event family):

- `packages/app/src/services/event-names.ts:115` — source `'team'`; five default-tier, metadata-only catalog entries: `team.up`, `team.down`, `team.member.assigned`, `team.member.started`, `team.member.stopped` (R1).
- `packages/app/src/services/system-event-tap.ts:147` + `apps/server/src/modules/events/index.ts:25` — `extractSystemEventActor` falls back to `memberId` after `actor`/`agentId` (R4).
- `packages/app/src/services/team-service.ts:688` — emits `team.up` from `materializeTeam` (written path only; dry-run silent); `:718` `team.down` from `teardownTeam`; `:476` `team.member.assigned` from `assignTask`; `:820`–`:838` bridges TeamOrchestrator `agent.started|stopped` → `team.member.*` (R2). Payloads carry `teamId`/`memberCount` or `teamId`/`memberId`/`agentType`/`outcome`; unknown roster → null fields via `resolveMemberIdentity` at `:793` (R3/R5).
- `packages/app/src/services/supervisor-service.ts:230` — emits `team.member.started` on start; `:250` / `:336` `team.member.stopped` on natural exit / explicit stop (deduped via `teamMemberStopEmitted` at `:304`) (R2).
- `apps/cli/src/commands/team.ts:107` + `:353` — `team up`/`down`/`assign` attach CLI EventBus + `attachSystemEventLedger` so events reach the shared SQLite ledger without serve (R6).
- `packages/app/src/index.ts` — exported new team event types / process bus types.
- `docs/inventory/system-events-producer-audit.md` — added team.* rows (26–30), renumbered to 65 entries, updated Gap 1 / summary (R7).
- Tests: `event-names.test.ts`, `team-service.test.ts` (R15–R17 + orchestrator start/stop bridge + teardown outcome ok), `supervisor-service.test.ts`, `upstream-system-events-wiring.test.ts` (memberId actor).

Rationale: follow message/process emit pattern (optional bus, failure-isolated); CLI durability matches 0370 ledger attach; Activity tab `team.` prefix now has producers.
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/event-names.ts:115-126`; `packages/app/tests/services/event-names.test.ts:184` |
| R2 | MET | `packages/app/src/services/team-service.ts:688,718,820-838`; `packages/app/src/services/supervisor-service.ts:230-336` |
| R3 | MET | `packages/app/tests/services/team-service.test.ts:1060-1141` |
| R4 | MET | `packages/app/src/services/system-event-tap.ts:146-152`; `apps/server/tests/upstream-system-events-wiring.test.ts:581-583` |
| R5 | MET | `packages/app/tests/services/team-service.test.ts:1129-1141` |
| R6 | MET | `apps/cli/src/commands/team.ts:107,353`; full wiring suite exit 0 |
| R7 | MET | `docs/inventory/system-events-producer-audit.md:3,165-171` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R15 — Team lifecycle transitions emit cataloged events | MET | test | `packages/app/tests/services/team-service.test.ts:1060-1105,1232` |
| R16 — Member state changes are attributable to a team and an agent type | MET | test | `packages/app/tests/services/team-service.test.ts:1106-1120`; `apps/server/tests/upstream-system-events-wiring.test.ts:581-583` |
| R17 — A team event for an unknown member still persists | MET | test | `packages/app/tests/services/team-service.test.ts:1129-1141` |

**Fresh command:** `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major; dual-producer noise remains a non-blocking P3 advisory.

**Fix-pass disclosure:** `.spur/run/0371-verdict.json:1-74` regenerated; empty requirement evidence cells were repaired.
### Review
**Disposition:** approve (no blocker/major findings)

**Mode:** `/sp-dev-review` + `/sp-dev-verify 0371 --auto --fix all` (P1–P4 table required for L3)

| Priority | File / Location | Finding | Recommendation |
|----------|-----------------|---------|----------------|
| P1 | (none) | No blockers — R1–R7 MET; AC R15–R17 MET with executable test evidence; 119/119 targeted tests green | None |
| P2 | (none) | No major SECUA or design-conformance gaps | None |
| P3 | `packages/app/src/services/team-service.ts:820-838` | Dual producers (SupervisorService + TeamOrchestrator bridge) can double-row `team.member.started|stopped` if both paths fire; stop/exit dedupe is supervisor-local only | Accept residual (design-documented); consider correlation key later if Activity noise appears |
| P3 | `packages/app/src/services/system-event-tap.ts:142-148` + `apps/server/src/modules/events/index.ts:20-27` | `extractSystemEventActor` duplicated for Worker bundle isolation; memberId fallback correctly applied in both | Keep dual-update checklist; extract only if a Worker-safe pure surface appears |
| P4 | `packages/app/src/services/team-service.ts:820-838` | Fire-and-forget `void resolveMemberIdentity().then(...)` under agent lifecycle bursts | Accept for observability scope; coalesce only if measured load requires it |

**Functional Verdict:** PASS (R1–R7 all MET). Full functional/SECUA/architecture notes from `/sp-dev-review` retained in this pass's disposition.

**Residual risk:** Supervisor-driven `team.member.started|stopped` remain CLI-invisible without serve (same residual as `process.*`). Working tree may still hold uncommitted 0371 files at verify time.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T03:35:50.998Z todo → wip (system)
- 2026-07-29T03:42:51.109Z wip → testing (system)
- 2026-07-29T03:47:01.884Z testing → done (system)
