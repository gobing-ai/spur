---
schema_version: 1
name: Make session review and dogfood produce trustworthy workflow-improvement evidence
status: done
template: standard
created_at: 2026-09-22T00:57:58.668Z
updated_at: "2026-09-22T05:58:59.663Z"
feature_id: I

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "8"
priority: P2
dependencies: ["0912"]
---

## 0913. Make session review and dogfood produce trustworthy workflow-improvement evidence

### Background

Robin requested this follow-up after reviewing dev-review-session, dev-dogfood and their backing plugin paths: "go ahead to add the new task file." Task 0912 owns the post-delivery baseline and pilot selection under D62; this task owns adoption of that evidence in shipped plugin contracts under I. Do not fold plugin implementation into the measurement task.

Review findings to reproduce:
- P2: plugins/sp/scripts/dogfood-testing/validate-report.ts:52 validates structure but not Cost presence or arithmetic. Pure validator probes accepted removal of the Cost block and a 999% cache figure. The golden fixture at plugins/sp/tests/dogfood-testing/fixtures/report-complete.md:38 reports 1400 total although fresh 1400 plus cached 700 totals 2100.
- P2: plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:106 derives chars/4 estimates, then :172 mandates cache-health findings at fixed 40/50 percent thresholds. Context-reuse estimates do not prove provider cache behavior or unnecessary rereading.
- P2: plugins/sp/commands/dev-dogfood.md:16 advertises retry default 3 versus skill default 2, task attachment versus creation of a new review task, and ambiguous chain-follow behavior. The skill allows reading existing chained evidence, not executing the chain.
- P3: session-review supports --triage, while docs/design/session-review.md and ADR-089 still describe an absolute mutation prohibition. Reconcile the documented explicit exception while preserving report-only default.
- Enhancement: plugins/sp/scripts/workflow-step-profile.ts:403 selects done runs and :255 emits aggregates without sampled IDs. That is not a defect in its existing scope, but it cannot alone provide a comparable failure/recovery baseline.

Two focused session-review structural tests passed during review, demonstrating that those tests do not catch these semantic discrepancies. No live dogfood or full test suite was run during review.

One cohesive plugin evidence-contract task, estimated 8 hours, because command guidance, report grammar, validator and tests must change together. Task-local AC is intentional: these implementation scenarios do not redefine umbrella I's ownership scenarios. Existing I9 owns the environment mapping and remains a reference; do not reopen or broaden its frozen category/protocol scope.

### Requirements

- [x] R1. Align dev-dogfood, its backing skill and shared flag references on retry default 2, testee-scoped agent forwarding, --task creating a review task, and --chain-follow reading existing chained evidence only.
- [x] R2. Strengthen the existing dogfood report validator to reject missing required Cost evidence, impossible percentages, contradictory observable token totals/cache arithmetic and unknown values silently folded into zero; correct the golden fixture and preserve valid aborted-report handling.
- [x] R3. Separate measured usage, heuristic context estimates and unavailable values in report guidance; remove automatic causal waste findings based solely on estimated cache thresholds and require evidence or a labeled hypothesis.
- [x] R4. Retain dogfood/testee run identity, source and executing-definition provenance, execution mode, measurement source/scope and known/total coverage for evidence used in pilot comparisons; preserve driver versus testee separation.
- [x] R5. Adopt only supported 0912 findings as focused session-review questions and dogfood observations, with artifact anchors and concrete owner handoffs; if 0912 is insufficient, preserve its limitations and implement no invented performance conclusion.
- [x] R6. Keep session-review inline, compact and report-only by default, preserve its explicit bounded --triage exception, reconcile owning documentation, and keep historical comparison/recurrence in history-anatomy or existing doctor tooling.
- [x] R7. Add semantic parity and negative evidence tests, preserve existing report compatibility and standalone plugin installation, and demonstrate the revised path with bounded local dogfood before recording verification.

### Acceptance Criteria

