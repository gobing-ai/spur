---
template: brainstorm
schema_version: 1
name: "Audit dogfood-testing@1.1 for contract gaps and token waste"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H4
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:dogfood"]
dependencies: []
created_at: "2026-07-17T00:54:28.899Z"
updated_at: "2026-07-28T00:32:19.179Z"
---

## 0273. Audit dogfood-testing@1.1 for contract gaps and token waste

### Background
**Type:** `wayfinder:research` · **Feature:** N

**Question:** What are the concrete **contract-compliance gaps** and **token-waste patterns** in `sp:dogfood-testing@1.1` when used as meta-tooling to refine Spur, with evidence for each finding?

**Success metric (locked):** Contract compliance + token efficiency — not golden suite first, not report cosmetics first.

**Protocol surface to audit:**
- Skill: `plugins/sp/skills/dogfood-testing/SKILL.md` (@1.1)
- Refs: `references/report-template.md`, `references/monitor-ledger.md`
- Command: `plugins/sp/commands/dev-dogfood.md`
- Evidence: `docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md` (~48k tokens, ~26% cache, pipeline-driving testee, provenance friction, doc drift)
- Historical dogfood-born tasks: `0120`, `0122`, `0125`, `0127`, `0128`, `0159`

**Research methods:**
1. Extract every MUST from the protocol
2. Score the 2026-07-16 report against the checklist
3. Extract token/cache rows; identify re-fetch and low-cache steps
4. Note meta-use friction for dogfooding `sp` itself
5. Produce prioritized findings table (P1–P3) with file anchors

**Out of this ticket:** Choosing the v1.2 work package cut line (→ 0274); implementing fixes.
### Requirements
- [x] R1. Checklist of protocol MUSTs (M1-M20).
- [x] R2. Evidence table: gaps with severity, evidence, fix class.
- [x] R3. Token waste patterns with estimated impact (T1-T6).
- [x] R4. Meta-use friction list for refining spur (F1-F7).
- [x] R5. Explicit preserve-list (what already works).
- [x] R6. Solution is the full audit report body with stable finding IDs D1-D10 for 0274.
### Acceptance Criteria
```gherkin
@core
Scenario: Audit is actionable
  Given 0273 Solution
  When 0274 authors a v1.2 work package from it
  Then every proposed work item maps to at least one evidence-backed finding
  And preserve-list prevents breaking working contract pieces
```
### Q&A
**Q (is 0269 report PASS overall).** Testee verdict PASS; delivery contract PARTIAL/FAIL on footer and structure.

**Q (is low cache% a dogfood bug).** Partly driver conservation; mostly implement-step mass IO when dogfooding --next chains. Segment Cost; do not only blame protocol.

**Q (provenance).** Out of dogfood core; document expected stop-at-testing; fix lifecycle separately.
### Design
**Method:** Extract MUSTs from skill+refs; score sole recent full report (0269) + R22 tests + live artifact presence; separate contract gaps from testee findings from lifecycle issues.

**Selected output shape:** Stable D1-D10 IDs for work packaging in 0274; preserve-list to avoid regressions.
### Plan
1. Read SKILL + both references; extract MUST checklist.
2. Score the 2026-07-16 dogfood report against the checklist.
3. Mine prior dogfood-derived tasks for recurring themes.
4. Write findings table + token patterns + preserve-list into Solution.
### Solution
**Answer:** Evidence-backed audit of `sp:dogfood-testing@1.1` for contract compliance and token efficiency. Primary evidence: `docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md` + live twin `.spur/run/dogfood/2026-07-16-sp-dev-refine-0269.md`. Structural gate R22 only asserts *prose* mentions contract — not report compliance.

---

## 1. Protocol MUST checklist (R1)

Extracted from `plugins/sp/skills/dogfood-testing/SKILL.md` + `references/{report-template,monitor-ledger}.md` (protocol `sp:dogfood-testing@1.1`).

