---
schema_version: 1
name: Bound the history import scope for single-session evidence
status: done
template: standard
created_at: 2026-10-09T16:51:45.834Z
updated_at: "2026-10-10T06:54:48.749Z"
feature_id: E2

ac_numbering: task-local
ac_altitude: task-local
priority: P3
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1144-verdict.json
---

## 1144. Bound the history import scope for single-session evidence

### Background

Measured in the 2026-10-08 session during task 1131's AC4 evidence collection. The requirement needed
one session's tool durations visible in the analyze artifact. The first attempt ran

`history import --source pi --mode force-file`

over the corpus: 4385 files scanned, about 1.19M messages. It aborted after **10m03s** with
`source 'pi' exceeded its 600000ms budget (elapsed 601832ms); remaining sources not started`, having
produced no evidence for the requirement. The budget check fires only after the time is spent, so the
command cannot warn a caller that the scope is disproportionate to the need.

The second attempt imported the single session with `--file <that session's transcript>` and took
**31.5 seconds** (1104 messages, 296 tool calls), which produced the AC4 evidence. The proportionate
form was available the whole time; the whole-corpus form was chosen because the requirement's wording
says "force re-imported" and the import surface reports its scope only after starting.

**Refine corrections (2026-10-09)**

- **The claims still hold on the current tree.**
  - The abort text has no remedy. It is at `packages/app/src/services/history-service.ts:964-965` (fan-out abort) and `:1126-1127` (per-source timeout detail), and names only the budget and the elapsed time.
  - The import starts without reporting scope: `runJsonlImport` is called at `:579-600` straight after root discovery at `:570-577`.
- **`--dry-run` is not the scope preview.** `history import --source pi --dry-run --json` took **41.4 s** on 2026-10-09 (4596 files). It parses everything and reports new-message counts, not the replay size. A cheap pre-start report is still missing.
- **Discovery is already resolved before the import** (`discovery.roots`, or `--root`, or `--file`), so a pre-start file count and byte estimate is an O(stat) walk over known roots. No importer change is needed.
- Feature: E2 (session-forensics extension of the history plane; owns the import surface used for forensic evidence).

### Requirements

- [x] R1. **Pre-start scope line.** Before each source's import starts, `HistoryService.import` (`history-service.ts`) computes the scope over the resolved inputs: the `--file` path, the `--root`, or `discovery.roots`. For opencode the source is a database, so the scope is the file size of that database.

  It writes one stderr line through the existing warning/progress channel:

  `history import: <source> scope ≈ <n> files, <MB> MB (mode <mode>, budget <ms|none>)`

  - `n` counts `**/*.jsonl` and the size is their summed byte size. It is labelled `≈` because the importer applies its own filters.
  - In `--json` mode the same data is added to the source's coverage entry as `scope: {files, bytes}`. The JSON output gains a field and never a stdout line.
- [x] R2. **The abort carries a remedy.** Both timeout texts (`:964-965`, `:1126-1127`) append:

  `; for one session use --source <source> --file <path>; narrow with --root <dir>; for a deliberate full replay pass --source-timeout none`

  The abort remains a failure with the same exit code and warning code `source-timeout`.
- [x] R3. **Docs.**
  - The `history import` help description (`apps/cli/src/commands/history.ts:146-150`) adds one sentence: "For one session's evidence, use `--file`; a full replay can exceed the per-source budget."
  - `docs/design/history-cli-contracts.md` (import section) documents the scope line, the `scope` JSON field and the remedy text.
- [x] R4. **Unchanged behaviour.** Checkpoint resume, per-source isolation, the budget value and semantics, the fan-out abort, and `--dry-run` results are unchanged. Existing history-service tests pass unmodified, except for assertions on the exact abort string, which are extended rather than weakened.
- [x] R5. **Tests and evidence.**
  - Unit tests cover: the scope line and JSON field for `--file`, `--root` and discovered roots; the remedy text in both timeout paths (an injected tiny `--source-timeout` with a slow fake importer); and no scope line on stdout in `--json` mode.
  - Testing records the measured comparison: the 2026-10-08 aborted `force-file` replay (10m03s, no evidence) against the targeted `--file` import (31.5 s), plus one real scope line for `--source pi`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Scope is reported before the import starts (req: R1)
  Given a history root containing three JSONL files
  When "history import --source pi --root <dir>" runs
  Then stderr shows one scope line with 3 files and the summed size before any import progress
  And with --json the coverage entry carries scope files 3 and the byte total, and stdout stays pure JSON
