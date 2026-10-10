---
schema_version: 1
name: Parse raw Git numstat paths for sensitive gate routing
status: done
template: feature-impl
created_at: 2026-10-10T07:29:47.892Z
updated_at: "2026-10-10T19:12:07.689Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1160-verdict.json
---

## 1160. Parse raw Git numstat paths for sensitive gate routing

### Background

Git C-quoted non-ASCII hook paths are classified literally and bypass sensitive path routing under default core.quotepath Evidence: `plugins/sp/scripts/task-diffstat.ts:193`; `plugins/sp/scripts/task-diffstat.ts:202`; `plugins/sp/scripts/task-diffstat.ts:216`. Review a71c confirmed this using temporary real Git repository with core.quotepath=true and tracked plugins/sp/hooks/保護.ts; result sensitive:false. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Confirmed runDiffstat uses git diff --numstat without -z, newline-splits records and expands textual arrows. ls-files already uses -z; the anchored-base and artifact failure paths are present.
- NUL rename records have an empty filename in the count header followed by separate old/new NUL paths; filenames may themselves contain tabs, newlines or literal ' => '. Split only the first two header tabs, not all tabs or arrows.
- Raw newline-bearing directories also expose globToRegex's dot wildcard: its **/ regex does not span newlines. Enable dotAll on the existing anchored matcher so a .sql path under such a directory remains sensitive.
- expandDiffPath's only consumers are this parser and its unit pins; the human-format helper becomes obsolete with -z and should be removed together with those obsolete expectations, retaining real rename coverage.

### Requirements

- [x] R1. Consume git diff --numstat -z and parse its NUL filename and rename records while preserving raw paths for classification
- [x] R2. ASCII, binary and ordinary rename counts remain correct and every sensitive old or new path selects the safety lane
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [x] R4. Malformed or truncated numstat framing fails safely instead of dropping paths; tab/newline and literal arrow filenames remain exact, and sensitive glob matching spans newline directories. No gate threshold or artifact schema changes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given non-ASCII hook and SQL paths and a rename into a sensitive directory in a real Git fixture
  When runDiffstat classifies the changes
  Then the raw paths are retained and sensitive is true

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given existing ASCII, binary and rename fixtures
  When the existing supported operation executes
  Then ASCII, binary and ordinary rename counts remain correct and every sensitive old or new path selects the safety lane
```
```gherkin
Scenario: AC3 — Unusual and malformed paths cannot bypass safety (req: R1, R3, R4)
  Given tab, newline, brace and literal-arrow filenames including a SQL file under a newline directory
  When the NUL numstat parser consumes them
  Then paths retain their exact strings and sensitive classification still applies
  And a truncated header or missing rename half emits the existing fail-safe result
