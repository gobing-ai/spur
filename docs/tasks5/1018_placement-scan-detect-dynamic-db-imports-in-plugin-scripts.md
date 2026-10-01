---
schema_version: 1
name: "Placement scan: detect dynamic DB imports in plugin scripts"
status: done
template: feature-impl
created_at: 2026-09-30T13:48:58.443Z
updated_at: "2026-10-01T00:46:54.572Z"
feature_id: A9

ac_altitude: task-local
---

## 1018. Placement scan: detect dynamic DB imports in plugin scripts

### Background

Found while re-verifying A9 tasks 1000–1007 (session review triage, 2026-09-30). The ADR-130 placement scan in `scripts/commands/script-contract-check.ts:536` detects DB access with `DB_IMPORT_RE`, which matches only static `import … from 'bun:sqlite' | 'drizzle-orm…'` statements. `plugins/sp/scripts/daily-summary/daily-summary.ts:300` opens a database through `const { Database } = await import('bun:sqlite');` and produces no `db-import` finding; its baseline row in `config/script-placement-baseline.json` lists only `budget`. The placement rule therefore passes while a plugin script holds direct DB access the contract is meant to surface.

Nothing was fixed for this during triage.

### Requirements

- [x] R1. The placement scan (`checkPlacement`, `scripts/commands/script-contract-check.ts`) reports a `db-import` finding for a dynamic `import('bun:sqlite')` / `import('drizzle-orm…')` in a scanned file under `plugins/sp/scripts` or `plugins/sp/hooks`, the same kind as for a static import.
- [x] R2. `plugins/sp/scripts/daily-summary/daily-summary.ts` no longer passes silently: its row in `config/script-placement-baseline.json` lists `db-import` next to `budget`, with a reason naming the read-only history-health query and this task.
- [x] R3. `import type` statements and comment lines mentioning `bun:sqlite` / `drizzle-orm` stay unreported, and a bare `'bun:sqlite'` string literal without `import(` stays unreported.

Out of scope: moving the daily-summary history-health read behind a `spur` CLI verb or an app bundle (needs operator consent for a public surface; follow-up only if requested); AST parsing; scanning `.mjs` twins; any other finding kind.

### Acceptance Criteria

- [x] AC1 — Dynamic DB import is reported as db-import (req: R1)
  Layer: `scripts/commands/script-contract-check.test.ts`, placement fixture block (from `:449`). A fixture script whose only DB reference is `const { Database } = await import('bun:sqlite');` yields exactly one `db-import` finding; the same for `await import("drizzle-orm/bun-sqlite")`.
- [x] AC2 — Type imports, comments and bare string literals are not reported (req: R3)
  Layer: same file. Fixture scripts holding only `import type { Database } from 'bun:sqlite'`, only a `// await import('bun:sqlite')` comment line, only a `* import('bun:sqlite')` JSDoc line, and only `const x = 'bun:sqlite'` each yield no `db-import` finding.
- [x] AC3 — daily-summary is baselined with db-import and the real tree is clean (req: R2)
  Layer: same file, real-tree assertion beside the plan §2 reconcile test (`:541`): the baseline entry for `plugins/sp/scripts/daily-summary/daily-summary.ts` has kinds `budget` and `db-import`, and `checkPlacement` on the repo root with the tracked baseline returns no findings. Command: `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` exits 0.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T13:55:17.660Z

- **Move daily-summary behind a CLI, or baseline it?** Baseline (closed). No existing `spur` verb or app bundle returns the history-health rows the script reads (`history_board_loop_findings` is read only inside `packages/domain/src/analytics/`), and a new public verb needs operator consent (AGENTS.md, public-surface consent). The row already carries "Keep (daily-summary/, plan §2)".
- **Does adding a kind violate "baseline can only shrink"?** No (closed). The rule is enforced as `stale-baseline` for a listed kind the file no longer produces (`script-contract-check.ts:606-616`); a newly detected kind on an existing row is a scan-widening correction, recorded in the row's reason. No new row is added, so the reconcile test's `dirKeys` count of 3 holds.
- **Comment handling?** Per-line skip of lines whose trimmed text starts with `//` or `*` (closed). Trailing comments on a code line and template-string content are not handled; mark with a `ponytail:` comment.
- **Other dynamic DB imports in the scanned dirs?** None: `rg "import\(\s*['\"](bun:sqlite|drizzle)" plugins/sp/scripts plugins/sp/hooks -g '*.ts'` returns only `daily-summary.ts:300` (checked 2026-09-30).

