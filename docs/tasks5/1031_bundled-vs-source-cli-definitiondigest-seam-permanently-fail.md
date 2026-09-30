---
schema_version: 1
name: Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard
status: backlog
template: feature-impl
created_at: 2026-09-30T21:56:16.627Z
updated_at: "2026-09-30T22:13:37.343Z"
feature_id: D9

---

## 1031. Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard

### Background

Captured from the creation title: "Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard".

### Requirements

## Background

During feature I33 wrapup (2026-09-30), `spur workflow run feature-verification.yaml` via the **bundled** `spur` CLI produced a run row whose `definitionDigest` (`09165acb…`) never matched the receipt digest recorded by the script-side resolver (`e5f5a64b…`). The integrity guard at `packages/app/src/workflow/feature-verification-receipt.ts:411` (`row.definitionDigest !== latest.verifier.definitionDigest`) fails permanently whenever the run row and the receipt come from different CLI vintages. Recovery required re-running feature-verification through the **source-local** CLI (`bun apps/cli/src/index.ts`). Same seam class as task 0957.

## Requirements

- R1: Receipt integrity must not depend on the bundled CLI and the script-side resolver canonicalizing the workflow definition identically across CLI vintages.
- R2: Root-cause the canonicalization difference between `resolveWorkflowDefinition` (workflow-resolver.ts:276) + `computeDefinitionDigest` as exercised by (a) bundled CLI loading `apps/cli/config/workflows/` (generated copy) vs (b) source-local CLI loading `config/workflows/` (SSOT). Test candidates in order: stale/divergent generated bundle copy; path strings embedded in canonical form; import/collection-order differences. Record the confirmed cause as fix justification.
- R3: Smallest change making the guard pass for legitimate runs from either vintage while still rejecting genuinely mutated definitions. Preferred shape: vintage-stable digest — canonicalize over the `config/workflows/` SSOT semantics (normalized definition tree, no path/vintage metadata). Do NOT weaken the guard to accept any digest.
- R4: Preserve rejection semantics: receipt still fails integrity when the definition genuinely changed between verify and record (mutation test keeps passing).
- R5: Pin the seam with a parity test: same workflow file, digest via bundled path == digest via source-local path; fails if the seam regresses.

#### AC-1: Seam reproduced and fixed
- G/R: Given a run row recorded by the bundled CLI and a receipt written by the source-local path, the guard passes; with a genuinely mutated definition it still rejects.
- Evidence: parity test red before fix, green after; mutation test still red-on-mutation; record both observed digests (bundled `09165acb…`, source `e5f5a64b…`).

#### AC-2: Regression pinned
- G/R: The parity test lives in the repo suite (workspace with resolver access) and breaks loudly on future canonicalization drift.

#### Repro procedure

1. `bun apps/cli/src/index.ts workflow run config/workflows/feature-verification.yaml --vars '{"featureId":"I33"}'` → run-row digest (source path).
2. `spur workflow run feature-verification.yaml --vars '{"featureId":"I33"}'` (bundled) → run-row digest.
3. Compare with `computeDefinitionDigest(await resolveWorkflowDefinition(...))` in-process (workflow-resolver.ts:276 vicinity).
4. Diff `apps/cli/config/workflows/feature-verification.yaml` (generated) vs `config/workflows/feature-verification.yaml` (SSOT); if `bun run --filter @gobing-ai/spur build:bundle` regeneration alone changes the bundled digest, the stale generated copy is the root cause.

#### Fix directions (prefer A)

- A: vintage-stable digest (canonicalize on SSOT definition tree or normalize leaked vintage-local fields).
- B: guard-time normalization (guard re-resolves and compares semantics; touches guard + receipt schema).
- C (reject unless A/B disproportionate): accept-either-digest guard — weakens mutation detection.

#### Reference

- Guard `packages/app/src/workflow/feature-verification-receipt.ts:411`; resolver `packages/app/src/workflow/workflow-resolver.ts:276`
- Wrapup run `215c6eab-95a9-463c-a676-cbda0bdf63d2`; bundled verification run `7ec2345a` (invalid row); earlier failed wrapups `47415d75`/`f5877e99`/`9010733b` (gate-ordering history, out of scope)
- Origin: I33 session review 2026-09-30; precedent 0957

### Acceptance Criteria

placeholder

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
