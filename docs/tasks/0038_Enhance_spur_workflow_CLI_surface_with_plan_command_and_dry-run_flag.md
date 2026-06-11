---
name: Fix workflow list, add workflow/rule trace, and add --dry-run
description: Fix workflow list semantic (files not runs), add workflow trace and rule trace for execution history, and add --dry-run flag
status: done
created_at: 2026-06-11T06:00:00.000Z
updated_at: 2026-06-11T19:10:00.000Z
folder: docs/tasks
type: task
feature-id: ""
preset: complex
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
impl_progress_detail:
  dry_run: done # ts-dual-workflow-engine 0.3.12 published; catalog bumped; link: reverted
  fix_list: done
  workflow_trace: done
  rule_trace: done # TODO marker surface shipped; data plumbing in follow-on task after 0039
---

## 0038. Fix workflow list, add workflow/rule trace, and add --dry-run

### Background

Migration gap analysis between old Spur (`~/xprojects/spur-old`) and current Spur (`spur-new`).
Three related issues uncovered:

**1. `spur workflow list` has the wrong semantic.** It returns persisted execution runs from SQLite (`EngineWorkflowService.listRuns()`), but by design it should list **available workflow YAML files** — same as `spur rule list` lists available rule files. The old spur agreed:

```
spur workflow list   List all available workflows across project and global layers
```

This is a porting bug: the verb `list` was wired to the engine's run ledger instead of file discovery.

**2. No execution-history *query surface*, and no action-level detail.** *(Reframed 2026-06-11 after verification + alignment — the original claim "no execution history" was wrong.)* The engine already persists run history to SQLite through **direct persistence-adapter calls** (`RunLifecycle` → `DbWorkflowPersistenceAdapter`): `runs` (ledger), `phase_runs` (every state entered + terminal phase), `transition_runs` (every from→to with trigger), `workflow_states` (per-state snapshots). The `WorkflowEngineEvents` bus is a parallel, *optional*, in-process observability channel — nothing persists through it, and Spur injects no bus today. What is actually missing: (a) a command to **query** that history with useful filters — the mis-named `list` accidentally exposes only the unfiltered `runs` ledger; (b) **action-level records** — `actionStart`/`actionDone` emit events + OTel span events only, with no persistence call, so action kind/duration/ok/result never reach the DB.

**3. No rule execution history.** `spur rule run` produces findings/fixes to stdout but nothing is persisted — `ts-rule-engine` is a stateless batch evaluator with **no persistence seam at all** (its `RuleEngineEvents` are observability-only). Rule runs are ephemeral — once the output scrolls by, there's no way to revisit what was found or fixed. Decision (alignment 2026-06-11): add a persistence adapter upstream, mirroring the workflow-engine pattern (option (a) — see R3).

**Old `spur workflow` commands (for reference):**
```
spur workflow validate <file> [--json] [--no-schema]
spur workflow list        [--json] [--cwd]        ← lists available workflow files
spur workflow plan  <file> [--json]
spur workflow run   <file> [--task] [--task-id] [--agent] [--json] [-a|--annotations]
                           [--run-id] [--force] [--dry-run]
                           [--start-from] [--start-transition-count]
                           [--trigger] [--trigger-payload] [--database-url]
```

**Current `spur workflow` and `spur rule` commands (post dry-run, pre-fix):**
```
spur workflow validate <file> [--json] [--no-schema]
spur workflow run      <file> [--run-id] [--vars] [--dry-run] [--json]
spur workflow list             [--json]            ← BROKEN: shows runs, not files
spur rule     validate [--file|--preset|<path>] [--kind] [--no-schema] [--json]
spur rule     run      [--preset] [--file] [--rule] [--fail-on] [--stop-on-first] [--fix-mode] [--dry-run] [--verbose] [--json]
spur rule     list     [--preset] [--json]         ← CORRECT: shows available rule files
```

**Target surface:**
```
spur workflow validate <file> [--json] [--no-schema]
spur workflow run      <file> [--run-id] [--vars] [--dry-run] [--json]
spur workflow list             [--json]            ← FIXED: available workflow files
spur workflow trace    [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--json]   ← NEW
spur rule     validate [--file|--preset|<path>] [--kind] [--no-schema] [--json]
spur rule     run      [--preset] [--file] [--rule] [--fail-on] [--stop-on-first] [--fix-mode] [--dry-run] [--verbose] [--json]
spur rule     list     [--preset] [--json]
spur rule     trace    [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]     ← NEW (TODO marker until rule persistence lands)
```

