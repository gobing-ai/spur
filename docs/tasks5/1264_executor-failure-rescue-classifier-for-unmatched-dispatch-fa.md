---
schema_version: 1
name: Executor-failure rescue classifier for unmatched dispatch failures
status: todo
template: issue
created_at: 2026-10-19T18:27:34.608Z
updated_at: "2026-10-19T18:27:42.895Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["1260"]
---

## 1264. Executor-failure rescue classifier for unmatched dispatch failures

### Background

Follow-on to task 1260 (executor failover on quota/auth). Not part of it: 1260 deliberately keeps
recognition rule-based and narrow (0407 precision bias; "new provider adapters/catalogs" out of
scope).

`packages/app/src/services/failure-classification.ts` maps a failed dispatch to an
`ObjectiveEscalationSignal` through `FAILURE_RULES` (`:25`, provider vocabularies + status codes)
in `classifyDispatch` (`:142`). Anything unmatched is treated as an ordinary task failure. This is
correct for precision but has a recall gap: a new vendor message ("credits depleted", a reworded
rate-limit, a proxy 5xx body) fails the task instead of failing over, until someone adds a regex.

A catalog decision is the right tool for this residue. It has a fixed answer vocabulary, a
declared fail-safe fallback, ledger visibility, and it is consulted only after the rules have
spoken.

### Requirements

- [ ] R1. Add a shipped catalog decision `executor-failure-class` (choice: `resource-exhaustion`, `auth`, `transient`, `task-defect`; fallback `task-defect`; `minConfidence` ≥ 0.85; explicit `instructions` with `${params.instructions}` and observable criteria per label).
- [ ] R2. Consult it only when `classifyDispatch` returns no signal and the dispatch failed with non-empty stderr/stdout tail. Evidence is the last ≤ 4 KB of output, redacted of tokens/keys by the existing redaction helper. Rule matches never reach the model.
- [ ] R3. Map an accepted `resource-exhaustion`/`auth` answer into the same `ObjectiveEscalationSignal` path 1260 uses (same exclusion, independence and no-fallback rules). `transient` maps to the existing retry semantics only if such a policy exists; otherwise treat it as `task-defect`. Any fallback or low confidence → `task-defect` (today's behaviour).
- [ ] R4. Opt in behind config (`workflows.executorFailureDecision: false` by default), and pin the maker per decision via `decisions.makers` (recommended: a probability-native maker such as `typesafe`/`clef`; sampled makers only accept on unanimity).
- [ ] R5. Record every rescue decision as a ledger decision row with `caller: executor-failover`, and emit a hint suggesting a new `FAILURE_RULES` entry when the same accepted class recurs, so the regex table keeps growing and model calls shrink.

### Acceptance Criteria

```gherkin
Scenario: AC1 — rule matches never consult the model (req: R2)
  Given a dispatch failing with "AccountQuotaExceeded"
  When it is classified with the rescue decision enabled
  Then the signal is `resource-exhaustion` and no `executor-failure-class` decision is recorded

Scenario: AC2 — an unmatched exhaustion message fails over when accepted (req: R1, R3)
  Given a dispatch failing with an unmatched "credits depleted for this billing period" message and a fake maker answering `resource-exhaustion` at 0.95
  When the executor loop handles the failure
  Then the next eligible executor is tried under the 1260 rules

Scenario: AC3 — uncertainty keeps today's behaviour (req: R3)
  Given the same message and a maker answering at 0.6
  When the executor loop handles the failure
  Then the task fails as a task defect with no failover

Scenario: AC4 — disabled by default (req: R4)
  Given default config
  When an unmatched failure occurs
  Then no decision is made and behaviour is unchanged

Scenario: AC5 — recurring rescues suggest a rule (req: R5)
  Given three accepted rescues of the same class with similar text
  When the third is recorded
  Then a hint names the class and a sample line for a new `FAILURE_RULES` entry
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- **Rules first, model for the residue.** This keeps 0407's precision on everything the rules know.
- **Fail-safe direction.** A false `task-defect` equals today's behaviour. A false `resource-exhaustion` wastes one failover attempt but is bounded by the 1260 ladder and exclusion. Hence the high floor and the `task-defect` fallback.
- **Secrets.** stderr can contain tokens, so redact before the evidence leaves the process. Hosted makers send evidence off-box; the doc must say so and the recommended maker choice should weigh it (local `laya-local` once 1262 R1 lands).
- **Not in scope:** model-driven retries of verification failures, and any change to tier/binary policy (same exclusions as 1260).

### Plan

1. Collect real unmatched failure tails from `.spur/run` logs to write the criteria and the fixtures.
2. Write failing tests for AC1–AC4 with a fake maker (hermetic, no external calls).
3. Add the catalog entry, the gated call in the failure path, and the mapping.
4. R5: implement the hint; AC5.
5. Docs plus the project gates.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 1260 (failover ladder this feeds), task 1262 (laya local maker, ledger), the decision-outcome task created alongside this one (measure rescue accuracy with it).
- `packages/app/src/services/failure-classification.ts:25,132,142`.

### History
