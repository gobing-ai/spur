---
template: meta
schema_version: 1
name: "Fix 0567-run process bottlenecks: plan-time size gate, verdict/record contract docs, stale spur PATH, dogfood discipline"
description: ""
status: backlog
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T16:37:16.435Z"
updated_at: "2026-08-16T18:56:36.678Z"
---

## 0568. Fix 0567-run process bottlenecks: plan-time size gate, verdict/record contract docs, stale spur PATH, dogfood discipline

### Background
Task 0567 (dev-history-load slash command) completed with a PASS verdict and shipped on the first
pipeline pass, but the run exposed systematic process waste. The full inline pipeline run
(2026-08-16, 06:58–07:39 UTC, omp session `2026-08-16T06-27-49-101Z_01a00941-4aed-7000-898a-bc5626b893ba`)
cost 40.5 min wall and $1.32, of which **~$0.12 (9%) was avoidable churn** and ~4.4 min + a
5.6-minute operator round-trip was a preventable gate failure.

Forensic analysis (via `spur history report --mode forensics` + raw JSONL fallback) identified four
cost clusters:

- **Precheck size gate failed on run 1** (5% of cost, $0.064): the task was authored with 9 Plan
  items against a documented cap of 8 (`maxImplementPlanItems`), and the size-vs-executor capability
  gate requires a `capable-1+` executor that **no installed executor satisfies** (all report tier
  `standard`). Fix required a manual Plan trim + full operator `ask` round-trip. The task's own Q&A
  documented deliberate sizing to 5 R-items "to stay under the maxImplementReqs: 5 precheck" but the
  Plan-item count was overlooked — a check that runs at task-authoring time, not first at pipeline
  precheck, would have caught it pre-run.
- **Verify step cost 21% of the run ($0.272)** for a PASS verdict, driven by three answer-file
  rewrites: (a) `normalizeEvidenceType` accepts single tokens only, so `test + command` compound
  values silently dropped 8 of 10 AC rows (`acceptanceCriteria.length` went 10 → 2 with no warning);
  (b) scenario-keying warning required regenerating AC rows with byte-identical `Scenario: R1 — …`
  titles; (c) stale `file:line` anchors (`:176-219`, `:205-219`, `:88-225` on a 211-line test file)
  were caught by the L4 gate at record time, not at authoring, and required three fix passes because
  `spur task record` re-transcribes `## Testing` from the verdict artifact — fixing the section
  directly is wasted work; the answer file is the real source.
- **Record step (12% of cost, $0.154)** was denied twice by the `wip → testing` guard (missing
  P1–P4 findings table in `## Review`; stale anchors re-appearing via verdict transcription).
- **Stale global `spur` on PATH**: `spur history import --source omp` via the PATH binary
  (`/Users/robin/node_modules/@gobing-ai/spur/spur.js`, `importer: unknown`) failed with exit 1;
  the monorepo-local CLI (`bun run apps/cli/src/index.ts`, `importer: 0.4.32`) works. AGENTS.md R4
  documents this, and the issue-finding skill's Phase-1 snippet uses bare `spur` — the failure mode
  recurs whenever any skill shells `spur` directly.

Each root cause is documented with forensic evidence in Notes (RC1–RC6). The fix set is
documentation/guidance-first: the harness guards are correct; agents and skills lack discoverable
constraints until they hit them. One code change (`normalizeEvidenceType` compound-token
acceptance) is included because the current behavior is a silent data-drop, not a guard.