### Verification findings (2026-06-11)

All claims in this task were verified against the actual code. **Note:** the *design responses* in
findings 2, 3, and 5 (per-run EventBus recorder + JSONL files) were subsequently **superseded by the
Alignment decisions below** — the facts in the findings remain valid; the chosen solution changed.

1. **Issue 1 (broken `list`) — CONFIRMED.** `WorkflowAppService.list()` calls `listRuns()` (`packages/app/src/services/workflow-service.ts`); the CLI prints persisted runs.
2. **Issue 2 (no workflow history) — CONFIRMED, wiring point corrected.** `workflow.action.start`/`workflow.action.done` carry metadata only, and Spur passes no event bus at all (so the events never even fire). But the bus is injected **per run** via `WorkflowRunOptions.events` → `runFile()`; the engine's `WorkflowService` constructor takes only `(host, persistence)`. R2.4 corrected accordingly.
3. **Issue 3 (rule history) — premise corrected.** `ts-rule-engine` ALREADY fires run-level events: `rule.run.start` `{rules,total}`, `rule.eval.start` `{ruleId,index,total}`, `rule.eval.done` `{ruleId,findings,durationMs}`, `rule.eval.error` `{ruleId,error}`, `rule.run.done` `{rules,findings,durationMs,stoppedEarly}` — not the `rule:start`/`rule:done` names Q4 originally claimed, and the run-level gap does not exist. Spur's `RuleService` already wires `new RuleEngine({ events })` for `--verbose` (`packages/app/src/services/rule-service.ts:408-447`). **No ts-rule-engine change or release is required for R3.** What is genuinely absent (runId, preset, file list, findings/fixes detail) is all known to `RuleService` and is recorded Spur-side.
4. **`--dry-run` was NOT actually done.** The Spur CLI/service wiring exists, but the engine-side `dryRun` support is **uncommitted in `~/xprojects/ts-libs` (version 0.3.12, unreleased)** — the published 0.3.11 silently ignores `dryRun` and **executes actions anyway**. Verified by test: a failing shell action ran despite `dryRun: true` under 0.3.11 and was correctly skipped under linked 0.3.12. Per AGENTS.md, a temporary `link:@gobing-ai/ts-dual-workflow-engine` is active in `apps/cli`, `packages/app`, `packages/domain` until 0.3.12 is committed, published, and the root catalog is bumped. The upstream change also ships no dryRun tests of its own — add one when releasing.
5. **JSONL path collision flagged.** R3's interim design wrote run logs to `.spur/rules/<runId>.jsonl` — that directory is the project rule-definition root (local layer of rule-root resolution). *(Moot since alignment: the JSONL store was dropped for SQLite. Standing lesson: never write run artifacts into `.spur/rules/`.)*
6. **Reference fixed.** The workflows config schema lives at `apps/cli/src/config/schema.ts` (`WorkflowsConfigSchema`), not `packages/config/src/schema.ts`. `config/config.example.yaml` declares `workflows.paths: ['.spur/workflows/']`; nothing reads it yet — R1 is its first consumer.
7. **Symlink edge case added.** `.spur/workflows` is a symlink to `config/workflows` in this repo; R1's file discovery must follow directory symlinks.

### Alignment decisions (2026-06-11, Robin)

The verification round was reviewed and the design re-aligned. These decisions supersede the
JSONL/EventBus-recorder design and govern the Requirements/Design/Plan below:

1. **SQLite, not JSONL.** Workflow run history already lives in the DB (Background 2): `RunLifecycle`
   writes `runs`/`phase_runs`/`transition_runs`/`workflow_states` through **direct adapter calls**,
   and `packages/domain` already ships DAOs over those tables. `trace` is a query surface over the
   DB; the JSONL recorder design is dropped entirely.
2. **`trace` = the renamed runs-listing + pre-defined filters.** The current (mis-named) `list()`
   implementation IS the no-arg `trace`. Rename it and add `--workflow`, `--status`, `--since`,
   `--last` so a user can find a specific workflow's history quickly. Filtering is implemented
   Spur-side (SQL via `packages/domain`), NOT by changing the engine's `listRuns()` API.
