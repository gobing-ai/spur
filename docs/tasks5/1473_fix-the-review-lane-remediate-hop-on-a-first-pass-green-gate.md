---
schema_version: 1
name: Fix the review-lane remediate hop on a first-pass-green gate
status: todo
template: issue
created_at: 2026-11-27T18:18:55.414Z
updated_at: "2026-11-27T20:19:29.055Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: H16
priority: P1
estimate_hours: 3
---

## 1473. Fix the review-lane remediate hop on a first-pass-green gate

### Background

A PARTIAL review verdict on a task whose quality gate passed **on the first attempt** dead-ends the
task-pipeline at `failed(reason: failed-check)`. Observed 2026-11-27 in the knowledge-kit D9 batch,
task 0451 (run `ae0d9e4a`; recorded in knowledge-kit `.spur/run/runall-d9-4d35-batch-report.md:18,40-42,91-93`
— the per-run artifacts are no longer on disk): the gate wrote `DEFERRED` (light tier PASS), the
reviewer returned PARTIAL, `review → remediate` fired, and remediate's `file.read.into-var` on
`.spur/run/0451-test-gate.findings` returned `file not found`, failing the step and the run. The
operator hand-wrote the findings file and started a second pipeline run.

Two defects combine, plus one content gap:

1. **The deferred tier does not write the findings artifact on a pass.**
   `packages/app/src/services/quality-gate.ts:886-896` (`runDeferredGate`) writes
   `<wbs>-test-gate.findings` only when `status === 'FAIL'`. The full tier writes it on every outcome
   (`quality-gate.ts:1518` receipt-reuse PASS, `:1704` normal PASS/FAIL), so the two tiers disagree,
   and the comment at `:889` ("part of every mode's contract") is false for the pass case.
2. **The reader treats a missing artifact as a step failure, unconditionally.**
   `packages/app/src/workflow/actions/file-read-into-var.ts:58-61` returns
   `{ok:false, error:'file.read.into-var: file not found: …'}`. The remediate read in
   `config/workflows/task-pipeline.yaml:583-586` cannot declare the artifact optional, so the review
   lane inherits a dependency only the gate-red lane satisfies.
3. **The review lane hands the fixer no anchors.** The 1262 R6 projection
   (`task-pipeline.yaml:576-579`) appends the review answer to `<wbs>-test-gate.log`, but
   `--findings` is built from the findings file alone (`:597`). On the review lane that file is
   empty (deferred, after fix 1) or holds anchors scraped from a **green** full-tier log (noise).

**Refine corrections (2026-11-27)**

- "`quality-gate.test.ts:216` asserts `''` for a passing gate" → that test is a **red** gate whose log
  has no anchors (`gate('run', …)` with `exit 1`, `:205-219`) → re-pointed the full-tier evidence at
  `quality-gate.ts:1518,1704`.
- "the review contract emits `**P<n>-<m>` bullets; extract those" → only 11 of 236 local
  `.spur/run/*-review-answer.txt` carry `P<n>-<m>` ids; most findings are table rows with `path:line`
  evidence columns → (c) now extracts `path:line` anchors with the gate's own `FINDINGS_PATTERN`
  (`quality-gate.ts:113`), format-agnostic.
- "seed only when the findings file is missing or empty" → a green full-tier log can leave non-empty
  noise anchors → (c) overwrites unconditionally on the review lane.
- "regression goes in `task-pipeline-triage-routing.test.ts`, mirroring the gate-red case at `:208`" →
  that file is structural (onEnter shape) and `:208` is the failure-class decide shape → the behavioral
  regression goes in `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`, beside the
  review-lane projection test (`:335-361`) and the review→remediate edge test (`:478-480`).
- "`docs/04_DESIGN` owns the action table and must name the new option" → no doc documents
  `file.read.into-var` options (grep of `docs/04_DESIGN.md`, `docs/design/`); the action TSDoc
  (`file-read-into-var.ts:7-32`) is its contract → document the option there only.

