---
template: issue
schema_version: 1
name: "Fix task-verdict answer parser consuming SECUA rows as AC rows"
description: ""
status: done
type: issue
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T17:17:41.364Z"
updated_at: "2026-08-18T20:23:55.782Z"
---

## 0590. Fix task-verdict answer parser consuming SECUA rows as AC rows

### Background
Found during task 0587's verify run (2026-08-18), widened during 0588's. Two defects in the
answer-file table parser `packages/app/src/services/task-verdict.ts`.

**1 — no section boundary.** `extractAcceptanceCriteria` sets an `inTable` flag when it meets the AC
header row and then consumes **every** subsequent 4-cell table row in the answer file — it has no
section boundary and never resets on a heading.

The verify answer-file schema documented in `plugins/sp/skills/code-verification/SKILL.md`
(§ Answer-File Schema Contract) places a 4-column SECUA table directly after the AC table:

```
| Priority | Dimension | Location | Finding |
```

So a schema-conformant answer file always yields a spurious failing check, e.g.

```
ac-row-dropped: 6 AC row(s) could not be parsed and were omitted from the verdict:
Priority (unrecognised status "Dimension"); P1 (unrecognised status "Correctness"); …
```

The two contracts contradict each other: the skill's documented shape cannot be parsed cleanly by the
parser that consumes it. The AC rows themselves still parse correctly, so this one is a false `fail`
check on every verdict artifact, not data loss.

**2 — GFM cell escape ignored.** All three table scanners split rows with `trimmed.split('|')`,
which splits on `\|` too. `\|` is the GFM-sanctioned way to put a literal pipe in a cell, so evidence
containing a pipe cannot be authored at all: an escape in the last column silently truncates the
evidence string, and an escape in an earlier column shifts `status` out of position so the **entire
row is dropped from the verdict**. Unlike defect 1, this one does lose data. Hit live on 0588, where
it cost two record cycles before the evidence was rewritten pipe-free.

Both were re-reproduced on the released tree (`spur` 0.3.51, commit `9fc8a9a5`) — see § Root Cause
for the commands and observed output, and § Q&A for the re-verification decision.
### Requirements
- [x] R1. Give `extractAcceptanceCriteria` a section boundary: reset `inTable` when a markdown
  heading (`^#{1,6}\s`) is met after the AC table opened, so the `### SECUA Review` table is never
  read as AC rows. The check must sit **before** the `if (!trimmed.startsWith('|')) continue;` guard
  at `packages/app/src/services/task-verdict.ts:180`, which currently swallows every heading before
  any boundary logic can see it. Keep the existing tolerance for header-name variants and keep
  `dropped[]` reporting for rows that are genuinely malformed *inside* the AC table — the 0398 R6
  rule ("never discard a row in silence") still holds.
- [x] R2. Honor the GFM cell escape when splitting answer-file table rows: split on **unescaped**
  pipes only and unescape `\|` to a literal `|` in the resulting cells. `\|` is the GFM-sanctioned
  way to place a pipe inside a table cell, so today the authoring contract in
  `plugins/sp/skills/code-verification/SKILL.md` cannot express evidence containing a pipe at all.
  Fix once in a module-private helper called by **all three** `trimmed.split('|')` sites —
  `extractRequirements:108`, `extractAcceptanceCriteria:183`, `extractChecks:319` — rather than
  patching one: all three truncate identically (verified on the released tree), so a single-site fix
  leaves the requirements and checks tables silently truncating.
- [x] R3. Regression tests in `packages/app/tests/services/task-verdict.test.ts` covering both
  defects: (a) an answer file following the documented schema (Verdict line, per-requirement table,
  AC table, SECUA table) parses all AC rows and produces **no** `ac-row-dropped` check; (b) an AC row
  whose evidence contains `\|` keeps its full evidence text and stays out of `ac-row-dropped`;
  (c) an AC row with `\|` in an early column keeps `status`/`evidenceType` alignment; (d) a
  requirement row whose evidence contains `\|` keeps its full evidence text; (e) a genuinely
  malformed row inside the AC table still reports `ac-row-dropped`.