3. **`list` mirrors current `rule list`'s output shape** (layers, totals, per-entry valid/error,
   source labels). Verified equivalent to old spur's `workflow list`
   (`spur-old/apps/cli/src/formatters/workflow.ts:124` `formatListHuman`).
4. **Rule trace goes upstream (option a).** `ts-rule-engine` gets an optional persistence adapter +
   engine-owned schema mirroring `ts-dual-workflow-engine`'s pattern, so both engines persist run
   history the same way. Upstream work in `~/xprojects/ts-libs` is already part of this effort.
5. **Persistence is direct adapter API — events stay observability-only.** Action-level detail is a
   follow-up upstream enhancement (`action_runs` table + `saveAction()` on the adapter, called from
   `runActions()`). Whether the `action.start`/`action.done` **event payloads** should also be
   enriched is a separate design discussion (next step, after this task-file revision) — do not
   implement event changes until that is decided.
6. **Task split (second round, after the event-design discussion — keep each task simple).** All
   workflow-engine observability + persistence work (action_runs, event enrichment, HITL/guard
   events, custom-event mapping, redaction, compat policy) is extracted to **task 0039**. Task 0038
   keeps the CLI surface only: `workflow list` fix, `workflow trace` + filters over the existing
   tables, and a `rule trace` **placeholder** (proper flags, TODO-marker output — the
   `history report` pattern). The rule-engine persistence seam (option a) becomes a third task,
   created after 0039 is successfully implemented; its design seed stays recorded in this file.

### Gap Analysis (full)

| Feature | Status | Decision |
|---------|--------|----------|
| `run --dry-run` | 🔶 BLOCKED on engine release | Spur flag + service wiring done and tested; needs `ts-dual-workflow-engine` 0.3.12 commit + publish + catalog bump (see finding 4) |
| `list` semantic | ❌ BROKEN | **FIX** — change from `listRuns()` DB query to file discovery (`.spur/workflows/` + global layer) |
| `plan <file>` | Skipped | Redundant — `validate` + `run --dry-run` cover the preview ladder |
| `run --task`/`--agent`/`--annotations` | Skipped | Subsumed by `--vars '{"taskId":"0042","agent":"claude"}'` |
| Execution history (workflow) | 🔶 PARTIAL — persisted, no query surface | **ADD `spur workflow trace [run-id]` + filters** — Spur-side query over the existing `runs`/`phase_runs`/`transition_runs` tables; action-level rows follow via **task 0039** |
| Execution history (rule) | **MISSING** | **ADD `spur rule trace` CLI surface (placeholder)** — proper flags + TODO marker now; data via the rule-engine persistence task created after 0039 |
| `run --force`/`--start-from`/`--trigger` | Deferred | Phase 3 engine capabilities |

### Requirements

#### R1 — Fix `spur workflow list` (semantic correction)

