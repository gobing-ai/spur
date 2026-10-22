---
schema_version: 1
name: Fenced declared-member binding via agent join --member
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.145Z
updated_at: "2026-10-22T16:36:56.964Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1279"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
---

## 1281. Fenced declared-member binding via agent join --member

### Background

Implements: R3 — A capable live session binds one declared member without changing guest defaults.
Work package B3. Additive public flag on the existing spur agent join. Public-surface consent: given by the operator (Robin) on 2026-10-22 for the additive `--member` flag only — no new noun or verb (AGENTS.md public-surface rule). Runs after the lease renewal task.
Rubric: E8 D1 L3 C1 R2 = 15 → own task (force: R=high).

**Refine corrections (2026-10-22)**
- Claim "Rejected: mixing guests into resolveAgentSelector" (also design §2) → reality: **no `resolveAgentSelector` exists**. Role selection is `resolveMember()` (`packages/app/src/workflow/fleet-dispatch.ts:91`, enabled + role filter, ADR-121 fresh filter `:105`); capability gating is `evaluateCapabilities` (`packages/app/src/services/capability-attestation.ts:92`, `UNATTESTED_CAPABILITY` `:32`) and the resolver's `requiresCapabilities` (`agent-resolver.ts:392,906`). → resolution: guests stay out of `resolveMember`'s input; a bound member is the *declared* member and needs no resolver change.
- Guest ids already refuse declared member ids (`fleet-guest-service.ts:174`, `declaredMemberIds` wired at `apps/cli/src/commands/agent/shared.ts:148`). `--member` inverts this for exactly one declared id.
- Dual-writer guard already exists: the strategy idle set excludes members with a running `coordination_runs` row (`strategy-runtime.ts:708`, `hasRunning`), and the guest join inserts such a row keyed by `specId` (`fleet-guest-service.ts:195`). → resolution: a binding writes its occupant row under the member's `specId`, so supervised spawn/dispatch sees it busy — reuse, don't duplicate.
- Consent: Robin approved the additive `--member` flag on 2026-10-22 (only that flag).

### Requirements

- [ ] R1. `spur agent join --member <id>` resolves one enabled declared member in the normalized project and validates role, executor policy and a current capability proof (`evaluateCapabilities` against the declared executor); any mismatch exits 2 with a named reason.
- [ ] R2. Exactly one fenced occupant binds per member (occupancy generation + lease epoch); competing, mismatched or stale binders are refused and leave no orphan claim, occupant row or record.
- [ ] R3. Bound pull (`wait --inbox <member-id>`) resolves to the declared member inbox with epoch checks on claim, acceptance, completion and renewal; guest-only pull is unchanged.
- [ ] R4. Guests stay concrete-address message participants excluded from `resolveMember` role selection and `requiresCapabilities`; without `--member`, join behaves exactly as today.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R3 — A capable live session binds one declared member without changing guest defaults (req: R1, R2)
  Given an enabled declared member `coder-1` whose executor attests the stage's required capabilities and no live occupant
  When `spur agent join --role coder --member coder-1 --json` runs from a verified agent process
  Then it exits 0, the record carries `memberBinding {memberId, occupancyGeneration, ownerEpoch, version:1}`, and the strategy idle set treats `coder-1` as occupied

Scenario: AC2 — Invalid binders are refused cleanly (req: R1, R2)
  Given an unknown member, a disabled member, a role mismatch, an executor without the required attestation, a live supervised occupant, and a concurrent second binder
  When each joins with `--member`
  Then each exits 2 with its named reason, exactly one of the concurrent binders wins, and no claim, `coordination_runs` row or record is left for the losers

Scenario: AC3 — Bound pull is epoch-fenced (req: R3)
  Given a bound member whose lease was taken over (new epoch)
  When the old binder claims, accepts, completes or renews
  Then each operation is refused as stale and the message stays with the current owner

Scenario: AC4 — Guest defaults are unchanged (req: R4)
  Given the existing join/wait/leave test suites
  When they run without `--member`
  Then they pass unchanged, and `resolveMember` never returns a guest id
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:26:00.560Z

- **Q: New service or extend FleetGuestService?** CLOSED — extend `FleetGuestService` with `bindMember()`; it already owns claim + occupant row + record atomically-in-order (`:182–214`). No separate binding service (no dual writers).
- **Q: Claim slot?** CLOSED — reuse `guest:<memberId>` (`ClaimSlot`, `project-claim-dao.ts:13`); the member id is the address. No new slot kind, no migration.
- **Q: Occupancy generation?** CLOSED — `CoordinationRunDao.maxGeneration(memberId) + 1` (same as join `:194`); recorded and checked on every fenced op.
- **Q: Capability proof?** CLOSED — `evaluateCapabilities(stageRequires, declaredExecutor)` plus host-mode evidence from 1280's report row for the binder's executor; `pull-only` hosts may bind but are marked `stageEligible:false` (1282 consumes it).
- **Q: Public surface?** CLOSED — only `--member <id>` on `spur agent join`; help text, `plugins/sp/skills/spur-cli/references/` agent reference, `fleet-join` skill and design §4 updated in the same change.

### Design

**Files:** `apps/cli/src/commands/agent/join.ts` (`--member <id>` option + validation/help); `packages/app/src/services/fleet-guest-service.ts` (`bindMember(input)`, `GuestRecord.memberBinding?`); `apps/cli/src/commands/agent/wait.ts` (epoch on claim/accept for bound records); `packages/app/src/services/inbox-service.ts` only if the claim call needs the epoch parameter (prefer passing through existing APIs).
**bindMember order (atomic-in-order, rollback on failure):** 1 resolve declared enabled member + role/executor match → 2 capability proof → 3 refuse if `hasRunning(memberId)` → 4 `ProjectClaimDao.claim(guest:<memberId>)` → 5 occupant row (`specId = memberId`, generation+1) → 6 write record. A failure after 4 releases the claim; after 5 marks the row exited.
**Fenced ops:** claim/accept/complete/renew compare `{ownerEpoch, occupancyGeneration}` from the record with the live claim; mismatch → `stale-binding`, exit 2 for CLI.
**Tests:** `packages/app/tests/services/fleet-guest-bind-member.test.ts` (in-memory SQLite, concurrent binders via `Promise.all`); `apps/cli/tests/commands/agent/join-member.test.ts` (spawned CLI E2E).
**Rejected:** touching `resolveMember`; PID-based takeover; schema migration.
**Invariants:** one binding and one active task per member; no dual writers.

### Plan

1. Failure cases first (tests above): unknown/disabled member; role mismatch; executor attestation fail; live supervised occupant; concurrent binders; stale epoch on each fenced op; wrong project/session rejoin.
2. `bindMember` + record field + rollback.
3. CLI flag + help + exit codes; fenced pull in `wait`.
4. Docs/skill: `docs/design/fleet-attached-occupants.md` §2 (`resolveAgentSelector` → `resolveMember`) and §4 (now supported); spur-cli agent reference; `fleet-join` skill.
5. Focused tests; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G75 R3; design `docs/design/fleet-attached-occupants.md` §2, §4; ADR-146; consent: Robin 2026-10-22 (`--member` only).
- Anchors: `fleet-dispatch.ts:91,105`; `capability-attestation.ts:32,92`; `agent-resolver.ts:392,906`; `fleet-guest-service.ts:143,174,182–214`; `strategy-runtime.ts:708`; `apps/cli/src/commands/agent/shared.ts:148`; `project-claim-dao.ts:13`.
- Depends on 1279; consumer 1282.

### History
