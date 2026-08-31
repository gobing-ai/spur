---
schema_version: 1
name: "Harden history import provenance and pipeline verify loop (0722 session review)"
status: done
template: meta
created_at: 2026-08-31T15:58:12.645Z
updated_at: "2026-08-31T21:35:00.428Z"
feature_id: F91
ac_altitude: task-local
---

## 0726. Harden history import provenance and pipeline verify loop (0722 session review)

### Background

Task 0722 eventually passed, but three avoidable feedback-loop failures consumed three runs and roughly ten hours:
the published importer destroyed the `history_tool_call.args_raw` evidence channel on a full pi import, the pipeline
did not prove that live-data premise before implementation, and a 30-minute verify timeout discarded nearly complete
work before a mechanical verdict parse retry.

Current-tree verification on 2026-08-31 corrected the original capture:

- Spur and the npm registry both resolve `@gobing-ai/ts-llm-jsonl-importer` 0.4.48. That build retains todo-tool
  arguments only. Upstream commit `96762d5` adds pi/claude/opencode bash-command retention but is not in a published
  release. A full pi import with 0.4.48 can upsert the same messages with `args_raw = NULL`; task 0722 observed 73k
  affected tool arguments and repaired them from the fixed upstream tree.
- `packages/app/src/services/task-verdict.ts` already accepts compound evidence labels such as `test + command` and
  emits an `ac-row-dropped` failure for unknown labels. The old compound-label incident is evidence for a pre-write
  lint, not a missing parser feature.
- `packages/app/src/workflow/actions/agent-run.ts` writes `answerFile` only after a successful agent exit. A timeout
  therefore leaves no resumable verify answer even though live output was produced.
- During this refinement, task 0722 was re-verified concurrently. Its Acceptance Criteria rows now use the exact E6
  scenario titles, and `spur feature check E6 --json` is clean. This proves the existing matcher is sufficient; 0726
  must prevent malformed future verifier output, not widen feature matching or rewrite certified evidence.

Scope is the smallest set of guards that shortens the same future loop: fail closed before destructive import, prove
declared live-data channels in pipeline precheck, preserve and lint verifier progress, then reconcile the corpus
baseline once no other writer owns task/verdict state. Task 0726 remains linked to F91 because the remaining corpus
work is gate integrity; E6 is only the regression fixture.

### Requirements

- [x] **R1. Importer provenance guard.** Before opening the project DB, reject every non-dry-run `full` import whose
  selected sources include `pi` when the resolved `@gobing-ai/ts-llm-jsonl-importer` version is unknown or lower than
  `0.4.49`. Reuse the existing `resolveImportProvenance` result, surface error code `unsafe-history-importer` with the
  installed version, minimum safe version, destructive `args_raw` reason, and upgrade/relink remedy, and leave the DB
  accessor uncalled. Dry-run and non-pi imports remain available. The guard is hard-fail in this task; there is no
  warn-only rollout for a path already proven to destroy retained evidence.
- [x] **R2. Deterministic evidence-channel precheck.** Recognize the exact repeatable task-AC declaration
  `evidence-channel: history_tool_call.args_raw[pi]`. Before implementation, a plugin script must run the fixed query
  `SELECT COUNT(*) FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'`; a missing DB/table or zero
  count writes FAIL and prints the declaration plus query, while no declaration writes PASS. The pipeline guard must
  require both the existing size status and this evidence status. Do not accept embedded SQL or add a generic probe
  registry in this slice.
- [x] **R3. Resumable, linted verify answer.** `/sp:dev-verify` must create
  `.spur/run/<wbs>-verify-answer.txt` itself and append one complete requirement/AC row after it is certified. A retry
  reads valid existing rows and verifies only missing IDs. The workflow must use `expectFile` so `agent.run` does not
  overwrite progress after exit. Before `spur task verdict --from-answer`, a deterministic plugin lint must reject
  missing, duplicate, or unknown R IDs; AC IDs that do not exactly match the task's checklist label or scenario title;
  invalid status/evidence-type values; and empty evidence. Preserve the existing compound evidence normalization and
  final verdict derivation.
