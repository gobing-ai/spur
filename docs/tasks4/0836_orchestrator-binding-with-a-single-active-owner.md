---
schema_version: 1
name: Orchestrator binding with a single active owner
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.723Z
updated_at: "2026-09-12T05:21:13.816Z"
feature_id: G62
priority: P1
tags:
  - g6-program

dependencies: ["0835"]
---

## 0836. Orchestrator binding with a single active owner

### Background

`orchestrator` is not a legal role: `AGENT_ROLE_NAMES` is the closed set
`['scribe','coder','reviewer','planner']` and config validation rejects anything else
(`packages/config/src/index.ts:153-156`, `:379-382`). The G6 strategy prototype therefore binds a
**planner-role** instance carrying `purpose: "orchestrator"` as a prompt-side convention, with no
schema change (`docs/reports/g6-strategy-prototype.md` §2).

Nothing today plays this part. The Board's Inbox "Supervisor" tab is only a filter for a literal
endpoint string (`apps/web/src/modules/inbox/SupervisorTab.tsx:4`), whose own comment says not to
invent a backend identity there; `SupervisorService` is process supervision and makes no product
decisions.

The approved design is explicit that one active orchestrator owner is enforced at the runtime claim
boundary, not by role naming
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity").

**Premise check — R2's binding carrier is already decided by the tree.** `purpose?: string` is
**already** present on all three layers: the config member schema (`packages/config/src/index.ts:386`,
`purpose: z.string().optional()`), the normalized member (`:426`), and the spec projection
`AgentSpecInput` (`packages/app/src/services/team-service.ts:274`). So the prototype's convention needs
**no schema change and no role-vocabulary change** — R2 resolves to "use what exists".

**Premise check — there is no claim primitive.** `CoordinationRunDao`
(`packages/domain/src/dao/coordination-run-dao.ts:66`) has `insertStart`, `updateExit`, `getByRunId`,
`getLatestBySpecId`, `maxGeneration`, `deleteAll` — append-per-run history, not mutable current
ownership. The nearest existing pattern is `queue_jobs.attempt_token` + `lease_expires_at`
(`packages/domain/src/migrations.ts:1104-1105`, task 0817): a fencing token plus an expiry. That
**pattern** is the precedent to copy; that table is ts-db-owned and is a job queue, not a project slot.

### Requirements

- **R1** — Exactly one explicitly configured orchestrator per project, bound to a real, enabled fleet
  member from 0835's declaration.
- **R2** — The binding carrier is the **existing** `purpose` field on a planner-role member. No new role
  value, no new member schema field, no persisted role column. (Resolved against the current tree; see
  Background.)
- **R3** — One active orchestrator owner is enforced at the claim boundary: the second claimant is
  refused, not queued and not silently allowed.
- **R4** — Orchestrator **missing** (nothing bound) and orchestrator **offline** (bound, no live claim)
  are distinct, readable states with distinct next actions.
- **R5** — A project with zero agents or no binding resolves cleanly and names what is missing rather
  than failing opaquely.

### Acceptance Criteria