**Out of scope (non-goals).** No change to the answer-file schema in
`plugins/sp/skills/code-verification/SKILL.md` — the parser is what is wrong, not the contract. No
section-splitting redesign of the parser (see Design § anti-patterns). No change to the
`ac-row-dropped` check name, its severity, or the accepted status/evidence-type vocabularies. The
unbounded `inChecks` flag in `extractChecks` is a latent sibling of R1 but is **not** in scope: its
header guard (`check`/`name` + `status`) does not collide with any table in the documented schema,
and no failure has been observed. Note it; do not fix it here.
### Acceptance Criteria
- [x] AC1. `bun test packages/app/tests/services/task-verdict.test.ts` green, including the new
  schema-conformant fixture that asserts no `ac-row-dropped` check.
- [x] AC2. Re-deriving a verdict from a schema-conformant answer file
  (`spur task verdict <wbs> --from-answer <file> --json`) emits no `ac-row-dropped` entry in
  `checks[]`. Reproduction fixture: `.spur/run/0588-verify-answer.txt`, which today yields
  `6 AC row(s) could not be parsed` naming `Priority` and the P2/P3/P4 SECUA rows.
- [x] AC3. A row with an unrecognised status inside the AC table still appears in `ac-row-dropped` —
  the silence guard is not weakened.
- [x] AC4. An AC row whose evidence contains a GFM-escaped pipe (`\|`) parses with its evidence text
  intact through to the end of the cell and does not appear in `ac-row-dropped`; a row carrying `\|`
  in an earlier column still resolves the correct `status` and `evidenceType` instead of being
  dropped on a shifted column.
- [x] AC5. A **requirement** row whose evidence contains `\|` keeps its full evidence text — the
  escape fix reaches `extractRequirements`, not only the AC table.
- [x] AC6. `bun run lint` and `bun run test` stay green, and the per-file coverage floor for
  `packages/app/src/services/task-verdict.ts` does not regress.
### Q&A
- **Deferred by operator decision (2026-08-18): re-verify after the current codebase is released,
  then decide whether this is still needed.** The defect is confirmed on the current tree (a
  schema-conformant answer file emits `ac-row-dropped` naming the SECUA rows), but it is a false
  failing *check* inside the verdict artifact — the AC rows themselves parse correctly, so no verdict
  has ever been mis-derived by it. That makes it safe to hold.
- **How to re-verify when the time comes:** run any `/sp:dev-verify <wbs>` that produces an answer file
  following `plugins/sp/skills/code-verification/SKILL.md` § Answer-File Schema Contract, then check
  `checks[]` in `.spur/run/<wbs>-verdict.json` for an `ac-row-dropped` entry listing `Priority` /
  severity labels. Present ⇒ still needed. Absent ⇒ close this task.
- **Re-verification outcome (2026-08-18, post-release):** STILL NEEDED. Run against released `spur`
  0.3.51 (commit `9fc8a9a5`) with `.spur/run/0588-verify-answer.txt`, a schema-conformant answer
  file: `ac-row-dropped = fail` with all six dropped rows sourced from the `### SECUA Review` table.
  Parser source re-read — `inTable` still has no reset. Not cancellable; proceeding.
- **Scope widened during that re-verification (R2/AC4):** reading the parser to confirm R1 surfaced a
  second defect in the same function and adjacent line — `split('|')` at `:183` ignores the GFM `\|`
  cell escape. It is strictly more severe than the SECUA-row defect: an escaped pipe in the evidence
  column silently truncates evidence text, and one in an earlier column shifts `status` so the whole
  AC row is dropped from the verdict. Both are one-function, one-diff fixes with a shared test file,
  so they are fixed together rather than split into a second ticket. Hit live during 0588's verify
  run, where it cost two record cycles before the evidence was rewritten pipe-free.
- **Why not a section-splitting redesign:** parsing the answer file into heading-delimited sections
  first and extracting each table from its own section is structurally cleaner but a much larger
  diff for the same observable outcome. The bounded fix (heading boundary + escape-aware split)
  matches the surgical-change rule; revisit only if a third table-adjacency defect appears.
### Design
**WHAT.** Two bounded repairs inside one file, `packages/app/src/services/task-verdict.ts`: a
heading boundary for the AC table scanner (R1), and an escape-aware cell splitter shared by all
three table scanners (R2). **No new API** — no new export, no signature change, no new type, flag,
config key, or CLI surface. Everything added is module-private.