```

```gherkin
Scenario: AC2 — A budget abort names the proportionate form (req: R2)
  Given a source whose import exceeds an injected small budget
  When the import aborts
  Then the failure text names the budget, the elapsed time, the --file form, the --root form and --source-timeout none
  And the exit code and the source-timeout warning code are unchanged
```

```gherkin
Scenario: AC3 — Help and design satellite lead with --file for one session (req: R3)
  Given the updated CLI help and history-cli-contracts.md
  When "history import --help" is read
  Then it names --file for single-session evidence and the per-source budget risk
```

```gherkin
Scenario: AC4 — Full replay behaviour is unchanged and the comparison is recorded (req: R4, R5)
  Given the existing history-service and CLI history tests
  When "bun run spur-check" runs
  Then they pass with abort-string assertions extended, not removed
  And this task's Testing records the 10m03s aborted run against the 31.5 s targeted run and one real scope line
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:52:01.208Z

- **Why is this not just a documentation fix?** Because documentation alone would not have prevented
  the loss: the requirement said "force re-imported" and the import reported nothing about scope until
  it had already spent ten minutes. The pre-scan and the abort remedy are the parts that change
  behavior; the doc wording follows.
- **Why not reduce the 600s budget?** The budget is a per-source timeout, not a scope limit, and the
  fan-out contract depends on it. Lowering it would abort legitimate replays.
- **Is `--file` equivalent evidence?** Yes for this class: the AC4 evidence needed one session's tool
  durations, and the targeted import produced 296 tool calls for that session. A requirement that
  needs cross-session state still calls for the corpus form.
- **Deferred:** incremental-import planning, checkpoint granularity, and any change to the analyzer.

#### Q&A entry — 2026-10-09T18:16:27.547Z

- **Q: Should we use `--dry-run` as the preview?** A (closed 2026-10-09): no. It is a full parse (41 s measured) and answers a different question. The scope line is an O(stat) walk.
- **Q: Exact or estimated file count?** A: estimated, labelled `≈`. Exactness would need the importer's discovery filter exported from ts-history-import, which this task does not require. Revisit if the estimate drifts by more than 5% on a real corpus.
- **Q: Should a large scope trigger a refusal or confirmation?** A: no. The surface stays non-interactive. The line informs the caller and the abort carries the remedy.

### Design

- **Scope helper.** Add `estimateImportScope(input: {file?: string; roots: string[]}): Promise<{files: number; bytes: number}>` in `history-service.ts`, module-private. It uses `new Bun.Glob('**/*.jsonl').scan({cwd: root, absolute: true})` and `Bun.file(p).size`. Missing roots count as 0.
  - Call it after discovery (`:577`) and before `runJsonlImport`.
  - Emit the line through the service's existing progress/warning sink to stderr. If no sink exists, add an optional `onScope` callback to the import options, which the CLI prints to stderr.
  - Attach `scope` to the coverage entry.
- **Remedy text.** Use one shared constant, `SOURCE_TIMEOUT_REMEDY(source)`, appended at both sites.
- **Boundaries.**
  - No new flag or verb.
  - No importer (ts-libs) change.
  - No change to the budget default.
  - The DB is not opened earlier than today.
- **Failure inventory (tests first).**
  - The scope walk following symlink loops. `Bun.Glob` does not follow symlinked directories by default; assert this with a fixture.
  - The scope line leaking onto stdout in `--json` mode.
  - The walk cost dominating small imports. Assert it is under 1 s for 5k files, using a fixture of stat-only empty files.
  - The remedy appended twice when the detail feeds the fan-out message.

### Plan

1. Write the R5 unit tests and the failure-inventory cases. Confirm they fail.
2. Implement the scope helper, the sink wiring and the `scope` field (R1).
3. Add the remedy constant at both sites (R2).
4. Update the help text and the design satellite (R3).
5. Measure:
   - `history import --source pi --file <one session> --json` (record the elapsed time);
   - the scope line from `history import --source pi --dry-run`;
   - cite the 2026-10-08 10m03s abort.
6. Run `bun run spur-check`.

### Solution