Scope discipline: this is a meta fix task — each requirement is a standalone, independently
verifiable fix with its own acceptance criteria. No requirement changes task 0567's shipped
behavior.
### Requirements
- [ ] R1. Add a plan-time size warning at authoring time (not first at pipeline precheck): `spur task create` and `spur task update --section Plan|Requirements` emit a visible non-blocking stderr warning when R-item count > 5 or Plan checklist items > 8, reusing `evaluateTaskSize` / `countRItems` / `countPlanItems` and `DEFAULT_TASK_SIZE_LIMITS` from `packages/app/src/services/task-size-precheck.ts`. Acceptance: a task authored with 9 Plan items produces the warning before any pipeline run; zero false positives on a conforming 8-item task; the plugin parity test (`plugins/sp/tests/task-size-precheck.test.ts:76`) still passes. Surface-change note: this touches the public CLI and requires operator consent per ADR-051 + `docs/04_DESIGN.md` in the same commit (T3).
- [ ] R2. Extend `normalizeEvidenceType` in `packages/app/src/services/task-verdict.ts:232` to accept compound evidence types (`test + command`, `command + dogfood`, …) as the union of their parts: split on `+`/`,`/`/` and accept when every component is a known token. Acceptance: a verdict answer with `test + command` evidence types yields 10/10 parsed AC rows; single-token behavior and the existing `ac-row-dropped` fail check (0398 R6) are unchanged for genuinely unknown tokens. (The loud-warning half of the original requirement already landed in 0398 R6 — `task-verdict.ts:320-330` names each dropped row; do not re-implement it.)
- [ ] R3. Document the record-step source-of-truth in `plugins/sp/skills/code-verification/SKILL.md` Step 10: `## Testing` is transcribed from the verdict artifact at `spur task record`, so verify-time anchor fixes must be applied to the answer file followed by `spur task verdict --from-answer` + re-record — never to the task section directly. The current Step 10 leads with a direct `spur task update --section Testing` write; make the answer-file workflow authoritative for corrections. Acceptance: Step 10 contains the note; a reviewer following the skill fixes stale anchors in one pass (answer file → re-derive → re-record) with no second guard denial.
- [ ] R4. Make the issue-finding skill's Phase-1 snippet (`plugins/sp/skills/issue-finding/SKILL.md:142-145`) resolve `spur` monorepo-safely (SPUR_BIN env > monorepo-local CLI > PATH), mirroring `defaultSpurBin()` at `plugins/sp/scripts/task-size-precheck.ts:76`. Acceptance: running the Phase-1 commands from the skill in a monorepo checkout uses the local CLI (provenance `binary: …/apps/cli/src/index.ts`, `importer: 0.4.x`), not a stale PATH install.
- [ ] R5. Extend the test-discipline guidance in `plugins/sp/skills/code-implementation/SKILL.md` (targeted-probe guidance already exists at lines 88-89 — do not duplicate it): add the "full plugin suite at most twice per task" cap (task 0436 R2) and a dogfood-consolidation note (single combined real-data run instead of N near-identical `--dry-run`/real runs). Acceptance: a follow-on task run shows ≤2 full-suite invocations and no repeated identical dogfood commands (loop detector reports zero 3× repeats).
- [ ] R6. Audit executable procedure snippets in `plugins/sp/skills` (Phase/Step command blocks an agent would run verbatim, e.g. issue-finding Phase 1, next-feature signal-derivation) for bare first-command `spur` shell-outs and route them through the monorepo-safe resolver (same as R4). Out of scope: `plugins/sp/skills/spur-cli/references/*` and other CLI-reference documentation that documents the public `spur` surface itself — those intentionally name the `spur` command. Acceptance: every executable skill shell-out either uses the resolver/`SPUR_BIN` or carries an explicit "PATH-dependent by design" note; CLI-reference docs are untouched.
### Acceptance Criteria
```gherkin
Feature: Fix 0567-run process bottlenecks

  @core
  Scenario: R1 — Plan-time size precheck warns before any pipeline run
    Given a task whose ## Plan contains 9 checklist items
    When the operator authors or refines the task via the CLI
    Then a visible warning names the 9-item count against the cap of 8
    And no pipeline precheck run is needed to discover the violation

  @core
  Scenario: R2 — Compound evidence types parse as the union of their parts
    Given a verify answer with AC evidence type "test + command"
    When spur task verdict derives the verdict
    Then all 10 AC rows are parsed
    And no row is silently discarded
    And an unknown component (e.g. "bogus + test") still triggers the ac-row-dropped fail check

  @core
  Scenario: R3 — Record-step source-of-truth documented
    Given the sp-code-verification skill Step 10
    When a verifier fixes a stale anchor in the verify answer
    Then the skill directs the fix to the answer file, re-derivation, and re-record
    And a follow-on record run is not denied a second time for the same anchor

  @core
  Scenario: R4 — Issue-finding skill uses the monorepo-safe spur
    Given a monorepo checkout with a stale spur on PATH
    When the skill's Phase-1 commands are executed as written
    Then the resolved binary is the local CLI (provenance binary: apps/cli/src/index.ts)
    And history import succeeds with a real importer version

  @core
  Scenario: R5 — Test discipline documented and followed
    Given the sp-code-implementation skill
    When a task's implement step runs
    Then targeted tests run before any full suite
    And the full plugin suite runs at most twice per task

  @core
  Scenario: R6 — No bare spur shell-outs in executable skill snippets
    Given the audit across executable procedure snippets in plugins/sp/skills
    When scanning for first-command spur invocations
    Then every shell-out resolves via SPUR_BIN or the monorepo-local CLI
    And none depend on PATH freshness
    And CLI-reference documentation (spur-cli references) is untouched
```
### Q&A
**Q1: Why documentation/guidance-first instead of code fixes?** The harness guards are correct —
the size gate, the verdict schema, and the record transcription all behaved as designed. The waste
came from agents and skills lacking *discoverable* constraints (plan cap, evidence-type tokens,
answer-file-as-source) until a gate tripped mid-run. Documenting the constraint at the authoring
surface prevents the run-time trip; changing the guards to be laxer would weaken the safety net.

