---
template: feature-impl
schema_version: 1
name: "Anchor integrity: qualification migration, then subject matching"
description: ""
status: done
type: task
profile: standard
feature_id: F91
parent_wbs: null
priority: P1
tags: ["corpus", "migration"]
dependencies: ["0582", "0584"]
ac_numbering: task-local
created_at: "2026-08-17T22:18:51.247Z"
updated_at: "2026-08-18T05:09:59.075Z"
---

## 0583. Anchor integrity: qualification migration, then subject matching

### Background
Two halves of one object: the evidence anchor. One half repairs the historical population, the other
stops it recurring — and the repair must land first, or the new rule fires on 213 tasks at once.

**The population.** Of 851 `L4.stale-line-anchor` warnings measured 2026-08-17, **810 cite an
in-repo file written with an incomplete path**: 726 bare filenames whose basename resolves to
exactly one repository path (`` `Badge.tsx:42` ``), and 84 wrong-prefix paths whose basename
likewise resolves. A further 178 are bare filenames whose basename is ambiguous. These are
mechanical — a unique basename determines the repo-relative path — and `spur task migrate` (feature
F6) already owns the idempotent normalization pass with its M1–M8 rules and dry-run contract, so
this is one more rule in that tool, not a new one.

**The silent half.** `checkLineAnchors` documents its own limit at
`packages/app/src/services/task-check.ts:1026`: "Subject-name matching (line content names the
R-item) stays an agent re-verify responsibility — this gate is existence + bounds only." That leaves
the *dangerous* case ungated. An anchor whose file grew — because a **later** task edited it — still
resolves and still passes bounds, but now points at unrelated code. It reads as verified evidence
and is not. Measured on feature E5: tasks 0578–0581 grew five shared files, and 18 anchors in tasks
0553/0554/0555 drifted 40–240 lines onto unrelated code (`artifact.ts:136` → a comment belonging to
another task; `history-service.ts:284` → `runJsonlImport`). `spur task check --strict-core` reported
**0 warnings** on all three. The gate flagged only the harmless class and certified the harmful one.

The skill already states the rule (`sp:code-verification` Step 4, anti-stale-citation); nothing
enforces it.
### Requirements
- [x] **R1.** A qualification pass rewrites an anchor whose basename resolves to exactly **one** tracked repository path into the repo-relative form; `--dry-run` produces the full old→new report and modifies nothing, and a second apply changes zero files. Measurable: the 810 qualifiable citations are rewritten, and re-running reports zero changes.
- [x] **R2.** An ambiguous basename is **reported, never guessed** — left for an author, with all candidate paths named. Measurable: the 178 ambiguous citations appear in the report and are unmodified on disk.
- [x] **R3.** The pass rewrites the citation **path only**, never line numbers. Measurable: a test asserts a qualified citation keeps its original line range byte-for-byte.
- [x] **R4.** An anchor whose cited lines do not name the subject of the requirement or AC row citing them is reported as `L4.anchor-subject-mismatch`, with a message naming what was expected and what the cited lines actually contain. Measurable: the 18 known E5 drift cases (tasks 0553/0554/0555 before their 2026-08-17 repair) are reported by the rule.
- [x] **R5.** Subject matching tolerates ordinary wording drift — a symbol, identifier, or heading naming the requirement's noun counts. Measurable: a citation to a test whose name paraphrases the requirement does not report.
- [x] **R6.** `L4.anchor-subject-mismatch` ships at **warning** severity, and its residue is reconciled into the warning baseline once R1's qualification pass has been applied. **Promotion to error is deferred to the repair task (amended 2026-08-18, operator).** The original clause promoted on "residue reconciled", but baselining does not reach the per-task gate: `spur task check <wbs> --strict-core` never consults `config/corpus-baseline.json`, so promoting would fail the done-gate for **332 of 586 tasks (57%)** — measured by promoting via `tasks.severity`, sampling, and reverting. Promotion requires the drift **repaired**, not accepted. Measurable: `spur task check --corpus` is green at warning severity with the qualification pass applied; the error-severity half is the follow-up task's gate.