**WHY here.** `extractAcceptanceCriteria` is the only scanner with no table-close mechanism at all;
`extractRequirements` already closes on the next known header (`:144`) and so is not corrupted by
the SECUA table today. The escape defect, by contrast, is shared by every scanner because each one
re-implements the same `trimmed.split('|')`. One helper is therefore both the root fix and the
smaller diff than three bespoke patches.

**WHERE (primary targets).**

| File | Change |
|---|---|
| `packages/app/src/services/task-verdict.ts` | add `splitTableCells`; call it at `:108`, `:183`, `:319`; add the heading boundary in `extractAcceptanceCriteria` |
| `packages/app/tests/services/task-verdict.test.ts` | R3 regression tests (extends the existing 34) |

**Frozen names.**

- Helper: `function splitTableCells(row: string): string[]` — module-private, not exported.
  Placed adjacent to the other module-private helpers in the same file.
- No change to `VerdictAcceptanceCriteria`, `VerdictRequirement`, `VerdictCheck`, `ColMap`,
  `normalizeStatus`, `normalizeAcceptanceCriteriaStatus`, `normalizeEvidenceType`.
- Check name stays exactly `ac-row-dropped`; its `status` stays `fail`; its evidence prose and the
  appended vocabulary listing stay byte-identical.

**Algorithm — `splitTableCells`.** Split on pipes not preceded by a backslash, then unescape:

1. Split `row` on `/(?<!\\)\|/`.
2. On each piece: replace `\|` with `|`, then `trim()`.
3. Drop empty leading/trailing pieces exactly as the current `.filter(Boolean)` does, so cell
   indices are unchanged for every row that contains no escape.

The lookbehind is the whole mechanism; Bun's regex engine supports it. Preserving step 3's
`filter(Boolean)` semantics is what makes this a safe drop-in — `colMap` indices in
`extractRequirements` are positional and must not shift.

**Algorithm — heading boundary (R1).** In `extractAcceptanceCriteria` only, as the **first**
statement of the loop body, before the existing `if (!trimmed.startsWith('|')) continue;` at `:180`:

```
if (inTable && /^#{1,6}\s/.test(trimmed)) { inTable = false; continue; }
```

Placement is load-bearing: today's `continue` at `:180` discards headings before any boundary logic
can observe them, which is precisely why the flag never resets. Leaving `inTable = false` also lets
a later AC header legitimately re-open the table, since the open guard at `:187` tests `!inTable`.

**Precedence.** The boundary closes the table; it does not report. A heading is a normal, expected
end-of-table and must never push a `dropped[]` entry — only a malformed row *inside* an open table
does that (0398 R6). Order within the loop: heading boundary → non-table `continue` → header detect
→ separator skip → row consume.

**Anti-patterns — do NOT implement.**

- Do **not** restructure the parser into a heading-delimited section splitter. Structurally cleaner,
  much larger diff, same observable outcome; revisit only if a third table-adjacency defect appears.
- Do **not** filter SECUA rows by matching `P1`–`P4` or the literal header `Priority | Dimension |
  Location | Finding`. That special-cases one table instead of fixing the missing boundary, and
  breaks the moment the SECUA table is renamed.
- Do **not** silence `ac-row-dropped` by weakening `normalizeAcceptanceCriteriaStatus` to accept
  SECUA-ish values, and do **not** narrow `dropped[]` reporting to make the check quiet. AC3 exists
  to catch exactly that shortcut.
- Do **not** hand-roll escape handling separately at each of the three call sites — that is the
  duplication this task is removing.
- Do **not** touch `extractChecks`' unbounded `inChecks` flag (see Requirements § non-goals); it
  receives the shared splitter and nothing else.
- Do **not** edit `plugins/sp/skills/code-verification/SKILL.md`. The contract is right; the parser
  is wrong.

**Handoff.** None — `dependencies: []`, and no dependent WBS is waiting on a contract from this
task. The only cross-task constraint is inbound: task `0398` R6's never-drop-in-silence rule, which
AC3 pins as a regression.
**Verified reference implementation.** Probed on Bun 1.3.14 against the four shapes below plus a
drop-in index-stability check; all pass, so the implementer should not re-derive this:

