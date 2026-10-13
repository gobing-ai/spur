---
schema_version: 1
name: "Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir"
status: cancelled
template: standard
created_at: 2026-10-13T17:51:42.390Z
updated_at: "2026-10-13T17:58:59.040Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: P1
priority: P2
estimate_hours: 2
---

## 1194. Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir

### Background

Captured from the creation title: "Fix decide action evidence path resolution: an absolute evidence path is joined with the workdir".

**Audit (2026-10-13, depth ready).** The title claim is verified against the current tree:

- `packages/app/src/workflow/actions/decide.ts:194` (inline form) and `decide.ts:430` (catalog-reference form) map declared evidence through `join(workdir, path)`. `node:path.join` concatenates without honoring absolute segments, so an absolute evidence path resolves to `<workdir>/<abs-path>` and the read misses the declared file.
- Failure is silent in both forms: the catalog evidence-read catch degrades to the mapped fallback row with `reason: 'error'` (`decide.ts:445`); the inline form's evidence read returns `degraded('error')` (`workflow/decide.ts:135`). The decision then runs on no evidence with `ok: true` — the run continues degraded.
- The same root cause exists for `resultFile` at `decide.ts:196` (`runDecide` options), `decide.ts:270` (inline row write), `decide.ts:350` (catalog row write).
- Validate side needs no fix: `collectDecideViolations` (`workflow/composition-lint.ts:210`) is schema-only and never resolves evidence paths.
- The house idiom for absolute-aware workdir resolution already exists — `isAbsolute(p) ? p : join(workdir, p)` in `workflow/actions/agent-run.ts:332`, `workflow/consumer-compat.ts:141`, `workflow/actions/file-read.ts:29`.

**Refine corrections (2026-10-13).**
- Title claim "an absolute evidence path is joined with the workdir" → verified at `decide.ts:194,430`; claim unchanged — spec frozen from it (R1).
- Scope extended to the `resultFile` joins (`decide.ts:196,270,350`) → same root cause in the same seam, zero extra mechanism; recorded as R2 (Q&A D2).

### Requirements

- [ ] R1. A workflow `decide` action with an absolute `evidence` path reads the file from that absolute path — the workdir is never prefixed (both the inline and catalog-reference option forms).
- [ ] R2. A workflow `decide` action with an absolute `resultFile` writes the result row to that absolute path — the workdir is never prefixed.

Out of scope / non-goals:

- No change to the option schemas (`InlineDecideOptionsSchema`, `CatalogDecideOptionsSchema`) or the validate walker — `collectDecideViolations` stays schema-only.
- Relative `evidence`/`resultFile` paths keep resolving against the workflow workdir exactly as today (byte-identical resolution for relative paths).
- No fix for other actions' path joins (`file.exists`/`file.read`/guard-side resolution) — separate defect surface.
- Degradation behavior is unchanged: an unreadable declared evidence file still degrades to the mapped fallback row. The fix only stops mis-resolving valid absolute paths.

### Acceptance Criteria

