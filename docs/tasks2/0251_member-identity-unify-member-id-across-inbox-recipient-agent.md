---
template: standard
schema_version: 1
name: "Member identity: unify member id across inbox recipient, agent spec id, and supervised process id"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:00.065Z"
updated_at: "2026-07-14T06:02:52.568Z"
---

## 0251. Member identity: unify member id across inbox recipient, agent spec id, and supervised process id

### Background
**Wayfinder ticket (grilling)** for feature M.

A member's message-recipient id, its `.spur/agents/<id>.yaml` spec id, and its `SupervisorService`
process-registry key must be the SAME handle. Today `spur agent run --drain` maps a spec id → the
underlying coding-agent *type* at drain time (`apps/cli/src/commands/agent.ts:301`), and
`validateAgentId` gates message ids — two different namespaces bridged ad hoc. This ticket defines
the canonical member id used everywhere.

**Blocks:** 0252, 0253, and fog (broadcast, drain idempotency). **Blocked by:** none (frontier).
### Requirements
R1. Canonical member id format (recommend `<team>-<member>`) that passes `validateAgentId`.
R2. A mapping table: member id → inbox recipient (`InboxMessageDao`) → spec id (`.spur/agents/`) → supervisor key.
R3. Uniqueness/collision rules when two teams share the same executor name.
R4. Aliasing/migration for existing free-form agent specs that predate the team convention.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A
**Grilling — 2 forks confirmed.**

**Q1 (R1+R3) — Canonical member id format + is the team prefix always applied?**
→ **Always prefix: `<teamId>-<localId>`.** `localId = member.id ?? executor`. The team is the namespace: every materialized member spec id is `<teamId>-<localId>` regardless of whether the member supplies an explicit `id`. Passes `validateAgentId` (`^[a-z][a-z0-9_-]{1,63}$` — lowercase + `-`). Two teams with a `coder` member → `alpha-coder` / `beta-coder`, never collide. The flat `.spur/agents/` namespace + `loadAgentSpecs`'s duplicate-id throw make a collision a hard error at `spur team up`, not a silent overwrite.

**Q2 (R4) — How do pre-existing free-form specs join a team?**
→ **Explicit `ref:` alias opt-out.** A member object may set `ref: <existing-spec-id>` to mean "this member IS that existing spec, verbatim — no prefix, no rematerialization." `spur team up` records the roster pointer and skips generating a file. The default stays always-prefixed; aliasing is the deliberate escape hatch for specs that predate the team convention. Documented consequence (not a bug): two teams referencing the same `ref` share one spec → one inbox + one supervisor process (the supervisor already dedupes on id at `supervisor-service.ts:131`); a team wanting a private instance uses the prefix form.
### Design
**Canonical member id:**

```
memberId = ref ? ref : `<teamId>-<member.id ?? executor>`
```

- `ref` form (alias): `memberId = ref` verbatim — the existing spec id, no prefix, no materialization.
- Default form (string or object without `ref`): `memberId = <teamId>-<localId>`, `localId = member.id ?? executor`. Always prefixed; an explicit `member.id` becomes the *local* part, not the whole id.

**Identity mapping table (R2) — the four surfaces are ONE string:**

| Surface | Value | Source |
|---|---|---|
| Spec id (`.spur/agents/<id>.yaml`) | `memberId` | materialization (`spur team up`) |
| Inbox recipient | `memberId` | `drainIntoPrompt`: `flags.agent` → `team.getInbox(recipient)` (`apps/cli/src/commands/agent.ts`) |
| Supervisor registry key | `memberId` | `SupervisorService.start(agentId)` → `specs.find(s => s.id === agentId)` → `processes.set(agentId, …)` (`packages/app/src/services/supervisor-service.ts:130-167`) |
| Coding-agent `type` | `spec.type` (derived, NOT an identity) | the drain rewrite maps `--agent <memberId>` → `--agent <spec.type>` so the runner can resolve (`apps/cli/src/commands/agent.ts`) |

