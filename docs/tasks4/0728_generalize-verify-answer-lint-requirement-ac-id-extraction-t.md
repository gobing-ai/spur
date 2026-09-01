---
schema_version: 1
name: "Generalize verify-answer-lint requirement/AC ID extraction to the full corpus convention set"
status: done
template: issue
created_at: 2026-08-31T23:16:55.461Z
updated_at: "2026-09-01T00:53:58.030Z"
feature_id: F91
ac_numbering: task-local
ac_altitude: task-local
---

## 0728. Generalize verify-answer-lint requirement/AC ID extraction to the full corpus convention set

### Background

Task 0727 (F91) failed at verify on 2026-08-31 (run `2c5949b8`): the join sequence's hard lint gate
`verify-answer-lint` (0726 R3) rejected a schema-valid answer with 6 findings, all one false-positive
class. The verifier's answer rows referenced `R1`–`R3` / `AC1`–`AC3`, which the task declares in the
corpus-dominant forms — checkbox requirements `- [ ] R1.` and plain-bullet ACs `- AC1:` — but the
linter's extractors only recognize the 0726 rendering: bold requirement IDs (`**R1.**`, matched by
`extractRequirementIds`) and checkbox AC labels (`- [x] AC1:`, matched by `extractAcIdentities`).
Replicated against `spur task show 0727 --json` content: `reqIds=[]`, `acIdentities=[]` → every row
flagged "unknown". A sibling survey shows the corpus convention is the opposite of the linter's
assumption: 20+ tasks (0700–0725) use `- [ ] R1.` requirements; 0713 and 0727 use plain `- AC1:`
bullets; only 0726 uses bold IDs and checkbox ACs.

`spur task verdict` (a different extractor) matched all three requirement rows and derived PASS, so
only the lint is format-narrow. Because the lint is a hard action (0726 R3: halt before verdict
derivation), the run failed at verify; the 0727 verdict artifact was tainted (derived after the
failed halt) and voided. The false-positive class blocks every future task whose doc uses the
dominant corpus forms — i.e. the gate 0726 shipped misfires on most of the corpus it guards.

Evidence: run log `.spur/run/2c5949b8-ea1d-4294-8d2c-4ae9f25358e2.log` (22:06–22:08Z entries);
voided artifact `.spur/run/0727-verdict.voided.json`; 0726-style task
`docs/tasks4/0726_*.md` (Requirements `- [x] **R1. …**`, ACs `- [x] AC1 (R1): …`).

### Requirements

- [x] **R1. Generalize requirement-ID extraction.** In `plugins/sp/scripts/verify-answer-lint.ts`
  (`extractRequirementIds`), yield declared IDs from every established corpus form in the
  Requirements section: bold (`**R1. Title.**`, current), checkbox (`- [ ] R1. Title.`), plain
  bullet (`- R1. Title.`), and bare-ID lead (`**R1**` / `- R1:`). Nested sub-IDs (`R1.1`) keep
  working. Unknown-ID findings must fire only for IDs absent from ALL forms.
- [x] **R2. Generalize AC-identity extraction.** In `extractAcIdentities`, yield identities from
  checkbox labels (`- [x] AC1 (R1): …`, current) AND plain-bullet forms (`- AC1: Given …`) in the
  Acceptance Criteria section; the leading-token rule (label text and first word) applies to both.
  Feature-scenario titles remain an accepted identity source.
- [x] **R3. Contract tests pin the generalization.** Fixtures for the 0726 rendering, the 0727
  rendering, and a mixed doc all pass extraction; an answer referencing genuinely unknown IDs
  still fails. Update `plugins/sp/tests/verify-answer-lint*.test.ts` (or the script's existing
  test home) — no change to the answer-file schema, the verdict derivation, or the hard-action
  placement in `config/workflows/task-pipeline.yaml`.

**Out of scope / non-goals.** No change to the answer-file schema contract, `spur task verdict`,
the FSM's verify-state actions or edges, or any other lint finding class (missing/duplicate/status
checks stay). No bulk reformat of existing task docs. No re-run orchestration for 0727 (that run's
fate is tracked on 0727 itself).

### Acceptance Criteria

- [x] AC1 (R1): given a task doc whose Requirements use `- [ ] R1.` (0727 form), `- R1.` plain
  bullets, and `**R1.**` bold (0726 form), `extractRequirementIds` returns `["R1", …]` for each;
  an answer row referencing a declared ID passes the lint; an answer row referencing `R9` on a
  doc that declares only `R1`–`R3` still fails with the unknown-ID finding. Unit tests assert all
  forms.
