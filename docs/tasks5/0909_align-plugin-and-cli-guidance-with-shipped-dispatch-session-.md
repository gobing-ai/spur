---
schema_version: 1
name: Align plugin and CLI guidance with shipped dispatch session policy
status: todo
template: feature-impl
created_at: 2026-09-20T15:48:46.081Z
updated_at: "2026-09-20T15:49:23.010Z"
feature_id: I32
priority: P2
tags:
  - i31-next-batch
estimate_hours: 3

ac_numbering: task-local
ac_altitude: task-local
---

## 0909. Align plugin and CLI guidance with shipped dispatch session policy

### Background

I31/0903 found headless-inline help contradicting shipped fallback, missing centralized session-policy guidance and stale doctor-auth prose. Existing runtime and task-pipeline YAML already carry the intended contracts; source guidance is the corrective scope.

### Requirements

- [ ] R1. Correct agent run --agent help so inline describes host-session execution and existing headless role/tier fallback with warning; do not change dispatch behavior.
- [ ] R2. Add concise source guidance for coder reuse versus reviewer/planner/scribe fresh defaults, explicit session override, resume capability fallback and existing role/executor/session pins. Replace stale doctor authentication claims with the shipped usability and availability contract.
- [ ] R3. Keep platform fallback usable without slash commands, link owning session-pinned-dispatch and roles references, and extend existing inline/parity checks to catch these concrete contradictions without snapshotting entire prose.

### Acceptance Criteria

- [ ] AC1 — inline help matches the shipped headless fallback (req: R1)
- [ ] AC2 — plugin guidance explains shipped session and availability policy (req: R2)
- [ ] AC3 — CLI-only readers receive the same contract (req: R3)

### Q&A

Ready freeze — 2026-09-20, inline planning owner.

- Q: Implement now or prepare delegation? A: Prepare a reviewable implementation-ready task; production implementation belongs to the delegated coding agent.
- Q: Is I31 evidence sufficient? A: The reports identify candidate defects; current source anchors substantiate the bounded fixes. The implementation starts with executable regression evidence. Sparse 0905 runs do not authorize trace/cost redesign.
- Q: Dependencies and execution order? A: No unfinished semantic upstream dependency. I31 tasks 0903/0904/0905 are done. Recommended serial order: 0906 → 0907 → 0908 → 0909. Parallel work requires isolated worktrees and serial integration; 0907/0908 share a design satellite.
- Q: Which scope choices remain open? A: None required for this task. Requirements and Design freeze the implementation behavior; freshness policy, installed role propagation, fleet receipts and cost attribution are separate follow-ups.
- Q: Feature traceability? A: I32 R1-R3 ↔ AC1-AC3 respectively. Task-local AC describe the implementation checks without redefining feature shipment criteria.
- Q: How is this checked? A: Focused tests listed in Plan, then `bun run spur-check`, task verify PASS and a separate task commit. Run `bun run spur-check-feature` once per completed feature (after both tasks for B61). CLI source changes additionally require `bun link` inside apps/cli and `bun run --filter @gobing-ai/spur build:bundle` from the root. New feature completion must satisfy its real dogfood gate; historical parent evidence is not fabricated.

### Design

Scope is apps/cli/src/commands/agent.ts option description, plugins/sp/skills/spur-dev/references/cross-cutting.md and execution-workflow.md, plus focused existing contract tests. Read source authority and session-pinned-dispatch.md §4 before writing. Cross-cutting.md already correctly explains inline fallback: consolidate/link it rather than inventing a second rule. Place one session policy paragraph next to execution selection, with links to the owner; no duplicate exhaustive option catalog. Update the stale execution-workflow doctor-auth paragraph and cross-cutting exhaustion wording where it falsely implies that preflight availability does not exist. Doctor usability is not authentication or a live quota guarantee; existing snapshots/ownership and mid-run recovery remain separate signals.

Pin names and semantics must be copied from the shipped workflow/dispatch authority after inspection, not inferred from report labels. Workflow YAML already declares coder reuse/reviewer fresh and pins; read it as evidence only. No YAML or agent config changes. Do not alter source agent role declarations merely because installed frontmatter lacked a role: provenance/installer propagation remains unverified and belongs to Superskill investigation.

Verify generated --help via source-local CLI; use the existing inline-execution-contract/parity test structure for a small semantic assertion and a CLI-only backing-skill route. If capability quality validation is needed, use the installed superskill skill/command lifecycle, not hand-written adapter files. Record a bounded docs/dogfood artifact for this self-referential feature before completing I32. Do not repair parent I3's historical missing dogfood by inventing evidence; new I32 evidence is only for I32.

No upstream dependency. Own the named help/reference files and inline contract test; the I7 task owns scanner tests/wayfinder recipe. Both may run in isolated worktrees but must integrate and gate serially.

Source anchors:
- `apps/cli/src/commands/agent.ts`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md`
- `plugins/sp/skills/spur-dev/references/execution-workflow.md`
- `plugins/sp/tests/inline-execution-contract.test.ts`
- `plugins/sp/tests/cli-surface-parity.test.ts`
- `config/workflows/task-pipeline.yaml`
- `docs/design/session-pinned-dispatch.md`
- `plugins/sp/references/roles.md`
- `docs/reports/i31/0903-contract-adoption.md`

### Plan

- [ ] 1. Compare agent help, cross-cutting/execution prose and shipped session/pin source; record exact contradictions and add a focused failing assertion (R1-R2/AC1-AC2).
- [ ] 2. Correct help and centralize the concise policy paragraph/links, removing stale doctor-auth and preflight claims (R1-R2/AC1-AC2).
- [ ] 3. Exercise CLI-only guidance and source-local help; run focused inline/parity tests, record bounded I32 dogfood evidence (R3/AC3).
- [ ] 4. Run task-local gates and CLI link/bundle after source change, verify, then the I32 feature gate and wrap with one task commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
