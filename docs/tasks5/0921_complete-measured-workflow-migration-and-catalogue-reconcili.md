---
schema_version: 1
name: Complete measured workflow migration and catalogue reconciliation
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.303Z
updated_at: "2026-09-22T02:58:04.179Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w08
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0916", "0917", "0918", "0919", "0920", "0912", "0913"]
---

## 0921. Complete measured workflow migration and catalogue reconciliation

### Background

The new behavior must reach real source/installed/override callers without overwriting user graphs or leaving standing candidates. This slice consolidates final acceptance and compatibility evidence; each earlier slice still owns its own tests, documentation, packaging and rollback. Covers proposed feature R8. Depends on outcomes of W03-W07 plus 0912/0913.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W08 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Reconcile all ten current definitions and their live callers against the accepted retain/refactor/example dispositions and record any deferred changes honestly.
- [ ] R2. Verify fresh installations, project overrides, registered configuration and shared fallback, including explicit handling of active runs with changed definition identities.
- [ ] R3. Finish every candidate with measured promotion or retirement using its own baseline and preserve run/history evidence and a reversible migration path.
- [ ] R4. Update only changed authority/skill/init/package owners; classify or relocate the DecisionMaker example only with loader/package/reference compatibility.

### Acceptance Criteria

- [ ] AC1 — All ten definitions and live callers have a final justified disposition; deferred optimizations are not claimed as implemented. (req: R1)
- [ ] AC2 — Installed/source/override fixtures retain resolution precedence and either safely handle or explicitly refuse changed-definition continuation. (req: R2)
- [ ] AC3 — Each candidate has a measured promoted/retired outcome and rollback evidence, with no expired or standing parallel graph left behind. (req: R3)
- [ ] AC4 — Changed docs, skills, generated artifacts and init defaults agree; example packaging/reference checks and final applicable feature gates pass. (req: R4)
- [ ] AC5 — Migration preserves users and demonstrates outcomes (req: R1)

Feature-level traceability: this task delivers D63 scenario R8; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

No new production YAML or permanent v2 is expected. Keep nine production definitions unless the measured caller/history review justifies a separately reviewed retirement. The example may stay where it is if moving it introduces needless compatibility cost. Project overrides remain user-owned. Old active runs cannot silently continue under a new graph digest. Reuse existing validation, plugin smoke and promotion gates instead of building a rollout service.

### Plan

- [ ] 1. Assemble the disposition and source/installed/override conformance matrix from the completed slices.
- [ ] 2. Resolve outstanding candidate deadlines and run compatibility/rollback exercises without live external side effects.
- [ ] 3. Apply the smallest justified example classification or relocation with reference/package checks.
- [ ] 4. Run the final feature-scoped gates, record measured outcomes and explicit deferrals, and synchronize owning documentation through its established process.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:04.179Z todo → blocked (system)

