---
schema_version: 1
name: Gate a candidate workflow graph change on measured real-run data with a promotion deadline
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.227Z
updated_at: "2026-09-17T18:38:42.614Z"
feature_id: D62
priority: P2
tags:
  - workflow
  - adr-076
  - promotion

dependencies: ["0868", "0869"]
---

## 0873. Gate a candidate workflow graph change on measured real-run data with a promotion deadline

### Background

The user-proposed strategy of adding config/workflows/<name>2.yaml beside the canonical file was already built (tasks 0596, i6), run 9 times, and deleted by ADR-076 — four attempts over two days of live model quota, never reaching a verdict, blocking a feature chain. ADR-076's own reopening condition (measured real-run data, not a fixture bar) is met by this feature's evidence, and its 2026-09-16 amendment makes the gate operable.

### Requirements

- [x] R1. A candidate graph change is shadow-run against recorded real-run inputs rather than kept as a standing parallel definition.
- [x] R2. The promotion verdict cites agent.run count and duration measured from real run history.
- [x] R3. The candidate is promoted into the canonical definition or deleted by a date named when it is created.
- [x] R4. No unreferenced parallel definition remains in config/workflows/ past its named date.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R9 — A candidate graph change is promoted or deleted on measured real-run data
    Given a candidate workflow graph change proposed against a retained definition
    When the promotion gate is evaluated
    Then the verdict cites agent.run count and duration measured from real run history
    And the candidate is either promoted into the canonical definition or deleted
    And no unreferenced parallel definition remains in config/workflows/
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The failure mode ADR-076 recorded was an open-ended comparison with no deadline and no verdict, so the deadline is the load-bearing part, not the measurement harness. Shadow-running against recorded inputs — rather than paying live model quota twice per comparison — is what makes the verdict reachable within a deadline at all. Depends on the trace emission task: there is no real-run history to measure against until the default surface emits rows.

### Plan

1. Define the candidate record: canonical target, named deadline, measurement inputs.
2. Build the shadow-run comparison over recorded run history.
3. Emit a verdict citing agent.run count and duration.
4. Enforce the deadline: promote or delete, and fail the catalogue check on an expired candidate.
5. Document the gate in docs/design/workflow-execution-economy.md §5.

### Solution

Make the ADR-076 amendment promotion gate operable (feature D62): a candidate workflow graph change is shadow-run against recorded real-run inputs and promoted-or-deleted by a date named at creation, never kept as a standing parallel `<name>2.yaml`. The gate is a repo-internal `bun scripts/spur-dev.ts promotion` command plus a candidate record at `config/workflow-candidates.json`; its `check` subcommand is the repo-wide catalogue check wired into `spur-check-feature`.

| Change | Anchor |
| --- | --- |
| Candidate record types (`WorkflowCandidate` with canonical target, named `deadline`, recorded real-run `measurement` inputs, and projected `delta.agentRunCount`) + `WorkflowCandidateVerdict` citing measured `agent.run` count and duration; load/validate/save | `scripts/commands/workflow-promotion.ts:91` |
| `isPastDeadline` — the load-bearing named-date comparison (strictly after the deadline date is expired) | `scripts/commands/workflow-promotion.ts:178` |
| `measureAgentRunHistory` — shadow-run inputs: per terminal non-dry run, `agent.run` action count and summed `duration_ms` read from `action_runs`/`runs`; zero-`agent.run` runs count 0 with an unmeasured (null) duration | `scripts/commands/workflow-promotion.ts:254` |
| `evaluateCandidate` — shadow-run verdict: promote only when the candidate projects strictly fewer `agent.run` actions than the canonical declares (the ADR-076 bar), citing the measured real-run count and duration | `scripts/commands/workflow-promotion.ts:277` |
| `countAgentRunActions` / `loadCanonicalAgentRunCounts` — the canonical definition's declared `agent.run` action count (promotion-landed verification) | `scripts/commands/workflow-promotion.ts:308` |
| `findParallelDefinitions` — flags `<name>2.yaml` / `<name>-2.yaml` beside their canonical (R4: no unreferenced parallel definition) | `scripts/commands/workflow-promotion.ts:341` |
| `checkWorkflowPromotion` — the catalogue check: fails any candidate still present past its deadline and any parallel definition | `scripts/commands/workflow-promotion.ts:366` |
| `runWorkflowPromotion` CLI (`check`/`evaluate`/`resolve`): `resolve --decision promote` refuses until the canonical actually carries the candidate's `agent.run` count | `scripts/commands/workflow-promotion.ts:461` |
| `promotion` subcommand registered in the dev entry point | `scripts/spur-dev.ts:110` |
| Candidate record committed (empty; `schemaVersion: 1`) | `config/workflow-candidates.json:2` |
| `workflow-promotion-check` wired into `spur-check-feature` (repo-wide gate) | `package.json:83` |
| Gate documented — candidate record, shadow-run comparison, and deadline enforcement | `docs/design/workflow-execution-economy.md:147` |
| Unit tests: deadline, candidate validation, measured history (dry-run and non-terminal exclusion, recorded-run replay), verdict promote/delete, parallel-definition detection, and the catalogue check | `scripts/commands/workflow-promotion.test.ts:94` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Candidate is a record in config/workflow-candidates.json (candidates[] re-read empty — no standing parallel definition); shadow-run replays recorded action_runs/runs via measureAgentRunHistory (`scripts/commands/workflow-promotion.ts:254`); replay excludes dry/non-terminal rows (workflow-promotion.test.ts:126). Re-run: `bun test scripts/commands/workflow-promotion.test.ts` -> 25 pass / 0 fail (2026-09-17). |
| R2 | MET | WorkflowCandidateVerdict carries agentRunCount + agentRunDurationMs (workflow-promotion.ts:77) and evaluateCandidate (:277) cites them in reason; verdict-citation tests :188 in passing set. |
| R3 | MET | deadline required at creation by validateCandidate (workflow-promotion.ts:91); isPastDeadline :178; resolve promote/delete :461; expiry/parallel failure tests :98,:188,:285 pass. The 0876 pilot candidate followed this lifecycle to decision=delete and was removed. |
| R4 | MET | findParallelDefinitions (:341) + checkWorkflowPromotion (:366); re-run this run: `bun scripts/spur-dev.ts promotion check` -> 'workflow-promotion: PASS (0 candidate(s), no parallel definitions)'. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R9 — A candidate graph change is promoted or deleted on measured real-run data | MET | test | workflow-promotion.test.ts:188 (verdict cites measured count+duration; promotes fewer / deletes equal-or-more), :126 (measured real-run history), :221 (parallel detection), :285 (catalogue gate fails expired/parallel) — 25 pass / 0 fail re-run; live gate `promotion check` PASS with no parallel definitions. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Record-based candidates + measured verdict + deadline lifecycle match ADR-076 amendment design; no deviation. |
| P4 | secua | — | No parallel definitions remain; gate fails closed on expiry; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T23:48:39.532Z todo → wip (system)
- 2026-09-16T23:57:42.556Z wip → testing (system)
- 2026-09-16T23:57:43.953Z testing → done (system)