### Design

**What.** Add a second detector beside `DB_IMPORT_RE` (`scripts/commands/script-contract-check.ts:536`):

```ts
const DB_DYNAMIC_IMPORT_RE = /\bimport\(\s*['"](bun:sqlite|drizzle-orm(?:\/[\w.-]+)?)['"]\s*\)/;
```

In the per-file loop (`:587`), when the static regex does not match, test each line that is not a comment line (trimmed text starting with `//` or `*`) against the dynamic regex; on the first hit call `record(rel, 'db-import', \`dynamic import of ${m[1]}\`)`. At most one `db-import` finding per file, as today.

**Why.** ADR-130 forbids direct DB access in plugin glue; the scan must see both import forms or the rule passes on a real violation.

**Where.** `scripts/commands/script-contract-check.ts` (detector), `scripts/commands/script-contract-check.test.ts` (fixtures + real-tree assertion), `config/script-placement-baseline.json` (daily-summary row: `"kinds": ["budget", "db-import"]`, reason `Keep (daily-summary/, plan §2); read-only history-health query via dynamic bun:sqlite import (task 1018)`).

**Frozen names.** `DB_DYNAMIC_IMPORT_RE`; no new `PlacementFindingKind`, no new flag, no new API. The static path and its detail string `value-import of …` stay unchanged.

**Do not.** Parse an AST; strip comments from the whole file for the static path (changes existing behaviour); scan `.mjs` twins; edit `daily-summary.ts` or its twin; add a baseline row; touch `docs/plans/A9-script-placement-migration.md`.

**Dependencies / concurrency.** None declared. `config/script-placement-baseline.json` and `script-contract-check.test.ts` carry uncommitted changes in the main checkout; start from a tree where those are committed.

### Plan

- [x] 0. Precondition: working tree clean of other tasks' changes to `config/script-placement-baseline.json` and `scripts/commands/script-contract-check.test.ts`.
- [x] 1. Add failing tests for AC1 and AC2 to the placement fixture block of `scripts/commands/script-contract-check.test.ts`; add the AC3 real-tree assertion. Run `bun test scripts/commands/script-contract-check.test.ts` and see AC1/AC3 fail (R1, R2, R3).
- [x] 2. Add `DB_DYNAMIC_IMPORT_RE` and the per-line check in `checkPlacement` (R1, R3).
- [x] 3. Update the daily-summary row in `config/script-placement-baseline.json` (R2).
- [x] 4. Verify: `bun test scripts/commands/script-contract-check.test.ts`; `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo`; `bun run spur-check`.

### Solution

Change map (commit 43f745dfaafb0d535623a077f1c06348355867ca, 3 files, +71/−3):

- `scripts/commands/script-contract-check.ts` (+16/−1): added frozen `DB_DYNAMIC_IMPORT_RE` at `scripts/commands/script-contract-check.ts:537` beside `DB_IMPORT_RE`; in the `checkPlacement` per-file loop the else-branch now probes each non-comment line (`//`/`*` trimmed skip) and records at most one `db-import` finding per file with detail `dynamic import of ${m[1]}` at `scripts/commands/script-contract-check.ts:590-599`. Static path and its `value-import of …` detail unchanged; `ponytail:` comment records the trailing-comment/template-string ceiling per task Q&A.
- `scripts/commands/script-contract-check.test.ts` (+53): AC1 dynamic-import fixtures at `scripts/commands/script-contract-check.test.ts:487-508` (`bun:sqlite` and `drizzle-orm/bun-sqlite` each yield exactly one `db-import`); AC2 negative fixtures (import type, `//` comment, `*` JSDoc, bare literal) at `scripts/commands/script-contract-check.test.ts:512-528`.
- `config/script-placement-baseline.json` (+2/−2): daily-summary row kinds now `["budget","db-import"]` with the task-frozen reason at `config/script-placement-baseline.json:29-31`; no new rows — the AC3 real-tree assertion covers the row and the unchanged reconcile `dirKeys` count at `scripts/commands/script-contract-check.test.ts:676-684`.

