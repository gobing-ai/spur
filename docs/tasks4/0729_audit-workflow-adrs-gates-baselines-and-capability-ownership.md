---
schema_version: 1
name: "Audit workflow ADRs, gates, baselines, and capability ownership"
status: todo
template: meta
created_at: 2026-09-02T03:05:57.970Z
updated_at: "2026-09-02T04:02:45.591Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "adr", "baseline"]
---

## 0729. Audit workflow ADRs, gates, baselines, and capability ownership

### Background
D8 needs one evidence-backed contract inventory before any redesign. Review the accepted workflow decisions against current code, tests, docs, and shipped configuration, including the operator's concern that strict gates and baseline mechanisms may now cost more than they protect. This ticket also owns the related four-surface script-placement audit because the same evidence determines where ADR-069 capabilities belong.
### Requirements
- [ ] R1. Build one binding-claim matrix for ADRs 051, 060, 065, 069-072, 076, 087, 093-100, and 102, plus baseline ADRs 050, 062, 088, 090, and 092 and implementation tasks 0603, 0607, 0614, 0703-0712, and 0723; link every claim to current code, tests, docs, and shipped behavior.
- [ ] R2. Classify each claim as implemented, partial, stale/conflicting, dead, or unimplemented and give it a keep, amend, supersede, retire, or implementation-gap disposition. Sample completed-task code and executable evidence; task status alone is not proof.
- [ ] R3. Trace every workflow/corpus baseline field to its consumer and actual exit-status effect; record owner, callers, staleness, removal criteria, and whether it is a PASS-changing waiver, reference snapshot, performance sensor, generated copy, inert field, or residue. Reproduce the composition-regeneration and pipeline-budget gates; do not baseline their failures.
- [ ] R4. Produce a parity matrix across JSON and Zod schemas, `validate`, `run`, `show`, `list`, `continue`, lifecycle, and projection covering post-schema validation, omitted-`kind` defaulting, extensions/`onError`, source precedence, config threading, run identity/digest, pause/resume, progress status, and claimed versus implemented action/evidence effects.
- [ ] R5. Reproduce and severity-rank the proven runtime and evidence defects: CLI `spurConfig` omission; ineffective `command.gate` timeout; nested `feature-dev` review; continue marker/log/resolution/digest behavior; path and run-id confinement; fail-open proof fingerprints; suppressed task lookup and reviewer independence; stale verifier `expectFile`; incomplete `run.artifact` proof binding; dry-run/surface-inventory validity; and whole-worktree task-solution attribution.
- [ ] R6. Reconcile the four script surfaces—public CLI commands, repository-only `scripts/commands`, root `package.json` composition entrypoints, and portable `plugins/sp/scripts`—with application/built-in capability owners. Include exact workflow callers, portable entrypoint pairs, `pr-reviewing`, task helper scripts, and gaps in `script-contract-check`; propose no public verb without consent.
- [ ] R7. Record the existing workflow-version contract rather than reimplementing it: both dialects accept an optional behavior-neutral string, currently including empty values. Define the minimal target as `unversioned` when absent and `explicit(<literal>)` for a quoted non-empty opaque literal. Trace validation, resolution, list/show/run/continue/progress exposure, persistence and definition-digest interaction, including paused runs; state objective evidence required before a future-major mandate.
- [ ] R8. Write a prioritized defect/decision register in the Solution. Every entry names severity, root cause, current behavior, smallest repair or deletion, owning layer, regression check, downstream strategy slice, and remaining uncertainty; unknown stays unknown.
### Acceptance Criteria
- [ ] Every in-scope ADR and implementation task has an evidence-linked status and disposition, including ADR-102 and derived-doc drift for ADRs 094-100.
- [ ] Every baseline field has a proven consumer/exit effect or is marked inert; current regeneration and budget failures are recorded rather than waived.
- [ ] The surface-parity matrix proves the omitted-`kind`, validation, resolution, resume, configuration, and progress differences with source-local commands or focused tests.
- [ ] The severity register covers every defect named in R5, distinguishes defect/risk/intentional contract/ADR gap, and assigns prerequisite repair ownership before pilot selection.
- [ ] Every script-placement finding names its current YAML/command caller, deployment context, portable entrypoint contract, and recommended existing owner.
- [ ] The version trace confirms existing optional schema acceptance including the empty-string gap, the non-empty opaque target, behavior-neutral explicit/unversioned states, propagation gaps, digest/resume implications, and no current mandatory or registry requirement.
- [ ] The Solution is sufficient for 0731 and 0733 without reopening the full repository audit, and contains no unresolved operator choice disguised as a conclusion.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Read authority first, then trace every binding claim through the current caller and executable behavior. Keep a single matrix plus a prioritized defect register so later tickets consume findings instead of repeating discovery. Prefer one shared root-cause repair seam or deletion over per-surface patches; public-surface changes remain consent-gated.
### Plan
- [ ] Freeze the ADR/task/definition inventory and source-local CLI provenance.
- [ ] Trace baseline fields to consumers, exit behavior, and current failing gates.
- [ ] Build the definition-surface parity and source-resolution matrix.
- [ ] Reproduce runtime, resume, confinement, proof, freshness, and attribution defects with the smallest checks.
- [ ] Reconcile script/capability ownership and exact callers.
- [ ] Trace optional `version` and digest behavior without adding compatibility machinery.
- [ ] Rank root-cause repairs/deletions and record the evidence-backed Solution.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `docs/00_ADR.md` — ADRs 050, 051, 060, 062, 065, 069-072, 076, 087, 088, 090, 092-100, 102.
- `docs/03_ARCHITECTURE.md`; `docs/04_DESIGN.md`; `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`; `docs/design/harness-surface-governance.md`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/lifecycle-adapter.ts`; `packages/app/src/workflow/progress-projection.ts`.
- `packages/app/src/workflow/actions/{agent-run,command-gate,proof-fingerprint,run-artifact}.ts`; `packages/app/src/workflow/proof-input-fingerprint.ts`.
- `apps/cli/src/commands/workflow.ts`; `apps/cli/src/workflow/make-lifecycle-adapter.ts`; `apps/cli/src/commands/shared-options.ts`; `apps/cli/schemas/*workflow.schema.json`.
- `config/workflows/`; `config/workflow-composition-baseline.json`; `config/corpus-baseline.json`; `config/plugin-scripts.json`.
- `scripts/commands/{regen-composition-baseline,pipeline-budgets}.ts`; `plugins/sp/scripts/script-contract-check.ts`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.
### History
