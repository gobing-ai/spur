---
schema_version: 1
name: "Upgrade the history-anatomy report contract with severity, repro, owner surface, and a task handoff"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:45.026Z
updated_at: "2026-08-26T05:39:56.082Z"
feature_id: I81
priority: P2
tags: ["history-anatomy", "report-contract", "sp-plugin", "dogfood"]
dependencies: ["0674"]
---

## 0680. Upgrade the history-anatomy report contract with severity, repro, owner surface, and a task handoff

### Background

The operator's issue 2.2: the two report kinds produced this week have complementary strengths, and the history-anatomy report should learn from the dogfood one.

The dogfood report (`docs/dogfood/2026-08-25-sp-dev-find-issue-*.md`) carries four things the history-anatomy report does not: an explicit **severity** on every finding (P1/P2/P3), a **repro command** that reproduces the observation, an **owner surface** naming who fixes it, and a **fixed-vs-unresolved split** that says what actually changed. The history-anatomy report is rigorous about evidence — stable keys, confidence, contradictions, evidence anchors — but a reader finishes it unable to tell which of seven findings to act on first, or how to reproduce any of them.

It also has no route into the task corpus. Its "Remediation options" table is explicitly proposals-only, so every accepted proposal has to be re-derived by hand — which is exactly the work this session just did over four reports.

A third gap: repeated tool-call signatures (8,079 groups across 2,051 sessions, 213,271 repetitions) were surfaced identically in both reports as a workflow proposal, but the report has no standing place to put a report-only advisory, so it lands as prose each time.

The chained `agent.run` step cost is also unobservable from the driver session — both dogfood runs recorded chained cost as "~unknown" — which means neither report kind can state what a run actually cost.

### Requirements
- [ ] R1. Add a severity to every finding in the report contract, and make the deterministic structure gate fail a candidate whose finding lacks one.
- [ ] R2. Add a repro command to every finding — the invocation that reproduces the observation — gated the same way.
- [ ] R3. Add an owner surface to every finding, naming the surface that owns the fix, gated the same way.
- [ ] R4. Give the report a handoff route: for an accepted remediation proposal, supply the `spur task` invocation that lands it, and have the created task reference the finding's stable key.
- [ ] R5. Give the report a standing report-only advisory section for repeated tool-and-argument signatures, proposing no automatic interruption.
- [ ] R6. Surface chained `agent.run` step cost back to the invoking session so a run's real cost is reportable rather than "~unknown".
- [ ] R7. Land the report contract, the skill references, and the deterministic structure-gate implementation in a single commit, so the published-report shape and its two-sided check never diverge.
### Acceptance Criteria

```gherkin
@core
Scenario: R13 — Each published finding names its severity, repro command, and owner surface
  Given an enriched report candidate containing at least one finding
  When the deterministic structure gate checks the candidate
  Then the gate fails any finding missing a severity, a repro command, or an owner surface
  And a candidate whose findings carry all three passes

@core
Scenario: R14 — An accepted remediation proposal can be handed to the task corpus
  Given a published report with a remediation proposal the operator accepts
  When the operator takes the report's handoff route
  Then the report supplies the "spur task" invocation that lands that proposal as a task
  And the created task references the finding's stable key

@edge
Scenario: R18 — The report carries a report-only repeated-call advisory
  Given the analyze artifact reports repeated identical tool-and-argument signatures
  When the report is enriched
  Then it surfaces the repeated signatures as an advisory
  And it proposes no automatic interruption of the repeated call
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Borrow the shape, not the protocol.** The dogfood report's value is that a reader can triage it: severity orders the work, repro makes a claim checkable in one command, owner surface routes it. Those three are additive fields on the existing per-finding block, which already has `key`, `category`, `impact`, `trend`, `observation`, `inference`, `confidence`, `contradictions`, `evidenceAnchor`. This is an extension of a working contract, not a redesign — the evidence discipline that made both reports honest stays exactly as it is.

**Severity is not confidence.** The existing `confidence` field says how sure the finding is; severity says how much it matters. Both are needed and they are orthogonal — the phase-reversal finding is high confidence and P2, while a low-confidence P1 would be the most urgent thing to investigate.

**The handoff is a printed invocation, not an automatic write.** Auto-creating tasks from a diagnostic report would put an unreviewed model judgment straight into the corpus, and the corpus is CLI-gated for exactly that reason. Printing the `spur task` invocation keeps the operator as the gate while removing the re-derivation work. The stable key in the created task is what makes the next report able to classify the finding as `resolved`.

**Why R6 belongs here.** Both report kinds are blind to what a run cost, and both dogfood ledgers had to write "~unknown" with LOW confidence. Cost is a first-class column in a diagnostic report; surfacing it is what makes the performance section able to state a run's own cost rather than only the corpus's.

**Ordering.** This task should land after the bounds-threading task, because a report contract that mandates severity is only useful once recurrence classification actually works — otherwise every finding is `not-comparable` and severity has nothing to rank against.

**Reversibility.** The gate additions are refusals only; reverting the contract restores the current nine-field finding block.

### Plan

1. Extend `plugins/sp/skills/history-anatomy/references/report-contract.md` with the severity, repro-command, and owner-surface fields, and define the closed severity vocabulary.
2. Extend the deterministic structure gate in the `history-anatomy-cache` helper (and its `.mjs` twin) to require all three per finding; keep it two-sided so the gate and the contract cannot drift.
3. Add the remediation handoff: emit the `spur task` invocation per accepted proposal, carrying the finding's stable key.
4. Add the standing repeated-call advisory section to the contract and the enrich rubric, report-only.
5. Surface chained `agent.run` cost back to the invoking session and add it to the report's cost reporting.
6. Update the enrich and validate rubrics so the model half authors the new fields and the validate leg checks them.
7. Tests: a candidate missing a severity, a repro, or an owner surface fails the gate; a complete one passes; the handoff invocation names the stable key.
8. Run one full daily report end to end and confirm the published output carries all three fields per finding; run `bun run lint`, `bun run test`, `bun run script-contract-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