### Requirements

- [ ] R1. `runDeferredGate` writes `<wbs>-test-gate.findings` on every outcome; on `DEFERRED` it holds `extractFindings(lightLog)` (empty when no anchor), never a log tail. The FAIL path is unchanged.
- [ ] R2. `file.read.into-var` accepts `missing: 'error' | 'empty'` (default `'error'`, today's behaviour); `'empty'` succeeds on an absent file with `''` projected into the var; any other value is a config error.
- [ ] R3. On the review lane (this run's `<runId>-gate.status` is `PASS` and `<runId>-review-answer.txt` exists), remediate rewrites `<wbs>-test-gate.findings` with the review answer's `path:line` anchors before the read, and the read uses `missing: empty`; the gate-red lane's findings file is untouched.
- [ ] R4. Regression coverage: deferred PASS artifact (R1), the option matrix (R2), and a behavioral green-gate → PARTIAL review → remediate route that yields non-empty `gateFindings` (R3).

**Out of scope:** changing the review answer format; parsing `P<n>-<m>` ids; any other optional-artifact read in the pipeline; `docs/04_DESIGN.md` (no action table exists).

### Acceptance Criteria

```gherkin
@core
Scenario: AC1 — A green deferred gate always leaves a findings artifact (req: R1)
  Given a task whose light tier passes so the deferred gate writes DEFERRED
  When the gate finishes
  Then .spur/run/<wbs>-test-gate.findings exists
  And its content is empty rather than the tail of a green log
  # layer: packages/app/tests/services/quality-gate*.test.ts (real runDeferredGate on a scratch dir)

@core
Scenario: AC2 — file.read.into-var can read an optional artifact (req: R2)
  Given a file.read.into-var action whose path does not exist
  When the action runs with missing: 'empty'
  Then it succeeds with an empty string projected into its var
  And the same action without the option still fails with 'file not found'
  And missing: 'bogus' fails naming the option
  # layer: packages/app/tests/workflow/actions/file-read-into-var.test.ts

@core
Scenario: AC3 — A PARTIAL review on a first-pass-green gate reaches remediate with real anchors (req: R3, R4)
  Given a run whose gate status is PASS, with no <wbs>-test-gate.findings, and whose review answer cites src/a.ts:12
  When remediate's onEnter shell actions run and its findings read executes
  Then the read succeeds and gateFindings contains src/a.ts:12
  And with gate status FAIL the same actions leave the gate's findings file byte-identical
  # layer: packages/app/tests/workflow/task-pipeline-proof-chain.test.ts (runSh on the real YAML commands)
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-27T20:19:26.519Z

- **Closed — anchor source for the review lane:** extract `path:line` with the gate's `FINDINGS_PATTERN` ERE, not `P<n>-<m>` ids (format-agnostic; ids appear in 11/236 answers).
- **Closed — overwrite vs fill-if-empty:** overwrite on the review lane; a green full-tier log can leave noise anchors.
- **Closed — doc surface:** no design doc lists `file.read.into-var` options; TSDoc is the contract, so no `docs/04_DESIGN.md` edit.

### Design

Three small, independently testable changes. No schema, config, CLI-surface or decision change.

**(a) Writer consistency — `runDeferredGate` (`quality-gate.ts:886-896`).** Keep the FAIL branch
byte-identical (`findings || tailLines(gateLog, 40)`); add an else branch writing
`extractFindings(gateLog)` for `DEFERRED`. Never `tailLines` on the pass path: an empty set must read
as empty. Fix the `:889` comment to match.

**(b) Reader option — `file.read.into-var`.** Frozen name: option `missing`, values `'error' | 'empty'`,
default `'error'`. Validate after `var` (`file-read-into-var.ts:53`): any other defined value →
`{ok:false, error:"file.read.into-var: missing must be 'error' or 'empty', got \"<v>\""}`. On
`stat === null` with `'empty'` → `{ok:true, data:{content:'', raw:'', var, path:resolved, size:0,
missing:true}, setVars:{[var]:''}}`. Document in the TSDoc option list (the action's only contract).

**(c) Review-lane anchors — one new `shell` action in remediate onEnter**, placed after the 1262 R6
projection (`task-pipeline.yaml:576-579`) and before the read:

```sh
[ "$(cat ".spur/run/$__runId-gate.status" 2>/dev/null)" = PASS ] && [ -f ".spur/run/$__runId-review-answer.txt" ] && { grep -oE '[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+' ".spur/run/$__runId-review-answer.txt" | sort -u | head -n 20 | tr '\n' ' ' > ".spur/run/$wbs-test-gate.findings"; }; exit 0
```

The ERE and the cap mirror `FINDINGS_PATTERN` / `MAX_FINDINGS` (`quality-gate.ts:71,113`; the
pattern's own comment says it mirrors the former `grep -oE`). A YAML comment names that coupling and
the AC3 test asserts parity on a fixture. Same lane predicate as the projection above it (the review
status file is no lane marker — `:571-575`). Its own action, not an append (ADR-115 cap). Then add
`missing: empty` to the read at `:583-586`.

**Anti-patterns.** No `softFail` on the read (hides a genuinely missing artifact elsewhere); no
`P<n>-<m>` parsing (format-dependent, 11/236 answers); no new CLI verb or `spur task gate` mode to
extract findings; no write from the `review → remediate` guard; no change to the gate-red lane.

**Files.** `packages/app/src/services/quality-gate.ts`, `packages/app/src/workflow/actions/file-read-into-var.ts`,
`config/workflows/task-pipeline.yaml` (then `bun run --filter @gobing-ai/spur build:bundle` to regenerate
`apps/cli/config/`), tests listed in AC. No dependents; no `dependencies[]`.

**Concurrency.** Worktree `spur-new-runall-1464-1472-aedfe887` touches none of these files (checked
2026-11-27); no `wip` tasks.

### Plan

0. Precondition: tree clean of other tasks' changes; `bun install` matches the lockfile.
1. AC1 test first in `packages/app/tests/services/quality-gate*.test.ts`: deferred tier with a passing light tier → findings file exists and is `''` (fails today).
2. (a) Add the DEFERRED write in `runDeferredGate`; fix the `:889` comment. FAIL branch untouched.
3. AC2 test matrix in `packages/app/tests/workflow/actions/file-read-into-var.test.ts`: absent/present × default/`error`/`empty`, plus an invalid value.
4. (b) Implement `missing` + TSDoc.
5. AC3 test in `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`: run the new remediate shell (`cmdOf('remediate', …)`) with gate PASS + answer citing `src/a.ts:12`, then the read through `FileReadIntoVarActionRunner` with the YAML's options → `gateFindings` contains the anchor; gate FAIL → findings file unchanged; assert the YAML ERE equals `FINDINGS_PATTERN.source`.
6. (c) Add the shell action and `missing: empty` in `config/workflows/task-pipeline.yaml`; `spur workflow validate config/workflows/task-pipeline.yaml --json`; `bun run --filter @gobing-ai/spur build:bundle`.
7. Focused: `(cd packages/app && bun test tests/services/quality-gate tests/workflow/actions/file-read-into-var.test.ts tests/workflow/task-pipeline-proof-chain.test.ts tests/workflow/composition-baseline.test.ts)`; then `bun run spur-check`.

### Root Cause

Verified 2026-11-27 against `f2fdcc354`: `quality-gate.ts:891-896` guards the findings write with
`if (status === 'FAIL')`, so a DEFERRED run leaves no file; `file-read-into-var.ts:58-61` fails on a
missing path with no opt-out; `task-pipeline.yaml:583-586` reads that file unconditionally in
remediate, which `review → remediate` reaches with a green gate (`task-pipeline-proof-chain.test.ts:478-480`).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
