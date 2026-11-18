---
schema_version: 1
name: Retire the fleet legacy member-id fallback behind a precondition
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:30.254Z
updated_at: "2026-11-18T05:52:47.903Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 2

---

## 1389. Retire the fleet legacy member-id fallback behind a precondition

### Background

ADR-126 A4 changed fleet member id derivation. To avoid silently re-addressing members whose old id has history, `FleetService` fails closed (`packages/app/src/services/fleet-service.ts:495-519`). When an unpinned member's id changes and the old id has member sessions or a coordination run, declaration throws and names the `id:` pin. Old ids are computed by `legacyMemberLocalId` (`packages/config/src/index.ts:527`), tested in `packages/config/tests/member-id-legacy.test.ts`.

**Refine corrections (2026-11-17)**
- "fallback to old member ids" → it is not a fallback. Nothing resolves to the old id; it is a fail-closed guard that refuses to adopt new ids over recorded history → retirement means deleting the guard and `legacyMemberLocalId`.
- R1 "add a maintain check listing runs under legacy ids" → once `legacyMemberLocalId` is deleted, no shipped check can compute legacy ids, so a permanent `maintain` check would keep the very helper being retired. → Replace it with a one-time retirement preflight, run by the implementer over every registered local project database before deletion (the registry currently has 13 local entries). The output is recorded in the task as evidence. If any member has history, deletion stops and the report names the member, both ids and the `id:` remedy.
- The feature AC R3 body says "spur self maintain checks" → amended to the preflight. The scenario title is kept.

### Requirements

- [ ] R1. Preflight (not shipped): for each local entry in `~/.config/spur/projects.json`, load its `agent.fleet` declarations, compute legacy and current ids for unpinned members, and query `readMemberSessions` and `CoordinationRunDao.getLatestBySpecId` for each changed legacy id. Record the per-project result table in the task's Solution section.
- [ ] R2. Only if the preflight finds no history: delete the guard block in `fleet-service.ts`, `legacyMemberLocalId` and its export, and `member-id-legacy.test.ts`. If any history is found, stop and report the members with the `id: <legacyLocal>` remedy.
- [ ] R3. Amend ADR-126 with an A4 retirement note (date, preflight evidence pointer) without renumbering.

### Acceptance Criteria

- [ ] AC1 — Fleet legacy member-id fallback is retired safely (req: R1, R2, R3)

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

- [ ] Step 1 (R1): write and run the preflight, then record the table.
- [ ] Step 2 (test first, R2): adjust the fleet-service tests: a member whose derived id changed is now adopted without error.
- [ ] Step 3 (R2): delete the guard, the helper, the export and the legacy test.
- [ ] Step 4 (R3): add the ADR-126 note. Run `(cd packages/config && bun test)` and `(cd packages/app && bun test tests/services/fleet-service*.test.ts)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