The "two namespaces" this ticket opened against collapse to **one identity (`memberId`) + one derivation (`memberId → spec.type` via the spec)**. The existing drain `--agent` rewrite IS the derivation — no new bridge is needed.

**Collision rule (R3):** `<teamId>-` namespacing makes cross-team id collisions impossible by construction; `loadAgentSpecs` already throws on duplicate ids (`ts-ai-runner/agent-spec.ts:49`), so a same-team duplicate localId is a config-load error.

**Aliasing (R4):** `ref:` is the only path to a non-namespaced id; it is explicit, visible in config, and carries the documented shared-process/shared-inbox semantics.

---

**Review amendments (2026-07-14 — from `/sp:dev-review 0251`):**

- **`ref` excludes per-member overrides (P2).** A `ref:` member is used verbatim — no spec is materialized — so 0250's per-member overrides (`model / autonomy / purpose / workspace / command / autostart`) have nowhere to land. `spur team up` MUST **error** when a `ref` member also carries any override key (mutual exclusion), never silently drop them.
- **Validate the composed id early (P3).** `memberId` must satisfy `validateAgentId` (`^[a-z][a-z0-9_-]{1,63}$`, ≤64 chars) **as a whole**. Because it is `<teamId>-<localId>`, both 0250's config-load `superRefine` (R5) and `spur team up` must reject a non-conforming `teamId` map-key or `localId` (uppercase, leading digit, over-length) at **load**, not at spawn.
- **Shared-`ref` couples lifecycles (P3).** Two teams referencing one `ref` share a single supervisor process, so `team down` on either stops it for both. The lifecycle ticket (0253) must reference-count a `ref`-shared member (stop only when the last owning team stops) or document the coupling as intended.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Resolved via grilling** (2 forks confirmed) — this finalizes the canonical member id; the concrete rule + mapping table live in **### Design**.

| Fork | Decision |
|---|---|
| R1+R3 id format / namespace | **Always prefix `<teamId>-<localId>`** (`localId = member.id ?? executor`); team IS the namespace; collision = hard error at `spur team up` |
| R4 legacy-spec aliasing | **Explicit `ref:` opt-out** — `ref: <existing-spec-id>` = member IS that spec verbatim, no prefix, no rematerialization; two teams on same `ref` share one inbox + one process |

