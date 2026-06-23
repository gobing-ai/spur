---
schema_version: 1
name: "spur task record verb: move record-step logic out of pipeline YAML into a tested service"
status: done
template: feature-impl
created_at: 2026-06-23T23:00:51.301Z
updated_at: 2026-06-23T23:35:34.099Z
feature_id: H2
priority: P1
tags: ["cli", "workflow", "pipeline", "refactor", "testability", "dogfood"]
---

## 0108. spur task record verb: move record-step logic out of pipeline YAML into a tested service

### Background

The `record` state in config/workflows/task-pipeline.yaml contains ~50 lines of awk/grep/sed/jq/printf shell embedded in YAML strings to: parse the verify verdict JSON, build the Testing per-requirement table, build the Review P1–P4 priority table, and backfill a Solution change-map (file:line) from `git diff -U0`. This violates ADR-022's intent ('orchestration is CONFIGURATION'): the YAML expresses a PROGRAM, not config. Consequences observed: (1) untestable — the table/citation logic lives in strings with zero unit coverage; the two round-5 bugs (Solution missing file:line, Review missing the P1–P4 table) were exactly this, catchable only by a live pipeline run; (2) drift — the 'what a valid Solution/Review looks like' knowledge is duplicated between the YAML shell and section-matrix.yaml/task-check, and already drifted; (3) portability — assumes bash + awk/sed/jq on PATH (the same class of fragility resolveSpurBin just fixed). FIX: extract the logic into a typed, unit-tested `spur task record` verb (in packages/app TaskService + apps/cli), collapsing the record state to a single YAML line. SCOPE (decided): record OWNS section-writing (Testing/Review from verdict + optional Solution-from-diff backfill) and an optional status transition to `testing`; it does NOT run verify and does NOT gate `done` (the done gate stays a workflow shell guard — a control-flow concern, not a write). The implement step (/sp:dev-implement) remains the primary Solution author per 0106's section-ownership model; --solution-from-diff is the safety net that only fires when Solution is bare (reuse `sectionIsBare`). Reuses existing: replaceSection upsert (markdown-document.ts:297), sectionIsBare (task-service.ts:128), updateSection/updateStatus (task-service.ts). Reference: config/workflows/task-pipeline.yaml record state (lines ~128-180); ADR-022; section-matrix.yaml done requirements [Solution, Testing, Review].

### Requirements

- [ ] R1. Add a verdict-artifact reader/type in packages/app: parse `.spur/run/<wbs>-verdict.json` ({wbs, verdict, requirements[], checks[]}) into a typed object. Tolerate a missing/malformed file (treat as UNKNOWN verdict, empty requirements) without throwing.
- [ ] R2. TaskService.record(wbs, opts) in packages/app: generates and upserts the `## Testing` section (per-requirement verdict table from the verdict JSON) and the `## Review` section (P1–P4 priority findings table; a no-findings P4 row when verify is clean), via the existing updateSection (replaceSection upsert). One source of truth for section FORMAT — co-located with section-matrix/task-check, not re-derived in YAML.
- [ ] R3. Solution safety-net (opt-in): when `--solution-from-diff` is set AND `sectionIsBare(Solution)` is true, synthesize a change-map of real `file:line` citations from `git diff -U0` hunk headers (the format the matrix requires) and upsert `## Solution`. Never clobber a non-bare (implement-authored) Solution.
- [ ] R4. Optional transition: `--transition <status>` moves the task via updateStatus (e.g. `testing`) through the normal lifecycle guards. Omitted → no status change. record does NOT transition to done and does NOT run task check (gate stays in the workflow).
- [ ] R5. CLI: `spur task record <wbs> [--verdict-file <path>] [--solution-from-diff] [--transition <status>] [--json]` in apps/cli/src/commands/task.ts. `--verdict-file` defaults to `.spur/run/<wbs>-verdict.json`. `--json` emits a machine summary (sections written, solution backfilled?, transition).
- [ ] R6. Collapse the pipeline `record` state in config/workflows/task-pipeline.yaml from the ~4 shell steps to a single `${vars.spurBin} task record ${vars.wbs} --solution-from-diff --transition testing`. Keep the `record→done` / `record→failed` gate guards unchanged (control flow stays in YAML).
- [ ] R7. Tests (the whole point): unit-test the verdict reader (valid/missing/malformed), the Testing/Review generators (with-findings and clean → no-findings P4 row), and the Solution-from-diff synth (bare→backfilled with file:line; non-bare→untouched). Per-file ≥90% coverage. This replaces ZERO-coverage YAML shell with covered code.
- [ ] R8. Validate end-to-end: `spur workflow validate` green; `bun run lint` green; run a task through the pipeline and confirm record writes compliant Solution/Testing/Review and the done gate passes — the same flow that round-5 exercised, now from one verb. Dogfood it.
- [ ] R9. Doc sync (same commit): add `spur task record` to the CLI surface in AGENTS.md and 04_DESIGN.md §7 (task verbs); note the record-state simplification; ADR amendment only if the YAML-logic-extraction is a cross-cutting decision worth recording (likely a one-line note referencing ADR-022). Update 05_FEATURES §9.

### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
## Approach

A typed `TaskService.record(wbs, opts)` composing existing primitives, exposed as
`spur task record`. Collapses the pipeline `record` state's ~50 lines of YAML shell
(awk/grep/jq/printf) into one verb + one YAML line. The section *generators* (Testing
verdict table, Review P1–P4 table, Solution change-map) move from untested config-strings
into unit-tested code, co-located with the section-matrix format knowledge.

## Rationale

- **Logic belongs in code, not config (ADR-022).** The YAML expresses a program; a verb
  makes it testable and kills the round-5 drift (Solution `file:line`, Review P1–P4) that
  only a live run could catch.
- **Compose, don't reinvent.** `writeService.updateSection(ref, name, body)` already takes a
  **body string** (TaskService.updateSection just reads a file first) — `record` calls it
  directly with generated bodies, **no temp files**. `sectionIsBare` and `transition` already
  exist.
- **Single responsibility.** `record` writes results + optional `--transition`; it does NOT
  run verify and does NOT gate `done` (the gate is a workflow guard — control flow, not a
  write). Keeps the verb honest and the gate where it belongs.

## Key shapes

**Verdict reader** (R1 — tolerant):

```typescript
interface VerifyVerdict { wbs: string; verdict: 'PASS'|'PARTIAL'|'FAIL'|'UNKNOWN';
  requirements: Array<{ id: string; status: string; evidence: string }>;
  checks: Array<{ name: string; status: string; evidence: string }>; }
function readVerdict(path: string): Promise<VerifyVerdict>; // missing/malformed → UNKNOWN, []
```

**Service method** (R2–R4):

```typescript
interface RecordOptions { verdictFile?: string; solutionFromDiff?: boolean; transition?: string; }
interface RecordResult { testingWritten: boolean; reviewWritten: boolean; solutionBackfilled: boolean; transitionedTo?: string; }
async record(wbs: string, opts: RecordOptions): Promise<RecordResult>;
```

Generators are **pure functions** (unit-testable in isolation):
- `renderTesting(v: VerifyVerdict): string` — per-requirement verdict table.
- `renderReview(v: VerifyVerdict): string` — P1–P4 table; clean verify → one P4 "no findings" row.
- `renderSolutionFromDiff(diff: string): string` — `git diff -U0` hunk headers → `| \`file:line\` |` rows.

Each generated body → `writeService.updateSection(ref, name, body)` (upsert, no temp file).
Solution only when `solutionFromDiff && sectionIsBare(doc, 'Solution')`. `transition` →
`writeService.transition` (lifecycle guards apply).

**CLI** (R5): `spur task record <wbs> [--verdict-file <path>] [--solution-from-diff] [--transition <status>] [--json]`,
`--verdict-file` defaults to `.spur/run/<wbs>-verdict.json`.

**Pipeline** (R6): the record state becomes
`${vars.spurBin} task record ${vars.wbs} --solution-from-diff --transition testing`;
`record→done` / `record→failed` guards unchanged.

## Files

