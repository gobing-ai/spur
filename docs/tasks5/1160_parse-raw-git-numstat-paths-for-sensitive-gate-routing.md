---
schema_version: 1
name: Parse raw Git numstat paths for sensitive gate routing
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:47.892Z
updated_at: "2026-10-10T16:31:14.241Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
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

- [ ] R1. Consume git diff --numstat -z and parse its NUL filename and rename records while preserving raw paths for classification
- [ ] R2. ASCII, binary and ordinary rename counts remain correct and every sensitive old or new path selects the safety lane
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [ ] R4. Malformed or truncated numstat framing fails safely instead of dropping paths; tab/newline and literal arrow filenames remain exact, and sensitive glob matching spans newline directories. No gate threshold or artifact schema changes.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