```gherkin
Feature: Orchestrator binding with a single active owner

  @core
  Scenario: One member is the project's orchestrator
    Given a project fleet with a bound orchestrator
    When the runtime resolves the project
    Then exactly one member is reported as the orchestrator

  @core
  Scenario: A second owner cannot claim the role
    Given an active orchestrator owner holds the claim
    When another process attempts to act as orchestrator for the same project
    Then the claim is refused

  @core
  Scenario: Missing and offline are different answers
    Given a project with no bound orchestrator and a project whose bound orchestrator is unreachable
    When each is inspected
    Then the first reports missing and the second reports offline

  @core
  Scenario: An empty fleet still resolves
    Given a project with zero declared agents
    When the project is opened
    Then it resolves successfully and names what is missing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:19:11.155Z

- **R2 binding carrier — CLOSED: the existing `purpose` field on a planner-role member.** `purpose` is
  already optional-string on the config member schema (`packages/config/src/index.ts:386`), the
  normalized member (`:426`), and `AgentSpecInput` (`team-service.ts:274`). The alternative — an
  `orchestrator` role value — needs operator consent for a closed vocabulary
  (`docs/design/harness-surface-governance.md`) and would make a permission out of a name, which the
  0706 capability work exists to prevent. Matches the prototype (`g6-strategy-prototype.md` §2).
- **Claim storage — CLOSED: a new Spur-local `project_claims` table at prefix `0044`.**
  `coordination_runs` is append-per-run history keyed by `run_id`; a claim is mutable singleton state
  keyed by (project, slot). `queue_jobs` is ts-db-owned and is a job queue. The table carries
  `owner_epoch` and `strategy_version` from the start so 0837 and 0838 need no second migration.
- **Exclusivity mechanism — CLOSED: composite PK plus `ON CONFLICT … DO UPDATE … WHERE`.** One
  statement, so no read-then-write race. An advisory file lock (the `ProjectRegistry.withLock`
  pattern, `project-registry.ts:157`) guards a file edit, not a long-lived runtime owner across
  processes.
- **Unresolvable pointer — CLOSED: error, never inference.** Falling back to "the only planner" makes a
  typo silently promote the wrong instance, and the resulting orchestrator would hold the write slot.
- **TTL — CLOSED: `CLAIM_TTL_MS = 30_000`, a module constant, not config.** Nothing needs to vary it
  yet; it becomes a knob when an operator has a reason.
- **Deferred (owner: 0837).** `owner_epoch` / `strategy_version` semantics and the `'write'` slot.
- **Deferred (owner: G63 0840).** Rendering `OrchestratorState` in the Board header.

### Design

**WHAT.** An `orchestrator` pointer in `.spur/fleet.json` resolving to one enabled planner-role member
carrying `purpose: 'orchestrator'`, plus a Spur-local **project claim** table that makes ownership
exclusive at runtime.

**WHY a claim table rather than a config flag.** Config says who *may* be orchestrator; it cannot stop
two processes from both acting as one after a restart or a stale supervisor. Exclusivity has to be
decided by an atomic write, which is why R3 names the claim boundary. `coordination_runs` is the wrong
home — it is append-per-run history keyed by `run_id`, while a claim is mutable singleton state keyed
by (project, slot).

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/config/src/index.ts` | `orchestrator?: string` on `FleetDeclarationSchema` (0835) |
| `packages/domain/src/migrations.ts` | `PROJECT_CLAIMS_SCHEMA_SQL`, step `0044_spur_cli_project_claims` |
| `packages/domain/src/dao/project-claim-dao.ts` (new) | `ProjectClaimDao` |
| `packages/app/src/services/fleet-service.ts` | `resolveOrchestrator` |
| `apps/cli/src/commands/projects.ts` | orchestrator state in `spur projects list --fleet` |

**Frozen names — storage.** Table `project_claims`, migration id `0044_spur_cli_project_claims`
(prefix `0043` is taken by task 0833), file
`drizzle/0044_spur_cli_project_claims.sql`:

```sql
CREATE TABLE IF NOT EXISTS project_claims (
    project_path     TEXT    NOT NULL,
    slot             TEXT    NOT NULL,         -- 'orchestrator' (this task) | 'write' (0837)
    holder_id        TEXT    NOT NULL,         -- spec id, verbatim
    owner_epoch      INTEGER NOT NULL DEFAULT 1,
    strategy_version INTEGER,                  -- written by 0838; NULL here
    claimed_at       INTEGER NOT NULL,
    heartbeat_at     INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL,
    PRIMARY KEY (project_path, slot)
);
```

The composite primary key **is** the exclusivity mechanism (R3). `owner_epoch` and `strategy_version`
are declared here but written by 0837/0838 — declared once here so 0837 and 0838 need no `ALTER` on this table.

**Frozen names — API.**

```ts
// packages/domain/src/dao/project-claim-dao.ts
interface ProjectClaim { projectPath: string; slot: ClaimSlot; holderId: string; ownerEpoch: number;
                         strategyVersion: number | null; claimedAt: number; heartbeatAt: number; expiresAt: number; }
type ClaimSlot = 'orchestrator' | 'write';
class ProjectClaimDao {
    claim(projectPath: string, slot: ClaimSlot, holderId: string, ttlMs: number): Promise<ProjectClaim | null>;
    heartbeat(projectPath: string, slot: ClaimSlot, holderId: string, ttlMs: number): Promise<boolean>;
    get(projectPath: string, slot: ClaimSlot): Promise<ProjectClaim | null>;
    release(projectPath: string, slot: ClaimSlot, holderId: string): Promise<boolean>;
}
const CLAIM_TTL_MS = 30_000;
```

**Claim algorithm (R3), one statement, no read-then-write.**

```sql
INSERT INTO project_claims (project_path, slot, holder_id, owner_epoch, claimed_at, heartbeat_at, expires_at)
VALUES (?, ?, ?, 1, ?, ?, ?)
ON CONFLICT(project_path, slot) DO UPDATE SET
    holder_id = excluded.holder_id,
    owner_epoch = project_claims.owner_epoch + 1,
    claimed_at = excluded.claimed_at,
    heartbeat_at = excluded.heartbeat_at,
    expires_at = excluded.expires_at
WHERE project_claims.expires_at <= excluded.claimed_at      -- expired
   OR project_claims.holder_id = excluded.holder_id;        -- re-entrant same holder
```

