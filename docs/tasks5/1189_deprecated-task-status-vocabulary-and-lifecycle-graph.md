---
schema_version: 1
name: Deprecated task status vocabulary and lifecycle graph
status: todo
template: feature-impl
created_at: 2026-10-13T16:56:12.964Z
updated_at: "2026-10-13T16:56:13.040Z"
feature_id: F43
priority: P2
estimate_hours: 3

---

## 1189. Deprecated task status vocabulary and lifecycle graph

### Background

Implements: R1 — Deprecated is a canonical task status across domain and contracts; R2 — The lifecycle graph retains a deprecated task and allows only un-deprecation or removal exits.

Design: docs/design/task-deprecated-status.md §3.1 S1-S4, §4.1; ADR-137 (docs/00_ADR.md). The feature half already landed as F42/ADR-136 — mirror its shape, do not invent new semantics.

Ordering: first slice; the guard and derivation slices depend on it (no consumer can name `deprecated` before the vocabulary exists).

### Requirements

- [ ] R1. Append `deprecated` to `TASK_STATUSES` and add `TASK_STATUS_ICONS.deprecated` in `packages/domain/src/planning/schema.ts` (statuses at :20, icons at :39); add the identity alias `deprecated: 'deprecated'` to `TASK_STATUS_ALIASES` (:141) so `normalizeTaskStatus` (:190) stays total and a missing alias key cannot throw for a canonical status.
- [ ] R2. Prove the vocabulary end to end: a task file declaring `status: deprecated` lists, shows and validates; `spur task list --status deprecated` selects it; the task contract round-trips it with no edit to `packages/contracts/src/task.ts` (it uses `z.enum(TASK_STATUSES)`); an unknown status still fails naming the allowed set.
- [ ] R3. Add the `deprecated` state and its edges to `config/workflows/task-lifecycle.yaml`: enter from `backlog`, `todo`, `wip`, `testing`, `blocked` and `done`; exit only to `todo` (un-deprecate) and `cancelled` (removed); keep `deprecated` out of `terminalStates`; keep one transition per (from, to) pair per the file's own [CRITICAL] note; then regenerate `apps/cli/config/workflows/task-lifecycle.yaml` with `bun run build:bundle` so the two copies are byte-identical.

### Acceptance Criteria

- [ ] AC1 — Deprecated is a canonical task status across domain and contracts
- [ ] AC2 — The lifecycle graph retains a deprecated task and allows only un-deprecation or removal exits

Task-local checks: the bundled copy is byte-identical to the source graph; an unknown status still reports the full allowed set.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: mirror F42/ADR-136 at the task layer — append the enum member, add the icon and the identity alias, and add graph edges only.

Why not a `frozen: true` flag: it introduces a second status axis every consumer must combine with `status`; a status is already a single closed vocabulary (DD-01). Why not a terminal `deprecated`: it duplicates `cancelled` and loses un-deprecation (ADR-136 rejected the same shape for features). Why not reuse `blocked`: it is an impediment with edges straight back into `wip`/`testing`, i.e. an invitation to resume, which is exactly what the freeze must prevent.

Invariants: `deprecated` is not in `terminalStates`; `normalizeTaskStatus` throws for any key missing from the alias map, so the alias entry is mandatory, not cosmetic; the contracts layer needs no edit because it derives its enum from `TASK_STATUSES`; no DB column and no migration exist, because status is frontmatter only.

Key surfaces and signatures: `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`) gains one member; `TASK_STATUS_ICONS` (:39) gains `deprecated`; `TASK_STATUS_ALIASES` (:141) gains `deprecated: 'deprecated'`; `config/workflows/task-lifecycle.yaml` gains 8 states-edges and 8 transitions. Verification: a status round-trip through the CLI plus `bun run build:bundle` diff showing the two lifecycle copies identical.

Migration caveat to state in the task notes: a project-layer `task-lifecycle.yaml` override resolves ahead of the shipped graph, so it refuses the new edges until re-synced (ADR-137 consequence).

### Plan

1. Extend the domain vocabulary and icon map.
2. Add the alias entry and confirm the normalize path.
3. Add the graph state and edges to `config/workflows/task-lifecycle.yaml`.
4. Regenerate the bundled workflow copy with `bun run build:bundle` and diff the two files.
5. Round-trip a disposable task file through the CLI (create, update to deprecated, list, show) in a throwaway project root.
6. Run the focused domain/schema and workflow-validation tests.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