```ts
function splitTableCells(row: string): string[] {
    return row
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, '|').trim())
        .filter(Boolean);
}
```

| Probe row | Cells | Result |
|---|---|---|
| `\| AC1 \| MET \| command \| ...` | 4 | pass |
| evidence containing `\|` inside a backtick span | 4 | pass — evidence intact |
| `\|` in the id column | 4 | pass — status/type stay aligned |
| requirement row with `\|` in evidence | 3 | pass |
| escape-free row vs today's `split('\|')` | — | identical output (drop-in safe) |
**End-to-end prototype (both fixes, real fixture).** A standalone copy of
`extractAcceptanceCriteria` with the heading boundary and `splitTableCells` applied was run against
`.spur/run/0588-verify-answer.txt` on Bun 1.3.14, with and without the fixes:

```
BASELINE  acRows=4 dropped=6 :: Priority (unrecognised status "Dimension"); P2 (…"correctness"); …
WITH FIX  acRows=4 dropped=0
```

The four real AC rows are retained in both runs — the fix removes the six spurious SECUA drops
without costing a single genuine row. This is the AC2 outcome, demonstrated before implementation.
Confidence in the approach: **HIGH** (prototyped against the real fixture, not reasoned).
### Plan
- [x] Add module-private `splitTableCells` to `packages/app/src/services/task-verdict.ts`, using the
  verified reference implementation in Design (R2)
- [x] Replace the three `trimmed.split('|').map(trim).filter(Boolean)` chains with it — `:108`
  (`extractRequirements`), `:183` (`extractAcceptanceCriteria`), `:319` (`extractChecks`) (R2)
- [x] Add the heading boundary as the first statement of the `extractAcceptanceCriteria` loop body,
  ahead of the `!trimmed.startsWith('|')` guard at `:180` (R1)
- [x] Write the schema-conformant fixture test: Verdict line, per-requirement table, AC table, SECUA
  table — asserts every AC row parses and no `ac-row-dropped` check is emitted (R3a)
- [x] Write the escape tests: `\|` in AC evidence keeps full text and stays undropped; `\|` in an
  early AC column keeps status/evidenceType alignment; `\|` in requirement evidence keeps full text
  (R3b, R3c, R3d)
- [x] Assert the silence guard survives: a malformed row inside the AC table still reports
  `ac-row-dropped` — extend or mirror the existing case at test `:361` (R3e)
- [x] Run the narrow target first: `bun test packages/app/tests/services/task-verdict.test.ts`, then
  the end-to-end check `spur task verdict <wbs> --from-answer .spur/run/0588-verify-answer.txt
  --json` emits no `ac-row-dropped` in `checks[]` (AC1, AC2)
- [x] Full gate once green: `bun run lint` and `bun run test`, confirming the coverage floor for
  `task-verdict.ts` does not regress (AC6)
### Root Cause
Both defects live in `extractAcceptanceCriteria`
(`packages/app/src/services/task-verdict.ts:172-221`) and were re-reproduced on the released tree
(`spur` 0.3.51, commit `9fc8a9a5`) on 2026-08-18.

**1 — no section boundary (R1).** `inTable` is set at `:192` when the AC header row matches and is
**never reset** anywhere in the function; the only `inTable` sites in `:172-221` are `:176` (init),
`:187` (open guard), `:192` (set true) and `:199` (consume guard). The loop's first statement,
`if (!trimmed.startsWith('|')) continue;` (`:180`), discards every non-table line — headings
included — before any boundary logic could run. So once the AC table opens, every later 4-cell row
in the file is consumed as an AC row, including the `### SECUA Review` table that the answer-file
schema in `plugins/sp/skills/code-verification/SKILL.md` places directly after it.

Contrast `extractRequirements`, which *does* close its table (`:144`, `inTable = false`) — but by
recognising the *next known header* (`ac`/`acceptance`/`check`/`name` + status), not by a heading.
That narrower guard is why the requirements table is not currently corrupted: the SECUA header
`| Priority | Dimension | Location | Finding |` fails its id-like test, so it never re-opens. The AC
extractor has no equivalent guard at all.