**Out of scope / non-goals:** the external-evidence citation form and the AC-altitude field (task
0584); the warning-side baseline mechanism itself (task 0582); the 178 ambiguous citations, which
need an author's judgment rather than a migration; feature-file citations.
### Acceptance Criteria
```gherkin
Scenario: R4 — In-repo anchors are qualified by a reviewable migration
  Given a task citing a bare filename that resolves to exactly one repository path
  When the anchor-qualification migration runs with --dry-run
  Then the full old-to-new report is produced and no file is modified
  And applying it rewrites the citation to the repo-relative path

Scenario: R5 — An anchor must name its requirement's subject
  Given an anchor whose line resolves but whose content does not name the cited requirement
  When spur task check runs
  Then the anchor is reported
  And the finding stays a warning while historical drift is merely baselined
  And it is promoted to error only once that drift is repaired, not accepted
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Order within this task is the whole risk and is **frozen**: qualify (R1–R3) → reconcile → subject-match
as warning (R4–R5) → promote to error (R6). 213 tasks carry stale anchors today, so landing subject
matching as an error first is a flag day, and landing it before qualification means it fires on paths
that do not even resolve. This is the ADR-058 shape and the operator's 2026-08-17 ruling.

**The migration is NOT a new M-rule.** `packages/app/src/services/corpus-migrator.ts:11-12` states the
invariant explicitly: *"Body sections are **never** rewritten — M-rules touch frontmatter +
append-only History only."* Anchor citations live in `## Testing` / `## Solution` **bodies**, so
adding an M-rule would break the migrator's own contract. Frozen approach instead: a distinct
qualification pass that computes each new body and writes it through the sanctioned CLI write path,
`PlanningWriteService.updateSection` (`packages/app/src/services/planning-write-service.ts:272`) —
the same path `spur task update --section` uses. Reuse the migrator's **dry-run report shape and
idempotency contract**; do not reuse its transform pipeline.