```gherkin
Scenario: AC1 — inline-form decide reads an absolute evidence path as-is (req: R1)
    Given a workflow workdir `/tmp/w` with a decide step declaring `evidence: ["/tmp/evidence/notes.md"]`
    When `DecideActionRunner` executes with the file present only at `/tmp/evidence/notes.md`
    Then the evidence read succeeds (no `reason: 'error'` degradation from path resolution) and the maker input carries the file content.

Scenario: AC2 — catalog-reference decide reads an absolute evidence path as-is (req: R1)
    Given a catalog-reference decide step declaring `evidence: ["/tmp/evidence/notes.md"]` with the file present only at that absolute path
    When the runner executes against a loaded catalog
    Then the decision is served with `instructions` containing the evidence content — the row is not degraded with `reason: 'error'`.

Scenario: AC3 — absolute resultFile is written as-is (req: R2)
    Given a decide step declaring an absolute `resultFile`
    When the runner writes the schemaVersion-1 row
    Then the row lands at the declared absolute path, not `<workdir>/<abs-resultFile>`.

Scenario: AC4 — relative evidence and resultFile behavior is unchanged (req: R1)
    Given the existing decide suites using relative `evidence`/`resultFile` paths
    When the full decide suites run after the fix
    Then every pre-existing test passes unchanged (regression guard).
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T17:57:42.158Z

- D1 (closed 2026-10-13): Fix mechanism — one module-local `resolveWorkdirPath(workdir, path)` helper in `decide.ts` using the house idiom `isAbsolute(path) ? path : join(workdir, path)`, not `resolve(workdir, path)`: `resolve` would absolutize a relative `context.workdir` against `process.cwd()`, changing relative-path behavior. Matches `agent-run.ts:332` / `consumer-compat.ts:141`.
- D2 (closed 2026-10-13): Scope includes the `resultFile` joins — same root cause in the same file and helper; fixing evidence only would leave the row written to a mis-joined path.
- D3 (closed 2026-10-13): No validate-side change — `collectDecideViolations` is schema-only and never resolves paths; there is nothing to fix there.
- D4 (closed 2026-10-13): The deprecated inline form gets the same fix and keeps working — it remains the executed contract until the 1114–1116 catalog migrations land (decide.ts header comment).

### Design

**WHAT:** Replace the five bare workdir joins in `DecideActionRunner` with one absolute-aware resolver. Evidence sites (`decide.ts:194` inline, `:430` catalog) fix the reported bug; `resultFile` sites (`:196`, `:270`, `:350`) fix the same root cause.

**WHY:** `node:path.join` concatenates absolute segments (`join('/w', '/a') === '/w/a'`), so absolute declared paths are mis-resolved. Evidence mis-read silently degrades the decision to its fallback row and the run continues without evidence; a mis-joined `resultFile` writes the row to an unintended workdir path where guards may not find it.

**WHERE:** `packages/app/src/workflow/actions/decide.ts` only — one file, no new API outside it. Frozen helper:

```ts
/** Absolute option paths are used as-is; relative paths stay workdir-relative (house idiom, cf. agent-run.ts:332). */
function resolveWorkdirPath(workdir: string, path: string): string {
    return isAbsolute(path) ? path : join(workdir, path);
}
```

Apply at the five sites: `options.evidence.map((path) => resolveWorkdirPath(workdir, path))` (both forms) and `resolveWorkdirPath(workdir, options.resultFile)` for the `runDecide` options and both `writeFile` row writes.

**Invariant:** relative resolution stays byte-identical to today — `isAbsolute(p) ? p : join(workdir, p)`, never `resolve(workdir, p)` (see Q&A D1).

**Anti-patterns:** do not schema-validate paths to be relative; do not touch `readDecisionEvidence`, the evidence digest, the validate walker, or guard-side path resolution.

**Tests:** extend `packages/app/tests/workflow/actions/decide.test.ts` (inline form; `makeContext(workdir)` + `fakeFs` pattern exists) and `packages/app/tests/workflow/actions/decide-catalog.test.ts` (catalog form; `makeContext` at `:46`) with absolute-path cases per AC1–AC3; the existing suites are the AC4 regression guard.

**Handoff:** none — single-package, no dependents.

### Plan

1. (R1/R2) Add the module-local `resolveWorkdirPath` helper to `decide.ts` per Design; import `isAbsolute` from `node:path`.
2. (R1) Use it for the inline-form evidence map (`decide.ts:194`) and the catalog-form evidence map (`decide.ts:430`).
3. (R2) Use it for `resultFile`: the `runDecide` options (`decide.ts:196`) and both `writeFile` row writes (`decide.ts:270` inline, `:350` catalog).
4. (R1) Tests: absolute evidence path read as-is — inline form in `decide.test.ts`, catalog form in `decide-catalog.test.ts` (catalog case asserts the row is not degraded with `reason: 'error'`).
5. (R2) Test: absolute `resultFile` row lands at the declared absolute path.
6. Verify: `(cd packages/app && bun test tests/workflow/actions/decide.test.ts tests/workflow/actions/decide-catalog.test.ts)` — all pre-existing and new tests pass (AC4); then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Defect sites: `packages/app/src/workflow/actions/decide.ts:194,196,270,350,430`
- Inline degradation on unreadable evidence: `packages/app/src/workflow/decide.ts:135` (`degraded('error')`)
- Evidence reader (unchanged): `packages/app/src/decision/decision-evidence-input.ts`
- House idiom: `packages/app/src/workflow/actions/agent-run.ts:332`, `packages/app/src/workflow/consumer-compat.ts:141`, `packages/app/src/workflow/actions/file-read.ts:29`
- Tests: `packages/app/tests/workflow/actions/decide.test.ts`, `packages/app/tests/workflow/actions/decide-catalog.test.ts`
- Lineage: task 0941 (decide action), task 1094 (catalog-reference form), ADR-125; feature P1
- Concurrency (2026-10-13): wip task 1189 touches task-lifecycle files only — no overlap with `decide.ts`; worktrees `spur-new-verify` / `spur-tools` unrelated.

### History

- 2026-10-13T17:58:09.333Z backlog → todo (system)
- 2026-10-13T17:58:59.040Z todo → cancelled (system)