Rationale: ADR-130 forbids direct DB access in plugin glue; the scan must see both import forms or a real violation passes silently (`plugins/sp/scripts/daily-summary/daily-summary.ts:300` opens `bun:sqlite` via a dynamic import). Baseline (not CLI move) per closed Q&A: no existing public verb owns that read.

Out of scope: moving the history-health read behind a CLI/app bundle, AST parsing, `.mjs` twins, `daily-summary.ts` edits, new finding kinds — per task Do-not list.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `DB_DYNAMIC_IMPORT_RE` at `scripts/commands/script-contract-check.ts:537` beside the static `DB_IMPORT_RE` (`scripts/commands/script-contract-check.ts:536`); when the static regex misses, a per-line scan records kind `db-import` with detail `dynamic import of <mod>` (`scripts/commands/script-contract-check.ts:594-599`). Re-read this run. |
| R2 | MET | `config/script-placement-baseline.json:29-31`: daily-summary kinds `["budget", "db-import"]`, reason names the read-only history-health query via dynamic bun:sqlite import and task 1018. |
| R3 | MET | Static regex excludes `import type` via `(?!type\b)` (`scripts/commands/script-contract-check.ts:536`); dynamic probe skips `//`, `*` and `/*` lines (`scripts/commands/script-contract-check.ts:596`, widened by 15b63fe35 to single-line block comments) and needs a literal `import(` so bare strings never match (`scripts/commands/script-contract-check.ts:537`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `scripts/commands/script-contract-check.test.ts:487-510` dyn-sqlite.ts and dyn-drizzle.ts each yield exactly one db-import finding. `bun test scripts/commands/script-contract-check.test.ts` this run: 26 pass / 0 fail, 81 expect(). |
| AC2 | MET | test | `scripts/commands/script-contract-check.test.ts:512-530` type import, `//` comment, JSDoc `*` line, single-line `/** … */` block (15b63fe35) and bare `'bun:sqlite'` literal → only the fixture's own db.ts is reported. Same run 26/0. |
| AC3 | MET | test | `scripts/commands/script-contract-check.test.ts:680-688` asserts daily-summary kinds `['budget','db-import']` and real-tree `checkPlacement` → `[]`; `bun apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` this run exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

REVIEW — task 1018 (review-only), commit 43f745dfa, worktree sp/runall-A9-485e

VERDICT: APPROVE-WITH-NOTES — 0 P1, 0 P2, 1 P3 (deferred per closed Q&A), 2 P4 advisory.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 (blocker) | Traceability | — | none (R1/R2/R3 all verified: dynamic `import('bun:sqlite')` / `import('drizzle-orm/bun-sqlite')` in `plugins/sp/scripts` and `plugins/sp/hooks` yields one `db-import` finding with detail `dynamic import of …` via the frozen `DB_DYNAMIC_IMPORT_RE` (`scripts/commands/script-contract-check.ts:537`); the daily-summary baseline row now lists `["budget", "db-import"]` with the task-frozen reason naming the read-only history-health query and task 1018 and no new rows (dirKeys still 3); `import type`, `//`/`*` comment lines and bare `'bun:sqlite'` literals stay unreported; static path and `value-import of …` detail unchanged) | — |
| P2 | Quality | — | none (the else-branch at `scripts/commands/script-contract-check.ts:589` runs only after the static regex misses; if/else plus the `break` after the first hit preserves at most one `db-import` finding per file; regex probes confirm `\bimport\(` rejects `ximport(` / `importx(`, accepts inner-paren whitespace, and captures `drizzle-orm/bun-sqlite` exactly as AC1 asserts) | — |
| P3 | Quality | `scripts/commands/script-contract-check.ts:595` | single-line block comments (trimmed text starting with `/*`, e.g. `/** Opens DB via import('bun:sqlite') */`) are not skipped by the trimmed `//`/`*` rule and would produce a false `db-import` finding (probe-verified); this third comment shape is missing from the declared ponytail note, which lists only trailing comments on code lines and template-string content | DEFER — the closed Q&A froze the skip rule to `//`/`*` prefixes, so deviating would violate the approved design; the static `DB_IMPORT_RE` path has the identical comment exposure and was deliberately left unchanged; no occurrence in the scanned dirs (rg probe returns nothing, rule run exits 0); failure direction is loud-and-safe, widen only on an actual false positive |
| P4 | Quality | `scripts/commands/script-contract-check.ts:537` | `DB_DYNAMIC_IMPORT_RE` does not match `import ('bun:sqlite')` (space before the paren), two-segment `drizzle-orm/x/y` specifiers, or multi-line dynamic calls; the regex is the task-frozen shape and the static `DB_IMPORT_RE` shares the spacing/subpath limits, so no regression versus the static path | — |
| P4 | Quality | `scripts/commands/script-contract-check.ts:595` | theoretical false negative: a code statement whose trimmed text starts with `*` (a one-line generator method containing a dynamic DB import) is skipped by the comment rule; contrived and absent from `plugins/sp/scripts` / `plugins/sp/hooks` (rg check) | — |

Summary: Commit 43f745dfa implements R1/R2/R3 exactly to the frozen design — regex, detail strings, baseline reason, and the else-branch ordering all match the task spec verbatim, the three tests genuinely assert the contract (AC1 pins length/kind/exact details, AC2 expects exactly the static fixture `db.ts`, AC3 pins the exact kinds array and a clean real-tree check whose stale-baseline logic transitively proves daily-summary.ts:300 is detected), and all 26 tests plus the `sp-script-placement` rule run pass with exit 0. On the declared implementer note: verified it creates no false-negative hole — trailing comments on code lines do not block matching (probe: `await import('bun:sqlite'); // drv` still detected), template-string content is a false-positive-shaped risk, rg confirms daily-summary.ts:300 is the only real dynamic DB import in the scanned dirs and sits on a plain code line, and the only theoretical false-negative shape is the contrived `*`-prefixed one-liner (P4). The one undeclared residual is the single-line block-comment false positive (P3, deferred per the closed Q&A). Scope clean: commit touches only the baseline, the test file and the checker; daily-summary.ts, its twins, `PlacementFindingKind`, and docs/plans are untouched. Minor cosmetic note: the ponytail comment says "widen only on a false negative" while the unhandled cases it names (trailing comments, template strings) are false-positive-shaped — worth rewording if the file is touched again.

Commands run: `bun test ./scripts/commands/script-contract-check.test.ts` (26 pass / 0 fail); `bun run apps/cli/src/index.ts rule run --rule sp-script-placement --no-logo` (all rules passed, exit 0); `git show 43f745dfa --stat` (3 files: baseline ±4/±2, test +53, checker +17/−1); `rg` dynamic-import and block-comment probes over the scanned dirs; `bun -e` regex/comment-skip probes (14 cases).


Post-batch follow-up (operator instruction, runall-A9-485e merge): the P3 DEFER above is RESOLVED inline — the per-line comment skip now also drops single-line `/* … */` block comments (the third shape), the ponytail note declares all three shapes, and a regression fixture was added to the AC2 test (bun test script-contract-check.test.ts: 26 pass / 0 fail). The deferred-residual follow-up task was removed rather than kept; the fix lands with the batch merge.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-30T13:55:20.630Z backlog → todo (system)
- 2026-09-30T21:31:58.520Z todo → wip (system)
- 2026-09-30T21:55:57.856Z wip → testing (system)
- 2026-09-30T22:23:19.779Z testing → done (system)

