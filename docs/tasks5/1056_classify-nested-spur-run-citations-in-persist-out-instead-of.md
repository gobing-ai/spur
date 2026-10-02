---
schema_version: 1
name: Classify nested .spur/run citations in persist-out instead of truncating to directory name
status: todo
template: issue
created_at: 2026-10-02T21:08:29.604Z
updated_at: "2026-10-02T21:14:01.629Z"
feature_id: D62

---

## 1056. Classify nested .spur/run citations in persist-out instead of truncating to directory name

### Background

Session defect observed 2026-10-02 during task 1052's worktree teardown (run 782ba320-0fef-4424-a00d-437b203d642c): `inline-run-setup --persist-out` failed twice. `RUN_CITATION_RE` (packages/app/src/services/inline-run-setup.ts:227) captures only the first path component of a citation — its charset excludes `/` — so six legitimate nested references (`.spur/run/triage-1051-1056/bundle-check.log` and siblings, cited in 1052's Testing section) collapsed into ONE copy obligation for the name `triage-1051-1056`, which resolves to a real evidence DIRECTORY. Symptom chain: "missing in both the worktree and the invoking tree" (directory is not a regular file), then after copying the dir into the worktree, "destination … is not a regular file — refusing to follow it" (:251). The 0984 R5 vocabulary already classifies unownable citations (`cited-directory:<name>` / `cited-symlink:<name>` / `cited-non-file:<name>`, :193) but subpath captures never reach that classifier.

Worked around in-session by flattening the six files to direct-child names (`triage-1051-1056-<file>`) and rewriting 1052's citations (commit `docs(tasks): flatten 1052 run-evidence citations to direct-child names (0984 persist-out contract)`). Recurrence is likely: task 1051 cites the same directory with subpaths, so any future D62/D63 worktree teardown covering it hits the same fatal.

### Requirements

- R1: A `.spur/run/<name>/<rest>` citation must not become a copy obligation for `<name>`. Smallest sufficient design — when the character following the captured group is `/`, classify the citation through the existing 0984 R5 skip vocabulary (`cited-directory:<name>`), OR extend extraction to resolve the full nested path against `SAFE_RUN_ID_RE` per component; pick one, and document the decision in the `asLiteralRunFileName` contract comment (inline-run-setup.ts:218-233). Recommendation: the skip classification — it matches the existing "not a file the copy set can own" contract and needs no path-traversal surface.
- R2: Literal direct-child citations behave exactly as today (copy obligation, divergence check, MAX_CITED_RUN_FILES budget) — existing 0984 suite stays green.
- R3: Any nested-path resolution (if chosen over skip) validates each component with the existing safe-name charset; no `..` or traversal escape.

### Acceptance Criteria

- [ ] AC1: A merged task file citing `.spur/run/<dir>/<file>` where `<dir>` exists as a directory in the invoking tree no longer fatals persist-out; the citation resolves to a declared skip reason (or a copied nested file, per R1 choice) — test in packages/app persist-out/0984 suite.
- [ ] AC2: Existing direct-child citation behavior is unchanged — full existing inline-run-setup/0984 test suite passes without modification.
- [ ] AC3: Classifier decision has unit evidence (capture-then-classify or resolve-path case) in packages/app tests, with the R1 design choice stated in the test name or comment.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T21:14:01.628Z

- Q: Why not just fix task 1051's citations like 1052's? A: Treats one instance; every future task citing evidence subpaths re-fails teardown. 1051's flatten can ride AFTER the fix if still desired, but is not required by this task.
- Q: Does skipping subpath citations lose evidence? A: No — the copy set never owned them (0984 R5); they must exist in the invoking tree already, same as `cited-non-file` references today.
- Q: Should glob/star citations (`run-*.log`) now resolve? A: No — they remain non-literal via `asLiteralRunFileName` (:238); this task changes only the `/` truncation case.

### Design

#### Code anatomy (all anchors `packages/app/src/services/inline-run-setup.ts`, the portable twin is `plugins/sp/scripts/inline-run-setup.ts`)

- `RUN_CITATION_RE` (:227) — capture charset `[A-Za-z0-9][A-Za-z0-9._*?<>{}|,…-]*` deliberately excludes `/`; the lookbehind only refuses root-qualified prefixes (`~/…`, `other/repo/.spur/run/…`). NOTHING examines what follows the capture, so `.spur/run/<dir>/<file>` yields `<dir>`.
- Extraction loop (:357-373) — `content.matchAll(RUN_CITATION_RE)` → `asLiteralRunFileName(match[1])` (:238-242: strips trailing `[.,]+`, `SAFE_RUN_ID_RE` + no `..`, else `undefined` = non-literal, silently skipped) → `citedNames` set, capped by `MAX_CITED_RUN_FILES` (:213, = 64; over-cap throws, :364-369).
- Obligation pipeline (below extraction) — per cited name: missing in BOTH worktree and invoking tree → fatal (:433); content divergence worktree-vs-invoking → fatal (:451, :550); destination/retained item not a regular file → fatal (:251, :321, :902). Copy never overwrites (conflict throws, blocking teardown).
- Outcome skips — `PersistOutcome.skipped: {id, reason}` (:184-194) DECLARES the `cited-directory:<name>` / `cited-symlink:<name>` / `cited-non-file:<name>` vocabulary (0984 R5) but NO emission site exists today (grep: the vocabulary appears only in the :193 comment). The test suite is `packages/app/tests/services/persist-worktree-runs.test.ts` (service entry `persistWorktreeRuns`, :298, exported via `packages/app/src/index.ts`; 0984 describe block at test :272; later blocks 1012 :583, 1043 :868, 1045 :992 constrain regressions).

