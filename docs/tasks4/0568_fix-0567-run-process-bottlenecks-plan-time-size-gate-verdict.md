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
updated_at: "2026-08-16T16:38:42.686Z"
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
- [ ] R1. Add a plan-time size precheck that runs at task creation/refinement (not first at pipeline precheck): evaluate R-item and Plan-item counts against `maxImplementReqs` / `maxImplementPlanItems` caps and surface a warning at authoring time. Trigger: `spur task create` / `spur task update --section` emits a visible warning when `## Plan` checklist items > 8 or R-items > 5. Target: `packages/app/src/services/task-size-precheck.ts` shared caps + a CLI surface (e.g. `spur task check --size` or an authoring-time hook). Acceptance: a task authored with 9 Plan items produces the warning before any pipeline run; zero false positives on a conforming 8-item task.
- [ ] R2. Extend `normalizeEvidenceType` in `packages/app/src/services/task-verdict.ts` to accept compound evidence types (`test + command`, `command + dogfood`, `test + static-ref`, …) as the union of their parts, OR emit a loud dropped-rows warning at derivation time instead of a silent count. Acceptance: a verdict answer with `test + command` evidence types yields 10/10 parsed AC rows (or an explicit warning naming the dropped rows); existing single-token behavior unchanged.
- [ ] R3. Document the record-step source-of-truth in `sp-code-verification` SKILL.md: `## Testing` is transcribed from the verdict artifact at `spur task record`, so verify-time anchor fixes must be applied to the answer file followed by `spur task verdict --from-answer` + re-record — never to the task section directly. Acceptance: the skill's Step 10 contains the note; a reviewer following the skill fixes stale anchors in one pass (answer file → re-derive → re-record) with no second guard denial.
- [ ] R4. Make the issue-finding skill's Phase-1 snippet resolve `spur` monorepo-safely (SPUR_BIN env > monorepo-local CLI > PATH) instead of bare `spur`, mirroring `defaultSpurBin()` in `plugins/sp/scripts/task-size-precheck.ts`. Acceptance: running the Phase-1 commands from the skill in a monorepo checkout uses the local CLI (provenance `binary: …/apps/cli/src/index.ts`, `importer: 0.4.x`), not a stale PATH install.
- [ ] R5. Add a targeted-test-first / dogfood-discipline note to `sp-code-implementation` SKILL.md: run the narrow test before any full suite (`bun test <file> --test-name-pattern`), run the full plugin suite at most twice per task (task 0436 R2), and consolidate repeated real-data dogfood invocations (single combined run instead of N near-identical `--dry-run`/real runs). Acceptance: a follow-on task run shows ≤2 full-suite invocations and no repeated identical dogfood commands (loop detector reports zero 3× repeats).
- [ ] R6. Audit pipeline/skill shell-outs for bare `spur` usage and route them through the monorepo-safe resolver (same as R4) so no skill command depends on PATH freshness. Acceptance: `grep -rn "spur history\|spur task" plugins/sp/skills apps/cli/src --include="*.md" --include="*.ts"` shows no bare `spur` first-command that can hit a stale install; each shell-out either uses `$spurBin`/`SPUR_BIN` or is documented as PATH-dependent.
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
  Scenario: R2 — Compound evidence types parse or fail loudly
    Given a verify answer with AC evidence type "test + command"
    When spur task verdict derives the verdict
    Then all 10 AC rows are parsed (or a warning names every dropped row)
    And no row is silently discarded

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
  Scenario: R6 — No bare spur shell-outs in skills/CLI docs
    Given the grep across plugins/sp/skills and apps/cli/src
    When scanning for first-command spur invocations
    Then every shell-out resolves via SPUR_BIN or the monorepo-local CLI
    And none depend on PATH freshness
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
### Design
**R1 — Plan-time size precheck.** Add `--size` mode (or authoring warning) to `spur task check`
reusing `packages/app/src/services/task-size-precheck.ts` caps (R-items > 5, Plan items > 8). The
check runs against the task body's `## Requirements` / `## Plan` sections exactly as the pipeline
precheck does (`R_ITEM_RE`, `CHECKLIST_ITEM_RE`), but surfaces as a warning at `task create` /
`task update --section Plan` time. Parity test already pins plugin vs app caps
(`plugins/sp/tests/task-size-precheck.test.ts:173-179`). Evidence: 0567 run 1 FAIL
(`.spur/run/0567-precheck-size.status`), 9 Plan items vs cap 8.

**R2 — Compound evidence types.** `packages/app/src/services/task-verdict.ts:230-250` —
`normalizeEvidenceType` currently returns null for any value outside the single-token whitelist.
Change to split on `+`/`,`/`/` and accept if any component is a known type (union semantics), or
emit `L4` warning naming dropped rows at derivation. Evidence: first 0567 verdict artifact had
`acceptanceCriteria.length = 2` with 10 rows authored (`test + command` values); `dropped[]`
carried the rest invisibly.

**R3 — Record-step source-of-truth doc.** `sp-code-verification` SKILL.md Step 10 — add explicit
note: "`## Testing` is transcribed from the verdict artifact at `spur task record`; fix anchors in
the answer file, re-run `spur task verdict --from-answer`, then re-record. Direct section edits are
overwritten." Evidence: 0567 record denied twice; Testing anchors fixed in the section reappeared
via transcription.

**R4 — Issue-finding skill spur resolution.** `sp-issue-finding` SKILL.md Phase 1 — replace bare
`spur history import/analyze/report` with the resolver pattern from
`plugins/sp/scripts/task-size-precheck.ts:96-100` (SPUR_BIN > monorepo-local CLI > PATH). Evidence:
bare `spur history import --source omp --json` exited 1 with `provenance.binary =
/Users/robin/node_modules/@gobing-ai/spur/spur.js`, `importer: unknown`; local CLI succeeded with
`importer: 0.4.32`.

**R5 — Test discipline doc.** `sp-code-implementation` SKILL.md — add targeted-test-first + "full
suite ≤2× per task" (task 0436 R2) + dogfood consolidation note. Evidence: 0567 ran 16 `bun test`
invocations (4× full plugin suite, 6× history-load suite) and 29 history-load script executions
(10 real-data dogfood runs incl. 5 dry-run variants).

**R6 — Bare-spur audit.** Sweep `plugins/sp/skills` + `apps/cli/src` for first-command `spur`
shell-outs; route through `$spurBin`/SPUR_BIN resolver. Evidence: the 0567 run's own find-issue
snippet (`spur history import --source omp`) hit the stale PATH binary and failed.
### Plan
- [ ] R1: add `spur task check --size` (or authoring-time warning) reusing shared caps; verify parity test still passes (R1)
- [ ] R2: extend `normalizeEvidenceType` to compound tokens or loud dropped-rows warning; add unit tests for `test + command` (R2)
- [ ] R3: add record-step source-of-truth note to sp-code-verification SKILL.md Step 10 (R3)
- [ ] R4: switch sp-issue-finding Phase-1 snippets to the monorepo-safe spur resolver (R4)
- [ ] R5: add targeted-test-first + ≤2 full-suite + dogfood-consolidation guidance to sp-code-implementation SKILL.md (R5)
- [ ] R6: grep-and-fix bare `spur` shell-outs across plugins/sp/skills and apps/cli/src; route through SPUR_BIN resolver (R6)
- [ ] Verify: `bun test` targeted suites (task-verdict, task-size-precheck, plugin suites), `bun run lint`, `spur task check 0568` (all)
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

