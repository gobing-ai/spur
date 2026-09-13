---
schema_version: 1
name: Orchestrator binding with a single active owner
status: done
template: feature-impl
created_at: 2026-09-12T04:53:38.723Z
updated_at: "2026-09-13T08:04:44.205Z"
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

**SPEC DRIFT CORRECTION (mandatory, G61 0833 precedent).** The spec's frozen migration id
`0044_spur_cli_project_claims` was stale — 0043 (0832 inbox mirror) and 0044 (0833 coordination_runs
receipt columns) are both registered. Implemented as **`0045_spur_cli_project_claims`** everywhere
(`CLI_MIGRATIONS` step, drizzle mirror, tests); the frozen spec text was not edited. Frozen names
(table `project_claims`, columns, DAO method set, `CLAIM_TTL_MS = 30_000`) are unchanged.

Change map (all additions are 0836's own surface; 0835's uncommitted tree untouched):

- `packages/config/src/index.ts:547` — `orchestrator: z.string().min(1).optional()` on
  `FleetDeclarationSchema` (R1): the pointer names a member by its declaration-level `memberLocalId`;
  absent = `missing`, never inferred.
- `packages/domain/src/migrations.ts:297` — `PROJECT_CLAIMS_SCHEMA_SQL` (composite PK
  `(project_path, slot)` IS the exclusivity mechanism; `owner_epoch`/`strategy_version` declared for
  0837/0838 with no second migration); `:334` joined into `CLI_SCHEMA_SQL` (fresh-db path, 0040
  precedent); `:1402-1408` — step `0045_spur_cli_project_claims` (standalone CREATE TABLE IF NOT
  EXISTS). Inline SQL comment reworded `; NULL here` → `(NULL until then)`:
  `splitSqlStatements` splits naively on `;` and a semicolon inside an inline comment truncates the
  statement (found by the dao test's first run).
- `drizzle/0045_spur_cli_project_claims.sql` — regenerate-on-release mirror, byte-compatible at
  statement level (folder-load path).
- `packages/domain/src/dao/project-claim-dao.ts:67` (new) — `ProjectClaimDao`: `claim` (:77) is the
  frozen single-statement `INSERT … ON CONFLICT(project_path, slot) DO UPDATE … WHERE expires_at <=
  excluded.claimed_at OR holder_id = excluded.holder_id`; zero changed rows ⇒ refused (`null`, R3);
  takeover bumps `owner_epoch` (0837's fencing token). `heartbeat` (:107) by a displaced holder
  returns false; `get` (:123); `release` (:135) holder-scoped. `CLAIM_TTL_MS = 30_000` (:16, module
  constant per Q&A). Changed-row detection reuses the `SELECT changes()` probe
  (`packages/domain/src/dao/agent-executor-update-dao.ts:160` precedent) — no read-then-write.
- `packages/domain/src/dao/index.ts:26-32` — dao barrel export (re-exported by the domain index).
- `packages/app/src/services/fleet-service.ts:249` — `FleetService.resolveOrchestrator`, four-step
  precedence first-match-wins: `missing` (`no-orchestrator-declared`) → `unresolvable`
  (`unknown-member:` / `member-disabled:` / `wrong-role:` / `missing-purpose:`, each naming the
  pointer — error, never inference) → `bound-offline` (`no-live-claim`, expired row included) →
  `bound-online` (claim attached). R2 asserted here: `role === 'planner'` AND
  `purpose === 'orchestrator'`. `:84-100` — `OrchestratorState`/`OrchestratorBinding` (missing and
  bound-offline are distinct states, R4); `:53` — `FleetServiceContext.openDb` factory (caller-owned
  adapter; claim reads are the only db touch).
- `packages/app/src/index.ts:196-201` — export the 0836 binding types.
- `apps/cli/src/commands/projects.ts:131` — `openProjectDb` (lazy per-project `.spur/spur.db`; only
  pointer-resolving projects touch SQLite); `:152-160` per-project orchestrator resolution with
  isolated `orchestratorError` (one project's db failure never fails the listing); `:181-183` `--json`
  gains `orchestrator` + `orchestratorError`; `:226-245` text lines for all four states + unavailable.
  Flag surface only — no new verb (public-surface rule).
- Docs: `docs/help/cmd_projects.md:55`, `plugins/sp/skills/spur-cli/references/projects.md:47-56`.

Tests (`<pkg>/tests/**/*.test.ts` per sp:code-testing):
- `packages/domain/tests/dao/project-claim-dao.test.ts` (new, 6 tests): second live claimant refused;
  takeover after expiry bumps `ownerEpoch` to 2; re-entrant same-holder claim succeeds with one row;
  displaced-holder heartbeat false / holder heartbeat extends; release holder-scoped; slots
  independent (`orchestrator` vs `write`).
- `packages/app/tests/services/fleet-service.test.ts` (+9 tests): missing (no declaration; empty
  roster — R5); unresolvable unknown/disabled/wrong-role/missing-purpose pointers; bound-offline
  (no claim; EXPIRED claim still offline — R4); bound-online with live claim (`ownerEpoch` 1).
- `packages/domain/tests/dao/migrations.test.ts` — 0045 registered at index 45 (46 steps),
  applied-count shifts (+1 unconditional step), folder-load byte-compat for 0045 (0833 precedent).
- `packages/domain/tests/retention.test.ts:166-173` — aligned the fresh-db compaction assertion with
  its own documented contract ("compaction may run or skip"): 0836's `project_claims` table pushed a
  fresh DB's page-slack over `COMPACTION_MIN_RECLAIM_RATIO` (0.03), so VACUUM now legitimately runs
  on a fresh db (663552 → 659456 bytes). The guarantee that matters — never crashes, never GROWS the
  file — is what the test now asserts (`bytesAfter <= bytesBefore`).

#### 2026-09-13 forced re-audit

Re-audit repair: online binding now requires the live holder to match the declared instance. The same-spec orchestrator re-claim remains a failing ownership probe; no claim/heartbeat launch integration is certified.

Current per-requirement evidence and residuals are in Testing and `docs/reports/g62-verifyall-2026-09-13.md`. Earlier implementation-time anchors and completion statements above are historical; this re-audit supersedes them.

#### G62 closure — 2026-09-13

This implementation supersedes the unresolved gaps recorded in the preceding re-audit. Live ownership is exclusive across processes, including processes using the same stable spec ID. Renewal and release require the acquired generation. The production orchestrator loop acquires, renews and releases that generation and refuses another owner.

Regression evidence is recorded in the refreshed Testing section. New changes are intentionally uncommitted for the operator's next step.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/fleet-service.test.ts:723` — binding is online only when the live holder matches the declared instance; `bun run spur-check` (exit 0). Measured repository coverage: 98.99% lines, 99.21% functions. Evidence: G62 closure `.spur/run/g62-verifyall-20260913/spur-check-shippable.log` line 1 through EOF. Replaces Evidence: G62 re-audit `.spur/run/0836-verify-answer.txt` line 1 through EOF and `.spur/run/0836-verdict.json` line 1 through EOF; prior artifacts are preserved under the closure run directory. |
| R2 | MET | `packages/app/tests/services/fleet-service.test.ts:654` — the existing planner role requires orchestrator purpose; `bun run spur-check` (exit 0). |
| R3 | MET | `packages/domain/tests/dao/project-claim-dao.test.ts:68` — live same-spec reacquisition is refused and displaced epochs cannot heartbeat or release; `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `bun run spur-check` (exit 0). |
| R4 | MET | `packages/app/tests/services/fleet-service.test.ts:669` — missing and offline are distinct with actionable reasons; `bun run spur-check` (exit 0). |
| R5 | MET | `packages/app/tests/services/fleet-service.test.ts:589` — an empty/unbound fleet resolves cleanly; `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| One member is the project's orchestrator | MET | test | `packages/app/tests/services/fleet-service.test.ts:723` — binding is online only when the live holder matches the declared instance; `bun run spur-check` (exit 0). |
| A second owner cannot claim the role | MET | test | `packages/domain/tests/dao/project-claim-dao.test.ts:68` — live same-spec reacquisition is refused and displaced epochs cannot heartbeat or release; `apps/cli/tests/commands/agent-loop-wake.test.ts:363` — production loop acquires the declared owner, selects a ready authorized task through the real checker, refuses a second owner, reconciles and prevents duplicate dispatch after restart; `bun run spur-check` (exit 0). |
| Missing and offline are different answers | MET | test | `packages/app/tests/services/fleet-service.test.ts:669` — missing and offline are distinct with actionable reasons; `bun run spur-check` (exit 0). |
| An empty fleet still resolves | MET | test | `packages/app/tests/services/fleet-service.test.ts:589` — an empty/unbound fleet resolves cleanly; `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0836 (pipeline Phase 7, observe-only)

**Scope:** 0836's surface over base ca2a760c — `0045_spur_cli_project_claims` migration + drizzle mirror, `packages/domain/src/dao/project-claim-dao.ts` (new), `FleetService.resolveOrchestrator` + binding types + `openDb` seam, config `orchestrator` pointer, `spur projects list --fleet` orchestrator state, docs rows. 0835's materialize/roster surface excluded per review scope.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | The CLI orchestrator surface has no test: the four-state text switch, `orchestratorError` isolation, and the `--json` `orchestrator`/`orchestratorError` projection are unrendered by any test (the two new `projects.test.ts` cases cover only 0835's fleet lines; zero `orchestrator` assertions there). The service layer beneath is fully covered (9 resolution tests), so the logic is verified — but a swapped label or a dropped json field would fail nothing. Add one CLI render test in a bounded follow-up. | `apps/cli/src/commands/projects.ts:152-186,228-245` |
| 2 | P4 (advisory) | correctness | A re-entrant same-holder claim also bumps `owner_epoch` (+1), so a restart invalidates previously observed epochs without any displacement. This is the frozen spec SQL verbatim, and epoch semantics are explicitly 0837-owned (Q&A deferred) — not a defect here; 0837 must treat the epoch as claim-generation, not displacement counter. | `packages/domain/src/dao/project-claim-dao.ts:82-91` |
| 3 | P4 (advisory) | correctness | `claim` returns its value via a post-write `get()` read; under a concurrent takeover the returned row can describe the other claimant. The refuse/accept decision itself is atomic (single statement + `SELECT changes()` probe); only the advisory return value can race. No caller exists yet (0837 is the first); if a caller needs a guaranteed-self row, echo the input instead. | `packages/domain/src/dao/project-claim-dao.ts:97-101` |
| 4 | P4 (advisory) | functional | Out-of-scope observation (0835's docs row, shared uncommitted tree): three `@core` scenario headers were inserted between `Scenario: R7 — Idle costs nothing` and its Given/When/Then, orphaning those steps onto `Scenario: Launch validates its own ground truth`. Not 0836 surface; the placement fix belongs to 0835's record. | `docs/features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md:106-113` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | pointer → enabled planner member with live claim; one holder enforced by composite PK (`fleet-service.ts:249-299`; bound-online test, `ownerEpoch` 1) |
| R2 | MET | carrier = existing `purpose` + `role === 'planner'`, both asserted (`fleet-service.ts:276-291`); `AGENT_ROLE_NAMES` unchanged (`config/src/index.ts:153`); config adds only the pointer (`config/src/index.ts:547`) |
| R3 | MET | single-statement refusal, zero changed rows ⇒ `null` (`project-claim-dao.ts:77-101`); tests: second live claimant refused; takeover on expiry bumps epoch 1→2 |
| R4 | MET | `missing` and `bound-offline` distinct states with distinct reasons (`fleet-service.ts:259,297`); expired-claim-still-offline test; distinct CLI lines (`projects.ts:228-240`) |
| R5 | MET | value-never-throw resolution; empty fleet → `missing` test; per-project `orchestrator: unavailable (<error>)` isolation (`projects.ts:243-245`) |

Spec-drift correction verified: Solution carries the 0044→0045 note (G61 0833 precedent); mirrored in code comments (`migrations.ts:291-294`, drizzle header) and asserted by test (`migrations.test.ts` — 46 steps, index 45 id+sql, folder-load byte-compat via stripComments).

Scrutiny checklist: single-statement atomicity ✓ (frozen SQL verbatim; `SELECT changes()` probe = `agent-executor-update-dao.ts:160` precedent — probe reads the result, no read-then-write decision); displaced-holder heartbeat=false ✓ (dao test, post-takeover displacement); holder-scoped release ✓ (`:135-143`); epoch bump on takeover ✓; 4-step precedence exact ✓ (missing → unresolvable ×4 each naming the pointer → bound-offline → bound-online); TTL boundary consistent (`expires_at <= excluded.claimed_at` in claim, `expiresAt <= now` in resolve); R6 enforcement present at the claim-registration statement (exclusivity decided by the atomic write, not reads/config) with 0835's `assertLaunchGroundTruth` intact (`fleet-service.ts:437`); flag-not-verb ✓ (`--fleet` on the existing `list` verb; help rows updated in both docs); 0045 registration + byte-compat mirror ✓.

**Fresh evidence (re-run by this review):** domain 69 pass / 0 fail (project-claim-dao + migrations + retention); app fleet-service 27 pass / 0 fail (77 expect); cli projects 13 pass / 0 fail. Prior full gate: rc=0, 8107 pass / 0 fail (`.spur/run/0836-test-gate.status`).

**Next:** disposition finding 1 (bounded CLI render test or explicit accept); carry findings 2–3 into 0837's handoff reading.

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §2 reused-vs-simulated contract
- Code: `packages/config/src/index.ts:153-156`, `:379-382` (closed role vocabulary); `apps/web/src/modules/inbox/SupervisorTab.tsx:4`
- Governance: public-surface consent for any role-vocabulary change — `docs/design/harness-surface-governance.md`

### History

- 2026-09-12T16:42:51.509Z todo → wip (system)
- 2026-09-12T17:29:51.577Z wip → testing (system)
- 2026-09-12T17:29:52.193Z testing → done (system)

