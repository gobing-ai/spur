---
template: feature-impl
schema_version: 1
name: "Implement agent.team config schema + parsing (0250): zod, member union, executor resolution, validation"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T06:50:47.941Z"
updated_at: "2026-07-14T20:05:41.828Z"
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
**Location:** `packages/config/src/index.ts` — added `TeamMemberConfigSchema` (string|object union), `TeamConfigSchema` ({name, work_dir, autostart?, members min(1)}), `normalizeMember` + `resolveExecutor` helpers, and `team: z.record(z.string(), TeamConfigSchema).optional()` on `AgentConfigSchema` with a `superRefine` for member-id uniqueness + composed-id charset/length.

**Change map:**
- `packages/config/src/index.ts:116` — `AGENT_ID_REGEX` mirrored from ts-ai-runner `validateAgentId` (ADR-027: keep CF-safe core free of ts-ai-runner dep).
- `packages/config/src/index.ts:126` — `TeamMemberConfigSchema = z.union([z.string().min(1), z.object({...})])`; bare string normalizes via `normalizeMember`.
- `packages/config/src/index.ts:151` — `TeamConfigSchema` with `members: z.array(...).min(1)`, non-empty `name`/`work_dir`.
- `packages/config/src/index.ts:170` — `normalizeMember(member)` exported for 0258.
- `packages/config/src/index.ts:193` — `resolveExecutor(name, agentConfig, opts)` exported; executors-first, raw-agent fallback, optional `isCanonicalAgent` predicate (injected by 0258).
- `packages/config/src/index.ts:215` — `team` field added to `AgentConfigSchema`; `superRefine` checks dup-localId + composed-id `AGENT_ID_REGEX`.
- `packages/config/src/loader.ts:253` — `expandTilde` (Node-only; `~`/`~/` via `node:os` homedir).
- `packages/config/src/loader.ts:269` — `expandTeamTildes` applies to `work_dir` + per-member `workspace`; wired into `loadSpurConfigFile` return at `loader.ts:316`.
- `apps/cli/schemas/spur-config.schema.json` — JSON schema synced with team/member/work_dir/executor defs (zod is SSOT).
- `packages/config/tests/team-config.test.ts` — 22 tests covering AC1-AC6 (parse, normalize, dup-id, charset/length, resolveExecutor, backward-compat).
- `packages/config/tests/loader.test.ts` — AC4 (tilde), AC6 (no-team backward-compat), AC7 (JSON-schema round-trip).

**Rationale:** schema shape specified verbatim in 0250 `### Design`; the config→ai-runner charset reuse was resolved by mirroring the regex (ADR-027) rather than importing, keeping the config package CF-safe. `resolveExecutor`'s `isCanonicalAgent` predicate is injected by the 0258 materialization layer so canonical-agent validation stays a single source in ts-ai-runner.
### Testing
**Verify verdict: PASS** (`.spur/run/0257-verdict.json`) — re-verification 2026-07-14 (`--force --focus all --fix all`).

**Per-Requirement traceability**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `TeamMemberConfigSchema` z.union + `normalizeMember` (index.ts). AC1 test. |
| R2 | MET | `TeamConfigSchema` + `team: z.record(...)` on `AgentConfigSchema` (index.ts). |
| R3 | MET | `normalizeMember` + `resolveExecutor` exported (executors-first, raw fallback). |
| R4 | MET | `superRefine`: dup-localId + per-team composed-id charset/length + (review) global cross-team uniqueness; non-empty name/work_dir. AC2/AC3 + collision tests. |
| R5 | MET | `expandTilde`/`expandTeamTildes` wired at `loader.ts:316`. AC4 test. |
| R6 | MET | `spur-config.schema.json` matches the zod. AC7 round-trip test. |
| R7 | MET | `team` optional; no-team config unchanged. AC6 test. |

**Per-Acceptance-Criteria traceability** (dev-verify AC guard — the prior verdict left `acceptanceCriteria: []`):

