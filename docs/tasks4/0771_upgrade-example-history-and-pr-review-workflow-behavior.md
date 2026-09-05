---
schema_version: 1
name: "Upgrade example, history and PR-review workflow behavior"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.974Z
updated_at: "2026-09-05T05:42:43.126Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P7"]
dependencies: ["0767", "0768"]
---

## 0771. Upgrade example, history and PR-review workflow behavior

### Background
D61 implementation package P7, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Own basic.yaml, history-anatomy.yaml and pr-review.yaml. Current root package.json DOES define check as lint plus test:coverage, so basic default bun run check is valid; its compound-string shell invocation is the issue. History uses an existing cache helper, report parser/contract and atomic publication. PR review already has request/wait/collect/status and current-HEAD checks, but repeatedly extracts the same request fields.

Dependencies: 0767, 0768. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Example and specialist workflows preserve their useful behavior: fix trusted compound-command execution in basic while keeping bounded fixes; preserve history cache-hit avoidance, evidence validation and atomic publication; reuse head-pinned PR review results without duplicate requests or false CLEAN claims. Apply only behavior-supported simplifications and tag all three definitions version: "1" after verification.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Upgrade example, history and PR-review workflow behavior

  @core
  Scenario: R1 — Example and specialist workflows preserve their useful behavior
    Given the upgraded basic, history-anatomy, and pr-review definitions
    When their successful and relevant failed or pending paths execute
    Then the example executes a valid configurable quality command with bounded fixes
    And history cache hits avoid unnecessary model work while invalid evidence cannot publish
    And PR review remains head-pinned, deduplicated, and honest about pending results

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:42.916Z

Closed: basic default is already valid and stays; fix execution semantics. Keep history comparison baselines and consumed report schema. Preserve PR timeout as pending and distinguish hard failures. No replacement shell framework.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.
### Design
No new public API or generic shell abstraction. Consume 0767 live definition facts and 0768 plan/progress. Keep changes in the three owned YAMLs and existing plugins/sp/scripts/{history-anatomy-cache,pr-reviewing}.ts only where their shared behavior actually needs change. Superskill generates portable script/adapters; do not hand-edit .mjs siblings.

Basic: retain qualityGateCmd: "bun run check" because it exists in this repository; label the definition as an example and keep documented per-project override. Execute trusted configured command with sh -c "$qualityGateCmd" as task-pipeline already does, preserving command exit status before any following write. Treat the string as trusted configuration, not interpolated task/external data. Keep run-scoped PASS/FAIL status and bounded qualityGateMaxFixAttempts/iterationBound; green skips fixes, red fixes at most the cap, missing/corrupt status never reaches done. Test 'false && echo should-not-run' and a valid compound command in a temporary project, not against the whole repo gate.

History: retain current/baseline JSON evidence artifacts, complete digest cache identity, cache-hit route without enrich/validate model work, assert-clean mutation confinement, bounded shared correction count and atomic publish. These history baselines are comparison data, unrelated to deleted waiver snapshots. Keep the twelve-section/field parser contract and required provenance/quantitative-evidence checks because report-contract.md and the helper consume them. Remove only duplicate validation of the same unchanged candidate; the post-correction gate is required because input changed. Tighten any substring verdict acceptance to the existing canonical final verdict reader or an anchored final Verdict: PASS line so 'not Verdict: PASS' or conflicting final FAIL cannot publish. Missing/corrupt/failed validation is failure, old published report remains intact. Do not replace substantive review with a length threshold or remove all structure-gate checks.

PR review: preserve pr-reviewing.ts as request/dedupe/wait/collect/status owner. Read validated request JSON once after request; use existing file.read.into-var actions for run-scoped extracted request head and requestedAt values reused by wait/collect/status. Require non-empty head; requestedAt may be empty for already-reviewed/requested dedupe so existing full current-head collection works. Retain --head checks on every read. Request outcomes are not CLEAN; wait TIMEOUT (exit 3) is pending, collect FINDINGS/CLEAN/PENDING remains distinct and hard error fails. No force request/push, unbounded wait, or nested workflow. Preserve noWait/submit/collect mode behavior and findings severity normalization. Existing request/status files remain run-scoped.

Keep the history model review where it establishes evidence; shell size alone is not a rewrite reason. Set quoted version: "1" once each workflow's positive/negative checks pass and record retained rules with their actual parser consumer. Output: three upgraded definitions and comparable fixture results for 0772. Synchronize example docs, history report contract only if behavior changes, PR skill reference and 04.

Verification targets: Add packages/app/tests/workflow/basic-workflow.test.ts for executed shell/branch behavior. Extend plugins/sp/tests/history-anatomy-cache.test.ts and plugins/sp/tests/pr-reviewing.test.ts; add focused workflow fixtures for publication routing/verdict spoofing, not whole-YAML equality. Run app tests from packages/app; root bun run test includes plugin suites. No real PR push/comment/publication in tests.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1: Save each definition digest and matched fixture counts before editing; confirm retained history parser fields against its canonical report contract.

2. [ ] R1: Correct basic trusted shell invocation and test success, compound failure, fix recovery and exhaustion without running the full real gate in fixtures.

3. [ ] R1: Refine history validation repetition/verdict parsing only at actual duplicate/false-positive seams; test cache hit zero model stages, invalid evidence, correction exhaustion and atomic old-report preservation.

4. [ ] R1: Extract request identity once and reuse it in PR wait/collect/status; test head drift, deduped request, timeout/pending and hard errors with mocked GitHub.

5. [ ] R1: Tag/validate all three final YAMLs; update canonical docs/scripts through their owners and run the relevant behavioral tests.

6. [ ] R1: Run applicable final gate and real verification; preserve measured before/after evidence and retained-rule rationale for 0772.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (corpus fix, 2026-09-05):** task 0771 Solution is **planned**, awaiting implementation run. The 2026-09-05 batch halted at the precheck of 0771 because the Solution section lacked `path:line` citations; the corpus fix below restores precheck-pass before implementation.

Anticipated change anchors (populated during implementation):

- `config/workflows/basic.yaml:1` — `version: "1"` once positive/negative checks pass; retain `qualityGateCmd: "bun run check"`; tested with `false && echo should-not-run` and a valid compound command.
- `config/workflows/history-anatomy.yaml:1` — `version: "1"`; assert-clean mutation confinement; tighten verdict acceptance to canonical reader or anchored `Verdict: PASS` line.
- `config/workflows/pr-review.yaml:1` — `version: "1"`; preserve `pr-reviewing.ts` request/dedupe/wait/collect/status ownership.
- `plugins/sp/scripts/history-anatomy-cache.ts:1` — bounded shared correction count; remove duplicate validation of unchanged candidate.
- `plugins/sp/scripts/pr-reviewing.ts:1` — `requestedAt` empty for already-reviewed/requested dedupe; retain `--head` checks on every read.
- `packages/app/tests/workflow/basic-workflow.test.ts:1` — new test file for executed shell/branch behavior.
- `plugins/sp/tests/history-anatomy-cache.test.ts:1` — extended.
- `plugins/sp/tests/pr-reviewing.test.ts:1` — extended; publication routing/verdict spoofing fixtures.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0767 --json; spur task show 0768 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
