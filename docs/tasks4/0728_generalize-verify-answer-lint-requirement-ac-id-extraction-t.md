---
schema_version: 1
name: "Generalize verify-answer-lint requirement/AC ID extraction to the full corpus convention set"
status: done
template: issue
created_at: 2026-08-31T23:16:55.461Z
updated_at: "2026-09-01T00:32:21.659Z"
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

- `plugins/sp/scripts/verify-answer-lint.ts:251` — bold pattern collapsed to one superset regex (`\*\*(R\d+(?:\.\d+)*)\b`), replacing the two bold-only forms; also accepts sloppy `**R1 **`.
- `plugins/sp/scripts/verify-answer-lint.ts:252` — list-marker pattern with optional checkbox: `- [ ] R1.` / `- [x] R1.` / `- R1.` / `- R1:` (the corpus-dominant form, previously invisible — root cause of 0727's false fail).
- `plugins/sp/scripts/verify-answer-lint.ts:253` — line-start pattern requiring a `./:` terminator (conservative: stops prose lines beginning with an ID reference from fabricating declarations; review-confirmed correct).
- Sub-IDs (`R1.1`) match in all three forms via `(?:\.\d+)*`.
- `plugins/sp/scripts/verify-answer-lint.ts:262` — `extractAcIdentities`: checkbox group now optional with `[ xX]`; one regex unifies 0726 checkbox labels and 0727/0713 plain bullets; leading-token rule (label + first word) applies to both; scenario titles unchanged as identity source (`:270-273`).
- `plugins/sp/tests/verify-answer-lint.test.ts:56-76` — `makeSandbox(taskContent, wbs)` parameterized; defaults keep all 13 pre-existing tests behavior-identical.
- `plugins/sp/tests/verify-answer-lint.test.ts:151` — template literal moved into a named const before `exec` (satisfies both biome `useTemplate` and the lens `exec`-interpolation heuristic; string-identical).
- `plugins/sp/tests/verify-answer-lint.test.ts:205-311` — new corpus-form describe: 0726-form regression, 0727-form end-to-end PASS, mixed-form, negative `R9` on an `R1`–`R3` doc, sub-ID `R1.1` in checkbox + plain forms.

Non-goals held: answer-file schema, verdict derivation, FSM YAML, and all other lint finding classes untouched.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | extractors generalized: `plugins/sp/scripts/verify-answer-lint.ts:251` (bold `**R1.**`/`**R1**` via `**\b` regex), `:252` (bullet with optional `[ xX]` checkbox: `- [ ] R1.`, `- [x] R1.`, `- R1.`, `- R1:`), `:253` (line-start `R1.`/`R1:` with `[.:]` terminator); sub-IDs via `(?:\.\d+)*` in all three. Pinned by `plugins/sp/tests/verify-answer-lint.test.ts:276-306` (0726/0727/mixed/R9-negative/sub-ID fixtures; 18/18 pass). Line-start branch (dispositioned minor1: no unit fixture) re-verified fresh this session end-to-end on real corpus doc `docs/tasks4/0696_route-the-inline-pipeline-driver-and-spur-cli-reference-to-t.md:38,46,51` (bare line-start `R1.`/`R2.`/`R3.`): real lint PASS rc=0; negative probe on same doc with R9 failed rc=1 with unknown requirement ID R9, task declares R1, R2, R3 — extraction set is exactly the declared IDs, nothing spurious. |
| R2 | MET | AC extractor generalized: `plugins/sp/scripts/verify-answer-lint.ts:262` — checkbox group now optional and case-wide (`(?:\[[ xX]\]\s+)?`), so `- [x] AC1 (R1): …` (0726) and `- AC1: …` (0713/0727) both yield label text up to `:` plus leading token (`:263-268`); scenario titles remain a source at `:270-273`. Pinned by `plugins/sp/tests/verify-answer-lint.test.ts:283` (0727 plain-AC fixture end-to-end), `:291` (mixed checkbox+plain), and the pre-existing scenario-title test in the `:105` block (both still pass, 18/18); inexact `AC 1` still rejected. |
| R3 | MET | Contract fixtures present and meaningful: 0727-form `plugins/sp/tests/verify-answer-lint.test.ts:208`, mixed `:226`, sub-ID `:241`, negative-R9 test `:299` (asserts unknown finding AND declared-set message), 0726-form default fixture (plugins/sp/tests/verify-answer-lint.test.ts:19 constant + test `:276`). Pre-existing 13 tests behavior-identical: `makeSandbox` parametrization `plugins/sp/tests/verify-answer-lint.test.ts:56` keeps defaults `TASK_CONTENT`/`'0726'` so all original call sites are unchanged; test diff deletions are only that refactor; suite ran 18 pass / 0 fail (13 pre-existing + 5 new). Wiring tests `plugins/sp/tests/verify-answer-lint.test.ts:334+` (expectFile contract, lint-before-verdict order) green; `config/workflows/task-pipeline.yaml` untouched (git diff --stat HEAD lists only the two diff-basis files). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | All three req forms yield IDs end-to-end: plugins/sp/tests/verify-answer-lint.test.ts:276 (0726 form), :283 (0727 form, asserts 3 req + 3 AC rows PASS), :291 (mixed, 4 req rows). Declared-ID answer passes; genuinely unknown R9 on an R1-R3 doc fails with the unknown-ID finding: plugins/sp/tests/verify-answer-lint.test.ts:299 plus fresh real-doc probe on 0696 (rc=1, declares exactly R1, R2, R3). Sub-ID R1.1 recognized: plugins/sp/tests/verify-answer-lint.test.ts:307. |
| AC2 | MET | test | Checkbox and plain AC bullets both yield label + leading token: mixed fixture plugins/sp/tests/verify-answer-lint.test.ts:291 (checkbox `AC1 (R1)` + plain `AC2`) passes end-to-end; 0727 plain-AC fixture plugins/sp/tests/verify-answer-lint.test.ts:283 passes; scenario-title identity still accepted (pre-existing test, `:105` block); inexact AC ID still rejected. |
| AC3 | MET | test | 0726/0727/mixed fixtures pass end-to-end lint PASS and negative fixture fails only on unknown IDs: plugins/sp/tests/verify-answer-lint.test.ts:275-306, full suite `cd plugins/sp && bun test tests/verify-answer-lint.test.ts` = 18 pass / 0 fail / 42 expect calls. Real-answer lint `bun plugins/sp/scripts/verify-answer-lint.ts 0727 --answer .spur/run/0727-verify-answer.txt` = PASS rc=0. Repo lint red only in apps/web/src/modules/history/SummaryTab.tsx and ToolUsingTab.tsx — sanctioned concurrent writer's modified files, out of scope per dispatch; zero lint findings under plugins/sp, config, docs, or any 0728 path. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

Review run `e3a4e6e2` (sp-super-reviewer): **PASS** — R1/R2/R3 + non-goals all MET with fresh line anchors.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P2 (minor) | Line-start extractor branch untested by unit fixture (column-0 declaration without list marker; bare `R1` without `./:` must stay excluded) | Probe-verified positive + negative on real doc `docs/tasks4/0696_*.md:38,46,51` during verify (PASS rc=0 / R9 → rc=1 with exact declared set). Unit-fixture gap remains — acceptable residual, fix-later candidate. |
| P3 (minor) | Bold pattern can match ID-bearing prose emphasis in the Requirements section (`see **R2**`) → fabricated "declared" ID → spurious `missing requirement row` false-FAIL | Fail-visible bias (human investigates; never silent PASS). Partially pre-existing; `\b` broadens it. Requirements-section scoping contains blast radius. Accepted. |
| P3 (advisory) | Indented nested bullets (`- R1.1`) invisible to all patterns (column-0 anchors) | Not a corpus-cited declaration form; under-extraction blind spot only. Accepted. |
| P3 (advisory) | Prose bullets in AC section contribute label + first word as identities (`- Note: …`) | Exactly R2's requested widening; exact-match requirement keeps blast radius minimal. Accepted. |

Requested judgment — line-start terminator conservatism: **CORRECT** (fresh probe: `linestart:["R1"]` extracted, bare `R2` and mid-prose `R3` excluded).

Residual risk: extraction is biased toward over-extraction → spurious `missing`/extra-declared findings are false FAILs (visible), not false PASSes (masking); no path found where a genuinely undeclared answer row passes on the tested corpus forms. Stale-copy note: `.rulesync` mirrors are gitignored generated artifacts, not diff defects.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-08-31T23:30:39.846Z todo → wip (system)
- 2026-08-31T23:58:23.786Z wip → testing (system)
- 2026-08-31T23:58:24.235Z testing → done (system)