```

### Q&A

- Closed: use --numstat -z framing, first two header tabs and explicit two-path rename records. Never parse quoted human output or arrows.
- Closed: keep sorted unique path-count semantics and count renamed line totals once. Binary '-' means zero lines, not an ignored path.
- Closed: malformed framing fails safe; enable dotAll for existing glob semantics on newline directories. No arbitrary-byte/encoding or threshold redesign.

### Design

**Algorithm / unchanged shape.** In plugins/sp/scripts/task-diffstat.ts change only tracked git argv to ['diff','--numstat','-z',base]. Keep GitRunner stdout:string and the Diffstat schema/thresholds/output paths. Treat empty stdout as an empty diff. Otherwise require a final NUL and consume NUL records sequentially. Split each count header at its first and second tab: accept decimal counts or '-' binary sentinels; the remaining bytes are the path even when they include tabs/newlines. Nonempty path is one ordinary record. Empty path is Git's rename/copy form: consume exactly two following nonempty NUL path records and add both to the Set. Add numeric counts once per count header, never once per rename half; '-' contributes no lines. Missing counts/path/rename halves or malformed framing invokes existing failSafe (sensitive:true, zero counts, diagnostic, existing exit semantics), never silently skips a row. Validate finite safe integer counts. A private parser is allowed only if it reduces the runner's clarity burden; no new exported API is needed. Remove obsolete expandDiffPath and its textual-arrow unit assertions after tracing all callers (currently only this test suite).

**Raw matching.** Do not C-unescape paths or disable core.quotepath. Keep valid UTF-8 paths exactly as decoded by the current spawn string contract, including quotes, tabs, newlines, braces and literal arrows. Enable RegExp dotAll in globToRegex so existing ** globs match newline directories too; keep the prefix/glob lists and >400 guard unchanged. paths remains a sorted unique array and files equals that array's length (both rename halves count as paths, as before). Existing untracked -z processing and .spur bookkeeping exclusions remain intact. No arbitrary-byte filename encoding redesign.

**Test layer.** Extend plugins/sp/tests/task-diffstat.test.ts using its real temporary Git fixture, core.quotepath=true and anchored base. Track then modify non-ASCII hooks and SQL paths; rename into and out of sensitive directories with Git rename detection; include ordinary non-sensitive rename, binary file, tab/newline directory, literal arrow/brace/quote names and untracked paths. Pin raw exact paths and once-only insertion/deletion counts. Fake GitRunner cases must assert -z argv and cover empty output, truncated/malformed NUL header and incomplete rename; compare fail-safe artifact plus stderr. Add source/node-twin parity for Unicode and rename rows. No real .github or drizzle writes outside the temporary repo.

**Generated/doc owners.** Regenerate task-diffstat.mjs only through superskill script convert sp task-diffstat.ts --json and run script-contract/standalone checks. Update the module numstat-format doc and any exact tracked format claim in the owning gate contract; no threshold/policy/public flag change. 1154 owns gate composition and 1150 owns budgets; no new dependency on either.

### Plan

1. [ ] R1/R3: add real Git Unicode/rename regression and exact-count fixtures; set core.quotepath=true and retain pre-fix failure.
2. [ ] R1/R2/R4: switch argv to -z, consume NUL count/ordinary/rename records, remove obsolete human-arrow helper and preserve failSafe semantics.
3. [ ] R4: enable dotAll in the existing sensitive glob matcher; add unusual-name and malformed-frame controls plus unchanged untracked/binary behavior.
4. [ ] Run plugin task-diffstat suite; regenerate via superskill script convert sp task-diffstat.ts --json and prove Node twin/source parity and standalone contracts.
5. [ ] Run required task gate, review/verify/record exact raw-path/count evidence and commit without changing thresholds or lane policy.

### Solution

Switched the tracked-diff probe to `git diff --numstat -z` and taught the parser Git's NUL framing, so a changed path reaches the sensitive matchers byte-exact instead of as C-quoted text, and a rename/copy is two explicit path records instead of a rendered `old => new` string. The sensitive glob matcher gained `dotAll` so `**` spans newline-bearing directories.

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `plugins/sp/scripts/task-diffstat.ts:177` | The tracked argv is now `['diff','--numstat','-z',base]` — Git emits raw paths and stops C-quoting non-ASCII names under the default `core.quotepath`, which is what let `plugins/sp/hooks/保護.ts` classify as `sensitive: false`. |
| `plugins/sp/scripts/task-diffstat.ts:184` | Framing is checked before parsing: non-empty output must end with NUL, otherwise the probe fails safe with a named diagnostic instead of parsing a truncated frame. |
| `plugins/sp/scripts/task-diffstat.ts:184` | Records are consumed sequentially from the NUL split. Each header is split at the **first two** tabs only, because the path may itself contain tabs, newlines or a literal ` => `; an empty path field is Git's rename/copy form, which consumes exactly the two following non-empty path records and adds both. Counts are added once per count header, never once per rename half, and a missing/malformed count, path or rename half invokes the existing `failSafe`. |
| `plugins/sp/scripts/task-diffstat.ts:128` | `addCounts`: counts must be a decimal integer or Git's `-` binary sentinel and must be safe integers, so a malformed count fails closed rather than mis-summing. |
| `plugins/sp/scripts/task-diffstat.ts:104` | `globToRegex` builds its RegExp with `dotAll`: the existing `**` expansions use `.`, so without it a `**/*.sql` glob could not match a `.sql` file under a directory whose name contains a newline. |
| `plugins/sp/scripts/task-diffstat.ts:10` | Module doc updated to the `-z` contract (raw paths, explicit rename records, fail-safe framing) — the previous text described the newline/arrow format that no longer exists. |
| `plugins/sp/tests/task-diffstat.test.ts` | The obsolete `expandDiffPath` unit pins (and the helper) are gone; the rename case is now a real `git mv`, plus a pure-rename case pinning once-only counts. New `1160` cases: `-z` argv + raw NUL records, rename pair with once-only counts, tabs/newlines/literal arrows byte-exact, `**/*.sql` matching across a newline directory, binary + untracked under `-z`, empty output as an empty diff, five malformed-frame controls, the `core.quotepath=true` non-ASCII hook reproduction, rename into *and out of* a sensitive directory, and Node-twin parity against the same fixture. |
| `plugins/sp/scripts/task-diffstat.mjs` | Regenerated twin (`superskill script convert sp task-diffstat.ts`); `script-contract-check` PASS (23 scripts, 0 violations) and the Node twin parses the Unicode/rename fixture identically. |

Rationale: the classifier is a safety gate, and it was reading a *rendered* representation of paths. Under `core.quotepath` (Git's default) a non-ASCII hook path arrived as `"plugins/sp/hooks/\344\277\235\350\255\267.ts"`, which matches neither the `plugins/sp/hooks/` prefix nor `**/*.sql`, so the diff was routed to the fast lane. Consuming Git's machine format removes the entire class: no unescaping heuristics, no arrow reconstruction, and a malformed frame now fails closed instead of silently dropping a row. Nothing about the thresholds, the sensitive list, the artifact schema or the lane policy changed.

The module sits at the 250-line `GLUE_BUDGET_LINES` ceiling precisely; the added `-z` framing fits only because the obsolete `expandDiffPath` helper (18 lines) was deleted with it, and the parser was written tightly rather than padded. `script-contract-check --placement-only` reports 0 findings.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/task-diffstat.ts:177` (`git diff --numstat -z`), `:184` (NUL split, tail dropped), `:186-188` (header split at the first two tabs), `:190-193` (raw path added verbatim; empty path field = rename form), `:200-203` (old + new path). Tests: `plugins/sp/tests/task-diffstat.test.ts` asserts the `-z` argv, raw records, the rename pair and byte-exact tab/newline/` => ` names |
| R2 | MET | Counts added once per count header (`:194-195`), `-` binary sentinel contributes no lines, `files` = sorted unique path count, untracked `-z`/`.spur` handling untouched (`:210-218`). Tests: the pure-rename case pins `insertions: 1` for a sibling-only change; the binary + untracked case pins `0/0` and `sensitive: false`; the pre-existing `$schema` and count suites still pass unedited |
| R3 | MET | New reproducing regression: `core.quotepath=true` with `plugins/sp/hooks/保護.ts` yields `paths: ['plugins/sp/hooks/保護.ts']` and `sensitive: true` (pre-fix: `sensitive: false`), plus rename into and out of `drizzle/`, and the Node twin parses the same fixture to an identical row |
| R4 | MET | `:179-180` fails closed on a non-NUL-terminated frame; five malformed shapes each produce a named `git diff --numstat -z` diagnostic with `sensitive: true`; `addCounts` (`:128`) rejects non-decimal counts and non-safe-integer values; `globToRegex` (`:88`) is built with `s` (dotAll) so `**/*.sql` spans a newline-bearing directory — pinned by a direct `sensitiveReasonForPath` assertion |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | `bun test --preload ./tests/setup.ts plugins/sp/tests/task-diffstat.test.ts` — 31 pass / 0 fail; the `core.quotepath=true` case asserts `sensitive: true` for the non-ASCII hook path, and the rename-into/out-of-`drizzle/` case asserts both raw paths are present and the lane is safety |
| AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | Same suite: `dir\twith-tab/x.sql`, `dir\nnewline/x.sql` and `a => b{c}.ts` are returned byte-exact, and the pure-rename case shows the pair contributes its counts exactly once (`insertions: 1` from the sibling only) |
| AC3 — Unusual and malformed paths cannot bypass safety (req: R1, R3, R4) | MET | test | Same suite: `test.each` over five malformed frames (unterminated record, missing separator, non-numeric count, one rename half, empty rename half) each asserts exit 0, `sensitive: true`, an empty diff and a `git diff --numstat -z` diagnostic on stderr |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1160
**Scope:** 1160 diff (2 files: `plugins/sp/scripts/task-diffstat.ts` + its regenerated `.mjs` twin, `plugins/sp/tests/task-diffstat.test.ts`, plus the task file)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | `task-diffstat.ts` now sits exactly on the 250-line `GLUE_BUDGET_LINES` ceiling, so the next change to this script must delete rather than add. The `-z` rewrite fit only because it removed the 18-line `expandDiffPath` helper. | `plugins/sp/scripts/task-diffstat.ts:1` | ACCEPTED |
| 2 | P4 (advisory) | correctness | The module doc no longer spells out the raw-path rationale as explicitly as earlier drafts, because the doc paragraph is what had to give way to the line budget. The behaviour is pinned by tests instead. | `plugins/sp/scripts/task-diffstat.ts:10` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/scripts/task-diffstat.ts:177` uses `git diff --numstat -z`; records are consumed from a NUL split (`:184`) with the header split at the first two tabs only (`:187-188`), so a raw tab/newline/` => `-bearing path is added verbatim (`:190-193`) and a rename pair contributes two path records (`:200-203`). Pinned by `plugins/sp/tests/task-diffstat.test.ts` (`-z` argv, raw NUL records, tabs/newlines/literal arrows byte-exact) |
| R2 | MET | Counts are added once per count header (`:194-195`), `-` contributes no lines, `files` still equals the sorted unique path count, and the untracked/`.spur` handling is untouched (`:210-218`). Pinned by the pure-rename once-only case, the binary + untracked case and the two pre-existing `$schema`/counts suites |
| R3 | MET | New real-Git regression: `core.quotepath=true` with `plugins/sp/hooks/保護.ts` now classifies sensitive (the a71c reproduction), plus rename into *and out of* `drizzle/` and Node-twin parity against the same fixture |
| R4 | MET | Framing is validated before parsing (`:179`) and five malformed shapes (unterminated record, missing separator, non-numeric count, one rename half, empty rename half) each fail safe with a named diagnostic; `addCounts` (`:128`) rejects non-decimal counts and non-safe-integer values; `globToRegex` (`:88`) uses `dotAll` so `**/*.sql` matches under a newline-bearing directory. No threshold, artifact-schema or lane-policy change |

##### Acceptance Criteria Verification

AC1 (reproducing edge case is safe) is covered by the `core.quotepath=true` hook fixture plus the
rename-in/rename-out cases; AC2 (existing behavior remains supported) by the untouched counts/schema
suites and the `-z` binary/untracked case; AC3 (unusual and malformed paths cannot bypass safety) by
the byte-exact tab/newline/brace/arrow cases and the five malformed-frame controls.

##### Residual Risk

The line-budget finding above is the only structural residual: this script is at its ceiling. No
security concern — the change makes the safety classifier strictly more likely to fire, never less —
and no efficiency concern: one `-z` diff replaces one newline diff, and the parser is a single pass.

**Next:** proceed to verify.

### References

`plugins/sp/scripts/task-diffstat.ts:193`; `plugins/sp/scripts/task-diffstat.ts:202`; `plugins/sp/scripts/task-diffstat.ts:216`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 4.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:29:52.004Z backlog → todo (system)
- 2026-10-10T18:59:07.055Z todo → wip (system)
- 2026-10-10T19:11:59.714Z wip → testing (system)
- 2026-10-10T19:12:02.348Z testing → done (system)

