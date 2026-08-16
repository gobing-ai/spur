---
template: feature-impl
schema_version: 1
name: "dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)"
description: ""
status: todo
type: task
profile: standard
feature_id: I5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T16:38:40.715Z"
updated_at: "2026-08-16T18:50:05.236Z"
---

## 0569. dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)

### Background
Verify re-audit of 0567 (done, --force, 2026-08-16) surfaced one design-level finding: the command aborts a bare `--source all` run whenever any source is degraded (import exit 2), which is permanent on machines hosting a source with corrupt transcript chunks (agy here: 203 parse errors in Antigravity's own log chunks — unfixable by this project). The operator reviewed the evidence and chose to KEEP the fail-hard behavior for now, with the `--source` workaround documented in the command (dev-history-load.md Usage note). This task is the deferred alternative, to be picked up only if the workaround proves noisy in practice.

House precedent that motivates it: `packages/app/src/services/history-refresh-service.ts:130-136` — the daily pipeline treats a degraded fan-out as non-fatal ("the other sources still import and the failure is reported per source (never an abort)"), emits `history.daily.failed`, and continues to analyze.

Proposed behavior if adopted: import exit 2 (mixed/degraded) proceeds to analyze with a loud per-source degradation warning in human and JSON output (a `warnings` field); exit 1 (all-failed) keeps the R9 abort-with-propagation. Requires: script change in `plugins/sp/scripts/history-load.ts`, command doc update, new unit tests in `plugins/sp/tests/history-load.test.ts` (degraded-proceeds, all-failed-aborts), and a feature scenario amendment for I5 R9 to pin the fatal-vs-degraded split explicitly.
### Requirements
- [ ] R1. In `plugins/sp/scripts/history-load.ts`, split import-failure handling by exit code: exit 1 (all sources failed) keeps the current abort — surface failing sources, skip analyze, propagate the child's exit code. Exit 2 (mixed/degraded) proceeds to analyze, emitting a loud per-source degradation warning on stderr (human mode) and a `warnings` array in the JSON payload naming each degraded/failed source, its parse/validation error counts, and the warning detail from the import JSON.
- [ ] R2. Extend `plugins/sp/tests/history-load.test.ts` with stub coverage for the split: exit 2 with a degraded source proceeds to analyze, exits 0 after a successful analyze, and surfaces the warning in both output modes; exit 1 (all-failed) still aborts before analyze and propagates 1.
- [ ] R3. Update `plugins/sp/commands/dev-history-load.md`: replace the "Fail-hard on a degraded source (deliberate)" Usage note with the tolerate-and-warn contract, and amend feature I5 scenario R9 (Acceptance Criteria) so the fatal-vs-degraded split is pinned explicitly — R9's precondition becomes "the import step reports all sources failed (exit 1)" and a new scenario covers exit 2 proceeding with a warning.
### Acceptance Criteria
```gherkin
Scenario: R1 — A degraded fan-out proceeds to analyze with a loud warning
  Given `spur history import` exits 2 with at least one source degraded but records imported
  When the operator runs `/sp:dev-history-load`
  Then the analyze step still runs
  And stderr (or the JSON `warnings` array) names each degraded source with its error counts
  And the command exits 0 when analyze succeeds

Scenario: R2 — A fully failed import still aborts with propagation
  Given `spur history import` exits 1 with all sources failed
  When the operator runs `/sp:dev-history-load`
  Then the analyze step is not run
  And the command exits 1
  And the output names the failing sources

Scenario: R3 — The command doc and feature scenario R9 pin the split
  Given the tolerance behavior ships
  When a reader checks `dev-history-load.md` and feature I5's Acceptance Criteria
  Then the Usage note describes tolerate-and-warn for exit 2
  And scenario R9's precondition names the fatal (exit 1) case explicitly
```
### Q&A
- **Why tolerate exit 2 but keep exit 1 fatal?** Exit 1 means every source failed — there is nothing to analyze; aborting avoids a confusing downstream empty-window error. Exit 2 means per-source isolation already worked: records imported from healthy sources; the degraded remainder is reported, not hidden. Matches the daily pipeline precedent (`history-refresh-service.ts`).
- **Why no opt-in flag?** The flag surface is frozen by the command contract; tolerance is the behavior, not a mode. An opt-in would leave the noisy default in place, defeating the purpose.
- **Why only warn in the payload when non-empty?** Keeps the clean-run JSON contract byte-identical for existing consumers; the warnings field's presence itself signals degradation.
- **Deferred from 0567 re-audit (2026-08-16):** the operator chose to keep fail-hard with a documented `--source` workaround; this task ships only if the workaround proves noisy. Premises re-verified against the current tree during refine (exit-code semantics `computeExitCode` at `packages/app/src/services/history-service.ts:973`, abort seam `history-load.ts:191-214`, entry counts at `apps/cli/src/commands/history.ts:324`).
### Design
## WHAT

Split the single non-zero-import abort in `plugins/sp/scripts/history-load.ts` (step 2, lines 191–214) by exit code. Exit 2 (mixed/degraded fan-out) proceeds to analyze with a loud per-source warning; exit 1 (all sources failed) and any other non-zero exit keep the current abort-with-propagation.

## WHY

House precedent (`packages/app/src/services/history-refresh-service.ts` `handleHistoryRefreshJob` doc comment): the daily pipeline treats a degraded fan-out as non-fatal — other sources still import, failure is reported per source, never an abort. A bare `/sp:dev-history-load` run on a machine with a steady-state degraded source (e.g. corrupt transcript chunks in a tool's own logs) currently can never proceed; per-source isolation already did its job upstream, so aborting here adds no safety, only noise.

Exit-code semantics are owned by `computeExitCode` (`packages/app/src/services/history-service.ts:973`): `0` clean, `1` **every** source failed, `2` mixed or any source `degraded` (records imported with skipped parse/validation errors). This task consumes that contract; it does not change it.

## WHERE

- `plugins/sp/scripts/history-load.ts` — the only code change.
- `plugins/sp/tests/history-load.test.ts` — stub-script tests (existing `writeStub` + `SPUR_BIN=/bin/sh <stub>` pattern).
- `plugins/sp/commands/dev-history-load.md` — Usage note replacement.
- Feature I5 Acceptance Criteria — R9 amendment + one new scenario (feature files have no `--section` verb; edit the file directly, then `spur feature check I5`).

## Frozen names

- Extend the script-local `ImportJson` entries type with `parseErrors?: number; validationErrors?: number` (real `CoverageEntry` already carries them — see the CLI renderer at `apps/cli/src/commands/history.ts:324`).
- New helper `buildDegradedWarnings(imp: ImportJson): DegradedWarning[]` where `DegradedWarning = { source: string; status: string; parseErrors: number; validationErrors: number; detail?: string }`. Entries selected by `status !== 'ok' && status !== 'empty'`; counts default to 0 when absent; `detail` from the matching `warnings[]` entry (`code === 'source-degraded' || 'source-failed'`) when present.
- JSON payload: add a top-level `warnings: DegradedWarning[]` field on the success/`dry-run` payloads **only when non-empty** (omitted otherwise — keeps the clean-run contract byte-identical).
- Human mode: one stderr block printed immediately after a degraded import, before analyze runs:
  `WARNING: degraded import — proceeding to analyze` followed by one line per source: `<source>: <status> (<parseErrors+validationErrors> parse/validation errors)` — the same rendering the CLI itself uses (`history.ts:324`), so both surfaces speak one language.
- Process exit on the tolerated path stays `0` (or analyze/report's own non-zero on later failure — unchanged).

## Precedence / algorithm

1. Run import (unchanged argv). Parse `imp` as today.
2. `status === 2` → compute `degraded = buildDegradedWarnings(imp)`; human mode prints the stderr block now; continue. `status !== 0` otherwise (1 or any unexpected code) → existing abort branch verbatim (surface failing sources, skip analyze, propagate the child's exit code).
3. Dry-run, analyze, empty-window guard, report, final emit — unchanged except the final JSON payload gains `warnings` when non-empty.

## Anti-patterns (do NOT implement)

- No `--tolerate-degraded` / `--force` flag — the flag surface is frozen; tolerance is the behavior, not an option.
- No change to `computeExitCode`, `HistoryService`, or anything under `packages/app` — exit-code semantics stay upstream.
- Do not treat exit 1 as tolerable, and do not broaden tolerance to "any non-zero" — only `2` is a defined degraded signal.
- No parsing of child-process prose — warnings derive from parsed import JSON only.
- Do not warn-and-succeed silently in JSON mode: the `warnings` array is mandatory on the tolerated path when degradation exists.

## Non-goals

- Fixing the degraded source itself (e.g. agy transcript corruption is upstream's problem).
- Changing `spur history daily` / refresh-service behavior (already tolerant).
- Retry, quarantine, or repair logic for corrupt chunks.

## Handoff

No `dependencies[]`; no downstream task owns a piece of this. Feature I5 R9 amendment lands in the same commit (T3 surface rule analog: doc + scenario with the code).
### Plan
1. **R1 — script:** In `plugins/sp/scripts/history-load.ts`, extend the `ImportJson` entries type with `parseErrors?` / `validationErrors?`, add `buildDegradedWarnings`, and split step 2: `status === 2` → warn (stderr block in human mode) and continue; any other non-zero → existing abort verbatim. Thread the warnings list into the final JSON payload (`warnings` field, only when non-empty; also on the `dry-run` payload for consistency).
2. **R2 — tests:** Extend the stub env in `plugins/sp/tests/history-load.test.ts` with two cases:
   - import exits 2 with entries `[{source:'agy', status:'degraded', messages:10, parseErrors:203, validationErrors:0}, {source:'pi', status:'ok', messages:5}]` + a `source-degraded` warning, analyze exits 0 → script exits 0; JSON run: payload `warnings` names `agy` with its counts; human run: stderr names `agy`.
   - import exits 1 (all sources `failed`) → analyze is never invoked (assert via the stub's calls log), script exits 1, failing sources named.
3. **R3 — docs + feature:** Replace the "Fail-hard on a degraded source (deliberate)" Usage note in `plugins/sp/commands/dev-history-load.md` with the tolerate-and-warn contract (exit 2 proceeds with warning; exit 1 aborts; single-source `--source <name>` remains the way to scope around a known-degraded source). Amend feature I5 scenario R9: precondition becomes "the import step reports all sources failed (exit 1)"; add a new scenario R11 covering exit 2 proceeding with a warning and exiting 0 on successful analyze. Run `spur feature check I5 --json` to confirm the amendment parses.
4. **Verify:** `bun test plugins/sp/tests/history-load.test.ts` green; manual smoke `bun plugins/sp/scripts/history-load.ts --dry-run --json` clean-run payload unchanged (no `warnings` field).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