- [x] **R4. Corpus reconciliation at commit prep.** After R1-R3 and owned docs land, confirm
  `spur feature check E6 --json` remains clean and the pre-implementation 0722 verdict hash is unchanged, then run
  `bun run corpus-check`, repair only 0726-owned findings, and regenerate `config/corpus-baseline.json` with
  `bun run scripts/commands/regen-corpus-baseline.ts` only from a tree with no other writer's task/verdict changes.
  Record the remaining accepted-Open set in the resulting diff/commit and run the full project gates once.

**Out of scope:** publishing the upstream importer release; fixing importer `record_hash` stability; arbitrary SQL
evidence declarations; a new public `spur` noun/verb/flag; changing the feature scenario matcher; rewriting certified
0722 evidence; stale editor/LSP diagnostics; the unrelated history-board security heuristic; and F91's missing
dogfood artifact.

### Acceptance Criteria

- [x] AC1 (R1): with importer version `0.4.48` or `unknown`, a non-dry-run full pi/all import returns
  `unsafe-history-importer` before `getDb`; version `0.4.49+`, dry-run, and full non-pi paths reach the existing import
  flow. Unit tests assert the DB accessor and importer are untouched on rejection.
- [x] AC2 (R2): a task with `evidence-channel: history_tool_call.args_raw[pi]` gets PASS for a positive fixture count
  and FAIL for zero/missing DB/table, with the fixed SQL printed; a task without the declaration passes without
  opening SQLite. Pipeline contract tests prove evidence FAIL blocks `precheck -> implement`.
- [x] AC3 (R3): pre-seeding a partial answer with certified rows and rerunning verify preserves those rows and resumes
  at the first missing ID. The lint rejects each invalid class with a row-level message before verdict derivation,
  while a complete answer using exact AC titles and `test + command` passes and produces the existing normalized
  verdict shape.
- [x] AC4 (R4): `spur feature check E6 --json` remains free of `L4.verdict-rows-match-no-scenario` and
  `L4.scenario-unverified`; the 0722 verdict SHA-256 captured immediately before implementation is identical after
  all gates; targeted workspace tests, `bun run spur-check`, and the single commit-prep `bun run corpus-check` pass;
  and no unrelated working-tree file is staged or changed.

### Q&A
<!-- CLOSED decisions from implement-ready refinement. No open questions remain. -->

#### Q&A entry — 2026-08-31 implement-ready refinement

- **Hard fail versus warning:** hard fail now. The 0.4.48 path has already caused evidence loss; a warning preserves the
  unsafe default and contradicts AC1.
- **Safe importer threshold:** `0.4.49` is the first permissible patch after the verified published 0.4.48. Unknown and
  prerelease versions fail closed. The upstream fix itself remains owned by `gobing-ai/ts-libs` commit `96762d5`.
- **Evidence declaration surface:** one allowlisted declaration only. Arbitrary task-authored SQL would turn corpus text
  into executable input and is rejected.
- **Verify transport:** the verifier owns the progress file and the workflow checks it with `expectFile`; retaining
  `answerFile` would overwrite resumable content at successful exit.
- **E6 alignment:** concurrent 0722 re-verification corrected the AC row identities and made E6 clean. No matcher change
  is needed; exact AC identity is enforced at the verifier lint boundary instead.
- **Compound evidence labels:** already fixed by task 0568; no parser expansion is part of 0726.
- **Baseline timing:** refinement observed concurrent 0722 task/verdict writes plus unrelated domain changes. R4 must
  capture the final pre-implementation verdict hash and wait for a clean single-writer boundary.

### Design

**R1 — provenance guard**

- Reuse `resolveImportProvenance` in `apps/cli/src/commands/history.ts`; resolve it before service construction and pass
  `importerVersion` through `HistoryServiceContext`.
- In `packages/app/src/services/history-service.ts`, add
  `MIN_SAFE_PI_BASH_IMPORTER_VERSION = '0.4.49'`, a small numeric semver-triple comparison (no dependency), and
  `UnsafeHistoryImporterError` with code `unsafe-history-importer`.
- Call one shared assertion at the start of both direct `import` and fan-out `importAll`, before `getDb`. It applies
  only to non-dry-run full imports containing pi. Unknown, malformed, and prerelease versions are unsafe.
- Extend `packages/app/tests/services/history-service.test.ts` and `apps/cli/tests/commands/history.test.ts`; inject the
  version in service fixtures rather than reading the host package.

