---
schema_version: 1
name: "Consume the runner capability record in Spur: agent-run affinity branches, doctor --json capabilities, requiresCapabilities attestation and stale-declaration warning"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.552Z
updated_at: "2026-09-18T11:15:55.412Z"
feature_id: B8
priority: P1
tags:
  - agent-run
  - doctor
  - capabilities
  - B8
estimate_hours: 6

dependencies: ["0888"]
---

## 0889. Consume the runner capability record in Spur: agent-run affinity branches, doctor --json capabilities, requiresCapabilities attestation and stale-declaration warning

### Background

With task 1 the runner declares per-agent session/stdin capabilities. Spur's `packages/app/src/workflow/actions/agent-run.ts` still branches on agent names and only reads the two legacy capability fields; `spur agent doctor --json` does not expose capabilities; `requiresCapabilities` attestation (task 0706) knows only the legacy fields. Authority: `docs/design/session-pinned-dispatch.md` §5 (Spur consumers paragraph), ADR-118 contract-violation outcome.

### Requirements

- [x] R1. `agent-run.ts` derives every resume/session-dir decision from `getAgentSessionCapability(agent)`; no agent-name conditional remains on the affinity path (verified by `rg` in the task's Solution).
- [x] R2. When `supportsResumeById` is `false` the action emits no `--resume`/`--session-id` style flag and records `session: fresh` in the action result.
- [x] R3. `spur agent doctor --json` includes a `capabilities` object per executor with the four booleans and `verifiedAgainst`; the table renders a compact capability column.
- [x] R4. `requiresCapabilities` accepts `resumeById`, `sessionDir`, `persistentStdin`, `structuredOutput`; an unmet requirement yields the ADR-118 contract-violation outcome before any subprocess spawn, naming the executor and the missing capability.
- [x] R5. Doctor emits one warning per executor when the detected CLI version differs from the record's `verifiedAgainst` (`capability-declaration-stale`), in both table and JSON output.
- [x] R6. Tests in `packages/app/tests/workflow/actions/` and `apps/cli/tests/commands/` cover R2, R4 and R5 with a stubbed capability record; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B8 scenarios R2, R3, R6, R7.

- [x] AC1 — Spur affinity logic consumes the record instead of agent names (req: R1)
- [x] AC2 — Doctor exposes capabilities per executor (req: R3)
- [x] AC3 — A stage can require a capability before spawn (req: R4)
- [x] AC4 — A stale capability declaration is surfaced (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: Spur reads, never re-declares (docs/design/session-pinned-dispatch.md §5). The stale warning compares two strings (`doctor` detection vs `verifiedAgainst`) — no semver parsing, because agent CLIs do not all use semver and a mismatch of any kind is worth a warning. Attestation stays where it is (`parseRequiresCapabilities`), extended by two enum members, so the ADR-118 outcome path is reused unchanged. Mutation policy: `packages/app/src/workflow/actions/agent-run.ts`, `packages/app/src/services/agent-service.ts` (doctor), `apps/cli` doctor rendering, tests, and the `plugins/sp/skills/spur-cli/references/agent.md` doctor row; no runner changes (task 1), no run-scoped pin changes (feature B7).

### Plan

1. Read design §5 and the current affinity block in `agent-run.ts` (lines ~215–340) plus `parseRequiresCapabilities`.
2. Replace name-based branches with capability reads; add the `session: fresh` result field for non-resume executors.
3. Extend `requiresCapabilities` parsing and the pre-spawn attestation; add tests for the contract-violation outcome.
4. Add `capabilities` to doctor JSON + table and the stale-declaration warning; update the spur-cli `agent.md` doctor rows.
5. Run workspace tests then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Task 0889 consumes the runner capability record released by 0888 (`@gobing-ai/ts-ai-runner@0.4.68`, `getAgentSessionCapability`/`resolveAgentName`) in Spur's agent-run affinity and adds session-capability gating per ADR-118.

**Config vocabulary** (`packages/config/src/index.ts:225-252`)
- `SESSION_CAPABILITY_AXES` = `resumeById|sessionDir|persistentStdin|structuredOutput` and `AGENT_RUN_CAPABILITY_AXES` = execution + session axes; `RequiresCapabilitiesSchema` now accepts all eight axes over `available|enforced`. Task-text discrepancy resolved: the design paragraph said "two enum members" but R4 lists four session axes — R4 wins (all four admitted; `sessionDir`/`persistentStdin`/`structuredOutput` are real record flags with `false` rows today, e.g. gemini/claude/codex dir+stdin).

**Session-axis evaluation** (`packages/app/src/services/capability-attestation.ts:157-207`)
- Pure `evaluateSessionCapabilities(requires, record, agentName)` → `{ok, reason, observed}`: `true` satisfies both levels; `false` or missing record satisfies neither (fail closed, 0706 R2 rule applied to runner-declared axes). Diagnostic names the executor agent, each missing axis, and the record `note`. No process spawn anywhere — callers gate BEFORE spawn.
- `parseRequiresCapabilities` error text now names the full eight-axis vocabulary.

**Action gating + record-driven affinity** (`packages/app/src/workflow/actions/agent-run.ts`)
- R4 pre-spawn gate (agent-run.ts:378-420): when a step requires any session axis, the action guarded-resolves the executor (`try/catch` keeps legacy behavior for fakes without `resolve`), canonicalizes via `resolveAgentName`, evaluates the record, and an unmet requirement returns the ADR-118 contract-violation outcome naming executor + axis — before any subprocess. `ContractName` extended with `requiresCapabilities` (`agent-run.ts:36`, event type `packages/app/src/workflow/observability.ts:169-170`).
- R1/R2 affinity (agent-run.ts:296-306, 342-346, 359-364, 385-390): the record for the declared/default agent (no agent-name conditionals) drives every resume decision — `supportsResumeById: false` suppresses the latch (never arms), `flags.sessionId`, and `flags.continue` (explicit or latch-derived); `sessionDir` stays (Spur-side log capture). Result records `session: 'fresh'` and `__agentSession: 'no-resume'` is written with no `__agentSessionId`, so downstream steps never arm a resume latch against an incapable agent (the 0406 exit-2 fallback remains as the safety net for record-unknown binaries and drift).
- No behavior change for capable agents (claude/codex/pi: `resumeById: true` in 0.4.68 — note codex resume was closed by 0888's release).

**Doctor capability surface** (`packages/app/src/services/agent-service.ts`)
- R3: `DoctorRow` carries `capabilities` (record verbatim, `note` included) + `capabilityStale`; `buildDoctorRows` reads the record per row's canonical binary (null when unknown) and string-compares detected version vs `verifiedAgainst`. Compact `CAPS` table column `r✓d✗s✗o✓` (`—` unknown, trailing `⚠` stale), detail block gains `caps:`/`verified:` lines, both JSON entry builders carry `capabilities` + `capabilityStale` (stderr-clean).
- R5: `warnCapabilityStale` emits one `capability-declaration-stale` stderr warning per executor with drifted version, in table, detail, and role-ladder text modes.
- Defense-in-depth (agent-service.ts:1256-1275): the per-attempt capability gate now also evaluates session axes against the runner record for the attempt's canonical agent — an escalation cannot land on an incapable executor (exit 2 pre-spawn).

**Docs (T3)**: `plugins/sp/skills/spur-cli/references/agent.md` (doctor CAPS/JSON), `docs/design/cli-contracts.md:424-466` (CAPS column + JSON fields), `docs/design/planning-workflow-contracts.md` (session-axis paragraph).

**Tests** (367 passing across the three touched suites):
- `packages/app/tests/workflow/actions/agent-run.test.ts` — B8 describe: gemini-record R2 suppression (no resume flags, `session: 'fresh'`, `no-resume` writeback), latch unarmed, claude pass-through unchanged, R4 unmet→contract-violation pre-spawn (bus event, `runTraced` not called), R4 met→serialized flags, unknown-binary fail-closed. Existing 0451 codex second-hop test annotated (codex record is resume-capable post-0888).
- `packages/app/tests/services/agent-service.test.ts` — R3 JSON record per executor (unknown binary → null), R5 stale JSON, stale stderr warning + `⚠` cell, fresh table without marker; 0621 column-count test updated 7→8 (CAPS).
- `packages/app/tests/services/capability-attestation.test.ts` — unchanged, passing.

**Validation**: `bunx tsc --noEmit` clean in `packages/config` + `packages/app`; targeted `bun test` — agent-run 146/146, agent-service 201/201, capability-attestation 20/20, `apps/cli/tests/commands/agent.test.ts` 32/32, doctor-probe + composition-advisory 28/28; biome check clean on all changed files.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | agent-run.ts:233-243 record-driven sessionCaps; zero agent-name literals on affinity path |
| R2 | MET | agent-run.ts:243,291-303,359,862,903,923-927 resume-false fresh dispatch + writeback gating |
| R3 | MET | agent-service.ts:2839-2848 DoctorRow capabilities+capabilityStale; :640-641/:759-760 JSON builders; :2991 CAPS column |
| R4 | MET | agent-service.ts:1186-1204,1308 gate; capability-attestation.ts:148-158 axis vocabulary |
| R5 | MET | agent-service.ts:707-711 warnCapabilityStale exact-compare warning; JSON stderr-clean |
| R6 | MET | fresh runs: 231 pass app services + 150 pass agent-run action / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-2 | MET |  | agent-run.ts:233-243 record-driven sessionCaps, zero agent-name literals; resume-false → no flags, session:'fresh', gated writeback |
| AC-3 | MET |  | agent-service.ts:2839-2848 DoctorRow capabilities+capabilityStale; :640/:759 JSON builders; :2991 CAPS column |
| AC-6 | MET |  | agent-service.ts:1186-1204,1308 requiresCapabilities pre-spawn gate; capability-attestation.ts:148-158 axes |
| AC-7 | MET |  | agent-service.ts:707-722 warnCapabilityStale surfaces drift on text surfaces; JSON stderr-clean |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T03:08:07.532Z todo → wip (system)
- 2026-09-18T04:12:41.998Z wip → testing (system)
- 2026-09-18T04:14:10.605Z testing → done (system)

