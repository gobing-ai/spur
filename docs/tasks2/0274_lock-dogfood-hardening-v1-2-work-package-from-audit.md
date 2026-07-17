---
template: brainstorm
schema_version: 1
name: "Lock dogfood hardening v1.2 work package from audit"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dogfood"]
dependencies: ["0273"]
created_at: "2026-07-17T00:54:30.293Z"
updated_at: "2026-07-17T01:14:30.647Z"
---

## 0274. Lock dogfood hardening v1.2 work package from audit

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** Given the 0273 audit, what is the **first shippable dogfood hardening package** (protocol bump target, concrete file changes, acceptance checks, and explicit deferrals)?

**Locked goal:** Contract compliance + token efficiency. Golden suite, dashboards, smarter auto-fix IQ are **not** the primary slice unless the audit proves they are prerequisites.

**Expected output shape** (graduate into 1–3 implementation tasks without further grilling):
- Protocol version target (e.g. `@1.2`)
- Must-fix list vs nice-to-have
- Structural tests under `plugins/sp/tests/`
- Token-conservation rule changes (skill prose and/or ledger)
- Success metrics (dual-artifact always; cache% trend; finalize-or-abort checklist)
- Deferred items → feature N fog or Out of scope

**Depends on:** 0273 audit Solution.
### Requirements
- [x] R1. Ordered backlog W1-W9 with files, effort, D-ids.
- [x] R2. Protocol @1.2 + changelog bullets.
- [x] R3. Named tests R22b / fixtures / pipeline-detect.
- [x] R4. Deferrals explicit (D8, CI suite, meters, auto-fix IQ, provenance code, CLI verb).
- [x] R5. Definition of done (9 checks).
- [x] R6. Two impl task titles locked; created as graduate artifacts.
### Acceptance Criteria
```gherkin
@core
Scenario: Work package is implementation-ready
  Given 0274 Solution
  When /sp:dev-plan or batch-create is run from the package
  Then each implementation task has clear R-items and file targets
  And deferred items are not smuggled into v1.2 scope
```
### Q&A
**Q (why not only prose updates).** 0273 showed agents skip footer while status=complete; without fixtures tests, R22 stays green and reports stay broken.

**Q (one task or two).** Two: contract tests are shippable without token policy; keeps reviews small.

**Q (D8 deferred).** Conservation stays guidance; W8 Cost segmentation gives the efficiency signal without schema churn.
### Design
**Selected:** @1.2 = enforce finalize structure + fixture tests (compliance) + detector/token policy (efficiency). Two impl tasks A then B.

**Rejected:** Big-bang rewrite of all historical reports; new spur CLI verb; folding lifecycle provenance into dogfood code.
### Plan
1. Create Impl A + Impl B tasks under N (this session graduation).
2. Operator runs Impl A via /sp:dev-run (or refine first).
3. Then Impl B.
4. Optional: dogfood a short non-pipeline testee under @1.2 to produce a compliant sample report.
### Solution
**Decision:** Ship **`sp:dogfood-testing@1.2`** as a **contract-enforcement + meta-run cost policy** package. Scope = 0273 must-ship set **D1–D7** (+ D9 docs-only). Defer D8 machine-checked conservation column and multi-command CI golden suite.

This extends 0244 (always-on dual artifacts @1.1): @1.1 made delivery *possible*; @1.2 makes non-compliant reports *detectable and rejectable*.

---

## 1. Protocol version + changelog (R2)

| Field | Value |
| --- | --- |
| From | `sp:dogfood-testing@1.1` (`metadata.version: "1.1"`) |
| To | **`sp:dogfood-testing@1.2`** (`metadata.version: "1.2"`) |
| Bump when | D1–D5 prose + fixture tests land (minimum). D6–D7 may land same PR or immediate follow-up task. |

**Changelog bullets (@1.2)**