Zero changed rows ⇒ a live claim is held by someone else ⇒ `claim` returns `null` and the caller is
**refused** (R3). Takeover on expiry bumps `owner_epoch`, which is the fencing token 0837 reads.
`heartbeat` is `UPDATE … SET heartbeat_at, expires_at WHERE project_path=? AND slot=? AND holder_id=?`
and returning 0 rows means the holder has been displaced — the caller must stop acting.

**Frozen names — resolution.**

```ts
type OrchestratorState = 'bound-online' | 'bound-offline' | 'missing' | 'unresolvable';
interface OrchestratorBinding { state: OrchestratorState; instanceId?: string; holderId?: string;
                                claim?: ProjectClaim; reason?: string; }
// on FleetService
resolveOrchestrator(projectPath: string): Promise<OrchestratorBinding>;
```

Resolution precedence (R1, R4, R5), first match wins:

1. No declaration, or `orchestrator` absent → `missing`, `reason: 'no-orchestrator-declared'`.
2. `orchestrator` names a member that does not exist, is `enabled: false`, or is not planner-role →
   `unresolvable` with the specific reason. **Refusing to guess is the point** — a mis-typed pointer
   must not silently fall back to "the first planner".
3. Member resolves, no row in `project_claims` for `slot='orchestrator'`, or `expires_at <= now` →
   `bound-offline`, `reason: 'no-live-claim'`.
4. Live claim → `bound-online` with the claim.

`missing` and `bound-offline` are different rows in a switch, never the same falsy check (R4).

**Binding validation (R2).** The declared orchestrator member must have `role: 'planner'` and
`purpose: 'orchestrator'`. Both are asserted at resolve; `purpose` is carried into the generated spec
by the existing `AgentSpecInput.purpose` path, so the running instance can read its own binding.

**Anti-patterns — do not implement.**

- Do not add an `orchestrator` role value to `AGENT_ROLE_NAMES` — closed set, operator consent needed.
- Do not add a `purpose` column, table, or new member field; `purpose` already exists on all three layers.
- Do not infer the orchestrator ("the only planner", "the first member") — an unresolvable pointer is
  an error state, not a search problem.
- Do not read-then-write the claim; the `ON CONFLICT … WHERE` is the whole mechanism.
- Do not collapse `missing` and `bound-offline`, or represent either as "0 orchestrators".
- Do not put claim state in `coordination_runs`, in `fleet.json`, or in process memory.
- Do not reuse `queue_jobs` — copy its token+expiry *pattern*, not the ts-db-owned table.
- Do not touch `SupervisorTab.tsx`'s constant; Board wiring is G63's.

**Handoff.** 0837 reuses `ProjectClaimDao` with `slot: 'write'` and adds `ownerEpoch`/`strategyVersion`
fencing on top of the same rows. 0838 writes `strategy_version` when it claims. 0840/0844 (G63) render
`OrchestratorState` verbatim as the header's availability states.

### Plan

1. Add `orchestrator?: string` to `FleetDeclarationSchema` in `packages/config/src/index.ts`. (R1)
2. Add `PROJECT_CLAIMS_SCHEMA_SQL` to `packages/domain/src/migrations.ts`, register step
   `0044_spur_cli_project_claims`, and add `drizzle/0044_spur_cli_project_claims.sql`. (R3)
3. Add `packages/domain/src/dao/project-claim-dao.ts` with `claim` / `heartbeat` / `get` / `release`
   using the single `ON CONFLICT … WHERE` statement; export from `packages/domain/src/dao/index.ts`. (R3)
4. Add `FleetService.resolveOrchestrator` implementing the four-step precedence, asserting
   `role === 'planner'` and `purpose === 'orchestrator'`. (R1, R2, R4, R5)
5. Surface `OrchestratorState` in `spur projects list --fleet` output and in its `--json`. (R4, R5)
6. Tests, `packages/domain/tests/dao/project-claim-dao.test.ts` (in-memory SQLite): two sequential
   claims — second refused; claim after `expires_at` succeeds and increments `ownerEpoch`; re-entrant
   claim by the same holder succeeds without a second row; `heartbeat` by a displaced holder returns
   false. (R3)
7. Tests, `packages/app/tests/services/fleet-service.test.ts`: each of `missing`, `unresolvable`
   (absent / disabled / wrong-role pointer), `bound-offline`, `bound-online`. (R1, R2, R4, R5)
8. `cd packages/domain && bun test tests/dao/project-claim-dao.test.ts`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §2 reused-vs-simulated contract
- Code: `packages/config/src/index.ts:153-156`, `:379-382` (closed role vocabulary); `apps/web/src/modules/inbox/SupervisorTab.tsx:4`
- Governance: public-surface consent for any role-vocabulary change — `docs/design/harness-surface-governance.md`

### History
