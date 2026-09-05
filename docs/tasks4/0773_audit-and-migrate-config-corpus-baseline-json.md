---
schema_version: 1
name: "Audit and migrate config/corpus-baseline.json"
status: todo
template: feature-impl
created_at: 2026-09-05T15:33:37.889Z
updated_at: "2026-09-05T15:36:26.645Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P2"]
ac_altitude: task-local
dependencies: ["0765"]
---

## 0773. Audit and migrate config/corpus-baseline.json

### Background

D61 implementation sub-task split from 0766 (R2 first phase), approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

The original 0766 R2 attempt that removed `accepted` at the gate broke 11/172 CLI task-check tests, confirming that the migration requires per-fixture remediation that exceeds one-session scope. 0766 is decomposed into 0773/0774/0775; this task owns the classification phase only — no deletions, no caller migration, no regenerator removal. Delete phases belong to 0774 (caller migration) and 0775 (snapshot + script removal).

The corpus baseline snapshot contains 299 unique keys behind 828 observations. These are different counts (the same key can be hit multiple times across the corpus), not 828 independent waived defects. Each key must be classified into one of three destinations: (a) real affected defects to repair via Spur CLI, (b) stylistic warnings the design contract retires (silently dropped), (c) acceptance-debt entries that should never have been baselined (silently dropped with an audit-trail note).

Dependencies: 0765 (frozen `REQUIRED_FINDING_CODES` set + advisory-only `accepted` suppression). Detailed inputs and handoffs are frozen below.

### Requirements

- [ ] **R1.** Audit and classify every key in `config/corpus-baseline.json`. For each of the 299 keys, assign one of three classes: **(a)** real defect — a finding that exposes an affected integrity issue that must be repaired via Spur CLI before this task closes; **(b)** retired warning — a stylistic/document-quality finding the design contract retires (no repair, no migration, no regenerated acceptance); **(c)** acceptance-debt — a baseline entry that should never have been baselined under the 0765 unsuppressible-code policy (no repair, no migration, with an audit-trail note).

- [ ] **R2.** Migrate each classified key to its proper destination. Class (a) defects are fixed via Spur CLI mutations; the resulting corpus must be clean against the affected-input checks after the repair commits. Class (b) warnings are recorded in the classification report and dropped from any future baseline; they never reappear in any post-0775 acceptance ledger. Class (c) entries are recorded in the classification report and dropped, with one-line rationale naming which unsuppressible-code policy they violated.

- [ ] **R3.** Preserve existing scope and JSON shape inherited from 0766 R2. The classification report must include, per key: key string, classification (a/b/c), rationale, and migration action. The classification report is the audit trail for 0775's deletion step. Do NOT delete `config/corpus-baseline.json`, the loader, or the regenerator scripts in this task — those are 0775's scope.

Out of scope: removing `accepted`-map callers from CLI/fallback paths (0774); deleting baseline files, regenerator scripts, or the loader export (0775); new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Audit and migrate config/corpus-baseline.json

  @core
  Scenario: R1 — Every baseline key receives a classification with rationale
    Given config/corpus-baseline.json with 299 unique keys behind 828 observations
    When the classification audit runs
    Then every key has one of {a: real defect, b: retired warning, c: acceptance-debt}
    And every key has a one-line rationale and a migration action
    And the audit report is saved to .spur/run/d61-0773-classification.json

  @core
  Scenario: R2 — Class (a) defects are repaired via Spur CLI before close
    Given one or more baseline keys classified as real defects
    When Spur CLI mutations repair the underlying affected defects
    Then the affected task/feature corpus is clean against the affected-input checks after repair
    And the repair commit precedes the classification report closure

  @core
  Scenario: R3 — Class (b) and (c) entries are dropped with audit trail
    Given baseline keys classified as retired warnings or acceptance-debt
    When the audit report is finalized
    Then those entries are recorded with a one-line rationale naming the unsuppressible-code policy for (c)
    And they never reappear in any post-0775 acceptance ledger
    And no corpus-baseline file suppresses a finding at task close

  @core
  Scenario: R4 — Baseline file and loader remain intact through this task
    Given the classification report and the repaired corpus
    When this task transitions to done
    Then config/corpus-baseline.json, loadAcceptedFindings and regen-corpus-baseline.ts are still present
    And the loader still returns the un-repaired keys for 0774's caller migration and 0775's deletion step
