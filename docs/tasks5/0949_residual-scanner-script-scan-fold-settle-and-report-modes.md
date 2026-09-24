---
schema_version: 1
name: "Residual scanner script: scan, fold, settle and report modes"
status: done
template: feature-impl
created_at: 2026-09-24T18:59:37.116Z
updated_at: "2026-09-24T21:51:05.562Z"
feature_id: F96
priority: P2
tags:
  - residual-sweep
  - plugin-script
estimate_hours: 5

---

## 0949. Residual scanner script: scan, fold, settle and report modes

### Background

Feature F96 makes task leftovers verification evidence so refine → run → wrap needs no manual "anything remained?" prompt. This task builds the deterministic engine every other F96 task calls. It adds no pipeline wiring; that is the next task.

Premises (verified 2026-09-24):
- Review findings live in `### Review` tables with a `Priority` column whose position varies: `| Priority | Dimension | Location | Finding |` (plugins/sp/skills/code-verification/SKILL.md:311) versus `| # | Priority | Dimension | Finding | Location |` in reviewer-written tasks. Priority cells are `P3`, `P3 (minor)`, `P4 (advisory)`, etc. SECUA review requires the table even when empty (plugins/sp/skills/code-verification/references/secu-review.md:92).
- The verdict artifact `.spur/run/<wbs>-verdict.json` carries a `checks[]` array of `{name, status, evidence}` rows (plugins/sp/skills/code-verification/references/verdict-schema.md:33); additive rows are documented from verdict-schema.md:130.
- `<wbs>-test-gate.findings` holds unique `file.ext:line` anchors, code-unit sorted, capped at 20 (plugins/sp/scripts/quality-gate.ts:10); the test-fix hop reads it into `gateFindings` (config/workflows/task-pipeline.yaml:366).
- Plugin scripts that ship standalone are registered as `contract: standard` with an `.mjs` twin in config/plugin-scripts.json:73-75 and converted by `build:scripts` (package.json:61) via `superskill script convert sp <file>.ts`; script-contract-check.ts enforces twin freshness (plugins/sp/scripts/script-contract-check.ts:7).
- Existing scripts take `--spur-bin` for the CLI (plugins/sp/scripts/verify-answer-lint.ts:27) and guard `main()` with `import.meta.main` (plugins/sp/scripts/verify-answer-lint.ts:547); tests live in plugins/sp/tests/ (e.g. plugins/sp/tests/quality-gate.test.ts).
- Follow-up creation must not dispatch a model: `spur task create` supports `--feature`, `--skip-ready` and a 300 s dedup guard when `--feature` is set (`spur task create --help`).
- Prior art: a post-PASS residual-sweep pipeline state (task 0596) was deleted by ADR-076 for adding a model query (docs/design/planning-workflow-contracts.md:60); this scanner is model-free.

### Requirements

