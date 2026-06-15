---
schema_version: 1
name: rd3 migration 0054-0070 review — remediate 8 post-implementation findings
description: rd3 migration 0054-0070 review — remediate 8 post-implementation findings
status: wip
created_at: 2026-06-15T05:30:27.556Z
updated_at: 2026-06-15T05:30:27.556Z
folder: docs/tasks
type: task
feature-id: H3
priority: P1
tags: ["rd3-migration","review-followup","remediation"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0071. rd3 migration 0054-0070 review — remediate 8 post-implementation findings

### Background

A comprehensive independent code review of the rd3-migration implementation (tasks **0054–0070**,
covering Waves W1/W2/W3) was performed on 2026-06-14. The core implementation is **genuinely
complete and functional**: all four verification gates pass (`bun run lint`, per-workspace
`tsc --noEmit`, `bun run test` = 1266 pass / 0 fail / 0 skip, `bun run build`), and the CLI works
end-to-end at runtime (`init` → `feature create` → `task create` → `task update <wbs> <status>`
lifecycle transition → `task check` → `task resolve` → `workflow continue`).

However, the review surfaced **8 residual findings** — all *around* the code rather than *in* it:
documentation drift, one incomplete sub-requirement, CI-coverage holes, and stale build config.
None block the working CLI; several block a clean "done means done" per
`docs/99_PROJECT_CONSTITUTION.md` (same-commit doc-sync rules) and `AGENTS.md`.

**Why a dedicated remediation task:** several tasks (0055 lifecycle adapter, 0062 pipeline) were
originally shipped by the `/rd3:dev-run` loop as **pure stubs that "delivered nothing functional"**,
caught only by a later `dev-verify` pass. The residual findings here are exactly the class of gap a
self-certifying loop misses (doc sync, cross-task integration, CI wiring). Capturing them explicitly
prevents them being forgotten.

**Source documents (authority for the original scope):**
- `docs/plans/rd3-migration-delivery.md` — the delivery surface catalog (names + purpose per item).
- `docs/plans/2026-06-10-rd3-migration-feature-list.md` — disposition record (item IDs A01…, etc.).
- `docs/design/rd3-migration-design.md` — Stage-D design (DD-01…DD-14, §3–§12).
- `docs/04_DESIGN.md §7` — the reserved planning-layer landing zone (X05 sync target).
- `docs/05_FEATURES.md §9` / `docs/02_ROADMAP.md` Phase 1.5 — status-tracking docs.

**Verification baseline at review time (2026-06-14):** lint clean (273 files, 7 workspaces
typecheck OK); `bun run test` 1266 pass / 0 fail / 0 skip across 109 files; build green across all
workspaces; runtime smoke test of every hot path passed.


### Requirements

Each requirement maps to exactly one review finding. Severity/effort carried from the review.
**Done = the gate passes AND the specific verification step under each item below is met.**

**R1 (Finding #1 — High / M): Write `task_run_links` rows of `kind=pipeline`.**
The `task-pipeline.yaml` run must record a `task_run_links` row (`kind='pipeline'`, `wbs`, `run_id`)
at run start, so execution results trace back to the pipeline run. Today only `kind='lifecycle'`
rows exist (from the 0055 `LifecycleAdapter`); no code path writes a `pipeline` row. R4 of task 0062
is therefore unmet.

**R2 (Finding #2 — High / S): Fill `04_DESIGN.md §7.4` (matrix + §10.1 event catalog) and fix §7.3.**
The shipped `PlanningEventMap` (6 events) + `planning_events` table are fully in code but undocumented
in the design surface doc. Add §7.4 documenting the Section-Status-Matrix landing + the X04 event
catalog (the 6 planning events + 3 engine-seam events). Add the missing `### 7.3` parent header
(doc currently jumps 7.2 → 7.3.1). Per delivery §11 (X05) this was a same-commit obligation.

**R3 (Finding #3 — High / S): Re-sync `05_FEATURES.md §9` and `02_ROADMAP.md` Phase 1.5 status.**
Flip every shipped planning row from `⏳` to the correct marker (`✅` done / `🔶` partial). Update
stale names (`task-standard workflow` → `task-pipeline`; legacy phrasing). Check the corresponding
ROADMAP Phase-1.5 stage boxes (`Stage D`, `Wave 0/1/2/3`) and update the phase status line.

**R4 (Finding #4 — Medium / M): Document + track the pipeline-pause integration gap.**
`task-pipeline.yaml`'s `approve` state uses interactive `hitl.confirm`, not `pause: true`, so
`spur workflow continue` (0063, fully working) can never resume the default pipeline. This is a
*deliberate* deferral (global `@gobing-ai/spur` schema is a stale 0.2.5 lacking `pause`). The gap is
currently only a YAML inline comment. Make it a tracked, dated decision and add the `pause: true`
flip as a guarded follow-up that lands when the global schema refreshes.

**R5 (Finding #5 — Medium / S): Bring `plugins/sp` tests into the CI gate.**
`bun run test` (1266) excludes all 158 `plugins/sp` tests — including the security-relevant
`task-write-guard.test.ts` (7) and 151 skill-script tests — because the workspace globs are
`apps/*` + `packages/*` only. They pass when run directly but won't catch regressions in the gate.

**R6 (Finding #6 — Medium / S): Remove stale `bun link` from the catalog.**
`@gobing-ai/ts-infra` and `@gobing-ai/ts-rule-engine` are `link:` in the root catalog (actively
symlinked to the global bun store) while every other ts-lib uses `^0.3.17` semver. `AGENTS.md`
mandates returning to semver once released. The links break clean-room / CI installs.

**R7 (Finding #7 — Low / S): Reconcile the `spur task migrate` surface reference.**
`corpus-migrator.ts` (M1–M7, task 0047) is complete + exported but has no `spur task migrate`
subcommand. This is *consistent by design* (`04_DESIGN.md:449` marks it "Reserved"; cutover waits
for the board per delivery §6), but delivery §1.1 lists it as a batch verb, reading as shipped.
Either wire the verb or annotate the surface docs so the reserved status is unambiguous. **Default:
annotate (do not wire)** — the board-cutover constraint still holds.

**R8 (Finding #8 — Low / S): Scrub the stale `rd3` path in the moved skill.**
`plugins/sp/skills/anti-hallucination/references/tool-usage-guide.md:89` has a hardcoded
`rg -n "useDeferredValue" plugins/rd3` example — a stale path 0069 should have scrubbed. Fix to a
generic / `plugins/sp` path. (The other ~10 `rd3` mentions in plugins/sp are legitimate provenance
comments — leave them.)


### Q&A



### Design

Authority per finding. **Lower-numbered doc wins on conflict** (constitution rule); fix the
authoritative doc and flag drift, never patch a derived symptom.

### R1 — `task_run_links` kind=pipeline (delivery §4, §1.4 D06; design §6)
- **Table shape** (already shipped): `packages/domain/src/schema/planning.ts` →
  `task_run_links(id, wbs, run_id, kind, created_at)`. DAO: `packages/domain/src/dao/task-run-link-dao.ts`
  (`TaskRunLinkDao.insert`). Migration: `drizzle/0003_spur_cli_planning.sql`. **No schema change needed.**
- **Precedent**: `packages/app/src/workflow/lifecycle-adapter.ts:87-95` already writes a `kind='lifecycle'`
  row via `TaskRunLinkDao.insert({ id: createId('trl'), wbs, run_id, kind, created_at })`.
- **Mechanism (the missing piece)**: the pipeline run (`spur workflow run config/workflows/task-pipeline.yaml
  --vars '{"wbs":"NNNN"}'`) starts a workflow run with a `run_id` but never links it to the task. The
  delivery doc (§4 row, 0062 Finding #3) prescribes a **`WorkflowService` run-start hook**: when a run
  starts for the `task-pipeline` workflow AND `vars.wbs` is present, insert a `kind='pipeline'` link.
- **Home**: `packages/app/src/services/workflow-service.ts` (the Spur-side `WorkflowService` wrapper, NOT
  the engine's). Add an optional `onRunStart` linkage in the `run`/`runFromFile` path, keyed off the
  workflow name (`task-pipeline`) + `vars.wbs`. This stays "orchestration is configuration" compliant
  because the *YAML* gains nothing — the link is a transport-side concern in `packages/app`.
- **Idempotency**: a re-run with the same `run_id` must not duplicate the link. Either upsert on
  `(wbs, run_id, kind)` or check-before-insert (mirror the lifecycle adapter's `existing === undefined`
  guard). Confirm `TaskRunLinkDao` supports the lookup; if not, add a `findByRunId`/`findByWbsKind` query
  (DAO change is in-scope, schema is not).
- **Invariant**: the lifecycle status-verb steps inside the pipeline already write `kind='lifecycle'`
  rows — do NOT remove those; the `pipeline` row is **additive** (one per pipeline run).

### R2 — `04_DESIGN.md §7.4` + §7.3 (delivery §11 X05; design §7, §10.1)
- **§7.3 header**: insert a `### 7.3 Frontmatter schemas` parent above the existing `### 7.3.1`/`7.3.2`/
  `7.3.3` so the numbering is well-formed.
- **§7.4 content** = two parts:
  1. **Section-Status-Matrix landing** — point at `config/tasks/section-matrix.yaml` +
     `apps/cli/schemas/section-matrix.schema.json`; summarize which sections each status requires
     (warning-first; small hard-gate core). Authority for the matrix semantics: design §3 (the L2 layer)
     and delivery §3.2.
  2. **X04 event catalog** — the 6 planning events on `PlanningEventMap`, copied from delivery §10.1:
     `task.created`, `task.updated`, `task.transitioned`, `feature.created`, `feature.updated`,
     `feature.transitioned` (each with "fired when"). Plus the 3 engine-seam events: `on_transition`,
     `on_guard_fail`, `on_complete`. State that all planning events are emitted by `PlanningWriteService`
     and persisted to `planning_events`. **SSOT for the names is the code**:
     `packages/app/src/services/planning-write-service.ts` (`PlanningEventName` union, line ~80) and
     `packages/app/src/services/planning-events.ts` (`PlanningEventMap`). Document, never invent.
- **§7.6 (DTOs)**: leave reserved/absent — DTOs are postponed with the server/web design task
  (delivery §5.3). A one-line "reserved" note is acceptable; do not author shapes.

### R3 — `05_FEATURES.md §9` + `02_ROADMAP.md` (delivery §11; constitution §5 triggers)
- **05_FEATURES §9 status flips** (verified shipped, mark `✅` unless noted):
  - Task management (`spur task` CRUD/WBS/sections/check) → ✅ (note: `migrate` verb reserved, see R7).
  - Variant templates + Section-Status-Matrix + format rules → ✅.
  - Shared BDD validator (Gherkin subset + checklist + coverage) → ✅.
  - Feature management (`spur feature`) → ✅.
  - Lifecycle on `spur workflow` + write service → ✅.
  - Spec-driven pipeline (sp planning fat skill / `sp:spur-dev`) → ✅.
  - Task-pipeline workflow + HITL continue + result writer → **🔶 partial** (pipeline + `continue`
    shipped; pipeline-pause integration deferred R4; `kind=pipeline` link pending R1). Rename
    "Task-standard workflow" → "task-pipeline workflow" (delivery §13).
  - `plugins/sp` Fat Skills + thin wrappers → ✅.
  - "Collective design stage" row → ✅ (Stage D is done; the waves implemented).
  - Local board + launcher → keep `💤` (postponed, delivery §6) — do NOT flip.
  - rd3-migration deferred set → keep `💤`.
- **02_ROADMAP Phase 1.5**: check the stage boxes for Stage D + Wave 0/1/2/3; update the phase status
  line from `_(next)_` to the accurate state (waves implemented; board cutover pending per delivery §6).
  Do NOT mark the whole phase complete if the board slice is still postponed — describe precisely.

### R4 — pipeline pause (delivery §1.4 D04; design §6; ADR-022)
- The workspace schema (`apps/cli/schemas/state-machine-workflow.schema.json:38`) **already supports**
  `pause: true`. `spur workflow continue` + `WorkflowService.continuePaused`/`latestPausedRun` are
  shipped and tested (0063). The only blocker is that a user's *globally installed* `@gobing-ai/spur`
  may be a stale 0.2.5 whose bundled schema lacks `pause`, so adding `pause: true` to the shipped
  `task-pipeline.yaml` would make `spur workflow validate` fail for those users.
- **Decision to record** (add a dated ADR note or a delivery-doc/design note, not just a YAML comment):
  keep `hitl.confirm` until the global `@gobing-ai/spur` package is refreshed to ship the `pause`-aware
  schema; then flip `approve` to `pause: true` and re-point the pipeline's HITL gate at
  `spur workflow continue`. Capture the trigger ("global spur ≥ X.Y.Z published") so it isn't forgotten.
- This requirement is **documentation + tracking only** — do not flip `pause: true` now (it would
  regress validation for stale-global users). Leave the working `hitl.confirm` gate in place.

### R5 — CI test coverage (constitution verification gate; AGENTS.md gate)
- Root `package.json` `workspaces.packages = ["apps/*","packages/*"]`; `plugins/*` is excluded, and Bun's
  test runner from root only scans workspace members → 158 plugin tests skipped by `bun run test`.
- **Options (pick one, recommend A):**
  - **A — extend the root `test` script** to also run the plugin tests without making `plugins/*` a
    published workspace: e.g. `bun test … && bun test plugins/sp` (or a single invocation with an
    explicit roots list). Keeps plugins out of the workspace graph (they are not published packages)
    while folding their tests into the gate. Verify coverage thresholds still hold.
  - **B — add `plugins/*` to `workspaces.packages`.** Heavier: pulls plugins into the dependency graph,
    `bun install` linking, and catalog resolution — likely overkill since skills are not packages.
- Whichever option: update `AGENTS.md` "Verification gate" + "Testing" sections to state plugin tests
  are in the gate. Confirm `bun run test` count rises by 158 (1266 → 1424) with 0 fail.

### R6 — stale `bun link` (AGENTS.md "Dependency source" + "Version SSOT — Bun Catalog")
- `package.json` lines 35, 37: `"@gobing-ai/ts-infra": "link:@gobing-ai/ts-infra"` and
  `"@gobing-ai/ts-rule-engine": "link:@gobing-ai/ts-rule-engine"`. Both global symlinks currently
  resolve to version `0.3.17` (same as the semver siblings).
- **Action**: confirm the upstream `ts-libs` packages are published at the needed version (≥0.3.17);
  if so, change both catalog entries to `"^0.3.17"` (match the siblings), run `bun install`, verify the
  lockfile updates and `node_modules/@gobing-ai/{ts-infra,ts-rule-engine}` are no longer symlinks to the
  global store. **Pre-req check**: if the unreleased fix these links were validating is NOT yet
  published, this finding is blocked — record the blocking version and keep the link, but add a tracked
  note so it isn't forgotten (do not silently leave it). Re-run the full gate after `bun install`.

### R7 — `spur task migrate` surface (delivery §1.1, §6, §13; design `04_DESIGN.md:449`)
- The service is complete; the CLI verb is intentionally reserved (board-cutover constraint, delivery
  §6). **Default action: annotate, do not wire.** Add a one-line clarification wherever the surface reads
  as shipped:
  - `docs/04_DESIGN.md` already says "Reserved (A17)" — verify it is unambiguous.
  - `CLAUDE.md`/`AGENTS.md` "Planned expansion (ADR-020–023)" note already flags `spur task`/`spur feature`
    as accepted-not-built; confirm `task migrate` is covered there.
  - Optionally annotate `corpus-migrator.ts`'s export with a comment that the CLI verb is reserved.
- Do NOT build the `spur task migrate` subcommand in this task unless the operator explicitly lifts the
  board-cutover constraint (it touches the legacy corpus and is gated on the new board per delivery §6).

### R8 — stale rd3 path (delivery §7.2 0069 disposition)
- `plugins/sp/skills/anti-hallucination/references/tool-usage-guide.md:89`: change
  `rg -n "useDeferredValue" plugins/rd3` → a generic example or `plugins/sp` path. Leave the legitimate
  provenance mentions (e.g. "moved verbatim from rd3", "Not a port of rd3:code-docs") untouched. Re-grep
  `plugins/sp` for any other hardcoded `plugins/rd3` *paths* (vs. prose) and fix those too.


### Solution

Sequence by leverage: doc-sync + config hygiene first (low-risk, mechanical, unblock "clean done"),
then the one functional gap (R1, hook home: `packages/app/src/services/workflow-service.ts:1`),
with the tracked-deferrals (R4, R7) documented throughout.
**Suggested batching (each batch = one atomic conventional commit):**

1. **Docs batch (R2 + R3 + R7 + R4-doc):** `04_DESIGN.md §7.3/§7.4`, `05_FEATURES.md §9`,
   `02_ROADMAP.md` Phase 1.5, plus the `spur task migrate` surface annotation and the pipeline-pause
   deferral note. Commit `docs(planning): sync 04/05/02 with shipped rd3-migration surface`.
   The `sp:doc-evolve` skill (drift-audit → §7, sync-check → §5) can drive and verify this batch;
   its first drift-audit run already *detected* this exact T3 drift.
2. **Config-hygiene batch (R6 + R8):** catalog de-link + stale-path scrub.
   Commit `chore(deps): return ts-infra/ts-rule-engine to semver; scrub stale rd3 path`.
3. **CI-gate batch (R5):** fold plugin tests into `bun run test`; update `AGENTS.md`.
   Commit `test(ci): include plugins/sp tests in the verification gate`.
4. **Functional batch (R1):** `WorkflowService` run-start hook writing the `kind=pipeline` link +
   tests. Commit `feat(workflow): record task_run_links kind=pipeline at run start (0062 R4)`.
   Also flip `05_FEATURES §9` task-pipeline row 🔶→✅ once R1 + (eventually) R4 land.

**Guardrails:**
- Constitution `docs/99_PROJECT_CONSTITUTION.md`: edit the **authoritative** doc for each fact; the
  event-name SSOT is code, not the doc — document, never invent.
- Surgical changes only (R3 global rule): no drive-by refactors in touched files.
- After every batch, run the full gate (`bun run lint && bun run test && bun run build`) and
  `git status -s` (only intentional changes).
- R4 and R7 are **tracked deferrals**, not implementations — do not flip `pause: true` or wire
  `spur task migrate` in this task (both are gated on external events: global schema refresh / board
  cutover). Record the trigger for each so the next session resumes cleanly.


### Plan

Per-finding checklist with file paths + the exact verification step. `[ ]` = not started.

**R1 — task_run_links kind=pipeline (High / M)**
- [x] Confirm `TaskRunLinkDao` has (or add) a lookup to dedupe by `run_id` — `packages/domain/src/dao/task-run-link-dao.ts`
- [x] Add a run-start linkage in `packages/app/src/services/workflow-service.ts`: when workflow name == `task-pipeline` and `vars.wbs` present → insert `{ id: createId('trl'), wbs, run_id, kind: 'pipeline', created_at }` (mirror `lifecycle-adapter.ts:87-95`); idempotent on re-run
- [x] Keep the existing `kind=lifecycle` rows additive (do not remove)
- [x] Tests (`packages/app/tests/services/workflow-service.test.ts` or new): a `task-pipeline` run writes exactly one `kind=pipeline` row; a re-run with same run_id does not duplicate; a non-pipeline workflow writes none
- [x] Verify E2E: `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"NNNN","profile":"auto"}'` then assert the `pipeline` row exists
- [x] Flip `05_FEATURES §9` task-pipeline row toward ✅ for the linkage portion

**R2 — 04_DESIGN §7.3/§7.4 (High / S)**
- [x] Insert `### 7.3 Frontmatter schemas` parent header above 7.3.1
- [x] Add `### 7.4` — Section-Status-Matrix landing (point at `config/tasks/section-matrix.yaml` + `apps/cli/schemas/section-matrix.schema.json`; warning-first + hard-core summary)
- [x] Add the X04 event catalog to §7.4: 6 planning events (copy "fired when" from delivery §10.1) + 3 engine-seam events; note all emitted by `PlanningWriteService` → persisted to `planning_events`. Cross-check names against `planning-write-service.ts` `PlanningEventName` (SSOT)
- [x] §7.6 DTOs: leave a one-line "reserved (server/web design task)" note; author no shapes
- [x] Verify: `rg "task.created|feature.transitioned" docs/04_DESIGN.md` hits; §7 headers are well-formed (7.1→7.2→7.3→7.3.x→7.4→7.5)

**R3 — 05_FEATURES §9 + 02_ROADMAP Phase 1.5 (High / S)**
- [x] Flip §9 shipped rows ⏳→✅ (task mgmt, templates+matrix, BDD validator, feature mgmt, lifecycle+write-service, spec pipeline, plugins/sp, collective-design) per Design R3 list
- [x] Mark task-pipeline row 🔶 (pause + kind=pipeline pending) and rename "task-standard" → "task-pipeline"
- [x] Keep board/launcher + deferred-set rows 💤 (do NOT flip)
- [x] 02_ROADMAP: check Stage D + Wave 0/1/2/3 boxes; update phase status line precisely (waves done, board cutover pending — not "phase complete")
- [x] Verify: no shipped feature still reads ⏳; names match delivery §13

**R4 — pipeline-pause deferral, documented (Medium / M, doc-only)**
- [x] Record the deferral as a dated decision (ADR note in `docs/00_ADR.md` under ADR-022, or a delivery-doc/design note) with the trigger: "flip `approve` → `pause: true` + re-point HITL gate at `spur workflow continue` when global `@gobing-ai/spur` ships the `pause`-aware schema"
- [x] Keep the working `hitl.confirm` gate in `task-pipeline.yaml`; do NOT add `pause: true` now
- [x] Verify: `spur workflow validate config/workflows/task-pipeline.yaml` still clean

**R5 — plugin tests in the gate (Medium / S)**
- [x] Extend root `package.json` `test` script to also run `plugins/sp` tests (recommend: append `bun test plugins/sp` or an explicit roots list — keep plugins OUT of `workspaces.packages`)
- [x] Update `AGENTS.md` Verification-gate + Testing sections to state plugin tests are in the gate
- [x] Verify: `bun run test` count rises ~1266 → ~1424, 0 fail; `task-write-guard.test.ts` (7) + skill tests (151) included; coverage thresholds hold

**R6 — de-link catalog (Medium / S) — BLOCKED: unreleased `details` field on `rule.eval.done`**
- [x] Confirm upstream `ts-libs` `ts-infra` + `ts-rule-engine` published ≥0.3.17 → **YES, both at 0.3.17**
- [~] De-link → **REVERTED**. Published `0.3.17` lacks `details: ConstraintFinding[]` on the
  `rule.eval.done` event type (`packages/app/src/services/rule-service.ts:490` destructures it).
  The local `~/xprojects/ts-libs/packages/rule-engine/src/events.ts` has the field (added after
  the 0.3.17 publish); the published tarball does not. De-linking regresses `tsc --noEmit`:
  `error TS2339: Property 'details' does not exist`. Links restored; lint green again.
- [ ] **Trigger to de-link:** publish `@gobing-ai/ts-rule-engine` ≥ next version with the `details`
  field on `rule.eval.done`, then flip `package.json:35,37` `link:` → `"^0.3.17"` and run the full gate.

**R7 — spur task migrate surface annotation (Low / S, doc-only)**
- [x] Confirm `docs/04_DESIGN.md:449` "Reserved (A17)" is unambiguous; confirm `CLAUDE.md`/`AGENTS.md` "Planned expansion" note covers `task migrate`
- [x] Optionally annotate `corpus-migrator.ts` export with "CLI verb reserved — board cutover gate (delivery §6)"
- [x] Do NOT wire the subcommand (board-cutover constraint holds unless operator lifts it)

**R8 — scrub stale rd3 path (Low / S)**
- [x] Fix `plugins/sp/skills/anti-hallucination/references/tool-usage-guide.md:89`: `plugins/rd3` → generic/`plugins/sp`
- [x] `rg -n "plugins/rd3" plugins/sp` → fix any other hardcoded paths (leave prose provenance)
- [x] Verify: no hardcoded `plugins/rd3` *paths* remain in plugins/sp

**Final gate (all batches):**
- [x] `bun run lint` clean · `bun run test` 0 fail (count includes plugin tests) · `bun run build` green
- [x] `git status -s` shows only intentional changes
- [x] Each commit is atomic + conventional; doc edits land in the same commit as their trigger (constitution §5)


### Review

**Verdict: PASS** (R6 blocked — tracked deferral, not a failure).

| Req | Status | Evidence |
|-----|--------|---------|
| R1 — kind=pipeline link | ✅ PASS | `packages/app/src/services/workflow-service.ts:195-237` (`maybeLinkPipelineRun`); 4 tests in `packages/app/tests/services/workflow-service.test.ts:418-501`; 1270+158 = 1428 tests 0 fail |
| R2 — 04_DESIGN §7.3/§7.4 | ✅ PASS | `docs/04_DESIGN.md:474` (§7.3 header), `:535` (§7.4 matrix + event catalog), `:612` (§7.6 reserved); 6 event names verified against `planning-write-service.ts:80` SSOT |
| R3 — 05_FEATURES §9 + 02_ROADMAP | ✅ PASS | `docs/05_FEATURES.md:123-132` (8 rows flipped ✅, task-pipeline 🔶); `docs/02_ROADMAP.md:50` Phase 1.5 updated |
| R4 — pipeline-pause deferral | ✅ PASS (doc-only) | `docs/00_ADR.md:524` ADR-022 addendum; `task-pipeline.yaml` validate clean |
| R5 — plugin tests in gate | ✅ PASS | `package.json:69` test script extended; AGENTS.md:202,212 updated; 1428 total |
| R6 — de-link catalog | 🔶 BLOCKED | Published 0.3.17 lacks `details` on `rule.eval.done`; links restored; trigger recorded in task file §R6 |
| R7 — migrate surface annotation | ✅ PASS | `AGENTS.md:168-197` (CLI surface + planning-layer note); `04_DESIGN.md:449` already "Reserved (A17)" |
| R8 — stale rd3 path | ✅ PASS | `plugins/sp/skills/anti-hallucination/references/tool-usage-guide.md:89` fixed; 0 remaining `plugins/rd3` paths |

**Gate:** `bun run lint` clean · `bun run test` 1428 pass / 0 fail · `bun run build` green · `git status` clean (5 atomic commits).


### Testing

**Full gate run (2026-06-15):**
- `bun run lint` — clean (Biome + 7 workspaces tsc --noEmit)
- `bun run test` — 1270 workspace tests + 158 plugin tests = 1428 pass / 0 fail / 0 skip
- `bun run build` — green across cli/server/web
- `bun run apps/cli/src/index.ts workflow validate config/workflows/task-pipeline.yaml` — valid

**R1-specific tests** (`packages/app/tests/services/workflow-service.test.ts`):
- `a task-pipeline run with vars.wbs writes exactly one kind=pipeline row` — verifies the row exists with correct wbs/run_id/kind
- `two pipeline runs for the same wbs each get exactly one pipeline link` — verifies per-runId idempotency
- `a non-pipeline workflow writes no pipeline link even with vars.wbs` — verifies name guard
- `a task-pipeline run without vars.wbs writes no pipeline link` — verifies vars guard


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


