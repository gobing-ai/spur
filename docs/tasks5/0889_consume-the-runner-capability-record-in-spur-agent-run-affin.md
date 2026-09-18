---
schema_version: 1
name: "Consume the runner capability record in Spur: agent-run affinity branches, doctor --json capabilities, requiresCapabilities attestation and stale-declaration warning"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.552Z
updated_at: "2026-09-18T04:14:10.605Z"
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
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:239-243` — `sessionCaps` read via `getAgentSessionCapability(resolveAgentName(...))`, `resumeSupported = sessionCaps?.supportsResumeById !== false`; repo grep of `agent-run.ts` for agent-name literals (`codex/gemini/claude/pi/...`) returns zero matches; regression test `packages/app/tests/workflow/actions/agent-run.test.ts:2913-2932` (claude record pass-through unchanged), gemini suppression `:2882-2911`; 0406 exit-2 fallback retained as documented safety net (`agent-run.ts:815-823`, `:909`) |
| R2 | MET | `packages/app/src/workflow/actions/agent-run.ts:326-333` (`flags.sessionId` emitted only when `resumeSupported`), `:345` (`flags.continue` suppressed), `:848-849` (no session discovery), `:889` (`resultData.session = 'fresh'`), `:909` (`__agentSession: 'no-resume'` written without `__agentSessionId`); tests `packages/app/tests/workflow/actions/agent-run.test.ts:2882-2911` assert no `sessionId`/`continue` flag, `session: 'fresh'`, `no-resume` writeback |
| R3 | MET | `packages/app/src/services/agent-service.ts:2739-2748` (`DoctorRow.capabilities` with 4 booleans + `verifiedAgainst` + `note`, `capabilityStale`), `:2799-2816` (`sessionCapabilityFor` reads record per canonical binary, null when unknown), `:731-732` + `:625-626` (both JSON entry builders carry `capabilities`/`capabilityStale`, stderr-clean), `:2876-2916` (compact `CAPS` table column `r✓d✗s✗o✓` / `—` / `⚠`); tests `packages/app/tests/services/agent-service.test.ts:4417-4453` (record verbatim per executor, unknown binary → null), `:4493-4510` (fresh table, no marker), `:369` (header now 8 columns incl. CAPS) |
| R4 | MET | `packages/config/src/index.ts:235-241` (`SESSION_CAPABILITY_AXES` = resumeById/sessionDir/persistentStdin/structuredOutput; `AGENT_RUN_CAPABILITY_AXES` union) + `:299-301` (`RequiresCapabilitiesSchema` admits all eight axes over `available |
| R5 | MET | `packages/app/src/services/agent-service.ts:681-690` (`warnCapabilityStale` — one `capability-declaration-stale` stderr warning per executor, text surfaces incl. role-ladder modes `:602`, `:637`, `:744`; JSON stays stderr-clean and carries `capabilityStale` structurally `:731-732`), `:2812-2815` (exact string-compare vs `verifiedAgainst`, no semver parsing per Design), `:2882-2885` (`⚠` cell marker); tests `packages/app/tests/services/agent-service.test.ts:4455-4491` (drift in JSON, stderr warning + `r✓d✗s✗o✓⚠` cell), `apps/cli/tests/config-layering.test.ts:89-91` (CLI-layer text-mode warning through real config stack) |
| R6 | MET | `packages/app/tests/workflow/actions/agent-run.test.ts:2865-3034` — B8 describe: 7 tests covering R2 (gemini suppression, latch unarmed, claude unchanged) and R4 (unmet pre-spawn, met serialization, unknown fail-closed) against stubbed dispatch/probe seams; R5 covered by `packages/app/tests/services/agent-service.test.ts:4416-4510` (4 tests, stubbed doctor probes) + CLI-layer `apps/cli/tests/config-layering.test.ts:89-91`; fresh driver-run gate `bun run spur-check` exit 0 — 8448 tests across 477 files, 0 fails (run ce44b029, host mu69mcqe-vtoqiq12, post-remediation) + `bun run lint` exit 0. Note: R5 CLI coverage landed in `apps/cli/tests/` (config-layering) and the service suite rather than `apps/cli/tests/commands/` — commands-layer doctor tests (`apps/cli/tests/commands/agent.test.ts:202-220`) remain pass-through; substance (hermetic R2/R4/R5 coverage, green gate) fully evidenced; advisory note below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | test `packages/app/tests/workflow/actions/agent-run.test.ts:2882-2932` — record drives resume decisions (gemini `supportsResumeById: false` → no flags, claude record → unchanged affinity); static anchor `packages/app/src/workflow/actions/agent-run.ts:239-243`; command: fresh `bun run spur-check` exit 0, 8448 tests / 477 files / 0 fails (run ce44b029, host mu69mcqe-vtoqiq12) |
| AC2 | MET | test | test `packages/app/tests/services/agent-service.test.ts:4417-4453` — doctor `--json` carries the record per executor (`verifiedAgainst`/`note` verbatim; unknown binary → null) + `:4493-4510` CAPS table cell; anchors `packages/app/src/services/agent-service.ts:2739-2748`, `:2799-2816`, `:2876-2916`; command: `bun run spur-check` exit 0 (run ce44b029) incl. `packages/app/tests/fixtures/json-raw-baseline.json` baseline carrying the new fields |
| AC3 | MET | test | test `packages/app/tests/workflow/actions/agent-run.test.ts:2951-3034` — unmet session requirement → ADR-118 contract-violation naming executor + axis with `runTraced` never called; met requirement → serialized into dispatch flags; unknown binary fails closed; anchors `packages/app/src/workflow/actions/agent-run.ts:369-397`, `packages/app/src/services/capability-attestation.ts:181-211`, `packages/config/src/index.ts:299-301`; command: `bun run spur-check` exit 0 (run ce44b029) |
| AC4 | MET | test | test `packages/app/tests/services/agent-service.test.ts:4455-4491` — drift reported in `--json` (`capabilityStale: {verifiedAgainst, detected}`), stderr `capability-declaration-stale` warning + `⚠` cell in text mode, fresh rows unmarked; CLI-layer `apps/cli/tests/config-layering.test.ts:89-91`; anchors `packages/app/src/services/agent-service.ts:681-690`, `:2812-2815`; command: `bun run spur-check` exit 0 (run ce44b029) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | 6/6 design claims DONE; 1 documented deviation: Design paragraph "two enum members" superseded by R4's four session axes — resolved R4-wins and recorded in `## Solution` (config vocabulary `packages/config/src/index.ts:235-241`), CHANGED + PASS-acceptable |
| P4 | evidence-rule-pass | — | all 4 AC rows carry `test` + `command` executable evidence |
| P4 | tests-pass | — | driver-run `bun run spur-check` exit 0 — 8448 tests / 477 files / 0 fails (run ce44b029, host mu69mcqe-vtoqiq12, post-remediation); remediation hop (stale doctor baselines ×4, stale generated bundle) fixed to root cause: `packages/app/tests/fixtures/json-raw-baseline.json` regen, `apps/cli/tests/config-layering.test.ts:89-91` exact-two-line R7 assertion, `bun run build:plugin-lib` regen |
| P4 | lint-clean | — | driver-run `bun run lint` exit 0 (biome + typecheck all workspaces, run ce44b029) |
| P4 | docs-t3 | — | `docs/design/cli-contracts.md:428-461` (CAPS column + JSON fields + stderr-clean JSON), `docs/design/planning-workflow-contracts.md:252-271` (session-axis paragraph), `plugins/sp/skills/spur-cli/references/agent.md:164-171` (doctor rows) — all re-read this run |
| P4 | scope-creep | — | all diff hunks map to R1–R6 / Design / remediation (baseline regen + R7 assertion were fixall gate repairs, not feature scope) |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T03:08:07.532Z todo → wip (system)
- 2026-09-18T04:12:41.998Z wip → testing (system)
- 2026-09-18T04:14:10.605Z testing → done (system)