**Q2: Why is R2 a code change and not guidance?** `normalizeEvidenceType` silently drops compound
tokens (returns null → row pushed to `dropped[]`, which surfaces only as a count in checks, not a
named warning). A silent data-drop is a correctness bug, not a guidance gap: either accept the union
of tokens (they are semantically valid — a test run plus a command both exist as evidence) or
surface the dropped rows loudly. Guidance alone cannot fix a silent drop.

**Q3: Where should the plan-time size check live?** Reuse the caps already centralized in
`packages/app/src/services/task-size-precheck.ts` (`maxReqs: 5`, `maxPlanItems: 8` via the
`LARGE_TASK_REQS`/`LARGE_TASK_PLAN_ITEMS` constants) rather than duplicating them. The cheapest
surface is a `spur task check --size` mode (or an authoring-time warning in `task create` /
`task update --section Plan`), so the authoring session sees it before any pipeline run. The
`task-size-precheck.ts` script and the app service must stay in parity — there is already a test
pinning them (`plugins/sp/tests/task-size-precheck.test.ts` "plugin large-task thresholds stay
aligned").

**Q4: Hook vs guidance for R1?** A hook (e.g. task-file-policy) could block Plan writes over the cap,
but that is heavier than needed and risks false positives during legitimate multi-edit workflows.
A visible authoring-time warning is the right calibration — the pipeline precheck remains the hard
gate; R1 just moves the discovery earlier so the operator does not burn a run + round-trip.

**Q5: What is the expected saving?** R1: ~4.4 min + 5.6-min operator wait per affected task (the
0567 run-1 failure + `ask`). R2+R3: ~$0.12–0.15 and two guard-denial cycles per verify on the
common compound-token/stale-anchor mistakes. R4/R6: eliminates the failed-import class entirely on
this machine (global spur fails `history import` with exit 1). R5: ~1–2 min per task from fewer
full-suite runs and consolidated dogfood.

**Q6: Decomposition?** Each requirement is independent and verifiable in isolation; R4 and R6 are
related (same resolver pattern, two surfaces) and could pair in one implement pass. R1 is the
highest-leverage item (prevents a full failed pipeline run). No requirement depends on another's
output; safe to run in any order.
**Q7 (added at ready-refine): Does R2 still need the loud-warning half?** No — verified against
the current tree: task 0398 R6 already emits a failing `ac-row-dropped` check naming each dropped
row and its token (`packages/app/src/services/task-verdict.ts:320-330`), with row reasons recorded
in `dropped[]` since the same change (`:209-214`). R2 is narrowed to compound-token union
acceptance only; the requirement text and AC were corrected in this refine.

**Q8 (added at ready-refine): New CLI flag or warning on existing verbs for R1?** Warning on
`task create` / `task update --section` — no new flag, no new noun (ADR-051 noun discipline). The
change still touches the public CLI surface, so operator consent + `docs/04_DESIGN.md` in the same
commit (T3) are required. Caps and counting logic are reused from the app service, never duplicated
in the CLI layer (ADR-021).

**Q9 (added at ready-refine): Is R5 a fresh add?** No — targeted-test-first guidance already exists
(`code-implementation/SKILL.md:88-89`). R5 extends it with the ≤2 full-suite cap (0436 R2) and
dogfood consolidation. Stale anchors corrected at refine: `defaultSpurBin` is
`task-size-precheck.ts:76` (not :96-100); the parity test is `task-size-precheck.test.ts:76` (not
:173-179); `normalizeEvidenceType` starts at `task-verdict.ts:232` (not :230).
### Design
Six independent fixes (R4+R6 pair naturally in one pass). Premises re-verified against the current tree during ready-refine; corrections from the original Background are called out per item. No requirement changes task 0567's shipped behavior.

**R1 — Plan-time size warning.** WHERE: `apps/cli/src/commands/task.ts` (thin wiring; ADR-021) calling `evaluateTaskSize` / `countRItems` / `countPlanItems` + `DEFAULT_TASK_SIZE_LIMITS` from `packages/app/src/services/task-size-precheck.ts:112` (currently no CLI consumer — the pipeline precheck shells the plugin script's own copy). WHAT: after a successful `spur task create` and `spur task update --section Plan|Requirements`, count R-items/Plan items in the resulting task body and print a non-blocking stderr warning naming the count vs cap. WHY warning-not-block: Q4 — hooks blocking writes risk false positives in legitimate multi-edit workflows; the pipeline precheck remains the hard gate. GATES: public-CLI surface change → operator consent per ADR-051 + `docs/04_DESIGN.md` same commit (T3). Parity test to keep green: `plugins/sp/tests/task-size-precheck.test.ts:76` ("plugin large-task thresholds stay aligned"). Anti-pattern: do NOT duplicate the caps in the CLI layer, and do NOT add a new noun/verb.

**R2 — Compound evidence types.** WHERE: `normalizeEvidenceType` at `packages/app/src/services/task-verdict.ts:232`. CORRECTION: the loud-dropped-rows half already exists — 0398 R6 emits a failing `ac-row-dropped` check naming each dropped row and its unrecognized token (`task-verdict.ts:320-330`). Only the union-parse half remains. WHAT: split the raw value on `+`/`,`/`/`, trim, and accept when every component normalizes to a known token; map the union to the existing single `evidenceType` field with precedence `test > command > static-ref > manual-review > llm-judge > n/a` (the field is single-valued — the strongest executable evidence wins, matching `applyAcceptanceCriteriaEvidenceRule`'s test/command preference). Unknown component → return null as today (the existing dropped-row check then names it). Tests: `packages/app/tests/` verdict suite — `test + command` parses 10/10; `bogus + test` still drops loudly. Anti-pattern: do NOT widen the whitelist with new tokens (`dogfood` etc.) and do NOT touch the 0398 R6 check.

**R3 — Record-step source-of-truth doc.** WHERE: `plugins/sp/skills/code-verification/SKILL.md` Step 10 (line 232). CORRECTION: the transcription caveat exists only as a side note (line 297) while Step 10's procedure still leads with a direct `spur task update <wbs> --section Testing` write — the trap. WHAT: add an explicit note that `## Testing` is re-transcribed from the verdict artifact at `spur task record`, so anchor/evidence corrections go: fix answer file → `spur task verdict --from-answer` → re-record; direct section edits are overwritten. Doc-only. Anti-pattern: do NOT restructure Step 10's happy path (initial Testing authorship still goes through `--section`); the note governs corrections.

**R4 — Issue-finding spur resolution.** WHERE: `plugins/sp/skills/issue-finding/SKILL.md:142-145` (Phase 1 fallback commands). WHAT: replace bare `spur history import/analyze/report` with the resolver pattern from `defaultSpurBin()` at `plugins/sp/scripts/task-size-precheck.ts:76` (SPUR_BIN env > monorepo-local `apps/cli/src/index.ts` via Bun > PATH). In a markdown skill the resolver is expressed as a short shell prelude the snippet defines once and reuses (`SPUR_BIN` override preserved). Anti-pattern: do NOT hardcode the monorepo path — non-monorepo installs must fall back to PATH.

**R5 — Test discipline doc.** WHERE: `plugins/sp/skills/code-implementation/SKILL.md`. CORRECTION: targeted-test-first guidance already exists (lines 88-89, "Run only targeted probes … `bun test <file> --test-name-pattern`") — do not duplicate. WHAT: extend with (a) the full-plugin-suite ≤2× per task cap (task 0436 R2, also enforced in AGENTS.md verification gate) and (b) dogfood consolidation — one combined real-data run instead of N near-identical invocations. Doc-only.

**R6 — Bare-spur audit.** WHERE: executable procedure snippets under `plugins/sp/skills` (Phase/Step fenced command blocks an agent would run verbatim). SCOPE FROZEN: `plugins/sp/skills/spur-cli/references/*` documents the public CLI surface and intentionally names bare `spur` — excluded. Known hits to triage: `issue-finding/SKILL.md:142-145` (R4 covers), `next-feature/references/signal-derivation.md:10,37`, `code-verification/SKILL.md:378`. Each in-scope hit gets the resolver prelude or an explicit "PATH-dependent by design" note. Anti-pattern: do NOT blanket-rewrite reference docs; the acceptance criterion is about executable shell-outs, not grep-zero.

**Cross-cutting:** R2 is the only code change; R1 is the only CLI-surface change (consent + T3 doc); R3–R6 are doc/skill edits. No `dependencies[]`; no feature_id, so the DD-09 feature-subset rule does not apply. Handoff: none — six standalone fixes, R4/R6 share the resolver pattern and pair in one implement pass.
### Plan
- [ ] R2 first (only code change): extend `normalizeEvidenceType` (`packages/app/src/services/task-verdict.ts:232`) with compound-token union parsing + precedence; add unit tests for `test + command` (parses 10/10) and `bogus + test` (still dropped loudly). Targeted: `bun test packages/app/tests --test-name-pattern verdict` (or the verdict suite file) before any full run.
- [ ] R1: wire the authoring-time size warning into `apps/cli/src/commands/task.ts` (`create` + `update --section`) over the app-service helpers; confirm operator consent for the CLI surface change (ADR-051) and update `docs/04_DESIGN.md` in the same commit (T3); keep `plugins/sp/tests/task-size-precheck.test.ts:76` parity green.
- [ ] R3: add the answer-file-as-source correction note to `plugins/sp/skills/code-verification/SKILL.md` Step 10.
- [ ] R4+R6 in one pass (shared resolver pattern): fix `issue-finding/SKILL.md:142-145`, then triage the remaining executable snippets (`next-feature/references/signal-derivation.md:10,37`, `code-verification/SKILL.md:378`); leave `spur-cli/references/*` untouched.
- [ ] R5: extend `code-implementation/SKILL.md` with the ≤2 full-suite cap + dogfood consolidation (append near the existing targeted-probe note at lines 88-89).
- [ ] Verify: targeted verdict + size-precheck suites green, `bun run lint`, `spur task check 0568`; AC lens — 9-item task warns at authoring (R1), compound evidence parses (R2), Step 10 note present (R3), Phase-1 snippet resolves local CLI (R4), discipline note present (R5), no unresolved executable bare-spur shell-outs (R6).
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session: `/Users/robin/.omp/agent/sessions/-xprojects-spur-new/2026-08-16T06-27-49-101Z_01a00941-4aed-7000-898a-bc5626b893ba.jsonl` (omp, 06:58–07:39 UTC run window)
- Forensics artifact: `.spur/reports/history/2026-08-16/analyze-acaf33b8.json` (session-scoped), `.spur/reports/history/2026-08-16/analyze-5648c805.json` (all-omp)
- Source task: `docs/tasks4/0567_dev-history-load-slash-command-cumulative-import-then-narrow.md` (done, PASS)
- Guard evidence: `.spur/run/0567-precheck-size.status` (FAIL), `.spur/run/0567-verdict.json` (PASS, 10/10 AC after R2-style fix), `spur task check 0567` L4 stale-anchor findings
- Code: `packages/app/src/services/task-size-precheck.ts` (caps), `packages/app/src/services/task-verdict.ts:230-250` (normalizeEvidenceType), `plugins/sp/scripts/task-size-precheck.ts:96-100` (defaultSpurBin), `plugins/sp/skills/spur-dev/references/cross-cutting.md` (inline-default execution-surface)
- Provenance: `/tmp/imp-find-issue.json` (global spur, failed) vs `/tmp/imp-find-issue2.json` (local CLI, ok)
### History
### Notes

**RC1 — Plan-item count overlooked at authoring (S1, ~$0.064 + 5.6-min operator wait).** Task 0567
was authored with 9 `## Plan` checklist items against the documented cap of 8
(`maxImplementPlanItems` default, `LARGE_TASK_PLAN_ITEMS` in task-size-precheck.ts). The Q&A
documented deliberate R-item sizing ("merged to five to stay under maxImplementReqs: 5") but missed
the Plan count. The pipeline precheck failed run 1 at `precheck` (`.spur/run/0567-precheck-size.status`
= FAIL), routed to the `failed` terminal state, and required a manual Plan trim
(`spur task update 0567 --section Plan`) plus an operator `ask` round-trip (335s wait) before run 2
could start. Fix: R1 (authoring-time warning). Evidence: session segment A (4.4 min, $0.064) +
segment B (5.6-min ask).

**RC2 — Compound evidence-type tokens silently dropped (S1, ~$0.05–0.08).** The first verify answer
authored `test + command` evidence types; `normalizeEvidenceType` (task-verdict.ts:230-250) accepts
only exact single tokens, so 8 of 10 AC rows went to `dropped[]` (surfaced only as a count). The
verdict artifact showed `acceptanceCriteria.length = 2`; the mismatch was discovered by inspecting
the artifact, not from any warning. Fix: R2 (union parse or loud warning). Evidence: session
segment G (verify, 4.4 min, $0.272 — includes three answer regenerations).

**RC3 — Stale file:line anchors cited at authoring (S2, ~$0.04–0.06).** Solution/Testing/Review
sections cited `plugins/sp/tests/history-load.test.ts:176-219`, `:205-219`, `:88-225` — the file is
211 lines. The L4 gate caught them at `spur task check` (record time), requiring three fix passes:
the Testing section was corrected, then `spur task record` re-transcribed Testing from the verdict
artifact (which still had stale anchors), forcing a second fix in the answer file + re-derivation.
Fix: R3 (document answer-file-as-source). Evidence: `spur task check` L4 "Stale line anchor"
findings; record guard denied twice.

**RC4 — Record-step re-transcription trap (S2, part of RC3 cost).** `spur task record
--solution-from-diff --transition testing` overwrites `## Testing` from the verdict artifact.
Fixing the task section directly is therefore futile for anchor corrections; the answer file is the
source of truth. This is undocumented — the verify skill's Step 10 implies the section is the
artifact. Fix: R3.

**RC5 — Stale global spur on PATH breaks skill shell-outs (S1, machine-wide).** `spur history
import --source omp --json` via PATH `spur` (`/Users/robin/node_modules/@gobing-ai/spur/spur.js`,
`importer: unknown`) exited 1; the monorepo-local CLI (`bun run apps/cli/src/index.ts`,
`importer: 0.4.32`) succeeded. AGENTS.md R4 documents "never a bare global spur" for history
validation, but the issue-finding skill's Phase-1 snippet uses bare `spur` — it will fail on this
machine every time. Fix: R4 (skill resolver) + R6 (audit). Evidence: provenance headers in
`/tmp/imp-find-issue.json` (global, failed) vs `/tmp/imp-find-issue2.json` (local, ok).

**RC6 — Test/discipline drift (S2, ~1–2 min/task).** 16 `bun test` invocations across the run (4×
full plugin suite, 6× history-load suite) and 29 history-load script executions (10 real-data
dogfood runs incl. 5 dry-run variants) exceed the skill's own "full suite at most twice per task"
(0436 R2) and loop-detector norms. Fix: R5 (discipline doc). Evidence: loop detector reported 2
loops; bash command histogram shows repeated `bun test plugins/sp` and `history-load.ts --dry-run`.

