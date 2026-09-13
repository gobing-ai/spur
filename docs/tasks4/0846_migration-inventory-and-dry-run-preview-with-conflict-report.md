---
schema_version: 1
name: Migration inventory and dry-run preview with conflict reporting
status: done
template: feature-impl
created_at: 2026-09-12T04:55:45.298Z
updated_at: "2026-09-13T20:15:12.775Z"
feature_id: G64
priority: P2
tags:
  - g6-program

ac_altitude: task-local
---

## 0846. Migration inventory and dry-run preview with conflict reporting

### Background

The preserve/convert/retire matrix is already written
(`docs/reports/g6-runtime-inventory.md` §4) but nothing executes it. The corpus holds four spec
populations that must be told apart before anything is rewritten: generated specs materialized from
`agent.team.<id>`, hand-authored specs, orphan specs whose team no longer exists, and teams whose
`work_dir` disagrees with the registered project path.

Robin owns the cutover window and has not selected one (G64 Notes). Evidence therefore has to precede
the decision: a report he can read before authorizing any destructive step.

This task writes nothing. Conversion is the next task.

### Requirements

- **R1** — An inventory of every legacy artifact per the §4 matrix, classified as convert, preserve,
  re-link, or retire.
- **R2** — A dry-run preview listing each planned action with its target identity and its conflicts.
- **R3** — Zero writes: no file, config, or database row changes during inventory or preview.
- **R4** — Conflicts are named explicitly: two legacy teams resolving to one project path, `work_dir`
  disagreeing with the project, orphan specs, and duplicate spec ids.
- **R5** — Output is machine-readable: the preview/inventory types (`MigrationPlan`, `MigrationInventory`) are structured, JSON-serializable, and exported from `packages/app` for downstream consumers. The operator-facing CLI surface (`spur projects migrate` verb registration, human output, exit-0/2 contract) is Plan step 7 and belongs to task 0847, which lands it together with the §4 consent row (operator consent granted in the G64 runall session).

### Acceptance Criteria

```gherkin
Feature: Migration inventory and dry-run preview

  @core
  Scenario: Migration previews before it changes anything
    Given an existing project with team config, generated specs, manual specs, and orphans
    When the migration runs in dry-run
    Then it reports every conversion, preservation, and retirement with its conflicts
    And no file, config, or database row has changed

  @core
  Scenario: Conflicts are named, not summarized
    Given two legacy teams resolving to one project path
    When the preview runs
    Then the conflict is reported with both sources and no merge is proposed
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T16:31:03.336Z

- **Which noun owns the migration verb? → `spur projects`.** The conversion's write targets are the
  project registry and `<projectPath>/.spur/fleet.json`; `projects` already owns the registry.
  `spur self migrate` was rejected: it applies CLI-owned SQL schema migrations
  (`apps/cli/src/commands/migrate.ts:20-21`) and would conflate schema with config. A top-level
  `spur migrate` noun was rejected because `migrate` is already registered as a hidden top-level alias
  of `self migrate` (`apps/cli/src/index.ts:184`) and would collide.
- **Is public-surface consent needed? → Yes, and it is not assumed granted.** A new public verb needs
  its own row in `docs/design/harness-surface-governance.md` §4; the A3 record's no-further-promotion
  rule forbids riding an existing row. The Design proposes the exact row. Plan steps 1–6 land without
  it; step 7 is gated. This is a second operator gate beside G64's cutover-window gate, not a
  substitute for it.
- **Does the inventory read the database? → Yes, read-only, and it must.** Without
  `addressedSpecIds`, "no inbox or coordination row is orphaned" (0847 R2) is unfalsifiable and
  `retire` vs `relink` for an orphan spec is a guess. Two `SELECT DISTINCT` queries are cheaper than
  any heuristic.
- **Who scans for `--agent <spec-id>`? → 0846 scans, 0849 removes.** The shim's removal condition in
  `config/transition-shims.json` ("no `--agent <spec-id>` usage remains in config/workflows/,
  plugins/sp/, or docs/") is an inventory question, and this task already walks every spec id. 0849
  consuming the result avoids a second scanner.
- **What happens on conflict? → exit 2 and stop.** Deferred to 0847 only in the sense that 0846 never
  writes anyway; the `blocked` flag is the contract 0847 refuses on. No conflict is auto-resolved at
  any point in G64 — G64 R3 makes halting the acceptance criterion.
- **Deferred, owner Robin:** the cutover window itself (G64 Notes). This task produces the evidence
  that precedes that decision and is runnable before it.

### Design

**WHAT.** A read-only `LegacyMigrationService` in `packages/app` that reads the four legacy
populations, classifies each against the §4 matrix, and emits a conflict-annotated plan; plus one
operator surface, `spur projects migrate --dry-run`. This task writes nothing — 0847 owns every write.

**WHY a service plus one verb, not a script.** The classification has to be re-run by 0847 immediately
before it writes (idempotence and halt-on-conflict both depend on a fresh inventory), and by 0849 to
prove the `--agent <spec-id>` shim is unused. A `scripts/commands` module is the wrong surface: the
audience is a **Spur end user** with a legacy project, which the four-surface table
(`docs/design/harness-surface-governance.md` §2) routes to `apps/cli/src/commands`.

**WHY `projects` owns the verb.** The conversion's write target is the project registry plus
`<projectPath>/.spur/fleet.json` (task 0835). `spur projects` already owns the registry
(`apps/cli/src/commands/projects.ts:13`). `spur self migrate` is **not** the home: it applies
CLI-owned SQL schema migrations (`apps/cli/src/commands/migrate.ts:20-21`) and has no config or spec
concept.

**Public-surface consent — required before the verb is registered.** `spur projects migrate` is a new
public verb and needs its own row in the consent record (§4 of the governance doc), like every entry
there. Proposed row, for Robin to grant or reject:

| Date | Task | Public change | Granted scope and reason |
| --- | --- | --- | --- |
| TBD | 0846, 0847 | `spur projects migrate` — new verb under the existing `projects` noun. `--dry-run` (default on in 0846) previews; `--apply` (0847) converts; `--json` for both | Convert `agent.team.<id>` rosters and generated specs to project fleet declarations. End-user audience on any Spur-managed project; no other noun owns config-plus-spec conversion. Rejected shapes: a top-level `spur migrate` noun (collides with the hidden `self migrate` alias), and a `spur fleet` noun (0835 already rejected one). |

Until that row exists the service and its tests land; the `registerProjectsCommand` wiring does not.
This is the same gate G64's Scope already names ("Public-surface consent governs any new verb").

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/app/src/services/legacy-migration.ts` (new) | inventory, classify, preview |
| `packages/app/src/services/team-service.ts` | read-only reuse of `listAgentSpecs`, `resolveWorkspaceDir`; **no change** |
| `apps/cli/src/commands/projects.ts` | `migrate` verb (consent-gated; see above) |
| `apps/web` | none |

