---
template: feature-impl
schema_version: 1
name: "Implement agent.team config schema + parsing (0250): zod, member union, executor resolution, validation"
description: ""
status: wip
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T06:50:47.941Z"
updated_at: "2026-07-14T07:35:32.149Z"
---

## 0257. Implement agent.team config schema + parsing (0250): zod, member union, executor resolution, validation

### Background
**Backend implementation ticket** (feature M) — implements the **0250** decision (Team config schema).
Foundational: 0258 (runtime) and 0256 (API) both read `agent.team` through this. No dependencies.

The decided schema, the string|object member union, the executors-first/raw-agent resolution rule, the
always-prefixed id derivation (finalized by 0251), the autostart precedence, and the validation rules
are fully specified in **task 0250 `### Design` + `### Solution`**. This ticket is the code for that
decision in `packages/config`.
### Requirements
R1. `TeamMemberConfigSchema` — a `z.union([z.string().min(1), z.object({ executor, id?, purpose?, workspace?, model?, autonomy?, systemPrompt?, command?, autostart? })])`; a bare string normalizes to `{ executor: <string> }` (0250 Design).
R2. `TeamConfigSchema` — `{ name, work_dir, autostart?, members: min(1) }`; add `team: z.record(z.string(), TeamConfigSchema).optional()` to `AgentConfigSchema`.
R3. A normalization helper (`normalizeMember`) and an executor resolver (`resolveExecutor(name, config)` → `{agent, model?}` via `agent.executors` first, else treat as a raw canonical agent type) — exported for 0258's materialization.
R4. Validation via `superRefine`: `members ≥ 1`; member-id uniqueness within a team (localId = `member.id ?? executor`); the composed id `<teamId>-<localId>` must satisfy `validateAgentId` (`^[a-z][a-z0-9_-]{1,63}$`, ≤64 chars) — reject uppercase/leading-digit/over-length at load (0251); `name`/`work_dir` non-empty.
R5. Tilde-expand `work_dir` and per-member `workspace` at load.
R6. Keep `apps/cli/schemas/spur-config.schema.json` (and any embedded copy) in sync with the zod (config convention).
R7. Backward-compat: `team` optional; a config with no `agent.team` loads unchanged; `agent.executors` and `.spur/agents/*` untouched.
### Acceptance Criteria
- **AC1** A config with `agent.team.alpha.members: ['claude', {executor:'omp-zai', purpose:'reviewer'}]` parses; the string member normalizes to `{executor:'claude'}`.
- **AC2** Two members resolving to the same localId in one team → a config-load error whose path points at the duplicate.
- **AC3** A composed id that violates `validateAgentId` (e.g. team key `Alpha`, or a >64-char `<team>-<local>`) → load error at parse time, with a message naming the offending part.
- **AC4** `work_dir: "~/x"` resolves to an absolute path in the parsed config.
- **AC5** `resolveExecutor('claude', config)` returns the executor entry when present, else `{agent:'claude'}`; an unknown-and-non-agent ref errors.
- **AC6** A config with NO `agent.team` block loads exactly as today (backward-compat regression test); `agent.executors` + specs unaffected.
- **AC7** The JSON schema accepts/rejects the same shapes as the zod (round-trip test).
- **AC8** `bun run lint` + `bun run test` green; new schema code covered.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Location:** `packages/config/src/index.ts` — add `TeamMemberConfigSchema` + `TeamConfigSchema` beside
`AgentExecutorConfigSchema` (index.ts:107) and extend `AgentConfigSchema` (index.ts:123) with the optional
`team` record. The concrete zod (with `superRefine`) is written out in **0250 `### Design`** — implement it
verbatim, adjusting only for lint.

**Helpers (exported for 0258):** `normalizeMember(m): NormalizedMember` (string → `{executor}`),
`resolveExecutor(name, agentConfig): {agent, model?}` (executors-first, raw-agent fallback per 0250 R5).

**Validation:** the `superRefine` on `TeamConfigSchema` enforces member-id uniqueness + the composed-id
charset/length (import/reuse the `validateAgentId` regex from `@gobing-ai/ts-ai-runner` `agent-spec.ts:31`,
or mirror it to avoid a config→ai-runner dep — pick per existing deps). Tilde expansion via the existing
config path util (or `node:os` homedir) at load in `loader.ts`.

**JSON schema:** update `apps/cli/schemas/spur-config.schema.json` (the editor/CI aid) to match; the runtime
SSOT is the zod.

**Grounding:** `packages/config/src/index.ts:107,123`; `validateAgentId` at ts-ai-runner `agent-spec.ts:31`.
**Confidence:** schema shape **HIGH** (specified in 0250, verified schema locations); the config→ai-runner
charset reuse is a small **MEDIUM** decision (reuse vs mirror).

**Files:** `packages/config/src/index.ts`, `packages/config/src/loader.ts` (tilde), `apps/cli/schemas/spur-config.schema.json`, `packages/config/tests/*`.
### Plan
1. Add `TeamMemberConfigSchema` + `TeamConfigSchema` (from 0250 `### Design`); add `team` to `AgentConfigSchema`.
2. `normalizeMember` + `resolveExecutor` helpers (export for 0258).
3. `superRefine`: member-id uniqueness; composed-id `validateAgentId` charset + ≤64; non-empty name/work_dir.
4. Tilde-expand `work_dir` / `workspace` in `loader.ts`.
5. Sync `spur-config.schema.json`.
6. Tests: valid parse + string-normalization, dup-localId error, charset/length error, tilde expansion, `resolveExecutor` cases, no-`team` backward-compat, JSON-schema round-trip.
7. `bun run lint && bun run test`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-14T07:15:58.316Z todo → wip (system)