- [x] R1. Add `plugins/sp/scripts/residual-scan.ts` with CLI `residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]`, importing only `node:*`/`bun:*` builtins and relative paths, and exporting pure functions for each category parser, `classify`, `foldVerdict` and `renderReport`.
- [x] R2. `scan` writes `.spur/run/<wbs>-residuals.json` (schema in the F96 design doc) with categories `review-finding` (any Review table with a Priority column; priority `^P[1-4]`; finding not `none`/`—`), `diff-marker` (TODO/FIXME/XXX/HACK on lines added since `.spur/run/<wbs>-base.sha`, including untracked files, excluding `docs/tasks*/`, `docs/features/`, `.spur/` and lines containing `residual-scan:allow`), `unchecked-box` (`- [ ]` lines in the task file) and `staging-residue` (`<tmp-dir>/<wbs>-*`, default `/tmp`). A missing base file sets `scanned.diff-marker=false` instead of guessing.
- [x] R3. Classification: P1–P3 findings, diff markers and unchecked boxes are `blocking`; P4 is `advisory`; staging residue is `housekeeping`. An entry `{id, reason}` with a non-empty reason in `.spur/run/<wbs>-residual-deferrals.json` reclassifies a matching P3 finding or diff marker as `deferrable`; it never affects P1/P2 findings or unchecked boxes. Item id = `<category>:<first 8 hex of sha256(location + normalized text)>`.
- [x] R4. `fold` reads `<wbs>-verdict.json` and the scan, replaces any existing `residual-sweep` check with one whose status is `fail` when blocking > 0 (otherwise `pass`) and whose evidence lists counts plus blocking and deferrable ids, downgrades verdict `PASS` to `PARTIAL` when blocking > 0, leaves `PARTIAL`/`FAIL` unchanged, and merges blocking `file:line` anchors into `<wbs>-test-gate.findings` (unique, sorted, cap 20). Idempotent.
- [x] R5. `settle` is idempotent. When deferrables exist and `followUp` is unset, it creates one task via `<spur-bin> task create "Residuals from <wbs>" --feature <task feature_id> --skip-ready --json`, writes its Background (source task, each deferred item, location and reason) through `task update --section Background --from-file`, and stores `followUp` in the residuals file. It deletes only regular files matching `<tmp-dir>/<wbs>-*` and exits 0 with a printed re-run command on failure.
- [x] R6. `report` is a no-op (exit 0) unless the verdict has a failing `residual-sweep` check. In that case it writes `.spur/run/<wbs>-residual-report.md` (each blocking item with location, text and the attempt count from `<wbs>-test-fix-attempt`) and prints `Recovery: fix the items in .spur/run/<wbs>-residual-report.md, then /sp:dev-run <wbs>`.
- [x] R7. Register the script as `standard` with a `residual-scan.mjs` twin in config/plugin-scripts.json, add its convert step to `build:scripts`, generate the twin, and document the `residual-sweep` check row in verdict-schema.md.

### Acceptance Criteria

- [x] AC1 — Deterministic residual scan classifies task leftovers (req: R1, R2, R3)

Task-only checks: fold, settle and report behaviour (R4–R6) are proven by unit tests with a stub spur-bin; the twin passes script-contract-check (R7).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Contract owner: `docs/design/task-residual-sweep.md` (§Scanner, §Artifact). Follow it verbatim; any deviation updates that doc in the same commit.

Decisions:
- One script, four modes, pure functions plus a thin `main(argv, env)`. This mirrors wrapup-steps.ts (plugins/sp/scripts/wrapup-steps.ts:453) for testability. No class hierarchy.
- The diff source is `git diff --unified=0 <base>` (working tree vs base, covering committed and uncommitted changes) plus `git ls-files --others --exclude-standard` for untracked files, whose full content counts as added. Parse `+` lines, not `+++`, and track new-file line numbers from hunk headers.
- Review parsing: split `### Review` (up to the next `### `) into markdown tables; locate the `Priority`/`Finding`/`Location` columns by header name. Take the location from the Location column, else the first backticked `path:line` in the finding. Normalize `path:12-18` to `path:12` for anchors.
- Task file and feature id come from `<spur-bin> task show <wbs> --json` (`filePath`, `content`, `frontmatter.feature_id`), never a folder guess. The spur-bin resolution mirrors wrapup-steps `spurCommand` (plugins/sp/scripts/wrapup-steps.ts:67).
- The scan writes only under `.spur/run/`. It is observe-only (ADR-071) and safe inside the verify stage after the digest bracket.
- Anti-patterns: no model calls, no `spur task update` outside `settle`, no rm of directories, no deletion outside `<tmp-dir>/<wbs>-*`.

### Plan

