---
schema_version: 1
name: "Global-layer availability updater and quota recovery consumer: setExecutorAvailability targets the declaring config layer and agent.quota.recovered re-enables quota-owned executors"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.553Z
updated_at: "2026-09-17T23:22:19.748Z"
feature_id: B6
priority: P1
tags:
  - config
  - executor-availability
  - recovery
  - B6
estimate_hours: 7

dependencies: ["0890"]
---

## 0891. Global-layer availability updater and quota recovery consumer: setExecutorAvailability targets the declaring config layer and agent.quota.recovered re-enables quota-owned executors

### Background

After task 3 every disable carries an owner. Two gaps remain from `executor-availability.md` §6: global-only executors (all 16 on the reference machine) cannot be persisted because the updater only knows the project fragment, and `agent.quota.recovered` events are dropped. Authority: `docs/design/session-pinned-dispatch.md` §3.2–§3.3, AC R3/R4; operator approved automatic writes to `~/.config/spur/config.yaml` with backup + atomic rename (design-approval 2026-09-17).

### Requirements

- [ ] R1. `setProjectExecutorDisabled` is generalized to `setExecutorAvailability({{ layer: 'project'|'global', executor, disabled, observation }})`; the layer is chosen by where the executor is declared (project fragment wins when both declare it); the old name stays as a thin wrapper only while a caller exists.
- [ ] R2. Global writes target `~/.config/spur/config.yaml` (respecting the existing config-path resolution) with the same backup file, atomic rename and conflict-detection error codes as project writes; the project file is byte-identical after a global-only write.
- [ ] R3. Loader cache invalidation fires for both layers so the next `resolveRole` sees the change without a process restart.
- [ ] R4. The event bridge upserts `agent.quota.recovered` into `agent_executor_updates` as `disabled: false, owner: quota`; the drain applies it only when the current owner is `quota` or `probe` and records a classified skip otherwise.
- [ ] R5. Tests: layer selection (project-declared, global-only, both), global backup + atomic write against a temp HOME, recovered-event drain for each owner; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R3, R4.

- [ ] AC1 — A quota-owned disable recovers on evidence (req: R4)
- [ ] AC2 — A global-only executor is persisted in the global config (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: one updater with a `layer` argument instead of a second `setGlobalExecutorDisabled` — the YAML node shape is identical and only the path differs (docs/design/session-pinned-dispatch.md §3.2). Recovery is evidence-driven only: a `recovered` event or (task 5) a usage snapshot; there is no timer and no synthetic recovery, per feature Scope. The wrapper name is kept only until task 5 lands and is deleted then. Mutation policy: `packages/config/src/executor-update.ts` + loader invalidation, `packages/app/src/services/event-bridge.ts` and `agent-quota-updates.ts`, tests, `executor-availability.md` §6 (limitations closed); no producer, no doctor rendering.

### Plan

1. Read design §3.2–§3.3 and `executor-update.ts` end to end; read the loader's cache invalidation seam and the event bridge's `quota.exhausted` handler.
2. Add `layer` selection + global path resolution to the updater; extend the invalidation; keep error codes.
3. Add the `recovered` handler mirroring the `exhausted` one; apply the owner rule in the drain.
4. Write the tests (temp HOME for the global file); update `executor-availability.md` §6.
5. Run `cd packages/config && bun test`, `cd packages/app && bun test tests/services/`, then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
