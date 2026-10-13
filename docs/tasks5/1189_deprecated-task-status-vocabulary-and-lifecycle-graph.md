---
schema_version: 1
name: Deprecated task status vocabulary and lifecycle graph
status: wip
template: feature-impl
created_at: 2026-10-13T16:56:12.964Z
updated_at: "2026-10-13T17:09:55.562Z"
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

Change map (ADR-137 / design `docs/design/task-deprecated-status.md` §3.1 S1–S4, §4.1, §4.3).
Mirrors F42/ADR-136 at the task layer: append the enum member, add the icon + identity alias,
add graph edges. No new semantics invented.

#### R1 — `deprecated` is a canonical task status in the domain vocabulary

| Change | file:line |
| --- | --- |
| `TASK_STATUSES` gains the `deprecated` member (append-only; DD-01) | `packages/domain/src/planning/schema.ts:28` |
| `TASK_STATUS_ICONS.deprecated` (presentation-only, never persisted) | `packages/domain/src/planning/schema.ts:56` |
| identity alias `deprecated: 'deprecated'` so `normalizeTaskStatus` stays total | `packages/domain/src/planning/schema.ts:169` |

`normalizeTaskStatus` throws for any key missing from the alias map, so the identity alias is
mandatory, not cosmetic (`packages/domain/src/planning/schema.ts:169`); `normalizeTaskStatusSafe`
needs no branch. Tests: `packages/domain/tests/planning-schema.test.ts:78` (frontmatter accept),
`:184` (alias round-trip), `:308` (icon), `:261` (exact `TASK_STATUSES` array).

#### R2 — the vocabulary round-trips through the public surface, no contract edit

| Change | file:line |
| --- | --- |
| contract enum derives from `TASK_STATUSES` (transition `toStatus`) — no src edit needed | `packages/contracts/src/task.ts:79` |
| CLI board title map is a total `Record<TaskStatus, string>` — gains `deprecated` (compile fix) | `apps/cli/src/commands/task.ts:80` |
| batch-verdict not-started map is a total `Record<TaskStatus, boolean>` — gains `deprecated` (compile fix) | `packages/app/src/services/task-verdict.ts:546` |
| contract round-trip test (input/output accept `deprecated` verbatim) | `packages/contracts/tests/contract.test.ts:428` |

The two total `Record<TaskStatus, …>` maps are the only consumers the added enum member forced to
widen; both are exhaustive types, so omitting `deprecated` is a `TS2741` compile error. Values are
semantic: the terminal board title is `Deprecated`; a deprecated task is NOT-STARTED in the batch
rollup (frozen — no verifiable work to roll up, never a FAIL).

#### R3 — lifecycle graph retains a deprecated task; only un-deprecation/removal exits

| Change | file:line |
| --- | --- |
| new `deprecated` state (non-terminal) | `config/workflows/task-lifecycle.yaml:67` |
| `deprecated` stays out of `terminalStates` (which holds only `cancelled`) | `config/workflows/task-lifecycle.yaml:45` |
| entry edges from backlog, todo, wip, testing, blocked and done (guard `always`) | `config/workflows/task-lifecycle.yaml:168` |
| exit to todo — un-deprecate | `config/workflows/task-lifecycle.yaml:200` |
| exit to cancelled — removal | `config/workflows/task-lifecycle.yaml:205` |
| bundled copy regenerated by `bun run build:bundle` — byte-identical to the source graph | `config/workflows/task-lifecycle.yaml:67` |
| drift tests: accepted from every listed source, non-terminal, exits only todo/cancelled, no sibling pairs | `packages/domain/tests/planning/lifecycle-drift.test.ts:63` |

Exactly one transition per (from, to) pair (the file's [CRITICAL] note); `deprecated` has no forward
edge, so the auto-walk finds no hop and any other status write is refused by the graph (ADR-135).
`.spur` typecheck: `packages/domain`, `packages/contracts`, `packages/app`, `apps/cli`, `apps/server`,
`apps/web`, `apps/desktop` all green; the bundled copy is byte-identical (same sha256).

Note: the graph is the SSOT the CLI adapter reads to name the legal exits in a refusal
(`formatDenialWithLegalPaths`), so "refused naming the legal edges" reduces to the exit-set invariant
asserted at `packages/domain/tests/planning/lifecycle-drift.test.ts:81`.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T17:09:51.472Z todo → wip (system)