**R2 — evidence precheck**

- Add `plugins/sp/scripts/task-evidence-precheck.ts`, patterned after `task-size-precheck.ts`: fetch the task via
  `spur task show <wbs> --json`, parse repeated exact declarations, query `.spur/spur.db` with `bun:sqlite`, write
  `.spur/run/<wbs>-precheck-evidence.status`, and always exit 0 so the status file is the fail-closed contract.
- Support only `history_tool_call.args_raw[pi]` and its fixed parameterized query. An unknown declaration is FAIL.
- Add the script action to `config/workflows/task-pipeline.yaml` precheck and require its PASS status in both outgoing
  guards. Document the declaration in `plugins/sp/skills/spur-dev/references/gate-checklists.md` and the history
  contract in `docs/04_DESIGN.md`. Tests live in `plugins/sp/tests/task-evidence-precheck.test.ts` and the existing
  pipeline resilience/inline-driver suites.

**R3 — verify progress and lint**

- Update `plugins/sp/skills/code-verification/SKILL.md` and its verdict reference: initialize the canonical answer file
  with `Verdict: PARTIAL`, append complete Markdown table rows in task order, and on resume retain only rows that pass
  the same lint contract. Replace the first verdict line only after all rows are certified.
- Add `plugins/sp/scripts/verify-answer-lint.ts`. It obtains the task through `spur task show`, compares R IDs and exact
  AC checklist/scenario identities, reuses the documented status/evidence vocabulary, and exits non-zero with bounded
  row diagnostics. It writes nothing.
- In `config/workflows/task-pipeline.yaml`, replace verify's `answerFile` with `expectFile`, run the lint immediately
  after the agent returns, then run the existing `spur task verdict`. Do not change `agent.run`, `feature-check.ts`, or
  the public task-verdict surface.

**R4 — handoff and anti-patterns**

- Capture the current 0722 verdict SHA-256 at implementation start. Update owned design/skill surfaces, then use
  `sp:doc-evolve` sync-check before final gates. Preserve the concurrent 0722 task/verdict work and unrelated dirty
  domain files.
- Do not add a generic evidence-probe framework, a second verdict format, a new dependency, a warning-only bypass, a
  broader feature matcher, or a compatibility rewrite of historical verdict JSON.

### Plan

- [x] 5. Update `docs/04_DESIGN.md` and plugin references, run `sp:doc-evolve` sync-check, then run focused tests from
  inside `packages/app`, `apps/cli`, and `plugins/sp`. Confirm E6 stays clean and the captured hash is unchanged.
  (R1-R4)
- [x] 6. Recheck `git status`; once the single-writer boundary is clean, run `bun run corpus-check`, repair only owned
  findings, regenerate the corpus baseline once, and inspect the accepted-Open diff. (R4)
- [x] 7. Run `bun run autofix`, `bun run spur-check`, `bun run test`, `bun run test-cf`, `bun run build`, final
  `spur task check 0726 --json`, and recheck the 0722 verdict hash. (R1-R4)

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution
Implemented in three stages: native implement subagent delivered R1+R2 then hit its timeout at the R3 boundary; the
host session completed R3 inline; an external-writer collision (six files reverted to HEAD mid-run) was re-applied
per operator authorization — provenance in `.spur/run/a33bbfbd-*.log`. A later `--force` re-verify corrected stale
citations and root-caused the residual test reds (see the closing bullet).

- R1 (subagent; re-landed concurrently by the second writer after the collision): provenance guard in
  `packages/app/src/services/history-service.ts:293-315` (`assertPiImporterSafe`), with
  `MIN_SAFE_PI_BASH_IMPORTER_VERSION` at `:234`, `UnsafeHistoryImporterError` / `code = 'unsafe-history-importer'` at
  `:271-272`, and the strict-triple parse (unknown/malformed/prerelease all unsafe) at `:244-251`. Called at `:473` in
  `import()` — ahead of `getDb()` at `:475` — and hoisted to `:797-801` in `importAll`, so a rejected import never
  opens the DB. CLI wiring `apps/cli/src/commands/history.ts:72-77` (`resolveImportProvenance` →
  `HistoryServiceContext.importerVersion`) and `:183-205` (structured `--json` error, exit 1). New exports surfaced in
  `packages/app/src/index.ts`.
