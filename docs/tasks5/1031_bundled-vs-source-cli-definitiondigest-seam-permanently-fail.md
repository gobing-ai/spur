---
schema_version: 1
name: Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard
status: backlog
template: feature-impl
created_at: 2026-09-30T21:56:16.627Z
updated_at: "2026-09-30T21:57:01.376Z"
feature_id: D9

---

## 1031. Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard

### Background

Captured from the creation title: "Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard".

### Requirements

## Background

During feature I33 wrapup (2026-09-30), `spur workflow run feature-verification.yaml` executed via the **bundled** `spur` CLI produced a run row whose `definitionDigest` (`09165acb…`) never matched the receipt digest recorded by the script-side resolver (`e5f5a64b…`). The integrity guard at `packages/app/src/workflow/feature-verification-receipt.ts:411` (`row.definitionDigest !== latest.verifier.definitionDigest`) therefore fails permanently for any run-row recorded by a different CLI vintage than the receipt writer. Recovery required re-running feature-verification through the **source-local** CLI (`bun apps/cli/src/index.ts`) so both sides canonicalized identically. This is the same bundled-vs-source canonicalization seam class as task 0957.

## Requirements

- R1: Feature-verification receipt integrity must not depend on the bundled CLI and the script-side resolver agreeing bit-for-bit on definition canonicalization across CLI vintages.
- R2: Root-cause the canonicalization difference between `resolveWorkflowDefinition` (workflow-resolver.ts) + `computeDefinitionDigest` as exercised by the bundled CLI vs the source-local CLI (candidates: path prefixes embedded in canonical form, import/collection ordering, bundle-inlined config).
- R3: Either normalize the digest comparison (e.g. canonicalize both sides through one resolver at guard time) or make digest computation vintage-stable — pick the smallest change that makes guard `feature-verification-receipt.ts:411` pass for legitimate runs from either vintage while still rejecting genuinely mutated definitions.
- R4: Preserve rejection semantics: a receipt must still fail integrity when the workflow definition actually changed between verify and record.

### Acceptance Criteria

#### AC-1: Reproduce then fix the seam
- G/R: Given a feature-verification run recorded by the bundled CLI, when the receipt guard evaluates the run row, then integrity passes without re-running via the source-local CLI (and still fails when the definition digest legitimately changed).
- Evidence: a repro script/test demonstrating the bundled-vs-source digest mismatch, and the same scenario passing after the fix.

#### AC-2: Guard semantics preserved
- G/R: Given a mutated workflow definition, when the guard runs, then integrity is still rejected.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