1. Change `WorkflowAppService.list()` from `EngineWorkflowService.listRuns()` to file discovery.
2. Scan `.spur/workflows/` (project layer) and `~/.config/spur/workflows/` (global layer), respecting `workflows.paths` (`WorkflowsConfigSchema` in `apps/cli/src/config/schema.ts`; declared in `config/config.example.yaml`). Discovery follows directory symlinks (`.spur/workflows` → `config/workflows` in this repo).
3. Parse each discovered `.yaml`/`.yml` file to extract `name` and `kind`. Gracefully skip unparseable files (log, don't fail).
4. Output matches `spur rule list` pattern: layers, file count, categorized files with name/kind/path. `--json` structured.
5. The current run-list behavior moves to `spur workflow trace` (no-arg form).

#### R2 — Add `spur workflow trace [run-id]` (Spur-side; no upstream change)

1. **No argument**: list recent persisted workflow runs — the renamed current `list()` implementation. `--json` structured.
2. **Pre-defined filters**: `--workflow`, `--status`, `--since`, `--last` (default 20). Spur-side SQL via `packages/domain`.
3. **With `<run-id>`**: per-run timeline from `phase_runs` + `transition_runs` interleaved by `created_at`. Action rows join once task 0039 lands.
4. Dry runs stamped with `metadata_json` `{"dryRun":true}` for labeling.
5. CLI flag validation: invalid `--last`/`--status` errors loudly.

#### R3 — Add `spur rule trace` CLI surface (placeholder)

1. Surface only. Register `spur rule trace [run-id] [--preset] [--status] [--since] [--last] [--json]` per the `history report` TODO-marker pattern: deterministic `TODO:` plain + `{status:'todo'}` JSON; flags parse and validate. Real data requires the rule-engine persistence task created after 0039 completes.

#### R4 — Design doc + gates

1. `04_DESIGN.md` updated: fix `list`, add `trace` to both workflow and rule surfaces.
2. `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` green.

#### Traceability (Phase 8, 2026-06-11)

- [x] **R1.1**: list() → file discovery → **MET** | `packages/app/src/services/workflow-service.ts:179-214`
- [x] **R1.2**: project + global layers, symlinks → **MET** | `workflow-service.ts:309-341` (`scanWorkflowFiles` + `realpath()`)
- [x] **R1.3**: YAML name+kind, skip unparseable → **MET** | `workflow-service.ts:344-373` (`extractWorkflowMeta`)
- [x] **R1.4**: rule-list-shaped output → **MET** | `apps/cli/src/commands/workflow.ts:177-211` (`formatListHuman`)
- [x] **R1.5**: config `workflows.paths` read → **MET** | `apps/cli/src/commands/workflow.ts:44-54` (`resolveWorkflowPaths`)
- [x] **R2.1**: no-arg trace lists runs (last 20) → **MET** | `workflow-service.ts:231-243` + `run-dao.ts:38-62`
- [x] **R2.2**: --workflow --status --since --last filters → **MET** | `workflow.ts:132-149` (flags + validation) + `run-dao.ts:50-61`
- [x] **R2.3**: per-run phase+transition timeline → **MET** | `workflow-service.ts:245-281` (merge loop)
- [x] **R2.4**: dryRun stamp → **MET** | `workflow-service.ts:167-171` (stamp) + `387-394` (`rowToTraceEntry`)
- [x] **R2.5**: --last/--status validation → **MET** | `workflow.ts:139-149`
- [x] **R3.1**: rule trace subcommand + flags → **MET** | `apps/cli/src/commands/rule.ts:99-118`
- [x] **R3.2**: TODO marker (plain + JSON) → **MET** | `rule.ts:110-112`
- [x] **R3.3**: --status validation → **MET** | `rule.ts:108-109`
- [x] **R4.1**: 04_DESIGN.md updated → **MET** | `docs/04_DESIGN.md:138-155`
- [x] **R4.2**: gates green → **MET** | lint ✓ · test 531/0 ✓ · build ✓ · test-cf ✓

**Score:** 14/14 MET

### Review (Phase 7 SECU, 2026-06-11)

**Status:** 0 open findings
**Scope:** 17 files, ~910 insertions — `workflow list` fix + `trace` + `rule trace` placeholder
**Gate:** lint ✓ · 531 tests 0 fail ✓ · build ✓ · test-cf ✓

**Security:** All 4 DAO query methods use parameterized `?` placeholders. No hardcoded secrets, XSS, or injection vectors.
**Efficiency:** No N+1 queries. Timeline merge is single-pass over 2 parameterized queries. `defaultLast=20` bounded.
**Correctness:** Empty catch blocks are intentional graceful degradation (missing dirs, unparseable YAML/metadata). Timeline merge casts (`as PR`/`as TR`) are typed narrowing — not unsafe. `stampMetadata` writes parameterized JSON.
**Usability:** Error messages clear for all 3 flag-invalid paths. Types exported from `packages/app`. Formatters match `spur rule list` convention.

Closing: P3 symlink-following test added (`packages/app/tests/services/workflow-service.test.ts:223-241`); found and fixed during this review. No remaining findings.

**Q1. Why `trace` and not `history` or `inspect`?**
Verb alignment. Every spur command is `<noun> <verb>`: `workflow validate`, `workflow run`, `workflow list`, `workflow trace`. `history` is a noun — it breaks the pattern. `inspect` implies a single target and feels wrong for the no-arg "list recent" form. `trace` works for both: "trace workflows" (overview) and "trace this run" (timeline).

**Q2. Why SQLite tables, not JSONL files?**
*(Reversed 2026-06-11 at alignment — the original answer argued for JSONL.)* The engine already persists run history to SQLite via its persistence adapter (`runs`, `phase_runs`, `transition_runs`, `workflow_states`), and `packages/domain` already ships DAOs over those tables. The DB **is** the run-history store. A parallel JSONL store would duplicate the concern, split the source of truth, and still need indexing to serve the filter queries `trace` exists for. Schema evolution is handled like every other engine-owned table. Rule runs follow the same pattern through the new upstream persistence seam (option a).

**Q3. How does action-level detail get persisted?**
*(Re-scoped 2026-06-11 at alignment — earlier revisions designed this as event enrichment feeding a JSONL recorder; both dropped.)* The engine persists through **direct adapter calls**, not the EventBus: `RunLifecycle.enter`/`recordTransition`/`done`/`fail` call `saveWorkflowState`/`savePhase`/`saveTransition`/`finalizeRun`, while `actionStart`/`actionDone` emit events + OTel spans only — no persistence call. The consistent fix is a `saveAction()` adapter method + `action_runs` table, called from `runActions()` next to the existing emission sites (carrying run_id, node, kind, duration_ms, ok, redaction-aware result_json). The event-design discussion concluded 2026-06-11 and this work is **extracted to task 0039** (decisions there: two-phase `saveAction` for in-flight visibility, direct writes over a bus subscriber, additive event enrichment).

**Q4. What about recording for rule runs — does `ts-rule-engine` already support this?**
*(Corrected 2026-06-11 — the original answer claimed the taxonomy was per-rule only with `'rule:start'`-style names; wrong. Conclusion updated again at alignment.)* **Events: yes** — the engine fires `rule.run.start`, `rule.eval.start`, `rule.eval.done`, `rule.eval.error`, `rule.run.done` through `EventBus<RuleEngineEvents>`, and Spur already wires a bus for `--verbose` progress (`rule-service.ts:408-447`). **Persistence: no** — the engine is a stateless batch evaluator with no persistence seam. Alignment decision (option a): add `RulePersistenceAdapter` + engine-owned schema upstream, mirroring the workflow engine, so both engines persist run history identically (direct adapter calls; events stay observability-only). `RuleService` still owns the run boundary and injects the runId + preset/files context.

**Q5. Does fixing `list` break anyone?**
Yes — anyone relying on `spur workflow list` returning execution runs. But (a) this was a porting bug, not a designed behavior, and (b) the same data is available via `spur workflow trace` (no-arg form). The fix aligns `list` with its documented intent and `rule list`'s semantics.

### Design

#### Fix `spur workflow list` — file discovery

**Files changed:**

| File | Change |
|------|--------|
| `packages/app/src/services/workflow-service.ts` | Replace `list()` (calls `listRuns()`) with `list()` that scans filesystem |
| `apps/cli/src/commands/workflow.ts` | Update `list` command action to use new `list()` shape |

**File discovery logic:**
1. Resolve search paths from `config.workflows.paths` (default: `['.spur/workflows/']`).
2. Walk each path, collecting `.yaml` and `.yml` files.
3. For each file, attempt to parse as `WorkflowDef` to extract `name` and `kind`. Gracefully skip unparseable files (log warning, don't fail).
4. Return structured result: `{ layers: [{ id, path }], files: [{ name, kind, path, origin }], totalFiles }`.

**Output format (plain):**
```
Sources: project (.spur/workflows/), global (~/.config/spur/workflows/) (layered mode)
Total files: 3

  project/
    basic       state-machine  .spur/workflows/basic.yaml
    feature-dev state-machine  .spur/workflows/feature-dev.yaml
  global/
    ci-pipeline transition-flow  ~/.config/spur/workflows/ci-pipeline.yaml
```

#### Add `spur workflow trace` — execution history (DB query, Spur-only)

**Files changed:**

| File | Change |
|------|--------|
| `packages/app/src/services/workflow-service.ts` | Rename run-listing `list()` → `trace()`; filtered run query + per-run timeline assembly; stamp `metadata_json` `{"dryRun":true}` in `run()` |
| `packages/domain/src/dao/` | Filtered run query + timeline reads over `phase_runs`/`transition_runs` (extend the existing DAOs or add a small query helper) |
| `apps/cli/src/commands/workflow.ts` | Add `trace` subcommand with filter flags; repoint `list` to file discovery |
| `docs/04_DESIGN.md` | Add `trace` (+ filters) to workflow surface |

**Data already in the DB per run (written directly by `RunLifecycle` — no events involved):**

| Table | Rows | Written by |
|-------|------|-----------|
| `runs` | one per run: workflow_name, mode, status, started/completed_at, metadata_json | `createRun` / `finalizeRun` |
| `phase_runs` | one per state entered + one terminal row | `savePhase` (via `enter`/`done`/`fail`) |
| `transition_runs` | one per transition: from_state, to_state, trigger | `saveTransition` |
| `workflow_states` | snapshot per state entry (`{transitionsTaken}`) | `saveWorkflowState` |

Missing layer: action rows — `actionStart`/`actionDone` make no persistence call. Task 0039 adds
`action_runs` + two-phase `saveAction()` upstream; `trace <run-id>` then gains action lines with no
re-architecture (one more table in the same `created_at`-ordered join).

**Trace output (plain, no-arg form with filters):**
```
$ spur workflow trace --workflow basic --status failed --last 5
RUN ID    WORKFLOW  MODE           STATUS  STARTED               COMPLETED
abc123    basic     state-machine  failed  2026-06-11T05:58:01Z  2026-06-11T05:58:07Z
9f31c0    basic     state-machine  failed  2026-06-10T22:14:55Z  2026-06-10T22:15:09Z
```

**Trace output (plain, `<run-id>` form; action lines `└ ...` appear after task 0039):**
```
Run: abc123 — basic (state-machine) — done
Started: 2026-06-11T06:00:00.000Z   Completed: 2026-06-11T06:00:05.000Z   Transitions: 4

  0. implement
     └ note (45ms) ✓
     → check
  1. check
     └ shell (2.1s) ✓  bun run check
     → done  [guard: action-ok]
  2. done  (terminal)
```

#### Add `spur rule trace` — CLI surface placeholder

**Files changed:**

| File | Change |
|------|--------|
| `apps/cli/src/commands/rule.ts` | Add `trace` subcommand: full flag surface, TODO-marker action (`history report` pattern) |
| `docs/04_DESIGN.md` | Add `trace` to rule surface, marked as reserved/TODO |

**Behavior (until the rule-engine persistence task lands):**

```
$ spur rule trace
TODO: spur rule trace is reserved for rule execution history (pending rule-engine persistence).

$ spur rule trace --json
{ "status": "todo", "message": "..." }
```

Flags parse and validate (bad `--status` etc. still error loudly) so the grammar is locked now.
`RuleEngineEvents` and the engine stay untouched. The persistence seam design seed lives in R3.3;
the implementing task is created after task 0039 completes.

### Plan

Decomposition (post-split, alignment decision 6): everything in this task is **Spur-only and
shippable now** except the `--dry-run` release closure. A (list fix), B (workflow trace + filters),
C (rule trace placeholder) have no upstream dependency. D tracks the extracted work. E closes
docs + gates and the dry-run release.

#### Item A — Fix `spur workflow list` (~30 LOC)

1. `WorkflowAppService`: replace `list()` with file-scanning implementation.
2. CLI: update `list` command to use new `list()` shape.
3. Tests: validate file discovery (empty dir, files with parseable YAML, unparseable files ignored, `--json` output).
4. Existing `list` tests that expect execution runs must be updated.

#### Item B — Add `spur workflow trace` (~80 LOC, Spur-only)

1. `WorkflowAppService`: rename the current run-listing `list()` → `trace()`; query via `packages/domain` with filters (`--workflow`/`--status`/`--since`/`--last`), not the engine's unfiltered `listRuns()`.
2. Per-run timeline: `runs` header + `phase_runs` + `transition_runs` interleaved by `created_at`.
3. `run()`: stamp `metadata_json` `{"dryRun":true}` for dry runs.
4. CLI: add `trace` subcommand with `[run-id]`, filter flags, `--json`.
5. Tests: no-arg lists runs (default last 20, newest first); each filter narrows correctly; run-id timeline ordering; unknown run-id error; `--json` shapes; dry-run labeling.

#### Item C — Add `spur rule trace` placeholder (~20 LOC, Spur-only)

1. CLI: register `trace` with `[run-id]`, `--preset`, `--status`, `--since`, `--last`, `--json`; TODO-marker action per the `history report` pattern.
2. Tests: command registers; flags parse (invalid values error); plain + `--json` placeholder shapes are deterministic.

#### Item D — Extracted work (tracking only)

1. **Task 0039** — workflow engine observability & action-level persistence (`action_runs` + two-phase `saveAction`, event enrichment, HITL/guard events, custom-event mapping design, redaction, compat policy). When it lands, `trace <run-id>` gains action lines.
2. **Future task (after 0039)** — rule-engine persistence seam (option a; seed in R3.3) to put real data behind the `rule trace` placeholder.

#### Item E — Dry-run release closure + docs + gates

1. Commit + publish `ts-dual-workflow-engine` 0.3.12 (the `dryRun` fix; add an upstream dryRun test); bump Spur catalog; revert the temporary `link:` entries to `catalog:`.
2. `04_DESIGN.md`: fix `list`, add `trace` (+ filters) to the workflow surface and the rule `trace` placeholder.
3. `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build`.

### Testing

**dry-run (added 2026-06-11; pass only against engine ≥0.3.12 / temporary link):**
- `WorkflowAppService.run` with `dryRun: true` completes a workflow whose shell action would both fail and leave a side effect — asserts status `done` AND the side-effect file absent (`packages/app/tests/services/workflow-service.test.ts`)
- CLI forwards `--dry-run`: a failing-action workflow exits 0 under the flag (`apps/cli/tests/commands/workflow.test.ts`)

**Item A (list fix):**
- `list` returns available workflow files from `.spur/workflows/`
- `list --json` returns structured file list
- Empty dir returns zero files (graceful)
- Unparseable YAML files are skipped (logged, not fatal)
- Discovery follows a symlinked workflows dir (`.spur/workflows` → `config/workflows` in this repo)

**Item B (workflow trace):**
- `trace` (no arg) lists recent runs from the DB, newest first, default `--last 20`
- `--workflow`, `--status`, `--since`, `--last` each narrow correctly (plus one combined-filter case)
- `trace <run-id>` shows the state/transition timeline from `phase_runs` + `transition_runs` in `created_at` order
- `trace <run-id> --json` emits the structured timeline
- Unknown run-id shows a clear error
- Dry runs are labeled (metadata_json `{"dryRun":true}`)

**Item C (rule trace placeholder):**
- `rule trace` registers and prints the deterministic TODO marker (plain + `--json {status:'todo'}`)
- All filter flags parse; invalid `--status`/`--since` values error loudly
- (Data-backed tests move to the future rule-persistence task)

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| test | `packages/app/tests/services/workflow-service.test.ts` (dryRun skips actions) | claude | 2026-06-11 |
| test | `apps/cli/tests/commands/workflow.test.ts` (--dry-run forwarding) | claude | 2026-06-11 |
| dep | temporary `link:@gobing-ai/ts-dual-workflow-engine` in apps/cli, packages/app, packages/domain — remove after 0.3.12 release + catalog bump | claude | 2026-06-11 |
| task | `docs/tasks/0039_Workflow_engine_observability_and_action-level_persistence.md` — extracted engine-side scope (alignment decision 6) | claude | 2026-06-11 |

### References

- Old Spur workflow CLI output: `~/xprojects/spur-old` — `bun run apps/cli/src/index.ts workflow help`
- `spur rule list` implementation: `apps/cli/src/commands/rule.ts:82-97`, `packages/app/src/services/rule-service.ts`
- Workflow config schema: `apps/cli/src/config/schema.ts` (`WorkflowsConfigSchema`); example values in `config/config.example.yaml`
- Rule-engine event wiring precedent: `packages/app/src/services/rule-service.ts:408-447` (`new RuleEngine({ events })` for `--verbose`)
- `docs/02_ROADMAP.md` — Phase 3: Workflow & Constraint Depth
- `docs/04_DESIGN.md` — workflow + rule command surface
- Engine source: `~/xprojects/ts-libs/packages/dual-workflow-engine/`
- Rule engine source: `~/xprojects/ts-libs/packages/rule-engine/`
- Engine persistence write path (the pattern R3 mirrors): `dual-workflow-engine/src/run-lifecycle.ts` (direct adapter calls), `persistence.ts` (Db + Memory adapters), `schema-sql.ts` (`runs`/`phase_runs`/`transition_runs`/`workflow_states`)
- Spur DAOs over the engine tables: `packages/domain/src/dao/` (`run-dao`, `phase-run-dao`, `transition-run-dao`, `workflow-state-dao`)
- Old `workflow list` formatter: `~/xprojects/spur-old/apps/cli/src/formatters/workflow.ts:124` (`formatListHuman`)
