---
schema_version: 1
name: Roster conversion with verbatim spec-ID preservation and rollback
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.301Z
updated_at: "2026-09-13T20:15:13.238Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0846", "0835"]
ac_altitude: task-local
---

## 0847. Roster conversion with verbatim spec-ID preservation and rollback

### Background

This is the highest-risk step in the program. A spec id (`teamId-memberId`) **is** the mailbox
identity and the occupant address in `coordination_runs`; rewriting one orphans inbox rows and
coordination records with no rollback once ids change
(`docs/reports/g6-runtime-inventory.md` §4). The `<role>-<n>` suffix derives from frozen roster order
(`packages/app/src/services/team-service.ts:687-727`), so a reorder during conversion silently
reallocates identities.

Any alias table introduced to bridge an unavoidable rename is a compatibility shim and belongs under
ADR-058 with an explicit exit condition — not an indefinite dual-write.

Historical messages are never deleted.

### Requirements

- **R1** — `agent.team.<id>` blocks convert to project fleet declarations; hand-authored specs are
  preserved untouched.
- **R2** — Every spec id is preserved verbatim, or mapped through a recorded alias; no inbox or
  coordination row is orphaned.
- **R3** — Deterministic `<role>-<n>` derivation is preserved for existing members regardless of
  declaration order.
- **R4** — Conversion is idempotent: re-running changes nothing.
- **R5** — Backup before write and a rollback path that restores the prior state.
- **R6** — Any alias table is tracked under ADR-058 with an explicit exit condition; no indefinite
  dual-writing of rosters or queues.
- **R7** — Conflicts halt rather than merge or delete; no historical message is removed.

### Acceptance Criteria

```gherkin
Feature: Roster conversion with verbatim spec-ID preservation

  @core
  Scenario: Mailbox identity survives conversion
    Given generated specs addressed by existing inbox and coordination rows
    When the migration converts the roster
    Then every spec id is preserved verbatim or mapped through a recorded alias
    And no inbox or coordination row is orphaned

  @core
  Scenario: Conflicts halt rather than merge silently
    Given two legacy teams resolving to one project path, or a work_dir that disagrees with the project
    When the migration encounters them
    Then it reports the conflict and stops without merging or deleting
    And rollback restores the prior state

  @core
  Scenario: Re-running changes nothing
    Given a project already migrated
    When the migration runs again
    Then no further change is written
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:32:25.225Z

- **Does conversion rewrite specs? → No, and that is the entire R2 argument.** Ids are preserved
  verbatim, so `.spur/agents/<id>.yaml` is already correct. A conversion that never opens a spec file
  for writing cannot orphan an `inbox_messages` or `coordination_runs` row. Everything else in this
  task exists to keep that property provable (steps 3 and 8).
- **Is an alias table built? → No.** R6 governs an alias table *if one exists*; verbatim preservation
  means none is needed. Building one speculatively is the indefinite dual-write R6 forbids, and its
  ADR-058 removal condition would be unsatisfiable because no code path would mint an alias. The one
  case that would force a rename, `derived-id-collision`, halts instead. Reopen condition: Robin
  accepts a rename — then the alias table is a new task with its own `config/transition-shims.json`
  entry.
- **Is `agent.team.<id>` deleted after conversion? → No; 0848 owns it.** Leaving it makes the
  conversion additive, makes rollback a one-file operation, and keeps per-member keys that
  `FleetMember` cannot carry (`workspace`, `model`, `autonomy`, `systemPrompt`, `command`, `autostart`
  — `packages/config/src/index.ts:366-391`) working until the noun actually retires. The migration is
  therefore safe to run **before** Robin's cutover window, which is the point: evidence precedes the
  decision.
- **Why is `id` written explicitly for every member? → It is the R3 mechanism.** `<role>-<n>` derives
  from frozen roster order (`memberLocalId`, `packages/config/src/index.ts:452`), so identity today is
  hostage to declaration order. Freezing the derived value into `fleet.json` at conversion time means a
  later reorder in the new file cannot reallocate a mailbox address. Cost: one extra key per member.
- **Backup before or after the conflict check? → After.** Backing up first would leave a `.bak` file
  behind on a blocked run, which reads as "a migration happened" to the next operator. Step 1's test
  asserts zero writes on the blocked path.
- **`enabled` is not `autostart`.** `FleetMember.enabled` means "in the fleet"; `team.autostart` means
  "spawn at serve start". They are not mapped onto each other. `autostart` stays in the untouched
  config block and is reported as an `unmapped-member-override` warning for 0848 to resolve.
- **Deferred, owner Robin:** the cutover window (G64 Notes) and the `spur projects migrate` consent row
  (0846 Design). Neither blocks this task's service or tests; both block the CLI flag.

### Design

**WHAT.** `LegacyMigrationService.apply(projectPath)` — re-runs 0846's `preview()`, refuses when
`blocked`, and writes exactly **one** file: `<projectPath>/.spur/fleet.json`. It deletes nothing,
rewrites no spec, and leaves every `agent.team.<id>` block in place.

**WHY additive-only is the whole safety argument.** A spec id **is** the mailbox identity and the
occupant address (`docs/reports/g6-runtime-inventory.md` §4), and the only way to guarantee it survives
is to never write a spec file during conversion. Because ids are preserved verbatim, the existing
`.spur/agents/<id>.yaml` files are *already* the correct materialized artifacts — the conversion has
nothing to say about them. And because the team config block stays, per-member keys that
`FleetMember` cannot carry (`workspace`, `model`, `autonomy`, `systemPrompt`, `command`, `autostart`)
are not lost here; 0846 records them as `unmapped-member-override` warnings and **0848** — which
retires the block — owns the halt.

This collapses R5 to something small and complete: the only write is one file, so rollback is
"restore `.spur/fleet.json.bak`, or delete the file if there was no prior one."

**WHY no alias table (R6).** Verbatim preservation means no rename, so there is nothing to alias.
An alias table built "in case" is exactly the indefinite dual-write R6 forbids, and it would need an
ADR-058 manifest entry (`config/transition-shims.json`) whose removal condition could never be
satisfied because no code path would ever mint an alias. The one scenario that would force a rename —
`derived-id-collision` — is a **conflict** and halts. If Robin later accepts a rename, the alias table
is a new task with its own ADR-058 entry, not latent code here.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/app/src/services/legacy-migration.ts` | `apply()`, `rollback()`, `ConversionResult` |
| `apps/cli/src/commands/projects.ts` | `--apply` on the `migrate` verb from 0846 (same consent row) |
| `packages/app/src/services/team-service.ts` | none — no write path is touched |
| `.spur/agents/**`, `.spur/config.yaml` | **never written** |

