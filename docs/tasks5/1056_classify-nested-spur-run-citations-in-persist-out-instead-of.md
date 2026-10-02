---
schema_version: 1
name: Classify nested .spur/run citations in persist-out instead of truncating to directory name
status: done
template: issue
created_at: 2026-10-02T21:08:29.604Z
updated_at: "2026-10-02T22:44:40.625Z"
feature_id: D62

done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-d62-1c23/.spur/memory/evidence/1056-verdict.json
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

- AC1: A merged task file citing `.spur/run/<dir>/<file>` where `<dir>` exists as a directory in the invoking tree no longer fatals persist-out; the citation resolves to a declared skip reason (per the R1 skip choice) — test in packages/app persist-out/0984 suite.
- AC2: Existing direct-child citation behavior is unchanged — full existing inline-run-setup/0984 test suite passes without modification.
- AC3: Classifier decision has unit evidence (capture-then-classify) in packages/app tests, with the R1 design choice stated in the test name or comment.

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

Verified by RED test reproduction (`packages/app/tests/services/persist-worktree-runs.test.ts` 1056 tests, pre-fix): `RUN_CITATION_RE` (packages/app/src/services/inline-run-setup.ts:235) captures only the first path component — its charset excludes `/` and nothing examines what follows — so `.spur/run/<dir>/<file>` collapses to an obligation for `<dir>`. With `<dir>` a directory absent from the worktree, the obligation path hits the missing-in-both refusal (:453; `readExistingRunFile` on the invoking-tree directory fails its read and reports undefined); after hand-copying the directory into the worktree, the not-a-regular-file refusal fires instead. Both 1052 fatals reproduce from one root cause: subpath captures never reach the 0984 R5 classifier.

### Solution

Chosen design (R1 recommendation): classify, don't resolve — skip, never obligate:

- **Regex** — `packages/app/src/services/inline-run-setup.ts:235` (`RUN_CITATION_RE`): added capturing group 2 `(\/[^\s\`]*)?` after the name — an optional subpath continuation (stops at whitespace/backtick). A captured continuation, not a `/`-negative lookahead: the greedy name charset would backtrack to a SHORTER capture to satisfy a lookahead, yielding a wrong name (`triage-1051-105` out of `triage-1051-1056`). The `asLiteralRunFileName` contract comment (:218-234) now states the subpath rule and why classify-not-resolve (R1) — it matches the 0984 R5 "not a file the copy set can own" contract with zero new path-traversal surface (R3 satisfied vacuously: no nested resolution exists to validate).
- **Extraction loop** — `packages/app/src/services/inline-run-setup.ts:357-382`: `match[2] !== undefined` → the name joins `citedDirSkips` (Set, dedupes per directory: one row per extraction pass) instead of `citedNames`; skip rows consume no `MAX_CITED_RUN_FILES` budget (they add no copy work) — choice documented in the loop comment. Flush into the outcome at `packages/app/src/services/inline-run-setup.ts:423-424` as `cited-directory:<name>` rows; the obligation pass iterates `citedNames` only, so subpath citations can never reach the copy/divergence/fatal pipeline.
- **Packaging (anti-drift)** — `bun run build:scripts` regenerated the installed twin `plugins/sp/lib/inline-run.generated.mjs` (contains the new classifier); `bun run plugin-smoke` PASS — plugin surface standalone and installs clean.
- **Tests** — `packages/app/tests/services/persist-worktree-runs.test.ts` (0984 block): AC3 extraction-time classification with `<dir>` absent from BOTH trees (pre-fix this reproduces the exact 1052 "missing in both" fatal — RED confirmed); AC1 the 1052 shape (`<dir>` in invoking tree only, two subpath citations of one directory) → success with one deduped `cited-directory:triage-1051-1056` skip row. All four 0984-lineage describe blocks (0984/1012/1034/1045) pass UNMODIFIED (R2).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/inline-run-setup.ts:235 continuation group 2 + :357-382 citedDirSkips classification + :423 flush; AC3 unit: extraction-time cited-directory skip with dir absent from both trees (RED reproduced 1052 fatal first); AC1 unit: invoking-tree dir + two subpath citations → one deduped skip row; contract comment :218-234 documents the choice |
| R2 | MET | all four 0984-lineage describe blocks (0984/1012/1034/1045) in packages/app/tests/services/persist-worktree-runs.test.ts pass unmodified — 35/35 |
| R3 | MET | no nested resolution surface added (classify-not-resolve per R1 recommendation); asLiteralRunFileName still enforces SAFE_RUN_ID_RE + no '..' before any obligation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA self-review of the full diff, 2026-10-02:

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | — | None found. |
| P2 | — | None found. |
| P3 | A subpath citation whose `<name>` is non-literal (e.g. `run-*/sub.log`) is silently dropped, same as today's non-literal handling — no skip row is emitted for it | Accepted: R1's scope is the truncation defect for literal names; glob classification stays non-literal by the unchanged `asLiteralRunFileName` contract (Q&A: globs remain unresolved). |
| P4 | `citedDirSkips` flush sits after `citedSkips`' declaration (TDZ forced the placement); outcome row order interleaves DB skips, record skips, cited skips, dir skips | Cosmetic — outcome consumers filter by reason prefix, and the CLI prints the array as-is; no ordering contract exists. |

- **Traceability** — R1 → continuation capture + `cited-directory` classification + authoritative contract comment; R2 → 0984-lineage suites unmodified and green; R3 → vacuously satisfied (no nested resolution; `asLiteralRunFileName` still enforces the safe single-component charset before any obligation). AC1/AC2/AC3 → unit evidence per test names.
- **Disposition** — No P1/P2 findings. Teardown semantics: a subpath citation is a declared skip (evidence must already exist in the invoking tree, same as `cited-non-file`); missing-in-both and divergence remain fatal for direct-child obligations only. Residual risk: a task citing ONLY subpaths of a directory that does not exist in the invoking tree now succeeds with a skip row where it previously fataled — this is the designed outcome (0984 R5: the copy set never owned it), and the skip row makes the classification visible in the outcome JSON.

- **Post-review adjustment (recorded)** — first done attempt blocked by the structural gate: (1) two change-map anchors were bare (`inline-run-setup.ts:…`) → rewritten to repo-root paths; (2) the issue-template checkbox AC rows (`- [ ] AC1:`) key the L4.uncovered-task-scenario check, and feature D62's AC carries no persist-out scenario — converted the AC section to the corpus's freeform `- ACn:` precedent (wording preserved; 1053–1055 pass the same gate in this style) and noted the template mismatch as the underlying cause. No code or test changes in the adjustment.

### References

- Defect session: 2026-10-02, run 782ba320-0fef-4424-a00d-437b203d642c (task 1052 worktree teardown); both fatal messages reproduced in-session.
- Workaround commit: `docs(tasks): flatten 1052 run-evidence citations to direct-child names (0984 persist-out contract)` — treats the symptom; 1051's citations remain unfixed.
- Owning contract: `docs/tasks5/0984_persist-worktree-run-evidence-so-merged-task-files-carry-no-.md` (R3 extraction, R5 skip vocabulary).
- Related tasks: 1053 (close projection sidecar, same file), 1054 (CloseAuditError), 1055 (L4 anchor citations — different checker, same "citation hygiene" theme, D62).
- Sibling surface: `plugins/sp/scripts/inline-run-setup.ts` twin + `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` (0984 contract tests).

### History

- 2026-10-02T22:29:00.057Z todo → wip (system)
- 2026-10-02T22:42:51.618Z wip → testing (system)
- 2026-10-02T22:44:28.484Z testing → done (system)

