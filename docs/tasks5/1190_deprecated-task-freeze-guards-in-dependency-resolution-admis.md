---
schema_version: 1
name: Deprecated task freeze guards in dependency resolution, admission, checks and status writes
status: todo
template: feature-impl
created_at: 2026-10-13T16:56:12.968Z
updated_at: "2026-10-13T16:57:23.712Z"
feature_id: F43
priority: P2
estimate_hours: 6

dependencies: ["1189"]
---

## 1190. Deprecated task freeze guards in dependency resolution, admission, checks and status writes

### Background

Implements: R3 — New dependency links onto a deprecated task are refused before any write; R4 — A deprecated task never starts, advances or gets routed; R5 — Checks flag live dependents and section writes are warned about; R9 — Only status-moving writes are frozen, and existing edges are never rewritten.

Design: docs/design/task-deprecated-status.md §3.1 S6-S10, §3.2 (the exempt write set), §4.2; ADR-137.

Ordering: depends on the vocabulary slice — every guard names the status it refuses on.

### Requirements

- [ ] R1. Refuse a new dependency edge onto a deprecated task in the ready-set resolver before any `depends_on` frontmatter is written (`packages/app/src/workflow/idea-handoff.ts:148,221` — the resolver that maps `depends_on_names` to WBS); the error names the deprecated task and the un-deprecate command (`spur task update <wbs> todo`).
- [ ] R2. Refuse pipeline admission for a deprecated task: `quickReadiness` in `plugins/sp/scripts/batch-preflight.ts` reports it as non-runnable with its own code, and a deprecated task in the `--dep-status` set never reads as a satisfied dependency.
- [ ] R3. Refuse the status move and name the exit: a `spur task update <wbs> <status>` that targets neither `todo` nor `cancelled` fails through the graph (ADR-135) with the un-deprecate hint added to the refusal message; confirm the auto-walk chain (`packages/app/src/services/task-service.ts:1834-1915`) finds no hop from `deprecated` and therefore performs no write.
- [ ] R4. Emit a new warning `L4.task-deprecated` (`packages/config/src/finding-codes.ts:47,145`; raised in `packages/app/src/services/task-check.ts:1176` beside `L4_FEATURE_DEPRECATED`) for a live dependent of a deprecated task, naming re-point or un-deprecate; a terminal dependent gets no finding; `--strict` elevates per the existing policy.
- [ ] R5. Make a section write on a deprecated task succeed with a freeze note in the returned `warnings[]` (`packages/app/src/services/task-service.ts:1470`, channel at :1550/:1589/:1649/:1663) instead of failing the write.
- [ ] R6. Honour the exempt write set (`docs/design/task-deprecated-status.md` §3.2) and prove the freeze is prospective: the record hop, anchor migration and the verdict write still work on a deprecated task, while a pre-existing dependency edge onto a newly deprecated task is reported by R4 and never rewritten.

### Acceptance Criteria

- [ ] AC3 — New dependency links onto a deprecated task are refused before any write
- [ ] AC4 — A deprecated task never starts, advances or gets routed
- [ ] AC5 — Checks flag live dependents and section writes are warned about
- [ ] AC9 — Only status-moving writes are frozen, and existing edges are never rewritten

Task-local checks: the refusal messages name the un-deprecate command; a refused write leaves the task file byte-identical.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: attach each guard where the surface actually exists instead of mirroring F42 file-for-file.

Why: grounding the design against the tree found three mismatches with a literal mirror. (1) There is no `spur task advance` verb — the task-side forward path is the graph-mediated status write plus the auto-walk chain at `task-service.ts:1834-1915`, so the refusal and its hint belong there, and adding a verb only to have somewhere to refuse would be a public-surface expansion for no operator benefit. (2) `depends_on` has no write guard in `task-service.ts` at all; edges are authored at handoff time as `depends_on_names` (`idea-handoff.ts:148,221`) and consumed by the preflight, so the dependency freeze attaches at the resolver and the preflight. (3) `FeatureService.updateSection` already returns warnings, and `TaskService.updateSection` has the same channel — so the advisory belongs in the service, not in the CLI.

Rejected: refusing every write on a deprecated task. It would strand the evidence trail and the corpus-integrity hops (record, anchor migration, verdict), turn a mistaken freeze into a data-loss event, and contradict F42's own 'warnings, not errors' treatment.

Invariants: the freeze is prospective — an edge recorded before the deprecation is reported, never deleted or rewritten; admission refusal is reported by code, never by silence; a warning never turns a legal write into an error.

Key surfaces and signatures: `resolveReadySet(...)`-side refusal in `packages/app/src/workflow/idea-handoff.ts`; `quickReadiness(...)` + `FINDING_CODES` entry in `plugins/sp/scripts/batch-preflight.ts`; `L4_TASK_DEPRECATED = 'L4.task-deprecated'` in `packages/config/src/finding-codes.ts`; the deprecated-task branch in `packages/app/src/services/task-check.ts`; the `warnings.push(...)` branch in `TaskService.updateSection`.

Test-first note: write the failing cases before the code — dependency refusal on create/update/batch-create, admission refusal, refused status move with the hint, the finding for a live dependent, the warning on a section write, and the exempt hops that must still succeed.

### Plan

1. Write the failing cases for each guard (dependency refusal, admission, refused status move, finding, section-write warning, exempt hops).
2. Add the dependency refusal at the handoff resolver.
3. Add the preflight admission refusal and its code.
4. Add the un-deprecate hint to the status-write refusal and assert no write happens.
5. Add `L4.task-deprecated` plus the task-check branch.
6. Add the section-write warning.
7. Prove the exempt hops and the never-rewritten pre-existing edge.
8. Run the focused service, preflight and finding-code tests.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