**Frozen names.**

```ts
// packages/app/src/services/legacy-migration.ts
export interface ConversionResult {
    projectPath: string;
    outcome: 'converted' | 'unchanged' | 'blocked' | 'nothing-to-convert';
    fleetPath: string;             // <projectPath>/.spur/fleet.json
    backupPath: string | null;     // <projectPath>/.spur/fleet.json.bak, null when no prior file
    preservedIds: string[];        // every spec id carried through verbatim
    conflicts: LegacyConflict[];   // non-empty iff outcome === 'blocked'
    warnings: LegacyWarning[];     // carried forward for 0848; never blocks
}

export interface RollbackResult {
    outcome: 'restored' | 'removed' | 'nothing-to-roll-back';
    fleetPath: string;
}

// on LegacyMigrationService
async apply(projectPath: string): Promise<ConversionResult>;
async rollback(projectPath: string): Promise<RollbackResult>;
```

**Conversion algorithm (first-match-wins, in order).**

1. `preview(projectPath)`. If `plan.blocked` → return `outcome: 'blocked'` with the conflicts.
   **Nothing is written, backed up, or created.** (R7)
2. Select the source team: the single `agent.team.<id>` block whose `resolveWorkspaceDir(work_dir)`
   normalizes to `projectPath`. Zero such blocks → `'nothing-to-convert'`. Two or more is
   `two-teams-one-project`, already caught in step 1.
3. Build the declaration. For each `members[i]`, with `members` in **declaration order**:
   ```ts
   const localId = memberLocalId(normalizeMember(member), normalized, i); // packages/config/src/index.ts:452
   const fleetMember: FleetMember = {
       id: localId,                      // ALWAYS explicit — this is what freezes identity (R3)
       role: member.role,
       executor: member.executor,
       purpose: member.purpose,
       enabled: true,
   };
   ```
   Emitting `id` explicitly for **every** member is the R3 mechanism: 0835's resolver honours an
   explicit `id` verbatim, so a later reorder or executor swap in `fleet.json` can no longer
   reallocate `<role>-<n>`. The derivation is called once, here, at conversion time.
4. `preservedIds` = `` members.map(m => `${teamId}-${m.id}`) `` — the composed spec id
   (`packages/config/src/index.ts:687`), which is what `.spur/agents/` and `inbox_messages.to_id`
   already use. Assert every element is present in the on-disk spec list **or** absent from
   `addressedSpecIds`; a preserved id that is addressed but has no spec file is a `blocked` outcome.
5. Idempotence (R4): if `.spur/fleet.json` exists and deep-equals the built declaration →
   `'unchanged'`, **no write, no backup**. Deep-equal is on the parsed object, so key order and
   formatting do not cause a spurious rewrite.