**Requirements resolution:**
- **R1 — Canonical format:** `<teamId>-<localId>`, always prefixed; validated by `validateAgentId` (`@gobing-ai/ts-ai-runner`, `agent-spec.ts:31`).
- **R2 — Mapping table:** the four surfaces (inbox recipient, spec id, supervisor key, *coding-agent type*) collapse to **one identity (`memberId`) + one derivation (`memberId → spec.type` via the spec's `type` field)**. No new bridge; the existing drain `--agent <specId>` → `--agent <spec.type>` rewrite is the derivation.
- **R3 — Collision:** `<teamId>-` namespacing removes cross-team collisions by construction; intra-team duplicate localId is caught by `loadAgentSpecs`'s dup-throw (`agent-spec.ts:49`) → config-load error, not a silent overwrite.
- **R4 — Aliasing/migration:** `ref: <existing-spec-id>` aliases a pre-existing free-form spec into a team without rematerialization; default remains always-prefixed.

**Conflict surfaced (not averaged):** the roster-root ticket's drafted materialization table listed `spec.id = member.id ?? <teamId>-<executor>` — i.e. a *bare* `member.id` when one is supplied. This ticket **overrides** that draft: an explicit `member.id` becomes the *local* part of an always-prefixed id, never the whole id. Rationale: the draft would let two teams both set `id: coder` and collide on the flat `.spur/agents/` namespace; always-prefixing removes that failure mode entirely. The materialization ticket must update its `AgentSpec.id` derivation row to `<teamId>-(member.id ?? executor)`.

**Grounding (where this lands):**
- `packages/app/src/services/supervisor-service.ts:130-167` — `SupervisorService.start` keys the process registry on the spec id; confirms the supervisor key IS the spec id (= `memberId`).
- `apps/cli/src/commands/agent.ts` — `drainIntoPrompt` uses `flags.agent` (spec id) as the inbox recipient and rewrites `--agent` to `spec.type` for runner resolution; confirms the inbox recipient IS the spec id and the id→type derivation is already wired.
- `packages/app/src/services/team-service.ts:171` — `validateAgentId(toId)` gates message recipients; `<teamId>-<localId>` passes the `^[a-z][a-z0-9_-]{1,63}$` rule.
- `ts-ai-runner/agent-spec.ts:31,49` — `validateAgentId` charset + `loadAgentSpecs` duplicate-id throw (the collision hard-stop).

**Hands off to:**
- Materialization ticket (team up/down) — consumes the always-prefixed id rule; must update its `AgentSpec.id` derivation to `<teamId>-(member.id ?? executor)` and implement the `ref:` no-materialize path.
- Lifecycle ticket — can now assume a member's supervisor key equals its roster id, so keep-alive/autostart address a single stable handle.
- Fog (broadcast, drain idempotency) — team addressing `message send --to team:<id>` can fan out over `<teamId>-*` member ids; the read/delivered watermark keys on the same `memberId`.
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review
**Reviewed:** 2026-07-14 · **Mode:** decision-record review. This is a wayfinder grilling ticket —
**no implementation diff exists**, so the SECUA *code* dimensions are N/A; functional traceability
and design soundness apply.

**Dimension outcomes**
- **Functional traceability — PASS.** R1–R4 each resolve to an explicit decision with a mapping table and `file:line` grounding. The AC section is empty — acceptable for a decision ticket.
- **Security / efficiency / correctness / usability — N/A.** No code diff; the ticket produces a design decision, not an implementation.
- **Design soundness / architecture — 4 findings.** The core model (four surfaces → one `memberId` + one derivation) is sound and deep. Gaps below; all fixed under `--fix all`.

**Findings (severity-ranked)**

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | **Cross-ticket inconsistency.** 0250's recorded derivation (`spec.id = member.id ?? <teamId>-<executor>` — Design table + Solution hands-off) is the *bare-`member.id`* rule this ticket overrode. 0252 is told to consume 0250's Design → it would inherit the collision-prone rule. | **FIXED** — corrected 0250's Design row + Solution line to `<teamId>-(member.id ?? executor)` (finalized-by-0251); map `## Decisions so far` 0250 line annotated. |
| P2 | **`ref` × per-member overrides unspecified.** A `ref:` member is "verbatim, no rematerialization," yet 0250's member object allows `model/autonomy/purpose/workspace/command/autostart`. Behavior when both are set is undefined — 0252 has no rule. | **FIXED** — mutual-exclusion rule added to Design: `spur team up` errors if a `ref` member also carries overrides. |
| P3 | **Composed-id validation is late.** `memberId = <teamId>-<localId>` only passes `validateAgentId` (`^[a-z][a-z0-9_-]{1,63}$`, ≤64 chars) if BOTH parts conform. An uppercase / leading-digit / over-length `teamId` or `localId` fails at `spur team up` (spawn), not config-load. | **FIXED** — Design now requires early charset+length validation of the composed id at team-load (feeds 0250 R5). |
| P3 | **Shared-`ref` lifecycle coupling.** Two teams on one `ref` share a process, so one team's `team down` kills the other's member. Documented for inbox/process sharing, not for lifecycle. | **FIXED** — coupling note added to Design (aliasing), flagged for the lifecycle ticket (0253). |

**Residual risk:** none blocking. All findings are design-record refinements consumed downstream by 0252/0253; no code exists yet to regress.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-14T05:44:28.027Z todo → wip (system)
- 2026-07-14T05:49:58.420Z wip → testing (system)
- 2026-07-14T05:50:01.070Z testing → done (system)