- [x] Write failing tests in `plugins/sp/tests/residual-scan.test.ts`: review tables (both column orders, `none` rows, P1–P4 labels with suffixes), diff markers (added vs pre-existing lines, untracked file, excluded paths, allow pragma, missing base), unchecked boxes, classification and deferral rules (P1/P2 immune), stable ids, fold (PASS→PARTIAL, idempotent, findings merge/cap), settle (stub spur-bin script recording argv; idempotent; tmp cleanup scoped via `--tmp-dir`), report (no-op vs written file).
- [x] Implement `plugins/sp/scripts/residual-scan.ts` to green.
- [x] Register in config/plugin-scripts.json, extend `build:scripts`, run `superskill script convert sp residual-scan.ts`, and confirm `bun plugins/sp/scripts/script-contract-check.ts` passes.
- [x] Document the `residual-sweep` check row in plugins/sp/skills/code-verification/references/verdict-schema.md.
- [x] Run `(cd plugins/sp && bun test tests/residual-scan.test.ts)`, then `bun run plugin-smoke` and `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| plugins/sp/scripts/residual-scan.ts:1 | New: four-mode scanner (scan/fold/settle/report). Pure exports: `parseReviewFindings`, `collectAddedLines`, `parseDiffMarkers`, `findUncheckedBoxes`, `listStagingResidue`, `classify`, `foldVerdict`, `renderReport`, `makeItemId`, `blockingAnchors`; thin `main(argv, env)` with `import.meta.main` guard (quality-gate/wrapup-steps pattern). node/bun builtins only. |
| plugins/sp/tests/residual-scan.test.ts:1 | New: 19 tests — both Review column orders + `none` rows + P1–P4 suffixes; diff markers (added vs pre-existing, untracked, excluded paths, allow pragma, missing base → `scanned.diff-marker=false`); unchecked boxes; staging-residue scoping; classification/deferral (P1/P2/unchecked immune, empty reason rejected); stable ids; fold (PASS→PARTIAL, idempotent, findings merge/sort/cap); CLI modes with stub spur-bin (scan artifact, fold rewrite, settle idempotent + scoped cleanup, report no-op vs written); renderReport. |
| config/plugin-scripts.json:76 | `residual-scan.ts` registered `contract: standard` with `residual-scan.mjs` twin. |
| package.json:61 | `build:scripts` gained `superskill script convert sp residual-scan.ts`. |
| plugins/sp/skills/code-verification/references/verdict-schema.md:133 | Additive `residual-sweep` checks[] row documented (fail ⇒ PASS downgraded by fold). |
| plugins/sp/scripts/residual-scan.mjs | Generated twin (17555 bytes) via `superskill script convert sp residual-scan.ts`. |

Rationale: scan is observe-only (ADR-071) — writes only under `.spur/run/`; settle mutates (follow-up create via `task create --feature --skip-ready`, `task update --section Background --from-file`, `/tmp/<wbs>-*` regular-file deletion) and prints a re-run command on every failure path while exiting 0. Ids are `category:sha256(location+normalized text)[:8]` with whitespace-collapsed normalization so deferral entries survive re-scans.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/scripts/residual-scan.ts:494-575+ (parseArgs dispatch scan/fold/settle/report; main+import.meta.main); modes test-driven via CLI tests |
| R2 | MET | scanMode writes only .spur/run/ artifacts (residuals.json, report.md); tests/residual-scan.test.ts diff-markers + review tests confirm observe-only behavior incl. missing-base flag |
| R3 | MET | classify() P1/P2 blocking, P3 deferrable w/ reason, P4+none advisory; unchecked-box and staging-residue blocking; tests: classification/deferral + stable ids |
| R4 | MET | foldVerdict replaces residual-sweep check, PASS->PARTIAL only when blocking>0, anchors merged/sorted/cap 20; test 'fold is idempotent' asserts stable second fold |
| R5 | MET | settleMode: single followUp (prior.followUp guard), Background via --from-file, re-run hint on all 5 failure paths, cleanup scoped <tmpDir>/<wbs>-* regular files; test 'settle files follow-up once (idempotent) and cleans only wbs-prefixed tmp files' |
| R6 | MET | reportMode renders counts+table, no-op exit 0 on passing sweep; test 'report is no-op on passing sweep, writes on failing' |
| R7 | MET | config/plugin-scripts.json standard entry + twin; package.json build:scripts convert; script-contract-check PASS (26 scripts, 0 violations); verdict-schema.md residual-sweep row |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | (cd plugins/sp && bun test tests/residual-scan.test.ts): 19 pass / 0 fail; repo gate .spur/run/0949-test-gate.status=PASS (8935 tests, proof-digest sha256:cf4c9f43...) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:cf4c9f4368e77dd90ebb5fb54b69d15bc8483974f894114820112ac4fa2b89a8 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-24T21:30:42.437Z todo → wip (system)
- 2026-09-24T21:50:45.405Z wip → testing (system)
- 2026-09-24T21:51:05.562Z testing → done (system)

