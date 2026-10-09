---
schema_version: 1
name: Bound the history import scope for single-session evidence
status: todo
template: standard
created_at: 2026-10-09T16:51:45.834Z
updated_at: "2026-10-09T18:16:28.715Z"
feature_id: E2

ac_numbering: task-local
ac_altitude: task-local
priority: P3
estimate_hours: 4
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

- [ ] R1. **Pre-start scope line.** Before each source's import starts, `HistoryService.import` (`history-service.ts`) computes the scope over the resolved inputs: the `--file` path, the `--root`, or `discovery.roots`. For opencode the source is a database, so the scope is the file size of that database.

  It writes one stderr line through the existing warning/progress channel:

  `history import: <source> scope ≈ <n> files, <MB> MB (mode <mode>, budget <ms|none>)`

  - `n` counts `**/*.jsonl` and the size is their summed byte size. It is labelled `≈` because the importer applies its own filters.
  - In `--json` mode the same data is added to the source's coverage entry as `scope: {files, bytes}`. The JSON output gains a field and never a stdout line.
- [ ] R2. **The abort carries a remedy.** Both timeout texts (`:964-965`, `:1126-1127`) append:

  `; for one session use --source <source> --file <path>; narrow with --root <dir>; for a deliberate full replay pass --source-timeout none`

  The abort remains a failure with the same exit code and warning code `source-timeout`.
- [ ] R3. **Docs.**
  - The `history import` help description (`apps/cli/src/commands/history.ts:146-150`) adds one sentence: "For one session's evidence, use `--file`; a full replay can exceed the per-source budget."
  - `docs/design/history-cli-contracts.md` (import section) documents the scope line, the `scope` JSON field and the remedy text.
- [ ] R4. **Unchanged behaviour.** Checkpoint resume, per-source isolation, the budget value and semantics, the fan-out abort, and `--dry-run` results are unchanged. Existing history-service tests pass unmodified, except for assertions on the exact abort string, which are extended rather than weakened.
- [ ] R5. **Tests and evidence.**
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Import flow: `packages/app/src/services/history-service.ts:560-600`. Abort texts: `:964-965`, `:1126-1127`. Timeout race: `:1115-1135`.
- CLI: `apps/cli/src/commands/history.ts:146-165`. Options: `apps/cli/src/commands/shared-options.ts:100,114`.
- Design: `docs/design/history-cli-contracts.md`.
- Incident: task 1131 AC4 evidence (2026-10-08): the `force-file` replay aborted at 601832 ms; the targeted `--file` import took 31.5 s.
- Lineage: 0806 (budget and abort), 0813 (race), 0470 (fan-out).

### History

- 2026-10-09T16:52:24.024Z backlog → todo (system)