- [x] AC2 (R2): given an Acceptance Criteria section in checkbox (`- [x] AC1 (R1): …`) and
  plain-bullet (`- AC1: …`) forms, `extractAcIdentities` yields both label texts and leading
  tokens for both forms; answer AC rows matching either identity pass. Unit tests assert both.
- [x] AC3 (R3): the lint's test suite covers a 0726-rendered fixture, a 0727-rendered fixture,
  and a mixed fixture, all passing end-to-end (lint PASS), plus a negative fixture failing only
  on genuinely unknown IDs. Targeted `bun test` green; `bun run spur-check` green.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Extractors generalized in `plugins/sp/scripts/verify-answer-lint.ts` (R1/R2), contract tests added in `plugins/sp/tests/verify-answer-lint.test.ts` (R3):

- `plugins/sp/scripts/verify-answer-lint.ts:253` — bold pattern collapsed to one superset regex (`\*\*(R\d+(?:\.\d+)*)\b`), replacing the two bold-only forms; also accepts sloppy `**R1 **` and the `**R1 — Title**` / `**R1 (Scope):` renderings the old pattern silently missed in 22 corpus docs.
- `plugins/sp/scripts/verify-answer-lint.ts:254-255` — list-marker pattern with optional checkbox, plus a bare-checkbox alternative for the marker-omitted form: `- [ ] R1.` / `- [x] R1.` / `- R1.` / `- R1:` (the corpus-dominant form, previously invisible — root cause of 0727's false fail) and `[x] R1.` (the 0571 form). The marker and the checkbox are deliberately never both optional: that would match bare prose (`R1 is …`) and fabricate declarations.
- `plugins/sp/scripts/verify-answer-lint.ts:256` — line-start pattern requiring a `./:` terminator (conservative: stops prose lines beginning with an ID reference from fabricating declarations; review-confirmed correct).
- Sub-IDs (`R1.1`) match in all three forms via `(?:\.\d+)*`.
- `plugins/sp/scripts/verify-answer-lint.ts:265` — `extractAcIdentities`: checkbox group now optional with `[ xX]`; one regex unifies 0726 checkbox labels and 0727/0713 plain bullets; leading-token rule (label + first word) applies to both; scenario titles unchanged as identity source (`:273-275`).
- `plugins/sp/tests/verify-answer-lint.test.ts:56-76` — `makeSandbox(taskContent, wbs)` parameterized; defaults keep all 13 pre-existing tests behavior-identical.
- `plugins/sp/tests/verify-answer-lint.test.ts:151` — template literal moved into a named const before `exec` (satisfies both biome `useTemplate` and the lens `exec`-interpolation heuristic; string-identical).
- `plugins/sp/tests/verify-answer-lint.test.ts:312-383` — corpus-form describe: 0726-form regression, 0727-form end-to-end PASS, mixed-form, negative `R9` on an `R1`–`R3` doc, line-start form (`:344`) with its bare-reference negative (`:352`), markerless-checkbox form (`:360`) with its both-optional negative (`:368`), and sub-ID `R1.1` in checkbox + plain forms.

Verified both directions against the real corpus (all 239 `docs/tasks4/*.md` carrying a Requirements section, 1323 IDs): zero fabricated IDs and zero missed declaration-shaped lines.

Non-goals held: answer-file schema, verdict derivation, FSM YAML, and all other lint finding classes untouched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Requirement-ID extraction generalized in `plugins/sp/scripts/verify-answer-lint.ts:253-256`: `:253` bold superset `**(R\d+(?:\.\d+)*)\b` (subsumes both prior bold-only patterns and adds `**R1 — Title**` / `**R1 (Scope):` forms); `:254-255` list marker with optional checkbox OR bare checkbox with the marker omitted — `- [ ] R1.` / `- [x] R1.` / `- R1.` / `- R1:` / `[x] R1.`; `:256` line-start with a `[.:]` terminator. Marker and checkbox are never both optional, so bare prose cannot fabricate a declaration. Sub-IDs via `(?:\.\d+)*` in all three. Unknown-ID findings fire only for IDs absent from every form — membership is tested against the union set at `plugins/sp/scripts/verify-answer-lint.ts:345`. Verified both directions against the real corpus this run over all 239 `docs/tasks4/*.md` with a Requirements section: 1323 IDs extracted, ZERO fabricated (every extracted ID has a declaration-start line) and ZERO missed (no declaration-shaped line goes unextracted). Real-doc probes: line-start form `docs/tasks4/0696_route-the-inline-pipeline-driver-and-spur-cli-reference-to-t.md:38,46,51` lint PASS rc=0 with R9 negative rc=1 naming "task declares: R1, R2, R3"; markerless form `docs/tasks4/0571_workflow-engine-file-read-into-var-setvars-never-reach-downs.md` lint PASS rc=0 (previously "task declares: none" — a live instance of the same false-FAIL class R1 exists to eliminate, found and closed by the corpus sweep this run). |
| R2 | MET | AC-identity extraction generalized at `plugins/sp/scripts/verify-answer-lint.ts:265` — the checkbox group is optional and case-wide `(?:\[[ xX]\]\s+)?`, so one regex covers 0726 checkbox labels (`- [x] AC1 (R1): …`) and 0713/0727 plain bullets (`- AC1: Given …`). The leading-token rule applies to both: label text up to `:` added at `:268`, its first word at `:269-270`. Feature-scenario titles remain an identity source, unchanged, at `:273-275`. Pinned by `plugins/sp/tests/verify-answer-lint.test.ts:320` (0727 plain-AC fixture, end-to-end PASS asserting "3 requirement row(s), 3 AC row(s)") and `:328` (mixed fixture pairing checkbox `AC1 (R1)` with plain `AC2`). Scenario-title identity still asserted by the pre-existing test at `plugins/sp/tests/verify-answer-lint.test.ts:114`; inexact identities still rejected via the exact-match check at `plugins/sp/scripts/verify-answer-lint.ts:362`. |
| R3 | MET | Contract tests pin every generalized form: 0726 rendering `plugins/sp/tests/verify-answer-lint.test.ts:313`, 0727 rendering `:320`, mixed doc `:328`, genuinely-unknown-ID negative `:336`, sub-IDs `:376`. Branches previously shipping without a fixture are now pinned, each with a matched negative that guards against over-extraction: line-start positive `:344` and terminator-rule negative `:352` (fixture `:258`); markerless-checkbox positive `:360` and both-optional negative `:368` (fixture `:278`). Suite `cd plugins/sp && bun test tests/verify-answer-lint.test.ts` = 22 pass / 0 fail / 54 expect calls. Non-goals held: the answer-file schema, `spur task verdict` derivation, and `config/workflows/task-pipeline.yaml` are untouched — the pipeline-wiring tests at `plugins/sp/tests/verify-answer-lint.test.ts:403` stay green, and `git status --short` shows no YAML or contract file modified. Full gate `bun run spur-check` = 7083 pass / 0 fail across 378 files; 44 rules + recommended-post-check preset all pass; `bunx biome check` clean on both changed files. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | All declared forms extract end-to-end: `plugins/sp/tests/verify-answer-lint.test.ts:313` (bold 0726), `:320` (checkbox 0727), `:328` (mixed bold + checkbox + plain + colon, asserting "4 requirement row(s)"), `:344` (line-start), `:360` (markerless checkbox). Declared-ID answers pass; an answer citing R9 against an R1–R3 doc still fails with the unknown-ID finding at `:336`, asserting "task declares: R1, R2, R3". Sub-ID R1.1 asserted at `:376`. Corroborated on real corpus data this run: 0696 and 0571 positive lint rc=0, R9 negative rc=1 with the exact declared set. |
| AC2 | MET | test | Checkbox and plain AC bullets both yield label text and leading token: mixed fixture `plugins/sp/tests/verify-answer-lint.test.ts:328` passes with `- [x] AC1 (R1):` and `- AC2:` in one doc; 0727 all-plain fixture `:320` passes asserting 3 AC rows. Scenario-title identity untouched and still asserted at `:114`; inexact AC identities remain rejected, asserted at `:181`. |
| AC3 | MET | test | 0726, 0727, mixed, line-start, markerless, and sub-ID fixtures all reach lint PASS end-to-end, and every negative fixture fails only on genuinely unknown IDs — `plugins/sp/tests/verify-answer-lint.test.ts:312-383`. Targeted run green: `cd plugins/sp && bun test tests/verify-answer-lint.test.ts` = 22 pass / 0 fail / 54 expect calls. Repo gate green: `bun run spur-check` = 7083 pass / 0 fail across 378 files plus 44 rules and the recommended-post-check preset with no violations. Original regression re-run against real data: `bun plugins/sp/scripts/verify-answer-lint.ts 0727 --answer .spur/run/0727-verify-answer.txt` = PASS rc=0, the exact invocation that failed with 6 false findings before this task. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
Review re-run 2026-08-31 (sp:code-review, `--focus all`) over the full effective diff
`b1b5b151c~1..working-tree` for `plugins/sp/scripts/verify-answer-lint.ts` and
`plugins/sp/tests/verify-answer-lint.test.ts`: **PASS** — R1/R2/R3 and all non-goals MET with
fresh line anchors. Supersedes the earlier review of commit `b1b5b151c` alone.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P2 (minor) | Line-start extractor branch shipped without a unit fixture; the bare-`R1`-without-terminator exclusion was probe-only | **RESOLVED.** Fixture `plugins/sp/tests/verify-answer-lint.test.ts:258` with positive `:344` and terminator-rule negative `:352`. The prior review's "fix-later candidate" residual is closed. |
| P2 (minor) | Markerless checkbox form (`[x] R1.`, no list marker) extracted nothing — `docs/tasks4/0571_*.md` reproduced the exact `task declares: none` false-FAIL class R1 exists to eliminate | **RESOLVED.** `plugins/sp/scripts/verify-answer-lint.ts:254-255` adds a bare-checkbox alternative. Found by a corpus-wide sweep, not by the ticket text; fixed at the shared extractor so every caller benefits. Pinned positive `plugins/sp/tests/verify-answer-lint.test.ts:360`, negative `:368`. |
| P3 (minor) | Bold pattern can match ID-bearing prose emphasis in the Requirements section (`see **R2**`) → fabricated "declared" ID → spurious `missing requirement row` false-FAIL | Accepted. Fail-visible (a human investigates; never a silent PASS) and partially pre-existing — the prior `**R1**` pattern had the same exposure. Corpus sweep over 239 docs / 1323 extracted IDs found **zero** fabrications. |
| P3 (minor) | Every bullet in the Acceptance Criteria section contributes its label and first word as an identity, prose bullets included. Unlike the requirement side there is no AC completeness sweep (deliberate, 0726 R3), so this widening is *permissive* rather than fail-visible | Accepted — precisely the widening R2 requested. The exact-match requirement at `plugins/sp/scripts/verify-answer-lint.ts:362` keeps the blast radius minimal. |
| P4 (advisory) | Indented nested bullets (`  - R1.1`) are invisible to all patterns (every anchor is column-0) | Accepted. Under-extraction blind spot only; a sweep allowing up to 3 spaces of indent found no corpus instance. |
| P4 (advisory) | Uppercase `[X]` checkbox is covered by the `[ xX]` class but by no fixture | Accepted. Pattern-level coverage without a dedicated fixture; lowest-value gap remaining. |

**Verified, not assumed — the asymmetry check.** Widening the requirement extractor without the AC
extractor would be a half-fix, so the AC side was swept independently: **zero** corpus docs use
markerless-checkbox AC lines (0571's ACs are Gherkin scenarios, served by the scenario-title path at
`plugins/sp/scripts/verify-answer-lint.ts:273-275`). The AC extractor's mandatory list marker is
correct for the corpus and was deliberately left unchanged.

**Residual risk.** Extraction stays biased toward over-extraction, so its failure mode is a spurious
`missing`/unknown-ID finding — a **visible false FAIL**, never a false PASS that masks a defect. Two
independent corpus sweeps this run confirm both directions are clean: 0 fabricated IDs (every
extracted ID has a declaration-start line) and 0 missed declaration-shaped lines, across 239 docs and
1323 IDs. The marker/checkbox never-both-optional invariant is the guard that keeps it there, is
documented at `plugins/sp/scripts/verify-answer-lint.ts:249-252`, and is pinned by two negative tests.

Dead code: none introduced. New dependencies: none. Change stays inside two pure functions with no
seam, contract, or FSM movement.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-08-31T23:30:39.846Z todo → wip (system)
- 2026-08-31T23:58:23.786Z wip → testing (system)
- 2026-08-31T23:58:24.235Z testing → done (system)
