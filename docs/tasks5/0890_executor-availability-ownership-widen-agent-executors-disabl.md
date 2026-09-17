---
schema_version: 1
name: "Executor availability ownership: widen agent.executors[].disabled to carry owner/since/reason, normalize readers, and enforce owner precedence in the B5 drain"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.552Z
updated_at: "2026-09-17T23:20:05.429Z"
feature_id: B6
priority: P1
tags:
  - config
  - executor-availability
  - B6
estimate_hours: 6

dependencies: []
---

## 0890. Executor availability ownership: widen agent.executors[].disabled to carry owner/since/reason, normalize readers, and enforce owner precedence in the B5 drain

### Background

B5 (ADR-111) persists `agent.quota.exhausted` as `disabled: true` with no record of who disabled the executor, so nothing can safely re-enable it. Authority: `docs/design/session-pinned-dispatch.md` §3.1 (ownership state), §3.2 (row fields), AC R1/R2/R10; `packages/config/src/index.ts` `AgentExecutorConfigSchema` (`disabled: z.boolean().default(false)`), `packages/config/src/executor-update.ts`, `packages/app/src/services/agent-quota-updates.ts`.

### Requirements

- [ ] R1. `AgentExecutorConfigSchema.disabled` accepts `boolean | {{ owner: 'operator'|'quota'|'probe', since: RFC3339 string, reason: string }}`; a bare `true` normalizes to `{{ owner: 'operator' }}`; one exported normalizer in `packages/config` is the only reader of the raw shape.
- [ ] R2. `setProjectExecutorDisabled` writes the object form for automatic callers (owner `quota` or `probe`, `since`, `reason`) and keeps the YAML updater's backup + atomic-rename + conflict-detection behaviour and its error codes.
- [ ] R3. The `agent_executor_updates` row gains `owner` and `layer` columns (next four-digit drizzle migration); the serial drain applies a `quota`/`probe` update only when the current owner is not `operator`, records the classified no-op in `last_error`-free form (a distinct `skipped_reason`), and keeps B5's `(observed_at, observation_id)` ordering between automatic writers.
- [ ] R4. `apps/cli/schemas/spur-config.schema.json`, `config/config.example.yaml` and the configuration design satellite document the object form and the bare-boolean equivalence.
- [ ] R5. Tests: schema round-trip for both forms; drain precedence (operator-owned row survives a quota update; quota-owned row accepts a later probe update); `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R1, R2, R10.

- [ ] AC1 — A quota-driven disable records its owner, timestamp and reason (req: R1)
- [ ] AC2 — An operator-owned disable is never re-enabled automatically (req: R3)
- [ ] AC3 — Owner precedence resolves concurrent writers (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: ownership lives in the config value itself, not in a side table, so the file a human reads is the truth and the B5 conflict detection keeps working on one YAML node (docs/design/session-pinned-dispatch.md §3.1). Bare boolean stays valid forever; `true` means operator because only humans write bare booleans. Precedence is a two-line rule (operator wins; automatic writers order by observation) applied in the existing drain, not a new state machine. `layer` is recorded now so task 4's global updater needs no second migration. Mutation policy: `packages/config` (schema, normalizer, updater), `packages/domain` (migration + DAO for the two columns), `packages/app/src/services/agent-quota-updates.ts`, JSON schema, example config, tests, config satellite; no recovery consumer, no global file writes (task 4), no producer (task 5).

### Plan

1. Read design §3.1–§3.2, ADR-111 and `executor-availability.md` §5–§6; read `AgentExecutorConfigSchema`, `setProjectExecutorDisabled`, and the drain in `agent-quota-updates.ts`.
2. Widen the Zod schema with a discriminated shape; add and export the normalizer; update every reader found by `rg 'disabled' packages apps`.
3. Extend the updater to write the object form; add the drizzle migration and DAO fields; implement precedence in the drain.
4. Update JSON schema, example config, and the configuration satellite row; write the tests.
5. Run `cd packages/config && bun test`, `cd packages/app && bun test tests/services/agent-quota-updates*`, then `bun run spur-check`.
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