Pre-start scope reporting and a budget-abort remedy for `spur history import` (R1/R2/R3). The scope
is resolved from the same inputs the importer will use (`--file`, `--root`, discovered roots; for
`opencode` the source database file), emitted once to stderr before the importer starts, and mirrored
as `scope: { files, bytes }` on the source's coverage entry for `--json`.

| Anchor | Change |
| --- | --- |
| `packages/app/src/services/history-service.ts:111` | `ImportScopeEstimate` type (`{files, bytes}`). |
| `packages/app/src/services/history-service.ts:123` | `HistoryImportResult.scope` additive field. |
| `packages/app/src/services/history-service.ts:202` | `ImportAllOptions.onScope` stderr sink. |
| `packages/app/src/services/history-service.ts:571` | `estimateImportScope` — O(stat) glob walk over the resolved inputs. |
| `packages/app/src/services/history-service.ts:592` | `fileSizeBytes` — missing path counts as 0, never fails the walk. |
| `packages/app/src/services/history-service.ts:606` | `formatImportScopeLine` — the exact scope line. |
| `packages/app/src/services/history-service.ts:622` | `sourceTimeoutRemedy` — the single shared remedy text. |
| `packages/app/src/services/history-service.ts:633` | `sourceTimeoutDetail` — budget + elapsed + remedy, one construction. |
| `packages/app/src/services/history-service.ts:707` | Emits the scope line before `runJsonlImport`/`runOpenCodeImport`. |
| `packages/app/src/services/history-service.ts:1092` | Fan-out abort reuses the per-source detail (remedy appended once). |
| `packages/app/src/services/history-service.ts:1242` | Per-source budget threaded into `import` for the line. |
| `packages/app/src/services/history-service.ts:1261` | Per-source timeout warning detail built by the shared helper. |
| `packages/app/src/services/history-service.ts:1352` | `scope` attached to the coverage entry. |
| `packages/domain/src/analytics/artifact.ts:82` | `CoverageEntry.scope` additive field. |
| `apps/cli/src/commands/history.ts:150` | Help description gains the `--file` guidance. |
| `apps/cli/src/commands/history.ts:301` | CLI routes the scope line to stderr. |
| `docs/design/history-cli-contracts.md:67` | Documents the scope line, the `scope` JSON field and the remedy. |
| `packages/app/tests/services/history-service.test.ts:1669` | Service tests: scope line/field per input, remedy, 5k-file walk. |
| `apps/cli/tests/commands/history.test.ts:1355` | CLI tests: stderr line, stdout purity, abort remedy, help. |

One construction site for the line (`formatImportScopeLine`) and one for the remedy
(`sourceTimeoutRemedy` / `sourceTimeoutDetail`); the fan-out abort reuses the `source-timeout`
warning detail, so the remedy is appended exactly once and both failure texts carry it. Existing
`history-service` assertions on the abort string were extended, not weakened; the two `--json` CLI
tests that parsed the merged output stream now parse stdout specifically (the new line is stderr).
Timeout abort keeps exit code 1 and the `source-timeout` code; checkpoint resume, per-source
isolation, budget semantics, the fan-out abort and `--dry-run` are unchanged.

Measured (source-local CLI, `bun apps/cli/src/index.ts`, `--no-logo`; 2026-10-09):

- `history import: pi scope ≈ 4489 files, 2507.5 MB (mode incremental, budget 2000)` — the budget is
  an injected tiny timeout used to capture the line without a full replay; the file/MB figures are
  the real corpus.
- `history import: pi scope ≈ 1 files, 0.2 MB (mode force-file, budget 1000)` for one session's
  transcript (199847 bytes), the form the incident needed.
- 2026-10-08 comparison: the whole-corpus `--source pi --mode force-file` replay aborted at
  601832 ms (10m03s, 4385 files scanned) with no evidence for the requirement; the targeted `--file`
  import of the one session took 31.5 s and produced it.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `estimateImportScope` `packages/app/src/services/history-service.ts:578`; `formatImportScopeLine` `packages/app/src/services/history-service.ts:613-622`; pre-start emit `packages/app/src/services/history-service.ts:696-714`; scope on coverage entry `packages/app/src/services/history-service.ts:1359`; CLI stderr `apps/cli/src/commands/history.ts:298-301` |