- R2: `plugins/sp/scripts/task-evidence-precheck.ts` (+ 12 tests) — fail-closed evidence-channel precheck writing
  `.spur/run/<wbs>-precheck-evidence.status` (`:100-104`), single allowlisted channel `:45`, fixed query `:51`, always
  exit 0 `:112`/`:143`/`:178`; registered in `config/plugin-scripts.json:56-59`; wired into precheck onEnter
  (`config/workflows/task-pipeline.yaml:221-239`) and the BOTH-pass precheck→implement guard
  (`config/workflows/task-pipeline.yaml:715`).
- R3: `plugins/sp/scripts/verify-answer-lint.ts` (+ 13 tests) — hard-gate answer-contract linter (bounded row
  findings at `:370-376`, writes nothing; requirement completeness/uniqueness/identity at `:334-346`, AC identity and
  vocabulary at `:352-368`, normalization mirroring `task-verdict.ts` at `:105-148`; AC completeness stays a verifier
  judgement); verify stage switched `answerFile` → `expectFile` (`config/workflows/task-pipeline.yaml:558`) with the
  lint shell step at `:559-568`, ahead of `spur task verdict --from-answer` at `:571`; inline-pipeline-driver test
  stubs preserve smoke coupling only.
- Docs: `plugins/sp/skills/code-verification/SKILL.md` (budget-safe prose, 30433 bytes ≤ 30488 baseline),
  `plugins/sp/skills/code-verification/references/verdict-schema.md:109-118` authoring-contract section,
  `plugins/sp/skills/spur-dev/references/gate-checklists.md` precheck + verify gate entries, `docs/04_DESIGN.md`
  history-guard and pipeline entries; `config/workflow-composition-baseline.json` regenerated via the composition
  extractor (twice — the first regen was stomped same-minute by the concurrent writer).
- Re-verify corrections (`/sp:dev-verify 0726 --force --fix all`): pipeline comments cited nonexistent requirement
  IDs (`R4`→R2 at `config/workflows/task-pipeline.yaml:221`, `R5`→R3 at `:559`; the task declares only R1-R4);
  `SKILL.md` Step 10 still described the removed `answerFile` capture model, contradicting Step 11's verifier-owned
  `expectFile` contract; `gate-checklists.md` narrowed the empty-evidence rejection to MET/PARTIAL rows when
  `plugins/sp/scripts/verify-answer-lint.ts:342`/`:367` apply it to every row. All three fixed.
- Corrected attribution: the 4-5 `packages/app/tests/services/task-attribution.test.ts` reds previously recorded as
  the second writer's WIP were **0726's own blast radius** — the R1 guard rejects `import('pi', {mode:'full'})` when
  `importerVersion` is absent, and those pre-existing tests constructed `HistoryService` without it. The file is part
  of this diff (inject `MIN_SAFE_PI_BASH_IMPORTER_VERSION`) and `bun run spur-check` is now 7072 pass / 0 fail.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Guard re-read at cited lines this run: `packages/app/src/services/history-service.ts:234` (`MIN_SAFE_PI_BASH_IMPORTER_VERSION = '0.4.49'`), `:271-272` (`UnsafeHistoryImporterError`, `code = 'unsafe-history-importer'`), `:244-251` (`parseImporterVersion` — strict `MAJOR.MINOR.PATCH`; unknown/malformed/prerelease → null → unsafe), `:293-315` (`assertPiImporterSafe` early-returns on dry-run / non-full / non-pi; message carries installed version, min safe version, destructive `args_raw` reason, upgrade-or-relink remedy), `:473` (called in `import()` — `getDb()` is `:475`, so the DB accessor is uncalled on rejection), `:797-801` (same guard hoisted in `importAll` above the fan-out). CLI wiring `apps/cli/src/commands/history.ts:72-77` (`resolveImportProvenance` → `HistoryServiceContext.importerVersion`) and `:183-205` (structured `--json` error, `details.cliCode`, exit 1). Tests re-run this session: `cd packages/app && bun test tests/services/history-service.test.ts` → 45 pass / 0 fail; `cd apps/cli && bun test tests/commands/history.test.ts` → 41 pass / 0 fail |