6. Backup then write (R5): if a prior `fleet.json` exists, copy it to `fleet.json.bak` first; then
   write the new file with the same atomic temp+rename helper the task writer uses
   (`atomicWriteAsync`, used at `team-service.ts:579`). Return `'converted'`.

**`rollback()`.** `fleet.json.bak` exists → restore it over `fleet.json`, `'restored'`. No `.bak` but
`fleet.json` exists **and** was written by `apply()` → remove it, `'removed'`. Neither →
`'nothing-to-roll-back'`. "Written by `apply()`" is decided by the presence of the `.bak` sibling and
nothing else — no provenance marker is added to `fleet.json`, because 0835 owns that schema and
`version: 1` has no room for one.

**Historical messages (R7).** No statement in this task deletes or updates a row in `inbox_messages`,
`coordination_runs`, or `system_events`. The DB is opened read-only through 0846's `inventory()` and
not at all here.

**Anti-patterns — do not implement.**

- Do not write, move, re-tag, or delete any file under `.spur/agents/`.
- Do not edit or remove `agent.team.<id>` from `.spur/config.yaml`. 0848 owns the block's fate.
- Do not build an alias table, an id-mapping file, or a rename path.
- Do not call `materializeTeam` or `teardownTeam`.
- Do not delete orphan specs. 0846 classifies them `retire`; the operator removes one with the
  existing `spur agent delete <id>` (`apps/cli/src/commands/agent.ts:215`), which is not this task's work.
- Do not auto-resolve a conflict, prefer one team over another, or merge rosters.
- Do not re-derive `<role>-<n>` by hand; call `memberLocalId`.
- Do not add a provenance/marker field to `fleet.json`.

**Handoff.** 0848 reads `warnings[]` to decide whether an `agent.team.<id>` block can be retired
without losing a member override, and reads `preservedIds` to prove no capability moved identity.
0849 is independent of this task. 0835's `FleetService.load()` is the only reader of the file this
task writes — the shapes must match `FleetDeclarationSchema` exactly, or `load()` rejects it.

### Plan

1. **(R7)** Add `apply(projectPath)` to `legacy-migration.ts`, step 1 only: call `preview()`, and
   return `{ outcome: 'blocked', conflicts }` when `plan.blocked`. Write nothing on that path.
   *Test intent:* with a two-teams-one-project fixture, `apply()` returns `blocked` **and** the fs spy
   records zero write calls — no backup file appears either, which is the failure mode a
   "back up first, then validate" ordering would ship.
2. **(R1, R3)** Implement declaration building: select the single team whose resolved `work_dir`
   normalizes to `projectPath`, map each member to a `FleetMember` with an **explicit** `id` from
   `memberLocalId`, and copy `role` / `executor` / `purpose`.
   *Test intent:* a three-member roster with two `coder`s produces ids `coder-1` and `coder-2` matching
   what `materializeTeam` already generated on disk, and re-ordering the same roster in the fixture
   produces the **same** ids because `id` is now explicit — the reorder hazard named in §4.
3. **(R2)** Compute `preservedIds` as `<teamId>-<localId>` and validate: every id that appears in
   `addressedSpecIds` must have a spec file on disk. Fail to `blocked` otherwise.
   *Test intent:* seed one `inbox_messages` row addressed to a spec id with no file and assert
   `outcome === 'blocked'`; then assert the happy path's `preservedIds` equals the on-disk spec id
   list character for character.
4. **(R4)** Implement idempotence: parse an existing `fleet.json`, deep-compare with the built
   declaration, return `'unchanged'` with no write and no backup when equal.
   *Test intent:* run `apply()` twice on the same fixture; the second returns `'unchanged'`, the file
   mtime is untouched, and no `.bak` is created.
5. **(R5)** Implement backup-then-write: copy an existing `fleet.json` to `fleet.json.bak`, then
   `atomicWriteAsync` the new content. Add `rollback()` with its three outcomes.
   *Test intent:* apply over a pre-existing `fleet.json`, then `rollback()`, and assert the file is
   byte-identical to the original; separately, apply where no prior file existed, roll back, and
   assert the file is gone.
6. **(R1)** Assert the written object parses under `FleetDeclarationSchema` from
   `@gobing-ai/spur-config` (task 0835) before the write returns.
   *Test intent:* a schema round-trip test — this is the contract `FleetService.load()` enforces at
   read time, and failing it here is cheaper than failing it at serve start.
7. **(R6)** Add an assertion test that the module source contains no alias/mapping construct: no
   export whose name matches `/alias/i`, and no new entry in `config/transition-shims.json`.
   *Test intent:* R6 is satisfied by absence, so it needs a test that absence is deliberate.
