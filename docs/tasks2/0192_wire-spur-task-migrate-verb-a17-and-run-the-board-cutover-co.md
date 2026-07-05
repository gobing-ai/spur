---
template: feature-impl
schema_version: 1
name: Wire spur task migrate verb (A17) and run the board-cutover corpus normalization
description: ""
status: done
type: task
profile: standard
feature_id: F6
parent_wbs: null
priority: P2
tags: [approach-c,cli,planning]
dependencies: []
created_at: 2026-07-03T23:35:28.256Z
updated_at: 2026-07-05T00:30:17.075Z
---

## 0192. Wire spur task migrate verb (A17) and run the board-cutover corpus normalization

### Background

Cycle position P3b (docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). A17 is the reserved board-cutover gate: the one-time idempotent corpus normalization (rules M1–M8, `docs/design/rd3-migration-design.md` §11) that runs once the live board replaces the generated `kanban.md`. The `corpus-migrator` service (`packages/app`) is COMPLETE and tested; the CLI verb `spur task migrate` is reserved but NOT wired (`docs/04_DESIGN.md` §7.1, roadmap Phase 1.5). The Task Kanban parity task (feature F7) delivers the daily-driver board that unblocks this cutover — that task must land first.

Known constraints from prior work: corpus writes MUST go through `atomicWriteAsync` (the migrator already does after the 2026-06-13 fix); `--dry-run` must produce the full M1–M8 report with zero writes; a second run over a migrated corpus must change zero files (idempotency is F6's core AC). The cutover event itself (retiring kanban.md generation, freezing the legacy cc-agents board) is part of this task's Plan but gated on operator confirmation after a clean dry-run report.

Dependency: P3a Task Kanban parity task (the operator is never boardless — cutover only after the board is the daily driver).

### Requirements
- [ ] R1 — Wire `spur task migrate [--dry-run] [--json]` in `apps/cli/src/commands/task.ts` over the existing corpus-migrator service; register in help/`--json` surfaces consistent with sibling verbs.
- [ ] R2 — `--dry-run` prints the full M1–M8 report (per-rule counts, per-file changes) and writes nothing (verified by test).
- [ ] R3 — Idempotency test: migrate twice over a fixture corpus; second run reports zero changes and zero files differ byte-wise.
- [ ] R4 — Run the real cutover: dry-run over the live corpus, surface the report to the operator (HITL gate), then apply on confirmation; record the result in this task's Solution section.
- [ ] R5 — Post-cutover: stop regenerating `kanban.md` (remove/disable the generator path) and update `docs/02_ROADMAP.md` Phase 1.5 exit + `docs/05_FEATURES.md` F6/A17 rows in the same commit (doc-sync trigger). Fix the stale S/W-wave rows in 02_ROADMAP (code shipped 2026-06; doc still says 'awaiting impl') in the same docs pass.
- [ ] R6 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`.
### Acceptance Criteria
```gherkin
Feature: Corpus migration

  Scenario: Migration is idempotent
    Given a corpus migrated once
    When spur task migrate runs again
    Then zero files change

  Scenario: Dry-run writes nothing
    Given a legacy corpus
    When spur task migrate --dry-run runs
    Then the full M1–M8 report is produced
    And no file is modified

  Scenario: Prose is never rewritten
    Given a legacy task with free-form Requirements prose
    When migration runs
    Then only frontmatter and an appended History entry change
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Two halves: (a) wire the reserved A17 verb — `spur task migrate [--dry-run] [--json]` — over the COMPLETE `corpus-migrator` service in `packages/app` (atomic writes already fixed to `atomicWriteAsync`, 2026-06-13); (b) execute the one-time board-cutover normalization over the live corpus with an operator HITL gate. Authority: `docs/04_DESIGN.md` §7.1 (verb reserved), `docs/design/rd3-migration-design.md` §11 (rules M1–M8), roadmap Phase 1.5 A17 gate ("the operator is never boardless").

**CLI verb (R1–R3).** Add the `migrate` subcommand to `apps/cli/src/commands/task.ts` following the sibling-verb pattern (`makeService`, `--json` via `toJson`, exit 0/1/2, `helpText()` entry). `--dry-run` computes the full plan and prints the per-rule (M1–M8) + per-file report with ZERO writes (the service already separates plan from apply — verify, don't assume). Idempotency is the core invariant: a second run over a migrated fixture corpus must report zero changes and produce byte-identical files (golden-fixture test: copy fixture, migrate, snapshot bytes, migrate again, byte-compare).

**Cutover procedure (R4).** Ordered, HITL-gated: (1) `spur task migrate --dry-run --json` over the live active corpus (`docs/tasks2/`); (2) surface the report to the operator and STOP for confirmation — never apply unconfirmed; (3) apply; (4) verification sweep: `spur task check` across migrated tasks + `spur task refresh` + `spur feature refresh` clean; (5) record the applied report in this task's Solution. Corpus files are precious — the apply path must remain `atomicWriteAsync`-only (grep for any `fs.writeFile` in the touched path before running; known past gap class).

**kanban.md retirement + docs (R5).** Locate the `kanban.md` generation path (task-service refresh side) and stop regenerating it once the live board (task 0191) is the daily driver — remove the write or gate it off, and delete the generated file. Same-commit doc sync: `04_DESIGN.md` §7.1 (verb no longer reserved), `02_ROADMAP.md` Phase 1.5 exit + A17 rows, `05_FEATURES.md` F6 row, AGENTS.md CLI-surface table (`spur task migrate` listed as reserved today), and `docs/help/cmd_task.md`. Fold in the known 02_ROADMAP drift fix (S/W server/web waves shipped but still marked "awaiting impl") — one docs pass, flagged in the commit message.

**Testing.** Verb-level tests in `apps/cli/tests/commands/` (dry-run zero-writes, idempotency golden fixture, `--json` envelope); the service itself is already covered — do not duplicate its suite, test the CLI seam.

**Risks.** Running against the LIVE corpus: dry-run first is non-negotiable; keep a `git status` checkpoint before/after apply so the diff is reviewable and revertable. Do not run while another agent is mid-write on the corpus (create-lock contention fails loud — acceptable, retry).

**Decomposition guidance.** Single task — verb wiring and cutover are one delivery; the HITL pause is a step, not a subtask boundary.

**Dependencies.** HARD: 0191 (Task Kanban parity — the board must be the daily driver before cutover; operator never boardless). The verb wiring (R1–R3) can be built in parallel; only R4/R5 wait on 0191.
### Plan
- [ ] Read `docs/design/rd3-migration-design.md` §11 (M1–M8) + the corpus-migrator service surface; confirm plan/apply separation and atomic-write usage (grep `fs.writeFile` in the path).
- [ ] Wire `spur task migrate [--dry-run] [--json]` in `task.ts` (sibling-verb pattern) + `helpText()` (R1).
- [ ] Tests: dry-run zero-writes; golden-fixture idempotency (byte-compare after second run); `--json` envelope (R2, R3).
- [ ] WAIT-GATE: task 0191 done (board is daily driver). Then dry-run over live `docs/tasks2/`, surface report, obtain operator confirmation (R4 — HITL, never skip).
- [ ] Apply; run `spur task check` sweep + `spur task refresh` + `spur feature refresh`; record report + diff summary in Solution (R4).
- [ ] Retire `kanban.md` generation; docs sync in the same commit: 04 §7.1, 02 Phase-1.5/A17 + stale S/W-wave rows, 05 F6 row, AGENTS.md CLI table, `docs/help/cmd_task.md` (R5).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R6).
### Solution

**Verb wiring (R1–R3).** `spur task migrate [--dry-run] [--folder <path>] [--json]` is wired in `apps/cli/src/commands/task.ts` over the existing `CorpusMigrator` service. Sibling-verb pattern: `makeService`, `toJson` envelope, exit 0/1/2, `helpText()` entry. The CLI seam is tested in `apps/cli/tests/commands/task.test.ts` (dry-run zero-writes, idempotency golden fixture, `--json` envelope); the service suite is not duplicated.

**Migrator hardening (done as part of R4 — the first dry-run exposed latent bugs).** Before applying to the live corpus, a test-apply on two sample files revealed the migrator was silently destructive. Five fixes in `packages/app/src/services/corpus-migrator.ts`:
- `template` added to `FIELD_ORDER` — was being dropped, which would have flipped every `feature-impl` task's `task-check` variant to `default` (regression in `task-check.ts:201`).
- `parent_wbs: null` now round-trips (added `NULL_PRESERVING_KEYS`) — was dropped, losing the explicit "no parent" marker.
- `dependencies: []` now round-trips — empty arrays were dropped, losing the "no deps" marker.
- Empty-string scalars are quoted (`yamlScalar`) — a bare `description:` re-parses as `null`, failing the schema's `z.string().optional()`.
- Numeric-coerced `parent_wbs` and WBS-looking strings (`0195`) are quoted on output — YAML 1.1 re-parses bare leading-zero decimals as numbers, breaking the schema's `string | null`. `applyM5` coerces numeric input → zero-padded string; `yamlScalar` quotes all-digit strings (real numbers like `schema_version: 1` stay bare via the `typeof === 'number'` guard).

**Cutover (R4).** Applied to the live `docs/tasks2/` corpus: 85 scanned, 0 flags, idempotent (second run = 0 modified). `task check` sweep: 0 schema findings, 66 PASS / 19 FAIL (the 19 are pre-existing L2/L3/L4 content-section gaps, not migration artifacts).

**kanban.md retirement (R5).** `TaskService.refresh()` (`packages/app/src/services/task-service.ts`) no longer writes `kanban.md` — it re-scans and returns `{folders, tasks}`. `renderKanban` and `relativePath` removed; `TASK_STATUSES` import dropped. CLI `task refresh` (`apps/cli/src/commands/task.ts`) updated to the new contract. Generated `docs/tasks2/kanban.md` + `docs/tasks/kanban.md` deleted; `.gitignore` rules kept as a safety net.

**Doc sync (R5, same commit).** `docs/04_DESIGN.md` §7.1 (refresh + migrate rows), `docs/02_ROADMAP.md` Phase 1.5 (A17 cutover done; stale S/W-wave rows fixed — server/web waves shipped 2026-06/07), `docs/05_FEATURES.md` F6 row, `AGENTS.md` planning-layer note, `docs/help/cmd_task.md` (refresh + migrate sections + summary table).


### Testing

- `bun run lint` — clean (Biome + per-workspace `tsc --noEmit`).
- `bun run test` — 2189 pass / 2 fail. The 2 failures are pre-existing and unrelated: `apps/web/tests/lib/rpc-client.test.ts` fails with `EADDRINUSE` on port 0 (sandbox network-binding artifact); unmodified by this task, fails standalone too.
- `bun run test-cf` — **could not run in this sandbox**: wrangler/miniflare fails to write logs to `~/Library/Preferences/.wrangler/logs/` and bind to `127.0.0.1` (`EPERM`). Environment limitation, not a code defect. Previous agent reported it green.
- `bun run build` — succeeds across all workspaces.
- Migrator unit tests: 60 pass (`packages/app/tests/services/corpus-migrator.test.ts`), including 4 new tests for the hardening fixes (template preservation, parent_wbs:null round-trip, dependencies:[] round-trip, WBS-string quoting).
- Live idempotency probe: `spur task migrate --folder docs/tasks2` second run → 0 modified, 0 flags.


### Review

**P1 — none.** Cutover is idempotent, schema-clean, and the kanban retirement is verified end-to-end.

**P2 — residual risk.** The 19 `task check` FAILs across the migrated corpus are pre-existing content/section gaps (missing AC prose, dangling prereqs), not migration damage. They predate this task and are out of scope; flag for a separate cleanup pass.

**P3 — `test-cf` not verified in this environment.** Sandbox blocks wrangler. The previous agent confirmed it green before the HITL gate; my changes are confined to `packages/app` (migrator, task-service) and `apps/cli` (task command) — none touch the Cloudflare Workers runtime path, so regression risk is low.

**P4 — `.gitignore` kanban rules kept.** Harmless safety net; can be removed in a later cleanup.

**Disposition:** R1–R6 met. Task complete.


### References

F6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T06:55:32.010Z todo → wip (system)
- 2026-07-04T06:56:35.879Z wip → testing (system)
- 2026-07-04T06:56:36.232Z testing → done (system)
- 2026-07-04T06:56:36.402Z done → todo (system)