| ID | MUST | Source |
| --- | --- | --- |
| M1 | Refuse pipeline-driving testee without explicit `--max-retry` | SKILL.md:69-74 |
| M2 | Classify testee (slash / skill / CLI); quote-aware argv | SKILL.md:75-77 |
| M3 | Derive ordered steps from testee docs | SKILL.md:78-79 |
| M4 | Open **dual** artifacts Phase 1 (`status: running`, both paths) | SKILL.md:80-89; report-template.md:19-30 |
| M5 | Canonical frontmatter fields incl. `protocol: sp:dogfood-testing@1.1` | report-template.md:32-48 |
| M6 | Fix discipline: no weaken / stub / `--no-verify` | SKILL.md:103-105 |
| M7 | Dual-write ledger row on **every** step resolve (live first) | SKILL.md:112-116; monitor-ledger.md:17-35 |
| M8 | Never reconstruct ledger from memory | SKILL.md:189-191 |
| M9 | Six section headings in order (§1–§6) | SKILL.md:243-250; report-template.md:71-74 |
| M10 | Cost block: Method + confidence + Meter; aggregate cache% = ledger formula | report-template.md:109-124 |
| M11 | Finalize-or-abort non-skippable; `status` complete\|aborted | SKILL.md:124-136 |
| M12 | Summary footer with `[Live:]` + `[Report:]` | SKILL.md:261-281; command dev-dogfood.md |
| M13 | Verdict only PASS\|PARTIAL\|FAIL grades **testee** | report-template.md:126-133 |
| M14 | Issues: both Fixed + Unresolved subheads | report-template.md:177-193 |
| M15 | Findings carry severity + file:line + action; default P1+P2 | report-template.md:195-199 |
| M16 | Cache-health findings: step cache% <40% → P3; aggregate <50% → P3 | monitor-ledger.md:99-107 |
| M17 | Cache-conservation discipline while driving | monitor-ledger.md:111-133 |
| M18 | Incomplete narrative: `⚠ incomplete — not reached` never invent | report-template.md:63-68 |
| M19 | `--task` sink L3 contract when used | report-template task sink |
| M20 | R22 structural: command/skill/templates mention dual-path + ledger math | skill-structure.test.ts:207-236 |

---

## 2. Evidence scorecard — 2026-07-16 refine 0269 report (R2)

| MUST | Verdict | Evidence | Fix class |
| --- | --- | --- | --- |
| M1 pipeline-driving | **PASS** | Report §1 mode notes explicit `--max-retry 2` for `--next` testee | preserve |
| M4 dual artifacts | **PASS** | Live + report paths exist; frontmatter lists both | preserve |
| M5 protocol string | **GAP** | Frontmatter `protocol: sp-dogfood-testing@1.1` uses **hyphen** not required `sp:dogfood-testing@1.1` (colon) — `docs/dogfood/…0269-dogfood.md:13` | skill prose + optional structural check on sample reports |
| M7/M8 live ledger | **PARTIAL** | Ledger present with Basis columns; but **step count mismatch**: §2 claims "8 derived, 8 executed" while ledger table has **7 rows** (steps 1–7); step 8 verify only in §4 prose (`…0269-dogfood.md:41-58`) | skill: step/ledger cardinality invariant |
| M9 six sections | **PARTIAL** | All six headings appear, but **duplicate `### 6. Findings`** (lines 77 and 89) and §5 Issues structure broken (no `#### Fixed` wrapper; Fixed items as bare numbered list under §5) | report template enforcement checklist + agent checklist |
| M10 Cost / cache math | **PASS with nit** | Aggregate 26% matches stated 12600/48300; row sum of Fresh = 35600 vs stated 35700 (~100 rounding) — acceptable for ~estimate | preserve + note rounding tolerance |
| M11 finalize status | **PASS** | `status: complete`, `finished_at` set | preserve |
| M12 summary footer | **FAIL** | **No `── Dogfood Summary ──` footer** in report file (rg finds zero matches under `docs/dogfood/`) | **P1** skill hard requirement + R-test on fixture report |
| M13 verdict | **PASS** | Result PASS; 0 unresolved | preserve |
| M14 Issues shape | **FAIL** | Missing clean `#### Fixed` / `#### Unresolved` pairing under §5; second Unresolved under Findings | template checklist / finalize validation |
| M15 findings actionable | **PASS** | P2/P3 with file:line + Action | preserve |
| M16 cache-health findings | **PASS** | P3 low aggregate 26%; step 3 at 0%; step 6 at 8% called out | preserve |
| M17 conservation | **GAP (driver behavior)** | Step 6 implement ~35k fresh / 8% cache — driver+testee re-read mass source; conservation discipline not operationalized as hard checks | skill: step-budget / implement-step policy for pipeline-driving testees |
| M18 no fiction | **PARTIAL** | §4 numbering jumbled (1,8,4,5,6,3); mid-report "(run in progress)" left under second §6 | finalize scrub rule |
| M20 R22 | **PASS for prose / FAIL for runtime** | R22 only greps skill/command markdown — **no fixture or live report is validated** | **P1** extend tests with golden report fixture |