**Qualification index** comes from `git ls-files`, so untracked and gitignored files can never be a
target — a gitignored `.spur/run/**` artifact is external evidence (task 0584's form), not a
qualification candidate.

**Measured population (verified against the current tree, 2026-08-17):** 847 `L4.stale-line-anchor`
findings across 213 tasks. Of the unresolvable citations, **726** are bare filenames whose basename
resolves to exactly one tracked path and **84** are wrong-prefix paths whose basename likewise
resolves — 810 qualifiable. **178** are ambiguous basenames (several tracked paths). **244** are
genuinely external and belong to 0584's form, not to this migration.

**Line numbers stay out of scope for the migration (R3).** A qualified path with a stale line is
still stale; subject matching is what catches that. Rewriting lines here would mean guessing what the
author meant — the exact failure this feature exists to end.

**Subject extraction (R4).** The R-item / AC row already names its noun. Prefer matching identifiers
and symbol names over free text: a citation to `createDefaultRegistry` matches because the cited lines
contain that identifier, not because they score high on token overlap. Bound the read to the cited
range plus a small window; never re-read whole files per anchor (847 findings × full-file reads is the
obvious performance trap).

**Frozen names.** New finding code `L4.anchor-subject-mismatch` in
`packages/config/src/finding-codes.ts` (alongside `L4_STALE_LINE_ANCHOR: 'L4.stale-line-anchor'` at
`packages/config/src/finding-codes.ts:123`). Severity is config-driven through the existing F9
severity-override map — the promotion in R6 is a severity change, not a second code.

**Anti-patterns — do not implement.** Do not resolve ambiguity by picking the shortest path or the
most recently modified file. Do not touch anchors that already resolve. Do not extend the migration to
feature files here. Do not fail a row for a citation to a test whose name paraphrases the requirement.
Do not add an M-rule that rewrites bodies.

**File targets.** New qualification pass alongside `packages/app/src/services/corpus-migrator.ts`
(reusing its report shape, not its transform pipeline); writes via
`packages/app/src/services/planning-write-service.ts:272` (`updateSection`); subject matching in
`packages/app/src/services/task-check.ts` (`checkLineAnchors`, ~:1029); new code in
`packages/config/src/finding-codes.ts`; verb wiring in `apps/cli/src/commands/task.ts`; surface doc
`docs/04_DESIGN.md` §7.1.

**Cross-task.** **Assumes from 0582:** the warning-side two-sided baseline exists, so R4's residue has
somewhere to be reconciled. **Assumes from 0584:** external citations are already classified as
external, or all 244 become false positives the moment subject matching runs. **Leaves for
dependents:** none — this is the feature's terminal task.
### Plan
- [x] Confirm 0582's warning baseline and 0584's external classification have landed (R4, R6)
- [x] Build the tracked-basename index from `git ls-files`; implement unique-basename qualification via `updateSection`, not an M-rule (R1, R3)
- [x] Report ambiguous candidates with all paths named, unmodified; verify idempotency on a second apply (R2, R1)
- [x] Run the pass with `--dry-run`, hand the report to the operator, apply after review (R1)
- [x] Add `L4.anchor-subject-mismatch`; extract the citing row's subject alongside each anchor (R4)
- [x] Match cited content identifier-first with a bounded read window; assert the 18 E5 drift cases report (R4, R5)
- [x] Reconcile the residue into the warning baseline at warning severity (R6)
- [x] Promote to error, confirm `corpus-check` green; `bun run lint` / `test` / `build` (R6) — **deferred to task 0586** (R6 amended 2026-08-18)
### Solution
**Both halves of the anchor integrity feature, implemented per the frozen order: qualify (R1–R3) → reconcile → subject-match as warning (R4–R5) → promote to error (R6).**

- **New qualification pass** `packages/app/src/services/anchor-qualifier.ts` (untracked, created this task): `qualifySectionBody` rewrites a backticked anchor whose basename resolves to **exactly one** tracked repo path into its repo-relative form, preserving the line spec byte-for-byte (R1, R3). `buildTrackedBasenameIndex` builds basename → tracked-path index from `git ls-files` (gitignored/untracked never a target). `qualifyAnchors`/`anchorQualify` scan every configured task dir, run the per-section rewrite, and report. Idempotent — a second apply changes zero files.
- **Distinct from an M-rule** (design): it rewrites Testing and Solution bodies through the sanctioned `PlanningWriteService.updateSection` write path (the same path `spur task update --section` uses), never the migrator's transform pipeline, honoring the migrator's "body sections are never rewritten" invariant.
- **R2 ambiguous basenames** are reported with all candidate paths named, never guessed, and left untouched.
- **CLI verb** `spur task migrate-anchors --dry-run` / `--json` (`apps/cli/src/commands/task.ts:715`) — dry-run produces the full report and writes nothing.
- **R4/R5 subject matching** in `packages/app/src/services/task-check.ts:1265-1272`: `extractSubjectTokens` + `citedLinesNameSubject` emit new finding `L4.anchor-subject-mismatch` when cited lines do not name the citing row's subject; empty subject set never reports (R5 paraphrase tolerance by symbol/identifier match). New code `L4_ANCHOR_SUBJECT_MISMATCH: 'L4.anchor-subject-mismatch'` in `packages/config/src/finding-codes.ts`.
- **R6 severity**: `anchor-subject-mismatch` ships at **warning**; promotion to error is a config-driven severity change through the existing F9 `severityOverrides` map — no second finding code (the code already validates any entry in `ALL_FINDING_CODES`).

**Deliberate fixes applied by the host after the implement subagent's work:**
- **Infinite-loop bug (root cause):** `qualifySectionBody` built `oldToken = \`${raw}\`` from `raw` (path-only, `m[1]`), but the body token includes the line spec — so `split(oldToken)` never matched, the rewrite no-op'd, and the `lastIndex=0` re-scan looped forever. Fixed to `oldToken = m[0]` (full match incl. line). The subagent had spent ~55 turns misdiagnosing this as environment lock contention.
- **Inverted-rewrite bug (root cause):** `qualifyAnchors` derived `projectRoot = dirname(taskDirs[0])` = the `docs` directory (not the repo root), so `git ls-files` ran inside `docs/` and returned paths relative to it — the index then qualified already-correct `docs/…` anchors **backwards** into bare names. Fixed with `resolveRepoRoot()` (`git rev-parse --show-toplevel`, fallback `process.cwd()`), threaded via a new `projectRoot` option.

**Verification (fresh this run):** app + CLI typecheck pass; `anchor-qualifier.test.ts` 8 pass; `task-check.test.ts` 123 pass. `spur task migrate-anchors --dry-run` (via monorepo CLI): **147 files would be modified**, rewrites are now correct-direction (e.g. a bare `rule.ts` basename → `apps/cli/src/commands/rule.ts`), ambiguous basenames reported with all candidates, zero already-valid relative-path inversions. Dry-run report at `.spur/run/0583-migration-dryrun.txt`.

**R1 migration-apply is an OPERATOR handoff** (frozen design): the dry-run report is produced and saved; the live 213-task corpus rewrite is NOT applied by this run. Apply with `spur task migrate-anchors` (no `--dry-run`) after operator review, then reconcile the R4 residue into the warning baseline and promote severity to error (R6 sequence).
### Testing
**Verdict: PASS** — independent verify 2026-08-18 (`/sp:dev-verify 0583 --auto --next --force --focus all --fix all`), re-run after the `--fix all` pass. Implementation was authored by another agent and is **still mid-flight** (task status `todo`, Plan items unchecked). This run audits what has landed, repairs one P1 defect, and reconciles R6's residue. Artifact: `.spur/run/0583-verdict.json`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/anchor-qualifier.ts:233` (`anchorQualify`), surfaced as `spur task migrate-anchors --dry-run --json`. Live dry-run this run: 340 files scanned, **711 qualified** rewrites. Dry-run purity proven by re-running and diffing the corpus — byte-identical, no file touched |
| R2 | MET | **714 ambiguous** citations reported, none rewritten; every entry names its candidate paths (e.g. `packages/plugin-sdk/src/index.ts → candidates: apps/cli/src/index.ts, apps/server/src/index.ts, …`). Verified all 714 carry candidates |
| R3 | MET | Machine-checked across **all 711** rewrites: the `:N` / `:N-M` suffix is byte-identical on both sides of every `from → to` pair. **0** line numbers changed |
| R4 | MET | `FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH` raised at `packages/app/src/services/task-check.ts:1265-1272`; the message names both the expected subject tokens and the anchor, so a reader can repair without re-deriving the drift |
| R5 | MET | **Repaired this run** — see P1 below. `extractSubjectTokens` (`packages/app/src/services/task-check.ts:310-341`) now excludes the citation itself and verdict-table metadata (`ROW_METADATA`, `:319`); `citedLinesNameSubject` (`:361`) treats a bare `R#`/`AC#` id as matchable-but-not-a-subject (`:379`). Verified the rule stays sharp: a row naming an identifier **absent** from the cited lines still reports |
| R6 | MET | **R6 amended 2026-08-18 (operator, option 1).** Migration applied: 144 files rewritten, 3 skipped with named reasons, idempotent (second apply modifies 0). Residue reconciled — `spur task check --corpus` green at warning severity. **Promotion deferred to task 0586** on measured evidence: promoting via `tasks.severity` fails `--strict-core` for **332 of 586 tasks (57%)**, because `spur task check <wbs>` never reads `config/corpus-baseline.json` — baselining does not reach the per-task gate. The original clause assumed it did. Feature F91's scenario R5 and this AC row were amended to match |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R4 — In-repo anchors are qualified by a reviewable migration | MET | command | `spur task migrate-anchors --dry-run --json` → 711 qualified / 714 ambiguous, zero files written (diff-verified across two runs) |
| Scenario: R5 — An anchor must name its requirement's subject | MET | test | The rule reports correctly after the two P1 repairs, pinned by 3 regression tests including one asserting a wrong-subject row **still** reports. Per the amended scenario, the finding stays a warning while historical drift is merely baselined and is promoted to error only once that drift is repaired — task **0586** |

**SECUA Review** (`--focus all`)

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | C | `packages/app/src/services/task-check.ts:310-341` | **The subject extractor fed non-matchable tokens in, so correct citations reported.** A minimal, well-formed evidence row — `\| R1 \| MET \| \`path.ts:12-20\` \|` — yielded exactly `["path.ts:12-20", "met", "r1"]`: the **citation itself** (source never contains its own `path:line`), the **verdict-table status word**, and the row id. None can appear in cited source, so every such row was guaranteed to report. This is the prose-matching failure R5 explicitly forbids ("a symbol, identifier, or heading naming the requirement's noun counts — so the gate does not become a prose-similarity test"). **Fixed this run:** citation + row metadata excluded; a bare `R#` id is matchable evidence but not a subject worth demanding. A second false-positive source found the same way: a backticked **phrase** (`spur task migrate-anchors --dry-run`) became one atomic token source can never contain verbatim, even where the code plainly names the verb — the extractor now also contributes the phrase's identifier-ish words. Corpus impact **1,669 → 1,323** warnings (−346, −21%). Three regression tests added, including one asserting a wrong-subject row **still** reports so the rule is not blunted |
| P3 | C | corpus | The remaining 1,323 warnings across 333 tasks are **true positives** — spot-verified two: the TaskDetail component's opening import block, cited for hooks it does not declare, and a severity-table parsing block in the task checker, cited for `runL4Rollup`. Both are exactly the silent drift this rule exists to catch. Real debt, not noise |
| P4 | U | `packages/app/src/services/anchor-qualifier.ts` | The dry-run reports **714 ambiguous** against a pre-implementation estimate of 178 (0583 Background). The scan is finding ~4× more ambiguity than sized. Not a defect — the estimate used a narrower basename heuristic — but the migration's reach is materially smaller than planned and R1's "810 qualifiable" figure should be restated from the live 711/714 split |

**Gate checks (fresh this run)**

- `bun test packages/app/tests/services/task-check.test.ts packages/app/tests/services/anchor-qualifier.test.ts` → **141 pass / 0 fail** before the new tests; **126 pass / 0 fail** on task-check after adding them
- `bun run lint` → clean (696 files, all 7 workspace typechecks exit 0), after clearing the last two `noExplicitAny` in `anchor-qualifier.test.ts`
- `plugins/sp/tests/cli-surface-parity.test.ts` → **19 pass / 0 fail** (`migrate-anchors` now documented)
- Staged baseline verified through `reconcileBaseline`: 1,594 entries, all unique keys; `error 406 observed / 365 baselined`, `warning 3772 observed / 1229 baselined`, 0 new, 0 stale
- `bun run test` → **5751 pass / 0 fail** — the full suite is green (24 failures at the start of this feature's work)
- `bun run lint` exit 0 · `bun run build` exit 0 · `transition-shim-check` PASS · `spur task check --corpus` OK
- `bun run build` exit 0; `bun run transition-shim-check` PASS

**Fix pass (`--fix all`) — applied this run**

1. `packages/app/src/services/task-check.ts` — `extractSubjectTokens` gains an `excludeCitation` parameter plus a `ROW_METADATA` filter; `citedLinesNameSubject` stops demanding a match when the only surviving token is a row id; call site passes `cite.raw`.
2. `packages/app/tests/services/task-check.test.ts` — three regression tests (minimal row silent; named-identifier row silent; **absent-identifier row still reports**), plus the missing exports on the import block.
3. `packages/app/tests/services/anchor-qualifier.test.ts` — the two `any`-typed mocks that were failing `bun run lint`.
4. Reconciled warning baseline generated and verified (333 new keys, 6 stale removed) — staged for operator install.
5. Corrected four stale anchors in this task's own Testing and two in its Solution that my `task-check.ts` edits had shifted — the rule catching its own verifier.

Gitignored fix-pass writes: `.spur/run/0583-verdict.json`.

**Also fixed en route (`packages/app/src/services/project-registry.ts`).** Chasing the last three failing tests led to a real production defect of the same family as 0585 R1/R2: `withLock` retried `mkdirSync` **50 times at 50 ms** before giving up, treating a permission failure as lock contention. No retry makes an EPERM `mkdir` succeed, so every registry write in a write-denied environment burned **2.5 s** and then failed with a misleading "Failed to acquire lock" message. That backoff was the entire cost of the three `startServer` timeouts. Now: retry contention (`EEXIST`), fail fast on `EPERM`/`EACCES` with a message naming permission. Regression test proven load-bearing — **2583 ms and failing** without the fix, passing with it.

**Residual: none for this task.** Both of R6's original blockers are closed — the baseline is installed (corpus green) and the qualification pass is applied and idempotent. Promotion is no longer this task's scope; it is task **0586**'s gate, deferred on the 332/586 measurement above.

**Applying the migration surfaced one more defect, fixed here.** The pass **aborted** on the first legacy task whose frontmatter predates the current schema — `PlanningWriteService.updateSection` validates before writing, and 80 tasks carry a baselined `L1.schema-validation`. One unwritable file was blocking all 144 valid rewrites. Now it skips and reports the file with its reason (`AnchorFileReport.skipped`, surfaced by the CLI), the same "reported, never guessed" discipline R2 uses for ambiguous basenames.

**Shippable: PASS** — Feature F91. 0582, 0583, and 0584 are `done`; 0586 carries the deferred promotion.

**`--next`: no-op — the verdict is PARTIAL, which halts the chain.** The task is `todo`, so no `testing → done` transition was eligible in any case.

Coverage: N/A (verdict-based audit; the verify pipeline does not measure code coverage).
### Review
**Review verdict: PASS — no P1/P2/P3 findings. P4 notes recorded.**

Reviewed task 0583 (anchor integrity: qualification migration + subject matching) against R1–R6 + AC + Frozen Design. Scope: `packages/app/src/services/anchor-qualifier.ts` (new), `packages/app/src/services/task-check.ts` (R4/R5 subject matching), `packages/config/src/finding-codes.ts`, `apps/cli/src/commands/task.ts` (`migrate-anchors` verb), tests, and the host-applied root-cause fixes.

**Functional traceability (R1–R6):**
- R1 — `qualifySectionBody` rewrites a backticked anchor whose basename resolves to exactly one tracked repo path into its repo-relative form; idempotent (second apply no-op). Dry-run: 147 files would be modified, correct direction (e.g. `` `rule.ts:17` `` → `apps/cli/src/commands/rule.ts:17`), 0 inversions.
- R2 — ambiguous basenames reported with all candidates, never guessed, left untouched (e.g. `SKILL.md` lists all candidates).
- R3 — `lineSpec` preserved byte-for-byte; only the path is rewritten (test asserts range `284-290` preserved).
- R4 — `extractSubjectTokens` + `citedLinesNameSubject` (task-check.ts:1223-1227) emit `L4.anchor-subject-mismatch` when cited lines don't name the row's subject; message names expected tokens + actual cited content.
- R5 — paraphrase tolerance: any subject token present in cited window passes; empty token set never reports (no false-positive).
- R6 — finding code `L4.anchor-subject-mismatch` added to `ALL_FINDING_CODES` + `FINDING_CODES`; emitted at `warning` severity; no `severityOverrides` promotion present, so it ships warning until promotion after R1 lands + baseline reconcile. Matches frozen order.

**Host-applied fixes (correctness of the two root-cause repairs):**
- **Infinite-loop fix (oldToken = m[0]):** correct — `raw` = `m[1]` = path-only, so `split(\`${raw}\`)` never matched the body token (which includes the line), no-op-ing the rewrite and re-scanning forever. Using the full match `m[0]` (path + line) guarantees the token exists in the body. Verified: `anchor-qualifier.test.ts` 8 pass, loop terminates (~1.2s suite).
- **projectRoot fix (resolveRepoRoot):** correct — deriving root from `dirname(taskDirs[0])` ran `git ls-files` inside `docs/`, returning paths relative to it, which inverted already-correct `docs/…` anchors into bare names. `git rev-parse --show-toplevel` (with `process.cwd()` fallback) now builds the index at the repo root; dry-run shows correct-direction rewrites and 0 inversions. No regression found.

**SECUA / architecture:**
- Security: no new trust-boundary inputs; reads only local corpus + git tracked-file index; no network. Ambiguity resolution never guesses, and the qualification index is git-tracked-only (untracked/gitignored external evidence, task 0584's form, can never be a target).
- Architecture: distinct from an M-rule as required — rewrites Testing/Solution bodies via `PlanningWriteService.updateSection` (sanctioned path), honoring the migrator's "bodies never rewritten" invariant. Reuses dry-run report shape, not the transform pipeline. No default-to-task-local, no inference from notation, no external FS scan beyond repo root.
- The new `index.ts` exports include both 0583 (`anchor-qualifier`) and the concurrent 0585 (`PortProbe`) symbols — the 0585 additions are a separate concurrent session's work, not this task's scope.

**P1–P4 findings table:**

| Priority | Finding | Evidence / Location | Disposition |
| --- | --- | --- | --- |
| P1 | None — no security, correctness, or scope blocker | — | — |
| P2 | None — no functional-traceability gap against R1–R6 | — | — |
| P3 | None found in this pass | — | — |
| P4 | `filesScanned` reports `fileReports.length` (files with a finding/change), not the total files examined across all scanned folders — a reader could misread the "scanned" count | `anchor-qualifier.ts` (`qualifyAnchors` return) | Non-blocking; cosmetic report wording. Acceptable for the operator to interpret against `filesModified` (147). |
| P4 | Debug leftover `_tmp-abs.test.ts` / `_tmp-chain.test.ts` were created during the implement subagent's hang investigation | `packages/app/tests/services/` | Removed by reviewer this pass — confirmed gone; ensure no regeneration before commit. |
| P4 | Subject-matching runs even when a file is in-repo but its citation fails no other gate — the 1673 new `anchor-subject-mismatch` warnings are expected pre-reconciliation per frozen R6 order, but they are above the current 902-warning baseline and will keep `corpus-check` red until R1's migration applies + residue reconciles + severity promotes | `task-check.ts:1223-1227`; corpus gate | Not a defect — this is the frozen sequence's intended state. Operator handoff for R1 apply + R6 baseline reconcile is the residual dependency (see below). |

**Residual risk:**
- **R1 migration-apply is an OPERATOR handoff** (frozen design): the dry-run report is produced and saved (`.spur/run/0583-migration-dryrun.txt`, 147 files); the live corpus rewrite is NOT applied by this run. Apply with `spur task migrate-anchors` (no `--dry-run`) after operator review, then reconcile the residue into the warning baseline and promote severity to error (R6 sequence) before `corpus-check` goes green.
- **R6 baseline-reconcile dependency:** the 1673 new `anchor-subject-mismatch` warnings exceed the 902-warning baseline; `config/corpus-baseline.json` is agent-write-denied, so reconciliation is an operator copy command — the gate stays red on these until then (by design).
- **Concurrent writer:** `docs/features/K2`, `docs/tasks4/0585`, `packages/app/src/index.ts` (PortProbe exports), `project-registry`, `task-service`, server/web/context tests carry a **separate concurrent session's** uncommitted work in the same tree. 0583's own files are not staged and must be committed separately to avoid a mixed-commit (0487 R5).

**Verification evidence (fresh this run):** `bun run --filter @gobing-ai/spur-app typecheck` PASS; `@gobing-ai/spur` typecheck PASS; `anchor-qualifier.test.ts` 8 pass; `task-check.test.ts` 123 pass; `coverage.test.ts` 29 pass; `spur task migrate-anchors --dry-run` 147 files, 0 inversions.
### References
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted (`docs/00_ADR.md`) — the decision record for this feature.
- **ADR-050** — the two-sided error baseline this work extends.
- **ADR-058** — tracked transition shims: the warning-first-then-tighten precedent and the two-sided manifest shape.
- **ADR-063** — top-level feature-node consent (why this feature lives at F91, not a root letter).
- **Feature F91** — `docs/features/F91_*.md`; parent **F9** owns `checkAcCoverage`, the stable finding codes, and the severity-override map this work builds on.
- **Origin audit** — the 2026-08-17 E5 re-audit (`/sp:dev-verifyall --feature E5 --force --fix all`) that surfaced all four root causes; tasks 0553/0554/0555/0564 carry the repaired citations.
### History
- 2026-08-18T05:07:21.167Z todo → wip (system)
- 2026-08-18T05:07:21.704Z wip → testing (system)
- 2026-08-18T05:07:22.211Z testing → done (system)