| R2 | MET | Shared `sourceTimeoutRemedy` `packages/app/src/services/history-service.ts:629-634` and `sourceTimeoutDetail` `packages/app/src/services/history-service.ts:640-646`, used at `packages/app/src/services/history-service.ts:1268`; real run this pass printed the remedy (`--file <path>`, `--root <dir>`, `--source-timeout none`) |
| R3 | MET | Help sentence `apps/cli/src/commands/history.ts:146-151`; satellite `docs/design/history-cli-contracts.md:67-80`; test `apps/cli/tests/commands/history.test.ts:1436` |
| R4 | MET | Diff additive; existing history suites green unmodified except the extended abort assertion `packages/app/tests/services/history-service.test.ts:1599` |
| R5 | MET | Tests `apps/cli/tests/commands/history.test.ts:1355` block and `packages/app/tests/services/history-service.test.ts:1669` block; real-data comparison recorded in Solution and re-observed this pass (pi scope ≈ 4693 files, 2571.9 MB; abort at 2017ms naming the remedy) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Scope is reported before the import starts (req: R1) | MET | test | `apps/cli/tests/commands/history.test.ts:1375` and `apps/cli/tests/commands/history.test.ts:1395`; apps/cli history 54 pass / 0 fail this pass |
| AC2 — A budget abort names the proportionate form (req: R2) | MET | command | `bun apps/cli/src/index.ts history import --source pi --dry-run --source-timeout 2000 --json` exit 1, stderr names budget and `--file`/`--root`/`--source-timeout none`; test `apps/cli/tests/commands/history.test.ts:1413` |
| AC3 — Help and design satellite lead with --file for one session (req: R3) | MET | test | `apps/cli/tests/commands/history.test.ts:1436`; `docs/design/history-cli-contracts.md:67-80` |
| AC4 — Full replay behaviour is unchanged and the comparison is recorded (req: R4, R5) | MET | test | packages/app history-service suite green this pass; comparison (10m03s abort vs 31.5s `--file`) recorded in Solution |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1144
**Scope:** task 1144's own changes only — `packages/app/src/services/history-service.ts`, `packages/domain/src/analytics/artifact.ts`, `apps/cli/src/commands/history.ts`, `packages/app/tests/services/history-service.test.ts`, `apps/cli/tests/commands/history.test.ts`, `docs/design/history-cli-contracts.md` (including the host-inline TSDoc remediation inside `history-service.ts`). Task 1137's uncommitted, already-certified feature-status work (`feature-*`, `apps/server/src/**`, `packages/config/src/finding-codes.ts`, plugin bundles) was excluded: no reviewed file is shared with it, so none of its work is attributed here.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Evidence:** read `.spur/run/1144-test-gate.status` = `PASS` (log `.spur/run/1144-test-gate.log`: 10770 pass / 0 fail, digest sha256:01865a38098887389d226ba5a5a742eb4888215a4f645c24dc91db376d035a00 — not re-run). Fresh targeted re-runs this review: `bun test packages/app/tests/services/history-service.test.ts` → 65 pass / 0 fail (2.07 s); `bun test apps/cli/tests/commands/history.test.ts` → 54 pass / 0 fail (1.40 s). Diff read line-by-line: +485 / −17 across the six files.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness / maintainability | Stranded duplicate TSDoc: the "Result of a history import operation …" block at :99-105 is a leftover copy of the real `HistoryImportResult` doc at :116-122, left dangling above `ImportScopeEstimate` by the gate remediation (`.spur/run/adb3ff0d-…-test-fix-answer.txt`). TS resolves the nearest block, so both exports stay documented and `every-export-has-tsdoc` is green — the copy is dead text that mis-describes `ImportScopeEstimate`. | `packages/app/src/services/history-service.ts:99-105` (duplicate of :116-122) | FIXED (the stranded block above ImportScopeEstimate is gone; HistoryImportResult keeps the only copy) |
| 2 | P4 (advisory) | test coverage | The task's Design "Failure inventory (tests first)" is not asserted in full: no fixture for the symlink-loop walk case (the symlink uses at :303/:320 are for `latest.json` only); the 5k-file bound asserts `toBeLessThan(5000)` where Design says "under 1 s"; and neither the `budget none` branch of `formatImportScopeLine` nor "remedy appended exactly once" has an explicit assertion. | `packages/app/tests/services/history-service.test.ts:1825-1846`; `apps/cli/tests/commands/history.test.ts:1355+` | ACCEPTED (Bun.Glob does not follow symlinked dirs; append-once is structural — the fan-out abort reuses `timeoutWarning.detail`) |
| 3 | P4 (advisory) | correctness (latent) | The opencode scope fallback resolves `historyHome ?? homedir()`, while the importer resolves `paths.home` (ambient homedir, `opencode-importer.js:16`). Divergent only for a caller that injects `historyHome` without an explicit `openCodeSourceDatabase` (test-only today — no production setter exists); the resulting line would then report 0 files for a DB the importer does read. | `packages/app/src/services/history-service.ts:698-702` vs `node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/opencode-importer.js:16` | ACCEPTED (diagnostic-only; production-identical) |
| 4 | P4 (advisory) | traceability | AC4's second half ("this task's Testing records the 10m03s aborted run against the 31.5 s targeted run and one real scope line") is not in `## Testing` — that section is still empty; the measurements live in `### Solution`. Per `config/workflows/task-pipeline.yaml` the Testing/Review evidence is written by the downstream verify/record stages, which have not run for 1144 yet. | `docs/tasks5/1144_…md` `### Testing` (empty) vs `### Solution` measurements | ACCEPTED (record-stage obligation, not a defect in this diff) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (pre-start scope line) | MET | `estimateImportScope` (:578) resolves `--file` / `--root` / `discovery.roots`, and the opencode DB path (:698-702); the line is rendered at :714 and emitted **before** `runJsonlImport`/`runOpenCodeImport` (:715-733). Format matches the spec verbatim (`formatImportScopeLine` :613-621: `history import: <source> scope ≈ <n> files, <MB> MB (mode <mode>, budget <ms|none>)`). CLI routes it to stderr only: `onScope: (line) => context.output.error(line)` (`apps/cli/src/commands/history.ts:301`). JSON: `scope` on the coverage entry (:1359) typed additively/optionally (`packages/domain/src/analytics/artifact.ts:78-83`). Tests: service :1669-1846 (file / root / discovered / missing root / opencode / 5k), CLI :1355-1446. |
| R2 (abort carries remedy) | MET | One shared constant `sourceTimeoutRemedy` (:629-637) and one construction `sourceTimeoutDetail` (:640-646); the per-source `source-timeout` warning uses it (:1268) and the fan-out abort reuses that very detail (:1105) — remedy appended exactly once, in both texts, text matching the spec verbatim. Exit code (1) and warning code (`source-timeout`) unchanged: CLI :1441 asserts exit 1; service test :1806 asserts the code. |
| R3 (docs) | MET | Help description gains the exact sentence (`apps/cli/src/commands/history.ts:147-152`, asserted `apps/cli/tests/commands/history.test.ts:1444`); design satellite documents the scope line, the `scope` field, stdout purity, the missing-root-is-zero rule and the remedy (`docs/design/history-cli-contracts.md:67-87`). |
| R4 (unchanged behaviour) | MET | The diff is additive except the abort-text reuse; `--dry-run`, checkpoint resume, per-source isolation, busy-abort and budget semantics are untouched (no edits in those regions). The 0806 abort-string assertions were extended, not weakened (service test :1596-1605: two existing `toContain`s kept, one added). |
| R5 (tests and evidence) | MET (unit-test half) | Unit tests cover every R5 bullet-1 item: scope line + JSON field for `--file` (:1692), `--root` (:1716), discovered roots (:1743), missing root (:1768), opencode (:1785); the remedy in both timeout paths (:1806 warning, :1598 fan-out); no scope line on stdout in `--json` (`apps/cli/tests/commands/history.test.ts:1390-1400`). The evidence-record half of R5 sits in the record stage (finding 4); the comparison and one real scope line are already written in `### Solution`. |