**Net contract grade for this run:** delivery mostly present, but **footer missing + structural Issues/Findings defects + ledger/step cardinality drift** mean a strict reading is **PARTIAL delivery compliance** despite `status: complete` and PASS testee verdict.

---

## 3. Token waste patterns (R3)

| Pattern | Impact (0269) | Root | Mitigation class |
| --- | --- | --- | --- |
| **T1. Implement step dominates dogfood of `--next` chains** | Step 6: ~35000/48300 ≈ **72% of run tokens**, 8% cache, ~45 min | Dogfood treats full implement as one "step" inside refine→run→verify | **Bound pipeline-driving dogfood:** observe-only default already; add **step-granularity policy** — dogfood refine *protocol* separately from implement, or cap implement dogfood to dry structural checks |
| **T2. First `spur task check` always 0% cache** | Step 3: ~200 fresh, 0% cache | Stateless CLI; conservation says reuse later but first call is pure fresh | Accept first-call cost; **memoize check JSON** for rest of run (driver rule already in monitor-ledger; not enforced) |
| **T3. No driver-side enforcement of conservation** | Aggregate 26% << 50% floor | Discipline is prose-only; agents re-read sources during implement | Checklist item at each step resolve: "reused prior CLI?" boolean column optional in v1.2 |
| **T4. Full test suite under dogfood implement** | 2902 tests in step 6 basis | Testee correctness work, not dogfood protocol | For meta-dogfood of *commands*, prefer `--max-retry 0` + short testees; for implement dogfood use scoped tests |
| **T5. Dual-write amplification** | Small per step | Required by contract | Keep; not a waste to cut |
| **T6. Re-stating platform notes / skill body** | Not measured here | Gotcha #2 scaffolding re-send | Platform Notes already warn; skill could add "load refs once" iron law |

**Cost signal:** trend target for meta-runs that are **not** full implement: aim aggregate cache% ≥50% (existing P3 rule). Runs that include implement should **segment Cost** (protocol overhead vs implement work) so low cache% is not misread as dogfood-driver failure alone.

---

## 4. Meta-use friction refining Spur (R4)

| Friction | Detail | In dogfood scope? |
| --- | --- | --- |
| **F1. Pipeline-driving string detect is brittle** | Matches substring ` run` / ` idea` with leading space; `/skill:sp-dev-refine … --next` works via `--next`; bare `dev-run` without space prefix might miss; false positives possible on paths containing ` wrap` | **Yes** — harden detector |
| **F2. Provenance vs `--next --auto`** | Report P2: chain reaches `testing` not `done` without run-link/pipeline (also felt in wayfinder closes) | **Borderline** — lifecycle fix more than dogfood; dogfood should **classify** as testee/env finding, not fail finalize |
| **F3. Skill() vs omp path** | Report used disk-driven refine without Skill(); step derivation still worked | Preserve dual path; document omp in skill |
| **F4. Stale command snapshot** | Gotcha #6 — same-session edit of testee | Preserve; maybe Phase 1 note "testee source hash" |
| **F5. No report-level schema validator** | Agents emit complete-looking files that miss footer | **Yes** — finalize checklist or `spur`-less markdown validator script under skill |
| **F6. Doc drift testee findings flood dogfood** | P2 skip-gate section mismatch is *testee* quality, good signal | Preserve finding emission |
| **F7. Historical task churn** | Many `*dogfood-findings*` tasks (0130–0244) — findings not always productized into protocol | v1.2 should land *protocol* fixes, not more finding tasks |

---

## 5. Preserve list (R5) — do not break