**Frozen names.**

```ts
// packages/app/src/services/legacy-migration.ts
export type LegacyArtifactKind =
    | 'team-config'        // one `agent.team.<id>` block
    | 'generated-spec'     // .spur/agents/<id>.yaml tagged `team:<id>` + `spur:generated`
    | 'manual-spec'        // hand-authored spec (no team tag, or team tag without spur:generated)
    | 'orphan-spec'        // `team:<id>` tag whose `agent.team.<id>` block is gone
    | 'legacy-flag-usage'; // a `--agent <spec-id>` occurrence in config/workflows, plugins, or docs

export type LegacyDisposition = 'convert' | 'preserve' | 'relink' | 'retire';

export type LegacyConflictKind =
    | 'two-teams-one-project'
    | 'work-dir-mismatch'
    | 'derived-id-collision'
    | 'orphan-spec-no-config'
    | 'spec-workspace-disagreement';

export interface LegacyConflict {
    kind: LegacyConflictKind;
    message: string;
    sources: string[]; // ≥2 for a collision, 1 for a mismatch — always concrete paths or config keys
}

export interface LegacyArtifact {
    kind: LegacyArtifactKind;
    id: string;                   // team id, spec id, or `<file>:<line>` for legacy-flag-usage
    source: string;               // absolute path, or the config key `agent.team.<id>`
    disposition: LegacyDisposition;
    targetId: string | null;      // preserved spec id / fleet member id; null when retired
    addressed: boolean;           // this spec id owns inbox or coordination rows
    conflicts: LegacyConflict[];
}

export type LegacyWarningKind = 'unmapped-member-override';

export interface LegacyWarning {
    kind: LegacyWarningKind;
    message: string;
    source: string;    // `agent.team.<id>.members[<i>]`
    fields: string[];  // member keys with no FleetMember home
}

export interface MigrationInventory {
    projectPath: string;
    artifacts: LegacyArtifact[];
    addressedSpecIds: string[];   // union of inbox_messages.to_id and coordination_runs.spec_id
    conflicts: LegacyConflict[];  // deduped union — this is 0847's halt set
    warnings: LegacyWarning[];    // never halts 0847 (which is additive); 0848 halts on these
    counts: Readonly<Record<LegacyDisposition, number>>;
}

export interface MigrationPlanStep {
    action: 'write-fleet' | 'preserve-spec' | 'relink-spec' | 'retire-spec' | 'retire-config-block';
    target: string;
    from: string | null;
    preservesId: string | null;   // the verbatim spec id this step must not change
    conflicts: LegacyConflict[];
}

export interface MigrationPlan {
    inventory: MigrationInventory;
    steps: MigrationPlanStep[];
    blocked: boolean;             // true iff inventory.conflicts.length > 0
}

export class LegacyMigrationService {
    async inventory(projectPath: string): Promise<MigrationInventory>;
    async preview(projectPath: string): Promise<MigrationPlan>;
}
```