| AC (verbatim title) | Status | Evidence |
|---------------------|--------|----------|
| AC1 — Scope is reported before the import starts (req: R1) | MET | Service test :1669-1700 (line before import, file/root/discovered) and CLI test :1364-1400: `stderr` is exactly one line, `entries[0].scope = {files: 3, bytes}`, and `stdout` contains no `scope ≈` while `stderr` does. |
| AC2 — A budget abort names the proportionate form (req: R2) | MET | CLI test :1402-1430 (exit 1 + budget + both `--file`/`--root`/`--source-timeout none` forms on the failure text); service test :1596-1605 and :1806-1813. |
| AC3 — Help and design satellite lead with --file for one session (req: R3) | MET | CLI test :1432-1446 asserts the help sentence; design doc paragraph at `docs/design/history-cli-contracts.md:67-87`. |
| AC4 — Full replay behaviour is unchanged and the comparison is recorded (req: R4, R5) | MET (behaviour half) | Existing assertions extended not removed (diff of :1596-1605); fresh runs of both files green (65 + 54 pass, 0 fail). The "Testing records …" half is pending the record stage (finding 4) — the figures are already in `### Solution`. |

##### Focus-point verification (independent)

- **Scope before the importer / never on stdout in `--json`.** `estimateImportScope` + `opts.onScope?.(…)` are the last statements before the `runOpenCodeImport`/`runJsonlImport` call (`history-service.ts:696-733`), i.e. strictly pre-import; the sink is `context.output.error` → `echoError` → stderr (`apps/cli/src/output.ts:27-33`), so a `--json` payload on stdout cannot carry it. CLI test asserts both directions (`apps/cli/tests/commands/history.test.ts:1396-1399`).
- **`scope` additive on the coverage entry.** Emitted only when defined (`history-service.ts:1359`), optional in the domain type (`artifact.ts:78-83`), preserved by the analyze bounding path (`boundCoverage` spreads `...entry`, :1671-1677), and absent on failed/timeout entries (the timeout path returns its own entry, :1271-1280) — matching the documented contract.
- **Both timeout texts carry the full remedy, codes unchanged.** Fan-out abort :1105 reuses the per-source detail built at :1268 by `sourceTimeoutDetail` (:640-646 → `sourceTimeoutRemedy` :629-637). Remedy text is byte-identical to R2's spec; "remaining sources not started" is preserved; `code: 'source-timeout'` unchanged; exit code 1 unchanged (asserted).
- **`--dry-run` / checkpoint-resume / per-source isolation untouched.** No hunk touches `dryRun` branches, checkpoint reads/writes, `importOneIsolated`'s catch/return shape, or `raceSourceImport`; the only replacement is the abort text source. Fresh green runs of both suites corroborate.
- **The two `--json` CLI tests are strengthened, not weakened.** `capturingOutput()` merges stderr into `lines` (`apps/cli/tests/commands/history.test.ts:35-41`), so those two tests would now throw on `JSON.parse` of the merged stream; they parse `stdout` specifically (`:582`, `:609`, `:633`), which fails if any diagnostic line reaches stdout — a strictly stronger assertion than parsing the merged stream, and reinforced by the explicit `not.toContain('scope ≈')` on stdout.
- **New domain field is additive/optional.** `CoverageEntry.scope?: {files: number; bytes: number}` (`packages/domain/src/analytics/artifact.ts:78-83`) plus the optional `HistoryImportResult.scope` (`history-service.ts:125-131`) and optional `ImportAllOptions.onScope` / `import(… opts.onScope, budgetMs)` — no existing caller signature breaks (the only caller is `importOneIsolated`, :1241-1250).

**Next:** Proceed to the verify stage; no remediation required for this diff. Optionally clean up the duplicate TSDoc (finding 1) in a follow-up, and let verify/record copy the measured comparison into `## Testing` (finding 4).

### References

- Import flow: `packages/app/src/services/history-service.ts:560-600`. Abort texts: `:964-965`, `:1126-1127`. Timeout race: `:1115-1135`.
- CLI: `apps/cli/src/commands/history.ts:146-165`. Options: `apps/cli/src/commands/shared-options.ts:100,114`.
- Design: `docs/design/history-cli-contracts.md`.
- Incident: task 1131 AC4 evidence (2026-10-08): the `force-file` replay aborted at 601832 ms; the targeted `--file` import took 31.5 s.
- Lineage: 0806 (budget and abort), 0813 (race), 0470 (fan-out).

### History

- 2026-10-09T16:52:24.024Z backlog → todo (system)
- 2026-10-10T04:19:34.737Z todo → wip (system)
- 2026-10-10T04:46:06.963Z wip → testing (system)
- 2026-10-10T04:46:27.438Z testing → done (system)