**2 — GFM escape ignored (R2).** `trimmed.split('|')` (`:183`) splits on `\|` as well as `|`. Per
the GFM spec `\|` is the sanctioned way to put a literal pipe inside a table cell, so a conformant
answer file is mis-parsed by column shift.

**Observed, this tree:**

- Schema-conformant answer file `.spur/run/0588-verify-answer.txt` re-derived with
  `spur task verdict 0588 --from-answer` yields
  `ac-row-dropped = fail`, evidence `6 AC row(s) could not be parsed and were omitted from the
  verdict: Priority (unrecognised status "Dimension"); P2 (unrecognised status "correctness"); P2
  (unrecognised status "usability"); P3 (unrecognised status "correctness"); P3 (unrecognised status
  "correctness"); P4 (unrecognised status "—")` — every dropped row is a SECUA row. The four real AC
  rows still parsed MET, so the effect is a false failing check, not AC data loss.
- Evidence-column escape: a row whose evidence is `` `rg -c "^\| \*\*x"` returns 3 and exits 0 ``
  parses to evidence `` `rg -c "^\ `` — silently truncated at the escape.
- Early-column escape: a row whose id contains `\|` shifts `status` to the following cell and the
  whole row is dropped (`AC1 — pipe in the ID column \ (unrecognised status "second half")`).

The two contracts contradict each other: the shape `SKILL.md` tells authors to write cannot be
parsed cleanly by the parser that consumes it, and evidence containing a pipe cannot be authored at
all.
### Solution
| File | Change |
|---|---|
| `packages/app/src/services/task-verdict.ts:172-177` | Add module-private `splitTableCells(row: string): string[]` — splits on unescaped pipes (`/(?<!\\\\)\\|/`) then unescapes `\\|` to `|`, preserving the old `.filter(Boolean)` drop-in index semantics (R2). |
| `packages/app/src/services/task-verdict.ts:107` (`extractRequirements`) | Replace `.split('|').map(trim).filter(Boolean)` with `splitTableCells(trimmed)` so requirement evidence with a GFM-escaped pipe keeps full text (R2). |
| `packages/app/src/services/task-verdict.ts:200` (`extractAcceptanceCriteria`) | Replace the same split chain with `splitTableCells(trimmed)` (R2). |
| `packages/app/src/services/task-verdict.ts:191-197` (`extractAcceptanceCriteria`) | Add heading boundary `if (inTable && /^#{1,6}\\s/.test(trimmed)) { inTable = false; continue; }` as the first statement of the loop body, before the `!startsWith('|')` guard — closes the AC table at `### SECUA Review` so its rows never read as AC rows (R1). |
| `packages/app/src/services/task-verdict.ts:333` (`extractChecks`) | Replace the split chain with `splitTableCells(trimmed)` (R2, shared defect). |
| `packages/app/tests/services/task-verdict.test.ts:426-533` | Add `describe('answer parser fixes (0590)')` covering R3 a–e: schema-conformant SECUA file → no `ac-row-dropped`; `\\|` in AC evidence intact; `\\|` in early AC column keeps status/evidenceType alignment; `\\|` in requirement evidence intact; malformed row inside AC table still reports `ac-row-dropped`. |

Rationale: one shared escape-aware splitter is the root fix for all three scanners (each re-implemented the same `trimmed.split('|')`), and the heading-boundary reset addresses the only scanner with no table-close mechanism. No new API, no schema/contract change, no `ac-row-dropped` weakening (0398 R6 silence guard intact).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Heading boundary implemented at `packages/app/src/services/task-verdict.ts:191-197` — `if (inTable && /^#{1,6}\s/.test(trimmed)) { inTable = false; continue; }` placed as the first statement of the `extractAcceptanceCriteria` loop body, ahead of the `!startsWith('\|')` guard exactly as the frozen Design required. Re-read this run. Effect proven end-to-end: `.spur/run/0588-verify-answer.txt` re-derived via `bun run apps/cli/src/index.ts task verdict 0588 --from-answer` yields 4 AC rows and **no** `ac-row-dropped`, against 6 spurious SECUA drops before |
| R2 | MET | `splitTableCells` added at `packages/app/src/services/task-verdict.ts:172-177` (module-private, not exported) and wired at all three former `split('\|')` sites — `:107` `extractRequirements`, `:200` `extractAcceptanceCriteria`, `:333` `extractChecks`. All four anchors re-read this run. Behaviour proven by probe: a requirement row whose evidence is `` `jq -r '.a \| .b'` `` now parses to the full text with the escape resolved to a literal pipe |
| R3 | MET | `describe('answer parser fixes (0590)')` at `packages/app/tests/services/task-verdict.test.ts:426-533` with sub-tests (a)–(e) matching the Plan one-for-one. `bun test packages/app/tests/services/task-verdict.test.ts` → **44 pass, 0 fail, 138 expect()** (was 34 tests before this task) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — task-verdict suite green incl. the schema-conformant fixture | MET | test | `bun test packages/app/tests/services/task-verdict.test.ts` → 44 pass, 0 fail, 138 expect() calls; includes sub-test (a) asserting no `ac-row-dropped` on a Verdict + per-requirement + AC + SECUA file |
| AC2 — no `ac-row-dropped` from a schema-conformant answer file | MET | command | `bun run apps/cli/src/index.ts task verdict 0588 --from-answer .spur/run/0588-verify-answer.txt --json` → `verdict=PASS`, `acRows=4`, `ac-row-dropped present: false`. Source-local CLI used deliberately so the fixed tree is what is measured, not a PATH binary |
| AC3 — silence guard not weakened | MET | command | Probe answer file with a `BOGUS` status row inside the AC table → `1 AC row(s) could not be parsed …: AC-malformed (unrecognised status "BOGUS")`. 0398 R6 intact; `git diff` shows no change to `normalizeAcceptanceCriteriaStatus` or `normalizeEvidenceType` |
| AC4 — escaped pipe in AC evidence and in an early AC column | MET | command | Same probe: evidence cell `` `rg -c "^\| \*\*x"` returns 3 and exits 0 `` parses with full text and stays undropped; row id `AC-escape-early \| tail` keeps `status=MET` and `evidenceType=command`, i.e. no column shift. This very row is itself authored with `\|` — it round-tripped through the parser to reach this table |
| AC5 — escaped pipe in requirement evidence | MET | command | Same probe: requirement evidence `` `jq -r '.a \| .b'` returns 3 and exits 0 `` survives intact — the fix reaches `extractRequirements`, not only the AC table |
| AC6 — lint and test green, coverage floor not regressed | MET | command | `bun run lint` → biome clean + all 7 workspace typechecks exit 0. `bun run test` → **5775 pass, 0 fail**. `packages/app/src/services/task-verdict.ts` coverage **100.00% funcs / 99.29% lines**, far above the 90% floor and improved by this task. Suite exit code 1 is the pre-existing sandbox artifact on `process-inspector.ts` (83.95%, `[SKIP:spawn-denied]`), the only sub-90 file and untouched by this diff |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Parser under repair: `packages/app/src/services/task-verdict.ts:172-221` (`extractAcceptanceCriteria`)
- Missing-boundary anchors: `:180` (heading-swallowing `continue`), `:192` (`inTable = true`, never reset)
- Escape-unaware split: `:183` (`.split('|')`)
- Working boundary to mirror: `packages/app/src/services/task-verdict.ts:144` (`extractRequirements` closes on the next known header)
- Authoring contract the parser must accept: `plugins/sp/skills/code-verification/SKILL.md` § Answer-File Schema Contract
- Reproduction fixture (gitignored): `.spur/run/0588-verify-answer.txt` — schema-conformant, yields 6 spurious dropped rows
- Test file to extend: `packages/app/tests/services/task-verdict.test.ts` (34 tests; `ac-row-dropped` already covered at `:361` and `:383`)
- Silence guard that must survive: task `0398` R6
- Found during: task `0587` verify run (SECUA rows); task `0588` verify run (escape defect)
- GFM table escape rule: a literal `|` inside a cell is written `\|`
### History
- 2026-08-18T19:26:48.251Z todo → wip (system)
- 2026-08-18T19:42:31.003Z wip → testing (system)
- 2026-08-18T19:42:49.249Z testing → done (system)