1. **Finalize-or-abort hard structure:** unique §1–§6 headings; Issues requires `#### Fixed` + `#### Unresolved`; no leftover "run in progress".
2. **Mandatory summary footer** printed and mirrored into report end (footer missing ⇒ cannot set `status: complete`).
3. **Protocol string normalized** to `sp:dogfood-testing@1.2` (colon form only; reject `sp-dogfood-testing@…` in new runs).
4. **Ledger cardinality:** data rows in Monitor Ledger MUST equal `Steps: N executed` (or document N/A steps explicitly as rows).
5. **Report compliance tests:** golden fixture(s) under skill tests; R22 extended or sibling R-dogfood-fixture.
6. **Pipeline-driving detector:** word-boundary matchers; no leading-space dependency.
7. **Meta-run cost policy:** when testee is pipeline-driving and a derived step is full implement, emit advisory + recommend observe-only / step-split; optional Cost segmentation (protocol vs implement).
8. **`--next` chain terminal expectation:** document stop-at-`testing` when provenance missing (finding, not footer failure).

---

## 2. Ordered implementation backlog (R1)

Effort: S ≤1h, M half-day, L full day+.

| # | Item | Maps | Owner files | Effort |
| --- | --- | --- | --- | --- |
| **W1** | Normalize protocol id to `sp:dogfood-testing@1.2` in skill frontmatter, report-template, monitor-ledger, command if mentioned, all examples | D5 | `plugins/sp/skills/dogfood-testing/SKILL.md`, `references/report-template.md`, `references/monitor-ledger.md`, `commands/dev-dogfood.md` | S |
| **W2** | Expand Phase 4 finalize-or-abort checklist: footer mandatory; unique section headings; Issues subheads; scrub incomplete markers; refuse `complete` if checks fail (set `aborted` + list failures) | D1, D3, M11–M14 | `SKILL.md` Phase 4; `report-template.md` | S |
| **W3** | Ledger ↔ executed-step cardinality rule + one sentence in monitor-ledger | D4 | `monitor-ledger.md`, `SKILL.md` Phase 3/4 | S |
| **W4** | Add golden fixture report(s) that **pass** the checklist; add one **fail** fixture (missing footer) for negative test | D2, D10 | `plugins/sp/skills/dogfood-testing/tests/fixtures/report-complete.md`, `report-missing-footer.md` | M |
| **W5** | Structural/unit tests: load fixtures; assert footer block, protocol colon form, six unique `### N.` headings, Issues subheads, ledger row count ≥1 and matches declared executed if present | D1, D2 | `plugins/sp/tests/skill-structure.test.ts` (extend R22) **or** `plugins/sp/skills/dogfood-testing/tests/report-contract.test.ts` | M |
| **W6** | Optional thin validator helper callable from tests (and documented for agents): pure function over markdown string → `{ok, errors[]}` — **no new CLI verb required** | D1, D2 | `plugins/sp/skills/dogfood-testing/scripts/validate-report.ts` **or** colocate in test file | M |
| **W7** | Harden pipeline-driving detection (regex list; document false-positive/negative notes) | D6 | `SKILL.md` Phase 1.0; `commands/dev-dogfood.md` Behavior | S |
| **W8** | Meta-run token policy: after step derive, if any step label/source indicates full implement under pipeline-driving testee → print warning; prefer observe-only; allow Cost subsection "Protocol overhead vs implement work" when implement step wall-clock > threshold (e.g. >10 min or fresh tokens >10k) | D7 | `SKILL.md` Phase 1–2, `monitor-ledger.md` or report-template Cost | M |
| **W9** | Document expected `--next` chain terminal status when provenance absent (testing not done) under Findings/Gotchas | D9 | `SKILL.md` Gotchas; cross-link `dev-run.md` `--next` | S |

**In-package ordering:** W1 → W2 → W3 → W4 → W5 (→ W6) → W7 → W8 → W9.

**Nice-to-have inside same PR if cheap:** W6. **Not blocking DoD:** W6 if W5 inlines validation.

---

## 3. Named tests (R3)

| Test id | Assertion |
| --- | --- |
| **R22** (keep) | Prose mentions dual-path, ledger, finalize-or-abort (existing) |
| **R22b / dogfood-fixture-pass** | Fixture `report-complete.md` validates: footer contains `── Dogfood Summary ──`, `[Live:]`, `[Report:]`; exactly one each of `### 1.`…`### 6.`; `#### Fixed` + `#### Unresolved`; `protocol: sp:dogfood-testing@1.2`; Monitor Ledger has ≥1 data row |
| **dogfood-fixture-fail-footer** | Fixture missing footer → validator returns error code `missing_footer` |
| **dogfood-protocol-string** | SKILL.md + report-template.md contain `@1.2` and do not document `sp-dogfood-testing@` as canonical |
| **dogfood-pipeline-detect** | Unit cases: strings with `--next`, `dev-run`, `runall`, `wrap`, `idea` without leading-space tricks → detected; benign path `docs/wrap-notes.md` alone → not detected (tune as needed) |

