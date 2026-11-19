---
schema_version: 1
name: Retire the fleet legacy member-id fallback behind a precondition
status: done
template: feature-impl
created_at: 2026-11-18T05:29:30.254Z
updated_at: "2026-11-19T00:41:50.637Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2

done_forced: "false"
done_reason: unforced close
---

## 1389. Retire the fleet legacy member-id fallback behind a precondition

### Background

ADR-126 A4 changed fleet member id derivation. To avoid silently re-addressing members whose old id has history, `FleetService` fails closed (`packages/app/src/services/fleet-service.ts:495-519`). When an unpinned member's id changes and the old id has member sessions or a coordination run, declaration throws and names the `id:` pin. Old ids are computed by `legacyMemberLocalId` (`packages/config/src/index.ts:527`), tested in `packages/config/tests/member-id-legacy.test.ts`.

**Refine corrections (2026-11-17)**
- "fallback to old member ids" → it is not a fallback. Nothing resolves to the old id; it is a fail-closed guard that refuses to adopt new ids over recorded history → retirement means deleting the guard and `legacyMemberLocalId`.
- R1 "add a maintain check listing runs under legacy ids" → once `legacyMemberLocalId` is deleted, no shipped check can compute legacy ids, so a permanent `maintain` check would keep the very helper being retired. → Replace it with a one-time retirement preflight, run by the implementer over every registered local project database before deletion (the registry currently has 13 local entries). The output is recorded in the task as evidence. If any member has history, deletion stops and the report names the member, both ids and the `id:` remedy.
- The feature AC R3 body says "spur self maintain checks" → amended to the preflight. The scenario title is kept.

### Requirements

- [x] R1. Preflight (not shipped): for each local entry in `~/.config/spur/projects.json`, load its `agent.fleet` declarations, compute legacy and current ids for unpinned members, and query `readMemberSessions` and `CoordinationRunDao.getLatestBySpecId` for each changed legacy id. Record the per-project result table in the task's Solution section.
- [x] R2. Only if the preflight finds no history: delete the guard block in `fleet-service.ts`, `legacyMemberLocalId` and its export, and `member-id-legacy.test.ts`. If any history is found, stop and report the members with the `id: <legacyLocal>` remedy.
- [x] R3. Amend ADR-126 with an A4 retirement note (date, preflight evidence pointer) without renumbering.

### Acceptance Criteria

- [x] AC1 — Fleet legacy member-id fallback is retired safely (req: R1, R2, R3)

Test layer: real in-memory DB fleet-service tests, plus the recorded preflight over real project databases.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:52:46.948Z

- **Permanent maintain check vs one-time preflight?** Closed: one-time preflight. A shipped check would preserve the helper being retired.
- **History found?** Stop. The task blocks with the member list and remedy, and nothing is deleted.

### Design

**WHAT.** The preflight is a throwaway script in the session scratchpad that imports the same `@gobing-ai/spur-config` and `spur-domain` helpers the guard uses. It is not added to `scripts/commands` (ADR-130: no reusable behavior). The removal is pure deletion plus the ADR note.

**WHY.** The guard exists to protect history on machines that predate A4. Retiring it is safe exactly when no registered project has history under a changed id, which a one-time read proves. A permanent check would keep dead code alive.

**WHERE.** `packages/app/src/services/fleet-service.ts`, `packages/config/src/index.ts` (and its barrel export), `packages/config/tests/member-id-legacy.test.ts` and `docs/00_ADR.md` (ADR-126).

**Anti-patterns.** Don't add a public `maintain` flag (public-surface consent). Don't delete when the preflight is non-empty. Don't renumber ADRs.

**Limit.** The preflight covers only this machine's registry. Other machines running older binaries keep their guard until they upgrade, which is accepted pre-1.0.

### Plan

- [x] Step 1 (R1): write and run the preflight, then record the table.
- [x] Step 2 (test first, R2): adjust the fleet-service tests: a member whose derived id changed is now adopted without error.
- [x] Step 3 (R2): delete the guard, the helper, the export and the legacy test.
- [x] Step 4 (R3): add the ADR-126 note. Run `(cd packages/config && bun test)` and `(cd packages/app && bun test tests/services/fleet-service*.test.ts)`, then `bun run spur-check`.

