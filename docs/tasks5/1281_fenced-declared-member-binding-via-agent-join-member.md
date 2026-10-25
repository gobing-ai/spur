---
schema_version: 1
name: Fenced declared-member binding via agent join --member
status: done
template: feature-impl
created_at: 2026-10-22T07:00:38.145Z
updated_at: "2026-10-22T22:30:04.408Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1279"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1281-verdict.json
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

- [x] R1. `spur agent join --member <id>` resolves one enabled declared member in the normalized project and validates role, executor policy and a current capability proof (`evaluateCapabilities` against the declared executor); any mismatch exits 2 with a named reason.
- [x] R2. Exactly one fenced occupant binds per member (occupancy generation + lease epoch); competing, mismatched or stale binders are refused and leave no orphan claim, occupant row or record.
- [x] R3. Bound pull (`wait --inbox <member-id>`) resolves to the declared member inbox with epoch checks on claim, acceptance, completion and renewal; guest-only pull is unchanged.
- [x] R4. Guests stay concrete-address message participants excluded from `resolveMember` role selection and `requiresCapabilities`; without `--member`, join behaves exactly as today.

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

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/services/fleet-guest-service.ts:72-95` | New `MemberBinding` (`memberId`, `occupancyGeneration`, `ownerEpoch`, `version: 1`, `stageEligible`) and `GuestRecord.memberBinding?` | The binding is one additive optional record field — no schema, table or migration. `isMemberBinding` (`:602`) reads it tolerantly, so a pre-1281 record simply has no binding. |
| `packages/app/src/services/fleet-guest-service.ts:120-160` | Context seams `resolveDeclaredMember`, `attestMemberCapabilities`, `hostWake` + `MEMBER_BINDING_CAPABILITIES` (fsRead/fsWrite/processSpawn) | The service owns state and fencing; the roster read, capability attestation and host-wake evidence are injected, so no layering inversion and no second source of truth. The baseline is the three axes a stage actually needs. |
| `packages/app/src/services/fleet-guest-service.ts:339-460` | `bindMember(input)` — ordered, fail-closed: role vocabulary → member resolves → enabled → role matches → capability proof → no plain-guest record → no live occupant (`hasRunning`) → claim `guest:<memberId>` → occupant row at `generation + 1` → record. Failures after the claim release it; a record write failure also marks the row exited | Every refusal in AC2 leaves no orphan claim, row or record. The record id IS the member id, so `wait --inbox <member-id>` addresses the declared member's inbox with no second addressing scheme (R3). Reusing `specId = memberId` is what makes the existing strategy `hasRunning` check see the member busy — no dual writers, no new guard. |
| `packages/app/src/services/fleet-guest-service.ts:486-500` | `heartbeat` adds the generation fence for bound records (before the claim-epoch heartbeat) | A taken-over member bumps the generation, so the stale binder's renew — and therefore the claim/accept that `wait --inbox` performs right after it — is refused (AC3). Guest-only records skip the extra query entirely. |
| `apps/cli/src/commands/agent/join.ts:74-108` | `--member <id>` branch: `bindMember` with the same identity fields the guest path records, `ensureRenewer` on a verified identity, JSON/plain output naming the binding | Same command, same flags otherwise: without `--member` the guest path is byte-for-byte the previous behavior (R4). A refusal exits 2 through the shared `guestUsageError` with the service's named code. |
| `apps/cli/src/commands/agent/join.ts:220-227` | `--member <id>` option + help text | The consented public surface: one additive flag, no new noun or verb. |
| `apps/cli/src/commands/agent/shared.ts:148-190` | `guestService` wires the three seams: roster view from `listFleetMembers`, capability proof via `evaluateCapabilities` over the executor profile from the merged config (missing profile → `unknown` → refused), wake from `docs/reports/fleet-host-capabilities.json` | Fail-closed: an unattested executor is refused rather than bound-and-disabled (0706 R5). Reading 1280's report here is what makes `stageEligible` evidence-backed instead of assumed. |
| `packages/app/src/index.ts` | Barrel exports for `bindMember` types, `MEMBER_BINDING_CAPABILITIES`, `MemberBinding`, `evaluateCapabilities`/`capabilityDiagnostic` | Cross-workspace rule: the CLI consumes only `@gobing-ai/spur-app`. |
| `packages/app/tests/services/fleet-guest-bind-member.test.ts:1-270` | New suite, failure list first: unknown/disabled member, role mismatch, unattested executor, live occupant, plain-guest collision, two concurrent binders (`Promise.all`), stale generation after takeover, pull-only binding, the capability baseline | AC2's refusal matrix and AC3's fence, each also asserting the *absence* of a claim, occupant row and record — a refusal that leaks state is the failure mode that matters. |
| `apps/cli/tests/commands/agent/join-member.test.ts:1-184` | New CLI E2E: `--member` documented, unknown member exit 2, unattested executor exit 2, and a real bind (exit 0, `memberBinding` in the record and the JSON output) followed by a plain guest join in the same project (R4) | The flag, the exit codes and the record shape proven through the command tree, not just the service seam. |
| `docs/design/fleet-attached-occupants.md`, `plugins/sp/skills/spur-cli/references/agent.md`, `plugins/sp/skills/fleet-join/SKILL.md` | §2 names the real selector (`resolveMember`); §4 records the flag as implemented; the CLI reference documents `--member` and its refusals; the skill gains the binding section | Surface truth for the one consent-gated flag; the guest-only path stays documented as unchanged. |
| `apps/cli/tests/commands/agent/join-renewal.test.ts:140-148` | 1279's "no new option" assertion is scoped to renewal vocabulary | 1279 must not forbid a flag a later task legitimately owns; `--member` is asserted by 1281's own test. |
| `packages/app/src/services/fleet-guest-service.ts:539-566` | `retire` is fenced too: a bound record only releases a claim whose epoch it still holds, and a superseded generation returns before touching the new owner's resources | The review caught the leak the heartbeat fence alone does not cover: a stale binder's `leave` (or lease expiry) would have released the CURRENT owner's claim, released its claimed messages and marked its occupant row exited — a stale record destroying live work. Guest-only records keep the previous path. |
| `packages/app/tests/services/fleet-guest-bind-member.test.ts:237-277` | New case: `leave` on a superseded binding leaves the current claim (live, same epoch) and the occupant row (`hasRunning`) intact | The regression that would have shipped without the fence, pinned where the other refusals live. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/fleet-guest-service.ts:339` resolves and validates the declared member (enabled, role, executor) and requires a capability proof before any claim; refusals exit 2 with named codes through `apps/cli/src/commands/agent/join.ts:85`, proven at `apps/cli/tests/commands/agent/join-member.test.ts:105` and `:122` |
| R2 | MET | one fenced occupant per member: generation `max+1` plus claim epoch at `packages/app/src/services/fleet-guest-service.ts:339`, with no orphan claim/row/record on any refusal — `packages/app/tests/services/fleet-guest-bind-member.test.ts:67` through `:190` covers every refusal, the two-binder race, and the stale-`leave` fence |
| R3 | MET | the record id is the member id, so `wait --inbox <member-id>` addresses the member inbox (`packages/app/tests/services/fleet-guest-bind-member.test.ts:192`); a takeover refuses claim/accept/renew through the generation fence at `packages/app/src/services/fleet-guest-service.ts:490` and `:544` (`:280`) |
| R4 | MET | guest defaults unchanged: `join` without `--member` takes the untouched path and `resolveMember` is not modified — `apps/cli/tests/commands/agent/join-member.test.ts:145` performs a plain guest join in the same project after a binding |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R3 — A capable live session binds one declared member without changing guest defaults (req: R1, R2) | MET | test | `apps/cli/tests/commands/agent/join-member.test.ts:145` (exit 0, `memberBinding` in the record and the JSON output) and `packages/app/tests/services/fleet-guest-bind-member.test.ts:192` (occupant row makes the member busy) |
| AC2 — Invalid binders are refused cleanly (req: R1, R2) | MET | test | `packages/app/tests/services/fleet-guest-bind-member.test.ts:67` (unknown, disabled, role mismatch, unattested, live occupant, plain-guest collision) and `:166` (two concurrent binders, loser leaves nothing) |
| AC3 — Bound pull is epoch-fenced (req: R3) | MET | test | `packages/app/tests/services/fleet-guest-bind-member.test.ts:280` (a newer generation refuses the old binder's renew, hence claim/accept) and `:238` (a superseded `leave` cannot release the current owner) |
| AC4 — Guest defaults are unchanged (req: R4) | MET | test | `apps/cli/tests/commands/agent/join-member.test.ts:145` (plain guest join after a binding, no `memberBinding`) and the unchanged `apps/cli/tests/commands/agent/join.test.ts` / `leave.test.ts` / `wait.test.ts` suites |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: HIGH

#### Review Report — 1281

**Scope:** 1281 diff (binding service, `--member` flag, seams, tests, three doc surfaces) against R1–R4 and AC1–AC4
**Dimensions:** functional, security, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `retire` released the claim by *record id* alone, so a superseded bound record's `leave`/expiry could release the **current** owner's lease, return its claimed messages and mark its occupant row exited — a stale record destroying live work | `packages/app/src/services/fleet-guest-service.ts:544` | RESOLVED — `retire` now returns early on a later occupancy generation and releases only a claim whose epoch it still holds; regression case at `packages/app/tests/services/fleet-guest-bind-member.test.ts:238` |
| 2 | P4 (advisory) | correctness | the capability proof refuses an executor whose profile declares no `executionCapabilities` at all, which also refuses a member whose executor is a bare canonical agent name (`claude`) with no configured profile — correct per 0706 R5 (unknown never satisfies), but it makes `--member` unusable without an attested profile | `apps/cli/src/commands/agent/shared.ts:167` | ACCEPTED — refusing is the requirement; the doc surfaces say an attested profile is required |
| 3 | P4 (advisory) | usability | `--member` and `--id` together are not refused; `--id` is simply ignored on the binding path | `apps/cli/src/commands/agent/join.ts:85` | ACCEPTED — `--id` documents a default for the guest path only, and ignoring it cannot mis-address anything (the member id always wins) |
| 4 | P4 (advisory) | efficiency | the binding reads the full roster (`listFleetMembers`) and the merged config per join | `apps/cli/src/commands/agent/shared.ts:153` | ACCEPTED — a join happens once per session, not per tick |

##### Verified evidence

- Full quality gate `PASS` on this tree (`.spur/run/1281-test-gate.status`, run `0030543c`): lint, typecheck and the full suite, including the two help-docs parity gates that initially failed on the undocumented flag.
- `bun test tests/services/fleet-guest-bind-member.test.ts tests/services/fleet-guest-service.test.ts tests/services/guest-lease-renewer.test.ts` → 28 pass, 0 fail; `bun test tests/commands/agent/` → 160 pass, 0 fail.
- Security: the binding validates the member against the roster before claiming anything, uses the member id as the record id (no operator-supplied path), and the new refusals all return named codes through the existing exit-2 path — no new surface that turns operator input into a filesystem or shell operation. The renewal spawn path (1279) is unchanged.

##### Residual risk (named, not blocking)

- The window between `hasRunning(memberId)` and the claim is not atomic. A supervised spawn that starts in that window would find the member claimed by the binder; the strategy's idle set excludes a member with a running row, so the two paths converge on one writer, but the *first* race can leave a supervised process without a task rather than double-dispatching. Closing it fully needs a spawn-side claim, which is 1282's territory.
- `stageEligible` reads `docs/reports/fleet-host-capabilities.json` as it exists in the tree; a missing report binds with `stageEligible: false` (fail-closed) rather than assuming capability.
- AC3's "message stays with the current owner" is asserted through the fence (`heartbeat` false → `wait --inbox` refuses), not by driving a full claim takeover through the inbox in the test.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/fleet-guest-service.ts:339` resolves the declared member, checks role/enabled and requires a capability proof before any claim; refusals exit 2 with named codes (`apps/cli/src/commands/agent/join.ts:85`), proven at `apps/cli/tests/commands/agent/join-member.test.ts:105` and `:122` |
| R2 | MET | one fenced occupant per member, generation `max+1` plus claim epoch, no orphan state on any refusal (`packages/app/tests/services/fleet-guest-bind-member.test.ts:67`–`190`, including the two-binder race and the stale-`leave` fence) |
| R3 | MET | the record id is the member id so `wait --inbox <member-id>` addresses the member inbox (`packages/app/tests/services/fleet-guest-bind-member.test.ts:192`); takeover refuses claim/accept/renew (`:280`) |
| R4 | MET | guest defaults unchanged — `join` without `--member` takes the untouched path (`apps/cli/tests/commands/agent/join-member.test.ts:145` asserts a plain guest join in the same project); `resolveMember` untouched |

**Next:** wrap 1281; then 1282/1283 remain blocked on their G74 dependencies.

### References

- Feature G75 R3; design `docs/design/fleet-attached-occupants.md` §2, §4; ADR-146; consent: Robin 2026-10-22 (`--member` only).
- Anchors: `fleet-dispatch.ts:91,105`; `capability-attestation.ts:32,92`; `agent-resolver.ts:392,906`; `fleet-guest-service.ts:143,174,182–214`; `strategy-runtime.ts:708`; `apps/cli/src/commands/agent/shared.ts:148`; `project-claim-dao.ts:13`.
- Depends on 1279; consumer 1282.

### History

- 2026-10-22T21:50:12.679Z todo → wip (system)
- 2026-10-22T22:30:01.039Z wip → testing (system)
- 2026-10-22T22:30:04.400Z testing → done (system)