8. **(R1, R7)** Add the no-collateral-writes test: run the full `apply()` happy path with an fs spy and
   assert every write path is under `<projectPath>/.spur/fleet.json*` — nothing under `.spur/agents/`,
   nothing named `config.yaml`.
9. **(R5)** Register `--apply` on the `migrate` verb from 0846 (same consent row; same gate — land
   after the row exists). `--dry-run` stays the default; `--apply` is explicit and never implied.
   *Test intent:* a CLI test asserts that a bare `spur projects migrate` previews and does not write.
10. Run `cd packages/app && bun test tests/services/legacy-migration.test.ts`, then
    `bun run spur-check` once.

### Solution

Migration conversion writes explicit local member IDs while preserving the legacy spec files and
database rows. Differing fleet declarations are backed up before atomic replacement; rollback restores
the backup or removes a declaration created by the current service instance.

Verification fixes (2026-09-13):

- `packages/app/src/services/legacy-migration.ts:383` obtains addresses through a read-only callback.
  The registry/team prefix check at `packages/app/src/services/legacy-migration.ts:447` refuses
  conversion with `project-name-mismatch` instead of silently changing fleet mailbox identities.
- `packages/domain/src/dao/addressed-spec-ids.ts:21` opens existing SQLite databases read-only and
  closes them after querying the existing tables. No migrations run during inspection.
- `apps/cli/src/commands/projects.ts:443` wires that reader for both preview and apply; absent databases
  contribute no addresses. This fixes dry-run writes through the previous migrated adapter.
- `packages/app/tests/services/legacy-migration.test.ts:169` checks prefix-conflict refusal and zero
  writes; `apps/cli/tests/commands/projects.test.ts:478` proves an old database's bytes and directory
  contents survive preview unchanged. Both tests failed before the fix and pass afterward.
- `docs/design/project-switcher.md:122` documents migration's read-only and prefix-conflict contract;
  the owning CLI reference is synchronized. The normal build regenerates the plugin handoff bundle.

Design refinement: mismatched registry names halt for explicit operator correction; no registry rename,
alias table, or roster merge is introduced. The conversion remains additive and rollback-capable.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/legacy-migration.test.ts:185`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; refreshed local verification scratch `.spur/run/0847-verify-answer.txt` lines 1-41 and derived `.spur/run/0847-verdict.json`; repository gate separately FAILs on three concurrent taste-refactoring skill checks |
| R2 | MET | `packages/app/tests/services/legacy-migration.test.ts:169`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:273`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:364`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R3 | MET | `packages/app/tests/services/legacy-migration.test.ts:217`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R4 | MET | `packages/app/tests/services/legacy-migration.test.ts:298`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R5 | MET | `packages/app/tests/services/legacy-migration.test.ts:318`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:340`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R6 | MET | `packages/app/tests/services/legacy-migration.test.ts:410`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R7 | MET | `packages/app/tests/services/legacy-migration.test.ts:244`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `apps/cli/tests/commands/projects.test.ts:528`; cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts — exit 0, 38 pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Mailbox identity survives conversion | MET | test | `packages/app/tests/services/legacy-migration.test.ts:169`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:364`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| Scenario: Conflicts halt rather than merge silently | MET | test | `packages/app/tests/services/legacy-migration.test.ts:244`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:318`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| Scenario: Re-running changes nothing | MET | test | `packages/app/tests/services/legacy-migration.test.ts:298`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | DONE: additive conversion, explicit local ids, no alias, backup and rollback. CHANGED: documented prefix mismatch guard and read-only address callback repair the identity/zero-write invariants (Solution). |
| P4 | scoped-checks | — | G64 focused tests, bun run typecheck, bun run test-cf, bun run build — exit 0 this run; full repository gate separately failed on concurrent taste-refactoring skill changes |
| P4 | task-check | — | spur task check 0847 --strict-core --json — exit 0 |
| P4 | cli-golden-path-present | — | Focused projects/team-retirement command tests invoke the real main() registration with --json; successful and refusal paths asserted |
| P4 | secua-review | — | Fixed database mutation during preview and mailbox-prefix drift; both regressions reproduced before repair. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Disposition matrix: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4, including rollback constraints
- Code: `packages/app/src/services/team-service.ts:687-727`, `:745-790` (deterministic `<role>-<n>` derivation)
- Compatibility shims tracked under ADR-058 (`docs/00_ADR.md`) with an explicit exit condition
- Preserved owner: G4 (occupant identity, coordination run records)

### History

- 2026-09-13T00:14:29.330Z todo → wip (system)
- 2026-09-13T01:39:59.474Z wip → testing (system)
- 2026-09-13T01:40:01.222Z testing → done (system)