```

### Q&A

Closed: classify all 299 keys into {a, b, c} before any caller migration. Class (a) defects are repaired via Spur CLI; classes (b) and (c) are recorded in the audit report and dropped. No transitional pruning/expiry/waiver metadata; no regeneration step that fabricates a new baseline. The audit report is the single source of truth for 0775's deletion step.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new API, classification daemon, or waiver ledger. Use the existing loader in `packages/app/src/services/corpus-check.ts` (`loadAcceptedFindings`, line ~656) to read all 299 keys; do not duplicate the read path. Reuse `collectObservedFindings` to enumerate the live corpus findings for each key, and apply the existing `REQUIRED_FINDING_CODES` set from `packages/app/src/services/planning-check-base.ts` as the unsuppressible filter when distinguishing class (c) entries from class (b).

Classification rules:

- **Class (a) — real defect.** A key whose code is not in `REQUIRED_FINDING_CODES` AND whose unsuppressed observation exposes an affected identity/reference integrity defect (e.g. duplicate task IDs, broken cross-references, malformed frontmatter that spur-task-check would fail on after baseline retirement). Repair with the matching Spur CLI verb (`spur task update`, `spur feature update`, or the canonical fix). Never erase the finding or fabricate a PASS; the repair must produce a green affected-input check.
- **Class (b) — retired warning.** A key whose code is in `REQUIRED_FINDING_CODES` OR a document-style warning the design contract retires (R2 explicit-corpus-audit scope: warnings alone do not fail the audit). No repair needed; record + drop.
- **Class (c) — acceptance-debt.** A key whose code is in `REQUIRED_FINDING_CODES` AND was previously baselined under a policy that the 0765 frozen contract now overrides. Drop with an explicit rationale naming which 0765 invariant the entry violated.

Audit report schema (saved to `.spur/run/d61-0773-classification.json`):

```jsonc
{
  "generatedAt": "<ISO-8601>",
  "totalKeys": 299,
  "totalObservations": 828,
  "byClass": { "a": <int>, "b": <int>, "c": <int> },
  "keys": [
    {
      "key": "<exact-baseline-key>",
      "observations": <int>,
      "code": "<L*-finding-code>",
      "classification": "a" | "b" | "c",
      "rationale": "<one-line>",
      "migrationAction": "spur task update <wbs> --section ..." | "drop" | "drop-with-policy-violation",
      "repairedVia": "spur task update <wbs>" | null
    }
  ]
}
```

Preserve existing scope and JSON shape inherited from 0766 R2 — do not invent new fields the live DTO does not already carry. Repair commits precede the audit report commit so the report's `repairedVia` field points to commits that are reachable from the branch HEAD at task close.

Verification targets: read the audit report shape from `.spur/run/d61-0773-classification.json`; assert `totalKeys === 299` and `byClass.a + byClass.b + byClass.c === 299`; assert every class (a) entry has a non-null `repairedVia`; assert `spur feature check D61 --strict --json` L4.scenario-unverified count for R3 is unchanged from the pre-0773 baseline (this task only adds task IDs to the D61 scenario coverers, not new acceptance evidence).

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under `.spur/run/d61-0773-before.json`; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

### Plan

1. [ ] Capture pre-state: save the live `loadAcceptedFindings()` output and a `spur task check --corpus --json` snapshot to `.spur/run/d61-0773-before.json` so 0775 and 0772 can diff the after-state.

2. [ ] Read every key from `config/corpus-baseline.json` via the existing loader (do not duplicate the read path). Emit one row per key into the audit report, then classify each row by applying the three rules from Design: code-in-`REQUIRED_FINDING_CODES` distinguishes (c) from (b); live `collectObservedFindings` distinguishes (a) from the rest.

3. [ ] Repair class (a) entries via the matching Spur CLI verb. Each repair is its own commit; the audit report's `repairedVia` field points to the committing CLI invocation. Do not erase findings or fabricate PASSes; the affected-input check after each repair must be green before moving on.

4. [ ] Finalize the audit report at `.spur/run/d61-0773-classification.json`. Validate `totalKeys === 299` and `byClass.a + byClass.b + byClass.c === 299`. Cross-check the report against the post-repair corpus to confirm no class (a) entry remains unrepaired.

5. [ ] Run `spur task check 0773 --as testing`, `spur task check 0774` (sanity — not yet implemented), and `spur feature check D61 --strict --json`; capture results. Do NOT delete `config/corpus-baseline.json` or the loader in this task; those are 0775's scope.

6. [ ] Hand off the audit report and the repaired corpus to 0774 (caller migration) and 0775 (snapshot + script removal).

### Solution

**Status (decomposition, 2026-09-05):** task 0773 is the first sub-task of decomposed 0766 R2 (classification phase). Awaiting implementation run.

Anticipated change anchors (populated during implementation):

- `packages/app/src/services/corpus-check.ts:656` — `loadAcceptedFindings` (read-only consumer in this task; deleted by 0775).
- `config/corpus-baseline.json:1` — 299 unique keys (preserved through this task; deleted by 0775).
- Classification audit report — new file at `.spur/run/d61-0773-classification.json` (created in this task; cite after creation).

### Testing
<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->
### Review
<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->
### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Parent task 0766 (superseded by this task, 0774, 0775)](./0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json; spur task show 0766 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