| R2 | MET | Script re-read this run: `plugins/sp/scripts/task-evidence-precheck.ts:45` (single allowlisted channel `history_tool_call.args_raw[pi]`), `:51` (fixed query, never task-authored), `:130-139` (repeated declarations parsed; any non-allowlisted token → FAIL), `:140-144` (no declaration → PASS without opening SQLite), `:146-149` (missing DB → FAIL), `:151-165` (missing/unreadable table → FAIL), `:167-172` (zero count → FAIL, query printed), `:100-104` (writes `.spur/run/<wbs>-precheck-evidence.status`), `:112`/`:143`/`:178` (always exit 0 — the status file is the fail-closed contract). Registered `config/plugin-scripts.json:56-59`. Wired `config/workflows/task-pipeline.yaml:221-239` (precheck onEnter; missing checker writes FAIL) and `:715` (precheck→implement guard requires BOTH `precheck-size.status` and `precheck-evidence.status` = PASS). Tests re-run: `cd plugins/sp && bun test tests/task-evidence-precheck.test.ts` → 12 pass / 0 fail |
| R3 | MET | Lint re-read this run: `plugins/sp/scripts/verify-answer-lint.ts:334-346` (requirement completeness / uniqueness / unknown-ID rejection), `:352-368` (exact AC identity vs task checklist label or linked-feature scenario title, status, evidence type, empty evidence), `:105-148` (status + compound `test + command` normalization mirroring `packages/app/src/services/task-verdict.ts`), `:370-376` (bounded 10 findings, exit 1), writes nothing — no `writeFileSync` import. Workflow `config/workflows/task-pipeline.yaml:558` (`expectFile`, replacing `answerFile`), `:559-568` (hard lint step between agent exit and verdict), `:571` (`spur task verdict --from-answer`). Authoring contract `plugins/sp/skills/code-verification/SKILL.md:310-314` and `plugins/sp/skills/code-verification/references/verdict-schema.md:109-118`. Smoke coupling `plugins/sp/tests/inline-pipeline-driver.test.ts:150`/`:188`/`:193-195`. Live command evidence: this answer file was linted by `bun plugins/sp/scripts/verify-answer-lint.ts 0726 --answer .spur/run/0726-verify-answer.txt` → PASS, exit 0. Tests re-run: `cd plugins/sp && bun test tests/verify-answer-lint.test.ts` → 13 pass / 0 fail |
| R4 | MET | Re-verified fresh this session: `bun run apps/cli/src/index.ts feature check E6 --json` → `pass: true`, `findings: []` (no `L4.verdict-rows-match-no-scenario`, no `L4.scenario-unverified`). 0722 verdict hash identical — live `shasum -a 256 .spur/run/0722-verdict.json` = `3e9964940a42a246c1f8a7cfb7dd86fa75da452666dcd648d449af6c330a81ee`, byte-identical to captured `.spur/run/0726-0722-verdict-hash.txt`. `bun run corpus-check` → errors 4 observed / 4 baselined / **0 new**; warnings 810 observed / 268 baselined / **1 new**, and that single NEW warning is `task 0727: L3.requirements-format` — task 0727 was created 2026-08-31T21:21:06Z by a concurrent writer, so it is neither a 0726-owned finding (R4 repairs only 0726-owned) nor a legal baseline-regeneration trigger (R4 requires a tree with no other writer's task changes); the baseline was regenerated once during the original run and is deliberately not regenerated again here. Full gates re-run this session: `bun run lint` exit 0 (biome 849 files clean + typecheck 0 across all 7 workspaces), `bun run spur-check` → **7072 pass / 0 fail** (the 4-5 reds the prior verify recorded as writer-owned were in fact 0726's own guard fallout in `packages/app/tests/services/task-attribution.test.ts` and are now resolved), `bun run test-cf` exit 0, `bun run build` exit 0. Fix-pass artifact writes this run: `.spur/run/0726-verify-answer.txt` (rewritten in full — stale workflow anchors re-cited) and `.spur/run/0726-verdict.json` (re-derived from it) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/history-service.test.ts:698-790` — `describe('pi importer provenance guard (0726 R1)')` with a `dbOpens` counter: `:759-766` unsafe 0.4.48 throws `code === 'unsafe-history-importer'` and `dbOpens() === 0`; `:769-773` unknown/malformed/prerelease all reject with `dbOpens() === 0`; `:778-782` safe 0.4.49 reaches the import flow (`dbOpens() > 0`); `:786-790` `importAll` fan-out rejection with `dbOpens() === 0`. CLI surface `apps/cli/tests/commands/history.test.ts:406-492` (text output contains `unsafe-history-importer`; `--json --json-envelope` carries `parsed.error.details.cliCode`). Both suites re-run this session: 45 pass / 0 fail and 41 pass / 0 fail — no failures |
| AC2 | MET | test | `cd plugins/sp && bun test tests/task-evidence-precheck.test.ts` re-run this session → **12 pass / 0 fail**. Covers positive fixture count → PASS; zero count and missing DB/table → FAIL with the fixed query printed; a task without the declaration → PASS without opening SQLite; unknown declaration → FAIL. Pipeline contract asserted against `config/workflows/task-pipeline.yaml:715` — the precheck→implement guard ANDs `precheck-evidence.status = PASS`, so an evidence FAIL blocks the transition |
| AC3 | MET | test | `cd plugins/sp && bun test tests/verify-answer-lint.test.ts` re-run this session → **13 pass / 0 fail**: partial answer with certified rows accepted (resume path), missing/duplicate/unknown R IDs rejected, inexact AC identity rejected, invalid status and evidence-type rejected, empty evidence rejected, and a complete answer using exact AC titles with compound `test + command` accepted and normalized. Command evidence: this very answer file — authored with exact AC identities and a `test + command` row — was linted live at `bun plugins/sp/scripts/verify-answer-lint.ts 0726 --answer .spur/run/0726-verify-answer.txt` → PASS, exit 0, then consumed by `spur task verdict --from-answer` producing the existing normalized verdict shape. `expectFile` at `config/workflows/task-pipeline.yaml:558` means the host never overwrites pre-seeded rows on retry |
| AC4 | MET | command | `feature check E6 --json` → `pass: true, findings: []`; 0722 verdict SHA-256 byte-identical to the pre-implementation capture (both re-run this session). Targeted workspace tests all green: 45/45 + 41/41 + 12/12 + 13/13 + skill-structure 68/68 + composition 27/27. `bun run spur-check` → **7072 pass / 0 fail, exit 0** (previously 4-5 reds; root-caused this run to 0726's own guard breaking `task-attribution.test.ts`, now fixed and green). `bun run lint`, `bun run test-cf`, `bun run build` all exit 0. `bun run corpus-check` reports **0 new 0726-owned findings**; it exits 1 solely on `task 0727` (created 21:21 today by a concurrent writer), which R4 excludes from both repair scope and baseline regeneration — stated here rather than rounded up. Working tree carries only 0726-owned files plus the concurrent writer's own; no unrelated file was staged or changed by this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- Task 0722 and feature E6: `spur task show 0722 --json`; `spur feature check E6 --json`.
- Certified verdict authority: `.spur/run/0722-verdict.json`; capture its SHA-256 at implementation start and treat it
  as immutable for the 0726 diff.
- Importer provenance and import entry: `apps/cli/src/commands/history.ts`,
  `packages/app/src/services/history-service.ts`.
- Published importer observed 2026-08-31: npm `latest=0.4.48`; local lock/catalog 0.4.48. Upstream bash-retention fix:
  `gobing-ai/ts-libs` commit `96762d5` (not published at refinement time).
- Evidence precheck seams: `config/workflows/task-pipeline.yaml`, `plugins/sp/scripts/task-size-precheck.ts`,
  `plugins/sp/skills/spur-dev/references/gate-checklists.md`.
- Verify transport/parser: `packages/app/src/workflow/actions/agent-run.ts`,
  `plugins/sp/skills/code-verification/SKILL.md`, `packages/app/src/services/task-verdict.ts`.
- Baseline gate: `config/corpus-baseline.json`, `scripts/commands/regen-corpus-baseline.ts`.

### History

- 2026-08-31T17:17:35.747Z backlog → todo (system)
- 2026-08-31T19:00:45.604Z todo → wip (system)
- 2026-08-31T20:01:36.682Z wip → testing (system)
- 2026-08-31T20:03:35.067Z testing → done (system)