| AC | Status | Evidence |
|----|--------|----------|
| AC1 string normalizes | MET | team-config.test.ts AC1 + normalizeMember AC1 |
| AC2 dup localId → error path | MET | team-config.test.ts AC2 (object + shorthand) |
| AC3 charset/length → error | MET | team-config.test.ts AC3 (uppercase key, >64) |
| AC4 tilde → absolute | MET | loader.test.ts AC4 |
| AC5 resolveExecutor | MET | team-config.test.ts AC5 (3 tests) |
| AC6 backward-compat | MET | team-config.test.ts + loader.test.ts AC6 |
| AC7 JSON-schema round-trip | MET | loader.test.ts AC7 |
| AC8 lint + test green | MET | `bun test packages/config` 91 pass / 0 fail; biome clean |

**Verdict: PASS** — 7/7 requirements + 8/8 AC MET with deterministic test evidence. Coverage: `packages/config/src/index.ts` 87%, `loader.ts` 93% (per-file gate; `.tsx` excluded rule N/A here).

**Note:** the review's P3 fix (cross-team composed-id uniqueness) is in the working tree, **uncommitted** — see `## Review`.
### Review
**Reviewed:** 2026-07-14 · commit `98c7b14` (feat(config): parse agent team config schema) · `--focus all --fix all`.
**Verdict: PASS** — faithful implementation of the 0250 decision; one correctness edge fixed under `--fix all`.

**Dimension outcomes**
- **Functional traceability — PASS.** All R1–R7 implemented; all AC1–AC8 have dedicated tests (`team-config.test.ts` + `loader.test.ts:580/625`). `expandTeamTildes` is correctly wired into the load path (`loader.ts:316`), immutable, and handles string / no-workspace members.
- **Security / correctness / efficiency / usability — clean.** Pure schema code, no I/O beyond tilde expansion (Node-only, correctly kept out of the CF-safe core). superRefine mirrors the existing executor dup-check pattern. ADR-027 respected: `AGENT_ID_REGEX` mirrored (not imported) and `resolveExecutor` takes an injected `isCanonicalAgent` predicate so the core stays ts-ai-runner-free.
- **Architecture — clean.** Deep, single-responsibility helpers (`normalizeMember`, `resolveExecutor`); JSON schema kept in sync with the Zod SSOT.

**Findings (severity-ranked)**

| Priority | Finding | Disposition |
| P3 | **Cross-team composed-id collision not detected at config-load.** localId uniqueness was checked only WITHIN each team, but the `<teamId>-<localId>` join uses `-` (allowed in both parts) so it is not injective: team `web-01` member `claude` and team `web` member `01-claude` both yield `web-01-claude`. This contradicted 0251's "collision impossible by construction" invariant; it would fail late at `spur team up` (loadAgentSpecs dup-throw), not at config-load. | **FIXED** (working tree, uncommitted) — added a global `seenComposed` uniqueness pass in the `AgentConfigSchema` superRefine + a regression test. 71/71 config tests pass. |
| P3 | **`AGENT_ID_REGEX` mirror has no drift guard.** The regex is deliberately duplicated from ts-ai-runner `validateAgentId` (ADR-027 CF-safety), but no test asserts the two stay identical — a silent divergence risk if the runner's id format changes. | **RECOMMENDED** (not applied) — add a parity test in `packages/app` (where both `@gobing-ai/spur-config` and ts-ai-runner are deps; the config package can't import the runner). |
| P4 | **Executor references not validated at config-load.** `resolveExecutor` without an injected predicate accepts any non-empty name as a raw agent, so a typo'd `executor:` in `agent.team` surfaces only at `spur team up` (0258 injects the predicate). | **ADVISORY** — as designed (0250 R5 defers resolution to materialization); no change. Optionally emit a config-load warning later. |

**Verification:** `bun test packages/config` → **71 pass / 0 fail**; Biome check clean. Change is isolated to `packages/config`.

**Note:** the `--fix all` change is in the **working tree, not committed** (I don't commit to `main` without asking). Review the diff to `packages/config/src/index.ts` + `tests/team-config.test.ts` and commit when ready, or ask me to.
### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-14T07:15:58.316Z todo → wip (system)
- 2026-07-14T16:19:06.923Z wip → testing (system)
- 2026-07-14T16:19:16.873Z testing → done (system)