#### Chosen design (R1 recommendation): classify, don't resolve

Extend the regex with an OPTIONAL trailing-path group — conceptually `(.spur/run)(<name>)(\/<continuation>)?` where continuation is `/` + non-whitespace, non-backtick characters — and in the extraction loop, when the continuation group is present, do NOT add `<name>` to `citedNames`; instead surface it in the outcome as a skip with reason `cited-directory:<name>` (exact reason string shape: mirror the existing skip rows the outcome tests assert on — confirm from the 0984 test block before coding).

Why NOT a negative lookahead on `/`: the name charset is greedy across `.` and friends, so a rejecting lookahead makes the engine backtrack to a SHORTER capture (e.g. `triage-1051-105`) that passes the lookahead — a wrong name, worse than today's behavior. The continuation must be a captured second group examined in code.

Why classify-not-resolve (R1's alternative): nested resolution needs per-component `SAFE_RUN_ID_RE` validation, nested lstat, per-file divergence hashing, and new copy semantics — all new surface. The 0984 R5 contract already declares anything-but-a-regular-direct-child-file "not a file the copy set can own"; classification matches that contract and the copy set stays flat.

Semantics after the fix, made explicit: a task citing `.spur/run/<dir>/<file>` gets NO copy obligation and teardown SUCCEEDS. The cited evidence is expected to already exist in the invoking tree (as today for `cited-non-file`). If the invoking tree lacks the whole directory, that is NOT this fix's concern — missing-in-both only fires for literal direct-child obligations.

#### Explicitly out of scope

- Re-homing or renaming existing evidence directories (1051-1056 citations stay as authored).
- Changing missing-in-both/divergence semantics for direct-child citations.
- Emission of `cited-symlink` / `cited-non-file` (vocabulary exists; only add what R1 needs).

#### Packaging constraint (anti-drift, mandatory)

The plugin twin `plugins/sp/scripts/inline-run-setup.ts` is a thin loader that "imports the bundle dynamically; mode bodies live in the bundled app service". After changing the app service: run the bundle regeneration (`bun run --filter @gobing-ai/spur build:bundle` from a linked tree — see AGENTS.md "Build & verification") and `bun run plugin-smoke`; the twin regeneration is its own commit concern (precedent: `e6829ec3a chore(sp): regenerate inline-run-setup installed twin`). A source-only change that skips the bundle leaves installed plugins on the OLD classifier — the exact drift this task must not ship.

### Plan

1. RED: add a failing test in `packages/app/tests/services/persist-worktree-runs.test.ts` (0984 block, :272): merged task file citing `.spur/run/<dir>/<file>` with `<dir>` a real directory in the invoking tree → expect persistWorktreeRuns to SUCCEED with a `cited-directory:<name>`-shaped skip row (shape asserted against existing skip rows first). Confirm the test reproduces today's fatal before implementing.
2. Extend `RUN_CITATION_RE` (:227) with the optional continuation group; update the :218-233 contract comment to state the subpath rule (the comment block is the classifier's spec — keep it authoritative).
3. Classification in the extraction loop (:357-373): continuation present → skip row, not an obligation. Decide and document cap interaction: skip rows must NOT consume the `MAX_CITED_RUN_FILES` budget (they add no copy work) — state the choice in the loop comment.
4. GREEN: run the focused suite; then the full `packages/app` service tests; then bundle regen + `plugin-smoke` (Design § packaging).
5. Regression sweep: 0984 block (:272), 1012 (:583), 1043 (:868), 1045 (:992) must pass UNMODIFIED — any edit there means the classification changed existing semantics; stop and re-examine.
6. Optional real-data check (dogfood-style, non-blocking): point a dry persist-out at this repo's `docs/tasks5/1051_*.md` (cites `.spur/run/triage-1051-1056/…` six times) — expect success with 6 skip-or-dedupe rows for `triage-1051-1056` (dedupe: one Set entry or one skip row per extraction pass; pick one, assert it).

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Focused: `(cd packages/app && bun test tests/services/persist-worktree-runs.test.ts)` — new cases plus all four 0984-lineage describe blocks unmodified.
- Service-wide: `(cd packages/app && bun test tests/services/)` — guards adjacent planning/teardown services.
- Packaging: `bun run --filter @gobing-ai/spur build:bundle` then `bun run plugin-smoke` (AGENTS.md plugin standalone contract).
- Repo gate at done: `bun run spur-check` (task-local) per pipeline; corpus edits check affected inputs only (T11).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Defect session: 2026-10-02, run 782ba320-0fef-4424-a00d-437b203d642c (task 1052 worktree teardown); both fatal messages reproduced in-session.
- Workaround commit: `docs(tasks): flatten 1052 run-evidence citations to direct-child names (0984 persist-out contract)` — treats the symptom; 1051's citations remain unfixed.
- Owning contract: `docs/tasks5/0984_persist-worktree-run-evidence-so-merged-task-files-carry-no-.md` (R3 extraction, R5 skip vocabulary).
- Related tasks: 1053 (close projection sidecar, same file), 1054 (CloseAuditError), 1055 (L4 anchor citations — different checker, same "citation hygiene" theme, D62).
- Sibling surface: `plugins/sp/scripts/inline-run-setup.ts` twin + `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` (0984 contract tests).

### History