### Solution

**Preflight (R1, 2026-11-18, read-only over `~/.config/spur/projects.json`).** For every local
entry the fleet declaration was loaded with the shipped `loadSpurConfig`, each unpinned
`role`+`executor` member's legacy id computed with the shipped `legacyMemberLocalId` and its current
id with `memberLocalId`, and the project's own ledger asked through `readMemberSessions` and
`CoordinationRunDao.getLatestBySpecId`.

| Project | Member # | Legacy id | Current id | Fleet sessions | Coordination runs | Verdict |
| --- | ---: | --- | --- | ---: | ---: | --- |
| spur-new | 2 | `spur-new-agy-opus-5.5` | `spur-new-reviewer-1` | 0 | 0 | clean |
| a2a-smoke | – | (member is pinned `id: coder`) | – | – | – | not affected |
| every other registered project | – | no `agent.fleet.members` | – | – | – | not affected |

Only one member's id ever changes, and its old address has no history of any kind, so the guard
could never fire. That satisfies R2's condition: the guard block in `fleet-service.ts`, the
`legacyMemberLocalId` helper and its export, and `packages/config/tests/member-id-legacy.test.ts`
were deleted. The fleet-service test that asserted the refusal now asserts the opposite: rows under
the pre-1075 address are not a refusal reason, and the member resolves to its role-first id.

**Change map.** `packages/app/src/services/fleet-service.ts` (guard + now-unused imports),
`packages/config/src/index.ts` (`legacyMemberLocalId`), `packages/config/tests/member-id-legacy.test.ts`
(deleted), `packages/config/tests/member-local-id.test.ts` (frozen-order case re-pointed at the
current derivation), `packages/app/tests/services/fleet-service.test.ts` (retirement assertion),
`docs/00_ADR.md` (ADR-126 A4 retirement note with this evidence pointer).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — preflight over every local registry entry: load `agent.fleet`, compute legacy + current ids for unpinned members, query `readMemberSessions` and `CoordinationRunDao.getLatestBySpecId` per changed legacy id, record the table in Solution | MET | Preflight ran read-only with the **shipped** pieces (`loadSpurConfig`, `legacyMemberLocalId`, `memberLocalId`, `readMemberSessions`, `CoordinationRunDao`) against every DB in `~/.config/spur/projects.json`. Result: one affected member — `spur-new` #2 `spur-new-agy-opus-5.5` → `spur-new-reviewer-1`, **0** fleet sessions, **0** coordination runs; `a2a-smoke`'s member is pinned; every other project declares no fleet. Table recorded in the task's Solution section via `spur task update --section Solution` |
| R2 — delete the guard block, `legacyMemberLocalId` and its export, and the member-id-legacy test file **only if** no history | MET | Condition met (0/0 above). `packages/app/src/services/fleet-service.ts` guard block removed (26 lines) plus its now-unused imports; `packages/config/src/index.ts` helper + export removed (38 lines); the member-id-legacy test file deleted in `667808d0e`; the frozen-order case in `packages/config/tests/member-local-id.test.ts` re-pointed at the current derivation. `packages/app/tests/services/fleet-service.test.ts` now asserts the opposite: rows under the pre-1075 address no longer refuse the resolve, and the member lands on `${slug}-coder-1` |
| R3 — amend ADR-126 with an A4 retirement note (date, preflight evidence pointer) without renumbering | MET | `docs/00_ADR.md` — new dated amendment under ADR-126 ("Amendment (2026-11-18 · A4 now carries no id-migration guard, task 1389)") citing the one member, its 0/0 history, and pointing at this task's Solution; no ADR number moved |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Fleet legacy member-id fallback is retired safely (R1,R2,R3) | MET | test | Preflight table in the task Solution (real project DBs, shipped readers); `packages/app/tests/services/fleet-service.test.ts` 38/38 through a real in-memory migrated DB; `packages/config/tests/member-local-id.test.ts` 26/26; 7/7 workspaces typecheck |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T18:35:31.855Z todo → wip (system)
- 2026-11-18T18:36:08.608Z wip → testing (system)
- 2026-11-18T18:36:10.154Z testing → done (system)