- [x] AC1 — Command skill and shared references expose the same dogfood semantics (req: R1)
- [x] AC2 — Invalid cost evidence is rejected and consistent measured estimated or unavailable evidence is accepted (req: R2)
- [x] AC3 — Estimated context reuse alone cannot establish cache waste or realized savings (req: R3)
- [x] AC4 — Pilot evidence carries attributable run provenance and honest coverage without mixing driver and testee cost (req: R4)
- [x] AC5 — Supported baseline findings are adopted and insufficient evidence produces an explicit limitation (req: R5)
- [x] AC6 — Session review preserves its evidence ownership and its explicit triage exception across documentation and tests (req: R6)
- [x] AC7 — Regression suites and a bounded local dogfood confirm the revised evidence path (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T00:59:28.765Z

Decision: one task under existing plugin owner I, with explicit dependency 0912 for the full evidence-adoption deliverable. The known correctness fixes are independently reproducible and do not scientifically depend on 0912; the dependency sequences the combined task so performance guidance uses actual results.

Scope authorized in this session is task creation. This task specifies future implementation; no implementation, feature status closure, plugin installation or runtime workflow change is claimed now.

0912 may conclude insufficient evidence. That outcome does not block the correctness fixes: use its explicit limits and owner handoff, defer unsupported tuning, and do not manufacture a benchmark. Protocol @1.2 and closed history categories remain unchanged; new provenance is additive and old reports without it remain readable but non-comparable.

Size: eight-hour planning estimate; one shared evidence-contract review boundary. Do not split command wording and validator semantics into separate phase tasks. Parent I's status is not automatically changed by this capture.

### Design

Use existing owners: commands remain thin wrappers; session-review owns active-context diagnosis; dogfood-testing owns execution/ledger/reporting; history-anatomy and spur-doctor own historical interpretation. No new agent, slash command, workflow, analytics engine, dependency, runtime schema or public CLI surface.

Primary edit surface:
- plugins/sp/commands/dev-dogfood.md and dev-review-session.md only where interface wording changes.
- plugins/sp/skills/dogfood-testing/SKILL.md and references/{monitor-ledger,report-template}.md; session-review/SKILL.md; spur-dev/references/{flag-glossary,dev-operations}.md.
- plugins/sp/scripts/dogfood-testing/validate-report.ts and tests/dogfood-testing/report-contract.test.ts plus fixtures.
- plugins/sp/tests/{command-contract,skill-structure}.test.ts for semantic consistency.
- docs/design/session-review.md and applicable dogfood/history surface owners; read docs/99_PROJECT_CONSTITUTION.md and use sp:doc-evolve before edits. Preserve ADR-089 history with a narrowly dated clarification of the already-shipped explicit triage exception, not a silent rewrite.

Metric contract: retain protocol @1.2 and existing headings. Require Cost/Method/confidence/Meter in complete reports. Distinguish measured data from heuristic estimates and unknowns. Validate observable totals as fresh+cached, cache share against that denominator with documented display-rounding tolerance, and percentages within 0..100. All-unknown or zero-denominator evidence renders n/a rather than a fabricated percentage. Unknown chained rows stay outside numeric sums and remain visible in coverage. Do not combine daily/session meters with per-step estimates. Legacy reports without new provenance remain readable but are not automatically eligible for comparison; do not rewrite archived reports.

Provenance is additive in the existing report Testee/Cost sections: dogfood run ID, testee workflow/run/session IDs when known, source commit/dirty-state evidence, resolved definition digest or path+hash, execution mode, measurement scope/source and sample coverage. Unsupported identifiers remain unknown. Before claiming comparability, require compatible scope, mode and evidence; otherwise emit not comparable and route missing evidence to its owner. Preserve historical-analysis ownership: no baseline loader, history import or cohort calculator in session-review.

Consume docs/reports/i31/0912-workflow-baseline.{json,md} only after 0912 produces validated outputs. Cite the actual supported findings rather than hard-code a guessed schema today. Select at most three relevant live-session review questions, such as repeated gates or recovery overhead, only when justified. If 0912 returns INSUFFICIENT_EVIDENCE, ship the independently reproduced correctness fixes and evidence handoff, explicitly defer performance-specific tuning, and claim no speedup.

Reuse workflow-step-profile calculations where compatible. Do not silently change its done-only population for existing consumers. Missing run IDs/failure coverage can be supplied by cited 0912 artifacts; widen a profiler return shape only if integration demonstrates a need, with consumer tests. Keep exact cache coverage/null handling already implemented there.

Implementation preserves proof-window mirror freezing, run-local ledgers, bounded retries, explicit mutating-testee consent and environment proposals. A validated report proves its contract, not causality, benchmark representativeness or realized savings. Keep skill BODY_BUDGET limits; move detailed procedure to existing references. Generated installed adapters go through Superskill, never manual edits.

Rejected: treating 0912 task readiness as measurement completion; duplicating a telemetry subsystem; converting session-review into a benchmark command; broad workflow refactoring; separate tasks for each wording fix; suppressing validator errors or retroactively editing archived evidence.

### Plan

1. Recheck 0912 status and validated artifacts; retain the insufficient-evidence branch if necessary. Read current plugin source, callers, owning design and tests; reproduce the reported validator and semantic gaps.
2. Add focused failing tests for missing Cost, impossible percentages, wrong totals, unknown-versus-zero, all-unknown and rounding cases. Add semantic command/skill checks without snapshotting entire prose.
3. Fix report validation and fixture arithmetic in the existing module; align metric terminology and remove unsupported causal thresholds.
4. Align command/skill/shared-reference semantics and the existing triage documentation exception. Add provenance to existing report sections and tests for comparison eligibility without breaking readable legacy reports.
5. Incorporate supported 0912 findings into bounded review questions and dogfood observation/handoff guidance. Leave historical comparisons with their existing owner.
6. Run focused plugin tests from plugins/sp, including tests/dogfood-testing, command-contract.test.ts and skill-structure.test.ts. Run relevant profiler tests only if that module changes.
7. Run required task-local and feature-scoped checks, script contract/parity checks and plugin-smoke; generate scripts/adapters through supported Superskill tooling as needed. Perform bounded local observe-only dogfood with explicit --max-retry 0, checking both valid and invalid report paths. Do not launch a paid fleet for this check.
8. Review the final diff against this task, record actual verification through the harness, and report remaining telemetry limits separately from correctness.

### Solution

All changes confined to declared paths; `workflow-step-profile.ts` unchanged — the 0912 baseline
(`docs/reports/i31/0912-workflow-baseline.md`) already documents the provenance enhancements, so
adding fields now would duplicate adopted work without a new consumer.

- **R1 semantics alignment** — `plugins/sp/commands/dev-dogfood.md:16-22` flag table: retry
  default 3 → 2, `--agent` marked testee-scoped, `--task` = creates a review-template task (never
  attaches to the task under test), `--chain-follow` = reads existing chained-leg evidence only.
  `plugins/sp/skills/spur-dev/references/flag-glossary.md:251,336` — `--task` bullet now says
  "creates"; `--max-retry` paragraph pins dev-dogfood to default 2 / `0` = observe-only, matching
  the skill.
- **R2 validator cost evidence** — `plugins/sp/scripts/dogfood-testing/validate-report.ts`:
  `validateCostEvidence()` wired into `validateReport()`; rejects missing Cost block/fields,
  impossible percentages, total ≠ fresh+cached (line and footer), cache-share ≠ ledger formula
  beyond ±1pt display rounding, fabricated shares over all-unknown rows, unknown-folded-into-zero.
  Error codes: `missing_cost_block`, `missing_cost_field:<f>`, `impossible_percentage:<v>%`,
  `cost_total_mismatch:{cost|footer}_expected_<n>`, `missing_cache_share:<label>`,
  `cache_share_mismatch:<label>_expected_<n>`, `fabricated_cache_share:{cost|footer}`,
  `unknown_row_with_numeric_cache`. Ledger column indices fixed (5=Fresh, 6=Cached, 7=Cache%).
  Golden fixture `tests/dogfood-testing/fixtures/report-complete.md` corrected (1400 → 2100) and
  extended with provenance lines. `.mjs` twin regenerated via `superskill script convert`.
- **R3 heuristic relabel + causal-rule retirement** — `references/monitor-ledger.md`: Cache %
  column and heuristic section relabeled as estimated context-reuse share (chars/4, not provider
  cache truth); "Cache-health finding rule" replaced by "Context-reuse observation rule"
  (threshold crossings never auto-generate causal waste findings; measured / estimated /
  unavailable evidence classes; labeled-hypothesis `[unverifiable]` shape); worked example,
  cache-conservation checklist, and frontmatter updated.
  `references/report-template.md`: Cost honesty rules separate measured/estimated/unavailable;
  cache-health paragraph replaced by evidence-or-hypothesis rule; §6 P3 description updated.
  Design satellites: `docs/design/dev-agent-flag-and-dogfood-skill.md` (dated amendment),
  `docs/design/environment-improvement-lens.md` (finding-class references).
- **R4 provenance contract** — `references/report-template.md` §1: additive provenance lines
  (source commit + dirty state, definition path/hash, execution mode, measurement scope, sample
  coverage + testee run/session IDs) + "Provenance and comparability" paragraph: legacy reports
  readable and valid, comparison-eligibility requires compatible scope/mode/definition identity,
  `not comparable` otherwise, `unknown` never invented.
- **R5 0912 adoption** — `references/monitor-ledger.md` "Pipeline-run provenance observations
  (task 0913, R5)": supported findings (F1/F2) adopted as bounded observations with anchors and
  owner handoffs (driver adoption D62, row-closure defect P); INSUFFICIENT_EVIDENCE areas stay
  excluded (no token/USD/percentage/fleet claims; gaps routed to E6/F3/F4/S5).
  `plugins/sp/skills/session-review/SKILL.md` step 4 + output contract: ≤3 bounded diagnostic
  questions from the 0912 baseline, report-only preserved.
- **R6 reconciliation** — `docs/design/session-review.md`: `--triage` added to operator surface,
  bounded exception documented, `updated_at` 2026-09-22; `docs/00_ADR.md` ADR-089: dated
  "Amendment 2026-09-22 (task 0913)" recording the shipped exception without reopening the
  decision. Skill/command were already accurate.
- **R7 tests** — `tests/dogfood-testing/report-contract.test.ts`: new `cost evidence contract
  (task 0913, R2/R7)` describe block (9 tests: missing block/fields, impossible %, total
  mismatch cost+footer, cached inconsistency + share mismatch, unknown-folded, all-unknown valid,
  fabricated share, rounding tolerance). `tests/command-contract.test.ts`: dev-dogfood ↔ skill
  semantics parity test (R1). `tests/skill-structure.test.ts`: R3 causal-rule retirement, R4
  provenance contract, R5 adoption + owner handoffs, R6 four-way --triage reconciliation.
  R44 body-baseline for `dogfood-testing` bumped 39103 → 39266 with dated comment (rule bodies
  live in references; only pointers in SKILL.md).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-dogfood.md:14-21` — retry default `2`, `--agent` **Testee-scoped**, `--task` **Creates** a review-template task ("does not attach to or update the task under test"), `--chain-follow` **Reads existing chained-leg evidence** ("never executes the chained leg itself"); `flag-glossary.md:251,338` ("creates"; "the default is `2` (fix mode) and `--max-retry 0` selects observe-only"); parity test `tests/command-contract.test.ts:1183-1206` asserts all strings across command/skill/glossary — re-checked statically |
| R2 | MET | `validate-report.ts:137-251` — `validateCostEvidence` wired; **round-1 gap closed**: `validate-report.ts:152` pushes `malformed_cost_line` and **continues** (comment :148-150 names the retired early-return defect); `:157` pushes `malformed_footer`; the per-row impossible-% scan (`:161-168`) now runs unconditionally, so the garbled-cost-line + `999%`-cell repro that validated `ok` pre-fix now fails; single column comment `:124` (P4-1 closed); fixture arithmetic recomputed (600+400=1000→40%, 800+300=1100→27.3%, 1400+700=2100→33.3%, cost line + footer both 2100/700/33%); CLI exit contract 0/2/1 unchanged (`:296-317`); `.mjs` twin line-checked logic-identical (same guards, codes, indices 5/6/7, ±1pt tolerance, CLI) |
| R3 | MET | `monitor-ledger.md:175-197` — "Context-reuse observation rule": estimated chars/4 ≠ provider cache truth, thresholds "never auto-generate a causal waste finding", `[unverifiable]` hypothesis shape, measured/estimated/unavailable classes; grep for retired causal-rule strings over `references/` = 0 matches; `report-template.md` carries the evidence-or-hypothesis rule; satellites `docs/design/dev-agent-flag-and-dogfood-skill.md`, `docs/design/environment-improvement-lens.md` amended; regression note `report-contract.test.ts:243-250` (line *shape* still validates) |
| R4 | MET | `report-template.md` §1 additive provenance (source commit+dirty, definition digest/path+hash, execution mode, measurement scope, sample coverage + testee IDs) + comparability paragraph; golden fixture carries all lines including honest `Comparability: not comparable` (`fixtures/report-complete.md:28-33`); test `tests/skill-structure.test.ts:1179-1186` |
| R5 | MET | `monitor-ledger.md:199-215` — adopts exactly the baseline's pilot-eligible F1/F2 with anchors and handoffs "driver adoption: D62; row-closure defect: P", verbatim-consistent with `docs/reports/i31/0912-workflow-baseline.md:37,55` ("P owns row closure; D62 owns driver adoption"; E6/F3-F4/S5 gaps); INSUFFICIENT_EVIDENCE exclusions preserved (no token/USD/percentage/fleet claims); `session-review/SKILL.md:87-94` now labels "supported observations (F1/F2) and measured overhead candidates (F3/F4)" (P4-2 closed), ≤3 questions, report-only |
| R6 | MET | Four-way reconciliation verified in source: ADR-089 dated amendment `docs/00_ADR.md:1281-1287` ("does not reopen the decision", two bounded mutation classes); `docs/design/session-review.md` surface + `bounded --triage exception`; command `[--triage]` report-only default; test `tests/skill-structure.test.ts:1145-1165` |
| R7 | MET | Cost-evidence suite now 12 tests incl. the 2 new regression tests: `report-contract.test.ts:345-356` asserts exactly `malformed_cost_line` + `impossible_percentage:999%` on the pre-fix-silent repro (red by construction: old code `return`ed before the % scan), `:358-363` asserts `malformed_footer`; `.mjs` twin parity + standalone imports verified; recorded evidence (not re-executed here): remediation hop 33+154 pass, fresh gate 8676 tests digest sha256:251edf38… |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `tests/command-contract.test.ts:1183-1206`; command/glossary strings re-confirmed present in source (no `\| 3 \|` default anywhere in the flag table) |
| AC2 | MET | test | 12 cost tests traced 1:1 to implemented codes (`missing_cost_block`, `missing_cost_field:*`, `impossible_percentage:*`, `cost_total_mismatch:{cost,footer}_expected_2100`, `cost_total_mismatch:cost_cached_expected_700`, `cache_share_mismatch:cost_expected_33`, `unknown_row_with_numeric_cache`, all-unknown→ok, `fabricated_cache_share:{cost,footer}`, `malformed_cost_line`, `malformed_footer`, ±1pt rounding); CLI 0/2 exit in `runValidateCli` (`validate-report.ts:296-317`); recorded CLI probe (remediation answer): malformed report → exit 2, `malformed_cost_line`+`impossible_percentage:999%`, pre-fix validated ok |
| AC3 | MET | test | `monitor-ledger.md:175-197` threshold rule retired; forbidden strings absent (grep: 0 matches); `tests/skill-structure.test.ts:1167-1177`; legacy line shape still validates (`report-contract.test.ts:250-255`) |
| AC4 | MET | test | `report-template.md` provenance/comparability contract; fixture `:28-33` incl. `Comparability: not comparable`; driver/testee separation retained; `tests/skill-structure.test.ts:1179-1186` |
| AC5 | MET | test | `monitor-ledger.md:199-215` fidelity-checked against the actual baseline artifact (`0912-workflow-baseline.md:37,46-55,61`); `session-review/SKILL.md:87-94`; `tests/skill-structure.test.ts:1188-1200` |
| AC6 | MET | test | Four-way test `tests/skill-structure.test.ts:1145-1165`; ADR-089 amendment `00_ADR.md:1281-1287`; satellite and command re-read |
| AC7 | MET | test | Regression tests red-proven by construction and traced against validator logic; `.mjs` twin logic-identical; recorded: 185→187-pass suites, observe-only dogfood, fresh gate 8676 tests PASS digest sha256:251edf38bf… — recorded, not re-executed by this verifier (read-only runtime) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P3 | `plugins/sp/scripts/dogfood-testing/validate-report.ts:149` | Silent `return` on present-but-unparseable cost line/footer disabled all downstream cost checks | **Closed** in remediation hop 1: `malformed_cost_line`/`malformed_footer` emitted, validation continues (`:152,157`); red-proven regression tests added |
| P3 | `plugins/sp/references/environment-lens.md:27` | Shipped mapping row drifted from its updated satellite wording | **Closed**: row now "existing evidence-based reuse-observation P3 (task 0913)" ≡ satellite `:50` |
| P4 | `validate-report.ts:124-125` | Contradictory duplicate column comments | **Closed**: stale line deleted; single comment matches `cells[5]/[6]/[7]` |
| P4 | `plugins/sp/skills/session-review/SKILL.md:88-90` | F3/F4 called "supported findings"; baseline marks them measured overhead candidates | **Closed**: precise epistemic labels ("supported observations (F1/F2) and measured overhead candidates (F3/F4)") |

No P1/P2 findings. Residual advisories (non-blocking): environment-lens↔satellite row parity untested; per-row Cache % range-checked but not row-arithmetic-checked; absent footer line skips footer-totals comparison (Cost block still enforced).

- **Verdict: APPROVED** (review 2026-09-22, `/sp:dev-review 0913 --auto`). P0/P1/P2: none. Traceability R1–R7, AC1–AC7 all PASS (fixture arithmetic recomputed; R5 verified against `docs/reports/i31/0912-workflow-baseline.md`; R6 verified four-way across command/skill/satellite/ADR-089 amendment; `.mjs` twin logic-checked against `.ts`).
- P3 — `plugins/sp/scripts/dogfood-testing/validate-report.ts:149`: a present-but-unparseable `**Ledger estimate:**` line silently skips all remaining cost checks (`return;` — comment "missing field already reported" holds only for an absent label); unparseable `Tokens:` footer takes the same silent path. Fix: emit `malformed_cost_line`/`malformed_footer` instead of returning.
- P3 — `plugins/sp/references/environment-lens.md:27`: shipped mapping still says "existing cache-health P3"; its satellite was updated (evidence-based reuse-observation) but the mirrored reference row was not, and no test asserts row parity.
- P4 — `validate-report.ts:124-125`: contradictory duplicate column comments; delete the stale `… 6 Fresh, 7 Cached, 8 Cache %` line (code and second comment are correct).
- P4 — `plugins/sp/skills/session-review/SKILL.md:88-90`: F3/F4 named "supported findings"; baseline calls them "not yet pilot-eligible" candidates under the F3/F4 INSUFFICIENT_EVIDENCE pilot. Report-only and conclusion-free either way; wording precision only.
- **Round 2 (2026-09-22, post-remediation): APPROVED** — all four round-1 findings CLOSED with file:line evidence; the two new regression tests are red-proven by construction; `.mjs` twin logic-identical; remediation scope held (5 declared files); CLI error/exit contract untouched; no regressions or new defects. Residual: environment-lens↔satellite row parity remains untested (advisory).
- Residual risk: reviewer ran read-only checks only (no shell available); test suites/biome/plugin-smoke not re-executed — rely on the recorded test-stage green plus the pipeline's verify stage. Validator arithmetic gap in P3-1 needs a template-deviant report to trigger.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T04:57:12.672Z backlog → wip (system)
- 2026-09-22T05:55:59.316Z wip → testing (system)
- 2026-09-22T05:58:59.663Z testing → done (system)