| File | Change |
|------|--------|
| `packages/app/src/services/task-record.ts` (or in task-service) | `readVerdict`, `render*` pure fns, `TaskService.record` |
| `packages/app/tests/services/task-record.test.ts` | unit tests for reader + 3 generators + record orchestration |
| `apps/cli/src/commands/task.ts` | `spur task record` command |
| `config/workflows/task-pipeline.yaml` | collapse record state to one line |
| `AGENTS.md`, `docs/04_DESIGN.md §7`, `docs/05_FEATURES.md §9` | surface + status |

## Invariants

- `record` never writes via shell/temp files — generated bodies go straight through `writeService`.
- Solution backfill is opt-in and bare-only — never clobbers an implement-authored Solution.
- `record` does not transition to `done` and does not run `task check` — the gate stays in the workflow.
- Section format is defined once (these generators); `section-matrix`/`task-check` validate the same shape.
### Plan
- [ ] 1. **Verdict reader (R1)** — `readVerdict(path): Promise<VerifyVerdict>` in packages/app (new `services/task-record.ts` or task-service). Parse `.spur/run/<wbs>-verdict.json`; missing/malformed → `{verdict:'UNKNOWN', requirements:[], checks:[]}` (no throw). Unit-test valid / missing / malformed.
- [ ] 2. **Pure generators (R2/R3)** — `renderTesting(v)`, `renderReview(v)`, `renderSolutionFromDiff(diffText)` as pure functions. Testing = per-requirement verdict table from `v.requirements`. Review = `| Priority | Dimension | Location | Finding |` table; clean → one `P4 | — | — | no findings` row. Solution = parse `git diff -U0` `@@` hunk headers → `| \`file:line\` |` rows (sorted, unique). Unit-test each (with-findings + clean + empty-diff fallback to `file:1`).
- [ ] 3. **Service orchestration (R2–R4)** — `TaskService.record(wbs, {verdictFile?, solutionFromDiff?, transition?})`: read verdict → render+upsert Testing & Review via `writeService.updateSection(ref, name, body)` (string body, NO temp file); if `solutionFromDiff && sectionIsBare(doc,'Solution')` → run `git diff -U0`, render, upsert Solution; if `transition` set → `writeService.transition(ref, status, actor)`. Return `RecordResult`. Does NOT run task check or transition to done.
- [ ] 4. **CLI (R5)** — `spur task record <wbs> [--verdict-file <path>] [--solution-from-diff] [--transition <status>] [--folder <path>] [--json]` in apps/cli/src/commands/task.ts; `--verdict-file` defaults to `.spur/run/<wbs>-verdict.json`; `--json` emits the RecordResult.
- [ ] 5. **Collapse pipeline record state (R6)** — replace the 4 shell steps in config/workflows/task-pipeline.yaml `record` onEnter with a single `${vars.spurBin} task record ${vars.wbs} --solution-from-diff --transition testing`. Leave `record→done` / `record→failed` guards unchanged. `spur workflow validate` green.
- [ ] 6. **Tests (R7)** — `task-record.test.ts`: reader (3 cases), each generator (with/clean/empty), and `record` orchestration against an in-memory task (Testing+Review written; Solution backfilled only when bare; transition applied). Per-file ≥90%.
- [ ] 7. **Validate + dogfood (R8)** — `bun run lint` green; `spur workflow validate` green; run a task through the pipeline; confirm record writes compliant Solution/Testing/Review (matching the matrix) and the done gate passes. Confirm zero orphaned runs after.
- [ ] 8. **Doc sync (R9, same commit)** — add `spur task record` to AGENTS.md CLI surface + 04_DESIGN §7 task verbs; note the record-state simplification (ref ADR-022); 05_FEATURES §9 status. ADR amendment only if warranted (likely a one-line note).
### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:199` |
| `apps/cli/tests/commands/task.test.ts:454` |
| `packages/app/src/index.ts:77` |
| `packages/app/src/services/task-service.ts:21` |
| `packages/app/src/services/task-service.ts:329` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:162` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:165` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:183` |

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | task-record.ts:1 |
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### History
- 2026-06-23T23:03:47.292Z todo → wip (system)
- 2026-06-23T23:20:27.827Z wip → testing (system)
- 2026-06-23T23:20:28.324Z testing → done (system)