1. Always-on dual artifacts (not gated on `--save`)
2. Live-on-disk ledger + Basis column + anti-fiction cache math
3. Pipeline-driving `--max-retry` mandatory refusal (intent)
4. Finalize-or-abort concept + status model running|aborted|complete
5. Cache-health P3 rules and conservation *guidance*
6. Testee-scoped `--agent` semantics
7. Verdict grades testee not surrounding task
8. R22 prose invariants as a floor (extend, don't remove)

---

## 6. Prioritized findings for 0274 (IDs stable)

| ID | Sev | Finding | Maps to MUST/Pattern | Suggested fix class | Effort |
| --- | --- | --- | --- | --- | --- |
| **D1** | **P1** | Summary footer often omitted; no automated check on real reports | M12, M20 | Add finalize checklist bullet "print footer"; **golden fixture test** + optional `scripts/validate-dogfood-report.ts` | M |
| **D2** | **P1** | R22 only greps skill text — zero runtime/report compliance | M20 | Extend tests: fixture report must contain footer, six unique § headings, ledger row count ≥1, protocol colon form | M |
| **D3** | **P2** | Section structure drift (dup §6, broken Issues subheads, jumbled What-We-Did) | M9, M14, M18 | Finalize "structure scrub" checklist; reject complete if dup headings | S |
| **D4** | **P2** | Ledger steps ≠ executed step count | M7 | Require `|Steps: N derived, N executed|` equals ledger data rows | S |
| **D5** | **P2** | Protocol string `sp-` vs `sp:` inconsistency | M5 | Normalize to `sp:dogfood-testing@1.1` in templates + examples | S |
| **D6** | **P2** | Pipeline-driving detector brittle | F1, M1 | Explicit match list: `--next`, `\bdev-run\b`, `\brunall\b`, `\bwrapall?\b`, `\bidea\b`, `\bdev-run\b` without relying on leading space | S |
| **D7** | **P2** | Implement-in-dogfood token blowups for meta use | T1, T3, M17 | Policy: pipeline-driving + fix mode warns if derived step looks like full implement; recommend observe-only or step-split; optional Cost segmentation | M |
| **D8** | **P3** | Conservation discipline not machine-checked | M17 | Optional ledger column or finalize question "conservation applied?" | S |
| **D9** | **P3** | Provenance stop at testing under `--next` | F2 | Document expected terminal status in dogfood when testee is `--next` chain; link lifecycle issue separately | S |
| **D10** | **P3** | Only one recent report in `docs/dogfood/` — weak regression corpus | meta | Keep fixtures under `plugins/sp/skills/dogfood-testing/tests/fixtures/` (not only docs/) | S |

---

## 7. Implications for v1.2 cut line (input to 0274)

**Must-ship for "contract compliance + token efficiency":** D1, D2, D3, D4, D5, D6, D7 (policy + docs at minimum).

**Defer:** golden multi-command CI suite; ccusage meter wiring; smarter auto-fix IQ; changing lifecycle provenance (track outside dogfood unless D9 docs-only).

**Version:** bump metadata to `sp:dogfood-testing@1.2` when D1–D5 land.

---

## Source anchors (file:line)

- Protocol owner: `plugins/sp/skills/dogfood-testing/SKILL.md:1-23,67-136,261-281`
- Report contract: `plugins/sp/skills/dogfood-testing/references/report-template.md:19-48,109-133`
- Ledger + conservation: `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:99-133`
- R22 prose-only tests: `plugins/sp/tests/skill-structure.test.ts:207-236`
- Evidence report: `docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md:1-93`
- Live twin: `.spur/run/dogfood/2026-07-16-sp-dev-refine-0269.md`
### Testing
**Validation.**
- Read SKILL.md + report-template.md + monitor-ledger.md end-to-end
- Scored docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md against MUST list
- Confirmed no Dogfood Summary footer in docs/dogfood/
- Confirmed R22 only asserts prose (plugins/sp/tests/skill-structure.test.ts:207-236)
- Checked live path .spur/run/dogfood/2026-07-16-sp-dev-refine-0269.md exists

**Coverage:** N/A (research audit; no production code changed).
### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Protocol: plugins/sp/skills/dogfood-testing/
- Evidence: docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md
- Blocks: 0274
- Parallel with: 0270, 0271
### History
- 2026-07-17T01:11:31.301Z todo → wip (system)
- 2026-07-17T01:12:44.173Z wip → testing (system)
- 2026-07-17T01:12:46.930Z testing → done (system)