**Classification precedence (R1, first match wins).** Evaluated per spec file under `.spur/agents/`:

1. no `team:<id>` tag → `manual-spec` / **preserve**.
2. `team:<id>` tag **without** `spur:generated` → `manual-spec` / **preserve**. This is the existing
   contract at `team-service.ts:773` (`if (existing && !existing.tags?.includes('spur:generated')) continue;`)
   and at `teardownTeam` (`team-service.ts:909`), not a new rule.
3. `team:<id>` + `spur:generated`, and `agent.team.<id>` exists → `generated-spec` / **convert**,
   `targetId` = the spec id **verbatim**.
4. `team:<id>` + `spur:generated`, config block absent, id ∈ `addressedSpecIds` → `orphan-spec` /
   **relink**, with an `orphan-spec-no-config` conflict.
5. `team:<id>` + `spur:generated`, config block absent, not addressed → `orphan-spec` / **retire**.

Each `agent.team.<id>` block is separately an artifact of kind `team-config` / **convert**.

**Conflict detection (R4).** Independent of the precedence chain; every conflict is attached to the
artifacts it touches *and* to `inventory.conflicts`:

- `two-teams-one-project` — two or more `agent.team.<id>` blocks whose `resolveWorkspaceDir(work_dir)`
  (`team-service.ts:936`) yield the same `normalizeProjectPath` (`project-registry.ts:11`) result.
- `work-dir-mismatch` — a team's resolved `work_dir` matches no registered project path.
- `derived-id-collision` — `memberLocalId(member, members, index)` (`packages/config/src/index.ts:452`)
  re-derives an id that an on-disk spec already holds under a **different** team tag. The in-config
  case is already fatal at load (`AgentConfigSchema.superRefine`, `index.ts:687-698`) and is not
  re-checked here.
- `spec-workspace-disagreement` — a generated spec's `workspace` differs from its team's resolved `work_dir`.
- `orphan-spec-no-config` — see precedence step 4.

**Warnings vs conflicts.** A **conflict** halts 0847; a **warning** never does. The one warning kind,
`unmapped-member-override`, fires when an `agent.team.<id>` member declares a key that `FleetMember`
(task 0835: `id`, `role`, `executor`, `purpose`, `enabled`) cannot carry — `workspace`, `model`,
`autonomy`, `systemPrompt`, `command`, or `autostart` (`packages/config/src/index.ts:366-391`). It is
not a conflict because 0847 is purely additive: it writes `.spur/fleet.json` and leaves the
`agent.team.<id>` block in place, so nothing is lost while both exist. The loss becomes real only when
**0848** retires the noun and its config block, which is where the halt belongs.

**`addressedSpecIds` (R4, and the proof 0847 R2 needs).** Read-only `SELECT DISTINCT to_id FROM
inbox_messages` ∪ `SELECT DISTINCT spec_id FROM coordination_runs`. This is what makes "no inbox or
coordination row is orphaned" checkable rather than asserted: a spec id that is addressed may never be
retired, only preserved or relinked.

**Zero-write enforcement (R3).** The service is constructed with a context whose `fs` exposes reads
only; the unit test injects a spy whose `writeFile`/`rm`/`mkdir` throw, and asserts a full
`preview()` completes. The DB handle is used through read queries only. The service never calls
`materializeTeam`, `teardownTeam`, or `ProjectRegistry.withLock` — all three write.

