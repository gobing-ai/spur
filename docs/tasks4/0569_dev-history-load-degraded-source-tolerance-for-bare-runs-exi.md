---
template: feature-impl
schema_version: 1
name: "dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)"
description: ""
status: done
type: task
profile: standard
feature_id: I5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T16:38:40.715Z"
updated_at: "2026-08-17T00:11:13.803Z"
---

## 0569. dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)

### Background
Verify re-audit of 0567 (done, --force, 2026-08-16) surfaced one design-level finding: the command aborts a bare `--source all` run whenever any source is degraded (import exit 2), which is permanent on machines hosting a source with corrupt transcript chunks (agy here: 203 parse errors in Antigravity's own log chunks — unfixable by this project). The operator reviewed the evidence and chose to KEEP the fail-hard behavior for now, with the `--source` workaround documented in the command (dev-history-load.md Usage note). This task is the deferred alternative, to be picked up only if the workaround proves noisy in practice.

House precedent that motivates it: `packages/app/src/services/history-refresh-service.ts:130-136` — the daily pipeline treats a degraded fan-out as non-fatal ("the other sources still import and the failure is reported per source (never an abort)"), emits `history.daily.failed`, and continues to analyze.

Proposed behavior if adopted: import exit 2 (mixed/degraded) proceeds to analyze with a loud per-source degradation warning in human and JSON output (a `warnings` field); exit 1 (all-failed) keeps the R9 abort-with-propagation. Requires: script change in `plugins/sp/scripts/history-load.ts`, command doc update, new unit tests in `plugins/sp/tests/history-load.test.ts` (degraded-proceeds, all-failed-aborts), and a feature scenario amendment for I5 R9 to pin the fatal-vs-degraded split explicitly.
### Requirements
- [x] R1. In `plugins/sp/scripts/history-load.ts`, split import-failure handling by exit code: exit 1 (all sources failed) keeps the current abort — surface failing sources, skip analyze, propagate the child's exit code. Exit 2 (mixed/degraded) proceeds to analyze, emitting a loud per-source degradation warning on stderr (human mode) and a `warnings` array in the JSON payload naming each degraded/failed source, its parse/validation error counts, and the warning detail from the import JSON.
- [x] R2. Extend `plugins/sp/tests/history-load.test.ts` with stub coverage for the split: exit 2 with a degraded source proceeds to analyze, exits 0 after a successful analyze, and surfaces the warning in both output modes; exit 1 (all-failed) still aborts before analyze and propagates 1.
- [x] R3. Update `plugins/sp/commands/dev-history-load.md`: replace the "Fail-hard on a degraded source (deliberate)" Usage note with the tolerate-and-warn contract, and amend feature I5 scenario R9 (Acceptance Criteria) so the fatal-vs-degraded split is pinned explicitly — R9's precondition becomes "the import step reports all sources failed (exit 1)" and a new scenario covers exit 2 proceeding with a warning.
### Acceptance Criteria
```gherkin
Scenario: R1 — A degraded fan-out proceeds to analyze with a loud warning
  Given `spur history import` exits 2 with at least one source degraded but records imported
  When the operator runs `/sp:dev-history-load`
  Then the analyze step still runs
  And stderr (or the JSON `warnings` array) names each degraded source with its error counts
  And the command exits 0 when analyze succeeds

Scenario: R2 — A fully failed import aborts before analyze and propagates the exit code
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
**Implemented 2026-08-16 (implement stage, native-subagent dispatch).** `history-load.ts` now splits import-failure handling by fan-out exit code: exit 1 (all failed) keeps the abort-before-analyze contract; exit 2 (mixed/degraded) proceeds to analyze with a loud per-source warning. Clean fan-outs are byte-identical to before (no `warnings` field).

Change map:

- `plugins/sp/scripts/history-load.ts:186` — `ImportJson` entry type extended with `parseErrors?: number` / `validationErrors?: number` (counts, matching `CoverageEntry` in history-service).
- `plugins/sp/scripts/history-load.ts:198` — `DegradedWarning` shape + `buildDegradedWarnings(imp)` (one entry per degraded/failed source: source, status, parseErrors, validationErrors, and the import step's `source-degraded`/`source-failed` detail) + `withWarnings(payload, degraded)` (adds `warnings` only when non-empty).
- `plugins/sp/scripts/history-load.ts:237` — step 2 abort narrowed to `status !== 0 && status !== 2`; step 2b (new): exit 2 → build warnings, human mode prints the stderr block (`WARNING: import fan-out degraded — proceeding with the healthy sources:` + per-source line with counts), then falls through to analyze.
- `plugins/sp/scripts/history-load.ts:279` + `:397` — `warnings` threaded into the `--json` dry-run payload and the final ok payload via `withWarnings` (absent on clean runs). File header doc updated (analyze proceeds after exit 0 or 2).
- `plugins/sp/tests/history-load.test.ts:46` — stub now branches import by exit code: 1 → single failed codex entry (abort fixture), 2 → degraded fan-out fixture (`agy` degraded messages=10 parseErrors=203 + `pi` ok + `source-degraded` warning), 0 → clean.
- `plugins/sp/tests/history-load.test.ts:96` — explicit exit-1 bare-run test (analyze never invoked, exit 1 propagates, codex named); `:168` new describe "degraded fan-out tolerance (0569 R1/R2)": JSON mode (exit 0, analyze ran, single-object contract intact, `warnings[0]` = agy/203/0/detail, stderr empty), human mode (stderr names agy + counts), clean-run payload has no `warnings` key.
- `plugins/sp/commands/dev-history-load.md:59` — fail-hard Usage note replaced with the tolerate-and-warn contract (exit 1 aborts; exit 2 proceeds with stderr warning naming counts; `--json` carries `warnings`; `--source <name>` for deliberate scoping).
- `docs/features/I5…md` (via `spur feature update I5 --section`) — R9 precondition pinned to "all sources failed (exit 1)"; new scenario R11 covers exit 2 proceeding to analyze with the warning + `warnings` payload.
### Testing
**Verify re-audit 2026-08-17 (`/sp:dev-verify 0569 --auto --next --force --focus all --fix all`).** Every
`file:line` below was re-read at the cited lines this run; every command was re-run this run.

- Verdict: **PASS**
- `bun test plugins/sp/tests/history-load.test.ts` → **12 pass, 0 fail, 59 expect()** (re-run this audit)
- `spur task check 0569 --strict-core` → **PASS** (1 residual advisory WARN, below)
- `spur feature check I5 --json` → `pass: true`

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — split import-failure handling by exit code (1 aborts, 2 tolerates + warns) | MET | `plugins/sp/scripts/history-load.ts:234` abort narrowed to `if (importResult.status !== 0 && importResult.status !== 2)` — exit 1 and any other non-zero abort verbatim (failing sources + detail, analyze skipped, `process.exit(importResult.status)`); `:184` `DegradedWarning` (source/status/parseErrors/validationErrors/detail); `:197` `buildDegradedWarnings`; `:212` `withWarnings` (attaches only when non-empty); `:257` exit-2 branch; `:259-264` human-mode stderr block; `:276` dry-run payload and `:382` final ok payload threaded through `withWarnings`. Exit-code contract confirmed at the owner `packages/app/src/services/history-service.ts:980` `computeExitCode` (0 clean / 1 every source failed / 2 mixed-or-degraded) — unchanged by this task. **Live probe this run** (`SPUR_BIN="bun run apps/cli/src/index.ts" bun plugins/sp/scripts/history-load.ts --dry-run --json`): real exit-2 fan-out on this machine (`agy` degraded, 104 parse errors) → no abort, exit 0, payload `warnings[0] = {source:"agy",status:"degraded",parseErrors:104,validationErrors:0,detail:"source 'agy' imported 0 records but skipped 104 parse and 0 validation error(s)…"}`, stderr empty in `--json` mode; the same probe without `--json` printed `WARNING: import fan-out degraded — proceeding with the healthy sources:` + `agy: status=degraded parseErrors=104 validationErrors=0 — …`. |
| R2 — stub coverage for the split | MET | `plugins/sp/tests/history-load.test.ts:224` describe `degraded fan-out tolerance (0569 R1/R2)`: `:233` exit 2 → `history analyze` present in the calls log, exit 0, stdout exactly one JSON object, `warnings[0]` = agy/degraded/203/0/detail, `stderr === ''`; `:261` exit 2 human mode → stderr contains `degraded`, `agy`, `203`, `validationErrors=0`; `:271` clean fan-out → `warnings` key absent. Exit-1 abort: `:157` bare run (`analyze` never in the calls log, exit 1 propagates, `codex` named) plus the pre-existing `:150` `--source codex` abort. Stub fixture branches by exit code at `:39-46`. `bun test plugins/sp/tests/history-load.test.ts` → 12 pass / 0 fail this run. |
| R3 — command doc + feature I5 R9 pin the split | MET | `plugins/sp/commands/dev-history-load.md:47-56` — the "Fail-hard on a degraded source (deliberate)" note is gone, replaced by "Degraded sources proceed with a warning; fully-failed imports abort (0569)" stating exit 1 aborts + propagates, exit 2 proceeds to analyze with a per-source stderr warning naming parse/validation counts, `--json` carries `warnings`, `--source <name>` remains for deliberate scoping. `docs/features/I5_dev-history-load-command-on-demand-cumulative-import-analyze.md:116` scenario R9 retitled "A fully failed import aborts before analyze and propagates the exit code" with precondition `:117` "Given the import step reports all sources failed (exit 1)"; `:124` new `@edge` scenario R11 covers exit 2 → analyze runs, exit 0, per-source warning, `--json` `warnings` array. `spur feature check I5 --json` → `pass: true`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — A degraded fan-out proceeds to analyze with a loud warning | MET | test + command | `plugins/sp/tests/history-load.test.ts:233` (JSON mode: analyze invoked, exit 0, `warnings` names the degraded source with counts) and `:261` (human mode stderr). Live: real exit-2 fan-out this run → exit 0, `warnings[0]` = agy/104/0, human stderr block printed. |
| R2 — A fully failed import aborts before analyze and propagates the exit code | MET | test | `plugins/sp/tests/history-load.test.ts:157` — `importExit: '1'` bare run: `calls.some(c => c.startsWith('history analyze'))` is `false`, `exitCode` is 1, stderr names `codex`; `:150` same for `--source codex`. Code path unchanged for exit 1 at `plugins/sp/scripts/history-load.ts:234-253`. |
| R3 — The command doc and feature scenario R9 pin the split | MET | command | `plugins/sp/commands/dev-history-load.md:47` tolerate-and-warn note; `docs/features/I5_…md:117` R9 precondition "(exit 1)"; `:124` R11 for exit 2. `spur feature check I5 --json` exit 0, `pass: true`. |

**Design conformance** — 3 claims DONE, 1 CHANGED, 0 NOT DONE.

| Claim | Status | Note |
|-------|--------|------|
| Abort narrowed to exit ≠ 0 and ≠ 2; step 2b tolerates exit 2 | DONE | `plugins/sp/scripts/history-load.ts:234`, `:255-266` |
| `withWarnings` adds `warnings` only when non-empty; clean payload unchanged | DONE | `plugins/sp/scripts/history-load.ts:212`; asserted by `plugins/sp/tests/history-load.test.ts:271` |
| No flag added, no change to `computeExitCode`/`packages/app` | DONE | diff touches only `plugins/sp/**` (script, test, command doc) + `docs/features/I5…` |
| `buildDegradedWarnings` selects entries by `status !== 'ok' && status !== 'empty'`; `detail?` optional, matched by warning `code` | CHANGED | Implemented as `status === 'degraded' \|\| status === 'failed'` with a required `detail` matched by `w.source` and a `'no warning detail reported by import'` fallback (`:197-211`). Behaviourally identical over the real status domain — `packages/app/src/services/history-service.ts:519`, `:562`, `:722` emit exactly `ok \| empty \| degraded \| failed` — and the required-`detail` shape is strictly stronger than the design's optional one. No downgrade. |

**SECUA Review** (`--focus all`)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 (advisory) | Correctness | `plugins/sp/scripts/history-load.ts:255-257` | Silent-degradation edge carried over from the review stage: an import child that exits 2 with unparseable stdout yields `degraded = []` — no warning on either surface, and the final ok payload's `imp ?? { entries: [], exitCode: 0 }` fallback (`:384`) reports `exitCode: 0` while the child exited 2. Unreachable with the real CLI, which always emits coverage JSON on the `computeExitCode` path. Note only. |
| P4 (advisory) | Traceability | task AC ↔ feature I5 | One residual DD-09 subset WARN: task scenario "R3 — The command doc and feature scenario R9 pin the split" has no feature I5 counterpart. Correct as-is — R3 is a doc-sync scenario, not a product AC; promoting it to the feature would add a scenario no runtime behaviour can satisfy. |
| P4 (advisory) | Documentation | `### Design` / `### Solution` line anchors | Design cites history-service line 973 and history-load lines 191–214; Solution cites history-load lines 186/198/237/279/397. Both drifted 2–15 lines against the final file — the real anchors are `packages/app/src/services/history-service.ts:980` (`computeExitCode`) and, in `plugins/sp/scripts/history-load.ts`, `:184`/`:197`/`:212` (helpers), `:234` (abort), `:276`/`:382` (payloads). Pre-implementation and post-implementation snapshots respectively; the traceability and AC anchors above are the current, re-read set. |

No P1–P3 findings. Security: no new input surface (the script consumes its own child CLI's JSON at a trusted local boundary; warning detail is printed verbatim to local stdout/stderr, never interpolated into a further command). Efficiency: `buildDegradedWarnings` is O(entries × warnings) over a handful of sources; no added subprocess or FS work. Architecture: the script stays a stateless CLI sequencer that consumes the domain's exit-code semantics instead of re-deriving per-source health, and now matches `spur history daily`'s non-fatal-degraded stance.

**Fix pass (`--fix all`) — changes made this run**

- `docs/tasks4/0569_…md` `### Requirements` — flipped R1/R2/R3 boxes `[ ]` → `[x]` via `spur task update --section` (cleared the `L3` "done but carries 3 unchecked checklist box(es)" WARN).
- `docs/tasks4/0569_…md` `### Acceptance Criteria` — scenario R2 retitled to "A fully failed import aborts before analyze and propagates the exit code" to match feature I5 R9 verbatim (cleared `L4.uncovered-feature-scenario` for R9 on the feature side and its DD-09 subset WARN on the task side). Given/When/Then body unchanged.
- `.spur/run/0569-verdict.json` (gitignored) — rewritten this run with the re-audited verdict, requirement rows, and `checks[]`.
- No production code, test, or command-doc changes were needed; the review stage's P3 test-title fix was already applied.

**Shippable readiness (feature I5)** — `Shippable: FAIL`, blocked entirely on sibling task 0567, not on 0569. `spur feature check I5` reports `pass: true` with nine `L4.scenario-unverified` findings, all naming covering task 0567 (which has no PASS verdict with MET requirement rows). Both linked tasks (0567, 0569) are `done`, and no orphan/uncovered feature scenario remains after this run's R9 fix. Recovery: re-verify 0567 (`/sp:dev-verify 0567 --force`) so its verdict artifact carries MET rows whose ids match feature I5's R1–R8/R10 scenario titles.

- Coverage: N/A (verify re-audit of an already-implemented change; the executable evidence is the 12-test stub suite plus the live probe, not a coverage percentage).
### Review
**Reviewed 2026-08-16 (review stage, /sp:dev-review 0569 --auto; working-tree diff, 5 files, +184/−37).**

Scope: `git diff` of the uncommitted 0569 implementation. Dimensions: functional traceability, SECUA (security/correctness/efficiency/usability), architecture depth.

**Verdict: PASS — no P1/P2 findings. Disposition: approve (auto).**

**Findings (P1–P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P3 (minor) | Correctness | `plugins/sp/tests/history-load.test.ts:157` | New test title names the wrong exit code: `'exit 2 (all-failed) — analyze is never invoked, exit 1 propagates (0569 R2)'` runs `importExit: '1'` and asserts `exitCode` 1 — the exit-**1** abort case. Assertions are correct; the title misdirects a reader grepping "exit 2" to the abort test instead of the tolerance describe block below. It is also ~95% duplicate of the pre-existing `'non-zero import exit skips analyze and propagates the exit code'` test directly above (delta: bare run vs `--source codex`). Cosmetic only — fixable as a one-word title edit (`exit 1 (all-failed)`). |
| P4 (advisory) | Correctness | `plugins/sp/scripts/history-load.ts:255` | Silent-degradation edge: import exits 2 but emits unparseable stdout (`parseImportJson` → null) ⇒ `degraded = []` ⇒ no human warning, no JSON `warnings`, and the final ok payload's fallback reports `import.exitCode: 0` while the real child exited 2. Reachable only with a spur binary that exits 2 without valid coverage JSON — the real CLI always emits it (history-service `computeExitCode` path). Note only; no action. |
| P4 (advisory) | Traceability | task AC ↔ feature I5 | Two residual DD-09 WARNs remain after the feature amendment (`spur task check 0569` still PASS): task scenarios "R2 — A fully failed import still aborts with propagation" and "R3 — The command doc and feature scenario R9 pin the split" don't textually match any feature I5 scenario title (feature R9 covers the behavior under different wording; R3 is a doc-sync scenario that cannot be a product AC). The R1 scenario cleared via new feature R11. Advisory only. |
| P4 (advisory) | Testing | Plan item 4 | The "manual smoke dry-run" clean-payload check is covered by the stub test (`a clean fan-out payload has no warnings field`) rather than a live spur invocation — equivalent for the payload contract; noted for verify-stage honesty. |

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 script split (exit 1 abort / exit 2 tolerate+warn) | MET | abort narrowed to `status !== 0 && status !== 2` (`history-load.ts:237` — exit 1 and any other non-zero abort verbatim); step 2b builds `DegradedWarning[]` (`buildDegradedWarnings`, source + status + parseErrors + validationErrors + import detail) and prints the stderr block in human mode; `withWarnings` threads `warnings` into dry-run and final ok JSON payloads, absent on clean runs. Exit-code contract verified against the real domain: `history-service.ts:973-983` `computeExitCode` (0 clean / 1 all-failed / 2 mixed-or-degraded); field names `parseErrors`/`validationErrors` match the real emit (`history-service.ts:546-547`). |
| R2 stub coverage for the split | MET | New describe `degraded fan-out tolerance (0569 R1/R2)`: JSON mode (exit 0, analyze ran, single-object stdout, `stderr` empty, `warnings[0]` = agy/degraded/203/0/detail); human mode (stderr names agy + counts); clean run (no `warnings` key). Exit-1 abort pinned by the new explicit test (analyze never in calls log, exit 1 propagates) — plus the pre-existing equivalent. `bun test plugins/sp/tests/history-load.test.ts` → **12 pass, 0 fail**. |
| R3 doc + feature pin | MET | `dev-history-load.md:47-56` fail-hard note replaced with the tolerate-and-warn contract (exit 1 aborts / exit 2 proceeds with stderr warning naming counts / `--json` carries `warnings` / `--source` for deliberate scoping); feature I5 R9 precondition now "all sources failed (exit 1)" + new scenario R11 (exit 2 → analyze runs, exit 0, per-source warning, `warnings` payload). `spur feature check I5 --json` → `pass: true`. |

**SECUA + architecture notes**

- Security: no new input surface — the script consumes its own CLI child's JSON (trusted local boundary); warning detail is printed verbatim to local stdout/stderr. No interpolation into further commands.
- Correctness: clean-fan-out payloads byte-identical to pre-change (dry-run fallback `exitCode: importResult.status` equals 0 on clean runs; `warnings` key only when non-empty — asserted by test). JSON single-object contract preserved (human warning gated on `!args.json`; test asserts `stderr === ''`).
- Efficiency: `buildDegradedWarnings` is O(entries × warnings) over a handful of sources — negligible; no added subprocess or FS work.
- Architecture: the script stays a stateless CLI sequencer; tolerance policy consumes the domain's exit-code semantics (0470 R3 / 0504 R2) instead of re-deriving per-source health, and now matches `spur history daily`'s non-fatal-degraded stance, removing the documented footgun where a steady-state degraded source blocked every bare run.

**Verification evidence (fresh, this review)**

- `bun test plugins/sp/tests/history-load.test.ts` → **12 pass, 0 fail** (59 expects)
- `spur feature check I5 --json` → `pass: true`
- `spur task check 0569` → **PASS** (2 advisory DD-09 title WARNs, see P4 above)
- Exit-code and field-name contract verified against `packages/app/src/services/history-service.ts` (`computeExitCode` :973, entry emit :546)

**Residual risk**

- Low. The exit-2-tolerates path can only mislead when the import child exits 2 without valid JSON (P4 edge) — the real CLI does not do that.
### References

I5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-16T23:35:59.108Z todo → wip (system)
- 2026-08-16T23:53:56.835Z wip → testing (system)
- 2026-08-16T23:54:16.429Z testing → done (system)