Run: `bun test plugins/sp/tests/skill-structure.test.ts` and any new `dogfood-testing/tests/*.test.ts`.

---

## 4. Deferrals (R4)

| Item | Why deferred |
| --- | --- |
| **D8** machine-checked conservation column | Optional; conservation stays prose + Cost segmentation (W8) first |
| Multi-command golden dogfood CI suite | Needs stable short testees + CI budget; not required to fix footer/structure |
| ccusage / real token meter wiring | Still optional MEDIUM confidence; honesty rules stay |
| Smarter auto-fix IQ | Orthogonal to contract compliance |
| Lifecycle provenance fix for `--next`→done | Separate lifecycle work; dogfood only documents (W9) |
| New top-level `spur dogfood validate` CLI verb | Validator as skill script/test helper is enough |
| Force all historical `docs/dogfood/*` rewrite | Only new runs @1.2; fixtures are SSOT for tests |

---

## 5. Definition of done (R5)

Package **shipped** when **all** hold:

1. Skill metadata `version: "1.2"` and `protocol: sp:dogfood-testing@1.2` consistent across skill + both references + command prose.
2. Phase 4 checklist in SKILL.md explicitly blocks `complete` without footer + structure rules (W2).
3. At least one **pass** and one **fail** fixture under the skill test tree (W4).
4. Automated tests green for pass/fail fixtures and protocol string (W5).
5. Pipeline-driving detector no longer depends on leading space before `run`/`wrap`/`idea` (W7).
6. Meta-run implement warning + Cost segmentation guidance written (W8).
7. Gotcha/docs for `--next` stop-at-testing (W9).
8. `bun test plugins/sp/tests/skill-structure.test.ts` (+ new dogfood tests) green.
9. Preserve list from 0273 intact (dual artifacts, live ledger, anti-fiction cache math, testee-scoped `--agent`, verdict-grades-testee).

**Not required for DoD:** re-dogfooding every `/sp:dev-*`; rewriting old reports; lifecycle provenance code change.

---

## 6. Implementation task split (graduate)

Two `feature-impl` tasks under feature N (created after this Solution locks):

| Task | Title | Owns |
| --- | --- | --- |
| **Impl A** | Dogfood @1.2 contract enforcement (finalize, fixtures, tests) | W1–W6 |
| **Impl B** | Dogfood @1.2 meta-run detector and token policy | W7–W9 |

Impl B depends on Impl A (protocol version string stable first).

---

## 7. Success metrics (operator-visible)

| Metric | Target |
| --- | --- |
| New reports set `status: complete` only if footer present | 100% of fixture-validated shape |
| Automated catch of missing footer | fail fixture test red→green |
| Aggregate cache% for **non-implement** dogfoods | trend ≥50% (existing P3 rule); implement-heavy runs **label** implement share |
| False "complete" with dup §6 / missing Issues subheads | blocked by finalize checklist |

---

## Source anchors (file:line)

- Audit findings: `docs/tasks2/0273_…` Solution §6 D1–D10
- Current protocol: `plugins/sp/skills/dogfood-testing/SKILL.md:5-8`
- R22 prose-only: `plugins/sp/tests/skill-structure.test.ts:207-236`
- Prior harden: task `0244` (done) always-on dual path @1.1
### Testing
**Validation.** Cross-checked W-items against 0273 D1-D10 must-ship set; aligned with preserve list; referenced 0244 as @1.1 predecessor.

**Coverage:** N/A (packaging decision; no production code this ticket).
### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Dependency: 0273
- Downstream: implementation tasks for dogfood-testing / dev-dogfood
### History
- 2026-07-17T01:13:11.728Z todo → wip (system)
- 2026-07-17T01:14:27.889Z wip → testing (system)
- 2026-07-17T01:14:30.647Z testing → done (system)