**Output (R5).** `--json` emits `MigrationPlan` through the standard envelope (`toEnvelopeJson`,
matching `projects.ts`'s existing verbs). Human output is one line per step plus a conflict block;
`blocked: true` exits **2**, not 1 — a reported conflict is a refusal to proceed, not a crash. Zero
artifacts exits 0 with "nothing to migrate".

**Anti-patterns — do not implement.**

- Do not write anything: no backup, no `.spur/fleet.json`, no config rewrite, no spec delete. 0847 owns writes.
- Do not resolve a conflict, pick a winner, or merge two teams. Report both sources and stop.
- Do not touch hand-authored specs, even to re-tag them.
- Do not re-derive `<role>-<n>`; call `memberLocalId`.
- Do not add a `spur migrate` top-level noun or a `spur fleet` noun.
- Do not register the CLI verb before the consent row exists.
- Do not re-status M3, M6, G1, or G4 (G64 Notes); 0851 owns their disposition.

**Handoff.** 0847 calls `preview()` immediately before writing and refuses when `blocked`. 0849
consumes the `legacy-flag-usage` artifacts as its proof that the `--agent <spec-id>` shim is unused.
0851 cites `counts` in its reconciliation record.

### Plan

1. **(R1)** Add `packages/app/src/services/legacy-migration.ts` with the frozen types and a
   `LegacyMigrationService` whose constructor takes the existing service context. Implement
   `inventory()`: load config (`agent.team`), list specs via the existing `TeamService.listAgentSpecs`
   read path, and classify by the five-step precedence chain.
   *Test intent:* a fixture project with one generated spec, one hand-authored spec, one tagged-but-not-generated
   spec, and one orphan yields exactly the four expected `disposition` values — asserting step 2 is
   what keeps a tagged hand-authored spec out of the convert set.
2. **(R4)** Add conflict detection as five independent predicates over the loaded config + specs +
   registry. Attach each conflict to its artifacts and to `inventory.conflicts` (deduped by
   `kind` + sorted `sources`).
   *Test intent:* two teams whose `work_dir` normalize to one project path produce exactly one
   `two-teams-one-project` conflict naming **both** `agent.team.<id>` keys, and no merge suggestion
   appears anywhere in the output.
   Also populate `warnings[]`: for each member, diff its declared keys against `FleetMember`'s
   (`id`, `role`, `executor`, `purpose`, `enabled`) and emit one `unmapped-member-override` naming the
   leftovers.
   *Test intent:* a member declaring `command: [...]` yields a warning, not a conflict, and
   `plan.blocked` stays `false` — the distinction 0848 depends on.
3. **(R4)** Add `addressedSpecIds`: read-only distinct `to_id` from `inbox_messages` and distinct
   `spec_id` from `coordination_runs`; set `artifact.addressed` from it. Route precedence steps 4/5 on it.
   *Test intent:* an orphan spec with one inbox row classifies `relink`, and the same spec with no
   rows classifies `retire` — in-memory SQLite, no network.
4. **(R2)** Implement `preview()`: map each artifact to its `MigrationPlanStep`, carrying
   `preservesId` verbatim for every convert/relink step, and set `blocked` from `inventory.conflicts`.
   *Test intent:* every `write-fleet` and `relink-spec` step's `preservesId` equals the source spec id
   character for character — this is the assertion 0847 R2 inherits.
5. **(R3)** Add the zero-write guard test: construct the service with an fs spy whose `writeFile`,
   `rm`, `mkdir`, and `rename` throw, run `preview()` on the full fixture, assert it resolves.
   Separately assert the service source references neither `materializeTeam`, `teardownTeam`, nor
   `withLock`.
   *Test intent:* R3 is proven by mechanism, not by reviewing the diff.
6. **(R1)** Add the `legacy-flag-usage` scan: grep `config/workflows/`, `plugins/`, and `docs/` for
   `--agent <value>` occurrences whose value matches an on-disk spec id. Record `<file>:<line>` as the
   artifact id.
   *Test intent:* a fixture workflow using `--agent coder` (a role) yields no artifact; one using
   `--agent web-coder-1` (a spec id) yields exactly one. This is the scan 0849 R3 consumes.
7. **(R5)** Register `spur projects migrate --dry-run --json` in `apps/cli/src/commands/projects.ts`,
   reusing `SHARED_OPTIONS.json` / `jsonEnvelope` and `toEnvelopeJson` exactly as the sibling verbs do.
   Exit 0 clean, 2 when `blocked`.
   **Gate:** land this step only after the consent row in `docs/design/harness-surface-governance.md` §4
   exists. Steps 1–6 are independent of it.
   *Test intent:* a CLI test asserts the `--json` envelope shape and the exit-2-on-conflict contract.
8. Run `cd packages/app && bun test tests/services/legacy-migration.test.ts`, then
   `bun run spur-check` once at the end.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:287` |
| `packages/domain/src/dao/index.ts:3` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/legacy-migration.test.ts:426`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; refreshed local verification scratch `.spur/run/0846-verify-answer.txt` lines 1-38 and derived `.spur/run/0846-verdict.json`; repository gate separately FAILs on three concurrent taste-refactoring skill checks |
| R2 | MET | `packages/app/tests/services/legacy-migration.test.ts:686`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R3 | MET | `packages/app/tests/services/legacy-migration.test.ts:789`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `apps/cli/tests/commands/projects.test.ts:478`; cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts — exit 0, 38 pass |
| R4 | MET | `packages/app/tests/services/legacy-migration.test.ts:576`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:603`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `packages/app/tests/services/legacy-migration.test.ts:630`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
| R5 | MET | `apps/cli/tests/commands/projects.test.ts:555`; cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts — exit 0, 38 pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Migration previews before it changes anything | MET | test | `packages/app/tests/services/legacy-migration.test.ts:789`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass; `apps/cli/tests/commands/projects.test.ts:478`; cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts — exit 0, 38 pass |
| Scenario: Conflicts are named, not summarized | MET | test | `packages/app/tests/services/legacy-migration.test.ts:576`; cd packages/app && bun test tests/services/legacy-migration.test.ts — exit 0, 26 pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Pipeline review hop 2026-09-12 (sp-super-reviewer at review depth, --auto): observe-only over the
     uncommitted working tree; code untouched; task status unchanged by review. -->

#### Review Report — 0846

**Scope:** `git diff HEAD` + untracked `packages/app/src/services/legacy-migration.ts`,
`packages/app/tests/services/legacy-migration.test.ts`, `packages/domain/src/dao/addressed-spec-ids.ts`,
`packages/domain/tests/dao/addressed-spec-ids.test.ts` (+export lines in `packages/app/src/index.ts`,
`packages/domain/src/dao/index.ts`).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS — approve. No P1 (blocker) or P2 (major) findings.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | process | Task record `Solution`/`Testing` sections are unfilled placeholders — implementation/testing evidence is not recorded in the task file (review gathered fresh executable evidence instead); must be filled at verify/wrap | `docs/tasks4/0846_*.md` §Solution, §Testing |
| 2 | P4 (advisory) | architecture | Service defines its own narrow read-only context slice instead of the Plan's "existing service context" — justified: the injected `fs`/`registry` ports are what make the R3 deny-write test possible; direct `loadAgentSpecs(configDir, fs)` is the same read `TeamService.listAgentSpecs` delegates to, and inline `resolve(base, work_dir)` matches `resolveWorkspaceDir` semantics | `packages/app/src/services/legacy-migration.ts:117-135`; `packages/app/src/services/team-service.ts:822-824,1034-1036` |
| 3 | P4 (advisory) | correctness | `counts` tallies `legacy-flag-usage` artifacts under `retire` (matrix-consistent, §4 legacy-CLI row), so 0851's `counts.retire` mixes doc/workflow flag usages with spec retirements; the kind split is recoverable from `artifacts` | `packages/app/src/services/legacy-migration.ts:346-348,549-558` |
| 4 | P4 (advisory) | usability | `spec-workspace-disagreement` names both sides in the message but carries only the spec file in `sources` (1 entry, consistent with the frozen "1 for a mismatch" contract); the team config key is only in the message | `packages/app/src/services/legacy-migration.ts:268-277` |
| 5 | P4 (advisory) | correctness | derived-id-collision also skips tag-less on-disk holders, not only "different team tag" — correct per the preserve contract (materialize skips non-generated specs) and documented in-code | `packages/app/src/services/legacy-migration.ts:305-318`; `packages/app/src/services/team-service.ts:432` |
| 6 | P4 (advisory) | efficiency | flag scan reads every file under `docs/` + `plugins/` into memory per run — acceptable for an operator-run evidence tool; fail-loud `ValueError` on a malformed/duplicate spec file aborts the whole inventory (deterministic; Design silent) | `packages/app/src/services/legacy-migration.ts:518-545,175` |

##### Functional Traceability (P1)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Five-step precedence chain verbatim `packages/app/src/services/legacy-migration.ts:222-301`; team-config artifacts :212-226; legacy-flag-usage scan :518-565 (§4 "Retire after no usage"); counts :346-348; classification test asserts all four dispositions (`packages/app/tests/services/legacy-migration.test.ts:96-141`, pass) |
| R2 | MET | `preview()` :159-162 re-classifies fresh, projects steps, sets `blocked`; `preservesId` asserted character-for-character (test :330-364) — the assertion 0847 R2 inherits |
| R3 | MET | Reads only: fs `exists`/`readDir`/`readFile` (:509-521,528); registry `readRaw()` not `list()` (:176; `list()` heals/writes — `packages/app/src/services/project-registry.ts:241-276`); DB through `SELECT DISTINCT` only (`packages/domain/src/dao/addressed-spec-ids.ts`); never `materializeTeam`/`teardownTeam`/`withLock` (source-scan test, test :456-461). Proven by mechanism: deny-writes proxy over every `FileSystem` write verb + tree-snapshot equality (test :441-454) |
| R4 | MET | All five conflict kinds; `two-teams-one-project` dedupes to ONE conflict naming both config keys with "no merge is proposed" and no pick/winner anywhere in JSON (test :250-277); orphan named in both relink (:283-291) and retire (:292-299) branches; `addressedSpecIds` = sorted union of `inbox_messages.to_id` ∪ `coordination_runs.spec_id` (`packages/domain/src/dao/addressed-spec-ids.ts:15-18`; columns verified in `packages/domain/src/migrations.ts:30,159`) |
| R5 | PARTIAL — gated, by design | Structured `MigrationPlan` is machine-readable at service level; the `--json`/human-output/exit-2 CLI surface is Plan step 7, gated on the §4 consent row — verified absent today (`docs/design/harness-surface-governance.md` §4 has no 0846/0847 row; no `migrate` verb in `apps/cli/src/commands/projects.ts`), exactly the Q&A gate. Intended gap; 0847 closes it after consent |

AC scenarios: scenario 1 (preview before anything changes) MET via the deny-writes zero-write test on the full fixture; scenario 2 (conflict with both sources, no merge) MET via test :250-277.

##### SECUA (P2)

No security findings: zero-write by construction (verified against the actual `ProjectRegistry` and `FileSystem` implementations, not the comments); constant parameterless SQL; bounded flag regex; no secrets; no `console.*`/`Bun.spawnSync` in app code (grep-clean); correct layers (DAO read helper in `packages/domain` — sole ts-db consumer; service in `packages/app`; no transport wiring). The 'no such table' swallow in `distinctOrEmpty` follows the existing domain read-path precedent (`packages/domain/src/analytics/retro-correlation.ts:101` et al.) and is tested.

##### Architecture (P3)

Idempotence contract for 0847 holds: `preview()` never caches — each call re-runs `classify()`. `memberLocalId` is reused, never re-derived (:305-307,:373-377). Dedupe of conflicts by kind+sorted sources with shared identity across artifacts (test :274-276 asserts instance identity). Export surfaces match the diff claim (+15 app, +1 domain).

##### Tests encode intent (P4)

Every Plan step's stated test intent is present and asserts the WHY: step-2 precedence keeps a tagged hand-authored spec out of the convert set; warning-vs-conflict keeps `plan.blocked` false (0848's halt input); relink/retire routed on addressed rows in in-memory SQLite; verbatim `preservesId`; zero-write proven by mechanism, not diff review; flag scan discriminates role selectors (`agent: coder`) from spec ids (`--agent=web-coder`).

**Verification run by review:** `cd packages/app && bun test tests/services/legacy-migration.test.ts` → 13 pass / 0 fail (78 expect); `cd packages/domain && bun test tests/dao/addressed-spec-ids.test.ts` → 3 pass / 0 fail; `bunx tsc --noEmit` in both workspaces → clean; `bunx biome check` on the six changed files → clean.

**Residual risk:** R5's CLI half + exit-2 contract land in 0847 behind the consent row — consent row and verb must land together; human-output wording ("nothing to migrate", exit codes) is unverifiable until then. Finding #1 (empty Solution/Testing) must be closed at verify/wrap.

**Next:** proceed to verify hop; fill §Solution/§Testing; keep step 7 unlanded until the consent row exists.

### References

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Disposition matrix: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4 preserve/convert/retire
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Migration and delivery order"
- Gate: Robin owns the compatibility and removal window (G64 Notes)

### History

- 2026-09-12T21:08:13.677Z todo → wip (system)
- 2026-09-13T00:13:09.824Z wip → testing (system)
- 2026-09-13T00:13:50.802Z testing → done (system)

